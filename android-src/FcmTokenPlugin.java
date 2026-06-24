package com.smartstudy.admin;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.firebase.messaging.FirebaseMessaging;

/**
 * FcmTokenPlugin — Admin App এর FCM Token JS এ পাঠায়
 * JS: window.Capacitor.Plugins.FcmToken.getToken() → {token: "..."}
 */
@CapacitorPlugin(name = "FcmToken")
public class FcmTokenPlugin extends Plugin {

    @PluginMethod
    public void getToken(PluginCall call) {
        FirebaseMessaging.getInstance().getToken()
            .addOnCompleteListener(task -> {
                if (!task.isSuccessful()) {
                    Exception e = task.getException();
                    call.reject("FCM token fetch failed: " +
                        (e != null ? e.getMessage() : "unknown"));
                    return;
                }
                JSObject result = new JSObject();
                result.put("token", task.getResult() != null ? task.getResult() : "");
                call.resolve(result);
            });
    }
}
