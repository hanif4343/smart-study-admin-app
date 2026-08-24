/* ══════════ CONTENT MANAGER (shell) ══════════
   Phase ৫ রিডিজাইন: আগে Browse/Rename/Audience/QType/Model Test/Delete — ৬টা সমান-ওজনের
   ট্যাব একলাইনে গুঁজে দেওয়া ছিল। এখন Browse-ই ডিফল্ট/প্রাইমারি ভিউ, বাকি টুলগুলো
   "Tools" বাটনে ট্যাপ করলে একটা লঞ্চার-গ্রিডে (Uploader hub-এর মতোই, একই শেয়ার্ড
   LauncherGrid কম্পোনেন্ট রিইউজ করে) দেখা যায়। Delete-কে আলাদা "বিপজ্জনক" সেকশনে
   রাখা হয়েছে যেহেতু এটাই একমাত্র destructive অ্যাকশন এখানে।
   db-migration-v2 থেকে যোগ হওয়া Reference ও Appearances টুল দুটোও এই একই গ্রিড-ডিজাইনে
   "edit" সেকশনে যোগ করা হয়েছে। নিচের সাব-কম্পোনেন্টগুলোর ভেতরের কোড ছোঁয়া হয়নি। */
import React, { useState, useCallback } from "react";
import { C } from "../core/config.js";
import { LauncherGrid } from "../components/shared/LauncherGrid.jsx";
import { BrowseTab } from "./content/BrowseTab.jsx";
import { RenameTab } from "./content/RenameTab.jsx";
import { AudienceTagRenameTab } from "./content/AudienceTagRenameTab.jsx";
import { ReferenceManagerTab } from "./content/ReferenceManagerTab.jsx";
import { ExamAppearancesTab } from "./content/ExamAppearancesTab.jsx";
import { BulkQTypeTab } from "./BulkQTypeTab.jsx";
import { DeleteTab } from "./content/DeleteTab.jsx";
import { PublishTab } from "./content/PublishTab.jsx";
import { ArchivePage } from "./ArchivePage.jsx";

/* 🐛 IA পুনর্গঠন: "Model Test" এখান থেকে সরিয়ে "তৈরি করুন" হাবে নেওয়া হলো (generative
   টুল, edit-tools-এর সাথে ভুল জায়গায় ছিল) — আর "Archive" এখানে যোগ হলো (আগে "তৈরি
   করুন"-এ ভুল জায়গায় ছিল, কারণ এটা "নতুন বানানো" না, "পুরনো জিনিস খোঁজা")। */
const CONTENT_TOOL_SECTIONS=[
  {key:"edit",title:"✏️ এডিট ও রেফারেন্স",color:C.info,items:[
    {page:"rename",      icon:"✏️",label:"Rename",      desc:"Subject/Sub-topic নাম পরিবর্তন"},
    {page:"reference",   icon:"🗂️",label:"Reference",   desc:"রেফারেন্স-এন্ট্রি ম্যানেজ করুন"},
    {page:"appearances", icon:"🎓",label:"Appearances",  desc:"পদ+প্রতিষ্ঠান+সাল অনুযায়ী প্রশ্নের appearance"},
    {page:"audience",    icon:"🎯",label:"Audience",     desc:"Audience ট্যাগ রিনেম"},
    {page:"qtype",       icon:"🏷️",label:"QType",       desc:"বাল্ক প্রশ্নের ধরন বদলান"},
  ]},
  {key:"archive",title:"🗄️ আর্কাইভ",color:"#a78bfa",items:[
    {page:"archive", icon:"🗄️",label:"Archive", desc:"সংরক্ষিত পুরনো OCR/AI কন্টেন্ট দেখুন"},
  ]},
  {key:"danger",title:"⚠️ বিপজ্জনক",color:C.danger,items:[
    {page:"delete", icon:"🗑️",label:"Delete", desc:"বাল্ক কনটেন্ট ডিলিট — সতর্কভাবে ব্যবহার করুন"},
  ]},
];
const TOOL_LABELS={
  rename:{icon:"✏️",label:"Rename"},
  reference:{icon:"🗂️",label:"Reference"},
  appearances:{icon:"🎓",label:"Appearances"},
  audience:{icon:"🎯",label:"Audience"},
  qtype:{icon:"🏷️",label:"QType"},
  archive:{icon:"🗄️",label:"Archive"},
  delete:{icon:"🗑️",label:"Delete"},
};

