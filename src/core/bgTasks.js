/* ══════════════════════════════════════════════════════════════
   🔄 BACKGROUND TASK MANAGER
   — সব API call queue হয়, minimize/screen off হলেও কাজ চলে
   ══════════════════════════════════════════════════════════════ */
import { useState, useEffect } from "react";
import { _LC } from "./logger.js";

/* ══════════════════════════════════════════════════════════════
   🔄 BACKGROUND TASK MANAGER
   — সব API call (GAS GET/POST) এখানে queue হয়
   — App minimize / screen off হলেও কাজ চলে
   — WakeLock API দিয়ে CPU জাগিয়ে রাখে
   — visibilitychange এ pending tasks flush করে
   — React component এ live badge দেখায়
   ══════════════════════════════════════════════════════════════ */
const _BGM = (() => {
  const RETRY_DELAYS = [1000, 3000, 8000];
  const MAX_QUEUE    = 500;
  let _queue   = [];
  let _running = false;
  let _wakeLock= null;
  let _listeners = [];
  let _activeCount = 0;
  let _doneCount   = 0;
  let _failCount   = 0;

  async function _acquireWake() {
    if (!navigator.wakeLock) return;
    try {
      if (_wakeLock && _wakeLock.released === false) return;
      _wakeLock = await navigator.wakeLock.request("screen");
      _LC.info("BGM", "WakeLock acquired");
    } catch(e) { _LC.warn("BGM", "WakeLock failed: " + e.message); }
  }
  async function _releaseWake() {
    if (_wakeLock && !_wakeLock.released) {
      try { await _wakeLock.release(); } catch(_){}
      _wakeLock = null;
    }
  }

  /* ── guard(): যেকোনো Firebase read/write call এর চারপাশে wrap হয় ──
     - প্রথম কলেই WakeLock + native Foreground Service চালু হয়
     - শেষ কলটা শেষ হওয়ার পর ৪ সেকেন্ড অপেক্ষা করে বন্ধ হয় (পরপর অনেক ছোট
       save/read আসলে বারবার toggle না হওয়ার জন্য)
     - এর ফলে স্ক্রিন লক হলেও বা অ্যাপ minimize করলেও লম্বা সেভ/সিংক
       Android কর্তৃক বন্ধ/kill হয় না, এবং ইউজারকে অযথা লগআউট দেখায় না */
  let _guardCount = 0;
  let _guardReleaseTimer = null;
  async function guardStart(label) {
    _guardCount++;
    if (_guardReleaseTimer) { clearTimeout(_guardReleaseTimer); _guardReleaseTimer = null; }
    if (_guardCount === 1) {
      await _acquireWake();
      _nativeStart(label || "সেভ হচ্ছে…");
    } else {
      _nativeUpdate(label ? label : ("চলমান কাজ: " + _guardCount + "টি"));
    }
  }
  function guardEnd() {
    _guardCount = Math.max(0, _guardCount - 1);
    if (_guardCount === 0) {
      if (_guardReleaseTimer) clearTimeout(_guardReleaseTimer);
      _guardReleaseTimer = setTimeout(() => {
        _guardReleaseTimer = null;
        if (_guardCount === 0) { _releaseWake(); _nativeStop(); }
      }, 4000);
    }
  }
  async function guard(fn, label) {
    await guardStart(label);
    try {
      return await fn();
    } finally {
      guardEnd();
    }
  }

  document.addEventListener("visibilitychange", async () => {
    if (!document.hidden && _queue.length > 0) {
      _LC.lifecycle("BGM", "App foregrounded — flushing " + _queue.length + " pending tasks");
      await _acquireWake();
      _flush();
    }
  });

  function _notify() {
    _listeners.forEach(fn => { try { fn(); } catch(_){} });
  }

  async function _flush() {
    if (_running) return;
    if (_queue.length === 0) { _releaseWake(); _notify(); return; }
    _running = true;
    await _acquireWake();
    _notify();

    while (_queue.length > 0) {
      const task = _queue[0];
      _activeCount++;
      _notify();
      try {
        await task.fn();
        _queue.shift();
        _doneCount++;
        _LC.log("BGM", "✔ Task done: " + task.label, {doneCount:_doneCount});
      } catch(e) {
        task.retries = (task.retries||0) + 1;
        const delay = RETRY_DELAYS[task.retries - 1];
        if (delay !== undefined) {
          _LC.warn("BGM", "↩ Retry " + task.retries + " for: " + task.label + " — " + e.message);
          await new Promise(r => setTimeout(r, delay));
        } else {
          _LC.error("BGM", "✗ Task failed: " + task.label + " — " + e.message);
          _queue.shift();
          _failCount++;
        }
      }
      _activeCount = Math.max(0, _activeCount - 1);
      _notify();
    }

    _running = false;
    _releaseWake();
    _notify();
  }

  function enqueue(fn, label) {
    label = label || "task";
    if (_queue.length >= MAX_QUEUE) { _LC.warn("BGM","Queue full: "+label); return; }
    _queue.push({ fn, label, retries: 0, ts: Date.now() });
    _LC.log("BGM", "⏳ Enqueued: " + label + " (queue=" + _queue.length + ")");
    _notify();
    setTimeout(_flush, 50);
  }

  /* ── Native Foreground Service bridge (Android) ── */
  function _nativeStart(label) {
    try {
      const plugin = window.Capacitor?.Plugins?.BgSync;
      if (plugin) plugin.start({ title: "Admin: কাজ চলছে…", text: label || "Background sync" });
    } catch(_) {}
  }
  function _nativeUpdate(label) {
    try {
      const plugin = window.Capacitor?.Plugins?.BgSync;
      if (plugin) plugin.update({ title: "Admin: কাজ চলছে…", text: label });
    } catch(_) {}
  }
  function _nativeStop() {
    try {
      const plugin = window.Capacitor?.Plugins?.BgSync;
      if (plugin) plugin.stop();
    } catch(_) {}
  }

  // Patch enqueue/flush to call native service
  const _origEnqueue = enqueue;
  function enqueueWithNative(fn, label) {
    const wasEmpty = _queue.length === 0;
    _origEnqueue(fn, label);
    if (wasEmpty) _nativeStart(label || "task");
  }

  // Patch flush to stop service when done
  const _origFlushCheck = _notify;
  // Override notify to also call native stop when done
  _listeners._nativeCheck = () => {
    if (!_running && _queue.length === 0) _nativeStop();
    else if (_running && _queue.length > 0) _nativeUpdate("বাকি: " + _queue.length + "টি কাজ");
  };
  _listeners.push(_listeners._nativeCheck);

  return {
    enqueue: enqueueWithNative,
    guard,
    getState: () => ({ pending:_queue.length, active:_activeCount, done:_doneCount, failed:_failCount, running:_running }),
    subscribe: fn => { _listeners.push(fn); return () => { _listeners = _listeners.filter(x=>x!==fn); }; },
  };
})();

function useBGM() {
  const [state, setState] = useState(() => _BGM.getState());
  useEffect(() => {
    const unsub = _BGM.subscribe(() => setState({..._BGM.getState()}));
    return unsub;
  }, []);
  return state;
}

export { _BGM, useBGM };
