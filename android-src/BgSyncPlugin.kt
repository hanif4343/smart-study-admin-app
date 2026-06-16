package com.smartstudy.admin

import android.content.Intent
import android.os.Build
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

/**
 * BgSyncPlugin — Capacitor Bridge
 *
 * JS এ window.Capacitor.Plugins.BgSync.start({title,text}) call করলে
 * foreground service চালু হয়।
 * window.Capacitor.Plugins.BgSync.stop() এ বন্ধ হয়।
 */
@CapacitorPlugin(name = "BgSync")
class BgSyncPlugin : Plugin() {

    @PluginMethod
    fun start(call: PluginCall) {
        val title = call.getString("title", "কাজ চলছে…")!!
        val text  = call.getString("text",  "Background sync active")!!
        val intent = Intent(context, BackgroundSyncService::class.java).apply {
            action = BackgroundSyncService.ACTION_START
            putExtra(BackgroundSyncService.EXTRA_TITLE, title)
            putExtra(BackgroundSyncService.EXTRA_TEXT,  text)
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            context.startForegroundService(intent)
        } else {
            context.startService(intent)
        }
        call.resolve()
    }

    @PluginMethod
    fun update(call: PluginCall) {
        val title = call.getString("title", "কাজ চলছে…")!!
        val text  = call.getString("text",  "")!!
        val intent = Intent(context, BackgroundSyncService::class.java).apply {
            action = BackgroundSyncService.ACTION_UPDATE
            putExtra(BackgroundSyncService.EXTRA_TITLE, title)
            putExtra(BackgroundSyncService.EXTRA_TEXT,  text)
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            context.startForegroundService(intent)
        } else {
            context.startService(intent)
        }
        call.resolve()
    }

    @PluginMethod
    fun stop(call: PluginCall) {
        val intent = Intent(context, BackgroundSyncService::class.java).apply {
            action = BackgroundSyncService.ACTION_STOP
        }
        context.stopService(intent)
        call.resolve()
    }
}
