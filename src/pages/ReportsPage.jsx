/* ══════════ REPORTS — hard delete ══════════ */
import React, { useState, useMemo } from "react";
import { C } from "../core/config.js";
import { useFB, invalidate } from "../core/dataCache.js";
import { toArr } from "../core/utils.js";
import { ReportEditModal } from "./ReportEditModal.jsx";

function ReportsPage({push,tick}){
  const{data:rRaw,loading}=useFB("Reports",tick);
  const[done,setDone]=useState(new Set());
  const[editing,setEditing]=useState(null);
  const reports=useMemo(()=>toArr(rRaw).filter(r=>!done.has(r._fbKey||r.row)).slice(-30).reverse(),[rRaw,done]);
  return(
    <div className="page">
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:11}}>
        <div style={{fontSize:11,color:C.muted}}>{reports.length}টি রিপোর্ট</div>
        {loading&&<span style={{fontSize:10,color:C.muted}}>⏳</span>}
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
