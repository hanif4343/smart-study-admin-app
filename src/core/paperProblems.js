/* ══════════ paperProblems.js — প্রশ্নপত্রের সমস্যা খোঁজা + স্মার্ট অটো-ফিক্স ══════════
   🐛 সমস্যা (আগে): সাবমিটে শুধু একটা টোস্ট আসতো — যেমন
   "ইংরেজি ট্যাবে Fill-blank ফরম্যাটে একটা প্রশ্নে মার্ক করা হয়নি" — কিন্তু ঠিক কোন
   কার্ডের কোন প্রশ্ন (ক/খ/গ…) সেটা বলা হতো না; একটার পর একটা করে খুঁজে ঠিক করতে হতো।
   ✅ সমাধান (এই ফাইল):
   1) smartFixPaper(paper)   — সাবমিটের আগে নিজে নিজে যেগুলো নিরাপদে ঠিক করা যায় সেগুলো ঠিক করে:
        • Fill-blank প্রশ্নে `_শব্দ_` মার্ক নেই, কিন্তু Answer লেখা আছে ও সেটা প্রশ্নের ভেতরেই আছে → অটো `_উত্তর_` বসায়
        • প্রশ্নে ফাঁকা-চিহ্ন (____ / ….. / ----) আছে আর Answer লেখা আছে → চিহ্নের জায়গায় `_উত্তর_` বসায়
   2) collectPaperProblems(paper) — বাকি সব সমস্যা একসাথে (শুধু প্রথমটা না) খুঁজে বের করে; প্রতিটার সাথে
        ঠিক কোথায় (tabKey/cardId/itemId/field), মানুষের-পড়ার-মতো লোকেশন, আর (সম্ভব হলে) এক-ট্যাপ ফিক্স।
   এটা পুরোপুরি pure/sync (নেটওয়ার্ক লাগে না) — তাই সাবমিট শুরুর আগেই, এমনকি টাইপ করতে করতেও চালানো যায়। */
import { resolveTpl, parseFillMarks, cardHeadingText } from "./paperTemplates.js";
import { norm } from "./referenceHelpers.js";

const SUBLABELS_BN=["ক","খ","গ","ঘ","ঙ","চ","ছ","জ","ঝ","ঞ","ট","ঠ","ড","ঢ"];
const TAB_LABEL={bangla:"বাংলা",english:"ইংরেজি",math:"গণিত",gk:"GK"};
const GROUPED_TABS=["bangla","english"];

// PaperComposer-এর detectAutoMarkup-এর হুবহু একই নিয়ম (circular import এড়াতে এখানে আলাদা কপি)
function autoMarkup(text){
  const t=text||"";
  const blank=/_([^_]+)_/.exec(t);
  if(blank) return {style:"fillblank",answer:blank[1].trim()};
  const hl=/\*([^*]+)\*/.exec(t);
  if(hl) return {style:"highlight",answer:""};
  return {style:null,answer:""};
}

// RichText ঘরের মান ইনলাইন HTML ট্যাগ (<b>,<u>,<br>) রাখতে পারে — তুলনার জন্য শুধু টেক্সট
const plain=s=>String(s||"").replace(/<br\s*\/?>/gi," ").replace(/<\/?[a-z][^>]*>/gi,"").replace(/&nbsp;/g," ").trim();
const escRe=s=>s.replace(/[.*+?^${}()|[\]\\]/g,"\\$&");
const itemLabel=(tabKey,i)=>tabKey==="english"?String.fromCharCode(97+(i%26))+")":(SUBLABELS_BN[i]||String(i+1))+")";

// ফাঁকা-চিহ্ন: ____ (২+ আন্ডারস্কোর) / …… / ...... / ------ / ––––
const PLACEHOLDER_RE=/_{2,}|…{1,}|\.{3,}|[-–—]{3,}/;

/* একটা প্রশ্ন-টেক্সটে নিরাপদে blank বসানো যায় কি? পারলে নতুন টেক্সট, না পারলে null */
export function tryAutoBlank(question,answer){
  const q=String(question||""), a=plain(answer);
  if(!a) return null;
  // ১) প্রশ্নে ফাঁকা-চিহ্ন আছে → সেটার জায়গায় উত্তর
  const ph=PLACEHOLDER_RE.exec(q);
  if(ph) return q.slice(0,ph.index)+"_"+a+"_"+q.slice(ph.index+ph[0].length);
  // ২) উত্তরটা প্রশ্নের ভেতরেই আছে (পুরো-শব্দ হিসেবে, বড়-ছোট হাতের তফাত ধরা হয় না) → ওই অংশ মার্ক
  const re=new RegExp("(^|[^\\p{L}\\p{N}_])("+escRe(a)+")(?![\\p{L}\\p{N}_])","iu");
  const m=re.exec(q);
  if(m){
    const start=m.index+m[1].length;
    return q.slice(0,start)+"_"+m[2]+"_"+q.slice(start+m[2].length);
  }
  return null;
}

