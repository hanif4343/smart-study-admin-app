/* ══════════ RENAME MODAL ══════════ */
import React from "react";
import { C, tint } from "../../core/config.js";
import { useModalBack } from "../../hooks/useModalBack.js";

function RenameModal({type,target,newName,setNewName,onCancel,onRename,renaming}){
  useModalBack(onCancel);
  return(
    <div className="ovl">
      <div className="modal">
        <div className="mh"/>
        <div style={{fontSize:13,fontWeight:700,marginBottom:4}}>✏️ Rename {type}</div>
        <div style={{background:`${tint(C.green,"12")}`,border:`1px solid ${tint(C.green,"30")}`,borderRadius:9,padding:"8px 11px",marginBottom:12,fontSize:11}}>
          <span style={{color:C.green,fontWeight:700}}>✅ </span>
          <span style={{color:C.muted}}>শুধু <b style={{color:C.text}}>১টা</b> রেফারেন্স-এন্ট্রি বদলাবে — এটা ব্যবহার করা <b style={{color:C.text}}>{target.count}টি</b> প্রশ্নের কোনো রো টাচ হবে না, নাম অটোমেটিক আপডেট দেখাবে।</span>
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
