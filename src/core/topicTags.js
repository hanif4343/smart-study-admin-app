/* ══════════ TOPIC TAGS / AUTO-CLASSIFY — GAS API ══════════
   GAS: AutoClassify.gs (action/type = tt_*)। GET = ছোট প্যারামিটার, POST = রুল সেভ ও টেস্ট (লম্বা keywords)। */
import { GAS } from "./config.js";

async function ttGet(action,gasSecret,params={}){
  if(!GAS) return{status:"error",message:"GAS URL সেট করা নেই"};
  if(!gasSecret) return{status:"error",message:"GAS Secret Key দাও"};
  try{
    const qs=new URLSearchParams({action,secret:gasSecret,...params}).toString();
    const resp=await fetch(`${GAS}?${qs}`);
    const data=await resp.json().catch(()=>null);
    return data||{status:"error",message:"সার্ভার JSON ফেরত দেয়নি (GAS deploy নতুন version দিয়েছ?)"};
  }catch(e){ return{status:"error",message:e?.message||String(e)}; }
}
async function ttPost(type,gasSecret,body={}){
  if(!GAS) return{status:"error",message:"GAS URL সেট করা নেই"};
  if(!gasSecret) return{status:"error",message:"GAS Secret Key দাও"};
  try{
    const resp=await fetch(GAS,{method:"POST",headers:{"Content-Type":"text/plain"},body:JSON.stringify({secret:gasSecret,type,...body})});
    const data=await resp.json().catch(()=>null);
    return data||{status:"error",message:"সার্ভার JSON ফেরত দেয়নি (GAS deploy নতুন version দিয়েছ?)"};
  }catch(e){ return{status:"error",message:e?.message||String(e)}; }
}

export const ttGetSettings   =(s)=>ttGet("tt_getSettings",s);
export const ttSetUploadAuto =(s,on)=>ttGet("tt_setSettings",s,{uploadAuto:on?"Y":"N"});
export const ttSetup         =(s)=>ttGet("tt_setup",s);
export const ttGetRules      =(s)=>ttGet("tt_getRules",s);
export const ttSaveRule      =(s,rule)=>ttPost("tt_saveRule",s,{rule});
export const ttDeleteRule    =(s,rule_id)=>ttGet("tt_deleteRule",s,{rule_id});
export const ttTest          =(s,q,rule)=>ttPost("tt_test",s,rule?{q,rule}:{q});
export const ttPreview       =(s,ruleId,mode,subject_id)=>ttGet("tt_preview",s,{...(ruleId?{ruleId}:{}),mode:mode||"blank",...(subject_id?{subject_id}:{})});
export const ttApply         =(s,ruleId,mode,subject_id,includeIds,excludeIds)=>ttPost("tt_apply",s,{ruleId:ruleId||"",mode:mode||"blank",subject_id:subject_id||"",...(includeIds?{includeIds}:{}),excludeIds:excludeIds||[]});
export const ttUndoLast      =(s)=>ttGet("tt_undoLast",s);
export const ttUndoAll       =(s)=>ttGet("tt_undoAll",s);
export const ttReview        =(s,kind,cursor)=>ttGet("tt_review",s,{kind,limit:"40",...(cursor?{cursor:String(cursor)}:{})});
export const ttUndoOne       =(s,id)=>ttGet("tt_undoOne",s,{id});
export const ttConfirmOne    =(s,id)=>ttGet("tt_confirmOne",s,{id});
export const ttSuggest        =(s,topic_id,scope)=>ttGet("tt_suggest",s,{topic_id,scope});
