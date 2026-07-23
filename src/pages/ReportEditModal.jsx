/* ══════════ REPORT EDIT MODAL ══════════ */
import React, { useState, useEffect } from "react";
import { C } from "../core/config.js";
import { loadPath, invalidate } from "../core/dataCache.js";
import { fbGet, fbSet, fbPatch, fbDelete } from "../core/firebase.js";
import { fcmNotifyPhone } from "../core/fcm.js";
import { toArr, phoneKey, nowTs } from "../core/utils.js";
import { useModalBack } from "../hooks/useModalBack.js";

function ReportEditModal({report,onClose,onDone,push}){
  useModalBack(onClose);
  const[step,setStep]=useState(1);
  const[qdata,setQdata]=useState(null);
  const[loadQ,setLoadQ]=useState(true);
  const[saving,setSaving]=useState(false);
  const[notifying,setNotifying]=useState(false);
  const[question,setQuestion]=useState("");
  const[opt1,setOpt1]=useState(""); const[opt2,setOpt2]=useState("");
  const[opt3,setOpt3]=useState(""); const[opt4,setOpt4]=useState("");
  const[correct,setCorrect]=useState("");
  const[explanation,setExplanation]=useState("");
  const[technique,setTechnique]=useState("");
  const[qtype,setQtype]=useState("mcq");
  // Report এ কোন fields আছে সেটা normalize করো
  const qfbKey  = (report.QuestionFBKey||report.questionFBKey||report.fbKey||"").toString().trim();
  const qsheet  = (report.QSheet||report.qsheet||"").toString().trim();
  const qidRaw  = (report.QuestionID||report.questionId||"").toString().trim();
  // "0", "null", "" — এগুলো invalid ID
  const qid     = (qidRaw===""||qidRaw==="0"||qidRaw==="null"||qidRaw==="undefined") ? "" : qidRaw;
  // Report এর নিজস্ব question text — সবচেয়ে reliable fallback
  const reportQText = (report.Question||report.question||"").trim();

  useEffect(()=>{
    // কোনো identifier নেই — সরাসরি report এর text দিয়ে যাও
    if(!qid && !qfbKey && !reportQText){ setLoadQ(false); return; }

    let cancelled=false;
    (async()=>{
      setLoadQ(true);
      let found=false;

      // ── Firebase থেকে match করার চেষ্টা ──
      if(qid || qfbKey){
        const sheetsToTry=qsheet?[qsheet]:["QBank","Quiz","Study"];
        for(const t of sheetsToTry){
          if(found) break;
          try{
            const raw=await loadPath(t);
            const arr=toArr(raw);
            const qNorm=qid.replace(/^0+/,"");
            const q=arr.find(x=>{
              // Priority 1: Firebase key exact match
              if(qfbKey && x._fbKey && x._fbKey===qfbKey) return true;
              // Priority 2: Question text exact match — সবচেয়ে reliable
              if(reportQText){
                const xq=(x.Question||x.question||"").trim();
                if(xq && xq===reportQText) return true;
              }
              // Priority 3: ID field match
              if(qNorm){
                const xid=(x.ID||x.id||"").toString().replace(/^0+/,"");
                if(xid && xid===qNorm) return true;
              }
              return false;
            });
            if(q&&!cancelled){
              found=true;
              setQdata({...q,_tab:t});
              setQuestion(q.Question||q.question||"");
              setOpt1(q.Opt1||q.opt1||q.Option1||q.option1||"");
              setOpt2(q.Opt2||q.opt2||q.Option2||q.option2||"");
              setOpt3(q.Opt3||q.opt3||q.Option3||q.option3||"");
              setOpt4(q.Opt4||q.opt4||q.Option4||q.option4||"");
              setCorrect(q.Correct||q.correct||"");
              setExplanation(q.Explanation||q.explanation||"");
              setTechnique(q.Technique||q.technique||"");
              const qt=(q.QType||q.qtype||"MCQ").toLowerCase();
              setQtype(t==="Study"?"study":qt==="written"?"written":"mcq");
            }
          }catch(_){}
        }
      }

      // ── Firebase match না পেলে — Question text দিয়ে সব sheet search ──
      if(!found && reportQText && !cancelled){
        const sheetsAll=["QBank","Quiz","Study"];
        for(const t of sheetsAll){
          if(found) break;
          try{
            const raw=await loadPath(t);
            const arr=toArr(raw);
            const q=arr.find(x=>{
              const xq=(x.Question||x.question||"").trim();
              return xq && xq===reportQText;
            });
            if(q&&!cancelled){
              found=true;
              setQdata({...q,_tab:t});
              setQuestion(q.Question||q.question||"");
              setOpt1(q.Opt1||q.opt1||q.Option1||q.option1||"");
              setOpt2(q.Opt2||q.opt2||q.Option2||q.option2||"");
              setOpt3(q.Opt3||q.opt3||q.Option3||q.option3||"");
              setOpt4(q.Opt4||q.opt4||q.Option4||q.option4||"");
              setCorrect(q.Correct||q.correct||"");
              setExplanation(q.Explanation||q.explanation||"");
              setTechnique(q.Technique||q.technique||"");
              const qt=(q.QType||q.qtype||"MCQ").toLowerCase();
              setQtype(t==="Study"?"study":qt==="written"?"written":"mcq");
            }
          }catch(_){}
        }
      }

      // ── শেষ fallback — report এর নিজের data দিয়ে fill করো ──
      if(!found && reportQText && !cancelled){
        setQuestion(reportQText);
        setOpt1(report.Opt1||report.opt1||report.Option1||report.option1||"");
        setOpt2(report.Opt2||report.opt2||report.Option2||report.option2||"");
        setOpt3(report.Opt3||report.opt3||report.Option3||report.option3||"");
        setOpt4(report.Opt4||report.opt4||report.Option4||report.option4||"");
        setCorrect(report.Correct||report.correct||"");
        setExplanation(report.Explanation||report.explanation||"");
        const qt=(report.QType||report.qtype||"MCQ").toLowerCase();
        setQtype(qt==="written"?"written":"mcq");
      }

      if(!cancelled) setLoadQ(false);
    })();
    return()=>{cancelled=true;};
  },[qid,qfbKey,qsheet,reportQText]);

  const save=async()=>{
    setSaving(true);
    try{
      if(qdata&&qid){
        const t=qdata._tab||"QBank";
        const fkey=qdata._fbKey;
        let patch={};
        if(qtype==="mcq"){
          const o1k=qdata.Opt1!=null?"Opt1":qdata.opt1!=null?"opt1":"Option1";
          const o2k=o1k.replace(/1$/,"2");const o3k=o1k.replace(/1$/,"3");const o4k=o1k.replace(/1$/,"4");
          patch={Question:question,[o1k]:opt1,[o2k]:opt2,[o3k]:opt3,[o4k]:opt4,Correct:correct,Explanation:explanation,Technique:technique};
        } else {
          patch={Question:question,Explanation:explanation,Technique:technique};
          if(qtype==="study")patch.Correct=correct;
        }
        if(fkey)await fbPatch(`${t}/${fkey}`,patch);
        invalidate(t);
        // Sheet sync → GAS standalone handles this
      }
      push("success","✅ সেভ হয়েছে!","");
      setStep(2);
    }catch(e){push("error","Save ব্যর্থ",String(e?.message||e||""));}
    setSaving(false);
  };

  const doNotifyAndDelete=async()=>{
    setNotifying(true);
    try{
      const phone=(report.Phone||report.phone||"").toString().replace(/^'+/,"").trim();
      const subject=(report.Subject||report.subject||"প্রশ্নটি").toString();
      const phK=phoneKey(phone);
      const notifTitle="✅ রিপোর্ট সমাধান হয়েছে!";
      const notifBody=`"${subject}" সংশোধন হয়েছে।`;

      // reporter এর নাম খুঁজে নাও (Users থেকে), notification body তে দেখানোর জন্য
      let reporterName="";
      try{
        const usersRaw=await loadPath("Users");
        const u=toArr(usersRaw).find(x=>(x.Phone||x.phone||"").toString().replace(/^'+/,"").trim()===phone);
        reporterName=(u?.Name||u?.name||"").toString();
      }catch(_){}
      const finalBody=reporterName?`"${subject}" সংশোধন হয়েছে। (${reporterName}-এর রিপোর্ট)`:notifBody;

      await fbSet(`Notifications/${phK}/notif_${Date.now()}`,{type:"report_resolved",title:notifTitle,body:finalBody,questionId:qid,qsheet,time:nowTs(),read:false});
      // FCM direct — instant
      fcmNotifyPhone(phone, notifTitle, finalBody, {type:"report_resolved", questionId:qid}).catch(()=>{});

      // Hard delete: Firebase
      const reportKey=report._fbKey||report.row;
      if(reportKey){
        await fbDelete(`Reports/${reportKey}`);
        invalidate("Reports");
      }

      push("success","✅ নোটিফাই ও ডিলিট!","Report মুছে গেছে");
      onDone(reportKey);
    }catch(e){push("error","ব্যর্থ",String(e?.message||e||""));}
    setNotifying(false);
  };

  const ac=qtype==="mcq"?C.accent:qtype==="study"?C.green:C.purple;

  return(
    <div className="ovl">
      <div className="modal">
        <div className="mh"/>
        <div className="steps">
          <div className={`step${step===1?" act":step>1?" done":""}`}>① এডিট</div>
          <div className={`step${step===2?" act":""}`}>② নোটিফাই ও ডিলিট</div>
        </div>
        {step===1&&<>
          <div style={{background:"#ef444412",border:"1px solid #ef444430",borderRadius:9,padding:"7px 10px",marginBottom:10}}>
            <div style={{fontSize:10,color:C.red,fontWeight:700,marginBottom:2}}>🚨 {(report.Phone||report.phone||"").toString().replace(/^'+/,"")} · {report.Subject||report.subject}</div>
            <div style={{fontSize:11,color:C.text}}>{report.Issue||report.issue||"—"}</div>
          </div>
          {loadQ&&<><div className="sk" style={{height:52,marginBottom:8}}/><div className="sk" style={{height:36}}/></>}
          {!loadQ&&!qdata&&question&&<div style={{background:`${C.yellow}11`,border:`1px solid ${C.yellow}44`,borderRadius:8,padding:"10px 12px",marginBottom:8,fontSize:11,color:C.yellow}}>⚠️ Firebase এ fbKey match হয়নি — question text দিয়ে fill করা হয়েছে। Save করলে Firebase আপডেট হবে না।</div>}
          {!loadQ&&!qdata&&!question&&<div style={{textAlign:"center",color:C.muted,padding:"18px 0",fontSize:12}}>প্রশ্ন পাওয়া যায়নি।</div>}
          {!loadQ&&qdata&&qtype==="mcq"&&<>
            <div className="fld"><label>❓ প্রশ্ন</label><textarea className="ta" value={question} onChange={e=>setQuestion(e.target.value)} style={{minHeight:60}}/></div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:7,marginBottom:10}}>
              {[[opt1,setOpt1,"A"],[opt2,setOpt2,"B"],[opt3,setOpt3,"C"],[opt4,setOpt4,"D"]].map(([v,sv,lbl])=>(
                <div key={lbl} className="fld" style={{margin:0}}><label>{lbl}</label><input className="inp" value={v} onChange={e=>sv(e.target.value)}/></div>
              ))}
            </div>
            <div className="fld">
              <label>✅ সঠিক উত্তর</label>
              <div style={{display:"flex",gap:4,flexWrap:"wrap",marginBottom:5}}>
                {[opt1,opt2,opt3,opt4].filter(Boolean).map((o,i)=>(
                  <button key={i} type="button" className={`cc${correct===o?" on":""}`} onClick={()=>setCorrect(o)}>{o.slice(0,16)}</button>
                ))}
              </div>
              <input className="inp" value={correct} onChange={e=>setCorrect(e.target.value)}/>
            </div>
            <div className="fld"><label>📖 Explanation</label><textarea className="ta" value={explanation} onChange={e=>setExplanation(e.target.value)} style={{minHeight:60}}/></div>
            <div className="fld"><label>💡 Technique</label><textarea className="ta" value={technique} onChange={e=>setTechnique(e.target.value)} style={{minHeight:45}}/></div>
          </>}
          {!loadQ&&qdata&&qtype!=="mcq"&&<>
            <div className="fld"><label>প্রশ্ন</label><textarea className="ta" value={question} onChange={e=>setQuestion(e.target.value)} style={{minHeight:75}}/></div>
            {qtype==="study"&&<div className="fld"><label>✅ উত্তর</label><textarea className="ta" value={correct} onChange={e=>setCorrect(e.target.value)} style={{minHeight:60}}/></div>}
            <div className="fld"><label>📖 Explanation</label><textarea className="ta" value={explanation} onChange={e=>setExplanation(e.target.value)} style={{minHeight:60}}/></div>
            <div className="fld"><label>💡 Technique</label><textarea className="ta" value={technique} onChange={e=>setTechnique(e.target.value)} style={{minHeight:45}}/></div>
          </>}
          <div style={{display:"flex",gap:6,marginTop:4}}>
            <button type="button" className="btn bg" style={{flex:1,justifyContent:"center"}} onClick={onClose}>বাতিল</button>
            <button type="button" className="btn bp" style={{flex:2,justifyContent:"center",background:ac}} disabled={saving||loadQ||!qdata} onClick={save}>{saving?"⏳ সেভ হচ্ছে...":"💾 সেভ করুন →"}</button>
          </div>
        </>}
        {step===2&&<>
          <div className="mt">📣 নোটিফাই ও রিপোর্ট মুছুন</div>
          <div style={{background:"#22c55e12",border:"1px solid #22c55e30",borderRadius:10,padding:"11px",marginBottom:12}}>
            <div style={{fontSize:13,fontWeight:700,color:C.green,marginBottom:4}}>✅ প্রশ্ন আপডেট সম্পন্ন!</div>
          </div>
          <div style={{background:"#ef444412",border:"1px solid #ef444330",borderRadius:9,padding:"8px 11px",marginBottom:14,fontSize:11,color:C.red}}>
            ⚠️ Firebase ও Google Sheet থেকে স্থায়ীভাবে মুছে যাবে।
          </div>
          <div style={{display:"flex",gap:6}}>
            <button className="btn bg" style={{flex:1,justifyContent:"center"}} onClick={()=>onDone(report._fbKey||report.row)}>এড়িয়ে যান</button>
            <button className="btn" style={{flex:2,justifyContent:"center",background:C.green,color:"#fff"}} disabled={notifying} onClick={doNotifyAndDelete}>
              {notifying?"⏳...":"✅ নোটিফাই ও ডিলিট"}
            </button>
          </div>
        </>}
      </div>
    </div>
  );
}

export { ReportEditModal };
