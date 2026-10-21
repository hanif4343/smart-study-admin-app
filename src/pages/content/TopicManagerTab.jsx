/* ══════════ TOPIC MANAGER ══════════
   আগের "Topic Tags" এখন এর একটা ট্যাব (🏷 রুল)। নতুন: 📊 তালিকা (প্রশ্নসংখ্যাসহ) · 🔀 মার্জ (কাছাকাছি টপিক সিরিয়ালে) ·
   🗑 অপ্রয়োজনীয় (০ প্রশ্নের টপিক মোছা) · 🩺 হেলথ ও Undo।  ব্যাকএন্ড: topic_manager.gs (tm_*)।
   নিয়ম: মার্জ/ডিলিটের আগে সবসময় হিসাব দেখানো হয়; প্রশ্ন কখনো মোছা হয় না; সর্বশেষ কাজ Undo করা যায়।
   মার্জ/ডিলিটের পর Publish ট্যাবে Publish Now চালাতে হয়। */
import React, { useState, useEffect, useMemo, useCallback } from "react";
import { C, tint } from "../../core/config.js";
import { loadSharedGasSecret, saveSharedGasSecret } from "../../core/utils.js";
import { tmGetTopics, tmGetLog, tmMergePreview, tmMerge, tmDeleteEmpty, tmUndo } from "../../core/topicManager.js";
import { groupSimilarTopics, SENSITIVITY } from "../../core/topicSimilarity.js";
import { renameReferenceItem, warmReferenceCache } from "../../core/sheetSave.js";
import { clearReferenceCache } from "../../core/refCache.js";
import { TopicTagsTab } from "./TopicTagsTab.jsx";

const bn = (n) => String(n == null ? 0 : n).replace(/\d/g, (d) => "০১২৩৪৫৬৭৮৯"[d]);
const TABS = [["list", "📊 তালিকা"], ["merge", "🔀 মার্জ"], ["empty", "🗑 অপ্রয়োজনীয়"], ["health", "🩺 হেলথ/Undo"], ["rules", "🏷 রুল"]];
const LS_IGN = "tm_ignored_groups_v1";

const lbl = { fontSize: 11, color: C.muted, marginBottom: 4, display: "block" };
const row = { display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" };
const chip = (on) => ({ padding: "7px 12px", borderRadius: 16, fontSize: 12, fontWeight: 700, cursor: "pointer", border: `1px solid ${on ? C.info : C.border}`, background: on ? tint(C.info, "22") : "transparent", color: on ? C.info : C.muted });

function Count({ c }) {
  return (
    <div style={{ textAlign: "right", flexShrink: 0 }}>
      <div style={{ fontSize: 15, fontWeight: 800, color: c.total + c.study === 0 ? C.muted : C.text }}>{bn(c.total)}</div>
      <div style={{ fontSize: 9.5, color: C.muted, whiteSpace: "nowrap" }}>QB {bn(c.qbank)} · Quiz {bn(c.quiz)}{c.study ? ` · Study ${bn(c.study)}` : ""}</div>
    </div>
  );
}

function Modal({ children, onClose }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "#000b", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center", padding: 14 }} onClick={onClose}>
      <div style={{ background: C.card, color: C.text, border: `1px solid ${C.border}`, borderRadius: 14, maxWidth: 480, width: "100%", maxHeight: "90vh", overflowY: "auto", padding: 16 }} onClick={(e) => e.stopPropagation()}>{children}</div>
    </div>
  );
}

