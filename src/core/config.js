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
const C={
  bg:"#06080f",card:"#0c1220",border:"#16253d",
  accent:"#3b82f6",green:"#22c55e",red:"#ef4444",yellow:"#f59e0b",purple:"#8b5cf6",
  text:"#e2e8f0",muted:"#4b5e7a",panel:"#0e1a2e",navBg:"#080f1c",
  // ── সিমান্টিক এলিয়াস (Phase ১) ──
  info:"#3b82f6",       // = accent
  success:"#22c55e",    // = green
  danger:"#ef4444",     // = red
  warning:"#f59e0b",    // = yellow
  ai:"#8b5cf6",         // = purple
  ocr:"#22d3ee",        // নতুন — শুধু OCR/স্ক্যান ফিচার ট্যাগে ব্যবহার হবে
};

/* ══════ স্পেসিং ও রেডিয়াস স্কেল (Phase ১) ══════
   একটা কনসিস্টেন্ট 4px-বেসড স্কেল — ভবিষ্যতের সব নতুন কম্পোনেন্ট এখান থেকে
   মান নেবে, নিজের মতো ম্যাজিক-নাম্বার (12px/13px/11px মিশিয়ে) বসাবে না। */
const SPACE={xs:4,sm:8,md:12,lg:16,xl:24,xxl:32};
const RADIUS={sm:8,md:12,lg:16,xl:20};

export { FB, FB_KEY, FB_PROJ, GAS, IMGBB, SECRET, FCM_CLIENT_EMAIL, FCM_PRIVATE_KEY, C, SPACE, RADIUS };
