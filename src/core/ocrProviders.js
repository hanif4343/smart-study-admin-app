/* ══════════════════════════════════════════════════════════════════
   API SETTINGS  —  OCR auto-parse provider manager
   localStorage-এ সেভ → rebuild লাগে না, key চেঞ্জ করা যায়
   ══════════════════════════════════════════════════════════════════ */

const DEFAULT_PROVIDERS=[
  {id:"groq",name:"Groq",icon:"⚡",free:true,
   model:"llama-3.3-70b-versatile",
   url:"https://api.groq.com/openai/v1/chat/completions",
   keyHint:"console.groq.com → API Keys (ফ্রি, খুব ফাস্ট)",
   limit:"ফ্রি, ফাস্ট"},
  {id:"gemini",name:"Google Gemini",icon:"🟢",free:true,
   model:"gemini-2.5-flash",
   url:"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent",
   keyHint:"aistudio.google.com → Get API Key (Gmail, free, no card)",
   limit:"1500 req/day free"},
  {id:"mistral",name:"Mistral AI",icon:"🔵",free:true,
   model:"mistral-small-latest",
   url:"https://api.mistral.ai/v1/chat/completions",
   keyHint:"console.mistral.ai → API Keys",
   limit:"Free tier available"},
  {id:"openrouter",name:"OpenRouter",icon:"🟣",free:true,
   model:"mistralai/mistral-7b-instruct:free",
   url:"https://openrouter.ai/api/v1/chat/completions",
   keyHint:"openrouter.ai → Keys (free models, no card needed)",
   limit:"Free models available"},
  {id:"cerebras",name:"Cerebras",icon:"🟠",free:true,
   model:"gpt-oss-120b",
   url:"https://api.cerebras.ai/v1/chat/completions",
   keyHint:"cloud.cerebras.ai → API Keys (ফ্রি, খুব ফাস্ট)",
   limit:"ফ্রি"},
  {id:"together",name:"Together AI",icon:"🔷",free:false,
   model:"meta-llama/Llama-3.3-70B-Instruct-Turbo-Free",
   url:"https://api.together.xyz/v1/chat/completions",
   keyHint:"api.together.xyz → Keys (⚠️ এখন সাধারণত $5 মিনিমাম ক্রেডিট লাগে, সম্পূর্ণ ফ্রি নয়)",
   limit:"ফ্রি টিয়ার নেই"},
  {id:"fireworks",name:"Fireworks AI",icon:"🎆",free:true,
   model:"accounts/fireworks/models/llama-v3p3-70b-instruct",
   url:"https://api.fireworks.ai/inference/v1/chat/completions",
   keyHint:"fireworks.ai → API Keys",
   limit:"ফ্রি ক্রেডিট"},
  {id:"deepseek",name:"DeepSeek",icon:"🔵",free:true,
   model:"deepseek-v4-flash",
   url:"https://api.deepseek.com/chat/completions",
   keyHint:"platform.deepseek.com → API Keys",
   limit:"সস্তা/ফ্রি টিয়ার"},
];
const LS_PROV="ocr_api_providers";
function loadProviders(){
  try{
    const s=JSON.parse(localStorage.getItem(LS_PROV)||"{}");
    return DEFAULT_PROVIDERS.map(p=>({...p,key:s[p.id]?.key||"",active:s[p.id]?.active||false}));
  }catch{return DEFAULT_PROVIDERS.map(p=>({...p,key:"",active:false}));}
}
function saveProviders(providers){
  const o={};
  providers.forEach(p=>{o[p.id]={key:p.key,active:p.active};});
  localStorage.setItem(LS_PROV,JSON.stringify(o));
}
// একটা provider-এ কমা দিয়ে একাধিক key থাকতে পারে — সব active provider-এর
// সব key মিলিয়ে একটা flat pool বানায়, rotation-এর জন্য।
function buildKeyPool(){
  const pool=[];
  loadProviders().forEach(p=>{
    if(!p.active||!p.key)return;
    p.key.split(",").map(k=>k.trim()).filter(Boolean).forEach(key=>pool.push({...p,key}));
  });
  return pool;
}
function getActiveProvider(){
  // ব্যাকওয়ার্ড-কম্প্যাটিবিলিটি জন্য রাখা (UI ব্যানারে ব্যবহার হয়) — প্রথম active provider রিটার্ন করে
  return loadProviders().find(p=>p.active&&p.key)||null;
}
// সব format-এ কমন — OCR misread ঠিক করার নিয়ম। মোবাইলের ML Kit OCR বাংলা যুক্তাক্ষর/মাত্রা
// প্রায়ই ভুল পড়ে (যেমন নরসিংহ→রসিংই, বৃহস্পতি→বহস্পত, পরিচ্ছেদ→পরিণে, UNHCR→UNIR)।
// AI formatting ধাপেই এগুলো context বুঝে ঠিক করে দেওয়ার instruction — কিন্তু হ্যালুসিনেট না করে।
const OCR_CORRECTION_RULES=`
বানান/OCR সংশোধন (গুরুত্বপূর্ণ — খুব সতর্কতার সাথে, অতি-উৎসাহী হয়ে অনুমান করে বদলাবে না):
- সংখ্যা, অংক, +/- চিহ্ন, সমীকরণ/formula, x/y/z-এর মতো ভেরিয়েবল কখনোই পরিবর্তন করবে না — OCR-এ যা এসেছে হুবহু রাখো, এমনকি "ভুল/অসামঞ্জস্যপূর্ণ" মনে হলেও। এখানে কোনো ব্যতিক্রম নেই — অনুমান করে সংখ্যা "ঠিক করে" বসালে পুরো অঙ্কের উত্তর ভুল হয়ে যাবে, যেটা টেক্সট ভুলের চেয়েও খারাপ।
- শব্দ সংশোধন শুধু তখনই করবে যখন OCR টেক্সট literally ভাঙা/অর্থহীন (এমন অক্ষরগুচ্ছ যা বাংলা অভিধানে নেই, gibberish) — যেমন "রসিংই", "বহস্পত", "পরিণে"। শুধু তখনই context দেখে সবচেয়ে কাছের প্রচলিত শব্দে ঠিক করবে (যেমন "নরসিংহ", "বৃহস্পতি", "পরিচ্ছেদ")।
- OCR টেক্সট ইতিমধ্যে একটা বৈধ/অর্থপূর্ণ বাংলা শব্দ হলে সেটা একদম স্পর্শ করবে না — তোমার কাছে অন্য কোনো শব্দ "বেশি প্রচলিত" বা "বেশি মানানসই" মনে হলেও বদলে দিও না। উদাহরণ: OCR-এ "মনমরা" থাকলে সেটাকে "মনমাঝি" বানিও না; "দুর্যোগ" থাকলে "সুযোগ" বানিও না; কারো নাম "আরমিনা" লেখা থাকলে "করিম" বানিও না। সন্দেহ হলে ডিফল্ট আচরণ: OCR-এ যা আছে অপরিবর্তিত রাখা।
- সংক্ষিপ্ত রূপ (acronym) স্পষ্টভাবে ভাঙা/ভুল অক্ষরে থাকলে পরিচিত সঠিক রূপে ঠিক করো (যেমন "UNIR"→"UNHCR")।
- প্রশ্নের শুরুর নির্দেশনা-অংশ (যেমন "ব্যাসবাক্য সহ") OCR-এ সম্পূর্ণ অনুপস্থিত থাকলে (কোনো টেক্সটই নেই) এবং বাকি context থেকে নিশ্চিতভাবে বোঝা গেলে সেটা যোগ করে দাও — কিন্তু ইতিমধ্যে থাকা কোনো টেক্সট পরিবর্তন করবে না।`;
const OCR_PROMPT_FORMATS={
  MCQ:`তুমি একজন বাংলা MCQ প্রশ্নপত্র formatter।
নিচের OCR text থেকে সব MCQ প্রশ্ন বের করে নিচের format-এ দাও।
প্রশ্ন;অপশন১;অপশন২;অপশন৩;অপশন৪;সঠিকউত্তর
সঠিক উত্তর বের করার নিয়ম (এই ক্রম অনুযায়ী চেষ্টা করো):
১. যদি কোনো অপশনের পাশে/আগে ভরাট বা কালো বৃত্ত/বুলেট চিহ্ন (যেমন ●, ⬤, ⚫, বা কালো রঙে হাইলাইট করা বৃত্ত) থাকে আর বাকিগুলোর পাশে ফাঁকা/সাদা বৃত্ত (○, ◯) থাকে — তাহলে যেটার পাশে ভরাট চিহ্ন সেটাই সঠিক উত্তর।
২. যদি প্রশ্নের শেষে আলাদা "উ." বা "Ans" বা "Answer" লাইনে ক/খ/গ/ঘ বা A/B/C/D লেখা থাকে — সেই অক্ষরের পজিশন অনুযায়ী অপশন ধরবে (ক বা A = ১ম অপশন, খ বা B = ২য়, গ বা C = ৩য়, ঘ বা D = ৪র্থ)।
৩. যদি উত্তর হিসেবে সরাসরি কোনো অপশনের হুবহু টেক্সট লেখা থাকে — সেটাই ব্যবহার করো।
৪. উপরের কোনোটাই না বুঝলে, প্রশ্নের বিষয়বস্তু অনুযায়ী তোমার নিজের জ্ঞান দিয়ে সবচেয়ে সম্ভাব্য সঠিক উত্তরটা অনুমান করো — কখনোই সঠিক উত্তর ফাঁকা রাখবে না।
${OCR_CORRECTION_RULES}
RULES:
- শুধু formatted data দাও, কোনো label বা explanation নয়
- Serial number বাদ দাও
- 2-column হলে প্রশ্ন নম্বর অনুযায়ী sort করো
- পৃষ্ঠা নম্বর, বিজ্ঞাপন, Facebook, প্রমোশনাল text বাদ দাও
- সঠিক উত্তর ফিল্ডে সবসময় অপশনের আসল টেক্সট বসাবে (ক/খ/গ/ঘ বা A/B/C/D অক্ষর নয়)
- field-এ ; থাকলে | দিয়ে replace করো
- কোনো প্রশ্ন বাদ দিও না`,
  Written:`তুমি একজন বাংলা প্রশ্নপত্র formatter।
নিচের OCR text থেকে সব প্রশ্ন-উত্তর বের করে নিচের format-এ দাও, প্রতিটি entry {} দিয়ে wrap করে:
{প্রশ্ন;উত্তর}
${OCR_CORRECTION_RULES}
RULES:
- শুধু formatted data দাও, কোনো label বা explanation নয়
- Serial number বাদ দাও
- পৃষ্ঠা নম্বর, বিজ্ঞাপন, Facebook, প্রমোশনাল text বাদ দাও
- field-এ ; থাকলে | দিয়ে replace করো
- কোনো প্রশ্ন বাদ দিও না`,
  Study:`তুমি একজন বাংলা প্রশ্নপত্র formatter।
নিচের OCR text থেকে সব প্রশ্ন-উত্তর বের করে নিচের format-এ দাও, প্রতিটি entry {} দিয়ে wrap করে:
{প্রশ্ন;উত্তর}
${OCR_CORRECTION_RULES}
RULES:
- শুধু formatted data দাও, কোনো label বা explanation নয়
- Serial number বাদ দাও
- উত্তর একাধিক লাইনের হলেও একই entry-তে রাখো
- পৃষ্ঠা নম্বর, বিজ্ঞাপন, Facebook, প্রমোশনাল text বাদ দাও
- field-এ ; থাকলে | দিয়ে replace করো
- কোনো প্রশ্ন বাদ দিও না`,
};
function buildOcrPrompt(qtype,ocrText){
  const tmpl=OCR_PROMPT_FORMATS[qtype]||OCR_PROMPT_FORMATS.MCQ;
  return `${tmpl}\n=== OCR TEXT ===\n${ocrText}`;
}

