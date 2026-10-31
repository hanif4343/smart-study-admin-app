/* ══════════ টাইপিং ট্র্যাকার — লজিক (React-মুক্ত, টেস্টযোগ্য) ══════════
   ধারণা: ডিকশনারি ছাড়াই ভুল ধরা। একটা ঘরে টাইপ থামার ৩ সেকেন্ড পর (আর ঘর ছাড়ার সময়) সেই ঘরের লেখার "ছবি" তোলা হয়।
   পরের ছবির সাথে আগেরটা শব্দ ধরে ধরে মেলানো হয়: আগের ছবির যে শব্দ বদলে গেছে/মুছে গেছে = ভুল; শেষে নতুন যোগ হওয়া শব্দ = নতুন টাইপ।
   সাথে: কী-স্ট্রোক (টাইপ/মোছা — typingSession-এ যায়, সেখানে একটাই ঘড়ি) আর নিট শব্দ-সংখ্যা।
   🆕 মাঝ-শব্দে থামার মিথ্যা-ভুল: ৩ সেকেন্ড থামলে শুধু সম্পূর্ণ শব্দগুলোর (শেষে স্পেস/চিহ্ন আছে এমন) "ছবি" তোলা হয় — যে শব্দ এখনো লেখা চলছে সেটা
   ঘর ছাড়ার সময় ধরা হয়। (বই দেখতে গিয়ে "boo…" থেমে পরে "book" হলে আগে ভুল গোনা হতো।)
   ভাষা: বাংলা (Unicode U+0980–09FF) / ইংরেজি (A–Z) — প্রতিটা শব্দ ও অক্ষর নিজ লিপি দিয়ে। */

export const IDLE_MS = 3000;          // এই সময় টাইপ না করলে "ছবি"
export const PASTE_MIN = 21;          // এক ইভেন্টে এর বেশি অক্ষর ঢুকলে সেটা পেস্ট — টাইপিং হিসাবে নয়
export const SUGGEST_MIN = 5;         // এক ইভেন্টে এতগুলো বা বেশি অক্ষর একসাথে ঢুকলে = কীবোর্ডের সাজেশন/অটোকারেক্ট — টাইপ ধরা হয় না
// সময়ের হিসাব এখন typingSession.js-এ (একটাই "রান"-ঘড়ি, থামাসহ) — এই ফাইল শুধু অক্ষর/শব্দ ধরা ও ভুল গোনা।
const REPLACE_TYPES = /^(insertFromPaste|insertFromPasteAsQuotation|insertFromDrop|insertFromYank|insertReplacementText|insertTranspose|insertLink)$/;
const DELETE_TYPE = /^delete/;

