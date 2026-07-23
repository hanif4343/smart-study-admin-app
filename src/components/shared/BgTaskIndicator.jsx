/* ══════════ BG TASK INDICATOR ══════════ */
import React from "react";
import { useBGM } from "../../core/bgTasks.js";

function BgTaskIndicator() {
  const { pending, active, done, failed, running } = useBGM();
  const total = pending + active;
  if (total === 0 && !running) return null;
  const isPulsing = running || active > 0;
  return (
    <div style={{
      position:"fixed", top:56, right:10, zIndex:9999,
      background: failed > 0 ? "#ef444422" : "#3b82f622",
      border:"1px solid " + (failed > 0 ? "#ef4444aa" : "#3b82f6aa"),
      borderRadius:20, padding:"4px 10px",
      display:"flex", alignItems:"center", gap:6,
      fontSize:10, fontWeight:700, color: failed > 0 ? "#ef4444" : "#3b82f6",
      backdropFilter:"blur(6px)",
      animation: isPulsing ? "bgm-pulse 1.4s ease-in-out infinite" : "none",
      pointerEvents:"none",
    }}>
      <span style={{
        width:7, height:7, borderRadius:"50%",
        background: failed>0 ? "#ef4444" : "#3b82f6",
        display:"inline-block",
        animation: isPulsing ? "bgm-dot 1.4s ease-in-out infinite" : "none",
      }}/>
      {running || active > 0
        ? "⚙️ " + (pending + active) + "টি কাজ চলছে…"
        : "⏳ " + pending + "টি অপেক্ষায়"}
      {failed > 0 && <span style={{color:"#ef4444"}}>{"⚠️"}{failed}</span>}
    </div>
  );
}

export { BgTaskIndicator };
