/* ══════════ SINGLE প্রশ্ন এন্ট্রি — বই দেখে দ্রুত টাইপ করার জন্য ══════════
   ওয়ার্কফ্লো: Subject/Sub-topic/Target Sheet একবার সেট করে রাখা হয় (সেশনজুড়ে
   অক্ষত থাকে) — তারপর শুধু প্রশ্ন লিখে, উত্তর লিখে, Tab দিয়ে দিয়ে পরের বক্সে
   গিয়ে (MCQ হলে ✨ Generate চেপে option+ব্যাখ্যা AI দিয়ে বানিয়ে), Ctrl+S চেপে
   সাবমিট — সাথে সাথে সব ফাঁকা হয়ে পরের প্রশ্নের জন্য cursor আবার প্রশ্ন-বক্সে
   ফিরে যায়। বইয়ের একটার পর একটা প্রশ্ন টাইপ করার জন্য optimized। */
import React, { useState, useRef, useEffect, useCallback } from "react";
import { C } from "../core/config.js";
import { nowTs } from "../core/utils.js";
import { fbPush, fbSet } from "../core/firebase.js";
import { invalidate } from "../core/dataCache.js";
import { callAiProviderRotatingRaw, buildKeyPool } from "../core/ocrProviders.js";
import { buildBulkRecord, buildSheetRow, loadSharedGasSecret, saveSharedGasSecret } from "../core/uploaderUtils.js";
import { saveRowsToSheet } from "../core/sheetSave.js";
import { SaveLocationPicker } from "../components/shared/SaveLocationPicker.jsx";

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

