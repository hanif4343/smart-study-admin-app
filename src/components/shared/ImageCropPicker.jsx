/* ══════════ IMAGE CROP PICKER ══════════ */
import React from "react";
import { C } from "../../core/config.js";
import { uploadImg } from "../../core/utils.js";

function ImageCropPicker({onCropToQuestion,onCropToSolution,onClose,push}){
  const canvasRef=React.useRef(null);
  const imgRef=React.useRef(null);
  const[srcImg,setSrcImg]=React.useState(null); // dataURL of loaded image
  const[natural,setNatural]=React.useState({w:1,h:1});
  const[sel,setSel]=React.useState(null);       // {x,y,w,h} in canvas coords
  const[dragging,setDragging]=React.useState(false);
  const[startPt,setStartPt]=React.useState(null);
  const[crops,setCrops]=React.useState([]);     // list of {dataUrl, target:'q'|'s'}
  const[uploading,setUploading]=React.useState(false);

  /* load image from file input */
  const handleFile=e=>{
    const f=e.target.files[0];if(!f)return;
    const reader=new FileReader();
    reader.onload=ev=>setSrcImg(ev.target.result);
    reader.readAsDataURL(f);
  };

  /* once srcImg set, draw on canvas */
  React.useEffect(()=>{
    if(!srcImg||!canvasRef.current)return;
    const canvas=canvasRef.current;
    const img=new Image();
    img.onload=()=>{
      const maxW=canvas.parentElement.offsetWidth||340;
      const scale=maxW/img.naturalWidth;
      canvas.width=maxW;
      canvas.height=img.naturalHeight*scale;
      setNatural({w:img.naturalWidth,h:img.naturalHeight,scale});
      imgRef.current=img;
      redraw(canvas,img,null);
    };
    img.src=srcImg;
  },[srcImg]);

  const redraw=(canvas,img,s)=>{
    const ctx=canvas.getContext("2d");
    ctx.clearRect(0,0,canvas.width,canvas.height);
    ctx.drawImage(img,0,0,canvas.width,canvas.height);
    if(s&&s.w&&s.h){
      ctx.fillStyle="rgba(59,130,246,0.18)";
      ctx.fillRect(s.x,s.y,s.w,s.h);
      ctx.strokeStyle="#3b82f6";ctx.lineWidth=2;ctx.setLineDash([5,3]);
      ctx.strokeRect(s.x,s.y,s.w,s.h);
    }
  };

  const getPos=(e,canvas)=>{
    const rect=canvas.getBoundingClientRect();
    const clientX=e.touches?e.touches[0].clientX:e.clientX;
    const clientY=e.touches?e.touches[0].clientY:e.clientY;
    return{x:clientX-rect.left,y:clientY-rect.top};
  };

  const onDown=e=>{
    e.preventDefault();
    if(!imgRef.current)return;
    const p=getPos(e,canvasRef.current);
    setStartPt(p);setSel(null);setDragging(true);
  };
  const onMove=e=>{
    e.preventDefault();
    if(!dragging||!startPt)return;
    const p=getPos(e,canvasRef.current);
    const s={x:Math.min(startPt.x,p.x),y:Math.min(startPt.y,p.y),w:Math.abs(p.x-startPt.x),h:Math.abs(p.y-startPt.y)};
    setSel(s);
    redraw(canvasRef.current,imgRef.current,s);
  };
  const onUp=e=>{e.preventDefault();setDragging(false);};

  /* crop selected region to dataURL */
  const doCrop=()=>{
    if(!sel||sel.w<5||sel.h<5){push("warn","একটু বড় করে select করুন","");return null;}
    const sc=natural.scale;
    const offscreen=document.createElement("canvas");
    offscreen.width=sel.w/sc; offscreen.height=sel.h/sc;
    const ctx=offscreen.getContext("2d");
    ctx.drawImage(imgRef.current,sel.x/sc,sel.y/sc,sel.w/sc,sel.h/sc,0,0,sel.w/sc,sel.h/sc);
    return offscreen.toDataURL("image/jpeg",0.92);
  };

  /* dataURL → File */
  const dataUrlToFile=dataUrl=>{
    const arr=dataUrl.split(","),mime=arr[0].match(/:(.*?);/)[1];
    const bstr=atob(arr[1]);let n=bstr.length;const u=new Uint8Array(n);
    while(n--)u[n]=bstr.charCodeAt(n);
    return new File([u],`crop_${Date.now()}.jpg`,{type:mime});
  };

  const addCrop=async target=>{
    const dataUrl=doCrop();if(!dataUrl)return;
    setUploading(true);
    try{
      const file=dataUrlToFile(dataUrl);
      const url=await uploadImg(file);
      if(target==="q")onCropToQuestion(url);
      else onCropToSolution(url);
      setCrops(prev=>[...prev,{dataUrl,target}]);
      push("success",target==="q"?"প্রশ্নে যোগ হয়েছে":"সমাধানে যোগ হয়েছে","");
    }catch{push("error","আপলোড ব্যর্থ","");}
    setUploading(false);
  };

  return(
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.92)",zIndex:9000,display:"flex",flexDirection:"column",maxWidth:480,margin:"0 auto"}}>
      {/* topbar */}
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"12px 14px",background:C.card,borderBottom:`1px solid ${C.border}`}}>
        <span style={{fontSize:14,fontWeight:700,color:C.text}}>✂️ ছবি Crop করুন</span>
        <button onClick={onClose} style={{background:"transparent",border:"none",color:C.muted,fontSize:20,cursor:"pointer",padding:"0 4px"}}>✕</button>
      </div>

      {/* if no image yet — show file picker */}
      {!srcImg&&(
        <div style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:16,padding:24}}>
          <div style={{fontSize:48}}>🖼️</div>
          <div style={{color:C.muted,fontSize:13,textAlign:"center"}}>বইয়ের পাতার ছবি তুলুন বা গ্যালারি থেকে বেছে নিন</div>
          <label style={{background:C.accent,color:"#fff",borderRadius:10,padding:"11px 28px",fontSize:14,fontWeight:700,cursor:"pointer"}}>
            📷 ছবি বেছে নিন
            <input type="file" accept="image/*" style={{display:"none"}} onChange={handleFile} capture="environment"/>
          </label>
          <label style={{background:C.panel,border:`1px solid ${C.border}`,color:C.text,borderRadius:10,padding:"9px 24px",fontSize:13,cursor:"pointer"}}>
            🖼 গ্যালারি
            <input type="file" accept="image/*" style={{display:"none"}} onChange={handleFile}/>
          </label>
        </div>
      )}

      {/* canvas area */}
      {srcImg&&(
        <div style={{flex:1,overflow:"auto",padding:"8px 0"}}>
          <div style={{padding:"6px 14px 4px",color:C.muted,fontSize:11}}>আঙুল দিয়ে drag করে অংক select করুন</div>
          <canvas
            ref={canvasRef}
            style={{display:"block",width:"100%",touchAction:"none",cursor:"crosshair"}}
            onMouseDown={onDown} onMouseMove={onMove} onMouseUp={onUp}
            onTouchStart={onDown} onTouchMove={onMove} onTouchEnd={onUp}
          />
        </div>
      )}

      {/* crops preview */}
      {crops.length>0&&(
        <div style={{padding:"6px 14px",display:"flex",gap:6,overflowX:"auto"}}>
          {crops.map((c,i)=>(
            <div key={i} style={{position:"relative",flexShrink:0}}>
              <img src={c.dataUrl} style={{height:48,borderRadius:6,border:`1.5px solid ${c.target==="q"?C.accent:C.green}`}} alt=""/>
              <div style={{position:"absolute",bottom:1,left:2,fontSize:8,fontWeight:700,color:"#fff",textShadow:"0 0 3px #000"}}>{c.target==="q"?"Q":"S"}</div>
            </div>
          ))}
        </div>
      )}

      {/* action buttons */}
      {srcImg&&(
        <div style={{padding:"10px 14px 20px",display:"flex",gap:8,borderTop:`1px solid ${C.border}`,background:C.card}}>
          <button onClick={()=>addCrop("q")} disabled={uploading||!sel} style={{flex:1,background:C.accent,color:"#fff",border:"none",borderRadius:10,padding:"12px 6px",fontSize:13,fontWeight:700,cursor:"pointer",opacity:(!sel||uploading)?0.5:1}}>
            {uploading?"⏳...":"➕ প্রশ্নে"}
          </button>
          <button onClick={()=>addCrop("s")} disabled={uploading||!sel} style={{flex:1,background:C.green,color:"#fff",border:"none",borderRadius:10,padding:"12px 6px",fontSize:13,fontWeight:700,cursor:"pointer",opacity:(!sel||uploading)?0.5:1}}>
            {uploading?"⏳...":"✅ সমাধানে"}
          </button>
          <label style={{flexShrink:0,background:C.panel,border:`1px solid ${C.border}`,color:C.text,borderRadius:10,padding:"12px 10px",fontSize:13,cursor:"pointer",display:"flex",alignItems:"center"}}>
            🔄
            <input type="file" accept="image/*" style={{display:"none"}} onChange={handleFile}/>
          </label>
          <button onClick={onClose} style={{flexShrink:0,background:"transparent",border:`1px solid ${C.border}`,color:C.muted,borderRadius:10,padding:"12px 10px",fontSize:13,cursor:"pointer"}}>✓ শেষ</button>
        </div>
      )}
    </div>
  );
}

export { ImageCropPicker };
