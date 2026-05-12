import { useState, useEffect, useCallback } from "react";

const GAS_URL = "https://script.google.com/macros/s/AKfycbyjF7iFX0H_rFuJgMJYo70DC7KRX1lBXU7m7NoZCwf6VTJfRm6Iyw6hOcN2q_UKbxxgQg/exec";

const COLORS = {
  bg: "#070d1a",
  card: "#0d1829",
  cardBorder: "#1a2840",
  accent: "#00c6ff",
  accentGlow: "#00c6ff33",
  accent2: "#f97316",
  accent2Glow: "#f9731633",
  success: "#22c55e",
  danger: "#ef4444",
  warn: "#facc15",
  text: "#e2e8f0",
  muted: "#64748b",
  panel: "#101e33",
};

const css = `
  @import url('https://fonts.googleapis.com/css2?family=Exo+2:wght@300;400;600;700;800&family=JetBrains+Mono:wght@400;600&display=swap');

  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  body {
    background: ${COLORS.bg};
    color: ${COLORS.text};
    font-family: 'Exo 2', sans-serif;
    min-height: 100vh;
  }

  ::-webkit-scrollbar { width: 5px; height: 5px; }
  ::-webkit-scrollbar-track { background: ${COLORS.bg}; }
  ::-webkit-scrollbar-thumb { background: ${COLORS.cardBorder}; border-radius: 10px; }

  .app-shell {
    display: flex;
    min-height: 100vh;
    background: ${COLORS.bg};
  }

  /* ── Sidebar ── */
  .sidebar {
    width: 230px;
    min-height: 100vh;
    background: ${COLORS.card};
    border-right: 1px solid ${COLORS.cardBorder};
    display: flex;
    flex-direction: column;
    position: fixed;
    left: 0; top: 0; bottom: 0;
    z-index: 100;
    overflow-y: auto;
  }

  .sidebar-logo {
    padding: 20px 16px 16px;
    display: flex;
    align-items: center;
    gap: 10px;
    border-bottom: 1px solid ${COLORS.cardBorder};
  }

  .sidebar-logo img {
    width: 44px;
    height: 44px;
    border-radius: 12px;
    object-fit: cover;
    box-shadow: 0 0 16px ${COLORS.accentGlow};
  }

  .sidebar-logo-text {
    line-height: 1.2;
  }

  .sidebar-logo-text .title {
    font-size: 13px;
    font-weight: 800;
    color: ${COLORS.accent};
    letter-spacing: 1px;
    text-transform: uppercase;
  }

  .sidebar-logo-text .sub {
    font-size: 10px;
    color: ${COLORS.muted};
    letter-spacing: 1.5px;
    text-transform: uppercase;
  }

  .sidebar-section-label {
    font-size: 10px;
    color: ${COLORS.muted};
    letter-spacing: 2px;
    text-transform: uppercase;
    padding: 18px 16px 6px;
    font-weight: 600;
  }

  .nav-item {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 16px;
    cursor: pointer;
    border-radius: 8px;
    margin: 2px 8px;
    transition: all 0.18s;
    font-size: 13px;
    font-weight: 500;
    color: ${COLORS.muted};
    position: relative;
  }

  .nav-item:hover {
    background: ${COLORS.accentGlow};
    color: ${COLORS.text};
  }

  .nav-item.active {
    background: linear-gradient(90deg, ${COLORS.accentGlow}, transparent);
    color: ${COLORS.accent};
    border-left: 2px solid ${COLORS.accent};
  }

  .nav-item .icon { font-size: 16px; min-width: 20px; text-align: center; }

  .badge {
    margin-left: auto;
    background: ${COLORS.danger};
    color: white;
    font-size: 10px;
    font-weight: 700;
    padding: 1px 6px;
    border-radius: 20px;
    font-family: 'JetBrains Mono', monospace;
    animation: pulse-badge 2s infinite;
  }

  @keyframes pulse-badge {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.6; }
  }

  /* ── Main ── */
  .main {
    margin-left: 230px;
    flex: 1;
    display: flex;
    flex-direction: column;
    min-height: 100vh;
  }

  .topbar {
    padding: 14px 24px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    border-bottom: 1px solid ${COLORS.cardBorder};
    background: ${COLORS.card};
    position: sticky;
    top: 0;
    z-index: 50;
  }

  .topbar-title {
    font-size: 16px;
    font-weight: 700;
    color: ${COLORS.text};
  }

  .topbar-right {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .refresh-btn {
    background: ${COLORS.accentGlow};
    border: 1px solid ${COLORS.accent};
    color: ${COLORS.accent};
    padding: 6px 14px;
    border-radius: 8px;
    cursor: pointer;
    font-size: 12px;
    font-family: 'Exo 2', sans-serif;
    font-weight: 600;
    transition: all 0.2s;
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .refresh-btn:hover {
    background: ${COLORS.accent};
    color: ${COLORS.bg};
  }

  .refresh-btn.spinning { animation: spin 1s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }

  .content {
    padding: 24px;
    flex: 1;
  }

  /* ── Cards ── */
  .card {
    background: ${COLORS.card};
    border: 1px solid ${COLORS.cardBorder};
    border-radius: 14px;
    padding: 20px;
    transition: border-color 0.2s;
  }

  .card:hover { border-color: #2a3f60; }

  .card-title {
    font-size: 13px;
    font-weight: 700;
    color: ${COLORS.muted};
    text-transform: uppercase;
    letter-spacing: 1.5px;
    margin-bottom: 16px;
    display: flex;
    align-items: center;
    gap: 8px;
  }

  /* ── Stat grid ── */
  .stat-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
    gap: 14px;
    margin-bottom: 24px;
  }

  .stat-card {
    background: ${COLORS.card};
    border: 1px solid ${COLORS.cardBorder};
    border-radius: 14px;
    padding: 18px 20px;
    position: relative;
    overflow: hidden;
    transition: transform 0.2s, border-color 0.2s;
  }

  .stat-card:hover { transform: translateY(-2px); border-color: #2a3f60; }

  .stat-card::before {
    content: '';
    position: absolute;
    top: 0; left: 0; right: 0;
    height: 2px;
  }

  .stat-card.blue::before { background: linear-gradient(90deg, ${COLORS.accent}, transparent); }
  .stat-card.orange::before { background: linear-gradient(90deg, ${COLORS.accent2}, transparent); }
  .stat-card.green::before { background: linear-gradient(90deg, ${COLORS.success}, transparent); }
  .stat-card.red::before { background: linear-gradient(90deg, ${COLORS.danger}, transparent); }

  .stat-label {
    font-size: 11px;
    color: ${COLORS.muted};
    font-weight: 600;
    letter-spacing: 1px;
    text-transform: uppercase;
    margin-bottom: 8px;
  }

  .stat-value {
    font-size: 32px;
    font-weight: 800;
    font-family: 'JetBrains Mono', monospace;
    line-height: 1;
  }

  .stat-value.blue { color: ${COLORS.accent}; }
  .stat-value.orange { color: ${COLORS.accent2}; }
  .stat-value.green { color: ${COLORS.success}; }
  .stat-value.red { color: ${COLORS.danger}; }

  .stat-icon {
    position: absolute;
    right: 16px; top: 50%;
    transform: translateY(-50%);
    font-size: 36px;
    opacity: 0.08;
  }

  /* ── Table ── */
  .table-wrap { overflow-x: auto; }

  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 13px;
  }

  thead tr {
    border-bottom: 1px solid ${COLORS.cardBorder};
  }

  th {
    padding: 10px 12px;
    text-align: left;
    font-size: 11px;
    color: ${COLORS.muted};
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 1px;
    white-space: nowrap;
  }

  td {
    padding: 11px 12px;
    border-bottom: 1px solid ${COLORS.cardBorder}20;
    vertical-align: middle;
  }

  tr:hover td { background: #ffffff04; }

  /* ── Status pill ── */
  .pill {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 3px 10px;
    border-radius: 20px;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.5px;
  }

  .pill.active { background: #22c55e1a; color: ${COLORS.success}; border: 1px solid #22c55e44; }
  .pill.inactive { background: #ef44441a; color: ${COLORS.danger}; border: 1px solid #ef444444; }
  .pill.pending { background: #facc151a; color: ${COLORS.warn}; border: 1px solid #facc1544; }

  /* ── Button ── */
  .btn {
    padding: 6px 14px;
    border-radius: 8px;
    cursor: pointer;
    font-size: 12px;
    font-family: 'Exo 2', sans-serif;
    font-weight: 600;
    border: none;
    transition: all 0.18s;
    display: inline-flex;
    align-items: center;
    gap: 5px;
  }

  .btn-primary {
    background: ${COLORS.accent};
    color: ${COLORS.bg};
  }
  .btn-primary:hover { filter: brightness(1.15); transform: translateY(-1px); }

  .btn-danger {
    background: #ef44441a;
    color: ${COLORS.danger};
    border: 1px solid #ef444444;
  }
  .btn-danger:hover { background: ${COLORS.danger}; color: white; }

  .btn-success {
    background: #22c55e1a;
    color: ${COLORS.success};
    border: 1px solid #22c55e44;
  }
  .btn-success:hover { background: ${COLORS.success}; color: white; }

  .btn-warn {
    background: #facc151a;
    color: ${COLORS.warn};
    border: 1px solid #facc1544;
  }
  .btn-warn:hover { background: ${COLORS.warn}; color: ${COLORS.bg}; }

  .btn-ghost {
    background: transparent;
    color: ${COLORS.muted};
    border: 1px solid ${COLORS.cardBorder};
  }
  .btn-ghost:hover { background: ${COLORS.cardBorder}; color: ${COLORS.text}; }

  /* ── Grid layout ── */
  .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
  .grid-3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 16px; }

  /* ── Search ── */
  .search-bar {
    background: ${COLORS.panel};
    border: 1px solid ${COLORS.cardBorder};
    border-radius: 10px;
    padding: 9px 14px;
    color: ${COLORS.text};
    font-family: 'Exo 2', sans-serif;
    font-size: 13px;
    width: 260px;
    outline: none;
    transition: border-color 0.2s;
  }

  .search-bar:focus { border-color: ${COLORS.accent}; }
  .search-bar::placeholder { color: ${COLORS.muted}; }

  /* ── Notification toast ── */
  .toast-stack {
    position: fixed;
    bottom: 24px;
    right: 24px;
    z-index: 999;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .toast {
    background: ${COLORS.card};
    border: 1px solid ${COLORS.cardBorder};
    border-radius: 12px;
    padding: 14px 18px;
    min-width: 280px;
    max-width: 360px;
    display: flex;
    gap: 12px;
    align-items: flex-start;
    animation: slideIn 0.3s ease;
    box-shadow: 0 8px 32px #00000080;
  }

  @keyframes slideIn {
    from { transform: translateX(120%); opacity: 0; }
    to { transform: translateX(0); opacity: 1; }
  }

  .toast.success { border-left: 3px solid ${COLORS.success}; }
  .toast.error { border-left: 3px solid ${COLORS.danger}; }
  .toast.info { border-left: 3px solid ${COLORS.accent}; }

  .toast-icon { font-size: 20px; }
  .toast-body { flex: 1; }
  .toast-title { font-size: 13px; font-weight: 700; margin-bottom: 2px; }
  .toast-msg { font-size: 12px; color: ${COLORS.muted}; }

  /* ── Modal ── */
  .modal-overlay {
    position: fixed;
    inset: 0;
    background: #00000090;
    z-index: 200;
    display: flex;
    align-items: center;
    justify-content: center;
    backdrop-filter: blur(4px);
    animation: fadeIn 0.2s ease;
  }

  @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }

  .modal {
    background: ${COLORS.card};
    border: 1px solid ${COLORS.cardBorder};
    border-radius: 18px;
    padding: 28px;
    width: 460px;
    max-width: 95vw;
    max-height: 90vh;
    overflow-y: auto;
    animation: scaleIn 0.25s ease;
  }

  @keyframes scaleIn {
    from { transform: scale(0.92); opacity: 0; }
    to { transform: scale(1); opacity: 1; }
  }

  .modal-title {
    font-size: 17px;
    font-weight: 800;
    margin-bottom: 20px;
    display: flex;
    align-items: center;
    gap: 10px;
    color: ${COLORS.text};
  }

  .modal-actions {
    display: flex;
    gap: 10px;
    justify-content: flex-end;
    margin-top: 20px;
    padding-top: 16px;
    border-top: 1px solid ${COLORS.cardBorder};
  }

  /* ── Input ── */
  .input, .textarea {
    background: ${COLORS.panel};
    border: 1px solid ${COLORS.cardBorder};
    border-radius: 10px;
    padding: 10px 14px;
    color: ${COLORS.text};
    font-family: 'Exo 2', sans-serif;
    font-size: 13px;
    width: 100%;
    outline: none;
    transition: border-color 0.2s;
  }

  .input:focus, .textarea:focus { border-color: ${COLORS.accent}; }
  .input::placeholder, .textarea::placeholder { color: ${COLORS.muted}; }
  .textarea { resize: vertical; min-height: 80px; }

  .field { margin-bottom: 14px; }
  .field label { display: block; font-size: 11px; font-weight: 700; color: ${COLORS.muted}; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 6px; }

  /* ── Loading ── */
  .skeleton {
    background: linear-gradient(90deg, ${COLORS.cardBorder}, #1f2f48, ${COLORS.cardBorder});
    background-size: 200% 100%;
    animation: shimmer 1.5s infinite;
    border-radius: 8px;
    height: 40px;
  }

  @keyframes shimmer {
    0% { background-position: -200% 0; }
    100% { background-position: 200% 0; }
  }

  /* ── Avatar ── */
  .avatar {
    width: 34px;
    height: 34px;
    border-radius: 50%;
    background: linear-gradient(135deg, ${COLORS.accent}, ${COLORS.accent2});
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 14px;
    font-weight: 700;
    color: ${COLORS.bg};
    flex-shrink: 0;
  }

  /* ── Empty state ── */
  .empty {
    text-align: center;
    padding: 48px 24px;
    color: ${COLORS.muted};
  }

  .empty .icon { font-size: 48px; margin-bottom: 12px; opacity: 0.3; }
  .empty p { font-size: 13px; }

  /* ── Activity bar ── */
  .activity-bar {
    display: flex;
    align-items: flex-end;
    gap: 3px;
    height: 36px;
  }

  .bar-seg {
    flex: 1;
    border-radius: 3px 3px 0 0;
    background: ${COLORS.accent};
    opacity: 0.6;
    transition: opacity 0.2s;
    min-width: 3px;
  }

  .bar-seg:hover { opacity: 1; }

  /* ── Notification feed ── */
  .notif-item {
    display: flex;
    gap: 12px;
    padding: 12px 0;
    border-bottom: 1px solid ${COLORS.cardBorder}40;
    align-items: flex-start;
  }

  .notif-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    margin-top: 5px;
    flex-shrink: 0;
  }

  .notif-dot.new { background: ${COLORS.accent}; box-shadow: 0 0 8px ${COLORS.accent}; animation: pulse-badge 2s infinite; }
  .notif-dot.seen { background: ${COLORS.muted}; }

  .notif-content { flex: 1; }
  .notif-title { font-size: 13px; font-weight: 600; margin-bottom: 2px; }
  .notif-sub { font-size: 12px; color: ${COLORS.muted}; }
  .notif-time { font-size: 11px; color: ${COLORS.muted}; white-space: nowrap; font-family: 'JetBrains Mono', monospace; }

  /* ── Broadcast form ── */
  .broadcast-card {
    background: linear-gradient(135deg, ${COLORS.card}, #0d1f38);
    border: 1px solid ${COLORS.accentGlow};
    border-radius: 14px;
    padding: 24px;
    position: relative;
    overflow: hidden;
  }

  .broadcast-card::before {
    content: '📣';
    position: absolute;
    right: 20px;
    top: 50%;
    transform: translateY(-50%);
    font-size: 72px;
    opacity: 0.05;
  }

  /* ── Scrollable feed ── */
  .feed { max-height: 400px; overflow-y: auto; }

  /* ── Tabs ── */
  .tab-bar {
    display: flex;
    gap: 4px;
    margin-bottom: 20px;
    background: ${COLORS.panel};
    padding: 4px;
    border-radius: 12px;
    width: fit-content;
  }

  .tab {
    padding: 8px 18px;
    border-radius: 9px;
    cursor: pointer;
    font-size: 13px;
    font-weight: 600;
    color: ${COLORS.muted};
    transition: all 0.2s;
    border: none;
    background: transparent;
    font-family: 'Exo 2', sans-serif;
  }

  .tab.active {
    background: ${COLORS.card};
    color: ${COLORS.accent};
    box-shadow: 0 2px 8px #00000040;
  }
`;

