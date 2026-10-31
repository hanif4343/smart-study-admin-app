/* ══════════ ভাসমান টাইপিং ট্র্যাকার (সব পেজে) ══════════
   ছোট বাবল: টাইপ করতে করতেই চলমান গতি (থামাসহ) + ⏱; থামলে আজকের সত্যিকারের গতি ও নির্ভুলতা।
   রান শেষ হলে (৬০ সেকেন্ড কিছু না করলে) সারসংক্ষেপ-কার্ড। ট্যাপ করলে খোলে: বাংলা/ইংরেজি আলাদা — সত্যিকারের গতি (থামাসহ),
   হাত-চলার গতি, থামার %, কী-স্ট্রোক নির্ভুলতা, শব্দ-সংশোধনের হার, বাকি ভুল-বানান, নেট গতি, রানের ইতিহাস (ঘরভিত্তিক), ৭ দিনের গ্রাফ।
   বাবল টেনে সরানো যায় (জায়গা মনে থাকে)। */
import React, { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { C, tint } from "../../core/config.js";
import { useTypingStats, todayRec, lastDays, wpmOf, accOf, resetToday, typingSession, subscribeRun, recentRuns, honestWpm, handWpm, pausePct, keyAccOf, hasRunData } from "../../core/typingStats.js";
import { isSpellEnabled, setSpellEnabled, subscribeSpell } from "../../core/spell/index.js";

const LS_GOAL = "typing_goal_v2";
const DEF_GOAL = { bn: 18, en: 25 };   // সৎ গতির (থামাসহ) জন্য শুরুর লক্ষ্য — নিচে নিজের মতো বদলানো যায়
const loadGoal = () => { try { const g = JSON.parse(localStorage.getItem(LS_GOAL) || "null"); if (g && g.bn > 0 && g.en > 0) return g; } catch {} return { ...DEF_GOAL }; };
const POS_KEY = "typing_bubble_pos_v1";
const bn = (n) => String(n).replace(/\d/g, (d) => "০১২৩৪৫৬৭৮৯"[d]);
const fmt = (x) => (x ? bn(Math.round(x)) : "—");
const fmt1 = (x) => (x ? bn((Math.round(x * 10) / 10).toFixed(1)) : "—");
const pct = (x) => (x == null ? "—" : bn(Math.round(x * 100)) + "%");
const secs = (ms) => { const s = Math.round((ms || 0) / 1000); return s < 60 ? `${bn(s)}s` : `${bn(Math.floor(s / 60))}m ${bn(s % 60)}s`; };
const hhmm = (t) => { const d = new Date(t); return bn(`${d.getHours() % 12 || 12}:${String(d.getMinutes()).padStart(2, "0")}`) + (d.getHours() >= 12 ? " PM" : " AM"); };
const accColor = (a) => (a == null ? C.muted : a >= 0.95 ? C.success : a >= 0.85 ? C.warning : C.danger);

export function TypingStatsBubble() {
  const st = useTypingStats();
  const [open, setOpen] = useState(false);
  const [lang, setLang] = useState("en");
  const [confirmReset, setConfirmReset] = useState(false);
  const [goal, setGoal] = useState(loadGoal);
  const [openRun, setOpenRun] = useState(null);
  const [summary, setSummary] = useState(null);       // রান শেষের সারসংক্ষেপ-কার্ড
  const [, setTick] = useState(0);
  const [pos, setPos] = useState(() => { try { const p = JSON.parse(localStorage.getItem(POS_KEY) || "null"); if (p) return p; } catch {} return { right: 12, bottom: 96 }; });
  const drag = useRef(null);
  const spellOn = useSyncExternalStore(subscribeSpell, isSpellEnabled);

  // চলমান রান থাকলে প্রতি সেকেন্ডে ঘড়ি আপডেট; কী চাপলেও সাথে সাথে
  useEffect(() => { const u = typingSession.subscribe(() => setTick((x) => x + 1)); const iv = setInterval(() => { if (typingSession.live()) setTick((x) => x + 1); }, 1000); return () => { u(); clearInterval(iv); }; }, []);
  useEffect(() => subscribeRun((rec) => { setSummary(rec); }), []);
  useEffect(() => { if (!summary) return; const t = setTimeout(() => setSummary(null), 12000); return () => clearTimeout(t); }, [summary]);

  const live = typingSession.live();
  const t = todayRec();
  const main = live ? (live.wordsBn >= live.wordsEn ? "bn" : "en") : (t.bn.runWords + t.bn.chars > t.en.runWords + t.en.chars ? "bn" : "en");   // বাবলে যে ভাষায় বেশি টাইপ হয়েছে
  const mr = t[main], newData = hasRunData(mr), mw = newData ? honestWpm(mr) : wpmOf(mr);
  useEffect(() => { if (open) setLang(main); }, [open]); // eslint-disable-line

  const setG = (l, v) => { const n = Math.max(1, Math.min(200, Number(v) || 0)); if (!n) return; const g = { ...goal, [l]: n }; setGoal(g); try { localStorage.setItem(LS_GOAL, JSON.stringify(g)); } catch {} };

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

  const r = t[lang], isNew = hasRunData(r);
  const w = isNew ? honestWpm(r) : wpmOf(r), hw = handWpm(r), pp = pausePct(r), ka = keyAccOf(r), wa = accOf(r);
  const accAll = ka != null && wa != null ? ka * wa : (ka != null ? ka : wa);
  const net = w && accAll != null ? w * accAll : 0, G = goal[lang];
  const days = lastDays(7), dayW = (d) => (hasRunData(d[lang]) ? honestWpm(d[lang]) : wpmOf(d[lang])), maxW = Math.max(G, ...days.map(dayW));
  const mist = st.mistakes.filter((m) => m.lang === lang).slice(-8).reverse();
  const runs = recentRuns(8);
  const L = { bn: "বাংলা", en: "English" };
  const mainGoal = goal[main];

  const chip = live
    ? `${main === "bn" ? "বাং" : "EN"} ${live.wpm ? fmt(live.wpm) : "…"} · ⏱${secs(live.wall)}`
    : (mw ? `${main === "bn" ? "বাং" : "EN"} ${fmt(mw)}` : "টাইপিং");
  const chipAcc = live ? live.keyAcc : (newData ? keyAccOf(mr) : accOf(mr));

  return (
    <>
      {summary && !open && (() => {
        const words = summary.words.bn + summary.words.en, wpm = summary.wall >= 8000 && words ? words / (summary.wall / 60000) : 0;
        const kt = summary.keyTyped.bn + summary.keyTyped.en, ke = summary.keyErased.bn + summary.keyErased.en, ka2 = kt ? Math.max(0, 1 - ke / kt) : null;
        return (
          <div onClick={() => setSummary(null)} style={{ position: "fixed", left: 10, right: 10, bottom: "calc(150px + env(safe-area-inset-bottom, 0px))", zIndex: 8990, background: C.card, color: C.text, border: `1.5px solid ${C.info}`, borderRadius: 12, padding: "9px 12px", boxShadow: "0 4px 18px #0005", fontSize: 12 }}>
            <div style={{ fontWeight: 800, marginBottom: 2 }}>⌨️ রান শেষ — {bn(words)} শব্দ · {secs(summary.wall)}</div>
            <div style={{ lineHeight: 1.6 }}>
              সত্যিকারের গতি <b>{wpm ? fmt1(wpm) : "—"}</b> শব্দ/মিনিট (থামাসহ) · থামা <b>{summary.wall ? bn(Math.round((summary.pause / summary.wall) * 100)) : "০"}%</b> · কী-নির্ভুলতা <b style={{ color: accColor(ka2) }}>{pct(ka2)}</b>
              {summary.spellErr > 0 ? <> · বাকি ভুল-বানান <b style={{ color: C.danger }}>{bn(summary.spellErr)}</b></> : null}
            </div>
          </div>);
      })()}

      <div onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp}
        style={{ position: "fixed", ...pos, zIndex: 9000, touchAction: "none", userSelect: "none", cursor: "pointer", padding: "6px 11px", borderRadius: 22, fontSize: 12, fontWeight: 800,
          background: C.card, color: C.text, border: `1.5px solid ${live ? C.info : (mw >= mainGoal ? C.success : C.border)}`, boxShadow: "0 3px 12px #0006", display: "flex", gap: 6, alignItems: "center" }}>
        <span>⌨️</span>
        <span>{chip}</span>
        {chipAcc != null && <span style={{ color: accColor(chipAcc) }}>{pct(chipAcc)}</span>}
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

            {live && (
              <div style={{ border: `1.5px solid ${C.info}`, borderRadius: 10, padding: "7px 10px", marginBottom: 10, fontSize: 12, background: tint(C.info, "14") }}>
                <b>▶ চলছে:</b> ⏱ {secs(live.wall)} · {bn(live.words)} শব্দ · {live.wpm ? <b>{fmt(live.wpm)} শব্দ/মিনিট</b> : "গতি দেখাতে আরেকটু লিখুন"} · থামা {bn(Math.round(live.pausePct * 100))}%
              </div>)}

            <div style={{ textAlign: "center", marginBottom: 6 }}>
              <div style={{ fontSize: 38, fontWeight: 800, lineHeight: 1.1, color: w >= G ? C.success : C.text }}>{fmt1(w)}<span style={{ fontSize: 13, color: C.muted, fontWeight: 600 }}> {isNew ? "শব্দ/মিনিট" : "WPM (পুরনো)"}</span></div>
              <div style={{ fontSize: 11, color: C.muted }}>{isNew ? "সত্যিকারের গতি — বই দেখা/থামার সময়সহ" : "পুরনো পদ্ধতির হিসাব (থামা বাদ, ৫ অক্ষর = ১ শব্দ) — নতুন টাইপ থেকে সৎ গতি আসবে"}{!w && isNew && r.runWords ? " · আরেকটু বেশি লিখলে গতি দেখাবে" : ""}</div>
              <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>লক্ষ্য <input type="number" min="1" max="200" value={G} onChange={(e) => setG(lang, e.target.value)} style={{ width: 44, textAlign: "center", border: `1px solid ${C.border}`, borderRadius: 6, background: "transparent", color: C.text, fontSize: 12 }} /> শব্দ/মিনিট ({L[lang]})</div>
            </div>
            <div style={{ height: 8, borderRadius: 6, background: tint(C.muted, "33"), overflow: "hidden", marginBottom: 12 }}>
              <div style={{ width: `${Math.min(100, (w / G) * 100)}%`, height: "100%", background: w >= G ? C.success : C.info, transition: "width .3s" }} />
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 12, fontSize: 12 }}>
              {(isNew ? [
                ["শুধু হাত চলার গতি", hw ? `${fmt1(hw)} শব্দ/মি` : "—", C.text],
                ["থামার সময় (বই দেখা ইত্যাদি)", pp == null ? "—" : pct(pp), pp != null && pp > 0.4 ? C.warning : C.text],
                ["কী-স্ট্রোক নির্ভুলতা", pct(ka), accColor(ka)],
                ["শব্দ সংশোধনের হার", pct(wa), accColor(wa)],
                ["নেট গতি (গতি × নির্ভুলতা)", net ? `${fmt1(net)}` : "—", C.text],
                ["বাকি ভুল-বানান (EN)", lang === "en" ? bn(r.spellErr) : "—", r.spellErr > 0 && lang === "en" ? C.danger : C.text],
                ["মোট শব্দ / রান", `${bn(r.runWords)} / ${bn(r.runs)}`, C.text],
                ["মোট সময় (থামাসহ)", `${bn(Math.floor(r.runWall / 60000))} মি ${bn(Math.round((r.runWall % 60000) / 1000))} সে`, C.text],
              ] : [
                ["শব্দ নির্ভুলতা", pct(wa), accColor(wa)],
                ["টাইপ করা শব্দ / ভুল ধরা", `${bn(r.typed)} / ${bn(r.wrong)}`, C.text],
                ["সংশোধিত অক্ষর (Backspace)", bn(r.del), C.text],
                ["টাইপ করা অক্ষর", bn(r.chars), C.text],
              ]).map(([k, v, col]) => (
                <div key={k} style={{ border: `1px solid ${C.border}`, borderRadius: 10, padding: "7px 9px" }}>
                  <div style={{ fontSize: 9.5, color: C.muted }}>{k}</div><div style={{ fontSize: 15, fontWeight: 800, color: col }}>{v}</div>
                </div>))}
            </div>

            <div style={{ fontSize: 11, color: C.muted, marginBottom: 4 }}>সাম্প্রতিক রান (ট্যাপ করলে ঘরভিত্তিক হিসাব)</div>
            {runs.length === 0 ? <div style={{ fontSize: 11.5, color: C.muted, marginBottom: 10 }}>এখনো কোনো রান শেষ হয়নি — একটানা লিখে ৬০ সেকেন্ড থামলে বা সাবমিট করলে রান জমা হয়।</div> : (
              <div style={{ marginBottom: 10 }}>
                {runs.map((rn, i) => {
                  const wds = rn.words.bn + rn.words.en, wp = rn.wall >= 8000 && wds ? wds / (rn.wall / 60000) : 0;
                  const kt = rn.keyTyped.bn + rn.keyTyped.en, ke = rn.keyErased.bn + rn.keyErased.en, k2 = kt ? Math.max(0, 1 - ke / kt) : null;
                  return (
                    <div key={rn.t + "_" + i} onClick={() => setOpenRun(openRun === i ? null : i)} style={{ border: `1px solid ${C.border}`, borderRadius: 10, padding: "6px 9px", marginBottom: 6, cursor: "pointer", fontSize: 11.5 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 6 }}>
                        <span>{hhmm(rn.t)} · {bn(wds)} শব্দ · {secs(rn.wall)}</span>
                        <b>{wp ? fmt1(wp) : "—"} <span style={{ fontWeight: 500, color: C.muted }}>শব্দ/মি</span></b>
                      </div>
                      <div style={{ color: C.muted, fontSize: 10.5 }}>থামা {rn.wall ? bn(Math.round((rn.pause / rn.wall) * 100)) : "০"}% · কী-নির্ভুলতা <span style={{ color: accColor(k2) }}>{pct(k2)}</span>{rn.spellErr > 0 ? ` · বাকি ভুল-বানান ${bn(rn.spellErr)}` : ""}</div>
                      {openRun === i && (
                        <div style={{ marginTop: 5, borderTop: `1px dashed ${C.border}`, paddingTop: 4 }}>
                          {(rn.boxes || []).length === 0 ? <div style={{ color: C.muted }}>ঘরভিত্তিক তথ্য নেই</div> : rn.boxes.map((b, bi) => (
                            <div key={bi} style={{ display: "flex", justifyContent: "space-between" }}>
                              <span>{b.label}</span><span style={{ color: C.muted }}>{bn(b.words)} শব্দ · {secs(b.ms)}{b.ms >= 3000 && b.words ? ` · ${fmt(b.words / (b.ms / 60000))}/মি` : ""}</span>
                            </div>))}
                          <div style={{ color: C.muted, fontSize: 10, marginTop: 2 }}>ঘরের সময় = ওই ঘরের প্রথম থেকে শেষ কী পর্যন্ত; ছোট ঘরের (১–২ শব্দ) আলাদা গতি অর্থহীন, তাই পুরো রানের সময়ই আসল।</div>
                        </div>)}
                    </div>);
                })}
              </div>)}

            <div style={{ fontSize: 11, color: C.muted, marginBottom: 4 }}>গত ৭ দিনের গতি ({L[lang]}) — শব্দ/মিনিট</div>
            <div style={{ display: "flex", gap: 5, alignItems: "flex-end", height: 64, marginBottom: 12, position: "relative" }}>
              <div style={{ position: "absolute", left: 0, right: 0, bottom: `${(G / maxW) * 100}%`, borderTop: `1px dashed ${C.success}`, opacity: 0.6 }} />
              {days.map((d) => { const v = dayW(d), legacy = !hasRunData(d[lang]) && v > 0; return (
                <div key={d.key} style={{ flex: 1, textAlign: "center" }}>
                  <div style={{ height: Math.max(2, (v / maxW) * 52), background: v >= G ? C.success : C.info, borderRadius: 3, opacity: v ? (legacy ? 0.45 : 1) : 0.25 }} title={`${d.key}: ${fmt(v)}${legacy ? " (পুরনো পদ্ধতি)" : " শব্দ/মি"}`} />
                  <div style={{ fontSize: 9, color: C.muted, marginTop: 2 }}>{bn(d.label)}</div>
                </div>); })}
            </div>

            <div style={{ fontSize: 11, color: C.muted, marginBottom: 4 }}>সাম্প্রতিক ভুল → ঠিক ({L[lang]})</div>
            {mist.length === 0 ? <div style={{ fontSize: 11.5, color: C.muted, marginBottom: 10 }}>এখনো কোনো ভুল ধরা পড়েনি 🎉</div> : (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
                {mist.map((m, i) => <span key={i} style={{ fontSize: 11.5, border: `1px solid ${C.border}`, borderRadius: 14, padding: "3px 9px" }}><span style={{ color: C.danger, textDecoration: "line-through" }}>{m.wrong || "—"}</span> → <span style={{ color: C.success, fontWeight: 700 }}>{m.right || "—"}</span></span>)}
              </div>)}

            <div style={{ fontSize: 10, color: C.muted, lineHeight: 1.65, marginBottom: 8 }}>
              <b>কীভাবে হিসাব হয়:</b> প্রথম কী চাপা থেকে ঘড়ি চলে, সব ঘরে (টেবিলের বাঁ→ডান সহ) একটাই ঘড়ি। বই দেখা বা চোখ ফেরানোর সময়ও গোনা হয় — ৬০ সেকেন্ডের বেশি কিছু না করলে রান শেষ (ওটা বিরতি, গতিতে ধরা হয় না)।
              গতি = শব্দ ÷ পুরো সময় (অক্ষর ÷ ৫ নয়)। পেস্ট, কীবোর্ডের সাজেশন, অটো-রূপান্তর আর বানান-সাজেশনে ক্লিক করে শুধরানো টাইপ ধরা হয় না।
              কী-স্ট্রোক নির্ভুলতা = ১ − (Backspace-এ মোছা অক্ষর ÷ মোট টাইপ করা)। শব্দ সংশোধনের হার: টাইপ থামলে বা ঘর ছাড়লে সম্পূর্ণ শব্দগুলো মেলানো হয়, পরে বদলানো শব্দ ভুল (লেখা চলা শব্দ এতে ধরা হয় না)।
              ⚠️ অ্যাপ বইয়ের লেখা জানে না — যে ভুল আপনি নিজে ধরেননি সেটা এখানে আসে না; ইংরেজির বাকি ভুল-বানান আলাদা দেখানো হয়।
            </div>
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
