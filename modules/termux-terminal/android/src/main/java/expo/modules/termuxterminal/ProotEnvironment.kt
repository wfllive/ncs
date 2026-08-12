package expo.modules.termuxterminal

import android.content.Context
import android.util.Log
import kotlin.jvm.Volatile
import java.io.File
import java.io.FileInputStream

/**
 * proot environment with EXTERNAL loader in nativeLibraryDir.
 *
 * Layout:
 *  - proot main binary : <nativeLibraryDir>/libproot.so         (dynamic, bionic-only)
 *  - proot loader ELF  : <nativeLibraryDir>/libproot-loader.so  (static aarch64 ELF)
 *  - rootfs            : <filesDir>/proot/rootfs/
 *
 * Why external loader:
 *   On strict Android SELinux policies (Huawei/EMUI), proot's default behaviour of
 *   extracting an embedded loader ELF into PROOT_TMP_DIR and execve()-ing it fails
 *   with "Permission denied" (SELinux blocks exec of newly-written ELFs from app
 *   data). nativeLibraryDir is the ONE place where the SELinux policy for untrusted
 *   apps allows execute_no_trans on ELF files. So we ship the loader there and set
 *   PROOT_LOADER to point at it.
 */
object ProotEnvironment {

    private const val TAG = "TermuxProot"

    fun nativeLibDir(context: Context): String =
        context.applicationContext.applicationInfo.nativeLibraryDir

    fun prootBinary(context: Context): File =
        File(nativeLibDir(context), "libproot.so")

    fun loaderBinary(context: Context): File =
        File(nativeLibDir(context), "libproot-loader.so")

    fun rootfsDir(context: Context): File =
        File(context.applicationContext.filesDir, "proot/rootfs")

    fun isRootfsInstalled(context: Context): Boolean =
        File(rootfsDir(context), "bin").isDirectory ||
            File(rootfsDir(context), "usr/bin").isDirectory

    fun isProotBinaryAvailable(context: Context): Boolean =
        prootBinary(context).exists()

    fun isLoaderAvailable(context: Context): Boolean =
        loaderBinary(context).exists()

    fun isReady(context: Context): Boolean =
        isProotBinaryAvailable(context) && isRootfsInstalled(context)

    private fun elfBits(f: File): Int? {
        return try {
            val b = ByteArray(5)
            val n = FileInputStream(f).use { it.read(b) }
            if (n < 5) return null
            if (
                b[0] == 0x7f.toByte() &&
                b[1] == 'E'.code.toByte() &&
                b[2] == 'L'.code.toByte() &&
                b[3] == 'F'.code.toByte()
            ) {
                when (b[4]) {
                    2.toByte() -> 64
                    1.toByte() -> 32
                    else -> null
                }
            } else null
        } catch (_: Exception) {
            null
        }
    }

    fun prootArch(context: Context): Int? = elfBits(prootBinary(context))

    fun rootfsArch(context: Context): Int? {
        val rootfs = rootfsDir(context)
        return listOf(
            "usr/bin/ls", "bin/ls",
            "usr/bin/sh", "bin/sh",
            "usr/bin/bash", "bin/bash",
            "usr/bin/coreutils"
        ).firstNotNullOfOrNull { rel ->
            val f = File(rootfs, rel)
            if (f.exists()) elfBits(f) else null
        }
    }

    data class ProotConfig(
        val prootPath: String,
        val args: Array<String>,
        val env: Array<String>,
        val cwd: String
    )

    data class ProcessConfig(
        val program: String,
        val argv: List<String>,
        val env: Map<String, String>,
        val cwd: String
    )

    /**
     * Find a writable+exec directory. Even with external PROOT_LOADER, proot still
     * needs a tmp dir for other files (glue rootfs paths etc).
     */
    fun findExecTmpDir(context: Context): File {
        val appCtx = context.applicationContext
        val candidates = listOf(
            File(appCtx.filesDir, "proot-tmp"),
            File(rootfsDir(appCtx), "tmp"),
            File(appCtx.cacheDir, "proot"),
            File(appCtx.codeCacheDir, "proot")
        )

        for (dir in candidates) {
            try {
                dir.mkdirs()
                if (!dir.isDirectory) continue

                val probe = File(dir, ".exec-probe.sh")
                probe.writeText("#!/system/bin/sh\nexit 42\n")
                if (!probe.setExecutable(true, false)) {
                    probe.delete()
                    continue
                }

                val pb = ProcessBuilder("/system/bin/sh", probe.absolutePath)
                    .redirectErrorStream(true)
                val p = pb.start()
                val ok = p.waitFor() == 42
                probe.delete()

                if (ok) {
                    Log.i(TAG, "PROOT_TMP_DIR chosen: ${dir.absolutePath}")
                    return dir
                }
            } catch (e: Exception) {
                Log.w(TAG, "PROOT_TMP_DIR candidate failed ${dir.absolutePath}: ${e.message}")
            }
        }

        val fallback = File(rootfsDir(appCtx), "tmp").also { it.mkdirs() }
        Log.w(TAG, "No exec-capable tmp found, using fallback: ${fallback.absolutePath}")
        return fallback
    }

    private fun tmpDir(context: Context): File {
        val dir = findExecTmpDir(context)
        try {
            dir.setReadable(true, true)
            dir.setWritable(true, true)
            dir.setExecutable(true, true)
        } catch (_: Exception) {}
        return dir
    }

