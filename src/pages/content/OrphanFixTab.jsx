/* ══════════ ORPHAN FIX TAB — Orphan প্রশ্ন মোছা নয়, ঠিক করা ══════════
   Orphan = যে প্রশ্নের topic_id দেওয়া আছে কিন্তু সেই topic_id Topics শিটে নেই (টপিক মুছে/rename হয়ে
   এতিম) — তাই CDN publish-এ যায় না। শুধু সংখ্যা দেখা বা মুছে ফেলার বদলে এখানে প্রশ্নগুলো দেখে ঠিক
   Subject/Topic বসিয়ে দিলেই (topic_id বদলে গেলে) আর Orphan থাকে না, আর প্রশ্নও হারায় না।

   কীভাবে কাজ করে:
   • Quiz/QBank/Study-র সারি আসে আগের মতোই getSheetRows (useSheetRows) থেকে; Topics রেফারেন্সের সাথে মিলিয়ে
     ক্লায়েন্টেই Orphan বের করা হয় (GAS-এর countOrphanQuestions-এর একই সংজ্ঞা) — নতুন GAS অ্যাকশন লাগে না।
   • একই হারানো topic_id-র প্রশ্নগুলো একটা গ্রুপে আসে — একবার Subject/Topic বসালে পুরো গ্রুপ ঠিক হয়ে যায়
     (দরকার হলে কোনো একটা প্রশ্ন আলাদাভাবেও বসানো যায়)।
   • প্রস্তাব: প্রশ্নের subject_id এখনো বৈধ হলে সেই Subject, আর পুরনো sub_topic/topic টেক্সট কলাম থাকলে
     একই নামের বিদ্যমান Topic — এক ক্লিকে queue-তে।
   • ReviewTab-এর মতোই: queue-তে জমা → "💾 সব সেভ করো" → syncFieldsToSheet (update_fields) — topic_id বদলালে
     GAS নিজেই পুরনো+নতুন টপিক dirty করে, তাই পরের CDN Publish-এ প্রশ্নগুলো চলে যায়। */
import React, { useState, useEffect, useMemo } from "react";
import { C, tint } from "../../core/config.js";
import { useSheetRows, invalidate } from "../../core/dataCache.js";
import { toArr, loadSharedGasSecret, saveSharedGasSecret } from "../../core/utils.js";
import { fetchReferenceData, syncFieldsToSheet } from "../../core/sheetSave.js";
import { resolveOrCreateReference } from "../../core/referenceHelpers.js";
import { getCachedReferenceData } from "../../core/refCache.js";
import { useRefCacheSync } from "../../hooks/useRefCacheSync.js";
import { TypeaheadCombo } from "../../components/shared/TypeaheadCombo.jsx";

const SHEETS=["QBank","Quiz","Study"];
const GROUPS_PER_PAGE=25;
const norm=s=>String(s||"").toLowerCase().replace(/[^a-z0-9\u0980-\u09FF]+/g,"");
const idOf=q=>String(q.id||q.ID||"").trim();
const qText=q=>String(q.question||q.Question||"").trim();
const legacyTopic=q=>String(q.sub_topic||q.Sub_topic||q.topic||q.Topic||"").trim();
const legacySubject=q=>String(q.subject||q.Subject||"").trim();
const topOf=obj=>Object.entries(obj||{}).sort((a,b)=>b[1]-a[1])[0]?.[0]||"";

