/**
 * generate-questions.mjs
 * ------------------------------------------------------------------
 * নির্দিষ্ট Subject/Sub-topic নিয়ে AI দিয়ে নতুন প্রশ্ন (MCQ/Written/Study)
 * তৈরি করে সরাসরি Firebase-এ push করে — ঠিক admin app-এর "বাল্ক আপলোড"
 * যে ফরম্যাটে রেকর্ড বানায়, সেই একই ফরম্যাটে।
 *
 * ⚠️ AI নিজের জ্ঞান থেকে প্রশ্ন বানায় (কোনো সোর্স টেক্সট ছাড়া) — তাই ভুল
 * হওয়ার সম্ভাবনা থাকে। লাইভ করার আগে Browse ট্যাবে চেক করে নেওয়া ভালো।
 * ------------------------------------------------------------------
 * প্রয়োজনীয় ENV:
 *   FIREBASE_URL, FIREBASE_SECRET   — আগের মতোই
 *   GROQ_KEYS, MISTRAL_KEYS, GEMINI_KEYS, OPENROUTER_KEYS, ...  — আগের মতোই (rotation)
 *   TARGET_SHEET      - "Quiz" | "QBank" | "Study"
 *   QUESTION_TYPE     - "MCQ" | "Written"  (Study সিটে সবসময় Study টাইপ হয়, এটা ইগনোর হবে)
 *   SUBJECT           - বিষয়ের নাম
 *   SUBTOPIC          - উপ-বিষয় (খালি রাখলে Subject-ই সাব-টপিক হবে, app-এর নিয়ম মেনে)
 *   AUDIENCE_TAGS     - কমা-দেওয়া ট্যাগ (যেমন "Masters 1,Job")
 *   COUNT             - মোট কতগুলো প্রশ্ন বানাতে হবে
 *   BATCH_SIZE        - প্রতি AI কলে কতগুলো চাইবে (ডিফল্ট 6, বেশি দিলে JSON ভাঙার ঝুঁকি বাড়ে)
 *   DELAY_MS, MAX_RUNTIME_MIN — আগের মতোই
 * ------------------------------------------------------------------
 */

const FIREBASE_URL = (process.env.FIREBASE_URL || "").replace(/\/+$/, "");
const FIREBASE_SECRET = process.env.FIREBASE_SECRET || "";
const DELAY_MS = parseInt(process.env.DELAY_MS || "1500", 10);
const MAX_RUNTIME_MS = (parseInt(process.env.MAX_RUNTIME_MIN || "330", 10)) * 60 * 1000;
const START_TIME = Date.now();

const TARGET_SHEET = (process.env.TARGET_SHEET || "Quiz").trim();
const RAW_QTYPE = (process.env.QUESTION_TYPE || "MCQ").trim();
const QUESTION_TYPE = TARGET_SHEET === "Study" ? "Study" : (RAW_QTYPE === "Written" ? "Written" : "MCQ");
const SUBJECT = (process.env.SUBJECT || "").trim();
const SUBTOPIC = (process.env.SUBTOPIC || "").trim() || SUBJECT; // app-এর নিয়ম: খালি হলে subject-ই sub_topic
const AUDIENCE_TAGS = (process.env.AUDIENCE_TAGS || "").trim();
const COUNT = Math.max(1, parseInt(process.env.COUNT || "10", 10));
const BATCH_SIZE = Math.max(1, Math.min(10, parseInt(process.env.BATCH_SIZE || "6", 10)));

if (!FIREBASE_URL || !FIREBASE_SECRET) {
  console.error("❌ FIREBASE_URL / FIREBASE_SECRET সেট করা নেই।");
  process.exit(1);
}
if (!SUBJECT) {
  console.error("❌ SUBJECT খালি — কোন বিষয়ে প্রশ্ন বানাবে বলে দাও।");
  process.exit(1);
}
if (!["Quiz", "QBank", "Study"].includes(TARGET_SHEET)) {
  console.error(`❌ TARGET_SHEET ভুল: "${TARGET_SHEET}" — Quiz/QBank/Study-এর একটা হতে হবে।`);
  process.exit(1);
}

