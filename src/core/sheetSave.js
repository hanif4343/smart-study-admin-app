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

export { saveRowsToSheet, saveRowsToFirebaseBulk };
