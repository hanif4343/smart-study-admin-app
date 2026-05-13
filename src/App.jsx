import { useState, useEffect, useCallback, useRef } from "react";

const GAS_URL = "https://script.google.com/macros/s/AKfycbyjF7iFX0H_rFuJgMJYo70DC7KRX1lBXU7m7NoZCwf6VTJfRm6Iyw6hOcN2q_UKbxxgQg/exec";

const C = {
  bg:"#06080f",card:"#0c1220",border:"#16253d",
  accent:"#3b82f6",accentGlow:"#3b82f620",
  green:"#22c55e",red:"#ef4444",yellow:"#f59e0b",purple:"#8b5cf6",
  text:"#e2e8f0",muted:"#4b5e7a",panel:"#0e1a2e",navBg:"#080f1c",
};

/* ─────────────────────────────────────────
   STALE-WHILE-REVALIDATE CACHE
   1. হিট হলে সাথে সাথে stale data দেখাও
   2. background এ নতুন fetch করো
   3. নতুন data এলে subscriber update করো
───────────────────────────────────────── */
const _store = {};        // { key: { data, ts } }
const _subs = {};         // { key: Set<callback> }
const _inflight = {};     // { key: Promise }
const FRESH_MS = 30_000;  // 30s এর মধ্যে fresh, revalidate করবে না

function cacheGet(key) { return _store[key]?.data ?? null; }

function cacheSub(key, cb) {
  if (!_subs[key]) _subs[key] = new Set();
  _subs[key].add(cb);
  return () => _subs[key].delete(cb);
}

function cacheNotify(key, data) {
  _store[key] = { data, ts: Date.now() };
  (_subs[key] || new Set()).forEach(cb => cb(data));
}

function cacheInvalidate(...patterns) {
  patterns.forEach(p => {
    Object.keys(_store).forEach(k => { if (k.includes(p)) delete _store[k]; });
  });
}

async function fetchAndCache(params, force = false) {
  const key = JSON.stringify(params);
  const now = Date.now();
  const cached = _store[key];

  // যদি fresh থাকে এবং force না হলে skip
  if (!force && cached && now - cached.ts < FRESH_MS) return cached.data;

  // in-flight dedupe
  if (_inflight[key]) return _inflight[key];

  const qs = new URLSearchParams(params).toString();
  _inflight[key] = fetch(GAS_URL + "?" + qs)
    .then(r => r.json())
    .then(data => {
      delete _inflight[key];
      cacheNotify(key, data);
      return data;
    })
    .catch(e => { delete _inflight[key]; throw e; });

  return _inflight[key];
}

/* hook: stale-while-revalidate
   - mount এ stale data instant দেখাও
   - background এ revalidate করো
   - forceRefresh বাড়লে force fetch */
function useSWR(params, forceRefresh = 0) {
  const key = JSON.stringify(params);
  const [data, setData] = useState(() => cacheGet(key));
  const [loading, setLoading] = useState(!cacheGet(key));
  const prevForce = useRef(0);

  useEffect(() => {
    // subscribe করো
    const unsub = cacheSub(key, d => {
      setData(d);
      setLoading(false);
    });

    const force = forceRefresh > prevForce.current;
    prevForce.current = forceRefresh;

    // stale থাকলে background revalidate, না থাকলে normal fetch
    const stale = cacheGet(key);
    if (stale && !force) {
      setData(stale);
      setLoading(false);
      // silently revalidate (no loading spinner)
      fetchAndCache(params, false).catch(() => {});
    } else {
      if (!stale) setLoading(true);
      fetchAndCache(params, force).catch(() => setLoading(false));
    }

    return unsub;
  }, [key, forceRefresh]);

  return { data, loading };
}

/* direct action (GET, no cache) */
const apiAction = async (params) => {
  const r = await fetch(GAS_URL + "?" + new URLSearchParams(params).toString());
  return r.json();
};

/* ─── Helpers ─── */
const fmt = n => (n || 0).toLocaleString();
const initials = n => (n || "?").split(" ").map(w => w[0]).join("").toUpperCase().slice(0, 2);
const timeAgo = ts => {
  if (!ts) return "—";
  try {
    const d = new Date(ts.replace ? ts.replace(/(\d{2})-(\d{2})-(\d{4})/, "$3-$2-$1") : ts);
    const s = Date.now() - d.getTime();
    if (s < 60000) return "এখনই";
    if (s < 3600000) return ~~(s / 60000) + "মি আগে";
    if (s < 86400000) return ~~(s / 3600000) + "ঘণ্টা আগে";
    return ~~(s / 86400000) + "দিন আগে";
  } catch { return ts; }
};

/* ─── Toast ─── */
let _tid = 0;
function useToasts() {
  const [toasts, set] = useState([]);
  const push = useCallback((type, title, msg = "") => {
    const id = ++_tid;
    set(p => [...p, { id, type, title, msg }]);
    setTimeout(() => set(p => p.filter(t => t.id !== id)), 4000);
  }, []);
  return [toasts, push];
}