// ══ প্রোভাইডার সংজ্ঞা (generate-explanations.mjs-এর সাথে সামঞ্জস্যপূর্ণ) ══
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

function buildPrompt(n) {
  const header = `তুমি একজন অভিজ্ঞ বাংলাদেশের Masters/BCS-স্তরের পরীক্ষা প্রশ্নকর্তা।
বিষয়: ${SUBJECT}
উপ-বিষয়: ${SUBTOPIC}
এই বিষয়ে সঠিক ও নির্ভুল তথ্যের ভিত্তিতে ${n}টি ভিন্ন ভিন্ন প্রশ্ন বাংলায় তৈরি করো (একটার সাথে আরেকটা যেন না মেলে)।`;

  if (QUESTION_TYPE === "MCQ") {
    return `${header}
প্রতিটি প্রশ্নে ৪টি অপশন থাকবে, একটাই সঠিক উত্তর। "correct_index" ফিল্ডে সঠিক অপশনের নম্বর দেবে — option1 হলে 1, option2 হলে 2, option3 হলে 3, option4 হলে 4 (এই ফিল্ডে শুধু একটা সংখ্যা 1/2/3/4, কোনো টেক্সট না)। "explanation" ৩ লাইনে সংক্ষিপ্ত হবে।
উত্তর অবশ্যই শুধুমাত্র একটা বৈধ JSON array হবে, অন্য কোনো টেক্সট/মার্কডাউন/কোড-ফেন্স ছাড়া, ঠিক এই ফরম্যাটে:
[{"question":"...","option1":"...","option2":"...","option3":"...","option4":"...","correct_index":2,"explanation":"..."}]`;
  }
  if (QUESTION_TYPE === "Written") {
    return `${header}
প্রতিটির একটা সংক্ষিপ্ত-উত্তর ধরনের প্রশ্ন ও তার উত্তর থাকবে, সাথে ২-৩ লাইনের ব্যাখ্যা।
উত্তর অবশ্যই শুধুমাত্র একটা বৈধ JSON array হবে, অন্য কোনো টেক্সট ছাড়া, ঠিক এই ফরম্যাটে:
[{"question":"...","answer":"...","explanation":"..."}]`;
  }
  // Study
  return `${header}
প্রতিটির একটা প্রশ্ন ও তার সংক্ষিপ্ত উত্তর থাকবে।
উত্তর অবশ্যই শুধুমাত্র একটা বৈধ JSON array হবে, অন্য কোনো টেক্সট ছাড়া, ঠিক এই ফরম্যাটে:
[{"question":"...","answer":"..."}]`;
}

function extractJsonArray(text) {
  let t = text.trim().replace(/^```json/i, "").replace(/^```/, "").replace(/```$/, "").trim();
  const start = t.indexOf("[");
  const end = t.lastIndexOf("]");
  if (start === -1 || end === -1 || end < start) throw new Error("JSON array পাওয়া যায়নি");
  return JSON.parse(t.slice(start, end + 1));
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
    return text;
  }
  const resp = await fetch(`${cfg.apiBase}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + cfg.key },
    body: JSON.stringify({ model: cfg.model, messages: [{ role: "user", content: prompt }], max_tokens: 2200 }),
  });
  const data = await resp.json();
  if (!resp.ok) throw new Error(`[${cfg.id}] ${data?.error?.message || `HTTP ${resp.status}`}`);
  const text = data?.choices?.[0]?.message?.content;
  if (!text) throw new Error(`[${cfg.id}] খালি উত্তর`);
  return text;
}

async function callRotating(pool, startIdx, prompt) {
  const errors = [];
  for (let i = 0; i < pool.length; i++) {
    const cfg = pool[(startIdx + i) % pool.length];
    try {
      const raw = await callProvider(cfg, prompt);
      const arr = extractJsonArray(raw);
      if (!Array.isArray(arr) || !arr.length) throw new Error("খালি/অবৈধ array");
      return { arr, usedIdx: (startIdx + i) % pool.length, providerId: cfg.id };
    } catch (e) {
      errors.push(`${e.message || e}`);
    }
  }
  throw new Error("সব key ব্যর্থ: " + errors.slice(0, 3).join(" | "));
}

