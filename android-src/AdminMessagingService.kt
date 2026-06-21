package com.smartstudy.admin

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage

/**
 * AdminMessagingService — FCM push receive করে notification দেখায়
 * App minimize/closed থাকলেও কাজ করে
 */
class AdminMessagingService : FirebaseMessagingService() {

    override fun onMessageReceived(msg: RemoteMessage) {
        val data  = msg.data
        val title = data["title"] ?: msg.notification?.title ?: "Smart Study Admin"
        val body  = data["body"]  ?: msg.notification?.body  ?: ""
        val type  = data["type"]  ?: ""
        val page  = when {
            type.contains("report")    -> "reports"
            type.contains("technique") -> "techniques"
            else -> ""
        }

        showNotification(title, body, page)
    }

    override fun onNewToken(token: String) {
        super.onNewToken(token)
        // Token refresh হলে MainActivity এ broadcast করো
        sendBroadcast(Intent("com.smartstudy.admin.FCM_TOKEN_REFRESH").apply {
            putExtra("token", token)
        })
    }

    private fun showNotification(title: String, body: String, page: String) {
        val channelId = "admin_alerts"
        val nm = getSystemService(NOTIFICATION_SERVICE) as NotificationManager

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            nm.createNotificationChannel(
                NotificationChannel(channelId, "Admin Alerts", NotificationManager.IMPORTANCE_HIGH)
                    .apply { description = "Report & Technique alerts" }
            )
        }

        val intent = Intent(this, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
            putExtra("admin_nav_page", page)
        }
        val pi = PendingIntent.getActivity(
            this, page.hashCode(), intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val notif = NotificationCompat.Builder(this, channelId)
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentTitle(title)
            .setContentText(body)
            .setAutoCancel(true)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setContentIntent(pi)
            .build()

        nm.notify(System.currentTimeMillis().toInt(), notif)
    }
}
