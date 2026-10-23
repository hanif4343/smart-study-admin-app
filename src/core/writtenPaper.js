/* ══════════ লিখিত প্রশ্নপত্র ভিউ — QBank Written প্রশ্নকে "পরীক্ষার খাতা"-র ছাঁচে সাজানো (শুধু দেখানো, কিছু বদলায় না) ══════════
   ইনপুট: Written প্রশ্নের রো + Exam_Appearances (কোন প্রশ্ন কোন পদ/প্রতিষ্ঠান/সালে এসেছিল)।
   আউটপুট: পরীক্ষা-ভিত্তিক পেপার → সেকশন (গ্রুপ-প্রশ্ন "০১। নির্দেশ" + ক) খ) গ)… / একক প্রশ্ন) → আইটেম।
   ফরম্যাট: table = অশুদ্ধ|শুদ্ধ-ধাঁচের দুই-কলাম টেবিল · fillblank = _শব্দ_ ফাঁকা · highlight = *শব্দ* জোর · plainqa/ডিফল্ট = প্রশ্ন = উত্তর */

const BN_DIGITS = "০১২৩৪৫৬৭৮৯";
export const toBn = (n) => String(n).replace(/\d/g, (d) => BN_DIGITS[d]);
const BN_LABELS = ["ক", "খ", "গ", "ঘ", "ঙ", "চ", "ছ", "জ", "ঝ", "ঞ", "ট", "ঠ", "ড", "ঢ", "ণ", "ত", "থ", "দ", "ধ", "ন"];
const EN_LABELS = "abcdefghijklmnopqrst".split("");
const hasBangla = (s) => /[\u0980-\u09FF]/.test(String(s || ""));
const S = (v) => String(v == null ? "" : v).trim();

/* ফিল্ডের নাম বড়/ছোট হাত ও আন্ডারস্কোর নির্বিশেষে পড়া (QType / Question Type / qtype, group_id / GroupId, sub_index / SubIndex …) —
   অ্যাপের বিভিন্ন জায়গায় একই ফিল্ড ভিন্ন নামে আসে, তাই নাম-নরমালাইজ করে খোঁজা হয়। */
const nk = (k) => String(k).toLowerCase().replace(/[^a-z0-9]/g, "");
const _idx = new WeakMap();
function field(q, ...names) {
  if (!q || typeof q !== "object") return "";
  let m = _idx.get(q);
  if (!m) { m = {}; for (const k of Object.keys(q)) { const n = nk(k); if (m[n] === undefined || (m[n] === "" && q[k] != null && q[k] !== "")) m[n] = q[k]; } _idx.set(q, m); }
  for (const n of names) { const v = m[nk(n)]; if (v != null && String(v).trim() !== "") return v; }
  return "";
}
export const qid = (q) => S(field(q, "id", "ID", "qid"));
export const qText = (q) => S(field(q, "Question"));
export const qAns = (q) => S(field(q, "Correct", "answer"));
export const qExp = (q) => S(field(q, "Explanation"));
export const qType = (q) => S(field(q, "Question Type", "QType", "qtype")).toLowerCase();
export const qFmt = (q) => S(field(q, "formatstyle", "format_style")).toLowerCase();
export const qGroup = (q) => S(field(q, "group_id", "groupId"));
export const qHeading = (q) => S(field(q, "group_heading", "groupHeading"));
export const qSubIdx = (q) => Number(field(q, "sub_index", "subIndex")) || 0;
export const qSubject = (q) => S(field(q, "Subject"));
const idNum = (id) => { const m = String(id).match(/(\d+)$/); return m ? Number(m[1]) : 0; };

export const isWrittenQ = (q) => qType(q) === "written";

/* *শব্দ* → জোর (বোল্ড+আন্ডারলাইন); _শব্দ_ → ফাঁকা (fillblank-এ) */
export function renderStyled(text, fmt) {
  let t = String(text || "");
  if (fmt === "fillblank") t = t.replace(/_([^_]+)_/g, "<u>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</u>");
  t = t.replace(/\*([^*]+)\*/g, "<b><u>$1</u></b>");
  return t;
}

/* টেবিলের কলাম-শিরোনাম: বানান-ধরনের হলে অশুদ্ধ/শুদ্ধ, নইলে প্রশ্ন/উত্তর */
export function tableHeads(heading) {
  return /বানান|ভুল|অশুদ্ধ|শুদ্ধ/.test(heading || "") ? ["অশুদ্ধ", "শুদ্ধ"] : ["প্রশ্ন", "উত্তর"];
}

function buildSections(qs) {
  const sorted = qs.slice().sort((a, b) => idNum(qid(a)) - idNum(qid(b)));
  const order = [], byGroup = {};
  sorted.forEach((q) => {
    const g = qGroup(q);
    if (!g) { order.push({ single: q }); return; }
    if (!byGroup[g]) { byGroup[g] = { gid: g, items: [] }; order.push({ group: byGroup[g] }); }
    byGroup[g].items.push(q);
  });
  const sections = []; let n = 0;
  order.forEach((o) => {
    n++;
    if (o.single) {
      const q = o.single;
      sections.push({ num: n, type: "single", heading: "", subject: qSubject(q), fmt: qFmt(q), items: [{ id: qid(q), q: qText(q), a: qAns(q), exp: qExp(q), label: "" }] });
      return;
    }
    const items = o.group.items.slice().sort((a, b) => qSubIdx(a) - qSubIdx(b) || idNum(qid(a)) - idNum(qid(b)));
    const first = items[0], heading = qHeading(first), fmt = qFmt(first) || "";
    const labels = hasBangla(heading || qText(first)) ? BN_LABELS : EN_LABELS, suffix = labels === BN_LABELS ? ")" : ")";
    sections.push({
      num: n, type: "group", heading, subject: qSubject(first), fmt,
      items: items.map((q, i) => ({ id: qid(q), q: qText(q), a: qAns(q), exp: qExp(q), label: (labels[i] || String(i + 1)) + suffix })),
    });
  });
  return sections;
}

/* questions: শুধু Written রো  ·  appearances: [{question_id, post_id, institution_id, year}] */
export function buildPapers({ questions, appearances, postNameOf = {}, instNameOf = {} }) {
  const byQ = {};
  (appearances || []).forEach((a) => { (byQ[S(a.question_id)] = byQ[S(a.question_id)] || []).push(a); });
  const papers = {};
  questions.forEach((q) => {
    const apps = byQ[qid(q)] && byQ[qid(q)].length ? byQ[qid(q)] : [{ post_id: "", institution_id: "", year: "" }];
    apps.forEach((a) => {
      const key = [S(a.post_id), S(a.institution_id), S(a.year)].join("|");
      (papers[key] = papers[key] || { key, post_id: S(a.post_id), inst_id: S(a.institution_id), year: S(a.year), qs: [] }).qs.push(q);
    });
  });
  const list = Object.values(papers).map((p) => {
    const sections = buildSections(p.qs);
    return { key: p.key, postName: p.post_id ? (postNameOf[p.post_id] || p.post_id) : "", instName: p.inst_id ? (instNameOf[p.inst_id] || p.inst_id) : "", year: p.year, unknown: !p.post_id && !p.inst_id && !p.year,
             qCount: p.qs.length, sections };
  });
  // সাল নতুন আগে, তারপর প্রতিষ্ঠান; "অজানা" সবার শেষে
  return list.sort((a, b) => (a.unknown - b.unknown) || String(b.year).localeCompare(String(a.year)) || a.instName.localeCompare(b.instName));
}