function OrphanSheetPanel({sheet,refData,setRefData,gasSecret,push,tick}){
  const[localTick,setLocalTick]=useState(0);
  const refresh=()=>setLocalTick(t=>t+1);
  const{data:raw,loading}=useSheetRows(sheet,(tick||0)+localTick*1000);
  const rows=useMemo(()=>toArr(raw),[raw]);

  const subjects=useMemo(()=>(refData?.subjects||[]),[refData]);
  const topics=useMemo(()=>(refData?.topics||[]),[refData]);
  const validTopicIds=useMemo(()=>new Set(topics.map(t=>String(t.topic_id))),[topics]);
  const subjById=useMemo(()=>{ const m={}; subjects.forEach(s=>{ m[String(s.subject_id)]=s.subject_name; }); return m; },[subjects]);
  const subjectOptions=useMemo(()=>subjects.map(s=>({id:s.subject_id,name:s.subject_name})),[subjects]);
  const topicOptionsFor=subjectId=>subjectId?topics.filter(t=>String(t.subject_id)===String(subjectId)).map(t=>({id:t.topic_id,name:t.topic_name})):[];

  // ── Orphan গ্রুপ: একই হারানো topic_id → একটা গ্রুপ ──
  const groups=useMemo(()=>{
    if(!topics.length) return [];   // রেফারেন্স লোড না হওয়া পর্যন্ত কিছুই Orphan ধরা হয় না (ভুল গোনা এড়াতে)
    const m=new Map();
    rows.forEach(q=>{
      const tid=String(q.topic_id||"").trim();
      if(!tid||validTopicIds.has(tid)) return;
      const id=idOf(q); if(!id) return;
      let g=m.get(tid);
      if(!g){ g={tid,items:[],sub:{},lt:{},ls:{}}; m.set(tid,g); }
      g.items.push({q,id});
      const sid=String(q.subject_id||"").trim(); if(sid&&subjById[sid]) g.sub[sid]=(g.sub[sid]||0)+1;
      const lt=legacyTopic(q); if(lt) g.lt[lt]=(g.lt[lt]||0)+1;
      const ls=legacySubject(q); if(ls) g.ls[ls]=(g.ls[ls]||0)+1;
    });
    return [...m.values()].sort((a,b)=>b.items.length-a.items.length).map(g=>{
      const sid=topOf(g.sub), lt=topOf(g.lt), ls=topOf(g.ls);
      const subjName=sid?subjById[sid]:(ls&&subjects.find(s=>norm(s.subject_name)===norm(ls))?.subject_name)||"";
      const subjId=sid||(subjects.find(s=>norm(s.subject_name)===norm(subjName))?.subject_id)||"";
      // পুরনো নামের (legacy টেক্সট কলাম) সাথে হুবহু মেলে এমন বিদ্যমান Topic — প্রথমে ওই Subject-এ, না পেলে যেকোনো Subject-এ
      let hit=null;
      if(lt){
        const pool=topics.filter(t=>norm(t.topic_name)===norm(lt));
        hit=pool.find(t=>subjId&&String(t.subject_id)===String(subjId))||(pool.length===1?pool[0]:null);
      }
      const suggestion=hit?{subj:subjById[String(hit.subject_id)]||subjName,topic:hit.topic_name}:null;
      return {...g,subjName,subjId,legacyTopic:lt,suggestion};
    });
  },[rows,topics,validTopicIds,subjById,subjects]);

  const totalOrphan=useMemo(()=>groups.reduce((s,g)=>s+g.items.length,0),[groups]);

  // ── queue: "g:<topic_id>" → পুরো গ্রুপ, "q:<id>" → একটা প্রশ্ন (গ্রুপের ওপর অগ্রাধিকার পায়) ──
  const[pending,setPending]=useState({});
  const[editing,setEditing]=useState(null);
  const[subjSel,setSubjSel]=useState({id:"",name:""});
  const[topicSel,setTopicSel]=useState({id:"",name:""});
  const[openGroup,setOpenGroup]=useState(null);
  const[shown,setShown]=useState(GROUPS_PER_PAGE);
  const[saving,setSaving]=useState(false);
  const[progress,setProgress]=useState({done:0,total:0});
  const pendingCount=Object.keys(pending).length;

  const openFix=(key,g)=>{
    setEditing(key);
    const pv=pending[key];
    setSubjSel({id:"",name:pv?pv.subj:(g.subjName||"")});
    setTopicSel({id:"",name:pv?pv.topic:(g.suggestion?g.suggestion.topic:"")});
  };
  const queueFix=key=>{
    if(!subjSel.name.trim()||!topicSel.name.trim()){ push("warn","Subject ও Topic দুটোই দাও",""); return; }
    setPending(p=>({...p,[key]:{subj:subjSel.name.trim(),topic:topicSel.name.trim()}}));
    setEditing(null);
  };
  const unqueue=key=>setPending(p=>{ const n={...p}; delete n[key]; return n; });
  const queueAllSuggestions=()=>{
    const add={}; let n=0;
    groups.forEach(g=>{ if(g.suggestion&&!pending["g:"+g.tid]){ add["g:"+g.tid]={subj:g.suggestion.subj,topic:g.suggestion.topic}; n++; } });
    if(!n){ push("info","কোনো নতুন প্রস্তাব নেই",""); return; }
    setPending(p=>({...p,...add}));
    push("success",`✨ ${n}টা গ্রুপের প্রস্তাব queue-তে`,"দেখে নিয়ে \"সব সেভ করো\" চাপো");
  };

  // ── সব সেভ: আগে Subject/Topic (distinct জোড়া) একবারই রেজলভ/তৈরি, তারপর প্রতিটা প্রশ্নের topic_id বসানো ──
  const saveAll=async()=>{
    if(!pendingCount) return;
    if(!gasSecret){ push("error","❌ GAS Secret Key দাও","উপরে বসাও"); return; }
    const tasks=[];   // {id,fixKey}
    groups.forEach(g=>g.items.forEach(it=>{
      const fk=pending["q:"+it.id]?("q:"+it.id):(pending["g:"+g.tid]?("g:"+g.tid):null);
      if(fk) tasks.push({id:it.id,fixKey:fk,fix:pending[fk]});
    }));
    if(!tasks.length){ push("warn","queue-র প্রশ্নগুলো আর Orphan নেই","লিস্ট রিফ্রেশ করো"); return; }
    setSaving(true); setProgress({done:0,total:tasks.length});
    let subjOpts=subjectOptions.slice(), topicsLocal=topics.slice();
    const resolved={};   // "subj|topic" → {subjId,topicId} | null
    let createdAny=false;
    for(const t of tasks){
      const rk=norm(t.fix.subj)+"|"+norm(t.fix.topic);
      if(rk in resolved) continue;
      try{
        const sr=await resolveOrCreateReference({sel:{id:"",name:t.fix.subj},refType:"subjects",options:subjOpts,gasSecret,sheet,push});
        if(!sr.ok) throw new Error("subject");
        if(sr.created) createdAny=true;
        if(!subjOpts.some(s=>String(s.id)===String(sr.id))) subjOpts=[...subjOpts,{id:sr.id,name:t.fix.subj}];
        const tOpts=topicsLocal.filter(x=>String(x.subject_id)===String(sr.id)).map(x=>({id:x.topic_id,name:x.topic_name}));
        const tr=await resolveOrCreateReference({sel:{id:"",name:t.fix.topic},refType:"topics",options:tOpts,gasSecret,parentId:sr.id,push});
        if(!tr.ok) throw new Error("topic");
        if(tr.created) createdAny=true;
        if(!topicsLocal.some(x=>String(x.topic_id)===String(tr.id))) topicsLocal=[...topicsLocal,{topic_id:tr.id,topic_name:t.fix.topic,subject_id:sr.id}];
        resolved[rk]={subjId:sr.id,topicId:tr.id};
      }catch(_){ resolved[rk]=null; }
    }
    // প্রতিটা প্রশ্ন — ছোট কনকারেন্সিতে (GAS write-lock আছে, তাই ৩-এর বেশি লাভ নেই)
    const okFix=new Set(), failedFix=new Set();
    let done=0, cursor=0;
    const worker=async()=>{
      while(cursor<tasks.length){
        const t=tasks[cursor++];
        const r=resolved[norm(t.fix.subj)+"|"+norm(t.fix.topic)];
        let ok=false;
        if(r){
          const res=await syncFieldsToSheet({sheet,id:t.id,gasSecret,editSource:"Orphan Fix",
            fields:{subject:t.fix.subj,sub_topic:t.fix.topic,subject_id:r.subjId,topic_id:r.topicId}});
          // legacy টেক্সট কলাম (subject/sub_topic) না থাকলে GAS সেগুলো failed বলে — আসল সংযোগ id দুটো, তাই সেগুলো ঠিক হলেই সফল
          ok=res.ok||(!(res.failed||[]).includes("topic_id")&&!(res.failed||[]).includes("subject_id")&&!res.error);
        }
        (ok?okFix:failedFix).add(t.id);
        done++; setProgress({done,total:tasks.length});
      }
    };
    await Promise.all([worker(),worker(),worker()]);
    // সফল হওয়া প্রশ্নগুলোর queue এন্ট্রি সরাও (গ্রুপ-কী তখনই সরে যায় যখন তার সব প্রশ্ন সফল)
    setPending(p=>{
      const n={...p};
      groups.forEach(g=>{
        const gk="g:"+g.tid;
        if(n[gk]&&g.items.every(it=>okFix.has(it.id)||n["q:"+it.id])) delete n[gk];
        g.items.forEach(it=>{ if(okFix.has(it.id)) delete n["q:"+it.id]; });
      });
      return n;
    });
    setSaving(false);
    const okN=okFix.size, badN=failedFix.size;
    if(okN&&!badN) push("success",`✅ ${okN}টা প্রশ্ন ঠিক হয়েছে — আর Orphan নেই!`,"এখন CDN Publish করলে এগুলো চলে যাবে");
    else if(okN) push("warn",`✅ ${okN}টা ঠিক হয়েছে`,`❌ ${badN}টা ব্যর্থ — queue-তে আছে, আবার চেষ্টা করো`);
    else push("error","❌ কোনোটাই সেভ হয়নি","আবার চেষ্টা করো");
    if(okN){ invalidate(sheet); refresh(); }
    if(createdAny||okN) fetchReferenceData({gasSecret}).then(rd=>{ if(rd) setRefData(rd); }).catch(()=>{});
  };

  const fixForm=(key,g)=>(
    <div style={{marginTop:8,padding:"10px 11px",background:"#0a1628",border:`1px solid ${C.border}`,borderRadius:10}}>
      <div className="fld" style={{marginBottom:8}}>
        <label>📚 Subject</label>
        <TypeaheadCombo options={subjectOptions} value={subjSel} onChange={s=>{ setSubjSel(s); setTopicSel({id:"",name:""}); }} placeholder="Subject লিখো..."
          newLabel={`🆕 "${subjSel.name.trim()}" নতুন Subject হিসেবে যোগ হবে`}/>
      </div>
      <div className="fld" style={{marginBottom:10}}>
        <label>📌 Topic</label>
        <TypeaheadCombo options={topicOptionsFor(subjSel.id||subjectOptions.find(s=>norm(s.name)===norm(subjSel.name))?.id)} value={topicSel} onChange={setTopicSel} placeholder="Topic লিখো..."
          newLabel={`🆕 "${topicSel.name.trim()}" নতুন Topic হিসেবে যোগ হবে`}/>
      </div>
      <div style={{display:"flex",gap:7}}>
        <button className="btn bg" style={{flex:1,justifyContent:"center"}} onClick={()=>setEditing(null)}>বাতিল</button>
        <button className="btn bp" style={{flex:2,justifyContent:"center"}} onClick={()=>queueFix(key)}>✅ Queue-তে যোগ করো</button>
      </div>
    </div>
  );

  const pendingBox=key=>pending[key]&&(
    <div style={{marginTop:7,padding:"7px 10px",background:tint(C.green,"14"),border:`1px solid ${tint(C.green,"44")}`,borderRadius:8,display:"flex",alignItems:"center",gap:8}}>
      <span style={{fontSize:10,color:C.green,fontWeight:700,flex:1}}>✅ queue-তে: 📚 {pending[key].subj} · 📌 {pending[key].topic}</span>
      <button disabled={saving} onClick={()=>unqueue(key)} style={{fontSize:10,padding:"3px 7px",background:"transparent",border:`1px solid ${C.border}`,borderRadius:6,color:C.muted,cursor:"pointer"}}>✕ বাদ</button>
    </div>
  );

  const visible=groups.slice(0,shown);

  return(
    <>
      {pendingCount>0&&(
        <div style={{position:"sticky",top:0,zIndex:30,display:"flex",gap:8,alignItems:"center",padding:"9px 11px",marginBottom:12,background:tint(C.green,"18"),border:`1.5px solid ${tint(C.green,"55")}`,borderRadius:10}}>
          <span style={{fontSize:12,fontWeight:700,color:C.green,flex:1}}>
            {saving?`⏳ সেভ হচ্ছে... ${progress.done}/${progress.total}`:`✅ ${pendingCount}টা ঠিক করা আছে, সেভের অপেক্ষায়`}
          </span>
          <button className="btn bg" disabled={saving} onClick={()=>setPending({})} style={{fontSize:11,padding:"6px 10px"}}>🗑️ খালি করো</button>
          <button className="btn bp" disabled={saving} onClick={saveAll} style={{fontSize:11,padding:"6px 12px",fontWeight:700}}>{saving?"⏳":`💾 সব সেভ করো (${pendingCount})`}</button>
        </div>
      )}

      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8,gap:8}}>
        <span style={{fontSize:11,color:C.muted}}>
          {(loading&&!raw)||!topics.length?"⏳ লোড হচ্ছে...":`${totalOrphan}টি Orphan প্রশ্ন · ${groups.length}টা হারানো topic_id`}
        </span>
        <div style={{display:"flex",gap:6}}>
          {groups.some(g=>g.suggestion)&&<button className="btn bg" style={{fontSize:11,padding:"5px 9px"}} onClick={queueAllSuggestions}>✨ সব প্রস্তাব queue-তে</button>}
          <button className="btn bg" style={{fontSize:11,padding:"5px 9px"}} onClick={()=>{ invalidate(sheet); refresh(); if(gasSecret) fetchReferenceData({gasSecret}).then(rd=>{ if(rd) setRefData(rd); }).catch(()=>{}); }}>🔄</button>
        </div>
      </div>

      {((loading&&!raw)||!topics.length)?[...Array(3)].map((_,i)=><div key={i} className="sk"/>):
       groups.length===0?<div className="empty"><div className="ei">🎉</div><p>{!gasSecret?"GAS Secret Key দাও":`${sheet}-এ কোনো Orphan প্রশ্ন নেই`}</p></div>:
       visible.map(g=>{
        const gk="g:"+g.tid;
        const isOpen=openGroup===g.tid;
        return(
          <div key={g.tid} className="qcard">
            <div style={{display:"flex",gap:6,alignItems:"center",marginBottom:5,flexWrap:"wrap"}}>
              <span style={{fontSize:10,fontWeight:800,color:C.warning}}>🧟 {g.items.length}টি প্রশ্ন</span>
              <span style={{fontSize:9,color:C.muted}}>topic_id #{g.tid}</span>
              <div style={{flex:1}}/>
              <button className="btn" style={{padding:"3px 9px",fontSize:10}} onClick={()=>setOpenGroup(isOpen?null:g.tid)}>{isOpen?"▲ বন্ধ":"👁 প্রশ্নগুলো"}</button>
            </div>
            <div className="qcard-meta" style={{marginBottom:4}}>
              {g.subjName&&<span className="qtag qtag-sub">📚 {g.subjName}</span>}
              {g.legacyTopic&&<span className="qtag qtag-tp" style={{opacity:.85}}>🕘 পুরনো নাম: {g.legacyTopic}</span>}
              {!g.subjName&&!g.legacyTopic&&<span style={{fontSize:10,color:C.muted}}>পুরনো Subject/Topic-এর কোনো চিহ্ন নেই</span>}
            </div>
            <div className="qcard-q" style={{fontSize:12}}>{qText(g.items[0].q).slice(0,90)}{qText(g.items[0].q).length>90?"…":""}</div>

            {pending[gk]?pendingBox(gk):editing===gk?fixForm(gk,g):(
              <div style={{display:"flex",gap:6,marginTop:7}}>
                {g.suggestion&&(
                  <button onClick={()=>setPending(p=>({...p,[gk]:{subj:g.suggestion.subj,topic:g.suggestion.topic}}))}
                    style={{flex:2,padding:"6px 4px",fontSize:10,fontWeight:700,color:C.green,background:tint(C.green,"12"),border:`1px solid ${tint(C.green,"44")}`,borderRadius:8,cursor:"pointer"}}>
                    ✨ {g.suggestion.subj} → {g.suggestion.topic}
                  </button>
                )}
                <button onClick={()=>openFix(gk,g)}
                  style={{flex:1,padding:"6px 4px",fontSize:10,fontWeight:700,color:C.warning,background:tint(C.warning,"12"),border:`1px solid ${tint(C.warning,"33")}`,borderRadius:8,cursor:"pointer"}}>
                  ✏️ সবগুলো ঠিক করো
                </button>
              </div>
            )}

            {isOpen&&(
              <div style={{marginTop:8,borderTop:`1px solid ${C.border}`,paddingTop:6}}>
                {g.items.slice(0,60).map(it=>{
                  const qk="q:"+it.id;
                  return(
                    <div key={it.id} style={{padding:"5px 0",borderBottom:`1px dashed ${C.border}`}}>
                      <div style={{fontSize:11,color:C.text,lineHeight:1.4}}>{qText(it.q).slice(0,140)||"(প্রশ্ন নেই)"}</div>
                      <div style={{display:"flex",gap:6,alignItems:"center",marginTop:3}}>
                        <span style={{fontSize:9,color:C.muted,flex:1}}>#{it.id}</span>
                        {!pending[qk]&&editing!==qk&&(
                          <button onClick={()=>openFix(qk,g)} style={{fontSize:10,padding:"2px 8px",background:"transparent",border:`1px solid ${C.border}`,borderRadius:6,color:C.muted,cursor:"pointer"}}>✏️ শুধু এটা আলাদা</button>
                        )}
                      </div>
                      {pending[qk]?pendingBox(qk):editing===qk&&fixForm(qk,g)}
                    </div>
                  );
                })}
                {g.items.length>60&&<div style={{fontSize:10,color:C.muted,padding:"6px 0"}}>… আরও {g.items.length-60}টি (গ্রুপ-ফিক্সে এগুলোও ঠিক হবে)</div>}
              </div>
            )}
          </div>
        );
       })
      }

      {groups.length>shown&&(
        <button className="btn bg" style={{width:"100%",justifyContent:"center",marginTop:8}} onClick={()=>setShown(s=>s+GROUPS_PER_PAGE)}>আরও দেখাও ({groups.length-shown}টা গ্রুপ বাকি)</button>
      )}
    </>
  );
}

