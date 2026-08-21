package expo.modules.aptmanager

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.Promise
import expo.modules.interfaces.permissions.PermissionsResponseListener
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.tukaani.xz.XZInputStream
import org.apache.commons.compress.archivers.tar.TarArchiveInputStream
import org.apache.commons.compress.compressors.gzip.GzipCompressorInputStream
import java.io.*
import java.net.HttpURLConnection
import android.content.Intent
import android.net.Uri
import android.provider.Settings
import android.Manifest
import android.app.NotificationManager
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.os.Environment
import android.os.PowerManager
import androidx.core.app.ActivityCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.FileProvider
import expo.modules.termuxterminal.ProotEnvironment
import java.net.URL
import java.util.zip.GZIPInputStream
import java.util.zip.ZipInputStream
import org.json.JSONObject

/**
 * Live progress of the rootfs download/install, polled from JS (getRootfsProgress) so the UI can
 * show real-time "downloaded X / Y MB" instead of a frozen spinner.
 */
object RootfsProgress {
    @Volatile var stage: String = "idle"        // idle | connecting | downloading | extracting | done | failed
    @Volatile var currentUrl: String = ""
    @Volatile var downloadedBytes: Long = 0
    @Volatile var totalBytes: Long = 0
    @Volatile var message: String = ""
    fun reset() {
        stage = "idle"; currentUrl = ""; downloadedBytes = 0; totalBytes = 0; message = ""
    }
}

class AptManagerModule : Module() {

    companion object {
        const val BOOTSTRAP_URL = "https://github.com/termux/termux-packages/releases/download/bootstrap-2025.12.14-r1%2Bapt.android-7/bootstrap-aarch64.zip"
        // RN Studio supports one tested arm64 workspace image. Keeping this URL fixed is
        // intentional: the JS installer and native fallback must install the same environment.
        const val DEFAULT_ROOTFS_URL = "https://github.com/wfllive/rootfs/releases/download/1.0/ubuntu-rootfs.tar.gz"
    }

    private fun getPrefix(): String {
        val appCtx = appContext.reactContext!!
        return File(appCtx.filesDir, "usr").absolutePath
    }

    /** Parse a JSON-serialized color-role map (e.g. "{\"primary\":\"#FF6750A4\"}"). */
    private fun stringMapOf(json: String?): Map<String, String>? {
        if (json.isNullOrBlank()) return null
        return try {
            val obj = JSONObject(json)
            val map = mutableMapOf<String, String>()
            val keys = obj.keys()
            while (keys.hasNext()) {
                val k = keys.next()
                map[k] = obj.getString(k)
            }
            if (map.isEmpty()) null else map
        } catch (_: Exception) {
            null
        }
    }

    private fun getHome(): String {
        val appCtx = appContext.reactContext!!
        return File(appCtx.filesDir, "home").absolutePath
    }

    // ---------------------------------------------------------------------
    // proot Linux rootfs (gives a real Linux with apt, bypassing noexec)
    // ---------------------------------------------------------------------

    private fun getProotRootfsDir(): File {
        val appCtx = appContext.reactContext!!
        return File(appCtx.filesDir, "proot/rootfs")
    }

    private fun isProotRootfsInstalled(): Boolean =
        File(getProotRootfsDir(), "bin").isDirectory

    /** Download a .tar.gz rootfs and extract it into files/proot/rootfs. */
    /** Which guest architecture to fetch a rootfs for, based on the device's primary ABI. */
    private fun deviceArchLabel(): String {
        val abi = try {
            android.os.Build.SUPPORTED_ABIS.firstOrNull() ?: "arm64-v8a"
        } catch (e: Exception) {
            "arm64-v8a"
        }
        return when {
            abi.contains("arm64") || abi.contains("aarch64") -> "aarch64"
            abi.contains("x86_64") -> "x86_64"
            abi.contains("x86") -> "i386"
            else -> "armhf" // armeabi-v7a and friends
        }
    }

    /**
     * Prioritized rootfs tarballs for the current architecture. apt-based images first (the user
     * wants apt); Alpine (apk) as a small reliable fallback. URLs can rot, so several are tried in
     * order; an explicit URL always wins.
     */
    /** Fetch a small text page (used to read a directory index). Returns null on failure. */
    private fun fetchString(urlStr: String): String? {
        return try {
            var url = URL(urlStr)
            var conn = url.openConnection() as HttpURLConnection
            conn.connectTimeout = 15000
            conn.readTimeout = 30000
            conn.instanceFollowRedirects = true
            var redirects = 0
            while (redirects < 10) {
                val code = conn.responseCode
                if (code in listOf(301, 302, 303, 307, 308)) {
                    val loc = conn.getHeaderField("Location") ?: break
                    url = URL(url, loc)
                    conn = url.openConnection() as HttpURLConnection
                    conn.instanceFollowRedirects = true
                    conn.connectTimeout = 15000
                    conn.readTimeout = 30000
                    redirects++
                } else break
            }
            if (conn.responseCode != 200) return null
            conn.inputStream.bufferedReader().use { it.readText() }
        } catch (e: Exception) {
            null
        }
    }

    /**
     * Resolve the CURRENT ubuntu-base rootfs filename from a release directory index, so the URL
     * does not rot when a new point release (24.04.3 -> 24.04.4 ...) replaces the previous one.
     * [archSuffix] is the Ubuntu arch token: arm64 / armhf / amd64.
     */
    private fun resolveUbuntuBaseUrl(releaseIndexUrl: String, archSuffix: String): String? {
        val html = fetchString(releaseIndexUrl) ?: return null
        val regex = Regex("ubuntu-base-[0-9.]+-base-$archSuffix\\.tar\\.gz")
        val match = regex.find(html) ?: return null
        return releaseIndexUrl.trimEnd('/') + "/" + match.value
    }

    /**
     * Architecture of the bundled proot binary, which determines the guest rootfs arch it can run.
     * A 32-bit (armhf) proot can ONLY run 32-bit guests, so the rootfs must match the proot, not
     * the device. Reads the ELF header of libproot.so. Returns Ubuntu arch suffix: arm64 / armhf.
     */
    private fun prootUbuntuArchSuffix(): String {
        return try {
            val appCtx = appContext.reactContext!!
            val proot = File(appCtx.applicationInfo.nativeLibraryDir, "libproot.so")
            if (!proot.exists()) return if (deviceArchLabel() == "aarch64") "arm64" else "armhf"
            val header = ByteArray(20)
            FileInputStream(proot).use { it.read(header) }
            val eiClass = header[4].toInt() // 1 = 32-bit, 2 = 64-bit
            val eMachine = (header[18].toInt() and 0xFF) or ((header[19].toInt() and 0xFF) shl 8)
            when {
                eiClass == 2 || eMachine == 183 -> "arm64" // AArch64
                else -> "armhf"                            // 32-bit ARM
            }
        } catch (e: Exception) {
            if (deviceArchLabel() == "aarch64") "arm64" else "armhf"
        }
    }

    private fun candidateRootfsUrls(): List<String> = listOf(DEFAULT_ROOTFS_URL)

    /** Install a rootfs. If [url] is blank, try [candidateRootfsUrls] in order until one works. */
    private fun installProotRootfs(url: String?, log: StringBuilder): Boolean {
        val urls = if (url.isNullOrBlank()) candidateRootfsUrls() else listOf(url)
        log.appendLine("Device arch: ${deviceArchLabel()}")
        log.appendLine("proot arch (rootfs will match it): ${prootUbuntuArchSuffix()}")
        for (candidate in urls) {
            log.appendLine("Trying: $candidate")
            if (downloadAndExtractRootfs(candidate, log)) return true
            log.appendLine("(failed, trying next if any)")
        }
        log.appendLine("All rootfs sources failed. Pass a working rootfs .tar.gz URL explicitly.")
        return false
    }

