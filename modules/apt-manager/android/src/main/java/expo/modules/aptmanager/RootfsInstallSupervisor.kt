package expo.modules.aptmanager

import android.content.Context
import android.content.Intent
import android.os.Build
import expo.modules.termuxterminal.ProotEnvironment
import org.apache.commons.compress.archivers.tar.TarArchiveInputStream
import org.apache.commons.compress.compressors.gzip.GzipCompressorInputStream
import org.json.JSONObject
import java.io.BufferedInputStream
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.net.HttpURLConnection
import java.net.URL

/**
 * App-owned, persisted rootfs installer.
 *
 * The old implementation lived in an Expo coroutine. Android could therefore kill the React
 * process midway through a download/extraction and no native owner knew how to resume it. This
 * supervisor persists intent/progress before starting, runs under [BackgroundWorkService], resumes
 * HTTP downloads with Range, and replays extraction/preparation after complete process death.
 */
object RootfsInstallSupervisor {
    private const val DEFAULT_URL =
        "https://github.com/wfllive/rootfs/releases/download/1.0/ubuntu-rootfs.tar.gz"
    private val lock = Any()
    @Volatile private var worker: Thread? = null

    private fun dir(context: Context) = File(context.applicationContext.filesDir, "rootfs-install").apply { mkdirs() }
    private fun stateFile(context: Context) = File(dir(context), "state.json")
    private fun logFile(context: Context) = File(dir(context), "install.log")
    private fun archiveFile(context: Context) = File(dir(context), "rootfs.tar.gz.part")
    private fun stagingDir(context: Context) = File(context.applicationContext.filesDir, "proot/rootfs.installing")
    private fun finalDir(context: Context) = ProotEnvironment.rootfsDir(context.applicationContext)

    private fun read(context: Context): JSONObject? = try {
        val file = stateFile(context)
        if (file.isFile) JSONObject(file.readText()) else null
    } catch (_: Exception) { null }

    private fun persist(context: Context, state: JSONObject) {
        state.put("updatedAt", System.currentTimeMillis())
        val file = stateFile(context)
        val tmp = File(file.parentFile, "${file.name}.tmp")
        tmp.writeText(state.toString())
        if (!tmp.renameTo(file)) {
            file.writeText(state.toString())
            tmp.delete()
        }
        syncLegacyProgress(state)
    }

    private fun syncLegacyProgress(state: JSONObject) {
        RootfsProgress.stage = state.optString("stage", "idle")
        RootfsProgress.currentUrl = state.optString("url")
        RootfsProgress.downloadedBytes = state.optLong("downloadedBytes")
        RootfsProgress.totalBytes = state.optLong("totalBytes")
        RootfsProgress.message = state.optString("message")
    }

    private fun isActive(state: JSONObject?): Boolean =
        state?.optString("status") in setOf("queued", "running")

    fun enqueue(context: Context, requestedUrl: String?): Map<String, Any?> {
        val appCtx = context.applicationContext
        val url = requestedUrl?.takeIf { it.isNotBlank() } ?: DEFAULT_URL
        synchronized(lock) {
            val existing = read(appCtx)
            if (isActive(existing)) {
                ensureWorker(appCtx)
                startService(appCtx)
                return toMap(existing!!, true)
            }
            // Android 15+ may pause dataSync foreground work after its rolling six-hour budget.
            // A later explicit retry resumes the persisted archive/stage instead of deleting it.
            if (existing?.optString("status") == "paused") {
                // Do not clear the pause marker until the interrupted owner has really exited.
                // Otherwise its final callback could overwrite a newly queued retry.
                if (worker?.isAlive == true) return toMap(existing, true)
                existing.put("status", "queued")
                    .put("message", "Возобновление установки...")
                    .remove("error")
                persist(appCtx, existing)
                startService(appCtx)
                ensureWorker(appCtx)
                return toMap(existing, true)
            }
            val state = JSONObject()
                .put("status", "queued")
                .put("stage", "connecting")
                .put("url", url)
                .put("downloadedBytes", 0L)
                .put("totalBytes", 0L)
                .put("message", "Подключение...")
                .put("attempt", 0)
                .put("createdAt", System.currentTimeMillis())
            logFile(appCtx).writeText("")
            archiveFile(appCtx).delete()
            stagingDir(appCtx).deleteRecursively()
            persist(appCtx, state)
            startService(appCtx)
            ensureWorker(appCtx)
            return toMap(state, false)
        }
    }

    fun resumeIfNeeded(context: Context) {
        val appCtx = context.applicationContext
        synchronized(lock) {
            val state = read(appCtx) ?: return
            syncLegacyProgress(state)
            if (isActive(state)) ensureWorker(appCtx)
        }
    }

