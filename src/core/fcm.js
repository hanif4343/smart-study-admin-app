import { FB, FB_PROJ, FCM_CLIENT_EMAIL, FCM_PRIVATE_KEY } from "./config.js";
import { _LC } from "./logger.js";
import { _authQ } from "./auth.js";
import { _tok } from "./firebase.js";
import { phoneKey } from "./utils.js";


/* ══════════════════════════════════════════════════════════════════════════
   📲 FCM v1 DIRECT — Firebase Cloud Messaging HTTP v1 API
   Service Account JWT দিয়ে OAuth token নিয়ে FCM v1 call — instant।
   Legacy API deprecated — এটাই নতুন standard।
   Token path: Users/{phoneKey}/fcmToken  (main app সেখানে save করে)
   ══════════════════════════════════════════════════════════════════════════ */

/* ── JWT বানাও Service Account দিয়ে (browser crypto API) ── */
async function _fcmGetAccessToken() {
  if (!FCM_CLIENT_EMAIL || !FCM_PRIVATE_KEY) {
    _LC.warn("fcmGetToken", "FCM credentials missing");
    return null;
  }
  try {
    if (!crypto?.subtle) {
      _LC.error("fcmGetToken", "crypto.subtle unavailable");
      return null;
    }
    const now = Math.floor(Date.now() / 1000);
    const b64url = obj => {
      const s = typeof obj === "string" ? obj : JSON.stringify(obj);
      return btoa(unescape(encodeURIComponent(s)))
        .replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
    };
    const header  = {alg:"RS256",typ:"JWT"};
    const payload = {
      iss:FCM_CLIENT_EMAIL, sub:FCM_CLIENT_EMAIL,
      aud:"https://oauth2.googleapis.com/token",
      iat:now, exp:now+3600,
      scope:"https://www.googleapis.com/auth/firebase.messaging",
    };
    const sigInput = b64url(header) + "." + b64url(payload);
    // PEM → DER
    const pem = FCM_PRIVATE_KEY
      .replace(/-----BEGIN PRIVATE KEY-----/g,"")
      .replace(/-----END PRIVATE KEY-----/g,"")
      .replace(/[\r\n\s]/g,"");
    if (!pem) { _LC.error("fcmGetToken","Empty PEM after parse"); return null; }
    const der = Uint8Array.from(atob(pem), c => c.charCodeAt(0));
    const key = await crypto.subtle.importKey(
      "pkcs8", der.buffer,
      {name:"RSASSA-PKCS1-v1_5", hash:"SHA-256"},
      false, ["sign"]
    );
    const sig = await crypto.subtle.sign(
      "RSASSA-PKCS1-v1_5", key,
      new TextEncoder().encode(sigInput)
    );
    const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sig)))
      .replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
    const jwt = sigInput + "." + sigB64;
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method:"POST",
      headers:{"Content-Type":"application/x-www-form-urlencoded"},
      body:"grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion="+jwt,
    });
    const d = await res.json();
    if (!d.access_token) {
      _LC.error("fcmGetToken","Token fail: "+JSON.stringify(d).slice(0,200));
      return null;
    }
    _LC.info("fcmGetToken","FCM token ok");
    return d.access_token;
  } catch(e) {
    _LC.error("fcmGetToken","Error: "+e.message+" key_len:"+FCM_PRIVATE_KEY.length);
    return null;
  }
}

// Access token cache — ১ ঘণ্টা valid
let _fcmTokenCache = { token: null, exp: 0 };
async function _fcmToken() {
  if (_fcmTokenCache.token && Date.now() < _fcmTokenCache.exp) return _fcmTokenCache.token;
  const t = await _fcmGetAccessToken();
  if (t) _fcmTokenCache = { token: t, exp: Date.now() + 55 * 60 * 1000 };
  return t;
}

/* একজনকে FCM v1 notification পাঠাও */
async function fcmSendOne(fcmToken, title, body, data) {
  if (!FCM_CLIENT_EMAIL || !fcmToken) return false;
  data = data || {};
  try {
    const accessToken = await _fcmToken();
    if (!accessToken) { _LC.warn("fcmSendOne", "No access token"); return false; }

    const projectId = FB_PROJ || FCM_CLIENT_EMAIL.split("@")[1]?.split(".")[0];
    const r = await fetch(
      `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`,
      {
        method: "POST",
        headers: {
          "Authorization": "Bearer " + accessToken,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: {
            token: fcmToken,
            notification: { title, body },
            android: {
              priority: "high",
              notification: { sound: "default", click_action: "FLUTTER_NOTIFICATION_CLICK" },
            },
            data: Object.fromEntries(
              Object.entries({ ...data, title, body }).map(([k,v]) => [k, String(v)])
            ),
          },
        }),
      }
    );
    const res = await r.json();
    const ok = !!res.name;
    _LC.api("fcmSendOne", ok ? "✅ FCM v1 sent" : "⚠️ FCM v1 fail", { token: fcmToken.slice(-8), title, res });
    return ok;
  } catch(e) {
    _LC.error("fcmSendOne", "FCM v1 error: " + e.message);
    return false;
  }
}

/* Phone নম্বর থেকে FCM token পড়ে notification পাঠাও */
async function fcmNotifyPhone(phone, title, body, extraData) {
  if (!phone || !FCM_CLIENT_EMAIL) return false;
  try {
    const phK = phoneKey(phone);
    const t = await _tok();
    const r = await fetch(`${FB}/Users/${phK}/fcmToken.json${_authQ(t)}`);
    const token = await r.json();
    if (!token || typeof token !== "string") {
      _LC.warn("fcmNotifyPhone", "No FCM token for: " + phone);
      return false;
    }
    return fcmSendOne(token, title, body, extraData || {});
  } catch(e) {
    _LC.error("fcmNotifyPhone", e.message);
    return false;
  }
}

/* সব active user কে broadcast FCM — 20 concurrent */
async function fcmBroadcast(title, body, users) {
  if (!FCM_CLIENT_EMAIL) return 0;
  const t = await _tok();
  let sent = 0;
  const CONC = 20;
  for (let i = 0; i < users.length; i += CONC) {
    const chunk = users.slice(i, i + CONC);
    const results = await Promise.all(chunk.map(async u => {
      const phK = phoneKey(u.Phone || u.phone || "");
      if (!phK) return false;
      try {
        const r = await fetch(`${FB}/Users/${phK}/fcmToken.json${_authQ(t)}`);
        const token = await r.json();
        if (!token || typeof token !== "string") return false;
        return fcmSendOne(token, title, body, {});
      } catch(_) { return false; }
    }));
    sent += results.filter(Boolean).length;
  }
  _LC.api("fcmBroadcast", `Broadcast done: ${sent}/${users.length}`, { title });
  return sent;
}

export { _fcmGetAccessToken, _fcmToken, fcmSendOne, fcmNotifyPhone, fcmBroadcast };