function normFn(s) { return (s || "").toString().trim().toLowerCase().replace(/[.,;।]+$/, ""); }

function validateItem(item) {
  const q = (item.question || "").toString().trim();
  if (!q || q.length < 5) return { ok: false, reason: "প্রশ্ন খুব ছোট/খালি" };

  if (QUESTION_TYPE === "MCQ") {
    const o1 = (item.option1 || "").toString().trim();
    const o2 = (item.option2 || "").toString().trim();
    const o3 = (item.option3 || "").toString().trim();
    const o4 = (item.option4 || "").toString().trim();
    if (!o1 || !o2 || !o3 || !o4) return { ok: false, reason: "একটা অপশন খালি" };
    const opts = [o1, o2, o3, o4];

    // ১) correct_index (প্রাইমারি, সবচেয়ে নির্ভরযোগ্য) — ছোট মডেলও এটা মোটামুটি ঠিকঠাক দেয়
    const rawIdx = item.correct_index;
    const idxNum = parseInt(rawIdx, 10);
    if (Number.isInteger(idxNum) && idxNum >= 1 && idxNum <= 4) {
      return { ok: true, q, o1, o2, o3, o4, correct: opts[idxNum - 1], explanation: (item.explanation || "").toString().trim() };
    }

    // ২) পুরনো "correct" টেক্সট ফিল্ড — হুবহু মিল
    const correctText = (item.correct || "").toString().trim();
    if (correctText) {
      const exactIdx = opts.findIndex(o => normFn(o) === normFn(correctText));
      if (exactIdx !== -1) return { ok: true, q, o1, o2, o3, o4, correct: opts[exactIdx], explanation: (item.explanation || "").toString().trim() };

      // ৩) fuzzy fallback — substring মিল (একেবারে শেষ চেষ্টা)
      const fuzzyIdx = opts.findIndex(o => normFn(o).includes(normFn(correctText)) || normFn(correctText).includes(normFn(o)));
      if (fuzzyIdx !== -1) return { ok: true, q, o1, o2, o3, o4, correct: opts[fuzzyIdx], explanation: (item.explanation || "").toString().trim() };
    }

    return { ok: false, reason: "correct_index/correct কোনোটাই বৈধভাবে মেলেনি" };
  }
  // Written / Study
  const ans = (item.answer || item.correct || "").toString().trim();
  if (!ans) return { ok: false, reason: "উত্তর খালি" };
  return { ok: true, q, ans, explanation: (item.explanation || "").toString().trim() };
}

function buildRecord(v, ts, id) {
  const tagStr = AUDIENCE_TAGS;
  if (TARGET_SHEET === "Quiz") {
    return {
      id, question: v.q,
      option1: v.o1 || "", option2: v.o2 || "", option3: v.o3 || "", option4: v.o4 || "",
      correct: v.correct || v.ans || "",
      subject: SUBJECT, sub_topic: SUBTOPIC,
      explanation: v.explanation || "",
      "Question Type": QUESTION_TYPE,
      AudienceTags: tagStr, Timestamp: ts,
      technique: "", Previous_Exam: "",
    };
  }
  if (TARGET_SHEET === "QBank") {
    return {
      id, question: v.q,
      option1: v.o1 || "", option2: v.o2 || "", option3: v.o3 || "", option4: v.o4 || "",
      correct: v.correct || v.ans || "",
      subject: SUBJECT, sub_topic: SUBTOPIC, topic: "",
      explanation: v.explanation || "",
      "Question Type": QUESTION_TYPE,
      AudienceTags: tagStr, Timestamp: ts, technique: "",
    };
  }
  // Study
  return {
    id, question: v.q, correct: v.ans || "",
    subject: SUBJECT, sub_topic: SUBTOPIC,
    explanation: v.explanation || "",
    "Question Type": "Study",
    AudienceTags: tagStr, Timestamp: ts, technique: "",
  };
}

