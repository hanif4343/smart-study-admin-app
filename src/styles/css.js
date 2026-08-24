/* ══════════ CSS ══════════ */
import { C, tint } from "../core/config.js";
import { themeCssBlock } from "../core/theme.js";

const css=`
${themeCssBlock()}
@import url('https://fonts.googleapis.com/css2?family=Noto+Sans+Bengali:wght@400;500;600;700&family=Space+Grotesk:wght@400;500;600;700&display=swap');
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
html,body,#root{background:${C.bg};color:${C.text};font-family:'Noto Sans Bengali','Space Grotesk',sans-serif;min-height:100dvh;max-width:480px;margin:0 auto;overflow-x:hidden;transition:background-color .2s,color .2s}
::-webkit-scrollbar{width:3px}::-webkit-scrollbar-thumb{background:${C.border};border-radius:10px}
.bottom-nav{position:fixed;bottom:0;left:50%;transform:translateX(-50%);width:100%;max-width:480px;background:${C.navBg};border-top:1px solid ${C.border};display:flex;z-index:100;padding-bottom:env(safe-area-inset-bottom,8px)}
.nav-btn{flex:1;display:flex;flex-direction:column;align-items:center;gap:2px;padding:8px 2px 6px;cursor:pointer;border:none;background:transparent;color:${C.muted};font-family:inherit;font-size:9px;font-weight:500;transition:color .15s;position:relative}
.nav-btn.active{color:${C.accent}}.nav-icon{font-size:18px;line-height:1}
.nav-badge{position:absolute;top:5px;right:calc(50% - 16px);background:${C.red};color:#fff;font-size:8px;font-weight:700;width:14px;height:14px;border-radius:50%;display:flex;align-items:center;justify-content:center}
.nav-dot{position:absolute;bottom:-2px;right:-5px;width:6px;height:6px;border-radius:50%;background:${C.info};box-shadow:0 0 0 2px ${C.navBg}}
.topbar{background:${C.card};border-bottom:1px solid ${C.border};padding:14px 16px 12px;display:flex;align-items:center;justify-content:space-between;position:sticky;top:0;z-index:50}
.topbar-title{font-size:15px;font-weight:700}.topbar-sub{font-size:10px;color:${C.muted};margin-top:1px}
.icon-btn{width:34px;height:34px;border-radius:9px;background:${C.panel};border:1px solid ${C.border};color:${C.text};font-size:16px;display:flex;align-items:center;justify-content:center;cursor:pointer}
.icon-btn.spin{animation:spin 1s linear infinite}
.page{padding:16px;padding-bottom:88px;min-height:100dvh}
.sg{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px}
.sc{background:${C.card};border:1px solid ${C.border};border-radius:14px;padding:14px;position:relative;overflow:hidden}
.sc::after{content:attr(data-icon);position:absolute;right:8px;bottom:6px;font-size:24px;opacity:.12}
.sl{font-size:10px;color:${C.muted};font-weight:600;margin-bottom:4px;text-transform:uppercase;letter-spacing:.5px}
.sv{font-size:24px;font-weight:700;line-height:1}
.sv-b{color:${C.accent}}.sv-g{color:${C.green}}.sv-r{color:${C.red}}.sv-y{color:${C.yellow}}.sv-p{color:${C.purple}}
.tb{border-top:2px solid ${C.accent}}.tg{border-top:2px solid ${C.green}}.tr{border-top:2px solid ${C.red}}.ty{border-top:2px solid ${C.yellow}}.tp{border-top:2px solid ${C.purple}}
.card{background:${C.card};border:1px solid ${C.border};border-radius:14px;padding:16px;margin-bottom:12px}
.ct{font-size:11px;font-weight:700;color:${C.muted};text-transform:uppercase;letter-spacing:.8px;margin-bottom:11px}
.av{width:38px;height:38px;border-radius:50%;background:linear-gradient(135deg,${C.accent},${C.purple});display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;color:#fff;flex-shrink:0}
.av.sm{width:30px;height:30px;font-size:11px}
.pill{display:inline-flex;align-items:center;padding:2px 8px;border-radius:20px;font-size:10px;font-weight:700;white-space:nowrap;flex-shrink:0}
.pa{background:#22c55e18;color:${C.green};border:1px solid #22c55e33}
.pi{background:#ef444418;color:${C.red};border:1px solid #ef444433}
.pp{background:#f59e0b18;color:${C.yellow};border:1px solid #f59e0b33}
.btn{display:inline-flex;align-items:center;gap:4px;padding:7px 12px;border-radius:9px;font-size:12px;font-weight:600;font-family:inherit;cursor:pointer;border:none;transition:all .15s;white-space:nowrap}
.btn:active{transform:scale(.96)}.btn:disabled{opacity:.45;pointer-events:none}
.bp{background:${C.accent};color:#fff}.bs{background:#22c55e20;color:${C.green};border:1px solid #22c55e40}
.bg{background:transparent;color:${C.muted};border:1px solid ${C.border}}.bg:hover{background:${C.border};color:${C.text}}
.bb{width:100%;justify-content:center;padding:10px}
.inp,.ta{background:${C.panel};border:1px solid ${C.border};border-radius:9px;padding:9px 12px;color:${C.text};font-family:inherit;font-size:13px;width:100%;outline:none;transition:border-color .2s;-webkit-appearance:none}
.inp:focus,.ta:focus{border-color:${C.accent}}.inp::placeholder,.ta::placeholder{color:${C.muted}}
.ta{resize:vertical;min-height:75px}.fld{margin-bottom:10px}
.fld label{display:block;font-size:10px;font-weight:700;color:${C.muted};letter-spacing:.8px;margin-bottom:4px;text-transform:uppercase}
.sw{position:relative;margin-bottom:10px}.sw .si{position:absolute;left:10px;top:50%;transform:translateY(-50%);font-size:14px;pointer-events:none}.sw .inp{padding-left:32px}
/* 🎨 Students List রিডিজাইন — কার্ডের বদলে একরঙা বামবার-সহ সরু সারি, কোনো বাটন নেই,
   পুরো সারিই ট্যাপযোগ্য (List=শুধু খোঁজা/চোখ বুলানো, Detail=সব অ্যাকশনের একমাত্র জায়গা) */
.stu-row{width:100%;display:flex;align-items:center;gap:10px;background:${C.card};border:1px solid ${C.border};border-left:3px solid;border-radius:11px;padding:9px 10px;margin-bottom:7px;text-align:left;cursor:pointer;font-family:inherit;transition:transform .12s;color:inherit}
.stu-row:active{transform:scale(.98)}
.stu-row .stu-av{flex-shrink:0}
.stu-info{flex:1;min-width:0}
.stu-name{font-size:13px;font-weight:700;color:${C.text};overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.stu-phone{font-size:10.5px;color:${C.muted};margin-top:1px}
.stu-acc{font-size:14px;font-weight:800;flex-shrink:0}
.stu-chev{color:${C.muted};font-size:14px;flex-shrink:0}
/* 🎨 StudentDetail অ্যাকশন-বার — Edit/Notify/Activate সমান গুরুত্বে একসাথে */
.stu-actionbar{display:flex;background:${C.panel};border:1px solid ${C.border};border-radius:12px;padding:4px;margin:12px 0}
.stu-actionbar button{flex:1;text-align:center;padding:9px 2px;border-radius:9px;font-size:11.5px;font-weight:700;color:${C.text};background:transparent;border:none;cursor:pointer;font-family:inherit}
.stu-actionbar button:not(:last-child){border-right:1px solid ${C.border}}
.stu-actionbar button:disabled{opacity:.5}
.stu-actionbar .ic{display:block;font-size:15px;margin-bottom:2px}
/* 🎨 Delete — সবার নিচে আলাদা "বিপজ্জনক এলাকা", বাকি সব থেকে দূরে */
.stu-danger{background:${tint(C.red,"10")};border:1px solid ${tint(C.red,"40")};border-radius:14px;padding:13px;margin-top:18px}
.stu-danger .t{font-size:11.5px;font-weight:800;color:${C.red};margin-bottom:4px}
.stu-danger .d{font-size:10px;color:${C.muted};margin-bottom:10px;line-height:1.5}
.stu-danger button{width:100%;padding:9px;border-radius:9px;background:transparent;border:1.5px solid ${C.red};color:${C.red};font-size:11.5px;font-weight:700;cursor:pointer;font-family:inherit}
.ftabs{display:flex;gap:5px;margin-bottom:11px;overflow-x:auto;padding-bottom:2px;scrollbar-width:none}.ftabs::-webkit-scrollbar{display:none}
.ftab{flex-shrink:0;padding:6px 12px;border-radius:20px;font-size:11px;font-weight:600;cursor:pointer;border:1px solid ${C.border};background:transparent;color:${C.muted};font-family:inherit;transition:all .15s}
.ftab.on{background:${C.accent};color:#fff;border-color:${C.accent}}
.rc{background:${C.panel};border:1px solid ${C.border};border-radius:11px;padding:11px;margin-bottom:8px}
.ri{font-size:12px;color:${C.text};line-height:1.5;background:${C.card};border-radius:7px;padding:7px 9px;margin-top:7px;border-left:2px solid ${C.red}}
.rm{font-size:10px;color:${C.muted};margin-top:4px;display:flex;gap:6px;flex-wrap:wrap}
.ovl{position:fixed;inset:0;background:#00000094;z-index:200;display:flex;align-items:flex-end}
.modal{background:${C.card};border:1px solid ${C.border};border-radius:20px 20px 0 0;padding:16px 16px 36px;width:100%;max-height:88dvh;overflow-y:auto;animation:su .22s ease}
.mh{width:32px;height:4px;background:${C.border};border-radius:4px;margin:0 auto 13px}
.mt{font-size:15px;font-weight:700;margin-bottom:13px}
.fs{position:fixed;inset:0;background:${C.bg};z-index:150;overflow-y:auto}
.fsh{background:${C.card};border-bottom:1px solid ${C.border};padding:12px 14px;display:flex;align-items:center;gap:11px;position:sticky;top:0;z-index:10}
.bk{width:32px;height:32px;border-radius:8px;background:${C.panel};border:1px solid ${C.border};color:${C.text};font-size:15px;display:flex;align-items:center;justify-content:center;cursor:pointer;flex-shrink:0}
.sk{background:linear-gradient(90deg,${C.border},#1a2840,${C.border});background-size:200% 100%;animation:shim 1.4s infinite;border-radius:9px;height:64px;margin-bottom:8px}
.empty{text-align:center;padding:40px 20px;color:${C.muted}}.ei{font-size:36px;margin-bottom:8px;opacity:.25}
.toasts{position:fixed;top:13px;left:50%;transform:translateX(-50%);width:calc(100% - 26px);max-width:440px;z-index:999;display:flex;flex-direction:column;gap:6px;pointer-events:none}
.toast{background:${C.card};border:1px solid ${C.border};border-radius:11px;padding:10px 12px;display:flex;gap:8px;align-items:flex-start;animation:ti .25s ease;box-shadow:0 8px 28px #00000080;pointer-events:all}
.toast.success{border-left:3px solid ${C.green}}.toast.error{border-left:3px solid ${C.red}}.toast.warn{border-left:3px solid ${C.yellow}}.toast.info{border-left:3px solid ${C.accent}}
.t-icon{font-size:16px}.t-body{flex:1}.t-title{font-size:12px;font-weight:700}.t-msg{font-size:11px;color:${C.muted};margin-top:1px}
.atabs{display:flex;background:${C.panel};border-radius:11px;padding:4px;margin-bottom:12px;gap:3px}

/* ══ launcher grid — শেয়ার্ড কম্পোনেন্ট (components/shared/LauncherGrid.jsx)
   Uploader hub (Phase ৪) ও Content Manager-এর Tools শিট (Phase ৫) দুটোতেই এই একই ক্লাসগুলো ব্যবহার হয় ══ */
.launch-search{display:flex;align-items:center;gap:8px;background:${C.panel};border:1px solid ${C.border};border-radius:11px;padding:10px 13px;margin-bottom:14px}
.launch-search input{flex:1;background:transparent;border:none;outline:none;color:${C.text};font-family:inherit;font-size:12.5px}
.launch-search input::placeholder{color:${C.muted}}
.launch-search-clear{cursor:pointer;color:${C.muted};font-size:12px;padding:2px 4px}
.launch-empty{text-align:center;padding:24px 10px;color:${C.muted};font-size:12.5px}
.launch-sec{margin-bottom:18px}
.launch-sec:last-child{margin-bottom:0}
.launch-sec-head{display:flex;align-items:center;gap:8px;margin-bottom:9px}
.launch-sec-dot{width:7px;height:7px;border-radius:50%;flex-shrink:0}
.launch-sec-title{font-size:11.5px;font-weight:800;color:${C.text}}
.launch-sec-sub{font-size:9.5px;color:${C.muted};margin-left:auto;background:${C.panel};padding:1px 8px;border-radius:20px}
.launch-row{width:100%;display:flex;align-items:center;gap:11px;background:${C.card};border:1px solid ${C.border};border-left:3px solid;border-radius:11px;padding:11px 12px;margin-bottom:7px;text-align:left;cursor:pointer;font-family:inherit;transition:transform .12s;color:inherit}
.launch-row:active{transform:scale(.98)}
.launch-row .lr-ic{width:32px;height:32px;border-radius:9px;display:flex;align-items:center;justify-content:center;font-size:16px;flex-shrink:0}
.launch-row .lr-txt{flex:1;min-width:0}
.launch-row .lr-label{font-size:12.5px;font-weight:700;color:${C.text}}
.launch-row .lr-desc{font-size:10px;color:${C.muted};margin-top:1px}
.launch-row .lr-chev{color:${C.muted};font-size:15px;flex-shrink:0}

/* ══ ছোট ইউটিলিটি — Content Manager-এর Browse(primary)/Tools(secondary) স্প্লিটে ব্যবহৃত (Phase ৫) ══ */
.tools-btn{display:inline-flex;align-items:center;gap:6px;background:${C.panel};border:1px solid ${C.border};border-radius:20px;padding:7px 14px;font-size:11.5px;font-weight:700;color:${C.text};cursor:pointer;font-family:inherit}
.sub-head{display:flex;align-items:center;gap:8px;margin-bottom:16px}
.sub-head-title{font-size:14px;font-weight:700;color:${C.text}}
.atab{flex:1;text-align:center;padding:7px 3px;border-radius:7px;font-size:11px;font-weight:600;cursor:pointer;border:none;background:transparent;color:${C.muted};font-family:inherit;transition:all .2s}
.atab.on{background:${C.card};color:${C.text};box-shadow:0 2px 6px #00000040}
.srow{display:flex;align-items:center;justify-content:space-between;padding:8px 0;border-bottom:1px solid ${C.border}40;font-size:12px}.srow:last-child{border-bottom:none}
.sbar{height:3px;border-radius:3px;background:${C.border};flex:1;margin:3px 6px 0 0;overflow:hidden}.sbar-f{height:100%;border-radius:3px;transition:width .6s ease}
.slb{font-size:10px;font-weight:700;color:${C.muted};letter-spacing:1.2px;text-transform:uppercase;margin:14px 0 8px}
.nr{display:flex;gap:8px;align-items:flex-start;padding:9px 0;border-bottom:1px solid ${C.border}40}.nr:last-child{border-bottom:none}
.nd{width:7px;height:7px;border-radius:50%;margin-top:4px;flex-shrink:0}.nd.n{background:${C.accent}}.nd.o{background:${C.muted}}
.nc{flex:1}.nt{font-size:12px;font-weight:600}.ns{font-size:11px;color:${C.muted};margin-top:1px}.ntm{font-size:10px;color:${C.muted};white-space:nowrap}
.steps{display:flex;margin-bottom:16px}.step{flex:1;text-align:center;font-size:10px;font-weight:700;padding:5px 2px;border-bottom:2px solid ${C.border};color:${C.muted};transition:all .2s}
.step.done{border-color:${C.green};color:${C.green}}.step.act{border-color:${C.accent};color:${C.accent}}
.bc{display:flex;align-items:flex-end;gap:2px;height:64px;margin-top:5px}
.bcol{display:flex;flex-direction:column;align-items:center;flex:1;gap:2px}
.brect{width:100%;border-radius:3px 3px 0 0;min-height:2px}.blbl{font-size:7px;color:${C.muted};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:26px;text-align:center}
.sri{display:flex;align-items:center;gap:9px;padding:9px;background:${C.panel};border:1px solid ${C.border};border-radius:10px;margin-bottom:6px;cursor:pointer;transition:border-color .15s}.sri:hover{border-color:${C.accent}}
.stag{font-size:9px;font-weight:700;padding:2px 6px;border-radius:7px;background:${C.accent}20;color:${C.accent};flex-shrink:0}
.rw{position:relative;width:68px;height:68px;flex-shrink:0}.rw svg{transform:rotate(-90deg)}
.rpct{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700}
.tp2{padding:6px 14px;border-radius:20px;font-size:11px;font-weight:700;cursor:pointer;border:1px solid ${C.border};background:transparent;color:${C.muted};font-family:inherit;transition:all .15s;flex-shrink:0}
.tp2.on{background:${C.accent};color:#fff;border-color:${C.accent}}
.cc{padding:4px 10px;border-radius:8px;font-size:11px;font-weight:700;cursor:pointer;border:1px solid ${C.border};background:transparent;color:${C.muted};font-family:inherit;transition:all .15s;white-space:nowrap}
.cc.on{background:${C.green}20;color:${C.green};border-color:${C.green}40}
.qcard{background:${C.panel};border:1px solid ${C.border};border-radius:11px;padding:11px;margin-bottom:8px}
.qcard-q{font-size:12px;font-weight:600;line-height:1.5;margin-bottom:7px;color:${C.text}}
.qcard-meta{display:flex;gap:5px;flex-wrap:wrap;align-items:center}
.qtag{font-size:9px;font-weight:700;padding:2px 7px;border-radius:6px;white-space:nowrap}
.qtag-mcq{background:${C.accent}20;color:${C.accent};border:1px solid ${C.accent}30}
.qtag-wr{background:${C.purple}20;color:${C.purple};border:1px solid ${C.purple}30}
.qtag-sub{background:${C.green}15;color:${C.green};border:1px solid ${C.green}25}
.qtag-tp{background:${C.yellow}15;color:${C.yellow};border:1px solid ${C.yellow}25}
.rename-row{display:flex;align-items:center;gap:8px;padding:10px;background:${C.panel};border:1px solid ${C.border};border-radius:10px;margin-bottom:7px}
.rename-name{flex:1;font-size:12px;font-weight:600}
.rename-count{font-size:10px;color:${C.muted};white-space:nowrap}
@keyframes spin{to{transform:rotate(360deg)}}
@keyframes su{from{transform:translateY(36px);opacity:0}to{transform:translateY(0);opacity:1}}
@keyframes shim{0%{background-position:-200% 0}100%{background-position:200% 0}}
@keyframes ti{from{transform:translateY(-16px);opacity:0}to{transform:translateY(0);opacity:1}}
@keyframes bgm-pulse{0%,100%{box-shadow:0 0 0 0 #3b82f644}50%{box-shadow:0 0 0 5px #3b82f611}}
@keyframes bgm-dot{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.4;transform:scale(.7)}}
`;


export { css };
