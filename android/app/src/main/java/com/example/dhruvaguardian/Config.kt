package com.example.dhruvaguardian

import android.content.Context

/**
 * Shared configuration and constants for Dhruva Guardian.
 */
const val TAG = "DhruvaGuardian"
const val BACKEND_BASE_URL = "http://192.168.145.21:8000"
const val KEY_BACKEND_URL = "backend_url"
const val ENABLE_PAYMENT_BLOCK = false
const val FAMILY_CODE = "DEMO01"
const val PREFS_NAME = "dhruva_guardian_prefs"
const val KEY_LAST_SHOWN_ALERT_ID = "last_shown_alert_id"

/**
 * Returns the configured backend URL from SharedPreferences, trimmed and without trailing "/",
 * or BACKEND_BASE_URL if not configured or empty.
 */
fun backendUrl(context: Context): String {
    val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    val saved = prefs.getString(KEY_BACKEND_URL, "")?.trim()?.trimEnd('/') ?: ""
    return if (saved.isNotEmpty()) saved else BACKEND_BASE_URL
}

// Notification Channels & IDs
const val CHANNEL_ID_SERVICE = "dhruva_guardian_service_channel"
const val CHANNEL_NAME_SERVICE = "Dhruva Protection Service"
const val NOTIFICATION_ID_SERVICE = 1001

const val CHANNEL_ID_ALERTS = "dhruva_urgent_scam_alerts_v2"
const val CHANNEL_NAME_ALERTS = "Dhruva Urgent Scam Alerts"
const val NOTIFICATION_ID_ALERT = 2001

// Intent extras for AlertActivity
const val EXTRA_ALERT_ID = "extra_alert_id"
const val EXTRA_ALERT_MESSAGE = "extra_alert_message"
const val EXTRA_ALERT_REASON = "extra_alert_reason"
const val EXTRA_CALL_ENDED = "extra_call_ended"
const val EXTRA_CALL_FAILED_OR_DENIED = "extra_call_failed_or_denied"

// Protected mode preferences
const val KEY_PROTECTED_MODE = "protected_mode_active"
const val KEY_PROTECTED_UNTIL = "protected_until"
const val PROTECTED_MODE_DURATION_MS = 20 * 60 * 1000L // 20 minutes

// Blocked payment applications
val BLOCKED_PAYMENT_PACKAGES = setOf(
    "com.google.android.apps.nbu.paisa.user", // Google Pay
    "com.phonepe.app",                         // PhonePe
    "net.one97.paytm",                         // Paytm
    "in.org.npci.upiapp"                       // BHIM
)

// Cooldown between payment app interceptions to avoid navigation loops
const val PAYMENT_BLOCK_COOLDOWN_MS = 3000L

/**
 * Tracks whether MainActivity is currently visible to prevent duplicate notifications.
 */
@Volatile
var isActivityVisible: Boolean = false
