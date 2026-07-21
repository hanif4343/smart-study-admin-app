/**
 * generate-explanations.mjs
 * ------------------------------------------------------------------
 * Google Sheet-এ (Quiz/QBank/Study) যেসব প্রশ্নে Explanation ফাঁকা,
 * সেগুলো AI দিয়ে বানিয়ে GAS দিয়ে সরাসরি Sheet-এ লিখে দেয়, শেষে একবারে
 * Firebase sync করে। ⚠️ ২০২৬-০৭-২১ থেকে এই স্ক্রিপ্ট Firebase RTDB
 * সরাসরি ছোঁয় না (আগে fbGet/fbPatch ব্যবহার হতো, যেটা প্রতিবার পুরো
 * ডেটাবেজ ডাউনলোড করে RTDB no-cost limit শেষ করে দিচ্ছিল)। এখন সবকিছু
 * GAS-এর মধ্যে দিয়ে যায় (qbank-to-quiz.mjs যেভাবে করে ঠিক সেভাবেই),
 * আর Sheet-এ লেখার সময় bulkMode:true পাঠিয়ে প্রতি row-এ Firebase sync
 * স্কিপ করা হয় — শেষে একবার bulkSyncDone কল করে সব sync হয়।
 * ------------------------------------------------------------------
 * প্রয়োজনীয় ENV (GitHub Secrets থেকে আসবে):
 *   GAS_URL, GAS_SECRET  - qbank-to-quiz.mjs-এর মতোই (VITE_GAS_URL / GAS_SECRET)
 *   SHEETS               - "Quiz,QBank,Study" (কমা দিয়ে আলাদা)
 *   GROQ_KEYS, MISTRAL_KEYS, GEMINI_KEYS, OPENROUTER_KEYS,
 *   CEREBRAS_KEYS, TOGETHER_KEYS, FIREWORKS_KEYS, DEEPSEEK_KEYS  - AI provider key pool
 *   SYNC_EVERY       - কত টা সফল আপডেটের পর মাঝপথে একবার Firebase sync করবে (ডিফল্ট 300)
 *   DELAY_MS         - প্রতি কলের পর অপেক্ষা (ডিফল্ট 1200ms)
 *   MAX_RUNTIME_MIN  - সর্বোচ্চ কতক্ষণ চলবে এক রানে (ডিফল্ট 330 মিনিট)
 *   FILTER_AUDIENCE / FILTER_SUBJECT / FILTER_SUBTOPIC - ঐচ্ছিক ফিল্টার
 * ------------------------------------------------------------------
 */

const GAS_URL = process.env.GAS_URL || "";
const GAS_SECRET = process.env.GAS_SECRET || "";
const SHEETS = (process.env.SHEETS || "Quiz,QBank,Study").split(",").map(s => s.trim()).filter(Boolean);
const SYNC_EVERY = parseInt(process.env.SYNC_EVERY || "300", 10);
const DELAY_MS = parseInt(process.env.DELAY_MS || "1200", 10);
const MAX_RUNTIME_MS = (parseInt(process.env.MAX_RUNTIME_MIN || "330", 10)) * 60 * 1000;
const START_TIME = Date.now();

const NONE_TAG = "__NONE__";
const parseList = v => (v || "").split(",").map(s => s.trim()).filter(Boolean);
const FILTER_AUDIENCE = parseList(process.env.FILTER_AUDIENCE);
const FILTER_SUBJECT = parseList(process.env.FILTER_SUBJECT);
const FILTER_SUBTOPIC = parseList(process.env.FILTER_SUBTOPIC);

if (!GAS_URL || !GAS_SECRET) {
  console.error("❌ GAS_URL / GAS_SECRET সেট করা নেই। GitHub Secrets চেক করো (অ্যাপের 'GAS Secret Key' এর মতোই)।");
  process.exit(1);
}

// ══ প্রোভাইডার সংজ্ঞা — qbank-to-quiz.mjs এর সাথে হুবহু মিলিয়ে রাখা হয়েছে ══
const PROVIDER_DEFS = [
  { id: "groq", kind: "openai", envKey: "GROQ_KEYS", apiBase: "https://api.groq.com/openai/v1", model: "llama-3.3-70b-versatile" },
  { id: "mistral", kind: "openai", envKey: "MISTRAL_KEYS", apiBase: "https://api.mistral.ai/v1", model: "mistral-small-latest" },
  { id: "gemini", kind: "gemini", envKey: "GEMINI_KEYS", model: "gemini-2.5-flash-lite" },
  { id: "openrouter", kind: "openai", envKey: "OPENROUTER_KEYS", apiBase: "https://openrouter.ai/api/v1", model: "mistralai/mistral-7b-instruct:free" },
  { id: "cerebras", kind: "openai", envKey: "CEREBRAS_KEYS", apiBase: "https://api.cerebras.ai/v1", model: "gpt-oss-120b" },
  { id: "together", kind: "openai", envKey: "TOGETHER_KEYS", apiBase: "https://api.together.xyz/v1", model: "meta-llama/Llama-3.3-70B-Instruct-Turbo-Free" },
  { id: "fireworks", kind: "openai", envKey: "FIREWORKS_KEYS", apiBase: "https://api.fireworks.ai/inference/v1", model: "accounts/fireworks/models/llama-v3p3-70b-instruct" },
  { id: "deepseek", kind: "openai", envKey: "DEEPSEEK_KEYS", apiBase: "https://api.deepseek.com", model: "deepseek-v4-flash" },
];

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