async function fbPush(path, data) {
  const r = await fetch(`${FIREBASE_URL}/${path}.json?auth=${FIREBASE_SECRET}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!r.ok) throw new Error(`Firebase push ব্যর্থ: HTTP ${r.status}`);
  return r.json(); // {name: pushKey}
}
async function fbSet(path, data) {
  const r = await fetch(`${FIREBASE_URL}/${path}.json?auth=${FIREBASE_SECRET}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!r.ok) throw new Error(`Firebase set ব্যর্থ: HTTP ${r.status}`);
  return r.json();
}

function nowTs() {
  return new Date().toLocaleString("bn-BD", { timeZone: "Asia/Dhaka" });
}
function sleep(ms) { return new Promise(res => setTimeout(res, ms)); }

async function main() {
  const pool = buildKeyPool();
  if (!pool.length) {
    console.error("❌ কোনো AI provider key পাওয়া যায়নি।");
    process.exit(1);
  }
  console.log(`🔑 মোট ${pool.length} টা key রেডি (providers: ${[...new Set(pool.map(p => p.id))].join(", ")})`);
  console.log(`🎯 টার্গেট: ${TARGET_SHEET} / ${QUESTION_TYPE} — বিষয়: "${SUBJECT}" / উপ-বিষয়: "${SUBTOPIC}" — মোট ${COUNT}টা প্রশ্ন`);

  let done = 0, failedItems = 0, cursor = 0;
  const maxAttempts = Math.ceil(COUNT / BATCH_SIZE) * 3 + 3; // অতিরিক্ত রিট্রাই বাফার
  let attempts = 0;

  while (done < COUNT && attempts < maxAttempts) {
    if (Date.now() - START_TIME > MAX_RUNTIME_MS) {
      console.log(`⏰ সময়সীমা শেষ (${Math.round(MAX_RUNTIME_MS / 60000)} মিনিট) — বাকিটা আবার চালাতে হবে।`);
      break;
    }
    attempts++;
    const need = Math.min(BATCH_SIZE, COUNT - done);
    const prompt = buildPrompt(need);
    try {
      const { arr, usedIdx, providerId } = await callRotating(pool, cursor, prompt);
      cursor = (usedIdx + 1) % pool.length;
      for (const raw of arr) {
        if (done >= COUNT) break;
        const v = validateItem(raw);
        if (!v.ok) { failedItems++; console.log(`⚠️ বাদ (${v.reason}): "${(raw.question || "").toString().slice(0, 50)}"`); continue; }
        try {
          const ts = nowTs();
          const res = await fbPush(TARGET_SHEET, buildRecord(v, ts, ""));
          if (res?.name) await fbSet(`${TARGET_SHEET}/${res.name}/id`, res.name);
          done++;
          console.log(`✅ [${done}/${COUNT}] (${providerId}) "${v.q.slice(0, 50)}"`);
        } catch (e) {
          failedItems++;
          console.log(`❌ Firebase push ব্যর্থ: ${e.message}`);
        }
      }
    } catch (e) {
      console.log(`❌ ব্যাচ ব্যর্থ (attempt ${attempts}): ${e.message}`);
      cursor = (cursor + 1) % pool.length;
    }
    if (done < COUNT) await sleep(DELAY_MS);
  }

  console.log(`\n🎯 শেষ — সফলভাবে যোগ হয়েছে: ${done}/${COUNT}, বাদ পড়েছে/ব্যর্থ: ${failedItems}`);
  if (done < COUNT) console.log(`ℹ️ বাকি ${COUNT - done}টা — আবার একই ফিল্টার দিয়ে Run করলে বাকিটা যোগ হবে (ডুপ্লিকেট এড়াতে count কমিয়ে চালাতে পারো)।`);
}

main().catch(e => { console.error("💥 মূল এরর:", e); process.exit(1); });
