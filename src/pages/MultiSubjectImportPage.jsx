/* ══════════════════════════════════════════════════════════════════
   MULTI-SUBJECT BULK IMPORT (OCR) — শুধু Written টাইপ
   — একসাথে অনেক ছবি (একাধিক subject/sub-topic মিশ্রিত) bulk আপলোড
   — প্রতিটা পাতার হেডার থেকে AI Designation → Subject, Institution →
     Sub-topic ডিটেক্ট করে
   — ছবি যোগ করার সময় ইউজার নিজেই "✂️ নতুন Group" মার্ক করে দিতে পারে —
     সেই boundary-র বাইরে carry-forward কখনো যায় না (misread হলেও এক
     group আরেকটায় ঢুকে যাওয়ার ঝুঁকি থাকে না)
   — Process শেষে সরাসরি সাবমিট হয় না — একটা হালকা "Group Confirm"
     ধাপ দেখায় (Subject/Sub-topic/count/page-list, এডিটেবল + বাদ
     দেওয়ার অপশন) — তারপর এক-ট্যাপে Submit
   — পুরনো AIImportPage/BulkUploaderPage অপরিবর্তিত — সম্পূর্ণ নতুন,
     আলাদা পেজ
   ══════════════════════════════════════════════════════════════════ */
import React, { useState, useRef, useEffect } from "react";
import { C } from "../core/config.js";
import { _LC } from "../core/logger.js";
import { nowTs, uploadImageSrcToImgbb } from "../core/utils.js";
import { _BGM } from "../core/bgTasks.js";
import { callAiProviderRotatingRaw, buildKeyPool, OCR_CORRECTION_RULES } from "../core/ocrProviders.js";
import {
  buildBulkRecord, buildSheetRow,
  loadSaveLocPref, saveSaveLocPref, loadSharedGasSecret, saveSharedGasSecret, pushFailedItems
} from "../core/uploaderUtils.js";
import { saveRowsToSheet, fetchReferenceData } from "../core/sheetSave.js";
import { resolveOrCreateReference, resolveSubjectTopicForEntries } from "../core/referenceHelpers.js";
import { TypeaheadCombo } from "../components/shared/TypeaheadCombo.jsx";
import { getOcrCacheEntry, setOcrCacheEntry } from "../core/ocrCache.js";
import { archiveAdd, archiveDeleteMany } from "../core/archiveStore.js";
import { SaveLocationPicker } from "../components/shared/SaveLocationPicker.jsx";
import { FailedQueuePanel } from "../components/shared/FailedQueuePanel.jsx";
import { ApiSettingsPage } from "./ApiSettingsPage.jsx";

const SRC_NAME="Multi-Subject Bulk Import";
const CACHE_QTYPE="MultiSubjectWritten"; // AIImportPage-এর ক্যাশ থেকে আলাদা রাখতে নিজস্ব qtype key

/* ── ছবি সিলেক্ট করার পর ক্র্যাশ ফিক্স ──────────────────────────────────
   দুটো আলাদা কারণে renderer-process OOM ক্র্যাশ হচ্ছিল:
   ১) Gallery দিয়ে ছবি আনলে GalleryPickerPlugin নেটিভ সাইডে ২০০০px পর্যন্ত
      ডাউনস্কেল করে ঠিকই, কিন্তু 📷 Camera দিয়ে তোলা ছবি (@capacitor/camera
      getPhoto) কোনো ডাউনস্কেল ছাড়াই ফোনের আসল রেজোলিউশনে (অনেক ফোনে
      ৪০০০px+ / ১২MP+) সরাসরি base64 হিসেবে আসে — এটাই সবচেয়ে বড় ঝুঁকি।
   ২) সেই base64 কে সরাসরি বিশাল "data:...;base64,...." স্ট্রিং হিসেবে
      React state-এ (webPath) রাখা হতো, আর একই বড় ছবি একাধিক জায়গায়
      (list thumbnail, group-expand thumbnail, zoom preview) আলাদা আলাদা
      ভাবে ফুল-রেজোলিউশনে ডিকোড হতো — কয়েকটা বড় ছবি একসাথে থাকলেই লো/মিড-
      এন্ড ফোনে মেমরি ফুরিয়ে WebView renderer ক্র্যাশ করে যেত।
   সমাধান:
   — Camera দিয়ে তোলা ছবি সাথে সাথেই client-side ক্যানভাসে ২০০০px-এ
     ডাউনস্কেল করা হয় (GalleryPickerPlugin-এর MAX_DIM-এর সমতুল্য)।
   — বড় base64 স্ট্রিং state-এ না রেখে Blob + Object URL বানিয়ে রাখা হয়
     (browser এটা JS string heap-এর বাইরে ম্যানেজ করে, অনেক হালকা)।
   — লিস্টে দেখানোর জন্য আলাদা ছোট (max ৪৮০px) থাম্বনেইল বানানো হয় —
     আসল ছবি শুধু OCR/zoom প্রিভিউ-এর জন্য অক্ষত থাকে। ── */
function downscaleImageSrc(src,maxDim=2000,quality=0.9){
  return new Promise((resolve)=>{
    if(!src){resolve(src);return;}
    try{
      const image=new Image();
      image.onload=()=>{
        const w=image.naturalWidth,h=image.naturalHeight;
        if(!w||!h||(w<=maxDim&&h<=maxDim)){resolve(src);return;}
        const scale=maxDim/Math.max(w,h);
        const cw=Math.max(1,Math.round(w*scale)),ch=Math.max(1,Math.round(h*scale));
        const canvas=document.createElement("canvas");
        canvas.width=cw;canvas.height=ch;
        canvas.getContext("2d").drawImage(image,0,0,cw,ch);
        try{resolve(canvas.toDataURL("image/jpeg",quality));}
        catch(e){resolve(src);} // canvas taint ইত্যাদি হলেও অ্যাপ যেন ক্র্যাশ না করে
      };
      image.onerror=()=>resolve(src);
      image.src=src;
    }catch(e){resolve(src);}
  });
}
const makeThumbnail=(src)=>downscaleImageSrc(src,480,0.72);
/* বড় base64 data: URI-কে Blob object URL-এ রূপান্তর করে — এতে বিশাল
   base64 স্ট্রিং React state/JS heap-এ আটকে থাকে না (শুধু raw bytes হিসেবে
   browser নিজে ম্যানেজ করে), মেমরি চাপ অনেক কমে যায় */
async function dataUrlToObjectUrl(dataUrl){
  try{
    const r=await fetch(dataUrl);
    const blob=await r.blob();
    return URL.createObjectURL(blob);
  }catch(e){ return dataUrl; } // fetch/blob ব্যর্থ হলেও অ্যাপ যেন ক্র্যাশ না করে, আসল data URI-ই ব্যবহার হবে
}
const revokeIfObjectUrl=(url)=>{ if(url&&url.startsWith("blob:")){ try{URL.revokeObjectURL(url);}catch(e){} } };

/* ── নির্ভরযোগ্য সেফটি-নেট (AI-নির্ভর না) ──────────────────────────────────
   একাধিক ফ্রি AI provider ঘুরিয়ে ব্যবহার হয় (Gemini quota শেষ হলে Groq/Mistral
   fallback), আর কখন কোনটা active থাকবে সেটা নিয়ন্ত্রণ করা যায় না। ছোট/দুর্বল
   মডেলগুলো (Groq/Mistral-এর ফ্রি ৭-৮B মডেল) প্রম্পটের জটিল, বহু-ধাপের নির্দেশনা
   (উপ-প্রশ্ন split করো, watermark বাদ দাও) নির্ভরযোগ্যভাবে মানতে পারে না — এটা
   প্রম্পট আরও ভালো লিখে সমাধানযোগ্য না, তাই এখানে JS-এই deterministic (regex-
   ভিত্তিক, কোনো AI লাগে না) দুটো ফিল্টার বসানো হলো — যেই provider-ই উত্তর দিক
   না কেন, এই ফিল্টার দুটো সবসময় একইভাবে কাজ করবে। ── */

// ফোনের ওয়াটারমার্ক/ক্যামেরা-অ্যাপ সিগনেচার (যেমন "Vivo Y56 Hanif Sarder", তারিখ-সময় স্ট্যাম্প)
// ভুলবশত উত্তর/প্রশ্ন হিসেবে ঢুকে গেলে সেই entry-টাই বাদ দেওয়ার জন্য
const DEVICE_BRAND_RE=/\b(vivo|oppo|realme|redmi|xiaomi|samsung|iphone|poco|itel|symphony|walton|tecno|infinix|huawei|honor|oneplus|nokia|asus|lenovo|motorola)\b/i;
function isNoiseWatermark(text){
  const t=(text||"").trim();
  if(!t)return false;
  const words=t.split(/\s+/);
  if(DEVICE_BRAND_RE.test(t)&&words.length<=6)return true; // ছোট, ফোন-ব্র্যান্ড-উল্লেখ লাইন — নিশ্চিতভাবে ওয়াটারমার্ক
  if(/\b(19|20)\d{2}\b/.test(t)&&/\d{1,2}[:.]\d{2}/.test(t)&&words.length<=8)return true; // তারিখ+সময় স্ট্যাম্প
  return false;
}

// উত্তরের ভেতর ক./খ./গ./ঘ./ঙ. অথবা a./b./c./d./e. দিয়ে চিহ্নিত একাধিক লাইন থাকলে
// (একাধিক উপ-প্রশ্নের উত্তর AI ভুলবশত এক জায়গায় বান্ডিল করে ফেলেছে), সেটাকে
// এখানে জোর করে আলাদা আলাদা {q,a} entry-তে ভেঙে দেওয়া হয় — AI নিজে split
// করুক বা না করুক, এই ধাপ সবসময় প্রয়োগ হবে।
const BULLET_LINE_RE=/^\s*([কখগঘঙচছজঝঞটঠডঢণa-hA-H])[.।)]\s*(.+)$/;
function splitBundledAnswer(q,a,subject){
  const lines=(a||"").split(/\n+/).map(s=>s.trim()).filter(Boolean);
  if(lines.length<2)return[{q,a,subject}];
  const matches=lines.map(l=>l.match(BULLET_LINE_RE));
  const matchCount=matches.filter(Boolean).length;
  // অন্তত ২টা লাইন এবং বেশিরভাগ লাইনই বুলেট-প্যাটার্নে না মিললে অক্ষত রাখো (ভুলভাবে ভেঙে ফেলার ঝুঁকি এড়াতে)
  if(matchCount<2||matchCount<lines.length*0.6)return[{q,a,subject}];
  const baseQ=(q||"").replace(/[:।]\s*$/,"").trim();
  return lines.map((l,i)=>{
    const m=matches[i];
    const content=m?m[2].trim():l;
    // "ক. বিদ্যালয় = বিদ্যা + আলয়" এর মতো হলে "=/ — / :" দিয়ে ভেঙে টার্গেট শব্দটাকেই প্রশ্নে বসাই
    const sep=content.match(/^(.{1,40}?)\s*[=:—–]\s*(.+)$/);
    if(sep) return{q:`${baseQ}: ${sep[1].trim()}`,a:sep[2].trim(),subject};
    return{q:`${baseQ} (${m?m[1]:i+1})`,a:content,subject};
  });
}
/* ── উপরের দুটো ফিল্টার প্রয়োগ করে raw AI entries থেকে চূড়ান্ত, পরিষ্কার entries বানায় ──
   🐛 ফিক্স: আগে e.subject এখানে হারিয়ে যেত (splitBundledAnswer শুধু {q,a} ফেরত দিত) —
   এখন subject প্রতিটা split sub-entry-তেও (একই বিষয়) ঠিকভাবে বয়ে যায়। */
function sanitizeEntries(rawEntries){
  const out=[];
  (rawEntries||[]).forEach(e=>{
    if(isNoiseWatermark(e.q)||isNoiseWatermark(e.a))return; // ওয়াটারমার্ক-দূষিত entry বাদ
    splitBundledAnswer(e.q,e.a,e.subject).forEach(s=>{
      if(s.q&&s.a&&!isNoiseWatermark(s.a)) out.push(s);
    });
  });
  return out;
}

/* ── MCQ ভার্সন — splitBundledAnswer এখানে ব্যবহার হয় না, কারণ সেটা ক/খ/গ/ঘ দেখে
   sub-question split করে — MCQ-তে ক/খ/গ/ঘ আসলে option-লেবেল, sub-question না, split
   করলে option-গুলোই ভেঙে যাবে। শুধু watermark-noise ফিল্টার হয়, বাকি entry অপরিবর্তিত। ── */
function sanitizeEntriesMCQ(rawEntries){
  return (rawEntries||[]).filter(e=>e&&e.q&&e.opt1&&e.opt2&&!isNoiseWatermark(e.q));
}