    fun hasPending(context: Context): Boolean = synchronized(lock) { isActive(read(context.applicationContext)) }

    fun pauseForSystemLimit(context: Context, reason: String) {
        val appCtx = context.applicationContext
        synchronized(lock) {
            val current = read(appCtx) ?: return
            if (!isActive(current)) return
            current.put("status", "paused")
                .put("message", reason)
                .put("error", reason)
            persist(appCtx, current)
            worker?.interrupt()
        }
        appendLog(appCtx, reason)
    }

    fun pendingLabel(context: Context): String = synchronized(lock) {
        read(context.applicationContext)?.optString("message")?.ifBlank { "Installing Ubuntu rootfs" }
            ?: "Installing Ubuntu rootfs"
    }

    fun progress(context: Context): Map<String, Any?> = synchronized(lock) {
        val state = read(context.applicationContext)
        if (state == null) {
            mapOf(
                "stage" to "idle", "url" to "", "downloadedBytes" to 0L,
                "totalBytes" to 0L, "message" to "", "status" to "idle"
            )
        } else toMap(state)
    }

    fun await(context: Context): Map<String, Any?> {
        val appCtx = context.applicationContext
        while (true) {
            val state = synchronized(lock) { read(appCtx) }
                ?: return mapOf("success" to false, "output" to "Rootfs install state disappeared")
            if (!isActive(state)) {
                val output = try { logFile(appCtx).readText() } catch (_: Exception) { state.optString("message") }
                return mapOf(
                    "success" to (state.optString("status") == "succeeded"),
                    "output" to output,
                    "status" to state.optString("status"),
                )
            }
            try { Thread.sleep(400) } catch (_: InterruptedException) {
                return mapOf("success" to false, "output" to "Observer interrupted; native installation continues")
            }
        }
    }

    private fun ensureWorker(context: Context) {
        if (worker?.isAlive == true) return
        val appCtx = context.applicationContext
        worker = Thread({ run(appCtx) }, "nova-rootfs-installer").also { it.start() }
    }

    private fun run(context: Context) {
        val state = synchronized(lock) {
            val current = read(context) ?: return
            if (!isActive(current)) return
            current.put("status", "running")
                .put("attempt", current.optInt("attempt") + 1)
            persist(context, current)
            current
        }
        appendLog(context, "=== rootfs install attempt ${state.optInt("attempt")} ===")
        try {
            val engine = RootfsInstallEngine(
                context = context,
                archive = archiveFile(context),
                staging = stagingDir(context),
                destination = finalDir(context),
                update = { stage, downloaded, total, message ->
                    if (Thread.currentThread().isInterrupted) throw InterruptedException("Rootfs install paused")
                    synchronized(lock) {
                        val current = read(context) ?: state
                        if (current.optString("status") == "paused") {
                            throw InterruptedException("Rootfs install paused")
                        }
                        current.put("stage", stage)
                            .put("downloadedBytes", downloaded)
                            .put("totalBytes", total)
                            .put("message", message)
                        persist(context, current)
                    }
                    BackgroundWorkService.update(context, message)
                },
                log = { appendLog(context, it) },
            )
            val ok = engine.install(state.optString("url"), state.optString("stage"))
            synchronized(lock) {
                val current = read(context) ?: state
                current.put("status", if (ok) "succeeded" else "failed")
                    .put("stage", if (ok) "done" else "failed")
                    .put("message", if (ok) "Готово" else "Rootfs installation failed")
                persist(context, current)
            }
        } catch (error: Throwable) {
            synchronized(lock) {
                val current = read(context) ?: state
                if (current.optString("status") != "paused") {
                    appendLog(context, "Error: ${error.message ?: error}")
                    current.put("status", "failed")
                        .put("stage", "failed")
                        .put("message", "Error: ${error.message ?: error}")
                        .put("error", error.message ?: error.toString())
                    persist(context, current)
                }
            }
        } finally {
            worker = null
            val intent = Intent(context, BackgroundWorkService::class.java)
                .setAction(BackgroundWorkService.ACTION_FINISH_JOB)
            try { context.startService(intent) } catch (_: Exception) {}
        }
    }

    private fun appendLog(context: Context, line: String) {
        try { logFile(context).appendText(line + "\n") } catch (_: Exception) {}
    }

