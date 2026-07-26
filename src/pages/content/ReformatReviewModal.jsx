/* ══════════ REFORMAT REVIEW MODAL ══════════
   পুরনো বান্ডিল-হয়ে-যাওয়া এন্ট্রি AI দিয়ে re-split করার পর, Firebase-এ লেখার আগে
   admin-কে দেখিয়ে confirm করানোর জন্য। প্রতিটা প্রস্তাবিত entry এখানে এডিট/বাদ
   দেওয়া যায় — ভুল split হলে Firebase-এ কিছু না লিখেই বাতিল/ঠিক করা যায়। */
import React, { useState } from "react";
import { C } from "../../core/config.js";
import { useModalBack } from "../../hooks/useModalBack.js";

function ReformatReviewModal({entries,onSave,onCancel,saving}){
  useModalBack(onCancel);
  const[rows,setRows]=useState(()=>entries.map((e,i)=>({...e,_id:i})));
  const includedCount=rows.filter(r=>r.include).length;

  const update=(id,patch)=>setRows(p=>p.map(r=>r._id===id?{...r,...patch}:r));
  const removeRow=(id)=>setRows(p=>p.filter(r=>r._id!==id));

  return(
    <div className="ovl" style={{zIndex:300}}>
      <div className="modal" style={{borderTop:`3px solid #6366f1`,maxWidth:560,maxHeight:"88vh",display:"flex",flexDirection:"column"}}>
        <div className="mh"/>
        <div style={{marginBottom:10}}>
          <div style={{fontSize:16,fontWeight:700,color:"#6366f1",marginBottom:4}}>🧩 রিফরম্যাট রিভিউ করুন</div>
          <div style={{fontSize:11,color:C.muted,lineHeight:1.5}}>
            AI নিচের {rows.length}টি আলাদা প্রশ্ন প্রস্তাব করেছে। ভুল থাকলে এডিট করুন বা ✕ দিয়ে বাদ দিন। ঠিক থাকলে নিচের বাটনে সেভ করুন — তখনই পুরনো বান্ডিল এন্ট্রি বদলে এই নতুনগুলো Firebase-এ যোগ হবে।
          </div>
        </div>
        <div style={{flex:1,overflowY:"auto",paddingRight:4,marginBottom:12}}>
          {rows.length===0&&<div style={{textAlign:"center",color:C.muted,fontSize:12,padding:20}}>কোনো entry নেই</div>}
          {rows.map((r)=>(
            <div key={r._id} style={{background:r.include?C.panel:"#0000",opacity:r.include?1:0.45,
              border:`1px solid ${C.border}`,borderRadius:10,padding:10,marginBottom:8}}>
              <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:6}}>
                <input type="checkbox" checked={r.include}
                  onChange={()=>update(r._id,{include:!r.include})}
                  style={{width:15,height:15,accentColor:"#6366f1",cursor:"pointer"}}/>
                <span style={{fontSize:10,color:C.muted,flex:1}}>📚 {r.subject||"—"}{r.sub_topic?` · ${r.sub_topic}`:""}</span>
                <button onClick={()=>removeRow(r._id)}
                  style={{background:"transparent",border:"none",color:C.red,fontSize:14,cursor:"pointer",padding:"0 2px"}}>✕</button>
              </div>
              <textarea value={r.q} onChange={e=>update(r._id,{q:e.target.value})}
                placeholder="প্রশ্ন"
                style={{width:"100%",minHeight:44,background:"#0a1628",border:`1px solid ${C.border}`,borderRadius:8,
                  color:C.text,fontSize:12,padding:"7px 9px",marginBottom:6,resize:"vertical",fontWeight:700}}/>
              <textarea value={r.a} onChange={e=>update(r._id,{a:e.target.value})}
                placeholder="উত্তর"
                style={{width:"100%",minHeight:44,background:"#0a1628",border:`1px solid ${C.border}`,borderRadius:8,
                  color:C.green,fontSize:12,padding:"7px 9px",resize:"vertical"}}/>
            </div>
          ))}
        </div>
        <div style={{display:"flex",gap:8}}>
          <button className="btn bg" style={{flex:1,justifyContent:"center"}} onClick={onCancel} disabled={saving}>বাতিল</button>
          <button className="btn" style={{flex:2,justifyContent:"center",background:"#6366f1",color:"#fff"}}
            onClick={()=>onSave(rows)} disabled={saving||includedCount===0}>
            {saving?"⏳ সেভ হচ্ছে...":`✅ সেভ করুন (${includedCount}টি)`}
          </button>
        </div>
      </div>
    </div>
  );
}

export { ReformatReviewModal };
