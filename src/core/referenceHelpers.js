/* ══════════ REFERENCE RESOLVE-OR-CREATE HELPER ══════════
   পদ (Post) / প্রতিষ্ঠান (Institution)-এর মতো "open-world" রেফারেন্স ফিল্ড —
   ড্রপডাউনে আগে থেকে সব বসানো অসম্ভব, তাই টাইপ-করা নাম নিয়ে:
     • বিদ্যমান তালিকায় (case/space বাদ দিয়ে) হুবহু মিল থাকলে সেই id রিইউজ করে
     • না থাকলে addReferenceItem দিয়ে নতুন এন্ট্রি বানিয়ে সেই id ফেরত দেয়
   TypeaheadCombo কম্পোনেন্ট শুধু UI/ম্যাচিং দেখায়, আসল create-বা-reuse
   সিদ্ধান্ত এই ফাংশনেই হয় — এক জায়গায় রাখা হলো যাতে ExamAppearancesTab আর
   BulkUploaderPage দুটোই একই লজিক শেয়ার করে (ভিন্ন ভিন্ন কপি রাখলে একটায়
   ফিক্স করলে আরেকটা বাদ পড়ার ঝুঁকি থাকে)। ── */
import { addReferenceItem } from "./sheetSave.js";

const norm=s=>String(s||"").trim().toLowerCase().replace(/\s+/g," ");

/**
 * sel: {id,name} — TypeaheadCombo-র value (id ফাঁকা মানে বিদ্যমান তালিকায় হুবহু মিল নেই)
 * refType: "posts" | "institutions" (addReferenceItem-এর refType)
 * options: [{id,name}] — বর্তমান বিদ্যমান তালিকা (matching-এর জন্য)
 * ফেরত: {ok, id, created?} — created:true মানে নতুন এন্ট্রি বানানো হয়েছে (caller চাইলে refData রিফ্রেশ করুক)
 */
async function resolveOrCreateReference({sel,refType,options,gasSecret,push}){
  const name=(sel?.name||"").trim();
  if(!name) return{ok:false};
  if(sel?.id) return{ok:true,id:sel.id};
  const hit=(options||[]).find(o=>norm(o.name)===norm(name));
  if(hit) return{ok:true,id:hit.id};
  const res=await addReferenceItem({refType,name,gasSecret,push});
  return res.ok?{ok:true,id:res.id,created:true}:{ok:false};
}

export { resolveOrCreateReference, norm };
