/* ══════════ DASHBOARD ══════════ */
import React, { useState, useEffect, useMemo } from "react";
import { C } from "../core/config.js";
import { useFB, loadPath } from "../core/dataCache.js";
import { fmt, toArr, buildSubjectMap, pct, loadSharedGasSecret } from "../core/utils.js";
import { fetchDirtyTopicsCount, fetchOrphanStats } from "../core/sheetSave.js";
import { Bar, Tree } from "../components/shared/MiniComponents.jsx";

/* ── কনটেন্ট-লাইব্রেরি কার্ডের একটা সারি (Quiz/QBank/Study) — আগে এগুলো ৪টা আলাদা
   stat-card ছিল, এখন একটাই কার্ডে ব্রেকডাউন হিসেবে দেখানো হচ্ছে ── */
function LibRow({label,value,total,color}){
  return(
    <div style={{marginBottom:8}}>
      <div style={{display:"flex",justifyContent:"space-between",fontSize:10.5,marginBottom:3}}>
        <span style={{color:C.muted,fontWeight:600}}>{label}</span>
        <span style={{color:C.text,fontWeight:700}}>{fmt(value)}</span>
      </div>
      <div className="sbar"><div className="sbar-f" style={{width:pct(value,total)+"%",background:color}}/></div>
    </div>
  );
}

