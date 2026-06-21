import re, sys, os

# ── 1. build.gradle — MLKit deps ──
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

# Add google-services plugin if missing
app_gradle = open(gradle_path).read()
if "google-services" not in app_gradle:
    app_gradle = app_gradle.replace(
        "plugins {",
        "plugins {\n    id("com.google.gms.google-services")",
        1
    )
    open(gradle_path, "w").write(app_gradle)
    print("✅ google-services plugin added to app/build.gradle")

# Add FCM dependency
if "firebase-messaging" not in app_gradle:
    with open(gradle_path, "r") as f: g = f.read()
    fcm_dep = '\n    implementation(platform("com.google.firebase:firebase-bom:32.7.0"))\n    implementation("com.google.firebase:firebase-messaging-ktx")'
    g = re.sub(r"(dependencies\s*\{)", r"\1" + fcm_dep, g, count=1)
    open(gradle_path, "w").write(g)
    print("✅ Firebase Messaging dep added")
else:
    print("ℹ️  MLKit deps already present")

# ── 2. AndroidManifest.xml — permissions + service ──
manifest_path = "android/app/src/main/AndroidManifest.xml"
manifest = open(manifest_path).read()

permissions_to_add = []

if "READ_MEDIA_IMAGES" not in manifest:
    permissions_to_add.append('    <uses-permission android:name="android.permission.READ_MEDIA_IMAGES" />')
if "READ_EXTERNAL_STORAGE" not in manifest:
    permissions_to_add.append('    <uses-permission android:name="android.permission.READ_EXTERNAL_STORAGE" android:maxSdkVersion="32" />')
if "CAMERA" not in manifest:
    permissions_to_add.append('    <uses-permission android:name="android.permission.CAMERA" />')
if "WRITE_EXTERNAL_STORAGE" not in manifest:
    permissions_to_add.append('    <uses-permission android:name="android.permission.WRITE_EXTERNAL_STORAGE" android:maxSdkVersion="28" />')
if "READ_MEDIA_VIDEO" not in manifest:
    permissions_to_add.append('    <uses-permission android:name="android.permission.READ_MEDIA_VIDEO" />')
# ── Background sync permissions ──
if "FOREGROUND_SERVICE" not in manifest:
    permissions_to_add.append('    <uses-permission android:name="android.permission.FOREGROUND_SERVICE" />')
if "FOREGROUND_SERVICE_DATA_SYNC" not in manifest:
    permissions_to_add.append('    <uses-permission android:name="android.permission.FOREGROUND_SERVICE_DATA_SYNC" />')
if "WAKE_LOCK" not in manifest:
    permissions_to_add.append('    <uses-permission android:name="android.permission.WAKE_LOCK" />')
if "RECEIVE_BOOT_COMPLETED" not in manifest:
    permissions_to_add.append('    <uses-permission android:name="android.permission.RECEIVE_BOOT_COMPLETED" />')

if permissions_to_add:
    perm_block = "\n".join(permissions_to_add) + "\n"
    manifest = re.sub(
        r'(<manifest[^>]*>)',
        r'\1\n' + perm_block,
        manifest,
        count=1
    )
    print(f"✅ Added {len(permissions_to_add)} permission(s) to AndroidManifest.xml")

# ── Add BackgroundSyncService to manifest ──
service_decl = '''
        <service
            android:name=".BackgroundSyncService"
            android:exported="false"
            android:foregroundServiceType="dataSync" />'''

if "BackgroundSyncService" not in manifest:
    # Insert before </application>
    manifest = manifest.replace("</application>", service_decl + "\n    </application>", 1)
    print("✅ BackgroundSyncService added to AndroidManifest.xml")
else:
    print("ℹ️  BackgroundSyncService already in manifest")

open(manifest_path, "w").write(manifest)

# ── 3. Copy Kotlin source files ──
pkg_dir = "android/app/src/main/java/com/smartstudy/admin"
os.makedirs(pkg_dir, exist_ok=True)

src_dir = "android-src"
files_to_copy = ["OcrPlugin.kt", "MainActivity.kt", "BackgroundSyncService.kt", "BgSyncPlugin.kt", "FcmTokenPlugin.kt", "AdminMessagingService.kt"]

for f in files_to_copy:
    src = os.path.join(src_dir, f)
    dst = os.path.join(pkg_dir, f)
    if os.path.exists(src):
        import shutil
        shutil.copy2(src, dst)
        print(f"✅ {f} copied to {dst}")
    else:
        print(f"❌ MISSING source: {src}")

print("\nAll done!")
