package com.smartstudy.admin

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.ColorMatrix
import android.graphics.ColorMatrixColorFilter
import android.graphics.Paint
import android.util.Base64
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import com.google.mlkit.vision.text.devanagari.DevanagariTextRecognizerOptions

@CapacitorPlugin(name = "OcrPlugin")
class OcrPlugin : Plugin() {

    @PluginMethod
    fun recognizeText(call: PluginCall) {
        val b64 = call.getString("base64")
            ?: run { call.reject("base64 required"); return }

        val bytes = try {
            Base64.decode(b64, Base64.DEFAULT)
        } catch (e: Exception) {
            call.reject("base64 decode error: ${e.message}"); return
        }

        val bmp = BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
            ?: run { call.reject("bitmap decode failed"); return }

        val sized    = ensureMinSize(bmp)
        val enhanced = enhance(sized)

        var best    = ""
        var pending = 2
        val lock    = Object()

        fun done(txt: String) {
            synchronized(lock) {
                if (txt.length > best.length) best = txt
                pending--
                if (pending == 0) {
                    if (sized !== bmp) sized.recycle()
                    enhanced.recycle()
                    val ret = JSObject()
                    ret.put("text", best)
                    call.resolve(ret)
                }
            }
        }

        // Latin recognizer
        TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS)
            .process(InputImage.fromBitmap(enhanced, 0))
            .addOnSuccessListener { r ->
                done(r.textBlocks.flatMap { it.lines }.joinToString("\n") { it.text })
            }
            .addOnFailureListener { done("") }

        // Devanagari recognizer (Bengali support)
        TextRecognition.getClient(DevanagariTextRecognizerOptions.Builder().build())
            .process(InputImage.fromBitmap(enhanced, 0))
            .addOnSuccessListener { r ->
                done(r.textBlocks.flatMap { it.lines }.joinToString("\n") { it.text })
            }
            .addOnFailureListener { done("") }
    }

    private fun ensureMinSize(bmp: Bitmap): Bitmap {
        val min = 1080
        val s = minOf(bmp.width, bmp.height)
        if (s >= min) return bmp
        val sc = min.toFloat() / s
        return Bitmap.createScaledBitmap(bmp,
            (bmp.width * sc).toInt(), (bmp.height * sc).toInt(), true)
    }

    private fun enhance(src: Bitmap): Bitmap {
        val out = Bitmap.createBitmap(src.width, src.height, Bitmap.Config.ARGB_8888)
        val p = Paint(Paint.ANTI_ALIAS_FLAG)
        val cm = ColorMatrix().apply { setSaturation(0f) }
        cm.postConcat(ColorMatrix(floatArrayOf(
            1.8f, 0f, 0f, 0f, -60f,
            0f, 1.8f, 0f, 0f, -60f,
            0f, 0f, 1.8f, 0f, -60f,
            0f, 0f, 0f, 1f, 0f
        )))
        p.colorFilter = ColorMatrixColorFilter(cm)
        Canvas(out).drawBitmap(src, 0f, 0f, p)
        return out
    }
}
