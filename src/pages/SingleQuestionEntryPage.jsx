/* ══════════ SINGLE প্রশ্ন এন্ট্রি — বই দেখে দ্রুত টাইপ করার জন্য ══════════
   ওয়ার্কফ্লো: Subject/Sub-topic/Target Sheet একবার সেট করে রাখা হয় (সেশনজুড়ে
   অক্ষত থাকে) — তারপর শুধু প্রশ্ন লিখে, উত্তর লিখে, Tab দিয়ে দিয়ে পরের বক্সে
   গিয়ে (MCQ হলে ✨ Generate চেপে option+ব্যাখ্যা AI দিয়ে বানিয়ে), Ctrl+S চেপে
   সাবমিট — সাথে সাথে সব ফাঁকা হয়ে পরের প্রশ্নের জন্য cursor আবার প্রশ্ন-বক্সে
   ফিরে যায়। বইয়ের একটার পর একটা প্রশ্ন টাইপ করার জন্য optimized। */
import React, { useState, useRef, useEffect, useCallback } from "react";
import { C } from "../core/config.js";
import { callAiProviderRotatingRaw, buildKeyPool } from "../core/ocrProviders.js";
import { buildSheetRow, loadSharedGasSecret, saveSharedGasSecret, LS_DRAFT_SINGLE, LS_DRAFT_PAPER, loadDraft, saveDraft, clearDraft } from "../core/uploaderUtils.js";
import { saveRowsToSheet, fetchReferenceData, fetchReferenceDataVerbose } from "../core/sheetSave.js";
import { resolveOrCreateReference, norm } from "../core/referenceHelpers.js";
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
  // 🐛 ফিক্স ("Reference Data লোড হচ্ছে..." চিরকাল আটকে থাকা): আগে refData===null
  // দিয়েই "এখনো লোড হয়নি" আর "লোড ব্যর্থ হয়েছে" — দুটো একসাথে বোঝানো হতো, তাই
  // ব্যর্থ হলে চিরকাল "লোড হচ্ছে" স্পিনার দেখাতো, কোনো এরর/রিট্রাই ছাড়াই। এখন
  // refDataError আলাদাভাবে ট্র্যাক হয় — ব্যর্থ হলে আসল কারণ + 🔁 রিট্রাই বাটন
  // দেখানো যায় (PaperComposer-এ পাঠানো হয়, নিচে দেখো)। ──
  const[refData,setRefData]=useState(null);
  const[refDataError,setRefDataError]=useState(null);
  const[refDataLoading,setRefDataLoading]=useState(false);
  const loadRefData=useCallback(()=>{
    if(!gasSecret)return;
    setRefDataLoading(true); setRefDataError(null);
    fetchReferenceDataVerbose({gasSecret}).then(res=>{
      if(res.ok) setRefData(res.data);
      else setRefDataError(res.error||"অজানা কারণে রেফারেন্স ডেটা লোড ব্যর্থ হয়েছে");
      setRefDataLoading(false);
    });
  },[gasSecret]);
  useEffect(()=>{ loadRefData(); },[loadRefData]);
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
        <PaperComposer gasSecret={gasSecret} refData={refData} setRefData={setRefData} refDataError={refDataError} refDataLoading={refDataLoading} onRetryRefData={loadRefData} push={push} sessionCount={sessionCount} setSessionCount={setSessionCount}/>
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

