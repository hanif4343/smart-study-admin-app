package com.smartstudy.admin;

import android.content.Intent;
import android.os.Build;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * BgSyncPlugin — Capacitor Bridge
 *
 * JS এ window.Capacitor.Plugins.BgSync.start({title,text}) call করলে
 * foreground service চালু হয়।
 * window.Capacitor.Plugins.BgSync.stop() এ বন্ধ হয়।
 */
@CapacitorPlugin(name = "BgSync")
public class BgSyncPlugin extends Plugin {

    @PluginMethod
    public void start(PluginCall call) {
        String title = call.getString("title", "কাজ চলছে…");
        String text  = call.getString("text",  "Background sync active");

        Intent intent = new Intent(getContext(), BackgroundSyncService.class);
        intent.setAction(BackgroundSyncService.ACTION_START);
        intent.putExtra(BackgroundSyncService.EXTRA_TITLE, title);
        intent.putExtra(BackgroundSyncService.EXTRA_TEXT,  text);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            getContext().startForegroundService(intent);
        } else {
            getContext().startService(intent);
        }
        call.resolve();
    }

    @PluginMethod
    public void update(PluginCall call) {
        String title = call.getString("title", "কাজ চলছে…");
        String text  = call.getString("text",  "");

        Intent intent = new Intent(getContext(), BackgroundSyncService.class);
        intent.setAction(BackgroundSyncService.ACTION_UPDATE);
        intent.putExtra(BackgroundSyncService.EXTRA_TITLE, title);
        intent.putExtra(BackgroundSyncService.EXTRA_TEXT,  text);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            getContext().startForegroundService(intent);
        } else {
            getContext().startService(intent);
        }
        call.resolve();
    }

    @PluginMethod
    public void stop(PluginCall call) {
        Intent intent = new Intent(getContext(), BackgroundSyncService.class);
        intent.setAction(BackgroundSyncService.ACTION_STOP);
        getContext().stopService(intent);
        call.resolve();
    }
}
