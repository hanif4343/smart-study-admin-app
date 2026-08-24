/* ══════════ SIGNUPS ══════════ */
import React, { useState, useMemo } from "react";
import { C, tint } from "../core/config.js";
import { useFB, invalidate } from "../core/dataCache.js";
import { fbPatch, fbSet, fbDelete } from "../core/firebase.js";
import { toArr, phoneKey, nowTs, initials, timeAgo } from "../core/utils.js";
import { DeleteWarningModal } from "../components/shared/DeleteWarningModal.jsx";

function SignupsPage({push,tick}){
  const{data:usersRaw,loading}=useFB("Users",tick);
  const[activating,setActivating]=useState(null);
  const[done,setDone]=useState(new Set());
  const[rejectTarget,setRejectTarget]=useState(null); // user object pending reject confirm
  const[rejecting,setRejecting]=useState(false);

  const rows=useMemo(()=>toArr(usersRaw).filter(u=>{
    const st=(u.Status||u.status||"").toLowerCase();
    const id=u._fbKey||(u.Phone||u.phone||"");
    return(st==="inactive"||st===""||st==="pending")&&!done.has(id);
  }),[usersRaw,done]);

  const activate=async u=>{
    const phone=u.Phone||u.phone||"";
    const fkey=u._fbKey||phoneKey(phone);
    setActivating(fkey);
    try{
      await fbPatch(`Users/${fkey}`,{Status:"Active"});
      await fbSet(`Notifications/${fkey}/welcome_${Date.now()}`,{type:"welcome",title:"🎉 অ্যাকাউন্ট অ্যাক্টিভ!",body:"Smart Study-তে স্বাগতম!",time:nowTs(),read:false});
            push("success","✅ অ্যাক্টিভ!",u.Name||u.name||phone);
      setDone(p=>new Set([...p,fkey]));
      invalidate("Users");
    }catch(e){push("error","ব্যর্থ",e.message);}
    setActivating(null);
  };

  const confirmReject=async()=>{
    if(!rejectTarget)return;
    const u=rejectTarget;
    const phone=u.Phone||u.phone||"";
    const fkey=u._fbKey||phoneKey(phone);
    setRejecting(true);
    try{
      await fbDelete(`Users/${fkey}`); // permanently remove — শুধু inactive না, পুরোপুরি delete
      push("success","🗑️ রিজেক্ট হয়েছে",(u.Name||u.name||phone)+" সম্পূর্ণ ডিলিট হয়েছে");
      setDone(p=>new Set([...p,fkey]));
      invalidate("Users");
      setRejectTarget(null);
    }catch(e){push("error","ব্যর্থ",e.message);}
    setRejecting(false);
  };

  return(
    <div className="page">
      <div style={{background:"#ef444412",border:"1px solid #ef444430",borderRadius:10,padding:"8px 12px",fontSize:12,color:C.red,fontWeight:600,marginBottom:11,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
        <span>🔔 {rows.length}টি পেন্ডিং</span>
        {loading&&<span style={{fontSize:10,color:C.muted}}>⏳</span>}
      </div>
      {loading&&!usersRaw?[...Array(3)].map((_,i)=><div key={i} className="sk"/>):
       rows.length===0?<div className="empty"><div className="ei">🎉</div><p>সব অ্যাক্টিভ!</p></div>:
       rows.map((u,i)=>{
        const nm=u.Name||u.name||"অজানা",ph=u.Phone||u.phone||"—";
        const fkey=u._fbKey||phoneKey(ph);
        return(
          <div key={i} className="card" style={{padding:12}}>
            <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:10}}>
              <div className="av">{initials(nm)}</div>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontWeight:700,fontSize:13}}>{nm}</div>
                <div style={{fontSize:11,color:C.muted}}>📱 {ph}</div>
                {(u.Email||u.email)&&<div style={{fontSize:11,color:C.muted}}>✉️ {u.Email||u.email}</div>}
                <div style={{fontSize:10,color:C.muted}}>🕐 {timeAgo(u.Timestamp||u.createdAt)}</div>
              </div>
              <span className="pill pp">⏳ পেন্ডিং</span>
            </div>
            <div style={{display:"flex",gap:8}}>
              <button className="btn bs bb" style={{flex:2,justifyContent:"center"}} disabled={!!activating||rejecting} onClick={()=>activate(u)}>
                {activating===fkey?"⏳ হচ্ছে...":"✅ অ্যাক্টিভ করুন"}
              </button>
              <button className="btn bg" style={{flex:1,justifyContent:"center",color:C.red,borderColor:`${tint(C.red,"40")}`}} disabled={!!activating||rejecting} onClick={()=>setRejectTarget(u)}>
                ❌ রিজেক্ট
              </button>
            </div>
          </div>
        );
       })
      }
      {rejectTarget&&(
        <DeleteWarningModal
          title="সাইনআপ রিজেক্ট করবেন?"
          description={`"${rejectTarget.Name||rejectTarget.name||rejectTarget.Phone||rejectTarget.phone||"এই ইউজার"}" কে রিজেক্ট করলে ইউজারটি Firebase থেকে সম্পূর্ণভাবে ডিলিট হয়ে যাবে — শুধু ইনঅ্যাক্টিভ হবে না।`}
          onConfirm={confirmReject}
          onCancel={()=>!rejecting&&setRejectTarget(null)}
          loading={rejecting}
        />
      )}
    </div>
  );
}

export { SignupsPage };
