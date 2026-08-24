/* ══════════ CHANGE PASSWORD MODAL ══════════ */
import React, { useState } from "react";
import { C, tint } from "../core/config.js";
import { fbPatch, fbSet } from "../core/firebase.js";
import { fcmNotifyPhone } from "../core/fcm.js";
import { phoneKey, nowTs } from "../core/utils.js";
import { useModalBack } from "../hooks/useModalBack.js";

function ChangePasswordModal({user,onClose,push}){
  useModalBack(onClose);
  const nm=user.Name||user.name||"ইউজার";
  const ph=(user.Phone||user.phone||"").replace(/^'+/,"");
  const phK=phoneKey(ph);

  const[newPass,setNewPass]=useState("");
  const[confirmPass,setConfirmPass]=useState("");
  const[showNew,setShowNew]=useState(false);
  const[showConfirm,setShowConfirm]=useState(false);
  const[saving,setSaving]=useState(false);

  const save=async()=>{
    if(!newPass.trim()){push("error","পাসওয়ার্ড দিন","");return;}
    if(newPass.length<6){push("error","পাসওয়ার্ড কমপক্ষে ৬ অক্ষর","");return;}
    if(newPass!==confirmPass){push("error","পাসওয়ার্ড মিলছে না","আবার চেষ্টা করুন");return;}
    setSaving(true);
    try{
      // 1. Firebase এ password update
      await fbPatch(`Users/${phK}`,{Password:newPass});

      // 2. Firebase notification + FCM direct
      const notifTitle="🔐 পাসওয়ার্ড পরিবর্তন";
      const notifBody=`আপনার অ্যাকাউন্টের পাসওয়ার্ড অ্যাডমিন কর্তৃক পরিবর্তন করা হয়েছে। নতুন পাসওয়ার্ড দিয়ে লগইন করুন।`;
      await fbSet(`Notifications/${phK}/notif_${Date.now()}`,{type:"security",title:notifTitle,body:notifBody,time:nowTs(),read:false});
      const fcmOkPw = await fcmNotifyPhone(ph, notifTitle, notifBody, {type:"security"});

      push("success","✅ পাসওয়ার্ড পরিবর্তন হয়েছে!",`${nm}-কে নোটিফিকেশন ${fcmOkPw?"📲 FCM ✓":"📲 FCM ✗"}`);
      onClose();
    }catch(e){push("error","ব্যর্থ হয়েছে",e.message||String(e));}
    setSaving(false);
  };

  const I={background:C.panel,border:`1px solid ${C.border}`,borderRadius:8,padding:"8px 10px",color:C.text,fontSize:13,flex:1,minWidth:0};
  const F={display:"flex",flexDirection:"column",gap:3,marginBottom:12};
  const L={fontSize:11,color:C.muted,fontWeight:600,marginBottom:3};

  return(
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.75)",zIndex:950,display:"flex",flexDirection:"column",justifyContent:"flex-end"}}>
      <div style={{background:C.card,borderRadius:"16px 16px 0 0",padding:"16px 14px 34px"}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:6}}>
          <div style={{fontWeight:700,fontSize:15}}>🔐 পাসওয়ার্ড পরিবর্তন</div>
          <button onClick={onClose} style={{background:"none",border:"none",color:C.muted,fontSize:20,cursor:"pointer"}}>✕</button>
        </div>
        <div style={{fontSize:12,color:C.muted,marginBottom:14}}>👤 {nm} · 📱 {ph}</div>

        <div style={F}>
          <label style={L}>🔑 নতুন পাসওয়ার্ড</label>
          <div style={{display:"flex",gap:6,alignItems:"center"}}>
            <input style={I} type={showNew?"text":"password"} value={newPass} onChange={e=>setNewPass(e.target.value)} placeholder="কমপক্ষে ৬ অক্ষর"/>
            <button onClick={()=>setShowNew(v=>!v)} style={{background:"none",border:"none",color:C.muted,fontSize:18,cursor:"pointer",padding:"0 4px"}}>{showNew?"🙈":"👁"}</button>
          </div>
        </div>

        <div style={F}>
          <label style={L}>🔑 পাসওয়ার্ড নিশ্চিত করুন</label>
          <div style={{display:"flex",gap:6,alignItems:"center"}}>
            <input style={I} type={showConfirm?"text":"password"} value={confirmPass} onChange={e=>setConfirmPass(e.target.value)} placeholder="আবার লিখুন"/>
            <button onClick={()=>setShowConfirm(v=>!v)} style={{background:"none",border:"none",color:C.muted,fontSize:18,cursor:"pointer",padding:"0 4px"}}>{showConfirm?"🙈":"👁"}</button>
          </div>
          {confirmPass&&newPass!==confirmPass&&<div style={{fontSize:11,color:C.red,marginTop:3}}>⚠️ পাসওয়ার্ড মিলছে না</div>}
          {confirmPass&&newPass===confirmPass&&newPass.length>=6&&<div style={{fontSize:11,color:C.green,marginTop:3}}>✅ মিলেছে</div>}
        </div>

        <div style={{background:tint(C.accent,"11"),border:`1px solid ${tint(C.accent,"33")}`,borderRadius:8,padding:"8px 10px",marginBottom:14,fontSize:11,color:C.muted}}>
          📲 পাসওয়ার্ড পরিবর্তনের পর ইউজার <b style={{color:C.text}}>স্বয়ংক্রিয়ভাবে নোটিফিকেশন</b> পাবেন।
        </div>

        <div style={{display:"flex",gap:8}}>
          <button className="btn" style={{flex:1,justifyContent:"center",background:C.border,color:C.muted,padding:"10px 0",borderRadius:9,fontWeight:600}} onClick={onClose}>বাতিল</button>
          <button className="btn bg" style={{flex:2,justifyContent:"center",padding:"10px 0",borderRadius:9,fontWeight:700,fontSize:14,background:saving?"#444":undefined}} disabled={saving||newPass!==confirmPass||newPass.length<6} onClick={save}>
            {saving?"⏳ পরিবর্তন হচ্ছে...":"🔐 পাসওয়ার্ড সেট করুন"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ══════════ USER EDIT MODAL ══════════ */

export { ChangePasswordModal };
