/* ══════════ SAVE ROWS (Google Sheet | Firebase bulk) ══════════ */
import { GAS } from "./config.js";
import { fbPush, fbSet } from "./firebase.js";
import { invalidate } from "./dataCache.js";

async function saveRowsToSheet({rows,targetTab,gasSecret,push,onProgress,chunkSize}){
  if(!rows.length)return{added:0,skipped:0,failedRows:[]};
  if(!GAS){ push?.("error","❌ GAS URL সেট করা নেই","VITE_GAS_URL env var বিল্ডে সেট করা আছে কিনা চেক করো"); return{added:0,skipped:0,failedRows:rows}; }
  if(!gasSecret){ push?.("error","❌ GAS Secret Key দাও","Save Location প্যানেলে Secret Key বসাও"); return{added:0,skipped:0,failedRows:rows}; }
  const CHUNK=Math.max(1,chunkSize||100); // চাইলে ছোট চাংক (৫-১০, এমনকি ১) দিয়ে বেশি live প্রোগ্রেস আপডেট পাওয়া যায় — trade-off: ছোট চাংক = বেশি রিকোয়েস্ট = মোট সময় একটু বেশি
  const totalChunks=Math.ceil(rows.length/CHUNK);
  let added=0,skipped=0,firebaseSyncFailed=false; const failedRows=[];
  for(let i=0;i<rows.length;i+=CHUNK){
    const chunk=rows.slice(i,i+CHUNK);
    const isLast=(i+CHUNK>=rows.length);
    try{
      const resp=await fetch(GAS,{method:"POST",headers:{"Content-Type":"text/plain"},body:JSON.stringify({secret:gasSecret,type:"bulk_save_rows",targetTab,rows:chunk,sync:isLast})});
      const data=await resp.json().catch(()=>({}));
      if(data.result==="error"){ failedRows.push(...chunk); continue; }
      added+=(data.added||0); skipped+=(data.skipped||0);
      if(isLast && data.firebaseSynced===false) firebaseSyncFailed=true;
    }catch(e){ failedRows.push(...chunk); }
    onProgress?.({done:Math.min(i+CHUNK,rows.length),total:rows.length,chunkIndex:Math.floor(i/CHUNK)+1,totalChunks});
  }
  // ⚡ Sheet-এ সেভ ঠিকই হয়ে গেছে, কিন্তু GAS-এর Firebase mirror-sync ব্যর্থ হলে dedupe-এর
  // "Quiz-এ আছে" কাউন্ট আর existingQuizKeys পুরনো থেকে যাবে — সেটা এখন চুপচাপ না থেকে জানানো হয়।
  if(firebaseSyncFailed) push?.("error","⚠️ Sheet-এ সেভ হয়েছে কিন্তু Firebase sync ব্যর্থ","'Quiz-এ আছে' কাউন্ট পুরনো থাকতে পারে — একটু পরে আবার চেষ্টা করো, বা GAS Executions log চেক করো");
  return{added,skipped,failedRows};
}

/* ── Firebase-এ bulk rows সেভ — প্রতিটা row আলাদা push, ব্যর্থগুলো ফেরত দেয় (retry-এর জন্য) ──
   onProgress (ঐচ্ছিক) — প্রতিটা concurrency-ব্যাচ শেষ হলে {done,total} দিয়ে কল হয়। */
async function saveRowsToFirebaseBulk({rows,targetTab,concurrency=8,onProgress}){
  let added=0; const failedRows=[];
  for(let i=0;i<rows.length;i+=concurrency){
    const chunk=rows.slice(i,i+concurrency);
    await Promise.all(chunk.map(async(row)=>{
      try{
        const res=await fbPush(targetTab,row);
        if(res?.name) await fbSet(`${targetTab}/${res.name}/id`,res.name);
        added++;
      }catch(e){ failedRows.push(row); }
    }));
    onProgress?.({done:Math.min(i+concurrency,rows.length),total:rows.length});
  }
  if(added>0) invalidate(targetTab);
  return{added,failedRows};
}

/* ── Google Sheet থেকে সরাসরি রো ফেচ (RenameTab-এর "Google Sheet" সোর্স মোডে ব্যবহার) —
   dataCache.js-এর fetchSheetFallback-এর মতোই GAS "getSheetRows" অ্যাকশন কল করে, কিন্তু
   এখানে fallback না, ইচ্ছাকৃতভাবে Sheet-ই সোর্স (Firebase-এর সাথে মিলবে না এমন ধরে নিয়েই)। ── */
async function fetchSheetRows({sheet,gasSecret}){
  if(!GAS||!gasSecret) return null;
  try{
    const url=`${GAS}?action=getSheetRows&tab=${encodeURIComponent(sheet)}&secret=${encodeURIComponent(gasSecret)}`;
    const resp=await fetch(url);
    const data=await resp.json();
    if(data?.status!=="success"||!Array.isArray(data.rows)) return null;
    return data.rows;
  }catch(_){ return null; }
}

/* ── Google Sheet-এ সরাসরি subject/topic/sub_topic bulk-rename — GAS "renameField"
   অ্যাকশন কল করে (matching invisible zero-width char/extra স্পেস বাদ দিয়ে normalize করে হয়,
   তাই দৃশ্যত-একই-রকম দেখতে সব variant একবারেই মার্জ হয়ে যায়)। সফল হলে GAS নিজে থেকেই
   Firebase mirror-ও sync করে দেয় — এখানে আলাদা করে fbPatch করার দরকার নেই। ── */
