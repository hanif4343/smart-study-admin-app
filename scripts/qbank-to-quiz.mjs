/**
 * qbank-to-quiz.mjs
 * ------------------------------------------------------------------
 * QBank-এ আছে কিন্তু Quiz-এ এখনো নেই এমন প্রশ্নগুলো খুঁজে বের করে, AI দিয়ে
 * Quiz ফরম্যাটে কনভার্ট করে, GAS-এর bulk_save_rows endpoint দিয়ে সরাসরি
 * Google Sheet-এ (+ শেষে একবার Firebase sync) লিখে দেয়।
 * GitHub Actions থেকে চলে — ফোন/অ্যাপ/ইউজার ইনপুট কোনোটার উপরই নির্ভর করে না।
 * অ্যাপের "AI দিয়ে কনভার্ট করো" ফিচারের মতোই dedup + prompt লজিক ব্যবহার করে,
 * তাই একই প্রশ্ন বারবার AI-তে পাঠানো হবে না।
 * ------------------------------------------------------------------
 * প্রয়োজনীয় ENV (GitHub Secrets থেকে আসবে):
 *   GAS_URL, GAS_SECRET             - QBank/Quiz পড়তে (getSheetRows) আর Quiz-এ লিখতে (bulk_save_rows),
 *                                      দুটোই সরাসরি Google Sheet ছুঁয়ে — Firebase লাগে না এখানে আর
 *   GROQ_KEYS, MISTRAL_KEYS, GEMINI_KEYS, OPENROUTER_KEYS,
 *   CEREBRAS_KEYS, TOGETHER_KEYS, FIREWORKS_KEYS, DEEPSEEK_KEYS  - AI provider key pool
 *   BATCH_SIZE       - AI-কে একবারে কতগুলো প্রশ্ন পাঠানো হবে (ডিফল্ট 15)
 *   SAVE_CHUNK_SIZE  - GAS-এ একবারে কতগুলো রো পাঠানো হবে (ডিফল্ট 50)
 *   DELAY_MS         - প্রতি AI কলের পর অপেক্ষা (ডিফল্ট 1200ms)
 *   MAX_RUNTIME_MIN  - সর্বোচ্চ কতক্ষণ চলবে এক রানে (ডিফল্ট 330)
 *   FILTER_AUDIENCE / FILTER_SUBJECT / FILTER_SUBTOPIC - ঐচ্ছিক ফিল্টার (কমা-আলাদা, খালি=সব)
 *   TAXONOMY_JSON    - ঐচ্ছিক, অ্যাপের "Canonical Taxonomy" টেক্সটবক্সে যা আছে হুবহু পেস্ট করে
 *                       একটা GitHub Secret বানালে সেটা ব্যবহার হবে; না দিলে নিচের ডিফল্ট ব্যবহার হয়।
 *                       ⚠️ অ্যাপে taxonomy বদলালে (localStorage-এ সেভ হয়) এখানেও ম্যানুয়ালি
 *                          আপডেট করতে হবে — এই দুইটা এখন আলাদা জায়গায় থাকে, অটো-সিঙ্ক না।
 * ------------------------------------------------------------------
 */

const GAS_URL = process.env.GAS_URL || "";
const GAS_SECRET = process.env.GAS_SECRET || "";
const BATCH_SIZE = parseInt(process.env.BATCH_SIZE || "15", 10);
const SAVE_CHUNK_SIZE = parseInt(process.env.SAVE_CHUNK_SIZE || "50", 10);
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

