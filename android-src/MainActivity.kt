package com.smartstudy.admin

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.widget.Toast
import com.getcapacitor.BridgeActivity

class MainActivity : BridgeActivity() {
    private var backPressedOnce = false

    // FCM token refresh receiver
    private val tokenReceiver = object : BroadcastReceiver() {
        override fun onReceive(ctx: Context, intent: Intent) {
            val token = intent.getStringExtra("token") ?: return
            bridge?.triggerWindowJSEvent("fcmTokenRefresh", "{\"token\":\"$token\"}")
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        registerPlugin(OcrPlugin::class.java)
        registerPlugin(BgSyncPlugin::class.java)
        registerPlugin(FcmTokenPlugin::class.java)
        super.onCreate(savedInstanceState)

        // FCM notification click — page navigate
        handleNavIntent(intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handleNavIntent(intent)
    }

    override fun onResume() {
        super.onResume()
        val filter = IntentFilter("com.smartstudy.admin.FCM_TOKEN_REFRESH")
        registerReceiver(tokenReceiver, filter)
    }

    override fun onPause() {
        super.onPause()
        try { unregisterReceiver(tokenReceiver) } catch (_: Exception) {}
    }

    private fun handleNavIntent(intent: Intent?) {
        val page = intent?.getStringExtra("admin_nav_page") ?: return
        if (page.isBlank()) return
        // Bridge ready হওয়ার পরে JS এ event পাঠাও
        Handler(Looper.getMainLooper()).postDelayed({
            bridge?.triggerWindowJSEvent("adminNavTo", "{\"page\":\"$page\"}")
        }, 800)
    }

    override fun onBackPressed() {
        val handled = bridge?.triggerWindowJSEvent("androidBackButton", "{}") ?: false
        if (!handled) {
            if (backPressedOnce) { super.onBackPressed(); return }
            backPressedOnce = true
            Toast.makeText(this, "আবার Back চাপুন বন্ধ করতে", Toast.LENGTH_SHORT).show()
            Handler(Looper.getMainLooper()).postDelayed({ backPressedOnce = false }, 2000)
        }
    }
}
