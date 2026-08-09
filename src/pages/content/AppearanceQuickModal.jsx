/* ══════════ APPEARANCE QUICK MODAL ══════════
   Browse ট্যাবের QBank প্রশ্ন কার্ডে 🧾 বাটনে চাপলে খোলে — ExamAppearancesTab-এর
   মতোই কাজ করে, কিন্তু প্রশ্নের ID ম্যানুয়ালি টাইপ করতে হয় না (কার্ড থেকেই
   questionId পাস হয়ে আসে)। বিদ্যমান appearance দেখায় + নতুন যোগ করার ফর্ম দেখায়,
   পদ/প্রতিষ্ঠান টাইপ-করে-মেলানো-বা-নতুন-তৈরি (resolveOrCreateReference) সহ। */
import React, { useState, useEffect, useMemo } from "react";
import { C } from "../../core/config.js";
import { getExamAppearances, addExamAppearance } from "../../core/sheetSave.js";
import { resolveOrCreateReference } from "../../core/referenceHelpers.js";
import { TypeaheadCombo } from "../../components/shared/TypeaheadCombo.jsx";
import { useModalBack } from "../../hooks/useModalBack.js";

function AppearanceQuickModal({question,questionText,refData,gasSecret,onRefreshRef,onClose,push}){
  useModalBack(onClose);
  const questionId=(question.ID||question.id||"").toString();

  const[appearances,setAppearances]=useState(null);
  const[loading,setLoading]=useState(true);
  const load=async()=>{
    setLoading(true);
    const res=await getExamAppearances({questionId,gasSecret,push});
    setAppearances(res.appearances||[]);
    setLoading(false);
  };
  useEffect(()=>{ load(); /* eslint-disable-next-line */ },[questionId]);

  const postMap=useMemo(()=>{const m={};(refData?.posts||[]).forEach(p=>{m[p.post_id]=p.post_name;});return m;},[refData]);
  const instMap=useMemo(()=>{const m={};(refData?.institutions||[]).forEach(i=>{m[i.institution_id]=i.institution_name;});return m;},[refData]);
  const postOptions=useMemo(()=>(refData?.posts||[]).map(p=>({id:p.post_id,name:p.post_name})),[refData]);
  const instOptions=useMemo(()=>(refData?.institutions||[]).map(i=>({id:i.institution_id,name:i.institution_name})),[refData]);

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
    const res=await addExamAppearance({questionId,postId:postRes.id,institutionId:instRes.id,year:year.trim(),gasSecret,push});
    if(res.ok){
      push("success","✅ Appearance যোগ হয়েছে!","প্রশ্নের মূল রো টাচ হয়নি");
      setPostSel({id:"",name:""});setInstSel({id:"",name:""});setYear("");
      if((postRes.created||instRes.created)&&onRefreshRef) onRefreshRef(); // নতুন পদ/প্রতিষ্ঠান হলে Browse-এর ফিল্টার তালিকাও রিফ্রেশ হোক
      load();
    }
    setAdding(false);
  };

  return(
    <div className="ovl">
      <div className="modal">
        <div className="mh"/>
        <div style={{fontSize:13,fontWeight:700,marginBottom:4}}>🧾 Exam Appearance</div>
        <div style={{fontSize:11,color:C.muted,marginBottom:12,lineHeight:1.5}}>
          #{questionId} — {(questionText||"").slice(0,70)}{(questionText||"").length>70?"…":""}
        </div>

        {loading?(
          <div style={{fontSize:12,color:C.muted,textAlign:"center",padding:"12px 0"}}>⏳ লোড হচ্ছে...</div>
        ):(
          <>
            <div style={{fontSize:11,color:C.muted,marginBottom:8,fontWeight:700}}>বিদ্যমান Appearance ({appearances.length}টি)</div>
            {appearances.length===0?
              <div className="empty" style={{padding:"10px 0"}}><p style={{fontSize:12}}>এই প্রশ্নের কোনো appearance এখনো যোগ করা হয়নি</p></div>:
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
            <div className="fld" style={{marginBottom:12}}>
              <label>সাল</label>
              <input className="inp" placeholder="যেমন: 2025" value={year} onChange={e=>setYear(e.target.value)}/>
            </div>
            <div style={{display:"flex",gap:7}}>
              <button className="btn bg" style={{flex:1,justifyContent:"center"}} onClick={onClose}>বন্ধ করো</button>
              <button className="btn bp" style={{flex:2,justifyContent:"center"}} onClick={doAdd} disabled={adding}>{adding?"⏳ যোগ হচ্ছে...":"➕ যোগ করো"}</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export { AppearanceQuickModal };
