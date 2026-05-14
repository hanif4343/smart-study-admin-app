import { useState, useEffect, useCallback, useRef } from "react";

const GAS_URL = "https://script.google.com/macros/s/AKfycbyjF7iFX0H_rFuJgMJYo70DC7KRX1lBXU7m7NoZCwf6VTJfRm6Iyw6hOcN2q_UKbxxgQg/exec";
const FIREBASE_URL = "https://smartentrydb-default-rtdb.firebaseio.com/";
const FB_KEY = "CsFdxaWLLU2AT92kxYFPTOhP1ewDR0jzK3hKjqWO";

const C = {
  bg:"#06080f",card:"#0c1220",border:"#16253d",
  accent:"#3b82f6",accentGlow:"#3b82f620",
  green:"#22c55e",red:"#ef4444",yellow:"#f59e0b",purple:"#8b5cf6",
  text:"#e2e8f0",muted:"#4b5e7a",panel:"#0e1a2e",navBg:"#080f1c",
};

/* ══════════════════════════════════════════
   STALE-WHILE-REVALIDATE CACHE
══════════════════════════════════════════ */
const _store={}, _subs={}, _inflight={};
const FRESH_MS = 30_000;
const cacheGet = k => _store[k]?.data ?? null;
const cacheSub = (k,cb) => {
  if(!_subs[k]) _subs[k]=new Set();
  _subs[k].add(cb);
  return ()=>_subs[k].delete(cb);
};
const cacheNotify = (k,data) => {
  _store[k]={data,ts:Date.now()};
  (_subs[k]||new Set()).forEach(cb=>cb(data));
};
const cacheInvalidate = (...pats) => pats.forEach(p=>Object.keys(_store).forEach(k=>{if(k.includes(p))delete _store[k];}));

async function fetchAndCache(params, force=false) {
  const key=JSON.stringify(params), now=Date.now(), cached=_store[key];
  if(!force&&cached&&now-cached.ts<FRESH_MS) return cached.data;
  if(_inflight[key]) return _inflight[key];
  const qs=new URLSearchParams(params).toString();
  _inflight[key]=fetch(GAS_URL+"?"+qs)
    .then(r=>r.json())
    .then(data=>{delete _inflight[key];cacheNotify(key,data);return data;})
    .catch(e=>{delete _inflight[key];throw e;});
  return _inflight[key];
}

function useSWR(params, forceRefresh=0) {
  const key=JSON.stringify(params);
  const [data,setData]=useState(()=>cacheGet(key));
  const [loading,setLoading]=useState(!cacheGet(key));
  const prev=useRef(0);
  useEffect(()=>{
    const unsub=cacheSub(key,d=>{setData(d);setLoading(false);});
    const force=forceRefresh>prev.current; prev.current=forceRefresh;
    const stale=cacheGet(key);
    if(stale&&!force){setData(stale);setLoading(false);fetchAndCache(params,false).catch(()=>{});}
    else{if(!stale)setLoading(true);fetchAndCache(params,force).catch(()=>setLoading(false));}
    return unsub;
  },[key,forceRefresh]);
  return {data,loading};
}

const apiAction = async(params)=>{
  const r=await fetch(GAS_URL+"?"+new URLSearchParams(params).toString());
  return r.json();
};
const fbGet = async(path)=>{
  const r=await fetch(`${FIREBASE_URL}${path}.json?auth=${FB_KEY}`);
  return r.json();
};

/* ── Helpers ── */
const fmt=n=>(n||0).toLocaleString();
const pct=(a,b)=>b?Math.round((a/b)*100):0;
const initials=n=>(n||"?").split(" ").map(w=>w[0]).join("").toUpperCase().slice(0,2);
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

/* ── Toast ── */
let _tid=0;
function useToasts(){
  const[toasts,set]=useState([]);
  const push=useCallback((type,title,msg="")=>{
    const id=++_tid;
    set(p=>[...p,{id,type,title,msg}]);
    setTimeout(()=>set(p=>p.filter(t=>t.id!==id)),4000);
  },[]);
  return[toasts,push];
}

