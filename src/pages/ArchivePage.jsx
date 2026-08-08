/* ══════════════════════════════════════════════════════════════════
   ARCHIVE PAGE — সব OCR/AI result এক জায়গায়
   — AI Import ও Multi-Subject Bulk Import (এবং ভবিষ্যতে অন্য যেকোনো
     AI-চালিত ফিচার) OCR/parse করার সাথে সাথেই এখানে auto-archive
     হয়ে যায় — আলাদা করে সেভ করার দরকার নেই
   — এন্ট্রি edit করা যায় (Subject/Sub-topic/Text), Bulk Upload পেজে
     পাঠানো যায়, অথবা সরাসরি Sheet/Firebase-এ Submit করা যায়
   — কোনো কারণে কাজ কেটে গেলে/হারিয়ে গেলে AI-কে আবার কল না করেই
     (limit বাঁচিয়ে) এখান থেকে ফিরে পাওয়া যায়
   ══════════════════════════════════════════════════════════════════ */
import React, { useState, useMemo, useEffect } from "react";
import { C } from "../core/config.js";
import { nowTs } from "../core/utils.js";
import {
  getBulkEntries, parseBulkEntry, buildBulkRecord, buildSheetRow,
  loadSaveLocPref, saveSaveLocPref, loadSharedGasSecret, saveSharedGasSecret, pushFailedItems
} from "../core/uploaderUtils.js";
import { saveRowsToSheet, fetchReferenceData } from "../core/sheetSave.js";
import { resolveSubjectTopicForEntries } from "../core/referenceHelpers.js";
import { archiveList, archiveUpdate, archiveDelete } from "../core/archiveStore.js";
import { SaveLocationPicker } from "../components/shared/SaveLocationPicker.jsx";
import { FailedQueuePanel } from "../components/shared/FailedQueuePanel.jsx";

const SRC_NAME="Archive";