/* ── AI prompt: header থেকে Designation/Institution + Written প্রশ্ন-উত্তর একসাথে বের করে JSON দেয় ── */
function buildDetectPrompt(ocrText){
  return `তুমি একজন বাংলা সরকারি নিয়োগ পরীক্ষার প্রশ্নব্যাংক বিশ্লেষক (শুধু Written টাইপ)।

নিচের OCR text একটি বইয়ের একটি পাতা থেকে নেওয়া। প্রায় প্রতিটা পাতার একদম উপরে (সাধারণত প্রথম ১-৩ লাইনে) একটা হেডার/টাইটেল লাইন থাকে যেখানে চাকরির পদবী (Designation) ও প্রতিষ্ঠান/দপ্তরের নাম (Institution) লেখা থাকে — প্রায়ই তার ঠিক পরেই "তারিখ:", "সময়:", "পূর্ণমান:" জাতীয় মেটা-তথ্য থাকে (থাকলে সেটাই হেডার শেষ হওয়ার সংকেত হিসেবে ধরে নাও)।

হেডার নানা রকম ফরম্যাটে আসতে পারে, যেমন (উদাহরণ):
- "বন অধিদপ্তর-এর গাড়ী চালক ২০২৫" → designation="গাড়ী চালক", institution="বন অধিদপ্তর", year="2025"
- "স্বাস্থ্য সহকারী/স্টোর কিপ ... রাঙ্গামাটি পার্বত্য জেলা পরিষদ" → designation="স্বাস্থ্য সহকারী/স্টোর কিপ", institution="রাঙ্গামাটি পার্বত্য জেলা পরিষদ"
- "অফিস সহায়ক, সহায়ক ... কারিগরি শিক্ষা অধিদপ্তর" → designation="অফিস সহায়ক, সহায়ক", institution="কারিগরি শিক্ষা অধিদপ্তর"
- "পরিসংখ্যান সহকারী ... মৎস্য অধিদপ্তর" (institution-এর বানান/OCR কিছুটা অস্পষ্ট এলেও প্রাসঙ্গিক best-guess দাও)

কাজ:
১. হেডার থেকে designation, institution ও year (সাল, ৪-ডিজিট, বাংলা/ইংরেজি সংখ্যায় যা-ই থাকুক ইংরেজি সংখ্যায় দাও) আলাদা করে বের করো। "Written" শব্দ, পাতা নম্বর, "তারিখ/সময়/পূর্ণমান" — এসব বাদ দাও।
   — হেডারের বানান/OCR কিছুটা garbled বা অসম্পূর্ণ হলেও, যতটুকু পড়া যায় তা দিয়ে best-effort extract করো — পুরোপুরি নিশ্চিত না হলেও যুক্তিসঙ্গত best-guess দেওয়া ভালো, শুধু সম্পূর্ণ বানিয়ে বসিও না।
   — designation/institution/year শুধুমাত্র তখনই "" (খালি) দাও, যখন এই পাতার শুরুতে আদৌ কোনো heading/title-সদৃশ লাইনই নেই (শুধু প্রশ্ন-উত্তরের ধারাবাহিকতা, নতুন কোনো heading এই পাতায় দেখাই যাচ্ছে না)।
২. এই পাতায় থাকা Written প্রশ্ন-উত্তরগুলো (নম্বরসহ, প্রতিটা প্রশ্নের সাথে থাকা উত্তর) বের করো। MCQ/option-ভিত্তিক প্রশ্ন থাকলেও শুধু প্রশ্ন ও সরাসরি সঠিক উত্তরটুকু নাও, option বাদ দাও।
   — কোনো নম্বরের নিচে একাধিক উপ-প্রশ্ন/ভাগ থাকলে (ক/খ/গ/ঘ/ঙ, a/b/c/d/e, ১/২/৩ ইত্যাদি দিয়ে চিহ্নিত) — প্রতিটা উপ-প্রশ্নকে সম্পূর্ণ আলাদা, স্বতন্ত্র entry (আলাদা {q,a}) বানাও। কখনোই একাধিক উপ-প্রশ্ন একসাথে জোড়া লাগিয়ে একটা entry বানাবে না।
   — প্রতিটা উপ-প্রশ্নের entry-তে মূল নির্দেশনা বাক্যটাও (যেমন "সন্ধিবিচ্ছেদ করুন", "Fill in the blank with appropriate preposition") পুনরাবৃত্তি করে জুড়ে দাও, যাতে entry-টা প্রসঙ্গ ছাড়াই একা পড়লেও বোঝা যায়। উদাহরণ: "৩. সন্ধিবিচ্ছেদ করুন: ক. বিদ্যালয় খ. নায়ক" থেকে দুটো আলাদা entry হবে — {"q":"সন্ধিবিচ্ছেদ করুন: বিদ্যালয়","a":"বিদ্যা + আলয়"} এবং {"q":"সন্ধিবিচ্ছেদ করুন: নায়ক","a":"নৈ + অক"} — একটাতে সব জোড়া লাগানো entry বানাবে না।
৩. ছবির কোণায় ফোন/ক্যামেরা অ্যাপ নিজে থেকে যা বসিয়ে দেয় (ফোনের মডেল নাম যেমন "Vivo Y56", মালিকের নাম, তারিখ/সময় স্ট্যাম্প — যেমন "Vivo Y56 · Hanif Sarder", "Jul 25, 2026, 10:27") — এগুলো প্রশ্ন-উত্তরের অংশ নয়, সম্পূর্ণ উপেক্ষা করো, কোনো entry-তে বসাবে না।
৪. (গুরুত্বপূর্ণ, best-effort) — এই ধরনের বই/শীটে প্রায়ই প্রশ্নগুলো বড় বড় বিষয়-সেকশনে ভাগ করা থাকে, প্রতিটা সেকশনের শুরুতে একটা আলাদা, বোল্ড হেডিং লাইন থাকে যেমন "গণিত-১৫", "সাধারণ জ্ঞান-১৫", "বাংলা-২৫", "ইংরেজি-২৫", "বিজ্ঞান-১০" (সংখ্যাটা সেই সেকশনে কতগুলো প্রশ্ন আছে তার ইঙ্গিত, বিষয় বোঝার জন্য এটা লাগবে না)। এই পাতায় এমন কোনো সেকশন-হেডিং থাকলে সেটা top-level "sectionSubject" ফিল্ডে দাও — সবসময় এই ৫টার একটাতে normalize করে দাও:
   — "বাংলা" (বাংলা ব্যাকরণ + বাংলা সাহিত্য দুটোই এর আন্ডারে)
   — "ইংরেজি" (English Grammar + English Literature দুটোই এর আন্ডারে)
   — "গণিত" (পাটিগণিত + বীজগণিত + জ্যামিতি — সব ধরনের অংক এর আন্ডারে)
   — "বিজ্ঞান" (বৈজ্ঞানিক/সাধারণ বিজ্ঞান বিষয়ক প্রশ্ন)
   — "সাধারণ জ্ঞান" (বাংলাদেশ বিষয়াবলি + আন্তর্জাতিক বিষয়াবলি + কম্পিউটার/আইসিটি + বাকি সাধারণ জ্ঞান — সবকিছু একত্রে এই একটাতেই পড়বে, "বাংলাদেশ বিষয়াবলি"/"আন্তর্জাতিক" আলাদা category বানিও না)
   এই পাতায় এমন কোনো নতুন সেকশন-হেডিং দেখতেই না পেলে (আগের পাতা থেকেই চলমান একটা সেকশনের প্রশ্ন, নতুন heading নেই) "sectionSubject":"" খালি রাখো — আগের পাতার সেকশনটাই এখানে ধরে নেওয়া হবে, তোমাকে অনুমান করে বসাতে হবে না।
৫. (ঐচ্ছিক, best-effort) — যদি কোনো নির্দিষ্ট প্রশ্নের ঠিক আগেই আলাদা একটা ছোট sub-heading থাকে (উপরের sectionSubject-এর চেয়েও নির্দিষ্ট, যেমন সেকশনের ভেতরে "প্রবাদ-প্রবচন" জাতীয় উপ-ভাগ), সেটা সেই entry-র "subject" ফিল্ডে দাও (এটা sectionSubject override করবে)। বেশিরভাগ ক্ষেত্রেই এমন কিছু থাকবে না — তখন "subject":"" রাখো, sectionSubject থেকেই বিষয় বসে যাবে।
${OCR_CORRECTION_RULES}

শুধু নিচের বিশুদ্ধ JSON ফরম্যাটে উত্তর দাও — কোনো markdown code fence (\`\`\`), কোনো ব্যাখ্যা, কোনো অতিরিক্ত টেক্সট ছাড়া:
{"designation":"...","institution":"...","year":"...","sectionSubject":"...","entries":[{"q":"...","a":"...","subject":"..."}]}

RULES:
- Serial number বাদ দাও
- q বা a এর ভেতরে দরকার হলে সঠিকভাবে escape (\\") করো, যাতে JSON valid থাকে
- পাতা নম্বর, বিজ্ঞাপন, প্রমোশনাল টেক্সট বাদ দাও
- কোনো প্রশ্ন বাদ দিও না

=== OCR TEXT ===
${ocrText}`;
}

