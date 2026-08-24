/* ══════════ STUDENTS (signup tab সহ) ══════════
   🎨 রিডিজাইন: Edit/Notify/Delete/Password — এই সবকটা অ্যাকশন এখন StudentDetail.jsx-এ
   একমাত্র জায়গা হিসেবে সরানো হয়েছে (তাই এখানে NotifyModal/UserEditModal/DeleteWarningModal
   আমদানি ও তাদের state আর দরকার নেই — শুধু Signups ট্যাবের rejectTarget-এর জন্য
   DeleteWarningModal থেকেই যাচ্ছে, ওটা আলাদা ওয়ার্কফ্লো)। */
import React, { useState, useMemo, useCallback } from "react";
import { C, tint } from "../core/config.js";
import { useFB, invalidate } from "../core/dataCache.js";
import { fbPatch, fbSet, fbDelete } from "../core/firebase.js";
import { toArr, phoneKey, nowTs, initials, timeAgo } from "../core/utils.js";
import { DeleteWarningModal } from "../components/shared/DeleteWarningModal.jsx";
import { StudentDetail } from "./StudentDetail.jsx";

function StudentsPage({push,tick,pushLayer}){
  const{data:usersRaw,loading}=useFB("Users",tick);
  const[search,setSrc]=useState("");
  const[tab,setTab]=useState("active"); // default: running students
  const[detail,setDetail]=useState(null);
  const[activating,setActivating]=useState(null);
  const[signupDone,setSignupDone]=useState(new Set());
  const[rejectTarget,setRejectTarget]=useState(null); // pending signup user to reject/delete
  const[rejecting,setRejecting]=useState(false);

  const users=useMemo(()=>toArr(usersRaw),[usersRaw]);

  /* Signup pending rows */
  const signupRows=useMemo(()=>users.filter(u=>{
    const st=(u.Status||u.status||"").toLowerCase();
    const id=u._fbKey||(u.Phone||u.phone||"");
    return(st==="inactive"||st===""||st==="pending")&&!signupDone.has(id);
  }),[users,signupDone]);

  /* Students filtered rows */
  const filtered=useMemo(()=>{
    if(tab==="signups")return[];
    const q=search.toLowerCase();
    return users.filter(u=>{
      const nm=(u.Name||u.name||"").toLowerCase();
      const ph=(u.Phone||u.phone||"").toLowerCase();
      const st=(u.Status||"").toLowerCase();
      return(!q||nm.includes(q)||ph.includes(q))&&(tab==="all"||st===tab);
    });
  },[users,search,tab]);

  const activate=async u=>{
    const phone=u.Phone||u.phone||"";
    const fkey=u._fbKey||phoneKey(phone);
    setActivating(fkey);
    try{
      await fbPatch(`Users/${fkey}`,{Status:"Active"});
      await fbSet(`Notifications/${fkey}/welcome_${Date.now()}`,{type:"welcome",title:"🎉 অ্যাকাউন্ট অ্যাক্টিভ!",body:"Smart Study-তে স্বাগতম!",time:nowTs(),read:false});
            push("success","✅ অ্যাক্টিভ!",u.Name||u.name||phone);
      setSignupDone(p=>new Set([...p,fkey]));
      invalidate("Users");
    }catch(e){push("error","ব্যর্থ",e.message);}
    setActivating(null);
  };

  const confirmReject=async()=>{
    if(!rejectTarget)return;
    const u=rejectTarget;
    const phone=u.Phone||u.phone||"";
    const fkey=u._fbKey||phoneKey(phone);
    setRejecting(true);
    try{
      await fbDelete(`Users/${fkey}`); // পুরোপুরি ডিলিট — শুধু inactive মার্ক না
      push("success","🗑️ রিজেক্ট হয়েছে",(u.Name||u.name||phone)+" সম্পূর্ণ ডিলিট হয়েছে");
      setSignupDone(p=>new Set([...p,fkey]));
      invalidate("Users");
      setRejectTarget(null);
    }catch(e){push("error","ব্যর্থ",e.message);}
    setRejecting(false);
  };



  // StudentDetail খুললে layer push
  const openDetail=useCallback((u)=>{
    setDetail(u);
    if(pushLayer){ pushLayer(()=>setDetail(null)); }
  },[pushLayer]);
  if(detail)return<StudentDetail user={detail} onBack={()=>setDetail(null)} push={push}/>;

  return(
    <div className="page">
      {/* Main Tabs */}
      <div className="ftabs" style={{marginBottom:10}}>
        <button className={`ftab${tab==="active"?" on":""}`} onClick={()=>setTab("active")}>🟢 Running</button>
        <button className={`ftab${tab==="all"?" on":""}`} onClick={()=>setTab("all")}>👥 সবাই</button>
        <button className={`ftab${tab==="inactive"?" on":""}`} onClick={()=>setTab("inactive")}>🔴 ইনঅ্যাক্টিভ</button>
        <button className={`ftab${tab==="signups"?" on":""}`} onClick={()=>setTab("signups")} style={{position:"relative"}}>
          🆕 সাইনআপ
          {signupRows.length>0&&<span style={{position:"absolute",top:-4,right:-4,background:"#ef4444",color:"#fff",fontSize:9,fontWeight:900,borderRadius:999,minWidth:16,height:16,display:"flex",alignItems:"center",justifyContent:"center",padding:"0 3px"}}>{signupRows.length}</span>}
        </button>
      </div>

      {/* ── Signups Tab ── */}
      {tab==="signups"&&(
        <>
          <div style={{background:"#ef444412",border:"1px solid #ef444430",borderRadius:10,padding:"8px 12px",fontSize:12,color:C.red,fontWeight:600,marginBottom:11,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
            <span>🔔 {signupRows.length}টি পেন্ডিং</span>
            {loading&&<span style={{fontSize:10,color:C.muted}}>⏳</span>}
          </div>
          {loading&&!usersRaw?[...Array(3)].map((_,i)=><div key={i} className="sk"/>):
           signupRows.length===0?<div className="empty"><div className="ei">🎉</div><p>সব অ্যাক্টিভ!</p></div>:
           signupRows.map((u,i)=>{
            const nm=u.Name||u.name||"অজানা",ph=u.Phone||u.phone||"—";
            const fkey=u._fbKey||phoneKey(ph);
            return(
              <div key={i} className="card">
                <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:10}}>
                  <div className="av">{initials(nm)}</div>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontWeight:700,fontSize:13}}>{nm}</div>
                    <div style={{fontSize:11,color:C.muted}}>📱 {ph}</div>
                    {(u.Email||u.email)&&<div style={{fontSize:11,color:C.muted}}>✉️ {u.Email||u.email}</div>}
                    <div style={{fontSize:10,color:C.muted}}>🕐 {timeAgo(u.Timestamp||u.createdAt)}</div>
                  </div>
                  <span className="pill pp">⏳ পেন্ডিং</span>
                </div>
                <div style={{display:"flex",gap:8}}>
                  <button className="btn bs bb" style={{flex:2,justifyContent:"center"}} disabled={!!activating||rejecting} onClick={()=>activate(u)}>
                    {activating===fkey?"⏳ হচ্ছে...":"✅ অ্যাক্টিভ করুন"}
                  </button>
                  <button className="btn bg" style={{flex:1,justifyContent:"center",color:C.red,borderColor:`${tint(C.red,"40")}`}} disabled={!!activating||rejecting} onClick={()=>setRejectTarget(u)}>
                    ❌ রিজেক্ট
                  </button>
                </div>
              </div>
            );
           })
          }
          {rejectTarget&&(
            <DeleteWarningModal
              title="সাইনআপ রিজেক্ট করবেন?"
              description={`"${rejectTarget.Name||rejectTarget.name||rejectTarget.Phone||rejectTarget.phone||"এই ইউজার"}" কে রিজেক্ট করলে ইউজারটি Firebase থেকে সম্পূর্ণভাবে ডিলিট হয়ে যাবে — শুধু ইনঅ্যাক্টিভ হবে না।`}
              onConfirm={confirmReject}
              onCancel={()=>!rejecting&&setRejectTarget(null)}
              loading={rejecting}
            />
          )}
        </>
      )}

      {/* ── Students Tabs ──
          🎨 রিডিজাইন: আগে প্রতি কার্ডে ৩টা স্ট্যাট-বক্স + ৫টা বাটন থাকত (List আসলে
          Detail-এর মিনি-ভার্সন হয়ে গিয়েছিল — ডেটা আর অ্যাকশন দুটোই দুই জায়গায়
          ডুপ্লিকেট)। এখন নীতি: List = শুধু খোঁজা আর চোখ বুলানো, Detail = সব কাজ করার
          একমাত্র জায়গা। তাই এখানে এখন শুধু অ্যাভাটার+নাম+ফোন+accuracy% + বাম পাশে
          স্ট্যাটাস রঙের বার — কোনো বাটন নেই, পুরো রো-ই ট্যাপ করলে Detail খোলে। */}
      {tab!=="signups"&&(
        <>
          <div className="sw"><span className="si">🔍</span><input className="inp" placeholder="নাম বা ফোন..." value={search} onChange={e=>setSrc(e.target.value)}/></div>
          <div style={{fontSize:11,color:C.muted,marginBottom:8}}>{filtered.length} জন</div>
          {loading&&!usersRaw?[...Array(4)].map((_,i)=><div key={i} className="sk"/>):
           filtered.length===0?<div className="empty"><div className="ei">👤</div><p>কেউ নেই</p></div>:
           filtered.map((u,i)=>{
            const nm=u.Name||u.name||"অজানা",ph=u.Phone||u.phone||"—";
            const st=(u.Status||"inactive").toLowerCase();
            const fkey=u._fbKey||phoneKey(ph);
            const c=parseInt(u.totalCorrect)||0,w=parseInt(u.totalWrong)||0,tot=c+w;
            const acc=tot?Math.round(c/tot*100):0;
            return(
              <button key={fkey||i} className="stu-row" style={{borderLeftColor:st==="active"?C.green:C.muted}} onClick={()=>openDetail(u)}>
                <div className="av stu-av">{initials(nm)}</div>
                <div className="stu-info">
                  <div className="stu-name">{nm}</div>
                  <div className="stu-phone">📱 {ph}</div>
                </div>
                <div className="stu-acc" style={{color:tot===0?C.muted:acc>=70?C.green:acc>=40?C.yellow:C.red}}>
                  {tot===0?"নতুন":`${acc}%`}
                </div>
                <div className="stu-chev">›</div>
              </button>
            );
           })
          }
        </>
      )}
    </div>
  );
}


export { StudentsPage };
