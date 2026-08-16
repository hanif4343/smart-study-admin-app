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

  // ── এই ফিল্ডগুলো প্রতি সাবমিটের পর খালি হয়ে যায় ──
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
      const hasContent=question.trim()||subjectSel.name.trim();
      if(hasContent) saveDraft(LS_DRAFT_SINGLE,{targetMode,qtype,subjectSel,topicSel,postSel,instSel,examYear,question,correct,opt1,opt2,opt3,opt4,explanation});
      else clearDraft(LS_DRAFT_SINGLE);
    },800);
    return ()=>clearTimeout(t);
  },[targetMode,qtype,subjectSel,topicSel,postSel,instSel,examYear,question,correct,opt1,opt2,opt3,opt4,explanation,saving,draftBanner]);

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
    setSessionCount(c=>c+1);
    requestAnimationFrame(()=>qRef.current?.focus());
  };

  /* ── Ctrl+S দিয়ে সাবমিট ── */
  const submit=useCallback(async()=>{
    if(saving||generating)return;
    if(!question.trim()){ push("warn","প্রশ্ন লিখো","");qRef.current?.focus();return; }
    if(!correct.trim()){ push("warn","উত্তর লিখো",""); return; }
    if(!subjectSel.name.trim()){ push("warn","⚠️ Subject ফাঁকা","আগে পূরণ করো — ফাঁকা থাকলে সাবমিট হবে না"); return; }
    if(isMCQ&&(!opt1.trim()||!opt2.trim()||!opt3.trim()||!opt4.trim())){ push("warn","৪টা অপশনই পূরণ করো","✨ Generate চাপো অথবা নিজে লিখো"); return; }
    if(!refData){ push("warn","⏳ Reference data এখনো লোড হচ্ছে, একটু পর আবার চেষ্টা করো",""); return; }

    setSaving(true);

    // ── Subject/Topic টেক্সট থেকে subject_id/topic_id resolve-or-create ──
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

    const item={q:question.trim(),correct:correct.trim(),opt1,opt2,opt3,opt4,explanation};
    const tagsArr=audienceTags.split(",").map(s=>s.trim()).filter(Boolean);
    const effQtype=isStudy?"Study":(isMCQ?"MCQ":"Written");
    try{
      const row=buildSheetRow({
        item, subject:subjectSel.name.trim(), subtopic:topicName, qtype:effQtype,
        audienceTags:tagsArr, mainQpaper:"", subjectId:subjRes.id, topicId:topicRes.id,
      });
      const res=await saveRowsToSheet({rows:[row],targetTab:targetMode,gasSecret,push,examAppearance});
      if(res.added>0){
        push("success","✅ যোগ হয়েছে!",`এই সেশনে মোট ${sessionCount+1}টি`);
        if(res.examAppearancesLinkedToExisting>0) push("success","🔗 প্রশ্নটা আগে থেকেই QBank-এ ছিল","নতুন করে যোগ হয়নি — শুধু এই পদ/প্রতিষ্ঠান/সালের Appearance জুড়ে দেওয়া হয়েছে");
        resetForNext();
      }
      else if(res.skipped>0) push("warn","⚠️ ইতিমধ্যে Sheet-এ আছে (duplicate)","একই প্রশ্ন আগে থেকেই আছে বলে যোগ হয়নি");
      else push("error","সেভ ব্যর্থ","Sheet-এ যোগ হয়নি — নেটওয়ার্ক সমস্যা হতে পারে, একটু পর আবার চেষ্টা করো");
    }catch(e){ push("error","সেভ ব্যর্থ",e.message); }
    setSaving(false);
  },[saving,generating,question,correct,subjectSel,topicSel,subjectOptions,topicOptions,isMCQ,opt1,opt2,opt3,opt4,explanation,audienceTags,isStudy,targetMode,gasSecret,refData,postSel,instSel,examYear,postOptions,instOptions,sessionCount,push]);

  /* ── গ্লোবাল Ctrl+S ক্যাচার ── */
  useEffect(()=>{
    const onKey=e=>{
      if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==="s"){ e.preventDefault(); submit(); }
    };
    window.addEventListener("keydown",onKey);
    return()=>window.removeEventListener("keydown",onKey);
  },[submit]);

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

      <button className="btn bg" disabled={saving||generating} onClick={submit} tabIndex={9}
        style={{width:"100%",justifyContent:"center",padding:"12px 0",fontSize:14}}>
        {saving?"⏳ সেভ হচ্ছে...":"💾 সাবমিট করো (Ctrl+S)"}
      </button>
      <div style={{textAlign:"center",fontSize:10,color:C.muted,marginTop:8}}>
        Tab দিয়ে পরের বক্সে যাও · Ctrl+S দিয়ে যেকোনো জায়গা থেকেই সাবমিট হবে
      </div>
    </div>
  );
}

export { SingleQuestionEntryPage };
