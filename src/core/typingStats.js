/* ══════════ টাইপিং পরিসংখ্যান স্টোর — ফোনে (localStorage) সেভ, সব ঘর/পেজ থেকে একই জায়গায় জমা ══════════ */
import { useSyncExternalStore } from "react";
import { createTypingSession } from "./typingSession.js";

const KEY = "typing_stats_v1";
// chars/ms/del = পুরনো পদ্ধতির (৫ অক্ষর=১ শব্দ, থামা বাদ) হিসাব — শুধু পুরনো দিনের তথ্যের জন্য রাখা।
// run* / key* = নতুন পদ্ধতি (একটাই ঘড়ি, থামাসহ): runWords শব্দ, runWall পুরো সময়(ms), runActive হাত-চলার সময়, runPause থামার সময়,
// keyTyped/keyErased কী-স্ট্রোক, spellErr = রান শেষে বাকি থাকা ইংরেজি ভুল-বানান, runs = রানের সংখ্যা।
const empty = () => ({ chars: 0, ms: 0, del: 0, typed: 0, wrong: 0, runWords: 0, runWall: 0, runActive: 0, runPause: 0, keyTyped: 0, keyErased: 0, spellErr: 0, runs: 0 });
const fix = (d) => { const e = empty(); Object.keys(e).forEach((k) => { if (typeof d[k] !== "number") d[k] = 0; }); return d; };
let state = (() => { try { const s = JSON.parse(localStorage.getItem(KEY) || "null"); if (s && s.days) return { days: s.days, mistakes: s.mistakes || [], runs: s.runs || [] }; } catch {} return { days: {}, mistakes: [], runs: [] }; })();
const subs = new Set(); let saveT = null, version = 0;

export const dayKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const today = () => { const k = dayKey(); const d = (state.days[k] = state.days[k] || { bn: empty(), en: empty() }); fix(d.bn); fix(d.en); return d; };
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

/* ── রান শেষ হলে দৈনিক হিসাবে জমা (typingSession থেকে) ── ভাষা অনুযায়ী শব্দের অনুপাতে সময় ভাগ হয় */
export const typingSession = createTypingSession({
  onCommit(rec) {
    const wb = rec.words.bn, we = rec.words.en, tot = wb + we, kt = rec.keyTyped.bn + rec.keyTyped.en;
    const shareBn = tot > 0 ? wb / tot : kt > 0 ? rec.keyTyped.bn / kt : 0.5;
    const day = today();
    [["bn", shareBn], ["en", 1 - shareBn]].forEach(([l, sh]) => {
      const d = day[l];
      d.runWords += rec.words[l]; d.runWall += rec.wall * sh; d.runActive += rec.active * sh; d.runPause += rec.pause * sh;
      d.keyTyped += rec.keyTyped[l]; d.keyErased += rec.keyErased[l];
      if (l === "en") d.spellErr += rec.spellErr;
      if (sh >= 0.5) d.runs += 1;
    });
    state.runs.push({ t: rec.endedAt, wall: rec.wall, active: rec.active, pause: rec.pause, words: rec.words, keyTyped: rec.keyTyped, keyErased: rec.keyErased, spellErr: rec.spellErr, boxes: rec.boxes.slice(0, 8) });
    while (state.runs.length > 40) state.runs.shift();
    commit();
  },
  onRun(rec) { runSubs.forEach((f) => { try { f(rec); } catch {} }); },
});
const runSubs = new Set();
export const subscribeRun = (f) => { runSubs.add(f); return () => runSubs.delete(f); };

/* হিসাব (নতুন): সত্যিকারের গতি = শব্দ ÷ পুরো সময় (থামাসহ); হাত-চলার গতি = শব্দ ÷ হাত-চলার সময়; থামার % ; কী-স্ট্রোক নির্ভুলতা */
export const MIN_SHOW_MS = 8000;
const nz = (x) => x || 0;
export const hasRunData = (r) => !!r && nz(r.runWall) > 0;
export const honestWpm = (r) => (r && nz(r.runWall) >= MIN_SHOW_MS && nz(r.runWords) > 0 ? r.runWords / (r.runWall / 60000) : 0);
export const handWpm = (r) => (r && nz(r.runActive) >= 5000 && nz(r.runWords) > 0 ? r.runWords / (r.runActive / 60000) : 0);
export const pausePct = (r) => (r && nz(r.runWall) > 0 ? nz(r.runPause) / r.runWall : null);
export const keyAccOf = (r) => (r && nz(r.keyTyped) > 0 ? Math.max(0, 1 - nz(r.keyErased) / r.keyTyped) : null);
/* পুরনো পদ্ধতি (শুধু পুরনো দিনের জন্য): ৫ অক্ষর = ১ শব্দ; সক্রিয় সময় কম হলে WPM দেখানো হয় না */
export const wpmOf = (r) => (r && r.ms >= 15000 ? (r.chars / 5) / (r.ms / 60000) : 0);
export const accOf = (r) => (r && r.typed > 0 ? Math.max(0, 1 - r.wrong / r.typed) : null);

export function getSnapshot() { return { version, state }; }
export function resetToday() { delete state.days[dayKey()]; commit(); }
export const recentRuns = (n = 8) => state.runs.slice(-n).reverse();
export function lastDays(n = 7) {
  const out = []; for (let i = n - 1; i >= 0; i--) { const d = new Date(); d.setDate(d.getDate() - i); const k = dayKey(d); out.push({ key: k, label: d.getDate(), bn: state.days[k]?.bn || empty(), en: state.days[k]?.en || empty() }); }
  return out;
}
export function todayRec() { return state.days[dayKey()] || { bn: empty(), en: empty() }; }
export function useTypingStats() {
  useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, () => version);
  return state;
}
