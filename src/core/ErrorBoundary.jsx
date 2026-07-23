/* ══════════ ERROR BOUNDARY ══════════ */
import React from "react";
import { _LC } from "./logger.js";

class ErrorBoundary extends React.Component {
  constructor(p){super(p);this.state={err:null};}
  static getDerivedStateFromError(e){return{err:e};}
  componentDidCatch(e,info){console.error("App error:",e,info);_LC.crash("ErrorBoundary",`${e?.name||"Error"}: ${e?.message||"unknown"}`,{stack:(e?.stack||"").slice(0,400),componentStack:(info?.componentStack||"").slice(0,300)});}
  render(){
    if(this.state.err)return(
      <div style={{padding:32,color:"#ef4444",fontFamily:"monospace",background:"#06080f",minHeight:"100dvh"}}>
        <div style={{fontSize:28,marginBottom:12}}>⚠️ Error</div>
        <div style={{fontSize:12,marginBottom:8,color:"#e2e8f0"}}>{this.state.err?.message||"Unknown error"}</div>
        <button onClick={()=>this.setState({err:null})} style={{marginTop:16,padding:"8px 20px",background:"#3b82f6",color:"#fff",border:"none",borderRadius:8,cursor:"pointer"}}>রিলোড করুন</button>
      </div>
    );
    return this.props.children;
  }
}


export { ErrorBoundary };
