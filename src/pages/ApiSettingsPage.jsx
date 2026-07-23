/* ══════════ API SETTINGS PAGE ══════════ */
import React from "react";
import { C } from "../core/config.js";
import { loadProviders, saveProviders, callAiProvider } from "../core/ocrProviders.js";

function ApiSettingsPage({push,inline=false}){
  const[providers,setProviders]=React.useState(loadProviders);
  const[editing,setEditing]=React.useState(null);
  const[keyInput,setKeyInput]=React.useState("");
  const[testing,setTesting]=React.useState(null);
  const[showKey,setShowKey]=React.useState({});
  const active=providers.filter(p=>p.active&&p.key);
  const totalKeys=active.reduce((sum,p)=>sum+p.key.split(",").map(k=>k.trim()).filter(Boolean).length,0);

  const doToggleActive=(id)=>{
    const upd=providers.map(p=>p.id===id?{...p,active:!p.active&&!!p.key}:p);
    setProviders(upd);saveProviders(upd);
    const p=upd.find(x=>x.id===id);
    push("success",p.active?"✅ Active করা হয়েছে!":"Inactive করা হয়েছে","OCR-এর পর rotation-এ ব্যবহার হবে");
  };
  const doSaveKey=(id)=>{
    const upd=providers.map(p=>p.id===id?{...p,key:keyInput.trim()}:p);
    setProviders(upd);saveProviders(upd);setEditing(null);setKeyInput("");
    push("success","✅ Key সেভ হয়েছে!","এখন Active করুন");
  };
  const doDelete=(id)=>{
    const upd=providers.map(p=>p.id===id?{...p,key:"",active:false}:p);
    setProviders(upd);saveProviders(upd);
    push("warn","Key মুছে দেওয়া হয়েছে","");
  };
  const doTest=async(p)=>{
    if(!p.key){push("warn","আগে Key দিন","");return;}
    setTesting(p.id);
    try{
      const tmp=[...providers].map(x=>({...x,active:x.id===p.id}));
      saveProviders(tmp);
      const r=await callAiProvider("১. বাংলাদেশের রাজধানী কোনটি?\nক. ঢাকা খ. চট্টগ্রাম গ. খুলনা ঘ. রাজশাহী উ. ক");
      saveProviders(providers);
      if(r&&r.includes(";")) push("success","✅ "+p.name+" কাজ করছে!",r.substring(0,80));
      else push("warn","⚠️ Response অদ্ভুত",(r||"empty").substring(0,60));
    }catch(e){push("error","❌ "+p.name+" ব্যর্থ",e.message);saveProviders(providers);}
    setTesting(null);
  };

  return(
    <div className={inline?"":"page"} style={inline?{marginBottom:14}:{}}>
      {!inline&&<div style={{background:"linear-gradient(135deg,#0f172a,#1e3a5f)",borderRadius:14,
        padding:"14px 16px",marginBottom:14,color:"#fff"}}>
        <div style={{fontWeight:900,fontSize:16}}>🔑 API Key Settings</div>
        <div style={{fontSize:11,opacity:.8,marginTop:2}}>OCR-এর পর auto parse — একাধিক provider active রাখলে rotation+fallback হবে</div>
      </div>}
      <div style={{background:active.length?"#052e16":"#450a0a",borderRadius:10,
        padding:"10px 14px",marginBottom:12,
        border:"1px solid "+(active.length?"#16a34a":"#991b1b")}}>
        {active.length
          ?<span style={{color:"#4ade80",fontWeight:700}}>✅ {active.length}টা provider active — মোট {totalKeys}টা key (rotation pool)</span>
          :<span style={{color:"#f87171",fontWeight:700}}>⚠️ কোনো provider active নেই — নিচে key দিয়ে Active করুন</span>}
      </div>
      {providers.map(p=>(
        <div key={p.id} style={{background:C.card,borderRadius:12,marginBottom:10,
          border:"2px solid "+(p.active?"#6366f1":C.border),overflow:"hidden"}}>
          <div style={{padding:"12px 14px",display:"flex",alignItems:"center",gap:10}}>
            <span style={{fontSize:22}}>{p.icon}</span>
            <div style={{flex:1}}>
              <div style={{fontWeight:800,color:C.text,fontSize:14}}>{p.name}</div>
              <div style={{fontSize:10,color:C.sub}}>{p.limit}</div>
            </div>
            {p.active&&p.key&&<span style={{background:"#4f46e5",color:"#fff",fontSize:10,
              fontWeight:700,borderRadius:999,padding:"2px 8px"}}>ACTIVE</span>}
          </div>
          <div style={{padding:"0 14px 12px"}}>
            {editing===p.id?(
              <div>
                <div style={{fontSize:11,color:C.sub,marginBottom:4}}>{p.keyHint}</div>
                <div style={{fontSize:10,color:C.muted,marginBottom:4}}>একাধিক key হলে কমা (,) দিয়ে আলাদা করে দাও — যেমন key1,key2</div>
                <input style={{width:"100%",background:C.input,border:"1px solid "+C.border,
                  borderRadius:8,padding:"8px 10px",color:C.text,fontSize:12,
                  fontFamily:"monospace",boxSizing:"border-box",marginBottom:6}}
                  placeholder={p.name+" API Key (কমা দিয়ে একাধিক)"}
                  value={keyInput} onChange={e=>setKeyInput(e.target.value)} autoFocus/>
                <div style={{display:"flex",gap:6}}>
                  <button onClick={()=>doSaveKey(p.id)} style={{flex:1,background:"#4f46e5",
                    color:"#fff",border:"none",borderRadius:8,padding:8,fontWeight:700,fontSize:12}}>
                    💾 Save</button>
                  <button onClick={()=>{setEditing(null);setKeyInput("");}}
                    style={{background:C.border,color:C.text,border:"none",borderRadius:8,padding:"8px 12px",fontSize:12}}>
                    বাতিল</button>
                </div>
              </div>
            ):p.key?(
              <div>
                <div style={{background:C.input,borderRadius:8,padding:"7px 10px",
                  marginBottom:8,display:"flex",alignItems:"center",gap:6}}>
                  <span style={{flex:1,fontFamily:"monospace",fontSize:11,color:C.sub,wordBreak:"break-all"}}>
                    {showKey[p.id]?p.key:p.key.substring(0,8)+"••••••••••••"+p.key.slice(-4)}</span>
                  <button onClick={()=>setShowKey(v=>({...v,[p.id]:!v[p.id]}))}
                    style={{background:"none",border:"none",color:C.sub,fontSize:14,cursor:"pointer"}}>
                    {showKey[p.id]?"🙈":"👁️"}</button>
                </div>
                <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                  <button onClick={()=>doToggleActive(p.id)}
                    style={{flex:1,background:p.active?"#065f46":"#4f46e5",color:"#fff",border:"none",
                      borderRadius:8,padding:7,fontWeight:700,fontSize:12}}>{p.active?"✅ Active (চালু আছে)":"⚡ Active করো"}</button>
                  <button onClick={()=>doTest(p)} disabled={!!testing}
                    style={{flex:1,background:"#065f46",color:"#fff",border:"none",
                      borderRadius:8,padding:7,fontWeight:700,fontSize:12}}>
                    {testing===p.id?"⏳...":"🧪 Test"}</button>
                  <button onClick={()=>{setEditing(p.id);setKeyInput(p.key);}}
                    style={{background:C.border,color:C.text,border:"none",borderRadius:8,padding:"7px 10px",fontSize:12}}>✏️</button>
                  <button onClick={()=>doDelete(p.id)}
                    style={{background:"#450a0a",color:"#f87171",border:"none",borderRadius:8,padding:"7px 10px",fontSize:12}}>🗑️</button>
                </div>
              </div>
            ):(
              <div>
                <div style={{fontSize:11,color:C.sub,marginBottom:6}}>{p.keyHint}</div>
                <button onClick={()=>{setEditing(p.id);setKeyInput("");}}
                  style={{width:"100%",background:"#1e3a5f",color:"#93c5fd",border:"none",
                    borderRadius:8,padding:8,fontWeight:700,fontSize:12}}>🔑 Key যোগ করুন</button>
              </div>
            )}
          </div>
        </div>
      ))}
      <div style={{background:C.card,borderRadius:10,padding:"12px 14px",
        border:"1px solid "+C.border,fontSize:11,color:C.sub,lineHeight:1.8}}>
        <div style={{fontWeight:700,color:C.text,marginBottom:4}}>💡 কীভাবে কাজ করে</div>
        <div>📸 ছবি → MLKit text বের করে → active provider-গুলোর pool থেকে rotation করে parse করে</div>
        <div>✅ শুধু text যায়, image নয় → load নেই, fast</div>
        <div>🔄 একটা key/provider ব্যর্থ হলে পরেরটা অটো ট্রাই হয়</div>
        <div>🔄 Key চেঞ্জ করলে rebuild লাগে না</div>
        <div>🔒 Key device-এ localStorage-এ সংরক্ষিত</div>
        <div>⚡ কোনো provider active না থাকলে local Java parser ব্যবহার হয়</div>
      </div>
    </div>
  );
}

export { ApiSettingsPage };
