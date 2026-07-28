/**
 * generate-mcq-options.mjs
 * ------------------------------------------------------------------
 * generate-explanations.mjs -এর ঠিক একই আর্কিটেকচার — Google Sheet-এ
 * (Quiz/QBank) যেসব MCQ প্রশ্নে ৪টা অপশনই ফাঁকা (Single প্রশ্ন এন্ট্রি
 * পেজে "🙈 অপশন হাইড করো" চেপে ফাঁকা রেখে সাবমিট করা প্রশ্নগুলো), সেগুলোর
 * জন্য AI দিয়ে ৪টা অপশন (৩টা distractor + সঠিক উত্তর, এলোমেলো ক্রমে) বানিয়ে
 * GAS দিয়ে সরাসরি Sheet-এ লিখে দেয়। ব্যাখ্যা ফাঁকা থাকলে সেটাও একই কলে
 * বানিয়ে লিখে দেয় (আলাদা explanation স্ক্রিপ্ট আবার না চালাতে হয়)।
 * ⚠️ সম্পূর্ণভাবে Firebase থেকে বিচ্ছিন্ন — Firebase RTDB কোনোভাবেই ছোঁয়া
 * হয় না, এবং GAS-কে কখনো sync/bulkSyncDone কল করা হয় না। শুধু Google
 * Sheet-এ পড়া-লেখা হয়।
 * ------------------------------------------------------------------
 * ⚠️ IMPORTANT — লেখার আগে যাচাই করে নাও:
 *   নিচের OPTION_FIELDS কনস্ট্যান্টে যে ৪টা field নাম আছে
 *   ("option1".."option4") — সেগুলো তোমার GAS Apps Script/Sheet-এর
 *   কলাম হেডারের সাথে হুবহু মিলতে হবে (generate-explanations.mjs-এ যেমন
 *   field:"explanation" ব্যবহার হয়েছে ঠিক সেভাবেই)। না মিললে শুধু নিচের
 *   কনস্ট্যান্ট বদলালেই হবে, বাকি কোড অপরিবর্তিত থাকবে।
 * ------------------------------------------------------------------
 * প্রয়োজনীয় ENV (GitHub Secrets থেকে আসবে) — explanation script-এর মতোই:
 *   GAS_URL, GAS_SECRET
 *   SHEETS               - "Quiz,QBank" (কমা দিয়ে আলাদা; Study-তে MCQ থাকে না তাই ডিফল্টে বাদ)
 *   GROQ_KEYS, MISTRAL_KEYS, GEMINI_KEYS, OPENROUTER_KEYS,
 *   CEREBRAS_KEYS, TOGETHER_KEYS, FIREWORKS_KEYS, DEEPSEEK_KEYS
 *   DELAY_MS, MAX_RUNTIME_MIN
 *   FILTER_AUDIENCE / FILTER_SUBJECT / FILTER_SUBTOPIC - ঐচ্ছিক ফিল্টার
 * ------------------------------------------------------------------
 */

const GAS_URL = process.env.GAS_URL || "";
const GAS_SECRET = process.env.GAS_SECRET || "";
const SHEETS = (process.env.SHEETS || "Quiz,QBank").split(",").map(s => s.trim()).filter(Boolean);
const DELAY_MS = parseInt(process.env.DELAY_MS || "1200", 10);
const MAX_RUNTIME_MS = (parseInt(process.env.MAX_RUNTIME_MIN || "330", 10)) * 60 * 1000;
const START_TIME = Date.now();

// ── Sheet-এর কলাম নাম — মিলিয়ে নাও (উপরের ⚠️ নোট দ্রষ্টব্য) ──
const OPTION_FIELDS = ["option1", "option2", "option3", "option4"];
const EXPLANATION_FIELD = "explanation";

const NONE_TAG = "__NONE__";
const parseList = v => (v || "").split(",").map(s => s.trim()).filter(Boolean);
const FILTER_AUDIENCE = parseList(process.env.FILTER_AUDIENCE);
const FILTER_SUBJECT = parseList(process.env.FILTER_SUBJECT);
const FILTER_SUBTOPIC = parseList(process.env.FILTER_SUBTOPIC);

if (!GAS_URL || !GAS_SECRET) {
  console.error("❌ GAS_URL / GAS_SECRET সেট করা নেই। GitHub Secrets চেক করো (অ্যাপের 'GAS Secret Key' এর মতোই)।");
  process.exit(1);
}

// ══ প্রোভাইডার সংজ্ঞা — generate-explanations.mjs এর সাথে হুবহু মিলিয়ে রাখা হয়েছে ══
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

