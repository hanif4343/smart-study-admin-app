/* ══════════════════════════════════════════════════════════════════
   ARCHIVE PAGE — অসম্পূর্ণ (submit না হওয়া) OCR/AI Import draft-এর তালিকা
   AI Import ও Multi-Subject Import পেজ দুটোই নিজে নিজে (background-এ)
   এখানে draft সেভ করে — এই পেজ শুধু সেগুলো manually browse/resume/delete
   করার জন্য। submit সফল হওয়ার সাথে সাথে draft এখান থেকে সরিয়ে ফেলা হয়
   (ওই পেজগুলোর ভেতর থেকেই)।
   ══════════════════════════════════════════════════════════════════ */
import React, { useState, useEffect, useCallback } from "react";
import { C } from "../core/config.js";
import { listDrafts, deleteDraft } from "../core/archiveStore.js";

const SOURCE_LABEL = { aiimport:"📸 AI Import", multiimport:"🗂️ Multi-Subject Import" };

function ArchivePage({push,onResume,tick}){
  const[drafts,setDrafts]=useState([]);
  const[loading,setLoading]=useState(true);

  const refresh=useCallback(()=>{
    setLoading(true);
    listDrafts().then(all=>{setDrafts(all);setLoading(false);}).catch(()=>setLoading(false));
  },[]);

  useEffect(()=>{ refresh(); },[refresh,tick]);

  const handleDelete=async(d)=>{
    await deleteDraft(d.id);
    push("success","🗑️ Draft মুছে ফেলা হয়েছে","");
    refresh();
  };

  const countFor=(d)=>{
    if(d.source==="aiimport"){
      const q=(d.parsedAll||"").split("\n").filter(l=>l.trim()&&l.includes(";")).length;
      return `${(d.images||[]).length}টি ছবি`+(q?` — ${q}টি প্রশ্ন parsed`:"");
    }
    if(d.source==="multiimport"){
      const q=(d.draftGroups||[]).reduce((s,g)=>s+(g.rows?.length||0),0);
      return `${(d.images||[]).length}টি ছবি`+(q?` — ${q}টি প্রশ্ন`:"")+(d.phase?` — ধাপ: ${d.phase}`:"");
    }
    return "";
  };

  return(
    <div className="page">
      <div style={{background:"linear-gradient(135deg,#4f46e5,#7c3aed)",borderRadius:14,padding:"14px 16px",marginBottom:14,color:"#fff"}}>
        <div style={{fontWeight:900,fontSize:15,marginBottom:2}}>🗄️ Archive — অসম্পূর্ণ কাজ</div>
        <div style={{fontSize:11,opacity:.85}}>App বন্ধ হয়ে গেলেও OCR/AI করা কাজ এখানে safe থাকে, যতক্ষণ না submit হয়</div>
      </div>

      {loading&&<div style={{textAlign:"center",color:C.muted,fontSize:12,padding:24}}>লোড হচ্ছে...</div>}

      {!loading&&!drafts.length&&(
        <div style={{textAlign:"center",color:C.muted,fontSize:12,padding:36}}>
          ✅ কোনো অসম্পূর্ণ কাজ নেই — যা কিছু OCR/AI করা হয়েছে সব সফলভাবে submit হয়ে গেছে
        </div>
      )}

      {drafts.map(d=>(
        <div key={d.id} style={{background:C.panel,border:`1px solid ${C.border}`,borderRadius:12,padding:"10px 14px",marginBottom:10}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:4}}>
            <div style={{fontSize:12,fontWeight:800,color:C.text}}>{SOURCE_LABEL[d.source]||d.source}</div>
            <div style={{fontSize:10,color:C.muted}}>{new Date(d.updatedAt||d.createdAt||Date.now()).toLocaleString("bn-BD")}</div>
          </div>
          <div style={{fontSize:11,color:C.muted,marginBottom:8}}>{countFor(d)}</div>
          <div style={{display:"flex",gap:8}}>
            <button className="btn" onClick={()=>onResume(d.source,d.id)}
              style={{flex:1,justifyContent:"center",background:"#052e16",color:"#10b981",borderColor:"#10b981",fontWeight:700}}>
              🔄 ফিরিয়ে আনুন ও চালিয়ে যান
            </button>
            <button className="btn" onClick={()=>handleDelete(d)}
              style={{background:"#7f1d1d",color:"#fca5a5",borderColor:"#991b1b",padding:"0 14px"}}>
              🗑️
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

export { ArchivePage };
