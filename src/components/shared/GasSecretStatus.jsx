/* প্রতি পেজের আগের Secret ইনপুট ঘরের বদলে এই ছোট স্ট্যাটাস দেখায় */
import React from "react";
import { C } from "../../core/config.js";
import { useSharedGasSecret, openGasSecretModal } from "../../core/gasSecret.js";

function GasSecretStatus(){
  const[secret]=useSharedGasSecret();
  const box={display:"flex",alignItems:"center",justifyContent:"space-between",gap:8,
    borderRadius:8,padding:"8px 10px",fontSize:12,fontWeight:600,cursor:"pointer"};
  return secret
    ? <div onClick={openGasSecretModal} style={{...box,background:C.panel,border:`1px solid ${C.border}`,color:C.green}}>
        <span>🔑 GAS Secret সেট আছে ✓</span>
        <span style={{color:C.accent,fontSize:11}}>বদলান</span>
      </div>
    : <div onClick={openGasSecretModal} style={{...box,background:"#f59e0b18",border:"1px solid #f59e0b55",color:"#f59e0b"}}>
        <span>⚠️ GAS Secret সেট করা নেই</span>
        <span style={{textDecoration:"underline"}}>এখানে চাপুন</span>
      </div>;
}

export { GasSecretStatus };
