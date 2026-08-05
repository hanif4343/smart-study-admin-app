/* ── UI: Save Location — এখন শুধু Google Sheet (NO-FIREBASE POLICY: Quiz/QBank/Study/
   Typing আর Firebase-এ যায় না, তাই টগলের দরকার নেই, শুধু GAS Secret Key ইনপুট দরকার) ── */
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
      <div style={{display:"flex",gap:8,marginBottom:8}}>
        <div style={{flex:1,textAlign:"center",padding:"8px 0",borderRadius:6,background:C.green,color:"#04180a",fontWeight:600}}>📄 Google Sheet</div>
      </div>
      {
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
      }
    </div>
  );
}

export { SaveLocationPicker };
