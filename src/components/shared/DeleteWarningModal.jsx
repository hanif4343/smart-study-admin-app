/* ══════════ DELETE WARNING MODAL ══════════ */
import React from "react";
import { C } from "../../core/config.js";
import { useModalBack } from "../../hooks/useModalBack.js";

function DeleteWarningModal({title,description,onConfirm,onCancel,loading,progress}){
  useModalBack(onCancel);
  const pct = progress&&progress.total>0 ? Math.round(progress.done/progress.total*100) : 0;
  const showProgress = loading && progress && progress.total > 0;
  return(
    <div className="ovl" style={{zIndex:300}}>
      <div className="modal" style={{borderTop:`3px solid ${C.red}`}}>
        <div className="mh"/>
        <div style={{textAlign:"center",marginBottom:16}}>
          <div style={{fontSize:40,marginBottom:8}}>🗑️</div>
          <div style={{fontSize:16,fontWeight:700,color:C.red,marginBottom:6}}>{title}</div>
          <div style={{fontSize:12,color:C.muted,lineHeight:1.6}}>{description}</div>
        </div>
        {showProgress?(
          <div style={{marginBottom:14}}>
            <div style={{display:"flex",justifyContent:"space-between",fontSize:11,marginBottom:5,color:C.text}}>
              <span>⚡ ডিলিট হচ্ছে…</span>
              <span style={{fontWeight:700,color:C.red}}>{progress.done}/{progress.total} ({pct}%)</span>
            </div>
            <div style={{height:6,background:C.border,borderRadius:6,overflow:"hidden"}}>
              <div style={{height:"100%",width:pct+"%",background:C.red,borderRadius:6,transition:"width .3s ease"}}/>
            </div>
          </div>
        ):(
          <div style={{background:"#ef444412",border:"1px solid #ef444430",borderRadius:10,padding:"10px 12px",marginBottom:14,fontSize:11,color:C.red,textAlign:"center",fontWeight:600}}>
            ⚠️ এই কাজ পূর্বাবস্থায় ফেরানো যাবে না!
          </div>
        )}
        <div style={{display:"flex",gap:8}}>
          <button className="btn bg" style={{flex:1,justifyContent:"center"}} onClick={onCancel} disabled={loading}>বাতিল</button>
          <button className="btn" style={{flex:2,justifyContent:"center",background:C.red,color:"#fff"}} onClick={onConfirm} disabled={loading}>
            {loading?`⏳ ${showProgress?pct+"%":"ডিলিট হচ্ছে..."}` :"🗑️ হ্যাঁ, ডিলিট করুন"}
          </button>
        </div>
      </div>
    </div>
  );
}

export { DeleteWarningModal };
