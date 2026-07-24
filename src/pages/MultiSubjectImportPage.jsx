/* ══════════════════════════════════════════════════════════════════
   MULTI-SUBJECT BULK IMPORT (OCR) — শুধু Written টাইপ
   — একসাথে অনেক ছবি (একাধিক subject/sub-topic মিশ্রিত) bulk আপলোড
   — প্রতিটা পাতার হেডার থেকে AI Designation → Subject, Institution →
     Sub-topic ডিটেক্ট করে
   — ছবি যোগ করার সময় ইউজার নিজেই "✂️ নতুন Group" মার্ক করে দিতে পারে —
     সেই boundary-র বাইরে carry-forward কখনো যায় না (misread হলেও এক
     group আরেকটায় ঢুকে যাওয়ার ঝুঁকি থাকে না)
   — Process শেষে সরাসরি সাবমিট হয় না — একটা হালকা "Group Confirm"
     ধাপ দেখায় (Subject/Sub-topic/count/page-list, এডিটেবল + বাদ
     দেওয়ার অপশন) — তারপর এক-ট্যাপে Submit
   — পুরনো AIImportPage/BulkUploaderPage অপরিবর্তিত — সম্পূর্ণ নতুন,
     আলাদা পেজ
   ══════════════════════════════════════════════════════════════════ */
import React, { useState, useRef } from "react";
import { C } from "../core/config.js";
import { _LC } from "../core/logger.js";
import { fbPush, fbSet } from "../core/firebase.js";
import { nowTs } from "../core/utils.js";
import { callAiProviderRotatingRaw, buildKeyPool, OCR_CORRECTION_RULES } from "../core/ocrProviders.js";
import {
  buildBulkRecord, buildSheetRow,
  loadSaveLocPref, saveSaveLocPref, loadSharedGasSecret, saveSharedGasSecret, pushFailedItems
} from "../core/uploaderUtils.js";
import { saveRowsToSheet } from "../core/sheetSave.js";
import { getOcrCacheEntry, setOcrCacheEntry } from "../core/ocrCache.js";
import { archiveAdd } from "../core/archiveStore.js";
import { SaveLocationPicker } from "../components/shared/SaveLocationPicker.jsx";
import { FailedQueuePanel } from "../components/shared/FailedQueuePanel.jsx";
import { ApiSettingsPage } from "./ApiSettingsPage.jsx";

const SRC_NAME="Multi-Subject Bulk Import";
const CACHE_QTYPE="MultiSubjectWritten"; // AIImportPage-এর ক্যাশ থেকে আলাদা রাখতে নিজস্ব qtype key

/* ── AI prompt: header থেকে Designation/Institution + Written প্রশ্ন-উত্তর একসাথে বের করে JSON দেয় ── */
function buildDetectPrompt(ocrText){
  return `তুমি একজন বাংলা সরকারি নিয়োগ পরীক্ষার প্রশ্নব্যাংক বিশ্লেষক (শুধু Written টাইপ)।
নিচের OCR text একটি বইয়ের একটি পাতা থেকে নেওয়া। পাতার উপরে সাধারণত একটি হেডার লাইনে চাকরির পদবী (Designation) ও প্রতিষ্ঠান/দপ্তরের নাম (Institution) লেখা থাকে।
উদাহরণ: "বন অধিদপ্তর-এর গাড়ী চালক ২০২৫" → designation="গাড়ী চালক", institution="বন অধিদপ্তর"।
উদাহরণ: "প্রফেসর'স অফিস সহকারী" → designation="অফিস সহকারী", institution="প্রফেসর'স" (বা হেডারে যেভাবে আলাদা বোঝা যায় সেভাবে)।

কাজ:
১. হেডার থেকে designation ও institution আলাদা করে বের করো। সাল/বছরের সংখ্যা, "Written" শব্দ, পাতা নম্বর — এসব designation/institution-এর অংশ নয়, বাদ দাও।
২. এই পাতায় থাকা Written প্রশ্ন-উত্তরগুলো (নম্বরসহ, প্রতিটা প্রশ্নের সাথে থাকা উত্তর) বের করো। MCQ/option-ভিত্তিক প্রশ্ন থাকলেও শুধু প্রশ্ন ও সরাসরি সঠিক উত্তরটুকু নাও, option বাদ দাও।
${OCR_CORRECTION_RULES}

শুধু নিচের বিশুদ্ধ JSON ফরম্যাটে উত্তর দাও — কোনো markdown code fence (\`\`\`), কোনো ব্যাখ্যা, কোনো অতিরিক্ত টেক্সট ছাড়া:
{"designation":"...","institution":"...","entries":[{"q":"...","a":"..."}]}

RULES:
- এই পাতায় হেডার স্পষ্ট না থাকলে (আগের পাতার ধারাবাহিকতা হলে) designation ও institution "" (খালি স্ট্রিং) দাও — অনুমান করে বসিও না
- Serial number বাদ দাও
- q বা a এর ভেতরে দরকার হলে সঠিকভাবে escape (\\") করো, যাতে JSON valid থাকে
- পাতা নম্বর, বিজ্ঞাপন, প্রমোশনাল টেক্সট বাদ দাও
- কোনো প্রশ্ন বাদ দিও না

=== OCR TEXT ===
${ocrText}`;
}

