/* ══════════ PaperComposer — বাংলা/ইংরেজি/গণিত/GK পুরো প্রশ্নপত্র টাইপ করার UI ══════════
   🐛 রিফ্যাক্টর (Single Entry থেকে বের করে শেয়ার্ড কম্পোনেন্ট বানানো হলো):
   আগে এই পুরো কম্পোনেন্ট (+ তার সব সাপোর্টিং হেল্পার — PAPER_TABS, newGroupCard,
   detectAutoMarkup, headingToTopicGuess ইত্যাদি) SingleQuestionEntryPage.jsx-এর
   ভেতরেই আটকা ছিল। এখন এটা আলাদা শেয়ার্ড ফাইলে — যাতে OCR/Import পেজও (ছবি থেকে
   প্রশ্ন বের করে) ঠিক এই একই কার্ড/সাব-পার্ট UI ব্যবহার করতে পারে, নতুন করে UI
   বানাতে না হয়। নতুন ঐচ্ছিক prop `initialPaper` — দিলে সেই ডেটা দিয়ে শুরু হয়
   (OCR ইম্পোর্টের জন্য), না দিলে আগের মতোই খালি অবস্থা থেকে শুরু হয় (Single Entry-এর
   জন্য — কোনো behavior change নেই)। ══════════ */
import React, { useState, useRef, useEffect, useCallback } from "react";
import { callAiProviderRotatingRaw, buildKeyPool } from "../../core/ocrProviders.js";
import { buildSheetRow, LS_DRAFT_PAPER, LS_DRAFT_PAPER_LIST, loadDraft, saveDraft, clearDraft } from "../../core/uploaderUtils.js";
import { saveRowsToSheet, fetchReferenceData } from "../../core/sheetSave.js";
import { resolveOrCreateReference, norm } from "../../core/referenceHelpers.js";
import { TypeaheadCombo } from "./TypeaheadCombo.jsx";

/* ── AI দিয়ে MCQ-এর ৩টা ভুল অপশন + ব্যাখ্যা বানানোর প্রম্পট (SingleQuestionEntryPage-এর
   নিজস্ব single-form-ও এটাই ব্যবহার করে, import করে — দুই জায়গায় আলাদা prompt না) ── */