// ── অ্যাপের QBANK_CONV_TAXONOMY_DEFAULT-এর হুবহু কপি (src/App.jsx দেখো) ──
const TAXONOMY_DEFAULT = {
  "✍️ বাংলা ব্যাকরণ": ["কারক","সমাস","সন্ধি","উপসর্গ","বাগধারা","এক কথায় প্রকাশ","প্রকৃতি ও প্রত্যয়","ধ্বনি পরিবর্তন","বাক্যের ধরণ","বানান শুদ্ধিকরণ","যতিচিহ্ন","বিপরীত শব্দ","সমার্থক শব্দ","পরিভাষা","বাক্য","ধ্বনি"],
  "📖 English Grammar": ["Verb","Article","Preposition","Tense","Voice","Narration","Number & Gender","Synonym-Antonym","Sentence Correction","Translation"],
  "🇧🇩 বাংলাদেশ বিষয়াবলি": ["মুক্তিযুদ্ধ","সংবিধান","ভূগোল ও পরিবেশ","অর্থনীতি","ইতিহাস ও ঐতিহ্য","প্রশাসনিক কাঠামো","সাধারণ জ্ঞান"],
  "🌍 আন্তর্জাতিক": ["আন্তর্জাতিক সংস্থা","বিশ্ব ইতিহাস","বিশ্ব ভূগোল","চুক্তি ও সম্মেলন"],
  "\u200b📚 বাংলা সাহিত্য": ["কাজী নজরুল ইসলাম","রবীন্দ্রনাথ ঠাকুর","অন্যান্য সাহিত্যিক","সাহিত্যকর্ম"],
  "📟 পাটিগণিত": ["গড়","শতকরা","সুদকষা","লাভ-ক্ষতি","অনুপাত-সমানুপাত","ঐকিক নিয়ম","সংখ্যা পদ্ধতি"],
  "📐জ্যামিতি": ["ক্ষেত্রফল","পরিসীমা","কোণ","ত্রিভুজ","বৃত্ত"],
  "💻 কম্পিউটার": ["হার্ডওয়্যার","সফটওয়্যার","ইন্টারনেট","MS Office","শর্টকাট"],
};
let TAXONOMY = TAXONOMY_DEFAULT;
if (process.env.TAXONOMY_JSON) {
  try { TAXONOMY = JSON.parse(process.env.TAXONOMY_JSON); }
  catch { console.log("⚠️ TAXONOMY_JSON secret ভুল JSON — ডিফল্ট taxonomy ব্যবহার হচ্ছে।"); }
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

// প্রশ্নের টেক্সট normalize করে — অ্যাপের normalizeQbankQ()-এর হুবহু কপি
function normalizeQbankQ(s) {
  return (s || "").toString().replace(/[\s.,;:।?!—–\-()'"]/g, "").trim();
}

// ── QBank/Quiz সরাসরি Google Sheet থেকে পড়া (GAS-এর getSheetRows অ্যাকশন দিয়ে) —
//    Firebase পুরোপুরি অফ থাকলেও কাজ করে, কারণ এটা Firebase একদম ছোঁয় না। অ্যাপের
//    fetchSheetFallback()-এর মতোই একই GAS অ্যাকশন ব্যবহার করছে। ──
async function gasGetSheetRows(tab) {
  const url = `${GAS_URL}?action=getSheetRows&tab=${encodeURIComponent(tab)}&secret=${encodeURIComponent(GAS_SECRET)}`;
  const resp = await fetch(url);
  const data = await resp.json().catch(() => ({}));
  if (data?.status !== "success" || !Array.isArray(data.rows)) {
    throw new Error(`GAS getSheetRows(${tab}) ব্যর্থ: ${data?.message || "unknown error"}`);
  }
  return data.rows; // ইতিমধ্যে flat object array, প্রতিটাতে _fbKey আছে — sheet header টেক্সটই কী হিসেবে থাকে
}

function sleep(ms) { return new Promise(res => setTimeout(res, ms)); }

// ── QBank→Quiz কনভার্সন প্রম্পট — অ্যাপের buildPrompt()-এর হুবহু কপি (src/App.jsx দেখো) ──
function buildConvertPrompt(batch) {
  return `তুমি একজন বাংলা প্রশ্নব্যাংক এডিটর। নিচে চাকরির পরীক্ষার প্রশ্নব্যাংক (QBank) থেকে কিছু প্রশ্ন দেওয়া হলো। প্রতিটা প্রশ্নকে Quiz ফরম্যাটে রূপান্তর করো।

CANONICAL SUBJECT/SUB-TOPIC তালিকা (এই তালিকা থেকেই সঠিক subject আর sub_topic বেছে নেবে, নতুন নাম বানাবে না, একদম হুবহু বানান/স্পেসিং কপি করবে):
${JSON.stringify(TAXONOMY, null, 2)}

নিয়মাবলী:
1. প্রতিটা ইনপুট প্রশ্নের বিষয়বস্তু বিচার করে উপরের তালিকা থেকে সবচেয়ে সঠিক subject আর sub_topic বেছে নাও। তালিকার কোনোটার সাথেই না মিললে subject="অজানা", sub_topic="অজানা" দাও — নতুন category বানিয়ে দিও না।
2. একটা ইনপুট প্রশ্নে যদি আসলে একাধিক sub-question থাকে (ক)/খ)/গ) দিয়ে ভাগ করা), সেটাকে আলাদা আলাদা atomic প্রশ্নে ভেঙে আউটপুটে একাধিক entry হিসেবে দাও।
3. ইনপুটে option1-4 আগে থেকেই থাকলে (MCQ টাইপ) সেগুলো হুবহু রাখো, শুধু correct অপশনটা ঠিক আছে কিনা যাচাই করো।
4. ইনপুটে option না থাকলে (Written টাইপ — শুধু question+correct answer আছে), সেই বিষয়ের সাথে সম্পর্কিত কিন্তু ভুল, প্লজিবল আরও ৩টা option বানাও — মূল সঠিক উত্তরটাই correct থাকবে।
5. explanation ফিল্ডে ১-২ লাইনে সংক্ষিপ্ত ব্যাখ্যা দাও।
6. শুধু নিচের JSON array ফরম্যাটে উত্তর দাও, কোনো markdown code fence, কোনো preamble ছাড়া, শুধু raw JSON:
[{"question":"...","opt1":"...","opt2":"...","opt3":"...","opt4":"...","correct":"...","subject":"...","sub_topic":"...","explanation":"..."}]

ইনপুট প্রশ্নসমূহ (JSON):
${JSON.stringify(batch.map(b => ({ question: b.question, opt1: b.opt1, opt2: b.opt2, opt3: b.opt3, opt4: b.opt4, correct: b.correct, explanation: b.explanation })), null, 2)}`;
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
    body: JSON.stringify({ model: cfg.model, messages: [{ role: "user", content: prompt }], max_tokens: 6000 }),
  });
  const data = await resp.json();
  if (!resp.ok) throw new Error(`[${cfg.id}] ${data?.error?.message || `HTTP ${resp.status}`}`);
  const text = data?.choices?.[0]?.message?.content;
  if (!text) throw new Error(`[${cfg.id}] খালি উত্তর`);
  return text.trim();
}

async function callRotating(pool, startIdx, prompt) {
  const errors = [];
  for (let i = 0; i < pool.length; i++) {
    const cfg = pool[(startIdx + i) % pool.length];
    try {
      const text = await callProvider(cfg, prompt);
      return { text, usedIdx: (startIdx + i) % pool.length, providerId: cfg.id };
    } catch (e) {
      errors.push(e.message || String(e));
    }
  }
  throw new Error("সব key ব্যর্থ: " + errors.slice(0, 3).join(" | "));
}

// ── GAS-এর bulk_save_rows endpoint-এ ব্যাচ সেভ (অ্যাপ যেভাবে সেভ করে হুবহু সেভাবেই) ──
async function gasBulkSave(rows, sync) {
  const resp = await fetch(GAS_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain" },
    body: JSON.stringify({ secret: GAS_SECRET, type: "bulk_save_rows", targetTab: "Quiz", rows, sync }),
  });
  const data = await resp.json().catch(() => ({}));
  return data;
}

