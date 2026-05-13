import { useState, useEffect, useCallback } from "react";

const GAS_URL = "https://script.google.com/macros/s/AKfycbyjF7iFX0H_rFuJgMJYo70DC7KRX1lBXU7m7NoZCwf6VTJfRm6Iyw6hOcN2q_UKbxxgQg/exec";

const C = {
  bg: "#06080f",
  card: "#0c1220",
  border: "#16253d",
  accent: "#3b82f6",
  accentGlow: "#3b82f620",
  green: "#22c55e",
  red: "#ef4444",
  yellow: "#f59e0b",
  text: "#e2e8f0",
  muted: "#4b5e7a",
  panel: "#0e1a2e",
  navBg: "#080f1c",
};

const css = `
  @import url('https://fonts.googleapis.com/css2?family=Noto+Sans+Bengali:wght@400;500;600;700&family=Space+Grotesk:wght@400;500;600;700&display=swap');

  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  html, body, #root {
    background: ${C.bg};
    color: ${C.text};
    font-family: 'Noto Sans Bengali', 'Space Grotesk', sans-serif;
    min-height: 100dvh;
    max-width: 480px;
    margin: 0 auto;
    overflow-x: hidden;
  }

  ::-webkit-scrollbar { width: 3px; }
  ::-webkit-scrollbar-thumb { background: ${C.border}; border-radius: 10px; }

  /* ── Bottom Nav ── */
  .bottom-nav {
    position: fixed;
    bottom: 0; left: 50%; transform: translateX(-50%);
    width: 100%; max-width: 480px;
    background: ${C.navBg};
    border-top: 1px solid ${C.border};
    display: flex;
    z-index: 100;
    padding-bottom: env(safe-area-inset-bottom, 8px);
  }

  .nav-btn {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 3px;
    padding: 10px 4px 8px;
    cursor: pointer;
    border: none;
    background: transparent;
    color: ${C.muted};
    font-family: inherit;
    font-size: 10px;
    font-weight: 500;
    transition: color 0.15s;
    position: relative;
  }

  .nav-btn.active { color: ${C.accent}; }

  .nav-btn .nav-icon { font-size: 20px; line-height: 1; }

  .nav-badge {
    position: absolute;
    top: 6px; right: calc(50% - 18px);
    background: ${C.red};
    color: white;
    font-size: 9px;
    font-weight: 700;
    width: 16px; height: 16px;
    border-radius: 50%;
    display: flex; align-items: center; justify-content: center;
    animation: pulse 2s infinite;
  }

  @keyframes pulse {
    0%, 100% { transform: scale(1); }
    50% { transform: scale(1.15); }
  }

  /* ── Topbar ── */
  .topbar {
    background: ${C.card};
    border-bottom: 1px solid ${C.border};
    padding: 14px 16px 12px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    position: sticky; top: 0; z-index: 50;
  }

  .topbar-title {
    font-size: 17px;
    font-weight: 700;
    color: ${C.text};
  }

  .topbar-sub {
    font-size: 11px;
    color: ${C.muted};
    margin-top: 1px;
  }

  .icon-btn {
    width: 38px; height: 38px;
    border-radius: 10px;
    background: ${C.panel};
    border: 1px solid ${C.border};
    color: ${C.text};
    font-size: 18px;
    display: flex; align-items: center; justify-content: center;
    cursor: pointer;
    transition: all 0.15s;
  }

  .icon-btn:active { transform: scale(0.94); }
  .icon-btn.spinning { animation: spin 1s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }

  /* ── Page ── */
  .page {
    padding: 16px;
    padding-bottom: 90px;
    min-height: 100dvh;
  }

  /* ── Stat grid ── */
  .stat-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
    margin-bottom: 16px;
  }

  .stat-card {
    background: ${C.card};
    border: 1px solid ${C.border};
    border-radius: 14px;
    padding: 14px;
    position: relative;
    overflow: hidden;
  }

  .stat-card::after {
    content: attr(data-icon);
    position: absolute;
    right: 10px; bottom: 8px;
    font-size: 28px;
    opacity: 0.12;
  }

  .stat-label {
    font-size: 11px;
    color: ${C.muted};
    font-weight: 600;
    margin-bottom: 6px;
  }

  .stat-value {
    font-size: 28px;
    font-weight: 700;
    line-height: 1;
    font-variant-numeric: tabular-nums;
  }

  .stat-value.blue { color: ${C.accent}; }
  .stat-value.green { color: ${C.green}; }
  .stat-value.red { color: ${C.red}; }
  .stat-value.yellow { color: ${C.yellow}; }

  .stat-card.blue-accent { border-top: 2px solid ${C.accent}; }
  .stat-card.green-accent { border-top: 2px solid ${C.green}; }
  .stat-card.red-accent { border-top: 2px solid ${C.red}; }
  .stat-card.yellow-accent { border-top: 2px solid ${C.yellow}; }

  /* ── Card ── */
  .card {
    background: ${C.card};
    border: 1px solid ${C.border};
    border-radius: 14px;
    padding: 14px;
    margin-bottom: 12px;
  }

  .card-title {
    font-size: 13px;
    font-weight: 700;
    color: ${C.muted};
    text-transform: uppercase;
    letter-spacing: 0.8px;
    margin-bottom: 12px;
    display: flex; align-items: center; gap: 6px;
  }

  /* ── User Row ── */
  .user-row {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 0;
    border-bottom: 1px solid ${C.border}40;
  }
  .user-row:last-child { border-bottom: none; }

  .avatar {
    width: 42px; height: 42px;
    border-radius: 50%;
    background: linear-gradient(135deg, ${C.accent}, #8b5cf6);
    display: flex; align-items: center; justify-content: center;
    font-size: 15px; font-weight: 700;
    color: white;
    flex-shrink: 0;
  }

  .avatar.sm { width: 34px; height: 34px; font-size: 12px; }

  .user-info { flex: 1; min-width: 0; }
  .user-name { font-size: 14px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .user-meta { font-size: 11px; color: ${C.muted}; margin-top: 2px; }

  /* ── Pill ── */
  .pill {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    padding: 3px 9px;
    border-radius: 20px;
    font-size: 11px;
    font-weight: 700;
    white-space: nowrap;
    flex-shrink: 0;
  }

  .pill.active { background: #22c55e18; color: ${C.green}; border: 1px solid #22c55e33; }
  .pill.inactive { background: #ef444418; color: ${C.red}; border: 1px solid #ef444433; }
  .pill.pending { background: #f59e0b18; color: ${C.yellow}; border: 1px solid #f59e0b33; }

  /* ── Buttons ── */
  .btn {
    display: inline-flex; align-items: center; gap: 5px;
    padding: 8px 14px;
    border-radius: 10px;
    font-size: 12px; font-weight: 600;
    font-family: inherit;
    cursor: pointer; border: none;
    transition: all 0.15s;
    white-space: nowrap;
  }
  .btn:active { transform: scale(0.96); }
  .btn:disabled { opacity: 0.5; pointer-events: none; }

  .btn-primary { background: ${C.accent}; color: white; }
  .btn-primary:hover { filter: brightness(1.1); }

  .btn-success { background: #22c55e20; color: ${C.green}; border: 1px solid #22c55e40; }
  .btn-success:hover { background: ${C.green}; color: white; }

  .btn-danger { background: #ef444420; color: ${C.red}; border: 1px solid #ef444440; }
  .btn-danger:hover { background: ${C.red}; color: white; }

  .btn-ghost { background: transparent; color: ${C.muted}; border: 1px solid ${C.border}; }
  .btn-ghost:hover { background: ${C.border}; color: ${C.text}; }

  .btn-block { width: 100%; justify-content: center; padding: 12px; }

  /* ── Input ── */
  .input, .textarea {
    background: ${C.panel};
    border: 1px solid ${C.border};
    border-radius: 10px;
    padding: 11px 13px;
    color: ${C.text};
    font-family: inherit;
    font-size: 14px;
    width: 100%;
    outline: none;
    transition: border-color 0.2s;
    -webkit-appearance: none;
  }
  .input:focus, .textarea:focus { border-color: ${C.accent}; }
  .input::placeholder, .textarea::placeholder { color: ${C.muted}; }
  .textarea { resize: vertical; min-height: 90px; }
  .field { margin-bottom: 12px; }
  .field label { display: block; font-size: 11px; font-weight: 700; color: ${C.muted}; letter-spacing: 0.8px; margin-bottom: 6px; }

  /* ── Search ── */
  .search-wrap {
    position: relative;
    margin-bottom: 12px;
  }
  .search-wrap .search-icon {
    position: absolute; left: 12px; top: 50%;
    transform: translateY(-50%);
    font-size: 16px;
    pointer-events: none;
  }
  .search-wrap .input { padding-left: 38px; }

  /* ── Filter tabs ── */
  .filter-tabs {
    display: flex; gap: 6px;
    margin-bottom: 14px;
    overflow-x: auto;
    padding-bottom: 2px;
    scrollbar-width: none;
  }
  .filter-tabs::-webkit-scrollbar { display: none; }

  .filter-tab {
    flex-shrink: 0;
    padding: 7px 14px;
    border-radius: 20px;
    font-size: 12px; font-weight: 600;
    cursor: pointer;
    border: 1px solid ${C.border};
    background: transparent;
    color: ${C.muted};
    font-family: inherit;
    transition: all 0.15s;
  }
  .filter-tab.active {
    background: ${C.accent};
    color: white;
    border-color: ${C.accent};
  }

  /* ── Report card ── */
  .report-card {
    background: ${C.panel};
    border: 1px solid ${C.border};
    border-radius: 12px;
    padding: 13px;
    margin-bottom: 10px;
  }
  .report-header {
    display: flex; align-items: flex-start;
    justify-content: space-between;
    gap: 8px;
    margin-bottom: 8px;
  }
  .report-meta { font-size: 11px; color: ${C.muted}; margin-top: 6px; display: flex; gap: 10px; flex-wrap: wrap; }
  .report-issue {
    font-size: 13px;
    color: ${C.text};
    line-height: 1.5;
    background: ${C.card};
    border-radius: 8px;
    padding: 8px 10px;
    margin-top: 8px;
    border-left: 2px solid ${C.red};
  }

  /* ── Modal ── */
  .modal-overlay {
    position: fixed; inset: 0;
    background: #00000094;
    z-index: 200;
    display: flex;
    align-items: flex-end;
    animation: fadeIn 0.2s;
  }
  @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }

  .modal {
    background: ${C.card};
    border: 1px solid ${C.border};
    border-radius: 24px 24px 0 0;
    padding: 20px 20px 40px;
    width: 100%;
    max-height: 80dvh;
    overflow-y: auto;
    animation: slideUp 0.25s ease;
  }
  @keyframes slideUp {
    from { transform: translateY(40px); opacity: 0; }
    to { transform: translateY(0); opacity: 1; }
  }
  .modal-handle {
    width: 36px; height: 4px;
    background: ${C.border};
    border-radius: 4px;
    margin: 0 auto 16px;
  }
  .modal-title {
    font-size: 16px; font-weight: 700;
    margin-bottom: 16px;
    display: flex; align-items: center; gap: 8px;
  }

  /* ── Skeleton ── */
  .skeleton {
    background: linear-gradient(90deg, ${C.border}, #1a2840, ${C.border});
    background-size: 200% 100%;
    animation: shimmer 1.4s infinite;
    border-radius: 10px;
    height: 70px;
    margin-bottom: 10px;
  }
  @keyframes shimmer { 0% { background-position: -200% 0; } 100% { background-position: 200% 0; } }

  /* ── Empty ── */
  .empty {
    text-align: center;
    padding: 48px 24px;
    color: ${C.muted};
  }
  .empty-icon { font-size: 40px; margin-bottom: 10px; opacity: 0.25; }

  /* ── Toast ── */
  .toast-stack {
    position: fixed;
    top: 16px; left: 50%; transform: translateX(-50%);
    width: calc(100% - 32px); max-width: 440px;
    z-index: 999;
    display: flex; flex-direction: column; gap: 8px;
    pointer-events: none;
  }
  .toast {
    background: ${C.card};
    border: 1px solid ${C.border};
    border-radius: 12px;
    padding: 12px 14px;
    display: flex; gap: 10px; align-items: flex-start;
    animation: toastIn 0.3s ease;
    box-shadow: 0 8px 32px #00000080;
    pointer-events: all;
  }
  @keyframes toastIn { from { transform: translateY(-20px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
  .toast.success { border-left: 3px solid ${C.green}; }
  .toast.error { border-left: 3px solid ${C.red}; }
  .toast.info { border-left: 3px solid ${C.accent}; }
  .toast.warn { border-left: 3px solid ${C.yellow}; }
  .toast-icon { font-size: 18px; }
  .toast-body { flex: 1; }
  .toast-title { font-size: 13px; font-weight: 700; }
  .toast-msg { font-size: 12px; color: ${C.muted}; margin-top: 2px; }

  /* ── Notice item ── */
  .notif-row {
    display: flex; gap: 10px; align-items: flex-start;
    padding: 11px 0;
    border-bottom: 1px solid ${C.border}40;
  }
  .notif-row:last-child { border-bottom: none; }
  .notif-dot { width: 8px; height: 8px; border-radius: 50%; margin-top: 5px; flex-shrink: 0; }
  .notif-dot.new { background: ${C.accent}; box-shadow: 0 0 6px ${C.accent}; animation: pulse 2s infinite; }
  .notif-dot.old { background: ${C.muted}; }
  .notif-content { flex: 1; }
  .notif-title { font-size: 13px; font-weight: 600; }
  .notif-sub { font-size: 12px; color: ${C.muted}; margin-top: 2px; }
  .notif-time { font-size: 11px; color: ${C.muted}; white-space: nowrap; }

  /* ── Broadcast card ── */
  .bcast-card {
    background: linear-gradient(135deg, ${C.card}, #0a1830);
    border: 1px solid ${C.accentGlow};
    border-radius: 14px;
    padding: 16px;
    margin-bottom: 12px;
  }

  /* ── Section header ── */
  .section-label {
    font-size: 11px;
    font-weight: 700;
    color: ${C.muted};
    letter-spacing: 1.2px;
    text-transform: uppercase;
    margin: 18px 0 10px;
  }

  /* ── Subject row ── */
  .subject-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 0;
    border-bottom: 1px solid ${C.border}40;
    font-size: 13px;
  }
  .subject-row:last-child { border-bottom: none; }
  .subject-bar {
    height: 4px; border-radius: 4px;
    background: ${C.border};
    width: 80px;
    overflow: hidden;
    margin-top: 4px;
  }
  .subject-bar-fill {
    height: 100%;
    background: ${C.accent};
    border-radius: 4px;
  }
`;

