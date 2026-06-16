import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';

class RootErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { err: null }; }
  static getDerivedStateFromError(e) { return { err: e }; }
  componentDidCatch(e, info) { console.error("ROOT CRASH:", e, info); }
  render() {
    if (this.state.err) {
      return (
        <div style={{background:"#06080f",color:"#ef4444",minHeight:"100vh",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:24,fontFamily:"monospace",textAlign:"center"}}>
          <div style={{fontSize:32,marginBottom:12}}>💥</div>
          <div style={{fontSize:16,fontWeight:700,marginBottom:8}}>App Crash</div>
          <div style={{fontSize:11,color:"#f59e0b",marginBottom:16,maxWidth:320,wordBreak:"break-all"}}>
            {this.state.err?.message || String(this.state.err)}
          </div>
          <button onClick={()=>window.location.reload()} style={{background:"#3b82f6",color:"#fff",border:"none",borderRadius:8,padding:"8px 20px",fontSize:13,cursor:"pointer"}}>
            🔄 Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <RootErrorBoundary>
    <App />
  </RootErrorBoundary>
);
