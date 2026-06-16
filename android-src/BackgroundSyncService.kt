package com.smartstudy.admin

import android.app.*
import android.content.Intent
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat

/**
 * BackgroundSyncService — Foreground Service
 *
 * যখন admin app কোনো কাজ চালু করে (bulk upload, rename, delete, edit),
 * এই service টা একটা persistent notification দেখায়।
 * ফলে Android app minimize / screen off করলেও process জীবিত থাকে।
 *
 * JS side থেকে Capacitor Plugin call করে start/stop করা হয়।
 */
class BackgroundSyncService : Service() {

    companion object {
        const val CHANNEL_ID    = "bg_sync_channel"
        const val NOTIF_ID      = 9001
        const val ACTION_START  = "ACTION_START"
        const val ACTION_STOP   = "ACTION_STOP"
        const val ACTION_UPDATE = "ACTION_UPDATE"
        const val EXTRA_TITLE   = "extra_title"
        const val EXTRA_TEXT    = "extra_text"
    }

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_STOP -> {
                stopForeground(STOP_FOREGROUND_REMOVE)
                stopSelf()
            }
            ACTION_UPDATE, ACTION_START -> {
                val title = intent.getStringExtra(EXTRA_TITLE) ?: "কাজ চলছে…"
                val text  = intent.getStringExtra(EXTRA_TEXT)  ?: "Background sync active"
                startForeground(NOTIF_ID, buildNotif(title, text))
            }
            else -> {
                startForeground(NOTIF_ID, buildNotif("কাজ চলছে…", "Background sync active"))
            }
        }
        return START_STICKY   // OS killed হলে restart করবে
    }

    private fun buildNotif(title: String, text: String): Notification {
        val pi = PendingIntent.getActivity(
            this, 0,
            packageManager.getLaunchIntentForPackage(packageName),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle(title)
            .setContentText(text)
            .setSmallIcon(android.R.drawable.ic_popup_sync)
            .setOngoing(true)
            .setContentIntent(pi)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setSilent(true)
            .build()
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "Background Sync",
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "Admin app background tasks"
                setShowBadge(false)
            }
            (getSystemService(NOTIFICATION_SERVICE) as NotificationManager)
                .createNotificationChannel(channel)
        }
    }

    override fun onBind(intent: Intent?): IBinder? = null
}
