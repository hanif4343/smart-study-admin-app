/* ══════════ GAS SECRET — একটাই কেন্দ্রীয় জায়গা ══════════
   Secret শুধু 🔑 (হেডার) থেকে বসানো হয়। বাকি সব পেজ এখান থেকে পায়,
   আর বদলালে সাথে সাথে সব পেজে আপডেট হয়ে যায়। */
import React from "react";
import { loadSharedGasSecret, saveSharedGasSecret } from "./utils.js";

const EVT_CHANGED = "ss-gas-secret-changed";
const EVT_OPEN = "ss-open-gas-secret";

function setGlobalGasSecret(v){
  const val = String(v || "").trim();
  // পুরনো fallback key মুছে দিই, যাতে কেন্দ্রীয় মানটাই সবসময় জেতে (মুছলেও কাজ করে)
  try{ localStorage.removeItem("qbank_conv_gas_secret_v1"); }catch{}
  saveSharedGasSecret(val);
  window.dispatchEvent(new Event(EVT_CHANGED));
}

function openGasSecretModal(){ window.dispatchEvent(new Event(EVT_OPEN)); }

/* useState-এর মতোই: const[gasSecret,setGasSecret]=useSharedGasSecret(); */
function useSharedGasSecret(){
  const[v,setV]=React.useState(()=>loadSharedGasSecret());
  React.useEffect(()=>{
    const h=()=>setV(loadSharedGasSecret());
    window.addEventListener(EVT_CHANGED,h);
    return()=>window.removeEventListener(EVT_CHANGED,h);
  },[]);
  return[v,setGlobalGasSecret];
}

export { setGlobalGasSecret, openGasSecretModal, useSharedGasSecret, EVT_OPEN };
