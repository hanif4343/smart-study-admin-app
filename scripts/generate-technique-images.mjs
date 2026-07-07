/**
 * generate-technique-images.mjs
 * ------------------------------------------------------------------
 * ধাপ ১ (এখন শুধু এইটাই সক্রিয়): যেসব প্রশ্নে "Technique" টেক্সট আছে
 * কিন্তু "TechniqueImage" নেই, সেগুলোর জন্য Pollinations.ai দিয়ে একটা
 * ছবি বানিয়ে সরাসরি Firebase-এ URL লিখে দেয়।
 *
 * Pollinations.ai:
 *   - সম্পূর্ণ ফ্রি, কোনো API key/signup লাগে না।
 *   - URL-টাই একটা GET রিকোয়েস্ট, prompt URL-এ এনকোড করা থাকে।
 *   - seed ফিক্সড রাখলে একই URL বারবার হিট করলেও একই ছবি ফেরত দেয় —
 *     মানে এই URL-টাকেই স্থায়ী hosted image URL হিসেবে ব্যবহার করা যায়।
 *     তাই imgbb-তে আলাদা করে আপলোড করার দরকার নেই (ধাপ ৩ বাদ)।
 *   - বাংলা টেক্সট ওভারলে (ধাপ ২, node-canvas দিয়ে) এখনো এই স্ক্রিপ্টে
 *     যোগ করা হয়নি — এটা পরের ধাপে আসবে।
 *
 * টেকনিক টেক্সট (বাংলা) থেকে ভালো ইমেজ প্রম্পট (ইংরেজি, ভিজ্যুয়াল
 * মনে-রাখার কৌশল বর্ণনা করে) বানাতে বিদ্যমান টেক্সট-AI key pool
 * (generate-explanations.mjs এর মতোই) ব্যবহার করা হয়েছে।
 * ------------------------------------------------------------------
 * প্রয়োজনীয় ENV (GitHub Secrets থেকে আসবে):
 *   FIREBASE_URL, FIREBASE_SECRET   - আগের মতোই
 *   SHEETS            - "Quiz,QBank,Study"
 *   GROQ_KEYS, MISTRAL_KEYS, GEMINI_KEYS, ... - prompt বানানোর জন্য (ঐচ্ছিক provider গুলো)
 *   FILTER_AUDIENCE / FILTER_SUBJECT / FILTER_SUBTOPIC - ঐচ্ছিক, খালি রাখলে সব
 *   DELAY_MS          - প্রতি আইটেমের পর অপেক্ষা (ডিফল্ট 2500ms — image gen একটু ভারী)
 *   MAX_RUNTIME_MIN   - ডিফল্ট 330
 *   IMG_WIDTH / IMG_HEIGHT - ডিফল্ট 1024x768
 * ------------------------------------------------------------------
 */

const FIREBASE_URL = (process.env.FIREBASE_URL || "").replace(/\/+$/, "");
const FIREBASE_SECRET = process.env.FIREBASE_SECRET || "";
const SHEETS = (process.env.SHEETS || "Quiz,QBank,Study").split(",").map(s => s.trim()).filter(Boolean);
const DELAY_MS = parseInt(process.env.DELAY_MS || "2500", 10);
const MAX_RUNTIME_MS = (parseInt(process.env.MAX_RUNTIME_MIN || "330", 10)) * 60 * 1000;
const IMG_WIDTH = parseInt(process.env.IMG_WIDTH || "1024", 10);
const IMG_HEIGHT = parseInt(process.env.IMG_HEIGHT || "768", 10);
const START_TIME = Date.now();

const NONE_TAG = "__NONE__";
const parseList = v => (v || "").split(",").map(s => s.trim()).filter(Boolean);
const FILTER_AUDIENCE = parseList(process.env.FILTER_AUDIENCE);
const FILTER_SUBJECT = parseList(process.env.FILTER_SUBJECT);
const FILTER_SUBTOPIC = parseList(process.env.FILTER_SUBTOPIC);

if (!FIREBASE_URL || !FIREBASE_SECRET) {
  console.error("❌ FIREBASE_URL / FIREBASE_SECRET সেট করা নেই। GitHub Secrets চেক করো।");
  process.exit(1);
}

