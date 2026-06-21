package com.smartstudy.admin

import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.JSObject
import com.getcapacitor.annotation.CapacitorPlugin
import com.google.firebase.messaging.FirebaseMessaging

/**
 * FcmTokenPlugin — Admin App এর FCM Token JS এ পাঠায়
 * JS: window.Capacitor.Plugins.FcmToken.getToken() → {token: "..."}
 */
@CapacitorPlugin(name = "FcmToken")
class FcmTokenPlugin : Plugin() {
    @PluginMethod
    fun getToken(call: PluginCall) {
        FirebaseMessaging.getInstance().token.addOnCompleteListener { task ->
            if (!task.isSuccessful) {
                call.reject("FCM token fetch failed: ${task.exception?.message}")
                return@addOnCompleteListener
            }
            val result = JSObject()
            result.put("token", task.result ?: "")
            call.resolve(result)
        }
    }
}
