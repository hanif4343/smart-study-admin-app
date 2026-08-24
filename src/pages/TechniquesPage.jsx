/* ══════════ TECHNIQUES PAGE ══════════ */
import React, { useState, useMemo } from "react";
import { C, tint } from "../core/config.js";
import { useFB, invalidate } from "../core/dataCache.js";
import { fbPatch, fbSet, fbDelete } from "../core/firebase.js";
import { nowTs, phoneKey } from "../core/utils.js";
import { fcmNotifyPhone } from "../core/fcm.js";

function TechniquesPage({push,tick}){
  const{data:raw,loading}=useFB("UserTechniques",tick);
  const[tab,setTab]=useState("pending");
  const[busy,setBusy]=useState(null);
  const[detail,setDetail]=useState(null);
  const[done,setDone]=useState(new Set());

  // Flatten nested structure: { questionId: { pushKey: {...} } }
  const allTechniques=useMemo(()=>{
    if(!raw||typeof raw!=="object")return[];
    const list=[];
    Object.entries(raw).forEach(([qId,entries])=>{
      if(!entries||typeof entries!=="object")return;
      Object.entries(entries).forEach(([pushKey,data])=>{
        if(!data||typeof data!=="object")return;
        list.push({...data,_qId:qId,_pushKey:pushKey,_path:`UserTechniques/${qId}/${pushKey}`});
      });
    });
    return list.sort((a,b)=>(b.timestamp||0)-(a.timestamp||0));
  },[raw]);

  const filtered=useMemo(()=>
    allTechniques.filter(t=>{
      if(done.has(t._pushKey))return false;
      if(tab==="pending")return t.isPublic&&(t.status==="pending"||!t.status);
      if(tab==="approved")return t.isPublic&&t.status==="approved";
      if(tab==="rejected")return t.isPublic&&t.status==="rejected";
      return true; // "all"
    })
  ,[allTechniques,tab,done]);

  const pendingCount=useMemo(()=>
    allTechniques.filter(t=>!done.has(t._pushKey)&&t.isPublic&&(t.status==="pending"||!t.status)).length
  ,[allTechniques,done]);

  const updateStatus=async(t,status)=>{
    const key=t._pushKey;
    setBusy(key);
    try{
      await fbPatch(`UserTechniques/${t._qId}/${key}`,{status});
      invalidate("UserTechniques");
      setDone(p=>new Set([...p,key]));
      push("success",status==="approved"?"✅ Approved!":"❌ Rejected!",t.userName||"ব্যবহারকারী");

      // ── ব্যবহারকারীকে instant notification পাঠাও ──
      const phone=(t.userId||t.phone||t.Phone||"").toString().replace(/^'+/,"").trim();
      if(phone){
        const notifTitle=status==="approved"?"✅ টেকনিক Approved!":"❌ টেকনিক Rejected";
        const notifBody=status==="approved"
          ? "আপনার শেয়ার করা টেকনিকটি অনুমোদিত হয়েছে এবং সবাই দেখতে পারবে। ধন্যবাদ! 🎉"
          : "আপনার শেয়ার করা টেকনিকটি এই মুহূর্তে গ্রহণ করা হয়নি।";
        const phK=phoneKey(phone);
        fbSet(`Notifications/${phK}/notif_${Date.now()}`,{type:"technique_"+status,title:notifTitle,body:notifBody,questionId:t._qId||"",time:nowTs(),read:false}).catch(()=>{});
        // FCM direct — instant
        fcmNotifyPhone(phone, notifTitle, notifBody, {type:"technique_"+status, questionId:t._qId||""}).catch(()=>{});
      }
    }catch(e){push("error","ব্যর্থ",e.message);}
    setBusy(null);
  };

  const deleteT=async(t)=>{
    setBusy(t._pushKey);
    try{
      await fbDelete(`UserTechniques/${t._qId}/${t._pushKey}`);
      invalidate("UserTechniques");
      setDone(p=>new Set([...p,t._pushKey]));
      push("success","🗑️ ডিলিট!","");
    }catch(e){push("error","ব্যর্থ",e.message);}
    setBusy(null);
  };

  const tsFormat=ts=>{
    if(!ts)return"—";
    const d=new Date(parseInt(ts));
    return d.toLocaleString("bn-BD",{timeZone:"Asia/Dhaka",dateStyle:"short",timeStyle:"short"});
  };

  return(
    <div className="page">
      {/* Summary row */}
      <div className="sg" style={{marginBottom:10}}>
        <div className="sc tb" data-icon="⏳">
          <div className="sl">পেন্ডিং</div>
          <div className="sv sv-b">{pendingCount}</div>
        </div>
        <div className="sc tg" data-icon="✅">
          <div className="sl">মোট</div>
          <div className="sv sv-g">{allTechniques.filter(t=>t.isPublic).length}</div>
        </div>
      </div>

      {/* Tabs */}
      <div className="atabs" style={{marginBottom:10}}>
        {[["pending","⏳ পেন্ডিং"],["approved","✅ Approved"],["rejected","❌ Rejected"],["all","📋 সব"]].map(([v,l])=>(
          <button key={v} className={`atab${tab===v?" on":""}`} onClick={()=>setTab(v)}>{l}
            {v==="pending"&&pendingCount>0&&<span style={{background:C.red,color:"#fff",borderRadius:"50%",fontSize:8,padding:"1px 4px",marginLeft:3}}>{pendingCount}</span>}
          </button>
        ))}
      </div>

      <div style={{fontSize:11,color:C.muted,marginBottom:8,display:"flex",justifyContent:"space-between"}}>
        <span>{loading?"⏳":`${filtered.length}টি`}</span>
        {loading&&<span>⏳</span>}
      </div>

      {/* List */}
      {loading&&!raw?[...Array(3)].map((_,i)=><div key={i} className="sk"/>):
       filtered.length===0?<div className="empty"><div className="ei">🧠</div><p>{tab==="pending"?"কোনো পেন্ডিং নেই 🎉":"কিছু নেই"}</p></div>:
       filtered.map((t,i)=>(
        <div key={t._pushKey||i} style={{
          background:C.card,border:`1px solid ${C.border}`,borderRadius:12,
          padding:12,marginBottom:8,
          borderLeft:`3px solid ${t.status==="approved"?C.green:t.status==="rejected"?C.red:C.yellow}`
        }}>
          {/* Header */}
          <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:7,flexWrap:"wrap"}}>
            <div style={{width:28,height:28,borderRadius:"50%",background:`linear-gradient(135deg,${C.accent},${C.purple})`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:700,color:"#fff",flexShrink:0}}>
              {(t.userName||"?").slice(0,1).toUpperCase()}
            </div>
            <div style={{flex:1,minWidth:0}}>
              <div style={{fontWeight:700,fontSize:12}}>{t.userName||"ব্যবহারকারী"}</div>
              <div style={{fontSize:10,color:C.muted}}>📱 {t.userId||"—"}</div>
            </div>
            <div style={{textAlign:"right"}}>
              <span style={{
                fontSize:9,fontWeight:700,padding:"2px 7px",borderRadius:6,
                background:t.status==="approved"?`${tint(C.green,"20")}`:t.status==="rejected"?`${tint(C.red,"20")}`:`${tint(C.yellow,"20")}`,
                color:t.status==="approved"?C.green:t.status==="rejected"?C.red:C.yellow,
                border:`1px solid ${t.status==="approved"?C.green:t.status==="rejected"?C.red:C.yellow}40`
              }}>
                {t.status==="approved"?"✅ Approved":t.status==="rejected"?"❌ Rejected":"⏳ Pending"}
              </span>
            </div>
          </div>

          {/* Question ID */}
          <div style={{fontSize:10,color:C.accent,marginBottom:5,fontWeight:600}}>
            ❓ প্রশ্ন ID: {t._qId||"—"}
          </div>

          {/* Technique text */}
          <div style={{
            background:C.panel,border:`1px solid ${C.border}`,borderRadius:8,
            padding:"8px 10px",fontSize:12,lineHeight:1.6,color:C.text,marginBottom:7
          }}>
            💡 {t.text||"(খালি)"}
          </div>

          <div style={{fontSize:10,color:C.muted,marginBottom:8}}>
            🕐 {tsFormat(t.timestamp)}
          </div>

          {/* Action buttons */}
          <div style={{display:"flex",gap:6}}>
            {(t.status==="pending"||!t.status)&&<>
              <button
                className="btn"
                style={{flex:2,justifyContent:"center",background:C.green,color:"#fff",fontSize:11}}
                disabled={!!busy}
                onClick={()=>updateStatus(t,"approved")}
              >
                {busy===t._pushKey?"⏳...":"✅ Approve"}
              </button>
              <button
                className="btn"
                style={{flex:2,justifyContent:"center",background:C.red,color:"#fff",fontSize:11}}
                disabled={!!busy}
                onClick={()=>updateStatus(t,"rejected")}
              >
                {busy===t._pushKey?"⏳...":"❌ Reject"}
              </button>
            </>}
            {t.status==="approved"&&(
              <button
                className="btn bg"
                style={{flex:2,justifyContent:"center",fontSize:11}}
                disabled={!!busy}
                onClick={()=>updateStatus(t,"rejected")}
              >❌ Reject করুন</button>
            )}
            {t.status==="rejected"&&(
              <button
                className="btn"
                style={{flex:2,justifyContent:"center",background:C.green,color:"#fff",fontSize:11}}
                disabled={!!busy}
                onClick={()=>updateStatus(t,"approved")}
              >✅ Re-Approve</button>
            )}
            <button
              className="btn"
              style={{flex:1,justifyContent:"center",background:tint(C.red,"22"),color:C.red,border:`1px solid ${tint(C.red,"33")}`,fontSize:11}}
              disabled={!!busy}
              onClick={()=>deleteT(t)}
            >🗑️</button>
          </div>
        </div>
       ))
      }
    </div>
  );
}

export { TechniquesPage };
