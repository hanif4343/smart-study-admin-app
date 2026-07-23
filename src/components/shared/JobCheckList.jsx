/* ══════════ JOB CHECKLIST (checkbox filter list, GH job launcher cluster) ══════════ */
import React from "react";
import { C } from "../../core/config.js";
import { JOB_NONE_TAG } from "../../core/ghConfig.js";

function JobCheckList({options,selected,onToggle,emptyText}){
  return(
    <div style={{background:C.panel,border:`1px solid ${C.border}`,borderRadius:9,maxHeight:180,overflowY:"auto",padding:4}}>
      {!options.length && <div style={{padding:"12px 8px",fontSize:12,color:C.muted,textAlign:"center",lineHeight:1.5}}>{emptyText}</div>}
      {options.map(o=>(
        <label key={o.value} style={{display:"flex",alignItems:"center",gap:9,padding:"9px 8px",borderRadius:6,fontSize:13,cursor:"pointer"}}>
          <input type="checkbox" checked={selected.includes(o.value)} onChange={()=>onToggle(o.value)} style={{accentColor:C.accent,width:16,height:16,flexShrink:0}}/>
          <span style={{fontStyle:o.value===JOB_NONE_TAG?"italic":"normal",color:o.value===JOB_NONE_TAG?C.muted:C.text}}>{o.label}</span>
          <span style={{marginLeft:"auto",fontSize:10,color:C.muted,background:"#ffffff0a",padding:"2px 7px",borderRadius:20,flexShrink:0}}>{o.count}</span>
        </label>
      ))}
    </div>
  );
}

export { JobCheckList };
