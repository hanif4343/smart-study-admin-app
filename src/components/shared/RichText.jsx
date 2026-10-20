/* ══════════ RichText — ডেটাবেজে ট্যাগসহ সেভ হওয়া লেখা (প্রশ্ন/উত্তর) পড়ার জন্য সুন্দর রেন্ডার ══════════
   PaperComposer-এর রিচ-ঘর যে ট্যাগ লেখে সেগুলোই বোঝে: <b> <u> <i> <sup> <sub> <sqrt> <frac>ওপর|নিচ</frac>
   (ট্যাগ-ছাড়া সাধারণ লেখা হুবহু আগের মতোই দেখায়)। কোনো dangerouslySetInnerHTML নেই — লেখা সবসময় টেক্সট হিসেবেই বসে, তাই নিরাপদ। */
import React from "react";

const TOK=/(<frac>[\s\S]*?<\/frac>|<\/?(?:b|u|i|sup|sub|sqrt)>)/;
const OPEN={b:"b",u:"u",i:"i",sup:"sup",sub:"sub",sqrt:"sqrt"};

function build(text,keyBase){
  const parts=String(text==null?"":text).split(TOK);
  const root={children:[]}, stack=[root];
  const top=()=>stack[stack.length-1];
  parts.forEach((p,k)=>{
    if(!p) return;
    const fm=/^<frac>([\s\S]*?)\|([\s\S]*?)<\/frac>$/.exec(p);
    if(fm){ top().children.push(<span key={keyBase+k} style={{display:"inline-flex",flexDirection:"column",verticalAlign:"middle",textAlign:"center",margin:"0 2px",lineHeight:1.15,fontSize:".95em"}}>
      <span style={{borderBottom:"1px solid currentColor",padding:"0 3px"}}>{build(fm[1],keyBase+k+"n")}</span><span style={{padding:"0 3px"}}>{build(fm[2],keyBase+k+"d")}</span></span>); return; }
    const om=/^<(b|u|i|sup|sub|sqrt)>$/.exec(p);
    if(om){ stack.push({tag:om[1],children:[]}); return; }
    const cm=/^<\/(b|u|i|sup|sub|sqrt)>$/.exec(p);
    if(cm){
      // বন্ধ-ট্যাগ: মিলে যাওয়া খোলা-ট্যাগ পর্যন্ত নামাও; মিল না পেলে বন্ধ-ট্যাগটা উপেক্ষা (ভুলভাল ট্যাগে ভাঙে না)
      let idx=-1; for(let s=stack.length-1;s>0;s--){ if(stack[s].tag===cm[1]){ idx=s; break; } }
      if(idx<0) return;
      while(stack.length>idx+1){ const n=stack.pop(); top().children.push(wrap(n,keyBase+k)); }
      const n=stack.pop(); top().children.push(wrap(n,keyBase+k));
      return;
    }
    top().children.push(p);
  });
  while(stack.length>1){ const n=stack.pop(); top().children.push(wrap(n,keyBase+"x")); }   // খোলা থেকে যাওয়া ট্যাগ (কেটে-যাওয়া লেখা) — শেষ পর্যন্ত প্রযোজ্য
  return root.children;
}
let _k=0;
function wrap(n,key){
  const k=key+"_"+(_k++);
  if(n.tag==="b")   return <b key={k}>{n.children}</b>;
  if(n.tag==="u")   return <u key={k}>{n.children}</u>;
  if(n.tag==="i")   return <i key={k}>{n.children}</i>;
  if(n.tag==="sup") return <sup key={k} style={{fontSize:".72em",lineHeight:0}}>{n.children}</sup>;
  if(n.tag==="sub") return <sub key={k} style={{fontSize:".72em",lineHeight:0}}>{n.children}</sub>;
  return <span key={k} style={{borderTop:"1.5px solid currentColor",padding:"0 1px",marginLeft:1}}><span style={{marginRight:1}}>√</span>{n.children}</span>;
}

export function RichText({text,style,className}){
  return <span className={className} style={style}>{build(text,"r")}</span>;
}
// তালিকায় ছোট করে দেখানোর সময় কেটে-যাওয়া অর্ধেক ট্যাগ ("<fr") বাদ দিয়ে তারপর কাটা
export function clipRich(text,max){
  const s=String(text==null?"":text);
  if(s.length<=max) return s;
  return s.slice(0,max).replace(/<frac>[^<]*$/,"").replace(/<[^>]*$/,"");   // কেটে-যাওয়া অর্ধেক ট্যাগ/অসমাপ্ত ভগ্নাংশ বাদ
}
export default RichText;
