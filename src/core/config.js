/* ══════════ CONFIG ══════════ */
const FB      = (import.meta.env.VITE_FB_DATABASE_URL||"").replace(/\/+$/,"");
const FB_KEY  = import.meta.env.VITE_FB_API_KEY||"";
const FB_PROJ  = import.meta.env.VITE_FB_PROJECT_ID||"";
const GAS     = import.meta.env.VITE_GAS_URL;   // শুধু GAS standalone backup এ লাগবে — app আর call করে না
const IMGBB   = import.meta.env.VITE_IMGBB_API_KEY;
const SECRET  = import.meta.env.VITE_SECRET_KEY;    // GAS আর call নেই — legacy only
// FCM v1 — Service Account credentials (GitHub Secrets থেকে build time এ inject হয়)
const FCM_CLIENT_EMAIL = import.meta.env.VITE_FCM_CLIENT_EMAIL||"";
const FCM_PRIVATE_KEY = (() => {
  try {
    // Vite build এ VITE_FCM_PRIVATE_KEY string হিসেবে inject হয়
    // GitHub Secret এ \n (দুই char) থাকে — actual newline চাই
    const raw = import.meta.env.VITE_FCM_PRIVATE_KEY || "";
    return raw.split("\\n").join("\n");
  } catch(_) { return ""; }
})()

/* ══════ কালার টোকেন ══════
   মূল প্যালেট (bg/card/border/accent/green/red/yellow/purple/text/muted/panel/navBg)
   অপরিবর্তিত রাখা হয়েছে — কোনো পুরনো ফাইলের C.red/C.green ইত্যাদি রেফারেন্স ভাঙবে না।
   নিচে শুধু সিমান্টিক নাম যোগ করা হলো (একই মান, নতুন অর্থবহ key) — ভবিষ্যতের
   কম্পোনেন্টগুলো (Phase ৩+) যেন র‍্যান্ডম রঙের বদলে অর্থ অনুযায়ী রঙ বেছে নেয়:
     C.info    → প্রাইমারি/ব্র্যান্ড অ্যাকশন, লিংক, active-state (= accent)
     C.success → active/done/approved status (= green)
     C.danger  → রিপোর্ট/এরর/ডিলিট (= red)
     C.warning → pending/attention (= yellow)
     C.ai      → AI-জেনারেটেড ফিচারের ট্যাগ (= purple)
     C.ocr     → OCR/স্ক্যান ফিচারের ট্যাগ (নতুন রঙ, প্যালেটে আগে ছিল না)
   নিয়ম: নতুন কোনো UI-তে C.red/C.green/C.purple সরাসরি "সাজানোর জন্য" বসানো যাবে
   না — সবসময় এই সিমান্টিক নামগুলোর একটা ব্যবহার করতে হবে, যাতে রঙের অর্থ সবসময়
   ট্রেসেবল থাকে (দেখুন REDESIGN_PLAN.md § ০.২)। */
/* ══════ কালার টোকেন ══════
   🎨 ফিক্স (Light/Dark mode): আগে এই মানগুলো হার্ডকোড হেক্স ছিল (যেমন
   accent:"#3b82f6") — অ্যাপজুড়ে ৪৮টা ফাইলে সরাসরি C.accent/C.text ইত্যাদি
   ব্যবহার হয়, তাই সেগুলো না ছুঁয়েই থিম বদলাতে হলে এই মানগুলোকে CSS custom
   property রেফারেন্সে বদলে দেওয়া হলো — আসল হেক্স ভ্যালু এখন core/theme.js-এর
   DARK/LIGHT অবজেক্টে, আর সেখান থেকেই html[data-theme]-এ বসে (css.js দেখো)।
   ব্রাউজার রানটাইমে var(--accent) resolve করে, তাই App.jsx-এ থিম টগল করলেই
   পুরো অ্যাপ (এই ফাইল স্পর্শ না করেই) রঙ বদলে যায়। */
const C={
  bg:"var(--bg)",card:"var(--card)",border:"var(--border)",
  accent:"var(--accent)",green:"var(--green)",red:"var(--red)",yellow:"var(--yellow)",purple:"var(--purple)",
  text:"var(--text)",muted:"var(--muted)",panel:"var(--panel)",navBg:"var(--navBg)",
  // ── সিমান্টিক এলিয়াস (Phase ১) ──
  info:"var(--accent)",       // = accent
  success:"var(--green)",     // = green
  danger:"var(--red)",        // = red
  warning:"var(--yellow)",    // = yellow
  ai:"var(--purple)",         // = purple
  ocr:"var(--ocr)",           // শুধু OCR/স্ক্যান ফিচার ট্যাগে ব্যবহার হবে
};

/* ══════ স্পেসিং ও রেডিয়াস স্কেল (Phase ১) ══════
   একটা কনসিস্টেন্ট 4px-বেসড স্কেল — ভবিষ্যতের সব নতুন কম্পোনেন্ট এখান থেকে
   মান নেবে, নিজের মতো ম্যাজিক-নাম্বার (12px/13px/11px মিশিয়ে) বসাবে না। */
const SPACE={xs:4,sm:8,md:12,lg:16,xl:24,xxl:32};
const RADIUS={sm:8,md:12,lg:16,xl:20};

/* 🎨 ফিক্স (Light/Dark mode continued): অ্যাপজুড়ে ৩০টা ফাইলে C.accent+"22" স্টাইলের
   প্যাটার্ন ছিল (hex রঙের পেছনে ২-ডিজিট opacity hex জোড়া দিয়ে হালকা টিন্টেড
   ব্যাকগ্রাউন্ড/বর্ডার বানাতো) — কিন্তু C.accent এখন "var(--accent)" (একটা keyword),
   তার পেছনে হেক্স জোড়া দিলে (var(--accent)22) সেটা invalid CSS হয়ে সাইলেন্টলি
   ignore হয়ে যেত। tint() হেল্পার সেই একই কাজ করে কিন্তু CSS color-mix() দিয়ে, যেটা
   var() রেফারেন্সের সাথেও কাজ করে — colorVar="var(--accent)", hexAlpha="22"
   (২-ডিজিট hex, 00-ff) দিলে সমতুল্য opacity রেখে color-mix() স্ট্রিং ফেরত দেয়। */
function tint(colorVar, hexAlpha){
  const pct = Math.round((parseInt(hexAlpha,16)/255)*1000)/10;
  return `color-mix(in srgb, ${colorVar} ${pct}%, transparent)`;
}

export { FB, FB_KEY, FB_PROJ, GAS, IMGBB, SECRET, FCM_CLIENT_EMAIL, FCM_PRIVATE_KEY, C, SPACE, RADIUS, tint };