/* ═════════════════════════════════════════
   CSS
═════════════════════════════════════════ */
const css = `
@import url('https://fonts.googleapis.com/css2?family=Noto+Sans+Bengali:wght@400;500;600;700&family=Space+Grotesk:wght@400;500;600;700&display=swap');
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
html,body,#root{background:${C.bg};color:${C.text};font-family:'Noto Sans Bengali','Space Grotesk',sans-serif;min-height:100dvh;max-width:480px;margin:0 auto;overflow-x:hidden}
::-webkit-scrollbar{width:3px}::-webkit-scrollbar-thumb{background:${C.border};border-radius:10px}

.bottom-nav{position:fixed;bottom:0;left:50%;transform:translateX(-50%);width:100%;max-width:480px;background:${C.navBg};border-top:1px solid ${C.border};display:flex;z-index:100;padding-bottom:env(safe-area-inset-bottom,8px)}
.nav-btn{flex:1;display:flex;flex-direction:column;align-items:center;gap:3px;padding:10px 4px 8px;cursor:pointer;border:none;background:transparent;color:${C.muted};font-family:inherit;font-size:10px;font-weight:500;transition:color .15s;position:relative}
.nav-btn.active{color:${C.accent}}
.nav-icon{font-size:20px;line-height:1}
.nav-badge{position:absolute;top:6px;right:calc(50% - 18px);background:${C.red};color:#fff;font-size:9px;font-weight:700;width:16px;height:16px;border-radius:50%;display:flex;align-items:center;justify-content:center}

.topbar{background:${C.card};border-bottom:1px solid ${C.border};padding:14px 16px 12px;display:flex;align-items:center;justify-content:space-between;position:sticky;top:0;z-index:50}
.topbar-title{font-size:17px;font-weight:700}
.topbar-sub{font-size:11px;color:${C.muted};margin-top:1px}
.revalidating-bar{height:2px;background:linear-gradient(90deg,transparent,${C.accent},transparent);animation:slide 1.2s linear infinite;position:fixed;top:0;left:0;width:100%;z-index:999;max-width:480px;left:50%;transform:translateX(-50%)}
@keyframes slide{0%{background-position:-200% 0}100%{background-position:200% 0}}

.icon-btn{width:38px;height:38px;border-radius:10px;background:${C.panel};border:1px solid ${C.border};color:${C.text};font-size:18px;display:flex;align-items:center;justify-content:center;cursor:pointer;transition:all .15s}
.icon-btn:active{transform:scale(.94)}
.icon-btn.spinning{animation:spin 1s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}

.page{padding:16px;padding-bottom:90px;min-height:100dvh}

.stat-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px}
.stat-card{background:${C.card};border:1px solid ${C.border};border-radius:14px;padding:14px;position:relative;overflow:hidden;transition:opacity .3s}
.stat-card.stale{opacity:.7}
.stat-card::after{content:attr(data-icon);position:absolute;right:10px;bottom:8px;font-size:28px;opacity:.12}
.stat-label{font-size:11px;color:${C.muted};font-weight:600;margin-bottom:6px}
.stat-value{font-size:28px;font-weight:700;line-height:1;font-variant-numeric:tabular-nums}
.sv-blue{color:${C.accent}}.sv-green{color:${C.green}}.sv-red{color:${C.red}}.sv-yellow{color:${C.yellow}}
.t-blue{border-top:2px solid ${C.accent}}.t-green{border-top:2px solid ${C.green}}.t-red{border-top:2px solid ${C.red}}.t-yellow{border-top:2px solid ${C.yellow}}

.card{background:${C.card};border:1px solid ${C.border};border-radius:14px;padding:14px;margin-bottom:12px}
.card-title{font-size:12px;font-weight:700;color:${C.muted};text-transform:uppercase;letter-spacing:.8px;margin-bottom:12px}

.user-row{display:flex;align-items:center;gap:12px;padding:12px 0;border-bottom:1px solid ${C.border}40}
.user-row:last-child{border-bottom:none}
.avatar{width:42px;height:42px;border-radius:50%;background:linear-gradient(135deg,${C.accent},${C.purple});display:flex;align-items:center;justify-content:center;font-size:15px;font-weight:700;color:#fff;flex-shrink:0}
.avatar.sm{width:34px;height:34px;font-size:12px}
.user-info{flex:1;min-width:0}
.user-name{font-size:14px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.user-meta{font-size:11px;color:${C.muted};margin-top:2px}

.pill{display:inline-flex;align-items:center;gap:3px;padding:3px 9px;border-radius:20px;font-size:11px;font-weight:700;white-space:nowrap;flex-shrink:0}
.p-active{background:#22c55e18;color:${C.green};border:1px solid #22c55e33}
.p-inactive{background:#ef444418;color:${C.red};border:1px solid #ef444433}
.p-pending{background:#f59e0b18;color:${C.yellow};border:1px solid #f59e0b33}

.btn{display:inline-flex;align-items:center;gap:5px;padding:8px 14px;border-radius:10px;font-size:12px;font-weight:600;font-family:inherit;cursor:pointer;border:none;transition:all .15s;white-space:nowrap}
.btn:active{transform:scale(.96)}.btn:disabled{opacity:.5;pointer-events:none}
.btn-p{background:${C.accent};color:#fff}
.btn-s{background:#22c55e20;color:${C.green};border:1px solid #22c55e40}
.btn-s:not(:disabled):hover{background:${C.green};color:#fff}
.btn-d{background:#ef444420;color:${C.red};border:1px solid #ef444440}
.btn-g{background:transparent;color:${C.muted};border:1px solid ${C.border}}
.btn-g:hover{background:${C.border};color:${C.text}}
.btn-block{width:100%;justify-content:center;padding:12px}

.input,.ta{background:${C.panel};border:1px solid ${C.border};border-radius:10px;padding:11px 13px;color:${C.text};font-family:inherit;font-size:14px;width:100%;outline:none;transition:border-color .2s;-webkit-appearance:none}
.input:focus,.ta:focus{border-color:${C.accent}}
.input::placeholder,.ta::placeholder{color:${C.muted}}
.ta{resize:vertical;min-height:90px}
.field{margin-bottom:12px}
.field label{display:block;font-size:11px;font-weight:700;color:${C.muted};letter-spacing:.8px;margin-bottom:6px}

.sw{position:relative;margin-bottom:12px}
.sw .si{position:absolute;left:12px;top:50%;transform:translateY(-50%);font-size:16px;pointer-events:none}
.sw .input{padding-left:38px}

.ftabs{display:flex;gap:6px;margin-bottom:14px;overflow-x:auto;padding-bottom:2px;scrollbar-width:none}
.ftabs::-webkit-scrollbar{display:none}
.ftab{flex-shrink:0;padding:7px 14px;border-radius:20px;font-size:12px;font-weight:600;cursor:pointer;border:1px solid ${C.border};background:transparent;color:${C.muted};font-family:inherit;transition:all .15s}
.ftab.active{background:${C.accent};color:#fff;border-color:${C.accent}}

.rc{background:${C.panel};border:1px solid ${C.border};border-radius:12px;padding:13px;margin-bottom:10px}
.r-issue{font-size:13px;color:${C.text};line-height:1.5;background:${C.card};border-radius:8px;padding:8px 10px;margin-top:8px;border-left:2px solid ${C.red}}
.r-meta{font-size:11px;color:${C.muted};margin-top:5px;display:flex;gap:8px;flex-wrap:wrap}

.overlay{position:fixed;inset:0;background:#00000094;z-index:200;display:flex;align-items:flex-end;animation:fi .2s}
.modal{background:${C.card};border:1px solid ${C.border};border-radius:24px 24px 0 0;padding:20px 20px 40px;width:100%;max-height:86dvh;overflow-y:auto;animation:su .25s ease}
.mhandle{width:36px;height:4px;background:${C.border};border-radius:4px;margin:0 auto 16px}
.mtitle{font-size:16px;font-weight:700;margin-bottom:16px;display:flex;align-items:center;gap:8px}

.skel{background:linear-gradient(90deg,${C.border},#1a2840,${C.border});background-size:200% 100%;animation:shim 1.4s infinite;border-radius:10px;height:70px;margin-bottom:10px}
.empty{text-align:center;padding:48px 24px;color:${C.muted}}
.ei{font-size:40px;margin-bottom:10px;opacity:.25}

.toasts{position:fixed;top:16px;left:50%;transform:translateX(-50%);width:calc(100% - 32px);max-width:440px;z-index:999;display:flex;flex-direction:column;gap:8px;pointer-events:none}
.toast{background:${C.card};border:1px solid ${C.border};border-radius:12px;padding:12px 14px;display:flex;gap:10px;align-items:flex-start;animation:ti .3s ease;box-shadow:0 8px 32px #00000080;pointer-events:all}
.toast.success{border-left:3px solid ${C.green}}.toast.error{border-left:3px solid ${C.red}}.toast.warn{border-left:3px solid ${C.yellow}}.toast.info{border-left:3px solid ${C.accent}}
.t-icon{font-size:18px}.t-body{flex:1}.t-title{font-size:13px;font-weight:700}.t-msg{font-size:12px;color:${C.muted};margin-top:2px}

.atabs{display:flex;background:${C.panel};border-radius:12px;padding:4px;margin-bottom:14px;gap:4px}
.atab{flex:1;text-align:center;padding:8px 4px;border-radius:9px;font-size:12px;font-weight:600;cursor:pointer;border:none;background:transparent;color:${C.muted};font-family:inherit;transition:all .2s}
.atab.active{background:${C.card};color:${C.text};box-shadow:0 2px 8px #00000040}

.srow{display:flex;align-items:center;justify-content:space-between;padding:10px 0;border-bottom:1px solid ${C.border}40;font-size:13px}
.srow:last-child{border-bottom:none}
.sbar{height:4px;border-radius:4px;background:${C.border};flex:1;margin:4px 8px 0 0;overflow:hidden}
.sbar-f{height:100%;border-radius:4px;transition:width .5s ease}

.bcard{background:linear-gradient(135deg,${C.card},#0a1830);border:1px solid ${C.accentGlow};border-radius:14px;padding:16px;margin-bottom:12px}
.slabel{font-size:11px;font-weight:700;color:${C.muted};letter-spacing:1.2px;text-transform:uppercase;margin:18px 0 10px}
.nrow{display:flex;gap:10px;align-items:flex-start;padding:11px 0;border-bottom:1px solid ${C.border}40}
.nrow:last-child{border-bottom:none}
.ndot{width:8px;height:8px;border-radius:50%;margin-top:5px;flex-shrink:0}
.ndot.n{background:${C.accent};box-shadow:0 0 6px ${C.accent}}
.ndot.o{background:${C.muted}}
.ncontent{flex:1}.ntitle{font-size:13px;font-weight:600}.nsub{font-size:12px;color:${C.muted};margin-top:2px}
.ntime{font-size:11px;color:${C.muted};white-space:nowrap}

/* step indicator */
.steps{display:flex;align-items:center;margin-bottom:20px;gap:0}
.step{flex:1;text-align:center;font-size:11px;font-weight:700;padding:7px 4px;border-radius:0;border-bottom:2px solid ${C.border};color:${C.muted};transition:all .2s}
.step.done{border-color:${C.green};color:${C.green}}
.step.active{border-color:${C.accent};color:${C.accent}}

@keyframes pulse{0%,100%{transform:scale(1)}50%{transform:scale(1.15)}}
@keyframes fi{from{opacity:0}to{opacity:1}}
@keyframes su{from{transform:translateY(40px);opacity:0}to{transform:translateY(0);opacity:1}}
@keyframes shim{0%{background-position:-200% 0}100%{background-position:200% 0}}
@keyframes ti{from{transform:translateY(-20px);opacity:0}to{transform:translateY(0);opacity:1}}
`;

