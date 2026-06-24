package com.smartstudy.admin;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.widget.Toast;
import com.getcapacitor.BridgeActivity;
import com.capacitorjs.plugins.camera.CameraPlugin;

public class MainActivity extends BridgeActivity {
    private boolean backPressedOnce = false;

    private final BroadcastReceiver tokenReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context ctx, Intent intent) {
            String token = intent.getStringExtra("token");
            if (token == null) return;
            if (getBridge() != null)
                getBridge().triggerWindowJSEvent("fcmTokenRefresh",
                    "{\"token\":\"" + token + "\"}");
        }
    };

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(CameraPlugin.class);
        registerPlugin(OcrPlugin.class);
        registerPlugin(BgSyncPlugin.class);
        registerPlugin(FcmTokenPlugin.class);
        registerPlugin(AdminPushPlugin.class);
        super.onCreate(savedInstanceState);
        handleNavIntent(getIntent());
    }

    @Override
    public void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        handleNavIntent(intent);
    }

    @Override
    public void onResume() {
        super.onResume();
        IntentFilter filter = new IntentFilter("com.smartstudy.admin.FCM_TOKEN_REFRESH");
        registerReceiver(tokenReceiver, filter);
    }

    @Override
    public void onPause() {
        super.onPause();
        try { unregisterReceiver(tokenReceiver); } catch (Exception ignored) {}
    }

    private void handleNavIntent(Intent intent) {
        if (intent == null) return;
        String page = intent.getStringExtra("admin_nav_page");
        if (page == null || page.isEmpty()) return;
        new Handler(Looper.getMainLooper()).postDelayed(() -> {
            if (getBridge() != null)
                getBridge().triggerWindowJSEvent("adminNavTo",
                    "{\"page\":\"" + page + "\"}");
        }, 800);
    }

    @Override
    public void onBackPressed() {
        if (getBridge() != null)
            getBridge().triggerWindowJSEvent("androidBackButton", "{}");
        if (backPressedOnce) { super.onBackPressed(); return; }
        backPressedOnce = true;
        Toast.makeText(this, "আবার Back চাপুন বন্ধ করতে", Toast.LENGTH_SHORT).show();
        new Handler(Looper.getMainLooper()).postDelayed(() -> backPressedOnce = false, 2000);
    }
}
