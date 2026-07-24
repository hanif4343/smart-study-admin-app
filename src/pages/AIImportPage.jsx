/* ══════════ AI IMPORT PAGE (ML Kit OCR) ══════════ */
import React, { useState, useEffect, useRef } from "react";
import { C } from "../core/config.js";
import { _LC } from "../core/logger.js";
import { loadPath, invalidate } from "../core/dataCache.js";
import { fbPush, fbSet } from "../core/firebase.js";
import { toArr, nowTs } from "../core/utils.js";
import { callAiProviderRotating, buildKeyPool } from "../core/ocrProviders.js";
import {
  getBulkEntries, parseBulkEntry, buildBulkRecord, buildSheetRow,
  loadSaveLocPref, saveSaveLocPref, loadSharedGasSecret, saveSharedGasSecret, pushFailedItems
} from "../core/uploaderUtils.js";
import { saveRowsToSheet } from "../core/sheetSave.js";
import { getOcrCacheEntry, setOcrCacheEntry, clearOcrCache } from "../core/ocrCache.js";
import { archiveAdd, archiveDelete } from "../core/archiveStore.js";
import { SaveLocationPicker } from "../components/shared/SaveLocationPicker.jsx";
import { FailedQueuePanel } from "../components/shared/FailedQueuePanel.jsx";
import { ApiSettingsPage } from "./ApiSettingsPage.jsx";

