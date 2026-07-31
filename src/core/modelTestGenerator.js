/* ══════════ MODEL TEST GENERATOR ══════════
   মূল অ্যাপের ModelTestGenerator.kt + MenuViewModel.adminGenerateModelTests()
   এর হুবহু পোর্ট। Firebase path: ModelTests/{subject}/{testNumber} =
   { title, type, totalMarks, createdAt, questions:{idx:"sheet|id"} }
   sourceKey "sheet|id" — id = সেই sheet-এর Firebase key (_fbKey), ঠিক
   main app-এর QuestionItem.sourceKey() এর মতোই।

   ⚠️ Phase 5 update — group_id-aware selection: multi-part প্রশ্ন
   (একই instruction-এর ৫টা sub-question, যেমন "কারক নির্ণয় কর") এখন
   group_id দিয়ে চিহ্নিত থাকে (BulkUploaderPage-এর 🔗 Group Mode)।
   এই জেনারেটর এখন প্রতিটা group_id-কে একটা অবিভাজ্য "unit" হিসেবে ট্রিট করে —
   হয় গ্রুপের সবগুলো sub-question একসাথে সিলেক্ট হবে, নয়তো একটাও না।
   group_id ছাড়া প্রশ্ন আগের মতোই একক (size-1) unit।
*/

function getQTypeRaw(q){
  return (q["Question Type"]||q.QType||q.qtype||"MCQ").toString().trim().toLowerCase();
}
function isImportantFlag(q){
  const v=q.important??q.Important??q.is_important??q.isImportant;
  return v===true||v==="true"||v===1||v==="1";
}

// pool-এর সোর্সকী-লেভেল আইটেম (Quiz|Q1, QBank|Q1...) থেকে group_id-ভিত্তিক
// "unit" বানায়। একই group_id-এর সবগুলো sourceKey একটা unit-এ একসাথে থাকে,
// group_id না থাকলে প্রতিটা প্রশ্ন নিজেই একটা unit (size 1)।
function buildUnits(pool){
  const seen=new Set();
  const groupMap={};
  const units=[];
  pool.forEach(p=>{
    if(seen.has(p.sourceKey))return;
    seen.add(p.sourceKey);
    const gid=(p.groupId||"").toString().trim();
    const subIdxNum=Number(p.subIndex);
    const subIdx=Number.isFinite(subIdxNum)?subIdxNum:Number.MAX_SAFE_INTEGER;
    if(gid){
      let u=groupMap[gid];
      if(!u){
        u={unitKey:`G|${gid}`,groupId:gid,items:[],important:false};
        groupMap[gid]=u;
        units.push(u);
      }
      u.items.push({sourceKey:p.sourceKey,subIndex:subIdx});
      if(p.important)u.important=true;
    }else{
      units.push({unitKey:p.sourceKey,groupId:null,items:[{sourceKey:p.sourceKey,subIndex:0}],important:!!p.important});
    }
  });
  // গ্রুপের ভেতরের sub-question গুলো sub_index অনুযায়ী সাজানো (test-এ পাশাপাশি
  // ঠিক ক্রমে দেখানোর জন্য)
  units.forEach(u=>{
    if(u.items.length>1)u.items.sort((a,b)=>a.subIndex-b.subIndex);
    u.sourceKeys=u.items.map(it=>it.sourceKey);
    u.size=u.sourceKeys.length;
  });
  return units;
}

