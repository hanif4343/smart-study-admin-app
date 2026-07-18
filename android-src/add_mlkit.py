import re, sys, os, shutil, json

# ── 0. Kotlin plugin থেকে সরানো — এখন সব .java ──────────────────────────────
# Capacitor 5 default project Java-only।
# আমাদের সব plugin .java-তে rewrite করা হয়েছে।
# তাই Kotlin plugin আর দরকার নেই।
gradle_path = "android/app/build.gradle"
txt0 = open(gradle_path).read()
if "kotlin-android" in txt0 or "org.jetbrains.kotlin.android" in txt0:
    print("ℹ️  Kotlin plugin detected in build.gradle — removing (we use pure Java now)")
    txt0 = re.sub(r'\n?\s*id\s*["\']org\.jetbrains\.kotlin\.android["\'][^\n]*\n?', '\n', txt0)
    txt0 = re.sub(r'\n?\s*id\s*["\']kotlin-android["\'][^\n]*\n?', '\n', txt0)
    txt0 = re.sub(r'\n?\s*implementation\s*["\']org\.jetbrains\.kotlin:kotlin-stdlib[^"\']*["\'][^\n]*\n?', '\n', txt0)
    open(gradle_path, "w").write(txt0)
    print("✅ Kotlin references removed from app/build.gradle")
else:
    print("ℹ️  No Kotlin plugin in build.gradle (clean)")

# ── 1. build.gradle — MLKit + FCM deps ───────────────────────────────────────
txt = open(gradle_path).read()

mlkit_deps = (
    '\n    implementation("com.google.mlkit:text-recognition:16.0.0")'
    '\n    implementation("com.google.mlkit:text-recognition-devanagari:16.0.0")\n'
)

if "mlkit" not in txt and "text-recognition" not in txt:
    txt = re.sub(r'(dependencies\s*\{)', r'\1' + mlkit_deps, txt, count=1)
    open(gradle_path, "w").write(txt)
    print("✅ MLKit deps added to build.gradle")
else:
    print("ℹ️  MLKit deps already present")

# Add google-services plugin if missing
txt2 = open(gradle_path).read()
if "google-services" not in txt2:
    gms_line = 'id("com.google.gms.google-services")'
    txt2 = txt2.replace("plugins {", "plugins {\n    " + gms_line, 1)
    open(gradle_path, "w").write(txt2)
    print("✅ google-services plugin added to app/build.gradle")
else:
    print("ℹ️  google-services already present")

# Add FCM dependency if missing
txt3 = open(gradle_path).read()
if "firebase-messaging" not in txt3:
    fcm_dep = (
        '\n    implementation(platform("com.google.firebase:firebase-bom:32.7.0"))'
        '\n    implementation("com.google.firebase:firebase-messaging")'
    )
    txt3 = re.sub(r'(dependencies\s*\{)', r'\1' + fcm_dep, txt3, count=1)
    open(gradle_path, "w").write(txt3)
    print("✅ Firebase Messaging dep added")
else:
    print("ℹ️  Firebase Messaging already present")

# ── 2. AndroidManifest.xml — permissions + services ──────────────────────────
manifest_path = "android/app/src/main/AndroidManifest.xml"
manifest = open(manifest_path).read()

perm_map = {
    "READ_MEDIA_IMAGES":       '    <uses-permission android:name="android.permission.READ_MEDIA_IMAGES" />',
    "READ_EXTERNAL_STORAGE":   '    <uses-permission android:name="android.permission.READ_EXTERNAL_STORAGE" android:maxSdkVersion="32" />',
    "CAMERA":                  '    <uses-permission android:name="android.permission.CAMERA" />',
    "WRITE_EXTERNAL_STORAGE":  '    <uses-permission android:name="android.permission.WRITE_EXTERNAL_STORAGE" android:maxSdkVersion="28" />',
    "READ_MEDIA_VIDEO":        '    <uses-permission android:name="android.permission.READ_MEDIA_VIDEO" />',
    'FOREGROUND_SERVICE"':     '    <uses-permission android:name="android.permission.FOREGROUND_SERVICE" />',
    "FOREGROUND_SERVICE_DATA": '    <uses-permission android:name="android.permission.FOREGROUND_SERVICE_DATA_SYNC" />',
    "WAKE_LOCK":               '    <uses-permission android:name="android.permission.WAKE_LOCK" />',
    "RECEIVE_BOOT_COMPLETED":  '    <uses-permission android:name="android.permission.RECEIVE_BOOT_COMPLETED" />',
}
permissions_to_add = []
for key, decl in perm_map.items():
    if key not in manifest:
        permissions_to_add.append(decl)

if permissions_to_add:
    perm_block = "\n".join(permissions_to_add) + "\n"
    manifest = re.sub(r'(<manifest[^>]*>)', r'\1\n' + perm_block, manifest, count=1)
    print(f"✅ Added {len(permissions_to_add)} permission(s)")
else:
    print("ℹ️  All permissions already present")

services = {
    "BackgroundSyncService": (
        '\n        <service'
        '\n            android:name=".BackgroundSyncService"'
        '\n            android:exported="false"'
        '\n            android:foregroundServiceType="dataSync" />'
    ),
    "AdminMessagingService": (
        '\n        <service'
        '\n            android:name=".AdminMessagingService"'
        '\n            android:exported="false">'
        '\n            <intent-filter>'
        '\n                <action android:name="com.google.firebase.MESSAGING_EVENT" />'
        '\n            </intent-filter>'
        '\n        </service>'
    ),
}

