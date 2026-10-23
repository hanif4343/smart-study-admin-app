/* ══════════ টাইপিং-কভার — প্রশ্ন/উত্তর ঘরে টাইপ শুরু করলে কালো আবরণ, শেষ কী-স্ট্রোকের ৩ সেকেন্ড পর সরে যায় ══════════
   নিয়ম:
   • পেজ খোলার সময় সব ঘর স্বাভাবিক। ঘরে প্রথম অক্ষর টাইপ করলেই শুধু সেই ঘরে কালো আবরণ আসে।
   • টাইপ চলতে থাকলে আবরণ থাকে; শেষ টাইপের ৩ সেকেন্ড পর সরে যায় (প্রতিটা নতুন অক্ষরে ৩ সেকেন্ড আবার শুরু)।
   • একবার সরে গেলে সংশোধনের সময় আর ফেরে না (ঘরটা ফাঁকা হয়ে নতুন প্রশ্নে গেলে — যেমন সেভের পর — আবার নতুন করে কাজ করে)।
   • আগে থেকে লেখা (ড্রাফট/লোড) থাকলে সেটা "সংশোধন" ধরা হয় — আবরণ আসে না।
   • 🆕 চালু/বন্ধ টগল (<CoverToggle/>) — ডিফল্ট চালু; পছন্দ ফোনে মনে থাকে (localStorage), সব ঘরে একসাথে কাজ করে।
   • আবরণ pointer-events:none — নিচের ঘরে ক্লিক/ক্যারেট ঠিকই কাজ করে, শুধু লেখা দেখা যায় না। */
import React, { useEffect, useRef, useState } from "react";

export const COVER_DELAY_MS = 3000;

/* ── চালু/বন্ধ সেটিং (ডিফল্ট চালু) ── */
const LS_KEY = "typing_cover_enabled_v1";
const listeners = new Set();
export function getCoverEnabled() { try { return localStorage.getItem(LS_KEY) !== "0"; } catch { return true; } }
export function setCoverEnabled(on) { try { localStorage.setItem(LS_KEY, on ? "1" : "0"); } catch {} listeners.forEach((f) => f(!!on)); }
export function useCoverEnabled() {
  const [on, setOn] = useState(getCoverEnabled);
  useEffect(() => { listeners.add(setOn); return () => { listeners.delete(setOn); }; }, []);
  return on;
}

export function createCoverMachine(delay, onCover) {
  let done = false, timer = null, covered = false, lastTyped = null, enabled = true;
  const set = (v) => { if (covered !== v) { covered = v; onCover(v); } };
  const clear = () => { if (timer) { clearTimeout(timer); timer = null; } };
  return {
    setEnabled(b) { enabled = !!b; if (!enabled) { clear(); set(false); } },
    typed(val) {                       // ব্যবহারকারী নিজে টাইপ/পেস্ট করল
      lastTyped = val;
      if (done || !enabled) return;
      clear();
      if (val === "") { set(false); return; }
      set(true);
      timer = setTimeout(() => { timer = null; done = true; set(false); }, delay);
    },
    external(val) {                    // কোড থেকে মান বদলাল (ড্রাফট লোড, সেভের পর রিসেট, ফরম্যাট-শর্টকাট…)
      if (val === lastTyped) return;   // এটা আসলে নিজের টাইপ করা মানেরই রিফ্লেকশন
      lastTyped = null;
      if (val === "") { clear(); done = false; set(false); }
      else if (!covered) done = true;  // আগে থেকে লেখা আছে → সংশোধন-মোড, আবরণ নয়
    },
    dispose() { clear(); },
  };
}

export function useTypingCover(value, delay = COVER_DELAY_MS) {
  const [covered, setCovered] = useState(false);
  const mRef = useRef(null);
  if (!mRef.current) mRef.current = createCoverMachine(delay, setCovered);
  const enabled = useCoverEnabled();
  mRef.current.setEnabled(enabled);
  useEffect(() => { mRef.current.external(String(value == null ? "" : value)); }, [value]);
  useEffect(() => () => mRef.current && mRef.current.dispose(), []);
  return { covered, onTyped: (v) => mRef.current.typed(String(v == null ? "" : v)) };
}

export function CoverOverlay({ covered, radius = 8 }) {
  return (
    <div aria-hidden="true" data-typing-cover={covered ? "on" : "off"} style={{ position: "absolute", inset: 0, background: "#000", borderRadius: radius, pointerEvents: "none", zIndex: 5,
      opacity: covered ? 1 : 0, transition: "opacity .12s", visibility: covered ? "visible" : "hidden" }} />
  );
}

/* চালু/বন্ধ টগল বাটন — style দিয়ে থিম মেলানো যায় */
export function CoverToggle({ style, color = "#888", activeColor = "#16a34a" }) {
  const on = useCoverEnabled();
  return (
    <button type="button" tabIndex={-1} onClick={() => setCoverEnabled(!on)}
      title="টাইপ করার সময় প্রশ্ন/উত্তর ঘর ৩ সেকেন্ড কালো আবরণে ঢাকা থাকে — এখান থেকে চালু/বন্ধ করো"
      style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "transparent", border: `1px solid ${on ? activeColor : color}`, color: on ? activeColor : color,
        borderRadius: 20, fontSize: 10.5, fontWeight: 700, padding: "3px 10px", cursor: "pointer", ...style }}>
      <span style={{ width: 22, height: 12, borderRadius: 8, background: on ? activeColor : "#9ca3af", position: "relative", display: "inline-block", transition: "background .15s" }}>
        <span style={{ position: "absolute", top: 1, left: on ? 11 : 1, width: 10, height: 10, borderRadius: "50%", background: "#fff", transition: "left .15s" }} />
      </span>
      🕶 টাইপিং কভার: {on ? "চালু" : "বন্ধ"}
    </button>
  );
}