/* ───────────── মার্জ ডায়ালগ (প্রিভিউ → কনফার্ম) ───────────── */
function MergeDialog({ gasSecret, topics, initialTargetId, subjectName, onClose, onDone, push }) {
  const [targetId, setTargetId] = useState(initialTargetId || topics[0].id);
  const [newName, setNewName] = useState("");
  const [pv, setPv] = useState(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const target = topics.find((t) => t.id === targetId) || topics[0];
  const sources = topics.filter((t) => t.id !== targetId);

  useEffect(() => {
    let dead = false; setPv(null); setErr("");
    tmMergePreview(gasSecret, { targetId, sourceIds: sources.map((s) => s.id), newName }).then((r) => { if (dead) return; if (r.status !== "success") setErr(r.message || "প্রিভিউ ব্যর্থ"); else setPv(r); });
    return () => { dead = true; };
  }, [targetId, newName, gasSecret]); // eslint-disable-line

  const doMerge = async () => {
    if (busy || !pv) return; setBusy(true);
    const r = await tmMerge(gasSecret, { targetId, sourceIds: sources.map((s) => s.id), newName });
    setBusy(false);
    if (r.status !== "success") { push("error", "❌ মার্জ ব্যর্থ", r.message || ""); return; }
    setResult(r);
    if (r.verify && r.verify.ok) push("success", "✅ মার্জ হয়েছে", `${bn(r.movedNow?.questions || 0)}টা প্রশ্ন ${r.target.finalName}-এ গেছে`);
    else push("warn", "⚠️ মার্জ হয়েছে, কিন্তু হিসাব মেলেনি", r.warning || "");
    onDone();
  };

  if (result) return (
    <Modal onClose={onClose}>
      <div style={{ fontSize: 15, fontWeight: 800, marginBottom: 8 }}>{result.verify?.ok ? "✅ মার্জ সম্পন্ন" : "⚠️ হিসাব মেলেনি"}</div>
      <div style={{ fontSize: 12.5, lineHeight: 1.7 }}>
        {bn(result.movedNow?.questions || 0)}টা প্রশ্ন (+Study {bn(result.movedNow?.study || 0)}) এখন <b>{result.target.finalName}</b>-এ। মোট প্রশ্ন: <b>{bn(result.verify?.actual)}</b> (প্রত্যাশিত {bn(result.verify?.expected)})।
        <div style={{ color: C.muted, marginTop: 6 }}>👉 Publish ট্যাবে <b>Publish Now</b> চালাতে ভুলো না। ভুল হলে 🩺 হেলথ/Undo ট্যাব থেকে ফেরত নাও।</div>
        {result.warning && <div style={{ color: C.danger, marginTop: 6 }}>{result.warning}</div>}
      </div>
      <button className="btn bp" style={{ width: "100%", justifyContent: "center", marginTop: 12 }} onClick={onClose}>ঠিক আছে</button>
    </Modal>
  );

  return (
    <Modal onClose={busy ? undefined : onClose}>
      <div style={{ fontSize: 15, fontWeight: 800, marginBottom: 2 }}>🔀 মার্জ — প্রিভিউ</div>
      <div style={{ fontSize: 11, color: C.muted, marginBottom: 10 }}>{subjectName}</div>
      <label style={lbl}>কোন টপিকে মিলবে? (টার্গেট — এই টপিকটাই থাকবে)</label>
      {topics.map((t) => (
        <div key={t.id} onClick={() => setTargetId(t.id)} style={{ ...row, flexWrap: "nowrap", padding: "8px 10px", marginBottom: 6, borderRadius: 10, cursor: "pointer", border: `1px solid ${t.id === targetId ? C.success : C.border}`, background: t.id === targetId ? tint(C.success, "18") : "transparent" }}>
          <span style={{ fontSize: 16 }}>{t.id === targetId ? "🎯" : "○"}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis" }}>{t.name}</div>
            <div style={{ fontSize: 9.5, color: C.muted }}>{t.id}{t.c.rules ? ` · ${bn(t.c.rules)}টা রুল` : ""}</div>
          </div>
          <Count c={t.c} />
        </div>
      ))}
      <label style={{ ...lbl, marginTop: 10 }}>চূড়ান্ত নাম (ফাঁকা রাখলে “{target.name}”-ই থাকবে)</label>
      <input className="inp" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder={target.name} />

      <div style={{ marginTop: 12, padding: 10, borderRadius: 10, background: tint(C.info, "14"), fontSize: 12, lineHeight: 1.7 }}>
        {err ? <span style={{ color: C.danger }}>❌ {err}</span> : !pv ? "⏳ হিসাব হচ্ছে…" : (
          <>
            <div>📦 <b>{bn(pv.movedQuestions)}</b>টা প্রশ্ন {pv.sources.map((s) => `${s.name} (${bn(s.total)})`).join(", ")} থেকে <b>{pv.target.finalName}</b>-এ যাবে{pv.movedStudy ? ` · Study ${bn(pv.movedStudy)}টা` : ""}</div>
            <div>➡️ টার্গেটে এখন {bn(pv.target.total)} → মার্জের পর <b>{bn(pv.afterTotal)}</b></div>
            <div>🗑 {bn(pv.sources.length)}টা টপিক মুছে যাবে (প্রশ্ন নয়)</div>
            <div style={{ color: C.muted }}>🏷 রুল: {pv.ruleNote}</div>
          </>
        )}
      </div>
      <div style={{ ...row, marginTop: 12 }}>
        <button className="btn" style={{ flex: 1, justifyContent: "center" }} disabled={busy} onClick={onClose}>বাতিল</button>
        <button className="btn bp" style={{ flex: 2, justifyContent: "center" }} disabled={busy || !pv || !!err} onClick={doMerge}>{busy ? "⏳ হচ্ছে…" : "✅ মার্জ করো"}</button>
      </div>
    </Modal>
  );
}

/* ───────────── মূল ───────────── */
function TopicManagerTab({ push }) {
  const [gasSecret, setGasSecret] = useState(loadSharedGasSecret);
  const setSecret = (v) => { setGasSecret(v); saveSharedGasSecret(v); };
  const [tab, setTab] = useState("list");
  const [data, setData] = useState(null);
  const [log, setLog] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadErr, setLoadErr] = useState("");
  const [subj, setSubj] = useState("");
  const [q, setQ] = useState("");
  const [sort, setSort] = useState("name");
  const [onlyZero, setOnlyZero] = useState(false);
  const [sel, setSel] = useState({});                 // তালিকা-ট্যাবে বাছা টপিক
  const [dlg, setDlg] = useState(null);               // মার্জ ডায়ালগ {topics, target, subjectName}
  const [sens, setSens] = useState("mid");
  const [gsel, setGsel] = useState({});               // গ্রুপ-ভিত্তিক বাছাই {key:{checked:{id:bool},target}}
  const [ignored, setIgnored] = useState(() => { try { return JSON.parse(localStorage.getItem(LS_IGN) || "[]"); } catch { return []; } });
  const [showIgn, setShowIgn] = useState(false);
  const [delSel, setDelSel] = useState({});
  const [delAsk, setDelAsk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [rn, setRn] = useState(null);                 // রিনেম {id,val}

  const load = useCallback(async () => {
    if (!gasSecret) return;
    setLoading(true); setLoadErr("");
    const [r, l] = await Promise.all([tmGetTopics(gasSecret), tmGetLog(gasSecret)]);
    setLoading(false);
    if (r.status !== "success") { setLoadErr(r.message || "লোড ব্যর্থ"); return; }
    setData(r); setLog(l.status === "success" ? l.items : []);
  }, [gasSecret]);
  useEffect(() => { load(); }, [load]);

  const afterChange = useCallback(async () => {
    setSel({}); setDelSel({}); setGsel({});
    try { clearReferenceCache(); warmReferenceCache({ force: true }); } catch {}
    await load();
  }, [load]);

  const subjName = useMemo(() => { const m = {}; (data?.subjects || []).forEach((s) => { m[s.id] = s.name; }); return m; }, [data]);
  const topics = data?.topics || [];
  const isEmpty = (t) => t.c.total === 0 && t.c.study === 0;
  const zeroCount = topics.filter(isEmpty).length;

  const shown = useMemo(() => {
    let a = topics.filter((t) => (!subj || t.subject_id === subj) && (!onlyZero || isEmpty(t)) && (!q.trim() || (t.name + " " + t.id).toLowerCase().includes(q.trim().toLowerCase())));
    const by = { name: (x, y) => x.name.localeCompare(y.name), most: (x, y) => y.c.total - x.c.total, least: (x, y) => x.c.total - y.c.total, id: (x, y) => x.id.localeCompare(y.id) }[sort];
    return a.slice().sort((x, y) => (subjName[x.subject_id] || "").localeCompare(subjName[y.subject_id] || "") || by(x, y));
  }, [topics, subj, q, sort, onlyZero, subjName]);

  const groups = useMemo(() => groupSimilarTopics(topics, { threshold: SENSITIVITY[sens], subjectId: subj }), [topics, sens, subj]);
  const visibleGroups = groups.filter((g) => showIgn || !ignored.includes(g.key));

  const ignoreGroup = (key) => { const n = [...new Set([...ignored, key])]; setIgnored(n); try { localStorage.setItem(LS_IGN, JSON.stringify(n)); } catch {} };
  const resetIgnored = () => { setIgnored([]); try { localStorage.removeItem(LS_IGN); } catch {} };

  const openMergeFromList = () => {
    const ts = topics.filter((t) => sel[t.id]);
    if (ts.length < 2) { push("warn", "২টা বা বেশি টপিক বাছো", ""); return; }
    if (new Set(ts.map((t) => t.subject_id)).size > 1) { push("warn", "একই সাবজেক্টের টপিক বাছো", "ভিন্ন সাবজেক্টের টপিক মার্জ করা যায় না"); return; }
    setDlg({ topics: ts.sort((a, b) => b.c.total - a.c.total), target: null, subjectName: subjName[ts[0].subject_id] });
  };
  const openMergeFromGroup = (g) => {
    const st = gsel[g.key] || {}; const ts = g.topics.filter((t) => (st.checked ? st.checked[t.id] !== false : true));
    if (ts.length < 2) { push("warn", "মার্জের জন্য অন্তত ২টা টপিক টিক দাও", ""); return; }
    setDlg({ topics: ts, target: st.target && ts.find((t) => t.id === st.target) ? st.target : ts[0].id, subjectName: subjName[g.subject_id] });
  };

  const doRename = async () => {
    if (!rn || !rn.val.trim()) return; setBusy(true);
    const r = await renameReferenceItem({ refType: "topics", id: rn.id, newName: rn.val.trim(), gasSecret, push });
    setBusy(false);
    if (r.ok) { push("success", "✅ নাম বদলেছে", rn.val.trim()); setRn(null); await afterChange(); }
  };
  const doDeleteEmpty = async () => {
    const ids = Object.keys(delSel).filter((k) => delSel[k]); if (!ids.length) return;
    setBusy(true); const r = await tmDeleteEmpty(gasSecret, ids); setBusy(false); setDelAsk(false);
    if (r.status !== "success") { push("error", "❌ মোছা ব্যর্থ", r.message || ""); return; }
    push("success", `🗑 ${bn(r.deleted.length)}টা ফাঁকা টপিক মোছা হয়েছে`, r.skipped?.length ? `${bn(r.skipped.length)}টা বাদ গেছে (প্রশ্ন আছে)` : "Publish Now চালাতে ভুলো না");
    await afterChange();
  };
  const doUndo = async () => {
    setBusy(true); const r = await tmUndo(gasSecret); setBusy(false);
    if (r.status !== "success") { push("error", "❌ Undo ব্যর্থ", r.message || ""); return; }
    push("success", "↩️ Undo হয়েছে", r.kind === "merge" ? `${bn(r.questions || 0)}টা প্রশ্ন আগের টপিকে ফিরেছে` : `${bn(r.topicsRestored || 0)}টা টপিক ফিরেছে`);
    await afterChange();
  };

  if (!gasSecret) return (
    <div className="card"><label style={lbl}>GAS Secret Key</label><input className="inp" type="password" value={gasSecret} onChange={(e) => setSecret(e.target.value)} placeholder="Secret Key বসাও" /></div>
  );

  const subjectSelect = (
    <select className="inp" value={subj} onChange={(e) => setSubj(e.target.value)} style={{ marginBottom: 8 }}>
      <option value="">সব সাবজেক্ট ({bn(topics.length)}টা টপিক)</option>
      {(data?.subjects || []).map((s) => <option key={s.id} value={s.id}>{s.name} ({bn(topics.filter((t) => t.subject_id === s.id).length)})</option>)}
    </select>
  );
  const selCount = Object.values(sel).filter(Boolean).length;
  const delCount = Object.values(delSel).filter(Boolean).length;
  const emptyList = topics.filter((t) => isEmpty(t) && (!subj || t.subject_id === subj)).sort((a, b) => (subjName[a.subject_id] || "").localeCompare(subjName[b.subject_id] || "") || a.name.localeCompare(b.name));

  return (
    <div>
      {loadErr && <div className="card" style={{ border: `1px solid ${C.danger}`, color: C.danger, fontSize: 12, marginBottom: 10 }}>❌ {loadErr} <button className="btn" style={{ marginLeft: 8 }} onClick={load}>🔁 রিট্রাই</button>
        <div style={{ color: C.muted, marginTop: 6 }}>GAS-এ topic_manager.gs যোগ করে (আর code_updated.gs-এর ২টা tm_ ব্লক বসিয়ে) নতুন version ডিপ্লয় করেছ কিনা দেখো।</div></div>}

      <div style={{ ...row, marginBottom: 12 }}>
        {TABS.map(([k, l]) => <span key={k} style={chip(tab === k)} onClick={() => setTab(k)}>{l}</span>)}
        {tab !== "rules" && <button className="btn" style={{ marginLeft: "auto" }} disabled={loading} onClick={load}>{loading ? "⏳" : "🔄"}</button>}
      </div>

      {tab !== "rules" && !data && !loadErr && <div style={{ color: C.muted, fontSize: 12, padding: 12 }}>⏳ টপিক লোড হচ্ছে…</div>}

      {/* ══════════ 📊 তালিকা ══════════ */}
      {tab === "list" && data && <div>
        <div className="card" style={{ marginBottom: 10, fontSize: 12 }}>
          মোট <b>{bn(topics.length)}</b>টা টপিক · প্রশ্ন আছে <b>{bn(topics.length - zeroCount)}</b>টায় · <span style={{ color: zeroCount ? C.warning : C.muted }}>ফাঁকা <b>{bn(zeroCount)}</b>টা</span>
        </div>
        {subjectSelect}
        <input className="inp" value={q} onChange={(e) => setQ(e.target.value)} placeholder="🔍 টপিকের নাম / আইডি খোঁজো" style={{ marginBottom: 8 }} />
        <div style={{ ...row, marginBottom: 10 }}>
          <select className="inp" style={{ flex: 1 }} value={sort} onChange={(e) => setSort(e.target.value)}>
            <option value="name">নাম অনুযায়ী</option><option value="most">প্রশ্ন বেশি আগে</option><option value="least">প্রশ্ন কম আগে</option><option value="id">আইডি অনুযায়ী</option>
          </select>
          <span style={chip(onlyZero)} onClick={() => setOnlyZero(!onlyZero)}>শুধু ০ প্রশ্ন</span>
        </div>
        {shown.length === 0 && <div style={{ color: C.muted, fontSize: 12, textAlign: "center", padding: 16 }}>কিছু পাওয়া যায়নি</div>}
        {shown.map((t, i) => {
          const head = !subj && (i === 0 || shown[i - 1].subject_id !== t.subject_id);
          return (
            <React.Fragment key={t.id}>
              {head && <div style={{ fontSize: 11, fontWeight: 800, color: C.accent, margin: "12px 0 6px" }}>{subjName[t.subject_id] || t.subject_id}</div>}
              <div style={{ ...row, flexWrap: "nowrap", padding: "8px 10px", marginBottom: 5, borderRadius: 10, border: `1px solid ${sel[t.id] ? C.info : C.border}`, background: sel[t.id] ? tint(C.info, "14") : "transparent", opacity: isEmpty(t) ? 0.75 : 1 }}>
                <input type="checkbox" checked={!!sel[t.id]} onChange={() => setSel({ ...sel, [t.id]: !sel[t.id] })} style={{ width: 18, height: 18, flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  {rn?.id === t.id ? (
                    <div style={row}><input className="inp" style={{ flex: 1, minWidth: 120 }} value={rn.val} onChange={(e) => setRn({ ...rn, val: e.target.value })} autoFocus />
                      <button className="btn bp" disabled={busy} onClick={doRename}>✓</button><button className="btn" onClick={() => setRn(null)}>✕</button></div>
                  ) : (
                    <div style={{ fontSize: 13, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis" }}>{t.name} <span style={{ cursor: "pointer", fontSize: 11 }} onClick={() => setRn({ id: t.id, val: t.name })}>✏️</span></div>
                  )}
                  <div style={{ fontSize: 9.5, color: C.muted }}>{t.id}{t.c.rules ? ` · 🏷 ${bn(t.c.rules)} রুল` : ""}</div>
                </div>
                <Count c={t.c} />
              </div>
            </React.Fragment>
          );
        })}
        {selCount > 0 && <div style={{ position: "sticky", bottom: 8, marginTop: 10, padding: 10, borderRadius: 12, background: C.card, border: `1px solid ${C.info}`, ...row }}>
          <span style={{ fontSize: 12, fontWeight: 700 }}>{bn(selCount)}টা বাছা</span>
          <button className="btn" onClick={() => setSel({})}>পরিষ্কার</button>
          <button className="btn bp" style={{ marginLeft: "auto" }} onClick={openMergeFromList}>🔀 মার্জ করো</button>
        </div>}
      </div>}

      {/* ══════════ 🔀 মার্জ (কাছাকাছি টপিক) ══════════ */}
      {tab === "merge" && data && <div>
        <div style={{ fontSize: 11.5, color: C.muted, marginBottom: 8, lineHeight: 1.6 }}>একই সাবজেক্টের কাছাকাছি নামের টপিক পাশাপাশি দেখানো হচ্ছে। এটা শুধু সাজেশন — কোনটা মার্জ হবে তুমি ঠিক করবে, আর মার্জের আগে প্রিভিউ আসবে।</div>
        {subjectSelect}
        <div style={{ ...row, marginBottom: 10 }}>
          {[["high", "খুব মিল"], ["mid", "মাঝারি"], ["low", "কম কঠোর"]].map(([k, l]) => <span key={k} style={chip(sens === k)} onClick={() => setSens(k)}>{l}</span>)}
        </div>
        <div style={{ fontSize: 11, color: C.muted, marginBottom: 8 }}>{bn(visibleGroups.length)}টা গ্রুপ{ignored.length ? ` · ${bn(ignored.length)}টা "আলাদা" চিহ্নিত ` : ""}
          {ignored.length > 0 && <><span style={{ color: C.info, cursor: "pointer" }} onClick={() => setShowIgn(!showIgn)}>{showIgn ? "লুকাও" : "দেখাও"}</span> · <span style={{ color: C.info, cursor: "pointer" }} onClick={resetIgnored}>রিসেট</span></>}</div>
        {visibleGroups.length === 0 && <div style={{ color: C.muted, fontSize: 12, textAlign: "center", padding: 18 }}>এই সেটিংয়ে কাছাকাছি মিলের টপিক পাওয়া যায়নি। "কম কঠোর" চেষ্টা করো।</div>}
        {visibleGroups.map((g) => {
          const st = gsel[g.key] || {}; const on = (id) => (st.checked ? st.checked[id] !== false : true); const tgt = st.target || g.topics[0].id;
          const isIgn = ignored.includes(g.key);
          return (
            <div key={g.key} className="card" style={{ marginBottom: 10, opacity: isIgn ? 0.55 : 1 }}>
              <div style={{ ...row, justifyContent: "space-between", marginBottom: 6 }}>
                <span style={{ fontSize: 11, fontWeight: 800, color: C.accent }}>{subjName[g.subject_id]}</span>
                <span style={{ fontSize: 10, color: C.muted }}>মিল {bn(Math.round(g.score * 100))}% · মোট {bn(g.total)}টা প্রশ্ন</span>
              </div>
              {g.topics.map((t) => (
                <div key={t.id} style={{ ...row, flexWrap: "nowrap", padding: "6px 0", borderTop: `1px dashed ${C.border}` }}>
                  <input type="checkbox" checked={on(t.id)} style={{ width: 18, height: 18, flexShrink: 0 }} onChange={() => setGsel({ ...gsel, [g.key]: { ...st, target: tgt, checked: { ...(st.checked || {}), [t.id]: !on(t.id) } } })} />
                  <span style={{ cursor: "pointer", fontSize: 15 }} title="এটাই টার্গেট (থাকবে)" onClick={() => setGsel({ ...gsel, [g.key]: { ...st, checked: st.checked, target: t.id } })}>{tgt === t.id ? "🎯" : "○"}</span>
                  <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontSize: 13, fontWeight: 700 }}>{t.name}</div><div style={{ fontSize: 9.5, color: C.muted }}>{t.id}{t.c.rules ? ` · 🏷 ${bn(t.c.rules)} রুল` : ""}</div></div>
                  <Count c={t.c} />
                </div>
              ))}
              <div style={{ ...row, marginTop: 8 }}>
                {!isIgn && <button className="btn" onClick={() => ignoreGroup(g.key)}>আলাদা রাখো</button>}
                <button className="btn bp" style={{ marginLeft: "auto" }} onClick={() => openMergeFromGroup(g)}>🔀 প্রিভিউ ও মার্জ</button>
              </div>
            </div>
          );
        })}
      </div>}

      {/* ══════════ 🗑 অপ্রয়োজনীয় ══════════ */}
      {tab === "empty" && data && <div>
        <div style={{ fontSize: 11.5, color: C.muted, marginBottom: 8, lineHeight: 1.6 }}>এখানে শুধু সেই টপিক, যেগুলোতে <b>কোথাও একটাও প্রশ্ন নেই</b> (Questions + Study)। প্রশ্ন আছে এমন টপিক এখান থেকে মোছা যায় না — সেগুলো আগে অন্য টপিকে মার্জ করো।</div>
        {subjectSelect}
        {emptyList.length === 0 ? <div style={{ color: C.muted, fontSize: 12, textAlign: "center", padding: 18 }}>🎉 কোনো ফাঁকা টপিক নেই</div> : <>
          <div style={{ ...row, marginBottom: 8 }}>
            <button className="btn" onClick={() => { const m = {}; emptyList.forEach((t) => { m[t.id] = true; }); setDelSel(m); }}>সব বাছো ({bn(emptyList.length)})</button>
            <button className="btn" onClick={() => setDelSel({})}>পরিষ্কার</button>
          </div>
          {emptyList.map((t, i) => {
            const head = !subj && (i === 0 || emptyList[i - 1].subject_id !== t.subject_id);
            return (
              <React.Fragment key={t.id}>
                {head && <div style={{ fontSize: 11, fontWeight: 800, color: C.accent, margin: "12px 0 6px" }}>{subjName[t.subject_id]}</div>}
                <div style={{ ...row, flexWrap: "nowrap", padding: "8px 10px", marginBottom: 5, borderRadius: 10, border: `1px solid ${delSel[t.id] ? C.danger : C.border}`, background: delSel[t.id] ? tint(C.danger, "14") : "transparent" }} onClick={() => setDelSel({ ...delSel, [t.id]: !delSel[t.id] })}>
                  <input type="checkbox" readOnly checked={!!delSel[t.id]} style={{ width: 18, height: 18, flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontSize: 13, fontWeight: 700 }}>{t.name}</div><div style={{ fontSize: 9.5, color: C.muted }}>{t.id}{t.c.rules ? ` · ⚠️ ${bn(t.c.rules)}টা রুলও মুছবে` : ""}</div></div>
                  <span style={{ fontSize: 12, color: C.muted }}>০</span>
                </div>
              </React.Fragment>
            );
          })}
          {delCount > 0 && <div style={{ position: "sticky", bottom: 8, marginTop: 10, padding: 10, borderRadius: 12, background: C.card, border: `1px solid ${C.danger}`, ...row }}>
            <span style={{ fontSize: 12, fontWeight: 700 }}>{bn(delCount)}টা বাছা</span>
            <button className="btn" style={{ marginLeft: "auto", background: tint(C.danger, "22"), color: C.danger, fontWeight: 800 }} onClick={() => setDelAsk(true)}>🗑 মুছো</button>
          </div>}
        </>}
      </div>}

      {/* ══════════ 🩺 হেলথ/Undo ══════════ */}
      {tab === "health" && data && <div>
        <div className="card" style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6 }}>🩺 ডাটার অবস্থা</div>
          <div style={{ fontSize: 12, lineHeight: 1.8 }}>
            <div>টপিক-ছাড়া (topic_id ফাঁকা) প্রশ্ন: <b style={{ color: data.health.blankQ ? C.warning : C.success }}>{bn(data.health.blankQ)}</b>{data.health.blankQIds?.length ? <span style={{ color: C.muted, fontSize: 10 }}> ({data.health.blankQIds.slice(0, 6).join(", ")}{data.health.blankQ > 6 ? "…" : ""})</span> : null}</div>
            <div>অচেনা topic_id-র প্রশ্ন (Topics শিটে নেই): <b style={{ color: data.health.orphanQ ? C.danger : C.success }}>{bn(data.health.orphanQ)}</b></div>
            {data.health.orphanTopics?.length > 0 && <div style={{ fontSize: 10.5, color: C.muted }}>{data.health.orphanTopics.slice(0, 10).map((o) => `${o.topic_id} (${bn(o.n)})`).join(" · ")}</div>}
            <div>Study: ফাঁকা {bn(data.health.blankStudy)} · অচেনা {bn(data.health.orphanStudy)}</div>
          </div>
          {(data.health.blankQ > 0 || data.health.orphanQ > 0) && <div style={{ fontSize: 11, color: C.muted, marginTop: 6 }}>এগুলো মডেল টেস্টে বাদ পড়বে। টপিক-ছাড়া/অচেনা প্রশ্ন ঠিক করতে Orphan Fix বা রুল (🏷) ব্যবহার করো।</div>}
        </div>
        <div className="card">
          <div style={{ ...row, justifyContent: "space-between", marginBottom: 8 }}>
            <div style={{ fontSize: 13, fontWeight: 700 }}>🕘 শেষ কাজগুলো</div>
            <button className="btn" disabled={busy || !log.some((x) => !x.undone)} onClick={doUndo}>↩️ সর্বশেষটা Undo</button>
          </div>
          {log.length === 0 && <div style={{ fontSize: 12, color: C.muted }}>এখনো কোনো মার্জ/মোছা হয়নি</div>}
          {log.map((x) => (
            <div key={x.log_id} style={{ padding: "7px 0", borderTop: `1px dashed ${C.border}`, opacity: x.undone ? 0.5 : 1 }}>
              <div style={{ fontSize: 12, fontWeight: 700 }}>{x.kind === "merge" ? "🔀" : "🗑"} {x.summary} {x.undone && <span style={{ color: C.muted }}>· ↩️ ফেরত</span>}</div>
              <div style={{ fontSize: 9.5, color: C.muted }}>{x.time ? new Date(x.time).toLocaleString("bn-BD") : ""}</div>
            </div>
          ))}
          <div style={{ fontSize: 10.5, color: C.muted, marginTop: 8 }}>Undo শুধু সর্বশেষ কাজ ফেরত দেয় (একে একে পেছনে যাওয়া যায়)।</div>
        </div>
      </div>}

      {tab === "rules" && <TopicTagsTab push={push} />}

      {dlg && <MergeDialog gasSecret={gasSecret} topics={dlg.topics} initialTargetId={dlg.target} subjectName={dlg.subjectName} push={push} onClose={() => setDlg(null)} onDone={afterChange} />}
      {delAsk && <Modal onClose={busy ? undefined : () => setDelAsk(false)}>
        <div style={{ fontSize: 15, fontWeight: 800, marginBottom: 6 }}>🗑 {bn(delCount)}টা ফাঁকা টপিক মুছবে?</div>
        <div style={{ fontSize: 12, color: C.muted, lineHeight: 1.7, marginBottom: 12 }}>এগুলোতে কোনো প্রশ্ন নেই, তাই কোনো প্রশ্ন হারাবে না। (রুল থাকলে সেগুলোও মুছবে।) ভুল হলে 🩺 হেলথ/Undo থেকে ফেরত আনা যাবে।</div>
        <div style={row}><button className="btn" style={{ flex: 1, justifyContent: "center" }} disabled={busy} onClick={() => setDelAsk(false)}>বাতিল</button>
          <button className="btn" style={{ flex: 1, justifyContent: "center", background: tint(C.danger, "22"), color: C.danger, fontWeight: 800 }} disabled={busy} onClick={doDeleteEmpty}>{busy ? "⏳…" : "হ্যাঁ, মুছো"}</button></div>
      </Modal>}
    </div>
  );
}

export { TopicManagerTab };
