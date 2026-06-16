package com.smartstudy.admin

import android.os.Bundle
import com.getcapacitor.BridgeActivity

class MainActivity : BridgeActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        registerPlugin(OcrPlugin::class.java)
        registerPlugin(BgSyncPlugin::class.java)
        super.onCreate(savedInstanceState)
    }
}
