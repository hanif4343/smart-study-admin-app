/* ══════════ LAUNCHER GRID (redesign) ══════════
   একটা শেয়ার্ড "app-launcher" স্টাইল — কয়েকটা কালার-কোডেড সেকশনে ভাগ করা
   টুলের তালিকা দেখায়। "তৈরি করুন" hub (App.jsx) আর "ম্যানেজ করুন"-এর Tools
   শিট (ContentManagerPage.jsx) — দুটোই এই একই কম্পোনেন্ট ব্যবহার করে।

   🎨 রিডিজাইন (আগের 2-column আইকন-টাইল গ্রিড থেকে):
   - এখন single-column সারি, বাম পাশে সেকশনের রঙে একটা পাতলা বার — চোখ স্ক্যান
     করা সহজ, আইকন+নাম+description এক লাইনে একসাথে পড়া যায় (আগে description
     ছোট টাইলে গাদাগাদি হয়ে থাকত)
   - ওপরে একটা সার্চ বক্স যোগ হলো — "তৈরি করুন" হাবে ৯টা আর "ম্যানেজ করুন"-এ
     ৭টা টুল, নাম মনে না থাকলে টাইপ করে খোঁজা যায় (আগে এটা ছিলই না)

   props:
     sections: [{ key, title, color, items:[{page,icon,label,desc}] }]
     onSelect: (page)=>void  — কোনো row-এ ট্যাপ করলে কল হয়
*/
import React, { useState, useMemo } from "react";
import { tint } from "../../core/config.js";

function LauncherGrid({sections,onSelect}){
  const [q,setQ]=useState("");

  const filtered=useMemo(()=>{
    const needle=q.trim().toLowerCase();
    if(!needle)return sections;
    return sections
      .map(sec=>({...sec,items:sec.items.filter(it=>
        it.label.toLowerCase().includes(needle) || (it.desc||"").toLowerCase().includes(needle)
      )}))
      .filter(sec=>sec.items.length>0);
  },[sections,q]);

  const totalTools=sections.reduce((n,s)=>n+s.items.length,0);

  return(
    <div>
      <div className="launch-search">
        <span style={{opacity:.6}}>🔍</span>
        <input
          value={q}
          onChange={e=>setQ(e.target.value)}
          placeholder={`কোন টুল খুঁজছো? (মোট ${totalTools}টা)`}
        />
        {q&&<span className="launch-search-clear" onClick={()=>setQ("")}>✕</span>}
      </div>

      {filtered.length===0 && (
        <div className="launch-empty">😕 "{q}" নামে কোনো টুল পাওয়া যায়নি</div>
      )}

      {filtered.map(sec=>(
        <div key={sec.key} className="launch-sec">
          <div className="launch-sec-head">
            <div className="launch-sec-dot" style={{background:sec.color}}/>
            <div className="launch-sec-title">{sec.title}</div>
            <div className="launch-sec-sub">{sec.items.length}টি</div>
          </div>
          {sec.items.map(it=>(
            <button key={it.page} className="launch-row" style={{borderLeftColor:sec.color}} onClick={()=>onSelect(it.page)}>
              <div className="lr-ic" style={{background:tint(sec.color,"22"),color:sec.color}}>{it.icon}</div>
              <div className="lr-txt">
                <div className="lr-label">{it.label}</div>
                {it.desc&&<div className="lr-desc">{it.desc}</div>}
              </div>
              <div className="lr-chev">›</div>
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}

export { LauncherGrid };
