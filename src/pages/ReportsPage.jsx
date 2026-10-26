/* ══════════ REPORTS — hard delete ══════════ */
import React, { useState, useMemo, useEffect } from "react";
import { C, tint, GAS } from "../core/config.js";
import { useFB, invalidate } from "../core/dataCache.js";
import { toArr, loadSharedGasSecret } from "../core/utils.js";
import { fbDeleteBatch } from "../core/firebase.js";
import { ReportEditModal } from "./ReportEditModal.jsx";

/* রিপোর্টের সময় (ms): timestamp ফিল্ড থেকে, না থাকলে Firebase push-id-র প্রথম ৮ অক্ষর থেকে (সেখানে সময় লুকানো থাকে) */
const PUSH_CHARS="-0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz";
function reportTime(r){
  const raw=r.timestamp??r.Timestamp??r.time??r.createdAt;
  let n=typeof raw==="number"?raw:(typeof raw==="string"&&/^\d{9,}$/.test(raw.trim())?Number(raw):0);
  if(n>0&&n<1e11) n*=1000;           // সেকেন্ড হলে মিলিসেকেন্ড
  if(n>1e11) return n;
  const k=String(r._fbKey||"");
  if(k.length>=8&&/^-/.test(k)){ let t=0; for(let i=0;i<8;i++){ const ix=PUSH_CHARS.indexOf(k[i]); if(ix<0) return 0; t=t*64+ix; } if(t>1e11&&t<4e12) return t; }
  return 0;                          // সময় জানা নেই
}
function fmtDate(ms){
  if(!ms) return "";
  try{ return new Date(ms).toLocaleDateString("bn-BD",{day:"numeric",month:"short",year:"numeric"}); }catch{ return new Date(ms).toISOString().slice(0,10); }
}
const DAY=86400000;

