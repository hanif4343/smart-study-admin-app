package com.smartstudy.admin;

import android.Manifest;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.pm.PackageManager;
import android.os.Build;

import androidx.core.app.ActivityCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.firebase.messaging.FirebaseMessaging;

/**
 * AdminPushPlugin — Admin app এ FCM token নিয়ে Firebase এ save করে।
 * Main app এই token এ admin কে report/technique notification পাঠাবে।
 */
@CapacitorPlugin(name = "AdminPush")
public class AdminPushPlugin extends Plugin {

    public static final String CHANNEL_ID   = "admin_notif_channel";
    public static final String CHANNEL_NAME = "Admin Notifications";

    @Override
    public void load() {
        super.load();
        createNotificationChannel();
    }

    /** FCM token নাও — JS side থেকে call করবে login এর পরে */
    @PluginMethod
    public void getToken(PluginCall call) {
        FirebaseMessaging.getInstance().getToken()
            .addOnSuccessListener(token -> {
                JSObject ret = new JSObject();
                ret.put("token", token);
                call.resolve(ret);
            })
            .addOnFailureListener(e -> {
                call.reject("FCM token error: " + e.getMessage());
            });
    }

    /** Notification permission request (Android 13+) */
    @PluginMethod
    public void requestPermission(PluginCall call) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (ActivityCompat.checkSelfPermission(getContext(),
                    Manifest.permission.POST_NOTIFICATIONS)
                    != PackageManager.PERMISSION_GRANTED) {
                ActivityCompat.requestPermissions(
                    getActivity(),
                    new String[]{ Manifest.permission.POST_NOTIFICATIONS },
                    1001
                );
            }
        }
        JSObject ret = new JSObject();
        ret.put("granted", true);
        call.resolve(ret);
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID, CHANNEL_NAME,
                NotificationManager.IMPORTANCE_HIGH
            );
            channel.setDescription("Smart Study Admin notifications");
            channel.enableVibration(true);

            NotificationManager nm =
                (NotificationManager) getContext()
                    .getSystemService(NotificationManager.class);
            nm.createNotificationChannel(channel);
        }
    }
}
