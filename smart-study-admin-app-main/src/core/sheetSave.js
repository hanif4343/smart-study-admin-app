/* ══════════ SAVE ROWS (Google Sheet | Firebase bulk) ══════════ */
import { GAS } from "./config.js";
import { fbPush, fbSet } from "./firebase.js";
import { invalidate } from "./dataCache.js";

// 🐛 ফিক্স (২০+ মিনিট ধরে "সেভ হচ্ছে..." আটকে থাকা): আগে plain fetch()-এর কোনো
// timeout ছিল না — ধীরগতির/অস্থির নেটওয়ার্কে (LTE-তে কয়েক KB/s দেখা গেছে
// স্ক্রিনশটে) রিকোয়েস্ট চিরকাল ঝুলে থাকতে পারতো, ইউজারকে বাধ্য করে অ্যাপ বন্ধ করে
// দিতে — প্রশ্ন সেভ হলো কিনা কিছুই বোঝা যেত না। এখন প্রতিটা চাংক-রিকোয়েস্ট একটা
// সময়সীমার মধ্যে বাঁধা (AbortController) — সময় ফুরালেই ব্যর্থ ধরে নিয়ে একবার
// (বড় timeout দিয়ে) রিট্রাই করে, তারপরও ব্যর্থ হলে সেই চাংকটাকে failedRows-এ
// রেখে পরের চাংকে এগিয়ে যায় (পুরো সাবমিট আটকে থাকে না)।
function fetchWithTimeout(url,opts,timeoutMs){
  const ctrl=new AbortController();
  const timer=setTimeout(()=>ctrl.abort(),timeoutMs);
  return fetch(url,{...opts,signal:ctrl.signal}).finally(()=>clearTimeout(timer));
}