    fun ensureRootfsExecutable(context: Context): String {
        val rootfs = rootfsDir(context)
        if (!rootfs.isDirectory) return "rootfs not installed"

        val log = StringBuilder()
        val binDirs = listOf(
            "bin", "sbin",
            "usr/bin", "usr/sbin",
            "usr/local/bin", "usr/local/sbin",
            "lib", "lib64", "usr/lib", "usr/lib64",
            "usr/libexec"
        )

        var totalFixed = 0
        for (rel in binDirs) {
            val dir = File(rootfs, rel)
            if (!dir.isDirectory) continue
            val files = dir.listFiles() ?: continue
            var fixedHere = 0
            for (f in files) {
                if (f.isFile && !f.canExecute()) {
                    try {
                        if (f.setExecutable(true, false)) {
                            fixedHere++
                            totalFixed++
                        }
                    } catch (_: Exception) {}
                }
            }
            log.appendLine("  $rel: found=${files.size}, fixed=$fixedHere")
        }
        log.appendLine("Total fixed: $totalFixed")
        return log.toString()
    }

    private fun guestLoginCommand(appCtx: Context): List<String> {
        val rootfs = rootfsDir(appCtx)
        val bashCandidates = listOf(
            File(rootfs, "bin/bash"),
            File(rootfs, "usr/bin/bash")
        )
        return if (bashCandidates.any { it.exists() }) {
            listOf("/bin/bash", "--login")
        } else {
            Log.w(TAG, "bash not found in rootfs, falling back to /bin/sh")
            listOf("/bin/sh")
        }
    }

    private fun guestCommand(appCtx: Context, command: String): List<String> {
        val rootfs = rootfsDir(appCtx)
        val bashCandidates = listOf(
            File(rootfs, "bin/bash"),
            File(rootfs, "usr/bin/bash")
        )
        return if (bashCandidates.any { it.exists() }) {
            listOf("/bin/bash", "-lc", command)
        } else {
            listOf("/bin/sh", "-c", command)
        }
    }

    private fun prootFlags(appCtx: Context, workDir: String?, link2Symlink: Boolean): List<String> {
        val rootfs = rootfsDir(appCtx).absolutePath
        val opts = mutableListOf<String>()

        opts += listOf("-r", rootfs)
        opts += listOf("-b", "/dev")
        opts += listOf("-b", "/proc")
        opts += listOf("-b", "/sys")

        // /dev/pts is a separate devpts mount on Android; binding it (when visible to the app)
        // lets maintainer scripts and tools that allocate ptys work inside the guest.
        if (File("/dev/pts").isDirectory) {
            opts += listOf("-b", "/dev/pts")
        }

        // /sdcard bind is optional: on scoped-storage Android (10+) the app process may not be
        // able to see EXTERNAL_STORAGE at all. Binding a non-existent source makes proot refuse
        // to start entirely, so only add the bind when the source actually exists.
        val sdcard = System.getenv("EXTERNAL_STORAGE") ?: "/sdcard"
        if (File(sdcard).isDirectory) {
            opts += listOf("-b", "$sdcard:/sdcard")
        } else {
            Log.w(TAG, "sdcard '$sdcard' not visible to the app, skipping /sdcard bind")
        }

        // Hard links and dpkg: Ubuntu 24.04 ships dpkg 1.22, whose status-file backup is
        // implemented with link(2) ("error creating new backup file '/var/lib/dpkg/status-old'"),
        // and package installs create hard links (gzip -> gunzip/zcat/..., perl -> ...).
        // On Android kernels/f2fs plain link(2) from an app frequently fails with EPERM.
        // proot-distro solves this by keeping --link2symlink ON: proot intercepts link(2) and
        // emulates hard links in userspace, so dpkg/apt work. The emulation leaves ".proot.l2s."/
        // ".l2s." backing files behind, which break upgrades if a dpkg run is interrupted, so
        // the prepare step (run before every apt/dpkg command) breaks hard links in binary dirs
        // and cleans up leftover ".l2s.*" files. This mirrors exactly how Termux proot-distro
        // keeps Ubuntu's apt working.
        if (link2Symlink) opts += "--link2symlink"

        // proot-distro parity flags that make apt/dpkg behave correctly inside the guest:
        //  -L                 : fix lstat() size for symlinks ("Fix lstat for dpkg symlink
        //                       warnings" - proot-distro passes it unconditionally)
        //  --sysvipc          : emulate SysV IPC
        //  --kernel-release   : present a modern kernel to uname(2) (some postinst scripts)
        opts += "-L"
        opts += "--sysvipc"
        opts += "--kernel-release=6.17.0-proot"

        // -0 makes every process look like uid 0 (root). dpkg/apt need this: without it the
        // rootfs files owned by the app uid make dpkg fail with "Permission denied" when it
        // chowns/creates /var/lib/dpkg files as the guest root user.
        opts += "-0"
        opts += listOf("-w", if (!workDir.isNullOrEmpty()) workDir else "/root")
        return opts
    }

    fun runtimeEnv(context: Context): Map<String, String> {
        val appCtx = context.applicationContext
        val t = tmpDir(appCtx)
        val loader = loaderBinary(appCtx)

        val env = linkedMapOf(
            "TERM" to "xterm-256color",
            "COLORTERM" to "truecolor",
            "HOME" to "/root",
            "USER" to "root",
            "SHELL" to "/bin/bash",
            "LANG" to "C.UTF-8",
            "LC_ALL" to "C.UTF-8",
            // apt/dpkg must not block on debconf prompts inside the guest.
            "DEBIAN_FRONTEND" to "noninteractive",
            "PROOT_NO_SECCOMP" to "1",
            "PROOT_TMP_DIR" to t.absolutePath,
            // Guest TMPDIR must point INSIDE the rootfs. A host path (e.g. the app files dir)
            // is translated by proot into "<rootfs>/<host-path>" which does not exist, so
            // programs that honour TMPDIR (dpkg-deb, mktemp, postinst scripts, ...) would fail
            // with "cannot create temp file" — a very common cause of dpkg errors in proot.
            "TMPDIR" to "/tmp",
            "PATH" to "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
        )

        // KEY: use the external loader shipped in nativeLibraryDir. This is the ONE
        // place on Android where SELinux reliably permits exec of ELFs.
        if (loader.exists()) {
            env["PROOT_LOADER"] = loader.absolutePath
            Log.i(TAG, "Using external PROOT_LOADER: ${loader.absolutePath}")
        } else {
            Log.w(TAG, "libproot-loader.so NOT FOUND in nativeLibraryDir; proot will try embedded loader (may fail on strict Android)")
        }

        System.getenv("ANDROID_ROOT")?.let { env["ANDROID_ROOT"] = it }
        System.getenv("ANDROID_DATA")?.let { env["ANDROID_DATA"] = it }
        System.getenv("EXTERNAL_STORAGE")?.let { env["EXTERNAL_STORAGE"] = it }
        System.getenv("BOOTCLASSPATH")?.let { env["BOOTCLASSPATH"] = it }

        return env
    }

