package expo.modules.aptmanager

import android.content.Context
import android.util.Log
import expo.modules.termuxterminal.ProotEnvironment
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.util.UUID
import java.util.concurrent.Executors

/**
 * Durable, single-flight supervisor for long proot commands.
 *
 * The command is owned by [BackgroundWorkService], not by a React Native promise or a terminal
 * view. Its specification and state are fsynced before execution. If Android recreates the app
 * process, the foreground service reads the state and safely re-runs the command. Long workflows
 * use idempotent shell commands/marker files, so replay after an abrupt process death is safe.
 */
object DetachedJobSupervisor {
    private const val TAG = "DetachedJobSupervisor"
    private const val SCHEMA = 1
    private val lock = Any()
    private val worker = Executors.newSingleThreadExecutor { runnable ->
        Thread(runnable, "nova-detached-job").apply { isDaemon = false }
    }

    @Volatile private var runningJobId: String? = null
    @Volatile private var runningProcess: Process? = null

    private fun jobsDir(context: Context) = File(context.applicationContext.filesDir, "background-jobs").apply { mkdirs() }
    private fun currentFile(context: Context) = File(jobsDir(context), "current.json")
    private fun stateFile(context: Context, id: String) = File(jobsDir(context), "$id.json")
    private fun logFile(context: Context, id: String) = File(jobsDir(context), "$id.log")

    private fun now() = System.currentTimeMillis()

    private fun writeAtomic(file: File, value: JSONObject) {
        file.parentFile?.mkdirs()
        val temp = File(file.parentFile, "${file.name}.tmp")
        FileOutputStream(temp).use { stream ->
            stream.write(value.toString().toByteArray(Charsets.UTF_8))
            stream.fd.sync()
        }
        if (!temp.renameTo(file)) {
            temp.copyTo(file, overwrite = true)
            temp.delete()
        }
    }

    private fun read(file: File): JSONObject? = try {
        if (file.isFile) JSONObject(file.readText()) else null
    } catch (error: Exception) {
        Log.e(TAG, "Cannot read ${file.absolutePath}", error)
        null
    }

    private fun isActive(status: String?) = status == "queued" || status == "running" || status == "stopping"

    private fun persist(context: Context, state: JSONObject) {
        state.put("updatedAt", now())
        writeAtomic(stateFile(context, state.getString("id")), state)
        writeAtomic(currentFile(context), state)
    }

    /** Queue a command, or return the matching active command after a JS/runtime reattachment. */
    fun enqueue(
        context: Context,
        command: String,
        workDir: String?,
        label: String,
        kind: String,
        metadata: String?
    ): Map<String, Any?> {
        require(command.isNotBlank()) { "command must not be blank" }
        val appCtx = context.applicationContext
        val state: JSONObject
        synchronized(lock) {
            val current = read(currentFile(appCtx))
            if (current != null && isActive(current.optString("status"))) {
                val sameCommand = current.optString("command") == command &&
                    current.optString("workDir").ifBlank { null } == workDir?.ifBlank { null }
                if (!sameCommand) {
                    throw IllegalStateException("Another background job is already running: ${current.optString("label")}")
                }
                BackgroundWorkService.startJob(appCtx, current.getString("id"), current.optString("label"))
                return toMap(current, reused = true)
            }

            val id = UUID.randomUUID().toString()
            state = JSONObject().apply {
                put("schema", SCHEMA)
                put("id", id)
                put("command", command)
                put("workDir", workDir ?: "")
                put("label", label.ifBlank { "Background operation" })
                put("kind", kind.ifBlank { "shell" })
                put("metadata", metadata ?: "")
                put("status", "queued")
                put("attempt", 0)
                put("exitCode", JSONObject.NULL)
                put("pid", JSONObject.NULL)
                put("stopRequested", false)
                put("createdAt", now())
                put("updatedAt", now())
            }
            persist(appCtx, state)
        }
        BackgroundWorkService.startJob(appCtx, state.getString("id"), state.getString("label"))
        return toMap(state, reused = false)
    }

    /** Called by the service both for a new job and after Android recreates the process. */
    fun startOrResume(context: Context, requestedId: String? = null) {
        val appCtx = context.applicationContext
        val state: JSONObject
        synchronized(lock) {
            val current = read(currentFile(appCtx)) ?: return
            val id = current.optString("id")
            if (requestedId != null && requestedId != id) return
            if (!isActive(current.optString("status")) || current.optBoolean("stopRequested")) return
            if (runningJobId == id) return
            runningJobId = id
            state = current
        }
        worker.execute { runJob(appCtx, state) }
    }

