/* ══════════ SEARCH ══════════ */
import React, { useState, useRef, useCallback } from "react";
import { C } from "../core/config.js";
import { loadPath } from "../core/dataCache.js";
import { toArr, initials } from "../core/utils.js";

function SearchPage({push,onDetail}){
  const[q,setQ]=useState("");
  const[results,setResults]=useState(null);
  const[searching,setSearching]=useState(false);
  const deb=useRef(null);

  const doSearch=useCallback(async query=>{
    if(!query||query.length<2){setResults(null);return;}
    setSearching(true);
    const qlo=query.toLowerCase();
    try{
      const[qbankRaw,usersRaw]=await Promise.all([loadPath("QBank"),loadPath("Users")]);
      const srch=(raw,tab)=>toArr(raw).filter(q2=>{
        return[(q2.Question||q2.question||""),(q2.Subject||q2.subject||""),(q2.Correct||q2.correct||"")].join(" ").toLowerCase().includes(qlo);
      }).slice(0,8).map(q2=>({...q2,_tab:tab}));
      const uRes=toArr(usersRaw).filter(u=>(u.Name||u.name||"").toLowerCase().includes(qlo)||(u.Phone||u.phone||"").toLowerCase().includes(qlo)).slice(0,5);
      setResults({questions:srch(qbankRaw,"QBank"),users:uRes});
    }catch(e){}
    setSearching(false);
  },[]);

  const onIn=v=>{setQ(v);clearTimeout(deb.current);deb.current=setTimeout(()=>doSearch(v),400);};
  const tot=(results?.questions?.length||0)+(results?.users?.length||0);

  return(
    <div className="page">
      <div className="sw" style={{marginBottom:12}}>
        <span className="si">🔍</span>
        <input className="inp" placeholder="নাম, ফোন, প্রশ্ন..." value={q} onChange={e=>onIn(e.target.value)}/>
      </div>
      {searching&&<div style={{textAlign:"center",padding:"20px 0",color:C.muted,fontSize:12}}>⏳</div>}
      {!searching&&results&&<div style={{fontSize:11,color:C.muted,marginBottom:8}}>{tot}টি ফলাফল</div>}
      {results?.users?.length>0&&<>
        <div className="slb">👥 স্টুডেন্ট</div>
        {results.users.map((u,i)=>{
          const nm=u.Name||u.name||"অজানা",ph=u.Phone||u.phone||"—";
          const st=(u.Status||u.status||"inactive").toLowerCase();
          return(
            <div key={i} className="sri" onClick={()=>onDetail(u)}>
              <div className="av sm">{initials(nm)}</div>
              <div style={{flex:1,minWidth:0}}><div style={{fontWeight:600,fontSize:12}}>{nm}</div><div style={{fontSize:10,color:C.muted}}>📱 {ph}</div></div>
              <span className={`pill ${st==="active"?"pa":"pi"}`}>{st==="active"?"✅":"🔴"}</span>
            </div>
          );
        })}
      </>}
      {results?.questions?.length>0&&<>
        <div className="slb">❓ প্রশ্ন</div>
        {results.questions.map((q2,i)=>(
          <div key={i} className="sri" style={{cursor:"default"}}>
            <span className="stag">{q2._tab}</span>
            <div style={{flex:1,minWidth:0}}>
              <div style={{fontSize:12,fontWeight:600,lineHeight:1.4}}>{(q2.Question||q2.question||"").slice(0,80)}</div>
              {(q2.Correct||q2.correct)&&<div style={{fontSize:10,color:C.green,marginTop:1}}>✅ {q2.Correct||q2.correct}</div>}
            </div>
          </div>
        ))}
      </>}
      {!searching&&results&&tot===0&&<div className="empty"><div className="ei">🔍</div><p>পাওয়া যায়নি</p></div>}
      {!results&&<div className="empty" style={{paddingTop:28}}><div className="ei">🔍</div><p style={{fontSize:12}}>সব কিছু খুঁজুন</p></div>}
    </div>
  );
}

export { SearchPage };