    private fun downloadAndExtractRootfs(url: String, log: StringBuilder): Boolean {
        val appCtx = appContext.reactContext!!
        val rootfs = getProotRootfsDir()
        val cache = File(appCtx.cacheDir, "proot-rootfs.tar.gz")
        rootfs.mkdirs()

        RootfsProgress.currentUrl = url
        RootfsProgress.stage = "connecting"
        RootfsProgress.message = "Подключение..."
        log.appendLine("Downloading rootfs...")
        log.appendLine(url)
        if (!downloadFileWithProgress(url, cache)) {
            RootfsProgress.stage = "failed"
            RootfsProgress.message = "Download failed"
            log.appendLine("Download failed"); return false
        }
        log.appendLine("Downloaded: ${cache.length() / 1024 / 1024}MB")
        log.appendLine("Extracting to ${rootfs.absolutePath}/...")
        RootfsProgress.stage = "extracting"
        RootfsProgress.message = "Распаковка..."

        // Wipe any previous rootfs so a different-arch (or broken) install does not leave mixed
        // files behind (e.g. an old arm64 rootfs when now installing armhf to match a 32-bit proot).
        try { rootfs.deleteRecursively() } catch (_: Exception) {}
        rootfs.mkdirs()

        var count = 0
        try {
            TarArchiveInputStream(GzipCompressorInputStream(BufferedInputStream(FileInputStream(cache)))).use { tar ->
                var entry = tar.nextTarEntry
                val rootCanonical = rootfs.canonicalPath
                while (entry != null) {
                    val name = entry.name.removePrefix("./")
                    if (name.isEmpty()) { entry = tar.nextTarEntry; continue }
                    val out = File(rootfs, name)
                    // Guard against zip-slip / path traversal.
                    if (!out.canonicalPath.startsWith(rootCanonical)) {
                        entry = tar.nextTarEntry; continue
                    }
                    when {
                        entry.isDirectory -> {
                            out.mkdirs()
                        }
                        // Ubuntu/Debian rootfs use usrmerge: /bin, /lib, /sbin and many files are
                        // symlinks. They MUST be recreated as real symlinks, otherwise /bin/bash is
                        // unreachable and proot cannot start the distro.
                        entry.isSymbolicLink -> {
                            out.parentFile?.mkdirs()
                            try { out.delete() } catch (_: Exception) {} // remove stale entry if re-installing
                            try { android.system.Os.symlink(entry.linkName, out.absolutePath) } catch (_: Exception) {}
                            count++
                        }
                        entry.isLink -> {
                            // Hard link to another file already extracted in the rootfs.
                            out.parentFile?.mkdirs()
                            val target = File(rootfs, entry.linkName.removePrefix("./"))
                            try {
                                if (target.exists()) android.system.Os.link(target.absolutePath, out.absolutePath)
                            } catch (_: Exception) {}
                            count++
                        }
                        else -> {
                            out.parentFile?.mkdirs()
                            try {
                                FileOutputStream(out).use { fos -> tar.copyTo(fos) }
                                count++
                                // Preserve executable bit from the archive (binaries in /bin, /usr/bin, ...).
                                val mode = entry.mode
                                if (mode and 0b001001001 != 0) {
                                    out.setExecutable(true, false)
                                }
                            } catch (_: Exception) {}
                        }
                    }
                    RootfsProgress.message = "Распаковка: $count файлов"
                    entry = tar.nextTarEntry
                }
            }
            cache.delete()
            log.appendLine("Extracted $count files")

            // Make networking tools (apt/wget/curl/git) work inside proot: configure DNS.
            setupRootfsNetwork(rootfs, log)
            // proot-friendly apt/dpkg configuration (same as ProotEnvironment.prepareRootfs,
            // but written directly so it is in place before the very first proot run).
            hardenRootfs(rootfs, log)

            // Full apt/dpkg preparation INSIDE the fresh rootfs, so `apt update && apt upgrade`
            // work immediately after install with no manual "Repair apt/dpkg" step:
            // breaks hard links (gzip/perl), heals any .l2s leftovers, runs
            // dpkg --configure -a, apt-get update, apt-get -f install -y.
            // Non-fatal: if it fails the rootfs is still installed and can be repaired
            // from the terminal.
            try {
                RootfsProgress.stage = "preparing"
                RootfsProgress.message = "Настройка apt/dpkg..."
                log.appendLine("=== apt/dpkg auto-prepare (one-time) ===")
                val prep = ProotEnvironment.prepareRootfs(appCtx, true, 300_000L)
                log.appendLine("exit=${prep.first}")
                log.appendLine(prep.second)
            } catch (e: Exception) {
                log.appendLine("auto-prepare error: ${e.message}")
            }

            val ok = File(rootfs, "bin").isDirectory
            log.appendLine(if (ok) "✓ rootfs ready" else "✗ rootfs incomplete")
            RootfsProgress.stage = if (ok) "done" else "failed"
            RootfsProgress.message = if (ok) "Готово" else "rootfs incomplete"
            return ok
        } catch (e: Exception) {
            log.appendLine("Error: ${e.message}")
            RootfsProgress.stage = "failed"
            RootfsProgress.message = "Error: ${e.message}"
            return false
        }
    }

    /**
     * Configure the rootfs so network tools work under proot. proot shares the Android kernel's
     * network stack, but the guest needs a valid /etc/resolv.conf for DNS (apt/wget/curl/git all
     * depend on it). Ubuntu base images ship a resolv.conf that may be empty or point to a stub.
     */
    private fun setupRootfsNetwork(rootfs: File, log: StringBuilder) {
        try {
            val etc = File(rootfs, "etc"); etc.mkdirs()
            val resolv = File(etc, "resolv.conf")
            // Some images ship resolv.conf as a symlink to a stub; replace with a real file.
            if (resolv.exists()) resolv.delete()
            resolv.writeText("nameserver 8.8.8.8\nnameserver 1.1.1.1\nnameserver 2001:4860:4860::8888\n")
            log.appendLine("✓ DNS configured (/etc/resolv.conf)")
        } catch (e: Exception) {
            log.appendLine("DNS setup warning: ${e.message}")
        }
    }

