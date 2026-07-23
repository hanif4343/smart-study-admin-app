/* ══════════ DELETE TAB ══════════ */
import React, { useState, useMemo } from "react";
import { C } from "../../core/config.js";
import { useFB, invalidate } from "../../core/dataCache.js";
import { fbDeleteBatch } from "../../core/firebase.js";
import { toArr } from "../../core/utils.js";
import { DeleteWarningModal } from "../../components/shared/DeleteWarningModal.jsx";

function DeleteTab({push,tick}){
  const[sheet,setSheet]=useState("QBank");
  const[type,setType]=useState("subject");
  const{data:raw,loading}=useFB(sheet,tick);
  const[delTarget,setDelTarget]=useState(null);
  const[delLoading,setDelLoading]=useState(false);

  const allQ=useMemo(()=>toArr(raw),[raw]);

  const groups=useMemo(()=>{
    const map={};
    allQ.forEach(q=>{
      let key="";
      if(type==="subject")key=(q.Subject||q.subject||"").trim();
      else if(type==="topic")key=(q.Topic||q.topic||"").trim()||(q.Sub_topic||q.sub_topic||"").split(" > ")[0].trim();
      else key=(q.Sub_topic||q.sub_topic||"").trim();
      if(key)map[key]=(map[key]||[]).concat(q);
    });
    return Object.entries(map).sort((a,b)=>b[1].length-a[1].length);
  },[allQ,type]);

  const[delProgress,setDelProgress]=useState({done:0,total:0});

  const doBulkDelete=async()=>{
    if(!delTarget)return;
    setDelLoading(true);
    const[groupName,qs]=delTarget;
    setDelProgress({done:0,total:qs.length});
    try{
      // ⚡ Single multi-path PATCH call — O(1) instead of O(N) serial deletes
      const keys=qs.map(q=>q._fbKey).filter(Boolean);
      const deleted=await fbDeleteBatch(sheet, keys, (done,total)=>setDelProgress({done,total}));
      invalidate(sheet);
      push("success","🗑️ Bulk Delete!",`"${groupName}" · ${deleted}টি মুছে গেছে`);
      setDelTarget(null);
    }catch(e){push("error","Delete ব্যর্থ",e.message);}
    setDelProgress({done:0,total:0});
    setDelLoading(false);
  };

  return(
    <>
      <div style={{display:"flex",gap:6,marginBottom:8}}>
        {["QBank","Quiz","Study"].map(s=>(
          <button key={s} className={`ftab${sheet===s?" on":""}`} onClick={()=>setSheet(s)}>{s}</button>
        ))}
      </div>
      <div className="atabs" style={{marginBottom:8}}>
        <button className={`atab${type==="subject"?" on":""}`} onClick={()=>setType("subject")}>📚 Subject</button>
        <button className={`atab${type==="topic"?" on":""}`} onClick={()=>setType("topic")}>📂 Topic</button>
        <button className={`atab${type==="subtopic"?" on":""}`} onClick={()=>setType("subtopic")}>📌 Subtopic</button>
      </div>
      <div style={{background:"#ef444412",border:"1px solid #ef444330",borderRadius:9,padding:"8px 11px",marginBottom:10,fontSize:11,color:C.red}}>⚠️ পুরো Subject/Topic ডিলিট — ভেতরের সব প্রশ্ন মুছে যাবে।</div>
      {loading&&!raw?[...Array(4)].map((_,i)=><div key={i} className="sk" style={{height:46}}/>):
       groups.length===0?<div className="empty"><div className="ei">📂</div><p>কিছু নেই</p></div>:
       groups.map(([name,qs])=>(
        <div key={name} className="rename-row">
          <div className="rename-name">{name}</div>
          <div className="rename-count">{qs.length}টি</div>
          <button className="btn" style={{padding:"4px 10px",fontSize:10,background:C.red+"22",color:C.red,border:`1px solid ${C.red}33`}} onClick={()=>setDelTarget([name,qs])}>🗑️</button>
        </div>
       ))
      }
      {delTarget&&<DeleteWarningModal
        title={`"${delTarget[0]}" ডিলিট?`}
        description={`${delTarget[1].length}টি প্রশ্ন Firebase থেকে মুছে যাবে।`}
        onConfirm={doBulkDelete} onCancel={()=>setDelTarget(null)} loading={delLoading}
        progress={delProgress}
      />}
    </>
  );
}

export { DeleteTab };
