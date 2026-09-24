/* ══════════ GEOMETRY DRAWING (Phase 1) ══════════
   জ্যামিতির ডায়াগ্রাম আঁকার টুল — প্রশ্ন-এন্ট্রি পেজের 🖼️ বাটনের পাশে ✏️ বাটন
   থেকে খোলে। আঁকা শেষে PNG এক্সপোর্ট করে বিদ্যমান uploadImg() pipeline দিয়েই
   আপলোড হয় (আলাদা কোনো storage/backend বানাতে হয়নি) — ঠিক ছবি-আপলোডের মতোই
   URL কার্সরে বসে যায়।

   ডেটা মডেল: প্রতিটা shape-এর একটা points[] অ্যারে থাকে — টাইপ ভেদে অর্থ আলাদা:
     point  → points=[{x,y}]                          (single dot)
     poly   → points=[{x,y},...]  (closed/arrow flag)  (line/arrow/rect/triangle/polygon সবই এই এক টাইপ)
     circle → points=[center,{x,y} radius-handle]      (radius = দুই পয়েন্টের দূরত্ব)
     angle  → points=[vertex, p1, p2]                  (দুটো রে + মাঝে arc)
     text   → points=[{x,y}], text, fontSize
   এভাবে একটাই "points" কনসেপ্ট সব shape-এ — তাই select মোডে প্রতিটা shape-এর
   প্রতিটা point-ই এক রকম হ্যান্ডেল দিয়ে "pull" করা যায় (ইউজারের "all point can
   be pull" রিকোয়ারমেন্ট)। poly (closed, ≥3 পয়েন্ট) শেপে আলাদা একটা ⤡ resize
   হ্যান্ডেলও থাকে পুরো শেপ uniformly বড়/ছোট করার জন্য।
   ══════════════════════════════════════════════════════════ */
import { useState, useRef, useCallback } from "react";
import { C, tint } from "../../core/config.js";
import { uploadImg } from "../../core/utils.js";

const VB_W = 600, VB_H = 400;
const COLORS = ["#111827", "#ef4444", "#2563eb", "#16a34a", "#f59e0b"];
const WIDTHS = [1.5, 3, 5];

const TOOLS = [
  { id: "select", icon: "🖱️", label: "সিলেক্ট/মুভ" },
  { id: "point", icon: "•", label: "পয়েন্ট" },
  { id: "line", icon: "╱", label: "লাইন" },
  { id: "arrow", icon: "→", label: "অ্যারো" },
  { id: "circle", icon: "○", label: "বৃত্ত" },
  { id: "rect", icon: "▭", label: "আয়তক্ষেত্র" },
  { id: "poly", icon: "▲", label: "ত্রিভুজ/বহুভুজ" },
  { id: "angle", icon: "∠", label: "কোণ" },
  { id: "text", icon: "T", label: "টেক্সট/লেবেল" },
];
// এই টুলগুলো ঠিক এতগুলো ট্যাপেই কমিট হয়ে যায় (poly বাদে — সেটা ম্যানুয়াল ✓ দিয়ে শেষ হয়)
const TAPS_NEEDED = { point: 1, line: 2, arrow: 2, circle: 2, rect: 2, angle: 3 };

let uidSeq = 0;
const newId = () => `g${Date.now()}_${uidSeq++}`;
const dist = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);
const bboxOf = (pts) => ({
  minX: Math.min(...pts.map(p => p.x)), maxX: Math.max(...pts.map(p => p.x)),
  minY: Math.min(...pts.map(p => p.y)), maxY: Math.max(...pts.map(p => p.y)),
});