function OrphanFixTab({push,tick}){
  const[gasSecret,setGasSecret]=useState(loadSharedGasSecret);
  const setGasSecretP=v=>{ setGasSecret(v); saveSharedGasSecret(v); };
  const[refData,setRefData]=useState(getCachedReferenceData);
  useRefCacheSync(setRefData);
  const[sheet,setSheet]=useState("QBank");

  // Orphan ঠিকভাবে ধরতে Topics লিস্ট একদম তাজা চাই (ক্যাশে পুরনো থাকলে ভালো প্রশ্নও Orphan দেখাবে)
  useEffect(()=>{
    if(!gasSecret) return;
    fetchReferenceData({gasSecret}).then(rd=>{ if(rd) setRefData(rd); }).catch(()=>{});
  },[gasSecret]);

  return(
    <div className="page">
      <div style={{fontSize:11,color:C.muted,marginBottom:10,lineHeight:1.55}}>
        🧟 Orphan = যে প্রশ্নের topic_id আছে কিন্তু সেই Topic আর Topics শিটে নেই — তাই CDN-এ যায় না। মুছে ফেলার বদলে এখানে ঠিক Subject/Topic বসিয়ে দাও; প্রশ্ন আগের মতোই থাকবে, শুধু আর Orphan থাকবে না।
        একই হারানো Topic-এর সব প্রশ্ন একসাথে ঠিক করা যায়।
      </div>
      {!gasSecret&&(
        <div className="fld" style={{marginBottom:10}}>
          <label>GAS Secret Key</label>
          <input className="inp" type="password" placeholder="Script Properties-এর SECRET_KEY" value={gasSecret} onChange={e=>setGasSecretP(e.target.value)}/>
        </div>
      )}
      <div style={{display:"flex",gap:6,marginBottom:12}}>
        {SHEETS.map(s=>(
          <button key={s} onClick={()=>setSheet(s)}
            style={{flex:1,padding:"8px 4px",borderRadius:20,fontSize:12,fontWeight:700,cursor:"pointer",
              border:`1.5px solid ${sheet===s?C.warning:C.border}`,background:sheet===s?tint(C.warning,"22"):C.panel,color:sheet===s?C.warning:C.muted}}>
            {s}
          </button>
        ))}
      </div>
      <OrphanSheetPanel key={sheet} sheet={sheet} refData={refData} setRefData={setRefData} gasSecret={gasSecret} push={push} tick={tick}/>
    </div>
  );
}

export { OrphanFixTab };