// ── Single প্রশ্ন এন্ট্রি পেজের buildMcqGenPrompt-এর হুবহু কপি — একই কোয়ালিটির
//    distractor + ব্যাখ্যা যেন সবজায়গায় একইরকম আসে ──
function buildPrompt(question, correct) {
  return `তুমি একজন বাংলা MCQ প্রশ্ন-প্রণেতা।
নিচের প্রশ্ন আর তার সঠিক উত্তর দেওয়া আছে। এর জন্য:
১. আরও ৩টা যুক্তিসঙ্গত কিন্তু ভুল অপশন (distractor) বানাও — অবাস্তব/হাস্যকর না, পরীক্ষার্থীকে বিভ্রান্ত করার মতো বিশ্বাসযোগ্য হতে হবে, একই বিষয়শ্রেণির হতে হবে।
২. একটা সংক্ষিপ্ত (২-৩ বাক্যের) ব্যাখ্যা লিখো কেন এই উত্তরটাই সঠিক।
প্রশ্ন: ${question}
সঠিক উত্তর: ${correct}
শুধু নিচের বিশুদ্ধ JSON ফরম্যাটে দাও — কোনো markdown code fence (\`\`\`), কোনো ব্যাখ্যা-বহির্ভূত টেক্সট ছাড়া:
{"options":["ভুল অপশন ১","ভুল অপশন ২","ভুল অপশন ৩"],"explanation":"ব্যাখ্যা..."}`;
}

