/* ══════════ HELPERS ══════════ */
import { IMGBB } from "./config.js";

const fmt=n=>(n||0).toLocaleString();
const pct=(a,b)=>b?Math.round(a/b*100):0;
const initials=n=>(n||"?").split(" ").map(w=>w[0]).join("").toUpperCase().slice(0,2);
const nowTs=()=>new Date().toLocaleString("bn-BD",{timeZone:"Asia/Dhaka"});
const timeAgo=ts=>{
  if(!ts)return"—";
  try{
    const d=new Date(ts.replace?ts.replace(/(\d{2})-(\d{2})-(\d{4})/,"$3-$2-$1"):ts);
    const s=Date.now()-d.getTime();
    if(s<60000)return"এখনই";
    if(s<3600000)return~~(s/60000)+"মি আগে";
    if(s<86400000)return~~(s/3600000)+"ঘণ্টা আগে";
    return~~(s/86400000)+"দিন আগে";
  }catch{return ts;}
};
const toArr=raw=>{
  if(!raw)return[];
  // IMPORTANT: never treat as plain array — Firebase numeric keys lose _fbKey
  // Convert array to indexed object so _fbKey is always set
  if(Array.isArray(raw)){
    return raw.map((v,i)=>v&&typeof v==="object"?{...v,_fbKey:String(i)}:null).filter(Boolean);
  }
  return Object.entries(raw).map(([k,v])=>v&&typeof v==="object"?{...v,_fbKey:k}:null).filter(Boolean);
};
const phoneKey=ph=>(ph||"").replace(/^'+/,"").trim().replace(/[.#$\[\]\s]/g,"_");
const matchPhone=(key,phone)=>{
  const k=key.replace(/_/g,"");
  const p=(phone||"").replace(/[.#$\[\]\s]/g,"");
  return k===p||k===p.replace(/^0+/,"")||k.replace(/^0+/,"")===p.replace(/^0+/,"");
};
const uploadImg=async file=>{
  const fd=new FormData();fd.append("image",file);
  const r=await fetch(`https://api.imgbb.com/1/upload?key=${IMGBB}`,{method:"POST",body:fd});
  return(await r.json())?.data?.url||"";
};
/* ── OCR-এর সময় স্ক্যান করা পাতার ছবিটা imgbb-তে আপলোড করে সেই লিংক পাওয়ার জন্য
   (Question Paper কলাম — টেক্সট আকারে প্রশ্ন থাকার পাশাপাশি আসল ছবিও যেন থাকে,
   পরে ইউজার অ্যাপ এই লিংক দিয়ে মূল প্রশ্নপত্রের পাতা দেখাতে পারবে)।
   src হতে পারে: blob: URL, capacitor file src, অথবা data:...;base64 URL — যেকোনোটা
   থেকেই fetch() দিয়ে raw bytes বের করে সরাসরি imgbb-তে ফাইল হিসেবে আপলোড করা হয়
   (মাঝখানে base64 string বানানোর দরকার নেই, তাই মেমরি সাশ্রয়ী)। */
const uploadImageSrcToImgbb=async src=>{
  if(!src)return "";
  try{
    const fetched=await fetch(src);
    const blob=await fetched.blob();
    return await uploadImg(blob);
  }catch(e){ return ""; } // একটা পাতা আপলোড ব্যর্থ হলেও বাকি কাজ যেন থেমে না যায়
};

// Legacy GAS no-ops — backend আর call হয় না, শুধু পুরনো call-site গুলো ভাঙা এড়াতে রাখা
const gasBg  = ()=>{};
const gasPost = ()=>{};
const gasCall = async ()=>({});

// মূলত file-এর অনেক পরে ছিল (TypingUploader অংশে), কিন্তু dataCache.js-সহ অনেক page
// এটা ব্যবহার করে — তাই cross-cutting utility হিসেবে এখানে রাখা হলো।
const LS_GAS_SECRET = "ss_shared_gas_secret_v1";
function loadSharedGasSecret(){
  try{ return localStorage.getItem(LS_GAS_SECRET) || localStorage.getItem("qbank_conv_gas_secret_v1") || ""; }
  catch{ return ""; }
}
function saveSharedGasSecret(v){ try{ localStorage.setItem(LS_GAS_SECRET,v); }catch{} }

function buildSubjectMap(arr){
  const map={};
  for(let i=0;i<arr.length;i++){
    const q=arr[i];
    const sub=(q.Subject||q.subject||"Unknown").trim();
    const typ=(q.QType||q.qtype||"MCQ").toLowerCase();
    const top=(q.Sub_topic||q.sub_topic||"General").trim()||"General";
    const isWr=typ==="written";
    if(!map[sub])map[sub]={total:0,mcq:0,written:0,topics:{}};
    map[sub].total++;if(isWr)map[sub].written++;else map[sub].mcq++;
    if(!map[sub].topics[top])map[sub].topics[top]={total:0,mcq:0,written:0};
    map[sub].topics[top].total++;
    if(isWr)map[sub].topics[top].written++;else map[sub].topics[top].mcq++;
  }
  return map;
}

export { fmt, pct, initials, nowTs, timeAgo, toArr, phoneKey, matchPhone, uploadImg, uploadImageSrcToImgbb, gasBg, gasPost, gasCall, loadSharedGasSecret, saveSharedGasSecret, buildSubjectMap };
