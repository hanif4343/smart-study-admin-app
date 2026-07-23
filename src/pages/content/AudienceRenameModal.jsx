/* ══════════ AUDIENCE RENAME MODAL ══════════ */
import React from "react";
import { C } from "../../core/config.js";
import { useModalBack } from "../../hooks/useModalBack.js";

function AudienceRenameModal({target,newName,setNewName,onCancel,onRename,renaming}){
  useModalBack(onCancel);
  return(
    <div className="ovl">
      <div className="modal">
        <div className="mh"/>
        <div style={{fontSize:14,fontWeight:700,marginBottom:4}}>🎯 Audience Tag Rename</div>

        {/* Warning */}
        <div style={{background:`${C.yellow}12`,border:`1px solid ${C.yellow}30`,borderRadius:9,padding:"8px 11px",marginBottom:12,fontSize:11}}>
          <span style={{color:C.yellow,fontWeight:700}}>⚠️ </span>
          <span style={{color:C.muted}}>
            <b style={{color:C.text}}>{target.count}টি</b> কন্টেন্টে Firebase-এ আপডেট হবে।
            <br/>ব্যবহারকারীর <b style={{color:C.text}}>classLevel</b>-এর সাথে মিল রাখুন।
          </span>
        </div>

        {/* Old name (readonly) */}
        <div className="fld">
          <label>পুরোনো Tag</label>
          <div style={{background:C.panel,border:`1px solid ${C.border}`,borderRadius:9,padding:"9px 12px",fontSize:13,color:C.muted,fontFamily:"monospace"}}>
            {target.tag}
          </div>
        </div>

        {/* New name input */}
        <div className="fld">
          <label>নতুন Tag</label>
          <input
            className="inp"
            value={newName}
            onChange={e=>setNewName(e.target.value)}
            placeholder="যেমন: Masters 1"
            style={{fontFamily:"monospace"}}
            autoFocus
          />
          {newName&&newName!==target.tag&&(
            <div style={{fontSize:10,color:C.green,marginTop:4,fontWeight:600}}>
              ✅ "{target.tag}" → "{newName}"
            </div>
          )}
        </div>

        {/* Hint */}
        <div style={{background:`${C.accent}10`,border:`1px solid ${C.accent}25`,borderRadius:8,padding:"7px 10px",marginBottom:12,fontSize:10,color:C.muted}}>
          💡 <b style={{color:C.text}}>classLevel মানগুলো:</b> Masters 1, Masters 2, Honours 1, Honours 2, Honours 3, Honours 4, Class 12, Job
        </div>

        <div style={{display:"flex",gap:7}}>
          <button className="btn bg" style={{flex:1,justifyContent:"center"}} onClick={onCancel} disabled={renaming}>বাতিল</button>
          <button className="btn bp" style={{flex:2,justifyContent:"center"}} onClick={onRename} disabled={renaming||!newName.trim()||newName.trim()===target.tag}>
            {renaming?"⏳ আপডেট হচ্ছে...":"✅ Rename করুন"}
          </button>
        </div>
      </div>
    </div>
  );
}

export { AudienceRenameModal };
