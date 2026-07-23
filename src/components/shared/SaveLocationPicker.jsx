/* ── UI: Save Location টগল (Google Sheet | Firebase) — সব সেভ-ফিচারে reuse হয় ── */
import React, { useState } from "react";
import { C } from "../../core/config.js";

function SaveLocationPicker({value,onChange,gasSecret,onGasSecretChange,compact=false}){
  // compact=true হলে GAS Secret Key ডিফল্টে লুকানো থাকে (QBank→Quiz-এর মতো জায়গায়, যেখানে
  // Save Location কার্ডটা বারবার চোখে পড়ে) — বাকি ট্যাবগুলোতে (compact না দেওয়া) আগের মতোই
  // সবসময় দেখা যাবে, কোনো আচরণ বদলায়নি।
  const[showKey,setShowKey]=useState(!compact);
  return(
    <div style={{background:C.panel,border:`1px solid ${C.border}`,borderRadius:10,padding:12,marginBottom:10}}>
      <div style={{fontSize:11,textTransform:"uppercase",letterSpacing:.6,color:C.muted,fontWeight:700,marginBottom:8}}>💾 Save Location</div>
      <div style={{display:"flex",gap:8,marginBottom:value==="sheet"?8:0}}>
        <button type="button" className="btn" style={{flex:1,justifyContent:"center",background:value==="sheet"?C.green:"transparent",color:value==="sheet"?"#04180a":C.text,border:`1px solid ${C.border}`}} onClick={()=>onChange("sheet")}>📄 Google Sheet</button>
        <button type="button" className="btn" style={{flex:1,justifyContent:"center",background:value==="firebase"?C.accent:"transparent",color:value==="firebase"?"#fff":C.text,border:`1px solid ${C.border}`}} onClick={()=>onChange("firebase")}>🔥 Firebase</button>
      </div>
      {value==="sheet" && (
        showKey ? (
          <div className="fld" style={{marginBottom:0}}>
            <label style={{display:"flex",justifyContent:"space-between"}}>
              <span>GAS Secret Key</span>
              {compact && <span onClick={()=>setShowKey(false)} style={{color:C.accent,cursor:"pointer",fontWeight:600}}>লুকাও</span>}
            </label>
            <input className="inp" type="password" placeholder="Script Properties-এর SECRET_KEY" value={gasSecret} onChange={e=>onGasSecretChange(e.target.value)}/>
          </div>
        ) : (
          <div style={{fontSize:11,color:C.accent,cursor:"pointer",fontWeight:600}} onClick={()=>setShowKey(true)}>🔑 GAS Secret Key পরিবর্তন করো</div>
        )
      )}
    </div>
  );
}

export { SaveLocationPicker };
