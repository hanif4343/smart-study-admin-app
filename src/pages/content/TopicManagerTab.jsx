/* ══════════ TOPIC MANAGER ══════════
   আগের "Topic Tags" এখন এর একটা ট্যাব (🏷 রুল)। 📊 তালিকা (A→Z, প্রশ্নসংখ্যাসহ, মাস্টার ⭐ + টিক → কিউ) · 🔀 মার্জ (কাছাকাছি টপিক গ্রুপ → কিউ) ·
   🗑 অপ্রয়োজনীয় (০ প্রশ্নের টপিক মোছা) · 🩺 হেলথ ও Undo।  ব্যাকএন্ড: topic_manager.gs (tm_*)।

   🆕 নতুন কাজের ধারা (দ্রুত): ১) তালিকা A→Z/অ→হ ক্রমে (কাছাকাছি নাম পাশাপাশি), প্রশ্ন-সংখ্যা সাথে সাথে দেখায় — আলাদা "প্রিভিউ" ধাপ নেই।
   ২) একটা টপিককে ⭐ মাস্টার বানাও, যেগুলো তার ভেতরে যাবে সেগুলো টিক দাও → "➕ কিউতে যোগ" (সার্ভারে কিছু যায় না, তাৎক্ষণিক)।
   ৩) এভাবে একটা একটা করে সাজিয়ে শেষে "🚀 সব জমা দাও" — পুরো কিউ ব্যাকগ্রাউন্ডে একসাথে যায়; স্ক্রিন আটকায় না, অন্য কাজে যাওয়া যায়;
      শেষ হলে নোটিফিকেশন (টোস্ট + চলমান-বার + ট্যাবে লাল সংখ্যা)। ভুল হলে 🩺 হেলথ/Undo থেকে পুরো ব্যাচ ফেরত।
   প্রশ্ন কখনো মোছা হয় না। মার্জ/ডিলিটের পর Publish ট্যাবে Publish Now চালাতে হয়। */
import React, { useState, useEffect, useMemo, useCallback, useRef, memo } from "react";
import { C, tint } from "../../core/config.js";
import { loadSharedGasSecret, saveSharedGasSecret } from "../../core/utils.js";
import { tmGetTopics, tmGetLog, tmDeleteEmpty, tmUndo } from "../../core/topicManager.js";
import { groupSimilarTopics, SENSITIVITY } from "../../core/topicSimilarity.js";
import { renameReferenceItem, warmReferenceCache } from "../../core/sheetSave.js";
import { clearReferenceCache } from "../../core/refCache.js";
import { TopicTagsTab } from "./TopicTagsTab.jsx";
import { useSharedGasSecret } from "../../core/gasSecret.js";
import { GasSecretStatus } from "../../components/shared/GasSecretStatus.jsx";
import { addMerge, removeMerge, clearQueue, usedIds, submitQueue, subscribeQueue, subscribeDone, markNoticesRead } from "../../core/topicMergeQueue.js";

const bn = (n) => String(n == null ? 0 : n).replace(/\d/g, (d) => "০১২৩৪৫৬৭৮৯"[d]);
const TABS = [["list", "📊 তালিকা"], ["merge", "🔀 মার্জ"], ["empty", "🗑 অপ্রয়োজনীয়"], ["health", "🩺 হেলথ/Undo"], ["rules", "🏷 রুল"]];
const LS_IGN = "tm_ignored_groups_v1", LS_CACHE = "tm_topics_cache_v1";

