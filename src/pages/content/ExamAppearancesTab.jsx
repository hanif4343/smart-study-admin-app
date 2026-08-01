/* ══════════ EXAM APPEARANCES TAB ══════════
   একটা প্রশ্ন একাধিক পরীক্ষায় (ভিন্ন পদ/প্রতিষ্ঠান/সাল) এসেছে হলে — প্রশ্নের রো
   ডুপ্লিকেট না করে এখানে শুধু appearance যোগ হয় ("কাক ভুষুন্ডি" কেস)।
   ⚠️ এখন question_id ম্যানুয়ালি বসাতে হয় (Browse ট্যাব এখনো Sheet/GAS-এ migrate
   হয়নি, তাই সরাসরি "এই প্রশ্নে appearance যোগ করো" বাটন এখনো নেই — future task,
   master plan-এ নোট করা আছে)। */
import React, { useState, useEffect, useMemo, useCallback } from "react";
import { C } from "../../core/config.js";
import { loadSharedGasSecret, saveSharedGasSecret } from "../../core/utils.js";
import { fetchReferenceData, getExamAppearances, addExamAppearance } from "../../core/sheetSave.js";
import { resolveOrCreateReference } from "../../core/referenceHelpers.js";
import { TypeaheadCombo } from "../../components/shared/TypeaheadCombo.jsx";

