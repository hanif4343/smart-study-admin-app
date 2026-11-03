/* ══════════ TOPIC মার্জ — কিউ + ব্যাকগ্রাউন্ড জমা + নোটিফিকেশন ══════════
   ধারণা: একটা একটা করে মার্জ ঠিক করে কিউতে রাখা হয় (সার্ভারে কিছু যায় না, তাৎক্ষণিক); শেষে "সব জমা দাও" চাপলে পুরো কিউ
   একটা ব্যাচ হিসেবে ব্যাকগ্রাউন্ডে যায় (GAS: tm_mergeBatch) — স্ক্রিন আটকে বসে থাকতে হয় না, অন্য পেজে যাওয়া যায়।
   • কিউ ও "চলমান ব্যাচ" localStorage-এ থাকে — অ্যাপ বন্ধ/রিলোড হলেও হারায় না।
   • ব্যাচের একটা batchId থাকে; টাইমআউট/নেটওয়ার্ক-ভুলে সার্ভারে সত্যিই হয়েছে কিনা tm_batchStatus দিয়ে দেখা হয় (ডুপ্লিকেট নয়)।
   • শেষে নোটিফিকেশন: টোস্ট (যেকোনো পেজে), চলমান-বারে ✅/🔴, আর "ম্যানেজ করুন" ট্যাবে লাল সংখ্যা (না-পড়া)। */
import { createJob, updateJob, finishJob } from "./uploadJobs.js";
import { tmMergeBatch, tmBatchStatus } from "./topicManager.js";

const LS_Q = "tm_merge_queue_v1", LS_IN = "tm_inflight_v1", LS_NOTICES = "tm_notices_v1";
const rd = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k) || "null"); return v == null ? d : v; } catch { return d; } };
const wr = (k, v) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch {} };

let queue = rd(LS_Q, []), inflight = rd(LS_IN, null), notices = rd(LS_NOTICES, []), running = false;
const qSubs = new Set(), doneSubs = new Set(), unreadSubs = new Set();
const emitQ = () => { const s = { queue: queue.slice(), running }; qSubs.forEach((f) => { try { f(s); } catch {} }); };
const emitUnread = () => { const n = getUnread(); unreadSubs.forEach((f) => { try { f(n); } catch {} }); };
const bn = (n) => String(n == null ? 0 : n).replace(/\d/g, (d) => "০১২৩৪৫৬৭৮৯"[d]);

/* ── কিউ ── */
export const getQueue = () => queue.slice();
export const isRunning = () => running;
export const subscribeQueue = (f) => { qSubs.add(f); try { f({ queue: queue.slice(), running }); } catch {} return () => qSubs.delete(f); };
// কিউ + চলমান ব্যাচে যেসব টপিক ব্যবহৃত (একটা টপিক একবারই কোনো মার্জে থাকতে পারে)
export function usedIds() {
  const u = new Map();
  const add = (it, state) => { u.set(it.targetId, { role: "master", with: it.targetName, state }); (it.sourceIds || []).forEach((id) => u.set(id, { role: "source", with: it.targetName, state })); };
  queue.forEach((it) => add(it, "queued")); if (inflight && running) (inflight.items || []).forEach((it) => add(it, "running"));
  return u;
}
export function addMerge({ targetId, targetName, sourceIds, sourceNames, subjectId, newName, estQ }) {
  const srcs = [...new Set((sourceIds || []).filter((x) => x && x !== targetId))];
  if (!targetId) return { ok: false, error: "মাস্টার টপিক বাছা হয়নি" };
  if (!srcs.length) return { ok: false, error: "মাস্টারের ভেতরে যাবে এমন অন্তত একটা টপিক টিক দাও" };
  const u = usedIds();
  if (u.has(targetId)) return { ok: false, error: `"${targetName}" আগেই অন্য মার্জের কিউতে আছে` };
  const clash = srcs.find((id) => u.has(id)); if (clash) return { ok: false, error: "একটা টপিক শুধু একটা মার্জে থাকতে পারে — কিছু টপিক আগেই কিউতে আছে" };
  queue.push({ qid: "q" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), targetId, targetName: targetName || targetId, sourceIds: srcs, sourceNames: sourceNames || [], subjectId: subjectId || "", newName: (newName || "").trim(), estQ: estQ || 0, at: Date.now() });
  wr(LS_Q, queue); emitQ(); return { ok: true };
}
export function removeMerge(qid) { queue = queue.filter((x) => x.qid !== qid); wr(LS_Q, queue); emitQ(); }
export function clearQueue() { queue = []; wr(LS_Q, queue); emitQ(); }

/* ── নোটিফিকেশন ── */
export const getUnread = () => notices.filter((n) => !n.read).length;
export const listNotices = () => notices.slice();
export const subscribeUnread = (f) => { unreadSubs.add(f); try { f(getUnread()); } catch {} return () => unreadSubs.delete(f); };
export function markNoticesRead() { let ch = false; notices.forEach((n) => { if (!n.read) { n.read = true; ch = true; } }); if (ch) { wr(LS_NOTICES, notices); emitUnread(); } }
function notify(type, title, msg) {
  notices.unshift({ id: Date.now() + Math.random(), t: Date.now(), type, title, msg, read: false }); notices = notices.slice(0, 20); wr(LS_NOTICES, notices); emitUnread();
  try { window.dispatchEvent(new CustomEvent("ss-app-notify", { detail: { type, title, msg } })); } catch {}   // App.jsx একে টোস্ট বানায় — যে পেজেই থাকি
}
export const subscribeDone = (f) => { doneSubs.add(f); return () => doneSubs.delete(f); };
const emitDone = (d) => doneSubs.forEach((f) => { try { f(d); } catch {} });