// 🐛 ফিক্স (ভুল/ডুপ্লিকেট Subject তৈরি হওয়া — QB18 "বাংলা"/QB19 "English"):
// আগে বাংলা ও ইংরেজি ট্যাব সবসময় একটাই fixedSubject ("বাংলা"/"English") ব্যবহার
// করতো, যেটা আসল QBank শিটের real subject না — real subject হলো "বাংলা ব্যাকরণ"/
// "বাংলা সাহিত্য" আর "English Grammar"/"English Literature" (৪টা আলাদা, বিদ্যমান
// subject)। ফলে PaperComposer দিয়ে সাবমিট করা প্রতিটা বাংলা/ইংরেজি প্রশ্নই একটা
// ভুল/আলাদা "বাংলা"/"English" নামের নতুন Subject-এর নিচে চলে যেত, আসল ২টা subject-এর
// কোনোটার সাথেই মিলতো না। এখন এই ২টা ট্যাবে fixedSubject-এর বদলে subjectChoices
// (২টা আসল subject) — নিচে newGroupCard()-এ card.subjectChoice ডিফল্ট প্রথমটা
// (ব্যাকরণ/Grammar), আর Topic-লিস্ট দুটো subject-এর টপিক একসাথে মার্জ করে দেখায়
// (দেখো mergedTopicOptionsFor)। ──
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
const newPaperItem=()=>({id:newPaperId(),question:"",answer:"",explanation:"",technique:""});
// 🐛 ফিক্স: আগে প্রতিটা নতুন গ্রুপ-কার্ডে ১টা মাত্র সাব-পার্ট (ক) নিয়ে শুরু হতো —
// সন্ধি/কারক/Idioms-এর মতো টপিকে প্রায় সবসময়ই ৫টা সাব-পার্ট (ক-ঙ) থাকে, তাই প্রতিবার
// "+ আরেকটা সাব-পার্ট" চাপা লাগতো। এখন ডিফল্টভাবে ৫টা খালি বক্স নিয়েই শুরু হয় —
// কম লাগলে পাশের ✕ বাটনে চেপে বাদ দেওয়া যায় (আগে থেকেই ছিল)।
const DEFAULT_SUBPARTS=5;
const newGroupCard=()=>({id:newPaperId(),formatStyle:"plain",heading:"",topicSel:{id:"",name:""},subjectChoice:"grammar",
  items:Array.from({length:DEFAULT_SUBPARTS},()=>newPaperItem())});
const newFlatCard=(isGk)=>({id:newPaperId(),question:"",answer:"",explanation:"",technique:"",topicSel:{id:"",name:""},...(isGk?{subjectSel:{id:"",name:""}}:{})});
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

