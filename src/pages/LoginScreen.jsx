/* ══════════ LOGIN SCREEN ══════════ */
import React, { useState, useEffect } from "react";
import { _LC } from "../core/logger.js";
import { signInWithEmail, sendPasswordReset } from "../core/auth.js";

function LoginScreen({onLogin}){
  const[email,setEmail]=useState(localStorage.getItem("fb_email")||"");
  const[pass,setPass]=useState("");
  const[loading,setLoading]=useState(false);
  const[err,setErr]=useState("");
  const[info,setInfo]=useState("");
  const[resetting,setResetting]=useState(false);

  // Auto-login if saved credentials exist
  useEffect(()=>{
    const savedEmail=localStorage.getItem("fb_email");
    const savedPass=localStorage.getItem("fb_pass_enc");
    if(savedEmail&&savedPass){
      setLoading(true);
      _LC.auth("autoLogin", `Auto-login attempt: ${savedEmail}`);
      signInWithEmail(savedEmail,atob(savedPass))
        .then(()=>{ _LC.auth("autoLogin", `Auto-login SUCCESS: ${savedEmail}`); onLogin(); })
        .catch((e)=>{ _LC.error("autoLogin", `Auto-login FAILED: ${e?.message}`, { email: savedEmail }); localStorage.removeItem("fb_email");localStorage.removeItem("fb_pass_enc");setLoading(false); });
    } else {
      _LC.lifecycle("LoginScreen", "Login screen shown — no saved credentials");
    }
  },[]);

  const doLogin=async()=>{
    if(!email||!pass){setErr("Email ও Password দিন");_LC.warn("doLogin","Login attempted with empty fields");return;}
    setLoading(true);setErr("");
    try{
      await signInWithEmail(email,pass);
      _LC.auth("doLogin", `Manual login SUCCESS: ${email}`);
      onLogin();
    }catch(e){
      _LC.error("doLogin", `Manual login FAILED: ${e?.message}`, { email });
      setErr(e.message||"Login ব্যর্থ");setLoading(false);
    }
  };

  const resetErrMsg=(m)=>{
    if(m==="EMAIL_NOT_FOUND")return "এই Email দিয়ে কোনো অ্যাকাউন্ট নেই";
    if(m==="INVALID_EMAIL")return "Email সঠিক নয়";
    if(m==="NETWORK_ERROR")return "ইন্টারনেট সংযোগ নেই, আবার চেষ্টা করুন";
    if(String(m).startsWith("TOO_MANY_ATTEMPTS"))return "অনেকবার চেষ্টা হয়েছে, কিছুক্ষণ পরে আবার করুন";
    return m||"Reset ব্যর্থ";
  };

  const doReset=async()=>{
    const em=email.trim();
    if(!em){setInfo("");setErr("উপরে আপনার Email লিখুন, তারপর 'পাসওয়ার্ড ভুলে গেছেন?' চাপুন");return;}
    setResetting(true);setErr("");setInfo("");
    try{
      await sendPasswordReset(em);
      setInfo(`✅ ${em} এ Password Reset লিংক পাঠানো হয়েছে। Inbox (ও Spam) চেক করে নতুন পাসওয়ার্ড দিন, তারপর লগইন করুন।`);
    }catch(e){
      setErr(resetErrMsg(e.message));
    }
    setResetting(false);
  };

  return(
    <div style={{minHeight:"100dvh",display:"flex",alignItems:"center",justifyContent:"center",background:"#06080f",padding:24}}>
      <div style={{width:"100%",maxWidth:360}}>
        <div style={{textAlign:"center",marginBottom:32}}>
          <div style={{fontSize:42,marginBottom:8}}>📊</div>
          <div style={{fontSize:20,fontWeight:700,color:"#e2e8f0"}}>Smart Study Admin</div>
          <div style={{fontSize:12,color:"#4b5e7a",marginTop:4}}>Firebase অ্যাডমিন প্যানেল</div>
        </div>
        <div style={{background:"#0c1220",border:"1px solid #16253d",borderRadius:16,padding:20}}>
          <div style={{marginBottom:12}}>
            <label style={{display:"block",fontSize:10,fontWeight:700,color:"#4b5e7a",letterSpacing:".8px",marginBottom:4,textTransform:"uppercase"}}>Email</label>
            <input
              style={{background:"#0e1a2e",border:"1px solid #16253d",borderRadius:9,padding:"10px 12px",color:"#e2e8f0",fontFamily:"inherit",fontSize:13,width:"100%",outline:"none",boxSizing:"border-box"}}
              type="email" placeholder="admin@example.com"
              value={email} onChange={e=>setEmail(e.target.value)}
              onKeyDown={e=>e.key==="Enter"&&doLogin()}
            />
          </div>
          <div style={{marginBottom:16}}>
            <label style={{display:"block",fontSize:10,fontWeight:700,color:"#4b5e7a",letterSpacing:".8px",marginBottom:4,textTransform:"uppercase"}}>Password</label>
            <input
              style={{background:"#0e1a2e",border:"1px solid #16253d",borderRadius:9,padding:"10px 12px",color:"#e2e8f0",fontFamily:"inherit",fontSize:13,width:"100%",outline:"none",boxSizing:"border-box"}}
              type="password" placeholder="••••••••"
              value={pass} onChange={e=>setPass(e.target.value)}
              onKeyDown={e=>e.key==="Enter"&&doLogin()}
            />
          </div>
          {info&&<div style={{background:"#22c55e18",border:"1px solid #22c55e30",borderRadius:8,padding:"8px 12px",fontSize:11,color:"#22c55e",marginBottom:12,fontWeight:600,lineHeight:1.5}}>{info}</div>}
          {err&&<div style={{background:"#ef444418",border:"1px solid #ef444430",borderRadius:8,padding:"8px 12px",fontSize:11,color:"#ef4444",marginBottom:12,fontWeight:600}}>{err}</div>}
          <button
            onClick={doLogin} disabled={loading}
            style={{width:"100%",padding:"11px",background:"#3b82f6",color:"#fff",border:"none",borderRadius:9,fontSize:13,fontWeight:700,cursor:"pointer",opacity:loading?0.6:1}}
          >{loading?"⏳ লগইন হচ্ছে...":"🔐 লগইন করুন"}</button>
          <div style={{textAlign:"center",marginTop:12}}>
            <button
              onClick={doReset} disabled={resetting||loading}
              style={{background:"none",border:"none",color:"#60a5fa",fontSize:12,fontWeight:600,cursor:"pointer",textDecoration:"underline",opacity:resetting?0.6:1,fontFamily:"inherit"}}
            >{resetting?"⏳ পাঠানো হচ্ছে...":"পাসওয়ার্ড ভুলে গেছেন?"}</button>
          </div>
        </div>
      </div>
    </div>
  );
}


export { LoginScreen };
