/* ══════════ টাইপিং পরিসংখ্যান স্টোর — ফোনে (localStorage) সেভ, সব ঘর/পেজ থেকে একই জায়গায় জমা ══════════ */
import { useSyncExternalStore } from "react";

const KEY = "typing_stats_v1";
const empty = () => ({ chars: 0, ms: 0, del: 0, typed: 0, wrong: 0 });
let state = (() => { try { const s = JSON.parse(localStorage.getItem(KEY) || "null"); if (s && s.days) return { days: s.days, mistakes: s.mistakes || [] }; } catch {} return { days: {}, mistakes: [] }; })();
const subs = new Set(); let saveT = null, version = 0;

export const dayKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const today = () => { const k = dayKey(); return (state.days[k] = state.days[k] || { bn: empty(), en: empty() }); };
function commit() {
  version++; subs.forEach((f) => f());
  if (saveT) clearTimeout(saveT);
  saveT = setTimeout(() => {
    const keys = Object.keys(state.days).sort(); while (keys.length > 90) delete state.days[keys.shift()];   // ৯০ দিনের বেশি পুরনো মুছে
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch {}
  }, 500);
}

/* টাইপ-ট্র্যাকারের sink */
export const typingSink = {
  typeEvt({ lang, chars, ms }) { const d = today()[lang]; d.chars += chars; d.ms += ms; commit(); },
  delEvt({ lang, chars }) { today()[lang].del += chars; commit(); },
  words({ lang, typed, wrong }) { const d = today()[lang]; d.typed += typed; d.wrong += wrong; commit(); },
  mistake({ lang, wrong, right }) { state.mistakes.push({ lang, wrong, right, t: Date.now() }); if (state.mistakes.length > 100) state.mistakes.shift(); commit(); },
};

/* হিসাব: ৫ অক্ষর = ১ শব্দ (Unicode-এ অক্ষর = কোড-পয়েন্ট); সক্রিয় সময় কম হলে WPM দেখানো হয় না */
export const wpmOf = (r) => (r && r.ms >= 15000 ? (r.chars / 5) / (r.ms / 60000) : 0);
export const accOf = (r) => (r && r.typed > 0 ? Math.max(0, 1 - r.wrong / r.typed) : null);

export function getSnapshot() { return { version, state }; }
export function resetToday() { delete state.days[dayKey()]; commit(); }
export function lastDays(n = 7) {
  const out = []; for (let i = n - 1; i >= 0; i--) { const d = new Date(); d.setDate(d.getDate() - i); const k = dayKey(d); out.push({ key: k, label: d.getDate(), bn: state.days[k]?.bn || empty(), en: state.days[k]?.en || empty() }); }
  return out;
}
export function todayRec() { return state.days[dayKey()] || { bn: empty(), en: empty() }; }
export function useTypingStats() {
  useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, () => version);
  return state;
}
