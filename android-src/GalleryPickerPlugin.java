package com.smartstudy.admin;

import android.app.Activity;
import android.content.ContentResolver;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.net.Uri;
import android.util.Base64;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.util.ArrayList;

/**
 * ── কেন এই plugin দরকার হলো ──────────────────────────────────────────────
 * @capacitor/camera-এর pickImages() Android-এ Intent.ACTION_PICK ব্যবহার করে,
 * যেখানে EXTRA_ALLOW_MULTIPLE অফিসিয়ালি সাপোর্টেড না — ফলে Oppo/Realme/Xiaomi
 * সহ অনেক ডিভাইসে multi-select কাজ করে না, ইউজারকে একটার পর একটা ছবি বেছে
 * gallery বারবার খুলতে হয়।
 *
 * এই plugin এর বদলে Intent.ACTION_OPEN_DOCUMENT ব্যবহার করে (System Files/Photo
 * picker) — এটা EXTRA_ALLOW_MULTIPLE সব stock ও বেশিরভাগ OEM picker-এ ঠিকভাবে
 * সাপোর্ট করে, তাই একবারেই একাধিক ছবি বাছা যায়।
 *
 * ফলাফল সরাসরি base64 আকারে ফেরত দেয় (webPath/content:// URI না — কারণ
 * content:// scheme সব সময় WebView-তে <img src> হিসেবে লোড হয় না)।
 */
@CapacitorPlugin(name = "GalleryPicker")
public class GalleryPickerPlugin extends Plugin {

    private static final int MAX_DIM = 2000; // px — বড় ছবি হলে ডাউনস্কেল করি (মেমরি/স্পিড বাঁচাতে)

    @PluginMethod
    public void pickImages(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.setType("image/*");
        intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        try {
            startActivityForResult(call, intent, "pickImagesResult");
        } catch (Exception e) {
            call.reject("gallery open failed: " + e.getMessage());
        }
    }

    @ActivityCallback
    private void pickImagesResult(PluginCall call, ActivityResult result) {
        if (call == null) return;

        if (result.getResultCode() != Activity.RESULT_OK) {
            call.reject("cancelled");
            return;
        }
        Intent data = result.getData();
        if (data == null) {
            call.reject("no data returned");
            return;
        }

        ArrayList<Uri> uris = new ArrayList<>();
        if (data.getClipData() != null) {
            int count = data.getClipData().getItemCount();
            for (int i = 0; i < count; i++) {
                uris.add(data.getClipData().getItemAt(i).getUri());
            }
        } else if (data.getData() != null) {
            uris.add(data.getData());
        }

        if (uris.isEmpty()) {
            call.reject("no image selected");
            return;
        }

        ContentResolver cr = getContext().getContentResolver();
        JSArray photos = new JSArray();

        for (Uri uri : uris) {
            String b64 = readAsBase64(cr, uri);
            if (b64 == null) continue; // একটা ছবি corrupt হলেও বাকিগুলো চালিয়ে যাই
            JSObject photo = new JSObject();
            photo.put("base64String", b64);
            photos.put(photo);
        }

        if (photos.length() == 0) {
            call.reject("could not read any selected image");
            return;
        }

        JSObject ret = new JSObject();
        ret.put("photos", photos);
        call.resolve(ret);
    }

    private String readAsBase64(ContentResolver cr, Uri uri) {
        try {
            // ── ধাপ ১: শুধু dimensions জানার জন্য প্রথমে decode (মেমরি সাশ্রয়ী) ──
            BitmapFactory.Options bounds = new BitmapFactory.Options();
            bounds.inJustDecodeBounds = true;
            try (InputStream is1 = cr.openInputStream(uri)) {
                BitmapFactory.decodeStream(is1, null, bounds);
            }

            int sample = 1;
            int w = bounds.outWidth, h = bounds.outHeight;
            while ((w / sample) > MAX_DIM || (h / sample) > MAX_DIM) sample *= 2;

            BitmapFactory.Options opts = new BitmapFactory.Options();
            opts.inSampleSize = sample;

            Bitmap bmp;
            try (InputStream is2 = cr.openInputStream(uri)) {
                bmp = BitmapFactory.decodeStream(is2, null, opts);
            }
            if (bmp == null) return null;

            ByteArrayOutputStream baos = new ByteArrayOutputStream();
            bmp.compress(Bitmap.CompressFormat.JPEG, 90, baos);
            bmp.recycle();
            return Base64.encodeToString(baos.toByteArray(), Base64.NO_WRAP);
        } catch (Exception e) {
            return null;
        }
    }
}
