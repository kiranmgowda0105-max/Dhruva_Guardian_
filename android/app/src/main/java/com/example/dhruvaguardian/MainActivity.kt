package com.example.dhruvaguardian

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.util.Log
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.BufferedReader
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL

class MainActivity : ComponentActivity() {

    private val requestPermissionsLauncher = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { permissions ->
        val notifGranted = permissions[Manifest.permission.POST_NOTIFICATIONS] ?: true
        val answerGranted = permissions[Manifest.permission.ANSWER_PHONE_CALLS] ?: false
        val readStateGranted = permissions[Manifest.permission.READ_PHONE_STATE] ?: false

        Log.d(
            TAG,
            "MainActivity: Permissions callback -> POST_NOTIFICATIONS=$notifGranted, " +
            "ANSWER_PHONE_CALLS=$answerGranted, READ_PHONE_STATE=$readStateGranted"
        )
        startGuardianService()
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        Log.d(TAG, "MainActivity created. Base URL: ${backendUrl(this)}, Family Code: $FAMILY_CODE")
        checkAndRequestPermissionsAndStartService()
        setContent {
            MaterialTheme {
                DhruvaGuardianApp(
                    onRequestPhonePermissions = {
                        requestPhonePermissions()
                    }
                )
            }
        }
    }

    override fun onStart() {
        super.onStart()
        isActivityVisible = true
        Log.d(TAG, "MainActivity onStart: isActivityVisible=true")
    }

    override fun onResume() {
        super.onResume()
        isActivityVisible = true
        Log.d(TAG, "MainActivity onResume: isActivityVisible=true")
    }

    override fun onPause() {
        super.onPause()
        Log.d(TAG, "MainActivity onPause")
    }

    override fun onStop() {
        super.onStop()
        isActivityVisible = false
        Log.d(TAG, "MainActivity onStop: isActivityVisible=false")
    }

    override fun onDestroy() {
        super.onDestroy()
        isActivityVisible = false
        Log.d(TAG, "MainActivity onDestroy: isActivityVisible=false")
    }

    private fun checkAndRequestPermissionsAndStartService() {
        val neededPermissions = mutableListOf<String>()

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
                neededPermissions.add(Manifest.permission.POST_NOTIFICATIONS)
            }
        }

        if (ContextCompat.checkSelfPermission(this, Manifest.permission.ANSWER_PHONE_CALLS) != PackageManager.PERMISSION_GRANTED) {
            neededPermissions.add(Manifest.permission.ANSWER_PHONE_CALLS)
        }

        if (ContextCompat.checkSelfPermission(this, Manifest.permission.READ_PHONE_STATE) != PackageManager.PERMISSION_GRANTED) {
            neededPermissions.add(Manifest.permission.READ_PHONE_STATE)
        }

        if (neededPermissions.isNotEmpty()) {
            Log.d(TAG, "MainActivity: Requesting runtime permissions: $neededPermissions")
            requestPermissionsLauncher.launch(neededPermissions.toTypedArray())
        } else {
            Log.d(TAG, "MainActivity: All required runtime permissions already granted")
            startGuardianService()
        }
    }

    private fun requestPhonePermissions() {
        val needed = arrayOf(
            Manifest.permission.ANSWER_PHONE_CALLS,
            Manifest.permission.READ_PHONE_STATE
        )
        Log.d(TAG, "MainActivity: Explicitly requesting phone permissions")
        requestPermissionsLauncher.launch(needed)
    }

    private fun startGuardianService() {
        val serviceIntent = Intent(this, GuardianService::class.java)
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                startForegroundService(serviceIntent)
            } else {
                startService(serviceIntent)
            }
            Log.d(TAG, "MainActivity: startForegroundService called for GuardianService")
        } catch (e: Exception) {
            Log.e(TAG, "MainActivity: failed to start GuardianService: ${e.message}", e)
        }
    }
}


