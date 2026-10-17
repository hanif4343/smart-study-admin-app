/* ══════════ TOPIC TAGS (Auto-Classify) ══════════
   QBank MCQ-কে টপিকের ট্যাগ (keywords) মিলিয়ে আপনা-আপনি Subject/Topic-এ বসানোর রুল-ম্যানেজার।
   চারটা অংশ: 📋 রুল (যোগ/এডিট/মুছুন) · 🧪 টেস্ট বক্স · ▶ রান (Preview → Apply, Undo) · 👁 রিভিউ (অটো-মুভ হওয়া প্রশ্ন, দ্বন্দ্ব)।
   ব্যাকএন্ড: AutoClassify.gs। Apply-এর পর Publish ট্যাবে Publish Now চালাতে হয়। */
import React, { useState, useEffect, useCallback, useMemo } from "react";
import { C, tint } from "../../core/config.js";
import { loadSharedGasSecret, saveSharedGasSecret } from "../../core/utils.js";
import { getCachedReferenceData } from "../../core/refCache.js";
import { useRefCacheSync } from "../../hooks/useRefCacheSync.js";
import { fetchReferenceData } from "../../core/sheetSave.js";
import { ttGetSettings, ttSetUploadAuto, ttSetup, ttGetRules, ttSaveRule, ttDeleteRule, ttTest, ttPreview, ttApply, ttUndoLast, ttUndoAll, ttReview, ttUndoOne, ttConfirmOne, ttSuggest } from "../../core/topicTags.js";

const MATCH_LABEL={question:"শুধু প্রশ্ন",answer:"শুধু উত্তর",both:"প্রশ্ন + উত্তর"};
const EMPTY_RULE={row:0,rule_id:"",topic_id:"",keywords:"",match_in:"question",exclude_keywords:"",min_matches:1,priority:0,require_blank:"N",answer_whole:"N",answer_max_words:"",active:"Y",note:""};
const TABS=[["rules","📋 রুল"],["test","🧪 টেস্ট"],["run","▶ রান"],["review","👁 রিভিউ"]];

