/* ══════════ RENAME TAB (Subject/Sub-topic rename across all rows) ══════════ */
import React, { useState, useEffect, useMemo, useCallback } from "react";
import { C } from "../../core/config.js";
import { useFB, invalidate } from "../../core/dataCache.js";
import { fbPatchBatch } from "../../core/firebase.js";
import { toArr, loadSharedGasSecret, saveSharedGasSecret } from "../../core/utils.js";
import { normalizeLabel } from "../../core/qbankConverterShared.js";
import { fetchSheetRows, renameFieldInSheet } from "../../core/sheetSave.js";
import { RenameModal } from "./RenameModal.jsx";

// টাইপ (subject/topic/subtopic) → Sheet-এর আসল কলাম নাম ম্যাপিং (Firebase ফিল্ডনাম থেকে আলাদা)
const FIELD_MAP = { subject: "subject", topic: "topic", subtopic: "sub_topic" };

function RenameTab({push,tick}){
  const[sheet,setSheet]=useState("Quiz");
  const[type,setType]=useState("subject");
  // ⚡ সোর্স — 🔥 Firebase (আগের behavior) বা 📄 Google Sheet (নতুন — সরাসরি Sheet-এ রিনেম করে,
  // সাথে Firebase mirror-ও নিজে থেকে sync হয়ে যায়, GAS-এর renameField অ্যাকশন দিয়ে)।
  const[source,setSource]=useState("sheet");
  const[gasSecret,setGasSecret]=useState(loadSharedGasSecret);
  const setGasSecretP=v=>{ setGasSecret(v); saveSharedGasSecret(v); };

  const{data:fbRaw,loading:fbLoading}=useFB(source==="firebase"?sheet:null,tick);

  // ── Google Sheet সোর্স হলে GAS দিয়ে সরাসরি Sheet থেকে রো ফেচ করা হয় ──
  const[sheetRows,setSheetRows]=useState(null);
  const[sheetLoading,setSheetLoading]=useState(false);
  const[sheetTick,setSheetTick]=useState(0);
  const refreshSheet=useCallback(()=>setSheetTick(t=>t+1),[]);
  useEffect(()=>{
    if(source!=="sheet") return;
    if(!gasSecret){ setSheetRows(null); return; }
    let cancelled=false;
    setSheetLoading(true);
    fetchSheetRows({sheet,gasSecret}).then(rows=>{
      if(!cancelled){ setSheetRows(rows); setSheetLoading(false); }
    });
    return()=>{ cancelled=true; };
  },[source,sheet,gasSecret,sheetTick]);

  const allQ=useMemo(()=>source==="sheet"?(sheetRows||[]):toArr(fbRaw),[source,sheetRows,fbRaw]);
  const loading=source==="sheet"?sheetLoading:fbLoading;

  // ── প্রতিটা রো থেকে subject/topic/sub_topic বের করে — সোর্স অনুযায়ী field casing আলাদা
  //    (Firebase-এ প্রায়ই Capitalized, Sheet CSV-তে lowercase headers)। এরপর normalizeLabel
  //    দিয়ে গ্রুপ করা হয় — invisible zero-width char/extra স্পেসে আলাদা কিন্তু দেখতে-একই-রকম
  //    ভ্যারিয়েন্টগুলো এক লাইনে মার্জ হয়ে দেখায়, যাতে "একই জিনিস ২-৩ বার" এমন কনফিউশন না হয়। ──
  const extractKey=useCallback(q=>{
    if(type==="subject")return(q.Subject||q.subject||"").toString().trim();
    if(type==="topic")return(q.Topic||q.topic||"").toString().trim()||(q.Sub_topic||q.sub_topic||"").toString().split(" > ")[0].trim();
    return(q.Sub_topic||q.sub_topic||"").toString().trim();
  },[type]);

  const list=useMemo(()=>{
    // normalizeLabel(key) -> {name: প্রথম দেখা raw ভ্যালু (rename পাঠানোর সময় ব্যবহার হবে), count}
    const map={};
    allQ.forEach(q=>{
      const raw=extractKey(q);
      if(!raw)return;
      const norm=normalizeLabel(raw);
      if(!norm)return;
      if(!map[norm]) map[norm]={name:raw,count:0};
      map[norm].count++;
    });
    return Object.values(map).sort((a,b)=>b.count-a.count);
  },[allQ,extractKey]);

  const[renameTarget,setRenameTarget]=useState(null);
  const[newName,setNewName]=useState("");
  const[renaming,setRenaming]=useState(false);

  const doRename=async()=>{
    if(!newName.trim()||!renameTarget){push("warn","নতুন নাম দিন","");return;}
    if(newName.trim()===renameTarget.name){push("info","একই নাম","");return;}
    setRenaming(true);
    try{
      const oldName=renameTarget.name;
      const nName=newName.trim();

      if(source==="sheet"){
        // ── Google Sheet মোড — GAS "renameField" (normalize-matching + auto Firebase sync) ──
        const field=FIELD_MAP[type];
        const res=await renameFieldInSheet({sheet,field,oldVal:oldName,newVal:nName,gasSecret,push});
        if(res.ok){
          push("success","✅ Rename সম্পন্ন! (Google Sheet)",
            `"${oldName}" → "${nName}" · ${res.count}টি`+(res.firebaseSynced?" · Firebase mirror-ও sync হয়েছে":" · ⚠️ Firebase mirror sync ব্যর্থ হয়েছে, পরে আবার চেষ্টা করো"));
          refreshSheet();
          setRenameTarget(null);setNewName("");
        }
        setRenaming(false);
        return;
      }

      // ── Firebase মোড (আগের মতোই) ──
      const affected=allQ.filter(q=>normalizeLabel(extractKey(q))===normalizeLabel(oldName));
      const patchItems=affected.map(q=>{
        const fkey=q._fbKey;if(!fkey)return null;
        let data;
        if(type==="subject"){
          data={Subject:nName};
        } else if(type==="topic"){
          data={Topic:nName};
          const st=q.Sub_topic||q.sub_topic||"";
          if(st.includes(" > ")){const parts=st.split(" > ");if(parts[0].trim()===oldName)data.Sub_topic=`${nName} > ${parts.slice(1).join(" > ")}`;}
        } else {
          data={Sub_topic:nName};
        }
        return {path:`${sheet}/${fkey}`,data};
      }).filter(Boolean);
      const done=await fbPatchBatch(patchItems);
      invalidate(sheet);
      push("success","✅ Rename সম্পন্ন! (Firebase)",`"${oldName}" → "${nName}" · ${done}টি`);
      setRenameTarget(null);setNewName("");
    }catch(e){push("error","Rename ব্যর্থ",String(e?.message||e||"unknown error"));}
    setRenaming(false);
  };

  return(
    <>
      <div style={{display:"flex",gap:8,marginBottom:10}}>
        <button type="button" className="btn" style={{flex:1,justifyContent:"center",background:source==="sheet"?C.green:"transparent",color:source==="sheet"?"#04180a":C.text,border:`1px solid ${C.border}`}} onClick={()=>setSource("sheet")}>📄 Google Sheet</button>
        <button type="button" className="btn" style={{flex:1,justifyContent:"center",background:source==="firebase"?C.accent:"transparent",color:source==="firebase"?"#fff":C.text,border:`1px solid ${C.border}`}} onClick={()=>setSource("firebase")}>🔥 Firebase</button>
      </div>
      {source==="sheet" && (
        <div className="fld" style={{marginBottom:10}}>
          <label style={{display:"flex",justifyContent:"space-between"}}>
            <span>GAS Secret Key</span>
            <span onClick={refreshSheet} style={{color:C.accent,cursor:"pointer",fontWeight:600}}>🔄 রিফ্রেশ</span>
          </label>
          <input className="inp" type="password" placeholder="Script Properties-এর SECRET_KEY" value={gasSecret} onChange={e=>setGasSecretP(e.target.value)}/>
          <div style={{fontSize:10.5,color:C.muted,marginTop:5,lineHeight:1.5}}>এখানে rename করলে সরাসরি Google Sheet বদলাবে, আর GAS নিজে থেকেই Firebase mirror-ও sync করে দেবে।</div>
        </div>
      )}
      <div style={{display:"flex",gap:6,marginBottom:8}}>
        {["Quiz","QBank","Study"].map(s=>(
          <button key={s} className={`ftab${sheet===s?" on":""}`} onClick={()=>setSheet(s)}>{s}</button>
        ))}
      </div>
      <div className="atabs" style={{marginBottom:10}}>
        <button className={`atab${type==="subject"?" on":""}`} onClick={()=>setType("subject")}>📚 Subject</button>
        <button className={`atab${type==="topic"?" on":""}`} onClick={()=>setType("topic")}>📂 Topic</button>
        <button className={`atab${type==="subtopic"?" on":""}`} onClick={()=>setType("subtopic")}>📌 Subtopic</button>
      </div>
      <div style={{fontSize:11,color:C.muted,marginBottom:10}}>
        {source==="sheet"&&!gasSecret?"⚠️ GAS Secret Key বসাও":loading?"⏳":`${list.length}টি · ক্লিক করে রিনেম করুন`}
      </div>
      {loading&&list.length===0?[...Array(4)].map((_,i)=><div key={i} className="sk" style={{height:46}}/>):
       list.length===0?<div className="empty"><div className="ei">📂</div><p>কিছু নেই</p></div>:
       list.map(({name,count})=>(
        <div key={name} className="rename-row" onClick={()=>{setRenameTarget({name,count});setNewName(name);}}>
          <div className="rename-name">{name}</div>
          <div className="rename-count">{count}টি</div>
          <button className="btn" style={{padding:"4px 10px",fontSize:10,background:C.accent+"20",color:C.accent,border:`1px solid ${C.accent}30`}}>✏️</button>
        </div>
       ))
      }
      {renameTarget&&(
        <RenameModal
          type={type}
          source={source}
          target={renameTarget}
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
