package com.smartstudy.admin

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import com.getcapacitor.BridgeActivity
import com.capacitorjs.plugins.camera.CameraPlugin

class MainActivity : BridgeActivity() {

    // FCM token refresh receiver
    private val tokenReceiver = object : BroadcastReceiver() {
        override fun onReceive(ctx: Context, intent: Intent) {
            val token = intent.getStringExtra("token") ?: return
            bridge?.triggerWindowJSEvent("fcmTokenRefresh", "{\"token\":\"$token\"}")
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        registerPlugin(CameraPlugin::class.java)
        registerPlugin(OcrPlugin::class.java)
        registerPlugin(BgSyncPlugin::class.java)
        registerPlugin(FcmTokenPlugin::class.java)
        registerPlugin(AdminPushPlugin::class.java)
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
        // ⚠️ আগে এখানে backPressedOnce/Toast/exitApp দিয়ে native-এর নিজের একটা
        // "২বার চাপলে বন্ধ" সিস্টেম ছিল, আর triggerWindowJSEvent()-এর রিটার্ন ভ্যালু
        // ("handled") দিয়ে বোঝার চেষ্টা হতো JS আসলে navigate করেছে কিনা — কিন্তু
        // triggerWindowJSEvent() fire-and-forget (JS-এর উত্তরের জন্য অপেক্ষা করে না),
        // তাই "handled" নির্ভরযোগ্য ছিল না। এই native fallback আর JS-এর নিজের
        // exit-confirm লজিক (App.jsx-এর handleBack, ধাপ ৫) — দুটো সিস্টেম একসাথে
        // চলায় অসঙ্গতিপূর্ণ ব্যাক-বাটন আচরণ হচ্ছিল। এখন native শুধু event ফরওয়ার্ড
        // করে, সিদ্ধান্ত সম্পূর্ণভাবে JS-এর — single source of truth।
        bridge?.triggerWindowJSEvent("androidBackButton", "{}")
    }
}