    private fun runJob(context: Context, initialState: JSONObject) {
        val id = initialState.getString("id")
        var state = initialState
        var exitCode = -1
        try {
            synchronized(lock) {
                state = read(stateFile(context, id)) ?: state
                if (state.optBoolean("stopRequested")) {
                    state.put("status", "cancelled")
                    state.put("exitCode", 130)
                    persist(context, state)
                    return
                }
                state.put("attempt", state.optInt("attempt", 0) + 1)
                state.put("status", "running")
                state.put("exitCode", JSONObject.NULL)
                state.put("pid", JSONObject.NULL)
                persist(context, state)
            }

            val log = logFile(context, id)
            log.parentFile?.mkdirs()
            log.appendText("\n=== ${if (state.optInt("attempt") > 1) "RECOVERED " else ""}ATTEMPT ${state.optInt("attempt")} @ ${now()} ===\n")

            val config = ProotEnvironment.buildCommandProcess(
                context,
                state.getString("command"),
                state.optString("workDir").ifBlank { null }
            )
            val builder = ProcessBuilder(listOf(config.program) + config.argv)
                .directory(File(config.cwd))
                .redirectErrorStream(true)
                .redirectOutput(ProcessBuilder.Redirect.appendTo(log))
            builder.environment().clear()
            builder.environment().putAll(config.env)

            val process = builder.start()
            runningProcess = process
            synchronized(lock) {
                state = read(stateFile(context, id)) ?: state
                // The stable job id is used for reattachment; Linux pids are deliberately not
                // exposed because Android may recreate this process and assign a new child pid.
                state.put("pid", JSONObject.NULL)
                persist(context, state)
            }
            exitCode = process.waitFor()

            synchronized(lock) {
                state = read(stateFile(context, id)) ?: state
                val stopped = state.optBoolean("stopRequested")
                state.put("status", if (stopped) "cancelled" else if (exitCode == 0) "succeeded" else "failed")
                state.put("exitCode", exitCode)
                state.put("pid", JSONObject.NULL)
                persist(context, state)
            }
        } catch (error: Throwable) {
            Log.e(TAG, "Job $id failed", error)
            try { logFile(context, id).appendText("\nSupervisor error: ${error.message ?: error}\n") } catch (_: Exception) {}
            synchronized(lock) {
                state = read(stateFile(context, id)) ?: state
                state.put("status", if (state.optBoolean("stopRequested")) "cancelled" else "failed")
                state.put("exitCode", exitCode)
                state.put("error", error.message ?: error.toString())
                state.put("pid", JSONObject.NULL)
                persist(context, state)
            }
        } finally {
            runningProcess = null
            synchronized(lock) { if (runningJobId == id) runningJobId = null }
            BackgroundWorkService.finishJob(context, id)
        }
    }

    fun stop(context: Context, id: String): Map<String, Any?> {
        val appCtx = context.applicationContext
        synchronized(lock) {
            val state = read(stateFile(appCtx, id)) ?: return mapOf("success" to false, "id" to id)
            state.put("stopRequested", true)
            if (isActive(state.optString("status"))) state.put("status", "stopping")
            persist(appCtx, state)
        }
        if (runningJobId == id) {
            try { runningProcess?.destroy() } catch (_: Exception) {}
            Thread({
                try { Thread.sleep(1_500) } catch (_: InterruptedException) {}
                val process = runningProcess
                if (runningJobId == id && process != null && process.isAlive) {
                    try { process.destroyForcibly() } catch (_: Exception) {}
                }
            }, "nova-detached-job-stop").start()
        }
        return mapOf("success" to true, "id" to id)
    }

    fun current(context: Context): Map<String, Any?> = synchronized(lock) {
        val state = read(currentFile(context.applicationContext))
            ?: return@synchronized mapOf("exists" to false, "status" to "idle")
        toMap(state) + mapOf("exists" to true)
    }

    fun status(context: Context, id: String): Map<String, Any?> = synchronized(lock) {
        val state = read(stateFile(context.applicationContext, id))
            ?: return@synchronized mapOf("exists" to false, "id" to id, "status" to "missing")
        toMap(state) + mapOf("exists" to true)
    }

    fun hasPending(context: Context): Boolean = synchronized(lock) {
        val state = read(currentFile(context.applicationContext))
        state != null && isActive(state.optString("status")) && !state.optBoolean("stopRequested")
    }

    fun pendingLabel(context: Context): String = synchronized(lock) {
        read(currentFile(context.applicationContext))?.optString("label")?.ifBlank { "Background operation" }
            ?: "Background operation"
    }

    fun readLog(context: Context, id: String, offset: Long, maxBytes: Int): Map<String, Any?> {
        val file = logFile(context.applicationContext, id)
        if (!file.isFile) return mapOf("text" to "", "nextOffset" to 0L, "done" to !hasPending(context))
        val safeOffset = offset.coerceIn(0L, file.length())
        val count = minOf(maxBytes.coerceIn(1, 256 * 1024).toLong(), file.length() - safeOffset).toInt()
        val bytes = ByteArray(count)
        var readCount = 0
        java.io.RandomAccessFile(file, "r").use { input ->
            input.seek(safeOffset)
            readCount = input.read(bytes).coerceAtLeast(0)
        }
        val state = synchronized(lock) { read(stateFile(context.applicationContext, id)) }
        return mapOf(
            "text" to String(bytes, 0, readCount, Charsets.UTF_8),
            "nextOffset" to (safeOffset + readCount),
            "done" to (state == null || !isActive(state.optString("status")))
        )
    }

    private fun toMap(state: JSONObject, reused: Boolean? = null): Map<String, Any?> {
        val result = mutableMapOf<String, Any?>(
            "id" to state.optString("id"),
            "command" to state.optString("command"),
            "workDir" to state.optString("workDir"),
            "label" to state.optString("label"),
            "kind" to state.optString("kind"),
            "metadata" to state.optString("metadata"),
            "status" to state.optString("status", "missing"),
            "attempt" to state.optInt("attempt", 0),
            "exitCode" to if (state.isNull("exitCode")) null else state.optInt("exitCode"),
            "createdAt" to state.optLong("createdAt"),
            "updatedAt" to state.optLong("updatedAt"),
            "stopRequested" to state.optBoolean("stopRequested")
        )
        if (reused != null) result["reused"] = reused
        if (state.has("error")) result["error"] = state.optString("error")
        return result
    }
}
