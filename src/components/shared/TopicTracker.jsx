/* ══════════ TOPIC COVERAGE TRACKER (v3 — ডেটাবেজ-চালিত) ══════════
   🔄 বড় সরলীকরণ: আগে TopicPlan নামে Firebase-এ একটা আলাদা, ম্যানুয়ালি টাইপ/
   বাল্ক-পেস্ট করা "টার্গেট লিস্ট" রাখা হতো, যেটা আসল ডেটাবেজের Subject/Topic
   নামের সাথে বানান/স্পেসে না মিললে ফাঁকা-ফাঁকা ভুল দেখাতো (এক গাদা রিকনসিলিয়েশন/
   ফাজি-ম্যাচ/এডিট ফিচার লাগতো এটা সামলাতে)। এখন সেটা বাদ — টপিক লিস্ট সরাসরি
   Subjects/Topics রেফারেন্স-টেবিল (GAS-এর getReferenceData action, RenameTab.jsx
   যেটা ব্যবহার করে) থেকে আসে। যা ডেটাবেজে "আছে" সেটাই লিস্ট — আলাদা কোনো প্ল্যান
   টাইপ করে রাখতে হয় না, তাই বানান-মিসম্যাচের সুযোগই নেই।

   ডেটা মডেল:
   - টপিক লিস্ট: fetchReferenceData() থেকে (Firebase-এ কিছু সেভ হয় না)
   - TopicTodayPick/{pushId} = {subject, topic, pickedAt} — "আজকে এটা করবো" পিন
     (শুধু এইটুকুই Firebase-এ থাকে, subject+topic নাম দিয়ে key করা — আসল ডেটার
     নামের সাথেই সবসময় মেলে যেহেতু pin করা হয় লিস্টে দেখানো real entry থেকেই)
   - "+ নতুন টপিক" এখন GAS-এর addReferenceItem action কল করে — মানে সত্যিকারের
     একটা নতুন Subject/Topic রেফারেন্স-এন্ট্রি তৈরি হয় (0 প্রশ্ন নিয়ে), আলাদা কোনো
     প্ল্যান-লিস্ট এϵ্ট্রি না — তাই তৈরি হওয়ার সাথে সাথেই এটা "আসল ডেটাবেজের অংশ"।
   ══════════════════════════════════════════════════════════════════════════ */
import React, { useState, useEffect, useMemo } from "react";
import { C, tint, GAS } from "../../core/config.js";
import { fbPush, fbDelete } from "../../core/firebase.js";
import { useFB } from "../../core/dataCache.js";
import { loadSharedGasSecret } from "../../core/utils.js";
import { fetchReferenceData, addReferenceItem } from "../../core/sheetSave.js";

/* subject_id/topic_id রেফারেন্স-টেবিল থেকে Subject-নাম → {topics:{Topic-নাম:{count}}, subjectId}
   ম্যাপ বানায় — একই নামের একাধিক subject_id/topic_id (ভিন্ন Sheet-এ) থাকলে count যোগ হয়ে যায়,
   subjectId হিসেবে প্রথম পাওয়া id-টা রাখা হয় (নতুন টপিক যোগ করার সময় parentId হিসেবে লাগে)। */
function buildRefCountMap(refData){
  const map={};
  if(!refData) return map;
  const subjName={};
  (refData.subjects||[]).forEach(s=>{ subjName[s.subject_id]=(s.subject_name||"").trim(); });
  (refData.subjects||[]).forEach(s=>{
    const sName=(s.subject_name||"").trim();
    if(!sName) return;
    if(!map[sName]) map[sName]={topics:{},subjectId:s.subject_id};
  });
  (refData.topics||[]).forEach(t=>{
    const sName=subjName[t.subject_id]||"অজানা";
    const tName=(t.topic_name||"").trim()||"General";
    const cnt=parseInt(t.row_count)||0;
    if(!map[sName]) map[sName]={topics:{},subjectId:t.subject_id};
    if(!map[sName].topics[tName]) map[sName].topics[tName]={count:0};
    map[sName].topics[tName].count+=cnt;
  });
  return map;
}