const lbl={fontSize:11,color:C.muted,marginBottom:4,display:"block"};
const row={display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"};
const chip=(on)=>({padding:"7px 12px",borderRadius:16,fontSize:12,fontWeight:700,cursor:"pointer",border:`1px solid ${on?C.info:C.border}`,background:on?tint(C.info,"22"):"transparent",color:on?C.info:C.muted});

function TopicTagsTab({push}){
  const[gasSecret,setGasSecret]=useState(loadSharedGasSecret);
  const setGasSecretP=v=>{ setGasSecret(v); saveSharedGasSecret(v); };
  const[refData,setRefData]=useState(getCachedReferenceData);
  useRefCacheSync(setRefData);
  const[tab,setTab]=useState("rules");
  const[settings,setSettings]=useState(null);
  const[rules,setRules]=useState(null);
  const[loadErr,setLoadErr]=useState("");
  const[busy,setBusy]=useState(false);
  const[edit,setEdit]=useState(null);          // ফর্মে থাকা রুল (নতুন/এডিট)
  const[subjFilter,setSubjFilter]=useState("");   // ফর্মে আগে Subject বাছা হয়, তারপর শুধু সেই Subject-এর টপিক দেখায়
  const[testQ,setTestQ]=useState({question:"",option1:"",option2:"",option3:"",option4:"",correct:""});
  const[testRes,setTestRes]=useState(null);
  const[useDraft,setUseDraft]=useState(false);
  const[scope,setScope]=useState("");          // "" = সব সক্রিয় রুল
  const[candMode,setCandMode]=useState("blank"); // blank | subject | all — কোন প্রশ্ন ধরবে
  const[candSubj,setCandSubj]=useState("");
  const[pv,setPv]=useState(null);              // Preview ফলাফল (scope সহ)
  const[applied,setApplied]=useState(null);
  const[excluded,setExcluded]=useState({});    // আনমার্ক করা প্রশ্ন (id→true) — Apply-এ বাদ যাবে ও আর রুলে আসবে না
  const[pvShown,setPvShown]=useState(40);
  const[pvQuery,setPvQuery]=useState("");
  const[revKind,setRevKind]=useState("auto");
  const[rev,setRev]=useState({items:[],total:0,nextCursor:null,loaded:false});
  const[sugg,setSugg]=useState(null);          // ট্যাগ সাজেশন: {topic_id,scope,nTopic,list}
  const[bulkOpen,setBulkOpen]=useState(false);
  const[bulkText,setBulkText]=useState("");
  const[bulkLog,setBulkLog]=useState([]);

  const topics=useMemo(()=>{
    const subj={}; (refData?.subjects||[]).forEach(s=>{subj[s.subject_id]=s.subject_name;});
    return (refData?.topics||[]).map(t=>({id:t.topic_id,name:t.topic_name,sid:t.subject_id,sname:subj[t.subject_id]||t.subject_id}))
      .sort((a,b)=>(a.sname+a.name).localeCompare(b.sname+b.name));
  },[refData]);
  const topicLabel=useCallback(id=>{ const t=topics.find(x=>x.id===id); return t?`${t.sname} › ${t.name}`:id; },[topics]);
  const subjectList=useMemo(()=>{
    const m={}; topics.forEach(t=>{ m[t.sid]=m[t.sid]||{id:t.sid,name:t.sname,n:0}; m[t.sid].n++; });
    return Object.values(m).sort((a,b)=>a.name.localeCompare(b.name));
  },[topics]);
  const topicsOfSubject=useMemo(()=>topics.filter(t=>t.sid===subjFilter).sort((a,b)=>a.id.localeCompare(b.id)),[topics,subjFilter]);
  // যে টপিকে আগে থেকেই রুল আছে: topic_id → rule_id (সক্রিয়/বন্ধ যেকোনো রুল) — ফর্মের তালিকায় ✓ চিহ্ন ও disabled
  const ruledTopics=useMemo(()=>{ const m={}; (rules||[]).forEach(r=>{ if(r.topic_id && !m[r.topic_id]) m[r.topic_id]=r.rule_id; }); return m; },[rules]);
  const startEdit=(r)=>{ const t=topics.find(x=>x.id===r.topic_id); setSubjFilter(t?t.sid:""); setSugg(null); setEdit(r); };

  const loadRef=useCallback(()=>{ if(gasSecret) fetchReferenceData({gasSecret}).then(d=>{ if(d) setRefData(d); }); },[gasSecret]);
  const loadAll=useCallback(async()=>{
    if(!gasSecret) return;
    setLoadErr("");
    const [s,r]=await Promise.all([ttGetSettings(gasSecret),ttGetRules(gasSecret)]);
    if(s.status!=="success"){ setLoadErr(s.message||"লোড ব্যর্থ"); return; }
    setSettings(s);
    setRules(r.status==="success"?r.rules:[]);
  },[gasSecret]);
  useEffect(()=>{ loadRef(); loadAll(); },[loadRef,loadAll]);

  const needSetup=settings && (!settings.rulesSheet || !settings.autoCols);
  const guard=async(fn)=>{ if(busy) return; setBusy(true); try{ return await fn(); } finally{ setBusy(false); } };

  const doSetup=()=>guard(async()=>{
    const r=await ttSetup(gasSecret);
    if(r.status!=="success"){ push("error","❌ সেটআপ ব্যর্থ",r.message||""); return; }
    push("success","✅ সেটআপ হয়েছে","TopicRules শিট ও auto_* কলাম তৈরি"); await loadAll();
  });
  const toggleUpload=()=>guard(async()=>{
    const r=await ttSetUploadAuto(gasSecret,!settings.uploadAuto);
    if(r.status!=="success"){ push("error","❌ ব্যর্থ",r.message||""); return; }
    setSettings(s=>({...s,uploadAuto:!s.uploadAuto}));
    push("success",!settings.uploadAuto?"✅ আপলোডের সময় অটো-মুভ চালু":"⏸ আপলোডের সময় অটো-মুভ বন্ধ","");
  });

  /* ── রুল সেভ/মোছা/চালু-বন্ধ ── */
  const saveRule=(r)=>guard(async()=>{
    const res=await ttSaveRule(gasSecret,r);
    if(res.status!=="success"){ push("error","❌ সেভ ব্যর্থ",res.message||""); return false; }
    push("success","✅ রুল সেভ হয়েছে",topicLabel(r.topic_id)); setEdit(null); setPv(null); await loadAll(); return true;
  });
  const toggleActive=(r)=>saveRule({...r,active:r.active==="Y"?"N":"Y"});
  const deleteRule=(r)=>{
    if(!window.confirm(`রুল "${topicLabel(r.topic_id)}" মুছবে? (আগে অটো-মুভ হওয়া প্রশ্ন যেমন আছে তেমনই থাকবে)`)) return;
    guard(async()=>{
      const res=await ttDeleteRule(gasSecret,r.rule_id);
      if(res.status!=="success"){ push("error","❌ মোছা ব্যর্থ",res.message||""); return; }
      push("success","🗑 রুল মোছা হয়েছে",topicLabel(r.topic_id)); setPv(null); await loadAll();
    });
  };
  const draftOf=(r)=>({topic_id:r.topic_id,keywords:r.keywords,match_in:r.match_in,exclude_keywords:r.exclude_keywords,min_matches:r.min_matches,priority:r.priority,require_blank:r.require_blank,answer_whole:r.answer_whole,answer_max_words:r.answer_max_words,rule_id:r.rule_id||"DRAFT"});

  /* ── টেস্ট ── */
  const runTest=()=>guard(async()=>{
    if(!testQ.question.trim()){ push("warn","প্রশ্ন লেখো",""); return; }
    const res=await ttTest(gasSecret,testQ,useDraft&&edit?draftOf(edit):null);
    if(res.status!=="success"){ push("error","❌ টেস্ট ব্যর্থ",res.message||""); setTestRes(null); return; }
    setTestRes(res);
  });

  /* ── 💡 ট্যাগ সাজেস্ট: টপিকে আগে থেকে ঠিক করা প্রশ্ন দেখে ওই টপিকের "নিজস্ব" শব্দ ── */
  const doSuggest=()=>guard(async()=>{
    if(!edit?.topic_id){ push("warn","আগে টপিক বাছো",""); return; }
    const scopeKind=edit.match_in==="answer"?"answer":"question";
    const res=await ttSuggest(gasSecret,edit.topic_id,scopeKind);
    if(res.status!=="success"){ push("warn","💡 সাজেশন নেই",res.message||""); setSugg(null); return; }
    setSugg({topic_id:edit.topic_id,scope:scopeKind,nTopic:res.nTopic,list:res.suggestions});
  });
  const addKeyword=(kw)=>{
    const cur=String(edit.keywords||"").split(/[,،;\n]+/).map(x=>x.trim()).filter(Boolean);
    if(cur.some(x=>x.toLowerCase()===kw.toLowerCase())) return;
    setEdit({...edit,keywords:[...cur,kw].join(", ")});
  };

  /* ── 📥 একসাথে অনেক রুল ইমপোর্ট ── */
  const resolveTopic=(txt)=>{
    const t=txt.trim(); if(!t) return {err:"টপিক ফাঁকা"};
    const byId=topics.find(x=>x.id.toLowerCase()===t.toLowerCase()); if(byId) return {id:byId.id};
    const byFull=topics.filter(x=>`${x.sname} › ${x.name}`.toLowerCase()===t.toLowerCase().replace(/\s*[>/|]\s*/g," › ")); if(byFull.length===1) return {id:byFull[0].id};
    const byName=topics.filter(x=>x.name.toLowerCase()===t.toLowerCase());
    if(byName.length===1) return {id:byName[0].id};
    if(byName.length>1) return {err:`"${t}" নামে ${byName.length}টি টপিক (${byName.map(x=>x.sname).join(", ")}) — "Subject › Topic" লেখো`};
    return {err:`টপিক পাওয়া যায়নি: ${t}`};
  };
  const parseMatch=(x)=>{ const v=(x||"").trim().toLowerCase(); if(["answer","উত্তর","ans","a"].includes(v)) return "answer"; if(["both","উভয়","দুটোই","b"].includes(v)) return "both"; return "question"; };
  const doBulkImport=()=>guard(async()=>{
    const lines=bulkText.split("\n").map(l=>l.trim()).filter(Boolean);
    if(!lines.length){ push("warn","কিছু লেখা নেই",""); return; }
    const log=[]; let ok=0; const ruledLocal={...ruledTopics};
    for(let i=0;i<lines.length;i++){
      const parts=lines[i].split("|").map(x=>x.trim());
      if(parts.length<2){ log.push(`❌ লাইন ${i+1}: "টপিক | ট্যাগ" ফরম্যাট লাগবে`); setBulkLog([...log]); continue; }
      const tp=resolveTopic(parts[0]);
      if(tp.err){ log.push(`❌ লাইন ${i+1}: ${tp.err}`); setBulkLog([...log]); continue; }
      if(!parts[1]){ log.push(`❌ লাইন ${i+1}: ট্যাগ ফাঁকা`); setBulkLog([...log]); continue; }
      if(ruledLocal[tp.id]){ log.push(`⏭ লাইন ${i+1}: ${topicLabel(tp.id)} — রুল আগে থেকেই আছে, বাদ`); setBulkLog([...log]); continue; }
      ruledLocal[tp.id]="NEW";   // একই ইমপোর্টে একই টপিক দু'বার এলে দ্বিতীয়টা বাদ
      const mi=parseMatch(parts[2]);
      const rule={...EMPTY_RULE,topic_id:tp.id,keywords:parts[1],match_in:mi,exclude_keywords:parts[3]||"",min_matches:parts[4]?Number(parts[4])||1:1,answer_whole:mi==="answer"?"Y":"N",require_blank:mi==="answer"?"Y":"N"};
      const res=await ttSaveRule(gasSecret,rule);
      if(res.status==="success"){ ok++; log.push(`✅ লাইন ${i+1}: ${topicLabel(tp.id)}`); }
      else log.push(`❌ লাইন ${i+1}: ${res.message||"সেভ ব্যর্থ"}`);
      setBulkLog([...log]);
    }
    push(ok===lines.length?"success":"warn",`📥 ${ok}/${lines.length}টি রুল ইমপোর্ট হয়েছে`,"Preview দিয়ে ফল দেখে নাও");
    if(ok) { setBulkText(""); setPv(null); await loadAll(); }
  });

  /* ── Preview / Apply / Undo ── */
  const doPreview=()=>guard(async()=>{
    setApplied(null); setExcluded({}); setPvShown(40); setPvQuery("");
    const res=await ttPreview(gasSecret,scope,candMode,candSubj);
    if(res.status!=="success"){ push("error","❌ Preview ব্যর্থ",res.message||""); setPv(null); return; }
    setPv({...res,scope,candMode,candSubj});
  });
  const doApply=()=>{
    if(!pv||pv.matched<1) return;
    const items=pv.items||[];
    const excIds=Object.keys(excluded);
    const pickedN=pv.matched-excIds.length;
    if(pickedN<1 && excIds.length<1) return;
    if(!window.confirm(`${pickedN}টি QBank MCQ নিজে থেকে নতুন Subject/Topic-এ সরবে (ও Quiz-এ যাবে)।`+(excIds.length?`\n${excIds.length}টি আনমার্ক করা — এগুলো যেমন আছে তেমনই থাকবে আর রুলে আর আসবে না।`:"")+`\n\nচালাবে? ভুল হলে "সর্বশেষ Apply ফেরত" দিয়ে ফিরিয়ে আনা যাবে।`)) return;
    guard(async()=>{
      // Preview-তে সব দেখানো হয়ে থাকলে ঠিক সেই নির্বাচিতগুলোই পাঠাই; ৫০০০-এর বেশি হলে শুধু বাদ-তালিকা
      const includeIds = items.length===pv.matched ? items.filter(it=>!excluded[it.id]).map(it=>it.id) : null;
      const res=await ttApply(gasSecret,pv.scope,pv.candMode,pv.candSubj,includeIds,excIds);
      if(res.status!=="success"){ push("error","❌ Apply ব্যর্থ",res.message||""); return; }
      setApplied(res); setPv(null); setExcluded({}); setRev(r=>({...r,loaded:false}));
      push("success",`✅ ${res.applied||0}টি প্রশ্ন সরানো হয়েছে`+(res.excluded?` · ${res.excluded}টি বাদ`:""),"এখন Publish ট্যাবে Publish Now চালাও");
    });
  };
  const doUndo=(all)=>{
    if(!window.confirm(all?"সব অটো-মুভ ফেরত নেবে? সারিগুলো আগের টপিকে ফিরে LOCK হবে।":"সর্বশেষ Apply-এর সব বদল ফেরত নেবে? সারিগুলো আগের টপিকে ফিরে LOCK হবে।")) return;
    guard(async()=>{
      const res=await (all?ttUndoAll(gasSecret):ttUndoLast(gasSecret));
      if(res.status!=="success"){ push("error","❌ Undo ব্যর্থ",res.message||""); return; }
      push("success",`↩ ${res.undone||0}টি প্রশ্ন ফেরত`,"Publish Now চালাও"); setApplied(null); setPv(null); setRev(r=>({...r,loaded:false}));
    });
  };

  /* ── রিভিউ ── */
  const loadReview=useCallback(async(kind,more)=>{
    if(!gasSecret) return;
    setBusy(true);
    const res=await ttReview(gasSecret,kind,more?rev.nextCursor:null);
    setBusy(false);
    if(res.status!=="success"){ push("error","❌ রিভিউ লোড ব্যর্থ",res.message||""); return; }
    setRev(r=>({items:more?[...r.items,...res.items]:res.items,total:res.total,nextCursor:res.nextCursor,loaded:true}));
  },[gasSecret,rev.nextCursor,push]);
  useEffect(()=>{ if(tab==="review" && !rev.loaded && !busy) loadReview(revKind,false); },[tab,rev.loaded,revKind]); // eslint-disable-line react-hooks/exhaustive-deps
  const reviewAct=(id,kind)=>guard(async()=>{
    const res=await (kind==="undo"?ttUndoOne(gasSecret,id):ttConfirmOne(gasSecret,id));
    if(res.status!=="success"){ push("error","❌ ব্যর্থ",res.message||""); return; }
    setRev(r=>({...r,items:r.items.filter(x=>x.id!==id),total:Math.max(0,r.total-1)}));
    push("success",kind==="undo"?"↩ ফেরত নেওয়া হয়েছে (LOCK)":"✅ ঠিক আছে চিহ্নিত",id);
  });

  const activeRules=(rules||[]).filter(r=>r.active==="Y");

  if(!gasSecret) return(
    <div className="card">
      <label style={lbl}>GAS Secret Key</label>
      <input className="inp" type="password" value={gasSecret} onChange={e=>setGasSecretP(e.target.value)} placeholder="Secret Key বসাও"/>
    </div>
  );

  return(
    <div>
      {loadErr && <div className="card" style={{border:`1px solid ${C.danger}`,color:C.danger,fontSize:12,marginBottom:10}}>
        ❌ {loadErr} <button className="btn" style={{marginLeft:8}} onClick={loadAll}>🔁 রিট্রাই</button>
        <div style={{color:C.muted,marginTop:6}}>GAS-এ AutoClassify.gs যোগ করে নতুন version ডিপ্লয় করেছ কিনা দেখো।</div>
      </div>}

      {needSetup && <div className="card" style={{marginBottom:10,border:`1px solid ${C.warning}`}}>
        <div style={{fontSize:13,fontWeight:700,marginBottom:6}}>⚙️ প্রথমবার সেটআপ</div>
        <div style={{fontSize:12,color:C.muted,marginBottom:8}}>TopicRules শিট ও Questions-এ auto_* কলাম তৈরি হবে। কিছু মোছে না।</div>
        <button className="btn bp" disabled={busy} onClick={doSetup}>সেটআপ করো</button>
      </div>}

      {settings && !needSetup && <div className="card" style={{marginBottom:10}}>
        <div style={{...row,justifyContent:"space-between"}}>
          <div>
            <div style={{fontSize:13,fontWeight:700}}>🤖 আপলোডের সময় অটো-মুভ</div>
            <div style={{fontSize:11,color:C.muted,marginTop:2}}>নতুন QBank MCQ-তে Subject/Topic ফাঁকা বা পুল হলে রুল মিললেই নিজে বসবে ({activeRules.length}টি সক্রিয় রুল)</div>
          </div>
          <button className="btn" disabled={busy} style={{background:settings.uploadAuto?tint(C.success,"33"):C.border,color:settings.uploadAuto?C.success:C.muted,fontWeight:700}} onClick={toggleUpload}>
            {settings.uploadAuto?"চালু ✓":"বন্ধ"}
          </button>
        </div>
      </div>}

      <div style={{...row,marginBottom:12}}>
        {TABS.map(([k,l])=><span key={k} style={chip(tab===k)} onClick={()=>setTab(k)}>{l}</span>)}
      </div>

      {/* ══════════ 📋 রুল ══════════ */}
      {tab==="rules" && <div>
        {!edit && <button className="btn bp" style={{width:"100%",justifyContent:"center",marginBottom:10}} disabled={needSetup} onClick={()=>{ setSubjFilter(""); setSugg(null); setEdit({...EMPTY_RULE}); }}>➕ নতুন রুল</button>}

        {edit && <div className="card" style={{marginBottom:12,border:`1px solid ${C.info}`}}>
          <div style={{fontSize:13,fontWeight:700,marginBottom:10}}>{edit.rule_id?`✏️ রুল এডিট${edit.topic_id?`: ${topicLabel(edit.topic_id)}`:""}`:"➕ নতুন রুল"}</div>

          <label style={lbl}>১) Subject (যেখানে প্রশ্ন সরবে)</label>
          <select className="inp" value={subjFilter} onChange={e=>{ setSubjFilter(e.target.value); setEdit({...edit,topic_id:""}); setSugg(null); }} style={{marginBottom:10}}>
            <option value="">— Subject বাছো ({subjectList.length}টি) —</option>
            {subjectList.map(sj=>{ const done=topics.filter(t=>t.sid===sj.id && ruledTopics[t.id]).length; return <option key={sj.id} value={sj.id}>{sj.name} ({sj.n}টি টপিক{done?` · ✓${done}`:""})</option>; })}
          </select>

          <label style={lbl}>২) Topic{subjFilter?` (${topicsOfSubject.length}টি${topicsOfSubject.filter(t=>ruledTopics[t.id]).length?` · ✓ = রুল আছে, বন্ধ`:""})`:""}</label>
          <select className="inp" value={edit.topic_id} disabled={!subjFilter} onChange={e=>{ setEdit({...edit,topic_id:e.target.value}); setSugg(null); }} style={{marginBottom:10}}>
            <option value="">{subjFilter?"— Topic বাছো —":"আগে Subject বাছো"}</option>
            {edit.topic_id && !topicsOfSubject.find(t=>t.id===edit.topic_id) && <option value={edit.topic_id}>{topicLabel(edit.topic_id)}</option>}
            {topicsOfSubject.map(t=>{ const taken=ruledTopics[t.id] && ruledTopics[t.id]!==edit.rule_id; return <option key={t.id} value={t.id} disabled={!!taken}>{taken?"✓ ":""}{t.name}{taken?" — রুল আছে":""}</option>; })}
          </select>

          <label style={lbl}>ট্যাগ / keywords (কমা দিয়ে আলাদা)</label>
          <textarea className="inp" rows={4} value={edit.keywords} onChange={e=>setEdit({...edit,keywords:e.target.value})} placeholder="লাভ, ক্ষতি, ক্রয়মূল্য, বিক্রয়মূল্য" style={{marginBottom:10,fontFamily:"inherit"}}/>

          <div style={{marginBottom:10}}>
            <button className="btn" disabled={busy||!edit.topic_id} onClick={doSuggest}>💡 এই টপিকের আগের প্রশ্ন থেকে ট্যাগ সাজেস্ট</button>
            {sugg && sugg.topic_id===edit.topic_id && <div style={{marginTop:8}}>
              <div style={{fontSize:11,color:C.muted,marginBottom:6}}>এই টপিকের {sugg.nTopic}টি ঠিক-করা MCQ দেখে ({sugg.scope==="answer"?"উত্তর":"প্রশ্ন"} থেকে)। চাপলে ট্যাগে যোগ হবে। (x/y = টপিকে/মোট কয়টা প্রশ্নে শব্দটা আছে; p = শব্দটা কতটা এই টপিকেরই)</div>
              <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
                {sugg.list.map(o=><span key={o.kw} onClick={()=>addKeyword(o.kw)} style={{...chip(false),fontWeight:600,padding:"5px 10px",borderColor:o.precision>=80?C.success:C.border,color:o.precision>=80?C.success:C.text}}>
                  {o.kw} <span style={{color:C.muted,fontWeight:400}}>{o.inTopic}/{o.total} · p{o.precision}%</span>
                </span>)}
              </div>
              <div style={{fontSize:11,color:C.muted,marginTop:6}}>💡 সবুজ = ৮০%+ এই টপিকেরই। অনেক প্রশ্নে আছে অথচ p কম এমন শব্দ (যেমন "টাকায়") একা রাখলে ভুল ধরবে — তাই "কমপক্ষে ২টা ট্যাগ মিলবে" দিয়ে রাখো।</div>
            </div>}
          </div>

          <label style={lbl}>কোথায় ট্যাগ খুঁজবে</label>
          <div style={{...row,marginBottom:10}}>
            {Object.entries(MATCH_LABEL).map(([k,l])=><span key={k} style={chip(edit.match_in===k)} onClick={()=>setEdit({...edit,match_in:k})}>{l}</span>)}
          </div>

          <label style={lbl}>ব্যতিক্রম / বাদ-শব্দ (এগুলো প্রশ্ন বা উত্তরে থাকলে রুল কাজ করবে না)</label>
          <textarea className="inp" rows={2} value={edit.exclude_keywords} onChange={e=>setEdit({...edit,exclude_keywords:e.target.value})} style={{marginBottom:10,fontFamily:"inherit"}}/>

          <div style={{...row,marginBottom:10}}>
            <div style={{flex:1,minWidth:110}}><label style={lbl}>কমপক্ষে কয়টা ট্যাগ মিলবে</label><input className="inp" type="number" min="1" value={edit.min_matches} onChange={e=>setEdit({...edit,min_matches:e.target.value})}/></div>
            <div style={{flex:1,minWidth:110}}><label style={lbl}>Priority (বেশি = অগ্রাধিকার)</label><input className="inp" type="number" value={edit.priority} onChange={e=>setEdit({...edit,priority:e.target.value})}/></div>
            <div style={{flex:1,minWidth:110}}><label style={lbl}>উত্তর সর্বোচ্চ শব্দ (ফাঁকা = সীমাহীন)</label><input className="inp" type="number" min="0" value={edit.answer_max_words} onChange={e=>setEdit({...edit,answer_max_words:e.target.value})}/></div>
          </div>

          <label style={{display:"flex",gap:8,alignItems:"center",fontSize:12,marginBottom:6}}><input type="checkbox" checked={edit.require_blank==="Y"} onChange={e=>setEdit({...edit,require_blank:e.target.checked?"Y":"N"})}/> প্রশ্নে ফাঁকা (____) থাকতেই হবে</label>
          <label style={{display:"flex",gap:8,alignItems:"center",fontSize:12,marginBottom:6}}><input type="checkbox" checked={edit.answer_whole==="Y"} onChange={e=>setEdit({...edit,answer_whole:e.target.checked?"Y":"N"})}/> পুরো উত্তরটাই একটা ট্যাগ হতে হবে (যেমন Preposition)</label>
          <label style={{display:"flex",gap:8,alignItems:"center",fontSize:12,marginBottom:10}}><input type="checkbox" checked={edit.active==="Y"} onChange={e=>setEdit({...edit,active:e.target.checked?"Y":"N"})}/> রুল সক্রিয়</label>

          <label style={lbl}>নোট (ঐচ্ছিক)</label>
          <input className="inp" value={edit.note} onChange={e=>setEdit({...edit,note:e.target.value})} style={{marginBottom:12}}/>

          <div style={row}>
            <button className="btn bp" disabled={busy||!edit.topic_id||!edit.keywords.trim()} onClick={()=>saveRule(edit)}>💾 সেভ</button>
            <button className="btn" disabled={!edit.topic_id||!edit.keywords.trim()} onClick={()=>{ setUseDraft(true); setTab("test"); }}>🧪 এই ড্রাফট টেস্ট করো</button>
            <button className="btn bg" onClick={()=>{ setEdit(null); setUseDraft(false); }}>বাতিল</button>
          </div>
        </div>}

        {!edit && <div style={{marginBottom:10}}>
          <button className="btn bg" style={{width:"100%",justifyContent:"center"}} onClick={()=>setBulkOpen(o=>!o)}>📥 একসাথে অনেক রুল যোগ {bulkOpen?"▲":"▼"}</button>
          {bulkOpen && <div className="card" style={{marginTop:8}}>
            <div style={{fontSize:11,color:C.muted,lineHeight:1.7,marginBottom:8}}>প্রতি লাইনে একটা রুল:<br/><b>টপিক | ট্যাগ, ট্যাগ | কোথায় | বাদ-শব্দ | কমপক্ষে কয় মিল</b><br/>টপিক = "Subject › Topic" নামে (যেমন "পাটিগণিত › লাভ-ক্ষতি")। টপিকের নাম একটাই হলে শুধু নামও চলে। কোথায় = প্রশ্ন / উত্তর / উভয় (ফাঁকা = প্রশ্ন)। শেষ দুটো ঐচ্ছিক। "উত্তর" দিলে ফাঁকা-শর্ত ও পুরো-উত্তর শর্ত নিজে চালু হয়।</div>
            <textarea className="inp" rows={6} value={bulkText} onChange={e=>setBulkText(e.target.value)} placeholder={"পাটিগণিত › লাভ-ক্ষতি | লাভ, ক্ষতি, ক্রয়মূল্য, বিক্রয়মূল্য | প্রশ্ন | | 2\nEnglish Grammar › Preposition | in, on, at, to, from | উত্তর"} style={{fontFamily:"inherit",marginBottom:8}}/>
            <button className="btn bp" disabled={busy||!bulkText.trim()||needSetup} onClick={doBulkImport}>{busy?"⏳ ইমপোর্ট হচ্ছে…":"📥 ইমপোর্ট করো"}</button>
            {bulkLog.length>0 && <div style={{marginTop:8,fontSize:11,lineHeight:1.7,wordBreak:"break-word"}}>{bulkLog.map((l,i)=><div key={i} style={{color:l.startsWith("✅")?C.success:l.startsWith("⏭")?C.warning:C.danger}}>{l}</div>)}</div>}
          </div>}
        </div>}

        {rules===null && !loadErr && <div style={{color:C.muted,fontSize:12}}>লোড হচ্ছে…</div>}
        {rules && rules.length===0 && !needSetup && <div className="empty">এখনো কোনো রুল নেই — ➕ নতুন রুল দিয়ে শুরু করো</div>}
        {(rules||[]).map(r=>(
          <div key={r.rule_id} className="card" style={{marginBottom:8,opacity:r.active==="Y"?1:0.55}}>
            <div style={{...row,justifyContent:"space-between"}}>
              <div style={{fontSize:13,fontWeight:700}}>{topicLabel(r.topic_id)}</div>
              <span style={{fontSize:11,color:C.muted}}>{MATCH_LABEL[r.match_in]||r.match_in}{r.priority?` · P${r.priority}`:""}{Number(r.min_matches)>1?` · ≥${r.min_matches} মিল`:""}</span>
            </div>
            <div style={{fontSize:12,color:C.muted,lineHeight:1.5,wordBreak:"break-word"}}>{String(r.keywords).length>160?String(r.keywords).slice(0,160)+"…":r.keywords}</div>
            {(r.require_blank==="Y"||r.answer_whole==="Y"||String(r.exclude_keywords||"").trim())&&<div style={{fontSize:11,color:C.muted,marginTop:4}}>
              {r.require_blank==="Y"&&"ফাঁকা-শর্ত · "}{r.answer_whole==="Y"&&"পুরো-উত্তর · "}{String(r.exclude_keywords||"").trim()&&`বাদ: ${String(r.exclude_keywords).slice(0,60)}`}
            </div>}
            <div style={{...row,marginTop:8}}>
              <button className="btn" disabled={busy} onClick={()=>{ startEdit({...EMPTY_RULE,...r}); window.scrollTo?.({top:0,behavior:"smooth"}); }}>✏️ এডিট</button>
              <button className="btn" disabled={busy} onClick={()=>toggleActive(r)}>{r.active==="Y"?"⏸ বন্ধ":"▶ চালু"}</button>
              <button className="btn" disabled={busy} style={{color:C.danger}} onClick={()=>deleteRule(r)}>🗑</button>
            </div>
          </div>
        ))}
      </div>}

      {/* ══════════ 🧪 টেস্ট ══════════ */}
      {tab==="test" && <div className="card">
        <div style={{fontSize:13,fontWeight:700,marginBottom:8}}>🧪 একটা প্রশ্ন কোন টপিকে যেত?</div>
        {edit && <label style={{display:"flex",gap:8,alignItems:"center",fontSize:12,marginBottom:10,color:C.info}}>
          <input type="checkbox" checked={useDraft} onChange={e=>setUseDraft(e.target.checked)}/> শুধু ফর্মের ড্রাফট রুল দিয়ে টেস্ট (সেভ না করেই)
        </label>}
        <label style={lbl}>প্রশ্ন</label>
        <textarea className="inp" rows={3} value={testQ.question} onChange={e=>setTestQ({...testQ,question:e.target.value})} style={{marginBottom:8,fontFamily:"inherit"}}/>
        {[1,2,3,4].map(n=><input key={n} className="inp" placeholder={`অপশন ${n}`} value={testQ["option"+n]} onChange={e=>setTestQ({...testQ,["option"+n]:e.target.value})} style={{marginBottom:6}}/>)}
        <label style={lbl}>সঠিক উত্তর (অপশনের লেখা)</label>
        <input className="inp" value={testQ.correct} onChange={e=>setTestQ({...testQ,correct:e.target.value})} style={{marginBottom:10}}/>
        <button className="btn bp" disabled={busy} onClick={runTest}>▶ টেস্ট চালাও</button>

        {testRes && <div style={{marginTop:12}}>
          <div style={{padding:10,borderRadius:8,background:tint(testRes.result==="match"?C.success:testRes.result==="conflict"?C.warning:C.border,"22"),fontSize:13,fontWeight:700}}>
            {testRes.result==="match" && <>✅ যেত → {String(testRes.winner.topic).replace(" / "," › ")}<div style={{fontSize:11,fontWeight:400,marginTop:3}}>মিলেছে: {testRes.winner.matched.join(", ")}</div></>}
            {testRes.result==="conflict" && "⚠️ একাধিক রুলে সমান মিল — অটো-মুভ হতো না, রিভিউতে যেত"}
            {testRes.result==="none" && "— কোনো রুল মেলেনি, যেমন আছে তেমনই থাকত"}
            <div style={{fontSize:11,fontWeight:400,color:C.muted,marginTop:3}}>ধরা উত্তর: {testRes.answer||"(ফাঁকা)"}</div>
          </div>
          <div style={{marginTop:8}}>
            {testRes.explain.map(e=><div key={e.rule_id} style={{fontSize:12,padding:"6px 0",borderBottom:`1px solid ${C.border}`}}>
              <b style={{color:e.hit?C.success:C.muted}}>{e.hit?"✔":"✘"} {String(e.topic).replace(" / "," › ")}</b>
              <div style={{color:C.muted,fontSize:11}}>{e.hit?`মিলেছে: ${e.matched.join(", ")}`:e.reason}</div>
            </div>)}
          </div>
        </div>}
      </div>}

      {/* ══════════ ▶ রান ══════════ */}
      {tab==="run" && <div>
        <div className="card" style={{marginBottom:10}}>
          <div style={{fontSize:13,fontWeight:700,marginBottom:6}}>▶ Preview → Apply</div>
          <div style={{fontSize:11,color:C.muted,marginBottom:10,lineHeight:1.6}}>Preview কিছু বদলায় না। ফেরত নেওয়া (LOCK) বা "ঠিক আছে" চিহ্নিত প্রশ্ন কখনো ধরা হয় না।</div>
          <label style={lbl}>কোন প্রশ্ন ধরবে (শুধু QBank-এর MCQ — শুধু-Quiz প্রশ্ন কখনো ছোঁয় না)</label>
          <div style={{display:"flex",flexDirection:"column",gap:6,marginBottom:10}}>
            {[["blank","শুধু Subject ফাঁকা/পুল (ডিফল্ট, সবচেয়ে নিরাপদ)"],["subject","একটা Subject-এর ঠিক-করা প্রশ্নও (টপিক ঠিক করতে)"],["all","সব ঠিক-করা QBank MCQ-ও (সব Subject)"]].map(([k,l])=>
              <label key={k} style={{display:"flex",gap:8,alignItems:"center",fontSize:12}}><input type="radio" name="candmode" checked={candMode===k} onChange={()=>{ setCandMode(k); setPv(null); }}/> {l}</label>)}
            {candMode==="subject" && <select className="inp" value={candSubj} onChange={e=>{ setCandSubj(e.target.value); setPv(null); }}>
              <option value="">— Subject বাছো —</option>
              {subjectList.map(sj=><option key={sj.id} value={sj.id}>{sj.name}</option>)}
            </select>}
            {candMode!=="blank" && <div style={{fontSize:11,color:C.warning,lineHeight:1.6}}>⚠ আগে ঠিক-করা প্রশ্নও টপিক বদলাতে পারে (যে প্রশ্ন ইতিমধ্যে ঠিক টপিকে আছে সেটা ছোঁয় না)। Preview-তে "এখন আছে" দেখে নাও; ভুল হলে ↩ ফেরত।{candMode==="subject"?" এই Subject-এর রুল দিয়েই শুধু চলবে।":""}</div>}
          </div>

          <label style={lbl}>কোন রুল</label>
          <select className="inp" value={scope} onChange={e=>{ setScope(e.target.value); setPv(null); }} style={{marginBottom:10}}>
            <option value="">সব সক্রিয় রুল ({activeRules.length}টি)</option>
            {activeRules.map(r=><option key={r.rule_id} value={r.rule_id}>{topicLabel(r.topic_id)}</option>)}
          </select>
          <div style={row}>
            <button className="btn bp" disabled={busy||needSetup||!activeRules.length||(candMode==="subject"&&!candSubj)} onClick={doPreview}>{busy&&!pv?"⏳ চলছে… (১-২ মিনিট লাগতে পারে)":"🔎 Preview"}</button>
            <button className="btn" disabled={busy||!pv||pv.matched<1} style={{background:pv&&pv.matched>0?tint(C.success,"33"):undefined,color:pv&&pv.matched>0?C.success:undefined,fontWeight:700}} onClick={doApply}>✅ Apply{pv?` (${Math.max(0,pv.matched-Object.keys(excluded).length)})`:""}</button>
          </div>
        </div>

        {pv && <div className="card" style={{marginBottom:10}}>
          <div style={{fontSize:12,lineHeight:1.8}}>প্রার্থী <b>{pv.candidates}</b> · সরবে <b style={{color:C.success}}>{pv.matched}</b>{pv.same>0&&<> · আগে থেকেই ঠিক <b>{pv.same}</b></>} · দ্বন্দ্ব <b style={{color:C.warning}}>{pv.conflict}</b> · মেলেনি <b>{pv.none}</b></div>
          {(pv.problems||[]).map((p,i)=><div key={i} style={{fontSize:11,color:C.warning,marginTop:4}}>⚠ {p}</div>)}
          {pv.rules.filter(r=>r.count>0).map(r=><div key={r.rule_id} style={{fontSize:12,marginTop:6}}>→ <b>{r.topic.replace(" / "," › ")}</b> <span style={{color:C.success}}>({r.count}টি)</span></div>)}
          {pv.items && pv.matched>pv.items.length && <div style={{fontSize:11,color:C.warning,marginTop:6}}>⚠ তালিকায় প্রথম {pv.items.length}টি দেখানো হলো; Apply সব {pv.matched}টিতে চলবে (আনমার্ক করা ছাড়া)।</div>}
        </div>}

        {pv && pv.items && pv.items.length>0 && (()=>{
          const items=pv.items, total=items.length, excN=Object.keys(excluded).length, pickedN=total-excN;
          const q=pvQuery.trim().toLowerCase();
          const filtered=q?items.filter(it=>(it.q+" "+it.a+" "+it.topic+" "+(it.from||"")).toLowerCase().includes(q)):items;
          const shown=filtered.slice(0,pvShown);
          const toggle=(id)=>setExcluded(e=>{ const n={...e}; if(n[id]) delete n[id]; else n[id]=true; return n; });
          const setMany=(list,mark)=>setExcluded(e=>{ const n={...e}; list.forEach(it=>{ if(mark) n[it.id]=true; else delete n[it.id]; }); return n; });
          const hl=(text,kws)=>{
            if(!kws||!kws.length) return text;
            const re=new RegExp("("+kws.slice().sort((a,b)=>b.length-a.length).map(k=>k.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")).join("|")+")","gi");
            return String(text).split(re).map((part,i)=>i%2===1?<mark key={i} style={{background:tint(C.warning,"55"),color:"inherit",borderRadius:3,padding:"0 2px"}}>{part}</mark>:part);
          };
          let prevTopic=null;
          return(
            <div style={{marginBottom:10}}>
              <div className="card" style={{marginBottom:8,position:"sticky",top:0,zIndex:5}}>
                <div style={{...row,justifyContent:"space-between",marginBottom:8}}>
                  <div style={{fontSize:13,fontWeight:700}}>☑ নির্বাচিত <span style={{color:C.success}}>{pickedN}</span> / {total}</div>
                  {excN>0 && <span style={{fontSize:11,color:C.warning}}>{excN}টি আনমার্ক — আর রুলে আসবে না</span>}
                </div>
                <input className="inp" value={pvQuery} onChange={e=>{ setPvQuery(e.target.value); setPvShown(40); }} placeholder="🔍 প্রশ্ন/উত্তর/টপিকে খোঁজো" style={{marginBottom:8}}/>
                <div style={row}>
                  <button className="btn" disabled={busy} onClick={()=>setMany(filtered,false)}>✔ {q?"এগুলো":"সব"} সিলেক্ট</button>
                  <button className="btn" disabled={busy} onClick={()=>setMany(filtered,true)}>✖ {q?"এগুলো":"সব"} আনসিলেক্ট</button>
                </div>
              </div>

              {shown.map(it=>{
                const showHead=it.topic!==prevTopic; prevTopic=it.topic;
                const on=!excluded[it.id];
                const groupItems=filtered.filter(x=>x.topic===it.topic);
                return(
                  <React.Fragment key={it.id}>
                    {showHead && <div style={{...row,justifyContent:"space-between",margin:"12px 2px 6px"}}>
                      <div style={{fontSize:12,fontWeight:800,color:C.info}}>→ {it.topic} <span style={{color:C.muted,fontWeight:500}}>({groupItems.length}টি)</span></div>
                      <div style={row}>
                        <span style={{fontSize:11,color:C.success,cursor:"pointer"}} onClick={()=>setMany(groupItems,false)}>সব ✔</span>
                        <span style={{fontSize:11,color:C.danger,cursor:"pointer"}} onClick={()=>setMany(groupItems,true)}>সব ✖</span>
                      </div>
                    </div>}
                    <div onClick={()=>toggle(it.id)} className="card" style={{marginBottom:8,cursor:"pointer",display:"flex",gap:10,alignItems:"flex-start",opacity:on?1:0.5,border:`1px solid ${on?C.border:tint(C.danger,"66")}`}}>
                      <input type="checkbox" checked={on} onChange={()=>toggle(it.id)} onClick={e=>e.stopPropagation()} style={{width:20,height:20,marginTop:2,flexShrink:0}}/>
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{fontSize:13,lineHeight:1.6,wordBreak:"break-word"}}>{hl(it.q.length>260?it.q.slice(0,260)+"…":it.q,it.m)}</div>
                        {it.a && <div style={{fontSize:12,color:C.info,marginTop:4}}>উত্তর: {hl(it.a,it.m)}</div>}
                        <div style={{display:"flex",flexWrap:"wrap",gap:5,marginTop:6}}>
                          {it.m.map(k=><span key={k} style={{fontSize:10,padding:"2px 7px",borderRadius:10,background:tint(C.warning,"33"),color:C.text}}>{k}</span>)}
                        </div>
                        <div style={{fontSize:11,color:C.muted,marginTop:5}}>{it.from?`এখন আছে: ${it.from}`:"এখন: Subject ফাঁকা"}</div>
                      </div>
                    </div>
                  </React.Fragment>
                );
              })}
              {filtered.length===0 && <div className="empty">খোঁজার সাথে মেলে এমন প্রশ্ন নেই</div>}
              {filtered.length>pvShown && <button className="btn" style={{width:"100%",justifyContent:"center"}} onClick={()=>setPvShown(n=>n+40)}>আরও দেখাও ({filtered.length-pvShown}টি বাকি)</button>}
            </div>
          );
        })()}

        {applied && <div className="card" style={{marginBottom:10,border:`1px solid ${C.success}`}}>
          <div style={{fontSize:13,fontWeight:700,color:C.success}}>✅ {applied.applied||0}টি প্রশ্ন সরানো হয়েছে{applied.excluded?` · ${applied.excluded}টি বাদ (আর রুলে আসবে না)`:""}</div>
          <div style={{fontSize:11,color:C.muted,marginTop:4}}>batch {applied.batch} · {applied.dirtyTopics||0}টি টপিক dirty — এখন <b>CDN → Publish Now</b> চালাও।</div>
        </div>}

        <div className="card">
          <div style={{fontSize:13,fontWeight:700,marginBottom:8}}>↩ ফেরত নেওয়া</div>
          <div style={row}>
            <button className="btn" disabled={busy} onClick={()=>doUndo(false)}>↩ সর্বশেষ Apply ফেরত</button>
            <button className="btn" disabled={busy} style={{color:C.danger}} onClick={()=>doUndo(true)}>↩ সব অটো-মুভ ফেরত</button>
          </div>
          <div style={{fontSize:11,color:C.muted,marginTop:6}}>ফেরত নেওয়া সারি আগের টপিকে ফিরে LOCK হয় — অটো আর ছোঁয় না।</div>
        </div>
      </div>}

      {/* ══════════ 👁 রিভিউ ══════════ */}
      {tab==="review" && <div>
        <div style={{...row,marginBottom:10}}>
          <span style={chip(revKind==="auto")} onClick={()=>{ setRevKind("auto"); setRev({items:[],total:0,nextCursor:null,loaded:false}); }}>🤖 অটো-মুভ হয়েছে</span>
          <span style={chip(revKind==="conflict")} onClick={()=>{ setRevKind("conflict"); setRev({items:[],total:0,nextCursor:null,loaded:false}); }}>⚠ দ্বন্দ্ব</span>
          <button className="btn bg" disabled={busy} onClick={()=>setRev(r=>({...r,loaded:false}))}>🔁</button>
        </div>
        {busy && !rev.items.length && <div style={{fontSize:12,color:C.muted}}>লোড হচ্ছে…</div>}
        {rev.loaded && <div style={{fontSize:12,color:C.muted,marginBottom:8}}>{rev.total}টি {revKind==="auto"?"(ঠিক আছে/ফেরত না করা)":"(হাতে টপিক বসাতে হবে)"}</div>}
        {rev.loaded && !rev.items.length && <div className="empty">{revKind==="auto"?"রিভিউ করার মতো অটো-মুভ নেই":"কোনো দ্বন্দ্ব নেই"}</div>}
        {rev.items.map(it=><div key={it.id} className="card" style={{marginBottom:8}}>
          <div style={{fontSize:11,color:C.muted}}>{it.rule?"🤖 অটো-মুভ":"⚠ দ্বন্দ্ব"}</div>
          <div style={{fontSize:13,margin:"4px 0",wordBreak:"break-word"}}>{it.question}</div>
          <div style={{fontSize:12,color:C.info}}>উত্তর: {it.answer||"—"}</div>
          {revKind==="auto" && <div style={{fontSize:11,color:C.muted,marginTop:3}}>→ {it.subject} › {it.topic} · মিলেছে: {it.matched}</div>}
          {revKind==="conflict" && <div style={{fontSize:11,color:C.warning,marginTop:3}}>{it.detail}</div>}
          {revKind==="auto" && <div style={{...row,marginTop:8}}>
            <button className="btn" disabled={busy} style={{color:C.success}} onClick={()=>reviewAct(it.id,"ok")}>✅ ঠিক আছে</button>
            <button className="btn" disabled={busy} style={{color:C.danger}} onClick={()=>reviewAct(it.id,"undo")}>↩ ফেরত</button>
          </div>}
        </div>)}
        {rev.nextCursor && <button className="btn" style={{width:"100%",justifyContent:"center"}} disabled={busy} onClick={()=>loadReview(revKind,true)}>আরও দেখাও</button>}
      </div>}
    </div>
  );
}

export { TopicTagsTab };
