package com.smartstudy.admin

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.ActivityCompat
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.google.firebase.messaging.FirebaseMessaging

/**
 * AdminPushPlugin — Admin app এ FCM token নিয়ে Firebase এ save করে।
 * Main app এই token এ admin কে report/technique notification পাঠাবে।
 */
@CapacitorPlugin(name = "AdminPush")
class AdminPushPlugin : Plugin() {

    companion object {
        const val CHANNEL_ID   = "admin_notif_channel"
        const val CHANNEL_NAME = "Admin Notifications"
        // Deep link type → page mapping
        val TYPE_PAGE = mapOf(
            "admin_report"    to "reports",
            "admin_technique" to "techniques",
        )
    }

    override fun load() {
        super.load()
        createNotificationChannel()
    }

    /** FCM token নাও — JS side থেকে call করবে login এর পরে */
    @PluginMethod
    fun getToken(call: PluginCall) {
        FirebaseMessaging.getInstance().token
            .addOnSuccessListener { token ->
                val ret = JSObject().put("token", token)
                call.resolve(ret)
            }
            .addOnFailureListener { e ->
                call.reject("FCM token error: ${e.message}")
            }
    }

    /** Notification permission request (Android 13+) */
    @PluginMethod
    fun requestPermission(call: PluginCall) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (ActivityCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS)
                != PackageManager.PERMISSION_GRANTED) {
                ActivityCompat.requestPermissions(
                    activity,
                    arrayOf(Manifest.permission.POST_NOTIFICATIONS),
                    1001
                )
            }
        }
        call.resolve(JSObject().put("granted", true))
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID, CHANNEL_NAME,
                NotificationManager.IMPORTANCE_HIGH
            ).apply {
                description = "Smart Study Admin notifications"
                enableVibration(true)
            }
            (context.getSystemService(NotificationManager::class.java))
                .createNotificationChannel(channel)
        }
    }
}
