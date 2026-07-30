/* ══════════ CONTENT MANAGER (shell) ══════════ */
import React, { useState, useCallback } from "react";
import { C } from "../core/config.js";
import { BrowseTab } from "./content/BrowseTab.jsx";
import { RenameTab } from "./content/RenameTab.jsx";
import { AudienceTagRenameTab } from "./content/AudienceTagRenameTab.jsx";
import { ReferenceManagerTab } from "./content/ReferenceManagerTab.jsx";
import { ExamAppearancesTab } from "./content/ExamAppearancesTab.jsx";
import { BulkQTypeTab } from "./BulkQTypeTab.jsx";
import { ModelTestTab } from "./content/ModelTestTab.jsx";
import { DeleteTab } from "./content/DeleteTab.jsx";

function ContentManagerPage({push,tick,pushLayer}){
  const[tab,setTab]=useState("browse");

  const goTab=useCallback((t)=>{
    if(t==="browse"){ setTab(t); return; }
    setTab(t);
    // sub-tab খুললে layer push — back চাপলে browse এ ফিরবে
    if(pushLayer){
      const pop=pushLayer(()=>setTab("browse"));
      // tab change হলে layer remove
      return pop;
    }
  },[pushLayer]);

  return(
    <div className="page" style={{paddingTop:0}}>
      <div style={{position:"sticky",top:0,zIndex:40,background:C.bg,paddingTop:13,paddingBottom:8}}>
        <div className="atabs">
          <button className={`atab${tab==="browse"?" on":""}`} onClick={()=>setTab("browse")}>📋 Browse</button>
          <button className={`atab${tab==="rename"?" on":""}`} onClick={()=>goTab("rename")}>✏️ Rename</button>
          <button className={`atab${tab==="reference"?" on":""}`} onClick={()=>goTab("reference")} style={{color:tab==="reference"?C.green:undefined}}>🗂️ Reference</button>
          <button className={`atab${tab==="appearances"?" on":""}`} onClick={()=>goTab("appearances")} style={{color:tab==="appearances"?C.green:undefined}}>🎓 Appearances</button>
          <button className={`atab${tab==="audience"?" on":""}`} onClick={()=>goTab("audience")}>🎯 Audience</button>
          <button className={`atab${tab==="qtype"?" on":""}`} onClick={()=>goTab("qtype")} style={{color:tab==="qtype"?C.green:undefined}}>🏷️ QType</button>
          <button className={`atab${tab==="modeltest"?" on":""}`} onClick={()=>goTab("modeltest")} style={{color:tab==="modeltest"?C.purple:undefined}}>🧪 Model Test</button>
          <button className={`atab${tab==="delete"?" on":""}`} onClick={()=>goTab("delete")}>🗑️ Delete</button>
        </div>
      </div>
      {tab==="browse"&&<BrowseTab push={push} tick={tick}/>}
      {tab==="rename"&&<RenameTab push={push} tick={tick}/>}
      {tab==="reference"&&<ReferenceManagerTab push={push}/>}
      {tab==="appearances"&&<ExamAppearancesTab push={push}/>}
      {tab==="audience"&&<AudienceTagRenameTab push={push} tick={tick}/>}
      {tab==="qtype"&&<BulkQTypeTab push={push} tick={tick}/>}
      {tab==="modeltest"&&<ModelTestTab push={push} tick={tick}/>}
      {tab==="delete"&&<DeleteTab push={push} tick={tick}/>}
    </div>
  );
}

export { ContentManagerPage };
