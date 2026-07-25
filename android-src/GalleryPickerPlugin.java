package com.smartstudy.admin;

import android.app.Activity;
import android.content.ContentResolver;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.net.Uri;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.UUID;

/**
 * ── কেন এই plugin দরকার হলো ──────────────────────────────────────────────
 * @capacitor/camera-এর pickImages() Android-এ Intent.ACTION_PICK ব্যবহার করে,
 * যেখানে EXTRA_ALLOW_MULTIPLE অফিসিয়ালি সাপোর্টেড না — ফলে Oppo/Realme/Xiaomi
 * সহ অনেক ডিভাইসে multi-select কাজ করে না, ইউজারকে একটার পর একটা ছবি বেছে
 * gallery বারবার খুলতে হয়।
 *
 * ── Photo Picker vs Document Picker ──────────────────────────────────────
 * প্রথমে এখানে Intent.ACTION_OPEN_DOCUMENT (System Files/document browser)
 * ব্যবহার করা হয়েছিল, যা multi-select ভালো সাপোর্ট করে ঠিকই, কিন্তু এটা
 * "ডকুমেন্ট প্রোভাইডার" (Recent, Images ফোল্ডার, Downloads, Drive...) দেখায় —
 * আসল Photos/Gallery অ্যাপের মতো album-ভিত্তিক UI দেখায় না, ফলে অনেক ছবি
 * (যেমন নির্দিষ্ট album বা cloud-backed ছবি) খুঁজে পাওয়া কঠিন হয়ে যায়।
 *
 * তাই এখন আগে Android-এর সিস্টেম Photo Picker (action:
 * "android.provider.action.PICK_IMAGES", Android 11+ এ Google Play system
 * update দিয়ে backport করা, Android 13+ এ built-in) ব্যবহার করার চেষ্টা করা
 * হয় — এটা ঠিক Gallery/Photos অ্যাপের মতোই album/thumbnail গ্রিড দেখায়,
 * multi-select নিজে থেকেই সাপোর্ট করে, এবং কোনো storage permission ছাড়াই
 * কাজ করে। এই picker না থাকলে (খুব পুরনো ডিভাইস/OS) আগের
 * ACTION_OPEN_DOCUMENT fallback হিসেবে থেকে যায়।
 *
 * ── ক্র্যাশ ফিক্স (২০২৬) ──────────────────────────────────────────────────
 * আগে প্রতিটা ছবি ডিকোড+ডাউনস্কেল করে সরাসরি base64 স্ট্রিং হিসেবে JS
 * bridge-এর একটাই call.resolve()-এ ফেরত পাঠানো হতো। বাল্ক সিলেক্টে (একসাথে
 * অনেকগুলো ছবি — এই অ্যাপের Multi-Subject Import পেজের মূল ব্যবহার) সব
 * ছবির base64 একসাথে জোড়া দিলে কয়েক দশ MB-র বিশাল JSON payload তৈরি হতো,
 * যেটা bridge দিয়ে JS-এ ফেরত পাঠানোর মুহূর্তেই (ঠিক gallery থেকে অ্যাপে
 * ফিরে আসার সময়) native-side মেমরি ফুরিয়ে অ্যাপ ক্র্যাশ/ANR করিয়ে দিত।
 * এখন প্রতিটা ডাউনস্কেল করা ছবি bridge দিয়ে base64 হিসেবে না পাঠিয়ে অ্যাপের
 * নিজস্ব cache ফোল্ডারে JPEG ফাইল হিসেবে লিখে ফেলা হয়, আর bridge দিয়ে শুধু
 * ছোট্ট ফাইল-পাথ স্ট্রিং ফেরত যায় (ঠিক @capacitor/camera-এর pickImages()
 * যেভাবে webPath রিটার্ন করে, সেভাবেই) — JS সাইডে
 * window.Capacitor.convertFileSrc(path) দিয়ে সেটা <img src>-এ ব্যবহারযোগ্য
 * URL-এ বদলানো হয়।
 */
@CapacitorPlugin(name = "GalleryPicker")
public class GalleryPickerPlugin extends Plugin {

    private static final int MAX_DIM = 2000; // px — বড় ছবি হলে ডাউনস্কেল করি (মেমরি/স্পিড বাঁচাতে)
    private static final String ACTION_PICK_IMAGES = "android.provider.action.PICK_IMAGES";
    private static final String EXTRA_PICK_IMAGES_MAX = "android.provider.extra.PICK_IMAGES_MAX";
    private static final int PICK_IMAGES_MAX = 100; // সিস্টেম picker-এর সাধারণ সর্বোচ্চ সীমা

    private boolean isSystemPhotoPickerAvailable() {
        try {
            Intent probe = new Intent(ACTION_PICK_IMAGES);
            PackageManager pm = getContext().getPackageManager();
            return probe.resolveActivity(pm) != null;
        } catch (Exception e) {
            return false;
        }
    }

    @PluginMethod
    public void pickImages(PluginCall call) {
        Intent intent;
        if (isSystemPhotoPickerAvailable()) {
            // ── Photo Picker — Gallery/Photos অ্যাপের মতো album/grid UI ──
            intent = new Intent(ACTION_PICK_IMAGES);
            intent.setType("image/*");
            intent.putExtra(EXTRA_PICK_IMAGES_MAX, PICK_IMAGES_MAX);
        } else {
            // ── Fallback — খুব পুরনো ডিভাইস/OS, Photo Picker নেই ──
            intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
            intent.setType("image/*");
            intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
            intent.addCategory(Intent.CATEGORY_OPENABLE);
        }
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
            String path = readAndCacheFile(cr, uri);
            if (path == null) continue; // একটা ছবি corrupt হলেও বাকিগুলো চালিয়ে যাই
            JSObject photo = new JSObject();
            photo.put("path", path);
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

    /** ছবি ডিকোড+ডাউনস্কেল করে অ্যাপের cache ফোল্ডারে JPEG ফাইল হিসেবে লিখে ফেলে, ফাইলের
     *  absolute path রিটার্ন করে — bridge দিয়ে বিশাল base64 payload পাঠানো হয় না। */
    private String readAndCacheFile(ContentResolver cr, Uri uri) {
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

            File dir = new File(getContext().getCacheDir(), "gallery_picks");
            if (!dir.exists()) dir.mkdirs();
            File outFile = new File(dir, "pick_" + UUID.randomUUID().toString() + ".jpg");
            try (FileOutputStream fos = new FileOutputStream(outFile)) {
                bmp.compress(Bitmap.CompressFormat.JPEG, 90, fos);
            }
            bmp.recycle();
            return outFile.getAbsolutePath();
        } catch (Exception e) {
            return null;
        }
    }
}
