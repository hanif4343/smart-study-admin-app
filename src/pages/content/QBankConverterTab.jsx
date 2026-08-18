/* ══════════════════════════════════════════════════════════════════
   QBANK → QUIZ CONVERTER
   ══════════════════════════════════════════════════════════════════ */
import React, { useState, useEffect, useCallback, useMemo } from "react";
import { C } from "../../core/config.js";
import { useFB, invalidate, loadPath } from "../../core/dataCache.js";
import { toArr, loadSharedGasSecret, saveSharedGasSecret } from "../../core/utils.js";
import { callAiProviderRotatingRaw } from "../../core/ocrProviders.js";
import { saveRowsToSheet, fetchReferenceData } from "../../core/sheetSave.js";
import { pushFailedItems, buildSheetRow } from "../../core/uploaderUtils.js";
import { resolveOrCreateReference, resolveSubjectTopicForEntries } from "../../core/referenceHelpers.js";
import { JOB_NONE_TAG } from "../../core/ghConfig.js";
import {
  LS_QBC_TAXONOMY, LS_QBC_RESULTS_DRAFT, loadQbcSaveLoc, saveQbcSaveLoc,
  loadQbcAutoSave, saveQbcAutoSave, QBANK_CONV_TAXONOMY_DEFAULT, normalizeQbankQ,
  stripEmoji, buildTaxonomyFromRefData
} from "../../core/qbankConverterShared.js";
import { JobCheckList } from "../../components/shared/JobCheckList.jsx";
import { SaveLocationPicker } from "../../components/shared/SaveLocationPicker.jsx";
import { JumpButton } from "../../components/shared/JumpButton.jsx";
import { FailedQueuePanel } from "../../components/shared/FailedQueuePanel.jsx";

