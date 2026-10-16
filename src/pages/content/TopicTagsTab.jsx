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
  const[topicFilter,setTopicFilter]=useState("");
  const[testQ,setTestQ]=useState({question:"",option1:"",option2:"",option3:"",option4:"",correct:""});
  const[testRes,setTestRes]=useState(null);
  const[useDraft,setUseDraft]=useState(false);
  const[scope,setScope]=useState("");          // "" = সব সক্রিয় রুল
  const[pv,setPv]=useState(null);              // Preview ফলাফল (scope সহ)
  const[applied,setApplied]=useState(null);
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
  const filteredTopics=useMemo(()=>{
    const q=topicFilter.trim().toLowerCase(); if(!q) return topics;
    return topics.filter(t=>(t.sname+" "+t.name+" "+t.id).toLowerCase().includes(q));
  },[topics,topicFilter]);

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
    push("success","✅ রুল সেভ হয়েছে",res.rule_id); setEdit(null); setPv(null); await loadAll(); return true;
  });
  const toggleActive=(r)=>saveRule({...r,active:r.active==="Y"?"N":"Y"});
  const deleteRule=(r)=>{
    if(!window.confirm(`রুল "${r.rule_id}" মুছবে? (আগে অটো-মুভ হওয়া প্রশ্ন যেমন আছে তেমনই থাকবে)`)) return;
    guard(async()=>{
      const res=await ttDeleteRule(gasSecret,r.rule_id);
      if(res.status!=="success"){ push("error","❌ মোছা ব্যর্থ",res.message||""); return; }
      push("success","🗑 রুল মোছা হয়েছে",r.rule_id); setPv(null); await loadAll();
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
    if(byName.length>1) return {err:`"${t}" নামে ${byName.length}টি টপিক — topic_id (যেমন ${byName[0].id}) দাও`};
    return {err:`টপিক পাওয়া যায়নি: ${t}`};
  };
  const parseMatch=(x)=>{ const v=(x||"").trim().toLowerCase(); if(["answer","উত্তর","ans","a"].includes(v)) return "answer"; if(["both","উভয়","দুটোই","b"].includes(v)) return "both"; return "question"; };
  const doBulkImport=()=>guard(async()=>{
    const lines=bulkText.split("\n").map(l=>l.trim()).filter(Boolean);
    if(!lines.length){ push("warn","কিছু লেখা নেই",""); return; }
    const log=[]; let ok=0;
    for(let i=0;i<lines.length;i++){
      const parts=lines[i].split("|").map(x=>x.trim());
      if(parts.length<2){ log.push(`❌ লাইন ${i+1}: "টপিক | ট্যাগ" ফরম্যাট লাগবে`); setBulkLog([...log]); continue; }
      const tp=resolveTopic(parts[0]);
      if(tp.err){ log.push(`❌ লাইন ${i+1}: ${tp.err}`); setBulkLog([...log]); continue; }
      if(!parts[1]){ log.push(`❌ লাইন ${i+1}: ট্যাগ ফাঁকা`); setBulkLog([...log]); continue; }
      const mi=parseMatch(parts[2]);
      const rule={...EMPTY_RULE,topic_id:tp.id,keywords:parts[1],match_in:mi,exclude_keywords:parts[3]||"",min_matches:parts[4]?Number(parts[4])||1:1,answer_whole:mi==="answer"?"Y":"N",require_blank:mi==="answer"?"Y":"N"};
      const res=await ttSaveRule(gasSecret,rule);
      if(res.status==="success"){ ok++; log.push(`✅ লাইন ${i+1}: ${res.rule_id} → ${topicLabel(tp.id)}`); }
      else log.push(`❌ লাইন ${i+1}: ${res.message||"সেভ ব্যর্থ"}`);
      setBulkLog([...log]);
    }
    push(ok===lines.length?"success":"warn",`📥 ${ok}/${lines.length}টি রুল ইমপোর্ট হয়েছে`,"Preview দিয়ে ফল দেখে নাও");
    if(ok) { setBulkText(""); setPv(null); await loadAll(); }
  });

  /* ── Preview / Apply / Undo ── */
  const doPreview=()=>guard(async()=>{
    setApplied(null);
    const res=await ttPreview(gasSecret,scope);
    if(res.status!=="success"){ push("error","❌ Preview ব্যর্থ",res.message||""); setPv(null); return; }
    setPv({...res,scope});
  });
  const doApply=()=>{
    if(!pv||pv.matched<1) return;
    if(!window.confirm(`${pv.matched}টি প্রশ্ন নিজে থেকে নতুন Subject/Topic-এ সরবে (ও Quiz-এ যাবে)। চালাবে?\n\nভুল হলে "সর্বশেষ Apply ফেরত" দিয়ে ফিরিয়ে আনা যাবে।`)) return;
    guard(async()=>{
      const res=await ttApply(gasSecret,pv.scope);
      if(res.status!=="success"){ push("error","❌ Apply ব্যর্থ",res.message||""); return; }
      setApplied(res); setPv(null); setRev(r=>({...r,loaded:false}));
      push("success",`✅ ${res.applied||0}টি প্রশ্ন সরানো হয়েছে`,"এখন Publish ট্যাবে Publish Now চালাও");
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
        {!edit && <button className="btn bp" style={{width:"100%",justifyContent:"center",marginBottom:10}} disabled={needSetup} onClick={()=>setEdit({...EMPTY_RULE})}>➕ নতুন রুল</button>}

        {edit && <div className="card" style={{marginBottom:12,border:`1px solid ${C.info}`}}>
          <div style={{fontSize:13,fontWeight:700,marginBottom:10}}>{edit.rule_id?`✏️ রুল এডিট: ${edit.rule_id}`:"➕ নতুন রুল"}</div>

          <label style={lbl}>Subject › Topic (যেখানে প্রশ্ন সরবে)</label>
          <input className="inp" value={topicFilter} onChange={e=>setTopicFilter(e.target.value)} placeholder="🔍 খোঁজো (যেমন: লাভ, Preposition)" style={{marginBottom:6}}/>
          <select className="inp" value={edit.topic_id} onChange={e=>setEdit({...edit,topic_id:e.target.value})} style={{marginBottom:10}}>
            <option value="">— টপিক বাছো ({filteredTopics.length}টি) —</option>
            {edit.topic_id && !filteredTopics.find(t=>t.id===edit.topic_id) && <option value={edit.topic_id}>{topicLabel(edit.topic_id)}</option>}
            {filteredTopics.slice(0,300).map(t=><option key={t.id} value={t.id}>{t.sname} › {t.name} ({t.id})</option>)}
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
            <div style={{fontSize:11,color:C.muted,lineHeight:1.7,marginBottom:8}}>প্রতি লাইনে একটা রুল:<br/><b>টপিক | ট্যাগ, ট্যাগ | কোথায় | বাদ-শব্দ | কমপক্ষে কয় মিল</b><br/>টপিক = topic_id (S04_T31) বা নাম বা "পাটিগণিত › লাভ-ক্ষতি"। কোথায় = প্রশ্ন / উত্তর / উভয় (ফাঁকা = প্রশ্ন)। শেষ দুটো ঐচ্ছিক। "উত্তর" দিলে ফাঁকা-শর্ত ও পুরো-উত্তর শর্ত নিজে চালু হয়।</div>
            <textarea className="inp" rows={6} value={bulkText} onChange={e=>setBulkText(e.target.value)} placeholder={"S04_T31 | লাভ, ক্ষতি, ক্রয়মূল্য, বিক্রয়মূল্য | প্রশ্ন | | 2\nS03_T24 | in, on, at, to, from | উত্তর"} style={{fontFamily:"inherit",marginBottom:8}}/>
            <button className="btn bp" disabled={busy||!bulkText.trim()||needSetup} onClick={doBulkImport}>{busy?"⏳ ইমপোর্ট হচ্ছে…":"📥 ইমপোর্ট করো"}</button>
            {bulkLog.length>0 && <div style={{marginTop:8,fontSize:11,lineHeight:1.7,wordBreak:"break-word"}}>{bulkLog.map((l,i)=><div key={i} style={{color:l.startsWith("✅")?C.success:C.danger}}>{l}</div>)}</div>}
          </div>}
        </div>}

        {rules===null && !loadErr && <div style={{color:C.muted,fontSize:12}}>লোড হচ্ছে…</div>}
        {rules && rules.length===0 && !needSetup && <div className="empty">এখনো কোনো রুল নেই — ➕ নতুন রুল দিয়ে শুরু করো</div>}
        {(rules||[]).map(r=>(
          <div key={r.rule_id} className="card" style={{marginBottom:8,opacity:r.active==="Y"?1:0.55}}>
            <div style={{...row,justifyContent:"space-between"}}>
              <div style={{fontSize:13,fontWeight:700}}>{r.rule_id}</div>
              <span style={{fontSize:11,color:C.muted}}>{MATCH_LABEL[r.match_in]||r.match_in}{r.priority?` · P${r.priority}`:""}{Number(r.min_matches)>1?` · ≥${r.min_matches} মিল`:""}</span>
            </div>
            <div style={{fontSize:12,color:C.info,margin:"4px 0"}}>→ {topicLabel(r.topic_id)}</div>
            <div style={{fontSize:12,color:C.muted,lineHeight:1.5,wordBreak:"break-word"}}>{String(r.keywords).length>160?String(r.keywords).slice(0,160)+"…":r.keywords}</div>
            {(r.require_blank==="Y"||r.answer_whole==="Y"||String(r.exclude_keywords||"").trim())&&<div style={{fontSize:11,color:C.muted,marginTop:4}}>
              {r.require_blank==="Y"&&"ফাঁকা-শর্ত · "}{r.answer_whole==="Y"&&"পুরো-উত্তর · "}{String(r.exclude_keywords||"").trim()&&`বাদ: ${String(r.exclude_keywords).slice(0,60)}`}
            </div>}
            <div style={{...row,marginTop:8}}>
              <button className="btn" disabled={busy} onClick={()=>{ setEdit({...EMPTY_RULE,...r}); setTopicFilter(""); window.scrollTo?.({top:0,behavior:"smooth"}); }}>✏️ এডিট</button>
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
            {testRes.result==="match" && <>✅ যেত → {testRes.winner.topic}<div style={{fontSize:11,fontWeight:400,marginTop:3}}>রুল {testRes.winner.rule_id} · মিলেছে: {testRes.winner.matched.join(", ")}</div></>}
            {testRes.result==="conflict" && "⚠️ একাধিক রুলে সমান মিল — অটো-মুভ হতো না, রিভিউতে যেত"}
            {testRes.result==="none" && "— কোনো রুল মেলেনি, যেমন আছে তেমনই থাকত"}
            <div style={{fontSize:11,fontWeight:400,color:C.muted,marginTop:3}}>ধরা উত্তর: {testRes.answer||"(ফাঁকা)"}</div>
          </div>
          <div style={{marginTop:8}}>
            {testRes.explain.map(e=><div key={e.rule_id} style={{fontSize:12,padding:"6px 0",borderBottom:`1px solid ${C.border}`}}>
              <b style={{color:e.hit?C.success:C.muted}}>{e.hit?"✔":"✘"} {e.rule_id}</b> <span style={{color:C.muted}}>({e.topic})</span>
              <div style={{color:C.muted,fontSize:11}}>{e.hit?`মিলেছে: ${e.matched.join(", ")}`:e.reason}</div>
            </div>)}
          </div>
        </div>}
      </div>}

      {/* ══════════ ▶ রান ══════════ */}
      {tab==="run" && <div>
        <div className="card" style={{marginBottom:10}}>
          <div style={{fontSize:13,fontWeight:700,marginBottom:6}}>▶ Preview → Apply</div>
          <div style={{fontSize:11,color:C.muted,marginBottom:10,lineHeight:1.6}}>প্রার্থী = QBank-এর MCQ, যেগুলোর Subject ফাঁকা বা পুল (S13/S16/S30) এবং আগে ফেরত নেওয়া (LOCK) না। Preview কিছু বদলায় না।</div>
          <label style={lbl}>কোন রুল</label>
          <select className="inp" value={scope} onChange={e=>{ setScope(e.target.value); setPv(null); }} style={{marginBottom:10}}>
            <option value="">সব সক্রিয় রুল ({activeRules.length}টি)</option>
            {activeRules.map(r=><option key={r.rule_id} value={r.rule_id}>{r.rule_id}</option>)}
          </select>
          <div style={row}>
            <button className="btn bp" disabled={busy||needSetup||!activeRules.length} onClick={doPreview}>{busy&&!pv?"⏳ চলছে… (১-২ মিনিট লাগতে পারে)":"🔎 Preview"}</button>
            <button className="btn" disabled={busy||!pv||pv.matched<1} style={{background:pv&&pv.matched>0?tint(C.success,"33"):undefined,color:pv&&pv.matched>0?C.success:undefined,fontWeight:700}} onClick={doApply}>✅ Apply{pv?` (${pv.matched})`:""}</button>
          </div>
        </div>

        {pv && <div className="card" style={{marginBottom:10}}>
          <div style={{fontSize:12,lineHeight:1.8}}>প্রার্থী <b>{pv.candidates}</b> · মিলেছে <b style={{color:C.success}}>{pv.matched}</b> · দ্বন্দ্ব <b style={{color:C.warning}}>{pv.conflict}</b> · মেলেনি <b>{pv.none}</b></div>
          {(pv.problems||[]).map((p,i)=><div key={i} style={{fontSize:11,color:C.warning,marginTop:4}}>⚠ {p}</div>)}
          {pv.rules.map(r=><div key={r.rule_id} style={{marginTop:10}}>
            <div style={{fontSize:12,fontWeight:700}}>{r.rule_id} → {r.topic} <span style={{color:C.success}}>({r.count}টি)</span></div>
            {r.samples.map(s=><div key={s.id} style={{fontSize:11,color:C.muted,padding:"4px 0",borderBottom:`1px solid ${C.border}`,wordBreak:"break-word"}}>
              <b>{s.id}</b> [{s.m}] {s.q.length>110?s.q.slice(0,110)+"…":s.q} <span style={{color:C.info}}>⇒ {s.a}</span>
            </div>)}
          </div>)}
          {pv.conflictSamples?.length>0 && <div style={{marginTop:10}}>
            <div style={{fontSize:12,fontWeight:700,color:C.warning}}>⚠ দ্বন্দ্বের নমুনা (হাতে বসাতে হবে)</div>
            {pv.conflictSamples.map(c=><div key={c.id} style={{fontSize:11,color:C.muted,padding:"4px 0"}}><b>{c.id}</b> {c.q.length>90?c.q.slice(0,90)+"…":c.q} ⇒ {c.rules}</div>)}
          </div>}
        </div>}

        {applied && <div className="card" style={{marginBottom:10,border:`1px solid ${C.success}`}}>
          <div style={{fontSize:13,fontWeight:700,color:C.success}}>✅ {applied.applied||0}টি প্রশ্ন সরানো হয়েছে</div>
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
          <div style={{fontSize:11,color:C.muted}}>{it.id}{it.rule?` · 🤖 ${it.rule}`:""}</div>
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
