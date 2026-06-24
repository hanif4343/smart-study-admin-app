import re, sys, os, shutil, json

# ── 1. build.gradle — MLKit + FCM deps ──
gradle_path = "android/app/build.gradle"
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

# Add FCM dependency if missing
txt3 = open(gradle_path).read()
if "firebase-messaging" not in txt3:
    fcm_dep = (
        '\n    implementation(platform("com.google.firebase:firebase-bom:32.7.0"))'
        '\n    implementation("com.google.firebase:firebase-messaging-ktx")'
    )
    txt3 = re.sub(r'(dependencies\s*\{)', r'\1' + fcm_dep, txt3, count=1)
    open(gradle_path, "w").write(txt3)
    print("✅ Firebase Messaging dep added")

# ── 2. AndroidManifest.xml — permissions + services ──
manifest_path = "android/app/src/main/AndroidManifest.xml"
manifest = open(manifest_path).read()

permissions_to_add = []
perm_map = {
    "READ_MEDIA_IMAGES":         '    <uses-permission android:name="android.permission.READ_MEDIA_IMAGES" />',
    "READ_EXTERNAL_STORAGE":     '    <uses-permission android:name="android.permission.READ_EXTERNAL_STORAGE" android:maxSdkVersion="32" />',
    "CAMERA":                    '    <uses-permission android:name="android.permission.CAMERA" />',
    "WRITE_EXTERNAL_STORAGE":    '    <uses-permission android:name="android.permission.WRITE_EXTERNAL_STORAGE" android:maxSdkVersion="28" />',
    "READ_MEDIA_VIDEO":          '    <uses-permission android:name="android.permission.READ_MEDIA_VIDEO" />',
    "FOREGROUND_SERVICE\"":      '    <uses-permission android:name="android.permission.FOREGROUND_SERVICE" />',
    "FOREGROUND_SERVICE_DATA":   '    <uses-permission android:name="android.permission.FOREGROUND_SERVICE_DATA_SYNC" />',
    "WAKE_LOCK":                 '    <uses-permission android:name="android.permission.WAKE_LOCK" />',
    "RECEIVE_BOOT_COMPLETED":    '    <uses-permission android:name="android.permission.RECEIVE_BOOT_COMPLETED" />',
}
for key, decl in perm_map.items():
    if key not in manifest:
        permissions_to_add.append(decl)

if permissions_to_add:
    perm_block = "\n".join(permissions_to_add) + "\n"
    manifest = re.sub(r'(<manifest[^>]*>)', r'\1\n' + perm_block, manifest, count=1)
    print(f"✅ Added {len(permissions_to_add)} permission(s)")

# Services to inject
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

# ── 3. Copy Kotlin source files ──
pkg_dir = "android/app/src/main/java/com/smartstudy/admin"
os.makedirs(pkg_dir, exist_ok=True)

files_to_copy = [
    "OcrPlugin.kt",
    "MainActivity.kt",
    "BackgroundSyncService.kt",
    "BgSyncPlugin.kt",
    "FcmTokenPlugin.kt",
    "AdminMessagingService.kt",
    "AdminPushPlugin.kt",
]

for f in files_to_copy:
    src = os.path.join("android-src", f)
    dst = os.path.join(pkg_dir, f)
    if os.path.exists(src):
        shutil.copy2(src, dst)
        print(f"✅ {f} copied")
    else:
        print(f"❌ MISSING: {src}")

print("\nAll done!")

# ── 4. capacitor.plugins.json — custom plugin registration ──────────────────
# Capacitor-এর JS bridge শুধু capacitor.plugins.json-এ listed plugin-ই
# window.Capacitor.Plugins.* এ expose করে।
# Local native plugin (npm package নয়) manually এখানে add করতে হয়।
plugins_json_path = "android/app/src/main/assets/capacitor.plugins.json"

custom_plugins = [
    {
        "pkg":         "com.smartstudy.admin",
        "classpath":   "com.smartstudy.admin.OcrPlugin"
    },
    {
        "pkg":         "com.smartstudy.admin",
        "classpath":   "com.smartstudy.admin.BgSyncPlugin"
    },
    {
        "pkg":         "com.smartstudy.admin",
        "classpath":   "com.smartstudy.admin.FcmTokenPlugin"
    },
    {
        "pkg":         "com.smartstudy.admin",
        "classpath":   "com.smartstudy.admin.AdminPushPlugin"
    },
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

# আগে যা ছিল তাতে আমাদের plugin add করি (duplicate skip)
existing_classpaths = {p.get("classpath","") for p in existing}
added = 0
for cp in custom_plugins:
    if cp["classpath"] not in existing_classpaths:
        existing.append(cp)
        added += 1

open(plugins_json_path, "w").write(json.dumps(existing, indent=2))
print(f"✅ capacitor.plugins.json updated — {added} custom plugin(s) added ({plugins_json_path})")

# ── 5. Ensure Camera plugin Gradle project is included ───────────────────────
# cap sync normally adds capacitor-camera to settings.gradle and app/build.gradle
# But if it didn't, we force-add it here.
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

# Ensure app/build.gradle has capacitor-camera implementation
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

# ── 6. Remove Capacitor's auto-generated MainActivity.java ───────────────────
# cap sync generates a default MainActivity.java which takes priority over
# our MainActivity.kt during compilation, causing registerPlugin() to never run.
main_java = "android/app/src/main/java/com/smartstudy/admin/MainActivity.java"
if os.path.exists(main_java):
    os.remove(main_java)
    print("✅ Removed auto-generated MainActivity.java (our .kt will be used)")
else:
    print("ℹ️  MainActivity.java not found (already clean)")
