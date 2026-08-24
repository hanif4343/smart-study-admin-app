/* ══════════ BOTTOM NAV CONFIG ══════════ */

const NAV=[
  {id:"dashboard",  icon:"📊", label:"Dashboard"},
  {id:"students",   icon:"👥", label:"Users",    badge:true},
  {id:"content",    icon:"🗂️", label:"ম্যানেজ করুন"},
  {id:"notify",     icon:"📣", label:"Notify"},
  {id:"approval",   icon:"✅", label:"Approval", badge:true,
    children:[
      {id:"reports",    icon:"🚨", label:"Reports"},
      {id:"techniques", icon:"🧠", label:"Techniques"},
      {id:"review",     icon:"🔎", label:"Review"},
    ]
  },
  {id:"uploader",   icon:"✍️", label:"তৈরি করুন", landingId:"uploaderhub",
    /* landingId: এই নেভ-আইটেমে ট্যাপ করলে সরাসরি প্রথম child (bulkupload)-এ না গিয়ে
       আগে "uploaderhub" (লঞ্চার-গ্রিড) দেখানো হয় — দেখুন App.jsx bottom-nav onClick
       🐛 ফিক্স (IA পুনর্গঠন): "Uploader" নামটা প্রযুক্তি বলছিল, কাজ বলছিল না — "তৈরি করুন"
       করা হলো। Archive এখান থেকে সরিয়ে "ম্যানেজ করুন" (content hub)-এ নেওয়া হলো, কারণ
       Archive "তৈরি করা" না, "পুরনো জিনিস খোঁজা"। Model Test এখানে যোগ হলো (generative
       টুল বলে) — আগে ভুলভাবে "ম্যানেজ করুন"-এর edit-tools-এর পাশে ছিল। */
    children:[
      {id:"bulkupload",  icon:"📝", label:"Bulk Upload"},
      {id:"singleentry", icon:"✍️", label:"Single প্রশ্ন"},
      {id:"typing",      icon:"⌨️", label:"Typing"},
      {id:"joblauncher", icon:"🚀", label:"Exp Gen"},
      {id:"qbankconv",   icon:"🔁", label:"QBank→Quiz"},
      {id:"questiongen", icon:"🧬", label:"AI প্রশ্ন"},
      {id:"modeltest",   icon:"🧪", label:"Model Test"},
      {id:"aiimport",    icon:"📸", label:"Single Subject"},
      {id:"multiimport", icon:"🗂️", label:"Multi-Subject"},
    ]
  },
];

export { NAV };
