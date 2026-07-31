/* ══════════ DELETE TAB ══════════
   ⚠️ Phase 5 rewrite: আগে এখানে Firebase (useFB) থেকে raw প্রশ্ন স্ক্যান করে
   Subject/Topic/Sub_topic literal নাম দিয়ে গ্রুপ করা হতো, তারপর এক-এক করে
   হাজার হাজার রো ডিলিট হতো (বড় Subject-এ 6-মিনিট execution limit-এর ঝুঁকি ছিল)।
   এখন Subjects/Topics reference-টেবিল (getReferenceData) থেকে subject_id/topic_id
   দিয়ে লিস্ট হয়, আর ডিলিট হয় GAS-এর নতুন "deleteByReferenceId" action দিয়ে —
   row_start/row_count ইনডেক্স ব্যবহার করে একটা মাত্র contiguous-range delete,
   অনেক দ্রুত এবং নিরাপদ। */
import React, { useState, useEffect, useMemo, useCallback } from "react";
import { C } from "../../core/config.js";
import { loadSharedGasSecret, saveSharedGasSecret } from "../../core/utils.js";
import { fetchReferenceData, deleteByReferenceId } from "../../core/sheetSave.js";
import { DeleteWarningModal } from "../../components/shared/DeleteWarningModal.jsx";

function DeleteTab({push}){
  const[sheet,setSheet]=useState("Quiz");
  const[type,setType]=useState("subject"); // subject | topic (subtopic bulk delete সাপোর্ট নেই, একক প্রশ্ন Browse ট্যাব থেকে ডিলিট করো)

  const[gasSecret,setGasSecret]=useState(loadSharedGasSecret);
  const setGasSecretP=v=>{ setGasSecret(v); saveSharedGasSecret(v); };
  const[refData,setRefData]=useState(null);
  const[loading,setLoading]=useState(false);
  const[tick,setTick]=useState(0);
  const refresh=useCallback(()=>setTick(t=>t+1),[]);

  useEffect(()=>{
    if(!gasSecret){ setRefData(null); return; }
    let cancelled=false;
    setLoading(true);
    fetchReferenceData({gasSecret}).then(d=>{ if(!cancelled){ setRefData(d); setLoading(false); } });
    return()=>{ cancelled=true; };
  },[gasSecret,tick]);

  const list=useMemo(()=>{
    if(!refData) return [];
    if(type==="subject"){
      return (refData.subjects||[]).filter(s=>s.sheet===sheet).map(s=>{
        const cnt=(refData.topics||[]).filter(t=>t.subject_id===s.subject_id).reduce((sum,t)=>sum+(parseInt(t.row_count)||0),0);
        return {id:s.subject_id,name:s.subject_name,count:cnt,refType:"subject"};
      }).sort((a,b)=>b.count-a.count);
    }
    const subjMap={}; (refData.subjects||[]).forEach(s=>{subjMap[s.subject_id]=s.subject_name;});
    const prefix={Quiz:"QZ_",QBank:"QB_",Study:"ST_"}[sheet];
    return (refData.topics||[]).filter(t=>t.subject_id&&t.subject_id.startsWith(prefix)).map(t=>({
      id:t.topic_id,name:`${subjMap[t.subject_id]||"?"} → ${t.topic_name}`,count:parseInt(t.row_count)||0,refType:"topic"
    })).sort((a,b)=>b.count-a.count);
  },[refData,sheet,type]);

  const[delTarget,setDelTarget]=useState(null);
  const[delLoading,setDelLoading]=useState(false);

  const doBulkDelete=async()=>{
    if(!delTarget)return;
    setDelLoading(true);
    const res=await deleteByReferenceId({refType:delTarget.refType,id:delTarget.id,gasSecret,push});
    if(res.ok){
      push("success","🗑️ Bulk Delete সম্পন্ন!",
        `"${delTarget.name}" · ${res.deleted}টি প্রশ্ন মুছে গেছে (Exam_Appearances: ${res.examAppearancesDeleted}টি clean হয়েছে) · index অটো আপডেট হয়েছে`);
      setDelTarget(null);
      refresh();
    }
    setDelLoading(false);
  };

  return(
    <>
      <div className="fld" style={{marginBottom:10}}>
        <label style={{display:"flex",justifyContent:"space-between"}}>
          <span>GAS Secret Key</span>
          <span onClick={refresh} style={{color:C.accent,cursor:"pointer",fontWeight:600}}>🔄 রিফ্রেশ</span>
        </label>
        <input className="inp" type="password" placeholder="Script Properties-এর SECRET_KEY" value={gasSecret} onChange={e=>setGasSecretP(e.target.value)}/>
      </div>
      <div style={{display:"flex",gap:6,marginBottom:8}}>
        {["Quiz","QBank","Study"].map(s=>(
          <button key={s} className={`ftab${sheet===s?" on":""}`} onClick={()=>setSheet(s)}>{s}</button>
        ))}
      </div>
      <div className="atabs" style={{marginBottom:8}}>
        <button className={`atab${type==="subject"?" on":""}`} onClick={()=>setType("subject")}>📚 Subject</button>
        <button className={`atab${type==="topic"?" on":""}`} onClick={()=>setType("topic")}>📂 Topic</button>
      </div>
      <div style={{background:"#ef444412",border:"1px solid #ef444330",borderRadius:9,padding:"8px 11px",marginBottom:10,fontSize:11,color:C.red}}>
        ⚠️ পুরো Subject/Topic ডিলিট — ভেতরের সব প্রশ্ন মুছে যাবে। এককভাবে একটা প্রশ্ন (বা multi-part group) ডিলিট করতে Browse ট্যাব ব্যবহার করো।
      </div>
      {!gasSecret?<div className="empty"><div className="ei">🔑</div><p>GAS Secret Key বসাও</p></div>:
       loading?[...Array(4)].map((_,i)=><div key={i} className="sk" style={{height:46}}/>):
       list.length===0?<div className="empty"><div className="ei">📂</div><p>কিছু নেই</p></div>:
       list.map(item=>(
        <div key={item.id} className="rename-row">
          <div className="rename-name">{item.name}</div>
          <div className="rename-count">{item.count}টি</div>
          <button className="btn" style={{padding:"4px 10px",fontSize:10,background:C.red+"22",color:C.red,border:`1px solid ${C.red}33`}} onClick={()=>setDelTarget(item)}>🗑️</button>
        </div>
       ))
      }
      {delTarget&&<DeleteWarningModal
        title={`"${delTarget.name}" ডিলিট?`}
        description={`${delTarget.count}টি প্রশ্ন Google Sheet থেকে স্থায়ীভাবে মুছে যাবে (রেঞ্জ-ভিত্তিক দ্রুত ডিলিট, ও সংশ্লিষ্ট Exam_Appearances এন্ট্রিও ক্লিন-আপ হবে)।`}
        onConfirm={doBulkDelete} onCancel={()=>setDelTarget(null)} loading={delLoading}
      />}
    </>
  );
}

export { DeleteTab };
