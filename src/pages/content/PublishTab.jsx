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
import { fetchDirtyTopicsCount, publishNow, fetchPublishStats, markAllTopicsDirty, fetchOrphanStats, deleteOrphanQuestions, fetchManifestHistory, rollbackManifest } from "../../core/sheetSave.js";

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

  // ── CDN-এ বাস্তবে এখন কতগুলো প্রশ্ন আছে (read-only, সরাসরি manifest.json
  // থেকে) — Publish না করলেও দেখা যায়, dirty count-এর পাশে আলাদা কার্ডে ──
  const[publishStats,setPublishStats]=useState(null);
  const[loadingStats,setLoadingStats]=useState(false);
  const refreshStats=useCallback(async()=>{
    if(!gasSecret) return;
    setLoadingStats(true);
    const s=await fetchPublishStats({gasSecret});
    setPublishStats(s);
    setLoadingStats(false);
  },[gasSecret]);
  useEffect(()=>{ refreshStats(); },[refreshStats]);

  // ── "সব Topic Dirty মার্ক করো" — Phase ১-এর আগের পুরনো প্রশ্নগুলো একবারে
  // CDN-এ তোলার জন্য (এক-কালীন, সাবধানে ব্যবহারের জন্য আলাদা confirm) ──
  const[markAllOpen,setMarkAllOpen]=useState(false);
  const[markingAll,setMarkingAll]=useState(false);
  const doMarkAllDirty=async()=>{
    setMarkAllOpen(false);
    setMarkingAll(true);
    const result=await markAllTopicsDirty({gasSecret,push});
    setMarkingAll(false);
    if(result.ok){
      push?.("success",`✅ ${result.markedCount}টা Topic dirty মার্ক হলো`,"এখন একাধিকবার Publish Now চাপলে ধীরে ধীরে সব CDN-এ উঠবে");
      refreshCount();
    }
  };

  // ── Orphan প্রশ্ন — যাদের topic_id দেওয়া আছে কিন্তু Topics শিটে সেই id-ই
  // নেই (পুরনো টপিক মুছে/rename হয়ে যাওয়ায় এতিম হয়ে গেছে)। "blank"
  // (topic_id ফাঁকা) আলাদা — সেগুলো ভালো প্রশ্ন, Review ট্যাবে ক্যাটাগরাইজ
  // হওয়ার অপেক্ষায়, এখানে ছোঁয়া হয় না। ──
  const[orphanStats,setOrphanStats]=useState(null);
  const[loadingOrphan,setLoadingOrphan]=useState(false);
  const refreshOrphan=useCallback(async()=>{
    if(!gasSecret) return;
    setLoadingOrphan(true);
    const s=await fetchOrphanStats({gasSecret});
    setOrphanStats(s);
    setLoadingOrphan(false);
  },[gasSecret]);
  useEffect(()=>{ refreshOrphan(); },[refreshOrphan]);

  const totalOrphan=orphanStats?Object.values(orphanStats).reduce((s,v)=>s+(v.orphan||0),0):0;
  const[deleteOrphanTarget,setDeleteOrphanTarget]=useState(null); // sheet name বা "all"
  const[deletingOrphan,setDeletingOrphan]=useState(false);
  const doDeleteOrphan=async()=>{
    const target=deleteOrphanTarget;
    setDeleteOrphanTarget(null);
    setDeletingOrphan(true);
    const result=await deleteOrphanQuestions({gasSecret,push,sheet:target==="all"?undefined:target});
    setDeletingOrphan(false);
    if(result.ok){
      push?.("success",`🗑️ ${result.deletedCount}টা Orphan প্রশ্ন মুছে ফেলা হলো`,"");
      refreshOrphan();
    }
  };

  // ── Rollback — manifest.json-এর পুরনো ভার্সনে ফিরে যাওয়া। History-টা লেজি
  // লোড হয় (প্যানেল খোলার সময়ই শুধু), কারণ প্রতিটা commit-এর ভার্সন/টপিক-সংখ্যা
  // বের করতে কয়েকটা GitHub API কল লাগে — এমনি এমনি পেজ খুললেই এটা করার
  // দরকার নেই। ──
  const[rollbackOpen,setRollbackOpen]=useState(false);
  const[history,setHistory]=useState(null);
  const[loadingHistory,setLoadingHistory]=useState(false);
  const openRollback=async()=>{
    setRollbackOpen(true);
    if(history) return; // আগেই লোড হয়ে থাকলে আবার করবে না
    setLoadingHistory(true);
    const h=await fetchManifestHistory({gasSecret});
    setHistory(h||[]);
    setLoadingHistory(false);
  };
  const[rollbackTarget,setRollbackTarget]=useState(null); // {sha,date,version}
  const[rollingBack,setRollingBack]=useState(false);
  const doRollback=async()=>{
    const target=rollbackTarget;
    setRollbackTarget(null);
    setRollingBack(true);
    const result=await rollbackManifest({gasSecret,push,sha:target.sha});
    setRollingBack(false);
    if(result.ok){
      push?.("success","✅ পুরনো ভার্সনে ফিরিয়ে দেওয়া হলো","");
      setRollbackOpen(false);
      setHistory(null); // পরের বার খুললে ফ্রেশ history আনবে
      refreshStats();
    }
  };

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
    refreshStats();
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

      {/* ── CDN-এ এখন বাস্তবে কতটা আছে (read-only, manifest.json থেকে সরাসরি) ── */}
      <div className="card" style={{marginBottom:12}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
          <div style={{fontSize:13,fontWeight:700}}>🌐 CDN-এ এখন যা আছে</div>
          <button className="btn bg" style={{fontSize:11,padding:"4px 9px"}} onClick={refreshStats} disabled={loadingStats}>
            {loadingStats?"⏳":"🔄"} রিফ্রেশ
          </button>
        </div>
        {publishStats===null ? (
          <div style={{fontSize:12,color:C.muted}}>{loadingStats?"লোড হচ্ছে...":"এখনো চেক করা হয়নি"}</div>
        ) : publishStats.message ? (
          <div style={{fontSize:12,color:C.muted}}>{publishStats.message}</div>
        ) : (
          <div style={{fontSize:13,color:C.text}}>
            <div style={{marginBottom:8}}>
              📚 মোট <b>{publishStats.totalQuestions}</b>টি প্রশ্ন · <b>{publishStats.topicCount}</b>টি Topic
            </div>
            {publishStats.bySheet && ["Quiz","QBank","Study"].map(sheetName=>{
              const s=publishStats.bySheet[sheetName];
              if(!s) return null;
              return(
                <div key={sheetName} style={{display:"flex",justifyContent:"space-between",fontSize:12,padding:"4px 0",borderTop:`1px solid ${C.border}`}}>
                  <span style={{color:C.muted}}>{sheetName}</span>
                  <span>{s.questions}টি প্রশ্ন <span style={{color:C.muted}}>({s.topics}টি Topic)</span></span>
                </div>
              );
            })}
            <div style={{fontSize:11,color:C.muted,marginTop:8}}>
              manifest v{publishStats.version}{publishStats.publishedAt?` · সর্বশেষ ${new Date(publishStats.publishedAt).toLocaleString("bn-BD")}`:""}
            </div>
          </div>
        )}
      </div>

      {/* ── Orphan Questions — যেসব প্রশ্নের topic_id Topics শিটে অস্তিত্বই নেই ── */}
      <div className="card" style={{marginBottom:12,border:totalOrphan>0?`1px solid ${C.warning}40`:undefined}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
          <div style={{fontSize:13,fontWeight:700}}>🧟 Orphan প্রশ্ন</div>
          <button className="btn bg" style={{fontSize:11,padding:"4px 9px"}} onClick={refreshOrphan} disabled={loadingOrphan}>
            {loadingOrphan?"⏳":"🔄"} রিফ্রেশ
          </button>
        </div>
        {orphanStats===null ? (
          <div style={{fontSize:12,color:C.muted}}>{loadingOrphan?"লোড হচ্ছে...":"এখনো চেক করা হয়নি"}</div>
        ) : totalOrphan===0 ? (
          <div style={{fontSize:13,color:C.success}}>✅ কোনো Orphan প্রশ্ন নেই</div>
        ) : (
          <>
            <div style={{fontSize:11,color:C.muted,marginBottom:8,lineHeight:1.5}}>
              এই প্রশ্নগুলোর topic_id দেওয়া আছে কিন্তু সেই টপিক Topics শিটে নেই (মুছে/rename হয়ে গেছে) — CDN publish-এ এগুলো নেওয়া যায় না। (ফাঁকা topic_id-এর প্রশ্ন এখানে দেখানো হয় না — সেগুলো Review ট্যাবে ঠিক করার জন্য।)
            </div>
            {["Quiz","QBank","Study"].map(sheetName=>{
              const s=orphanStats[sheetName];
              if(!s||!s.orphan) return null;
              return(
                <div key={sheetName} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"6px 0",borderTop:`1px solid ${C.border}`}}>
                  <span style={{fontSize:12,color:C.text}}>{sheetName}: <b style={{color:C.warning}}>{s.orphan}</b>টি</span>
                  <button className="btn" style={{fontSize:10,padding:"4px 8px",background:`${C.warning}18`,color:C.warning}}
                    disabled={deletingOrphan} onClick={()=>setDeleteOrphanTarget(sheetName)}>🗑️ মুছো</button>
                </div>
              );
            })}
            {totalOrphan>1 && (
              <button className="btn" style={{width:"100%",justifyContent:"center",marginTop:8,fontSize:11,padding:"7px",background:C.warning,color:"#fff"}}
                disabled={deletingOrphan} onClick={()=>setDeleteOrphanTarget("all")}>
                {deletingOrphan?"⏳ মুছা হচ্ছে...":`🗑️ সবগুলো মুছো (${totalOrphan}টি)`}
              </button>
            )}
          </>
        )}
      </div>

      {/* ── Orphan Delete Confirm ডায়ালগ ── */}
      {deleteOrphanTarget && (
        <div className="ovl">
          <div className="modal">
            <div className="mh"/>
            <div style={{fontSize:13,fontWeight:700,marginBottom:8}}>🗑️ Orphan প্রশ্ন মুছবে?</div>
            <div style={{background:`${C.warning}12`,border:`1px solid ${C.warning}30`,borderRadius:9,padding:"9px 12px",marginBottom:12,fontSize:11,color:C.muted}}>
              {deleteOrphanTarget==="all"
                ? <>Quiz/QBank/Study — তিনটা শিটের সব orphan প্রশ্ন (মোট <b style={{color:C.text}}>{totalOrphan}টি</b>) মুছে যাবে।</>
                : <><b style={{color:C.text}}>{deleteOrphanTarget}</b> শিটের <b style={{color:C.text}}>{orphanStats?.[deleteOrphanTarget]?.orphan||0}টি</b> orphan প্রশ্ন মুছে যাবে।</>
              } এটা <b style={{color:C.text}}>ফিরিয়ে আনা যাবে না</b>। ফাঁকা topic_id-এর প্রশ্ন এতে ছোঁয়া হবে না।
            </div>
            <div style={{display:"flex",gap:7}}>
              <button className="btn bg" style={{flex:1,justifyContent:"center"}} onClick={()=>setDeleteOrphanTarget(null)}>বাতিল</button>
              <button className="btn" style={{flex:2,justifyContent:"center",background:C.warning,color:"#fff"}} onClick={doDeleteOrphan}>🗑️ হ্যাঁ, মুছে ফেলো</button>
            </div>
          </div>
        </div>
      )}

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

      {/* ── Advanced/এক-কালীন কাজ — আলাদাভাবে দেখানো, যাতে মূল Publish বাটনের
          সাথে গুলিয়ে না যায় (হুট করে সব Topic dirty হয়ে যাওয়া সাধারণ কাজ না) ── */}
      <div style={{marginTop:20,paddingTop:16,borderTop:`1px dashed ${C.border}`}}>
        <div style={{fontSize:11,color:C.muted,marginBottom:8}}>⚙️ অ্যাডভান্সড — সাধারণত লাগে না</div>
        <button
          className="btn bg"
          style={{width:"100%",justifyContent:"center",padding:"9px",fontSize:12}}
          disabled={!gasSecret || markingAll}
          onClick={()=>setMarkAllOpen(true)}
        >
          {markingAll ? "⏳ মার্ক হচ্ছে..." : "🔄 সব Topic Dirty মার্ক করো"}
        </button>
        <div style={{fontSize:10,color:C.muted,marginTop:5,marginBottom:12,lineHeight:1.5}}>
          শুধু তখনই দরকার যখন পুরনো (Publish Pipeline চালু হওয়ার আগের) সব প্রশ্ন প্রথমবার CDN-এ তুলতে চাও — একবার মার্ক করলে এরপর একাধিকবার "Publish Now" চেপে ধীরে ধীরে সব উঠবে।
        </div>

        <button
          className="btn bg"
          style={{width:"100%",justifyContent:"center",padding:"9px",fontSize:12}}
          disabled={!gasSecret || rollingBack}
          onClick={openRollback}
        >
          {rollingBack ? "⏳ ফিরিয়ে দেওয়া হচ্ছে..." : "↩️ পুরনো ভার্সনে ফিরে যাও (Rollback)"}
        </button>
        <div style={{fontSize:10,color:C.muted,marginTop:5,lineHeight:1.5}}>
          ভুল ডেটা publish হয়ে গেলে এখান থেকে আগের কোনো ভার্সনে manifest.json ফিরিয়ে নিয়ে যেতে পারবে।
        </div>
      </div>

      {/* ── Rollback প্যানেল — সাম্প্রতিক ভার্সনগুলোর লিস্ট, একটা বেছে নিলেই confirm ── */}
      {rollbackOpen && (
        <div className="ovl" onClick={()=>setRollbackOpen(false)}>
          <div className="modal" onClick={e=>e.stopPropagation()}>
            <div className="mh"/>
            <div style={{fontSize:13,fontWeight:700,marginBottom:10}}>↩️ কোন ভার্সনে ফিরবে?</div>
            {loadingHistory ? (
              <div style={{fontSize:12,color:C.muted,textAlign:"center",padding:"20px 0"}}>⏳ লোড হচ্ছে...</div>
            ) : !history || history.length===0 ? (
              <div style={{fontSize:12,color:C.muted,textAlign:"center",padding:"20px 0"}}>কোনো পুরনো ভার্সন পাওয়া যায়নি</div>
            ) : (
              <div className="ss-scroll" style={{maxHeight:"50vh",overflowY:"auto"}}>
                {history.map((c,i)=>(
                  <div key={c.sha} onClick={()=>setRollbackTarget(c)}
                    style={{padding:"9px 10px",borderRadius:8,border:`1px solid ${C.border}`,marginBottom:6,cursor:"pointer"}}>
                    <div style={{fontSize:12,fontWeight:700,color:C.text}}>
                      {i===0?"🟢 বর্তমান — ":""}{c.version?`v${c.version}`:"(ভার্সন অজানা)"}{c.topicCount!==undefined?` · ${c.topicCount}টি Topic`:""}
                    </div>
                    <div style={{fontSize:10,color:C.muted,marginTop:2}}>
                      {c.date?new Date(c.date).toLocaleString("bn-BD"):""} · {c.sha.substring(0,7)}
                    </div>
                  </div>
                ))}
              </div>
            )}
            <button className="btn bg" style={{width:"100%",justifyContent:"center",marginTop:8}} onClick={()=>setRollbackOpen(false)}>বন্ধ করো</button>
          </div>
        </div>
      )}

      {/* ── Rollback Confirm ডায়ালগ ── */}
      {rollbackTarget && (
        <div className="ovl">
          <div className="modal">
            <div className="mh"/>
            <div style={{fontSize:13,fontWeight:700,marginBottom:8}}>↩️ এই ভার্সনে ফিরে যাবে?</div>
            <div style={{background:`${C.warning}12`,border:`1px solid ${C.warning}30`,borderRadius:9,padding:"9px 12px",marginBottom:12,fontSize:11,color:C.muted}}>
              manifest.json <b style={{color:C.text}}>{rollbackTarget.version?`v${rollbackTarget.version}`:rollbackTarget.sha.substring(0,7)}</b>-এ ফিরে যাবে ({rollbackTarget.date?new Date(rollbackTarget.date).toLocaleString("bn-BD"):""})। এর মাঝের সব Publish-এর পরিবর্তন CDN থেকে সাময়িকভাবে সরে যাবে (পরে আবার নতুন করে Publish করলে ফিরে আসবে)। Topic ফাইলগুলো নিজে মুছে যায় না, শুধু manifest.json বদলায়।
            </div>
            <div style={{display:"flex",gap:7}}>
              <button className="btn bg" style={{flex:1,justifyContent:"center"}} onClick={()=>setRollbackTarget(null)}>বাতিল</button>
              <button className="btn" style={{flex:2,justifyContent:"center",background:C.warning,color:"#fff"}} onClick={doRollback}>↩️ হ্যাঁ, ফিরিয়ে দাও</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Mark All Dirty Confirm ডায়ালগ ── */}
      {markAllOpen && (
        <div className="ovl">
          <div className="modal">
            <div className="mh"/>
            <div style={{fontSize:13,fontWeight:700,marginBottom:8}}>🔄 সব Topic Dirty মার্ক করবে?</div>
            <div style={{background:`${C.warning}12`,border:`1px solid ${C.warning}30`,borderRadius:9,padding:"9px 12px",marginBottom:12,fontSize:11,color:C.muted}}>
              এতে <b style={{color:C.text}}>প্রতিটা</b> Topic dirty মার্ক হয়ে যাবে (নতুন বা পুরনো, সব)। এটা এক-কালীন কাজ, শুধু প্রথমবার পুরো ডেটাবেজ CDN-এ তোলার জন্য। এরপর ৪০০-এর cap থাকায় একাধিকবার Publish Now চাপতে হবে সব শেষ হতে।
            </div>
            <div style={{display:"flex",gap:7}}>
              <button className="btn bg" style={{flex:1,justifyContent:"center"}} onClick={()=>setMarkAllOpen(false)}>বাতিল</button>
              <button className="btn" style={{flex:2,justifyContent:"center",background:C.warning,color:"#fff"}} onClick={doMarkAllDirty}>🔄 হ্যাঁ, সব মার্ক করো</button>
            </div>
          </div>
        </div>
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
