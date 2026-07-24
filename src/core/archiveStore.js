/* ══════════════════════════════════════════════════════════════════
   ARCHIVE STORE — সব OCR/AI result স্থায়ীভাবে (localStorage) জমা রাখে
   — AI Import, Multi-Subject Bulk Import ইত্যাদি যেকোনো OCR/AI ফলাফল
     এখানে auto-save হয় (parse হওয়ার সাথে সাথে, submit করা লাগে না)
   — কোনো কারণে কাজ কেটে গেলে/app বন্ধ হলে এখান থেকে আবার ফিরে পাওয়া
     যায় — AI-কে আবার কল করে limit খরচ করা লাগে না
   — এন্ট্রিগুলো edit করা যায়, এবং Bulk Upload বা সরাসরি Sheet/Firebase-এ
     পাঠিয়ে reuse করা যায়
   ══════════════════════════════════════════════════════════════════ */
import { nowTs } from "./utils.js";

const LS_ARCHIVE="ss_archive_v1";
const MAX_ARCHIVE=400; // এর বেশি হলে সবচেয়ে পুরনো এন্ট্রি বাদ পড়বে

function loadArchive(){
  try{
    const raw=localStorage.getItem(LS_ARCHIVE);
    if(!raw)return[];
    const arr=JSON.parse(raw);
    return Array.isArray(arr)?arr:[];
  }catch(e){ return[]; }
}

function saveArchive(list){
  const trimmed=list.slice(0,MAX_ARCHIVE);
  try{
    localStorage.setItem(LS_ARCHIVE,JSON.stringify(trimmed));
  }catch(e){
    // Quota exceeded — অর্ধেক পুরনো এন্ট্রি ফেলে আবার চেষ্টা করো
    try{
      const half=trimmed.slice(0,Math.floor(MAX_ARCHIVE/2));
      localStorage.setItem(LS_ARCHIVE,JSON.stringify(half));
    }catch(e2){ /* ignore — storage একেবারেই ভরে গেলে নতুন এন্ট্রি স্কিপ হবে */ }
  }
}

/* rows: [{q,correct,explanation?}] → bulk-ready {} wrapped text (multi-line answার-safe) */
function rowsToArchiveText(rows){
  return (rows||[]).map(r=>{
    const q=(r.q||"").toString();
    const correct=(r.correct||"").toString();
    const explanation=(r.explanation||"").toString();
    return `{${q};${correct}${explanation?(";"+explanation):""}}`;
  }).join("\n");
}

/* নতুন এন্ট্রি যোগ করে (সবচেয়ে উপরে/নতুন হিসেবে) — খালি text হলে কিছু করে না */
function archiveAdd({source,subject="",subtopic="",qtype="Written",text="",rows=null,meta=null}){
  const finalText=text&&text.trim()?text.trim():(rows?rowsToArchiveText(rows):"");
  if(!finalText.trim())return null;
  const entry={
    id:`arc_${Date.now()}_${Math.floor(Math.random()*99999)}`,
    sortTs:Date.now(),
    ts:nowTs(),
    source:source||"Unknown",
    subject:subject||"",
    subtopic:subtopic||"",
    qtype:qtype||"Written",
    text:finalText,
    meta:meta||null,
  };
  const list=loadArchive();
  list.unshift(entry);
  saveArchive(list);
  return entry;
}

function archiveList(){
  return loadArchive().sort((a,b)=>(b.sortTs||0)-(a.sortTs||0));
}

function archiveUpdate(id,patch){
  const list=loadArchive();
  const idx=list.findIndex(e=>e.id===id);
  if(idx===-1)return null;
  list[idx]={...list[idx],...patch};
  saveArchive(list);
  return list[idx];
}

function archiveDelete(id){
  const list=loadArchive().filter(e=>e.id!==id);
  saveArchive(list);
}

function archiveDeleteMany(ids){
  const idSet=new Set(ids);
  const list=loadArchive().filter(e=>!idSet.has(e.id));
  saveArchive(list);
}

function archiveClearAll(){
  saveArchive([]);
}

export { archiveAdd, archiveList, archiveUpdate, archiveDelete, archiveDeleteMany, archiveClearAll, rowsToArchiveText, LS_ARCHIVE, MAX_ARCHIVE };
