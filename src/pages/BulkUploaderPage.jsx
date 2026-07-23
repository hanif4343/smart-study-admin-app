/* ══════════ BULK UPLOADER PAGE ══════════ */
import React, { useState, useEffect, useRef } from "react";
import { C } from "../core/config.js";
import { loadPath, invalidate } from "../core/dataCache.js";
import { fbPush, fbSet } from "../core/firebase.js";
import { toArr, nowTs } from "../core/utils.js";
import { Bar } from "../components/shared/MiniComponents.jsx";
import {
  getBulkEntries, parseBulkEntry, getBulkEffectiveType, buildBulkRecord, buildSheetRow,
  loadSaveLocPref, saveSaveLocPref, loadSharedGasSecret, saveSharedGasSecret, pushFailedItems
} from "../core/uploaderUtils.js";
import { saveRowsToSheet } from "../core/sheetSave.js";
import { SaveLocationPicker } from "../components/shared/SaveLocationPicker.jsx";
import { FailedQueuePanel } from "../components/shared/FailedQueuePanel.jsx";

function BulkUploaderPage({push,prefillText,onClearPrefill}){

  const[mode,setMode]=useState("Quiz");
  const[qtype,setQtype]=useState("MCQ");
  const[subject,setSubject]=useState("");
  const[subtopic,setSubtopic]=useState("");
  const[bulkText,setBulkText]=useState("");
  const[audienceTags,setAudienceTags]=useState([]);
  const[tagInput,setTagInput]=useState("");
  const[subjects,setSubjects]=useState([]);
  const[validStats,setValidStats]=useState(null);
  const[validDetail,setValidDetail]=useState(null); // detail modal data
  const[showDetail,setShowDetail]=useState(false);
  const[running,setRunning]=useState(false);
  const[stopped,setStopped]=useState(false);
  const[progress,setProgress]=useState({done:0,total:0,sent:0,failed:0});
  const[log,setLog]=useState([]);
  const[done,setDone]=useState(false);
  const stopRef=useRef(false);
  const[saveLoc,setSaveLoc]=useState(loadSaveLocPref); // "sheet" | "firebase"
  const setSaveLocP=(v)=>{ setSaveLoc(v); saveSaveLocPref(v); };
  const[gasSecret,setGasSecret]=useState(loadSharedGasSecret);
  const setGasSecretP=(v)=>{ setGasSecret(v); saveSharedGasSecret(v); };

  /* Load subjects for autocomplete */
  useEffect(()=>{
    loadPath(mode).then(raw=>{
      const arr=toArr(raw);
      const subs=[...new Set(arr.map(q=>q.subject||q.Subject||"").filter(Boolean))];
      setSubjects(subs);
    }).catch(()=>{});
  },[mode]);

  /* AI Import (OCR) পেজ থেকে prefill — plain string অথবা {text,subject,subtopic,tags,mode,qtype} object */
  useEffect(()=>{
    if(prefillText){
      const payload=typeof prefillText==="string"?{text:prefillText}:prefillText;
      const finalMode=payload.mode||mode;
      const finalQtype=payload.qtype||qtype;
      if(payload.mode)setMode(payload.mode);
      if(payload.qtype)setQtype(payload.qtype);
      if(payload.subject!==undefined)setSubject(payload.subject);
      if(payload.subtopic!==undefined)setSubtopic(payload.subtopic);
      if(payload.tags&&Array.isArray(payload.tags))setAudienceTags(payload.tags);
      if(payload.text){
        setBulkText(payload.text);
        runValidate(payload.text,finalMode,finalQtype);
      }
      if(onClearPrefill)onClearPrefill();
    }
  },[prefillText]);

  /* ── Parse helpers — শেয়ার্ড module-level ফাংশন (AIImportPage-ও একই লজিক ব্যবহার করে) ── */
  const getEntries=getBulkEntries;
  const parseEntry=parseBulkEntry;
  const getEffectiveType=getBulkEffectiveType;
  const parseLine=(entry)=>parseEntry(entry, getEffectiveType(mode,qtype));

  /* Validate — detail list সহ */
  const runValidate=(text,m,qt)=>{
    if(!text.trim()){setValidStats(null);setValidDetail(null);return;}
    const eff=getEffectiveType(m,qt);
    const entries=getEntries(text);
    const rows=entries.map((e,i)=>{
      const r=parseEntry(e,eff);
      return{idx:i+1, entry:e, ...r};
    });
    const ok=rows.filter(r=>r.ok).length;
    const skip=rows.filter(r=>r.skip).length;
    const err=rows.filter(r=>r.err).length;
    setValidStats({total:rows.length,ok,skip,err});
    setValidDetail(rows);
  };

  const handleText=(v)=>{setBulkText(v);runValidate(v,mode,qtype);};
  const handleQtype=(v)=>{setQtype(v);runValidate(bulkText,mode,v);};
  const handleMode=(v)=>{setMode(v);runValidate(bulkText,v,qtype);};

  /* ── Shuffle MCQ Options ──
     প্রতিটি MCQ লাইনে অপশনগুলো (col 1-4) random করে সাজায়,
     correct field (col 5) সেই অনুযায়ী আপডেট করে।
     { } block এবং plain line দুটো format-ই handle করে।
  */
  const[shuffleInfo,setShuffleInfo]=useState(null); // {count} — কতটা shuffle হলো
  const handleShuffle=()=>{
    if(!bulkText.trim()||getEffectiveType(mode,qtype)!=="MCQ"){return;}
    const entries=getEntries(bulkText);
    let shuffled=0;
    const newLines=entries.map(entry=>{
      const tr=entry.trim();
      if(!tr||tr.startsWith("#"))return entry;
      const flat=tr.replace(/\r?\n/g," ").replace(/\s+/g," ");
      const parts=flat.split(";").map(p=>p.trim());
      // MCQ: index 0=প্রশ্ন, 1-4=অপশন, 5=correct, 6=ব্যাখ্যা(optional)
      if(parts.length<6)return entry;
      const q=parts[0];
      const opts=[parts[1],parts[2],parts[3],parts[4]];
      const correct=parts[5];
      const expl=parts[6]||"";
      // Fisher-Yates shuffle
      for(let i=opts.length-1;i>0;i--){
        const j=Math.floor(Math.random()*(i+1));
        [opts[i],opts[j]]=[opts[j],opts[i]];
      }
      // correct field = shuffled text-এ যেটা সঠিক (value same থাকে)
      const newLine=expl
        ?`${q} ; ${opts[0]} ; ${opts[1]} ; ${opts[2]} ; ${opts[3]} ; ${correct} ; ${expl}`
        :`${q} ; ${opts[0]} ; ${opts[1]} ; ${opts[2]} ; ${opts[3]} ; ${correct}`;
      shuffled++;
      return newLine;
    });
    // { } block ছিলে কিনা detect করি
    const wasBlock=/\{[\s\S]+?\}/.test(bulkText);
    const result=wasBlock
      ? newLines.map(l=>`{ ${l} }`).join("\n")
      : newLines.join("\n");
    setShuffleInfo({count:shuffled});
    handleText(result);
    setTimeout(()=>setShuffleInfo(null),3000);
  };

  /* Audience tag helpers */
  const addTag=()=>{
    const t=tagInput.trim();
    if(t&&!audienceTags.includes(t)){setAudienceTags(p=>[...p,t]);}
    setTagInput("");
  };
  const removeTag=(t)=>setAudienceTags(p=>p.filter(x=>x!==t));
  const QUICK_TAGS=["Job","Class 7","Computer Operator","Masters 1"];

  /* Build Firebase record — শেয়ার্ড buildBulkRecord ব্যবহার করে (AIImportPage direct-submit ও একই ফাংশন ব্যবহার করে) */
  const buildRec=(item,ts,id)=>buildBulkRecord({item,subject,subtopic,mode,qtype,audienceTags,ts,id});

  /* Main upload */
  const startUpload=async()=>{
    if(!subject.trim()){push("warn","⚠️ Subject লিখুন","");return;}
    if(!bulkText.trim()){push("warn","⚠️ প্রশ্ন লিখুন","");return;}
    const eff=getEffectiveType(mode,qtype);
    const entries=getEntries(bulkText).map(l=>parseEntry(l,eff)).filter(r=>r.ok);
    if(!entries.length){push("warn","⚠️ কোনো valid প্রশ্ন নেই — Validation chips-এ ক্লিক করে দেখুন","");return;}

    setRunning(true);setDone(false);setStopped(false);
    stopRef.current=false;
    setLog([]);
    setProgress({done:0,total:entries.length,sent:0,failed:0});
    const addLog=(msg,type)=>setLog(p=>[...p.slice(-99),{msg,type,id:Date.now()+Math.random()}]);

    if(saveLoc==="sheet"){
      const rows=entries.map(item=>buildSheetRow({item,subject,subtopic,qtype:eff,audienceTags}));
      const result=await saveRowsToSheet({rows,targetTab:mode,gasSecret,push});
      entries.forEach(item=>addLog(`… ${(item.q||"").substring(0,55)}...`,"ok"));
      setProgress({done:entries.length,total:entries.length,sent:result.added,failed:result.failedRows.length});
      setRunning(false);setDone(true);
      if(result.failedRows.length) pushFailedItems("বাল্ক আপলোডার",saveLoc,mode,result.failedRows);
      if(result.added>0)push("success",`✅ ${result.added}টি Sheet-এ যোগ হয়েছে!`,`${mode} — ${subject}`+(result.skipped?`, ${result.skipped}টা duplicate বাদ পড়েছে`:""));
      if(result.failedRows.length)push("error",`${result.failedRows.length}টি ব্যর্থ হয়েছে`,"নিচে ক্যাশ থেকে আবার পাঠানো যাবে");
      return;
    }

    let sent=0,failed=0; const failedRecs=[];
    const BATCH=8;
    for(let i=0;i<entries.length;i+=BATCH){
      if(stopRef.current){addLog("⛔ বন্ধ করা হয়েছে","err");break;}
      const batch=entries.slice(i,i+BATCH);
      await Promise.all(batch.map(async(item)=>{
        const ts=nowTs();
        const id=Date.now()+Math.floor(Math.random()*9999);
        const rec=buildRec(item,ts,id);
        try{
          const res=await fbPush(mode,rec);
          /* Set id field to the firebase push key — same as entry app */
          if(res?.name){
            await fbSet(`${mode}/${res.name}/id`,res.name);
          }
          // Sheet sync → GAS standalone handles this
          invalidate(mode);
          sent++;
          addLog(`✔ ${(item.q||"").substring(0,55)}...`,"ok");
        }catch(e){
          failed++;
          failedRecs.push(rec);
          addLog(`✗ ব্যর্থ: ${(item.q||"").substring(0,45)}... [${e.message}]`,"err");
        }
        setProgress(p=>({...p,done:p.done+1,sent,failed}));
      }));
    }
    setRunning(false);setDone(true);
    if(failedRecs.length) pushFailedItems("বাল্ক আপলোডার",saveLoc,mode,failedRecs);
    if(sent>0)push("success",`✅ ${sent}টি সফলভাবে যোগ হয়েছে!`,`${mode} — ${subject}`);
    if(failed>0)push("error",`${failed}টি ব্যর্থ হয়েছে`,"নিচে ক্যাশ থেকে আবার পাঠানো যাবে");
  };

  const reset=()=>{setBulkText("");setValidStats(null);setLog([]);setProgress({done:0,total:0,sent:0,failed:0});setDone(false);setSubtopic("");};

  const pct=progress.total?Math.round(progress.done/progress.total*100):0;

  return(
    <div className="page">
      {/* Header */}
      <div style={{background:`linear-gradient(135deg,${C.accent},#7c3aed)`,borderRadius:14,padding:"14px 16px",marginBottom:16,color:"#fff"}}>
        <div style={{fontWeight:900,fontSize:15,marginBottom:2}}>⚡ বাল্ক প্রশ্ন আপলোড</div>
        <div style={{fontSize:11,opacity:.8}}>একসাথে একাধিক প্রশ্ন Google Sheet অথবা Firebase-এ যোগ করুন</div>
      </div>

      <SaveLocationPicker value={saveLoc} onChange={setSaveLocP} gasSecret={gasSecret} onGasSecretChange={setGasSecretP}/>
      <FailedQueuePanel push={push} sourceFilter="বাল্ক আপলোডার"/>

      {/* Target Sheet */}
      <div style={{display:"flex",gap:6,marginBottom:12}}>
        {["Quiz","QBank","Study"].map(m=>(
          <button key={m} className={`ftab${mode===m?" on":""}`} onClick={()=>handleMode(m)} style={{flex:1}}>{m}</button>
        ))}
      </div>

      {/* Question Type */}
      {mode!=="Study"&&(
        <div style={{display:"flex",gap:6,marginBottom:12}}>
          {["MCQ","Written"].map(t=>(
            <button key={t} className={`tp2${qtype===t?" on":""}`} onClick={()=>handleQtype(t)}>{t}</button>
          ))}
        </div>
      )}

      {/* Audience Tags */}
      <div style={{background:C.panel,border:`1px solid ${C.border}`,borderRadius:12,padding:"10px 12px",marginBottom:12}}>
        <div style={{fontSize:10,fontWeight:800,color:C.muted,letterSpacing:".7px",marginBottom:7,textTransform:"uppercase"}}>🏷 Audience Tags</div>
        <div style={{display:"flex",gap:5,flexWrap:"wrap",marginBottom:7}}>
          {QUICK_TAGS.map(t=>(
            <button key={t} onClick={()=>{if(!audienceTags.includes(t))setAudienceTags(p=>[...p,t]);}}
              style={{fontSize:10,padding:"3px 9px",borderRadius:20,border:`1px solid ${audienceTags.includes(t)?C.accent:C.border}`,background:audienceTags.includes(t)?C.accent+"22":"transparent",color:audienceTags.includes(t)?C.accent:C.muted,cursor:"pointer",fontWeight:700}}>{t}</button>
          ))}
        </div>
        {audienceTags.length>0&&(
          <div style={{display:"flex",gap:5,flexWrap:"wrap",marginBottom:7}}>
            {audienceTags.map(t=>(
              <span key={t} style={{fontSize:11,padding:"2px 9px",borderRadius:20,background:C.accent,color:"#fff",fontWeight:700,display:"flex",alignItems:"center",gap:4}}>
                {t}<span onClick={()=>removeTag(t)} style={{cursor:"pointer",opacity:.8,marginLeft:2}}>×</span>
              </span>
            ))}
          </div>
        )}
        <div style={{display:"flex",gap:6}}>
          <input className="inp" style={{flex:1,marginBottom:0}} value={tagInput} onChange={e=>setTagInput(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"){e.preventDefault();addTag();}}} placeholder="Tag লিখুন..."/>
          <button className="btn bp" style={{padding:"0 14px",fontSize:13}} onClick={addTag}>+</button>
        </div>
      </div>

      {/* Subject & Subtopic */}
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:12}}>
        <div className="fld" style={{marginBottom:0}}>
          <label>📚 Subject</label>
          <input className="inp" list="bulk-sl" value={subject} onChange={e=>setSubject(e.target.value)} placeholder="Subject..."/>
          <datalist id="bulk-sl">{subjects.map((s,i)=><option key={i} value={s}/>)}</datalist>
        </div>
        <div className="fld" style={{marginBottom:0}}>
          <label>📌 Sub-Topic</label>
          <input className="inp" value={subtopic} onChange={e=>setSubtopic(e.target.value)} placeholder="Sub topic..."/>
        </div>
      </div>

      {/* Format Guide */}
      <div style={{background:"#0a1628",border:`1px solid ${C.border}`,borderRadius:12,padding:"10px 12px",marginBottom:10,fontSize:11,color:C.muted,lineHeight:1.7}}>
        <div style={{fontWeight:800,color:C.text,marginBottom:4}}>📋 ফরম্যাট (প্রতি লাইন = একটি প্রশ্ন):</div>
        <div><span style={{color:"#10b981",fontWeight:700}}>MCQ →</span> প্রশ্ন ; অপ১ ; অপ২ ; অপ৩ ; অপ৪ ; সঠিকউত্তর ; ব্যাখ্যা(optional)</div>
        <div><span style={{color:"#f59e0b",fontWeight:700}}>Written →</span> প্রশ্ন ; উত্তর ; ব্যাখ্যা(optional)</div>
        <div><span style={{color:"#818cf8",fontWeight:700}}>Study →</span> {"{"} প্রশ্ন ; উত্তর লাইন১\nউত্তর লাইন২... {"}"}</div>
      </div>

      {/* Validation Stats — clickable */}
      {validStats&&(
        <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:8}}>
          {[
            {label:`Total: ${validStats.total}`,color:"#94a3b8",bg:"#1e293b",filter:"all"},
            {label:`✔ Valid: ${validStats.ok}`,color:"#10b981",bg:"#052e16",filter:"ok"},
            {label:`Skip: ${validStats.skip}`,color:"#d97706",bg:"#1c1004",filter:"skip"},
            {label:`✗ Wrong: ${validStats.err}`,color:"#ef4444",bg:"#1f0a0a",filter:"err"},
          ].map(x=>(
            <span key={x.label} onClick={()=>{setShowDetail(x.filter);}} style={{fontSize:11,fontWeight:800,padding:"4px 12px",borderRadius:20,color:x.color,background:x.bg,cursor:"pointer",border:`1px solid ${x.color}44`}}>{x.label} 👁</span>
          ))}
        </div>
      )}

      {/* Validation Detail Modal */}
      {showDetail&&validDetail&&(
        <div style={{position:"fixed",inset:0,background:"#000000cc",zIndex:300,display:"flex",flexDirection:"column"}} onClick={()=>setShowDetail(false)}>
          <div style={{background:C.bg,marginTop:"auto",borderRadius:"18px 18px 0 0",maxHeight:"80vh",display:"flex",flexDirection:"column"}} onClick={e=>e.stopPropagation()}>
            {/* Modal Header */}
            <div style={{padding:"14px 16px 10px",borderBottom:`1px solid ${C.border}`,display:"flex",justifyContent:"space-between",alignItems:"center",flexShrink:0}}>
              <div style={{fontWeight:900,fontSize:14,color:C.text}}>
                {showDetail==="all"?"📋 সব এন্ট্রি":showDetail==="ok"?"✅ Valid এন্ট্রি":showDetail==="err"?"❌ Error এন্ট্রি":"⏭ Skip এন্ট্রি"}
              </div>
              <button onClick={()=>setShowDetail(false)} style={{background:"transparent",border:"none",color:C.muted,fontSize:18,cursor:"pointer"}}>✕</button>
            </div>
            {/* Modal Body */}
            <div style={{overflowY:"auto",padding:"10px 14px",flex:1}}>
              {validDetail
                .filter(r=>showDetail==="all"||r[showDetail])
                .map((r,i)=>(
                  <div key={i} style={{
                    background:r.ok?"#052e16":r.err?"#1f0a0a":r.skip?"#1c1004":C.panel,
                    border:`1px solid ${r.ok?"#10b98133":r.err?"#ef444433":"#d9770633"}`,
                    borderRadius:10,padding:"8px 12px",marginBottom:8
                  }}>
                    <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}>
                      <span style={{fontSize:10,fontWeight:800,color:C.muted}}>#{r.idx}</span>
                      <span style={{fontSize:10,fontWeight:800,
                        color:r.ok?"#10b981":r.err?"#ef4444":"#d97706",
                        background:r.ok?"#10b98122":r.err?"#ef444422":"#d9770622",
                        padding:"1px 8px",borderRadius:10
                      }}>
                        {r.ok?"✔ VALID":r.err?"✗ ERROR":"⏭ SKIP"}
                      </span>
                    </div>
                    {r.err&&<div style={{fontSize:11,color:"#ef4444",fontWeight:700,marginBottom:4}}>⚠ {r.reason}</div>}
                    <div style={{fontSize:11,color:C.muted,lineHeight:1.5,
                      maxHeight:80,overflowY:"auto",
                      whiteSpace:"pre-wrap",wordBreak:"break-word"
                    }}>
                      {r.entry?r.entry.substring(0,200)+(r.entry.length>200?"...":""):"(খালি)"}
                    </div>
                    {r.ok&&<div style={{fontSize:10,color:"#10b981",marginTop:4}}>
                      ❓ {(r.q||"").substring(0,60)}{r.q?.length>60?"...":""}
                    </div>}
                  </div>
                ))
              }
              {validDetail.filter(r=>showDetail==="all"||r[showDetail]).length===0&&(
                <div style={{textAlign:"center",color:C.muted,padding:24,fontSize:13}}>কোনো এন্ট্রি নেই</div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Bulk Textarea */}
      <div className="fld">
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:5}}>
          <label style={{marginBottom:0}}>প্রশ্নগুলো লিখুন / পেস্ট করুন</label>
          {getEffectiveType(mode,qtype)==="MCQ"&&bulkText.trim()&&(
            <button
              type="button"
              onClick={handleShuffle}
              style={{
                fontSize:11,fontWeight:800,padding:"4px 12px",borderRadius:20,
                border:`1px solid #f59e0b`,background:"#1c1004",color:"#f59e0b",
                cursor:"pointer",display:"flex",alignItems:"center",gap:5,whiteSpace:"nowrap",flexShrink:0
              }}
            >
              🔀 Options Shuffle
            </button>
          )}
        </div>
        {shuffleInfo&&(
          <div style={{fontSize:11,color:"#10b981",fontWeight:700,marginBottom:6,padding:"4px 10px",background:"#052e16",borderRadius:8,border:"1px solid #10b98133"}}>
            ✅ {shuffleInfo.count}টি প্রশ্নের অপশন shuffle হয়েছে!
          </div>
        )}
        <textarea className="ta" style={{minHeight:160,fontFamily:"monospace",fontSize:12}} value={bulkText}
          onChange={e=>handleText(e.target.value)}
          placeholder={mode==="Study"
            ?"{ প্রশ্ন ; উত্তর লাইন১\nউত্তর লাইন২ }\n{ পরের প্রশ্ন ; উত্তর }"
            :qtype==="Written"
            ?"{ প্রশ্ন ; উত্তর ; ব্যাখ্যা }\n{ পরের প্রশ্ন ; উত্তর }"
            :"{ প্রশ্ন ; অপ১ ; অপ২ ; অপ৩ ; অপ৪ ; সঠিকউত্তর ; ব্যাখ্যা }\n{ প্রশ্ন ; অপ১ ; অপ২ ; অপ৩ ; অপ৪ ; সঠিকউত্তর }"}
        />
      </div>

      {/* Progress Bar */}
      {(running||done)&&(
        <div style={{background:C.panel,border:`1px solid ${C.border}`,borderRadius:12,padding:"12px 14px",marginBottom:12}}>
          <div style={{display:"flex",justifyContent:"space-between",fontSize:11,marginBottom:6}}>
            <span style={{color:C.text,fontWeight:700}}>{done?"✅ সম্পন্ন!":"⏳ আপলোড হচ্ছে..."}</span>
            <span style={{color:C.accent,fontWeight:900}}>{pct}% ({progress.done}/{progress.total})</span>
          </div>
          <div style={{background:C.border,borderRadius:999,height:8,overflow:"hidden",marginBottom:8}}>
            <div style={{height:"100%",width:`${pct}%`,background:"linear-gradient(90deg,#6366f1,#3b82f6,#10b981)",borderRadius:999,transition:"width .25s ease"}}/>
          </div>
          <div style={{display:"flex",gap:12,fontSize:11}}>
            <span style={{color:"#10b981",fontWeight:700}}>✔ {progress.sent} সফল</span>
            {progress.failed>0&&<span style={{color:"#ef4444",fontWeight:700}}>✗ {progress.failed} ব্যর্থ</span>}
          </div>
          {/* Log */}
          {log.length>0&&(
            <div style={{maxHeight:110,overflowY:"auto",marginTop:8,fontSize:10,lineHeight:1.7,background:"#060c18",borderRadius:8,padding:"6px 10px"}}>
              {log.map(l=>(
                <div key={l.id} style={{color:l.type==="ok"?"#10b981":l.type==="err"?"#ef4444":"#d97706"}}>{l.msg}</div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Action Buttons */}
      <div style={{display:"flex",gap:8,marginTop:4}}>
        <button className="btn bp bb" style={{flex:2}} disabled={running} onClick={startUpload}>
          {running?"⏳ আপলোড হচ্ছে...":"📤 Submit Bulk Question"}
        </button>
        {running&&(
          <button className="btn" style={{flex:1,background:"#7f1d1d",color:"#fca5a5",borderColor:"#991b1b"}} onClick={()=>{stopRef.current=true;setStopped(true);}}>⛔ স্টপ</button>
        )}
        {(done||stopped)&&(
          <button className="btn" style={{flex:1,background:C.panel,color:C.muted,borderColor:C.border}} onClick={reset}>🗑 Clear</button>
        )}
      </div>
    </div>
  );
}

export { BulkUploaderPage };
