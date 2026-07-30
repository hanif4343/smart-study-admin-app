/* ══════════ BROWSE TAB (Content Manager) ══════════ */
import React, { useState, useEffect, useMemo } from "react";
import { C } from "../../core/config.js";
import { useFB, invalidate } from "../../core/dataCache.js";
import { fbDelete, fbDeleteBatch, fbPush, fbSet } from "../../core/firebase.js";
import { toArr, nowTs, loadSharedGasSecret } from "../../core/utils.js";
import { deleteIdsInSheet } from "../../core/sheetSave.js";
import { callAiProviderRotatingRaw, buildKeyPool, OCR_SPLIT_RULES, OCR_NOISE_RULES, OCR_CORRECTION_RULES } from "../../core/ocrProviders.js";
import { DeleteWarningModal } from "../../components/shared/DeleteWarningModal.jsx";
import { InlineEditModal } from "./InlineEditModal.jsx";
import { ReformatReviewModal } from "./ReformatReviewModal.jsx";

/* ── পুরনো, একাধিক উপ-প্রশ্নের উত্তর এক জায়গায় বান্ডিল হয়ে-যাওয়া entry-কে
   AI দিয়ে আলাদা আলাদা স্বতন্ত্র {q,a}-এ ভেঙে দেওয়ার প্রম্পট। প্রশ্নব্যাংক
   (বিগত সালের প্রশ্ন) মুছে ফেলা ঠিক না — তাই ডিলিটের বদলে এই "রিফরম্যাট"
   দিয়ে পুরনো ডেটা re-split করে সংরক্ষণ করা হয়। ── */
