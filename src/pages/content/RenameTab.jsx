/* ══════════ RENAME TAB (Subject/Sub-topic rename across all rows) ══════════ */
import React, { useState, useMemo } from "react";
import { C } from "../../core/config.js";
import { useFB, invalidate } from "../../core/dataCache.js";
import { fbPatchBatch } from "../../core/firebase.js";
import { toArr } from "../../core/utils.js";
import { RenameModal } from "./RenameModal.jsx";

function RenameTab({push,tick}){
  const[sheet,setSheet]=useState("QBank");
  const[type,setType]=useState("subject");
  const{data:raw,loading}=useFB(sheet,tick);
  const[renameTarget,setRenameTarget]=useState(null);
  const[newName,setNewName]=useState("");
  const[renaming,setRenaming]=useState(false);

  const allQ=useMemo(()=>toArr(raw),[raw]);

  const list=useMemo(()=>{
    const map={};
    allQ.forEach(q=>{
      let key="";
      if(type==="subject")key=(q.Subject||q.subject||"").trim();
      else if(type==="topic")key=(q.Topic||q.topic||"").trim()||(q.Sub_topic||q.sub_topic||"").split(" > ")[0].trim();
      else key=(q.Sub_topic||q.sub_topic||"").trim();
      if(key)map[key]=(map[key]||0)+1;
    });
    return Object.entries(map).sort((a,b)=>b[1]-a[1]);
  },[allQ,type]);

  const doRename=async()=>{
    if(!newName.trim()||!renameTarget){push("warn","নতুন নাম দিন","");return;}
    if(newName.trim()===renameTarget.name){push("info","একই নাম","");return;}
    setRenaming(true);
    try{
      const oldName=renameTarget.name;
      const nName=newName.trim();

      const affected=allQ.filter(q=>{
        if(type==="subject")return(q.Subject||q.subject||"").trim()===oldName;
        if(type==="topic")return(q.Topic||q.topic||"").trim()===oldName||(q.Sub_topic||q.sub_topic||"").split(" > ")[0].trim()===oldName;
        return(q.Sub_topic||q.sub_topic||"").trim()===oldName;
      });

      // ⚡ Parallel batch PATCH (20 concurrent) — much faster than serial
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

      // GAS renameField skipped — Firebase already updated above
      push("success","✅ Rename সম্পন্ন!",`"${oldName}" → "${nName}" · ${done}টি`);
      setRenameTarget(null);setNewName("");
    }catch(e){push("error","Rename ব্যর্থ",String(e?.message||e||"unknown error"));}
    setRenaming(false);
  };

  return(
    <>
      <div style={{display:"flex",gap:6,marginBottom:8}}>
        {["QBank","Quiz","Study"].map(s=>(
          <button key={s} className={`ftab${sheet===s?" on":""}`} onClick={()=>setSheet(s)}>{s}</button>
        ))}
      </div>
      <div className="atabs" style={{marginBottom:10}}>
        <button className={`atab${type==="subject"?" on":""}`} onClick={()=>setType("subject")}>📚 Subject</button>
        <button className={`atab${type==="topic"?" on":""}`} onClick={()=>setType("topic")}>📂 Topic</button>
        <button className={`atab${type==="subtopic"?" on":""}`} onClick={()=>setType("subtopic")}>📌 Subtopic</button>
      </div>
      <div style={{fontSize:11,color:C.muted,marginBottom:10}}>{loading?"⏳":`${list.length}টি · ক্লিক করে রিনেম করুন`}</div>
      {loading&&!raw?[...Array(4)].map((_,i)=><div key={i} className="sk" style={{height:46}}/>):
       list.length===0?<div className="empty"><div className="ei">📂</div><p>কিছু নেই</p></div>:
       list.map(([name,count])=>(
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