async function renameFieldInSheet({sheet,field,oldVal,newVal,gasSecret,push}){
  if(!GAS){ push?.("error","❌ GAS URL সেট করা নেই","VITE_GAS_URL env var বিল্ডে সেট করা আছে কিনা চেক করো"); return{ok:false,count:0}; }
  if(!gasSecret){ push?.("error","❌ GAS Secret Key দাও","উপরে Secret Key বসাও"); return{ok:false,count:0}; }
  try{
    const url=`${GAS}?action=renameField&secret=${encodeURIComponent(gasSecret)}`+
      `&sheet=${encodeURIComponent(sheet)}&field=${encodeURIComponent(field)}`+
      `&oldVal=${encodeURIComponent(oldVal)}&newVal=${encodeURIComponent(newVal)}`;
    const resp=await fetch(url);
    const data=await resp.json().catch(()=>({}));
    if(data.result!=="success"){ push?.("error","❌ Rename ব্যর্থ",data.error||"অজানা error"); return{ok:false,count:0}; }
    return{ok:true,count:data.count||0,firebaseSynced:data.firebaseSynced!==false};
  }catch(e){ push?.("error","❌ Rename ব্যর্থ",e.message); return{ok:false,count:0}; }
}

/* ── Google Sheet-এ একটা single field আপডেট (একটা row) — GAS-এর existing "updateField"
   action কল করে (id দিয়ে row খুঁজে ওই column-টাই বসিয়ে দেয়, GAS নিজে থেকেই Firebase mirror
   sync করে)। এটা ইচ্ছাকৃতভাবে best-effort: GAS URL/secret না থাকলে বা network/permission
   error হলেও শুধু {ok:false} রিটার্ন করে — throw করে না, যাতে caller-এর মূল Firebase-flow
   (যেটা এর আগেই সফলভাবে সেভ হয়ে গেছে) কখনো আটকে না যায়। ── */
async function updateFieldInSheet({sheet,id,field,value,gasSecret}){
  if(!GAS||!gasSecret||!id)return{ok:false,error:"missing GAS/secret/id"};
  try{
    const url=`${GAS}?action=updateField&secret=${encodeURIComponent(gasSecret)}`+
      `&sheet=${encodeURIComponent(sheet)}&id=${encodeURIComponent(id)}`+
      `&field=${encodeURIComponent(field)}&content=${encodeURIComponent(value??"")}`;
    const resp=await fetch(url);
    const data=await resp.json().catch(()=>({}));
    if(data.result!=="success")return{ok:false,error:data.error||"unknown GAS error"};
    return{ok:true};
  }catch(e){ return{ok:false,error:e?.message||String(e)}; }
}

/* ── InlineEditModal-এর জন্য: একসাথে একাধিক field Sheet-এ sync (প্রতিটা field আলাদা
   updateField কল, সবগুলো parallel-এ চলে)। Firebase patch ইতিমধ্যে হয়ে গেছে ধরে নেওয়া হয় —
   এটা শুধু Sheet mirror-কে একই অবস্থায় আনার জন্য (best-effort, silent-fail per field)। ── */
async function syncFieldsToSheet({sheet,id,fields,gasSecret}){
  const entries=Object.entries(fields||{});
  if(!GAS||!gasSecret||!id)return{ok:false,failed:entries.map(([f])=>f)};
  const results=await Promise.all(entries.map(([field,value])=>updateFieldInSheet({sheet,id,field,value,gasSecret})));
  const failed=entries.filter((_,i)=>!results[i].ok).map(([f])=>f);
  return{ok:failed.length===0,failed};
}

/* ── DeleteTab-এর জন্য: Google Sheet থেকে একাধিক ID একসাথে ডিলিট — GAS-এর existing
   "deleteByIds" action কল করে (comma-separated ids)। Firebase delete আগেই fbDeleteBatch
   দিয়ে হয়ে যায় — GAS-এর deleteByIds ইচ্ছাকৃতভাবে Firebase mirror sync করে না (পুরনো কমেন্ট:
   "Firebase already updated directly from app - DO NOT sync"), তাই শুধু Sheet-টাই আলাদা
   করে ঠিক হয়। Best-effort: ব্যর্থ হলেও মূল delete flow-কে ব্লক করে না। ── */
async function deleteIdsInSheet({sheet,ids,gasSecret}){
  if(!GAS||!gasSecret||!ids?.length)return{ok:false,deleted:0,error:"missing GAS/secret/ids"};
  try{
    const url=`${GAS}?action=deleteByIds&secret=${encodeURIComponent(gasSecret)}`+
      `&sheet=${encodeURIComponent(sheet)}&ids=${encodeURIComponent(ids.join(","))}`;
    const resp=await fetch(url);
    const data=await resp.json().catch(()=>({}));
    if(data.result!=="success")return{ok:false,deleted:0,error:data.error||"unknown GAS error"};
    return{ok:true,deleted:data.deleted||0};
  }catch(e){ return{ok:false,deleted:0,error:e?.message||String(e)}; }
}

export { saveRowsToSheet, saveRowsToFirebaseBulk, fetchSheetRows, renameFieldInSheet, updateFieldInSheet, syncFieldsToSheet, deleteIdsInSheet };