@Composable
fun DhruvaGuardianApp(
    onRequestPhonePermissions: () -> Unit = {}
) {
    val context = LocalContext.current
    val coroutineScope = rememberCoroutineScope()
    val prefs = remember { context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE) }

    var connectionStatus by remember { mutableStateOf("Connecting...") }
    var currentHost by remember { mutableStateOf(backendUrl(context)) }
    var serverUrlInput by remember { mutableStateOf(currentHost) }

    var hasOverlayPermission by remember { mutableStateOf(Settings.canDrawOverlays(context)) }
    var hasPhonePermissions by remember {
        mutableStateOf(
            ContextCompat.checkSelfPermission(context, Manifest.permission.ANSWER_PHONE_CALLS) == PackageManager.PERMISSION_GRANTED &&
            ContextCompat.checkSelfPermission(context, Manifest.permission.READ_PHONE_STATE) == PackageManager.PERMISSION_GRANTED
        )
    }
    var hasAccessibilityPermission by remember {
        mutableStateOf(isAccessibilityServiceEnabled(context))
    }
    var protectedUntilMillis by remember {
        mutableStateOf(prefs.getLong(KEY_PROTECTED_UNTIL, 0L))
    }
    var isRedAlert by remember { mutableStateOf(false) }
    var dismissed by remember { mutableStateOf(false) }
    var alertDetails by remember { mutableStateOf("") }
    var currentAlertId by remember { mutableStateOf("") }

    // Re-check permissions whenever activity resumes
    val lifecycleOwner = LocalLifecycleOwner.current
    DisposableEffect(lifecycleOwner) {
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_RESUME) {
                hasOverlayPermission = Settings.canDrawOverlays(context)
                hasPhonePermissions = (
                    ContextCompat.checkSelfPermission(context, Manifest.permission.ANSWER_PHONE_CALLS) == PackageManager.PERMISSION_GRANTED &&
                    ContextCompat.checkSelfPermission(context, Manifest.permission.READ_PHONE_STATE) == PackageManager.PERMISSION_GRANTED
                )
                hasAccessibilityPermission = isAccessibilityServiceEnabled(context)
                protectedUntilMillis = prefs.getLong(KEY_PROTECTED_UNTIL, 0L)
                currentHost = backendUrl(context)
                Log.d(
                    TAG,
                    "MainActivity onResume: canDrawOverlays=$hasOverlayPermission, " +
                    "hasPhonePermissions=$hasPhonePermissions, hasAccessibilityPermission=$hasAccessibilityPermission, " +
                    "protectedUntil=$protectedUntilMillis, currentHost=$currentHost"
                )
            }
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose {
            lifecycleOwner.lifecycle.removeObserver(observer)
        }
    }

    // Persistent tracker for the last shown/dismissed alert ID
    var lastShownAlertId by remember {
        mutableStateOf(prefs.getString(KEY_LAST_SHOWN_ALERT_ID, "") ?: "")
    }

    // Background polling loop (every 2 seconds on Dispatchers.IO)
    LaunchedEffect(Unit) {
        Log.d(TAG, "Starting polling loop (interval = 2000ms)... Initial lastShownAlertId='$lastShownAlertId'")
        while (isActive) {
            try {
                // 1. Connection check (/health) using fresh backendUrl(context)
                val isHealthy = withContext(Dispatchers.IO) { checkHealth(context) }
                if (isHealthy) {
                    connectionStatus = "Connected"

                    // 2. Poll alert level for FAMILY_CODE (/poll)
                    val pollResult = withContext(Dispatchers.IO) { pollAlert(context) }
                    val currentLevel = pollResult.optString("level", "green")
                    val alertId = pollResult.optString("id", "")
                    val matched = pollResult.optString("matched", "")

                    Log.d(
                        TAG,
                        "Poll result: level='$currentLevel', id='$alertId', lastShownAlertId='$lastShownAlertId', " +
                        "isRedAlert=$isRedAlert, dismissed=$dismissed"
                    )

                    if (currentLevel.equals("red", ignoreCase = true) && alertId.isNotEmpty()) {
                        currentAlertId = alertId
                        // Only trigger if this is a NEW alert id that differs from last shown
                        if (alertId != lastShownAlertId) {
                            Log.d(TAG, "NEW RED alert id='$alertId' (differs from '$lastShownAlertId') -> Displaying alert screen")
                            isRedAlert = true
                            dismissed = false
                            alertDetails = matched
                        } else {
                            // Same alert id as previously dismissed/shown -> do not re-trigger
                            Log.d(TAG, "Alert id='$alertId' has already been handled (dismissed=$dismissed). Not re-triggering.")
                        }
                    } else {
                        // Normal or no-alert state -> clear on-screen message
                        if (isRedAlert || alertDetails.isNotEmpty()) {
                            Log.d(TAG, "Server reports no active RED alert -> clearing on-screen alert message")
                        }
                        isRedAlert = false
                        alertDetails = ""
                        dismissed = false
                    }
                } else {
                    Log.w(TAG, "Health check failed; setting status to Disconnected")
                    connectionStatus = "Disconnected"
                }
            } catch (e: Exception) {
                Log.e(TAG, "Unexpected error in poll loop", e)
                connectionStatus = "Disconnected"
            }

            delay(2000)
        }
    }

    val onSaveServerUrl = {
        val trimmed = serverUrlInput.trim().trimEnd('/')
        val toSave = if (trimmed.isNotEmpty()) trimmed else BACKEND_BASE_URL
        prefs.edit().putString(KEY_BACKEND_URL, toSave).apply()
        val updated = backendUrl(context)
        currentHost = updated
        serverUrlInput = updated
        Log.d(TAG, "Saved custom backend URL: $updated")
        coroutineScope.launch {
            connectionStatus = "Connecting..."
            val isHealthy = withContext(Dispatchers.IO) { checkHealth(context) }
            connectionStatus = if (isHealthy) "Connected" else "Disconnected"
        }
    }

    val onResetServerUrl = {
        prefs.edit().remove(KEY_BACKEND_URL).apply()
        val defaultUrl = BACKEND_BASE_URL
        currentHost = defaultUrl
        serverUrlInput = defaultUrl
        Log.d(TAG, "Reset backend URL to default: $defaultUrl")
        coroutineScope.launch {
            connectionStatus = "Connecting..."
            val isHealthy = withContext(Dispatchers.IO) { checkHealth(context) }
            connectionStatus = if (isHealthy) "Connected" else "Disconnected"
        }
    }

    val showRedOverlay = isRedAlert && !dismissed

    if (showRedOverlay) {
        // Full-screen Red Alert Screen
        RedAlertScreen(
            details = alertDetails,
            onCall1930 = {
                Log.d(TAG, "Action: Call 1930 clicked")
                val dialIntent = Intent(Intent.ACTION_DIAL).apply {
                    data = Uri.parse("tel:1930")
                }
                context.startActivity(dialIntent)
            },
            onDismiss = {
                Log.d(TAG, "Action: Red alert dismissed by user for alert id='$currentAlertId'")
                dismissed = true
                if (currentAlertId.isNotEmpty()) {
                    lastShownAlertId = currentAlertId
                    prefs.edit().putString(KEY_LAST_SHOWN_ALERT_ID, currentAlertId).apply()
                }
                // Optional: clear/acknowledge on backend as well
                coroutineScope.launch(Dispatchers.IO) {
                    dismissBackendAlert(context)
                }
            }
        )
    } else {
        // Main Guardian Screen
        MainGuardianScreen(
            connectionStatus = connectionStatus,
            currentHost = currentHost,
            serverUrlInput = serverUrlInput,
            onServerUrlChange = { serverUrlInput = it },
            onSaveServerUrl = { onSaveServerUrl() },
            onResetServerUrl = { onResetServerUrl() },
            hasOverlayPermission = hasOverlayPermission,
            hasPhonePermissions = hasPhonePermissions,
            hasAccessibilityPermission = hasAccessibilityPermission,
            protectedUntilMillis = protectedUntilMillis,
            onOpenOverlaySettings = {
                Log.d(TAG, "MainActivity: Action 'Allow display over other apps' clicked -> opening ACTION_MANAGE_OVERLAY_PERMISSION")
                val intent = Intent(
                    Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                    Uri.parse("package:${context.packageName}")
                )
                context.startActivity(intent)
            },
            onOpenAccessibilitySettings = {
                Log.d(TAG, "MainActivity: Action 'Enable Payment Blocker' clicked -> opening ACTION_ACCESSIBILITY_SETTINGS")
                val intent = Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)
                context.startActivity(intent)
            },
            onRequestPhonePermissions = onRequestPhonePermissions,
            onFakeRedClick = {
                coroutineScope.launch {
                    Log.d(TAG, "Action: Fake RED button clicked")
                    val fakeId = "DEMO01-local-${System.currentTimeMillis()}"
                    currentAlertId = fakeId
                    isRedAlert = true
                    dismissed = false
                    alertDetails = "safe account, tell no one"
                    withContext(Dispatchers.IO) {
                        try {
                            sendFakeRedEvent(context)
                        } catch (e: Exception) {
                            Log.e(TAG, "Failed to send fake RED event to backend", e)
                        }
                    }
                }
            },
            onCall1930 = {
                Log.d(TAG, "Action: Call 1930 clicked from main screen")
                val dialIntent = Intent(Intent.ACTION_DIAL).apply {
                    data = Uri.parse("tel:1930")
                }
                context.startActivity(dialIntent)
            }
        )
    }
}

