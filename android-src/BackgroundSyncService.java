package com.smartstudy.admin;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.os.Build;
import android.os.IBinder;

import androidx.core.app.NotificationCompat;

/**
 * BackgroundSyncService — Foreground Service
 *
 * admin app কোনো কাজ চালু করলে persistent notification দেখায়।
 * Android app minimize / screen off করলেও process জীবিত থাকে।
 * JS side থেকে Capacitor Plugin call করে start/stop করা হয়।
 */
public class BackgroundSyncService extends Service {

    public static final String CHANNEL_ID    = "bg_sync_channel";
    public static final int    NOTIF_ID      = 9001;
    public static final String ACTION_START  = "ACTION_START";
    public static final String ACTION_STOP   = "ACTION_STOP";
    public static final String ACTION_UPDATE = "ACTION_UPDATE";
    public static final String EXTRA_TITLE   = "extra_title";
    public static final String EXTRA_TEXT    = "extra_text";

    @Override
    public void onCreate() {
        super.onCreate();
        createNotificationChannel();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent != null ? intent.getAction() : null;

        if (ACTION_STOP.equals(action)) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                stopForeground(STOP_FOREGROUND_REMOVE);
            } else {
                //noinspection deprecation
                stopForeground(true);
            }
            stopSelf();
        } else if (ACTION_UPDATE.equals(action) || ACTION_START.equals(action)) {
            String title = intent.getStringExtra(EXTRA_TITLE);
            String text  = intent.getStringExtra(EXTRA_TEXT);
            if (title == null) title = "কাজ চলছে…";
            if (text  == null) text  = "Background sync active";
            startForeground(NOTIF_ID, buildNotif(title, text));
        } else {
            startForeground(NOTIF_ID, buildNotif("কাজ চলছে…", "Background sync active"));
        }

        return START_STICKY;
    }

    private Notification buildNotif(String title, String text) {
        Intent launch = getPackageManager().getLaunchIntentForPackage(getPackageName());
        PendingIntent pi = PendingIntent.getActivity(
            this, 0, launch,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
        return new NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle(title)
            .setContentText(text)
            .setSmallIcon(android.R.drawable.ic_popup_sync)
            .setOngoing(true)
            .setContentIntent(pi)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setSilent(true)
            .build();
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID, "Background Sync",
                NotificationManager.IMPORTANCE_LOW
            );
            channel.setDescription("Admin app background tasks");
            channel.setShowBadge(false);
            ((NotificationManager) getSystemService(NOTIFICATION_SERVICE))
                .createNotificationChannel(channel);
        }
    }

    @Override
    public IBinder onBind(Intent intent) { return null; }
}
