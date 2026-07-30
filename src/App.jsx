/* ══════════════════════════════════════════════════════════════════
   SMART STUDY ADMIN — App Shell
   (আগে এই ফাইলটাই ~৭৭০০ লাইনের একটা monolith ছিল — সব ফিচার এখন
   src/core, src/hooks, src/components, src/pages, src/pages/content
   এ ভাগ করা হয়েছে। এখানে শুধু: routing shell, top-bar, bottom-nav,
   back-button/exit-confirm লজিক, badge counts, push-notification wiring.)
   ══════════════════════════════════════════════════════════════════ */
import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";

import { C } from "./core/config.js";
import { _LC } from "./core/logger.js";
import { refreshTokenIfNeeded, clearIdToken } from "./core/auth.js";
import { ErrorBoundary } from "./core/ErrorBoundary.jsx";
import { fbGet, fbSet, _saveAdminFcmToken } from "./core/firebase.js";
import { useFB, invalidateAll } from "./core/dataCache.js";
import { toArr, nowTs } from "./core/utils.js";
import { NAV } from "./core/nav.js";
import { css } from "./styles/css.js";

import { useToasts } from "./hooks/useToasts.js";

import { Toasts } from "./components/shared/Toasts.jsx";
import { BgTaskIndicator } from "./components/shared/BgTaskIndicator.jsx";
import { LauncherGrid } from "./components/shared/LauncherGrid.jsx";

import { LoginScreen } from "./pages/LoginScreen.jsx";
import { StudentDetail } from "./pages/StudentDetail.jsx";
import { DashboardPage } from "./pages/DashboardPage.jsx";
import { StudentsPage } from "./pages/StudentsPage.jsx";
import { ContentManagerPage } from "./pages/ContentManagerPage.jsx";
import { NotifyPage } from "./pages/NotifyPage.jsx";
import { ReportsPage } from "./pages/ReportsPage.jsx";
import { TechniquesPage } from "./pages/TechniquesPage.jsx";
import { BulkUploaderPage } from "./pages/BulkUploaderPage.jsx";
import { JobLauncherTab } from "./pages/content/JobLauncherTab.jsx";
import { QBankConverterTab } from "./pages/content/QBankConverterTab.jsx";
import { QuestionGenTab } from "./pages/content/QuestionGenTab.jsx";
import { AIImportPage } from "./pages/AIImportPage.jsx";
import { MultiSubjectImportPage } from "./pages/MultiSubjectImportPage.jsx";
import { ArchivePage } from "./pages/ArchivePage.jsx";
import { TypingUploaderPage } from "./pages/TypingUploaderPage.jsx";
import { SingleQuestionEntryPage } from "./pages/SingleQuestionEntryPage.jsx";

/* Uploader hub-এর সেকশন/টুল গঠন — module-level রাখা হলো যাতে রেন্ডারে প্রতিবার নতুন array
   তৈরি না হয়। প্রতিটা সেকশনের রঙ Phase ১-এর সিমান্টিক টোকেন থেকে (C.info=টেক্সট, C.ai=AI
   জেনারেশন, C.ocr=স্ক্যান) — এলোমেলো ইনডেক্স-ভিত্তিক রঙ না। */
const UPLOADER_SECTIONS=[
  {key:"text",title:"📝 টেক্সট আপলোড",color:C.info,items:[
    {page:"bulkupload",  icon:"📝",label:"Bulk Upload",   desc:"একসাথে অনেক প্রশ্ন পেস্ট করে আপলোড"},
    {page:"singleentry", icon:"✍️",label:"Single প্রশ্ন",  desc:"একটি একটি করে সরাসরি এন্ট্রি"},
    {page:"typing",      icon:"⌨️",label:"Typing মোড",    desc:"টাইপ করে দ্রুত এন্ট্রি"},
  ]},
  {key:"aijob",title:"🚀 AI জব",color:C.ai,items:[
    {page:"joblauncher", icon:"🚀",label:"Exp Gen",       desc:"ব্যাখ্যা তৈরির জব চালু করুন"},
    {page:"qbankconv",   icon:"🔁",label:"QBank→Quiz",    desc:"প্রশ্ন ব্যাংক থেকে কুইজ বানান"},
    {page:"questiongen", icon:"🧬",label:"AI প্রশ্ন",      desc:"টপিক দিয়ে প্রশ্ন জেনারেট"},
  ]},
  {key:"ocr",title:"📸 OCR আপলোড",color:C.ocr,items:[
    {page:"aiimport",    icon:"📸",label:"Single Subject", desc:"এক বিষয়ের ছবি স্ক্যান"},
    {page:"multiimport", icon:"🗂️",label:"Multi-Subject",  desc:"একসাথে একাধিক বিষয় স্ক্যান"},
  ]},
  {key:"archive",title:"🗄️ আর্কাইভ",color:"#a78bfa",items:[
    {page:"archive", icon:"🗄️",label:"Archive", desc:"সংরক্ষিত পুরনো কন্টেন্ট দেখুন"},
  ]},
];
const UPLOADER_LEAF_PAGES=UPLOADER_SECTIONS.flatMap(s=>s.items.map(it=>it.page));

