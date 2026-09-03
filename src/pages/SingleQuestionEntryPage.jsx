/* ══════════ SINGLE প্রশ্ন এন্ট্রি — বই দেখে অতি দ্রুত টাইপ করার জন্য ══════════
   ওয়ার্কফ্লো (নতুন, ২০২৬-০৯ রিডিজাইন): Subject/Topic/Post/Institution/সাল একবার
   সেট করে রাখা হয় (সেশনজুড়ে অক্ষত থাকে) — তারপর শুধু প্রশ্ন লিখে Enter, উত্তর
   লিখে Enter — এভাবে একটার পর একটা প্রশ্ন "সারিতে" (queue) জমা হতে থাকে, বক্স
   প্রতিবার খালি হয়ে কার্সর আবার প্রশ্ন-বক্সে ফিরে যায়, আগে-জমা-করা প্রশ্নগুলো
   ছোট লিস্ট আকারে উপরে উঠে যায়। Tab শুধু প্রশ্ন↔উত্তর বক্সে কাজ করে (Subject/
   Topic/অপশন/ব্যাখ্যা — এসব Tab দিয়ে ধরে না, মাউসে ক্লিক করে ভরতে হয়)। MCQ
   অপশন বক্স ডিফল্ট ভাবে লুকানো থাকে (অপশন বাধ্যতামূলক না) — চাইলে 🙈/🙉 বাটনে
   টগল করে দেখানো/লুকানো যায়, অবস্থা মনে রাখা হয়। যখন ইচ্ছা 💾 বাটনে চেপে সারিতে
   জমা হওয়া সবগুলো একসাথে সাবমিট করা যায় (Ctrl+S দিয়েও) — Quiz-এ Subject+Topic,
   QBank-এ Subject+Topic+পদ+প্রতিষ্ঠান+সাল — বাধ্যতামূলক। "💾 খসড়া হিসেবে সেভ করো"
   দিয়ে পুরো চলতি কাজ (সারিসহ) নাম-ছাড়া তালিকায় জমা রাখা যায় — একই খসড়া পরে লোড
   করে আবার সেভ করলে নতুন এন্ট্রি না বানিয়ে (id মিলিয়ে) আপডেট হয়ে যায়, ডুপ্লিকেট
   হয় না। */
import React, { useState, useRef, useEffect, useCallback } from "react";
import { C } from "../core/config.js";
import { callAiProviderRotatingRaw, buildKeyPool } from "../core/ocrProviders.js";
import { buildSheetRow, loadSharedGasSecret, saveSharedGasSecret, LS_DRAFT_SINGLE, LS_DRAFT_SINGLE_LIST, loadDraft, saveDraft, clearDraft, applyRichTextShortcut } from "../core/uploaderUtils.js";
import { saveRowsToSheet, fetchReferenceData, fetchReferenceDataVerbose } from "../core/sheetSave.js";
import { resolveOrCreateReference, norm } from "../core/referenceHelpers.js";
import { SaveLocationPicker } from "../components/shared/SaveLocationPicker.jsx";
import { TypeaheadCombo } from "../components/shared/TypeaheadCombo.jsx";
import { PaperComposer, buildMcqGenPrompt, buildExplGenPrompt, parseGenResponse, shuffle4 } from "../components/shared/PaperComposer.jsx";

/* ── ImgBB API key — রিপোর secret থেকে বিল্ড-টাইমে ইনজেক্ট হয় (Vite env var)। ── */
const IMGBB_API_KEY = import.meta.env.VITE_IMGBB_API_KEY || "";

