/* ══════════ TOPIC MANAGER — GAS API (topic_manager.gs, action/type = tm_*) ══════════
   সব কল POST (লম্বা id-তালিকা পাঠাতে হয়)। ফেরত: {status:"success"|"error", ...}
   নেটওয়ার্ক/টাইমআউটের ব্যর্থতায় net:true থাকে (সার্ভার হয়তো কাজ শেষ করে ফেলেছে — tmBatchStatus দিয়ে যাচাই করা যায়)। */
import { GAS } from "./config.js";

async function tmPost(type, gasSecret, body = {}, { timeoutMs = 0 } = {}) {
  if (!GAS) return { status: "error", message: "GAS URL সেট করা নেই" };
  if (!gasSecret) return { status: "error", message: "GAS Secret Key দাও" };
  const ctl = timeoutMs && typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer = ctl ? setTimeout(() => ctl.abort(), timeoutMs) : null;
  try {
    const resp = await fetch(GAS, { method: "POST", headers: { "Content-Type": "text/plain" }, body: JSON.stringify({ secret: gasSecret, type, ...body }), signal: ctl ? ctl.signal : undefined });
    const data = await resp.json().catch(() => null);
    return data || { status: "error", net: true, message: "সার্ভার JSON ফেরত দেয়নি (GAS-এ topic_manager.gs যোগ করে নতুন version ডিপ্লয় করেছ?)" };
  } catch (e) { return { status: "error", net: true, timeout: e && e.name === "AbortError", message: (e && e.name === "AbortError") ? "সাড়া আসতে অনেক দেরি হলো (টাইমআউট)" : (e?.message || String(e)) }; }
  finally { if (timer) clearTimeout(timer); }
}

export const tmGetTopics    = (s) => tmPost("tm_getTopics", s);
export const tmGetLog       = (s) => tmPost("tm_getLog", s);
export const tmMergePreview = (s, { targetId, sourceIds, newName }) => tmPost("tm_mergePreview", s, { targetId, sourceIds, newName: newName || "" });
export const tmMerge        = (s, { targetId, sourceIds, newName }) => tmPost("tm_merge", s, { targetId, sourceIds, newName: newName || "" });
export const tmDeleteEmpty  = (s, ids) => tmPost("tm_deleteEmpty", s, { ids });
export const tmUndo         = (s) => tmPost("tm_undo", s);
// 🆕 অনেকগুলো মার্জ একসাথে (দ্রুত) — GAS-এ tm_mergeBatch লাগে; batchId একই থাকলে সার্ভার আবার করে না (রিট্রাই নিরাপদ)
export const tmMergeBatch   = (s, { merges, batchId }) => tmPost("tm_mergeBatch", s, { merges, batchId }, { timeoutMs: 290000 });
export const tmBatchStatus  = (s, batchId) => tmPost("tm_batchStatus", s, { batchId }, { timeoutMs: 60000 });