/* ── AI response → {designation, institution, entries:[{q,a}]} ── */
function parseDetectResponse(text){
  let t=(text||"").trim();
  t=t.replace(/^```json/i,"").replace(/^```/,"").replace(/```$/,"").trim();
  const start=t.indexOf("{"), end=t.lastIndexOf("}");
  if(start===-1||end===-1) throw new Error("JSON পাওয়া যায়নি — AI response format ঠিক নেই");
  const obj=JSON.parse(t.slice(start,end+1));
  const designation=(obj.designation||"").toString().trim();
  const institution=(obj.institution||"").toString().trim();
  const entries=Array.isArray(obj.entries)
    ?obj.entries.filter(e=>e&&e.q&&e.a).map(e=>({
        q:String(e.q).trim(),
        a:(Array.isArray(e.a)?e.a.join("\n"):String(e.a)).trim(),
      })).filter(e=>e.q&&e.a)
    :[];
  return{designation,institution,entries};
}

function MultiSubjectImportPage({push}){
  // images: [{id,webPath,base64,status,designation,institution,entryCount,error,groupBreak}]
  // groupBreak=true মানে "এই ছবি থেকে নতুন group শুরু" (ইউজার নিজে মার্ক করে) — index 0 সবসময় group শুরু (মার্ক ছাড়াই)
  const[images,setImages]=useState([]);
  const[phase,setPhase]=useState("idle"); // idle | processing | confirm | done
  const[progress,setProgress]=useState({cur:0,total:0});
  const[showApiSettings,setShowApiSettings]=useState(false);
  const[targetMode,setTargetMode]=useState("Quiz"); // Quiz | QBank
  const[saveLoc,setSaveLoc]=useState(loadSaveLocPref);
  const setSaveLocP=(v)=>{ setSaveLoc(v); saveSaveLocPref(v); };
  const[gasSecret,setGasSecret]=useState(loadSharedGasSecret);
  const setGasSecretP=(v)=>{ setGasSecret(v); saveSharedGasSecret(v); };
  const[draftGroups,setDraftGroups]=useState([]); // [{id,subject,subtopic,rows:[{q,correct}],pages:[n],included}]
  const[result,setResult]=useState(null); // {added,skipped,failed,groupCount}
  const[submitting,setSubmitting]=useState(false);
  const stopRef=useRef(false);

  /* ── Long-press → বড় প্রিভিউ (হেডিং পড়ে বুঝে grouping সহজ করার জন্য) ── */
  const LONG_PRESS_MS=3000;
  const[previewId,setPreviewId]=useState(null);
  const[previewVisible,setPreviewVisible]=useState(false);
  const longPressTimerRef=useRef(null);
  const hideTimerRef=useRef(null);
  const startLongPress=(id)=>{
    clearTimeout(longPressTimerRef.current);
    clearTimeout(hideTimerRef.current);
    longPressTimerRef.current=setTimeout(()=>{
      setPreviewId(id);
      requestAnimationFrame(()=>requestAnimationFrame(()=>setPreviewVisible(true)));
    },LONG_PRESS_MS);
  };
  const cancelLongPress=()=>{
    clearTimeout(longPressTimerRef.current);
    setPreviewVisible(false);
    clearTimeout(hideTimerRef.current);
    hideTimerRef.current=setTimeout(()=>setPreviewId(null),220);
  };

  /* ── Gallery/Camera picker (AIImportPage-এর একই লজিক, স্বনির্ভর কপি) ── */
  const _getCamera=()=>{
    const P=window.Capacitor?.Plugins||{};
    const cam=P.Camera||P.CameraPlugin||P["@capacitor/camera"]||null;
    if(!cam){
      const available=Object.keys(P).join(", ")||"(none)";
      _LC.error("camera",`Camera plugin not found. Available plugins: ${available}`);
      push("error","Available Plugins:",available||"(none)");
    }
    return cam;
  };
  const _ensureMediaPermission=async()=>{
    try{
      const Camera=_getCamera();
      if(!Camera) return true;
      const perm=await Camera.checkPermissions();
      if(perm?.photos==="granted"||perm?.photos==="limited") return true;
      const req=await Camera.requestPermissions({permissions:["photos","camera"]});
      if(req?.photos==="denied"||req?.photos==="permanently_denied"){
        push("error","Permission denied","Settings থেকে Photos permission দিন");
        return false;
      }
      return true;
    }catch(e){ return true; }
  };
  const pickGallery=async()=>{
    try{
      const allowed=await _ensureMediaPermission();
      if(!allowed) return;
      const{GalleryPicker}=window.Capacitor?.Plugins||{};
      if(GalleryPicker){
        const res=await GalleryPicker.pickImages();
        const imgs=(res.photos||[]).map(p=>({
          webPath:`data:image/jpeg;base64,${p.base64String}`,base64:"",status:"pending",
          designation:"",institution:"",entryCount:0,error:"",groupBreak:false,id:Date.now()+Math.random()
        }));
        setImages(p=>[...p,...imgs]);
        return;
      }
      const Camera=_getCamera();
      if(!Camera){ push("warn","Camera plugin নেই","Logcat দেখুন"); return; }
      const res=await Camera.pickImages({quality:90,limit:0});
      const imgs=(res.photos||[]).map(p=>({
        webPath:p.webPath,base64:"",status:"pending",
        designation:"",institution:"",entryCount:0,error:"",groupBreak:false,id:Date.now()+Math.random()
      }));
      setImages(p=>[...p,...imgs]);
    }catch(e){
      if(e.message==="cancelled")return;
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
      setImages(p=>[...p,{webPath:"",base64:res.base64String||"",status:"pending",
        designation:"",institution:"",entryCount:0,error:"",groupBreak:false,id:Date.now()}]);
    }catch(e){
      if(!e.message?.includes("cancelled")) push("error","Camera error",e.message);
    }
  };
  const removeImg=(id)=>setImages(p=>p.filter(x=>x.id!==id));
  const moveImg=(id,dir)=>setImages(p=>{
    const i=p.findIndex(x=>x.id===id);
    const j=i+dir;
    if(i<0||j<0||j>=p.length)return p;
    const copy=[...p];
    [copy[i],copy[j]]=[copy[j],copy[i]];
    return copy;
  });
  const toggleGroupBreak=(id)=>setImages(p=>p.map(x=>x.id===id?{...x,groupBreak:!x.groupBreak}:x));
  const clearAll=()=>{ setImages([]); setResult(null); setDraftGroups([]); setPhase("idle"); };

  /* ── webPath → base64 (2-side landscape page split আগের মতোই) ── */
  const toBase64=async(img)=>{
    if(img.base64)return img.base64;
    return new Promise((res,rej)=>{
      const canvas=document.createElement("canvas");
      const image=new Image();
      image.onload=()=>{
        const W=image.naturalWidth, H=image.naturalHeight;
        if(W>H*1.4){
          const half=Math.floor(W/2);
          canvas.width=half; canvas.height=H;
          const ctx=canvas.getContext("2d");
          ctx.drawImage(image,0,0,half,H,0,0,half,H);
          const left=canvas.toDataURL("image/jpeg",0.9).split(",")[1];
          ctx.clearRect(0,0,half,H);
          ctx.drawImage(image,half,0,W-half,H,0,0,W-half,H);
          canvas.width=W-half;
          const right=canvas.toDataURL("image/jpeg",0.9).split(",")[1];
          res([left,right]);
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

  /* ── Native ML Kit OCR (শুধু raw text — parse এখানে AI দিয়ে হবে) ── */
  const nativeOcr=async(b64)=>{
    const{OcrPlugin}=window.Capacitor?.Plugins||{};
    if(!OcrPlugin){
      const available=Object.keys(window.Capacitor?.Plugins||{}).join(", ")||"(none)";
      _LC.crash("OcrPlugin",`OcrPlugin missing. Available: ${available}`,{available});
      throw new Error("OcrPlugin নেই — APK rebuild করুন");
    }
    const res=await OcrPlugin.recognizeText({base64:b64});
    return res.text||"";
  };

  /* ── একটা page-unit (base64) প্রসেস করে {designation,institution,entries} রিটার্ন করে, ক্যাশসহ ──
     ক্যাশ base64+CACHE_QTYPE দিয়ে key হয় — grouping বদলালেও (✂️ টগল) একই ছবি আবার AI call করতে হয় না */
  const detectAndParsePage=async(b64)=>{
    const cached=getOcrCacheEntry(b64,CACHE_QTYPE);
    if(cached){
      _LC.log("MultiSubjectImport","📦 ক্যাশ হিট — AI call এড়ানো হলো");
      return cached.detected;
    }
    const raw=await nativeOcr(b64);
    if(!raw.trim()) return{designation:"",institution:"",entries:[]};
    const aiText=await callAiProviderRotatingRaw(buildDetectPrompt(raw));
    const detected=parseDetectResponse(aiText);
    setOcrCacheEntry(b64,CACHE_QTYPE,{raw,detected});
    if(detected.entries.length){
      archiveAdd({
        source:SRC_NAME,subject:detected.designation,subtopic:detected.institution,qtype:"Written",
        rows:detected.entries.map(e=>({q:e.q,correct:e.a}))
      });
    }
    return detected;
  };

  /* ── ধাপ ১: সব ছবি OCR+Detect+Parse করে draftGroups বানায় — কোনো সাবমিট হয় না, শুধু Confirm স্ক্রিনে নিয়ে যায় ── */
  const processImages=async()=>{
    if(!images.length){push("warn","ছবি যোগ করুন","");return;}
    if(!buildKeyPool().length){push("warn","⚠️ কোনো AI provider active নেই","⚙️ থেকে অন্তত একটা key active করো");return;}
    setPhase("processing"); stopRef.current=false; setResult(null); setDraftGroups([]);
    setImages(p=>p.map(x=>({...x,status:"pending",designation:"",institution:"",entryCount:0,error:""})));

    // ── প্রতিটা ছবিকে base64 unit-এ ভাঙা হয় (landscape হলে ২টা পাতা); manual group-break শুধু ছবির প্রথম unit-এ প্রযোজ্য ──
    const units=[]; // {imgId, base64, isImgFirstPart, manualBreak}
    for(const img of images){
      try{
        const b64raw=await toBase64(img);
        const parts=Array.isArray(b64raw)?b64raw:[b64raw];
        parts.forEach((p,pi)=>units.push({imgId:img.id,base64:p,manualBreak:pi===0&&img.groupBreak}));
      }catch(e){
        setImages(p=>p.map(x=>x.id===img.id?{...x,status:"error",error:e.message}:x));
      }
    }
    const imgIndexOf={}; images.forEach((im,idx)=>{imgIndexOf[im.id]=idx+1;});

    let curSubject="", curSubtopic="";
    let gid=-1;
    const groups=[]; // local working array
    setProgress({cur:0,total:units.length});

    for(let i=0;i<units.length;i++){
      if(stopRef.current)break;
      const unit=units[i];
      setProgress({cur:i+1,total:units.length});
      // group boundary: প্রথম unit সবসময় নতুন group, বা ইউজার-মার্কড manualBreak
      if(gid===-1||unit.manualBreak){
        gid++;
        curSubject=""; curSubtopic="";
        groups.push({id:gid,subject:"",subtopic:"",rows:[],pages:[],included:true});
      }
      setImages(p=>p.map(x=>x.id===unit.imgId&&x.status!=="error"?{...x,status:"running"}:x));
      try{
        const detected=await detectAndParsePage(unit.base64);
        if(detected.designation) curSubject=detected.designation;
        if(detected.institution) curSubtopic=detected.institution;
        const grp=groups[gid];
        if(!grp.subject&&curSubject) grp.subject=curSubject;
        if(!grp.subtopic&&curSubtopic) grp.subtopic=curSubtopic;
        detected.entries.forEach(e=>grp.rows.push({q:e.q,correct:e.a}));
        const pageNo=imgIndexOf[unit.imgId];
        if(pageNo&&!grp.pages.includes(pageNo)) grp.pages.push(pageNo);

        setImages(p=>p.map(x=>x.id===unit.imgId?{
          ...x,status:"done",
          designation:x.designation||curSubject, institution:x.institution||curSubtopic,
          entryCount:(x.entryCount||0)+detected.entries.length,
        }:x));
      }catch(e){
        setImages(p=>p.map(x=>x.id===unit.imgId?{...x,status:"error",error:e.message}:x));
        _LC.warn("MultiSubjectImport",`Page detect/parse ব্যর্থ: ${e.message}`);
      }
    }

    const nonEmpty=groups.filter(g=>g.rows.length>0);
    if(!nonEmpty.length){
      setPhase("idle");
      push("warn","⚠️ কোনো প্রশ্ন পাওয়া যায়নি","ছবিগুলো ঠিকভাবে তোলা হয়েছে কিনা, বা AI key active আছে কিনা দেখুন");
      return;
    }
    setDraftGroups(nonEmpty);
    setPhase("confirm");
  };

  /* ── Confirm স্ক্রিনে group edit/exclude ── */
  const updateGroupField=(id,field,val)=>setDraftGroups(p=>p.map(g=>g.id===id?{...g,[field]:val}:g));
  const toggleGroupIncluded=(id)=>setDraftGroups(p=>p.map(g=>g.id===id?{...g,included:!g.included}:g));

  /* ── ধাপ ২: Confirm করার পর — সব included group একসাথে Sheet/Firebase-এ Submit ── */
  const confirmAndSubmit=async()=>{
    const included=draftGroups.filter(g=>g.included&&g.rows.length>0);
    if(!included.length){push("warn","⚠️ অন্তত একটা group রাখো","সব group বাদ দিলে সাবমিট করার কিছু নেই");return;}
    setSubmitting(true);
    const allRows=[];
    included.forEach(g=>{
      const subject=(g.subject||"").trim()||"(অজানা বিষয়)";
      const subtopic=(g.subtopic||"").trim()||subject;
      g.rows.forEach(r=>allRows.push({q:r.q,correct:r.correct,subject,subtopic}));
    });

    if(saveLoc==="sheet"){
      const rows=allRows.map(item=>buildSheetRow({
        item:{q:item.q,correct:item.correct,explanation:""},
        subject:item.subject,subtopic:item.subtopic,qtype:"Written",audienceTags:[]
      }));
      const res=await saveRowsToSheet({rows,targetTab:targetMode,gasSecret,push});
      if(res.failedRows.length) pushFailedItems(SRC_NAME,"sheet",targetMode,res.failedRows);
      setResult({added:res.added,skipped:res.skipped,failed:res.failedRows.length,groupCount:included.length});
      setSubmitting(false); setPhase("done");
      if(res.added>0) push("success",`✅ ${res.added}টি Sheet-এ যোগ হয়েছে!`,
        `${included.length}টি subject/sub-topic গ্রুপ`+(res.skipped?`, ${res.skipped}টা duplicate বাদ পড়েছে`:""));
      if(res.failedRows.length) push("error",`${res.failedRows.length}টি ব্যর্থ হয়েছে`,"নিচে ক্যাশ থেকে আবার পাঠানো যাবে");
      return;
    }

    let sent=0,failed=0; const failedRecs=[];
    const BATCH=8;
    for(let i=0;i<allRows.length;i+=BATCH){
      const batch=allRows.slice(i,i+BATCH);
      await Promise.all(batch.map(async(item)=>{
        const ts=nowTs();
        const id=Date.now()+Math.floor(Math.random()*9999);
        const rec=buildBulkRecord({
          item:{q:item.q,correct:item.correct,explanation:""},
          subject:item.subject,subtopic:item.subtopic,mode:targetMode,qtype:"Written",
          audienceTags:[],ts,id
        });
        try{
          const res=await fbPush(targetMode,rec);
          if(res?.name) await fbSet(`${targetMode}/${res.name}/id`,res.name);
          sent++;
        }catch(e){ failed++; failedRecs.push(rec); }
      }));
    }
    if(failedRecs.length) pushFailedItems(SRC_NAME,"firebase",targetMode,failedRecs);
    setResult({added:sent,skipped:0,failed,groupCount:included.length});
    setSubmitting(false); setPhase("done");
    if(sent>0) push("success",`✅ ${sent}টি সরাসরি যোগ হয়েছে!`,`${included.length}টি subject/sub-topic গ্রুপ`);
    if(failed>0) push("error",`${failed}টি ব্যর্থ হয়েছে`,"নিচে ক্যাশ থেকে আবার পাঠানো যাবে");
  };

  const backToEdit=()=>{ setPhase("idle"); }; // ছবি/গ্রুপ-ব্রেক ঠিক করে আবার Process করা যাবে — cache থাকায় দ্রুত হবে
  const startOver=()=>{ setImages([]); setDraftGroups([]); setResult(null); setPhase("idle"); };

  const pct=progress.total?Math.round(progress.cur/progress.total*100):0;
  const totalIncludedQ=draftGroups.filter(g=>g.included).reduce((s,g)=>s+g.rows.length,0);
  const totalIncludedG=draftGroups.filter(g=>g.included).length;

  return(
    <div className="page">
      {/* Header */}
      <div style={{background:"linear-gradient(135deg,#0891b2,#4f46e5)",borderRadius:14,padding:"14px 16px",marginBottom:14,color:"#fff",position:"relative"}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
          <div>
            <div style={{fontWeight:900,fontSize:15,marginBottom:2}}>🗂️ Multi-Subject Bulk Import (Written)</div>
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
      {showApiSettings&&<ApiSettingsPage push={push} inline={true}/>}

      {/* ── Long-press zoom preview overlay — হেডিং পড়ার জন্য বড় করে দেখায়, ছেড়ে দিলে ফেড-আউট ── */}
      {previewId&&(()=>{
        const pimg=images.find(x=>x.id===previewId);
        const src=pimg&&(pimg.webPath||(pimg.base64?`data:image/jpeg;base64,${pimg.base64}`:null));
        if(!src)return null;
        return(
          <div style={{position:"fixed",inset:0,zIndex:999,background:"rgba(0,0,0,0.85)",
            display:"flex",alignItems:"center",justifyContent:"center",padding:16,
            opacity:previewVisible?1:0,transition:"opacity 200ms ease",pointerEvents:"none"}}>
            <img src={src} draggable={false} style={{maxWidth:"92vw",maxHeight:"85vh",borderRadius:12,
              border:"3px solid #f59e0b",boxShadow:"0 8px 30px rgba(0,0,0,0.6)",
              transform:previewVisible?"scale(1)":"scale(0.92)",transition:"transform 200ms ease"}}/>
          </div>
        );
      })()}

      {/* ══════════ CONFIRM PHASE ══════════ */}
      {phase==="confirm"&&(
        <>
          <div style={{background:"#0a1628",border:`1px solid ${C.border}`,borderRadius:10,padding:"8px 12px",fontSize:11,color:C.muted,marginBottom:12,lineHeight:1.7}}>
            <div style={{color:C.text,fontWeight:700,marginBottom:3}}>🔎 এক নজরে দেখে নাও — সব ঠিক থাকলে Confirm করো</div>
            <div>নিচে {draftGroups.length}টা group পাওয়া গেছে। Subject/Sub-topic ভুল বা ফাঁকা থাকলে ঠিক করে দাও, ভুল group হলে বাদ দাও (❌)।</div>
          </div>
          {draftGroups.map(g=>{
            const isEmpty=!g.subject.trim();
            return(
              <div key={g.id} style={{background:g.included?C.panel:"#1a1a1a",opacity:g.included?1:.5,
                border:`1px solid ${isEmpty&&g.included?"#f59e0b":C.border}`,borderRadius:12,padding:"10px 14px",marginBottom:10}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
                  <span style={{fontSize:11,fontWeight:800,color:C.muted}}>পাতা {g.pages.join(", ")} · {g.rows.length}টি প্রশ্ন</span>
                  <button onClick={()=>toggleGroupIncluded(g.id)}
                    style={{fontSize:11,fontWeight:700,padding:"3px 10px",borderRadius:20,cursor:"pointer",
                      border:`1px solid ${g.included?"#22c55e":"#ef4444"}`,
                      background:g.included?"#052e16":"#2a0a0a",
                      color:g.included?"#22c55e":"#ef4444"}}>
                    {g.included?"✅ রাখা হবে":"❌ বাদ"}
                  </button>
                </div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
                  <div className="fld" style={{marginBottom:0}}>
                    <label>📚 Subject{isEmpty&&<span style={{color:"#f59e0b"}}> ⚠️ খালি</span>}</label>
                    <input className="inp" value={g.subject} onChange={e=>updateGroupField(g.id,"subject",e.target.value)} placeholder="Subject লিখুন..."/>
                  </div>
                  <div className="fld" style={{marginBottom:0}}>
                    <label>📌 Sub-topic</label>
                    <input className="inp" value={g.subtopic} onChange={e=>updateGroupField(g.id,"subtopic",e.target.value)} placeholder="Sub-topic লিখুন..."/>
                  </div>
                </div>
              </div>
            );
          })}
          <div style={{background:C.panel,border:`1px solid ${C.border}`,borderRadius:12,padding:"10px 14px",marginBottom:12,display:"flex",justifyContent:"space-between",fontSize:12}}>
            <span style={{color:C.text,fontWeight:700}}>মোট Submit হবে</span>
            <span style={{color:"#10b981",fontWeight:900}}>{totalIncludedQ}টি প্রশ্ন · {totalIncludedG}টি group</span>
          </div>
          <div style={{display:"flex",flexDirection:"column",gap:8,marginBottom:12}}>
            <button className="btn bp bb" disabled={submitting||!totalIncludedG} onClick={confirmAndSubmit} style={{justifyContent:"center"}}>
              {submitting?"⏳ Submit হচ্ছে...":`✅ Confirm করে Submit করো (${targetMode} → ${saveLoc==="sheet"?"Sheet":"Firebase"})`}
            </button>
            <button className="btn" disabled={submitting} onClick={backToEdit}
              style={{justifyContent:"center",background:"transparent",color:C.muted,borderColor:C.border,fontSize:11}}>
              ↩️ বাতিল করে ছবি/গ্রুপ আবার ঠিক করি (ক্যাশ থাকায় আবার Process করলে দ্রুত হবে)
            </button>
          </div>
        </>
      )}

      {/* ══════════ IDLE / PROCESSING PHASE ══════════ */}
      {phase!=="confirm"&&(
        <>
          {/* Info box */}
          <div style={{background:"#0a1628",border:`1px solid ${C.border}`,borderRadius:10,padding:"8px 12px",fontSize:11,color:C.muted,marginBottom:12,lineHeight:1.7}}>
            <div style={{color:C.text,fontWeight:700,marginBottom:3}}>📋 ব্যবহার পদ্ধতি:</div>
            <div>① একাধিক subject/sub-topic মিশ্রিত ছবি একসাথে যোগ করুন — <b>পাতা নম্বর অনুযায়ী ক্রমে</b></div>
            <div>② যেখানে যেখানে পেপার পাল্টাচ্ছে, সেই ছবিতে <b style={{color:"#f59e0b"}}>✂️ নতুন Group</b> ট্যাপ করে মার্ক করো</div>
            <div>③ <b style={{color:"#22d3ee"}}>Target Sheet</b> ও <b style={{color:"#22d3ee"}}>Save Location</b> বেছে <b style={{color:"#6366f1"}}>Process</b> করো</div>
            <div>④ শেষে ছোট একটা <b style={{color:"#10b981"}}>Group Confirm</b> লিস্ট দেখাবে — চেক করে এক-ট্যাপে Submit করো</div>
            <div style={{color:"#f59e0b"}}>⚠️ শুধু Written টাইপের জন্য — MCQ/Study এখানে সাপোর্টেড না</div>
          </div>

          {/* Target Sheet + Save Location */}
          <div style={{background:C.panel,border:`1px solid ${C.border}`,borderRadius:12,padding:"10px 14px",marginBottom:12}}>
            <div style={{fontSize:11,fontWeight:800,color:C.text,marginBottom:8}}>🎯 Target Sheet</div>
            <div style={{display:"flex",gap:6,marginBottom:10}}>
              {["Quiz","QBank"].map(m=>(
                <button key={m} type="button" disabled={phase==="processing"} onClick={()=>setTargetMode(m)}
                  style={{flex:1,fontSize:12,fontWeight:700,padding:"7px 0",borderRadius:8,cursor:"pointer",
                    border:`1px solid ${targetMode===m?C.accent:C.border}`,
                    background:targetMode===m?C.accent+"22":"transparent",
                    color:targetMode===m?C.accent:C.muted}}>{m}</button>
              ))}
            </div>
            <SaveLocationPicker value={saveLoc} onChange={setSaveLocP} gasSecret={gasSecret} onGasSecretChange={setGasSecretP}/>
          </div>

          {/* Image Picker Buttons */}
          <div style={{display:"flex",gap:8,marginBottom:12}}>
            <button className="btn bp bb" style={{flex:1}} disabled={phase==="processing"} onClick={pickGallery}>🖼 Gallery (একাধিক)</button>
            <button className="btn" style={{flex:1,background:"#1e293b",color:C.text,borderColor:C.border}} disabled={phase==="processing"} onClick={openCamera}>📷 Camera</button>
            {images.length>0&&phase!=="processing"&&<button className="btn" style={{background:"#7f1d1d",color:"#fca5a5",borderColor:"#991b1b",padding:"0 12px"}} onClick={clearAll}>🗑</button>}
          </div>

          {/* Image Grid — reorder + manual group-break + status + detected subject/subtopic */}
          {images.length>0&&(
            <div style={{display:"flex",flexWrap:"wrap",gap:8,marginBottom:12}}>
              {images.map((img,i)=>(
                <div key={img.id} style={{position:"relative",width:84,
                  ...(img.groupBreak?{background:"#f59e0b18",borderRadius:12,padding:4,marginLeft:2}:{})}}>
                  <div style={{position:"relative",width:76,height:76}}>
                    {img.webPath?(
                      <img src={img.webPath} draggable={false}
                        onContextMenu={e=>e.preventDefault()}
                        onTouchStart={()=>startLongPress(img.id)}
                        onTouchEnd={cancelLongPress}
                        onTouchCancel={cancelLongPress}
                        onMouseDown={()=>startLongPress(img.id)}
                        onMouseUp={cancelLongPress}
                        onMouseLeave={cancelLongPress}
                        style={{width:76,height:76,borderRadius:10,objectFit:"cover",
                        WebkitTouchCallout:"none",WebkitUserSelect:"none",userSelect:"none",touchAction:"none",
                        border:`2px solid ${img.status==="done"?"#10b981":img.status==="error"?"#ef4444":img.status==="running"?"#6366f1":img.groupBreak?"#f59e0b":C.border}`}}/>
                    ):(
                      <div style={{width:76,height:76,borderRadius:10,background:C.panel,border:`2px solid ${C.border}`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:20}}>📷</div>
                    )}
                    <div style={{position:"absolute",bottom:2,left:2,right:2,textAlign:"center",fontSize:9,fontWeight:800,
                      color:img.status==="done"?"#10b981":img.status==="error"?"#ef4444":img.status==="running"?"#818cf8":"#94a3b8"}}>
                      {img.status==="done"?`✔ #${i+1}`:img.status==="error"?`✗ #${i+1}`:img.status==="running"?"⏳":`#${i+1}`}
                    </div>
                    {phase!=="processing"&&(
                      <div onClick={()=>removeImg(img.id)} style={{position:"absolute",top:-6,right:-6,background:"#ef4444",color:"#fff",borderRadius:999,width:18,height:18,display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,cursor:"pointer",fontWeight:900}}>×</div>
                    )}
                    {phase!=="processing"&&(
                      <div style={{position:"absolute",top:-6,left:-6,display:"flex",flexDirection:"column",gap:2}}>
                        <div onClick={()=>moveImg(img.id,-1)} style={{background:"#1e293b",color:"#fff",borderRadius:999,width:16,height:16,display:"flex",alignItems:"center",justifyContent:"center",fontSize:9,cursor:"pointer",border:`1px solid ${C.border}`}}>↑</div>
                        <div onClick={()=>moveImg(img.id,1)} style={{background:"#1e293b",color:"#fff",borderRadius:999,width:16,height:16,display:"flex",alignItems:"center",justifyContent:"center",fontSize:9,cursor:"pointer",border:`1px solid ${C.border}`}}>↓</div>
                      </div>
                    )}
                  </div>
                  {/* Manual group-break toggle — প্রথম ছবি বাদে সবগুলোতে */}
                  {i>0&&phase!=="processing"&&(
                    <div onClick={()=>toggleGroupBreak(img.id)}
                      style={{marginTop:2,fontSize:8,fontWeight:800,textAlign:"center",padding:"2px 0",borderRadius:6,cursor:"pointer",
                        background:img.groupBreak?"#f59e0b":"transparent",
                        color:img.groupBreak?"#1a1200":C.muted,
                        border:`1px solid ${img.groupBreak?"#f59e0b":C.border}`}}>
                      {img.groupBreak?"✂️ নতুন Group":"চলমান"}
                    </div>
                  )}
                  {i===0&&<div style={{marginTop:2,fontSize:8,fontWeight:800,textAlign:"center",color:C.muted}}>1️⃣ Group শুরু</div>}
                  {img.status==="done"&&(
                    <div style={{fontSize:9,color:"#10b981",marginTop:2,textAlign:"center",lineHeight:1.3,wordBreak:"break-word"}}>
                      {img.designation||"—"}<br/>
                      <span style={{color:C.muted}}>{img.entryCount} প্রশ্ন</span>
                    </div>
                  )}
                  {img.status==="error"&&(
                    <div style={{fontSize:9,color:"#ef4444",marginTop:2,textAlign:"center",lineHeight:1.3,wordBreak:"break-word"}}>{img.error}</div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Progress */}
          {phase==="processing"&&(
            <div style={{background:C.panel,border:`1px solid ${C.border}`,borderRadius:12,padding:"10px 14px",marginBottom:12}}>
              <div style={{display:"flex",justifyContent:"space-between",fontSize:11,marginBottom:6}}>
                <span style={{color:C.text,fontWeight:700}}>⏳ Detect + Parse চলছে...</span>
                <span style={{color:"#6366f1",fontWeight:900}}>{pct}% ({progress.cur}/{progress.total})</span>
              </div>
              <div style={{background:C.border,borderRadius:999,height:8,overflow:"hidden"}}>
                <div style={{height:"100%",width:`${pct}%`,background:"linear-gradient(90deg,#6366f1,#10b981)",borderRadius:999,transition:"width .3s"}}/>
              </div>
            </div>
          )}

          {/* Result summary (Submit শেষে) */}
          {result&&phase==="done"&&(
            <div style={{background:"#052e16",border:"1px solid #10b98144",borderRadius:12,padding:"10px 14px",marginBottom:12}}>
              <div style={{fontSize:12,fontWeight:800,color:"#10b981",marginBottom:6}}>✅ Submit সম্পন্ন</div>
              <div style={{fontSize:11,color:C.text}}>যোগ হয়েছে: <b style={{color:"#10b981"}}>{result.added}</b>{result.skipped>0&&<> · duplicate বাদ: <b>{result.skipped}</b></>}{result.failed>0&&<> · ব্যর্থ: <b style={{color:"#ef4444"}}>{result.failed}</b></>}</div>
              <div style={{fontSize:11,color:C.muted,marginTop:2}}>{result.groupCount}টি subject/sub-topic গ্রুপ — {targetMode} ({saveLoc==="sheet"?"Sheet":"Firebase"})</div>
              <button className="btn" onClick={startOver} style={{marginTop:8,justifyContent:"center",width:"100%",fontSize:11,background:"transparent",color:C.muted,borderColor:C.border}}>🔄 নতুন ব্যাচ শুরু করো</button>
            </div>
          )}

          {/* Action Buttons */}
          <div style={{display:"flex",flexDirection:"column",gap:8}}>
            <button className="btn bp bb" disabled={phase==="processing"||!images.length} onClick={processImages} style={{justifyContent:"center"}}>
              {phase==="processing"?(
                <span>⏳ প্রসেস হচ্ছে... {progress.cur}/{progress.total}</span>
              ):(
                <span>🔍 Detect করো ({images.length}টা ছবি)</span>
              )}
            </button>
            {phase==="processing"&&(
              <button className="btn" style={{background:"#7f1d1d",color:"#fca5a5",borderColor:"#991b1b",justifyContent:"center"}}
                onClick={()=>stopRef.current=true}>⛔ বন্ধ করুন</button>
            )}
            <FailedQueuePanel push={push} sourceFilter={SRC_NAME}/>
          </div>
        </>
      )}
    </div>
  );
}

export { MultiSubjectImportPage };
