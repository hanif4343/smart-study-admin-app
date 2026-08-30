/* ══════════ OCR Groups → PaperComposer paper state কনভার্টার ══════════
   AIImportPage-এ ছবি থেকে OCR + AI দিয়ে বের করা "group-aware" JSON
   ([{subject,heading,topic,formatStyle?,items:[{q,a}]}, ...]) কে সরাসরি
   PaperComposer-এর `paper` state shape ({bangla:[],english:[],math:[],gk:[]})-এ
   রূপান্তর করে, যাতে <PaperComposer initialPaper={...}/> দিয়ে সরাসরি রেন্ডার
   করা যায় — ঠিক Single Entry-তে হাতে টাইপ করলে যেই শেপ তৈরি হতো সেটাই।

   সিদ্ধান্ত (আগের প্ল্যান-আলোচনা অনুযায়ী):
   - বাংলা/ইংরেজি → গ্রুপড কার্ড (হেডিং + সাব-পার্ট), subjectChoice
     (ব্যাকরণ/সাহিত্য বা Grammar/Literature) অটো-ডিটেক্ট
   - গণিত/GK → গ্রুপ না, প্রতিটা item আলাদা flat কার্ড (হেডিং থাকলে প্রশ্নের
     শুরুতে জুড়ে দেওয়া হয়, যেমন "উৎপাদকে বিশ্লেষণ করুন: ৮x³+১")
   - Topic — বিদ্যমান তালিকার সাথে fuzzy ম্যাচ (bestTopicMatchForHeading রিইউজ),
     না মিললে raw টেক্সট বসে (নতুন Topic হিসেবে তৈরি হবে সাবমিটের সময়, ঠিক
     Single Entry-এর heading→Topic অটো-ম্যাচের মতোই আচরণ)
   - MCQ এখনো এই কনভার্টারে সাপোর্টেড না (স্কোপ অনুযায়ী শুধু Written) — items-এ
     `opts`/`correct` থাকলেও আপাতত ইগনোর করে Written হিসেবেই ঢোকে
   ══════════ */
import { PAPER_TABS, newPaperItem, newGroupCard, newFlatCard, bestTopicMatchForHeading, mergedTopicOptionsFor } from "../components/shared/PaperComposer.jsx";
import { norm } from "./referenceHelpers.js";

/* ── কোন ট্যাবে যাবে + (গ্রুপড হলে) কোন subjectChoice — group.subject টেক্সট
   দেখে বের করা। শুধু এই ৪টা নির্দিষ্ট প্যাটার্নের বাইরে কিছু হলে GK-তে পড়ে
   (আন্দাজ করে ভুল Subject-এ ফেলার চেয়ে GK-তে ফেলে raw subject টেক্সট রাখা
   নিরাপদ — admin পরে ঠিক করে নিতে পারবে)। ── */
function detectTabForSubject(subjectText){
  const s=norm(subjectText||"");
  if(!s) return{tabKey:"gk"};
  if(s.includes("গণিত")||s.includes("math")) return{tabKey:"math"};
  const isLit=s.includes("সাহিত্য")||s.includes("literature");
  if(s.includes("বাংলা")||s.includes("bangla")||s.includes("bengali")){
    return{tabKey:"bangla",subjectChoice:isLit?"literature":"grammar"};
  }
  if(s.includes("english")||s.includes("ইংরেজি")){
    return{tabKey:"english",subjectChoice:isLit?"literature":"grammar"};
  }
  return{tabKey:"gk"};
}

/* ── group.topic-কে বিদ্যমান Topic-লিস্টের সাথে fuzzy ম্যাচ করে {id,name} রিটার্ন
   করে — ম্যাচ না পেলে raw টেক্সট (id ফাঁকা, নতুন হিসেবে তৈরি হবে)। ── */
function resolveTopicSel(topicText,options){
  const raw=(topicText||"").trim();
  if(!raw) return{id:"",name:""};
  const match=bestTopicMatchForHeading(raw,options||[]);
  return match?{id:match.id,name:match.name}:{id:"",name:raw};
}

