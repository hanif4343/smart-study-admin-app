/* ══════════ REFERENCE MANAGER TAB (Subjects/Topics/Tags/Posts/Institutions) ══════════
   Phase 5 — নতুন schema-র রেফারেন্স-টেবিলের জন্য একটাই reusable CRUD UI (আলাদা
   পেজ না বানিয়ে)। List/Add/Rename/Delete — সবকিছু GAS-এর getReferenceData/addReferenceItem/
   renameReferenceItem/deleteReferenceItem action দিয়ে, প্রতিটাই Quiz/QBank/Study-এর
   প্রশ্নের রো টাচ না করে শুধু ছোট রেফারেন্স-টেবিলে কাজ করে।
   ⚠️ SubTopics তুলে দেওয়া হয়েছে — QBank এখন Quiz/Study-এর মতোই ২-লেভেল (Subject→Topic)। */
import React, { useState, useEffect, useMemo, useCallback } from "react";
import { C } from "../../core/config.js";
import { loadSharedGasSecret, saveSharedGasSecret } from "../../core/utils.js";
import { fetchReferenceData, renameReferenceItem, addReferenceItem, deleteReferenceItem } from "../../core/sheetSave.js";
import { RenameModal } from "./RenameModal.jsx";
import { useModalBack } from "../../hooks/useModalBack.js";

const REF_TYPES = [
  {key:"subjects", label:"📚 Subjects", needsSheet:true, needsParent:false},
  {key:"topics", label:"📂 Topics", needsSheet:false, needsParent:"subjects"},
  {key:"tags", label:"🎯 Tags", needsSheet:false, needsParent:false},
  {key:"posts", label:"🧑‍💼 Posts (পদ)", needsSheet:false, needsParent:false},
  {key:"institutions", label:"🏢 Institutions (প্রতিষ্ঠান)", needsSheet:false, needsParent:false},
];

const NAME_KEY = {subjects:"subject_name", topics:"topic_name", tags:"tag_name", posts:"post_name", institutions:"institution_name"};
const ID_KEY   = {subjects:"subject_id", topics:"topic_id", tags:"tag_id", posts:"post_id", institutions:"institution_id"};

/* ── ছোট ডিলিট-নিশ্চিতকরণ মডাল — কতগুলো প্রশ্ন এই এন্ট্রি ব্যবহার করছে সেটা
   দেখিয়ে সতর্ক করে (delete করলে প্রশ্ন মোছে না, কিন্তু orphan reference থেকে যাবে)। ── */
function DeleteConfirmModal({name,count,onCancel,onConfirm,deleting}){
  useModalBack(onCancel);
  return(
    <div className="ovl">
      <div className="modal">
        <div className="mh"/>
        <div style={{fontSize:13,fontWeight:700,marginBottom:8}}>🗑️ ডিলিট নিশ্চিত করো</div>
        <div style={{background:`${C.yellow}12`,border:`1px solid ${C.yellow}30`,borderRadius:9,padding:"9px 12px",marginBottom:12,fontSize:11,color:C.muted}}>
          <b style={{color:C.text}}>"{name}"</b> ডিলিট করলে {count!=null?<>এটা ব্যবহার করা <b style={{color:C.text}}>{count}টি</b> প্রশ্নের</>:"এই এন্ট্রি ব্যবহার করা প্রশ্নগুলোর"} subject_id/topic_id ফাঁকা (orphan) হয়ে যাবে — প্রশ্ন নিজে ডিলিট হবে না, কিন্তু সেগুলো এই ক্যাটাগরিতে আর সঠিকভাবে দেখা যাবে না।
        </div>
        <div style={{display:"flex",gap:7}}>
          <button className="btn bg" style={{flex:1,justifyContent:"center"}} onClick={onCancel} disabled={deleting}>বাতিল</button>
          <button className="btn" style={{flex:2,justifyContent:"center",background:C.red||"#e5484d",color:"#fff"}} onClick={onConfirm} disabled={deleting}>{deleting?"⏳ ডিলিট হচ্ছে...":"🗑️ ডিলিট করো"}</button>
        </div>
      </div>
    </div>
  );
}

