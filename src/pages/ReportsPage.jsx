/* ══════════ REPORTS — hard delete ══════════ */
import React, { useState, useMemo, useEffect } from "react";
import { C, GAS } from "../core/config.js";
import { useFB, invalidate } from "../core/dataCache.js";
import { toArr, loadSharedGasSecret } from "../core/utils.js";
import { ReportEditModal } from "./ReportEditModal.jsx";

function ReportsPage({push,tick,deepLinkKey,onDeepLinkHandled}){
  const{data:rRaw,loading}=useFB("Reports",tick);
  const[done,setDone]=useState(new Set());
  const[editing,setEditing]=useState(null);
  const[reindexing,setReindexing]=useState(false);
  const reports=useMemo(()=>toArr(rRaw).filter(r=>!done.has(r._fbKey||r.row)).slice(-30).reverse(),[rRaw,done]);

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
    const match=reports.find(r=>(r._fbKey||r.row)===deepLinkKey);
    if(match){ setEditing(match); onDeepLinkHandled&&onDeepLinkHandled(); }
  },[deepLinkKey,rRaw,reports,onDeepLinkHandled]);

  return(
    <div className="page">
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:11,gap:8,flexWrap:"wrap"}}>
        <div style={{fontSize:11,color:C.muted}}>{reports.length}টি রিপোর্ট</div>
        <div style={{display:"flex",alignItems:"center",gap:8}}>
          {loading&&<span style={{fontSize:10,color:C.muted}}>⏳</span>}
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
      {loading&&!rRaw?[...Array(3)].map((_,i)=><div key={i} className="sk"/>):
       reports.length===0?<div className="empty"><div className="ei">📋</div><p>রিপোর্ট নেই! 🎉</p></div>:
       reports.map((r,i)=>{
        const isMCQ=(r.QType||r.qtype||"MCQ").toLowerCase()!=="written";
        const qid2=r.QuestionID||r.questionId;
        return(
         <div key={r._fbKey||i} className="rc" style={{borderLeft:`3px solid ${isMCQ?C.accent:C.purple}`}}>
           <div style={{display:"flex",alignItems:"center",gap:7,marginBottom:6}}>
             <span style={{background:isMCQ?`${C.accent}22`:`${C.purple}22`,color:isMCQ?C.accent:C.purple,border:`1px solid ${isMCQ?C.accent:C.purple}44`,borderRadius:6,padding:"2px 8px",fontSize:10,fontWeight:700}}>{isMCQ?"❓ MCQ":"✍️ Written"}</span>
             <div style={{fontWeight:700,fontSize:13,flex:1}}>{r.Subject||r.subject||"অজানা"}</div>
           </div>
           <div className="rm">
             <span>📱 {(r.Phone||r.phone||"—").toString().replace(/^'+/,"")}</span>
             {(r.SubTopic||r.subtopic)&&<span>📌 {r.SubTopic||r.subtopic}</span>}
             {qid2&&<span style={{color:C.accent}}>#{qid2}</span>}
           </div>
           <div className="ri">{r.Issue||r.issue||"বিস্তারিত নেই"}</div>
           {(r.Question||r.question)&&<div style={{fontSize:11,color:C.muted,marginTop:4,fontStyle:"italic",borderLeft:`2px solid ${C.border}`,paddingLeft:6}}>প্রশ্ন: {(r.Question||r.question).toString().slice(0,80)}{(r.Question||r.question).length>80?"...":""}</div>}
           <button className="btn bp bb" style={{marginTop:8,background:isMCQ?C.accent:C.purple}} onClick={()=>setEditing(r)}>✏️ এডিট ও সমাধান</button>
         </div>
        );
       })
      }
      {editing&&<ReportEditModal report={editing} onClose={()=>setEditing(null)} onDone={key=>{setDone(p=>new Set([...p,key]));setEditing(null);invalidate("Reports");}} push={push}/>}
    </div>
  );
}

export { ReportsPage };