// ── Sheet সরাসরি GAS-এর getSheetRows অ্যাকশন দিয়ে পড়া (qbank-to-quiz.mjs-এর হুবহু কপি) —
//    Firebase একদম ছোঁয় না, তাই RTDB quota খরচ হয় না ──
async function gasGetSheetRows(tab) {
  const url = `${GAS_URL}?action=getSheetRows&tab=${encodeURIComponent(tab)}&secret=${encodeURIComponent(GAS_SECRET)}`;
  const resp = await fetch(url);
  const data = await resp.json().catch(() => ({}));
  if (data?.status !== "success" || !Array.isArray(data.rows)) {
    throw new Error(`GAS getSheetRows(${tab}) ব্যর্থ: ${data?.message || "unknown error"}`);
  }
  return data.rows;
}

// ── একটা row-এর Explanation ফিল্ড আপডেট — bulkMode:true মানে GAS এই কলে
//    Firebase sync করবে না, শুধু Sheet-এ লিখবে (sync পরে একবারে হবে) ──
async function gasUpdateExplanation(sheet, id, content, bulkMode) {
  const resp = await fetch(GAS_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain" },
    body: JSON.stringify({ secret: GAS_SECRET, type: "update_explanation", sheet, id, field: "explanation", content, bulkMode: !!bulkMode }),
  });
  return resp.text().catch(() => "");
}

// ── জমে থাকা sync-প্রয়োজন sheet গুলোকে একবারে Firebase-এ sync করা ──
async function gasSyncTabs(tabs) {
  if (!tabs.length) return;
  await fetch(GAS_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain" },
    body: JSON.stringify({ secret: GAS_SECRET, type: "bulkSyncDone", tabs: tabs.join(",") }),
  });
  console.log(`🔄 Firebase sync হলো: ${tabs.join(", ")}`);
}

function sleep(ms) { return new Promise(res => setTimeout(res, ms)); }

async function main() {
  const pool = buildKeyPool();
  if (!pool.length) {
    console.error("❌ কোনো AI provider key পাওয়া যায়নি। অন্তত একটা *_KEYS secret সেট করো।");
    process.exit(1);
  }
  console.log(`🔑 মোট ${pool.length} টা key রেডি (providers: ${[...new Set(pool.map(p => p.id))].join(", ")})`);

  // সব শীট থেকে "Explanation নেই" এমন প্রশ্ন খুঁজে বের করা (Sheet থেকে, GAS দিয়ে — Firebase না)
  const queue = [];
  for (const sheet of SHEETS) {
    const rows = await gasGetSheetRows(sheet);
    rows.forEach(row => {
      const q = (row.question || row.Question || "").toString().trim();
      const exp = (row.explanation || row.Explanation || "").toString().trim();
      const id = (row.id || row.ID || row._fbKey || "").toString().trim();
      if (!q || exp || !id) return;

      const subject = (row.subject || row.Subject || "").toString().trim();
      const subtopic = (row.sub_topic || row.Sub_topic || "").toString().trim();
      const audienceRaw = (row.audienceTags || row.AudienceTags || row.audience_tags || "").toString().trim();
      const audienceList = audienceRaw.split(",").map(a => a.trim()).filter(Boolean);

      if (FILTER_SUBJECT.length && !FILTER_SUBJECT.includes(subject)) return;
      if (FILTER_SUBTOPIC.length && !FILTER_SUBTOPIC.includes(subtopic)) return;
      if (FILTER_AUDIENCE.length) {
        const matches = FILTER_AUDIENCE.some(tag => tag === NONE_TAG ? audienceList.length === 0 : audienceList.includes(tag));
        if (!matches) return;
      }

      queue.push({
        sheet, id, question: q,
        correct: (row.correct || row.Correct || "").toString().trim(),
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
  let sinceLastSync = 0;
  const touchedSheets = new Set();

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
      await gasUpdateExplanation(item.sheet, item.id, text, true); // bulkMode: এই কলে sync হবে না
      touchedSheets.add(item.sheet);
      ok++; sinceLastSync++;
      console.log(`✅ [${ok + fail}/${queue.length}] (${item.sheet}) ${item.subject || "-"} / ${item.subtopic || "-"} — "${shortQ}" [${providerId}]`);
    } catch (e) {
      fail++;
      console.log(`❌ [${ok + fail}/${queue.length}] স্কিপ (${item.sheet}) ${item.subject || "-"} / ${item.subtopic || "-"} — "${shortQ}": ${e.message}`);
      cursor = (cursor + 1) % pool.length;
    }
    // মাঝপথে মাঝেমধ্যে sync — পুরো রান শেষ হওয়ার আগেই process বন্ধ হয়ে গেলেও যেন বেশিরভাগ কাজ Firebase-এ পৌঁছায়
    if (sinceLastSync >= SYNC_EVERY) {
      await gasSyncTabs([...touchedSheets]);
      sinceLastSync = 0;
    }
    if (i < queue.length - 1) await sleep(DELAY_MS);
  }

  // শেষে একবার — বাকি থাকা সব পরিবর্তন sync
  await gasSyncTabs([...touchedSheets]);

  console.log(`\n🎯 এই রান শেষ — সফল: ${ok}, ব্যর্থ/স্কিপ: ${fail}, বাকি: ${queue.length - ok - fail}`);
}

main().catch(e => { console.error("💥 মূল এরর:", e); process.exit(1); });
