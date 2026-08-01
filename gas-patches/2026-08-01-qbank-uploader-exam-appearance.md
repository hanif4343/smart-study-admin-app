# GAS প্যাচ — QBank বাল্ক আপলোডে সরাসরি Exam Appearance যোগ

## এটা কেন দরকার
এডমিন অ্যাপের ⚡ বাল্ক আপলোডার-এ QBank mode-এ এখন পদ/প্রতিষ্ঠান/সাল (ঐচ্ছিক)
ফিল্ড যোগ করা হয়েছে। **Save Location = Firebase** হলে এটা কোনো ব্যাকএন্ড
পরিবর্তন ছাড়াই কাজ করে (প্রশ্নের id আগে থেকেই জানা থাকে, তাই সরাসরি
`addExamAppearance` কল হয়)।

কিন্তু **Save Location = Google Sheet** হলে সমস্যা — `bulk_save_rows`
অ্যাকশনে প্রতিটা নতুন প্রশ্নের `question_id` (`bId`) সার্ভার-সাইডে assign হয়
(`bCurId+1`), front-end আগে থেকে জানে না। তাই front-end এখন
`bulk_save_rows` রিকোয়েস্টে (ঐচ্ছিক) একটা `examAppearance` অবজেক্ট পাঠায়:

```json
{ "postId": "P07", "institutionId": "I23", "year": "2025" }
```

GAS-কে এটা বুঝে, QBank-এর জন্য তৈরি হওয়া প্রতিটা নতুন `bId`-এর সাথে
`Exam_Appearances` শীটে একটা করে appearance-রো নিজেই বসিয়ে দিতে হবে —
একই batch/lock-এর ভেতরেই, যাতে race condition না হয়।

## ⚠️ গুরুত্বপূর্ণ নোট
এই repo-র `code_updated.gs` ফাইলটা স্টেল (Phase 5-এর
Reference/Exam_Appearances অ্যাকশনগুলোই এখানে নেই — সেগুলো নিশ্চয়ই তোমার
আসল ডিপ্লয়েড Apps Script প্রজেক্টে যোগ করা আছে, এই zip-এ আপডেট হয়নি)।
তাই নিচের কোডটা কপি-পেস্ট করার আগে নিজের আসল `bulk_save_rows` হ্যান্ডলারে
গিয়ে মিলিয়ে নিও — লজিক (কোথায়/কীভাবে বসবে) এখানে ব্যাখ্যা করা হলো, লাইন
নম্বর হুবহু নাও মিলতে পারে।

## কোথায় বসবে
`bulk_save_rows` হ্যান্ডলারে, যেখানে প্রতিটা রো-এর জন্য `bId` অ্যাসাইন হয়
আর `bLine` বানানো হয় (QBank ব্লক), ঠিক তার পরেই।

## যা যোগ করতে হবে

**১. Lock-এর ভেতরে, appearance rows জমা করার অ্যারে (loop শুরুর আগে):**
```javascript
var bAppearanceRows=[];
var bAppearanceProp, bAppearanceCurId;
if(params.examAppearance && bTab==="QBank"){
  bAppearanceProp=PropertiesService.getScriptProperties();
  bAppearanceCurId=parseInt(bAppearanceProp.getProperty("MAX_ID_EXAM_APPEARANCES")||"0");
  if(bAppearanceCurId<1){
    var apSh=ss.getSheetByName("Exam_Appearances");
    if(apSh && apSh.getLastRow()>1){
      var apIdCol=apSh.getRange(2,1,apSh.getLastRow()-1,1).getValues().map(function(r){return parseInt(r[0])||0;});
      bAppearanceCurId=Math.max.apply(null,[0].concat(apIdCol));
    }
  }
}
```

**২. `bId` অ্যাসাইন হওয়ার পর (একই for-loop-এর ভেতরে, QBank ব্লকে, `bNewRows.push(bLine)`-এর ঠিক পরে):**
```javascript
if(params.examAppearance && bTab==="QBank"){
  bAppearanceCurId++;
  bAppearanceRows.push([
    "EA"+bAppearanceCurId, // appearance_id
    bId,                   // question_id — এই প্রশ্নের জন্য এইমাত্র assign হওয়া id
    params.examAppearance.postId||"",
    params.examAppearance.institutionId||"",
    params.examAppearance.year||""
  ]);
}
```

**৩. loop শেষে, `bNewRows` batch-write-এর পাশে (একই `try` ব্লকে, lock ছাড়ার আগে):**
```javascript
if(bAppearanceRows.length){
  var apSheet=ss.getSheetByName("Exam_Appearances");
  if(apSheet){
    apSheet.getRange(apSheet.getLastRow()+1,1,bAppearanceRows.length,5).setValues(bAppearanceRows);
    bAppearanceProp.setProperty("MAX_ID_EXAM_APPEARANCES",bAppearanceCurId.toString());
  }
}
```

**৪. রেসপন্সে যোগ করো (যেখানে এখন `return json({result:"success",added:bAdded,skipped:bSkipped,firebaseSynced:bSyncOk});` আছে):**
```javascript
return json({result:"success",added:bAdded,skipped:bSkipped,firebaseSynced:bSyncOk,examAppearancesAdded:bAppearanceRows.length});
```

## এটা প্যাচ না করলে কী হবে
প্রশ্নগুলো ঠিকই Sheet-এ সেভ হবে (কোনো ক্ষতি নেই) — শুধু appearance যোগ হবে
না, front-end একটা warning দেখাবে ("Exam Appearance যোগ হয়নি")। তখন
"🗂️ Exam Appearances" ট্যাব থেকে question_id বসিয়ে ম্যানুয়ালি যোগ করে
নেওয়া যাবে।
