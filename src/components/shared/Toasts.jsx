/* ══════════ TOAST DISPLAY ══════════ */
import React from "react";

function Toasts({t}){return(
  <div className="toasts">
    {t.map(x=>(
      <div key={x.id} className={`toast ${x.type}`}>
        <div className="t-icon">{x.type==="success"?"✅":x.type==="error"?"❌":x.type==="warn"?"⚠️":"ℹ️"}</div>
        <div className="t-body"><div className="t-title">{x.title}</div>{x.msg&&<div className="t-msg">{x.msg}</div>}</div>
      </div>
    ))}
  </div>
);}


export { Toasts };
