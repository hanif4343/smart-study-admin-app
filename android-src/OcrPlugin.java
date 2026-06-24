package com.smartstudy.admin;

import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Canvas;
import android.graphics.ColorMatrix;
import android.graphics.ColorMatrixColorFilter;
import android.graphics.Paint;
import android.util.Base64;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import com.google.mlkit.vision.common.InputImage;
import com.google.mlkit.vision.text.Text;
import com.google.mlkit.vision.text.TextRecognition;
import com.google.mlkit.vision.text.latin.TextRecognizerOptions;
import com.google.mlkit.vision.text.devanagari.DevanagariTextRecognizerOptions;

import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

@CapacitorPlugin(name = "OcrPlugin")
public class OcrPlugin extends Plugin {

    // ─── Public entry point ───────────────────────────────────────────────────
    @PluginMethod
    public void recognizeText(PluginCall call) {
        String b64 = call.getString("base64");
        if (b64 == null) { call.reject("base64 required"); return; }

        byte[] bytes;
        try {
            bytes = Base64.decode(b64, Base64.DEFAULT);
        } catch (Exception e) {
            call.reject("base64 decode error: " + e.getMessage()); return;
        }

        final Bitmap bmp = BitmapFactory.decodeByteArray(bytes, 0, bytes.length);
        if (bmp == null) { call.reject("bitmap decode failed"); return; }

        final Bitmap sized    = ensureMinSize(bmp);
        final Bitmap enhanced = enhance(sized);

        // ── COLUMN SPLIT ──────────────────────────────────────────────────────
        // exam paper সবসময় 2-column। portrait হলেও সবসময় দুই ভাগ করি।
        // (landscape হলে আরো obvious যে 2-column)
        int mid = enhanced.getWidth() / 2;
        final Bitmap leftCol  = Bitmap.createBitmap(enhanced, 0,   0, mid,                     enhanced.getHeight());
        final Bitmap rightCol = Bitmap.createBitmap(enhanced, mid, 0, enhanced.getWidth() - mid, enhanced.getHeight());
        final Bitmap[] strips = { leftCol, rightCol };

        // প্রতিটি strip: Latin + Devanagari → best result রাখি
        // total pending = 2 strips × 2 recognizers = 4
        final String[]  results  = { "", "" };   // per-strip best
        final int[]     pending  = { 2, 2 };     // each strip: 2 remaining
        final Object    lock     = new Object();

        for (int si = 0; si < strips.length; si++) {
            final int stripIndex = si;
            final Bitmap strip   = strips[si];
            final InputImage img = InputImage.fromBitmap(strip, 0);

            // Latin recognizer
            TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS)
                .process(img)
                .addOnSuccessListener(r -> {
                    synchronized (lock) {
                        String grouped = groupByBoundingBox(r);
                        if (grouped.length() > results[stripIndex].length())
                            results[stripIndex] = grouped;
                        pending[stripIndex]--;
                        checkDone(call, results, pending, lock,
                                  sized, bmp, enhanced, strips);
                    }
                })
                .addOnFailureListener(e -> {
                    synchronized (lock) {
                        pending[stripIndex]--;
                        checkDone(call, results, pending, lock,
                                  sized, bmp, enhanced, strips);
                    }
                });

            // Devanagari (Bengali) recognizer
            TextRecognition.getClient(
                    new DevanagariTextRecognizerOptions.Builder().build())
                .process(img)
                .addOnSuccessListener(r -> {
                    synchronized (lock) {
                        String grouped = groupByBoundingBox(r);
                        if (grouped.length() > results[stripIndex].length())
                            results[stripIndex] = grouped;
                        pending[stripIndex]--;
                        checkDone(call, results, pending, lock,
                                  sized, bmp, enhanced, strips);
                    }
                })
                .addOnFailureListener(e -> {
                    synchronized (lock) {
                        pending[stripIndex]--;
                        checkDone(call, results, pending, lock,
                                  sized, bmp, enhanced, strips);
                    }
                });
        }
    }

    // ─── checkDone ────────────────────────────────────────────────────────────
    private void checkDone(PluginCall call, String[] results, int[] pending,
                           Object lock, Bitmap sized, Bitmap bmp,
                           Bitmap enhanced, Bitmap[] strips) {
        // Must be called inside synchronized(lock)
        boolean allDone = true;
        for (int p : pending) if (p > 0) { allDone = false; break; }
        if (!allDone) return;

        // cleanup
        if (sized != bmp)     sized.recycle();
        enhanced.recycle();
        for (Bitmap s : strips) if (s != enhanced) s.recycle();

        // merge columns — বাম কলামের পরে ডান কলাম
        String leftText  = results[0];
        String rightText = results[1];
        String finalText = leftText + "\n\n--- COLUMN ---\n\n" + rightText;

        // parse
        String parsed = parseQuestions(finalText);

        JSObject ret = new JSObject();
        ret.put("text",   finalText);
        ret.put("parsed", parsed);
        call.resolve(ret);
    }

    // ─── IMPROVEMENT: Bounding-box line grouping ──────────────────────────────
    // MLKit TextBlock গুলো bounding box দিয়ে sort করি:
    //   - Y position অনুযায়ী row-এ group (Y পার্থক্য < avgLineHeight × 0.55)
    //   - প্রতিটি row-এ X অনুযায়ী sort (বাম→ডান)
    private String groupByBoundingBox(Text result) {
        // LineBlock: top, left, height, text
        List<int[]> blocks = new ArrayList<>();  // [top, left, height]
        List<String> texts = new ArrayList<>();

        for (Text.TextBlock block : result.getTextBlocks()) {
            for (Text.Line line : block.getLines()) {
                android.graphics.Rect box = line.getBoundingBox();
                if (box == null) continue;
                blocks.add(new int[]{ box.top, box.left, box.height() });
                texts.add(line.getText());
            }
        }
        if (blocks.isEmpty()) return "";

        // average line height
        int sumH = 0;
        for (int[] b : blocks) sumH += b[2];
        int avgH      = Math.max(sumH / blocks.size(), 20);
        int threshold = (int)(avgH * 0.55);

        // index list, Y-sort
        List<Integer> indices = new ArrayList<>();
        for (int i = 0; i < blocks.size(); i++) indices.add(i);
        Collections.sort(indices, (a, b2) -> {
            int cmp = Integer.compare(blocks.get(a)[0], blocks.get(b2)[0]);
            return cmp != 0 ? cmp : Integer.compare(blocks.get(a)[1], blocks.get(b2)[1]);
        });

        // group into rows
        List<List<Integer>> rows = new ArrayList<>();
        for (int idx : indices) {
            int top = blocks.get(idx)[0];
            if (!rows.isEmpty()) {
                List<Integer> lastRow = rows.get(rows.size() - 1);
                int lastTop = blocks.get(lastRow.get(lastRow.size() - 1))[0];
                if (top - lastTop < threshold) {
                    lastRow.add(idx);
                    continue;
                }
            }
            List<Integer> newRow = new ArrayList<>();
            newRow.add(idx);
            rows.add(newRow);
        }

        // build text: each row → sort by X → join with space
        StringBuilder sb = new StringBuilder();
        for (List<Integer> row : rows) {
            Collections.sort(row, (a, b2) ->
                Integer.compare(blocks.get(a)[1], blocks.get(b2)[1]));
            for (int i = 0; i < row.size(); i++) {
                if (i > 0) sb.append(' ');
                sb.append(texts.get(row.get(i)));
            }
            sb.append('\n');
        }
        return sb.toString().trim();
    }

    // ─── IMPROVEMENT: Regex MCQ parser ───────────────────────────────────────
    //
    // Supports:
    //   প্রশ্ন নম্বর:  ৫৮. / ৫৮। / 58. / 58।   (বাংলা ও Arabic উভয়)
    //   অপশন (বাংলা): ক. / ক) / ক। + text
    //   অপশন (Latin):  a. / a) + text
    //   উত্তর hint:   উ. ক / উ. খ / উ: ক / Answer: a   ইত্যাদি
    //   multi-line প্রশ্ন: পরের line-ও প্রশ্নের অংশ (যতক্ষণ option না আসে)
    //
    // Output: প্রশ্ন;অপ১;অপ২;অপ৩;অপ৪;সঠিক_উত্তর
    //
    private String parseQuestions(String rawText) {

        // বাংলা digit → latin digit (normalize করি তুলনার জন্য)
        String normalized = toBnDigitNorm(rawText);
        String[] lines = normalized.split("\n");

        // Patterns
        Pattern pQuestion  = Pattern.compile(
            "^([\\d]{1,3})[.।]\\s*(.+)");
        Pattern pOptBengali = Pattern.compile(
            "^[ক-ঘ][.)।]\\s*(.+)");
        Pattern pOptLatin   = Pattern.compile(
            "^[a-dA-D][.)\\s]\\s*(.+)");
        // উত্তর: "উ. ক", "উ: খ", "উঃ গ", "Answer: b", "ans: c"
        Pattern pAnswer     = Pattern.compile(
            "(?:উ[।.:\\s]+|[Aa]ns(?:wer)?[:\\s]+)([কখগঘa-dA-D])");
        // পৃষ্ঠা নম্বর line — skip করব
        Pattern pPageSkip   = Pattern.compile(
            "^পৃষ্ঠা|^--- COLUMN ---|^page\\s*\\d");

        // State
        List<String[]> questions = new ArrayList<>();
        // current: [question, opt1, opt2, opt3, opt4, answer]
        String[]  cur     = null;
        int       optIdx  = 0;
        boolean   inQ     = false; // প্রশ্নের text এখনো আসছে

        for (String rawLine : lines) {
            String line = rawLine.trim();
            if (line.isEmpty()) continue;
            if (pPageSkip.matcher(line).find()) continue;

            Matcher qm = pQuestion.matcher(line);
            if (qm.find()) {
                // নতুন প্রশ্ন
                if (cur != null) questions.add(cur);
                cur    = new String[]{ qm.group(2).trim(), "", "", "", "", "" };
                optIdx = 1;
                inQ    = true;
                continue;
            }
            if (cur == null) continue;

            Matcher om_bn = pOptBengali.matcher(line);
            Matcher om_la = pOptLatin.matcher(line);
            String optText = null;
            if (om_bn.find())       { optText = om_bn.group(1).trim(); inQ = false; }
            else if (om_la.find())  { optText = om_la.group(1).trim(); inQ = false; }

            if (optText != null && optIdx <= 4) {
                cur[optIdx] = optText;
                optIdx++;
                continue;
            }

            // উত্তর hint
            Matcher am = pAnswer.matcher(line);
            if (am.find()) {
                String letter = am.group(1);
                int ai = letterToIndex(letter);
                if (ai >= 1 && ai <= 4 && !cur[ai].isEmpty())
                    cur[5] = cur[ai];
                continue;
            }

            // multi-line প্রশ্ন: option শুরু না হলে প্রশ্নের অংশ
            if (inQ && optIdx == 1) {
                cur[0] = cur[0] + " " + line;
            }
        }
        if (cur != null) questions.add(cur);

        if (questions.isEmpty()) return "";

        StringBuilder sb = new StringBuilder();
        for (String[] q : questions) {
            sb.append(esc(q[0])).append(';')
              .append(esc(q[1])).append(';')
              .append(esc(q[2])).append(';')
              .append(esc(q[3])).append(';')
              .append(esc(q[4])).append(';')
              .append(esc(q[5])).append('\n');
        }
        return sb.toString().trim();
    }

    // বাংলা সংখ্যা → Latin digit  (শুধু question number match-এর জন্য)
    private String toBnDigitNorm(String s) {
        return s
            .replace('০','0').replace('১','1').replace('২','2')
            .replace('৩','3').replace('৪','4').replace('৫','5')
            .replace('৬','6').replace('৭','7').replace('৮','8')
            .replace('৯','9');
    }

    // ক→1, খ→2, গ→3, ঘ→4, a/A→1 ...
    private int letterToIndex(String l) {
        switch (l) {
            case "ক": case "a": case "A": return 1;
            case "খ": case "b": case "B": return 2;
            case "গ": case "c": case "C": return 3;
            case "ঘ": case "d": case "D": return 4;
        }
        return -1;
    }

    // semicolon escape
    private String esc(String s) {
        return s == null ? "" : s.replace(";", "|");
    }

    // ─── Helpers ──────────────────────────────────────────────────────────────
    private Bitmap ensureMinSize(Bitmap bmp) {
        int min = 1080;
        int s   = Math.min(bmp.getWidth(), bmp.getHeight());
        if (s >= min) return bmp;
        float sc = (float) min / s;
        return Bitmap.createScaledBitmap(bmp,
            (int)(bmp.getWidth() * sc), (int)(bmp.getHeight() * sc), true);
    }

    private Bitmap enhance(Bitmap src) {
        Bitmap out = Bitmap.createBitmap(src.getWidth(), src.getHeight(),
                                          Bitmap.Config.ARGB_8888);
        Paint p = new Paint(Paint.ANTI_ALIAS_FLAG);
        ColorMatrix cm = new ColorMatrix();
        cm.setSaturation(0f);           // grayscale
        cm.postConcat(new ColorMatrix(new float[]{
            1.8f, 0, 0, 0, -60f,
            0, 1.8f, 0, 0, -60f,
            0, 0, 1.8f, 0, -60f,
            0, 0, 0,   1,   0f
        }));
        p.setColorFilter(new ColorMatrixColorFilter(cm));
        new Canvas(out).drawBitmap(src, 0f, 0f, p);
        return out;
    }
}
