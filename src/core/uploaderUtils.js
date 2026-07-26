/* ══════════════════════════════════════════════════════════════════
   BULK ENTRY PARSING + SAVE LOCATION (Google Sheet | Firebase)
   — TypingUploaderPage, AIImportPage, BulkUploaderPage সবগুলোতে শেয়ার হয়
   ══════════════════════════════════════════════════════════════════ */
import { loadSharedGasSecret, saveSharedGasSecret } from "./utils.js";

function getBulkEntries(raw){
  const entries=[];
  const re=/\{([\s\S]+?)\}/g;
  let m;
  while((m=re.exec(raw))!==null){const e=m[1].trim();if(e)entries.push(e);}
  if(entries.length>0)return entries;
  return raw.split("\n").map(s=>s.trim()).filter(Boolean);
}
// effectiveType: "Study" | "Written" | "MCQ"
function parseBulkEntry(entry, effectiveType){
  const tr=entry.trim();
  if(!tr||tr.startsWith("#"))return{skip:true};

  if(effectiveType==="Study"){
    const si=tr.indexOf(";");
    if(si===-1)return{err:true,reason:"Study: প্রথম ';' দিয়ে প্রশ্ন ও উত্তর আলাদা করুন"};
    const q=tr.substring(0,si).trim();
    const ans=tr.substring(si+1).trim();
    if(!q)return{err:true,reason:"Study: প্রশ্ন খালি"};
    if(!ans)return{err:true,reason:"Study: উত্তর খালি"};
    return{ok:true,q,correct:ans,explanation:""};

  } else if(effectiveType==="Written"){
    const si=tr.indexOf(";");
    if(si===-1)return{err:true,reason:"Written: ';' দিয়ে প্রশ্ন ও উত্তর আলাদা করুন"};
    const q=tr.substring(0,si).trim();
    const rest=tr.substring(si+1);
    const lastSemi=rest.lastIndexOf(";");
    let ans,exp;
    if(lastSemi>0){
      ans=rest.substring(0,lastSemi).trim();
      exp=rest.substring(lastSemi+1).trim();
    } else {
      ans=rest.trim();exp="";
    }
    if(!q)return{err:true,reason:"Written: প্রশ্ন খালি"};
    if(!ans)return{err:true,reason:"Written: উত্তর খালি"};
    return{ok:true,q,correct:ans,explanation:exp};

  } else {
    const flat=tr.replace(/\r?\n/g," ").replace(/\s+/g," ");
    const parts=flat.split(";").map(p=>p.trim());
    if(parts.length<6)return{err:true,reason:`MCQ: ${parts.length}টি কলাম পেয়েছি, দরকার কমপক্ষে ৬টি (প্রশ্ন;অপ১;অপ২;অপ৩;অপ৪;উত্তর)`};
    if(!parts[0])return{err:true,reason:"MCQ: প্রশ্ন খালি"};
    if(!parts[5])return{err:true,reason:"MCQ: সঠিক উত্তর খালি"};
    return{ok:true,q:parts[0],opt1:parts[1],opt2:parts[2],opt3:parts[3],opt4:parts[4],correct:parts[5],explanation:parts[6]||""};
  }
}
const getBulkEffectiveType=(m,qt)=> m==="Study"?"Study":qt;

/* Build Firebase record — shared shape used by both direct-submit (OCR page) and BulkUploaderPage */
function buildBulkRecord({item,subject,subtopic,mode,qtype,audienceTags,ts,id,mainQpaper}){
  const tagStr=(audienceTags||[]).join(",");
  const isStudy=mode==="Study";
  const isWritten=qtype==="Written";
  if(mode==="Quiz"){
    return{
      id,question:item.q,
      option1:isStudy||isWritten?"":item.opt1||"",
      option2:isStudy||isWritten?"":item.opt2||"",
      option3:isStudy||isWritten?"":item.opt3||"",
      option4:isStudy||isWritten?"":item.opt4||"",
      correct:item.correct||"",
      subject,sub_topic:subtopic||subject,
      explanation:item.explanation||"",
      "Question Type":isWritten?"Written":"MCQ",
      AudienceTags:tagStr,
      Timestamp:ts,
      technique:"",Previous_Exam:"",
      "Question Paper":mainQpaper||"",
    };
  }
  if(mode==="QBank"){
    return{
      id,question:item.q,
      option1:isWritten?"":item.opt1||"",
      option2:isWritten?"":item.opt2||"",
      option3:isWritten?"":item.opt3||"",
      option4:isWritten?"":item.opt4||"",
      correct:item.correct||"",
      subject,sub_topic:subtopic||subject,topic:"",
      explanation:item.explanation||"",
      "Question Type":isWritten?"Written":"MCQ",
      AudienceTags:tagStr,
      Timestamp:ts,technique:"",
      "Question Paper":mainQpaper||"",
    };
  }
  /* Study */
  return{
    id,question:item.q,correct:item.correct||"",
    subject,sub_topic:subtopic||subject,
    explanation:item.explanation||"",
    "Question Type":"Study",
    AudienceTags:tagStr,
    Timestamp:ts,technique:"",
    "Question Paper":mainQpaper||"",
  };
}