function ReportsPage({push,tick,deepLinkKey,onDeepLinkHandled}){
  const{data:rRaw,loading}=useFB("Reports",tick);
  const[done,setDone]=useState(new Set());
  const[editing,setEditing]=useState(null);
  const[reindexing,setReindexing]=useState(false);
  const[limit,setLimit]=useState(30);
  const[confirmKey,setConfirmKey]=useState(null);   // একটা রিপোর্ট মুছতে ২য় ট্যাপের অপেক্ষা
  const[showClean,setShowClean]=useState(false);
  const[pendingClean,setPendingClean]=useState(null); // {label,keys}
  const[deleting,setDeleting]=useState(false);
  // সব রিপোর্ট, নতুন আগে (সময় না জানা থাকলে key-র ক্রমে)
  const allReports=useMemo(()=>toArr(rRaw).filter(r=>!done.has(r._fbKey||r.row)).map(r=>({...r,_t:reportTime(r)})).reverse(),[rRaw,done]);
  const reports=useMemo(()=>allReports.slice(0,limit),[allReports,limit]);

  // ── 🗑️ মেইন সোর্স (Firebase "Reports") থেকে সরাসরি মুছে ফেলা ──
  const deleteKeys=async(keys,label)=>{
    if(!keys.length||deleting) return;
    setDeleting(true);
    try{
      const n=await fbDeleteBatch("Reports",keys);
      setDone(p=>new Set([...p,...keys]));
      invalidate("Reports");
      push?.("success",`🗑️ ${n}টা রিপোর্ট মুছে গেছে`,label||"");
    }catch(e){ push?.("error","❌ মুছতে ব্যর্থ",e.message||String(e)); }
    setDeleting(false); setConfirmKey(null); setPendingClean(null);
  };
  const cleanOptions=useMemo(()=>{
    const now=Date.now();
    const olderThan=d=>allReports.filter(r=>r._fbKey&&r._t>0&&now-r._t>d*DAY).map(r=>r._fbKey);
    return[
      {label:"৭ দিনের আগের",keys:olderThan(7)},
      {label:"৩০ দিনের আগের",keys:olderThan(30)},
      {label:"৯০ দিনের আগের",keys:olderThan(90)},
      {label:"সব রিপোর্ট",keys:allReports.filter(r=>r._fbKey).map(r=>r._fbKey),danger:true},
    ];
  },[allReports]);

  // ── 🔄 Reindex Quiz/QBank/Study — GAS action=rebuildIndex কল করে। Topics ট্যাবে
  // প্রতিটা sheet-এর নিজস্ব row_start_<sheet>/row_count_<sheet> কলাম নতুন করে বসায়
  // (Quiz-এ প্রশ্ন 0/"পাওয়া যায়নি" দেখানোর বাগ ফিক্সের অংশ — দেখো code_updated.gs)।
  // Backend ডিপ্লয়ের পরে একবার, আর তারপর নতুন সাবজেক্ট/টপিক/প্রশ্ন যোগ হলে দরকারমতো
  // আবার চালানো যাবে — এখান থেকে সরাসরি, Apps Script এডিটরে গিয়ে ম্যানুয়ালি চালানো লাগবে না।
  const runReindex=async()=>{
    if(!GAS){ push?.("error","❌ GAS URL সেট করা নেই","VITE_GAS_URL env var বিল্ডে সেট করা আছে কিনা চেক করো"); return; }
    const secret=loadSharedGasSecret();
    if(!secret){ push?.("error","❌ GAS Secret Key দাও","Save Location/QBank Converter প্যানেলে Secret Key বসাও, তারপর আবার চেষ্টা করো"); return; }
    setReindexing(true);
    try{
      const url=`${GAS}?action=rebuildIndex&secret=${encodeURIComponent(secret)}`;
      const resp=await fetch(url);
      const data=await resp.json().catch(()=>({}));
      if(data.status==="success"||data.result==="success"){
        push?.("success","✅ রিইনডেক্স সম্পন্ন","Quiz/QBank/Study — প্রতিটা শিটের ইনডেক্স আলাদাভাবে রিবিল্ড হয়েছে");
      }else{
        push?.("error","❌ রিইনডেক্স ব্যর্থ",data.message||"অজানা এরর — GAS Executions log চেক করো");
      }
    }catch(e){ push?.("error","❌ রিইনডেক্স ব্যর্থ",e.message); }
    setReindexing(false);
  };

  /* ── নোটিফিকেশন/push থেকে deep-link এলে ঠিক সেই রিপোর্টটাই এডিট মোডালে খুলে দাও ── */
  useEffect(()=>{
    if(!deepLinkKey||!rRaw)return;
    const match=allReports.find(r=>(r._fbKey||r.row)===deepLinkKey);
    if(match){ setEditing(match); onDeepLinkHandled&&onDeepLinkHandled(); }
  },[deepLinkKey,rRaw,allReports,onDeepLinkHandled]);

  return(
    <div className="page">
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:11,gap:8,flexWrap:"wrap"}}>
        <div style={{fontSize:11,color:C.muted}}>মোট {allReports.length}টি রিপোর্ট{allReports.length>reports.length?` (${reports.length}টা দেখানো হচ্ছে)`:""}</div>
        <div style={{display:"flex",alignItems:"center",gap:8}}>
          {loading&&<span style={{fontSize:10,color:C.muted}}>⏳</span>}
          <button className="btn bg" onClick={()=>{setShowClean(s=>!s);setPendingClean(null);}} style={{fontSize:11,padding:"6px 10px",color:C.red,borderColor:tint(C.red,"66")}}>🧹 পুরনো রিপোর্ট মুছো</button>
          <button
            className="btn bg"
            disabled={reindexing}
            onClick={runReindex}
            title="Quiz/QBank/Study — প্রতিটা শিটের প্রশ্ন-ইনডেক্স আলাদাভাবে রিবিল্ড করো (Quiz/Study-তে প্রশ্ন 0 দেখানোর বাগ ফিক্সের জন্য)"
            style={{fontSize:11,padding:"6px 10px"}}
          >
            {reindexing?"⏳ রিইনডেক্স হচ্ছে...":"🔄 Reindex Quiz/QBank/Study"}
          </button>
        </div>
      </div>
      {showClean&&(
        <div style={{background:tint(C.red,"10"),border:`1px solid ${tint(C.red,"55")}`,borderRadius:10,padding:10,marginBottom:11}}>
          <div style={{fontSize:12,fontWeight:700,color:C.red,marginBottom:6}}>🧹 একসাথে মুছো — Firebase থেকে স্থায়ীভাবে মুছবে</div>
          {pendingClean?(
            <div>
              <div style={{fontSize:12,marginBottom:8,lineHeight:1.5}}>⚠️ <b>{pendingClean.label}</b> {pendingClean.keys.length}টা রিপোর্ট স্থায়ীভাবে মুছে যাবে, ফেরত আনা যাবে না। নিশ্চিত?</div>
              <div style={{display:"flex",gap:8}}>
                <button className="btn bg" style={{flex:1,justifyContent:"center"}} disabled={deleting} onClick={()=>setPendingClean(null)}>বাতিল</button>
                <button className="btn" style={{flex:2,justifyContent:"center",background:C.red,color:"#fff"}} disabled={deleting} onClick={()=>deleteKeys(pendingClean.keys,pendingClean.label)}>{deleting?"⏳ মুছছে...":"✅ হ্যাঁ, মুছো"}</button>
              </div>
            </div>
          ):(
            <div style={{display:"flex",flexDirection:"column",gap:6}}>
              {cleanOptions.map(o=>(
                <button key={o.label} className="btn bg" disabled={o.keys.length===0}
                  onClick={()=>setPendingClean({label:o.label,keys:o.keys})}
                  style={{justifyContent:"space-between",fontSize:12,opacity:o.keys.length?1:.5,...(o.danger?{color:C.red,borderColor:tint(C.red,"66")}:{})}}>
                  <span>{o.danger?"⚠️ ":"🗓️ "}{o.label}</span><b>{o.keys.length}টা</b>
                </button>
              ))}
              <div style={{fontSize:10,color:C.muted,lineHeight:1.5}}>"দিনের আগের" বাছলে শুধু সেই রিপোর্টগুলো যাবে যাদের তারিখ জানা আছে। প্রতিটা রিপোর্টের নিচে আলাদা 🗑️ বাটনও আছে।</div>
            </div>
          )}
        </div>
      )}
      {loading&&!rRaw?[...Array(3)].map((_,i)=><div key={i} className="sk"/>):
       reports.length===0?<div className="empty"><div className="ei">📋</div><p>রিপোর্ট নেই! 🎉</p></div>:
       reports.map((r,i)=>{
        const isMCQ=(r.QType||r.qtype||"MCQ").toLowerCase()!=="written";
        const qid2=r.QuestionID||r.questionId;
        return(
         <div key={r._fbKey||i} className="rc" style={{borderLeft:`3px solid ${isMCQ?C.accent:C.purple}`}}>
           <div style={{display:"flex",alignItems:"center",gap:7,marginBottom:6}}>
             <span style={{background:isMCQ?`${tint(C.accent,"22")}`:`${tint(C.purple,"22")}`,color:isMCQ?C.accent:C.purple,border:`1px solid ${isMCQ?C.accent:C.purple}44`,borderRadius:6,padding:"2px 8px",fontSize:10,fontWeight:700}}>{isMCQ?"❓ MCQ":"✍️ Written"}</span>
             <div style={{fontWeight:700,fontSize:13,flex:1}}>{r.Subject||r.subject||"অজানা"}</div>
             {r._t>0&&<span style={{fontSize:10,color:C.muted,whiteSpace:"nowrap"}}>📅 {fmtDate(r._t)}</span>}
           </div>
           <div className="rm">
             <span>📱 {(r.Phone||r.phone||"—").toString().replace(/^'+/,"")}</span>
             {(r.SubTopic||r.subtopic)&&<span>📌 {r.SubTopic||r.subtopic}</span>}
             {qid2&&<span style={{color:C.accent}}>#{qid2}</span>}
           </div>
           <div className="ri">{r.Issue||r.issue||"বিস্তারিত নেই"}</div>
           {(r.Question||r.question)&&<div style={{fontSize:11,color:C.muted,marginTop:4,fontStyle:"italic",borderLeft:`2px solid ${C.border}`,paddingLeft:6}}>প্রশ্ন: {(r.Question||r.question).toString().slice(0,80)}{(r.Question||r.question).length>80?"...":""}</div>}
           <div style={{display:"flex",gap:8,marginTop:8}}>
             <button className="btn bp bb" style={{flex:1,margin:0,background:isMCQ?C.accent:C.purple}} onClick={()=>setEditing(r)}>✏️ এডিট ও সমাধান</button>
             {r._fbKey&&(confirmKey===r._fbKey?(
               <>
                 <button className="btn bg" style={{justifyContent:"center",padding:"0 12px"}} disabled={deleting} onClick={()=>setConfirmKey(null)}>না</button>
                 <button className="btn" style={{justifyContent:"center",background:C.red,color:"#fff",padding:"0 12px",fontWeight:700}} disabled={deleting} onClick={()=>deleteKeys([r._fbKey],"সমাধান ছাড়াই মুছে ফেলা হয়েছে")}>{deleting?"⏳":"✅ মুছো"}</button>
               </>
             ):(
               <button className="btn bg" title="সমাধান না করেই মুছে ফেলো" style={{justifyContent:"center",padding:"0 14px",color:C.red,borderColor:tint(C.red,"66")}} onClick={()=>setConfirmKey(r._fbKey)}>🗑️</button>
             ))}
           </div>
         </div>
        );
       })
      }
      {allReports.length>reports.length&&(
        <button className="btn bg bb" style={{marginTop:6,justifyContent:"center"}} onClick={()=>setLimit(l=>l+30)}>⬇️ আরও ৩০টা দেখাও ({allReports.length-reports.length}টা বাকি)</button>
      )}
      {editing&&<ReportEditModal report={editing} onClose={()=>setEditing(null)} onDone={key=>{setDone(p=>new Set([...p,key]));setEditing(null);invalidate("Reports");}} push={push}/>}
    </div>
  );
}

export { ReportsPage };
