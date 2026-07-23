/* ══════════ BROWSE TAB (Content Manager) ══════════ */
import React, { useState, useEffect, useMemo } from "react";
import { C } from "../../core/config.js";
import { useFB, invalidate } from "../../core/dataCache.js";
import { fbDelete } from "../../core/firebase.js";
import { toArr } from "../../core/utils.js";
import { DeleteWarningModal } from "../../components/shared/DeleteWarningModal.jsx";
import { InlineEditModal } from "./InlineEditModal.jsx";

function BrowseTab({push,tick}){
  const[sheet,setSheet]=useState("QBank");
  const{data:raw,loading}=useFB(sheet,tick);
  const[search,setSearch]=useState("");
  const[filterSub,setFilterSub]=useState("all");
  const[filterAudience,setFilterAudience]=useState("all");
  const[viewMode,setViewMode]=useState("all"); // "all" | "duplicates"
  const[editing,setEditing]=useState(null);
  const[delTarget,setDelTarget]=useState(null);
  const[delLoading,setDelLoading]=useState(false);
  const[bulkDelTargets,setBulkDelTargets]=useState(null); // array of qs to bulk delete
  const[bulkDelLoading,setBulkDelLoading]=useState(false);
  const[page,setPage]=useState(0);
  const PAGE=20;

  const allQ=useMemo(()=>toArr(raw).reverse(),[raw]);
  const subjects=useMemo(()=>["all",...new Set(allQ.map(q=>(q.Subject||q.subject||"").trim()).filter(Boolean))]
  ,[allQ]);

  // Collect all unique AudienceTags from current sheet, sorted by count
  const audienceTags=useMemo(()=>{
    const map={};
    allQ.forEach(q=>{
      const tagRaw=(q.AudienceTags||q.audienceTags||q.audience_tags||"").trim();
      if(!tagRaw)return;
      tagRaw.split(",").map(t=>t.trim()).filter(Boolean).forEach(t=>{
        map[t]=(map[t]||0)+1;
      });
    });
    return Object.entries(map).sort((a,b)=>b[1]-a[1]).map(([t,c])=>({tag:t,count:c}));
  },[allQ]);

  // Duplicate detection: same Question + AudienceTags + Subject + Sub_topic
  const duplicateGroups=useMemo(()=>{
    const map={};
    allQ.forEach(q=>{
      const qtext=(q.Question||q.question||"").trim().toLowerCase();
      const atag=(q.AudienceTags||q.audienceTags||q.audience_tags||"").trim().toLowerCase();
      const subj=(q.Subject||q.subject||"").trim().toLowerCase();
      const subt=(q.Sub_topic||q.sub_topic||"").trim().toLowerCase();
      if(!qtext)return;
      const key=`${qtext}|||${atag}|||${subj}|||${subt}`;
      if(!map[key])map[key]=[];
      map[key].push(q);
    });
    // Only groups with 2+ items are duplicates
    return Object.values(map).filter(g=>g.length>1);
  },[allQ]);

  // Flat list of all duplicate questions (keep originals marked)
  const duplicateQs=useMemo(()=>{
    const seen=new Set();
    const result=[];
    duplicateGroups.forEach(group=>{
      // First item = original (newest since reversed), rest = duplicates to delete
      group.forEach((q,idx)=>{
        if(!seen.has(q._fbKey)){
          seen.add(q._fbKey);
          result.push({...q,_isDupOriginal:idx===0,_dupGroup:group.length});
        }
      });
    });
    return result;
  },[duplicateGroups]);

  const filtered=useMemo(()=>{
    let arr=viewMode==="duplicates"?duplicateQs:allQ;
    if(filterAudience!=="all"){
      arr=arr.filter(q=>{
        const tagRaw=(q.AudienceTags||q.audienceTags||q.audience_tags||"").trim();
        return tagRaw.split(",").map(t=>t.trim()).includes(filterAudience);
      });
    }
    if(filterSub!=="all")arr=arr.filter(q=>(q.Subject||q.subject||"").trim()===filterSub);
    if(search.trim()){
      const qlo=search.toLowerCase();
      arr=arr.filter(q=>[(q.Question||q.question||""),(q.Subject||q.subject||""),(q.Sub_topic||q.sub_topic||""),(q.Correct||q.correct||"")].join(" ").toLowerCase().includes(qlo));
    }
    return arr;
  },[allQ,filterSub,filterAudience,search]);

  useEffect(()=>setPage(0),[sheet,filterSub,filterAudience,search]);

  const pageSlice=useMemo(()=>filtered.slice(page*PAGE,(page+1)*PAGE),[filtered,page]);
  const totalPages=Math.ceil(filtered.length/PAGE);

  const hardDelete=async()=>{
    if(!delTarget)return;
    setDelLoading(true);
    try{
      const fkey=delTarget._fbKey;
      const qid=(delTarget.ID||delTarget.id||"").toString();
      if(fkey){await fbDelete(`${sheet}/${fkey}`);invalidate(sheet);}
      push("success","🗑️ ডিলিট!",`#${qid}`);
      setDelTarget(null);
    }catch(e){push("error","ডিলিট ব্যর্থ",String(e?.message||e||"unknown"));}
    setDelLoading(false);
  };

  const bulkDeleteDuplicates=async(qs)=>{
    if(!qs||qs.length===0)return;
    setBulkDelLoading(true);
    try{
      // ⚡ Single multi-path PATCH — deletes all duplicates in one Firebase call
      const keys=qs.map(q=>q._fbKey).filter(Boolean);
      const deleted=await fbDeleteBatch(sheet, keys);
      invalidate(sheet);
      push("success",`🗑️ ${deleted}টি duplicate ডিলিট!`,"");
      setBulkDelTargets(null);
    }catch(e){push("error","Bulk ডিলিট ব্যর্থ",String(e?.message||e||"unknown"));}
    setBulkDelLoading(false);
  };

  return(
    <>
      {/* Sheet tabs + Audience selector row */}
      <div style={{display:"flex",gap:6,marginBottom:8,alignItems:"center",flexWrap:"wrap"}}>
        {["QBank","Quiz","Study"].map(s=>(
          <button key={s} className={`ftab${sheet===s&&viewMode==="all"?" on":""}`} onClick={()=>{setSheet(s);setFilterSub("all");setFilterAudience("all");setSearch("");setViewMode("all");}}>{s}</button>
        ))}
        <button
          onClick={()=>setViewMode(v=>v==="duplicates"?"all":"duplicates")}
          style={{marginLeft:"auto",fontSize:11,padding:"4px 11px",borderRadius:20,border:`1px solid ${viewMode==="duplicates"?C.red:C.border}`,background:viewMode==="duplicates"?C.red+"22":"transparent",color:viewMode==="duplicates"?C.red:C.muted,cursor:"pointer",fontWeight:700,display:"flex",alignItems:"center",gap:4}}>
          🔁 Duplicate {duplicateQs.length>0&&<span style={{fontSize:9,background:C.red,color:"#fff",borderRadius:10,padding:"1px 5px"}}>{duplicateQs.length}</span>}
        </button>
      </div>
      {/* Duplicate mode header */}
      {viewMode==="duplicates"&&(
        <div style={{background:C.red+"15",border:`1px solid ${C.red}33`,borderRadius:10,padding:"8px 12px",marginBottom:8}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:6}}>
            <div>
              <div style={{fontSize:12,fontWeight:700,color:C.red}}>🔁 Duplicate প্রশ্ন</div>
              <div style={{fontSize:10,color:C.muted,marginTop:2}}>{duplicateGroups.length}টি গ্রুপে {duplicateQs.length}টি duplicate পাওয়া গেছে</div>
              <div style={{fontSize:10,color:C.muted,marginTop:1}}>একই Question + Audience + Subject + Sub-topic হলে duplicate গণনা হয়</div>
            </div>
            {duplicateGroups.length>0&&(
              <button
                onClick={()=>{
                  // Select all non-original (keep first of each group, delete rest)
                  const toDelete=duplicateGroups.flatMap(g=>g.slice(1));
                  setBulkDelTargets(toDelete);
                }}
                style={{fontSize:11,padding:"5px 12px",borderRadius:8,background:C.red+"22",color:C.red,border:`1px solid ${C.red}44`,fontWeight:700,cursor:"pointer"}}>
                🗑️ সব duplicate ডিলিট ({duplicateGroups.reduce((a,g)=>a+g.length-1,0)}টি)
              </button>
            )}
          </div>
        </div>
      )}
      {/* Audience Tag filter */}
      <div style={{marginBottom:8}}>
        <div style={{fontSize:10,color:C.muted,fontWeight:700,marginBottom:5,letterSpacing:".5px"}}>🎯 AUDIENCE</div>
        <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
          <button
            onClick={()=>setFilterAudience("all")}
            style={{fontSize:11,padding:"4px 12px",borderRadius:20,border:`1px solid ${filterAudience==="all"?C.accent:C.border}`,background:filterAudience==="all"?C.accent+"22":"transparent",color:filterAudience==="all"?C.accent:C.muted,cursor:"pointer",fontWeight:700}}>
            🌐 All {filterAudience==="all"&&allQ.length>0&&<span style={{fontSize:9,opacity:.7}}>({allQ.length})</span>}
          </button>
          {audienceTags.map(({tag,count})=>(
            <button key={tag}
              onClick={()=>setFilterAudience(filterAudience===tag?"all":tag)}
              style={{fontSize:11,padding:"4px 12px",borderRadius:20,border:`1px solid ${filterAudience===tag?C.accent:C.border}`,background:filterAudience===tag?C.accent+"22":"transparent",color:filterAudience===tag?C.accent:C.muted,cursor:"pointer",fontWeight:filterAudience===tag?700:500}}>
              {tag} <span style={{fontSize:9,opacity:.6}}>({count})</span>
            </button>
          ))}
          {audienceTags.length===0&&!loading&&<span style={{fontSize:11,color:C.muted,fontStyle:"italic"}}>কোনো audience tag নেই</span>}
        </div>
      </div>
      <div className="sw" style={{marginBottom:8}}>
        <span className="si">🔍</span>
        <input className="inp" placeholder="প্রশ্ন, বিষয়..." value={search} onChange={e=>setSearch(e.target.value)}/>
      </div>
      {subjects.length>2&&(
        <div className="ftabs" style={{marginBottom:8}}>
          {subjects.slice(0,8).map(s=>(
            <button key={s} className={`ftab${filterSub===s?" on":""}`} onClick={()=>setFilterSub(s)}>{s==="all"?"সব":s}</button>
          ))}
        </div>
      )}
      <div style={{fontSize:11,color:C.muted,marginBottom:8,display:"flex",justifyContent:"space-between"}}>
        <span>{loading?"⏳":`${filtered.length} / ${allQ.length}টি`}</span>
        {totalPages>1&&<span style={{color:C.accent}}>{page+1}/{totalPages}</span>}
      </div>
      {loading&&!raw?[...Array(4)].map((_,i)=><div key={i} className="sk"/>):
       filtered.length===0?<div className="empty"><div className="ei">📋</div><p>কিছু নেই</p></div>:
       pageSlice.map((q,i)=>{
        const qid=(q.ID||q.id||"").toString();
        const qtext=(q.Question||q.question||"(নোট)").slice(0,80);
        const sub=(q.Subject||q.subject||"—");
        const tp=(q.Sub_topic||q.sub_topic||"");
        const qt=(q.QType||q.qtype||"MCQ").toLowerCase();
        const isDup=viewMode==="duplicates";
        const isOriginal=q._isDupOriginal;
        return(
          <div key={q._fbKey||i} className="qcard" style={isDup?{border:`1.5px solid ${isOriginal?C.green:C.red}44`,background:isOriginal?C.green+"08":C.red+"08"}:{}}>
            <div style={{display:"flex",gap:6,marginBottom:5,alignItems:"flex-start"}}>
              <span className={`qtag ${qt==="written"?"qtag-wr":"qtag-mcq"}`}>{qt==="written"?"✍️":"❓"}</span>
              <span style={{fontSize:9,color:C.muted,marginTop:1}}>#{qid}</span>
              {isDup&&(
                <span style={{fontSize:9,padding:"2px 7px",borderRadius:8,background:isOriginal?C.green+"22":C.red+"22",color:isOriginal?C.green:C.red,fontWeight:700,border:`1px solid ${isOriginal?C.green:C.red}44`}}>
                  {isOriginal?`✅ Original (${q._dupGroup}টি)`:"🔁 Duplicate"}
                </span>
              )}
              <div style={{flex:1}}/>
              <button className="btn" style={{padding:"3px 9px",fontSize:10,background:C.accent+"22",color:C.accent,border:`1px solid ${C.accent}33`}} onClick={()=>setEditing(q)}>✏️</button>
              <button className="btn" style={{padding:"3px 9px",fontSize:10,background:C.red+"22",color:C.red,border:`1px solid ${C.red}33`}} onClick={()=>setDelTarget(q)}>🗑️</button>
            </div>
            <div className="qcard-q">{qtext}{qtext.length>=80?"…":""}</div>
            <div className="qcard-meta">
              <span className="qtag qtag-sub">📚 {sub}</span>
              {tp&&<span className="qtag qtag-tp">📌 {tp.slice(0,25)}</span>}
              {(q.AudienceTags||q.audienceTags||q.audience_tags)&&(
                <span style={{fontSize:9,padding:"2px 7px",borderRadius:10,background:C.accent+"18",color:C.accent,border:`1px solid ${C.accent}33`,fontWeight:700}}>
                  🎯 {(q.AudienceTags||q.audienceTags||q.audience_tags).toString().slice(0,30)}
                </span>
              )}
            </div>
          </div>
        );
       })
      }
      {totalPages>1&&(
        <div style={{display:"flex",gap:6,justifyContent:"center",marginTop:8}}>
          <button className="btn bg" disabled={page===0} onClick={()=>setPage(p=>p-1)}>← আগে</button>
          <span style={{padding:"7px 12px",fontSize:11,color:C.muted}}>{page+1} / {totalPages}</span>
          <button className="btn bg" disabled={page>=totalPages-1} onClick={()=>setPage(p=>p+1)}>পরে →</button>
        </div>
      )}
      {editing&&<InlineEditModal q={editing} sheet={sheet} onClose={()=>setEditing(null)} onSaved={()=>{setEditing(null);invalidate(sheet);}} push={push}/>}
      {delTarget&&<DeleteWarningModal
        title="এই প্রশ্নটি ডিলিট করবেন?"
        description={`"${(delTarget.Question||delTarget.question||"নোট").slice(0,60)}…" Firebase ও Google Sheet থেকে মুছে যাবে।`}
        onConfirm={hardDelete} onCancel={()=>setDelTarget(null)} loading={delLoading}
      />}
      {bulkDelTargets&&<DeleteWarningModal
        title={`🗑️ ${bulkDelTargets.length}টি Duplicate ডিলিট করবেন?`}
        description={`এগুলো হলো duplicate কপি। Original গুলো রেখে বাকি ${bulkDelTargets.length}টি Firebase থেকে মুছে যাবে।`}
        onConfirm={()=>bulkDeleteDuplicates(bulkDelTargets)} onCancel={()=>setBulkDelTargets(null)} loading={bulkDelLoading}
      />}
    </>
  );
}

export { BrowseTab };
