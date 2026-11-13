package com.example.dhruvaguardian

import android.Manifest
import android.app.KeyguardManager
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import android.provider.Settings
import android.telecom.TelecomManager
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import org.json.JSONObject
import java.io.BufferedReader
import java.net.HttpURLConnection
import java.net.URL

class GuardianService : Service() {

    private val serviceScope = CoroutineScope(Dispatchers.IO + SupervisorJob())
    private var pollingJob: Job? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        Log.d(TAG, "GuardianService onCreate: initializing foreground service")
        createNotificationChannels()
        val notification = buildForegroundNotification()

        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
                startForeground(
                    NOTIFICATION_ID_SERVICE,
                    notification,
                    ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE
                )
            } else {
                startForeground(NOTIFICATION_ID_SERVICE, notification)
            }
            Log.d(TAG, "GuardianService successfully entered foreground mode")
        } catch (e: Exception) {
            Log.e(TAG, "GuardianService error entering foreground: ${e.message}", e)
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        Log.d(TAG, "GuardianService onStartCommand (startId=$startId, flags=$flags)")
        startPollingLoop()
        return START_STICKY
    }

    override fun onDestroy() {
        Log.d(TAG, "GuardianService onDestroy: stopping background work")
        serviceScope.cancel()
        super.onDestroy()
    }

    private fun startPollingLoop() {
        if (pollingJob?.isActive == true) {
            Log.d(TAG, "GuardianService polling loop is already running")
            return
        }

        pollingJob = serviceScope.launch {
            Log.d(TAG, "GuardianService: background polling loop started (interval=3000ms)")
            val prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

            while (isActive) {
                try {
                    val eventObj = pollAlert()
                    if (eventObj != null) {
                        val level = eventObj.optString("level", "green")
                        val alertId = eventObj.optString("id", "")
                        val reason = eventObj.optString("reason", "")
                        val message = eventObj.optString("message", "")
                        val matched = run {
                            val arr = eventObj.optJSONArray("matched")
                            if (arr != null && arr.length() > 0) {
                                (0 until arr.length()).map { arr.optString(it) }.joinToString(", ")
                            } else {
                                eventObj.optString("matched", "")
                            }
                        }

                        Log.d(
                            TAG,
                            "GuardianService polled event: level='$level', id='$alertId', isActivityVisible=$isActivityVisible"
                        )

                        if (level.equals("red", ignoreCase = true) && alertId.isNotEmpty()) {
                            val lastHandledId = prefs.getString(KEY_LAST_SHOWN_ALERT_ID, "") ?: ""
                            if (alertId != lastHandledId) {
                                Log.d(
                                    TAG,
                                    "GuardianService: NEW RED alert detected! id='$alertId' (lastHandledId='$lastHandledId')"
                                )

                                // Step 1: Save the id first (so it is handled once)
                                val editor = prefs.edit().putString(KEY_LAST_SHOWN_ALERT_ID, alertId)
                                if (ENABLE_PAYMENT_BLOCK) {
                                    val now = System.currentTimeMillis()
                                    val protectedUntil = now + PROTECTED_MODE_DURATION_MS
                                    editor.putBoolean(KEY_PROTECTED_MODE, true)
                                        .putLong(KEY_PROTECTED_UNTIL, protectedUntil)
                                        .putLong("protected_mode_timestamp", now)
                                    Log.d(TAG, "GuardianService: Protected mode saved until $protectedUntil (alertId='$alertId')")
                                } else {
                                    Log.d(TAG, "GuardianService: ENABLE_PAYMENT_BLOCK is false, skipping protected mode prefs")
                                }
                                editor.apply()
                                Log.d(TAG, "GuardianService: Step 1 -> Saved alert id='$alertId' (handled once)")

                                // Step 2: END THE CALL before showing the alert
                                val (callEnded, callFailedOrDenied) = endActiveCallIfAny()
                                Log.d(
                                    TAG,
                                    "GuardianService: Step 2 -> End call finished (callEnded=$callEnded, callFailedOrDenied=$callFailedOrDenied)"
                                )

                                // Step 3: Show the warning
                                val displayMessage = if (message.isNotBlank()) message else "Possible digital-arrest scam"
                                val displayReason = when {
                                    reason.isNotBlank() -> reason
                                    matched.isNotBlank() -> matched
                                    else -> "Suspicious scam call pattern detected"
                                }

                                triggerAlert(alertId, displayMessage, displayReason, callEnded, callFailedOrDenied)
                                Log.d(TAG, "GuardianService: Step 3 -> Show warning triggered")
                            } else {
                                Log.d(TAG, "GuardianService: alert id='$alertId' already handled (lastHandledId='$lastHandledId')")
                            }
                        }
                    }
                } catch (e: Exception) {
                    Log.w(TAG, "GuardianService poll loop caught exception: ${e.message}")
                }

                delay(3000)
            }
        }
    }

    @Suppress("DEPRECATION")
    private fun endActiveCallIfAny(): Pair<Boolean, Boolean> {
        val hasAnswerCalls = ContextCompat.checkSelfPermission(
            this,
            Manifest.permission.ANSWER_PHONE_CALLS
        ) == PackageManager.PERMISSION_GRANTED

        val hasReadPhoneState = ContextCompat.checkSelfPermission(
            this,
            Manifest.permission.READ_PHONE_STATE
        ) == PackageManager.PERMISSION_GRANTED

        Log.d(
            TAG,
            "GuardianService: Checking call permissions -> ANSWER_PHONE_CALLS=$hasAnswerCalls, READ_PHONE_STATE=$hasReadPhoneState"
        )

        if (!hasAnswerCalls || !hasReadPhoneState) {
            Log.w(
                TAG,
                "GuardianService: Cannot end call - required permissions missing (ANSWER_PHONE_CALLS=$hasAnswerCalls, READ_PHONE_STATE=$hasReadPhoneState)"
            )
            return Pair(false, true)
        }

        val telecomManager = getSystemService(Context.TELECOM_SERVICE) as? TelecomManager
        if (telecomManager == null) {
            Log.w(TAG, "GuardianService: TelecomManager is null, cannot check/end call")
            return Pair(false, true)
        }

        return try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                val inCall = telecomManager.isInCall
                Log.d(TAG, "GuardianService: TelecomManager.isInCall = $inCall")
                if (!inCall) {
                    Log.d(TAG, "GuardianService: No active phone call in progress (isInCall=false). Doing nothing.")
                    Pair(false, false)
                } else {
                    Log.d(TAG, "GuardianService: Active call detected (isInCall=true). Attempting TelecomManager.endCall()...")
                    val success = telecomManager.endCall()
                    Log.d(TAG, "GuardianService: TelecomManager.endCall() result = $success")
                    Pair(success, !success)
                }
            } else {
                Log.w(TAG, "GuardianService: TelecomManager.endCall() requires Android 9 (API 28)+")
                Pair(false, true)
            }
        } catch (e: SecurityException) {
            Log.w(TAG, "GuardianService: SecurityException in TelecomManager.endCall(): ${e.message}", e)
            Pair(false, true)
        } catch (e: Exception) {
            Log.w(TAG, "GuardianService: Exception in TelecomManager.endCall(): ${e.message}", e)
            Pair(false, true)
        }
    }

    private fun triggerAlert(
        alertId: String,
        message: String,
        reason: String,
        callEnded: Boolean,
        callFailedOrDenied: Boolean
    ) {
        Log.d(TAG, "GuardianService: triggerAlert initiated for alert id='$alertId'")

        val notificationManager = getSystemService(NotificationManager::class.java)
        val powerManager = getSystemService(Context.POWER_SERVICE) as? PowerManager
        val keyguardManager = getSystemService(Context.KEYGUARD_SERVICE) as? KeyguardManager

        // Diagnosis 1: Full-Screen Intent Permission
        val canUseFsi = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            notificationManager?.canUseFullScreenIntent() ?: false
        } else {
            true
        }
        Log.d(TAG, "GuardianService [Diagnosis]: canUseFullScreenIntent() = $canUseFsi")

        // Diagnosis 2: Overlay Permission (Display over other apps)
        val canDrawOverlays = Settings.canDrawOverlays(this)
        Log.d(TAG, "GuardianService [Diagnosis]: Settings.canDrawOverlays() = $canDrawOverlays")

        // Diagnosis 3: Screen Interactive & Keyguard State
        val isInteractive = powerManager?.isInteractive ?: false
        val isKeyguardLocked = keyguardManager?.isKeyguardLocked ?: false
        val isDeviceLocked = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP_MR1) {
            keyguardManager?.isDeviceLocked ?: false
        } else {
            false
        }
        Log.d(
            TAG,
            "GuardianService [Diagnosis]: isInteractive=$isInteractive, isKeyguardLocked=$isKeyguardLocked, isDeviceLocked=$isDeviceLocked"
        )

        // 1. Wake up device CPU and screen hardware
        wakeDevice()

        // 2. Prepare Intent for AlertActivity (full-screen over-lockscreen alert)
        val alertIntent = Intent(this, AlertActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or
                    Intent.FLAG_ACTIVITY_CLEAR_TOP or
                    Intent.FLAG_ACTIVITY_SINGLE_TOP
            putExtra(EXTRA_ALERT_ID, alertId)
            putExtra(EXTRA_ALERT_MESSAGE, message)
            putExtra(EXTRA_ALERT_REASON, reason)
            putExtra(EXTRA_CALL_ENDED, callEnded)
            putExtra(EXTRA_CALL_FAILED_OR_DENIED, callFailedOrDenied)
        }

        // 3. Attempt direct background activity launch & log result or exception
        try {
            startActivity(alertIntent)
            Log.d(TAG, "GuardianService [Diagnosis]: Direct startActivity(AlertActivity) SUCCEEDED")
        } catch (e: Exception) {
            Log.w(
                TAG,
                "GuardianService [Diagnosis]: Direct startActivity FAILED with ${e.javaClass.name}: ${e.message}",
                e
            )
        }

        // 4. Post high-importance full-screen-intent notification
        postFullScreenAlertNotification(alertId, message, reason, callEnded, callFailedOrDenied, alertIntent, notificationManager)
    }

    private fun wakeDevice() {
        try {
            val powerManager = getSystemService(Context.POWER_SERVICE) as? PowerManager
            @Suppress("DEPRECATION")
            val wakeLock = powerManager?.newWakeLock(
                PowerManager.FULL_WAKE_LOCK or PowerManager.ACQUIRE_CAUSES_WAKEUP or PowerManager.ON_AFTER_RELEASE,
                "$TAG:AlertWakeLock"
            )
            wakeLock?.acquire(5000) // 5 seconds auto-release
            Log.d(TAG, "GuardianService: Acquired temporary wakeLock to turn screen on")
        } catch (e: Exception) {
            Log.w(TAG, "GuardianService: Failed to acquire wake lock: ${e.message}")
        }
    }

    private fun postFullScreenAlertNotification(
        alertId: String,
        message: String,
        reason: String,
        callEnded: Boolean,
        callFailedOrDenied: Boolean,
        alertIntent: Intent,
        notificationManager: NotificationManager?
    ) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = notificationManager?.getNotificationChannel(CHANNEL_ID_ALERTS)
            Log.d(
                TAG,
                "GuardianService [Diagnosis]: Channel id='${channel?.id}', " +
                "importance=${channel?.importance}, lockscreenVisibility=${channel?.lockscreenVisibility}"
            )
        }

        val fullScreenPendingIntent = PendingIntent.getActivity(
            this,
            alertId.hashCode(),
            alertIntent,
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )

        val callNotice = when {
            callEnded -> "Scam call disconnected automatically."
            callFailedOrDenied -> "⚠️ HANG UP NOW! End the active call immediately."
            else -> ""
        }

        val bodyText = buildString {
            if (reason.isNotBlank()) append("Warning: $reason") else append(message)
            if (callNotice.isNotBlank()) append(" $callNotice")
        }

        val notification = NotificationCompat.Builder(this, CHANNEL_ID_ALERTS)
            .setContentTitle("🚨 SCAM ALERT: $message")
            .setContentText(bodyText)
            .setStyle(
                NotificationCompat.BigTextStyle()
                    .bigText("SCAM ALERT!\n$bodyText\nReal police never demand money transfers or isolation. Tap to view.")
            )
            .setSmallIcon(android.R.drawable.stat_notify_error)
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setCategory(NotificationCompat.CATEGORY_ALARM)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setFullScreenIntent(fullScreenPendingIntent, true)
            .setDefaults(NotificationCompat.DEFAULT_ALL)
            .setAutoCancel(true)
            .build()

        notificationManager?.notify(NOTIFICATION_ID_ALERT, notification)
        Log.d(TAG, "GuardianService: High-importance full-screen-intent notification posted for alert id='$alertId'")
    }

    private fun pollAlert(): JSONObject? {
        var connection: HttpURLConnection? = null
        return try {
            val url = URL("$BACKEND_BASE_URL/poll?code=$FAMILY_CODE")
            connection = (url.openConnection() as HttpURLConnection).apply {
                requestMethod = "GET"
                connectTimeout = 3000
                readTimeout = 3000
                instanceFollowRedirects = false
                setRequestProperty("Connection", "close")
            }

            val code = connection.responseCode
            if (code == 200) {
                val response = connection.inputStream.bufferedReader().use(BufferedReader::readText)
                val json = JSONObject(response)
                json.optJSONObject("event")
            } else {
                val err = connection.errorStream?.bufferedReader()?.use(BufferedReader::readText) ?: ""
                Log.w(TAG, "GuardianService poll received non-200 code=$code, error='$err'")
                null
            }
        } catch (e: Exception) {
            Log.w(TAG, "GuardianService poll network exception: ${e.message}")
            null
        } finally {
            connection?.disconnect()
        }
    }

    private fun createNotificationChannels() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val notificationManager = getSystemService(NotificationManager::class.java)

            // 1. Persistent Low-Priority Service Channel
            val serviceChannel = NotificationChannel(
                CHANNEL_ID_SERVICE,
                CHANNEL_NAME_SERVICE,
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "Dhruva background protection service indicator"
                setShowBadge(false)
            }

            // 2. Fresh High-Importance Urgent Scam Alert Channel
            val alertChannel = NotificationChannel(
                CHANNEL_ID_ALERTS,
                CHANNEL_NAME_ALERTS,
                NotificationManager.IMPORTANCE_HIGH
            ).apply {
                description = "Urgent alerts when a digital-arrest scam call is detected"
                enableVibration(true)
                vibrationPattern = longArrayOf(0, 500, 250, 500)
                setShowBadge(true)
                lockscreenVisibility = Notification.VISIBILITY_PUBLIC
                setBypassDnd(true)
            }

            notificationManager?.createNotificationChannel(serviceChannel)
            notificationManager?.createNotificationChannel(alertChannel)
            Log.d(TAG, "GuardianService: Created notification channels (Alert channel: $CHANNEL_ID_ALERTS, IMPORTANCE_HIGH)")
        }
    }

    private fun buildForegroundNotification(): Notification {
        val pendingIntent = PendingIntent.getActivity(
            this,
            0,
            Intent(this, MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
            },
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )

        return NotificationCompat.Builder(this, CHANNEL_ID_SERVICE)
            .setContentTitle("Dhruva Guardian")
            .setContentText("Dhruva Guardian is protecting you")
            .setSmallIcon(android.R.drawable.sym_def_app_icon)
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setContentIntent(pendingIntent)
            .build()
    }
}