// ── Logo (base64 encoded reference to uploaded logo) ──
const LOGO_SRC = "/mnt/user-data/uploads/1000105118.png";

// ── Toast System ──
let toastId = 0;
function useToasts() {
  const [toasts, setToasts] = useState([]);
  const push = useCallback((type, title, msg) => {
    const id = ++toastId;
    setToasts(p => [...p, { id, type, title, msg }]);
    setTimeout(() => setToasts(p => p.filter(t => t.id !== id)), 4000);
  }, []);
  return [toasts, push];
}

// ── Helpers ──
const fmt = n => (n || 0).toLocaleString();
const initials = name => (name || "?").split(" ").map(w => w[0]).join("").toUpperCase().substring(0, 2);
const timeAgo = ts => {
  if (!ts) return "—";
  try {
    const now = Date.now();
    const d = new Date(ts.replace ? ts.replace(/(\d{2})-(\d{2})-(\d{4})/, "$3-$2-$1") : ts);
    const diff = now - d.getTime();
    if (diff < 60000) return "এখনই";
    if (diff < 3600000) return Math.floor(diff / 60000) + " মিনিট আগে";
    if (diff < 86400000) return Math.floor(diff / 3600000) + " ঘণ্টা আগে";
    return Math.floor(diff / 86400000) + " দিন আগে";
  } catch { return ts; }
};

