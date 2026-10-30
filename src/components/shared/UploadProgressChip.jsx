/* ⏳ ব্যাকগ্রাউন্ড আপলোডের চলমান-বার — অ্যাপের যেকোনো পেজে নিচে (নেভিগেশনের ঠিক উপরে) দেখা যায়,
   যাতে বোঝা যায় প্রশ্নপত্র সত্যিই আপলোড হচ্ছে (ধাপের লেখা + গোনা সময় + প্রগতি-বার)। */
import React, { useEffect, useState } from "react";
import { subscribeJobs } from "../../core/uploadJobs.js";

const GREEN = "#16a34a", RED = "#dc2626", BLUE = "#2563eb";
const fmtSec = (ms) => { const s = Math.floor((ms || 0) / 1000); return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`; };

function UploadProgressChip() {
  const [jobs, setJobs] = useState([]);
  useEffect(() => subscribeJobs(setJobs), []);
  if (!jobs.length) return null;
  return (
    <div style={{ position: "fixed", left: 10, right: 10, bottom: "calc(78px + env(safe-area-inset-bottom, 0px))", zIndex: 940, display: "flex", flexDirection: "column", gap: 6, pointerEvents: "none" }}>
      {jobs.slice(-3).map((j) => {
        const done = !!j.finishedAt, ok = j.ok, col = done ? (ok ? GREEN : RED) : (j.slow ? "#d97706" : BLUE);
        return (
          <div key={j.id} style={{ pointerEvents: "auto", background: "var(--card, #fff)", color: "var(--text, #111)", border: `1.5px solid ${col}`, borderRadius: 12, padding: "9px 11px", boxShadow: "0 4px 18px rgba(0,0,0,.28)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, fontWeight: 800 }}>
              <span style={{ color: col, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {done ? (ok ? "✅ আপলোড সম্পন্ন" : "🔴 আপলোড ব্যর্থ") : "⏳ প্রশ্নপত্র আপলোড হচ্ছে"} · {j.total}টা প্রশ্ন
              </span>
              <span style={{ fontSize: 11, fontWeight: 700, color: col, whiteSpace: "nowrap" }}>⏱ {fmtSec(j.elapsedMs)}</span>
            </div>
            <div style={{ fontSize: 10.5, opacity: .8, margin: "2px 0 5px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {j.label}{!done && j.retry > 0 ? ` · রিট্রাই ${j.retry}` : ""}
            </div>
            <div style={{ height: 8, borderRadius: 6, background: "rgba(128,128,128,.25)", overflow: "hidden", position: "relative" }}>
              <div style={{ height: "100%", width: `${done ? 100 : Math.max(3, j.pct)}%`, background: col, borderRadius: 6, transition: "width .5s ease" }} />
              {!done && <div style={{ position: "absolute", inset: 0, background: "linear-gradient(90deg,transparent,rgba(255,255,255,.45),transparent)", backgroundSize: "60% 100%", backgroundRepeat: "no-repeat", animation: "ssUpShimmer 1.4s linear infinite" }} />}
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10.5, marginTop: 4, fontWeight: 600 }}>
              <span style={{ color: j.slow && !done ? "#d97706" : undefined }}>
                {done ? (j.message || j.stageText) : (j.slow ? "সার্ভার একটু ধীর — অপেক্ষা করছি, অ্যাপ বন্ধ কোরো না…" : j.stageText)}
              </span>
              <span>{done ? (ok ? "১০০%" : "লাল খসড়ায় আছে") : `প্রায় ${j.pct}%`}</span>
            </div>
          </div>
        );
      })}
      <style>{`@keyframes ssUpShimmer{0%{background-position:-60% 0}100%{background-position:160% 0}}`}</style>
    </div>
  );
}

export { UploadProgressChip };
