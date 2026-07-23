/* ══════════ FIREBASE REST ══════════ */
import { FB } from "./config.js";
import { _LC } from "./logger.js";
import { _authQ, refreshTokenIfNeeded } from "./auth.js";
import { _BGM } from "./bgTasks.js";

async function _checkResp(r){
  const txt = await r.text();
  if(!r.ok){
    let msg=`HTTP ${r.status}`;
    try{
      const j=JSON.parse(txt);
      if(j?.error){
        msg = typeof j.error==="string" ? j.error : (j.error?.message||JSON.stringify(j.error));
      }
    }catch(_){}
    console.error("Firebase write error:",r.status, msg, r.url);
    _LC.error("firebaseWrite", `Firebase write error: ${msg}`, { status: r.status, url: (r.url||"").split("?")[0].slice(-60) });
    throw new Error(msg);
  }
  try{ return JSON.parse(txt); }catch(_){ return txt; }
}
const _tok=()=>refreshTokenIfNeeded();

/* ── ⏱ Delta-sync bookkeeping — Quiz/QBank/Study-এর যেকোনো row সরাসরি Firebase-এ
   লেখা হলে (fbPatch/fbSet/fbPush/fbDeleteBatch — GAS bypass করে যেসব জায়গায়
   Admin App সরাসরি Firebase প্যাচ করে, যেমন rename/bulk-delete), এই helper-গুলো
   স্বয়ংক্রিয়ভাবে updatedAt বসায় + meta/updatedAt বাম্প করে (debounced — কাছাকাছি
   সময়ে অনেকগুলো প্যাচ হলে একবারই মেটা-write হবে)। User App-এর delta-sync এভাবেই
   কাজ করে (GAS-এর syncToFirebase-এর সাথে মিলিয়ে)। ── */
const FB_DELTA_SHEETS = ["Quiz","QBank","Study"];
function _fbInjectUpdatedAt(path, data){
  const top=(path||"").split("/")[0];
  if(FB_DELTA_SHEETS.includes(top) && data && typeof data==="object" && !Array.isArray(data)){
    return {...data, updatedAt: Date.now()};
  }
  return data;
}
let _fbMetaBumpTimer=null;
function _fbBumpMetaUpdatedAt(path){
  const top=(path||"").split("/")[0];
  if(!FB_DELTA_SHEETS.includes(top)) return;
  clearTimeout(_fbMetaBumpTimer);
  _fbMetaBumpTimer=setTimeout(()=>{ fbSet("meta/updatedAt", Date.now()).catch(()=>{}); }, 800);
}

/* ── ক্ষণস্থায়ী নেটওয়ার্ক/5xx ব্যর্থতার জন্য রিট্রাই — Firebase read/write দুটোতেই ব্যবহার হয় ──
   auth/4xx এরর-এ রিট্রাই করে না (সেগুলো রিট্রাই করলেও ঠিক হবে না), শুধু network fail বা 5xx-এ। */
async function _fbFetch(url,opts,retries=2){
  const method = (opts && opts.method) || "GET";
  const label  = method + " " + String(url).split("?")[0].split("/").slice(-2).join("/");
  return _BGM.guard(async () => {
    let lastErr;
    for(let attempt=0;attempt<=retries;attempt++){
      try{
        const r=await fetch(url,opts);
        if(r.status>=500 && attempt<retries){ await new Promise(res=>setTimeout(res,300*(attempt+1))); continue; }
        return r;
      }catch(e){
        lastErr=e;
        if(attempt<retries){ await new Promise(res=>setTimeout(res,300*(attempt+1))); continue; }
        throw e;
      }
    }
    throw lastErr;
  }, label);
}

