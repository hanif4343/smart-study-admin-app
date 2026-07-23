/* ══════════ MODEL TEST GENERATOR ══════════
   মূল অ্যাপের ModelTestGenerator.kt + MenuViewModel.adminGenerateModelTests()
   এর হুবহু পোর্ট। Firebase path: ModelTests/{subject}/{testNumber} =
   { title, type, totalMarks, createdAt, questions:{idx:"sheet|id"} }
   sourceKey "sheet|id" — id = সেই sheet-এর Firebase key (_fbKey), ঠিক
   main app-এর QuestionItem.sourceKey() এর মতোই।
*/

function getQTypeRaw(q){
  return (q["Question Type"]||q.QType||q.qtype||"MCQ").toString().trim().toLowerCase();
}
function isImportantFlag(q){
  const v=q.important??q.Important??q.is_important??q.isImportant;
  return v===true||v==="true"||v===1||v==="1";
}
// Kotlin ModelTestGenerator.generate() এর হুবহু পোর্ট
function runModelTestGenerator(pool, count, perTest, importantRatioRange=[0.30,0.40]){
  if(pool.length===0||count<=0||perTest<=0){
    return{tests:[],warning:"❌ প্রশ্ন পুল খালি অথবা সংখ্যা ভুল — Model Test বানানো যায়নি"};
  }
  const seen=new Set(),distinctPool=[];
  pool.forEach(p=>{if(!seen.has(p.sourceKey)){seen.add(p.sourceKey);distinctPool.push(p);}});
  const importantPool=distinctPool.filter(p=>p.important);

  const warning=distinctPool.length<perTest
    ?`⚠️ এই subject-এ মোট ${distinctPool.length}টি প্রশ্ন আছে, কিন্তু প্রতি টেস্টে ${perTest} টি চাওয়া হয়েছে — প্রতিটা টেস্টে যতগুলো সম্ভব ততগুলোই থাকবে (repeat বাধ্যতামূলক আলাদা টেস্টগুলোর মধ্যে)`
    :null;

  const usage={};
  distinctPool.forEach(p=>{usage[p.sourceKey]=0;});

  const shuffle=arr=>{
    const a=[...arr];
    for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}
    return a;
  };
  const pickFrom=(candidates,n,used)=>{
    if(n<=0)return;
    const remaining=candidates.filter(p=>!used.has(p.sourceKey));
    const groups={};
    remaining.forEach(p=>{const u=usage[p.sourceKey]||0;(groups[u]=groups[u]||[]).push(p);});
    let ordered=[];
    Object.keys(groups).map(Number).sort((a,b)=>a-b).forEach(k=>{ordered=ordered.concat(shuffle(groups[k]));});
    ordered.slice(0,n).forEach(p=>used.add(p.sourceKey));
  };

  const tests=[];
  for(let testNum=1;testNum<=count;testNum++){
    const used=new Set();
    const ratio=importantRatioRange[0]+Math.random()*(importantRatioRange[1]-importantRatioRange[0]);
    const wantImportant=Math.max(0,Math.min(perTest,Math.floor(perTest*ratio)));
    if(importantPool.length>0)pickFrom(importantPool,wantImportant,used);
    pickFrom(distinctPool,perTest-used.size,used);
    const keys=[...used];
    keys.forEach(k=>{usage[k]=(usage[k]||0)+1;});
    tests.push({testNumber:testNum,questionKeys:keys});
  }
  return{tests,warning};
}


export { getQTypeRaw, isImportantFlag, runModelTestGenerator };
