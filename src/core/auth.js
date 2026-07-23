/* ══════════ FIREBASE AUTH (email/password via REST) ══════════ */
import { FB_KEY } from "./config.js";
import { _LC } from "./logger.js";

let _idToken = null;
let _tokenExp = 0;

async function signInWithEmail(email, password) {
  _LC.auth("signIn", `Login attempt: ${email}`);
  let r, d;
  try {
    r = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${FB_KEY}`,
      {method:"POST",headers:{"Content-Type":"application/json"},
       body:JSON.stringify({email,password,returnSecureToken:true})}
    );
    d = await r.json();
  } catch(netErr) {
    _LC.error("signIn", `Network error during login: ${netErr.message}`, { email });
    throw netErr;
  }
  if(!r.ok) {
    const errMsg = d?.error?.message||"Login failed";
    _LC.error("signIn", `Login FAILED for ${email}: ${errMsg}`, { httpStatus: r.status, firebaseError: d?.error });
    throw new Error(errMsg);
  }
  _idToken = d.idToken;
  _tokenExp = Date.now() + (parseInt(d.expiresIn||3600)-60)*1000;
  window.__adminIdToken = _idToken; // expose for _LC flush
  _LC.auth("signIn", `Login SUCCESS: ${email}`, { uid: d.localId, expiresIn: d.expiresIn });
  // store refresh token so we can get new idToken without password
  localStorage.setItem("fb_refresh_token", d.refreshToken||"");
  localStorage.setItem("fb_email", email);
  try{ localStorage.setItem("fb_pass_enc", btoa(unescape(encodeURIComponent(password)))); }catch(_){}
  return d;
}

async function refreshTokenWithRefreshToken(refreshToken) {
  try {
    const r = await fetch(
      `https://securetoken.googleapis.com/v1/token?key=${FB_KEY}`,
      {method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},
       body:`grant_type=refresh_token&refresh_token=${encodeURIComponent(refreshToken)}`}
    );
    const d = await r.json();
    if(!r.ok || !d.id_token){
      _LC.warn("tokenRefresh", `Refresh token failed: HTTP ${r.status}`, { error: d?.error });
      return null;
    }
    _idToken = d.id_token;
    window.__adminIdToken = _idToken;
    _tokenExp = Date.now() + (parseInt(d.expires_in||3600)-60)*1000;
    localStorage.setItem("fb_refresh_token", d.refresh_token||refreshToken);
    _LC.auth("tokenRefresh", "Token refreshed successfully via refresh_token");
    return _idToken;
  } catch(e){
    _LC.error("tokenRefresh", `Token refresh network error: ${e.message}`);
    return null;
  }
}

async function refreshTokenIfNeeded() {
  if(_idToken && Date.now() < _tokenExp) return _idToken;
  
  // Try refresh token first (no password needed)
  const refreshToken = localStorage.getItem("fb_refresh_token");
  if(refreshToken){
    const t = await refreshTokenWithRefreshToken(refreshToken);
    if(t) return t;
  }
  
  // Fallback: re-login with saved credentials
  const email = localStorage.getItem("fb_email");
  const passEnc = localStorage.getItem("fb_pass_enc");
  if(email && passEnc){
    try{
      _LC.auth("tokenRefresh", `Falling back to re-login for: ${email}`);
      const pass = decodeURIComponent(escape(atob(passEnc)));
      await signInWithEmail(email, pass);
      return _idToken;
    }catch(e){
      _LC.error("tokenRefresh", `Fallback re-login FAILED: ${e.message}`);
      _idToken=null; return null;
    }
  }
  _LC.warn("tokenRefresh", "No credentials available — user must login manually");
  return null;
}

function _authQ(token){ return token ? `?auth=${token}` : ""; }

// App.jsx-এর logout handler সরাসরি `_idToken=null` করত — imported binding reassign করা যায় না,
// তাই helper যোগ করা হলো:
function clearIdToken(){ _idToken = null; try{ window.__adminIdToken = null; }catch(_){} }

export { signInWithEmail, refreshTokenWithRefreshToken, refreshTokenIfNeeded, _authQ, clearIdToken };