/* ══════════════════════════════════════════
   CSS
══════════════════════════════════════════ */
const css=`
@import url('https://fonts.googleapis.com/css2?family=Noto+Sans+Bengali:wght@400;500;600;700&family=Space+Grotesk:wght@400;500;600;700&display=swap');
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
html,body,#root{background:${C.bg};color:${C.text};font-family:'Noto Sans Bengali','Space Grotesk',sans-serif;min-height:100dvh;max-width:480px;margin:0 auto;overflow-x:hidden}
::-webkit-scrollbar{width:3px}::-webkit-scrollbar-thumb{background:${C.border};border-radius:10px}
.bottom-nav{position:fixed;bottom:0;left:50%;transform:translateX(-50%);width:100%;max-width:480px;background:${C.navBg};border-top:1px solid ${C.border};display:flex;z-index:100;padding-bottom:env(safe-area-inset-bottom,8px)}
.nav-btn{flex:1;display:flex;flex-direction:column;align-items:center;gap:3px;padding:8px 2px 7px;cursor:pointer;border:none;background:transparent;color:${C.muted};font-family:inherit;font-size:9px;font-weight:500;transition:color .15s;position:relative}
.nav-btn.active{color:${C.accent}}
.nav-icon{font-size:19px;line-height:1}
.nav-badge{position:absolute;top:5px;right:calc(50% - 17px);background:${C.red};color:#fff;font-size:8px;font-weight:700;width:14px;height:14px;border-radius:50%;display:flex;align-items:center;justify-content:center}
.topbar{background:${C.card};border-bottom:1px solid ${C.border};padding:13px 16px 11px;display:flex;align-items:center;justify-content:space-between;position:sticky;top:0;z-index:50}
.topbar-title{font-size:16px;font-weight:700}
.topbar-sub{font-size:10px;color:${C.muted};margin-top:1px}
.icon-btn{width:36px;height:36px;border-radius:10px;background:${C.panel};border:1px solid ${C.border};color:${C.text};font-size:17px;display:flex;align-items:center;justify-content:center;cursor:pointer;transition:all .15s}
.icon-btn:active{transform:scale(.92)}
.icon-btn.spinning{animation:spin 1s linear infinite}
.page{padding:14px;padding-bottom:85px;min-height:100dvh}
.stat-grid{display:grid;grid-template-columns:1fr 1fr;gap:9px;margin-bottom:11px}
.stat-card{background:${C.card};border:1px solid ${C.border};border-radius:14px;padding:13px;position:relative;overflow:hidden}
.stat-card::after{content:attr(data-icon);position:absolute;right:8px;bottom:6px;font-size:26px;opacity:.12}
.stat-label{font-size:10px;color:${C.muted};font-weight:600;margin-bottom:5px;text-transform:uppercase;letter-spacing:.5px}
.stat-value{font-size:26px;font-weight:700;line-height:1;font-variant-numeric:tabular-nums}
.sv-blue{color:${C.accent}}.sv-green{color:${C.green}}.sv-red{color:${C.red}}.sv-yellow{color:${C.yellow}}.sv-purple{color:${C.purple}}
.t-blue{border-top:2px solid ${C.accent}}.t-green{border-top:2px solid ${C.green}}.t-red{border-top:2px solid ${C.red}}.t-yellow{border-top:2px solid ${C.yellow}}.t-purple{border-top:2px solid ${C.purple}}
.card{background:${C.card};border:1px solid ${C.border};border-radius:14px;padding:14px;margin-bottom:11px}
.card-title{font-size:11px;font-weight:700;color:${C.muted};text-transform:uppercase;letter-spacing:.8px;margin-bottom:12px}
.user-row{display:flex;align-items:center;gap:11px;padding:11px 0;border-bottom:1px solid ${C.border}40}
.user-row:last-child{border-bottom:none}
.avatar{width:40px;height:40px;border-radius:50%;background:linear-gradient(135deg,${C.accent},${C.purple});display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:700;color:#fff;flex-shrink:0}
.avatar.sm{width:32px;height:32px;font-size:11px}
.avatar.lg{width:56px;height:56px;font-size:20px}
.user-info{flex:1;min-width:0}
.user-name{font-size:14px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.user-meta{font-size:11px;color:${C.muted};margin-top:2px}
.pill{display:inline-flex;align-items:center;gap:3px;padding:3px 8px;border-radius:20px;font-size:10px;font-weight:700;white-space:nowrap;flex-shrink:0}
.p-active{background:#22c55e18;color:${C.green};border:1px solid #22c55e33}
.p-inactive{background:#ef444418;color:${C.red};border:1px solid #ef444433}
.p-pending{background:#f59e0b18;color:${C.yellow};border:1px solid #f59e0b33}
.btn{display:inline-flex;align-items:center;gap:4px;padding:8px 13px;border-radius:10px;font-size:12px;font-weight:600;font-family:inherit;cursor:pointer;border:none;transition:all .15s;white-space:nowrap}
.btn:active{transform:scale(.96)}.btn:disabled{opacity:.45;pointer-events:none}
.btn-p{background:${C.accent};color:#fff}.btn-p:hover{filter:brightness(1.1)}
.btn-s{background:#22c55e20;color:${C.green};border:1px solid #22c55e40}.btn-s:not(:disabled):hover{background:${C.green};color:#fff}
.btn-d{background:#ef444420;color:${C.red};border:1px solid #ef444440}.btn-d:hover{background:${C.red};color:#fff}
.btn-g{background:transparent;color:${C.muted};border:1px solid ${C.border}}.btn-g:hover{background:${C.border};color:${C.text}}
.btn-block{width:100%;justify-content:center;padding:11px}
.input,.ta{background:${C.panel};border:1px solid ${C.border};border-radius:10px;padding:10px 12px;color:${C.text};font-family:inherit;font-size:14px;width:100%;outline:none;transition:border-color .2s;-webkit-appearance:none}
.input:focus,.ta:focus{border-color:${C.accent}}
.input::placeholder,.ta::placeholder{color:${C.muted}}
.ta{resize:vertical;min-height:80px}
.field{margin-bottom:11px}
.field label{display:block;font-size:10px;font-weight:700;color:${C.muted};letter-spacing:.8px;margin-bottom:5px;text-transform:uppercase}
.sw{position:relative;margin-bottom:11px}
.sw .si{position:absolute;left:11px;top:50%;transform:translateY(-50%);font-size:15px;pointer-events:none}
.sw .input{padding-left:36px}
.ftabs{display:flex;gap:5px;margin-bottom:12px;overflow-x:auto;padding-bottom:2px;scrollbar-width:none}
.ftabs::-webkit-scrollbar{display:none}
.ftab{flex-shrink:0;padding:6px 13px;border-radius:20px;font-size:11px;font-weight:600;cursor:pointer;border:1px solid ${C.border};background:transparent;color:${C.muted};font-family:inherit;transition:all .15s}
.ftab.active{background:${C.accent};color:#fff;border-color:${C.accent}}
.rc{background:${C.panel};border:1px solid ${C.border};border-radius:12px;padding:12px;margin-bottom:9px}
.r-issue{font-size:12px;color:${C.text};line-height:1.5;background:${C.card};border-radius:8px;padding:8px 10px;margin-top:7px;border-left:2px solid ${C.red}}
.r-meta{font-size:10px;color:${C.muted};margin-top:4px;display:flex;gap:7px;flex-wrap:wrap}
.overlay{position:fixed;inset:0;background:#00000094;z-index:200;display:flex;align-items:flex-end;animation:fi .2s}
.modal{background:${C.card};border:1px solid ${C.border};border-radius:22px 22px 0 0;padding:18px 18px 38px;width:100%;max-height:88dvh;overflow-y:auto;animation:su .25s ease}
.mhandle{width:34px;height:4px;background:${C.border};border-radius:4px;margin:0 auto 14px}
.mtitle{font-size:15px;font-weight:700;margin-bottom:14px;display:flex;align-items:center;gap:7px}
.fullscreen{position:fixed;inset:0;background:${C.bg};z-index:150;overflow-y:auto;animation:fi .2s}
.fs-header{background:${C.card};border-bottom:1px solid ${C.border};padding:13px 16px;display:flex;align-items:center;gap:12px;position:sticky;top:0;z-index:10}
.back-btn{width:34px;height:34px;border-radius:9px;background:${C.panel};border:1px solid ${C.border};color:${C.text};font-size:16px;display:flex;align-items:center;justify-content:center;cursor:pointer;flex-shrink:0}
.skel{background:linear-gradient(90deg,${C.border},#1a2840,${C.border});background-size:200% 100%;animation:shim 1.4s infinite;border-radius:10px;height:68px;margin-bottom:9px}
.empty{text-align:center;padding:44px 20px;color:${C.muted}}
.ei{font-size:38px;margin-bottom:9px;opacity:.25}
.toasts{position:fixed;top:14px;left:50%;transform:translateX(-50%);width:calc(100% - 28px);max-width:440px;z-index:999;display:flex;flex-direction:column;gap:7px;pointer-events:none}
.toast{background:${C.card};border:1px solid ${C.border};border-radius:11px;padding:11px 13px;display:flex;gap:9px;align-items:flex-start;animation:ti .3s ease;box-shadow:0 8px 32px #00000080;pointer-events:all}
.toast.success{border-left:3px solid ${C.green}}.toast.error{border-left:3px solid ${C.red}}.toast.warn{border-left:3px solid ${C.yellow}}.toast.info{border-left:3px solid ${C.accent}}
.t-icon{font-size:17px}.t-body{flex:1}.t-title{font-size:12px;font-weight:700}.t-msg{font-size:11px;color:${C.muted};margin-top:1px}
.atabs{display:flex;background:${C.panel};border-radius:11px;padding:3px;margin-bottom:12px;gap:3px}
.atab{flex:1;text-align:center;padding:7px 3px;border-radius:8px;font-size:11px;font-weight:600;cursor:pointer;border:none;background:transparent;color:${C.muted};font-family:inherit;transition:all .2s}
.atab.active{background:${C.card};color:${C.text};box-shadow:0 2px 8px #00000040}
.srow{display:flex;align-items:center;justify-content:space-between;padding:9px 0;border-bottom:1px solid ${C.border}40;font-size:12px}
.srow:last-child{border-bottom:none}
.sbar{height:4px;border-radius:4px;background:${C.border};flex:1;margin:4px 7px 0 0;overflow:hidden}
.sbar-f{height:100%;border-radius:4px;transition:width .6s ease}
.bcard{background:linear-gradient(135deg,${C.card},#0a1830);border:1px solid ${C.accentGlow};border-radius:14px;padding:14px;margin-bottom:11px}
.slabel{font-size:10px;font-weight:700;color:${C.muted};letter-spacing:1.2px;text-transform:uppercase;margin:16px 0 9px}
.nrow{display:flex;gap:9px;align-items:flex-start;padding:10px 0;border-bottom:1px solid ${C.border}40}
.nrow:last-child{border-bottom:none}
.ndot{width:7px;height:7px;border-radius:50%;margin-top:5px;flex-shrink:0}
.ndot.n{background:${C.accent};box-shadow:0 0 5px ${C.accent}}
.ndot.o{background:${C.muted}}
.ncontent{flex:1}.ntitle{font-size:13px;font-weight:600}.nsub{font-size:11px;color:${C.muted};margin-top:1px}
.ntime{font-size:10px;color:${C.muted};white-space:nowrap}
.steps{display:flex;margin-bottom:18px}
.step{flex:1;text-align:center;font-size:10px;font-weight:700;padding:6px 3px;border-bottom:2px solid ${C.border};color:${C.muted};transition:all .2s}
.step.done{border-color:${C.green};color:${C.green}}
.step.active{border-color:${C.accent};color:${C.accent}}
/* mini bar chart */
.bar-chart{display:flex;align-items:flex-end;gap:3px;height:70px;margin-top:6px}
.bar-col{display:flex;flex-direction:column;align-items:center;flex:1;gap:3px}
.bar-rect{width:100%;border-radius:4px 4px 0 0;transition:height .5s ease;min-height:2px}
.bar-label{font-size:8px;color:${C.muted};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:28px;text-align:center}
/* search result */
.sr-item{display:flex;align-items:center;gap:10px;padding:10px;background:${C.panel};border:1px solid ${C.border};border-radius:11px;margin-bottom:7px;cursor:pointer;transition:border-color .15s}
.sr-item:hover{border-color:${C.accent}}
.sr-tag{font-size:9px;font-weight:700;padding:2px 6px;border-radius:8px;background:${C.accentGlow};color:${C.accent};flex-shrink:0}
/* perf ring */
.ring-wrap{position:relative;width:72px;height:72px;flex-shrink:0}
.ring-wrap svg{transform:rotate(-90deg)}
.ring-pct{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:700}
@keyframes spin{to{transform:rotate(360deg)}}
@keyframes fi{from{opacity:0}to{opacity:1}}
@keyframes su{from{transform:translateY(38px);opacity:0}to{transform:translateY(0);opacity:1}}
@keyframes shim{0%{background-position:-200% 0}100%{background-position:200% 0}}
@keyframes ti{from{transform:translateY(-18px);opacity:0}to{transform:translateY(0);opacity:1}}
`;