private fun isAccessibilityServiceEnabled(context: Context): Boolean {
    val enabledServices = Settings.Secure.getString(
        context.contentResolver,
        Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES
    ) ?: return false
    return enabledServices.contains(context.packageName) &&
           enabledServices.contains("GuardianAccessibilityService")
}

@Composable
fun MainGuardianScreen(
    connectionStatus: String,
    currentHost: String,
    serverUrlInput: String,
    onServerUrlChange: (String) -> Unit,
    onSaveServerUrl: () -> Unit,
    onResetServerUrl: () -> Unit,
    hasOverlayPermission: Boolean,
    hasPhonePermissions: Boolean,
    hasAccessibilityPermission: Boolean,
    protectedUntilMillis: Long,
    onOpenOverlaySettings: () -> Unit,
    onOpenAccessibilitySettings: () -> Unit,
    onRequestPhonePermissions: () -> Unit,
    onFakeRedClick: () -> Unit,
    onCall1930: () -> Unit
) {
    val now = System.currentTimeMillis()
    val isProtected = now < protectedUntilMillis
    val remainingMin = if (isProtected) ((protectedUntilMillis - now) / 60000L) + 1 else 0L
    val scrollState = rememberScrollState()

    Surface(
        modifier = Modifier.fillMaxSize(),
        color = MaterialTheme.colorScheme.background
    ) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .verticalScroll(scrollState)
                .padding(24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.SpaceBetween
        ) {
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Spacer(modifier = Modifier.height(16.dp))
                Text(
                    text = "Dhruva Guardian",
                    fontSize = 28.sp,
                    fontWeight = FontWeight.Bold,
                    color = MaterialTheme.colorScheme.onBackground
                )
                Text(
                    text = "Real-time scam call protector",
                    fontSize = 14.sp,
                    color = Color.Gray
                )

                Spacer(modifier = Modifier.height(16.dp))

                // Protected mode active banner if on
                if (isProtected) {
                    Card(
                        modifier = Modifier.fillMaxWidth(),
                        shape = RoundedCornerShape(12.dp),
                        colors = CardDefaults.cardColors(
                            containerColor = Color(0xFFFFF3E0)
                        )
                    ) {
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(horizontal = 16.dp, vertical = 12.dp),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Text(
                                text = "🛡️ Protected Mode Active",
                                fontSize = 13.sp,
                                fontWeight = FontWeight.Bold,
                                color = Color(0xFFE65100)
                            )
                            Text(
                                text = "~$remainingMin min left",
                                fontSize = 13.sp,
                                fontWeight = FontWeight.Bold,
                                color = Color(0xFFE65100)
                            )
                        }
                    }
                    Spacer(modifier = Modifier.height(10.dp))
                }

                // Connection status card
                Card(
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(12.dp),
                    colors = CardDefaults.cardColors(
                        containerColor = if (connectionStatus == "Connected") Color(0xFFE8F5E9) else Color(0xFFFFEBEE)
                    )
                ) {
                    Column(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(14.dp),
                        horizontalAlignment = Alignment.CenterHorizontally
                    ) {
                        Text(
                            text = "Connection Status",
                            fontSize = 12.sp,
                            color = Color.Gray
                        )
                        Spacer(modifier = Modifier.height(2.dp))
                        Text(
                            text = connectionStatus,
                            fontSize = 18.sp,
                            fontWeight = FontWeight.Bold,
                            color = if (connectionStatus == "Connected") Color(0xFF2E7D32) else Color(0xFFC62828)
                        )
                        Spacer(modifier = Modifier.height(4.dp))
                        Text(
                            text = "Family Code: $FAMILY_CODE",
                            fontSize = 12.sp,
                            color = Color.DarkGray
                        )
                        Text(
                            text = "Host: $currentHost",
                            fontSize = 11.sp,
                            color = Color.Gray
                        )
                    }
                }

                Spacer(modifier = Modifier.height(10.dp))

                // Server URL Runtime Configuration Card
                Card(
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(12.dp),
                    colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant)
                ) {
                    Column(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(14.dp)
                    ) {
                        Text(
                            text = "Server Configuration",
                            fontSize = 13.sp,
                            fontWeight = FontWeight.SemiBold,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                        Spacer(modifier = Modifier.height(6.dp))
                        OutlinedTextField(
                            value = serverUrlInput,
                            onValueChange = onServerUrlChange,
                            label = { Text("Server URL") },
                            placeholder = { Text(BACKEND_BASE_URL) },
                            singleLine = true,
                            modifier = Modifier.fillMaxWidth()
                        )
                        Spacer(modifier = Modifier.height(10.dp))
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.spacedBy(8.dp)
                        ) {
                            Button(
                                onClick = onSaveServerUrl,
                                modifier = Modifier.weight(1f),
                                shape = RoundedCornerShape(8.dp)
                            ) {
                                Text("Save")
                            }
                            OutlinedButton(
                                onClick = onResetServerUrl,
                                modifier = Modifier.weight(1f),
                                shape = RoundedCornerShape(8.dp)
                            ) {
                                Text("Reset to default")
                            }
                        }
                    }
                }

                Spacer(modifier = Modifier.height(10.dp))

                // Display over other apps permission status card
                Card(
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(12.dp),
                    colors = CardDefaults.cardColors(
                        containerColor = if (hasOverlayPermission) Color(0xFFE8F5E9) else Color(0xFFFFF3E0)
                    )
                ) {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(horizontal = 16.dp, vertical = 10.dp),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Text(
                            text = "Display Over Other Apps",
                            fontSize = 13.sp,
                            fontWeight = FontWeight.Medium
                        )
                        Text(
                            text = if (hasOverlayPermission) "Granted" else "Not Granted",
                            fontSize = 13.sp,
                            fontWeight = FontWeight.Bold,
                            color = if (hasOverlayPermission) Color(0xFF2E7D32) else Color(0xFFE65100)
                        )
                    }
                }

                Spacer(modifier = Modifier.height(8.dp))

                // Call interception permission status card
                Card(
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(12.dp),
                    colors = CardDefaults.cardColors(
                        containerColor = if (hasPhonePermissions) Color(0xFFE8F5E9) else Color(0xFFFFF3E0)
                    )
                ) {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(horizontal = 16.dp, vertical = 10.dp),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Text(
                            text = "Call Disconnect Permission",
                            fontSize = 13.sp,
                            fontWeight = FontWeight.Medium
                        )
                        Text(
                            text = if (hasPhonePermissions) "Granted" else "Not Granted",
                            fontSize = 13.sp,
                            fontWeight = FontWeight.Bold,
                            color = if (hasPhonePermissions) Color(0xFF2E7D32) else Color(0xFFE65100)
                        )
                    }
                }

                Spacer(modifier = Modifier.height(8.dp))

                // Payment app protection accessibility status card
                Card(
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(12.dp),
                    colors = CardDefaults.cardColors(
                        containerColor = if (hasAccessibilityPermission) Color(0xFFE8F5E9) else Color(0xFFFFF3E0)
                    )
                ) {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(horizontal = 16.dp, vertical = 10.dp),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Text(
                            text = "Payment App Blocker",
                            fontSize = 13.sp,
                            fontWeight = FontWeight.Medium
                        )
                        Text(
                            text = if (hasAccessibilityPermission) "Active" else "Disabled",
                            fontSize = 13.sp,
                            fontWeight = FontWeight.Bold,
                            color = if (hasAccessibilityPermission) Color(0xFF2E7D32) else Color(0xFFE65100)
                        )
                    }
                }
            }

            Spacer(modifier = Modifier.height(16.dp))

            // Action Buttons
            Column(
                modifier = Modifier.fillMaxWidth(),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                Button(
                    onClick = onFakeRedClick,
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(48.dp),
                    colors = ButtonDefaults.buttonColors(containerColor = Color(0xFFDC2626)),
                    shape = RoundedCornerShape(8.dp)
                ) {
                    Text(
                        text = "🚨 Fake RED",
                        fontSize = 16.sp,
                        fontWeight = FontWeight.Bold,
                        color = Color.White
                    )
                }

                if (!hasOverlayPermission) {
                    OutlinedButton(
                        onClick = onOpenOverlaySettings,
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(44.dp),
                        shape = RoundedCornerShape(8.dp)
                    ) {
                        Text(
                            text = "Allow display over other apps",
                            fontSize = 13.sp,
                            fontWeight = FontWeight.SemiBold
                        )
                    }
                }

                if (!hasAccessibilityPermission) {
                    OutlinedButton(
                        onClick = onOpenAccessibilitySettings,
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(44.dp),
                        shape = RoundedCornerShape(8.dp)
                    ) {
                        Text(
                            text = "Enable Payment App Blocker",
                            fontSize = 13.sp,
                            fontWeight = FontWeight.SemiBold
                        )
                    }
                }

                if (!hasPhonePermissions) {
                    OutlinedButton(
                        onClick = onRequestPhonePermissions,
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(44.dp),
                        shape = RoundedCornerShape(8.dp)
                    ) {
                        Text(
                            text = "Grant Call Permissions",
                            fontSize = 13.sp,
                            fontWeight = FontWeight.SemiBold
                        )
                    }
                }

                OutlinedButton(
                    onClick = onCall1930,
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(44.dp),
                    shape = RoundedCornerShape(8.dp)
                ) {
                    Text(
                        text = "📞 Call 1930 Helpline",
                        fontSize = 13.sp,
                        fontWeight = FontWeight.SemiBold
                    )
                }
                Spacer(modifier = Modifier.height(8.dp))
            }
        }
    }
}

