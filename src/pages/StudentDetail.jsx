/* ══════════ STUDENT DETAIL ══════════
   🎨 রিডিজাইন: এখন এটাই একমাত্র জায়গা যেখানে Edit/Notify/Activate/Password/Delete —
   সব অ্যাকশন হয় (List থেকে এই সবকটাই সরানো হয়েছে, দুই জায়গায় ডুপ্লিকেট ছিল)।
   - Action bar: Edit · Notify (নিচের ইনলাইন ফর্মে স্ক্রল) · Activate/Deactivate — সমান গুরুত্বে
   - Password change — শুধু এখানেই (UserEditModal থেকে বাটন সরানো হয়েছে)
   - Delete — সবার নিচে আলাদা লাল "বিপজ্জনক এলাকা"-য়, বাকি সবকিছু থেকে দূরে */
import React, { useState, useMemo, useRef } from "react";
import { C, tint } from "../core/config.js";
import { useFB, invalidate } from "../core/dataCache.js";
import { fbPatch, fbDelete } from "../core/firebase.js";
import { phoneKey, initials, timeAgo } from "../core/utils.js";
import { Ring, Bar } from "../components/shared/MiniComponents.jsx";
import { DeleteWarningModal } from "../components/shared/DeleteWarningModal.jsx";
import { NotifyModal } from "./NotifyModal.jsx";
import { UserEditModal } from "./UserEditModal.jsx";
import { ChangePasswordModal } from "./ChangePasswordModal.jsx";

function StudentDetail({user:userProp,onBack,push}){
  const[user,setUser]=useState(userProp);
  const[editOpen,setEditOpen]=useState(false);
  const[changePwOpen,setChangePwOpen]=useState(false);
  const[busy,setBusy]=useState(false);
  const[deleteOpen,setDeleteOpen]=useState(false);
  const[deleting,setDeleting]=useState(false);
  const notifyRef=useRef(null);
  const nm=user.Name||user.name||"অজানা";
  const ph=(user.Phone||user.phone||"").replace(/^'+/,"");
  const st=(user.Status||user.status||"inactive").toLowerCase();
  const phK=phoneKey(ph);
  const fkey=user._fbKey||phK;
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

  const toggleActive=async()=>{
    setBusy(true);
    try{
      const next=st==="active"?"Inactive":"Active";
      await fbPatch(`Users/${fkey}`,{Status:next});
      setUser(u=>({...u,Status:next}));
      invalidate("Users");
      push("success",next==="Active"?"✅ অ্যাক্টিভ হলো":"⏸️ ডিঅ্যাক্টিভ হলো",nm);
    }catch(e){push("error","ব্যর্থ",e.message);}
    setBusy(false);
  };

  const confirmDelete=async()=>{
    setDeleting(true);
    try{
      await fbDelete(`Users/${fkey}`);
      invalidate("Users");
      push("success","🗑️ ডিলিট হয়েছে",nm);
      onBack();
    }catch(e){push("error","ব্যর্থ",e.message);}
    setDeleting(false);
  };

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
        <span className={`pill ${st==="active"?"pa":"pi"}`}>{st==="active"?"🟢 অ্যাক্টিভ":"⚪ ইনঅ্যাক্টিভ"}</span>
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

        {/* ── অ্যাকশন-বার — Edit/Notify/Activate সমান গুরুত্বে, একসাথে ── */}
        <div className="stu-actionbar">
          <button onClick={()=>setEditOpen(true)}><span className="ic">✏️</span>এডিট</button>
          <button onClick={()=>notifyRef.current?.scrollIntoView({behavior:"smooth",block:"center"})}><span className="ic">📣</span>নোটিফাই</button>
          <button onClick={toggleActive} disabled={busy}><span className="ic">{st==="active"?"⏸️":"✅"}</span>{busy?"...":st==="active"?"ডিঅ্যাক্টিভ":"অ্যাক্টিভ"}</button>
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

        <div style={{fontSize:10.5,fontWeight:800,color:C.muted,letterSpacing:.4,margin:"16px 0 8px",textTransform:"uppercase"}}>অ্যাকাউন্ট</div>
        <div className="card" style={{marginBottom:8}}>
          <div className="ct">🔐 পাসওয়ার্ড পরিবর্তন</div>
          <button className="btn" style={{width:"100%",justifyContent:"center",background:tint(C.accent,"18"),color:C.accent,border:`1px solid ${tint(C.accent,"33")}`,padding:"9px 0",borderRadius:9,fontWeight:600,fontSize:13}} onClick={()=>setChangePwOpen(true)}>
            🔐 নতুন পাসওয়ার্ড সেট করুন
          </button>
        </div>

        <div ref={notifyRef}><NotifyModal user={user} onClose={onBack} push={push} inline/></div>

        <div className="stu-danger">
          <div className="t">⚠️ বিপজ্জনক এলাকা</div>
          <div className="d">এই স্টুডেন্ট ডিলিট করলে তার সব প্রগ্রেস, রেজাল্ট চিরতরে মুছে যাবে। এটা ফেরানো যাবে না।</div>
          <button onClick={()=>setDeleteOpen(true)}>🗑️ স্টুডেন্ট ডিলিট করো</button>
        </div>
      </div>
      {changePwOpen&&<ChangePasswordModal user={user} onClose={()=>setChangePwOpen(false)} push={push}/>}
      {deleteOpen&&(
        <DeleteWarningModal
          title="Student ডিলিট করবেন?"
          description={`"${nm}" কে Firebase থেকে সম্পূর্ণভাবে ডিলিট করা হবে। এটি পূর্বাবস্থায় ফেরানো যাবে না।`}
          onConfirm={confirmDelete}
          onCancel={()=>!deleting&&setDeleteOpen(false)}
          loading={deleting}
        />
      )}
    </div>
  );
}

/* ══════════ REPORTS — hard delete ══════════ */

export { StudentDetail };