export const stripRich = (s) => String(s == null ? "" : s).replace(/<br\s*\/?>/gi, " ").replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").replace(/[\n\r]+/g, " ");
const EDGE = /^[\s.,;:!?'"“”‘’()[\]{}<>।|\-–—_*/\\]+|[\s.,;:!?'"“”‘’()[\]{}<>।|\-–—_*/\\]+$/g;
export const wordsOf = (text) => stripRich(text).split(/\s+/).map((w) => w.replace(EDGE, "")).filter((w) => /[A-Za-z\u0980-\u09E5\u09F0-\u09FF]/.test(w));

export function scriptOf(s) {
  let bn = 0, en = 0;
  for (const ch of String(s)) { if (/[\u0980-\u09E5\u09F0-\u09FF]/.test(ch)) bn++;   // বাংলা অক্ষর (বাংলা সংখ্যা ০–৯ বাদ)
    else if (/[A-Za-z]/.test(ch)) en++; }
  return bn === 0 && en === 0 ? null : bn >= en ? "bn" : "en";
}

/* দুই লেখার মধ্যে কী ঢুকেছে/বেরিয়েছে (সাধারণ prefix/suffix) */
export function segmentDiff(prev, next) {
  let p = 0; const m = Math.min(prev.length, next.length);
  while (p < m && prev[p] === next[p]) p++;
  let s = 0;
  while (s < m - p && prev[prev.length - 1 - s] === next[next.length - 1 - s]) s++;
  return { ins: next.slice(p, next.length - s), del: prev.slice(p, prev.length - s) };
}

/* শব্দ-তালিকা A → B: না-মেলা অংশগুলো (hunk) */
function hunks(A, B) {
  const n = A.length, m = B.length, dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out = []; let i = 0, j = 0, cur = null;
  const flush = (last) => { if (cur) { cur.atEnd = last; out.push(cur); cur = null; } };
  while (i < n || j < m) {
    if (i < n && j < m && A[i] === B[j]) { flush(false); i++; j++; continue; }
    cur = cur || { r: [], a: [] };
    if (j >= m || (i < n && dp[i + 1][j] >= dp[i][j + 1])) cur.r.push(A[i++]); else cur.a.push(B[j++]);
  }
  flush(true);
  return out;
}

/* আগের ছবি vs এখনকার লেখা → {typed:{bn,en}, wrong:{bn,en}, mistakes:[{lang,wrong,right}]} */
export function compareWords(prevText, nextText) {
  const A = wordsOf(prevText), B = wordsOf(nextText), res = { typed: { bn: 0, en: 0 }, wrong: { bn: 0, en: 0 }, mistakes: [] };
  const L = (w) => scriptOf(w) || "en";
  hunks(A, B).forEach((h) => {
    const r = h.r.length, a = h.a.length, pairs = Math.min(r, a);
    for (let k = 0; k < pairs; k++) { res.wrong[L(h.r[k])]++; if (r === 1 && a === 1) res.mistakes.push({ lang: L(h.r[k]), wrong: h.r[k], right: h.a[k] }); }
    for (let k = pairs; k < r; k++) { res.wrong[L(h.r[k])]++; if (a === 0 && r === 1) res.mistakes.push({ lang: L(h.r[k]), wrong: h.r[k], right: "" }); }   // বাড়তি শব্দ মোছা
    for (let k = pairs; k < a; k++) {
      res.typed[L(h.a[k])]++;                                                         // নতুন টাইপ করা শব্দ
      if (r === 0 && !h.atEnd) { res.wrong[L(h.a[k])]++; if (a === 1) res.mistakes.push({ lang: L(h.a[k]), wrong: "", right: h.a[k] }); }   // মাঝখানে বাদ-পড়া শব্দ বসানো
    }
  });
  return res;
}

/* সম্পূর্ণ শব্দগুলো (শেষে স্পেস/চিহ্ন থাকলে সবই; না থাকলে শেষ অসম্পূর্ণ শব্দ বাদে) */
export function completedText(s) {
  s = stripRich(s); if (!s) return "";
  if (/[\s.,;:!?।)\]"'”’]$/.test(s)) return s;
  const i = Math.max(s.lastIndexOf(" "), s.lastIndexOf("\u00a0"));
  return i < 0 ? "" : s.slice(0, i + 1);
}
const countByLang = (text) => { const o = { bn: 0, en: 0 }; wordsOf(text).forEach((w) => { o[scriptOf(w) || "en"]++; }); return o; };
let boxSeq = 0;

/* ── একটা ঘরের ট্র্যাকার ──
   sink = {words({lang,typed,wrong}), mistake({lang,wrong,right})}  — শব্দ-সংশোধনের হার (দৈনিক জমা)
   session = typingSession (একটাই ঘড়ি, সব ঘর জুড়ে) — key()/addWords()/setSpell()
   input(নতুনমান, {auto, excluded, inputType, composing}): auto/excluded = এই বদল টাইপ নয় (অটো-রূপান্তর, বানান-সাজেশন, পেস্ট...) */
export function createBoxTracker({ sink, session, label = "ঘর", spellCount, now = () => Date.now(), idleMs = IDLE_MS, setT = setTimeout, clearT = clearTimeout }) {
  const box = "b" + (++boxSeq);
  let prev = "", snap = "", timer = null, lastLang = "en";   // স্পেস/সংখ্যা/চিহ্নের নিজস্ব লিপি নেই → ঘরের সাম্প্রতিক ভাষায় ধরা হয়
  let typedSince = 0, erasedSince = 0;                       // sync-এর পর এই ঘরে নিজে কত অক্ষর টাইপ/মুছেছি (লোড-করা লেখা মুছলে "ভুল" গোনা হবে না)
  const ex = { bn: 0, en: 0 };                               // বাদ-দেওয়া (সাজেশন/পেস্ট) ঢোকানো শব্দ — পরে মুছলে টাইপ-করা শব্দ থেকে কমানো হয় না
  const clear = () => { if (timer) { clearT(timer); timer = null; } };
  const compare = (full) => {
    const cur = full ? stripRich(prev) : completedText(prev);
    if (snap === cur) return;
    const r = compareWords(snap, cur);
    ["bn", "en"].forEach((l) => { if (r.typed[l] || r.wrong[l]) sink.words({ lang: l, typed: r.typed[l], wrong: r.wrong[l] }); });
    r.mistakes.forEach((m) => sink.mistake(m));
    snap = cur;
    if (session && spellCount) { try { session.setSpell(box, spellCount(cur)); } catch {} }
  };
  return {
    id: box,
    // বাইরে থেকে মান বদলালে (ড্রাফট লোড, সেভের পর খালি করা): আগের ঘরের বাকি হিসাব মিটিয়ে নতুন করে শুরু
    sync(val) { val = String(val == null ? "" : val); if (val === prev) return; clear(); compare(true); prev = val; snap = stripRich(val); typedSince = erasedSince = 0; ex.bn = ex.en = 0; },
    input(val, opts = {}) {
      val = String(val == null ? "" : val);
      const t = now(), pv = stripRich(prev), nv = stripRich(val), seg = segmentDiff(pv, nv), it = opts.inputType || "";
      const isDel = DELETE_TYPE.test(it) || (!it && seg.ins.length === 0 && seg.del.length > 0);
      const gx = (typeof globalThis !== "undefined" && globalThis.__ssTypingExcludeUntil) || 0;      // বানান-সাজেশনে ক্লিক করে শুধরানো (spellDom সেট করে)
      const excluded = !!(opts.auto || opts.excluded || REPLACE_TYPES.test(it) || gx > t || seg.ins.length >= PASTE_MIN || seg.ins.length >= SUGGEST_MIN);
      // শব্দ-সংখ্যার নিট বদল (ভাষা অনুযায়ী)
      const a = countByLang(pv), b = countByLang(nv), dW = { bn: b.bn - a.bn, en: b.en - a.en };
      if (!excluded) {
        const lang = scriptOf(seg.ins || seg.del) || lastLang;
        const typedN = seg.ins.length;
        const erasedN = isDel ? Math.max(0, Math.min(seg.del.length, typedSince - erasedSince)) : 0;
        if (typedN > 0 || erasedN > 0) {
          lastLang = lang; typedSince += typedN; erasedSince += erasedN;
          session && session.key({ box, label, lang, typed: typedN, erased: erasedN, t });
          ["bn", "en"].forEach((l) => {
            let d = dW[l];
            if (d < 0 && ex[l] > 0) { const use = Math.min(ex[l], -d); ex[l] -= use; d += use; }
            if (d) session && session.addWords({ box, label, lang: l, d });
          });
        }
      } else {
        ["bn", "en"].forEach((l) => { if (dW[l] > 0) ex[l] += dW[l]; });
      }
      prev = val;
      clear(); timer = setT(() => { timer = null; compare(false); }, idleMs);
    },
    blur() { clear(); compare(true); },
    dispose() { clear(); compare(true); },
  };
}
