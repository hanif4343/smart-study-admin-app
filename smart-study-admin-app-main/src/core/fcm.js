import { GAS } from "./config.js";
import { _LC } from "./logger.js";
import { phoneKey, loadSharedGasSecret } from "./utils.js";

/* ══════════════════════════════════════════════════════════════════════════
   📲 FCM — GAS-প্রক্সি হয়ে পাঠানো (সিকিউরিটি ফিক্স)
   🐛 আগে এই ফাইলেই Service Account-এর প্রাইভেট কী (VITE_FCM_PRIVATE_KEY) দিয়ে
   ব্রাউজারে JWT সাইন করে সরাসরি FCM API-তে হিট করা হতো। সমস্যা: Vite-এর VITE_
   প্রিফিক্স মানেই বিল্ড-টাইমে ওই কী পাবলিক JS বান্ডেলে বসে যায় — অ্যাডমিন সাইট
   দেখা যেকেউ "View Source" করে এই কী বের করে আপনার Firebase প্রজেক্টে যা খুশি
   নোটিফিকেশন পাঠাতে পারতো (privilege-এর উপর নির্ভর করে আরও বেশি কিছুও)।
   এখন এই ফাইল কোনো ক্রেডেনশিয়াল রাখে না — GAS-এর নতুন notify_phone/notify_bulk
   action কল করে, যেটা GAS-এর নিজের Script Properties-এ (সার্ভার-সাইড, কখনো
   ব্রাউজারে যায় না) থাকা sendFCMToPhone/sendFCMToAll ফাংশন ব্যবহার করে।
   ফাংশনের নাম/প্যারামিটার/রিটার্ন-টাইপ আগের মতোই রাখা হয়েছে — তাই
   ChangePasswordModal.jsx/ReportEditModal.jsx/NotifyPage.jsx/NotifyModal.jsx/
   TechniquesPage.jsx — এই ৫টা কল-সাইটের কোনোটাতেই কোনো পরিবর্তন লাগেনি।
   ══════════════════════════════════════════════════════════════════════════ */

async function _gasFcmPost(payload){
  if(!GAS){ _LC.warn("fcm","GAS URL সেট করা নেই (VITE_GAS_URL)"); return null; }
  try{
    const secret=loadSharedGasSecret();
    const r=await fetch(GAS,{ method:"POST", body:JSON.stringify({ secret, ...payload }) });
    return await r.json().catch(()=>null);
  }catch(e){
    _LC.error("fcm","GAS FCM প্রক্সি কল ব্যর্থ: "+e.message);
    return null;
  }
}

/* Phone নম্বর থেকে notification পাঠাও (GAS নিজে Firebase থেকে fcmToken পড়ে) */
async function fcmNotifyPhone(phone, title, body, extraData) {
  if(!phone) return false;
  const j=await _gasFcmPost({ type:"notify_phone", phone:phoneKey(phone)||phone, title, body, data:extraData||{} });
  const ok=!!(j && j.result==="success" && j.fcm && !j.fcm.error);
  _LC.api("fcmNotifyPhone", ok?"✅ পাঠানো হয়েছে":"⚠️ ব্যর্থ", { phone: String(phone).slice(-4), title });
  return ok;
}

/* একাধিক ইউজারকে (client-এ আগে থেকে ফিল্টার করা লিস্ট) broadcast করো */
async function fcmBroadcast(title, body, users) {
  const phones=(users||[]).map(u=>u.Phone||u.phone||"").filter(Boolean);
  if(!phones.length) return 0;
  const j=await _gasFcmPost({ type:"notify_bulk", phones, title, body, data:{} });
  const sent=(j && j.result==="success") ? (j.sent||0) : 0;
  _LC.api("fcmBroadcast", `Broadcast done: ${sent}/${phones.length}`, { title });
  return sent;
}

export { fcmNotifyPhone, fcmBroadcast };