/* ── ফাজি-ম্যাচ হেল্পার — নতুন Subject/Topic যোগ করার সময় কাছাকাছি নাম আগে থেকেই
   আছে কিনা দেখায় (যেমন "পাটিগনিত" টাইপ করলে "পাটিগণিত" আগে থেকেই আছে কিনা), যাতে
   ভুল বানানে ডুপ্লিকেট Subject/Topic তৈরি না হয়ে যায়। */
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
  if(na.includes(nb)||nb.includes(na)) return true;
  const maxLen=Math.max(na.length,nb.length);
  if(maxLen<5) return false;
  const dist=levenshtein_(na,nb);
  return dist<=Math.floor(maxLen*0.22);
}
function findCloseSubject_(name,combinedMap){
  if(combinedMap[name]) return name;
  return Object.keys(combinedMap).find(k=>closeEnough_(k,name))||null;
}

function TopicTracker({push,tick}){
  const{data:pickRaw} = useFB("TopicTodayPick",tick);
  const picks = useMemo(()=>{
    const raw=pickRaw||{};
    return Object.entries(raw).map(([id,v])=>({id,...v}));
  },[pickRaw]);
  const pickedKeySet = useMemo(()=>new Set(picks.map(p=>p.subject+"||"+p.topic)),[picks]);

  const gasSecret=loadSharedGasSecret();
  const[refData,setRefData]=useState(null);
  const[refLoading,setRefLoading]=useState(false);
  useEffect(()=>{
    if(!gasSecret) return;
    let cancelled=false;
    setRefLoading(true);
    fetchReferenceData({gasSecret}).then(d=>{ if(!cancelled){ setRefData(d); setRefLoading(false); } });
    return()=>{ cancelled=true; };
  },[gasSecret,tick]);

  const combinedMap = useMemo(()=>buildRefCountMap(refData),[refData]);
  const subjects = useMemo(()=>Object.keys(combinedMap).sort(),[combinedMap]);

  const emptyCount = useMemo(()=>{
    let n=0;
    subjects.forEach(s=>Object.values(combinedMap[s].topics).forEach(t=>{ if(t.count===0) n++; }));
    return n;
  },[subjects,combinedMap]);

  const[openSubjects,setOpenSubjects] = useState(()=>new Set());
  const toggleOpen=(s)=>setOpenSubjects(prev=>{ const n=new Set(prev); n.has(s)?n.delete(s):n.add(s); return n; });

  const togglePick=async(subject,topic)=>{
    const existing=picks.find(p=>p.subject===subject&&p.topic===topic);
    try{
      if(existing){ await fbDelete("TopicTodayPick/"+existing.id); }
      else{ await fbPush("TopicTodayPick",{subject,topic,pickedAt:Date.now()}); }
    }catch(e){ push("error","ব্যর্থ",e.message); }
  };

  // ── "+ নতুন টপিক" — GAS-এর addReferenceItem দিয়ে সত্যিকারের নতুন Subject/Topic
  //    রেফারেন্স-এন্ট্রি তৈরি করে (0 প্রশ্ন নিয়ে) — আলাদা কোনো প্ল্যান-লিস্ট না।
  const[showAdd,setShowAdd]=useState(false);
  const[newSubject,setNewSubject]=useState("");
  const[newTopic,setNewTopic]=useState("");
  const[newSheet,setNewSheet]=useState("QBank");
  const[busy,setBusy]=useState(false);

  const addNew=async()=>{
    const s=newSubject.trim(), t=newTopic.trim();
    if(!s||!t){ push("warn","Subject আর Topic দুটোই লাগবে",""); return; }
    setBusy(true);
    try{
      let subjectId=combinedMap[s]?.subjectId;
      if(!subjectId){
        const r=await addReferenceItem({refType:"subjects",name:s,sheet:newSheet,gasSecret,push});
        if(!r.ok){ setBusy(false); return; }
        subjectId=r.id;
      }
      const r2=await addReferenceItem({refType:"topics",name:t,parentId:subjectId,gasSecret,push});
      if(!r2.ok){ setBusy(false); return; }
      push("success","✅ যোগ হয়েছে",`${s} — ${t}`);
      setNewSubject(""); setNewTopic(""); setShowAdd(false);
      // রিফ্রেশ — নতুন এϵ্ট্রি সাথে সাথেই লিস্টে দেখানোর জন্য
      const d=await fetchReferenceData({gasSecret}); setRefData(d);
    }catch(e){ push("error","ব্যর্থ",e.message); }
    setBusy(false);
  };

  // নতুন Subject/Topic ইনপুটের সাথে কাছাকাছি বিদ্যমান নাম আছে কিনা — টাইপো ধরার জন্য
  const closeMatch = useMemo(()=>{
    const sTrim=newSubject.trim();
    if(!sTrim) return null;
    const s=findCloseSubject_(sTrim,combinedMap);
    if(!s) return null;
    const tTrim=newTopic.trim();
    if(!tTrim) return {subject:s,topic:null};
    const existingTopics=combinedMap[s]?.topics||{};
    const t=existingTopics[tTrim] ? tTrim : (Object.keys(existingTopics).find(k=>closeEnough_(k,tTrim))||null);
    return {subject:s,topic:t};
  },[newSubject,newTopic,combinedMap]);

  return(
    <>
      <div className="slb">🎯 টপিক কভারেজ ট্র্যাকার</div>

      {!gasSecret && (
        <div className="card" style={{marginBottom:12,borderColor:tint(C.warning,"40")}}>
          <div style={{fontSize:11.5,color:C.warning}}>⚠️ GAS Secret Key সেট নেই — এই ট্র্যাকার সঠিক কাউন্ট দেখাতে GAS Secret লাগবে (ম্যানেজ করুন → Rename ট্যাবে একবার বসালে এখানেও কাজ করবে, সেভ করা থাকে)।</div>
        </div>
      )}
      {gasSecret && refLoading && !refData && (
        <div className="card" style={{marginBottom:12,textAlign:"center",color:C.muted,fontSize:11.5}}>⏳ ডেটাবেজ থেকে Subject/Topic লিস্ট লোড হচ্ছে...</div>
      )}

      {emptyCount>0 && (
        <div className="card" style={{borderColor:tint(C.danger,"40"),background:`linear-gradient(180deg,${tint(C.danger,"0d")},${C.card})`,marginBottom:12}}>
          <div style={{display:"flex",alignItems:"center",gap:8}}>
            <span className="topic-empty-dot" style={{fontSize:16}}>🔴</span>
            <div style={{fontSize:12.5,fontWeight:700,color:C.danger}}>{emptyCount}টা টপিক এখনো ফাঁকা — কোনো প্রশ্ন নেই</div>
          </div>
        </div>
      )}

      {picks.length>0 && (
        <div className="card" style={{borderColor:tint(C.warning,"40"),marginBottom:12}}>
          <div className="sl" style={{color:C.warning,marginBottom:6}}>📌 আজকের টার্গেট</div>
          {picks.map(p=>(
            <div key={p.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"5px 0",fontSize:12}}>
              <span>{p.subject} — {p.topic}</span>
              <button onClick={()=>togglePick(p.subject,p.topic)} style={{background:"none",border:"none",color:C.muted,fontSize:14,cursor:"pointer"}}>✕</button>
            </div>
          ))}
        </div>
      )}

      <div className="card" style={{marginBottom:12}}>
        <div style={{display:"flex",gap:8,marginBottom:showAdd?12:0,flexWrap:"wrap"}}>
          <button onClick={()=>setShowAdd(v=>!v)} style={{fontSize:11,padding:"7px 12px",borderRadius:8,border:`1px solid ${C.border}`,background:C.panel,color:C.text}}>+ নতুন Subject/Topic</button>
        </div>
        {showAdd && (
          <div style={{display:"flex",flexDirection:"column",gap:8}}>
            <input value={newSubject} onChange={e=>setNewSubject(e.target.value)} list="ttSubjectList" placeholder="Subject (নতুন বা বিদ্যমান)" style={{padding:8,borderRadius:8,border:`1px solid ${C.border}`,background:C.bg,color:C.text,fontSize:12}}/>
            <datalist id="ttSubjectList">{subjects.map(s=>(<option key={s} value={s}/>))}</datalist>
            {!combinedMap[newSubject.trim()] && newSubject.trim() && (
              <select value={newSheet} onChange={e=>setNewSheet(e.target.value)} style={{padding:8,borderRadius:8,border:`1px solid ${C.border}`,background:C.bg,color:C.text,fontSize:12}}>
                <option value="QBank">QBank</option>
                <option value="Quiz">Quiz</option>
                <option value="Study">Study</option>
              </select>
            )}
            <input value={newTopic} onChange={e=>setNewTopic(e.target.value)} placeholder="Topic" style={{padding:8,borderRadius:8,border:`1px solid ${C.border}`,background:C.bg,color:C.text,fontSize:12}}/>
            {closeMatch?.subject && (
              <div style={{fontSize:10,color:C.warning,background:tint(C.warning,"10"),borderRadius:6,padding:"5px 7px"}}>
                ⚠️ কাছাকাছি আগে থেকেই আছে: <b>{closeMatch.subject}{closeMatch.topic?` — ${closeMatch.topic}`:""}</b> — টাইপো হলে ঠিক এই বানানেই লিখো।
                <button onClick={()=>{ setNewSubject(closeMatch.subject); if(closeMatch.topic) setNewTopic(closeMatch.topic); }} style={{marginLeft:6,fontSize:9,padding:"2px 6px",borderRadius:4,border:`1px solid ${C.warning}`,background:"transparent",color:C.warning}}>এটা বসাও</button>
              </div>
            )}
            <button onClick={addNew} disabled={busy} style={{padding:8,borderRadius:8,border:"none",background:C.accent,color:"#fff",fontSize:12,fontWeight:700}}>যোগ করো</button>
          </div>
        )}
      </div>

      {subjects.length===0 ? (
        <div className="card" style={{textAlign:"center",color:C.muted,fontSize:12,padding:"16px 0"}}>{refLoading?"লোড হচ্ছে...":"ডেটাবেজে কোনো Subject/Topic পাওয়া যায়নি।"}</div>
      ) : subjects.map(subject=>{
        const topicsObj=combinedMap[subject].topics;
        const topicNames=Object.keys(topicsObj).sort();
        const subjEmpty=topicNames.filter(t=>topicsObj[t].count===0).length;
        const isOpen=openSubjects.has(subject);
        return(
          <div key={subject} className="card" style={{marginBottom:8,padding:0,overflow:"hidden"}}>
            <div onClick={()=>toggleOpen(subject)} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"12px 14px",cursor:"pointer"}}>
              <div style={{fontSize:12.5,fontWeight:700,color:C.text}}>{subject}</div>
              <div style={{display:"flex",alignItems:"center",gap:8}}>
                {subjEmpty>0 && <span style={{fontSize:10,fontWeight:700,color:C.danger}}>{subjEmpty} ফাঁকা</span>}
                <span style={{fontSize:10,color:C.muted}}>{topicNames.length}টা</span>
                <span style={{fontSize:11,color:C.muted}}>{isOpen?"▲":"▼"}</span>
              </div>
            </div>
            {isOpen && (
              <div style={{padding:"0 14px 12px"}}>
                {topicNames.map(tname=>{
                  const cnt=topicsObj[tname].count;
                  const isEmpty=cnt===0;
                  const isPicked=pickedKeySet.has(subject+"||"+tname);
                  return(
                    <div key={tname} className={isEmpty?"topic-empty-row":""} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"7px 8px",borderRadius:8,marginBottom:5,...(isPicked&&!isEmpty?{background:tint(C.warning,"12")}:{})}}>
                      <div style={{display:"flex",alignItems:"center",gap:6,flex:1,minWidth:0}}>
                        {isEmpty && <span className="topic-empty-dot" style={{fontSize:9}}>🔴</span>}
                        {isPicked && <span style={{fontSize:9}}>📌</span>}
                        <span style={{fontSize:11.5,color:C.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{tname}</span>
                      </div>
                      <div style={{display:"flex",alignItems:"center",gap:8,flexShrink:0}}>
                        <span style={{fontSize:10,fontWeight:700,color:isEmpty?C.danger:C.success}}>{cnt}</span>
                        <button onClick={()=>togglePick(subject,tname)} title="আজকে এটা করবো" style={{background:"none",border:"none",color:isPicked?C.warning:C.muted,fontSize:12,cursor:"pointer"}}>📌</button>
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
