/* ══════════ RENAME TAB (Subject/Topic rename — এখন reference-টেবিল ভিত্তিক) ══════════
   ⚠️ Phase 5 rewrite: আগে এই ট্যাব Quiz/QBank/Study-এর প্রতিটা রো স্ক্যান করে matching সব
   রো rewrite করত (হাজার হাজার Firebase write/Sheet cell — এটাই ছিল মূল "usage বেশি" সমস্যা)।
   এখন Subject/Topic নাম প্রশ্নের রো-তে literal টেক্সট হিসেবে থাকে না — শুধু
   subject_id/topic_id (stable reference) থাকে। তাই rename মানে এখন শুধু
   Subjects/Topics রেফারেন্স-টেবিলের ঠিক ১টা রো বদলানো — Quiz/QBank/Study
   কখনো টাচ হয় না, প্রশ্ন যতই থাকুক (৭৭৬১টা হোক বা ২ লাখ)।
   ⚠️ SubTopic তুলে দেওয়া হয়েছে — QBank এখন Quiz/Study-এর মতোই ২-লেভেল। */
import React, { useState, useEffect, useMemo, useCallback } from "react";
import { C, tint } from "../../core/config.js";
import { loadSharedGasSecret, saveSharedGasSecret } from "../../core/utils.js";
import { fetchReferenceData, renameReferenceItem } from "../../core/sheetSave.js";
import { RenameModal } from "./RenameModal.jsx";

// Sheet নাম → subject_id প্রিফিক্স (migration script যেভাবে বানিয়েছিল সেটার সাথে মিলিয়ে)
const SHEET_PREFIX = { Quiz: "QZ_", QBank: "QB_", Study: "ST_" };