    /**
     * Write the proot-friendly apt/dpkg configuration directly into the extracted rootfs, so
     * dpkg/apt work the first time proot starts (mirrors what Termux's proot-distro does for
     * its Ubuntu images). Idempotent — safe to re-run.
     */
    private fun hardenRootfs(rootfs: File, log: StringBuilder) {
        try {
            // 1) Essential directories
            for (rel in listOf(
                "var/lib/dpkg/updates", "var/lib/dpkg/info",
                "var/lib/apt/lists/partial", "var/cache/apt/archives/partial",
                "var/log/apt", "run/lock", "run", "dev/shm", "tmp", "var/tmp"
            )) {
                File(rootfs, rel).mkdirs()
            }

            // 2) apt configuration: sandbox user (proot cannot switch to _apt), no config-file
            //    prompts that hang non-interactive upgrades, no HTTP pipelining issues.
            val aptConfDir = File(rootfs, "etc/apt/apt.conf.d").apply { mkdirs() }
            File(aptConfDir, "00proot").writeText(
                "APT::Sandbox::User \"root\";\n" +
                    "DPkg::Options { \"--force-confdef\"; \"--force-confold\"; };\n" +
                    "Acquire::http::Pipeline-Depth \"0\";\n" +
                    "Acquire::Retries \"3\";\n"
            )

            // 3) policy-rc.d: maintainer scripts must not try to start systemd services
            val policyRcD = File(rootfs, "usr/sbin/policy-rc.d")
            if (!policyRcD.exists()) {
                policyRcD.writeText("#!/bin/sh\nexit 101\n")
                policyRcD.setExecutable(true, false)
            }

            // 4) tmp dirs must be world-writable
            for (rel in listOf("tmp", "var/tmp", "dev/shm")) {
                try { File(rootfs, rel).setExecutable(true, false) } catch (_: Exception) {}
                try { File(rootfs, rel).setWritable(true, false) } catch (_: Exception) {}
            }

            // 5) apt sources: an arm64 rootfs needs ports.ubuntu.com, not archive.ubuntu.com;
            //    some images ship an empty sources.list which makes apt update/upgrade fail.
            writeAptSources(rootfs, log)

            log.appendLine("✓ apt/dpkg proot config written")
        } catch (e: Exception) {
            log.appendLine("apt/dpkg config warning: ${e.message}")
        }
    }

    /** True if the rootfs has at least one active (non-commented) source line (classic or deb822). */
    private fun hasAptSources(rootfs: File): Boolean {
        val candidates = mutableListOf<File>()
        val plain = File(rootfs, "etc/apt/sources.list")
        if (plain.exists()) candidates.add(plain)
        val dir = File(rootfs, "etc/apt/sources.list.d")
        if (dir.isDirectory) dir.listFiles()?.filter { it.isFile }?.let { candidates.addAll(it) }
        return candidates.any { f ->
            try {
                f.readLines().any { line ->
                    val t = line.trimStart()
                    !t.startsWith("#") &&
                        (t.startsWith("deb ") || t.startsWith("URIs:") || t.startsWith("Types:"))
                }
            } catch (_: Exception) { false }
        }
    }

    /** Write standard Ubuntu sources for the guest codename/arch if none are active. */
    private fun writeAptSources(rootfs: File, log: StringBuilder) {
        try {
            if (hasAptSources(rootfs)) return
            var codename = "noble"
            try {
                val osRelease = File(rootfs, "etc/os-release")
                if (osRelease.exists()) {
                    osRelease.readLines().forEach { line ->
                        if (line.startsWith("VERSION_CODENAME=")) {
                            codename = line.substringAfter('=').trim().ifEmpty { "noble" }
                        }
                    }
                }
            } catch (_: Exception) {}
            val arch = prootUbuntuArchSuffix()
            val mirror = if (arch == "arm64" || arch == "armhf") {
                "http://ports.ubuntu.com/ubuntu-ports"
            } else {
                "http://archive.ubuntu.com/ubuntu"
            }
            File(rootfs, "etc/apt/sources.list.d").mkdirs()
            File(rootfs, "etc/apt/sources.list.d/ubuntu-proot.list").writeText(
                "deb $mirror $codename main restricted universe multiverse\n" +
                    "deb $mirror ${codename}-updates main restricted universe multiverse\n" +
                    "deb $mirror ${codename}-security main restricted universe multiverse\n"
            )
            // Remove stock sources to avoid "configured multiple times" warnings (noble ships
            // deb822 /etc/apt/sources.list.d/ubuntu.sources which the guard above may miss).
            val plain = File(rootfs, "etc/apt/sources.list")
            if (plain.exists() && plain.isFile) plain.delete()
            val ubuntuSources = File(rootfs, "etc/apt/sources.list.d/ubuntu.sources")
            if (ubuntuSources.exists() && ubuntuSources.isFile) ubuntuSources.delete()
            log.appendLine("✓ apt sources written ($codename / $arch via $mirror)")
        } catch (e: Exception) {
            log.appendLine("apt sources warning: ${e.message}")
        }
    }

    private fun isBootstrapInstalled(): Boolean {
        val prefix = getPrefix()
        val bash = File(prefix, "bin/bash")
        val apt = File(prefix, "bin/apt")
        val dpkg = File(prefix, "bin/dpkg")
        val sourcesList = File(prefix, "etc/apt/sources.list")
        return bash.exists() && apt.exists() && dpkg.exists() && sourcesList.exists()
    }

    /** Скопировать бинарники в exec-capable директорию */
    private fun ensurePermissions() {
        val appCtx = appContext.reactContext!!
        val prefix = getPrefix()
        val execDir = appCtx.getDir("exec", android.content.Context.MODE_PRIVATE)
        val execBin = File(execDir, "bin")
        execBin.mkdirs()

        // Логируем пути
        android.util.Log.d("AptManager", "prefix: $prefix")
        android.util.Log.d("AptManager", "execDir: ${execDir.absolutePath}")
        android.util.Log.d("AptManager", "execBin: ${execBin.absolutePath}")

        // Копируем все бинарники из prefix/bin в execBin
        val srcBin = File(prefix, "bin")
        android.util.Log.d("AptManager", "srcBin exists: ${srcBin.exists()}")
        if (srcBin.exists()) {
            val files = srcBin.listFiles()
            android.util.Log.d("AptManager", "srcBin files count: ${files?.size ?: 0}")
            files?.forEach { file ->
                val dest = File(execBin, file.name)
                if (!dest.exists() || file.lastModified() > dest.lastModified()) {
                        try {
                        file.copyTo(dest, overwrite = true)
                        dest.setExecutable(true, false)
                        try { android.system.Os.chmod(dest.absolutePath, 0b111000000) } catch (e: Exception) {
                            android.util.Log.e("AptManager", "chmod 0700 failed for ${file.name}: ${e.message}")
                        }
                        android.util.Log.d("AptManager", "Copied ${file.name} -> ${dest.absolutePath}, canExecute=${dest.canExecute()}")
                    } catch (e: Exception) {
                        android.util.Log.e("AptManager", "Copy failed for ${file.name}: ${e.message}")
                    }
                }
            }
        }

        // Также копируем lib (для shared libraries)
        val execLib = File(execDir, "lib")
        execLib.mkdirs()
        val srcLib = File(prefix, "lib")
        if (srcLib.exists()) {
            srcLib.listFiles()?.filter { it.isFile }?.forEach { file ->
                val dest = File(execLib, file.name)
                if (!dest.exists() || file.lastModified() > dest.lastModified()) {
                    try {
                        file.copyTo(dest, overwrite = true)
                        dest.setExecutable(true, false)
                        try { android.system.Os.chmod(dest.absolutePath, 0b111000000) } catch (_: Exception) {}
                    } catch (_: Exception) {}
                }
            }
        }

        android.util.Log.d("AptManager", "ensurePermissions complete")
    }

    private fun downloadFile(urlStr: String, dest: File): Boolean {
        return try {
            var url = URL(urlStr)
            var conn = url.openConnection() as HttpURLConnection
            conn.connectTimeout = 15000
            conn.readTimeout = 120000
            conn.instanceFollowRedirects = true
            var redirects = 0
            while (redirects < 10) {
                val code = conn.responseCode
                if (code in listOf(301, 302, 307, 308)) {
                    val loc = conn.getHeaderField("Location") ?: break
                    url = URL(url, loc)
                    conn = url.openConnection() as HttpURLConnection
                    conn.instanceFollowRedirects = true
                    conn.connectTimeout = 15000
                    conn.readTimeout = 120000
                    redirects++
                } else break
            }
            if (conn.responseCode != 200) return false
            conn.inputStream.use { input ->
                FileOutputStream(dest).use { output -> input.copyTo(output, 8192) }
            }
            dest.length() > 0
        } catch (_: Exception) { false }
    }

