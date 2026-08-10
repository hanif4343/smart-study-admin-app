/* ══════════ REVIEW TAB (Approval hub) ══════════
   QBank-এর প্রশ্নগুলো স্ক্যান করে যেগুলোর Subject/Topic খালি অথবা কোনো Exam
   Appearance (পদ/প্রতিষ্ঠান/সাল) যোগ করা হয়নি — সেগুলো এক জায়গায় দেখায়।
   আলাদা কোনো "needs_review" queue/import নেই — Uploader-এ যা-ই ঘটুক না কেন
   (group বাদ পড়া, Subject ফাঁকা রেখে সাবমিট ইত্যাদি), QBank sheet-ই সবসময়
   সত্যিকারের উৎস — এই ট্যাব সরাসরি সেটাই স্ক্যান করে।

   উপরে ৪টা কাউন্টার-চিপ (সব/Subject ফাঁকা/Topic ফাঁকা/Appearance ফাঁকা) —
   ক্লিক করলে নিচের লিস্ট ওই ক্যাটেগরিতেই ফিল্টার হয়ে যায় (আলাদা কোনো নেভ/পেজ
   লাগে না, ব্যবহারকারীর অনুরোধ অনুযায়ী)। এডিট করলে সরাসরি Sheet-এ যায়
   (syncFieldsToSheet / addExamAppearance — দুটোই আগে থেকেই sheetSave.js-এ
   আছে), Subject/Topic-এর ক্ষেত্রে resolveOrCreateReference দিয়ে বিদ্যমান
   reference-id রিইউজ বা প্রয়োজনে নতুন তৈরি — ঠিক MultiSubjectImportPage/
   BrowseTab যেভাবে করে, সেই একই প্যাটার্ন। ── */
import React, { useState, useEffect, useMemo } from "react";
import { C } from "../../core/config.js";
import { useSheetRows, invalidate } from "../../core/dataCache.js";
import { toArr, loadSharedGasSecret, saveSharedGasSecret } from "../../core/utils.js";
import { fetchReferenceData, fetchAllExamAppearances, syncFieldsToSheet } from "../../core/sheetSave.js";
import { resolveOrCreateReference } from "../../core/referenceHelpers.js";
import { TypeaheadCombo } from "../../components/shared/TypeaheadCombo.jsx";
import { AppearanceQuickModal } from "./AppearanceQuickModal.jsx";
import { useModalBack } from "../../hooks/useModalBack.js";

const PAGE=20;

/* ── প্রশ্নপত্রের আসল পাতার ছবি (imgbb লিংক, কমা দিয়ে জোড়া, একাধিক পাতা হতে
   পারে) — MultiSubjectImportPage/BulkUploaderPage সেভের সময় এই কলামে লেখে
   (buildSheetRow-এর mainQpaper), আর GAS ব্যাকএন্ড (bulk_save_rows) কলামটা
   খুঁজে নেয় normalized-key ম্যাচ দিয়ে (lowercase + শুধু a-z0-9, দেখো
   code_updated.gs-এর bKeyNorm) — মানে actual header টেক্সট "Question Paper"
   হোক বা "QuestionPaper" বা অন্য যেকোনো স্পেসিং/casing, normalize করলে
   সবসময় "questionpaper"-ই হবে। getSheetRows আসল header টেক্সটটাই key
   হিসেবে ফেরত দেয় (guess করার দরকার নেই) বলে এখানেও ঠিক একই normalize-scan
   পদ্ধতি ব্যবহার করা হলো — আগে যেভাবে কয়েকটা casing variant হার্ডকোড করে
   guess করা হচ্ছিল সেটার বদলে, যাতে actual sheet header যাই থাকুক না কেন
   নিশ্চিতভাবে মিলে যায়। ── */
const _normKey=k=>String(k||"").toLowerCase().replace(/[^a-z0-9]/g,"");
const qPaperUrlsOf=q=>{
  let raw="";
  for(const k in q){
    const nk=_normKey(k);
    if(nk==="questionpaper"||nk==="mainqpaper"){
      const v=(q[k]||"").toString().trim();
      if(v){ raw=v; break; }
    }
  }
  if(!raw)return[];
  return raw.split(",").map(s=>s.trim()).filter(Boolean);
};