    private fun runtimeEnvArray(context: Context): Array<String> =
        runtimeEnv(context).map { "${it.key}=${it.value}" }.toTypedArray()

    fun build(context: Context, workDir: String? = null, link2Symlink: Boolean = true): ProotConfig {
        val appCtx = context.applicationContext
        ensureRootfsExecutable(appCtx)
        maybePrepareInBackground(appCtx)

        val proot = prootBinary(appCtx).absolutePath
        val flags = prootFlags(appCtx, workDir, link2Symlink)
        val guest = guestLoginCommand(appCtx)

        val opts = (listOf("proot") + flags + guest).toTypedArray()
        val env = runtimeEnvArray(appCtx)

        Log.i(TAG, "proot ready: $proot ; args=${opts.joinToString(" ")}")

        return ProotConfig(
            prootPath = proot,
            args = opts,
            env = env,
            cwd = appCtx.filesDir.absolutePath
        )
    }

    fun buildCommandProcess(
        context: Context,
        command: String,
        workDir: String? = null,
        link2Symlink: Boolean = true
    ): ProcessConfig {
        val appCtx = context.applicationContext
        ensureRootfsExecutable(appCtx)
        // Heal a half-finished dpkg transaction before running any apt/dpkg command, so that
        // "apt upgrade" no longer dies with "E: Sub-process /usr/bin/dpkg returned an error".
        ensurePrepared(appCtx)
        // Keep the rootfs free of link2symlink leftovers: an interrupted dpkg run can leave
        // ".l2s." chains behind, which break the next upgrade. For apt/dpkg commands run the
        // cheap cleanup always (idempotent, takes a couple of seconds).
        if (isAptLikeCommand(command)) {
            runLightCleanup(appCtx)
        }
        return buildCommandProcessRaw(appCtx, command, workDir, link2Symlink)
    }

    private fun isAptLikeCommand(command: String): Boolean {
        val c = command.lowercase()
        return c.contains("apt") || c.contains("dpkg") || c.contains("pkg ")
    }

    /**
     * Fast, idempotent cleanup: break hard links in binary dirs (dpkg upgrades of gzip/perl)
     * and remove leftover ".l2s." symlinks/backing files from interrupted runs. Mirrors the
     * 2c/2d steps of the full prepare script.
     */
    private fun runLightCleanup(appCtx: Context) {
        if (!isReady(appCtx)) return
        synchronized(prepareMutex) {
            try {
                val pc = buildCommandProcessRaw(
                    appCtx,
                    LIGHT_CLEANUP_SCRIPT
                )
                val (code, out) = runProbeProcess(appCtx, pc.program, pc.argv, pc.env, 60_000L)
                if (out.isNotBlank()) Log.i(TAG, "light cleanup exit=$code\n${out.takeLast(2000)}")
            } catch (e: Exception) {
                Log.w(TAG, "light cleanup error: ${e.message}")
            }
        }
    }

