/* ══════════ NOTIFY PAGE ══════════ */
import React, { useState, useEffect, useMemo } from "react";
import { C } from "../core/config.js";
import { useFB, loadPath } from "../core/dataCache.js";
import { fbSet } from "../core/firebase.js";
import { fcmBroadcast } from "../core/fcm.js";
import { toArr, nowTs, phoneKey } from "../core/utils.js";
import { NotifyModal } from "./NotifyModal.jsx";

function NotifyPage({push,tick}){
  const[title,setTitle]=useState("");
  const[body,setBody]=useState("");
  const[sending,setSending]=useState(false);
  const[hist,setHist]=useState([]);
  const[q,setQ]=useState("");
  const[selUser,setSelUser]=useState(null);
  const{data:usersRaw}=useFB("Users",tick);
  const userList=useMemo(()=>toArr(usersRaw),[usersRaw]);
  const results=useMemo(()=>{
    const s=q.trim().toLowerCase();
    if(!s)return[];
    return userList.filter(u=>{
      const nm=(u.Name||u.name||"").toLowerCase();
      const ph=(u.Phone||u.phone||"").toString().replace(/^'+/,"");
      return nm.includes(s)||ph.includes(s);
    }).slice(0,8);
  },[q,userList]);

  // Firebase থেকে notification history load করো
  useEffect(()=>{
    loadPath("AdminNotifHistory").then(raw=>{
      if(!raw)return;
      const arr=toArr(raw).sort((a,b)=>(b.sentAt||0)-(a.sentAt||0));
      setHist(arr);
    }).catch(()=>{});
  },[tick]);

  const send=async()=>{
    if(!title||!body){push("warn","তথ্য দিন","");return;}
    setSending(true);
    try{
      const raw=await loadPath("Users");
      const users=toArr(raw);
      const active=users.filter(u=>(u.Status||u.status||"").toLowerCase()==="active");
      const ts=nowTs();
      const notifKey=`broadcast_${Date.now()}`;
      await Promise.all(active.map(u=>{
        const phK=phoneKey(u.Phone||u.phone||"");
        if(!phK)return Promise.resolve();
        return fbSet(`Notifications/${phK}/${notifKey}`,{type:"broadcast",title,body,time:ts,read:false});
      }));
      // FCM direct — সব active user কে একসাথে (20 concurrent)
      const fcmSent = await fcmBroadcast(title, body, active);
      // ✅ Firebase এ history save করো — restart করলেও থাকবে
      const histKey=`notif_${Date.now()}`;
      await fbSet(`AdminNotifHistory/${histKey}`,{
        type:"broadcast", title, body, time:ts, sentAt:Date.now(),
        totalUsers:active.length, fcmSent, sentBy:"admin"
      });
      push("success","📣 পাঠানো হয়েছে!",`Notification: ${active.length}জন · FCM: ${fcmSent}জন`);
      setHist(p=>[{title,body,time:ts,count:active.length,fcmSent,totalUsers:active.length},...p.slice(0,49)]);
      setTitle("");setBody("");
    }catch(e){push("error","ব্যর্থ",String(e?.message||e||""));}
    setSending(false);
  };

  return(
    <div className="page">
      <div className="card">
        <div className="ct">👤 একজনকে নোটিফাই করুন</div>
        <div className="fld">
          <label>স্টুডেন্ট খুঁজুন (নাম/ফোন)</label>
          <input className="inp" placeholder="নাম বা ফোন নাম্বার লিখুন..." value={q} onChange={e=>{setQ(e.target.value);setSelUser(null);}}/>
        </div>
        {q&&!selUser&&(
          results.length===0?<div style={{fontSize:11,color:C.muted,padding:"4px 2px"}}>কেউ পাওয়া যায়নি</div>:
          results.map((u,i)=>(
            <div key={i} className="nr" style={{cursor:"pointer"}} onClick={()=>{setSelUser(u);setQ(u.Name||u.name||u.Phone||u.phone||"");}}>
              <div className="nd o"/>
              <div className="nc"><div className="nt">{u.Name||u.name||"—"}</div><div className="ns">📱 {(u.Phone||u.phone||"").toString().replace(/^'+/,"")}</div></div>
            </div>
          ))
        )}
        {selUser&&(
          <div style={{marginTop:8}}>
            <NotifyModal user={selUser} push={push} inline onClose={()=>{}}/>
            <button className="btn bg" style={{marginTop:6,justifyContent:"center",width:"100%"}} onClick={()=>{setSelUser(null);setQ("");}}>✖️ বাতিল</button>
          </div>
        )}
      </div>

      <div className="card">
        <div className="ct">📣 সবাইকে Broadcast</div>
        <div className="fld"><label>শিরোনাম</label><input className="inp" placeholder="Title..." value={title} onChange={e=>setTitle(e.target.value)}/></div>
        <div className="fld"><label>বার্তা</label><textarea className="ta" placeholder="Message..." value={body} onChange={e=>setBody(e.target.value)}/></div>
        <button className="btn bp bb" onClick={send} disabled={sending}>{sending?"⏳ পাঠানো হচ্ছে...":"📣 সবাইকে পাঠান"}</button>
      </div>
      {hist.length>0&&<div className="card"><div className="ct">ইতিহাস</div>{hist.map((h,i)=>(
        <div key={i} className="nr">
          <div className={`nd ${i===0?"n":"o"}`}/>
          <div className="nc"><div className="nt">{h.title}</div><div className="ns">{h.body?.slice(0,55)}<span style={{color:C.accent}}> · {h.count}জন</span></div></div>
          <div className="ntm">{h.time}</div>
        </div>
      ))}</div>}
    </div>
  );
}

export { NotifyPage };
