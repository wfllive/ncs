package expo.modules.termuxterminal

import android.content.Context
import java.io.File

/**
 * Builds the shell command / environment used to start a terminal session.
 *
 * IMPORTANT: on Android 10+ (and stricter OEM skins like Huawei/HarmonyOS) the app's private
 * data partition is mounted `noexec` and SELinux denies executing files the app extracted into
 * `<filesDir>/usr/bin`. So a bootstrap `bash` that simply *exists* may still fail with
 * `Permission denied` when exec'd. We therefore probe every candidate shell with a real exec
 * (`sh -c true`) and fall back to the system shell `/system/bin/sh`, which is always executable.
 *
 * Resolution order (first that actually executes wins):
 *  1. `<filesDir>/usr/bin/bash`   (app bootstrap, needs `<filesDir>/usr/lib`)
 *  2. `<filesDir>/usr/bin/sh`
 *  3. `/data/data/com.termux/files/usr/bin/bash` (an installed Termux, if reachable/executable)
 *  4. `/system/bin/sh`            (always works)
 */
object TerminalEnvironment {

    data class ShellConfig(
        val shellPath: String,
        val args: Array<String>,
        val cwd: String,
        val env: Array<String>,
        val isBootstrap: Boolean,
        val isProot: Boolean = false
    )

    private data class Candidate(
        val path: String,
        val libDirs: List<String>,
        val isBootstrap: Boolean,
        val args: Array<String>
    )

    fun prefix(context: Context): String = File(context.filesDir, "usr").absolutePath
    fun home(context: Context): String = File(context.filesDir, "home").absolutePath

    /**
     * Returns true only if [path] can really be executed by this app. A file that exists but is
     * blocked by a `noexec` mount / SELinux makes [ProcessBuilder.start] throw (Permission denied),
     * and a dynamically linked binary that can't resolve its libraries exits non-zero — both are
     * treated as "not usable".
     */
    private fun canExec(path: String, libDirs: List<String>): Boolean {
        if (!File(path).exists()) return false
        return try {
            File(path).setExecutable(true, false)
            val pb = ProcessBuilder(path, "-c", "true").redirectErrorStream(true)
            val env = pb.environment()
            if (libDirs.isNotEmpty()) env["LD_LIBRARY_PATH"] = libDirs.joinToString(":")
            val p = pb.start()
            p.inputStream.bufferedReader().readText() // drain to avoid a full pipe blocking the child

            // Bounded wait that works on all API levels (Process.waitFor(timeout) needs API 26).
            val deadline = System.currentTimeMillis() + 2000
            var exit = -1
            while (System.currentTimeMillis() < deadline) {
                try {
                    exit = p.exitValue()
                    break
                } catch (e: IllegalThreadStateException) {
                    Thread.sleep(20)
                }
            }
            if (exit == -1) p.destroy()
            exit == 0
        } catch (e: Exception) {
            // IOException "error=13, Permission denied" / "No such file" end up here.
            false
        }
    }

    fun build(context: Context, workingDir: String? = null): ShellConfig {
        val appCtx = context.applicationContext

        // Highest priority: a full Linux rootfs under proot (gives working apt/dpkg). This is the
        // only way to run real package binaries on Android 10+ where app data is noexec.
        if (ProotEnvironment.isReady(appCtx)) {
            val pc = ProotEnvironment.build(appCtx, workingDir)
            return ShellConfig(
                shellPath = pc.prootPath,
                args = pc.args,
                cwd = pc.cwd,
                env = pc.env,
                isBootstrap = false,
                isProot = true
            )
        }

        val prefix = prefix(appCtx)
        val home = home(appCtx)
        val tmp = "$prefix/tmp"

        File(home).mkdirs()
        File(tmp).mkdirs()

        val termuxPrefix = "/data/data/com.termux/files/usr"
        val appLibs = listOf("$prefix/lib")
        val termuxLibs = listOf("$termuxPrefix/lib")

        val candidates = listOf(
            Candidate("$prefix/bin/bash", appLibs, true, arrayOf("--login")),
            Candidate("$prefix/bin/sh", appLibs, true, arrayOf("-")),
            Candidate("$termuxPrefix/bin/bash", termuxLibs, false, arrayOf("--login")),
            Candidate("$termuxPrefix/bin/sh", termuxLibs, false, arrayOf("-")),
            Candidate("/system/bin/sh", emptyList(), false, emptyArray())
        )

        val chosen = candidates.firstOrNull { canExec(it.path, it.libDirs) }
            ?: candidates.last() // /system/bin/sh — guaranteed to exist

        val isTermux = chosen.path.startsWith(termuxPrefix)

        // System commands (toybox, etc.) — always executable. Non-existent dirs in PATH are ignored.
        val systemBins = listOf(
            "/system/bin", "/system/xbin",
            "/vendor/bin", "/odm/bin",
            "/product/bin", "/system_ext/bin",
            "/apex/com.android.runtime/bin",
            "/apex/com.android.art/bin"
        )

        // Only expose package bin dirs that we KNOW are executable on this device. Otherwise a
        // non-executable binary copied into the app data (e.g. `.../app_exec/bin/ls`) would shadow
        // the working system one and fail with exit code 126 "Permission denied".
        val binDirs = mutableListOf<String>()
        when {
            chosen.isBootstrap -> binDirs.add("$prefix/bin")
            isTermux -> binDirs.add("$termuxPrefix/bin")
        }
        binDirs.addAll(systemBins)

        val activePrefix = when {
            chosen.isBootstrap -> prefix
            isTermux -> termuxPrefix
            else -> "/system"
        }

        val env = mutableListOf(
            "TERM=xterm-256color",
            "COLORTERM=truecolor",
            "HOME=$home",
            "PREFIX=$activePrefix",
            "TMPDIR=$tmp",
            "PATH=${binDirs.joinToString(":")}",
            "SHELL=${chosen.path}",
            "LANG=en_US.UTF-8",
            "ANDROID_ROOT=${System.getenv("ANDROID_ROOT") ?: "/system"}",
            "ANDROID_DATA=${System.getenv("ANDROID_DATA") ?: "/data"}",
            "BOOTCLASSPATH=${System.getenv("BOOTCLASSPATH") ?: ""}"
        )
        if (chosen.libDirs.isNotEmpty()) {
            env.add("LD_LIBRARY_PATH=${chosen.libDirs.joinToString(":")}")
        }
        System.getenv("EXTERNAL_STORAGE")?.let { env.add("EXTERNAL_STORAGE=$it") }

        val cwd = when {
            !workingDir.isNullOrEmpty() && File(workingDir).isDirectory -> workingDir
            File(home).isDirectory -> home
            else -> appCtx.filesDir.absolutePath
        }

        return ShellConfig(chosen.path, chosen.args, cwd, env.toTypedArray(), chosen.isBootstrap)
    }
}
