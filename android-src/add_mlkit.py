import re, sys, os

print("=" * 50)
print("MLKit + Permissions Injector")
print("=" * 50)

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
    print("ℹ️  MLKit deps already present")

# ── 2. AndroidManifest.xml — permissions ──
manifest_path = "android/app/src/main/AndroidManifest.xml"
manifest = open(manifest_path).read()

perms = [
    ('READ_MEDIA_IMAGES',    '    <uses-permission android:name="android.permission.READ_MEDIA_IMAGES" />'),
    ('READ_EXTERNAL_STORAGE','    <uses-permission android:name="android.permission.READ_EXTERNAL_STORAGE" android:maxSdkVersion="32" />'),
    ('CAMERA',               '    <uses-permission android:name="android.permission.CAMERA" />'),
    ('WRITE_EXTERNAL_STORAGE','   <uses-permission android:name="android.permission.WRITE_EXTERNAL_STORAGE" android:maxSdkVersion="28" />'),
    ('READ_MEDIA_VIDEO',     '    <uses-permission android:name="android.permission.READ_MEDIA_VIDEO" />'),
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
    for p in added:
        print(f"   {p.strip()}")
else:
    print("ℹ️  All permissions already present")

# ── 3. Verify our Kotlin files are in place ──
pkg_dir = "android/app/src/main/java/com/smartstudy/admin"
all_ok = True
for fname in ["OcrPlugin.kt", "MainActivity.kt"]:
    full = os.path.join(pkg_dir, fname)
    if os.path.exists(full):
        size = os.path.getsize(full)
        # Check MainActivity has registerPlugin
        if fname == "MainActivity.kt":
            content = open(full).read()
            if "registerPlugin" in content and "OcrPlugin" in content:
                print(f"✅ {fname} — OK ({size} bytes, registerPlugin found)")
            else:
                print(f"❌ {fname} — MISSING registerPlugin(OcrPlugin::class.java)!")
                print(f"   Content: {content[:200]}")
                all_ok = False
        else:
            print(f"✅ {fname} — OK ({size} bytes)")
    else:
        print(f"❌ MISSING: {full}")
        all_ok = False

if not all_ok:
    print("\n❌ CRITICAL: Plugin files missing — build will fail!")
    sys.exit(1)

print("\n✅ All checks passed!")