function ReferenceManagerTab({push}){
  const[refKey,setRefKey]=useState("subjects");
  const[sheet,setSheet]=useState("Quiz"); // subjects-এর জন্য
  const[parentId,setParentId]=useState(""); // topics-এর জন্য (subjects প্যারেন্ট)

  const[gasSecret,setGasSecret]=useState(loadSharedGasSecret);
  const setGasSecretP=v=>{ setGasSecret(v); saveSharedGasSecret(v); };

  const[refData,setRefData]=useState(null);
  const[loading,setLoading]=useState(false);
  const[tick,setTick]=useState(0);
  const refresh=useCallback(()=>setTick(t=>t+1),[]);

  useEffect(()=>{
    if(!gasSecret){ setRefData(null); return; }
    let cancelled=false;
    setLoading(true);
    fetchReferenceData({gasSecret}).then(d=>{ if(!cancelled){ setRefData(d); setLoading(false); } });
    return()=>{ cancelled=true; };
  },[gasSecret,tick]);

  const cfg=REF_TYPES.find(r=>r.key===refKey);

  // ── Parent dropdown-এর অপশন (topics-এর জন্য subjects) ──
  const parentOptions=useMemo(()=>{
    if(!refData) return [];
    if(refKey==="topics") return (refData.subjects||[]).filter(s=>s.sheet===sheet);
    return [];
  },[refData,refKey,sheet]);

  // refKey/sheet বদলালে parentId রিসেট
  useEffect(()=>{ setParentId(""); },[refKey,sheet]);

  const list=useMemo(()=>{
    if(!refData) return [];
    const rows=refData[refKey]||[];
    if(refKey==="subjects") return rows.filter(r=>r.sheet===sheet);
    if(refKey==="topics") return parentId ? rows.filter(r=>r.subject_id===parentId) : [];
    return rows;
  },[refData,refKey,sheet,parentId]);

  const countFor=useCallback((row)=>{
    if(refKey==="topics"||refKey==="subjects"){
      if(refKey==="topics") return parseInt(row.row_count)||0;
      return (refData?.topics||[]).filter(t=>t.subject_id===row.subject_id).reduce((s,t)=>s+(parseInt(t.row_count)||0),0);
    }
    return null; // tags/posts/institutions-এর জন্য live count নেই
  },[refData,refKey]);

  const[addName,setAddName]=useState("");
  const[adding,setAdding]=useState(false);
  const doAdd=async()=>{
    if(!addName.trim()){push("warn","নাম লিখুন","");return;}
    if(cfg.needsParent && !parentId){push("warn","আগে Subject/Topic সিলেক্ট করো","");return;}
    setAdding(true);
    const res=await addReferenceItem({refType:refKey,name:addName.trim(),parentId:cfg.needsParent?parentId:undefined,sheet:cfg.needsSheet?sheet:undefined,gasSecret,push});
    if(res.ok){ push("success","✅ যোগ হয়েছে!",`"${addName.trim()}" · id: ${res.id}`); setAddName(""); refresh(); }
    setAdding(false);
  };

  const[renameTarget,setRenameTarget]=useState(null);
  const[newName,setNewName]=useState("");
  const[renaming,setRenaming]=useState(false);
  const doRename=async()=>{
    if(!newName.trim()||!renameTarget)return;
    setRenaming(true);
    const res=await renameReferenceItem({refType:refKey,id:renameTarget.id,newName:newName.trim(),gasSecret,push});
    if(res.ok){ push("success","✅ Rename সম্পন্ন!",""); setRenameTarget(null); setNewName(""); refresh(); }
    setRenaming(false);
  };

  const[deleteTarget,setDeleteTarget]=useState(null);
  const[deleting,setDeleting]=useState(false);
  const doDelete=async()=>{
    if(!deleteTarget)return;
    setDeleting(true);
    const res=await deleteReferenceItem({refType:refKey,id:deleteTarget.id,gasSecret,push});
    if(res.ok){ push("success","✅ ডিলিট হয়েছে",""); setDeleteTarget(null); refresh(); }
    setDeleting(false);
  };

  return(
    <>
      <div className="fld" style={{marginBottom:10}}>
        <label style={{display:"flex",justifyContent:"space-between"}}>
          <span>GAS Secret Key</span>
          <span onClick={refresh} style={{color:C.accent,cursor:"pointer",fontWeight:600}}>🔄 রিফ্রেশ</span>
        </label>
        <input className="inp" type="password" placeholder="Script Properties-এর SECRET_KEY" value={gasSecret} onChange={e=>setGasSecretP(e.target.value)}/>
      </div>

      <div className="atabs" style={{marginBottom:10,flexWrap:"wrap"}}>
        {REF_TYPES.map(r=>(
          <button key={r.key} className={`atab${refKey===r.key?" on":""}`} onClick={()=>setRefKey(r.key)}>{r.label}</button>
        ))}
      </div>

      {cfg.needsSheet && (
        <div style={{display:"flex",gap:6,marginBottom:10}}>
          {["Quiz","QBank","Study"].map(s=>(
            <button key={s} className={`ftab${sheet===s?" on":""}`} onClick={()=>setSheet(s)}>{s}</button>
          ))}
        </div>
      )}

      {cfg.needsParent && (
        <div className="fld" style={{marginBottom:10}}>
          <label>Subject সিলেক্ট করো</label>
          <select className="inp" value={parentId} onChange={e=>setParentId(e.target.value)}>
            <option value="">— বাছাই করো —</option>
            {parentOptions.map(p=>(
              <option key={p.subject_id} value={p.subject_id}>
                {p.subject_name}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* ➕ নতুন যোগ করো */}
      <div style={{display:"flex",gap:6,marginBottom:14}}>
        <input className="inp" style={{flex:1}} placeholder={`নতুন ${cfg.label.replace(/^\S+\s/,"")} নাম`} value={addName} onChange={e=>setAddName(e.target.value)}/>
        <button className="btn bp" onClick={doAdd} disabled={adding||(cfg.needsParent&&!parentId)}>{adding?"⏳":"➕ যোগ করো"}</button>
      </div>

      <div style={{fontSize:11,color:C.muted,marginBottom:10}}>
        {!gasSecret?"⚠️ GAS Secret Key বসাও":loading?"⏳":cfg.needsParent&&!parentId?"⬆️ আগে উপরে থেকে সিলেক্ট করো":`${list.length}টি`}
      </div>

      {list.map(row=>{
        const id=row[ID_KEY[refKey]];
        const name=row[NAME_KEY[refKey]];
        const cnt=countFor(row);
        return(
          <div key={id} className="rename-row">
            <div className="rename-name" style={{flex:1}}>{name}<div style={{fontSize:9,color:C.muted}}>{id}</div></div>
            <div className="rename-count">{cnt!=null?`${cnt}টি`:""}</div>
            <button className="btn" style={{padding:"4px 8px",fontSize:10,background:C.accent+"20",color:C.accent,border:`1px solid ${C.accent}30`,marginRight:4}}
              onClick={()=>{setRenameTarget({id,name});setNewName(name);}}>✏️</button>
            <button className="btn" style={{padding:"4px 8px",fontSize:10,background:(C.red||"#e5484d")+"20",color:C.red||"#e5484d",border:`1px solid ${C.red||"#e5484d"}30`}}
              onClick={()=>setDeleteTarget({id,name,count:cnt})}>🗑️</button>
          </div>
        );
      })}

      {renameTarget&&(
        <RenameModal
          type={cfg.label}
          target={{name:renameTarget.name,count:0}}
          newName={newName}
          setNewName={setNewName}
          onCancel={()=>{setRenameTarget(null);setNewName("");}}
          onRename={doRename}
          renaming={renaming}
        />
      )}
      {deleteTarget&&(
        <DeleteConfirmModal
          name={deleteTarget.name}
          count={deleteTarget.count}
          onCancel={()=>setDeleteTarget(null)}
          onConfirm={doDelete}
          deleting={deleting}
        />
      )}
    </>
  );
}

export { ReferenceManagerTab };