/* ═════════════════════════════════════════
   DASHBOARD
═════════════════════════════════════════ */
function DashboardPage({ push, forceRefresh }) {
  const { data: dash, loading: l1 } = useSWR({ action: "getDashboard" }, forceRefresh);
  const { data: ud, loading: l2 } = useSWR({ action: "getUsers" }, forceRefresh);
  const [atab, setAtab] = useState("quiz");

  const loading = l1 || l2;
  const users = ud?.users || [];
  const total = users.length;
  const active = users.filter(u => (u.Status||u.status||"").toLowerCase()==="active").length;
  const pending = total - active;
  const reports = dash?.reports?.length || 0;

  const quizTotal = dash ? Object.values(dash.quiz||{}).reduce((s,v)=>s+v.total,0) : 0;
  const qbTotal   = dash ? Object.values(dash.qbank||{}).reduce((s,v)=>s+v.total,0) : 0;
  const stTotal   = dash ? Object.values(dash.study||{}).reduce((s,v)=>s+v.total,0) : 0;

  const Skel = () => (
    <div className="page">
      <div className="stat-grid">{[...Array(4)].map((_,i)=><div key={i} className="skel" style={{height:80,borderRadius:14}}/>)}</div>
      {[...Array(3)].map((_,i)=><div key={i} className="skel"/>)}
    </div>
  );

  if (loading && !dash) return <Skel/>;

  const quizEntries  = Object.entries(dash?.quiz  || {});
  const qbankEntries = Object.entries(dash?.qbank || {});
  const studyEntries = Object.entries(dash?.study || {});

  return (
    <div className="page">
      <div className="stat-grid">
        <div className="stat-card t-blue"  data-icon="👥"><div className="stat-label">মোট স্টুডেন্ট</div><div className="stat-value sv-blue">{fmt(total)}</div></div>
        <div className="stat-card t-green" data-icon="✅"><div className="stat-label">অ্যাক্টিভ</div><div className="stat-value sv-green">{fmt(active)}</div></div>
        <div className="stat-card t-yellow"data-icon="⏳"><div className="stat-label">পেন্ডিং</div><div className="stat-value sv-yellow">{fmt(pending)}</div></div>
        <div className="stat-card t-red"   data-icon="🚨"><div className="stat-label">রিপোর্ট</div><div className="stat-value sv-red">{fmt(reports)}</div></div>
      </div>
      <div className="stat-grid">
        <div className="stat-card t-blue"  data-icon="❓"><div className="stat-label">Quiz প্রশ্ন</div><div className="stat-value sv-blue">{fmt(quizTotal)}</div></div>
        <div className="stat-card t-green" data-icon="📚"><div className="stat-label">QBank প্রশ্ন</div><div className="stat-value sv-green">{fmt(qbTotal)}</div></div>
        <div className="stat-card t-yellow"data-icon="📖"><div className="stat-label">Study নোট</div><div className="stat-value sv-yellow">{fmt(stTotal)}</div></div>
        <div className="stat-card"         data-icon="📊"><div className="stat-label">মোট কন্টেন্ট</div><div className="stat-value sv-blue">{fmt(quizTotal+qbTotal+stTotal)}</div></div>
      </div>

      <div className="card">
        <div className="card-title">📊 বিষয়ভিত্তিক Analytics</div>
        <div className="atabs">
          {[["quiz",`❓ Quiz (${quizTotal})`],["qbank",`📚 QBank (${qbTotal})`],["study",`📖 Study (${stTotal})`]].map(([v,l])=>(
            <button key={v} className={`atab${atab===v?" active":""}`} onClick={()=>setAtab(v)}>{l}</button>
          ))}
        </div>
        {atab==="quiz" && (quizEntries.length===0
          ? <div style={{textAlign:"center",color:C.muted,padding:"16px 0",fontSize:13}}>ডেটা নেই</div>
          : quizEntries.map(([sub,v])=>(
            <div key={sub} className="srow">
              <div style={{flex:1}}>
                <div style={{fontWeight:600,fontSize:13}}>{sub}</div>
                <div style={{display:"flex",alignItems:"center",marginTop:4}}>
                  <div className="sbar"><div className="sbar-f" style={{width:Math.min(100,(v.total/Math.max(quizTotal,1))*100)+"%",background:C.accent}}/></div>
                </div>
                <div style={{fontSize:10,color:C.muted,marginTop:2}}>MCQ: {v.mcq} · Written: {v.written}</div>
              </div>
              <div style={{fontWeight:700,color:C.accent,fontSize:18,minWidth:36,textAlign:"right"}}>{v.total}</div>
            </div>
          ))
        )}
        {atab==="qbank" && (qbankEntries.length===0
          ? <div style={{textAlign:"center",color:C.muted,padding:"16px 0",fontSize:13}}>ডেটা নেই</div>
          : qbankEntries.map(([sub,v])=>(
            <div key={sub} className="srow">
              <div style={{flex:1}}>
                <div style={{fontWeight:600,fontSize:13}}>{sub}</div>
                <div style={{display:"flex",alignItems:"center",marginTop:4}}>
                  <div className="sbar"><div className="sbar-f" style={{width:Math.min(100,(v.total/Math.max(qbTotal,1))*100)+"%",background:C.green}}/></div>
                </div>
                <div style={{fontSize:10,color:C.muted,marginTop:2}}>MCQ: {v.mcq} · Written: {v.written}</div>
              </div>
              <div style={{fontWeight:700,color:C.green,fontSize:18,minWidth:36,textAlign:"right"}}>{v.total}</div>
            </div>
          ))
        )}
        {atab==="study" && (studyEntries.length===0
          ? <div style={{textAlign:"center",color:C.muted,padding:"16px 0",fontSize:13}}>ডেটা নেই</div>
          : studyEntries.map(([sub,v])=>(
            <div key={sub} className="srow">
              <div style={{flex:1}}>
                <div style={{fontWeight:600,fontSize:13}}>{sub}</div>
                <div style={{display:"flex",alignItems:"center",marginTop:4}}>
                  <div className="sbar"><div className="sbar-f" style={{width:Math.min(100,(v.total/Math.max(stTotal,1))*100)+"%",background:C.yellow}}/></div>
                </div>
              </div>
              <div style={{fontWeight:700,color:C.yellow,fontSize:18,minWidth:36,textAlign:"right"}}>{v.total}</div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

/* ═════════════════════════════════════════
   SIGNUPS
═════════════════════════════════════════ */
function SignupsPage({ push, forceRefresh }) {
  const { data: ud, loading } = useSWR({ action: "getUsers" }, forceRefresh);
  const [localRemoved, setLocalRemoved] = useState([]);
  const [activating, setActivating] = useState(null);

  const pending = (ud?.users || [])
    .filter(u => (u.Status||u.status||"").toLowerCase() !== "active")
    .filter(u => !localRemoved.includes(u.Phone||u.phone));

  const activate = async (u) => {
    const phone = u.Phone||u.phone||"";
    if (!phone) return;
    setActivating(phone);
    try {
      const r = await apiAction({ action:"activateUser", phone });
      if (r.result==="success") {
        push("success","✅ অ্যাক্টিভ হয়েছে!",u.Name||u.name||phone);
        setLocalRemoved(p=>[...p,phone]);
        cacheInvalidate("getUsers");
        fetchAndCache({ action:"getUsers" }, true);
      } else {
        push("error","ব্যর্থ",r.error||"Unknown");
      }
    } catch(e){ push("error","নেটওয়ার্ক সমস্যা",e.message); }
    setActivating(null);
  };

  return (
    <div className="page">
      <div style={{background:"#ef444412",border:"1px solid #ef444430",borderRadius:12,padding:"10px 14px",fontSize:13,color:C.red,fontWeight:600,marginBottom:14,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
        <span>🔔 {pending.length}টি পেন্ডিং</span>
        {loading && <span style={{fontSize:11,color:C.muted}}>⏳ আপডেট হচ্ছে...</span>}
      </div>
      {loading && !ud
        ? [...Array(4)].map((_,i)=><div key={i} className="skel"/>)
        : pending.length===0
          ? <div className="empty"><div className="ei">🎉</div><p>সব স্টুডেন্ট অ্যাক্টিভ!</p></div>
          : pending.map((u,i)=>{
            const name=u.Name||u.name||"অজানা";
            const phone=u.Phone||u.phone||"—";
            const busy=activating===phone;
            return (
              <div key={i} className="card" style={{padding:14}}>
                <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:12}}>
                  <div className="avatar">{initials(name)}</div>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontWeight:700,fontSize:15}}>{name}</div>
                    <div style={{fontSize:12,color:C.muted,marginTop:2}}>📱 {phone}</div>
                    {(u.Email||u.email)&&<div style={{fontSize:12,color:C.muted}}>✉️ {u.Email||u.email}</div>}
                    <div style={{fontSize:11,color:C.muted,marginTop:2}}>🕐 {timeAgo(u.Timestamp||u.timestamp)}</div>
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

/* ═════════════════════════════════════════
   STUDENTS
═════════════════════════════════════════ */
function StudentsPage({ push, forceRefresh }) {
  const { data: ud, loading } = useSWR({ action:"getUsers" }, forceRefresh);
  const [overrides, setOverrides] = useState({}); // phone → status override
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState("all");
  const [notify, setNotify] = useState(null);
  const [activating, setActivating] = useState(null);

  const users = (ud?.users||[]).map(u => {
    const ph=u.Phone||u.phone||"";
    return overrides[ph] ? {...u,Status:overrides[ph],status:overrides[ph]} : u;
  });

  const filtered = users.filter(u=>{
    const nm=(u.Name||u.name||"").toLowerCase();
    const ph=(u.Phone||u.phone||"").toLowerCase();
    const st=(u.Status||u.status||"").toLowerCase();
    const q=search.toLowerCase();
    return(!q||nm.includes(q)||ph.includes(q))&&(tab==="all"||st===tab);
  });

  const activate = async (u) => {
    const phone=u.Phone||u.phone||"";
    if(!phone) return;
    setActivating(phone);
    try {
      const r=await apiAction({action:"activateUser",phone});
      if(r.result==="success"){
        push("success","✅ অ্যাক্টিভ!",u.Name||u.name);
        setOverrides(p=>({...p,[phone]:"Active"}));
        cacheInvalidate("getUsers");
        fetchAndCache({action:"getUsers"},true);
      } else push("error","ব্যর্থ",r.error);
    } catch(e){push("error","সমস্যা",e.message);}
    setActivating(null);
  };

  return (
    <div className="page">
      <div className="sw"><span className="si">🔍</span><input className="input" placeholder="নাম বা ফোন..." value={search} onChange={e=>setSearch(e.target.value)}/></div>
      <div className="ftabs">
        {[["all","সবাই"],["active","✅ অ্যাক্টিভ"],["inactive","🔴 ইনঅ্যাক্টিভ"]].map(([v,l])=>(
          <button key={v} className={`ftab${tab===v?" active":""}`} onClick={()=>setTab(v)}>{l}</button>
        ))}
      </div>
      <div style={{fontSize:12,color:C.muted,marginBottom:10}}>{filtered.length} জন</div>
      {loading&&!ud ? [...Array(5)].map((_,i)=><div key={i} className="skel"/>) :
       filtered.length===0 ? <div className="empty"><div className="ei">👤</div><p>কেউ নেই</p></div> :
       filtered.map((u,i)=>{
        const nm=u.Name||u.name||"অজানা";
        const ph=u.Phone||u.phone||"—";
        const st=(u.Status||u.status||"inactive").toLowerCase();
        const busy=activating===ph;
        return (
          <div key={i} className="card" style={{padding:13}}>
            <div className="user-row" style={{paddingBottom:10}}>
              <div className="avatar">{initials(nm)}</div>
              <div className="user-info"><div className="user-name">{nm}</div><div className="user-meta">📱 {ph}</div></div>
              <span className={`pill p-${st==="active"?"active":"inactive"}`}>{st==="active"?"✅ অ্যাক্টিভ":"🔴 ইনঅ্যাক্টিভ"}</span>
            </div>
            <div style={{display:"flex",gap:8,marginBottom:10}}>
              {[["✅",C.green,u._totalCorrect||0,"সঠিক"],["❌",C.red,u._totalWrong||0,"ভুল"],["⏱",C.accent,u._totalMinutes||0,"মিনিট"],["📅",C.muted,timeAgo(u._lastActive||u.Timestamp),"শেষ"]].map(([ic,cl,val,lb])=>(
                <div key={lb} style={{textAlign:"center",flex:1,background:C.panel,borderRadius:8,padding:"7px 2px"}}>
                  <div style={{color:cl,fontWeight:700,fontSize:val.toString().length>5?10:14}}>{val}</div>
                  <div style={{color:C.muted,fontSize:10}}>{lb}</div>
                </div>
              ))}
            </div>
            <div style={{display:"flex",gap:8}}>
              {st!=="active"&&<button className="btn btn-s" style={{flex:1,justifyContent:"center"}} disabled={!!activating} onClick={()=>activate(u)}>{busy?"⏳":"✅ অ্যাক্টিভ"}</button>}
              <button className="btn btn-g" style={{flex:1,justifyContent:"center"}} onClick={()=>setNotify(u)}>📣 নোটিফাই</button>
            </div>
          </div>
        );
       })
      }
      {notify&&<NotifyModal user={notify} onClose={()=>setNotify(null)} push={push}/>}
    </div>
  );
}

/* ═════════════════════════════════════════
   REPORTS — edit first, then notify
═════════════════════════════════════════ */
function ReportsPage({ push, forceRefresh }) {
  const { data: dash, loading } = useSWR({ action:"getDashboard" }, forceRefresh);
  const [localDone, setLocalDone] = useState([]);
  const [editing, setEditing] = useState(null);

  const reports = (dash?.reports||[]).filter(r=>!localDone.includes(r.row));

  return (
    <div className="page">
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:14}}>
        <div style={{fontSize:13,color:C.muted}}>{reports.length}টি রিপোর্ট পেন্ডিং</div>
        {loading&&<span style={{fontSize:11,color:C.muted}}>⏳ আপডেট হচ্ছে...</span>}
      </div>
      {loading&&!dash ? [...Array(4)].map((_,i)=><div key={i} className="skel"/>) :
       reports.length===0 ? <div className="empty"><div className="ei">📋</div><p>কোনো রিপোর্ট নেই! 🎉</p></div> :
       reports.map((r,i)=>(
        <div key={i} className="rc">
          <div style={{fontWeight:700,fontSize:14}}>{r.subject||"অজানা বিষয়"}</div>
          <div className="r-meta">
            <span>📱 {r.phone||"—"}</span>
            {r.subtopic&&<span>📌 {r.subtopic}</span>}
            {r.questionId&&<span style={{color:C.accent}}>#{r.questionId}</span>}
            <span>{timeAgo(r.time)}</span>
          </div>
          <div className="r-issue">{r.issue||r.question||"বিস্তারিত নেই"}</div>
          {r.question&&r.question!==r.issue&&(
            <div style={{fontSize:12,color:C.muted,marginTop:6,paddingLeft:8,lineHeight:1.5}}>
              ❓ {r.question.slice(0,120)}{r.question.length>120?"…":""}
            </div>
          )}
          <button className="btn btn-p btn-block" style={{marginTop:10}} onClick={()=>setEditing(r)}>
            ✏️ প্রশ্ন এডিট করুন ও সমাধান দিন
          </button>
        </div>
       ))
      }
      {editing&&(
        <EditResolveModal
          report={editing}
          onClose={()=>setEditing(null)}
          onDone={row=>{
            setLocalDone(p=>[...p,row]);
            setEditing(null);
            cacheInvalidate("getDashboard");
            fetchAndCache({action:"getDashboard"},true);
          }}
          push={push}
        />
      )}
    </div>
  );
}

/* ─── Edit → Resolve Modal (2 steps) ─── */
function EditResolveModal({ report, onClose, onDone, push }) {
  const [step, setStep] = useState(1); // 1=edit, 2=notify
  const [qdata, setQdata] = useState(null);
  const [loadingQ, setLoadingQ] = useState(true);
  const [explanation, setExplanation] = useState("");
  const [saving, setSaving] = useState(false);
  const [notifying, setNotifying] = useState(false);

  // প্রশ্ন load করো
  useEffect(()=>{
    (async()=>{
      setLoadingQ(true);
      if(report.questionId){
        for(const tab of ["Quiz","QBank"]){
          try{
            const d=await fetch(GAS_URL+"?"+new URLSearchParams({id:report.questionId,tab}).toString()).then(r=>r.json());
            if(d.status==="success"){
              setQdata({...d.data,_tab:tab});
              setExplanation(d.data.Explanation||d.data.explanation||"");
              break;
            }
          }catch(_){}
        }
      }
      setLoadingQ(false);
    })();
  },[report.questionId]);

  const save = async()=>{
    setSaving(true);
    try{
      if(qdata && report.questionId && explanation){
        await apiAction({
          action:"updateField",
          sheet:qdata._tab||"Quiz",
          id:report.questionId,
          field:"explanation",
          content:encodeURIComponent(explanation),
        });
      }
      setStep(2);
    }catch(e){push("error","Save ব্যর্থ",e.message);}
    setSaving(false);
  };

  const notify=async()=>{
    setNotifying(true);
    try{
      await apiAction({
        action:"resolveReport",
        phone:report.phone,
        subject:encodeURIComponent(report.subject||"প্রশ্নটি"),
        questionId:report.questionId||"",
      });
      push("success","✅ সমাধান ও নোটিফাই হয়েছে!",`${report.phone} কে জানানো হয়েছে`);
      onDone(report.row);
    }catch(e){push("error","Notify ব্যর্থ",e.message);}
    setNotifying(false);
  };

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={e=>e.stopPropagation()}>
        <div className="mhandle"/>
        {/* Step bar */}
        <div className="steps">
          <div className={`step${step===1?" active":step>1?" done":""}`}>① প্রশ্ন এডিট</div>
          <div className={`step${step===2?" active":""}`}>② নোটিফাই</div>
        </div>

        {step===1&&(
          <>
            <div className="mtitle">✏️ প্রশ্ন এডিট করুন</div>
            {/* Report context */}
            <div style={{background:C.panel,borderRadius:10,padding:"10px 12px",marginBottom:14}}>
              <div style={{fontSize:12,color:C.muted,marginBottom:4}}>📱 {report.phone} · {report.subject}</div>
              <div className="r-issue" style={{marginTop:0}}>{report.issue||"—"}</div>
            </div>
            {loadingQ
              ? <div className="skel" style={{height:100}}/>
              : qdata
                ? <>
                    {(qdata.Question||qdata.question)&&(
                      <div style={{background:C.panel,borderRadius:10,padding:"10px 12px",marginBottom:12,fontSize:13,lineHeight:1.6}}>
                        <div style={{fontSize:11,color:C.muted,marginBottom:4}}>প্রশ্ন #{report.questionId}</div>
                        {qdata.Question||qdata.question}
                      </div>
                    )}
                    {(qdata.Correct||qdata.correct)&&(
                      <div style={{fontSize:12,background:"#22c55e18",color:C.green,borderRadius:8,padding:"8px 10px",marginBottom:12}}>
                        ✅ সঠিক উত্তর: {qdata.Correct||qdata.correct}
                      </div>
                    )}
                    <div className="field">
                      <label>ব্যাখ্যা (Explanation) আপডেট করুন</label>
                      <textarea className="ta" value={explanation} onChange={e=>setExplanation(e.target.value)} style={{minHeight:130}} placeholder="সঠিক ব্যাখ্যা লিখুন..."/>
                    </div>
                  </>
                : <div style={{textAlign:"center",color:C.muted,padding:"20px 0",fontSize:13}}>
                    প্রশ্ন ID #{report.questionId||"—"} খুঁজে পাওয়া যায়নি।<br/>
                    <span style={{fontSize:11}}>সরাসরি Sheet-এ দেখুন।</span>
                  </div>
            }
            <div style={{display:"flex",gap:8}}>
              <button className="btn btn-g" style={{flex:1,justifyContent:"center"}} onClick={onClose}>বাতিল</button>
              <button className="btn btn-p" style={{flex:2,justifyContent:"center"}} disabled={saving} onClick={save}>
                {saving?"⏳ সেভ হচ্ছে...":"💾 সেভ করুন →"}
              </button>
            </div>
          </>
        )}

        {step===2&&(
          <>
            <div className="mtitle">📣 স্টুডেন্টকে নোটিফাই করুন</div>
            <div style={{background:"#22c55e12",border:"1px solid #22c55e30",borderRadius:12,padding:"14px",marginBottom:16}}>
              <div style={{fontSize:14,fontWeight:700,color:C.green,marginBottom:6}}>✅ এডিট সম্পন্ন!</div>
              <div style={{fontSize:12,color:C.muted}}>স্টুডেন্টকে জানানো হবে যে তাদের রিপোর্ট সমাধান হয়েছে।</div>
            </div>
            <div style={{background:C.panel,borderRadius:10,padding:"12px 14px",marginBottom:16}}>
              <div style={{fontSize:12,color:C.muted,marginBottom:4}}>নোটিফিকেশন পাবেন:</div>
              <div style={{fontSize:14,fontWeight:700}}>📱 {report.phone}</div>
              <div style={{fontSize:12,color:C.muted,marginTop:4}}>বিষয়: {report.subject||"প্রশ্নটি"}</div>
              <div style={{fontSize:12,color:C.accent,marginTop:6,lineHeight:1.5}}>
                "✅ আপনার রিপোর্ট সমাধান হয়েছে! '{report.subject||"প্রশ্নটি"}' সংশোধন করা হয়েছে।"
              </div>
            </div>
            <div style={{display:"flex",gap:8}}>
              <button className="btn btn-g" style={{flex:1,justifyContent:"center"}} onClick={()=>onDone(report.row)}>এড়িয়ে যান</button>
              <button className="btn btn-s" style={{flex:2,justifyContent:"center"}} disabled={notifying} onClick={notify}>
                {notifying?"⏳ পাঠানো হচ্ছে...":"✅ নোটিফাই করুন"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/* ═════════════════════════════════════════
   NOTIFICATIONS
═════════════════════════════════════════ */
function NotificationsPage({ push }) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [hist, setHist] = useState([
    {title:"নতুন কুইজ যোগ!",body:"Physics থেকে নতুন প্রশ্ন যোগ হয়েছে",time:"আগে"},
  ]);

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

  return (
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
            <div className="ncontent"><div className="ntitle">{h.title}</div><div className="nsub">{h.body.slice(0,60)}</div></div>
            <div className="ntime">{h.time}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─── Notify Modal ─── */
function NotifyModal({ user, onClose, push }) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const nm=user.Name||user.name||"স্টুডেন্ট";

  const send=async()=>{
    if(!title||!body) return;
    setSending(true);
    try{
      await apiAction({action:"broadcastNotification",title:encodeURIComponent(title),body:encodeURIComponent(body)});
      push("success","পাঠানো হয়েছে",`${nm} কে নোটিফাই করা হয়েছে`);
      onClose();
    }catch(e){push("error","ব্যর্থ",e.message);}
    setSending(false);
  };

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={e=>e.stopPropagation()}>
        <div className="mhandle"/>
        <div className="mtitle">📣 {nm}</div>
        <div style={{fontSize:12,color:C.muted,marginBottom:14}}>📱 {user.Phone||user.phone}</div>
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

/* ═════════════════════════════════════════
   ROOT APP
   — সব page সবসময় mount থাকে (display:none)
   — তাই nav change এ re-render/re-fetch হয় না
═════════════════════════════════════════ */
const NAV = [
  {id:"dashboard",icon:"📊",label:"ড্যাশবোর্ড"},
  {id:"signups",  icon:"🆕",label:"সাইনআপ",   badge:true},
  {id:"students", icon:"👥",label:"স্টুডেন্ট"},
  {id:"reports",  icon:"🚨",label:"রিপোর্ট",  badge:true},
  {id:"notifs",   icon:"📣",label:"নোটিফাই"},
];

export default function App() {
  const [page, setPage] = useState("dashboard");
  const [toasts, push] = useToasts();
  const [refreshTick, setRefreshTick] = useState(0);
  const [spin, setSpin] = useState(false);
  // track whether any SWR is currently revalidating
  const [reval, setReval] = useState(false);

  const doRefresh = () => {
    setSpin(true);
    cacheInvalidate("getDashboard","getUsers");
    setRefreshTick(t=>t+1);
    setTimeout(()=>setSpin(false),1500);
  };

  // Periodic background revalidation every 60s
  useEffect(()=>{
    const id = setInterval(()=>{
      setRefreshTick(t=>t+1);
    }, 60_000);
    return ()=>clearInterval(id);
  },[]);

  return (
    <>
      <style>{css}</style>

      <div className="topbar">
        <div>
          <div className="topbar-title">{NAV.find(n=>n.id===page)?.icon} {NAV.find(n=>n.id===page)?.label}</div>
          <div className="topbar-sub">Smart Study Admin</div>
        </div>
        <button className={`icon-btn${spin?" spinning":""}`} onClick={doRefresh}>🔄</button>
      </div>

      {/* সব page mount, শুধু active টা visible */}
      <div style={{display:page==="dashboard"?"block":"none"}}><DashboardPage push={push} forceRefresh={refreshTick}/></div>
      <div style={{display:page==="signups"  ?"block":"none"}}><SignupsPage   push={push} forceRefresh={refreshTick}/></div>
      <div style={{display:page==="students" ?"block":"none"}}><StudentsPage  push={push} forceRefresh={refreshTick}/></div>
      <div style={{display:page==="reports"  ?"block":"none"}}><ReportsPage   push={push} forceRefresh={refreshTick}/></div>
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
