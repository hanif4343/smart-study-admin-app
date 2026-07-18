/**
 * typing-sentence-worker.js
 * ------------------------------------------------------------------
 * SmartStudyBD মূল Android অ্যাপ থেকে সরাসরি কল হবে — টাইপিং সেশনের
 * দুর্বল-শব্দ দিয়ে একটা "ব্লেন্ডেড" প্যাসেজ (কিছু% পুরনো ভুল-শব্দ +
 * বাকিটা নতুন কন্টেন্ট) real-time জেনারেট করে ফেরত দেয়।
 *
 * generate-questions.mjs-এর সাথে পার্থক্য শুধু এইটুকু:
 *   - সেটা চলে GitHub Actions-এ (batch, admin-triggered, ধীর — মিনিট/ঘণ্টা)
 *   - এটা চলে Cloudflare Worker-এ (single request, main app থেকে সরাসরি,
 *     সেকেন্ডে রেসপন্স — মোবাইল অ্যাপের রিয়েল-টাইম প্রয়োজনের জন্য দরকার)
 * বাকি সব — provider তালিকা, key-rotation, fallback লজিক — হুবহু একই।
 *
 * ডিপ্লয় করার ধাপ:
 *   1. Cloudflare অ্যাকাউন্ট খোলো (ফ্রি, কার্ড লাগে না) → Workers বানাও
 *   2. `npx wrangler deploy` (wrangler.toml এই ফোল্ডারেই আছে)
 *   3. একই ৮টা KEYS env var + একটা নতুন APP_SHARED_SECRET সেট করো:
 *        npx wrangler secret put GROQ_KEYS
 *        npx wrangler secret put MISTRAL_KEYS   ...ইত্যাদি (৮টাই)
 *        npx wrangler secret put APP_SHARED_SECRET   (নিজের একটা random string)
 *   4. Worker deploy হলে একটা URL পাবে (যেমন https://xxx.workers.dev) —
 *      সেটা আর APP_SHARED_SECRET মূল Android অ্যাপের BuildConfig-এ বসবে
 *      (API key না, তাই main app-এ থাকলে ঝুঁকি কম — ফাঁস হলেও এই ইউজার-নিজে
 *      leak করলে শুধু rate-limit/স্প্যামের ঝুঁকি, আসল AI provider key ফাঁস হয় না)
 * ------------------------------------------------------------------
 */

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

function buildKeyPool(env) {
  const pool = [];
  for (const def of PROVIDER_DEFS) {
    const raw = env[def.envKey] || "";
    const keys = raw.split(",").map(k => k.trim()).filter(Boolean);
    for (const key of keys) pool.push({ ...def, key });
  }
  return pool;
}

function buildPrompt(weakWords, language, difficulty) {
  const langName = language === "en" ? "ইংরেজি" : "বাংলা";
  const wordList = weakWords.slice(0, 10).join(", ");
  return `তুমি একজন টাইপিং-শিক্ষক। ${langName} ভাষায় একটা প্র্যাকটিস অনুচ্ছেদ (৩০-৫০ শব্দ, difficulty: ${difficulty}) বানাও।

শর্ত (দুটোই মানতে হবে):
1. এই শব্দগুলো অনুচ্ছেদে স্বাভাবিকভাবে ছড়িয়ে থাকতে হবে (মোট শব্দের প্রায় ১০%, জোর করে গোঁজা মনে না হয়): ${wordList}
2. বাকি ~৯০% সম্পূর্ণ নতুন, অর্থবহ, প্রাসঙ্গিক কন্টেন্ট হবে — কোনো বিষয়ে একটা স্বাভাবিক অনুচ্ছেদের মতো পড়তে হবে, তালিকাভুক্ত শব্দ গোঁজার জন্য বানানো কৃত্রিম বাক্য না।

উত্তর অবশ্যই শুধুমাত্র একটা বৈধ JSON object হবে, অন্য কোনো টেক্সট/মার্কডাউন ছাড়া, ঠিক এই ফরম্যাটে:
{"passage":"..."}`;
}

function extractJsonObject(text) {
  let t = text.trim().replace(/^```json/i, "").replace(/^```/, "").replace(/```$/, "").trim();
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) throw new Error("JSON object পাওয়া যায়নি");
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
    body: JSON.stringify({ model: cfg.model, messages: [{ role: "user", content: prompt }], max_tokens: 600 }),
  });
  const data = await resp.json();
  if (!resp.ok) throw new Error(`[${cfg.id}] ${data?.error?.message || `HTTP ${resp.status}`}`);
  const text = data?.choices?.[0]?.message?.content;
  if (!text) throw new Error(`[${cfg.id}] খালি উত্তর`);
  return text;
}

async function callRotating(pool, prompt) {
  const errors = [];
  // ── এলোমেলো startIdx — যাতে বহু ইউজারের একসাথে-আসা রিকোয়েস্ট সবসময়
  // একই (প্রথম) key-তে গিয়ে ভিড় না করে, rate-limit ছড়িয়ে যায় ──
  const startIdx = Math.floor(Math.random() * pool.length);
  for (let i = 0; i < pool.length; i++) {
    const cfg = pool[(startIdx + i) % pool.length];
    try {
      const raw = await callProvider(cfg, prompt);
      const obj = extractJsonObject(raw);
      if (!obj.passage || typeof obj.passage !== "string" || obj.passage.trim().length < 10) {
        throw new Error("খালি/অবৈধ passage");
      }
      return { passage: obj.passage.trim(), providerId: cfg.id };
    } catch (e) {
      errors.push(`${e.message || e}`);
    }
  }
  throw new Error("সব provider ব্যর্থ: " + errors.slice(0, 3).join(" | "));
}

export default {
  async fetch(request, env) {
    if (request.method !== "POST") {
      return new Response(JSON.stringify({ error: "POST ব্যবহার করো" }), { status: 405 });
    }

    const authHeader = request.headers.get("Authorization") || "";
    if (authHeader !== `Bearer ${env.APP_SHARED_SECRET}`) {
      return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 });
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return new Response(JSON.stringify({ error: "invalid JSON body" }), { status: 400 });
    }

    const weakWords = Array.isArray(body.weakWords) ? body.weakWords.filter(w => typeof w === "string" && w.trim()) : [];
    const language = body.language === "en" ? "en" : "bn";
    const difficulty = ["easy", "medium", "hard"].includes(body.difficulty) ? body.difficulty : "medium";

    if (weakWords.length === 0) {
      return new Response(JSON.stringify({ error: "weakWords খালি" }), { status: 400 });
    }

    const pool = buildKeyPool(env);
    if (!pool.length) {
      return new Response(JSON.stringify({ error: "কোনো AI provider key কনফিগার করা নেই" }), { status: 500 });
    }

    try {
      const prompt = buildPrompt(weakWords, language, difficulty);
      const { passage, providerId } = await callRotating(pool, prompt);
      return new Response(JSON.stringify({ passage, provider: providerId, usedWords: weakWords }), {
        headers: { "Content-Type": "application/json" },
      });
    } catch (e) {
      return new Response(JSON.stringify({ error: e.message || "generation failed" }), { status: 502 });
    }
  },
};