/* ── MCQ অপশন বক্স ডিফল্ট-হাইড প্রেফারেন্স — লোকালস্টোরেজে মনে রাখা হয় ── */
const LS_OPTIONS_HIDDEN = "ss_single_options_hidden_v1";

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
  const[subjectSel,setSubjectSel]=useState({id:"",name:""});
  const[topicSel,setTopicSel]=useState({id:"",name:""});
  const[audienceTags,setAudienceTags]=useState("");

  // ── Subjects/Topics/Posts/Institutions রেফারেন্স টেবিল ──
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
  // একই appearance যোগ হবে। QBank-এ এই তিনটাই এখন সেভের জন্য বাধ্যতামূলক। ──
  const[postSel,setPostSel]=useState({id:"",name:""});
  const[instSel,setInstSel]=useState({id:"",name:""});
  const[examYear,setExamYear]=useState("");
  const postOptions=refData?(refData.posts||[]).map(p=>({id:p.post_id,name:p.post_name})):[];
  const instOptions=refData?(refData.institutions||[]).map(i=>({id:i.institution_id,name:i.institution_name})):[];

  // ── QBank-only ঐচ্ছিক ফিচার: একই "চলমান গ্রুপ হেডিং"-এর আন্ডারে একাধিক
  // sub-part (ক, খ, গ...) কে এক group_id দিয়ে যুক্ত করে সেভ করা (যেমন "সন্ধি
  // বিচ্ছেদ করো:" জাতীয় একটা কম্পোজিট প্রশ্ন)। হেডিং খালি রাখলে নিচের সারি
  // (queue)-এর প্রতিটা প্রশ্নই স্বাধীনভাবে (কোনো group_id ছাড়া) সেভ হয়। ──
  const[groupHeadingText,setGroupHeadingText]=useState("");

  // ── 🆕 দ্রুত এন্ট্রি "সারি" (queue) — Enter চেপে চেপে জমা করা প্রশ্নগুলো এখানে
  // জমা থাকে (এখনো সার্ভারে যায়নি), Quiz/QBank/Study — সব মোডেই কাজ করে।
  // প্রতিটা আইটেমের নিজস্ব id আছে (এডিট/রিমুভের জন্য)। ──
  const[pendingParts,setPendingParts]=useState([]); // [{id,question,correct,opt1..4,explanation}]
  const pidRef=useRef(0);
  const newPid=()=>{ pidRef.current+=1; return "p"+Date.now().toString(36)+pidRef.current; };

  // ── এই ফিল্ডগুলো প্রতি sub-part যোগ/সাবমিটের পর খালি হয়ে যায় ──
  const[question,setQuestion]=useState("");
  const[correct,setCorrect]=useState("");
  const[opt1,setOpt1]=useState(""); const[opt2,setOpt2]=useState("");
  const[opt3,setOpt3]=useState(""); const[opt4,setOpt4]=useState("");
  const[explanation,setExplanation]=useState("");

  // ── 🆕 MCQ অপশন বক্স হাইড/শো টগল — ডিফল্ট লুকানো, লোকালস্টোরেজে মনে থাকে ──
  const[optionsHidden,setOptionsHidden]=useState(()=>{
    try{ const v=localStorage.getItem(LS_OPTIONS_HIDDEN); return v===null?true:v==="1"; }catch{ return true; }
  });
  const toggleOptionsHidden=useCallback(()=>{
    setOptionsHidden(h=>{
      const next=!h;
      try{ localStorage.setItem(LS_OPTIONS_HIDDEN, next?"1":"0"); }catch{}
      return next;
    });
  },[]);

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

  // ── ড্রাফট অটোসেভ (নিঃশব্দ, ১টা "চলতি সেশন" স্লট) — টাইপ করে যাওয়া প্রশ্ন/
  // Subject/পদ-প্রতিষ্ঠান-সাল ভুলে ব্যাক চাপা বা রিলোডে হারিয়ে যাওয়া ঠেকাতে। ──
  const draftCheckedRef=useRef(false);
  const[draftBanner,setDraftBanner]=useState(null);
  useEffect(()=>{
    if(draftCheckedRef.current)return;
    draftCheckedRef.current=true;
    const d=loadDraft(LS_DRAFT_SINGLE);
    if(d&&((d.question&&d.question.trim())||(d.subjectSel&&d.subjectSel.name)||(d.pendingParts&&d.pendingParts.length))) setDraftBanner(d);
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

  // ── 🆕 নামসহ একাধিক খসড়া (Save as Draft + ড্রাফট লিস্ট) — উপরের অটো-ড্রাফট
  // থেকে আলাদা: এটা একটা লিস্ট (localStorage: LS_DRAFT_SINGLE_LIST), প্রতিটা
  // এন্ট্রি id দিয়ে ট্র্যাক হয়। একই খসড়া লোড করে আবার এডিট করে সেভ করলে
  // নতুন এন্ট্রি না বানিয়ে (id মিলিয়ে) আপডেট হয়ে যায় — ডুপ্লিকেট হয় না। ──
  const draftIdRef=useRef(0);
  const newDraftId=()=>{ draftIdRef.current+=1; return "d"+Date.now().toString(36)+draftIdRef.current; };
  const[draftList,setDraftList]=useState(()=>{
    try{ const raw=localStorage.getItem(LS_DRAFT_SINGLE_LIST); const arr=raw?JSON.parse(raw):[]; return Array.isArray(arr)?arr:[]; }catch{ return []; }
  });
  const[showDraftList,setShowDraftList]=useState(false);
  const[activeDraftId,setActiveDraftId]=useState(null);
  const persistDraftList=(list)=>{
    setDraftList(list);
    try{ localStorage.setItem(LS_DRAFT_SINGLE_LIST,JSON.stringify(list)); }catch{}
  };
  function draftHeadline(d){
    const s=((d.subjectSel&&d.subjectSel.name)||"").trim();
    const t=((d.topicSel&&d.topicSel.name)||"").trim();
    const parts=[s,t].filter(Boolean);
    let label=parts.length?parts.join(" — "):"নাম-ছাড়া খসড়া";
    const qn=(d.pendingParts?d.pendingParts.length:0)+((d.question||"").trim()?1:0);
    if(qn) label+=` (${qn}টা প্রশ্ন)`;
    return label;
  }
  function fmtDraftTime(ts){
    try{ return new Date(ts).toLocaleString("bn-BD",{hour:"2-digit",minute:"2-digit",day:"2-digit",month:"short"}); }catch{ return ""; }
  }
  const saveNamedDraft=useCallback(()=>{
    const hasContent=question.trim()||pendingParts.length>0||subjectSel.name.trim();
    if(!hasContent){ push("warn","এখনো কিছু টাইপ করা হয়নি","আগে কিছু লিখো, তারপর খসড়া সেভ করো"); return; }
    const id=activeDraftId||newDraftId();
    const entry={id,savedAt:Date.now(),targetMode,qtype,subjectSel,topicSel,postSel,instSel,examYear,audienceTags,groupHeadingText,pendingParts,question,correct,opt1,opt2,opt3,opt4,explanation};
    const exists=draftList.some(d=>d.id===id);
    const nextList=exists?draftList.map(d=>d.id===id?entry:d):[entry,...draftList].slice(0,30);
    persistDraftList(nextList);
    setActiveDraftId(id);
    push("success",exists?"💾 খসড়া আপডেট হলো":"💾 নতুন খসড়া হিসেবে সেভ হলো",draftHeadline(entry));
  },[question,pendingParts,subjectSel,activeDraftId,draftList,targetMode,qtype,topicSel,postSel,instSel,examYear,audienceTags,groupHeadingText,correct,opt1,opt2,opt3,opt4,explanation,push]);
  const loadNamedDraft=useCallback((entry)=>{
    if(entry.targetMode)setTargetMode(entry.targetMode);
    if(entry.qtype)setQtype(entry.qtype);
    if(entry.subjectSel)setSubjectSel(entry.subjectSel);
    if(entry.topicSel)setTopicSel(entry.topicSel);
    if(entry.postSel)setPostSel(entry.postSel);
    if(entry.instSel)setInstSel(entry.instSel);
    if(entry.examYear!==undefined)setExamYear(entry.examYear);
    if(entry.audienceTags!==undefined)setAudienceTags(entry.audienceTags);
    if(entry.groupHeadingText!==undefined)setGroupHeadingText(entry.groupHeadingText);
    if(entry.pendingParts!==undefined)setPendingParts(entry.pendingParts);
    if(entry.question!==undefined)setQuestion(entry.question);
    if(entry.correct!==undefined)setCorrect(entry.correct);
    if(entry.opt1!==undefined)setOpt1(entry.opt1); if(entry.opt2!==undefined)setOpt2(entry.opt2);
    if(entry.opt3!==undefined)setOpt3(entry.opt3); if(entry.opt4!==undefined)setOpt4(entry.opt4);
    if(entry.explanation!==undefined)setExplanation(entry.explanation);
    setActiveDraftId(entry.id);
    setShowDraftList(false);
    push("success","♻️ খসড়া লোড হলো",draftHeadline(entry));
  },[push]);
  const deleteNamedDraft=useCallback((id)=>{
    persistDraftList(draftList.filter(d=>d.id!==id));
    if(id===activeDraftId) setActiveDraftId(null);
  },[draftList,activeDraftId]);

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
        if(optionsHidden) toggleOptionsHidden(); // জেনারেট করলে দেখিয়ে দাও, না হলে চোখেই পড়বে না
      }
      setExplanation(parsed.explanation||"");
      push("success","✨ Generate হয়েছে","চেক করে দরকার হলে ঠিক করে নাও");
    }catch(e){ push("error","Generate ব্যর্থ",e.message); }
    setGenerating(false);
  },[question,correct,isMCQ,push,optionsHidden,toggleOptionsHidden]);

  const resetForNext=()=>{
    setQuestion("");setCorrect("");
    setOpt1("");setOpt2("");setOpt3("");setOpt4("");
    setExplanation("");
    activeInputRef.current = "q";
    requestAnimationFrame(()=>qRef.current?.focus());
  };

  /* ── 🆕 বর্তমান প্রশ্ন-উত্তর (এখনো সার্ভারে না পাঠিয়ে) pendingParts "সারি"-তে
     জমা করে বক্স খালি করে দেয় — পরের প্রশ্নের জন্য রেডি, কার্সর আবার প্রশ্ন-বক্সে।
     কোনো নেটওয়ার্ক কল হয় না। অপশন বাধ্যতামূলক না — খালি রাখলেও জমা হবে।
     উত্তর বক্সে প্লেইন Enter চাপলে এটাই কল হয় (Ctrl+Enter দিয়েও, যেকোনো বক্স
     থেকে, ব্যাকআপ হিসেবে)। ── */
  const commitCurrentAsPending=useCallback(()=>{
    if(!question.trim()){ push("warn","প্রশ্ন লিখো","");qRef.current?.focus();return; }
    if(!correct.trim()){ push("warn","উত্তর লিখো","");correctRef.current?.focus();return; }
    setPendingParts(p=>[...p,{id:newPid(),question:question.trim(),correct:correct.trim(),opt1,opt2,opt3,opt4,explanation}]);
    setQuestion("");setCorrect("");setOpt1("");setOpt2("");setOpt3("");setOpt4("");setExplanation("");
    activeInputRef.current="q";
    requestAnimationFrame(()=>qRef.current?.focus());
  },[question,correct,opt1,opt2,opt3,opt4,explanation,push]);

  const removePending=useCallback((id)=>setPendingParts(p=>p.filter(x=>x.id!==id)),[]);
  /* ── ✏️ সারিতে জমা থাকা কোনো একটা প্রশ্ন এডিট করতে চাইলে — সারি থেকে সরিয়ে
     বর্তমান বক্সে ফিরিয়ে আনে, আবার Enter/সাবমিট করলে নতুন করে জমা হয় (আগেরটা
     সারিতে আর থাকে না, তাই ডুপ্লিকেট হয় না)। ── */
  const editPending=useCallback((id)=>{
    setPendingParts(p=>{
      const item=p.find(x=>x.id===id);
      if(!item) return p;
      setQuestion(item.question);setCorrect(item.correct);
      setOpt1(item.opt1||"");setOpt2(item.opt2||"");setOpt3(item.opt3||"");setOpt4(item.opt4||"");
      setExplanation(item.explanation||"");
      activeInputRef.current="q";
      requestAnimationFrame(()=>qRef.current?.focus());
      return p.filter(x=>x.id!==id);
    });
  },[]);

  /* ── Ctrl+S দিয়ে সাবমিট — সারিতে (pendingParts) যা জমা আছে + বর্তমান বক্সের
     কনটেন্ট (শেষ প্রশ্ন, আলাদা করে Enter লাগে না) — সব একসাথে, একটাই নেটওয়ার্ক
     কলে সাবমিট হয়। QBank হলে group হেডিং টেক্সট থাকলে সবগুলো এক group_id
     পাবে (কম্পোজিট প্রশ্ন), না থাকলে প্রতিটা স্বাধীন প্রশ্ন হিসেবে সেভ হবে।
     Quiz-এ Subject+Topic, QBank-এ Subject+Topic+পদ+প্রতিষ্ঠান+সাল — বাধ্যতামূলক। ── */
  const submit=useCallback(async()=>{
    if(saving||generating)return;
    const effGroupHeading=targetMode==="QBank"?groupHeadingText.trim():"";
    const isGroupSubmit=effGroupHeading&&pendingParts.length>0;

    const hasCurrent=question.trim()||correct.trim();
    if(!isGroupSubmit && pendingParts.length===0 && !hasCurrent){ push("warn","প্রশ্ন লিখো","");qRef.current?.focus();return; }
    if(hasCurrent){
      if(!question.trim()){ push("warn","প্রশ্ন লিখো","");qRef.current?.focus();return; }
      if(!correct.trim()){ push("warn","উত্তর লিখো","");correctRef.current?.focus();return; }
    }
    if(!subjectSel.name.trim()){ push("warn","⚠️ Subject ফাঁকা","আগে পূরণ করো — ফাঁকা থাকলে সাবমিট হবে না"); return; }
    if(targetMode==="QBank"&&!postSel.name.trim()){ push("warn","⚠️ QBank-এ পদ (Post) বাধ্যতামূলক","আগে পূরণ করো"); return; }
    if(targetMode==="QBank"&&!instSel.name.trim()){ push("warn","⚠️ QBank-এ প্রতিষ্ঠান (Institution) বাধ্যতামূলক","আগে পূরণ করো"); return; }
    if(targetMode==="QBank"&&!examYear.trim()){ push("warn","⚠️ QBank-এ সাল বাধ্যতামূলক","আগে পূরণ করো"); return; }
    if(!refData){ push("warn","⏳ Reference data এখনো লোড হচ্ছে, একটু পর আবার চেষ্টা করো",""); return; }

    setSaving(true);

    // ── Subject/Topic টেক্সট থেকে subject_id/topic_id resolve-or-create (একবারই —
    // সারির সবগুলো প্রশ্ন একই subject/topic শেয়ার করে) ──
    const subjRes=await resolveOrCreateReference({sel:subjectSel,refType:"subjects",options:subjectOptions,gasSecret,sheet:targetMode,push});
    if(!subjRes.ok){ setSaving(false); push("error","❌ Subject যোগ/খুঁজে পাওয়া যায়নি",""); return; }
    const topicName=topicSel.name.trim()||subjectSel.name.trim();
    const topicRes=await resolveOrCreateReference({sel:topicSel.name.trim()?topicSel:{id:"",name:topicName},refType:"topics",options:topicOptions,gasSecret,parentId:subjRes.id,push});
    if(!topicRes.ok){ setSaving(false); push("error","❌ Topic যোগ/খুঁজে পাওয়া যায়নি",""); return; }
    if(subjRes.created||topicRes.created) fetchReferenceData({gasSecret}).then(setRefData).catch(()=>{});

    // ── QBank-এ পদ/প্রতিষ্ঠান/সাল — এখন সবসময় বাধ্যতামূলক (উপরে চেক হয়ে গেছে) → resolve/create করে examAppearance ──
    let examAppearance=null;
    if(targetMode==="QBank"){
      const postRes=await resolveOrCreateReference({sel:postSel,refType:"posts",options:postOptions,gasSecret,push});
      if(!postRes.ok){ setSaving(false); push("error","❌ পদ যোগ/খুঁজে পাওয়া যায়নি",""); return; }
      const instRes=await resolveOrCreateReference({sel:instSel,refType:"institutions",options:instOptions,gasSecret,push});
      if(!instRes.ok){ setSaving(false); push("error","❌ প্রতিষ্ঠান যোগ/খুঁজে পাওয়া যায়নি",""); return; }
      examAppearance={postId:postRes.id,institutionId:instRes.id,year:examYear.trim()};
      if(postRes.created||instRes.created) fetchReferenceData({gasSecret}).then(setRefData).catch(()=>{});
    }

    const tagsArr=audienceTags.split(",").map(s=>s.trim()).filter(Boolean);
    const effQtype=isStudy?"Study":(isMCQ?"MCQ":"Written");

    // ── সবগুলো প্রশ্ন (আগে থেকে সারিতে জমা + এখন বক্সে যা আছে) — group হেডিং
    // দেওয়া থাকলে একই group_id, ক্রমিক sub_index; না থাকলে প্রতিটা স্বাধীন ──
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
        push("success",`✅ ${rows.length>1?rows.length+"টা প্রশ্ন একসাথে":""} যোগ হয়েছে!`,`এই সেশনে মোট ${sessionCount+rows.length}টি`);
        if(res.examAppearancesLinkedToExisting>0) push("success","🔗 কিছু প্রশ্ন আগে থেকেই QBank-এ ছিল","নতুন করে যোগ হয়নি — শুধু এই পদ/প্রতিষ্ঠান/সালের Appearance জুড়ে দেওয়া হয়েছে");
        setPendingParts([]);
        setSessionCount(c=>c+rows.length);
        resetForNext();
        // ── সাবমিট সফল → চলতি খসড়া (যদি একটা লোড করে এডিট করছিল) এখন কাজ শেষ, তাই তালিকা থেকে সরিয়ে দাও ──
        if(activeDraftId){
          persistDraftList(draftList.filter(d=>d.id!==activeDraftId));
          setActiveDraftId(null);
        }
      }
      else if(res.skipped>0) push("warn","⚠️ ইতিমধ্যে Sheet-এ আছে (duplicate)","একই প্রশ্ন আগে থেকেই আছে বলে যোগ হয়নি");
      else push("error","সেভ ব্যর্থ","Sheet-এ যোগ হয়নি — নেটওয়ার্ক সমস্যা হতে পারে, একটু পর আবার চেষ্টা করো");
    }catch(e){ push("error","সেভ ব্যর্থ",e.message); }
    setSaving(false);
  },[saving,generating,question,correct,subjectSel,topicSel,subjectOptions,topicOptions,isMCQ,opt1,opt2,opt3,opt4,explanation,audienceTags,isStudy,targetMode,gasSecret,refData,postSel,instSel,examYear,postOptions,instOptions,groupHeadingText,pendingParts,sessionCount,push,activeDraftId,draftList]);

  /* ── Enter (প্লেইন, Shift/Ctrl ছাড়া): প্রশ্ন বক্সে থাকলে → উত্তর বক্সে ফোকাস
     সরায়। উত্তর বক্সে থাকলে → বর্তমান প্রশ্ন-উত্তর সারিতে জমা করে (commit) পরের
     প্রশ্নের জন্য বক্স খালি করে দেয়। Shift+Enter দিলে টেক্সটএরিয়াতে স্বাভাবিক
     নতুন লাইন হয় (নেভিগেশন/কমিট হয় না)। ── */
  const onQuestionKeyDown=useCallback(e=>{
    applyRichTextShortcut(e,setQuestion);
    if(e.key==="Enter"&&!e.shiftKey&&!e.ctrlKey&&!e.metaKey){
      e.preventDefault();
      correctRef.current?.focus();
    }
  },[]);
  const onAnswerKeyDown=useCallback(e=>{
    applyRichTextShortcut(e,setCorrect);
    if(e.key==="Enter"&&!e.shiftKey&&!e.ctrlKey&&!e.metaKey){
      e.preventDefault();
      commitCurrentAsPending();
    }
  },[commitCurrentAsPending]);

  /* ── গ্লোবাল Ctr+S (ফাইনাল সাবমিট) ও Ctrl+Enter (যেকোনো বক্স থেকে সারিতে জমা,
     ব্যাকআপ শর্টকাট) ক্যাচার — QBank+Written হলে PaperComposer-এর নিজস্ব keydown
     হ্যান্ডলার চলে, এটা তখন no-op ── */
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
            {draftBanner.question?`একটা প্রশ্ন টাইপ করে Submit করা হয়নি — "${draftBanner.question.substring(0,50)}${draftBanner.question.length>50?"...":""}"`:(draftBanner.pendingParts&&draftBanner.pendingParts.length?`সারিতে ${draftBanner.pendingParts.length}টা প্রশ্ন জমা ছিল, সাবমিট করা হয়নি।`:"আগের Subject/পদ/প্রতিষ্ঠান সেটিংস পাওয়া গেছে।")}
          </div>
          <div style={{display:"flex",gap:8}}>
            <button className="btn bg" style={{flex:1,justifyContent:"center"}} onClick={discardDraft} tabIndex={-1}>🗑 বাদ দাও</button>
            <button className="btn bp" style={{flex:2,justifyContent:"center"}} onClick={restoreDraft} tabIndex={-1}>♻️ ফিরিয়ে আনো</button>
          </div>
        </div>
      )}

      {/* Target Sheet + Question Type */}
      <div style={{background:C.panel,border:`1px solid ${C.border}`,borderRadius:12,padding:"10px 14px",marginBottom:10}}>
        <div style={{fontSize:11,fontWeight:800,color:C.text,marginBottom:8}}>🎯 Target Sheet</div>
        <div style={{display:"flex",gap:6,marginBottom:isStudy?0:10}}>
          {["Quiz","QBank","Study"].map(m=>(
            <button key={m} className={`ftab${targetMode===m?" on":""}`} onClick={()=>setTargetMode(m)} tabIndex={-1} style={{flex:1}}>{m}</button>
          ))}
        </div>
        {!isStudy&&(
          <>
            <div style={{fontSize:11,fontWeight:800,color:C.text,margin:"2px 0 8px"}}>❓ প্রশ্নের ধরন</div>
            <div style={{display:"flex",gap:6}}>
              {["MCQ","Written"].map(t=>(
                <button key={t} className={`tp2${qtype===t?" on":""}`} onClick={()=>setQtype(t)} tabIndex={-1}>{t}</button>
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
            tabIndex={-1}
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
            tabIndex={-1}
          />
        </div>
      </div>
      <div className="fld">
        <label>🏷️ Audience Tags (কমা দিয়ে একাধিক)</label>
        <input className="inp" value={audienceTags} onChange={e=>setAudienceTags(e.target.value)} placeholder="Job, Class 7..." tabIndex={-1}/>
      </div>

      {/* পদ/প্রতিষ্ঠান/সাল — শুধু QBank target-এ, এখন বাধ্যতামূলক, সেশনজুড়ে থাকে */}
      {targetMode==="QBank"&&(
        <div style={{background:C.panel,border:`1px solid ${C.border}`,borderRadius:10,padding:"8px 10px",marginBottom:10}}>
          <div style={{fontSize:11,fontWeight:800,color:C.text,marginBottom:2}}>🧾 কোন প্রশ্নপত্র থেকে? <span style={{color:"#f87171"}}>(বাধ্যতামূলক)</span></div>
          <div style={{fontSize:10,color:C.muted,marginBottom:8}}>এই সেশনের প্রতিটা প্রশ্নই এই Exam Appearance পাবে — QBank-এ সেভের জন্য তিনটাই লাগবে।</div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:8}}>
            <div className="fld" style={{marginBottom:0}}>
              <label>পদ (Post)</label>
              <TypeaheadCombo
                options={postOptions}
                value={postSel}
                onChange={setPostSel}
                placeholder="যেমন: সহকারী শিক্ষক"
                newLabel={`🆕 "${postSel.name.trim()}" নতুন পদ হিসেবে যোগ হবে`}
                tabIndex={-1}
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
                tabIndex={-1}
              />
            </div>
          </div>
          <div className="fld" style={{marginBottom:0}}>
            <label>সাল</label>
            <input className="inp" placeholder="যেমন: 2025" value={examYear} onChange={e=>setExamYear(e.target.value)} tabIndex={-1}/>
          </div>
        </div>
      )}

      {targetMode==="QBank"&&(
        <div style={{background:C.panel,border:`1px solid ${C.border}`,borderRadius:10,padding:"8px 10px",marginBottom:10}}>
          <div style={{fontSize:11,fontWeight:800,color:C.text,marginBottom:2}}>🏷️ গ্রুপ হেডিং (ঐচ্ছিক)</div>
          <div style={{fontSize:10,color:C.muted,marginBottom:6,lineHeight:1.5}}>
            খালি রাখলে নিচে সারিতে জমা হওয়া প্রশ্নগুলো প্রতিটা স্বাধীন প্রশ্ন হিসেবে সেভ হবে (ডিফল্ট, দ্রুত এন্ট্রির জন্য)।
            টেক্সট লিখলে = সারিতে জমা হওয়া সবগুলোকে একই কম্পোজিট প্রশ্নের sub-part (ক, খ, গ...) হিসেবে একই group_id দিয়ে সেভ করা হবে।
          </div>
          <input
            className="inp"
            placeholder='যেমন: "সন্ধি বিচ্ছেদ করুন:"'
            value={groupHeadingText}
            onChange={e=>setGroupHeadingText(e.target.value)}
            tabIndex={-1}
          />
        </div>
      )}

      <div style={{height:1,background:C.border,margin:"12px 0"}}/>

      {/* ── 🆕 দ্রুত এন্ট্রি সারি — Enter চেপে জমা হওয়া প্রশ্নগুলো, আগেরগুলো উপরে ── */}
      {pendingParts.length>0&&(
        <div style={{background:"#0000002a",border:`1px solid ${C.border}`,borderRadius:10,padding:"8px 10px",marginBottom:10}}>
          <div style={{fontSize:10,fontWeight:800,color:"#facc15",marginBottom:6}}>
            🔗 সারিতে জমা আছে (এখনো সাবমিট হয়নি): {pendingParts.length}টা প্রশ্ন
          </div>
          <div style={{maxHeight:180,overflowY:"auto"}}>
            {pendingParts.map((p,idx)=>(
              <div key={p.id} style={{display:"flex",alignItems:"center",gap:6,fontSize:10,color:C.muted,padding:"4px 0",borderBottom:idx<pendingParts.length-1?`1px dashed ${C.border}55`:"none"}}>
                <span style={{flexShrink:0,fontWeight:700,color:C.text}}>{idx+1}.</span>
                <span style={{flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{p.question} <span style={{color:C.green}}>— {p.correct}</span></span>
                <button onClick={()=>editPending(p.id)} tabIndex={-1} title="এডিট করো" style={{background:"transparent",border:"none",color:"#60a5fa",cursor:"pointer",fontSize:12,flexShrink:0}}>✏️</button>
                <button onClick={()=>removePending(p.id)} tabIndex={-1} title="বাদ দাও" style={{background:"transparent",border:"none",color:"#ef4444",cursor:"pointer",fontSize:12,flexShrink:0}}>✕</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── প্রশ্ন বক্স ── */}
      <div className="fld">
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
          <label style={{margin:0}}>❓ প্রশ্ন</label>
          <button type="button" onClick={pickImage} disabled={imgUploading} tabIndex={-1} title="একটা বা একাধিক ছবি বেছে নাও (কার্সরে ছবি লিংক বসবে)"
            style={{background:"transparent",border:"none",cursor:imgUploading?"default":"pointer",
              fontSize:18,lineHeight:1,padding:"2px 4px",opacity:imgUploading?.5:1}}>
            {imgUploading?"⏳":"🖼️"}
          </button>
          <input ref={imgInputRef} type="file" accept="image/*" multiple onChange={onImageSelected} style={{display:"none"}}/>
        </div>
        <textarea ref={qRef} className="ta" value={question} 
          onFocus={()=>activeInputRef.current="q"}
          onChange={e=>setQuestion(e.target.value)}
          onKeyDown={onQuestionKeyDown}
          placeholder="বই দেখে প্রশ্ন টাইপ করো, তারপর Enter..." style={{minHeight:80}} tabIndex={1}/>
      </div>

      {/* ── 🆕 MCQ অপশন হাইড/শো টগল — "প্রশ্নের পরে" বাটন, ডিফল্ট লুকানো, অবস্থা মনে থাকে ── */}
      {isMCQ&&(
        <div style={{display:"flex",justifyContent:"flex-end",marginTop:-4,marginBottom:6}}>
          <button type="button" onClick={toggleOptionsHidden} tabIndex={-1}
            style={{background:"transparent",border:`1px solid ${C.border}`,borderRadius:20,color:C.muted,cursor:"pointer",
              fontSize:10.5,fontWeight:700,padding:"3px 10px",display:"flex",alignItems:"center",gap:5}}>
            {optionsHidden?"🙈 অপশন বক্স হাইড আছে · দেখাও":"🙉 অপশন বক্স দেখানো আছে · হাইড করো"}
          </button>
        </div>
      )}

      {/* ── উত্তর বক্স ── */}
      <div className="fld">
        <label>{isMCQ?"✅ সঠিক উত্তর":"✅ উত্তর"}</label>
        <textarea ref={correctRef} className="ta" value={correct} 
          onFocus={()=>activeInputRef.current="correct"}
          onChange={e=>setCorrect(e.target.value)}
          onKeyDown={onAnswerKeyDown}
          placeholder={isMCQ?"সঠিক উত্তরের টেক্সট, তারপর Enter...":"উত্তর লিখো, তারপর Enter..."} style={{minHeight:60}} tabIndex={2}/>
        {isMCQ&&optionsHidden&&(
          <div style={{fontSize:9.5,color:C.muted,marginTop:4}}>অপশন বক্স হাইড করা আছে (ঐচ্ছিক) — শুধু প্রশ্ন+উত্তর লিখে Enter দিলেই সারিতে জমা হবে।</div>
        )}
      </div>

      {isMCQ&&!optionsHidden&&(
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:10}}>
          {[["ক",opt1,setOpt1],["খ",opt2,setOpt2],["গ",opt3,setOpt3],["ঘ",opt4,setOpt4]].map(([lbl,val,setter])=>(
            <div key={lbl} className="fld" style={{marginBottom:0}}>
              <label>{lbl}. অপশন (ঐচ্ছিক){val&&val===correct.trim()&&val.trim()?" ✅":""}</label>
              <input className="inp" value={val} onChange={e=>setter(e.target.value)} onKeyDown={e=>applyRichTextShortcut(e,setter)} placeholder={`অপশন ${lbl}`} tabIndex={-1}/>
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
          onKeyDown={e=>applyRichTextShortcut(e,setExplanation)}
          placeholder="ব্যাখ্যা লিখো, বা ✨ Generate চাপো..." style={{minHeight:60}} tabIndex={-1}/>
      </div>

      <div style={{display:"flex",gap:8,marginBottom:10}}>
        <button className="btn" disabled={generating||saving||!question.trim()||!correct.trim()}
          onClick={generate} tabIndex={-1}
          style={{flex:1,justifyContent:"center",background:"#6366f122",color:"#6366f1",border:"1px solid #6366f144"}}>
          {generating?"⏳ Generate হচ্ছে...":`✨ ${isMCQ?"অপশন+ব্যাখ্যা":"ব্যাখ্যা"} Generate করো`}
        </button>
      </div>

      {(question.trim()&&correct.trim())&&(
        <button className="btn" disabled={saving||generating}
          onClick={commitCurrentAsPending} tabIndex={-1}
          style={{width:"100%",justifyContent:"center",padding:"10px 0",fontSize:13,marginBottom:8,
            background:"#facc1522",color:"#facc15",border:"1px solid #facc1544"}}>
          ➕ এই প্রশ্নটা সারিতে জমা রাখো, পরেরটা লিখো (Enter)
        </button>
      )}

      <button className="btn bg" disabled={saving||generating} onClick={submit} tabIndex={-1}
        style={{width:"100%",justifyContent:"center",padding:"12px 0",fontSize:14}}>
        {saving?"⏳ সেভ হচ্ছে...":pendingParts.length>0?`💾 সবগুলো (${pendingParts.length+(question.trim()?1:0)}টা) একসাথে সাবমিট করো (Ctrl+S)`:"💾 সাবমিট করো (Ctrl+S)"}
      </button>

      <div style={{display:"flex",gap:8,marginTop:8}}>
        <button className="btn" onClick={saveNamedDraft} tabIndex={-1}
          style={{flex:1,justifyContent:"center",padding:"9px 0",fontSize:12,background:"#f59e0b22",color:"#f59e0b",border:"1px solid #f59e0b44"}}>
          💾 {activeDraftId?"খসড়া আপডেট করো":"খসড়া হিসেবে সেভ করো"}
        </button>
        <button className="btn" onClick={()=>setShowDraftList(v=>!v)} tabIndex={-1}
          style={{flex:1,justifyContent:"center",padding:"9px 0",fontSize:12,background:C.panel,color:C.text,border:`1px solid ${C.border}`}}>
          📂 ড্রাফট লিস্ট ({draftList.length}) {showDraftList?"▲":"▼"}
        </button>
      </div>
      {showDraftList&&(
        <div style={{background:C.panel,border:`1px solid ${C.border}`,borderRadius:10,marginTop:6,maxHeight:260,overflowY:"auto"}}>
          {draftList.length===0?(
            <div style={{padding:14,fontSize:11,color:C.muted,textAlign:"center"}}>এখনো কোনো খসড়া সেভ করা হয়নি</div>
          ):(
            [...draftList].sort((a,b)=>b.savedAt-a.savedAt).map(d=>(
              <div key={d.id} style={{display:"flex",alignItems:"center",gap:8,padding:"10px 12px",borderBottom:`1px dashed ${C.border}`,
                background:d.id===activeDraftId?"#22c55e15":"transparent"}}>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontSize:11.5,fontWeight:800,color:C.text,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{draftHeadline(d)}</div>
                  <div style={{fontSize:9.5,color:C.muted,marginTop:2}}>{fmtDraftTime(d.savedAt)}{d.id===activeDraftId?" · এখন এডিট হচ্ছে":""}</div>
                </div>
                <button type="button" tabIndex={-1} onClick={()=>loadNamedDraft(d)}
                  style={{flexShrink:0,padding:"6px 10px",borderRadius:7,fontSize:10.5,fontWeight:700,background:C.text,color:"#111",border:"none",cursor:"pointer"}}>লোড করো</button>
                <button type="button" tabIndex={-1} onClick={()=>deleteNamedDraft(d.id)}
                  style={{flexShrink:0,background:"transparent",border:"none",color:"#ef4444",cursor:"pointer",fontSize:14}}>🗑</button>
              </div>
            ))
          )}
        </div>
      )}

      <div style={{textAlign:"center",fontSize:10,color:C.muted,marginTop:8,lineHeight:1.6}}>
        প্রশ্ন লিখে Enter → উত্তর বক্সে যাবে · উত্তর লিখে Enter → সারিতে জমা হয়ে পরের প্রশ্নের জন্য বক্স খালি হবে<br/>
        Tab শুধু প্রশ্ন↔উত্তর বক্সে কাজ করে · Ctrl+S দিয়ে যেকোনো সময় জমা হওয়া সবগুলো একসাথে সাবমিট
      </div>
      </>
      )}
    </div>
  );
}

export { SingleQuestionEntryPage };
