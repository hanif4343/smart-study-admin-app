/* ══════════ NOTIFY MODAL ══════════ */
import React, { useState } from "react";
import { C } from "../core/config.js";
import { fbSet } from "../core/firebase.js";
import { fcmNotifyPhone } from "../core/fcm.js";
import { phoneKey, nowTs } from "../core/utils.js";
import { useModalBack } from "../hooks/useModalBack.js";

function NotifyModal({user,onClose,push,inline}){
  useModalBack(inline?()=>{}:onClose);
  const[title,setTitle]=useState("");
  const[body,setBody]=useState("");
  const[sending,setSending]=useState(false);
  const nm=user.Name||user.name||"স্টুডেন্ট";

  const send=async()=>{
    if(!title||!body)return;
    setSending(true);
    try{
      const phone=(user.Phone||user.phone||"").toString();
      const phK=phoneKey(phone);
      await fbSet(`Notifications/${phK}/notif_${Date.now()}`,{type:"personal",title,body,time:nowTs(),read:false});
      // FCM direct — instant
      const fcmOk = await fcmNotifyPhone(phone, title, body, {type:"personal"});
      push("success","✅ পাঠানো হয়েছে",(fcmOk?"📲 FCM ✓ ":"📲 FCM ✗ ")+nm);
      if(!inline)onClose();
    }catch(e){push("error","ব্যর্থ",String(e?.message||e||""));}
    setSending(false);
  };

  if(inline)return(
    <div className="card">
      <div className="ct">📣 ব্যক্তিগত নোটিফিকেশন</div>
      <div className="fld"><label>শিরোনাম</label><input className="inp" placeholder="Title..." value={title} onChange={e=>setTitle(e.target.value)}/></div>
      <div className="fld"><label>বার্তা</label><textarea className="ta" placeholder="Message..." value={body} onChange={e=>setBody(e.target.value)}/></div>
      <button className="btn bp bb" onClick={send} disabled={sending}>{sending?"⏳":"📨 পাঠান"}</button>
    </div>
  );
  return(
    <div className="ovl">
      <div className="modal">
        <div className="mh"/>
        <div className="mt">📣 {nm}</div>
        <div style={{fontSize:11,color:C.muted,marginBottom:11}}>📱 {user.Phone||user.phone}</div>
        <div className="fld"><label>শিরোনাম</label><input className="inp" placeholder="Title..." value={title} onChange={e=>setTitle(e.target.value)}/></div>
        <div className="fld"><label>বার্তা</label><textarea className="ta" placeholder="Message..." value={body} onChange={e=>setBody(e.target.value)}/></div>
        <div style={{display:"flex",gap:7}}>
          <button className="btn bg" style={{flex:1,justifyContent:"center"}} onClick={onClose}>বাতিল</button>
          <button className="btn bp" style={{flex:1,justifyContent:"center"}} onClick={send} disabled={sending}>{sending?"⏳":"📨 পাঠান"}</button>
        </div>
      </div>
    </div>
  );
}

/* ══════════ ROOT APP ══════════ */


export { NotifyModal };
