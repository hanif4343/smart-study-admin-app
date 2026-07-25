/* ══════════ ENTRY ══════════ */
import React, { useState, useEffect } from "react";
import { C } from "../core/config.js";
import { loadPath, invalidate } from "../core/dataCache.js";
import { fbPush } from "../core/firebase.js";
import { toArr, uploadImg, nowTs } from "../core/utils.js";
import { ImageCropPicker } from "../components/shared/ImageCropPicker.jsx";

function EntryPage({push}){
  const[mode,setMode]=useState("Quiz");
  const[qtype,setQtype]=useState("MCQ");
  const[saving,setSaving]=useState(false);
  const[uploading,setUp]=useState(false);
  const[question,setQuestion]=useState("");
  const[opt1,setOpt1]=useState("");const[opt2,setOpt2]=useState("");
  const[opt3,setOpt3]=useState("");const[opt4,setOpt4]=useState("");
  const[correct,setCorrect]=useState("");
  const[subject,setSubject]=useState("");
  const[topic,setTopic]=useState("");
  const[subtopic,setSubtopic]=useState("");
  const[explanation,setExplanation]=useState("");
  const[technique,setTechnique]=useState("");
  const[imgUrl,setImgUrl]=useState("");
  const[solImgUrls,setSolImgUrls]=useState([]); // solution/explanation image crops
  const[qImgUrls,setQImgUrls]=useState([]);     // question image crops
  const[showCropper,setShowCropper]=useState(false);
  const[subjects,setSubjects]=useState([]);

  useEffect(()=>{
    loadPath(mode).then(raw=>{
      const arr=toArr(raw);
      setSubjects([...new Set(arr.map(q=>q.Subject||q.subject||"").filter(Boolean))]);
    }).catch(()=>{});
  },[mode]);

  const reset=()=>{setQuestion("");setOpt1("");setOpt2("");setOpt3("");setOpt4("");setCorrect("");setExplanation("");setTechnique("");setImgUrl("");setQImgUrls([]);setSolImgUrls([]);};
  const handleImg=async e=>{
    const f=e.target.files[0];if(!f)return;
    setUp(true);
    try{const u=await uploadImg(f);setImgUrl(u);push("success","ছবি আপলোড হয়েছে","");}
    catch{push("error","আপলোড ব্যর্থ","");}
    setUp(false);
  };
  const submit=async()=>{
    if(!question.trim()&&qImgUrls.length===0){push("warn","প্রশ্ন লিখুন বা ছবি দিন","");return;}
    if(!subject.trim()){push("warn","বিষয় লিখুন","");return;}
    setSaving(true);
    try{
      const ts=nowTs(),id=Date.now();
      // combine: single upload imgUrl + crop question imgs
      const allQImgs=[...qImgUrls,...(imgUrl?[imgUrl]:[])];
      const finalImg=allQImgs.join(","); // multiple imgs comma separated
      const finalExpl=explanation+(solImgUrls.length?"\n"+solImgUrls.join("\n"):"");
      let rec={};
      if(mode==="Quiz")rec={ID:id,Question:question,Opt1:opt1,Opt2:opt2,Opt3:opt3,Opt4:opt4,Correct:correct,Subject:subject,Sub_topic:subtopic,Explanation:finalExpl,Technique:technique,QType:qtype,Timestamp:ts,Image:finalImg};
      else if(mode==="QBank")rec={ID:id,Question:question,Opt1:opt1,Opt2:opt2,Opt3:opt3,Opt4:opt4,Correct:correct,Subject:subject,Topic:topic,Sub_topic:subtopic,Explanation:finalExpl,Technique:technique,QType:qtype,Timestamp:ts,Image:finalImg};
      else rec={ID:id,Question:question,Correct:correct,Subject:subject,Sub_topic:subtopic,Explanation:finalExpl,Technique:technique,"Question Type":"Study",Timestamp:ts,Image:finalImg};
      await fbPush(mode,rec);
      invalidate(mode);
      push("success","✅ সেভ হয়েছে!",`${mode} #${id}`);
      reset();
    }catch(e){push("error","ব্যর্থ",e.message);}
    setSaving(false);
  };
  return(
    <div className="page">
      <div className="ftabs">{["Quiz","QBank","Study"].map(m=><button key={m} className={`ftab${mode===m?" on":""}`} onClick={()=>setMode(m)}>{m}</button>)}</div>
      {mode!=="Study"&&<div style={{display:"flex",gap:7,marginBottom:11}}>{["MCQ","Written"].map(t=><button key={t} className={`tp2${qtype===t?" on":""}`} onClick={()=>setQtype(t)}>{t}</button>)}</div>}
      <div className="fld"><label>{mode==="Study"?"📝 প্রশ্ন":"❓ প্রশ্ন"}</label><textarea className="ta" value={question} onChange={e=>setQuestion(e.target.value)} style={{minHeight:80}}/></div>
      {mode==="Study"&&<div className="fld"><label>✅ উত্তর</label><textarea className="ta" value={correct} onChange={e=>setCorrect(e.target.value)} style={{minHeight:80}}/></div>}
      {mode!=="Study"&&qtype==="MCQ"&&<>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
          <div className="fld"><label>A</label><input className="inp" value={opt1} onChange={e=>setOpt1(e.target.value)}/></div>
          <div className="fld"><label>B</label><input className="inp" value={opt2} onChange={e=>setOpt2(e.target.value)}/></div>
          <div className="fld"><label>C</label><input className="inp" value={opt3} onChange={e=>setOpt3(e.target.value)}/></div>
          <div className="fld"><label>D</label><input className="inp" value={opt4} onChange={e=>setOpt4(e.target.value)}/></div>
        </div>
        <div className="fld">
          <label>✅ সঠিক উত্তর</label>
          <div style={{display:"flex",gap:5,flexWrap:"wrap",marginBottom:6}}>
            {[opt1,opt2,opt3,opt4].filter(Boolean).map((o,i)=><button key={i} type="button" className={`cc${correct===o?" on":""}`} onClick={()=>setCorrect(o)}>{o.slice(0,16)}</button>)}
          </div>
          <input className="inp" value={correct} onChange={e=>setCorrect(e.target.value)} placeholder="বা সরাসরি লিখুন..."/>
        </div>
      </>}
      <div className="fld">
        <label>📚 বিষয়</label>
        <input className="inp" list="sl" value={subject} onChange={e=>setSubject(e.target.value)} placeholder="Subject..."/>
        <datalist id="sl">{subjects.map((s,i)=><option key={i} value={s}/>)}</datalist>
      </div>
      {mode==="QBank"&&<div className="fld"><label>📂 Topic</label><input className="inp" value={topic} onChange={e=>setTopic(e.target.value)}/></div>}
      <div className="fld"><label>📌 Sub Topic</label><input className="inp" value={subtopic} onChange={e=>setSubtopic(e.target.value)}/></div>
      <div className="fld"><label>📖 Explanation</label><textarea className="ta" value={explanation} onChange={e=>setExplanation(e.target.value)} style={{minHeight:80}}/></div>
      <div className="fld"><label>💡 Technique</label><textarea className="ta" value={technique} onChange={e=>setTechnique(e.target.value)} style={{minHeight:60}}/></div>
      <div className="fld">
        <label>🖼 ছবি (প্রশ্ন ও সমাধান)</label>
        {/* crop button - main entry */}
        <button type="button" onClick={()=>setShowCropper(true)}
          style={{width:"100%",display:"flex",alignItems:"center",justifyContent:"center",gap:8,background:C.panel,border:`1.5px dashed ${C.accent}`,borderRadius:10,padding:"11px 12px",cursor:"pointer",fontSize:13,fontWeight:700,color:C.accent,marginBottom:8}}>
          ✂️ বইয়ের পাতা থেকে Crop করুন
        </button>
        {/* old-style single upload still available */}
        <label style={{display:"flex",alignItems:"center",gap:7,background:C.panel,border:`1px solid ${C.border}`,borderRadius:9,padding:"9px 12px",cursor:"pointer",fontSize:12,color:C.muted}}>
          {uploading?"⏳ আপলোড হচ্ছে...":"📷 সরাসরি ছবি আপলোড"}
          <input type="file" accept="image/*" style={{display:"none"}} onChange={handleImg}/>
          {imgUrl&&<a href={imgUrl} target="_blank" rel="noreferrer" style={{fontSize:11,color:C.accent,marginLeft:"auto"}} onClick={e=>e.stopPropagation()}>দেখুন ↗</a>}
        </label>
        {/* show question crops */}
        {qImgUrls.length>0&&(
          <div style={{marginTop:8}}>
            <div style={{fontSize:11,color:C.accent,marginBottom:4,fontWeight:700}}>📌 প্রশ্নের ছবি ({qImgUrls.length}টি)</div>
            <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
              {qImgUrls.map((u,i)=>(
                <div key={i} style={{position:"relative"}}>
                  <img src={u} style={{height:56,borderRadius:7,border:`1.5px solid ${C.accent}`}} alt=""/>
                  <button onClick={()=>setQImgUrls(p=>p.filter((_,j)=>j!==i))}
                    style={{position:"absolute",top:-5,right:-5,background:C.red,border:"none",borderRadius:"50%",width:16,height:16,fontSize:9,color:"#fff",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}>✕</button>
                </div>
              ))}
            </div>
          </div>
        )}
        {/* show solution crops */}
        {solImgUrls.length>0&&(
          <div style={{marginTop:8}}>
            <div style={{fontSize:11,color:C.green,marginBottom:4,fontWeight:700}}>✅ সমাধানের ছবি ({solImgUrls.length}টি)</div>
            <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
              {solImgUrls.map((u,i)=>(
                <div key={i} style={{position:"relative"}}>
                  <img src={u} style={{height:56,borderRadius:7,border:`1.5px solid ${C.green}`}} alt=""/>
                  <button onClick={()=>setSolImgUrls(p=>p.filter((_,j)=>j!==i))}
                    style={{position:"absolute",top:-5,right:-5,background:C.red,border:"none",borderRadius:"50%",width:16,height:16,fontSize:9,color:"#fff",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}>✕</button>
                </div>
              ))}
            </div>
          </div>
        )}
        {imgUrl&&<img src={imgUrl} style={{width:"100%",borderRadius:9,marginTop:6,border:`1px solid ${C.border}`}} alt="p"/>}
      </div>
      {/* Crop modal */}
      {showCropper&&(
        <ImageCropPicker
          push={push}
          onCropToQuestion={url=>setQImgUrls(p=>[...p,url])}
          onCropToSolution={url=>setSolImgUrls(p=>[...p,url])}
          onClose={()=>setShowCropper(false)}
        />
      )}
      <button className="btn bp bb" style={{marginTop:4}} disabled={saving} onClick={submit}>{saving?"⏳ সেভ হচ্ছে...":"💾 সেভ করুন"}</button>
    </div>
  );
}

export { EntryPage };
