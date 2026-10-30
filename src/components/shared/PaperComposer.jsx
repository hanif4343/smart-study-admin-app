/* ══════════ PaperComposer — বাংলা/ইংরেজি/গণিত/GK পুরো প্রশ্নপত্র টাইপ করার UI ══════════
   🐛 রিফ্যাক্টর (Single Entry থেকে বের করে শেয়ার্ড কম্পোনেন্ট বানানো হলো):
   আগে এই পুরো কম্পোনেন্ট (+ তার সব সাপোর্টিং হেল্পার — PAPER_TABS, newGroupCard,
   detectAutoMarkup, headingToTopicGuess ইত্যাদি) SingleQuestionEntryPage.jsx-এর
   ভেতরেই আটকা ছিল। এখন এটা আলাদা শেয়ার্ড ফাইলে — যাতে OCR/Import পেজও (ছবি থেকে
   প্রশ্ন বের করে) ঠিক এই একই কার্ড/সাব-পার্ট UI ব্যবহার করতে পারে, নতুন করে UI
   বানাতে না হয়। নতুন ঐচ্ছিক prop `initialPaper` — দিলে সেই ডেটা দিয়ে শুরু হয়
   (OCR ইম্পোর্টের জন্য), না দিলে আগের মতোই খালি অবস্থা থেকে শুরু হয় (Single Entry-এর
   জন্য — কোনো behavior change নেই)। ══════════ */
import React, { useState, useRef, useEffect, useLayoutEffect, useCallback } from "react";
import { PAPER_TEMPLATES, CUSTOM_TPL, RO, tplListFor, resolveTpl, cardHeadingText, parseFillMarks, nzTopic, topicCandidatesFromHeading, topicRuleFromHeading, pickTopicOption, BUILDER_TYPES, customTypeOf, loadUserTpls, saveUserTpls, buildUserTpl, pickerTplListFor, normTplHead } from "../../core/paperTemplates.js";
import { callAiProviderRotatingRaw, buildKeyPool } from "../../core/ocrProviders.js";
import { buildSheetRow, LS_DRAFT_PAPER, LS_DRAFT_PAPER_LIST, loadDraft, saveDraft, clearDraft, upsertFailedDraft, removeDraftById, upsertPendingDraft, markStalePendingFailed } from "../../core/uploaderUtils.js";
import { createJob, jobEvent, finishJob, isJobActive } from "../../core/uploadJobs.js";
import { saveRowsToSheet, fetchReferenceData } from "../../core/sheetSave.js";
import { resolveOrCreateReference, norm } from "../../core/referenceHelpers.js";
import { subjectsForTags, topicsOfSubject } from "../../core/refFilter.js";
import { TypeaheadCombo } from "./TypeaheadCombo.jsx";
import { RichText } from "./RichText.jsx";
import { useTypingCover, CoverOverlay, CoverToggle } from "./TypingCover.jsx";
import { useTypingTrack } from "../../hooks/useTypingTrack.js";
import { autoTopicFor, loadRules } from "../../core/autoTopic.js";

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
function locatedError(message,tabKey,cardId,field,itemId){
  const err=new Error(message);
  err.tabKey=tabKey; err.cardId=cardId; err.field=field||"topic"; err.itemId=itemId||null;
  return err;
}
/* 🪄 Fill-blank-এ 🖍 মার্ক না থাকলে অটো-ঠিক (সাবমিট ব্যর্থ না করে):
   ১) "উত্তর" ঘরে লেখা শব্দটা বাক্যে হুবহু থাকলে (বড়/ছোট হাত না দেখে) সেটাই blank;
   ২) বাক্যে ফাঁকা-দাগ (____ / ... / …) থাকলে সেখানে উত্তরটা বসে blank হয়।
   wrap(শব্দ) → মার্ক করা রূপ (BU ট্যাগ বা _শব্দ_)। HTML ট্যাগের ভেতরে মিল ধরা হয় না। না পারলে null। */
function autoMarkBlank(question,answer,wrap){
  const q=String(question||""), a=String(answer||"").replace(/<[^>]*>/g,"").trim();
  if(!a) return null;
  const esc=a.replace(/[.*+?^${}()|[\]\\]/g,"\\$&");
  try{
    const m=new RegExp("(^|[^\\p{L}\\p{M}\\p{N}_])("+esc+")(?=$|[^\\p{L}\\p{M}\\p{N}_])(?![^<]*>)","iu").exec(q);
    if(m){ const at=m.index+m[1].length; return q.slice(0,at)+wrap(m[2])+q.slice(at+m[2].length); }
  }catch{}
  const b=/_{2,}|\.{3,}|…+|-{3,}|—{2,}/.exec(q);
  if(b&&!/<[^>]*$/.test(q.slice(0,b.index))) return q.slice(0,b.index)+wrap(a)+q.slice(b.index+b[0].length);
  return null;
}
const blankMissMsg=(label,question,idx)=>{
  const pv=String(question||"").replace(/<[^>]*>/g,"").replace(/\s+/g," ").trim().slice(0,45);
  return `"${label}" ট্যাবে ${idx+1} নং বাক্যে blank মার্ক নেই: "${pv}${pv.length>=45?"…":""}" — blank হবে এমন শব্দ সিলেক্ট করে আন্ডারলাইন (U) দাও — অথবা "উত্তর" ঘরে ওই শব্দটা লিখে দিলে অ্যাপ নিজেই মার্ক করে নেবে`;
};
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
  { key:"math",    label:"গণিত",   fixedSubject:null,      grouped:false, gkStyle:false, mathStyle:true,
    subjectChoices:[{key:"arith",name:"পাটিগণিত",short:"পাটিগণিত"},{key:"algebra",name:"বীজগণিত",short:"বীজগণিত"},{key:"geometry",name:"জ্যামিতি",short:"জ্যামিতি"}] },
  { key:"gk",      label:"GK",     fixedSubject:null,      grouped:false, gkStyle:false, mathStyle:true, moreSubjects:true,
    // GK-তে সবসময় প্রথমে এই ৪টা Subject-পিল; বাকি সব Subject "More subject ›" চাপলে। aliases: ডাটাবেজে বানান একটু আলাদা থাকলেও
    // (বিষয়াবলি/বিষয়াবলী, "কম্পিউটার ও আইসিটি") ঠিক ওই Subject ধরে; কিছুই না মিললে পিলের নামেই নতুন Subject হিসেবে যায়
    subjectChoices:[
      {key:"bd",   name:"বাংলাদেশ বিষয়াবলি",    short:"বাংলাদেশ বিষয়াবলি",    aliases:["বাংলাদেশ বিষয়াবলি","বাংলাদেশ বিষয়াবলী"]},
      {key:"intl", name:"আন্তর্জাতিক বিষয়াবলি",  short:"আন্তর্জাতিক বিষয়াবলি",  aliases:["আন্তর্জাতিক বিষয়াবলি","আন্তর্জাতিক বিষয়াবলী","আন্তর্জাতিক","International"]},
      {key:"gk",   name:"সাধারণ জ্ঞান",          short:"সাধারণ জ্ঞান",          aliases:["সাধারণ জ্ঞান","সাধারন জ্ঞান","General Knowledge"]},
      {key:"comp", name:"কম্পিউটার",              short:"কম্পিউটার",              aliases:["কম্পিউটার","Computer","কম্পিউটার ও আইসিটি","কম্পিউটার ও তথ্যপ্রযুক্তি","আইসিটি","ICT"]},
    ] },
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
// 🆕 tpl (ঐচ্ছিক) — paperTemplates.js-এর টেমপ্লেট; দিলে হেডিং/ফরম্যাট/লেআউট সেট হয়ে শুরু হয়, কিন্তু
// ভেতরের সাব-পার্ট বক্স সব ফাঁকা (কোনো স্যাম্পল/প্লেসহোল্ডার টেক্সট নেই)। না দিলে আগের মতোই (OCR ইম্পোর্ট)।
const newGroupCard=(tpl)=>({id:newPaperId(),formatStyle:tpl?tpl.fmt:"plain",heading:tpl?tpl.heading:"",tplKey:tpl?tpl.key:"",
  wordBox:tpl&&tpl.key==="cloze"?Array(6).fill(""):[],passage:"",topicSel:{id:"",name:""},subjectChoice:"grammar",
  items:Array.from({length:(tpl&&tpl.rows)||DEFAULT_SUBPARTS},()=>tpl&&tpl.mcq?{...newPaperItem(),qtype:"mcq"}:newPaperItem())});
const newFlatCard=(isGk)=>({id:newPaperId(),question:"",answer:"",explanation:"",technique:"",qtype:"written",opt1:"",opt2:"",opt3:"",opt4:"",topicSel:{id:"",name:""},subjectSel:{id:"",name:""}});
const makeInitialPaper=()=>({bangla:[newGroupCard(PAPER_TEMPLATES.bangla[0])],english:[newGroupCard(PAPER_TEMPLATES.english[0])],math:[newFlatCard(false)],gk:[newFlatCard(true)]});
const toBn=n=>String(n).replace(/\d/g,d=>"০১২৩৪৫৬৭৮৯"[d]);
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

/* ══════════ 🆕 ছাপা-প্রশ্নপত্র (printed sheet) স্টাইল — Written ট্যাবের কার্ডগুলোর জন্য ══════════ */
const PS_CSS=`
.ps-sheet,.ps-sheet *{box-sizing:border-box}
.ps-bn{margin-bottom:8px}
.ps-bn .b1{background:#FFEB00;color:#000;text-align:center;font-weight:800;font-size:19px;padding:5px}
.ps-bn .b2{background:#E8710A;color:#000;text-align:center;font-weight:800;font-size:16px;padding:3px}
.ps-bn .b3{background:#1F2A6B;color:#fff;display:flex;justify-content:space-between;font-weight:800;font-size:12px;padding:4px 8px}
.ps-sheet{background:#fff;color:#000;border:1px solid #C9BFA0;border-radius:6px;padding:6px 10px 10px;margin-bottom:10px;font-family:"Noto Sans Bengali","Hind Siliguri",inherit;font-size:14px}
.ps-en{font-family:Georgia,"Times New Roman",serif}
.ps-hd{display:flex;align-items:flex-start;gap:5px;margin-top:2px}
.ps-h{flex:1;font-weight:800;font-size:15px;margin:2px 0 3px;white-space:pre-wrap}
.ps-ex{flex:none;border:1px solid #1F2A6B;background:#fff;color:#1F2A6B;font-size:11px;font-weight:700;border-radius:6px;padding:2px 7px;cursor:pointer;white-space:nowrap;font-family:system-ui,"Noto Sans Bengali",sans-serif}
.ps-ex.on{background:#1F2A6B;color:#fff}
.ps-x{border:0;background:none;font-size:12px;padding:0 2px;cursor:pointer;opacity:.7;flex:none}
.ps-mini{border:0;background:none;font-size:11px;padding:0 2px;cursor:pointer;opacity:.6;flex:none}
.ps-pk{margin:3px 0 5px 8px;border:1px solid #1F2A6B;border-radius:8px;overflow:hidden}
.ps-pk button{display:block;width:100%;text-align:left;border:0;border-bottom:1px solid #ddd;background:#fff;color:#000;font-size:13px;padding:6px 8px;cursor:pointer;font-family:inherit}
.ps-pk button:last-child{border-bottom:0}
.ps-pk button.cur{background:#FFEB00;font-weight:800}
.ps-row{display:grid;grid-template-columns:26px minmax(0,1.15fr) 16px minmax(0,1fr) auto;column-gap:3px;align-items:baseline;margin:0 0 2px 6px;line-height:1.35}
.ps-row.st{grid-template-columns:26px minmax(0,1fr) auto}
.ps-lab{white-space:nowrap}
.ps-sep{text-align:center}
.ps-ac{display:inline-flex;align-items:center;gap:1px;justify-self:end}
.ps-l2{grid-column:2 / -1;display:flex;gap:4px;align-items:baseline;margin-bottom:2px}
.ps-l2>span{white-space:nowrap}
.ps-in{display:block;width:100%;min-width:0;background:transparent;border:0;border-bottom:1px dotted #bbb;border-radius:0;font:inherit;color:#000;padding:2px 1px;outline:none;resize:none;overflow:hidden;line-height:1.35}
.ps-in:focus{background:#fffbe0;border-bottom:1px solid #1F2A6B}
.ps-in.q{text-shadow:.5px 0 0 currentColor}   /* বোল্ড-লুক, কিন্তু font-weight বদলায় না — নইলে Ctrl+B উল্টো আনবোল্ড করে */
.ps-in.ok{border-bottom:1px solid #22a559}
.ps-bdg{background:#000;color:#fff;padding:0 5px;border-radius:3px;font-size:12px}
.ps-opts{flex:1;display:grid;grid-template-columns:1fr 1fr;gap:2px 10px}
.ps-opts label{display:flex;gap:3px;align-items:baseline}
.ps-tbl{border-collapse:collapse;width:calc(100% - 6px);margin:3px 0 4px 6px;table-layout:fixed}
.ps-tbl th{background:#d9d9d9;border:1px solid #000;padding:3px;font-weight:800;text-align:center}
.ps-tbl td{border:1px solid #000;padding:0 4px}
.ps-tbl td .ps-in{border:0;padding:5px 1px}
.ps-tbl .xc{border:0;width:44px;padding:0;text-align:right}
.ps-tbl th.ps-thx{border:0;background:none;width:44px}
.ps-add{margin:2px 0 4px 6px;border:1px dashed #8a6d1d;background:none;color:#8a6d1d;font-size:12px;font-weight:700;border-radius:6px;padding:3px 10px;cursor:pointer;font-family:inherit}
.ps-cu{display:flex;gap:6px;margin:2px 0 6px 6px;align-items:center}
.ps-cu select{flex:none;max-width:46%;font-size:11px}
.ps-hint{font-size:10.5px;color:#7a6a3a;margin:0 0 4px 6px}
.ps-wb{display:flex;flex-wrap:wrap;border-left:1px solid #000;border-top:1px solid #000;margin:3px 0 4px 6px;width:calc(100% - 6px)}
.ps-wc{border-right:1px solid #000;border-bottom:1px solid #000;width:33.333%;display:flex;align-items:center;padding:0 2px}
.ps-wc .ps-in{text-align:center;border:0}
.ps-box{border:1px dotted #999!important;padding:5px!important;min-height:70px;margin:4px 0}
.ps-h2{font-weight:800;margin:4px 0 2px 6px}
.ps-an{display:flex;flex-wrap:wrap;gap:0 10px;margin-left:6px}
.ps-ch{display:flex;align-items:baseline;gap:3px;width:calc(50% - 5px)}
.ps-ch b{white-space:nowrap;font-weight:800}
.ps-w{position:relative;flex:1;min-width:0;width:100%}
.ps-tb{position:absolute;bottom:100%;left:0;z-index:30;display:flex;gap:2px;background:#1F2A6B;border-radius:6px;padding:2px 3px;box-shadow:0 2px 6px rgba(0,0,0,.3)}
.ps-tb button{background:none;border:0;color:#fff;font-size:13px;min-width:24px;height:22px;cursor:pointer;font-family:Georgia,serif;border-radius:4px}
.ps-tb button:hover{background:#ffffff33}
.ps-pv{font-size:12.5px;background:#fffbe0;border-left:3px solid #1F2A6B;padding:1px 6px;margin:1px 0 2px;color:#000;white-space:pre-wrap}
.ps-rt{white-space:pre-wrap;word-break:break-word;min-height:1.45em;cursor:text;-webkit-user-select:text;user-select:text}
.ps-rt b{font-weight:800}
.ps-rt u{text-decoration:underline}
.ps-rt sup,.ps-rt sub{font-size:.72em;line-height:0}
.ps-sqrt{border-top:1.5px solid currentColor;padding:0 1px;margin-left:1px}
.ps-sqrt::before{content:"√";margin-right:1px}
.ps-rt .ps-fr{user-select:none;cursor:default}
.ps-fr{display:inline-flex;flex-direction:column;vertical-align:middle;text-align:center;margin:0 2px;line-height:1.15;font-size:.95em}
.ps-fn{border-bottom:1px solid currentColor;padding:0 3px}
.ps-fd{padding:0 3px}
.ps-qa{margin:0 0 10px 6px}
.ps-qar{display:flex;gap:5px;align-items:flex-start;margin-bottom:4px}
.ps-qal{font-weight:700;white-space:nowrap;padding-top:3px;min-width:52px}
.ps-opt{font-size:10px;color:#8a8a8a;font-style:italic;white-space:nowrap}
.ps-auto{font-weight:800;color:#1b6b2f}
.ps-hintbar{font-size:10.5px;color:#7a6a3a;margin:0 0 6px}
.ps-tp{background:#FBF7EA;border:1px solid #C9BFA0;border-radius:8px;padding:8px;margin-top:8px}
`;
/* ══════════ 🆕 রিচ-টেক্সট ঘর (Bold / Underline / Italic / ভগ্নাংশ — লেখার সময়ই সত্যিকারের চেহারায়) ══════════
   আগে ঘরে কাঁচা ট্যাগ (<b>শব্দ</b>) দেখাত আর নিচে আলাদা প্রিভিউ। এখন ঘরটা নিজেই রিচ-এডিটর: টেক্সট সিলেক্ট করে
   Ctrl+B / Ctrl+U / Ctrl+I (বা ভেসে ওঠা B U I BU টুলবার) দিলে ঘরেই বোল্ড/আন্ডারলাইন/ইটালিক দেখায়, ভগ্নাংশ ওপর-নিচ
   আকারে দেখায় — কোনো কোড দেখা যায় না।
   ডেটাবেজ/স্টেট আগের মতোই ট্যাগসহ স্ট্রিং: <b>..</b> <u>..</u> <i>..</i> <frac>ওপর|নিচ</frac> (value/onChange একই)।
   ⚠️ ইউজার অ্যাপে এই চারটা ট্যাগ রেন্ডার করতে হবে। ঘরের ভেতরের কাজ: স্ট্রিং ⇄ DOM রূপান্তর (psToHTML / psSerialize),
   আর স্ট্রিং-ইনডেক্স ⇄ কার্সর (psIndexOf / psPointFromIndex) — wrapHighlight (🖍), গণিতের স্বয়ংক্রিয় চিহ্ন, Tab-ক্রম
   সবাই আগের মতোই el.value / selectionStart / setSelectionRange দিয়ে কাজ করে (ঘরে এই প্রপার্টিগুলো শিম করা আছে)। */