function ContentManagerPage({push,tick,pushLayer,onSendToBulk}){
  const[tab,setTab]=useState("browse"); // "browse" | "tools" | "cdn" | rename/reference/appearances/audience/qtype/modeltest/delete

  /* Browse → Tools: layer push করা হয় যাতে Android system-back চাপলে সরাসরি Browse-এ ফিরে যায় */
  const goTools=useCallback(()=>{
    setTab("tools");
    if(pushLayer){ const pop=pushLayer(()=>setTab("browse")); return pop; }
  },[pushLayer]);

  /* Browse → CDN: এটাও Tools-এর মতোই top-level, কিন্তু সরাসরি নিজের বাটন থেকে
     — Publish/Dirty-count/Orphan-count রোজকার কাজ, Tools-এর গ্রিডের ভিতরে
     ঢুকে খুঁজে বের করতে হবে না */
  const goCdn=useCallback(()=>{
    setTab("cdn");
    if(pushLayer){ const pop=pushLayer(()=>setTab("browse")); return pop; }
  },[pushLayer]);

  /* Tools grid → নির্দিষ্ট টুল: back করলে (system-back বা টপ-হেডারের ← বাটন) Tools গ্রিডেই ফেরত আসবে,
     সরাসরি Browse-এ চলে যাবে না — এটাই সেই ফিক্স যা Uploader hub-এও করা হয়েছিল (Phase ৪) */
  const goTool=useCallback((t)=>{
    setTab(t);
    if(pushLayer){ const pop=pushLayer(()=>setTab("tools")); return pop; }
  },[pushLayer]);

  return(
    <div className="page">

      {tab==="browse"&&(
        <>
          <div style={{display:"flex",justifyContent:"flex-end",gap:8,marginBottom:12}}>
            <button className="tools-btn" onClick={goCdn}>🚀 CDN</button>
            <button className="tools-btn" onClick={goTools}>🧰 Tools</button>
          </div>
          <BrowseTab push={push} tick={tick}/>
        </>
      )}

      {tab==="cdn"&&(
        <>
          <div className="sub-head">
            <button className="icon-btn" onClick={()=>setTab("browse")}>←</button>
            <div className="sub-head-title">🚀 CDN Publish</div>
          </div>
          <PublishTab push={push}/>
        </>
      )}

      {tab==="tools"&&(
        <>
          <div className="sub-head">
            <button className="icon-btn" onClick={()=>setTab("browse")}>←</button>
            <div className="sub-head-title">🧰 Content Tools</div>
          </div>
          <LauncherGrid sections={CONTENT_TOOL_SECTIONS} onSelect={goTool}/>
        </>
      )}

      {TOOL_LABELS[tab]&&(
        <>
          <div className="sub-head">
            <button className="icon-btn" onClick={()=>setTab("tools")}>←</button>
            <div className="sub-head-title">{TOOL_LABELS[tab].icon} {TOOL_LABELS[tab].label}</div>
          </div>
          {tab==="rename"      && <RenameTab push={push} tick={tick}/>}
          {tab==="reference"   && <ReferenceManagerTab push={push}/>}
          {tab==="appearances" && <ExamAppearancesTab push={push}/>}
          {tab==="audience"    && <AudienceTagRenameTab push={push} tick={tick}/>}
          {tab==="qtype"       && <BulkQTypeTab push={push} tick={tick}/>}
          {tab==="archive"     && <ArchivePage push={push} onSendToBulk={onSendToBulk}/>}
          {tab==="delete"      && <DeleteTab push={push} tick={tick}/>}
        </>
      )}

    </div>
  );
}

export { ContentManagerPage };