package com.smartstudy.admin

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.ColorMatrix
import android.graphics.ColorMatrixColorFilter
import android.graphics.Paint
import android.graphics.Rect
import android.util.Base64
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.Text
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import com.google.mlkit.vision.text.devanagari.DevanagariTextRecognizerOptions

@CapacitorPlugin(name = "OcrPlugin")
class OcrPlugin : Plugin() {

    // ─── Public entry point ───────────────────────────────────────────────────
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

        // ── IMPROVEMENT 1: Column detection ──────────────────────────────────
        // landscape বা wide page হলে (width > height × 1.3) বাম/ডান দুই কলাম
        // আলাদা আলাদা OCR করি, তারপর merge করি।
        val isWide = enhanced.width > enhanced.height * 1.3f
        val strips: List<Bitmap> = if (isWide) {
            val mid = enhanced.width / 2
            listOf(
                Bitmap.createBitmap(enhanced, 0,   0, mid,                  enhanced.height),
                Bitmap.createBitmap(enhanced, mid, 0, enhanced.width - mid, enhanced.height)
            )
        } else {
            listOf(enhanced)
        }

        // প্রতিটি strip-এর জন্য দুটো recognizer (Latin + Devanagari) চালাই
        // total pending = strips × 2
        val results   = Array(strips.size) { "" }  // per-strip best result
        val pending2  = Array(strips.size) { 2 }   // each strip: 2 pending
        val lock      = Object()

        fun checkDone() {
            synchronized(lock) {
                if (pending2.all { it == 0 }) {
                    // cleanup
                    if (sized !== bmp) sized.recycle()
                    enhanced.recycle()
                    strips.forEach { if (it !== enhanced) it.recycle() }

                    // ── IMPROVEMENT 2 & 3: bounding-box grouping + regex parse ──
                    val finalText = results.joinToString("\n\n--- COLUMN ---\n\n")
                    val parsed    = parseQuestions(finalText)

                    val ret = JSObject()
                    ret.put("text",   finalText)   // raw — UI-তে দেখার জন্য
                    ret.put("parsed", parsed)       // semicolon format — bulk uploader ready
                    call.resolve(ret)
                }
            }
        }

        strips.forEachIndexed { si, strip ->
            val img = InputImage.fromBitmap(strip, 0)

            // Latin recognizer — bounding box সহ
            TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS)
                .process(img)
                .addOnSuccessListener { r ->
                    synchronized(lock) {
                        val grouped = groupByBoundingBox(r)
                        if (grouped.length > results[si].length) results[si] = grouped
                        pending2[si]--
                        checkDone()
                    }
                }
                .addOnFailureListener {
                    synchronized(lock) { pending2[si]--; checkDone() }
                }

