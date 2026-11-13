package com.example.dhruvaguardian

import android.accessibilityservice.AccessibilityService
import android.content.Context
import android.content.Intent
import android.util.Log
import android.view.accessibility.AccessibilityEvent
import android.widget.Toast

/**
 * AccessibilityService that listens only to window state change events
 * and intercepts payment apps when Protected Mode is active.
 */
class GuardianAccessibilityService : AccessibilityService() {

    private var lastInterceptTime: Long = 0L

    override fun onServiceConnected() {
        super.onServiceConnected()
        Log.d(TAG, "GuardianAccessibilityService: Connected and monitoring window state changes")
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        if (!ENABLE_PAYMENT_BLOCK) return

        if (event == null || event.eventType != AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) {
            return
        }

        val rawPkg = event.packageName ?: return
        val packageName = rawPkg.toString()

        // 1. Never block dialer, emergency calling, system apps, or our own app
        if (packageName == applicationContext.packageName) {
            return
        }

        // 2. Only intercept designated payment apps
        if (!BLOCKED_PAYMENT_PACKAGES.contains(packageName)) {
            return
        }

        // 3. Check protected mode status
        val prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val protectedUntil = prefs.getLong(KEY_PROTECTED_UNTIL, 0L)
        val now = System.currentTimeMillis()

        if (now >= protectedUntil) {
            // Protected mode is off or expired -> do nothing at all
            Log.d(TAG, "GuardianAccessibilityService: Payment app $packageName opened, but protected mode is off. Doing nothing.")
            return
        }

        // 4. Cooldown to prevent duplicate triggers / navigation loops
        if (now - lastInterceptTime < PAYMENT_BLOCK_COOLDOWN_MS) {
            Log.d(TAG, "GuardianAccessibilityService: Cooldown active for $packageName, skipping duplicate intercept")
            return
        }
        lastInterceptTime = now

        val remainingMinutes = ((protectedUntil - now) / 60000L) + 1
        Log.w(
            TAG,
            "GuardianAccessibilityService: Protected mode ACTIVE ($remainingMinutes min remaining)! " +
            "Blocking payment app: $packageName"
        )

        // 5. Send the user to the home screen
        val homeTriggered = performGlobalAction(GLOBAL_ACTION_HOME)
        Log.d(TAG, "GuardianAccessibilityService: performGlobalAction(GLOBAL_ACTION_HOME) result = $homeTriggered")

        // 6. Show the warning
        showPaymentBlockedWarning(packageName, remainingMinutes)
    }

    override fun onInterrupt() {
        Log.d(TAG, "GuardianAccessibilityService: onInterrupt called")
    }

    private fun showPaymentBlockedWarning(blockedPackage: String, remainingMinutes: Long) {
        val warningMessage = "Payment apps are blocked because a scam call was detected."
        val reasonDetails = "Attempted to open $blockedPackage while protected mode is active " +
                "(expires in ~$remainingMinutes min) to prevent unauthorized transfers."

        Log.d(TAG, "GuardianAccessibilityService: Showing warning: '$warningMessage'")

        // Instant toast notification feedback
        Toast.makeText(this, "⚠️ $warningMessage", Toast.LENGTH_LONG).show()

        // Launch AlertActivity with the payment blocked explanation
        val alertIntent = Intent(this, AlertActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or
                    Intent.FLAG_ACTIVITY_CLEAR_TOP or
                    Intent.FLAG_ACTIVITY_SINGLE_TOP
            putExtra(EXTRA_ALERT_ID, "PAYMENT_BLOCKED_${System.currentTimeMillis()}")
            putExtra(EXTRA_ALERT_MESSAGE, warningMessage)
            putExtra(EXTRA_ALERT_REASON, reasonDetails)
            putExtra(EXTRA_CALL_ENDED, false)
            putExtra(EXTRA_CALL_FAILED_OR_DENIED, false)
        }

        try {
            startActivity(alertIntent)
            Log.d(TAG, "GuardianAccessibilityService: AlertActivity launched successfully")
        } catch (e: Exception) {
            Log.w(TAG, "GuardianAccessibilityService: Failed to start AlertActivity directly: ${e.message}", e)
        }
    }
}