function ArchivePage({push,onSendToBulk}){
  const[entries,setEntries]=useState(archiveList);
  const refresh=()=>setEntries(archiveList());
  const[filterSource,setFilterSource]=useState("All");
  const[search,setSearch]=useState("");
  const[expandedId,setExpandedId]=useState(null);
  const[editBuf,setEditBuf]=useState(null); // {subject,subtopic,qtype,text}
  const[targetMode,setTargetMode]=useState("Quiz");
  const[saveLoc,setSaveLoc]=useState(loadSaveLocPref);
  const setSaveLocP=(v)=>{ setSaveLoc(v); saveSaveLocPref(v); };
  const[gasSecret,setGasSecret]=useState(loadSharedGasSecret);
  const setGasSecretP=(v)=>{ setGasSecret(v); saveSharedGasSecret(v); };
  const[submittingId,setSubmittingId]=useState(null);

  /* ── Subjects/Topics রেফারেন্স টেবিল — Submit-এর আগে subject/topic টেক্সট থেকে
     subject_id/topic_id বের করতে লাগে (raw text sheet-এ যায় না) ── */
  const[refData,setRefData]=useState(null);
  useEffect(()=>{ fetchReferenceData({gasSecret}).then(setRefData).catch(()=>{}); },[gasSecret]);
  const subjectOptions=refData?(refData.subjects||[]).filter(s=>s.sheet===targetMode):[];

  const sources=useMemo(()=>["All",...new Set(entries.map(e=>e.source))],[entries]);
  const filtered=useMemo(()=>entries.filter(e=>{
    if(filterSource!=="All"&&e.source!==filterSource)return false;
    if(search.trim()){
      const s=search.trim().toLowerCase();
      const hay=`${e.subject} ${e.subtopic} ${e.text}`.toLowerCase();
      if(!hay.includes(s))return false;
    }
    return true;
  }),[entries,filterSource,search]);

  const countQ=(text)=>getBulkEntries(text||"").filter(l=>l.trim()).length;

  const startEdit=(e)=>{ setExpandedId(e.id); setEditBuf({subject:e.subject,subtopic:e.subtopic,qtype:e.qtype,text:e.text}); };
  const cancelEdit=()=>{ setExpandedId(null); setEditBuf(null); };
  const saveEdit=(id)=>{
    archiveUpdate(id,editBuf);
    refresh();
    setExpandedId(null); setEditBuf(null);
    push("success","✅ সংরক্ষণ হয়েছে","");
  };
  const doDelete=(id)=>{
    archiveDelete(id); refresh();
    if(expandedId===id){setExpandedId(null);setEditBuf(null);}
  };
  const currentOf=(e)=>expandedId===e.id&&editBuf?editBuf:e;

  const doSendToBulk=(e)=>{
    const src=currentOf(e);
    if(!src.text.trim()){push("warn","⚠️ কোনো ডেটা নেই","");return;}
    onSendToBulk({text:src.text,subject:src.subject,subtopic:src.subtopic,qtype:src.qtype,archiveId:e.id});
    push("success","📤 Bulk পেজে পাঠানো হয়েছে","review করে Upload করুন");
  };

  const doSubmit=async(e)=>{
    const src=currentOf(e);
    if(!src.text.trim()){push("warn","⚠️ কোনো ডেটা নেই","");return;}
    const effQtype=src.qtype||"Written";
    const items=getBulkEntries(src.text).map(l=>parseBulkEntry(l,effQtype)).filter(r=>r.ok);
    if(!items.length){push("warn","⚠️ কোনো valid প্রশ্ন পাওয়া যায়নি","format ঠিক আছে কিনা দেখুন");return;}
    const subject=(src.subject||"").trim();
    const subtopic=(src.subtopic||"").trim()||subject;
    if(!subject && !items.some(i=>i.subject)){
      push("warn","⚠️ Subject লিখুন (উপরে এডিট করে, অথবা প্রতিটা লাইনে Subject;Topic টাইপ করো)","");return;
    }
    if(!refData){push("warn","⏳ Reference data এখনো লোড হচ্ছে, একটু পর আবার চেষ্টা করো","");return;}
    setSubmittingId(e.id);

    // ── প্রতিটা এন্ট্রির subject/topic (বা fallback হিসেবে Archive entry-র subject/subtopic)
    // থেকে subject_id/topic_id রেজলভ করা হয় — raw text কখনো sheet-এ যায় না (QBank-এ তো
    // plain "subject" কলামই নেই) ──
    const r=await resolveSubjectTopicForEntries({
      entries:items, subjectOptions, topicsAll:refData?.topics||[], gasSecret, sheet:targetMode, push,
      fallbackSubject:subject, fallbackTopic:subtopic,
    });
    if(!r.ok){ setSubmittingId(null); push("error","❌ "+r.reason,""); return; }
    if(r.anyCreated) fetchReferenceData({gasSecret}).then(setRefData).catch(()=>{});

    const rows=r.resolved.map(({item,subjectId,topicId,subjectName,topicName})=>buildSheetRow({
      item, subject:subjectName, subtopic:topicName,
      qtype:effQtype, audienceTags:[], subjectId, topicId,
    }));
    const res=await saveRowsToSheet({rows,targetTab:targetMode,gasSecret,push});
    if(res.failedRows.length) pushFailedItems(SRC_NAME,"sheet",targetMode,res.failedRows);
    setSubmittingId(null);
    const subjLabel=[...new Set(r.resolved.map(x=>x.subjectName))].join(", ");
    if(res.added>0) push("success",`✅ ${res.added}টি Sheet-এ যোগ হয়েছে!`,`${targetMode} — ${subjLabel}`+(res.skipped?`, ${res.skipped}টা duplicate বাদ পড়েছে`:""));
    if(res.failedRows.length) push("error",`${res.failedRows.length}টি ব্যর্থ হয়েছে`,"নিচে ক্যাশ থেকে আবার পাঠানো যাবে");
    if(res.added>0||res.skipped>0){
      archiveDelete(e.id); refresh();
      if(expandedId===e.id){setExpandedId(null);setEditBuf(null);}
    }
  };

  return(
    <div className="page">
      {/* Header */}
      <div style={{background:"linear-gradient(135deg,#7c3aed,#0891b2)",borderRadius:14,padding:"14px 16px",marginBottom:14,color:"#fff"}}>
        <div style={{fontWeight:900,fontSize:15,marginBottom:2}}>🗄️ Archive — সব OCR/AI Result</div>
        <div style={{fontSize:11,opacity:.85}}>AI Import ও Multi-Subject Import-এর প্রতিটা result এখানে auto-save হয় — edit/reuse/submit করা যায়</div>
      </div>

      <div style={{background:"#0a1628",border:`1px solid ${C.border}`,borderRadius:10,padding:"8px 12px",fontSize:11,color:C.muted,marginBottom:12,lineHeight:1.7}}>
        <div>📦 মোট <b style={{color:C.text}}>{entries.length}</b>টা এন্ট্রি জমা আছে (ডিভাইসেই, অফলাইনেও থাকবে)</div>
        <div>🔁 কোনো কারণে সাবমিট করা বাকি থেকে গেলে/হারিয়ে গেলে — এখান থেকে আবার AI কল ছাড়াই Bulk পেজে পাঠাও অথবা সরাসরি Submit করো</div>
      </div>

      {/* Target Sheet + Save Location — সরাসরি Submit করার সময় লাগবে */}
      <div style={{background:C.panel,border:`1px solid ${C.border}`,borderRadius:12,padding:"10px 14px",marginBottom:12}}>
        <div style={{fontSize:11,fontWeight:800,color:C.text,marginBottom:8}}>🎯 Direct Submit করার Target</div>
        <div style={{display:"flex",gap:6,marginBottom:10}}>
          {["Quiz","QBank"].map(m=>(
            <button key={m} type="button" onClick={()=>setTargetMode(m)}
              style={{flex:1,fontSize:12,fontWeight:700,padding:"7px 0",borderRadius:8,cursor:"pointer",
                border:`1px solid ${targetMode===m?C.accent:C.border}`,
                background:targetMode===m?C.accent+"22":"transparent",
                color:targetMode===m?C.accent:C.muted}}>{m}</button>
          ))}
        </div>
        <SaveLocationPicker value={saveLoc} onChange={setSaveLocP} gasSecret={gasSecret} onGasSecretChange={setGasSecretP}/>
      </div>

      {/* Filter + Search */}
      <div style={{display:"flex",gap:6,overflowX:"auto",marginBottom:8,paddingBottom:2}}>
        {sources.map(s=>(
          <button key={s} onClick={()=>setFilterSource(s)}
            style={{whiteSpace:"nowrap",fontSize:11,fontWeight:700,padding:"5px 12px",borderRadius:20,cursor:"pointer",
              border:`1px solid ${filterSource===s?"#7c3aed":C.border}`,
              background:filterSource===s?"#7c3aed22":"transparent",
              color:filterSource===s?"#a78bfa":C.muted}}>{s}</button>
        ))}
      </div>
      <input className="inp" style={{marginBottom:12}} value={search} onChange={e=>setSearch(e.target.value)}
        placeholder="🔍 Subject/Sub-topic/টেক্সট দিয়ে খুঁজুন..."/>

      {/* Empty state */}
      {filtered.length===0&&(
        <div style={{textAlign:"center",padding:"30px 10px",color:C.muted,fontSize:12}}>
          {entries.length===0?"এখনো কোনো OCR/AI result আর্কাইভ হয়নি — AI Import বা Multi-Subject Import ব্যবহার করলে এখানে জমা হবে":"এই ফিল্টারে কিছু পাওয়া যায়নি"}
        </div>
      )}

      {/* Entry list */}
      {filtered.map(e=>{
        const isOpen=expandedId===e.id;
        const src=currentOf(e);
        return(
          <div key={e.id} style={{background:C.panel,border:`1px solid ${C.border}`,borderRadius:12,padding:"10px 14px",marginBottom:10}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:6,gap:8}}>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontSize:10,fontWeight:800,color:"#a78bfa",marginBottom:2}}>{e.source} · {e.qtype}</div>
                <div style={{fontSize:12,fontWeight:700,color:C.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                  📚 {e.subject||"(Subject নেই)"} <span style={{color:C.muted,fontWeight:400}}>/ {e.subtopic||"—"}</span>
                </div>
                <div style={{fontSize:10,color:C.muted,marginTop:2}}>🕐 {e.ts} · {countQ(e.text)}টি প্রশ্ন</div>
              </div>
            </div>

            {!isOpen&&(
              <div style={{fontSize:11,color:C.muted,background:"#0a1628",borderRadius:8,padding:"6px 10px",marginBottom:8,
                overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{e.text.replace(/[{}]/g,"").slice(0,90)}...</div>
            )}

            {isOpen&&(
              <div style={{marginBottom:8}}>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:8}}>
                  <div className="fld" style={{marginBottom:0}}>
                    <label>📚 Subject</label>
                    <input className="inp" value={editBuf.subject} onChange={ev=>setEditBuf(p=>({...p,subject:ev.target.value}))}/>
                  </div>
                  <div className="fld" style={{marginBottom:0}}>
                    <label>📌 Sub-topic</label>
                    <input className="inp" value={editBuf.subtopic} onChange={ev=>setEditBuf(p=>({...p,subtopic:ev.target.value}))}/>
                  </div>
                </div>
                <div style={{display:"flex",gap:6,marginBottom:8}}>
                  {["MCQ","Written","Study"].map(t=>(
                    <button key={t} type="button" onClick={()=>setEditBuf(p=>({...p,qtype:t}))}
                      style={{flex:1,fontSize:11,fontWeight:700,padding:"5px 0",borderRadius:8,cursor:"pointer",
                        border:`1px solid ${editBuf.qtype===t?C.accent:C.border}`,
                        background:editBuf.qtype===t?C.accent+"22":"transparent",
                        color:editBuf.qtype===t?C.accent:C.muted}}>{t}</button>
                  ))}
                </div>
                <textarea className="ta" style={{minHeight:140,fontSize:11,fontFamily:"monospace",marginBottom:0}}
                  value={editBuf.text} onChange={ev=>setEditBuf(p=>({...p,text:ev.target.value}))}/>
              </div>
            )}

            <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
              {!isOpen?(
                <button className="btn" onClick={()=>startEdit(e)} style={{fontSize:11,padding:"5px 10px",background:"transparent",color:C.muted,borderColor:C.border}}>✏️ Edit</button>
              ):(
                <>
                  <button className="btn" onClick={()=>saveEdit(e.id)} style={{fontSize:11,padding:"5px 10px",background:"#052e16",color:"#10b981",borderColor:"#10b981"}}>💾 Save</button>
                  <button className="btn" onClick={cancelEdit} style={{fontSize:11,padding:"5px 10px",background:"transparent",color:C.muted,borderColor:C.border}}>✕ Cancel</button>
                </>
              )}
              <button className="btn" onClick={()=>doSendToBulk(e)} style={{fontSize:11,padding:"5px 10px",background:"#0a1628",color:"#22d3ee",borderColor:"#0891b2"}}>📤 Bulk-এ পাঠাও</button>
              <button className="btn" disabled={submittingId===e.id} onClick={()=>doSubmit(e)}
                style={{fontSize:11,padding:"5px 10px",background:"#1a0a2e",color:"#a78bfa",borderColor:"#7c3aed"}}>
                {submittingId===e.id?"⏳ Submit হচ্ছে...":"🚀 সরাসরি Submit"}
              </button>
              <button className="btn" onClick={()=>doDelete(e.id)} style={{fontSize:11,padding:"5px 10px",background:"#2a0a0a",color:"#ef4444",borderColor:"#991b1b",marginLeft:"auto"}}>🗑</button>
            </div>
          </div>
        );
      })}

      <FailedQueuePanel push={push} sourceFilter={SRC_NAME}/>
    </div>
  );
}

export { ArchivePage };
