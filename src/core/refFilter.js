/* ═══════════════════════════════════════════════════════════════
   refFilter.js — Unified Subject/Topic (S01 / S01_T01) এর জন্য সাধারণ helper।
   • আগে subject-এর `sheet` কলাম দিয়ে Quiz/QBank/Study আলাদা করা হতো — এখন
     subject/topic সবার জন্য একটাই তালিকা; আলাদা করা হয় Tag (tag_id / tag_ids) দিয়ে।
   • tag কলামে একাধিক tag কমা দিয়ে থাকে (যেমন "TAG01,TAG02")।
   • row_count (legacy) বিশ্বাসযোগ্য না — sheet-wise row_count_quiz / _qbank / _study ব্যবহার করো।
   ═══════════════════════════════════════════════════════════════ */

const SHEET_KEYS=["quiz","qbank","study"];

function parseTagIds(v){
  return String(v==null?"":v).split(/[,;|]/).map(s=>s.trim()).filter(Boolean);
}

/* item (subject বা topic) selected tagIds-এর কোনো একটাতে পড়ে কিনা।
   tagIds ফাঁকা হলে বা item-এ কোনো tag না থাকলে দেখানো হয় (লুকানো হয় না)। */
function matchesTags(item,tagIds){
  if(!tagIds||!tagIds.length) return true;
  if(!item) return false;
  const raw=(item.tag_ids!=null&&String(item.tag_ids).trim()!=="")?item.tag_ids:item.tag_id;
  const own=parseTagIds(raw);
  if(!own.length) return true;
  return own.some(t=>tagIds.includes(t));
}

function subjectsForTags(refData,tagIds,keepIds){
  const keep=new Set((keepIds||[]).filter(Boolean).map(String));
  return (refData?.subjects||[]).filter(s=>matchesTags(s,tagIds)||keep.has(String(s.subject_id)));
}

function topicsOfSubject(refData,subjectId,tagIds,keepIds){
  const keep=new Set((keepIds||[]).filter(Boolean).map(String));
  return (refData?.topics||[]).filter(t=>String(t.subject_id)===String(subjectId)&&(matchesTags(t,tagIds)||keep.has(String(t.topic_id))));
}

/* একটা topic-এর একটা sheet-এ প্রশ্ন-সংখ্যা (sheet = "Quiz"|"QBank"|"Study") */
function topicCount(t,sheet){
  const n=parseInt(t?.["row_count_"+String(sheet||"").toLowerCase()],10);
  return isNaN(n)?0:n;
}
/* তিন sheet মিলিয়ে মোট */
function topicTotal(t){
  return SHEET_KEYS.reduce((sum,k)=>sum+(parseInt(t?.["row_count_"+k],10)||0),0);
}
function subjectCount(refData,subjectId,sheet){
  return (refData?.topics||[]).filter(t=>String(t.subject_id)===String(subjectId))
    .reduce((s,t)=>s+(sheet?topicCount(t,sheet):topicTotal(t)),0);
}

export{parseTagIds,matchesTags,subjectsForTags,topicsOfSubject,topicCount,topicTotal,subjectCount};