/* ── AI response → {designation, institution, year, sectionSubject, entries:[{q,a,subject}]} ── */
function parseDetectResponse(text){
  let t=(text||"").trim();
  t=t.replace(/^```json/i,"").replace(/^```/,"").replace(/```$/,"").trim();
  const start=t.indexOf("{"), end=t.lastIndexOf("}");
  if(start===-1||end===-1) throw new Error("JSON পাওয়া যায়নি — AI response format ঠিক নেই");
  const obj=JSON.parse(t.slice(start,end+1));
  const designation=(obj.designation||"").toString().trim();
  const institution=(obj.institution||"").toString().trim();
  const year=(obj.year||"").toString().trim().replace(/[^\d]/g,"").slice(0,4);
  const sectionSubject=(obj.sectionSubject||"").toString().trim();
  const entries=Array.isArray(obj.entries)
    ?obj.entries.filter(e=>e&&e.q&&e.a).map(e=>({
        q:String(e.q).trim(),
        a:(Array.isArray(e.a)?e.a.join("\n"):String(e.a)).trim(),
        subject:(e.subject||"").toString().trim(),
      })).filter(e=>e.q&&e.a)
    :[];
  return{designation,institution,year,sectionSubject,entries};
}

/* ── AI prompt: header থেকে Designation/Institution + MCQ প্রশ্ন-option-answer একসাথে বের করে JSON দেয় ──
   Written প্রম্পট থেকে মূল পার্থক্য শুধু ধাপ ২-এ — এখানে option বাদ দেওয়া হয় না, বরং ৪টা
   option-ই আলাদা করে বের করা হয়, আর possible হলে সঠিক উত্তর মেলানো হয়। ── */
function buildDetectPromptMCQ(ocrText){
  return `তুমি একজন বাংলা সরকারি নিয়োগ পরীক্ষার প্রশ্নব্যাংক বিশ্লেষক (শুধু MCQ টাইপ)।

নিচের OCR text একটি বইয়ের একটি পাতা থেকে নেওয়া। প্রায় প্রতিটা পাতার একদম উপরে (সাধারণত প্রথম ১-৩ লাইনে) একটা হেডার/টাইটেল লাইন থাকে যেখানে চাকরির পদবী (Designation) ও প্রতিষ্ঠান/দপ্তরের নাম (Institution) লেখা থাকে — প্রায়ই তার ঠিক পরেই "তারিখ:", "সময়:", "পূর্ণমান:" জাতীয় মেটা-তথ্য থাকে (থাকলে সেটাই হেডার শেষ হওয়ার সংকেত হিসেবে ধরে নাও)।

কাজ:
১. হেডার থেকে designation, institution ও year (সাল, ৪-ডিজিট, বাংলা/ইংরেজি সংখ্যায় যা-ই থাকুক ইংরেজি সংখ্যায় দাও) আলাদা করে বের করো। "MCQ" শব্দ, পাতা নম্বর, "তারিখ/সময়/পূর্ণমান" — এসব বাদ দাও। হেডারের বানান/OCR কিছুটা garbled হলেও best-effort extract করো। কোনো heading-ই না থাকলে "" খালি দাও।
২. এই পাতায় থাকা প্রতিটা MCQ প্রশ্নের জন্য — প্রশ্নের টেক্সট এবং তার ৪টা option (ক/খ/গ/ঘ বা A/B/C/D বা ১/২/৩/৪ — পাতায় যেভাবেই লেখা থাকুক, ঠিক সেই ক্রমেই, প্রতিটা option-এর টেক্সট আলাদা করে) বের করো। প্রশ্ন-নম্বর বাদ দাও, option-লেবেল (ক./A./১.) বাদ দাও — শুধু আসল টেক্সট রাখো।
৩. সঠিক উত্তর বের করার চেষ্টা করো (best-effort, না পেলে জোর করে অনুমান কোরো না):
   — কোনো option-এর পাশে টিক (✓), গোল দাগ, বোল্ড/আন্ডারলাইন, বা "Ans:"/"উত্তর:" জাতীয় ইনলাইন চিহ্ন থাকলে সেটাই সঠিক উত্তর।
   — অথবা এই একই পাতায় নিচের দিকে/আলাদা একটা "উত্তরমালা" বা "Answer Key" সেকশন/টেবিল থাকতে পারে (যেমন "১.ক ২.গ ৩.খ ৪.ঘ..." বা টেবিল ফরম্যাটে) — থাকলে প্রশ্ন-নম্বর মিলিয়ে সেই অনুযায়ী কোন option (ক/খ/গ/ঘ) সঠিক সেটা বের করে সেই option-এর পুরো টেক্সটটাই "correct"-এ বসাও (letter না, পুরো option-টেক্সট)।
   — এই পাতায় উত্তরের কোনো ইঙ্গিতই না থাকলে (উত্তরমালা অন্য কোনো পাতায় থাকতে পারে, এই পাতায় নেই) "correct":"" খালি রাখো — অনুমান করে ভুল উত্তর বসিও না, এটা পরে অ্যাডমিন ম্যানুয়ালি ঠিক করবে।
৪. ছবির কোণায় ফোন/ক্যামেরা অ্যাপ নিজে থেকে যা বসিয়ে দেয় (মডেল নাম, মালিকের নাম, তারিখ/সময় স্ট্যাম্প) — এগুলো সম্পূর্ণ উপেক্ষা করো।
৫. (গুরুত্বপূর্ণ, best-effort) — সেকশন-হেডিং (যেমন "গণিত-১৫", "সাধারণ জ্ঞান-১৫", "বাংলা-২৫", "ইংরেজি-২৫", "বিজ্ঞান-১০") থাকলে top-level "sectionSubject"-এ দাও, সবসময় এই ৫টার একটাতে normalize করে: "বাংলা", "ইংরেজি", "গণিত", "বিজ্ঞান", "সাধারণ জ্ঞান" (কম্পিউটার/আইসিটি সহ)। নতুন heading না থাকলে "sectionSubject":"" রাখো — আগের পাতারটাই চলতে থাকবে।
৬. (ঐচ্ছিক) — কোনো নির্দিষ্ট প্রশ্নের ঠিক আগে আলাদা sub-heading থাকলে সেটা সেই entry-র "subject" ফিল্ডে দাও (sectionSubject override করবে), নাহলে "subject":"" রাখো।
${OCR_CORRECTION_RULES}

শুধু নিচের বিশুদ্ধ JSON ফরম্যাটে উত্তর দাও — কোনো markdown code fence (\`\`\`), কোনো ব্যাখ্যা, কোনো অতিরিক্ত টেক্সট ছাড়া:
{"designation":"...","institution":"...","year":"...","sectionSubject":"...","entries":[{"q":"...","opt1":"...","opt2":"...","opt3":"...","opt4":"...","correct":"...","subject":"..."}]}

RULES:
- Serial number বাদ দাও
- প্রতিটা string-এর ভেতরে দরকার হলে সঠিকভাবে escape (\\") করো, যাতে JSON valid থাকে
- পাতা নম্বর, বিজ্ঞাপন, প্রমোশনাল টেক্সট বাদ দাও
- কোনো প্রশ্ন বাদ দিও না, ৪টা option-ের যেকোনো একটা না পড়া গেলেও যতটুকু পড়া যায় তা দিয়ে entry বানাও (খালি রেখো না বাদ দিয়ো না)

=== OCR TEXT ===
${ocrText}`;
}

/* ── AI response (MCQ) → {designation, institution, year, sectionSubject, entries:[{q,opt1-4,correct,subject}]} ── */
function parseDetectResponseMCQ(text){
  let t=(text||"").trim();
  t=t.replace(/^```json/i,"").replace(/^```/,"").replace(/```$/,"").trim();
  const start=t.indexOf("{"), end=t.lastIndexOf("}");
  if(start===-1||end===-1) throw new Error("JSON পাওয়া যায়নি — AI response format ঠিক নেই");
  const obj=JSON.parse(t.slice(start,end+1));
  const designation=(obj.designation||"").toString().trim();
  const institution=(obj.institution||"").toString().trim();
  const year=(obj.year||"").toString().trim().replace(/[^\d]/g,"").slice(0,4);
  const sectionSubject=(obj.sectionSubject||"").toString().trim();
  const entries=Array.isArray(obj.entries)
    ?obj.entries.filter(e=>e&&e.q).map(e=>({
        q:String(e.q).trim(),
        opt1:(e.opt1||"").toString().trim(), opt2:(e.opt2||"").toString().trim(),
        opt3:(e.opt3||"").toString().trim(), opt4:(e.opt4||"").toString().trim(),
        correct:(e.correct||"").toString().trim(),
        subject:(e.subject||"").toString().trim(),
      })).filter(e=>e.q&&e.opt1&&e.opt2) // অন্তত q + ২টা option না থাকলে ভাঙা entry, বাদ
    :[];
  return{designation,institution,year,sectionSubject,entries};
}

function MultiSubjectImportPage({push}){
  // images: [{id,webPath,base64,status,designation,institution,entryCount,error,groupBreak}]
  // (designation/institution এখানে শুধু ছবি-কার্ডে preview দেখানোর জন্য — draftGroups-এ
  // এগুলো এখন সঠিক নামে post/institution/year হিসেবে থাকে, Subject আলাদা ফিল্ড)
  // groupBreak=true মানে "এই ছবি থেকে নতুন group শুরু" (ইউজার নিজে মার্ক করে) — index 0 সবসময় group শুরু (মার্ক ছাড়াই)
  const[images,setImages]=useState([]);
  const[phase,setPhase]=useState("idle"); // idle | processing | confirm | done
  const[progress,setProgress]=useState({cur:0,total:0});
  const[showApiSettings,setShowApiSettings]=useState(false);
  const[targetMode,setTargetMode]=useState("Quiz"); // Quiz | QBank
  // ── প্রশ্নের ধরন — Written নাকি MCQ, এটা Gallery/Camera খোলার *আগেই* বেছে নিতে হয়
  // (ব্যবহারকারীর explicit চাওয়া অনুযায়ী) — কারণ OCR parsing prompt, sanitize লজিক
  // (ক/খ/গ/ঘ split — MCQ-তে এগুলোই আসল option, split করলে ভেঙে যাবে), আর সাবমিট schema
  // তিনটাই ভিন্ন এই দুই মোডে। null মানে এখনো বাছাই হয়নি, তাই ছবি তোলা/নেওয়া বন্ধ থাকবে। ──
  const[qType,setQType]=useState(null); // null | "Written" | "MCQ"
  const[saveLoc,setSaveLoc]=useState(loadSaveLocPref);
  const setSaveLocP=(v)=>{ setSaveLoc(v); saveSaveLocPref(v); };
  const[gasSecret,setGasSecret]=useState(loadSharedGasSecret);
  const setGasSecretP=(v)=>{ setGasSecret(v); saveSharedGasSecret(v); };
  const[draftGroups,setDraftGroups]=useState([]); // [{id,subject,subtopic,rows:[{q,correct}],pages:[n],included}]
  const[result,setResult]=useState(null); // {added,skipped,failed,groupCount}

  /* ── Subjects/Topics রেফারেন্স টেবিল — Submit-এর আগে প্রতিটা group-এর subject/subtopic
     টেক্সট থেকে subject_id/topic_id বের করতে লাগে (raw text sheet-এ যায় না, QBank-এ তো
     plain "subject" কলামই নেই) ── */
  const[refData,setRefData]=useState(null);
  useEffect(()=>{ fetchReferenceData({gasSecret}).then(setRefData).catch(()=>{}); },[gasSecret]);
  const subjectOptions=refData?(refData.subjects||[]).filter(s=>s.sheet===targetMode):[];

  /* ── QBank-এ পদ/প্রতিষ্ঠান/সাল (Exam Appearance) — ঐচ্ছিক, দিলে এই পুরো ব্যাচ একটা
     Exam_Appearances এন্ট্রি পাবে। QBank প্রশ্ন user app-এ appearance দিয়ে ব্রাউজ হয়,
     তাই এটা ছাড়া QBank-এ প্রশ্ন যোগ হলেও exam-appearance browse-এ দেখা যাবে না। ── */
  const[postSel,setPostSel]=useState({id:"",name:""});
  const[instSel,setInstSel]=useState({id:"",name:""});
  const[examYear,setExamYear]=useState("");
  const postOptions=refData?(refData.posts||[]).map(p=>({id:p.post_id,name:p.post_name})):[];
  const instOptions=refData?(refData.institutions||[]).map(i=>({id:i.institution_id,name:i.institution_name})):[];
  const[submitting,setSubmitting]=useState(false);
  const stopRef=useRef(false);

  /* ── Long-press → বড় প্রিভিউ (হেডিং পড়ে বুঝে grouping সহজ করার জন্য) ── */
  const LONG_PRESS_MS=1500;
  const[previewId,setPreviewId]=useState(null);
  const[previewVisible,setPreviewVisible]=useState(false);
  const longPressTimerRef=useRef(null);
  const hideTimerRef=useRef(null);
  const startLongPress=(id)=>{
    clearTimeout(longPressTimerRef.current);
    clearTimeout(hideTimerRef.current);
    longPressTimerRef.current=setTimeout(()=>{
      setPreviewId(id);
      requestAnimationFrame(()=>requestAnimationFrame(()=>setPreviewVisible(true)));
    },LONG_PRESS_MS);
  };
  const cancelLongPress=()=>{
    clearTimeout(longPressTimerRef.current);
    setPreviewVisible(false);
    clearTimeout(hideTimerRef.current);
    hideTimerRef.current=setTimeout(()=>setPreviewId(null),220);
  };
  const openPreviewNow=(id)=>{ // এক-ট্যাপে সাথে সাথেই বড় প্রিভিউ (৩ সেকেন্ড অপেক্ষা লাগে না) — group confirm-এ পাতা পড়ার জন্য
    clearTimeout(longPressTimerRef.current);
    clearTimeout(hideTimerRef.current);
    setPreviewId(id);
    requestAnimationFrame(()=>requestAnimationFrame(()=>setPreviewVisible(true)));
  };
  const closePreviewNow=()=>cancelLongPress();

  /* ── Gallery/Camera picker (AIImportPage-এর একই লজিক, স্বনির্ভর কপি) ── */
  const _getCamera=()=>{
    const P=window.Capacitor?.Plugins||{};
    const cam=P.Camera||P.CameraPlugin||P["@capacitor/camera"]||null;
    if(!cam){
      const available=Object.keys(P).join(", ")||"(none)";
      _LC.error("camera",`Camera plugin not found. Available plugins: ${available}`);
      push("error","Available Plugins:",available||"(none)");
    }
    return cam;
  };
  const _ensureMediaPermission=async()=>{
    try{
      const Camera=_getCamera();
      if(!Camera) return true;
      const perm=await Camera.checkPermissions();
      if(perm?.photos==="granted"||perm?.photos==="limited") return true;
      const req=await Camera.requestPermissions({permissions:["photos","camera"]});
      if(req?.photos==="denied"||req?.photos==="permanently_denied"){
        push("error","Permission denied","Settings থেকে Photos permission দিন");
        return false;
      }
      return true;
    }catch(e){ return true; }
  };
  const pickGallery=async()=>{
    try{
      const allowed=await _ensureMediaPermission();
      if(!allowed) return;
      const{GalleryPicker}=window.Capacitor?.Plugins||{};
      if(GalleryPicker){
        const res=await GalleryPicker.pickImages();
        // ── নেটিভ প্লাগিন এখন base64 না পাঠিয়ে cache ফাইল-পাথ পাঠায় (bridge payload ছোট রাখতে,
        //    বাল্ক সিলেক্টে বড় base64 payload-ই ক্র্যাশের মূল কারণ ছিল) — convertFileSrc দিয়ে
        //    সেই পাথকে <img src>-এ ব্যবহারযোগ্য URL বানানো হয় ──
        const imgs=(res.photos||[]).map(p=>{
          const webPath=p.path
            ?(window.Capacitor?.convertFileSrc?.(p.path)||`file://${p.path}`)
            :(p.base64String?`data:image/jpeg;base64,${p.base64String}`:""); // পুরনো plugin build ফলব্যাক
          return{
            webPath,base64:"",status:"pending",
            designation:"",institution:"",entryCount:0,error:"",groupBreak:false,id:Date.now()+Math.random(),thumb:null
          };
        }).filter(x=>x.webPath);
        setImages(p=>[...p,...imgs]);
        attachThumbnails(imgs);
        return;
      }
      const Camera=_getCamera();
      if(!Camera){ push("warn","Camera plugin নেই","Logcat দেখুন"); return; }
      const res=await Camera.pickImages({quality:90,limit:0});
      const imgs=(res.photos||[]).map(p=>({
        webPath:p.webPath,base64:"",status:"pending",
        designation:"",institution:"",entryCount:0,error:"",groupBreak:false,id:Date.now()+Math.random(),thumb:null
      }));
      setImages(p=>[...p,...imgs]);
      attachThumbnails(imgs);
    }catch(e){
      if(e.message==="cancelled")return;
      push("error","Gallery error",e.message);
    }
  };
  const openCamera=async()=>{
    try{
      const Camera=_getCamera();
      if(!Camera){push("warn","Camera plugin নেই","Logcat দেখুন");return;}
      const allowed=await _ensureMediaPermission();
      if(!allowed) return;
      const res=await Camera.getPhoto({quality:90,resultType:"base64",source:"CAMERA"});
      const raw=res.base64String||"";
      if(!raw){ push("error","Camera error","ছবি পাওয়া যায়নি"); return; }
      // ── @capacitor/camera-এর ছবি GalleryPicker-এর মতো নেটিভভাবে ডাউনস্কেল হয় না (আসল ফোন-রেজোলিউশনে,
      //    অনেক ফোনে ৪০০০px+ আসতে পারে) — এটাই সবচেয়ে বড় মেমরি-ক্র্যাশের ঝুঁকি ছিল, তাই এখানেই ২০০০px-এ
      //    client-side ডাউনস্কেল করে নিচ্ছি (GalleryPickerPlugin-এর MAX_DIM-এর সমতুল্য) ──
      const downsized=await downscaleImageSrc(`data:image/jpeg;base64,${raw}`,2000,0.9);
      const b64only=downsized.startsWith("data:")?downsized.split(",")[1]:raw;
      const objUrl=await dataUrlToObjectUrl(downsized.startsWith("data:")?downsized:`data:image/jpeg;base64,${b64only}`);
      const newImg={webPath:objUrl||"",base64:b64only,status:"pending",
        designation:"",institution:"",entryCount:0,error:"",groupBreak:false,id:Date.now(),thumb:null};
      setImages(p=>[...p,newImg]);
      attachThumbnails([newImg]);
    }catch(e){
      if(!e.message?.includes("cancelled")) push("error","Camera error",e.message);
    }
  };
  /* ছবি যোগ হওয়ার পরপরই প্রতিটার জন্য ছোট থাম্বনেইল বানিয়ে state আপডেট করে —
     ── আসল বাকি-থাকা bug এখানেই ছিল ──
     আগে imgs.forEach(...) ব্যবহার করায় ব্যাচের সব ছবির থাম্বনেইল একসাথে
     সমান্তরালে (parallel) জেনারেট হচ্ছিল — মানে ৩০টা ছবি সিলেক্ট করলে ৩০টা
     full-resolution (~২০০০px) ছবি একই মুহূর্তে ডিকোড হতে যাচ্ছিল, যা একটা
     নির্দিষ্ট সংখ্যার পর (ডিভাইসভেদে) মেমরি স্পাইক করে ক্র্যাশ করাচ্ছিল।
     এখন একটার পর একটা (sequential, await দিয়ে) প্রসেস করা হয় — একসাথে
     সর্বোচ্চ ১টা ফুল-রেজ ছবিই মেমরিতে ডিকোড থাকে, সংখ্যা যতই হোক না কেন। */
  const attachThumbnails=(imgs)=>{
    (async()=>{
      for(const im of imgs){
        const fullSrc=im.webPath||(im.base64?`data:image/jpeg;base64,${im.base64}`:null);
        if(!fullSrc)continue;
        const t=await makeThumbnail(fullSrc);
        setImages(p=>p.map(x=>x.id===im.id?{...x,thumb:t}:x));
      }
    })();
  };
  const removeImg=(id)=>setImages(p=>{
    const rm=p.find(x=>x.id===id);
    if(rm)revokeIfObjectUrl(rm.webPath);
    return p.filter(x=>x.id!==id);
  });
  const moveImg=(id,dir)=>setImages(p=>{
    const i=p.findIndex(x=>x.id===id);
    const j=i+dir;
    if(i<0||j<0||j>=p.length)return p;
    const copy=[...p];
    [copy[i],copy[j]]=[copy[j],copy[i]];
    return copy;
  });
  const toggleGroupBreak=(id)=>setImages(p=>p.map(x=>x.id===id?{...x,groupBreak:!x.groupBreak}:x));
  const clearAll=()=>{ images.forEach(x=>revokeIfObjectUrl(x.webPath)); setImages([]); setResult(null); setDraftGroups([]); setPhase("idle"); };

  /* ── webPath → base64 (2-side landscape page split আগের মতোই) ── */
  const toBase64=async(img)=>{
    if(img.base64)return img.base64;
    return new Promise((res,rej)=>{
      const canvas=document.createElement("canvas");
      const image=new Image();
      image.onload=()=>{
        const W=image.naturalWidth, H=image.naturalHeight;
        if(W>H*1.4){
          const half=Math.floor(W/2);
          canvas.width=half; canvas.height=H;
          const ctx=canvas.getContext("2d");
          ctx.drawImage(image,0,0,half,H,0,0,half,H);
          const left=canvas.toDataURL("image/jpeg",0.9).split(",")[1];
          ctx.clearRect(0,0,half,H);
          ctx.drawImage(image,half,0,W-half,H,0,0,W-half,H);
          canvas.width=W-half;
          const right=canvas.toDataURL("image/jpeg",0.9).split(",")[1];
          res([left,right]);
        } else {
          canvas.width=W; canvas.height=H;
          canvas.getContext("2d").drawImage(image,0,0);
          res(canvas.toDataURL("image/jpeg",0.9).split(",")[1]);
        }
      };
      image.onerror=()=>rej(new Error("Image load failed"));
      image.src=img.webPath;
    });
  };

  /* ── Native ML Kit OCR (শুধু raw text — parse এখানে AI দিয়ে হবে) ── */
  const nativeOcr=async(b64)=>{
    const{OcrPlugin}=window.Capacitor?.Plugins||{};
    if(!OcrPlugin){
      const available=Object.keys(window.Capacitor?.Plugins||{}).join(", ")||"(none)";
      _LC.crash("OcrPlugin",`OcrPlugin missing. Available: ${available}`,{available});
      throw new Error("OcrPlugin নেই — APK rebuild করুন");
    }
    const res=await OcrPlugin.recognizeText({base64:b64});
    return res.text||"";
  };

  /* ── একটা page-unit (base64) প্রসেস করে {designation,institution,year,entries} রিটার্ন করে, ক্যাশসহ ──
     ক্যাশ base64+CACHE_QTYPE দিয়ে key হয় — grouping বদলালেও (✂️ টগল) একই ছবি আবার AI call করতে হয় না */
  const detectAndParsePage=async(b64)=>{
    const cacheKey=qType==="MCQ"?"MultiSubjectMCQ":CACHE_QTYPE;
    const cached=getOcrCacheEntry(b64,cacheKey);
    if(cached){
      _LC.log("MultiSubjectImport","📦 ক্যাশ হিট — AI call এড়ানো হলো");
      return{...cached.detected,archiveId:cached.archiveId||null,raw:cached.raw||""};
    }
    const raw=await nativeOcr(b64);
    if(!raw.trim()) return{designation:"",institution:"",year:"",entries:[],archiveId:null,raw:""};
    const isMcq=qType==="MCQ";
    const aiText=await callAiProviderRotatingRaw(isMcq?buildDetectPromptMCQ(raw):buildDetectPrompt(raw));
    const detected=isMcq?parseDetectResponseMCQ(aiText):parseDetectResponse(aiText);
    let archiveId=null;
    if(detected.entries.length){
      // 🐛 ফিক্স: আগে এখানে designation/institution-কে ভুল subject/sub_topic হিসেবে ধরে
      // group-এ বসতো। এখানে archiveStore-এর generic subject/subtopic প্যারামিটার নামেই
      // পাঠাতে হয় (আর্কাইভের স্টোরেজ স্কিমা এটাই), কিন্তু আসলে এখানে post/institution বসছে —
      // ArchivePage-এ এই এন্ট্রি রি-সাবমিট করার সময় এটাই দেখাবে "Subject/Sub-topic" হিসেবে।
      const arc=archiveAdd({
        source:SRC_NAME,subject:detected.designation,subtopic:detected.institution,qtype:isMcq?"MCQ":"Written",
        rows:isMcq
          ?detected.entries.map(e=>({q:e.q,opt1:e.opt1,opt2:e.opt2,opt3:e.opt3,opt4:e.opt4,correct:e.correct}))
          :detected.entries.map(e=>({q:e.q,correct:e.a}))
      });
      if(arc) archiveId=arc.id;
    }
    setOcrCacheEntry(b64,cacheKey,{raw,detected,archiveId});
    return{...detected,archiveId,raw};
  };


  /* ── ধাপ ১: সব ছবি OCR+Detect+Parse করে draftGroups বানায় — কোনো সাবমিট হয় না, শুধু Confirm স্ক্রিনে নিয়ে যায় ──
     🐛 ফিক্স: আগে AI-এর detect করা designation/institution ভুলভাবে group.subject/group.subtopic-এ বসতো
     (Reference/Post/Institution সিস্টেম আসার আগের পুরনো ডিজাইন)। এখন designation/institution ঠিকভাবে
     group.post/group.institution-এ বসে (QBank-এ Exam Appearance-এর জন্য), আর group.subject/group.subtopic
     এখন আসল একাডেমিক বিষয়/টপিকের জন্য — AI যদি per-entry subject ধরতে পারে সেটা ব্যবহার হয়, নাহলে
     অ্যাডমিন এখানে সহজ একটা "fallback subject" টাইপ করে দেবে (নিচের Confirm UI-তে)। ── */
  const processImages=async()=>{
    if(!qType){push("warn","আগে Written/MCQ বেছে নাও","");return;}
    if(!images.length){push("warn","ছবি যোগ করুন","");return;}
    if(!buildKeyPool().length){push("warn","⚠️ কোনো AI provider active নেই","⚙️ থেকে অন্তত একটা key active করো");return;}
    setPhase("processing"); stopRef.current=false; setResult(null); setDraftGroups([]);
    setImages(p=>p.map(x=>({...x,status:"pending",designation:"",institution:"",entryCount:0,error:"",rawOcr:""})));
    // পুরো OCR+AI detection লুপটাও _BGM.guard দিয়ে মোড়ানো — অনেকগুলো ছবি হলে সময় লাগে,
    // স্ক্রিন লক/মিনিমাইজ করলেও যেন কাজ থেমে না যায়
    await _BGM.guard(async()=>{

    // ── প্রতিটা ছবিকে base64 unit-এ ভাঙা হয় (landscape হলে ২টা পাতা); manual group-break শুধু ছবির প্রথম unit-এ প্রযোজ্য ──
    const units=[]; // {imgId, base64, isImgFirstPart, manualBreak}
    for(const img of images){
      try{
        const b64raw=await toBase64(img);
        const parts=Array.isArray(b64raw)?b64raw:[b64raw];
        parts.forEach((p,pi)=>units.push({imgId:img.id,base64:p,manualBreak:pi===0&&img.groupBreak}));
      }catch(e){
        setImages(p=>p.map(x=>x.id===img.id?{...x,status:"error",error:e.message}:x));
      }
    }
    const imgIndexOf={}; images.forEach((im,idx)=>{imgIndexOf[im.id]=idx+1;});

    let curPost="", curInstitution="", curYear="", curSectionSubject="";
    let gid=-1;
    const groups=[]; // local working array
    setProgress({cur:0,total:units.length});

    for(let i=0;i<units.length;i++){
      if(stopRef.current)break;
      const unit=units[i];
      setProgress({cur:i+1,total:units.length});
      // group boundary: প্রথম unit সবসময় নতুন group, বা ইউজার-মার্কড manualBreak
      if(gid===-1||unit.manualBreak){
        gid++;
        curPost=""; curInstitution=""; curYear=""; curSectionSubject="";
        groups.push({id:gid,post:postSel.name.trim(),institution:instSel.name.trim(),year:examYear.trim(),subject:"",subtopic:"",rows:[],pages:[],included:true,archiveIds:[]});
      }
      setImages(p=>p.map(x=>x.id===unit.imgId&&x.status!=="error"?{...x,status:"running"}:x));
      try{
        const detected=await detectAndParsePage(unit.base64);
        if(detected.designation) curPost=detected.designation;
        if(detected.institution) curInstitution=detected.institution;
        if(detected.year) curYear=detected.year;
        // ── 🐛 এই ফিচার (তোমার প্রশ্নের উত্তর): "গণিত-১৫"/"সাধারণ জ্ঞান-১৫" জাতীয়
        // সেকশন-হেডিং সাধারণত শুধু সেই সেকশনের প্রথম পাতাতেই লেখা থাকে, পরের পাতাগুলোয়
        // থাকে না — তাই designation/institution-এর মতোই carry-forward করা হচ্ছে: নতুন
        // sectionSubject পাওয়া গেলে আপডেট হয়, না পেলে আগেরটাই (একই সেকশনের বাকি
        // পাতা ধরে) চলতে থাকে। ──
        if(detected.sectionSubject) curSectionSubject=detected.sectionSubject;
        const grp=groups[gid];
        // AI যা পেয়েছে সেটাকেই প্রাধান্য দেওয়া হয় — শুধু ব্যাচের ডিফল্ট (seed) না পেলে সেটা থেকে যায়
        if(curPost) grp.post=curPost;
        if(curInstitution) grp.institution=curInstitution;
        if(curYear) grp.year=curYear;
        // ── AI যতই বলুক, এখানে আবার নিশ্চিত করে নিচ্ছি: Written হলে বান্ডিল উত্তর split +
        // watermark noise বাদ; MCQ হলে split হয় না (ক/খ/গ/ঘ আসল option, sub-question না) ──
        const cleanEntries=qType==="MCQ"?sanitizeEntriesMCQ(detected.entries):sanitizeEntries(detected.entries);
        cleanEntries.forEach(e=>grp.rows.push(
          qType==="MCQ"
            ?{q:e.q,opt1:e.opt1,opt2:e.opt2,opt3:e.opt3,opt4:e.opt4,correct:e.correct,subject:e.subject||curSectionSubject||""}
            :{q:e.q,correct:e.a,subject:e.subject||curSectionSubject||""}
        ));
        if(detected.archiveId&&!grp.archiveIds.includes(detected.archiveId)) grp.archiveIds.push(detected.archiveId);
        const pageNo=imgIndexOf[unit.imgId];
        if(pageNo&&!grp.pages.includes(pageNo)) grp.pages.push(pageNo);

        setImages(p=>p.map(x=>x.id===unit.imgId?{
          ...x,status:"done",
          designation:x.designation||curPost, institution:x.institution||curInstitution,
          entryCount:(x.entryCount||0)+cleanEntries.length,
          rawOcr:(x.rawOcr?x.rawOcr+"\n---\n":"")+(detected.raw||"(OCR টেক্সট খালি এসেছে — ছবিতে লেখা স্পষ্ট পড়া যায়নি)"),
        }:x));
      }catch(e){
        setImages(p=>p.map(x=>x.id===unit.imgId?{...x,status:"error",error:e.message}:x));
        _LC.warn("MultiSubjectImport",`Page detect/parse ব্যর্থ: ${e.message}`);
      }
    }

    const nonEmpty=groups.filter(g=>g.rows.length>0);
    if(!nonEmpty.length){
      setPhase("idle");
      push("warn","⚠️ কোনো প্রশ্ন পাওয়া যায়নি","ছবিগুলো ঠিকভাবে তোলা হয়েছে কিনা, বা AI key active আছে কিনা দেখুন");
      return;
    }
    setDraftGroups(nonEmpty);
    setPhase("confirm");

    },"OCR প্রসেস হচ্ছে…").catch(e=>{
      setPhase("idle");
      push("error","প্রসেসিং ব্যর্থ",String(e?.message||e||"unknown"));
    });
  };

  /* ── Confirm স্ক্রিনে group edit/exclude ── */
  const updateGroupField=(id,field,val)=>setDraftGroups(p=>p.map(g=>g.id===id?{...g,[field]:val}:g));
  const toggleGroupIncluded=(id)=>setDraftGroups(p=>p.map(g=>g.id===id?{...g,included:!g.included}:g));
  // ── MCQ-এর প্রতিটা প্রশ্নের option/correct ঠিক করার জন্য (OCR ভুল পড়া/answer-key
  // না-মেলা কমন, তাই এখানে row-লেভেল এডিট দরকার — Written-এ আগে থেকেই যা আছে তাতেই হয়) ──
  const updateRowField=(gid,rowIdx,field,val)=>setDraftGroups(p=>p.map(g=>g.id!==gid?g:{
    ...g,rows:g.rows.map((r,i)=>i===rowIdx?{...r,[field]:val}:r)
  }));
  const removeRow=(gid,rowIdx)=>setDraftGroups(p=>p.map(g=>g.id!==gid?g:{
    ...g,rows:g.rows.filter((_,i)=>i!==rowIdx)
  }));

  /* ── ধাপ ২: Confirm করার পর — সব included group একসাথে Sheet/Firebase-এ Submit ──
     পুরো কাজটা (ছবি আপলোড + সেভ) _BGM.guard দিয়ে মোড়ানো — এতে WakeLock + Android
     foreground service চালু হয়ে যায়, তাই স্ক্রিন লক করলে বা অ্যাপ মিনিমাইজ করলেও
     Submit থেমে যায় না বা Android কর্তৃক kill হয় না। ধরে বসে থাকার দরকার নেই —
     status bar-এ notification দেখাবে, শেষ হলে নিজে থেকেই সরে যাবে। ── */
  const confirmAndSubmit=async()=>{
    const included=draftGroups.filter(g=>g.included&&g.rows.length>0);
    if(!included.length){push("warn","⚠️ অন্তত একটা group রাখো","সব group বাদ দিলে সাবমিট করার কিছু নেই");return;}

    // ── 🐛 ফিক্স: আগে group.subject (fallback বক্স) ফাঁকা থাকলেই সেই group আটকে যেত —
    // even যদি প্রতিটা প্রশ্নেরই নিজস্ব AI-detected subject থাকতো (fallback তখন লাগেই না)।
    // এখন group তখনই আটকাবে যখন অন্তত একটা row-এর নিজস্ব subject নেই এবং fallback-ও ফাঁকা।
    // subjectCovered() — একই শর্ত UI (নিচে) আর submit-validation দুই জায়গাতেই ব্যবহার হয়,
    // যাতে দুটো জায়গায় ভিন্ন ফলাফল না দেখায়। ──
    const subjectCovered=g=>g.subject.trim()||g.rows.every(r=>r.subject&&r.subject.trim());
    // ── MCQ mode-এ প্রতিটা প্রশ্নের সঠিক উত্তর বসানো না থাকলে সেই group ব্লক থাকবে —
    // নাহলে ফাঁকা "correct"-সহ প্রশ্ন Sheet-এ চলে যাবে, লাইভ কুইজে ভুল/ফাঁকা উত্তর দেখাবে ──
    const mcqCorrectCovered=g=>qType!=="MCQ"||g.rows.every(r=>r.correct&&r.correct.trim());
    const needsAppearance=targetMode==="QBank";
    const isGroupReady=g=>subjectCovered(g) && mcqCorrectCovered(g) && (!needsAppearance || (g.post.trim()&&g.institution.trim()&&g.year.trim()));
    const readyGroups=included.filter(isGroupReady);
    const blockedGroups=included.filter(g=>!isGroupReady(g));

    if(readyGroups.length===0){
      push("warn","⚠️ কোনো group-ই Submit হয়নি",
        (needsAppearance?"Subject/পদ/প্রতিষ্ঠান/সাল":"Subject")+(qType==="MCQ"?"/MCQ-এর সঠিক উত্তর":"")+" কোনো একটা ফাঁকা — আগে পূরণ করো");
      return;
    }
    if(blockedGroups.length>0){
      push("warn",`⚠️ ${blockedGroups.length}টা group বাদ পড়েছে`,
        (needsAppearance?"Subject/পদ/প্রতিষ্ঠান/সাল":"Subject")+(qType==="MCQ"?"/MCQ-এর সঠিক উত্তর":"")+" ফাঁকা — পূরণ করে আবার Submit চাপো, এখন শুধু বাকিগুলো যাচ্ছে");
    }

    if(!refData){push("warn","⏳ Reference data এখনো লোড হচ্ছে, একটু পর আবার চেষ্টা করো","");return;}

    setSubmitting(true);
    await _BGM.guard(async()=>{

    // ── Question Paper: প্রতিটা group-এর পাতার আসল ছবি(গুলো) imgbb-তে আপলোড করে লিংক জোগাড় করি —
    //    একই group-এর সব row-এ এই একই (কমা দিয়ে জোড়া) লিংক-স্ট্রিং বসবে, যাতে টেক্সটের পাশাপাশি
    //    আসল প্রশ্নপত্রের পাতাও (একাধিক পাতা হলে সবগুলোই) সবসময় থাকে। একটা পাতা আপলোড ব্যর্থ হলেও
    //    বাকি কাজ থেমে থাকে না (uploadImageSrcToImgbb ব্যর্থ হলে "" ফেরত দেয়)। ──
    const groupQpaper={};
    for(const g of readyGroups){
      const urls=[];
      for(const pn of (g.pages||[])){
        const im=imgByPageNo(pn);
        const src=im&&(im.webPath||(im.base64?`data:image/jpeg;base64,${im.base64}`:null));
        if(!src)continue;
        const url=await uploadImageSrcToImgbb(src);
        if(url)urls.push(url);
      }
      groupQpaper[g.id]=urls.join(",");
    }

    // ── 🐛 ফিক্স: প্রতিটা group ভিন্ন ভিন্ন পরীক্ষা (পদ/প্রতিষ্ঠান/সাল) থেকে হতে পারে,
    // তাই আগের মতো একটামাত্র ব্যাচ-ওয়াইড examAppearance দিয়ে হবে না — প্রতিটা group-এর
    // জন্য আলাদা saveRowsToSheet কল হয়, নিজের পদ/প্রতিষ্ঠান/সাল দিয়ে। ফলাফলগুলো একসাথে
    // যোগ করে শেষে একটা সামারি দেখানো হয়। ──
    let totalAdded=0, totalSkipped=0, totalFailed=[], totalLinkedExisting=0;
    const submittedGroupIds=[];
    for(const g of readyGroups){
      let examAppearance=null;
      if(needsAppearance){
        const postRes=await resolveOrCreateReference({sel:{id:"",name:g.post.trim()},refType:"posts",options:postOptions,gasSecret,push});
        if(!postRes.ok){ push("error",`❌ "${g.post}" পদ যোগ/খুঁজে পাওয়া যায়নি`,"এই group বাদ পড়লো, বাকিগুলো চলছে"); continue; }
        const instRes=await resolveOrCreateReference({sel:{id:"",name:g.institution.trim()},refType:"institutions",options:instOptions,gasSecret,push});
        if(!instRes.ok){ push("error",`❌ "${g.institution}" প্রতিষ্ঠান যোগ/খুঁজে পাওয়া যায়নি`,"এই group বাদ পড়লো, বাকিগুলো চলছে"); continue; }
        examAppearance={postId:postRes.id,institutionId:instRes.id,year:g.year.trim()};
        if(postRes.created||instRes.created) fetchReferenceData({gasSecret}).then(setRefData).catch(()=>{});
      }

      const subject=g.subject.trim();
      const topicOverride=g.subtopic.trim(); // "Topic (ঐচ্ছিক)" বক্স — শুধু explicit override
      const mainQpaper=groupQpaper[g.id]||"";
      // ── 🐛 ফিক্স: আগে topic সবসময় group-fallback-এর ওপর নির্ভরশীল ছিল — group.subject
      // ফাঁকা থাকলে (row-গুলোর নিজস্ব subject থাকা সত্ত্বেও) topic-ও ফাঁকা থেকে যেত, পুরো
      // group বাতিল হয়ে যেত। এখন প্রতিটা row-এর subject (নিজের অথবা group fallback থেকে)
      // আগে ঠিক হয়, তারপর topic = explicit override, নাহলে সেই row-এর subject-ই (একই নিয়ম
      // যা placeholder-এ লেখা: "খালি রাখলে Subject-ই বসবে") — group.subject খালি থাকলেও কাজ করে। ──
      const entries=g.rows.map(r=>{
        const rowSubject=((r.subject&&r.subject.trim())||subject).trim();
        const rowTopic=topicOverride||rowSubject;
        return qType==="MCQ"
          ?{q:r.q,opt1:r.opt1,opt2:r.opt2,opt3:r.opt3,opt4:r.opt4,correct:r.correct,subject:rowSubject,topic:rowTopic,mainQpaper}
          :{q:r.q,correct:r.correct,subject:rowSubject,topic:rowTopic,mainQpaper};
      });

      const resolveResult=await resolveSubjectTopicForEntries({
        entries, subjectOptions, topicsAll:refData?.topics||[], gasSecret, sheet:targetMode, push,
        fallbackSubject:subject, fallbackTopic:topicOverride||subject,
      });
      if(!resolveResult.ok){ push("error",`❌ "${subject||"(subject-less group)"}" গ্রুপে সমস্যা: `+resolveResult.reason,""); continue; }
      if(resolveResult.anyCreated) fetchReferenceData({gasSecret}).then(setRefData).catch(()=>{});

      // NO-FIREBASE POLICY: Quiz/QBank/Study/Typing এখন শুধু Google Sheet-এ যায় (GAS দিয়ে),
      // Firebase-এ সরাসরি লেখার পুরনো পথটা ইচ্ছাকৃতভাবে সরানো হয়েছে।
      const rows=resolveResult.resolved.map(({item,subjectId,topicId,subjectName,topicName})=>buildSheetRow({
        item:qType==="MCQ"
          ?{q:item.q,opt1:item.opt1,opt2:item.opt2,opt3:item.opt3,opt4:item.opt4,correct:item.correct,explanation:""}
          :{q:item.q,correct:item.correct,explanation:""},
        subject:subjectName,subtopic:topicName,qtype:qType||"Written",audienceTags:[],
        subjectId,topicId,mainQpaper:item.mainQpaper,
      }));
      const res=await saveRowsToSheet({rows,targetTab:targetMode,gasSecret,push,examAppearance});
      totalAdded+=res.added||0; totalSkipped+=res.skipped||0;
      totalLinkedExisting+=res.examAppearancesLinkedToExisting||0;
      if(res.failedRows.length) totalFailed=totalFailed.concat(res.failedRows);
      if(res.added>0||res.skipped>0) submittedGroupIds.push(g.id);
    }

    if(totalFailed.length) pushFailedItems(SRC_NAME,"sheet",targetMode,totalFailed);
    setResult({added:totalAdded,skipped:totalSkipped,failed:totalFailed.length,groupCount:submittedGroupIds.length});
    setSubmitting(false);
    // ── যেসব group সফলভাবে Submit হলো, শুধু ওগুলোই লিস্ট থেকে সরাও — ফাঁকা/ব্যর্থ group-গুলো
    //    Confirm স্ক্রিনেই থেকে যাবে, পূরণ/ঠিক করে আবার Submit চাপার জন্য ──
    const doneIds=new Set(submittedGroupIds);
    setDraftGroups(p=>p.filter(g=>!doneIds.has(g.id)));
    setPhase((blockedGroups.length>0||doneIds.size<readyGroups.length)?"confirm":"done");
    if(totalAdded>0) push("success",`✅ ${totalAdded}টি Sheet-এ যোগ হয়েছে!`,
      `${submittedGroupIds.length}টি group`+(totalSkipped?`, ${totalSkipped}টা duplicate বাদ পড়েছে`:""));
    // 🐛 ফিক্স: duplicate QBank প্রশ্ন পেলেও এখন appearance হারায় না — বিদ্যমান প্রশ্নের
    // সাথেই জুড়ে যায় (BulkUploaderPage-এর মতোই, GAS-এর bulk_save_rows-এর একই ফিক্স)।
    if(totalLinkedExisting>0) push("success",`🔗 ${totalLinkedExisting}টা প্রশ্ন আগে থেকেই QBank-এ ছিল`,"নতুন করে যোগ হয়নি — শুধু এই পদ/প্রতিষ্ঠান/সালের Appearance জুড়ে দেওয়া হয়েছে");
    if(totalFailed.length) push("error",`${totalFailed.length}টি ব্যর্থ হয়েছে`,"নিচে ক্যাশ থেকে আবার পাঠানো যাবে");
    if(totalAdded>0||totalSkipped>0){
      const ids=readyGroups.filter(g=>doneIds.has(g.id)).flatMap(g=>g.archiveIds||[]);
      if(ids.length) archiveDeleteMany(ids);
    }

    },"OCR প্রশ্ন Submit হচ্ছে…").catch(e=>{
      setSubmitting(false);
      push("error","Submit ব্যর্থ",String(e?.message||e||"unknown"));
    });
  };

  const backToEdit=()=>{ setPhase("idle"); }; // ছবি/গ্রুপ-ব্রেক ঠিক করে আবার Process করা যাবে — cache থাকায় দ্রুত হবে
  const startOver=()=>{ images.forEach(x=>revokeIfObjectUrl(x.webPath)); setImages([]); setDraftGroups([]); setResult(null); setPhase("idle"); };

  const[expandedGroupId,setExpandedGroupId]=useState(null); // Confirm স্ক্রিনে কোন group-এর পাতার ছবি দেখানো হচ্ছে
  const toggleGroupImages=(gid)=>setExpandedGroupId(p=>p===gid?null:gid);
  const[rawTextGroupId,setRawTextGroupId]=useState(null); // কোন group-এর raw OCR টেক্সট দেখানো হচ্ছে (ডায়াগনস্টিক)
  const toggleGroupRawText=(gid)=>setRawTextGroupId(p=>p===gid?null:gid);
  // ── কোন group-এর প্রশ্ন-লিস্ট (option/correct এডিট UI) খোলা আছে — MCQ-তে OCR
  // ভুল পড়া/answer-key ভুল মেলা কমন বলে এটা দরকার, Written-এও Q/উত্তর টেক্সট
  // ঠিক করার সুযোগ দেয় ──
  const[rowsOpenGroupId,setRowsOpenGroupId]=useState(null);
  const toggleGroupRows=(gid)=>setRowsOpenGroupId(p=>p===gid?null:gid);
  const imgByPageNo=(n)=>images[n-1]; // pages array 1-based (images grid index অনুযায়ী)

  const pct=progress.total?Math.round(progress.cur/progress.total*100):0;
  const totalIncludedQ=draftGroups.filter(g=>g.included).reduce((s,g)=>s+g.rows.length,0);
  const totalIncludedG=draftGroups.filter(g=>g.included).length;

  return(
    <div className="page">
      {/* অনেকগুলো ছবি একসাথে থাকলে scroll position বোঝা যায় না — তাই দৃশ্যমান স্ক্রলবার */}
      <style>{`
        .ss-scroll{scrollbar-width:thin;scrollbar-color:#6366f1 #0a1628;}
        .ss-scroll::-webkit-scrollbar{width:8px;}
        .ss-scroll::-webkit-scrollbar-track{background:#0a1628;border-radius:10px;}
        .ss-scroll::-webkit-scrollbar-thumb{background:#6366f1;border-radius:10px;}
        .ss-scroll::-webkit-scrollbar-thumb:hover{background:#818cf8;}
      `}</style>
      {/* Header */}
      <div style={{background:"linear-gradient(135deg,#0891b2,#4f46e5)",borderRadius:14,padding:"14px 16px",marginBottom:14,color:"#fff",position:"relative"}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
          <div>
            <div style={{fontWeight:900,fontSize:15,marginBottom:2}}>🗂️ Multi-Subject Bulk Import (Written)</div>
            <div style={{fontSize:11,opacity:.8}}>
              {buildKeyPool().length
                ? `✅ ${buildKeyPool().length}টা key রেডি (rotation)`
                : "⚠️ কোনো API key active নেই — ⚙️ দিন"}
            </div>
          </div>
          <button onClick={()=>setShowApiSettings(v=>!v)}
            style={{background:"rgba(255,255,255,0.15)",border:"1px solid rgba(255,255,255,0.3)",
              borderRadius:10,color:"#fff",fontSize:20,width:40,height:40,cursor:"pointer",
              display:"flex",alignItems:"center",justifyContent:"center"}}>
            {showApiSettings?"✕":"⚙️"}
          </button>
        </div>
      </div>
      {showApiSettings&&<ApiSettingsPage push={push} inline={true}/>}

      {/* ── Zoom preview overlay — long-press-hold-release অথবা এক-ট্যাপে খোলা যায়, ওভারলেতে ট্যাপ করলেই বন্ধ ── */}
      {previewId&&(()=>{
        const pimg=images.find(x=>x.id===previewId);
        const src=pimg&&(pimg.webPath||(pimg.base64?`data:image/jpeg;base64,${pimg.base64}`:null));
        if(!src)return null;
        return(
          <div onClick={closePreviewNow} style={{position:"fixed",inset:0,zIndex:999,background:"rgba(0,0,0,0.9)",
            display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:16,gap:10,
            opacity:previewVisible?1:0,transition:"opacity 200ms ease",cursor:"pointer",
            pointerEvents:previewVisible?"auto":"none"}}>
            <img src={src} draggable={false} style={{maxWidth:"92vw",maxHeight:"80vh",borderRadius:12,
              border:"3px solid #f59e0b",boxShadow:"0 8px 30px rgba(0,0,0,0.6)",
              transform:previewVisible?"scale(1)":"scale(0.92)",transition:"transform 200ms ease"}}/>
            <div style={{fontSize:11,color:"#e2e8f0",fontWeight:700,background:"#000000aa",padding:"5px 12px",borderRadius:20}}>✕ বন্ধ করতে ট্যাপ করুন</div>
          </div>
        );
      })()}

      {/* ══════════ CONFIRM PHASE ══════════ */}
      {phase==="confirm"&&(
        <>
          <div style={{background:"#0a1628",border:`1px solid ${C.border}`,borderRadius:10,padding:"8px 12px",fontSize:11,color:C.muted,marginBottom:12,lineHeight:1.7}}>
            <div style={{color:C.text,fontWeight:700,marginBottom:3}}>🔎 এক নজরে দেখে নাও — সব ঠিক থাকলে Confirm করো</div>
            <div>নিচে {draftGroups.length}টা group পাওয়া গেছে। {targetMode==="QBank"?"পদ/প্রতিষ্ঠান/সাল ও Subject ":"Subject "}ভুল বা ফাঁকা থাকলে ঠিক করে দাও, ভুল group হলে বাদ দাও (❌)।</div>
          </div>
          <div className="ss-scroll" style={{maxHeight:"58vh",overflowY:"auto",paddingRight:6,marginBottom:4}}>
          {draftGroups.map(g=>{
            const needsAppearance=targetMode==="QBank";
            // 🐛 ফিক্স: group.subject খালি হলেও, সব row-এর নিজস্ব subject থাকলে এটা "সমস্যা" না
            const subjectOk=g.subject.trim()||g.rows.every(r=>r.subject&&r.subject.trim());
            const mcqOk=qType!=="MCQ"||g.rows.every(r=>r.correct&&r.correct.trim());
            const isEmpty=!subjectOk || !mcqOk || (needsAppearance&&(!g.post.trim()||!g.institution.trim()||!g.year.trim()));
            const imgsOpen=expandedGroupId===g.id;
            return(
              <div key={g.id} style={{background:g.included?C.panel:"#1a1a1a",opacity:g.included?1:.5,
                border:`1px solid ${isEmpty&&g.included?"#f59e0b":C.border}`,borderRadius:12,padding:"10px 14px",marginBottom:10}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
                  <span style={{fontSize:11,fontWeight:800,color:C.muted}}>পাতা {g.pages.join(", ")} · {g.rows.length}টি প্রশ্ন</span>
                  <button onClick={()=>toggleGroupIncluded(g.id)}
                    style={{fontSize:11,fontWeight:700,padding:"3px 10px",borderRadius:20,cursor:"pointer",
                      border:`1px solid ${g.included?"#22c55e":"#ef4444"}`,
                      background:g.included?"#052e16":"#2a0a0a",
                      color:g.included?"#22c55e":"#ef4444"}}>
                    {g.included?"✅ রাখা হবে":"❌ বাদ"}
                  </button>
                </div>
                <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:8}}>
                  <button onClick={()=>toggleGroupImages(g.id)}
                    style={{fontSize:10,fontWeight:800,padding:"4px 10px",borderRadius:8,cursor:"pointer",
                      border:`1px solid ${isEmpty?"#f59e0b":C.border}`,
                      background:isEmpty?"#f59e0b18":"transparent",
                      color:isEmpty?"#f59e0b":C.muted}}>
                    {imgsOpen?"▲ ছবি লুকাও":`🖼️ ${g.pages.length}টা পাতার ছবি দেখো`}
                  </button>
                  {isEmpty&&(
                    <button onClick={()=>toggleGroupRawText(g.id)}
                      style={{fontSize:10,fontWeight:800,padding:"4px 10px",borderRadius:8,cursor:"pointer",
                        border:"1px solid #38bdf8",background:"#38bdf818",color:"#38bdf8"}}>
                      {rawTextGroupId===g.id?"▲ OCR টেক্সট লুকাও":"📝 raw OCR টেক্সট দেখো (কেন খালি এলো বুঝতে)"}
                    </button>
                  )}
                </div>
                {rawTextGroupId===g.id&&(
                  <div className="ss-scroll" style={{maxHeight:220,overflowY:"auto",background:"#0a1628",
                    border:"1px solid #38bdf8",borderRadius:8,padding:"8px 10px",marginBottom:8,
                    fontSize:10,fontFamily:"monospace",color:"#94a3b8",whiteSpace:"pre-wrap"}}>
                    {g.pages.map(pn=>{
                      const im=imgByPageNo(pn);
                      return(
                        <div key={pn} style={{marginBottom:8}}>
                          <div style={{color:"#38bdf8",fontWeight:800,marginBottom:2}}>— পাতা #{pn} —</div>
                          {(im&&im.rawOcr)||"(এই পাতার raw OCR টেক্সট পাওয়া যায়নি)"}
                        </div>
                      );
                    })}
                  </div>
                )}
                {imgsOpen&&(
                  <div className="ss-scroll" style={{display:"flex",flexDirection:"column",gap:8,marginBottom:8,
                    maxHeight:"50vh",overflowY:"auto",paddingRight:6}}>
                    {g.pages.map(pn=>{
                      const im=imgByPageNo(pn);
                      if(!im)return null;
                      const src=im.thumb||im.webPath||(im.base64?`data:image/jpeg;base64,${im.base64}`:null);
                      if(!src)return null;
                      return(
                        <div key={pn} style={{position:"relative"}}>
                          {/* ── এখানে (Confirm স্ক্রিনে) এক-ট্যাপেই সাথে সাথে ফুল-স্ক্রিন জুম খোলে
                              (openPreviewNow) — long-press-ভিত্তিক ৩ সেকেন্ড অপেক্ষার দরকার নেই,
                              কারণ এখানকার হিন্ট টেক্সটই "ট্যাপ করো" বলে (idle-phase-এর রি-অর্ডার
                              লিস্টে drag/long-press দুটোর কনফ্লিক্ট এড়াতে সেখানে long-press রাখা
                              হয়েছে, কিন্তু Confirm স্ক্রিনে drag নেই — তাই সরাসরি ট্যাপই স্বাভাবিক)।
                              পদ/প্রতিষ্ঠান/সাল বা Subject ফাঁকা থাকলে এটাই আসল পাতা দেখে ম্যানুয়ালি
                              যাচাই করার উপায়। ── */}
                          <img src={src} draggable={false} loading="lazy" decoding="async"
                            onClick={()=>openPreviewNow(im.id)}
                            style={{width:"100%",maxHeight:280,minHeight:130,objectFit:"contain",background:"#000",
                              borderRadius:8,border:`1px solid ${C.border}`,display:"block",cursor:"pointer",
                              WebkitTouchCallout:"none",WebkitUserSelect:"none",userSelect:"none"}}/>
                          <div style={{position:"absolute",top:6,left:6,fontSize:10,fontWeight:800,color:"#e2e8f0",background:"#000000aa",padding:"2px 8px",borderRadius:20}}>#{pn}</div>
                          <div style={{position:"absolute",bottom:6,right:6,fontSize:9,fontWeight:700,color:"#f59e0b",background:"#000000aa",padding:"2px 8px",borderRadius:20}}>🔍 বড় করতে ট্যাপ করো</div>
                        </div>
                      );
                    })}
                  </div>
                )}
                {needsAppearance&&(
                  <>
                    <div style={{fontSize:10,color:C.muted,fontWeight:700,marginBottom:4,marginTop:2}}>🧾 এই পাতাগুলো কোন পরীক্ষার (Post/Institution ভুল হলে ঠিক করে দাও)</div>
                    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:8}}>
                      <div className="fld" style={{marginBottom:0}}>
                        <label>🧑‍💼 পদ{!g.post.trim()&&<span style={{color:"#f59e0b"}}> ⚠️</span>}</label>
                        <TypeaheadCombo
                          options={postOptions}
                          value={{id:"",name:g.post}}
                          onChange={sel=>updateGroupField(g.id,"post",sel.name)}
                          placeholder="যেমন: গাড়ী চালক"
                          newLabel={`🆕 "${g.post.trim()}" নতুন পদ হিসেবে যোগ হবে`}
                        />
                      </div>
                      <div className="fld" style={{marginBottom:0}}>
                        <label>🏢 প্রতিষ্ঠান{!g.institution.trim()&&<span style={{color:"#f59e0b"}}> ⚠️</span>}</label>
                        <TypeaheadCombo
                          options={instOptions}
                          value={{id:"",name:g.institution}}
                          onChange={sel=>updateGroupField(g.id,"institution",sel.name)}
                          placeholder="যেমন: বন অধিদপ্তর"
                          newLabel={`🆕 "${g.institution.trim()}" নতুন প্রতিষ্ঠান হিসেবে যোগ হবে`}
                        />
                      </div>
                    </div>
                    <div className="fld" style={{marginBottom:8}}>
                      <label>📅 সাল{!g.year.trim()&&<span style={{color:"#f59e0b"}}> ⚠️</span>}</label>
                      <input className="inp" value={g.year} onChange={e=>updateGroupField(g.id,"year",e.target.value)} placeholder="যেমন: 2025"/>
                    </div>
                  </>
                )}
                <div style={{fontSize:10,color:C.muted,fontWeight:700,marginBottom:4}}>📚 বিষয় (এই গ্রুপের প্রশ্নগুলো কোন বিষয়ের — AI যেটা ধরতে পারেনি সেখানে এটাই বসবে)</div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
                  <div className="fld" style={{marginBottom:0}}>
                    <label>📚 Subject{(!g.subject.trim()&&!g.rows.every(r=>r.subject&&r.subject.trim()))&&<span style={{color:"#f59e0b"}}> ⚠️ খালি</span>}</label>
                    <input className="inp" value={g.subject} onChange={e=>updateGroupField(g.id,"subject",e.target.value)} placeholder="Subject লিখুন..."/>
                  </div>
                  <div className="fld" style={{marginBottom:0}}>
                    <label>📌 Topic (ঐচ্ছিক)</label>
                    <input className="inp" value={g.subtopic} onChange={e=>updateGroupField(g.id,"subtopic",e.target.value)} placeholder="খালি রাখলে Subject-ই বসবে"/>
                  </div>
                </div>
                {g.rows.some(r=>r.subject)&&(
                  g.rows.every(r=>r.subject&&r.subject.trim())
                    ?<div style={{fontSize:9,color:"#22c55e",marginTop:6}}>✨ {g.rows.length}/{g.rows.length}টা প্রশ্নেই AI সেকশন-হেডিং ("বাংলা-২৫", "গণিত-১৫" ইত্যাদি) দেখে বিষয় ধরে ফেলেছে — উপরের Subject বক্স ফাঁকা রাখলেও চলবে, ব্যবহারই হবে না</div>
                    :<div style={{fontSize:9,color:"#22c55e",marginTop:6}}>✨ {g.rows.filter(r=>r.subject).length}/{g.rows.length}টা প্রশ্নে AI সেকশন-হেডিং দেখে বিষয় ধরে ফেলেছে — বাকি {g.rows.length-g.rows.filter(r=>r.subject).length}টার জন্য উপরের Subject fallback হিসেবে বসবে</div>
                )}

                {/* ── প্রশ্ন-লেভেল রিভিউ/এডিট — MCQ-তে OCR ভুল পড়া বা answer-key ভুল মেলা
                    কমন, তাই প্রতিটা প্রশ্ন এক্সপ্যান্ড করে option+সঠিক-উত্তর নিজে চেক/ঠিক
                    করার সুযোগ থাকা জরুরি। Written-এও Q/উত্তরের টেক্সট এখান থেকে ঠিক করা
                    যায় বা ভুল-করে-ঢুকে-যাওয়া প্রশ্ন বাদ দেওয়া যায়। ── */}
                {(()=>{
                  const missingCorrect=qType==="MCQ"?g.rows.filter(r=>!r.correct).length:0;
                  const rowsOpen=rowsOpenGroupId===g.id;
                  return(
                    <>
                      <button onClick={()=>toggleGroupRows(g.id)}
                        style={{width:"100%",marginTop:8,padding:"6px 0",fontSize:10,fontWeight:800,cursor:"pointer",borderRadius:8,
                          color:missingCorrect>0?"#f59e0b":C.accent,
                          background:(missingCorrect>0?"#f59e0b":C.accent)+"14",
                          border:`1px solid ${(missingCorrect>0?"#f59e0b":C.accent)}44`}}>
                        {rowsOpen?"▲ প্রশ্ন লুকাও":`🔎 ${g.rows.length}টা প্রশ্ন দেখো/এডিট করো`}
                        {missingCorrect>0?` — ⚠️ ${missingCorrect}টায় সঠিক উত্তর নেই`:""}
                      </button>
                      {rowsOpen&&(
                        <div className="ss-scroll" style={{marginTop:8,display:"flex",flexDirection:"column",gap:8,maxHeight:"55vh",overflowY:"auto",paddingRight:2}}>
                          {g.rows.map((r,ri)=>{
                            const optLabels=["ক","খ","গ","ঘ"];
                            const optKeys=["opt1","opt2","opt3","opt4"];
                            return(
                              <div key={ri} style={{background:"#0a1628",border:`1px solid ${qType==="MCQ"&&!r.correct?"#f59e0b55":C.border}`,borderRadius:8,padding:"8px 10px"}}>
                                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
                                  <span style={{fontSize:9,color:C.muted,fontWeight:700}}>প্রশ্ন #{ri+1}</span>
                                  <button onClick={()=>removeRow(g.id,ri)}
                                    style={{fontSize:9,fontWeight:700,color:"#ef4444",background:"transparent",border:"1px solid #7f1d1d",borderRadius:6,padding:"2px 7px",cursor:"pointer"}}>
                                    🗑 বাদ দাও
                                  </button>
                                </div>
                                <textarea className="inp" style={{minHeight:44,fontSize:12,marginBottom:7,resize:"vertical"}}
                                  value={r.q} onChange={e=>updateRowField(g.id,ri,"q",e.target.value)} placeholder="প্রশ্ন"/>
                                {qType==="MCQ"?(
                                  <>
                                    {optKeys.map((ok,oi)=>{
                                      const val=r[ok]||"";
                                      const isCorrect=!!val&&r.correct===val;
                                      return(
                                        <div key={ok} style={{display:"flex",alignItems:"center",gap:7,marginBottom:5}}>
                                          <input type="radio" name={`correct-${g.id}-${ri}`} checked={isCorrect} disabled={!val}
                                            onChange={()=>updateRowField(g.id,ri,"correct",val)}
                                            style={{flexShrink:0,accentColor:"#22c55e"}}/>
                                          <input className="inp" style={{flex:1,fontSize:12,padding:"6px 9px",
                                              borderColor:isCorrect?"#22c55e":C.border,background:isCorrect?"#052e1688":"transparent"}}
                                            value={val}
                                            onChange={e=>{
                                              const wasCorrect=r.correct===val;
                                              updateRowField(g.id,ri,ok,e.target.value);
                                              if(wasCorrect) updateRowField(g.id,ri,"correct",e.target.value);
                                            }}
                                            placeholder={`${optLabels[oi]}. option`}/>
                                        </div>
                                      );
                                    })}
                                    {!r.correct&&<div style={{fontSize:9,color:"#f59e0b",marginTop:2}}>⚠️ কোনটা সঠিক, বাম পাশের রেডিও বাটনে ট্যাপ করে বেছে দাও</div>}
                                  </>
                                ):(
                                  <textarea className="inp" style={{minHeight:36,fontSize:12,resize:"vertical"}}
                                    value={r.correct} onChange={e=>updateRowField(g.id,ri,"correct",e.target.value)} placeholder="উত্তর"/>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </>
                  );
                })()}
              </div>
            );
          })}
          </div>
          {(()=>{
            const incGroups=draftGroups.filter(g=>g.included);
            const needsAppearance2=targetMode==="QBank";
            const isReady=g=>(g.subject.trim()||g.rows.every(r=>r.subject&&r.subject.trim())) && (qType!=="MCQ"||g.rows.every(r=>r.correct&&r.correct.trim())) && (!needsAppearance2 || (g.post.trim()&&g.institution.trim()&&g.year.trim()));
            const readyG=incGroups.filter(isReady);
            const blockedG=incGroups.filter(g=>!isReady(g));
            const readyQ=readyG.reduce((s,g)=>s+g.rows.length,0);
            return(
              <div style={{background:C.panel,border:`1px solid ${blockedG.length>0?"#f59e0b":C.border}`,borderRadius:12,padding:"10px 14px",marginBottom:12}}>
                <div style={{display:"flex",justifyContent:"space-between",fontSize:12}}>
                  <span style={{color:C.text,fontWeight:700}}>✅ Submit হবে</span>
                  <span style={{color:"#10b981",fontWeight:900}}>{readyQ}টি প্রশ্ন · {readyG.length}টি group</span>
                </div>
                {blockedG.length>0&&(
                  <div style={{display:"flex",justifyContent:"space-between",fontSize:12,marginTop:6,paddingTop:6,borderTop:`1px dashed ${C.border}`}}>
                    <span style={{color:"#f59e0b",fontWeight:700}}>⚠️ {needsAppearance2?"Subject/পদ/প্রতিষ্ঠান/সাল":"Subject"}{qType==="MCQ"?"/সঠিক উত্তর":""} ফাঁকা — বাদ যাবে</span>
                    <span style={{color:"#f59e0b",fontWeight:900}}>{blockedG.length}টি group</span>
                  </div>
                )}
              </div>
            );
          })()}
          <div style={{display:"flex",flexDirection:"column",gap:8,marginBottom:12}}>
            <button className="btn bp bb" disabled={submitting||!totalIncludedG} onClick={confirmAndSubmit} style={{justifyContent:"center"}}>
              {submitting?"⏳ Submit হচ্ছে...":`✅ Confirm করে Submit করো (${targetMode} → Sheet)`}
            </button>
            <button className="btn" disabled={submitting} onClick={backToEdit}
              style={{justifyContent:"center",background:"transparent",color:C.muted,borderColor:C.border,fontSize:11}}>
              ↩️ বাতিল করে ছবি/গ্রুপ আবার ঠিক করি (ক্যাশ থাকায় আবার Process করলে দ্রুত হবে)
            </button>
          </div>
        </>
      )}

      {/* ══════════ IDLE / PROCESSING PHASE ══════════ */}
      {phase!=="confirm"&&(
        <>
          {/* ── প্রশ্নের ধরন — সবার আগে, Gallery/Camera খোলারও আগে বাধ্যতামূলক বেছে নিতে হয় ──
              (parsing prompt, sanitize-লজিক, submit-schema — তিনটাই এই সিলেকশনের ওপর নির্ভর করে,
              তাই ছবি তোলার পরে বদলানো নিরাপদ না — নতুন ব্যাচ শুরু করলে আবার বেছে নিতে হবে) */}
          <div style={{background:C.panel,border:`1.5px solid ${qType?C.border:"#f59e0b"}`,borderRadius:12,padding:"10px 14px",marginBottom:12}}>
            <div style={{fontSize:11,fontWeight:800,color:C.text,marginBottom:8}}>
              ❓ প্রশ্নের ধরন {!qType&&<span style={{color:"#f59e0b"}}>— আগে এটা বেছে নাও</span>}
            </div>
            <div style={{display:"flex",gap:6}}>
              {[["Written","✍️ Written"],["MCQ","🔘 MCQ"]].map(([m,label])=>(
                <button key={m} type="button" disabled={phase==="processing"||images.length>0}
                  onClick={()=>setQType(m)}
                  style={{flex:1,fontSize:13,fontWeight:700,padding:"10px 0",borderRadius:8,cursor:(images.length>0)?"not-allowed":"pointer",
                    border:`1.5px solid ${qType===m?C.accent:C.border}`,
                    background:qType===m?C.accent+"22":"transparent",
                    color:qType===m?C.accent:C.muted}}>{label}</button>
              ))}
            </div>
            {images.length>0&&<div style={{fontSize:9,color:C.muted,marginTop:6}}>ছবি যোগ হয়ে গেছে বলে টাইপ এখন লক — বদলাতে হলে 🗑️ দিয়ে সব মুছে নতুন করে শুরু করো</div>}
          </div>

          {/* Info box */}
          <div style={{background:"#0a1628",border:`1px solid ${C.border}`,borderRadius:10,padding:"8px 12px",fontSize:11,color:C.muted,marginBottom:12,lineHeight:1.7}}>
            <div style={{color:C.text,fontWeight:700,marginBottom:3}}>📋 ব্যবহার পদ্ধতি:</div>
            <div>① একাধিক subject/sub-topic মিশ্রিত ছবি একসাথে যোগ করুন — <b>পাতা নম্বর অনুযায়ী ক্রমে</b></div>
            <div>② যেখানে যেখানে পেপার পাল্টাচ্ছে, সেই ছবিতে <b style={{color:"#f59e0b"}}>✂️ নতুন Group</b> ট্যাপ করে মার্ক করো</div>
            <div>③ <b style={{color:"#22d3ee"}}>Target Sheet</b> ও <b style={{color:"#22d3ee"}}>Save Location</b> বেছে <b style={{color:"#6366f1"}}>Process</b> করো</div>
            <div>④ শেষে ছোট একটা <b style={{color:"#10b981"}}>Group Confirm</b> লিস্ট দেখাবে — চেক করে এক-ট্যাপে Submit করো</div>
            {qType==="MCQ"?(
              <div style={{color:"#f59e0b"}}>⚠️ MCQ মোড: উত্তরমালা একই পাতায় থাকলে সঠিক উত্তর অটো বসবে, নাহলে "correct" ফাঁকা থাকবে — Confirm স্ক্রিনে প্রতিটা প্রশ্ন এক্সপ্যান্ড করে ম্যানুয়ালি বেছে দিতে হবে</div>
            ):(
              <div style={{color:"#f59e0b"}}>⚠️ Written মোড — Study এখানে সাপোর্টেড না</div>
            )}
          </div>

          {/* Target Sheet + Save Location */}
          <div style={{background:C.panel,border:`1px solid ${C.border}`,borderRadius:12,padding:"10px 14px",marginBottom:12}}>
            <div style={{fontSize:11,fontWeight:800,color:C.text,marginBottom:8}}>🎯 Target Sheet</div>
            <div style={{display:"flex",gap:6,marginBottom:10}}>
              {["Quiz","QBank"].map(m=>(
                <button key={m} type="button" disabled={phase==="processing"} onClick={()=>setTargetMode(m)}
                  style={{flex:1,fontSize:12,fontWeight:700,padding:"7px 0",borderRadius:8,cursor:"pointer",
                    border:`1px solid ${targetMode===m?C.accent:C.border}`,
                    background:targetMode===m?C.accent+"22":"transparent",
                    color:targetMode===m?C.accent:C.muted}}>{m}</button>
              ))}
            </div>
            <SaveLocationPicker value={saveLoc} onChange={setSaveLocP} gasSecret={gasSecret} onGasSecretChange={setGasSecretP}/>
          </div>

          {/* পদ/প্রতিষ্ঠান/সাল — শুধু QBank mode-এ, ঐচ্ছিক ডিফল্ট। এখানে যা দেওয়া থাকবে সেটা
              "Process" করার সময় প্রতিটা নতুন group-এর শুরুর মান হিসেবে বসে যাবে (AI যদি পাতা
              থেকে নিজে থেকেই পদ/প্রতিষ্ঠান/সাল ধরে ফেলে, সেটাই override করে) — Confirm স্ক্রিনে
              প্রতিটা group আলাদাভাবে এডিট করা যায়, তাই একই ব্যাচে ভিন্ন ভিন্ন পরীক্ষার পাতা
              থাকলেও সমস্যা নেই। */}
          {targetMode==="QBank"&&(
            <div style={{background:C.panel,border:`1px solid ${C.border}`,borderRadius:12,padding:"10px 12px",marginBottom:12}}>
              <div style={{fontSize:11,fontWeight:800,color:C.text,marginBottom:2}}>🧾 ডিফল্ট পদ/প্রতিষ্ঠান/সাল (ঐচ্ছিক)</div>
              <div style={{fontSize:10,color:C.muted,marginBottom:8}}>সব পাতা একই পরীক্ষার হলে এখানে একবার দিয়ে রাখো — Process করার পর প্রতিটা group-এ এটাই বসে যাবে (AI নিজে ধরতে পারলে সেটাই থাকবে)। প্রতিটা group Confirm স্ক্রিনে আলাদাভাবে বদলানো যাবে।</div>
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
                <input className="inp" placeholder="যেমন: 2025" value={examYear} onChange={e=>setExamYear(e.target.value)}/>
              </div>
            </div>
          )}

          {/* Image Picker Buttons */}
          <div style={{display:"flex",gap:8,marginBottom:12}}>
            <button className="btn bp bb" style={{flex:1}} disabled={phase==="processing"||!qType} onClick={pickGallery}>🖼 Gallery (একাধিক)</button>
            <button className="btn" style={{flex:1,background:"#1e293b",color:C.text,borderColor:C.border}} disabled={phase==="processing"||!qType} onClick={openCamera}>📷 Camera</button>
            {images.length>0&&phase!=="processing"&&<button className="btn" style={{background:"#7f1d1d",color:"#fca5a5",borderColor:"#991b1b",padding:"0 12px"}} onClick={clearAll}>🗑</button>}
          </div>

          {/* Image List — reorder + manual group-break + status + detected subject/subtopic
              Redesigned: cropped 76x76 square thumbnails হাইড হয়ে যাচ্ছিল হেডার-লাইন, তাই এখন
              পুরো পাতা (object-fit:contain, full-width) সরাসরি দেখা যায় — আলাদা tap/hold লাগে না */}
          {images.length>0&&(
            <div className="ss-scroll" style={{display:"flex",flexDirection:"column",gap:10,marginBottom:12,
              maxHeight:"62vh",overflowY:"auto",paddingRight:6}}>
              {images.map((img,i)=>{
                const fullSrc=img.webPath||(img.base64?`data:image/jpeg;base64,${img.base64}`:null);
                const src=img.thumb||fullSrc; // লিস্টে ছোট থাম্বনেইল দেখানো হয় (মেমরি বাঁচাতে) — zoom preview-এ ফুল রেজ ব্যবহার হয়
                const borderCol=img.status==="done"?"#10b981":img.status==="error"?"#ef4444":img.status==="running"?"#6366f1":img.groupBreak?"#f59e0b":C.border;
                return(
                  <div key={img.id} style={{background:img.groupBreak?"#f59e0b14":C.panel,border:`1px solid ${borderCol}`,borderRadius:12,padding:8}}>
                    <div style={{position:"relative"}}>
                      {src?(
                        <img src={src} draggable={false} loading="lazy" decoding="async"
                          onContextMenu={e=>e.preventDefault()}
                          onTouchStart={()=>startLongPress(img.id)}
                          onTouchMove={cancelLongPress}
                          onTouchEnd={cancelLongPress}
                          onTouchCancel={cancelLongPress}
                          onMouseDown={()=>startLongPress(img.id)}
                          onMouseUp={cancelLongPress}
                          onMouseLeave={cancelLongPress}
                          style={{width:"100%",maxHeight:260,minHeight:140,objectFit:"contain",background:"#000",
                          borderRadius:8,display:"block",
                          WebkitTouchCallout:"none",WebkitUserSelect:"none",userSelect:"none",touchAction:"pan-y"}}/>
                      ):(
                        <div style={{width:"100%",height:120,borderRadius:8,background:"#0a1628",display:"flex",alignItems:"center",justifyContent:"center",fontSize:24}}>📷</div>
                      )}
                      <div style={{position:"absolute",top:6,left:6,fontSize:11,fontWeight:900,padding:"2px 8px",borderRadius:20,
                        background:"#000000aa",
                        color:img.status==="done"?"#10b981":img.status==="error"?"#ef4444":img.status==="running"?"#818cf8":"#e2e8f0"}}>
                        {img.status==="done"?`✔ #${i+1}`:img.status==="error"?`✗ #${i+1}`:img.status==="running"?"⏳ প্রসেস হচ্ছে...":`#${i+1}`}
                      </div>
                      {phase!=="processing"&&(
                        <div onClick={()=>removeImg(img.id)} style={{position:"absolute",top:6,right:6,background:"#ef4444",color:"#fff",borderRadius:999,width:26,height:26,display:"flex",alignItems:"center",justifyContent:"center",fontSize:15,cursor:"pointer",fontWeight:900}}>×</div>
                      )}
                    </div>

                    <div style={{display:"flex",alignItems:"center",gap:6,marginTop:8,flexWrap:"wrap"}}>
                      {phase!=="processing"&&(
                        <>
                          <button onClick={()=>moveImg(img.id,-1)} style={{background:"#1e293b",color:"#fff",borderRadius:8,width:28,height:26,border:`1px solid ${C.border}`,fontSize:12,cursor:"pointer"}}>↑</button>
                          <button onClick={()=>moveImg(img.id,1)} style={{background:"#1e293b",color:"#fff",borderRadius:8,width:28,height:26,border:`1px solid ${C.border}`,fontSize:12,cursor:"pointer"}}>↓</button>
                        </>
                      )}
                      {i===0?(
                        <span style={{fontSize:10,fontWeight:800,color:C.muted,padding:"4px 10px",border:`1px solid ${C.border}`,borderRadius:8}}>1️⃣ Group শুরু</span>
                      ):(
                        phase!=="processing"&&(
                          <button onClick={()=>toggleGroupBreak(img.id)}
                            style={{fontSize:11,fontWeight:800,padding:"4px 10px",borderRadius:8,cursor:"pointer",
                              background:img.groupBreak?"#f59e0b":"transparent",
                              color:img.groupBreak?"#1a1200":C.muted,
                              border:`1px solid ${img.groupBreak?"#f59e0b":C.border}`}}>
                            {img.groupBreak?"✂️ নতুন Group":"চলমান (এখানে ট্যাপ করে নতুন Group মার্ক করো)"}
                          </button>
                        )
                      )}
                      {img.status==="done"&&(
                        <span style={{fontSize:10,color:"#10b981",marginLeft:"auto"}}>{img.designation||"—"} · {img.entryCount} প্রশ্ন</span>
                      )}
                      {img.status==="error"&&(
                        <span style={{fontSize:10,color:"#ef4444",marginLeft:"auto"}}>{img.error}</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Progress */}
          {phase==="processing"&&(
            <div style={{background:C.panel,border:`1px solid ${C.border}`,borderRadius:12,padding:"10px 14px",marginBottom:12}}>
              <div style={{display:"flex",justifyContent:"space-between",fontSize:11,marginBottom:6}}>
                <span style={{color:C.text,fontWeight:700}}>⏳ Detect + Parse চলছে...</span>
                <span style={{color:"#6366f1",fontWeight:900}}>{pct}% ({progress.cur}/{progress.total})</span>
              </div>
              <div style={{background:C.border,borderRadius:999,height:8,overflow:"hidden"}}>
                <div style={{height:"100%",width:`${pct}%`,background:"linear-gradient(90deg,#6366f1,#10b981)",borderRadius:999,transition:"width .3s"}}/>
              </div>
            </div>
          )}

          {/* Result summary (Submit শেষে) */}
          {result&&phase==="done"&&(
            <div style={{background:"#052e16",border:"1px solid #10b98144",borderRadius:12,padding:"10px 14px",marginBottom:12}}>
              <div style={{fontSize:12,fontWeight:800,color:"#10b981",marginBottom:6}}>✅ Submit সম্পন্ন</div>
              <div style={{fontSize:11,color:C.text}}>যোগ হয়েছে: <b style={{color:"#10b981"}}>{result.added}</b>{result.skipped>0&&<> · duplicate বাদ: <b>{result.skipped}</b></>}{result.failed>0&&<> · ব্যর্থ: <b style={{color:"#ef4444"}}>{result.failed}</b></>}</div>
              <div style={{fontSize:11,color:C.muted,marginTop:2}}>{result.groupCount}টি subject/sub-topic গ্রুপ — {targetMode} (Sheet)</div>
              <button className="btn" onClick={startOver} style={{marginTop:8,justifyContent:"center",width:"100%",fontSize:11,background:"transparent",color:C.muted,borderColor:C.border}}>🔄 নতুন ব্যাচ শুরু করো</button>
            </div>
          )}

          {/* Action Buttons */}
          <div style={{display:"flex",flexDirection:"column",gap:8}}>
            <button className="btn bp bb" disabled={phase==="processing"||!images.length} onClick={processImages} style={{justifyContent:"center"}}>
              {phase==="processing"?(
                <span>⏳ প্রসেস হচ্ছে... {progress.cur}/{progress.total}</span>
              ):(
                <span>🔍 Detect করো ({images.length}টা ছবি)</span>
              )}
            </button>
            {phase==="processing"&&(
              <button className="btn" style={{background:"#7f1d1d",color:"#fca5a5",borderColor:"#991b1b",justifyContent:"center"}}
                onClick={()=>stopRef.current=true}>⛔ বন্ধ করুন</button>
            )}
            <FailedQueuePanel push={push} sourceFilter={SRC_NAME}/>
          </div>
        </>
      )}
    </div>
  );
}

export { MultiSubjectImportPage };
