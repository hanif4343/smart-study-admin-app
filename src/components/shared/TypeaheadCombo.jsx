/* ══════════ TYPEAHEAD COMBO ══════════
   ড্রপডাউন সিলেক্ট-বক্সের বদলে টাইপ-করা ইনপুট — হাজার হাজার প্রতিষ্ঠান/পদ
   আগে থেকে লিস্টে বসিয়ে রাখা অসম্ভব, তাই:
     • টাইপ করলে বিদ্যমান অপশনগুলোর মধ্যে মিল খুঁজে সাজেশন-লিস্ট দেখায়
     • লিস্ট থেকে একটা বেছে নিলে সেই বিদ্যমান id-ই ব্যবহার হয় (ডুপ্লিকেট হয় না)
     • হুবহু মিল না থাকলে (case/space-insensitive) সেটাকে "নতুন" হিসেবে ধরা হয় —
       parent কম্পোনেন্ট সাবমিটের সময় নতুন রেফারেন্স-এন্ট্রি বানিয়ে নেবে
   এই কম্পোনেন্ট নিজে কোনো API কল করে না — শুধু id/name resolve করে parent-কে
   জানায় (onChange({id,name})), id ফাঁকা মানে "নতুন" (parent create করবে)। ── */
import React, { useState, useRef, useEffect, useMemo } from "react";
import { C } from "../../core/config.js";

const norm=s=>String(s||"").trim().toLowerCase().replace(/\s+/g," ");

function TypeaheadCombo({options,value,onChange,placeholder,newLabel,emptyLabel}){
  // options: [{id,name}]   value: {id,name}
  const[text,setText]=useState(value?.name||"");
  const[open,setOpen]=useState(false);
  const boxRef=useRef(null);

  // বাইরে থেকে value বদলালে (যেমন রিসেট) টেক্সট সিঙ্ক করো
  useEffect(()=>{ setText(value?.name||""); },[value?.id,value?.name]);

  const matches=useMemo(()=>{
    const q=norm(text);
    if(!q) return options.slice(0,30);
    return options.filter(o=>norm(o.name).includes(q)).slice(0,30);
  },[options,text]);

  const exact=useMemo(()=>{
    const q=norm(text);
    if(!q) return null;
    return options.find(o=>norm(o.name)===q)||null;
  },[options,text]);

  // বাইরে ক্লিক করলে লিস্ট বন্ধ
  useEffect(()=>{
    if(!open) return;
    const h=e=>{ if(boxRef.current && !boxRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown",h);
    return()=>document.removeEventListener("mousedown",h);
  },[open]);

  const handleTextChange=v=>{
    setText(v);
    setOpen(true);
    const q=norm(v);
    const hit=q?options.find(o=>norm(o.name)===q):null;
    onChange({id:hit?hit.id:"",name:v});
  };

  const pick=o=>{
    setText(o.name);
    setOpen(false);
    onChange({id:o.id,name:o.name});
  };

  const trimmed=text.trim();
  const showNewHint = trimmed && !exact;

  return(
    <div ref={boxRef} style={{position:"relative"}}>
      <input
        className="inp"
        placeholder={placeholder}
        value={text}
        onChange={e=>handleTextChange(e.target.value)}
        onFocus={()=>setOpen(true)}
        autoComplete="off"
      />
      {open && matches.length>0 && (
        <div style={{
          position:"absolute",left:0,right:0,top:"calc(100% + 4px)",zIndex:20,
          background:C.panel,border:`1px solid ${C.border}`,borderRadius:9,
          maxHeight:180,overflowY:"auto",boxShadow:"0 8px 20px rgba(0,0,0,.35)"
        }}>
          {matches.map(o=>(
            <div key={o.id}
              onMouseDown={e=>e.preventDefault()}
              onClick={()=>pick(o)}
              style={{padding:"8px 12px",fontSize:12,cursor:"pointer",borderBottom:`1px solid ${C.border}30`,color:C.text}}
            >
              {o.name}
            </div>
          ))}
        </div>
      )}
      {open && matches.length===0 && trimmed && (
        <div style={{
          position:"absolute",left:0,right:0,top:"calc(100% + 4px)",zIndex:20,
          background:C.panel,border:`1px solid ${C.border}`,borderRadius:9,
          padding:"8px 12px",fontSize:11,color:C.muted
        }}>
          {emptyLabel||"কোনো মিল পাওয়া যায়নি"}
        </div>
      )}
      {showNewHint && (
        <div style={{fontSize:10,color:C.warning,marginTop:4}}>
          {newLabel||`🆕 "${trimmed}" নতুন হিসেবে যোগ হবে`}
        </div>
      )}
    </div>
  );
}

export { TypeaheadCombo };
