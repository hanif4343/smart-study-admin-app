package com.smartstudy.admin

import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.widget.Toast
import com.getcapacitor.BridgeActivity

class MainActivity : BridgeActivity() {
    private var backPressedOnce = false

    override fun onCreate(savedInstanceState: Bundle?) {
        registerPlugin(OcrPlugin::class.java)
        registerPlugin(BgSyncPlugin::class.java)
        super.onCreate(savedInstanceState)
    }

    override fun onBackPressed() {
        // JS side এ back event পাঠাও — React এ modal/page close করুক
        val handled = bridge?.triggerWindowJSEvent("androidBackButton", "{}") ?: false

        if (!handled) {
            // JS handle না করলে — double back to exit
            if (backPressedOnce) {
                super.onBackPressed() // app close
                return
            }
            backPressedOnce = true
            Toast.makeText(this, "আবার Back চাপুন বন্ধ করতে", Toast.LENGTH_SHORT).show()
            Handler(Looper.getMainLooper()).postDelayed({
                backPressedOnce = false
            }, 2000)
        }
    }
}
