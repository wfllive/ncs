package expo.modules.aptmanager

import android.app.AlarmManager
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.net.wifi.WifiManager
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import android.os.SystemClock
import java.util.UUID

/**
 * Foreground owner for rootfs downloads, RAI setup, and Gradle/build commands.
 *
 * A partial wake lock and high-performance Wi-Fi lock protect ordinary native work while the
 * display is off. Durable shell commands are additionally owned by [DetachedJobSupervisor]: their
 * specifications survive React Native teardown and process death, and this service reattaches or
 * replays them when Android recreates it.
 */
class BackgroundWorkService : Service() {

    companion object {
        const val CHANNEL_ID = "compose-studio-background-work"
        const val NOTIFICATION_ID = 1001
        const val ACTION_START = "expo.modules.aptmanager.action.START_WORK"
        const val ACTION_UPDATE = "expo.modules.aptmanager.action.UPDATE_WORK"
        const val ACTION_STOP = "expo.modules.aptmanager.action.STOP_WORK"
        const val ACTION_RUN_JOB = "expo.modules.aptmanager.action.RUN_JOB"
        const val ACTION_RUN_ROOTFS = "expo.modules.aptmanager.action.RUN_ROOTFS"
        const val ACTION_FINISH_JOB = "expo.modules.aptmanager.action.FINISH_JOB"
        const val EXTRA_TEXT = "extra_text"
        const val EXTRA_JOB_ID = "extra_job_id"
        private const val PREFS = "nova_background_work"
        private const val KEY_ACTIVE = "active"
        private const val KEY_TEXT = "text"
        private const val KEY_JOB_ID = "job_id"
        private const val KEY_OWNER = "process_owner"
        private val PROCESS_OWNER = UUID.randomUUID().toString()

        @Volatile var currentText: String = "Фоновая задача выполняется"
        private var wakeLock: PowerManager.WakeLock? = null
        private var wifiLock: WifiManager.WifiLock? = null

        /** Creates the channel before Android 13 asks the user for notification access. */
        fun ensureNotificationChannel(context: Context) {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
            val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            nm.createNotificationChannel(
                NotificationChannel(
                    CHANNEL_ID,
                    "Фоновые задачи (установка/сборка)",
                    NotificationManager.IMPORTANCE_LOW
                ).apply {
                    description = "Держит установку и сборку работающими в фоне"
                    setShowBadge(false)
                }
            )
        }

        private fun saveState(context: Context, active: Boolean, text: String = currentText, jobId: String? = null) {
            context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
                .putBoolean(KEY_ACTIVE, active)
                .putString(KEY_TEXT, text)
                .putString(KEY_JOB_ID, jobId ?: "")
                .putString(KEY_OWNER, PROCESS_OWNER)
                .apply()
        }

        fun status(context: Context): Map<String, Any> {
            val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            return mapOf(
                "active" to prefs.getBoolean(KEY_ACTIVE, false),
                "text" to (prefs.getString(KEY_TEXT, currentText) ?: currentText),
                "jobId" to (prefs.getString(KEY_JOB_ID, "") ?: "")
            )
        }

        fun start(context: Context, text: String) {
            currentText = text
            saveState(context, true, text)
            dispatch(context, Intent(context, BackgroundWorkService::class.java)
                .setAction(ACTION_START)
                .putExtra(EXTRA_TEXT, text), foreground = true)
        }

        fun startJob(context: Context, id: String, label: String) {
            currentText = label
            saveState(context, true, label, id)
            dispatch(context, Intent(context, BackgroundWorkService::class.java)
                .setAction(ACTION_RUN_JOB)
                .putExtra(EXTRA_JOB_ID, id)
                .putExtra(EXTRA_TEXT, label), foreground = true)
        }

        fun finishJob(context: Context, id: String) {
            try {
                context.startService(Intent(context, BackgroundWorkService::class.java)
                    .setAction(ACTION_FINISH_JOB)
                    .putExtra(EXTRA_JOB_ID, id))
            } catch (_: Exception) {
                if (!DetachedJobSupervisor.hasPending(context)) saveState(context, false)
            }
        }

        fun update(context: Context, text: String) {
            currentText = text
            val jobId = status(context)["jobId"] as? String
            saveState(context, true, text, jobId?.ifBlank { null })
            try {
                context.startService(Intent(context, BackgroundWorkService::class.java)
                    .setAction(ACTION_UPDATE)
                    .putExtra(EXTRA_TEXT, text))
            } catch (_: Exception) {}
        }

        fun stop(context: Context) {
            saveState(context, false)
            try {
                context.startService(Intent(context, BackgroundWorkService::class.java).setAction(ACTION_STOP))
            } catch (_: Exception) {
                releaseLocks()
            }
        }

        private fun dispatch(context: Context, intent: Intent, foreground: Boolean) {
            ensureNotificationChannel(context)
            if (foreground && Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) context.startForegroundService(intent)
            else context.startService(intent)
        }

        private fun releaseLocks() {
            try { wakeLock?.let { if (it.isHeld) it.release() } } catch (_: Exception) {}
            try { wifiLock?.let { if (it.isHeld) it.release() } } catch (_: Exception) {}
            wakeLock = null
            wifiLock = null
        }
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        ensureNotificationChannel(this)
        acquireLocks()
    }

    override fun onDestroy() {
        super.onDestroy()
        releaseLocks()
    }

