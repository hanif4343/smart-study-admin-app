/* ══════════ QBank Written — "পরীক্ষার খাতা" ভিউ ══════════
   BrowseTab-এর QBank মোডে "📄 পেপার ভিউ" চাপলে কার্ডের বদলে এটা দেখায়: পরীক্ষা (পদ/প্রতিষ্ঠান/সাল) ধরে প্রশ্নপত্রের ছাঁচে —
   হলুদ/কমলা/নীল হেডার, ০১। নির্দেশ, ক) খ) গ) উপ-প্রশ্ন, উত্তর, "সমাধান" ব্লক, অশুদ্ধ|শুদ্ধ টেবিল। শুধু দেখা — এডিট/ডিলিট আগের কার্ড-ভিউ থেকে। */
import React, { useMemo, useState } from "react";
import { C } from "../../core/config.js";
import { RichText } from "../../components/shared/RichText.jsx";
import { buildPapers, toBn, renderStyled, tableHeads } from "../../core/writtenPaper.js";

const CSS = `
.wpv{background:#fff;color:#000;border:1px solid #C9BFA0;border-radius:8px;margin-bottom:12px;overflow:hidden;font-family:"Noto Sans Bengali","Hind Siliguri",system-ui,sans-serif;font-size:14px}
.wpv .h0{font-size:11px;font-weight:800;padding:3px 8px;border-bottom:2px solid #000;background:#fff}
.wpv .b1{background:#FFEB00;text-align:center;font-weight:800;font-size:19px;padding:5px;cursor:pointer}
.wpv .b2{background:#E8710A;text-align:center;font-weight:800;font-size:16px;padding:3px;cursor:pointer}
.wpv .b3{background:#1F2A6B;color:#fff;display:flex;justify-content:space-between;font-weight:800;font-size:12px;padding:4px 8px;cursor:pointer}
.wpv .body{padding:8px 12px 12px;column-gap:22px}
@media(min-width:760px){.wpv .body{column-count:2;column-rule:1px solid #000}}
.wpv .sec{break-inside:avoid-column;margin:0 0 9px}
.wpv .subj{background:#EEE;font-weight:800;text-align:center;padding:2px;margin:6px 0;border-top:1px solid #000;border-bottom:1px solid #000;break-after:avoid}
.wpv .hd{font-weight:800;margin-bottom:3px}
.wpv .it{display:grid;grid-template-columns:24px minmax(0,1fr);column-gap:4px;line-height:1.45;margin:0 0 2px 4px}
.wpv .it.two{grid-template-columns:24px minmax(0,1.15fr) minmax(0,1fr)}
.wpv .ans{color:#1B5E20;font-weight:700}
.wpv .sol{display:inline-block;background:#1F2A6B;color:#fff;font-size:11px;font-weight:800;padding:0 5px;margin-right:5px;border-radius:2px}
.wpv table{border-collapse:collapse;width:100%;margin:2px 0}
.wpv th,.wpv td{border:1px solid #000;padding:1px 6px;text-align:center}
.wpv th{background:#EEE}
.wpv .ft{border-top:2px solid #000;padding:3px 8px;font-size:10px;font-weight:700;display:flex;justify-content:space-between;color:#333}
.wpv.en .sec{font-family:Georgia,"Times New Roman",serif}
`;
const hasBn = (s) => /[\u0980-\u09FF]/.test(String(s || ""));

function Item({ it, fmt, showAns }) {
  const q = renderStyled(it.q, fmt);
  return (
    <>
      <div className={`it${showAns && it.a && fmt !== "fillblank" ? " two" : ""}`}>
        <span>{it.label}</span>
        <span><RichText text={q} /></span>
        {showAns && it.a && (fmt === "fillblank"
          ? <span style={{ gridColumn: "2 / -1" }} className="ans">উত্তর: <RichText text={it.a} /></span>
          : <span className="ans">= <RichText text={it.a} /></span>)}
      </div>
      {showAns && it.exp && <div className="it" style={{ gridTemplateColumns: "1fr" }}><div><span className="sol">সমাধান</span><RichText text={it.exp} /></div></div>}
    </>
  );
}

