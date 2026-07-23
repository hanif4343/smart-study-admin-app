/* ══════════ MODAL BACK HANDLER ══════════ */
// যেকোনো modal এ এটা call করলে Android back button এ modal বন্ধ হবে
import { useEffect } from "react";

function useModalBack(onClose){
  useEffect(()=>{
    window.dispatchEvent(new Event("modal-open"));
    const handler=()=>onClose();
    window.addEventListener("back-press",handler);
    return()=>{
      window.dispatchEvent(new Event("modal-close"));
      window.removeEventListener("back-press",handler);
    };
  },[]);// eslint-disable-line
}

export { useModalBack };