async function saveRowsToSheet({rows,targetTab,gasSecret,push,onProgress,chunkSize,examAppearance,source}){
  if(!rows.length)return{added:0,skipped:0,failedRows:[]};
  if(!GAS){ push?.("error","❌ GAS URL সেট করা নেই","VITE_GAS_URL env var বিল্ডে সেট করা আছে কিনা চেক করো"); return{added:0,skipped:0,failedRows:rows}; }
  if(!gasSecret){ push?.("error","❌ GAS Secret Key দাও","Save Location প্যানেলে Secret Key বসাও"); return{added:0,skipped:0,failedRows:rows}; }
  const CHUNK=Math.max(1,chunkSize||100); // চাইলে ছোট চাংক (৫-১০, এমনকি ১) দিয়ে বেশি live প্রোগ্রেস আপডেট পাওয়া যায় — trade-off: ছোট চাংক = বেশি রিকোয়েস্ট = মোট সময় একটু বেশি
  const totalChunks=Math.ceil(rows.length/CHUNK);
  let added=0,skipped=0,firebaseSyncFailed=false,examAppearancesAdded=0,examAppearancesLinkedToExisting=0; const failedRows=[];
  for(let i=0;i<rows.length;i+=CHUNK){
    const chunk=rows.slice(i,i+CHUNK);
    const isLast=(i+CHUNK>=rows.length);
    // examAppearance (ঐচ্ছিক, শুধু QBank বাল্ক-আপলোডে পদ/প্রতিষ্ঠান/সাল দেওয়া থাকলে) —
    // GAS bulk_save_rows-কে জানায় যাতে এই চাংকে যে নতুন question_id-গুলো তৈরি হচ্ছে,
    // প্রতিটার জন্য একই ব্যাচে Exam_Appearances-এ একটা করে appearance-রো যোগ হয়ে যায়
    // (আলাদা করে প্রতিটা প্রশ্নের id জেনে পরে addExamAppearance কল করার দরকার পড়ে না)।
    // 🐛 ফিক্স: এখন এটা duplicate-detection-এর সাথেও যুক্ত — যদি পেস্ট করা কোনো প্রশ্ন
    // ইতিমধ্যে QBank-এ থাকে (স্রেফ duplicate হিসেবে বাদ যেত আগে), GAS সেটাকে নতুন রো
    // না বানিয়ে বিদ্যমান প্রশ্নের সাথে এই appearance জুড়ে দেয় — অ্যাডমিনকে মনে রাখতে হয়
    // না প্রশ্নটা আগে কোথাও যোগ করা ছিল কিনা।
    const body={secret:gasSecret,type:"bulk_save_rows",targetTab,rows:chunk,sync:isLast};
    if(examAppearance) body.examAppearance=examAppearance;
    // 🆕 কোন ফিচার এই প্রশ্নগুলো যোগ করছে (Bulk_Text/Bulk_OCR/Single_OCR/Single_Text
    // ইত্যাদি) — GAS "added_by" কলামে বসাবে (কলাম না থাকলে চুপচাপ ignore হবে)।
    if(source) body.source=source;
    let ok=false;
    for(let attempt=1;attempt<=2 && !ok;attempt++){
      const timeoutMs=attempt===1?25000:45000;
      try{
        if(attempt===2) push?.("warn","⏳ ধীর নেটওয়ার্ক, আবার চেষ্টা করা হচ্ছে...",`চাংক ${Math.floor(i/CHUNK)+1}/${totalChunks}`);
        const resp=await fetchWithTimeout(GAS,{method:"POST",headers:{"Content-Type":"text/plain"},body:JSON.stringify(body)},timeoutMs);
        const data=await resp.json().catch(()=>({}));
        if(data.result==="error"){ failedRows.push(...chunk); ok=true; break; } // সার্ভার-সাইড error — রিট্রাই করে লাভ নেই
        added+=(data.added||0); skipped+=(data.skipped||0);
        examAppearancesAdded+=(data.examAppearancesAdded||0);
        examAppearancesLinkedToExisting+=(data.examAppearancesLinkedToExisting||0);
        if(isLast && data.firebaseSynced===false) firebaseSyncFailed=true;
        ok=true;
      }catch(e){
        if(attempt===2) failedRows.push(...chunk); // দুইবার চেষ্টার পরও ব্যর্থ — এই চাংক বাদ, বাকিগুলো চলতে থাকবে
      }
    }
    onProgress?.({done:Math.min(i+CHUNK,rows.length),total:rows.length,chunkIndex:Math.floor(i/CHUNK)+1,totalChunks});
  }
  // ⚡ Sheet-এ সেভ ঠিকই হয়ে গেছে, কিন্তু GAS-এর Firebase mirror-sync ব্যর্থ হলে dedupe-এর
  // "Quiz-এ আছে" কাউন্ট আর existingQuizKeys পুরনো থেকে যাবে — সেটা এখন চুপচাপ না থেকে জানানো হয়।
  if(firebaseSyncFailed) push?.("error","⚠️ Sheet-এ সেভ হয়েছে কিন্তু Firebase sync ব্যর্থ","'Quiz-এ আছে' কাউন্ট পুরনো থাকতে পারে — একটু পরে আবার চেষ্টা করো, বা GAS Executions log চেক করো");
  return{added,skipped,failedRows,examAppearancesAdded,examAppearancesLinkedToExisting};
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
async function updateFieldInSheet({sheet,id,field,value,gasSecret,editSource}){
  if(!GAS||!gasSecret||!id)return{ok:false,error:"missing GAS/secret/id"};
  try{
    // 🆕 editSource — GAS "edited_by" কলামে "Admin App - <সময়>" বা "Main App - <সময়>"
    // বসায় (কলাম না থাকলে চুপচাপ ignore হয়)। এই ফাংশনটা এখন পর্যন্ত শুধু Admin App-এর
    // টুলগুলো থেকেই কল হয়, তাই ডিফল্ট "Admin App" — ভবিষ্যতে Main Smart Study App
    // থেকে কখনো এই একই endpoint কল হলে editSource:"Main App" পাঠালেই যথেষ্ট।
    const url=`${GAS}?action=updateField&secret=${encodeURIComponent(gasSecret)}`+
      `&sheet=${encodeURIComponent(sheet)}&id=${encodeURIComponent(id)}`+
      `&field=${encodeURIComponent(field)}&content=${encodeURIComponent(value??"")}`+
      `&editSource=${encodeURIComponent(editSource||"Admin App")}`;
    const resp=await fetch(url);
    const data=await resp.json().catch(()=>({}));
    if(data.result!=="success")return{ok:false,error:data.error||"unknown GAS error"};
    return{ok:true};
  }catch(e){ return{ok:false,error:e?.message||String(e)}; }
}

/* ── InlineEditModal-এর জন্য: একসাথে একাধিক field Sheet-এ sync।
   🐛 ফিক্স ("Edit ব্যর্থ, ফিল্ড: opt1, opt3" — এলোমেলো ২-১টা ফিল্ড ব্যর্থ হওয়া):
   আগে এটা প্রতিটা field-এর জন্য আলাদা updateFieldInSheet() (GET, action=updateField)
   parallel-এ (Promise.all) পাঠাতো — প্রতিটা কল GAS-এ নিজে থেকে script-wide লক নিতো,
   পুরো শিট আলাদাভাবে পড়তো, আর নিজে থেকে একটা করে পুরো-শিট syncToFirebase() চালাতো।
   Quiz-এর মতো বড় শিটে ৮টা ফিল্ড (Question/Opt1-4/Correct/Explanation/Technique)
   একসাথে এডিট করলে এই ৮টা কল একই লকের জন্য সিরিয়ালি লাইন ধরতো — মোট সময় GAS-এর
   ৩০সে lock-wait ছাড়িয়ে গেলে যেই কলগুলো তখনো সারিতে ছিল সেগুলো lock timeout খেয়ে
   ব্যর্থ হতো (কোন ২টা ফিল্ড ব্যর্থ হবে সেটা নিছক টাইমিং-নির্ভর/এলোমেলো — ফিল্ডের
   মানের সাথে কোনো সম্পর্ক নেই)। এখন সব field একটা মাত্র POST (type=update_fields)-এ
   পাঠানো হয় — GAS-সাইডে একবারই লক নেওয়া হয়, একবারই শিট পড়া হয়, একবারই sync হয়,
   তাই লক-কনটেনশনই তৈরি হয় না। ── */
async function updateFieldsInSheet({sheet,id,fields,gasSecret,editSource}){
  if(!GAS)return{ok:false,failed:Object.keys(fields||{}),error:"GAS URL নেই"};
  if(!gasSecret)return{ok:false,failed:Object.keys(fields||{}),error:"GAS Secret নেই"};
  if(!id)return{ok:false,failed:Object.keys(fields||{}),error:"id নেই"};
  try{
    const resp=await fetch(GAS,{
      method:"POST",headers:{"Content-Type":"text/plain"},
      body:JSON.stringify({secret:gasSecret,type:"update_fields",sheet,id,fields:fields||{},editSource:editSource||"Admin App"}),
    });
    const data=await resp.json().catch(()=>({}));
    if(data.result!=="success")return{ok:false,failed:Object.keys(fields||{}),error:data.error||"unknown GAS error"};
    const failed=data.failed||[]; // শুধু column-not-found জাতীয় ফিল্ড এখানে আসবে, timeout-জনিত না
    return{ok:failed.length===0,failed};
  }catch(e){ return{ok:false,failed:Object.keys(fields||{}),error:e?.message||String(e)}; }
}

async function syncFieldsToSheet({sheet,id,fields,gasSecret,editSource}){
  const entries=Object.entries(fields||{});
  if(!GAS||!gasSecret||!id)return{ok:false,failed:entries.map(([f])=>f)};
  const res=await updateFieldsInSheet({sheet,id,fields,gasSecret,editSource});
  return{ok:res.ok,failed:res.failed||[]};
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

/* ── Phase 5 (নতুন schema v2) ──────────────────────────────────────────────
   Subjects/Topics/Tags/Posts/Institutions রেফারেন্স-টেবিলের জন্য।
   এখন rename একটা ছোট রেফারেন্স-টেবিলের ১ রো বদলায় — Quiz/QBank/Study-র
   হাজার হাজার রো আর টাচ হয় না (আগের renameFieldInSheet-এর cascade সমস্যা
   এখানেই সমাধান হলো)। ────────────────────────────────────────────────── */

/* ── সব রেফারেন্স-টেবিল (Subjects/Topics/Tags/Posts/Institutions)
   একসাথে fetch — এগুলো ছোট বলে বাল্ক-ফেচ নিরাপদ। ── */
async function fetchReferenceData({gasSecret}){
  if(!GAS||!gasSecret) return null;
  try{
    const url=`${GAS}?action=getReferenceData&secret=${encodeURIComponent(gasSecret)}`;
    const resp=await fetch(url);
    const data=await resp.json();
    if(data?.status!=="success"||!data.data) return null;
    return data.data; // {subjects:[],topics:[],tags:[],posts:[],institutions:[]}
  }catch(_){ return null; }
}

/* ── refType (subjects/topics/tags/posts/institutions) + id দিয়ে
   ঠিক ১টা রেফারেন্স-রো রিনেম — GAS-এর নতুন "renameReferenceItem" action। ── */
async function renameReferenceItem({refType,id,newName,gasSecret,push}){
  if(!GAS){ push?.("error","❌ GAS URL সেট করা নেই","VITE_GAS_URL env var বিল্ডে সেট করা আছে কিনা চেক করো"); return{ok:false}; }
  if(!gasSecret){ push?.("error","❌ GAS Secret Key দাও","উপরে Secret Key বসাও"); return{ok:false}; }
  try{
    const url=`${GAS}?action=renameReferenceItem&secret=${encodeURIComponent(gasSecret)}`+
      `&refType=${encodeURIComponent(refType)}&id=${encodeURIComponent(id)}&newName=${encodeURIComponent(newName)}`;
    const resp=await fetch(url);
    const data=await resp.json().catch(()=>({}));
    if(data.status!=="success"){ push?.("error","❌ Rename ব্যর্থ",data.message||"অজানা error"); return{ok:false}; }
    return{ok:true,rowsChanged:data.rowsChanged||1,firebaseSynced:data.firebaseSynced!==false};
  }catch(e){ push?.("error","❌ Rename ব্যর্থ",e.message); return{ok:false}; }
}

/* ── refType + name (+ parentId/sheet) দিয়ে নতুন রেফারেন্স-এন্ট্রি যোগ — GAS-এর
   "addReferenceItem" action। id GAS নিজে থেকেই generate করে (parent-scoped prefix)। ── */
async function addReferenceItem({refType,name,parentId,sheet,gasSecret,push}){
  if(!GAS){ push?.("error","❌ GAS URL সেট করা নেই",""); return{ok:false}; }
  if(!gasSecret){ push?.("error","❌ GAS Secret Key দাও",""); return{ok:false}; }
  try{
    let url=`${GAS}?action=addReferenceItem&secret=${encodeURIComponent(gasSecret)}`+
      `&refType=${encodeURIComponent(refType)}&name=${encodeURIComponent(name)}`;
    if(parentId) url+=`&parentId=${encodeURIComponent(parentId)}`;
    if(sheet) url+=`&sheet=${encodeURIComponent(sheet)}`;
    const resp=await fetch(url);
    const data=await resp.json().catch(()=>({}));
    if(data.status!=="success"){ push?.("error","❌ যোগ ব্যর্থ",data.message||"অজানা error"); return{ok:false}; }
    return{ok:true,id:data.id};
  }catch(e){ push?.("error","❌ যোগ ব্যর্থ",e.message); return{ok:false}; }
}

/* ── refType + id দিয়ে একটা রেফারেন্স-এন্ট্রি ডিলিট — GAS-এর "deleteReferenceItem"।
   ⚠️ শুধু reference-রো মোছে, ব্যবহারকারী প্রশ্ন মোছে না (তাদের subject_id/topic_id
   orphan হয়ে যাবে) — কল করার আগে UI-তে সতর্ক করা উচিত। ── */
async function deleteReferenceItem({refType,id,gasSecret,push}){
  if(!GAS||!gasSecret) return{ok:false};
  try{
    const url=`${GAS}?action=deleteReferenceItem&secret=${encodeURIComponent(gasSecret)}`+
      `&refType=${encodeURIComponent(refType)}&id=${encodeURIComponent(id)}`;
    const resp=await fetch(url);
    const data=await resp.json().catch(()=>({}));
    if(data.status!=="success"){ push?.("error","❌ ডিলিট ব্যর্থ",data.message||"অজানা error"); return{ok:false}; }
    return{ok:true};
  }catch(e){ push?.("error","❌ ডিলিট ব্যর্থ",e.message); return{ok:false}; }
}

/* ── একটা পুরো subject_id/topic_id-এর সব প্রশ্ন একসাথে ডিলিট — GAS-এর
   "deleteByReferenceId" action (row-range-ভিত্তিক, দ্রুত, বড় Subject-এও নিরাপদ)। ── */
async function deleteByReferenceId({refType,id,gasSecret,push}){
  if(!GAS||!gasSecret) return{ok:false};
  try{
    const url=`${GAS}?action=deleteByReferenceId&secret=${encodeURIComponent(gasSecret)}`+
      `&refType=${encodeURIComponent(refType)}&id=${encodeURIComponent(id)}`;
    const resp=await fetch(url);
    const data=await resp.json().catch(()=>({}));
    if(data.status!=="success"){ push?.("error","❌ ডিলিট ব্যর্থ",data.message||"অজানা error"); return{ok:false}; }
    return{ok:true,deleted:data.deleted||0,examAppearancesDeleted:data.examAppearancesDeleted||0};
  }catch(e){ push?.("error","❌ ডিলিট ব্যর্থ",e.message); return{ok:false}; }
}

/* ── একটা প্রশ্নের সব exam appearance (পদ+প্রতিষ্ঠান+সাল) দেখা — GAS-এর
   "getExamAppearances" action। ── */
async function getExamAppearances({questionId,gasSecret,push}){
  if(!GAS||!gasSecret) return{ok:false,appearances:[]};
  try{
    const url=`${GAS}?action=getExamAppearances&secret=${encodeURIComponent(gasSecret)}&questionId=${encodeURIComponent(questionId)}`;
    const resp=await fetch(url);
    const data=await resp.json().catch(()=>({}));
    if(data.status!=="success"){ push?.("error","❌ লোড ব্যর্থ",data.message||""); return{ok:false,appearances:[]}; }
    return{ok:true,appearances:data.appearances||[]};
  }catch(e){ push?.("error","❌ লোড ব্যর্থ",e.message); return{ok:false,appearances:[]}; }
}

/* ── একটা প্রশ্নের নতুন appearance (post+institution+year) যোগ — GAS-এর
   "addExamAppearance" action। মূল প্রশ্নের রো টাচ হয় না। ── */
async function addExamAppearance({questionId,postId,institutionId,year,gasSecret,push}){
  if(!GAS||!gasSecret) return{ok:false};
  try{
    const url=`${GAS}?action=addExamAppearance&secret=${encodeURIComponent(gasSecret)}`+
      `&questionId=${encodeURIComponent(questionId)}&postId=${encodeURIComponent(postId)}`+
      `&institutionId=${encodeURIComponent(institutionId)}&year=${encodeURIComponent(year)}`;
    const resp=await fetch(url);
    const data=await resp.json().catch(()=>({}));
    if(data.status!=="success"){ push?.("error","❌ যোগ ব্যর্থ",data.message||""); return{ok:false}; }
    return{ok:true,appearanceId:data.appearanceId};
  }catch(e){ push?.("error","❌ যোগ ব্যর্থ",e.message); return{ok:false}; }
}

/* ── পুরো Exam_Appearances ট্যাব একবারে বাল্ক-ফেচ — GAS-এর "getAllExamAppearances"
   action (Android User App-এর "পদ অনুযায়ী ব্রাউজ" ফ্লো-র জন্য আগে থেকেই সার্ভারে
   ছিল, এখন Admin App-এর Browse ট্যাবেও QBank-এর Post/Institution/Year ফিল্টারের
   জন্য ব্যবহার হয়)। questionId দিয়ে scope করা না — পুরো টেবিল একবারে আসে। ── */
async function fetchAllExamAppearances({gasSecret,push}){
  if(!GAS||!gasSecret) return{ok:false,appearances:[]};
  try{
    const url=`${GAS}?action=getAllExamAppearances&secret=${encodeURIComponent(gasSecret)}`;
    const resp=await fetch(url);
    const data=await resp.json().catch(()=>({}));
    if(data.status!=="success"){ push?.("error","❌ Appearance লোড ব্যর্থ",data.message||""); return{ok:false,appearances:[]}; }
    return{ok:true,appearances:data.appearances||[]};
  }catch(e){ push?.("error","❌ Appearance লোড ব্যর্থ",e.message); return{ok:false,appearances:[]}; }
}

/* ── একটা নির্দিষ্ট appearance-এন্ট্রি মুছে দেয় (ভুল করে যোগ হওয়া পদ/প্রতিষ্ঠান/সাল
   সরানোর জন্য) — মূল প্রশ্ন বা বাকি appearance-গুলো touch হয় না ── */
async function deleteExamAppearance({appearanceId,gasSecret,push}){
  try{
    const url=`${GAS}?action=deleteExamAppearance&secret=${encodeURIComponent(gasSecret)}&appearanceId=${encodeURIComponent(appearanceId)}`;
    const resp=await fetch(url);
    const data=await resp.json().catch(()=>({}));
    if(data.status!=="success"){ push?.("error","❌ Appearance মুছতে ব্যর্থ",data.message||""); return{ok:false}; }
    return{ok:true};
  }catch(e){ push?.("error","❌ Appearance মুছতে ব্যর্থ",e.message); return{ok:false}; }
}

/* ══════════ CDN Publish (GitHub CDN Plan — দেখো GAS_CDN_PLANNING.md) ══════════
   "_DirtyTopics" শিটে জমে থাকা dirty-topic-গুলোই publish হয় — updateField/
   deleteByIds/moveQuestions/moveTopic/renameField/renameReferenceItem/
   deleteByReferenceId/bulk_save_rows — এই সব action GAS-সাইডে নিজে থেকেই dirty
   মার্ক করে, আলাদা করে ক্লায়েন্ট থেকে কিছু পাঠাতে হয় না। ── */

/* কতগুলো Topic publish-এর অপেক্ষায় আছে (Publish বাটনের ওপরে দেখানোর জন্য,
   read-only, দ্রুত) */
async function fetchDirtyTopicsCount({gasSecret}){
  if(!GAS||!gasSecret) return null;
  try{
    const url=`${GAS}?action=getDirtyTopicsCount&secret=${encodeURIComponent(gasSecret)}`;
    const resp=await fetch(url);
    const data=await resp.json().catch(()=>({}));
    if(data.status!=="success") return null;
    return data.dirtyCount ?? 0;
  }catch(_){ return null; }
}

/* আসল Publish — dirty topic-গুলো GitHub-এ commit করে manifest.json আপডেট করে।
   dirty topic বেশি হলে (bulk move-এর পরে) কয়েক সেকেন্ড-১/২ মিনিট লাগতে পারে,
   তাই timeout বাড়িয়ে রাখা হলো (fetch-এর ডিফল্ট timeout নেই, কিন্তু browser-এর
   নিজস্ব limit থাকতে পারে — সাধারণত যথেষ্ট বড়)। */
async function publishNow({gasSecret,push}){
  if(!GAS){ push?.("error","❌ GAS URL সেট করা নেই","VITE_GAS_URL env var বিল্ডে সেট করা আছে কিনা চেক করো"); return{ok:false}; }
  if(!gasSecret){ push?.("error","❌ GAS Secret Key দাও","উপরে Secret Key বসাও"); return{ok:false}; }
  try{
    const url=`${GAS}?action=publishNow&secret=${encodeURIComponent(gasSecret)}`;
    const resp=await fetch(url);
    const data=await resp.json().catch(()=>({}));
    if(data.status==="error"){ push?.("error","❌ Publish ব্যর্থ",data.message||"অজানা error"); return{ok:false,...data}; }
    return{ok:true,...data}; // {status, published, failed, errors, totalQuestions, manifestVersion, sanityWarning}
  }catch(e){ push?.("error","❌ Publish ব্যর্থ (নেটওয়ার্ক)",e.message); return{ok:false}; }
}

/* CDN-এ এই মুহূর্তে বাস্তবে কতগুলো প্রশ্ন/টপিক আছে (read-only, কোনো নতুন
   Publish ট্রিগার করে না — সরাসরি GitHub-এর manifest.json পড়ে গোনে) */
async function fetchPublishStats({gasSecret}){
  if(!GAS||!gasSecret) return null;
  try{
    const url=`${GAS}?action=getPublishStats&secret=${encodeURIComponent(gasSecret)}`;
    const resp=await fetch(url);
    const data=await resp.json().catch(()=>({}));
    if(data.status!=="success") return null;
    return data; // {totalQuestions, topicCount, version, publishedAt}
  }catch(_){ return null; }
}

/* "ধাপ ৮" — Phase ১ deploy হওয়ার আগে থেকে থাকা সব পুরনো প্রশ্ন (যেগুলো
   কখনো dirty মার্ক হয়নি, তাই এখনো CDN-এ যায়নি) একসাথে dirty মার্ক করে দেয়।
   এটার পর একাধিকবার "Publish Now" চাপলে (৪০০-এর cap থাকায়) ধীরে ধীরে পুরো
   প্রশ্নব্যাংক প্রথমবার সম্পূর্ণভাবে CDN-এ উঠে যাবে। এক-কালীন কাজ — সাবধানে
   ব্যবহার করা উচিত (হুট করে অনেক Topic dirty হয়ে যাবে)। */
async function markAllTopicsDirty({gasSecret,push}){
  if(!GAS){ push?.("error","❌ GAS URL সেট করা নেই",""); return{ok:false}; }
  if(!gasSecret){ push?.("error","❌ GAS Secret Key দাও",""); return{ok:false}; }
  try{
    const url=`${GAS}?action=markAllTopicsDirty&secret=${encodeURIComponent(gasSecret)}`;
    const resp=await fetch(url);
    const data=await resp.json().catch(()=>({}));
    if(data.status==="error"){ push?.("error","❌ ব্যর্থ",data.message||"অজানা error"); return{ok:false}; }
    return{ok:true,markedCount:data.markedCount||0};
  }catch(e){ push?.("error","❌ ব্যর্থ (নেটওয়ার্ক)",e.message); return{ok:false}; }
}

/* Orphan প্রশ্ন — যাদের topic_id দেওয়া আছে কিন্তু সেই topic_id Topics
   reference-শিটে নেই (পুরনো টপিক মুছে/rename হয়ে যাওয়ায় এতিম হয়ে গেছে)।
   "blank" (topic_id একদম ফাঁকা) আলাদা, Review ট্যাবে ট্র্যাক হয়, এখানে ধরা
   হয় না — সেগুলো ভালো প্রশ্ন, শুধু ক্যাটাগরাইজ করা বাকি। */
async function fetchOrphanStats({gasSecret}){
  if(!GAS||!gasSecret) return null;
  try{
    const url=`${GAS}?action=countOrphanQuestions&secret=${encodeURIComponent(gasSecret)}`;
    const resp=await fetch(url);
    const data=await resp.json().catch(()=>({}));
    if(data.status!=="success") return null;
    return data.bySheet; // {Quiz:{total,blank,orphan,ok}, QBank:{...}, Study:{...}}
  }catch(_){ return null; }
}

/* শুধু "orphan" ক্যাটাগরি (blank না) এক ক্লিকে মুছে দেয় — sheet না দিলে
   Quiz/QBank/Study তিনটাতেই চলে। destructive, তাই caller-এর নিজের confirm
   দরকার এটা কল করার আগে। */
async function deleteOrphanQuestions({gasSecret,push,sheet}){
  if(!GAS){ push?.("error","❌ GAS URL সেট করা নেই",""); return{ok:false}; }
  if(!gasSecret){ push?.("error","❌ GAS Secret Key দাও",""); return{ok:false}; }
  try{
    let url=`${GAS}?action=deleteOrphanQuestions&secret=${encodeURIComponent(gasSecret)}`;
    if(sheet) url+=`&sheet=${encodeURIComponent(sheet)}`;
    const resp=await fetch(url);
    const data=await resp.json().catch(()=>({}));
    if(data.status==="error"){ push?.("error","❌ ব্যর্থ",data.message||"অজানা error"); return{ok:false}; }
    return{ok:true,deletedCount:data.deletedCount||0,bySheet:data.bySheet||{}};
  }catch(e){ push?.("error","❌ ব্যর্থ (নেটওয়ার্ক)",e.message); return{ok:false}; }
}

/* manifest.json-এর সাম্প্রতিক কয়েকটা commit history (read-only) — Rollback-এর
   আগে "কোনটায় ফিরবো" দেখানোর জন্য। */
async function fetchManifestHistory({gasSecret}){
  if(!GAS||!gasSecret) return null;
  try{
    const url=`${GAS}?action=listManifestHistory&secret=${encodeURIComponent(gasSecret)}`;
    const resp=await fetch(url);
    const data=await resp.json().catch(()=>({}));
    if(data.status!=="success") return null;
    return data.commits; // [{sha,date,message,version?,topicCount?}]
  }catch(_){ return null; }
}

/* manifest.json-কে আগের কোনো commit-এর অবস্থায় ফিরিয়ে দেয় (নতুন commit
   হিসেবেই, history মুছে যায় না)। destructive-ঘেঁষা, caller নিজের confirm
   দরকার এটা কল করার আগে। */
async function rollbackManifest({gasSecret,push,sha}){
  if(!GAS){ push?.("error","❌ GAS URL সেট করা নেই",""); return{ok:false}; }
  if(!gasSecret){ push?.("error","❌ GAS Secret Key দাও",""); return{ok:false}; }
  if(!sha){ push?.("error","❌ কোন ভার্সনে ফিরবে বেছে দাও",""); return{ok:false}; }
  try{
    const url=`${GAS}?action=rollbackManifest&secret=${encodeURIComponent(gasSecret)}&sha=${encodeURIComponent(sha)}`;
    const resp=await fetch(url);
    const data=await resp.json().catch(()=>({}));
    if(data.status==="error"){ push?.("error","❌ Rollback ব্যর্থ",data.message||"অজানা error"); return{ok:false}; }
    return{ok:true};
  }catch(e){ push?.("error","❌ ব্যর্থ (নেটওয়ার্ক)",e.message); return{ok:false}; }
}

export { saveRowsToSheet, saveRowsToFirebaseBulk, fetchSheetRows, renameFieldInSheet, updateFieldInSheet, updateFieldsInSheet, syncFieldsToSheet, deleteIdsInSheet, fetchReferenceData, renameReferenceItem, addReferenceItem, deleteReferenceItem, deleteByReferenceId, getExamAppearances, addExamAppearance, fetchAllExamAppearances, deleteExamAppearance, fetchDirtyTopicsCount, publishNow, fetchPublishStats, markAllTopicsDirty, fetchOrphanStats, deleteOrphanQuestions, fetchManifestHistory, rollbackManifest };
