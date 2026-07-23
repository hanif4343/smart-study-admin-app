/* ══════════ DASHBOARD ══════════ */
import React, { useState, useEffect, useMemo } from "react";
import { C } from "../core/config.js";
import { useFB, loadPath } from "../core/dataCache.js";
import { fmt, toArr, buildSubjectMap } from "../core/utils.js";
import { Bar, Tree } from "../components/shared/MiniComponents.jsx";

function DashboardPage({push,tick}){
  const{data:users,loading:uL}  = useFB("Users",tick);
  const{data:qbank}             = useFB("QBank",tick);
  const{data:study}             = useFB("Study",tick);
  const{data:reports}           = useFB("Reports",tick);
  // Quiz loaded lazily — not blocking
  const[quizData,setQuizData]   = useState(null);
  const[atab,setAtab]           = useState("qbank");

  // load quiz only when analytics tab selected
  useEffect(()=>{
    if(atab==="quiz"&&!quizData){
      loadPath("Quiz").then(d=>setQuizData(d)).catch(()=>{});
    }
  },[atab,quizData]);

  const userArr = useMemo(()=>toArr(users),[users]);
  const total   = userArr.length;
  const active  = useMemo(()=>userArr.filter(u=>(u.Status||u.status||"").toLowerCase()==="active").length,[userArr]);

  const qbankArr   = useMemo(()=>toArr(qbank),[qbank]);
  const qbT        = qbankArr.length;
  const stT        = useMemo(()=>toArr(study).length,[study]);
  const rptT       = useMemo(()=>toArr(reports).length,[reports]);
  const quizT      = useMemo(()=>toArr(quizData).length,[quizData]);

  const qbankMap   = useMemo(()=>buildSubjectMap(qbankArr),[qbankArr]);
  const quizMap    = useMemo(()=>buildSubjectMap(toArr(quizData)),[quizData]);
  const qbankEntries = useMemo(()=>Object.entries(qbankMap),[qbankMap]);
  const quizEntries  = useMemo(()=>Object.entries(quizMap),[quizMap]);

  const days = useMemo(()=>[...Array(7)].map((_,i)=>{
    const d=new Date();d.setDate(d.getDate()-(6-i));
    return{l:`${d.getDate()}/${d.getMonth()+1}`,v:0};
  }),[]);

  return(
    <div className="page">
      <div className="sg">
        <div className="sc tb" data-icon="👥"><div className="sl">স্টুডেন্ট</div><div className="sv sv-b">{fmt(total)}</div></div>
        <div className="sc tg" data-icon="✅"><div className="sl">অ্যাক্টিভ</div><div className="sv sv-g">{fmt(active)}</div></div>
        <div className="sc ty" data-icon="⏳"><div className="sl">পেন্ডিং</div><div className="sv sv-y">{fmt(total-active)}</div></div>
        <div className="sc tr" data-icon="🚨"><div className="sl">রিপোর্ট</div><div className="sv sv-r">{fmt(rptT)}</div></div>
      </div>
      <div className="sg">
        <div className="sc tb" data-icon="❓"><div className="sl">Quiz</div><div className="sv sv-b">{uL?"…":fmt(quizT)}</div></div>
        <div className="sc tg" data-icon="📚"><div className="sl">QBank</div><div className="sv sv-g">{fmt(qbT)}</div></div>
        <div className="sc ty" data-icon="📖"><div className="sl">Study</div><div className="sv sv-y">{fmt(stT)}</div></div>
        <div className="sc tp" data-icon="📊"><div className="sl">মোট</div><div className="sv sv-p">{fmt(quizT+qbT+stT)}</div></div>
      </div>
      <div className="card">
        <div className="ct">📈 Daily Active (৭ দিন)</div>
        <Bar data={days} color={C.accent}/>
      </div>
      <div className="card">
        <div className="ct">📊 Analytics</div>
        <div className="atabs">
          {[["qbank","📚 QBank"],["quiz","❓ Quiz"],["study","📖 Study"]].map(([v,l])=>(
            <button key={v} className={`atab${atab===v?" on":""}`} onClick={()=>setAtab(v)}>{l}</button>
          ))}
        </div>
        {atab==="qbank"&&(qbankEntries.length===0
          ?<div style={{textAlign:"center",color:C.muted,padding:"12px 0",fontSize:12}}>{!qbank?"⏳ লোড হচ্ছে...":"ডেটা নেই"}</div>
          :<Tree entries={qbankEntries} total={qbT} color={C.green}/>
        )}
        {atab==="quiz"&&(quizEntries.length===0
          ?<div style={{textAlign:"center",color:C.muted,padding:"12px 0",fontSize:12}}>{!quizData?"⏳ লোড হচ্ছে...":"ডেটা নেই"}</div>
          :<Tree entries={quizEntries} total={quizT} color={C.accent}/>
        )}
        {atab==="study"&&<div style={{textAlign:"center",color:C.muted,padding:"12px 0",fontSize:12}}>{fmt(stT)}টি নোট</div>}
      </div>
    </div>
  );
}

export { DashboardPage };
