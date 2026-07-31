/* ══════════ LAUNCHER GRID ══════════
   একটা শেয়ার্ড "app-launcher" স্টাইল টাইল-গ্রিড — কয়েকটা কালার-কোডেড সেকশনে
   ভাগ করা টুলের তালিকা দেখায়। Uploader hub (App.jsx, Phase ৪) আর Content
   Manager-এর Tools শিট (Phase ৫) — দুটোই এই একই কম্পোনেন্ট ব্যবহার করবে,
   যাতে "ট্যাব-ভেতরে-ট্যাব" প্যাটার্নটা পুরো অ্যাপে বারবার আলাদাভাবে
   copy-paste না হয়ে একটাই জায়গা থেকে আসে।

   props:
     sections: [{ key, title, color, items:[{page,icon,label,desc}] }]
     onSelect: (page)=>void  — কোনো টাইলে ট্যাপ করলে কল হয়
*/
import React from "react";

function LauncherGrid({sections,onSelect}){
  return(
    <div>
      {sections.map(sec=>(
        <div key={sec.key} className="launch-sec">
          <div className="launch-sec-head">
            <div className="launch-sec-bar" style={{background:sec.color}}/>
            <div className="launch-sec-title">{sec.title}</div>
            <div className="launch-sec-sub">{sec.items.length}টি টুল</div>
          </div>
          <div className="tile-grid">
            {sec.items.map(it=>(
              <button key={it.page} className="tile" onClick={()=>onSelect(it.page)}>
                <div className="tico" style={{background:sec.color+"22",color:sec.color}}>{it.icon}</div>
                <div className="tname">{it.label}</div>
                {it.desc&&<div className="tdesc">{it.desc}</div>}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export { LauncherGrid };
