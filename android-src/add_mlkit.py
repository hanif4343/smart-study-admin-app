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
else:
    print("ℹ️  MLKit deps already present")

# ── 2. AndroidManifest.xml — permissions ──
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

if permissions_to_add:
    perm_block = "\n".join(permissions_to_add) + "\n"
    # Insert after <manifest ...> opening tag
    manifest = re.sub(
        r'(<manifest[^>]*>)',
        r'\1\n' + perm_block,
        manifest,
        count=1
    )
    open(manifest_path, "w").write(manifest)
    print(f"✅ Added {len(permissions_to_add)} permission(s) to AndroidManifest.xml:")
    for p in permissions_to_add:
        print(f"   {p.strip()}")
else:
    print("ℹ️  All permissions already present")

# ── 3. Verify OcrPlugin.kt and MainActivity.kt are in place ──
pkg_dir = "android/app/src/main/java/com/smartstudy/admin"
for f in ["OcrPlugin.kt", "MainActivity.kt"]:
    full = os.path.join(pkg_dir, f)
    if os.path.exists(full):
        print(f"✅ {f} exists at {full}")
    else:
        print(f"❌ MISSING: {full}")

print("\nAll done!")