    private val LIGHT_CLEANUP_SCRIPT = """
        set +e
        export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
        # heal leftover link2symlink state + break hard links (same as prepare steps 2c/2d)
        find /usr /bin /sbin /lib /opt /var -xdev -type l 2>/dev/null | while read -r f; do
          tgt=${'$'}(readlink "${'$'}f" 2>/dev/null) || continue
          case "${'$'}tgt" in
            *".proot.l2s."*|*".l2s."*)
              d=${'$'}(dirname "${'$'}f")
              case "${'$'}tgt" in
                /*) real="${'$'}tgt" ;;
                *)  real="${'$'}d/${'$'}tgt" ;;
              esac
              rm -f "${'$'}f"
              if [ -f "${'$'}real" ]; then cp -p "${'$'}real" "${'$'}f" 2>/dev/null; fi
              [ -e "${'$'}f" ] || : > "${'$'}f"
              chmod 755 "${'$'}f" 2>/dev/null
              ;;
          esac
        done
        find /usr /bin /sbin /lib /opt /var -xdev \
             \( -name '.proot.l2s.*' -o -name '.l2s.*' \) -delete 2>/dev/null
        for d in /usr/bin /bin /sbin /usr/sbin /usr/lib /lib /lib64 /usr/lib64 /usr/libexec /opt; do
          [ -d "${'$'}d" ] || continue
          find "${'$'}d" -xdev -type f -links +1 2>/dev/null | while read -r f; do
            tmp="${'$'}f.brk.$$"
            if cp -p "${'$'}f" "${'$'}tmp" 2>/dev/null; then
              rm -f "${'$'}f" && mv "${'$'}tmp" "${'$'}f" 2>/dev/null
            fi
            rm -f "${'$'}tmp" 2>/dev/null
          done
        done
        rm -f /var/lib/dpkg/status-new 2>/dev/null
        if [ -L /var/lib/dpkg/status ]; then
          TARGET=${'$'}(readlink /var/lib/dpkg/status 2>/dev/null)
          rm -f /var/lib/dpkg/status
          if [ -n "${'$'}TARGET" ] && [ -f "${'$'}TARGET" ]; then
            cp -p "${'$'}TARGET" /var/lib/dpkg/status 2>/dev/null
          else
            : > /var/lib/dpkg/status
          fi
          chmod 644 /var/lib/dpkg/status 2>/dev/null
        fi
        if [ -L /var/lib/dpkg/status-old ]; then
          rm -f /var/lib/dpkg/status-old
          : > /var/lib/dpkg/status-old
          chmod 644 /var/lib/dpkg/status-old 2>/dev/null
        fi
        # perl + systemd-helper heal (same as prepare steps 6c/6d)
        if ! /usr/bin/perl -e 'exit 0' >/dev/null 2>&1; then
          if command -v apt-get >/dev/null 2>&1; then
            apt-get install -y --reinstall perl-base 2>/dev/null || true
          fi
          if ! /usr/bin/perl -e 'exit 0' >/dev/null 2>&1; then
            DEB=${'$'}(ls /var/cache/apt/archives/perl-base_*.deb 2>/dev/null | head -1)
            if [ -n "${'$'}DEB" ]; then
              rm -rf /tmp/pb && mkdir -p /tmp/pb
              dpkg-deb -x "${'$'}DEB" /tmp/pb 2>/dev/null
              cp -p /tmp/pb/usr/bin/perl* /usr/bin/ 2>/dev/null
              ARCH=${'$'}(dpkg --print-architecture 2>/dev/null)
              if [ -n "${'$'}ARCH" ] && [ -d "/tmp/pb/usr/lib/${'$'}ARCH" ]; then
                cp -a /tmp/pb/usr/lib/"${'$'}ARCH"/. /usr/lib/ 2>/dev/null
              fi
              rm -rf /tmp/pb
            fi
          fi
          chmod 755 /usr/bin/perl* 2>/dev/null
        fi
        if [ -f /usr/bin/deb-systemd-helper ] && [ ! -e /usr/bin/deb-systemd-helper.proot-orig ]; then
          cp -p /usr/bin/deb-systemd-helper /usr/bin/deb-systemd-helper.proot-orig 2>/dev/null
          printf '#!/bin/sh\nexit 0\n' > /usr/bin/deb-systemd-helper
          chmod 755 /usr/bin/deb-systemd-helper
        fi
        if [ -f /usr/bin/deb-systemd-invoke ] && [ ! -e /usr/bin/deb-systemd-invoke.proot-orig ]; then
          cp -p /usr/bin/deb-systemd-invoke /usr/bin/deb-systemd-invoke.proot-orig 2>/dev/null
          printf '#!/bin/sh\nexit 0\n' > /usr/bin/deb-systemd-invoke
          chmod 755 /usr/bin/deb-systemd-invoke
        fi
        exit 0
    """.trimIndent()

    private fun buildCommandProcessRaw(
        appCtx: Context,
        command: String,
        workDir: String? = null,
        link2Symlink: Boolean = true
    ): ProcessConfig {
        val proot = prootBinary(appCtx).absolutePath
        val flags = prootFlags(appCtx, workDir, link2Symlink)
        val guest = guestCommand(appCtx, command)

        return ProcessConfig(
            program = proot,
            argv = flags + guest,
            env = runtimeEnv(appCtx),
            cwd = appCtx.filesDir.absolutePath
        )
    }

    // ---------------------------------------------------------------------------
    // apt/dpkg self-healing preparation
    //
    // A stock Ubuntu rootfs extracted from a tarball is missing several things that
    // dpkg/apt need in a proot container, and an interrupted `apt upgrade` leaves the
    // dpkg database in a half-configured state that makes every later install fail.
    // prepareRootfs() fixes all of that inside the guest (idempotent), mirrors what
    // Termux's proot-distro does for its Ubuntu images.
    // ---------------------------------------------------------------------------

    private val prepareMutex = Any()
    @Volatile
    private var prepareRunning = false

    private fun prepareMarker(appCtx: Context): File =
        File(appCtx.filesDir, "proot/.prepared-v2")

    fun isPrepared(context: Context): Boolean = prepareMarker(context.applicationContext).exists()

