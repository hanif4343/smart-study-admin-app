/* ══════════ QBANK→QUIZ CONVERTER — shared config/taxonomy ══════════ */

const LS_QBC_TAXONOMY   = "qbank_conv_taxonomy_v1";
const LS_QBC_GAS_SECRET = "qbank_conv_gas_secret_v1";
const LS_QBC_RESULTS_DRAFT = "qbank_conv_results_draft_v1"; // AI-generated results draft — app বন্ধ/ক্র্যাশ হলেও যেন কাজ না হারায়
// ⚡ এই ট্যাবের নিজস্ব Save Location + Auto-save প্রেফারেন্স — অন্য ট্যাবগুলোর শেয়ার্ড
// loadSaveLocPref (default "firebase") থেকে ইচ্ছাকৃতভাবে আলাদা রাখা হয়েছে, যাতে
// QBank→Quiz-এ ডিফল্ট সবসময় Google Sheet-ই থাকে (approval তো এমনিতেই অটো হয়ে যায়)।
const LS_QBC_SAVELOC  = "qbank_conv_saveloc_v1";   // "sheet" | "firebase" — ডিফল্ট "sheet"
const LS_QBC_AUTOSAVE = "qbank_conv_autosave_v1";  // "1" | "0" — ডিফল্ট চালু
// NO-FIREBASE POLICY: Quiz এখন সবসময় Sheet-এ যায়, পুরনো "firebase" প্রেফারেন্স উপেক্ষা করা হয়।
function loadQbcSaveLoc(){ return "sheet"; }
function saveQbcSaveLoc(v){ try{ localStorage.setItem(LS_QBC_SAVELOC,v); }catch{} }
function loadQbcAutoSave(){ try{ return localStorage.getItem(LS_QBC_AUTOSAVE)!=="0"; }catch{ return true; } }
function saveQbcAutoSave(v){ try{ localStorage.setItem(LS_QBC_AUTOSAVE,v?"1":"0"); }catch{} }

// ডিফল্ট canonical taxonomy — AI এই তালিকা থেকেই subject/sub_topic বাছবে।
// প্রয়োজনে অ্যাডমিন UI থেকেই (নিচের "Taxonomy" এডিটর) এটা বদলানো যাবে, rebuild লাগবে না।
// 🐛 ফিক্স: আগে "📚 বাংলা সাহিত্য"-এর আগে একটা invisible zero-width space (\u200b) বসানো ছিল,
// আর "📐জ্যামিতি"-তে emoji-র পর স্পেস ছিল না — AI এই invisible/inconsistent ফরম্যাট
// হুবহু reproduce করতে না পারায় Quiz sheet-এ একই subject বারবার ভিন্ন ভ্যারিয়েন্টে
// সেভ হতো (এটাই "সাবজেক্ট নাম বারবার ভুল হওয়া" সমস্যার মূল কারণগুলোর একটা)।
const QBANK_CONV_TAXONOMY_DEFAULT = {
  "✍️ বাংলা ব্যাকরণ": ["কারক","সমাস","সন্ধি","উপসর্গ","বাগধারা","এক কথায় প্রকাশ","প্রকৃতি ও প্রত্যয়","ধ্বনি পরিবর্তন","বাক্যের ধরণ","বানান শুদ্ধিকরণ","যতিচিহ্ন","বিপরীত শব্দ","সমার্থক শব্দ","পরিভাষা","বাক্য","ধ্বনি"],
  "📖 English Grammar": ["Verb","Article","Preposition","Tense","Voice","Narration","Number & Gender","Synonym-Antonym","Sentence Correction","Translation"],
  "🇧🇩 বাংলাদেশ বিষয়াবলি": ["মুক্তিযুদ্ধ","সংবিধান","ভূগোল ও পরিবেশ","অর্থনীতি","ইতিহাস ও ঐতিহ্য","প্রশাসনিক কাঠামো","সাধারণ জ্ঞান"],
  "🌍 আন্তর্জাতিক": ["আন্তর্জাতিক সংস্থা","বিশ্ব ইতিহাস","বিশ্ব ভূগোল","চুক্তি ও সম্মেলন"],
  "📚 বাংলা সাহিত্য": ["কাজী নজরুল ইসলাম","রবীন্দ্রনাথ ঠাকুর","অন্যান্য সাহিত্যিক","সাহিত্যকর্ম"],
  "📟 পাটিগণিত": ["গড়","শতকরা","সুদকষা","লাভ-ক্ষতি","অনুপাত-সমানুপাত","ঐকিক নিয়ম","সংখ্যা পদ্ধতি"],
  "📐 জ্যামিতি": ["ক্ষেত্রফল","পরিসীমা","কোণ","ত্রিভুজ","বৃত্ত"],
  "💻 কম্পিউটার": ["হার্ডওয়্যার","সফটওয়্যার","ইন্টারনেট","MS Office","শর্টকাট"],
};

