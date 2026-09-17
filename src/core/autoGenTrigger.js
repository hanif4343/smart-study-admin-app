/* ══════════ AUTO-GENERATE TRIGGER (Option + Explanation) ══════════
   🆕 SingleQuestionEntryPage-এ MCQ সাবমিট করার পর — correct ভরা কিন্তু option
   ফাঁকা হলে — automatically option-generator, আর explanation ফাঁকা হলে
   explanation-generator GitHub Actions workflow ট্রিগার করে।

   ⚠️ ডিবাউন্সড ব্যাচিং — প্রতিটা সাবমিটে সাথে সাথে আলাদা workflow_dispatch
   কল করা হয় না। কারণ পরপর অনেকগুলো MCQ সাবমিট করলে প্রতিটার জন্য আলাদা
   GitHub Actions রান (প্রতিটাতেই checkout+npm-setup ওভারহেড, আর
   generate-mcq-options.yml/generate-explanations.yml-এর কমেন্টেই লেখা আছে
   পুরনো auto-schedule বন্ধ করা হয়েছিল ঠিক এই ধরনের বেহিসাবি বারবার-চালানোর
   কারণে RTDB/GitHub Actions কোটা চাপ পড়েছিল বলে)। তাই id-গুলো একটা
   pending queue-তে (localStorage, পেজ পরিবর্তন করলেও টিকে থাকে) জমা রাখা
   হয়, ৩০ সেকেন্ড নিষ্ক্রিয় থাকলে (debounce) একসাথে সব id নিয়ে target_ids
   হিসেবে একটাই workflow_dispatch কল হয় — GAS-এর getQuestionsByIds (হালকা,
   নির্দিষ্ট id-টার্গেটেড) দিয়ে প্রসেস হয়, পুরো Sheet স্ক্যান হয় না। ──────── */
import { loadGhCfg } from "./ghConfig.js";

const LS_PENDING_MCQ = "ss_pending_autogen_mcq_v1";
const LS_PENDING_EXP = "ss_pending_autogen_exp_v1";
const DEBOUNCE_MS = 30000;

let _timer = null;

function _load(key){
  try{ const raw=localStorage.getItem(key); const arr=raw?JSON.parse(raw):[]; return Array.isArray(arr)?arr:[]; }catch{ return []; }
}
function _save(key,arr){ try{ localStorage.setItem(key, JSON.stringify(arr)); }catch{} }
function _addUnique(key,id){ const arr=_load(key); if(!arr.includes(id)){ arr.push(id); _save(key,arr); } return arr; }

async function _dispatch(workflowFile, cfg, ids, sheet){
  const resp=await fetch(`https://api.github.com/repos/${cfg.repo}/actions/workflows/${workflowFile}/dispatches`,{
    method:"POST",
    headers:{"Accept":"application/vnd.github+json","Authorization":"Bearer "+cfg.token,"Content-Type":"application/json"},
    body:JSON.stringify({ref:"main",inputs:{ target_ids: ids.join(","), filter_audience:"", filter_subject:"", filter_subtopic:"" }})
  });
  if(resp.status!==204){
    const data=await resp.json().catch(()=>({}));
    throw new Error(data.message||`HTTP ${resp.status}`);
  }
}

async function _flush(push){
  const mcqIds=_load(LS_PENDING_MCQ);
  const expIds=_load(LS_PENDING_EXP);
  if(!mcqIds.length && !expIds.length) return;
  const cfg=loadGhCfg();
  if(!cfg.token||!cfg.repo){
    push?.("warn","⚠️ অটো-জেনারেট বাদ দেওয়া হলো","GitHub টোকেন সেট নেই — 'ম্যানেজ করুন' ট্যাবে একবার সেভ করো, তাহলে ভবিষ্যতে এটা কাজ করবে");
    return; // ⚠️ config না থাকলে queue খালি করা হচ্ছে না ইচ্ছাকৃতভাবে — পরে config সেভ হলে পরের flush-এ আবার চেষ্টা হবে
  }
  try{
    if(mcqIds.length){ await _dispatch(cfg.workflowMcqOptions, cfg, mcqIds); }
    if(expIds.length){ await _dispatch(cfg.workflowExplain, cfg, expIds); }
    _save(LS_PENDING_MCQ,[]); _save(LS_PENDING_EXP,[]);
    const parts=[]; if(mcqIds.length) parts.push(`${mcqIds.length}টা প্রশ্নের অপশন`); if(expIds.length) parts.push(`${expIds.length}টা প্রশ্নের ব্যাখ্যা`);
    push?.("success","🤖 অটো-জেনারেট শুরু হয়েছে",`${parts.join(" + ")} — ব্যাকগ্রাউন্ডে জেনারেট হচ্ছে (GitHub Actions-এ ~১-২ মিনিট লাগবে)`);
  }catch(e){
    push?.("error","❌ অটো-জেনারেট ট্রিগার ব্যর্থ",e.message);
    // ব্যর্থ হলেও queue রেখে দেওয়া হচ্ছে — পরের সফল সাবমিটে আবার চেষ্টা হবে
  }
}

/**
 * @param id নতুন সাবমিট হওয়া প্রশ্নের id (GAS bulk_save_rows-এর রেসপন্স থেকে)
 * @param needsOptions true হলে MCQ option-generator-এর queue-তে যোগ হবে
 * @param needsExplanation true হলে explanation-generator-এর queue-তে যোগ হবে
 * @param push টোস্ট দেখানোর জন্য
 */
function queueAutoGen({id,needsOptions,needsExplanation,push}){
  if(!id||(!needsOptions&&!needsExplanation)) return;
  if(needsOptions) _addUnique(LS_PENDING_MCQ,id);
  if(needsExplanation) _addUnique(LS_PENDING_EXP,id);
  clearTimeout(_timer);
  _timer=setTimeout(()=>_flush(push), DEBOUNCE_MS);
}

export { queueAutoGen };