/* ── ১) স্মার্ট অটো-ফিক্স — {paper: নতুন paper, fixed: কয়টা প্রশ্ন ঠিক হলো} ── */
export function smartFixPaper(paper){
  let fixed=0;
  const out={...paper};
  for(const tabKey of GROUPED_TABS){
    const cards=paper[tabKey];
    if(!Array.isArray(cards)) continue;
    out[tabKey]=cards.map(card=>{
      if(!card||!Array.isArray(card.items)) return card;
      const tpl=resolveTpl(card,tabKey);
      const needsBlank=tpl.lay==="fill"||card.formatStyle==="fillblank";
      if(!needsBlank||tpl.key==="cloze"||tpl.key==="plainqa") return card;
      let changed=false;
      const items=card.items.map(it=>{
        if(!it||it.qtype==="mcq"||!String(it.question||"").trim()) return it;
        // আগে থেকেই মার্ক করা আছে (BU বা _শব্দ_) → কিছু করার নেই
        if(tpl.lay==="fill"?parseFillMarks(it.question).answers.length:autoMarkup(it.question).style==="fillblank") return it;
        const nq=tryAutoBlank(it.question,it.answer);
        if(nq&&nq!==it.question){ changed=true; fixed++; return {...it,question:nq}; }
        return it;
      });
      return changed?{...card,items}:card;
    });
  }
  return {paper:fixed?out:paper,fixed};
}

/* ── ২) সব সমস্যা একসাথে ──
   প্রতিটা সমস্যা: { key, tabKey, cardId, itemId|null, field:"question"|"answer"|"topic"|"subject"|"options",
                     message, where, fix? }
   fix (ঐচ্ছিক, এক-ট্যাপ সমাধান): { label, kind:"card-format"|"clear-blank", value } — PaperComposer এটা চালায়। */
