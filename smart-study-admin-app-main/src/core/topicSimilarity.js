/* ══════════ TOPIC SIMILARITY — কাছাকাছি নামের টপিক খুঁজে গ্রুপ করা (শুধু সাজেশন, নিজে থেকে কিছু বদলায় না) ══════════
   ধাপ: নাম "ফোল্ড" করা (স্পেস/চিহ্ন বাদ, ী→ি, ূ→ু, ণ→ন, শ/ষ→স, নুক্তা বাদ, ইংরেজি বহুবচন -s বাদ) →
        দুই ফোল্ড-নামের মিল (Levenshtein + একটা আরেকটার ভেতরে থাকলে বোনাস) → একই সাবজেক্টের মধ্যে threshold-এর উপরে গেলে এক গ্রুপ।
   ⚠️ "সাধারণ জ্ঞান" বনাম "সাধারণ বিজ্ঞান"-এর মতো আলাদা টপিকও কাছাকাছি দেখাতে পারে — তাই এটা শুধু সাজেশন, মার্জ সবসময় মানুষ কনফার্ম করে। */

export const SENSITIVITY = { high: 0.92, mid: 0.85, low: 0.75 };

function foldToken(t) {
  if (/^[a-z0-9]+$/.test(t) && t.length > 3 && /[^s]s$/.test(t)) t = t.replace(/s$/, ""); // Articles → article (Class/Glass-এর মতো ss-শেষ বাদ)
  return t
    .replace(/[\u09BC\u0981]/g, "")          // নুক্তা, চন্দ্রবিন্দু
    .replace(/\u09C0/g, "\u09BF")            // ী → ি
    .replace(/\u09C2/g, "\u09C1")            // ূ → ু
    .replace(/\u09A3/g, "\u09A8")            // ণ → ন
    .replace(/[\u09B6\u09B7]/g, "\u09B8");   // শ, ষ → স
}
export function foldTopicTokens(name) {
  const base = String(name == null ? "" : name).normalize("NFC").toLowerCase().replace(/[\u200c\u200d]/g, "").replace(/&/g, " and ");
  return base.split(/[\s\-_.,;:/\\()[\]{}'"’“”।|?!]+/).filter(Boolean).map(foldToken).filter(Boolean);
}
export function foldTopicName(name) { return foldTopicTokens(name).join(""); }

function lev(a, b) {
  const n = a.length, m = b.length; if (!n) return m; if (!m) return n;
  let prev = Array.from({ length: m + 1 }, (_, j) => j);
  for (let i = 1; i <= n; i++) {
    const cur = [i];
    for (let j = 1; j <= m; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[m];
}

export function topicSimilarity(nameA, nameB) {
  const ta = foldTopicTokens(nameA), tb = foldTopicTokens(nameB), a = ta.join(""), b = tb.join("");
  if (!a || !b) return 0;
  if (a === b) return 1;
  const L = Math.max(a.length, b.length);
  let s = 1 - lev(a, b) / L;
  // একটার সব শব্দ আরেকটার ভেতরে (পুরো-শব্দ হিসেবে) থাকলে মিল ধরা হয় — অক্ষরের ভেতরে লুকানো অংশ (Verb ⊂ Adverb) ধরা হয় না
  const [st, lt] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  if (st.length < lt.length && st.join("").length >= 4 && st.every((w) => lt.includes(w))) s = Math.max(s, 0.8); // দুর্বল সংকেত — শুধু "কম কঠোর" সেটিং-এ দেখায় (কারক ⊂ কারক ও বিভক্তি আলাদা টপিকও হতে পারে)
  return s;
}

/* topics: [{id,name,subject_id,c:{total,...}}] → গ্রুপের তালিকা (কেবল ≥২ টপিকের গ্রুপ)
   প্রতি গ্রুপ: {key, subject_id, topics:[…প্রশ্ন বেশি আগে], total, score(গ্রুপের সর্বোচ্চ জোড়ার মিল)} */
export function groupSimilarTopics(topics, { threshold = SENSITIVITY.mid, subjectId = "" } = {}) {
  const by = {};
  topics.forEach((t) => { if (!subjectId || t.subject_id === subjectId) (by[t.subject_id] = by[t.subject_id] || []).push(t); });
  const groups = [];
  Object.keys(by).forEach((sid) => {
    const ts = by[sid], parent = ts.map((_, i) => i), best = ts.map(() => 0);
    const find = (x) => (parent[x] === x ? x : (parent[x] = find(parent[x])));
    for (let i = 0; i < ts.length; i++) for (let j = i + 1; j < ts.length; j++) {
      const s = topicSimilarity(ts[i].name, ts[j].name);
      if (s >= threshold) { parent[find(i)] = find(j); best[i] = Math.max(best[i], s); best[j] = Math.max(best[j], s); }
    }
    const m = {};
    ts.forEach((t, i) => { (m[find(i)] = m[find(i)] || { items: [], score: 0 }); m[find(i)].items.push(t); m[find(i)].score = Math.max(m[find(i)].score, best[i]); });
    Object.values(m).forEach((g) => {
      if (g.items.length < 2) return;
      const items = g.items.slice().sort((a, b) => (b.c.total + b.c.study) - (a.c.total + a.c.study) || a.name.localeCompare(b.name));
      groups.push({ key: items.map((x) => x.id).sort().join("+"), subject_id: sid, topics: items, total: items.reduce((a, x) => a + x.c.total, 0), score: g.score });
    });
  });
  return groups.sort((a, b) => a.subject_id.localeCompare(b.subject_id) || b.total - a.total);
}