// ─── API ───
const apiFetch = async (params) => {
  const qs = new URLSearchParams(params).toString();
  const r = await fetch(GAS_URL + "?" + qs);
  return r.json();
};

const apiPost = async (body) => {
  const r = await fetch(GAS_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return r.json();
};

// ─── Helpers ───
const fmt = n => (n || 0).toLocaleString();
const initials = name => (name || "?").split(" ").map(w => w[0]).join("").toUpperCase().substring(0, 2);
const timeAgo = ts => {
  if (!ts) return "—";
  try {
    const d = new Date(ts.replace ? ts.replace(/(\d{2})-(\d{2})-(\d{4})/, "$3-$2-$1") : ts);
    const diff = Date.now() - d.getTime();
    if (diff < 60000) return "এখনই";
    if (diff < 3600000) return Math.floor(diff / 60000) + " মিনিট আগে";
    if (diff < 86400000) return Math.floor(diff / 3600000) + " ঘণ্টা আগে";
    return Math.floor(diff / 86400000) + " দিন আগে";
  } catch { return ts; }
};

// ─── Toast ───
let _toastId = 0;
function useToasts() {
  const [toasts, setToasts] = useState([]);
  const push = useCallback((type, title, msg = "") => {
    const id = ++_toastId;
    setToasts(p => [...p, { id, type, title, msg }]);
    setTimeout(() => setToasts(p => p.filter(t => t.id !== id)), 4000);
  }, []);
  return [toasts, push];
}

// ════════════════════════════════
// PAGES
// ════════════════════════════════

// ── Dashboard ──
function DashboardPage({ push }) {
  const [data, setData] = useState(null);
  const [usersData, setUsersData] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const [d, u] = await Promise.all([
        apiFetch({ action: "getDashboard" }),
        apiFetch({ action: "getUsers" }),
      ]);
      setData(d); setUsersData(u);
    } catch (e) { push("error", "লোড ব্যর্থ", e.message); }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const users = usersData?.users || [];
  const totalStudents = users.length;
  const activeStudents = users.filter(u => (u.Status || u.status || "").toLowerCase() === "active").length;
  const pendingStudents = users.filter(u => (u.Status || u.status || "").toLowerCase() !== "active").length;
  const totalQuiz = data ? Object.values(data.quiz || {}).reduce((s, v) => s + v.total, 0) : 0;
  const totalQBank = data ? Object.values(data.qbank || {}).reduce((s, v) => s + v.total, 0) : 0;
  const recentReports = data?.reports?.slice(0, 4) || [];
  const recentSignups = users.slice(-5).reverse();

  if (loading) return (
    <div className="page">
      <div className="stat-grid">{[...Array(4)].map((_, i) => <div key={i} className="skeleton" style={{ height: 80, borderRadius: 14 }} />)}</div>
      {[...Array(3)].map((_, i) => <div key={i} className="skeleton" />)}
    </div>
  );

  return (
    <div className="page">
      <div className="stat-grid">
        <div className="stat-card blue-accent" data-icon="👨‍🎓">
          <div className="stat-label">মোট স্টুডেন্ট</div>
          <div className="stat-value blue">{fmt(totalStudents)}</div>
        </div>
        <div className="stat-card green-accent" data-icon="✅">
          <div className="stat-label">অ্যাক্টিভ</div>
          <div className="stat-value green">{fmt(activeStudents)}</div>
        </div>
        <div className="stat-card yellow-accent" data-icon="⏳">
          <div className="stat-label">পেন্ডিং</div>
          <div className="stat-value yellow">{fmt(pendingStudents)}</div>
        </div>
        <div className="stat-card red-accent" data-icon="🚨">
          <div className="stat-label">রিপোর্ট</div>
          <div className="stat-value red">{fmt(recentReports.length)}</div>
        </div>
      </div>

      <div className="stat-grid">
        <div className="stat-card" data-icon="❓">
          <div className="stat-label">কুইজ প্রশ্ন</div>
          <div className="stat-value blue">{fmt(totalQuiz)}</div>
        </div>
        <div className="stat-card" data-icon="📚">
          <div className="stat-label">QBank</div>
          <div className="stat-value blue">{fmt(totalQBank)}</div>
        </div>
      </div>

      {/* Recent reports */}
      <div className="card">
        <div className="card-title">🚨 সাম্প্রতিক রিপোর্ট</div>
        {recentReports.length === 0
          ? <div style={{ textAlign: "center", color: C.muted, padding: "20px 0", fontSize: 13 }}>কোনো রিপোর্ট নেই ✅</div>
          : recentReports.map((r, i) => (
            <div key={i} className="notif-row">
              <div className="notif-dot new" />
              <div className="notif-content">
                <div className="notif-title">{r.subject || "—"} • {r.phone || "—"}</div>
                <div className="notif-sub">{(r.issue || "").substring(0, 55)}</div>
              </div>
              <div className="notif-time">{timeAgo(r.time)}</div>
            </div>
          ))
        }
      </div>

      {/* Recent signups */}
      <div className="card">
        <div className="card-title">🆕 সাম্প্রতিক সাইনআপ</div>
        {recentSignups.map((u, i) => {
          const status = (u.Status || u.status || "inactive").toLowerCase();
          return (
            <div key={i} className="user-row">
              <div className="avatar sm">{initials(u.Name || u.name)}</div>
              <div className="user-info">
                <div className="user-name">{u.Name || u.name || "অজানা"}</div>
                <div className="user-meta">📱 {u.Phone || u.phone || "—"}</div>
              </div>
              <span className={`pill ${status}`}>{status === "active" ? "✅ অ্যাক্টিভ" : "⏳ পেন্ডিং"}</span>
            </div>
          );
        })}
      </div>

      {/* Subject stats */}
      {Object.keys(data?.quiz || {}).length > 0 && (
        <div className="card">
          <div className="card-title">📊 বিষয়ভিত্তিক কুইজ</div>
          {Object.entries(data.quiz).map(([sub, v]) => (
            <div key={sub} className="subject-row">
              <div>
                <div style={{ fontWeight: 600, fontSize: 13 }}>{sub}</div>
                <div className="subject-bar">
                  <div className="subject-bar-fill" style={{ width: Math.min(100, (v.total / Math.max(totalQuiz, 1)) * 100) + "%" }} />
                </div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontWeight: 700, color: C.accent }}>{v.total}</div>
                <div style={{ fontSize: 11, color: C.muted }}>MCQ {v.mcq} / Written {v.written}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Signups Page ──
function SignupsPage({ push }) {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activating, setActivating] = useState(null);

  const load = async () => {
    setLoading(true);
    try {
      const d = await apiFetch({ action: "getUsers" });
      const pending = (d.users || []).filter(u => (u.Status || u.status || "").toLowerCase() !== "active");
      setUsers(pending);
    } catch (e) { push("error", "লোড ব্যর্থ", e.message); }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const activate = async (u) => {
    const phone = u.Phone || u.phone || "";
    if (!phone) { push("error", "ফোন নেই", ""); return; }
    setActivating(phone);
    try {
      // POST to GAS to update the Status column in Users sheet
      const r = await apiPost({
        type: "update_explanation",
        sheet: "Users",
        id: phone,
        field: "status",
        content: "Active"
      });
      push("success", "অ্যাক্টিভ করা হয়েছে!", u.Name || u.name || phone);
      // Also send FCM notification
      try {
        await apiPost({
          type: "broadcast_notification",
          title: "🎉 আপনার অ্যাকাউন্ট অ্যাক্টিভ হয়েছে!",
          body: "Smart Study-তে আপনাকে স্বাগতম! এখন পড়াশোনা শুরু করুন।"
        });
      } catch (_) {}
      setUsers(p => p.filter(x => (x.Phone || x.phone) !== phone));
    } catch (e) { push("error", "ব্যর্থ", e.message); }
    setActivating(null);
  };

  return (
    <div className="page">
      <div style={{
        background: "#ef444412",
        border: `1px solid #ef444430`,
        borderRadius: 12,
        padding: "10px 14px",
        fontSize: 13,
        color: C.red,
        fontWeight: 600,
        marginBottom: 14,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between"
      }}>
        <span>🔔 {users.length}টি অ্যাক্টিভেশন পেন্ডিং</span>
        <button className="btn btn-ghost" style={{ padding: "4px 10px", fontSize: 11 }} onClick={load}>🔄</button>
      </div>

      {loading
        ? [...Array(4)].map((_, i) => <div key={i} className="skeleton" />)
        : users.length === 0
          ? <div className="empty"><div className="empty-icon">🎉</div><p>সব স্টুডেন্ট অ্যাক্টিভ!</p></div>
          : users.map((u, i) => {
            const name = u.Name || u.name || "অজানা";
            const phone = u.Phone || u.phone || "—";
            const isActivating = activating === (u.Phone || u.phone);
            return (
              <div key={i} className="card" style={{ padding: "14px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
                  <div className="avatar">{initials(name)}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 15 }}>{name}</div>
                    <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>📱 {phone}</div>
                    {(u.Email || u.email) && <div style={{ fontSize: 12, color: C.muted }}>✉️ {u.Email || u.email}</div>}
                    <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>🕐 {timeAgo(u.Timestamp || u.timestamp)}</div>
                  </div>
                  <span className="pill pending">⏳ পেন্ডিং</span>
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button
                    className="btn btn-success"
                    style={{ flex: 1, justifyContent: "center" }}
                    disabled={!!activating}
                    onClick={() => activate(u)}
                  >
                    {isActivating ? "⏳ করা হচ্ছে..." : "✅ অ্যাক্টিভ করুন"}
                  </button>
                  <button className="btn btn-danger" style={{ flex: 1, justifyContent: "center" }}>
                    ❌ রিজেক্ট
                  </button>
                </div>
              </div>
            );
          })
      }
    </div>
  );
}

// ── Students Page ──
function StudentsPage({ push }) {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState("all");
  const [selected, setSelected] = useState(null);
  const [activating, setActivating] = useState(null);

  const load = async () => {
    setLoading(true);
    try {
      const d = await apiFetch({ action: "getUsers" });
      setUsers(d.users || []);
    } catch (e) { push("error", "লোড ব্যর্থ", e.message); }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const filtered = users.filter(u => {
    const name = (u.Name || u.name || "").toLowerCase();
    const phone = (u.Phone || u.phone || "").toLowerCase();
    const status = (u.Status || u.status || "").toLowerCase();
    const q = search.toLowerCase();
    const matchSearch = !q || name.includes(q) || phone.includes(q);
    const matchTab = tab === "all" || status === tab;
    return matchSearch && matchTab;
  });

  const activateUser = async (u) => {
    const phone = u.Phone || u.phone || "";
    if (!phone) return;
    setActivating(phone);
    try {
      await apiPost({
        type: "update_explanation",
        sheet: "Users",
        id: phone,
        field: "status",
        content: "Active"
      });
      push("success", "অ্যাক্টিভ হয়েছে!", u.Name || u.name);
      setUsers(p => p.map(x => {
        if ((x.Phone || x.phone) === phone) return { ...x, Status: "Active", status: "Active" };
        return x;
      }));
    } catch (e) { push("error", "ব্যর্থ", e.message); }
    setActivating(null);
  };

  return (
    <div className="page">
      <div className="search-wrap">
        <span className="search-icon">🔍</span>
        <input
          className="input"
          placeholder="নাম বা ফোন দিয়ে খুঁজুন..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      <div className="filter-tabs">
        {[["all", "সবাই"], ["active", "✅ অ্যাক্টিভ"], ["inactive", "🔴 ইনঅ্যাক্টিভ"]].map(([v, l]) => (
          <button key={v} className={`filter-tab ${tab === v ? "active" : ""}`} onClick={() => setTab(v)}>{l}</button>
        ))}
      </div>

      <div style={{ fontSize: 12, color: C.muted, marginBottom: 10 }}>{filtered.length} জন স্টুডেন্ট</div>

      {loading
        ? [...Array(5)].map((_, i) => <div key={i} className="skeleton" />)
        : filtered.length === 0
          ? <div className="empty"><div className="empty-icon">👤</div><p>কোনো স্টুডেন্ট নেই</p></div>
          : filtered.map((u, i) => {
            const name = u.Name || u.name || "অজানা";
            const phone = u.Phone || u.phone || "—";
            const status = (u.Status || u.status || "inactive").toLowerCase();
            const isActivating = activating === (u.Phone || u.phone);
            return (
              <div key={i} className="card" style={{ padding: "13px" }}>
                <div className="user-row" style={{ paddingBottom: 10 }}>
                  <div className="avatar">{initials(name)}</div>
                  <div className="user-info">
                    <div className="user-name">{name}</div>
                    <div className="user-meta">📱 {phone}</div>
                  </div>
                  <span className={`pill ${status}`}>
                    {status === "active" ? "✅ অ্যাক্টিভ" : "🔴 ইনঅ্যাক্টিভ"}
                  </span>
                </div>
                {/* Stats row */}
                <div style={{ display: "flex", gap: 12, marginBottom: 10, fontSize: 12 }}>
                  <div style={{ textAlign: "center", flex: 1, background: C.panel, borderRadius: 8, padding: "7px 0" }}>
                    <div style={{ color: C.green, fontWeight: 700, fontSize: 15 }}>{u._totalCorrect || 0}</div>
                    <div style={{ color: C.muted, fontSize: 10 }}>সঠিক</div>
                  </div>
                  <div style={{ textAlign: "center", flex: 1, background: C.panel, borderRadius: 8, padding: "7px 0" }}>
                    <div style={{ color: C.red, fontWeight: 700, fontSize: 15 }}>{u._totalWrong || 0}</div>
                    <div style={{ color: C.muted, fontSize: 10 }}>ভুল</div>
                  </div>
                  <div style={{ textAlign: "center", flex: 1, background: C.panel, borderRadius: 8, padding: "7px 0" }}>
                    <div style={{ color: C.accent, fontWeight: 700, fontSize: 15 }}>{u._totalMinutes || 0}</div>
                    <div style={{ color: C.muted, fontSize: 10 }}>মিনিট</div>
                  </div>
                  <div style={{ textAlign: "center", flex: 1, background: C.panel, borderRadius: 8, padding: "7px 0" }}>
                    <div style={{ color: C.text, fontWeight: 700, fontSize: 13 }}>{timeAgo(u._lastActive || u.Timestamp)}</div>
                    <div style={{ color: C.muted, fontSize: 10 }}>শেষ</div>
                  </div>
                </div>
                {/* Actions */}
                <div style={{ display: "flex", gap: 8 }}>
                  {status !== "active"
                    ? <button
                        className="btn btn-success"
                        style={{ flex: 1, justifyContent: "center" }}
                        disabled={!!activating}
                        onClick={() => activateUser(u)}
                      >
                        {isActivating ? "⏳ হচ্ছে..." : "✅ অ্যাক্টিভ করুন"}
                      </button>
                    : <div style={{ flex: 1 }} />
                  }
                  <button className="btn btn-ghost" onClick={() => setSelected(u)}>📣 নোটিফাই</button>
                </div>
              </div>
            );
          })
      }

      {selected && <NotifyModal user={selected} onClose={() => setSelected(null)} push={push} />}
    </div>
  );
}

// ── Reports Page ──
function ReportsPage({ push }) {
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [resolving, setResolving] = useState(null);
  const [detail, setDetail] = useState(null);

  const load = async () => {
    setLoading(true);
    try {
      const d = await apiFetch({ action: "getDashboard" });
      setReports(d.reports || []);
    } catch (e) { push("error", "লোড ব্যর্থ", e.message); }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const resolve = async (r) => {
    setResolving(r.row);
    try {
      const res = await apiPost({
        type: "resolve_report",
        phone: r.phone,
        subject: r.subject || "প্রশ্নটি",
        questionId: r.questionId,
      });
      push("success", "রিপোর্ট সমাধান হয়েছে ✅", `${r.phone} কে নোটিফাই করা হয়েছে`);
      setReports(p => p.filter(x => x.row !== r.row));
      if (detail?.row === r.row) setDetail(null);
    } catch (e) { push("error", "ব্যর্থ", e.message); }
    setResolving(null);
  };

  return (
    <div className="page">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
        <div style={{ fontSize: 13, color: C.muted }}>{reports.length}টি রিপোর্ট পেন্ডিং</div>
        <button className="btn btn-ghost" style={{ padding: "6px 12px", fontSize: 12 }} onClick={load}>🔄 রিফ্রেশ</button>
      </div>

      {loading
        ? [...Array(4)].map((_, i) => <div key={i} className="skeleton" />)
        : reports.length === 0
          ? <div className="empty"><div className="empty-icon">📋</div><p>কোনো রিপোর্ট নেই!</p></div>
          : reports.map((r, i) => (
            <div key={i} className="report-card">
              <div className="report-header">
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>{r.subject || "অজানা বিষয়"}</div>
                  <div className="report-meta">
                    <span>📱 {r.phone || "—"}</span>
                    {r.subtopic && <span>📌 {r.subtopic}</span>}
                    {r.questionId && <span style={{ color: C.accent }}>#{r.questionId}</span>}
                    <span style={{ marginLeft: "auto" }}>{timeAgo(r.time)}</span>
                  </div>
                </div>
              </div>
              <div className="report-issue">{r.issue || r.question || "কোনো বিস্তারিত নেই"}</div>
              {r.question && r.question !== r.issue && (
                <div style={{ fontSize: 12, color: C.muted, marginTop: 6, paddingLeft: 8 }}>
                  ❓ {r.question.substring(0, 100)}{r.question.length > 100 ? "…" : ""}
                </div>
              )}
              <div style={{ marginTop: 10 }}>
                <button
                  className="btn btn-success btn-block"
                  disabled={resolving === r.row}
                  onClick={() => resolve(r)}
                >
                  {resolving === r.row ? "⏳ সমাধান হচ্ছে..." : "✅ সমাধান করুন ও নোটিফাই করুন"}
                </button>
              </div>
            </div>
          ))
      }

      {detail && (
        <div className="modal-overlay" onClick={() => setDetail(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-handle" />
            <div className="modal-title">🚨 রিপোর্ট বিস্তারিত</div>
            <div className="field"><label>ফোন</label><input className="input" readOnly value={detail.phone || "—"} /></div>
            <div className="field"><label>বিষয়</label><input className="input" readOnly value={detail.subject || "—"} /></div>
            <div className="field"><label>সমস্যা</label><textarea className="textarea" readOnly value={detail.issue || "—"} /></div>
            {detail.question && <div className="field"><label>প্রশ্ন</label><textarea className="textarea" readOnly value={detail.question} /></div>}
            <button
              className="btn btn-success btn-block"
              disabled={resolving === detail.row}
              onClick={() => resolve(detail)}
            >
              {resolving === detail.row ? "⏳ হচ্ছে..." : "✅ সমাধান করুন"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Notifications Page ──
function NotificationsPage({ push }) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [history, setHistory] = useState([
    { title: "নতুন কুইজ যোগ হয়েছে!", body: "Physics থেকে নতুন প্রশ্ন", time: "১ ঘণ্টা আগে" },
    { title: "সাপ্তাহিক চ্যালেঞ্জ", body: "এই সপ্তাহের চ্যালেঞ্জ শুরু হয়েছে", time: "২ দিন আগে" },
  ]);

  const broadcast = async () => {
    if (!title || !body) { push("warn", "তথ্য দিন", "Title ও Body দেওয়া দরকার"); return; }
    setSending(true);
    try {
      const r = await apiPost({ type: "broadcast_notification", title, body });
      push("success", "পাঠানো হয়েছে 🎉", `${r.fcm?.sent || 0} জনকে পাঠানো হয়েছে`);
      setHistory(p => [{ title, body, time: "এখনই" }, ...p]);
      setTitle(""); setBody("");
    } catch (e) { push("error", "ব্যর্থ", e.message); }
    setSending(false);
  };

  return (
    <div className="page">
      <div className="bcast-card">
        <div className="card-title">📣 সবাইকে নোটিফিকেশন</div>
        <div className="field">
          <label>শিরোনাম</label>
          <input className="input" placeholder="নোটিফিকেশনের শিরোনাম..." value={title} onChange={e => setTitle(e.target.value)} />
        </div>
        <div className="field">
          <label>বার্তা</label>
          <textarea className="textarea" placeholder="বিস্তারিত বার্তা লিখুন..." value={body} onChange={e => setBody(e.target.value)} />
        </div>
        <button className="btn btn-primary btn-block" onClick={broadcast} disabled={sending}>
          {sending ? "⏳ পাঠানো হচ্ছে..." : "📣 সবাইকে পাঠান"}
        </button>
      </div>

      <div className="section-label">পাঠানোর ইতিহাস</div>
      <div className="card">
        {history.map((h, i) => (
          <div key={i} className="notif-row">
            <div className={`notif-dot ${i === 0 ? "new" : "old"}`} />
            <div className="notif-content">
              <div className="notif-title">{h.title}</div>
              <div className="notif-sub">{h.body.substring(0, 60)}</div>
            </div>
            <div className="notif-time">{h.time}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Notify Modal ──
function NotifyModal({ user, onClose, push }) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const name = user.Name || user.name || "স্টুডেন্ট";

  const send = async () => {
    if (!title || !body) return;
    setSending(true);
    try {
      await apiPost({ type: "broadcast_notification", title, body });
      push("success", "পাঠানো হয়েছে", `${name} কে নোটিফাই করা হয়েছে`);
      onClose();
    } catch (e) { push("error", "ব্যর্থ", e.message); }
    setSending(false);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-handle" />
        <div className="modal-title">📣 নোটিফিকেশন — {name}</div>
        <div style={{ fontSize: 12, color: C.muted, marginBottom: 14 }}>📱 {user.Phone || user.phone}</div>
        <div className="field">
          <label>শিরোনাম</label>
          <input className="input" placeholder="Title..." value={title} onChange={e => setTitle(e.target.value)} />
        </div>
        <div className="field">
          <label>বার্তা</label>
          <textarea className="textarea" placeholder="Message..." value={body} onChange={e => setBody(e.target.value)} />
        </div>
        <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
          <button className="btn btn-ghost" style={{ flex: 1, justifyContent: "center" }} onClick={onClose}>বাতিল</button>
          <button className="btn btn-primary" style={{ flex: 1, justifyContent: "center" }} onClick={send} disabled={sending}>
            {sending ? "⏳" : "📨"} পাঠান
          </button>
        </div>
      </div>
    </div>
  );
}

// ════════════════════════════════
// ROOT APP
// ════════════════════════════════

const NAV = [
  { id: "dashboard", icon: "📊", label: "ড্যাশবোর্ড" },
  { id: "signups", icon: "🆕", label: "সাইনআপ", badge: true },
  { id: "students", icon: "👥", label: "স্টুডেন্ট" },
  { id: "reports", icon: "🚨", label: "রিপোর্ট", badge: true },
  { id: "notifications", icon: "📣", label: "নোটিফাই" },
];

const PAGE_TITLES = {
  dashboard: "ড্যাশবোর্ড",
  signups: "নতুন সাইনআপ",
  students: "স্টুডেন্ট",
  reports: "রিপোর্ট",
  notifications: "নোটিফিকেশন",
};

export default function App() {
  const [page, setPage] = useState("dashboard");
  const [toasts, push] = useToasts();
  const [refreshing, setRefreshing] = useState(false);
  const [key, setKey] = useState(0);

  const refresh = () => {
    setRefreshing(true);
    setKey(k => k + 1);
    setTimeout(() => setRefreshing(false), 1500);
  };

  return (
    <>
      <style>{css}</style>

      {/* Topbar */}
      <div className="topbar">
        <div>
          <div className="topbar-title">{NAV.find(n => n.id === page)?.icon} {PAGE_TITLES[page]}</div>
          <div className="topbar-sub">Smart Study Admin</div>
        </div>
        <button className={`icon-btn ${refreshing ? "spinning" : ""}`} onClick={refresh}>🔄</button>
      </div>

      {/* Page Content */}
      <div key={key}>
        {page === "dashboard" && <DashboardPage push={push} />}
        {page === "signups" && <SignupsPage push={push} />}
        {page === "students" && <StudentsPage push={push} />}
        {page === "reports" && <ReportsPage push={push} />}
        {page === "notifications" && <NotificationsPage push={push} />}
      </div>

      {/* Bottom Nav */}
      <nav className="bottom-nav">
        {NAV.map(n => (
          <button key={n.id} className={`nav-btn ${page === n.id ? "active" : ""}`} onClick={() => setPage(n.id)}>
            <span className="nav-icon">{n.icon}</span>
            <span>{n.label}</span>
            {n.badge && <span className="nav-badge">!</span>}
          </button>
        ))}
      </nav>

      {/* Toast Stack */}
      <div className="toast-stack">
        {toasts.map(t => (
          <div key={t.id} className={`toast ${t.type}`}>
            <div className="toast-icon">
              {t.type === "success" ? "✅" : t.type === "error" ? "❌" : t.type === "warn" ? "⚠️" : "ℹ️"}
            </div>
            <div className="toast-body">
              <div className="toast-title">{t.title}</div>
              {t.msg && <div className="toast-msg">{t.msg}</div>}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