    /** Like [downloadFile] but streams to [dest] while updating [RootfsProgress] for live UI. */
    private fun downloadFileWithProgress(urlStr: String, dest: File): Boolean {
        return try {
            var url = URL(urlStr)
            var conn = url.openConnection() as HttpURLConnection
            conn.connectTimeout = 15000
            conn.readTimeout = 120000
            conn.instanceFollowRedirects = true
            var redirects = 0
            while (redirects < 10) {
                val code = conn.responseCode
                if (code in listOf(301, 302, 307, 308)) {
                    val loc = conn.getHeaderField("Location") ?: break
                    url = URL(url, loc)
                    conn = url.openConnection() as HttpURLConnection
                    conn.instanceFollowRedirects = true
                    conn.connectTimeout = 15000
                    conn.readTimeout = 120000
                    redirects++
                } else break
            }
            if (conn.responseCode != 200) return false
            RootfsProgress.stage = "downloading"
            RootfsProgress.totalBytes = conn.contentLengthLong.coerceAtLeast(0)
            RootfsProgress.downloadedBytes = 0
            conn.inputStream.use { input ->
                FileOutputStream(dest).use { output ->
                    val buf = ByteArray(16 * 1024)
                    var read = input.read(buf)
                    var total = 0L
                    while (read != -1) {
                        output.write(buf, 0, read)
                        total += read
                        RootfsProgress.downloadedBytes = total
                        read = input.read(buf)
                    }
                }
            }
            dest.length() > 0
        } catch (_: Exception) { false }
    }

    private fun installBootstrap(log: StringBuilder): Boolean {
        val appCtx = appContext.reactContext!!
        val prefix = File(getPrefix())
        val home = File(getHome())
        val tmpDir = File(prefix, "tmp")
        val cacheDir = File(appCtx.cacheDir, "apt-cache")
        cacheDir.mkdirs(); prefix.mkdirs(); home.mkdirs(); tmpDir.mkdirs()

        val zipFile = File(cacheDir, "bootstrap-aarch64.zip")
        log.appendLine("Downloading Termux bootstrap...")

        if (!downloadFile(BOOTSTRAP_URL, zipFile)) {
            log.appendLine("Download failed"); return false
        }
        log.appendLine("Downloaded: ${zipFile.length() / 1024 / 1024}MB")
        log.appendLine("Extracting to ${prefix.absolutePath}/...")

        var extractedCount = 0
        val symlinks = mutableListOf<Pair<String, String>>()

        try {
            ZipInputStream(FileInputStream(zipFile)).use { zip ->
                var entry = zip.nextEntry
                while (entry != null) {
                    val name = entry.name
                    if (name == "SYMLINKS.txt") {
                        val text = zip.bufferedReader().readText()
                        text.lines().filter { it.contains("\u2190") }.forEach { line ->
                            val parts = line.split("\u2190")
                            if (parts.size == 2) {
                                symlinks.add(Pair(parts[1].trim().removePrefix("./"), parts[0].trim()))
                            }
                        }
                        entry = zip.nextEntry; continue
                    }
                    if (name.isEmpty() || name == "./" || name == ".") { entry = zip.nextEntry; continue }

                    val destFile = File(prefix, name)
                    if (entry.isDirectory) {
                        destFile.mkdirs()
                    } else {
                        destFile.parentFile?.mkdirs()
                        try {
                            FileOutputStream(destFile).use { fos -> zip.copyTo(fos) }
                            extractedCount++
                            if (name.startsWith("bin/") || name.startsWith("lib/apt/")) {
                                destFile.setExecutable(true, false)
                                try { android.system.Os.chmod(destFile.absolutePath, 0b111000000) } catch (_: Exception) {}
                            }
                        } catch (_: Exception) {}
                    }
                    entry = zip.nextEntry
                }
            }

            log.appendLine("Extracted $extractedCount files")

            // Symlinks
            var linksCreated = 0
            for ((linkPath, target) in symlinks) {
                val linkFile = File(prefix, linkPath)
                linkFile.parentFile?.mkdirs()
                if (linkFile.exists()) linkFile.delete()
                try {
                    ProcessBuilder("ln", "-sf", target, linkFile.absolutePath).redirectErrorStream(true).start().waitFor()
                    linksCreated++
                } catch (_: Exception) {}
            }
            log.appendLine("Created $linksCreated symlinks")

            zipFile.delete()

            // chmod — через Java Os.chmod для каждого файла (надёжнее чем shell chmod)
            var chmodCount = 0
            val binDir = File(prefix, "bin")
            if (binDir.exists()) {
                binDir.walkTopDown().filter { it.isFile }.forEach { file ->
                    file.setExecutable(true, false)
                    try { android.system.Os.chmod(file.absolutePath, 0b111000000) } catch (_: Exception) {}
                    chmodCount++
                }
            }
            val libDir = File(prefix, "lib")
            if (libDir.exists()) {
                libDir.walkTopDown().filter { it.isFile }.forEach { file ->
                    file.setExecutable(true, false)
                    try { android.system.Os.chmod(file.absolutePath, 0b111000000) } catch (_: Exception) {}
                    chmodCount++
                }
            }
            val libexecDir = File(prefix, "libexec")
            if (libexecDir.exists()) {
                libexecDir.walkTopDown().filter { it.isFile }.forEach { file ->
                    file.setExecutable(true, false)
                    try { android.system.Os.chmod(file.absolutePath, 0b111000000) } catch (_: Exception) {}
                    chmodCount++
                }
            }
            log.appendLine("chmod: $chmodCount files made executable")

            val bash = File(prefix, "bin/bash")
            val apt = File(prefix, "bin/apt")
            log.appendLine("bash: exists=${bash.exists()} canExec=${bash.canExecute()}")
            log.appendLine("apt: exists=${apt.exists()} canExec=${apt.canExecute()}")
            log.appendLine("sources.list: ${File(prefix, "etc/apt/sources.list").exists()}")

            return bash.exists() && bash.canExecute()
        } catch (e: Exception) {
            log.appendLine("Error: ${e.message}")
            return false
        }
    }

    private fun runShellCmd(cmd: String): Map<String, Any> {
        val prefix = getPrefix()
        val home = getHome()
        val tmpDir = "$prefix/tmp"
        val fullCmd = "export PREFIX=\"$prefix\" && export HOME=\"$home\" && export TMPDIR=\"$tmpDir\" && " +
            "export PATH=\"$prefix/bin:\$PATH\" && export LD_LIBRARY_PATH=\"$prefix/lib:\$LD_LIBRARY_PATH\" && " +
            "export TERM=xterm-256color && $cmd 2>&1"
        return try {
            val process = ProcessBuilder("sh", "-c", fullCmd).redirectErrorStream(true).start()
            val output = process.inputStream.bufferedReader().readText()
            val exitCode = process.waitFor()
            mapOf("success" to (exitCode == 0), "exitCode" to exitCode, "output" to output)
        } catch (e: Exception) {
            mapOf("success" to false, "exitCode" to -1, "output" to ("Error: " + e.message))
        }
    }