function nowTs() {
  return new Date().toLocaleString("bn-BD", { timeZone: "Asia/Dhaka" });
}

async function main() {
  const pool = buildKeyPool();
  if (!pool.length) {
    console.error("❌ কোনো AI provider key পাওয়া যায়নি। অন্তত একটা *_KEYS secret সেট করো।");
    process.exit(1);
  }
  console.log(`🔑 মোট ${pool.length} টা key রেডি (providers: ${[...new Set(pool.map(p => p.id))].join(", ")})`);

  // ── QBank ও Quiz দুটোই Firebase থেকে পড়া ──
  const [qbankRaw, quizRaw] = await Promise.all([gasGetSheetRows("QBank"), gasGetSheetRows("Quiz")]);
  const existingQuizKeys = new Set(
    quizRaw.map(r => normalizeQbankQ(r.question || r.Question || "")).filter(Boolean)
  );
  console.log(`📚 Quiz-এ ইতিমধ্যে ${existingQuizKeys.size} টা ইউনিক প্রশ্ন আছে।`);

  const qbankRows = qbankRaw.map(row => {
    const audRaw = (row.AudienceTags || row.audienceTags || "").toString().trim();
    return {
      question: (row.question || row.Question || "").toString().trim(),
      opt1: row.option1 || "", opt2: row.option2 || "", opt3: row.option3 || "", opt4: row.option4 || "",
      correct: row.correct || "",
      subject: (row.subject || "").toString().trim(),
      examPaper: (row.sub_topic || "").toString().trim(),
      explanation: row.explanation || row.Explanation || "",
      audienceTags: audRaw,
      audienceList: audRaw.split(",").map(a => a.trim()).filter(Boolean),
    };
  }).filter(r => r.question);

  // ── ডিডুপ্লিকেশন (অ্যাপের মতোই): একই প্রশ্ন QBank-এর ভেতরেই একাধিক exam paper-এ থাকলে merge,
  //    আর Quiz-এ ইতিমধ্যে থাকা প্রশ্ন সম্পূর্ণ বাদ — তাই একই প্রশ্ন আবার AI-তে যাবে না। ──
  const seen = new Map();
  for (const r of qbankRows) {
    if (FILTER_SUBJECT.length && !FILTER_SUBJECT.includes(r.subject)) continue;
    if (FILTER_AUDIENCE.length) {
      const matches = FILTER_AUDIENCE.some(tag => tag === NONE_TAG ? r.audienceList.length === 0 : r.audienceList.includes(tag));
      if (!matches) continue;
    }
    if (FILTER_SUBTOPIC.length && !FILTER_SUBTOPIC.includes(r.examPaper)) continue;
    const key = normalizeQbankQ(r.question);
    if (!key) continue;
    if (existingQuizKeys.has(key)) continue;
    if (seen.has(key)) {
      const ex = seen.get(key);
      if (r.examPaper && !ex.examPapers.includes(r.examPaper)) ex.examPapers.push(r.examPaper);
    } else {
      seen.set(key, { ...r, examPapers: r.examPaper ? [r.examPaper] : [] });
    }
  }
  const pool2 = Array.from(seen.values());
  if (FILTER_AUDIENCE.length || FILTER_SUBJECT.length || FILTER_SUBTOPIC.length) {
    console.log(`🔎 ফিল্টার সক্রিয় — Audience: [${FILTER_AUDIENCE.join(", ") || "সব"}], Subject: [${FILTER_SUBJECT.join(", ") || "সব"}], Exam paper: [${FILTER_SUBTOPIC.join(", ") || "সব"}]`);
  }
  console.log(`📋 Quiz-এ নেই এমন ${pool2.length} টা ইউনিক প্রশ্ন QBank-এ পাওয়া গেছে।`);
  if (!pool2.length) { console.log("✅ QBank-এর সব প্রশ্নই Quiz-এ আছে, কোনো কাজ নেই।"); return; }

  let cursor = 0, aiOk = 0, aiFail = 0;
  let totalAdded = 0, totalSkipped = 0, totalSaveFailed = 0;
  let pending = []; // GAS-এ পাঠানোর জন্য জমা হওয়া রো — SAVE_CHUNK_SIZE ছুঁলেই ফ্লাশ হবে

  async function flush(sync) {
    if (!pending.length) return;
    const chunk = pending; pending = [];
    const data = await gasBulkSave(chunk, sync);
    if (data.result === "error") {
      totalSaveFailed += chunk.length;
      console.log(`❌ GAS সেভ ব্যর্থ (${chunk.length} টা রো): ${data.error || "unknown error"}`);
      return;
    }
    totalAdded += (data.added || 0);
    totalSkipped += (data.skipped || 0);
    if (sync && data.firebaseSynced === false) {
      console.log("⚠️ Sheet-এ সেভ হয়েছে কিন্তু Firebase sync ব্যর্থ হয়েছে (GAS Executions log চেক করো)।");
    }
    console.log(`💾 GAS-এ সেভ: +${data.added || 0} যোগ, ${data.skipped || 0} duplicate বাদ`);
  }

  for (let i = 0; i < pool2.length; i += BATCH_SIZE) {
    if (Date.now() - START_TIME > MAX_RUNTIME_MS) {
      console.log(`⏰ সময়সীমা শেষ (${Math.round(MAX_RUNTIME_MS / 60000)} মিনিট) — বাকি প্রশ্ন পরের রানে হবে।`);
      break;
    }
    const batch = pool2.slice(i, i + BATCH_SIZE);
    try {
      const { text, usedIdx, providerId } = await callRotating(pool, cursor, buildConvertPrompt(batch));
      cursor = (usedIdx + 1) % pool.length;
      const cleaned = text.replace(/```json|```/g, "").trim();
      const parsed = JSON.parse(cleaned);
      if (Array.isArray(parsed)) {
        for (const p of parsed) {
          const src = batch.find(b => normalizeQbankQ(b.question) === normalizeQbankQ(p.question));
          pending.push({
            question: p.question, opt1: p.opt1, opt2: p.opt2, opt3: p.opt3, opt4: p.opt4,
            correct: p.correct, subject: p.subject, sub_topic: p.sub_topic, explanation: p.explanation,
            qType: "MCQ", prevExam: (src?.examPapers || []).join(", "),
            audienceTags: src?.audienceTags || "Job", timestamp: nowTs(),
          });
        }
        aiOk++;
        console.log(`✅ [ব্যাচ ${aiOk + aiFail}/${Math.ceil(pool2.length / BATCH_SIZE)}] ${parsed.length} টা প্রশ্ন কনভার্ট হলো [${providerId}]`);
      }
    } catch (e) {
      aiFail++;
      console.log(`❌ [ব্যাচ ${aiOk + aiFail}/${Math.ceil(pool2.length / BATCH_SIZE)}] ব্যর্থ: ${e.message}`);
      cursor = (cursor + 1) % pool.length;
    }
    if (pending.length >= SAVE_CHUNK_SIZE) await flush(false);
    if (i + BATCH_SIZE < pool2.length) await sleep(DELAY_MS);
  }
  await flush(true); // শেষবার — এটাতেই Firebase sync হবে

  console.log(`\n🎯 এই রান শেষ — AI ব্যাচ সফল: ${aiOk}, ব্যর্থ: ${aiFail} | Sheet-এ যোগ: ${totalAdded}, duplicate বাদ: ${totalSkipped}, সেভ-ব্যর্থ: ${totalSaveFailed}`);
}

main().catch(e => { console.error("💥 মূল এরর:", e); process.exit(1); });
