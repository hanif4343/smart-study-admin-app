/* ══════════ HELPERS ══════════ */
import { GAS } from "./config.js";

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
// ── Image/CDN Hosting Phase ── ImgBB সম্পূর্ণ বাদ (আগে এখানে সরাসরি
// api.imgbb.com-এ আপলোড হতো)। এখন GAS-এর "upload_image" action দিয়ে GitHub-এ
// কমিট হয়ে jsDelivr CDN URL ফেরত আসে — GitHub টোকেন কখনো browser-এ থাকে না,
// শুধু GAS-এর Script Properties-এ নিরাপদে থাকে (দেখো code_updated.gs)।
// আপলোডের আগে ক্যানভাস দিয়ে resize+compress এখন বাধ্যতামূলক — শুধু স্পিড/
// স্টোরেজের জন্যই না, GitHub Contents API-র ~1MB ফাইল-সাইজ সীমার কারণেও জরুরি।
async function resizeAndCompressImage(blob, maxDim = 1000, quality = 0.82) {
  try {
    const bitmap = await createImageBitmap(blob);
    let { width, height } = bitmap;
    if (width > maxDim || height > maxDim) {
      const scale = maxDim / Math.max(width, height);
      width = Math.round(width * scale);
      height = Math.round(height * scale);
    }
    const canvas = document.createElement("canvas");
    canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(bitmap, 0, 0, width, height);
    const outBlob = await new Promise(resolve => canvas.toBlob(resolve, "image/jpeg", quality));
    return outBlob || blob; // toBlob ব্যর্থ হলে (খুব পুরনো ব্রাউজার) আসল blob-ই পাঠাও
  } catch (e) {
    console.error("resizeAndCompressImage failed, ব্যবহার হবে আসল ছবি:", e);
    return blob; // resize ব্যর্থ হলেও আপলোড থেমে না গিয়ে আসল ছবিটাই যাক
  }
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(String(reader.result).split(",")[1] || "");
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

// 🆕 ফোনে console দেখার উপায় না থাকলেও যেন আসল এরর মেসেজ জানা যায় — শেষ ব্যর্থ
// uploadImg কলের আসল কারণ এখানে জমা থাকে, getLastUploadError() দিয়ে পড়া যায়
// (দেখো SingleQuestionEntryPage.jsx-এর push("error", ...) কল)।
let _lastUploadError = "";
const getLastUploadError = () => _lastUploadError;

/**
 * @param file আপলোড করার ছবি (File/Blob)
 * @param folder GitHub media রিপোতে subfolder ("questions"/"users"/"attachments") —
 *        না দিলে "questions" ধরা হয় (এই ফাংশনের সবচেয়ে বেশি ব্যবহার প্রশ্নের ছবিতেই)
 */
const uploadImg = async (file, folder = "questions") => {
  if (!GAS) {
    _lastUploadError = "GAS URL সেট করা নেই (VITE_GAS_URL)";
    console.error("uploadImg:", _lastUploadError);
    return "";
  }
  try {
    const compressed = await resizeAndCompressImage(file);
    const base64 = await blobToBase64(compressed);
    const secret = loadSharedGasSecret();
    const fileName = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}.jpg`;
    const r = await fetch(GAS, {
      method: "POST",
      body: JSON.stringify({ secret, type: "upload_image", imageBase64: base64, folder, fileName })
    });
    const j = await r.json().catch(() => null);
    if (j?.status === "success" && j.url) return j.url;
    _lastUploadError = j?.message || `HTTP ${r.status} — GAS থেকে বৈধ JSON রেসপন্স আসেনি`;
    console.error("uploadImg: GAS upload_image ব্যর্থ —", _lastUploadError);
    return "";
  } catch (e) {
    _lastUploadError = (e && e.message) || String(e);
    console.error("uploadImg error:", e);
    return "";
  }
};
/* ── OCR-এর সময় স্ক্যান করা পাতার ছবিটা CDN-এ আপলোড করে সেই লিংক পাওয়ার জন্য
   (Question Paper কলাম — টেক্সট আকারে প্রশ্ন থাকার পাশাপাশি আসল ছবিও যেন থাকে,
   পরে ইউজার অ্যাপ এই লিংক দিয়ে মূল প্রশ্নপত্রের পাতা দেখাতে পারবে)।
   src হতে পারে: blob: URL, capacitor file src, অথবা data:...;base64 URL — যেকোনোটা
   থেকেই fetch() দিয়ে raw bytes বের করে uploadImg()-এ পাঠানো হয়। */
const uploadImageSrcToImgbb=async (src, folder = "questions") => {
  if(!src)return "";
  try{
    const fetched=await fetch(src);
    const blob=await fetched.blob();
    return await uploadImg(blob, folder);
  }catch(e){ console.error("uploadImageSrcToImgbb error:", e); return ""; } // একটা পাতা আপলোড ব্যর্থ হলেও বাকি কাজ যেন থেমে না যায়
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

export { fmt, pct, initials, nowTs, timeAgo, toArr, phoneKey, matchPhone, uploadImg, uploadImageSrcToImgbb, gasBg, gasPost, gasCall, loadSharedGasSecret, saveSharedGasSecret, buildSubjectMap, getLastUploadError };
