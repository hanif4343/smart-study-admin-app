/* ── OCR ক্যাশ — একই ছবি আবার OCR করতে হলে native call এড়িয়ে সরাসরি আগের ফলাফল দেয় ── */
import { LS_OCR_CACHE, OCR_CACHE_MAX } from "./uploaderUtils.js";

function _b64Hash(b64){
  // দ্রুত non-crypto hash — পুরো base64 string না পড়ে sample নিয়ে যথেষ্ট ইউনিক key বানায়
  let h=0; const len=b64.length, step=Math.max(1,Math.floor(len/512));
  for(let i=0;i<len;i+=step){ h=(h*31 + b64.charCodeAt(i))|0; }
  return `${len}_${h}`;
}
function loadOcrCache(){ try{ return JSON.parse(localStorage.getItem(LS_OCR_CACHE)||"{}"); }catch{ return{}; } }
function getOcrCacheEntry(b64,qtype){ return loadOcrCache()[`${_b64Hash(b64)}_${qtype}`]||null; }
function setOcrCacheEntry(b64,qtype,result){
  try{
    const cache=loadOcrCache();
    const key=`${_b64Hash(b64)}_${qtype}`;
    cache[key]=result;
    const keys=Object.keys(cache);
    if(keys.length>OCR_CACHE_MAX) keys.slice(0,keys.length-OCR_CACHE_MAX).forEach(k=>delete cache[k]);
    localStorage.setItem(LS_OCR_CACHE,JSON.stringify(cache));
  }catch{}
}
function clearOcrCache(){ try{ localStorage.removeItem(LS_OCR_CACHE); }catch{} }

export { getOcrCacheEntry, setOcrCacheEntry, clearOcrCache };