const PS_TOK=/(<frac>[\s\S]*?<\/frac>|<\/?(?:b|u|i|sup|sub|sqrt)>)/;
const psEsc=s=>String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
// স্ট্রিং → HTML (শেষের নতুন-লাইনের প্লেসহোল্ডার ছাড়া); <sqrt> → span.ps-sqrt (√ ও ওপরের দাগ CSS দিয়ে), ভগ্নাংশের ওপর/নিচও রিচ
function psInline(v){
  return String(v||"").split(PS_TOK).map(p=>{
    if(!p) return "";
    const fm=/^<frac>([\s\S]*?)\|([\s\S]*?)<\/frac>$/.exec(p);
    if(fm) return '<span class="ps-fr" contenteditable="false" data-n="'+psEsc(fm[1])+'" data-d="'+psEsc(fm[2])+'"><span class="ps-fn">'+psInline(fm[1])+'</span><span class="ps-fd">'+psInline(fm[2])+'</span></span>';
    if(p==="<sqrt>") return '<span class="ps-sqrt">';
    if(p==="</sqrt>") return "</span>";
    if(/^<\/?(?:b|u|i|sup|sub)>$/.test(p)) return p;
    return psEsc(p).replace(/\n/g,"<br>");
  }).join("");
}
function psToHTML(value){
  const v=String(value||"");
  return psInline(v)+(v.endsWith("\n")?"<br>":"");            // শেষের নতুন-লাইনের জন্য প্লেসহোল্ডার
}
// এলিমেন্টটা সিরিয়ালাইজে কোন কোন ট্যাগ হবে (বাইরে → ভেতরে): b, i, u, sup, sub, sqrt
function psTags(n){
  const tag=n.tagName.toLowerCase(), st=n.style||{}, out=[];
  if(tag==="b"||tag==="strong"||st.fontWeight==="bold"||parseInt(st.fontWeight,10)>=600) out.push("b");
  if(tag==="i"||tag==="em"||st.fontStyle==="italic") out.push("i");
  if(tag==="u"||String(st.textDecorationLine||st.textDecoration||"").indexOf("underline")>=0) out.push("u");
  if(tag==="sup") out.push("sup");
  else if(tag==="sub") out.push("sub");
  else if(n.classList&&n.classList.contains("ps-sqrt")) out.push("sqrt");
  return out;
}
const psOpenLen=n=>psTags(n).reduce((a,t)=>a+t.length+2,0);
const psCloseLen=n=>psTags(n).reduce((a,t)=>a+t.length+3,0);
function psSerNodes(nodes){ let s=""; for(const n of nodes) s+=psSerNode(n); return s; }
function psSerNode(n){
  if(n.nodeType===3) return n.nodeValue.replace(/\u00a0/g," ").replace(/\u200b/g,"");
  if(n.nodeType!==1) return "";
  const tag=n.tagName.toLowerCase();
  if(tag==="br") return "\n";
  if(n.classList&&n.classList.contains("ps-fr")) return "<frac>"+(n.getAttribute("data-n")||"")+"|"+(n.getAttribute("data-d")||"")+"</frac>";
  let inner=psSerNodes(n.childNodes);
  if(tag==="div"||tag==="p") return "\n"+inner;   // নিরাপত্তা-জাল (Enter আমরা <br> দিয়েই নিই)
  const tg=psTags(n);
  for(let k=tg.length-1;k>=0;k--) inner="<"+tg[k]+">"+inner+"</"+tg[k]+">";
  return inner;
}
function psSerialize(host){
  let s=psSerNodes(host.childNodes);
  if(s.endsWith("\n")) s=s.slice(0,-1);   // শেষের নতুন-লাইনের প্লেসহোল্ডার (দেখাতে একটা বাড়তি \n/<br> লাগে) বাদ
  return s;
}
// DOM-বিন্দু → স্ট্রিং-ইনডেক্স (ট্যাগসহ স্ট্রিং-এর হিসাবে)
function psIndexOf(host,container,offset){
  const r=document.createRange(); r.setStart(host,0);
  try{ r.setEnd(container,offset); }catch(_){ return 0; }
  let len=psSerNodes(r.cloneContents().childNodes).length;
  let el=container.nodeType===1?container:container.parentNode;       // ক্লোনে বন্ধ-হওয়া আগের ট্যাগের ক্লোজিং বাদ
  while(el&&el!==host){ if(el.nodeType===1) len-=psCloseLen(el); el=el.parentNode; }
  return Math.max(0,len);
}
// স্ট্রিং-ইনডেক্স → DOM-বিন্দু
function psPointFromIndex(host,idx){
  let rem=idx;
  const walk=parent=>{
    const kids=parent.childNodes;
    for(let i=0;i<kids.length;i++){
      const n=kids[i];
      if(n.nodeType===3){ const L=n.nodeValue.length; if(rem<=L) return {node:n,offset:rem}; rem-=L; }
      else if(n.nodeType===1){
        if(n.nodeName==="BR"){ if(rem===0) return {node:parent,offset:i}; rem-=1; continue; }
        if(n.classList.contains("ps-fr")){
          const L=("<frac>"+(n.getAttribute("data-n")||"")+"|"+(n.getAttribute("data-d")||"")+"</frac>").length;
          if(rem===0) return {node:parent,offset:i};
          if(rem<L) return {node:parent,offset:i+1};
          rem-=L; continue;
        }
        const oc=psOpenLen(n), cc=psCloseLen(n);
        if(rem<oc) return {node:parent,offset:i};
        rem-=oc;
        const r=walk(n); if(r) return r;
        if(rem<cc) return {node:parent,offset:i+1};
        rem-=cc;
      }
    }
    return null;
  };
  return walk(host)||{node:host,offset:host.childNodes.length};
}
function psCaret(host){
  const sel=window.getSelection(); if(!sel||!sel.rangeCount) return null;
  const r=sel.getRangeAt(0); if(!host.contains(r.startContainer)||!host.contains(r.endContainer)) return null;
  const total=psSerialize(host).length;
  return {s:Math.min(total,psIndexOf(host,r.startContainer,r.startOffset)),e:Math.min(total,psIndexOf(host,r.endContainer,r.endOffset))};
}
function psSetCaret(host,a,b){
  const p=psPointFromIndex(host,a), q=psPointFromIndex(host,b==null?a:b);
  const r=document.createRange(); r.setStart(p.node,p.offset); r.setEnd(q.node,q.offset);
  const sel=window.getSelection(); sel.removeAllRanges(); sel.addRange(r);
}
function psFracBefore(host){                      // কার্সরের ঠিক আগে ভগ্নাংশ-এলিমেন্ট থাকলে সেটা
  const sel=window.getSelection(); if(!sel||!sel.rangeCount||!sel.isCollapsed) return null;
  const r=sel.getRangeAt(0); let n=null;
  if(r.startContainer.nodeType===1&&r.startOffset>0) n=r.startContainer.childNodes[r.startOffset-1];
  else if(r.startContainer.nodeType===3&&r.startOffset===0) n=r.startContainer.previousSibling;
  return n&&n.nodeType===1&&n.classList&&n.classList.contains("ps-fr")?n:null;
}

/* ══════════ 🆕 গণিতের লেখার নিয়ম (শুধু গণিত ট্যাবে — PsTA math prop) ══════════
   * → ×   / → ÷   (ব্যাকস্পেস দিলে সাথে সাথে * বা / ফিরে আসে)
   "অতএব" লিখে স্পেস দিলে → ∴ (ব্যাকস্পেস দিলে "অতএব" ফিরে আসে)
   ভগ্নাংশ: স্পেস ছাড়া লিখলে — ১/ক-খ , ৩/৫ — স্পেস/বর্ডারে পৌঁছালে (বা ঘর থেকে বের হলে) ভগ্নাংশ <frac>১|ক-খ</frac> হয়
            (ব্যাকস্পেসে আবার ১/ক-খ ফিরে আসে)। স্পেস দিয়ে লিখলে (২৫ / ৫) ভাগ চিহ্ন ÷ ই থাকে।
   ⚠️ ইউজার অ্যাপে <frac>ওপর|নিচ</frac> ট্যাগ ভগ্নাংশ হিসেবে রেন্ডার করতে হবে (প্লেইন টেক্সটে "ওপর|নিচ" দেখায়)। */
const PS_FR_STOP=/[\s=+\-×÷*\/,;।:<>|{}\[\]]/;
const PS_FR_DSTOP=/[\s=,;।:<>|×÷*]/;
function psFracAt(text,i){            // text[i]==="÷"; দুই পাশে স্পেস ছাড়া অপারেন্ড থাকলে {s,e,n,d}
  let s=i, moved=true;
  while(moved){                       // বাঁ দিকে: একের পর এক ট্যাগ-গ্রুপ (x<sup>2</sup>), বন্ধনী-গ্রুপ, বা অপারেন্ড-রান
    moved=false;
    const before=text.slice(0,s), tm=/<\/(sup|sub|sqrt)>$/.exec(before);
    if(tm){ const k=before.lastIndexOf("<"+tm[1]+">"); if(k<0)return null; s=k; moved=true; continue; }
    if(text[s-1]===")"){
      let depth=0,k=s-1;
      for(;k>=0;k--){ if(text[k]===")")depth++; else if(text[k]==="("){ depth--; if(depth===0)break; } }
      if(k<0)return null; s=k; moved=true; continue;
    }
    const s0=s; while(s>0&&!PS_FR_STOP.test(text[s-1])&&text[s-1]!=="(")s--;
    if(s<s0) moved=true;
  }
  if(s===i)return null;
  let e=i+1;                          // ডান দিকে: <sup>..</sup> ইত্যাদি গ্রুপ পুরোটা হর-এর অংশ
  while(e<text.length){
    const om=/^<(sup|sub|sqrt)>/.exec(text.slice(e));
    if(om){ const close="</"+om[1]+">", k=text.indexOf(close,e); if(k<0)break; e=k+close.length; continue; }
    if(PS_FR_DSTOP.test(text[e]))break;
    e++;
  }
  while(e>i+1&&text[e-1]===".")e--;    // বাক্যের শেষের দাঁড়ি হর-এ ঢুকবে না
  if(e===i+1)return null;
  return {s,e,n:text.slice(s,i),d:text.slice(i+1,e)};
}
function psFractionize(text){
  let out=String(text||""),pos=0;
  for(;;){
    const i=out.indexOf("÷",pos); if(i<0)break;
    const f=psFracAt(out,i);
    if(!f){ pos=i+1; continue; }
    const repl="<frac>"+f.n+"|"+f.d+"</frac>";
    out=out.slice(0,f.s)+repl+out.slice(f.e);
    pos=f.s+repl.length;
  }
  return out;
}
/* ── গণিতের আরও রেন্ডার (স্পেস/Enter/ঘর-ছাড়ার সময় একটা শব্দ-খণ্ডে, ব্যাকস্পেসে কাঁচা লেখা ফিরে আসে) ──
   root7 , root(a+b) → √ (ওপরে দাগসহ) <sqrt>7</sqrt>      a^2 , x^n , a^(n+1) , a^{-2} → ঘাত <sup>2</sup>
   x_1 , a_n → নিচের ছোট অক্ষর <sub>1</sub>               তারপর ÷ → ভগ্নাংশ (a^2/b → a² ওপরে, b নিচে)
   ⚠️ ইউজার অ্যাপে <sup> <sub> <sqrt> ট্যাগও রেন্ডার করতে হবে (<sup>/<sub> স্ট্যান্ডার্ড HTML; <sqrt> = বর্গমূল-চিহ্ন + ওপরে দাগ) */
function psMathConvert(run){
  let s=String(run);
  s=s.replace(/(^|[^A-Za-z])root\(([^()]*)\)/g,(m,p,a)=>p+"<sqrt>"+a+"</sqrt>");
  s=s.replace(/(^|[^A-Za-z])root([০-৯0-9][০-৯0-9.]*|[A-Za-z](?![A-Za-z]))/g,(m,p,a)=>{
    const dot=/\.$/.test(a)?".":""; return p+"<sqrt>"+a.replace(/\.$/,"")+"</sqrt>"+dot;
  });
  s=s.replace(/([A-Za-z০-৯0-9\u0980-\u09FF)\]>])\^(\(([^()]*)\)|\{([^{}]*)\}|[-+]?[০-৯0-9]+|[A-Za-z](?![A-Za-z]))/g,
    (m,base,ex,pa,br)=>base+"<sup>"+(pa!==undefined?pa:(br!==undefined?br:ex))+"</sup>");
  s=s.replace(/(^|[^A-Za-z])([A-Za-z])_([০-৯0-9]+|[a-z](?![A-Za-z]))/g,(m,p,a,b)=>p+a+"<sub>"+b+"</sub>");
  return psFractionize(s);
}
const PS_MATH_TRIGGER=/[÷^_]|root/;
const psMathConvertText=text=>String(text||"").replace(/\S+/g,tok=>PS_MATH_TRIGGER.test(tok)?psMathConvert(tok):tok);

/* ── 🆕 টাইপ করার সাথে সাথেই রূপান্তর (স্পেসের অপেক্ষা নয়) ──
   run = শেষ স্পেস/নতুন-লাইনের পর থেকে কার্সর পর্যন্ত কাঁচা লেখা, টাইপ-করা অক্ষরসহ। শুধু সেই প্যাটার্নই ধরা হয় যেটা এই অক্ষরেই সম্পূর্ণ হলো।
   open=true → সংখ্যা দিয়ে শেষ (root7, x^2, x_1): পরের সংখ্যা ভেতরেই বাড়ে (root72 → √72); অন্য অক্ষর টাইপ করলে বাইরে বেরিয়ে যায়।
   open=false → বন্ধনী/অক্ষর দিয়ে শেষ (root(a+b), x^(n+1), x^n): পরের অক্ষর সরাসরি বাইরে। Backspace দিলে কাঁচা লেখা ফিরে আসে। */
const PS_BASE="[A-Za-z০-৯0-9\\u0980-\\u09FF)\\]>]";
function psInstantTail(run){
  let m;
  m=/(^|[^A-Za-z])(root\(([^()]*)\))$/.exec(run);
  if(m) return {start:m.index+m[1].length,raw:m[2],conv:"<sqrt>"+m[3]+"</sqrt>",open:false};
  m=/(^|[^A-Za-z])(root([০-৯0-9]))$/.exec(run);
  if(m) return {start:m.index+m[1].length,raw:m[2],conv:"<sqrt>"+m[3]+"</sqrt>",open:true};
  m=new RegExp("("+PS_BASE+")\\^(?:\\(([^()]*)\\)|\\{([^{}]*)\\})$").exec(run);
  if(m) return {start:m.index,raw:m[0],conv:m[1]+"<sup>"+(m[2]!==undefined?m[2]:m[3])+"</sup>",open:false};
  m=new RegExp("("+PS_BASE+")\\^([-+]?[০-৯0-9])$").exec(run);
  if(m) return {start:m.index,raw:m[0],conv:m[1]+"<sup>"+m[2]+"</sup>",open:true};
  m=new RegExp("("+PS_BASE+")\\^([A-Za-z])$").exec(run);
  if(m) return {start:m.index,raw:m[0],conv:m[1]+"<sup>"+m[2]+"</sup>",open:false};
  m=/(^|[^A-Za-z])([A-Za-z])_([০-৯0-9])$/.exec(run);
  if(m) return {start:m.index+m[1].length,raw:m[0].slice(m[1].length),conv:m[2]+"<sub>"+m[3]+"</sub>",open:true};
  m=/(^|[^A-Za-z])([A-Za-z])_([a-z])$/.exec(run);
  if(m) return {start:m.index+m[1].length,raw:m[0].slice(m[1].length),conv:m[2]+"<sub>"+m[3]+"</sub>",open:false};
  return null;
}
const psCloseTagLen=conv=>{ const m=/<\/(sup|sub|sqrt)>$/.exec(conv); return m?m[0].length:0; };
// কার্সর কি এমন একটা স্বয়ংক্রিয়-এলিমেন্টের শেষে, যেটা এইমাত্র রূপান্তরে তৈরি (data-auto)?
function psAutoOpen(h){
  const sel=window.getSelection(); if(!sel||!sel.rangeCount||!sel.isCollapsed) return null;
  let n=sel.anchorNode; n=n&&(n.nodeType===1?n:n.parentNode);
  const el=n&&n.closest?n.closest("[data-auto]"):null;
  if(!el||!h.contains(el)) return null;
  const r=sel.getRangeAt(0), tail=document.createRange();
  try{ tail.setStart(r.endContainer,r.endOffset); tail.setEnd(el,el.childNodes.length); }catch(_){ return null; }
  if(tail.toString()!=="") return null;
  return {el,mode:el.getAttribute("data-auto")};
}
const psClearAuto=h=>{ if(h) h.querySelectorAll("[data-auto]").forEach(e=>e.removeAttribute("data-auto")); };
// অক্ষর/স্পেস/নতুন-লাইন এলিমেন্টের বাইরে বসানো (ch==="" হলে শুধু কার্সর বাইরে নেওয়া)
function psExitAuto(h,el,ch){
  el.removeAttribute("data-auto");
  const tn=document.createTextNode(ch===" "?"\u00a0":ch);
  el.parentNode.insertBefore(tn,el.nextSibling);
  const r=document.createRange(); r.setStart(tn,tn.nodeValue.length); r.collapse(true);
  const sel=window.getSelection(); sel.removeAllRanges(); sel.addRange(r);
  if(ch!=="") h.dispatchEvent(new Event("input",{bubbles:true}));
}

