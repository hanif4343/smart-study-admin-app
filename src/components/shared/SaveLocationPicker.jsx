/* ── UI: Save Location ── শুধু Google Sheet (NO-FIREBASE POLICY: Quiz/QBank/Study/
   Typing সব Firebase-এ যায় না, শুধু শিট। GAS Secret এখন কেন্দ্রীয় 🔑 বক্স থেকে আসে) ── */
import React from "react";
import { C } from "../../core/config.js";
import { GasSecretStatus } from "./GasSecretStatus.jsx";

// gasSecret / onGasSecretChange / compact prop আগের কলারদের জন্য রাখা হয়েছে, কিন্তু এখন ব্যবহার হয় না
function SaveLocationPicker({value,onChange}){
  return(
    <div style={{background:C.panel,border:`1px solid ${C.border}`,borderRadius:10,padding:12,marginBottom:10}}>
      <div style={{fontSize:11,textTransform:"uppercase",letterSpacing:.6,color:C.muted,fontWeight:700,marginBottom:8}}>📍 Save Location</div>
      <div style={{display:"flex",gap:8,marginBottom:8}}>
        <div style={{flex:1,textAlign:"center",padding:"8px 0",borderRadius:6,background:C.green,color:"#04180a",fontWeight:600}}>📊 Google Sheet</div>
      </div>
      <GasSecretStatus/>
    </div>
  );
}

export { SaveLocationPicker };
