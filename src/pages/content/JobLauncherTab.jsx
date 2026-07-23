/* ══════════════════════════════════════════════════════════════════
   AI JOB LAUNCHER — Audience/Subject/Sub-topic ফিল্টার করে GitHub
   Action (generate-explanations.yml) রিমোটলি ট্রিগার করে।
   ══════════════════════════════════════════════════════════════════ */
import React, { useState, useEffect, useCallback, useMemo } from "react";
import { C, GAS } from "../../core/config.js";
import { useFB, useSheetRows } from "../../core/dataCache.js";
import { toArr, loadSharedGasSecret } from "../../core/utils.js";
import { JOB_NONE_TAG, loadGhCfg, saveGhCfgLS } from "../../core/ghConfig.js";
import { JobCheckList } from "../../components/shared/JobCheckList.jsx";

function JobLauncherTab({push,tick}){
  // ⚠️ useFB (Firebase) না — useSheetRows দিয়ে সরাসরি Google Sheet থেকে পড়া হয়,
  // কারণ explanation-fill automation এখন Sheet-এ লেখে (Firebase-এ sync পরে, ব্যাচে হয়)।
  // Firebase থেকে পড়লে এখানে ভুল/পুরনো সংখ্যা দেখাতে পারে (যেমন Sheet-এ নতুন
  // ব্যাখ্যা-ফাঁকা প্রশ্ন থাকলেও Firebase-এ sync না হওয়া পর্যন্ত "0" দেখাবে)।
  const{data:quiz}=useSheetRows("Quiz",tick);
  const{data:qbank}=useSheetRows("QBank",tick);
  const{data:study}=useSheetRows("Study",tick);

  const allRows=useMemo(()=>{
    const rows=[];
    [["Quiz",quiz],["QBank",qbank],["Study",study]].forEach(([sheet,raw])=>{
      toArr(raw).forEach(row=>{
        const q=(row.Question||row.question||"").toString().trim();
        if(!q)return;
        const exp=(row.Explanation||row.explanation||"").toString().trim();
        const subject=(row.Subject||row.subject||"").toString().trim();
        const subtopic=(row.Sub_topic||row.sub_topic||"").toString().trim();
        const audRaw=(row.AudienceTags||row.audienceTags||row.audience_tags||"").toString().trim();
        const audienceList=audRaw.split(",").map(a=>a.trim()).filter(Boolean);
        rows.push({sheet,subject,subtopic,audienceList,hasExp:!!exp});
      });
    });
    return rows;
  },[quiz,qbank,study]);

  const missing=useMemo(()=>allRows.filter(r=>!r.hasExp),[allRows]);

  const[selAud,setSelAud]=useState([]);
  const[selSubj,setSelSubj]=useState([]);
  const[selSubt,setSelSubt]=useState([]);

  const matchAud=useCallback((r,aud)=> !aud.length || aud.some(a=>a===JOB_NONE_TAG? r.audienceList.length===0 : r.audienceList.includes(a)),[]);

  const audienceOptions=useMemo(()=>{
    const counts={};
    missing.forEach(r=>{
      if(!r.audienceList.length){ counts[JOB_NONE_TAG]=(counts[JOB_NONE_TAG]||0)+1; return; }
      r.audienceList.forEach(a=>{counts[a]=(counts[a]||0)+1;});
    });
    const entries=Object.keys(counts).filter(k=>k!==JOB_NONE_TAG).sort().map(a=>({value:a,label:a,count:counts[a]}));
    if(counts[JOB_NONE_TAG]) entries.push({value:JOB_NONE_TAG,label:"— কোনো Audience Tag নেই (ফাঁকা) —",count:counts[JOB_NONE_TAG]});
    return entries;
  },[missing]);

  const rowsByAud=useMemo(()=>missing.filter(r=>matchAud(r,selAud)),[missing,selAud,matchAud]);

  const subjectOptions=useMemo(()=>{
    const counts={};
    rowsByAud.forEach(r=>{ const s=r.subject||"(ফাঁকা)"; counts[s]=(counts[s]||0)+1; });
    return Object.keys(counts).sort().map(s=>({value:s,label:s,count:counts[s]}));
  },[rowsByAud]);

  const rowsByAudSubj=useMemo(()=>rowsByAud.filter(r=> !selSubj.length || selSubj.includes(r.subject||"(ফাঁকা)")),[rowsByAud,selSubj]);

  const subtopicOptions=useMemo(()=>{
    const counts={};
    rowsByAudSubj.forEach(r=>{ const st=r.subtopic||"(ফাঁকা)"; counts[st]=(counts[st]||0)+1; });
    return Object.keys(counts).sort().map(s=>({value:s,label:s,count:counts[s]}));
  },[rowsByAudSubj]);

  const finalRows=useMemo(()=>rowsByAudSubj.filter(r=> !selSubt.length || selSubt.includes(r.subtopic||"(ফাঁকা)")),[rowsByAudSubj,selSubt]);

  const audKey=selAud.join(",");
  const subjKey=selSubj.join(",");
  useEffect(()=>{ setSelSubj([]); setSelSubt([]); },[audKey]);
  useEffect(()=>{ setSelSubt([]); },[subjKey]);

  const[cfg,setCfg]=useState(loadGhCfg);
  const[editingToken,setEditingToken]=useState(()=>!loadGhCfg().token);
  const[status,setStatus]=useState(null);
  const[busy,setBusy]=useState(false);
  // ── এক-বারের "Firebase Re-key" অ্যাকশনের জন্য আলাদা state — GAS-কে সরাসরি কল করে,
  // GitHub Action লাগে না ──
  const gasSecret=loadSharedGasSecret();
  const[rekeyBusy,setRekeyBusy]=useState(false);
  const[rekeyStatus,setRekeyStatus]=useState(null);
  const runRekey=async()=>{
    if(!GAS){ setRekeyStatus({type:"err",msg:"❌ GAS URL সেট করা নেই (VITE_GAS_URL)"}); return; }
    if(!gasSecret){ setRekeyStatus({type:"err",msg:"❌ GAS Secret Key দাও (Save Location প্যানেলে বসাও)"}); return; }
    if(!window.confirm("⚠️ এটা Firebase-এর Quiz/QBank/Study ডেটা 'id' দিয়ে নতুন করে re-key করবে (এক-বারের কাজ)। GAS-এ updatedAt-ভিত্তিক incremental sync ডিপ্লয় করার পর, প্রথম এডিটের আগে ঠিক একবারই এটা চালানো উচিত। বারবার চালানোর দরকার নেই। এগোতে চাও?"))return;
    setRekeyBusy(true); setRekeyStatus(null);
    try{
      const resp=await fetch(GAS,{method:"POST",headers:{"Content-Type":"text/plain"},
        body:JSON.stringify({secret:gasSecret,type:"force_full_rekey_sync",sheets:"Quiz,QBank,Study"})});
      const data=await resp.json().catch(()=>({}));
      if(data.result==="success"){
        const lines=(data.details||[]).map(d=>`${d.sheet}: ${d.result&&d.result.ok?"✅ "+d.result.msg:"❌ "+((d.result&&d.result.msg)||"ব্যর্থ")}`).join("\n");
        setRekeyStatus({type:"ok",msg:`✅ সম্পন্ন —\n${lines}`});
      } else {
        setRekeyStatus({type:"err",msg:"❌ ব্যর্থ: "+(data.error||data.message||"অজানা সমস্যা")});
      }
    }catch(e){
      setRekeyStatus({type:"err",msg:"❌ "+e.message});
    }
    setRekeyBusy(false);
  };
  // ── ছোট, targeted বিকল্প — শুধু "Not Firebase"/"NF" কলামে মার্ক করা row গুলোই sync করে ──
  const[nfBusy,setNfBusy]=useState(false);
  const[nfStatus,setNfStatus]=useState(null);
  const runNfSync=async()=>{
    if(!GAS){ setNfStatus({type:"err",msg:"❌ GAS URL সেট করা নেই (VITE_GAS_URL)"}); return; }
    if(!gasSecret){ setNfStatus({type:"err",msg:"❌ GAS Secret Key দাও (Save Location প্যানেলে বসাও)"}); return; }
    setNfBusy(true); setNfStatus(null);
    try{
      const resp=await fetch(GAS,{method:"POST",headers:{"Content-Type":"text/plain"},
        body:JSON.stringify({secret:gasSecret,type:"sync_nf_rows",sheets:"Quiz,QBank,Study"})});
      const data=await resp.json().catch(()=>({}));
      if(data.result==="success"){
        const lines=(data.details||[]).map(d=>`${d.sheet}: ${d.result&&d.result.ok?"✅ "+d.result.msg:"❌ "+((d.result&&d.result.msg)||"ব্যর্থ")}`).join("\n");
        setNfStatus({type:"ok",msg:`✅ সম্পন্ন —\n${lines}`});
      } else {
        setNfStatus({type:"err",msg:"❌ ব্যর্থ: "+(data.error||data.message||"অজানা সমস্যা")});
      }
    }catch(e){
      setNfStatus({type:"err",msg:"❌ "+e.message});
    }
    setNfBusy(false);
  };

  const toggle=(arr,setArr,val)=>{ setArr(arr.includes(val)? arr.filter(x=>x!==val) : [...arr,val]); };

  const saveCfg=()=>{
    saveGhCfgLS(cfg);
    setEditingToken(false);
    setStatus({type:"ok",msg:"✅ GitHub সেটিংস এই ডিভাইসে সেভ হয়ে গেছে।"});
  };

  const trigger=async()=>{
    if(!cfg.token){ setStatus({type:"err",msg:"❌ প্রথমে GitHub Token বসিয়ে সেভ করো।"}); return; }
    if(!cfg.repo||!cfg.repo.includes("/")){ setStatus({type:"err",msg:"❌ Repo ফরম্যাট: owner/name"}); return; }
    setBusy(true);
    setStatus({type:"info",msg:"পাঠানো হচ্ছে..."});
    try{
      const resp=await fetch(`https://api.github.com/repos/${cfg.repo}/actions/workflows/${cfg.workflowExplain}/dispatches`,{
        method:"POST",
        headers:{"Accept":"application/vnd.github+json","Authorization":"Bearer "+cfg.token,"Content-Type":"application/json"},
        body:JSON.stringify({ref:"main",inputs:{
          filter_audience:selAud.join(","),
          filter_subject:selSubj.join(","),
          filter_subtopic:selSubt.join(",")
        }})
      });
      if(resp.status===204){ setStatus({type:"ok",msg:"✅ চালু হয়ে গেছে! GitHub-এর Actions ট্যাবে গিয়ে দেখো।"}); }
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
      <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:14,padding:14,marginBottom:12}}>
        <div style={{fontSize:11,textTransform:"uppercase",letterSpacing:.6,color:C.muted,fontWeight:700,marginBottom:10}}>🎯 ফিল্টার বেছে নাও (একাধিক বাছাই করা যায়)</div>

        <div className="fld"><label>Audience Tag</label>
          <JobCheckList options={audienceOptions} selected={selAud} onToggle={v=>toggle(selAud,setSelAud,v)} emptyText={missing.length?"লোড হচ্ছে বা কোনো ট্যাগ নেই":"🎉 সব প্রশ্নেই ব্যাখ্যা আছে, কোনো কাজ বাকি নেই!"}/>
        </div>

        <div className="fld"><label>Subject</label>
          <JobCheckList options={subjectOptions} selected={selSubj} onToggle={v=>toggle(selSubj,setSelSubj,v)} emptyText="এই ফিল্টারে কিছু নেই"/>
        </div>

        <div className="fld"><label>Sub-topic</label>
          <JobCheckList options={subtopicOptions} selected={selSubt} onToggle={v=>toggle(selSubt,setSelSubt,v)} emptyText="এই ফিল্টারে কিছু নেই"/>
        </div>

        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",background:C.panel,border:`1px solid ${C.border}`,borderRadius:10,padding:"12px 14px",marginTop:8}}>
          <span style={{fontSize:12,color:C.muted}}>এই ফিল্টারে ব্যাখ্যা-নেই প্রশ্ন</span>
          <span style={{fontSize:22,fontWeight:800,color:C.yellow}}>{finalRows.length}</span>
        </div>
      </div>

      <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:14,padding:14,marginBottom:12}}>
        <div style={{fontSize:11,textTransform:"uppercase",letterSpacing:.6,color:C.muted,fontWeight:700,marginBottom:10}}>⚙️ GitHub Action সেটিংস</div>

        <div className="fld"><label>Repo (owner/name)</label>
          <input className="inp" value={cfg.repo} onChange={e=>setCfg({...cfg,repo:e.target.value})}/>
        </div>
        <div className="fld"><label>Workflow ফাইলের নাম</label>
          <input className="inp" value={cfg.workflowExplain} onChange={e=>setCfg({...cfg,workflowExplain:e.target.value})}/>
        </div>
        <div className="fld"><label>GitHub Personal Access Token</label>
          {editingToken ? (
            <input className="inp" type="password" placeholder="ghp_xxxxxxxxxxxx" value={cfg.token} onChange={e=>setCfg({...cfg,token:e.target.value})}/>
          ) : (
            <div style={{display:"flex",alignItems:"center",gap:8,background:C.panel,border:`1px solid ${C.border}`,borderRadius:9,padding:"10px 12px"}}>
              <span style={{color:C.green,fontSize:13}}>●●●●●●●●●●●● সেভ করা আছে</span>
              <button className="btn" style={{marginLeft:"auto",background:"transparent",color:C.accent,border:`1px solid ${C.border}`}} onClick={()=>setEditingToken(true)}>✏️ পরিবর্তন</button>
            </div>
          )}
        </div>
        <button className="btn" style={{width:"100%",justifyContent:"center",background:C.accent,color:"#fff",padding:11,fontSize:13,marginTop:2}} onClick={saveCfg}>💾 সেটিংস সেভ করো</button>
      </div>

      <button className="btn" disabled={busy} style={{width:"100%",justifyContent:"center",background:C.green,color:"#04180a",padding:13,fontSize:14,fontWeight:700}} onClick={trigger}>
        {busy?"⏳ পাঠানো হচ্ছে...":"🚀 এই ফিল্টারে Action চালু করো"}
      </button>

      {status && (
        <div style={{marginTop:10,padding:"11px 13px",borderRadius:10,fontSize:13,lineHeight:1.5,
          background:statusColors.bg,color:statusColors.fg,border:`1px solid ${statusColors.bd}`}}>
          {status.msg}
        </div>
      )}

      <div style={{fontSize:11,color:C.muted,marginTop:14,lineHeight:1.6}}>
        টোকেন এই ডিভাইসেই (localStorage) সেভ থাকে, অন্য কোথাও পাঠানো হয় না। একবারই বানাতে হবে: GitHub → প্রোফাইল ছবি → Settings → Developer settings → Personal access tokens → Tokens (classic) → Generate new token (classic) → শুধু <b>repo</b> স্কোপ টিক দাও → Generate → টোকেন কপি করে উপরে পেস্ট করো।
      </div>

      {/* ── ⚠️ Danger zone — এক-বারের, ইচ্ছাকৃত Firebase re-key অ্যাকশন ── */}
      <div style={{background:"#2a1608",border:`1px solid #6b3d12`,borderRadius:14,padding:14,marginTop:18}}>
        <div style={{fontSize:11,textTransform:"uppercase",letterSpacing:.6,color:"#f0a850",fontWeight:700,marginBottom:6}}>⚠️ Danger Zone — Firebase Re-key (এক-বারের কাজ)</div>
        <div style={{fontSize:12,color:C.muted,lineHeight:1.6,marginBottom:10}}>
          নতুন <code>updatedAt</code>-ভিত্তিক incremental sync GAS-এ ডিপ্লয় করার পর, প্রথম এডিটের আগে এটা <b>ঠিক একবার</b> চালাও — Firebase-এর Quiz/QBank/Study ডেটা "id" দিয়ে re-key করবে (পুরনো নতুন সব প্রশ্ন+ব্যাখ্যা এক ধাক্কায় ঠিকভাবে বসে যাবে)। এটা একটা <b>write</b> (upload), Downloads quota ছোঁয় না। বারবার চালানোর দরকার নেই।
        </div>
        <button className="btn" disabled={rekeyBusy} style={{width:"100%",justifyContent:"center",background:"#c2650f",color:"#fff",padding:11,fontSize:13,fontWeight:700}} onClick={runRekey}>
          {rekeyBusy?"⏳ Re-key হচ্ছে...":"🔄 Re-key Firebase (একবার)"}
        </button>
        {rekeyStatus && (
          <div style={{marginTop:10,padding:"11px 13px",borderRadius:10,fontSize:12,lineHeight:1.6,whiteSpace:"pre-wrap",
            background:rekeyStatus.type==="ok"?"#0d2818":"#2a0d10",
            color:rekeyStatus.type==="ok"?C.green:"#ff8a80",
            border:`1px solid ${rekeyStatus.type==="ok"?"#1a4d2e":"#5c1a1a"}`}}>
            {rekeyStatus.msg}
          </div>
        )}
      </div>

      {/* ── ✅ ছোট, targeted বিকল্প — শুধু "Not Firebase"/"NF" মার্ক করা row sync ── */}
      <div style={{background:"#0d2818",border:`1px solid #1a4d2e`,borderRadius:14,padding:14,marginTop:12}}>
        <div style={{fontSize:11,textTransform:"uppercase",letterSpacing:.6,color:C.green,fontWeight:700,marginBottom:6}}>✅ শুধু নতুন (NF-marked) প্রশ্ন Sync করো</div>
        <div style={{fontSize:12,color:C.muted,lineHeight:1.6,marginBottom:10}}>
          Sheet-এ "Not Firebase"/"NF" কলামে যেসব row ম্যানুয়ালি মার্ক করা আছে (মানে এগুলো এখনো Firebase-এ নেই), শুধু সেগুলোই পাঠাবে — বাকি সব সেট (আগে থেকে Firebase-এ থাকা প্রশ্ন) ছোঁবে না। সফল হলে সেই row-এর NF মার্ক মুছে দেবে। এটা <b>Re-key</b>-এর চেয়ে ছোট, দ্রুত — যখন শুধু নির্দিষ্ট কিছু নতুন প্রশ্নই পাঠাতে হবে তখন এটাই ব্যবহার করো।
        </div>
        <button className="btn" disabled={nfBusy} style={{width:"100%",justifyContent:"center",background:C.green,color:"#04180a",padding:11,fontSize:13,fontWeight:700}} onClick={runNfSync}>
          {nfBusy?"⏳ Sync হচ্ছে...":"✅ NF-marked প্রশ্ন Sync করো"}
        </button>
        {nfStatus && (
          <div style={{marginTop:10,padding:"11px 13px",borderRadius:10,fontSize:12,lineHeight:1.6,whiteSpace:"pre-wrap",
            background:nfStatus.type==="ok"?"#0d2818":"#2a0d10",
            color:nfStatus.type==="ok"?C.green:"#ff8a80",
            border:`1px solid ${nfStatus.type==="ok"?"#1a4d2e":"#5c1a1a"}`}}>
            {nfStatus.msg}
          </div>
        )}
      </div>
    </div>
  );
}

export { JobLauncherTab };