/* ══════════════════════════════════════════
   MINI COMPONENTS
══════════════════════════════════════════ */
function PerfRing({val,max,color}){
  const r=28, circ=2*Math.PI*r, pctVal=max?Math.min(100,Math.round(val/max*100)):0;
  const dash=circ*(pctVal/100);
  return(
    <div className="ring-wrap">
      <svg width="72" height="72" viewBox="0 0 72 72">
        <circle cx="36" cy="36" r={r} fill="none" stroke={C.border} strokeWidth="6"/>
        <circle cx="36" cy="36" r={r} fill="none" stroke={color} strokeWidth="6"
          strokeDasharray={`${dash} ${circ}`} strokeLinecap="round"/>
      </svg>
      <div className="ring-pct" style={{color}}>{pctVal}%</div>
    </div>
  );
}

function MiniBarChart({data,color}){
  if(!data||!data.length) return null;
  const max=Math.max(...data.map(d=>d.v),1);
  return(
    <div className="bar-chart">
      {data.map((d,i)=>(
        <div key={i} className="bar-col">
          <div className="bar-rect" style={{height:(d.v/max*60)+"px",background:color,opacity:.85}}/>
          <div className="bar-label">{d.l}</div>
        </div>
      ))}
    </div>
  );
}

/* ══════════════════════════════════════════
   SUBJECT TREE — Subject > Topic > SubTopic
══════════════════════════════════════════ */
function SubjectTree({entries,total,color}){
  const[expanded,setExpanded]=useState({});
  const toggle=k=>setExpanded(p=>({...p,[k]:!p[k]}));

  return(
    <>
      {entries.map(([sub,v])=>{
        const isOpen=expanded[sub];
        const topics=v.topics||{};
        const topicEntries=Object.entries(topics);
        return(
          <div key={sub} style={{marginBottom:8}}>
            {/* Subject row */}
            <div
              style={{display:"flex",alignItems:"center",padding:"9px 0",borderBottom:`1px solid ${C.border}40`,cursor:topicEntries.length>0?"pointer":"default"}}
              onClick={()=>topicEntries.length>0&&toggle(sub)}
            >
              <div style={{flex:1}}>
                <div style={{fontWeight:700,fontSize:13,display:"flex",alignItems:"center",gap:5}}>
                  {topicEntries.length>0&&<span style={{fontSize:10,color:C.muted,transition:"transform .2s",display:"inline-block",transform:isOpen?"rotate(90deg)":"rotate(0deg)"}}>▶</span>}
                  {sub}
                </div>
                <div style={{display:"flex",alignItems:"center",marginTop:3}}>
                  <div className="sbar"><div className="sbar-f" style={{width:pct(v.total,total)+"%",background:color}}/></div>
                </div>
                <div style={{fontSize:9,color:C.muted,marginTop:1}}>
                  MCQ:{v.mcq} · Written:{v.written}
                  {topicEntries.length>0&&<span> · {topicEntries.length}টি Topic</span>}
                </div>
              </div>
              <div style={{fontWeight:700,color,fontSize:17,minWidth:36,textAlign:"right"}}>{v.total}</div>
            </div>

            {/* Topics (expanded) */}
            {isOpen&&topicEntries.map(([topic,tv])=>{
              const stEntries=Object.entries(tv.subtopics||{});
              const isTopicOpen=expanded[sub+"__"+topic];
              return(
                <div key={topic} style={{marginLeft:14,borderLeft:`2px solid ${color}30`}}>
                  {/* Topic row */}
                  <div
                    style={{display:"flex",alignItems:"center",padding:"7px 0 7px 10px",borderBottom:`1px solid ${C.border}30`,cursor:stEntries.length>0?"pointer":"default"}}
                    onClick={()=>stEntries.length>0&&toggle(sub+"__"+topic)}
                  >
                    <div style={{flex:1}}>
                      <div style={{fontSize:12,fontWeight:600,display:"flex",alignItems:"center",gap:4}}>
                        {stEntries.length>0&&<span style={{fontSize:9,color:C.muted,transition:"transform .2s",display:"inline-block",transform:isTopicOpen?"rotate(90deg)":"rotate(0)"}}>▶</span>}
                        📂 {topic}
                      </div>
                      {stEntries.length>0&&<div style={{fontSize:9,color:C.muted,marginTop:1}}>{stEntries.length}টি SubTopic</div>}
                    </div>
                    <div style={{fontWeight:700,color,fontSize:14,minWidth:30,textAlign:"right"}}>{tv.total}</div>
                  </div>

                  {/* SubTopics (expanded) */}
                  {isTopicOpen&&stEntries.map(([st,stv])=>(
                    <div key={st} style={{display:"flex",alignItems:"center",padding:"6px 0 6px 20px",borderBottom:`1px solid ${C.border}20`}}>
                      <div style={{flex:1}}>
                        <div style={{fontSize:11,color:C.text}}>📄 {st}</div>
                        <div style={{fontSize:9,color:C.muted,marginTop:1}}>MCQ:{stv.mcq||0} · Written:{stv.written||0}</div>
                      </div>
                      <div style={{fontWeight:600,color:C.muted,fontSize:13,minWidth:28,textAlign:"right"}}>{stv.total}</div>
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
══════════════════════════════════════════ */
function DashboardPage({push,forceRefresh}){
  const{data:dash,loading:l1}=useSWR({action:"getDashboard"},forceRefresh);
  const{data:ud,loading:l2}=useSWR({action:"getUsers"},forceRefresh);
  const[atab,setAtab]=useState("quiz");

  const users=ud?.users||[];
  const total=users.length;
  const active=users.filter(u=>(u.Status||u.status||"").toLowerCase()==="active").length;
  const pending=total-active;
  const reports=dash?.reports?.length||0;
  const quizTotal=dash?Object.values(dash.quiz||{}).reduce((s,v)=>s+v.total,0):0;
  const qbTotal=dash?Object.values(dash.qbank||{}).reduce((s,v)=>s+v.total,0):0;
  const stTotal=dash?Object.values(dash.study||{}).reduce((s,v)=>s+v.total,0):0;

  if((l1||l2)&&!dash) return(
    <div className="page">
      <div className="stat-grid">{[...Array(4)].map((_,i)=><div key={i} className="skel" style={{height:78,borderRadius:14}}/>)}</div>
      {[...Array(3)].map((_,i)=><div key={i} className="skel"/>)}
    </div>
  );

  const quizE=Object.entries(dash?.quiz||{});
  const qbankE=Object.entries(dash?.qbank||{});
  const studyE=Object.entries(dash?.study||{});

  // Daily active — last 7 days from users lastActive
  const days=[];
  for(let i=6;i>=0;i--){
    const d=new Date(); d.setDate(d.getDate()-i);
    const label=`${d.getDate()}/${d.getMonth()+1}`;
    const count=users.filter(u=>{
      const la=u._lastActive||"";
      if(!la)return false;
      try{
        const ud2=new Date(la.replace(/(\d{2})-(\d{2})-(\d{4})/,"$3-$2-$1"));
        return ud2.toDateString()===d.toDateString();
      }catch{return false;}
    }).length;
    days.push({l:label,v:count});
  }

  return(
    <div className="page">
      <div className="stat-grid">
        <div className="stat-card t-blue"  data-icon="👥"><div className="stat-label">মোট স্টুডেন্ট</div><div className="stat-value sv-blue">{fmt(total)}</div></div>
        <div className="stat-card t-green" data-icon="✅"><div className="stat-label">অ্যাক্টিভ</div><div className="stat-value sv-green">{fmt(active)}</div></div>
        <div className="stat-card t-yellow"data-icon="⏳"><div className="stat-label">পেন্ডিং</div><div className="stat-value sv-yellow">{fmt(pending)}</div></div>
        <div className="stat-card t-red"   data-icon="🚨"><div className="stat-label">রিপোর্ট</div><div className="stat-value sv-red">{fmt(reports)}</div></div>
      </div>
      <div className="stat-grid">
        <div className="stat-card t-blue"  data-icon="❓"><div className="stat-label">Quiz প্রশ্ন</div><div className="stat-value sv-blue">{fmt(quizTotal)}</div></div>
        <div className="stat-card t-green" data-icon="📚"><div className="stat-label">QBank</div><div className="stat-value sv-green">{fmt(qbTotal)}</div></div>
        <div className="stat-card t-yellow"data-icon="📖"><div className="stat-label">Study নোট</div><div className="stat-value sv-yellow">{fmt(stTotal)}</div></div>
        <div className="stat-card t-purple"data-icon="📊"><div className="stat-label">মোট কন্টেন্ট</div><div className="stat-value sv-purple">{fmt(quizTotal+qbTotal+stTotal)}</div></div>
      </div>

      {/* Daily Active Chart */}
      <div className="card">
        <div className="card-title">📈 Daily Active Users (৭ দিন)</div>
        <MiniBarChart data={days} color={C.accent}/>
        <div style={{display:"flex",justifyContent:"space-between",marginTop:8,fontSize:11,color:C.muted}}>
          <span>সর্বোচ্চ: <b style={{color:C.accent}}>{Math.max(...days.map(d=>d.v))}</b></span>
          <span>মোট: <b style={{color:C.accent}}>{days.reduce((s,d)=>s+d.v,0)}</b></span>
        </div>
      </div>

      {/* Analytics */}
      <div className="card">
        <div className="card-title">📊 বিষয়ভিত্তিক Analytics</div>
        <div className="atabs">
          {[["quiz",`❓ Quiz`],["qbank",`📚 QBank`],["study",`📖 Study`]].map(([v,l])=>(
            <button key={v} className={`atab${atab===v?" active":""}`} onClick={()=>setAtab(v)}>{l}</button>
          ))}
        </div>
        {atab==="quiz"&&(quizE.length===0
          ?<div style={{textAlign:"center",color:C.muted,padding:"14px 0",fontSize:12}}>ডেটা নেই</div>
          :<SubjectTree entries={quizE} total={quizTotal} color={C.accent}/>
        )}
        {atab==="qbank"&&(qbankE.length===0
          ?<div style={{textAlign:"center",color:C.muted,padding:"14px 0",fontSize:12}}>ডেটা নেই</div>
          :<SubjectTree entries={qbankE} total={qbTotal} color={C.green}/>
        )}
        {atab==="study"&&(studyE.length===0?<div style={{textAlign:"center",color:C.muted,padding:"14px 0",fontSize:12}}>ডেটা নেই</div>:studyE.map(([s,v])=>(
          <div key={s} className="srow">
            <div style={{flex:1}}>
              <div style={{fontWeight:600}}>{s}</div>
              <div style={{display:"flex",alignItems:"center",marginTop:3}}><div className="sbar"><div className="sbar-f" style={{width:pct(v.total,stTotal)+"%",background:C.yellow}}/></div></div>
            </div>
            <div style={{fontWeight:700,color:C.yellow,fontSize:17,minWidth:32,textAlign:"right"}}>{v.total}</div>
          </div>
        )))}
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════
   SIGNUPS
══════════════════════════════════════════ */
function SignupsPage({push,forceRefresh}){
  const{data:ud,loading}=useSWR({action:"getUsers",lite:"1"},forceRefresh);
  const[removed,setRemoved]=useState([]);
  const[activating,setActivating]=useState(null);
  const pending=(ud?.users||[]).filter(u=>(u.Status||u.status||"").toLowerCase()!=="active"&&!removed.includes(u.Phone||u.phone));

  const activate=async(u)=>{
    const phone=u.Phone||u.phone||"";
    if(!phone) return;
    setActivating(phone);
    try{
      const r=await apiAction({action:"activateUser",phone});
      if(r.result==="success"){
        push("success","✅ অ্যাক্টিভ!",u.Name||u.name||phone);
        setRemoved(p=>[...p,phone]);
        cacheInvalidate("getUsers"); fetchAndCache({action:"getUsers"},true);
      }else push("error","ব্যর্থ",r.error||"Unknown");
    }catch(e){push("error","নেটওয়ার্ক সমস্যা",e.message);}
    setActivating(null);
  };

  return(
    <div className="page">
      <div style={{background:"#ef444412",border:"1px solid #ef444430",borderRadius:11,padding:"9px 13px",fontSize:12,color:C.red,fontWeight:600,marginBottom:12,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
        <span>🔔 {pending.length}টি পেন্ডিং</span>
        {loading&&<span style={{fontSize:10,color:C.muted}}>⏳ আপডেট...</span>}
      </div>
      {loading&&!ud?[...Array(4)].map((_,i)=><div key={i} className="skel"/>):
       pending.length===0?<div className="empty"><div className="ei">🎉</div><p>সব অ্যাক্টিভ!</p></div>:
       pending.map((u,i)=>{
        const nm=u.Name||u.name||"অজানা", ph=u.Phone||u.phone||"—", busy=activating===ph;
        return(
          <div key={i} className="card" style={{padding:13}}>
            <div style={{display:"flex",alignItems:"center",gap:11,marginBottom:11}}>
              <div className="avatar">{initials(nm)}</div>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontWeight:700,fontSize:14}}>{nm}</div>
                <div style={{fontSize:11,color:C.muted,marginTop:1}}>📱 {ph}</div>
                {(u.Email||u.email)&&<div style={{fontSize:11,color:C.muted}}>✉️ {u.Email||u.email}</div>}
                <div style={{fontSize:10,color:C.muted,marginTop:1}}>🕐 {timeAgo(u.Timestamp||u.timestamp)}</div>
              </div>
              <span className="pill p-pending">⏳ পেন্ডিং</span>
            </div>
            <button className="btn btn-s btn-block" disabled={!!activating} onClick={()=>activate(u)}>
              {busy?"⏳ হচ্ছে...":"✅ অ্যাক্টিভ করুন"}
            </button>
          </div>
        );
       })
      }
    </div>
  );
}

/* ══════════════════════════════════════════
   STUDENTS — list + detail view
══════════════════════════════════════════ */
function StudentsPage({push,forceRefresh}){
  const{data:ud,loading}=useSWR({action:"getUsers",lite:"1"},forceRefresh);
  const[overrides,setOverrides]=useState({});
  const[search,setSearch]=useState("");
  const[tab,setTab]=useState("all");
  const[notify,setNotify]=useState(null);
  const[detail,setDetail]=useState(null);
  const[activating,setActivating]=useState(null);

  const users=(ud?.users||[]).map(u=>{
    const ph=u.Phone||u.phone||"";
    return overrides[ph]?{...u,Status:overrides[ph],status:overrides[ph]}:u;
  });
  const filtered=users.filter(u=>{
    const nm=(u.Name||u.name||"").toLowerCase(), ph=(u.Phone||u.phone||"").toLowerCase();
    const st=(u.Status||u.status||"").toLowerCase(), q=search.toLowerCase();
    return(!q||nm.includes(q)||ph.includes(q))&&(tab==="all"||st===tab);
  });

  const activate=async(u)=>{
    const phone=u.Phone||u.phone||"";
    if(!phone)return;
    setActivating(phone);
    try{
      const r=await apiAction({action:"activateUser",phone});
      if(r.result==="success"){
        push("success","✅ অ্যাক্টিভ!",u.Name||u.name);
        setOverrides(p=>({...p,[phone]:"Active"}));
        cacheInvalidate("getUsers"); fetchAndCache({action:"getUsers"},true);
      }else push("error","ব্যর্থ",r.error);
    }catch(e){push("error","সমস্যা",e.message);}
    setActivating(null);
  };

  if(detail) return <StudentDetailPage user={detail} onBack={()=>setDetail(null)} push={push}/>;

  return(
    <div className="page">
      <div className="sw"><span className="si">🔍</span><input className="input" placeholder="নাম বা ফোন..." value={search} onChange={e=>setSearch(e.target.value)}/></div>
      <div className="ftabs">
        {[["all","সবাই"],["active","✅ অ্যাক্টিভ"],["inactive","🔴 ইনঅ্যাক্টিভ"]].map(([v,l])=>(
          <button key={v} className={`ftab${tab===v?" active":""}`} onClick={()=>setTab(v)}>{l}</button>
        ))}
      </div>
      <div style={{fontSize:11,color:C.muted,marginBottom:9}}>{filtered.length} জন</div>
      {loading&&!ud?[...Array(5)].map((_,i)=><div key={i} className="skel"/>):
       filtered.length===0?<div className="empty"><div className="ei">👤</div><p>কেউ নেই</p></div>:
       filtered.map((u,i)=>{
        const nm=u.Name||u.name||"অজানা",ph=u.Phone||u.phone||"—";
        const st=(u.Status||u.status||"inactive").toLowerCase(), busy=activating===ph;
        const correct=parseInt(u._totalCorrect)||0, wrong=parseInt(u._totalWrong)||0;
        const total2=correct+wrong, acc=total2?Math.round(correct/total2*100):0;
        return(
          <div key={i} className="card" style={{padding:12,cursor:"pointer"}} onClick={()=>setDetail(u)}>
            <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:9}}>
              <div className="avatar">{initials(nm)}</div>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontWeight:700,fontSize:13}}>{nm}</div>
                <div style={{fontSize:11,color:C.muted}}>📱 {ph}</div>
              </div>
              <div style={{textAlign:"right"}}>
                <span className={`pill p-${st==="active"?"active":"inactive"}`}>{st==="active"?"✅":"🔴"} {st==="active"?"অ্যাক্টিভ":"ইনঅ্যাক্টিভ"}</span>
                {total2>0&&<div style={{fontSize:10,color:acc>=70?C.green:acc>=40?C.yellow:C.red,marginTop:3,fontWeight:700}}>{acc}% accuracy</div>}
              </div>
            </div>
            <div style={{display:"flex",gap:7,marginBottom:9}}>
              {[[C.green,correct,"✅ সঠিক"],[C.red,wrong,"❌ ভুল"],[C.accent,parseInt(u._totalMinutes)||0,"⏱ মিনিট"]].map(([cl,val,lb])=>(
                <div key={lb} style={{textAlign:"center",flex:1,background:C.panel,borderRadius:8,padding:"6px 2px"}}>
                  <div style={{color:cl,fontWeight:700,fontSize:13}}>{val}</div>
                  <div style={{color:C.muted,fontSize:9}}>{lb}</div>
                </div>
              ))}
            </div>
            <div style={{display:"flex",gap:7}} onClick={e=>e.stopPropagation()}>
              {st!=="active"&&<button className="btn btn-s" style={{flex:1,justifyContent:"center",fontSize:11}} disabled={!!activating} onClick={()=>activate(u)}>{busy?"⏳":"✅ অ্যাক্টিভ"}</button>}
              <button className="btn btn-g" style={{flex:1,justifyContent:"center",fontSize:11}} onClick={()=>setNotify(u)}>📣 নোটিফাই</button>
              <button className="btn btn-p" style={{flex:1,justifyContent:"center",fontSize:11}} onClick={()=>setDetail(u)}>👁 বিস্তারিত</button>
            </div>
          </div>
        );
       })
      }
      {notify&&<NotifyModal user={notify} onClose={()=>setNotify(null)} push={push}/>}
    </div>
  );
}

/* ── Student Detail Fullscreen Page ── */
function StudentDetailPage({user,onBack,push}){
  const[fbData,setFbData]=useState(null);
  const[loading,setLoading]=useState(true);
  const nm=user.Name||user.name||"অজানা";
  const ph=(user.Phone||user.phone||"").replace(/^'+/,"");
  const phNorm=ph.replace(/^0+/,"");
  const st=(user.Status||user.status||"inactive").toLowerCase();

  useEffect(()=>{
    (async()=>{
      setLoading(true);
      try{
        // Firebase থেকে Analytics data
        const summary=await fbGet(`Analytics/Summary`);
        const timeData=await fbGet(`Analytics/Time`);
        const subjectData=await fbGet(`Analytics/Subject`);
        // phone match
        let matched=null, timeMatched=null, subjectMatched=null;
        const tryMatch=(obj,k)=>{
          if(!obj||typeof obj!=="object") return null;
          const kn=k.replace(/^0+/,"");
          for(const key of Object.keys(obj)){
            const kk=key.replace(/_/g,"").replace(/^0+/,"");
            if(kk===kn||key.replace(/^0+/,"")===kn) return obj[key];
          }
          return null;
        };
        matched=tryMatch(summary,phNorm);
        timeMatched=tryMatch(timeData,phNorm);
        subjectMatched=tryMatch(subjectData,phNorm);
        // daily time breakdown
        const dailyTime=[];
        if(timeMatched&&typeof timeMatched==="object"){
          const sorted=Object.entries(timeMatched).sort(([a],[b])=>a.localeCompare(b)).slice(-7);
          sorted.forEach(([date,mins])=>dailyTime.push({l:date.slice(5),v:parseInt(mins)||0}));
        }
        setFbData({matched,dailyTime,subjectMatched});
      }catch(e){}
      setLoading(false);
    })();
  },[phNorm]);

  const correct=parseInt(user._totalCorrect)||fbData?.matched?.totalCorrect||0;
  const wrong=parseInt(user._totalWrong)||fbData?.matched?.totalWrong||0;
  const totalQ=correct+wrong;
  const acc=totalQ?Math.round(correct/totalQ*100):0;
  const mins=parseInt(user._totalMinutes)||0;
  const quizzes=parseInt(user._totalQuizzes)||fbData?.matched?.totalQuizzes||0;

  // subject breakdown
  const subj=fbData?.subjectMatched;
  const subjEntries=subj&&typeof subj==="object"?Object.entries(subj):[];

  return(
    <div className="fullscreen">
      <div className="fs-header">
        <button className="back-btn" onClick={onBack}>←</button>
        <div className="avatar">{initials(nm)}</div>
        <div style={{flex:1,minWidth:0}}>
          <div style={{fontWeight:700,fontSize:15,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{nm}</div>
          <div style={{fontSize:11,color:C.muted}}>📱 {ph}</div>
        </div>
        <span className={`pill p-${st==="active"?"active":"inactive"}`}>{st==="active"?"✅ অ্যাক্টিভ":"🔴 ইনঅ্যাক্টিভ"}</span>
      </div>

      <div style={{padding:"14px 14px 80px"}}>
        {/* Accuracy Ring + Stats */}
        <div className="card">
          <div style={{display:"flex",alignItems:"center",gap:14}}>
            <PerfRing val={correct} max={totalQ} color={acc>=70?C.green:acc>=40?C.yellow:C.red}/>
            <div style={{flex:1}}>
              <div style={{fontSize:20,fontWeight:700,color:acc>=70?C.green:acc>=40?C.yellow:C.red,marginBottom:4}}>{acc}% Accuracy</div>
              <div style={{fontSize:12,color:C.muted}}>সঠিক: <b style={{color:C.green}}>{correct}</b> &nbsp; ভুল: <b style={{color:C.red}}>{wrong}</b></div>
              <div style={{fontSize:12,color:C.muted,marginTop:2}}>মোট প্রশ্ন: <b style={{color:C.text}}>{totalQ}</b> &nbsp; Quiz: <b style={{color:C.accent}}>{quizzes}</b></div>
            </div>
          </div>
        </div>

        {/* Time & Activity */}
        <div className="stat-grid">
          <div className="stat-card t-purple" data-icon="⏱"><div className="stat-label">মোট সময়</div><div className="stat-value sv-purple" style={{fontSize:20}}>{mins<60?mins+"মি":~~(mins/60)+"ঘণ্টা"}</div></div>
          <div className="stat-card t-blue"   data-icon="📅"><div className="stat-label">শেষ সক্রিয়</div><div style={{fontSize:13,fontWeight:700,marginTop:6,color:C.accent}}>{timeAgo(user._lastActive||user.Timestamp)}</div></div>
        </div>

        {/* Daily Study Time */}
        {loading?<div className="skel"/>:
          fbData?.dailyTime?.length>0&&(
            <div className="card">
              <div className="card-title">⏱ দৈনিক পড়ার সময় (মিনিট)</div>
              <MiniBarChart data={fbData.dailyTime} color={C.purple}/>
            </div>
          )
        }

        {/* Subject Performance */}
        {loading?<div className="skel"/>:
          subjEntries.length>0&&(
            <div className="card">
              <div className="card-title">📚 বিষয়ভিত্তিক Performance</div>
              {subjEntries.map(([sub,sv])=>{
                const c=sv.correct||0, w=sv.wrong||0, tot=c+w;
                const a=tot?Math.round(c/tot*100):0;
                return(
                  <div key={sub} className="srow">
                    <div style={{flex:1}}>
                      <div style={{fontWeight:600,fontSize:13}}>{sub}</div>
                      <div style={{display:"flex",alignItems:"center",marginTop:3}}>
                        <div className="sbar"><div className="sbar-f" style={{width:a+"%",background:a>=70?C.green:a>=40?C.yellow:C.red}}/></div>
                      </div>
                      <div style={{fontSize:9,color:C.muted,marginTop:1}}>✅{c} ❌{w} · {tot}টি প্রশ্ন</div>
                    </div>
                    <div style={{fontWeight:700,fontSize:15,color:a>=70?C.green:a>=40?C.yellow:C.red,minWidth:36,textAlign:"right"}}>{a}%</div>
                  </div>
                );
              })}
            </div>
          )
        }

        {/* User Info */}
        <div className="card">
          <div className="card-title">👤 ব্যক্তিগত তথ্য</div>
          {[
            ["📱 ফোন", ph],
            ["✉️ ইমেইল", user.Email||user.email||"—"],
            ["🎓 ধরন", user.Type||user.type||"Student"],
            ["📅 যোগদান", user.Timestamp||user.timestamp||"—"],
          ].map(([l,v])=>(
            <div key={l} style={{display:"flex",justifyContent:"space-between",padding:"8px 0",borderBottom:`1px solid ${C.border}40`,fontSize:13}}>
              <span style={{color:C.muted}}>{l}</span>
              <span style={{fontWeight:600,maxWidth:"60%",textAlign:"right"}}>{v}</span>
            </div>
          ))}
        </div>

        <NotifyModal user={user} onClose={onBack} push={push} inDetail/>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════
   REPORTS
══════════════════════════════════════════ */
function ReportsPage({push,forceRefresh}){
  const{data:dash,loading}=useSWR({action:"getDashboard"},forceRefresh);
  const[localDone,setLocalDone]=useState([]);
  const[editing,setEditing]=useState(null);
  const reports=(dash?.reports||[]).filter(r=>!localDone.includes(r.row));

  return(
    <div className="page">
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:12}}>
        <div style={{fontSize:12,color:C.muted}}>{reports.length}টি রিপোর্ট পেন্ডিং</div>
        {loading&&<span style={{fontSize:10,color:C.muted}}>⏳ আপডেট...</span>}
      </div>
      {loading&&!dash?[...Array(4)].map((_,i)=><div key={i} className="skel"/>):
       reports.length===0?<div className="empty"><div className="ei">📋</div><p>কোনো রিপোর্ট নেই! 🎉</p></div>:
       reports.map((r,i)=>(
        <div key={i} className="rc">
          <div style={{fontWeight:700,fontSize:13}}>{r.subject||"অজানা"}</div>
          <div className="r-meta">
            <span>📱 {r.phone||"—"}</span>
            {r.subtopic&&<span>📌 {r.subtopic}</span>}
            {r.questionId&&<span style={{color:C.accent}}>#{r.questionId}</span>}
            <span>{timeAgo(r.time)}</span>
          </div>
          <div className="r-issue">{r.issue||r.question||"বিস্তারিত নেই"}</div>
          {r.question&&r.question!==r.issue&&<div style={{fontSize:11,color:C.muted,marginTop:5,paddingLeft:7,lineHeight:1.5}}>❓ {r.question.slice(0,120)}{r.question.length>120?"…":""}</div>}
          <button className="btn btn-p btn-block" style={{marginTop:9}} onClick={()=>setEditing(r)}>✏️ এডিট করুন ও সমাধান দিন</button>
        </div>
       ))
      }
      {editing&&<EditResolveModal report={editing} onClose={()=>setEditing(null)} onDone={row=>{setLocalDone(p=>[...p,row]);setEditing(null);cacheInvalidate("getDashboard");fetchAndCache({action:"getDashboard"},true);}} push={push}/>}
    </div>
  );
}

function EditResolveModal({report,onClose,onDone,push}){
  const[step,setStep]=useState(1);
  const[qdata,setQdata]=useState(null);
  const[loadingQ,setLoadingQ]=useState(true);
  const[saving,setSaving]=useState(false);
  const[notifying,setNotifying]=useState(false);

  // edit fields
  const[question,setQuestion]=useState("");
  const[opt1,setOpt1]=useState("");
  const[opt2,setOpt2]=useState("");
  const[opt3,setOpt3]=useState("");
  const[opt4,setOpt4]=useState("");
  const[correct,setCorrect]=useState("");
  const[explanation,setExplanation]=useState("");
  const[technique,setTechnique]=useState("");

  useEffect(()=>{
    (async()=>{
      setLoadingQ(true);
      if(report.questionId){
        for(const tab of["Quiz","QBank"]){
          try{
            const d=await fetch(GAS_URL+"?"+new URLSearchParams({id:report.questionId,tab}).toString()).then(r=>r.json());
            if(d.status==="success"){
              const q=d.data;
              setQdata({...q,_tab:tab});
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
      }
      setLoadingQ(false);
    })();
  },[report.questionId]);

  // একটা field save করে
  const saveField=async(field,value)=>{
    if(!qdata||!report.questionId||!value.trim()) return;
    await apiAction({
      action:"updateField",
      sheet:qdata._tab||"Quiz",
      id:report.questionId,
      field,
      content:encodeURIComponent(value),
    });
  };

  const save=async()=>{
    if(!qdata){setStep(2);return;}
    setSaving(true);
    try{
      // সব field একসাথে save করো
      const fields=[
        ["question",question],
        ["opt1",opt1],["opt2",opt2],["opt3",opt3],["opt4",opt4],
        ["correct",correct],
        ["explanation",explanation],
        ["technique",technique],
      ];
      for(const[f,v] of fields){
        if(v.trim()) await saveField(f,v);
      }
      push("success","✅ সেভ হয়েছে!","প্রশ্ন আপডেট হয়েছে");
      setStep(2);
    }catch(e){push("error","Save ব্যর্থ",e.message);}
    setSaving(false);
  };

  const notify=async()=>{
    setNotifying(true);
    try{
      await apiAction({action:"resolveReport",phone:report.phone,subject:encodeURIComponent(report.subject||"প্রশ্নটি"),questionId:report.questionId||""});
      push("success","✅ সমাধান ও নোটিফাই!",`${report.phone} কে জানানো হয়েছে`);
      onDone(report.row);
    }catch(e){push("error","Notify ব্যর্থ",e.message);}
    setNotifying(false);
  };

  // overlay click এ close করা যাবে না — keyboard focus হারায়
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
          <div style={{background:"#ef444412",border:"1px solid #ef444430",borderRadius:10,padding:"8px 11px",marginBottom:12}}>
            <div style={{fontSize:10,color:C.red,fontWeight:700,marginBottom:2}}>🚨 {report.phone} · {report.subject}</div>
            <div style={{fontSize:12,color:C.text}}>{report.issue||"—"}</div>
          </div>
          {loadingQ
            ?<><div className="skel" style={{height:50}}/><div className="skel"/></>
            :!qdata
              ?<div style={{textAlign:"center",color:C.muted,padding:"16px 0",fontSize:12}}>প্রশ্ন #{report.questionId||"—"} পাওয়া যায়নি।</div>
              :<>
                <div className="field">
                  <label>❓ প্রশ্ন</label>
                  <textarea className="ta" value={question} onChange={e=>setQuestion(e.target.value)} style={{minHeight:70}}/>
                </div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
                  <div className="field"><label>A</label><input className="input" value={opt1} onChange={e=>setOpt1(e.target.value)}/></div>
                  <div className="field"><label>B</label><input className="input" value={opt2} onChange={e=>setOpt2(e.target.value)}/></div>
                  <div className="field"><label>C</label><input className="input" value={opt3} onChange={e=>setOpt3(e.target.value)}/></div>
                  <div className="field"><label>D</label><input className="input" value={opt4} onChange={e=>setOpt4(e.target.value)}/></div>
                </div>
                <div className="field">
                  <label>✅ সঠিক উত্তর</label>
                  <div style={{display:"flex",gap:5,flexWrap:"wrap",marginBottom:6}}>
                    {[opt1,opt2,opt3,opt4].filter(Boolean).map((o,i)=>(
                      <button key={i} type="button" className={`btn ${correct===o?"btn-s":"btn-g"}`} style={{fontSize:11,padding:"4px 8px"}} onClick={()=>setCorrect(o)}>{o.slice(0,16)}{o.length>16?"…":""}</button>
                    ))}
                  </div>
                  <input className="input" value={correct} onChange={e=>setCorrect(e.target.value)} placeholder="বা সরাসরি লিখুন..."/>
                </div>
                <div className="field">
                  <label>📖 Explanation</label>
                  <textarea className="ta" value={explanation} onChange={e=>setExplanation(e.target.value)} style={{minHeight:80}}/>
                </div>
                <div className="field">
                  <label>💡 Technique</label>
                  <textarea className="ta" value={technique} onChange={e=>setTechnique(e.target.value)} style={{minHeight:55}}/>
                </div>
              </>
          }
          <div style={{display:"flex",gap:7,marginTop:4}}>
            <button type="button" className="btn btn-g" style={{flex:1,justifyContent:"center"}} onClick={onClose}>বাতিল</button>
            <button type="button" className="btn btn-p" style={{flex:2,justifyContent:"center"}} disabled={saving} onClick={save}>{saving?"⏳...":"💾 সেভ →"}</button>
          </div>
        </>}

        {step===2&&<>
          <div className="mtitle">📣 স্টুডেন্টকে নোটিফাই করুন</div>
          <div style={{background:"#22c55e12",border:"1px solid #22c55e30",borderRadius:11,padding:"13px",marginBottom:14}}>
            <div style={{fontSize:13,fontWeight:700,color:C.green,marginBottom:5}}>✅ প্রশ্ন আপডেট সম্পন্ন!</div>
            <div style={{fontSize:11,color:C.muted}}>এখন স্টুডেন্টকে জানান যে তাদের রিপোর্ট সমাধান হয়েছে।</div>
          </div>
          <div style={{background:C.panel,borderRadius:10,padding:"12px 14px",marginBottom:14}}>
            <div style={{fontSize:11,color:C.muted,marginBottom:5}}>নোটিফিকেশন পাবেন:</div>
            <div style={{fontWeight:700,fontSize:14}}>📱 {report.phone}</div>
            <div style={{fontSize:11,color:C.muted,marginTop:3}}>{report.subject} {report.questionId?"· #"+report.questionId:""}</div>
            <div style={{fontSize:11,color:C.accent,marginTop:6,lineHeight:1.5}}>"✅ আপনার রিপোর্ট সমাধান হয়েছে! প্রশ্নটি সংশোধন করা হয়েছে।"</div>
          </div>
          <div style={{display:"flex",gap:7}}>
            <button className="btn btn-g" style={{flex:1,justifyContent:"center"}} onClick={()=>onDone(report.row)}>এড়িয়ে যান</button>
            <button className="btn btn-s" style={{flex:2,justifyContent:"center"}} disabled={notifying} onClick={notify}>
              {notifying?"⏳ পাঠানো হচ্ছে...":"✅ নোটিফাই করুন"}
            </button>
          </div>
        </>}
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════
   GLOBAL SEARCH
══════════════════════════════════════════ */
function SearchPage({push,onStudentDetail}){
  const[q,setQ]=useState("");
  const[results,setResults]=useState(null);
  const[loading,setLoading]=useState(false);
  const debounce=useRef(null);

  const doSearch=async(query)=>{
    if(!query||query.length<2){setResults(null);return;}
    setLoading(true);
    try{
      const[byTag,users]=await Promise.all([
        apiFetch({action:"findByTag",q:query},true),
        apiFetch({action:"getUsers"},false),
      ]);
      const qs=byTag?.results||[];
      const uList=(users?.users||[]).filter(u=>{
        const nm=(u.Name||u.name||"").toLowerCase();
        const ph=(u.Phone||u.phone||"").toLowerCase();
        const qlo=query.toLowerCase();
        return nm.includes(qlo)||ph.includes(qlo);
      });
      setResults({questions:qs.slice(0,10),users:uList.slice(0,8)});
    }catch(e){push("error","সমস্যা",e.message);}
    setLoading(false);
  };

  const onInput=v=>{
    setQ(v);
    clearTimeout(debounce.current);
    debounce.current=setTimeout(()=>doSearch(v),450);
  };

  const total=(results?.questions?.length||0)+(results?.users?.length||0);

  return(
    <div className="page">
      <div className="sw" style={{marginBottom:14}}>
        <span className="si">🔍</span>
        <input className="input" placeholder="নাম, ফোন, প্রশ্ন, বিষয় — সব খুঁজুন..." value={q} onChange={e=>onInput(e.target.value)} autoFocus/>
      </div>

      {loading&&<div style={{textAlign:"center",padding:"28px 0",color:C.muted,fontSize:13}}>⏳ খোঁজা হচ্ছে...</div>}

      {!loading&&results&&(
        <div style={{fontSize:11,color:C.muted,marginBottom:10}}>{total}টি ফলাফল পাওয়া গেছে</div>
      )}

      {results?.users?.length>0&&(
        <>
          <div className="slabel">👥 স্টুডেন্ট</div>
          {results.users.map((u,i)=>{
            const nm=u.Name||u.name||"অজানা", ph=u.Phone||u.phone||"—";
            const st=(u.Status||u.status||"inactive").toLowerCase();
            return(
              <div key={i} className="sr-item" onClick={()=>onStudentDetail(u)}>
                <div className="avatar sm">{initials(nm)}</div>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontWeight:600,fontSize:13}}>{nm}</div>
                  <div style={{fontSize:11,color:C.muted}}>📱 {ph}</div>
                </div>
                <span className={`pill p-${st==="active"?"active":"inactive"}`}>{st==="active"?"✅":"🔴"}</span>
              </div>
            );
          })}
        </>
      )}

      {results?.questions?.length>0&&(
        <>
          <div className="slabel">❓ প্রশ্ন</div>
          {results.questions.map((q2,i)=>(
            <div key={i} className="sr-item" style={{cursor:"default"}}>
              <div>
                <span className="sr-tag">{q2.tab}</span>
              </div>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontSize:12,fontWeight:600,lineHeight:1.4}}>{q2.question?.slice(0,90)}{q2.question?.length>90?"…":""}</div>
                {q2.correct&&<div style={{fontSize:10,color:C.green,marginTop:2}}>✅ {q2.correct}</div>}
              </div>
              <div style={{fontSize:10,color:C.muted,whiteSpace:"nowrap"}}>#{q2.id}</div>
            </div>
          ))}
        </>
      )}

      {!loading&&results&&total===0&&(
        <div className="empty"><div className="ei">🔍</div><p>"{q}" এর কোনো ফলাফল নেই</p></div>
      )}

      {!results&&!loading&&(
        <div className="empty" style={{paddingTop:32}}>
          <div className="ei">🔍</div>
          <p style={{fontSize:13}}>স্টুডেন্টের নাম/ফোন<br/>বা প্রশ্নের কীওয়ার্ড লিখুন</p>
        </div>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════
   NOTIFICATIONS
══════════════════════════════════════════ */
function NotificationsPage({push}){
  const[title,setTitle]=useState("");
  const[body,setBody]=useState("");
  const[sending,setSending]=useState(false);
  const[hist,setHist]=useState([{title:"নতুন কুইজ যোগ!",body:"Physics থেকে নতুন প্রশ্ন",time:"আগে"}]);

  const send=async()=>{
    if(!title||!body){push("warn","তথ্য দিন","Title ও Message দরকার");return;}
    setSending(true);
    try{
      const r=await apiAction({action:"broadcastNotification",title:encodeURIComponent(title),body:encodeURIComponent(body)});
      push("success","পাঠানো হয়েছে! 🎉",`${r.fcm?.sent||0} জনকে পাঠানো হয়েছে`);
      setHist(p=>[{title,body,time:"এখনই"},...p]);
      setTitle(""); setBody("");
    }catch(e){push("error","ব্যর্থ",e.message);}
    setSending(false);
  };

  return(
    <div className="page">
      <div className="bcard">
        <div className="card-title">📣 সবাইকে Broadcast</div>
        <div className="field"><label>শিরোনাম</label><input className="input" placeholder="নোটিফিকেশনের শিরোনাম..." value={title} onChange={e=>setTitle(e.target.value)}/></div>
        <div className="field"><label>বার্তা</label><textarea className="ta" placeholder="বিস্তারিত লিখুন..." value={body} onChange={e=>setBody(e.target.value)}/></div>
        <button className="btn btn-p btn-block" onClick={send} disabled={sending}>{sending?"⏳ পাঠানো হচ্ছে...":"📣 সবাইকে পাঠান"}</button>
      </div>
      <div className="slabel">ইতিহাস</div>
      <div className="card">
        {hist.map((h,i)=>(
          <div key={i} className="nrow">
            <div className={`ndot ${i===0?"n":"o"}`}/>
            <div className="ncontent"><div className="ntitle">{h.title}</div><div className="nsub">{h.body?.slice(0,55)}</div></div>
            <div className="ntime">{h.time}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function NotifyModal({user,onClose,push,inDetail}){
  const[title,setTitle]=useState("");
  const[body,setBody]=useState("");
  const[sending,setSending]=useState(false);
  const nm=user.Name||user.name||"স্টুডেন্ট";

  const send=async()=>{
    if(!title||!body)return;
    setSending(true);
    try{
      await apiAction({action:"broadcastNotification",title:encodeURIComponent(title),body:encodeURIComponent(body)});
      push("success","পাঠানো হয়েছে",`${nm} কে নোটিফাই করা হয়েছে`);
      if(!inDetail) onClose();
    }catch(e){push("error","ব্যর্থ",e.message);}
    setSending(false);
  };

  if(inDetail) return(
    <div className="card">
      <div className="card-title">📣 ব্যক্তিগত নোটিফিকেশন</div>
      <div className="field"><label>শিরোনাম</label><input className="input" placeholder="Title..." value={title} onChange={e=>setTitle(e.target.value)}/></div>
      <div className="field"><label>বার্তা</label><textarea className="ta" placeholder="Message..." value={body} onChange={e=>setBody(e.target.value)}/></div>
      <button className="btn btn-p btn-block" onClick={send} disabled={sending}>{sending?"⏳":"📨 পাঠান"}</button>
    </div>
  );

  return(
    <div className="overlay">
      <div className="modal" onClick={e=>e.stopPropagation()}>
        <div className="mhandle"/>
        <div className="mtitle">📣 {nm}</div>
        <div style={{fontSize:11,color:C.muted,marginBottom:12}}>📱 {user.Phone||user.phone}</div>
        <div className="field"><label>শিরোনাম</label><input className="input" placeholder="Title..." value={title} onChange={e=>setTitle(e.target.value)}/></div>
        <div className="field"><label>বার্তা</label><textarea className="ta" placeholder="Message..." value={body} onChange={e=>setBody(e.target.value)}/></div>
        <div style={{display:"flex",gap:8}}>
          <button className="btn btn-g" style={{flex:1,justifyContent:"center"}} onClick={onClose}>বাতিল</button>
          <button className="btn btn-p" style={{flex:1,justifyContent:"center"}} onClick={send} disabled={sending}>{sending?"⏳":"📨 পাঠান"}</button>
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════
   ROOT APP
══════════════════════════════════════════ */
const NAV=[
  {id:"dashboard",icon:"📊",label:"Dashboard"},
  {id:"signups",  icon:"🆕",label:"সাইনআপ",  badge:true},
  {id:"students", icon:"👥",label:"Students"},
  {id:"reports",  icon:"🚨",label:"Reports",  badge:true},
  {id:"search",   icon:"🔍",label:"Search"},
  {id:"notifs",   icon:"📣",label:"Notify"},
];

export default function App(){
  const[page,setPage]=useState("dashboard");
  const[toasts,push]=useToasts();
  const[refreshTick,setRefreshTick]=useState(0);
  const[spin,setSpin]=useState(false);
  const[searchDetail,setSearchDetail]=useState(null);

  const doRefresh=()=>{
    setSpin(true);
    cacheInvalidate("getDashboard","getUsers");
    setRefreshTick(t=>t+1);
    setTimeout(()=>setSpin(false),1500);
  };

  useEffect(()=>{
    const id=setInterval(()=>setRefreshTick(t=>t+1),60_000);
    return()=>clearInterval(id);
  },[]);

  // Search থেকে student detail
  if(searchDetail) return(
    <>
      <style>{css}</style>
      <StudentDetailPage user={searchDetail} onBack={()=>setSearchDetail(null)} push={push}/>
      <div className="toasts">{toasts.map(t=>(<div key={t.id} className={`toast ${t.type}`}><div className="t-icon">{t.type==="success"?"✅":t.type==="error"?"❌":t.type==="warn"?"⚠️":"ℹ️"}</div><div className="t-body"><div className="t-title">{t.title}</div>{t.msg&&<div className="t-msg">{t.msg}</div>}</div></div>))}</div>
    </>
  );

  const curNav=NAV.find(n=>n.id===page);

  return(
    <>
      <style>{css}</style>
      <div className="topbar">
        <div>
          <div className="topbar-title">{curNav?.icon} {curNav?.label}</div>
          <div className="topbar-sub">Smart Study Admin</div>
        </div>
        <button className={`icon-btn${spin?" spinning":""}`} onClick={doRefresh}>🔄</button>
      </div>

      <div style={{display:page==="dashboard"?"block":"none"}}><DashboardPage push={push} forceRefresh={refreshTick}/></div>
      <div style={{display:page==="signups"  ?"block":"none"}}><SignupsPage   push={push} forceRefresh={refreshTick}/></div>
      <div style={{display:page==="students" ?"block":"none"}}><StudentsPage  push={push} forceRefresh={refreshTick}/></div>
      <div style={{display:page==="reports"  ?"block":"none"}}><ReportsPage   push={push} forceRefresh={refreshTick}/></div>
      <div style={{display:page==="search"   ?"block":"none"}}><SearchPage    push={push} onStudentDetail={u=>{setSearchDetail(u);}}/></div>
      <div style={{display:page==="notifs"   ?"block":"none"}}><NotificationsPage push={push}/></div>

      <nav className="bottom-nav">
        {NAV.map(n=>(
          <button key={n.id} className={`nav-btn${page===n.id?" active":""}`} onClick={()=>setPage(n.id)}>
            <span className="nav-icon">{n.icon}</span>
            <span>{n.label}</span>
            {n.badge&&<span className="nav-badge">!</span>}
          </button>
        ))}
      </nav>

      <div className="toasts">
        {toasts.map(t=>(
          <div key={t.id} className={`toast ${t.type}`}>
            <div className="t-icon">{t.type==="success"?"✅":t.type==="error"?"❌":t.type==="warn"?"⚠️":"ℹ️"}</div>
            <div className="t-body"><div className="t-title">{t.title}</div>{t.msg&&<div className="t-msg">{t.msg}</div>}</div>
          </div>
        ))}
      </div>
    </>
  );
}
