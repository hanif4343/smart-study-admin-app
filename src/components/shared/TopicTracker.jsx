/* ══════════ TOPIC COVERAGE TRACKER ══════════
   🆕 নতুন ফিচার — "কোন কোন টপিকে এখনো প্রশ্ন যোগ করা হয়নি" এক নজরে দেখার জন্য।

   ডেটা মডেল (Firebase):
   - TopicPlan/{pushId}      = {subject, topic, addedAt}      — মাস্টার টপিক লিস্ট (in-app এডিটেবল)
   - TopicTodayPick/{pushId} = {planId, subject, topic, pickedAt} — "আজকে এটা করবো" পিন

   পূর্ণ/ফাঁকা হিসাব: DashboardPage থেকে qbankArr+quizArr (Firebase থেকে আগে থেকেই
   লোড করা, GAS-এর ধীর getSheetRows না) prop হিসেবে আসে, buildSubjectMap() দিয়ে
   Subject→Topic→count ম্যাপ বানিয়ে TopicPlan-এর প্রতিটা এϵ্ট্রির সাথে মিলিয়ে দেখা হয়।
   ══════════════════════════════════════════════════════════════════════════ */
import React, { useState, useMemo } from "react";
import { C, tint, GAS } from "../../core/config.js";
import { useFB } from "../../core/dataCache.js";
import { fbPush, fbDelete } from "../../core/firebase.js";
import { toArr, buildSubjectMap, loadSharedGasSecret } from "../../core/utils.js";

/* ── ফাজি-ম্যাচ হেল্পার — বাল্ক-ইম্পোর্টে পেস্ট করা Subject/Topic নাম আসল
   ডেটায় (qbank/quiz-এ ইতিমধ্যে থাকা নাম) সামান্য বানান/স্পেস-ভিন্নতায় আলাদা
   হলেও ধরতে পারে — যেমন "পাটিগনিত" vs "পাটিগণিত", "বিষয়াবলি" vs "বিষয়াবলী"।
   ছোট Levenshtein distance + substring-containment — দুটো মিলিয়ে চেক করা হয়। */
function norm_(s){ return (s||"").toString().trim().replace(/\s+/g," ").toLowerCase(); }
function levenshtein_(a,b){
  a=norm_(a); b=norm_(b);
  if(a===b) return 0;
  const m=a.length, n=b.length;
  if(!m) return n; if(!n) return m;
  let prev=Array.from({length:n+1},(_,i)=>i);
  for(let i=1;i<=m;i++){
    const cur=[i];
    for(let j=1;j<=n;j++){
      cur[j]=a[i-1]===b[j-1] ? prev[j-1] : 1+Math.min(prev[j-1],prev[j],cur[j-1]);
    }
    prev=cur;
  }
  return prev[n];
}
function closeEnough_(a,b){
  const na=norm_(a), nb=norm_(b);
  if(!na||!nb) return false;
  if(na===nb) return true;
  if(na.includes(nb)||nb.includes(na)) return true; // যেমন "আন্তর্জাতিক" ⊂ "আন্তর্জাতিক বিষয়াবলি"
  const maxLen=Math.max(na.length,nb.length);
  if(maxLen<5) return false; // খুব ছোট শব্দে edit-distance ভিত্তিক ম্যাচ অবিশ্বাস্য — অনেক false positive দেয় (যেমন "গড়" vs "গতি")
  const dist=levenshtein_(na,nb);
  return dist<=Math.floor(maxLen*0.22);
}
// combinedMap-এর আসল Subject/Topic-এর সাথে (subject,topic) মিলিয়ে সবচেয়ে কাছের মিল খোঁজে
function findFuzzyMatch_(subject,topic,combinedMap){
  const subjKeys=Object.keys(combinedMap);
  let bestSubject=null;
  if(combinedMap[subject]) bestSubject=subject; // exact match আগে চেক
  else bestSubject=subjKeys.find(k=>closeEnough_(k,subject))||null;
  if(!bestSubject) return null;
  const topicKeys=Object.keys(combinedMap[bestSubject]?.topics||{});
  let bestTopic=null;
  if(combinedMap[bestSubject].topics[topic]) bestTopic=topic;
  else bestTopic=topicKeys.find(k=>closeEnough_(k,topic))||null;
  if(bestSubject===subject && bestTopic===topic) return null; // পুরোপুরি এক্স্যাক্ট মিল, সাজেশনের দরকার নেই
  if(bestSubject===subject && !bestTopic) return null; // সাবজেক্ট ঠিক আছে, টপিক সত্যিই নতুন
  return {subject:bestSubject, topic:bestTopic};
}

