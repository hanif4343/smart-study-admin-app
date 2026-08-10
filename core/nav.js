/* ══════════ BOTTOM NAV CONFIG ══════════ */

const NAV=[
  {id:"dashboard",  icon:"📊", label:"Dashboard"},
  {id:"students",   icon:"👥", label:"Users",    badge:true},
  {id:"content",    icon:"📋", label:"Content"},
  {id:"notify",     icon:"📣", label:"Notify"},
  {id:"approval",   icon:"✅", label:"Approval", badge:true,
    children:[
      {id:"reports",    icon:"🚨", label:"Reports"},
      {id:"techniques", icon:"🧠", label:"Techniques"},
      {id:"review",     icon:"🔎", label:"Review"},
    ]
  },
  {id:"uploader",   icon:"📤", label:"Uploader", landingId:"uploaderhub",
    /* landingId: এই নেভ-আইটেমে ট্যাপ করলে সরাসরি প্রথম child (bulkupload)-এ না গিয়ে
       আগে "uploaderhub" (লঞ্চার-গ্রিড) দেখানো হয় — দেখুন App.jsx bottom-nav onClick */
    children:[
      {id:"bulkupload",  icon:"📝", label:"Bulk Upload"},
      {id:"singleentry", icon:"✍️", label:"Single প্রশ্ন"},
      {id:"typing",      icon:"⌨️", label:"Typing"},
      {id:"joblauncher", icon:"🚀", label:"Exp Gen"},
      {id:"qbankconv",   icon:"🔁", label:"QBank→Quiz"},
      {id:"questiongen", icon:"🧬", label:"AI প্রশ্ন"},
      {id:"aiimport",    icon:"📸", label:"Single Subject"},
      {id:"multiimport", icon:"🗂️", label:"Multi-Subject"},
      {id:"archive",     icon:"🗄️", label:"Archive"},
    ]
  },
];

export { NAV };