/* ── প্রশ্নপত্রের পাতা ফুল-স্ক্রিনে দেখার জন্য — Post/Institution/Year শুধু
   টেক্সট দেখে বোঝা যায় না (পরীক্ষার নাম সাধারণত পাতার হেডারেই থাকে), তাই
   Appearance যোগ করার আগে আসল পাতা বড় করে দেখার এই অপশনটা দরকার। একাধিক পাতা
   হলে আগে/পরে বাটন দিয়ে সুইচ করা যাবে। ── */
function PaperPreviewModal({urls,initialIndex,onClose}){
  useModalBack(onClose);
  const[idx,setIdx]=useState(initialIndex||0);
  return(
    <div className="ovl" style={{background:"#000000ee",alignItems:"stretch",flexDirection:"column"}} onClick={onClose}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"12px 16px",flexShrink:0}} onClick={e=>e.stopPropagation()}>
        <span style={{color:"#fff",fontSize:12,fontWeight:700}}>📄 প্রশ্নপত্র {urls.length>1?`— পাতা ${idx+1}/${urls.length}`:""}</span>
        <button onClick={onClose} style={{background:"transparent",border:"none",color:"#fff",fontSize:22,cursor:"pointer",lineHeight:1}}>✕</button>
      </div>
      <div style={{flex:1,overflow:"auto",display:"flex",alignItems:"center",justifyContent:"center",padding:8}} onClick={e=>e.stopPropagation()}>
        <img src={urls[idx]} alt={`পাতা ${idx+1}`} style={{maxWidth:"100%",maxHeight:"100%",objectFit:"contain"}}/>
      </div>
      {urls.length>1&&(
        <div style={{display:"flex",justifyContent:"center",gap:10,padding:"12px 16px",flexShrink:0}} onClick={e=>e.stopPropagation()}>
          <button className="btn bg" disabled={idx===0} onClick={()=>setIdx(i=>i-1)}>◀ আগের পাতা</button>
          <button className="btn bg" disabled={idx>=urls.length-1} onClick={()=>setIdx(i=>i+1)}>পরের পাতা ▶</button>
        </div>
      )}
    </div>
  );
}

