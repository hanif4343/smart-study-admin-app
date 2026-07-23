/* ══════════ BULK QUESTION TYPE UPDATE TAB ══════════ */
import React, { useState, useEffect, useMemo } from "react";
import { C } from "../core/config.js";
import { useFB, invalidate } from "../core/dataCache.js";
import { fbPatch } from "../core/firebase.js";
import { toArr } from "../core/utils.js";

function BulkQTypeTab({push,tick}){
  const[sheet,setSheet]=useState("Study");
  const{data:raw,loading}=useFB(sheet,tick);
  const[filterSub,setFilterSub]=useState("all");
  const[filterAudience,setFilterAudience]=useState("all");
  const[filterExisting,setFilterExisting]=useState("all"); // all|missing|study|mcq|written
  const[targetType,setTargetType]=useState("Study");
  const[selected,setSelected]=useState(new Set());
  const[running,setRunning]=useState(false);
  const[progress,setProgress]=useState({done:0,total:0});

  const allQ=useMemo(()=>toArr(raw),[raw]);

  const subjects=useMemo(()=>[...new Set(allQ.map(q=>q.subject||q.Subject||"").filter(Boolean))],[allQ]);
  const audiences=useMemo(()=>[...new Set(allQ.map(q=>q.AudienceTags||q.audienceTags||"").filter(Boolean))],[allQ]);

  const filtered=useMemo(()=>{
    return allQ.filter(q=>{
      const sub=q.subject||q.Subject||"";
      const aud=q.AudienceTags||q.audienceTags||"";
      const qt=q["Question Type"]||q.QType||q.qtype||"";
      if(filterSub!=="all"&&sub!==filterSub)return false;
      if(filterAudience!=="all"&&!aud.includes(filterAudience))return false;
      if(filterExisting==="missing"&&qt)return false;
      if(filterExisting==="study"&&qt!=="Study")return false;
      if(filterExisting==="mcq"&&qt.toLowerCase()!=="mcq")return false;
      if(filterExisting==="written"&&qt.toLowerCase()!=="written")return false;
      return true;
    });
  },[allQ,filterSub,filterAudience,filterExisting]);

  // reset selection when filter changes
  useEffect(()=>setSelected(new Set()),[filtered]);

  const toggleOne=(q)=>{
    const k=q._fbKey||q.id||q.ID;
    setSelected(prev=>{const s=new Set(prev);s.has(k)?s.delete(k):s.add(k);return s;});
  };
  const toggleAll=()=>{
    if(selected.size===filtered.length){setSelected(new Set());return;}
    setSelected(new Set(filtered.map(q=>q._fbKey||q.id||q.ID)));
  };

  const runUpdate=async()=>{
    const targets=filtered.filter(q=>selected.has(q._fbKey||q.id||q.ID));
    if(!targets.length){push("warn","⚠️ কোনো প্রশ্ন সিলেক্ট করা হয়নি","");return;}
    setRunning(true);
    setProgress({done:0,total:targets.length});
    let done=0;
    const BATCH=10;
    for(let i=0;i<targets.length;i+=BATCH){
      const batch=targets.slice(i,i+BATCH);
      await Promise.all(batch.map(async q=>{
        const fkey=q._fbKey;
        if(!fkey)return;
        try{
          await fbPatch(`${sheet}/${fkey}`,{"Question Type":targetType});
          done++;
          setProgress({done,total:targets.length});
        }catch(e){push("error","ব্যর্থ",String(e?.message||e));}
      }));
    }
    push("success",`✅ ${done}টি প্রশ্ন আপডেট হয়েছে!`,`→ Question Type: ${targetType}`);
    setSelected(new Set());
    invalidate(sheet);
    setRunning(false);
  };

  const getQtColor=(qt)=>{
    if(qt==="Study")return C.green;
    if(qt&&qt.toLowerCase()==="written")return C.purple;
    if(qt&&qt.toLowerCase()==="mcq")return C.accent;
    return C.red; // missing
  };

  return(
    <div style={{padding:"0 4px"}}>
      {/* Sheet selector */}
      <div style={{display:"flex",gap:6,marginBottom:12}}>
        {["QBank","Quiz","Study"].map(s=>(
          <button key={s} className={`ftab${sheet===s?" on":""}`} onClick={()=>setSheet(s)}>{s}</button>
        ))}
      </div>

      {/* Filters */}
      <div style={{background:C.panel,borderRadius:10,padding:10,marginBottom:10,border:`1px solid ${C.border}`}}>
        <div style={{fontSize:11,color:C.muted,marginBottom:6,fontWeight:600}}>🔍 ফিল্টার</div>
        <div style={{marginBottom:7}}>
          <label style={{fontSize:11,color:C.muted,display:"block",marginBottom:3}}>Subject</label>
          <select className="inp" style={{width:"100%",fontSize:12}} value={filterSub} onChange={e=>setFilterSub(e.target.value)}>
            <option value="all">— সব Subject —</option>
            {subjects.map(s=><option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div style={{marginBottom:7}}>
          <label style={{fontSize:11,color:C.muted,display:"block",marginBottom:3}}>Audience Tag</label>
          <select className="inp" style={{width:"100%",fontSize:12}} value={filterAudience} onChange={e=>setFilterAudience(e.target.value)}>
            <option value="all">— সব Audience —</option>
            {audiences.map(a=><option key={a} value={a}>{a}</option>)}
          </select>
        </div>
        <div>
          <label style={{fontSize:11,color:C.muted,display:"block",marginBottom:3}}>বর্তমান Question Type</label>
          <select className="inp" style={{width:"100%",fontSize:12}} value={filterExisting} onChange={e=>setFilterExisting(e.target.value)}>
            <option value="all">— সব —</option>
            <option value="missing">❌ Missing (নেই)</option>
            <option value="study">📖 Study</option>
            <option value="mcq">❓ MCQ</option>
            <option value="written">✍️ Written</option>
          </select>
        </div>
      </div>

      {/* Target type + Update button */}
      <div style={{background:C.panel,borderRadius:10,padding:10,marginBottom:10,border:`1px solid ${C.border}`}}>
        <div style={{fontSize:11,color:C.muted,marginBottom:6,fontWeight:600}}>🎯 পরিবর্তন করব</div>
        <div style={{display:"flex",gap:6,marginBottom:10}}>
          {["MCQ","Written","Study"].map(t=>(
            <button key={t} type="button"
              style={{flex:1,padding:"8px 4px",borderRadius:8,border:`1.5px solid ${targetType===t?C.accent:C.border}`,background:targetType===t?`${C.accent}22`:C.bg,color:targetType===t?C.accent:C.muted,fontWeight:700,fontSize:12,cursor:"pointer"}}
              onClick={()=>setTargetType(t)}>{t==="MCQ"?"❓ MCQ":t==="Written"?"✍️ Written":"📖 Study"}</button>
          ))}
        </div>
        <button className="btn bp" style={{width:"100%",justifyContent:"center",opacity:running?0.6:1}}
          disabled={running||selected.size===0} onClick={runUpdate}>
          {running?`⏳ ${progress.done}/${progress.total} আপডেট হচ্ছে...`:`💾 ${selected.size}টি প্রশ্ন → ${targetType} করুন`}
        </button>
      </div>

      {/* Select all + count */}
      {!loading&&(
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8}}>
          <button className="btn bg" style={{fontSize:11,padding:"5px 10px"}} onClick={toggleAll}>
            {selected.size===filtered.length&&filtered.length>0?"☑️ সব বাতিল":"☐ সব সিলেক্ট"}
          </button>
          <span style={{fontSize:11,color:C.muted}}>
            {filtered.length}টি প্রশ্ন · {selected.size}টি সিলেক্ট
          </span>
        </div>
      )}

      {/* Question list */}
      {loading?<div style={{textAlign:"center",color:C.muted,padding:30}}>⏳ লোড হচ্ছে...</div>:
        filtered.map(q=>{
          const k=q._fbKey||q.id||q.ID;
          const isSel=selected.has(k);
          const qt=q["Question Type"]||q.QType||q.qtype||"";
          const qtColor=getQtColor(qt);
          return(
            <div key={k} onClick={()=>toggleOne(q)}
              style={{background:isSel?`${C.accent}18`:C.card,border:`1.5px solid ${isSel?C.accent:C.border}`,borderRadius:10,padding:"10px 12px",marginBottom:7,cursor:"pointer",transition:"all .15s"}}>
              <div style={{display:"flex",alignItems:"flex-start",gap:8}}>
                <div style={{width:18,height:18,borderRadius:4,border:`2px solid ${isSel?C.accent:C.muted}`,background:isSel?C.accent:"transparent",flexShrink:0,marginTop:2,display:"flex",alignItems:"center",justifyContent:"center"}}>
                  {isSel&&<span style={{color:"#fff",fontSize:11,fontWeight:700}}>✓</span>}
                </div>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:4}}>
                    <span style={{fontSize:10,fontWeight:700,padding:"2px 7px",borderRadius:5,background:`${qtColor}22`,color:qtColor,border:`1px solid ${qtColor}44`}}>
                      {qt||"❌ Missing"}
                    </span>
                    <span style={{fontSize:10,color:C.muted}}>{q.subject||q.Subject||""}</span>
                  </div>
                  <div style={{fontSize:12,color:C.text,lineHeight:1.4,wordBreak:"break-word"}}>
                    {(q.question||q.Question||"").slice(0,100)}{(q.question||q.Question||"").length>100?"...":""}
                  </div>
                </div>
              </div>
            </div>
          );
        })
      }
      {!loading&&filtered.length===0&&<div style={{textAlign:"center",color:C.muted,padding:30}}>কোনো প্রশ্ন পাওয়া যায়নি</div>}
    </div>
  );
}


export { BulkQTypeTab };
