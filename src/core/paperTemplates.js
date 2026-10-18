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
    {key:"synonym",title:"সমার্থক শব্দ / প্রতিশব্দ লিখুন",     heading:"সমার্থক শব্দ লিখুন:",             fmt:"table",     lay:"tbl",   cols:["প্রদত্ত শব্দ","সমার্থক শব্দ"]},
    {key:"gender", title:"লিঙ্গ পরিবর্তন করুন",           heading:"লিঙ্গ পরিবর্তন করুন:",            fmt:"table",     lay:"tbl",   cols:["প্রদত্ত শব্দ","লিঙ্গ পরিবর্তন"]},
    {key:"oneword",title:"এক কথায় প্রকাশ",               heading:"এক কথায় প্রকাশ:",               fmt:"plain",     lay:"pair",  sep:"="},
    {key:"spell",  title:"বানান শুদ্ধিকরণ",               heading:"বানান শুদ্ধিকরণ:",               fmt:"table",     lay:"tbl",   cols:["ভুল বানান","শুদ্ধ বানান"]},
    {key:"karak",  title:"কারক ও বিভক্তি নির্ণয় করুন",    heading:"কারক ও বিভক্তি নির্ণয় করুন:",    fmt:"highlight", lay:"pair",  sep:"-"},
    {key:"sentfix",title:"বাক্য শুদ্ধ করে লিখুন",          heading:"বাক্য শুদ্ধ করে লিখুন:",          fmt:"plain",     lay:"stack", pre:"সঠিক-"},
    {key:"samas",  title:"ব্যাসবাক্যসহ সমাস নির্ণয় কর",    heading:"ব্যাসবাক্যসহ সমাস নির্ণয় কর:",    fmt:"highlight", lay:"pair",  sep:"-", third:{field:"explanation",pre:"(",suf:")"}},
    {key:"short",  title:"সংক্ষিপ্ত প্রশ্নের উত্তর দাও",    heading:"সংক্ষিপ্ত প্রশ্নের উত্তর দাও:",    fmt:"plain",     lay:"stack", pre:"উত্তর:"},
    // 🆕 সাধারণ প্রশ্ন-উত্তর (পত্র / অনুচ্ছেদ / ভাব-সম্প্রসারণ…): হেডিং নিজে লেখা, প্রশ্ন ও উত্তর দুটোই লাগে, সাব-নম্বর (ক/খ/গ) নেই
    {key:"plainqa",title:"সাধারণ প্রশ্ন-উত্তর (পত্র / অনুচ্ছেদ…) — হেডিং নিজে লিখব", heading:"", fmt:"plainqa", lay:"qa", editableHeading:true, rows:1},
  ],
  english:[
    // 🆕 Fill in the blanks (বাক্য-ভিত্তিক) — দুই ধরন আলাদা: (১) prepositions (২) articles।
    //    বাক্য লিখে যে শব্দ blank হবে সেটা সিলেক্ট করে Bold+Underline (BU) দাও — সেভের সময় সেটাই Answer হয়
    //    (parseFillMarks), প্রশ্নে অ্যাপের আগের fillblank নিয়মেই _শব্দ_ হয়ে যায়।
    {key:"prep",   title:"Fill in the blanks — prepositions",    heading:"Fill in the blanks with appropriate prepositions:", fmt:"fillblank", lay:"fill"},
    {key:"article",title:"Fill in the blanks — articles",        heading:"Fill in the blanks with articles:",                 fmt:"fillblank", lay:"fill"},
    {key:"replace",title:"Replace the bracketed wrong word",        heading:"Replace the bracketed wrong word from the options:",   fmt:"plain", lay:"mcq", mcq:true},
    {key:"choose", title:"Choose the correct word",                 heading:"Choose the correct word from the options:",            fmt:"plain", lay:"mcq", mcq:true},
    {key:"transl", title:"Translate into English",                heading:"Translate into English:",                         fmt:"plain", lay:"stack", pre:"Ans:"},
    {key:"gender_en",title:"Change the Gender",                    heading:"Change the Gender:",                              fmt:"table", lay:"tbl", cols:["Given Word","Opposite Gender"]},
    {key:"plural", title:"Write the plural number",                heading:"Write the plural number:",                        fmt:"table", lay:"tbl", cols:["Singular","Plural"]},
    {key:"meaning",title:"Word Meaning",                           heading:"Word Meaning:",                                   fmt:"table", lay:"tbl", cols:["Word","Meaning"]},
    {key:"syn_en", title:"Write the synonym words",                heading:"Write the synonym words:",                        fmt:"table", lay:"tbl", cols:["Given Word","Synonym"]},
    {key:"wspell", title:"Word Spelling",                          heading:"Word Spelling:",                                  fmt:"table", lay:"tbl", cols:["Wrong Spelling","Correct Spelling"]},
    {key:"makesen",title:"Make a sentence with the following words",heading:"Make a sentence with the following words:",      fmt:"plain", lay:"pair", sep:"=", third:{field:"explanation",pre:"Sentence:"}},
    {key:"idiom_en",title:"Idioms and Phrases",                    heading:"Idioms and Phrases:",                             fmt:"plain", lay:"pair", sep:"=", third:{field:"explanation",pre:"Sentence:"}},
    {key:"transf", title:"Change the sentence as per direction / speech", heading:"Change the sentence as per direction:",    fmt:"plain", lay:"stack", pre:"Ans:"},
    {key:"voice",  title:"Change the voice",                       heading:"Change the voice:",                               fmt:"plain", lay:"stack", pre:"Ans:"},
    {key:"correct",title:"Correct the following sentences",        heading:"Correct the following sentences:",                fmt:"plain", lay:"stack", pre:"Ans:"},
    {key:"para",   title:"Write paragraph",                        heading:"Write paragraph:",                                fmt:"plain", lay:"stack", pre:"Ans:"},
    // 🆕 Plain question & answer (Letter / Paragraph…): নিজের হেডিং, প্রশ্ন ও উত্তর দুটোই লাগে, সাব-নম্বর (a/b/c) নেই
    {key:"plainqa",title:"Plain question & answer (Letter / Paragraph…) — own heading", heading:"", fmt:"plainqa", lay:"qa", editableHeading:true, rows:1},
    {key:"fill",   title:"Fill in the blanks (other)",             heading:"Fill in the blanks:",                             fmt:"fillblank", lay:"fill"},
    {key:"cloze",  title:"Fill in the blanks (word box + passage)", heading:"Fill in the blanks with appropriate word given below:", fmt:"plain", lay:"cloze"},
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

// ── Fill in the blanks (বাক্য-ভিত্তিক) ──
// বাক্যে যে অংশ Bold+Underline (<b><u>..</u></b>, <u><b>..</b></u>, অথবা শুধু <u>..</u>) করা, সেটাই blank/Answer।
// ফেরত: question (মার্ক করা অংশ অ্যাপের fillblank নিয়মে _শব্দ_), answers (মার্ক করা অংশগুলো ক্রমানুযায়ী)
const FILL_RE=/<b>\s*<u>([\s\S]*?)<\/u>\s*<\/b>|<u>\s*<b>([\s\S]*?)<\/b>\s*<\/u>|<u>([\s\S]*?)<\/u>/g;
export function parseFillMarks(text){
  const answers=[];
  const question=String(text||"").replace(FILL_RE,(m,a,b,c)=>{
    const w=String(a??b??c??"").replace(/<\/?[biu]>/g,"").trim();
    if(!w) return m;
    answers.push(w);
    return "_"+w+"_";
  });
  return {question,answers};
}

/* ══════════ হেডিং → Topic অটো-সিলেকশন (শুধু বাংলা ও ইংরেজি; গণিত ও GK-তে নেই) ══════════
   প্রতিটা নিয়মে topic-এর "প্রার্থী নাম" লিস্ট — ডাটাবেজে (refData-র topics) আসলে যেটা আছে সেটাই বসে;
   কোনোটাই না থাকলে ফাঁকা থাকে (ভুল/নতুন Topic তৈরি হয় না)। ক্রম গুরুত্বপূর্ণ — প্রথম মিলটাই নেওয়া হয়। */
const TOPIC_RULES={
  bangla:[
    {re:/বাগ্?ধারা/,                      topics:["বাগধারা","বাগ্ধারা"]},
    {re:/এক\s*কথায়/,                      topics:["এক কথায় প্রকাশ","এক কথায়"]},
    {re:/সন্ধি/,                           topics:["সন্ধি বিচ্ছেদ","সন্ধি"]},
    {re:/কারক|বিভক্তি/,                    topics:["কারক ও বিভক্তি","কারক-বিভক্তি","কারক"]},
    {re:/সমাস|ব্যাসবাক্য/,                  topics:["সমাস"]},
    {re:/বিপরীত/,                          topics:["বিপরীত শব্দ"]},
    {re:/সমার্থক|প্রতিশব্দ/,                topics:["সমার্থক শব্দ","প্রতিশব্দ"]},
    {re:/লিঙ্গ|লিংগ/,                       topics:["লিঙ্গ পরিবর্তন","লিঙ্গ"]},
    {re:/বানান/,                           topics:["বানান শুদ্ধি","বানান শুদ্ধিকরণ","বানান"]},
    {re:/বাক্য\s*শুদ্ধ/,                   topics:["বাক্য শুদ্ধি","বাক্য শুদ্ধিকরণ"]},
    {re:/অনুচ্ছেদ/,                        topics:["অনুচ্ছেদ","অনুচ্ছেদ রচনা"]},
    {re:/ভাব\s*-?\s*সম্প্রসারণ/,            topics:["ভাব-সম্প্রসারণ","ভাবসম্প্রসারণ","ভাব সম্প্রসারণ"]},
    {re:/পত্র|চিঠি|আবেদন/,                 topics:["পত্র","পত্র / আবেদন","পত্র/আবেদন","আবেদনপত্র","চিঠি"]},
    {re:/সারাংশ|সারমর্ম/,                  topics:["সারাংশ","সারমর্ম","সারাংশ/সারমর্ম"]},
    {re:/রচনা/,                            topics:["রচনা"]},
  ],
  english:[
    {re:/voice/i,                                              topics:["Voice Change","Voice"]},
    {re:/translat|বঙ্গানুবাদ|অনুবাদ/i,                          topics:["Translation/বঙ্গানুবাদ","Translation","বঙ্গানুবাদ"]},
    {re:/gender/i,                                             topics:["Gender"]},
    {re:/plural|number/i,                                      topics:["Number"]},
    {re:/word\s*meaning|meaning/i,                             topics:["Word Meaning"]},
    {re:/synonym|antonym|antinym|opposite/i,                   topics:["Antinym-Synonym","Antonym-Synonym","Synonym-Antonym","Synonym & Antonym"], nameRe:/(?:syn|ant)[a-z]*nym/i},
    {re:/make\s+(a\s+)?sentence|idiom|phrase/i,                topics:["Idioms & Phrases","Idioms and Phrases"]},
    {re:/preposition/i,                                        topics:["Preposition"]},
    {re:/\barticle/i,                                          topics:["Article"]},
    {re:/transform|as per direction|speech|narration/i,        topics:["Transformation of sentences","Transformation of Sentence","Transformation"]},
    {re:/paragraph/i,                                          topics:["Paragraph"]},
    {re:/spelling/i,                                           topics:["Spelling","Word Spelling"]},
    {re:/correct the following/i,                              topics:["Correction","Sentence Correction","Correction of Sentences"]},
    {re:/letter|application/i,                                 topics:["Letter","Application","Letter/Application","Letter & Application"]},
    {re:/composition|essay/i,                                  topics:["Composition","Essay"]},
  ],
};
// তুলনার জন্য নাম সমান করা: ছোট হাতের, "&"="and", স্পেস/চিহ্ন বাদ
export const nzTopic=s=>String(s||"").toLowerCase().replace(/&/g,"and").replace(/[^a-z0-9\u0980-\u09FF]+/g,"");
// Levenshtein দূরত্ব (বানান-ভুল সহনশীল ম্যাচের জন্য)
function lev(a,b){
  const m=a.length,n=b.length; if(!m)return n; if(!n)return m;
  let prev=Array.from({length:n+1},(_,j)=>j);
  for(let i=1;i<=m;i++){
    const cur=[i];
    for(let j=1;j<=n;j++) cur[j]=Math.min(prev[j]+1,cur[j-1]+1,prev[j-1]+(a[i-1]===b[j-1]?0:1));
    prev=cur;
  }
  return prev[n];
}
/* ডাটাবেজের topic-লিস্ট (options: [{id,name}]) থেকে প্রার্থী-নামের সবচেয়ে ভালো মিলটা বাছে — বানান ভুল থাকলেও ধরে:
   ১) হুবহু (স্পেস/চিহ্ন/&-and উপেক্ষা)  ২) নিয়মের nameRe  ৩) একটা অন্যটার ভেতরে (≥৫ অক্ষর)
   ৪) অল্প বানান-পার্থক্য (≤১ অক্ষর; ৮+ অক্ষরের নামে ≤২) — যেমন Antinym/Antonym। ডাটাবেজে কিছুই না মিললে null। */
export function pickTopicOption(options,cands,nameRe){
  const list=(options||[]).map(o=>({o,k:nzTopic(o.name)})).filter(x=>x.k);
  const ck=(cands||[]).map(nzTopic).filter(Boolean);
  for(const c of ck){ const h=list.find(x=>x.k===c); if(h) return h.o; }
  if(nameRe){ const h=list.find(x=>nameRe.test(x.o.name)); if(h) return h.o; }
  for(const c of ck){
    if(c.length<5) continue;
    const h=list.find(x=>x.k.length>=5&&(x.k.includes(c)||c.includes(x.k)));
    if(h) return h.o;
  }
  let best=null,bd=99;
  for(const c of ck){
    if(c.length<5) continue;
    const lim=c.length>=8?2:1;
    for(const x of list){ const d=lev(c,x.k); if(d<=lim&&d<bd){ bd=d; best=x.o; } }
  }
  return best;
}
export function topicRuleFromHeading(heading,tab){
  const rules=TOPIC_RULES[tab]; if(!rules) return null;
  const h=String(heading||"").replace(/<\/?[biu]>/g,"").trim();
  return rules.find(r=>r.re.test(h))||null;
}
export function topicCandidatesFromHeading(heading,tab){
  const rules=TOPIC_RULES[tab]; if(!rules) return [];          // math / gk → কিছু না
  const h=String(heading||"").replace(/<\/?[biu]>/g,"").trim();
  const hit=rules.find(r=>r.re.test(h));
  return hit?hit.topics:[];
}
