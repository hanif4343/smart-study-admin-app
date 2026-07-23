/* ── Typing Passage সিম্পল আপলোডার — শুধু ভাষা + প্যাসেজ, লেভেল/টাইটেল লাগবে না ── */
import React, { useState } from "react";
import { GAS } from "../core/config.js";
import { nowTs } from "../core/utils.js";
import { loadSharedGasSecret } from "../core/uploaderUtils.js";

function TypingUploaderPage({push}){
  const[language,setLanguage]=useState("bn");
  const[content,setContent]=useState("");
  const[saving,setSaving]=useState(false);
  const gasSecret=loadSharedGasSecret();

  const submit=async()=>{
    if(!content.trim()){push("warn","প্যাসেজ লিখুন","");return;}
    if(!GAS){push("error","❌ GAS URL সেট করা নেই","VITE_GAS_URL env var চেক করো");return;}
    if(!gasSecret){push("error","❌ GAS Secret Key দাও","Save Location প্যানেলে Secret Key বসাও");return;}
    setSaving(true);
    try{
      const resp=await fetch(GAS,{method:"POST",headers:{"Content-Type":"text/plain"},
        body:JSON.stringify({secret:gasSecret,targetTab:"Typing",language,content,timestamp:nowTs()})});
      const data=await resp.json().catch(()=>({}));
      if(data.result==="success"){push("success","✅ প্যাসেজ সেভ হয়েছে",`ID: ${data.id}`);setContent("");}
      else push("error","ব্যর্থ",data.error||"অজানা সমস্যা");
    }catch(e){push("error","ব্যর্থ",e.message);}
    setSaving(false);
  };

  return(
    <div className="page">
      <div className="ftabs">
        {[["bn","🇧🇩 বাংলা"],["en","🇬🇧 English"]].map(([code,label])=>
          <button key={code} className={`ftab${language===code?" on":""}`} onClick={()=>setLanguage(code)}>{label}</button>
        )}
      </div>
      <div className="fld">
        <label>📄 প্যাসেজ</label>
        <textarea className="ta" value={content} onChange={e=>setContent(e.target.value)}
          style={{minHeight:260}} placeholder="টাইপিং প্যাসেজ এখানে লিখুন বা পেস্ট করুন..."/>
      </div>
      <button className="btn bg" disabled={saving||!content.trim()} onClick={submit}>
        {saving?"⏳ সেভ হচ্ছে...":"💾 সেভ করো"}
      </button>
    </div>
  );
}

export { TypingUploaderPage };