function ExamAppearancesTab({push}){
  const[gasSecret,setGasSecret]=useState(loadSharedGasSecret);
  const setGasSecretP=v=>{ setGasSecret(v); saveSharedGasSecret(v); };
  const[refData,setRefData]=useState(null);
  const loadRefData=useCallback(()=>{
    if(!gasSecret) return;
    fetchReferenceData({gasSecret}).then(setRefData);
  },[gasSecret]);
  useEffect(()=>{ loadRefData(); },[loadRefData]);

  const[questionId,setQuestionId]=useState("");
  const[appearances,setAppearances]=useState(null);
  const[loading,setLoading]=useState(false);

  const load=async()=>{
    if(!questionId.trim()){push("warn","প্রশ্নের id লিখুন","");return;}
    setLoading(true);
    const res=await getExamAppearances({questionId:questionId.trim(),gasSecret,push});
    setAppearances(res.appearances);
    setLoading(false);
  };

  const postMap=useMemo(()=>{const m={};(refData?.posts||[]).forEach(p=>{m[p.post_id]=p.post_name;});return m;},[refData]);
  const instMap=useMemo(()=>{const m={};(refData?.institutions||[]).forEach(i=>{m[i.institution_id]=i.institution_name;});return m;},[refData]);

  const postOptions=useMemo(()=>(refData?.posts||[]).map(p=>({id:p.post_id,name:p.post_name})),[refData]);
  const instOptions=useMemo(()=>(refData?.institutions||[]).map(i=>({id:i.institution_id,name:i.institution_name})),[refData]);

  // {id,name} — id ফাঁকা মানে টাইপ-করা নাম বিদ্যমান তালিকায় নেই, সাবমিটের সময় নতুন করে যোগ হবে
  const[postSel,setPostSel]=useState({id:"",name:""});
  const[instSel,setInstSel]=useState({id:"",name:""});
  const[year,setYear]=useState("");
  const[adding,setAdding]=useState(false);

  const doAdd=async()=>{
    if(!postSel.name.trim()||!instSel.name.trim()||!year.trim()){push("warn","পদ, প্রতিষ্ঠান ও সাল — সবগুলো দিন","");return;}
    setAdding(true);
    const postRes=await resolveOrCreateReference({sel:postSel,refType:"posts",options:postOptions,gasSecret,push});
    if(!postRes.ok){ push("error","❌ পদ যোগ/খুঁজে পাওয়া যায়নি",""); setAdding(false); return; }
    const instRes=await resolveOrCreateReference({sel:instSel,refType:"institutions",options:instOptions,gasSecret,push});
    if(!instRes.ok){ push("error","❌ প্রতিষ্ঠান যোগ/খুঁজে পাওয়া যায়নি",""); setAdding(false); return; }
    const res=await addExamAppearance({questionId:questionId.trim(),postId:postRes.id,institutionId:instRes.id,year:year.trim(),gasSecret,push});
    if(res.ok){
      push("success","✅ Appearance যোগ হয়েছে!","প্রশ্নের মূল রো টাচ হয়নি");
      setPostSel({id:"",name:""});setInstSel({id:"",name:""});setYear("");
      if(postRes.created||instRes.created) loadRefData(); // নতুন পদ/প্রতিষ্ঠান তৈরি হলে তালিকা রিফ্রেশ
      load();
    }
    setAdding(false);
  };

  return(
    <>
      <div className="fld" style={{marginBottom:10}}>
        <label style={{display:"flex",justifyContent:"space-between"}}>
          <span>GAS Secret Key</span>
        </label>
        <input className="inp" type="password" placeholder="Script Properties-এর SECRET_KEY" value={gasSecret} onChange={e=>setGasSecretP(e.target.value)}/>
      </div>

      <div style={{background:`${C.accent}12`,border:`1px solid ${C.accent}30`,borderRadius:10,padding:"9px 12px",marginBottom:12,fontSize:11,color:C.muted,lineHeight:1.6}}>
        একই প্রশ্ন একাধিক পরীক্ষায় (ভিন্ন পদ/প্রতিষ্ঠান/সাল) এলে — নতুন করে প্রশ্ন না বসিয়ে এখানে শুধু appearance যোগ করো। প্রশ্নের মূল রো কখনো টাচ হয় না।
      </div>

      <div className="fld" style={{marginBottom:10}}>
        <label>প্রশ্নের ID</label>
        <div style={{display:"flex",gap:6}}>
          <input className="inp" style={{flex:1}} placeholder="যেমন: QB-00123" value={questionId} onChange={e=>setQuestionId(e.target.value)}/>
          <button className="btn bp" onClick={load} disabled={loading}>{loading?"⏳":"🔍 দেখাও"}</button>
        </div>
      </div>

      {appearances!==null && (
        <>
          <div style={{fontSize:11,color:C.muted,marginBottom:8,fontWeight:700}}>বিদ্যমান Appearance ({appearances.length}টি)</div>
          {appearances.length===0?
            <div className="empty" style={{padding:"14px 0"}}><p>এই প্রশ্নের কোনো appearance এখনো যোগ করা হয়নি</p></div>:
            appearances.map(a=>(
              <div key={a.appearance_id} className="rename-row">
                <div className="rename-name">
                  {postMap[a.post_id]||a.post_id} → {instMap[a.institution_id]||a.institution_id}
                  <div style={{fontSize:9,color:C.muted}}>{a.year}</div>
                </div>
              </div>
            ))
          }

          <div style={{fontSize:11,color:C.muted,margin:"16px 0 8px",fontWeight:700}}>➕ নতুন Appearance যোগ করো</div>
          <div className="fld" style={{marginBottom:8}}>
            <label>পদ (Post)</label>
            <TypeaheadCombo
              options={postOptions}
              value={postSel}
              onChange={setPostSel}
              placeholder="টাইপ করো... যেমন: সহকারী শিক্ষক"
              newLabel={`🆕 "${postSel.name.trim()}" নতুন পদ হিসেবে যোগ হবে`}
            />
          </div>
          <div className="fld" style={{marginBottom:8}}>
            <label>প্রতিষ্ঠান (Institution)</label>
            <TypeaheadCombo
              options={instOptions}
              value={instSel}
              onChange={setInstSel}
              placeholder="টাইপ করো... যেমন: প্রাথমিক বিদ্যালয়"
              newLabel={`🆕 "${instSel.name.trim()}" নতুন প্রতিষ্ঠান হিসেবে যোগ হবে`}
            />
          </div>
          <div className="fld" style={{marginBottom:10}}>
            <label>সাল</label>
            <input className="inp" placeholder="যেমন: 2025" value={year} onChange={e=>setYear(e.target.value)}/>
          </div>
          <div style={{fontSize:10,color:C.muted,marginBottom:8}}>
            পদ/প্রতিষ্ঠান টাইপ করলে মিল থাকলে বিদ্যমানটাই বাছাই হবে, না থাকলে "যোগ করো"-তে চাপলে নতুন করেই যোগ হয়ে যাবে — আলাদা করে Reference ট্যাবে গিয়ে যোগ করার দরকার নেই।
          </div>
          <button className="btn bp" style={{width:"100%",justifyContent:"center"}} onClick={doAdd} disabled={adding}>{adding?"⏳ যোগ হচ্ছে...":"➕ যোগ করো"}</button>
        </>
      )}
    </>
  );
}

export { ExamAppearancesTab };
