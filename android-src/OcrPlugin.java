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
import java.util.HashSet;
import java.util.List;
import java.util.Set;
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
        int mid = enhanced.getWidth() / 2;
        final Bitmap leftCol  = Bitmap.createBitmap(enhanced, 0,   0, mid,                      enhanced.getHeight());
        final Bitmap rightCol = Bitmap.createBitmap(enhanced, mid, 0, enhanced.getWidth() - mid, enhanced.getHeight());
        final Bitmap[] strips = { leftCol, rightCol };

        // প্রতিটি strip: Latin + Devanagari → best result রাখি
        // total pending = 2 strips × 2 recognizers = 4
        final String[] results = { "", "" };
        final int[]    pending = { 2, 2 };
        final Object   lock    = new Object();

        for (int si = 0; si < strips.length; si++) {
            final int    stripIndex = si;
            final Bitmap strip      = strips[si];
            final InputImage img    = InputImage.fromBitmap(strip, 0);

            // Latin recognizer
            TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS)
                .process(img)
                .addOnSuccessListener(r -> {
                    synchronized (lock) {
                        String grouped = groupByBoundingBox(r);
                        if (grouped.length() > results[stripIndex].length())
                            results[stripIndex] = grouped;
                        pending[stripIndex]--;
                        checkDone(call, results, pending, lock, sized, bmp, enhanced, strips);
                    }
                })
                .addOnFailureListener(e -> {
                    synchronized (lock) {
                        pending[stripIndex]--;
                        checkDone(call, results, pending, lock, sized, bmp, enhanced, strips);
                    }
                });

            // Devanagari (Bengali) recognizer
            TextRecognition.getClient(new DevanagariTextRecognizerOptions.Builder().build())
                .process(img)
                .addOnSuccessListener(r -> {
                    synchronized (lock) {
                        String grouped = groupByBoundingBox(r);
                        if (grouped.length() > results[stripIndex].length())
                            results[stripIndex] = grouped;
                        pending[stripIndex]--;
                        checkDone(call, results, pending, lock, sized, bmp, enhanced, strips);
                    }
                })
                .addOnFailureListener(e -> {
                    synchronized (lock) {
                        pending[stripIndex]--;
                        checkDone(call, results, pending, lock, sized, bmp, enhanced, strips);
                    }
                });
        }
    }

    // ─── checkDone ────────────────────────────────────────────────────────────
    private void checkDone(PluginCall call, String[] results, int[] pending,
                           Object lock, Bitmap sized, Bitmap bmp,
                           Bitmap enhanced, Bitmap[] strips) {
        boolean allDone = true;
        for (int p : pending) if (p > 0) { allDone = false; break; }
        if (!allDone) return;

        if (sized != bmp)     sized.recycle();
        enhanced.recycle();
        for (Bitmap s : strips) if (s != enhanced) s.recycle();

        String finalText = results[0] + "\n\n--- COLUMN ---\n\n" + results[1];
        String parsed    = parseQuestions(finalText);

        JSObject ret = new JSObject();
        ret.put("text",   finalText);
        ret.put("parsed", parsed);
        call.resolve(ret);
    }

    // ─── Bounding-box line grouping ───────────────────────────────────────────
    private String groupByBoundingBox(Text result) {
        List<int[]>  blocks = new ArrayList<>();   // [top, left, height]
        List<String> texts  = new ArrayList<>();

        for (Text.TextBlock block : result.getTextBlocks()) {
            for (Text.Line line : block.getLines()) {
                android.graphics.Rect box = line.getBoundingBox();
                if (box == null) continue;
                blocks.add(new int[]{ box.top, box.left, box.height() });
                texts.add(line.getText());
            }
        }
        if (blocks.isEmpty()) return "";

        int sumH = 0;
        for (int[] b : blocks) sumH += b[2];
        int avgH      = Math.max(sumH / blocks.size(), 20);
        int threshold = (int)(avgH * 0.55);

        List<Integer> indices = new ArrayList<>();
        for (int i = 0; i < blocks.size(); i++) indices.add(i);
        Collections.sort(indices, (a, b2) -> {
            int cmp = Integer.compare(blocks.get(a)[0], blocks.get(b2)[0]);
            return cmp != 0 ? cmp : Integer.compare(blocks.get(a)[1], blocks.get(b2)[1]);
        });

        List<List<Integer>> rows = new ArrayList<>();
        for (int idx : indices) {
            int top = blocks.get(idx)[0];
            if (!rows.isEmpty()) {
                List<Integer> lastRow = rows.get(rows.size() - 1);
                int lastTop = blocks.get(lastRow.get(lastRow.size() - 1))[0];
                if (top - lastTop < threshold) { lastRow.add(idx); continue; }
            }
            List<Integer> newRow = new ArrayList<>();
            newRow.add(idx);
            rows.add(newRow);
        }

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

    // ─── MCQ Parser (v2 — 7 bugs fixed) ──────────────────────────────────────
    //
    // FIX 1 — Noise filter expanded: পৃষ্ঠা, বিসিএস, Facebook/Facehok,
    //          আমাদের, সকল চাকরির, শতভাগ, অগ্রদূত বাংলা, ডাক বিভাগ,
    //          পদের নাম, সময়:, পূর্ণমান, পরীক্ষার — সব skip
    // FIX 2 — Option comma separator: "ক, পদাবলি" এখন ধরে (ক[,.)।] সব)
    // FIX 3 — Trailing bare answer letter: "...নিরপেক্ষ ক" শেষে ক=answer
    // FIX 4 — Single-line multi-option: "ক, x খ. y গ, z ঘ, w উ. গ" → 4 opts
    // FIX 5 — Dirty option cleanup: option text থেকে "উ. ক" strip করা হয়
    // FIX 6 — Question number sort: 2-column merge-এর পর num অনুযায়ী sort
    // FIX 7 — Duplicate dedup: একই number দুবার আসলে প্রথমটা রাখা হয়
    //
    private String parseQuestions(String rawText) {

        // ── Noise patterns ────────────────────────────────────────────────────
        // এই pattern-এর যেকোনো একটা match হলে line skip
        Pattern[] noisePatterns = {
            Pattern.compile("পৃষ্ঠা[:\\s]"),
            Pattern.compile("বিসিএস"),
            Pattern.compile("[Ff]ace[bBhH]"),         // Facebook / Facehok
            Pattern.compile("আমাদের\\s"),
            Pattern.compile("সকল চাকরির"),
            Pattern.compile("শতভাগ কম"),
            Pattern.compile("অগ্রদূত\\s*(বাংলা|Recent|Confirm|onfiru)"),
            Pattern.compile("^---"),                  // --- COLUMN --- / --- ছবি ---
            Pattern.compile("^\\d+\\s*$"),            // lone page number
            Pattern.compile("^(ডাক বিভাগ|পদের নাম|সময়[:\\s]|পূর্ণমান|পরীক্ষার)"),
        };

        // ── Core patterns ─────────────────────────────────────────────────────
        // প্রশ্ন নম্বর: বাংলা digit normalize করে Latin-এ match করি
        Pattern pQuestion = Pattern.compile("^(\\d{1,3})[.।,]\\s*(.+)");

        // FIX 2: option separator = comma, period, paren, বা space
        Pattern pOptBn   = Pattern.compile("^([ক-ঘ])[,.)।]\\s*(.+)");
        Pattern pOptLa   = Pattern.compile("^([a-dA-D])[,.)\\s]\\s*(.+)");

        // উত্তর hint: "উ. ক", "উ, খ", "উ ক", "উঃ গ", "ans: b"
        Pattern pAnswer  = Pattern.compile(
            "(?:উ[।.,:\\s]+|[Aa]ns(?:wer)?[:\\s]+)([কখগঘa-dA-D])");

        // FIX 3: trailing bare answer letter at end of line: "...নিরপেক্ষ ক"
        Pattern pTrailing = Pattern.compile("[,.)\\s]([কখগঘ])\\s*$");

        // FIX 4: detect if a line has multiple Bengali option markers
        // e.g. "ক, x খ. y গ, z ঘ, w উ. গ"
        Pattern pMultiOpt = Pattern.compile("[ক-ঘ][,.)।]");

        // ── Internal class to hold parsed MCQ ────────────────────────────────
        // Java 7 compatible: use array [num, q, o1, o2, o3, o4, ans]
        List<Object[]> questions = new ArrayList<>();
        // current: index 0=num(Integer), 1=question, 2-5=opts, 6=answer
        Object[] cur   = null;
        int      optIdx = 2;   // next opt slot (2,3,4,5)
        boolean  inQ    = false;

        Set<Integer> seenNums = new HashSet<>();

        String normalized = toBnDigitNorm(rawText);
        String[] lines    = normalized.split("\n");

        for (String rawLine : lines) {
            String line = rawLine.trim();
            if (line.isEmpty()) continue;

            // FIX 1: noise filter
            boolean isNoise = false;
            for (Pattern np : noisePatterns) {
                if (np.matcher(line).find()) { isNoise = true; break; }
            }
            if (isNoise) continue;

            // ── New question? ─────────────────────────────────────────────────
            Matcher qm = pQuestion.matcher(line);
            if (qm.find()) {
                int num = Integer.parseInt(qm.group(1));

                // FIX 7: dedup
                if (seenNums.contains(num)) continue;
                seenNums.add(num);

                if (cur != null) questions.add(cur);
                cur    = new Object[]{ num, qm.group(2).trim(), "", "", "", "", "" };
                optIdx = 2;
                inQ    = true;

                // FIX 4: options on same line as question number?
                String qRest = (String) cur[1];
                Matcher mmo = pMultiOpt.matcher(qRest);
                int moCount = 0;
                while (mmo.find()) moCount++;
                if (moCount >= 2) {
                    String[] parsed = splitInlineOpts(qRest, pOptBn, pAnswer, pTrailing);
                    // parsed[0]=cleanQ, [1-4]=opts, [5]=ans
                    cur[1] = parsed[0];
                    if (!parsed[1].isEmpty()) { cur[2]=parsed[1]; optIdx=3; }
                    if (!parsed[2].isEmpty()) { cur[3]=parsed[2]; optIdx=4; }
                    if (!parsed[3].isEmpty()) { cur[4]=parsed[3]; optIdx=5; }
                    if (!parsed[4].isEmpty()) { cur[5]=parsed[4]; optIdx=6; }
                    if (!parsed[5].isEmpty())   cur[6]=parsed[5];
                    inQ = false;
                }
                continue;
            }
            if (cur == null) continue;

            // ── Option line? ──────────────────────────────────────────────────
            // FIX 4: multiple options on one line?
            Matcher mmo = pMultiOpt.matcher(line);
            int moCount = 0;
            while (mmo.find()) moCount++;

            if (moCount >= 2) {
                // FIX 4: split inline opts
                String[] parsed = splitInlineOpts(line, pOptBn, pAnswer, pTrailing);
                // parsed[0] ignored (no question prefix here)
                if (!parsed[1].isEmpty() && optIdx <= 5) { cur[optIdx]=parsed[1]; optIdx++; }
                if (!parsed[2].isEmpty() && optIdx <= 5) { cur[optIdx]=parsed[2]; optIdx++; }
                if (!parsed[3].isEmpty() && optIdx <= 5) { cur[optIdx]=parsed[3]; optIdx++; }
                if (!parsed[4].isEmpty() && optIdx <= 5) { cur[optIdx]=parsed[4]; optIdx++; }
                if (!parsed[5].isEmpty() && ((String)cur[6]).isEmpty()) cur[6]=parsed[5];
                inQ = false;
                continue;
            }

            Matcher om_bn = pOptBn.matcher(line);
            Matcher om_la = pOptLa.matcher(line);
            String optText = null;
            if (om_bn.find()) {
                // FIX 5: strip answer hint from option text
                optText = cleanOptText(om_bn.group(2).trim(), pAnswer, pTrailing);
                inQ = false;
            } else if (om_la.find()) {
                optText = cleanOptText(om_la.group(2).trim(), pAnswer, pTrailing);
                inQ = false;
            }

            if (optText != null && optIdx <= 5) {
                cur[optIdx] = optText;
                optIdx++;
            }

            // ── Answer hint? ──────────────────────────────────────────────────
            Matcher am = pAnswer.matcher(line);
            if (am.find() && ((String)cur[6]).isEmpty()) {
                int ai = letterToIndex(am.group(1)) + 1; // +1 because cur[2]=opt1
                if (ai >= 2 && ai <= 5 && !((String)cur[ai]).isEmpty())
                    cur[6] = cur[ai];
                continue;
            }

            // FIX 3: trailing bare answer letter (no "উ." prefix)
            if (optText == null) {
                Matcher ta = pTrailing.matcher(line);
                if (ta.find() && ((String)cur[6]).isEmpty()) {
                    int ai = letterToIndex(ta.group(1)) + 1;
                    if (ai >= 2 && ai <= 5 && !((String)cur[ai]).isEmpty())
                        cur[6] = cur[ai];
                    continue;
                }
            }

            // multi-line question continuation
            if (inQ && optIdx == 2) {
                cur[1] = cur[1] + " " + line;
            }
        }
        if (cur != null) questions.add(cur);
        if (questions.isEmpty()) return "";

        // FIX 6: sort by question number
        Collections.sort(questions, (a, b2) ->
            Integer.compare((Integer)a[0], (Integer)b2[0]));

        StringBuilder sb = new StringBuilder();
        for (Object[] q : questions) {
            sb.append(esc((String)q[1])).append(';')
              .append(esc((String)q[2])).append(';')
              .append(esc((String)q[3])).append(';')
              .append(esc((String)q[4])).append(';')
              .append(esc((String)q[5])).append(';')
              .append(esc((String)q[6])).append('\n');
        }
        return sb.toString().trim();
    }

    // ─── FIX 4 helper: split "ক, x খ. y গ, z ঘ, w উ. গ" ─────────────────────
    // Returns String[6]: [cleanPrefix, opt1, opt2, opt3, opt4, answer]
    private String[] splitInlineOpts(String line, Pattern pOptBn,
                                     Pattern pAnswer, Pattern pTrailing) {
        String[] result = {"", "", "", "", "", ""};

        // Find all ক/খ/গ/ঘ markers with their positions
        Pattern markerPat = Pattern.compile("[ক-ঘ][,.)।]\\s*");
        Matcher mm = markerPat.matcher(line);

        List<Integer> starts = new ArrayList<>();
        List<Character> letters = new ArrayList<>();
        while (mm.find()) {
            starts.add(mm.start());
            letters.add(line.charAt(mm.start()));
        }
        if (starts.isEmpty()) return result;

        // text before first marker = question remainder / prefix
        result[0] = line.substring(0, starts.get(0)).trim();

        for (int i = 0; i < starts.size(); i++) {
            int textStart = starts.get(i);
            // skip past the marker itself (letter + separator + spaces)
            Matcher skip = Pattern.compile("[ক-ঘ][,.)।]\\s*").matcher(line.substring(textStart));
            int after = textStart;
            if (skip.find()) after = textStart + skip.end();

            int textEnd = (i + 1 < starts.size()) ? starts.get(i + 1) : line.length();
            String optText = line.substring(after, textEnd).trim();

            // FIX 5: strip answer hint from option text
            optText = pAnswer.matcher(optText).replaceAll("").trim();
            optText = pTrailing.matcher(optText).replaceAll("").trim();

            // map ক→slot1, খ→slot2, গ→slot3, ঘ→slot4
            char letter = letters.get(i);
            int slot = letter == 'ক' ? 1 : letter == 'খ' ? 2 :
                       letter == 'গ' ? 3 : letter == 'ঘ' ? 4 : 0;
            if (slot >= 1 && slot <= 4) result[slot] = optText;
        }

        // Extract answer from full line
        Matcher am = pAnswer.matcher(line);
        if (am.find()) {
            int ai = letterToIndex(am.group(1));
            if (ai >= 0 && ai <= 3 && !result[ai + 1].isEmpty())
                result[5] = result[ai + 1];
        } else {
            // FIX 3: trailing bare letter
            Matcher ta = pTrailing.matcher(result[4].isEmpty() ? line : result[4]);
            if (ta.find()) {
                int ai = letterToIndex(ta.group(1));
                if (ai >= 0 && ai <= 3 && !result[ai + 1].isEmpty())
                    result[5] = result[ai + 1];
            }
        }
        return result;
    }

    // FIX 5: strip "উ. ক" / trailing bare letter from option text
    private String cleanOptText(String text, Pattern pAnswer, Pattern pTrailing) {
        String cleaned = pAnswer.matcher(text).replaceAll("").trim();
        cleaned = pTrailing.matcher(cleaned).replaceAll("").trim();
        return cleaned;
    }

    // বাংলা সংখ্যা → Latin digit
    private String toBnDigitNorm(String s) {
        return s
            .replace('০','0').replace('১','1').replace('২','2')
            .replace('৩','3').replace('৪','4').replace('৫','5')
            .replace('৬','6').replace('৭','7').replace('৮','8')
            .replace('৯','9');
    }

    // ক→0, খ→1, গ→2, ঘ→3  (0-based)
    private int letterToIndex(String l) {
        switch (l) {
            case "ক": case "a": case "A": return 0;
            case "খ": case "b": case "B": return 1;
            case "গ": case "c": case "C": return 2;
            case "ঘ": case "d": case "D": return 3;
        }
        return -1;
    }

    private String esc(String s) {
        return s == null ? "" : s.replace(";", "|").trim();
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
        Paint p  = new Paint(Paint.ANTI_ALIAS_FLAG);
        ColorMatrix cm = new ColorMatrix();
        cm.setSaturation(0f);
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