function DashboardPage({push,tick}){
  const{data:users,loading:uL}  = useFB("Users",tick);
  const{data:qbank}             = useFB("QBank",tick);
  const{data:study}             = useFB("Study",tick);
  const{data:reports}           = useFB("Reports",tick);
  // Quiz লোড হয় lazily — blocking না
  const[quizData,setQuizData]   = useState(null);
  const[atab,setAtab]           = useState("qbank");

  // analytics ট্যাব সিলেক্ট হলেই শুধু quiz লোড হয়
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
  const libTotal   = quizT+qbT+stT;

  const qbankMap   = useMemo(()=>buildSubjectMap(qbankArr),[qbankArr]);
  const quizMap    = useMemo(()=>buildSubjectMap(toArr(quizData)),[quizData]);
  const qbankEntries = useMemo(()=>Object.entries(qbankMap),[qbankMap]);
  const quizEntries  = useMemo(()=>Object.entries(quizMap),[quizMap]);

  const days = useMemo(()=>[...Array(7)].map((_,i)=>{
    const d=new Date();d.setDate(d.getDate()-(6-i));
    return{l:`${d.getDate()}/${d.getMonth()+1}`,v:0};
  }),[]);

  // ── 🩺 Data Health widget — dirty topic count + orphan question count,
  // এক নজরে দেখার জন্য (আলাদা করে Content → CDN ট্যাবে যেতে হবে না রোজ রোজ
  // চেক করতে)। gasSecret এখানে prop হিসেবে আসে না, তাই shared localStorage
  // থেকেই পড়া হচ্ছে (বাকি সব টুল যেভাবে করে) — না থাকলে widget-টা চুপচাপ
  // "সেট করা নেই" দেখাবে, এরর দেখাবে না। ──
  const[gasSecret]=useState(loadSharedGasSecret);
  const[dirtyCount,setDirtyCount]=useState(null);
  const[orphanTotal,setOrphanTotal]=useState(null);
  useEffect(()=>{
    if(!gasSecret) return;
    fetchDirtyTopicsCount({gasSecret}).then(n=>{ if(n!==null) setDirtyCount(n); }).catch(()=>{});
    fetchOrphanStats({gasSecret}).then(s=>{
      if(!s) return;
      setOrphanTotal(Object.values(s).reduce((sum,v)=>sum+(v.orphan||0),0));
    }).catch(()=>{});
  },[gasSecret,tick]);

  return(
    <div className="page">

      {/* ── এই মুহূর্তে: স্টুডেন্ট-সম্পর্কিত মূল ২টা সংখ্যা। "পেন্ডিং" আলাদা কার্ড না —
          Active-এর derived complement মাত্র, তাই সাব-টেক্সট হিসেবে দেখানো হচ্ছে ── */}
      <div className="slb" style={{marginTop:0}}>এই মুহূর্তে</div>
      <div className="sg">
        <div className="sc tb" data-icon="👥">
          <div className="sl">স্টুডেন্ট</div>
          <div className="sv sv-b">{fmt(total)}</div>
        </div>
        <div className="sc tg" data-icon="✅">
          <div className="sl">অ্যাক্টিভ</div>
          <div className="sv sv-g">{fmt(active)}</div>
          <div style={{fontSize:9,color:C.muted,marginTop:3,fontWeight:600}}>{fmt(total-active)} পেন্ডিং</div>
        </div>
      </div>

      {/* ── রিপোর্ট: একমাত্র "action needed" ডেটা, তাই আলাদা হাইলাইট কার্ডে —
          বাকি রুটিন স্ট্যাটের সাথে সমান ওজনে গুঁজে রাখা হয়নি ── */}
      {rptT>0 ? (
        <div className="card" style={{borderColor:`${C.danger}40`,background:`linear-gradient(180deg,${C.danger}0d,${C.card})`,marginBottom:20}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:10}}>
            <div>
              <div className="sl" style={{color:C.danger,marginBottom:5}}>🚨 নতুন রিপোর্ট — মনোযোগ প্রয়োজন</div>
              <div className="sv" style={{color:C.danger,fontSize:20}}>{fmt(rptT)}টি</div>
            </div>
            <div style={{fontSize:11,fontWeight:700,color:C.danger,whiteSpace:"nowrap"}}>দেখুন →</div>
          </div>
        </div>
      ) : (
        <div className="card" style={{padding:"12px 16px",marginBottom:20}}>
          <div style={{fontSize:11,color:C.muted,fontWeight:600}}>✅ কোনো পেন্ডিং রিপোর্ট নেই</div>
        </div>
      )}

      {/* ── 🩺 Data Health — Publish অপেক্ষায় থাকা Topic ও Orphan প্রশ্ন এক নজরে,
          যাতে রোজ আলাদা করে Content → CDN ট্যাবে গিয়ে চেক করতে না হয়। সুস্থ
          (dirty=0, orphan=0) থাকলে কার্ডটাই দেখানো হয় না — শুধু নজরে আনার
          মতো কিছু থাকলেই দেখাবে। gasSecret সেট করা না থাকলেও চুপচাপ কিছু
          দেখাবে না (এরর দেখাবে না, শুধু dashboard-এর বাকি অংশ যেমন ছিল
          তেমনই কাজ করবে)। ── */}
      {gasSecret && ((dirtyCount??0)>0 || (orphanTotal??0)>0) && (
        <div className="card" style={{borderColor:`${C.warning}40`,background:`linear-gradient(180deg,${C.warning}0d,${C.card})`,marginBottom:20}}>
          <div className="sl" style={{color:C.warning,marginBottom:8}}>🩺 ডেটা হেলথ</div>
          <div style={{display:"flex",gap:16}}>
            {dirtyCount>0 && (
              <div>
                <div style={{fontSize:18,fontWeight:800,color:C.text}}>{fmt(dirtyCount)}</div>
                <div style={{fontSize:10,color:C.muted}}>🟡 Topic Publish বাকি</div>
              </div>
            )}
            {orphanTotal>0 && (
              <div>
                <div style={{fontSize:18,fontWeight:800,color:C.text}}>{fmt(orphanTotal)}</div>
                <div style={{fontSize:10,color:C.muted}}>🧟 Orphan প্রশ্ন</div>
              </div>
            )}
          </div>
          <div style={{fontSize:10,color:C.muted,marginTop:8}}>বিস্তারিত ও একশনের জন্য Content → 🚀 CDN-এ যাও</div>
        </div>
      )}

      {/* ── কনটেন্ট লাইব্রেরি: আগে Quiz/QBank/Study/মোট — ৪টা আলাদা stat-card ছিল,
          এখন একটা কার্ডে ব্রেকডাউন হিসেবে ── */}
      <div className="slb">কনটেন্ট লাইব্রেরি</div>
      <div className="card">
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",marginBottom:12}}>
          <span style={{fontSize:10.5,color:C.muted,fontWeight:600,textTransform:"uppercase",letterSpacing:.5}}>মোট কনটেন্ট</span>
          <span style={{fontSize:17,fontWeight:700,fontFamily:"'Space Grotesk'"}}>{uL?"…":fmt(libTotal)}</span>
        </div>
        <LibRow label="❓ Quiz"  value={quizT} total={libTotal||1} color={C.info}/>
        <LibRow label="📚 QBank" value={qbT}   total={libTotal||1} color={C.success}/>
        <LibRow label="📖 Study" value={stT}   total={libTotal||1} color={C.warning}/>
      </div>

      <div className="slb">সাপ্তাহিক অ্যাক্টিভিটি</div>
      <div className="card">
        <div className="ct">📈 Daily Active (৭ দিন)</div>
        <Bar data={days} color={C.accent}/>
      </div>

      <div className="slb">বিস্তারিত ব্রাউজ</div>
      <div className="card">
        <div className="atabs">
          {[["quiz","❓ Quiz"],["qbank","📚 QBank"],["study","📖 Study"]].map(([v,l])=>(
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
