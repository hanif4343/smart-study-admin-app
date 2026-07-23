/* ══════════ USER EDIT MODAL ══════════ */
import React, { useState } from "react";
import { C } from "../core/config.js";
import { fbPatch } from "../core/firebase.js";
import { phoneKey } from "../core/utils.js";
import { useModalBack } from "../hooks/useModalBack.js";
import { ChangePasswordModal } from "./ChangePasswordModal.jsx";

function UserEditModal({user,onClose,onSaved,push}){
  useModalBack(onClose);
  const ph=(user.Phone||user.phone||"").replace(/^'+/,"");
  const fkey=user._fbKey||phoneKey(ph);
  const[changePwOpen,setChangePwOpen]=useState(false);

  const[name,setName]=useState(user.Name||user.name||"");
  const[email,setEmail]=useState(user.Email||user.email||"");
  const[status,setStatus]=useState(user.Status||user.status||"Active");
  const[role,setRole]=useState(user.Role||user.role||"User");
  // মূল অ্যাপ (User.kt → fromFirebaseMap) ঠিক এই অর্ডারেই ফিল্ড পড়ে: UserType→userType→Type→type, ClassLevel→classLevel→Class→class
  const[classLevel,setClassLevel]=useState(user.ClassLevel||user.classLevel||user.Class||user.class||"");
  const[userType,setUserType]=useState(user.UserType||user.userType||user.Type||user.type||"Student");
  // মূল অ্যাপের User.kt → reducedUi ফ্ল্যাগ: true হলে ইউজার নিজের অ্যাপ ছোট (zoom out) করতে পারবে
  const[reducedUi,setReducedUi]=useState(!!(user.ReducedUi??user.reducedUi??false));
  const[saving,setSaving]=useState(false);

  // মূল অ্যাপের AuthScreen.kt / ProfilePage.kt তে ব্যবহৃত আসল ভ্যালুগুলোর সাথে হুবহু মিল রাখা হয়েছে
  const CLASS_LEVELS=["Class 1","Class 2","Class 3","Class 4","Class 5","Class 6","Class 7","Class 8","Class 9","Class 10","Class 11","Class 12","Honours 1","Honours 2","Honours 3","Honours 4","Masters 1","Masters 2","Masters Final"];
  const TYPES=[{v:"Student",l:"Student (শিক্ষার্থী)"},{v:"Job",l:"Job (চাকরিজীবী)"}];
  const ROLES=["User","Admin"];
  const STATUSES=["Active","Inactive","Pending","Banned"];

  const save=async()=>{
    if(!name.trim()){push("error","নাম দিন","");return;}
    setSaving(true);
    try{
      // "UserType"/"ClassLevel" = ইউজার Student/Job কিনা ও কোন শ্রেণি (মূল অ্যাপ এই ফিল্ড থেকেই "ধরন"/"শ্রেণি" দেখায়)
      // "Role" = অ্যাডমিন পারমিশন (User/Admin) — সম্পূর্ণ আলাদা ফিল্ড, আগে "type:role" লিখে এটাকেই ওভাররাইট করা হতো
      const patch={
        Name:name.trim(),
        Email:email.trim(),
        Status:status,
        Role:role,
        UserType:userType,
        userType:userType,
        ClassLevel:userType==="Job"?"":classLevel,
        classLevel:userType==="Job"?"":classLevel,
        ReducedUi:reducedUi,
        reducedUi:reducedUi,
      };
      await fbPatch(`Users/${fkey}`,patch);
      invalidate("Users");
      push("success","✅ সেভ হয়েছে!",name.trim());
      onSaved({...user,...patch,_fbKey:fkey});
    }catch(e){push("error","সেভ ব্যর্থ",e.message||String(e));}
    setSaving(false);
  };

  const F={display:"flex",flexDirection:"column",gap:3,marginBottom:12};
  const L={fontSize:11,color:C.muted,fontWeight:600,marginBottom:3};
  const I={background:C.panel,border:`1px solid ${C.border}`,borderRadius:8,padding:"8px 10px",color:C.text,fontSize:13,width:"100%",boxSizing:"border-box"};
  const S={...I,appearance:"none"};

  return(
    <>
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.7)",zIndex:900,display:"flex",flexDirection:"column",justifyContent:"flex-end"}}>
      <div style={{background:C.card,borderRadius:"16px 16px 0 0",padding:"16px 14px 30px",maxHeight:"90vh",overflowY:"auto"}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:14}}>
          <div style={{fontWeight:700,fontSize:15}}>✏️ ইউজার এডিট</div>
          <button onClick={onClose} style={{background:"none",border:"none",color:C.muted,fontSize:20,cursor:"pointer",lineHeight:1}}>✕</button>
        </div>

        <div style={F}>
          <label style={L}>👤 নাম</label>
          <input style={I} value={name} onChange={e=>setName(e.target.value)} placeholder="নাম লিখুন"/>
        </div>

        <div style={F}>
          <label style={L}>📱 ফোন (পরিবর্তন করা যাবে না)</label>
          <input style={{...I,opacity:.5,cursor:"not-allowed"}} value={ph} readOnly/>
        </div>

        <div style={F}>
          <label style={L}>✉️ ইমেইল</label>
          <input style={I} value={email} onChange={e=>setEmail(e.target.value)} placeholder="ইমেইল লিখুন"/>
        </div>

        <div style={F}>
          <label style={L}>📊 স্ট্যাটাস</label>
          <select style={S} value={status} onChange={e=>setStatus(e.target.value)}>
            {STATUSES.map(s=><option key={s} value={s}>{s}</option>)}
          </select>
        </div>

        <div style={F}>
          <label style={L}>🎭 রোল</label>
          <select style={S} value={role} onChange={e=>setRole(e.target.value)}>
            {ROLES.map(r=><option key={r} value={r}>{r}</option>)}
          </select>
        </div>

        <div style={F}>
          <label style={L}>🏷️ টাইপ</label>
          <select style={S} value={userType} onChange={e=>{setUserType(e.target.value);if(e.target.value==="Job")setClassLevel("");}}>
            {TYPES.map(t=><option key={t.v} value={t.v}>{t.l}</option>)}
          </select>
        </div>

        {userType!=="Job"&&(
        <div style={F}>
          <label style={L}>📚 ক্লাস লেভেল</label>
          <select style={S} value={classLevel} onChange={e=>setClassLevel(e.target.value)}>
            <option value="">— নির্বাচন করুন —</option>
            {CLASS_LEVELS.map(c=><option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        )}

        <div style={{...F,marginBottom:14}}>
          <label style={L}>🔎 অ্যাপ জুম আউট পারমিশন</label>
          <div onClick={()=>setReducedUi(v=>!v)}
            style={{display:"flex",alignItems:"center",justifyContent:"space-between",background:C.panel,border:`1px solid ${reducedUi?C.accent+"66":C.border}`,borderRadius:8,padding:"9px 12px",cursor:"pointer"}}>
            <span style={{fontSize:12,color:reducedUi?C.text:C.muted}}>
              এই ইউজার নিজের অ্যাপ ছোট (zoom out) করতে পারবে
            </span>
            <div style={{width:38,height:22,borderRadius:11,background:reducedUi?C.accent:C.border,position:"relative",transition:"background .15s",flexShrink:0}}>
              <div style={{width:16,height:16,borderRadius:"50%",background:"#fff",position:"absolute",top:3,left:reducedUi?19:3,transition:"left .15s"}}/>
            </div>
          </div>
        </div>

        <button className="btn" style={{width:"100%",justifyContent:"center",background:C.red+"18",color:C.red,border:`1px solid ${C.red}33`,padding:"9px 0",borderRadius:9,fontWeight:600,marginBottom:8,fontSize:13}} onClick={()=>setChangePwOpen(true)}>
          🔐 পাসওয়ার্ড পরিবর্তন করুন
        </button>

        <div style={{display:"flex",gap:8,marginTop:4}}>
          <button className="btn" style={{flex:1,justifyContent:"center",background:C.border,color:C.muted,padding:"10px 0",borderRadius:9,fontWeight:600}} onClick={onClose}>বাতিল</button>
          <button className="btn bg" style={{flex:2,justifyContent:"center",padding:"10px 0",borderRadius:9,fontWeight:700,fontSize:14}} disabled={saving} onClick={save}>
            {saving?"⏳ সেভ হচ্ছে...":"💾 সেভ করুন"}
          </button>
        </div>
      </div>
    </div>
    {changePwOpen&&<ChangePasswordModal user={user} onClose={()=>setChangePwOpen(false)} push={push}/>}
    </>
  );
}

export { UserEditModal };
