package com.smartstudy.admin;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Intent;
import android.os.Build;

import androidx.core.app.NotificationCompat;

import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;

import java.util.Map;

/**
 * AdminMessagingService — FCM push receive করে notification দেখায়
 * App minimize/closed থাকলেও কাজ করে
 */
public class AdminMessagingService extends FirebaseMessagingService {

    @Override
    public void onMessageReceived(RemoteMessage msg) {
        Map<String, String> data = msg.getData();

        String title = data.containsKey("title") ? data.get("title") :
                       (msg.getNotification() != null ? msg.getNotification().getTitle() :
                        "Smart Study Admin");
        String body  = data.containsKey("body")  ? data.get("body")  :
                       (msg.getNotification() != null ? msg.getNotification().getBody() : "");
        String type  = data.containsKey("type")  ? data.get("type")  : "";

        String page = "";
        if (type.contains("report"))    page = "reports";
        else if (type.contains("technique")) page = "techniques";

        showNotification(title != null ? title : "Smart Study Admin",
                         body  != null ? body  : "", page);
    }

    @Override
    public void onNewToken(String token) {
        super.onNewToken(token);
        // Token refresh হলে MainActivity-তে broadcast
        Intent intent = new Intent("com.smartstudy.admin.FCM_TOKEN_REFRESH");
        intent.putExtra("token", token);
        sendBroadcast(intent);
    }

    private void showNotification(String title, String body, String page) {
        String channelId = "admin_alerts";
        NotificationManager nm =
            (NotificationManager) getSystemService(NOTIFICATION_SERVICE);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel ch = new NotificationChannel(
                channelId, "Admin Alerts",
                NotificationManager.IMPORTANCE_HIGH
            );
            ch.setDescription("Report & Technique alerts");
            nm.createNotificationChannel(ch);
        }

        Intent intent = new Intent(this, MainActivity.class);
        intent.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP |
                        Intent.FLAG_ACTIVITY_CLEAR_TOP);
        intent.putExtra("admin_nav_page", page);

        PendingIntent pi = PendingIntent.getActivity(
            this, page.hashCode(), intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        android.app.Notification notif = new NotificationCompat.Builder(this, channelId)
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentTitle(title)
            .setContentText(body)
            .setAutoCancel(true)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setContentIntent(pi)
            .build();

        nm.notify((int) System.currentTimeMillis(), notif);
    }
}