    // ---------------------------------------------------------------------
    // RAI + NCS Build — вендоренные в этом репозитории скрипты лежат в assets
    // модуля apt-manager (modules/apt-manager/android/src/main/assets/rai/):
    //   rai/rai.sh               — основной RAI-бандл (Node.js CLI)
    //   rai/ncs/fast-install.sh  — быстрая установка JDK 17 + Android SDK
    //   rai/ncs/ncs-build.sh     — сборка Java+XML без Gradle
    //   rai/ncs/new-project.sh   — создание нового проекта
    // prebuild пересоздаёт только android/, поэтому эта копия переживает
    // `expo prebuild --clean`. При gradle-сборке assets библиотечного модуля
    // сливаются в APK, и здесь мы копируем их в rootfs как /root/rai/... чтобы
    // страница установки запускала ЛОКАЛЬНЫЕ копии без скачивания с GitHub.
    // ---------------------------------------------------------------------

    private fun getRaiRootfsDir(): File = File(getProotRootfsDir(), "root/rai")

    /** Copy one APK asset into the rootfs. Sets +rx and 0644 perms. */
    private fun copyAssetToRootfs(assetPath: String, dest: File, log: MutableList<String>? = null): Boolean {
        return try {
            val appCtx = appContext.reactContext!!
            appCtx.assets.open(assetPath).use { input ->
                val tmp = File(dest.parentFile, dest.name + ".tmp")
                dest.parentFile?.mkdirs()
                FileOutputStream(tmp).use { out -> input.copyTo(out) }
                tmp.setExecutable(true, false)
                tmp.setReadable(true, false)
                if (!tmp.renameTo(dest)) {
                    tmp.copyTo(dest, overwrite = true)
                    tmp.delete()
                }
            }
            log?.add("seeded $assetPath -> ${dest.absolutePath} (${dest.length()} B)")
            true
        } catch (e: Exception) {
            log?.add("seed failed for $assetPath: ${e.message}")
            false
        }
    }

    private fun seedRaiBundle(): Map<String, Any> {
        val log = mutableListOf<String>()
        return try {
            val appCtx = appContext.reactContext!!
            val destDir = getRaiRootfsDir()
            destDir.mkdirs()
            var bytes = 0L
            var count = 0

            // 1) rai.sh (основной RAI бандл)
            val raiDest = File(destDir, "rai.sh")
            if (raiDest.isFile && raiDest.length() > 100_000L) {
                log.add("rai.sh already seeded (${raiDest.length()} B)")
                bytes += raiDest.length()
                count++
            } else {
                if (copyAssetToRootfs("rai/rai.sh", raiDest, log)) {
                    bytes += raiDest.length()
                    count++
                }
            }

            // 2) NCS Build scripts (fast-install, build, new-project) — раньше лежали
            //    только в assets, а нативный модуль их не копировал, что приводило к
            //    "TypeError: undefined is not a function" на шаге "Копирую NCS-скрипты".
            val ncsSrcDir = "rai/ncs"
            val ncsDestDir = File(destDir, "ncs")
            ncsDestDir.mkdirs()
            val ncsFiles = listOf("fast-install.sh", "ncs-build.sh", "new-project.sh")
            for (f in ncsFiles) {
                val dest = File(ncsDestDir, f)
                val assetPath = "$ncsSrcDir/$f"
                if (dest.isFile && dest.length() > 100L) {
                    log.add("$f already seeded (${dest.length()} B)")
                    bytes += dest.length()
                    count++
                    continue
                }
                if (copyAssetToRootfs(assetPath, dest, log)) {
                    bytes += dest.length()
                    count++
                } else {
                    // Не падаем — скрипт мог не быть включен в ассеты (старый APK).
                    // В этом случае установка JDK/SDK будет использовать запасной
                    // путь в коде (скачивание/встроенные команды).
                    log.add("$f missing from APK assets — skipping")
                }
            }

            mapOf(
                "success" to true,
                "output" to "RAI + NCS bundle seeded from APK assets ($count files)",
                "path" to "/root/rai/rai.sh",
                "ncsDir" to "/root/rai/ncs",
                "files" to count,
                "bytes" to bytes,
                "log" to log.joinToString("\n"),
            )
        } catch (e: Exception) {
            mapOf("success" to false, "output" to (e.message ?: e.toString()), "log" to log.joinToString("\n"))
        }
    }

