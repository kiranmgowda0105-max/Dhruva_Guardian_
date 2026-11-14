package com.example.dhruvaguardian

import android.app.KeyguardManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.util.Log
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

class AlertActivity : ComponentActivity() {

    private val alertIdState = mutableStateOf("")
    private val alertMessageState = mutableStateOf("Possible digital-arrest scam")
    private val alertReasonState = mutableStateOf("")
    private val callEndedState = mutableStateOf(false)
    private val callFailedOrDeniedState = mutableStateOf(false)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        Log.d(TAG, "AlertActivity onCreate")

        setupLockScreenAndWake()
        handleIntent(intent)

        setContent {
            MaterialTheme {
                AlertScreen(
                    message = alertMessageState.value,
                    reason = alertReasonState.value,
                    callEnded = callEndedState.value,
                    callFailedOrDenied = callFailedOrDeniedState.value,
                    onCall1930 = {
                        Log.d(TAG, "AlertActivity: Action Call 1930 clicked")
                        val dialIntent = Intent(Intent.ACTION_DIAL).apply {
                            data = Uri.parse("tel:1930")
                        }
                        startActivity(dialIntent)
                    },
                    onUnderstand = {
                        Log.d(TAG, "AlertActivity: Action 'I understand' clicked - dismissing alert")
                        finish()
                    }
                )
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        Log.d(TAG, "AlertActivity onNewIntent: updating message on open alert screen")
        setupLockScreenAndWake()
        handleIntent(intent)
    }

    private fun handleIntent(intent: Intent?) {
        if (intent == null) return
        val id = intent.getStringExtra(EXTRA_ALERT_ID) ?: ""
        val message = intent.getStringExtra(EXTRA_ALERT_MESSAGE) ?: "Possible digital-arrest scam"
        val reason = intent.getStringExtra(EXTRA_ALERT_REASON) ?: ""
        val callEnded = intent.getBooleanExtra(EXTRA_CALL_ENDED, false)
        val callFailedOrDenied = intent.getBooleanExtra(EXTRA_CALL_FAILED_OR_DENIED, false)

        if (id.isNotEmpty()) {
            alertIdState.value = id
            val prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            prefs.edit().putString(KEY_LAST_SHOWN_ALERT_ID, id).apply()
        }
        alertMessageState.value = message
        alertReasonState.value = reason
        callEndedState.value = callEnded
        callFailedOrDeniedState.value = callFailedOrDenied
        Log.d(
            TAG,
            "AlertActivity active alert updated: id='$id', message='$message', " +
            "reason='$reason', callEnded=$callEnded, callFailedOrDenied=$callFailedOrDenied"
        )
    }

    private fun setupLockScreenAndWake() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true)
            setTurnScreenOn(true)
        } else {
            @Suppress("DEPRECATION")
            window.addFlags(
                WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or
                WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON
            )
        }
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        Log.d(TAG, "AlertActivity setupLockScreenAndWake: setShowWhenLocked(true), setTurnScreenOn(true), FLAG_KEEP_SCREEN_ON")
    }
}

