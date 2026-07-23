/* ══════════════════════════════════════════════════════════════
   🔥 ADMIN APP LOGCAT — Firebase Realtime DB Logger
   সব log, error, warn, API call, crash Firebase-এ জমা হবে
   Path: AdminAppLogcat/{sessionId}/{pushId}
   ══════════════════════════════════════════════════════════════ */
import { FB, FB_PROJ, FCM_CLIENT_EMAIL } from "./config.js";

const _LC = (() => {
  // Bangladesh time (UTC+6)
  const _bdNow = () => {
    const now = new Date();
    const bd = new Date(now.getTime() + 6*60*60*1000);
    const pad = n => String(n).padStart(2,"0");
    return {
      date:   `${bd.getUTCFullYear()}-${pad(bd.getUTCMonth()+1)}-${pad(bd.getUTCDate())}`,
      time:   `${pad(bd.getUTCHours())}-${pad(bd.getUTCMinutes())}-${pad(bd.getUTCSeconds())}`,
      full:   `${bd.getUTCFullYear()}-${pad(bd.getUTCMonth()+1)}-${pad(bd.getUTCDate())} ${pad(bd.getUTCHours())}:${pad(bd.getUTCMinutes())}:${pad(bd.getUTCSeconds())}`,
    };
  };
  const _startTime = _bdNow();
  const _rand = Math.random().toString(36).slice(2,6);
  // Session ID: "2025-06-15 14:23:05 [abc1]" — Firebase এ এটাই key হবে, সরাসরি পড়া যাবে
  const _sessionId = `${_startTime.date} ${_startTime.time.replace(/-/g,":")} [${_rand}]`;
  // Date folder: 2025-06-15
  const _dateFolder = _startTime.date;

  const _device = (() => {
    try {
      const ua = navigator.userAgent;
      const isAndroid = /Android/.test(ua);
      const isIOS = /iPhone|iPad/.test(ua);
      const androidVer = isAndroid ? (ua.match(/Android ([\d.]+)/)||[])[1] : null;
      const model = isAndroid ? (ua.match(/;\s*([^;)]+)\sBuild/)||[])[1]?.trim() : null;
      return {
        platform: isAndroid ? "Android" : isIOS ? "iOS" : "Web",
        androidVersion: androidVer || null,
        model: model || null,
        userAgent: ua.slice(0, 120),
        language: navigator.language || null,
        online: navigator.onLine,
        screen: `${window.screen?.width||0}x${window.screen?.height||0}`,
      };
    } catch(e) { return { platform: "Unknown" }; }
  })();

  const _queue = [];
  let _flushing = false;
  let _logCount = 0;
  const MAX_QUEUE = 200;
  const MAX_LOGS_PER_SESSION = 2000;

  async function _pushToFirebase(entry) {
    if (!FB) return;
    try {
      let authQ = "";
      try { if (window.__adminIdToken) authQ = `?auth=${window.__adminIdToken}`; } catch(e){}
      // Path: AdminAppLogcat/{date}/{session_title}/logs
      // Firebase এ: AdminAppLogcat > 2025-06-15 > "2025-06-15 14:23:05 [abc1]" > log entries
      const url = `${FB}/AdminAppLogcat/${_dateFolder}/${encodeURIComponent(_sessionId)}/logs.json${authQ}`;
      await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(entry),
      });
    } catch(e) { /* Firebase write fail — silent */ }
  }

  async function _flush() {
    if (_flushing || _queue.length === 0) return;
    _flushing = true;
    while (_queue.length > 0) {
      const entry = _queue.shift();
      await _pushToFirebase(entry);
    }
    _flushing = false;
  }

  function _send(level, tag, message, extra) {
    if (_logCount >= MAX_LOGS_PER_SESSION) return;
    _logCount++;
    const now = new Date();
    const pad = n => String(n).padStart(2,"0");
    const bdTime = new Date(now.getTime() + 6*60*60*1000); // UTC+6 Bangladesh
    const tsLocal = `${bdTime.getUTCFullYear()}-${pad(bdTime.getUTCMonth()+1)}-${pad(bdTime.getUTCDate())} ${pad(bdTime.getUTCHours())}:${pad(bdTime.getUTCMinutes())}:${pad(bdTime.getUTCSeconds())}`;
    const entry = {
      ts: tsLocal,           // "2025-06-15 14:23:05" — readable Bangladesh time
      tsMs: now.getTime(),   // sort এর জন্য
      session: _sessionId,
      level,
      tag,
      message: String(message).slice(0, 800),
      ...(extra && Object.keys(extra).length > 0 ? { extra } : {}),
    };
    if (_queue.length < MAX_QUEUE) _queue.push(entry);
    setTimeout(_flush, 0);
  }

  const _origLog   = console.log.bind(console);
  const _origWarn  = console.warn.bind(console);
  const _origError = console.error.bind(console);

  function _serialize(args) {
    return args.map(a => {
      if (a === null) return "null";
      if (a === undefined) return "undefined";
      if (typeof a === "string") return a;
      if (a instanceof Error) return `${a.name}: ${a.message}`;
      try { return JSON.stringify(a); } catch(e) { return String(a); }
    }).join(" ").slice(0, 800);
  }

  console.log = (...args) => { _origLog(...args); _send("LOG", "console", _serialize(args)); };
  console.warn = (...args) => { _origWarn(...args); _send("WARN", "console", _serialize(args)); };
  console.error = (...args) => { _origError(...args); _send("ERROR", "console", _serialize(args)); };
  console.info = (...args) => { _origLog(...args); _send("INFO", "console", _serialize(args)); };

  window.addEventListener("error", (e) => {
    _send("CRASH", "uncaughtError", `${e.message} @ ${e.filename}:${e.lineno}:${e.colno}`, {
      stack: (e.error?.stack||"").slice(0,500),
    });
  });
  window.addEventListener("unhandledrejection", (e) => {
    const msg = e.reason instanceof Error
      ? `${e.reason.name}: ${e.reason.message}`
      : String(e.reason||"UnhandledRejection");
    _send("CRASH", "unhandledRejection", msg, { stack: (e.reason?.stack||"").slice(0,400) });
  });

  window.addEventListener("online",  () => _send("INFO", "network", "Device came ONLINE"));
  window.addEventListener("offline", () => _send("WARN", "network", "Device went OFFLINE"));

  document.addEventListener("visibilitychange", () => {
    _send("LIFECYCLE", "visibility", document.hidden ? "App went to BACKGROUND" : "App came to FOREGROUND");
  });

  _send("LIFECYCLE", "appStart", "Admin App started", {
    device: _device,
    fbUrl: FB ? FB.replace(/https?:\/\//, "").slice(0,40) : "NOT_SET",
    fbProject: FB_PROJ || "NOT_SET",
    fcmReady: !!(typeof FCM_CLIENT_EMAIL !== "undefined" && FCM_CLIENT_EMAIL),
    appVersion: "1.0",
  });

  return {
    log:       (tag, msg, extra) => _send("LOG",       tag, msg, extra),
    warn:      (tag, msg, extra) => _send("WARN",      tag, msg, extra),
    error:     (tag, msg, extra) => _send("ERROR",     tag, msg, extra),
    info:      (tag, msg, extra) => _send("INFO",      tag, msg, extra),
    auth:      (tag, msg, extra) => _send("AUTH",      tag, msg, extra),
    api:       (tag, msg, extra) => _send("API",       tag, msg, extra),
    lifecycle: (tag, msg, extra) => _send("LIFECYCLE", tag, msg, extra),
    crash:     (tag, msg, extra) => _send("CRASH",     tag, msg, extra),
    sessionId: _sessionId,
    device:    _device,
  };
})();
/* ══════════ END ADMIN APP LOGCAT ══════════ */

export { _LC };
