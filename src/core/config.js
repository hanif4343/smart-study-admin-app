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

const C={bg:"#06080f",card:"#0c1220",border:"#16253d",accent:"#3b82f6",green:"#22c55e",red:"#ef4444",yellow:"#f59e0b",purple:"#8b5cf6",text:"#e2e8f0",muted:"#4b5e7a",panel:"#0e1a2e",navBg:"#080f1c"};

export { FB, FB_KEY, FB_PROJ, GAS, IMGBB, SECRET, FCM_CLIENT_EMAIL, FCM_PRIVATE_KEY, C };
