/* ══════════ ভাসমান টাইপিং ট্র্যাকার (সব পেজে) ══════════
   ছোট বাবল: আজকের WPM ও নির্ভুলতা। ট্যাপ করলে খোলে: বাংলা/ইংরেজি আলাদা — WPM, লক্ষ্য-বার, নির্ভুলতা, শব্দ, সংশোধিত অক্ষর, ৭ দিনের গ্রাফ, সাম্প্রতিক ভুল।
   বাবল টেনে সরানো যায় (জায়গা মনে থাকে)। */
import React, { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { C, tint } from "../../core/config.js";
import { useTypingStats, todayRec, lastDays, wpmOf, accOf, resetToday } from "../../core/typingStats.js";
import { isSpellEnabled, setSpellEnabled, subscribeSpell } from "../../core/spell/index.js";

const GOAL = 28;
const POS_KEY = "typing_bubble_pos_v1";
const bn = (n) => String(n).replace(/\d/g, (d) => "০১২৩৪৫৬৭৮৯"[d]);
const fmt = (x) => (x ? bn(Math.round(x)) : "—");
const pct = (x) => (x == null ? "—" : bn(Math.round(x * 100)) + "%");

export function TypingStatsBubble() {
  const st = useTypingStats();
  const [open, setOpen] = useState(false);
  const [lang, setLang] = useState("en");
  const [confirmReset, setConfirmReset] = useState(false);
  const [pos, setPos] = useState(() => { try { const p = JSON.parse(localStorage.getItem(POS_KEY) || "null"); if (p) return p; } catch {} return { right: 12, bottom: 96 }; });
  const drag = useRef(null);
  const spellOn = useSyncExternalStore(subscribeSpell, isSpellEnabled);

  const t = todayRec();
  const main = t.bn.chars > t.en.chars ? "bn" : "en";           // বাবলে যে ভাষায় বেশি টাইপ হয়েছে
  const mr = t[main], mw = wpmOf(mr), ma = accOf(mr);
  useEffect(() => { if (open) setLang(main); }, [open]); // eslint-disable-line

  const onDown = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    drag.current = { dx: e.clientX - r.left, dy: e.clientY - r.top, moved: false, x0: e.clientX, y0: e.clientY };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onMove = (e) => {
    const d = drag.current; if (!d) return;
    if (Math.abs(e.clientX - d.x0) + Math.abs(e.clientY - d.y0) > 6) d.moved = true;
    if (d.moved) setPos({ left: Math.max(4, Math.min(window.innerWidth - 90, e.clientX - d.dx)), top: Math.max(4, Math.min(window.innerHeight - 50, e.clientY - d.dy)) });
  };
  const onUp = () => { const d = drag.current; drag.current = null; if (d && d.moved) { try { localStorage.setItem(POS_KEY, JSON.stringify(pos)); } catch {} } else setOpen((o) => !o); };

  const r = t[lang], w = wpmOf(r), a = accOf(r), net = a != null && w ? w * a : 0;
  const days = lastDays(7), maxW = Math.max(GOAL, ...days.map((d) => wpmOf(d[lang])));
  const mist = st.mistakes.filter((m) => m.lang === lang).slice(-8).reverse();
  const L = { bn: "বাংলা", en: "English" };

  return (
    <>
      <div onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp}
        style={{ position: "fixed", ...pos, zIndex: 9000, touchAction: "none", userSelect: "none", cursor: "pointer", padding: "6px 11px", borderRadius: 22, fontSize: 12, fontWeight: 800,
          background: C.card, color: C.text, border: `1.5px solid ${mw >= GOAL ? C.success : C.border}`, boxShadow: "0 3px 12px #0006", display: "flex", gap: 6, alignItems: "center" }}>
        <span>⌨️</span>
        <span>{mr.chars ? `${main === "bn" ? "বাং" : "EN"} ${fmt(mw)}` : "টাইপিং"}</span>
        {ma != null && <span style={{ color: ma >= 0.95 ? C.success : ma >= 0.85 ? C.warning : C.danger }}>{pct(ma)}</span>}
      </div>

      {open && (
        <div style={{ position: "fixed", inset: 0, zIndex: 9001, background: "#0008", display: "flex", alignItems: "center", justifyContent: "center", padding: 14 }} onClick={() => setOpen(false)}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: C.card, color: C.text, border: `1px solid ${C.border}`, borderRadius: 16, width: "100%", maxWidth: 420, maxHeight: "88vh", overflowY: "auto", padding: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <b style={{ fontSize: 15 }}>⌨️ টাইপিং ট্র্যাকার — আজ</b>
              <span style={{ cursor: "pointer", fontSize: 18 }} onClick={() => setOpen(false)}>✕</span>
            </div>
            <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
              {["bn", "en"].map((k) => <span key={k} onClick={() => setLang(k)} style={{ flex: 1, textAlign: "center", padding: "7px 0", borderRadius: 18, fontSize: 12.5, fontWeight: 700, cursor: "pointer", border: `1px solid ${lang === k ? C.info : C.border}`, background: lang === k ? tint(C.info, "22") : "transparent", color: lang === k ? C.info : C.muted }}>{L[k]}</span>)}
            </div>

            <div style={{ textAlign: "center", marginBottom: 6 }}>
              <div style={{ fontSize: 38, fontWeight: 800, lineHeight: 1.1, color: w >= GOAL ? C.success : C.text }}>{fmt(w)}<span style={{ fontSize: 13, color: C.muted, fontWeight: 600 }}> WPM</span></div>
              <div style={{ fontSize: 11, color: C.muted }}>লক্ষ্য {bn(GOAL)} WPM{!w && r.chars ? " · ১৫ সেকেন্ডের বেশি টাইপ করলে WPM দেখাবে" : ""}</div>
            </div>
            <div style={{ height: 8, borderRadius: 6, background: tint(C.muted, "33"), overflow: "hidden", marginBottom: 12 }}>
              <div style={{ width: `${Math.min(100, (w / GOAL) * 100)}%`, height: "100%", background: w >= GOAL ? C.success : C.info, transition: "width .3s" }} />
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 12, fontSize: 12 }}>
              {[["শব্দ নির্ভুলতা", pct(a), a == null ? C.muted : a >= 0.95 ? C.success : a >= 0.85 ? C.warning : C.danger],
                ["নেট WPM (WPM × নির্ভুলতা)", fmt(net), C.text],
                ["টাইপ করা শব্দ / ভুল ধরা", `${bn(r.typed)} / ${bn(r.wrong)}`, C.text],
                ["সংশোধিত অক্ষর (Backspace)", bn(r.del), C.text],
                ["টাইপ করা অক্ষর", bn(r.chars), C.text],
                ["সক্রিয় সময়", `${bn(Math.round(r.ms / 60000))} মিনিট`, C.text]].map(([k, v, col]) => (
                <div key={k} style={{ border: `1px solid ${C.border}`, borderRadius: 10, padding: "7px 9px" }}>
                  <div style={{ fontSize: 9.5, color: C.muted }}>{k}</div><div style={{ fontSize: 15, fontWeight: 800, color: col }}>{v}</div>
                </div>))}
            </div>

            <div style={{ fontSize: 11, color: C.muted, marginBottom: 4 }}>গত ৭ দিনের WPM ({L[lang]})</div>
            <div style={{ display: "flex", gap: 5, alignItems: "flex-end", height: 64, marginBottom: 12, position: "relative" }}>
              <div style={{ position: "absolute", left: 0, right: 0, bottom: `${(GOAL / maxW) * 100}%`, borderTop: `1px dashed ${C.success}`, opacity: 0.6 }} />
              {days.map((d) => { const v = wpmOf(d[lang]); return (
                <div key={d.key} style={{ flex: 1, textAlign: "center" }}>
                  <div style={{ height: Math.max(2, (v / maxW) * 52), background: v >= GOAL ? C.success : C.info, borderRadius: 3, opacity: v ? 1 : 0.25 }} title={`${d.key}: ${fmt(v)} WPM`} />
                  <div style={{ fontSize: 9, color: C.muted, marginTop: 2 }}>{bn(d.label)}</div>
                </div>); })}
            </div>

            <div style={{ fontSize: 11, color: C.muted, marginBottom: 4 }}>সাম্প্রতিক ভুল → ঠিক ({L[lang]})</div>
            {mist.length === 0 ? <div style={{ fontSize: 11.5, color: C.muted, marginBottom: 10 }}>এখনো কোনো ভুল ধরা পড়েনি 🎉</div> : (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
                {mist.map((m, i) => <span key={i} style={{ fontSize: 11.5, border: `1px solid ${C.border}`, borderRadius: 14, padding: "3px 9px" }}><span style={{ color: C.danger, textDecoration: "line-through" }}>{m.wrong || "—"}</span> → <span style={{ color: C.success, fontWeight: 700 }}>{m.right || "—"}</span></span>)}
              </div>)}

            <div style={{ fontSize: 10, color: C.muted, lineHeight: 1.6, marginBottom: 8 }}>ভুল ধরা হয় এভাবে: টাইপ থামার ৩ সেকেন্ড পর আর ঘর ছাড়ার সময় লেখার "ছবি" তোলা হয়; পরের ছবিতে যে শব্দ বদলেছে বা মুছেছে সেটা ভুল। ৩ সেকেন্ডের মধ্যে সাথে সাথে শুধরানো ভুল "সংশোধিত অক্ষর"-এ গোনা হয়। ৫ অক্ষর = ১ শব্দ।</div>
            <div onClick={() => setSpellEnabled(!spellOn)} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "9px 11px", marginBottom: 8, border: `1px solid ${spellOn ? C.success : C.border}`, borderRadius: 10, cursor: "pointer", fontSize: 12.5 }}>
              <span>🔤 ইংরেজি বানান পরীক্ষা (লাল দাগ + সাজেশন)</span><b style={{ color: spellOn ? C.success : C.muted }}>{spellOn ? "চালু" : "বন্ধ"}</b>
            </div>
            <button className="btn" style={{ width: "100%", justifyContent: "center" }} onClick={() => { if (confirmReset) { resetToday(); setConfirmReset(false); } else { setConfirmReset(true); setTimeout(() => setConfirmReset(false), 3000); } }}>{confirmReset ? "⚠️ আবার চাপলে আজকের হিসাব মুছবে" : "আজকের হিসাব রিসেট"}</button>
          </div>
        </div>
      )}
    </>
  );
}
