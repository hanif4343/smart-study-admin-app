/* ══════════ টাইপিং "রান" ইঞ্জিন — একটাই ঘড়ি, সব ঘর জুড়ে (React-মুক্ত, টেস্টযোগ্য) ══════════
   আগে: প্রতিটা ঘর আলাদা হিসাব রাখত, আর দুই কী-এর ফাঁক ৫ সেকেন্ডের বেশি হলে সেই সময় পুরো বাদ যেত — তাই বই দেখার
   থামা গতিতে ধরা পড়ত না (গতি বেশি দেখাত), আর ঘর বদলালে (টেবিলের বাঁ→ডান ঘর) সময় হারাত।

   এখন: "রান" = প্রথম কী থেকে শুরু, ঘর/সারি/কার্ড যা-ই বদলাক ঘড়ি একটাই চলে। দুই কী-এর মাঝের প্রতিটা সেকেন্ড গোনা হয় —
   বই দেখা, চোখ ফেরানো, ঘর বদলানো সব। শুধু BREAK_MS (৬০ সেকেন্ড)-এর বেশি কিছু না করলে রান শেষ ধরা হয় (বিরতি; গতিতে ধরা হয় না)।
   তিনটা সংখ্যা:
     সত্যিকারের গতি  = শব্দ ÷ পুরো সময় (থামাসহ)              ← মূল সংখ্যা
     হাত চলার গতি    = শব্দ ÷ শুধু সেই সময় যখন কী-এর ফাঁক ≤ HAND_GAP_MS
     থামার %          = থামা-সময় ÷ পুরো সময়
   কী-স্ট্রোক নির্ভুলতা = ১ − (ব্যাকস্পেসে মোছা অক্ষর ÷ মোট টাইপ করা অক্ষর)। পেস্ট/সাজেশন/অটো-রূপান্তর/বানান-সাজেশন টাইপ ধরা হয় না। */

export const BREAK_MS = 60000;      // এর বেশি কিছু না করলে রান শেষ (বিরতি)
export const HAND_GAP_MS = 3000;    // দুই কী-এর ফাঁক এর মধ্যে হলে "হাত চলছিল"
export const MIN_SHOW_MS = 8000;    // এর কম সময়ের রানে গতি দেখানো হয় না (মিথ্যা বড় সংখ্যা এড়াতে)

const L2 = () => ({ bn: 0, en: 0 });

export function createTypingSession({ now = () => Date.now(), setT = setTimeout, clearT = clearTimeout, onCommit, onRun } = {}) {
  let run = null, endTimer = null, seq = 0;
  const subs = new Set();
  const emit = () => subs.forEach((f) => { try { f(); } catch {} });

  const newRun = (t) => ({ id: ++seq, startedAt: t, lastKey: t, wall: 0, active: 0, pause: 0, words: L2(), keyTyped: L2(), keyErased: L2(), boxes: {}, spell: {} });

  function finalize(endAt) {
    if (endTimer) { clearT(endTimer); endTimer = null; }
    const r = run; run = null;
    if (!r) { emit(); return null; }
    const wordsTotal = r.words.bn + r.words.en, charsTotal = r.keyTyped.bn + r.keyTyped.en;
    const rec = {
      id: r.id, startedAt: r.startedAt, endedAt: endAt == null ? r.lastKey : endAt,
      wall: r.wall, active: r.active, pause: r.pause,
      words: { ...r.words }, keyTyped: { ...r.keyTyped }, keyErased: { ...r.keyErased },
      spellErr: Object.values(r.spell).reduce((a, b) => a + b, 0),
      boxes: Object.values(r.boxes).filter((b) => b.words > 0 || b.keys > 0).map((b) => ({ label: b.label, words: Math.max(0, b.words), ms: Math.max(0, b.last - b.first), keys: b.keys })),
    };
    if (wordsTotal > 0 || charsTotal > 0) { try { onCommit && onCommit(rec); } catch {} try { onRun && onRun(rec); } catch {} }
    emit();
    return rec;
  }
  const arm = () => { if (endTimer) clearT(endTimer); endTimer = setT(() => { endTimer = null; if (run) finalize(run.lastKey); }, BREAK_MS + 500); };

  const api = {
    /* একটা আসল কী-স্ট্রোক (টাইপ বা ব্যাকস্পেস)। box = ঘরের আইডি, label = ঘরের নাম (ইতিহাসে দেখানোর জন্য) */
    key({ box, label, lang, typed = 0, erased = 0, t = now() }) {
      if (run && t - run.lastKey > BREAK_MS) finalize(run.lastKey);
      if (!run) run = newRun(t);
      else {
        const gap = Math.max(0, t - run.lastKey);
        run.wall += gap; if (gap <= HAND_GAP_MS) run.active += gap; else run.pause += gap;
        run.lastKey = t;
      }
      const l = lang === "bn" ? "bn" : "en";
      run.keyTyped[l] += typed; run.keyErased[l] += erased;
      const b = run.boxes[box] || (run.boxes[box] = { label: label || "ঘর", first: t, last: t, words: 0, keys: 0 });
      b.last = t; b.keys += typed + erased;
      arm(); emit();
    },
    /* ঘরের নিট শব্দ বদল (d>0 নতুন শব্দ, d<0 মুছে ফেলা)। শুধু আসল টাইপে ডাকা হয় */
    addWords({ box, label, lang, d }) {
      if (!d) return;
      if (!run) return;                       // key() আগে ডাকা হয় — রান না থাকলে (পেস্ট ইত্যাদি) কিছু না
      const l = lang === "bn" ? "bn" : "en";
      run.words[l] = Math.max(0, run.words[l] + d);
      const b = run.boxes[box] || (run.boxes[box] = { label: label || "ঘর", first: run.lastKey, last: run.lastKey, words: 0, keys: 0 });
      b.words += d; emit();
    },
    setSpell(box, n) { if (run) { run.spell[box] = n; } },
    /* এখনকার (চলমান) রানের জীবন্ত অবস্থা; কিছু না থাকলে null */
    live(t = now()) {
      if (!run) return null;
      const trail = Math.max(0, t - run.lastKey);
      if (trail > BREAK_MS) return null;
      const wall = run.wall + trail, hand = trail <= HAND_GAP_MS;
      const active = run.active + (hand ? trail : 0), pause = run.pause + (hand ? 0 : trail);
      const words = run.words.bn + run.words.en, typed = run.keyTyped.bn + run.keyTyped.en, erased = run.keyErased.bn + run.keyErased.en;
      return { startedAt: run.startedAt, wall, active, pause, words, wordsBn: run.words.bn, wordsEn: run.words.en,
        wpm: wall >= MIN_SHOW_MS && words > 0 ? words / (wall / 60000) : 0,
        pausePct: wall > 0 ? pause / wall : 0, keyAcc: typed > 0 ? Math.max(0, 1 - erased / typed) : null, idleMs: trail };
    },
    flush() { return run ? finalize(run.lastKey) : null; },     // এখনই রান শেষ (যেমন সাবমিটের সময়)
    subscribe(f) { subs.add(f); return () => subs.delete(f); },
  };
  return api;
}