/**
 * ocrGroupsToPaper(groups, {refData}) → paper shape ({bangla,english,math,gk})
 * groups: [{subject,heading,topic,formatStyle?,items:[{q,a}]}]
 * refData: PaperComposer-এ যেই refData ব্যবহার হয় (subjects/topics লিস্ট) — Topic
 *   fuzzy-ম্যাচের জন্য দরকার। না দিলে সব Topic raw টেক্সট হিসেবেই বসবে (ম্যাচ
 *   করার চেষ্টা হবে না, কিন্তু ভাঙবে না — refData আসতে দেরি হলেও কাজ চলবে)।
 */
function ocrGroupsToPaper(groups,{refData}={}){
  const paper={bangla:[],english:[],math:[],gk:[]};
  const subjectOptions=refData?(refData.subjects||[]).map(s=>({id:s.subject_id,name:s.subject_name})):[];

  (groups||[]).forEach(g=>{
    if(!g||!Array.isArray(g.items)||!g.items.length) return;
    const validItems=g.items.filter(it=>(it.q||it.question||"").toString().trim());
    if(!validItems.length) return;
    const det=detectTabForSubject(g.subject);
    const tabDef=PAPER_TABS.find(t=>t.key===det.tabKey);
    const heading=(g.heading||"").toString().trim();

    if(tabDef.grouped){
      // ── বাংলা/ইংরেজি — একটা গ্রুপ কার্ড, সাব-পার্ট আকারে সব item ──
      const subjIds=tabDef.subjectChoices
        .map(c=>subjectOptions.find(s=>norm(s.name)===norm(c.name))?.id)
        .filter(Boolean);
      const topicOptions=refData?mergedTopicOptionsFor(refData,subjIds):[];
      const topicSel=resolveTopicSel(g.topic,topicOptions);
      const card={
        ...newGroupCard(),
        heading,
        formatStyle:["plain","table","highlight","fillblank"].includes(g.formatStyle)?g.formatStyle:"plain",
        subjectChoice:det.subjectChoice||"grammar",
        topicSel,
        items:validItems.map(it=>({
          ...newPaperItem(),
          question:(it.q||it.question||"").toString().trim(),
          answer:(it.a||it.answer||"").toString().trim(),
        })),
      };
      paper[det.tabKey].push(card);
    } else {
      // ── গণিত/GK — গ্রুপ না, প্রতিটা item আলাদা flat কার্ড; হেডিং থাকলে
      // প্রশ্নের শুরুতে জুড়ে দেওয়া হয় (প্রসঙ্গ হারিয়ে না যায়) ──
      const isGk=det.tabKey==="gk";
      // GK-তে subject ফ্রি-টেক্সট ফিল্ড (fuzzy টপিক-ম্যাচের জন্য subjectId লাগবে
      // শুধু তখনই যদি refData-তে ওই subject আগে থেকে থাকে)
      const gkSubjId=isGk?subjectOptions.find(s=>norm(s.name)===norm(g.subject||""))?.id:null;
      const flatTopicOptions=refData
        ?(isGk
            ?(gkSubjId?(refData.topics||[]).filter(t=>t.subject_id===gkSubjId).map(t=>({id:t.topic_id,name:t.topic_name})):[])
            :(refData.topics||[]).filter(t=>{
                const mathSubjId=subjectOptions.find(s=>norm(s.name)===norm("গণিত"))?.id;
                return mathSubjId&&t.subject_id===mathSubjId;
              }).map(t=>({id:t.topic_id,name:t.topic_name})))
        :[];
      const topicSel=resolveTopicSel(g.topic,flatTopicOptions);
      validItems.forEach(it=>{
        const qRaw=(it.q||it.question||"").toString().trim();
        const q=heading?`${heading} ${qRaw}`.trim():qRaw;
        const card={
          ...newFlatCard(isGk),
          question:q,
          answer:(it.a||it.answer||"").toString().trim(),
          topicSel:{...topicSel}, // প্রতিটা কার্ডের নিজস্ব কপি (একই object শেয়ার না করাই ভালো)
          ...(isGk?{subjectSel:{id:gkSubjId||"",name:(g.subject||"").toString().trim()}}:{}),
        };
        paper[det.tabKey].push(card);
      });
    }
  });

  return paper;
}

export { ocrGroupsToPaper, detectTabForSubject, resolveTopicSel };
