/* ══════════ টাইপিং ট্র্যাকার — লজিক (React-মুক্ত, টেস্টযোগ্য) ══════════
   ধারণা: ডিকশনারি ছাড়াই ভুল ধরা। একটা ঘরে টাইপ থামার ৩ সেকেন্ড পর (আর ঘর ছাড়ার সময়) সেই ঘরের লেখার "ছবি" তোলা হয়।
   পরের ছবির সাথে আগেরটা শব্দ ধরে ধরে মেলানো হয়: আগের ছবির যে শব্দ বদলে গেছে/মুছে গেছে = ভুল; শেষে নতুন যোগ হওয়া শব্দ = নতুন টাইপ।
   সাথে: অক্ষর-সংখ্যা + সক্রিয় সময় (WPM-এর জন্য), আর মুছে ফেলা অক্ষর (তাৎক্ষণিক সংশোধন)।
   ভাষা: বাংলা (Unicode U+0980–09FF) / ইংরেজি (A–Z) — প্রতিটা শব্দ ও অক্ষর নিজ লিপি দিয়ে। */

export const IDLE_MS = 3000;          // এই সময় টাইপ না করলে "ছবি"
export const ACTIVE_GAP_MS = 5000;    // দুই কী-স্ট্রোকের ফাঁক এর বেশি হলে সেই সময় গণনায় ধরা হয় না
export const PASTE_MIN = 21;          // এক ইভেন্টে এর বেশি অক্ষর ঢুকলে সেটা পেস্ট — টাইপিং হিসাবে নয়

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

/* ── একটা ঘরের ট্র্যাকার ──
   sink = {typeEvt({lang,chars,ms}), delEvt({lang,chars}), words({lang,typed,wrong}), mistake({lang,wrong,right})} */
export function createBoxTracker({ sink, now = () => Date.now(), idleMs = IDLE_MS, setT = setTimeout, clearT = clearTimeout }) {
  let prev = "", snap = "", lastT = 0, timer = null, lastLang = "en";   // স্পেস/সংখ্যা/চিহ্নের নিজস্ব লিপি নেই → ঘরের সাম্প্রতিক ভাষায় ধরা হয়
  const clear = () => { if (timer) { clearT(timer); timer = null; } };
  const compare = () => {
    if (snap === prev) return;
    const r = compareWords(snap, prev);
    ["bn", "en"].forEach((l) => { if (r.typed[l] || r.wrong[l]) sink.words({ lang: l, typed: r.typed[l], wrong: r.wrong[l] }); });
    r.mistakes.forEach((m) => sink.mistake(m));
    snap = prev;
  };
  return {
    // বাইরে থেকে মান বদলালে (ড্রাফট লোড, সেভের পর খালি করা): আগের ঘরের বাকি হিসাব মিটিয়ে নতুন করে শুরু
    sync(val) { val = String(val == null ? "" : val); if (val === prev) return; clear(); compare(); prev = snap = val; lastT = 0; },
    input(val, opts = {}) {
      val = String(val == null ? "" : val);
      const t = now(), seg = segmentDiff(stripRich(prev), stripRich(val));
      if (!opts.auto) {                                               // অটো-রূপান্তর (root7 → √7) টাইপ/ডিলিট হিসাবে ধরা হয় না
        const gap = lastT && t - lastT <= ACTIVE_GAP_MS ? t - lastT : 0;
        if (seg.ins.length > 0 && seg.ins.length < PASTE_MIN) { const lang = scriptOf(seg.ins) || lastLang; lastLang = lang; sink.typeEvt({ lang, chars: seg.ins.length, ms: gap }); }
        if (seg.del.length > 0) { const lang = scriptOf(seg.del) || lastLang; sink.delEvt({ lang, chars: seg.del.length }); if (!seg.ins.length && gap) sink.typeEvt({ lang, chars: 0, ms: gap }); }
      }
      lastT = t; prev = val;
      clear(); timer = setT(() => { timer = null; compare(); }, idleMs);
    },
    blur() { clear(); compare(); },
    dispose() { clear(); compare(); },
  };
}