// ══ prompt বানানোর জন্য টেক্সট-AI provider pool (explanation script থেকে হুবহু) ══
const PROVIDER_DEFS = [
  { id: "groq", kind: "openai", envKey: "GROQ_KEYS", apiBase: "https://api.groq.com/openai/v1", model: "llama-3.3-70b-versatile" },
  { id: "mistral", kind: "openai", envKey: "MISTRAL_KEYS", apiBase: "https://api.mistral.ai/v1", model: "mistral-small-latest" },
  { id: "gemini", kind: "gemini", envKey: "GEMINI_KEYS", model: "gemini-2.5-flash-lite" },
  { id: "openrouter", kind: "openai", envKey: "OPENROUTER_KEYS", apiBase: "https://openrouter.ai/api/v1", model: "mistralai/mistral-7b-instruct:free" },
  { id: "cerebras", kind: "openai", envKey: "CEREBRAS_KEYS", apiBase: "https://api.cerebras.ai/v1", model: "gpt-oss-120b" },
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

function buildPromptGenPrompt(question, technique) {
  return `তুমি একটা image-generation টুলের জন্য prompt লিখছ (Stable Diffusion/Flux স্টাইল)।
নিচের বাংলা মনে-রাখার কৌশল (mnemonic) পড়ে এর জন্য একটা সহজ, single-scene, বাস্তবসম্মত ছবির বর্ণনা ইংরেজিতে লিখো — ম্যাক্সিমাম ২৫ শব্দে। কোনো টেক্সট/লেখা ছবিতে থাকবে না বলবে (no text, no words, no letters লিখে দাও শেষে)। শুধু prompt-টাই লিখবে, অন্য কোনো ব্যাখ্যা না।

প্রশ্ন: ${question}
মনে রাখার কৌশল: ${technique}

Prompt:`;
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
    body: JSON.stringify({ model: cfg.model, messages: [{ role: "user", content: prompt }], max_tokens: 120 }),
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

// fbKey থেকে ডিটারমিনিস্টিক সংখ্যা বানানো — একই প্রশ্নের জন্য সবসময় একই seed,
// তাই Pollinations সবসময় একই ছবি ফেরত দেবে (স্থায়ী URL হিসেবে কাজ করবে)।
function seedFromKey(key) {
  let h = 0;
  for (let i = 0; i < key.length; i++) { h = (h * 31 + key.charCodeAt(i)) >>> 0; }
  return h % 1000000;
}

function buildPollinationsUrl(imgPrompt, seed) {
  const encoded = encodeURIComponent(imgPrompt);
  return `https://image.pollinations.ai/prompt/${encoded}?width=${IMG_WIDTH}&height=${IMG_HEIGHT}&seed=${seed}&nologo=true&model=flux`;
}

// ছবিটা আসলেই বানানো যাচ্ছে কিনা যাচাই করা (HEAD/GET করে content-type চেক)
async function verifyImage(url) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Pollinations HTTP ${resp.status}`);
  const ct = resp.headers.get("content-type") || "";
  if (!ct.startsWith("image/")) throw new Error(`অপ্রত্যাশিত response type: ${ct}`);
  return true;
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
  console.log(pool.length ? `🔑 prompt বানাতে ${pool.length} টা text-AI key রেডি` : "⚠️ কোনো text-AI key নেই — Technique টেক্সটই সরাসরি image prompt হিসেবে ব্যবহার হবে (কম নিখুঁত)।");

  const queue = [];
  for (const sheet of SHEETS) {
    const raw = await fbGet(sheet);
    toArr(raw).forEach(row => {
      const q = (row.Question || row.question || "").toString().trim();
      const technique = (row.Technique || row.technique || "").toString().trim();
      const existingImg = (row.TechniqueImage || "").toString().trim();
      if (!q || !technique || existingImg) return; // শুধু যেসব প্রশ্নে টেকনিক টেক্সট আছে কিন্তু ইমেজ এখনো নাই

      const subject = (row.Subject || row.subject || "").toString().trim();
      const subtopic = (row.Sub_topic || row.sub_topic || "").toString().trim();
      const audienceRaw = (row.AudienceTags || row.audienceTags || row.audience_tags || "").toString().trim();
      const audienceList = audienceRaw.split(",").map(a => a.trim()).filter(Boolean);

      if (FILTER_SUBJECT.length && !FILTER_SUBJECT.includes(subject)) return;
      if (FILTER_SUBTOPIC.length && !FILTER_SUBTOPIC.includes(subtopic)) return;
      if (FILTER_AUDIENCE.length) {
        const matches = FILTER_AUDIENCE.some(tag => tag === NONE_TAG ? audienceList.length === 0 : audienceList.includes(tag));
        if (!matches) return;
      }

      queue.push({ sheet, fbKey: row._fbKey, question: q, technique, subject, subtopic });
    });
  }
  console.log(`📋 মোট ${queue.length} টা প্রশ্নে Technique আছে কিন্তু TechniqueImage নেই (ফিল্টারের পর)।`);
  if (!queue.length) { console.log("✅ কিছু করার নেই।"); return; }

  let ok = 0, fail = 0, cursor = 0;
  for (let i = 0; i < queue.length; i++) {
    if (Date.now() - START_TIME > MAX_RUNTIME_MS) {
      console.log(`⏰ সময়সীমা শেষ — বাকি প্রশ্ন পরের রানে হবে।`);
      break;
    }
    const item = queue[i];
    const shortQ = item.question.length > 40 ? item.question.slice(0, 40) + "…" : item.question;
    try {
      let imgPrompt = item.technique.slice(0, 200);
      if (pool.length) {
        try {
          const { text, usedIdx } = await callRotating(pool, cursor, buildPromptGenPrompt(item.question, item.technique));
          imgPrompt = text.replace(/^prompt:\s*/i, "").trim();
          cursor = (usedIdx + 1) % pool.length;
        } catch (e) {
          console.log(`   ⚠️ prompt-জেনারেশন ব্যর্থ, raw Technique টেক্সট দিয়েই চেষ্টা: ${e.message}`);
        }
      }
      const seed = seedFromKey(`${item.sheet}_${item.fbKey}`);
      const url = buildPollinationsUrl(imgPrompt, seed);
      await verifyImage(url); // নিশ্চিত করা ছবিটা আসলেই তৈরি হচ্ছে
      await fbPatch(`${item.sheet}/${item.fbKey}`, { TechniqueImage: url });
      ok++;
      console.log(`✅ [${ok + fail}/${queue.length}] (${item.sheet}) ${item.subject || "-"} / ${item.subtopic || "-"} — "${shortQ}"\n   → ${url}`);
    } catch (e) {
      fail++;
      console.log(`❌ [${ok + fail}/${queue.length}] স্কিপ (${item.sheet}) — "${shortQ}": ${e.message}`);
    }
    if (i < queue.length - 1) await sleep(DELAY_MS);
  }

  console.log(`\n🎯 শেষ — সফল: ${ok}, ব্যর্থ/স্কিপ: ${fail}, বাকি: ${queue.length - ok - fail}`);
}

main().catch(e => { console.error("💥 মূল এরর:", e); process.exit(1); });