    private val PREPARE_SCRIPT = """
        set +e
        export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
        export DEBIAN_FRONTEND=noninteractive
        umask 022

        FAIL=0

        # 1) Essential directories - dpkg/apt explode without these
        mkdir -p /var/lib/dpkg/updates /var/lib/dpkg/info \
                 /var/lib/apt/lists/partial /var/cache/apt/archives/partial \
                 /var/log/apt /run /run/lock /dev/shm /tmp /var/tmp 2>/dev/null

        # 2) Ownership/permissions. Under proot -0 every process looks like root, but the
        #    files underneath are owned by the app uid; guest-visible ownership must be root.
        chown -R root:root /var/lib/dpkg /var/lib/apt /var/cache/apt /run /tmp /var/tmp 2>/dev/null
        chmod 755 /var/lib/dpkg /var/lib/apt /var/cache/apt /run 2>/dev/null
        chmod 755 /var/lib/dpkg/updates /var/lib/dpkg/info /var/lib/apt/lists/partial \
                  /var/cache/apt/archives/partial /var/log/apt /run/lock 2>/dev/null
        chmod 1777 /tmp /var/tmp /dev/shm 2>/dev/null

        # 2b) --link2symlink turns every hard link in the rootfs into a symlink, and Ubuntu
        #     base images ship /var/lib/dpkg/status-old as a hard link to status. dpkg's
        #     backup step (rename status -> status-old) then fails with
        #     "error creating new backup file '/var/lib/dpkg/status-old': Permission denied".
        #     Replace the symlinks with plain regular files.
        for f in /var/lib/dpkg/status-old /var/lib/dpkg/status-new /var/lib/dpkg/updates/tmp.i; do
          if [ -L "${'$'}f" ]; then
            rm -f "${'$'}f" 2>/dev/null
            : > "${'$'}f" 2>/dev/null
            chmod 644 "${'$'}f" 2>/dev/null
          fi
        done
        if [ -L /var/lib/dpkg/status ]; then
          # status must be a real file; if it is a symlink, copy the target over it.
          TARGET=${'$'}(readlink /var/lib/dpkg/status 2>/dev/null)
          rm -f /var/lib/dpkg/status
          if [ -n "${'$'}TARGET" ] && [ -f "${'$'}TARGET" ]; then
            cp -p "${'$'}TARGET" /var/lib/dpkg/status 2>/dev/null
          else
            : > /var/lib/dpkg/status
          fi
          chmod 644 /var/lib/dpkg/status 2>/dev/null
        fi
        chmod 644 /var/lib/dpkg/status /var/lib/dpkg/status-old 2>/dev/null
        find /var/lib/dpkg -maxdepth 1 -type f -exec chmod 644 {} + 2>/dev/null

        # 2c) Heal leftover proot hard-link emulation state (".proot.l2s." / ".l2s.").
        #     When proot runs with --link2symlink it renames hard-linked files into hidden
        #     ".proot.l2s.<name>.<n>" backing files and replaces the original paths with
        #     symlinks to them. A failed dpkg unpack can leave those chains broken (backing
        #     file missing), after which lstat() on e.g. /usr/bin/gunzip fails with
        #     "Operation not permitted". Replace every such symlink with a real file and
        #     delete orphaned backing files.
        find /usr /bin /sbin /lib /opt /var -xdev -type l 2>/dev/null | while read -r f; do
          tgt=${'$'}(readlink "${'$'}f" 2>/dev/null) || continue
          case "${'$'}tgt" in
            *".proot.l2s."*|*".l2s."*)
              d=${'$'}(dirname "${'$'}f")
              case "${'$'}tgt" in
                /*) real="${'$'}tgt" ;;
                *)  real="${'$'}d/${'$'}tgt" ;;
              esac
              rm -f "${'$'}f"
              if [ -f "${'$'}real" ]; then
                cp -p "${'$'}real" "${'$'}f" 2>/dev/null
              fi
              [ -e "${'$'}f" ] || : > "${'$'}f"
              chmod 755 "${'$'}f" 2>/dev/null
              ;;
          esac
        done
        find /usr /bin /sbin /lib /opt /var -xdev \
             \( -name '.proot.l2s.*' -o -name '.l2s.*' \) -delete 2>/dev/null

        # 2d) Break real hard links in binary/library dirs. Ubuntu ships gzip and perl as
        #     bundles of hard links (gunzip/zcat/zcmp/zmore -> gzip, perl5.xx -> perl, ...).
        #     When dpkg upgrades such a package it creates hard links for the new version,
        #     which under --link2symlink go through proot's emulation and leave ".l2s."
        #     chains; if such a run is interrupted the chain breaks and the next upgrade
        #     fails with "unable to stat './usr/bin/gunzip': Operation not permitted".
        #     Breaking the links turns every name into an independent regular file, so
        #     upgrades only ever write plain files (proot-distro does the same for its
        #     images). Idempotent.
        for d in /usr/bin /bin /sbin /usr/sbin /usr/lib /lib /lib64 /usr/lib64 /usr/libexec /opt; do
          [ -d "${'$'}d" ] || continue
          find "${'$'}d" -xdev -type f -links +1 2>/dev/null | while read -r f; do
            tmp="${'$'}f.brk.$$"
            if cp -p "${'$'}f" "${'$'}tmp" 2>/dev/null; then
              rm -f "${'$'}f" && mv "${'$'}tmp" "${'$'}f" 2>/dev/null
            fi
            rm -f "${'$'}tmp" 2>/dev/null
          done
        done

        # 3) proot-friendly apt configuration (sandbox user, no config prompts, no pipeline hangs)
        mkdir -p /etc/apt/apt.conf.d
        cat > /etc/apt/apt.conf.d/00proot <<'EOF'
        APT::Sandbox::User "root";
        DPkg::Options { "--force-confdef"; "--force-confold"; };
        Acquire::http::Pipeline-Depth "0";
        Acquire::Retries "3";
        EOF

        # 4) Never start systemd services from maintainer scripts inside the container
        if [ ! -x /usr/sbin/policy-rc.d ]; then
          printf '#!/bin/sh\nexit 101\n' > /usr/sbin/policy-rc.d
          chmod 755 /usr/sbin/policy-rc.d
        fi

        # 5) DNS fallback for apt/wget/curl/git
        if [ ! -s /etc/resolv.conf ]; then
          printf 'nameserver 8.8.8.8\nnameserver 1.1.1.1\n' > /etc/resolv.conf
        fi

        # 6) machine-id / hostname / hosts - some maintainer scripts fail without them
        if [ ! -s /etc/machine-id ]; then
          cat /proc/sys/kernel/random/uuid 2>/dev/null | tr -d '\n' > /etc/machine-id
        fi
        if [ ! -s /etc/hostname ]; then
          printf 'localhost\n' > /etc/hostname
        fi
        if ! grep -q '^127.0.0.1' /etc/hosts 2>/dev/null; then
          printf '127.0.0.1 localhost\n::1 localhost ip6-localhost ip6-loopback\n' >> /etc/hosts
        fi

        # 6b) apt sources. An arm64 rootfs needs ports.ubuntu.com, not archive.ubuntu.com;
        #     some images ship an empty or wrong sources.list which makes apt update/upgrade fail.
        #     Detect both classic ("deb ...") and deb822 ("URIs:") formats; when we write our
        #     own sources, remove the stock files to avoid "configured multiple times" warnings.
        if ! grep -rqsE '^[^#]*(deb |URIs:|Types:)' /etc/apt/sources.list /etc/apt/sources.list.d/ 2>/dev/null; then
          CODENAME=${'$'}(grep -m1 '^VERSION_CODENAME=' /etc/os-release 2>/dev/null | cut -d= -f2)
          if [ -z "${'$'}CODENAME" ]; then CODENAME=noble; fi
          ARCH=${'$'}(dpkg --print-architecture 2>/dev/null)
          case "${'$'}ARCH" in
            arm64|armhf) MIRROR="http://ports.ubuntu.com/ubuntu-ports" ;;
            *) MIRROR="http://archive.ubuntu.com/ubuntu" ;;
          esac
          mkdir -p /etc/apt/sources.list.d
          printf 'deb %s %s main restricted universe multiverse\ndeb %s %s-updates main restricted universe multiverse\ndeb %s %s-security main restricted universe multiverse\n' \
                 "${'$'}MIRROR" "${'$'}CODENAME" "${'$'}MIRROR" "${'$'}CODENAME" "${'$'}MIRROR" "${'$'}CODENAME" \
                 > /etc/apt/sources.list.d/ubuntu-proot.list
          rm -f /etc/apt/sources.list /etc/apt/sources.list.d/ubuntu.sources
          echo "==> wrote apt sources for ${'$'}CODENAME (${'$'}ARCH) via ${'$'}MIRROR"
        fi

        # 6c) Heal a broken perl interpreter. Ubuntu's deb-systemd-helper is a Perl script; if
        #     /usr/bin/perl is a leftover link2symlink chain (or got corrupted during an
        #     interrupted perl-base upgrade), maintainer scripts fail with
        #     "/usr/bin/deb-systemd-helper: =head1: not found" and apt appears to hang.
        #     Reinstall perl-base from the apt cache (or unpack the .deb manually) to get a
        #     working perl.
        if ! /usr/bin/perl -e 'exit 0' >/dev/null 2>&1; then
          echo "==> perl broken, reinstalling perl-base"
          if command -v apt-get >/dev/null 2>&1; then
            apt-get install -y --reinstall perl-base 2>/dev/null || true
          fi
          if ! /usr/bin/perl -e 'exit 0' >/dev/null 2>&1; then
            # Fallback: unpack the cached perl-base .deb manually (no perl needed).
            DEB=${'$'}(ls /var/cache/apt/archives/perl-base_*.deb 2>/dev/null | head -1)
            if [ -n "${'$'}DEB" ]; then
              rm -rf /tmp/pb && mkdir -p /tmp/pb
              dpkg-deb -x "${'$'}DEB" /tmp/pb 2>/dev/null
              cp -p /tmp/pb/usr/bin/perl* /usr/bin/ 2>/dev/null
              ARCH=${'$'}(dpkg --print-architecture 2>/dev/null)
              if [ -n "${'$'}ARCH" ] && [ -d "/tmp/pb/usr/lib/${'$'}ARCH" ]; then
                cp -a /tmp/pb/usr/lib/"${'$'}ARCH"/. /usr/lib/ 2>/dev/null
              fi
              rm -rf /tmp/pb
            fi
          fi
          chmod 755 /usr/bin/perl* 2>/dev/null
        fi

        # 6d) systemd policy: in a proot container there is no systemd/PID1, so maintainer
        #     scripts that call deb-systemd-helper/deb-systemd-invoke should not block or try
        #     to talk to systemctl. /usr/sbin/policy-rc.d already returns 101; also make the
        #     helpers no-ops so postinst of dozens of packages completes instantly. The originals
        #     are preserved next to the stub.
        if [ -f /usr/bin/deb-systemd-helper ] && [ ! -e /usr/bin/deb-systemd-helper.proot-orig ]; then
          cp -p /usr/bin/deb-systemd-helper /usr/bin/deb-systemd-helper.proot-orig 2>/dev/null
          printf '#!/bin/sh\nexit 0\n' > /usr/bin/deb-systemd-helper
          chmod 755 /usr/bin/deb-systemd-helper
        fi
        if [ -f /usr/bin/deb-systemd-invoke ] && [ ! -e /usr/bin/deb-systemd-invoke.proot-orig ]; then
          cp -p /usr/bin/deb-systemd-invoke /usr/bin/deb-systemd-invoke.proot-orig 2>/dev/null
          printf '#!/bin/sh\nexit 0\n' > /usr/bin/deb-systemd-invoke
          chmod 755 /usr/bin/deb-systemd-invoke
        fi

        # 7) Remove stale lock files left by a force-stopped apt/dpkg (fcntl locks die with the
        #    process, so deleting the files is only safe when nothing is running - check /proc).
        APT_RUNNING=0
        for pid in /proc/[0-9]*; do
          comm=${'$'}(cat "${'$'}pid/comm" 2>/dev/null)
          case "${'$'}comm" in
            apt|apt-get|dpkg|dpkg-deb|unattended-upgr) APT_RUNNING=1; break ;;
          esac
        done
        if [ "${'$'}APT_RUNNING" = "0" ]; then
          rm -f /var/lib/dpkg/lock /var/lib/dpkg/lock-frontend \
                /var/lib/apt/lists/lock /var/cache/apt/archives/lock 2>/dev/null
        fi

        # 8) Heal a half-finished dpkg transaction (the "apt upgrade -> dpkg error" case)
        if command -v dpkg >/dev/null 2>&1; then
          echo "==> dpkg --configure -a (repair interrupted packages)"
          dpkg --configure -a --force-confold --force-confdef || FAIL=1
        fi
        if command -v apt-get >/dev/null 2>&1; then
          echo "==> apt-get update (refresh package lists)"
          if command -v timeout >/dev/null 2>&1; then
            timeout 180 apt-get update || echo "(apt-get update failed, continuing)"
          else
            apt-get update || echo "(apt-get update failed, continuing)"
          fi
          echo "==> apt-get -f install -y (fix broken dependencies)"
          apt-get -f install -y || FAIL=1
        fi

        # 9) If something still failed, list the broken packages so the user can see what to fix
        if [ "${'$'}FAIL" != "0" ]; then
          echo "==> REPAIR FAILED - broken packages:"
          dpkg -l 2>/dev/null | grep -E '^.[UHFhWT]' || echo "    (none listed)"
          echo "==> /var/lib/dpkg state:"
          ls -la /var/lib/dpkg/ 2>/dev/null | head -20
          echo "==> full log: /var/log/proot-prepare.log"
        fi

        echo "==> prepare finished"
        exit ${'$'}FAIL
    """.trimIndent()

