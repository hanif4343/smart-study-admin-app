# 🔥 Admin App Logcat — Firebase Setup Guide

## কী হচ্ছে?
App এখন সব activity Firebase Realtime Database-এ **`AdminAppLogcat`** path-এ automatically save করে।

### যা যা log হবে:
| Level | কখন |
|-------|-----|
| `LIFECYCLE` | App start, background/foreground, page navigation |
| `AUTH` | Login attempt, success, failure, auto-login |
| `ERROR` | Firebase write error, API fail, login fail |
| `CRASH` | Uncaught JS error, unhandled Promise rejection |
| `WARN` | Network offline, console.warn |
| `LOG` | console.log সব কিছু |
| `INFO` | Network online, console.info |
| `API` | GAS (Google Apps Script) call |

---

## Firebase Realtime Database Rules

Firebase Console → Realtime Database → Rules-এ এই rule add করো:

```json
{
  "rules": {
    "AdminAppLogcat": {
      ".write": true,
      ".read": "auth != null"
    }
  }
}
```

> **কেন `.write: true`?** — Login error হলেও log যাতে Firebase-এ পৌঁছায়, তাই write public রাখতে হবে।  
> Read শুধু authenticated user পারবে (Firebase Console থেকে দেখা যাবে)।

---

## Firebase Console-এ Logcat দেখার উপায়

1. Firebase Console → **Realtime Database**
2. `AdminAppLogcat` → `{sessionId}` → সব entry দেখো

### Entry format:
```json
{
  "ts": "2026-06-11T10:30:00.000Z",
  "tsMs": 1749638200000,
  "session": "20260611_103000_abc12",
  "level": "AUTH",
  "tag": "signIn",
  "message": "Login FAILED for admin@example.com: INVALID_PASSWORD",
  "extra": {
    "httpStatus": 400,
    "firebaseError": { "code": 400, "message": "INVALID_PASSWORD" }
  }
}
```

---

## Session ID format
`YYYYMMDD_HHMMSS_xxxxx` — প্রতিটা app open-এ নতুন session।

## পুরনো log পরিষ্কার করা
Firebase Console থেকে `AdminAppLogcat` node delete করলেই সব log মুছে যাবে।
বা Firebase Functions দিয়ে 7-দিনের বেশি পুরনো entry auto-delete করতে পারো।
