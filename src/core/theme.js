/* ══════════════════════════════════════════════════════════════════
   THEME SYSTEM — Dark/Light mode
   ══════════════════════════════════════════════════════════════════
   ডিজাইন: config.js-এর C অবজেক্টের প্রতিটা key (bg/card/border/accent/...)
   এখন হার্ডকোড হেক্স না, বরং "var(--bg)" স্টাইলের CSS custom-property
   রেফারেন্স — তাই ৪৮টা ফাইলে ছড়ানো C.accent/C.text ইত্যাদি ব্যবহার
   *একটাও* না বদলিয়ে থিম বদলানো যায় (ব্রাউজার রানটাইমে var() resolve করে)।

   এই ফাইলটা:
   ১) DARK/LIGHT — দুটো প্যালেট (একই key-সেট, শুধু ভ্যালু আলাদা)
   ২) themeCssBlock() — html[data-theme="dark"|"light"]{--k:v...} বসিয়ে
      দেয়, css.js এটাকে মূল স্টাইলশিটের একদম ওপরে বসায়
   ৩) getSavedTheme/applyTheme/toggleTheme — localStorage + DOM attribute
      ম্যানেজ করে; App.jsx বুট হওয়ার সাথে সাথেই applyTheme(getSavedTheme())
      কল করে, প্রথম পেইন্টেই সঠিক থিম বসে যায় (flash হয় না)
   ══════════════════════════════════════════════════════════════════ */

const DARK = {
  bg:"#06080f", card:"#0c1220", border:"#16253d", panel:"#0e1a2e", navBg:"#080f1c",
  text:"#eef2f8", muted:"#93a3bf",
  accent:"#3b82f6", green:"#22c55e", red:"#f87171", yellow:"#fbbf24", purple:"#a78bfa", ocr:"#22d3ee",
};

const LIGHT = {
  bg:"#f4f6fb", card:"#ffffff", border:"#e2e6f0", panel:"#eef1f8", navBg:"#ffffff",
  text:"#0f172a", muted:"#55607a",
  accent:"#2563eb", green:"#15803d", red:"#dc2626", yellow:"#a15c00", purple:"#6d28d9", ocr:"#0e7490",
};

const THEMES = { dark: DARK, light: LIGHT };

function themeCssBlock(){
  const block = t => Object.entries(THEMES[t]).map(([k,v])=>`--${k}:${v}`).join(";");
  // ── html-এ data-theme বসে, কিন্তু #root max-width:480px সেন্টার করা কন্টেইনার —
  // তাই :root আর html[data-theme] দুটোতেই বসিয়ে দেওয়া হলো যাতে সবজায়গায় resolve হয় ──
  return `
:root[data-theme="dark"],html[data-theme="dark"]{${block("dark")}}
:root[data-theme="light"],html[data-theme="light"]{${block("light")}}
`;
}

const THEME_KEY = "ss_admin_theme";

function getSavedTheme(){
  try{
    const saved = localStorage.getItem(THEME_KEY);
    if(saved==="light"||saved==="dark") return saved;
  }catch(_){}
  return "dark"; // ── ডিফল্ট — আগে যেমন ছিল, এখনো তেমনই থাকবে যদি কেউ থিম না বদলায় ──
}

function applyTheme(theme){
  try{ document.documentElement.setAttribute("data-theme", theme); }catch(_){}
  try{ localStorage.setItem(THEME_KEY, theme); }catch(_){}
}

function toggleTheme(){
  const cur = getSavedTheme();
  const next = cur==="dark" ? "light" : "dark";
  applyTheme(next);
  return next;
}

export { THEMES, themeCssBlock, getSavedTheme, applyTheme, toggleTheme };
