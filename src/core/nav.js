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
    ]
  },
  {id:"uploader",   icon:"📤", label:"Uploader",
    children:[
      {id:"bulkupload",  icon:"📝", label:"Bulk Upload"},
      {id:"joblauncher", icon:"🚀", label:"AI Job"},
      {id:"qbankconv",   icon:"🔁", label:"QBank→Quiz"},
      {id:"questiongen", icon:"🧬", label:"AI প্রশ্ন"},
      {id:"aiimport",    icon:"📸", label:"AI Import"},
      {id:"multiimport", icon:"🗂️", label:"Multi-Subject"},
      {id:"typing",      icon:"⌨️", label:"Typing"},
    ]
  },
];

export { NAV };
