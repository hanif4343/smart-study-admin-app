/* ══════════ ইংরেজি বানান-ইঞ্জিন (Hunspell en_US — LibreOffice/Chrome যে ডিকশনারি ব্যবহার করে) ══════════
   • .aff-এর PFX/SFX নিয়ম পড়ে শব্দ যাচাই (stem + affix, cross-product), বড়/ছোট হাতের নিয়মসহ
   • সাজেশন: REP টেবিল + এক-অক্ষর বদল (মুছা/উল্টানো/বদল/যোগ) + শব্দ ভাঙা ("alot" → "a lot") + ডিকশনারির স্টেম স্ক্যান (দূরত্ব ≤২)
     — শেষে দূরত্ব, প্রথম অক্ষর, কিবোর্ড-পাশাপাশি অক্ষর আর উচ্চারণ-কাঠামো মিলিয়ে সাজানো
   অফলাইন; কোনো বাইরের লাইব্রেরি লাগে না। */

const rxEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function parseAff(text) {
  const aff = { rep: [], sfx: [], pfx: [], noSuggest: "", onlyInCompound: "", icon: [] };
  const lines = text.split(/\r?\n/);
  const cur = {}; // flag → {type, cross}
  for (let raw of lines) {
    const line = raw.replace(/#.*$/, "").trim(); if (!line) continue;
    const p = line.split(/\s+/), k = p[0];
    if (k === "NOSUGGEST") aff.noSuggest = p[1] || "";
    else if (k === "ONLYINCOMPOUND") aff.onlyInCompound = p[1] || "";
    else if (k === "ICONV" && p.length >= 3) aff.icon.push([p[1], p[2]]);
    else if (k === "REP" && p.length >= 3) aff.rep.push([p[1], p[2].replace(/_/g, " ")]);
    else if ((k === "PFX" || k === "SFX") && p.length >= 4 && /^(Y|N)$/.test(p[2]) && /^\d+$/.test(p[3]) && p.length === 4) cur[k + p[1]] = { cross: p[2] === "Y" };
    else if ((k === "PFX" || k === "SFX") && p.length >= 5) {
      const hdr = cur[k + p[1]] || { cross: false }, strip = p[2] === "0" ? "" : p[2], add = (p[3] === "0" ? "" : p[3]).split("/")[0], cond = p[4] || ".";
      const rule = { flag: p[1], cross: hdr.cross, strip, add, cond: new RegExp(k === "SFX" ? "(?:" + cond + ")$" : "^(?:" + cond + ")") };
      (k === "SFX" ? aff.sfx : aff.pfx).push(rule);
    }
  }
  return aff;
}

const isTitle = (w) => w.length > 1 && w[0] !== w[0].toLowerCase() && w.slice(1) === w.slice(1).toLowerCase();
const isAllCaps = (w) => w.length > 1 && w === w.toUpperCase() && w !== w.toLowerCase();
const title = (w) => w.charAt(0).toUpperCase() + w.slice(1);
const KEYS = ["qwertyuiop", "asdfghjkl", "zxcvbnm"];
const NEAR = (() => { const m = {}; KEYS.forEach((row, r) => [...row].forEach((c, i) => { m[c] = new Set(); [[r, i - 1], [r, i + 1], [r - 1, i - 1], [r - 1, i], [r + 1, i], [r + 1, i - 1]].forEach(([rr, ii]) => { const ch = KEYS[rr] && KEYS[rr][ii]; if (ch) m[c].add(ch); }); })); return m; })();

function dl(a, b, max = 9) {   // Damerau-Levenshtein (পাশাপাশি উল্টানো = ১)
  const n = a.length, m = b.length; if (Math.abs(n - m) > max) return max + 1;
  const d = []; for (let i = 0; i <= n; i++) { d[i] = [i]; } for (let j = 1; j <= m; j++) d[0][j] = j;
  for (let i = 1; i <= n; i++) {
    let rowMin = 99;
    for (let j = 1; j <= m; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      if (d[i][j] < rowMin) rowMin = d[i][j];
    }
    if (rowMin > max) return max + 1;
  }
  return d[n][m];
}
const skeleton = (w) => w.replace(/(.)\1+/g, "$1").replace(/ph/g, "f").replace(/ck/g, "k").replace(/[aeiouy]/g, (m, i) => (i === 0 ? m : "")).replace(/[^a-z]/g, "");

export function createSpeller(affText, dicText) {
  const aff = parseAff(affText), dict = new Map();
  dicText.split(/\r?\n/).forEach((line, i) => {
    line = line.trim(); if (!line || (i === 0 && /^\d+$/.test(line))) return;
    const sp = line.search(/\s/); const body = sp > 0 ? line.slice(0, sp) : line;
    const slash = body.indexOf("/"); const word = slash >= 0 ? body.slice(0, slash) : body, flags = slash >= 0 ? body.slice(slash + 1) : "";
    dict.set(word, (dict.get(word) || "") + flags);
  });
  const custom = new Set();
  const norm = (w) => { let s = String(w); aff.icon.forEach(([a, b]) => { s = s.split(a).join(b); }); return s; };
  const has = (stem, flags) => { const f = dict.get(stem); if (f === undefined) return false; if (aff.onlyInCompound && f.includes(aff.onlyInCompound)) return false; return flags.every((x) => f.includes(x)); };

  function affixed(w) {
    if (has(w, [])) return true;
    for (const r of aff.sfx) {
      if (r.add && !w.endsWith(r.add)) continue;
      const stem = w.slice(0, w.length - r.add.length) + r.strip;
      if (stem && r.cond.test(stem) && has(stem, [r.flag])) return true;
    }
    for (const r of aff.pfx) {
      if (r.add && !w.startsWith(r.add)) continue;
      const stem = r.strip + w.slice(r.add.length);
      if (stem && r.cond.test(stem) && has(stem, [r.flag])) return true;
    }
    for (const p of aff.pfx) {            // prefix + suffix (cross-product)
      if (!p.cross || !w.startsWith(p.add)) continue;
      const mid = p.strip + w.slice(p.add.length); if (!p.cond.test(mid)) continue;
      for (const s of aff.sfx) {
        if (!s.cross || (s.add && !mid.endsWith(s.add))) continue;
        const stem = mid.slice(0, mid.length - s.add.length) + s.strip;
        if (stem && s.cond.test(stem) && has(stem, [p.flag, s.flag])) return true;
      }
    }
    return false;
  }
  function check(word) {
    const w = norm(word); if (!w) return true;
    if (custom.has(w.toLowerCase())) return true;
    const vs = isAllCaps(w) ? [w, title(w.toLowerCase()), w.toLowerCase()] : isTitle(w) ? [w, w.toLowerCase()] : [w];
    return vs.some(affixed);
  }

  let stems = null;      // দৈর্ঘ্য অনুযায়ী ভাগ করা স্টেম-তালিকা (সাজেশনের স্ক্যান দ্রুত করতে)
  const stemBuckets = () => {
    if (stems) return stems; stems = {};
    for (const [w, f] of dict) {
      if ((aff.noSuggest && f.includes(aff.noSuggest)) || (aff.onlyInCompound && f.includes(aff.onlyInCompound)) || !/^[A-Za-z']+$/.test(w)) continue;
      (stems[w.length] = stems[w.length] || []).push({ w, lw: w.toLowerCase() });
    }
    return stems;
  };
  const noSug = (c) => { const f = dict.get(c) ?? dict.get(title(c)); return !!(f && aff.noSuggest && f.includes(aff.noSuggest)); };

  function suggest(word, limit = 6) {
    const orig = norm(word), low = orig.toLowerCase(), mode = isAllCaps(orig) ? "up" : isTitle(orig) ? "ti" : "lo";
    const found = new Map();
    const valid = (c) => (c.includes(" ") ? c.split(" ").every((p) => p.length > 1 ? check(p) : /^[ai]$/.test(p)) : check(c) || (mode === "ti" && check(title(c))));
    const add = (c, bonus = 0) => {
      c = c.trim(); if (!c || c === low || found.has(c)) return;
      if (!c.includes(" ") && noSug(c)) return;
      if (!valid(c)) return;
      let cost = dl(low, c.replace(/ /g, ""), 3) - bonus;
      if (c[0] !== low[0]) cost += 0.45;
      if (skeleton(c) === skeleton(low)) cost -= 0.55;
      if (c.includes(" ")) cost += 0.3;
      if (Math.abs(c.length - low.length) === 0) cost -= 0.05;
      found.set(c, cost);
    };
    aff.rep.forEach(([a, b]) => { let i = low.indexOf(a); while (i >= 0) { add(low.slice(0, i) + b + low.slice(i + a.length), 0.6); i = low.indexOf(a, i + 1); } });
    const L = "abcdefghijklmnopqrstuvwxyz'";
    for (let i = 0; i <= low.length; i++) {
      if (i < low.length) add(low.slice(0, i) + low.slice(i + 1), 0);                                                     // মুছা
      if (i < low.length - 1) add(low.slice(0, i) + low[i + 1] + low[i] + low.slice(i + 2), 0.35);                         // উল্টানো
      for (const ch of L) {
        if (i < low.length) add(low.slice(0, i) + ch + low.slice(i + 1), NEAR[low[i]] && NEAR[low[i]].has(ch) ? 0.25 : 0); // বদল
        add(low.slice(0, i) + ch + low.slice(i), 0);                                                                      // যোগ
      }
    }
    for (let i = 1; i < low.length; i++) { const a = low.slice(0, i), b = low.slice(i); if (low.length >= 4 && (a.length > 1 || /^[ai]$/.test(a)) && b.length > 1 && check(a) && check(b)) add(a + " " + b, 0.2); }
    const near = [...found.values()].filter((v) => v < 1.6).length;
    if (near < 3) {                           // ভালো সাজেশন কম হলেই ডিকশনারির স্টেম স্ক্যান (দূরত্ব ≤ ২)
      const n = low.length, B = stemBuckets();
      for (let len = Math.max(1, n - 2); len <= n + 2; len++) {
        for (const { w, lw } of B[len] || []) {
          if (found.has(lw) || (w !== lw && mode !== "ti")) continue;      // বড়-হাতের নাম শুধু বড়-হাতে লেখা শব্দের সাজেশনে
          if (lw[0] !== low[0] && lw[lw.length - 1] !== low[n - 1] && lw[1] !== low[1]) continue;   // দ্রুত ছাঁকনি: ২টা স্থান অন্তত না মিললে বাদ
          if (dl(low, lw, 2) <= 2) add(lw, 0);
        }
      }
    }
    const out = [...found.entries()].sort((a, b) => a[1] - b[1] || a[0].length - b[0].length || (a[0] < b[0] ? -1 : 1)).slice(0, limit).map(([c]) => c);
    return out.map((c) => (mode === "up" ? c.toUpperCase() : mode === "ti" ? title(c) : c));
  }
  return { check, suggest, addWord: (w) => custom.add(String(w).toLowerCase()), size: dict.size };
}
