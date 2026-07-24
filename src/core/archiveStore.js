/* ══════════════════════════════════════════════════════════════════
   ARCHIVE / DRAFT STORE — IndexedDB ভিত্তিক
   ── লক্ষ্য ──
   OCR + AI দিয়ে একবার প্রসেস করা কাজ (রাজ text, parsed প্রশ্ন, subject/tags
   ইত্যাদি) Firebase/Google Sheet-এ সফলভাবে submit না হওয়া পর্যন্ত এখানে
   safe থাকবে। Android background-এ app kill করে দিলে বা ভুলে back করে
   বেরিয়ে গেলেও — app আবার খুললে এখান থেকে ঠিক যেখানে ছিলেন সেখান থেকে
   আবার শুরু করা যাবে, নতুন করে OCR/AI চালাতে হবে না (quota/সময় বাঁচবে)।

   Submit সফল (fully sent, কোনো ব্যর্থ entry নেই) হলে সাথে সাথে draft
   ডিলিট হয়ে যায় — কারণ ডাটা ততক্ষণে ডাটাবেজেই চলে গেছে, আর্কাইভে রাখার
   দরকার নেই।

   localStorage না ব্যবহার করার কারণ: localStorage-এর সাইজ লিমিট (~৫-১০MB)
   অনেক ছবির OCR text + base64 রাখার জন্য যথেষ্ট না। IndexedDB-তে অনেক বড়
   ডাটা নিরাপদে রাখা যায়।
   ══════════════════════════════════════════════════════════════════ */

const DB_NAME    = "ss_archive_db";
const DB_VERSION = 1;
const STORE      = "drafts";

function _openDB(){
  return new Promise((resolve,reject)=>{
    if(!window.indexedDB){ reject(new Error("IndexedDB সাপোর্ট নেই এই ব্রাউজারে")); return; }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if(!db.objectStoreNames.contains(STORE)){
        db.createObjectStore(STORE, {keyPath:"id"});
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

/* ── Draft save/upsert — প্রতিবার অটো-সেভের সময় কল হয় ── */
async function saveDraft(draft){
  if(!draft || !draft.id) return false;
  try{
    const db = await _openDB();
    return await new Promise((resolve,reject)=>{
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put({...draft, updatedAt: Date.now()});
      tx.oncomplete = () => resolve(true);
      tx.onerror    = () => reject(tx.error);
    });
  }catch(e){
    console.warn("archiveStore.saveDraft failed:", e?.message||e);
    return false;
  }
}

async function getDraft(id){
  if(!id) return null;
  try{
    const db = await _openDB();
    return await new Promise((resolve,reject)=>{
      const tx  = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get(id);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror   = () => reject(req.error);
    });
  }catch(e){ return null; }
}

/* ── সব draft বা নির্দিষ্ট source (aiimport/multiimport)-এর draft লিস্ট, নতুনতম আগে ── */
async function listDrafts(source=null){
  try{
    const db = await _openDB();
    return await new Promise((resolve,reject)=>{
      const tx  = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).getAll();
      req.onsuccess = () => {
        let all = req.result || [];
        if(source) all = all.filter(d=>d.source===source);
        all.sort((a,b)=>(b.updatedAt||0)-(a.updatedAt||0));
        resolve(all);
      };
      req.onerror = () => reject(req.error);
    });
  }catch(e){ return []; }
}

async function deleteDraft(id){
  if(!id) return false;
  try{
    const db = await _openDB();
    return await new Promise((resolve,reject)=>{
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).delete(id);
      tx.oncomplete = () => resolve(true);
      tx.onerror    = () => reject(tx.error);
    });
  }catch(e){ return false; }
}

async function deleteAllDrafts(source=null){
  const all = await listDrafts(source);
  for(const d of all) await deleteDraft(d.id);
  return true;
}

function makeDraftId(source){
  return `${source}_${Date.now()}_${Math.floor(Math.random()*9999)}`;
}

export { saveDraft, getDraft, listDrafts, deleteDraft, deleteAllDrafts, makeDraftId };