export default function App(){
  /* ⚠️ ব্যাক-বাটন আর্কিটেকচার নোট (এখানে আগে যা ছিল):
     আগে এখানে একটা আলাদা effect ছিল যেটা নিজের মতো "modal-open"/"modal-close" গুনে
     (_depth কাউন্টার) androidBackButton ইভেন্টে "back-press" ডিসপ্যাচ করত — ঠিক নিচের
     handleBack effect-ও (modalOpen.current ref দিয়ে) হুবহু একই কাজ করে। ফলে একটাই
     হার্ডওয়্যার ব্যাক-প্রেসে "back-press" কাস্টম ইভেন্ট দুইবার ডিসপ্যাচ হতো — এটাই
     ছিল ব্যাক-বাটনের অসঙ্গতিপূর্ণ (inconsistent) আচরণের মূল কারণ। এখন নিচের একটাই
     handleBack effect পুরো priority chain-এর (modal → sub-layer → uploader-leaf →
     page-back → exit-confirm) একমাত্র মালিক — single source of truth। */

  const[loggedIn,setLoggedIn]=useState(()=>{
    // ⚡ ফিক্স: আগে এখানে সবসময় false দিয়ে শুরু হতো — মানে অ্যাপ ব্যাকগ্রাউন্ডে গিয়ে Android
    //    প্রসেস/WebView রিস্টার্ট করলেই (যা কম RAM ফোনে ১ মিনিট পরেও হতে পারে) React state
    //    পুরো হারিয়ে যেতো, আর সাথে সাথে লগইন স্ক্রিন ফ্ল্যাশ করতো — ব্যবহারকারীর কাছে মনে হতো
    //    "লগআউট হয়ে গেছে"। এখন সেভ করা ইমেইল/পাসওয়ার্ড থাকলে optimistic-ভাবে সাথে সাথেই
    //    লগইন ধরে নেওয়া হয় (নিচের effect ব্যাকগ্রাউন্ডে token refresh/re-login করে; সেটা
    //    সত্যিই ব্যর্থ হলে তখনই আসল লগআউট হবে) — ফলে আর ফ্ল্যাশ হবে না।
    const savedEmail=localStorage.getItem("fb_email");
    const savedPass=localStorage.getItem("fb_pass_enc");
    return !!(savedEmail&&savedPass);
  });

  // ⚡ Optimistic লগইনের পর ব্যাকগ্রাউন্ডে token সচল আছে কিনা যাচাই — সত্যিই ব্যর্থ হলেই
  //    (refresh token + সেভ করা পাসওয়ার্ড দিয়ে re-login দুটোই ব্যর্থ) লগআউট দেখানো হয়।
  useEffect(()=>{
    if(!loggedIn) return;
    let cancelled=false;
    refreshTokenIfNeeded().then(t=>{
      if(cancelled) return;
      if(!t){
        _LC.warn("autoLogin","Background token refresh failed on resume — logging out");
        localStorage.removeItem("fb_email");localStorage.removeItem("fb_pass_enc");localStorage.removeItem("fb_refresh_token");
        window.__adminIdToken=null;
        setLoggedIn(false);
      }
    });
    return ()=>{ cancelled=true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[]);
  const[page,setPage]=useState("dashboard");
  const[toasts,push]=useToasts();
  const[tick,setTick]=useState(0);
  const[spin,setSpin]=useState(false);
  const[bulkPrefill,setBulkPrefill]=useState(null);
  const[searchDetail,setSearchDetail]=useState(null);
  const backStack=useRef(["dashboard"]);
  const modalOpen=useRef(false);

  // Badge counts — must be here (Rules of Hooks: no hooks after early return)
  const{data:usersRawBadge}=useFB("Users",tick);
  const{data:reportsRawBadge}=useFB("Reports",tick);
  const{data:techRawBadge}=useFB("Techniques",tick);

  // ALL hooks must be called unconditionally (Rules of Hooks)
  const goPage=useCallback((p)=>{
    _LC.lifecycle("navigate", `Page → ${p}`);
    setPage(prev=>{
      if(prev!==p){ backStack.current=[...backStack.current.filter(x=>x!==p),p]; }
      return p;
    });
  },[]);

  // ── FCM Notification click → page navigate (deeplink) ──
  useEffect(()=>{
    const onNavTo = (e) => {
      try {
        const data = typeof e.detail === "string" ? JSON.parse(e.detail) : e.detail;
        const pg = data?.page || "";
        if(!pg || !loggedIn) return;
        if(pg === "reports")    { goPage("reports");    }
        if(pg === "techniques") { goPage("techniques"); }
        _LC.info("FCM","📲 Deeplink nav to: " + pg);
      } catch(_) {}
    };
    window.addEventListener("adminNavTo", onNavTo);
    return () => window.removeEventListener("adminNavTo", onNavTo);
  }, [loggedIn, goPage]);

  // ══════════════════════════════════════════════════════════
  //  LAYERED BACK STACK
  //  প্রতিটা layer push/pop হয়। back চাপলে top layer pop হয়।
  //  Layer types: modal | sublayer | page | exit-confirm
  // ══════════════════════════════════════════════════════════
  const layerStack = useRef([]); // [{type, pop}]
  const[exitConfirm,setExitConfirm]=useState(false);
  const exitTimer=useRef(null);

  // Layer push — যেকোনো component call করবে
  const pushLayer = useCallback((popFn)=>{
    const id = Date.now() + Math.random();
    layerStack.current = [...layerStack.current, {id, pop: popFn}];
    return ()=>{
      layerStack.current = layerStack.current.filter(l=>l.id!==id);
    };
  },[]);

  // Global modal-open/close events → layer stack এ যাবে
  useEffect(()=>{
    if(!loggedIn) return;
    // modal-open event এ layer push (useModalBack থেকে আসে)
    const onModalOpen = (e)=>{
      // back-press event dispatch হলে top modal close হবে
      modalOpen.current = true;
    };
    const onModalClose=()=>{ modalOpen.current=false; };
    window.addEventListener("modal-open",  onModalOpen);
    window.addEventListener("modal-close", onModalClose);
    return()=>{
      window.removeEventListener("modal-open",  onModalOpen);
      window.removeEventListener("modal-close", onModalClose);
    };
  },[loggedIn]);

  useEffect(()=>{
    if(!loggedIn) return;
    const handleBack=(e)=>{
      if(e&&e.preventDefault) e.preventDefault();

      // 1. SearchDetail (Student profile from search)
      if(searchDetail){ setSearchDetail(null); return; }

      // 2. Modal খোলা → modal close
      if(modalOpen.current){
        window.dispatchEvent(new Event("back-press"));
        return;
      }

      // 3. Sub-layer stack এ কিছু আছে → pop
      if(layerStack.current.length>0){
        const top=layerStack.current[layerStack.current.length-1];
        layerStack.current=layerStack.current.slice(0,-1);
        try{ top.pop(); } catch(_){}
        return;
      }

      // 3.5 Uploader hub-এর কোনো টুল (leaf page, যেমন Bulk Upload/OCR/AI Job) খোলা থাকলে সিস্টেম-ব্যাক
      //     চাপলে আগে লঞ্চার-গ্রিডে (uploaderhub) ফিরে আসবে, সরাসরি dashboard/আগের পেজে চলে যাবে না —
      //     ঠিক topbar-এর ← বাটনের মতোই আচরণ, শুধু hardware back button থেকে ট্রিগার হচ্ছে
      if(UPLOADER_LEAF_PAGES.includes(page)){ goPage("uploaderhub"); return; }

      // 4. Page back
      if(page!=="dashboard"){
        const stack=backStack.current;
        if(stack.length>1){
          const ns=stack.slice(0,-1);
          backStack.current=ns;
          setPage(ns[ns.length-1]);
        } else {
          setPage("dashboard");
          backStack.current=["dashboard"];
        }
        return;
      }

      // 5. Dashboard এ → exit confirm (2 সেকেন্ড)
      if(exitConfirm){
        clearTimeout(exitTimer.current);
        setExitConfirm(false);
        if(window.Capacitor?.Plugins?.App) window.Capacitor.Plugins.App.exitApp();
        else window.close();
        return;
      }
      setExitConfirm(true);
      exitTimer.current=setTimeout(()=>setExitConfirm(false),2000);
    };

    // Capacitor back button + browser popstate
    document.addEventListener("backbutton",handleBack,false);
    window.addEventListener("androidBackButton",handleBack);
    return()=>{
      document.removeEventListener("backbutton",handleBack,false);
      window.removeEventListener("androidBackButton",handleBack);
      clearTimeout(exitTimer.current);
    };
  },[loggedIn,page,searchDetail,exitConfirm,goPage]);

  const refresh=useCallback(()=>{
    setSpin(true);invalidateAll();setTick(t=>t+1);
    setTimeout(()=>setSpin(false),1400);
  },[]);

  useEffect(()=>{
    if(!loggedIn) return;
    const id=setInterval(()=>setTick(t=>t+1),120_000);
    return()=>clearInterval(id);
  },[loggedIn]);

  /* ── নতুন Report detect করে নাম-সহ clickable notification দেখাও ── */
  const seenReportKeys=useRef(new Set());
  const[reportAlert,setReportAlert]=useState(null); // {items:[{key,name,subject}]}
  const[reportDeepLinkKey,setReportDeepLinkKey]=useState(null); // notification/banner ট্যাপ করলে ঠিক এই রিপোর্টটাই খুলে যাবে
  useEffect(()=>{
    if(!loggedIn)return;
    // প্রতি ৩০ সেকেন্ডে Reports চেক করো
    const checkReports=async()=>{
      try{
        const raw=await fbGet("Reports");
        if(!raw||typeof raw!=="object")return;
        const entries=Object.entries(raw);
        const newEntries=entries.filter(([k])=>!seenReportKeys.current.has(k));
        if(newEntries.length>0&&seenReportKeys.current.size>0){
          // প্রথমবার load হলে শুধু mark করো, notification দেখাবো না
          // ── প্রতিটা নতুন রিপোর্টের reporter-এর নাম Users থেকে (Phone মিলিয়ে) বের করি ──
          let usersArr=[];
          try{ usersArr=toArr(await fbGet("Users")); }catch(_){}
          const items=newEntries.map(([k,r])=>{
            const phone=(r.Phone||r.phone||"").toString().replace(/^'+/,"").trim();
            const u=usersArr.find(x=>(x.Phone||x.phone||"").toString().replace(/^'+/,"").trim()===phone);
            const name=(u?.Name||u?.name||"").toString()||"অজানা ইউজার";
            return{key:k,name,subject:(r.Subject||r.subject||"").toString()};
          });
          setReportAlert({items});
        }
        entries.forEach(([k])=>seenReportKeys.current.add(k));
      }catch(_){}
    };
    checkReports(); // initial load
    const id=setInterval(checkReports,30_000);
    return()=>clearInterval(id);
  },[loggedIn]);

  useEffect(()=>{
    if(!loggedIn) return;
    const cap=window.Capacitor;
    if(!cap?.Plugins?.PushNotifications) return;

    const PN=cap.Plugins.PushNotifications;

    // ── Permission চাও ──
    PN.requestPermissions().then(result=>{
      if(result.receive==="granted"){
        PN.register();
      }
    }).catch(()=>{});

    // ── Token পেলে Firebase AdminAppFCM-এ save করো ──
    PN.addListener("registration", async(tokenData)=>{
      try{
        const token=tokenData?.value||tokenData?.token||"";
        if(!token||token.length<10) return;
        // token-এর hash key হিসেবে শেষ ১৬ char ব্যবহার করো
        const key="admin_"+token.slice(-16).replace(/[^a-zA-Z0-9]/g,"_");
        await fbSet(`AdminAppFCM/${key}`,{token,savedAt:nowTs(),app:"admin"});
        console.log("✅ Admin FCM token saved:",key);
        _LC.info("FCM", `FCM token saved: ${key}`);
      }catch(e){ console.warn("FCM token save error",e); _LC.error("FCM",`FCM token save error: ${e?.message}`,{key}); }
    });

    // ── Notification tap হলে সঠিক page-এ যাও (নির্দিষ্ট report হলে সেটাও deep-link করে খুলে যাবে) ──
    const handler=(event)=>{
      try{
        const data=event?.notification?.data||event?.data||{};
        const url=data.url||data.url_key||"";
        const pageMap={
          reports:"reports",techniques:"techniques",
          students:"students",dashboard:"dashboard",
          notify:"notify",content:"content",uploader:"bulkupload",
          new_report:"reports", // type দিয়েও navigate
        };
        const target=pageMap[url]||pageMap[data.type]||null;
        if(data.reportKey){ setReportDeepLinkKey(data.reportKey); }
        if(target) goPage(target);
      } catch(e){ console.warn("Push nav error",e); _LC.error("pushNav",`Push notification nav error: ${e?.message}`); }
    };
    PN.addListener("pushNotificationActionPerformed", handler);

    return()=>{ try{ PN.removeAllListeners(); }catch(e){} };
  },[loggedIn,goPage]);

  // ── Badge counts & derived values (must be before early returns — Rules of Hooks) ──
  const signupBadge=useMemo(()=>{
    const arr=toArr(usersRawBadge);
    return arr.filter(u=>{
      const st=(u.Status||u.status||"").toLowerCase();
      return st==="inactive"||st===""||st==="pending";
    }).length;
  },[usersRawBadge]);

  const reportBadge=useMemo(()=>{
    const arr=toArr(reportsRawBadge);
    return arr.filter(r=>!r.resolved&&!r.Resolved).length;
  },[reportsRawBadge]);

  const techBadge=useMemo(()=>{
    const arr=toArr(techRawBadge);
    return arr.filter(t=>!t.approved&&!t.Approved).length;
  },[techRawBadge]);

  const badgeMap={students:signupBadge,reports:reportBadge,techniques:techBadge,approval:reportBadge+techBadge};
  const pageLabel=NAV.find(n=>n.id===page||n.landingId===page) ||
    NAV.flatMap(n=>n.children||[]).find(c=>c.id===page);
  const inUploaderLeaf=UPLOADER_LEAF_PAGES.includes(page);

  // ── Render ──
  if(!loggedIn) return(
    <ErrorBoundary>
      <style>{css}</style>
      <LoginScreen onLogin={()=>{ _LC.lifecycle("App","User logged in — entering admin panel"); setLoggedIn(true); _saveAdminFcmToken(); }}/>
    </ErrorBoundary>
  );

  if(searchDetail)return(
    <ErrorBoundary>
      <>
      <style>{css}</style>
      <StudentDetail user={searchDetail} onBack={()=>setSearchDetail(null)} push={push}/>
      <Toasts t={toasts}/>
      </>
    </ErrorBoundary>
  );

  return(
    <ErrorBoundary>
      <>
      <style>{css}</style>
      <div className="topbar">
        <div style={{display:"flex",alignItems:"center",gap:8}}>
          {inUploaderLeaf&&(
            <button className="icon-btn" title="Uploader হাবে ফিরে যান" onClick={()=>goPage("uploaderhub")}>←</button>
          )}
          <div>
            <div className="topbar-title">{pageLabel?.icon} {pageLabel?.label}</div>
            <div className="topbar-sub">Smart Study Admin</div>
          </div>
        </div>
        <div style={{display:"flex",gap:6}}>
          <button className={`icon-btn${spin?" spin":""}`} onClick={refresh}>🔄</button>
          <button className="icon-btn" title="Logout" onClick={()=>{ _LC.auth("logout","Admin logged out manually"); localStorage.removeItem("fb_email");localStorage.removeItem("fb_pass_enc");localStorage.removeItem("fb_refresh_token");window.__adminIdToken=null;clearIdToken();setLoggedIn(false); }}><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg></button>
        </div>
      </div>

      <div style={{display:page==="dashboard"?"block":"none"}}><DashboardPage push={push} tick={tick}/></div>
      <div style={{display:page==="students" ?"block":"none"}}><StudentsPage  push={push} tick={tick} pushLayer={pushLayer}/></div>
      <div style={{display:page==="content"  ?"block":"none"}}><ContentManagerPage push={push} tick={tick} pushLayer={pushLayer}/></div>
      <div style={{display:page==="notify"   ?"block":"none"}}><NotifyPage    push={push} tick={tick}/></div>

      {/* Approval hub — Reports / Techniques, একটার আন্ডারে, ট্যাব দিয়ে সুইচ (structure অপরিবর্তিত,
          এখানে মাত্র ২টা ট্যাব থাকায় launcher-grid দরকার নেই, শুধু টোকেন/স্পেসিং পলিশ হলো —
          ReportsPage/TechniquesPage নিজেরাই নিজেদের ".page" wrapper রাখে (Uploader-এর মতোই),
          তাই বাইরে থেকে আর দ্বিতীয়বার ".page"-এ মোড়ানো হচ্ছে না — Phase ৪-এর একই ফিক্স এখানেও) */}
      <div style={{display:(page==="reports"||page==="techniques")?"block":"none"}}>
        <div style={{position:"sticky",top:0,zIndex:40,background:C.bg,padding:"16px 16px 12px"}}>
          <div className="atabs">
            <button className={`atab${page==="reports"?" on":""}`} onClick={()=>goPage("reports")}>🚨 Reports{reportBadge>0?` (${reportBadge})`:""}</button>
            <button className={`atab${page==="techniques"?" on":""}`} onClick={()=>goPage("techniques")}>🧠 Techniques{techBadge>0?` (${techBadge})`:""}</button>
          </div>
        </div>
        <div style={{display:page==="reports"   ?"block":"none"}}><ReportsPage   push={push} tick={tick} deepLinkKey={reportDeepLinkKey} onDeepLinkHandled={()=>setReportDeepLinkKey(null)}/></div>
        <div style={{display:page==="techniques"?"block":"none"}}><TechniquesPage push={push} tick={tick}/></div>
      </div>

      {/* Uploader hub — লঞ্চার গ্রিড (Phase ৪): ৪টা কালার-কোডেড সেকশন, প্রতিটা টুল একটা টাইল।
          কোনো নেস্টেড accordion/ট্যাব-স্টেট নেই — গ্রিড থেকে ট্যাপ করলে সেই টুল ফুল-স্ক্রিনে খোলে,
          topbar-এর ← বাটনে (বা সিস্টেম ব্যাক-এ) সরাসরি এই গ্রিডেই ফেরত আসে। */}
      <div style={{display:page==="uploaderhub"?"block":"none"}}>
        <div className="page">
          <LauncherGrid sections={UPLOADER_SECTIONS} onSelect={goPage}/>
        </div>
      </div>

      {/* নিচের ৯টা টুল-পেজের একটাও ছোঁয়া হয়নি — শুধু কীভাবে দেখানো হচ্ছে (wrapper) তা বদলেছে।
          Bulk/Single/Typing/AIImport/MultiImport/Archive নিজেরাই নিজেদের ভিতরে ".page" wrapper
          রাখে (আগে এখানে আরেকটা বাইরের ".page"-এ মোড়ানো থাকায় ডাবল-নেস্টেড prox প্যাডিং তৈরি হতো,
          সেটাও এখানে ঠিক হয়ে গেল)। JobLauncher/QBankConverter/QuestionGen ফ্র্যাগমেন্ট-অনলি,
          তাই প্রতিটাকে নিজের একটা করে ".page" দেওয়া হলো। */}
      <div style={{display:page==="bulkupload" ?"block":"none"}}><BulkUploaderPage push={push} prefillText={bulkPrefill} onClearPrefill={()=>setBulkPrefill(null)}/></div>
      <div style={{display:page==="singleentry"?"block":"none"}}><SingleQuestionEntryPage push={push}/></div>
      <div style={{display:page==="typing"     ?"block":"none"}}><TypingUploaderPage push={push}/></div>
      <div style={{display:page==="joblauncher"?"block":"none"}}><div className="page"><JobLauncherTab push={push} tick={tick}/></div></div>
      <div style={{display:page==="qbankconv"  ?"block":"none"}}><div className="page"><QBankConverterTab push={push} tick={tick}/></div></div>
      <div style={{display:page==="questiongen"?"block":"none"}}><div className="page"><QuestionGenTab push={push} tick={tick}/></div></div>
      <div style={{display:page==="aiimport"   ?"block":"none"}}><AIImportPage push={push} onSendToBulk={payload=>{setBulkPrefill(payload);goPage("bulkupload");}}/></div>
      <div style={{display:page==="multiimport"?"block":"none"}}><MultiSubjectImportPage push={push}/></div>
      <div style={{display:page==="archive"    ?"block":"none"}}><ArchivePage push={push} onSendToBulk={payload=>{setBulkPrefill(payload);goPage("bulkupload");}}/></div>

      <nav className="bottom-nav">
        {NAV.map(n=>{
          const cnt=badgeMap[n.id]||0;
          const isActive=n.children?(n.children.some(c=>c.id===page)||page===n.landingId):page===n.id;
          return(
            <button key={n.id} className={`nav-btn${isActive?" active":""}`}
              onClick={()=>goPage(n.landingId ?? (n.children ? n.children[0].id : n.id))}>
              <span className="nav-icon" style={{position:"relative",display:"inline-block"}}>
                {n.icon}
                {/* hub-dot: এই আইটেমে children আছে মানে ট্যাপ করলে একটা হাব খুলবে (একাধিক সাব-পেজ) —
                    ব্যবহারকারী আগেভাগেই বুঝবে এটা একটা সাধারণ পেজ না। badge count-এর বিপরীত কোণে (bottom-right)
                    বসানো হয়েছে যাতে দুটো একসাথে থাকলেও ওভারল্যাপ না করে। */}
                {n.children&&<span className="nav-dot"/>}
                {cnt>0&&(
                  <span style={{position:"absolute",top:-5,right:-7,background:"#ef4444",color:"#fff",
                    fontSize:8,fontWeight:900,borderRadius:999,minWidth:14,height:14,
                    display:"flex",alignItems:"center",justifyContent:"center",padding:"0 3px",
                    lineHeight:1}}>
                    {cnt>99?"99+":cnt}
                  </span>
                )}
              </span>
              <span>{n.label}</span>
            </button>
          );
        })}
      </nav>
      <Toasts t={toasts}/>
      <BgTaskIndicator/>
      {exitConfirm&&(
        <div style={{
          position:"fixed",bottom:80,left:"50%",transform:"translateX(-50%)",
          background:"#1e293b",border:"1px solid #334155",
          borderRadius:12,padding:"10px 20px",
          fontSize:13,color:"#e2e8f0",fontWeight:600,
          zIndex:9999,whiteSpace:"nowrap",
          boxShadow:"0 4px 20px #0008",
          animation:"ti .2s ease",
        }}>
          আবার Back চাপুন বন্ধ করতে
        </div>
      )}
      {/* ── নতুন Report এলে ভাসমান নোটিফিকেশন — reporter-এর নাম সহ, ট্যাপ করলে সরাসরি সেই রিপোর্টে deep-link ── */}
      {reportAlert&&reportAlert.items&&reportAlert.items.length>0&&(
        <div style={{position:"fixed",top:13,left:"50%",transform:"translateX(-50%)",
          width:"calc(100% - 26px)",maxWidth:440,zIndex:1000,display:"flex",flexDirection:"column",gap:6}}>
          {reportAlert.items.slice(0,3).map((it,i)=>(
            <div key={it.key||i}
              onClick={()=>{
                setReportDeepLinkKey(it.key);
                goPage("reports");
                setReportAlert(p=>p?{items:p.items.filter(x=>x.key!==it.key)}:null);
              }}
              style={{background:C.card,border:`1px solid ${C.red}66`,borderRadius:11,padding:"10px 12px",
                display:"flex",gap:8,alignItems:"flex-start",cursor:"pointer",
                boxShadow:"0 8px 28px #00000080",animation:"ti .25s ease"}}>
              <div style={{fontSize:18,lineHeight:1}}>🚨</div>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontWeight:800,fontSize:12,color:C.text}}>{it.name} রিপোর্ট করেছে</div>
                {it.subject&&<div style={{fontSize:11,color:C.muted,marginTop:2}}>📚 {it.subject}</div>}
                <div style={{fontSize:10,color:C.accent,marginTop:3,fontWeight:700}}>দেখতে ট্যাপ করুন →</div>
              </div>
              <button onClick={(e)=>{e.stopPropagation();setReportAlert(p=>p?{items:p.items.filter(x=>x.key!==it.key)}:null);}}
                style={{background:"transparent",border:"none",color:C.muted,fontSize:15,cursor:"pointer",padding:"0 2px",lineHeight:1}}>✕</button>
            </div>
          ))}
        </div>
      )}
    </>
    </ErrorBoundary>
  );
}
