/* ══════════ SINGLE প্রশ্ন এন্ট্রি — বই দেখে দ্রুত টাইপ করার জন্য ══════════
   ওয়ার্কফ্লো: Subject/Sub-topic/Target Sheet একবার সেট করে রাখা হয় (সেশনজুড়ে
   অক্ষত থাকে) — তারপর শুধু প্রশ্ন লিখে, উত্তর লিখে, Tab দিয়ে দিয়ে পরের বক্সে
   গিয়ে (MCQ হলে ✨ Generate চেপে option+ব্যাখ্যা AI দিয়ে বানিয়ে), Ctrl+S চেপে
   সাবমিট — সাবমিট চাপা মাত্রই (সেভ শেষ হওয়ার জন্য অপেক্ষা না করেই) সব ফাঁকা
   হয়ে যায় আর cursor সাথে সাথেই আবার প্রশ্ন-বক্সে ফিরে যায়; আসল সেভ পেছনে
   ব্যাকগ্রাউন্ডে চলতে থাকে ও শেষ হলে toast দিয়ে জানানো হয় — এতে বই দেখে
   একটার পর একটা প্রশ্ন টানা টাইপ করার গতি অনেক বাড়ে।
   MCQ-এর ৪টা অপশন AI দিয়ে বানাতে সময় লাগে বলে অপশন সেকশন হাইড করে রাখা
   যায় (👁️/🙈 বাটন) — হাইড থাকলে অপশন ফাঁকাই সাবমিট হয় (পরে আলাদা একটা
   auto/GitHub-server জব দিয়ে option বানানো হবে, AI Exp জবের মতোই) এবং
   Tab চাপলে ওই ৪টা বক্সে আর ঢুকতে হয় না। */
import React, { useState, useRef, useEffect, useCallback } from "react";
import { C } from "../core/config.js";
import { nowTs } from "../core/utils.js";
import { fbPush, fbSet } from "../core/firebase.js";
import { invalidate } from "../core/dataCache.js";
import { callAiProviderRotatingRaw, buildKeyPool } from "../core/ocrProviders.js";
import { buildBulkRecord, buildSheetRow, loadSharedGasSecret, saveSharedGasSecret } from "../core/uploaderUtils.js";
import { saveRowsToSheet } from "../core/sheetSave.js";
import { SaveLocationPicker } from "../components/shared/SaveLocationPicker.jsx";

/* ── অপশন-হাইড প্রেফারেন্স localStorage-এ রাখা হয় যাতে "একবার হাইড করলে" পরের বার
   পেজে ফিরলেও/অ্যাপ রিস্টার্ট করলেও হাইডই থাকে — যতক্ষণ না নিজে হাতে আনহাইড করা হয় ── */
const LS_OPTIONS_HIDDEN="sqe_options_hidden";
function loadOptionsHidden(){ try{ return localStorage.getItem(LS_OPTIONS_HIDDEN)==="1"; }catch{ return false; } }
function saveOptionsHidden(v){ try{ localStorage.setItem(LS_OPTIONS_HIDDEN, v?"1":"0"); }catch{} }

/* ── Audience tag chip picker-এর জন্য কিছু কমন সাজেশন — এক ট্যাপে যোগ করা যায় ── */
const QUICK_AUDIENCE_TAGS=["Job","HSC","SSC","Admission","Class 6","Class 7","Class 8","Class 9","Class 10","Class 11","Class 12"];

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
/* ── Written/Study-এর জন্য (এবং MCQ-এর অপশন হাইড থাকলে) শুধু ব্যাখ্যা বানানোর প্রম্পট ── */
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

