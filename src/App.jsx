import { useState, useEffect, useCallback, useRef } from "react";

const FB   = "https://smartentrydb-default-rtdb.firebaseio.com";
const FBK  = "CsFdxaWLLU2AT92kxYFPTOhP1ewDR0jzK3hKjqWO";
const GAS  = "https://script.google.com/macros/s/AKfycbyjF7iFX0H_rFuJgMJYo70DC7KRX1lBXU7m7NoZCwf6VTJfRm6Iyw6hOcN2q_UKbxxgQg/exec";
const IMGBB= "3f23d9fd6bdfdb694285773f40569906";

const C={bg:"#06080f",card:"#0c1220",border:"#16253d",accent:"#3b82f6",green:"#22c55e",red:"#ef4444",yellow:"#f59e0b",purple:"#8b5cf6",text:"#e2e8f0",muted:"#4b5e7a",panel:"#0e1a2e",navBg:"#080f1c"};

/* ── Firebase REST ── */
const fb={
  get:async(p)=>{const r=await fetch(`${FB}/${p}.json?auth=${FBK}`);return r.json();},
  set:async(p,d)=>{const r=await fetch(`${FB}/${p}.json?auth=${FBK}`,{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify(d)});return r.json();},
  patch:async(p,d)=>{const r=await fetch(`${FB}/${p}.json?auth=${FBK}`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify(d)});return r.json();},
  push:async(p,d)=>{const r=await fetch(`${FB}/${p}.json?auth=${FBK}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(d)});return r.json();},
};

/* ── GAS background call (non-blocking) ── */
const gasAction=async(params)=>{
  const r=await fetch(GAS+"?"+new URLSearchParams(params).toString());
  return r.json();
};
const gasBg=(params)=>setTimeout(()=>fetch(GAS+"?"+new URLSearchParams(params).toString()).catch(()=>{}),200);
const gasPost=(body)=>setTimeout(()=>fetch(GAS,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)}).catch(()=>{}),200);

/* ── Firebase Cache (stale-while-revalidate) ── */
const _cache={},_subs={},_fly={};
const FRESH=60_000;
const fbCached=async(path,force=false)=>{
  if(!force&&_cache[path]&&Date.now()-_cache[path].ts<FRESH)return _cache[path].data;
  if(_fly[path])return _fly[path];
  _fly[path]=fb.get(path).then(data=>{
    _cache[path]={data,ts:Date.now()};
    (_subs[path]||new Set()).forEach(cb=>cb(data));
    delete _fly[path];return data;
  }).catch(e=>{delete _fly[path];throw e;});
  return _fly[path];
};
const fbInvalidate=(...paths)=>paths.forEach(p=>{delete _cache[p];});

function useFB(path,forceRefresh=0){
  const[data,setData]=useState(()=>_cache[path]?.data??null);
  const[loading,setLoading]=useState(!_cache[path]);
  const prev=useRef(0);
  useEffect(()=>{
    if(!path)return;
    if(!_subs[path])_subs[path]=new Set();
    const cb=d=>{setData(d);setLoading(false);};
    _subs[path].add(cb);
    const force=forceRefresh>prev.current;prev.current=forceRefresh;
    const stale=_cache[path]?.data;
    if(stale&&!force){setData(stale);setLoading(false);fbCached(path,false).catch(()=>{});}
    else{if(!stale)setLoading(true);fbCached(path,force).catch(()=>setLoading(false));}
    return()=>_subs[path]?.delete(cb);
  },[path,forceRefresh]);
  return{data,loading};
}

/* ── Helpers ── */
const fmt=n=>(n||0).toLocaleString();
const pct=(a,b)=>b?Math.round(a/b*100):0;
const initials=n=>(n||"?").split(" ").map(w=>w[0]).join("").toUpperCase().slice(0,2);
const timeAgo=ts=>{
  if(!ts)return"—";
  try{const d=new Date(ts.replace?ts.replace(/(\d{2})-(\d{2})-(\d{4})/,"$3-$2-$1"):ts),s=Date.now()-d.getTime();
    if(s<60000)return"এখনই";if(s<3600000)return~~(s/60000)+"মি আগে";
    if(s<86400000)return~~(s/3600000)+"ঘণ্টা আগে";return~~(s/86400000)+"দিন আগে";}
  catch{return ts;}
};
const nowTs=()=>new Date().toLocaleString("bn-BD",{timeZone:"Asia/Dhaka"});
const toArr=(raw)=>{
  if(!raw)return[];
  if(Array.isArray(raw))return raw.filter(Boolean);
  return Object.entries(raw).map(([k,v])=>v?{...v,_key:k}:null).filter(Boolean);
};

/* ── ImgBB Upload ── */
const uploadImg=async(file)=>{
  const fd=new FormData();fd.append("image",file);
  const r=await fetch(`https://api.imgbb.com/1/upload?key=${IMGBB}`,{method:"POST",body:fd});
  return(await r.json())?.data?.url||"";
};

/* ── Toast ── */
let _tid=0;
function useToasts(){
  const[toasts,set]=useState([]);
  const push=useCallback((type,title,msg="")=>{
    const id=++_tid;set(p=>[...p,{id,type,title,msg}]);
    setTimeout(()=>set(p=>p.filter(t=>t.id!==id)),4000);
  },[]);
  return[toasts,push];
}

function Toasts({toasts}){
  return(
    <div className="toasts">
      {toasts.map(t=>(
        <div key={t.id} className={`toast ${t.type}`}>
          <div className="t-icon">{t.type==="success"?"✅":t.type==="error"?"❌":t.type==="warn"?"⚠️":"ℹ️"}</div>
          <div className="t-body"><div className="t-title">{t.title}</div>{t.msg&&<div className="t-msg">{t.msg}</div>}</div>
        </div>
      ))}
    </div>
  );
}

/* ══════════════ CSS ══════════════ */
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
.stat-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px}
.stat-card{background:${C.card};border:1px solid ${C.border};border-radius:13px;padding:12px;position:relative;overflow:hidden}
.stat-card::after{content:attr(data-icon);position:absolute;right:8px;bottom:6px;font-size:24px;opacity:.12}
.stat-label{font-size:10px;color:${C.muted};font-weight:600;margin-bottom:4px;text-transform:uppercase;letter-spacing:.5px}
.stat-value{font-size:24px;font-weight:700;line-height:1}
.sv-blue{color:${C.accent}}.sv-green{color:${C.green}}.sv-red{color:${C.red}}.sv-yellow{color:${C.yellow}}.sv-purple{color:${C.purple}}
.t-blue{border-top:2px solid ${C.accent}}.t-green{border-top:2px solid ${C.green}}.t-red{border-top:2px solid ${C.red}}.t-yellow{border-top:2px solid ${C.yellow}}.t-purple{border-top:2px solid ${C.purple}}
.card{background:${C.card};border:1px solid ${C.border};border-radius:13px;padding:13px;margin-bottom:10px}
.card-title{font-size:11px;font-weight:700;color:${C.muted};text-transform:uppercase;letter-spacing:.8px;margin-bottom:11px}
.avatar{width:38px;height:38px;border-radius:50%;background:linear-gradient(135deg,${C.accent},${C.purple});display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;color:#fff;flex-shrink:0}
.avatar.sm{width:30px;height:30px;font-size:11px}.avatar.lg{width:52px;height:52px;font-size:18px}
.user-info{flex:1;min-width:0}.user-name{font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.user-meta{font-size:10px;color:${C.muted};margin-top:1px}
.pill{display:inline-flex;align-items:center;gap:2px;padding:2px 8px;border-radius:20px;font-size:10px;font-weight:700;white-space:nowrap;flex-shrink:0}
.p-active{background:#22c55e18;color:${C.green};border:1px solid #22c55e33}
.p-inactive{background:#ef444418;color:${C.red};border:1px solid #ef444433}
.p-pending{background:#f59e0b18;color:${C.yellow};border:1px solid #f59e0b33}
.btn{display:inline-flex;align-items:center;gap:4px;padding:7px 12px;border-radius:9px;font-size:12px;font-weight:600;font-family:inherit;cursor:pointer;border:none;transition:all .15s;white-space:nowrap}
.btn:active{transform:scale(.96)}.btn:disabled{opacity:.45;pointer-events:none}
.btn-p{background:${C.accent};color:#fff}.btn-s{background:#22c55e20;color:${C.green};border:1px solid #22c55e40}
.btn-s:not(:disabled):hover{background:${C.green};color:#fff}
.btn-d{background:#ef444420;color:${C.red};border:1px solid #ef444440}
.btn-g{background:transparent;color:${C.muted};border:1px solid ${C.border}}.btn-g:hover{background:${C.border};color:${C.text}}
.btn-block{width:100%;justify-content:center;padding:10px}
.input,.ta,.sel{background:${C.panel};border:1px solid ${C.border};border-radius:9px;padding:9px 12px;color:${C.text};font-family:inherit;font-size:13px;width:100%;outline:none;transition:border-color .2s;-webkit-appearance:none}
.input:focus,.ta:focus,.sel:focus{border-color:${C.accent}}.input::placeholder,.ta::placeholder{color:${C.muted}}
.ta{resize:vertical;min-height:75px}.field{margin-bottom:10px}
.field label{display:block;font-size:10px;font-weight:700;color:${C.muted};letter-spacing:.8px;margin-bottom:4px;text-transform:uppercase}
.sw{position:relative;margin-bottom:10px}.sw .si{position:absolute;left:10px;top:50%;transform:translateY(-50%);font-size:14px;pointer-events:none}.sw .input{padding-left:32px}
.ftabs{display:flex;gap:5px;margin-bottom:11px;overflow-x:auto;padding-bottom:2px;scrollbar-width:none}.ftabs::-webkit-scrollbar{display:none}
.ftab{flex-shrink:0;padding:6px 12px;border-radius:20px;font-size:11px;font-weight:600;cursor:pointer;border:1px solid ${C.border};background:transparent;color:${C.muted};font-family:inherit;transition:all .15s}
.ftab.active{background:${C.accent};color:#fff;border-color:${C.accent}}
.rc{background:${C.panel};border:1px solid ${C.border};border-radius:11px;padding:11px;margin-bottom:8px}
.r-issue{font-size:12px;color:${C.text};line-height:1.5;background:${C.card};border-radius:7px;padding:7px 9px;margin-top:7px;border-left:2px solid ${C.red}}
.r-meta{font-size:10px;color:${C.muted};margin-top:4px;display:flex;gap:6px;flex-wrap:wrap}
.overlay{position:fixed;inset:0;background:#00000094;z-index:200;display:flex;align-items:flex-end}
.modal{background:${C.card};border:1px solid ${C.border};border-radius:20px 20px 0 0;padding:16px 16px 36px;width:100%;max-height:88dvh;overflow-y:auto;animation:su .22s ease}
.mhandle{width:32px;height:4px;background:${C.border};border-radius:4px;margin:0 auto 13px}
.mtitle{font-size:15px;font-weight:700;margin-bottom:13px;display:flex;align-items:center;gap:7px}
.fullscreen{position:fixed;inset:0;background:${C.bg};z-index:150;overflow-y:auto}
.fs-header{background:${C.card};border-bottom:1px solid ${C.border};padding:12px 14px;display:flex;align-items:center;gap:11px;position:sticky;top:0;z-index:10}
.back-btn{width:32px;height:32px;border-radius:8px;background:${C.panel};border:1px solid ${C.border};color:${C.text};font-size:15px;display:flex;align-items:center;justify-content:center;cursor:pointer;flex-shrink:0}
.skel{background:linear-gradient(90deg,${C.border},#1a2840,${C.border});background-size:200% 100%;animation:shim 1.4s infinite;border-radius:9px;height:64px;margin-bottom:8px}
.empty{text-align:center;padding:40px 20px;color:${C.muted}}.ei{font-size:36px;margin-bottom:8px;opacity:.25}
.toasts{position:fixed;top:13px;left:50%;transform:translateX(-50%);width:calc(100% - 26px);max-width:440px;z-index:999;display:flex;flex-direction:column;gap:6px;pointer-events:none}
.toast{background:${C.card};border:1px solid ${C.border};border-radius:11px;padding:10px 12px;display:flex;gap:8px;align-items:flex-start;animation:ti .25s ease;box-shadow:0 8px 28px #00000080;pointer-events:all}
.toast.success{border-left:3px solid ${C.green}}.toast.error{border-left:3px solid ${C.red}}.toast.warn{border-left:3px solid ${C.yellow}}.toast.info{border-left:3px solid ${C.accent}}
.t-icon{font-size:16px}.t-body{flex:1}.t-title{font-size:12px;font-weight:700}.t-msg{font-size:11px;color:${C.muted};margin-top:1px}
.atabs{display:flex;background:${C.panel};border-radius:10px;padding:3px;margin-bottom:11px;gap:3px}
.atab{flex:1;text-align:center;padding:7px 3px;border-radius:7px;font-size:11px;font-weight:600;cursor:pointer;border:none;background:transparent;color:${C.muted};font-family:inherit;transition:all .2s}
.atab.active{background:${C.card};color:${C.text};box-shadow:0 2px 6px #00000040}
.srow{display:flex;align-items:center;justify-content:space-between;padding:8px 0;border-bottom:1px solid ${C.border}40;font-size:12px}.srow:last-child{border-bottom:none}
.sbar{height:3px;border-radius:3px;background:${C.border};flex:1;margin:3px 6px 0 0;overflow:hidden}.sbar-f{height:100%;border-radius:3px;transition:width .6s ease}
.slabel{font-size:10px;font-weight:700;color:${C.muted};letter-spacing:1.2px;text-transform:uppercase;margin:14px 0 8px}
.nrow{display:flex;gap:8px;align-items:flex-start;padding:9px 0;border-bottom:1px solid ${C.border}40}.nrow:last-child{border-bottom:none}
.ndot{width:7px;height:7px;border-radius:50%;margin-top:4px;flex-shrink:0}.ndot.n{background:${C.accent}}.ndot.o{background:${C.muted}}
.ncontent{flex:1}.ntitle{font-size:12px;font-weight:600}.nsub{font-size:11px;color:${C.muted};margin-top:1px}.ntime{font-size:10px;color:${C.muted};white-space:nowrap}
.steps{display:flex;margin-bottom:16px}.step{flex:1;text-align:center;font-size:10px;font-weight:700;padding:5px 2px;border-bottom:2px solid ${C.border};color:${C.muted};transition:all .2s}
.step.done{border-color:${C.green};color:${C.green}}.step.active{border-color:${C.accent};color:${C.accent}}
.bar-chart{display:flex;align-items:flex-end;gap:2px;height:64px;margin-top:5px}
.bar-col{display:flex;flex-direction:column;align-items:center;flex:1;gap:2px}
.bar-rect{width:100%;border-radius:3px 3px 0 0;min-height:2px}.bar-label{font-size:7px;color:${C.muted};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:26px;text-align:center}
.sr-item{display:flex;align-items:center;gap:9px;padding:9px;background:${C.panel};border:1px solid ${C.border};border-radius:10px;margin-bottom:6px;cursor:pointer;transition:border-color .15s}.sr-item:hover{border-color:${C.accent}}
.sr-tag{font-size:9px;font-weight:700;padding:2px 6px;border-radius:7px;background:${C.accent}20;color:${C.accent};flex-shrink:0}
.ring-wrap{position:relative;width:68px;height:68px;flex-shrink:0}.ring-wrap svg{transform:rotate(-90deg)}
.ring-pct{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700}
.type-pill{padding:6px 14px;border-radius:20px;font-size:11px;font-weight:700;cursor:pointer;border:1px solid ${C.border};background:transparent;color:${C.muted};font-family:inherit;transition:all .15s;flex-shrink:0}
.type-pill.active{background:${C.accent};color:#fff;border-color:${C.accent}}
.img-preview{width:100%;border-radius:9px;margin-top:6px;border:1px solid ${C.border}}
.correct-chip{padding:4px 10px;border-radius:8px;font-size:11px;font-weight:700;cursor:pointer;border:1px solid ${C.border};background:transparent;color:${C.muted};font-family:inherit;transition:all .15s;white-space:nowrap}
.correct-chip.active{background:${C.green}20;color:${C.green};border-color:${C.green}40}
@keyframes spin{to{transform:rotate(360deg)}}
@keyframes su{from{transform:translateY(36px);opacity:0}to{transform:translateY(0);opacity:1}}
@keyframes shim{0%{background-position:-200% 0}100%{background-position:200% 0}}
@keyframes ti{from{transform:translateY(-16px);opacity:0}to{transform:translateY(0);opacity:1}}
`;

/* ══════════════ MINI COMPONENTS ══════════════ */
function PerfRing({val,max,color}){
  const r=26,circ=2*Math.PI*r,p=max?Math.min(100,Math.round(val/max*100)):0;
  return(
    <div className="ring-wrap">
      <svg width="68" height="68" viewBox="0 0 68 68">
        <circle cx="34" cy="34" r={r} fill="none" stroke={C.border} strokeWidth="6"/>
        <circle cx="34" cy="34" r={r} fill="none" stroke={color} strokeWidth="6"
          strokeDasharray={`${circ*p/100} ${circ}`} strokeLinecap="round"/>
      </svg>
      <div className="ring-pct" style={{color}}>{p}%</div>
    </div>
  );
}

function MiniBar({data,color}){
  if(!data?.length)return null;
  const max=Math.max(...data.map(d=>d.v),1);
  return(
    <div className="bar-chart">
      {data.map((d,i)=>(
        <div key={i} className="bar-col">
          <div className="bar-rect" style={{height:(d.v/max*58)+"px",background:color,opacity:.85}}/>
          <div className="bar-label">{d.l}</div>
        </div>
      ))}
    </div>
  );
}

function SubjectTree({entries,total,color}){
  const[open,setOpen]=useState({});
  const tog=k=>setOpen(p=>({...p,[k]:!p[k]}));
  return(
    <>
      {entries.map(([sub,v])=>{
        const tops=Object.entries(v.topics||{});
        const isOpen=open[sub];
        return(
          <div key={sub} style={{marginBottom:7}}>
            <div style={{display:"flex",alignItems:"center",padding:"8px 0",borderBottom:`1px solid ${C.border}40`,cursor:tops.length?"pointer":"default"}} onClick={()=>tops.length&&tog(sub)}>
              <div style={{flex:1}}>
                <div style={{fontWeight:700,fontSize:12,display:"flex",alignItems:"center",gap:4}}>
                  {tops.length>0&&<span style={{fontSize:9,color:C.muted,display:"inline-block",transform:isOpen?"rotate(90deg)":"none",transition:"transform .2s"}}>▶</span>}
                  {sub}
                </div>
                <div style={{display:"flex",alignItems:"center",marginTop:3}}><div className="sbar"><div className="sbar-f" style={{width:pct(v.total,total)+"%",background:color}}/></div></div>
                <div style={{fontSize:9,color:C.muted,marginTop:1}}>MCQ:{v.mcq||0} · Written:{v.written||0}{tops.length?` · ${tops.length}টি Topic`:""}</div>
              </div>
              <div style={{fontWeight:700,color,fontSize:16,minWidth:32,textAlign:"right"}}>{v.total}</div>
            </div>
            {isOpen&&tops.map(([topic,tv])=>{
              const sts=Object.entries(tv.subtopics||{});
              const tOpen=open[sub+"__"+topic];
              return(
                <div key={topic} style={{marginLeft:12,borderLeft:`2px solid ${color}30`}}>
                  <div style={{display:"flex",alignItems:"center",padding:"6px 0 6px 9px",cursor:sts.length?"pointer":"default"}} onClick={()=>sts.length&&tog(sub+"__"+topic)}>
                    <div style={{flex:1}}>
                      <div style={{fontSize:11,fontWeight:600,display:"flex",alignItems:"center",gap:3}}>
                        {sts.length>0&&<span style={{fontSize:8,color:C.muted,display:"inline-block",transform:tOpen?"rotate(90deg)":"none",transition:"transform .2s"}}>▶</span>}
                        📂 {topic}
                      </div>
                    </div>
                    <div style={{fontWeight:700,color,fontSize:13,minWidth:28,textAlign:"right"}}>{tv.total}</div>
                  </div>
                  {tOpen&&sts.map(([st,stv])=>(
                    <div key={st} style={{display:"flex",alignItems:"center",padding:"5px 0 5px 18px",borderBottom:`1px solid ${C.border}20`}}>
                      <div style={{flex:1}}><div style={{fontSize:10,color:C.text}}>📄 {st}</div><div style={{fontSize:9,color:C.muted}}>MCQ:{stv.mcq||0} · Written:{stv.written||0}</div></div>
                      <div style={{fontWeight:600,color:C.muted,fontSize:12,minWidth:26,textAlign:"right"}}>{stv.total}</div>
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

/* ══════════════════════════════════════════
   DASHBOARD
   — _DashStats (tiny JSON) থেকে instant load
   — Users count Firebase থেকে
══════════════════════════════════════════ */
function DashboardPage({push,forceRefresh}){
  // _DashStats = GAS এ manualSyncAll() চালালে তৈরি হয় (tiny pre-computed JSON)
  const{data:stats,loading:l1}  = useFB("_DashStats",forceRefresh);
  const{data:users,loading:l2}  = useFB("Users",forceRefresh);
  const{data:summary}            = useFB("Analytics/Summary",forceRefresh);
  const[atab,setAtab]            = useState("quiz");

  // Users count
  const userArr = toArr(users);
  const total   = userArr.length;
  const active  = userArr.filter(u=>(u.Status||u.status||"").toLowerCase()==="active").length;

  // Stats from _DashStats
  const quizMap   = stats?.quiz   || {};
  const qbankMap  = stats?.qbank  || {};
  const quizTotal = stats?.quizTotal  || 0;
  const qbTotal   = stats?.qbankTotal || 0;
  const stTotal   = stats?.studyTotal || 0;
  const rptTotal  = stats?.reportTotal|| 0;

  const quizE  = Object.entries(quizMap);
  const qbankE = Object.entries(qbankMap);

  // Daily active
  const days=[...Array(7)].map((_,i)=>{
    const d=new Date();d.setDate(d.getDate()-(6-i));
    const label=`${d.getDate()}/${d.getMonth()+1}`;
    const count=summary&&typeof summary==="object"
      ?Object.values(summary).filter(u=>{const la=u.lastActive||"";try{return new Date(la).toDateString()===d.toDateString();}catch{return false;}}).length:0;
    return{l:label,v:count};
  });

  const loading=l1&&l2;
  if(loading&&!stats&&!users)return(
    <div className="page">
      <div className="stat-grid">{[...Array(4)].map((_,i)=><div key={i} className="skel" style={{height:74,borderRadius:13}}/>)}</div>
      {[...Array(3)].map((_,i)=><div key={i} className="skel"/>)}
    </div>
  );

  return(
    <div className="page">
      <div className="stat-grid">
        <div className="stat-card t-blue"   data-icon="👥"><div className="stat-label">স্টুডেন্ট</div><div className="stat-value sv-blue">{fmt(total)}</div></div>
        <div className="stat-card t-green"  data-icon="✅"><div className="stat-label">অ্যাক্টিভ</div><div className="stat-value sv-green">{fmt(active)}</div></div>
        <div className="stat-card t-yellow" data-icon="⏳"><div className="stat-label">পেন্ডিং</div><div className="stat-value sv-yellow">{fmt(total-active)}</div></div>
        <div className="stat-card t-red"    data-icon="🚨"><div className="stat-label">রিপোর্ট</div><div className="stat-value sv-red">{fmt(rptTotal)}</div></div>
      </div>
      <div className="stat-grid">
        <div className="stat-card t-blue"   data-icon="❓"><div className="stat-label">Quiz</div><div className="stat-value sv-blue">{fmt(quizTotal)}</div></div>
        <div className="stat-card t-green"  data-icon="📚"><div className="stat-label">QBank</div><div className="stat-value sv-green">{fmt(qbTotal)}</div></div>
        <div className="stat-card t-yellow" data-icon="📖"><div className="stat-label">Study</div><div className="stat-value sv-yellow">{fmt(stTotal)}</div></div>
        <div className="stat-card t-purple" data-icon="📊"><div className="stat-label">মোট</div><div className="stat-value sv-purple">{fmt(quizTotal+qbTotal+stTotal)}</div></div>
      </div>
      {!stats&&<div style={{background:"#f59e0b18",border:"1px solid #f59e0b30",borderRadius:10,padding:"8px 12px",fontSize:11,color:C.yellow,marginBottom:10}}>⚠️ GAS এ একবার manualSyncAll() চালান — stats আপডেট হবে</div>}
      <div className="card">
        <div className="card-title">📈 Daily Active (৭ দিন)</div>
        <MiniBar data={days} color={C.accent}/>
        <div style={{display:"flex",justifyContent:"space-between",marginTop:6,fontSize:10,color:C.muted}}>
          <span>সর্বোচ্চ: <b style={{color:C.accent}}>{Math.max(...days.map(d=>d.v),0)}</b></span>
          <span>মোট: <b style={{color:C.accent}}>{days.reduce((s,d)=>s+d.v,0)}</b></span>
        </div>
      </div>
      <div className="card">
        <div className="card-title">📊 Analytics</div>
        <div className="atabs">
          {[["quiz","❓ Quiz"],["qbank","📚 QBank"],["study","📖 Study"]].map(([v,l])=>(
            <button key={v} className={`atab${atab===v?" active":""}`} onClick={()=>setAtab(v)}>{l}</button>
          ))}
        </div>
        {atab==="quiz"&&(quizE.length===0
          ?<div style={{textAlign:"center",color:C.muted,padding:"12px 0",fontSize:12}}>ডেটা নেই — manualSyncAll() চালান</div>
          :<SubjectTree entries={quizE} total={quizTotal} color={C.accent}/>
        )}
        {atab==="qbank"&&(qbankE.length===0
          ?<div style={{textAlign:"center",color:C.muted,padding:"12px 0",fontSize:12}}>ডেটা নেই</div>
          :<SubjectTree entries={qbankE} total={qbTotal} color={C.green}/>
        )}
        {atab==="study"&&<div style={{textAlign:"center",color:C.muted,padding:"12px 0",fontSize:12}}>{fmt(stTotal)}টি নোট</div>}
      </div>
    </div>
  );
}

/* ══════════════ SIGNUPS ══════════════ */
function SignupsPage({push,forceRefresh}){
  const{data:pending,loading}=useFB("PendingSignups",forceRefresh);
  const[activating,setActivating]=useState(null);
  const[done,setDone]=useState([]);

  const rows=pending&&typeof pending==="object"
    ?Object.entries(pending).filter(([k,v])=>v&&!v.approved&&!done.includes(k)).map(([k,v])=>({...v,_key:k}))
    :[];

  const activate=async(u)=>{
    const key=u._key;
    setActivating(key);
    try{
      const phone=u.phone||u.Phone||"";
      const phKey=phone.replace(/[.#$\[\]\s]/g,'_');
      await Promise.all([
        fb.patch(`Users/${phKey}`,{Name:u.name||u.Name||"",Phone:phone,Status:"Active",Role:"Student",approvedAt:new Date().toISOString()}),
        fb.patch(`PendingSignups/${key}`,{approved:true}),
        fb.set(`Notifications/${phKey}/welcome`,{type:"welcome",title:"🎉 অ্যাকাউন্ট অ্যাক্টিভ!",body:"Smart Study-তে স্বাগতম!",time:nowTs(),read:false}),
      ]);
      // Background GAS FCM + Sheet
      gasBg({action:"activateUser",phone});
      push("success","✅ অ্যাক্টিভ!",u.name||u.Name||"");
      setDone(p=>[...p,key]);
      fbInvalidate("PendingSignups","Users");
    }catch(e){push("error","ব্যর্থ",e.message);}
    setActivating(null);
  };

  return(
    <div className="page">
      <div style={{background:"#ef444412",border:"1px solid #ef444430",borderRadius:10,padding:"8px 12px",fontSize:12,color:C.red,fontWeight:600,marginBottom:11,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
        <span>🔔 {rows.length}টি পেন্ডিং</span>
        {loading&&<span style={{fontSize:10,color:C.muted}}>⏳</span>}
      </div>
      {loading&&!pending?[...Array(3)].map((_,i)=><div key={i} className="skel"/>):
       rows.length===0?<div className="empty"><div className="ei">🎉</div><p>সব অ্যাক্টিভ!</p></div>:
       rows.map((u,i)=>{
        const nm=u.name||u.Name||"অজানা",ph=u.phone||u.Phone||"—";
        return(
          <div key={i} className="card" style={{padding:12}}>
            <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:10}}>
              <div className="avatar">{initials(nm)}</div>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontWeight:700,fontSize:13}}>{nm}</div>
                <div style={{fontSize:11,color:C.muted}}>📱 {ph}</div>
                {u.email&&<div style={{fontSize:11,color:C.muted}}>✉️ {u.email}</div>}
                <div style={{fontSize:10,color:C.muted}}>🕐 {timeAgo(u.createdAt||u.timestamp)}</div>
              </div>
              <span className="pill p-pending">⏳ পেন্ডিং</span>
            </div>
            <button className="btn btn-s btn-block" disabled={!!activating} onClick={()=>activate(u)}>
              {activating===u._key?"⏳ হচ্ছে...":"✅ অ্যাক্টিভ করুন"}
            </button>
          </div>
        );
       })
      }
    </div>
  );
}

/* ══════════════ STUDENTS ══════════════ */
function StudentsPage({push,forceRefresh}){
  const{data:usersRaw,loading}=useFB("Users",forceRefresh);
  const{data:summary}=useFB("Analytics/Summary");
  const[overrides,setOverrides]=useState({});
  const[search,setSearch]=useState("");
  const[tab,setTab]=useState("all");
  const[detail,setDetail]=useState(null);
  const[notify,setNotify]=useState(null);
  const[activating,setActivating]=useState(null);

  const users=toArr(usersRaw).map(u=>{
    const ph=(u.Phone||u.phone||"").replace(/^'+/,"").replace(/^0+/,"");
    const sm=summary&&Object.entries(summary).find(([k])=>k.replace(/_/g,"").replace(/^0+/,"")===ph);
    const stats=sm?sm[1]:{};
    const ov=overrides[u.Phone||u.phone||u._key];
    return{...u,...stats,Status:ov||u.Status||u.status||"Inactive"};
  });

  const filtered=users.filter(u=>{
    const nm=(u.Name||u.name||"").toLowerCase();
    const ph=(u.Phone||u.phone||"").toLowerCase();
    const st=(u.Status||"").toLowerCase();
    const q=search.toLowerCase();
    return(!q||nm.includes(q)||ph.includes(q))&&(tab==="all"||st===tab);
  });

  const activate=async(u)=>{
    const phone=u.Phone||u.phone||"";
    if(!phone)return;
    setActivating(phone);
    try{
      const phKey=phone.replace(/[.#$\[\]\s]/g,'_');
      await fb.patch(`Users/${phKey}`,{Status:"Active"});
      fbInvalidate("Users");
      setOverrides(p=>({...p,[phone]:"Active"}));
      gasBg({action:"activateUser",phone});
      push("success","✅ অ্যাক্টিভ!",u.Name||u.name);
    }catch(e){push("error","ব্যর্থ",e.message);}
    setActivating(null);
  };

  if(detail)return<StudentDetail user={detail} onBack={()=>setDetail(null)} push={push}/>;

  return(
    <div className="page">
      <div className="sw"><span className="si">🔍</span><input className="input" placeholder="নাম বা ফোন..." value={search} onChange={e=>setSearch(e.target.value)}/></div>
      <div className="ftabs">
        {[["all","সবাই"],["active","✅ অ্যাক্টিভ"],["inactive","🔴 ইনঅ্যাক্টিভ"]].map(([v,l])=>(
          <button key={v} className={`ftab${tab===v?" active":""}`} onClick={()=>setTab(v)}>{l}</button>
        ))}
      </div>
      <div style={{fontSize:11,color:C.muted,marginBottom:8}}>{filtered.length} জন</div>
      {loading&&!usersRaw?[...Array(4)].map((_,i)=><div key={i} className="skel"/>):
       filtered.length===0?<div className="empty"><div className="ei">👤</div><p>কেউ নেই</p></div>:
       filtered.map((u,i)=>{
        const nm=u.Name||u.name||"অজানা",ph=u.Phone||u.phone||"—";
        const st=(u.Status||"inactive").toLowerCase();
        const c=parseInt(u.totalCorrect)||0,w=parseInt(u.totalWrong)||0,tot=c+w;
        const acc=tot?Math.round(c/tot*100):0;
        return(
          <div key={i} className="card" style={{padding:11,cursor:"pointer"}} onClick={()=>setDetail(u)}>
            <div style={{display:"flex",alignItems:"center",gap:9,marginBottom:8}}>
              <div className="avatar">{initials(nm)}</div>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontWeight:700,fontSize:13}}>{nm}</div>
                <div style={{fontSize:10,color:C.muted}}>📱 {ph}</div>
              </div>
              <div style={{textAlign:"right"}}>
                <span className={`pill p-${st==="active"?"active":"inactive"}`}>{st==="active"?"✅":"🔴"} {st==="active"?"অ্যাক্টিভ":"ইনঅ্যাক্টিভ"}</span>
                {tot>0&&<div style={{fontSize:9,color:acc>=70?C.green:acc>=40?C.yellow:C.red,marginTop:2,fontWeight:700}}>{acc}%</div>}
              </div>
            </div>
            <div style={{display:"flex",gap:6,marginBottom:8}}>
              {[[C.green,c,"✅"],[C.red,w,"❌"],[C.accent,parseInt(u.totalMinutes)||0,"⏱"]].map(([cl,val,ic])=>(
                <div key={ic} style={{textAlign:"center",flex:1,background:C.panel,borderRadius:7,padding:"5px 2px"}}>
                  <div style={{color:cl,fontWeight:700,fontSize:13}}>{val}</div>
                  <div style={{color:C.muted,fontSize:9}}>{ic}</div>
                </div>
              ))}
            </div>
            <div style={{display:"flex",gap:6}} onClick={e=>e.stopPropagation()}>
              {st!=="active"&&<button className="btn btn-s" style={{flex:1,justifyContent:"center",fontSize:11}} disabled={!!activating} onClick={()=>activate(u)}>{activating===ph?"⏳":"✅ অ্যাক্টিভ"}</button>}
              <button className="btn btn-g" style={{flex:1,justifyContent:"center",fontSize:11}} onClick={()=>setNotify(u)}>📣</button>
              <button className="btn btn-p" style={{flex:1,justifyContent:"center",fontSize:11}} onClick={()=>setDetail(u)}>👁</button>
            </div>
          </div>
        );
       })
      }
      {notify&&<NotifyModal user={notify} onClose={()=>setNotify(null)} push={push}/>}
    </div>
  );
}

function StudentDetail({user,onBack,push}){
  const nm=user.Name||user.name||"অজানা";
  const ph=(user.Phone||user.phone||"").replace(/^'+/,"");
  const phKey=ph.replace(/[.#$\[\]\s]/g,'_').replace(/^0+/,"");
  const st=(user.Status||user.status||"inactive").toLowerCase();
  const{data:timeData}=useFB(`Analytics/Time/${phKey}`);
  const{data:subjData}=useFB(`Analytics/Subject/${phKey}`);
  const c=parseInt(user.totalCorrect)||0,w=parseInt(user.totalWrong)||0,tot=c+w;
  const acc=tot?Math.round(c/tot*100):0;
  const mins=parseInt(user.totalMinutes)||0;
  const dailyTime=timeData&&typeof timeData==="object"
    ?Object.entries(timeData).sort(([a],[b])=>a.localeCompare(b)).slice(-7).map(([d,v])=>({l:d.slice(5),v:parseInt(v)||0})):[];
  const subjEntries=subjData&&typeof subjData==="object"?Object.entries(subjData):[];
  return(
    <div className="fullscreen">
      <div className="fs-header">
        <button className="back-btn" onClick={onBack}>←</button>
        <div className="avatar">{initials(nm)}</div>
        <div style={{flex:1,minWidth:0}}>
          <div style={{fontWeight:700,fontSize:14,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{nm}</div>
          <div style={{fontSize:10,color:C.muted}}>📱 {ph}</div>
        </div>
        <span className={`pill p-${st==="active"?"active":"inactive"}`}>{st==="active"?"✅":"🔴"}</span>
      </div>
      <div style={{padding:"12px 12px 70px"}}>
        <div className="card">
          <div style={{display:"flex",alignItems:"center",gap:12}}>
            <PerfRing val={c} max={tot} color={acc>=70?C.green:acc>=40?C.yellow:C.red}/>
            <div style={{flex:1}}>
              <div style={{fontSize:18,fontWeight:700,color:acc>=70?C.green:acc>=40?C.yellow:C.red,marginBottom:3}}>{acc}% Accuracy</div>
              <div style={{fontSize:11,color:C.muted}}>✅ {c} &nbsp; ❌ {w} &nbsp; 🎯 {tot}</div>
              <div style={{fontSize:11,color:C.muted,marginTop:2}}>📋 {parseInt(user.totalQuizzes)||0}টি Quiz</div>
            </div>
          </div>
        </div>
        <div className="stat-grid">
          <div className="stat-card t-purple" data-icon="⏱"><div className="stat-label">মোট সময়</div><div className="stat-value sv-purple" style={{fontSize:18}}>{mins<60?mins+"মি":~~(mins/60)+"ঘণ্টা"}</div></div>
          <div className="stat-card t-blue" data-icon="📅"><div className="stat-label">শেষ সক্রিয়</div><div style={{fontSize:12,fontWeight:700,marginTop:5,color:C.accent}}>{timeAgo(user.lastActive||user.Timestamp)}</div></div>
        </div>
        {dailyTime.length>0&&<div className="card"><div className="card-title">⏱ দৈনিক সময় (মিনিট)</div><MiniBar data={dailyTime} color={C.purple}/></div>}
        {subjEntries.length>0&&(
          <div className="card">
            <div className="card-title">📚 বিষয়ভিত্তিক</div>
            {subjEntries.map(([sub,sv])=>{
              const sc=sv.correct||0,sw2=sv.wrong||0,stot=sc+sw2,sa=stot?Math.round(sc/stot*100):0;
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
          <div className="card-title">👤 তথ্য</div>
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

/* ══════════════ REPORTS ══════════════ */
function ReportsPage({push,forceRefresh}){
  const{data:rRaw,loading}=useFB("Reports",forceRefresh);
  const[done,setDone]=useState([]);
  const[editing,setEditing]=useState(null);

  const reports=toArr(rRaw).filter(r=>!done.includes(r._key||r.row)).slice(-30).reverse();

  return(
    <div className="page">
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:11}}>
        <div style={{fontSize:11,color:C.muted}}>{reports.length}টি রিপোর্ট</div>
        {loading&&<span style={{fontSize:10,color:C.muted}}>⏳</span>}
      </div>
      {loading&&!rRaw?[...Array(3)].map((_,i)=><div key={i} className="skel"/>):
       reports.length===0?<div className="empty"><div className="ei">📋</div><p>কোনো রিপোর্ট নেই! 🎉</p></div>:
       reports.map((r,i)=>(
        <div key={i} className="rc">
          <div style={{fontWeight:700,fontSize:13}}>{r.Subject||r.subject||"অজানা"}</div>
          <div className="r-meta">
            <span>📱 {r.Phone||r.phone||"—"}</span>
            {(r.SubTopic||r.subtopic)&&<span>📌 {r.SubTopic||r.subtopic}</span>}
            {(r.QuestionID||r.questionId)&&<span style={{color:C.accent}}>#{r.QuestionID||r.questionId}</span>}
            <span>{timeAgo(r.timestamp||r.time)}</span>
          </div>
          <div className="r-issue">{r.Issue||r.issue||r.Question||r.question||"বিস্তারিত নেই"}</div>
          <button className="btn btn-p btn-block" style={{marginTop:8}} onClick={()=>setEditing(r)}>✏️ এডিট ও সমাধান</button>
        </div>
       ))
      }
      {editing&&<ReportEditModal report={editing} onClose={()=>setEditing(null)} onDone={key=>{setDone(p=>[...p,key]);setEditing(null);fbInvalidate("Reports");}} push={push}/>}
    </div>
  );
}

function ReportEditModal({report,onClose,onDone,push}){
  const[step,setStep]=useState(1);
  const[qdata,setQdata]=useState(null);
  const[loadQ,setLoadQ]=useState(true);
  const[saving,setSaving]=useState(false);
  const[notifying,setNotifying]=useState(false);
  const qid=(report.QuestionID||report.questionId||"").toString();

  const[question,setQuestion]=useState("");
  const[opt1,setOpt1]=useState(""); const[opt2,setOpt2]=useState("");
  const[opt3,setOpt3]=useState(""); const[opt4,setOpt4]=useState("");
  const[correct,setCorrect]=useState("");
  const[explanation,setExplanation]=useState("");
  const[technique,setTechnique]=useState("");

  useEffect(()=>{
    if(!qid){setLoadQ(false);return;}
    (async()=>{
      setLoadQ(true);
      for(const t of["Quiz","QBank"]){
        try{
          const raw=await fb.get(t);
          const arr=toArr(raw);
          const q=arr.find(x=>(x.ID||x.id||"").toString()===qid);
          if(q){
            setQdata({...q,_tab:t,_key:q._key});
            setQuestion(q.Question||q.question||"");
            setOpt1(q.Opt1||q.opt1||q["Option A"]||"");
            setOpt2(q.Opt2||q.opt2||q["Option B"]||"");
            setOpt3(q.Opt3||q.opt3||q["Option C"]||"");
            setOpt4(q.Opt4||q.opt4||q["Option D"]||"");
            setCorrect(q.Correct||q.correct||"");
            setExplanation(q.Explanation||q.explanation||"");
            setTechnique(q.Technique||q.technique||"");
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
        const updated={...qdata,Question:question,Opt1:opt1,Opt2:opt2,Opt3:opt3,Opt4:opt4,Correct:correct,Explanation:explanation,Technique:technique};
        delete updated._key; delete updated._tab;
        // Firebase update
        if(qdata._key){
          await fb.patch(`${t}/${qdata._key}`,{Question:question,Opt1:opt1,Opt2:opt2,Opt3:opt3,Opt4:opt4,Correct:correct,Explanation:explanation,Technique:technique});
        }
        fbInvalidate(t);
        // Background GAS Sheet sync (সব field)
        const fields=[["question",question],["opt1",opt1],["opt2",opt2],["opt3",opt3],["opt4",opt4],["correct",correct],["explanation",explanation],["technique",technique]];
        fields.forEach(([field,value])=>{
          if(value.trim()) gasBg({action:"updateField",sheet:t,id:qid,field,content:encodeURIComponent(value)});
        });
      }
      push("success","✅ Firebase ও Sheet-এ সেভ হয়েছে!","");
      setStep(2);
    }catch(e){push("error","Save ব্যর্থ",e.message);}
    setSaving(false);
  };

  const notify=async()=>{
    setNotifying(true);
    try{
      const phone=(report.Phone||report.phone||"");
      const phKey=phone.replace(/[.#$\[\]\s]/g,'_');
      await fb.set(`Notifications/${phKey}/notif_${Date.now()}`,{
        type:"report_resolved",title:"✅ রিপোর্ট সমাধান হয়েছে!",
        body:`"${report.Subject||report.subject||"প্রশ্নটি"}" সংশোধন করা হয়েছে।`,
        questionId:qid,time:nowTs(),read:false
      });
      gasBg({action:"resolveReport",phone,subject:encodeURIComponent(report.Subject||report.subject||"প্রশ্নটি"),questionId:qid});
      push("success","✅ নোটিফাই হয়েছে!","");
      onDone(report._key||report.row);
    }catch(e){push("error","Notify ব্যর্থ",e.message);}
    setNotifying(false);
  };

  return(
    <div className="overlay">
      <div className="modal">
        <div className="mhandle"/>
        <div className="steps">
          <div className={`step${step===1?" active":step>1?" done":""}`}>① এডিট</div>
          <div className={`step${step===2?" active":""}`}>② নোটিফাই</div>
        </div>
        {step===1&&<>
          <div className="mtitle">✏️ প্রশ্ন এডিট</div>
          <div style={{background:"#ef444412",border:"1px solid #ef444430",borderRadius:9,padding:"7px 10px",marginBottom:10}}>
            <div style={{fontSize:10,color:C.red,fontWeight:700,marginBottom:2}}>🚨 {report.Phone||report.phone} · {report.Subject||report.subject}</div>
            <div style={{fontSize:11,color:C.text}}>{report.Issue||report.issue||"—"}</div>
          </div>
          {loadQ?<><div className="skel" style={{height:46}}/><div className="skel"/></>:
           !qdata?<div style={{textAlign:"center",color:C.muted,padding:"14px 0",fontSize:12}}>প্রশ্ন #{qid||"—"} পাওয়া যায়নি।</div>:
           <>
            <div className="field"><label>❓ প্রশ্ন</label><textarea className="ta" value={question} onChange={e=>setQuestion(e.target.value)} style={{minHeight:65}}/></div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:7}}>
              <div className="field"><label>A</label><input className="input" value={opt1} onChange={e=>setOpt1(e.target.value)}/></div>
              <div className="field"><label>B</label><input className="input" value={opt2} onChange={e=>setOpt2(e.target.value)}/></div>
              <div className="field"><label>C</label><input className="input" value={opt3} onChange={e=>setOpt3(e.target.value)}/></div>
              <div className="field"><label>D</label><input className="input" value={opt4} onChange={e=>setOpt4(e.target.value)}/></div>
            </div>
            <div className="field">
              <label>✅ সঠিক উত্তর</label>
              <div style={{display:"flex",gap:4,flexWrap:"wrap",marginBottom:5}}>
                {[opt1,opt2,opt3,opt4].filter(Boolean).map((o,i)=>(
                  <button key={i} type="button" className={`correct-chip${correct===o?" active":""}`} onClick={()=>setCorrect(o)}>{o.slice(0,14)}{o.length>14?"…":""}</button>
                ))}
              </div>
              <input className="input" value={correct} onChange={e=>setCorrect(e.target.value)} placeholder="বা সরাসরি লিখুন..."/>
            </div>
            <div className="field"><label>📖 Explanation</label><textarea className="ta" value={explanation} onChange={e=>setExplanation(e.target.value)} style={{minHeight:75}}/></div>
            <div className="field"><label>💡 Technique</label><textarea className="ta" value={technique} onChange={e=>setTechnique(e.target.value)} style={{minHeight:55}}/></div>
           </>
          }
          <div style={{display:"flex",gap:6}}>
            <button type="button" className="btn btn-g" style={{flex:1,justifyContent:"center"}} onClick={onClose}>বাতিল</button>
            <button type="button" className="btn btn-p" style={{flex:2,justifyContent:"center"}} disabled={saving} onClick={save}>{saving?"⏳...":"💾 সেভ →"}</button>
          </div>
        </>}
        {step===2&&<>
          <div className="mtitle">📣 নোটিফাই</div>
          <div style={{background:"#22c55e12",border:"1px solid #22c55e30",borderRadius:10,padding:"11px",marginBottom:12}}>
            <div style={{fontSize:13,fontWeight:700,color:C.green,marginBottom:4}}>✅ এডিট সম্পন্ন!</div>
            <div style={{fontSize:11,color:C.muted}}>Firebase ও Sheet দুটোতেই আপডেট হয়েছে।</div>
          </div>
          <div style={{background:C.panel,borderRadius:9,padding:"10px 12px",marginBottom:12}}>
            <div style={{fontWeight:700}}>📱 {report.Phone||report.phone}</div>
            <div style={{fontSize:11,color:C.accent,marginTop:4}}>"✅ রিপোর্ট সমাধান হয়েছে!"</div>
          </div>
          <div style={{display:"flex",gap:6}}>
            <button className="btn btn-g" style={{flex:1,justifyContent:"center"}} onClick={()=>onDone(report._key||report.row)}>এড়িয়ে যান</button>
            <button className="btn btn-s" style={{flex:2,justifyContent:"center"}} disabled={notifying} onClick={notify}>{notifying?"⏳...":"✅ নোটিফাই"}</button>
          </div>
        </>}
      </div>
    </div>
  );
}

/* ══════════════ ENTRY ══════════════ */
function EntryPage({push}){
  const[mode,setMode]=useState("Quiz");
  const[qtype,setQtype]=useState("MCQ");
  const[saving,setSaving]=useState(false);
  const[uploading,setUploading]=useState(false);
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

  const subjects=[...new Set(toArr(quizRaw).map(q=>q.Subject||q.subject||"").filter(Boolean))];

  const reset=()=>{setQuestion("");setOpt1("");setOpt2("");setOpt3("");setOpt4("");setCorrect("");setExplanation("");setTechnique("");setImgUrl("");};

  const handleImg=async(e)=>{
    const f=e.target.files[0];if(!f)return;
    setUploading(true);
    try{const url=await uploadImg(f);setImgUrl(url);push("success","ছবি আপলোড হয়েছে","");}
    catch{push("error","আপলোড ব্যর্থ","");}
    setUploading(false);
  };

  const submit=async()=>{
    if(!question.trim()&&mode!=="Study"){push("warn","প্রশ্ন লিখুন","");return;}
    if(!subject.trim()){push("warn","বিষয় লিখুন","");return;}
    if(mode!=="Study"&&qtype==="MCQ"&&!correct){push("warn","সঠিক উত্তর দিন","");return;}
    setSaving(true);
    try{
      const ts=nowTs();
      const id=Date.now();
      let record={};
      if(mode==="Quiz") record={ID:id,Question:question,Opt1:opt1,Opt2:opt2,Opt3:opt3,Opt4:opt4,Correct:correct,Subject:subject,Sub_topic:subtopic,Explanation:explanation,Technique:technique,QType:qtype,Timestamp:ts,Image:imgUrl};
      else if(mode==="QBank") record={ID:id,Question:question,Opt1:opt1,Opt2:opt2,Opt3:opt3,Opt4:opt4,Correct:correct,Subject:subject,Topic:topic,Sub_topic:subtopic,Explanation:explanation,Technique:technique,QType:qtype,Timestamp:ts,Image:imgUrl};
      else record={ID:id,Subject:subject,Sub_topic:subtopic,Explanation:explanation,Technique:technique,Timestamp:ts,Image:imgUrl};

      // ① Firebase instant write
      await fb.push(mode,record);
      fbInvalidate(mode,"_DashStats");

      // ② Background GAS Sheet sync
      const gasParams=mode==="Quiz"
        ?{targetTab:"Quiz",question,opt1,opt2,opt3,opt4,correct,subject,sub_topic:subtopic,explanation,technique,qType:qtype,timestamp:ts,audienceTags:"General"}
        :mode==="QBank"
          ?{targetTab:"QBank",question,opt1,opt2,opt3,opt4,correct,subject,topic,sub_topic:subtopic,explanation,technique,qType:qtype,timestamp:ts}
          :{targetTab:"Study",subject,sub_topic:subtopic,explanation,technique,timestamp:ts};
      gasPost(gasParams);

      push("success","✅ সেভ হয়েছে!",`${mode} #${id}`);
      reset();
    }catch(e){push("error","ব্যর্থ",e.message);}
    setSaving(false);
  };

  return(
    <div className="page">
      <div className="ftabs">
        {["Quiz","QBank","Study"].map(m=><button key={m} className={`ftab${mode===m?" active":""}`} onClick={()=>setMode(m)}>{m}</button>)}
      </div>
      {mode!=="Study"&&(
        <div style={{display:"flex",gap:7,marginBottom:11}}>
          {["MCQ","Written"].map(t=><button key={t} className={`type-pill${qtype===t?" active":""}`} onClick={()=>setQtype(t)}>{t}</button>)}
        </div>
      )}
      {mode!=="Study"&&<div className="field"><label>❓ প্রশ্ন</label><textarea className="ta" value={question} onChange={e=>setQuestion(e.target.value)} style={{minHeight:80}}/></div>}
      {mode!=="Study"&&qtype==="MCQ"&&(
        <>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
            <div className="field"><label>A</label><input className="input" value={opt1} onChange={e=>setOpt1(e.target.value)} placeholder="Option A"/></div>
            <div className="field"><label>B</label><input className="input" value={opt2} onChange={e=>setOpt2(e.target.value)} placeholder="Option B"/></div>
            <div className="field"><label>C</label><input className="input" value={opt3} onChange={e=>setOpt3(e.target.value)} placeholder="Option C"/></div>
            <div className="field"><label>D</label><input className="input" value={opt4} onChange={e=>setOpt4(e.target.value)} placeholder="Option D"/></div>
          </div>
          <div className="field">
            <label>✅ সঠিক উত্তর</label>
            <div style={{display:"flex",gap:5,flexWrap:"wrap",marginBottom:6}}>
              {[opt1,opt2,opt3,opt4].filter(Boolean).map((o,i)=>(
                <button key={i} type="button" className={`correct-chip${correct===o?" active":""}`} onClick={()=>setCorrect(o)}>{o.slice(0,16)}{o.length>16?"…":""}</button>
              ))}
            </div>
            <input className="input" value={correct} onChange={e=>setCorrect(e.target.value)} placeholder="বা সরাসরি লিখুন..."/>
          </div>
        </>
      )}
      <div className="field">
        <label>📚 বিষয়</label>
        <input className="input" list="subj-list" value={subject} onChange={e=>setSubject(e.target.value)} placeholder="Subject..."/>
        <datalist id="subj-list">{subjects.map((s,i)=><option key={i} value={s}/>)}</datalist>
      </div>
      {mode==="QBank"&&<div className="field"><label>📂 Topic</label><input className="input" value={topic} onChange={e=>setTopic(e.target.value)} placeholder="Topic..."/></div>}
      <div className="field"><label>📌 Sub Topic</label><input className="input" value={subtopic} onChange={e=>setSubtopic(e.target.value)} placeholder="Sub Topic..."/></div>
      <div className="field"><label>📖 Explanation</label><textarea className="ta" value={explanation} onChange={e=>setExplanation(e.target.value)} style={{minHeight:80}}/></div>
      <div className="field"><label>💡 Technique</label><textarea className="ta" value={technique} onChange={e=>setTechnique(e.target.value)} style={{minHeight:60}}/></div>
      <div className="field">
        <label>🖼 ছবি (optional)</label>
        <div style={{display:"flex",gap:7,alignItems:"center"}}>
          <label style={{flex:1,background:C.panel,border:`1px solid ${C.border}`,borderRadius:9,padding:"9px 12px",cursor:"pointer",display:"flex",alignItems:"center",gap:7,fontSize:12,color:C.muted}}>
            {uploading?"⏳ আপলোড হচ্ছে...":"📷 ছবি বেছে নিন"}
            <input type="file" accept="image/*" style={{display:"none"}} onChange={handleImg}/>
          </label>
          {imgUrl&&<a href={imgUrl} target="_blank" rel="noreferrer" style={{fontSize:11,color:C.accent}}>দেখুন ↗</a>}
        </div>
        {imgUrl&&<img src={imgUrl} className="img-preview" alt="preview"/>}
      </div>
      <button className="btn btn-p btn-block" style={{marginTop:4}} disabled={saving} onClick={submit}>
        {saving?"⏳ সেভ হচ্ছে...":"💾 Firebase-এ সেভ করুন"}
      </button>
    </div>
  );
}

/* ══════════════ SEARCH ══════════════ */
function SearchPage({push,onStudentDetail}){
  const[q,setQ]=useState("");
  const[results,setResults]=useState(null);
  const[loading,setLoading]=useState(false);
  const debRef=useRef(null);
  const{data:quizRaw}=useFB("Quiz");
  const{data:qbankRaw}=useFB("QBank");
  const{data:usersRaw}=useFB("Users");

  const doSearch=useCallback((query)=>{
    if(!query||query.length<2){setResults(null);return;}
    setLoading(true);
    const qlo=query.toLowerCase();
    const searchArr=(raw,tab)=>toArr(raw).filter(q2=>{
      const txt=[(q2.Question||q2.question||""),(q2.Subject||q2.subject||""),(q2.Sub_topic||q2.sub_topic||""),(q2.Correct||q2.correct||"")].join(" ").toLowerCase();
      return txt.includes(qlo);
    }).slice(0,10).map(q2=>({...q2,_tab:tab}));

    const uResults=toArr(usersRaw).filter(u=>{
      const nm=(u.Name||u.name||"").toLowerCase();
      const ph=(u.Phone||u.phone||"").toLowerCase();
      return nm.includes(qlo)||ph.includes(qlo);
    }).slice(0,6);

    setResults({questions:[...searchArr(quizRaw,"Quiz"),...searchArr(qbankRaw,"QBank")].slice(0,12),users:uResults});
    setLoading(false);
  },[quizRaw,qbankRaw,usersRaw]);

  const onInput=v=>{setQ(v);clearTimeout(debRef.current);debRef.current=setTimeout(()=>doSearch(v),300);};
  const total=(results?.questions?.length||0)+(results?.users?.length||0);

  return(
    <div className="page">
      <div className="sw" style={{marginBottom:12}}>
        <span className="si">🔍</span>
        <input className="input" placeholder="নাম, ফোন, প্রশ্ন, বিষয়..." value={q} onChange={e=>onInput(e.target.value)} autoFocus/>
      </div>
      {loading&&<div style={{textAlign:"center",padding:"20px 0",color:C.muted,fontSize:12}}>⏳ খোঁজা হচ্ছে...</div>}
      {!loading&&results&&<div style={{fontSize:11,color:C.muted,marginBottom:8}}>{total}টি ফলাফল</div>}
      {results?.users?.length>0&&(
        <><div className="slabel">👥 স্টুডেন্ট</div>
          {results.users.map((u,i)=>{
            const nm=u.Name||u.name||"অজানা",ph=u.Phone||u.phone||"—";
            const st=(u.Status||u.status||"inactive").toLowerCase();
            return(
              <div key={i} className="sr-item" onClick={()=>onStudentDetail(u)}>
                <div className="avatar sm">{initials(nm)}</div>
                <div style={{flex:1,minWidth:0}}><div style={{fontWeight:600,fontSize:12}}>{nm}</div><div style={{fontSize:10,color:C.muted}}>📱 {ph}</div></div>
                <span className={`pill p-${st==="active"?"active":"inactive"}`}>{st==="active"?"✅":"🔴"}</span>
              </div>
            );
          })}
        </>
      )}
      {results?.questions?.length>0&&(
        <><div className="slabel">❓ প্রশ্ন</div>
          {results.questions.map((q2,i)=>(
            <div key={i} className="sr-item" style={{cursor:"default"}}>
              <span className="sr-tag">{q2._tab}</span>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontSize:12,fontWeight:600,lineHeight:1.4}}>{(q2.Question||q2.question||"").slice(0,80)}…</div>
                {(q2.Correct||q2.correct)&&<div style={{fontSize:10,color:C.green,marginTop:1}}>✅ {q2.Correct||q2.correct}</div>}
              </div>
              <div style={{fontSize:10,color:C.muted}}>#{q2.ID||q2.id}</div>
            </div>
          ))}
        </>
      )}
      {!loading&&results&&total===0&&<div className="empty"><div className="ei">🔍</div><p>"{q}" পাওয়া যায়নি</p></div>}
      {!results&&!loading&&<div className="empty" style={{paddingTop:28}}><div className="ei">🔍</div><p style={{fontSize:12}}>সব কিছু এখানে খুঁজুন<br/><span style={{fontSize:10,color:C.muted}}>Firebase থেকে instant</span></p></div>}
    </div>
  );
}

/* ══════════════ NOTIFY ══════════════ */
function NotifyPage({push}){
  const[title,setTitle]=useState("");
  const[body,setBody]=useState("");
  const[sending,setSending]=useState(false);
  const[hist,setHist]=useState([]);

  const send=async()=>{
    if(!title||!body){push("warn","তথ্য দিন","");return;}
    setSending(true);
    try{
      const r=await gasAction({action:"broadcastNotification",title:encodeURIComponent(title),body:encodeURIComponent(body)});
      push("success","পাঠানো হয়েছে! 🎉",`${r.fcm?.sent||0} জনকে`);
      setHist(p=>[{title,body,time:"এখনই"},...p.slice(0,9)]);
      setTitle("");setBody("");
    }catch(e){push("error","ব্যর্থ",e.message);}
    setSending(false);
  };

  return(
    <div className="page">
      <div style={{background:`linear-gradient(135deg,${C.card},#0a1830)`,border:`1px solid ${C.accent}20`,borderRadius:13,padding:14,marginBottom:11}}>
        <div className="card-title">📣 সবাইকে Broadcast</div>
        <div className="field"><label>শিরোনাম</label><input className="input" placeholder="নোটিফিকেশনের শিরোনাম..." value={title} onChange={e=>setTitle(e.target.value)}/></div>
        <div className="field"><label>বার্তা</label><textarea className="ta" placeholder="বিস্তারিত..." value={body} onChange={e=>setBody(e.target.value)}/></div>
        <button className="btn btn-p btn-block" onClick={send} disabled={sending}>{sending?"⏳ পাঠানো হচ্ছে...":"📣 সবাইকে পাঠান"}</button>
      </div>
      {hist.length>0&&<div className="card">
        <div className="card-title">ইতিহাস</div>
        {hist.map((h,i)=>(
          <div key={i} className="nrow">
            <div className={`ndot ${i===0?"n":"o"}`}/>
            <div className="ncontent"><div className="ntitle">{h.title}</div><div className="nsub">{h.body?.slice(0,55)}</div></div>
            <div className="ntime">{h.time}</div>
          </div>
        ))}
      </div>}
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
      const phKey=(user.Phone||user.phone||"").replace(/[.#$\[\]\s]/g,'_');
      await fb.set(`Notifications/${phKey}/notif_${Date.now()}`,{type:"personal",title,body,time:nowTs(),read:false});
      gasBg({action:"broadcastNotification",title:encodeURIComponent(title),body:encodeURIComponent(body)});
      push("success","পাঠানো হয়েছে",nm);
      if(!inline)onClose();
    }catch(e){push("error","ব্যর্থ",e.message);}
    setSending(false);
  };

  if(inline)return(
    <div className="card">
      <div className="card-title">📣 ব্যক্তিগত নোটিফিকেশন</div>
      <div className="field"><label>শিরোনাম</label><input className="input" placeholder="Title..." value={title} onChange={e=>setTitle(e.target.value)}/></div>
      <div className="field"><label>বার্তা</label><textarea className="ta" placeholder="Message..." value={body} onChange={e=>setBody(e.target.value)}/></div>
      <button className="btn btn-p btn-block" onClick={send} disabled={sending}>{sending?"⏳":"📨 পাঠান"}</button>
    </div>
  );

  return(
    <div className="overlay">
      <div className="modal">
        <div className="mhandle"/>
        <div className="mtitle">📣 {nm}</div>
        <div style={{fontSize:11,color:C.muted,marginBottom:11}}>📱 {user.Phone||user.phone}</div>
        <div className="field"><label>শিরোনাম</label><input className="input" placeholder="Title..." value={title} onChange={e=>setTitle(e.target.value)}/></div>
        <div className="field"><label>বার্তা</label><textarea className="ta" placeholder="Message..." value={body} onChange={e=>setBody(e.target.value)}/></div>
        <div style={{display:"flex",gap:7}}>
          <button className="btn btn-g" style={{flex:1,justifyContent:"center"}} onClick={onClose}>বাতিল</button>
          <button className="btn btn-p" style={{flex:1,justifyContent:"center"}} onClick={send} disabled={sending}>{sending?"⏳":"📨 পাঠান"}</button>
        </div>
      </div>
    </div>
  );
}

/* ══════════════ ROOT APP ══════════════ */
const NAV=[
  {id:"dashboard",icon:"📊",label:"Dashboard"},
  {id:"signups",  icon:"🆕",label:"সাইনআপ",  badge:true},
  {id:"students", icon:"👥",label:"Students"},
  {id:"reports",  icon:"🚨",label:"Reports",  badge:true},
  {id:"entry",    icon:"✏️",label:"Entry"},
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
    fbInvalidate(...Object.keys(_cache));
    setTick(t=>t+1);
    setTimeout(()=>setSpin(false),1400);
  };

  useEffect(()=>{
    const id=setInterval(()=>setTick(t=>t+1),60_000);
    return()=>clearInterval(id);
  },[]);

  if(searchDetail)return(
    <>
      <style>{css}</style>
      <StudentDetail user={searchDetail} onBack={()=>setSearchDetail(null)} push={push}/>
      <Toasts toasts={toasts}/>
    </>
  );

  return(
    <>
      <style>{css}</style>
      <div className="topbar">
        <div>
          <div className="topbar-title">{NAV.find(n=>n.id===page)?.icon} {NAV.find(n=>n.id===page)?.label}</div>
          <div className="topbar-sub">Smart Study Admin · Firebase</div>
        </div>
        <button className={`icon-btn${spin?" spin":""}`} onClick={refresh}>🔄</button>
      </div>

      <div style={{display:page==="dashboard"?"block":"none"}}><DashboardPage push={push} forceRefresh={tick}/></div>
      <div style={{display:page==="signups"  ?"block":"none"}}><SignupsPage   push={push} forceRefresh={tick}/></div>
      <div style={{display:page==="students" ?"block":"none"}}><StudentsPage  push={push} forceRefresh={tick}/></div>
      <div style={{display:page==="reports"  ?"block":"none"}}><ReportsPage   push={push} forceRefresh={tick}/></div>
      <div style={{display:page==="entry"    ?"block":"none"}}><EntryPage     push={push}/></div>
      <div style={{display:page==="search"   ?"block":"none"}}><SearchPage    push={push} onStudentDetail={u=>setSearchDetail(u)}/></div>
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
      <Toasts toasts={toasts}/>
    </>
  );
}