/* ── ব্যাচ জমা ── */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function pollStatus(gasSecret, batchId, tries, gapMs) {
  for (let i = 0; i < tries; i++) {
    const st = await tmBatchStatus(gasSecret, batchId);
    if (st && st.status === "success" && st.found) return st;
    if (i < tries - 1) await sleep(gapMs);
  }
  return null;
}
function finishOk({ jobId, items, res, recovered }) {
  const results = res.results || [], rejected = res.rejected || [];
  const moved = res.movedQuestions != null ? res.movedQuestions : results.reduce((a, r) => a + (r.movedQuestions || 0), 0);
  const done = results.length || items.length;
  let msg = res.already || recovered ? `${bn(items.length)}টা মার্জ আগেই সম্পন্ন হয়েছিল${res.summary ? " — " + res.summary.replace(/^\[batch:[^\]]*\]\s*/, "").slice(0, 80) : ""}` : `${bn(done)}টা মার্জ · ${bn(moved)}টা প্রশ্ন নতুন টপিকে গেছে`;
  if (rejected.length) msg += ` · ${bn(rejected.length)}টা বাদ (${rejected.slice(0, 2).map((r) => r.reason).join("; ")})`;
  const verifyBad = res.verify && res.verify.ok === false;
  if (jobId) finishJob(jobId, { ok: true, message: msg });
  notify(verifyBad || rejected.length ? "warn" : "success", verifyBad ? "⚠️ মার্জ হয়েছে, কিন্তু হিসাব মেলেনি" : "✅ Topic মার্জ সম্পন্ন", (res.warning ? res.warning + " " : "") + msg + " · Publish Now চালাতে ভুলো না");
  inflight = null; wr(LS_IN, null); running = false; emitQ();
  // রিজেক্ট হওয়া মার্জগুলো কিউতে ফেরত (ঠিক করে আবার দিতে পারবে)
  if (rejected.length) { const rej = new Set(rejected.map((r) => r.index)); items.forEach((it, i) => { if (rej.has(i)) queue.push(it); }); wr(LS_Q, queue); emitQ(); }
  emitDone({ ok: true, items, results, rejected, recovered: !!recovered, batchId: res.batchId });
}
function finishFail({ jobId, items, why }) {
  const have = new Set(queue.map((x) => x.qid)); queue = [...items.filter((x) => !have.has(x.qid)), ...queue]; wr(LS_Q, queue);
  inflight = null; wr(LS_IN, null); running = false; emitQ();
  if (jobId) finishJob(jobId, { ok: false, message: "কিউতে ফেরত আনা হয়েছে" });
  notify("error", "❌ Topic মার্জ হয়নি", `${why} — মার্জগুলো কিউতে ফেরত আনা হয়েছে, আবার "সব জমা দাও" চাপতে পারো`);
  emitDone({ ok: false, items, results: [], rejected: [] });
}

export function submitQueue({ gasSecret }) {
  if (running) return { ok: false, error: "একটা ব্যাচ আগে থেকেই চলছে — শেষ হওয়া পর্যন্ত অপেক্ষা করো" };
  if (!queue.length) return { ok: false, error: "কিউ ফাঁকা" };
  if (!gasSecret) return { ok: false, error: "GAS Secret Key দাও" };
  const items = queue.slice(), batchId = "TM" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  inflight = { batchId, items, startedAt: Date.now() }; wr(LS_IN, inflight);
  queue = []; wr(LS_Q, queue); running = true; emitQ();
  const estQ = items.reduce((a, it) => a + (it.estQ || 0), 0);
  const jobId = createJob({ label: `${items.length}টা মার্জ · আনুমানিক ${estQ}টা প্রশ্ন`, total: items.length, kind: "merge" });
  updateJob(jobId, { stage: "server", stageText: "সার্ভারে মার্জ হচ্ছে (সব একসাথে)…" });
  (async () => {
    try {
      const res = await tmMergeBatch(gasSecret, { batchId, merges: items.map((it) => ({ targetId: it.targetId, sourceIds: it.sourceIds, newName: it.newName })) });
      if (res && res.status === "success") return finishOk({ jobId, items, res });
      if (res && (res.net || res.timeout)) {            // সাড়া আসেনি — সার্ভারে হয়তো হয়ে গেছে/হচ্ছে; যাচাই
        updateJob(jobId, { stageText: "সাড়া আসেনি — সার্ভারে হয়েছে কিনা যাচাই করা হচ্ছে…" });
        const st = await pollStatus(gasSecret, batchId, 10, 7000);
        if (st) return finishOk({ jobId, items, res: { already: true, summary: st.summary, batchId }, recovered: true });
        return finishFail({ jobId, items, why: res.message || "সার্ভারে পৌঁছায়নি" });
      }
      return finishFail({ jobId, items, why: (res && res.message) || "সার্ভার error" });
    } catch (e) { finishFail({ jobId, items, why: e && e.message ? e.message : "অজানা সমস্যা" }); }
  })();
  return { ok: true, batchId, count: items.length };
}

/* ── অ্যাপ নতুন করে খুললে: আগের চলমান ব্যাচের ফল জানা ── */
export async function recoverInflight({ gasSecret }) {
  if (running || !inflight || !gasSecret) return;
  const inf = inflight; running = true; emitQ();
  const st = await pollStatus(gasSecret, inf.batchId, Date.now() - inf.startedAt < 400000 ? 8 : 2, 8000);
  if (st) return finishOk({ jobId: null, items: inf.items, res: { already: true, summary: st.summary, batchId: inf.batchId }, recovered: true });
  finishFail({ jobId: null, items: inf.items, why: "আগের ব্যাচ শেষ হয়েছে কিনা নিশ্চিত হওয়া যায়নি (সার্ভারে পাওয়া যায়নি)" });
}