    private fun startService(context: Context) {
        val intent = Intent(context, BackgroundWorkService::class.java)
            .setAction(BackgroundWorkService.ACTION_RUN_ROOTFS)
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) context.startForegroundService(intent)
            else context.startService(intent)
        } catch (_: Exception) {}
    }

    private fun toMap(state: JSONObject, reused: Boolean? = null): Map<String, Any?> {
        val result = mutableMapOf<String, Any?>(
            "status" to state.optString("status", "idle"),
            "stage" to state.optString("stage", "idle"),
            "url" to state.optString("url"),
            "downloadedBytes" to state.optLong("downloadedBytes"),
            "totalBytes" to state.optLong("totalBytes"),
            "message" to state.optString("message"),
            "attempt" to state.optInt("attempt"),
            "createdAt" to state.optLong("createdAt"),
            "updatedAt" to state.optLong("updatedAt"),
        )
        if (reused != null) result["reused"] = reused
        if (state.has("error")) result["error"] = state.optString("error")
        return result
    }
}

private class RootfsInstallEngine(
    context: Context,
    private val archive: File,
    private val staging: File,
    private val destination: File,
    private val update: (stage: String, downloaded: Long, total: Long, message: String) -> Unit,
    private val log: (String) -> Unit,
) {
    private val appContext = context.applicationContext

    fun install(url: String, resumeStage: String): Boolean {
        // A process death during the final preparation leaves a complete destination. Continue
        // preparation directly instead of downloading/extracting the image again.
        if (resumeStage == "preparing" && isComplete(destination)) {
            return prepare()
        }
        if (resumeStage == "committing" && isComplete(staging)) {
            commit()
            return prepare()
        }

        if (!download(url)) return false
        extract()
        configure(staging)
        update("committing", archive.length(), archive.length(), "Завершение распаковки...")
        commit()
        return prepare()
    }

    private fun download(urlString: String): Boolean {
        archive.parentFile?.mkdirs()
        var existing = archive.takeIf { it.isFile }?.length() ?: 0L
        update("connecting", existing, 0L, "Подключение...")
        log("Downloading rootfs: $urlString")

        var url = URL(urlString)
        var redirects = 0
        while (true) {
            val connection = url.openConnection() as HttpURLConnection
            connection.connectTimeout = 15_000
            connection.readTimeout = 120_000
            connection.instanceFollowRedirects = false
            if (existing > 0L) connection.setRequestProperty("Range", "bytes=$existing-")
            val code = connection.responseCode
            if (code in listOf(301, 302, 303, 307, 308) && redirects < 10) {
                val location = connection.getHeaderField("Location") ?: return false
                url = URL(url, location)
                redirects++
                connection.disconnect()
                continue
            }
            if (code == 416 && existing > 0L) {
                log("Download already complete (${existing / 1024 / 1024} MB)")
                return true
            }
            if (code != 200 && code != 206) {
                log("Download failed: HTTP $code")
                return false
            }
            val append = code == 206 && existing > 0L
            if (!append) existing = 0L
            val remaining = connection.contentLengthLong.coerceAtLeast(0L)
            val total = if (remaining > 0L) existing + remaining else 0L
            var downloaded = existing
            update("downloading", downloaded, total, "Загрузка...")
            connection.inputStream.use { input ->
                FileOutputStream(archive, append).use { output ->
                    val buffer = ByteArray(32 * 1024)
                    var lastPersistedAt = 0L
                    while (true) {
                        val count = input.read(buffer)
                        if (count < 0) break
                        output.write(buffer, 0, count)
                        downloaded += count
                        val now = System.currentTimeMillis()
                        if (now - lastPersistedAt >= 500L) {
                            update("downloading", downloaded, total, "Загрузка...")
                            lastPersistedAt = now
                        }
                    }
                    output.fd.sync()
                }
            }
            connection.disconnect()
            update("downloading", downloaded, total, "Загрузка завершена")
            log("Downloaded: ${archive.length() / 1024 / 1024} MB")
            return archive.length() > 0L
        }
    }

    private fun extract() {
        update("extracting", archive.length(), archive.length(), "Распаковка...")
        staging.deleteRecursively()
        staging.mkdirs()
        val root = staging.canonicalPath + File.separator
        var count = 0
        TarArchiveInputStream(
            GzipCompressorInputStream(BufferedInputStream(FileInputStream(archive)))
        ).use { tar ->
            var entry = tar.nextTarEntry
            while (entry != null) {
                val name = entry.name.removePrefix("./")
                if (name.isNotEmpty()) {
                    val out = File(staging, name)
                    if (out.canonicalPath.startsWith(root)) {
                        when {
                            entry.isDirectory -> out.mkdirs()
                            entry.isSymbolicLink -> {
                                out.parentFile?.mkdirs()
                                out.delete()
                                try { android.system.Os.symlink(entry.linkName, out.absolutePath) } catch (_: Exception) {}
                                count++
                            }
                            entry.isLink -> {
                                out.parentFile?.mkdirs()
                                val target = File(staging, entry.linkName.removePrefix("./"))
                                if (target.canonicalPath.startsWith(root) && target.exists()) {
                                    try { android.system.Os.link(target.absolutePath, out.absolutePath) } catch (_: Exception) {}
                                }
                                count++
                            }
                            else -> {
                                out.parentFile?.mkdirs()
                                FileOutputStream(out).use { tar.copyTo(it) }
                                if (entry.mode and 0b001001001 != 0) out.setExecutable(true, false)
                                count++
                            }
                        }
                    }
                }
                if (count % 250 == 0) {
                    update("extracting", archive.length(), archive.length(), "Распаковка: $count файлов")
                }
                entry = tar.nextTarEntry
            }
        }
        if (!isComplete(staging)) throw IllegalStateException("Extracted rootfs is incomplete")
        log("Extracted $count files")
    }

    private fun configure(rootfs: File) {
        val etc = File(rootfs, "etc").apply { mkdirs() }
        val resolv = File(etc, "resolv.conf")
        try { resolv.delete() } catch (_: Exception) {}
        resolv.writeText("nameserver 8.8.8.8\nnameserver 1.1.1.1\n")

        listOf(
            "var/lib/dpkg/updates", "var/lib/dpkg/info", "var/lib/apt/lists/partial",
            "var/cache/apt/archives/partial", "var/log/apt", "run/lock", "run",
            "dev/shm", "tmp", "var/tmp"
        ).forEach { File(rootfs, it).mkdirs() }
        val aptConf = File(rootfs, "etc/apt/apt.conf.d/00proot")
        aptConf.parentFile?.mkdirs()
        aptConf.writeText(
            "APT::Sandbox::User \"root\";\n" +
                "DPkg::Options { \"--force-confdef\"; \"--force-confold\"; };\n" +
                "Acquire::http::Pipeline-Depth \"0\";\nAcquire::Retries \"3\";\n"
        )
        val policy = File(rootfs, "usr/sbin/policy-rc.d")
        policy.parentFile?.mkdirs()
        if (!policy.exists()) policy.writeText("#!/bin/sh\nexit 101\n")
        policy.setExecutable(true, false)
        writeAptSourcesIfMissing(rootfs)
        log("Configured DNS and proot apt/dpkg defaults")
    }

    private fun writeAptSourcesIfMissing(rootfs: File) {
        val sourcesDir = File(rootfs, "etc/apt/sources.list.d")
        val candidates = mutableListOf(File(rootfs, "etc/apt/sources.list"))
        sourcesDir.listFiles()?.filterTo(candidates) { it.isFile }
        val hasSources = candidates.filter { it.isFile }.any { file ->
            try {
                file.readLines().any { line ->
                    val text = line.trimStart()
                    !text.startsWith("#") &&
                        (text.startsWith("deb ") || text.startsWith("URIs:") || text.startsWith("Types:"))
                }
            } catch (_: Exception) { false }
        }
        if (hasSources) return
        var codename = "noble"
        try {
            File(rootfs, "etc/os-release").readLines().forEach { line ->
                if (line.startsWith("VERSION_CODENAME=")) codename = line.substringAfter('=').trim().ifBlank { "noble" }
            }
        } catch (_: Exception) {}
        val mirror = "http://ports.ubuntu.com/ubuntu-ports"
        sourcesDir.mkdirs()
        File(sourcesDir, "ubuntu-proot.list").writeText(
            "deb $mirror $codename main restricted universe multiverse\n" +
                "deb $mirror ${codename}-updates main restricted universe multiverse\n" +
                "deb $mirror ${codename}-security main restricted universe multiverse\n"
        )
    }

    private fun commit() {
        destination.parentFile?.mkdirs()
        destination.deleteRecursively()
        if (!staging.renameTo(destination)) {
            staging.copyRecursively(destination, overwrite = true)
            staging.deleteRecursively()
        }
        if (!isComplete(destination)) throw IllegalStateException("Could not commit extracted rootfs")
    }

    private fun prepare(): Boolean {
        update("preparing", archive.length(), archive.length(), "Настройка apt/dpkg...")
        try {
            val result = ProotEnvironment.prepareRootfs(appContext, true, 300_000L)
            log("apt/dpkg preparation exit=${result.first}")
            log(result.second)
        } catch (error: Exception) {
            // Preparation remains repairable from the terminal and was non-fatal in the old path.
            log("apt/dpkg preparation warning: ${error.message}")
        }
        val ok = isComplete(destination)
        if (ok) archive.delete()
        return ok
    }

    private fun isComplete(dir: File): Boolean =
        File(dir, "bin").isDirectory || File(dir, "usr/bin").isDirectory
}
