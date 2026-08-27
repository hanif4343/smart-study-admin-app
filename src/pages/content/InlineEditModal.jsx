/* ══════════ INLINE EDIT MODAL ══════════ */
import React, { useState } from "react";
import { C, tint } from "../../core/config.js";
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
      // NO-FIREBASE POLICY: Quiz/QBank/Study/Typing এখন শুধু Sheet-এ এডিট হয় (GAS
      // "updateField" দিয়ে) — আগে এখানে Firebase-এও সমান্তরালে fbPatch হতো (best-effort
      // mirror), সেটা ইচ্ছাকৃতভাবে সরানো হয়েছে।
      const gasSecret=loadSharedGasSecret();
      const sheetFields=questionType==="Study"
        ?{question,correct,explanation,technique}
        :questionType==="Written"
        ?{question,explanation,technique}
        :{question,opt1,opt2,opt3,opt4,correct,explanation,technique};

      if(!gasSecret||!qid){
        push("error","❌ Edit ব্যর্থ",!qid?"এই প্রশ্নের id পাওয়া যায়নি":"GAS Secret Key দাও");
        setSaving(false);
        return;
      }

      const sheetRes=await syncFieldsToSheet({sheet,id:qid,fields:sheetFields,gasSecret});
      if(sheetRes.ok){
        push("success","✅ Sheet-এ আপডেট!",`#${qid}`);
        onSaved();
      } else {
        // 🐛 ফিক্স (আসল কারণ দেখা যেত না): sheetRes.error-এ GAS-এর আসল এরর মেসেজ
        // (exception.toString()) আগে থেকেই আসতো, কিন্তু এখানে দেখানো হতো শুধু
        // sheetRes.failed (ফিল্ডের নামের লিস্ট) — GAS-সাইডে কোনো exception হলে
        // (lock timeout, বাগ, ইত্যাদি) failed-এ শুধু পাঠানো সব ফিল্ডের নাম ফিরে
        // আসতো (fallback), আসল কারণটা (error string) কখনো দেখানোই হতো না। এখন
        // error string-ও সাথে দেখানো হচ্ছে — এবার আসল কারণ বোঝা যাবে। ──
        push("error","❌ Edit ব্যর্থ",
          `ফিল্ড: ${sheetRes.failed.join(", ")||"সব"}`+(sheetRes.error?` — ${sheetRes.error}`:""));
      }
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
                style={{flex:1,padding:"7px 4px",borderRadius:8,border:`1.5px solid ${questionType===t?C.accent:C.border}`,background:questionType===t?`${tint(C.accent,"22")}`:C.panel,color:questionType===t?C.accent:C.muted,fontWeight:700,fontSize:12,cursor:"pointer"}}
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