    private fun runPrepareScript(appCtx: Context, timeoutMs: Long): Pair<Int, String> {
        val pc = buildCommandProcessRaw(appCtx, PREPARE_SCRIPT)
        return runProbeProcess(appCtx, pc.program, pc.argv, pc.env, timeoutMs)
    }

    /** Persist the prepare output inside the rootfs so it can be read from the terminal. */
    private fun writePrepareLog(appCtx: Context, output: String) {
        if (output.isBlank()) return
        try {
            val logFile = File(rootfsDir(appCtx), "var/log/proot-prepare.log")
            logFile.parentFile?.mkdirs()
            logFile.writeText(output)
        } catch (_: Exception) {}
    }

    /**
     * Run the apt/dpkg self-healing script inside the rootfs. Idempotent; the marker is
     * written after a completed attempt so it normally runs only once. Returns (exitCode, output).
     */
    fun prepareRootfs(context: Context, force: Boolean = false, timeoutMs: Long = 300_000L): Pair<Int, String> {
        val appCtx = context.applicationContext
        if (!isReady(appCtx)) return (-1) to "proot/rootfs not ready"
        if (!force && prepareMarker(appCtx).exists()) return 0 to "(already prepared)"

        ensureRootfsExecutable(appCtx)

        synchronized(prepareMutex) {
            prepareRunning = true
            return try {
                val result = runPrepareScript(appCtx, timeoutMs)
                writePrepareLog(appCtx, result.second)
                if (result.first != -1) {
                    try { prepareMarker(appCtx).writeText("ok") } catch (_: Exception) {}
                }
                result
            } catch (e: Exception) {
                (-1) to ("prepare error: ${e.message}\n")
            } finally {
                prepareRunning = false
            }
        }
    }