@Composable
fun RedAlertScreen(
    details: String,
    onCall1930: () -> Unit,
    onDismiss: () -> Unit
) {
    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(Color(0xFFDC2626))
            .padding(28.dp),
        contentAlignment = Alignment.Center
    ) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center
        ) {
            Text(
                text = "⚠️",
                fontSize = 64.sp
            )
            Spacer(modifier = Modifier.height(16.dp))
            Text(
                text = "Possible digital-arrest scam",
                fontSize = 26.sp,
                fontWeight = FontWeight.ExtraBold,
                color = Color.White,
                textAlign = TextAlign.Center,
                lineHeight = 32.sp
            )
            Spacer(modifier = Modifier.height(16.dp))
            Text(
                text = "Real police, courts, and banks never make video calls, demand money transfers, or order digital arrest. Hang up immediately.",
                fontSize = 15.sp,
                color = Color.White.copy(alpha = 0.95f),
                textAlign = TextAlign.Center,
                lineHeight = 22.sp
            )

            if (details.isNotEmpty()) {
                Spacer(modifier = Modifier.height(12.dp))
                Text(
                    text = "Flagged: $details",
                    fontSize = 13.sp,
                    color = Color.Yellow,
                    textAlign = TextAlign.Center
                )
            }

            Spacer(modifier = Modifier.height(36.dp))

            Button(
                onClick = onCall1930,
                modifier = Modifier
                    .fillMaxWidth()
                    .height(56.dp),
                colors = ButtonDefaults.buttonColors(containerColor = Color.White),
                shape = RoundedCornerShape(8.dp)
            ) {
                Text(
                    text = "📞 Call 1930",
                    fontSize = 18.sp,
                    fontWeight = FontWeight.Bold,
                    color = Color(0xFFDC2626)
                )
            }

            Spacer(modifier = Modifier.height(16.dp))

            TextButton(
                onClick = onDismiss,
                modifier = Modifier
                    .fillMaxWidth()
                    .height(48.dp)
            ) {
                Text(
                    text = "Dismiss",
                    fontSize = 16.sp,
                    color = Color.White.copy(alpha = 0.9f)
                )
            }
        }
    }
}