function buildReformatPrompt(rawText){
  return `তুমি একজন বাংলা প্রশ্নপত্র formatter। নিচের প্রশ্ন-উত্তরটা পুরনো, ভুলভাবে ইম্পোর্ট হওয়া ডেটা থেকে নেওয়া — একাধিক উপ-প্রশ্নের উত্তর ভুলবশত এক জায়গায় বান্ডিল হয়ে জোড়া লেগে গিয়েছিল। এটাকে প্রতিটা উপ-প্রশ্নে ভেঙে পরিষ্কার, স্বতন্ত্র entry বানাও — কোনো তথ্য বাদ দিও না, শুধু আলাদা করো।
${OCR_SPLIT_RULES}
${OCR_NOISE_RULES}
${OCR_CORRECTION_RULES}
শুধু নিচের বিশুদ্ধ JSON array ফরম্যাটে উত্তর দাও — কোনো markdown code fence (\`\`\`), কোনো ব্যাখ্যা, কোনো অতিরিক্ত টেক্সট ছাড়া:
[{"q":"...","a":"..."}]
যদি এই টেক্সটে আসলে ভাঙার মতো কিছুই না থাকে (এটা ইতিমধ্যে একটাই স্বতন্ত্র, সম্পূর্ণ প্রশ্ন), তাহলে একটামাত্র entry-ই ফেরত দাও, অক্ষত রেখে — জোর করে ভাঙার চেষ্টা করবে না।
=== টেক্সট ===
${rawText}`;
}
/* ── AI response → [{q,a}] ── */
function parseReformatResponse(text){
  let t=(text||"").trim();
  t=t.replace(/^```json/i,"").replace(/^```/,"").replace(/```$/,"").trim();
  const start=t.indexOf("["), end=t.lastIndexOf("]");
  if(start===-1||end===-1) throw new Error("JSON array পাওয়া যায়নি — AI response format ঠিক নেই");
  const arr=JSON.parse(t.slice(start,end+1));
  if(!Array.isArray(arr)) throw new Error("AI response array না");
  return arr.filter(e=>e&&e.q&&e.a).map(e=>({q:String(e.q).trim(),a:String(e.a).trim()})).filter(e=>e.q&&e.a);
}

function BrowseTab({push,tick}){
  const[sheet,setSheet]=useState("Quiz");
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
  const[expandedKeys,setExpandedKeys]=useState(()=>new Set()); // কোন কোন কার্ড "বিস্তারিত" খোলা আছে
  const[selectMode,setSelectMode]=useState(false); // রিফরম্যাট করার জন্য একাধিক এন্ট্রি বাছাই মোড
  const[selectedKeys,setSelectedKeys]=useState(()=>new Set());
  const[reformatEntries,setReformatEntries]=useState(null); // AI থেকে ফেরত আসা প্রস্তাবিত [{q,a,sourceKeys}] — রিভিউ মোডালে দেখানোর জন্য
  const[reformatLoading,setReformatLoading]=useState(false);
  const[reformatSaving,setReformatSaving]=useState(false);
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

  // "৬"-এর মতো stray/ভাঙা এন্ট্রি — প্রশ্নের টেক্সট থাকলেও ৩ অক্ষরের কম (বাজে OCR/parsing ইম্পোর্টের লক্ষণ)
  const suspiciousQs=useMemo(()=>allQ.filter(q=>{
    const len=(q.Question||q.question||"").trim().length;
    return len>0&&len<4;
  }),[allQ]);

  const filtered=useMemo(()=>{
    let arr=viewMode==="duplicates"?duplicateQs:viewMode==="suspicious"?suspiciousQs:allQ;
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
  },[viewMode,duplicateQs,suspiciousQs,allQ,filterSub,filterAudience,search]);

  useEffect(()=>setPage(0),[sheet,filterSub,filterAudience,search]);

  const pageSlice=useMemo(()=>filtered.slice(page*PAGE,(page+1)*PAGE),[filtered,page]);
  const totalPages=Math.ceil(filtered.length/PAGE);

  // ── FIX: আগে এখানে শুধু Firebase-এ delete হতো (fbDelete), Sheet একদমই টাচ
  // হতো না — মানে GAS/Sheet মোডে যারা ডেটা পড়ে তাদের কাছে "ডিলিট করা" প্রশ্নটা
  // থেকেই যেত। এখন Sheet delete-ও (GAS deleteByIds) সাথে হচ্ছে।
  // ⚠️ group_id-aware warning (multi-part প্রশ্ন গ্রুপ একসাথে ডিলিট) এখনো যোগ
  // করা যায়নি — কারণ এই ট্যাব এখনো Firebase (useFB) থেকে ডেটা পড়ে, যেটাতে
  // নতুন schema-র subject_id/topic_id/group_id ফিল্ড নেই (Phase 4 deferred)।
  // এই ট্যাবের ডেটা-সোর্স Sheet/GAS-এ migrate করাটা একটা বড় আলাদা কাজ —
  // master plan-এ future task হিসেবে নোট করা আছে। ──
  const hardDelete=async()=>{
    if(!delTarget)return;
    setDelLoading(true);
    try{
      const fkey=delTarget._fbKey;
      const qid=(delTarget.ID||delTarget.id||"").toString();
      if(fkey){await fbDelete(`${sheet}/${fkey}`);invalidate(sheet);}
      const gasSecret=loadSharedGasSecret();
      let sheetMsg="";
      if(gasSecret&&qid){
        const sres=await deleteIdsInSheet({sheet,ids:[qid],gasSecret});
        sheetMsg=sres.ok?` · Sheet থেকেও মুছেছে`:` · ⚠️ Sheet delete ব্যর্থ (${sres.error||"?"})`;
      } else {
        sheetMsg=" · ⚠️ GAS Secret না থাকায় শুধু Firebase-এ মুছেছে, Sheet-এ না";
      }
      push("success","🗑️ ডিলিট!",`#${qid}${sheetMsg}`);
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
      push("success",`🗑️ ${deleted}টি এন্ট্রি ডিলিট!`,"");
      setBulkDelTargets(null);
    }catch(e){push("error","Bulk ডিলিট ব্যর্থ",String(e?.message||e||"unknown"));}
    setBulkDelLoading(false);
  };

  /* ── নির্বাচিত এন্ট্রিগুলো AI দিয়ে re-split করার প্রস্তাব বানায় — কোনো কিছু এখনো Firebase-এ লেখা হয় না,
     শুধু রিভিউ মোডালের জন্য প্রস্তাবিত entries তৈরি হয়। প্রশ্নব্যাংক ডিলিট না করে সংরক্ষণের জন্যই এই ধাপ। ── */
  const runReformat=async()=>{
    if(!buildKeyPool().length){ push("warn","কোনো AI provider active নেই","API Settings-এ গিয়ে অন্তত একটা key active করো"); return; }
    const targets=allQ.filter(q=>selectedKeys.has(q._fbKey));
    if(targets.length===0)return;
    setReformatLoading(true);
    const collected=[];
    const failed=[];
    for(const q of targets){
      const rawText=`প্রশ্ন: ${q.Question||q.question||""}\nউত্তর: ${q.Correct||q.correct||""}`;
      try{
        const aiText=await callAiProviderRotatingRaw(buildReformatPrompt(rawText));
        const entries=parseReformatResponse(aiText);
        entries.forEach(e=>collected.push({
          ...e,include:true,
          sourceKey:q._fbKey,
          subject:q.Subject||q.subject||"",
          sub_topic:q.Sub_topic||q.sub_topic||"",
          audienceTags:q.AudienceTags||q.audienceTags||q.audience_tags||"",
          qtype:q["Question Type"]||q.qtype||"Written",
        }));
      }catch(e){ failed.push(`#${q.ID||q.id||"?"}: ${e.message}`); }
    }
    setReformatLoading(false);
    if(failed.length) push("error",`${failed.length}টি ব্যর্থ হয়েছে`,failed.slice(0,3).join(" | "));
    if(collected.length===0){ push("warn","কিছুই পাওয়া যায়নি","AI থেকে কোনো বৈধ entry ফেরত আসেনি"); return; }
    setReformatEntries(collected);
  };

  /* ── রিভিউ মোডাল থেকে "সেভ করুন" — নতুন entries লেখা হয়, তারপর পুরনো (বান্ডিল) entries ডিলিট হয় ── */
  const saveReformat=async(finalEntries)=>{
    const included=finalEntries.filter(e=>e.include&&e.q&&e.a);
    if(included.length===0)return;
    setReformatSaving(true);
    try{
      for(const e of included){
        const ts=nowTs();
        const id=Date.now()+Math.floor(Math.random()*9999);
        const isStudy=sheet==="Study";
        const isWritten=(e.qtype||"Written")==="Written";
        const rec={
          id,question:e.q,
          ...(isStudy?{}:{option1:isWritten?"":"",option2:isWritten?"":"",option3:isWritten?"":"",option4:isWritten?"":""}),
          correct:e.a,
          subject:e.subject,sub_topic:e.sub_topic||e.subject,
          explanation:"",
          "Question Type":e.qtype||"Written",
          AudienceTags:e.audienceTags||"",
          Timestamp:ts,technique:"",
        };
        const res=await fbPush(sheet,rec);
        if(res?.name) await fbSet(`${sheet}/${res.name}/id`,res.name);
      }
      // নতুন entries সফলভাবে লেখা হওয়ার পরই পুরনো বান্ডিল entries ডিলিট করা হয় — ডেটা হারানোর ঝুঁকি এড়াতে
      const sourceKeys=[...new Set(included.map(e=>e.sourceKey).filter(Boolean))];
      if(sourceKeys.length) await fbDeleteBatch(sheet,sourceKeys);
      invalidate(sheet);
      push("success",`✅ ${included.length}টি নতুন প্রশ্ন তৈরি হলো`,`${sourceKeys.length}টি পুরনো বান্ডিল এন্ট্রি বদলে গেল`);
      setReformatEntries(null);
      setSelectedKeys(new Set());
      setSelectMode(false);
    }catch(e){push("error","সেভ ব্যর্থ",String(e?.message||e||"unknown"));}
    setReformatSaving(false);
  };

  return(
    <>
      {/* Sheet tabs + Audience selector row */}
      <div style={{display:"flex",gap:6,marginBottom:8,alignItems:"center",flexWrap:"wrap"}}>
        {["Quiz","QBank","Study"].map(s=>(
          <button key={s} className={`ftab${sheet===s&&viewMode==="all"?" on":""}`} onClick={()=>{setSheet(s);setFilterSub("all");setFilterAudience("all");setSearch("");setViewMode("all");}}>{s}</button>
        ))}
        <button
          onClick={()=>setViewMode(v=>v==="duplicates"?"all":"duplicates")}
          style={{marginLeft:"auto",fontSize:11,padding:"4px 11px",borderRadius:20,border:`1px solid ${viewMode==="duplicates"?C.red:C.border}`,background:viewMode==="duplicates"?C.red+"22":"transparent",color:viewMode==="duplicates"?C.red:C.muted,cursor:"pointer",fontWeight:700,display:"flex",alignItems:"center",gap:4}}>
          🔁 Duplicate {duplicateQs.length>0&&<span style={{fontSize:9,background:C.red,color:"#fff",borderRadius:10,padding:"1px 5px"}}>{duplicateQs.length}</span>}
        </button>
        <button
          onClick={()=>setViewMode(v=>v==="suspicious"?"all":"suspicious")}
          style={{fontSize:11,padding:"4px 11px",borderRadius:20,border:`1px solid ${viewMode==="suspicious"?"#f59e0b":C.border}`,background:viewMode==="suspicious"?"#f59e0b22":"transparent",color:viewMode==="suspicious"?"#f59e0b":C.muted,cursor:"pointer",fontWeight:700,display:"flex",alignItems:"center",gap:4}}>
          ⚠️ সন্দেহজনক {suspiciousQs.length>0&&<span style={{fontSize:9,background:"#f59e0b",color:"#fff",borderRadius:10,padding:"1px 5px"}}>{suspiciousQs.length}</span>}
        </button>
        <button
          onClick={()=>{setSelectMode(v=>!v);setSelectedKeys(new Set());}}
          style={{fontSize:11,padding:"4px 11px",borderRadius:20,border:`1px solid ${selectMode?"#6366f1":C.border}`,background:selectMode?"#6366f122":"transparent",color:selectMode?"#6366f1":C.muted,cursor:"pointer",fontWeight:700,display:"flex",alignItems:"center",gap:4}}>
          🧩 রিফরম্যাট
        </button>
      </div>
      {/* Select mode হেডার — বান্ডিল-হয়ে-যাওয়া পুরনো এন্ট্রি বেছে AI দিয়ে re-split করে সংরক্ষণ করার জন্য (ডিলিট না করে) */}
      {selectMode&&(
        <div style={{background:"#6366f115",border:"1px solid #6366f133",borderRadius:10,padding:"8px 12px",marginBottom:8}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:6}}>
            <div>
              <div style={{fontSize:12,fontWeight:700,color:"#6366f1"}}>🧩 রিফরম্যাট মোড</div>
              <div style={{fontSize:10,color:C.muted,marginTop:2}}>যেসব এন্ট্রিতে একাধিক উপ-প্রশ্নের উত্তর এক জায়গায় জোড়া লেগে গেছে, সেগুলো বেছে নিন — AI প্রতিটাকে আলাদা প্রশ্নে ভেঙে দেবে (মূল প্রশ্নব্যাংক ডিলিট হবে না)</div>
            </div>
            <button
              disabled={selectedKeys.size===0||reformatLoading}
              onClick={runReformat}
              style={{fontSize:11,padding:"5px 12px",borderRadius:8,background:selectedKeys.size===0?C.border:"#6366f122",color:selectedKeys.size===0?C.muted:"#6366f1",border:`1px solid ${selectedKeys.size===0?C.border:"#6366f144"}`,fontWeight:700,cursor:selectedKeys.size===0?"default":"pointer"}}>
              {reformatLoading?"⏳ AI চলছে...":`🧩 রিফরম্যাট করুন (${selectedKeys.size}টি)`}
            </button>
          </div>
        </div>
      )}
      {/* Suspicious mode header — বাজে OCR/parsing থেকে আসা ভাঙা এন্ট্রি বাল্কে ডিলিট করার জন্য */}
      {viewMode==="suspicious"&&(
        <div style={{background:"#f59e0b15",border:"1px solid #f59e0b33",borderRadius:10,padding:"8px 12px",marginBottom:8}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:6}}>
            <div>
              <div style={{fontSize:12,fontWeight:700,color:"#f59e0b"}}>⚠️ সন্দেহজনক/ভাঙা এন্ট্রি</div>
              <div style={{fontSize:10,color:C.muted,marginTop:2}}>{suspiciousQs.length}টি প্রশ্নের টেক্সট ৩ অক্ষরের কম — সাধারণত বাজে OCR/parsing-এর ফল, ভালো করে দেখে ডিলিট করে দিন</div>
            </div>
            {suspiciousQs.length>0&&(
              <button
                onClick={()=>setBulkDelTargets(suspiciousQs)}
                style={{fontSize:11,padding:"5px 12px",borderRadius:8,background:"#f59e0b22",color:"#f59e0b",border:"1px solid #f59e0b44",fontWeight:700,cursor:"pointer"}}>
                🗑️ সব সন্দেহজনক ডিলিট ({suspiciousQs.length}টি)
              </button>
            )}
          </div>
        </div>
      )}
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
        const qFullLen=(q.Question||q.question||"").trim().length;
        const isSuspicious=qFullLen>0&&qFullLen<4; // "৬"-এর মতো stray/ভাঙা নয়েজ এন্ট্রি ধরার জন্য
        const sub=(q.Subject||q.subject||"—");
        const tp=(q.Sub_topic||q.sub_topic||"");
        const qt=(q.QType||q.qtype||"MCQ").toLowerCase();
        const isDup=viewMode==="duplicates";
        const isOriginal=q._isDupOriginal;
        const cardKey=q._fbKey||i;
        const isOpen=expandedKeys.has(cardKey);
        // ── বিস্তারিত ভিউ-এর জন্য সব ফিল্ড (Firebase-এ নানা নামে থাকতে পারে, তাই সব variant চেক করা হয়) ──
        const _o=(k1,k2,k3,k4)=>q[k1]||q[k2]||q[k3]||q[k4]||"";
        const opt1=_o("Opt1","opt1","Option1","option1"), opt2=_o("Opt2","opt2","Option2","option2");
        const opt3=_o("Opt3","opt3","Option3","option3"), opt4=_o("Opt4","opt4","Option4","option4");
        const correctAns=q.Correct||q.correct||"";
        const explanation=q.Explanation||q.explanation||"";
        const technique=q.Technique||q.technique||"";
        const fullQ=q.Question||q.question||"(নোট)";
        return(
          <div key={cardKey} className="qcard" style={{...(isDup?{border:`1.5px solid ${isOriginal?C.green:C.red}44`,background:isOriginal?C.green+"08":C.red+"08"}:{}),...(selectMode&&selectedKeys.has(cardKey)?{border:"1.5px solid #6366f1aa",background:"#6366f10c"}:{})}}>
            <div style={{display:"flex",gap:6,marginBottom:5,alignItems:"flex-start"}}>
              {selectMode&&(
                <input type="checkbox" checked={selectedKeys.has(cardKey)}
                  onChange={()=>setSelectedKeys(p=>{const n=new Set(p); n.has(cardKey)?n.delete(cardKey):n.add(cardKey); return n;})}
                  style={{width:16,height:16,marginTop:1,accentColor:"#6366f1",cursor:"pointer"}}/>
              )}
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
            <div className="qcard-q">
              {isSuspicious&&<span style={{fontSize:9,padding:"2px 7px",borderRadius:8,background:"#f59e0b22",color:"#f59e0b",fontWeight:800,border:"1px solid #f59e0b44",marginRight:6}}>⚠️ সন্দেহজনক/ভাঙা এন্ট্রি</span>}
              {qtext}{qtext.length>=80?"…":""}
            </div>
            <div className="qcard-meta">
              <span className="qtag qtag-sub">📚 {sub}</span>
              {tp&&<span className="qtag qtag-tp">📌 {tp.slice(0,25)}</span>}
              {(q.AudienceTags||q.audienceTags||q.audience_tags)&&(
                <span style={{fontSize:9,padding:"2px 7px",borderRadius:10,background:C.accent+"18",color:C.accent,border:`1px solid ${C.accent}33`,fontWeight:700}}>
                  🎯 {(q.AudienceTags||q.audienceTags||q.audience_tags).toString().slice(0,30)}
                </span>
              )}
            </div>
            {/* ── বিস্তারিত দেখার বাটন — পুরো প্রশ্ন + অপশন + উত্তর + ব্যাখ্যা গুছিয়ে দেখায় ── */}
            <button onClick={()=>setExpandedKeys(p=>{const n=new Set(p); n.has(cardKey)?n.delete(cardKey):n.add(cardKey); return n;})}
              style={{width:"100%",marginTop:7,padding:"5px 0",fontSize:10,fontWeight:700,color:C.muted,
                background:"transparent",border:`1px solid ${C.border}`,borderRadius:8,cursor:"pointer",
                display:"flex",alignItems:"center",justifyContent:"center",gap:5}}>
              {isOpen?"▲ লুকান":"▼ বিস্তারিত দেখুন"}
            </button>
            {isOpen&&(
              <div style={{marginTop:8,padding:"10px 11px",background:"#0a1628",border:`1px solid ${C.border}`,borderRadius:10,fontSize:12,lineHeight:1.6}}>
                <div style={{color:C.text,fontWeight:700,marginBottom:8,whiteSpace:"pre-wrap",wordBreak:"break-word"}}>{fullQ}</div>
                {qt!=="written"&&(opt1||opt2||opt3||opt4)&&(
                  <div style={{display:"flex",flexDirection:"column",gap:4,marginBottom:8}}>
                    {[["A",opt1],["B",opt2],["C",opt3],["D",opt4]].filter(([,v])=>v).map(([lbl,v])=>{
                      const isCorrect=correctAns&&v.trim()===correctAns.toString().trim();
                      return(
                        <div key={lbl} style={{display:"flex",gap:6,alignItems:"flex-start",
                          color:isCorrect?C.green:C.muted,fontWeight:isCorrect?800:500}}>
                          <span>{isCorrect?"✅":`${lbl})`}</span>
                          <span style={{wordBreak:"break-word"}}>{v}</span>
                        </div>
                      );
                    })}
                  </div>
                )}
                {qt==="written"&&correctAns&&(
                  <div style={{marginBottom:8}}>
                    <div style={{fontSize:10,fontWeight:800,color:C.green,marginBottom:2}}>✅ উত্তর</div>
                    <div style={{color:C.text,whiteSpace:"pre-wrap",wordBreak:"break-word"}}>{correctAns}</div>
                  </div>
                )}
                {explanation&&(
                  <div style={{marginBottom:technique?8:0}}>
                    <div style={{fontSize:10,fontWeight:800,color:"#f59e0b",marginBottom:2}}>📖 ব্যাখ্যা</div>
                    <div style={{color:C.muted,whiteSpace:"pre-wrap",wordBreak:"break-word"}}>{explanation}</div>
                  </div>
                )}
                {technique&&(
                  <div>
                    <div style={{fontSize:10,fontWeight:800,color:"#818cf8",marginBottom:2}}>💡 কৌশল</div>
                    <div style={{color:C.muted,whiteSpace:"pre-wrap",wordBreak:"break-word"}}>{technique}</div>
                  </div>
                )}
                {!correctAns&&!explanation&&!technique&&!opt1&&(
                  <div style={{color:C.muted,fontSize:11}}>(অতিরিক্ত কোনো তথ্য নেই)</div>
                )}
              </div>
            )}
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
        title={`🗑️ ${bulkDelTargets.length}টি ${viewMode==="suspicious"?"সন্দেহজনক":"Duplicate"} এন্ট্রি ডিলিট করবেন?`}
        description={viewMode==="suspicious"
          ?`এগুলোর প্রশ্নের টেক্সট ৩ অক্ষরের কম (ভাঙা/নয়েজ) — ${bulkDelTargets.length}টি Firebase থেকে মুছে যাবে।`
          :`এগুলো হলো duplicate কপি। Original গুলো রেখে বাকি ${bulkDelTargets.length}টি Firebase থেকে মুছে যাবে।`}
        onConfirm={()=>bulkDeleteDuplicates(bulkDelTargets)} onCancel={()=>setBulkDelTargets(null)} loading={bulkDelLoading}
      />}
      {reformatEntries&&<ReformatReviewModal
        entries={reformatEntries}
        onSave={saveReformat}
        onCancel={()=>setReformatEntries(null)}
        saving={reformatSaving}
      />}
    </>
  );
}

export { BrowseTab };