    /**
     * Android 15+ limits dataSync foreground services to six hours in a rolling 24-hour window.
     * Stop promptly when the system reports that limit instead of triggering the platform's
     * RemoteServiceException. Ordinary installs/builds finish well below this boundary.
     */
    override fun onTimeout(startId: Int, fgsType: Int) {
        val reason = "Android background-work time limit reached; reopen NovaCompose and retry to resume"
        val current = DetachedJobSupervisor.current(this)
        val jobId = (current["id"] as? String)?.ifBlank { null }
        if (jobId != null) DetachedJobSupervisor.stop(this, jobId)
        RootfsInstallSupervisor.pauseForSystemLimit(this, reason)
        shutdown(reason)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val prefs = getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val persisted = status(this)
        val action = intent?.action
        val jobId = intent?.getStringExtra(EXTRA_JOB_ID)
            ?: (persisted["jobId"] as? String)?.ifBlank { null }
        val text = intent?.getStringExtra(EXTRA_TEXT)
            ?: persisted["text"] as? String
            ?: DetachedJobSupervisor.pendingLabel(this)
        currentText = text

        if (action == ACTION_STOP) {
            jobId?.let { DetachedJobSupervisor.stop(this, it) }
            shutdown(text)
            return START_NOT_STICKY
        }

        if (action == ACTION_FINISH_JOB) {
            if (!DetachedJobSupervisor.hasPending(this) && !RootfsInstallSupervisor.hasPending(this)) {
                shutdown(text)
                return START_NOT_STICKY
            }
        }

        val hasDurableJob = DetachedJobSupervisor.hasPending(this)
        val hasRootfsInstall = RootfsInstallSupervisor.hasPending(this)
        val hasDurableWork = hasDurableJob || hasRootfsInstall
        val ownerMatches = prefs.getString(KEY_OWNER, "") == PROCESS_OWNER
        // A redelivered generic JS-owned operation cannot be resumed after full process death.
        // Do not leave a misleading, never-ending notification. Durable work is resumed below.
        if (!hasDurableWork && !ownerMatches && action != ACTION_UPDATE) {
            shutdown(text)
            return START_NOT_STICKY
        }

        val durableText = when {
            hasDurableJob -> DetachedJobSupervisor.pendingLabel(this)
            hasRootfsInstall -> RootfsInstallSupervisor.pendingLabel(this)
            else -> text
        }
        currentText = durableText
        saveState(this, true, durableText, if (hasDurableJob) jobId else null)
        acquireLocks()
        startForegroundCompat(durableText)
        if (hasDurableJob) DetachedJobSupervisor.startOrResume(this, jobId)
        if (hasRootfsInstall) RootfsInstallSupervisor.resumeIfNeeded(this)
        return START_REDELIVER_INTENT
    }

    private fun shutdown(text: String) {
        saveState(this, false, text)
        stopForegroundCompat()
        stopSelf()
    }

    /** Re-arm service ownership when an OEM removes the recent-app task. */
    override fun onTaskRemoved(rootIntent: Intent?) {
        super.onTaskRemoved(rootIntent)
        if (status(this)["active"] != true) return
        try {
            val current = DetachedJobSupervisor.current(this)
            val pendingId = if (DetachedJobSupervisor.hasPending(this)) current["id"] as? String else null
            val hasRootfsInstall = RootfsInstallSupervisor.hasPending(this)
            val restart = Intent(this, BackgroundWorkService::class.java)
                .setAction(when {
                    pendingId != null -> ACTION_RUN_JOB
                    hasRootfsInstall -> ACTION_RUN_ROOTFS
                    else -> ACTION_START
                })
                .putExtra(EXTRA_JOB_ID, pendingId)
                .putExtra(EXTRA_TEXT, currentText)
            val pending = PendingIntent.getService(
                this, NOTIFICATION_ID, restart,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
            (getSystemService(Context.ALARM_SERVICE) as AlarmManager).setAndAllowWhileIdle(
                AlarmManager.ELAPSED_REALTIME_WAKEUP,
                SystemClock.elapsedRealtime() + 1_000L,
                pending
            )
        } catch (_: Exception) {}
    }

    private fun acquireLocks() {
        try {
            if (wakeLock?.isHeld != true) {
                val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
                Companion.wakeLock = pm.newWakeLock(
                    PowerManager.PARTIAL_WAKE_LOCK,
                    "compose-studio:background-work"
                ).apply {
                    setReferenceCounted(false)
                    acquire(8 * 60 * 60 * 1000L)
                }
            }
        } catch (_: Exception) {}
        try {
            if (wifiLock?.isHeld != true) {
                val wm = applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager
                @Suppress("DEPRECATION")
                Companion.wifiLock = wm.createWifiLock(
                    WifiManager.WIFI_MODE_FULL_HIGH_PERF,
                    "compose-studio:network"
                ).apply {
                    setReferenceCounted(false)
                    acquire()
                }
            }
        } catch (_: Exception) {}
    }

    private fun startForegroundCompat(text: String) {
        val notification = buildNotification(text)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }
    }

    private fun stopForegroundCompat() {
        try { stopForeground(STOP_FOREGROUND_REMOVE) } catch (_: Exception) {}
    }

    private fun buildNotification(text: String): Notification {
        val openIntent = packageManager.getLaunchIntentForPackage(packageName)
        val contentIntent = if (openIntent != null) PendingIntent.getActivity(
            this, 0, openIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        ) else null
        val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Notification.Builder(this, CHANNEL_ID)
        } else {
            @Suppress("DEPRECATION") Notification.Builder(this).setPriority(Notification.PRIORITY_LOW)
        }
        builder
            .setSmallIcon(android.R.drawable.stat_sys_download)
            .setContentTitle("NovaCompose Studio")
            .setContentText(text)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setCategory(Notification.CATEGORY_PROGRESS)
            .setVisibility(Notification.VISIBILITY_PUBLIC)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            builder.setForegroundServiceBehavior(Notification.FOREGROUND_SERVICE_IMMEDIATE)
        }
        if (contentIntent != null) builder.setContentIntent(contentIntent)
        return builder.build()
    }
}
