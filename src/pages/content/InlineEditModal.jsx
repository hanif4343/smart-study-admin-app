/* ══════════ INLINE EDIT MODAL ══════════ */
import React, { useState } from "react";
import { C } from "../../core/config.js";
import { fbPatch } from "../../core/firebase.js";
import { syncFieldsToSheet } from "../../core/sheetSave.js";
import { loadSharedGasSecret } from "../../core/utils.js";
import { useModalBack } from "../../hooks/useModalBack.js";

function InlineEditModal({q,sheet,onClose,onSaved,push}){
  useModalBack(onClose);
  const[saving,setSaving]=useState(false);
  const rawQt=(q["Question Type"]||q.QType||q.qtype||"MCQ");
  const initQt=rawQt==="Study"?"Study":rawQt.toLowerCase()==="written"?"Written":"MCQ";
  const[questionType,setQuestionType]=useState(initQt);
  const qt=questionType==="Study"?"study":questionType==="Written"?"written":"mcq";
  const[question,setQuestion]=useState(q.Question||q.question||"");
  // Firebase এ option field নানা নামে থাকতে পারে — সব check করো
  const _o=(k1,k2,k3,k4)=>q[k1]||q[k2]||q[k3]||q[k4]||"";
  const[opt1,setOpt1]=useState(_o("Opt1","opt1","Option1","option1"));
  const[opt2,setOpt2]=useState(_o("Opt2","opt2","Option2","option2"));
  const[opt3,setOpt3]=useState(_o("Opt3","opt3","Option3","option3"));
  const[opt4,setOpt4]=useState(_o("Opt4","opt4","Option4","option4"));
  const[correct,setCorrect]=useState(q.Correct||q.correct||"");
  const[explanation,setExplanation]=useState(q.Explanation||q.explanation||"");
  const[technique,setTechnique]=useState(q.Technique||q.technique||"");
  const qid=(q.ID||q.id||"").toString();
  const ac=qt==="written"?C.purple:sheet==="Study"?C.green:C.accent;

  const save=async()=>{
    setSaving(true);
    try{
      const fkey=q._fbKey;
      let patch={};
      if(questionType==="Study"){
        patch={Question:question,Correct:correct,Explanation:explanation,Technique:technique,"Question Type":"Study"};
      } else if(questionType==="Written"){
        patch={Question:question,Explanation:explanation,Technique:technique,"Question Type":"Written"};
      } else {
        // Firebase এ যে key name আছে সেটাই use করো
        const o1k=q.Opt1!=null?"Opt1":q.opt1!=null?"opt1":q.Option1!=null?"Option1":q.option1!=null?"option1":"Option1";
        const o2k=o1k.replace("1","2"),o3k=o1k.replace("1","3"),o4k=o1k.replace("1","4");
        patch={Question:question,[o1k]:opt1,[o2k]:opt2,[o3k]:opt3,[o4k]:opt4,Correct:correct,Explanation:explanation,Technique:technique,"Question Type":"MCQ"};
      }
      if(fkey)await fbPatch(`${sheet}/${fkey}`,patch);
      // ⚡ Firebase আগেই সেভ হয়ে গেছে (উপরে) — Sheet sync এখন ব্যাকগ্রাউন্ডে (await না করে) পাঠানো
      // হচ্ছে, GAS-এর existing "updateField" action দিয়ে (প্রতিটা field আলাদা কল, parallel-এ)।
      // এটা best-effort: GAS Secret না থাকলে চুপচাপ স্কিপ হবে, আর কোনো field ব্যর্থ হলেও শুধু
      // একটা soft warning toast দেখাবে — Edit ততক্ষণে Firebase-এ সফল হয়ে গেছে, সেটা বাতিল হবে না।
      const gasSecret=loadSharedGasSecret();
      if(gasSecret&&qid){
        const sheetFields=questionType==="Study"
          ?{question,correct,explanation,technique}
          :questionType==="Written"
          ?{question,explanation,technique}
          :{question,opt1,opt2,opt3,opt4,correct,explanation,technique};
        syncFieldsToSheet({sheet,id:qid,fields:sheetFields,gasSecret})
          .then(res=>{ if(!res.ok)push("error","⚠️ Sheet-এ sync আংশিক ব্যর্থ",`ফিল্ড: ${res.failed.join(", ")} — Firebase-এ ঠিকই সেভ হয়েছে`); })
          .catch(()=>{});
      }
      push("success","✅ আপডেট!",`#${qid}`);
      onSaved();
    }catch(e){push("error","Edit ব্যর্থ",String(e?.message||e||"unknown"));}
    setSaving(false);
  };

  return(
    <div className="ovl">
      <div className="modal">
        <div className="mh"/>
        <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:12}}>
          <span style={{background:`${ac}22`,color:ac,border:`1px solid ${ac}44`,borderRadius:6,padding:"3px 9px",fontSize:11,fontWeight:700}}>
            {sheet==="Study"?"📖 Study":qt==="written"?"✍️ Written":"❓ MCQ"}
          </span>
          <span style={{fontSize:10,color:C.muted}}>#{qid} · {sheet}</span>
          <div style={{marginLeft:"auto",display:"flex",gap:6}}>
            <button className="btn bg" style={{padding:"5px 12px",fontSize:11}} onClick={onClose} disabled={saving}>বাতিল</button>
            <button className="btn bp" style={{padding:"5px 14px",fontSize:11,fontWeight:700}} onClick={save} disabled={saving}>
              {saving?"⏳":"💾"} সেভ
            </button>
          </div>
        </div>
        <div className="fld" style={{marginBottom:10}}>
          <label style={{marginBottom:6,display:"block"}}>🏷️ Question Type</label>
          <div style={{display:"flex",gap:6}}>
            {["MCQ","Written","Study"].map(t=>(
              <button key={t} type="button"
                style={{flex:1,padding:"7px 4px",borderRadius:8,border:`1.5px solid ${questionType===t?C.accent:C.border}`,background:questionType===t?`${C.accent}22`:C.panel,color:questionType===t?C.accent:C.muted,fontWeight:700,fontSize:12,cursor:"pointer"}}
                onClick={()=>setQuestionType(t)}>{t==="MCQ"?"❓ MCQ":t==="Written"?"✍️ Written":"📖 Study"}</button>
            ))}
          </div>
        </div>
        <div className="fld"><label>প্রশ্ন</label><textarea className="ta" value={question} onChange={e=>setQuestion(e.target.value)} style={{minHeight:70}}/></div>
        {questionType!=="Study"&&qt!=="written"&&<>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:7,marginBottom:10}}>
            {[[opt1,setOpt1,"A"],[opt2,setOpt2,"B"],[opt3,setOpt3,"C"],[opt4,setOpt4,"D"]].map(([v,sv,lbl])=>(
              <div key={lbl} className="fld" style={{margin:0}}><label>{lbl}</label><input className="inp" value={v} onChange={e=>sv(e.target.value)}/></div>
            ))}
          </div>
          <div className="fld">
            <label>✅ সঠিক উত্তর</label>
            <div style={{display:"flex",gap:4,flexWrap:"wrap",marginBottom:5}}>
              {[opt1,opt2,opt3,opt4].filter(Boolean).map((o,i)=>(
                <button key={i} type="button" className={`cc${correct===o?" on":""}`} onClick={()=>setCorrect(o)}>{o.slice(0,14)}</button>
              ))}
            </div>
            <input className="inp" value={correct} onChange={e=>setCorrect(e.target.value)}/>
          </div>
        </>}
        {questionType==="Study"&&<div className="fld"><label>✅ উত্তর</label><textarea className="ta" value={correct} onChange={e=>setCorrect(e.target.value)} style={{minHeight:60}}/></div>}
        <div className="fld"><label>📖 Explanation</label><textarea className="ta" value={explanation} onChange={e=>setExplanation(e.target.value)} style={{minHeight:60}}/></div>
        <div className="fld"><label>💡 Technique</label><textarea className="ta" value={technique} onChange={e=>setTechnique(e.target.value)} style={{minHeight:45}}/></div>
        <div style={{display:"flex",gap:7,marginTop:12}}>
          <button className="btn bg" style={{flex:1,justifyContent:"center"}} onClick={onClose}>বাতিল</button>
          <button className="btn bp" style={{flex:2,justifyContent:"center"}} disabled={saving} onClick={save}>
            {saving?"⏳ সেভ হচ্ছে...":"💾 সেভ করুন"}
          </button>
        </div>
      </div>
    </div>
  );
}

export { InlineEditModal };