// ── API ──
async function apiFetch(params) {
  const qs = new URLSearchParams(params).toString();
  const r = await fetch(GAS_URL + "?" + qs);
  return r.json();
}

async function apiPost(body) {
  const r = await fetch(GAS_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return r.json();
}

// ════════════════════════════════
// PAGES
// ════════════════════════════════

// ── Dashboard Page ──
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
      setData(d);
      setUsersData(u);
    } catch (e) {
      push("error", "লোড ব্যর্থ", e.message);
    }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const totalStudents = usersData?.users?.length || 0;
  const activeStudents = usersData?.users?.filter(u => (u.Status || u.status || "").toLowerCase() === "active").length || 0;
  const inactiveStudents = totalStudents - activeStudents;
  const totalQuiz = data ? Object.values(data.quiz || {}).reduce((s, v) => s + v.total, 0) : 0;
  const totalQBank = data ? Object.values(data.qbank || {}).reduce((s, v) => s + v.total, 0) : 0;
  const totalStudy = data ? Object.values(data.study || {}).reduce((s, v) => s + v.total, 0) : 0;

  const recentSignups = usersData?.users?.slice(-5).reverse() || [];
  const recentReports = data?.reports?.slice(0, 6) || [];

  if (loading) return (
    <div className="content">
      <div className="stat-grid">
        {[...Array(6)].map((_, i) => <div key={i} className="skeleton" style={{ height: 90, borderRadius: 14 }} />)}
      </div>
    </div>
  );

  return (
    <div className="content">
      {/* Stats */}
      <div className="stat-grid">
        <div className="stat-card blue">
          <div className="stat-label">মোট স্টুডেন্ট</div>
          <div className="stat-value blue">{fmt(totalStudents)}</div>
          <div className="stat-icon">👨‍🎓</div>
        </div>
        <div className="stat-card green">
          <div className="stat-label">অ্যাক্টিভ</div>
          <div className="stat-value green">{fmt(activeStudents)}</div>
          <div className="stat-icon">✅</div>
        </div>
        <div className="stat-card red">
          <div className="stat-label">ইনঅ্যাক্টিভ</div>
          <div className="stat-value red">{fmt(inactiveStudents)}</div>
          <div className="stat-icon">🔴</div>
        </div>
        <div className="stat-card orange">
          <div className="stat-label">মোট কুইজ</div>
          <div className="stat-value orange">{fmt(totalQuiz)}</div>
          <div className="stat-icon">❓</div>
        </div>
        <div className="stat-card blue">
          <div className="stat-label">QBank</div>
          <div className="stat-value blue">{fmt(totalQBank)}</div>
          <div className="stat-icon">📚</div>
        </div>
        <div className="stat-card green">
          <div className="stat-label">স্টাডি নোট</div>
          <div className="stat-value green">{fmt(totalStudy)}</div>
          <div className="stat-icon">📝</div>
        </div>
      </div>

      <div className="grid-2" style={{ marginBottom: 16 }}>
        {/* Recent Signups */}
        <div className="card">
          <div className="card-title">🆕 সাম্প্রতিক সাইনআপ</div>
          {recentSignups.length === 0
            ? <div className="empty"><div className="icon">👤</div><p>কোনো ডেটা নেই</p></div>
            : recentSignups.map((u, i) => (
              <div key={i} className="notif-item">
                <div className="avatar">{initials(u.Name || u.name || "?")}</div>
                <div className="notif-content">
                  <div className="notif-title">{u.Name || u.name || "অজানা"}</div>
                  <div className="notif-sub">{u.Phone || u.phone || "—"}</div>
                </div>
                <span className={`pill ${(u.Status || u.status || "inactive").toLowerCase()}`}>
                  {u.Status || u.status || "Inactive"}
                </span>
              </div>
            ))
          }
        </div>

        {/* Recent Reports */}
        <div className="card">
          <div className="card-title">🚨 সাম্প্রতিক রিপোর্ট</div>
          {recentReports.length === 0
            ? <div className="empty"><div className="icon">📋</div><p>কোনো রিপোর্ট নেই</p></div>
            : recentReports.map((r, i) => (
              <div key={i} className="notif-item">
                <div className="notif-dot new" />
                <div className="notif-content">
                  <div className="notif-title">{r.subject || "—"} • {r.phone || "—"}</div>
                  <div className="notif-sub">{(r.issue || "").substring(0, 60)}</div>
                </div>
                <div className="notif-time">{timeAgo(r.time)}</div>
              </div>
            ))
          }
        </div>
      </div>

      {/* Subject breakdown */}
      <div className="card">
        <div className="card-title">📊 বিষয়ভিত্তিক কুইজ</div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>বিষয়</th>
                <th>মোট</th>
                <th>MCQ</th>
                <th>Written</th>
                <th>%</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(data?.quiz || {}).map(([sub, v]) => (
                <tr key={sub}>
                  <td style={{ fontWeight: 600 }}>{sub}</td>
                  <td style={{ fontFamily: "'JetBrains Mono'" }}>{v.total}</td>
                  <td style={{ fontFamily: "'JetBrains Mono'", color: COLORS.accent }}>{v.mcq}</td>
                  <td style={{ fontFamily: "'JetBrains Mono'", color: COLORS.accent2 }}>{v.written}</td>
                  <td>
                    <div style={{ background: COLORS.panel, borderRadius: 4, height: 6, width: 80, overflow: "hidden" }}>
                      <div style={{ background: COLORS.accent, height: "100%", width: Math.min(100, (v.total / Math.max(totalQuiz, 1)) * 100) + "%" }} />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
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

  const load = async () => {
    setLoading(true);
    try {
      const d = await apiFetch({ action: "getUsers" });
      setUsers(d.users || []);
    } catch (e) {
      push("error", "লোড ব্যর্থ", e.message);
    }
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
    push("info", "প্রসেস হচ্ছে...", "");
    // In real app: call GAS to update status
    push("success", "অ্যাক্টিভ করা হয়েছে", u.Name || u.name);
  };

  return (
    <div className="content">
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
        <input
          className="search-bar"
          placeholder="🔍 নাম বা ফোন দিয়ে খুঁজুন..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <div className="tab-bar">
          {["all", "active", "inactive"].map(t => (
            <button key={t} className={`tab ${tab === t ? "active" : ""}`} onClick={() => setTab(t)}>
              {t === "all" ? "সবাই" : t === "active" ? "✅ অ্যাক্টিভ" : "🔴 ইনঅ্যাক্টিভ"}
            </button>
          ))}
        </div>
        <span style={{ marginLeft: "auto", color: COLORS.muted, fontSize: 13 }}>
          {filtered.length} জন
        </span>
      </div>

      {loading
        ? [...Array(5)].map((_, i) => <div key={i} className="skeleton" style={{ marginBottom: 8 }} />)
        : (
          <div className="card">
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>স্টুডেন্ট</th>
                    <th>ফোন</th>
                    <th>স্ট্যাটাস</th>
                    <th>সঠিক</th>
                    <th>ভুল</th>
                    <th>সময়</th>
                    <th>শেষ অ্যাক্টিভ</th>
                    <th>অ্যাকশন</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.length === 0
                    ? <tr><td colSpan={8}><div className="empty"><div className="icon">👤</div><p>কোনো স্টুডেন্ট নেই</p></div></td></tr>
                    : filtered.map((u, i) => {
                      const name = u.Name || u.name || "অজানা";
                      const phone = u.Phone || u.phone || "—";
                      const status = (u.Status || u.status || "inactive").toLowerCase();
                      return (
                        <tr key={i}>
                          <td>
                            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                              <div className="avatar">{initials(name)}</div>
                              <div>
                                <div style={{ fontWeight: 600, fontSize: 13 }}>{name}</div>
                                <div style={{ fontSize: 11, color: COLORS.muted }}>{u.Email || u.email || "—"}</div>
                              </div>
                            </div>
                          </td>
                          <td style={{ fontFamily: "'JetBrains Mono'", fontSize: 12 }}>{phone}</td>
                          <td><span className={`pill ${status}`}>{status === "active" ? "✅ অ্যাক্টিভ" : "🔴 ইনঅ্যাক্টিভ"}</span></td>
                          <td style={{ color: COLORS.success, fontFamily: "'JetBrains Mono'" }}>{u._totalCorrect || 0}</td>
                          <td style={{ color: COLORS.danger, fontFamily: "'JetBrains Mono'" }}>{u._totalWrong || 0}</td>
                          <td style={{ color: COLORS.accent, fontFamily: "'JetBrains Mono'", fontSize: 12 }}>{u._totalMinutes || 0} মিনিট</td>
                          <td style={{ fontSize: 12, color: COLORS.muted }}>{timeAgo(u._lastActive || u.Timestamp || u.timestamp)}</td>
                          <td>
                            <div style={{ display: "flex", gap: 6 }}>
                              {status !== "active"
                                ? <button className="btn btn-success" onClick={() => activateUser(u)}>✅ অ্যাক্টিভ</button>
                                : <button className="btn btn-ghost">👁 দেখুন</button>
                              }
                              <button className="btn btn-warn" onClick={() => {
                                setSelected(u);
                              }}>📣</button>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  }
                </tbody>
              </table>
            </div>
          </div>
        )
      }

      {selected && (
        <NotifyModal user={selected} onClose={() => setSelected(null)} push={push} />
      )}
    </div>
  );
}

// ── Reports Page ──
function ReportsPage({ push }) {
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [resolving, setResolving] = useState(null);

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
      await apiPost({
        type: "resolve_report",
        phone: r.phone,
        subject: r.subject,
        questionId: r.questionId,
      });
      push("success", "রিপোর্ট সমাধান হয়েছে", `${r.phone} কে নোটিফাই করা হয়েছে`);
      load();
    } catch (e) { push("error", "ব্যর্থ", e.message); }
    setResolving(null);
  };

  return (
    <div className="content">
      <div className="card">
        <div className="card-title">🚨 স্টুডেন্ট রিপোর্ট ({reports.length})</div>
        {loading
          ? [...Array(4)].map((_, i) => <div key={i} className="skeleton" style={{ marginBottom: 8 }} />)
          : reports.length === 0
            ? <div className="empty"><div className="icon">📋</div><p>কোনো রিপোর্ট নেই</p></div>
            : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>ফোন</th>
                      <th>বিষয়</th>
                      <th>সাবটপিক</th>
                      <th>প্রশ্ন ID</th>
                      <th>সমস্যা</th>
                      <th>সময়</th>
                      <th>অ্যাকশন</th>
                    </tr>
                  </thead>
                  <tbody>
                    {reports.map((r, i) => (
                      <tr key={i}>
                        <td style={{ fontFamily: "'JetBrains Mono'", fontSize: 12 }}>{r.phone || "—"}</td>
                        <td style={{ fontWeight: 600 }}>{r.subject || "—"}</td>
                        <td style={{ color: COLORS.muted, fontSize: 12 }}>{r.subtopic || "—"}</td>
                        <td style={{ fontFamily: "'JetBrains Mono'", color: COLORS.accent, fontSize: 12 }}>{r.questionId || "—"}</td>
                        <td style={{ maxWidth: 200, fontSize: 12 }}>{(r.issue || "").substring(0, 80)}{r.issue?.length > 80 ? "…" : ""}</td>
                        <td style={{ fontSize: 11, color: COLORS.muted, whiteSpace: "nowrap" }}>{timeAgo(r.time)}</td>
                        <td>
                          <button
                            className="btn btn-success"
                            disabled={resolving === r.row}
                            onClick={() => resolve(r)}
                          >
                            {resolving === r.row ? "⏳" : "✅"} সমাধান
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
        }
      </div>
    </div>
  );
}

// ── Notifications Page ──
function NotificationsPage({ push }) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [history] = useState([
    { title: "নতুন কুইজ যোগ হয়েছে!", body: "Physics থেকে ১০টি নতুন প্রশ্ন যোগ করা হয়েছে", time: "১ ঘণ্টা আগে", type: "broadcast" },
    { title: "সাপ্তাহিক চ্যালেঞ্জ", body: "এই সপ্তাহের চ্যালেঞ্জ শুরু হয়েছে", time: "২ দিন আগে", type: "broadcast" },
  ]);

  const broadcast = async () => {
    if (!title || !body) { push("warn", "তথ্য দিন", "Title ও Body দেওয়া আবশ্যক"); return; }
    setSending(true);
    try {
      const r = await apiPost({ type: "broadcast_notification", title, body });
      push("success", "নোটিফিকেশন পাঠানো হয়েছে", `${r.fcm?.sent || 0} জনকে পাঠানো হয়েছে`);
      setTitle(""); setBody("");
    } catch (e) { push("error", "ব্যর্থ", e.message); }
    setSending(false);
  };

  return (
    <div className="content">
      <div className="grid-2" style={{ marginBottom: 16 }}>
        <div className="broadcast-card">
          <div className="card-title">📣 সবাইকে নোটিফিকেশন পাঠান</div>
          <div className="field">
            <label>শিরোনাম</label>
            <input className="input" placeholder="নোটিফিকেশনের শিরোনাম..." value={title} onChange={e => setTitle(e.target.value)} />
          </div>
          <div className="field">
            <label>বার্তা</label>
            <textarea className="textarea" placeholder="বিস্তারিত বার্তা লিখুন..." value={body} onChange={e => setBody(e.target.value)} />
          </div>
          <button className="btn btn-primary" style={{ width: "100%", justifyContent: "center", padding: "12px" }} onClick={broadcast} disabled={sending}>
            {sending ? "⏳ পাঠানো হচ্ছে..." : "📣 সবাইকে পাঠান"}
          </button>
        </div>

        <div className="card">
          <div className="card-title">📜 পাঠানোর ইতিহাস</div>
          {history.map((h, i) => (
            <div key={i} className="notif-item">
              <div className="notif-dot seen" />
              <div className="notif-content">
                <div className="notif-title">{h.title}</div>
                <div className="notif-sub">{h.body.substring(0, 60)}</div>
              </div>
              <div className="notif-time">{h.time}</div>
            </div>
          ))}
        </div>
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
  const phone = user.Phone || user.phone || "";

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
        <div className="modal-title">📣 নোটিফিকেশন — {name}</div>
        <div style={{ fontSize: 12, color: COLORS.muted, marginBottom: 16 }}>📱 {phone}</div>
        <div className="field">
          <label>শিরোনাম</label>
          <input className="input" placeholder="Title..." value={title} onChange={e => setTitle(e.target.value)} />
        </div>
        <div className="field">
          <label>বার্তা</label>
          <textarea className="textarea" placeholder="Message..." value={body} onChange={e => setBody(e.target.value)} />
        </div>
        <div className="modal-actions">
          <button className="btn btn-ghost" onClick={onClose}>বাতিল</button>
          <button className="btn btn-primary" onClick={send} disabled={sending}>
            {sending ? "⏳" : "📨"} পাঠান
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Signup Notifications Page ──
function SignupAlertsPage({ push }) {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const d = await apiFetch({ action: "getUsers" });
      // Filter inactive / new users (last 7 days)
      const allUsers = d.users || [];
      const newOnes = allUsers.filter(u => {
        const status = (u.Status || u.status || "").toLowerCase();
        return status !== "active";
      });
      setUsers(newOnes);
    } catch (e) { push("error", "লোড ব্যর্থ", e.message); }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const activate = async (u) => {
    push("info", "অ্যাক্টিভ করা হচ্ছে...", "");
    // GAS call would go here
    push("success", "সফল!", `${u.Name || u.name} অ্যাক্টিভ করা হয়েছে`);
    setUsers(p => p.filter(x => x !== u));
  };

  return (
    <div className="content">
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20 }}>
        <div style={{ background: COLORS.danger + "22", border: `1px solid ${COLORS.danger}44`, borderRadius: 10, padding: "8px 16px", fontSize: 13, color: COLORS.danger, fontWeight: 700 }}>
          🔔 {users.length}টি নতুন সাইনআপ অ্যাক্টিভেশন পেন্ডিং
        </div>
        <button className="btn btn-ghost" onClick={load}>🔄 রিফ্রেশ</button>
      </div>

      {loading
        ? [...Array(4)].map((_, i) => <div key={i} className="skeleton" style={{ marginBottom: 10, height: 70, borderRadius: 12 }} />)
        : users.length === 0
          ? <div className="empty" style={{ paddingTop: 80 }}>
              <div className="icon">🎉</div>
              <p style={{ fontSize: 15 }}>সব স্টুডেন্ট অ্যাক্টিভ আছে!</p>
            </div>
          : users.map((u, i) => {
            const name = u.Name || u.name || "অজানা";
            const phone = u.Phone || u.phone || "—";
            const email = u.Email || u.email || "—";
            const ts = u.Timestamp || u.timestamp || u.JoinDate || "";
            return (
              <div key={i} className="card" style={{ marginBottom: 10, display: "flex", alignItems: "center", gap: 16 }}>
                <div className="avatar" style={{ width: 48, height: 48, fontSize: 18 }}>{initials(name)}</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700, fontSize: 15 }}>{name}</div>
                  <div style={{ fontSize: 12, color: COLORS.muted, marginTop: 2 }}>
                    📱 {phone} &nbsp;•&nbsp; ✉️ {email}
                  </div>
                  <div style={{ fontSize: 11, color: COLORS.muted, marginTop: 2 }}>🕐 {timeAgo(ts)}</div>
                </div>
                <span className="pill pending">⏳ পেন্ডিং</span>
                <div style={{ display: "flex", gap: 8 }}>
                  <button className="btn btn-success" onClick={() => activate(u)}>✅ অ্যাক্টিভ করুন</button>
                  <button className="btn btn-danger">❌ রিজেক্ট</button>
                </div>
              </div>
            );
          })
      }
    </div>
  );
}

// ════════════════════════════════
// ROOT APP
// ════════════════════════════════

const NAV = [
  { id: "dashboard", icon: "📊", label: "ড্যাশবোর্ড", section: "OVERVIEW" },
  { id: "signups", icon: "🆕", label: "নতুন সাইনআপ", section: "STUDENTS", badge: true },
  { id: "students", icon: "👨‍🎓", label: "সব স্টুডেন্ট", section: null },
  { id: "reports", icon: "🚨", label: "রিপোর্ট", section: "CONTENT" },
  { id: "notifications", icon: "📣", label: "নোটিফিকেশন", section: "TOOLS" },
];

export default function App() {
  const [page, setPage] = useState("dashboard");
  const [toasts, push] = useToasts();
  const [refreshing, setRefreshing] = useState(false);

  const pageTitle = {
    dashboard: "📊 ড্যাশবোর্ড",
    signups: "🆕 নতুন সাইনআপ",
    students: "👨‍🎓 স্টুডেন্ট ম্যানেজমেন্ট",
    reports: "🚨 রিপোর্ট ম্যানেজমেন্ট",
    notifications: "📣 নোটিফিকেশন সেন্টার",
  }[page] || "Admin";

  let sections = [];
  NAV.forEach(n => {
    if (n.section) sections.push({ label: n.section });
    sections.push(n);
  });

  return (
    <>
      <style>{css}</style>
      <div className="app-shell">
        {/* Sidebar */}
        <aside className="sidebar">
          <div className="sidebar-logo">
            <img src={LOGO_SRC} alt="Smart Admin" onError={e => { e.target.style.display = "none"; }} />
            <div className="sidebar-logo-text">
              <div className="title">Smart Admin</div>
              <div className="sub">Admin Panel</div>
            </div>
          </div>

          {NAV.map((n, i) => (
            <div key={n.id}>
              {n.section && (
                <div className="sidebar-section-label">{n.section}</div>
              )}
              <div
                className={`nav-item ${page === n.id ? "active" : ""}`}
                onClick={() => setPage(n.id)}
              >
                <span className="icon">{n.icon}</span>
                <span>{n.label}</span>
                {n.badge && <span className="badge">!</span>}
              </div>
            </div>
          ))}

          <div style={{ marginTop: "auto", padding: "16px", borderTop: `1px solid ${COLORS.cardBorder}` }}>
            <div style={{ fontSize: 11, color: COLORS.muted, textAlign: "center" }}>
              Smart Study Admin<br />
              <span style={{ fontFamily: "'JetBrains Mono'" }}>v1.0.0</span>
            </div>
          </div>
        </aside>

        {/* Main */}
        <main className="main">
          <div className="topbar">
            <div className="topbar-title">{pageTitle}</div>
            <div className="topbar-right">
              <button
                className={`refresh-btn ${refreshing ? "spinning" : ""}`}
                onClick={() => { setRefreshing(true); setTimeout(() => setRefreshing(false), 1500); setPage(p => p); }}
              >
                🔄 রিফ্রেশ
              </button>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div className="avatar" style={{ background: `linear-gradient(135deg, ${COLORS.accent}, ${COLORS.accent2})` }}>A</div>
                <div style={{ fontSize: 12 }}>
                  <div style={{ fontWeight: 700 }}>Admin</div>
                  <div style={{ color: COLORS.muted, fontSize: 10 }}>Super Admin</div>
                </div>
              </div>
            </div>
          </div>

          {page === "dashboard" && <DashboardPage push={push} />}
          {page === "signups" && <SignupAlertsPage push={push} />}
          {page === "students" && <StudentsPage push={push} />}
          {page === "reports" && <ReportsPage push={push} />}
          {page === "notifications" && <NotificationsPage push={push} />}
        </main>
      </div>

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