function GeometryDrawing({ onClose, onInsert, push }) {
  const [shapes, setShapes] = useState([]);
  const [history, setHistory] = useState([]);
  const [future, setFuture] = useState([]);
  const [tool, setTool] = useState("select");
  const [selectedId, setSelectedId] = useState(null);
  const [draft, setDraft] = useState(null); // ট্যাপ করে করে বানানোর সময় in-progress shape
  const [style, setStyle] = useState({ stroke: "#111827", strokeWidth: 3, fill: false, fillColor: "#111827" });
  const [dragRef, setDragRef] = useState(null); // {kind:"point"|"move"|"resize", shapeId, idx, start...}
  const [exporting, setExporting] = useState(false);
  // 🆕 Phase 2: grid/snap + coordinate axes
  const [showGrid, setShowGrid] = useState(false);
  const [snapGrid, setSnapGrid] = useState(false);
  const [showAxes, setShowAxes] = useState(false);
  // 🆕 Phase 3 (হালকা ভার্সন): লোকাল টেমপ্লেট — বারবার লাগে এমন ফিগার সেভ/লোড
  const [showTemplates, setShowTemplates] = useState(false);
  const [templates, setTemplates] = useState(() => {
    try { return JSON.parse(localStorage.getItem("gd_templates") || "[]"); } catch { return []; }
  });

  const svgRef = useRef(null);
  const shapesLayerRef = useRef(null);
  const gridLayerRef = useRef(null);

  const selected = shapes.find(s => s.id === selectedId) || null;

  const pushHistory = useCallback(() => {
    setHistory(h => [...h.slice(-29), shapes]);
    setFuture([]);
  }, [shapes]);

  const undo = useCallback(() => {
    setHistory(h => {
      if (!h.length) return h;
      setFuture(f => [shapes, ...f]);
      setShapes(h[h.length - 1]);
      setSelectedId(null);
      return h.slice(0, -1);
    });
  }, [shapes]);
  const redo = useCallback(() => {
    setFuture(f => {
      if (!f.length) return f;
      setHistory(h => [...h, shapes]);
      setShapes(f[0]);
      setSelectedId(null);
      return f.slice(1);
    });
  }, [shapes]);

  const GRID = 20;
  const toSvgPoint = useCallback((clientX, clientY) => {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const rect = svg.getBoundingClientRect();
    let x = ((clientX - rect.left) / rect.width) * VB_W;
    let y = ((clientY - rect.top) / rect.height) * VB_H;
    x = Math.max(0, Math.min(VB_W, x));
    y = Math.max(0, Math.min(VB_H, y));
    if (snapGrid) { x = Math.round(x / GRID) * GRID; y = Math.round(y / GRID) * GRID; }
    return { x, y };
  }, [snapGrid]);

  /* ── নতুন shape কমিট করা ── */
  const commitShape = useCallback((finalShape) => {
    pushHistory();
    setShapes(sh => [...sh, finalShape]);
    setDraft(null);
    setTool("select");
    setSelectedId(finalShape.id);
  }, [pushHistory]);

  /* ── ক্যানভাসে ট্যাপ: শেপ বানানোর জন্য পয়েন্ট বসানো, বা select-মোডে deselect ── */
  const onCanvasTap = useCallback((e) => {
    if (dragRef) return;
    const p = toSvgPoint(e.clientX, e.clientY);

    if (tool === "select") { setSelectedId(null); return; }

    if (tool === "text") {
      const text = window.prompt("লেবেল টেক্সট লিখো:", "");
      if (text && text.trim()) {
        commitShape({ id: newId(), type: "text", points: [p], text: text.trim(), fontSize: 22, ...style });
      }
      return;
    }

    if (tool === "point") {
      commitShape({ id: newId(), type: "point", points: [p], ...style });
      return;
    }

    if (tool === "poly") {
      setDraft(d => ({ id: d?.id || newId(), type: "poly", closed: true, points: [...(d?.points || []), p], ...style }));
      return;
    }

    // line / arrow / circle / rect / angle — ঠিক N-তম ট্যাপে auto-commit
    const need = TAPS_NEEDED[tool];
    setDraft(d => {
      const pts = [...(d?.points || []), p];
      if (pts.length >= need) {
        let finalShape;
        if (tool === "rect") {
          const [a, b] = pts;
          finalShape = { id: newId(), type: "poly", closed: true, points: [{ x: a.x, y: a.y }, { x: b.x, y: a.y }, { x: b.x, y: b.y }, { x: a.x, y: b.y }], ...style };
        } else if (tool === "circle") {
          finalShape = { id: newId(), type: "circle", points: pts, ...style };
        } else if (tool === "angle") {
          finalShape = { id: newId(), type: "angle", points: pts, ...style };
        } else { // line/arrow
          finalShape = { id: newId(), type: "poly", closed: false, arrow: tool === "arrow", points: pts, ...style };
        }
        commitShape(finalShape);
        return null;
      }
      return { id: d?.id || newId(), type: "draft", points: pts, ...style };
    });
  }, [tool, dragRef, toSvgPoint, commitShape, style]);

  const finishPoly = useCallback(() => {
    if (!draft || draft.points.length < 3) return;
    commitShape({ id: draft.id, type: "poly", closed: true, points: draft.points, ...style });
  }, [draft, commitShape, style]);
  const cancelDraft = useCallback(() => setDraft(null), []);

  /* ── হ্যান্ডেল ড্র্যাগ শুরু (point pull / whole-shape move / uniform resize) ── */
  const startHandleDrag = useCallback((e, kind, shapeId, idx) => {
    e.stopPropagation();
    e.preventDefault();
    const p = toSvgPoint(e.clientX, e.clientY);
    const shape = shapes.find(s => s.id === shapeId);
    pushHistory();
    setDragRef({ kind, shapeId, idx, startPt: p, origPoints: shape.points.map(pt => ({ ...pt })) });
  }, [shapes, toSvgPoint, pushHistory]);

  const onPointerMove = useCallback((e) => {
    if (!dragRef) return;
    const p = toSvgPoint(e.clientX, e.clientY);
    setShapes(sh => sh.map(s => {
      if (s.id !== dragRef.shapeId) return s;
      if (dragRef.kind === "point") {
        const pts = s.points.map((pt, i) => (i === dragRef.idx ? p : pt));
        return { ...s, points: pts };
      }
      if (dragRef.kind === "move") {
        const dx = p.x - dragRef.startPt.x, dy = p.y - dragRef.startPt.y;
        return { ...s, points: dragRef.origPoints.map(pt => ({ x: pt.x + dx, y: pt.y + dy })) };
      }
      if (dragRef.kind === "resize") {
        const box = bboxOf(dragRef.origPoints);
        const anchor = { x: box.minX, y: box.minY };
        const origCorner = { x: box.maxX, y: box.maxY };
        const origD = Math.max(dist(anchor, origCorner), 1);
        const newD = dist(anchor, p);
        const scale = Math.max(0.15, newD / origD);
        return { ...s, points: dragRef.origPoints.map(pt => ({ x: anchor.x + (pt.x - anchor.x) * scale, y: anchor.y + (pt.y - anchor.y) * scale })) };
      }
      return s;
    }));
  }, [dragRef, toSvgPoint]);

  const onPointerUp = useCallback(() => setDragRef(null), []);

  const deleteSelected = useCallback(() => {
    if (!selectedId) return;
    pushHistory();
    setShapes(sh => sh.filter(s => s.id !== selectedId));
    setSelectedId(null);
  }, [selectedId, pushHistory]);

  const updateSelectedStyle = useCallback((patch) => {
    if (!selectedId) { setStyle(s => ({ ...s, ...patch })); return; }
    pushHistory();
    setShapes(sh => sh.map(s => (s.id === selectedId ? { ...s, ...patch } : s)));
  }, [selectedId, pushHistory]);

  // 🆕 Phase 2: duplicate (হালকা অফসেট দিয়ে, যাতে আসলটার উপর ঠিক বসে না যায়)
  const duplicateSelected = useCallback(() => {
    if (!selected) return;
    pushHistory();
    const clone = { ...selected, id: newId(), points: selected.points.map(p => ({ x: p.x + 16, y: p.y + 16 })) };
    setShapes(sh => [...sh, clone]);
    setSelectedId(clone.id);
  }, [selected, pushHistory]);

  // 🆕 Phase 2: layering — shapes অ্যারেতে পরে থাকা মানেই উপরে আঁকা হয় (front),
  // তাই সামনে/পিছনে আনা মানে অ্যারেতে শেষে/শুরুতে সরিয়ে দেওয়া
  const bringToFront = useCallback(() => {
    if (!selectedId) return;
    pushHistory();
    setShapes(sh => { const s = sh.find(x => x.id === selectedId); return s ? [...sh.filter(x => x.id !== selectedId), s] : sh; });
  }, [selectedId, pushHistory]);
  const sendToBack = useCallback(() => {
    if (!selectedId) return;
    pushHistory();
    setShapes(sh => { const s = sh.find(x => x.id === selectedId); return s ? [s, ...sh.filter(x => x.id !== selectedId)] : sh; });
  }, [selectedId, pushHistory]);

  // 🆕 Phase 3 (হালকা): বর্তমান পুরো ড্রয়িং একটা টেমপ্লেট হিসেবে ফোনেই (localStorage)
  // সেভ — এই অ্যাডমিনের ডিভাইসেই থাকবে, বারবার আঁকতে হবে না এমন কমন ফিগার
  // (যেমন "লেবেল করা সমকোণী ত্রিভুজ") একবার বানিয়ে বারবার লোড করা যাবে
  const saveAsTemplate = useCallback(() => {
    if (!shapes.length) { push?.("warn", "কিছু আঁকা হয়নি", "সেভ করার মতো কিছু নেই"); return; }
    const name = window.prompt("টেমপ্লেটের নাম দাও:", "");
    if (!name || !name.trim()) return;
    const next = [...templates, { id: newId(), name: name.trim(), shapes, savedAt: Date.now() }].slice(-30);
    setTemplates(next);
    try { localStorage.setItem("gd_templates", JSON.stringify(next)); } catch {}
    push?.("success", "💾 টেমপ্লেট সেভ হয়েছে", name.trim());
  }, [shapes, templates, push]);
  const loadTemplate = useCallback((t) => {
    pushHistory();
    setShapes(t.shapes.map(s => ({ ...s, id: newId() }))); // নতুন id — আসল টেমপ্লেট অক্ষত থাকে
    setSelectedId(null); setShowTemplates(false);
    push?.("success", "♻️ টেমপ্লেট লোড হলো", t.name);
  }, [pushHistory, push]);
  const deleteTemplate = useCallback((id) => {
    const next = templates.filter(t => t.id !== id);
    setTemplates(next);
    try { localStorage.setItem("gd_templates", JSON.stringify(next)); } catch {}
  }, [templates]);

  /* ── শেপ রেন্ডার (এডিটিং ক্যানভাস + এক্সপোর্ট markup দুটোতেই একই DOM ব্যবহার হয়) ── */
  const renderShape = (s, editable) => {
    const fillable = s.type === "circle" || (s.type === "poly" && s.closed);
    const strokeProps = { stroke: s.stroke, strokeWidth: s.strokeWidth, fill: (fillable && s.fill) ? s.fillColor : "none", strokeLinecap: "round", strokeLinejoin: "round" };
    const onDownBody = editable ? (e) => { if (tool === "select") { setSelectedId(s.id); startHandleDrag(e, "move", s.id, null); } } : undefined;

    if (s.type === "point") {
      const p = s.points[0];
      return <circle key={s.id} cx={p.x} cy={p.y} r={s.strokeWidth + 2} fill={s.stroke} onPointerDown={onDownBody} />;
    }
    if (s.type === "text") {
      const p = s.points[0];
      return <text key={s.id} x={p.x} y={p.y} fontSize={s.fontSize} fill={s.stroke} fontFamily="sans-serif" onPointerDown={onDownBody}>{s.text}</text>;
    }
    if (s.type === "circle" || (s.type === "draft" && draft?.type === "circle")) {
      const [c, r0] = s.points;
      if (!r0) return null;
      return <circle key={s.id} cx={c.x} cy={c.y} r={dist(c, r0)} {...strokeProps} onPointerDown={onDownBody} />;
    }
    if (s.type === "angle") {
      const [v, p1, p2] = s.points;
      if (!p1) return <g key={s.id}>{s.points.map((pt, i) => <circle key={i} cx={pt.x} cy={pt.y} r={4} fill={s.stroke} />)}</g>;
      if (!p2) return <g key={s.id} onPointerDown={onDownBody}><line x1={v.x} y1={v.y} x2={p1.x} y2={p1.y} {...strokeProps} /></g>;
      const rArc = 28;
      const dir = (from, to) => { const d = dist(from, to) || 1; return { x: (to.x - from.x) / d, y: (to.y - from.y) / d }; };
      const d1 = dir(v, p1), d2 = dir(v, p2);
      const a1 = { x: v.x + d1.x * rArc, y: v.y + d1.y * rArc };
      const a2 = { x: v.x + d2.x * rArc, y: v.y + d2.y * rArc };
      const cross = d1.x * d2.y - d1.y * d2.x;
      // 🆕 Phase 2: কোণ অটো-মাপা — dot product দিয়ে ডিগ্রি বের করে arc-এর
      // পাশে লেবেল হিসেবে বসানো (ম্যানুয়ালি টেক্সট বসাতে হয় না)
      const dot = Math.max(-1, Math.min(1, d1.x * d2.x + d1.y * d2.y));
      const degrees = Math.round((Math.acos(dot) * 180) / Math.PI);
      const bisector = { x: d1.x + d2.x, y: d1.y + d2.y };
      const bLen = Math.hypot(bisector.x, bisector.y) || 1;
      const labelPos = { x: v.x + (bisector.x / bLen) * (rArc + 16), y: v.y + (bisector.y / bLen) * (rArc + 16) };
      return (
        <g key={s.id} onPointerDown={onDownBody}>
          <line x1={v.x} y1={v.y} x2={p1.x} y2={p1.y} {...strokeProps} strokeWidth={s.strokeWidth} />
          <line x1={v.x} y1={v.y} x2={p2.x} y2={p2.y} {...strokeProps} strokeWidth={s.strokeWidth} />
          <path d={`M ${a1.x} ${a1.y} A ${rArc} ${rArc} 0 0 ${cross < 0 ? 1 : 0} ${a2.x} ${a2.y}`} fill="none" stroke={s.stroke} strokeWidth={Math.max(1, s.strokeWidth - 1)} />
          <text x={labelPos.x} y={labelPos.y} fontSize={14} fill={s.stroke} fontFamily="sans-serif" textAnchor="middle">{degrees}°</text>
        </g>
      );
    }
    // poly (line/arrow/rect/triangle/polygon) + in-progress draft প্রিভিউ
    const pts = s.points;
    if (pts.length < 2) return <g key={s.id}>{pts.map((pt, i) => <circle key={i} cx={pt.x} cy={pt.y} r={4} fill={s.stroke} />)}</g>;
    const ptsAttr = pts.map(pt => `${pt.x},${pt.y}`).join(" ");
    const Tag = s.closed ? "polygon" : "polyline";
    return (
      <g key={s.id} onPointerDown={onDownBody}>
        <Tag points={ptsAttr} {...strokeProps} markerEnd={s.arrow ? "url(#gd-arrowhead)" : undefined} />
      </g>
    );
  };

  // 🆕 Phase 2: গ্রিড + অক্ষ — pointer-events none (ট্যাপ যেন এর মধ্য দিয়ে ক্যানভাসেই যায়),
  // showGrid/showAxes true থাকলে এক্সপোর্ট করা ছবিতেও থাকবে (স্থানাঙ্ক জ্যামিতির জন্য দরকারি)
  const renderGridAndAxes = () => (
    <g style={{ pointerEvents: "none" }}>
      {showGrid && Array.from({ length: Math.floor(VB_W / GRID) + 1 }).map((_, i) => (
        <line key={"gv" + i} x1={i * GRID} y1={0} x2={i * GRID} y2={VB_H} stroke="#e5e7eb" strokeWidth={1} />
      ))}
      {showGrid && Array.from({ length: Math.floor(VB_H / GRID) + 1 }).map((_, i) => (
        <line key={"gh" + i} x1={0} y1={i * GRID} x2={VB_W} y2={i * GRID} stroke="#e5e7eb" strokeWidth={1} />
      ))}
      {showAxes && (
        <g stroke="#6b7280" strokeWidth={1.5}>
          <line x1={0} y1={VB_H / 2} x2={VB_W} y2={VB_H / 2} markerEnd="url(#gd-arrowhead)" />
          <line x1={VB_W / 2} y1={VB_H} x2={VB_W / 2} y2={0} markerEnd="url(#gd-arrowhead)" />
        </g>
      )}
    </g>
  );

  const renderHandles = (s) => {
    const pts = s.points;
    const canResize = s.type === "poly" && s.closed && pts.length >= 3;
    const box = canResize ? bboxOf(pts) : null;
    return (
      <g key={"h_" + s.id}>
        {pts.map((pt, i) => (
          <circle key={i} cx={pt.x} cy={pt.y} r={8} fill="#fff" stroke={C.accent} strokeWidth={2.5}
            onPointerDown={(e) => startHandleDrag(e, "point", s.id, i)} style={{ cursor: "grab" }} />
        ))}
        {canResize && (
          <g onPointerDown={(e) => startHandleDrag(e, "resize", s.id, null)} style={{ cursor: "nwse-resize" }}>
            <rect x={box.maxX - 7} y={box.maxY - 7} width={14} height={14} rx={3} fill={C.accent} />
          </g>
        )}
      </g>
    );
  };

  /* ── এক্সপোর্ট → PNG → uploadImg() → onInsert(url) ── */
  const finishAndInsert = useCallback(async () => {
    if (!shapes.length) { push?.("warn", "কিছু আঁকা হয়নি", "অন্তত একটা shape বসাও"); return; }
    setExporting(true);
    try {
      const inner = shapesLayerRef.current?.innerHTML || "";
      const gridInner = (showGrid || showAxes) ? (gridLayerRef.current?.innerHTML || "") : "";
      const svgMarkup = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${VB_W} ${VB_H}" width="${VB_W}" height="${VB_H}">` +
        `<rect width="${VB_W}" height="${VB_H}" fill="#fff"/><defs><marker id="gd-arrowhead" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="context-stroke"/></marker></defs>${gridInner}${inner}</svg>`;
      const blob = await new Promise((resolve, reject) => {
        const img = new Image();
        const svgBlob = new Blob([svgMarkup], { type: "image/svg+xml;charset=utf-8" });
        const url = URL.createObjectURL(svgBlob);
        img.onload = () => {
          const scale = 2;
          const canvas = document.createElement("canvas");
          canvas.width = VB_W * scale; canvas.height = VB_H * scale;
          const ctx = canvas.getContext("2d");
          ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          URL.revokeObjectURL(url);
          canvas.toBlob(b => (b ? resolve(b) : reject(new Error("canvas export ব্যর্থ"))), "image/png");
        };
        img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("SVG → ছবি রেন্ডার ব্যর্থ")); };
        img.src = url;
      });
      const uploadedUrl = await uploadImg(blob, "questions");
      if (!uploadedUrl) { push?.("error", "আপলোড ব্যর্থ", "আঁকা ছবিটা CDN-এ আপলোড হয়নি — আবার চেষ্টা করো"); setExporting(false); return; }
      onInsert(uploadedUrl);
      push?.("success", "✏️ ছবি যোগ হয়েছে", "কার্সরে লিংক বসানো হয়েছে");
      onClose();
    } catch (err) {
      push?.("error", "এক্সপোর্ট ব্যর্থ", err.message);
      setExporting(false);
    }
  }, [shapes, onInsert, onClose, push, showGrid, showAxes]);

  const btn = (active) => ({
    padding: "7px 10px", borderRadius: 9, border: `1px solid ${active ? C.accent : C.border}`,
    background: active ? tint(C.accent, "20") : "transparent", color: active ? C.accent : C.text,
    fontSize: 12, fontWeight: 700, flexShrink: 0, display: "flex", alignItems: "center", gap: 4,
  });

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 200, background: C.bg, display: "flex", flexDirection: "column" }}>
      {/* ── হেডার ── */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 12px", borderBottom: `1px solid ${C.border}` }}>
        <div style={{ fontWeight: 800, fontSize: 14 }}>✏️ জ্যামিতি আঁকো</div>
        <div style={{ display: "flex", gap: 6 }}>
          <button onClick={undo} disabled={!history.length} style={btn(false)}>↩️</button>
          <button onClick={redo} disabled={!future.length} style={btn(false)}>↪️</button>
          <button onClick={onClose} style={btn(false)}>✕ বাতিল</button>
        </div>
      </div>

      {/* ── টুলবার (horizontally scrollable) ── */}
      <div style={{ display: "flex", gap: 6, padding: "8px 10px", overflowX: "auto", borderBottom: `1px solid ${C.border}` }}>
        {TOOLS.map(t => (
          <button key={t.id} onClick={() => { setDraft(null); setSelectedId(null); setTool(t.id); }} style={btn(tool === t.id)} title={t.label}>
            <span style={{ fontSize: 15 }}>{t.icon}</span>{t.label}
          </button>
        ))}
      </div>

      {/* ── 🆕 Phase 2/3: গ্রিড/স্ন্যাপ/অক্ষ টগল + টেমপ্লেট ── */}
      <div style={{ display: "flex", gap: 6, padding: "6px 10px", overflowX: "auto", borderBottom: `1px solid ${C.border}` }}>
        <button onClick={() => setShowGrid(g => !g)} style={btn(showGrid)}>🔲 গ্রিড</button>
        <button onClick={() => setSnapGrid(g => !g)} style={btn(snapGrid)}>🧲 স্ন্যাপ</button>
        <button onClick={() => setShowAxes(g => !g)} style={btn(showAxes)}>📐 অক্ষ</button>
        <button onClick={saveAsTemplate} style={btn(false)}>💾 টেমপ্লেট সেভ</button>
        <button onClick={() => setShowTemplates(true)} style={btn(false)}>🗂 টেমপ্লেট ({templates.length})</button>
      </div>

      {/* ── ক্যানভাস ── */}
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: 10, position: "relative" }}>
        <svg ref={svgRef} viewBox={`0 0 ${VB_W} ${VB_H}`} style={{ width: "100%", maxWidth: 640, background: "#fff", borderRadius: 8, touchAction: "none", border: `1px solid ${C.border}` }}
          onPointerDown={onCanvasTap} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerLeave={onPointerUp}>
          <defs>
            <marker id="gd-arrowhead" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="context-stroke" /></marker>
          </defs>
          <g ref={gridLayerRef}>{renderGridAndAxes()}</g>
          <g ref={shapesLayerRef}>
            {shapes.map(s => renderShape(s, true))}
            {draft && draft.points.length > 0 && renderShape({ ...draft, type: tool === "circle" ? "circle" : tool === "angle" ? "angle" : "poly", closed: false }, false)}
          </g>
          {selected && renderHandles(selected)}
        </svg>

        {/* poly (ত্রিভুজ/বহুভুজ) বানানোর সময় ফ্লোটিং ✓/✕ */}
        {tool === "poly" && draft && (
          <div style={{ position: "absolute", bottom: 18, display: "flex", gap: 8 }}>
            <span style={{ fontSize: 11, alignSelf: "center", color: C.muted }}>{draft.points.length} পয়েন্ট — আরও ট্যাপ করো বা শেষ করো</span>
            <button onClick={finishPoly} disabled={draft.points.length < 3} style={{ ...btn(true), background: C.accent, color: "#fff" }}>✓ শেষ করো</button>
            <button onClick={cancelDraft} style={btn(false)}>✕</button>
          </div>
        )}
      </div>

      {/* ── স্টাইল প্যানেল (কিছু সিলেক্ট থাকলে, নাহলে আগামী shape-এর ডিফল্ট স্টাইল) ── */}
      <div style={{ padding: "8px 12px", borderTop: `1px solid ${C.border}`, display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10 }}>
        <div style={{ display: "flex", gap: 5 }}>
          {COLORS.map(c => (
            <button key={c} onClick={() => updateSelectedStyle({ stroke: c, fillColor: c })}
              style={{ width: 22, height: 22, borderRadius: "50%", background: c, border: (selected ? selected.stroke : style.stroke) === c ? `2px solid ${C.accent}` : "1px solid #0002" }} />
          ))}
        </div>
        <div style={{ display: "flex", gap: 5 }}>
          {WIDTHS.map(w => (
            <button key={w} onClick={() => updateSelectedStyle({ strokeWidth: w })}
              style={btn((selected ? selected.strokeWidth : style.strokeWidth) === w)}>{w === 1.5 ? "সরু" : w === 3 ? "মাঝারি" : "মোটা"}</button>
          ))}
        </div>
        {(selected ? (selected.type === "circle" || (selected.type === "poly" && selected.closed)) : true) && (
          <button onClick={() => updateSelectedStyle({ fill: !(selected ? selected.fill : style.fill) })} style={btn(selected ? selected.fill : style.fill)}>🎨 ফিল</button>
        )}
        {selected && <button onClick={duplicateSelected} style={btn(false)}>⧉ কপি</button>}
        {selected && <button onClick={bringToFront} style={btn(false)}>⬆️ সামনে</button>}
        {selected && <button onClick={sendToBack} style={btn(false)}>⬇️ পিছনে</button>}
        {selected && <button onClick={deleteSelected} style={{ ...btn(false), color: C.danger, borderColor: tint(C.danger, "40") }}>🗑 ডিলিট</button>}
        {selected && selected.type === "text" && (
          <button onClick={() => {
            const t = window.prompt("টেক্সট বদলাও:", selected.text) ;
            if (t != null && t.trim()) updateSelectedStyle({ text: t.trim() });
          }} style={btn(false)}>✏️ টেক্সট বদলাও</button>
        )}
      </div>

      {/* ── ফুটার অ্যাকশন ── */}
      <div style={{ padding: 12, borderTop: `1px solid ${C.border}`, display: "flex", gap: 8 }}>
        <button onClick={onClose} style={{ ...btn(false), flex: 1, justifyContent: "center", padding: "12px 0" }}>✕ বাতিল</button>
        <button onClick={finishAndInsert} disabled={exporting || !shapes.length}
          style={{ flex: 2, justifyContent: "center", padding: "12px 0", borderRadius: 10, border: "none", background: C.accent, color: "#fff", fontWeight: 800, fontSize: 13, display: "flex", alignItems: "center", gap: 6 }}>
          {exporting ? "⏳ আপলোড হচ্ছে..." : "✅ প্রশ্নে বসাও"}
        </button>
      </div>

      {/* ── 🆕 Phase 3: টেমপ্লেট পিকার (এই ডিভাইসেই localStorage-এ সেভ থাকে) ── */}
      {showTemplates && (
        <div style={{ position: "fixed", inset: 0, zIndex: 210, background: "#0008", display: "flex", alignItems: "flex-end" }} onClick={() => setShowTemplates(false)}>
          <div style={{ background: C.card, width: "100%", maxHeight: "70vh", overflowY: "auto", borderRadius: "14px 14px 0 0", padding: 14 }} onClick={e => e.stopPropagation()}>
            <div style={{ fontWeight: 800, fontSize: 13, marginBottom: 10 }}>🗂 সেভ করা টেমপ্লেট</div>
            {!templates.length && <div style={{ fontSize: 11.5, color: C.muted, textAlign: "center", padding: 20 }}>এখনো কোনো টেমপ্লেট সেভ করা হয়নি</div>}
            {templates.slice().reverse().map(t => (
              <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 4px", borderBottom: `1px dashed ${C.border}` }}>
                <div style={{ flex: 1, fontSize: 12.5, fontWeight: 700 }}>{t.name}<div style={{ fontSize: 9.5, color: C.muted, fontWeight: 400 }}>{t.shapes.length}টা shape</div></div>
                <button onClick={() => loadTemplate(t)} style={{ ...btn(false), background: C.accent, color: "#fff", borderColor: C.accent }}>লোড করো</button>
                <button onClick={() => deleteTemplate(t.id)} style={{ background: "transparent", border: "none", color: C.danger, fontSize: 15 }}>🗑</button>
              </div>
            ))}
            <button onClick={() => setShowTemplates(false)} style={{ ...btn(false), width: "100%", justifyContent: "center", marginTop: 12, padding: "10px 0" }}>বন্ধ করো</button>
          </div>
        </div>
      )}
    </div>
  );
}

export { GeometryDrawing };