function PaperComposer({gasSecret,refData,setRefData,refDataError,refDataLoading,onRetryRefData,push,sessionCount,setSessionCount}){
  const[paper,setPaper]=useState(makeInitialPaper);
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

  const setCards=(tab,updater)=>setPaper(p=>({...p,[tab]:updater(p[tab])}));
  const updateCard=(tab,cardId,patch)=>setCards(tab,cards=>cards.map(c=>c.id===cardId?{...c,...patch}:c));
  const removeCard=(tab,cardId)=>setCards(tab,cards=>cards.length>1?cards.filter(c=>c.id!==cardId):cards);
  const addCard=tab=>setCards(tab,cards=>[...cards,tab==="math"?newFlatCard(false):tab==="gk"?newFlatCard(true):newGroupCard()]);
  const updateItem=(tab,cardId,itemId,patch)=>setCards(tab,cards=>cards.map(c=>c.id===cardId?{...c,items:c.items.map(it=>it.id===itemId?{...it,...patch}:it)}:c));
  const addSubItem=(tab,cardId)=>setCards(tab,cards=>cards.map(c=>c.id===cardId?{...c,items:[...c.items,newPaperItem()]}:c));
  const removeSubItem=(tab,cardId,itemId)=>setCards(tab,cards=>cards.map(c=>c.id===cardId?{...c,items:c.items.length>1?c.items.filter(it=>it.id!==itemId):c.items}:c));

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
     তাই বাধ্যতামূলক নয় এমন বক্সে বারবার Tab চেপে যেতে হয় না। ── */
  const handleGroupQKeyDown=(e,itemId)=>{
    if(e.key==="Tab"&&!e.shiftKey){ e.preventDefault(); answerRefs.current[itemId]?.focus(); }
  };
  const handleGroupAKeyDown=(e,tab,cardId,items,idx)=>{
    if(e.key==="Tab"&&!e.shiftKey){
      e.preventDefault();
      if(idx<items.length-1){
        textareaRefs.current[items[idx+1].id]?.focus();
      } else {
        pendingFocusRef.current={tab,cardId,flat:false};
        addSubItem(tab,cardId);
      }
    }
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
            if(!topicName)throw new Error(`"${t.label}" ট্যাবে একটা কার্ডে Topic ফাঁকা আছে — Topic লিখো/বেছে নাও`);
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
                audienceTags:[],mainQpaper:"",subjectId:subjId,topicId,
                groupId,subIndex:groupId?(idx+1):null,groupHeading:groupId?heading:"",
                formatStyle:effFormat!=="plain"?effFormat:"",
              }));
            });
          } else {
            if(!card.question.trim())continue;
            let subjId;
            if(t.gkStyle){
              const subjName=(card.subjectSel.name||"").trim();
              if(!subjName)throw new Error(`GK ট্যাবে একটা প্রশ্নে Subject ফাঁকা আছে — কোন real subject (যেমন "সাধারণ বিজ্ঞান") সেটা বেছে দাও`);
              subjId=await resolveSubjectCached(subjName);
            } else {
              subjId=await resolveFixedSubject(t.fixedSubject);
            }
            const topicName=card.topicSel.name.trim();
            if(!topicName)throw new Error(`"${t.label}" ট্যাবে একটা প্রশ্নে Topic ফাঁকা আছে`);
            const topicId=await resolveTopicCached(subjId,card.topicSel);
            if(!topicId)throw new Error(`"${topicName}" Topic resolve ব্যর্থ`);
            allRows.push(buildSheetRow({
              item:{q:card.question.trim(),correct:card.answer.trim(),explanation:card.explanation,technique:card.technique},
              subject:t.gkStyle?card.subjectSel.name.trim():t.fixedSubject,subtopic:topicName,qtype:"Written",
              audienceTags:[],mainQpaper:"",subjectId:subjId,topicId,
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
              <div className="fld" style={{marginBottom:6}}>
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
                return (
                <div key={it.id} style={{display:"flex",gap:8,padding:"8px 0",borderTop:idx>0?`1px dashed ${PC.border}`:"none"}}>
                  <div style={{width:22,flexShrink:0,fontWeight:800,color:PC.ink,fontSize:12,paddingTop:8}}>{SUBLABELS[idx]||idx+1}.</div>
                  <div style={{flex:1}}>
                    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                      <label style={{margin:0,fontSize:10.5,color:PC.muted,fontWeight:700}}>{activeTab==="english"?"Question":"প্রশ্ন"}</label>
                      {(card.formatStyle==="highlight"||card.formatStyle==="fillblank")&&(
                        <button onClick={()=>wrapHighlight(activeTab,card.id,it.id,card.formatStyle)}
                          title={card.formatStyle==="fillblank"?"যে শব্দ blank হবে সেটা সিলেক্ট করে মার্ক করো — এটাই Answer হয়ে সেভ হবে":"সিলেক্ট করা অংশ হাইলাইট/মার্ক করো"}
                          style={{background:"#facc1522",color:"#facc15",border:"1px solid #facc1544",borderRadius:6,
                            fontSize:9.5,fontWeight:700,padding:"2px 8px",cursor:"pointer"}}>🖍 {card.formatStyle==="fillblank"?"Blank মার্ক করো":"হাইলাইট করো"}</button>
                      )}
                    </div>
                    <textarea
                      ref={el=>{textareaRefs.current[it.id]=el;}}
                      className="ta" style={{...pcField,minHeight:44,fontSize:12.5}}
                      value={it.question} onChange={e=>updateItem(activeTab,card.id,it.id,{question:e.target.value})}
                      onKeyDown={e=>handleGroupQKeyDown(e,it.id)}
                      placeholder={card.formatStyle==="table"?(activeTab==="english"?"word":"শব্দ (যেমন: অহর্নিশ)"):card.formatStyle==="fillblank"?"_..._ বা 🖍 দিয়ে blank মার্ক করো...":activeTab==="english"?"Type the question...":"প্রশ্ন লিখো..."}/>
                    {/* 🐛 ফিক্স: Fill-blank সনাক্ত হলে (formatStyle থেকে বা সরাসরি _..._ টাইপ
                        করা থেকে) আলাদা raw answer বক্সের দরকার নেই — প্রশ্নের ভিতরের মার্ক করা
                        অংশটাই সাবমিটের সময় Answer হিসেবে auto বসে যায় (দেখো submitPaper)। ── */}
                    {(card.formatStyle==="fillblank"||detectAutoMarkup(it.question).style==="fillblank") ? (
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
                <textarea
                  ref={el=>{flatQRefs.current[card.id]=el;}}
                  className="ta" style={{...pcField,minHeight:70}} value={card.question}
                  onChange={e=>updateCard(activeTab,card.id,{question:e.target.value})}
                  onKeyDown={e=>handleFlatQKeyDown(e,card.id)}
                  placeholder="প্রশ্ন লিখো..."/>
              </div>
              <div className="fld" style={{marginBottom:8}}>
                <label>✅ উত্তর</label>
                <textarea
                  ref={el=>{flatARefs.current[card.id]=el;}}
                  className="ta" style={{...pcField,minHeight:50,background:PC.answerBg,color:PC.answerText,borderColor:PC.answerText+"55"}} value={card.answer}
                  onChange={e=>updateCard(activeTab,card.id,{answer:e.target.value})}
                  onKeyDown={e=>handleFlatAKeyDown(e,activeTab,card.id,paper[activeTab]||[],ci)}
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

export { SingleQuestionEntryPage };
