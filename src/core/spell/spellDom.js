/* ══════════ বানান-পরীক্ষা: স্ক্রিনে লাল ঢেউ-দাগ + ট্যাপে সাজেশন ══════════
   অ্যাপের সব ইংরেজি টেক্সট-ঘরে (textarea, text input, contenteditable) নিজে থেকে কাজ করে — আলাদা করে প্রতিটা ঘরে কিছু বসাতে হয় না।
   • textarea/input: ঘরের ওপরে স্বচ্ছ "মিরর" স্তর (pointer-events:none) — ঘরের লেখা/কার্সর/ফরম্যাটে হাত দেয় না, শুধু ভুল শব্দের নিচে দাগ আঁকে।
   • contenteditable (Written মোডের রিচ ঘর): CSS Custom Highlight API — লেখার ভেতরে কোনো এলিমেন্ট যোগ হয় না, তাই কার্সর/math/ফরম্যাট অক্ষত।
   • লাল শব্দে ট্যাপ → পপআপ: সাজেশন (৫টা পর্যন্ত) · Ignore · Add to dictionary। সাজেশনে ট্যাপ করলে শব্দ বদলে যায় (Undo চলে)।
   • শুধু ইংরেজি শব্দ চেক হয়। বাংলা, সংখ্যা-মেশানো, ALL CAPS (BCS), camelCase, ইমেইল/লিংক/ফাইলনাম বাদ। */
import { createSpeller } from "./spellEngine.js";
import { BUILTIN_WORDS } from "./builtinWords.js";

const LS_CUSTOM = "spell_custom_words_v1", LS_ON = "spell_enabled_v1";
const RED = "#e53935";
let speller = null, loading = null, loader = null, installed = false;
const ignore = new Set(), cache = new Map(), attached = new Map();   // el → state
let popup = null, popupFor = null, hlStyle = null;
const subs = new Set();

/* ── চালু/বন্ধ ── */
export const isSpellEnabled = () => { try { return localStorage.getItem(LS_ON) !== "0"; } catch { return true; } };
export function setSpellEnabled(on) { try { localStorage.setItem(LS_ON, on ? "1" : "0"); } catch {} subs.forEach((f) => f(!!on)); if (!on) { closePopup(); attached.forEach((s) => hideAll(s)); } else refreshAll(); }
export const subscribeSpell = (f) => { subs.add(f); return () => subs.delete(f); };

const customWords = () => { try { return JSON.parse(localStorage.getItem(LS_CUSTOM) || "[]"); } catch { return []; } };
function addCustom(w) { const l = [...new Set([...customWords(), w.toLowerCase()])]; try { localStorage.setItem(LS_CUSTOM, JSON.stringify(l)); } catch {} speller && speller.addWord(w); cache.clear(); }