            // Devanagari (Bengali) recognizer — bounding box সহ
            TextRecognition.getClient(DevanagariTextRecognizerOptions.Builder().build())
                .process(img)
                .addOnSuccessListener { r ->
                    synchronized(lock) {
                        val grouped = groupByBoundingBox(r)
                        if (grouped.length > results[si].length) results[si] = grouped
                        pending2[si]--
                        checkDone()
                    }
                }
                .addOnFailureListener {
                    synchronized(lock) { pending2[si]--; checkDone() }
                }
        }
    }

    // ─── IMPROVEMENT 2: Bounding-box line grouping ───────────────────────────
    // MLKit-এর TextBlock গুলো bounding box দিয়ে sort করি:
    //   - Y position অনুযায়ী row-এ group করি (একই "row" = Y পার্থক্য < lineHeight×0.6)
    //   - প্রতিটি row-এর মধ্যে X অনুযায়ী sort করি (বাম→ডান)
    // এতে বিক্ষিপ্ত blocks সঠিক পড়ার ক্রমে আসে।
    private fun groupByBoundingBox(result: Text): String {
        data class LineBlock(val top: Int, val left: Int, val text: String)

        val blocks = mutableListOf<LineBlock>()
        for (block in result.textBlocks) {
            for (line in block.lines) {
                val box = line.boundingBox ?: continue
                blocks.add(LineBlock(box.top, box.left, line.text))
            }
        }
        if (blocks.isEmpty()) return ""

        // average line height হিসেব করি — grouping threshold-এ কাজে লাগবে
        val avgH = blocks.map { b ->
            result.textBlocks
                .flatMap { it.lines }
                .find { it.text == b.text }
                ?.boundingBox?.height() ?: 30
        }.average().toInt().coerceAtLeast(20)

        val threshold = (avgH * 0.55).toInt()

        // Y দিয়ে sort করে row-এ group করি
        blocks.sortWith(compareBy({ it.top }, { it.left }))

        val rows = mutableListOf<MutableList<LineBlock>>()
        for (b in blocks) {
            val last = rows.lastOrNull()
            if (last != null && b.top - last.last().top < threshold) {
                last.add(b)
            } else {
                rows.add(mutableListOf(b))
            }
        }

        return rows.joinToString("\n") { row ->
            row.sortedBy { it.left }.joinToString(" ") { it.text }
        }
    }

    // ─── IMPROVEMENT 3: Regex-based question parser ──────────────────────────
    // Raw OCR text → semicolon format (bulk uploader ready)
    //
    // Supports:
    //   ১. বাংলা নম্বর:  ৫৮.প্রশ্ন  or  ৫৮।প্রশ্ন
    //   ২. Arabic নম্বর: 58.Question or 58।Question
    //   ৩. Options:      ক. / খ. / গ. / ঘ.   (বাংলা)
    //                    a) / b) / c) / d)    (Latin)
    //   ৪. Answer hint:  উ. ক  /  উ. খ  ইত্যাদি (বাংলা বইয়ে প্রচলিত)
    //
    // Output: প্রশ্ন ; অপ১ ; অপ২ ; অপ৩ ; অপ৪ ; সঠিক_উত্তর
    // যে প্রশ্নে answer পাওয়া না গেলে শেষ field খালি রাখা হয়।
    private fun parseQuestions(rawText: String): String {
        val lines = rawText.lines().map { it.trim() }.filter { it.isNotBlank() }

        // Patterns
        val questionStart = Regex(
            """^([০-৯]{1,3}|[0-9]{1,3})[.।]\s*(.+)"""
        )
        val optionBengali  = Regex("""^[ক-ঘ][.)।\s]\s*(.+)""")
        val optionLatin    = Regex("""^[a-dA-D][.)]\s*(.+)""")
        val answerHint     = Regex("""উ[।.]\s*([কখগঘa-dA-D])""")

        data class MCQ(
            val question : String,
            val opts     : MutableList<String> = mutableListOf(),
            var answer   : String = ""
        )

        val questions = mutableListOf<MCQ>()
        var current: MCQ? = null

        for (line in lines) {
            val qMatch = questionStart.find(line)
            if (qMatch != null) {
                // নতুন প্রশ্ন শুরু
                current?.let { questions.add(it) }
                current = MCQ(question = qMatch.groupValues[2].trim())
                continue
            }
            if (current == null) continue

            val optBn = optionBengali.find(line)
            val optLa = optionLatin.find(line)
            when {
                optBn != null -> current!!.opts.add(optBn.groupValues[1].trim())
                optLa != null -> current!!.opts.add(optLa.groupValues[1].trim())
            }

            // Answer hint — "উ. ক" → correct = opts[0], "উ. খ" → opts[1] ইত্যাদি
            val ansMatch = answerHint.find(line)
            if (ansMatch != null && current!!.answer.isEmpty()) {
                val letter = ansMatch.groupValues[1]
                val idx = when (letter) {
                    "ক", "a", "A" -> 0
                    "খ", "b", "B" -> 1
                    "গ", "c", "C" -> 2
                    "ঘ", "d", "D" -> 3
                    else           -> -1
                }
                if (idx >= 0 && idx < current!!.opts.size) {
                    current!!.answer = current!!.opts[idx]
                }
            }
        }
        current?.let { questions.add(it) }

        if (questions.isEmpty()) return ""

        // Build semicolon lines — ৪টি অপশন না থাকলে খালি দিই
        return questions.joinToString("\n") { q ->
            val o = q.opts
            val o1 = o.getOrElse(0) { "" }
            val o2 = o.getOrElse(1) { "" }
            val o3 = o.getOrElse(2) { "" }
            val o4 = o.getOrElse(3) { "" }
            // semicolon-এর ভেতরে ; থাকলে | দিয়ে replace
            fun esc(s: String) = s.replace(";", "|")
            "${esc(q.question)} ; ${esc(o1)} ; ${esc(o2)} ; ${esc(o3)} ; ${esc(o4)} ; ${esc(q.answer)}"
        }
    }

    // ─── Helpers ──────────────────────────────────────────────────────────────
    private fun ensureMinSize(bmp: Bitmap): Bitmap {
        val min = 1080
        val s   = minOf(bmp.width, bmp.height)
        if (s >= min) return bmp
        val sc  = min.toFloat() / s
        return Bitmap.createScaledBitmap(bmp,
            (bmp.width * sc).toInt(), (bmp.height * sc).toInt(), true)
    }

    private fun enhance(src: Bitmap): Bitmap {
        val out = Bitmap.createBitmap(src.width, src.height, Bitmap.Config.ARGB_8888)
        val p   = Paint(Paint.ANTI_ALIAS_FLAG)
        val cm  = ColorMatrix().apply { setSaturation(0f) }
        cm.postConcat(ColorMatrix(floatArrayOf(
            1.8f, 0f, 0f, 0f, -60f,
            0f, 1.8f, 0f, 0f, -60f,
            0f, 0f, 1.8f, 0f, -60f,
            0f, 0f, 0f, 1f,   0f
        )))
        p.colorFilter = ColorMatrixColorFilter(cm)
        Canvas(out).drawBitmap(src, 0f, 0f, p)
        return out
    }
}
