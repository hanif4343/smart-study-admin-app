/* ══════════ QBANK→QUIZ CONVERTER — shared config/taxonomy ══════════ */

const LS_QBC_TAXONOMY   = "qbank_conv_taxonomy_v1";
const LS_QBC_GAS_SECRET = "qbank_conv_gas_secret_v1";
const LS_QBC_RESULTS_DRAFT = "qbank_conv_results_draft_v1"; // AI-generated results draft — app বন্ধ/ক্র্যাশ হলেও যেন কাজ না হারায়
// ⚡ এই ট্যাবের নিজস্ব Save Location + Auto-save প্রেফারেন্স — অন্য ট্যাবগুলোর শেয়ার্ড
// loadSaveLocPref (default "firebase") থেকে ইচ্ছাকৃতভাবে আলাদা রাখা হয়েছে, যাতে
// QBank→Quiz-এ ডিফল্ট সবসময় Google Sheet-ই থাকে (approval তো এমনিতেই অটো হয়ে যায়)।
const LS_QBC_SAVELOC  = "qbank_conv_saveloc_v1";   // "sheet" | "firebase" — ডিফল্ট "sheet"
const LS_QBC_AUTOSAVE = "qbank_conv_autosave_v1";  // "1" | "0" — ডিফল্ট চালু
function loadQbcSaveLoc(){ try{ return localStorage.getItem(LS_QBC_SAVELOC)||"sheet"; }catch{ return "sheet"; } }
function saveQbcSaveLoc(v){ try{ localStorage.setItem(LS_QBC_SAVELOC,v); }catch{} }
function loadQbcAutoSave(){ try{ return localStorage.getItem(LS_QBC_AUTOSAVE)!=="0"; }catch{ return true; } }
function saveQbcAutoSave(v){ try{ localStorage.setItem(LS_QBC_AUTOSAVE,v?"1":"0"); }catch{} }

// ডিফল্ট canonical taxonomy — AI এই তালিকা থেকেই subject/sub_topic বাছবে।
// প্রয়োজনে অ্যাডমিন UI থেকেই (নিচের "Taxonomy" এডিটর) এটা বদলানো যাবে, rebuild লাগবে না।
const QBANK_CONV_TAXONOMY_DEFAULT = {
  "✍️ বাংলা ব্যাকরণ": ["কারক","সমাস","সন্ধি","উপসর্গ","বাগধারা","এক কথায় প্রকাশ","প্রকৃতি ও প্রত্যয়","ধ্বনি পরিবর্তন","বাক্যের ধরণ","বানান শুদ্ধিকরণ","যতিচিহ্ন","বিপরীত শব্দ","সমার্থক শব্দ","পরিভাষা","বাক্য","ধ্বনি"],
  "📖 English Grammar": ["Verb","Article","Preposition","Tense","Voice","Narration","Number & Gender","Synonym-Antonym","Sentence Correction","Translation"],
  "🇧🇩 বাংলাদেশ বিষয়াবলি": ["মুক্তিযুদ্ধ","সংবিধান","ভূগোল ও পরিবেশ","অর্থনীতি","ইতিহাস ও ঐতিহ্য","প্রশাসনিক কাঠামো","সাধারণ জ্ঞান"],
  "🌍 আন্তর্জাতিক": ["আন্তর্জাতিক সংস্থা","বিশ্ব ইতিহাস","বিশ্ব ভূগোল","চুক্তি ও সম্মেলন"],
  "\u200b📚 বাংলা সাহিত্য": ["কাজী নজরুল ইসলাম","রবীন্দ্রনাথ ঠাকুর","অন্যান্য সাহিত্যিক","সাহিত্যকর্ম"],
  "📟 পাটিগণিত": ["গড়","শতকরা","সুদকষা","লাভ-ক্ষতি","অনুপাত-সমানুপাত","ঐকিক নিয়ম","সংখ্যা পদ্ধতি"],
  "📐জ্যামিতি": ["ক্ষেত্রফল","পরিসীমা","কোণ","ত্রিভুজ","বৃত্ত"],
  "💻 কম্পিউটার": ["হার্ডওয়্যার","সফটওয়্যার","ইন্টারনেট","MS Office","শর্টকাট"],
};

// প্রশ্নের টেক্সট normalize করে — whitespace/যতিচিহ্ন বাদ দিয়ে ডুপ্লিকেট মেলানোর জন্য
function normalizeQbankQ(s){
  return (s||"").toString().replace(/[\s.,;:।?!—–\-()'"]/g,"").trim();
}


export { LS_QBC_TAXONOMY, LS_QBC_GAS_SECRET, LS_QBC_RESULTS_DRAFT, LS_QBC_SAVELOC, LS_QBC_AUTOSAVE, loadQbcSaveLoc, saveQbcSaveLoc, loadQbcAutoSave, saveQbcAutoSave, QBANK_CONV_TAXONOMY_DEFAULT, normalizeQbankQ };