    private fun ensurePrepared(appCtx: Context) {
        if (prepareMarker(appCtx).exists() || prepareRunning) return
        synchronized(prepareMutex) {
            if (prepareMarker(appCtx).exists() || prepareRunning) return
            prepareRunning = true
            try {
                val (code, out) = runPrepareScript(appCtx, 90_000L)
                writePrepareLog(appCtx, out)
                Log.i(TAG, "auto-prepare exit=$code")
                if (out.isNotBlank()) Log.i(TAG, out.takeLast(4000))
                if (code != -1) {
                    try { prepareMarker(appCtx).writeText("ok") } catch (_: Exception) {}
                }
            } catch (e: Exception) {
                Log.w(TAG, "auto-prepare error: ${e.message}")
            } finally {
                prepareRunning = false
            }
        }
    }

    private fun maybePrepareInBackground(appCtx: Context) {
        if (prepareMarker(appCtx).exists() || prepareRunning) return
        Thread {
            ensurePrepared(appCtx)
        }.apply {
            name = "proot-auto-prepare"
            start()
        }
    }

    private fun runProbeProcess(
        appCtx: Context,
        program: String,
        argv: List<String>,
        envMap: Map<String, String>,
        timeoutMs: Long = 8000L
    ): Pair<Int, String> {
        val out = StringBuilder()
        return try {
            val pb = ProcessBuilder(listOf(program) + argv).redirectErrorStream(true)
            val childEnv = pb.environment()
            for ((k, v) in envMap) {
                childEnv[k] = v
            }
            pb.directory(appCtx.filesDir)

            val p = pb.start()
            val reader = Thread {
                try {
                    p.inputStream.bufferedReader().forEachLine { line ->
                        out.appendLine(line)
                    }
                } catch (_: Exception) {
                }
            }
            reader.start()

            val deadline = System.currentTimeMillis() + timeoutMs
            var code = -1
            while (System.currentTimeMillis() < deadline) {
                try {
                    code = p.exitValue()
                    break
                } catch (_: IllegalThreadStateException) {
                    Thread.sleep(80)
                }
            }
            if (code == -1) {
                p.destroy()
                out.appendLine("(timeout ${timeoutMs}ms)")
            }
            reader.join(1500)
            code to out.toString()
        } catch (e: Exception) {
            (-1) to ("exception: ${e.message}\n")
        }
    }