// Kotlin ModelTestGenerator.generate() এর হুবহু পোর্ট — group_id-aware সংস্করণ।
// perTest এখন "প্রশ্ন সংখ্যা"-র বাজেট হিসেবে ট্রিট হয়; কোনো group ভাঙা হয় না —
// বাজেটে জায়গা না হলে সেই group এই টেস্টে বাদ পড়ে যাবে (অন্য/ছোট unit দিয়ে
// পূরণ করার চেষ্টা হবে), ফলে totalMarks কখনো কখনো চাওয়া perTest-এর চেয়ে
// কিছুটা কম হতে পারে — এটাই প্রত্যাশিত (group ভাঙার চেয়ে ভালো)।
function runModelTestGenerator(pool, count, perTest, importantRatioRange=[0.30,0.40]){
  if(pool.length===0||count<=0||perTest<=0){
    return{tests:[],warning:"❌ প্রশ্ন পুল খালি অথবা সংখ্যা ভুল — Model Test বানানো যায়নি"};
  }

  const units=buildUnits(pool);
  const unitMap={};
  units.forEach(u=>{unitMap[u.unitKey]=u;});

  const totalQuestions=units.reduce((s,u)=>s+u.size,0);
  const importantUnits=units.filter(u=>u.important);
  const oversizedGroups=units.filter(u=>u.groupId&&u.size>perTest);

  const warnings=[];
  if(totalQuestions<perTest){
    warnings.push(`⚠️ এই subject-এ মোট ${totalQuestions}টি প্রশ্ন আছে (গ্রুপসহ), কিন্তু প্রতি টেস্টে ${perTest} টি চাওয়া হয়েছে — প্রতিটা টেস্টে যতগুলো সম্ভব ততগুলোই থাকবে (repeat বাধ্যতামূলক আলাদা টেস্টগুলোর মধ্যে)`);
  }
  if(oversizedGroups.length>0){
    warnings.push(`⚠️ ${oversizedGroups.length}টি multi-part প্রশ্ন-গ্রুপ (মোট sub-question সংখ্যা প্রতি টেস্টের ${perTest}-এর চেয়ে বেশি) কোনো টেস্টেই ঢুকতে পারবে না — group ভাঙা হয় না বলে। এগুলো বাদ দিয়ে বাকি প্রশ্ন থেকে টেস্ট বানানো হয়েছে`);
  }
  const warning=warnings.length?warnings.join(" | "):null;

  const usage={};
  units.forEach(u=>{usage[u.unitKey]=0;});

  const shuffle=arr=>{
    const a=[...arr];
    for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}
    return a;
  };

  // candidates থেকে unit বাছাই করে `used`-এ যোগ করে, যতক্ষণ না budget.remaining
  // শেষ হয়ে যায়। কোনো unit-এর size budget-এর চেয়ে বড় হলে সেটা এই রাউন্ডে
  // স্কিপ হয় (group ভাঙা হয় না), কিন্তু ছোট unit দিয়ে budget পূরণের চেষ্টা চলে।
  const pickFrom=(candidates,budget,used)=>{
    if(budget.remaining<=0)return;
    const remaining=candidates.filter(u=>!used.has(u.unitKey));
    const groups={};
    remaining.forEach(u=>{const usg=usage[u.unitKey]||0;(groups[usg]=groups[usg]||[]).push(u);});
    const order=Object.keys(groups).map(Number).sort((a,b)=>a-b);
    for(const k of order){
      const shuffled=shuffle(groups[k]);
      for(const u of shuffled){
        if(budget.remaining<=0)return;
        if(used.has(u.unitKey))continue;
        if(u.size>budget.remaining)continue; // এই রাউন্ডে জায়গা নেই — group ভাঙা যাবে না
        used.add(u.unitKey);
        budget.remaining-=u.size;
      }
    }
  };

  const tests=[];
  for(let testNum=1;testNum<=count;testNum++){
    const used=new Set();
    const ratio=importantRatioRange[0]+Math.random()*(importantRatioRange[1]-importantRatioRange[0]);
    const wantImportant=Math.max(0,Math.min(perTest,Math.floor(perTest*ratio)));

    let mainRemaining=perTest;
    if(importantUnits.length>0){
      const importantBudget={remaining:wantImportant};
      pickFrom(importantUnits,importantBudget,used);
      mainRemaining=perTest-(wantImportant-importantBudget.remaining);
    }
    pickFrom(units,{remaining:mainRemaining},used);

    const keys=[];
    used.forEach(unitKey=>{
      usage[unitKey]=(usage[unitKey]||0)+1;
      keys.push(...unitMap[unitKey].sourceKeys);
    });
    tests.push({testNumber:testNum,questionKeys:keys});
  }
  return{tests,warning};
}


export { getQTypeRaw, isImportantFlag, runModelTestGenerator };