// HTTP Helper Functions using standard HttpURLConnection

private fun checkHealth(context: Context): Boolean {
    var connection: HttpURLConnection? = null
    return try {
        val baseUrl = backendUrl(context)
        val url = URL("$baseUrl/health")
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
            Log.d(TAG, "checkHealth success: responseCode=$code, body='$response'")
            val json = JSONObject(response)
            json.optBoolean("ok", false)
        } else {
            val error = connection.errorStream?.bufferedReader()?.use(BufferedReader::readText) ?: ""
            Log.w(TAG, "checkHealth failed: responseCode=$code, error='$error'")
            false
        }
    } catch (e: Exception) {
        Log.e(TAG, "checkHealth connection error: ${e.message}", e)
        false
    } finally {
        connection?.disconnect()
    }
}

private fun pollAlert(context: Context): JSONObject {
    var connection: HttpURLConnection? = null
    val result = JSONObject()
    try {
        val baseUrl = backendUrl(context)
        val url = URL("$baseUrl/poll?code=$FAMILY_CODE")
        Log.d(TAG, "pollAlert: sending request to $url")
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
            Log.d(TAG, "pollAlert: 200 OK received, body='$response'")
            val json = JSONObject(response)
            val eventObj = json.optJSONObject("event")
            if (eventObj != null) {
                val id = eventObj.optString("id", "")
                val level = eventObj.optString("level", "green")
                val stage = eventObj.optInt("stage", 0)
                val score = eventObj.optDouble("score", 0.0)
                val ts = eventObj.optLong("ts", 0L)

                result.put("id", id)
                result.put("level", level)
                result.put("stage", stage)
                result.put("score", score)
                result.put("ts", ts)

                val matchedArray = eventObj.optJSONArray("matched")
                if (matchedArray != null && matchedArray.length() > 0) {
                    val list = mutableListOf<String>()
                    for (i in 0 until matchedArray.length()) {
                        list.add(matchedArray.getString(i))
                    }
                    result.put("matched", list.joinToString(", "))
                }
                Log.d(TAG, "pollAlert: successfully parsed alert -> $result")
            } else {
                Log.d(TAG, "pollAlert: eventObj is null (no active alert on server)")
            }
        } else {
            val error = connection.errorStream?.bufferedReader()?.use(BufferedReader::readText) ?: ""
            Log.w(TAG, "pollAlert: received non-200 code=$code, error='$error'")
        }
    } catch (e: Exception) {
        Log.e(TAG, "pollAlert: network/parse exception: ${e.message}", e)
    } finally {
        connection?.disconnect()
    }
    return result
}

