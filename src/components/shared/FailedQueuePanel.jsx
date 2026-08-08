/* ── UI: ব্যর্থ হওয়া আইটেমগুলো — cache থেকে retry / clear করার প্যানেল ── */
import React, { useState } from "react";
import { C } from "../../core/config.js";
import { loadFailedQueue, removeFailedItems, loadSharedGasSecret } from "../../core/uploaderUtils.js";
import { saveRowsToSheet, saveRowsToFirebaseBulk } from "../../core/sheetSave.js";

function FailedQueuePanel({push,sourceFilter}){
  const[,bump]=useState(0);
  const forceRerender=()=>bump(x=>x+1);
  let items=loadFailedQueue();
  if(sourceFilter) items=items.filter(it=>it.source===sourceFilter);
  const[retryingKey,setRetryingKey]=useState(null);
  if(!items.length) return null;

  const bySource={};
  items.forEach(it=>{ (bySource[it.source]=bySource[it.source]||[]).push(it); });

  // NO-FIREBASE POLICY: Quiz/QBank/Study/Typing এখন কখনো Firebase-এ যায় না — পুরনো
  // ক্যাশে (এই পলিসির আগে জমা হওয়া) কোনো item-এর location এখনো "firebase" লেখা থাকলেও
  // এই ৪ tab-এর জন্য জোর করে Sheet-পথেই retry হবে।
  const NO_FIREBASE_TABS=["Quiz","QBank","Study","Typing"];
  const retryGroup=async(groupKey,groupItems)=>{
    setRetryingKey(groupKey);
    const{location,targetTab}=groupItems[0];
    const rows=groupItems.map(g=>g.row);
    const useSheet = location==="sheet" || NO_FIREBASE_TABS.includes(targetTab);
    const result = useSheet
      ? await saveRowsToSheet({rows,targetTab,gasSecret:loadSharedGasSecret(),push})
      : await saveRowsToFirebaseBulk({rows,targetTab});
    const failedSet=new Set(result.failedRows||[]);
    const removeKeys=groupItems.filter(g=>!failedSet.has(g.row)).map(g=>g._key);
    const succeeded=removeKeys.length, failedCount=groupItems.length-succeeded;
    removeFailedItems(removeKeys);
    setRetryingKey(null);
    forceRerender();
    if(succeeded>0) push("success",`✅ ${succeeded}টা রিট্রাইতে সফল হয়েছে`,"");
    if(failedCount>0) push("error",`${failedCount}টা আবারও ব্যর্থ হয়েছে`,"ক্যাশে থেকে গেছে — পরে আবার চেষ্টা করো");
  };
  const clearGroup=(groupItems)=>{ removeFailedItems(groupItems.map(g=>g._key)); forceRerender(); };

  return(
    <div style={{background:C.card,border:`1px solid ${C.red}55`,borderRadius:14,padding:14,marginBottom:12}}>
      <div style={{fontSize:11,textTransform:"uppercase",letterSpacing:.6,color:C.red,fontWeight:700,marginBottom:8}}>⚠️ ব্যর্থ হওয়া আইটেম ক্যাশ ({items.length}টা)</div>
      {Object.entries(bySource).map(([src,groupItems])=>{
        const groupKey=src+"|"+groupItems[0].location+"|"+groupItems[0].targetTab;
        return(
          <div key={groupKey} style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:8,padding:"8px 0",borderTop:`1px solid ${C.border}`}}>
            <div style={{fontSize:12,color:C.text}}>{src} — {groupItems.length}টা ({groupItems[0].targetTab} → {(groupItems[0].location==="sheet"||NO_FIREBASE_TABS.includes(groupItems[0].targetTab))?"Sheet":"Firebase"})</div>
            <div style={{display:"flex",gap:6}}>
              <button className="btn" disabled={retryingKey===groupKey} style={{fontSize:11,padding:"4px 10px",background:C.green,color:"#04180a"}} onClick={()=>retryGroup(groupKey,groupItems)}>{retryingKey===groupKey?"⏳":"🔁"} আবার পাঠাও</button>
              <button className="btn" disabled={retryingKey===groupKey} style={{fontSize:11,padding:"4px 10px",background:"transparent",color:C.red,border:`1px solid ${C.border}`}} onClick={()=>clearGroup(groupItems)}>🗑️</button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export { FailedQueuePanel };