/* Build Google-Sheet row — shared shape used by both direct-submit (OCR page) and BulkUploaderPage
   when saveLoc==="sheet". Same `item` shape as buildBulkRecord (from parseBulkEntry). */
function buildSheetRow({item,subject,subtopic,qtype,audienceTags,mainQpaper}){
  const isWritten=qtype==="Written";
  return{
    question:item.q,
    opt1:isWritten?"":item.opt1||"", opt2:isWritten?"":item.opt2||"",
    opt3:isWritten?"":item.opt3||"", opt4:isWritten?"":item.opt4||"",
    correct:item.correct||"",
    subject, sub_topic:subtopic||subject, topic:"",
    explanation:item.explanation||"",
    qType:isWritten?"Written":(qtype==="Study"?"Study":"MCQ"),
    technique:"", prevExam:"", mainQpaper:mainQpaper||"",
    audienceTags:(audienceTags||[]).join(","),
  };
}

/* ══════════════════════════════════════════════════════════════════
   SAVE LOCATION — Google Sheet | Firebase
   যেখানেই নতুন ডাটা DB-তে যায় (QBank→Quiz কনভার্টার, AI Import/OCR
   ডাইরেক্ট-সাবমিট, বাল্ক আপলোডার) — সবগুলোতে এই শেয়ার্ড হেল্পার +
   UI কম্পোনেন্ট ব্যবহার হয়, যাতে Google Sheet অথবা Firebase — যেকোনো
   একটা বেছে নেওয়া যায়। ব্যর্থ হওয়া রো localStorage ক্যাশে জমা থাকে,
   পরে "আবার পাঠাও" দিয়ে রিট্রাই করা যায় — নেট সমস্যা/quota শেষ হলেও
   কাজ হারায় না।
   ══════════════════════════════════════════════════════════════════ */
const LS_SAVE_LOCATION = "ss_save_location_v1";      // "sheet" | "firebase" — শেষ পছন্দ মনে রাখে
const LS_FAILED_QUEUE  = "ss_failed_save_queue_v1";  // ব্যর্থ রো — retry এর জন্য ক্যাশ
const LS_OCR_CACHE     = "ss_ocr_cache_v1";          // ছবি → OCR টেক্সট ক্যাশ (একই ছবি দ্বিতীয়বার OCR করতে হয় না)
const OCR_CACHE_MAX    = 60;                          // সর্বোচ্চ এতগুলো ছবির OCR ফলাফল ক্যাশে রাখা হয়

function loadSaveLocPref(){ try{ return localStorage.getItem(LS_SAVE_LOCATION)||"firebase"; }catch{ return "firebase"; } }
function saveSaveLocPref(v){ try{ localStorage.setItem(LS_SAVE_LOCATION,v); }catch{} }

/* ── ব্যর্থ হওয়া সেভ-রো ক্যাশ — retry এর জন্য ── */
function loadFailedQueue(){ try{ return JSON.parse(localStorage.getItem(LS_FAILED_QUEUE)||"[]"); }catch{ return []; } }
function saveFailedQueueList(items){
  try{ if(items.length) localStorage.setItem(LS_FAILED_QUEUE,JSON.stringify(items)); else localStorage.removeItem(LS_FAILED_QUEUE); }catch{}
}
function pushFailedItems(source,location,targetTab,rows){
  if(!rows||!rows.length)return;
  const existing=loadFailedQueue();
  const stamped=rows.map(r=>({_key:Math.random().toString(36).slice(2),source,location,targetTab,row:r,ts:Date.now()}));
  saveFailedQueueList([...existing,...stamped]);
}
function removeFailedItems(keys){
  saveFailedQueueList(loadFailedQueue().filter(f=>!keys.includes(f._key)));
}


export { getBulkEntries, parseBulkEntry, getBulkEffectiveType, buildBulkRecord, buildSheetRow, LS_SAVE_LOCATION, LS_FAILED_QUEUE, LS_OCR_CACHE, OCR_CACHE_MAX, loadSaveLocPref, saveSaveLocPref, loadSharedGasSecret, saveSharedGasSecret, loadFailedQueue, saveFailedQueueList, pushFailedItems, removeFailedItems };
