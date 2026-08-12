package expo.modules.termuxterminal

import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File

class TermuxTerminalModule : Module() {

    private fun buildPath(): String {
        val appCtx = appContext.reactContext
        val paths = mutableListOf<String>()
        if (appCtx != null) {
            val prefix = File(appCtx.filesDir, "usr").absolutePath
            paths.add("$prefix/bin")
        }
        paths.add("/data/data/com.termux/files/usr/bin")
        paths.add("/system/bin")
        return paths.joinToString(":")
    }

    private fun runProcess(
        program: String,
        args: List<String>,
        env: Map<String, String>,
        cwd: File?
    ): Map<String, Any> {
        return try {
            val pb = ProcessBuilder(listOf(program) + args).redirectErrorStream(true)
            val childEnv = pb.environment()
            for ((k, v) in env) {
                childEnv[k] = v
            }
            if (cwd != null && cwd.exists()) pb.directory(cwd)

            val process = pb.start()
            val outputBuilder = StringBuilder()
            process.inputStream.bufferedReader().forEachLine { line ->
                outputBuilder.appendLine(line)
                // Forward each line immediately; the Build screen can render a real live log.
                try { sendEvent("commandOutput", mapOf("line" to line)) } catch (_: Exception) {}
            }
            val output = outputBuilder.toString()
            val exitCode = process.waitFor()

            mapOf(
                "success" to (exitCode == 0),
                "exitCode" to exitCode,
                "output" to output
            )
        } catch (e: Exception) {
            mapOf(
                "success" to false,
                "exitCode" to -1,
                "output" to ("Error: " + (e.message ?: "unknown"))
            )
        }
    }

    private fun runShell(cmd: String, workDir: String? = null): Map<String, Any> {
        val appCtx = appContext.reactContext
            ?: return mapOf("success" to false, "exitCode" to -1, "output" to "Error: no react context")

        return try {
            if (ProotEnvironment.isReady(appCtx)) {
                val pc = ProotEnvironment.buildCommandProcess(appCtx, cmd, workDir)
                runProcess(pc.program, pc.argv, pc.env, File(pc.cwd))
            } else {
                val filesDir = appCtx.filesDir.absolutePath
                val prefix = "$filesDir/usr"
                val home = "$filesDir/home"
                val tmpDir = "$prefix/tmp"
                val dir = if (!workDir.isNullOrEmpty()) File(workDir) else File(home)
                val path = buildPath()

                val fullCmd = "export PREFIX=\"$prefix\" && " +
                    "export HOME=\"$home\" && " +
                    "export TMPDIR=\"$tmpDir\" && " +
                    "export PATH=\"$path:\$PATH\" && " +
                    "export TERM=xterm-256color && " +
                    "cd \"$home\" 2>/dev/null && " +
                    cmd

                val pb = ProcessBuilder("sh", "-c", fullCmd).redirectErrorStream(true)
                if (dir.exists()) pb.directory(dir)
                val process = pb.start()
                val output = process.inputStream.bufferedReader().readText()
                val exitCode = process.waitFor()

                mapOf(
                    "success" to (exitCode == 0),
                    "exitCode" to exitCode,
                    "output" to output
                )
            }
        } catch (e: Exception) {
            mapOf(
                "success" to false,
                "exitCode" to -1,
                "output" to ("Error: " + (e.message ?: "unknown"))
            )
        }
    }