private fun dismissBackendAlert(context: Context): Boolean {
    var connection: HttpURLConnection? = null
    return try {
        val baseUrl = backendUrl(context)
        val url = URL("$baseUrl/dismiss?code=$FAMILY_CODE")
        Log.d(TAG, "dismissBackendAlert: sending POST to $url")
        connection = (url.openConnection() as HttpURLConnection).apply {
            requestMethod = "POST"
            connectTimeout = 3000
            readTimeout = 3000
            doOutput = true
        }
        val code = connection.responseCode
        Log.d(TAG, "dismissBackendAlert: responseCode=$code")
        code in 200..299
    } catch (e: Exception) {
        Log.w(TAG, "dismissBackendAlert exception: ${e.message}")
        false
    } finally {
        connection?.disconnect()
    }
}

private fun sendFakeRedEvent(context: Context): Boolean {
    var connection: HttpURLConnection? = null
    return try {
        val baseUrl = backendUrl(context)
        val url = URL("$baseUrl/event")
        Log.d(TAG, "sendFakeRedEvent: sending POST to $url")
        connection = (url.openConnection() as HttpURLConnection).apply {
            requestMethod = "POST"
            connectTimeout = 3000
            readTimeout = 3000
            doOutput = true
            setRequestProperty("Content-Type", "application/json; utf-8")
        }

        val payload = JSONObject().apply {
            put("id", "$FAMILY_CODE-fakered-${System.currentTimeMillis()}")
            put("code", FAMILY_CODE)
            put("level", "red")
            put("score", 55.0)
            put("stage", 4)
            val matchedArray = org.json.JSONArray().apply {
                put("safe account")
                put("tell no one")
            }
            put("matched", matchedArray)
            put("ts", System.currentTimeMillis() / 1000)
        }

        OutputStreamWriter(connection.outputStream).use { writer ->
            writer.write(payload.toString())
            writer.flush()
        }

        val code = connection.responseCode
        Log.d(TAG, "sendFakeRedEvent: responseCode=$code")
        code in 200..299
    } catch (e: Exception) {
        Log.e(TAG, "sendFakeRedEvent exception: ${e.message}", e)
        false
    } finally {
        connection?.disconnect()
    }
}
