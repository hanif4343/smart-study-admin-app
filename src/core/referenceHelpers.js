/* ══════════ REFERENCE RESOLVE-OR-CREATE HELPER ══════════
   পদ (Post) / প্রতিষ্ঠান (Institution)-এর মতো "open-world" রেফারেন্স ফিল্ড —
   ড্রপডাউনে আগে থেকে সব বসানো অসম্ভব, তাই টাইপ-করা নাম নিয়ে:
     • বিদ্যমান তালিকায় (case/space বাদ দিয়ে) হুবহু মিল থাকলে সেই id রিইউজ করে
     • না থাকলে addReferenceItem দিয়ে নতুন এন্ট্রি বানিয়ে সেই id ফেরত দেয়
   TypeaheadCombo কম্পোনেন্ট শুধু UI/ম্যাচিং দেখায়, আসল create-বা-reuse
   সিদ্ধান্ত এই ফাংশনেই হয় — এক জায়গায় রাখা হলো যাতে ExamAppearancesTab আর
   BulkUploaderPage দুটোই একই লজিক শেয়ার করে (ভিন্ন ভিন্ন কপি রাখলে একটায়
   ফিক্স করলে আরেকটা বাদ পড়ার ঝুঁকি থাকে)। ── */
import { addReferenceItem } from "./sheetSave.js";

const norm=s=>String(s||"").trim().toLowerCase().replace(/\s+/g," ");

// 🆕 ফাজি "did you mean?" ম্যাচার — Single Entry-এর heading→Topic ম্যাচিং-এ যেই
// word-overlap স্কোরিং ব্যবহার হয়েছিল, ঠিক সেই একই পদ্ধতি এখানেও (শেয়ার্ড, তাই
// দুই জায়গায় আলাদা লজিক রাখতে হয় না)। বাল্ক আপলোডে টাইপো হলে (যেমন "বাংলা
// ব্যাকরন" বনাম বিদ্যমান "বাংলা ব্যাকরণ") নতুন ডুপ্লিকেট Subject/Topic তৈরি
// হয়ে যাওয়ার আগেই admin-কে সতর্ক করতে ব্যবহার হয়, দেখো resolveSubjectTopicForEntries()-এর dryRun মোড।
const normWordsRef=s=>norm(s).split(/\s+/).filter(Boolean);
function fuzzyBestMatch(name,options){
  const words=normWordsRef(name);
  if(!words.length||!options||!options.length)return null;
  let best=null,bestScore=0;
  options.forEach(o=>{
    const oWords=normWordsRef(o.name);
    if(!oWords.length)return;
    let score=0;
    words.forEach(w=>{
      if(oWords.includes(w))score+=2;
      else if(oWords.some(ow=>ow.length>=2&&w.length>=2&&(ow.includes(w)||w.includes(ow))))score+=1;
    });
    const normScore=score/Math.max(words.length,oWords.length);
    if(normScore>bestScore){bestScore=normScore;best=o;}
  });
  return bestScore>=0.5?{...best,score:bestScore}:null;
}

/**
 * sel: {id,name} — TypeaheadCombo-র value (id ফাঁকা মানে বিদ্যমান তালিকায় হুবহু মিল নেই)
 * refType: "posts" | "institutions" | "subjects" | "topics" (addReferenceItem-এর refType)
 * options: [{id,name}] — বর্তমান বিদ্যমান তালিকা (matching-এর জন্য)
 * parentId — শুধু refType==="topics" এ দরকার (কোন subject-এর আন্ডারে)
 * sheet — শুধু refType==="subjects" এ দরকার (Quiz/QBank/Study — কোন ট্যাবের subject)
 * ফেরত: {ok, id, created?} — created:true মানে নতুন এন্ট্রি বানানো হয়েছে (caller চাইলে refData রিফ্রেশ করুক)
 */
async function resolveOrCreateReference({sel,refType,options,gasSecret,push,parentId,sheet}){
  const name=(sel?.name||"").trim();
  if(!name) return{ok:false};
  if(sel?.id) return{ok:true,id:sel.id};
  const hit=(options||[]).find(o=>norm(o.name)===norm(name));
  if(hit) return{ok:true,id:hit.id};
  const res=await addReferenceItem({refType,name,parentId,sheet,gasSecret,push});
  return res.ok?{ok:true,id:res.id,created:true}:{ok:false};
}