function parseGenResponse(text) {
  let t = (text || "").trim();
  t = t.replace(/^```json/i, "").replace(/^```/, "").replace(/```\s*$/, "").trim();
  const start = t.indexOf("{"), end = t.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("AI response format ঠিক নেই");
  return JSON.parse(t.slice(start, end + 1));
}

// ── Single প্রশ্ন এন্ট্রি পেজের shuffle4-এর হুবহু কপি — সঠিক উত্তর সবসময়
//    একই পজিশনে (যেমন সবসময় ক-তে) বসে না যায় সেজন্য ──
function shuffle4(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

async function callProvider(cfg, prompt) {
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
    body: JSON.stringify({ model: cfg.model, messages: [{ role: "user", content: prompt }], max_tokens: 500 }),
  });
  const data = await resp.json();
  if (!resp.ok) throw new Error(`[${cfg.id}] ${data?.error?.message || `HTTP ${resp.status}`}`);
  const text = data?.choices?.[0]?.message?.content;
  if (!text) throw new Error(`[${cfg.id}] খালি উত্তর`);
  return text.trim();
}

async function callRotating(pool, startIdx, question, correct) {
  const prompt = buildPrompt(question, correct);
  const errors = [];
  for (let i = 0; i < pool.length; i++) {
    const cfg = pool[(startIdx + i) % pool.length];
    try {
      const text = await callProvider(cfg, prompt);
      const parsed = parseGenResponse(text);
      return { parsed, usedIdx: (startIdx + i) % pool.length, providerId: cfg.id };
    } catch (e) {
      errors.push(e.message || String(e));
    }
  }
  throw new Error("সব key ব্যর্থ: " + errors.slice(0, 3).join(" | "));
}

// ── Sheet সরাসরি GAS-এর getSheetRows অ্যাকশন দিয়ে পড়া (generate-explanations.mjs-এর হুবহু কপি) ──
async function gasGetSheetRows(tab) {
  const url = `${GAS_URL}?action=getSheetRows&tab=${encodeURIComponent(tab)}&secret=${encodeURIComponent(GAS_SECRET)}`;
  const resp = await fetch(url);
  const data = await resp.json().catch(() => ({}));
  if (data?.status !== "success" || !Array.isArray(data.rows)) {
    throw new Error(`GAS getSheetRows(${tab}) ব্যর্থ: ${data?.message || "unknown error"}`);
  }
  return data.rows;
}

// ── generate-explanations.mjs-এর gasUpdateExplanation-এর মতোই, কিন্তু field নাম প্যারামিটার
//    হিসেবে নেওয়া হয় যাতে option1..option4 আর explanation — সবগুলো একই ফাংশন দিয়ে লেখা যায়
//    (GAS-এর দিক থেকে এটা type:"update_explanation" + field:<যেকোনো কলাম নাম> — জেনেরিক single-field
//    updater হিসেবে আগে থেকেই কাজ করছে, তাই GAS-এ নতুন কিছু ডিপ্লয় করতে হচ্ছে না)।
//    শুধু Google Sheet-এ লেখে — Firebase-এর সাথে কোনো সম্পর্ক নেই ──
async function gasUpdateField(sheet, id, field, content) {
  const resp = await fetch(GAS_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain" },
    body: JSON.stringify({ secret: GAS_SECRET, type: "update_explanation", sheet, id, field, content }),
  });
  return resp.text().catch(() => "");
}

function sleep(ms) { return new Promise(res => setTimeout(res, ms)); }

// ── row থেকে ফিল্ড পড়ার সময় কেস-ইনসেনসিটিভ/একাধিক সম্ভাব্য নাম চেষ্টা করা হয় (শুধু READ-এর জন্য;
//    WRITE সবসময় OPTION_FIELDS/EXPLANATION_FIELD কনস্ট্যান্ট অনুযায়ীই হবে) ──
function readField(row, ...keys) {
  for (const k of keys) {
    if (row[k] !== undefined && row[k] !== null) {
      const v = row[k].toString().trim();
      if (v) return v;
    }
  }
  return "";
}

async function main() {
  const pool = buildKeyPool();
  if (!pool.length) {
    console.error("❌ কোনো AI provider key পাওয়া যায়নি। অন্তত একটা *_KEYS secret সেট করো।");
    process.exit(1);
  }
  console.log(`🔑 মোট ${pool.length} টা key রেডি (providers: ${[...new Set(pool.map(p => p.id))].join(", ")})`);
  console.log(`🧩 Option ফিল্ড: ${OPTION_FIELDS.join(", ")} — এগুলো তোমার Sheet কলাম হেডারের সাথে না মিললে স্ক্রিপ্টের OPTION_FIELDS কনস্ট্যান্ট বদলাও।`);

  // সব শীট থেকে "MCQ কিন্তু ৪টা অপশনই ফাঁকা" এমন প্রশ্ন খুঁজে বের করা
  const queue = [];
  let partiallyFilledSkipped = 0;
  for (const sheet of SHEETS) {
    const rows = await gasGetSheetRows(sheet);
    rows.forEach(row => {
      const qtype = readField(row, "qtype", "Qtype", "QType", "Type").toUpperCase();
      if (qtype !== "MCQ") return;

      const q = readField(row, "question", "Question");
      const correct = readField(row, "correct", "Correct");
      const id = readField(row, "id", "ID", "_fbKey");
      if (!q || !correct || !id) return;

      const opts = OPTION_FIELDS.map(f => readField(row, f, f.charAt(0).toUpperCase() + f.slice(1)));
      const filledCount = opts.filter(Boolean).length;
      if (filledCount === 4) return; // আগে থেকেই সব অপশন আছে — কিছু করার নেই
      if (filledCount > 0) { partiallyFilledSkipped++; return; } // কিছু অপশন আংশিক ভরা — ডেটা নষ্ট এড়াতে স্কিপ, ম্যানুয়ালি দেখতে হবে

      const explanation = readField(row, EXPLANATION_FIELD, "Explanation");
      const subject = readField(row, "subject", "Subject");
      const subtopic = readField(row, "sub_topic", "Sub_topic", "subtopic", "Subtopic");
      const audienceRaw = readField(row, "audienceTags", "AudienceTags", "audience_tags");
      const audienceList = audienceRaw.split(",").map(a => a.trim()).filter(Boolean);

      if (FILTER_SUBJECT.length && !FILTER_SUBJECT.includes(subject)) return;
      if (FILTER_SUBTOPIC.length && !FILTER_SUBTOPIC.includes(subtopic)) return;
      if (FILTER_AUDIENCE.length) {
        const matches = FILTER_AUDIENCE.some(tag => tag === NONE_TAG ? audienceList.length === 0 : audienceList.includes(tag));
        if (!matches) return;
      }

      queue.push({ sheet, id, question: q, correct, needsExplanation: !explanation, subject, subtopic });
    });
  }
  if (FILTER_AUDIENCE.length || FILTER_SUBJECT.length || FILTER_SUBTOPIC.length) {
    console.log(`🔎 ফিল্টার সক্রিয় — Audience: [${FILTER_AUDIENCE.join(", ") || "সব"}], Subject: [${FILTER_SUBJECT.join(", ") || "সব"}], Sub-topic: [${FILTER_SUBTOPIC.join(", ") || "সব"}]`);
  }
  if (partiallyFilledSkipped > 0) {
    console.log(`⚠️ ${partiallyFilledSkipped} টা MCQ প্রশ্নে অপশন আংশিক ভরা ছিল (১-৩টা) — নিরাপত্তার জন্য স্কিপ করা হলো, এগুলো ম্যানুয়ালি চেক করো।`);
  }
  console.log(`📋 মোট ${queue.length} টা MCQ প্রশ্নে ৪টা অপশনই ফাঁকা (ফিল্টারের পর)।`);
  if (!queue.length) { console.log("✅ সব MCQ-তে অপশন আছে, কোনো কাজ নেই।"); return; }

  let ok = 0, fail = 0, cursor = 0;

  for (let i = 0; i < queue.length; i++) {
    if (Date.now() - START_TIME > MAX_RUNTIME_MS) {
      console.log(`⏰ সময়সীমা শেষ (${Math.round(MAX_RUNTIME_MS / 60000)} মিনিট) — বাকি প্রশ্ন পরের রানে হবে।`);
      break;
    }
    const item = queue[i];
    const shortQ = item.question.length > 45 ? item.question.slice(0, 45) + "…" : item.question;
    try {
      const { parsed, usedIdx, providerId } = await callRotating(pool, cursor, item.question, item.correct);
      cursor = (usedIdx + 1) % pool.length;

      const distractors = (parsed.options || []).slice(0, 3);
      while (distractors.length < 3) distractors.push("");
      const [a, b, c, d] = shuffle4([item.correct, ...distractors]);
      const values = [a, b, c, d];

      for (let f = 0; f < OPTION_FIELDS.length; f++) {
        await gasUpdateField(item.sheet, item.id, OPTION_FIELDS[f], values[f]);
      }
      if (item.needsExplanation && parsed.explanation) {
        await gasUpdateField(item.sheet, item.id, EXPLANATION_FIELD, parsed.explanation);
      }
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