// একটামাত্র provider/key দিয়ে একবার কল — ব্যর্থ হলে throw করে (rotation ফাংশন এটাকে wrap করে)
async function callProviderOnce(p,prompt){
  if(p.id==="gemini"){
    const models=["gemini-2.5-flash","gemini-2.5-flash-lite","gemini-flash-latest"];
    const versions=["v1beta","v1"];
    let lastErr=null;
    for(const ver of versions){
      for(const model of models){
        try{
          const url=`https://generativelanguage.googleapis.com/${ver}/models/${model}:generateContent`;
          const res=await fetch(url,{
            method:"POST",
            headers:{"Content-Type":"application/json","x-goog-api-key":p.key},
            body:JSON.stringify({contents:[{parts:[{text:prompt}]}]}),
          });
          if(res.status===403){
            const errBody=await res.json().catch(()=>({}));
            const reason=errBody?.error?.message||"";
            if(reason.includes("API_KEY_HTTP_REFERRER_BLOCKED")||reason.includes("referer")){
              throw new Error("API Key-এ HTTP Referrer restriction আছে → Restrictions → None করুন");
            }
            if(reason.includes("API not enabled")||reason.includes("has not been used")){
              throw new Error("Generative Language API enable নেই → console.cloud.google.com-এ Enable করুন");
            }
            lastErr=new Error(`403: ${reason||"Permission denied"}`);
            continue;
          }
          if(!res.ok){lastErr=new Error(`HTTP ${res.status}`);continue;}
          const d=await res.json();
          const text=d?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
          if(text) return text;
          lastErr=new Error("Empty response");
        }catch(e){
          if(e.message.includes("Console")||e.message.includes("Restrictions")) throw e;
          lastErr=e;
        }
      }
    }
    throw lastErr||new Error("Gemini সব endpoint ব্যর্থ");
  }
  const headers={"Content-Type":"application/json","Authorization":"Bearer "+p.key};
  if(p.id==="openrouter") headers["HTTP-Referer"]="https://smartstudy.admin";
  const res=await fetch(p.url,{method:"POST",headers,
    body:JSON.stringify({model:p.model,messages:[{role:"user",content:prompt}],max_tokens:4096})});
  if(!res.ok) throw new Error(p.name+" HTTP "+res.status);
  const d=await res.json();
  const text=d?.choices?.[0]?.message?.content?.trim();
  if(!text) throw new Error(p.name+" খালি response");
  return text;
}

