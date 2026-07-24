/* ══════════ RENAME MODAL ══════════ */
import React from "react";
import { C } from "../../core/config.js";
import { useModalBack } from "../../hooks/useModalBack.js";

function RenameModal({type,target,newName,setNewName,onCancel,onRename,renaming,source}){
  useModalBack(onCancel);
  const scopeMsg=source==="sheet"
    ? "Google Sheet-এ আপডেট হবে, আর Firebase mirror-ও নিজে থেকে sync হয়ে যাবে।"
    : "Firebase-এ আপডেট হবে।";
  return(
    <div className="ovl">
      <div className="modal">
        <div className="mh"/>
        <div style={{fontSize:13,fontWeight:700,marginBottom:4}}>✏️ Rename {type}</div>
        <div style={{background:`${C.yellow}12`,border:`1px solid ${C.yellow}30`,borderRadius:9,padding:"8px 11px",marginBottom:12,fontSize:11}}>
          <span style={{color:C.yellow,fontWeight:700}}>⚠️ </span>
          <span style={{color:C.muted}}><b style={{color:C.text}}>{target.count}টি</b> প্রশ্নে {scopeMsg}</span>
        </div>
        <div className="fld"><label>পুরোনো নাম</label><div style={{background:C.panel,border:`1px solid ${C.border}`,borderRadius:9,padding:"9px 12px",fontSize:13,color:C.muted}}>{target.name}</div></div>
        <div className="fld"><label>নতুন নাম</label><input className="inp" value={newName} onChange={e=>setNewName(e.target.value)}/></div>
        <div style={{display:"flex",gap:7}}>
          <button className="btn bg" style={{flex:1,justifyContent:"center"}} onClick={onCancel} disabled={renaming}>বাতিল</button>
          <button className="btn bp" style={{flex:2,justifyContent:"center"}} onClick={onRename} disabled={renaming}>{renaming?"⏳ আপডেট হচ্ছে...":"✅ Rename"}</button>
        </div>
      </div>
    </div>
  );
}


export { RenameModal };