// ── রিচ-টেক্সট ঘর ──
function PsTA({value,onChange,onKeyDown,taRef,className,math,cover}){
  // 🆕 cover=true (শুধু প্রশ্ন ও উত্তর ঘর): টাইপ শুরুতে কালো আবরণ, ৩ সেকেন্ড থামলে সরে, সংশোধনে ফেরে না
  const tc=useTypingCover(value);
  const tk=useTypingTrack(value);   // 🆕 টাইপিং ট্র্যাকার — শুধু cover=true (প্রশ্ন/উত্তর) ঘরে সক্রিয়
  const hostRef=useRef(null), lastAuto=useRef(null), skipN=useRef(0), onChangeRef=useRef(onChange), mathRef=useRef(!!math);
  onChangeRef.current=onChange; mathRef.current=!!math;
  const[hasSel,setHasSel]=useState(false);
  const[focused,setFocused]=useState(false);

  // value (স্ট্রিং) → DOM: DOM আগে থেকেই একই হলে (নিজের টাইপ করা) কিছু ছোঁয়া হয় না
  useLayoutEffect(()=>{
    const h=hostRef.current; if(!h)return;
    const nv=String(value||"");
    if(psSerialize(h)===nv)return;
    const was=document.activeElement===h?psCaret(h):null;
    h.innerHTML=psToHTML(nv);
    if(was) psSetCaret(h,Math.min(was.s,nv.length),Math.min(was.e,nv.length));
  },[value]);

  // textarea-র মতো el.value / selectionStart / selectionEnd / setSelectionRange (wrapHighlight ইত্যাদি এগুলোই ব্যবহার করে)
  const setRef=el=>{
    hostRef.current=el;
    if(el&&!el.__psShim){
      el.__psShim=true;
      Object.defineProperties(el,{
        value:{get(){ return psSerialize(el); },set(v){ el.innerHTML=psToHTML(v); },configurable:true},
        selectionStart:{get(){ const c=psCaret(el); return c?c.s:psSerialize(el).length; },configurable:true},
        selectionEnd:{get(){ const c=psCaret(el); return c?c.e:psSerialize(el).length; },configurable:true},
        setSelectionRange:{value:(a,b)=>psSetCaret(el,a,b),configurable:true},
      });
    }
    if(taRef)taRef(el);
  };

  const emit=v=>{ if(onChangeRef.current)onChangeRef.current({target:{value:v}}); };
  const exec=(cmd)=>{ const h=hostRef.current; if(!h)return; h.focus(); try{ document.execCommand("styleWithCSS",false,false); }catch(_){} document.execCommand(cmd,false,null); };
  const wrapSqrt=()=>{                                     // সিলেক্ট করা অংশ √-এর ভেতরে (ওপরে দাগসহ)
    const h=hostRef.current; if(!h)return; h.focus();
    const sel=window.getSelection(); const txt=sel?sel.toString():""; if(!txt)return;
    document.execCommand("insertHTML",false,'<span class="ps-sqrt">'+psEsc(txt)+'</span>');
  };
  const applyBoth=()=>{
    const h=hostRef.current; if(!h)return; h.focus();
    const b=document.queryCommandState("bold"), u=document.queryCommandState("underline");
    if(b&&u){ exec("underline"); exec("bold"); } else { if(!b)exec("bold"); if(!u)exec("underline"); }
  };

  // beforeinput: Enter → <br>, গণিতের স্বয়ংক্রিয় চিহ্ন + ব্যাকস্পেসে ফেরত (native listener, যাতে preventDefault নির্ভরযোগ্য হয়)
  useEffect(()=>{
    const h=hostRef.current; if(!h)return;
    const handler=ev=>{
      const it=ev.inputType, comp=ev.isComposing;
      const isNL=(it==="insertParagraph"||it==="insertLineBreak");
      if(mathRef.current&&!comp){
        const c=psCaret(h);
        // 🆕 (ক) কার্সর এইমাত্র-তৈরি √ / ঘাত / নিচের-অক্ষর এলিমেন্টের শেষে: সংখ্যা হলে ভেতরেই বাড়বে, নইলে বাইরে বেরিয়ে অক্ষর বসবে
        if((it==="insertText"&&ev.data)||isNL){
          const ao=psAutoOpen(h);
          if(ao){
            if(it==="insertText"&&ao.mode==="num"&&/^[০-৯0-9]$/.test(ev.data)){
              const la=lastAuto.current;
              if(la&&la.instant){ la.original+=ev.data; la.repl=la.repl.replace(/(<\/(?:sup|sub|sqrt)>)$/,ev.data+"$1"); la.caret+=1; }
              skipN.current=1; return;                       // ব্রাউজারের স্বাভাবিক বসানো — ভেতরেই
            }
            ev.preventDefault();
            if(isNL){ psExitAuto(h,ao.el,""); document.execCommand("insertLineBreak"); }
            else psExitAuto(h,ao.el,ev.data);
            return;
          }
        }
        // 🆕 (খ) টাইপ করা অক্ষরেই প্যাটার্ন সম্পূর্ণ হলে সাথে সাথে রূপান্তর (root7, root(a+b), x^2, x^(n+1), x^n, x_1, x_n, অতএব)
        if(it==="insertText"&&ev.data&&ev.data!==" "&&ev.data!=="*"&&ev.data!=="/"&&c&&c.s===c.e){
          const ch=ev.data, v0=psSerialize(h), before=v0.slice(0,c.s)+ch;
          const rs=Math.max(before.lastIndexOf(" "),before.lastIndexOf("\n"))+1, run=before.slice(rs);
          if(ch==="ব"&&/(^|[\s(,;:।])অতএব$/.test(before)){
            ev.preventDefault();
            const start=before.length-"অতএব".length;
            psSetCaret(h,start,c.s);
            lastAuto.current={start,repl:"∴",original:"অতএব",tail:"",caret:start+1}; skipN.current=1;
            document.execCommand("insertText",false,"∴"); return;
          }
          const t=psInstantTail(run);
          if(t){
            ev.preventDefault();
            const start=rs+t.start;
            psSetCaret(h,start,c.s);
            lastAuto.current={start,repl:t.conv,original:t.raw,tail:"",caret:start+t.conv.length-psCloseTagLen(t.conv),instant:true}; skipN.current=1;
            document.execCommand("insertHTML",false,psToHTML(t.conv));
            psSetCaret(h,start+t.conv.length-psCloseTagLen(t.conv));          // কার্সর এলিমেন্টের ভেতরে শেষে
            const sel=window.getSelection(); let n=sel.anchorNode; n=n&&(n.nodeType===1?n:n.parentNode);
            const el=n&&n.closest?n.closest("sup,sub,.ps-sqrt"):null;
            if(el&&h.contains(el)) el.setAttribute("data-auto",t.open?"num":"closed");
            return;
          }
        }
        if(it==="insertText"&&(ev.data==="*"||ev.data==="/")&&c&&c.s===c.e){
          ev.preventDefault();
          const repl=ev.data==="*"?"×":"÷";
          lastAuto.current={start:c.s,repl,original:ev.data,tail:"",caret:c.s+1}; skipN.current=1;
          document.execCommand("insertText",false,repl); return;
        }
        if(((it==="insertText"&&ev.data===" ")||isNL)&&c&&c.s===c.e){
          const v=psSerialize(h), before=v.slice(0,c.s), tail=isNL?"\n":" ";
          const put=()=>{ if(isNL) document.execCommand("insertLineBreak"); else document.execCommand("insertText",false," "); };
          if(/(^|[\s(,;:।])অতএব$/.test(before)){
            ev.preventDefault();
            const start=before.length-"অতএব".length;
            psSetCaret(h,start,c.s);
            lastAuto.current={start,repl:"∴",original:"অতএব",tail,caret:start+2}; skipN.current=2;
            document.execCommand("insertText",false,"∴"); put(); return;
          }
          const runStart=Math.max(before.lastIndexOf(" "),before.lastIndexOf("\n"))+1, run=before.slice(runStart);
          if(PS_MATH_TRIGGER.test(run)){
            const conv=psMathConvert(run);
            if(conv!==run){
              ev.preventDefault();
              psSetCaret(h,runStart,c.s);
              lastAuto.current={start:runStart,repl:conv,original:run.replace(/÷/g,"/"),tail,caret:runStart+conv.length+1}; skipN.current=1;
              // রূপান্তরিত অংশ + বাউন্ডারি অক্ষর (স্পেস/নতুন-লাইন) একই ইনসার্টে — নইলে কার্সর <sup>/√-এর ভেতরেই থেকে যায় আর পরের লেখা ঘাতের ভেতরে ঢোকে
              document.execCommand("insertHTML",false,psToHTML(conv)+(isNL?"<br>"+(c.s===v.length?"<br>":""):" "));
              psSetCaret(h,runStart+conv.length+1); return;
            }
          }
        }
        if(it==="deleteContentBackward"){
          const la=lastAuto.current, cc=psCaret(h);
          if(la&&cc&&cc.s===cc.e&&cc.s===la.caret&&psSerialize(h).slice(la.start,la.start+la.repl.length)===la.repl){
            ev.preventDefault();
            psSetCaret(h,la.start,la.start+la.repl.length);
            lastAuto.current=null; skipN.current=2;
            document.execCommand("delete");
            // পুরো √/ঘাত এলিমেন্ট মুছলে ব্রাউজার ফাঁকা খোসা রেখে দিতে পারে — সরিয়ে কাঁচা লেখা বাইরে বসাই (নইলে লেখাটা √-এর ভেতরে ঢোকে)
            h.querySelectorAll(".ps-sqrt,sup,sub,b,u,i").forEach(el=>{ if(!el.textContent&&!el.querySelector(".ps-fr")) el.remove(); });
            psSetCaret(h,la.start);
            document.execCommand("insertText",false,la.original);
            psSetCaret(h,la.start+la.original.length+la.tail.length); return;
          }
        }
      }
      // ভগ্নাংশের ঠিক পরে ব্যাকস্পেস → কাঁচা "ওপর/নিচ" টেক্সট ফিরে আসে (ঠিক করার জন্য)
      if(it==="deleteContentBackward"){
        const fr=psFracBefore(h);
        if(fr){
          ev.preventDefault();
          const r=document.createRange(); r.selectNode(fr);
          const sel=window.getSelection(); sel.removeAllRanges(); sel.addRange(r);
          lastAuto.current=null; skipN.current=1;
          document.execCommand("insertHTML",false,psEsc((fr.getAttribute("data-n")||"")+"/"+(fr.getAttribute("data-d")||""))); return;
        }
      }
      if(isNL){ ev.preventDefault(); document.execCommand("insertLineBreak"); }
    };
    h.addEventListener("beforeinput",handler);
    return()=>h.removeEventListener("beforeinput",handler);
  },[]);

  // ভাসমান টুলবার: ঘরে ফোকাস থাকলে সিলেকশন বদলালে দেখাও/লুকাও
  useEffect(()=>{
    if(!focused)return;
    const h=hostRef.current;
    const sync=()=>{ const sel=window.getSelection(); setHasSel(!!(sel&&sel.rangeCount&&!sel.isCollapsed&&h&&h.contains(sel.anchorNode)&&h.contains(sel.focusNode))); };
    document.addEventListener("selectionchange",sync);
    return()=>document.removeEventListener("selectionchange",sync);
  },[focused]);

  // 🆕 G বাটন — সিলেক্ট করা লেখা সরাসরি Google সার্চে খোলে (অ্যাপের বাইরে ব্রাউজারে); ব্যাক করলে অ্যাপে ফেরা যায়।
  // Capacitor Browser প্লাগিন থাকলে সেটা, নইলে অ্যান্ড্রয়েড অ্যাপে লিংক বাইরের ব্রাউজারে যায়, আর সাধারণ ব্রাউজারে নতুন ট্যাবে খোলে।
  const googleSelected=()=>{
    const sel=window.getSelection();
    const q=String(sel?sel.toString():"").replace(/\s+/g," ").trim().slice(0,300);
    if(!q)return;
    const url="https://www.google.com/search?q="+encodeURIComponent(q);
    try{
      const cap=window.Capacitor;
      if(cap&&cap.Plugins&&cap.Plugins.Browser&&cap.Plugins.Browser.open){ cap.Plugins.Browser.open({url}); return; }
      if(cap&&cap.isNativePlatform&&cap.isNativePlatform()){ window.location.href=url; return; }
    }catch{}
    window.open(url,"_blank","noopener,noreferrer");
  };
  const handleInput=()=>{
    const h=hostRef.current; if(!h)return;
    const wasAuto=skipN.current>0;                    // এই input অটো-রূপান্তরের ফল কিনা (ট্র্যাকারে টাইপ ধরা হয় না)
    if(skipN.current>0) skipN.current--; else lastAuto.current=null;
    const nv=psSerialize(h);
    if(cover){ tc.onTyped(nv); tk.input(nv,{auto:wasAuto}); }
    if(nv!==String(value||"")) emit(nv);
  };
  const handleBlur=()=>{
    setFocused(false); setHasSel(false);
    if(cover) tk.blur();
    const h=hostRef.current; psClearAuto(h); if(!h||!mathRef.current)return;
    const cur=psSerialize(h), nv=psMathConvertText(cur);
    if(nv!==cur){ h.innerHTML=psToHTML(nv); emit(nv); }
  };
  const handlePaste=e=>{
    e.preventDefault();
    const text=((e.clipboardData||window.clipboardData).getData("text/plain")||"").replace(/\r\n?/g,"\n");
    text.split("\n").forEach((line,i)=>{ if(i>0)document.execCommand("insertLineBreak"); if(line)document.execCommand("insertText",false,line); });
  };
  const keyDown=e=>{
    if(["ArrowLeft","ArrowRight","ArrowUp","ArrowDown","Home","End","Tab"].includes(e.key)){ lastAuto.current=null; psClearAuto(hostRef.current); }
    if(onKeyDown)onKeyDown(e);
  };
  return (
    <div className="ps-w" style={cover?{position:"relative"}:undefined}>
      {hasSel&&(
        <div className="ps-tb" onMouseDown={e=>e.preventDefault()}>
          <button type="button" title="বোল্ড (Ctrl+B)" onClick={()=>exec("bold")}><b>B</b></button>
          <button type="button" title="আন্ডারলাইন (Ctrl+U)" onClick={()=>exec("underline")}><u>U</u></button>
          <button type="button" title="ইটালিক (Ctrl+I)" onClick={()=>exec("italic")}><i>I</i></button>
          <button type="button" title="Bold + Underline একসাথে (Fill in the blanks-এর blank)" onClick={applyBoth}><b><u>BU</u></b></button>
          {math&&<>
            <button type="button" title="ঘাত / সুপারস্ক্রিপ্ট (x²)" onClick={()=>exec("superscript")}>x²</button>
            <button type="button" title="নিচের ছোট অক্ষর (x₂)" onClick={()=>exec("subscript")}>x₂</button>
            <button type="button" title="বর্গমূল (√)" onClick={wrapSqrt}>√</button>
          </>}
          <button type="button" title="সিলেক্ট করা লেখা Google-এ সার্চ করো" onClick={googleSelected}><span style={{fontWeight:800,color:"#4285F4"}}>G</span></button>
          <button type="button" title="ফরম্যাট মুছো" onClick={()=>exec("removeFormat")}>✖</button>
        </div>
      )}
      <div ref={setRef} className={"ps-in ps-rt"+(className?" "+className:"")} contentEditable suppressContentEditableWarning spellCheck={false}
        onInput={handleInput} onKeyDown={keyDown} onPaste={handlePaste}
        onFocus={()=>setFocused(true)} onBlur={handleBlur} onMouseDown={()=>{lastAuto.current=null; psClearAuto(hostRef.current);}}/>
      {cover&&<CoverOverlay covered={tc.covered}/>}
    </div>
  );
}

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
  const subjectOptions=refData?(refData.subjects||[]).map(s=>({id:s.subject_id,name:s.subject_name})):[];
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
  // ── Tag অনুযায়ী dropdown ফিল্টার (নাম-দিয়ে-মেলানো/তৈরির লজিক সব subject দেখেই চলে, শুধু তালিকা ছোট হয়) ──
  const subjectOptionsShown=refData?subjectsForTags(refData,selectedTagIds).map(s=>({id:s.subject_id,name:s.subject_name})):[];
  const topicOptionsForShown=subjId=>refData&&subjId?topicsOfSubject(refData,subjId,selectedTagIds).map(t=>({id:t.topic_id,name:t.topic_name})):[];
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
    // ⏳ আপলোড-চলছে দাগ আছে কিন্তু কোনো জব আসলে চলছে না (অ্যাপ বন্ধ/রিলোড হয়েছিল) → লাল করে দেওয়া হয়, যাতে হারায় না
    try{ return markStalePendingFailed(LS_DRAFT_PAPER_LIST,isJobActive); }catch{ return []; }
  });
  const[showDraftList,setShowDraftList]=useState(false);
  // 🔴 ব্যর্থ সাবমিটের খসড়ার id — একই প্রশ্নপত্র আবার ব্যর্থ হলে নতুন কপি না বানিয়ে এটাই আপডেট হয়, সফল হলে এটা মুছে যায়
  const failedDraftIdRef=useRef(null);
  const failedDraftCount=draftList.filter(d=>d&&d.failed).length;
  const uploadingDraftCount=draftList.filter(d=>d&&d.uploading).length;
  const[metaMissing,setMetaMissing]=useState(false);   // 🔴 পদ/প্রতিষ্ঠান/সাল বাকি — কার্ড লাল দেখায়
  const metaCardRef=useRef(null);
  const persistDraftList=(list)=>{
    setDraftList(list);
    try{ localStorage.setItem(LS_DRAFT_PAPER_LIST,JSON.stringify(list)); }catch{}
  };
  const saveNamedDraft=()=>{
    if(!paperHasContent(paper)){ push("warn","এখনো কিছু টাইপ করা হয়নি","আগে কিছু প্রশ্ন টাইপ করো, তারপর খসড়া সেভ করো"); return; }
    // 🆕 খসড়া সেভ করতে পদ (Post) আর প্রতিষ্ঠান (Institution) দুটোই লাগবে — নইলে তালিকায় চেনা যায় না
    if(!postSel.name.trim()||!instSel.name.trim()){
      push("warn","পদ আর প্রতিষ্ঠান দুটোই দিতে হবে",`${!postSel.name.trim()?"পদ (Post) ":""}${!instSel.name.trim()?"প্রতিষ্ঠান (Institution) ":""}খালি — উপরে দিয়ে তারপর খসড়া সেভ করো`);
      try{ window.scrollTo({top:0,behavior:"smooth"}); }catch{}
      return;
    }
    // 🔴 ব্যর্থ খসড়া লোড করে এডিট করে "সেভ করো" চাপলে নতুন কপি না বানিয়ে সেটাই আপডেট হবে (লাল চিহ্নও থাকবে — ডাটাবেজে এখনো যায়নি)
    const fid=failedDraftIdRef.current;
    if(fid&&draftList.some(d=>d.id===fid)){
      persistDraftList(draftList.map(d=>d.id===fid?{...d,savedAt:Date.now(),paper,activeTab,postSel,instSel,examYear}:d));
      push("success","💾 ব্যর্থ খসড়া আপডেট হলো (এখনো ডাটাবেজে যায়নি)",draftHeadline({postSel,instSel,examYear}));
      return;
    }
    const entry={id:newPaperId(),savedAt:Date.now(),paper,activeTab,postSel,instSel,examYear};
    // ১৫টার বেশি জমতে দেওয়া হয় না — তবে ব্যর্থ (লাল) খসড়া কখনো বাদ যায় না
    const nl=[entry,...draftList];
    while(nl.length>15){ let ix=-1; for(let k=nl.length-1;k>=0;k--){ if(!nl[k].failed){ ix=k; break; } } if(ix<0)break; nl.splice(ix,1); }
    persistDraftList(nl);
    push("success","💾 নতুন খসড়া হিসেবে সেভ হলো",draftHeadline(entry));
  };
  const loadNamedDraft=(entry)=>{
    failedDraftIdRef.current=entry.failed?entry.id:null;   // 🔴 ব্যর্থ খসড়া লোড করলে পরের সফল সাবমিটে এটা নিজে মুছে যাবে
    setPaper(entry.paper);
    if(entry.activeTab)setActiveTab(entry.activeTab);
    if(entry.postSel)setPostSel(entry.postSel);
    if(entry.instSel)setInstSel(entry.instSel);
    if(entry.examYear!==undefined)setExamYear(entry.examYear);
    setShowDraftList(false);
    push("success","♻️ খসড়া লোড হলো",draftHeadline(entry));
  };
  const deleteNamedDraft=(id)=>{ if(failedDraftIdRef.current===id) failedDraftIdRef.current=null; persistDraftList(draftList.filter(d=>d.id!==id)); };
  // 🆕 প্রিভিউ পপ-আপ (লোড না করেই খসড়ার ভেতরটা দেখা) ও 🆕 New Paper (সব ফাঁকা নতুন পেজ)
  const[previewDraft,setPreviewDraft]=useState(null);
  const[confirmNew,setConfirmNew]=useState(false);
  const resetToNewPaper=()=>{
    setPaper(makeInitialPaper());
    setActiveTab("bangla");
    setPostSel({id:"",name:""});
    setInstSel({id:"",name:""});
    setExamYear("");
    setExpandedItems(new Set());
    const job=tagOptions.find(tg=>norm(tg.name)==="job");
    setSelectedTagIds(job?[job.id]:[]);
    clearDraft(LS_DRAFT_PAPER);
    failedDraftIdRef.current=null;   // নতুন প্রশ্নপত্র — আগের ব্যর্থ খসড়ার সাথে আর যুক্ত না (খসড়া তালিকায় থেকে যাবে)
    setDraftBanner(null);
    setShowDraftList(false);
    setPreviewDraft(null);
    setConfirmNew(false);
    try{ window.scrollTo({top:0,behavior:"smooth"}); }catch{}
    push("success","🆕 নতুন ফাঁকা প্রশ্নপত্র","সব ফাঁকা — নতুন করে শুরু করো");
  };
  const askNewPaper=()=>{ if(paperHasContent(paper)||postSel.name.trim()||instSel.name.trim()||examYear.trim()) setConfirmNew(true); else resetToNewPaper(); };
  // 🆕 সফল সাবমিটের পর নামসহ খসড়াগুলো থেকে "ডাটাবেজে চলে যাওয়া" কার্ড নিজে মুছে ফেলা।
  //   মিল = একই ট্যাব + একই হেডিং (বাংলা/ইংরেজি) বা একই প্রশ্ন (গণিত/GK), আর খসড়াটা একই পদ+প্রতিষ্ঠান+সালের —
  //   অন্য পরীক্ষার খসড়ায় একই হেডিং থাকলে সেটা ছোঁয়া হয় না। কার্ড মুছে খসড়া ফাঁকা হয়ে গেলে খসড়াটাই বাদ।
  const psHeadKey=s=>String(s||"").replace(/<\/?[a-z]+>/gi,"").replace(/[:：।\s]+$/g,"").replace(/\s+/g," ").trim().toLowerCase();
  const psQKey=s=>String(s||"").replace(/<[^>]*>/g,"").replace(/\s+/g," ").trim().toLowerCase();
  const psCtxKey=(post,inst,year)=>[((post&&post.name)||"").trim().toLowerCase(),((inst&&inst.name)||"").trim().toLowerCase(),String(year==null?"":year).trim()].join("|");
  const pruneNamedDrafts=(submittedPaper,ctx)=>{
    let list; try{ const raw=localStorage.getItem(LS_DRAFT_PAPER_LIST); list=raw?JSON.parse(raw):[]; }catch{ list=[]; }
    if(!Array.isArray(list)||!list.length) return {cards:0,drafts:0};
    const heads={}, qs={};
    PAPER_TABS.forEach(tb=>{
      const cards=submittedPaper[tb.key]||[];
      if(tb.grouped) heads[tb.key]=new Set(cards.filter(c=>psHeadKey(c.heading)&&(c.items||[]).some(it=>(it.question||"").trim()||(it.answer||"").trim())).map(c=>psHeadKey(c.heading)));
      else qs[tb.key]=new Set(cards.map(c=>psQKey(c.question)).filter(Boolean));
    });
    const myCtx=psCtxKey(ctx.postSel,ctx.instSel,ctx.examYear);
    let removedCards=0, removedDrafts=0, changed=false;
    const out=[];
    list.forEach(d=>{
      if(!d||!d.paper||psCtxKey(d.postSel,d.instSel,d.examYear)!==myCtx){ out.push(d); return; }
      let removedHere=0;
      const np={...d.paper};
      PAPER_TABS.forEach(tb=>{
        const cards=d.paper[tb.key]||[];
        const keep=cards.filter(c=>{
          const hit=tb.grouped?heads[tb.key].has(psHeadKey(c.heading)):qs[tb.key].has(psQKey(c.question));
          if(hit) removedHere++;
          return !hit;
        });
        if(keep.length!==cards.length) np[tb.key]=keep.length?keep:[tb.grouped?newGroupCard(tplListFor(tb.key)[0]):newFlatCard(tb.key==="gk")];
      });
      if(!removedHere){ out.push(d); return; }
      changed=true; removedCards+=removedHere;
      if(paperHasContent(np)) out.push({...d,paper:np}); else removedDrafts++;
    });
    if(changed) persistDraftList(out);
    return {cards:removedCards,drafts:removedDrafts};
  };
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
  // ❌ চাপলে প্রশ্নটা মুছে যায়, নিচের সিরিয়াল অটো ঠিক হয়ে যায় (সিরিয়াল render-এ index থেকে আসে)।
  // শেষ কার্ডটা মুছলে একটা ফাঁকা নতুন কার্ড থেকে যায় (ট্যাব কখনো একদম খালি থাকে না)।
  const removeCard=(tab,cardId)=>setCards(tab,cards=>{
    const rest=cards.filter(c=>c.id!==cardId);
    if(rest.length) return rest;
    return [tab==="math"?newFlatCard(false):tab==="gk"?newFlatCard(true):newGroupCard(tplListFor(tab)[0])];
  });
  const addCard=tab=>setCards(tab,cards=>{
    if(tab==="math") return [...cards,newFlatCard(false)];
    if(tab==="gk") return [...cards,newFlatCard(true)];
    // নতুন প্রশ্নে এখনো ব্যবহার হয়নি এমন প্রথম হেডিং-টেমপ্লেট বসে (সবই ব্যবহার হলে প্রথমটা)
    const list=tplListFor(tab), used=cards.map(c=>resolveTpl(c,tab).key);
    return [...cards,newGroupCard(list.find(x=>!used.includes(x.key))||list[0])];
  });
  const updateItem=(tab,cardId,itemId,patch)=>setCards(tab,cards=>cards.map(c=>c.id===cardId?{...c,items:c.items.map(it=>it.id===itemId?{...it,...patch}:it)}:c));
  const addSubItem=(tab,cardId)=>setCards(tab,cards=>cards.map(c=>c.id===cardId?{...c,items:[...c.items,resolveTpl(c,tab).mcq?{...newPaperItem(),qtype:"mcq"}:newPaperItem()]}:c));
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
  const flyToCard=(tabKey,cardId,field,itemId)=>{
    setActiveTab(tabKey);
    setHighlightCardId(cardId);
    setHighlightField(field||"topic");
    // ট্যাব বদলের পর নতুন ট্যাবের DOM রেন্ডার হতে এক টিক সময় দেওয়া হচ্ছে
    requestAnimationFrame(()=>{
      setTimeout(()=>{
        if(field==="item"&&itemId){   // 🎯 নির্দিষ্ট বাক্যের ঘরে নিয়ে যায়, ফোকাস করে, কিছুক্ষণ লাল বর্ডার দেয়
          const el=textareaRefs.current[itemId];
          if(el){ el.scrollIntoView({behavior:"smooth",block:"center"}); try{ el.focus(); }catch{} const old=el.style.outline; el.style.outline="3px solid #ef4444"; setTimeout(()=>{ el.style.outline=old; },3200); return; }
        }
        if(field==="answer"){ const el=flatARefs.current[cardId]; if(el){ el.scrollIntoView({behavior:"smooth",block:"center"}); el.focus(); return; } }
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
      requestAnimationFrame(()=>(textareaRefs.current[lastItem.id]||answerRefs.current[lastItem.id])?.focus());
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
    // 🔒 পদ, প্রতিষ্ঠান ও সাল — তিনটাই বাধ্যতামূলক। QBank মানেই বিগত পরীক্ষার প্রশ্ন; এই তিনটা ছাড়া সেভ হলে
    // প্রশ্নটা কোন পরীক্ষার তা জানা যায় না (Exam Appearance তৈরি হয় না)। তাই ফাঁকা থাকলে সাবমিটই হবে না।
    {
      const miss=[]; if(!postSel.name.trim())miss.push("পদ"); if(!instSel.name.trim())miss.push("প্রতিষ্ঠান"); if(!examYear.trim())miss.push("সাল");
      if(miss.length){
        push("error",`⚠️ ${miss.join(", ")} না দিলে সেভ হবে না`,`QBank-এ পদ, প্রতিষ্ঠান ও সাল তিনটাই দিতে হবে — উপরের "কোন প্রশ্নপত্র থেকে?" ঘরে দাও`);
        setMetaMissing(true); setTimeout(()=>setMetaMissing(false),5000);
        try{ metaCardRef.current?.scrollIntoView({behavior:"smooth",block:"center"}); }catch{}
        return;
      }
    }
    // 🔴 ব্যর্থ হলে পুরো প্রশ্নপত্র নামসহ খসড়া-তালিকায় লাল চিহ্ন (failed:true) দিয়ে রাখা হয় —
    // ডাটাবেজে না গেলে বা Exam Appearance যোগ না হলে যাতে কিছুই হারায় না, আর চোখে পড়ে।
    const recordFail=(reason)=>{
      try{
        if(!failedDraftIdRef.current) failedDraftIdRef.current=newPaperId();
        const list=upsertFailedDraft(LS_DRAFT_PAPER_LIST,{id:failedDraftIdRef.current,paper,activeTab,postSel,instSel,examYear,failReason:reason});
        setDraftList(list);
        setShowDraftList(true);
      }catch{}
    };
    const tStart=Date.now();   // ⏱ কতক্ষণে সেভ হলো — সফল বার্তায় দেখানো হয় (উন্নতি মাপার জন্য)
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
        // ⚡ পদ আর প্রতিষ্ঠান একসাথে (সমান্তরালে) resolve — আগে একটার পর একটা হতো
        const[postRes,instRes]=await Promise.all([
          resolveOrCreateReference({sel:postSel,refType:"posts",options:postOptions,gasSecret,push}),
          resolveOrCreateReference({sel:instSel,refType:"institutions",options:instOptions,gasSecret,push}),
        ]);
        if(!postRes.ok)throw new Error("পদ resolve/তৈরি ব্যর্থ");
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
        const res=await resolveOrCreateReference({sel:{id:"",name},refType:"subjects",options:subjectOptions,gasSecret,sheet:"QBank",tagIds:selectedTagIds,push});
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
        const res=await resolveOrCreateReference({sel:topicSel,refType:"topics",options:topicOptionsFor(subjId),gasSecret,parentId:subjId,tagIds:selectedTagIds,push});
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
            // cloze (শব্দ-বক্স+অনুচ্ছেদ): প্রতিটা ফাঁকার উত্তর (i),(ii)... লেবেলে সেভ হয়
            const validItems=resolveTpl(card,t.key).key==="cloze"
              ? (card.items||[]).map((it,i)=>({...it,question:"("+(RO[i]||i+1)+")"})).filter(it=>it.answer.trim())
              : (card.items||[]).filter(it=>it.question.trim());
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
            const heading=cardHeadingText(card,t.key).trim();
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
              // 🆕 Fill in the blanks (বাক্য-ভিত্তিক): Bold+Underline করা অংশই Answer; প্রশ্নে _শব্দ_ (অ্যাপের fillblank নিয়ম)
              // (Fill-blank ফরম্যাটের যেকোনো কার্ডে — টেমপ্লেট যেটাই হোক — সিলেক্ট করে আন্ডারলাইন/BU দিলেই সেই অংশ blank + উত্তর ধরা হয়)
              if(resolveTpl(card,t.key).lay==="fill"||(card.formatStyle==="fillblank"&&parseFillMarks(it.question).answers.length>0)){
                let fm=parseFillMarks(it.question);
                if(!fm.answers.length){   // 🪄 মার্ক না থাকলে "উত্তর" ঘর/ফাঁকা-দাগ থেকে অটো-মার্ক
                  const fx=autoMarkBlank(it.question,it.answer,w=>`<b><u>${w}</u></b>`);
                  if(fx) fm=parseFillMarks(fx);
                }
                if(!fm.answers.length)throw locatedError(blankMissMsg(t.label,it.question,idx),t.key,card.id,"item",it.id);
                allRows.push(buildSheetRow({
                  item:{q:fm.question.trim(),correct:fm.answers.join(", "),explanation:it.explanation,technique:it.technique},
                  subject:subjName,subtopic:topicName,qtype:"Written",
                  audienceTags:selectedTagNames,tagIds:selectedTagIds,mainQpaper:"",subjectId:subjId,topicId,
                  groupId,subIndex:groupId?(idx+1):null,groupHeading:groupId?heading:"",
                  formatStyle:"fillblank",
                }));
                return;
              }
              // 🆕 Plain প্রশ্ন-উত্তর (পত্র/অনুচ্ছেদ…): প্রশ্ন ও উত্তর দুটোই বাধ্যতামূলক; মার্কআপ-অনুমান (* বা _) বন্ধ; format_style=plainqa
              if(resolveTpl(card,t.key).key==="plainqa"){
                if(!it.answer.trim())throw locatedError(`"${t.label}" ট্যাবে Plain প্রশ্ন-উত্তরের একটা প্রশ্নে উত্তর ফাঁকা — প্রশ্ন ও উত্তর দুটোই লাগবে`,t.key,card.id);
                allRows.push(buildSheetRow({
                  item:{q:it.question.trim(),correct:it.answer.trim(),explanation:it.explanation,technique:it.technique},
                  subject:subjName,subtopic:topicName,qtype:"Written",
                  audienceTags:selectedTagNames,tagIds:selectedTagIds,mainQpaper:"",subjectId:subjId,topicId,
                  groupId,subIndex:groupId?(idx+1):null,groupHeading:groupId?heading:"",
                  formatStyle:"plainqa",
                }));
                return;
              }
              let ansText=it.answer.trim();
              let effFormat=card.formatStyle;
              let qOut=it.question;
              const auto=detectAutoMarkup(it.question);
              if(auto.style==="fillblank"){
                ansText=auto.answer;
                effFormat="fillblank";
              } else if(auto.style==="highlight"){
                effFormat=effFormat==="table"?effFormat:"highlight";
              } else if(card.formatStyle==="fillblank"){
                let m=/_([^_]+)_/.exec(it.question);
                if(!m){   // 🪄 মার্ক না থাকলে "উত্তর" ঘর/ফাঁকা-দাগ থেকে অটো-মার্ক
                  const fx=autoMarkBlank(it.question,it.answer,w=>`_${w}_`);
                  if(fx){ qOut=fx; m=/_([^_]+)_/.exec(fx); }
                }
                if(!m)throw locatedError(blankMissMsg(t.label,it.question,idx),t.key,card.id,"item",it.id);
                ansText=m[1].trim();
              }
              allRows.push(buildSheetRow({
                item:{q:qOut.trim(),correct:ansText,explanation:it.explanation,technique:it.technique},
                subject:subjName,subtopic:topicName,qtype:"Written",
                audienceTags:selectedTagNames,tagIds:selectedTagIds,mainQpaper:"",subjectId:subjId,topicId,
                groupId,subIndex:groupId?(idx+1):null,groupHeading:groupId?heading:"",
                formatStyle:effFormat!=="plain"?effFormat:"",
              }));
            });
          } else {
            if(!card.question.trim())continue;
            let subjId;
            const flatSubjName=((card.subjectSel&&card.subjectSel.name)||"").trim();
            if(t.gkStyle||t.mathStyle){
              if(!flatSubjName)throw locatedError(`"${t.label}" ট্যাবে একটা প্রশ্নে Subject বাছা হয়নি — ${(t.subjectChoices||[]).map(c=>c.short).join(" / ")} থেকে বেছে নাও`,t.key,card.id,"subject");
              subjId=await resolveSubjectCached(flatSubjName);
            } else {
              subjId=await resolveFixedSubject(t.fixedSubject);
            }
            const topicName=card.topicSel.name.trim();
            if(!topicName)throw locatedError(`"${t.label}" ট্যাবে একটা প্রশ্নে Topic ফাঁকা আছে`,t.key,card.id);
            const topicId=await resolveTopicCached(subjId,card.topicSel);
            if(!topicId)throw new Error(`"${topicName}" Topic resolve ব্যর্থ`);
            // গণিত/GK (Written): প্রশ্ন ও উত্তর বাধ্যতামূলক; সমাধান/ব্যাখ্যা/টেকনিক ঐচ্ছিক — ফাঁকা থাকলেও সেভ হবে
            if(card.qtype!=="mcq"&&!card.answer.trim())throw locatedError(`"${t.label}" ট্যাবে একটা প্রশ্নের উত্তর ফাঁকা — উত্তর দেওয়া বাধ্যতামূলক (সমাধান ঐচ্ছিক)`,t.key,card.id,"answer");
            if(card.qtype==="mcq"){
              const opts=[card.opt1,card.opt2,card.opt3,card.opt4].map(o=>o.trim());
              if(opts.some(o=>!o))throw new Error(`"${t.label}" ট্যাবে একটা MCQ প্রশ্নে ৪টা অপশনের কোনোটা ফাঁকা — 🤖 Generate চাপো অথবা নিজে পূরণ করো`);
              const ansTrim=card.answer.trim();
              if(!ansTrim)throw new Error(`"${t.label}" ট্যাবে একটা MCQ প্রশ্নে সঠিক উত্তর ফাঁকা`);
              if(!opts.some(o=>norm(o)===norm(ansTrim)))throw new Error(`"${t.label}" ট্যাবে একটা MCQ প্রশ্নে সঠিক উত্তর ৪টা অপশনের কোনোটার সাথেই মিলছে না`);
              allRows.push(buildSheetRow({
                item:{q:card.question.trim(),correct:ansTrim,opt1:opts[0],opt2:opts[1],opt3:opts[2],opt4:opts[3],explanation:card.explanation,technique:card.technique},
                subject:(t.gkStyle||t.mathStyle)?flatSubjName:t.fixedSubject,subtopic:topicName,qtype:"MCQ",
                audienceTags:selectedTagNames,tagIds:selectedTagIds,mainQpaper:"",subjectId:subjId,topicId,
                groupId:"",subIndex:null,groupHeading:"",formatStyle:"",
              }));
              continue;
            }
            allRows.push(buildSheetRow({
              item:{q:card.question.trim(),correct:card.answer.trim(),explanation:card.explanation,technique:card.technique},
              subject:(t.gkStyle||t.mathStyle)?flatSubjName:t.fixedSubject,subtopic:topicName,qtype:"Written",
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
      // ══ 🚀 ব্যাকগ্রাউন্ড আপলোড ══
      // ডেটা তৈরি শেষ (পদ/প্রতিষ্ঠান/Subject/Topic resolve + সব সারি বানানো)। এখন সার্ভারে পাঠানোর ভারী কাজ ব্যাকগ্রাউন্ডে যায়:
      //  ১) প্রশ্নপত্রের কপি খসড়া-তালিকায় "⏳ আপলোড চলছে" দিয়ে নিরাপদে রাখা (অ্যাপ বন্ধ হলেও হারাবে না)
      //  ২) ফর্ম সাথে সাথে খালি — পরের প্রশ্নপত্র টাইপ শুরু করা যায়
      //  ৩) নিচের চলমান-বারে সত্যিকারের অগ্রগতি; ব্যর্থ হলে আগের কপিটাই 🔴 লাল খসড়া হয়ে যায়
      const jobSnap={paper,activeTab,postSel,instSel,examYear};
      const jobId=createJob({label:draftHeadline({postSel,instSel,examYear}),total:allRows.length});
      const jobDraftId=jobId;   // খসড়ার id = জবের id, তাই পেজ ছেড়ে ফিরে এলেও "চলমান" আর "মাঝপথে থেমে যাওয়া" আলাদা চেনা যায়
      setDraftList(upsertPendingDraft(LS_DRAFT_PAPER_LIST,{id:jobDraftId,...jobSnap}));
      setPaper(makeInitialPaper());
      setActiveTab("bangla");
      clearDraft(LS_DRAFT_PAPER);
      failedDraftIdRef.current=null;
      push("info","🚀 আপলোড শুরু হয়েছে",`${allRows.length}টা প্রশ্ন ব্যাকগ্রাউন্ডে যাচ্ছে — নিচের বারে অগ্রগতি দেখো। ততক্ষণে পরের প্রশ্নপত্র টাইপ করতে পারো`);
      setSaving(false);
      setSaveProgress(null);

      const failJob=(reason)=>{
        try{ setDraftList(upsertFailedDraft(LS_DRAFT_PAPER_LIST,{id:jobDraftId,...jobSnap,failReason:reason})); setShowDraftList(true); }catch{}
        finishJob(jobId,{ok:false,message:"লাল খসড়ায় আছে — লোড করে আবার পাঠাও"});
      };
      (async()=>{
        const tSave0=Date.now();
        try{
          const res=await saveRowsToSheet({
            rows:allRows,targetTab:"QBank",gasSecret,push,examAppearance,source:"Single_Text_Paper",
            chunkSize:100,   // ⚡ সাধারণ প্রশ্নপত্র ১টা অনুরোধেই যায় (সার্ভার প্রতি অনুরোধে পুরো শিট পড়ে, তাই অনুরোধ কমানোই সবচেয়ে বড় লাভ)
            onEvent:ev=>jobEvent(jobId,ev),
          });
          const secsSave=((Date.now()-tSave0)/1000).toFixed(1);
          const failedCount=(res.failedRows||[]).length;
          if(res.added>0){
            push("success",`✅ ${failedCount>0?`আংশিক সাবমিট হয়েছে (${res.added}টা)`:"পুরো প্রশ্নপত্র সাবমিট হয়েছে!"} (${res.added}টা প্রশ্ন)`,`সার্ভারে ⏱ ${secsSave} সেকেন্ড লেগেছে`);
            setSessionCount(c=>c+res.added);
            fetchReferenceData({gasSecret}).then(setRefData).catch(()=>{});
          }
          if(res.examAppearancesLinkedToExisting>0) push("success","🔗 কিছু প্রশ্ন আগে থেকেই QBank-এ ছিল","নতুন করে যোগ হয়নি — শুধু এই পদ/প্রতিষ্ঠান/সালের Appearance জুড়ে দেওয়া হয়েছে");
          // 🔴 Exam Appearance যাচাই: GAS নিজেই গোনে কয়টা সারির Appearance না যোগ হয়েছে, না আগে থেকে (একই পদ+প্রতিষ্ঠান+সাল) ছিল — সেটাই আসল ব্যর্থতা
          const processedQ=(res.added||0)+(res.skipped||0);
          const missingEA=res.appearanceReported?(res.examAppearancesMissing||0):0;
          const appearanceMissing=!!examAppearance && failedCount===0 && processedQ>0 && missingEA>0;
          if(failedCount>0){
            push("error",`⚠️ ${failedCount}টা প্রশ্ন সেভ হয়নি (নেটওয়ার্ক সমস্যা)`,"লাল খসড়ায় রাখা হয়েছে — 📂 খসড়া তালিকা থেকে \"লোড করে আবার পাঠাও\" চাপো, আগেরগুলো ডুপ্লিকেট হবে না");
            failJob(`${failedCount}টা প্রশ্ন সার্ভারে যায়নি`);
          } else if(appearanceMissing){
            push("error","🔴 প্রশ্ন সেভ হয়েছে কিন্তু Exam Appearance যোগ হয়নি","লাল খসড়ায় রাখা হয়েছে — আবার পাঠালে শুধু Appearance জুড়বে, প্রশ্ন ডুপ্লিকেট হবে না");
            failJob(`প্রশ্ন সেভ হয়েছে কিন্তু ${missingEA}টার Exam Appearance যোগ হয়নি`);
          } else if(res.added>0 || res.skipped>0){
            if(res.added===0){
              if(examAppearance&&(res.examAppearancesAdded||0)>0) push("success","🔗 সব প্রশ্ন আগে থেকেই QBank-এ ছিল","শুধু এই পদ/প্রতিষ্ঠান/সালের Appearance যোগ হয়েছে");
              else push("warn","⚠️ সবগুলোই ইতিমধ্যে Sheet-এ আছে (duplicate)","");
            }
            // সফল → আপলোডের সময় রাখা কপিটা আগে সরাই (নইলে নিচের prune সেটাকেও গুনে ভুল সংখ্যা দেখাত), তারপর নামসহ খসড়ায় একই কার্ড থাকলে সেগুলোও সরাই
            setDraftList(removeDraftById(LS_DRAFT_PAPER_LIST,jobDraftId));
            const pr=pruneNamedDrafts(jobSnap.paper,{postSel,instSel,examYear});
            if(pr.cards>0) push("info",`🧹 খসড়া থেকে ${toBn(pr.cards)}টা সাবমিট-হওয়া কার্ড সরানো হয়েছে`,pr.drafts>0?`${toBn(pr.drafts)}টা খসড়া সম্পূর্ণ ফাঁকা হয়ে বাদ গেছে`:"একই পদ/প্রতিষ্ঠান/সালের খসড়া থেকে");
            finishJob(jobId,{ok:true,message:`${res.added}টা নতুন${res.skipped>0?` · ${res.skipped}টা আগে থেকেই ছিল`:""}`});
          } else {
            push("error","সেভ ব্যর্থ","নেটওয়ার্ক সমস্যা হতে পারে — প্রশ্নপত্র লাল খসড়ায় রাখা হয়েছে, একটু পর আবার পাঠাও");
            failJob("সার্ভারে সেভ হয়নি (নেটওয়ার্ক/সার্ভার সমস্যা)");
          }
        }catch(e){
          push("error","আপলোড ব্যর্থ",(e.message||"")+" — প্রশ্নপত্র লাল খসড়ায় রাখা হয়েছে");
          failJob("আপলোড ব্যর্থ: "+(e.message||""));
        }
      })();
      return;
    }catch(e){
      push("error","সাবমিট ব্যর্থ",e.message+" — খাতা খালি হয়নি, লাল চিহ্নসহ খসড়ায় রাখা হয়েছে");
      recordFail("সাবমিট ব্যর্থ: "+(e.message||""));
      if(e.tabKey&&e.cardId) flyToCard(e.tabKey,e.cardId,e.field,e.itemId);
    }
    setSaving(false);
    setSaveProgress(null);
  },[saving,gasSecret,paper,subjectOptions,refData,sessionCount,push,setRefData,setSessionCount,postSel,instSel,examYear,postOptions,instOptions,activeTab]);

  useEffect(()=>{
    const onKey=e=>{ if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==="s"){ e.preventDefault(); submitPaper(); } };
    window.addEventListener("keydown",onKey);
    return()=>window.removeEventListener("keydown",onKey);
  },[submitPaper]);

  /* ══════════ 🆕 ছাপা-প্রশ্নপত্র স্টাইলের কার্ড ══════════
     প্রতিটা প্রশ্নের হেডিং-লাইনের শেষে "Expand ▾" (এই ট্যাবের সব হেডিং সিরিয়ালে দেখায়, বাছলেই
     ওই নম্বরের হেডিং + ফরম্যাট বদলায়, আগের লেখা হারায় না) আর ❌ (প্রশ্ন মোছা, সিরিয়াল অটো ঠিক)।
     সিরিয়াল: বাংলা/গণিত/GK → ০১। + ক) | English → 1. + a) */
  const isEnTab=activeTab==="english";
  const psLab=i=>isEnTab?String.fromCharCode(97+(i%26))+")":(SUBLABELS[i]||String(i+1))+")";
  const psNo=n=>isEnTab?n+".":(n<10?"০":"")+toBn(n)+"।";
  // 🔢 সিরিয়াল সব ট্যাব জুড়ে চলে: বাংলা ১,২,৩ → ইংরেজি ৪,৫,৬ → গণিত ৭,৮,৯ → GK ১০,১১,১২।
  // ফিক্স না — আগের ট্যাবগুলোতে এখন কয়টা কার্ড আছে সেটা গুনে অটো ঠিক হয় (কার্ড যোগ/মুছলে পরের ট্যাবের নম্বরও সরে)।
  const tabOffset=PAPER_TABS.slice(0,Math.max(0,PAPER_TABS.findIndex(t=>t.key===activeTab))).reduce((n,t)=>n+((paper[t.key]||[]).length),0);
  const[userTpls,setUserTpls]=useState(()=>loadUserTpls());   // ✍️ নিজের বানানো ফরম্যাট (সেভ থাকে)
  const[delTplKey,setDelTplKey]=useState(null);               // 🗑️ মোছার ২য় ট্যাপের অপেক্ষা
  const[pickerOpen,setPickerOpen]=useState(()=>new Set());
  const[moreOpen,setMoreOpen]=useState(()=>new Set());     // GK: "More subject ›" খোলা কার্ডগুলো
  const toggleMore=id=>setMoreOpen(s=>{const n=new Set(s);if(n.has(id))n.delete(id);else n.add(id);return n;});
  const togglePicker=id=>setPickerOpen(s=>{const n=new Set(s);if(n.has(id))n.delete(id);else n.add(id);return n;});

  // হেডিং থেকে Topic অটো-সিলেক্ট — শুধু বাংলা ও ইংরেজি ট্যাবে (গণিত/GK-তে নেই)।
  // ১) paperTemplates.js-এর হেডিং→Topic নিয়ম (যেমন "লিঙ্গ পরিবর্তন করুন" → লিঙ্গ পরিবর্তন) — ডাটাবেজে যে Topic আসলে আছে সেটাই;
  //    নিয়ম মিললেও Topic ডাটাবেজে না থাকলে ফাঁকা (ভুল Topic বসে না, নতুনও তৈরি হয় না)।
  // ২) কোনো নিয়মই না মিললে আগের মতো হেডিং-টেক্সট ম্যাচ (bestTopicMatchForHeading)।
  // ইউজার চাইলে পরে হাতে বদলাতে পারে।
  const topicPatchForHeading=(card,heading,tab)=>{
    tab=tab||activeTab;
    if(tab!=="bangla"&&tab!=="english")return null;
    if(card.topicSel.name.trim())return null;
    const td=PAPER_TABS.find(x=>x.key===tab)||tabDef;
    const options=td.subjectChoices
      ? mergedTopicOptionsFor(refData,td.subjectChoices.map(c=>subjectOptions.find(s=>s.name===c.name)?.id).filter(Boolean))
      : topicOptionsFor(subjectOptions.find(s=>s.name===td.fixedSubject)?.id);
    if(!options||!options.length)return null;
    let match=null;
    const rule=topicRuleFromHeading(heading,tab);
    if(rule){
      match=pickTopicOption(options,rule.topics,rule.nameRe);   // বানান-ভুল সহনশীল
    } else {
      match=bestTopicMatchForHeading(heading,options);
    }
    if(!match)return null;
    const patch={topicSel:{id:match.id,name:match.name},topicAuto:true};
    if(td.subjectChoices){
      const ex=(refData?.topics||[]).find(tp=>tp.topic_id===match.id);
      if(ex){
        const idx=td.subjectChoices.findIndex(c=>subjectOptions.find(s=>s.name===c.name)?.id===ex.subject_id);
        if(idx>=0) patch.subjectChoice=td.subjectChoices[idx].key;
      }
    }
    return patch;
  };
  // নতুন কার্ড / OCR-ইম্পোর্ট / সেভ-করা ড্রাফট — রেফারেন্স ডাটা (Topic লিস্ট) লোড হলে, Topic ফাঁকা কার্ডে একবার অটো-সিলেক্ট।
  // topicAutoTried ফ্ল্যাগ থাকায় ইউজার Topic মুছে দিলে বা বদলালে আর জোর করে বসায় না।
  useEffect(()=>{
    if(!(refData?.topics||[]).length)return;
    ["bangla","english"].forEach(tab=>{
      (paper[tab]||[]).forEach(card=>{
        if(card.topicAutoTried)return;
        const heading=String(card.heading||"").trim();
        if(!heading)return;
        const tp=topicPatchForHeading(card,heading,tab);
        updateCard(tab,card.id,{...(tp||{}),topicAutoTried:true});
      });
    });
  },[refData,paper]);
  // Expand-এ টেমপ্লেট বাছা: হেডিং+ফরম্যাট+লেআউট বদলায়; সাব-পার্টের লেখা (question/answer) থেকে যায়
  const setTemplate=(tab,card,tpl)=>{
    const prev=resolveTpl(card,tab);
    const patch={tplKey:tpl.key};
    if(tpl.key!=="custom"&&!tpl.editableHeading){ patch.heading=tpl.heading; patch.formatStyle=tpl.fmt; }
    if(tpl.editableHeading){
      patch.formatStyle=tpl.fmt;
      // আগের টেমপ্লেট রেডিমেড হেডিং-এর হলে (যেমন "বাগধারা:") সেটা আর থাকবে না, ইউজারের নিজের লেখা হেডিং (Custom/Plain থেকে এলে) থাকবে;
      // অটো-বসানো Topic-ও পরিষ্কার হয় — নতুন হেডিং লিখে বের হলে (blur) আবার অটো-সিলেক্ট হবে
      if(!prev.custom&&!prev.editableHeading){
        patch.heading="";
        if(card.topicAuto) patch.topicSel={id:"",name:""};
      }
    }
    patch.items=card.items.map(it=>tpl.mcq?{...it,qtype:"mcq"}:(prev.mcq&&it.qtype==="mcq"?{...it,qtype:"written"}:it));
    if(tpl.key==="cloze"&&!(card.wordBox&&card.wordBox.length)) patch.wordBox=Array(6).fill("");
    // সব সারি ফাঁকা থাকলে টেমপ্লেটের নিজস্ব সারি-সংখ্যা (যেমন পত্র/অনুচ্ছেদে ১টা) রাখো
    if(tpl.rows&&patch.items.every(it=>!it.question.trim()&&!it.answer.trim())) patch.items=patch.items.slice(0,tpl.rows);
    if(tpl.key!=="custom"&&!tpl.editableHeading){
      const base=card.topicAuto?{...card,topicSel:{id:"",name:""}}:card; // আগেরটা অটো-বসানো হলে নতুন হেডিং অনুযায়ী বদলাবে
      const tp=topicPatchForHeading(base,tpl.heading);
      if(tp) Object.assign(patch,tp);
      patch.topicAutoTried=true;
    }
    if(tpl.userDefined){   // ✍️ নিজের সেভ করা ফরম্যাট → সেভ-করা Topic + Subject-ও বসে
      const ts=tpl.topicSel;
      if(ts&&String(ts.name||"").trim()){ patch.topicSel={id:ts.id||"",name:ts.name}; patch.topicAuto=false; }
      if(tpl.subjectChoice) patch.subjectChoice=tpl.subjectChoice;
      patch.topicAutoTried=true;
    }
    updateCard(tab,card.id,patch);
  };

  // ── ✍️ নিজে লিখুন (Custom) → ধরন বদল / ফরম্যাট সেভ / মোছা ──
  const setCustomType=(card,ct)=>{
    const bt=BUILDER_TYPES[ct]||BUILDER_TYPES.qa, prev=resolveTpl(card,activeTab);
    updateCard(activeTab,card.id,{cType:ct,formatStyle:bt.fmt,
      items:card.items.map(it=>bt.mcq?{...it,qtype:"mcq"}:(prev.mcq&&it.qtype==="mcq"?{...it,qtype:"written"}:it))});
  };
  const saveCustomAsTemplate=(card)=>{
    const heading=String(card.heading||"").trim();
    if(!heading){ push("warn","ফরম্যাটের নাম লিখুন","উপরের হেডিং ঘরে যা লিখবেন (যেমন \"বাক্য পরিবর্তন করো\") সেটাই ফরম্যাটের নাম হবে"); return; }
    const cur=loadUserTpls(), list=[...(cur[activeTab]||[])];
    const ix=list.findIndex(x=>normTplHead(x.heading)===normTplHead(heading));
    const tpl=buildUserTpl(card,activeTab,card.topicSel,ix>=0?list[ix].key:undefined);
    if(ix>=0) list[ix]=tpl; else list.push(tpl);
    const next={...cur,[activeTab]:list}; saveUserTpls(next); setUserTpls(next);
    push("success",ix>=0?"✅ ফরম্যাট আপডেট হয়েছে":"✅ নতুন ফরম্যাট সেভ হয়েছে",`"${tpl.title}" এখন Expand ▾ তালিকায় আছে${tpl.topicSel?` · Topic: ${tpl.topicSel.name}`:""}`);
  };
  const deleteUserTpl=(key)=>{
    const cur=loadUserTpls(), next={...cur,[activeTab]:(cur[activeTab]||[]).filter(x=>x.key!==key)};
    saveUserTpls(next); setUserTpls(next); setDelTplKey(null);
    push("success","🗑️ ফরম্যাট মোছা হয়েছে","যে কার্ডে এটা বসানো ছিল সেখানকার লেখা আগের মতোই আছে");
  };

  // Subject-পিল → ডাটাবেজের আসল Subject: aliases হুবহু মিললে সেটা; না মিললে kw (শুধু যদি ঠিক একটাই Subject মেলে); কিছুই না মিললে পিলের নামেই
  const resolveSubjectChoice=c=>{
    const al=[c.name,...(c.aliases||[])].map(nzTopic);
    let hit=subjectOptions.find(s=>al.includes(nzTopic(s.name)));
    if(!hit&&c.kw){
      const ks=c.kw.map(nzTopic), m=subjectOptions.filter(s=>ks.some(k=>nzTopic(s.name).includes(k)));
      if(m.length===1) hit=m[0];
    }
    return hit?{id:hit.id,name:hit.name}:{id:"",name:c.name};
  };
  // GK কার্ডে (OCR-ইম্পোর্ট/পুরোনো ড্রাফট) Subject-এর নাম ৪টা পিলের কোনোটার (বানান-ভেদসহ) সমান হলে ডাটাবেজের আসল নামে বসিয়ে দেওয়া,
  // যাতে পিলটা সিলেক্টেড দেখায়। বাকি যেকোনো Subject ("More subject ›"-এর অধীনে) যেমন আছে তেমনই থাকে।
  useEffect(()=>{
    if(!(refData?.subjects||[]).length)return;
    const td=PAPER_TABS.find(x=>x.key==="gk"); if(!td||!td.subjectChoices)return;
    (paper.gk||[]).forEach(card=>{
      if(card.subjNormTried)return;
      const cur=((card.subjectSel&&card.subjectSel.name)||"").trim();
      if(!cur)return;
      const c=td.subjectChoices.find(c=>[c.name,...(c.aliases||[])].some(a=>nzTopic(a)===nzTopic(cur)));
      updateCard("gk",card.id,{...(c?{subjectSel:resolveSubjectChoice(c)}:{}),subjNormTried:true});
    });
  },[refData,paper]);

  /* 🆕 Math / GK (Written) — Topic Tag-এর রুল দিয়ে প্রশ্ন+উত্তর দেখে Topic (আর Subject) নিজে বেছে নেয়। ভুল হলে হাতে বদলালে আর কখনো ওভাররাইট করে না।
     রুল: tt_getRules (৫ মিনিট ক্যাশ), ইঞ্জিন: AutoClassify.gs-এর JS-পোর্ট (core/autoTopic.js)। মিল না থাকলে/দুই টপিক সমান-সমান হলে কিছু বসায় না। */
  const[acRules,setAcRules]=useState([]);
  useEffect(()=>{
    if(!gasSecret||!(refData?.topics||[]).length)return;
    let dead=false; loadRules(gasSecret,refData).then(r=>{ if(!dead)setAcRules(r); });
    return ()=>{ dead=true; };
  },[gasSecret,refData]);
  useEffect(()=>{
    if(!acRules.length||!(refData?.subjects||[]).length)return;
    const tm=setTimeout(()=>{
      const strip=t=>String(t||"").replace(/<br\s*\/?>/gi," ").replace(/<[^>]*>/g,"").replace(/&nbsp;/g," ");
      const otherNames=new Set(PAPER_TABS.filter(t=>t.key!=="gk").flatMap(t=>(t.subjectChoices||[]).map(c=>nzTopic(c.name))));
      const idsOf=names=>subjectOptions.filter(o=>names.some(n=>nzTopic(n)===nzTopic(o.name))).map(o=>o.id);
      const mathIds=idsOf((PAPER_TABS.find(t=>t.key==="math")?.subjectChoices||[]).map(c=>c.name));
      const gkIds=subjectOptions.filter(o=>!otherNames.has(nzTopic(o.name))).map(o=>o.id);
      ["math","gk"].forEach(tab=>{
        (paper[tab]||[]).forEach(card=>{
          if(card.topicManual) return;
          if(((card.topicSel&&card.topicSel.name)||"").trim()&&!card.topicAuto) return;       // হাতে/ড্রাফট/OCR থেকে আসা Topic — ছোঁয়া হয় না
          const q=strip(card.question).trim(), a=strip(card.answer).trim(); if(!q) return;
          const sig=q+"\u0001"+a; if(card.topicAutoSig===sig) return;                 // লেখা বদলায়নি → আবার চেষ্টা নয়
          const pickedSubj=(!card.subjAuto&&card.subjectSel&&card.subjectSel.id)?[card.subjectSel.id]:null;   // ইউজার Subject বেছে থাকলে সেটার ভেতরেই
          const hit=autoTopicFor(acRules,{question:q,answer:a},pickedSubj||(tab==="math"?mathIds:gkIds));
          if(hit) updateCard(tab,card.id,{topicSel:{id:hit.topic_id,name:hit.topic_name},subjectSel:{id:hit.subject_id,name:hit.subject_name},topicAuto:true,subjAuto:!pickedSubj,topicAutoSig:sig});
          else if(card.topicAuto) updateCard(tab,card.id,{topicSel:{id:"",name:""},...(card.subjAuto?{subjectSel:{id:"",name:""}}:{}),topicAuto:false,subjAuto:false,topicAutoSig:sig});   // লেখা বদলে রুল আর মেলে না → আগের অটো-বাছাই সরাও
          else updateCard(tab,card.id,{topicAutoSig:sig});
        });
      });
    },900);
    return ()=>clearTimeout(tm);
  },[paper,acRules,refData]);

  /* ── Tab / Shift+Tab নেভিগেশন (সব লেআউটে একই নিয়ম) ──
     যেকোনো লেখার ঘরে Tab চাপলে স্ক্রিনের ক্রমে পরের ঘরে যায়: প্রশ্ন → (বাক্য/অপশন) → উত্তর → পরের প্রশ্ন;
     টেবিলে বাঁ-ঘর → ডান-ঘর → পরের সারি; গণিতে প্রশ্ন → সমাধান → উত্তর → পরের প্রশ্ন। Shift+Tab উল্টো দিকে।
     ছোট বাটনগুলো (ℹ️ 🖍 ❌) ও Topic বক্স Tab-ক্রমে আসে না। একদম শেষ ঘরে Tab চাপলে নতুন সারি/প্রশ্ন যোগ হয়ে
     সেখানেই কার্সর যায়। */
  const psTabNav=e=>{
    if(e.key!=="Tab"||e.ctrlKey||e.altKey||e.metaKey||e.defaultPrevented)return;
    const el=e.target;
    if(!el||!el.classList||!el.classList.contains("ps-in"))return;
    const fields=[...e.currentTarget.querySelectorAll(".ps-sheet .ps-in")].filter(f=>!f.disabled&&f.offsetParent!==null&&!f.closest(".ps-tp"));
    const i=fields.indexOf(el);
    if(i<0)return;
    if(e.shiftKey){ if(i>0){ e.preventDefault(); fields[i-1].focus(); } return; }
    e.preventDefault();
    if(i<fields.length-1){ fields[i+1].focus(); return; }
    const cards=paper[activeTab]||[], last=cards[cards.length-1];
    if(!last)return;
    if(tabDef.grouped){ pendingFocusRef.current={tab:activeTab,cardId:last.id,flat:false}; addSubItem(activeTab,last.id); }
    else { pendingFocusRef.current={tab:activeTab,cardId:last.id,flat:true}; addCard(activeTab); }
  };

  const psCtl=(card,it,opts)=>(
    <span className="ps-ac">
      {opts.mcqToggle&&(
        <button type="button" tabIndex={-1} className="ps-mini" title="Written ⇄ MCQ"
          onClick={()=>updateItem(activeTab,card.id,it.id,{qtype:it.qtype==="mcq"?"written":"mcq"})}>{it.qtype==="mcq"?"❓":"✍️"}</button>
      )}
      {opts.hl&&it.qtype!=="mcq"&&(
        <button type="button" tabIndex={-1} className="ps-mini" title="সিলেক্ট করা অংশ মার্ক করো"
          onClick={()=>wrapHighlight(activeTab,card.id,it.id,card.formatStyle)}>🖍</button>
      )}
      <button type="button" tabIndex={-1} className="ps-mini" title="ব্যাখ্যা / টেকনিক" onClick={()=>toggleExpand(it.id)}>{expandedItems.has(it.id)?"▲":"ℹ️"}</button>
      {card.items.length>1&&(
        <button type="button" tabIndex={-1} className="ps-x" title="এই সারি বাদ দাও" onClick={()=>removeSubItem(activeTab,card.id,it.id)}>❌</button>
      )}
    </span>
  );
  const psExtras=(card,it,tpl)=>expandedItems.has(it.id)&&(
    <>
      {!(tpl.third&&tpl.third.field==="explanation")&&(
        <div className="ps-l2"><span>{isEnTab?"Explanation:":"ব্যাখ্যা:"}</span>
          <PsTA value={it.explanation} onChange={e=>updateItem(activeTab,card.id,it.id,{explanation:e.target.value})}/></div>
      )}
      <div className="ps-l2"><span>{isEnTab?"Technique:":"টেকনিক:"}</span>
        <PsTA value={it.technique} onChange={e=>updateItem(activeTab,card.id,it.id,{technique:e.target.value})}/></div>
    </>
  );

  const renderGroupCard=(card,ci)=>{
    const tpl=resolveTpl(card,activeTab);
    const custom=tpl.key==="custom";
    const editHead=custom||!!tpl.editableHeading;       // হেডিং নিজে লেখার টেমপ্লেট (Custom / Plain প্রশ্ন-উত্তর)
    const open=pickerOpen.has(card.id);
    const builtinList=tplListFor(activeTab), userList=userTpls[activeTab]||[];
    const curCType=customTypeOf(card);
    // Custom কার্ডে ধরন (cType) বাছা থাকলে সেটাই; না থাকলে (পুরনো কার্ড) আগের মতো formatStyle থেকে
    const lay=custom?(tpl.cType?tpl.lay:(card.formatStyle==="table"?"tbl":"stack")):tpl.lay;   // (plainqa → "qa")
    const pre=custom?(tpl.cType?tpl.pre:(isEnTab?"Answer:":"উত্তর:")):(tpl.pre||"");
    const cols=custom?(tpl.cType?tpl.cols:(isEnTab?["Word","Meaning"]:["শব্দ","ব্যাখ্যা"])):tpl.cols;
    const hl=(card.formatStyle==="highlight"||card.formatStyle==="fillblank")&&lay!=="fill";
    const title=card.heading||tpl.heading||(isEnTab?"(heading)":"(হেডিং লিখো)");

    const mkQ=(it,idx,isFill,cls)=>(
      <PsTA cover className={cls} taRef={el=>{textareaRefs.current[it.id]=el;}} value={it.question}
        onChange={e=>updateItem(activeTab,card.id,it.id,{question:e.target.value})}/>
    );
    const mkA=(it,idx,cls)=>(
      <PsTA cover className={cls} taRef={el=>{answerRefs.current[it.id]=el;}} value={it.answer}
        onChange={e=>updateItem(activeTab,card.id,it.id,{answer:e.target.value})}/>
    );

    let body=null;
    if(lay==="cloze"){
      const wb=card.wordBox||[];
      body=(
        <div style={{marginLeft:6}}>
          <div className="ps-wb" style={{marginLeft:0,width:"100%"}}>
            {wb.map((w,wi)=>(
              <div className="ps-wc" key={wi}>
                <input className="ps-in" value={w} onChange={e=>updateCard(activeTab,card.id,{wordBox:wb.map((x,k)=>k===wi?e.target.value:x)})}/>
                <button type="button" tabIndex={-1} className="ps-x" onClick={()=>updateCard(activeTab,card.id,{wordBox:wb.filter((_,k)=>k!==wi)})}>❌</button>
              </div>
            ))}
          </div>
          <button type="button" className="ps-add" style={{marginLeft:0}} onClick={()=>updateCard(activeTab,card.id,{wordBox:[...wb,""]})}>＋ শব্দ</button>
          <PsTA className="ps-box" value={card.passage||""} onChange={e=>updateCard(activeTab,card.id,{passage:e.target.value})}/>
          <div className="ps-h2" style={{marginLeft:0}}>Answer:</div>
          <div className="ps-an" style={{marginLeft:0}}>
            {card.items.map((it,idx)=>(
              <div className="ps-ch" key={it.id}>
                <b>({RO[idx]||idx+1})</b>
                <PsTA cover taRef={el=>{answerRefs.current[it.id]=el;}} value={it.answer}
                  onChange={e=>updateItem(activeTab,card.id,it.id,{answer:e.target.value,question:e.target.value.trim()?"("+(RO[idx]||idx+1)+")":""})}/>
                {card.items.length>1&&<button type="button" tabIndex={-1} className="ps-x" onClick={()=>removeSubItem(activeTab,card.id,it.id)}>❌</button>}
              </div>
            ))}
          </div>
        </div>
      );
    } else if(lay==="tbl"){
      body=(
        <table className="ps-tbl">
          <thead><tr>{cols.map(c=><th key={c}>{c}</th>)}<th className="ps-thx"/></tr></thead>
          <tbody>
            {card.items.map((it,idx)=>(
              <tr key={it.id}>
                <td>{mkQ(it,idx,false)}</td>
                <td>{mkA(it,idx)}</td>
                <td className="xc">{psCtl(card,it,{hl:false,mcqToggle:false})}</td>
              </tr>
            ))}
          </tbody>
        </table>
      );
    } else {
      body=card.items.map((it,idx)=>{
        const isFill=card.formatStyle==="fillblank"||detectAutoMarkup(it.question).style==="fillblank";
        const mcq=it.qtype==="mcq";
        const ctl=psCtl(card,it,{hl,mcqToggle:custom});
        if(mcq) return (
          <div className="ps-row st" key={it.id}>
            <span className="ps-lab">{psLab(idx)}</span>{mkQ(it,idx,true)}{ctl}
            <div className="ps-l2"><span>Options:</span>
              <div className="ps-opts">
                {["opt1","opt2","opt3","opt4"].map((k,oi)=>(
                  <label key={k}><span>{String.fromCharCode(97+oi)})</span>
                    <input className={"ps-in"+(it[k].trim()&&norm(it[k])===norm(it.answer)?" ok":"")} value={it[k]}
                      onChange={e=>updateItem(activeTab,card.id,it.id,{[k]:e.target.value})}/></label>
                ))}
              </div>
            </div>
            <div className="ps-l2"><span>Answer:</span>{mkA(it,idx)}
              <button type="button" tabIndex={-1} className="ps-mini" title="AI দিয়ে ৩টা ভুল অপশন বানাও" disabled={mcqGeneratingId===it.id}
                onClick={()=>generateMcqOptions(activeTab,card.id,it.id,it.question,it.answer,false)}>{mcqGeneratingId===it.id?"⏳":"🤖"}</button>
            </div>
            {psExtras(card,it,tpl)}
          </div>
        );
        if(lay==="qa") return (
          <div className="ps-qa" key={it.id}>
            <div className="ps-qar"><span className="ps-qal">{isEnTab?"Question:":"প্রশ্ন:"}</span>{mkQ(it,idx,false)}{psCtl(card,it,{hl:false,mcqToggle:false})}</div>
            <div className="ps-qar"><span className="ps-qal">{isEnTab?"Ans:":"উত্তর:"}</span>{mkA(it,idx,"ps-box")}</div>
            {psExtras(card,it,tpl)}
          </div>
        );
        if(lay==="fill"){
          const fm=parseFillMarks(it.question);
          return (
            <div className="ps-row st" key={it.id}>
              <span className="ps-lab">{psLab(idx)}</span>{mkQ(it,idx,true)}{psCtl(card,it,{hl:false,mcqToggle:false})}
              <div className="ps-l2"><span>Ans:</span>
                {fm.answers.length
                  ? <span className="ps-auto">{fm.answers.join(", ")}</span>
                  : <span className="ps-hint" style={{margin:0}}>blank হবে যে শব্দ সেটা সিলেক্ট করে BU (Bold+Underline) দাও — সেটাই Answer</span>}
              </div>
              {psExtras(card,it,tpl)}
            </div>
          );
        }
        if(lay==="pair") return (
          <div className="ps-row" key={it.id}>
            <span className="ps-lab">{psLab(idx)}</span>{mkQ(it,idx,isFill)}<span className="ps-sep">{tpl.sep}</span>{mkA(it,idx)}{ctl}
            {tpl.third&&(
              <div className="ps-l2"><span>{tpl.third.pre}</span>
                <PsTA value={it[tpl.third.field]} onChange={e=>updateItem(activeTab,card.id,it.id,{[tpl.third.field]:e.target.value})}/>
                {tpl.third.suf&&<span>{tpl.third.suf}</span>}</div>
            )}
            {psExtras(card,it,tpl)}
          </div>
        );
        return (
          <div className="ps-row st" key={it.id}>
            <span className="ps-lab">{psLab(idx)}</span>{mkQ(it,idx,isFill)}{ctl}
            {card.formatStyle==="fillblank"
              ? <div className="ps-l2 ps-hint" style={{margin:0}}>_ফাঁকা শব্দ_ দিয়ে মার্ক করো — মার্ক করা শব্দই উত্তর</div>
              : <div className="ps-l2"><span>{pre}</span>{mkA(it,idx)}</div>}
            {psExtras(card,it,tpl)}
          </div>
        );
      });
    }

    return (
      <div key={card.id} className={"ps-sheet"+(isEnTab?" ps-en":"")}>
        <div className="ps-hd">
          <div className="ps-h">{psNo(tabOffset+ci+1)} {title}</div>
          <button type="button" className={"ps-ex"+(open?" on":"")} onClick={()=>togglePicker(card.id)}>{open?"Close ▴":"Expand ▾"}</button>
          <button type="button" tabIndex={-1} className="ps-x" title="এই প্রশ্নটা বাদ দাও" onClick={()=>removeCard(activeTab,card.id)}>❌</button>
        </div>
        {open&&(
          <div className="ps-pk">
            {builtinList.map((t,i)=>(
              <button type="button" key={t.key} className={t.key===tpl.key?"cur":""}
                onClick={()=>{setTemplate(activeTab,card,t);togglePicker(card.id);}}>{psNo(i+1)} {t.title}</button>
            ))}
            {userList.map((t,i)=>(
              <div key={t.key} style={{display:"flex",borderBottom:"1px solid #ddd",background:t.key===tpl.key?"#FFEB00":"#fff"}}>
                <button type="button" className={t.key===tpl.key?"cur":""} style={{flex:1,borderBottom:0}}
                  onClick={()=>{setTemplate(activeTab,card,t);togglePicker(card.id);}}>
                  {psNo(builtinList.length+i+1)} {t.title}
                  <span style={{fontSize:10,color:"#555",marginLeft:5}}>⭐ নিজের{t.topicSel?` · ${t.topicSel.name}`:""}</span>
                </button>
                {delTplKey===t.key?(
                  <>
                    <button type="button" style={{width:"auto",borderBottom:0,padding:"6px 8px",fontSize:11}} onClick={()=>setDelTplKey(null)}>না</button>
                    <button type="button" style={{width:"auto",borderBottom:0,padding:"6px 8px",fontSize:11,background:"#dc2626",color:"#fff",fontWeight:800}} onClick={()=>deleteUserTpl(t.key)}>✅ মুছো</button>
                  </>
                ):(
                  <button type="button" title="এই ফরম্যাট মুছে ফেলো" style={{width:"auto",borderBottom:0,padding:"6px 10px"}} onClick={()=>setDelTplKey(t.key)}>🗑️</button>
                )}
              </div>
            ))}
            <button type="button" className={custom?"cur":""} onClick={()=>{setTemplate(activeTab,card,CUSTOM_TPL);togglePicker(card.id);}}>{CUSTOM_TPL.title}</button>
          </div>
        )}
        {editHead&&(
          <div className="ps-cu">
            <input className="ps-in" value={card.heading}
              onChange={e=>updateCard(activeTab,card.id,{heading:e.target.value})}
              onBlur={()=>{const tp=topicPatchForHeading(card,card.heading); if(tp)updateCard(activeTab,card.id,tp);}}
              />
            {custom&&(
              <select className="inp" value={curCType} onChange={e=>setCustomType(card,e.target.value)}>
                {Object.entries(BUILDER_TYPES).map(([k,b])=><option key={k} value={k}>{isEnTab?b.en:b.bn}</option>)}
              </select>
            )}
          </div>
        )}
        {custom&&(
          <div style={{margin:"0 0 6px 6px",display:"flex",flexWrap:"wrap",gap:6,alignItems:"center",fontSize:11}}>
            {curCType==="table"&&[0,1].map(k=>(
              <input key={k} className="inp" style={{flex:"1 1 90px",minWidth:80,fontSize:11}} placeholder={(k?(isEnTab?"Column 2 name":"২য় কলামের নাম"):(isEnTab?"Column 1 name":"১ম কলামের নাম"))}
                value={(card.cCols&&card.cCols[k])||""} onChange={e=>{const c=[...(card.cCols||["",""])]; c[k]=e.target.value; updateCard(activeTab,card.id,{cCols:c});}}/>
            ))}
            {(curCType==="pair"||curCType==="highlight")&&(
              <>
                <input className="inp" style={{width:70,fontSize:11}} placeholder={isEnTab?"Separator":"বিভাজক"} value={card.cSep||""} onChange={e=>updateCard(activeTab,card.id,{cSep:e.target.value})}/>
                <input className="inp" style={{flex:"1 1 110px",minWidth:90,fontSize:11}} placeholder={isEnTab?"3rd field name (optional)":"৩য় ঘরের নাম (ঐচ্ছিক)"} value={card.cThird||""} onChange={e=>updateCard(activeTab,card.id,{cThird:e.target.value})}/>
              </>
            )}
            {(curCType==="qa"||curCType==="fillu")&&(
              <input className="inp" style={{flex:"1 1 130px",minWidth:90,fontSize:11}} placeholder={isEnTab?"Text before answer (Ans:)":"উত্তরের আগে লেখা (উত্তর:)"} value={card.cPre||""} onChange={e=>updateCard(activeTab,card.id,{cPre:e.target.value})}/>
            )}
            <button type="button" className="ps-add" style={{margin:0,flex:"1 1 100%"}} onClick={()=>saveCustomAsTemplate(card)}>
              {isEnTab?"💾 Save as my new format (with Topic)":"💾 নতুন ফরম্যাট হিসেবে সেভ করো (Topic সহ)"}
            </button>
          </div>
        )}
        {body}
        {lay!=="cloze"&&(
          <button type="button" className="ps-add" onClick={()=>addSubItem(activeTab,card.id)}>{isEnTab?"＋ Add":"＋ আরেকটা"}</button>
        )}
        {lay==="cloze"&&(
          <button type="button" className="ps-add" onClick={()=>addSubItem(activeTab,card.id)}>＋ উত্তর</button>
        )}
        <div className="ps-tp">
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
                    const patch={topicSel:sel,topicAuto:false};
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
        </div>
      </div>
    );
  };

  const renderFlatCard=(card,ci)=>{
    const isMath=activeTab==="math";
    const mcq=card.qtype==="mcq";
    const ex=expandedItems.has(card.id);
    return (
      <div key={card.id} className="ps-sheet">
        <div className="ps-row st" style={{marginLeft:0}}>
          <span className="ps-lab">{psNo(tabOffset+ci+1)}</span>
          <PsTA cover math={isMath} className="q" taRef={el=>{flatQRefs.current[card.id]=el;}} value={card.question}
            onChange={e=>updateCard(activeTab,card.id,{question:e.target.value})}/>
          <span className="ps-ac">
            <button type="button" tabIndex={-1} className="ps-mini" title="Written ⇄ MCQ" onClick={()=>updateCard(activeTab,card.id,{qtype:mcq?"written":"mcq"})}>{mcq?"❓":"✍️"}</button>
            <button type="button" tabIndex={-1} className="ps-mini" title="ব্যাখ্যা / টেকনিক" onClick={()=>toggleExpand(card.id)}>{ex?"▲":"ℹ️"}</button>
            <button type="button" tabIndex={-1} className="ps-x" title="এই প্রশ্নটা বাদ দাও" onClick={()=>removeCard(activeTab,card.id)}>❌</button>
          </span>
          {(isMath||ex)&&(
            <div className="ps-l2">
              {isMath?<><span className="ps-bdg">সমাধান</span><span className="ps-opt">ঐচ্ছিক</span></>:<span>ব্যাখ্যা:</span>}
              <PsTA math={isMath} value={card.explanation} onChange={e=>updateCard(activeTab,card.id,{explanation:e.target.value})}/>
            </div>
          )}
          <div className="ps-l2"><span>উত্তর<b style={{color:"#c0392b"}}>*</b>:</span>
            <PsTA cover math={isMath} taRef={el=>{flatARefs.current[card.id]=el;}} value={card.answer}
              onChange={e=>updateCard(activeTab,card.id,{answer:e.target.value})}/>
            {mcq&&(
              <button type="button" tabIndex={-1} className="ps-mini" title="AI দিয়ে ৩টা ভুল অপশন বানাও" disabled={mcqGeneratingId===card.id}
                onClick={()=>generateMcqOptions(activeTab,card.id,card.id,card.question,card.answer,true)}>{mcqGeneratingId===card.id?"⏳":"🤖"}</button>
            )}
          </div>
          {mcq&&(
            <div className="ps-l2"><span>Options:</span>
              <div className="ps-opts">
                {["opt1","opt2","opt3","opt4"].map((k,oi)=>(
                  <label key={k}><span>{String.fromCharCode(97+oi)})</span>
                    <input className={"ps-in"+(card[k].trim()&&norm(card[k])===norm(card.answer)?" ok":"")} value={card[k]}
                      onChange={e=>updateCard(activeTab,card.id,{[k]:e.target.value})}/></label>
                ))}
              </div>
            </div>
          )}
          {ex&&(
            <div className="ps-l2"><span>টেকনিক:</span>
              <PsTA math={isMath} value={card.technique} onChange={e=>updateCard(activeTab,card.id,{technique:e.target.value})}/></div>
          )}
        </div>
        <div className="ps-tp">
          {tabDef.mathStyle&&(()=>{
            const curName=(card.subjectSel&&card.subjectSel.name)||"";
            const resolved=tabDef.subjectChoices.map(resolveSubjectChoice);
            const isPill=resolved.some(r=>nzTopic(r.name)===nzTopic(curName));
            const custom=!!curName.trim()&&!isPill;                      // পিলের বাইরের Subject (More subject-এর অধীনে)
            const showMore=tabDef.moreSubjects&&(moreOpen.has(card.id)||custom);
            const pillIds=new Set(resolved.map(r=>String(r.id)).filter(Boolean));
            const moreOptions=subjectOptionsShown.filter(s=>!pillIds.has(String(s.id)));
            const many=tabDef.subjectChoices.length>3;
            return (
              <div ref={el=>{subjectFieldRefs.current[card.id]=el;}} className="fld" style={{marginBottom:8,
                  ...(highlightCardId===card.id&&highlightField==="subject"?{outline:"3px solid #ef4444",outlineOffset:3,borderRadius:8,transition:"outline-color .3s"}:{})}}>
                <label>📚 Subject — আগে বেছে নাও, তারপর সেই অনুযায়ী Topic আসবে</label>
                <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                  {tabDef.subjectChoices.map((c,ci2)=>{
                    const rs=resolved[ci2];
                    const on=nzTopic(curName)===nzTopic(rs.name);
                    return (
                      <button type="button" key={c.key}
                        onClick={()=>{ if(on)return; updateCard(activeTab,card.id,{subjectSel:rs,topicSel:{id:"",name:""},subjAuto:false,topicAuto:false,topicAutoSig:""}); }}
                        style={{flex:many?"1 1 calc(50% - 6px)":1,padding:"8px 4px",borderRadius:8,border:`1.5px solid ${on?PC.ink:PC.border}`,background:on?PC.ink:"#fff",color:on?"#fff":PC.ink,fontWeight:800,fontSize:13,cursor:"pointer"}}>{c.short}</button>
                    );
                  })}
                  {tabDef.moreSubjects&&(
                    <button type="button" onClick={()=>toggleMore(card.id)}
                      style={{flex:"1 1 100%",padding:"7px 4px",borderRadius:8,border:`1.5px dashed ${custom?PC.ink:PC.border}`,background:custom?"#eef1fb":"transparent",color:PC.ink,fontWeight:700,fontSize:12,cursor:"pointer"}}>
                      {showMore?"More subject ▾":"More subject ›"}{custom?` — ${curName}`:""}
                    </button>
                  )}
                </div>
                {showMore&&(
                  <div style={{marginTop:6}}>
                    <TypeaheadCombo
                      options={moreOptions}
                      value={custom?card.subjectSel:{id:"",name:""}}
                      onChange={sel=>updateCard(activeTab,card.id,{subjectSel:sel,topicSel:{id:"",name:""},subjAuto:false,topicAuto:false,topicAutoSig:""})}
                      placeholder="অন্য Subject লিখো বা বেছে নাও..."
                      newLabel={`🆕 "${((custom?card.subjectSel.name:"")||"").trim()}" নতুন Subject হিসেবে যোগ হবে`}
                      inputStyle={pcField} lightTheme
                    />
                  </div>
                )}
              </div>
            );
          })()}
          <div ref={el=>{topicRefs.current[card.id]=el;}} className="fld" style={{marginBottom:8,
                  ...(highlightCardId===card.id&&highlightField==="topic"?{outline:"3px solid #ef4444",outlineOffset:3,borderRadius:8,transition:"outline-color .3s"}:{})}}>
                <label>📌 Topic{card.topicAuto&&<span style={{marginLeft:8,fontSize:10.5,fontWeight:800,color:"#8A6D1D",background:"#FFF3C4",borderRadius:10,padding:"1px 8px"}}>🤖 অটো — ভুল হলে বদলাও</span>}</label>
                <TypeaheadCombo
                  options={topicOptionsForShown((tabDef.gkStyle||tabDef.mathStyle)?(((card.subjectSel&&card.subjectSel.id)||subjectOptions.find(s=>s.name===(card.subjectSel&&card.subjectSel.name))?.id)):subjectOptions.find(s=>s.name===tabDef.fixedSubject)?.id)}
                  value={card.topicSel}
                  onChange={sel=>updateCard(activeTab,card.id,{topicSel:sel,topicAuto:false,topicManual:true})}
                  placeholder={(tabDef.gkStyle||tabDef.mathStyle)&&!((card.subjectSel&&card.subjectSel.name)||"").trim()?"আগে Subject বেছে নাও":"Topic লিখো বা বেছে নাও..."}
                  newLabel={`🆕 "${card.topicSel.name.trim()}" নতুন Topic হিসেবে যোগ হবে`}
                  inputStyle={pcField} lightTheme
                />
              </div>
        </div>
      </div>
    );
  };

  return(
    <div style={{background:PC.bg,margin:"0 -16px",padding:"14px 14px 4px",borderRadius:0}}>
      {confirmNew&&(
        <div style={{position:"fixed",inset:0,background:"#000a",zIndex:9999,display:"flex",alignItems:"center",justifyContent:"center",padding:20}} onClick={()=>setConfirmNew(false)}>
          <div style={{background:PC.card,borderRadius:14,padding:16,maxWidth:340,width:"100%"}} onClick={e=>e.stopPropagation()}>
            <div style={{fontSize:14,fontWeight:800,color:PC.ink,marginBottom:6}}>🆕 নতুন ফাঁকা প্রশ্নপত্র?</div>
            <div style={{fontSize:11.5,color:PC.muted,lineHeight:1.6,marginBottom:12}}>এখনকার সব লেখা, পদ, প্রতিষ্ঠান ও সাল মুছে যাবে। খসড়া হিসেবে সেভ না করা থাকলে আর ফেরত পাবে না। সেভ করা খসড়াগুলো থাকবে।</div>
            <div style={{display:"flex",gap:8}}>
              <button type="button" onClick={()=>setConfirmNew(false)} style={{flex:1,padding:"10px 0",borderRadius:9,border:`1px solid ${PC.border}`,background:"transparent",color:PC.ink,fontWeight:700,fontSize:12,cursor:"pointer"}}>বাতিল</button>
              <button type="button" onClick={resetToNewPaper} style={{flex:1,padding:"10px 0",borderRadius:9,border:"none",background:PC.danger,color:"#fff",fontWeight:800,fontSize:12,cursor:"pointer"}}>হ্যাঁ, নতুন করো</button>
            </div>
          </div>
        </div>
      )}
      {previewDraft&&(()=>{
        const d=previewDraft;
        return(
        <div style={{position:"fixed",inset:0,background:"#000a",zIndex:9999,display:"flex",alignItems:"center",justifyContent:"center",padding:14}} onClick={()=>setPreviewDraft(null)}>
          <div style={{background:PC.card,borderRadius:14,maxWidth:520,width:"100%",maxHeight:"88vh",display:"flex",flexDirection:"column",overflow:"hidden"}} onClick={e=>e.stopPropagation()}>
            <div style={{padding:"12px 14px",borderBottom:`1px solid ${PC.border}`}}>
              {d.failed&&<div style={{background:"#fef2f2",border:"1px solid #ef4444",color:"#b91c1c",borderRadius:7,padding:"5px 8px",fontSize:11,fontWeight:800,marginBottom:6}}>🔴 ডাটাবেজে যায়নি — {d.failReason||"সাবমিট ব্যর্থ"}</div>}
              <div style={{fontSize:10,fontWeight:700,color:PC.muted}}>👁 খসড়া প্রিভিউ · {fmtDraftTime(d.savedAt)} · {draftQCount(d)}টা প্রশ্ন</div>
              <div style={{fontSize:14,fontWeight:800,color:PC.ink,marginTop:3}}>🏛 {(d.instSel&&d.instSel.name||"").trim()||"—"}</div>
              <div style={{fontSize:12.5,fontWeight:700,color:PC.ink}}>🧑‍💼 {(d.postSel&&d.postSel.name||"").trim()||"—"}{(d.examYear||"").toString().trim()?` · ${d.examYear}`:""}</div>
            </div>
            <div style={{flex:1,overflowY:"auto",padding:"10px 14px"}}>
              {PAPER_TABS.map(t=>{
                const cards=(d.paper&&d.paper[t.key])||[];
                const shown=cards.filter(c=>t.grouped?(c.items||[]).some(it=>(it.question||"").trim()||(it.answer||"").trim()):((c.question||"").trim()||(c.answer||"").trim()));
                if(!shown.length) return null;
                return(
                  <div key={t.key} style={{marginBottom:14}}>
                    <div style={{fontSize:11.5,fontWeight:800,color:PC.gold,marginBottom:6}}>{t.label||t.key}</div>
                    {shown.map((c,ci)=>(
                      <div key={c.id||ci} style={{background:"#fff",border:`1px solid ${PC.border}`,borderRadius:9,padding:"8px 10px",marginBottom:6}}>
                        {t.grouped?(
                          <>
                            {(c.heading||"").trim()&&<div style={{fontSize:11.5,fontWeight:800,color:PC.ink,marginBottom:4}}><RichText text={c.heading}/></div>}
                            {(c.passage||"").trim()&&<div style={{fontSize:11,color:PC.muted,marginBottom:4,whiteSpace:"pre-wrap"}}><RichText text={c.passage}/></div>}
                            {(c.items||[]).filter(it=>(it.question||"").trim()||(it.answer||"").trim()).map((it,ii)=>(
                              <div key={it.id||ii} style={{fontSize:12,color:PC.ink,marginTop:3,whiteSpace:"pre-wrap"}}>
                                <b>{SUBLABELS[(c.items||[]).indexOf(it)]||ii+1})</b> <RichText text={it.question}/>
                                {(it.answer||"").trim()&&<div style={{color:PC.answerText,fontWeight:700,marginLeft:14}}>✅ <RichText text={it.answer}/></div>}
                              </div>
                            ))}
                          </>
                        ):(
                          <>
                            {(c.subjectSel&&c.subjectSel.name)&&<div style={{fontSize:10,fontWeight:700,color:PC.muted,marginBottom:2}}>{c.subjectSel.name}{c.topicSel&&c.topicSel.name?` — ${c.topicSel.name}`:""}</div>}
                            <div style={{fontSize:12,color:PC.ink,whiteSpace:"pre-wrap"}}><b>{ci+1}.</b> <RichText text={c.question}/></div>
                            {(c.answer||"").trim()&&<div style={{fontSize:12,color:PC.answerText,fontWeight:700,marginTop:2}}>✅ <RichText text={c.answer}/></div>}
                          </>
                        )}
                      </div>
                    ))}
                  </div>
                );
              })}
              {d.paper&&draftQCount(d)===0&&<div style={{fontSize:11,color:PC.muted,textAlign:"center",padding:16}}>প্রশ্ন নেই</div>}
            </div>
            <div style={{display:"flex",gap:8,padding:"10px 14px",borderTop:`1px solid ${PC.border}`}}>
              <button type="button" onClick={()=>setPreviewDraft(null)} style={{flex:1,padding:"10px 0",borderRadius:9,border:`1px solid ${PC.border}`,background:"transparent",color:PC.ink,fontWeight:700,fontSize:12,cursor:"pointer"}}>✕ বন্ধ</button>
              {!d.uploading&&<button type="button" onClick={()=>{loadNamedDraft(d);setPreviewDraft(null);}} style={{flex:2,padding:"10px 0",borderRadius:9,border:"none",background:PC.ink,color:"#fff",fontWeight:800,fontSize:12,cursor:"pointer"}}>▶️ এই খসড়া লোড করো</button>}
            </div>
          </div>
        </div>
        );
      })()}
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
      <div style={{display:"flex",justifyContent:"flex-end",marginBottom:6}}><CoverToggle color={PC.muted}/></div>
      {/* ── পদ/প্রতিষ্ঠান/সাল — একদম শুরুতে, ৪টা ট্যাবের সবার উপরে (session-wide,
          একবার দিলে বাংলা/English/Math/GK — এই সেশনের সব প্রশ্নেই একই Exam Appearance
          যাবে, কারণ QBank মানেই বিগত পরীক্ষা, এই ৩টা ছাড়া entry অসম্পূর্ণ) ── */}
      <div ref={metaCardRef} style={{background:metaMissing?"#fef2f2":PC.card,border:metaMissing?"2px solid #ef4444":`1px solid ${PC.border}`,borderRadius:12,padding:12,marginBottom:12,transition:"background .3s"}}>
        <div style={{fontSize:12,fontWeight:800,color:metaMissing?"#b91c1c":PC.ink,marginBottom:2}}>🧾 কোন প্রশ্নপত্র থেকে? <span style={{color:"#dc2626"}}>* বাধ্যতামূলক</span></div>
        <div style={{fontSize:10.5,color:PC.muted,marginBottom:8}}>পদ, প্রতিষ্ঠান ও সাল — তিনটাই না দিলে সাবমিট হবে না। এই সেশনের ৪টা ট্যাবের সব প্রশ্নই এই Exam Appearance পাবে — প্রশ্নের রো ডুপ্লিকেট হয় না, একই প্রশ্ন আগে থেকে থাকলে শুধু Appearance জুড়ে যায় (সাল আলাদা হলে নতুন Appearance)।</div>
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

      <style>{PS_CSS}</style>
      {(instSel.name.trim()||postSel.name.trim()||examYear.trim())&&(
        <div className="ps-bn"><div className="b1">{instSel.name.trim()||"—"}</div><div className="b2">{postSel.name.trim()||"—"}</div>
          <div className="b3"><span>{examYear.trim()}</span><span>{tabDef.label}</span></div></div>
      )}
      <div className="ps-hintbar" style={{color:PC.muted}}>💡 টেক্সট সিলেক্ট করে <b>Ctrl+B</b> বোল্ড · <b>Ctrl+U</b> আন্ডারলাইন · <b>Ctrl+I</b> ইটালিক — অথবা মাউসে সিলেক্ট করলে ভেসে ওঠা B / U / I টুলবার</div>
      {activeTab==="math"&&(
        <div className="ps-hintbar" style={{color:PC.muted}}>🧮 <b>*</b> → × · <b>/</b> → ÷ · <b>অতএব</b>+স্পেস → ∴ (ব্যাকস্পেসে আগের লেখা ফিরে আসে) · স্পেস ছাড়া <b>১/ক-খ</b>, <b>৩/৫</b> → ভগ্নাংশ</div>
      )}
      <div onKeyDown={psTabNav}>
        {(paper[activeTab]||[]).map((card,ci)=>tabDef.grouped?renderGroupCard(card,ci):renderFlatCard(card,ci))}
      </div>

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
              background:failedDraftCount>0?"#fef2f2":"transparent",border:failedDraftCount>0?"1.5px solid #ef4444":`1px solid ${PC.border}`,color:failedDraftCount>0?"#b91c1c":PC.ink,cursor:"pointer"}}>
            📂 সেভ করা খসড়া ({draftList.length}) {showDraftList?"▲":"▼"}
            {failedDraftCount>0&&<span style={{display:"block",fontSize:10,color:"#dc2626",fontWeight:800}}>🔴 {toBn(failedDraftCount)}টা ব্যর্থ</span>}
            {uploadingDraftCount>0&&<span style={{display:"block",fontSize:10,color:"#2563eb",fontWeight:800}}>⏳ {toBn(uploadingDraftCount)}টা আপলোড চলছে</span>}
          </button>
          <button type="button" onClick={askNewPaper}
            style={{flex:1,justifyContent:"center",padding:"9px 0",borderRadius:9,fontSize:11.5,fontWeight:700,
              background:"transparent",border:`1px solid ${PC.border}`,color:PC.danger,cursor:"pointer"}}>
            🆕 New Paper
          </button>
        </div>
        {showDraftList&&(
          <div style={{maxHeight:280,overflowY:"auto",border:`1px solid ${PC.border}`,borderRadius:10,marginBottom:8,background:"#fff"}}>
            {draftList.length===0?(
              <div style={{padding:14,fontSize:11,color:PC.muted,textAlign:"center"}}>এখনো কোনো খসড়া সেভ করা হয়নি</div>
            ):(
              [...draftList].sort((a,b)=>((b.failed||b.uploading)?1:0)-((a.failed||a.uploading)?1:0)||b.savedAt-a.savedAt).map(d=>(
                <div key={d.id} style={{display:"flex",alignItems:"center",gap:8,padding:"10px 12px",borderBottom:`1px dashed ${PC.border}`,
                  ...(d.failed?{background:"#fef2f2",borderLeft:"4px solid #ef4444"}:{}),
                  ...(d.uploading?{background:"#eff6ff",borderLeft:"4px solid #2563eb"}:{})}}>
                  <div style={{flex:1,minWidth:0}}>
                    {d.uploading&&<div style={{fontSize:10,fontWeight:800,color:"#2563eb",marginBottom:2,lineHeight:1.4}}>⏳ আপলোড চলছে — শেষ হলে নিজে মুছে যাবে (ব্যর্থ হলে লাল হবে)</div>}
                    {d.failed&&<div style={{fontSize:10,fontWeight:800,color:"#dc2626",marginBottom:2,lineHeight:1.4}}>🔴 ডাটাবেজে যায়নি — {d.failReason||"সাবমিট ব্যর্থ"}</div>}
                    <div style={{fontSize:11.5,fontWeight:800,color:PC.ink,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>🧑‍💼 {(d.postSel&&d.postSel.name||"").trim()||<span style={{color:PC.danger}}>পদ নেই</span>}</div>
                    <div style={{fontSize:11,fontWeight:700,color:PC.ink,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",marginTop:1}}>🏛 {(d.instSel&&d.instSel.name||"").trim()||<span style={{color:PC.danger}}>প্রতিষ্ঠান নেই</span>}{(d.examYear||"").toString().trim()?` · ${d.examYear}`:""}</div>
                    <div style={{fontSize:9.5,color:d.failed?"#dc2626":PC.muted,marginTop:2}}>{d.failed?"ব্যর্থ হয়েছে: ":""}{fmtDraftTime(d.failed?(d.failedAt||d.savedAt):d.savedAt)} · {draftQCount(d)}টা প্রশ্ন</div>
                  </div>
                  <button type="button" onClick={()=>setPreviewDraft(d)}
                    style={{flexShrink:0,padding:"6px 8px",borderRadius:7,fontSize:10.5,fontWeight:700,
                      background:"transparent",color:PC.ink,border:`1px solid ${PC.border}`,cursor:"pointer"}}>👁 প্রিভিউ</button>
                  {!d.uploading&&<button type="button" onClick={()=>loadNamedDraft(d)}
                    style={{flexShrink:0,padding:"6px 10px",borderRadius:7,fontSize:10.5,fontWeight:700,
                      background:d.failed?"#dc2626":PC.ink,color:"#fff",border:"none",cursor:"pointer"}}>{d.failed?"লোড করে আবার পাঠাও":"লোড করো"}</button>}
                  {!d.uploading&&<button type="button" onClick={()=>deleteNamedDraft(d.id)}
                    style={{flexShrink:0,background:"transparent",border:"none",color:"#ef4444",cursor:"pointer",fontSize:14}}>🗑</button>}
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
        {(!postSel.name.trim()||!instSel.name.trim()||!examYear.trim())&&(
          <div style={{textAlign:"center",fontSize:11,fontWeight:800,color:"#dc2626",marginBottom:6}}>
            ⚠️ সাবমিটের আগে দাও: {[!postSel.name.trim()&&"পদ",!instSel.name.trim()&&"প্রতিষ্ঠান",!examYear.trim()&&"সাল"].filter(Boolean).join(", ")}
          </div>
        )}
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
                  : `⏳ প্রস্তুত হচ্ছে... (${Math.max(1,Math.floor(elapsedMs/1000))} সেকেন্ড)`)
              : refDataError?"❌ রেফারেন্স ডেটা লোড ব্যর্থ — উপরে রিট্রাই চাপো"
              : refData===null?"⏳ রেফারেন্স ডেটা লোড হচ্ছে...":`🚀 সব সাবমিট করো — ${totalCount}টা প্রশ্ন (Ctrl+S)`}
          </span>
        </button>
        <div style={{textAlign:"center",fontSize:9.5,color:PC.muted,marginTop:6}}>
          {saving
            ? "প্রস্তুত হচ্ছে... একটু পরেই আপলোড ব্যাকগ্রাউন্ডে চলে যাবে — তখন নিচের বারে অগ্রগতি দেখাবে, আর ফর্ম খালি হয়ে যাবে"
            : "৪টা ট্যাবেই যত প্রশ্ন জমা আছে সবগুলো একসাথে সাবমিট হবে — সাবমিটের পর আপলোড ব্যাকগ্রাউন্ডে চলে, ততক্ষণে পরের প্রশ্নপত্র টাইপ করতে পারো · প্রতি কয়েক সেকেন্ডে অটো-ড্রাফট সেভ হয়"}
        </div>
      </div>
    </div>
  );
}

export { PaperComposer, PAPER_TABS, newPaperId, newPaperItem, newGroupCard, newFlatCard, makeInitialPaper, SUBLABELS, detectAutoMarkup, headingToTopicGuess, bestTopicMatchForHeading, mergedTopicOptionsFor, buildMcqGenPrompt, buildExplGenPrompt, parseGenResponse, shuffle4 };