/* ── শব্দ খোঁজা ── */
const WORD_RE = /[A-Za-z]+(?:['’][A-Za-z]+)*/g;
export function findErrors(text, sp = speller) {
  if (!sp) return [];
  const masked = text.replace(/<[^>]*>/g, (m) => " ".repeat(m.length)), out = [];
  for (const m of masked.matchAll(WORD_RE)) {
    const word = m[0], s = m.index, e = s + word.length, prev = masked[s - 1] || "", next = masked[e] || "", next2 = masked[e + 1] || "";
    if (word.length < 2) continue;
    if (/[0-9_@#/\\\u0980-\u09FF]/.test(prev) || /[0-9_@\u0980-\u09FF]/.test(next)) continue;       // সংখ্যা/বাংলা/ইমেইল/পাথ-সংলগ্ন
    if ((prev === "." && /[A-Za-z]/.test(masked[s - 2] || "")) || (next === "." && /[A-Za-z]/.test(next2))) continue;   // file.txt, a.com
    if (word === word.toUpperCase() || /[a-z][A-Z]/.test(word)) continue;                                // BCS, iPhone, eBook
    const low = word.toLowerCase().replace(/’/g, "'");
    if (ignore.has(low)) continue;
    let ok = cache.get(word); if (ok === undefined) { ok = sp.check(word); cache.set(word, ok); }
    if (!ok) out.push({ start: s, end: e, word });
  }
  return out;
}

/* ── কোন ঘর চেক হবে ── */
function kindOf(el) {
  if (!(el instanceof HTMLElement) || el.closest("[data-nospell]") || el.closest("[data-spell-popup]")) return null;
  if (el.tagName === "TEXTAREA") return el.readOnly || el.disabled ? null : "ta";
  if (el.tagName === "INPUT") { const t = (el.getAttribute("type") || "text").toLowerCase(); return (t === "text" || t === "search") && !el.readOnly && !el.disabled ? "ta" : null; }
  const ce = el.getAttribute("contenteditable"); if (ce === "" || ce === "true" || ce === "plaintext-only") return "ce";
  return null;
}
const coverOn = (el) => { const n = el.nextElementSibling; return !!(n && n.getAttribute && n.getAttribute("data-typing-cover") === "on") || !!(el.parentElement && el.parentElement.querySelector(":scope > [data-typing-cover='on']")); };
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/* ── textarea/input মিরর ── */
const COPY = ["fontFamily", "fontSize", "fontWeight", "fontStyle", "letterSpacing", "lineHeight", "textTransform", "textIndent", "tabSize", "textAlign", "direction", "wordBreak", "overflowWrap", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft"];
function makeMirror() {
  const box = document.createElement("div"), inner = document.createElement("div");
  box.setAttribute("data-spell-mirror", "");
  Object.assign(box.style, { position: "fixed", pointerEvents: "none", overflow: "hidden", zIndex: "2147482000", margin: "0", border: "0", background: "transparent", display: "none" });
  Object.assign(inner.style, { color: "transparent", boxSizing: "border-box", margin: "0", border: "0", position: "absolute", left: "0", top: "0" });
  box.appendChild(inner); document.body.appendChild(box); return { box, inner };
}
function syncMirror(st) {
  const el = st.el, r = el.getBoundingClientRect(), vis = r.width > 4 && r.height > 4 && getComputedStyle(el).visibility !== "hidden";
  if (!vis || r.bottom < -50 || r.top > innerHeight + 50 || coverOn(el) || !isSpellEnabled()) { st.box.style.display = "none"; return; }
  const cs = getComputedStyle(el), b = st.box.style, i = st.inner.style;
  b.display = "block"; b.left = r.left + el.clientLeft + "px"; b.top = r.top + el.clientTop + "px"; b.width = el.clientWidth + "px"; b.height = el.clientHeight + "px";
  COPY.forEach((k) => { if (i[k] !== cs[k]) i[k] = cs[k]; });
  const ta = el.tagName === "TEXTAREA";
  i.whiteSpace = ta ? "pre-wrap" : "pre"; i.width = ta ? el.clientWidth + "px" : "auto"; i.minHeight = el.clientHeight + "px";
  i.transform = `translate(${-el.scrollLeft}px,${-el.scrollTop}px)`;
  const text = el.value;
  if (text !== st.text || st.dirty) {
    st.text = text; st.dirty = false; st.errors = findErrors(text);
    let html = "", pos = 0; st.errors.forEach((e, k) => { html += esc(text.slice(pos, e.start)) + `<span data-i="${k}" style="text-decoration:underline wavy ${RED};text-decoration-skip-ink:none;text-underline-offset:2px;text-decoration-thickness:1.5px">${esc(text.slice(e.start, e.end))}</span>`; pos = e.end; });
    st.inner.innerHTML = html + esc(text.slice(pos)) + "\u200b";
  }
}

/* ── contenteditable: ওভারলে-দাগ (MS Office-এর মতো লাল ঢেউ, লেখার ঠিক নিচে) ──
   আগে CSS Highlight API ছিল — অনেক Android WebView-তে সেটা দাগ আঁকে না (শুধু ট্যাপে পপআপ আসত)।
   এখন প্রতিটা ভুল শব্দের Range → getClientRects() দিয়ে আলাদা স্বচ্ছ স্তরে (pointer-events:none) ঢেউ আঁকা হয়:
   লেখা/কার্সর/math/ফরম্যাটে হাত পড়ে না, ট্যাপ সরাসরি ঘরেই যায়। */
let ceLayer = null;
const WAVE_URL = `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='6' height='3'><path d='M0 2.4 L1.5 0.6 L3 2.4 L4.5 0.6 L6 2.4' fill='none' stroke='${RED}' stroke-width='1.15'/></svg>`)}")`;
function ensureCeLayer() {
  if (ceLayer && ceLayer.isConnected) return ceLayer;
  ceLayer = document.createElement("div"); ceLayer.setAttribute("data-spell-layer", "");
  Object.assign(ceLayer.style, { position: "fixed", left: "0", top: "0", width: "0", height: "0", pointerEvents: "none", zIndex: "2147482000" });
  document.body.appendChild(ceLayer); return ceLayer;
}
function ceScan(st) {
  const el = st.el, out = [], w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  for (let n = w.nextNode(); n; n = w.nextNode()) findErrors(n.data).forEach((e) => { const r = document.createRange(); r.setStart(n, e.start); r.setEnd(n, e.end); out.push({ range: r, word: e.word }); });
  st.ranges = out;
}
function applyHighlights() {
  try { if (typeof CSS !== "undefined" && CSS.highlights) CSS.highlights.delete("sc-err"); } catch {}   // পুরনো Highlight-দাগ থাকলে সরাও — নইলে দুবার দাগ পড়ত
  let any = false; attached.forEach((s) => { if (s.kind === "ce") any = true; });
  if (!any && !ceLayer) return;
  const layer = ensureCeLayer(), frag = document.createDocumentFragment(), vh = innerHeight; let count = 0;
  attached.forEach((s) => {
    if (s.kind !== "ce" || !s.ranges || !s.el.isConnected || coverOn(s.el) || !isSpellEnabled()) return;
    const hr = s.el.getBoundingClientRect(); if (hr.width < 4 || hr.height < 4 || hr.bottom < 0 || hr.top > vh) return;
    for (const x of s.ranges) {
      let rects; try { rects = x.range.getClientRects(); } catch { continue; }
      for (const r of rects) {
        if (r.width < 2 || r.bottom < hr.top || r.top > hr.bottom || r.bottom < 0 || r.top > vh || count > 700) continue;
        const d = document.createElement("div");
        d.style.cssText = `position:fixed;left:${r.left}px;top:${r.bottom - 3}px;width:${r.width}px;height:3px;background:${WAVE_URL} repeat-x left bottom;background-size:6px 3px`;
        frag.appendChild(d); count++;
      }
    }
  });
  layer.textContent = ""; layer.appendChild(frag);
}
function hideAll(st) { if (st.kind === "ta") st.box.style.display = "none"; else { st.ranges = []; applyHighlights(); } }

/* ── ঘর জোড়া/ছাড়া ── */
function evictOne() {
  const act = document.activeElement; let victim = null;
  for (const [e] of attached) {
    if (e === act || e.contains(act)) continue;
    const r = e.getBoundingClientRect();
    if (r.bottom < -200 || r.top > innerHeight + 200) { victim = e; break; }
    if (!victim) victim = e;
  }
  if (victim) detach(victim);
}
function attach(el) {
  if (attached.has(el)) return; const kind = kindOf(el); if (!kind) return;
  if (attached.size >= 40) evictOne();   // আগে ১৪টার পর নতুন ঘরে দাগই পড়ত না (২৩ প্রশ্নের পেপারে অনেক ঘর বাদ যেত)
  const st = { el, kind, errors: [], ranges: [], text: null, dirty: true, ceTimer: null };
  if (kind === "ta") { Object.assign(st, makeMirror()); el.setAttribute("spellcheck", "false"); }   // ব্রাউজারের নিজস্ব দাগ বন্ধ — নইলে দুবার দাগ পড়ত
  attached.set(el, st); refresh(st);
}
function detach(el) { const st = attached.get(el); if (!st) return; if (st.kind === "ta") st.box.remove(); attached.delete(el); if (st.kind === "ce") applyHighlights(); }
function refresh(st) { if (!speller) return; if (st.kind === "ta") syncMirror(st); else { ceScan(st); applyHighlights(); } }
function refreshAll() { attached.forEach((s) => { s.dirty = true; refresh(s); }); }

/* ── পপআপ ── */
function ensurePopup() {
  if (popup) return popup;
  popup = document.createElement("div"); popup.setAttribute("data-spell-popup", "");
  Object.assign(popup.style, { position: "fixed", zIndex: "2147483600", minWidth: "170px", maxWidth: "86vw", background: "#fff", color: "#111", border: "1px solid #bbb", borderRadius: "10px", boxShadow: "0 6px 22px #0005", font: "14px/1.3 system-ui,'Hind Siliguri',sans-serif", padding: "4px", display: "none" });
  popup.addEventListener("pointerdown", (e) => e.preventDefault());      // ফোকাস ঘরেই থাকবে
  popup.addEventListener("mousedown", (e) => e.preventDefault());
  document.body.appendChild(popup); return popup;
}
function closePopup() { if (popup) popup.style.display = "none"; popupFor = null; }
function btn(label, onTap, style = {}) {
  const b = document.createElement("div"); b.textContent = label;
  Object.assign(b.style, { padding: "9px 12px", borderRadius: "7px", cursor: "pointer", userSelect: "none", ...style });
  b.addEventListener("click", (e) => { e.preventDefault(); onTap(); }); return b;
}
function replaceWith(st, hit, text) {
  const el = st.el;
  // ⌨️ টাইপিং-ট্র্যাকার: ভুল শব্দে ক্লিক করে সাজেশন দিয়ে শুধরানো টাইপ নয় — এই ছোট সময়ের ইনপুট গতি/কী-স্ট্রোকে ধরা হয় না
  try { globalThis.__ssTypingExcludeUntil = Date.now() + 800; } catch {}
  if (st.kind === "ta") {
    el.focus(); el.setSelectionRange(hit.start, hit.end);
    if (!document.execCommand("insertText", false, text)) { el.setRangeText(text, hit.start, hit.end, "end"); el.dispatchEvent(new Event("input", { bubbles: true })); }
  } else {
    el.focus(); const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(hit.range.cloneRange());
    if (!document.execCommand("insertText", false, text)) { hit.range.deleteContents(); hit.range.insertNode(document.createTextNode(text)); el.dispatchEvent(new Event("input", { bubbles: true })); }
  }
}
function showPopup(st, hit, rect) {
  const p = ensurePopup(); popupFor = { st, hit }; p.innerHTML = "";
  const head = document.createElement("div"); head.textContent = hit.word; Object.assign(head.style, { padding: "6px 12px 4px", color: RED, fontWeight: "700", fontSize: "13px" }); p.appendChild(head);
  const list = document.createElement("div"); list.textContent = "…"; list.style.padding = "6px 12px"; p.appendChild(list);
  const sep = document.createElement("div"); sep.style.cssText = "height:1px;background:#ddd;margin:3px 4px"; p.appendChild(sep);
  p.appendChild(btn("Ignore", () => { ignore.add(hit.word.toLowerCase().replace(/’/g, "'")); closePopup(); refreshAll(); }, { color: "#444" }));
  p.appendChild(btn("＋ Add to dictionary", () => { addCustom(hit.word); closePopup(); refreshAll(); }, { color: "#1565c0" }));
  p.style.display = "block"; place(p, rect);
  setTimeout(() => {
    if (!popupFor || popupFor.hit !== hit) return;
    const sugg = speller.suggest(hit.word, 5); list.textContent = ""; list.style.padding = "0";
    if (!sugg.length) { list.textContent = "(সাজেশন নেই)"; list.style.padding = "8px 12px"; list.style.color = "#777"; }
    sugg.forEach((s) => list.appendChild(btn(s, () => { closePopup(); replaceWith(st, hit, s); }, { fontWeight: "700" })));
    place(p, rect);
  }, 0);
}
function place(p, rect) {
  const vv = window.visualViewport, vw = vv ? vv.width : innerWidth, vh = vv ? vv.height : innerHeight, offT = vv ? vv.offsetTop : 0, offL = vv ? vv.offsetLeft : 0;
  const pw = p.offsetWidth, ph = p.offsetHeight;
  let left = Math.max(offL + 6, Math.min(rect.left, offL + vw - pw - 6)), top = rect.bottom + 6;
  if (top + ph > offT + vh - 6) top = Math.max(offT + 6, rect.top - ph - 6);
  p.style.left = left + "px"; p.style.top = top + "px";
}

/* ── ট্যাপ → ভুল শব্দ খুঁজে পপআপ ── */
function onPointerUp(e) {
  if (!isSpellEnabled() || !speller || (popup && popup.contains(e.target))) return;
  const target = e.target instanceof Element ? e.target : null; if (!target) return;
  let host = null; for (const [el] of attached) if (el === target || el.contains(target)) { host = el; break; }
  if (!host) { closePopup(); return; }
  setTimeout(() => {
    const st = attached.get(host); if (!st) return;
    if (st.kind === "ta") {
      const s = host.selectionStart, en = host.selectionEnd; if (s !== en) { closePopup(); return; }
      st.dirty = true; syncMirror(st);
      const k = st.errors.findIndex((x) => s >= x.start && s <= x.end); if (k < 0) { closePopup(); return; }
      const span = st.inner.querySelector(`[data-i="${k}"]`); if (!span) return;
      showPopup(st, st.errors[k], span.getBoundingClientRect());
    } else {
      const sel = window.getSelection(); if (!sel.rangeCount || !sel.isCollapsed) { closePopup(); return; }
      ceScan(st);
      const hit = st.ranges.find((x) => { const r = x.range; return sel.anchorNode === r.startContainer && sel.anchorOffset >= r.startOffset && sel.anchorOffset <= r.endOffset; });
      if (!hit) { closePopup(); return; }
      showPopup(st, hit, hit.range.getBoundingClientRect());
    }
  }, 30);
}

/* ── মূল: একবার ইনস্টল ── */
export function installSpellCheck({ loadDictionary }) {
  if (installed) return; installed = true; loader = loadDictionary;
  const ensureSpeller = () => loading || (loading = loader().then(({ aff, dic }) => {
    speller = createSpeller(aff, dic);
    BUILTIN_WORDS.forEach((w) => speller.addWord(w)); customWords().forEach((w) => speller.addWord(w));
    refreshAll(); return speller;
  }).catch((err) => { loading = null; console.warn("spell dictionary load failed", err); }));
  const consider = (el) => { if (kindOf(el)) { attach(el); ensureSpeller(); } };
  document.addEventListener("focusin", (e) => consider(e.target), true);
  document.addEventListener("input", (e) => {
    const st = attached.get(e.target) || [...attached.values()].find((s) => s.kind === "ce" && s.el.contains(e.target));
    if (!st) return; closePopup();
    if (st.kind === "ta") { st.dirty = true; syncMirror(st); }
    else { clearTimeout(st.ceTimer); st.ceTimer = setTimeout(() => { ceScan(st); applyHighlights(); }, 180); }
  }, true);
  document.addEventListener("pointerup", onPointerUp, true);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closePopup(); }, true);
  window.addEventListener("scroll", () => { attached.forEach((s) => s.kind === "ta" && syncMirror(s)); applyHighlights(); closePopup(); }, true);
  window.addEventListener("resize", () => { attached.forEach((s) => s.kind === "ta" && syncMirror(s)); applyHighlights(); closePopup(); });
  document.addEventListener("pointerdown", (e) => { if (popup && popup.style.display !== "none" && !popup.contains(e.target)) closePopup(); }, true);
  // হালকা টিক: জায়গা-সিঙ্ক, মুছে যাওয়া ঘর সরানো, নতুন ঘর খুঁজে জোড়া (ফোকাস না করলেও আগে থেকে লেখা ড্রাফটে দাগ দেখাতে)
  let n = 0;
  setInterval(() => {
    if (!speller) { if (attached.size === 0 && document.querySelector("textarea,input,[contenteditable]")) ensureSpeller(); return; }
    n++;
    attached.forEach((s, el) => { if (!el.isConnected) detach(el); else if (s.kind === "ta") syncMirror(s); else { if (n % 4 === 0) ceScan(s); if (coverOn(el) !== s.cov) s.cov = coverOn(el); } });
    applyHighlights();   // লেখা/স্ক্রল/লেআউট বদলালে ঢেউ-দাগের জায়গা ঠিক রাখে
    if (n % 4 === 0) document.querySelectorAll("textarea,input,[contenteditable]").forEach((el) => {
      if (attached.has(el) || !kindOf(el)) return; const r = el.getBoundingClientRect();
      if (r.height > 4 && r.bottom > -100 && r.top < innerHeight + 100) attach(el);
    });
  }, 350);
}
export const _test = { findErrors };
