/* ══════════ TOAST ══════════ */
import { useState, useCallback } from "react";

let _tid=0;
function useToasts(){
  const[t,set]=useState([]);
  const push=useCallback((type,title,msg="")=>{
    const id=++_tid;
    set(p=>[...p.slice(-4),{id,type,title,msg}]);
    setTimeout(()=>set(p=>p.filter(x=>x.id!==id)),4000);
  },[]);
  return[t,push];
}

export { useToasts };