    /** True when the app may read/write shared storage (All files access on API 30+). */
    private fun hasAllFilesAccess(): Boolean {
        val ctx = appContext.reactContext ?: return false
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            Environment.isExternalStorageManager()
        } else {
            ctx.checkSelfPermission(Manifest.permission.WRITE_EXTERNAL_STORAGE) == PackageManager.PERMISSION_GRANTED
        }
    }

    /**
     * Android 7-12 do not have a notification runtime dialog, but users and OEMs can still block
     * the whole app. Android 8+ can additionally block just our background-work channel. Android
     * 13+ adds POST_NOTIFICATIONS on top of both switches. Keep these signals separate so the UI
     * can request the runtime permission only when that can help, and otherwise open Settings.
     *
     * This deliberately uses an API >= 33 check rather than an upper-bound version list, so the
     * same behavior remains valid on Android 17 and later releases.
     */
    private fun notificationPermissionStatus(context: Context): MutableMap<String, Any> {
        val runtimePermissionRequired = Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
        val runtimeGranted = !runtimePermissionRequired ||
            context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED
        val appNotificationsEnabled = NotificationManagerCompat.from(context).areNotificationsEnabled()

        var channelCreated = false
        var channelEnabled = true
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            val channel = manager.getNotificationChannel(BackgroundWorkService.CHANNEL_ID)
            channelCreated = channel != null
            // A missing channel is not itself a user block: initializeNotifications creates it
            // before requesting permission or posting background progress.
            channelEnabled = channel == null || channel.importance != NotificationManager.IMPORTANCE_NONE
        }

        val granted = runtimeGranted && appNotificationsEnabled && channelEnabled
        val blockingReason = when {
            !runtimeGranted -> "runtime-permission"
            !appNotificationsEnabled -> "app-disabled"
            !channelEnabled -> "channel-disabled"
            else -> "none"
        }
        return mutableMapOf(
            "granted" to granted,
            "apiLevel" to Build.VERSION.SDK_INT,
            "runtimePermissionRequired" to runtimePermissionRequired,
            "runtimeGranted" to runtimeGranted,
            "appNotificationsEnabled" to appNotificationsEnabled,
            "channelCreated" to channelCreated,
            "channelEnabled" to channelEnabled,
            "blockingReason" to blockingReason,
        )
    }

    /** Open the narrowest useful notification settings page, with safe OEM/API fallbacks. */
    private fun openNotificationSettings(context: Context): Map<String, Any> {
        val status = notificationPermissionStatus(context)
        val intents = mutableListOf<Intent>()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            if (status["appNotificationsEnabled"] == true && status["channelEnabled"] == false) {
                intents += Intent(Settings.ACTION_CHANNEL_NOTIFICATION_SETTINGS)
                    .putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName)
                    .putExtra(Settings.EXTRA_CHANNEL_ID, BackgroundWorkService.CHANNEL_ID)
            }
            intents += Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
                .putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName)
        }
        intents += Intent(
            Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
            Uri.parse("package:${context.packageName}")
        )

        var lastError: Throwable? = null
        for (intent in intents) {
            try {
                context.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                return mapOf("success" to true, "openedSettings" to true)
            } catch (error: Throwable) {
                lastError = error
            }
        }
        return mapOf(
            "success" to false,
            "openedSettings" to false,
            "output" to (lastError?.message ?: "Notification settings are unavailable"),
        )
    }

    private fun loadInstalled(): MutableMap<String, String> {
        val db = File(appContext.reactContext!!.filesDir, ".apt_installed.json")
        if (!db.exists()) return mutableMapOf()
        try {
            val map = mutableMapOf<String, String>()
            """"(\S+)"\s*:\s*"([^"]*)"""".toRegex().findAll(db.readText()).forEach { map[it.groupValues[1]] = it.groupValues[2] }
            return map
        } catch (_: Exception) { return mutableMapOf() }
    }

    private fun saveInstalled(installed: Map<String, String>) {
        val json = "{\n" + installed.entries.joinToString(",\n") { "  \"${it.key}\": \"${it.value}\"" } + "\n}"
        File(appContext.reactContext!!.filesDir, ".apt_installed.json").writeText(json)
    }

    override fun definition() = ModuleDefinition {
        Name("AptManager")

        AsyncFunction("isBootstrapInstalled") Coroutine { ->
            withContext(Dispatchers.IO) { isBootstrapInstalled() }
        }

        AsyncFunction("ensurePermissions") Coroutine { ->
            withContext(Dispatchers.IO) {
                ensurePermissions()
                mapOf("success" to true)
            }
        }

        AsyncFunction("getExecBinDir") Coroutine { ->
            withContext(Dispatchers.IO) {
                val appCtx = appContext.reactContext!!
                val execDir = appCtx.getDir("exec", android.content.Context.MODE_PRIVATE)
                val execBin = File(execDir, "bin")
                mapOf("path" to execBin.absolutePath)
            }
        }

        AsyncFunction("installBootstrap") Coroutine { ->
            withContext(Dispatchers.IO) {
                val log = StringBuilder()
                val ok = installBootstrap(log)
                mapOf("success" to ok, "output" to log.toString())
            }
        }

        AsyncFunction("install") Coroutine { packageName: String ->
            withContext(Dispatchers.IO) {
                val log = StringBuilder()

                if (!isBootstrapInstalled()) {
                    val bootstrapOk = installBootstrap(log)
                    if (!bootstrapOk) {
                        mapOf("success" to false, "output" to log.toString())
                    } else {
                        log.appendLine("")
                        log.appendLine("Installing $packageName...")
                        val result = runShellCmd("pkg install -y $packageName")
                        log.append(result["output"] as? String ?: "")
                        if (result["success"] == true) {
                            val installed = loadInstalled()
                            installed[packageName] = "installed"
                            saveInstalled(installed)
                            log.appendLine("✓ $packageName installed")
                        }
                        mapOf("success" to result["success"], "output" to log.toString())
                    }
                } else {
                    // Bootstrap уже установлен — убедиться что permissions правильные
                    ensurePermissions()
                    log.appendLine("Bootstrap already installed, permissions verified.")
                    log.appendLine("Installing $packageName...")
                    val result = runShellCmd("pkg install -y $packageName")
                    log.append(result["output"] as? String ?: "")
                    if (result["success"] == true) {
                        val installed = loadInstalled()
                        installed[packageName] = "installed"
                        saveInstalled(installed)
                        log.appendLine("✓ $packageName installed")
                    }
                    mapOf("success" to result["success"], "output" to log.toString())
                }
            }
        }

        AsyncFunction("remove") Coroutine { packageName: String ->
            withContext(Dispatchers.IO) {
                val result = runShellCmd("pkg uninstall -y $packageName")
                if (result["success"] == true) {
                    val installed = loadInstalled()
                    installed.remove(packageName)
                    saveInstalled(installed)
                }
                result
            }
        }

        AsyncFunction("search") Coroutine { query: String ->
            withContext(Dispatchers.IO) {
                if (!isBootstrapInstalled()) {
                    mapOf("success" to false, "output" to "Bootstrap not installed. Open Terminal to install.")
                } else {
                    runShellCmd("apt search $query")
                }
            }
        }

        AsyncFunction("info") Coroutine { packageName: String ->
            withContext(Dispatchers.IO) {
                if (!isBootstrapInstalled()) {
                    mapOf("success" to false, "output" to "Bootstrap not installed.")
                } else {
                    runShellCmd("apt show $packageName")
                }
            }
        }

        AsyncFunction("update") Coroutine { ->
            withContext(Dispatchers.IO) {
                if (!isBootstrapInstalled()) {
                    mapOf("success" to false, "output" to "Bootstrap not installed.")
                } else {
                    runShellCmd("apt update")
                }
            }
        }

        AsyncFunction("listInstalled") Coroutine { ->
            withContext(Dispatchers.IO) {
                val installed = loadInstalled()
                installed.entries.map { mapOf("name" to it.key, "version" to it.value) }
            }
        }

        AsyncFunction("getPrefix") Coroutine { ->
            withContext(Dispatchers.IO) { mapOf("prefix" to getPrefix()) }
        }

        AsyncFunction("getHome") Coroutine { ->
            withContext(Dispatchers.IO) { mapOf("home" to getHome()) }
        }

        // proot rootfs management
        AsyncFunction("isProotRootfsInstalled") Coroutine { ->
            withContext(Dispatchers.IO) { isProotRootfsInstalled() }
        }

        AsyncFunction("getProotRootfsDir") Coroutine { ->
            withContext(Dispatchers.IO) { mapOf("path" to getProotRootfsDir().absolutePath) }
        }

        AsyncFunction("installProotRootfs") Coroutine { url: String? ->
            withContext(Dispatchers.IO) {
                val ctx = appContext.reactContext
                    ?: throw IllegalStateException("React context is unavailable")
                RootfsInstallSupervisor.enqueue(ctx, url)
                // This promise is only an observer. If React/activity disappears, the foreground
                // service keeps the persisted installer alive and a later call reattaches to it.
                RootfsInstallSupervisor.await(ctx)
            }
        }

        AsyncFunction("deleteRootfs") Coroutine { ->
            withContext(Dispatchers.IO) {
                val ctx = appContext.reactContext
                    ?: return@withContext mapOf("success" to false, "deleted" to false)
                if (RootfsInstallSupervisor.hasPending(ctx)) {
                    return@withContext mapOf("success" to false, "deleted" to false, "output" to "Rootfs installation is active")
                }
                val dir = getProotRootfsDir()
                val existed = dir.exists()
                try { dir.deleteRecursively() } catch (_: Exception) {}
                mapOf("success" to true, "deleted" to existed)
            }
        }

        AsyncFunction("getRootfsProgress") Coroutine { ->
            withContext(Dispatchers.IO) {
                val ctx = appContext.reactContext
                if (ctx != null) RootfsInstallSupervisor.progress(ctx)
                else mapOf("stage" to "idle", "url" to "", "downloadedBytes" to 0L, "totalBytes" to 0L, "message" to "")
            }
        }

        // RAI bundle: copy assets/rai/rai.sh from the APK into the rootfs
        AsyncFunction("seedRaiBundle") Coroutine { ->
            withContext(Dispatchers.IO) { seedRaiBundle() }
        }

        // Shared storage ("память") — All files access (API 30+) / legacy dialog
        AsyncFunction("hasAllFilesAccess") Coroutine { ->
            withContext(Dispatchers.IO) { hasAllFilesAccess() }
        }

        AsyncFunction("openAllFilesAccessSettings") Coroutine { ->
            withContext(Dispatchers.Main) {
                val ctx = appContext.reactContext
                if (ctx == null) return@withContext mapOf("success" to false, "output" to "no context")
                val intent = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                    Intent(
                        Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION,
                        Uri.parse("package:${ctx.packageName}")
                    )
                } else {
                    Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:${ctx.packageName}"))
                }
                try {
                    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                    ctx.startActivity(intent)
                    mapOf("success" to true)
                } catch (e: Exception) {
                    try {
                        val fallback = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:${ctx.packageName}"))
                            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                        ctx.startActivity(fallback)
                        mapOf("success" to true)
                    } catch (e2: Exception) {
                        mapOf("success" to false, "output" to (e2.message ?: e2.toString()))
                    }
                }
            }
        }

        AsyncFunction("requestStoragePermissions") Coroutine { ->
            withContext(Dispatchers.Main) {
                val activity = appContext.currentActivity
                if (activity != null) {
                    val perms = when {
                        Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU -> arrayOf(
                            Manifest.permission.READ_MEDIA_IMAGES,
                            Manifest.permission.READ_MEDIA_VIDEO,
                            Manifest.permission.READ_MEDIA_AUDIO,
                        )
                        Build.VERSION.SDK_INT >= Build.VERSION_CODES.M -> arrayOf(
                            Manifest.permission.READ_EXTERNAL_STORAGE,
                            Manifest.permission.WRITE_EXTERNAL_STORAGE,
                        )
                        else -> emptyArray()
                    }
                    if (perms.isNotEmpty()) {
                        ActivityCompat.requestPermissions(activity, perms, 4310)
                    }
                }
                mapOf("success" to true)
            }
        }

        // Notification access across Android 7+ (runtime permission + app switch + channel).
        AsyncFunction("initializeNotifications") Coroutine { ->
            withContext(Dispatchers.Main) {
                val ctx = appContext.reactContext
                if (ctx != null) BackgroundWorkService.ensureNotificationChannel(ctx)
                mapOf("success" to (ctx != null))
            }
        }

        AsyncFunction("getNotificationsPermissionStatus") Coroutine { ->
            withContext(Dispatchers.IO) {
                val ctx = appContext.reactContext
                if (ctx != null) notificationPermissionStatus(ctx)
                else mutableMapOf(
                    "granted" to false,
                    "apiLevel" to Build.VERSION.SDK_INT,
                    "runtimePermissionRequired" to (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU),
                    "runtimeGranted" to false,
                    "appNotificationsEnabled" to false,
                    "channelCreated" to false,
                    "channelEnabled" to false,
                    "blockingReason" to "unavailable",
                )
            }
        }

        // Backward-compatible name used by older JS bundles; now returns the complete status.
        AsyncFunction("hasNotificationsPermission") Coroutine { ->
            withContext(Dispatchers.IO) {
                val ctx = appContext.reactContext
                if (ctx != null) notificationPermissionStatus(ctx)
                else mapOf("granted" to false, "blockingReason" to "unavailable")
            }
        }

        AsyncFunction("openNotificationSettings") Coroutine { ->
            withContext(Dispatchers.Main) {
                val ctx = appContext.reactContext
                if (ctx != null) openNotificationSettings(ctx)
                else mapOf("success" to false, "openedSettings" to false, "output" to "no context")
            }
        }

        // Resolve only after Android delivers the user's decision. On Android 7-12 there is no
        // POST_NOTIFICATIONS dialog; if an app/channel switch is off, Settings is the only fix.
        AsyncFunction("requestNotificationsPermission") { promise: Promise ->
            val ctx = appContext.reactContext
            if (ctx == null) {
                promise.reject("E_NO_CONTEXT", "React context is unavailable", null)
                return@AsyncFunction
            }
            BackgroundWorkService.ensureNotificationChannel(ctx)
            val before = notificationPermissionStatus(ctx)

            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
                if (before["granted"] != true) before.putAll(openNotificationSettings(ctx))
                before["status"] = if (before["granted"] == true) "granted" else "denied"
                promise.resolve(before)
                return@AsyncFunction
            }

            if (before["runtimeGranted"] == true) {
                // Re-requesting cannot repair a globally disabled app or channel.
                if (before["granted"] != true) before.putAll(openNotificationSettings(ctx))
                before["status"] = if (before["granted"] == true) "granted" else "denied"
                before["canAskAgain"] = false
                promise.resolve(before)
                return@AsyncFunction
            }

            val permissions = appContext.permissions
            if (permissions == null) {
                promise.reject("E_NO_PERMISSIONS", "Permissions module is unavailable", null)
                return@AsyncFunction
            }
            permissions.askForPermissions(
                PermissionsResponseListener { responses ->
                    val response = responses[Manifest.permission.POST_NOTIFICATIONS]
                    val after = notificationPermissionStatus(ctx)
                    after["status"] = response?.status?.status ?: if (after["granted"] == true) "granted" else "denied"
                    after["canAskAgain"] = response?.canAskAgain ?: false
                    promise.resolve(after)
                },
                Manifest.permission.POST_NOTIFICATIONS,
            )
        }

        // Foreground service — keeps the process alive while install/build runs in background
        AsyncFunction("startBackgroundService") Coroutine { text: String ->
            withContext(Dispatchers.Main) {
                val ctx = appContext.reactContext
                if (ctx != null) BackgroundWorkService.start(ctx, text)
                mapOf("success" to true)
            }
        }

        AsyncFunction("updateBackgroundService") Coroutine { text: String ->
            withContext(Dispatchers.Main) {
                val ctx = appContext.reactContext
                if (ctx != null) BackgroundWorkService.update(ctx, text)
                mapOf("success" to true)
            }
        }

        AsyncFunction("stopBackgroundService") Coroutine { ->
            withContext(Dispatchers.Main) {
                val ctx = appContext.reactContext
                if (ctx != null) BackgroundWorkService.stop(ctx)
                mapOf("success" to true)
            }
        }

        AsyncFunction("getBackgroundServiceStatus") Coroutine { ->
            withContext(Dispatchers.IO) {
                val ctx = appContext.reactContext
                if (ctx != null) BackgroundWorkService.status(ctx)
                else mapOf("active" to false, "text" to "", "jobId" to "")
            }
        }

        // Durable proot command API. Unlike TerminalView/execute(), these commands belong to the
        // foreground service and survive React Native teardown or complete app-process recreation.
        AsyncFunction("startDetachedJob") Coroutine {
                command: String, workDir: String?, label: String, kind: String, metadata: String? ->
            withContext(Dispatchers.IO) {
                val ctx = appContext.reactContext
                    ?: throw IllegalStateException("React context is unavailable")
                DetachedJobSupervisor.enqueue(ctx, command, workDir, label, kind, metadata)
            }
        }

        AsyncFunction("getDetachedJob") Coroutine { id: String ->
            withContext(Dispatchers.IO) {
                val ctx = appContext.reactContext
                if (ctx != null) DetachedJobSupervisor.status(ctx, id)
                else mapOf("exists" to false, "id" to id, "status" to "missing")
            }
        }

        AsyncFunction("getCurrentDetachedJob") Coroutine { ->
            withContext(Dispatchers.IO) {
                val ctx = appContext.reactContext
                if (ctx != null) DetachedJobSupervisor.current(ctx)
                else mapOf("exists" to false, "status" to "idle")
            }
        }

        AsyncFunction("readDetachedJobLog") Coroutine { id: String, offset: Double, maxBytes: Int ->
            withContext(Dispatchers.IO) {
                val ctx = appContext.reactContext
                if (ctx != null) DetachedJobSupervisor.readLog(ctx, id, offset.toLong(), maxBytes)
                else mapOf("text" to "", "nextOffset" to 0L, "done" to true)
            }
        }

        AsyncFunction("stopDetachedJob") Coroutine { id: String ->
            withContext(Dispatchers.IO) {
                val ctx = appContext.reactContext
                if (ctx != null) DetachedJobSupervisor.stop(ctx, id)
                else mapOf("success" to false, "id" to id)
            }
        }

        AsyncFunction("isIgnoringBatteryOptimizations") Coroutine { ->
            withContext(Dispatchers.IO) {
                val ctx = appContext.reactContext
                if (ctx == null || Build.VERSION.SDK_INT < Build.VERSION_CODES.M) true
                else {
                    val pm = ctx.getSystemService(android.content.Context.POWER_SERVICE) as PowerManager
                    pm.isIgnoringBatteryOptimizations(ctx.packageName)
                }
            }
        }

        AsyncFunction("openBatteryOptimizationSettings") Coroutine { ->
            withContext(Dispatchers.Main) {
                val ctx = appContext.reactContext
                if (ctx == null || Build.VERSION.SDK_INT < Build.VERSION_CODES.M) {
                    mapOf("success" to false, "output" to "Not available")
                } else try {
                    ctx.startActivity(
                        Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)
                            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                    )
                    mapOf("success" to true)
                } catch (e: Exception) {
                    mapOf("success" to false, "output" to (e.message ?: e.toString()))
                }
            }
        }

        AsyncFunction("canInstallApks") Coroutine { ->
            val context = appContext.reactContext!!
            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
                context.packageManager.canRequestPackageInstalls()
            } else true
        }

        AsyncFunction("installApk") Coroutine { linuxPath: String ->
            withContext(Dispatchers.Main) {
                val context = appContext.reactContext!!
                if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O && !context.packageManager.canRequestPackageInstalls()) {
                    val settingsIntent = Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${context.packageName}"))
                        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                    context.startActivity(settingsIntent)
                    return@withContext mapOf("success" to false, "output" to "Allow APK installation for NovaCompose Studio, then press Install again.")
                }
                // rai runs inside the Termux bootstrap (the apt-manager shell),
                // so its projects land in /data/data/<pkg>/files/home/projects/...
                // (Termux HOME) — not inside the proot Ubuntu rootfs. The
                // editor sends absolute proot-style paths like
                // /root/projects/<name>/...; resolve them against BOTH possible
                // roots so the user can install whatever rai actually produced.
                val candidateFiles = mutableListOf<File>()
                if (linuxPath.startsWith("/root/") || linuxPath.startsWith("/home/") || linuxPath.startsWith("/opt/")) {
                    val rel = linuxPath.removePrefix("/")
                    candidateFiles += File(getProotRootfsDir(), rel)
                    candidateFiles += File(getHome(), rel)
                    candidateFiles += File(getPrefix(), rel)
                } else {
                    candidateFiles += File(linuxPath)
                }
                val file = candidateFiles.firstOrNull { it.isFile }
                if (file == null) {
                    val hint = if (linuxPath.contains("/projects/") && linuxPath.endsWith(".apk")) {
                        "Build the project with \"rai build\" first. Compose sources from the editor are not yet compiled into an APK."
                    } else {
                        "Check the file path; the APK file is missing."
                    }
                    val probed = candidateFiles.joinToString("\n  ") { it.absolutePath }
                    return@withContext mapOf(
                        "success" to false,
                        "output" to "$hint\nTried:\n  $probed",
                    )
                }
                try {
                    val authority = "${context.packageName}.aptmanager.fileprovider"
                    val uri = FileProvider.getUriForFile(context, authority, file)
                    val intent = Intent(Intent.ACTION_VIEW)
                        .setDataAndType(uri, "application/vnd.android.package-archive")
                        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_GRANT_READ_URI_PERMISSION)
                    context.startActivity(intent)
                    mapOf("success" to true, "output" to file.absolutePath)
                } catch (e: Exception) {
                    mapOf("success" to false, "output" to (e.message ?: e.toString()))
                }
            }
        }

        AsyncFunction("launchPackage") Coroutine { packageName: String ->
            withContext(Dispatchers.Main) {
                val context = appContext.reactContext!!
                val intent = context.packageManager.getLaunchIntentForPackage(packageName)
                if (intent == null) mapOf("success" to false, "output" to "Package is not installed: $packageName")
                else {
                    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                    context.startActivity(intent)
                    mapOf("success" to true, "output" to packageName)
                }
            }
        }

        // Renders the visual project with a real off-screen ComposeView and
        // Material 3 composables. This deliberately does not use the former
        // LinearLayout/CardView bitmap substitute.
        AsyncFunction("renderComposePreview") Coroutine { payload: Map<String, Any> ->
            withContext(Dispatchers.Main) {
                try {
                    val tree = (payload["tree"] as? String) ?: return@withContext mapOf(
                        "success" to false, "output" to "tree is missing"
                    )
                    val widthPx = (payload["widthPx"] as? Number)?.toInt() ?: 720
                    val heightPx = (payload["heightPx"] as? Number)?.toInt() ?: 4000
                    val isDark = (payload["isDark"] as? Boolean) ?: false
                    val background = payload["backgroundColor"] as? String
                    val activity = appContext.currentActivity
                        ?: return@withContext mapOf("success" to false, "output" to "Preview requires an active IDE activity")
                    val config = ComposeRuntimePreview.PreviewConfig(
                        widthPx = widthPx,
                        heightPx = heightPx,
                        dark = isDark,
                        backgroundColor = background,
                        density = (payload["density"] as? Number)?.toFloat() ?: 2.625f,
                        projectPrimary = payload["projectPrimary"] as? String,
                        projectSecondary = payload["projectSecondary"] as? String,
                        projectBackground = payload["projectBackground"] as? String,
                        simulateState = (payload["simulateState"] as? Boolean) ?: true,
                        interactive = (payload["interactive"] as? Boolean) ?: false,
                        actionBarTitle = payload["actionBarTitle"] as? String,
                        showActionBar = (payload["showActionBar"] as? Boolean) ?: true,
                        lightScheme = stringMapOf(payload["lightScheme"] as? String),
                        darkScheme = stringMapOf(payload["darkScheme"] as? String),
                    )

                    val base64 = ComposeRuntimePreview.render(
                        activity = activity,
                        treeJson = tree,
                        config = config,
                    )
                    mapOf("success" to true, "base64" to base64, "output" to "ok")
                } catch (e: Throwable) {
                    mapOf("success" to false, "output" to (e.message ?: e.toString()))
                }
            }
        }

        AsyncFunction("whichCommand") Coroutine { command: String ->
            withContext(Dispatchers.IO) {
                val prefix = getPrefix()
                val binPath = File(prefix, "bin/$command")
                if (binPath.exists() && binPath.canExecute()) {
                    mapOf("exists" to true, "path" to binPath.absolutePath)
                } else {
                    try {
                        val p = ProcessBuilder("sh", "-c", "PATH=\"$prefix/bin:\$PATH\" which $command 2>/dev/null")
                            .redirectErrorStream(true).start()
                        val path = p.inputStream.bufferedReader().readText().trim()
                        p.waitFor()
                        mapOf("exists" to (p.exitValue() == 0 && path.isNotEmpty()), "path" to path)
                    } catch (_: Exception) {
                        mapOf("exists" to false, "path" to "")
                    }
                }
            }
        }
    }
}