function QBankConverterTab({push,tick}){
  // ── Phase 5: এই কনভার্টার AI দিয়ে QBank প্রশ্নকে Quiz ফরম্যাটে বদলায়, subject/sub_topic
  // নাম "canonical taxonomy" থেকে বেছে নেয়। কিন্তু নতুন schema-তে Quiz-এর প্রশ্ন
  // subject_id/topic_id দিয়ে reference করে — তাই AI-এর দেওয়া নাম Subjects/Topics
  // reference-টেবিলের সাথে মিলিয়ে id বসানো হচ্ছে (নিচে saveApproved-এর resolveSubjectTopicForEntries দেখো),
  // নাহলে এই পাথ দিয়ে যোগ হওয়া প্রশ্ন নতুন lazy-load সিস্টেমে "অদৃশ্য" থেকে যেত। ──
  const[gasSecret,setGasSecret]=useState(loadSharedGasSecret);
  const saveGasSecret0=(v)=>{ setGasSecret(v); saveSharedGasSecret(v); };
  const[refData,setRefData]=useState(null);
  const loadRefData=useCallback(()=>{
    if(!gasSecret){ setRefData(null); return; }
    fetchReferenceData({gasSecret}).then(d=>setRefData(d));
  },[gasSecret]);
  useEffect(()=>{ loadRefData(); },[loadRefData]);
  const subjectOptionsQuiz=useMemo(()=>refData?(refData.subjects||[]).filter(s=>s.sheet==="Quiz"):[],[refData]);

  // ⚡ Firebase quota বন্ধ থাকলেও কাজ চালু থাকে — useFB()-এর ভেতরের loadPath() এখন
  // Firebase read ব্যর্থ হলে নিজে থেকেই Google Sheet fallback (GAS "getSheetRows")
  // ব্যবহার করে। Firebase চালু থাকলে স্বাভাবিকভাবেই Firebase থেকেই পড়বে।
  const{data:qbank,loading:qbankLoading}=useFB("QBank",tick);

  // ⚡ Quiz sheet-এ ইতিমধ্যে যেসব প্রশ্ন যোগ হয়ে গেছে সেগুলো ফেচ করা — যাতে dedup ধাপে
  // বাদ দেওয়া যায় (device/session independent — Quiz sheet-ই সত্যিকারের সোর্স, লোকাল ক্যাশ না)।
  // QBank ফেচের মতোই useFB ব্যবহার করা হয়েছে, যেটা Firebase read ব্যর্থ হলে GAS-এর
  // getSheetRows অ্যাকশন (tab=Quiz) দিয়ে fallback করে। tick বদলালে (🔄 রিফ্রেশ) বা সেভের
  // পরে invalidate("Quiz") কল হলে এটা নিজে থেকেই রিফ্রেশ হয়।
  const{data:quizExisting,loading:quizLoading}=useFB("Quiz",tick);
  const existingQuizKeys=useMemo(()=>{
    const set=new Set();
    toArr(quizExisting).forEach(row=>{
      const key=normalizeQbankQ(row.question||row.Question||"");
      if(key) set.add(key);
    });
    return set;
  },[quizExisting]);

  const allRows=useMemo(()=>toArr(qbank).map(row=>{
    const audRaw=(row.AudienceTags||row.audienceTags||"").toString().trim();
    return {
      _fbKey: row._fbKey,
      question: (row.question||row.Question||"").toString().trim(),
      opt1: row.option1||"", opt2: row.option2||"", opt3: row.option3||"", opt4: row.option4||"",
      correct: row.correct||"",
      subject: (row.subject||"").toString().trim(),     // QBank পোস্ট নাম
      examPaper: (row.sub_topic||"").toString().trim(),  // QBank exam paper নাম
      explanation: row.explanation||row.Explanation||"",
      qType: (row["Question Type"]||"").toString().trim()||"MCQ",
      audienceList: audRaw.split(",").map(a=>a.trim()).filter(Boolean),
    };
  }).filter(r=>r.question),[qbank]);

  const[selAud,setSelAud]=useState([]);
  const[selSubj,setSelSubj]=useState([]);
  const[selExam,setSelExam]=useState([]);

  const matchAud=useCallback((r,aud)=> !aud.length || aud.some(a=>a===JOB_NONE_TAG? r.audienceList.length===0 : r.audienceList.includes(a)),[]);

  const audienceOptions=useMemo(()=>{
    const counts={};
    allRows.forEach(r=>{
      if(!r.audienceList.length){ counts[JOB_NONE_TAG]=(counts[JOB_NONE_TAG]||0)+1; return; }
      r.audienceList.forEach(a=>{counts[a]=(counts[a]||0)+1;});
    });
    const entries=Object.keys(counts).filter(k=>k!==JOB_NONE_TAG).sort().map(a=>({value:a,label:a,count:counts[a]}));
    if(counts[JOB_NONE_TAG]) entries.push({value:JOB_NONE_TAG,label:"— কোনো Audience Tag নেই —",count:counts[JOB_NONE_TAG]});
    return entries;
  },[allRows]);

  const rowsByAud=useMemo(()=>allRows.filter(r=>matchAud(r,selAud)),[allRows,selAud,matchAud]);

  const subjectOptions=useMemo(()=>{
    const counts={};
    rowsByAud.forEach(r=>{ const s=r.subject||"(ফাঁকা)"; counts[s]=(counts[s]||0)+1; });
    return Object.keys(counts).sort().map(s=>({value:s,label:s,count:counts[s]}));
  },[rowsByAud]);

  const rowsByAudSubj=useMemo(()=>rowsByAud.filter(r=> !selSubj.length || selSubj.includes(r.subject||"(ফাঁকা)")),[rowsByAud,selSubj]);

  const examOptions=useMemo(()=>{
    const counts={};
    rowsByAudSubj.forEach(r=>{ const e=r.examPaper||"(ফাঁকা)"; counts[e]=(counts[e]||0)+1; });
    return Object.keys(counts).sort().map(e=>({value:e,label:e,count:counts[e]}));
  },[rowsByAudSubj]);

  const scopedRows=useMemo(()=>rowsByAudSubj.filter(r=> !selExam.length || selExam.includes(r.examPaper||"(ফাঁকা)")),[rowsByAudSubj,selExam]);

  const audKey=selAud.join(","), subjKey=selSubj.join(",");
  useEffect(()=>{ setSelSubj([]); setSelExam([]); },[audKey]);
  useEffect(()=>{ setSelExam([]); },[subjKey]);

  const toggle=(arr,setArr,val)=>{ setArr(arr.includes(val)? arr.filter(x=>x!==val) : [...arr,val]); };

  // ── ডিডুপ্লিকেশন — কোনো AI কল ছাড়াই, শুধু টেক্সট মিলিয়ে ──
  // ধাপ ১: QBank-এর ভেতরেই ডুপ্লিকেট (একই প্রশ্ন একাধিক exam paper-এ) মার্জ করা।
  // ধাপ ২: যেগুলো Quiz sheet-এ ইতিমধ্যে যোগ হয়ে গেছে (existingQuizKeys) সেগুলো পুরোপুরি বাদ —
  //         "ফিল্টারে ইউনিক" সংখ্যাতেও ওগুলো গণনা হয় না, তাই আবার AI-কে পাঠানো হয় না।
  const{dedupedPool:dedupedPoolBase,alreadyInQuizCount}=useMemo(()=>{
    const seen=new Map();
    const alreadySeen=new Set();
    scopedRows.forEach(r=>{
      const key=normalizeQbankQ(r.question);
      if(!key)return;
      if(existingQuizKeys.has(key)){ alreadySeen.add(key); return; }
      if(seen.has(key)){
        const ex=seen.get(key);
        if(r.examPaper && !ex.examPapers.includes(r.examPaper)) ex.examPapers.push(r.examPaper);
        ex.dupCount++;
      }else{
        seen.set(key,{...r,examPapers:r.examPaper?[r.examPaper]:[],dupCount:1});
      }
    });
    return {dedupedPool:Array.from(seen.values()), alreadyInQuizCount:alreadySeen.size};
  },[scopedRows,existingQuizKeys]);

  // ── Taxonomy এডিটর — 🐛 ফিক্স (Issue #2): আগে সবসময় স্ট্যাটিক QBANK_CONV_TAXONOMY_DEFAULT
  // (emoji-সহ, Reference টেবিলের সাথে সম্পর্কহীন) দিয়ে শুরু হতো। এখন refData লোড হওয়ার পর,
  // যদি admin নিজে থেকে taxonomy কাস্টমাইজ না করে থাকে (localStorage-এ সেভ করা কিছু না থাকে),
  // তাহলে লাইভ Subjects/Topics reference টেবিল থেকেই taxonomy অটো-জেনারেট হয় — তাই AI যে
  // নামই বাছুক, সেটা ইতিমধ্যে বিদ্যমান বিশুদ্ধ (no emoji) subject/topic নাম হবে। ──
  const[taxonomyText,setTaxonomyText]=useState(()=>{
    try{ return localStorage.getItem(LS_QBC_TAXONOMY) || JSON.stringify(QBANK_CONV_TAXONOMY_DEFAULT,null,2); }
    catch{ return JSON.stringify(QBANK_CONV_TAXONOMY_DEFAULT,null,2); }
  });
  const[hasCustomTaxonomy,setHasCustomTaxonomy]=useState(()=>{ try{ return !!localStorage.getItem(LS_QBC_TAXONOMY); }catch{ return false; } });
  useEffect(()=>{
    if(hasCustomTaxonomy) return; // admin নিজে কাস্টমাইজ করলে সেটাই থাকবে, অটো-ওভাররাইট হবে না
    const live=buildTaxonomyFromRefData(refData);
    if(live) setTaxonomyText(JSON.stringify(live,null,2));
  },[refData,hasCustomTaxonomy]);
  const syncTaxonomyFromReference=()=>{
    const live=buildTaxonomyFromRefData(refData);
    if(!live){ push("warn","⚠️ Reference টেবিলে কোনো Quiz Subject নেই","আগে Reference ট্যাব থেকে অন্তত একটা Subject/Topic যোগ করো, অথবা GAS Secret Key দাও"); return; }
    setTaxonomyText(JSON.stringify(live,null,2));
    try{ localStorage.removeItem(LS_QBC_TAXONOMY); }catch{} // সিঙ্কের পর আবার "custom" ধরা হবে না, ভবিষ্যতের refData বদলেও অটো-আপডেট হবে
    setHasCustomTaxonomy(false);
    push("success","🔄 Reference থেকে taxonomy সিঙ্ক হলো",`${Object.keys(live).length}টা Subject লোড হয়েছে`);
  };
  const[showTaxEdit,setShowTaxEdit]=useState(false);
  const saveTaxonomy=()=>{
    try{ JSON.parse(taxonomyText); localStorage.setItem(LS_QBC_TAXONOMY,taxonomyText); setHasCustomTaxonomy(true); push("success","✅ Taxonomy সেভ হয়েছে (কাস্টম — এখন থেকে অটো-সিঙ্ক বন্ধ)","পরের ব্যাচ থেকেই এটা ব্যবহার হবে"); }
    catch{ push("error","❌ ভুল JSON ফরম্যাট","ঠিক করে আবার চেষ্টা করো"); }
  };

  // ── GAS Secret Key (উপরে refData fetch-এর জন্য declare করা হয়েছে) + Save Location — শেয়ার্ড (সব ফিচারে একই key/পছন্দ ব্যবহার হয়) ──
  const saveGasSecret=saveGasSecret0;
  const[saveLoc,setSaveLoc]=useState(loadQbcSaveLoc); // "sheet" | "firebase" — এই ট্যাবে ডিফল্ট "sheet"
  const setSaveLocP=(v)=>{ setSaveLoc(v); saveQbcSaveLoc(v); };
  // ⚡ Auto-save: convert শেষ হলেই approve-করা (ডিফল্টে সবই approved) প্রশ্নগুলো নিজে থেকেই
  // saveLoc অনুযায়ী (ডিফল্টে Google Sheet) সেভ হয়ে যায় — ম্যানুয়ালি "সেভ করো" চাপার দরকার পড়ে না।
  const[autoSave,setAutoSave]=useState(loadQbcAutoSave);
  const setAutoSaveP=(v)=>{ setAutoSave(v); saveQbcAutoSave(v); };

  const[batchSize,setBatchSize]=useState(15);
  // ⚡ সেভের সময় কয়টা করে একসাথে পাঠানো হবে — ছোট মান (৫-১০, চাইলে ১ পর্যন্ত) দিলে
  // প্রোগ্রেস বার প্রতি ব্যাচে আপডেট হয়ে "লাইভ" মনে হয়, কিন্তু বেশি রিকোয়েস্ট লাগায় মোট সময় একটু বাড়ে।
  const[saveChunkSize,setSaveChunkSize]=useState(5);
  const[busy,setBusy]=useState(false);
  const[progress,setProgress]=useState({done:0,total:0});
  const[results,setResults]=useState(()=>{
    try{
      const saved=localStorage.getItem(LS_QBC_RESULTS_DRAFT);
      return saved? JSON.parse(saved) : [];
    }catch{ return []; }
  });
  const[draftRestored]=useState(()=>{
    try{ return !!JSON.parse(localStorage.getItem(LS_QBC_RESULTS_DRAFT)||"[]").length; }catch{ return false; }
  });
  const[saving,setSaving]=useState(false);
  const[saveProgress,setSaveProgress]=useState({done:0,total:0});
  const[saveElapsedSec,setSaveElapsedSec]=useState(0);
  // ⚡ রিডিজাইন: রিভিউ লিস্ট এখন ফিল্টার-চিপ দিয়ে ভাগ করা (সব/Pending/সেভ হয়েছে/ব্যর্থ) আর
  // প্রতিটা প্রশ্ন ডিফল্টে কোলাপ্সড — ট্যাপ করলেই এডিট ফর্ম খোলে। এতে ৪০০+ প্রশ্নেও স্ক্রল ছোট থাকে।
  const[reviewFilter,setReviewFilter]=useState("all"); // "all" | "pending" | "completed" | "failed"
  const[expandedKey,setExpandedKey]=useState(null);

  // saving চলাকালীন প্রতি সেকেন্ডে টাইমার আপডেট হয় — চোখে দেখা যায় কতক্ষণ ধরে সেভ হচ্ছে
  useEffect(()=>{
    if(!saving) return;
    setSaveElapsedSec(0);
    const startTs=Date.now();
    const iv=setInterval(()=>setSaveElapsedSec(Math.floor((Date.now()-startTs)/1000)),1000);
    return ()=>clearInterval(iv);
  },[saving]);

  // প্রতিবার results বদলালেই (প্রতি ব্যাচের পর, approve/edit করলে, সেভের পর) draft হিসেবে সেভ হয়ে যায় —
  // app বন্ধ হয়ে গেলে, ক্র্যাশ করলে, বা বেশি সময় লাগলেও কাজ হারায় না।
  useEffect(()=>{
    try{
      if(results.length) localStorage.setItem(LS_QBC_RESULTS_DRAFT,JSON.stringify(results));
      else localStorage.removeItem(LS_QBC_RESULTS_DRAFT);
    }catch{}
  },[results]);

  useEffect(()=>{
    if(draftRestored) push("success","📋 ড্রাফট পুনরুদ্ধার হয়েছে","আগের সেশনের অসেভ করা প্রশ্নগুলো ফিরে এসেছে — রিভিউ করে সেভ করো");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[]);

  // ⚡ যেসব QBank প্রশ্ন ইতিমধ্যে এই সেশনে কনভার্ট করে results-এ যোগ হয়ে গেছে (Completed বা এখনো
  // পেন্ডিং রিভিউ — দুটোই) সেগুলো বাদ দেওয়া হয়, যাতে runConvert আবার চাপলে ডুপ্লিকেট এন্ট্রি তৈরি না হয়।
  // (আগে runConvert প্রতিবার পুরো results খালি করে দিতো বলে এই সমস্যাটা চোখে পড়েনি — এখন results
  // ধরে রাখা হয় বলেই এই এক্সট্রা এক্সক্লুশনটা দরকার।)
  const queuedSourceKeys=useMemo(()=>new Set(results.map(r=>r._srcKey).filter(Boolean)),[results]);
  const{dedupedPool,alreadyQueuedCount}=useMemo(()=>{
    const already=new Set();
    const pool=dedupedPoolBase.filter(r=>{
      const key=normalizeQbankQ(r.question);
      if(queuedSourceKeys.has(key)){ already.add(key); return false; }
      return true;
    });
    return {dedupedPool:pool, alreadyQueuedCount:already.size};
  },[dedupedPoolBase,queuedSourceKeys]);

  const clearDraft=()=>{
    setResults([]);
    try{ localStorage.removeItem(LS_QBC_RESULTS_DRAFT); }catch{}
    push("success","🗑️ ড্রাফট মুছে ফেলা হয়েছে","");
  };

  const buildPrompt=(batch)=>{
    let taxonomy;
    try{ taxonomy=JSON.parse(taxonomyText); }catch{ taxonomy=QBANK_CONV_TAXONOMY_DEFAULT; }
    return `তুমি একজন বাংলা প্রশ্নব্যাংক এডিটর। নিচে চাকরির পরীক্ষার প্রশ্নব্যাংক (QBank) থেকে কিছু প্রশ্ন দেওয়া হলো। প্রতিটা প্রশ্নকে Quiz ফরম্যাটে রূপান্তর করো।

CANONICAL SUBJECT/SUB-TOPIC তালিকা (এই তালিকা থেকেই সঠিক subject আর sub_topic বেছে নেবে, নতুন নাম বানাবে না, একদম হুবহু বানান/স্পেসিং কপি করবে):
${JSON.stringify(taxonomy,null,2)}

নিয়মাবলী:
1. প্রতিটা ইনপুট প্রশ্নের বিষয়বস্তু বিচার করে উপরের তালিকা থেকে সবচেয়ে সঠিক subject আর sub_topic বেছে নাও। তালিকার কোনোটার সাথেই না মিললে subject="অজানা", sub_topic="অজানা" দাও — নতুন category বানিয়ে দিও না।
2. একটা ইনপুট প্রশ্নে যদি আসলে একাধিক sub-question থাকে (ক)/খ)/গ) দিয়ে ভাগ করা), সেটাকে আলাদা আলাদা atomic প্রশ্নে ভেঙে আউটপুটে একাধিক entry হিসেবে দাও।
3. ইনপুটে option1-4 আগে থেকেই থাকলে (MCQ টাইপ) সেগুলো হুবহু রাখো, শুধু correct অপশনটা ঠিক আছে কিনা যাচাই করো।
4. ইনপুটে option না থাকলে (Written টাইপ — শুধু question+correct answer আছে), সেই বিষয়ের সাথে সম্পর্কিত কিন্তু ভুল, প্লজিবল আরও ৩টা option বানাও — মূল সঠিক উত্তরটাই correct থাকবে।
5. explanation ফিল্ডে ১-২ লাইনে সংক্ষিপ্ত ব্যাখ্যা দাও।
6. শুধু নিচের JSON array ফরম্যাটে উত্তর দাও, কোনো markdown code fence, কোনো preamble ছাড়া, শুধু raw JSON:
[{"question":"...","opt1":"...","opt2":"...","opt3":"...","opt4":"...","correct":"...","subject":"...","sub_topic":"...","explanation":"..."}]

ইনপুট প্রশ্নসমূহ (JSON):
${JSON.stringify(batch.map(b=>({question:b.question,opt1:b.opt1,opt2:b.opt2,opt3:b.opt3,opt4:b.opt4,correct:b.correct,explanation:b.explanation})),null,2)}`;
  };

  const runConvert=async()=>{
    if(!dedupedPool.length){
      push("warn","কোনো প্রশ্ন নেই",
        scopedRows.length&&(alreadyInQuizCount||alreadyQueuedCount)? "এই ফিল্টারের সবগুলো প্রশ্নই হয় Quiz-এ আছে, নয়তো ইতিমধ্যে কনভার্ট করা হয়েছে" : "আগে ফিল্টার বেছে নাও");
      return;
    }
    setBusy(true);
    // ⚡ আগের results খালি করা হয় না — এতে আগের "✅ Completed" বাজ (সেভ হয়ে যাওয়া প্রশ্ন) এবং
    // এখনো রিভিউ-বাকি আইটেমগুলো অক্ষত থাকে। নতুন কনভার্ট করা প্রশ্নগুলো লিস্টের শেষে যোগ হয়।
    setProgress({done:0,total:dedupedPool.length});
    let totalNew=0;
    const allNewItems=[]; // ⚡ ব্যাচে ব্যাচে জমা হওয়া নতুন প্রশ্ন — convert শেষে সরাসরি এগুলোই auto-save করা হবে (results state আপডেট হতে দেরি হতে পারে বলে আলাদা লোকাল অ্যারেতেও রাখা হলো)
    for(let i=0;i<dedupedPool.length;i+=batchSize){
      const batch=dedupedPool.slice(i,i+batchSize);
      try{
        const raw=await callAiProviderRotatingRaw(buildPrompt(batch));
        const cleaned=raw.replace(/```json|```/g,"").trim();
        const parsed=JSON.parse(cleaned);
        if(Array.isArray(parsed)){
          const newItems=parsed.map(p=>{
            const src=batch.find(b=>normalizeQbankQ(b.question)===normalizeQbankQ(p.question));
            return {...p,
              prevExam:(src?.examPapers||[]).join(", "),
              approved:true,
              completed:false,
              _srcKey: src?normalizeQbankQ(src.question):null, // ⚡ কোন QBank সোর্স প্রশ্ন থেকে এসেছে — পরের কনভার্টে ডুপ্লিকেট এড়াতে ব্যবহার হয়
              _key:Math.random().toString(36).slice(2),
            };
          });
          totalNew+=newItems.length;
          allNewItems.push(...newItems);
          setResults(rs=>[...rs,...newItems]);
        }
      }catch(e){
        push("error","❌ ব্যাচ #"+(Math.floor(i/batchSize)+1)+" ব্যর্থ",e.message);
      }
      setProgress({done:Math.min(i+batchSize,dedupedPool.length),total:dedupedPool.length});
    }
    setBusy(false);
    push("success","✅ কনভার্সন শেষ","মোট "+totalNew+"টা প্রশ্ন — "+(autoSave?"অটো-সেভ শুরু হচ্ছে...":"এবার নিচে রিভিউ করে সেভ করো"));

    // ⚡ Auto-save: approval তো এমনিতেই অটো (নতুন সব প্রশ্ন approved:true নিয়ে আসে) — তাই
    // ম্যানুয়ালি "সেভ করো" বাটনে চাপার দরকার নেই, convert শেষ হলেই সরাসরি saveLoc অনুযায়ী
    // (ডিফল্টে Google Sheet) সেভ হয়ে যায়। ব্যর্থ হলেও চিন্তা নেই — ব্যর্থ রো ক্যাশে জমা থাকবে,
    // আর approved থেকে যাওয়া আইটেম নিচের ম্যানুয়াল বাটন দিয়েও পরে সেভ করা যাবে।
    if(autoSave && allNewItems.length){
      await saveApproved(allNewItems);
    }
  };

  const updateResult=(key,field,val)=>{ setResults(rs=>rs.map(r=>r._key===key?{...r,[field]:val}:r)); };
  const toggleApprove=(key)=>{ setResults(rs=>rs.map(r=>r._key===key?{...r,approved:!r.approved}:r)); };
  const removeResult=(key)=>{ setResults(rs=>rs.filter(r=>r._key!==key)); };
  const approvedCount=results.filter(r=>r.approved).length;
  const completedCount=results.filter(r=>r.completed).length;

  const saveApproved=async(overrideItems)=>{
    // 🐛 ফিক্স: onClick={saveApproved} লিখলে React ক্লিক ইভেন্ট অবজেক্টটাই overrideItems হিসেবে
    // পাঠিয়ে দেয় (যেহেতু এখন saveApproved একটা প্যারামিটার নেয়) — ইভেন্ট অবজেক্টে .length না
    // থাকায় সাথে সাথে "কিছুই approve করা নেই" দেখাতো, results-এ আসলে approved আইটেম থাকলেও।
    // তাই এখানে Array.isArray চেক করে নেওয়া হলো, আর বাটনের onClick-ও ()=>saveApproved() করা হয়েছে।
    const approved=Array.isArray(overrideItems)?overrideItems:results.filter(r=>r.approved);
    if(!approved.length){ push("warn","কিছুই approve করা নেই",""); return; }
    if(!refData){ push("warn","⏳ Reference data এখনো লোড হচ্ছে, একটু পর আবার চেষ্টা করো",""); return; }
    setSaving(true);
    setSaveProgress({done:0,total:approved.length});
    const saveStartedAt=Date.now();
    const audienceTagList=selAud.filter(a=>a!==JOB_NONE_TAG);
    const audienceTags=audienceTagList.join(",")||"Job";

    // ── 🐛 ফিক্স (Issue #2): AI-এর দেওয়া subject/sub_topic নাম আগে শুধু "মেলানো" হতো
    // (matchSubjectTopicId) — না মিললে subject_id/topic_id ফাঁকা থেকে যেত। এখন
    // resolveSubjectTopicForEntries দিয়ে VLOOKUP-এর মতো: মিললে সেই id, না মিললে নতুন
    // Subject/Topic নিজে থেকেই তৈরি হয়ে যায় — তাই subject_id/topic_id কখনো ফাঁকা থাকে না।
    // stripEmoji দিয়ে AI-এর টেক্সট থেকে emoji ছেঁটে নেওয়া হয় — সেভ হওয়া নাম সবসময় বিশুদ্ধ। ──
    const entries=approved.map(r=>({...r,q:r.question,subject:stripEmoji(r.subject),topic:stripEmoji(r.sub_topic)}));
    const resolveResult=await resolveSubjectTopicForEntries({
      entries, subjectOptions:subjectOptionsQuiz, topicsAll:refData?.topics||[], gasSecret, sheet:"Quiz", push,
    });
    if(!resolveResult.ok){ setSaving(false); push("error","❌ "+resolveResult.reason,""); return; }
    if(resolveResult.anyCreated) loadRefData();

    // ── Audience Tag নামও Tags reference-টেবিলের সাথে resolve-or-create করে tagIds বসানো হয়
    // (AudienceTags_ids কলাম আগে সবসময় ফাঁকা থাকতো, কারণ QBankConverterTab আগে buildSheetRow-ই
    // ব্যবহার করতো না) ──
    const tagOptions=(refData?.tags||[]).map(t=>({id:t.tag_id,name:t.tag_name}));
    const tagIds=[];
    for(const name of audienceTagList){
      const res=await resolveOrCreateReference({sel:{id:"",name},refType:"tags",options:tagOptions,gasSecret,push});
      if(res.ok){ tagIds.push(res.id); if(res.created) tagOptions.push({id:res.id,name}); }
    }
    if(tagIds.length!==audienceTagList.length) loadRefData(); // নতুন ট্যাগ তৈরি হয়ে থাকলে refData রিফ্রেশ

    // NO-FIREBASE POLICY: Quiz এখন শুধু Google Sheet-এ যায় (GAS দিয়ে), Firebase-এ
    // সরাসরি লেখার পুরনো পথটা ইচ্ছাকৃতভাবে সরানো হয়েছে। buildSheetRow ব্যবহার করা হচ্ছে
    // (আগে ম্যানুয়ালি row বানানো হতো, যেটা group_id/sub_index/audienceTagsIds বাদ দিয়ে যেত)।
    const rows=resolveResult.resolved.map(({item,subjectId,topicId,subjectName,topicName})=>{
      const row=buildSheetRow({
        item:{q:item.question,opt1:item.opt1,opt2:item.opt2,opt3:item.opt3,opt4:item.opt4,correct:item.correct,explanation:item.explanation},
        subject:subjectName, subtopic:topicName, qtype:"MCQ",
        audienceTags:audienceTagList, tagIds,
        subjectId, topicId,
      });
      row.prevExam=item.prevExam||""; // buildSheetRow ডিফল্টে খালি রাখে — QBank→Quiz-এ উৎস exam paper-এর নাম এখানে বসে
      return row;
    });
    try{
      const result=await saveRowsToSheet({rows,targetTab:"Quiz",gasSecret,push,onProgress:setSaveProgress,chunkSize:saveChunkSize,source:"QB_Convert"});
      // ⚡ Quiz sheet-এ নতুন প্রশ্ন যোগ হলো — কাশ করা Quiz ডাটা invalidate করা হলো যাতে
      // dedup-এর "ইতিমধ্যে Quiz-এ আছে" চেক সাথে সাথেই এই নতুন প্রশ্নগুলো ধরে ফেলে।
      if(result.added>0) invalidate("Quiz");
      const failedCount=result.failedRows.length;
      if(failedCount) pushFailedItems("QBank→Quiz","sheet","Quiz",result.failedRows);
      const tookSec=Math.max(1,Math.round((Date.now()-saveStartedAt)/1000));
      push("success","✅ সেভ সম্পন্ন",
        `${result.added||0}টা নতুন প্রশ্ন যোগ হয়েছে`+
        (result.skipped?`, ${result.skipped}টা duplicate বাদ পড়েছে`:"")+
        (failedCount?`, ${failedCount}টা ব্যর্থ (নিচে ক্যাশ থেকে আবার পাঠানো যাবে)`:"")+
        ` • ${tookSec} সেকেন্ড লাগলো`
      );
      // ⚡ আগে এখানে সেভ-হওয়া আইটেমগুলো results থেকে পুরোপুরি মুছে ফেলা হতো — তাই "✅ Completed"
      // badge দেখানোর কোনো সুযোগই ছিল না। এখন সফলভাবে সেভ হওয়া (approved && ব্যর্থ না হওয়া)
      // আইটেমগুলো completed:true করে লিস্টেই রাখা হয় (approved:false করে, যাতে আবার সেভ-এ না যায়)।
      // শুধু ব্যর্থ (failed) আইটেমগুলো approved অবস্থায় থেকে যায়, retry-এর জন্য।
      // 🐛 ফিক্স: আগে এখানে "if(!r.approved) return r" দিয়ে state-এর সব approved রো ধরে
      // completed করে দিতো — কিন্তু auto-save যখন শুধু নতুন ব্যাচ (overrideItems) সেভ করে,
      // তখন state-এ আরও অন্য approved-কিন্তু-এখনো-সেভ-না-হওয়া রো থাকতে পারে (আগের ড্রাফট/অন্য
      // ব্যাচ) — সেগুলোকেও ভুল করে completed:true, approved:false বানিয়ে দিতো, ফলে পরে ম্যানুয়াল
      // "সেভ করো" চাপলে "কিছুই approve করা নেই" দেখাতো। এখন শুধু এই রাউন্ডে যেগুলো আসলে পাঠানো
      // হয়েছিল (approved অ্যারের _key দিয়ে) সেগুলোই আপডেট হয়।
      const processedKeys=new Set(approved.map(r=>r._key).filter(Boolean));
      const failedQs=new Set(result.failedRows.map(r=>r.question));
      setResults(rs=>rs.map(r=>{
        if(!processedKeys.has(r._key)) return r;
        if(failedQs.has(r.question)) return {...r, failed:true};
        return {...r, completed:true, approved:false, failed:false};
      }));
    }catch(e){
      push("error","❌ সেভ ব্যর্থ",e.message);
    }
    setSaving(false);
  };

  return(
    <div style={{paddingBottom:24}}>
      <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:14,padding:14,marginBottom:12}}>
        <div style={{fontSize:11,textTransform:"uppercase",letterSpacing:.6,color:C.muted,fontWeight:700,marginBottom:10}}>🎯 QBank ফিল্টার (একাধিক বাছাই করা যায়)</div>

        <div className="fld"><label>Audience Tag</label>
          <JobCheckList options={audienceOptions} selected={selAud} onToggle={v=>toggle(selAud,setSelAud,v)} emptyText={qbankLoading?"লোড হচ্ছে...":"কোনো ট্যাগ নেই"}/>
        </div>
        <div className="fld"><label>Subject (QBank পোস্ট)</label>
          <JobCheckList options={subjectOptions} selected={selSubj} onToggle={v=>toggle(selSubj,setSelSubj,v)} emptyText="এই ফিল্টারে কিছু নেই"/>
        </div>
        <div className="fld"><label>Exam Paper (sub_topic)</label>
          <JobCheckList options={examOptions} selected={selExam} onToggle={v=>toggle(selExam,setSelExam,v)} emptyText="এই ফিল্টারে কিছু নেই"/>
        </div>

        <div style={{display:"flex",gap:6,marginTop:8,flexWrap:"wrap"}}>
          <div style={{flex:"1 1 72px",background:C.panel,border:`1px solid ${C.border}`,borderRadius:10,padding:"8px 6px",textAlign:"center"}}>
            <div style={{fontSize:16,fontWeight:800,color:C.text,lineHeight:1.1}}>{scopedRows.length}</div>
            <div style={{fontSize:9.5,color:C.muted,marginTop:2}}>ফিল্টারে মোট</div>
          </div>
          <div style={{flex:"1 1 72px",background:C.panel,border:`1px solid ${C.border}`,borderRadius:10,padding:"8px 6px",textAlign:"center"}}>
            <div style={{fontSize:16,fontWeight:800,color:C.green,lineHeight:1.1}}>{dedupedPool.length}</div>
            <div style={{fontSize:9.5,color:C.muted,marginTop:2}}>ইউনিক</div>
          </div>
          <div style={{flex:"1 1 72px",background:C.panel,border:`1px solid ${C.border}`,borderRadius:10,padding:"8px 6px",textAlign:"center"}}>
            <div style={{fontSize:16,fontWeight:800,color:C.yellow,lineHeight:1.1}}>{quizLoading?"...":alreadyInQuizCount}</div>
            <div style={{fontSize:9.5,color:C.muted,marginTop:2}}>Quiz-এ আছে</div>
          </div>
          {alreadyQueuedCount>0 && (
            <div style={{flex:"1 1 72px",background:C.panel,border:`1px solid ${C.border}`,borderRadius:10,padding:"8px 6px",textAlign:"center"}}>
              <div style={{fontSize:16,fontWeight:800,color:C.yellow,lineHeight:1.1}}>{alreadyQueuedCount}</div>
              <div style={{fontSize:9.5,color:C.muted,marginTop:2}}>কনভার্ট হয়েছে</div>
            </div>
          )}
        </div>
      </div>

      <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:14,padding:14,marginBottom:12}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",cursor:"pointer"}} onClick={()=>setShowTaxEdit(s=>!s)}>
          <div style={{fontSize:11,textTransform:"uppercase",letterSpacing:.6,color:C.muted,fontWeight:700}}>📚 Canonical Taxonomy {showTaxEdit?"▲":"▼"}</div>
        </div>
        {showTaxEdit && (
          <div style={{marginTop:10}}>
            <div style={{fontSize:11,color:hasCustomTaxonomy?"#f59e0b":C.green,marginBottom:8,lineHeight:1.6}}>
              {hasCustomTaxonomy
                ? "⚠️ এটা কাস্টম taxonomy (ম্যানুয়ালি এডিট করা) — Reference টেবিলে নতুন Subject/Topic যোগ হলেও এটা অটো-আপডেট হবে না।"
                : "✅ Reference টেবিল (Subjects/Topics, Quiz) থেকে অটো-সিঙ্ক করা আছে — নতুন Subject/Topic যোগ হলে এখানেও এমনি এমনি চলে আসবে।"}
            </div>
            <textarea className="inp" style={{minHeight:220,fontFamily:"monospace",fontSize:12}} value={taxonomyText} onChange={e=>setTaxonomyText(e.target.value)}/>
            <div style={{display:"flex",gap:8,marginTop:8}}>
              <button className="btn" style={{flex:1,justifyContent:"center",background:C.accent,color:"#fff",padding:10,fontSize:13}} onClick={saveTaxonomy}>💾 কাস্টম হিসেবে সেভ করো</button>
              <button className="btn" style={{flex:1,justifyContent:"center",background:"transparent",color:C.green,border:`1px solid ${C.green}44`,padding:10,fontSize:13}} onClick={syncTaxonomyFromReference}>🔄 Reference থেকে Sync করো</button>
            </div>
            <div style={{fontSize:11,color:C.muted,marginTop:8,lineHeight:1.6}}>AI এই তালিকা থেকেই subject/sub_topic বেছে নেবে — নতুন নাম নিজে বানাবে না। JSON ফরম্যাট: {"{"}"subject": ["subtopic1","subtopic2"...]{"}"}</div>
          </div>
        )}
      </div>

      <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:14,padding:14,marginBottom:12}}>
        <div style={{fontSize:11,textTransform:"uppercase",letterSpacing:.6,color:C.muted,fontWeight:700,marginBottom:10}}>🤖 AI দিয়ে কনভার্ট করো</div>
        <div className="fld"><label>ব্যাচ সাইজ (একবারে কতগুলো প্রশ্ন AI-কে পাঠানো হবে)</label>
          <input className="inp" type="number" min={5} max={40} value={batchSize} onChange={e=>setBatchSize(Math.max(5,Math.min(40,+e.target.value||15)))}/>
        </div>
        <label style={{display:"flex",alignItems:"center",gap:8,marginBottom:10,cursor:"pointer"}}>
          <input type="checkbox" checked={autoSave} onChange={e=>setAutoSaveP(e.target.checked)} style={{accentColor:C.green,width:16,height:16}}/>
          <span style={{fontSize:12,color:C.text}}>⚡ Auto-save — কনভার্ট শেষ হলেই সাথে সাথে <b style={{color:C.green}}>Google Sheet</b>-এ সেভ হয়ে যাবে (approval তো এমনিতেই অটো)</span>
        </label>
        {/* ⚡ এখন সবসময় দেখানো হয় (আগে শুধু auto-save চালু থাকলে দেখাতো) — ম্যানুয়াল সেভ-এও
            এই একই saveLoc ব্যবহার হয়। নিচে রিভিউ সেকশনে আর আলাদা কপি রাখা হয়নি — একটাই জায়গা। */}
        <SaveLocationPicker value={saveLoc} onChange={setSaveLocP} gasSecret={gasSecret} onGasSecretChange={saveGasSecret} compact/>
        <button className="btn" disabled={busy||!dedupedPool.length} style={{width:"100%",justifyContent:"center",background:C.green,color:"#04180a",padding:13,fontSize:14,fontWeight:700}} onClick={runConvert}>
          {busy?`⏳ কনভার্ট হচ্ছে... (${progress.done}/${progress.total})`:`🚀 ${dedupedPool.length}টা প্রশ্ন কনভার্ট করো`}
        </button>
        {busy && (
          <div style={{marginTop:10,height:6,background:C.panel,borderRadius:6,overflow:"hidden"}}>
            <div style={{height:"100%",background:C.green,width:`${progress.total?Math.round(progress.done/progress.total*100):0}%`,transition:"width .3s"}}/>
          </div>
        )}
        {saving && autoSave && (
          <div style={{marginTop:10}}>
            <div style={{fontSize:11,color:C.muted,marginBottom:4}}>💾 অটো-সেভ হচ্ছে... ({saveProgress.done}/{saveProgress.total}) • {saveElapsedSec}s</div>
            <div style={{height:6,background:C.panel,borderRadius:6,overflow:"hidden"}}>
              <div style={{height:"100%",background:C.accent,width:`${saveProgress.total?Math.round(saveProgress.done/saveProgress.total*100):0}%`,transition:"width .3s"}}/>
            </div>
          </div>
        )}
      </div>

      {results.length>0 && (()=>{
        const pendingList=results.filter(r=>!r.completed&&!r.failed);
        const completedList=results.filter(r=>r.completed);
        const failedListArr=results.filter(r=>r.failed);
        const chips=[
          {key:"all",label:`সব (${results.length})`},
          {key:"pending",label:`⏳ Pending (${pendingList.length})`},
          {key:"completed",label:`✅ সেভ হয়েছে (${completedList.length})`},
          {key:"failed",label:`❌ ব্যর্থ (${failedListArr.length})`},
        ];
        const visibleResults=
          reviewFilter==="pending"?pendingList:
          reviewFilter==="completed"?completedList:
          reviewFilter==="failed"?failedListArr:
          results;
        return(
        <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:14,padding:14,marginBottom:12}}>
          <JumpButton/>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10}}>
            <div style={{fontSize:11,textTransform:"uppercase",letterSpacing:.6,color:C.muted,fontWeight:700}}>
              ✅ রিভিউ করো ({approvedCount}/{results.length-completedCount} approved{completedCount?` • ${completedCount}টা সেভ হয়ে গেছে`:""})
            </div>
            <button className="btn" style={{fontSize:11,padding:"4px 10px",background:"transparent",color:C.red,border:`1px solid ${C.border}`}} onClick={clearDraft}>🗑️ ড্রাফট মুছো</button>
          </div>

          {/* ⚡ ফিল্টার চিপ — ৪০০+ প্রশ্ন থাকলেও এখন সব একসাথে স্ক্রল করতে হয় না */}
          <div style={{display:"flex",gap:6,marginBottom:11,overflowX:"auto",paddingBottom:2}}>
            {chips.map(c=>(
              <button key={c.key} onClick={()=>setReviewFilter(c.key)} style={{
                flexShrink:0,padding:"6px 12px",borderRadius:20,cursor:"pointer",whiteSpace:"nowrap",
                fontSize:11.5,fontWeight:700,
                border:`1px solid ${reviewFilter===c.key?C.accent:C.border}`,
                background:reviewFilter===c.key?"#3b82f622":"transparent",
                color:reviewFilter===c.key?"#93c5fd":C.muted,
              }}>{c.label}</button>
            ))}
          </div>

          {visibleResults.length===0 && (
            <div style={{textAlign:"center",padding:"18px 0",color:C.muted,fontSize:12}}>এই ফিল্টারে কিছু নেই</div>
          )}

          {visibleResults.map(r=>{
            if(r.completed) return(
              <div key={r._key} style={{background:"#22c55e12",border:`1px solid #22c55e40`,borderRadius:10,padding:"9px 12px",marginBottom:8,display:"flex",alignItems:"center",gap:8}}>
                <span className="pill pa" style={{flexShrink:0}}>✅ Completed</span>
                <span style={{fontSize:12,color:C.text,flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{r.question}</span>
                <button onClick={()=>removeResult(r._key)} title="তালিকা থেকে সরাও" style={{background:"transparent",border:"none",color:C.muted,fontSize:14,cursor:"pointer",flexShrink:0}}>✕</button>
              </div>
            );

            // ⚡ ডিফল্টে কোলাপ্সড — এক লাইনের কম্প্যাক্ট কার্ড, ট্যাপ করলেই ফুল এডিট ফর্ম খোলে
            if(expandedKey!==r._key) return(
              <div key={r._key} onClick={()=>setExpandedKey(r._key)}
                style={{background:C.panel,border:`1px solid ${r.failed?"#ef444460":C.border}`,borderRadius:10,
                  padding:"9px 11px",marginBottom:8,display:"flex",alignItems:"center",gap:8,cursor:"pointer",opacity:r.approved?1:.5}}>
                <input type="checkbox" checked={r.approved} onClick={e=>e.stopPropagation()} onChange={()=>toggleApprove(r._key)} style={{accentColor:C.green,width:16,height:16,flexShrink:0}}/>
                <span style={{fontSize:12,color:C.text,flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{r.question}</span>
                {r.failed && <span style={{flexShrink:0,background:"#ef444422",color:C.red,fontSize:9.5,fontWeight:800,padding:"2px 7px",borderRadius:20}}>❌ ব্যর্থ</span>}
                <span style={{color:C.muted,fontSize:11,flexShrink:0}}>▾</span>
              </div>
            );

            // ⚡ এক্সপ্যান্ডেড — ফুল এডিট ফর্ম (আগের মতোই)
            return(
              <div key={r._key} style={{background:C.panel,border:`1px solid ${C.accent}`,borderRadius:10,padding:12,marginBottom:10}}>
                <div onClick={()=>setExpandedKey(null)} style={{display:"flex",alignItems:"center",gap:8,marginBottom:8,cursor:"pointer"}}>
                  <input type="checkbox" checked={r.approved} onClick={e=>e.stopPropagation()} onChange={()=>toggleApprove(r._key)} style={{accentColor:C.green,width:16,height:16,flexShrink:0}}/>
                  <span style={{fontSize:12,color:C.muted,flex:1}}>Approve করে সেভ করো{r.failed?" • আগেরবার ব্যর্থ হয়েছিল":""}</span>
                  <span style={{color:C.muted,fontSize:11}}>▴</span>
                </div>
                <textarea className="inp" style={{marginBottom:6,fontSize:13}} value={r.question} onChange={e=>updateResult(r._key,"question",e.target.value)}/>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6,marginBottom:6}}>
                  <input className="inp" placeholder="Option 1" value={r.opt1||""} onChange={e=>updateResult(r._key,"opt1",e.target.value)}/>
                  <input className="inp" placeholder="Option 2" value={r.opt2||""} onChange={e=>updateResult(r._key,"opt2",e.target.value)}/>
                  <input className="inp" placeholder="Option 3" value={r.opt3||""} onChange={e=>updateResult(r._key,"opt3",e.target.value)}/>
                  <input className="inp" placeholder="Option 4" value={r.opt4||""} onChange={e=>updateResult(r._key,"opt4",e.target.value)}/>
                </div>
                <input className="inp" style={{marginBottom:6,borderColor:C.green}} placeholder="সঠিক উত্তর" value={r.correct||""} onChange={e=>updateResult(r._key,"correct",e.target.value)}/>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6,marginBottom:6}}>
                  <input className="inp" placeholder="Subject" value={r.subject||""} onChange={e=>updateResult(r._key,"subject",e.target.value)}/>
                  <input className="inp" placeholder="Sub-topic" value={r.sub_topic||""} onChange={e=>updateResult(r._key,"sub_topic",e.target.value)}/>
                </div>
                <textarea className="inp" placeholder="Explanation" style={{fontSize:12}} value={r.explanation||""} onChange={e=>updateResult(r._key,"explanation",e.target.value)}/>
                {r.prevExam && <div style={{fontSize:10,color:C.muted,marginTop:6}}>📄 উৎস exam paper: {r.prevExam}</div>}
              </div>
            );
          })}

          {/* ⚡ Save Location এখানে আর আলাদা করে দেখানো হয় না — উপরের "AI দিয়ে কনভার্ট করো" কার্ডেই
              একবার সেট করা থাকে, দুই জায়গায় ডুপ্লিকেট রাখা হয়নি। */}
          <div style={{fontSize:11,color:C.muted,margin:"2px 0 8px"}}>
            💾 সেভ হবে: <b style={{color:C.green}}>Google Sheet</b> — পরিবর্তনের জন্য উপরের কার্ডে যাও
          </div>
          <div className="fld">
            <label>সেভ চাংক সাইজ (কয়টা করে একসাথে পাঠানো হবে — ছোট মানে প্রোগ্রেস বার বেশি "লাইভ" দেখাবে, কিন্তু একটু ধীর হবে)</label>
            <input className="inp" type="number" min={1} max={100} value={saveChunkSize} disabled={saving}
              onChange={e=>setSaveChunkSize(Math.max(1,Math.min(100,+e.target.value||5)))}/>
          </div>

          {/* ⚡ স্টিকি সেভ বার — স্ক্রল করলেও বাটন হারিয়ে যাবে না, বারবার উপরে যেতে হবে না।
              bottom-nav-এর উপরে বসানো হয়েছে (bottom:70 ≈ nav height + safe-area)। */}
          <div style={{position:"sticky",bottom:70,zIndex:20,marginTop:6,paddingTop:8,
            background:`linear-gradient(180deg, transparent, ${C.card} 35%)`}}>
            <button className="btn" disabled={saving||!approvedCount} style={{width:"100%",justifyContent:"center",background:C.accent,color:"#fff",padding:12,fontSize:14,fontWeight:700,boxShadow:"0 6px 20px #3b82f655"}} onClick={()=>saveApproved()}>
              {saving?`⏳ সেভ হচ্ছে... (${saveProgress.done}/${saveProgress.total}) • ${saveElapsedSec}s`:`💾 ${approvedCount}টা প্রশ্ন Sheet-এ সেভ করো`}
            </button>
            {saving && (
              <div style={{marginTop:8}}>
                <div style={{height:6,background:C.panel,borderRadius:6,overflow:"hidden"}}>
                  <div style={{height:"100%",background:C.accent,width:`${saveProgress.total?Math.round(saveProgress.done/saveProgress.total*100):0}%`,transition:"width .3s"}}/>
                </div>
                <div style={{display:"flex",justifyContent:"space-between",marginTop:4,fontSize:11,color:C.muted}}>
                  <span>{saveProgress.total?Math.round(saveProgress.done/saveProgress.total*100):0}% সম্পন্ন</span>
                  <span>⏱️ {saveElapsedSec} সেকেন্ড</span>
                </div>
              </div>
            )}
          </div>
        </div>
        );
      })()}

      <FailedQueuePanel push={push} sourceFilter="QBank→Quiz"/>

      <div style={{fontSize:11,color:C.muted,lineHeight:1.6}}>
        কনভার্ট শেষে সব approved প্রশ্ন সরাসরি Google Sheet-এ সেভ হয়। কোনো রো সেভ করতে ব্যর্থ হলে সেটা ক্যাশে জমা থাকে — উপরে "ব্যর্থ হওয়া আইটেম ক্যাশ" থেকে পরে আবার পাঠানো যাবে।
      </div>
    </div>
  );
}

export { QBankConverterTab };
