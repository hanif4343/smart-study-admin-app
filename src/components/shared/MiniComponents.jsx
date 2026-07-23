/* ══════════ MINI COMPONENTS ══════════ */
import React, { useState, useCallback } from "react";
import { C } from "../../core/config.js";
import { pct } from "../../core/utils.js";

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

/* ── Tree: memoised, renders only when data changes ── */
const Tree = React.memo(function Tree({entries,total,color}){
  const[open,setO]=useState({});
  const tog=useCallback(k=>setO(p=>({...p,[k]:!p[k]})),[]);
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
});


export { Ring, Bar, Tree };
