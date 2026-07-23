/* ══════════ STUDENT DETAIL ══════════ */
import React, { useState, useMemo } from "react";
import { C } from "../core/config.js";
import { useFB } from "../core/dataCache.js";
import { phoneKey, initials, timeAgo } from "../core/utils.js";
import { Ring, Bar } from "../components/shared/MiniComponents.jsx";
import { NotifyModal } from "./NotifyModal.jsx";
import { UserEditModal } from "./UserEditModal.jsx";
import { ChangePasswordModal } from "./ChangePasswordModal.jsx";

function StudentDetail({user:userProp,onBack,push}){
  const[user,setUser]=useState(userProp);
  const[editOpen,setEditOpen]=useState(false);
  const[changePwOpen,setChangePwOpen]=useState(false);
  const nm=user.Name||user.name||"অজানা";
  const ph=(user.Phone||user.phone||"").replace(/^'+/,"");
  const st=(user.Status||user.status||"inactive").toLowerCase();
  const phK=phoneKey(ph);
  const{data:timeData}=useFB(`Analytics/Time/${phK}`);
  const{data:subjData}=useFB(`Analytics/Subject/${phK}`);

  const c=parseInt(user.totalCorrect)||0;
  const w=parseInt(user.totalWrong)||0;
  const tot=c+w,acc=tot?Math.round(c/tot*100):0;
  const mins=parseInt(user.totalMinutes||user.studyMinutes||user.totalTime||0);
  const dailyTime=useMemo(()=>timeData&&typeof timeData==="object"
    ?Object.entries(timeData).sort(([a],[b])=>a.localeCompare(b)).slice(-7).map(([d,v])=>({l:d.slice(5),v:parseInt(v)||0})):[]
  ,[timeData]);
  const subjEntries=useMemo(()=>subjData&&typeof subjData==="object"?Object.entries(subjData):[],[subjData]);

  return(
    <div className="fs">
      <div className="fsh">
        <button className="bk" onClick={onBack}>←</button>
        <div className="av">{initials(nm)}</div>
        <div style={{flex:1,minWidth:0}}>
          <div style={{fontWeight:700,fontSize:14,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{nm}</div>
          <div style={{fontSize:10,color:C.muted}}>📱 {ph}</div>
          {(user.classLevel||user.ClassLevel)&&<div style={{fontSize:10,color:C.accent}}>{user.classLevel||user.ClassLevel}{(user.userType||user.UserType)?` · ${user.userType||user.UserType}`:""}</div>}
          {(user.Role||user.role)&&<div style={{fontSize:10,color:C.yellow}}>🎭 {user.Role||user.role}</div>}
        </div>
        <div style={{display:"flex",flexDirection:"column",alignItems:"flex-end",gap:5}}>
          <span className={`pill ${st==="active"?"pa":"pi"}`}>{st==="active"?"✅":"🔴"}</span>
          <button className="btn bp" style={{fontSize:10,padding:"3px 8px",borderRadius:6,minWidth:0}} onClick={()=>setEditOpen(true)}>✏️ এডিট</button>
        </div>
      </div>
      {editOpen&&<UserEditModal user={user} onClose={()=>setEditOpen(false)} onSaved={updated=>{setUser(updated);setEditOpen(false);}} push={push}/>}
      <div style={{padding:"12px 12px 70px"}}>
        <div className="card">
          <div style={{display:"flex",alignItems:"center",gap:12}}>
            <Ring val={c} max={tot} color={acc>=70?C.green:acc>=40?C.yellow:C.red}/>
            <div style={{flex:1}}>
              <div style={{fontSize:18,fontWeight:700,color:acc>=70?C.green:acc>=40?C.yellow:C.red,marginBottom:3}}>{acc}% Accuracy</div>
              <div style={{fontSize:11,color:C.muted}}>✅ {c} &nbsp; ❌ {w} &nbsp; 🎯 {tot}</div>
            </div>
          </div>
        </div>
        <div className="sg">
          <div className="sc tp" data-icon="⏱"><div className="sl">মোট সময়</div><div className="sv sv-p" style={{fontSize:18}}>{mins<60?mins+"মি":~~(mins/60)+"ঘণ্টা"}</div></div>
          <div className="sc tb" data-icon="📅"><div className="sl">শেষ সক্রিয়</div><div style={{fontSize:12,fontWeight:700,marginTop:5,color:C.accent}}>{timeAgo(user.lastActive||user.Timestamp)}</div></div>
        </div>
        {dailyTime.length>0&&<div className="card"><div className="ct">⏱ দৈনিক সময়</div><Bar data={dailyTime} color={C.purple}/></div>}
        {subjEntries.length>0&&(
          <div className="card">
            <div className="ct">📚 বিষয়ভিত্তিক</div>
            {subjEntries.map(([sub,sv])=>{
              const sc=sv.correct||0,sw2=sv.wrong||0,st2=sc+sw2,sa=st2?Math.round(sc/st2*100):0;
              return(
                <div key={sub} className="srow">
                  <div style={{flex:1}}>
                    <div style={{fontWeight:600,fontSize:12}}>{sub}</div>
                    <div style={{display:"flex",alignItems:"center",marginTop:2}}><div className="sbar"><div className="sbar-f" style={{width:sa+"%",background:sa>=70?C.green:sa>=40?C.yellow:C.red}}/></div></div>
                    <div style={{fontSize:9,color:C.muted}}>✅{sc} ❌{sw2}</div>
                  </div>
                  <div style={{fontWeight:700,fontSize:14,color:sa>=70?C.green:sa>=40?C.yellow:C.red,minWidth:32,textAlign:"right"}}>{sa}%</div>
                </div>
              );
            })}
          </div>
        )}
        <div className="card" style={{marginBottom:8}}>
          <div className="ct">🔐 পাসওয়ার্ড পরিবর্তন</div>
          <button className="btn" style={{width:"100%",justifyContent:"center",background:C.red+"18",color:C.red,border:`1px solid ${C.red}33`,padding:"9px 0",borderRadius:9,fontWeight:600,fontSize:13}} onClick={()=>setChangePwOpen(true)}>
            🔐 নতুন পাসওয়ার্ড সেট করুন
          </button>
        </div>
        <NotifyModal user={user} onClose={onBack} push={push} inline/>
      </div>
      {changePwOpen&&<ChangePasswordModal user={user} onClose={()=>setChangePwOpen(false)} push={push}/>}
    </div>
  );
}

/* ══════════ REPORTS — hard delete ══════════ */

export { StudentDetail };