function SingleQuestionEntryPage({push}){
  const[targetMode,setTargetMode]=useState("Quiz"); // Quiz | QBank | Study
  const[qtype,setQtype]=useState("MCQ"); // MCQ | Written — Study হলে অপ্রাসঙ্গিক
  const[saveLoc,setSaveLoc]=useState("firebase");
  const[gasSecret,setGasSecretState]=useState(loadSharedGasSecret());
  const setGasSecret=v=>{setGasSecretState(v);saveSharedGasSecret(v);};

  // ── এই ফিল্ডগুলো একবার সেট হলে সেশনজুড়ে থাকে (একই বই/অধ্যায় থেকে অনেক প্রশ্ন টাইপ হয় বলে) ──
  const[subject,setSubject]=useState("");
  const[subtopic,setSubtopic]=useState("");
  const[audienceTags,setAudienceTags]=useState([]); // chip array — Sheet/Firebase-এ আগের মতোই array হিসেবে যায়
  const[tagInput,setTagInput]=useState("");

  // ── MCQ-এর ৪টা অপশন বক্স হাইড করার প্রেফারেন্স — সেশন/অ্যাপ জুড়ে অক্ষত থাকে (localStorage) ──
  const[optionsHidden,setOptionsHidden]=useState(loadOptionsHidden);
  const toggleOptionsHidden=()=>{
    setOptionsHidden(h=>{ const nv=!h; saveOptionsHidden(nv); return nv; });
  };

  // ── এই ফিল্ডগুলো প্রতি সাবমিটের পর খালি হয়ে যায় ──
  const[question,setQuestion]=useState("");
  const[correct,setCorrect]=useState("");
  const[opt1,setOpt1]=useState(""); const[opt2,setOpt2]=useState("");
  const[opt3,setOpt3]=useState(""); const[opt4,setOpt4]=useState("");
  const[explanation,setExplanation]=useState("");

  const[generating,setGenerating]=useState(false);
  const[pendingSaves,setPendingSaves]=useState(0); // ব্যাকগ্রাউন্ডে কয়টা সেভ চলছে (UI ব্লক করে না, শুধু জানানোর জন্য)
  const[sessionCount,setSessionCount]=useState(0);

  const qRef=useRef(null);
  const isStudy=targetMode==="Study";
  const isMCQ=!isStudy&&qtype==="MCQ";
  const mcqOptionsNeeded=isMCQ&&!optionsHidden; // অপশন হাইড থাকলে MCQ-তেও অপশন লাগবে না — পরে আলাদাভাবে auto-generate হবে

  useEffect(()=>{ qRef.current?.focus(); },[]);

  /* ── Audience tag chip helpers ── */
  const addTag=useCallback((raw)=>{
    const t=raw.trim();
    if(!t) return;
    setAudienceTags(prev=>prev.includes(t)?prev:[...prev,t]);
    setTagInput("");
  },[]);
  const removeTag=useCallback((t)=>{
    setAudienceTags(prev=>prev.filter(x=>x!==t));
  },[]);

  /* ── ✨ AI দিয়ে অপশন/ব্যাখ্যা জেনারেট — অপশন হাইড থাকলে MCQ হলেও শুধু ব্যাখ্যাই বানানো হয় (দ্রুত) ── */
  const generate=useCallback(async()=>{
    if(!question.trim()||!correct.trim()){ push("warn","আগে প্রশ্ন ও উত্তর লিখো",""); return; }
    if(!buildKeyPool().length){ push("warn","⚠️ কোনো AI provider active নেই","API Settings-এ গিয়ে অন্তত একটা key active করো"); return; }
    const wantOptions=isMCQ&&!optionsHidden;
    setGenerating(true);
    try{
      const raw=await callAiProviderRotatingRaw(wantOptions?buildMcqGenPrompt(question,correct):buildExplGenPrompt(question,correct));
      const parsed=parseGenResponse(raw);
      if(wantOptions){
        const distractors=(parsed.options||[]).slice(0,3);
        while(distractors.length<3) distractors.push("");
        const [a,b,c,d]=shuffle4([correct,...distractors]); // সঠিক উত্তরটা এলোমেলো অবস্থানে বসে, সবসময় একই জায়গায় না
        setOpt1(a);setOpt2(b);setOpt3(c);setOpt4(d);
      }
      setExplanation(parsed.explanation||"");
      push("success","✨ Generate হয়েছে","চেক করে দরকার হলে ঠিক করে নাও");
    }catch(e){ push("error","Generate ব্যর্থ",e.message); }
    setGenerating(false);
  },[question,correct,isMCQ,optionsHidden,push]);

  const resetForNext=()=>{
    setQuestion("");setCorrect("");
    setOpt1("");setOpt2("");setOpt3("");setOpt4("");
    setExplanation("");
    setSessionCount(c=>c+1);
    requestAnimationFrame(()=>qRef.current?.focus());
  };

  /* ── Ctrl+S দিয়ে সাবমিট — চাপা মাত্রই ফিল্ড খালি হয়ে cursor প্রশ্ন-বক্সে ফিরে যায় (optimistic),
     আসল নেটওয়ার্ক সেভটা ব্যাকগ্রাউন্ডে চলে ও শেষে toast দিয়ে ফলাফল জানায়। Subject/Sub-topic ফাঁকা
     থাকলে কখনোই সাবমিট হবে না — OCR পেজের মতোই নিয়ম। শুধু AI Generate চলাকালীন সাবমিট আটকানো
     থাকে (নাহলে generate-এর রেজাল্ট ভুল করে পরের প্রশ্নে বসে যেতে পারে)। ──*/
  const submit=useCallback(()=>{
    if(generating)return;
    if(!question.trim()){ push("warn","প্রশ্ন লিখো","");qRef.current?.focus();return; }
    if(!correct.trim()){ push("warn","উত্তর লিখো",""); return; }
    if(!subject.trim()||!subtopic.trim()){ push("warn","⚠️ Subject/Sub-topic ফাঁকা","আগে পূরণ করো — ফাঁকা থাকলে সাবমিট হবে না"); return; }
    // ── MCQ-এর অপশন ফাঁকা থাকলেও সাবমিট আটকানো হয় না — ফাঁকা অপশনসহ MCQ পরে GitHub server-এর
    //    জব দিয়ে (QBank→Quiz কনভার্টের মতোই) auto-fill হবে, তাই এখানে ব্লক করার দরকার নেই ──

    // ── স্ন্যাপশট — কারণ নিচে reset হয়ে গেলে state খালি হয়ে যাবে ──
    const snapQ=question.trim();
    const item={q:snapQ,correct:correct.trim(),opt1,opt2,opt3,opt4,explanation};
    const tagsArr=[...audienceTags];
    const effQtype=isStudy?"Study":(isMCQ?"MCQ":"Written");
    const snapSubject=subject.trim(),snapSubtopic=subtopic.trim();
    const snapSaveLoc=saveLoc,snapTargetMode=targetMode,snapGasSecret=gasSecret;

    // ── Optimistic UI: সাথে সাথেই ফাঁকা + cursor ফেরত, তারপর ব্যাকগ্রাউন্ডে সেভ ──
    resetForNext();
    setPendingSaves(c=>c+1);

    (async()=>{
      try{
        if(snapSaveLoc==="sheet"){
          const row=buildSheetRow({item,subject:snapSubject,subtopic:snapSubtopic,qtype:effQtype,audienceTags:tagsArr,mainQpaper:""});
          const res=await saveRowsToSheet({rows:[row],targetTab:snapTargetMode,gasSecret:snapGasSecret,push});
          if(res.added>0) push("success","✅ ব্যাকগ্রাউন্ডে সেভ হয়েছে",snapQ.length>40?snapQ.slice(0,40)+"...":snapQ);
          else push("error","সেভ ব্যর্থ",`"${snapQ.slice(0,30)}..." — Sheet-এ যোগ হয়নি, duplicate বা নেটওয়ার্ক সমস্যা হতে পারে`);
        }else{
          const ts=nowTs();
          const id=Date.now()+Math.floor(Math.random()*9999);
          const rec=buildBulkRecord({item,subject:snapSubject,subtopic:snapSubtopic,mode:snapTargetMode,qtype:effQtype,audienceTags:tagsArr,ts,id});
          const res=await fbPush(snapTargetMode,rec);
          if(res?.name) await fbSet(`${snapTargetMode}/${res.name}/id`,res.name);
          invalidate(snapTargetMode);
          push("success","✅ ব্যাকগ্রাউন্ডে সেভ হয়েছে",snapQ.length>40?snapQ.slice(0,40)+"...":snapQ);
        }
      }catch(e){
        push("error","সেভ ব্যর্থ",`"${snapQ.slice(0,30)}..." — ${e.message}`);
      }finally{
        setPendingSaves(c=>Math.max(0,c-1));
      }
    })();
  },[generating,question,correct,subject,subtopic,opt1,opt2,opt3,opt4,explanation,audienceTags,isStudy,isMCQ,saveLoc,targetMode,gasSecret,push]);

  /* ── গ্লোবাল Ctrl+S ক্যাচার — যেকোনো টেক্সটবক্সে ফোকাস থাকলেও কাজ করবে, ব্রাউজারের নিজের Save ডায়ালগ আটকাবে ── */
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
        <div style={{display:"flex",alignItems:"center",gap:8}}>
          {pendingSaves>0&&<div style={{fontSize:10,color:C.muted,fontWeight:700}}>⏳ ব্যাকগ্রাউন্ডে সেভ হচ্ছে: {pendingSaves}</div>}
          <div style={{fontSize:11,color:C.green,fontWeight:700}}>এই সেশনে যোগ হয়েছে: {sessionCount}টি</div>
        </div>
      </div>

      {/* Target Sheet + Question Type — সেশনজুড়ে অক্ষত থাকে */}
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

      <SaveLocationPicker value={saveLoc} onChange={setSaveLoc} gasSecret={gasSecret} onGasSecretChange={setGasSecret} compact/>

      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:10}}>
        <div className="fld" style={{marginBottom:0}}>
          <label>📚 Subject</label>
          <input className="inp" value={subject} onChange={e=>setSubject(e.target.value)} placeholder="Subject লিখুন..." tabIndex={10}/>
        </div>
        <div className="fld" style={{marginBottom:0}}>
          <label>📌 Sub-topic</label>
          <input className="inp" value={subtopic} onChange={e=>setSubtopic(e.target.value)} placeholder="Sub-topic লিখুন..." tabIndex={11}/>
        </div>
      </div>

      {/* 🏷️ Audience Tags — chip picker: টাইপ করে Enter/কমা চাপো অথবা নিচের সাজেশন থেকে এক ট্যাপে যোগ করো */}
      <div className="fld">
        <label>🏷️ Audience Tags</label>
        <div style={{display:"flex",flexWrap:"wrap",gap:6,alignItems:"center",
          border:`1px solid ${C.border}`,borderRadius:10,padding:"6px 8px",background:C.panel}}>
          {audienceTags.map(t=>(
            <span key={t} style={{display:"flex",alignItems:"center",gap:4,background:"#6366f122",color:"#6366f1",
              border:"1px solid #6366f144",borderRadius:999,padding:"3px 8px",fontSize:11,fontWeight:700,whiteSpace:"nowrap"}}>
              {t}
              <button type="button" onClick={()=>removeTag(t)}
                style={{background:"none",border:"none",color:"#6366f1",cursor:"pointer",fontSize:12,lineHeight:1,padding:0}}>✕</button>
            </span>
          ))}
          <input className="inp" value={tagInput}
            onChange={e=>setTagInput(e.target.value)}
            onKeyDown={e=>{
              if(e.key==="Enter"||e.key===","){ e.preventDefault(); addTag(tagInput); }
              else if(e.key==="Backspace"&&!tagInput&&audienceTags.length>0){ removeTag(audienceTags[audienceTags.length-1]); }
            }}
            onBlur={()=>{ if(tagInput.trim()) addTag(tagInput); }}
            placeholder={audienceTags.length?"আরও যোগ করো...":"Job, Class 7... (Enter চাপো)"}
            style={{flex:1,minWidth:100,border:"none",outline:"none",background:"transparent",padding:"4px 2px",fontSize:12,color:C.text}}
            tabIndex={12}/>
        </div>
        {QUICK_AUDIENCE_TAGS.filter(t=>!audienceTags.includes(t)).length>0&&(
          <div style={{display:"flex",flexWrap:"wrap",gap:5,marginTop:6}}>
            {QUICK_AUDIENCE_TAGS.filter(t=>!audienceTags.includes(t)).map(t=>(
              <button key={t} type="button" onClick={()=>addTag(t)}
                style={{fontSize:10,fontWeight:700,color:C.muted,background:C.card,border:`1px dashed ${C.border}`,
                  borderRadius:999,padding:"3px 9px",cursor:"pointer"}}>+ {t}</button>
            ))}
          </div>
        )}
      </div>

      <div style={{height:1,background:C.border,margin:"12px 0"}}/>

      {/* ── দ্রুত টাইপিং লুপ: প্রশ্ন → উত্তর → (MCQ + অপশন হাইড না থাকলে অপশন) → ব্যাখ্যা → Ctrl+S ── */}
      <div className="fld">
        <label>❓ প্রশ্ন</label>
        <textarea ref={qRef} className="ta" value={question} onChange={e=>setQuestion(e.target.value)}
          placeholder="বই দেখে প্রশ্ন টাইপ করো..." style={{minHeight:80}} tabIndex={1}/>
      </div>
      <div className="fld">
        <label>{isMCQ?"✅ সঠিক উত্তর":"✅ উত্তর"}</label>
        <textarea className="ta" value={correct} onChange={e=>setCorrect(e.target.value)}
          placeholder={isMCQ?"সঠিক উত্তরের টেক্সট...":"উত্তর লিখো..."} style={{minHeight:60}} tabIndex={2}/>
      </div>

      {isMCQ&&(
        <div style={{marginBottom:10}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:optionsHidden?0:8}}>
            <div style={{fontSize:11,fontWeight:800,color:C.text}}>
              🔤 অপশনসমূহ{optionsHidden?" — হাইড করা আছে":""}
            </div>
            <button type="button" onClick={toggleOptionsHidden}
              style={{fontSize:10,fontWeight:700,color:optionsHidden?C.green:C.muted,
                background:"transparent",border:`1px solid ${C.border}`,borderRadius:999,
                padding:"3px 10px",cursor:"pointer"}}>
              {optionsHidden?"👁️ অপশন দেখাও":"🙈 অপশন হাইড করো"}
            </button>
          </div>
          {!optionsHidden?(
            <>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
                {[["ক",opt1,setOpt1,3],["খ",opt2,setOpt2,4],["গ",opt3,setOpt3,5],["ঘ",opt4,setOpt4,6]].map(([lbl,val,setter,ti])=>(
                  <div key={lbl} className="fld" style={{marginBottom:0}}>
                    <label>{lbl}. অপশন{val&&val===correct.trim()&&val.trim()?" ✅":""}</label>
                    <input className="inp" value={val} onChange={e=>setter(e.target.value)} placeholder={`অপশন ${lbl}`} tabIndex={ti}/>
                  </div>
                ))}
              </div>
              <div style={{fontSize:10,color:C.muted,marginTop:6}}>
                অপশন ঐচ্ছিক — ফাঁকা রাখলেও সাবমিট আটকাবে না, পরে GitHub server-এর জব (QBank→Quiz-এর মতো) দিয়ে auto-fill হবে।
              </div>
            </>
          ):(
            <div style={{fontSize:10,color:C.muted}}>
              অপশন ফাঁকা রেখেই সাবমিট হবে — পরে auto (GitHub server) জব দিয়ে QBank→Quiz-এর মতোই option generate করা হবে। দরকার হলে উপরের বাটনে চেপে আবার দেখাও।
            </div>
          )}
        </div>
      )}

      <div className="fld">
        <label>📖 ব্যাখ্যা (ঐচ্ছিক)</label>
        <textarea className="ta" value={explanation} onChange={e=>setExplanation(e.target.value)}
          placeholder="ব্যাখ্যা লিখো, বা ✨ Generate চাপো..." style={{minHeight:60}} tabIndex={7}/>
      </div>

      <div style={{display:"flex",gap:8,marginBottom:10}}>
        <button className="btn" disabled={generating||!question.trim()||!correct.trim()}
          onClick={generate} tabIndex={8}
          style={{flex:1,justifyContent:"center",background:"#6366f122",color:"#6366f1",border:"1px solid #6366f144"}}>
          {generating?"⏳ Generate হচ্ছে...":`✨ ${mcqOptionsNeeded?"অপশন+ব্যাখ্যা":"ব্যাখ্যা"} Generate করো`}
        </button>
      </div>

      <button className="btn bg" disabled={generating} onClick={submit} tabIndex={9}
        style={{width:"100%",justifyContent:"center",padding:"12px 0",fontSize:14}}>
        {generating?"⏳ Generate শেষ হওয়ার অপেক্ষা...":"💾 সাবমিট করো (Ctrl+S)"}
      </button>
      <div style={{textAlign:"center",fontSize:10,color:C.muted,marginTop:8}}>
        Tab দিয়ে পরের বক্সে যাও · Ctrl+S দিয়ে যেকোনো জায়গা থেকেই সাবমিট হবে · সাবমিট হলেই সাথে সাথে ফাঁকা হয়ে যাবে, সেভ ব্যাকগ্রাউন্ডে চলবে
      </div>
    </div>
  );
}

export { SingleQuestionEntryPage };
