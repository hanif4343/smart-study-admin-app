/* ══════════ TOPIC MANAGER — GAS API (topic_manager.gs, action/type = tm_*) ══════════
   সব কল POST (লম্বা id-তালিকা পাঠাতে হয়)। ফেরত: {status:"success"|"error", ...} */
import { GAS } from "./config.js";

async function tmPost(type, gasSecret, body = {}) {
  if (!GAS) return { status: "error", message: "GAS URL সেট করা নেই" };
  if (!gasSecret) return { status: "error", message: "GAS Secret Key দাও" };
  try {
    const resp = await fetch(GAS, { method: "POST", headers: { "Content-Type": "text/plain" }, body: JSON.stringify({ secret: gasSecret, type, ...body }) });
    const data = await resp.json().catch(() => null);
    return data || { status: "error", message: "সার্ভার JSON ফেরত দেয়নি (GAS-এ topic_manager.gs যোগ করে নতুন version ডিপ্লয় করেছ?)" };
  } catch (e) { return { status: "error", message: e?.message || String(e) }; }
}

export const tmGetTopics    = (s) => tmPost("tm_getTopics", s);
export const tmGetLog       = (s) => tmPost("tm_getLog", s);
export const tmMergePreview = (s, { targetId, sourceIds, newName }) => tmPost("tm_mergePreview", s, { targetId, sourceIds, newName: newName || "" });
export const tmMerge        = (s, { targetId, sourceIds, newName }) => tmPost("tm_merge", s, { targetId, sourceIds, newName: newName || "" });
export const tmDeleteEmpty  = (s, ids) => tmPost("tm_deleteEmpty", s, { ids });
export const tmUndo         = (s) => tmPost("tm_undo", s);
