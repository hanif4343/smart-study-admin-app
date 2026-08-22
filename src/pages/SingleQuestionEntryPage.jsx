/* ══════════ SINGLE প্রশ্ন এন্ট্রি — বই দেখে দ্রুত টাইপ করার জন্য ══════════
   ওয়ার্কফ্লো: Subject/Sub-topic/Target Sheet একবার সেট করে রাখা হয় (সেশনজুড়ে
   অক্ষত থাকে) — তারপর শুধু প্রশ্ন লিখে, উত্তর লিখে, Tab দিয়ে দিয়ে পরের বক্সে
   গিয়ে (MCQ হলে ✨ Generate চেপে option+ব্যাখ্যা AI দিয়ে বানিয়ে), Ctrl+S চেপে
   সাবমিট — সাথে সাথে সব ফাঁকা হয়ে পরের প্রশ্নের জন্য cursor আবার প্রশ্ন-বক্সে
   ফিরে যায়। বইয়ের একটার পর একটা প্রশ্ন টাইপ করার জন্য optimized। */
import React, { useState, useRef, useEffect, useCallback } from "react";
import { C } from "../core/config.js";
import { callAiProviderRotatingRaw, buildKeyPool } from "../core/ocrProviders.js";
import { buildSheetRow, loadSharedGasSecret, saveSharedGasSecret, LS_DRAFT_SINGLE, loadDraft, saveDraft, clearDraft } from "../core/uploaderUtils.js";
import { saveRowsToSheet, fetchReferenceData } from "../core/sheetSave.js";
import { resolveOrCreateReference } from "../core/referenceHelpers.js";
import { SaveLocationPicker } from "../components/shared/SaveLocationPicker.jsx";
import { TypeaheadCombo } from "../components/shared/TypeaheadCombo.jsx";

/* ── AI দিয়ে MCQ-এর ৩টা ভুল অপশন + ব্যাখ্যা বানানোর প্রম্পট ── */
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
function shuffle4(arr){
  const a=[...arr];
  for(let i=a.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; }
  return a;
}

/* ── ImgBB API key — রিপোর secret থেকে বিল্ড-টাইমে ইনজেক্ট হয় (Vite env var)। ── */
const IMGBB_API_KEY = import.meta.env.VITE_IMGBB_API_KEY || "";

/* ── ছবি ImgBB-তে আপলোড করে সরাসরি লিংক (url) রিটার্ন করে ── */
async function uploadImageToImgbb(file, apiKey){
  const fd = new FormData();
  fd.append("image", file);
  const res = await fetch(`[https://api.imgbb.com/1/upload?key=$](https://api.imgbb.com/1/upload?key=$){encodeURIComponent(apiKey)}`, {
    method: "POST",
    body: fd,
  });
  const data = await res.json().catch(()=>null);
  if(!res.ok || !data || !data.success) {
    throw new Error(data?.error?.message || "ImgBB আপলোড ব্যর্থ");
  }
  return data.data.url;
}