// প্রশ্নের টেক্সট normalize করে — whitespace/যতিচিহ্ন বাদ দিয়ে ডুপ্লিকেট মেলানোর জন্য
function normalizeQbankQ(s){
  return (s||"").toString().replace(/[\s.,;:।?!—–\-()'"]/g,"").trim();
}

// ── subject/sub_topic-এর মতো লেবেল normalize করে — শুধু invisible zero-width
// char (\u200b\u200c\u200d\uFEFF, nbsp) বাদ দেয় আর extra whitespace collapse করে,
// visible টেক্সট/emoji অক্ষত রাখে। এটা GAS-এর renameField action-এর normalize
// লজিকের সাথে হুবহু মেলানো — RenameTab-এ visually-identical কিন্তু invisible-char-এ
// আলাদা ভ্যারিয়েন্টগুলো এক গ্রুপে দেখানোর জন্য ব্যবহার হয়।
function normalizeLabel(s){
  return (s||"").toString()
    .replace(/[\u200B\u200C\u200D\uFEFF\u00A0]/g,"")
    .replace(/\s+/g," ")
    .trim();
}

// ── 🐛 ফিক্স (Issue #2): AI মাঝেমধ্যে হার্ডকোড taxonomy-র emoji-decorated নাম
// ("✍️ বাংলা ব্যাকরণ") হুবহু ফেরত দিয়ে দিতো, যেটা সরাসরি subject কলামে বসে যেত।
// এই ফাংশন সাবজেক্ট/টপিক নাম থেকে emoji + variation selector + zero-width জাতীয়
// অদৃশ্য ক্যারেক্টার ছেঁটে বিশুদ্ধ টেক্সট রাখে — Reference টেবিলে সেভ হওয়ার আগে
// সবসময় এটা দিয়ে পাস করানো হয়, তাই AI যা-ই ফেরত দিক, sheet-এ emoji কখনো যায় না।
function stripEmoji(s){
  return (s||"").toString()
    .replace(/[\u{1F000}-\u{1FFFF}\u{2190}-\u{2BFF}\u{2600}-\u{27BF}\uFE0F\u200D]/gu,"")
    .replace(/[\u200B\u200C\u200D\uFEFF\u00A0]/g,"")
    .replace(/\s+/g," ")
    .trim();
}

// ── 🐛 ফিক্স (Issue #2): AI-কে দেওয়া "canonical taxonomy" আগে ছিল একটা হাতে-লেখা
// স্ট্যাটিক লিস্ট (emoji সহ), যেটার সাথে আসল Subjects/Topics reference টেবিলের কোনো
// সম্পর্কই ছিল না — তাই AI-এর দেওয়া নাম কখনোই refData-র subject_name-এর সাথে হুবহু
// মিলত না, subject_id/topic_id ফাঁকা থেকে যেত। এই ফাংশন লাইভ refData (Subjects/Topics
// শিট, Quiz-স্কোপড) থেকেই taxonomy বানায় — তাই AI যা বাছবে সেটা গ্যারান্টিড ভাবে
// ইতিমধ্যে বিদ্যমান, বিশুদ্ধ (no emoji) subject/topic নাম, এবং matchSubjectTopicId-এ
// হুবহু মিলে যাবে। refData না থাকলে বা কোনো Quiz subject না থাকলে পুরনো ডিফল্টে fallback করে। ──
function buildTaxonomyFromRefData(refData){
  if(!refData||!(refData.subjects||[]).length) return null;
  const out={};
  (refData.subjects||[]).filter(s=>s.sheet==="Quiz").forEach(s=>{
    const topics=(refData.topics||[]).filter(t=>t.subject_id===s.subject_id).map(t=>stripEmoji(t.topic_name)).filter(Boolean);
    out[stripEmoji(s.subject_name)]=topics.length?topics:["সাধারণ"];
  });
  return Object.keys(out).length?out:null;
}

export { LS_QBC_TAXONOMY, LS_QBC_GAS_SECRET, LS_QBC_RESULTS_DRAFT, LS_QBC_SAVELOC, LS_QBC_AUTOSAVE, loadQbcSaveLoc, saveQbcSaveLoc, loadQbcAutoSave, saveQbcAutoSave, QBANK_CONV_TAXONOMY_DEFAULT, normalizeQbankQ, normalizeLabel, stripEmoji, buildTaxonomyFromRefData };