    override fun definition() = ModuleDefinition {
        Name("TermuxTerminal")
        Events("commandOutput")

        View(TermuxTerminalView::class) {
            Events("onTerminalEvent")

            Prop("fontSize") { view: TermuxTerminalView, value: Int? ->
                if (value != null) view.setFontSizeProp(value)
            }
            Prop("workingDirectory") { view: TermuxTerminalView, value: String? ->
                view.setWorkingDirectory(value)
            }
            Prop("initialCommand") { view: TermuxTerminalView, value: String? ->
                view.setInitialCommand(value)
            }
            Prop("extraKeys") { view: TermuxTerminalView, value: String? ->
                view.setExtraKeys(value)
            }
            Prop("readOnly") { view: TermuxTerminalView, value: Boolean? ->
                view.setReadOnly(value ?: false)
            }

            AsyncFunction("writeText") { view: TermuxTerminalView, text: String ->
                view.writeText(text)
            }
            AsyncFunction("sendKey") { view: TermuxTerminalView, key: String ->
                view.sendKey(key)
            }
            AsyncFunction("restart") { view: TermuxTerminalView ->
                view.restart()
            }
            AsyncFunction("toggleKeyboard") { view: TermuxTerminalView ->
                view.toggleKeyboard()
            }
            AsyncFunction("pasteFromClipboard") { view: TermuxTerminalView ->
                view.pasteFromClipboard()
            }
            AsyncFunction("copyTranscriptToClipboard") { view: TermuxTerminalView ->
                view.copyTranscriptToClipboard()
            }
            AsyncFunction("getTranscriptText") { view: TermuxTerminalView ->
                view.getTranscriptText()
            }
        }

        AsyncFunction("prepareProot") Coroutine { force: Boolean ->
            withContext(Dispatchers.IO) {
                val ctx = appContext.reactContext
                if (ctx == null) {
                    mapOf("success" to false, "output" to "no react context")
                } else {
                    val (code, output) = ProotEnvironment.prepareRootfs(ctx, force, 300_000L)
                    mapOf(
                        "success" to (code == 0),
                        "exitCode" to code,
                        "output" to output
                    )
                }
            }
        }

        AsyncFunction("getProotStatus") Coroutine { ->
            withContext(Dispatchers.IO) {
                val ctx = appContext.reactContext
                if (ctx == null) {
                    mapOf(
                        "prootBinary" to false,
                        "rootfsInstalled" to false,
                        "ready" to false,
                        "nativeLibDir" to "",
                        "rootfsDir" to "",
                        "rootfsArch" to 0,
                        "prootArch" to 0
                    )
                } else {
                    mapOf(
                        "prootBinary" to ProotEnvironment.isProotBinaryAvailable(ctx),
                        "rootfsInstalled" to ProotEnvironment.isRootfsInstalled(ctx),
                        "ready" to ProotEnvironment.isReady(ctx),
                        "nativeLibDir" to ProotEnvironment.nativeLibDir(ctx),
                        "rootfsDir" to ProotEnvironment.rootfsDir(ctx).absolutePath,
                        "rootfsArch" to (ProotEnvironment.rootfsArch(ctx) ?: 0),
                        "prootArch" to (ProotEnvironment.prootArch(ctx) ?: 0)
                    )
                }
            }
        }

        AsyncFunction("diagnoseProot") Coroutine { ->
            withContext(Dispatchers.IO) {
                val ctx = appContext.reactContext
                if (ctx == null) {
                    return@withContext mapOf(
                        "ok" to false,
                        "output" to "no react context"
                    )
                }

                val proot = ProotEnvironment.prootBinary(ctx)
                val arch = try {
                    android.os.Build.SUPPORTED_ABIS.joinToString(",")
                } catch (_: Exception) { "?" }

                val sb = StringBuilder()
                sb.appendLine("ABI: $arch")
                sb.appendLine("nativeLibDir: ${ProotEnvironment.nativeLibDir(ctx)}")
                sb.appendLine("proot: ${if (proot.exists()) proot.absolutePath else "NOT FOUND"}")
                sb.appendLine("rootfs installed: ${ProotEnvironment.isRootfsInstalled(ctx)}")
                sb.appendLine("rootfs arch: ${ProotEnvironment.rootfsArch(ctx) ?: 0}")
                sb.appendLine("proot arch: ${ProotEnvironment.prootArch(ctx) ?: 0}")

                sb.appendLine()
                sb.appendLine("=== proot smoke test ===")
                sb.append(ProotEnvironment.runSmokeTest(ctx))

                val ok = sb.contains("exit=0")

                mapOf(
                    "ok" to ok,
                    "output" to sb.toString(),
                    "arch" to arch,
                    "prootExists" to proot.exists(),
                    "rootfsInstalled" to ProotEnvironment.isRootfsInstalled(ctx),
                    "rootfsArch" to (ProotEnvironment.rootfsArch(ctx) ?: 0),
                    "prootArch" to (ProotEnvironment.prootArch(ctx) ?: 0)
                )
            }
        }

        AsyncFunction("copyToClipboard") { text: String ->
            val ctx = appContext.reactContext
            if (ctx != null) {
                val cm = ctx.getSystemService(android.content.Context.CLIPBOARD_SERVICE) as? android.content.ClipboardManager
                cm?.setPrimaryClip(android.content.ClipData.newPlainText("terminal", text))
            }
        }

        AsyncFunction("execute") Coroutine { command: String, workDir: String? ->
            withContext(Dispatchers.IO) { runShell(command, workDir) }
        }

        AsyncFunction("checkCommand") Coroutine { command: String ->
            withContext(Dispatchers.IO) {
                val res = runShell("command -v $command 2>/dev/null")
                val output = (res["output"] as? String ?: "").trim()
                val exitCode = res["exitCode"] as? Int ?: -1
                mapOf(
                    "exists" to (exitCode == 0 && output.isNotEmpty()),
                    "path" to output
                )
            }
        }

        AsyncFunction("getNodeVersion") Coroutine { ->
            withContext(Dispatchers.IO) {
                val ctx = appContext.reactContext
                if (ctx != null && ProotEnvironment.isReady(ctx)) {
                    val res = runShell("node --version 2>/dev/null")
                    val output = (res["output"] as? String ?: "").trim()
                    val exitCode = res["exitCode"] as? Int ?: -1
                    if (exitCode == 0 && output.startsWith("v")) {
                        return@withContext mapOf(
                            "version" to output,
                            "path" to "proot:/usr/bin/node"
                        )
                    }
                }
                mapOf("version" to null, "path" to "")
            }
        }

        AsyncFunction("installNode") Coroutine { ->
            withContext(Dispatchers.IO) {
                val log = StringBuilder()
                var success = false
                var version: String? = null
                val ctx = appContext.reactContext

                try {
                    if (ctx != null && ProotEnvironment.isReady(ctx)) {
                        log.appendLine("[1/2] Installing nodejs via apt inside proot rootfs...")
                        val install = runShell(
                            "export DEBIAN_FRONTEND=noninteractive; " +
                                "apt-get update && apt-get install -y nodejs npm"
                        )
                        log.appendLine(install["output"] as? String ?: "")

                        val check = runShell("node --version 2>/dev/null")
                        if (check["success"] == true) {
                            version = (check["output"] as String).trim()
                            log.appendLine("[2/2] SUCCESS: $version")
                            success = true
                        } else {
                            log.appendLine("[2/2] FAILED")
                            log.appendLine(check["output"] as? String ?: "")
                        }
                    } else {
                        log.appendLine("proot rootfs not ready")
                    }
                } catch (e: Exception) {
                    log.appendLine("Error: ${e.message}")
                }

                mapOf(
                    "success" to success,
                    "output" to log.toString(),
                    "version" to version
                )
            }
        }
    }
}