function Section({ s, showAns, prevSubject }) {
  const num = toBn(String(s.num).padStart(2, "0"));
  const bar = s.subject && s.subject !== prevSubject;
  return (
    <>
      {bar && <div className="subj">{s.subject}</div>}
      <div className="sec">
        {s.type === "group" && s.heading && <div className="hd">{num}। {s.heading}</div>}
        {s.fmt === "table" && s.type === "group" ? (
          <table><thead><tr>{tableHeads(s.heading).map((h) => <th key={h}>{h}</th>)}</tr></thead>
            <tbody>{s.items.map((it) => <tr key={it.id}><td><RichText text={it.q} /></td><td>{showAns ? <RichText text={it.a} /> : "……"}</td></tr>)}</tbody></table>
        ) : s.type === "single" ? (
          <div className="it"><span style={{ fontWeight: 800 }}>{num}।</span>
            <span><RichText text={renderStyled(s.items[0].q, s.fmt)} />
              {showAns && s.items[0].a && <div className="ans">উত্তর: <RichText text={s.items[0].a} /></div>}
              {showAns && s.items[0].exp && <div><span className="sol">সমাধান</span><RichText text={s.items[0].exp} /></div>}</span></div>
        ) : s.items.map((it) => <Item key={it.id} it={it} fmt={s.fmt} showAns={showAns} />)}
      </div>
    </>
  );
}

function Paper({ p, open, onToggle, showAns }) {
  const en = p.sections[0] && !hasBn(p.sections[0].heading || (p.sections[0].items[0] || {}).q);
  let prev = "";
  return (
    <div className={`wpv${en ? " en" : ""}`}>
      <div className="h0">QBank · Written Paper</div>
      <div className="b1" onClick={onToggle}>{p.unknown ? "পরীক্ষা অজানা (Post/Inst নেই)" : (p.instName || "—")}</div>
      <div className="b2" onClick={onToggle}>{p.postName || "—"}</div>
      <div className="b3" onClick={onToggle}><span>সাল: {p.year ? p.year : "—"}</span><span>প্রশ্ন: {toBn(p.qCount)}টি</span><span>{open ? "▲ বন্ধ" : "▼ খোলো"}</span></div>
      {open && <div className="body">{p.sections.map((s) => { const el = <Section key={s.num} s={s} showAns={showAns} prevSubject={prev} />; prev = s.subject || prev; return el; })}</div>}
      <div className="ft"><span>Admin Preview</span><span>{p.sections.length}টি সেকশন</span></div>
    </div>
  );
}

export function WrittenPaperView({ questions, appearances, postNameOf, instNameOf, totalCount }) {
  const [showAns, setShowAns] = useState(true);
  const [openKeys, setOpenKeys] = useState(() => new Set());
  const papers = useMemo(() => buildPapers({ questions, appearances, postNameOf, instNameOf }), [questions, appearances, postNameOf, instNameOf]);
  const single = papers.length === 1;
  const isOpen = (k) => single || openKeys.has(k);
  const toggle = (k) => setOpenKeys((p) => { const n = new Set(p); n.has(k) ? n.delete(k) : n.add(k); return n; });

  if (!papers.length) return <div className="empty"><div className="ei">📄</div><p>এই ফিল্টারে কোনো Written প্রশ্ন নেই{totalCount ? ` (${toBn(totalCount)}টা প্রশ্নের সবগুলোই MCQ/অন্য ধরনের)` : ""}</p><p style={{ fontSize: 11 }}>পেপার ভিউ শুধু Written প্রশ্ন দেখায় — পদ/প্রতিষ্ঠান ফিল্টার ছেড়ে দিয়ে দেখো।</p></div>;
  return (
    <div>
      <style>{CSS}</style>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 10 }}>
        <span style={{ fontSize: 11, color: C.muted }}>{toBn(papers.length)}টা প্রশ্নপত্র · {toBn(questions.length)}টা Written প্রশ্ন</span>
        <button className="btn" style={{ marginLeft: "auto" }} onClick={() => setShowAns(!showAns)}>{showAns ? "🙈 উত্তর লুকাও" : "👁 উত্তর দেখাও"}</button>
        {!single && <button className="btn" onClick={() => setOpenKeys(openKeys.size ? new Set() : new Set(papers.map((p) => p.key)))}>{openKeys.size ? "সব বন্ধ" : "সব খোলো"}</button>}
      </div>
      {papers.map((p) => <Paper key={p.key} p={p} open={isOpen(p.key)} onToggle={() => toggle(p.key)} showAns={showAns} />)}
    </div>
  );
}