function buildMcqGenPrompt(q,correctAns){
  return `তুমি একজন বাংলা MCQ প্রশ্ন-প্রণেতা।
নিচের প্রশ্ন আর তার সঠিক উত্তর দেওয়া আছে। এর জন্য:
১. আরও ৩টা যুক্তিসঙ্গত কিন্তু ভুল অপশন (distractor) বানাও — অবাস্তব/হাস্যকর না, পরীক্ষার্থীকে বিভ্রান্ত করার মতো বিশ্বাসযোগ্য হতে হবে, একই বিষয়শ্রেণির হতে হবে।
২. একটা সংক্ষিপ্ত (২-৩ বাক্যের) ব্যাখ্যা লিখো কেন এই উত্তরটাই সঠিক।
প্রশ্ন: ${q}
সঠিক উত্তর: ${correctAns}
শুধু নিচের বিশুদ্ধ JSON ফরম্যাটে দাও — কোনো markdown code fence (\`\`\`), কোনো ব্যাখ্যা-বহির্ভূত টেক্সট ছাড়া:
{"options":["ভুল অপশন ১","ভুল অপশন ২","ভুল অপশন ৩"],"explanation":"ব্যাখ্যা..."}`;
}
/* ── Written/Study-এর জন্য শুধু ব্যাখ্যা বানানোর প্রম্পট ── */
function buildExplGenPrompt(q,correctAns){
  return `তুমি একজন বাংলা প্রশ্নপত্র বিশেষজ্ঞ।
নিচের প্রশ্ন আর তার উত্তর দেওয়া আছে। এর জন্য একটা সংক্ষিপ্ত (২-৪ বাক্যের) ব্যাখ্যা লিখো, যা এই উত্তরটা কেন সঠিক তা স্পষ্ট করবে।
প্রশ্ন: ${q}
উত্তর: ${correctAns}
শুধু নিচের বিশুদ্ধ JSON ফরম্যাটে দাও — কোনো markdown code fence, কোনো অতিরিক্ত টেক্সট ছাড়া:
{"explanation":"ব্যাখ্যা..."}`;
}
function parseGenResponse(text){
  let t=(text||"").trim();
  t=t.replace(/^```json/i,"").replace(/^```/,"").replace(/```\s*$/,"").trim();
  const start=t.indexOf("{"),end=t.lastIndexOf("}");
  if(start===-1||end===-1) throw new Error("AI response format ঠিক নেই");
  return JSON.parse(t.slice(start,end+1));
}
function locatedError(message,tabKey,cardId,field){
  const err=new Error(message);
  err.tabKey=tabKey; err.cardId=cardId; err.field=field||"topic";
  return err;
}
function shuffle4(arr){
  const a=[...arr];
  for(let i=a.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; }
  return a;
}

const PAPER_TABS = [
  { key:"bangla",  label:"বাংলা",  grouped:true,  gkStyle:false,
    subjectChoices:[{key:"grammar",name:"বাংলা ব্যাকরণ",short:"ব্যাকরণ"},{key:"literature",name:"বাংলা সাহিত্য",short:"সাহিত্য"}] },
  { key:"english", label:"ইংরেজি", grouped:true,  gkStyle:false,
    subjectChoices:[{key:"grammar",name:"English Grammar",short:"Grammar"},{key:"literature",name:"English Literature",short:"Literature"}] },
  { key:"math",    label:"গণিত",   fixedSubject:"গণিত",    grouped:false, gkStyle:false },
  { key:"gk",      label:"GK",     fixedSubject:null,      grouped:false, gkStyle:true  },
];

// 🐛 ফিক্স (হিজিবিজি/ভুল-ভাষার হিন্টস): আগে একটাই বাংলা-ভাষার FORMAT_STYLES লিস্ট
// সবগুলো ট্যাবে (ইংরেজি ট্যাবেও) দেখাতো, আর লেবেলে লম্বা বন্ধনী-উদাহরণ থাকায়
// ড্রপডাউন এলোমেলো দেখাতো। এখন ট্যাব অনুযায়ী ভাষা বেছে নেওয়া হয় (ইংরেজি ট্যাবে
// ইংরেজি লেবেল) আর লেবেল ছোট রাখা হয়েছে — পুরো বর্ণনা title (hover/long-press)-এ। ──
const FORMAT_STYLES_BN = [
  { v:"plain",     label:"Plain — সাধারণ প্রশ্ন-উত্তর",      title:"সাধারণ প্রশ্ন ও উত্তর" },
  { v:"table",     label:"Table — শব্দ | অর্থ",              title:"যেমন: সন্ধি বিচ্ছেদ — শব্দ ও তার ব্যাখ্যা দুই কলামে" },
  { v:"highlight", label:"Highlight — শব্দ মার্ক",           title:"যেমন: কারক নির্ণয় — বাক্যের নির্দিষ্ট অংশ বোল্ড/মার্ক করা" },
  { v:"fillblank", label:"Fill-blank — শূন্যস্থান",          title:"বাক্যের মাঝে ফাঁকা জায়গায় উত্তর বসে" },
];
const FORMAT_STYLES_EN = [
  { v:"plain",     label:"Plain — simple Q & A",     title:"Simple question and answer" },
  { v:"table",     label:"Table — word | meaning",   title:"e.g. word list — word and meaning in two columns" },
  { v:"highlight", label:"Highlight — mark a word",  title:"Mark/bold a specific part of the sentence" },
  { v:"fillblank", label:"Fill-blank — blank in sentence", title:"A blank inside the sentence takes the answer" },
];
const formatStylesFor=tabKey=>tabKey==="english"?FORMAT_STYLES_EN:FORMAT_STYLES_BN;

// 🆕 সরাসরি টাইপ করেই মার্ক করার শর্টকাট — 🖍 বাটনে চাপা বা আগে থেকে "ফরম্যাট"
// ড্রপডাউনে Highlight/Fill-blank বেছে নেওয়া বাধ্যতামূলক নয় আর। প্রশ্নের ভিতরে
// সরাসরি টাইপ করলেই ধরা পড়ে যাবে:
//   _শব্দ_    (একপাশে একটা করে আন্ডারস্কোর) → Fill-blank, ভেতরের অংশটাই Answer হয়ে সেভ হয়
//   *শব্দ*     (দুই পাশে একটা করে স্টার)     → Highlight/বোল্ড মার্ক (আলাদা Answer লাগবে)
// এই একই নিয়ম বাংলা ও ইংরেজি — দুই ক্ষেত্রেই। 🖍 বাটনটা এখনো আছে (টাচ-স্ক্রিনে
// সিলেক্ট-করে-মার্ক করা সহজ করার জন্য), কিন্তু এখন বাটনটাও ঠিক এই একই সিনট্যাক্স-ই বসায়
// (formatStyle অনুযায়ী _.._ বা *..*), তাই ম্যানুয়াল-টাইপ আর বাটন — দুই পথেই ফলাফল একই।
// 🐛 ফিক্স: শুরুতে ডাবল আন্ডারস্কোর (__..__) ছিল, কিন্তু ফিডব্যাকে চাওয়া হয়েছিল
// ঠিক একপাশে একটা করে (_..​_) — তাই মার্কার বদলানো হলো।
function detectAutoMarkup(text){
  const t=text||"";
  const blank=/_([^_]+)_/.exec(t);
  if(blank) return {style:"fillblank",answer:blank[1].trim()};
  const hl=/\*([^*]+)\*/.exec(t);
  if(hl) return {style:"highlight",answer:""};
  return {style:null,answer:""};
}

let _paperIdCounter=0;
const newPaperId=()=>"it_"+(++_paperIdCounter)+"_"+Date.now().toString(36);
// 🆕 qtype:"written"|"mcq" + opt1-4 — MCQ সাপোর্ট (AI দিয়ে ভুল অপশন জেনারেট করা,
// দেখো aiGenerateMcqOptions())। প্রতিটা সাব-পার্ট/flat কার্ড আলাদাভাবে Written বা
// MCQ হতে পারে — একই গ্রুপে দুই ধরনের প্রশ্ন মিশিয়ে থাকতে কোনো বাধা নেই।
const newPaperItem=()=>({id:newPaperId(),question:"",answer:"",explanation:"",technique:"",qtype:"written",opt1:"",opt2:"",opt3:"",opt4:""});
// 🐛 ফিক্স: আগে প্রতিটা নতুন গ্রুপ-কার্ডে ১টা মাত্র সাব-পার্ট (ক) নিয়ে শুরু হতো —
// সন্ধি/কারক/Idioms-এর মতো টপিকে প্রায় সবসময়ই ৫টা সাব-পার্ট (ক-ঙ) থাকে, তাই প্রতিবার
// "+ আরেকটা সাব-পার্ট" চাপা লাগতো। এখন ডিফল্টভাবে ৫টা খালি বক্স নিয়েই শুরু হয় —
// কম লাগলে পাশের ✕ বাটনে চেপে বাদ দেওয়া যায় (আগে থেকেই ছিল)।
const DEFAULT_SUBPARTS=5;
const newGroupCard=()=>({id:newPaperId(),formatStyle:"plain",heading:"",topicSel:{id:"",name:""},subjectChoice:"grammar",
  items:Array.from({length:DEFAULT_SUBPARTS},()=>newPaperItem())});
const newFlatCard=(isGk)=>({id:newPaperId(),question:"",answer:"",explanation:"",technique:"",qtype:"written",opt1:"",opt2:"",opt3:"",opt4:"",topicSel:{id:"",name:""},...(isGk?{subjectSel:{id:"",name:""}}:{})});
const makeInitialPaper=()=>({bangla:[newGroupCard()],english:[newGroupCard()],math:[newFlatCard(false)],gk:[newFlatCard(true)]});
const SUBLABELS=["ক","খ","গ","ঘ","ঙ","চ","ছ","জ","ঝ","ঞ","ট","ঠ","ড","ঢ"];

// 🆕 Topic মার্জ — বাংলা/ইংরেজি ট্যাবে ২টা আসল subject (ব্যাকরণ+সাহিত্য) থাকে, কিন্তু
// অ্যাডমিন প্রতিবার আলাদা করে subject বেছে টাইপ করতে চান না — Topic ড্রপডাউনে দুটো
// subject-এর টপিক একসাথে (নাম দিয়ে ডুপ্লিকেট বাদ) দেখানো হয়, সবচেয়ে বেশি ব্যবহৃত
// (row_count_qbank — GAS rebuildIndex থেকে আসা প্রশ্ন-সংখ্যা) টপিক সবার উপরে।
// টাইপ করলে TypeaheadCombo নিজেই এই লিস্টের মধ্যে ফিল্টার করে, মিল না পেলে নতুন
// তৈরি হবে (তখন card.subjectChoice — ডিফল্ট ব্যাকরণ/Grammar — অনুযায়ী subject ঠিক হয়)। ──
const topicUsage=t=>{ const n=parseInt(t&&t.row_count_qbank,10); return isNaN(n)?0:n; };
function mergedTopicOptionsFor(refData,subjIds){
  if(!refData||!subjIds||!subjIds.length) return [];
  const seen=new Map(); // norm(name) -> {id,name,usage,subject_id}
  (refData.topics||[]).forEach(t=>{
    if(!subjIds.includes(t.subject_id)) return;
    const key=norm(t.topic_name);
    const usage=topicUsage(t);
    const cur=seen.get(key);
    if(!cur||usage>cur.usage) seen.set(key,{id:t.topic_id,name:t.topic_name,usage,subject_id:t.subject_id});
  });
  return Array.from(seen.values()).sort((a,b)=>b.usage-a.usage||a.name.localeCompare(b.name,"bn"));
}

// 🐛 ফিক্স (হেডিং-Topic ম্যাচিং ভুল ছিল): আগে হেডিং থেকে বাদ দেওয়া নির্দেশনা-শব্দের
// পর যা বাকি থাকতো সেটাকেই হুবহু একটা "নতুন Topic" হিসেবে বসিয়ে দেওয়া হতো (যেমন
// "কারক নির্ণয় কর" থেকে "কারক নির্ণয় কর" নামেই একটা Topic!) — অথচ বিদ্যমান
// Topic-লিস্টে হয়তো "কারক ও বিভক্তি" নামে টপিকটা আগে থেকেই আছে। এখন আসল
// পদ্ধতি: হেডিং পরিষ্কার করে (নির্দেশনা-শব্দ বাদ দিয়ে) তার প্রতিটা শব্দ বিদ্যমান
// Topic-লিস্টের প্রতিটা অপশনের শব্দের সাথে মিলিয়ে স্কোর করা হয় (word-overlap) —
// সবচেয়ে বেশি মিল থাকা Topic-টাই বেছে নেওয়া হয় (কনফিডেন্ট মিল হলে তবেই)। ভালো
// মিল না পেলে Topic ফাঁকাই রাখা হয় — নতুন কোনো Topic নিজে থেকে তৈরি করা হয় না,
// অ্যাডমিন নিজে বেছে নেবে।
function headingToTopicGuess(heading){
  let s=(heading||"").toString().trim();
  if(!s) return "";
  // 🐛 ফিক্স: হেডিং প্রায়ই বাংলা দাঁড়ি (।) দিয়ে শেষ হয় (যেমন "কারক নির্ণয় কর।")
  // — আগে punctuation স্ট্রিপ করা হতো ক্রিয়া-রূপ বাদ দেওয়ার *আগে*, ফলে ক্রিয়া-রূপ
  // (কর/করো ইত্যাদি) স্ট্রিং-এর একদম শেষে না পড়ায় (পরে "।" থাকায়) regex ম্যাচই
  // করতো না। এখন punctuation স্ট্রিপ হয় ক্রিয়া-রূপ বাদ দেওয়ার আগে ও পরে — দুইবার।
  const stripPunct=x=>x.replace(/[:：\-–—,।৷.!?]+\s*$/,"").trim();
  s=stripPunct(s);
  s=s.replace(/(নির্ণয়|চিহ্নিত|প্রকাশ)?\s*(করু?ন|করো|কর|লিখু?ন|লিখো|লিখ|লেখ|বলু?ন|বলো|বল|দাও|দিন)\s*$/,"").trim();
  s=stripPunct(s);
  return s;
}
const normWordsBn=s=>norm(s).split(/\s+/).filter(Boolean);
function bestTopicMatchForHeading(heading,options){
  const cleaned=headingToTopicGuess(heading);
  if(!cleaned)return null;
  const hWords=normWordsBn(cleaned);
  if(!hWords.length)return null;
  let best=null,bestScore=0;
  (options||[]).forEach(opt=>{
    const oWords=normWordsBn(opt.name);
    if(!oWords.length)return;
    let score=0;
    hWords.forEach(hw=>{
      if(oWords.includes(hw))score+=2; // হুবহু শব্দ মিল
      else if(oWords.some(ow=>ow.length>=2&&hw.length>=2&&(ow.includes(hw)||hw.includes(ow))))score+=1; // আংশিক মিল
    });
    const normScore=score/Math.max(hWords.length,oWords.length);
    if(normScore>bestScore){ bestScore=normScore; best=opt; }
  });
  return bestScore>=0.5?best:null; // যথেষ্ট কনফিডেন্ট না হলে null (ফাঁকা থাকবে)
}

// ── PAPER COMPOSER-এর নিজস্ব হালকা "পরীক্ষার খাতা" থিম ("black a type kora jhamela") —
// বাকি অ্যাডমিন অ্যাপ ডার্ক-থিমে থাকলেও এই স্ক্রিনটা লেখাপড়ার/প্রুফ-রিডিং-এর জন্য
// ব্যবহার হয় বলে হালকা cream ব্যাকগ্রাউন্ড + গাঢ় নেভি টেক্সট — টাইপ করার সময় অনেক
// সহজ পড়া যায়, ডিজাইন-ডেমোর "📒 পরীক্ষার খাতা" কনসেপ্টের সাথে মিলিয়ে। ──
const PC = {
  bg:"#F5F1E6", card:"#FFFDF7", border:"#C9BFA0", ink:"#1B2A4A",
  muted:"#6B6552", gold:"#8A6D1D", danger:"#A6291F",
  answerBg:"#EAF1E4", answerText:"#2C4728", inputBg:"#FFFFFF",
};
const pcField = {background:PC.inputBg,border:`1px solid ${PC.border}`,color:PC.ink,borderRadius:9,padding:"9px 12px",fontFamily:"inherit",fontSize:13,width:"100%",outline:"none"};

function PaperComposer({gasSecret,refData,setRefData,refDataError,refDataLoading,onRetryRefData,push,sessionCount,setSessionCount,initialPaper,onConsumedInitialPaper}){
  // 🆕 initialPaper — OCR/Import পেজ থেকে প্রি-ফিল্ড ডেটা দিয়ে শুরু করার জন্য
  // (দেখো ocrToPaperConverter.js)। না দিলে আগের মতোই খালি অবস্থা থেকে শুরু হয়।
  const[paper,setPaper]=useState(()=>initialPaper||makeInitialPaper());
  // 🆕 একাধিক ছবি একে একে ইম্পোর্ট করলে প্রতিটাই বিদ্যমান paper-এ "যোগ" (append)
  // হওয়ার কথা — তাই এখানে কোনো "শুধু একবারই" ref-guard নেই। parent (OCR পেজ)
  // প্রতিটা নতুন ছবি প্রসেস হওয়ার পর initialPaper-কে একটা *নতুন* object reference
  // দেবে (আগেরটা consume হওয়ার পর null করে দিয়ে) — তাতেই এই effect আবার চলবে।
  // consumed হলে onConsumedInitialPaper() কল হয়, parent সেটা দেখে নিজের state
  // null/পরেরটার জন্য প্রস্তুত করে — একই ইম্পোর্ট দুইবার প্রয়োগ হওয়া আটকাতে।
  useEffect(()=>{
    if(!initialPaper)return;
    setPaper(p=>{
      // খালি paper হলে সরাসরি replace, নাহলে প্রতিটা ট্যাবে নতুন কার্ডগুলো যোগ (append) করা হয়
      const merged={...p};
      PAPER_TABS.forEach(t=>{
        const incoming=(initialPaper[t.key]||[]).filter(c=>
          t.grouped?(c.items||[]).some(it=>it.question.trim()):((c.question||"").trim())
        );
        if(!incoming.length)return;
        const existing=merged[t.key]||[];
        const existingEmpty=existing.length===1 && (t.grouped
          ?!(existing[0].items||[]).some(it=>it.question.trim())
          :!((existing[0].question||"").trim()));
        merged[t.key]=existingEmpty?incoming:[...existing,...incoming];
      });
      return merged;
    });
    onConsumedInitialPaper?.();
  },[initialPaper]);
  const[activeTab,setActiveTab]=useState("bangla");
  const[saving,setSaving]=useState(false);
  const[saveProgress,setSaveProgress]=useState(null); // {done,total} — সাবমিট চলাকালীন প্রোগ্রেস বার/শতকরা দেখানোর জন্য
  // 🐛 ফিক্স ("১টা মাত্র প্রশ্ন সাবমিট করতেও অনেকক্ষণ, প্রোগ্রেস বার নড়ে না, hang
  // মনে হয়"): saveProgress শুধু একটা চাংক (batch) *শেষ হওয়ার পরেই* আপডেট হয় — মাত্র
  // ১টা প্রশ্ন হলে পুরো সময়টাই ১টা চাংকের ভেতরে কাটে, তাই সাবমিট চলাকালীন বারটা
  // একদম নড়েই না (0% → হঠাৎ 100%), স্লো নেটওয়ার্কে এটাকে hang মনে হয়। এখন সাবমিট
  // শুরু হওয়ার পর থেকে সেকেন্ড গোনা হয় (elapsedMs) আর সেটার ওপর ভিত্তি করে একটা
  // "estimate" প্রোগ্রেস-শতকরা (আসল চাংক-প্রোগ্রেস না থাকলে) দেখানো হয়, যেটা সময়ের
  // সাথে সাথে ধীরে ধীরে বাড়তেই থাকে (কখনো ৯২%-এর বেশি ওঠে না যতক্ষণ না আসল রেসপন্স
  // আসে) — তাই বার সবসময় নড়তে থাকে, কখনো স্থির/hang মনে হয় না। সাথে সেকেন্ড-কাউন্টও
  // দেখানো হয়, যাতে বোঝা যায় অ্যাপ সক্রিয়ভাবে কাজ করছে। ──
  const[elapsedMs,setElapsedMs]=useState(0);
  const savingStartRef=useRef(null);
  useEffect(()=>{
    if(!saving){ setElapsedMs(0); savingStartRef.current=null; return; }
    savingStartRef.current=Date.now();
    const iv=setInterval(()=>setElapsedMs(Date.now()-savingStartRef.current),200);
    return ()=>clearInterval(iv);
  },[saving]);
  const textareaRefs=useRef({}); // প্রশ্ন-বক্স refs (itemId কী দিয়ে)
  const answerRefs=useRef({});   // উত্তর-বক্স refs (itemId কী দিয়ে) — Tab-ফ্লো-এর জন্য
  const flatQRefs=useRef({});    // math/GK ফ্ল্যাট-কার্ডের প্রশ্ন-বক্স refs (cardId কী দিয়ে)
  const flatARefs=useRef({});    // math/GK ফ্ল্যাট-কার্ডের উত্তর-বক্স refs (cardId কী দিয়ে)
  const pendingFocusRef=useRef(null); // {tab,cardId,flat?} — নতুন সাব-পার্ট/কার্ড যোগ হওয়ার পর অটো-ফোকাসের জন্য
  const[expandedItems,setExpandedItems]=useState(()=>new Set()); // কোন সাব-পার্টে ব্যাখ্যা/টেকনিক এক্সপ্যান্ড করা আছে
  const toggleExpand=id=>setExpandedItems(s=>{const n=new Set(s); n.has(id)?n.delete(id):n.add(id); return n;});

  const tabDef=PAPER_TABS.find(t=>t.key===activeTab);
  const subjectOptions=refData?(refData.subjects||[]).filter(s=>s.sheet==="QBank").map(s=>({id:s.subject_id,name:s.subject_name})):[];
  const topicOptionsFor=subjId=>refData&&subjId?(refData.topics||[]).filter(t=>t.subject_id===subjId).map(t=>({id:t.topic_id,name:t.topic_name})):[];

  // ── পদ/প্রতিষ্ঠান/সাল (Exam Appearance) — SingleQuestionEntryPage-এর পুরনো
  // (non-Paper) ফর্মে যেই প্যাটার্নটা already কাজ করছিল ঠিক সেটাই এখানে। সেশনজুড়ে
  // একবার সেট হয় (৪টা ট্যাব — বাংলা/English/Math/GK — সবগুলোতেই একই appearance
  // যাবে, কারণ এক পরীক্ষার কাগজে সব বিষয়ের প্রশ্নই একই পদ/প্রতিষ্ঠান/সালের)। posts/
  // institutions আলাদা reference sheet (আইডি সহ) — Subject/Topic-এর মতোই
  // resolveOrCreateReference দিয়ে resolve/create হয়, ExamAppearancesTab ও
  // BulkUploaderPage-এ যেভাবে হয় ঠিক সেই একই pattern। ──
  const[postSel,setPostSel]=useState({id:"",name:""});
  const[instSel,setInstSel]=useState({id:"",name:""});
  const[examYear,setExamYear]=useState("");
  const postOptions=refData?(refData.posts||[]).map(p=>({id:p.post_id,name:p.post_name})):[];
  const instOptions=refData?(refData.institutions||[]).map(i=>({id:i.institution_id,name:i.institution_name})):[];
  // 🆕 Audience Tags — কে এই প্রশ্ন দেখবে (Job/Masters 1/Class 7 ইত্যাদি, Tags শিট
  // থেকে)। "Job" ডিফল্টভাবে সিলেক্ট থাকে (QBank-এর বেশিরভাগ প্রশ্নই চাকরির
  // পরীক্ষার জন্য) — বদলাতে চাইলে চিপে ট্যাপ করে বদলানো যায় (মাল্টি-সিলেক্ট)।
  // Post/Institution-এর মতোই সেশন-জুড়ে থাকে, সব রো-তে একই ট্যাগ প্রযোজ্য হয়।
  const tagOptions=refData?(refData.tags||[]).map(tg=>({id:tg.tag_id,name:tg.tag_name})):[];
  const[selectedTagIds,setSelectedTagIds]=useState([]);
  const defaultTagAppliedRef=useRef(false);
  useEffect(()=>{
    if(defaultTagAppliedRef.current||!tagOptions.length)return;
    const job=tagOptions.find(tg=>norm(tg.name)==="job");
    if(job){ setSelectedTagIds([job.id]); defaultTagAppliedRef.current=true; }
  },[tagOptions.length]);
  const toggleTag=id=>setSelectedTagIds(ids=>ids.includes(id)?ids.filter(x=>x!==id):[...ids,id]);

  // ── ড্রাফট অটোসেভ — বড় প্রশ্নপত্র টাইপ করতে করতে (৪টা ট্যাব জুড়ে) হারিয়ে গেলে/
  // ব্যাক চাপা হলে/সাবমিট ব্যর্থ হলেও যেন আবার ঠিক যেখানে ছিল সেখান থেকেই এগিয়ে যাওয়া
  // যায় — এটাই ছিল সবচেয়ে জরুরি ফিডব্যাক ("এত কষ্ট করে লেখা হারালে খুব খারাপ লাগে")। ──
  const draftCheckedRef=useRef(false);
  const[draftBanner,setDraftBanner]=useState(null);
  const paperHasContent=p=>PAPER_TABS.some(t=>(p[t.key]||[]).some(c=>
    t.grouped?(c.items||[]).some(it=>it.question.trim()||it.answer.trim())
             :((c.question||"").trim()||(c.answer||"").trim()||(c.subjectSel&&c.subjectSel.name&&c.subjectSel.name.trim()))
  ));
  useEffect(()=>{
    if(draftCheckedRef.current)return;
    draftCheckedRef.current=true;
    const d=loadDraft(LS_DRAFT_PAPER);
    if(d&&d.paper&&paperHasContent(d.paper)) setDraftBanner(d);
  },[]);
  const restorePaperDraft=()=>{
    const d=draftBanner; if(!d)return;
    if(d.paper)setPaper(d.paper);
    if(d.activeTab)setActiveTab(d.activeTab);
    if(d.postSel)setPostSel(d.postSel);
    if(d.instSel)setInstSel(d.instSel);
    if(d.examYear!==undefined)setExamYear(d.examYear);
    setDraftBanner(null);
    push("success","♻️ আগের প্রশ্নপত্রের ড্রাফট ফিরিয়ে আনা হলো","");
  };
  const discardPaperDraft=()=>{ clearDraft(LS_DRAFT_PAPER); setDraftBanner(null); };
  useEffect(()=>{
    if(!draftCheckedRef.current || draftBanner) return;
    if(saving) return;
    const t=setTimeout(()=>{
      if(paperHasContent(paper)) saveDraft(LS_DRAFT_PAPER,{paper,activeTab,postSel,instSel,examYear});
      else clearDraft(LS_DRAFT_PAPER);
    },800);
    return ()=>clearTimeout(t);
  },[paper,activeTab,postSel,instSel,examYear,saving,draftBanner]);

  // ── 🆕 নামসহ একাধিক খসড়া — উপরের অটো-ড্রাফট (LS_DRAFT_PAPER) শুধু ১টা "চলতি
  // সেশন" স্লট, নিঃশব্দে ওভাররাইট হয়। কিন্তু একসাথে একাধিক প্রশ্নপত্র নিয়ে কাজ
  // করলে (যেমন একটা পদ/প্রতিষ্ঠানের কাজ অর্ধেক রেখে অন্যটায় সুইচ করা) দরকার হয়
  // একাধিক খসড়া আলাদাভাবে জমা রাখার — তাই এই আলাদা তালিকা (localStorage-এ
  // LS_DRAFT_PAPER_LIST), প্রতিটা এন্ট্রি Post+Institution+সাল দিয়ে হেডলাইন করা,
  // সবচেয়ে নতুনটা সবার উপরে (savedAt অনুযায়ী descending sort)। ──
  const[draftList,setDraftList]=useState(()=>{
    try{ const raw=localStorage.getItem(LS_DRAFT_PAPER_LIST); const arr=raw?JSON.parse(raw):[]; return Array.isArray(arr)?arr:[]; }catch{ return []; }
  });
  const[showDraftList,setShowDraftList]=useState(false);
  const persistDraftList=(list)=>{
    setDraftList(list);
    try{ localStorage.setItem(LS_DRAFT_PAPER_LIST,JSON.stringify(list)); }catch{}
  };
  const saveNamedDraft=()=>{
    if(!paperHasContent(paper)){ push("warn","এখনো কিছু টাইপ করা হয়নি","আগে কিছু প্রশ্ন টাইপ করো, তারপর খসড়া সেভ করো"); return; }
    const entry={id:newPaperId(),savedAt:Date.now(),paper,activeTab,postSel,instSel,examYear};
    persistDraftList([entry,...draftList].slice(0,15)); // ১৫টার বেশি জমতে দেওয়া হয় না
    push("success","💾 নতুন খসড়া হিসেবে সেভ হলো",draftHeadline(entry));
  };
  const loadNamedDraft=(entry)=>{
    setPaper(entry.paper);
    if(entry.activeTab)setActiveTab(entry.activeTab);
    if(entry.postSel)setPostSel(entry.postSel);
    if(entry.instSel)setInstSel(entry.instSel);
    if(entry.examYear!==undefined)setExamYear(entry.examYear);
    setShowDraftList(false);
    push("success","♻️ খসড়া লোড হলো",draftHeadline(entry));
  };
  const deleteNamedDraft=(id)=>{ persistDraftList(draftList.filter(d=>d.id!==id)); };
  function draftHeadline(d){
    const p=((d.postSel&&d.postSel.name)||"").trim();
    const i=((d.instSel&&d.instSel.name)||"").trim();
    const y=(d.examYear||"").toString().trim();
    const parts=[p,i].filter(Boolean);
    let label=parts.length?parts.join(" — "):"নাম-ছাড়া খসড়া";
    if(y)label+=` (${y})`;
    return label;
  }
  function draftQCount(d){
    let n=0;
    PAPER_TABS.forEach(t=>{
      (d.paper[t.key]||[]).forEach(c=>{
        if(t.grouped) n+=(c.items||[]).filter(it=>it.question.trim()).length;
        else if((c.question||"").trim()) n+=1;
      });
    });
    return n;
  }
  function fmtDraftTime(ms){
    try{ return new Date(ms).toLocaleString("bn-BD",{day:"2-digit",month:"short",hour:"2-digit",minute:"2-digit"}); }
    catch{ return new Date(ms).toLocaleString(); }
  }

  const setCards=(tab,updater)=>setPaper(p=>({...p,[tab]:updater(p[tab])}));
  const updateCard=(tab,cardId,patch)=>setCards(tab,cards=>cards.map(c=>c.id===cardId?{...c,...patch}:c));
  const removeCard=(tab,cardId)=>setCards(tab,cards=>cards.length>1?cards.filter(c=>c.id!==cardId):cards);
  const addCard=tab=>setCards(tab,cards=>[...cards,tab==="math"?newFlatCard(false):tab==="gk"?newFlatCard(true):newGroupCard()]);
  const updateItem=(tab,cardId,itemId,patch)=>setCards(tab,cards=>cards.map(c=>c.id===cardId?{...c,items:c.items.map(it=>it.id===itemId?{...it,...patch}:it)}:c));
  const addSubItem=(tab,cardId)=>setCards(tab,cards=>cards.map(c=>c.id===cardId?{...c,items:[...c.items,newPaperItem()]}:c));
  const removeSubItem=(tab,cardId,itemId)=>setCards(tab,cards=>cards.map(c=>c.id===cardId?{...c,items:c.items.length>1?c.items.filter(it=>it.id!==itemId):c.items}:c));

  /* ── 🆕 MCQ AI-generate — বিদ্যমান plain single-form-এই যেই generate()/
     buildMcqGenPrompt()/parseGenResponse()/shuffle4() ব্যবহার হয় (উপরে দেখো,
     ফাইলের শুরুতেই সংজ্ঞায়িত, module-scope) — ঠিক সেই একই ফাংশনগুলো এখানেও
     রিইউজ করা হচ্ছে, যাতে দুই জায়গায় একই AI-prompt/লজিক আলাদা করে না লিখতে হয়।
     শুধু প্রশ্ন + সঠিক উত্তর দিলেই ৩টা ভুল অপশন (distractor) বানিয়ে opt1-4-এ
     এলোমেলো ক্রমে বসিয়ে দেয় — অপশন নিজে টাইপ করা লাগে না। ── */
  const[mcqGeneratingId,setMcqGeneratingId]=useState(null);
  // 🆕 সাবমিট করলে "Topic ফাঁকা" এরর টোস্টে দেখা যেত ঠিকই, কিন্তু একাধিক কার্ডের
  // মধ্যে ঠিক কোনটা ফাঁকা সেটা খুঁজে বের করা কষ্টকর ছিল। এখন এরর হলে সরাসরি সেই
  // Topic ফিল্ডে স্ক্রল করে (দরকারে ট্যাব বদলে) নিয়ে যাওয়া হয় + কিছুক্ষণ লাল
  // হাইলাইট করে দেখানো হয়। ঠিক করে আবার সাবমিট করলে (একাধিক ফাঁকা থাকলে) পরেরটা
  // পাওয়া যাবে — কারণ প্রতিবার সাবমিটে প্রথম থেকেই নতুন করে ভ্যালিডেশন চলে।
  const topicRefs=useRef({}); // cardId -> DOM element (Topic ফিল্ড wrapper)
  const subjectFieldRefs=useRef({}); // cardId -> DOM element (GK Subject ফিল্ড wrapper)
  const[highlightCardId,setHighlightCardId]=useState(null);
  const[highlightField,setHighlightField]=useState("topic");
  const flyToCard=(tabKey,cardId,field)=>{
    setActiveTab(tabKey);
    setHighlightCardId(cardId);
    setHighlightField(field||"topic");
    // ট্যাব বদলের পর নতুন ট্যাবের DOM রেন্ডার হতে এক টিক সময় দেওয়া হচ্ছে
    requestAnimationFrame(()=>{
      setTimeout(()=>{
        const refMap=field==="subject"?subjectFieldRefs:topicRefs;
        refMap.current[cardId]?.scrollIntoView({behavior:"smooth",block:"center"});
      },60);
    });
    setTimeout(()=>setHighlightCardId(h=>h===cardId?null:h),2600);
  };
  const generateMcqOptions=async(tab,cardId,itemId,question,answer,isFlat)=>{
    if(!question.trim()||!answer.trim()){ push("warn","আগে প্রশ্ন ও সঠিক উত্তর লিখো",""); return; }
    if(!buildKeyPool().length){ push("warn","⚠️ কোনো AI provider active নেই","API Settings-এ গিয়ে অন্তত একটা key active করো"); return; }
    setMcqGeneratingId(itemId);
    try{
      const raw=await callAiProviderRotatingRaw(buildMcqGenPrompt(question,answer));
      const parsed=parseGenResponse(raw);
      const distractors=(parsed.options||[]).slice(0,3);
      while(distractors.length<3) distractors.push("");
      const[a,b,c,d]=shuffle4([answer,...distractors]);
      const patch={opt1:a,opt2:b,opt3:c,opt4:d};
      if(isFlat) updateCard(tab,cardId,patch); else updateItem(tab,cardId,itemId,patch);
      push("success","🤖 অপশন তৈরি হয়েছে","চেক করে দরকার হলে ঠিক করে নাও");
    }catch(e){ push("error","Generate ব্যর্থ",e.message); }
    setMcqGeneratingId(null);
  };

  /* ── 🖍 মার্ক — টেক্সট সিলেক্ট করে এই বাটন চাপলে সিলেকশনটা মার্ক হয়ে যায়।
     🆕 এখন formatStyle অনুযায়ী দুই রকম মার্কার — fillblank হলে __..__ (ভেতরের
     অংশটাই Answer হিসেবে অটো সেভ হয়), আর highlight হলে *..* (শুধু bold/মার্ক,
     Answer আলাদা বক্সে লিখতে হয়)। এই একই সিনট্যাক্স সরাসরি টাইপ করলেও (বাটন না
     চেপে) সাবমিটের সময় অটো-ধরা পড়ে যায় — দেখো detectAutoMarkup(), submitPaper()। ── */
  const wrapHighlight=(tab,cardId,itemId,formatStyle)=>{
    const el=textareaRefs.current[itemId];
    if(!el)return;
    const start=el.selectionStart, end=el.selectionEnd;
    if(start===end){ push("warn","আগে যে শব্দ/অংশ মার্ক করবে সেটা সিলেক্ট করো",""); return; }
    const val=el.value;
    const marker=formatStyle==="fillblank"?"_":"*";
    const newVal=val.slice(0,start)+marker+val.slice(start,end)+marker+val.slice(end);
    updateItem(tab,cardId,itemId,{question:newVal});
    requestAnimationFrame(()=>{ el.focus(); const p=end+marker.length*2; el.setSelectionRange(p,p); });
  };

  /* ── Tab-ফ্লো: প্রশ্ন-বক্সে Tab → সাথে সাথে উত্তর-বক্সে; উত্তর-বক্সে Tab → পরের
     সাব-পার্টের প্রশ্ন-বক্সে (শেষ সাব-পার্ট হলে নতুন একটা যোগ করে সেখানেই ফোকাস) —
     মাঝে ব্যাখ্যা/টেকনিক (ঐচ্ছিক, এখন ডিফল্টভাবে hidden/collapsed) বাদ পড়ে যায়,
     তাই বাধ্যতামূলক নয় এমন বক্সে বারবার Tab চেপে যেতে হয় না।
     🐛 ফিক্স (Fill-blank সিলেক্ট করলে Tab কাজ করতো না): Fill-blank মোডে answer
     ইনপুট-বক্সটাই DOM-এ render হয় না (বদলে একটা হিন্ট-মেসেজ দেখায়), কিন্তু আগে
     প্রশ্ন-বক্সে Tab চাপলে সবসময় answerRefs.current[itemId]?.focus() ট্রাই করতো —
     সেই ref কখনো সেট-ই হতো না, তাই focus() নিঃশব্দে fail করতো, আর e.preventDefault()
     করার কারণে ব্রাউজারের ডিফল্ট Tab-ও কাজ করতো না — কার্সর কোথাও যেতোই না। এখন
     Fill-blank (বা auto-detected _blank_) হলে প্রশ্ন-বক্স থেকে Tab সরাসরি পরের
     সাব-পার্টের প্রশ্ন-বক্সে (বা শেষ হলে নতুন সাব-পার্ট) নিয়ে যায় — উত্তর-বক্স
     ডিঙিয়ে, ঠিক যেমনটা উত্তর-বক্স থেকে Tab করলে হতো। ── */
  const goToNextSubItem=(tab,cardId,items,idx)=>{
    if(idx<items.length-1){
      textareaRefs.current[items[idx+1].id]?.focus();
    } else {
      pendingFocusRef.current={tab,cardId,flat:false};
      addSubItem(tab,cardId);
    }
  };
  const handleGroupQKeyDown=(e,tab,cardId,items,idx,isFillblank)=>{
    if(e.key==="Tab"&&!e.shiftKey){
      e.preventDefault();
      if(isFillblank){
        goToNextSubItem(tab,cardId,items,idx);
      } else {
        answerRefs.current[items[idx].id]?.focus();
      }
    }
  };
  const handleGroupAKeyDown=(e,tab,cardId,items,idx)=>{
    if(e.key==="Tab"&&!e.shiftKey){ e.preventDefault(); goToNextSubItem(tab,cardId,items,idx); }
  };
  const handleFlatQKeyDown=(e,cardId)=>{
    if(e.key==="Tab"&&!e.shiftKey){ e.preventDefault(); flatARefs.current[cardId]?.focus(); }
  };
  const handleFlatAKeyDown=(e,tab,cardId,cards,idx)=>{
    if(e.key==="Tab"&&!e.shiftKey){
      e.preventDefault();
      if(idx<cards.length-1){
        flatQRefs.current[cards[idx+1].id]?.focus();
      } else {
        pendingFocusRef.current={tab,cardId,flat:true};
        addCard(tab);
      }
    }
  };
  // নতুন সাব-পার্ট/কার্ড যোগ হওয়ার পর (উপরের Tab-ফ্লো থেকে) সেখানেই কার্সর নিয়ে যাওয়া
  useEffect(()=>{
    const req=pendingFocusRef.current;
    if(!req)return;
    const cards=paper[req.tab]||[];
    const card=cards.find(c=>c.id===req.cardId);
    if(!card){ pendingFocusRef.current=null; return; }
    if(req.flat){
      // addCard-এ নতুন কার্ড এই কার্ডের পরে যোগ হয় — শেষ কার্ডটাই নতুন কার্ড
      const lastCard=cards[cards.length-1];
      requestAnimationFrame(()=>flatQRefs.current[lastCard.id]?.focus());
    } else if(card.items&&card.items.length){
      const lastItem=card.items[card.items.length-1];
      requestAnimationFrame(()=>textareaRefs.current[lastItem.id]?.focus());
    }
    pendingFocusRef.current=null;
  },[paper]);

  const tabCount=key=>{
    const def=PAPER_TABS.find(t=>t.key===key);
    return (paper[key]||[]).reduce((s,c)=>s+(def.grouped?(c.items||[]).filter(it=>it.question.trim()).length:(c.question.trim()?1:0)),0);
  };
  const totalCount=PAPER_TABS.reduce((s,t)=>s+tabCount(t.key),0);

  const submitPaper=useCallback(async()=>{
    if(saving)return;
    if(!gasSecret){ push("warn","⚠️ GAS Secret Key দাও","Save Location প্যানেলে বসাও"); return; }
    const total=PAPER_TABS.reduce((s,t)=>s+tabCount(t.key),0);
    if(total===0){ push("warn","কোনো প্রশ্নই টাইপ করা হয়নি",""); return; }
    // 🐛 ফিক্স: বাটন disable করলেও Ctrl+S শর্টকাট সরাসরি submitPaper কল করে — তাই এখানেও
    // গার্ড লাগবে, নাহলে দ্রুত Ctrl+S চাপলে refData লোড হওয়ার আগেই সাবমিট হয়ে ডুপ্লিকেট
    // Subject তৈরি হয়ে যেতে পারে (দেখো বাটনের ওপরের কমেন্ট)।
    if(refData===null){ push("warn","⏳ রেফারেন্স ডেটা এখনো লোড হচ্ছে","একটু অপেক্ষা করে আবার চেষ্টা করো"); return; }
    // পদ/প্রতিষ্ঠান/সাল — একটাতেও কিছু টাইপ করা থাকলে তিনটাই লাগবে (নাহলে অসম্পূর্ণ
    // Appearance তৈরি হয়ে যাবে), অথবা তিনটাই ফাঁকা রেখে Appearance ছাড়াই সাবমিট করা যাবে।
    if(postSel.name.trim()||instSel.name.trim()||examYear.trim()){
      if(!postSel.name.trim()||!instSel.name.trim()||!examYear.trim()){
        push("warn","⚠️ পদ, প্রতিষ্ঠান ও সাল — একটা দিলে তিনটাই দিতে হবে (অথবা তিনটাই খালি রাখো)","");
        return;
      }
    }
    setSaving(true);
    setSaveProgress(null);
    // 🐛 ফিক্স: সাবমিট শুরুর সাথে সাথেই ড্রাফট (debounce ছাড়া, তৎক্ষণাৎ) সেভ করে রাখা
    // হচ্ছে — নেটওয়ার্ক স্লো হয়ে সাবমিট আটকে থাকলে বা মাঝপথে ব্যর্থ হলেও পুরো
    // প্রশ্নপত্র (paper) ইতিমধ্যে localStorage-এ নিরাপদ থাকবে, অ্যাপ বন্ধ করে দিলেও হারাবে না।
    saveDraft(LS_DRAFT_PAPER,{paper,activeTab,postSel,instSel,examYear});
    try{
      // পদ/প্রতিষ্ঠান দেওয়া থাকলে সবার আগে resolve/create করা হচ্ছে — ঠিক Subject/Topic-এর
      // মতোই resolveOrCreateReference দিয়ে (ExamAppearancesTab/BulkUploaderPage-এ যেভাবে
      // হয় সেই একই pattern), যাতে নিচের লুপে ঢোকার আগেই Appearance নিশ্চিত হয়ে যায়।
      let examAppearance=null;
      if(postSel.name.trim()&&instSel.name.trim()&&examYear.trim()){
        const postRes=await resolveOrCreateReference({sel:postSel,refType:"posts",options:postOptions,gasSecret,push});
        if(!postRes.ok)throw new Error("পদ resolve/তৈরি ব্যর্থ");
        const instRes=await resolveOrCreateReference({sel:instSel,refType:"institutions",options:instOptions,gasSecret,push});
        if(!instRes.ok)throw new Error("প্রতিষ্ঠান resolve/তৈরি ব্যর্থ");
        examAppearance={postId:postRes.id,institutionId:instRes.id,year:examYear.trim()};
        if(postRes.created||instRes.created) fetchReferenceData({gasSecret}).then(setRefData).catch(()=>{});
      }

      // 🐛 ফিক্স: আগে শুধু fixedSubject (বাংলা/English/গণিত)-এর জন্য cache ছিল —
      // GK ট্যাবে প্রতিটা কার্ডে subjectSel.id ফাঁকা হলে (নতুন real subject, যেমন
      // "সাধারণ বিজ্ঞান" প্রথমবার টাইপ করে একাধিক প্রশ্নে ব্যবহার করলে) প্রতিবার আলাদা
      // addReferenceItem কল হতো — refData রিফ্রেশ না হওয়া পর্যন্ত প্রতিটা কার্ডই
      // "নতুন" ধরে নিতো, ফলে একই নামের ডুপ্লিকেট Subject তৈরি হয়ে যেতে পারতো। Topic-এও
      // (একই grouped/flat ব্যাচে একই নতুন Topic-নাম একাধিক কার্ডে থাকলে) একই সমস্যা।
      // এখন Subject+Topic দুটোরই resolve এই একটাই cache-এর মধ্য দিয়ে যায় — পুরো
      // submitPaper কলজুড়ে একই নাম দ্বিতীয়বার এলে নেটওয়ার্কে না গিয়ে আগের id-ই রিইউজ হয়। ──
      const subjectIdCache={};
      const resolveSubjectCached=async name=>{
        const key=norm(name);
        if(subjectIdCache[key])return subjectIdCache[key];
        const res=await resolveOrCreateReference({sel:{id:"",name},refType:"subjects",options:subjectOptions,gasSecret,sheet:"QBank",push});
        if(!res.ok)throw new Error(`"${name}" Subject resolve ব্যর্থ`);
        subjectIdCache[key]=res.id;
        return res.id;
      };
      const resolveFixedSubject=name=>resolveSubjectCached(name);

      const topicIdCache={};
      const resolveTopicCached=async(subjId,topicSel)=>{
        const topicName=topicSel.name.trim();
        if(!topicName)return null;
        const key=subjId+"|"+norm(topicName);
        if(topicIdCache[key])return topicIdCache[key];
        const res=await resolveOrCreateReference({sel:topicSel,refType:"topics",options:topicOptionsFor(subjId),gasSecret,parentId:subjId,push});
        if(!res.ok)return null;
        topicIdCache[key]=res.id;
        return res.id;
      };

      // 🆕 Audience Tags — এই সেশনে যেই ট্যাগ(গুলো) বাছা আছে (ডিফল্ট "Job"),
      // সব রো-তেই একই ট্যাগ প্রযোজ্য হয় (post/institution/year-এর মতোই session-wide)।
      const selectedTagNames=selectedTagIds.map(id=>(tagOptions.find(tg=>tg.id===id)||{}).name).filter(Boolean);
      const allRows=[];
      for(const t of PAPER_TABS){
        for(const card of (paper[t.key]||[])){
          if(t.grouped){
            const validItems=(card.items||[]).filter(it=>it.question.trim());
            if(!validItems.length)continue;
            // 🐛 ফিক্স (ভুল/ডুপ্লিকেট Subject): t.subjectChoices থাকলে (বাংলা/ইংরেজি ট্যাব)
            // এই কার্ডের প্রশ্নগুলো ২টা আসল subject-এর (ব্যাকরণ/সাহিত্য) কোনটার নিচে
            // যাবে সেটা এই ক্রমে ঠিক হয় — ১) Topic ড্রপডাউন থেকে বেছে নেওয়া হলে সেই
            // টপিক আসলে যেই subject-এর নিচে আছে সেটাই (সবচেয়ে নির্ভরযোগ্য), ২) টাইপ করা
            // নাম যদি হুবহু কোনো বিদ্যমান টপিকের সাথে মেলে (২টা subject-এর যেকোনোটাতে)
            // সেটাই, ৩) সম্পূর্ণ নতুন টপিক হলে card.subjectChoice টগল (ডিফল্ট ব্যাকরণ/
            // Grammar) অনুযায়ী — এতে একই নামের টপিক দুইবার (দুই subject-এ) তৈরি হয়ে
            // যাওয়ার সুযোগ নেই।
            let subjId,subjName;
            if(t.subjectChoices){
              const pairSubjIds=await Promise.all(t.subjectChoices.map(c=>resolveSubjectCached(c.name)));
              const topicNameRaw=card.topicSel.name.trim();
              let chosenSubjId=null;
              if(card.topicSel.id){
                const ex=(refData.topics||[]).find(tp=>tp.topic_id===card.topicSel.id);
                if(ex) chosenSubjId=ex.subject_id;
              }
              if(!chosenSubjId && topicNameRaw){
                const nameNorm=norm(topicNameRaw);
                const ex=(refData.topics||[]).find(tp=>pairSubjIds.includes(tp.subject_id)&&norm(tp.topic_name)===nameNorm);
                if(ex) chosenSubjId=ex.subject_id;
              }
              if(!chosenSubjId){
                const idx=t.subjectChoices.findIndex(c=>c.key===card.subjectChoice);
                chosenSubjId=pairSubjIds[idx>=0?idx:0];
              }
              subjId=chosenSubjId;
              subjName=(refData.subjects||[]).find(s=>s.subject_id===subjId)?.subject_name||t.subjectChoices[0].name;
            } else {
              subjId=await resolveSubjectCached(t.fixedSubject);
              subjName=t.fixedSubject;
            }
            const topicName=card.topicSel.name.trim();
            if(!topicName)throw locatedError(`"${t.label}" ট্যাবে একটা কার্ডে Topic ফাঁকা আছে — Topic লিখো/বেছে নাও`,t.key,card.id);
            const topicId=await resolveTopicCached(subjId,card.topicSel);
            if(!topicId)throw new Error(`"${topicName}" Topic resolve ব্যর্থ`);
            const heading=card.heading.trim();
            const groupId=heading?("GRP_"+Date.now().toString(36).toUpperCase()+Math.random().toString(36).slice(2,6).toUpperCase()):"";
            // 🐛 ফিক্স (Fill-blank/Highlight): এখন formatStyle ড্রপডাউন থেকে বেছে নেওয়া বা
            // 🖍 বাটনে চাপা — কোনোটাই বাধ্যতামূলক না। প্রশ্নের টেক্সটে সরাসরি টাইপ করা
            // _শব্দ_ (blank, একপাশে একটা করে আন্ডারস্কোর) বা *শব্দ* (highlight) থাকলেই
            // detectAutoMarkup() সেটা ধরে ফেলে আর card.formatStyle-কে override করে —
            // টাইপ করেই সহজ এপের ডাটাবেজ-নিয়ম অনুযায়ী সেভ হয়ে যায়, আলাদা করে বাটনে
            // ক্লিক/ড্রপডাউন বদলানো লাগে না। ──
            validItems.forEach((it,idx)=>{
              // 🆕 MCQ: fillblank/highlight অটো-মার্কআপ অপ্রাসঙ্গিক (question-এর
              // ভিতরে _..._/*..* থাকলেও MCQ-তে সেটা প্লেইন টেক্সট হিসেবেই থাকবে,
              // ব্যাখ্যা/টেকনিক ছাড়া বাকি সব সাধারণ MCQ রো-এর মতো)।
              if(it.qtype==="mcq"){
                const opts=[it.opt1,it.opt2,it.opt3,it.opt4].map(o=>o.trim());
                if(opts.some(o=>!o))throw new Error(`"${t.label}" ট্যাবে একটা MCQ প্রশ্নে ৪টা অপশনের কোনোটা ফাঁকা — 🤖 Generate চাপো অথবা নিজে পূরণ করো`);
                const ansTrim=it.answer.trim();
                if(!ansTrim)throw new Error(`"${t.label}" ট্যাবে একটা MCQ প্রশ্নে সঠিক উত্তর ফাঁকা`);
                if(!opts.some(o=>norm(o)===norm(ansTrim)))throw new Error(`"${t.label}" ট্যাবে একটা MCQ প্রশ্নে সঠিক উত্তর ৪টা অপশনের কোনোটার সাথেই মিলছে না`);
                allRows.push(buildSheetRow({
                  item:{q:it.question.trim(),correct:ansTrim,opt1:opts[0],opt2:opts[1],opt3:opts[2],opt4:opts[3],explanation:it.explanation,technique:it.technique},
                  subject:subjName,subtopic:topicName,qtype:"MCQ",
                  audienceTags:selectedTagNames,tagIds:selectedTagIds,mainQpaper:"",subjectId:subjId,topicId,
                  groupId,subIndex:groupId?(idx+1):null,groupHeading:groupId?heading:"",
                  formatStyle:"",
                }));
                return;
              }
              let ansText=it.answer.trim();
              let effFormat=card.formatStyle;
              const auto=detectAutoMarkup(it.question);
              if(auto.style==="fillblank"){
                ansText=auto.answer;
                effFormat="fillblank";
              } else if(auto.style==="highlight"){
                effFormat=effFormat==="table"?effFormat:"highlight";
              } else if(card.formatStyle==="fillblank"){
                const m=/_([^_]+)_/.exec(it.question);
                if(!m)throw new Error(`"${t.label}" ট্যাবে Fill-blank ফরম্যাটে একটা প্রশ্নে 🖍 মার্ক করা হয়নি — যে শব্দ/অংশ blank হবে সেটা সিলেক্ট করো, অথবা সরাসরি _শব্দ_ লিখো`);
                ansText=m[1].trim();
              }
              allRows.push(buildSheetRow({
                item:{q:it.question.trim(),correct:ansText,explanation:it.explanation,technique:it.technique},
                subject:subjName,subtopic:topicName,qtype:"Written",
                audienceTags:selectedTagNames,tagIds:selectedTagIds,mainQpaper:"",subjectId:subjId,topicId,
                groupId,subIndex:groupId?(idx+1):null,groupHeading:groupId?heading:"",
                formatStyle:effFormat!=="plain"?effFormat:"",
              }));
            });
          } else {
            if(!card.question.trim())continue;
            let subjId;
            if(t.gkStyle){
              const subjName=(card.subjectSel.name||"").trim();
              if(!subjName)throw locatedError(`GK ট্যাবে একটা প্রশ্নে Subject ফাঁকা আছে — কোন real subject (যেমন "সাধারণ বিজ্ঞান") সেটা বেছে দাও`,t.key,card.id,"subject");
              subjId=await resolveSubjectCached(subjName);
            } else {
              subjId=await resolveFixedSubject(t.fixedSubject);
            }
            const topicName=card.topicSel.name.trim();
            if(!topicName)throw locatedError(`"${t.label}" ট্যাবে একটা প্রশ্নে Topic ফাঁকা আছে`,t.key,card.id);
            const topicId=await resolveTopicCached(subjId,card.topicSel);
            if(!topicId)throw new Error(`"${topicName}" Topic resolve ব্যর্থ`);
            if(card.qtype==="mcq"){
              const opts=[card.opt1,card.opt2,card.opt3,card.opt4].map(o=>o.trim());
              if(opts.some(o=>!o))throw new Error(`"${t.label}" ট্যাবে একটা MCQ প্রশ্নে ৪টা অপশনের কোনোটা ফাঁকা — 🤖 Generate চাপো অথবা নিজে পূরণ করো`);
              const ansTrim=card.answer.trim();
              if(!ansTrim)throw new Error(`"${t.label}" ট্যাবে একটা MCQ প্রশ্নে সঠিক উত্তর ফাঁকা`);
              if(!opts.some(o=>norm(o)===norm(ansTrim)))throw new Error(`"${t.label}" ট্যাবে একটা MCQ প্রশ্নে সঠিক উত্তর ৪টা অপশনের কোনোটার সাথেই মিলছে না`);
              allRows.push(buildSheetRow({
                item:{q:card.question.trim(),correct:ansTrim,opt1:opts[0],opt2:opts[1],opt3:opts[2],opt4:opts[3],explanation:card.explanation,technique:card.technique},
                subject:t.gkStyle?card.subjectSel.name.trim():t.fixedSubject,subtopic:topicName,qtype:"MCQ",
                audienceTags:selectedTagNames,tagIds:selectedTagIds,mainQpaper:"",subjectId:subjId,topicId,
                groupId:"",subIndex:null,groupHeading:"",formatStyle:"",
              }));
              continue;
            }
            allRows.push(buildSheetRow({
              item:{q:card.question.trim(),correct:card.answer.trim(),explanation:card.explanation,technique:card.technique},
              subject:t.gkStyle?card.subjectSel.name.trim():t.fixedSubject,subtopic:topicName,qtype:"Written",
              audienceTags:selectedTagNames,tagIds:selectedTagIds,mainQpaper:"",subjectId:subjId,topicId,
              groupId:"",subIndex:null,groupHeading:"",formatStyle:"",
            }));
          }
        }
      }

      if(!allRows.length){ push("warn","কোনো সম্পূর্ণ প্রশ্ন পাওয়া যায়নি","Topic ফাঁকা রাখলে সেই প্রশ্ন বাদ পড়ে যায়"); setSaving(false); return; }

      // 🐛 ফিক্স (কোনো progress bar না থাকা): ছোট চাংক (১৫টা করে) + onProgress দিয়ে
      // সাবমিট বাটনে লাইভ "X/Y (NN%)" আর একটা ভিজুয়াল প্রোগ্রেস বার দেখানো হয় —
      // "সেভ হচ্ছে..." লেখা একনাগাড়ে দেখে ধৈর্য হারিয়ে অ্যাপ বন্ধ করে দেওয়ার সমস্যা
      // এখন থেকে কমবে (নিচে UI-তে দেখো)।
      const res=await saveRowsToSheet({
        rows:allRows,targetTab:"QBank",gasSecret,push,examAppearance,source:"Single_Text_Paper",
        chunkSize:15,onProgress:p=>setSaveProgress(p),
      });
      const failedCount=(res.failedRows||[]).length;
      if(res.added>0){
        push("success",`✅ ${failedCount>0?`আংশিক সাবমিট হয়েছে (${res.added}টা)`:"পুরো প্রশ্নপত্র সাবমিট হয়েছে!"} (${res.added}টা প্রশ্ন)`,`এই সেশনে মোট ${sessionCount+res.added}টি`);
        setSessionCount(c=>c+res.added);
        fetchReferenceData({gasSecret}).then(setRefData).catch(()=>{});
      }
      if(res.examAppearancesLinkedToExisting>0) push("success","🔗 কিছু প্রশ্ন আগে থেকেই QBank-এ ছিল","নতুন করে যোগ হয়নি — শুধু এই পদ/প্রতিষ্ঠান/সালের Appearance জুড়ে দেওয়া হয়েছে");
      if(examAppearance && !res.examAppearancesAdded && !res.examAppearancesLinkedToExisting) push("warn","⚠️ প্রশ্ন সেভ হয়েছে কিন্তু Exam Appearance যোগ হয়নি","🗂️ Exam Appearances ট্যাব থেকে question_id দিয়ে ম্যানুয়ালি যোগ করো");
      if(res.added===0 && res.skipped>0 && failedCount===0){
        push("warn","⚠️ সবগুলোই ইতিমধ্যে Sheet-এ আছে (duplicate)","");
      } else if(res.added===0 && res.skipped===0 && failedCount===0){
        push("error","সেভ ব্যর্থ","নেটওয়ার্ক সমস্যা হতে পারে, একটু পর আবার চেষ্টা করো");
      }
      // 🐛 ফিক্স (নেটওয়ার্ক-ব্যর্থতায় নীরবে প্রশ্ন হারিয়ে যাওয়া): আগে failedRows চেক-ই
      // হতো না — কোনো চাংক ব্যর্থ হলেও পুরো paper রিসেট (makeInitialPaper) হয়ে যেত, ফলে
      // ব্যর্থ হওয়া প্রশ্নগুলো চিরতরে হারিয়ে যেত। এখন কিছু চাংক ব্যর্থ হলে paper রিসেট হয়
      // না (ড্রাফটও থেকে যায়) — শুধু সফলভাবে সেভ হলেই (কোনো ব্যর্থ চাংক ছাড়া) খাতা খালি হয়। ──
      if(failedCount>0){
        push("error",`⚠️ ${failedCount}টা প্রশ্ন সেভ হয়নি (নেটওয়ার্ক সমস্যা)`,"খাতা খালি করা হয়নি — আবার 🚀 সাবমিট চাপলে শুধু বাকিগুলোই যাবে (আগেরগুলো ডুপ্লিকেট হবে না)");
      } else if(res.added>0 || res.skipped>0){
        setPaper(makeInitialPaper());
        setActiveTab("bangla");
        clearDraft(LS_DRAFT_PAPER);
      }
    }catch(e){
      push("error","সাবমিট ব্যর্থ",e.message+" — খাতা খালি হয়নি, ড্রাফট থেকে গেছে");
      if(e.tabKey&&e.cardId) flyToCard(e.tabKey,e.cardId,e.field);
    }
    setSaving(false);
    setSaveProgress(null);
  },[saving,gasSecret,paper,subjectOptions,refData,sessionCount,push,setRefData,setSessionCount,postSel,instSel,examYear,postOptions,instOptions,activeTab]);

  useEffect(()=>{
    const onKey=e=>{ if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==="s"){ e.preventDefault(); submitPaper(); } };
    window.addEventListener("keydown",onKey);
    return()=>window.removeEventListener("keydown",onKey);
  },[submitPaper]);

  return(
    <div style={{background:PC.bg,margin:"0 -16px",padding:"14px 14px 4px",borderRadius:0}}>
      {draftBanner&&(
        <div style={{background:"#EAF1E4",border:"1px solid #2C472855",borderRadius:12,padding:"12px 14px",marginBottom:14}}>
          <div style={{fontSize:12,fontWeight:800,color:"#2C4728",marginBottom:4}}>♻️ আগের অসম্পূর্ণ প্রশ্নপত্র পাওয়া গেছে</div>
          <div style={{fontSize:11,color:"#3d5a37",marginBottom:10,lineHeight:1.5}}>
            বাংলা/ইংরেজি/গণিত/GK — এই ৪টা ট্যাবে আগে টাইপ করা প্রশ্ন এখনো সাবমিট করা হয়নি।
          </div>
          <div style={{display:"flex",gap:8}}>
            <button className="btn" style={{flex:1,justifyContent:"center",background:"transparent",border:`1px solid ${PC.border}`,color:PC.ink}} onClick={discardPaperDraft}>🗑 বাদ দাও</button>
            <button className="btn" style={{flex:2,justifyContent:"center",background:PC.ink,color:"#fff",border:"none"}} onClick={restorePaperDraft}>♻️ ফিরিয়ে আনো</button>
          </div>
        </div>
      )}
      {/* ── পদ/প্রতিষ্ঠান/সাল — একদম শুরুতে, ৪টা ট্যাবের সবার উপরে (session-wide,
          একবার দিলে বাংলা/English/Math/GK — এই সেশনের সব প্রশ্নেই একই Exam Appearance
          যাবে, কারণ QBank মানেই বিগত পরীক্ষা, এই ৩টা ছাড়া entry অসম্পূর্ণ) ── */}
      <div style={{background:PC.card,border:`1px solid ${PC.border}`,borderRadius:12,padding:12,marginBottom:12}}>
        <div style={{fontSize:12,fontWeight:800,color:PC.ink,marginBottom:2}}>🧾 কোন প্রশ্নপত্র থেকে? (ঐচ্ছিক)</div>
        <div style={{fontSize:10.5,color:PC.muted,marginBottom:8}}>দিলে এই সেশনের ৪টা ট্যাবের সব প্রশ্নই এই Exam Appearance পাবে — প্রশ্নের রো ডুপ্লিকেট হয় না, একই প্রশ্ন আগে থেকে থাকলে শুধু Appearance জুড়ে যায়।</div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:8}}>
          <div className="fld" style={{marginBottom:0}}>
            <label>পদ (Post)</label>
            <TypeaheadCombo
              options={postOptions}
              value={postSel}
              onChange={setPostSel}
              placeholder="যেমন: সহকারী শিক্ষক"
              newLabel={`🆕 "${postSel.name.trim()}" নতুন পদ হিসেবে যোগ হবে`}
            />
          </div>
          <div className="fld" style={{marginBottom:0}}>
            <label>প্রতিষ্ঠান (Institution)</label>
            <TypeaheadCombo
              options={instOptions}
              value={instSel}
              onChange={setInstSel}
              placeholder="যেমন: প্রাথমিক বিদ্যালয়"
              newLabel={`🆕 "${instSel.name.trim()}" নতুন প্রতিষ্ঠান হিসেবে যোগ হবে`}
            />
          </div>
        </div>
        <div className="fld" style={{marginBottom:0}}>
          <label>সাল</label>
          <input className="inp" style={pcField} placeholder="যেমন: 2025" value={examYear} onChange={e=>setExamYear(e.target.value)}/>
        </div>
      </div>

      {/* 🆕 Audience Tags — কে এই প্রশ্ন দেখবে (Job/Masters 1/Class 7...) — সেশন-জুড়ে,
          সব ট্যাবের সব প্রশ্নেই একই ট্যাগ প্রযোজ্য হয়। "Job" ডিফল্টভাবে সিলেক্ট থাকে। ── */}
      <div style={{background:PC.card,border:`1px solid ${PC.border}`,borderRadius:12,padding:12,marginBottom:12}}>
        <div style={{fontSize:12,fontWeight:800,color:PC.ink,marginBottom:2}}>🎯 কাদের জন্য এই প্রশ্ন? (Audience Tag)</div>
        <div style={{fontSize:10.5,color:PC.muted,marginBottom:8}}>ডিফল্টভাবে "Job" সিলেক্ট থাকে — দরকার হলে বদলাও (একাধিকও বেছে নেওয়া যায়)। এই সেশনের সব প্রশ্নেই একই ট্যাগ যাবে।</div>
        <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
          {tagOptions.length===0?(
            <div style={{fontSize:10.5,color:PC.muted}}>{refData===null?"লোড হচ্ছে...":"কোনো Tag পাওয়া যায়নি"}</div>
          ):tagOptions.map(tg=>(
            <button key={tg.id} type="button" onClick={()=>toggleTag(tg.id)}
              style={{fontSize:11,fontWeight:700,padding:"6px 12px",borderRadius:20,cursor:"pointer",
                border:`1.5px solid ${selectedTagIds.includes(tg.id)?PC.ink:PC.border}`,
                background:selectedTagIds.includes(tg.id)?PC.ink:"transparent",
                color:selectedTagIds.includes(tg.id)?"#fff":PC.muted}}>
              {selectedTagIds.includes(tg.id)?"✓ ":""}{tg.name}
            </button>
          ))}
        </div>
      </div>

      {/* ── সাবজেক্ট ট্যাব ── */}
      <div style={{display:"flex",gap:6,marginBottom:12}}>
        {PAPER_TABS.map(t=>(
          <button key={t.key} onClick={()=>setActiveTab(t.key)}
            style={{flex:1,padding:"9px 4px",borderRadius:9,border:`1.5px solid ${activeTab===t.key?PC.ink:PC.border}`,
              background:activeTab===t.key?PC.ink:PC.card,color:activeTab===t.key?"#fff":PC.muted,
              fontSize:12,fontWeight:700,cursor:"pointer",position:"relative"}}>
            {t.label}
            {tabCount(t.key)>0&&(
              <span style={{marginLeft:5,fontSize:9,background:activeTab===t.key?"#ffffff33":PC.ink+"33",
                color:activeTab===t.key?"#fff":PC.ink,padding:"1px 6px",borderRadius:10,fontWeight:800}}>{tabCount(t.key)}</span>
            )}
          </button>
        ))}
      </div>

      {tabDef.grouped ? (
        <>
          {(paper[activeTab]||[]).map(card=>(
            <div key={card.id} style={{background:PC.card,border:`1px solid ${PC.border}`,borderRadius:12,padding:12,marginBottom:12}}>
              <div style={{display:"flex",justifyContent:"flex-end",marginBottom:4}}>
                <button onClick={()=>removeCard(activeTab,card.id)} title="এই প্রশ্ন/গ্রুপ মুছো"
                  style={{background:"transparent",border:"none",color:"#ef4444",cursor:"pointer",fontSize:15,padding:"0 2px"}}>🗑</button>
              </div>
              <div style={{display:"flex",gap:8,marginBottom:10}}>
                <div className="fld" style={{marginBottom:0,flex:1}}>
                  <label>🏷️ গ্রুপ হেডিং (ঐচ্ছিক — খালি = প্রতিটা sub-part স্বাধীন)</label>
                  <input className="inp" style={pcField} placeholder='যেমন: "সন্ধি বিচ্ছেদ করুন:"' value={card.heading}
                    onChange={e=>updateCard(activeTab,card.id,{heading:e.target.value})}
                    onBlur={()=>{
                      // 🐛 ফিক্স (ভুল ম্যাচিং — হুবহু-বাক্য না মিলিয়ে বিদ্যমান
                      // Topic-লিস্টের সাথে fuzzy word-overlap মেলানো হয়, দেখো
                      // bestTopicMatchForHeading()। কনফিডেন্ট মিল না পেলে Topic
                      // ফাঁকাই থাকে — নতুন কিছু বসানো হয় না, অ্যাডমিন নিজে বেছে
                      // নেবে। মিললে subjectChoice টগলও সেই টপিকের আসল subject
                      // অনুযায়ী অটো বদলে যায়। ──
                      if(card.topicSel.name.trim())return;
                      const options=tabDef.subjectChoices
                        ? mergedTopicOptionsFor(refData,tabDef.subjectChoices.map(c=>subjectOptions.find(s=>s.name===c.name)?.id).filter(Boolean))
                        : topicOptionsFor(subjectOptions.find(s=>s.name===tabDef.fixedSubject)?.id);
                      const match=bestTopicMatchForHeading(card.heading,options);
                      if(!match)return; // ভালো মিল পাওয়া যায়নি — ফাঁকাই থাক
                      const patch={topicSel:{id:match.id,name:match.name}};
                      if(tabDef.subjectChoices){
                        const ex=(refData?.topics||[]).find(tp=>tp.topic_id===match.id);
                        if(ex){
                          const idx=tabDef.subjectChoices.findIndex(c=>subjectOptions.find(s=>s.name===c.name)?.id===ex.subject_id);
                          if(idx>=0) patch.subjectChoice=tabDef.subjectChoices[idx].key;
                        }
                      }
                      updateCard(activeTab,card.id,patch);
                    }}
                    onKeyDown={e=>{
                      // 🐛 ফিক্স (হেডিং থেকে Tab মারলে এলোমেলো জায়গায় চলে যাওয়া):
                      // ব্রাউজারের ডিফল্ট Tab-অর্ডারে হেডিং-এর পরে থাকে ফরম্যাট
                      // ড্রপডাউন, তারপর Topic — এই দুটোই সাধারণত একবার সেট করে
                      // রেখে দেওয়া হয়, বারবার ছোঁয়া লাগে না। তাই হেডিং লিখে Tab
                      // মারলে এখন সরাসরি প্রথম সাব-পার্টের প্রশ্ন-বক্সে চলে যায় —
                      // ফরম্যাট/Topic ডিঙিয়ে, র‍্যাপিড টাইপিং-এর জন্য। ──
                      if(e.key==="Tab"&&!e.shiftKey){
                        e.preventDefault();
                        const firstItem=card.items&&card.items[0];
                        if(firstItem) textareaRefs.current[firstItem.id]?.focus();
                      }
                    }}/>
                </div>
                <div className="fld" style={{marginBottom:0,width:130,flexShrink:0}}>
                  <label>{activeTab==="english"?"Format":"ফরম্যাট"}</label>
                  <select className="inp" value={card.formatStyle} onChange={e=>updateCard(activeTab,card.id,{formatStyle:e.target.value})}
                    style={{...pcField,fontSize:11}} title={formatStylesFor(activeTab).find(f=>f.v===card.formatStyle)?.title}>
                    {formatStylesFor(activeTab).map(f=>(<option key={f.v} value={f.v} title={f.title}>{f.label}</option>))}
                  </select>
                </div>
              </div>
              <div ref={el=>{topicRefs.current[card.id]=el;}} className="fld" style={{marginBottom:6,
                  ...(highlightCardId===card.id&&highlightField==="topic"?{outline:"3px solid #ef4444",outlineOffset:3,borderRadius:8,transition:"outline-color .3s"}:{})}}>
                <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:4}}>
                  <label style={{margin:0}}>📌 Topic (এই পুরো গ্রুপের জন্য একবারই)</label>
                  {/* 🆕 বাংলা/ইংরেজি ট্যাবে টপিক-লিস্ট ২টা আসল subject (ব্যাকরণ+সাহিত্য/
                      Grammar+Literature) মিলিয়ে দেখানো হয় (দেখো mergedTopicOptionsFor)।
                      বিদ্যমান Topic বেছে নিলে এই টগল অটো বদলে যায় (আসল subject অনুযায়ী);
                      নতুন Topic টাইপ করলে এই টগল অনুযায়ী subject ঠিক হবে। */}
                  {tabDef.subjectChoices&&(
                    <div style={{display:"flex",gap:4}}>
                      {tabDef.subjectChoices.map(c=>(
                        <button key={c.key} type="button" onClick={()=>updateCard(activeTab,card.id,{subjectChoice:c.key})}
                          style={{fontSize:9,fontWeight:700,padding:"2px 8px",borderRadius:6,cursor:"pointer",
                            border:`1px solid ${card.subjectChoice===c.key?PC.ink:PC.border}`,
                            background:card.subjectChoice===c.key?PC.ink:"transparent",
                            color:card.subjectChoice===c.key?"#fff":PC.muted}}>{c.short}</button>
                      ))}
                    </div>
                  )}
                </div>
                <TypeaheadCombo
                  options={tabDef.subjectChoices
                    ? mergedTopicOptionsFor(refData,tabDef.subjectChoices.map(c=>subjectOptions.find(s=>s.name===c.name)?.id).filter(Boolean))
                    : topicOptionsFor(subjectOptions.find(s=>s.name===tabDef.fixedSubject)?.id)}
                  value={card.topicSel}
                  onChange={sel=>{
                    const patch={topicSel:sel};
                    if(sel.id&&tabDef.subjectChoices){
                      const ex=(refData?.topics||[]).find(tp=>tp.topic_id===sel.id);
                      if(ex){
                        const idx=tabDef.subjectChoices.findIndex(c=>subjectOptions.find(s=>s.name===c.name)?.id===ex.subject_id);
                        if(idx>=0) patch.subjectChoice=tabDef.subjectChoices[idx].key;
                      }
                    }
                    updateCard(activeTab,card.id,patch);
                  }}
                  placeholder="Topic লিখো বা লিস্ট থেকে বেছে নাও..."
                  newLabel={`🆕 "${card.topicSel.name.trim()}" নতুন Topic হিসেবে যোগ হবে${tabDef.subjectChoices?` (${(tabDef.subjectChoices.find(c=>c.key===card.subjectChoice)||tabDef.subjectChoices[0]).short})`:""}`}
                  inputStyle={pcField} lightTheme
                />
              </div>
              {/* 🆕 সরাসরি টাইপ করে মার্ক করার শর্টকাট — ফরম্যাট বদলানো/বাটনে চাপা কোনোটাই
                  বাধ্যতামূলক না, টাইপ করলেই ধরা পড়ে যায় (দেখো detectAutoMarkup, submitPaper)।
                  🐛 ফিক্স: blank মার্কার আগে ডাবল আন্ডারস্কোর (__..__) ছিল, এখন একপাশে
                  একটা করে (_.._) — ফিডব্যাক অনুযায়ী। */}
              <div style={{fontSize:9.5,color:PC.muted,marginBottom:8,lineHeight:1.5}}>
                {activeTab==="english"
                  ? <>💡 Type <code>_word_</code> for a blank, <code>*word*</code> to highlight — no button needed</>
                  : <>💡 <code>_শব্দ_</code> লিখলে শূন্যস্থান, <code>*শব্দ*</code> লিখলে হাইলাইট — বাটনে চাপা লাগবে না</>}
              </div>

              {card.items.map((it,idx)=>{
                const isExpanded=expandedItems.has(it.id);
                const hasExplTech=it.explanation.trim()||it.technique.trim();
                const isFillblank=card.formatStyle==="fillblank"||detectAutoMarkup(it.question).style==="fillblank";
                return (
                <div key={it.id} style={{display:"flex",gap:8,padding:"8px 0",borderTop:idx>0?`1px dashed ${PC.border}`:"none"}}>
                  <div style={{width:22,flexShrink:0,fontWeight:800,color:PC.ink,fontSize:12,paddingTop:8}}>{SUBLABELS[idx]||idx+1}.</div>
                  <div style={{flex:1}}>
                    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                      <label style={{margin:0,fontSize:10.5,color:PC.muted,fontWeight:700}}>{activeTab==="english"?"Question":"প্রশ্ন"}</label>
                      <div style={{display:"flex",gap:6}}>
                        {/* 🆕 প্রতিটা সাব-পার্ট আলাদাভাবে Written/MCQ হতে পারে —
                            একই গ্রুপে দুই ধরনের প্রশ্ন মিশিয়ে থাকতে বাধা নেই। */}
                        <button type="button" onClick={()=>updateItem(activeTab,card.id,it.id,{qtype:it.qtype==="mcq"?"written":"mcq"})}
                          style={{background:it.qtype==="mcq"?"#6d28d922":"transparent",color:it.qtype==="mcq"?"#6d28d9":PC.muted,
                            border:`1px solid ${it.qtype==="mcq"?"#6d28d944":PC.border}`,borderRadius:6,
                            fontSize:9.5,fontWeight:700,padding:"2px 8px",cursor:"pointer"}}>
                          {it.qtype==="mcq"?"❓ MCQ":"✍️ Written"}
                        </button>
                        {(card.formatStyle==="highlight"||card.formatStyle==="fillblank")&&it.qtype!=="mcq"&&(
                          <button onClick={()=>wrapHighlight(activeTab,card.id,it.id,card.formatStyle)}
                            title={card.formatStyle==="fillblank"?"যে শব্দ blank হবে সেটা সিলেক্ট করে মার্ক করো — এটাই Answer হয়ে সেভ হবে":"সিলেক্ট করা অংশ হাইলাইট/মার্ক করো"}
                            style={{background:"#facc1522",color:"#facc15",border:"1px solid #facc1544",borderRadius:6,
                              fontSize:9.5,fontWeight:700,padding:"2px 8px",cursor:"pointer"}}>🖍 {card.formatStyle==="fillblank"?"Blank মার্ক করো":"হাইলাইট করো"}</button>
                        )}
                      </div>
                    </div>
                    <textarea
                      ref={el=>{textareaRefs.current[it.id]=el;}}
                      className="ta" style={{...pcField,minHeight:44,fontSize:12.5}}
                      value={it.question} onChange={e=>updateItem(activeTab,card.id,it.id,{question:e.target.value})}
                      onKeyDown={e=>handleGroupQKeyDown(e,activeTab,card.id,card.items,idx,isFillblank||it.qtype==="mcq")}
                      placeholder={card.formatStyle==="table"?(activeTab==="english"?"word":"শব্দ (যেমন: অহর্নিশ)"):card.formatStyle==="fillblank"?"_..._ বা 🖍 দিয়ে blank মার্ক করো...":activeTab==="english"?"Type the question...":"প্রশ্ন লিখো..."}/>
                    {/* 🐛 ফিক্স: Fill-blank সনাক্ত হলে (formatStyle থেকে বা সরাসরি _..._ টাইপ
                        করা থেকে) আলাদা raw answer বক্সের দরকার নেই — প্রশ্নের ভিতরের মার্ক করা
                        অংশটাই সাবমিটের সময় Answer হিসেবে auto বসে যায় (দেখো submitPaper)। ── */}
                    {it.qtype==="mcq" ? (
                      <>
                        <label style={{fontSize:10.5,color:PC.muted,fontWeight:700,marginTop:4}}>✅ সঠিক উত্তর</label>
                        <input
                          ref={el=>{answerRefs.current[it.id]=el;}}
                          className="inp" style={{...pcField,fontSize:12.5,background:PC.answerBg,color:PC.answerText,borderColor:PC.answerText+"55"}}
                          value={it.answer} onChange={e=>updateItem(activeTab,card.id,it.id,{answer:e.target.value})}
                          onKeyDown={e=>handleGroupAKeyDown(e,activeTab,card.id,card.items,idx)}
                          placeholder="সঠিক উত্তর লিখো..."/>
                        <button type="button" onClick={()=>generateMcqOptions(activeTab,card.id,it.id,it.question,it.answer,false)}
                          disabled={mcqGeneratingId===it.id}
                          style={{width:"100%",marginTop:6,background:"#6d28d922",color:"#6d28d9",border:"1px solid #6d28d944",
                            borderRadius:7,fontSize:11,fontWeight:700,padding:"7px 0",cursor:"pointer"}}>
                          {mcqGeneratingId===it.id?"⏳ তৈরি হচ্ছে...":"🤖 AI দিয়ে ৩টা ভুল অপশন বানাও"}
                        </button>
                        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6,marginTop:6}}>
                          {["opt1","opt2","opt3","opt4"].map((k,oi)=>(
                            <input key={k} className="inp" style={{...pcField,fontSize:11.5,
                                borderColor:it[k].trim()&&norm(it[k])===norm(it.answer)?"#22c55e":PC.border}}
                              value={it[k]} onChange={e=>updateItem(activeTab,card.id,it.id,{[k]:e.target.value})}
                              placeholder={`অপশন ${String.fromCharCode(65+oi)}`}/>
                          ))}
                        </div>
                        {/* কোনো অপশনের টেক্সট বদলে সেটাই সঠিক করতে চাইলে ট্যাপ করলেই
                            "সঠিক উত্তর" বক্সে বসে যায় — নতুন করে টাইপ করা লাগে না। */}
                        {(it.opt1.trim()||it.opt2.trim()||it.opt3.trim()||it.opt4.trim())&&(
                          <div style={{display:"flex",gap:4,marginTop:4,flexWrap:"wrap"}}>
                            {["opt1","opt2","opt3","opt4"].map(k=>it[k].trim()&&(
                              <button key={k} type="button" onClick={()=>updateItem(activeTab,card.id,it.id,{answer:it[k]})}
                                style={{fontSize:9.5,padding:"3px 8px",borderRadius:6,cursor:"pointer",
                                  border:`1px solid ${norm(it[k])===norm(it.answer)?"#22c55e":PC.border}`,
                                  background:norm(it[k])===norm(it.answer)?"#22c55e22":"transparent",
                                  color:norm(it[k])===norm(it.answer)?"#16a34a":PC.muted,fontWeight:700}}>
                                {it[k].length>16?it[k].slice(0,16)+"…":it[k]}
                              </button>
                            ))}
                          </div>
                        )}
                      </>
                    ) : isFillblank ? (
                      <div style={{fontSize:10,color:PC.gold,fontWeight:700,marginTop:4}}>
                        🖍 প্রশ্নে মার্ক করা শব্দই Answer হিসেবে অটো সেভ হবে — আলাদা করে টাইপ করা লাগবে না
                      </div>
                    ) : (
                      <>
                        <label style={{fontSize:10.5,color:PC.muted,fontWeight:700,marginTop:4}}>{activeTab==="english"?"Answer":"উত্তর"}</label>
                        <input
                          ref={el=>{answerRefs.current[it.id]=el;}}
                          className="inp" style={{...pcField,fontSize:12.5,background:PC.answerBg,color:PC.answerText,borderColor:PC.answerText+"55"}}
                          value={it.answer} onChange={e=>updateItem(activeTab,card.id,it.id,{answer:e.target.value})}
                          onKeyDown={e=>handleGroupAKeyDown(e,activeTab,card.id,card.items,idx)}
                          placeholder={card.formatStyle==="table"?(activeTab==="english"?"meaning":"বিচ্ছেদ/ব্যাখ্যা"):activeTab==="english"?"Type the answer...":"উত্তর লিখো..."}/>
                      </>
                    )}
                    {/* 🐛 ফিক্স (Tab-এ বাধ্যতামূলক নয় এমন বক্সে আটকে যাওয়া): ব্যাখ্যা/টেকনিক
                        ডিফল্টভাবে লুকানো — একটা ছোট বাটনে চাপলেই এক্সপ্যান্ড হয়ে টাইপ-বক্স
                        দেখা যায়, তাই সাধারণ Tab-ফ্লো (প্রশ্ন→উত্তর→পরের প্রশ্ন)-এ এসে বাধা দেয় না। */}
                    <button type="button" onClick={()=>toggleExpand(it.id)}
                      style={{background:"transparent",border:"none",color:PC.gold,cursor:"pointer",
                        fontSize:9.5,fontWeight:700,padding:"4px 0 0",display:"flex",alignItems:"center",gap:3}}>
                      {isExpanded?"▲":"▼"} {activeTab==="english"?"Explanation / Technique":"ব্যাখ্যা / টেকনিক"}{!isExpanded&&hasExplTech?" •":""}
                    </button>
                    {isExpanded&&(
                      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6,marginTop:4}}>
                        <input className="inp" style={{...pcField,fontSize:11}} placeholder={activeTab==="english"?"Explanation (optional)":"ব্যাখ্যা (ঐচ্ছিক)"}
                          value={it.explanation} onChange={e=>updateItem(activeTab,card.id,it.id,{explanation:e.target.value})}/>
                        <input className="inp" style={{...pcField,fontSize:11}} placeholder={activeTab==="english"?"Technique (optional)":"টেকনিক (ঐচ্ছিক)"}
                          value={it.technique} onChange={e=>updateItem(activeTab,card.id,it.id,{technique:e.target.value})}/>
                      </div>
                    )}
                  </div>
                  {card.items.length>1&&(
                    <button onClick={()=>removeSubItem(activeTab,card.id,it.id)} style={{background:"transparent",border:"none",color:"#ef4444",cursor:"pointer",fontSize:12,flexShrink:0,paddingTop:8}}>✕</button>
                  )}
                </div>
              );})}
              <button onClick={()=>addSubItem(activeTab,card.id)}
                style={{width:"100%",marginTop:6,background:"transparent",border:`1px dashed ${PC.border}`,borderRadius:8,
                  color:PC.muted,fontSize:11,fontWeight:700,padding:8,cursor:"pointer"}}>
                + আরেকটা সাব-পার্ট (ক/খ/গ...) যোগ করো
              </button>
            </div>
          ))}
        </>
      ) : (
        <>
          {(paper[activeTab]||[]).map((card,ci)=>(
            <div key={card.id} style={{background:PC.card,border:`1px solid ${PC.border}`,borderRadius:12,padding:12,marginBottom:12}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
                <div style={{fontSize:11,fontWeight:800,color:PC.muted}}>প্রশ্ন {ci+1}</div>
                <button onClick={()=>removeCard(activeTab,card.id)} style={{background:"transparent",border:"none",color:"#ef4444",cursor:"pointer",fontSize:15}}>🗑</button>
              </div>
              {tabDef.gkStyle&&(
              <div ref={el=>{subjectFieldRefs.current[card.id]=el;}} className="fld" style={{marginBottom:8,
                  ...(highlightCardId===card.id&&highlightField==="subject"?{outline:"3px solid #ef4444",outlineOffset:3,borderRadius:8,transition:"outline-color .3s"}:{})}}>
                  <label>📚 Subject (real sheet subject — যেমন "সাধারণ বিজ্ঞান")</label>
                  <TypeaheadCombo
                    options={subjectOptions}
                    value={card.subjectSel}
                    onChange={sel=>updateCard(activeTab,card.id,{subjectSel:sel})}
                    placeholder="Subject লিখো বা বেছে নাও..."
                    newLabel={`🆕 "${card.subjectSel.name.trim()}" নতুন Subject হিসেবে যোগ হবে`}
                    inputStyle={pcField} lightTheme
                  />
                </div>
              )}
              <div ref={el=>{topicRefs.current[card.id]=el;}} className="fld" style={{marginBottom:8,
                  ...(highlightCardId===card.id&&highlightField==="topic"?{outline:"3px solid #ef4444",outlineOffset:3,borderRadius:8,transition:"outline-color .3s"}:{})}}>
                <label>📌 Topic</label>
                <TypeaheadCombo
                  options={topicOptionsFor(tabDef.gkStyle?card.subjectSel.id:subjectOptions.find(s=>s.name===tabDef.fixedSubject)?.id)}
                  value={card.topicSel}
                  onChange={sel=>updateCard(activeTab,card.id,{topicSel:sel})}
                  placeholder={tabDef.gkStyle&&!card.subjectSel.name.trim()?"আগে Subject বেছে নাও":"Topic লিখো বা বেছে নাও..."}
                  newLabel={`🆕 "${card.topicSel.name.trim()}" নতুন Topic হিসেবে যোগ হবে`}
                  inputStyle={pcField} lightTheme
                />
              </div>
              <div className="fld" style={{marginBottom:8}}>
                <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:4}}>
                  <label style={{margin:0}}>❓ প্রশ্ন</label>
                  {/* 🆕 flat কার্ডেও (গণিত/GK) Written/MCQ টগল — একই প্যাটার্ন। */}
                  <button type="button" onClick={()=>updateCard(activeTab,card.id,{qtype:card.qtype==="mcq"?"written":"mcq"})}
                    style={{background:card.qtype==="mcq"?"#6d28d922":"transparent",color:card.qtype==="mcq"?"#6d28d9":PC.muted,
                      border:`1px solid ${card.qtype==="mcq"?"#6d28d944":PC.border}`,borderRadius:6,
                      fontSize:9.5,fontWeight:700,padding:"2px 8px",cursor:"pointer"}}>
                    {card.qtype==="mcq"?"❓ MCQ":"✍️ Written"}
                  </button>
                </div>
                <textarea
                  ref={el=>{flatQRefs.current[card.id]=el;}}
                  className="ta" style={{...pcField,minHeight:70}} value={card.question}
                  onChange={e=>updateCard(activeTab,card.id,{question:e.target.value})}
                  onKeyDown={e=>handleFlatQKeyDown(e,card.id)}
                  placeholder="প্রশ্ন লিখো..."/>
              </div>
              <div className="fld" style={{marginBottom:8}}>
                <label>{card.qtype==="mcq"?"✅ সঠিক উত্তর":"✅ উত্তর"}</label>
                <textarea
                  ref={el=>{flatARefs.current[card.id]=el;}}
                  className="ta" style={{...pcField,minHeight:50,background:PC.answerBg,color:PC.answerText,borderColor:PC.answerText+"55"}} value={card.answer}
                  onChange={e=>updateCard(activeTab,card.id,{answer:e.target.value})}
                  onKeyDown={e=>handleFlatAKeyDown(e,activeTab,card.id,paper[activeTab]||[],ci)}
                  placeholder={card.qtype==="mcq"?"সঠিক উত্তর লিখো...":activeTab==="math"?"চূড়ান্ত উত্তর (ধাপে-ধাপে সমাধান নিচে ব্যাখ্যায়)...":"উত্তর লিখো..."}/>
                {card.qtype==="mcq"&&(
                  <>
                    <button type="button" onClick={()=>generateMcqOptions(activeTab,card.id,card.id,card.question,card.answer,true)}
                      disabled={mcqGeneratingId===card.id}
                      style={{width:"100%",marginTop:6,background:"#6d28d922",color:"#6d28d9",border:"1px solid #6d28d944",
                        borderRadius:7,fontSize:11,fontWeight:700,padding:"7px 0",cursor:"pointer"}}>
                      {mcqGeneratingId===card.id?"⏳ তৈরি হচ্ছে...":"🤖 AI দিয়ে ৩টা ভুল অপশন বানাও"}
                    </button>
                    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6,marginTop:6}}>
                      {["opt1","opt2","opt3","opt4"].map((k,oi)=>(
                        <input key={k} className="inp" style={{...pcField,fontSize:11.5,
                            borderColor:card[k].trim()&&norm(card[k])===norm(card.answer)?"#22c55e":PC.border}}
                          value={card[k]} onChange={e=>updateCard(activeTab,card.id,{[k]:e.target.value})}
                          placeholder={`অপশন ${String.fromCharCode(65+oi)}`}/>
                      ))}
                    </div>
                    {(card.opt1.trim()||card.opt2.trim()||card.opt3.trim()||card.opt4.trim())&&(
                      <div style={{display:"flex",gap:4,marginTop:4,flexWrap:"wrap"}}>
                        {["opt1","opt2","opt3","opt4"].map(k=>card[k].trim()&&(
                          <button key={k} type="button" onClick={()=>updateCard(activeTab,card.id,{answer:card[k]})}
                            style={{fontSize:9.5,padding:"3px 8px",borderRadius:6,cursor:"pointer",
                              border:`1px solid ${norm(card[k])===norm(card.answer)?"#22c55e":PC.border}`,
                              background:norm(card[k])===norm(card.answer)?"#22c55e22":"transparent",
                              color:norm(card[k])===norm(card.answer)?"#16a34a":PC.muted,fontWeight:700}}>
                            {card[k].length>16?card[k].slice(0,16)+"…":card[k]}
                          </button>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
                <div className="fld" style={{marginBottom:0}}>
                  <label>📖 {activeTab==="math"?"ধাপে-ধাপে সমাধান":"ব্যাখ্যা"} (ঐচ্ছিক)</label>
                  <textarea className="ta" style={{...pcField,minHeight:50,fontSize:11.5}} value={card.explanation}
                    onChange={e=>updateCard(activeTab,card.id,{explanation:e.target.value})}
                    placeholder={activeTab==="math"?"x^2 এভাবে লিখো, User App-এ x² হয়ে দেখাবে":"ব্যাখ্যা..."}/>
                </div>
                <div className="fld" style={{marginBottom:0}}>
                  <label>💡 টেকনিক (ঐচ্ছিক)</label>
                  <textarea className="ta" style={{...pcField,minHeight:50,fontSize:11.5}} value={card.technique}
                    onChange={e=>updateCard(activeTab,card.id,{technique:e.target.value})}
                    placeholder="শর্টকাট/টেকনিক..."/>
                </div>
              </div>
            </div>
          ))}
        </>
      )}

      <button onClick={()=>addCard(activeTab)}
        style={{width:"100%",marginBottom:16,background:"transparent",border:`1.5px dashed ${PC.ink}`,borderRadius:10,
          color:PC.ink,fontSize:12.5,fontWeight:800,padding:10,cursor:"pointer"}}>
        + নতুন {tabDef.grouped?"প্রশ্ন/গ্রুপ":"প্রশ্ন"} যোগ করো
      </button>

      <div style={{position:"sticky",bottom:8,background:PC.bg,paddingTop:8}}>
        {/* 🆕 Save as Draft — একাধিক নামসহ খসড়া, Post+Institution+সাল দিয়ে
            হেডলাইন করা, সবচেয়ে নতুনটা সবার উপরে। উপরের অটো-ড্রাফট থেকে এটা আলাদা:
            এটা ম্যানুয়াল, একাধিক এন্ট্রি জমা রাখে, ইচ্ছামতো পরে ফিরে লোড করা যায়। ── */}
        <div style={{display:"flex",gap:8,marginBottom:8}}>
          <button type="button" onClick={saveNamedDraft}
            style={{flex:1,justifyContent:"center",padding:"9px 0",borderRadius:9,fontSize:11.5,fontWeight:700,
              background:"transparent",border:`1px solid ${PC.border}`,color:PC.ink,cursor:"pointer"}}>
            💾 খসড়া হিসেবে সেভ করো
          </button>
          <button type="button" onClick={()=>setShowDraftList(s=>!s)}
            style={{flex:1,justifyContent:"center",padding:"9px 0",borderRadius:9,fontSize:11.5,fontWeight:700,
              background:"transparent",border:`1px solid ${PC.border}`,color:PC.ink,cursor:"pointer"}}>
            📂 সেভ করা খসড়া ({draftList.length}) {showDraftList?"▲":"▼"}
          </button>
        </div>
        {showDraftList&&(
          <div style={{maxHeight:280,overflowY:"auto",border:`1px solid ${PC.border}`,borderRadius:10,marginBottom:8,background:"#fff"}}>
            {draftList.length===0?(
              <div style={{padding:14,fontSize:11,color:PC.muted,textAlign:"center"}}>এখনো কোনো খসড়া সেভ করা হয়নি</div>
            ):(
              [...draftList].sort((a,b)=>b.savedAt-a.savedAt).map(d=>(
                <div key={d.id} style={{display:"flex",alignItems:"center",gap:8,padding:"10px 12px",borderBottom:`1px dashed ${PC.border}`}}>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontSize:11.5,fontWeight:800,color:PC.ink,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{draftHeadline(d)}</div>
                    <div style={{fontSize:9.5,color:PC.muted,marginTop:2}}>{fmtDraftTime(d.savedAt)} · {draftQCount(d)}টা প্রশ্ন</div>
                  </div>
                  <button type="button" onClick={()=>loadNamedDraft(d)}
                    style={{flexShrink:0,padding:"6px 10px",borderRadius:7,fontSize:10.5,fontWeight:700,
                      background:PC.ink,color:"#fff",border:"none",cursor:"pointer"}}>লোড করো</button>
                  <button type="button" onClick={()=>deleteNamedDraft(d.id)}
                    style={{flexShrink:0,background:"transparent",border:"none",color:"#ef4444",cursor:"pointer",fontSize:14}}>🗑</button>
                </div>
              ))
            )}
          </div>
        )}
        {/* 🐛 ফিক্স (ডুপ্লিকেট Subject বাগ — QB18/QB20/QB22 "বাংলা" একসাথে ৩টা তৈরি হয়ে
            গিয়েছিল): refData (Subject/Topic/Post/Institution লিস্ট) পেজ-লোডে নেটওয়ার্ক
            থেকে আসে — স্লো কানেকশনে (স্ক্রিনশটে 6 KB/s, 1.15 KB/s দেখা গেছে) এটা লোড হতে
            বেশ কয়েক সেকেন্ড লাগতে পারে। তার আগেই Submit চাপলে subjectOptions তখনও খালি
            থাকে, ফলে app বুঝতেই পারে না "বাংলা" আগে থেকে আছে কিনা — প্রতিবার নতুন বানিয়ে
            ফেলে। তাই এখন যতক্ষণ refData লোড না হয় Submit বাটন disable + লোডিং হিন্ট।
            🐛 ফিক্স ("লোড হচ্ছে" চিরকাল আটকে থাকা): আগে ব্যর্থ হলেও refData===null-ই
            থাকতো, তাই এই একই "লোড হচ্ছে" বার্তা অনন্তকাল দেখাতো, কোনো এরর/রিট্রাই ছাড়াই।
            এখন refDataError আলাদা — ব্যর্থ হলে আসল কারণ + 🔁 রিট্রাই বাটন দেখায়। ── */}
        {refDataError ? (
          <div style={{background:"#4a2020",border:"1px solid #ef444455",borderRadius:10,padding:"10px 12px",marginBottom:8}}>
            <div style={{fontSize:11.5,fontWeight:800,color:"#f87171",marginBottom:3}}>❌ রেফারেন্স ডেটা লোড ব্যর্থ হয়েছে</div>
            <div style={{fontSize:10.5,color:"#fca5a5",marginBottom:8,lineHeight:1.5}}>{refDataError}</div>
            <button type="button" onClick={onRetryRefData}
              style={{width:"100%",padding:"7px 0",borderRadius:8,border:"1px solid #ef444488",
                background:"transparent",color:"#f87171",fontWeight:700,fontSize:11.5,cursor:"pointer"}}>
              🔁 আবার চেষ্টা করো
            </button>
          </div>
        ) : refData===null && (
          <div style={{textAlign:"center",fontSize:11,color:PC.gold,fontWeight:700,marginBottom:6}}>
            ⏳ রেফারেন্স ডেটা (Subject/Topic লিস্ট) লোড হচ্ছে — একটু অপেক্ষা করো, নাহলে ডুপ্লিকেট Subject তৈরি হয়ে যেতে পারে
          </div>
        )}
        {/* 🐛 ফিক্স (১টা প্রশ্নেও প্রোগ্রেস বার না নড়া — "hang মনে হয়"): আসল
            saveProgress (চাংক-ভিত্তিক) শুধু ১টার বেশি চাংক থাকলেই দৃশ্যমানভাবে
            বাড়ে — মাত্র ১টা প্রশ্ন/১টা চাংকে পুরো অপেক্ষাটাই কোনো আপডেট ছাড়া কাটে।
            তাই এখন real progress না থাকলে elapsedMs (গত কয়েক সেকেন্ড) থেকে একটা
            "estimate" শতকরা বানানো হয় (সময়ের সাথে বাড়ে, কখনো ৯২%-এর বেশি ওঠে না) —
            বার সবসময় নড়তে থাকে + সেকেন্ড-কাউন্টও দেখায়, তাই hang মনে হয় না। ── */}
        <button className="btn" disabled={saving||refData===null||!!refDataError} onClick={submitPaper}
          style={{width:"100%",justifyContent:"center",padding:"13px 0",fontSize:14.5,position:"relative",overflow:"hidden",
            background:(saving||refData===null||refDataError)?PC.muted:PC.ink,color:"#fff",border:"none"}}>
          {saving&&(()=>{
            const hasReal=saveProgress&&saveProgress.total>0;
            const realPct=hasReal?Math.round((saveProgress.done/saveProgress.total)*100):0;
            const estPct=Math.min(92,Math.round((1-Math.exp(-elapsedMs/9000))*100));
            const pct=hasReal&&realPct>0?realPct:estPct;
            return(
              <span style={{position:"absolute",left:0,top:0,bottom:0,width:`${pct}%`,
                background:"#ffffff26",transition:"width .3s ease"}}/>
            );
          })()}
          <span style={{position:"relative"}}>
            {saving
              ? (saveProgress&&saveProgress.total>1
                  ? `⏳ সেভ হচ্ছে... ${saveProgress.done}/${saveProgress.total} (${Math.round((saveProgress.done/saveProgress.total)*100)}%)`
                  : `⏳ সেভ হচ্ছে... (${Math.max(1,Math.floor(elapsedMs/1000))} সেকেন্ড)`)
              : refDataError?"❌ রেফারেন্স ডেটা লোড ব্যর্থ — উপরে রিট্রাই চাপো"
              : refData===null?"⏳ রেফারেন্স ডেটা লোড হচ্ছে...":`🚀 সব সাবমিট করো — ${totalCount}টা প্রশ্ন (Ctrl+S)`}
          </span>
        </button>
        <div style={{textAlign:"center",fontSize:9.5,color:PC.muted,marginTop:6}}>
          {saving
            ? "চলছে... মাঝপথে অ্যাপ বন্ধ হয়ে গেলেও কাজ ড্রাফটে সেভ আছে, আবার খুললে ফিরে পাবে"
            : "৪টা ট্যাবেই যত প্রশ্ন জমা আছে (এখনো ডাটাবেজে যায়নি), সবগুলো একসাথে একবারে সাবমিট হবে · প্রতি কয়েক সেকেন্ডে অটো-ড্রাফট সেভ হয়"}
        </div>
      </div>
    </div>
  );
}

export { PaperComposer, PAPER_TABS, newPaperId, newPaperItem, newGroupCard, newFlatCard, makeInitialPaper, SUBLABELS, detectAutoMarkup, headingToTopicGuess, bestTopicMatchForHeading, mergedTopicOptionsFor, buildMcqGenPrompt, buildExplGenPrompt, parseGenResponse, shuffle4 };
