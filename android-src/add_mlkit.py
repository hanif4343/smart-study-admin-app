import re, sys

path = "android/app/build.gradle"
txt = open(path).read()

mlkit = '\n    implementation("com.google.mlkit:text-recognition:16.0.0")\n    implementation("com.google.mlkit:text-recognition-devanagari:16.0.0")\n'

if "mlkit" not in txt:
    txt = re.sub(r'(dependencies \{)', r'\1' + mlkit, txt, count=1)
    open(path, "w").write(txt)
    print("MLKit deps added")
else:
    print("Already present")
