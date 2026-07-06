/**
 * generate-explanations.mjs
 * ------------------------------------------------------------------
 * Firebase-এ যেসব প্রশ্নে Explanation নেই, সেগুলো AI দিয়ে বানিয়ে
 * সরাসরি Firebase-এ লিখে দেয়। GitHub Actions থেকে চলে — ফোন/অ্যাপ/নেট
 * কোনো ইউজার-ডিভাইসের উপর নির্ভর করে না।
 *
 * একাধিক AI provider key rotate করে — একটা fail/rate-limit করলে
 * পরের key এ চলে যায়, তাই কাজ থামে না।
 * ------------------------------------------------------------------
 * প্রয়োজনীয় ENV (GitHub Secrets থেকে আসবে):
 *   FIREBASE_URL     - https://yourproject-default-rtdb.firebaseio.com
 *   FIREBASE_SECRET  - legacy database secret
 *   SHEETS           - "Quiz,QBank,Study" (কমা দিয়ে আলাদা)
 *   GROQ_KEYS        - "key1,key2,key3" (কমা দিয়ে আলাদা, একাধিক দেওয়া যায়)
 *   MISTRAL_KEYS     - "key1,key2"
 *   GEMINI_KEYS      - "key1"
 *   OPENROUTER_KEYS  - "key1"
 *   CEREBRAS_KEYS, TOGETHER_KEYS, FIREWORKS_KEYS, DEEPSEEK_KEYS  - (ঐচ্ছিক, ভবিষ্যতে যুক্ত করার জন্য)
 *   DELAY_MS         - প্রতি কলের পর অপেক্ষা (ডিফল্ট 1200ms)
 *   MAX_RUNTIME_MIN  - সর্বোচ্চ কতক্ষণ চলবে এক রানে (ডিফল্ট 330 মিনিট)
 * ------------------------------------------------------------------
 */

const FIREBASE_URL = (process.env.FIREBASE_URL || "").replace(/\/+$/, "");
const FIREBASE_SECRET = process.env.FIREBASE_SECRET || "";
const SHEETS = (process.env.SHEETS || "Quiz,QBank,Study").split(",").map(s => s.trim()).filter(Boolean);
const DELAY_MS = parseInt(process.env.DELAY_MS || "1200", 10);
const MAX_RUNTIME_MS = (parseInt(process.env.MAX_RUNTIME_MIN || "330", 10)) * 60 * 1000;
const START_TIME = Date.now();

// ঐচ্ছিক ফিল্টার — কমা দিয়ে একাধিক মান দেওয়া যায় (OR ম্যাচ), খালি রাখলে সব
const parseList = v => (v || "").split(",").map(s => s.trim()).filter(Boolean);
const FILTER_AUDIENCE = parseList(process.env.FILTER_AUDIENCE);
const FILTER_SUBJECT = parseList(process.env.FILTER_SUBJECT);
const FILTER_SUBTOPIC = parseList(process.env.FILTER_SUBTOPIC);

if (!FIREBASE_URL || !FIREBASE_SECRET) {
  console.error("❌ FIREBASE_URL / FIREBASE_SECRET সেট করা নেই। GitHub Secrets চেক করো।");
  process.exit(1);
}

// ══ প্রোভাইডার সংজ্ঞা ══
// নতুন প্রোভাইডার যুক্ত করতে চাইলে এখানে একটা এন্ট্রি বাড়ালেই হবে।
const PROVIDER_DEFS = [
  { id: "groq", kind: "openai", envKey: "GROQ_KEYS", apiBase: "https://api.groq.com/openai/v1", model: "llama-3.3-70b-versatile" },
  { id: "mistral", kind: "openai", envKey: "MISTRAL_KEYS", apiBase: "https://api.mistral.ai/v1", model: "mistral-small-latest" },
  { id: "gemini", kind: "gemini", envKey: "GEMINI_KEYS", model: "gemini-2.5-flash-lite" },
  { id: "openrouter", kind: "openai", envKey: "OPENROUTER_KEYS", apiBase: "https://openrouter.ai/api/v1", model: "mistralai/mistral-7b-instruct:free" },
  { id: "cerebras", kind: "openai", envKey: "CEREBRAS_KEYS", apiBase: "https://api.cerebras.ai/v1", model: "llama3.1-8b" },
  { id: "together", kind: "openai", envKey: "TOGETHER_KEYS", apiBase: "https://api.together.xyz/v1", model: "meta-llama/Llama-3.3-70B-Instruct-Turbo-Free" },
  { id: "fireworks", kind: "openai", envKey: "FIREWORKS_KEYS", apiBase: "https://api.fireworks.ai/inference/v1", model: "accounts/fireworks/models/llama-v3p1-8b-instruct" },
  { id: "deepseek", kind: "openai", envKey: "DEEPSEEK_KEYS", apiBase: "https://api.deepseek.com/v1", model: "deepseek-chat" },
];