// module-level cursor — একই সেশনে বারবার কল করলে key ঘুরতে থাকে, একটার উপর চাপ না পড়ে
let _ocrPoolCursor=0;
async function callAiProviderRotating(ocrText,qtype="MCQ"){
  const pool=buildKeyPool();
  if(!pool.length) return null; // কোনো key active নেই = skip silently (local parser fallback হবে)
  const prompt=buildOcrPrompt(qtype,ocrText);
  const errors=[];
  for(let i=0;i<pool.length;i++){
    const p=pool[(_ocrPoolCursor+i)%pool.length];
    try{
      const text=await callProviderOnce(p,prompt);
      _ocrPoolCursor=(_ocrPoolCursor+i+1)%pool.length;
      return text;
    }catch(e){
      if(e.message.includes("Console")||e.message.includes("Restrictions")) throw e; // user action দরকার, থামিয়ে দাও
      errors.push(`${p.name}: ${e.message}`);
    }
  }
  throw new Error("সব provider ব্যর্থ — "+errors.slice(0,3).join(" | "));
}

// ব্যাকওয়ার্ড-কম্প্যাটিবিলিটি — পুরনো কলার (doTest ইত্যাদি) এখনো callAiProvider() ব্যবহার করে
async function callAiProvider(ocrText,qtype="MCQ"){
  return callAiProviderRotating(ocrText,qtype);
}

