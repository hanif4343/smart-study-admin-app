/* ══════════ MODEL TEST TAB ══════════ */
import React, { useState, useEffect, useMemo } from "react";
import { C } from "../../core/config.js";
import { useFB, invalidate } from "../../core/dataCache.js";
import { fbSet, fbDelete } from "../../core/firebase.js";
import { toArr } from "../../core/utils.js";
import { getQTypeRaw, isImportantFlag, runModelTestGenerator } from "../../core/modelTestGenerator.js";
import { DeleteWarningModal } from "../../components/shared/DeleteWarningModal.jsx";

function ModelTestTab({push,tick}){
  const{data:quizRaw}=useFB("Quiz",tick);
  const{data:qbankRaw}=useFB("QBank",tick);
  const{data:studyRaw}=useFB("Study",tick);
  const{data:mtRaw,loading:mtLoading}=useFB("ModelTests",tick);

  const quizArr=useMemo(()=>toArr(quizRaw),[quizRaw]);
  const qbankArr=useMemo(()=>toArr(qbankRaw),[qbankRaw]);
  const studyArr=useMemo(()=>toArr(studyRaw),[studyRaw]);

  const subjects=useMemo(()=>{
    const set=new Set();
    [...quizArr,...qbankArr,...studyArr].forEach(q=>{
      const s=(q.Subject||q.subject||"").trim();
      if(s)set.add(s);
    });
    return[...set].sort((a,b)=>a.localeCompare(b,"bn"));
  },[quizArr,qbankArr,studyArr]);

  const[subject,setSubject]=useState("");
  const[type,setType]=useState("both"); // mcq | written | both
  const[count,setCount]=useState(5);
  const[perTest,setPerTest]=useState(25);
  const[generating,setGenerating]=useState(false);
  const[delTarget,setDelTarget]=useState(null);
  const[delLoading,setDelLoading]=useState(false);

  useEffect(()=>{if(!subject&&subjects.length)setSubject(subjects[0]);},[subjects,subject]);

  const existingTests=useMemo(()=>{
    if(!mtRaw||!subject||typeof mtRaw!=="object")return[];
    const subjTests=mtRaw[subject];
    if(!subjTests||typeof subjTests!=="object")return[];
    return Object.entries(subjTests)
      .filter(([,t])=>t&&typeof t==="object")
      .map(([num,t])=>({num,...t,qCount:t.questions?Object.keys(t.questions).length:0}))
      .sort((a,b)=>(+a.num)-(+b.num));
  },[mtRaw,subject]);

  const generate=async()=>{
    if(!subject){push("warn","বিষয় নির্বাচন করুন","");return;}
    if(count<=0||perTest<=0){push("warn","সংখ্যা ঠিকভাবে দিন","");return;}
    setGenerating(true);
    try{
      const bySubject=q=>(q.Subject||q.subject||"").trim()===subject;
      const quizItems  = quizArr.filter(bySubject);
      const qbankItems = qbankArr.filter(bySubject);
      // Study sheet-এ MCQ option থাকে না — mcq-only টেস্টে ঢুকবে না
      const studyItems = type==="mcq" ? [] : studyArr.filter(bySubject);

      if(quizItems.length===0&&qbankItems.length===0&&studyItems.length===0){
        throw new Error(`"${subject}" বিষয়ে কোনো প্রশ্ন পাওয়া যায়নি (Quiz/QBank/Study sheet)`);
      }

      // Auto-important: QBank-এ একই প্রশ্ন একাধিক আলাদা Year|Exam এ থাকলে গুরুত্বপূর্ণ ধরা হয়
      const repeatKeyOf=s=>(s||"").toString().trim().toLowerCase();
      const yearExamSets={};
      qbankItems.forEach(q=>{
        const key=repeatKeyOf(q.Question||q.question);
        if(!key)return;
        const ye=`${(q.Year||q.year||"").toString()}|${(q.Exam_Name||q.examName||q.exam_name||q["Exam Name"]||"").toString()}`;
        (yearExamSets[key]=yearExamSets[key]||new Set()).add(ye);
      });

      const pool=[
        ...quizItems.map(q=>({
          sourceKey:`Quiz|${q._fbKey}`,
          qtype:getQTypeRaw(q),
          important:isImportantFlag(q)
        })),
        ...qbankItems.map(q=>{
          const key=repeatKeyOf(q.Question||q.question);
          const autoImportant=(yearExamSets[key]?.size||0)>1;
          return{
            sourceKey:`QBank|${q._fbKey}`,
            qtype:getQTypeRaw(q),
            important:autoImportant||isImportantFlag(q)
          };
        }),
        // Study-র প্রশ্ন সবসময় "written" ধরা হয় (option না থাকায়)
        ...studyItems.map(q=>({
          sourceKey:`Study|${q._fbKey}`,
          qtype:"written",
          important:false
        })),
      ];

      const filteredPool = type==="mcq"    ? pool.filter(p=>p.qtype!=="written"&&p.qtype!=="study")
                          : type==="written"? pool.filter(p=>p.qtype==="written")
                          : pool;
      if(filteredPool.length===0){
        throw new Error(`এই ধরনের (${type}) কোনো প্রশ্ন "${subject}" বিষয়ে নেই`);
      }

      const result=runModelTestGenerator(filteredPool,count,perTest);
      if(result.tests.length===0||result.tests.every(t=>t.questionKeys.length===0)){
        throw new Error(result.warning||"প্রশ্ন সিলেক্ট করা যায়নি");
      }

      const payload={};
      result.tests.forEach(t=>{
        payload[String(t.testNumber)]={
          title:`মডেল টেস্ট ${t.testNumber}`,
          type,
          totalMarks:t.questionKeys.length,
          createdAt:Date.now(),
          questions:Object.fromEntries(t.questionKeys.map((k,idx)=>[String(idx),k]))
        };
      });

      await fbSet(`ModelTests/${encodeURIComponent(subject)}`,payload);
      invalidate("ModelTests");
      push("success",`✅ "${subject}"-এ ${result.tests.length}টি Model Test তৈরি হয়েছে`,result.warning||"");
    }catch(e){
      push("error","তৈরি ব্যর্থ",e.message||String(e));
    }
    setGenerating(false);
  };

  const confirmDeleteSubject=async()=>{
    if(!delTarget)return;
    setDelLoading(true);
    try{
      await fbDelete(`ModelTests/${encodeURIComponent(delTarget)}`);
      invalidate("ModelTests");
      push("success","🗑️ ডিলিট হয়েছে",`"${delTarget}"-এর সব Model Test মুছে ফেলা হয়েছে`);
      setDelTarget(null);
    }catch(e){push("error","ডিলিট ব্যর্থ",e.message||String(e));}
    setDelLoading(false);
  };

  const F={marginBottom:12};
  const L={fontSize:11,color:C.muted,fontWeight:600,marginBottom:4,display:"block"};

  return(
    <div>
      <div className="card">
        <div style={{fontWeight:700,fontSize:13,marginBottom:10}}>🧪 নতুন Model Test তৈরি করুন</div>

        <div style={F}>
          <label style={L}>📚 বিষয় (Subject)</label>
          <select className="inp" value={subject} onChange={e=>setSubject(e.target.value)}>
            {subjects.length===0&&<option value="">— কোনো বিষয় পাওয়া যায়নি —</option>}
            {subjects.map(s=><option key={s} value={s}>{s}</option>)}
          </select>
        </div>

        <div style={F}>
          <label style={L}>🏷️ প্রশ্নের ধরন</label>
          <div className="atabs">
            <button className={`atab${type==="both"?" on":""}`} onClick={()=>setType("both")}>উভয়</button>
            <button className={`atab${type==="mcq"?" on":""}`} onClick={()=>setType("mcq")}>MCQ</button>
            <button className={`atab${type==="written"?" on":""}`} onClick={()=>setType("written")}>Written</button>
          </div>
        </div>

        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
          <div style={F}>
            <label style={L}>🔢 কতগুলো টেস্ট</label>
            <input className="inp" type="number" min="1" value={count} onChange={e=>setCount(parseInt(e.target.value)||0)}/>
          </div>
          <div style={F}>
            <label style={L}>📄 প্রতি টেস্টে প্রশ্ন</label>
            <input className="inp" type="number" min="1" value={perTest} onChange={e=>setPerTest(parseInt(e.target.value)||0)}/>
          </div>
        </div>

        <div style={{fontSize:10,color:C.muted,marginBottom:10,lineHeight:1.5}}>
          💡 প্রতিটা টেস্টে ~৩০-৪০% গুরুত্বপূর্ণ (QBank-এ একাধিক বছর/পরীক্ষায় repeat হওয়া) প্রশ্ন
          থাকবে, বাকিটা কম-ব্যবহৃত প্রশ্ন থেকে ঘুরিয়ে ঘুরিয়ে আসবে। আগের Model Test থাকলে
          এই subject-এর জন্য সেগুলো ওভাররাইট হয়ে যাবে।
        </div>

        <button className="btn bp bb" disabled={generating||!subject} onClick={generate}>
          {generating?"⏳ তৈরি হচ্ছে...":"⚡ Model Test তৈরি করুন"}
        </button>
      </div>

      {subject&&(
        <div className="card">
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10}}>
            <div style={{fontWeight:700,fontSize:13}}>📋 "{subject}"-এর বিদ্যমান Model Test</div>
            {existingTests.length>0&&
              <button className="btn" style={{fontSize:11,background:"#ef444422",color:C.red,border:`1px solid ${C.red}44`}} onClick={()=>setDelTarget(subject)}>🗑️ সব ডিলিট</button>}
          </div>
          {mtLoading?<div className="sk"/>:
           existingTests.length===0?<div style={{fontSize:12,color:C.muted,textAlign:"center",padding:"10px 0"}}>কোনো Model Test নেই</div>:
           existingTests.map(t=>(
            <div key={t.num} style={{background:C.panel,border:`1px solid ${C.border}`,borderRadius:9,padding:"9px 11px",marginBottom:7,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <div>
                <div style={{fontSize:12,fontWeight:600}}>{t.title||`মডেল টেস্ট ${t.num}`}</div>
                <div style={{fontSize:10,color:C.muted,marginTop:2}}>🏷️ {t.type||"—"} &nbsp; 📄 {t.qCount||t.totalMarks||0}টি প্রশ্ন</div>
              </div>
              <span className="pill" style={{background:C.purple+"22",color:C.purple}}>#{t.num}</span>
            </div>
           ))
          }
        </div>
      )}

      {delTarget&&(
        <DeleteWarningModal
          title="Model Test ডিলিট করবেন?"
          description={`"${delTarget}" বিষয়ের সব Model Test (${existingTests.length}টি) Firebase থেকে সম্পূর্ণভাবে ডিলিট করা হবে। এটি পূর্বাবস্থায় ফেরানো যাবে না।`}
          onConfirm={confirmDeleteSubject}
          onCancel={()=>!delLoading&&setDelTarget(null)}
          loading={delLoading}
        />
      )}
    </div>
  );
}

export { ModelTestTab };