function AIImportPage({push,onSendToBulk}){
  const[images,setImages]=useState([]);   // [{uri,base64,status,ocrText}]
  const[ocrAll,setOcrAll]=useState("");
  const[ocrQtype,setOcrQtype]=useState("MCQ"); // MCQ | Written | Study — OCR অটো-পার্সের টার্গেট ফরম্যাট
  const[running,setRunning]=useState(false);
  const[progress,setProgress]=useState({cur:0,total:0});
  const[copied,setCopied]=useState(false);
  const[showApiSettings,setShowApiSettings]=useState(false);
  const stopRef=useRef(false);
  const[archivedEntryId,setArchivedEntryId]=useState(null); // এই OCR ব্যাচের Archive এন্ট্রি — সফল Submit হলে ডিলিট হবে

  /* ── Direct-submit metadata (Subject/Subtopic/Tags) — Bulk পেজে না গিয়ে সরাসরি Firebase-এ পাঠানোর জন্য ── */
  const[targetMode,setTargetMode]=useState("Quiz"); // Quiz | QBank — শুধু ocrQtype "Study" না হলে relevant
  const[subject,setSubject]=useState("");
  const[subtopic,setSubtopic]=useState("");
  const[audienceTags,setAudienceTags]=useState([]);
  const[tagInput,setTagInput]=useState("");
  const[subjectList,setSubjectList]=useState([]);
  const[directRunning,setDirectRunning]=useState(false);
  const[directProgress,setDirectProgress]=useState({done:0,total:0,sent:0,failed:0});
  const QUICK_TAGS=["Job","Class 7","Computer Operator","Masters 1"];
  const[saveLoc,setSaveLoc]=useState(loadSaveLocPref); // "sheet" | "firebase"
  const setSaveLocP=(v)=>{ setSaveLoc(v); saveSaveLocPref(v); };
  const[gasSecret,setGasSecret]=useState(loadSharedGasSecret);
  const setGasSecretP=(v)=>{ setGasSecret(v); saveSharedGasSecret(v); };

  const effMode=ocrQtype==="Study"?"Study":targetMode; // Firebase sheet
  const effQtype=ocrQtype==="Study"?"Study":ocrQtype;  // MCQ | Written | Study

  /* Subject autocomplete — target sheet অনুযায়ী লোড হয় */
  useEffect(()=>{
    loadPath(effMode).then(raw=>{
      const arr=toArr(raw);
      const subs=[...new Set(arr.map(q=>q.subject||q.Subject||"").filter(Boolean))];
      setSubjectList(subs);
    }).catch(()=>{});
  },[effMode]);

  const addTag=()=>{
    const t=tagInput.trim();
    if(t&&!audienceTags.includes(t)){setAudienceTags(p=>[...p,t]);}
    setTagInput("");
  };
  const removeTag=(t)=>setAudienceTags(p=>p.filter(x=>x!==t));

  /* ── Direct submit — Bulk পেজে না গিয়ে এখান থেকেই সরাসরি Google Sheet অথবা Firebase-এ পাঠায় ── */
  const directSubmit=async()=>{
    const toParse=(parsedAll&&parsedAll.trim())?parsedAll:ocrAll;
    if(!toParse.trim()){push("warn","আগে OCR চালান","");return;}
    if(!subject.trim()){push("warn","⚠️ Subject লিখুন","");return;}
    const entries=getBulkEntries(toParse).map(l=>parseBulkEntry(l,effQtype)).filter(r=>r.ok);
    if(!entries.length){
      push("warn","⚠️ কোনো valid প্রশ্ন পাওয়া যায়নি","Prompt Copy দিয়ে Gemini-তে format করে আবার আনুন");
      return;
    }
    setDirectRunning(true);
    setDirectProgress({done:0,total:entries.length,sent:0,failed:0});

    if(saveLoc==="sheet"){
      const rows=entries.map(item=>buildSheetRow({item,subject,subtopic,qtype:effQtype,audienceTags}));
      const result=await saveRowsToSheet({rows,targetTab:effMode,gasSecret,push});
      setDirectProgress({done:entries.length,total:entries.length,sent:result.added,failed:result.failedRows.length});
      setDirectRunning(false);
      if(result.failedRows.length) pushFailedItems("AI Import (OCR)",saveLoc,effMode,result.failedRows);
      if(result.added>0) push("success",`✅ ${result.added}টি Sheet-এ যোগ হয়েছে!`,`${effMode} — ${subject}`+(result.skipped?`, ${result.skipped}টা duplicate বাদ পড়েছে`:""));
      if(result.failedRows.length) push("error",`${result.failedRows.length}টি ব্যর্থ হয়েছে`,"নিচে ক্যাশ থেকে আবার পাঠানো যাবে");
      if((result.added>0||result.skipped>0)&&archivedEntryId){ archiveDelete(archivedEntryId); setArchivedEntryId(null); }
      return;
    }

    let sent=0,failed=0; const failedRecs=[];
    const BATCH=8;
    for(let i=0;i<entries.length;i+=BATCH){
      const batch=entries.slice(i,i+BATCH);
      await Promise.all(batch.map(async(item)=>{
        const ts=nowTs();
        const id=Date.now()+Math.floor(Math.random()*9999);
        const rec=buildBulkRecord({item,subject,subtopic,mode:effMode,qtype:effQtype,audienceTags,ts,id});
        try{
          const res=await fbPush(effMode,rec);
          if(res?.name) await fbSet(`${effMode}/${res.name}/id`,res.name);
          invalidate(effMode);
          sent++;
        }catch(e){
          failed++;
          failedRecs.push(rec);
        }
        setDirectProgress(p=>({...p,done:p.done+1,sent,failed}));
      }));
    }
    setDirectRunning(false);
    if(failedRecs.length) pushFailedItems("AI Import (OCR)",saveLoc,effMode,failedRecs);
    if(sent>0)push("success",`✅ ${sent}টি সরাসরি যোগ হয়েছে!`,`${effMode} — ${subject}`);
    if(failed>0)push("error",`${failed}টি ব্যর্থ হয়েছে`,"নিচে ক্যাশ থেকে আবার পাঠানো যাবে");
    if(sent>0&&archivedEntryId){ archiveDelete(archivedEntryId); setArchivedEntryId(null); }
  };

  /* ── Capacitor Camera plugin ── */

  // Capacitor 5 এ Camera plugin নানা নামে আসতে পারে।
  // সব possible name try করি, না পেলে available plugins log করি।
  const _getCamera=()=>{
    const P=window.Capacitor?.Plugins||{};
    const cam=P.Camera||P.CameraPlugin||P["@capacitor/camera"]||null;
    if(!cam){
      const available=Object.keys(P).join(", ")||"(none)";
      _LC.error("camera",`Camera plugin not found. Available plugins: ${available}`);
      // সরাসরি দেখানোর জন্য push notification
      push("error","Available Plugins:",available||"(none)");
    }
    return cam;
  };

  // Permission helper — Android 13+ needs READ_MEDIA_IMAGES
  const _ensureMediaPermission=async()=>{
    try{
      const Camera=_getCamera();
      if(!Camera) return true; // plugin নেই, proceed করি permission ছাড়া
      const perm=await Camera.checkPermissions();
      if(perm?.photos==="granted"||perm?.photos==="limited") return true;
      const req=await Camera.requestPermissions({permissions:["photos","camera"]});
      if(req?.photos==="denied"||req?.photos==="permanently_denied"){
        push("error","Permission denied","Settings থেকে Photos permission দিন");
        _LC.error("permission","READ_MEDIA_IMAGES denied by user");
        return false;
      }
      return true;
    }catch(e){
      _LC.warn("permission",`Permission check error: ${e.message}`);
      return true; // proceed anyway
    }
  };

  const pickGallery=async()=>{
    try{
      const allowed=await _ensureMediaPermission();
      if(!allowed) return;

      // ── প্রাধান্য: নিজস্ব GalleryPicker plugin (ACTION_OPEN_DOCUMENT) ──
      // @capacitor/camera-এর pickImages() কিছু ডিভাইসে (Oppo/Realme/Xiaomi ইত্যাদি)
      // একসাথে একাধিক ছবি বাছতে দেয় না — GalleryPicker এই সমস্যা এড়াতে বানানো।
      const {GalleryPicker}=window.Capacitor?.Plugins||{};
      if(GalleryPicker){
        _LC.log("gallery","GalleryPicker.pickImages called");
        const res=await GalleryPicker.pickImages();
        const imgs=(res.photos||[]).map(p=>({
          webPath:`data:image/jpeg;base64,${p.base64String}`,base64:"",status:"pending",ocrText:"",id:Date.now()+Math.random()
        }));
        _LC.log("gallery",`${imgs.length} image(s) selected (GalleryPicker)`);
        setImages(p=>[...p,...imgs]);
        return;
      }

      // ── Fallback: @capacitor/camera (পুরনো APK বা GalleryPicker সিঙ্ক না হলে) ──
      const Camera=_getCamera();
      if(!Camera){
        push("warn","Camera plugin নেই","Logcat দেখুন — available plugins log করা হয়েছে");
        return;
      }
      _LC.log("gallery","Camera.pickImages called (fallback)");
      const res=await Camera.pickImages({quality:90,limit:0});
      const imgs=(res.photos||[]).map(p=>({
        webPath:p.webPath,base64:"",status:"pending",ocrText:"",id:Date.now()+Math.random()
      }));
      _LC.log("gallery",`${imgs.length} image(s) selected (Camera fallback)`);
      setImages(p=>[...p,...imgs]);
    }catch(e){
      if(e.message==="cancelled")return;
      _LC.error("gallery",`Gallery error: ${e.message}`);
      push("error","Gallery error",e.message);
    }
  };

  const openCamera=async()=>{
    try{
      const Camera=_getCamera();
      if(!Camera){push("warn","Camera plugin নেই","Logcat দেখুন");return;}
      const allowed=await _ensureMediaPermission();
      if(!allowed) return;
      const res=await Camera.getPhoto({quality:90,resultType:"base64",source:"CAMERA"});
      _LC.log("camera","Photo taken via camera");
      setImages(p=>[...p,{webPath:"",base64:res.base64String||"",status:"pending",ocrText:"",id:Date.now()}]);
    }catch(e){
      if(!e.message?.includes("cancelled")) push("error","Camera error",e.message);
      if(!e.message?.includes("cancelled")) _LC.error("camera",`Camera error: ${e.message}`);
    }
  };

  const removeImg=(id)=>setImages(p=>p.filter(x=>x.id!==id));
  const clearAll=()=>{setImages([]);setOcrAll("");setParsedAll("");setCopied(false);setShowParsed(true);};

  /* ── Convert webPath → base64 ── */
  const toBase64=async(img)=>{
    if(img.base64)return img.base64;
    return new Promise((res,rej)=>{
      const canvas=document.createElement("canvas");
      const image=new Image();
      image.onload=()=>{
        // 2-side detection: if width > height*1.4, split vertically
        const W=image.naturalWidth, H=image.naturalHeight;
        if(W>H*1.4){
          // দুই পাশের page — দুটো আলাদা base64 দেব
          const half=Math.floor(W/2);
          canvas.width=half; canvas.height=H;
          const ctx=canvas.getContext("2d");
          ctx.drawImage(image,0,0,half,H,0,0,half,H);
          const left=canvas.toDataURL("image/jpeg",0.9).split(",")[1];
          ctx.clearRect(0,0,half,H);
          ctx.drawImage(image,half,0,W-half,H,0,0,W-half,H);
          canvas.width=W-half;
          const right=canvas.toDataURL("image/jpeg",0.9).split(",")[1];
          res([left,right]); // array = 2 pages
        } else {
          canvas.width=W; canvas.height=H;
          canvas.getContext("2d").drawImage(image,0,0);
          res(canvas.toDataURL("image/jpeg",0.9).split(",")[1]);
        }
      };
      image.onerror=()=>rej(new Error("Image load failed"));
      image.src=img.webPath;
    });
  };

  /* ── ML Kit OCR via native plugin ── */
  // Returns {raw, parsed} — raw=full text, parsed=semicolon lines (bulk ready)
  const runOcrOnBase64=async(b64,qtype="MCQ")=>{
    // ── OCR ক্যাশ — একই ছবি (একই qtype) আগে OCR হয়ে থাকলে native call এড়িয়ে সরাসরি আগের ফলাফল দেয় ──
    const cached=getOcrCacheEntry(b64,qtype);
    if(cached){
      _LC.log("OcrPlugin","📦 OCR cache hit — native call এড়ানো হলো");
      return cached;
    }
    const {OcrPlugin}=window.Capacitor?.Plugins||{};
    if(!OcrPlugin){
      const available=Object.keys(window.Capacitor?.Plugins||{}).join(", ")||"(none)";
      _LC.crash("OcrPlugin",`OcrPlugin missing. Available: ${available}`,{available});
      throw new Error("OcrPlugin নেই — APK rebuild করুন");
    }
    try{
      _LC.api("OcrPlugin","recognizeText called");
      const res=await OcrPlugin.recognizeText({base64:b64});
      const raw=res.text||"";
      let parsed=res.parsed||"";  // semicolon format from Kotlin parser
      _LC.log("OcrPlugin",`OCR result: ${raw.length} chars, parsed: ${parsed.split("\n").filter(Boolean).length} questions`);
      // ── Auto AI parse if any provider active (rotation pool) ─────────────
      try{
        const aiResult=await callAiProviderRotating(raw,qtype);
        if(aiResult&&aiResult.includes(";")){
          parsed=aiResult;  // AI parse replaces local parser output
          _LC.log("OcrPlugin",`AI parse success (${qtype}): `+aiResult.split("\n").filter(Boolean).length+" questions");
        }
      }catch(aiErr){
        _LC.warn("OcrPlugin","AI parse skipped ("+aiErr.message+") — using local parser");
        // fallback: keep local parsed result
      }
      const result={raw, parsed};
      setOcrCacheEntry(b64,qtype,result);
      return result;
    }catch(e){
      _LC.error("OcrPlugin",`recognizeText failed: ${e.message}`);
      throw e;
    }
  };

  /* ── Run OCR on all images serially ── */
  // ocrAll = raw text (দেখার জন্য), parsedAll = semicolon lines (bulk-ready)
  const[parsedAll,setParsedAll]=useState("");
  const[showParsed,setShowParsed]=useState(true); // toggle raw/parsed view

  const startOcr=async()=>{
    if(!images.length){push("warn","ছবি যোগ করুন","");return;}
    setRunning(true);stopRef.current=false;
    setOcrAll("");setParsedAll("");setCopied(false);setShowParsed(true);
    setArchivedEntryId(null);
    let combinedRaw="";
    let combinedParsed="";
    setProgress({cur:0,total:images.length});

    for(let i=0;i<images.length;i++){
      if(stopRef.current)break;
      setProgress({cur:i+1,total:images.length});
      setImages(p=>p.map((x,j)=>j===i?{...x,status:"running"}:x));
      try{
        // toBase64 returns string or [left,right] for wide pages
        // — Column split is now also done in Kotlin (OcrPlugin) for portrait
        // Here we handle the JS-side landscape split (original behavior kept)
        const b64raw=await toBase64(images[i]);
        const parts=Array.isArray(b64raw)?b64raw:[b64raw];
        let pageRaw="", pageParsed="";
        for(const b64 of parts){
          const {raw,parsed}=await runOcrOnBase64(b64,ocrQtype);
          if(raw)    pageRaw    +=(pageRaw?"\n":"")+raw;
          if(parsed) pageParsed +=(pageParsed?"\n":"")+parsed;
        }
        setImages(p=>p.map((x,j)=>j===i?{...x,status:"done",ocrText:pageRaw}:x));
        combinedRaw    +=`--- ছবি ${i+1} ---\n${pageRaw}\n\n`;
        combinedParsed +=pageParsed?(pageParsed+"\n"):"";
        setOcrAll(combinedRaw);
        setParsedAll(combinedParsed);
      }catch(e){
        setImages(p=>p.map((x,j)=>j===i?{...x,status:"error",ocrText:e.message}:x));
        combinedRaw+=`--- ছবি ${i+1} ERROR: ${e.message} ---\n\n`;
        setOcrAll(combinedRaw);
      }
    }
    setRunning(false);
    const qCount=combinedParsed.split("\n").filter(l=>l.trim()&&l.includes(";")).length;
    if(combinedParsed.trim()){
      const arcEntry=archiveAdd({source:"AI Import (OCR)",subject,subtopic,qtype:ocrQtype,text:combinedParsed});
      if(arcEntry) setArchivedEntryId(arcEntry.id);
    }
    push("success",`✅ OCR সম্পন্ন!`,`${images.length}টি ছবি — ${qCount}টি প্রশ্ন parse হয়েছে`);
  };

  /* ── Copy OCR + Prompt ── */
  const copyPrompt=(qtype)=>{
    if(!ocrAll.trim()){push("warn","আগে OCR চালান","");return;}
    const formats={
      MCQ:`MCQ format — প্রতি লাইন:\nপ্রশ্ন;অপ১;অপ২;অপ৩;অপ৪;সঠিকউত্তর;ব্যাখ্যা(optional)\nউদাহরণ: বাংলাদেশের রাজধানী?;ঢাকা;চট্টগ্রাম;খুলনা;রাজশাহী;ঢাকা\nসঠিক উত্তর বের করার নিয়ম: (১) ভরাট/কালো বৃত্ত (●) চিহ্নিত অপশন থাকলে সেটাই সঠিক (২) ক/খ/গ/ঘ বা A/B/C/D পজিশন দেওয়া থাকলে সেই পজিশনের অপশন (৩) সরাসরি টেক্সট দেওয়া থাকলে সেটাই ব্যবহার করো — সবসময় আসল টেক্সট বসাবে, অক্ষর নয়`,
      Written:`Written format — প্রতি entry {} দিয়ে wrap করো:\n{প্রশ্ন;উত্তর}\nউদাহরণ: {সন্ধি বিচ্ছেদ: সঞ্চয়;সম+চয়}`,
      Study:`Study format — প্রতি entry {} দিয়ে wrap করো:\n{প্রশ্ন;উত্তর লাইন১\nউত্তর লাইন২}\nউদাহরণ: {রাষ্ট্রবিজ্ঞানের জনক কে?;এরিস্টটল}`,
    };
    const prompt=`তুমি একজন প্রশ্নপত্র formatter। নিচের OCR text থেকে সব প্রশ্ন বের করে নির্দিষ্ট format-এ দাও।\n\nOUTPUT FORMAT (${qtype}):\n${formats[qtype]}\n\nRULES:\n- শুধু formatted data দাও, কোনো label বা explanation নয়\n- Serial number বাদ দাও\n- field-এর ভেতরে ; থাকলে | দিয়ে replace করো\n- কোনো প্রশ্ন বাদ দিও না\n\n=== OCR TEXT ===\n${ocrAll}`;
    navigator.clipboard.writeText(prompt).then(()=>{
      setCopied(true);
      push("success","✅ Copied!","Gemini/ChatGPT-এ paste করুন → format করা text আবার Bulk-এ paste করুন");
      setTimeout(()=>setCopied(false),3000);
    }).catch(()=>{push("error","Copy ব্যর্থ","");});
  };

  /* ── Send to Bulk ── */
  // parsed থাকলে সেটাই পাঠাই (semicolon-ready), না থাকলে raw OCR text
  const sendToBulk=()=>{
    const toSend=(parsedAll&&parsedAll.trim())?parsedAll:ocrAll;
    if(!toSend.trim()){push("warn","আগে OCR চালান","");return;}
    const isParsed=!!(parsedAll&&parsedAll.trim());
    onSendToBulk({text:toSend,subject,subtopic,tags:audienceTags,mode:effMode,qtype:effQtype,archiveId:archivedEntryId});
    push("success",
      isParsed?"✅ Parsed প্রশ্ন Bulk-এ পাঠানো হয়েছে!":"📋 Raw OCR text Bulk-এ পাঠানো হয়েছে",
      isParsed?"Subject/Subtopic auto-fill হয়েছে — check করে Upload করুন":"Gemini দিয়ে format করুন"
    );
  };

  const pct=progress.total?Math.round(progress.cur/progress.total*100):0;

  return(
    <div className="page">
      {/* Header */}
      <div style={{background:`linear-gradient(135deg,#7c3aed,#4f46e5)`,borderRadius:14,padding:"14px 16px",marginBottom:14,color:"#fff",position:"relative"}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
          <div>
            <div style={{fontWeight:900,fontSize:15,marginBottom:2}}>📸 AI Import — OCR</div>
            <div style={{fontSize:11,opacity:.8}}>
              {buildKeyPool().length
                ? `✅ ${buildKeyPool().length}টা key রেডি (rotation)`
                : "⚠️ কোনো API key active নেই — ⚙️ দিন"}
            </div>
          </div>
          <button onClick={()=>setShowApiSettings(v=>!v)}
            style={{background:"rgba(255,255,255,0.15)",border:"1px solid rgba(255,255,255,0.3)",
              borderRadius:10,color:"#fff",fontSize:20,width:40,height:40,cursor:"pointer",
              display:"flex",alignItems:"center",justifyContent:"center"}}>
            {showApiSettings?"✕":"⚙️"}
          </button>
        </div>
      </div>
      {/* Inline API Settings panel */}
      {showApiSettings&&(
        <>
          <ApiSettingsPage push={push} inline={true}/>
          <button className="btn" style={{width:"100%",justifyContent:"center",fontSize:11,background:"transparent",color:C.muted,border:`1px solid ${C.border}`,marginBottom:12}}
            onClick={()=>{clearOcrCache();push("success","🗑️ OCR ক্যাশ মুছে ফেলা হয়েছে","পরের বার সব ছবি নতুন করে OCR হবে");}}>
            🗑️ OCR ক্যাশ মুছুন (একই ছবি আবার OCR করার জন্য)
          </button>
        </>
      )}

      {/* OCR Format Selector */}
      <div style={{marginBottom:12}}>
        <div style={{fontSize:11,color:C.muted,marginBottom:6,fontWeight:600}}>এই ছবিগুলো কোন ফরম্যাটে পার্স করবো?</div>
        <div style={{display:"flex",gap:6}}>
          {["MCQ","Written","Study"].map(t=>(
            <button key={t} className={`ftab${ocrQtype===t?" on":""}`} onClick={()=>setOcrQtype(t)} style={{flex:1}} disabled={running}>{t}</button>
          ))}
        </div>
      </div>

      {/* Image Picker Buttons */}
      <div style={{display:"flex",gap:8,marginBottom:12}}>
        <button className="btn bp bb" style={{flex:1}} onClick={pickGallery}>🖼 Gallery (একাধিক)</button>
        <button className="btn" style={{flex:1,background:"#1e293b",color:C.text,borderColor:C.border}} onClick={openCamera}>📷 Camera</button>
        {images.length>0&&<button className="btn" style={{background:"#7f1d1d",color:"#fca5a5",borderColor:"#991b1b",padding:"0 12px"}} onClick={clearAll}>🗑</button>}
      </div>

      {/* Image Grid */}
      {images.length>0&&(
        <div style={{display:"flex",flexWrap:"wrap",gap:8,marginBottom:12}}>
          {images.map((img,i)=>(
            <div key={img.id} style={{position:"relative",width:72,height:72}}>
              {img.webPath?(
                <img src={img.webPath} style={{width:72,height:72,borderRadius:10,objectFit:"cover",
                  border:`2px solid ${img.status==="done"?"#10b981":img.status==="error"?"#ef4444":img.status==="running"?"#6366f1":C.border}`}}/>
              ):(
                <div style={{width:72,height:72,borderRadius:10,background:C.panel,border:`2px solid ${C.border}`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:20}}>📷</div>
              )}
              {/* Status overlay */}
              <div style={{position:"absolute",bottom:2,left:2,right:2,textAlign:"center",fontSize:9,fontWeight:800,
                color:img.status==="done"?"#10b981":img.status==="error"?"#ef4444":img.status==="running"?"#818cf8":"#94a3b8"}}>
                {img.status==="done"?"✔":img.status==="error"?"✗":img.status==="running"?"⏳":`#${i+1}`}
              </div>
              {/* Remove */}
              {!running&&(
                <div onClick={()=>removeImg(img.id)} style={{position:"absolute",top:-6,right:-6,background:"#ef4444",color:"#fff",borderRadius:999,width:18,height:18,display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,cursor:"pointer",fontWeight:900}}>×</div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Info box */}
      <div style={{background:"#0a1628",border:`1px solid ${C.border}`,borderRadius:10,padding:"8px 12px",fontSize:11,color:C.muted,marginBottom:12,lineHeight:1.7}}>
        <div style={{color:C.text,fontWeight:700,marginBottom:3}}>📋 ব্যবহার পদ্ধতি:</div>
        <div>① Gallery থেকে ছবি নিন (একসাথে অনেক)</div>
        <div>② <b style={{color:"#6366f1"}}>OCR চালান</b> → AI নিজে থেকেই parse করবে</div>
        <div>③ Subject/Subtopic দিয়ে <b style={{color:"#10b981"}}>সরাসরি Submit করুন</b></div>
        <div style={{color:"#f59e0b"}}>⚠️ Auto-parse ব্যর্থ হলেই শুধু <b>Prompt Copy</b> দিয়ে Gemini-তে ম্যানুয়ালি format করতে হবে</div>
        <div style={{color:"#d97706",marginTop:3}}>💡 2-side page (landscape) হলে automatically দুটো আলাদা করে OCR হবে</div>
      </div>

      {/* Progress */}
      {running&&(
        <div style={{background:C.panel,border:`1px solid ${C.border}`,borderRadius:12,padding:"10px 14px",marginBottom:12}}>
          <div style={{display:"flex",justifyContent:"space-between",fontSize:11,marginBottom:6}}>
            <span style={{color:C.text,fontWeight:700}}>⏳ OCR চলছে...</span>
            <span style={{color:"#6366f1",fontWeight:900}}>{pct}% ({progress.cur}/{progress.total})</span>
          </div>
          <div style={{background:C.border,borderRadius:999,height:8,overflow:"hidden"}}>
            <div style={{height:"100%",width:`${pct}%`,background:"linear-gradient(90deg,#6366f1,#10b981)",borderRadius:999,transition:"width .3s"}}/>
          </div>
        </div>
      )}

      {/* OCR Result — Parsed / Raw toggle */}
      {ocrAll&&(
        <div style={{background:C.panel,border:`1px solid ${C.border}`,borderRadius:12,padding:"10px 14px",marginBottom:12}}>
          {/* Header row */}
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
            <span style={{fontSize:12,fontWeight:800,color:C.text}}>📄 OCR Result</span>
            <div style={{display:"flex",gap:5,alignItems:"center"}}>
              {parsedAll&&(
                <div style={{display:"flex",borderRadius:20,overflow:"hidden",border:`1px solid ${C.border}`}}>
                  <button onClick={()=>setShowParsed(true)} style={{
                    fontSize:10,padding:"3px 10px",border:"none",cursor:"pointer",fontWeight:700,
                    background:showParsed?"#10b981":"transparent",
                    color:showParsed?"#fff":C.muted
                  }}>✅ Parsed</button>
                  <button onClick={()=>setShowParsed(false)} style={{
                    fontSize:10,padding:"3px 10px",border:"none",cursor:"pointer",fontWeight:700,
                    background:!showParsed?"#6366f1":"transparent",
                    color:!showParsed?"#fff":C.muted
                  }}>📝 Raw</button>
                </div>
              )}
              <span style={{fontSize:10,color:C.muted}}>
                {showParsed&&parsedAll
                  ? `${parsedAll.split("\n").filter(l=>l.trim()&&l.includes(";")).length} প্রশ্ন`
                  : `${ocrAll.length} chars`}
              </span>
            </div>
          </div>
          {/* Parsed result info bar */}
          {showParsed&&parsedAll&&(
            <div style={{fontSize:11,color:"#10b981",fontWeight:700,marginBottom:6,padding:"4px 10px",
              background:"#052e16",borderRadius:8,border:"1px solid #10b98133"}}>
              🎯 Auto-parsed! প্রশ্ন + অপশন আলাদা হয়েছে। নিচে দেখুন ও দরকারে edit করুন।
            </div>
          )}
          {showParsed&&parsedAll?(
            <textarea className="ta" style={{minHeight:120,fontSize:11,fontFamily:"monospace",marginBottom:0,
              borderColor:"#10b98144"}}
              value={parsedAll} onChange={e=>setParsedAll(e.target.value)}/>
          ):(
            <textarea className="ta" style={{minHeight:120,fontSize:11,fontFamily:"monospace",marginBottom:0}}
              value={ocrAll} onChange={e=>setOcrAll(e.target.value)}/>
          )}
        </div>
      )}

      {/* Action Buttons */}
      <div style={{display:"flex",flexDirection:"column",gap:8}}>
        {/* OCR Button */}
        <button className="btn bp bb" disabled={running||!images.length} onClick={startOcr} style={{justifyContent:"center"}}>
          {running?(
            <span>⏳ OCR চলছে... {progress.cur}/{progress.total}</span>
          ):(
            <span>🔍 STEP 1: OCR চালান (ছবি → TEXT)</span>
          )}
        </button>

        {/* Stop */}
        {running&&(
          <button className="btn" style={{background:"#7f1d1d",color:"#fca5a5",borderColor:"#991b1b",justifyContent:"center"}}
            onClick={()=>stopRef.current=true}>⛔ বন্ধ করুন</button>
        )}

        {/* Step 2 (fallback only) — auto-parse ব্যর্থ হলে Gemini দিয়ে ম্যানুয়ালি format করার পথ */}
        {ocrAll&&!running&&!parsedAll&&(
          <>
            <div style={{fontSize:11,color:"#f59e0b",textAlign:"center",marginTop:4}}>⚠️ Auto-parse হয়নি — STEP 2: Prompt copy করুন → Gemini-তে paste করুন → format করা text ফিরিয়ে আনুন</div>
            <div style={{display:"flex",gap:6}}>
              {["MCQ","Written","Study"].map(t=>(
                <button key={t} className="btn" onClick={()=>copyPrompt(t)}
                  style={{flex:1,justifyContent:"center",fontSize:11,
                    background:t==="MCQ"?"#1e3a5f":t==="Written"?"#1c2a1c":"#1a1a2e",
                    color:t==="MCQ"?"#60a5fa":t==="Written"?"#4ade80":"#818cf8",
                    borderColor:t==="MCQ"?"#3b82f6":t==="Written"?"#22c55e":"#6366f1"}}>
                  {copied?"✅ Copied!`":`📋 ${t} Prompt`}
                </button>
              ))}
            </div>
            <button className="btn" onClick={sendToBulk}
              style={{background:"#052e16",color:"#10b981",borderColor:"#10b981",justifyContent:"center"}}>
              📤 Raw OCR → Bulk পেজে পাঠান (ম্যানুয়ালি ফরম্যাট করে আপলোড করুন)
            </button>
          </>
        )}

        {/* Auto-parse সফল — সরাসরি এখান থেকেই Subject/Subtopic/Tags দিয়ে Submit */}
        {parsedAll&&!running&&(
          <div style={{background:C.panel,border:`1px solid ${C.border}`,borderRadius:12,padding:"10px 14px",marginTop:4}}>
            <div style={{fontSize:11,fontWeight:800,color:"#10b981",marginBottom:8}}>🚀 সরাসরি Submit করুন — Bulk পেজে যাওয়ার দরকার নেই</div>

            {/* Target Sheet — শুধু ocrQtype "Study" না হলে দেখাবে */}
            {ocrQtype!=="Study"&&(
              <div style={{display:"flex",gap:6,marginBottom:8}}>
                {["Quiz","QBank"].map(m=>(
                  <button key={m} type="button" onClick={()=>setTargetMode(m)}
                    style={{flex:1,fontSize:11,fontWeight:700,padding:"5px 0",borderRadius:8,cursor:"pointer",
                      border:`1px solid ${targetMode===m?C.accent:C.border}`,
                      background:targetMode===m?C.accent+"22":"transparent",
                      color:targetMode===m?C.accent:C.muted}}>{m}</button>
                ))}
              </div>
            )}

            {/* Subject & Subtopic */}
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:8}}>
              <div className="fld" style={{marginBottom:0}}>
                <label>📚 Subject</label>
                <input className="inp" list="ocr-sl" value={subject} onChange={e=>setSubject(e.target.value)} placeholder="Subject..."/>
                <datalist id="ocr-sl">{subjectList.map((s,i)=><option key={i} value={s}/>)}</datalist>
              </div>
              <div className="fld" style={{marginBottom:0}}>
                <label>📌 Sub-Topic</label>
                <input className="inp" value={subtopic} onChange={e=>setSubtopic(e.target.value)} placeholder="Sub topic..."/>
              </div>
            </div>

            {/* Audience Tags */}
            <div style={{marginBottom:10}}>
              <div style={{fontSize:10,fontWeight:800,color:C.muted,letterSpacing:".7px",marginBottom:6,textTransform:"uppercase"}}>🏷 Audience Tags</div>
              <div style={{display:"flex",gap:5,flexWrap:"wrap",marginBottom:6}}>
                {QUICK_TAGS.map(t=>(
                  <button key={t} onClick={()=>{if(!audienceTags.includes(t))setAudienceTags(p=>[...p,t]);}}
                    style={{fontSize:10,padding:"3px 9px",borderRadius:20,border:`1px solid ${audienceTags.includes(t)?C.accent:C.border}`,background:audienceTags.includes(t)?C.accent+"22":"transparent",color:audienceTags.includes(t)?C.accent:C.muted,cursor:"pointer",fontWeight:700}}>{t}</button>
                ))}
              </div>
              {audienceTags.length>0&&(
                <div style={{display:"flex",gap:5,flexWrap:"wrap",marginBottom:6}}>
                  {audienceTags.map(t=>(
                    <span key={t} style={{fontSize:11,padding:"2px 9px",borderRadius:20,background:C.accent,color:"#fff",fontWeight:700,display:"flex",alignItems:"center",gap:4}}>
                      {t}<span onClick={()=>removeTag(t)} style={{cursor:"pointer",opacity:.8,marginLeft:2}}>×</span>
                    </span>
                  ))}
                </div>
              )}
              <div style={{display:"flex",gap:6}}>
                <input className="inp" style={{flex:1,marginBottom:0}} value={tagInput} onChange={e=>setTagInput(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"){e.preventDefault();addTag();}}} placeholder="Tag লিখুন..."/>
                <button className="btn bp" style={{padding:"0 14px",fontSize:13}} onClick={addTag}>+</button>
              </div>
            </div>

            <SaveLocationPicker value={saveLoc} onChange={setSaveLocP} gasSecret={gasSecret} onGasSecretChange={setGasSecretP}/>

            {/* Direct submit progress */}
            {directRunning&&(
              <div style={{marginBottom:8}}>
                <div style={{display:"flex",justifyContent:"space-between",fontSize:11,marginBottom:6}}>
                  <span style={{color:C.text,fontWeight:700}}>⏳ Submit হচ্ছে...</span>
                  <span style={{color:"#10b981",fontWeight:900}}>{directProgress.done}/{directProgress.total}</span>
                </div>
                <div style={{background:C.border,borderRadius:999,height:8,overflow:"hidden"}}>
                  <div style={{height:"100%",width:`${directProgress.total?Math.round(directProgress.done/directProgress.total*100):0}%`,background:"linear-gradient(90deg,#6366f1,#10b981)",borderRadius:999,transition:"width .25s"}}/>
                </div>
              </div>
            )}

            <button className="btn" disabled={directRunning} onClick={directSubmit}
              style={{background:"#052e16",color:"#10b981",borderColor:"#10b981",justifyContent:"center",width:"100%"}}>
              {directRunning?`⏳ Submit হচ্ছে... (${directProgress.done}/${directProgress.total})`:`🚀 ${effMode} → ${saveLoc==="sheet"?"Sheet":"Firebase"}-এ সরাসরি Submit করুন`}
            </button>
            <button className="btn" onClick={sendToBulk}
              style={{justifyContent:"center",width:"100%",marginTop:6,fontSize:11,background:"transparent",color:C.muted,borderColor:C.border}}>
              📤 অথবা Bulk পেজে পাঠিয়ে সেখানে review করে Upload করুন
            </button>

            <FailedQueuePanel push={push} sourceFilter="AI Import (OCR)"/>
          </div>
        )}
      </div>
    </div>
  );
}

export { AIImportPage };
