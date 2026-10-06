/* ══════════ REFERENCE DATA CACHE (Subjects / Topics / Tags / Posts / Institutions) ══════════
   সমস্যা: প্রতিবার পেজ খুললেই GAS getReferenceData কল হতো — নেট slow হলে Audience Tag,
   Subject, Topic, Post, Institution কিছুই আসত না ("লোড হচ্ছে" / ⏳ আটকে থাকত)।

   সমাধান (stale-while-revalidate):
   • সর্বশেষ সফল রেফারেন্স ডেটা localStorage-এ থাকে (অ্যাপ বন্ধ করে খুললেও থাকে)।
   • পেজ খুললেই cache থেকে সঙ্গে সঙ্গে দেখায় — নেটের জন্য অপেক্ষা নেই।
   • পিছনে চুপচাপ নতুন ডেটা আনে; কিছু বদলালে সব পেজ নিজে থেকে আপডেট হয়।
   • নেট কম/নেই হলে cache দিয়েই কাজ চলে (entry দেওয়া যায়)।
   এই ফাইলে অন্য কোনো core ফাইল import নেই (circular import এড়াতে)। */

const LS_KEY = "ss_ref_cache_v1";

let _mem = null;      // { data, ts }
let _memJson = "";    // change-detect এর জন্য
const _subs = new Set();

function _readLS(){
  try{
    const raw = localStorage.getItem(LS_KEY);
    if(!raw) return null;
    const obj = JSON.parse(raw);
    if(obj && obj.data && typeof obj.data === "object") return obj;
  }catch(_){}
  return null;
}

/* সিঙ্ক্রোনাস — useState(getCachedReferenceData) এ সরাসরি দেওয়া যায় */
function getCachedReferenceData(){
  if(!_mem){
    const o = _readLS();
    if(o){ _mem = o; _memJson = JSON.stringify(o.data); }
  }
  return _mem ? _mem.data : null;
}

function getRefCacheTs(){ getCachedReferenceData(); return _mem ? _mem.ts : 0; }

/* নতুন ডেটা বসাও। আগের সাথে একই হলে subscriber-দের জানানো হয় না (অকারণ re-render নেই) */
function setCachedReferenceData(data){
  if(!data || typeof data !== "object") return;
  const json = JSON.stringify(data);
  const changed = json !== _memJson;
  _mem = { data, ts: Date.now() };
  _memJson = json;
  try{ localStorage.setItem(LS_KEY, JSON.stringify(_mem)); }catch(_){}
  if(changed) _subs.forEach(fn=>{ try{ fn(data); }catch(_){} });
}

function clearReferenceCache(){
  _mem = null; _memJson = "";
  try{ localStorage.removeItem(LS_KEY); }catch(_){}
}

function subscribeReferenceData(fn){
  _subs.add(fn);
  return ()=>_subs.delete(fn);
}

export { getCachedReferenceData, setCachedReferenceData, clearReferenceCache, subscribeReferenceData, getRefCacheTs };
