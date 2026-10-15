# Step 5 — Admin App এখন নতুন নিয়মে `Questions` শিট ও CDN-এ লেখে

Admin App-এর সব লেখা/মোছা/মুভ/Publish GAS দিয়ে যায়, তাই কাজটা GAS-এ (`code_updated.gs`) করা হয়েছে —
React অ্যাপে শুধু একটা প্লেসহোল্ডার বদলেছে। **Student App আর Admin App একই GAS ডিপ্লয়মেন্ট ব্যবহার করে।**

## নতুন নিয়ম
- নতুন প্রশ্নের আইডি `QN` + (সর্বোচ্চ নম্বর + ১) → `QN015929`, `QN015930` …
- `in_quiz` = Quiz-এ আছে, `in_qbank` = QBank-এ আছে (নতুন কলাম, `mig5_addInQbank` বসায়)।
  - Quiz-এ যোগ → in_quiz=Y, in_qbank=N
  - QBank-এ যোগ → in_qbank=Y; MCQ + classified=Y হলে in_quiz=Y আপনা-আপনি, নাহলে N
  - একই প্রশ্ন (প্রশ্ন+টপিক+সাবজেক্ট মিললে) আবার যোগ করলে নতুন সারি হয় না — আগের সারির in_quiz/in_qbank Y হয়
    (QBank→Quiz কনভার্টার এখন এভাবেই কাজ করে)
- `classified` = N যদি subject_id ফাঁকা বা S13/S16/S30 পুল, নাহলে Y। subject_id/topic_id বদলালে নিজে হিসাব হয়।
- মোছা: Quiz থেকে মুছলে প্রশ্নটা QBank-এও থাকলে শুধু in_quiz=N; নাহলে সারি + Exam_Appearances_v2 এন্ট্রি মুছে যায়। QBank থেকে মোছাও একই (in_qbank)।
- QBank-এ "Move to Quiz" = ওই প্রশ্নে Subject/Topic বসে + in_quiz=Y (একটাই সারি, তাই টপিক দুই জায়গাতেই এক)।
- Exam Appearances যোগ/মোছা/ক্লিনআপ সবই `Exam_Appearances_v2`-তে।
- Topics-এর `row_count_quiz/qbank` প্রতিটা লেখার পর সাথে সাথে রিফ্রেশ হয়।

## যেসব Admin পথ নতুন নিয়মে গেছে
bulk_save_rows (সব আপলোডার/OCR/AI Import/Archive), qbank_to_quiz_bulk (Q2Q/GitHub Actions), updateField, update_fields,
update_explanation (generate-explanations/mcq-options স্ক্রিপ্ট), renameField, moveQuestions, moveTopic, deleteByIds,
deleteByReferenceId, count/deleteOrphanQuestions, getReviewProgress, getDashboard/DashStats, getSheetRows, getQuestionsPage,
getQuestionsByIds, Exam Appearances, Publish (markAllTopicsDirty/publishNow)।

## ধাপ (এই ক্রমে)
1. Migration.gs আর code_updated.gs দুটোই Apps Script-এ বদলে Save।
2. `mig5_addInQbank` চালান → রিপোর্টে ✅ (QBank Y ≈ ৮০৭৯, শুধু Quiz N ≈ ৭৮৪৭ আসার কথা)।
3. Deploy → Manage deployments → New version (URL একই)।
4. **CDN-এর পুরনো ফাইল বদলানো:** Admin App → Content → Publish ট্যাব → "সব টপিক dirty" (markAllTopicsDirty) → "Publish Now";
   যতক্ষণ বাকি (remaining) ০ না হয় আবার Publish Now।
5. পরীক্ষা: Admin-এ ১টা প্রশ্ন Quiz-এ ও ১টা QBank-এ যোগ করুন → `Questions` শিটে QN আইডি, in_quiz/in_qbank ঠিক কিনা দেখুন → Publish → Student App-এ দেখুন।

## ⚠️ জানা সীমা
- `in_qbank` কলাম না থাকলে Admin-এর লেখা (যোগ/মোছা) থেমে "আগে mig5_addInQbank চালান" এরর দেয় — ডাটা নষ্ট হয় না।
- পুরনো doPost-এর সরাসরি একক-সারি যোগ (tTab পথ), `renameQBankYear`, `*-Archive` শিটের পথ পুরনো Quiz/QBank শিটেই আছে; Admin অ্যাপ এগুলো ব্যবহার করে না (সবই bulk_save_rows দিয়ে)।
- Admin রিপোজিটরির ভেতরের GAS কপি (`code_updated.gs`, `gas-backend/…`) পুরনো — এই নতুন ফাইলটাকেই একমাত্র ব্যাকএন্ড ধরুন।
- মোছা প্রশ্নের গ্রুপ-সদস্যদের (group_id) আলাদা বিশেষ হিসাব নেই, আগের মতোই id ধরে মোছে।