for svc_name, decl in services.items():
    if svc_name not in manifest:
        manifest = manifest.replace("</application>", decl + "\n    </application>", 1)
        print(f"✅ {svc_name} added to AndroidManifest.xml")
    else:
        print(f"ℹ️  {svc_name} already in manifest")

open(manifest_path, "w").write(manifest)

# ── 2.5 App Icon — android-src/app-icon/* → android/app/src/main/res/* ──────
# custom launcher icon (legacy ic_launcher + adaptive ic_launcher foreground/background)
# Capacitor default icon-গুলো overwrite করে দেয়।
icon_src_root = "android-src/app-icon"
res_root = "android/app/src/main/res"
if os.path.isdir(icon_src_root):
    icon_files_copied = 0
    for dirpath, _, filenames in os.walk(icon_src_root):
        rel = os.path.relpath(dirpath, icon_src_root)
        dst_dir = os.path.join(res_root, rel) if rel != "." else res_root
        if os.path.basename(dirpath) == "play-store":
            continue  # Play Store listing icon — res/ এ যাওয়ার দরকার নেই
        os.makedirs(dst_dir, exist_ok=True)
        for fn in filenames:
            shutil.copy2(os.path.join(dirpath, fn), os.path.join(dst_dir, fn))
            icon_files_copied += 1
    print(f"✅ App icon: {icon_files_copied} file(s) copied into {res_root}")
else:
    print(f"⚠️  App icon source not found at {icon_src_root} — default Capacitor icon থেকে যাবে")

# ── 3. Copy Java source files (Kotlin .kt ফাইল SKIP করি) ────────────────────
pkg_dir = "android/app/src/main/java/com/smartstudy/admin"
os.makedirs(pkg_dir, exist_ok=True)

# সব plugin এখন .java — Kotlin নেই
files_to_copy = [
    "OcrPlugin.java",
    "BgSyncPlugin.java",
    "FcmTokenPlugin.java",
    "AdminPushPlugin.java",
    "AdminMessagingService.java",
    "BackgroundSyncService.java",
    "MainActivity.java",
    "GalleryPickerPlugin.java",
]

for f in files_to_copy:
    src = os.path.join("android-src", f)
    dst = os.path.join(pkg_dir, f)
    if os.path.exists(src):
        shutil.copy2(src, dst)
        print(f"✅ {f} copied → {dst}")
    else:
        print(f"❌ MISSING: {src}")

# ── 4. Remove all .kt files from pkg_dir (compile conflict এড়াতে) ────────────
kt_removed = 0
for fname in os.listdir(pkg_dir):
    if fname.endswith(".kt"):
        kt_path = os.path.join(pkg_dir, fname)
        os.remove(kt_path)
        print(f"✅ Removed stale .kt: {fname}")
        kt_removed += 1
if kt_removed == 0:
    print("ℹ️  No .kt files to remove")

# ── 5. capacitor.plugins.json — custom plugin registration ───────────────────
plugins_json_path = "android/app/src/main/assets/capacitor.plugins.json"

custom_plugins = [
    { "pkg": "com.smartstudy.admin", "classpath": "com.smartstudy.admin.OcrPlugin"      },
    { "pkg": "com.smartstudy.admin", "classpath": "com.smartstudy.admin.BgSyncPlugin"   },
    { "pkg": "com.smartstudy.admin", "classpath": "com.smartstudy.admin.FcmTokenPlugin" },
    { "pkg": "com.smartstudy.admin", "classpath": "com.smartstudy.admin.AdminPushPlugin"},
    { "pkg": "com.smartstudy.admin", "classpath": "com.smartstudy.admin.GalleryPickerPlugin"},
]

if os.path.exists(plugins_json_path):
    try:
        existing = json.loads(open(plugins_json_path).read())
        if not isinstance(existing, list):
            existing = []
    except Exception:
        existing = []
else:
    existing = []
    os.makedirs(os.path.dirname(plugins_json_path), exist_ok=True)

existing_classpaths = {p.get("classpath", "") for p in existing}
added = 0
for cp in custom_plugins:
    if cp["classpath"] not in existing_classpaths:
        existing.append(cp)
        added += 1

open(plugins_json_path, "w").write(json.dumps(existing, indent=2))
print(f"✅ capacitor.plugins.json updated — {added} custom plugin(s) added")

# ── 6. capacitor-camera — settings.gradle + app/build.gradle ─────────────────
settings_path = "android/settings.gradle"
if os.path.exists(settings_path):
    settings = open(settings_path).read()
    camera_include = "include ':capacitor-camera'"
    camera_proj    = "project(':capacitor-camera').projectDir = new File('../node_modules/@capacitor/camera/android')"
    changed = False
    if camera_include not in settings:
        settings += f"\n{camera_include}\n{camera_proj}\n"
        changed = True
    if changed:
        open(settings_path, "w").write(settings)
        print("✅ capacitor-camera added to settings.gradle")
    else:
        print("ℹ️  capacitor-camera already in settings.gradle")

gradle_app = "android/app/build.gradle"
if os.path.exists(gradle_app):
    g = open(gradle_app).read()
    cam_dep = 'implementation project(":capacitor-camera")'
    if cam_dep not in g:
        g = re.sub(r'(dependencies\s*\{)', r'\1\n    ' + cam_dep, g, count=1)
        open(gradle_app, "w").write(g)
        print("✅ capacitor-camera implementation added to app/build.gradle")
    else:
        print("ℹ️  capacitor-camera already in app/build.gradle")

print("\n✅ All done! এখন Android Studio তে Sync & Build করুন।")
print("   বা: cd android && ./gradlew assembleDebug")