/* ── বাল্ক-ইম্পোর্ট পার্সার — Subject/Topic কমা-লিস্ট ফরম্যাট পার্স করে ──
   নিয়ম: যে লাইনে কমা নেই সেটা "Subject" (শেষের >>, <>, : ছেঁটে ফেলা হয়),
   যে লাইনে কমা আছে সেটা সর্বশেষ Subject-এর Topic লিস্ট (কমা দিয়ে ভাগ করা)।
   খালি লাইন উপেক্ষা করা হয়। */
function parseBulkTopics(text){
  const lines=(text||"").split("\n").map(l=>l.trim()).filter(Boolean);
  const out=[]; // {subject, topic}
  let curSubject=null;
  for(const line of lines){
    if(line.includes(",")){
      if(!curSubject) continue; // কমা-লিস্ট এলো কিন্তু আগে কোনো Subject হেডার নেই — বাদ
      line.split(",").map(t=>t.trim()).filter(Boolean).forEach(t=>out.push({subject:curSubject,topic:t}));
    } else {
      curSubject=line.replace(/[>>|<>|:]+$/,"").trim();
    }
  }
  return out;
}

function TopicTracker({qbankArr,quizArr,push,tick}){
  const{data:planRaw}  = useFB("TopicPlan",tick);
  const{data:pickRaw}  = useFB("TopicTodayPick",tick);
  const plan  = useMemo(()=>{
    const raw=planRaw||{};
    return Object.entries(raw).map(([id,v])=>({id,...v}));
  },[planRaw]);
  const picks = useMemo(()=>{
    const raw=pickRaw||{};
    return Object.entries(raw).map(([id,v])=>({id,...v}));
  },[pickRaw]);
  const pickedPlanIds = useMemo(()=>new Set(picks.map(p=>p.planId)),[picks]);

  const combinedMap = useMemo(()=>buildSubjectMap([...(qbankArr||[]),...(quizArr||[])]),[qbankArr,quizArr]);

  const countFor=(subject,topic)=> combinedMap[subject]?.topics?.[topic]?.total || 0;

  const grouped = useMemo(()=>{
    const g={};
    plan.forEach(p=>{
      if(!g[p.subject]) g[p.subject]=[];
      g[p.subject].push(p);
    });
    return g;
  },[plan]);
  const subjects = useMemo(()=>Object.keys(grouped).sort(),[grouped]);

  const emptyEntries = useMemo(()=>plan.filter(p=>countFor(p.subject,p.topic)===0),[plan,combinedMap]);
  const emptyCount = emptyEntries.length;

  const[openSubjects,setOpenSubjects] = useState(()=>new Set());
  const toggleOpen=(s)=>setOpenSubjects(prev=>{ const n=new Set(prev); n.has(s)?n.delete(s):n.add(s); return n; });

  const[showAdd,setShowAdd] = useState(false);
  const[showBulk,setShowBulk] = useState(false);
  const[newSubject,setNewSubject] = useState("");
  const[newTopic,setNewTopic] = useState("");
  const[bulkText,setBulkText] = useState("");
  const[bulkPreview,setBulkPreview] = useState(null);
  const[busy,setBusy] = useState(false);

  const addSingle=async()=>{
    const s=newSubject.trim(), t=newTopic.trim();
    if(!s||!t){ push("warn","Subject আর Topic দুটোই লাগবে",""); return; }
    setBusy(true);
    try{
      await fbPush("TopicPlan",{subject:s,topic:t,addedAt:Date.now()});
      push("success","✅ যোগ হয়েছে",`${s} — ${t}`);
      setNewSubject(""); setNewTopic(""); setShowAdd(false);
    }catch(e){ push("error","ব্যর্থ",e.message); }
    setBusy(false);
  };

  const previewBulk=()=>{
    const parsed=parseBulkTopics(bulkText);
    if(!parsed.length){ push("warn","কিছু পার্স করা গেলো না","ফরম্যাট চেক করো"); return; }
    // 🆕 প্রতিটা এϵ্ট্রির জন্য আসল ডেটায় কাছাকাছি মিল আছে কিনা চেক করা হচ্ছে —
    // থাকলে useMatch:false দিয়ে শুরু হয় (ডিফল্ট এখনো original নাম), প্রিভিউতে
    // অ্যাডমিন চাইলে "এই নামটা ব্যবহার করো" চেপে matched নামে বদলে নিতে পারবে।
    const withMatches=parsed.map(p=>({
      ...p,
      match: findFuzzyMatch_(p.subject,p.topic,combinedMap),
      useMatch: false,
    }));
    setBulkPreview(withMatches);
  };

  const toggleUseMatch=(idx)=>{
    setBulkPreview(prev=>prev.map((p,i)=>i===idx?{...p,useMatch:!p.useMatch}:p));
  };

  const confirmBulk=async()=>{
    if(!bulkPreview?.length) return;
    setBusy(true);
    try{
      // প্রতিটা এϵ্ট্রি আলাদা fbPush — Firebase-এর নিজস্ব push-key জেনারেশন
      // ব্যবহার হচ্ছে (সংঘর্ষ-মুক্ত ইউনিক আইডি), তাই সবগুলোর জন্য একই প্যাটার্ন।
      // useMatch চালু থাকলে ফাজি-ম্যাচড (আসল ডেটায় থাকা) নাম দিয়ে সেভ হয়।
      for(const item of bulkPreview){
        const subject=(item.useMatch&&item.match)?item.match.subject:item.subject;
        const topic=(item.useMatch&&item.match&&item.match.topic)?item.match.topic:item.topic;
        await fbPush("TopicPlan",{subject,topic,addedAt:Date.now()});
      }
      push("success",`✅ ${bulkPreview.length}টা টপিক যোগ হয়েছে`,"");
      setBulkText(""); setBulkPreview(null); setShowBulk(false);
    }catch(e){ push("error","বাল্ক-ইম্পোর্ট ব্যর্থ",e.message); }
    setBusy(false);
  };

  const removeTopic=async(id)=>{
    try{ await fbDelete("TopicPlan/"+id); push("success","🗑️ মুছে ফেলা হয়েছে",""); }
    catch(e){ push("error","ব্যর্থ",e.message); }
  };

  const togglePick=async(p)=>{
    const existing=picks.find(x=>x.planId===p.id);
    try{
      if(existing){ await fbDelete("TopicTodayPick/"+existing.id); }
      else{ await fbPush("TopicTodayPick",{planId:p.id,subject:p.subject,topic:p.topic,pickedAt:Date.now()}); }
    }catch(e){ push("error","ব্যর্থ",e.message); }
  };

  // 🆕 GAS-এ একবার কল করে ডেইলি রিমাইন্ডার ট্রিগার বসিয়ে দেয় (idempotent — বারবার
  // চাপলেও সমস্যা নেই, GAS নিজে Script Property চেক করে ডুপ্লিকেট ট্রিগার বসায় না)
  const enablePushReminder=async()=>{
    if(!GAS){ push("error","GAS URL সেট করা নেই",""); return; }
    setBusy(true);
    try{
      const secret=loadSharedGasSecret();
      const r=await fetch(GAS,{method:"POST",body:JSON.stringify({secret,type:"ensure_topic_reminder"})});
      const j=await r.json().catch(()=>null);
      if(j?.result==="success") push("success","🔔 ডেইলি রিমাইন্ডার চালু হয়েছে",j.message||"");
      else push("error","চালু করা যায়নি",j?.error||"অজানা কারণ");
    }catch(e){ push("error","ব্যর্থ",e.message); }
    setBusy(false);
  };

  return(
    <>
      <div className="slb">🎯 টপিক কভারেজ ট্র্যাকার</div>

      {emptyCount>0 && (
        <div className="card" style={{borderColor:tint(C.danger,"40"),background:`linear-gradient(180deg,${tint(C.danger,"0d")},${C.card})`,marginBottom:12}}>
          <div style={{display:"flex",alignItems:"center",gap:8}}>
            <span className="topic-empty-dot" style={{fontSize:16}}>🔴</span>
            <div style={{fontSize:12.5,fontWeight:700,color:C.danger}}>{emptyCount}টা টপিক এখনো ফাঁকা — কোনো প্রশ্ন যোগ করা হয়নি</div>
          </div>
        </div>
      )}

      {picks.length>0 && (
        <div className="card" style={{borderColor:tint(C.warning,"40"),marginBottom:12}}>
          <div className="sl" style={{color:C.warning,marginBottom:6}}>📌 আজকের টার্গেট</div>
          {picks.map(p=>(
            <div key={p.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"5px 0",fontSize:12}}>
              <span>{p.subject} — {p.topic}</span>
              <button onClick={()=>togglePick({id:p.planId})} style={{background:"none",border:"none",color:C.muted,fontSize:14,cursor:"pointer"}}>✕</button>
            </div>
          ))}
        </div>
      )}

      <div className="card" style={{marginBottom:12}}>
        <div style={{display:"flex",gap:8,marginBottom:showAdd||showBulk?12:0,flexWrap:"wrap"}}>
          <button className="btn-ghost" onClick={()=>{setShowAdd(v=>!v);setShowBulk(false);}} style={{fontSize:11,padding:"7px 12px",borderRadius:8,border:`1px solid ${C.border}`,background:C.panel,color:C.text}}>+ নতুন টপিক</button>
          <button className="btn-ghost" onClick={()=>{setShowBulk(v=>!v);setShowAdd(false);}} style={{fontSize:11,padding:"7px 12px",borderRadius:8,border:`1px solid ${C.border}`,background:C.panel,color:C.text}}>📋 বাল্ক ইম্পোর্ট</button>
          <button className="btn-ghost" onClick={enablePushReminder} disabled={busy} style={{fontSize:11,padding:"7px 12px",borderRadius:8,border:`1px solid ${tint(C.accent,"40")}`,background:tint(C.accent,"10"),color:C.accent}}>🔔 ডেইলি নোটিফিকেশন চালু করো</button>
        </div>

        {showAdd && (
          <div style={{display:"flex",flexDirection:"column",gap:8}}>
            <input value={newSubject} onChange={e=>setNewSubject(e.target.value)} placeholder="Subject (যেমন: বাংলা সাহিত্য)" style={{padding:8,borderRadius:8,border:`1px solid ${C.border}`,background:C.bg,color:C.text,fontSize:12}}/>
            <input value={newTopic} onChange={e=>setNewTopic(e.target.value)} placeholder="Topic (যেমন: কবি পরিচিতি)" style={{padding:8,borderRadius:8,border:`1px solid ${C.border}`,background:C.bg,color:C.text,fontSize:12}}/>
            {newSubject.trim()&&newTopic.trim()&&(()=>{
              const m=findFuzzyMatch_(newSubject.trim(),newTopic.trim(),combinedMap);
              return m ? (
                <div style={{fontSize:10,color:C.warning,background:tint(C.warning,"10"),borderRadius:6,padding:"5px 7px"}}>
                  ⚠️ সম্ভবত এটাই: <b>{m.subject}{m.topic?` — ${m.topic}`:""}</b> (ডেটায় আগে থেকেই আছে) — চাইলে ঠিক এই বানানেই লিখে যোগ করো।
                </div>
              ) : null;
            })()}
            <button onClick={addSingle} disabled={busy} style={{padding:8,borderRadius:8,border:"none",background:C.accent,color:"#fff",fontSize:12,fontWeight:700}}>যোগ করো</button>
          </div>
        )}

        {showBulk && (
          <div style={{display:"flex",flexDirection:"column",gap:8}}>
            <div style={{fontSize:10.5,color:C.muted}}>ফরম্যাট: প্রতিটা Subject-এর নাম আলাদা লাইনে, তার ঠিক পরের লাইনে Topic-গুলো কমা দিয়ে আলাদা করে।</div>
            <textarea value={bulkText} onChange={e=>setBulkText(e.target.value)} rows={6} placeholder={"বাংলা ব্যাকরণ\nভাষা, ধ্বনি ও বর্ণ, বাগধারা, কারক ও বিভক্তি"} style={{padding:8,borderRadius:8,border:`1px solid ${C.border}`,background:C.bg,color:C.text,fontSize:12,fontFamily:"monospace"}}/>
            {!bulkPreview ? (
              <button onClick={previewBulk} style={{padding:8,borderRadius:8,border:"none",background:C.accent,color:"#fff",fontSize:12,fontWeight:700}}>প্রিভিউ দেখাও</button>
            ) : (
              <>
                <div style={{maxHeight:260,overflowY:"auto",border:`1px solid ${C.border}`,borderRadius:8,padding:8}}>
                  {bulkPreview.map((p,i)=>(
                    <div key={i} style={{padding:"5px 0",borderBottom:i<bulkPreview.length-1?`1px solid ${C.border}`:"none"}}>
                      <div style={{fontSize:11,color:C.text,textDecoration:p.useMatch?"line-through":"none",opacity:p.useMatch?.55:1}}>{p.subject} — {p.topic}</div>
                      {p.match && (
                        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:6,marginTop:2,background:tint(C.warning,"10"),borderRadius:6,padding:"4px 6px"}}>
                          <div style={{fontSize:10,color:C.warning}}>
                            ⚠️ সম্ভবত এটাই: <b>{p.match.subject}{p.match.topic?` — ${p.match.topic}`:""}</b> (ডেটায় আগে থেকেই আছে)
                          </div>
                          <button onClick={()=>toggleUseMatch(i)} style={{fontSize:9,fontWeight:700,padding:"3px 7px",borderRadius:6,border:`1px solid ${C.warning}`,background:p.useMatch?C.warning:"transparent",color:p.useMatch?"#fff":C.warning,whiteSpace:"nowrap"}}>
                            {p.useMatch?"✓ এই নাম ব্যবহার হবে":"এই নাম ব্যবহার করো"}
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
                <div style={{fontSize:11,color:C.muted}}>মোট {bulkPreview.length}টা টপিক — {bulkPreview.filter(p=>p.match).length>0?`${bulkPreview.filter(p=>p.match).length}টায় সম্ভাব্য মিল পাওয়া গেছে, চেক করে নাও। `:""}ঠিক আছে?</div>
                <div style={{fontSize:9.5,color:C.muted}}>💡 "এই নাম ব্যবহার করো" না চাপলে, আপনার লেখা নামেই (নতুন এϵ্ট্রি হিসেবে) যোগ হবে — আসল ডেটায় থাকা প্রশ্নগুলো এর সাথে ম্যাচ নাও হতে পারে।</div>
                <div style={{display:"flex",gap:8}}>
                  <button onClick={()=>setBulkPreview(null)} style={{flex:1,padding:8,borderRadius:8,border:`1px solid ${C.border}`,background:C.panel,color:C.text,fontSize:12}}>বাতিল</button>
                  <button onClick={confirmBulk} disabled={busy} style={{flex:1,padding:8,borderRadius:8,border:"none",background:C.success,color:"#fff",fontSize:12,fontWeight:700}}>যোগ করে দাও</button>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {subjects.length===0 ? (
        <div className="card" style={{textAlign:"center",color:C.muted,fontSize:12,padding:"16px 0"}}>এখনো কোনো টপিক প্ল্যান যোগ করা হয়নি — উপরে "+ নতুন টপিক" বা "বাল্ক ইম্পোর্ট" দিয়ে শুরু করো।</div>
      ) : subjects.map(subject=>{
        const topics=grouped[subject];
        const subjEmpty=topics.filter(t=>countFor(t.subject,t.topic)===0).length;
        const isOpen=openSubjects.has(subject);
        return(
          <div key={subject} className="card" style={{marginBottom:8,padding:0,overflow:"hidden"}}>
            <div onClick={()=>toggleOpen(subject)} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"12px 14px",cursor:"pointer"}}>
              <div style={{fontSize:12.5,fontWeight:700,color:C.text}}>{subject}</div>
              <div style={{display:"flex",alignItems:"center",gap:8}}>
                {subjEmpty>0 && <span style={{fontSize:10,fontWeight:700,color:C.danger}}>{subjEmpty} ফাঁকা</span>}
                <span style={{fontSize:10,color:C.muted}}>{topics.length}টা</span>
                <span style={{fontSize:11,color:C.muted}}>{isOpen?"▲":"▼"}</span>
              </div>
            </div>
            {isOpen && (
              <div style={{padding:"0 14px 12px"}}>
                {topics.map(t=>{
                  const cnt=countFor(t.subject,t.topic);
                  const isEmpty=cnt===0;
                  const isPicked=pickedPlanIds.has(t.id);
                  return(
                    <div key={t.id} className={isEmpty?"topic-empty-row":""} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"7px 8px",borderRadius:8,marginBottom:5,...(isPicked&&!isEmpty?{background:tint(C.warning,"12")}:{})}}>
                      <div style={{display:"flex",alignItems:"center",gap:6,flex:1,minWidth:0}}>
                        {isEmpty && <span className="topic-empty-dot" style={{fontSize:9}}>🔴</span>}
                        {isPicked && <span style={{fontSize:9}}>📌</span>}
                        <span style={{fontSize:11.5,color:C.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{t.topic}</span>
                      </div>
                      <div style={{display:"flex",alignItems:"center",gap:8,flexShrink:0}}>
                        <span style={{fontSize:10,fontWeight:700,color:isEmpty?C.danger:C.success}}>{cnt}</span>
                        <button onClick={()=>togglePick(t)} title="আজকে এটা করবো" style={{background:"none",border:"none",color:isPicked?C.warning:C.muted,fontSize:12,cursor:"pointer"}}>📌</button>
                        <button onClick={()=>removeTopic(t.id)} title="তালিকা থেকে মুছো" style={{background:"none",border:"none",color:C.muted,fontSize:12,cursor:"pointer"}}>✕</button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}

export { TopicTracker };