// সব provider-এর সব key মিলিয়ে একটা ফ্ল্যাট লিস্ট বানানো — round-robin এর জন্য
function buildKeyPool() {
  const pool = [];
  for (const def of PROVIDER_DEFS) {
    const raw = process.env[def.envKey] || "";
    const keys = raw.split(",").map(k => k.trim()).filter(Boolean);
    for (const key of keys) pool.push({ ...def, key });
  }
  return pool;
}

function buildPrompt(question, correct) {
  return `আমি একজন বাংলাদেশের ছাত্র, পরীক্ষার প্রস্তুতি নিচ্ছি।
নিচের প্রশ্নের উত্তরের ব্যাখ্যা ঠিক ৩ লাইনে, সহজ বাংলায়, সংক্ষেপে দাও। সিরিয়াল/নাম্বারিং ছাড়া, সরাসরি প্যারাগ্রাফের মতো লিখবে।

প্রশ্ন: ${question}${correct ? `\nউত্তর: ${correct}` : ""}

শুধু ব্যাখ্যাটাই লিখবে, অন্য কিছু বলবে না।`;
}

async function callProvider(cfg, question, correct) {
  const prompt = buildPrompt(question, correct);
  if (cfg.kind === "gemini") {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(cfg.model)}:generateContent`;
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": cfg.key },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(`[${cfg.id}] ${data?.error?.message || `HTTP ${resp.status}`}`);
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error(`[${cfg.id}] খালি উত্তর`);
    return text.trim();
  }
  // openai-compatible
  const resp = await fetch(`${cfg.apiBase}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + cfg.key },
    body: JSON.stringify({ model: cfg.model, messages: [{ role: "user", content: prompt }], max_tokens: 400 }),
  });
  const data = await resp.json();
  if (!resp.ok) throw new Error(`[${cfg.id}] ${data?.error?.message || `HTTP ${resp.status}`}`);
  const text = data?.choices?.[0]?.message?.content;
  if (!text) throw new Error(`[${cfg.id}] খালি উত্তর`);
  return text.trim();
}

// round-robin + fallback: pool-এর startIdx থেকে শুরু করে একটা একটা key try করবে
async function callRotating(pool, startIdx, question, correct) {
  const errors = [];
  for (let i = 0; i < pool.length; i++) {
    const cfg = pool[(startIdx + i) % pool.length];
    try {
      const text = await callProvider(cfg, question, correct);
      return { text, usedIdx: (startIdx + i) % pool.length, providerId: cfg.id };
    } catch (e) {
      errors.push(e.message || String(e));
    }
  }
  throw new Error("সব key ব্যর্থ: " + errors.slice(0, 3).join(" | "));
}

function toArr(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.map((v, i) => (v && typeof v === "object" ? { ...v, _fbKey: String(i) } : null)).filter(Boolean);
  return Object.entries(raw).map(([k, v]) => (v && typeof v === "object" ? { ...v, _fbKey: k } : null)).filter(Boolean);
}

