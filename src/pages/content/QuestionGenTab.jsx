/* ══════════════════════════════════════════════════════════════════
   AI QUESTION GENERATOR — Subject/Sub-topic দিয়ে AI নতুন প্রশ্ন বানিয়ে
   সরাসরি Firebase-এ push করে (generate-questions.yml ট্রিগার করে)।
   ══════════════════════════════════════════════════════════════════ */
import React, { useState, useEffect } from "react";
import { C } from "../../core/config.js";
import { loadPath } from "../../core/dataCache.js";
import { toArr } from "../../core/utils.js";
import { loadGhCfg, saveGhCfgLS } from "../../core/ghConfig.js";

function QuestionGenTab({push,tick}){
  const[sheet,setSheet]=useState("Quiz");
  const[qtype,setQtype]=useState("MCQ");
  const[subject,setSubject]=useState("");
  const[subtopic,setSubtopic]=useState("");
  const[subjects,setSubjects]=useState([]);
  const[audienceTags,setAudienceTags]=useState([]);
  const[tagInput,setTagInput]=useState("");
  const[count,setCount]=useState(10);
  const[batchSize,setBatchSize]=useState(6);

  useEffect(()=>{
    loadPath(sheet).then(raw=>{
      const arr=toArr(raw);
      const subs=[...new Set(arr.map(q=>q.subject||q.Subject||"").filter(Boolean))];
      setSubjects(subs);
    }).catch(()=>{});
  },[sheet]);

  const addTag=()=>{
    const t=tagInput.trim();
    if(t&&!audienceTags.includes(t)) setAudienceTags(p=>[...p,t]);
    setTagInput("");
  };
  const removeTag=t=>setAudienceTags(p=>p.filter(x=>x!==t));
  const QUICK_TAGS=["Job","Class 7","Computer Operator","Masters 1"];

  const[cfg,setCfg]=useState(loadGhCfg);
  const[editingToken,setEditingToken]=useState(()=>!loadGhCfg().token);
  const[status,setStatus]=useState(null);
  const[busy,setBusy]=useState(false);

  const saveCfg=()=>{
    saveGhCfgLS(cfg);
    setEditingToken(false);
    setStatus({type:"ok",msg:"✅ GitHub সেটিংস এই ডিভাইসে সেভ হয়ে গেছে।"});
  };

  const trigger=async()=>{
    if(!cfg.token){ setStatus({type:"err",msg:"❌ প্রথমে GitHub Token বসিয়ে সেভ করো।"}); return; }
    if(!cfg.repo||!cfg.repo.includes("/")){ setStatus({type:"err",msg:"❌ Repo ফরম্যাট: owner/name"}); return; }
    if(!subject.trim()){ setStatus({type:"err",msg:"❌ Subject লিখো।"}); return; }
    setBusy(true);
    setStatus({type:"info",msg:"পাঠানো হচ্ছে..."});
    try{
      const resp=await fetch(`https://api.github.com/repos/${cfg.repo}/actions/workflows/${cfg.workflowQuestions}/dispatches`,{
        method:"POST",
        headers:{"Accept":"application/vnd.github+json","Authorization":"Bearer "+cfg.token,"Content-Type":"application/json"},
        body:JSON.stringify({ref:"main",inputs:{
          target_sheet:sheet,
          question_type:qtype,
          subject:subject.trim(),
          subtopic:subtopic.trim(),
          audience_tags:audienceTags.join(","),
          count:String(count),
          batch_size:String(batchSize),
        }})
      });
      if(resp.status===204){ setStatus({type:"ok",msg:`✅ চালু হয়ে গেছে! ${count}টা "${subject}" প্রশ্ন তৈরি হচ্ছে — GitHub Actions ট্যাবে দেখো।`}); }
      else{
        const data=await resp.json().catch(()=>({}));
        throw new Error(data.message||`HTTP ${resp.status}`);
      }
    }catch(e){ setStatus({type:"err",msg:"❌ ব্যর্থ: "+e.message}); }
    setBusy(false);
  };

  const statusColors = status?.type==="ok" ? {bg:"#052e16",fg:"#4ade80",bd:"#14532d"}
    : status?.type==="err" ? {bg:"#1f0a0a",fg:"#fca5a5",bd:"#7f1d1d"}
    : {bg:"#0e1a2e",fg:"#93c5fd",bd:C.border};

  return(
    <div style={{paddingBottom:24}}>
      <div style={{background:`linear-gradient(135deg,${C.purple},#5b21b6)`,borderRadius:14,padding:"14px 16px",marginBottom:14,color:"#fff"}}>
        <div style={{fontWeight:900,fontSize:15,marginBottom:2}}>🧬 AI প্রশ্ন জেনারেটর</div>
        <div style={{fontSize:11,opacity:.85}}>Subject/Sub-topic দিয়ে AI নতুন প্রশ্ন বানিয়ে সরাসরি Firebase-এ যোগ করবে</div>
      </div>

      <div style={{background:"#3f1d1d",border:"1px solid #7c2d2d",borderRadius:10,padding:"10px 12px",marginBottom:14,fontSize:11.5,color:"#fca5a5",lineHeight:1.6}}>
        ⚠️ AI নিজের জ্ঞান থেকে প্রশ্ন বানায় (কোনো বই/সোর্স ছাড়া) — ভুল থাকতে পারে। লাইভ করার আগে Browse ট্যাবে গিয়ে একবার চোখ বুলিয়ে নাও।
      </div>

      <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:14,padding:14,marginBottom:12}}>
        <div style={{fontSize:11,textTransform:"uppercase",letterSpacing:.6,color:C.muted,fontWeight:700,marginBottom:10}}>📋 কী প্রশ্ন বানাতে হবে</div>

        <div style={{display:"flex",gap:6,marginBottom:12}}>
          {["Quiz","QBank","Study"].map(m=>(
            <button key={m} className={`ftab${sheet===m?" on":""}`} onClick={()=>setSheet(m)} style={{flex:1}}>{m}</button>
          ))}
        </div>

        {sheet!=="Study"&&(
          <div style={{display:"flex",gap:6,marginBottom:12}}>
            {["MCQ","Written"].map(t=>(
              <button key={t} className={`ftab${qtype===t?" on":""}`} onClick={()=>setQtype(t)} style={{flex:1}}>{t}</button>
            ))}
          </div>
        )}

        <div className="fld"><label>Subject</label>
          <input className="inp" list="qgen-subjects" value={subject} onChange={e=>setSubject(e.target.value)} placeholder="যেমন: পাশ্চাত্যের রাষ্ট্রচিন্তা"/>
          <datalist id="qgen-subjects">{subjects.map(s=><option key={s} value={s}/>)}</datalist>
        </div>

        <div className="fld"><label>Sub-topic (খালি রাখলে Subject-ই হবে)</label>
          <input className="inp" value={subtopic} onChange={e=>setSubtopic(e.target.value)} placeholder="যেমন: ক বিভাগ"/>
        </div>

        <div className="fld"><label>Audience Tags</label>
          <div style={{display:"flex",flexWrap:"wrap",gap:6,marginBottom:8}}>
            {QUICK_TAGS.map(t=>(
              <button key={t} className="btn" style={{background:audienceTags.includes(t)?C.accent:C.panel,color:audienceTags.includes(t)?"#fff":C.muted,border:`1px solid ${C.border}`,fontSize:11}}
                onClick={()=>audienceTags.includes(t)?removeTag(t):setAudienceTags(p=>[...p,t])}>{t}</button>
            ))}
          </div>
          <div style={{display:"flex",gap:6}}>
            <input className="inp" value={tagInput} onChange={e=>setTagInput(e.target.value)} onKeyDown={e=>e.key==="Enter"&&addTag()} placeholder="কাস্টম ট্যাগ লিখে Enter"/>
            <button className="btn" style={{background:C.accent,color:"#fff",flexShrink:0}} onClick={addTag}>+ যোগ</button>
          </div>
          {audienceTags.length>0&&(
            <div style={{display:"flex",flexWrap:"wrap",gap:6,marginTop:8}}>
              {audienceTags.map(t=>(
                <span key={t} style={{background:C.panel,border:`1px solid ${C.border}`,borderRadius:20,padding:"4px 10px",fontSize:11.5,display:"flex",alignItems:"center",gap:6}}>
                  {t}<span style={{cursor:"pointer",color:C.red}} onClick={()=>removeTag(t)}>✕</span>
                </span>
              ))}
            </div>
          )}
        </div>

        <div style={{display:"flex",gap:10}}>
          <div className="fld" style={{flex:1}}><label>মোট সংখ্যা</label>
            <input className="inp" type="number" min="1" max="200" value={count} onChange={e=>setCount(Math.max(1,parseInt(e.target.value)||1))}/>
          </div>
          <div className="fld" style={{flex:1}}><label>প্রতি ব্যাচে</label>
            <input className="inp" type="number" min="1" max="10" value={batchSize} onChange={e=>setBatchSize(Math.max(1,Math.min(10,parseInt(e.target.value)||6)))}/>
          </div>
        </div>
      </div>

      <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:14,padding:14,marginBottom:12}}>
        <div style={{fontSize:11,textTransform:"uppercase",letterSpacing:.6,color:C.muted,fontWeight:700,marginBottom:10}}>⚙️ GitHub Action সেটিংস</div>

        <div className="fld"><label>Repo (owner/name)</label>
          <input className="inp" value={cfg.repo} onChange={e=>setCfg({...cfg,repo:e.target.value})}/>
        </div>
        <div className="fld"><label>Workflow ফাইলের নাম</label>
          <input className="inp" value={cfg.workflowQuestions} onChange={e=>setCfg({...cfg,workflowQuestions:e.target.value})}/>
        </div>
        <div className="fld"><label>GitHub Personal Access Token</label>
          {editingToken ? (
            <input className="inp" type="password" placeholder="ghp_xxxxxxxxxxxx" value={cfg.token} onChange={e=>setCfg({...cfg,token:e.target.value})}/>
          ) : (
            <div style={{display:"flex",alignItems:"center",gap:8,background:C.panel,border:`1px solid ${C.border}`,borderRadius:9,padding:"10px 12px"}}>
              <span style={{color:C.green,fontSize:13}}>●●●●●●●●●●●● সেভ করা আছে (AI Job ট্যাবের সাথে শেয়ার্ড)</span>
              <button className="btn" style={{marginLeft:"auto",background:"transparent",color:C.accent,border:`1px solid ${C.border}`}} onClick={()=>setEditingToken(true)}>✏️ পরিবর্তন</button>
            </div>
          )}
        </div>
        <button className="btn" style={{width:"100%",justifyContent:"center",background:C.accent,color:"#fff",padding:11,fontSize:13,marginTop:2}} onClick={saveCfg}>💾 সেটিংস সেভ করো</button>
      </div>

      <button className="btn" disabled={busy} style={{width:"100%",justifyContent:"center",background:C.purple,color:"#fff",padding:13,fontSize:14,fontWeight:700}} onClick={trigger}>
        {busy?"⏳ পাঠানো হচ্ছে...":`🧬 ${count}টা নতুন প্রশ্ন বানাও`}
      </button>

      {status && (
        <div style={{marginTop:10,padding:"11px 13px",borderRadius:10,fontSize:13,lineHeight:1.5,
          background:statusColors.bg,color:statusColors.fg,border:`1px solid ${statusColors.bd}`}}>
          {status.msg}
        </div>
      )}
    </div>
  );
}

export { QuestionGenTab };
