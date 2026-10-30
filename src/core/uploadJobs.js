/* ══════════ ব্যাকগ্রাউন্ড আপলোড জব (প্রশ্নপত্র) ══════════
   সাবমিট চাপলে ফর্ম সাথে সাথে খালি হয়, আপলোড এখানকার জবে চলে। অ্যাপের যেকোনো পেজ থেকে
   উপরের/নিচের চলমান-বার (UploadProgressChip) দিয়ে দেখা যায় সত্যিই আপলোড হচ্ছে কিনা।

   প্রগতির সততা: সার্ভার নিজে "কত % হলো" জানাতে পারে না। তাই বারে যা সত্যি তা-ই দেখানো হয় —
     • সত্যিকারের ঘটনা: কোন ধাপ চলছে, কোন চাংক শেষ, রিট্রাই হচ্ছে কিনা, সফল/ব্যর্থ
     • চলছে-প্রমাণ: প্রতি সেকেন্ডে গোনা সময় (⏱)
     • শতাংশ: আগের আপলোডের গড় সময় থেকে করা আন্দাজ (শেষ না হওয়া পর্যন্ত ৯৫%-এর বেশি যায় না);
       সার্ভার সাড়া দিলে ১০০% */

const LS_TIMING = "ss_upload_timing_v1";
const jobs = new Map();
const subs = new Set();
let seq = 0, ticker = null;

function loadTiming() {
  try { const t = JSON.parse(localStorage.getItem(LS_TIMING) || "null"); if (t && t.baseMs > 0 && t.perRowMs > 0) return t; } catch {}
  return { baseMs: 3500, perRowMs: 140, n: 0 };
}
// একটা চাংকে rows-টা প্রশ্ন পাঠাতে আনুমানিক কত ms লাগবে (আগের আপলোড থেকে শেখা)
export const estimateMs = (rows) => { const t = loadTiming(); return t.baseMs + t.perRowMs * Math.max(1, rows); };
function recordTiming(rows, ms) {
  if (!rows || ms < 300) return;
  try {
    const t = loadTiming(), w = t.n >= 3 ? 0.35 : 0.6;   // নতুন মাপের ওজন
    const perRow = Math.max(20, (ms - t.baseMs) / rows);
    localStorage.setItem(LS_TIMING, JSON.stringify({ baseMs: t.baseMs, perRowMs: Math.round(t.perRowMs * (1 - w) + perRow * w), n: t.n + 1 }));
  } catch {}
}

const snapshot = () => [...jobs.values()].map((j) => ({ ...j }));
function emit() { const s = snapshot(); subs.forEach((f) => { try { f(s); } catch {} }); }
export const subscribeJobs = (fn) => { subs.add(fn); fn(snapshot()); return () => subs.delete(fn); };
export const getJobs = snapshot;
export const isJobActive = (id) => { const j = jobs.get(id); return !!j && !j.finishedAt; };

function recompute(j, now) {
  if (j.finishedAt) return;
  const est = Math.max(1500, estimateMs(j.chunkRows || j.total));
  const el = now - (j.chunkStartedAt || j.startedAt);
  const within = j.stage === "server" ? Math.min(0.95, 1 - Math.exp(-el / (est * 0.55))) : 0;
  const per = j.totalChunks > 0 ? (j.doneChunks + within) / j.totalChunks : within;
  j.pct = Math.max(j.pct || 0, Math.min(95, Math.round(per * 100)));   // কখনো পিছায় না
  j.elapsedMs = now - j.startedAt;
  j.slow = j.stage === "server" && el > est * 2.2;
}
function ensureTicker() {
  if (ticker) return;
  ticker = setInterval(() => {
    const now = Date.now(); let active = false;
    jobs.forEach((j) => { if (!j.finishedAt) { active = true; recompute(j, now); } });
    emit();
    if (!active) { clearInterval(ticker); ticker = null; }
  }, 500);
}

/* নতুন জব। stage: "send"(পাঠানো শুরু) → "server"(সার্ভারে সেভ হচ্ছে) → "verify"(যাচাই) → "done" */
export function createJob({ label, total }) {
  const id = "job_" + (++seq) + "_" + Date.now().toString(36);
  jobs.set(id, { id, label: label || "প্রশ্নপত্র", total, stage: "send", stageText: "সার্ভারে পাঠানো শুরু হচ্ছে…", pct: 2, doneChunks: 0, totalChunks: 1,
    chunkRows: total, startedAt: Date.now(), chunkStartedAt: Date.now(), elapsedMs: 0, slow: false, retry: 0, ok: null, finishedAt: 0, message: "" });
  ensureTicker(); emit(); return id;
}
export function updateJob(id, patch) {
  const j = jobs.get(id); if (!j) return;
  Object.assign(j, patch); recompute(j, Date.now()); emit();
}
// saveRowsToSheet-এর ঘটনা থেকে: {type:"chunk-start"|"retry"|"chunk-done"}
export function jobEvent(id, ev) {
  const j = jobs.get(id); if (!j) return;
  if (ev.type === "chunk-start") {
    Object.assign(j, { stage: "server", chunkRows: ev.rows, totalChunks: ev.totalChunks, chunkStartedAt: Date.now(), retry: ev.attempt - 1,
      stageText: ev.totalChunks > 1 ? `সার্ভারে সেভ হচ্ছে (অংশ ${ev.index}/${ev.totalChunks})…` : "সার্ভারে সেভ হচ্ছে…" });
  } else if (ev.type === "retry") {
    Object.assign(j, { retry: ev.attempt - 1, chunkStartedAt: Date.now(), stageText: "ধীর নেটওয়ার্ক — আবার চেষ্টা চলছে…" });
  } else if (ev.type === "chunk-done") {
    j.doneChunks = ev.index; j.chunkStartedAt = Date.now();
    j.stageText = ev.index >= ev.totalChunks ? "যাচাই করা হচ্ছে…" : `অংশ ${ev.index}/${ev.totalChunks} সেভ হয়েছে ✓`;
    if (ev.index >= ev.totalChunks) j.stage = "verify";
  }
  recompute(j, Date.now()); emit();
}
export function finishJob(id, { ok, message }) {
  const j = jobs.get(id); if (!j) return;
  const now = Date.now();
  if (ok) recordTiming(j.total, now - j.startedAt);
  Object.assign(j, { ok: !!ok, finishedAt: now, stage: "done", pct: ok ? 100 : j.pct, elapsedMs: now - j.startedAt, slow: false, message: message || "", stageText: ok ? "সম্পন্ন ✓" : "ব্যর্থ" });
  emit();
  setTimeout(() => { jobs.delete(id); emit(); }, ok ? 5000 : 12000);
}
