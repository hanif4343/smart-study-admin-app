import re, sys, os

print("=" * 60)
print("MLKit + Permissions Injector (Capacitor 5)")
print("=" * 60)

# ── 1. build.gradle — MLKit deps ──
gradle_path = "android/app/build.gradle"
txt = open(gradle_path).read()

mlkit_deps = (
    '\n    implementation("com.google.mlkit:text-recognition:16.0.0")'
    '\n    implementation("com.google.mlkit:text-recognition-devanagari:16.0.0")\n'
)

if "text-recognition" not in txt:
    txt = re.sub(r'(dependencies\s*\{)', r'\1' + mlkit_deps, txt, count=1)
    open(gradle_path, "w").write(txt)
    print("✅ MLKit deps added to build.gradle")
else:
    print("ℹ️  MLKit deps already present in build.gradle")

# ── 2. AndroidManifest.xml — permissions ──
manifest_path = "android/app/src/main/AndroidManifest.xml"
manifest = open(manifest_path).read()

perms = [
    ('READ_MEDIA_IMAGES',
     '    <uses-permission android:name="android.permission.READ_MEDIA_IMAGES" />'),
    ('READ_EXTERNAL_STORAGE',
     '    <uses-permission android:name="android.permission.READ_EXTERNAL_STORAGE" android:maxSdkVersion="32" />'),
    ('CAMERA',
     '    <uses-permission android:name="android.permission.CAMERA" />'),
    ('WRITE_EXTERNAL_STORAGE',
     '    <uses-permission android:name="android.permission.WRITE_EXTERNAL_STORAGE" android:maxSdkVersion="28" />'),
]

added = []
for key, line in perms:
    if key not in manifest:
        added.append(line)

if added:
    block = "\n".join(added) + "\n"
    manifest = re.sub(r'(<manifest[^>]*>)', r'\1\n' + block, manifest, count=1)
    open(manifest_path, "w").write(manifest)
    print(f"✅ Added {len(added)} permission(s) to AndroidManifest.xml")
else:
    print("ℹ️  All permissions already present")

# ── 3. OcrPlugin.kt — just copy ──
pkg_dir = "android/app/src/main/java/com/smartstudy/admin"
os.makedirs(pkg_dir, exist_ok=True)

# Copy OcrPlugin.kt
src_ocr = "android-src/OcrPlugin.kt"
dst_ocr = os.path.join(pkg_dir, "OcrPlugin.kt")
import shutil
shutil.copy2(src_ocr, dst_ocr)
print(f"✅ OcrPlugin.kt copied → {dst_ocr}")

# ── 4. MainActivity.kt — smart patch ──
# Capacitor 5 generates its own MainActivity.kt.
# Strategy: always overwrite with our version (has registerPlugin)
# Then verify it compiled correctly.
src_main = "android-src/MainActivity.kt"
dst_main = os.path.join(pkg_dir, "MainActivity.kt")

our_content = open(src_main).read()

# Always write our version
open(dst_main, "w").write(our_content)
print(f"✅ MainActivity.kt written → {dst_main}")

# ── 5. Verify ──
print("\n--- Verification ---")
main_check = open(dst_main).read()
if "registerPlugin(OcrPlugin::class.java)" in main_check:
    print("✅ registerPlugin(OcrPlugin::class.java) FOUND in MainActivity.kt")
else:
    print("❌ CRITICAL: registerPlugin NOT found in MainActivity.kt!")
    print(f"Content: {main_check}")
    sys.exit(1)

ocr_check = open(dst_ocr).read()
if "@CapacitorPlugin" in ocr_check and "recognizeText" in ocr_check:
    print("✅ OcrPlugin.kt looks valid (@CapacitorPlugin + recognizeText found)")
else:
    print("❌ CRITICAL: OcrPlugin.kt seems invalid!")
    sys.exit(1)

# Show final file listing
print("\n--- Package directory contents ---")
for f in sorted(os.listdir(pkg_dir)):
    size = os.path.getsize(os.path.join(pkg_dir, f))
    print(f"  {f}  ({size} bytes)")

print("\n✅ All done — OcrPlugin should work in this build!")
