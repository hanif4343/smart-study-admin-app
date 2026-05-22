import { useState, useEffect, useCallback, useRef, useMemo } from "react";

/* ══════════ CONFIG ══════════ */
const FB  = "https://smartentrydb-default-rtdb.firebaseio.com";
const FBK = "CsFdxaWLLU2AT92kxYFPTOhP1ewDR0jzK3hKjqWO";
const GAS = "https://script.google.com/macros/s/AKfycbyjF7iFX0H_rFuJgMJYo70DC7KRX1lBXU7m7NoZCwf6VTJfRm6Iyw6hOcN2q_UKbxxgQg/exec";
const IMGBB = "3f23d9fd6bdfdb694285773f40569906";

const C={bg:"#06080f",card:"#0c1220",border:"#16253d",accent:"#3b82f6",green:"#22c55e",red:"#ef4444",yellow:"#f59e0b",purple:"#8b5cf6",text:"#e2e8f0",muted:"#4b5e7a",panel:"#0e1a2e",navBg:"#080f1c"};

/* ══════════ FIREBASE ══════════ */
const fbGet  = async p => { const r=await fetch(`${FB}/${p}.json?auth=${FBK}`); return r.json(); };
const fbPatch= async(p,d)=>{ const r=await fetch(`${FB}/${p}.json?auth=${FBK}`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify(d)}); return r.json(); };
const fbSet  = async(p,d)=>{ const r=await fetch(`${FB}/${p}.json?auth=${FBK}`,{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify(d)}); return r.json(); };
const fbPush = async(p,d)=>{ const r=await fetch(`${FB}/${p}.json?auth=${FBK}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(d)}); return r.json(); };

/* ══════════ GAS helpers ══════════ */
const gasBg = params => setTimeout(()=>fetch(GAS+"?"+new URLSearchParams(params)).catch(()=>{}),300);
const gasPost= body   => setTimeout(()=>fetch(GAS,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)}).catch(()=>{}),300);
const gasCall= async params =>{ const r=await fetch(GAS+"?"+new URLSearchParams(params)); return r.json(); };

/* ══════════ CACHE ══════════ */
const _cache={}, _subs={}, _fly={};
const STALE=60_000;

async function fbCached(path,force=false){
  if(!force&&_cache[path]&&Date.now()-_cache[path].ts<STALE) return _cache[path].data;
  if(_fly[path]) return _fly[path];
  _fly[path]=fbGet(path).then(d=>{
    _cache[path]={data:d,ts:Date.now()};
    (_subs[path]||new Set()).forEach(cb=>cb(d));
    delete _fly[path]; return d;
  }).catch(e=>{delete _fly[path]; throw e;});
  return _fly[path];
}

const fbInv=(...ps)=>ps.forEach(p=>{delete _cache[p];});

// FIXED: useFB — path must be stable string, no dynamic computation inside hook
function useFB(path, tick=0){
  const[data,set]=useState(()=>_cache[path]?.data??null);
  const[loading,setL]=useState(!_cache[path]);
  const prev=useRef(0);
  useEffect(()=>{
    if(!path){setL(false);return;}
    if(!_subs[path])_subs[path]=new Set();
    const cb=d=>{set(d);setL(false);};
    _subs[path].add(cb);
    const force=tick>prev.current; prev.current=tick;
    const s=_cache[path]?.data;
    if(s&&!force){set(s);setL(false);fbCached(path,false).catch(()=>{});}
    else{if(!s)setL(true);fbCached(path,force).catch(()=>setL(false));}
    return()=>_subs[path]?.delete(cb);
  },[path,tick]);
  return{data,loading};
}

/* ══════════ HELPERS ══════════ */
const fmt=n=>(n||0).toLocaleString();
const pct=(a,b)=>b?Math.round(a/b*100):0;
const initials=n=>(n||"?").split(" ").map(w=>w[0]).join("").toUpperCase().slice(0,2);
const nowTs=()=>new Date().toLocaleString("bn-BD",{timeZone:"Asia/Dhaka"});
const timeAgo=ts=>{
  if(!ts)return"—";
  try{
    const d=new Date(ts.replace?ts.replace(/(\d{2})-(\d{2})-(\d{4})/,"$3-$2-$1"):ts);
    const s=Date.now()-d.getTime();
    if(s<60000)return"এখনই";
    if(s<3600000)return~~(s/60000)+"মি আগে";
    if(s<86400000)return~~(s/3600000)+"ঘণ্টা আগে";
    return~~(s/86400000)+"দিন আগে";
  }catch{return ts;}
};
const toArr=raw=>{
  if(!raw)return[];
  if(Array.isArray(raw))return raw.filter(Boolean);
  return Object.entries(raw).map(([k,v])=>v?{...v,_fbKey:k}:null).filter(Boolean);
};
const phoneKey=ph=>(ph||"").replace(/^'+/,"").trim().replace(/[.#$\[\]\s]/g,"_");
const matchPhone=(key,phone)=>{
  const k=key.replace(/_/g,"");
  const p=(phone||"").replace(/[.#$\[\]\s]/g,"");
  return k===p||k===p.replace(/^0+/,"")||k.replace(/^0+/,"")===p.replace(/^0+/,"");
};
const uploadImg=async file=>{
  const fd=new FormData();fd.append("image",file);
  const r=await fetch(`https://api.imgbb.com/1/upload?key=${IMGBB}`,{method:"POST",body:fd});
  return(await r.json())?.data?.url||"";
};

/* ══════════ TOAST ══════════ */
let _tid=0;
function useToasts(){
  const[t,set]=useState([]);
  const push=useCallback((type,title,msg="")=>{
    const id=++_tid;set(p=>[...p,{id,type,title,msg}]);
    setTimeout(()=>set(p=>p.filter(x=>x.id!==id)),4000);
  },[]);
  return[t,push];
}
function Toasts({t}){return(
  <div className="toasts">
    {t.map(x=>(
      <div key={x.id} className={`toast ${x.type}`}>
        <div className="t-icon">{x.type==="success"?"✅":x.type==="error"?"❌":x.type==="warn"?"⚠️":"ℹ️"}</div>
        <div className="t-body"><div className="t-title">{x.title}</div>{x.msg&&<div className="t-msg">{x.msg}</div>}</div>
      </div>
    ))}
  </div>
);}

/* ══════════ CSS ══════════ */
const css=`
@import url('https://fonts.googleapis.com/css2?family=Noto+Sans+Bengali:wght@400;500;600;700&family=Space+Grotesk:wght@400;500;600;700&display=swap');
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
html,body,#root{background:${C.bg};color:${C.text};font-family:'Noto Sans Bengali','Space Grotesk',sans-serif;min-height:100dvh;max-width:480px;margin:0 auto;overflow-x:hidden}
::-webkit-scrollbar{width:3px}::-webkit-scrollbar-thumb{background:${C.border};border-radius:10px}
.bottom-nav{position:fixed;bottom:0;left:50%;transform:translateX(-50%);width:100%;max-width:480px;background:${C.navBg};border-top:1px solid ${C.border};display:flex;z-index:100;padding-bottom:env(safe-area-inset-bottom,8px)}
.nav-btn{flex:1;display:flex;flex-direction:column;align-items:center;gap:2px;padding:8px 2px 6px;cursor:pointer;border:none;background:transparent;color:${C.muted};font-family:inherit;font-size:9px;font-weight:500;transition:color .15s;position:relative}
.nav-btn.active{color:${C.accent}}.nav-icon{font-size:18px;line-height:1}
.nav-badge{position:absolute;top:5px;right:calc(50% - 16px);background:${C.red};color:#fff;font-size:8px;font-weight:700;width:14px;height:14px;border-radius:50%;display:flex;align-items:center;justify-content:center}
.topbar{background:${C.card};border-bottom:1px solid ${C.border};padding:12px 16px 10px;display:flex;align-items:center;justify-content:space-between;position:sticky;top:0;z-index:50}
.topbar-title{font-size:15px;font-weight:700}.topbar-sub{font-size:10px;color:${C.muted};margin-top:1px}
.icon-btn{width:34px;height:34px;border-radius:9px;background:${C.panel};border:1px solid ${C.border};color:${C.text};font-size:16px;display:flex;align-items:center;justify-content:center;cursor:pointer}
.icon-btn.spin{animation:spin 1s linear infinite}
.page{padding:13px;padding-bottom:82px;min-height:100dvh}
.sg{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px}
.sc{background:${C.card};border:1px solid ${C.border};border-radius:13px;padding:12px;position:relative;overflow:hidden}
.sc::after{content:attr(data-icon);position:absolute;right:8px;bottom:6px;font-size:24px;opacity:.12}
.sl{font-size:10px;color:${C.muted};font-weight:600;margin-bottom:4px;text-transform:uppercase;letter-spacing:.5px}
.sv{font-size:24px;font-weight:700;line-height:1}
.sv-b{color:${C.accent}}.sv-g{color:${C.green}}.sv-r{color:${C.red}}.sv-y{color:${C.yellow}}.sv-p{color:${C.purple}}
.tb{border-top:2px solid ${C.accent}}.tg{border-top:2px solid ${C.green}}.tr{border-top:2px solid ${C.red}}.ty{border-top:2px solid ${C.yellow}}.tp{border-top:2px solid ${C.purple}}
.card{background:${C.card};border:1px solid ${C.border};border-radius:13px;padding:13px;margin-bottom:10px}
.ct{font-size:11px;font-weight:700;color:${C.muted};text-transform:uppercase;letter-spacing:.8px;margin-bottom:11px}
.av{width:38px;height:38px;border-radius:50%;background:linear-gradient(135deg,${C.accent},${C.purple});display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;color:#fff;flex-shrink:0}
.av.sm{width:30px;height:30px;font-size:11px}
.pill{display:inline-flex;align-items:center;padding:2px 8px;border-radius:20px;font-size:10px;font-weight:700;white-space:nowrap;flex-shrink:0}
.pa{background:#22c55e18;color:${C.green};border:1px solid #22c55e33}
.pi{background:#ef444418;color:${C.red};border:1px solid #ef444433}
.pp{background:#f59e0b18;color:${C.yellow};border:1px solid #f59e0b33}
.btn{display:inline-flex;align-items:center;gap:4px;padding:7px 12px;border-radius:9px;font-size:12px;font-weight:600;font-family:inherit;cursor:pointer;border:none;transition:all .15s;white-space:nowrap}
.btn:active{transform:scale(.96)}.btn:disabled{opacity:.45;pointer-events:none}
.bp{background:${C.accent};color:#fff}.bs{background:#22c55e20;color:${C.green};border:1px solid #22c55e40}
.bs:not(:disabled):hover{background:${C.green};color:#fff}
.bg{background:transparent;color:${C.muted};border:1px solid ${C.border}}.bg:hover{background:${C.border};color:${C.text}}
.bb{width:100%;justify-content:center;padding:10px}
.inp,.ta{background:${C.panel};border:1px solid ${C.border};border-radius:9px;padding:9px 12px;color:${C.text};font-family:inherit;font-size:13px;width:100%;outline:none;transition:border-color .2s;-webkit-appearance:none}
.inp:focus,.ta:focus{border-color:${C.accent}}.inp::placeholder,.ta::placeholder{color:${C.muted}}
.ta{resize:vertical;min-height:75px}.fld{margin-bottom:10px}
.fld label{display:block;font-size:10px;font-weight:700;color:${C.muted};letter-spacing:.8px;margin-bottom:4px;text-transform:uppercase}
.sw{position:relative;margin-bottom:10px}.sw .si{position:absolute;left:10px;top:50%;transform:translateY(-50%);font-size:14px;pointer-events:none}.sw .inp{padding-left:32px}
.ftabs{display:flex;gap:5px;margin-bottom:11px;overflow-x:auto;padding-bottom:2px;scrollbar-width:none}.ftabs::-webkit-scrollbar{display:none}
.ftab{flex-shrink:0;padding:6px 12px;border-radius:20px;font-size:11px;font-weight:600;cursor:pointer;border:1px solid ${C.border};background:transparent;color:${C.muted};font-family:inherit;transition:all .15s}
.ftab.on{background:${C.accent};color:#fff;border-color:${C.accent}}
.rc{background:${C.panel};border:1px solid ${C.border};border-radius:11px;padding:11px;margin-bottom:8px}
.ri{font-size:12px;color:${C.text};line-height:1.5;background:${C.card};border-radius:7px;padding:7px 9px;margin-top:7px;border-left:2px solid ${C.red}}
.rm{font-size:10px;color:${C.muted};margin-top:4px;display:flex;gap:6px;flex-wrap:wrap}
.ovl{position:fixed;inset:0;background:#00000094;z-index:200;display:flex;align-items:flex-end}
.modal{background:${C.card};border:1px solid ${C.border};border-radius:20px 20px 0 0;padding:16px 16px 36px;width:100%;max-height:88dvh;overflow-y:auto;animation:su .22s ease}
.mh{width:32px;height:4px;background:${C.border};border-radius:4px;margin:0 auto 13px}
.mt{font-size:15px;font-weight:700;margin-bottom:13px}
.fs{position:fixed;inset:0;background:${C.bg};z-index:150;overflow-y:auto}
.fsh{background:${C.card};border-bottom:1px solid ${C.border};padding:12px 14px;display:flex;align-items:center;gap:11px;position:sticky;top:0;z-index:10}
.bk{width:32px;height:32px;border-radius:8px;background:${C.panel};border:1px solid ${C.border};color:${C.text};font-size:15px;display:flex;align-items:center;justify-content:center;cursor:pointer;flex-shrink:0}
.sk{background:linear-gradient(90deg,${C.border},#1a2840,${C.border});background-size:200% 100%;animation:shim 1.4s infinite;border-radius:9px;height:64px;margin-bottom:8px}
.empty{text-align:center;padding:40px 20px;color:${C.muted}}.ei{font-size:36px;margin-bottom:8px;opacity:.25}
.toasts{position:fixed;top:13px;left:50%;transform:translateX(-50%);width:calc(100% - 26px);max-width:440px;z-index:999;display:flex;flex-direction:column;gap:6px;pointer-events:none}
.toast{background:${C.card};border:1px solid ${C.border};border-radius:11px;padding:10px 12px;display:flex;gap:8px;align-items:flex-start;animation:ti .25s ease;box-shadow:0 8px 28px #00000080;pointer-events:all}
.toast.success{border-left:3px solid ${C.green}}.toast.error{border-left:3px solid ${C.red}}.toast.warn{border-left:3px solid ${C.yellow}}.toast.info{border-left:3px solid ${C.accent}}
.t-icon{font-size:16px}.t-body{flex:1}.t-title{font-size:12px;font-weight:700}.t-msg{font-size:11px;color:${C.muted};margin-top:1px}
.atabs{display:flex;background:${C.panel};border-radius:10px;padding:3px;margin-bottom:11px;gap:3px}
.atab{flex:1;text-align:center;padding:7px 3px;border-radius:7px;font-size:11px;font-weight:600;cursor:pointer;border:none;background:transparent;color:${C.muted};font-family:inherit;transition:all .2s}
.atab.on{background:${C.card};color:${C.text};box-shadow:0 2px 6px #00000040}
.srow{display:flex;align-items:center;justify-content:space-between;padding:8px 0;border-bottom:1px solid ${C.border}40;font-size:12px}.srow:last-child{border-bottom:none}
.sbar{height:3px;border-radius:3px;background:${C.border};flex:1;margin:3px 6px 0 0;overflow:hidden}.sbar-f{height:100%;border-radius:3px;transition:width .6s ease}
.slb{font-size:10px;font-weight:700;color:${C.muted};letter-spacing:1.2px;text-transform:uppercase;margin:14px 0 8px}
.nr{display:flex;gap:8px;align-items:flex-start;padding:9px 0;border-bottom:1px solid ${C.border}40}.nr:last-child{border-bottom:none}
.nd{width:7px;height:7px;border-radius:50%;margin-top:4px;flex-shrink:0}.nd.n{background:${C.accent}}.nd.o{background:${C.muted}}
.nc{flex:1}.nt{font-size:12px;font-weight:600}.ns{font-size:11px;color:${C.muted};margin-top:1px}.ntm{font-size:10px;color:${C.muted};white-space:nowrap}
.steps{display:flex;margin-bottom:16px}.step{flex:1;text-align:center;font-size:10px;font-weight:700;padding:5px 2px;border-bottom:2px solid ${C.border};color:${C.muted};transition:all .2s}
.step.done{border-color:${C.green};color:${C.green}}.step.act{border-color:${C.accent};color:${C.accent}}
.bc{display:flex;align-items:flex-end;gap:2px;height:64px;margin-top:5px}
.bcol{display:flex;flex-direction:column;align-items:center;flex:1;gap:2px}
.brect{width:100%;border-radius:3px 3px 0 0;min-height:2px}.blbl{font-size:7px;color:${C.muted};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:26px;text-align:center}
.sri{display:flex;align-items:center;gap:9px;padding:9px;background:${C.panel};border:1px solid ${C.border};border-radius:10px;margin-bottom:6px;cursor:pointer;transition:border-color .15s}.sri:hover{border-color:${C.accent}}
.stag{font-size:9px;font-weight:700;padding:2px 6px;border-radius:7px;background:${C.accent}20;color:${C.accent};flex-shrink:0}
.rw{position:relative;width:68px;height:68px;flex-shrink:0}.rw svg{transform:rotate(-90deg)}
.rpct{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700}
.tp2{padding:6px 14px;border-radius:20px;font-size:11px;font-weight:700;cursor:pointer;border:1px solid ${C.border};background:transparent;color:${C.muted};font-family:inherit;transition:all .15s;flex-shrink:0}
.tp2.on{background:${C.accent};color:#fff;border-color:${C.accent}}
.cc{padding:4px 10px;border-radius:8px;font-size:11px;font-weight:700;cursor:pointer;border:1px solid ${C.border};background:transparent;color:${C.muted};font-family:inherit;transition:all .15s;white-space:nowrap}
.cc.on{background:${C.green}20;color:${C.green};border-color:${C.green}40}
@keyframes spin{to{transform:rotate(360deg)}}
@keyframes su{from{transform:translateY(36px);opacity:0}to{transform:translateY(0);opacity:1}}
@keyframes shim{0%{background-position:-200% 0}100%{background-position:200% 0}}
@keyframes ti{from{transform:translateY(-16px);opacity:0}to{transform:translateY(0);opacity:1}}
`;

/* ══════════ MINI COMPONENTS ══════════ */
function Ring({val,max,color}){
  const r=26,c2=2*Math.PI*r,p=max?Math.min(100,Math.round(val/max*100)):0;
  return(
    <div className="rw">
      <svg width="68" height="68" viewBox="0 0 68 68">
        <circle cx="34" cy="34" r={r} fill="none" stroke={C.border} strokeWidth="6"/>
        <circle cx="34" cy="34" r={r} fill="none" stroke={color} strokeWidth="6"
          strokeDasharray={`${c2*p/100} ${c2}`} strokeLinecap="round"/>
      </svg>
      <div className="rpct" style={{color}}>{p}%</div>
    </div>
  );
}

function Bar({data,color}){
  if(!data?.length)return null;
  const mx=Math.max(...data.map(d=>d.v),1);
  return(
    <div className="bc">
      {data.map((d,i)=>(
        <div key={i} className="bcol">
          <div className="brect" style={{height:(d.v/mx*58)+"px",background:color,opacity:.85}}/>
          <div className="blbl">{d.l}</div>
        </div>
      ))}
    </div>
  );
}

function Tree({entries,total,color}){
  const[open,setO]=useState({});
  const tog=k=>setO(p=>({...p,[k]:!p[k]}));
  return(
    <>
      {entries.map(([sub,v])=>{
        const tops=Object.entries(v.topics||{});
        return(
          <div key={sub} style={{marginBottom:7}}>
            <div style={{display:"flex",alignItems:"center",padding:"8px 0",borderBottom:`1px solid ${C.border}40`,cursor:tops.length?"pointer":"default"}} onClick={()=>tops.length&&tog(sub)}>
              <div style={{flex:1}}>
                <div style={{fontWeight:700,fontSize:12,display:"flex",alignItems:"center",gap:4}}>
                  {tops.length>0&&<span style={{fontSize:9,color:C.muted,display:"inline-block",transform:open[sub]?"rotate(90deg)":"none",transition:"transform .2s"}}>▶</span>}
                  {sub}
                </div>
                <div style={{display:"flex",alignItems:"center",marginTop:3}}><div className="sbar"><div className="sbar-f" style={{width:pct(v.total,total)+"%",background:color}}/></div></div>
                <div style={{fontSize:9,color:C.muted,marginTop:1}}>MCQ:{v.mcq||0} · Written:{v.written||0}{tops.length?` · ${tops.length}টি Topic`:""}</div>
              </div>
              <div style={{fontWeight:700,color,fontSize:16,minWidth:32,textAlign:"right"}}>{v.total}</div>
            </div>
            {open[sub]&&tops.map(([tp,tv])=>{
              const sts=Object.entries(tv.subtopics||{});
              const tk=sub+"_"+tp;
              return(
                <div key={tp} style={{marginLeft:12,borderLeft:`2px solid ${color}30`}}>
                  <div style={{display:"flex",alignItems:"center",padding:"6px 0 6px 9px",cursor:sts.length?"pointer":"default"}} onClick={()=>sts.length&&tog(tk)}>
                    <div style={{flex:1,fontSize:11,fontWeight:600,display:"flex",alignItems:"center",gap:3}}>
                      {sts.length>0&&<span style={{fontSize:8,color:C.muted,display:"inline-block",transform:open[tk]?"rotate(90deg)":"none",transition:"transform .2s"}}>▶</span>}
                      📂 {tp}
                    </div>
                    <div style={{fontWeight:700,color,fontSize:13,minWidth:28,textAlign:"right"}}>{tv.total}</div>
                  </div>
                  {open[tk]&&sts.map(([st,sv])=>(
                    <div key={st} style={{display:"flex",alignItems:"center",padding:"5px 0 5px 18px",borderBottom:`1px solid ${C.border}20`}}>
                      <div style={{flex:1}}><div style={{fontSize:10}}>📄 {st}</div><div style={{fontSize:9,color:C.muted}}>MCQ:{sv.mcq||0} · Written:{sv.written||0}</div></div>
                      <div style={{fontWeight:600,color:C.muted,fontSize:12,minWidth:26,textAlign:"right"}}>{sv.total}</div>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        );
      })}
    </>
  );
}

function buildSubjectMap(raw){
  const map={};
  toArr(raw).forEach(q=>{
    const sub=(q.Subject||q.subject||"Unknown").trim();
    const typ=(q.QType||q.qtype||"MCQ").toLowerCase();
    const st=(q.Sub_topic||q.sub_topic||"General").trim();
    const parts=st.includes(" > ")?st.split(" > "):[st,st];
    const top=parts[0].trim()||"General";
    const stF=parts.length>1?parts[1].trim():st;
    const isWr=typ==="written";
    if(!map[sub])map[sub]={total:0,mcq:0,written:0,topics:{}};
    map[sub].total++;if(isWr)map[sub].written++;else map[sub].mcq++;
    if(!map[sub].topics[top])map[sub].topics[top]={total:0,subtopics:{}};
    map[sub].topics[top].total++;
    if(!map[sub].topics[top].subtopics[stF])map[sub].topics[top].subtopics[stF]={total:0,mcq:0,written:0};
    map[sub].topics[top].subtopics[stF].total++;
    if(isWr)map[sub].topics[top].subtopics[stF].written++;else map[sub].topics[top].subtopics[stF].mcq++;
  });
  return map;
}

/* ══════════ DASHBOARD ══════════ */
function DashboardPage({push,tick}){
  const{data:users}     = useFB("Users",tick);
  const{data:quiz}      = useFB("Quiz",tick);
  const{data:qbank}     = useFB("QBank",tick);
  const{data:study}     = useFB("Study",tick);
  const{data:reports}   = useFB("Reports",tick);
  const{data:summary}   = useFB("Analytics/Summary",tick);
  const[atab,setAtab]   = useState("quiz");

  const userArr = toArr(users);
  const total   = userArr.length;
  const active  = userArr.filter(u=>(u.Status||u.status||"").toLowerCase()==="active").length;

  const quizMap  = useMemo(()=>buildSubjectMap(quiz),[quiz]);
  const qbankMap = useMemo(()=>buildSubjectMap(qbank),[qbank]);
  const quizT  = toArr(quiz).length;
  const qbT    = toArr(qbank).length;
  const stT    = toArr(study).length;
  const rptT   = toArr(reports).length;

  const days=useMemo(()=>[...Array(7)].map((_,i)=>{
    const d=new Date();d.setDate(d.getDate()-(6-i));
    const lbl=`${d.getDate()}/${d.getMonth()+1}`;
    const cnt=summary&&typeof summary==="object"
      ?Object.values(summary).filter(u=>{try{return new Date(u.lastActive||"").toDateString()===d.toDateString();}catch{return false;}}).length:0;
    return{l:lbl,v:cnt};
  }),[summary]);

  if(!users)return(
    <div className="page">
      <div className="sg">{[...Array(4)].map((_,i)=><div key={i} className="sk" style={{height:74,borderRadius:13}}/>)}</div>
      {[...Array(3)].map((_,i)=><div key={i} className="sk"/>)}
    </div>
  );

  return(
    <div className="page">
      <div className="sg">
        <div className="sc tb" data-icon="👥"><div className="sl">স্টুডেন্ট</div><div className="sv sv-b">{fmt(total)}</div></div>
        <div className="sc tg" data-icon="✅"><div className="sl">অ্যাক্টিভ</div><div className="sv sv-g">{fmt(active)}</div></div>
        <div className="sc ty" data-icon="⏳"><div className="sl">পেন্ডিং</div><div className="sv sv-y">{fmt(total-active)}</div></div>
        <div className="sc tr" data-icon="🚨"><div className="sl">রিপোর্ট</div><div className="sv sv-r">{fmt(rptT)}</div></div>
      </div>
      <div className="sg">
        <div className="sc tb" data-icon="❓"><div className="sl">Quiz</div><div className="sv sv-b">{fmt(quizT)}</div></div>
        <div className="sc tg" data-icon="📚"><div className="sl">QBank</div><div className="sv sv-g">{fmt(qbT)}</div></div>
        <div className="sc ty" data-icon="📖"><div className="sl">Study</div><div className="sv sv-y">{fmt(stT)}</div></div>
        <div className="sc tp" data-icon="📊"><div className="sl">মোট</div><div className="sv sv-p">{fmt(quizT+qbT+stT)}</div></div>
      </div>
      <div className="card">
        <div className="ct">📈 Daily Active (৭ দিন)</div>
        <Bar data={days} color={C.accent}/>
        <div style={{display:"flex",justifyContent:"space-between",marginTop:6,fontSize:10,color:C.muted}}>
          <span>সর্বোচ্চ: <b style={{color:C.accent}}>{Math.max(...days.map(d=>d.v),0)}</b></span>
          <span>মোট: <b style={{color:C.accent}}>{days.reduce((s,d)=>s+d.v,0)}</b></span>
        </div>
      </div>
      <div className="card">
        <div className="ct">📊 Analytics</div>
        <div className="atabs">
          {[["quiz","❓ Quiz"],["qbank","📚 QBank"],["study","📖 Study"]].map(([v,l])=>(
            <button key={v} className={`atab${atab===v?" on":""}`} onClick={()=>setAtab(v)}>{l}</button>
          ))}
        </div>
        {atab==="quiz"&&(Object.keys(quizMap).length===0?<div style={{textAlign:"center",color:C.muted,padding:"12px 0",fontSize:12}}>{quiz===null?"⏳ লোড হচ্ছে...":"ডেটা নেই"}</div>:<Tree entries={Object.entries(quizMap)} total={quizT} color={C.accent}/>)}
        {atab==="qbank"&&(Object.keys(qbankMap).length===0?<div style={{textAlign:"center",color:C.muted,padding:"12px 0",fontSize:12}}>{qbank===null?"⏳ লোড হচ্ছে...":"ডেটা নেই"}</div>:<Tree entries={Object.entries(qbankMap)} total={qbT} color={C.green}/>)}
        {atab==="study"&&<div style={{textAlign:"center",color:C.muted,padding:"12px 0",fontSize:12}}>{fmt(stT)}টি নোট</div>}
      </div>
    </div>
  );
}

/* ══════════ SIGNUPS ══════════ */
function SignupsPage({push,tick}){
  const{data:usersRaw,loading}=useFB("Users",tick);
  const[activating,setActivating]=useState(null);
  const[done,setDone]=useState(new Set());

  const rows=toArr(usersRaw).filter(u=>{
    const st=(u.Status||u.status||"").toLowerCase();
    const id=u._fbKey||(u.Phone||u.phone||"");
    return(st==="inactive"||st===""||st==="pending")&&!done.has(id);
  });

  const activate=async u=>{
    const phone=u.Phone||u.phone||"";
    const fkey=u._fbKey||phoneKey(phone);
    setActivating(fkey);
    try{
      await fbPatch(`Users/${fkey}`,{Status:"Active"});
      await fbSet(`Notifications/${fkey}/welcome_${Date.now()}`,{type:"welcome",title:"🎉 অ্যাকাউন্ট অ্যাক্টিভ!",body:"Smart Study-তে স্বাগতম!",time:nowTs(),read:false});
      gasBg({action:"activateUser",phone});
      push("success","✅ অ্যাক্টিভ!",u.Name||u.name||phone);
      setDone(p=>new Set([...p,fkey]));
      fbInv("Users");
    }catch(e){push("error","ব্যর্থ",e.message);}
    setActivating(null);
  };

  return(
    <div className="page">
      <div style={{background:"#ef444412",border:"1px solid #ef444430",borderRadius:10,padding:"8px 12px",fontSize:12,color:C.red,fontWeight:600,marginBottom:11,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
        <span>🔔 {rows.length}টি পেন্ডিং</span>
        {loading&&<span style={{fontSize:10,color:C.muted}}>⏳</span>}
      </div>
      {loading&&!usersRaw?[...Array(3)].map((_,i)=><div key={i} className="sk"/>):
       rows.length===0?<div className="empty"><div className="ei">🎉</div><p>সব অ্যাক্টিভ!</p></div>:
       rows.map((u,i)=>{
        const nm=u.Name||u.name||"অজানা",ph=u.Phone||u.phone||"—";
        const fkey=u._fbKey||phoneKey(ph);
        return(
          <div key={i} className="card" style={{padding:12}}>
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
            <button className="btn bs bb" disabled={!!activating} onClick={()=>activate(u)}>
              {activating===fkey?"⏳ হচ্ছে...":"✅ অ্যাক্টিভ করুন"}
            </button>
          </div>
        );
       })
      }
    </div>
  );
}

/* ══════════ STUDENTS ══════════ */
function StudentsPage({push,tick}){
  const{data:usersRaw,loading}=useFB("Users",tick);
  const{data:summary}=useFB("Analytics/Summary",tick);
  const[overrides,setOv]=useState({});
  const[search,setSrc]=useState("");
  const[tab,setTab]=useState("all");
  const[detail,setDetail]=useState(null);
  const[notify,setNotify]=useState(null);
  const[busy,setBusy]=useState(null);

  const users=useMemo(()=>toArr(usersRaw).map(u=>{
    const ph=(u.Phone||u.phone||"").replace(/^'+/,"").trim();
    const sm=summary&&Object.entries(summary).find(([k])=>matchPhone(k,ph));
    const stats=sm?sm[1]:{};
    const ov=overrides[u._fbKey||ph];
    return{...u,...stats,Status:ov||u.Status||u.status||"Inactive",_rawPhone:ph};
  }),[usersRaw,summary,overrides]);

  const filtered=users.filter(u=>{
    const nm=(u.Name||u.name||"").toLowerCase();
    const ph=(u.Phone||u.phone||"").toLowerCase();
    const st=(u.Status||"").toLowerCase();
    const q=search.toLowerCase();
    return(!q||nm.includes(q)||ph.includes(q))&&(tab==="all"||st===tab);
  });

  const activate=async u=>{
    const phone=u.Phone||u.phone||"";
    const fkey=u._fbKey||phoneKey(phone);
    setBusy(fkey);
    try{
      await fbPatch(`Users/${fkey}`,{Status:"Active"});
      fbInv("Users");
      setOv(p=>({...p,[fkey]:"Active"}));
      gasBg({action:"activateUser",phone});
      push("success","✅ অ্যাক্টিভ!",u.Name||u.name);
    }catch(e){push("error","ব্যর্থ",e.message);}
    setBusy(null);
  };

  if(detail)return<StudentDetail user={detail} onBack={()=>setDetail(null)} push={push}/>;

  return(
    <div className="page">
      <div className="sw"><span className="si">🔍</span><input className="inp" placeholder="নাম বা ফোন..." value={search} onChange={e=>setSrc(e.target.value)}/></div>
      <div className="ftabs">
        {[["all","সবাই"],["active","✅ অ্যাক্টিভ"],["inactive","🔴 ইনঅ্যাক্টিভ"]].map(([v,l])=>(
          <button key={v} className={`ftab${tab===v?" on":""}`} onClick={()=>setTab(v)}>{l}</button>
        ))}
      </div>
      <div style={{fontSize:11,color:C.muted,marginBottom:8}}>{filtered.length} জন</div>
      {loading&&!usersRaw?[...Array(4)].map((_,i)=><div key={i} className="sk"/>):
       filtered.length===0?<div className="empty"><div className="ei">👤</div><p>কেউ নেই</p></div>:
       filtered.map((u,i)=>{
        const nm=u.Name||u.name||"অজানা",ph=u.Phone||u.phone||"—";
        const st=(u.Status||"inactive").toLowerCase();
        const fkey=u._fbKey||phoneKey(ph);
        const c=parseInt(u.totalCorrect)||0,w=parseInt(u.totalWrong)||0,tot=c+w;
        const acc=tot?Math.round(c/tot*100):0;
        const mins=parseInt(u.totalMinutes||u.studyMinutes||u.totalTime||0);
        return(
          <div key={i} className="card" style={{padding:11,cursor:"pointer"}} onClick={()=>setDetail(u)}>
            <div style={{display:"flex",alignItems:"center",gap:9,marginBottom:8}}>
              <div className="av">{initials(nm)}</div>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontWeight:700,fontSize:13}}>{nm}</div>
                <div style={{fontSize:10,color:C.muted}}>📱 {ph}</div>
              </div>
              <div style={{textAlign:"right"}}>
                <span className={`pill ${st==="active"?"pa":"pi"}`}>{st==="active"?"✅":"🔴"} {st==="active"?"অ্যাক্টিভ":"ইনঅ্যাক্টিভ"}</span>
                {tot>0&&<div style={{fontSize:9,color:acc>=70?C.green:acc>=40?C.yellow:C.red,marginTop:2,fontWeight:700}}>{acc}%</div>}
              </div>
            </div>
            <div style={{display:"flex",gap:6,marginBottom:8}}>
              {[[C.green,c,"✅"],[C.red,w,"❌"],[C.accent,mins,"⏱"]].map(([cl,val,ic])=>(
                <div key={ic} style={{textAlign:"center",flex:1,background:C.panel,borderRadius:7,padding:"5px 2px"}}>
                  <div style={{color:cl,fontWeight:700,fontSize:13}}>{val}</div>
                  <div style={{color:C.muted,fontSize:9}}>{ic}</div>
                </div>
              ))}
            </div>
            <div style={{display:"flex",gap:6}} onClick={e=>e.stopPropagation()}>
              {st!=="active"&&<button className="btn bs" style={{flex:1,justifyContent:"center",fontSize:11}} disabled={!!busy} onClick={()=>activate(u)}>{busy===fkey?"⏳":"✅ অ্যাক্টিভ"}</button>}
              <button className="btn bg" style={{flex:1,justifyContent:"center",fontSize:11}} onClick={()=>setNotify(u)}>📣</button>
              <button className="btn bp" style={{flex:1,justifyContent:"center",fontSize:11}} onClick={()=>setDetail(u)}>👁</button>
            </div>
          </div>
        );
       })
      }
      {notify&&<NotifyModal user={notify} onClose={()=>setNotify(null)} push={push}/>}
    </div>
  );
}

/* StudentDetail — FIXED: no dynamic hooks */
function StudentDetail({user,onBack,push}){
  const nm=user.Name||user.name||"অজানা";
  const ph=(user.Phone||user.phone||"").replace(/^'+/,"");
  const st=(user.Status||user.status||"inactive").toLowerCase();
  // pre-compute both keys BEFORE any hook call
  const phK  = phoneKey(ph);
  const phK0 = ph.replace(/^0+/,"").replace(/[.#$\[\]\s]/g,"_");
  // ALL hooks called unconditionally at top level
  const{data:timeA}=useFB(`Analytics/Time/${phK}`);
  const{data:timeB}=useFB(`Analytics/Time/${phK0}`);
  const{data:subjA}=useFB(`Analytics/Subject/${phK}`);
  const{data:subjB}=useFB(`Analytics/Subject/${phK0}`);
  const timeData=timeA||timeB;
  const subjData=subjA||subjB;

  const c=parseInt(user.totalCorrect)||0;
  const w=parseInt(user.totalWrong)||0;
  const tot=c+w,acc=tot?Math.round(c/tot*100):0;
  const mins=parseInt(user.totalMinutes||user.studyMinutes||user.totalTime||0);
  const dailyTime=timeData&&typeof timeData==="object"
    ?Object.entries(timeData).sort(([a],[b])=>a.localeCompare(b)).slice(-7).map(([d,v])=>({l:d.slice(5),v:parseInt(v)||0})):[];
  const subjEntries=subjData&&typeof subjData==="object"?Object.entries(subjData):[];

  return(
    <div className="fs">
      <div className="fsh">
        <button className="bk" onClick={onBack}>←</button>
        <div className="av">{initials(nm)}</div>
        <div style={{flex:1,minWidth:0}}>
          <div style={{fontWeight:700,fontSize:14,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{nm}</div>
          <div style={{fontSize:10,color:C.muted}}>📱 {ph}</div>
        </div>
        <span className={`pill ${st==="active"?"pa":"pi"}`}>{st==="active"?"✅":"🔴"}</span>
      </div>
      <div style={{padding:"12px 12px 70px"}}>
        <div className="card">
          <div style={{display:"flex",alignItems:"center",gap:12}}>
            <Ring val={c} max={tot} color={acc>=70?C.green:acc>=40?C.yellow:C.red}/>
            <div style={{flex:1}}>
              <div style={{fontSize:18,fontWeight:700,color:acc>=70?C.green:acc>=40?C.yellow:C.red,marginBottom:3}}>{acc}% Accuracy</div>
              <div style={{fontSize:11,color:C.muted}}>✅ {c} &nbsp; ❌ {w} &nbsp; 🎯 {tot}</div>
              <div style={{fontSize:11,color:C.muted,marginTop:2}}>📋 {parseInt(user.totalQuizzes)||0}টি Quiz</div>
            </div>
          </div>
        </div>
        <div className="sg">
          <div className="sc tp" data-icon="⏱"><div className="sl">মোট সময়</div><div className="sv sv-p" style={{fontSize:18}}>{mins<60?mins+"মি":~~(mins/60)+"ঘণ্টা"}</div></div>
          <div className="sc tb" data-icon="📅"><div className="sl">শেষ সক্রিয়</div><div style={{fontSize:12,fontWeight:700,marginTop:5,color:C.accent}}>{timeAgo(user.lastActive||user.Timestamp)}</div></div>
        </div>
        {dailyTime.length>0&&<div className="card"><div className="ct">⏱ দৈনিক সময় (মিনিট)</div><Bar data={dailyTime} color={C.purple}/></div>}
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
        <div className="card">
          <div className="ct">👤 তথ্য</div>
          {[["📱",ph],["✉️",user.Email||user.email||"—"],["🎓",user.Type||user.type||"Student"],["📅",user.Timestamp||user.createdAt||"—"]].map(([l,v])=>(
            <div key={l} style={{display:"flex",justifyContent:"space-between",padding:"7px 0",borderBottom:`1px solid ${C.border}40`,fontSize:12}}>
              <span style={{color:C.muted}}>{l}</span><span style={{fontWeight:600,maxWidth:"65%",textAlign:"right"}}>{v}</span>
            </div>
          ))}
        </div>
        <NotifyModal user={user} onClose={onBack} push={push} inline/>
      </div>
    </div>
  );
}

/* ══════════ REPORTS ══════════ */
function ReportsPage({push,tick}){
  const{data:rRaw,loading}=useFB("Reports",tick);
  const[done,setDone]=useState(new Set());
  const[editing,setEditing]=useState(null);
  const reports=toArr(rRaw).filter(r=>!done.has(r._fbKey||r.row)).slice(-30).reverse();
  return(
    <div className="page">
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:11}}>
        <div style={{fontSize:11,color:C.muted}}>{reports.length}টি রিপোর্ট</div>
        {loading&&<span style={{fontSize:10,color:C.muted}}>⏳</span>}
      </div>
      {loading&&!rRaw?[...Array(3)].map((_,i)=><div key={i} className="sk"/>):
       reports.length===0?<div className="empty"><div className="ei">📋</div><p>রিপোর্ট নেই! 🎉</p></div>:
       reports.map((r,i)=>{
        const isMCQ=(r.QType||r.qtype||"MCQ").toLowerCase()!=="written";
        const qid2=r.QuestionID||r.questionId;
        return(
         <div key={i} className="rc" style={{borderLeft:`3px solid ${isMCQ?C.accent:C.purple}`}}>
           <div style={{display:"flex",alignItems:"center",gap:7,marginBottom:6}}>
             <span style={{background:isMCQ?`${C.accent}22`:`${C.purple}22`,color:isMCQ?C.accent:C.purple,border:`1px solid ${isMCQ?C.accent:C.purple}44`,borderRadius:6,padding:"2px 8px",fontSize:10,fontWeight:700}}>{isMCQ?"❓ MCQ":"✍️ Written"}</span>
             <div style={{fontWeight:700,fontSize:13,flex:1}}>{r.Subject||r.subject||"অজানা"}</div>
           </div>
           <div className="rm">
             <span>📱 {r.Phone||r.phone||"—"}</span>
             {(r.SubTopic||r.subtopic)&&<span>📌 {r.SubTopic||r.subtopic}</span>}
             {qid2&&<span style={{color:C.accent}}>#{qid2}</span>}
             <span>{timeAgo(r.timestamp||r.time)}</span>
           </div>
           <div className="ri">{r.Issue||r.issue||r.Question||r.question||"বিস্তারিত নেই"}</div>
           <button className="btn bp bb" style={{marginTop:8,background:isMCQ?C.accent:C.purple}} onClick={()=>setEditing(r)}>✏️ এডিট ও সমাধান</button>
         </div>
        );
       })
      }
      {editing&&<ReportEditModal report={editing} onClose={()=>setEditing(null)} onDone={key=>{setDone(p=>new Set([...p,key]));setEditing(null);fbInv("Reports");}} push={push}/>}
    </div>
  );
}

function ReportEditModal({report,onClose,onDone,push}){
  const[step,setStep]=useState(1);
  const[qdata,setQdata]=useState(null);
  const[loadQ,setLoadQ]=useState(true);
  const[saving,setSaving]=useState(false);
  const[notifying,setNotifying]=useState(false);
  const[question,setQuestion]=useState("");
  const[opt1,setOpt1]=useState(""); const[opt2,setOpt2]=useState("");
  const[opt3,setOpt3]=useState(""); const[opt4,setOpt4]=useState("");
  const[correct,setCorrect]=useState("");
  const[explanation,setExplanation]=useState("");
  const[technique,setTechnique]=useState("");
  const[isMCQ,setIsMCQ]=useState((report.QType||report.qtype||"MCQ").toLowerCase()!=="written");
  const qid=(report.QuestionID||report.questionId||"").toString();

  useEffect(()=>{
    if(!qid){setLoadQ(false);return;}
    (async()=>{
      setLoadQ(true);
      for(const t of["Quiz","QBank"]){
        try{
          const raw=await fbGet(t);
          const arr=toArr(raw);
          const q=arr.find(x=>(x.ID||x.id||"").toString()===qid);
          if(q){
            setQdata({...q,_tab:t});
            setQuestion(q.Question||q.question||"");
            setOpt1(q.Opt1||q.opt1||""); setOpt2(q.Opt2||q.opt2||"");
            setOpt3(q.Opt3||q.opt3||""); setOpt4(q.Opt4||q.opt4||"");
            setCorrect(q.Correct||q.correct||"");
            setExplanation(q.Explanation||q.explanation||"");
            setTechnique(q.Technique||q.technique||"");
            const qt=(q.QType||q.qtype||"MCQ").toLowerCase();
            setIsMCQ(qt!=="written");
            break;
          }
        }catch(_){}
      }
      setLoadQ(false);
    })();
  },[qid]);

  const save=async()=>{
    setSaving(true);
    try{
      if(qdata&&qid){
        const t=qdata._tab||"Quiz";
        const fkey=qdata._fbKey;
        const patch=isMCQ
          ?{Question:question,Opt1:opt1,Opt2:opt2,Opt3:opt3,Opt4:opt4,Correct:correct,Explanation:explanation,Technique:technique}
          :{Question:question,Explanation:explanation,Technique:technique};
        if(fkey) await fbPatch(`${t}/${fkey}`,patch);
        fbInv(t);
        const fields=isMCQ
          ?[["question",question],["opt1",opt1],["opt2",opt2],["opt3",opt3],["opt4",opt4],["correct",correct],["explanation",explanation],["technique",technique]]
          :[["question",question],["explanation",explanation],["technique",technique]];
        fields.forEach(([f,v])=>v.trim()&&gasBg({action:"updateField",sheet:t,id:qid,field:f,content:encodeURIComponent(v)}));
      }
      push("success","✅ Firebase ও Sheet-এ সেভ হয়েছে!","");
      setStep(2);
    }catch(e){push("error","Save ব্যর্থ",String(e?.message||e||"Unknown error"));}
    setSaving(false);
  };

  const doNotify=async()=>{
    setNotifying(true);
    try{
      const phone=(report.Phone||report.phone||"").toString();
      const subject=(report.Subject||report.subject||"প্রশ্নটি").toString();
      const phK=phoneKey(phone);
      const notifTitle="✅ রিপোর্ট সমাধান হয়েছে!";
      const notifBody=`"${subject}" সংশোধন হয়েছে।`;
      // 1. Firebase-এ লিখে দাও
      await fbSet(`Notifications/${phK}/notif_${Date.now()}`,{type:"report_resolved",title:notifTitle,body:notifBody,questionId:qid,time:nowTs(),read:false});
      // 2. FCM push - specific user কে (fire and forget, 6s timeout)
      try{
        await Promise.race([
          fetch(GAS+"?"+new URLSearchParams({action:"personalNotify",phone,title:encodeURIComponent(notifTitle),body:encodeURIComponent(notifBody)})),
          new Promise((_,rej)=>setTimeout(()=>rej(new Error("timeout")),6000))
        ]);
      }catch(_){}
      push("success","✅ নোটিফাই হয়েছে!",phone);
      onDone(report._fbKey||report.row||qid);
    }catch(e){push("error","Notify ব্যর্থ",String(e?.message||e||"Unknown error"));}
    setNotifying(false);
  };

  const accentColor=isMCQ?C.accent:C.purple;

  return(
    <div className="ovl">
      <div className="modal">
        <div className="mh"/>
        <div className="steps">
          <div className={`step${step===1?" act":step>1?" done":""}`}>① এডিট</div>
          <div className={`step${step===2?" act":""}`}>② নোটিফাই</div>
        </div>
        {step===1&&<>
          <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:11}}>
            <span style={{background:`${accentColor}22`,color:accentColor,border:`1px solid ${accentColor}44`,borderRadius:6,padding:"3px 10px",fontSize:11,fontWeight:700}}>{isMCQ?"❓ MCQ":"✍️ Written"}</span>
            <div style={{fontWeight:700,fontSize:14}}>প্রশ্ন এডিট</div>
          </div>
          <div style={{background:"#ef444412",border:"1px solid #ef444430",borderRadius:9,padding:"7px 10px",marginBottom:10}}>
            <div style={{fontSize:10,color:C.red,fontWeight:700,marginBottom:2}}>🚨 {report.Phone||report.phone} · {report.Subject||report.subject}</div>
            <div style={{fontSize:11,color:C.text}}>{report.Issue||report.issue||"—"}</div>
          </div>
          {loadQ?<><div className="sk" style={{height:46}}/><div className="sk"/></>:
           !qdata?<div style={{textAlign:"center",color:C.muted,padding:"14px 0",fontSize:12}}>প্রশ্ন #{qid||"—"} পাওয়া যায়নি।</div>:
           isMCQ?(
            <>
              <div className="fld"><label>❓ প্রশ্ন</label><textarea className="ta" value={question} onChange={e=>setQuestion(e.target.value)} style={{minHeight:65}}/></div>
              <div style={{background:`${accentColor}0a`,border:`1px solid ${accentColor}20`,borderRadius:10,padding:"10px",marginBottom:10}}>
                <div style={{fontSize:10,fontWeight:700,color:accentColor,marginBottom:8,letterSpacing:".5px",textTransform:"uppercase"}}>📋 Options</div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:7}}>
                  <div className="fld" style={{margin:0}}><label>A</label><input className="inp" value={opt1} onChange={e=>setOpt1(e.target.value)}/></div>
                  <div className="fld" style={{margin:0}}><label>B</label><input className="inp" value={opt2} onChange={e=>setOpt2(e.target.value)}/></div>
                  <div className="fld" style={{margin:0}}><label>C</label><input className="inp" value={opt3} onChange={e=>setOpt3(e.target.value)}/></div>
                  <div className="fld" style={{margin:0}}><label>D</label><input className="inp" value={opt4} onChange={e=>setOpt4(e.target.value)}/></div>
                </div>
                <div style={{marginTop:10}}>
                  <div style={{fontSize:10,fontWeight:700,color:C.muted,letterSpacing:".5px",textTransform:"uppercase",marginBottom:5}}>✅ সঠিক উত্তর</div>
                  <div style={{display:"flex",gap:4,flexWrap:"wrap",marginBottom:6}}>
                    {[opt1,opt2,opt3,opt4].filter(Boolean).map((o,i)=>(
                      <button key={i} type="button" className={`cc${correct===o?" on":""}`} onClick={()=>setCorrect(o)}>{o.slice(0,14)}{o.length>14?"…":""}</button>
                    ))}
                  </div>
                  <input className="inp" value={correct} onChange={e=>setCorrect(e.target.value)} placeholder="বা সরাসরি লিখুন..."/>
                </div>
              </div>
              <div style={{background:`${C.green}0a`,border:`1px solid ${C.green}20`,borderRadius:10,padding:"10px",marginBottom:10}}>
                <div style={{fontSize:10,fontWeight:700,color:C.green,marginBottom:8,letterSpacing:".5px",textTransform:"uppercase"}}>📖 Explanation & Technique</div>
                <div className="fld" style={{marginBottom:8}}><label>Explanation</label><textarea className="ta" value={explanation} onChange={e=>setExplanation(e.target.value)} style={{minHeight:70}}/></div>
                <div className="fld" style={{margin:0}}><label>💡 Technique</label><textarea className="ta" value={technique} onChange={e=>setTechnique(e.target.value)} style={{minHeight:50}}/></div>
              </div>
            </>
           ):(
            <>
              <div style={{background:`${C.purple}0a`,border:`1px solid ${C.purple}20`,borderRadius:10,padding:"10px",marginBottom:10}}>
                <div style={{fontSize:10,fontWeight:700,color:C.purple,marginBottom:8,letterSpacing:".5px",textTransform:"uppercase"}}>✍️ Written প্রশ্ন</div>
                <div className="fld" style={{margin:0}}><label>প্রশ্ন</label><textarea className="ta" value={question} onChange={e=>setQuestion(e.target.value)} style={{minHeight:80}}/></div>
              </div>
              <div style={{background:`${C.green}0a`,border:`1px solid ${C.green}20`,borderRadius:10,padding:"10px",marginBottom:10}}>
                <div style={{fontSize:10,fontWeight:700,color:C.green,marginBottom:8,letterSpacing:".5px",textTransform:"uppercase"}}>📖 Explanation & Technique</div>
                <div className="fld" style={{marginBottom:8}}><label>Explanation</label><textarea className="ta" value={explanation} onChange={e=>setExplanation(e.target.value)} style={{minHeight:80}}/></div>
                <div className="fld" style={{margin:0}}><label>💡 Technique</label><textarea className="ta" value={technique} onChange={e=>setTechnique(e.target.value)} style={{minHeight:50}}/></div>
              </div>
            </>
           )
          }
          <div style={{display:"flex",gap:6}}>
            <button type="button" className="btn bg" style={{flex:1,justifyContent:"center"}} onClick={onClose}>বাতিল</button>
            <button type="button" className="btn bp" style={{flex:2,justifyContent:"center",background:accentColor}} disabled={saving} onClick={save}>{saving?"⏳...":"💾 সেভ →"}</button>
          </div>
        </>}
        {step===2&&<>
          <div className="mt">📣 নোটিফাই</div>
          <div style={{background:"#22c55e12",border:"1px solid #22c55e30",borderRadius:10,padding:"11px",marginBottom:12}}>
            <div style={{fontSize:13,fontWeight:700,color:C.green,marginBottom:4}}>✅ সেভ সম্পন্ন!</div>
            <div style={{fontSize:11,color:C.muted}}>Firebase ও Sheet দুটোতেই আপডেট হয়েছে।</div>
          </div>
          <div style={{background:C.panel,borderRadius:9,padding:"10px 12px",marginBottom:12}}>
            <div style={{fontWeight:700}}>📱 {report.Phone||report.phone}</div>
            <div style={{fontSize:11,color:C.accent,marginTop:4}}>"✅ রিপোর্ট সমাধান হয়েছে!"</div>
          </div>
          <div style={{display:"flex",gap:6}}>
            <button className="btn bg" style={{flex:1,justifyContent:"center"}} onClick={()=>onDone(report._fbKey||report.row)}>এড়িয়ে যান</button>
            <button className="btn bs" style={{flex:2,justifyContent:"center"}} disabled={notifying} onClick={doNotify}>{notifying?"⏳...":"✅ নোটিফাই"}</button>
          </div>
        </>}
      </div>
    </div>
  );
}

/* ══════════ ENTRY ══════════ */
function EntryPage({push}){
  const[mode,setMode]=useState("Quiz");
  const[qtype,setQtype]=useState("MCQ");
  const[saving,setSaving]=useState(false);
  const[uploading,setUp]=useState(false);
  const{data:quizRaw}=useFB("Quiz");
  const[question,setQuestion]=useState("");
  const[opt1,setOpt1]=useState(""); const[opt2,setOpt2]=useState("");
  const[opt3,setOpt3]=useState(""); const[opt4,setOpt4]=useState("");
  const[correct,setCorrect]=useState("");
  const[subject,setSubject]=useState("");
  const[topic,setTopic]=useState("");
  const[subtopic,setSubtopic]=useState("");
  const[explanation,setExplanation]=useState("");
  const[technique,setTechnique]=useState("");
  const[imgUrl,setImgUrl]=useState("");

  const subjects=useMemo(()=>[...new Set(toArr(quizRaw).map(q=>q.Subject||q.subject||"").filter(Boolean))],[quizRaw]);

  const reset=()=>{setQuestion("");setOpt1("");setOpt2("");setOpt3("");setOpt4("");setCorrect("");setExplanation("");setTechnique("");setImgUrl("");};

  const handleImg=async e=>{
    const f=e.target.files[0];if(!f)return;
    setUp(true);
    try{const u=await uploadImg(f);setImgUrl(u);push("success","ছবি আপলোড হয়েছে","");}
    catch{push("error","আপলোড ব্যর্থ","");}
    setUp(false);
  };

  const submit=async()=>{
    if(!question.trim()&&mode!=="Study"){push("warn","প্রশ্ন লিখুন","");return;}
    if(!subject.trim()){push("warn","বিষয় লিখুন","");return;}
    if(mode!=="Study"&&qtype==="MCQ"&&!correct){push("warn","সঠিক উত্তর দিন","");return;}
    setSaving(true);
    try{
      const ts=nowTs(),id=Date.now();
      let rec={};
      if(mode==="Quiz") rec={ID:id,Question:question,Opt1:opt1,Opt2:opt2,Opt3:opt3,Opt4:opt4,Correct:correct,Subject:subject,Sub_topic:subtopic,Explanation:explanation,Technique:technique,QType:qtype,Timestamp:ts,Image:imgUrl};
      else if(mode==="QBank") rec={ID:id,Question:question,Opt1:opt1,Opt2:opt2,Opt3:opt3,Opt4:opt4,Correct:correct,Subject:subject,Topic:topic,Sub_topic:subtopic,Explanation:explanation,Technique:technique,QType:qtype,Timestamp:ts,Image:imgUrl};
      else rec={ID:id,Subject:subject,Sub_topic:subtopic,Explanation:explanation,Technique:technique,Timestamp:ts,Image:imgUrl};
      await fbPush(mode,rec);
      fbInv(mode);
      const gp=mode==="Quiz"?{targetTab:"Quiz",question,opt1,opt2,opt3,opt4,correct,subject,sub_topic:subtopic,explanation,technique,qType:qtype,timestamp:ts,audienceTags:"General"}
        :mode==="QBank"?{targetTab:"QBank",question,opt1,opt2,opt3,opt4,correct,subject,topic,sub_topic:subtopic,explanation,technique,qType:qtype,timestamp:ts}
        :{targetTab:"Study",subject,sub_topic:subtopic,explanation,technique,timestamp:ts};
      gasPost(gp);
      push("success","✅ সেভ হয়েছে!",`${mode} #${id}`);
      reset();
    }catch(e){push("error","ব্যর্থ",e.message);}
    setSaving(false);
  };

  return(
    <div className="page">
      <div className="ftabs">{["Quiz","QBank","Study"].map(m=><button key={m} className={`ftab${mode===m?" on":""}`} onClick={()=>setMode(m)}>{m}</button>)}</div>
      {mode!=="Study"&&<div style={{display:"flex",gap:7,marginBottom:11}}>{["MCQ","Written"].map(t=><button key={t} className={`tp2${qtype===t?" on":""}`} onClick={()=>setQtype(t)}>{t}</button>)}</div>}
      {mode!=="Study"&&<div className="fld"><label>❓ প্রশ্ন</label><textarea className="ta" value={question} onChange={e=>setQuestion(e.target.value)} style={{minHeight:80}}/></div>}
      {mode!=="Study"&&qtype==="MCQ"&&<>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
          <div className="fld"><label>A</label><input className="inp" value={opt1} onChange={e=>setOpt1(e.target.value)} placeholder="Option A"/></div>
          <div className="fld"><label>B</label><input className="inp" value={opt2} onChange={e=>setOpt2(e.target.value)} placeholder="Option B"/></div>
          <div className="fld"><label>C</label><input className="inp" value={opt3} onChange={e=>setOpt3(e.target.value)} placeholder="Option C"/></div>
          <div className="fld"><label>D</label><input className="inp" value={opt4} onChange={e=>setOpt4(e.target.value)} placeholder="Option D"/></div>
        </div>
        <div className="fld">
          <label>✅ সঠিক উত্তর</label>
          <div style={{display:"flex",gap:5,flexWrap:"wrap",marginBottom:6}}>
            {[opt1,opt2,opt3,opt4].filter(Boolean).map((o,i)=><button key={i} type="button" className={`cc${correct===o?" on":""}`} onClick={()=>setCorrect(o)}>{o.slice(0,16)}{o.length>16?"…":""}</button>)}
          </div>
          <input className="inp" value={correct} onChange={e=>setCorrect(e.target.value)} placeholder="বা সরাসরি লিখুন..."/>
        </div>
      </>}
      <div className="fld">
        <label>📚 বিষয়</label>
        <input className="inp" list="sl" value={subject} onChange={e=>setSubject(e.target.value)} placeholder="Subject..."/>
        <datalist id="sl">{subjects.map((s,i)=><option key={i} value={s}/>)}</datalist>
      </div>
      {mode==="QBank"&&<div className="fld"><label>📂 Topic</label><input className="inp" value={topic} onChange={e=>setTopic(e.target.value)} placeholder="Topic..."/></div>}
      <div className="fld"><label>📌 Sub Topic</label><input className="inp" value={subtopic} onChange={e=>setSubtopic(e.target.value)} placeholder="Sub Topic..."/></div>
      <div className="fld"><label>📖 Explanation</label><textarea className="ta" value={explanation} onChange={e=>setExplanation(e.target.value)} style={{minHeight:80}}/></div>
      <div className="fld"><label>💡 Technique</label><textarea className="ta" value={technique} onChange={e=>setTechnique(e.target.value)} style={{minHeight:60}}/></div>
      <div className="fld">
        <label>🖼 ছবি (optional)</label>
        <label style={{display:"flex",alignItems:"center",gap:7,background:C.panel,border:`1px solid ${C.border}`,borderRadius:9,padding:"9px 12px",cursor:"pointer",fontSize:12,color:C.muted}}>
          {uploading?"⏳ আপলোড হচ্ছে...":"📷 ছবি বেছে নিন"}
          <input type="file" accept="image/*" style={{display:"none"}} onChange={handleImg}/>
          {imgUrl&&<a href={imgUrl} target="_blank" rel="noreferrer" style={{fontSize:11,color:C.accent,marginLeft:"auto"}} onClick={e=>e.stopPropagation()}>দেখুন ↗</a>}
        </label>
        {imgUrl&&<img src={imgUrl} style={{width:"100%",borderRadius:9,marginTop:6,border:`1px solid ${C.border}`}} alt="preview"/>}
      </div>
      <button className="btn bp bb" style={{marginTop:4}} disabled={saving} onClick={submit}>{saving?"⏳ সেভ হচ্ছে...":"💾 Firebase-এ সেভ করুন"}</button>
    </div>
  );
}

/* ══════════ SEARCH ══════════ */
function SearchPage({push,onDetail}){
  const[q,setQ]=useState("");
  const[results,setResults]=useState(null);
  const[searching,setSearching]=useState(false);
  const deb=useRef(null);
  const{data:quizRaw}=useFB("Quiz");
  const{data:qbankRaw}=useFB("QBank");
  const{data:usersRaw}=useFB("Users");

  const doSearch=useCallback(query=>{
    if(!query||query.length<2){setResults(null);return;}
    setSearching(true);
    const qlo=query.toLowerCase();
    const srch=(raw,tab)=>toArr(raw).filter(q2=>{
      return[(q2.Question||q2.question||""),(q2.Subject||q2.subject||""),(q2.Sub_topic||q2.sub_topic||""),(q2.Correct||q2.correct||"")].join(" ").toLowerCase().includes(qlo);
    }).slice(0,10).map(q2=>({...q2,_tab:tab}));
    const uRes=toArr(usersRaw).filter(u=>{
      return(u.Name||u.name||"").toLowerCase().includes(qlo)||(u.Phone||u.phone||"").toLowerCase().includes(qlo);
    }).slice(0,6);
    setResults({questions:[...srch(quizRaw,"Quiz"),...srch(qbankRaw,"QBank")].slice(0,12),users:uRes});
    setSearching(false);
  },[quizRaw,qbankRaw,usersRaw]);

  const onIn=v=>{setQ(v);clearTimeout(deb.current);deb.current=setTimeout(()=>doSearch(v),300);};
  const tot=(results?.questions?.length||0)+(results?.users?.length||0);

  return(
    <div className="page">
      <div className="sw" style={{marginBottom:12}}>
        <span className="si">🔍</span>
        <input className="inp" placeholder="নাম, ফোন, প্রশ্ন, বিষয়..." value={q} onChange={e=>onIn(e.target.value)} autoFocus/>
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
              <div style={{fontSize:12,fontWeight:600,lineHeight:1.4}}>{(q2.Question||q2.question||"").slice(0,80)}…</div>
              {(q2.Correct||q2.correct)&&<div style={{fontSize:10,color:C.green,marginTop:1}}>✅ {q2.Correct||q2.correct}</div>}
            </div>
            <div style={{fontSize:10,color:C.muted}}>#{q2.ID||q2.id}</div>
          </div>
        ))}
      </>}
      {!searching&&results&&tot===0&&<div className="empty"><div className="ei">🔍</div><p>"{q}" পাওয়া যায়নি</p></div>}
      {!results&&!searching&&<div className="empty" style={{paddingTop:28}}><div className="ei">🔍</div><p style={{fontSize:12}}>সব কিছু খুঁজুন<br/><span style={{fontSize:10,color:C.muted}}>Firebase থেকে instant</span></p></div>}
    </div>
  );
}

/* ══════════ NOTIFY PAGE ══════════ */
function NotifyPage({push}){
  const[title,setTitle]=useState("");
  const[body,setBody]=useState("");
  const[sending,setSending]=useState(false);
  const[hist,setHist]=useState([]);
  const{data:usersRaw}=useFB("Users");

  const send=async()=>{
    if(!title||!body){push("warn","তথ্য দিন","");return;}
    setSending(true);
    try{
      // 1. Firebase-এ সব active user এর Notifications-এ লিখে দাও
      const users=toArr(usersRaw);
      const active=users.filter(u=>(u.Status||u.status||"").toLowerCase()==="active");
      const ts=nowTs();
      const notifKey=`broadcast_${Date.now()}`;
      await Promise.all(active.map(u=>{
        const phK=phoneKey(u.Phone||u.phone||"");
        if(!phK)return Promise.resolve();
        return fbSet(`Notifications/${phK}/${notifKey}`,{type:"broadcast",title,body,time:ts,read:false});
      }));
      // 2. GAS দিয়ে FCM push পাঠাও (fire-and-forget)
      try{
        const r=await gasCall({action:"broadcastNotification",title:encodeURIComponent(title),body:encodeURIComponent(body)});
        const sent=r?.fcm?.sent||r?.sent||0;
        push("success","📣 পাঠানো হয়েছে!",`Firebase: ${active.length}জন · FCM: ${sent}জন`);
      }catch{
        push("success","✅ Firebase-এ পাঠানো হয়েছে",`${active.length} জন active user`);
      }
      setHist(p=>[{title,body,time:ts,count:active.length},...p.slice(0,9)]);
      setTitle("");setBody("");
    }catch(e){push("error","ব্যর্থ",String(e?.message||e||"Unknown error"));}
    setSending(false);
  };
  return(
    <div className="page">
      <div style={{background:`linear-gradient(135deg,${C.card},#0a1830)`,border:`1px solid ${C.accent}20`,borderRadius:13,padding:14,marginBottom:11}}>
        <div className="ct">📣 সবাইকে Broadcast</div>
        <div className="fld"><label>শিরোনাম</label><input className="inp" placeholder="নোটিফিকেশনের শিরোনাম..." value={title} onChange={e=>setTitle(e.target.value)}/></div>
        <div className="fld"><label>বার্তা</label><textarea className="ta" placeholder="বিস্তারিত..." value={body} onChange={e=>setBody(e.target.value)}/></div>
        <button className="btn bp bb" onClick={send} disabled={sending}>{sending?"⏳ পাঠানো হচ্ছে...":"📣 সবাইকে পাঠান"}</button>
      </div>
      {hist.length>0&&<div className="card"><div className="ct">ইতিহাস</div>{hist.map((h,i)=>(
        <div key={i} className="nr">
          <div className={`nd ${i===0?"n":"o"}`}/>
          <div className="nc">
            <div className="nt">{h.title}</div>
            <div className="ns">{h.body?.slice(0,55)}{h.count!=null&&<span style={{color:C.accent}}> · {h.count}জন</span>}</div>
          </div>
          <div className="ntm">{h.time}</div>
        </div>
      ))}</div>}
    </div>
  );
}

function NotifyModal({user,onClose,push,inline}){
  const[title,setTitle]=useState("");
  const[body,setBody]=useState("");
  const[sending,setSending]=useState(false);
  const nm=user.Name||user.name||"স্টুডেন্ট";
  const send=async()=>{
    if(!title||!body)return;
    setSending(true);
    try{
      const phone=(user.Phone||user.phone||"").toString();
      const phK=phoneKey(phone);
      // 1. Firebase Notifications-এ লিখে দাও (app নিজেই poll করে)
      await fbSet(`Notifications/${phK}/notif_${Date.now()}`,{type:"personal",title,body,time:nowTs(),read:false});
      // 2. GAS দিয়ে specific user কে FCM পাঠাও (phone দিয়ে token খুঁজবে)
      try{
        await Promise.race([
          fetch(GAS+"?"+new URLSearchParams({action:"personalNotify",phone,title:encodeURIComponent(title),body:encodeURIComponent(body)})),
          new Promise((_,rej)=>setTimeout(()=>rej(new Error("timeout")),6000))
        ]);
      }catch(_){}
      push("success","✅ পাঠানো হয়েছে",nm);
      if(!inline)onClose();
    }catch(e){push("error","ব্যর্থ",String(e?.message||e||"Unknown error"));}
    setSending(false);
  };
  if(inline)return(
    <div className="card">
      <div className="ct">📣 ব্যক্তিগত নোটিফিকেশন</div>
      <div className="fld"><label>শিরোনাম</label><input className="inp" placeholder="Title..." value={title} onChange={e=>setTitle(e.target.value)}/></div>
      <div className="fld"><label>বার্তা</label><textarea className="ta" placeholder="Message..." value={body} onChange={e=>setBody(e.target.value)}/></div>
      <button className="btn bp bb" onClick={send} disabled={sending}>{sending?"⏳":"📨 পাঠান"}</button>
    </div>
  );
  return(
    <div className="ovl">
      <div className="modal">
        <div className="mh"/>
        <div className="mt">📣 {nm}</div>
        <div style={{fontSize:11,color:C.muted,marginBottom:11}}>📱 {user.Phone||user.phone}</div>
        <div className="fld"><label>শিরোনাম</label><input className="inp" placeholder="Title..." value={title} onChange={e=>setTitle(e.target.value)}/></div>
        <div className="fld"><label>বার্তা</label><textarea className="ta" placeholder="Message..." value={body} onChange={e=>setBody(e.target.value)}/></div>
        <div style={{display:"flex",gap:7}}>
          <button className="btn bg" style={{flex:1,justifyContent:"center"}} onClick={onClose}>বাতিল</button>
          <button className="btn bp" style={{flex:1,justifyContent:"center"}} onClick={send} disabled={sending}>{sending?"⏳":"📨 পাঠান"}</button>
        </div>
      </div>
    </div>
  );
}

/* ══════════ ROOT APP ══════════ */
const NAV=[
  {id:"dashboard",icon:"📊",label:"Dashboard"},
  {id:"signups",  icon:"🆕",label:"সাইনআপ",  badge:true},
  {id:"students", icon:"👥",label:"Students"},
  {id:"reports",  icon:"🚨",label:"Reports",  badge:true},
  {id:"search",   icon:"🔍",label:"Search"},
  {id:"notify",   icon:"📣",label:"Notify"},
];

export default function App(){
  const[page,setPage]=useState("dashboard");
  const[toasts,push]=useToasts();
  const[tick,setTick]=useState(0);
  const[spin,setSpin]=useState(false);
  const[searchDetail,setSearchDetail]=useState(null);

  const refresh=()=>{
    setSpin(true);
    Object.keys(_cache).forEach(k=>delete _cache[k]);
    setTick(t=>t+1);
    setTimeout(()=>setSpin(false),1400);
  };

  useEffect(()=>{const id=setInterval(()=>setTick(t=>t+1),60_000);return()=>clearInterval(id);},[]);

  if(searchDetail)return(
    <>
      <style>{css}</style>
      <StudentDetail user={searchDetail} onBack={()=>setSearchDetail(null)} push={push}/>
      <Toasts t={toasts}/>
    </>
  );

  return(
    <>
      <style>{css}</style>
      <div className="topbar">
        <div>
          <div className="topbar-title">{NAV.find(n=>n.id===page)?.icon} {NAV.find(n=>n.id===page)?.label}</div>
          <div className="topbar-sub">Smart Study Admin · Firebase Direct</div>
        </div>
        <button className={`icon-btn${spin?" spin":""}`} onClick={refresh}>🔄</button>
      </div>
      <div style={{display:page==="dashboard"?"block":"none"}}><DashboardPage push={push} tick={tick}/></div>
      <div style={{display:page==="signups"  ?"block":"none"}}><SignupsPage   push={push} tick={tick}/></div>
      <div style={{display:page==="students" ?"block":"none"}}><StudentsPage  push={push} tick={tick}/></div>
      <div style={{display:page==="reports"  ?"block":"none"}}><ReportsPage   push={push} tick={tick}/></div>
      <div style={{display:page==="search"   ?"block":"none"}}><SearchPage    push={push} onDetail={u=>setSearchDetail(u)}/></div>
      <div style={{display:page==="notify"   ?"block":"none"}}><NotifyPage    push={push}/></div>
      <nav className="bottom-nav">
        {NAV.map(n=>(
          <button key={n.id} className={`nav-btn${page===n.id?" active":""}`} onClick={()=>setPage(n.id)}>
            <span className="nav-icon">{n.icon}</span>
            <span>{n.label}</span>
            {n.badge&&<span className="nav-badge">!</span>}
          </button>
        ))}
      </nav>
      <Toasts t={toasts}/>
    </>
  );
}
