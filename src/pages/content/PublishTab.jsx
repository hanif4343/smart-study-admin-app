/* ══════════ PUBLISH TAB (CDN Delta-Publish) ══════════
   GAS_CDN_PLANNING.md-এর "Admin App Safety Alert" সেকশন অনুযায়ী — Publish
   করার আগে pre-publish checklist (নিজে থেকে verify করা যায় না এমন কিছু
   পয়েন্ট, শুধু মনে করিয়ে দেওয়া), আর persistent status (শেষ publish কবে,
   ফলাফল কী ছিল)।
   dirty-topic count আগে থেকেই GAS-এর "_DirtyTopics" শিটে জমা থাকে (updateField/
   deleteByIds/moveQuestions/moveTopic/renameField/renameReferenceItem/
   deleteByReferenceId/bulk_save_rows — এই সব action GAS-সাইডে নিজে থেকেই
   dirty মার্ক করে) — এই পেজ শুধু trigger + status দেখায়, কোনো নতুন write
   লজিক এখানে নেই। */
import React, { useState, useEffect, useCallback } from "react";
import { C } from "../../core/config.js";
import { loadSharedGasSecret, saveSharedGasSecret } from "../../core/utils.js";
import { fetchDirtyTopicsCount, publishNow } from "../../core/sheetSave.js";

const LS_LAST_PUBLISH = "cdn_last_publish_result"; // persistent status — localStorage-এ থাকে, অ্যাপ বন্ধ করলেও শেষ ফলাফল দেখা যায়

function loadLastPublish(){
  try{ const raw=localStorage.getItem(LS_LAST_PUBLISH); return raw?JSON.parse(raw):null; }catch{ return null; }
}
function saveLastPublish(result){
  try{ localStorage.setItem(LS_LAST_PUBLISH, JSON.stringify({...result, at:Date.now()})); }catch{}
}

const CHECKLIST_ITEMS = [
  "Sheet-এ কোনো অসম্পূর্ণ/আধা-করা bulk edit বাকি নেই তো?",
  "বড় bulk move/delete চলমান থাকলে সেটা শেষ হওয়া পর্যন্ত Publish দেরি করাই ভালো",
  "Smart Study App আর এই Admin App (OCR bulk-add) একসাথে সক্রিয়ভাবে ব্যবহার করছেন না তো?",
  "GitHub token এখনো valid/expired না তো?",
];