// ── raw prompt caller — buildOcrPrompt/OCR_PROMPT_FORMATS ব্যবহার করে না,
//    সরাসরি custom prompt দিয়ে কল করে, একই key-rotation pool/লজিক reuse করে।
//    QBank→Quiz Converter (QBankConverterTab) এখান থেকে কল করে।
async function callAiProviderRotatingRaw(prompt){
  const pool=buildKeyPool();
  if(!pool.length) throw new Error("কোনো AI provider active নেই — API Settings-এ গিয়ে অন্তত একটা key active করো।");
  const errors=[];
  for(let i=0;i<pool.length;i++){
    const p=pool[(_ocrPoolCursor+i)%pool.length];
    try{
      const text=await callProviderOnce(p,prompt);
      _ocrPoolCursor=(_ocrPoolCursor+i+1)%pool.length;
      return text;
    }catch(e){
      if(e.message.includes("Console")||e.message.includes("Restrictions")) throw e;
      errors.push(`${p.name}: ${e.message}`);
    }
  }
  throw new Error("সব provider ব্যর্থ — "+errors.slice(0,3).join(" | "));
}

export { DEFAULT_PROVIDERS, loadProviders, saveProviders, buildKeyPool, getActiveProvider, OCR_PROMPT_FORMATS, OCR_CORRECTION_RULES, buildOcrPrompt, callProviderOnce, callAiProviderRotating, callAiProvider, callAiProviderRotatingRaw };