export function collectPaperProblems(paper){
  const list=[];
  const add=(p)=>list.push({...p,key:`${p.tabKey}|${p.cardId}|${p.itemId||""}|${p.field}`});

  for(const tabKey of Object.keys(TAB_LABEL)){
    const cards=paper[tabKey]||[];
    const tabLabel=TAB_LABEL[tabKey];
    const grouped=GROUPED_TABS.includes(tabKey);

    cards.forEach((card,ci)=>{
      if(!card) return;
      if(grouped){
        const tpl=resolveTpl(card,tabKey);
        const isCloze=tpl.key==="cloze";
        const items=card.items||[];
        const valid=isCloze
          ? items.map((it,i)=>({it,i})).filter(({it})=>String(it.answer||"").trim())
          : items.map((it,i)=>({it,i})).filter(({it})=>String(it.question||"").trim());
        if(!valid.length) return;   // ফাঁকা কার্ড — সাবমিটে বাদ যায়, সমস্যা না

        const head=(cardHeadingText(card,tabKey)||"").trim();
        const cardWhere=`${tabLabel} ট্যাব › ${ci+1} নং কার্ড${head?` ("${head.length>34?head.slice(0,34)+"…":head}")`:""}`;

        if(!String(card.topicSel&&card.topicSel.name||"").trim()){
          add({tabKey,cardId:card.id,itemId:null,field:"topic",where:cardWhere,
            message:"Topic ফাঁকা — Topic লিখো/বেছে নাও"});
        }

        for(const {it,i} of valid){
          const where=`${cardWhere} › ${itemLabel(tabKey,i)}`;
          if(it.qtype==="mcq"){
            const opts=[it.opt1,it.opt2,it.opt3,it.opt4].map(o=>String(o||"").trim());
            const ans=String(it.answer||"").trim();
            if(opts.some(o=>!o)) add({tabKey,cardId:card.id,itemId:it.id,field:"options",where,message:"MCQ-র ৪টা অপশনের কোনোটা ফাঁকা — 🤖 Generate চাপো বা নিজে পূরণ করো"});
            else if(!ans) add({tabKey,cardId:card.id,itemId:it.id,field:"answer",where,message:"MCQ-র সঠিক উত্তর ফাঁকা"});
            else if(!opts.some(o=>norm(o)===norm(ans))) add({tabKey,cardId:card.id,itemId:it.id,field:"answer",where,message:"সঠিক উত্তর ৪টা অপশনের কোনোটার সাথেই মিলছে না"});
            continue;
          }
          if(tpl.lay==="fill"){
            if(!parseFillMarks(it.question).answers.length){
              add({tabKey,cardId:card.id,itemId:it.id,field:"question",where,
                message:"blank মার্ক করা হয়নি — যে শব্দ blank হবে সেটা সিলেক্ট করে Bold+Underline (BU) দাও, অথবা সরাসরি _শব্দ_ লেখো"});
            }
            continue;
          }
          if(tpl.key==="plainqa"){
            if(!String(it.answer||"").trim()) add({tabKey,cardId:card.id,itemId:it.id,field:"answer",where,message:"উত্তর ফাঁকা — প্রশ্ন ও উত্তর দুটোই লাগবে"});
            continue;
          }
          if(card.formatStyle==="fillblank"&&autoMarkup(it.question).style!=="fillblank"){
            // _শব্দ_ নেই। (smartFixPaper আগেই চেষ্টা করেছে — এখানে এলে অটো সম্ভব হয়নি)
            add({tabKey,cardId:card.id,itemId:it.id,field:"question",where,
              message:"Fill-blank ফরম্যাটে blank মার্ক নেই — যে শব্দ blank হবে সেটা সিলেক্ট করে 🖍 চাপো, অথবা সরাসরি _শব্দ_ লেখো। (এটা Fill-blank না হলে ফরম্যাট Plain করে দাও)",
              fix:{label:"✅ এই কার্ড Plain করো",kind:"card-format",value:"plain"}});
          }
        }
      } else {
        // গণিত / GK (flat)
        if(!String(card.question||"").trim()) return;
        const head=String(card.question).replace(/<[^>]*>/g,"").trim();
        const where=`${tabLabel} ট্যাব › ${ci+1} নং প্রশ্ন${head?` ("${head.length>28?head.slice(0,28)+"…":head}")`:""}`;
        const mathOrGk=tabKey==="math"||tabKey==="gk";
        if(mathOrGk&&!String(card.subjectSel&&card.subjectSel.name||"").trim()){
          add({tabKey,cardId:card.id,itemId:null,field:"subject",where,message:"Subject বাছা হয়নি"});
        }
        if(!String(card.topicSel&&card.topicSel.name||"").trim()){
          add({tabKey,cardId:card.id,itemId:null,field:"topic",where,message:"Topic ফাঁকা"});
        }
        if(card.qtype==="mcq"){
          const opts=[card.opt1,card.opt2,card.opt3,card.opt4].map(o=>String(o||"").trim());
          const ans=String(card.answer||"").trim();
          if(!ans) add({tabKey,cardId:card.id,itemId:null,field:"answer",where,message:"MCQ-র সঠিক উত্তর ফাঁকা"});
          else if(opts.some(o=>!o)) add({tabKey,cardId:card.id,itemId:null,field:"options",where,message:"MCQ-র ৪টা অপশনের কোনোটা ফাঁকা — 🤖 Generate চাপো বা নিজে পূরণ করো"});
          else if(!opts.some(o=>norm(o)===norm(ans))) add({tabKey,cardId:card.id,itemId:null,field:"answer",where,message:"সঠিক উত্তর ৪টা অপশনের কোনোটার সাথেই মিলছে না"});
        } else if(!String(card.answer||"").trim()){
          add({tabKey,cardId:card.id,itemId:null,field:"answer",where,message:"উত্তর ফাঁকা — উত্তর দেওয়া বাধ্যতামূলক (সমাধান ঐচ্ছিক)"});
        }
      }
    });
  }
  return list;
}

/* সুবিধার জন্য: সমস্যার তালিকা থেকে দ্রুত লুকআপ-ম্যাপ */
export function indexProblems(list){
  const byItem={}, byCard={}, byTab={};
  for(const p of list||[]){
    (byTab[p.tabKey]=byTab[p.tabKey]||[]).push(p);
    (byCard[p.cardId]=byCard[p.cardId]||[]).push(p);
    if(p.itemId) (byItem[p.itemId]=byItem[p.itemId]||[]).push(p);
  }
  return {byItem,byCard,byTab};
}
