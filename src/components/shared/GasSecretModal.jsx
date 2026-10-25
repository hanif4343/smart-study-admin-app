/* 🔑 GAS Secret Key — একটাই জায়গা, সব পেজ এখান থেকে পায় */
import React, { useState } from "react";
import { C } from "../../core/config.js";
import { useModalBack } from "../../hooks/useModalBack.js";
import { useSharedGasSecret } from "../../core/gasSecret.js";
import { fetchReferenceDataVerbose } from "../../core/sheetSave.js";

function GasSecretModal({onClose,push}){
  useModalBack(onClose);
  const[saved,setSaved]=useSharedGasSecret();
  const[val,setVal]=useState(saved||"");
  const[show,setShow]=useState(false);
  const[testing,setTesting]=useState(false);

  const save=()=>{
    const v=val.trim();
    if(!v){ push?.("warn","Secret ফাঁকা","আগে Secret Key লিখুন"); return; }
    setSaved(v);
    push?.("success","✅ GAS Secret সেভ হয়েছে","সব পেজে এটাই ব্যবহার হবে");
    onClose();
  };
  const clear=()=>{
    setSaved("");setVal("");
    push?.("warn","GAS Secret মুছে ফেলা হয়েছে","");
  };
  const test=async()=>{
    const v=val.trim();
    if(!v){ push?.("warn","Secret ফাঁকা","আগে Secret Key লিখুন"); return; }
    setTesting(true);
    try{
      const r=await fetchReferenceDataVerbose({gasSecret:v});
      if(r&&r.ok) push?.("success","✅ Secret ঠিক আছে","GAS থেকে ডেটা এসেছে");
      else push?.("error","❌ Secret কাজ করছে না",(r&&r.error)||"GAS সাড়া দেয়নি");
    }catch(e){ push?.("error","❌ টেস্ট ব্যর্থ",e.message||String(e)); }
    setTesting(false);
  };

  const I={background:C.panel,border:`1px solid ${C.border}`,borderRadius:8,padding:"10px 12px",color:C.text,fontSize:13,flex:1,minWidth:0};
  const B={border:"none",borderRadius:9,padding:"11px",fontSize:13,fontWeight:700,cursor:"pointer"};

  return(
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.75)",zIndex:950,display:"flex",flexDirection:"column",justifyContent:"flex-end"}}
         onClick={e=>{ if(e.target===e.currentTarget) onClose(); }}>
      <div style={{background:C.card,borderRadius:"16px 16px 0 0",padding:"16px 14px 34px"}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:4}}>
          <div style={{fontWeight:700,fontSize:15}}>🔑 GAS Secret Key</div>
          <button onClick={onClose} style={{background:"none",border:"none",color:C.muted,fontSize:20,cursor:"pointer"}}>✕</button>
        </div>
        <div style={{fontSize:11,color:C.muted,marginBottom:12,lineHeight:1.5}}>
          একবার এখানে বসালেই হবে — অ্যাপের সব পেজ (Uploader, Content Manager, Topic, Report ইত্যাদি) এটাই ব্যবহার করবে।
          Apps Script-এর Script Properties-এর <b>SECRET_KEY</b> এখানে দিন।
        </div>
        <div style={{display:"flex",gap:8,marginBottom:12}}>
          <input style={I} type={show?"text":"password"} placeholder="SECRET_KEY" value={val}
                 onChange={e=>setVal(e.target.value)} onKeyDown={e=>e.key==="Enter"&&save()}
                 autoComplete="off" autoCapitalize="off" autoCorrect="off" spellCheck={false}/>
          <button onClick={()=>setShow(s=>!s)} style={{...B,background:C.panel,color:C.text,border:`1px solid ${C.border}`,padding:"0 12px"}}>{show?"🙈":"👁"}</button>
        </div>
        <div style={{display:"flex",gap:8}}>
          <button onClick={save} style={{...B,flex:2,background:C.accent,color:"#fff"}}>💾 সেভ করুন</button>
          <button onClick={test} disabled={testing} style={{...B,flex:1,background:C.panel,color:C.text,border:`1px solid ${C.border}`,opacity:testing?0.6:1}}>{testing?"⏳":"🧪 টেস্ট"}</button>
        </div>
        {saved&&<div style={{textAlign:"center",marginTop:12}}>
          <span onClick={clear} style={{color:C.red,fontSize:12,fontWeight:600,cursor:"pointer",textDecoration:"underline"}}>সেভ করা Secret মুছুন</span>
        </div>}
      </div>
    </div>
  );
}

export { GasSecretModal };
