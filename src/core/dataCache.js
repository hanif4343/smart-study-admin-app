/* ══════════ SIMPLE FETCH CACHE — no subscriptions, no loops ══════════ */
import { useState, useEffect, useRef } from "react";
import { GAS } from "./config.js";
import { _LC } from "./logger.js";
import { fbGet } from "./firebase.js";
import { loadSharedGasSecret } from "./utils.js";

const STALE  = 90_000; // 90s

/* ── Google Sheet fallback — Firebase read ব্যর্থ হলে (quota শেষ, নেট সমস্যা, ইত্যাদি)
   এই তালিকার top-level sheet-গুলোর জন্য GAS "getSheetRows" অ্যাকশন দিয়ে সরাসরি
   Google Sheet থেকে ডাটা পড়ে — Firebase পুরোপুরি বন্ধ থাকলেও অ্যাপ কাজ চালিয়ে যেতে পারে। ── */
const SHEET_FALLBACK_TABS = ["Quiz","QBank","Study","Typing"];
async function fetchSheetFallback(path){
  const tab=(path||"").split("/")[0];
  if(!SHEET_FALLBACK_TABS.includes(tab) || !GAS) return null;
  try{
    const secret=loadSharedGasSecret();
    const url=`${GAS}?action=getSheetRows&tab=${encodeURIComponent(tab)}&secret=${encodeURIComponent(secret)}`;
    const resp=await fetch(url);
    const data=await resp.json();
    if(data?.status!=="success"||!Array.isArray(data.rows)) return null;
    const out={};
    data.rows.forEach((r,i)=>{ out[r._fbKey||r.id||("row"+i)]=r; });
    _LC.warn?.("fbFallback",`Firebase read ব্যর্থ — ${tab} Google Sheet থেকে fallback হিসেবে লোড হলো (${data.rows.length} রো)`);
    return out;
  }catch(_){ return null; }
}

async function loadPath(path, force=false){
  const now = Date.now();
  const cached = _store[path];
  if(!force && cached && !cached.promise && now - cached.ts < STALE) return cached.data;
  if(cached?.promise) return cached.promise;
  const p = fbGet(path).then(data=>{
    _store[path] = {data, ts:Date.now(), promise:null};
    return data;
  }).catch(async e=>{
    const fallback = await fetchSheetFallback(path);
    if(fallback){
      _store[path] = {data:fallback, ts:Date.now(), promise:null, fromSheetFallback:true};
      return fallback;
    }
    if(_store[path]) _store[path].promise = null;
    throw e;
  });
  if(!_store[path]) _store[path]={data:null,ts:0,promise:null};
  _store[path].promise = p;
  return p;
}

function invalidate(...paths){
  paths.forEach(p=>{if(_store[p]){_store[p].ts=0;_store[p].promise=null;}});
  // Notify all useFB hooks to re-fetch
  window.dispatchEvent(new CustomEvent("fb-invalidate",{detail:{paths}}));
}
function invalidateAll(){ Object.keys(_store).forEach(p=>{if(_store[p]){_store[p].ts=0;_store[p].promise=null;}}); }

/* Simple hook — fetches once, re-fetches on invalidate */
function useFB(path, tick=0){
  const [state, setState] = useState(()=>{
    const cached = _store[path];
    return {data: cached?.data??null, loading: !cached?.data};
  });
  const lastTick = useRef(-1);
  const lastPath = useRef(null);
  const localTick = useRef(0);
  const [_lt, setLt] = useState(0);

  // Listen for invalidate events for this path
  useEffect(()=>{
    if(!path) return;
    const handler=(e)=>{
      const paths=e.detail?.paths;
      if(!paths || paths.includes(path)){
        localTick.current++;
        setLt(t=>t+1);
      }
    };
    window.addEventListener("fb-invalidate", handler);
    return()=>window.removeEventListener("fb-invalidate", handler);
  },[path]);

  useEffect(()=>{
    if(!path) return;
    const force = tick !== lastTick.current || path !== lastPath.current || _lt !== undefined;
    lastTick.current = tick;
    lastPath.current = path;

    const cached = _store[path];
    if(!force && cached?.data && Date.now()-cached.ts < STALE){
      setState({data:cached.data, loading:false});
      return;
    }

    let cancelled = false;
    setState(s=>({...s, loading:!s.data}));
    loadPath(path, true).then(data=>{
      if(!cancelled) setState({data, loading:false});
    }).catch(()=>{
      if(!cancelled) setState(s=>({...s, loading:false}));
    });
    return ()=>{ cancelled=true; };
  }, [path, tick, _lt]);

  return state;
}

/* ── Sheet-only hook — Firebase পুরোপুরি বাইপাস করে সরাসরি GAS "getSheetRows" দিয়ে
   Google Sheet থেকে পড়ে (fetchSheetFallback পুনর্ব্যবহার করে)। যেসব জায়গায় UI-কে
   অবশ্যই আসল Sheet অবস্থা দেখাতে হবে (যেমন JobLauncherTab-এর "ব্যাখ্যা-ফাঁকা কতগুলো"
   কাউন্ট — কারণ explanation-fill automation এখন Sheet-এ লেখে, Firebase-এ না,
   sync হওয়ার আগ পর্যন্ত), সেখানে useFB-এর বদলে এটা ব্যবহার করো। ── */
function useSheetRows(tab, tick=0){
  const[state,setState]=useState({data:null,loading:true});
  useEffect(()=>{
    let cancelled=false;
    setState(s=>({...s,loading:true}));
    fetchSheetFallback(tab).then(data=>{
      if(!cancelled) setState({data,loading:false});
    });
    return ()=>{ cancelled=true; };
  },[tab,tick]);
  return state;
}


export { invalidate, invalidateAll, useFB, useSheetRows, loadPath };
