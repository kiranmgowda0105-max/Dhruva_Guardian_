package com.example.dhruvaguardian

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import android.util.Log

/**
 * BroadcastReceiver that restarts GuardianService automatically after device boot
 * or package replacement.
 */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent?) {
        val action = intent?.action
        Log.d(TAG, "BootReceiver received action: $action")

        if (action == Intent.ACTION_BOOT_COMPLETED || action == Intent.ACTION_MY_PACKAGE_REPLACED) {
            val serviceIntent = Intent(context, GuardianService::class.java)
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    context.startForegroundService(serviceIntent)
                } else {
                    context.startService(serviceIntent)
                }
                Log.d(TAG, "BootReceiver: successfully triggered start of GuardianService")
            } catch (e: Exception) {
                Log.w(TAG, "BootReceiver: failed to start GuardianService: ${e.message}", e)
            }
        }
    }
}

