/* ══════════ লিখিত (Written) প্রশ্নপত্রের হেডিং-টেমপ্লেট ══════════
   প্রতিটা "প্রশ্ন নম্বর"-এ কোন হেডিং/ফরম্যাট আসবে তার কোনো গ্যারান্টি নেই (১ নম্বরে বাগধারার
   বদলে এক কথায় প্রকাশও আসতে পারে) — তাই PaperComposer-এর প্রতিটা কার্ডের হেডিং-লাইনে
   "Expand" বাটন আছে, যেখানে এই লিস্ট সিরিয়ালে দেখায়; বাছলেই হেডিং + ফরম্যাট (লেআউট) বদলায়।
   ডেটা-মডেল অপরিবর্তিত: প্রতিটা সাব-পার্ট = question + answer (+ explanation/technique,
   MCQ হলে opt1-4) — তাই GAS/buildSheetRow-এ কোনো বদল লাগে না।
   lay: tbl (টেবিল, কলাম-হেডার আছে) | pair (ক) বাম = ডান) | stack (দুই লাইন) | mcq (Options+Answer) | cloze (শব্দ-বক্স+অনুচ্ছেদ)
   third: তৃতীয় ঘর — item.explanation-এ সেভ হয় (বাগধারার বাক্যে প্রয়োগ / সমাসের নাম) ══════════ */
export const RO=["i","ii","iii","iv","v","vi","vii","viii","ix","x","xi","xii","xiii","xiv","xv","xvi","xvii","xviii","xix","xx"];

export const PAPER_TEMPLATES={
  bangla:[
    {key:"idiom",  title:"বাগধারা",                      heading:"বাগধারা:",                       fmt:"plain",     lay:"pair",  sep:"=", third:{field:"explanation",pre:"বাক্য:"}},
    {key:"sandhi", title:"সন্ধি বিচ্ছেদ করুন",            heading:"সন্ধি বিচ্ছেদ করুন:",             fmt:"table",     lay:"tbl",   cols:["প্রদত্ত শব্দ","সন্ধি বিচ্ছেদ"]},
    {key:"anto",   title:"বিপরীত শব্দ",                   heading:"বিপরীত শব্দ:",                   fmt:"table",     lay:"tbl",   cols:["প্রদত্ত শব্দ","বিপরীত শব্দ"]},
    {key:"oneword",title:"এক কথায় প্রকাশ",               heading:"এক কথায় প্রকাশ:",               fmt:"plain",     lay:"pair",  sep:"="},
    {key:"spell",  title:"বানান শুদ্ধিকরণ",               heading:"বানান শুদ্ধিকরণ:",               fmt:"table",     lay:"tbl",   cols:["ভুল বানান","শুদ্ধ বানান"]},
    {key:"karak",  title:"কারক ও বিভক্তি নির্ণয় করুন",    heading:"কারক ও বিভক্তি নির্ণয় করুন:",    fmt:"highlight", lay:"pair",  sep:"-"},
    {key:"sentfix",title:"বাক্য শুদ্ধ করে লিখুন",          heading:"বাক্য শুদ্ধ করে লিখুন:",          fmt:"plain",     lay:"stack", pre:"সঠিক-"},
    {key:"samas",  title:"ব্যাসবাক্যসহ সমাস নির্ণয় কর",    heading:"ব্যাসবাক্যসহ সমাস নির্ণয় কর:",    fmt:"highlight", lay:"pair",  sep:"-", third:{field:"explanation",pre:"(",suf:")"}},
    {key:"short",  title:"সংক্ষিপ্ত প্রশ্নের উত্তর দাও",    heading:"সংক্ষিপ্ত প্রশ্নের উত্তর দাও:",    fmt:"plain",     lay:"stack", pre:"উত্তর:"},
  ],
  english:[
    {key:"cloze",  title:"Fill in the blanks (word box + passage)", heading:"Fill in the blanks with appropriate word given below:", fmt:"plain", lay:"cloze"},
    {key:"replace",title:"Replace the bracketed wrong word",        heading:"Replace the bracketed wrong word from the options:",   fmt:"plain", lay:"mcq", mcq:true},
    {key:"choose", title:"Choose the correct word",                 heading:"Choose the correct word from the options:",            fmt:"plain", lay:"mcq", mcq:true},
  ],
};
export const CUSTOM_TPL={key:"custom",title:"✍️ নিজে হেডিং লিখব (Custom)",heading:"",fmt:"plain",lay:"stack",custom:true};
export const tplListFor=tab=>PAPER_TEMPLATES[tab]||[];
const nh=s=>String(s||"").replace(/[:：।\s]+$/g,"").replace(/\s+/g," ").trim().toLowerCase();
// কার্ডের tplKey থাকলে সেটাই; না থাকলে (পুরোনো ড্রাফট/OCR ইম্পোর্ট) হেডিং মিলিয়ে বের করা; না মিললে Custom।
export function resolveTpl(card,tab){
  const list=tplListFor(tab);
  if(card&&card.tplKey==="custom") return CUSTOM_TPL;
  if(card&&card.tplKey){ const t=list.find(x=>x.key===card.tplKey); if(t) return t; }
  const h=nh(card&&card.heading);
  if(h){ const t=list.find(x=>nh(x.heading)===h); if(t) return t; }
  return CUSTOM_TPL;
}
// সেভের সময় গ্রুপ-হেডিং: cloze হলে নির্দেশনা + শব্দ-বক্স + অনুচ্ছেদ একসাথে (ইউজার-অ্যাপে হেডিং-এর অংশ হিসেবে দেখায়)
export function cardHeadingText(card,tab){
  const base=String(card.heading||"").trim();
  if(resolveTpl(card,tab).key!=="cloze") return base;
  const words=(card.wordBox||[]).map(w=>String(w).trim()).filter(Boolean).join("  |  ");
  const passage=String(card.passage||"").trim();
  return [base,words,passage].filter(Boolean).join("\n");
}
