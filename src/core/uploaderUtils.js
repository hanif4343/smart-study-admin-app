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
    // ── Written প্যাটার্ন (Phase 7, MCQ-র মতোই): প্রশ্ন;উত্তর;subject;topic;ব্যাখ্যা(optional)
    // অপশন (opt1-4) নেই, বাকি নিয়ম MCQ-র সাথে সামঞ্জস্যপূর্ণ — ২-৩ কলাম হলে পুরনো ফরম্যাট
    // (subject/topic ছাড়া, OCR/AI Import compatibility), ৪+ কলাম হলে নতুন ফরম্যাট। ──
    const flat=tr.replace(/\r?\n/g," ").replace(/\s+/g," ");
    const parts=flat.split(";").map(p=>p.trim());
    if(parts.length<2)return{err:true,reason:"Written: ';' দিয়ে প্রশ্ন ও উত্তর আলাদা করুন"};
    let q,ans,subject="",topic="",explanation="";
    if(parts.length<=5){
      // ── স্বাভাবিক কেস — প্রশ্ন/উত্তরে নিজস্ব কোনো সেমিকোলন নেই, আগের মতোই পজিশন ধরে ──
      q=parts[0]; ans=parts[1];
      if(parts.length>=4){ subject=parts[2]; topic=parts[3]; explanation=parts[4]||""; }
      else if(parts.length===3){ explanation=parts[2]||""; } // পুরনো প্যাটার্ন: প্রশ্ন;উত্তর;ব্যাখ্যা
    } else {
      // ── 🐛 ফিক্স: ৫টার বেশি অংশ — মানে প্রশ্ন বা উত্তরের ভিতরেই সেমিকোলন আছে (idioms,
      // translation, একাধিক sub-part-সহ প্রশ্ন — "a. X; ans1  b. Y; ans2 ...; Subject; Topic"
      // টাইপ)। আগে এখানে পজিশন [2]/[3] ধরে Subject/Topic বের করা হতো, ফলে উত্তরের মাঝের
      // কোনো অংশ ভুলে Subject/Topic হিসেবে বসে যেত (বাস্তবে দেখা গেছে — একটা Idioms
      // প্রশ্নের উত্তরের অংশবিশেষ "He really dropped the ball..." নতুন Subject হিসেবে
      // তৈরি হয়ে গিয়েছিল)। এখন শেষ ২টা অংশ নিশ্চিতভাবে Subject/Topic ধরা হচ্ছে (এই দুটো
      // ছোট, একলাইন, সেমিকোলনবিহীন হওয়ার কথা), আর তার আগের সবটুকু (যতই সেমিকোলন থাকুক)
      // আবার জোড়া দিয়ে প্রথম সেমিকোলনে প্রশ্ন/উত্তর আলাদা করা হচ্ছে। এই ওভারফ্লো-কেসে
      // আলাদা ব্যাখ্যা(optional) সাপোর্ট করা হচ্ছে না — Subject/Topic ঠিক বসাটাই বেশি জরুরি। ──
      topic=parts[parts.length-1];
      subject=parts[parts.length-2];
      const body=parts.slice(0,parts.length-2).join(";");
      const fsi=body.indexOf(";");
      if(fsi===-1){ q=body; ans=""; } else { q=body.substring(0,fsi).trim(); ans=body.substring(fsi+1).trim(); }
    }
    if(!q)return{err:true,reason:"Written: প্রশ্ন খালি"};
    if(!ans)return{err:true,reason:"Written: উত্তর খালি"};
    if(parts.length>=4){
      if(!subject)return{err:true,reason:"Written: Subject খালি"};
      if(!topic)return{err:true,reason:"Written: Topic খালি"};
    }
    return{ok:true,q,correct:ans,subject,topic,explanation};

  } else {
    // ── MCQ প্যাটার্ন (Phase 7): প্রশ্ন;অপ১;অপ২;অপ৩;অপ৪;সঠিকউত্তর;subject;topic;ব্যাখ্যা(optional)
    // subject/topic এখন প্রতি প্রশ্নে আলাদা করে টাইপ করা হয় (একই bulk-paste-এ ভিন্ন ভিন্ন
    // বিষয়/টপিকের প্রশ্ন মিশিয়ে দেওয়া যায়)। ৬-৭ কলামের পুরনো ফরম্যাটও (subject/topic ছাড়া —
    // যেমন OCR/AI Import যেখানে subject আলাদা field থেকে আসে) এখনো চলবে, সেক্ষেত্রে
    // subject/topic খালি ফেরত যায় আর caller নিজের fallback ব্যবহার করে। ──
    const flat=tr.replace(/\r?\n/g," ").replace(/\s+/g," ");
    const parts=flat.split(";").map(p=>p.trim());
    if(parts.length<6)return{err:true,reason:`MCQ: ${parts.length}টি কলাম পেয়েছি, দরকার কমপক্ষে ৬টি (প্রশ্ন;অপ১;অপ২;অপ৩;অপ৪;উত্তর)`};
    let subject="",topic="",explanation="";
    if(parts.length<=9){
      // ── স্বাভাবিক কেস — প্রশ্ন/option-এ নিজস্ব সেমিকোলন নেই, আগের মতোই পজিশন ধরে ──
      if(!parts[0])return{err:true,reason:"MCQ: প্রশ্ন খালি"};
      if(!parts[5])return{err:true,reason:"MCQ: সঠিক উত্তর খালি"};
      if(parts.length>=8){ subject=parts[6]; topic=parts[7]; explanation=parts[8]||""; }
      else if(parts.length===7){ explanation=parts[6]||""; } // পুরনো প্যাটার্ন: subject/topic ছাড়া
      if(parts.length>=8){
        if(!subject)return{err:true,reason:"MCQ: Subject খালি"};
        if(!topic)return{err:true,reason:"MCQ: Topic খালি"};
      }
      return{ok:true,q:parts[0],opt1:parts[1],opt2:parts[2],opt3:parts[3],opt4:parts[4],correct:parts[5],subject,topic,explanation};
    }
    // ── 🐛 ফিক্স: ৯টার বেশি অংশ — প্রশ্নের ভিতরেই সেমিকোলন আছে (Written-এর একই বাগ,
    // দেখো ওই কমেন্ট)। শেষ ২টা অংশ Subject/Topic, তার আগের সব একসাথে জোড়া দিয়ে
    // প্রথম ৫টা সেমিকোলনে প্রশ্ন/অপ১-৪/সঠিকউত্তর আলাদা করা হচ্ছে (option/answer এ সেমিকোলন
    // থাকার সম্ভাবনা কম, তাই এগুলোর জন্য এখনো পজিশন-ভিত্তিক split নিরাপদ) ──
    topic=parts[parts.length-1];
    subject=parts[parts.length-2];
    const bodyParts=parts.slice(0,parts.length-2);
    const q=bodyParts.slice(0,-5).join(";").trim(); // প্রশ্নে সেমিকোলন থাকলে বাকিটা এখানেই জোড়া লাগবে
    const[o1,o2,o3,o4,ocorrect]=bodyParts.slice(-5);
    if(!q)return{err:true,reason:"MCQ: প্রশ্ন খালি"};
    if(!ocorrect)return{err:true,reason:"MCQ: সঠিক উত্তর খালি"};
    if(!subject)return{err:true,reason:"MCQ: Subject খালি"};
    if(!topic)return{err:true,reason:"MCQ: Topic খালি"};
    return{ok:true,q,opt1:o1,opt2:o2,opt3:o3,opt4:o4,correct:ocorrect,subject,topic,explanation:""};
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
      subject,sub_topic:subtopic||subject,
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
function buildSheetRow({item,subject,subtopic,qtype,audienceTags,mainQpaper,subjectId,topicId,tagIds,groupId,subIndex}){
  const isWritten=qtype==="Written";
  return{
    question:item.q,
    opt1:isWritten?"":item.opt1||"", opt2:isWritten?"":item.opt2||"",
    opt3:isWritten?"":item.opt3||"", opt4:isWritten?"":item.opt4||"",
    correct:item.correct||"",
    // ── লিগেসি নাম-ভিত্তিক কলাম (backward-compat, পুরনো duplicate-check ও
    // Sheet readability এখনো এগুলো ব্যবহার করে) ──
    subject, sub_topic:subtopic||subject,
    explanation:item.explanation||"",
    qType:isWritten?"Written":(qtype==="Study"?"Study":"MCQ"),
    technique:"", prevExam:"", mainQpaper:mainQpaper||"",
    audienceTags:(audienceTags||[]).join(","),
    // ── নতুন schema fields (Phase 2+) — QBank সহ সব সিটেই এখন ২-লেভেল (subject_id/topic_id), SubTopic নেই ──
    subject_id:subjectId||"", topic_id:topicId||"",
    audienceTagsIds:(tagIds||[]).join(","),
    group_id:groupId||"", sub_index:subIndex!=null?String(subIndex):"",
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

// NO-FIREBASE POLICY: Quiz/QBank/Study/Typing এখন সবসময় Sheet-এ যায়। পুরনো
// ব্যবহারকারীর localStorage-এ আগের "firebase" প্রেফারেন্স থাকলেও তা উপেক্ষা করা হয়।
function loadSaveLocPref(){ return "sheet"; }
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

/* ══════════ DRAFT AUTOSAVE — টাইপ করা কাজ হারিয়ে যাওয়া ঠেকাতে ══════════
   BulkUploaderPage আর SingleQuestionEntryPage দুটোতেই ব্যবহার হয়। কোনো এরর,
   ভুল করে ব্যাক চাপা, ট্যাব বন্ধ হওয়া, বা নেটওয়ার্ক ড্রপ হলেও — যতক্ষণ না
   সফল Submit হচ্ছে, ততক্ষণ localStorage-এ ড্রাফট থেকে যায়। সফল Submit হলেই
   clearDraft() কল হয়ে মুছে যায় (পুরনো ড্রাফট যেন পরে ভুল করে আবার না দেখায়)।
   প্রতিটা পেজের নিজস্ব key (Bulk vs Single আলাদা), তাই একে অন্যেরটা ওভাররাইট
   করে না। ── */
const LS_DRAFT_BULK   = "ss_draft_bulk_v1";
const LS_DRAFT_SINGLE = "ss_draft_single_v1";
function loadDraft(key){ try{ const raw=localStorage.getItem(key); return raw?JSON.parse(raw):null; }catch{ return null; } }
function saveDraft(key,data){ try{ localStorage.setItem(key,JSON.stringify({...data,_savedAt:Date.now()})); }catch{} }
function clearDraft(key){ try{ localStorage.removeItem(key); }catch{} }

export { getBulkEntries, parseBulkEntry, getBulkEffectiveType, buildBulkRecord, buildSheetRow, LS_SAVE_LOCATION, LS_FAILED_QUEUE, LS_OCR_CACHE, OCR_CACHE_MAX, loadSaveLocPref, saveSaveLocPref, loadSharedGasSecret, saveSharedGasSecret, loadFailedQueue, saveFailedQueueList, pushFailedItems, removeFailedItems, LS_DRAFT_BULK, LS_DRAFT_SINGLE, loadDraft, saveDraft, clearDraft };