function PublishTab({push}){
  const[gasSecret,setGasSecret]=useState(loadSharedGasSecret);
  const setGasSecretP=v=>{ setGasSecret(v); saveSharedGasSecret(v); };

  const[dirtyCount,setDirtyCount]=useState(null); // null = লোড হচ্ছে/অজানা
  const[loadingCount,setLoadingCount]=useState(false);
  const[publishing,setPublishing]=useState(false);
  const[lastResult,setLastResult]=useState(loadLastPublish);
  const[confirmOpen,setConfirmOpen]=useState(false);
  const[checked,setChecked]=useState(()=>CHECKLIST_ITEMS.map(()=>false));

  const refreshCount=useCallback(async()=>{
    if(!gasSecret) return;
    setLoadingCount(true);
    const c=await fetchDirtyTopicsCount({gasSecret});
    setDirtyCount(c);
    setLoadingCount(false);
  },[gasSecret]);

  useEffect(()=>{ refreshCount(); },[refreshCount]);

  const allChecked = checked.every(Boolean);

  const doPublish = async()=>{
    setConfirmOpen(false);
    setPublishing(true);
    const result = await publishNow({gasSecret,push});
    setPublishing(false);
    if(result.ok){
      saveLastPublish(result);
      setLastResult({...result, at:Date.now()});
      if(result.failed>0){
        push?.("warn",`⚠️ আংশিক সফল — ${result.published}টি হয়েছে, ${result.failed}টি ব্যর্থ`,
          (result.errors||[]).slice(0,3).join("; "));
      }else if(result.published===0){
        push?.("info","ℹ️ Publish করার মতো কিছু ছিল না","সব আগে থেকেই up-to-date");
      }else{
        push?.("success",`✅ ${result.published}টি Topic Publish হয়েছে`,
          `মোট ${result.totalQuestions||0}টি প্রশ্ন — manifest v${result.manifestVersion||"?"}`);
      }
      if(result.sanityWarning) push?.("warn","⚠️ Sanity-check সতর্কতা",result.sanityWarning);
    }
    refreshCount();
    setChecked(CHECKLIST_ITEMS.map(()=>false)); // পরের বারের জন্য চেকলিস্ট রিসেট
  };

  return(
    <div>
      {!gasSecret && (
        <div className="card" style={{marginBottom:12}}>
          <div style={{fontSize:12,fontWeight:700,marginBottom:8}}>🔑 GAS Secret Key দাও</div>
          <input
            type="password" placeholder="GAS Secret Key"
            value={gasSecret} onChange={e=>setGasSecretP(e.target.value)}
            style={{width:"100%",padding:"8px 10px",borderRadius:8,border:`1px solid ${C.border}`,background:C.panel,color:C.text,fontSize:12}}
          />
        </div>
      )}

      {/* ── Dirty-topic status card ── */}
      <div className="card" style={{marginBottom:12}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
          <div style={{fontSize:13,fontWeight:700}}>📦 Publish-এর অপেক্ষায়</div>
          <button className="btn bg" style={{fontSize:11,padding:"4px 9px"}} onClick={refreshCount} disabled={loadingCount}>
            {loadingCount?"⏳":"🔄"} রিফ্রেশ
          </button>
        </div>
        {dirtyCount===null ? (
          <div style={{fontSize:12,color:C.muted}}>{loadingCount?"লোড হচ্ছে...":"এখনো চেক করা হয়নি"}</div>
        ) : dirtyCount===0 ? (
          <div style={{fontSize:13,color:C.success}}>✅ সব up-to-date — publish করার মতো কিছু নেই</div>
        ) : (
          <div style={{fontSize:13,color:C.warning,fontWeight:700}}>
            🟡 {dirtyCount}টি Topic বদলেছে, publish করা বাকি
          </div>
        )}
      </div>

      {/* ── Pre-publish safety checklist ── */}
      {dirtyCount>0 && (
        <div className="card" style={{marginBottom:12,border:`1px solid ${C.warning}40`}}>
          <div style={{fontSize:13,fontWeight:700,marginBottom:8,color:C.warning}}>⚠️ Publish করার আগে চেক করো</div>
          {CHECKLIST_ITEMS.map((item,i)=>(
            <label key={i} style={{display:"flex",gap:8,alignItems:"flex-start",fontSize:12,color:C.text,marginBottom:8,cursor:"pointer"}}>
              <input
                type="checkbox" checked={checked[i]}
                onChange={e=>setChecked(prev=>prev.map((v,idx)=>idx===i?e.target.checked:v))}
                style={{marginTop:2}}
              />
              <span>{item}</span>
            </label>
          ))}
        </div>
      )}

      {/* ── Publish বাটন ── */}
      <button
        className="btn"
        style={{width:"100%",justifyContent:"center",padding:"12px",fontSize:14,
          background: dirtyCount>0 && allChecked ? C.info : C.border,
          color: dirtyCount>0 && allChecked ? "#fff" : C.muted}}
        disabled={!gasSecret || publishing || !dirtyCount || !allChecked}
        onClick={()=>setConfirmOpen(true)}
      >
        {publishing ? "⏳ Publish হচ্ছে..." : `🚀 Publish Now${dirtyCount?` (${dirtyCount}টি Topic)`:""}`}
      </button>
      {dirtyCount>0 && !allChecked && (
        <div style={{fontSize:11,color:C.muted,textAlign:"center",marginTop:6}}>উপরের সবগুলো চেক করলে বাটন চালু হবে</div>
      )}

      {/* ── Confirm ডায়ালগ ── */}
      {confirmOpen && (
        <div className="ovl">
          <div className="modal">
            <div className="mh"/>
            <div style={{fontSize:13,fontWeight:700,marginBottom:8}}>🚀 Publish নিশ্চিত করো</div>
            <div style={{background:`${C.info}12`,border:`1px solid ${C.info}30`,borderRadius:9,padding:"9px 12px",marginBottom:12,fontSize:11,color:C.muted}}>
              <b style={{color:C.text}}>{dirtyCount}টি Topic</b> এখন GitHub-এ commit হবে, manifest.json আপডেট হবে। কিছু সময় (কয়েক সেকেন্ড থেকে ১-২ মিনিট) লাগতে পারে।
            </div>
            <div style={{display:"flex",gap:7}}>
              <button className="btn bg" style={{flex:1,justifyContent:"center"}} onClick={()=>setConfirmOpen(false)}>বাতিল</button>
              <button className="btn" style={{flex:2,justifyContent:"center",background:C.info,color:"#fff"}} onClick={doPublish}>🚀 হ্যাঁ, Publish করো</button>
            </div>
          </div>
        </div>
      )}

      {/* ── শেষ Publish-এর persistent status ── */}
      {lastResult && (
        <div className="card" style={{marginTop:16}}>
          <div style={{fontSize:12,fontWeight:700,marginBottom:6,color:C.muted}}>সর্বশেষ Publish</div>
          <div style={{fontSize:12,color:C.text}}>
            {new Date(lastResult.at).toLocaleString("bn-BD")}
          </div>
          <div style={{fontSize:12,marginTop:4}}>
            {lastResult.failed>0
              ? <span style={{color:C.warning}}>⚠️ আংশিক — {lastResult.published} সফল, {lastResult.failed} ব্যর্থ</span>
              : <span style={{color:C.success}}>✅ {lastResult.published}টি Topic, {lastResult.totalQuestions||0}টি প্রশ্ন (v{lastResult.manifestVersion||"?"})</span>
            }
          </div>
          {lastResult.sanityWarning && (
            <div style={{fontSize:11,color:C.warning,marginTop:6}}>{lastResult.sanityWarning}</div>
          )}
        </div>
      )}
    </div>
  );
}

export { PublishTab };