@Composable
fun AlertScreen(
    message: String,
    reason: String,
    callEnded: Boolean,
    callFailedOrDenied: Boolean,
    onCall1930: () -> Unit,
    onUnderstand: () -> Unit
) {
    val scrollState = rememberScrollState()

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(
                Brush.verticalGradient(
                    listOf(
                        Color(0xFF5A0C0C),
                        Color(0xFF2D0505),
                        Color(0xFF150202)
                    )
                )
            )
            .padding(20.dp),
        contentAlignment = Alignment.Center
    ) {
        Card(
            modifier = Modifier
                .fillMaxWidth()
                .border(
                    BorderStroke(1.5.dp, Color(0xFFFECACA).copy(alpha = 0.45f)),
                    RoundedCornerShape(24.dp)
                ),
            shape = RoundedCornerShape(24.dp),
            colors = CardDefaults.cardColors(
                containerColor = Color(0xFFB91C1C).copy(alpha = 0.35f)
            )
        ) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .verticalScroll(scrollState)
                    .padding(24.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.SpaceBetween
            ) {
                Column(
                    horizontalAlignment = Alignment.CenterHorizontally,
                    modifier = Modifier.padding(top = 8.dp)
                ) {
                    Text(
                        text = "🚨",
                        fontSize = 58.sp
                    )
                    Spacer(modifier = Modifier.height(10.dp))
                    Text(
                        text = "Scam alert",
                        fontSize = 32.sp,
                        fontWeight = FontWeight.Black,
                        color = Color.White,
                        letterSpacing = 2.sp,
                        textAlign = TextAlign.Center
                    )

                    Spacer(modifier = Modifier.height(14.dp))

                    // Call disconnect status banner
                    if (callEnded) {
                        Card(
                            shape = RoundedCornerShape(16.dp),
                            colors = CardDefaults.cardColors(containerColor = Color(0xFF1B5E20).copy(alpha = 0.55f)),
                            border = BorderStroke(1.dp, Color(0xFF4ADE80).copy(alpha = 0.45f)),
                            modifier = Modifier.fillMaxWidth()
                        ) {
                            Row(
                                modifier = Modifier.padding(14.dp),
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Text(text = "📞", fontSize = 20.sp)
                                Spacer(modifier = Modifier.width(10.dp))
                                Text(
                                    text = "Call disconnected.",
                                    fontSize = 14.sp,
                                    fontWeight = FontWeight.Bold,
                                    color = Color.White
                                )
                            }
                        }
                        Spacer(modifier = Modifier.height(14.dp))
                    } else if (callFailedOrDenied) {
                        Card(
                            shape = RoundedCornerShape(16.dp),
                            colors = CardDefaults.cardColors(containerColor = Color(0xFF7F1D1D).copy(alpha = 0.55f)),
                            border = BorderStroke(1.dp, Color(0xFFEF4444).copy(alpha = 0.50f)),
                            modifier = Modifier.fillMaxWidth()
                        ) {
                            Row(
                                modifier = Modifier.padding(14.dp),
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Text(text = "⚠️", fontSize = 22.sp)
                                Spacer(modifier = Modifier.width(10.dp))
                                Column {
                                    Text(
                                        text = "Hang up now",
                                        fontSize = 15.sp,
                                        fontWeight = FontWeight.Black,
                                        color = Color.Yellow
                                    )
                                    Text(
                                        text = "End the call on your screen.",
                                        fontSize = 13.sp,
                                        fontWeight = FontWeight.Bold,
                                        color = Color.White
                                    )
                                }
                            }
                        }
                        Spacer(modifier = Modifier.height(14.dp))
                    }

                    Text(
                        text = message,
                        fontSize = 22.sp,
                        fontWeight = FontWeight.Bold,
                        color = Color(0xFFFFF9C4),
                        textAlign = TextAlign.Center,
                        lineHeight = 28.sp
                    )

                    Spacer(modifier = Modifier.height(14.dp))

                    if (reason.isNotBlank()) {
                        Card(
                            shape = RoundedCornerShape(16.dp),
                            colors = CardDefaults.cardColors(
                                containerColor = Color.Black.copy(alpha = 0.30f)
                            ),
                            border = BorderStroke(1.dp, Color.White.copy(alpha = 0.20f)),
                            modifier = Modifier.fillMaxWidth()
                        ) {
                            Column(modifier = Modifier.padding(14.dp)) {
                                Text(
                                    text = "What triggered this:",
                                    fontSize = 12.sp,
                                    fontWeight = FontWeight.SemiBold,
                                    color = Color.White.copy(alpha = 0.8f)
                                )
                                Spacer(modifier = Modifier.height(4.dp))
                                Text(
                                    text = reason,
                                    fontSize = 14.sp,
                                    color = Color.White,
                                    fontWeight = FontWeight.Medium
                                )
                            }
                        }
                        Spacer(modifier = Modifier.height(14.dp))
                    }

                    Text(
                        text = "There is no 'digital arrest' in Indian law. Real police, CBI, ED, RBI, and courts never arrest anyone on a video call or ask you to move money. Hang up now.",
                        fontSize = 15.sp,
                        color = Color.White.copy(alpha = 0.90f),
                        textAlign = TextAlign.Center,
                        lineHeight = 22.sp
                    )
                }

                Spacer(modifier = Modifier.height(26.dp))

                Column(
                    modifier = Modifier.fillMaxWidth(),
                    verticalArrangement = Arrangement.spacedBy(12.dp)
                ) {
                    Button(
                        onClick = onCall1930,
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(54.dp),
                        colors = ButtonDefaults.buttonColors(containerColor = Color.White),
                        shape = RoundedCornerShape(14.dp)
                    ) {
                        Text(
                            text = "Call 1930 helpline",
                            fontSize = 18.sp,
                            fontWeight = FontWeight.Bold,
                            color = Color(0xFFB91C1C)
                        )
                    }

                    OutlinedButton(
                        onClick = onUnderstand,
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(50.dp)
                            .background(Color.White.copy(alpha = 0.10f), RoundedCornerShape(14.dp))
                            .border(BorderStroke(1.dp, Color.White.copy(alpha = 0.35f)), RoundedCornerShape(14.dp)),
                        shape = RoundedCornerShape(14.dp),
                        colors = ButtonDefaults.outlinedButtonColors(
                            contentColor = Color.White
                        )
                    ) {
                        Text(
                            text = "I understand",
                            fontSize = 16.sp,
                            fontWeight = FontWeight.SemiBold,
                            color = Color.White
                        )
                    }
                    Spacer(modifier = Modifier.height(8.dp))
                }
            }
        }
    }
}