    fun inspectRootfs(context: Context): String {
        val rootfs = rootfsDir(context)
        val sb = StringBuilder()
        sb.appendLine("rootfs: ${rootfs.absolutePath}")
        sb.appendLine("exists: ${rootfs.exists()}")
        sb.appendLine("bin/ dir: ${File(rootfs, "bin").isDirectory}")
        sb.appendLine("usr/bin/ dir: ${File(rootfs, "usr/bin").isDirectory}")

        val toCheck = listOf(
            "bin/bash", "usr/bin/bash",
            "bin/sh", "usr/bin/sh",
            "bin/ls", "usr/bin/ls",
            "lib64/ld-linux-aarch64.so.1",
            "lib/ld-linux-aarch64.so.1",
            "lib/aarch64-linux-gnu/ld-linux-aarch64.so.1"
        )
        sb.appendLine("--- key files ---")
        for (rel in toCheck) {
            val f = File(rootfs, rel)
            if (f.exists()) {
                sb.appendLine("$rel  size=${f.length()}  x=${f.canExecute()}  elf=${elfBits(f)}")
            } else {
                sb.appendLine("$rel  MISSING")
            }
        }
        return sb.toString()
    }

    fun runSmokeTest(context: Context): String {
        val appCtx = context.applicationContext
        val sb = StringBuilder()

        val proot = prootBinary(appCtx)
        val loader = loaderBinary(appCtx)
        val rootfs = rootfsDir(appCtx)

        sb.appendLine("proot  : ${proot.absolutePath} exists=${proot.exists()}")
        sb.appendLine("loader : ${loader.absolutePath} exists=${loader.exists()}")
        sb.appendLine("rootfs : ${rootfs.absolutePath} installed=${isRootfsInstalled(appCtx)}")

        val pArch = prootArch(appCtx)
        val rArch = rootfsArch(appCtx)
        sb.appendLine("proot arch : ${when (pArch) { 64 -> "64-bit"; 32 -> "32-bit"; else -> "?" }}")
        sb.appendLine("rootfs arch: ${when (rArch) { 64 -> "64-bit (aarch64)"; 32 -> "32-bit (armhf)"; else -> "?" }}")

        if (!proot.exists()) {
            return sb.appendLine("=> proot binary missing").toString()
        }

        sb.appendLine()
        sb.appendLine("=== rootfs snapshot ===")
        sb.append(inspectRootfs(appCtx))

        sb.appendLine()
        sb.appendLine("=== rootfs chmod +x pass ===")
        sb.append(ensureRootfsExecutable(appCtx))

        val env = runtimeEnv(appCtx)
        sb.appendLine()
        sb.appendLine("=== chosen PROOT_TMP_DIR: ${env["PROOT_TMP_DIR"]} ===")
        sb.appendLine("=== PROOT_LOADER: ${env["PROOT_LOADER"] ?: "<embedded>"} ===")

        sb.appendLine()
        sb.appendLine("=== proot --version ===")
        run {
            val (code, out) = runProbeProcess(
                appCtx,
                proot.absolutePath,
                listOf("--version"),
                env,
                4000L
            )
            sb.appendLine("exit=$code")
            if (out.isNotBlank()) sb.appendLine(out.trim())
        }

        val flagsFull = prootFlags(appCtx, null, true)
        val flagsNoL2S = prootFlags(appCtx, null, false)

        fun runProbe(label: String, flags: List<String>, guest: List<String>, verbose: Boolean) {
            val envMap = HashMap(env)
            if (verbose) envMap["PROOT_VERBOSE"] = "1"

            val argv = flags + guest
            val (code, text) = runProbeProcess(appCtx, proot.absolutePath, argv, envMap, 8000L)
            val tail = if (text.length > 1800) {
                "…[head truncated]…\n" + text.takeLast(1800)
            } else {
                text
            }
            sb.appendLine("### $label (exit=$code)")
            sb.appendLine(tail)
        }

        sb.appendLine()
        sb.appendLine("=== proot probes ===")
        runProbe("A full-flags + /bin/true",       flagsFull,  listOf("/bin/true"),                       true)
        runProbe("B full-flags + /bin/sh echo",    flagsFull,  listOf("/bin/sh", "-c", "echo OK"),        true)
        runProbe("C NO link2symlink + /bin/true",  flagsNoL2S, listOf("/bin/true"),                       true)

        sb.appendLine()
        sb.appendLine("=== hardlink census (nlink > 1 files) ===")
        run {
            val (code, out) = runProbeProcess(
                appCtx,
                proot.absolutePath,
                prootFlags(appCtx, null, false) + listOf(
                    "/bin/sh", "-c",
                    "find /usr /bin /sbin /lib /opt /var -xdev -type f -links +1 2>/dev/null | head -40; echo '---l2s leftovers---'; find /usr /bin /sbin /lib /opt /var -xdev \\( -name '.proot.l2s.*' -o -name '.l2s.*' \\) 2>/dev/null | head -20"
                ),
                env,
                20000L
            )
            sb.appendLine("exit=$code")
            sb.appendLine(out.trim().ifEmpty { "(no hard links / no l2s leftovers)" })
        }

        sb.appendLine()
        sb.appendLine("=== link(2) test (dpkg status backup uses link()) ===")
        run {
            // Runs WITHOUT link2symlink on purpose: proves whether the raw kernel link(2)
            // works on this device. dpkg 1.22 backs up status via link(); if this fails
            // with EPERM, link2symlink must stay enabled (proot emulates link()).
            val (code, out) = runProbeProcess(
                appCtx,
                proot.absolutePath,
                prootFlags(appCtx, null, false) + listOf(
                    "/bin/sh", "-c",
                    "rm -f /tmp/lnk_test; ln /var/lib/dpkg/status /tmp/lnk_test 2>&1; echo \"link_rc=\$?\"; ls -la /tmp/lnk_test 2>&1 | head -1; rm -f /tmp/lnk_test"
                ),
                env,
                10000L
            )
            sb.appendLine("exit=$code")
            sb.appendLine(out.trim())
        }

        return sb.toString()
    }
}