const fbGet   = async p=>{
  const t=await _tok();
  try {
    const r=await _fbFetch(`${FB}/${p}.json${_authQ(t)}`);
    const data = await r.json();
    if(data?.error) _LC.error("fbGet", `fbGet error at ${p}: ${data.error}`, { path: p });
    return data;
  } catch(e) {
    _LC.error("fbGet", `fbGet network fail: ${e.message}`, { path: p });
    throw e;
  }
};
const fbPatch  = async(p,d)=>{
  const t=await _tok();
  if(!t){ _LC.error("fbPatch","Not authenticated — token missing",{path:p}); throw new Error("Not authenticated — please re-login"); }
  if(!p||p.includes("/undefined")||p.includes("/null")){ _LC.error("fbPatch","Invalid path",{path:p}); throw new Error("Invalid path: "+p); }
  const r=await _fbFetch(`${FB}/${p}.json${_authQ(t)}`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify(_fbInjectUpdatedAt(p,d))});
  const res=await _checkResp(r);
  _fbBumpMetaUpdatedAt(p);
  return res;
};
const fbSet   = async(p,d)=>{
  const t=await _tok();
  if(!t){ _LC.error("fbSet","Not authenticated — token missing",{path:p}); throw new Error("Not authenticated — please re-login"); }
  const r=await _fbFetch(`${FB}/${p}.json${_authQ(t)}`,{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify(_fbInjectUpdatedAt(p,d))});
  const res=await _checkResp(r);
  _fbBumpMetaUpdatedAt(p);
  return res;
};
const fbPush  = async(p,d)=>{
  const t=await _tok();
  const r=await _fbFetch(`${FB}/${p}.json${_authQ(t)}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(_fbInjectUpdatedAt(p,d))});
  const res=await _checkResp(r);
  _fbBumpMetaUpdatedAt(p);
  return res;
};
const fbDelete= async p=>{
  const t=await _tok();
  if(!t){ _LC.error("fbDelete","Not authenticated — token missing",{path:p}); throw new Error("Not authenticated — please re-login"); }
  if(!p||p.includes("/undefined")||p.includes("/null")){ _LC.error("fbDelete","Invalid path",{path:p}); throw new Error("Invalid path: "+p); }
  const r=await _fbFetch(`${FB}/${p}.json${_authQ(t)}`,{method:"DELETE"});
  return _checkResp(r);
};

/* ══ fbDeleteBatch — Firebase multi-path DELETE (single REST call) ══
   Firebase PATCH with {key: null} = atomic multi-delete.
   Root path = sheet (e.g. "QBank"), keys = _fbKey array.
   Much faster than serial fbDelete per item.
   Firebase limits: ~1000 keys per call, ~10MB body — we chunk at 500.
   ══════════════════════════════════════════════════════════════════ */
const BATCH_SZ = 500;
async function fbDeleteBatch(sheet, fbKeys, onProgress) {
  if (!fbKeys || fbKeys.length === 0) return 0;
  const t = await _tok();
  if (!t) throw new Error("Not authenticated — please re-login");
  let deleted = 0;
  for (let i = 0; i < fbKeys.length; i += BATCH_SZ) {
    const chunk = fbKeys.slice(i, i + BATCH_SZ);
    const body = {};
    chunk.forEach(k => { body[k] = null; }); // null = delete in Firebase
    const r = await fetch(`${FB}/${sheet}.json${_authQ(t)}`, {
      method: "PATCH",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify(body),
    });
    await _checkResp(r);
    deleted += chunk.length;
    if (onProgress) onProgress(deleted, fbKeys.length);
    _LC.log("fbDeleteBatch", `Batch ${Math.ceil((i+1)/BATCH_SZ)}: deleted ${deleted}/${fbKeys.length} from ${sheet}`);
  }
  _fbBumpMetaUpdatedAt(sheet);
  return deleted;
}

/* ══ fbPatchBatch — parallel PATCH with concurrency limit ══
   For rename: patch N items, CONCURRENCY at a time.
   onProgress(done, total) optional callback.
   ══════════════════════════════════════════════════════════ */
async function fbPatchBatch(items, onProgress, concurrency) {
  concurrency = concurrency || 20;
  let done = 0;
  for (let i = 0; i < items.length; i += concurrency) {
    const chunk = items.slice(i, i + concurrency);
    await Promise.all(chunk.map(({path, data}) => fbPatch(path, data)));
    done += chunk.length;
    if (onProgress) onProgress(done, items.length);
  }
  return done;
}

/* ── Admin FCM Token Save ──
   Login এর পরে admin এর FCM token Firebase এ save করো।
   Main app এই token ব্যবহার করে admin কে push notification পাঠায়।
   Path: users/{adminPhone}/fcmToken (lowercase users — main app এখান থেকে পড়ে)
   Also sets Users/{phone}/Role = "admin" যাতে main app admin চিনতে পারে
   ─────────────────────────────────────────────────────────────────── */
async function _saveAdminFcmToken() {
  try {
    // Capacitor FCM plugin দিয়ে token নাও
    const plugin = window.Capacitor?.Plugins?.FcmToken;
    if (!plugin) { _LC.warn("FCM","FcmToken plugin not available"); return; }
    const { token } = await plugin.getToken();
    if (!token) { _LC.warn("FCM","Empty FCM token"); return; }

    // Admin phone — Users node থেকে admin এর phone বের করো
    const t = await _tok();
    const usersRaw = await (await fetch(`${FB}/Users.json${_authQ(t)}`)).json();
    const users = Object.entries(usersRaw||{});
    const adminEntry = users.find(([,u])=>(u?.Role||u?.role||"").toLowerCase()==="admin");
    let adminPhone = adminEntry ? adminEntry[0] : null;

    if (!adminPhone) {
      // Phone নেই — UID দিয়ে fallback path ব্যবহার করো
      _LC.warn("FCM","No admin phone found — saving to AdminFCMTokens");
      await fbSet("AdminFCMTokens/token", token);
      _LC.info("FCM","✅ Admin FCM token saved to AdminFCMTokens/token");
      return;
    }

    // users/{phone}/fcmToken — main app এখান থেকে পড়ে
    // admin app এর token আলাদা field এ রাখি যাতে main app এর
    // users/{phone}/fcmToken (regular user token) overwrite না হয়
    await fbSet(`users/${adminPhone}/adminFcmToken`, token);
    _LC.info("FCM",`✅ Admin FCM token saved for ${adminPhone}`);

    // Token refresh listener
    window.addEventListener("fcmTokenRefresh", async (e) => {
      try {
        const newToken = e.detail?.token || JSON.parse(e.detail||"{}").token;
        if (newToken) {
          await fbSet(`users/${adminPhone}/fcmToken`, newToken);
          _LC.info("FCM","🔄 FCM token refreshed");
        }
      } catch(_) {}
    });
  } catch(e) {
    _LC.error("FCM","_saveAdminFcmToken: " + e.message);
  }
}

export { _checkResp, _fbFetch, _tok, fbGet, fbPatch, fbSet, fbPush, fbDelete, fbDeleteBatch, fbPatchBatch, _saveAdminFcmToken };