const lbl = { fontSize: 11, color: C.muted, marginBottom: 4, display: "block" };
const row = { display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" };
const chip = (on) => ({ padding: "7px 12px", borderRadius: 16, fontSize: 12, fontWeight: 700, cursor: "pointer", border: `1px solid ${on ? C.info : C.border}`, background: on ? tint(C.info, "22") : "transparent", color: on ? C.info : C.muted });

/* ── ক্রম (A→Z / অ→হ): বাংলা-সঠিক collator + শুরুর চিহ্ন/বন্ধনী বাদ; কাছাকাছি নাম যাতে পাশাপাশি আসে ── */
const COLL = (() => { try { return new Intl.Collator(["bn", "en"], { numeric: true, sensitivity: "base", ignorePunctuation: true }); } catch { return null; } })();
const sortKey = (n) => String(n || "").normalize("NFC").trim().replace(/^[\s\-–—_.,;:!?'"“”‘’()\[\]{}*#@/\\|+=<>~`^]+/, "");
const cmpName = (a, b) => { const ka = sortKey(a), kb = sortKey(b); return COLL ? (COLL.compare(ka, kb) || COLL.compare(a, b)) : ka.localeCompare(kb); };
const firstLetter = (n) => { const k = sortKey(n); if (!k) return "#"; const ch = Array.from(k)[0]; return /\p{N}/u.test(ch) ? "#" : ch.toUpperCase(); };
// কাছাকাছি নামের লাইটওয়েট চেক (শুধু পাশের সারির সাথে): শব্দের বহুবচন/ফাঁকা/চিহ্ন বাদ দিয়ে এক বা একটা অন্যটার শুরু
const simKey = (n) => { let k = String(n || "").toLowerCase().replace(/[^\p{L}\p{M}\p{N}]+/gu, ""); if (/^[a-z]+$/.test(k) && k.length > 4) k = k.replace(/(es|s)$/, ""); return k; };
const near = (a, b) => { const x = simKey(a), y = simKey(b); if (!x || !y) return false; if (x === y) return true; const m = Math.min(x.length, y.length); return m >= 4 && (x.startsWith(y) || y.startsWith(x) || (m >= 6 && x.slice(0, 6) === y.slice(0, 6))); };

/* ── তালিকা-ক্যাশ: খুলতেই আগেরটা সাথে সাথে দেখায়, পেছনে নতুনটা আসে ── */
const readCache = () => { try { const c = JSON.parse(localStorage.getItem(LS_CACHE) || "null"); return c && Array.isArray(c.topics) ? c : null; } catch { return null; } };
const writeCache = (r) => { try { const h = r.health || {}; const slim = { ...h }; Object.keys(slim).forEach((k) => { if (Array.isArray(slim[k]) && slim[k].length > 20) slim[k] = slim[k].slice(0, 20); }); localStorage.setItem(LS_CACHE, JSON.stringify({ subjects: r.subjects || [], topics: r.topics || [], health: slim, at: Date.now() })); } catch {} };

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

/* ───────────── তালিকার একটা সারি (memo: শুধু বদলানো সারিই আবার আঁকা হয় — টিক দেওয়া হালকা) ───────────── */
const TopicRow = memo(function TopicRow({ t, checked, isMaster, qInfo, nearPrev, onTick, onMaster, onRename }) {
  const empty = t.c.total === 0 && t.c.study === 0, busy = !!qInfo;
  return (
    <div id={"tmrow_" + t.id} style={{ ...row, flexWrap: "nowrap", padding: "8px 10px", marginBottom: 5, borderRadius: 10,
      border: `1px solid ${isMaster ? C.warning : checked ? C.info : nearPrev ? tint(C.accent, "55") : C.border}`,
      background: isMaster ? tint(C.warning, "18") : checked ? tint(C.info, "14") : nearPrev ? tint(C.accent, "0c") : "transparent", opacity: busy ? 0.5 : empty ? 0.75 : 1 }}>
      <input type="checkbox" checked={checked} disabled={busy || isMaster} onChange={() => onTick(t.id)} style={{ width: 18, height: 18, flexShrink: 0 }} />
      <span title="এটাকে মাস্টার বানাও (এর ভেতরে বাকিরা মিশবে)" onClick={() => !busy && onMaster(t.id)} style={{ fontSize: 17, cursor: busy ? "default" : "pointer", flexShrink: 0, filter: isMaster ? "none" : "grayscale(1) opacity(.45)" }}>⭐</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis" }}>{t.name} <span style={{ cursor: "pointer", fontSize: 11 }} onClick={() => onRename(t)}>✏️</span></div>
        <div style={{ fontSize: 9.5, color: C.muted }}>{t.id}{t.c.rules ? ` · 🏷 ${bn(t.c.rules)} রুল` : ""}{nearPrev ? " · 🔗 কাছাকাছি নাম" : ""}</div>
        {qInfo && <div style={{ fontSize: 10, fontWeight: 800, color: C.info }}>{qInfo}</div>}
      </div>
      <Count c={t.c} />
    </div>
  );
});

/* ───────────── কিউ-ট্রে: যেসব মার্জ জমার অপেক্ষায় ───────────── */
function QueueTray({ qs, onSubmit, submitting }) {
  const items = qs.queue;
  if (!items.length && !qs.running) return null;
  const est = items.reduce((a, it) => a + (it.estQ || 0), 0);
  return (
    <div className="card" style={{ marginBottom: 10, border: `1.5px solid ${qs.running ? C.info : C.success}` }}>
      <div style={{ ...row, justifyContent: "space-between", marginBottom: 6 }}>
        <div style={{ fontSize: 13, fontWeight: 800 }}>📋 কিউ — {bn(items.length)}টা মার্জ{est ? ` · ~${bn(est)} প্রশ্ন` : ""}</div>
        {!!items.length && <span style={{ fontSize: 11, color: C.danger, cursor: "pointer" }} onClick={clearQueue}>🗑 খালি করো</span>}
      </div>
      {qs.running && <div style={{ fontSize: 11.5, color: C.info, fontWeight: 700, marginBottom: 6, lineHeight: 1.6 }}>⏳ একটা ব্যাচ ব্যাকগ্রাউন্ডে চলছে — নিচের বারে অগ্রগতি দেখো, অন্য কাজে যেতে পারো। শেষ হলে জানানো হবে।</div>}
      {items.map((it) => (
        <div key={it.qid} style={{ ...row, flexWrap: "nowrap", padding: "6px 0", borderTop: `1px dashed ${C.border}` }}>
          <div style={{ flex: 1, minWidth: 0, fontSize: 12 }}>
            <div style={{ fontWeight: 800 }}>⭐ {it.newName || it.targetName}{it.newName ? <span style={{ color: C.muted, fontWeight: 500 }}> (আগের নাম: {it.targetName})</span> : null}</div>
            <div style={{ color: C.muted, fontSize: 10.5, lineHeight: 1.5 }}>← {(it.sourceNames || []).join(", ") || bn(it.sourceIds.length) + "টা টপিক"}{it.estQ ? ` · +${bn(it.estQ)} প্রশ্ন` : ""}</div>
          </div>
          <span style={{ cursor: "pointer", fontSize: 16, color: C.danger }} title="কিউ থেকে সরাও" onClick={() => removeMerge(it.qid)}>✕</span>
        </div>
      ))}
      {!!items.length && <button className="btn bp" style={{ width: "100%", justifyContent: "center", marginTop: 8 }} disabled={qs.running || submitting} onClick={onSubmit}>
        {qs.running ? "⏳ ব্যাচ চলছে…" : `🚀 সব জমা দাও (${bn(items.length)}টা মার্জ)`}</button>}
      {!!items.length && !qs.running && <div style={{ fontSize: 10, color: C.muted, marginTop: 5, lineHeight: 1.5 }}>জমা দিলে সব একসাথে ব্যাকগ্রাউন্ডে যাবে — স্ক্রিনে বসে থাকতে হবে না। ভুল হলে 🩺 হেলথ/Undo থেকে পুরো ব্যাচ ফেরত আনা যায়।</div>}
    </div>
  );
}

/* ───────────── মূল ───────────── */
function TopicManagerTab({ push }) {
  const [gasSecret, setGasSecret] = useSharedGasSecret();
  const setSecret = (v) => { setGasSecret(v); saveSharedGasSecret(v); };
  const [tab, setTab] = useState("list");
  const cached = useMemo(() => readCache(), []);
  const [data, setData] = useState(cached);              // ক্যাশ থাকলে সাথে সাথে দেখায়, পেছনে নতুনটা আসে
  const [fromCache, setFromCache] = useState(!!cached);
  const [log, setLog] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadErr, setLoadErr] = useState("");
  const [subj, setSubj] = useState("");
  const [q, setQ] = useState("");
  const [sort, setSort] = useState("name");
  const [onlyZero, setOnlyZero] = useState(false);
  const [sel, setSel] = useState({});                 // তালিকা-ট্যাবে টিক-দেওয়া টপিক (সোর্স)
  const [master, setMaster] = useState(null);         // ⭐ মাস্টার টপিকের id
  const [newName, setNewName] = useState("");         // মাস্টারের চূড়ান্ত নাম (ঐচ্ছিক)
  const [lim, setLim] = useState(150);                // ধাপে ধাপে আঁকা (শত শত সারি একসাথে নয়)
  const [qs, setQs] = useState({ queue: [], running: false });
  const [sens, setSens] = useState("mid");
  const [gsel, setGsel] = useState({});               // গ্রুপ-ভিত্তিক বাছাই {key:{checked:{id:bool},target,newName}}
  const [ignored, setIgnored] = useState(() => { try { return JSON.parse(localStorage.getItem(LS_IGN) || "[]"); } catch { return []; } });
  const [showIgn, setShowIgn] = useState(false);
  const [delSel, setDelSel] = useState({});
  const [delAsk, setDelAsk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [rn, setRn] = useState(null);                 // রিনেম {id,val}
  const sentRef = useRef(null);

  useEffect(() => subscribeQueue(setQs), []);
  useEffect(() => { markNoticesRead(); }, []);

  const load = useCallback(async () => {
    if (!gasSecret) return;
    setLoading(true); setLoadErr("");
    const r = await tmGetTopics(gasSecret);
    setLoading(false);
    if (r.status !== "success") { setLoadErr(r.message || "লোড ব্যর্থ"); return; }   // ক্যাশ থাকলে সেটাই দেখাতে থাকে
    setData(r); setFromCache(false); writeCache(r);
  }, [gasSecret]);
  const loadLog = useCallback(async () => {
    if (!gasSecret) return;
    const l = await tmGetLog(gasSecret); if (l.status === "success") setLog(l.items);
  }, [gasSecret]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (tab === "health") loadLog(); }, [tab, loadLog]);

  // ব্যাকগ্রাউন্ড ব্যাচ শেষ হলে: টিক/মাস্টার পরিষ্কার, নতুন তালিকা পেছনে আনা (স্ক্রিন আটকায় না)
  useEffect(() => subscribeDone(() => {
    setSel({}); setMaster(null); setGsel({});
    try { clearReferenceCache(); warmReferenceCache({ force: true }); } catch {}
    load(); if (tab === "health") loadLog();
  }), [load, loadLog, tab]);

  const afterChange = useCallback(async () => {
    setSel({}); setDelSel({}); setGsel({}); setMaster(null);
    try { clearReferenceCache(); warmReferenceCache({ force: true }); } catch {}
    await load(); if (tab === "health") await loadLog();
  }, [load, loadLog, tab]);

  const subjName = useMemo(() => { const m = {}; (data?.subjects || []).forEach((s) => { m[s.id] = s.name; }); return m; }, [data]);
  const topics = useMemo(() => data?.topics || [], [data]);
  const byId = useMemo(() => { const m = {}; topics.forEach((t) => { m[t.id] = t; }); return m; }, [topics]);
  const used = useMemo(() => usedIds(), [qs]);   // eslint-disable-line
  const isEmpty = (t) => t.c.total === 0 && t.c.study === 0;
  const zeroCount = topics.filter(isEmpty).length;

  const shown = useMemo(() => {
    const ql = q.trim().toLowerCase();
    const a = topics.filter((t) => (!subj || t.subject_id === subj) && (!onlyZero || (t.c.total === 0 && t.c.study === 0)) && (!ql || (t.name + " " + t.id).toLowerCase().includes(ql)));
    const by = { name: (x, y) => cmpName(x.name, y.name), most: (x, y) => y.c.total - x.c.total, least: (x, y) => x.c.total - y.c.total, id: (x, y) => (COLL ? COLL.compare(x.id, y.id) : x.id.localeCompare(y.id)) }[sort];
    return a.slice().sort((x, y) => cmpName(subjName[x.subject_id] || "", subjName[y.subject_id] || "") || by(x, y));
  }, [topics, subj, q, sort, onlyZero, subjName]);
  useEffect(() => { setLim(150); }, [subj, q, sort, onlyZero]);
  const visible = useMemo(() => shown.slice(0, lim), [shown, lim]);
  useEffect(() => {   // নিচে নামলে নিজে থেকে আরও সারি আঁকা
    const el = sentRef.current; if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver((es) => { if (es[0].isIntersecting) setLim((l) => l + 200); }, { rootMargin: "500px" });
    io.observe(el); return () => io.disconnect();
  }, [visible.length, shown.length, tab]);

  // অক্ষর-লাফ (সাবজেক্ট বাছা থাকলে, নাম-ক্রমে)
  const letters = useMemo(() => { if (sort !== "name" || !subj) return []; const m = new Map(); shown.forEach((t, i) => { const L = firstLetter(t.name); if (!m.has(L)) m.set(L, i); }); return [...m.entries()]; }, [shown, sort, subj]);
  const jumpTo = (idx) => { setLim((l) => Math.max(l, idx + 60)); setTimeout(() => { const t = shown[idx]; const el = t && document.getElementById("tmrow_" + t.id); if (el) el.scrollIntoView({ behavior: "smooth", block: "start" }); }, 90); };

  const groups = useMemo(() => (tab === "merge" ? groupSimilarTopics(topics, { threshold: SENSITIVITY[sens], subjectId: subj }) : []), [tab, topics, sens, subj]);
  const visibleGroups = groups.filter((g) => showIgn || !ignored.includes(g.key));
  const ignoreGroup = (key) => { const n = [...new Set([...ignored, key])]; setIgnored(n); try { localStorage.setItem(LS_IGN, JSON.stringify(n)); } catch {} };
  const resetIgnored = () => { setIgnored([]); try { localStorage.removeItem(LS_IGN); } catch {} };

  /* ── তালিকা: টিক / মাস্টার / রিনেম (স্থির callback — memo সারি তাই হালকা) ── */
  const onTick = useCallback((id) => setSel((p) => ({ ...p, [id]: !p[id] })), []);
  const onMaster = useCallback((id) => { setMaster((m) => (m === id ? null : id)); setSel((p) => { if (!p[id]) return p; const n = { ...p }; delete n[id]; return n; }); }, []);
  const onRename = useCallback((t) => setRn({ id: t.id, val: t.name }), []);

  // মাস্টার + টিক → পরিকল্পনা (সব হিসাব তালিকার সংখ্যা থেকে, সার্ভারকে জিজ্ঞেস না করে)
  const tickedIds = Object.keys(sel).filter((k) => sel[k] && k !== master);
  const selCount = tickedIds.length + (master ? 1 : 0);
  let plan = null, planErr = "";
  if (selCount > 0) {
    const srcT = tickedIds.map((id) => byId[id]).filter(Boolean), mT = master ? byId[master] : null;
    let tgt = mT, srcs = srcT;
    if (!tgt && srcT.length >= 2) { tgt = srcT.slice().sort((a, b) => b.c.total - a.c.total)[0]; srcs = srcT.filter((t) => t.id !== tgt.id); }
    if (!tgt) planErr = srcT.length ? "আরেকটা টপিক টিক দাও, বা ⭐ চেপে মাস্টার বাছো" : "⭐ চেপে মাস্টার বাছো";
    else if (!srcs.length) planErr = "মাস্টারের ভেতরে যাবে এমন টপিক টিক দাও";
    else if (srcs.some((t) => t.subject_id !== tgt.subject_id)) planErr = "একই সাবজেক্টের টপিক ছাড়া মার্জ হয় না";
    else if (used.has(tgt.id) || srcs.some((t) => used.has(t.id))) planErr = "কিছু টপিক আগেই কিউতে আছে";
    if (tgt && srcs.length && !planErr) plan = { tgt, srcs, moved: srcs.reduce((a, t) => a + t.c.total, 0), auto: !mT };
  }
  const addToQueue = () => {
    if (!plan) return;
    const r = addMerge({ targetId: plan.tgt.id, targetName: plan.tgt.name, sourceIds: plan.srcs.map((t) => t.id), sourceNames: plan.srcs.map((t) => t.name), subjectId: plan.tgt.subject_id, newName, estQ: plan.moved });
    if (!r.ok) { push("warn", r.error, ""); return; }
    push("success", "➕ কিউতে যোগ হয়েছে", `${plan.tgt.name} ← ${bn(plan.srcs.length)}টা টপিক · +${bn(plan.moved)} প্রশ্ন`);
    setSel({}); setMaster(null); setNewName("");
  };
  const addGroupToQueue = (g) => {
    const st = gsel[g.key] || {}; const ts = g.topics.filter((t) => (st.checked ? st.checked[t.id] !== false : true));
    if (ts.length < 2) { push("warn", "মার্জের জন্য অন্তত ২টা টপিক টিক দাও", ""); return; }
    const tgt = (st.target && ts.find((t) => t.id === st.target)) || ts[0], srcs = ts.filter((t) => t.id !== tgt.id);
    const r = addMerge({ targetId: tgt.id, targetName: tgt.name, sourceIds: srcs.map((t) => t.id), sourceNames: srcs.map((t) => t.name), subjectId: tgt.subject_id, newName: st.newName || "", estQ: srcs.reduce((a, t) => a + t.c.total, 0) });
    if (!r.ok) { push("warn", r.error, ""); return; }
    push("success", "➕ কিউতে যোগ হয়েছে", `${tgt.name} ← ${bn(srcs.length)}টা টপিক`);
  };
  const doSubmit = () => {
    const r = submitQueue({ gasSecret });
    if (!r.ok) { push("warn", r.error, ""); return; }
    push("info", "🚀 ব্যাকগ্রাউন্ডে জমা হয়েছে", `${bn(r.count)}টা মার্জ যাচ্ছে — নিচের বারে অগ্রগতি দেখো। এখন অন্য কাজে যেতে পারো, শেষ হলে জানাবো`);
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
    push("success", "↩️ Undo হয়েছে", (r.kind === "merge" || r.kind === "mergeBatch") ? `${bn(r.questions || 0)}টা প্রশ্ন আগের টপিকে ফিরেছে${r.merges ? ` (${bn(r.merges)}টা মার্জ)` : ""}` : `${bn(r.topicsRestored || 0)}টা টপিক ফিরেছে`);
    await afterChange();
  };

  if (!gasSecret) return (
    <div className="card"><label style={lbl}>GAS Secret Key</label><GasSecretStatus/></div>
  );

  const subjectSelect = (
    <select className="inp" value={subj} onChange={(e) => setSubj(e.target.value)} style={{ marginBottom: 8 }}>
      <option value="">সব সাবজেক্ট ({bn(topics.length)}টা টপিক)</option>
      {[...(data?.subjects || [])].sort((a, b) => cmpName(a.name, b.name)).map((s) => <option key={s.id} value={s.id}>{s.name} ({bn(topics.filter((t) => t.subject_id === s.id).length)})</option>)}
    </select>
  );
  const delCount = Object.values(delSel).filter(Boolean).length;
  const emptyList = topics.filter((t) => isEmpty(t) && (!subj || t.subject_id === subj)).sort((a, b) => cmpName(subjName[a.subject_id] || "", subjName[b.subject_id] || "") || cmpName(a.name, b.name));
  const qInfoOf = (t) => { const u = used.get(t.id); if (!u) return ""; const run = u.state === "running" ? " (চলছে)" : ""; return u.role === "master" ? `⭐ কিউতে মাস্টার${run}` : `→ "${u.with}"-এ মার্জের অপেক্ষায়${run}`; };

  return (
    <div>
      {loadErr && <div className="card" style={{ border: `1px solid ${C.danger}`, color: C.danger, fontSize: 12, marginBottom: 10 }}>❌ {loadErr} <button className="btn" style={{ marginLeft: 8 }} onClick={load}>🔁 রিট্রাই</button>
        <div style={{ color: C.muted, marginTop: 6 }}>GAS-এ topic_manager.gs যোগ করে (আর code_updated.gs-এর ২টা tm_ ব্লক বসিয়ে) নতুন version ডিপ্লয় করেছ কিনা দেখো।{data ? " নিচে আগের (ক্যাশ-করা) তালিকা দেখানো হচ্ছে।" : ""}</div></div>}

      <div style={{ ...row, marginBottom: 12 }}>
        {TABS.map(([k, l]) => <span key={k} style={chip(tab === k)} onClick={() => setTab(k)}>{l}{k === "list" && qs.queue.length > 0 ? ` · ${bn(qs.queue.length)}` : ""}</span>)}
        {tab !== "rules" && <button className="btn" style={{ marginLeft: "auto" }} disabled={loading} onClick={load}>{loading ? "⏳" : "🔄"}</button>}
      </div>

      {tab !== "rules" && !data && !loadErr && <div style={{ color: C.muted, fontSize: 12, padding: 12 }}>⏳ টপিক লোড হচ্ছে…</div>}
      {tab !== "rules" && data && fromCache && !loadErr && <div style={{ fontSize: 10.5, color: C.muted, margin: "-6px 0 8px" }}>⏳ আগের তালিকা দেখানো হচ্ছে — নতুন তথ্য পেছনে আসছে…</div>}

      {(tab === "list" || tab === "merge") && data && <QueueTray qs={qs} onSubmit={doSubmit} submitting={false} />}

      {/* ══════════ 📊 তালিকা ══════════ */}
      {tab === "list" && data && <div>
        <div className="card" style={{ marginBottom: 10, fontSize: 12 }}>
          মোট <b>{bn(topics.length)}</b>টা টপিক · প্রশ্ন আছে <b>{bn(topics.length - zeroCount)}</b>টায় · <span style={{ color: zeroCount ? C.warning : C.muted }}>ফাঁকা <b>{bn(zeroCount)}</b>টা</span>
          <div style={{ fontSize: 10.5, color: C.muted, marginTop: 4, lineHeight: 1.6 }}>💡 ⭐ চেপে মাস্টার বাছো → যাদের ভেতরে মেশাবে তাদের টিক দাও → "➕ কিউতে যোগ"। এভাবে একটা একটা করে সাজিয়ে শেষে 🚀 সব জমা দাও।</div>
        </div>
        {subjectSelect}
        <input className="inp" value={q} onChange={(e) => setQ(e.target.value)} placeholder="🔍 টপিকের নাম / আইডি খোঁজো" style={{ marginBottom: 8 }} />
        <div style={{ ...row, marginBottom: 8 }}>
          <select className="inp" style={{ flex: 1 }} value={sort} onChange={(e) => setSort(e.target.value)}>
            <option value="name">A → Z / অ → হ (নাম অনুযায়ী)</option><option value="most">প্রশ্ন বেশি আগে</option><option value="least">প্রশ্ন কম আগে</option><option value="id">আইডি অনুযায়ী</option>
          </select>
          <span style={chip(onlyZero)} onClick={() => setOnlyZero(!onlyZero)}>শুধু ০ প্রশ্ন</span>
        </div>
        {sort === "name" && !subj && <div style={{ fontSize: 10.5, color: C.muted, marginBottom: 8 }}>ℹ️ একটা সাবজেক্ট বাছলে অক্ষর-লাফ বার আসবে (মার্জ শুধু একই সাবজেক্টের ভেতরে হয়)।</div>}
        {letters.length > 1 && <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginBottom: 10 }}>{letters.map(([L, i]) => <span key={L} style={{ ...chip(false), padding: "4px 9px", fontSize: 11.5 }} onClick={() => jumpTo(i)}>{L}</span>)}</div>}
        {shown.length === 0 && <div style={{ color: C.muted, fontSize: 12, textAlign: "center", padding: 16 }}>কিছু পাওয়া যায়নি</div>}
        {visible.map((t, i) => {
          const prev = i > 0 ? visible[i - 1] : null;
          const head = !subj && (i === 0 || prev.subject_id !== t.subject_id);
          const nearPrev = !!prev && prev.subject_id === t.subject_id && sort === "name" && near(prev.name, t.name);
          return (
            <React.Fragment key={t.id}>
              {head && <div style={{ fontSize: 11, fontWeight: 800, color: C.accent, margin: "12px 0 6px" }}>{subjName[t.subject_id] || t.subject_id}</div>}
              {rn?.id === t.id ? (
                <div style={{ ...row, flexWrap: "nowrap", padding: "8px 10px", marginBottom: 5, borderRadius: 10, border: `1px solid ${C.info}` }}>
                  <input className="inp" style={{ flex: 1, minWidth: 120 }} value={rn.val} onChange={(e) => setRn({ ...rn, val: e.target.value })} autoFocus />
                  <button className="btn bp" disabled={busy} onClick={doRename}>✓</button><button className="btn" onClick={() => setRn(null)}>✕</button>
                </div>
              ) : (
                <TopicRow t={t} checked={!!sel[t.id]} isMaster={master === t.id} qInfo={qInfoOf(t)} nearPrev={nearPrev} onTick={onTick} onMaster={onMaster} onRename={onRename} />
              )}
            </React.Fragment>
          );
        })}
        {shown.length > visible.length && <div ref={sentRef} style={{ textAlign: "center", padding: 10 }}>
          <button className="btn" onClick={() => setLim((l) => l + 200)}>⬇️ আরও দেখাও ({bn(shown.length - visible.length)}টা বাকি)</button></div>}
        {selCount > 0 && <div style={{ position: "sticky", bottom: 8, marginTop: 10, padding: 10, borderRadius: 12, background: C.card, border: `1.5px solid ${plan ? C.success : C.warning}`, boxShadow: "0 3px 14px #0004" }}>
          {plan ? (
            <>
              <div style={{ fontSize: 12.5, fontWeight: 800, marginBottom: 2 }}>⭐ {plan.tgt.name} ← {bn(plan.srcs.length)}টা টপিক</div>
              <div style={{ fontSize: 10.5, color: C.muted, marginBottom: 6, lineHeight: 1.5 }}>+{bn(plan.moved)}টা প্রশ্ন মাস্টারে আসবে (এখন {bn(plan.tgt.c.total)} → {bn(plan.tgt.c.total + plan.moved)}){plan.auto ? " · মাস্টার নিজে বাছোনি, তাই সবচেয়ে বেশি প্রশ্নেরটা ধরা হয়েছে (বদলাতে অন্য টপিকের ⭐ চাপো)" : ""}</div>
              <input className="inp" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder={`চূড়ান্ত নাম (ফাঁকা রাখলে “${plan.tgt.name}”)`} style={{ marginBottom: 6, fontSize: 12 }} />
            </>
          ) : <div style={{ fontSize: 12, color: C.warning, fontWeight: 700, marginBottom: 6 }}>⚠️ {planErr}</div>}
          <div style={row}>
            <span style={{ fontSize: 11, color: C.muted }}>{bn(selCount)}টা বাছা</span>
            <button className="btn" onClick={() => { setSel({}); setMaster(null); setNewName(""); }}>পরিষ্কার</button>
            <button className="btn bp" style={{ marginLeft: "auto" }} disabled={!plan} onClick={addToQueue}>➕ কিউতে যোগ</button>
          </div>
        </div>}
      </div>}

      {/* ══════════ 🔀 মার্জ (কাছাকাছি টপিক) ══════════ */}
      {tab === "merge" && data && <div>
        <div style={{ fontSize: 11.5, color: C.muted, marginBottom: 8, lineHeight: 1.6 }}>একই সাবজেক্টের কাছাকাছি নামের টপিক পাশাপাশি দেখানো হচ্ছে। এটা শুধু সাজেশন — কোনটা মার্জ হবে তুমি ঠিক করবে। "➕ কিউতে যোগ" সাথে সাথে হয়; সব সাজানো হলে ওপরের কিউ থেকে একবারে 🚀 জমা দাও।</div>
        {subjectSelect}
        <div style={{ ...row, marginBottom: 10 }}>
          {[["high", "খুব মিল"], ["mid", "মাঝারি"], ["low", "কম কঠোর"]].map(([k, l]) => <span key={k} style={chip(sens === k)} onClick={() => setSens(k)}>{l}</span>)}
        </div>
        <div style={{ fontSize: 11, color: C.muted, marginBottom: 8 }}>{bn(visibleGroups.length)}টা গ্রুপ{ignored.length ? ` · ${bn(ignored.length)}টা "আলাদা" চিহ্নিত ` : ""}
          {ignored.length > 0 && <><span style={{ color: C.info, cursor: "pointer" }} onClick={() => setShowIgn(!showIgn)}>{showIgn ? "লুকাও" : "দেখাও"}</span> · <span style={{ color: C.info, cursor: "pointer" }} onClick={resetIgnored}>রিসেট</span></>}</div>
        {visibleGroups.length === 0 && <div style={{ color: C.muted, fontSize: 12, textAlign: "center", padding: 18 }}>এই সেটিংয়ে কাছাকাছি মিলের টপিক পাওয়া যায়নি। "কম কঠোর" চেষ্টা করো।</div>}
        {visibleGroups.map((g) => {
          const st = gsel[g.key] || {}; const on = (id) => (st.checked ? st.checked[id] !== false : true); const tgt = st.target || g.topics[0].id;
          const isIgn = ignored.includes(g.key), inQueue = g.topics.some((t) => used.has(t.id));
          return (
            <div key={g.key} className="card" style={{ marginBottom: 10, opacity: isIgn || inQueue ? 0.55 : 1 }}>
              <div style={{ ...row, justifyContent: "space-between", marginBottom: 6 }}>
                <span style={{ fontSize: 11, fontWeight: 800, color: C.accent }}>{subjName[g.subject_id]}</span>
                <span style={{ fontSize: 10, color: C.muted }}>মিল {bn(Math.round(g.score * 100))}% · মোট {bn(g.total)}টা প্রশ্ন</span>
              </div>
              {g.topics.map((t) => (
                <div key={t.id} style={{ ...row, flexWrap: "nowrap", padding: "6px 0", borderTop: `1px dashed ${C.border}` }}>
                  <input type="checkbox" checked={on(t.id)} style={{ width: 18, height: 18, flexShrink: 0 }} onChange={() => setGsel({ ...gsel, [g.key]: { ...st, target: tgt, checked: { ...(st.checked || {}), [t.id]: !on(t.id) } } })} />
                  <span style={{ cursor: "pointer", fontSize: 15 }} title="এটাই মাস্টার (থাকবে)" onClick={() => setGsel({ ...gsel, [g.key]: { ...st, checked: st.checked, target: t.id } })}>{tgt === t.id ? "⭐" : "○"}</span>
                  <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontSize: 13, fontWeight: 700 }}>{t.name}</div><div style={{ fontSize: 9.5, color: C.muted }}>{t.id}{t.c.rules ? ` · 🏷 ${bn(t.c.rules)} রুল` : ""}{used.has(t.id) ? " · 📋 কিউতে আছে" : ""}</div></div>
                  <Count c={t.c} />
                </div>
              ))}
              <input className="inp" style={{ marginTop: 6, fontSize: 12 }} value={st.newName || ""} placeholder="চূড়ান্ত নাম (ঐচ্ছিক — ফাঁকা রাখলে মাস্টারের নামই)" onChange={(e) => setGsel({ ...gsel, [g.key]: { ...st, target: st.target, checked: st.checked, newName: e.target.value } })} />
              <div style={{ ...row, marginTop: 8 }}>
                {!isIgn && <button className="btn" onClick={() => ignoreGroup(g.key)}>আলাদা রাখো</button>}
                <button className="btn bp" style={{ marginLeft: "auto" }} disabled={inQueue} onClick={() => addGroupToQueue(g)}>➕ কিউতে যোগ</button>
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
            <div>টপিক-ছাড়া (topic_id ফাঁকা) প্রশ্ন: <b style={{ color: (data.health||{}).blankQ ? C.warning : C.success }}>{bn((data.health||{}).blankQ)}</b>{(data.health||{}).blankQIds?.length ? <span style={{ color: C.muted, fontSize: 10 }}> ({(data.health||{}).blankQIds.slice(0, 6).join(", ")}{(data.health||{}).blankQ > 6 ? "…" : ""})</span> : null}</div>
            <div>অচেনা topic_id-র প্রশ্ন (Topics শিটে নেই): <b style={{ color: (data.health||{}).orphanQ ? C.danger : C.success }}>{bn((data.health||{}).orphanQ)}</b></div>
            {(data.health||{}).orphanTopics?.length > 0 && <div style={{ fontSize: 10.5, color: C.muted }}>{(data.health||{}).orphanTopics.slice(0, 10).map((o) => `${o.topic_id} (${bn(o.n)})`).join(" · ")}</div>}
            <div>Study: ফাঁকা {bn((data.health||{}).blankStudy)} · অচেনা {bn((data.health||{}).orphanStudy)}</div>
          </div>
          {((data.health||{}).blankQ > 0 || (data.health||{}).orphanQ > 0) && <div style={{ fontSize: 11, color: C.muted, marginTop: 6 }}>এগুলো মডেল টেস্টে বাদ পড়বে। টপিক-ছাড়া/অচেনা প্রশ্ন ঠিক করতে Orphan Fix বা রুল (🏷) ব্যবহার করো।</div>}
        </div>
        <div className="card">
          <div style={{ ...row, justifyContent: "space-between", marginBottom: 8 }}>
            <div style={{ fontSize: 13, fontWeight: 700 }}>🕘 শেষ কাজগুলো</div>
            <button className="btn" disabled={busy || !log.some((x) => !x.undone)} onClick={doUndo}>↩️ সর্বশেষটা Undo</button>
          </div>
          {log.length === 0 && <div style={{ fontSize: 12, color: C.muted }}>এখনো কোনো মার্জ/মোছা হয়নি</div>}
          {log.map((x) => (
            <div key={x.log_id} style={{ padding: "7px 0", borderTop: `1px dashed ${C.border}`, opacity: x.undone ? 0.5 : 1 }}>
              <div style={{ fontSize: 12, fontWeight: 700 }}>{x.kind === "merge" ? "🔀" : x.kind === "mergeBatch" ? "🔀📦" : "🗑"} {x.summary} {x.undone && <span style={{ color: C.muted }}>· ↩️ ফেরত</span>}</div>
              <div style={{ fontSize: 9.5, color: C.muted }}>{x.time ? new Date(x.time).toLocaleString("bn-BD") : ""}</div>
            </div>
          ))}
          <div style={{ fontSize: 10.5, color: C.muted, marginTop: 8 }}>Undo শুধু সর্বশেষ কাজ ফেরত দেয় (একে একে পেছনে যাওয়া যায়)।</div>
        </div>
      </div>}

      {tab === "rules" && <TopicTagsTab push={push} />}

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