async function fbGet(path) {
  const r = await fetch(`${FIREBASE_URL}/${path}.json?auth=${FIREBASE_SECRET}`);
  return r.json();
}
async function fbPatch(path, data) {
  const r = await fetch(`${FIREBASE_URL}/${path}.json?auth=${FIREBASE_SECRET}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!r.ok) throw new Error(`Firebase PATCH ব্যর্থ: HTTP ${r.status}`);
  return r.json();
}

function sleep(ms) { return new Promise(res => setTimeout(res, ms)); }

async function main() {
  const pool = buildKeyPool();
  if (!pool.length) {
    console.error("❌ কোনো AI provider key পাওয়া যায়নি। অন্তত একটা *_KEYS secret সেট করো।");
    process.exit(1);
  }
  console.log(`🔑 মোট ${pool.length} টা key রেডি (providers: ${[...new Set(pool.map(p => p.id))].join(", ")})`);

  // সব শীট থেকে "Explanation নেই" এমন প্রশ্ন খুঁজে বের করা (+ঐচ্ছিক ফিল্টার)
  const queue = [];
  for (const sheet of SHEETS) {
    const raw = await fbGet(sheet);
    toArr(raw).forEach(row => {
      const q = (row.Question || row.question || "").toString().trim();
      const exp = (row.Explanation || row.explanation || "").toString().trim();
      if (!q || exp) return;

      const subject = (row.Subject || row.subject || "").toString().trim();
      const subtopic = (row.Sub_topic || row.sub_topic || "").toString().trim();
      const audienceRaw = (row.AudienceTags || row.audienceTags || row.audience_tags || "").toString().trim();
      const audienceList = audienceRaw.split(",").map(a => a.trim()).filter(Boolean);

      if (FILTER_SUBJECT.length && !FILTER_SUBJECT.includes(subject)) return;
      if (FILTER_SUBTOPIC.length && !FILTER_SUBTOPIC.includes(subtopic)) return;
      if (FILTER_AUDIENCE.length && !FILTER_AUDIENCE.some(tag => audienceList.includes(tag))) return;

      queue.push({
        sheet, fbKey: row._fbKey, question: q,
        correct: (row.Correct || row.correct || "").toString().trim(),
        subject, subtopic, audience: audienceRaw,
      });
    });
  }
  if (FILTER_AUDIENCE.length || FILTER_SUBJECT.length || FILTER_SUBTOPIC.length) {
    console.log(`🔎 ফিল্টার সক্রিয় — Audience: [${FILTER_AUDIENCE.join(", ") || "সব"}], Subject: [${FILTER_SUBJECT.join(", ") || "সব"}], Sub-topic: [${FILTER_SUBTOPIC.join(", ") || "সব"}]`);
  }
  console.log(`📋 মোট ${queue.length} টা প্রশ্নে ব্যাখ্যা নেই (ফিল্টারের পর)।`);
  if (!queue.length) { console.log("✅ সব প্রশ্নে ব্যাখ্যা আছে, কোনো কাজ নেই।"); return; }

  let ok = 0, fail = 0, cursor = 0;
  for (let i = 0; i < queue.length; i++) {
    if (Date.now() - START_TIME > MAX_RUNTIME_MS) {
      console.log(`⏰ সময়সীমা শেষ (${Math.round(MAX_RUNTIME_MS / 60000)} মিনিট) — বাকি প্রশ্ন পরের রানে হবে।`);
      break;
    }
    const item = queue[i];
    const shortQ = item.question.length > 45 ? item.question.slice(0, 45) + "…" : item.question;
    try {
      const { text, usedIdx, providerId } = await callRotating(pool, cursor, item.question, item.correct);
      cursor = (usedIdx + 1) % pool.length;
      await fbPatch(`${item.sheet}/${item.fbKey}`, { Explanation: text });
      ok++;
      console.log(`✅ [${ok + fail}/${queue.length}] (${item.sheet}) ${item.subject || "-"} / ${item.subtopic || "-"} — "${shortQ}" [${providerId}]`);
    } catch (e) {
      fail++;
      console.log(`❌ [${ok + fail}/${queue.length}] স্কিপ (${item.sheet}) ${item.subject || "-"} / ${item.subtopic || "-"} — "${shortQ}": ${e.message}`);
      cursor = (cursor + 1) % pool.length;
    }
    if (i < queue.length - 1) await sleep(DELAY_MS);
  }

  console.log(`\n🎯 এই রান শেষ — সফল: ${ok}, ব্যর্থ/স্কিপ: ${fail}, বাকি: ${queue.length - ok - fail}`);
}

main().catch(e => { console.error("💥 মূল এরর:", e); process.exit(1); });