function ReviewTab({push,tick}){
  // ── GAS Secret Key — অন্য সব Phase 5 ট্যাবের মতোই শেয়ার্ড localStorage থেকে,
  // একবার যেকোনো ট্যাবে দিলে এখানেও অটো বসে যায় ──
  const[gasSecret,setGasSecret]=useState(loadSharedGasSecret);
  const setGasSecretP=v=>{ setGasSecret(v); saveSharedGasSecret(v); };
  const[localTick,setLocalTick]=useState(0);
  const refresh=()=>setLocalTick(t=>t+1);

  const{data:raw,loading}=useSheetRows("QBank",(tick||0)+localTick*1000);
  const allQ=useMemo(()=>toArr(raw),[raw]);

  const[refData,setRefData]=useState(null);
  const[allAppearances,setAllAppearances]=useState([]);
  const[refLoading,setRefLoading]=useState(true);
  useEffect(()=>{
    if(!gasSecret){ setRefLoading(false); return; }
    setRefLoading(true);
    Promise.all([
      fetchReferenceData({gasSecret}),
      fetchAllExamAppearances({gasSecret}),
    ]).then(([rd,ap])=>{
      setRefData(rd);
      setAllAppearances(ap.ok?ap.appearances:[]);
      setRefLoading(false);
    }).catch(()=>setRefLoading(false));
  },[gasSecret,localTick]);

  const appearanceCountOf=useMemo(()=>{
    const m={};
    allAppearances.forEach(a=>{const k=String(a.question_id);m[k]=(m[k]||0)+1;});
    return m;
  },[allAppearances]);

  const subjectOptions=useMemo(()=>refData?(refData.subjects||[]).filter(s=>s.sheet==="QBank"):[],[refData]);
  const allTopics=refData?.topics||[];
  const topicOptionsFor=subjectId=>subjectId?allTopics.filter(t=>String(t.subject_id)===String(subjectId)).map(t=>({id:t.topic_id,name:t.topic_name})):[];

  // ── প্রতিটা রো-এর জন্য কী কী ফাঁকা তার ফ্ল্যাগ — Subject/Topic legacy টেক্সট
  // কলাম থেকে (BrowseTab কার্ডেও এই একই কলাম থেকে দেখায়), Appearance আলাদা
  // Exam_Appearances টেবিল থেকে (question_id দিয়ে জোড়া) ──
  const rowsWithFlags=useMemo(()=>{
    return allQ.map(q=>{
      const qid=String(q.id||q.ID||"");
      const subj=(q.Subject||q.subject||"").trim();
      const topic=(q.Sub_topic||q.sub_topic||q.Topic||q.topic||"").trim();
      const appCount=appearanceCountOf[qid]||0;
      return{q,qid,subj,topic,appCount,
        missingSubject:!subj, missingTopic:!topic, missingAppearance:appCount===0};
    }).filter(r=>r.missingSubject||r.missingTopic||r.missingAppearance);
  },[allQ,appearanceCountOf]);

  const counts=useMemo(()=>({
    all:rowsWithFlags.length,
    subject:rowsWithFlags.filter(r=>r.missingSubject).length,
    topic:rowsWithFlags.filter(r=>r.missingTopic).length,
    appearance:rowsWithFlags.filter(r=>r.missingAppearance).length,
  }),[rowsWithFlags]);

  const[activeFilter,setActiveFilter]=useState("all"); // all|subject|topic|appearance
  const[search,setSearch]=useState("");
  const[page,setPage]=useState(0);

  const filtered=useMemo(()=>{
    let arr=rowsWithFlags;
    if(activeFilter==="subject")arr=arr.filter(r=>r.missingSubject);
    else if(activeFilter==="topic")arr=arr.filter(r=>r.missingTopic);
    else if(activeFilter==="appearance")arr=arr.filter(r=>r.missingAppearance);
    if(search.trim()){
      const s=search.trim().toLowerCase();
      arr=arr.filter(r=>(r.q.Question||r.q.question||"").toLowerCase().includes(s));
    }
    return arr;
  },[rowsWithFlags,activeFilter,search]);

  useEffect(()=>setPage(0),[activeFilter,search]);
  const pageSlice=useMemo(()=>filtered.slice(page*PAGE,(page+1)*PAGE),[filtered,page]);
  const totalPages=Math.ceil(filtered.length/PAGE)||1;

  // ── Subject/Topic ইনলাইন ফিক্স ফর্ম — কার্ডের ভিতরেই খোলে, আলাদা মোডাল না
  // (একটার পর একটা দ্রুত ঠিক করার জন্য, MultiSubjectImportPage-এর গ্রুপ-এডিট
  // ফর্মের ধাঁচেই) ──
  const[editingQid,setEditingQid]=useState(null);
  const[subjSel,setSubjSel]=useState({id:"",name:""});
  const[topicSel,setTopicSel]=useState({id:"",name:""});
  const[saving,setSaving]=useState(false);
  const[appearanceTarget,setAppearanceTarget]=useState(null);
  const[paperTarget,setPaperTarget]=useState(null); // যেই রো-এর প্রশ্নপত্র ফুল-স্ক্রিনে দেখা হচ্ছে

  const openFix=r=>{
    setEditingQid(r.qid);
    setSubjSel({id:"",name:r.subj||""});
    setTopicSel({id:"",name:r.topic||""});
  };

  const saveSubjTopic=async r=>{
    if(!subjSel.name.trim()||!topicSel.name.trim()){push("warn","Subject ও Topic দুটোই দাও","");return;}
    if(!gasSecret){push("error","❌ GAS Secret Key দাও","উপরে বসাও");return;}
    setSaving(true);
    const subjOpts=subjectOptions.map(s=>({id:s.subject_id,name:s.subject_name}));
    const subjRes=await resolveOrCreateReference({sel:subjSel,refType:"subjects",options:subjOpts,gasSecret,sheet:"QBank",push});
    if(!subjRes.ok){push("error","❌ Subject যোগ/খুঁজে পাওয়া যায়নি","");setSaving(false);return;}
    const topicOpts=topicOptionsFor(subjRes.id);
    const topicRes=await resolveOrCreateReference({sel:topicSel,refType:"topics",options:topicOpts,gasSecret,parentId:subjRes.id,push});
    if(!topicRes.ok){push("error","❌ Topic যোগ/খুঁজে পাওয়া যায়নি","");setSaving(false);return;}
    const res=await syncFieldsToSheet({sheet:"QBank",id:r.qid,fields:{
      subject:subjSel.name.trim(), sub_topic:topicSel.name.trim(),
      subject_id:subjRes.id, topic_id:topicRes.id,
    },gasSecret});
    if(res.ok){
      push("success","✅ Subject/Topic ঠিক হয়েছে!",`#${r.qid}`);
      setEditingQid(null);
      invalidate("QBank");
      refresh();
    }else{
      push("error","❌ সেভ ব্যর্থ",`ফিল্ড: ${res.failed.join(", ")||"সব"}`);
    }
    setSaving(false);
  };

  return(
    <div className="page">
      <div style={{fontSize:11,color:C.muted,marginBottom:10,lineHeight:1.5}}>
        QBank-এর যেসব প্রশ্নে Subject/Topic খালি অথবা কোনো Exam Appearance (পদ/প্রতিষ্ঠান/সাল) যোগ করা হয়নি — সেগুলো এখানে দেখাবে। ঠিক করলে সরাসরি Sheet-এ আপডেট হয়ে যায়, আলাদা কিছু সাবমিট করতে হয় না।
      </div>

      {!gasSecret&&(
        <div className="fld" style={{marginBottom:10}}>
          <label>GAS Secret Key</label>
          <input className="inp" type="password" placeholder="Script Properties-এর SECRET_KEY" value={gasSecret} onChange={e=>setGasSecretP(e.target.value)} onBlur={refresh}/>
        </div>
      )}

      {/* ── কাউন্টার চিপস — ক্লিক করলে নিচের লিস্ট ওই ক্যাটেগরিতেই ফিল্টার হয় ── */}
      <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:12}}>
        {[
          {key:"all",label:"সব",count:counts.all,color:C.accent},
          {key:"subject",label:"📚 Subject ফাঁকা",count:counts.subject,color:C.warning},
          {key:"topic",label:"📌 Topic ফাঁকা",count:counts.topic,color:C.warning},
          {key:"appearance",label:"🧾 পদ/প্রতিষ্ঠান/সাল ফাঁকা",count:counts.appearance,color:C.purple},
        ].map(c=>(
          <button key={c.key} onClick={()=>setActiveFilter(c.key)}
            style={{
              padding:"7px 12px",borderRadius:20,fontSize:11,fontWeight:700,cursor:"pointer",
              border:`1.5px solid ${activeFilter===c.key?c.color:C.border}`,
              background:activeFilter===c.key?`${c.color}22`:C.panel,
              color:activeFilter===c.key?c.color:C.muted,
            }}>
            {c.label} ({c.count})
          </button>
        ))}
      </div>

      <div className="sw" style={{marginBottom:8}}>
        <span className="si">🔍</span>
        <input className="inp" placeholder="প্রশ্ন খুঁজো..." value={search} onChange={e=>setSearch(e.target.value)}/>
      </div>

      <div style={{fontSize:11,color:C.muted,marginBottom:8,display:"flex",justifyContent:"space-between"}}>
        <span>{(loading||refLoading)?"⏳":`${filtered.length}টি`}</span>
        {totalPages>1&&<span style={{color:C.accent}}>{page+1}/{totalPages}</span>}
      </div>

      {(loading||refLoading)&&!raw?[...Array(4)].map((_,i)=><div key={i} className="sk"/>):
       filtered.length===0?<div className="empty"><div className="ei">🎉</div><p>{!gasSecret?"GAS Secret Key দাও":"সব ঠিক আছে! মিসিং কিছু নেই"}</p></div>:
       pageSlice.map(r=>{
        const q=r.q;
        const qtext=(q.Question||q.question||"(প্রশ্ন নেই)").toString();
        const isEditingThis=editingQid===r.qid;
        const paperUrls=qPaperUrlsOf(q);
        return(
          <div key={r.qid} className="qcard">
            <div style={{display:"flex",gap:6,marginBottom:5,alignItems:"flex-start"}}>
              <span style={{fontSize:9,color:C.muted,marginTop:1}}>#{r.qid}</span>
              <div style={{flex:1}}/>
              {paperUrls.length>0?(
                <button className="btn" style={{padding:"3px 9px",fontSize:10,background:C.green+"22",color:C.green,border:`1px solid ${C.green}44`}}
                  onClick={()=>setPaperTarget({urls:paperUrls})} title="আসল প্রশ্নপত্রের পাতা বড় করে দেখো">
                  📄{paperUrls.length>1?` ${paperUrls.length}`:""}
                </button>
              ):(
                r.missingAppearance&&<span style={{fontSize:9,color:C.muted,alignSelf:"center"}} title="এই প্রশ্নের সাথে কোনো পাতার ছবি সেভ নেই">📄❌</span>
              )}
              <button className="btn" style={{padding:"3px 9px",fontSize:10,background:"#818cf822",color:"#818cf8",border:"1px solid #818cf844"}}
                onClick={()=>setAppearanceTarget(q)} title="Exam Appearance দেখো/যোগ করো">
                🧾{r.appCount>0&&<span style={{marginLeft:3,fontWeight:700}}>{r.appCount}</span>}
              </button>
            </div>
            <div className="qcard-q">{qtext.slice(0,90)}{qtext.length>90?"…":""}</div>
            <div className="qcard-meta">
              <span className="qtag qtag-sub" style={r.missingSubject?{background:C.warning+"22",color:C.warning,border:`1px solid ${C.warning}44`}:{}}>
                📚 {r.subj||"❌ Subject খালি"}
              </span>
              <span className="qtag qtag-tp" style={r.missingTopic?{background:C.warning+"22",color:C.warning,border:`1px solid ${C.warning}44`}:{}}>
                📌 {r.topic||"❌ Topic খালি"}
              </span>
              {r.missingAppearance&&(
                <span style={{fontSize:9,padding:"2px 7px",borderRadius:10,background:C.purple+"18",color:C.purple,border:`1px solid ${C.purple}33`,fontWeight:700}}>
                  ❌ পদ/প্রতিষ্ঠান/সাল নেই
                </span>
              )}
            </div>

            {(r.missingSubject||r.missingTopic)&&(
              isEditingThis?(
                <div style={{marginTop:8,padding:"10px 11px",background:"#0a1628",border:`1px solid ${C.border}`,borderRadius:10}}>
                  <div className="fld" style={{marginBottom:8}}>
                    <label>📚 Subject</label>
                    <TypeaheadCombo options={subjectOptions.map(s=>({id:s.subject_id,name:s.subject_name}))}
                      value={subjSel} onChange={setSubjSel} placeholder="Subject লিখো..."
                      newLabel={`🆕 "${subjSel.name.trim()}" নতুন Subject হিসেবে যোগ হবে`}/>
                  </div>
                  <div className="fld" style={{marginBottom:10}}>
                    <label>📌 Topic</label>
                    <TypeaheadCombo options={topicOptionsFor(subjSel.id)}
                      value={topicSel} onChange={setTopicSel} placeholder="Topic লিখো..."
                      newLabel={`🆕 "${topicSel.name.trim()}" নতুন Topic হিসেবে যোগ হবে`}/>
                  </div>
                  <div style={{display:"flex",gap:7}}>
                    <button className="btn bg" style={{flex:1,justifyContent:"center"}} onClick={()=>setEditingQid(null)} disabled={saving}>বাতিল</button>
                    <button className="btn bp" style={{flex:2,justifyContent:"center"}} onClick={()=>saveSubjTopic(r)} disabled={saving}>
                      {saving?"⏳ সেভ হচ্ছে...":"💾 সেভ করো"}
                    </button>
                  </div>
                </div>
              ):(
                <button onClick={()=>openFix(r)}
                  style={{width:"100%",marginTop:7,padding:"6px 0",fontSize:10,fontWeight:700,color:C.warning,
                    background:C.warning+"12",border:`1px solid ${C.warning}33`,borderRadius:8,cursor:"pointer"}}>
                  ✏️ Subject/Topic ঠিক করো
                </button>
              )
            )}
          </div>
        );
       })
      }

      {totalPages>1&&(
        <div style={{display:"flex",justifyContent:"center",gap:8,marginTop:12}}>
          <button className="btn bg" disabled={page===0} onClick={()=>setPage(p=>p-1)}>◀</button>
          <span style={{fontSize:11,color:C.muted,alignSelf:"center"}}>{page+1}/{totalPages}</span>
          <button className="btn bg" disabled={page>=totalPages-1} onClick={()=>setPage(p=>p+1)}>▶</button>
        </div>
      )}

      {paperTarget&&(
        <PaperPreviewModal urls={paperTarget.urls} initialIndex={0} onClose={()=>setPaperTarget(null)}/>
      )}

      {appearanceTarget&&(
        <AppearanceQuickModal
          question={appearanceTarget}
          questionText={appearanceTarget.Question||appearanceTarget.question||""}
          refData={refData}
          gasSecret={gasSecret}
          onRefreshRef={()=>{ fetchReferenceData({gasSecret}).then(setRefData).catch(()=>{}); }}
          onClose={()=>{ setAppearanceTarget(null); fetchAllExamAppearances({gasSecret}).then(a=>setAllAppearances(a.ok?a.appearances:[])).catch(()=>{}); }}
          push={push}
        />
      )}
    </div>
  );
}

export { ReviewTab };
