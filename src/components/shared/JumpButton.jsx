/* ── স্ক্রল জাম্প বাটন — স্ক্রিনের নিচে ফিক্সড, স্ক্রল পজিশন অনুযায়ী ↑/↓ বদলায় ── */
import React, { useState, useEffect } from "react";
import { C } from "../../core/config.js";

function JumpButton(){
  const[dir,setDir]=useState("down");
  useEffect(()=>{
    const onScroll=()=>{
      const doc=document.documentElement;
      const atBottom = window.innerHeight + window.scrollY >= doc.scrollHeight - 24;
      setDir(atBottom ? "up" : "down");
    };
    onScroll();
    window.addEventListener("scroll",onScroll,{passive:true});
    window.addEventListener("resize",onScroll);
    return()=>{ window.removeEventListener("scroll",onScroll); window.removeEventListener("resize",onScroll); };
  },[]);
  const jump=()=>{
    if(dir==="up") window.scrollTo({top:0,behavior:"smooth"});
    else window.scrollTo({top:document.documentElement.scrollHeight,behavior:"smooth"});
  };
  return(
    <button onClick={jump} aria-label={dir==="up"?"একদম উপরে যাও":"একদম নিচে যাও"}
      style={{
        position:"fixed", bottom:"calc(72px + env(safe-area-inset-bottom,0px))",
        left:"50%", transform:"translateX(-50%)",
        width:42, height:42, borderRadius:"50%",
        background:C.accent, color:"#fff", border:"none",
        fontSize:18, fontWeight:700, display:"flex", alignItems:"center", justifyContent:"center",
        boxShadow:"0 6px 18px #00000070", zIndex:120, cursor:"pointer",
      }}>
      {dir==="up"?"↑":"↓"}
    </button>
  );
}

export { JumpButton };