function SingleQuestionEntryPage({push}){
  const[targetMode,setTargetMode]=useState("Quiz"); // Quiz | QBank | Study
  const[qtype,setQtype]=useState("MCQ"); // MCQ | Written — Study হলে অপ্রাসঙ্গিক
  const[gasSecret,setGasSecretState]=useState(loadSharedGasSecret());
  const setGasSecret=v=>{setGasSecretState(v);saveSharedGasSecret(v);};

  // ── এই ফিল্ডগুলো একবার সেট হলে সেশনজুড়ে থাকে ──
  // 🐛 ফিক্স: আগে Subject/Sub-topic raw টেক্সট ছিল, Reference টেবিলের সাথে কোনো সংযোগ
  // ছিল না — subject_id/topic_id সবসময় ফাঁকা যেত। এখন TypeaheadCombo দিয়ে বিদ্যমান
  // Subject/Topic-এর সাথে মিলিয়ে বা নতুন তৈরি করে subject_id/topic_id বসানো হয়
  // (BulkUploaderPage/AIImportPage-এর মতোই)।
  const[subjectSel,setSubjectSel]=useState({id:"",name:""});
  const[topicSel,setTopicSel]=useState({id:"",name:""});
  const[audienceTags,setAudienceTags]=useState("");

  // ── Subjects/Topics/Posts/Institutions রেফারেন্স টেবিল ──
  const[refData,setRefData]=useState(null);
  useEffect(()=>{ fetchReferenceData({gasSecret}).then(setRefData).catch(()=>{}); },[gasSecret]);
  const subjectOptions=refData?(refData.subjects||[]).filter(s=>s.sheet===targetMode).map(s=>({id:s.subject_id,name:s.subject_name})):[];
  const topicOptions=refData&&subjectSel.id?(refData.topics||[]).filter(t=>t.subject_id===subjectSel.id).map(t=>({id:t.topic_id,name:t.topic_name})):[];

  // ── QBank + পদ/প্রতিষ্ঠান/সাল (Exam Appearance) — সেশনজুড়ে থাকে, প্রতিটা প্রশ্নে
  // একই appearance যোগ হবে (একই বই/প্রশ্নপত্র থেকে একটার পর একটা টাইপ করার সময়)। ──
  const[postSel,setPostSel]=useState({id:"",name:""});
  const[instSel,setInstSel]=useState({id:"",name:""});
  const[examYear,setExamYear]=useState("");
  const postOptions=refData?(refData.posts||[]).map(p=>({id:p.post_id,name:p.post_name})):[];
  const instOptions=refData?(refData.institutions||[]).map(i=>({id:i.institution_id,name:i.institution_name})):[];

  // ── REDESIGNED ("বারবার Ctrl+S না, শেষে একবার Ctrl+S"): শুধু QBank target-এ।
  // Quiz/Study-তে এই ফিল্ড দেখানোই হয় না, কোনো পরিবর্তন নেই।
  // এই বক্সে টেক্সট লিখলে একটা "চলমান গ্রুপ" শুরু হয় — Subject-এর মতোই সেশনজুড়ে
  // অক্ষত থাকে। প্রতিটা sub-part (ক, খ, গ...) টাইপ করে Ctrl+Enter চাপলে সেটা
  // pendingParts লিস্টে (শুধু ব্রাউজারের মেমোরিতে, এখনো কোনো নেটওয়ার্ক কল হয় না)
  // জমা হয়ে যায়, বক্স খালি হয়ে পরের sub-part-এর জন্য রেডি হয়। সবশেষে একবার
  // Ctrl+S চাপলে — pendingParts-এ যা জমা আছে + এই মুহূর্তে বক্সে যা লেখা আছে
  // (শেষ sub-part, আলাদা করে Ctrl+Enter চাপা লাগে না) — সবগুলো একসাথে, একটাই
  // নেটওয়ার্ক কলে, একই group_id দিয়ে সেভ হয়ে যায়। হেডিং বক্স খালি থাকলে (বা
  // pendingParts খালি থাকলে) Ctrl+S আগের মতোই তৎক্ষণাৎ একক-প্রশ্ন সাবমিট করে —
  // Quiz/Study/QBank-non-grouped — সব জায়গায় পুরনো আচরণ অক্ষত। ──
  const[groupHeadingText,setGroupHeadingText]=useState("");
  const[pendingParts,setPendingParts]=useState([]); // [{question,correct,opt1..4,explanation}] — এখনো সার্ভারে যায়নি

  // ── এই ফিল্ডগুলো প্রতি sub-part যোগ/সাবমিটের পর খালি হয়ে যায় ──
  const[question,setQuestion]=useState("");
  const[correct,setCorrect]=useState("");
  const[opt1,setOpt1]=useState(""); const[opt2,setOpt2]=useState("");
  const[opt3,setOpt3]=useState(""); const[opt4,setOpt4]=useState("");
  const[explanation,setExplanation]=useState("");

  const[generating,setGenerating]=useState(false);
  const[saving,setSaving]=useState(false);
  const[sessionCount,setSessionCount]=useState(0);
  const[imgUploading,setImgUploading]=useState(false); // ছবি → imgbb আপলোড হচ্ছে কিনা

  const qRef=useRef(null);
  const correctRef=useRef(null);
  const explRef=useRef(null);
  const activeInputRef=useRef("q"); // 'q' | 'correct' | 'expl' track করার জন্য

  const imgInputRef=useRef(null); // লুকানো <input type="file">, ছবি সিলেক্ট করার জন্য
  const isStudy=targetMode==="Study";
  const isMCQ=!isStudy&&qtype==="MCQ";

  useEffect(()=>{ qRef.current?.focus(); },[]);
  // subject বদলালে আগের topic নতুন subject-এর আন্ডারে না-ও থাকতে পারে, তাই রিসেট
  useEffect(()=>{ setTopicSel({id:"",name:""}); },[subjectSel.id]);

  // ── ড্রাফট অটোসেভ — টাইপ করে যাওয়া প্রশ্ন/Subject/পদ-প্রতিষ্ঠান-সাল ভুলে ব্যাক
  // চাপা বা রিলোডে হারিয়ে যাওয়া ঠেকাতে। প্রতিটা প্রশ্ন Submit হলে per-question
  // ফিল্ড এমনিই খালি হয়ে যায় (resetForNext), কিন্তু session-level ফিল্ড (Subject/
  // Post/Institution/সাল) ইচ্ছাকৃতভাবে থেকে যায় — পরের বার পেজ খুললেও এগুলো মনে
  // রাখলে বারবার বাছাই করতে হবে না। ──
  const draftCheckedRef=useRef(false);
  const[draftBanner,setDraftBanner]=useState(null);
  useEffect(()=>{
    if(draftCheckedRef.current)return;
    draftCheckedRef.current=true;
    const d=loadDraft(LS_DRAFT_SINGLE);
    if(d&&((d.question&&d.question.trim())||(d.subjectSel&&d.subjectSel.name))) setDraftBanner(d);
  },[]);
  const restoreDraft=()=>{
    const d=draftBanner; if(!d)return;
    if(d.targetMode)setTargetMode(d.targetMode);
    if(d.qtype)setQtype(d.qtype);
    if(d.subjectSel)setSubjectSel(d.subjectSel);
    if(d.topicSel)setTopicSel(d.topicSel);
    if(d.postSel)setPostSel(d.postSel);
    if(d.instSel)setInstSel(d.instSel);
    if(d.examYear!==undefined)setExamYear(d.examYear);
    if(d.groupHeadingText!==undefined)setGroupHeadingText(d.groupHeadingText);
    if(d.pendingParts!==undefined)setPendingParts(d.pendingParts);
    if(d.question!==undefined)setQuestion(d.question);
    if(d.correct!==undefined)setCorrect(d.correct);
    if(d.opt1!==undefined)setOpt1(d.opt1); if(d.opt2!==undefined)setOpt2(d.opt2);
    if(d.opt3!==undefined)setOpt3(d.opt3); if(d.opt4!==undefined)setOpt4(d.opt4);
    if(d.explanation!==undefined)setExplanation(d.explanation);
    setDraftBanner(null);
    push("success","♻️ আগের ড্রাফট ফিরিয়ে আনা হলো","");
  };
  const discardDraft=()=>{ clearDraft(LS_DRAFT_SINGLE); setDraftBanner(null); };
  useEffect(()=>{
    if(!draftCheckedRef.current || draftBanner) return;
    if(saving) return;
    const t=setTimeout(()=>{
      const hasContent=question.trim()||subjectSel.name.trim()||pendingParts.length>0;
      if(hasContent) saveDraft(LS_DRAFT_SINGLE,{targetMode,qtype,subjectSel,topicSel,postSel,instSel,examYear,groupHeadingText,pendingParts,question,correct,opt1,opt2,opt3,opt4,explanation});
      else clearDraft(LS_DRAFT_SINGLE);
    },800);
    return ()=>clearTimeout(t);
  },[targetMode,qtype,subjectSel,topicSel,postSel,instSel,examYear,groupHeadingText,pendingParts,question,correct,opt1,opt2,opt3,opt4,explanation,saving,draftBanner]);

  /* ── কার্সর যেখানে আছে ঠিক সেখানে টেক্সট ইনসার্ট করার গতিশীল ফাংশন ── */
  const insertAtCursor=useCallback((text)=>{
    let el = qRef.current;
    let target = activeInputRef.current;

    if (target === "correct" && correctRef.current) el = correctRef.current;
    else if (target === "expl" && explRef.current) el = explRef.current;

    if(!el) {
      setQuestion(q=>q+text);
      return;
    }

    const start=el.selectionStart??el.value.length;
    const end=el.selectionEnd??el.value.length;
    const before=el.value.slice(0,start);
    const after=el.value.slice(end);
    const next=before+text+after;

    if (target === "correct") setCorrect(next);
    else if (target === "expl") setExplanation(next);
    else setQuestion(next);

    requestAnimationFrame(()=>{
      el.focus();
      const pos=start+text.length;
      el.setSelectionRange(pos,pos);
    });
  },[]);

  /* ── 🖼️ ইমেজ আইকনে ট্যাপ → ফাইল পিকার খোলে ── */
  const pickImage=useCallback(()=>{ imgInputRef.current?.click(); },[]);

  const onImageSelected=useCallback(async(e)=>{
    const files=Array.from(e.target.files||[]);
    e.target.value=""; // একই ছবি আবার সিলেক্ট করলেও onChange ফায়ার হবে
    if(!files.length) return;

    if(!IMGBB_API_KEY){ push("error","ImgBB key পাওয়া যায়নি","VITE_IMGBB_API_KEY env var সেট আছে কিনা চেক করো"); return; }

    setImgUploading(true);
    try{
      const urls=await Promise.all(files.map(f=>uploadImageToImgbb(f,IMGBB_API_KEY)));
      insertAtCursor(urls.join(", "));
      push("success",`🖼️ ${urls.length}টা ছবি আপলোড হয়েছে`,"লিংক কার্সরে বসানো হয়েছে");
    }catch(err){
      push("error","ছবি আপলোড ব্যর্থ",err.message);
    }
    setImgUploading(false);
  },[insertAtCursor,push]);

  /* ── ✨ AI দিয়ে অপশন/ব্যাখ্যা জেনারেট ── */
  const generate=useCallback(async()=>{
    if(!question.trim()||!correct.trim()){ push("warn","আগে প্রশ্ন ও উত্তর লিখো",""); return; }
    if(!buildKeyPool().length){ push("warn","⚠️ কোনো AI provider active নেই","API Settings-এ গিয়ে অন্তত একটা key active করো"); return; }
    setGenerating(true);
    try{
      const raw=await callAiProviderRotatingRaw(isMCQ?buildMcqGenPrompt(question,correct):buildExplGenPrompt(question,correct));
      const parsed=parseGenResponse(raw);
      if(isMCQ){
        const distractors=(parsed.options||[]).slice(0,3);
        while(distractors.length<3) distractors.push("");
        const [a,b,c,d]=shuffle4([correct,...distractors]); 
        setOpt1(a);setOpt2(b);setOpt3(c);setOpt4(d);
      }
      setExplanation(parsed.explanation||"");
      push("success","✨ Generate হয়েছে","চেক করে দরকার হলে ঠিক করে নাও");
    }catch(e){ push("error","Generate ব্যর্থ",e.message); }
    setGenerating(false);
  },[question,correct,isMCQ,push]);

  const resetForNext=()=>{
    setQuestion("");setCorrect("");
    setOpt1("");setOpt2("");setOpt3("");setOpt4("");
    setExplanation("");
    activeInputRef.current = "q";
    requestAnimationFrame(()=>qRef.current?.focus());
  };

  /* ── Ctrl+Enter: বর্তমান sub-part (এখনো সার্ভারে না পাঠিয়ে) pendingParts-এ জমা
     করে বক্স খালি করে দেয় — পরের sub-part লেখার জন্য রেডি। কোনো নেটওয়ার্ক কল হয় না। ── */
  const commitCurrentAsPending=useCallback(()=>{
    if(!question.trim()){ push("warn","প্রশ্ন লিখো","");qRef.current?.focus();return; }
    if(!correct.trim()){ push("warn","উত্তর লিখো",""); return; }
    if(isMCQ&&(!opt1.trim()||!opt2.trim()||!opt3.trim()||!opt4.trim())){ push("warn","৪টা অপশনই পূরণ করো","✨ Generate চাপো অথবা নিজে লিখো"); return; }
    setPendingParts(p=>[...p,{question:question.trim(),correct:correct.trim(),opt1,opt2,opt3,opt4,explanation}]);
    setQuestion("");setCorrect("");setOpt1("");setOpt2("");setOpt3("");setOpt4("");setExplanation("");
    activeInputRef.current="q";
    requestAnimationFrame(()=>qRef.current?.focus());
  },[question,correct,isMCQ,opt1,opt2,opt3,opt4,explanation,push]);

  const removePending=(idx)=>setPendingParts(p=>p.filter((_,i)=>i!==idx));

  /* ── Ctrl+S দিয়ে সাবমিট — গ্রুপ চলছে থাকলে (pendingParts বা groupHeadingText আছে)
     pendingParts + বর্তমান বক্সের কনটেন্ট (শেষ sub-part, আলাদা করে Ctrl+Enter লাগে
     না) সব একসাথে, একটাই নেটওয়ার্ক কলে সাবমিট হয়। গ্রুপ না থাকলে (হেডিং বক্স খালি,
     pendingParts-ও খালি) আগের মতোই তৎক্ষণাৎ একক-প্রশ্ন সাবমিট — কোনো আচরণ বদলায়নি। ── */
  const submit=useCallback(async()=>{
    if(saving||generating)return;
    const effGroupHeading=targetMode==="QBank"?groupHeadingText.trim():"";
    const isGroupSubmit=effGroupHeading&&pendingParts.length>0;

    // ── বর্তমান বক্সে কিছু টাইপ করা থাকলে সেটাকেই শেষ sub-part (বা একমাত্র প্রশ্ন)
    // ধরা হয় — গ্রুপ-সাবমিটের সময় খালি বক্স রেখে শুধু আগে জমানো অংশগুলোও ফাইনাল
    // করা যাবে (pendingParts.length থাকলে বক্স খালি হলেও চলবে)। ──
    const hasCurrent=question.trim()||correct.trim();
    if(!isGroupSubmit && !hasCurrent){ push("warn","প্রশ্ন লিখো","");qRef.current?.focus();return; }
    if(hasCurrent){
      if(!question.trim()){ push("warn","প্রশ্ন লিখো","");qRef.current?.focus();return; }
      if(!correct.trim()){ push("warn","উত্তর লিখো",""); return; }
      if(isMCQ&&(!opt1.trim()||!opt2.trim()||!opt3.trim()||!opt4.trim())){ push("warn","৪টা অপশনই পূরণ করো","✨ Generate চাপো অথবা নিজে লিখো"); return; }
    }
    if(!subjectSel.name.trim()){ push("warn","⚠️ Subject ফাঁকা","আগে পূরণ করো — ফাঁকা থাকলে সাবমিট হবে না"); return; }
    if(!refData){ push("warn","⏳ Reference data এখনো লোড হচ্ছে, একটু পর আবার চেষ্টা করো",""); return; }

    setSaving(true);

    // ── Subject/Topic টেক্সট থেকে subject_id/topic_id resolve-or-create (একবারই —
    // গ্রুপ-সাবমিটে সব sub-part একই subject/topic শেয়ার করে) ──
    const subjRes=await resolveOrCreateReference({sel:subjectSel,refType:"subjects",options:subjectOptions,gasSecret,sheet:targetMode,push});
    if(!subjRes.ok){ setSaving(false); push("error","❌ Subject যোগ/খুঁজে পাওয়া যায়নি",""); return; }
    const topicName=topicSel.name.trim()||subjectSel.name.trim();
    const topicRes=await resolveOrCreateReference({sel:topicSel.name.trim()?topicSel:{id:"",name:topicName},refType:"topics",options:topicOptions,gasSecret,parentId:subjRes.id,push});
    if(!topicRes.ok){ setSaving(false); push("error","❌ Topic যোগ/খুঁজে পাওয়া যায়নি",""); return; }
    if(subjRes.created||topicRes.created) fetchReferenceData({gasSecret}).then(setRefData).catch(()=>{});

    // ── QBank + পদ/প্রতিষ্ঠান/সালের অন্তত ১টা দেওয়া থাকলে → resolve/create করে examAppearance ──
    let examAppearance=null;
    if(targetMode==="QBank" && (postSel.name.trim()||instSel.name.trim()||examYear.trim())){
      if(!postSel.name.trim()||!instSel.name.trim()||!examYear.trim()){
        setSaving(false);
        push("warn","⚠️ পদ, প্রতিষ্ঠান ও সাল — একটা দিলে তিনটাই দিতে হবে (অথবা তিনটাই খালি রাখো)","");
        return;
      }
      const postRes=await resolveOrCreateReference({sel:postSel,refType:"posts",options:postOptions,gasSecret,push});
      if(!postRes.ok){ setSaving(false); push("error","❌ পদ যোগ/খুঁজে পাওয়া যায়নি",""); return; }
      const instRes=await resolveOrCreateReference({sel:instSel,refType:"institutions",options:instOptions,gasSecret,push});
      if(!instRes.ok){ setSaving(false); push("error","❌ প্রতিষ্ঠান যোগ/খুঁজে পাওয়া যায়নি",""); return; }
      examAppearance={postId:postRes.id,institutionId:instRes.id,year:examYear.trim()};
      if(postRes.created||instRes.created) fetchReferenceData({gasSecret}).then(setRefData).catch(()=>{});
    }

    const tagsArr=audienceTags.split(",").map(s=>s.trim()).filter(Boolean);
    const effQtype=isStudy?"Study":(isMCQ?"MCQ":"Written");

    // ── সবগুলো sub-part (আগে থেকে জমা + এখন বক্সে যা আছে) — একই group_id, ক্রমিক sub_index ──
    const allParts=[...pendingParts];
    if(hasCurrent) allParts.push({question:question.trim(),correct:correct.trim(),opt1,opt2,opt3,opt4,explanation});
    const groupId=effGroupHeading?("GRP_"+Date.now().toString(36).toUpperCase()):"";

    try{
      const rows=allParts.map((part,idx)=>buildSheetRow({
        item:{q:part.question,correct:part.correct,opt1:part.opt1,opt2:part.opt2,opt3:part.opt3,opt4:part.opt4,explanation:part.explanation},
        subject:subjectSel.name.trim(), subtopic:topicName, qtype:effQtype,
        audienceTags:tagsArr, mainQpaper:"", subjectId:subjRes.id, topicId:topicRes.id,
        groupId, subIndex:groupId?(idx+1):null, groupHeading:groupId?effGroupHeading:"",
      }));
      const res=await saveRowsToSheet({rows,targetTab:targetMode,gasSecret,push,examAppearance,source:"Single_Text"});
      if(res.added>0){
        push("success",`✅ ${rows.length>1?rows.length+"টা sub-part একসাথে":""} যোগ হয়েছে!`,`এই সেশনে মোট ${sessionCount+rows.length}টি`);
        if(res.examAppearancesLinkedToExisting>0) push("success","🔗 কিছু প্রশ্ন আগে থেকেই QBank-এ ছিল","নতুন করে যোগ হয়নি — শুধু এই পদ/প্রতিষ্ঠান/সালের Appearance জুড়ে দেওয়া হয়েছে");
        setPendingParts([]);
        setSessionCount(c=>c+rows.length);
        resetForNext();
      }
      else if(res.skipped>0) push("warn","⚠️ ইতিমধ্যে Sheet-এ আছে (duplicate)","একই প্রশ্ন আগে থেকেই আছে বলে যোগ হয়নি");
      else push("error","সেভ ব্যর্থ","Sheet-এ যোগ হয়নি — নেটওয়ার্ক সমস্যা হতে পারে, একটু পর আবার চেষ্টা করো");
    }catch(e){ push("error","সেভ ব্যর্থ",e.message); }
    setSaving(false);
  },[saving,generating,question,correct,subjectSel,topicSel,subjectOptions,topicOptions,isMCQ,opt1,opt2,opt3,opt4,explanation,audienceTags,isStudy,targetMode,gasSecret,refData,postSel,instSel,examYear,postOptions,instOptions,groupHeadingText,pendingParts,sessionCount,push]);

  /* ── গ্লোবাল Ctrl+S (ফাইনাল সাবমিট) ও Ctrl+Enter (পরবর্তী sub-part-এ যাও, এখনো সাবমিট না) ক্যাচার —
     QBank+Written হলে PaperComposer-এর নিজস্ব keydown হ্যান্ডলার চলে, এটা তখন no-op ── */
  const isPaperMode = targetMode==="QBank" && qtype==="Written";
  useEffect(()=>{
    if(isPaperMode) return;
    const onKey=e=>{
      if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==="s"){ e.preventDefault(); submit(); }
      else if((e.ctrlKey||e.metaKey)&&e.key==="Enter"){ e.preventDefault(); commitCurrentAsPending(); }
    };
    window.addEventListener("keydown",onKey);
    return()=>window.removeEventListener("keydown",onKey);
  },[submit,commitCurrentAsPending,isPaperMode]);

  return(
    <div className="page">
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10}}>
        <div style={{fontSize:13,fontWeight:800,color:C.text}}>✍️ Single প্রশ্ন এন্ট্রি</div>
        <div style={{fontSize:11,color:C.green,fontWeight:700}}>এই সেশনে যোগ হয়েছে: {sessionCount}টি</div>
      </div>

      {draftBanner&&(
        <div style={{background:"#052e16",border:"1px solid #16a34a55",borderRadius:12,padding:"12px 14px",marginBottom:14}}>
          <div style={{fontSize:12,fontWeight:800,color:"#4ade80",marginBottom:4}}>♻️ আগের অসম্পূর্ণ কাজ পাওয়া গেছে</div>
          <div style={{fontSize:11,color:"#86efac",marginBottom:10,lineHeight:1.5}}>
            {draftBanner.question?`একটা প্রশ্ন টাইপ করে Submit করা হয়নি — "${draftBanner.question.substring(0,50)}${draftBanner.question.length>50?"...":""}"`:"আগের Subject/পদ/প্রতিষ্ঠান সেটিংস পাওয়া গেছে।"}
          </div>
          <div style={{display:"flex",gap:8}}>
            <button className="btn bg" style={{flex:1,justifyContent:"center"}} onClick={discardDraft}>🗑 বাদ দাও</button>
            <button className="btn bp" style={{flex:2,justifyContent:"center"}} onClick={restoreDraft}>♻️ ফিরিয়ে আনো</button>
          </div>
        </div>
      )}

      {/* Target Sheet + Question Type */}
      <div style={{background:C.panel,border:`1px solid ${C.border}`,borderRadius:12,padding:"10px 14px",marginBottom:10}}>
        <div style={{fontSize:11,fontWeight:800,color:C.text,marginBottom:8}}>🎯 Target Sheet</div>
        <div style={{display:"flex",gap:6,marginBottom:isStudy?0:10}}>
          {["Quiz","QBank","Study"].map(m=>(
            <button key={m} className={`ftab${targetMode===m?" on":""}`} onClick={()=>setTargetMode(m)} style={{flex:1}}>{m}</button>
          ))}
        </div>
        {!isStudy&&(
          <>
            <div style={{fontSize:11,fontWeight:800,color:C.text,margin:"2px 0 8px"}}>❓ প্রশ্নের ধরন</div>
            <div style={{display:"flex",gap:6}}>
              {["MCQ","Written"].map(t=>(
                <button key={t} className={`tp2${qtype===t?" on":""}`} onClick={()=>setQtype(t)}>{t}</button>
              ))}
            </div>
          </>
        )}
      </div>

      <SaveLocationPicker value="sheet" onChange={()=>{}} gasSecret={gasSecret} onGasSecretChange={setGasSecret} compact/>

      {isPaperMode ? (
        <PaperComposer gasSecret={gasSecret} refData={refData} setRefData={setRefData} push={push} sessionCount={sessionCount} setSessionCount={setSessionCount}/>
      ) : (
      <>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:10}}>
        <div className="fld" style={{marginBottom:0}}>
          <label>📚 Subject</label>
          <TypeaheadCombo
            options={subjectOptions}
            value={subjectSel}
            onChange={setSubjectSel}
            placeholder="Subject লিখুন..."
            newLabel={`🆕 "${subjectSel.name.trim()}" নতুন Subject হিসেবে যোগ হবে`}
          />
        </div>
        <div className="fld" style={{marginBottom:0}}>
          <label>📌 Topic</label>
          <TypeaheadCombo
            options={topicOptions}
            value={topicSel}
            onChange={setTopicSel}
            placeholder={subjectSel.name.trim()?"খালি রাখলে Subject-ই বসবে":"আগে Subject লিখো"}
            newLabel={`🆕 "${topicSel.name.trim()}" নতুন Topic হিসেবে যোগ হবে`}
          />
        </div>
      </div>
      <div className="fld">
        <label>🏷️ Audience Tags (কমা দিয়ে একাধিক)</label>
        <input className="inp" value={audienceTags} onChange={e=>setAudienceTags(e.target.value)} placeholder="Job, Class 7..." tabIndex={12}/>
      </div>

      {/* পদ/প্রতিষ্ঠান/সাল — শুধু QBank target-এ, ঐচ্ছিক, সেশনজুড়ে থাকে */}
      {targetMode==="QBank"&&(
        <div style={{background:C.panel,border:`1px solid ${C.border}`,borderRadius:10,padding:"8px 10px",marginBottom:10}}>
          <div style={{fontSize:11,fontWeight:800,color:C.text,marginBottom:2}}>🧾 কোন প্রশ্নপত্র থেকে? (ঐচ্ছিক)</div>
          <div style={{fontSize:10,color:C.muted,marginBottom:8}}>দিলে এই সেশনের প্রতিটা প্রশ্নই এই Exam Appearance পাবে।</div>
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

      {targetMode==="QBank"&&(
        <div style={{background:C.panel,border:`1px solid ${C.border}`,borderRadius:10,padding:"8px 10px",marginBottom:10}}>
          <div style={{fontSize:11,fontWeight:800,color:C.text,marginBottom:2}}>🏷️ গ্রুপ হেডিং (ঐচ্ছিক)</div>
          <div style={{fontSize:10,color:C.muted,marginBottom:6,lineHeight:1.5}}>
            খালি = নিচের প্রশ্ন Ctrl+S দিলেই সাথে সাথে স্বাধীনভাবে সাবমিট হয়ে যাবে (আগের মতোই)।
            টেক্সট লিখলে = প্রতিটা sub-part লিখে <b>Ctrl+Enter</b> দিয়ে জমা রাখো (এখনো সাবমিট হয়
            না), সবশেষেরটা লিখে <b>Ctrl+S</b> দিলে জমা হওয়া সবগুলো + এইটা — একসাথে, একবারে
            গ্রুপ হয়ে সাবমিট হবে।
          </div>
          <input
            className="inp"
            placeholder='যেমন: "সন্ধি বিচ্ছেদ করুন:"'
            value={groupHeadingText}
            onChange={e=>setGroupHeadingText(e.target.value)}
          />
          {pendingParts.length>0&&(
            <div style={{marginTop:8,background:"#0000002a",borderRadius:8,padding:"6px 8px"}}>
              <div style={{fontSize:10,fontWeight:800,color:"#facc15",marginBottom:4}}>
                🔗 জমা আছে (এখনো সাবমিট হয়নি): {pendingParts.length}টা sub-part
              </div>
              {pendingParts.map((p,idx)=>(
                <div key={idx} style={{display:"flex",alignItems:"center",gap:6,fontSize:10,color:C.muted,padding:"2px 0"}}>
                  <span style={{flexShrink:0,fontWeight:700,color:C.text}}>{["ক","খ","গ","ঘ","ঙ","চ","ছ","জ","ঝ","ঞ"][idx]||idx+1})</span>
                  <span style={{flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{p.question}</span>
                  <button onClick={()=>removePending(idx)} style={{background:"transparent",border:"none",color:"#ef4444",cursor:"pointer",fontSize:12,flexShrink:0}}>✕</button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}


      <div style={{height:1,background:C.border,margin:"12px 0"}}/>

      {/* ── প্রশ্ন বক্স ── */}
      <div className="fld">
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
          <label style={{margin:0}}>❓ প্রশ্ন</label>
          <button type="button" onClick={pickImage} disabled={imgUploading} title="একটা বা একাধিক ছবি বেছে নাও (কার্সরে ছবি লিংক বসবে)"
            style={{background:"transparent",border:"none",cursor:imgUploading?"default":"pointer",
              fontSize:18,lineHeight:1,padding:"2px 4px",opacity:imgUploading?.5:1}}>
            {imgUploading?"⏳":"🖼️"}
          </button>
          <input ref={imgInputRef} type="file" accept="image/*" multiple onChange={onImageSelected} style={{display:"none"}}/>
        </div>
        <textarea ref={qRef} className="ta" value={question} 
          onFocus={()=>activeInputRef.current="q"}
          onChange={e=>setQuestion(e.target.value)}
          placeholder="বই দেখে প্রশ্ন টাইপ করো..." style={{minHeight:80}} tabIndex={1}/>
      </div>

      {/* ── উত্তর বক্স ── */}
      <div className="fld">
        <label>{isMCQ?"✅ সঠিক উত্তর":"✅ উত্তর"}</label>
        <textarea ref={correctRef} className="ta" value={correct} 
          onFocus={()=>activeInputRef.current="correct"}
          onChange={e=>setCorrect(e.target.value)}
          placeholder={isMCQ?"সঠিক উত্তরের টেক্সট...":"উত্তর লিখো..."} style={{minHeight:60}} tabIndex={2}/>
      </div>

      {isMCQ&&(
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:10}}>
          {[["ক",opt1,setOpt1,3],["খ",opt2,setOpt2,4],["গ",opt3,setOpt3,5],["ঘ",opt4,setOpt4,6]].map(([lbl,val,setter,ti])=>(
            <div key={lbl} className="fld" style={{marginBottom:0}}>
              <label>{lbl}. অপশন{val&&val===correct.trim()&&val.trim()?" ✅":""}</label>
              <input className="inp" value={val} onChange={e=>setter(e.target.value)} placeholder={`অপশন ${lbl}`} tabIndex={ti}/>
            </div>
          ))}
        </div>
      )}

      {/* ── ব্যাখ্যা বক্স ── */}
      <div className="fld">
        <label>📖 ব্যাখ্যা (ঐচ্ছিক)</label>
        <textarea ref={explRef} className="ta" value={explanation} 
          onFocus={()=>activeInputRef.current="expl"}
          onChange={e=>setExplanation(e.target.value)}
          placeholder="ব্যাখ্যা লিখো, বা ✨ Generate চাপো..." style={{minHeight:60}} tabIndex={7}/>
      </div>

      <div style={{display:"flex",gap:8,marginBottom:10}}>
        <button className="btn" disabled={generating||saving||!question.trim()||!correct.trim()}
          onClick={generate} tabIndex={8}
          style={{flex:1,justifyContent:"center",background:"#6366f122",color:"#6366f1",border:"1px solid #6366f144"}}>
          {generating?"⏳ Generate হচ্ছে...":`✨ ${isMCQ?"অপশন+ব্যাখ্যা":"ব্যাখ্যা"} Generate করো`}
        </button>
      </div>

      {targetMode==="QBank"&&groupHeadingText.trim()&&(
        <button className="btn" disabled={saving||generating||!question.trim()||!correct.trim()}
          onClick={commitCurrentAsPending}
          style={{width:"100%",justifyContent:"center",padding:"10px 0",fontSize:13,marginBottom:8,
            background:"#facc1522",color:"#facc15",border:"1px solid #facc1544"}}>
          ➕ এই sub-part জমা রাখো, পরেরটা লিখো (Ctrl+Enter)
        </button>
      )}

      <button className="btn bg" disabled={saving||generating} onClick={submit} tabIndex={9}
        style={{width:"100%",justifyContent:"center",padding:"12px 0",fontSize:14}}>
        {saving?"⏳ সেভ হচ্ছে...":pendingParts.length>0?`💾 সবগুলো (${pendingParts.length+(question.trim()?1:0)}টা) একসাথে সাবমিট করো (Ctrl+S)`:"💾 সাবমিট করো (Ctrl+S)"}
      </button>
      <div style={{textAlign:"center",fontSize:10,color:C.muted,marginTop:8}}>
        {targetMode==="QBank"&&groupHeadingText.trim()
          ?"Ctrl+Enter দিয়ে sub-part জমা রাখো · Ctrl+S দিয়ে সব একসাথে ফাইনাল সাবমিট"
          :"Tab দিয়ে পরের বক্সে যাও · Ctrl+S দিয়ে যেকোনো জায়গা থেকেই সাবমিট হবে"}
      </div>
      </>
      )}
    </div>
  );
}

/* ══════════ PAPER COMPOSER — QBank + Written নির্বাচন করলেই এই পুরো ইন্টারফেস চালু
   হয়ে যায় (Quiz/Study/MCQ-তে কোনো প্রভাব নেই, ওখানে ওপরের পুরনো ফর্মই থাকে)।
   বাংলা/ইংরেজি/গণিত/GK — ৪টা ট্যাব, প্রতিটায় একাধিক প্রশ্ন/গ্রুপ (ব্রাউজারের
   মেমোরিতেই) জমতে থাকে — কোনো নেটওয়ার্ক কল ছাড়াই। সবশেষে একদম নিচের "🚀 সব
   সাবমিট করো" বাটনে একটাই ক্লিকে, একটাই নেটওয়ার্ক কলে, পুরো প্রশ্নপত্র ডাটাবেজে
   জমা হয়ে যায়। ══════════ */

const PAPER_TABS = [
  { key:"bangla",  label:"বাংলা",  fixedSubject:"বাংলা",   grouped:true,  gkStyle:false },
  { key:"english", label:"ইংরেজি", fixedSubject:"English", grouped:true,  gkStyle:false },
  { key:"math",    label:"গণিত",   fixedSubject:"গণিত",    grouped:false, gkStyle:false },
  { key:"gk",      label:"GK",     fixedSubject:null,      grouped:false, gkStyle:true  },
];

const FORMAT_STYLES = [
  { v:"plain",     label:"Plain — সাধারণ প্রশ্ন-উত্তর" },
  { v:"table",     label:"Table — শব্দ | ব্যাখ্যা (যেমন সন্ধি বিচ্ছেদ)" },
  { v:"highlight", label:"Highlight — নির্দিষ্ট শব্দ মার্ক করা (যেমন কারক নির্ণয়)" },
  { v:"fillblank", label:"Fill-blank — বাক্যের ফাঁকে উত্তর (ইংরেজি)" },
];

let _paperIdCounter=0;
const newPaperId=()=>"it_"+(++_paperIdCounter)+"_"+Date.now().toString(36);
const newPaperItem=()=>({id:newPaperId(),question:"",answer:"",explanation:"",technique:""});
const newGroupCard=()=>({id:newPaperId(),formatStyle:"plain",heading:"",topicSel:{id:"",name:""},items:[newPaperItem()]});
const newFlatCard=(isGk)=>({id:newPaperId(),question:"",answer:"",explanation:"",technique:"",topicSel:{id:"",name:""},...(isGk?{subjectSel:{id:"",name:""}}:{})});
const makeInitialPaper=()=>({bangla:[newGroupCard()],english:[newGroupCard()],math:[newFlatCard(false)],gk:[newFlatCard(true)]});
const SUBLABELS=["ক","খ","গ","ঘ","ঙ","চ","ছ","জ","ঝ","ঞ","ট","ঠ","ড","ঢ"];

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

function PaperComposer({gasSecret,refData,setRefData,push,sessionCount,setSessionCount}){
  const[paper,setPaper]=useState(makeInitialPaper);
  const[activeTab,setActiveTab]=useState("bangla");
  const[saving,setSaving]=useState(false);
  const textareaRefs=useRef({});

  const tabDef=PAPER_TABS.find(t=>t.key===activeTab);
  const subjectOptions=refData?(refData.subjects||[]).filter(s=>s.sheet==="QBank").map(s=>({id:s.subject_id,name:s.subject_name})):[];
  const topicOptionsFor=subjId=>refData&&subjId?(refData.topics||[]).filter(t=>t.subject_id===subjId).map(t=>({id:t.topic_id,name:t.topic_name})):[];

  const setCards=(tab,updater)=>setPaper(p=>({...p,[tab]:updater(p[tab])}));
  const updateCard=(tab,cardId,patch)=>setCards(tab,cards=>cards.map(c=>c.id===cardId?{...c,...patch}:c));
  const removeCard=(tab,cardId)=>setCards(tab,cards=>cards.length>1?cards.filter(c=>c.id!==cardId):cards);
  const addCard=tab=>setCards(tab,cards=>[...cards,tab==="math"?newFlatCard(false):tab==="gk"?newFlatCard(true):newGroupCard()]);
  const updateItem=(tab,cardId,itemId,patch)=>setCards(tab,cards=>cards.map(c=>c.id===cardId?{...c,items:c.items.map(it=>it.id===itemId?{...it,...patch}:it)}:c));
  const addSubItem=(tab,cardId)=>setCards(tab,cards=>cards.map(c=>c.id===cardId?{...c,items:[...c.items,newPaperItem()]}:c));
  const removeSubItem=(tab,cardId,itemId)=>setCards(tab,cards=>cards.map(c=>c.id===cardId?{...c,items:c.items.length>1?c.items.filter(it=>it.id!==itemId):c.items}:c));

  /* ── 🖍 হাইলাইট — টেক্সট সিলেক্ট করে এই বাটন চাপলে সিলেকশনটা __..__ দিয়ে মার্ক হয়ে
     যায় (User App এই মার্কআপ দেখে সেই অংশটুকু bold/underline করে দেখাবে) ── */
  const wrapHighlight=(tab,cardId,itemId)=>{
    const el=textareaRefs.current[itemId];
    if(!el)return;
    const start=el.selectionStart, end=el.selectionEnd;
    if(start===end){ push("warn","আগে যে শব্দ/অংশ হাইলাইট করবে সেটা সিলেক্ট করো",""); return; }
    const val=el.value;
    const newVal=val.slice(0,start)+"__"+val.slice(start,end)+"__"+val.slice(end);
    updateItem(tab,cardId,itemId,{question:newVal});
    requestAnimationFrame(()=>{ el.focus(); const p=end+4; el.setSelectionRange(p,p); });
  };

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
    setSaving(true);
    try{
      const subjectIdCache={};
      const resolveFixedSubject=async name=>{
        if(subjectIdCache[name])return subjectIdCache[name];
        const res=await resolveOrCreateReference({sel:{id:"",name},refType:"subjects",options:subjectOptions,gasSecret,sheet:"QBank",push});
        if(!res.ok)throw new Error(`"${name}" Subject resolve ব্যর্থ`);
        subjectIdCache[name]=res.id;
        return res.id;
      };

      const allRows=[];
      for(const t of PAPER_TABS){
        for(const card of (paper[t.key]||[])){
          if(t.grouped){
            const validItems=(card.items||[]).filter(it=>it.question.trim());
            if(!validItems.length)continue;
            const subjId=await resolveFixedSubject(t.fixedSubject);
            const topicName=card.topicSel.name.trim();
            if(!topicName)throw new Error(`"${t.label}" ট্যাবে একটা কার্ডে Topic ফাঁকা আছে — Topic লিখো/বেছে নাও`);
            const topicRes=await resolveOrCreateReference({sel:card.topicSel,refType:"topics",options:topicOptionsFor(subjId),gasSecret,parentId:subjId,push});
            if(!topicRes.ok)throw new Error(`"${topicName}" Topic resolve ব্যর্থ`);
            const heading=card.heading.trim();
            const groupId=heading?("GRP_"+Date.now().toString(36).toUpperCase()+Math.random().toString(36).slice(2,6).toUpperCase()):"";
            validItems.forEach((it,idx)=>{
              allRows.push(buildSheetRow({
                item:{q:it.question.trim(),correct:it.answer.trim(),explanation:it.explanation,technique:it.technique},
                subject:t.fixedSubject,subtopic:topicName,qtype:"Written",
                audienceTags:[],mainQpaper:"",subjectId:subjId,topicId:topicRes.id,
                groupId,subIndex:groupId?(idx+1):null,groupHeading:groupId?heading:"",
                formatStyle:card.formatStyle!=="plain"?card.formatStyle:"",
              }));
            });
          } else {
            if(!card.question.trim())continue;
            let subjId;
            if(t.gkStyle){
              const subjName=(card.subjectSel.name||"").trim();
              if(!subjName)throw new Error(`GK ট্যাবে একটা প্রশ্নে Subject ফাঁকা আছে — কোন real subject (যেমন "সাধারণ বিজ্ঞান") সেটা বেছে দাও`);
              const sres=await resolveOrCreateReference({sel:card.subjectSel,refType:"subjects",options:subjectOptions,gasSecret,sheet:"QBank",push});
              if(!sres.ok)throw new Error(`"${subjName}" Subject resolve ব্যর্থ`);
              subjId=sres.id;
            } else {
              subjId=await resolveFixedSubject(t.fixedSubject);
            }
            const topicName=card.topicSel.name.trim();
            if(!topicName)throw new Error(`"${t.label}" ট্যাবে একটা প্রশ্নে Topic ফাঁকা আছে`);
            const topicRes=await resolveOrCreateReference({sel:card.topicSel,refType:"topics",options:topicOptionsFor(subjId),gasSecret,parentId:subjId,push});
            if(!topicRes.ok)throw new Error(`"${topicName}" Topic resolve ব্যর্থ`);
            allRows.push(buildSheetRow({
              item:{q:card.question.trim(),correct:card.answer.trim(),explanation:card.explanation,technique:card.technique},
              subject:t.gkStyle?card.subjectSel.name.trim():t.fixedSubject,subtopic:topicName,qtype:"Written",
              audienceTags:[],mainQpaper:"",subjectId:subjId,topicId:topicRes.id,
              groupId:"",subIndex:null,groupHeading:"",formatStyle:"",
            }));
          }
        }
      }

      if(!allRows.length){ push("warn","কোনো সম্পূর্ণ প্রশ্ন পাওয়া যায়নি","Topic ফাঁকা রাখলে সেই প্রশ্ন বাদ পড়ে যায়"); setSaving(false); return; }

      const res=await saveRowsToSheet({rows:allRows,targetTab:"QBank",gasSecret,push,source:"Single_Text_Paper"});
      if(res.added>0){
        push("success",`✅ পুরো প্রশ্নপত্র সাবমিট হয়েছে! (${res.added}টা প্রশ্ন)`,`এই সেশনে মোট ${sessionCount+res.added}টি`);
        setSessionCount(c=>c+res.added);
        setPaper(makeInitialPaper());
        setActiveTab("bangla");
        fetchReferenceData({gasSecret}).then(setRefData).catch(()=>{});
      } else if(res.skipped>0){
        push("warn","⚠️ সবগুলোই ইতিমধ্যে Sheet-এ আছে (duplicate)","");
      } else {
        push("error","সেভ ব্যর্থ","নেটওয়ার্ক সমস্যা হতে পারে, একটু পর আবার চেষ্টা করো");
      }
    }catch(e){
      push("error","সাবমিট ব্যর্থ",e.message);
    }
    setSaving(false);
  },[saving,gasSecret,paper,subjectOptions,refData,sessionCount,push,setRefData,setSessionCount]);

  useEffect(()=>{
    const onKey=e=>{ if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==="s"){ e.preventDefault(); submitPaper(); } };
    window.addEventListener("keydown",onKey);
    return()=>window.removeEventListener("keydown",onKey);
  },[submitPaper]);

  return(
    <div style={{background:PC.bg,margin:"0 -16px",padding:"14px 14px 4px",borderRadius:0}}>
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
                    onChange={e=>updateCard(activeTab,card.id,{heading:e.target.value})}/>
                </div>
                <div className="fld" style={{marginBottom:0,width:120,flexShrink:0}}>
                  <label>ফরম্যাট</label>
                  <select className="inp" value={card.formatStyle} onChange={e=>updateCard(activeTab,card.id,{formatStyle:e.target.value})}
                    style={{...pcField,fontSize:11}}>
                    {FORMAT_STYLES.map(f=>(<option key={f.v} value={f.v}>{f.label}</option>))}
                  </select>
                </div>
              </div>
              <div className="fld" style={{marginBottom:10}}>
                <label>📌 Topic (এই পুরো গ্রুপের জন্য একবারই)</label>
                <TypeaheadCombo
                  options={topicOptionsFor(subjectOptions.find(s=>s.name===tabDef.fixedSubject)?.id)}
                  value={card.topicSel}
                  onChange={sel=>updateCard(activeTab,card.id,{topicSel:sel})}
                  placeholder="Topic লিখো বা লিস্ট থেকে বেছে নাও..."
                  newLabel={`🆕 "${card.topicSel.name.trim()}" নতুন Topic হিসেবে যোগ হবে`}
                  inputStyle={pcField} lightTheme
                />
              </div>

              {card.items.map((it,idx)=>(
                <div key={it.id} style={{display:"flex",gap:8,padding:"8px 0",borderTop:idx>0?`1px dashed ${PC.border}`:"none"}}>
                  <div style={{width:22,flexShrink:0,fontWeight:800,color:PC.ink,fontSize:12,paddingTop:8}}>{SUBLABELS[idx]||idx+1}.</div>
                  <div style={{flex:1}}>
                    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                      <label style={{margin:0,fontSize:10.5,color:PC.muted,fontWeight:700}}>প্রশ্ন</label>
                      {card.formatStyle==="highlight"&&(
                        <button onClick={()=>wrapHighlight(activeTab,card.id,it.id)} title="সিলেক্ট করা অংশ হাইলাইট/আন্ডারলাইন করো"
                          style={{background:"#facc1522",color:"#facc15",border:"1px solid #facc1544",borderRadius:6,
                            fontSize:9.5,fontWeight:700,padding:"2px 8px",cursor:"pointer"}}>🖍 হাইলাইট করো</button>
                      )}
                    </div>
                    <textarea
                      ref={el=>{textareaRefs.current[it.id]=el;}}
                      className="ta" style={{...pcField,minHeight:44,fontSize:12.5}}
                      value={it.question} onChange={e=>updateItem(activeTab,card.id,it.id,{question:e.target.value})}
                      placeholder={card.formatStyle==="table"?"শব্দ (যেমন: অহর্নিশ)":"প্রশ্ন লিখো..."}/>
                    <label style={{fontSize:10.5,color:PC.muted,fontWeight:700,marginTop:4}}>উত্তর</label>
                    <input className="inp" style={{...pcField,fontSize:12.5,background:PC.answerBg,color:PC.answerText,borderColor:PC.answerText+"55"}}
                      value={it.answer} onChange={e=>updateItem(activeTab,card.id,it.id,{answer:e.target.value})}
                      placeholder={card.formatStyle==="table"?"বিচ্ছেদ/ব্যাখ্যা":"উত্তর লিখো..."}/>
                    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6,marginTop:4}}>
                      <input className="inp" style={{...pcField,fontSize:11}} placeholder="ব্যাখ্যা (ঐচ্ছিক)"
                        value={it.explanation} onChange={e=>updateItem(activeTab,card.id,it.id,{explanation:e.target.value})}/>
                      <input className="inp" style={{...pcField,fontSize:11}} placeholder="টেকনিক (ঐচ্ছিক)"
                        value={it.technique} onChange={e=>updateItem(activeTab,card.id,it.id,{technique:e.target.value})}/>
                    </div>
                  </div>
                  {card.items.length>1&&(
                    <button onClick={()=>removeSubItem(activeTab,card.id,it.id)} style={{background:"transparent",border:"none",color:"#ef4444",cursor:"pointer",fontSize:12,flexShrink:0,paddingTop:8}}>✕</button>
                  )}
                </div>
              ))}
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
                <div className="fld" style={{marginBottom:8}}>
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
              <div className="fld" style={{marginBottom:8}}>
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
                <label>❓ প্রশ্ন</label>
                <textarea className="ta" style={{...pcField,minHeight:70}} value={card.question}
                  onChange={e=>updateCard(activeTab,card.id,{question:e.target.value})}
                  placeholder="প্রশ্ন লিখো..."/>
              </div>
              <div className="fld" style={{marginBottom:8}}>
                <label>✅ উত্তর</label>
                <textarea className="ta" style={{...pcField,minHeight:50,background:PC.answerBg,color:PC.answerText,borderColor:PC.answerText+"55"}} value={card.answer}
                  onChange={e=>updateCard(activeTab,card.id,{answer:e.target.value})}
                  placeholder={activeTab==="math"?"চূড়ান্ত উত্তর (ধাপে-ধাপে সমাধান নিচে ব্যাখ্যায়)...":"উত্তর লিখো..."}/>
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
        <button className="btn" disabled={saving} onClick={submitPaper}
          style={{width:"100%",justifyContent:"center",padding:"13px 0",fontSize:14.5,
            background:PC.ink,color:"#fff",border:"none"}}>
          {saving?"⏳ সেভ হচ্ছে...":`🚀 সব সাবমিট করো — ${totalCount}টা প্রশ্ন (Ctrl+S)`}
        </button>
        <div style={{textAlign:"center",fontSize:9.5,color:PC.muted,marginTop:6}}>
          ৪টা ট্যাবেই যত প্রশ্ন জমা আছে (এখনো ডাটাবেজে যায়নি), সবগুলো একসাথে একবারে সাবমিট হবে
        </div>
      </div>
    </div>
  );
}

export { SingleQuestionEntryPage };
