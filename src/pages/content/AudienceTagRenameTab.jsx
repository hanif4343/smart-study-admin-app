/* ══════════ AUDIENCE TAG RENAME TAB ══════════ */
import React, { useState, useEffect, useCallback, useMemo } from "react";
import { C } from "../../core/config.js";
import { useFB, invalidate } from "../../core/dataCache.js";
import { fbPatch, fbPatchBatch } from "../../core/firebase.js";
import { toArr } from "../../core/utils.js";
import { AudienceRenameModal } from "./AudienceRenameModal.jsx";

function AudienceTagRenameTab({push,tick}){
  const SHEETS=["Quiz","QBank","Study"];

  // Load all 3 sheets
  const{data:qbRaw,loading:qbL}=useFB("QBank",tick);
  const{data:qzRaw,loading:qzL}=useFB("Quiz",tick);
  const{data:stRaw,loading:stL}=useFB("Study",tick);

  const loading=qbL||qzL||stL;

  const[renameTarget,setRenameTarget]=useState(null);
  const[newName,setNewName]=useState("");
  const[renaming,setRenaming]=useState(false);

  // ── Bulk Add Audience Tag state ──
  const[bulkMode,setBulkMode]=useState("subject"); // "subject" | "topic"
  const[bulkSheet,setBulkSheet]=useState("Quiz");
  const[bulkTag,setBulkTag]=useState("");
  const[bulkSelected,setBulkSelected]=useState(new Set());
  const[bulkAdding,setBulkAdding]=useState(false);
  const[bulkProgress,setBulkProgress]=useState({done:0,total:0});

  // Subject/Topic list from selected sheet
  const bulkSheetData=useMemo(()=>{
    const raw=bulkSheet==="QBank"?qbRaw:bulkSheet==="Quiz"?qzRaw:stRaw;
    return toArr(raw);
  },[bulkSheet,qbRaw,qzRaw,stRaw]);

  const bulkGroupList=useMemo(()=>{
    const map={};
    bulkSheetData.forEach(q=>{
      const key=bulkMode==="subject"
        ?(q.Subject||q.subject||"").trim()
        :(q.Sub_topic||q.sub_topic||q.SubTopic||q.subTopic||"").trim(); // subtopic, not topic
      if(!key)return;
      if(!map[key])map[key]={count:0,hasMissing:false};
      map[key].count++;
      const tag=(q.AudienceTags||q.audienceTags||q.audience_tags||"").trim();
      if(!tag)map[key].hasMissing=true;
    });
    return Object.entries(map).sort((a,b)=>a[0].localeCompare(b[0],"bn"));
  },[bulkSheetData,bulkMode]);

  const toggleBulkSelect=useCallback((key)=>{
    setBulkSelected(prev=>{
      const next=new Set(prev);
      next.has(key)?next.delete(key):next.add(key);
      return next;
    });
  },[]);

  const selectAll=useCallback(()=>{
    setBulkSelected(new Set(bulkGroupList.map(([k])=>k)));
  },[bulkGroupList]);

  const clearSel=useCallback(()=>setBulkSelected(new Set()),[]);

  const doBulkAddTag=async()=>{
    if(!bulkTag.trim()){push("warn","Audience Tag লিখুন","");return;}
    if(bulkSelected.size===0){push("warn","Subject/Topic সিলেক্ট করুন","");return;}
    setBulkAdding(true);
    try{
      const tag=bulkTag.trim();
      const affected=bulkSheetData.filter(q=>{
        const key=bulkMode==="subject"
          ?(q.Subject||q.subject||"").trim()
          :(q.Topic||q.topic||q.Sub_topic||q.sub_topic||"").trim();
        return bulkSelected.has(key);
      });
      setBulkProgress({done:0,total:affected.length});
      const fieldKey=affected.find(q=>q.AudienceTags!=null)?"AudienceTags":
                    affected.find(q=>q.audienceTags!=null)?"audienceTags":"AudienceTags";
      const patchItems=affected.map(q=>{
        if(!q._fbKey)return null;
        return{path:`${bulkSheet}/${q._fbKey}`,data:{[fieldKey]:tag}};
      }).filter(Boolean);

      // Batch patch with progress
      const CONC=20;
      let done=0;
      for(let i=0;i<patchItems.length;i+=CONC){
        const chunk=patchItems.slice(i,i+CONC);
        await Promise.all(chunk.map(({path,data})=>fbPatch(path,data)));
        done+=chunk.length;
        setBulkProgress({done,total:affected.length});
      }
      invalidate(bulkSheet);
      push("success","✅ Audience Tag সেট!",`"${tag}" → ${done}টি question এ বসানো হয়েছে`);
      setBulkSelected(new Set());
      setBulkTag("");
    }catch(e){push("error","ব্যর্থ",e.message);}
    setBulkProgress({done:0,total:0});
    setBulkAdding(false);
  };

  // Collect all unique AudienceTags across all sheets with count & which sheets they appear in
  const tagList=useMemo(()=>{
    const map={}; // tag -> {count, sheets: {QBank:n, Quiz:n, Study:n}}
    [[qbRaw,"QBank"],[qzRaw,"Quiz"],[stRaw,"Study"]].forEach(([raw,sheet])=>{
      toArr(raw).forEach(q=>{
        const tag=(q.AudienceTags||q.audienceTags||q.audience_tags||"").trim();
        if(!tag)return;
        if(!map[tag])map[tag]={count:0,sheets:{}};
        map[tag].count++;
        map[tag].sheets[sheet]=(map[tag].sheets[sheet]||0)+1;
      });
    });
    return Object.entries(map).sort((a,b)=>b[1].count-a[1].count);
  },[qbRaw,qzRaw,stRaw]);

  const doRename=async()=>{
    if(!newName.trim()||!renameTarget){push("warn","নতুন নাম দিন","");return;}
    if(newName.trim()===renameTarget.tag){push("info","একই নাম","");return;}
    setRenaming(true);
    try{
      const oldTag=renameTarget.tag;
      const nTag=newName.trim();
      let totalUpdated=0;

      for(const sheet of SHEETS){
        const raw=sheet==="QBank"?qbRaw:sheet==="Quiz"?qzRaw:stRaw;
        const allQ=toArr(raw);
        const affected=allQ.filter(q=>{
          const t=(q.AudienceTags||q.audienceTags||q.audience_tags||"").trim();
          return t===oldTag;
        });
        if(affected.length===0)continue;

        // ⚡ Parallel batch PATCH (20 concurrent)
        const patchItems=affected.map(q=>{
          const fkey=q._fbKey;if(!fkey)return null;
          const fieldKey=q.AudienceTags!=null?"AudienceTags":q.audienceTags!=null?"audienceTags":"audience_tags";
          return {path:`${sheet}/${fkey}`,data:{[fieldKey]:nTag}};
        }).filter(Boolean);
        const sheetDone=await fbPatchBatch(patchItems);
        totalUpdated+=sheetDone;
        invalidate(sheet);
      }

      push("success","✅ Audience Tag Rename সম্পন্ন!",`"${oldTag}" → "${nTag}" · ${totalUpdated}টি কন্টেন্ট`);
      setRenameTarget(null);
      setNewName("");
    }catch(e){push("error","Rename ব্যর্থ",e.message);}
    setRenaming(false);
  };

  const bulkPct=bulkProgress.total>0?Math.round(bulkProgress.done/bulkProgress.total*100):0;

  return(
    <>
      {/* ══ BULK ADD AUDIENCE TAG ══ */}
      <div style={{background:`${C.green}10`,border:`1px solid ${C.green}30`,borderRadius:12,padding:"12px 14px",marginBottom:14}}>
        <div style={{fontWeight:700,color:C.green,marginBottom:10,fontSize:13}}>➕ Bulk Audience Tag সেট করুন</div>

        {/* Sheet selector */}
        <div style={{display:"flex",gap:6,marginBottom:10}}>
          {["Quiz","QBank","Study"].map(s=>(
            <button key={s} onClick={()=>{setBulkSheet(s);setBulkSelected(new Set());}}
              style={{flex:1,padding:"5px 0",borderRadius:8,fontSize:11,fontWeight:700,border:"none",cursor:"pointer",
                background:bulkSheet===s?C.green:"transparent",
                color:bulkSheet===s?"#fff":C.muted,
                outline:bulkSheet===s?"none":`1px solid ${C.border}`}}>
              {s}
            </button>
          ))}
        </div>

        {/* Mode: Subject or Topic */}
        <div style={{display:"flex",gap:6,marginBottom:10}}>
          <button onClick={()=>{setBulkMode("subject");setBulkSelected(new Set());}}
            style={{flex:1,padding:"5px 0",borderRadius:8,fontSize:11,fontWeight:700,border:"none",cursor:"pointer",
              background:bulkMode==="subject"?C.accent:"transparent",
              color:bulkMode==="subject"?"#fff":C.muted,
              outline:bulkMode==="subject"?"none":`1px solid ${C.border}`}}>
            📚 Subject অনুযায়ী
          </button>
          <button onClick={()=>{setBulkMode("topic");setBulkSelected(new Set());}}
            style={{flex:1,padding:"5px 0",borderRadius:8,fontSize:11,fontWeight:700,border:"none",cursor:"pointer",
              background:bulkMode==="topic"?C.accent:"transparent",
              color:bulkMode==="topic"?"#fff":C.muted,
              outline:bulkMode==="topic"?"none":`1px solid ${C.border}`}}>
            🏷️ Subtopic অনুযায়ী
          </button>
        </div>

        {/* Tag input */}
        <div style={{marginBottom:10}}>
          <input className="inp" placeholder="Audience Tag লিখুন (যেমন: Job, SSC, HSC)"
            value={bulkTag} onChange={e=>setBulkTag(e.target.value)}
            style={{width:"100%",boxSizing:"border-box"}}/>
        </div>

        {/* Select all / clear */}
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
          <span style={{fontSize:11,color:C.muted}}>
            {bulkSelected.size>0?`${bulkSelected.size}টি সিলেক্ট`:`${bulkGroupList.length}টি ${bulkMode==="subject"?"Subject":"Subtopic"}`}
          </span>
          <div style={{display:"flex",gap:6}}>
            <button onClick={selectAll} style={{fontSize:10,padding:"3px 8px",borderRadius:6,border:`1px solid ${C.border}`,background:"transparent",color:C.muted,cursor:"pointer"}}>সব</button>
            <button onClick={clearSel} style={{fontSize:10,padding:"3px 8px",borderRadius:6,border:`1px solid ${C.border}`,background:"transparent",color:C.muted,cursor:"pointer"}}>বাদ</button>
          </div>
        </div>

        {/* Subject/Topic list */}
        <div style={{maxHeight:220,overflowY:"auto",marginBottom:10,display:"flex",flexDirection:"column",gap:4}}>
          {loading?<div style={{color:C.muted,fontSize:11,textAlign:"center",padding:8}}>⏳ লোড হচ্ছে...</div>:
           bulkGroupList.length===0?<div style={{color:C.muted,fontSize:11,textAlign:"center",padding:8}}>কিছু নেই</div>:
           bulkGroupList.map(([key,info])=>{
            const sel=bulkSelected.has(key);
            return(
              <div key={key} onClick={()=>toggleBulkSelect(key)}
                style={{display:"flex",alignItems:"center",gap:8,padding:"7px 10px",borderRadius:8,cursor:"pointer",
                  background:sel?`${C.accent}22`:C.panel,
                  border:`1px solid ${sel?C.accent:C.border}`,
                  transition:"all .15s"}}>
                <div style={{width:16,height:16,borderRadius:4,flexShrink:0,
                  background:sel?C.accent:"transparent",
                  border:`2px solid ${sel?C.accent:C.muted}`,
                  display:"flex",alignItems:"center",justifyContent:"center"}}>
                  {sel&&<span style={{color:"#fff",fontSize:10,lineHeight:1}}>✓</span>}
                </div>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontSize:12,fontWeight:sel?700:400,color:sel?C.text:C.muted,
                    whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{key}</div>
                </div>
                <div style={{fontSize:10,color:C.muted,flexShrink:0}}>{info.count}টি</div>
                {info.hasMissing&&<span style={{fontSize:9,color:C.yellow,flexShrink:0}}>⚠️ফাঁকা</span>}
              </div>
            );
          })}
        </div>

        {/* Progress */}
        {bulkAdding&&bulkProgress.total>0&&(
          <div style={{marginBottom:8}}>
            <div style={{display:"flex",justifyContent:"space-between",fontSize:10,color:C.muted,marginBottom:3}}>
              <span>⚡ সেট হচ্ছে…</span>
              <span style={{fontWeight:700,color:C.green}}>{bulkProgress.done}/{bulkProgress.total} ({bulkPct}%)</span>
            </div>
            <div style={{height:5,background:C.border,borderRadius:5}}>
              <div style={{height:"100%",width:bulkPct+"%",background:C.green,borderRadius:5,transition:"width .3s"}}/>
            </div>
          </div>
        )}

        {/* Apply button */}
        <button onClick={doBulkAddTag} disabled={bulkAdding||bulkSelected.size===0||!bulkTag.trim()}
          style={{width:"100%",padding:"9px 0",borderRadius:10,border:"none",cursor:"pointer",fontWeight:700,fontSize:13,
            background:bulkSelected.size>0&&bulkTag.trim()?C.green:"#1a2a1a",
            color:bulkSelected.size>0&&bulkTag.trim()?"#fff":C.muted,
            transition:"all .2s"}}>
          {bulkAdding?`⏳ ${bulkPct}% হচ্ছে…`:`✅ ${bulkSelected.size>0?bulkSelected.size+"টিতে":"সিলেক্ট করুন"} Tag সেট করুন`}
        </button>
      </div>

      {/* ══ RENAME SECTION ══ */}
      <div style={{background:`${C.accent}12`,border:`1px solid ${C.accent}30`,borderRadius:10,padding:"9px 12px",marginBottom:12,fontSize:11}}>
        <div style={{fontWeight:700,color:C.accent,marginBottom:3}}>✏️ Audience Tag Rename</div>
        <div style={{color:C.muted,lineHeight:1.6}}>
          QBank, Quiz ও Study — তিনটি শিটে একসাথে AudienceTags আপডেট হবে।
        </div>
      </div>

      <div style={{fontSize:11,color:C.muted,marginBottom:10}}>
        {loading?"⏳ লোড হচ্ছে...":`${tagList.length}টি Audience Tag পাওয়া গেছে`}
      </div>

      {/* Tag list */}
      {loading?[...Array(4)].map((_,i)=><div key={i} className="sk" style={{height:56,marginBottom:7}}/>):
       tagList.length===0?
        <div className="empty"><div className="ei">🎯</div><p>কোনো AudienceTags নেই</p></div>:
        tagList.map(([tag,info])=>(
          <div key={tag} style={{
            background:C.panel,border:`1px solid ${C.border}`,borderRadius:11,
            padding:"11px 12px",marginBottom:7,
            display:"flex",alignItems:"center",gap:10
          }}>
            <div style={{flex:1,minWidth:0}}>
              <div style={{fontWeight:700,fontSize:13,marginBottom:3}}>{tag}</div>
              <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
                {Object.entries(info.sheets).map(([sh,n])=>(
                  <span key={sh} style={{
                    fontSize:9,fontWeight:700,padding:"1px 6px",borderRadius:6,
                    background:sh==="QBank"?`${C.green}20`:sh==="Quiz"?`${C.accent}20`:`${C.yellow}20`,
                    color:sh==="QBank"?C.green:sh==="Quiz"?C.accent:C.yellow,
                    border:`1px solid ${sh==="QBank"?C.green:sh==="Quiz"?C.accent:C.yellow}40`
                  }}>{sh}: {n}টি</span>
                ))}
              </div>
            </div>
            <div style={{fontWeight:700,fontSize:15,color:C.muted,minWidth:28,textAlign:"right"}}>{info.count}</div>
            <button
              className="btn"
              style={{padding:"5px 11px",fontSize:11,background:C.accent+"22",color:C.accent,border:`1px solid ${C.accent}33`,flexShrink:0}}
              onClick={()=>{setRenameTarget({tag,count:info.count});setNewName(tag);}}
            >✏️ Rename</button>
          </div>
        ))
      }

      {/* Rename Modal */}
      {renameTarget&&(
        <AudienceRenameModal
          target={renameTarget}
          newName={newName}
          setNewName={setNewName}
          onCancel={()=>{setRenameTarget(null);setNewName("");}}
          onRename={doRename}
          renaming={renaming}
        />
      )}
    </>
  );
}

export { AudienceTagRenameTab };
