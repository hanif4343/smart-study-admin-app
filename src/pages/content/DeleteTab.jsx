/* ══════════ DELETE TAB ══════════ */
import React, { useState, useMemo, useEffect } from "react";
import { C } from "../../core/config.js";
import { useFB, invalidate } from "../../core/dataCache.js";
import { fbDeleteBatch } from "../../core/firebase.js";
import { deleteIdsInSheet } from "../../core/sheetSave.js";
import { toArr, loadSharedGasSecret } from "../../core/utils.js";
import { DeleteWarningModal } from "../../components/shared/DeleteWarningModal.jsx";

function DeleteTab({push,tick}){
  const[sheet,setSheet]=useState("Quiz");
  const[type,setType]=useState("subject");
  const{data:raw,loading}=useFB(sheet,tick);
  const[delTarget,setDelTarget]=useState(null);
  const[delLoading,setDelLoading]=useState(false);
  // Sheet delete সফল হলেও Firebase read এখনো পুরনো ডেটাই দেখাতে পারে (Firebase write
  // permission block থাকলেও read কাজ করতে পারে) — তাই সদ্য-ডিলিট-হওয়া ID গুলো এখানে
  // লোকালি ট্র্যাক করে UI থেকে সাথে সাথেই বাদ দেওয়া হয়, sheet ভিত্তিক অবস্থা যেন সঠিক দেখায়।
  const[locallyRemoved,setLocallyRemoved]=useState(()=>new Set());
  useEffect(()=>{ setLocallyRemoved(new Set()); },[sheet]);

  const allQ=useMemo(()=>{
    const arr=toArr(raw);
    if(!locallyRemoved.size)return arr;
    return arr.filter(q=>!locallyRemoved.has((q.ID||q.id||"").toString().trim()));
  },[raw,locallyRemoved]);

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

    const keys=qs.map(q=>q._fbKey).filter(Boolean);
    const sheetIds=qs.map(q=>(q.ID||q.id||"").toString().trim()).filter(Boolean);
    const gasSecret=loadSharedGasSecret();

    // ⚡ Firebase delete আগে এখানেই "মূল" কাজ ছিল আর ব্যর্থ হলে (permission denied/quota
    // exceeded) পুরো delete-ই বাতিল হয়ে যেত — Sheet-এর দিকে কখনো পৌঁছাতোই না। এখন উল্টো:
    // Sheet delete (GAS "deleteByIds") এখন প্রাইমারি/নির্ভরযোগ্য অ্যাকশন, Firebase শুধু
    // best-effort মিরর — ব্যর্থ হলেও Sheet delete থামবে না বা বাতিল হবে না।
    let fbDeleted=0, fbError=null;
    try{
      fbDeleted=await fbDeleteBatch(sheet, keys, (done,total)=>setDelProgress({done,total}));
    }catch(e){ fbError=e?.message||String(e); }
    invalidate(sheet);

    let sheetRes={ok:false,deleted:0,error:"GAS Secret Key নেই — Save Location প্যানেলে বসাও"};
    if(gasSecret&&sheetIds.length){
      sheetRes=await deleteIdsInSheet({sheet,ids:sheetIds,gasSecret});
    } else if(!sheetIds.length){
      sheetRes={ok:false,deleted:0,error:"এই রো-গুলোর ID পাওয়া যায়নি"};
    }

    if(sheetRes.ok){
      push("success","🗑️ Sheet-এ Bulk Delete!",
        `"${groupName}" · Sheet থেকে ${sheetRes.deleted}টি মুছে গেছে`
        +(fbError?` (Firebase ব্যর্থ ছিল: ${fbError} — শুধু Sheet থেকেই মুছেছে)`:""));
      setLocallyRemoved(prev=>new Set([...prev,...sheetIds]));
      setDelTarget(null);
    } else if(fbDeleted>0){
      // Firebase-এ হয়েছে কিন্তু Sheet-এ হয়নি — আগের মতো পুরোপুরি ব্যর্থ দেখানো ঠিক না,
      // কিন্তু স্পষ্ট করে জানানো দরকার Sheet এখনো purono ডেটাই দেখাবে
      push("error","⚠️ Firebase-এ ডিলিট হয়েছে, Sheet-এ হয়নি",sheetRes.error||"Sheet ম্যানুয়ালি চেক করো");
      setDelTarget(null);
    } else {
      push("error","❌ Delete সম্পূর্ণ ব্যর্থ (Firebase ও Sheet দুটোই)",
        [fbError,sheetRes.error].filter(Boolean).join(" | ")||"অজানা কারণ");
    }
    setDelProgress({done:0,total:0});
    setDelLoading(false);
  };

  return(
    <>
      <div style={{display:"flex",gap:6,marginBottom:8}}>
        {["Quiz","QBank","Study"].map(s=>(
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
        description={`${delTarget[1].length}টি প্রশ্ন Google Sheet থেকে মুছে যাবে (Firebase-এও চেষ্টা হবে, ব্যর্থ হলেও Sheet delete আটকাবে না)।`}
        onConfirm={doBulkDelete} onCancel={()=>setDelTarget(null)} loading={delLoading}
        progress={delProgress}
      />}
    </>
  );
}

export { DeleteTab };