function RenameTab({push}){
  const[sheet,setSheet]=useState("Quiz");
  const[type,setType]=useState("subject"); // subject | topic
  const[gasSecret,setGasSecret]=useState(loadSharedGasSecret);
  const setGasSecretP=v=>{ setGasSecret(v); saveSharedGasSecret(v); };

  const[refData,setRefData]=useState(null); // {subjects,topics,tags,posts,institutions}
  const[loading,setLoading]=useState(false);
  const[tick,setTick]=useState(0);
  const refresh=useCallback(()=>setTick(t=>t+1),[]);

  useEffect(()=>{
    if(!gasSecret){ setRefData(null); return; }
    let cancelled=false;
    setLoading(true);
    fetchReferenceData({gasSecret}).then(d=>{
      if(!cancelled){ setRefData(d); setLoading(false); }
    });
    return()=>{ cancelled=true; };
  },[gasSecret,tick]);

  // ── প্রতিটা topic-এর row_count আছে (rebuildIndex থেকে) — subject-এর কাউন্ট
  //    হিসেব করা হয় তার নিচের সব topic-এর row_count যোগ করে (extra fetch লাগে না)। ──
  const list=useMemo(()=>{
    if(!refData) return [];
    const prefix=SHEET_PREFIX[sheet];
    if(type==="subject"){
      return (refData.subjects||[])
        .filter(s=>s.sheet===sheet)
        .map(s=>{
          const cnt=(refData.topics||[]).filter(t=>t.subject_id===s.subject_id)
            .reduce((sum,t)=>sum+(parseInt(t.row_count)||0),0);
          return {id:s.subject_id,name:s.subject_name,count:cnt,refType:"subjects"};
        })
        .sort((a,b)=>b.count-a.count);
    }
    const subjMap={}; (refData.subjects||[]).forEach(s=>{subjMap[s.subject_id]=s.subject_name;});
    return (refData.topics||[])
      .filter(t=>t.subject_id && t.subject_id.startsWith(prefix))
      .map(t=>({
        id:t.topic_id,
        name:`${subjMap[t.subject_id]||"?"} → ${t.topic_name}`,
        rawName:t.topic_name,
        count:parseInt(t.row_count)||0,
        refType:"topics"
      }))
      .sort((a,b)=>b.count-a.count);
  },[refData,sheet,type]);

  const[renameTarget,setRenameTarget]=useState(null);
  const[newName,setNewName]=useState("");
  const[renaming,setRenaming]=useState(false);

  const doRename=async()=>{
    if(!newName.trim()||!renameTarget){push("warn","নতুন নাম দিন","");return;}
    if(newName.trim()===(renameTarget.rawName??renameTarget.name)){push("info","একই নাম","");return;}
    setRenaming(true);
    try{
      const res=await renameReferenceItem({refType:renameTarget.refType,id:renameTarget.id,newName:newName.trim(),gasSecret,push});
      if(res.ok){
        push("success","✅ Rename সম্পন্ন!",
          `শুধু ১টা reference row বদলেছে · এটা ব্যবহারকারী ${renameTarget.count??"?"}টি প্রশ্ন অটোমেটিক নতুন নাম দেখাবে`+
          (res.firebaseSynced===false?" · ⚠️ Firebase mirror sync ব্যর্থ হয়েছে (Phase 4 এখনো deferred, সমস্যা না)":""));
        refresh();
        setRenameTarget(null);setNewName("");
      }
    }catch(e){push("error","Rename ব্যর্থ",String(e?.message||e||"unknown error"));}
    setRenaming(false);
  };

  return(
    <>
      <div className="fld" style={{marginBottom:10}}>
        <label style={{display:"flex",justifyContent:"space-between"}}>
          <span>GAS Secret Key</span>
          <span onClick={refresh} style={{color:C.accent,cursor:"pointer",fontWeight:600}}>🔄 রিফ্রেশ</span>
        </label>
        <input className="inp" type="password" placeholder="Script Properties-এর SECRET_KEY" value={gasSecret} onChange={e=>setGasSecretP(e.target.value)}/>
        <div style={{fontSize:10.5,color:C.muted,marginTop:5,lineHeight:1.5}}>
          এখানে rename করলে শুধু Subjects/Topics রেফারেন্স-টেবিলের ১টা রো বদলাবে — Quiz/QBank/Study-এর প্রশ্নের রো কখনো টাচ হবে না।
        </div>
      </div>
      <div style={{display:"flex",gap:6,marginBottom:8}}>
        {["Quiz","QBank","Study"].map(s=>(
          <button key={s} className={`ftab${sheet===s?" on":""}`} onClick={()=>setSheet(s)}>{s}</button>
        ))}
      </div>
      <div className="atabs" style={{marginBottom:10}}>
        <button className={`atab${type==="subject"?" on":""}`} onClick={()=>setType("subject")}>📚 Subject</button>
        <button className={`atab${type==="topic"?" on":""}`} onClick={()=>setType("topic")}>📂 Topic</button>
      </div>
      <div style={{fontSize:11,color:C.muted,marginBottom:10}}>
        {!gasSecret?"⚠️ GAS Secret Key বসাও":loading?"⏳":`${list.length}টি · ক্লিক করে রিনেম করুন`}
      </div>
      {loading&&list.length===0?[...Array(4)].map((_,i)=><div key={i} className="sk" style={{height:46}}/>):
       list.length===0?<div className="empty"><div className="ei">📂</div><p>কিছু নেই</p></div>:
       list.map(item=>(
        <div key={item.id} className="rename-row" onClick={()=>{setRenameTarget(item);setNewName(item.rawName??item.name);}}>
          <div className="rename-name">{item.name}</div>
          <div className="rename-count">{item.count===null?"":`${item.count}টি`}</div>
          <button className="btn" style={{padding:"4px 10px",fontSize:10,background:tint(C.accent,"20"),color:C.accent,border:`1px solid ${tint(C.accent,"30")}`}}>✏️</button>
        </div>
       ))
      }
      {renameTarget&&(
        <RenameModal
          type={type}
          target={{name:renameTarget.rawName??renameTarget.name,count:renameTarget.count??0}}
          newName={newName}
          setNewName={setNewName}
          onCancel={()=>{setRenameTarget(null);setNewName("");}}
          onRename={doRename}
          renaming={renaming}
        />
      )}
    </>
  );
}


export { RenameTab };