function SingleQuestionEntryPage({push}){
  const[targetMode,setTargetMode]=useState("Quiz"); // Quiz | QBank | Study
  const[qtype,setQtype]=useState("MCQ"); // MCQ | Written — Study হলে অপ্রাসঙ্গিক
  const[saveLoc,setSaveLoc]=useState("firebase");
  const[gasSecret,setGasSecretState]=useState(loadSharedGasSecret());
  const setGasSecret=v=>{setGasSecretState(v);saveSharedGasSecret(v);};

  // ── এই ফিল্ডগুলো একবার সেট হলে সেশনজুড়ে থাকে (একই বই/অধ্যায় থেকে অনেক প্রশ্ন টাইপ হয় বলে) ──
  const[subject,setSubject]=useState("");
  const[subtopic,setSubtopic]=useState("");
  const[audienceTags,setAudienceTags]=useState("");

  // ── এই ফিল্ডগুলো প্রতি সাবমিটের পর খালি হয়ে যায় ──
  const[question,setQuestion]=useState("");
  const[correct,setCorrect]=useState("");
  const[opt1,setOpt1]=useState(""); const[opt2,setOpt2]=useState("");
  const[opt3,setOpt3]=useState(""); const[opt4,setOpt4]=useState("");
  const[explanation,setExplanation]=useState("");

  const[generating,setGenerating]=useState(false);
  const[saving,setSaving]=useState(false);
  const[sessionCount,setSessionCount]=useState(0);

  const qRef=useRef(null);
  const isStudy=targetMode==="Study";
  const isMCQ=!isStudy&&qtype==="MCQ";

  useEffect(()=>{ qRef.current?.focus(); },[]);

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
        const [a,b,c,d]=shuffle4([correct,...distractors]); // সঠিক উত্তরটা এলোমেলো অবস্থানে বসে, সবসময় একই জায়গায় না
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
    setSessionCount(c=>c+1);
    requestAnimationFrame(()=>qRef.current?.focus());
  };

  /* ── Ctrl+S দিয়ে সাবমিট (Subject/Sub-topic ফাঁকা থাকলে কখনোই সাবমিট হবে না — OCR পেজের মতোই নিয়ম) ── */
  const submit=useCallback(async()=>{
    if(saving||generating)return;
    if(!question.trim()){ push("warn","প্রশ্ন লিখো","");qRef.current?.focus();return; }
    if(!correct.trim()){ push("warn","উত্তর লিখো",""); return; }
    if(!subject.trim()||!subtopic.trim()){ push("warn","⚠️ Subject/Sub-topic ফাঁকা","আগে পূরণ করো — ফাঁকা থাকলে সাবমিট হবে না"); return; }
    if(isMCQ&&(!opt1.trim()||!opt2.trim()||!opt3.trim()||!opt4.trim())){ push("warn","৪টা অপশনই পূরণ করো","✨ Generate চাপো অথবা নিজে লিখো"); return; }

    setSaving(true);
    const item={q:question.trim(),correct:correct.trim(),opt1,opt2,opt3,opt4,explanation};
    const tagsArr=audienceTags.split(",").map(s=>s.trim()).filter(Boolean);
    const effQtype=isStudy?"Study":(isMCQ?"MCQ":"Written");
    try{
      if(saveLoc==="sheet"){
        const row=buildSheetRow({item,subject:subject.trim(),subtopic:subtopic.trim(),qtype:effQtype,audienceTags:tagsArr,mainQpaper:""});
        const res=await saveRowsToSheet({rows:[row],targetTab:targetMode,gasSecret,push});
        if(res.added>0){ push("success","✅ যোগ হয়েছে!",`এই সেশনে মোট ${sessionCount+1}টি`); resetForNext(); }
        else push("error","সেভ ব্যর্থ","Sheet-এ যোগ হয়নি — duplicate বা নেটওয়ার্ক সমস্যা হতে পারে");
      }else{
        const ts=nowTs();
        const id=Date.now()+Math.floor(Math.random()*9999);
        const rec=buildBulkRecord({item,subject:subject.trim(),subtopic:subtopic.trim(),mode:targetMode,qtype:effQtype,audienceTags:tagsArr,ts,id});
        const res=await fbPush(targetMode,rec);
        if(res?.name) await fbSet(`${targetMode}/${res.name}/id`,res.name);
        invalidate(targetMode);
        push("success","✅ যোগ হয়েছে!",`এই সেশনে মোট ${sessionCount+1}টি`);
        resetForNext();
      }
    }catch(e){ push("error","সেভ ব্যর্থ",e.message); }
    setSaving(false);
  },[saving,generating,question,correct,subject,subtopic,isMCQ,opt1,opt2,opt3,opt4,explanation,audienceTags,isStudy,saveLoc,targetMode,gasSecret,sessionCount,push]);

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
        <div style={{fontSize:11,color:C.green,fontWeight:700}}>এই সেশনে যোগ হয়েছে: {sessionCount}টি</div>
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
      <div className="fld">
        <label>🏷️ Audience Tags (কমা দিয়ে একাধিক)</label>
        <input className="inp" value={audienceTags} onChange={e=>setAudienceTags(e.target.value)} placeholder="Job, Class 7..." tabIndex={12}/>
      </div>

      <div style={{height:1,background:C.border,margin:"12px 0"}}/>

      {/* ── দ্রুত টাইপিং লুপ: প্রশ্ন → উত্তর → (MCQ হলে অপশন) → ব্যাখ্যা → Ctrl+S ── */}
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
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:10}}>
          {[["ক",opt1,setOpt1,3],["খ",opt2,setOpt2,4],["গ",opt3,setOpt3,5],["ঘ",opt4,setOpt4,6]].map(([lbl,val,setter,ti])=>(
            <div key={lbl} className="fld" style={{marginBottom:0}}>
              <label>{lbl}. অপশন{val&&val===correct.trim()&&val.trim()?" ✅":""}</label>
              <input className="inp" value={val} onChange={e=>setter(e.target.value)} placeholder={`অপশন ${lbl}`} tabIndex={ti}/>
            </div>
          ))}
        </div>
      )}

      <div className="fld">
        <label>📖 ব্যাখ্যা (ঐচ্ছিক)</label>
        <textarea className="ta" value={explanation} onChange={e=>setExplanation(e.target.value)}
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