/**
 * ⚠️ Sheet-এ কখনোই raw subject/topic টেক্সট বসে না — শুধু subject_id/topic_id বসে
 * (QBank-এর তো plain "subject"/"topic" কলামই নেই, Quiz/Study-তেও reference id-ই আসল সংযোগ)।
 * তাই MCQ/Written/OCR-import — যেখান থেকেই subject/topic টেক্সট আসুক (bulk paste, OCR,
 * archive-edit) — সবখানেই সাবমিটের আগে এই ফাংশন দিয়ে text → id রেজলভ (বা প্রয়োজনে
 * নতুন Subject/Topic তৈরি) করে নিতে হবে।
 *
 * entries: [{q,...,subject,topic}] — প্রতিটার নিজস্ব subject/topic থাকতে পারে (খালিও হতে পারে)
 * fallbackSubject/fallbackTopic — entry-তে subject/topic খালি থাকলে এটা ব্যবহার হয় (পাতার
 *   গ্লোবাল ফিল্ড থেকে — OCR পাতাগুলোয় subject আলাদাভাবে টাইপ করা থাকে)
 * subjectOptions: [{subject_id,subject_name}] — শুধু বর্তমান sheet-এর (মোড অনুযায়ী ফিল্টার করা)
 * topicsAll: [{topic_id,topic_name,subject_id}] — সব টপিক (ফাংশন নিজেই subject_id দিয়ে ফিল্টার করে)
 * sheet: "Quiz"|"QBank"|"Study" — নতুন Subject তৈরি হলে কোন ট্যাবে স্কোপ হবে
 * dryRun: true হলে **কিছুই তৈরি করে না** (addReferenceItem কল হয় না) — শুধু বলে দেয়
 *   কোন কোন Subject/Topic নতুন হিসেবে ধরা পড়েছে (wouldCreate), প্রতিটার জন্য
 *   বিদ্যমান তালিকায় কাছাকাছি নাম থাকলে সেটাও (fuzzy "did you mean?") — সাবমিটের
 *   আগে preview দেখানোর জন্য। এটাই আসল সিদ্ধান্ত না, শুধু তথ্য।
 *
 * ফেরত (dryRun না হলে, আগের মতোই): {ok:true, resolved:[{item,subjectId,topicId,subjectName,topicName}], anyCreated}
 * ফেরত (dryRun হলে): {ok:true, wouldCreate:[{type,name,sheet?,parentSubjectName?,similarTo?}]}
 *      | {ok:false, reason}
 */
async function resolveSubjectTopicForEntries({entries,subjectOptions,topicsAll,gasSecret,sheet,push,fallbackSubject,fallbackTopic,dryRun}){
  const subjCache=new Map(); // norm(name) -> subject_id
  const topicCache=new Map(); // subject_id+"|"+norm(name) -> topic_id
  let curSubjects=subjectOptions||[], curTopics=topicsAll||[];
  let anyCreated=false;
  const resolved=[];
  const wouldCreate=[]; // শুধু dryRun-এ ব্যবহৃত — deduped (subjCache/topicCache-এর কারণে একই নাম দুইবার ঢোকে না)
  for(const item of entries){
    const sName=((item.subject&&item.subject.trim())||fallbackSubject||"").trim();
    const tName=((item.topic&&item.topic.trim())||fallbackTopic||"").trim();
    if(!sName||!tName) return{ok:false,reason:`"${(item.q||"").substring(0,40)}..." — Subject/Topic নেই (লাইনে টাইপ করো, অথবা ওপরের ফিল্ড পূরণ করো)`};
    const sKey=norm(sName);
    let sId=subjCache.get(sKey);
    if(!sId){
      const hit=curSubjects.find(s=>norm(s.subject_name)===sKey);
      if(hit) sId=hit.subject_id;
      else if(dryRun){
        // 🆕 dry-run: কিছু তৈরি না করেই placeholder id, শুধু প্রিভিউ-লিস্টে যোগ করা
        const similar=fuzzyBestMatch(sName,curSubjects.map(s=>({id:s.subject_id,name:s.subject_name})));
        wouldCreate.push({type:"subject",name:sName,sheet,similarTo:similar?similar.name:null});
        sId="__NEW_SUBJECT__"+sKey;
        curSubjects=[...curSubjects,{subject_id:sId,subject_name:sName,sheet}];
      } else {
        const res=await resolveOrCreateReference({sel:{id:"",name:sName},refType:"subjects",options:curSubjects.map(s=>({id:s.subject_id,name:s.subject_name})),gasSecret,sheet,push});
        if(!res.ok) return{ok:false,reason:`Subject "${sName}" যোগ/খুঁজে পাওয়া যায়নি`};
        sId=res.id;
        if(res.created){ anyCreated=true; curSubjects=[...curSubjects,{subject_id:sId,subject_name:sName,sheet}]; }
      }
      subjCache.set(sKey,sId);
    }
    const tKey=sId+"|"+norm(tName);
    let tId=topicCache.get(tKey);
    if(!tId){
      const hit=curTopics.find(t=>t.subject_id===sId && norm(t.topic_name)===norm(tName));
      if(hit) tId=hit.topic_id;
      else if(dryRun){
        const similar=fuzzyBestMatch(tName,curTopics.filter(t=>t.subject_id===sId).map(t=>({id:t.topic_id,name:t.topic_name})));
        wouldCreate.push({type:"topic",name:tName,parentSubjectName:sName,similarTo:similar?similar.name:null});
        tId="__NEW_TOPIC__"+tKey;
        curTopics=[...curTopics,{topic_id:tId,topic_name:tName,subject_id:sId}];
      } else {
        const res=await resolveOrCreateReference({sel:{id:"",name:tName},refType:"topics",options:curTopics.filter(t=>t.subject_id===sId).map(t=>({id:t.topic_id,name:t.topic_name})),gasSecret,parentId:sId,push});
        if(!res.ok) return{ok:false,reason:`Topic "${tName}" যোগ/খুঁজে পাওয়া যায়নি`};
        tId=res.id;
        if(res.created){ anyCreated=true; curTopics=[...curTopics,{topic_id:tId,topic_name:tName,subject_id:sId}]; }
      }
      topicCache.set(tKey,tId);
    }
    resolved.push({item,subjectId:sId,topicId:tId,subjectName:sName,topicName:tName});
  }
  if(dryRun) return{ok:true,wouldCreate,resolved};
  return{ok:true,resolved,anyCreated};
}

export { resolveOrCreateReference, resolveSubjectTopicForEntries, fuzzyBestMatch, norm };
