/* ══════════════════════════════════════════════════════════════════════════════════════
   TOPIC MANAGER — টপিকের তালিকা (প্রশ্নসংখ্যাসহ) · মার্জ · অপ্রয়োজনীয় টপিক মোছা · Undo
   ──────────────────────────────────────────────────────────────────────────────────────
   নির্ভরতা: code_updated.gs-এর helper (qHeader_, qY_, Q_UNIFIED_SHEET_, markTopicsDirty,
   qRefreshTopicCounts_, markReindexNeeded_, withWriteLock, logError_) — একই প্রজেক্টে থাকতে হবে।
   AutoClassify.gs-এর মতোই HTTP থেকে ঢোকে: action/type = tm_*  (ac_handleAction_-এর পাশে tm_handleAction_)।

   Actions:
     tm_getTopics    → সব টপিক + প্রশ্নসংখ্যা (total/QBank/Quiz/Study/রুল) + হেলথ (খালি/অচেনা topic_id)। কিছু বদলায় না।
     tm_mergePreview → মার্জের আগের হিসাব (কোনটা কোথায় যাবে, কয়টা প্রশ্ন)। কিছু বদলায় না।
     tm_merge        → sourceIds[] → targetId-এ মার্জ (newName ঐচ্ছিক)। একই সাবজেক্টের টপিক ছাড়া মার্জ হয় না।
     tm_deleteEmpty  → শুধু যেসব টপিকে Questions+Study-তে ০টা প্রশ্ন, সেগুলো মোছে (সার্ভারে আবার যাচাই করে)।
     tm_getLog       → শেষ কয়েকটা মার্জ/ডিলিটের তালিকা।
     tm_undo         → সর্বশেষ (এখনো-Undo-না-হওয়া) মার্জ/ডিলিট ফেরত।

   সুরক্ষা: (১) বদলানোর আগে লগ লেখা হয় — মাঝপথে থামলেও Undo চলে  (২) প্রশ্ন কখনো মোছা হয় না, শুধু topic_id/sub_topic বদলায়
            (৩) শেষে আগে-পরের মোট প্রশ্নসংখ্যা মিলিয়ে ফেরত দেয়  (৪) লক-এর ভেতরে চলে।
   ══════════════════════════════════════════════════════════════════════════════════════ */

var TM_RULES_SHEET_ = "TopicRules";
var TM_LOG_SHEET_   = "_TopicManager_Log";
var TM_LOG_HDR_     = ["log_id", "seq", "time", "kind", "undone", "summary", "payload"];
var TM_CHUNK_       = 30000;

/* ───────────── ছোট helper ───────────── */
function tm_s_(v) { return String(v == null ? "" : v).trim(); }
function tm_arr_(v) {
  if (Array.isArray(v)) return v.map(tm_s_).filter(function (x) { return x; });
  return tm_s_(v).split(",").map(tm_s_).filter(function (x) { return x; });
}
function tm_list_(s) { return tm_s_(s).split(/\s*[,，;]\s*/).filter(function (x) { return x; }); }
function tm_union_(lists) {
  var seen = {}, out = [];
  lists.forEach(function (l) { l.forEach(function (x) { var k = x.toLowerCase(); if (!seen[k]) { seen[k] = 1; out.push(x); } }); });
  return out;
}
function tm_table_(sh) {
  if (!sh) return { hdr: [], rows: [], lc: 0 };
  var lc = sh.getLastColumn(), lr = sh.getLastRow();
  if (lc < 1 || lr < 1) return { hdr: [], rows: [], lc: 0 };
  var hdr = sh.getRange(1, 1, 1, lc).getValues()[0].map(tm_s_);
  var rows = lr > 1 ? sh.getRange(2, 1, lr - 1, lc).getValues() : [];
  return { hdr: hdr, rows: rows, lc: lc };
}
function tm_pad_(row, lc) { var r = row.slice(0, lc); while (r.length < lc) r.push(""); return r; }

/* ───────────── গণনা: Questions + Study ───────────── */
function tm_counts_(ss, knownIds) {
  var res = { q: {}, st: {}, blankQ: 0, orphanQ: 0, blankSt: 0, orphanSt: 0, orphanIds: {}, blankQIds: [] };
  var q = ss.getSheetByName(Q_UNIFIED_SHEET_);
  if (q && q.getLastRow() > 1) {
    var H = qHeader_(q), ix = H.idx, n = q.getLastRow() - 1;
    var cT = ix["topicid"], cId = ix["id"];
    if (cT === undefined || cId === undefined) throw new Error("Questions শিটে id/topic_id কলাম নেই");
    var ids = q.getRange(2, cId + 1, n, 1).getValues();
    var tv = q.getRange(2, cT + 1, n, 1).getValues();
    var iq = ix["inquiz"] !== undefined ? q.getRange(2, ix["inquiz"] + 1, n, 1).getValues() : null;
    var ib = ix["inqbank"] !== undefined ? q.getRange(2, ix["inqbank"] + 1, n, 1).getValues() : null;
    for (var r = 0; r < n; r++) {
      var id = tm_s_(ids[r][0]); if (!id) continue;
      var t = tm_s_(tv[r][0]);
      if (!t) { res.blankQ++; if (res.blankQIds.length < 30) res.blankQIds.push(id); continue; }
      var o = res.q[t] || (res.q[t] = { total: 0, qbank: 0, quiz: 0 });
      o.total++;
      if (ib && qY_(ib[r][0])) o.qbank++;
      if (iq && qY_(iq[r][0])) o.quiz++;
      if (!knownIds[t]) { res.orphanQ++; res.orphanIds[t] = (res.orphanIds[t] || 0) + 1; }
    }
  }
  var st = ss.getSheetByName("Study");
  if (st && st.getLastRow() > 1) {
    var sh = st.getRange(1, 1, 1, st.getLastColumn()).getValues()[0].map(tm_s_), ci = sh.indexOf("topic_id");
    if (ci >= 0) {
      var sv = st.getRange(2, ci + 1, st.getLastRow() - 1, 1).getValues();
      for (var k = 0; k < sv.length; k++) {
        var tt = tm_s_(sv[k][0]);
        if (!tt) { res.blankSt++; continue; }
        res.st[tt] = (res.st[tt] || 0) + 1;
        if (!knownIds[tt]) res.orphanSt++;
      }
    }
  }
  return res;
}

function tm_topicsInfo_(ss) {
  var sh = ss.getSheetByName("Topics"); if (!sh) throw new Error("Topics শিট নেই");
  var T = tm_table_(sh);
  var c = { id: T.hdr.indexOf("topic_id"), name: T.hdr.indexOf("topic_name"), sub: T.hdr.indexOf("subject_id"), tag: T.hdr.indexOf("tag_ids"), tags: T.hdr.indexOf("topic_tags") };
  if (c.id < 0 || c.name < 0 || c.sub < 0) throw new Error("Topics শিটে topic_id/topic_name/subject_id কলাম নেই");
  var byId = {};
  T.rows.forEach(function (r, i) { var id = tm_s_(r[c.id]); if (id && byId[id] === undefined) byId[id] = i; });
  return { sh: sh, T: T, c: c, byId: byId };
}

function tm_rulesInfo_(ss) {
  var sh = ss.getSheetByName(TM_RULES_SHEET_);
  if (!sh || sh.getLastRow() < 1) return { sh: null, T: { hdr: [], rows: [], lc: 0 }, c: {}, byTopic: {} };
  var T = tm_table_(sh), h = T.hdr;
  var c = { rid: h.indexOf("rule_id"), tid: h.indexOf("topic_id"), tname: h.indexOf("topic_name"), kw: h.indexOf("keywords"), mi: h.indexOf("match_in"), ex: h.indexOf("exclude_keywords"), rb: h.indexOf("require_blank"), aw: h.indexOf("answer_whole"), act: h.indexOf("active"), note: h.indexOf("note") };
  var byTopic = {};
  T.rows.forEach(function (r, i) { var t = tm_s_(r[c.tid]); if (t) (byTopic[t] = byTopic[t] || []).push(i); });
  return { sh: sh, T: T, c: c, byTopic: byTopic };
}

/* ───────────── tm_getTopics ───────────── */
function tm_getTopics_(ss) {
  var TI = tm_topicsInfo_(ss), c = TI.c;
  var cnt = tm_counts_(ss, TI.byId), RI = tm_rulesInfo_(ss);
  var subj = [], ssh = ss.getSheetByName("Subjects");
  if (ssh && ssh.getLastRow() > 1) {
    var sd = ssh.getDataRange().getValues(), sh = sd[0].map(tm_s_), a = sh.indexOf("subject_id"), b = sh.indexOf("subject_name");
    for (var i = 1; i < sd.length; i++) { var sid = tm_s_(sd[i][a]); if (sid) subj.push({ id: sid, name: tm_s_(sd[i][b]) }); }
  }
  var topics = TI.T.rows.map(function (r) {
    var id = tm_s_(r[c.id]); if (!id) return null;
    var q = cnt.q[id] || { total: 0, qbank: 0, quiz: 0 };
    return { id: id, name: tm_s_(r[c.name]), subject_id: tm_s_(r[c.sub]), tag_ids: c.tag >= 0 ? tm_s_(r[c.tag]) : "",
             c: { total: q.total, qbank: q.qbank, quiz: q.quiz, study: cnt.st[id] || 0, rules: (RI.byTopic[id] || []).length } };
  }).filter(function (x) { return x; });
  var orphan = Object.keys(cnt.orphanIds).map(function (k) { return { topic_id: k, n: cnt.orphanIds[k] }; }).sort(function (x, y) { return y.n - x.n; }).slice(0, 50);
  return { status: "success", subjects: subj, topics: topics,
           health: { blankQ: cnt.blankQ, blankQIds: cnt.blankQIds, orphanQ: cnt.orphanQ, orphanTopics: orphan, blankStudy: cnt.blankSt, orphanStudy: cnt.orphanSt } };
}

/* ───────────── লগ (Undo-র জন্য) ───────────── */
function tm_logSheet_(ss) {
  var sh = ss.getSheetByName(TM_LOG_SHEET_);
  if (!sh) {
    sh = ss.insertSheet(TM_LOG_SHEET_);
    sh.getRange(1, 1, 1, TM_LOG_HDR_.length).setValues([TM_LOG_HDR_]).setFontWeight("bold");
    sh.setFrozenRows(1);
    sh.getRange(2, 7, Math.max(1, sh.getMaxRows() - 1), 1).setNumberFormat("@");
  }
  return sh;
}
function tm_logWrite_(ss, kind, summary, payload) {
  var sh = tm_logSheet_(ss), id = "TM" + Date.now(), json = JSON.stringify(payload), now = new Date().toISOString(), rows = [];
  for (var i = 0, seq = 1; i < json.length || seq === 1; i += TM_CHUNK_, seq++) {
    rows.push([id, seq, now, kind, "N", seq === 1 ? summary : "", json.substring(i, i + TM_CHUNK_)]);
    if (i + TM_CHUNK_ >= json.length) break;
  }
  sh.getRange(sh.getLastRow() + 1, 1, rows.length, TM_LOG_HDR_.length).setValues(rows);
  return id;
}
function tm_logRead_(ss, logId) {
  var sh = ss.getSheetByName(TM_LOG_SHEET_); if (!sh || sh.getLastRow() < 2) return null;
  var v = sh.getRange(2, 1, sh.getLastRow() - 1, TM_LOG_HDR_.length).getValues(), parts = [];
  v.forEach(function (r, i) { if (tm_s_(r[0]) === logId) parts.push({ seq: Number(r[1]), text: String(r[6] == null ? "" : r[6]), row: i + 2, kind: tm_s_(r[3]), undone: tm_s_(r[4]) }); });
  if (!parts.length) return null;
  parts.sort(function (a, b) { return a.seq - b.seq; });
  return { payload: JSON.parse(parts.map(function (p) { return p.text; }).join("")), rows: parts.map(function (p) { return p.row; }), kind: parts[0].kind, undone: parts[0].undone };
}
function tm_getLog_(ss) {
  var sh = ss.getSheetByName(TM_LOG_SHEET_); if (!sh || sh.getLastRow() < 2) return { status: "success", items: [] };
  var v = sh.getRange(2, 1, sh.getLastRow() - 1, 6).getValues(), items = [];
  for (var i = v.length - 1; i >= 0 && items.length < 15; i--) {
    if (Number(v[i][1]) !== 1) continue;
    items.push({ log_id: tm_s_(v[i][0]), time: tm_s_(v[i][2]), kind: tm_s_(v[i][3]), undone: tm_s_(v[i][4]) === "Y", summary: tm_s_(v[i][5]) });
  }
  return { status: "success", items: items };
}

/* ───────────── Questions / Study-র topic_id বদল (আসল কাজ) ─────────────
   fromIds: {topicId:true}; কোন সারি ধরবে + নতুন মান = কলব্যাক। ফেরত: কয়টা সারি বদলালো।
   restrictIds (ঐচ্ছিক): {rowKey:true} — Undo-তে শুধু ওই সারিগুলো। */
function tm_applyToQuestions_(ss, fn, dry) {
  var q = ss.getSheetByName(Q_UNIFIED_SHEET_); if (!q || q.getLastRow() < 2) return 0;
  var H = qHeader_(q), ix = H.idx, n = q.getLastRow() - 1;
  var cId = ix["id"], cT = ix["topicid"], cS = ix["subtopic"], cU = ix["updatedat"];
  if (cId === undefined || cT === undefined) throw new Error("Questions শিটে id/topic_id কলাম নেই");
  var ids = q.getRange(2, cId + 1, n, 1).getValues(), tv = q.getRange(2, cT + 1, n, 1).getValues();
  var sv = cS !== undefined ? q.getRange(2, cS + 1, n, 1).getValues() : null;
  var uv = cU !== undefined ? q.getRange(2, cU + 1, n, 1).getValues() : null;
  var now = Date.now(), changed = 0;
  for (var r = 0; r < n; r++) {
    var id = tm_s_(ids[r][0]); if (!id) continue;
    var res = fn(id, tm_s_(tv[r][0]), sv ? tm_s_(sv[r][0]) : "");
    if (!res) continue;
    tv[r][0] = res.topic_id; if (sv && res.sub_topic != null) sv[r][0] = res.sub_topic; if (uv) uv[r][0] = now;
    changed++;
  }
  if (changed && !dry) {
    q.getRange(2, cT + 1, n, 1).setValues(tv);
    if (sv) q.getRange(2, cS + 1, n, 1).setValues(sv);
    if (uv) q.getRange(2, cU + 1, n, 1).setValues(uv);
  }
  return changed;
}
function tm_studyKeyCol_(hdr) { var a = hdr.indexOf("new_id"); return a >= 0 ? a : hdr.indexOf("id"); }
function tm_applyToStudy_(ss, fn, dry) {
  var st = ss.getSheetByName("Study"); if (!st || st.getLastRow() < 2) return 0;
  var hdr = st.getRange(1, 1, 1, st.getLastColumn()).getValues()[0].map(tm_s_), n = st.getLastRow() - 1;
  var cT = hdr.indexOf("topic_id"), cN = hdr.indexOf("topic"), cK = tm_studyKeyCol_(hdr), cU = hdr.indexOf("updatedAt");
  if (cT < 0 || cK < 0) return 0;
  var tv = st.getRange(2, cT + 1, n, 1).getValues(), kv = st.getRange(2, cK + 1, n, 1).getValues();
  var nv = cN >= 0 ? st.getRange(2, cN + 1, n, 1).getValues() : null, uv = cU >= 0 ? st.getRange(2, cU + 1, n, 1).getValues() : null;
  var now = Date.now(), changed = 0;
  for (var r = 0; r < n; r++) {
    var key = tm_s_(kv[r][0]); if (!key) continue;
    var res = fn(key, tm_s_(tv[r][0]), nv ? tm_s_(nv[r][0]) : "");
    if (!res) continue;
    tv[r][0] = res.topic_id; if (nv && res.sub_topic != null) nv[r][0] = res.sub_topic; if (uv) uv[r][0] = now;
    changed++;
  }
  if (changed && !dry) {
    st.getRange(2, cT + 1, n, 1).setValues(tv);
    if (nv) st.getRange(2, cN + 1, n, 1).setValues(nv);
    if (uv) st.getRange(2, cU + 1, n, 1).setValues(uv);
  }
  return changed;
}

/* ───────────── মার্জ ───────────── */
function tm_merge_(ss, p, dry) {
  var target = tm_s_(p.targetId), newName = tm_s_(p.newName);
  var sources = []; tm_arr_(p.sourceIds).forEach(function (s) { if (s !== target && sources.indexOf(s) < 0) sources.push(s); });
  if (!target) return { status: "error", message: "টার্গেট টপিক (targetId) দাও" };
  if (!sources.length) return { status: "error", message: "মার্জ করার জন্য অন্তত ১টা সোর্স টপিক লাগবে (টার্গেট ছাড়া)" };

  var TI = tm_topicsInfo_(ss), c = TI.c, rows = TI.T.rows;
  if (TI.byId[target] === undefined) return { status: "error", message: "টার্গেট টপিক পাওয়া যায়নি: " + target };
  var tRow = rows[TI.byId[target]], subj = tm_s_(tRow[c.sub]);
  for (var i = 0; i < sources.length; i++) {
    if (TI.byId[sources[i]] === undefined) return { status: "error", message: "সোর্স টপিক পাওয়া যায়নি: " + sources[i] };
    if (tm_s_(rows[TI.byId[sources[i]]][c.sub]) !== subj) return { status: "error", message: "শুধু একই সাবজেক্টের টপিক মার্জ করা যায় (" + sources[i] + " অন্য সাবজেক্টের) — আগে সাবজেক্ট বদলাও" };
  }
  var finalName = newName || tm_s_(tRow[c.name]);
  var cnt = tm_counts_(ss, TI.byId), RI = tm_rulesInfo_(ss);
  var before = function (id) { var q = cnt.q[id] || { total: 0, qbank: 0, quiz: 0 }; return { total: q.total, qbank: q.qbank, study: cnt.st[id] || 0 }; };
  var tB = before(target), srcInfo = sources.map(function (id) {
    var b = before(id); return { id: id, name: tm_s_(rows[TI.byId[id]][c.name]), total: b.total, qbank: b.qbank, study: b.study, rules: (RI.byTopic[id] || []).length };
  });
  var movedQ = 0, movedS = 0; srcInfo.forEach(function (s) { movedQ += s.total; movedS += s.study; });
  var rulePlan = tm_rulePlan_(RI, target, sources);

  var preview = { status: "success", dry: !!dry, target: { id: target, name: tm_s_(tRow[c.name]), finalName: finalName, total: tB.total, qbank: tB.qbank, study: tB.study, rules: (RI.byTopic[target] || []).length },
                  sources: srcInfo, movedQuestions: movedQ, movedStudy: movedS, afterTotal: tB.total + movedQ, afterStudy: tB.study + movedS, ruleNote: rulePlan.note };
  if (dry) return preview;

  /* ── ১) কোন প্রশ্ন কোথায় যাবে তা মেমোরিতে হিসাব (শিটে কিছু লেখা হয় না) ── */
  var srcSet = {}; sources.forEach(function (s) { srcSet[s] = true; });
  var qMoved = {}, qOldSub = {}, stMoved = {};
  sources.forEach(function (s) { qMoved[s] = []; stMoved[s] = []; });
  var qFn = function (id, topic, sub) {
    if (!srcSet[topic]) return null;
    qMoved[topic].push(id);
    var srcName = tm_s_(rows[TI.byId[topic]][c.name]); if (sub !== srcName) qOldSub[id] = sub;
    return { topic_id: target, sub_topic: finalName };
  };
  var sFn = function (key, topic, nm) {
    if (!srcSet[topic]) return null;
    stMoved[topic].push(key);
    return { topic_id: target, sub_topic: finalName };
  };
  tm_applyToQuestions_(ss, qFn, true);
  tm_applyToStudy_(ss, sFn, true);

  /* ── ২) লগ আগে লেখো (মাঝপথে থামলেও Undo চলবে) — তারপর আসল লেখা ── */
  var log = { kind: "merge", target: target, finalName: finalName, subject_id: subj,
              targetRow: tm_pad_(tRow, TI.T.lc), topicsHdr: TI.T.hdr,
              sources: sources.map(function (id) { return { id: id, name: tm_s_(rows[TI.byId[id]][c.name]), row: tm_pad_(rows[TI.byId[id]], TI.T.lc) }; }),
              qMoved: qMoved, qOldSub: qOldSub, stMoved: stMoved, rulesBefore: rulePlan.before, rulesHdr: RI.T.hdr, before: { target: tB, movedQ: movedQ, movedS: movedS } };
  var logId = tm_logWrite_(ss, "merge", srcInfo.map(function (s) { return s.name + "(" + s.total + ")"; }).join(" + ") + " → " + finalName + " [" + target + "]", log);
  if (!tm_logRead_(ss, logId)) throw new Error("লগ লেখা যাচাই ব্যর্থ — কিছুই বদলানো হয়নি");
  var nQ = tm_applyToQuestions_(ss, qFn, false);
  var nS = tm_applyToStudy_(ss, sFn, false);

  /* ── ৩) Topics শিট: টার্গেটের নাম/ট্যাগ, সোর্স সারি মোছা ── */
  var tsh = TI.sh, tr = TI.byId[target] + 2;
  if (newName && c.name >= 0) tsh.getRange(tr, c.name + 1).setValue(newName);
  [c.tag, c.tags].forEach(function (col) {
    if (col < 0) return;
    var lists = [tm_list_(tRow[col])]; sources.forEach(function (s) { lists.push(tm_list_(rows[TI.byId[s]][col])); });
    var merged = tm_union_(lists).join(", "); if (merged !== tm_s_(tRow[col])) tsh.getRange(tr, col + 1).setValue(merged);
  });
  sources.map(function (s) { return TI.byId[s] + 2; }).sort(function (a, b) { return b - a; }).forEach(function (rn) { tsh.deleteRow(rn); });

  /* ── ৪) TopicRules ── */
  tm_applyRulePlan_(RI, rulePlan, target, finalName);

  /* ── ৫) পরিষ্কার-পরিচ্ছন্নতা ── */
  var dirty = {}; dirty[target] = 1; sources.forEach(function (s) { dirty[s] = 1; }); markTopicsDirty(dirty);
  qRefreshTopicCounts_(ss);
  try { markReindexNeeded_(); } catch (e1) {}

  /* ── ৬) যাচাই: আগে-পরের হিসাব মিলছে? ── */
  var TI2 = tm_topicsInfo_(ss), cnt2 = tm_counts_(ss, TI2.byId), after = cnt2.q[target] ? cnt2.q[target].total : 0;
  var ok = after === tB.total + movedQ && nQ === movedQ && nS === movedS;
  preview.dry = false; preview.log_id = logId; preview.movedNow = { questions: nQ, study: nS }; preview.verify = { ok: ok, expected: tB.total + movedQ, actual: after };
  if (!ok) preview.warning = "হিসাব মিলেনি — Undo চেপে আগের অবস্থায় ফিরে যাও, তারপর আমাকে জানাও";
  return preview;
}

/* ── রুল-মার্জ পরিকল্পনা ──
   টার্গেটে রুল থাকলে সোর্সের সামঞ্জস্যপূর্ণ রুলের keywords টার্গেট-রুলে যোগ, সোর্স-রুল মুছে ফেলা।
   সামঞ্জস্যপূর্ণ না হলে (match_in/require_blank/answer_whole আলাদা, বা exclude আলাদা): টার্গেটে সরিয়ে active=N করা (নোটসহ), যাচাই করে চালু করতে হবে।
   টার্গেটে রুল না থাকলে: প্রথম সোর্স-রুলটাই টার্গেটের রুল হয়ে যায়। */
function tm_rulePlan_(RI, target, sources) {
  var plan = { ops: [], before: [], note: "" };
  if (!RI.sh) { plan.note = "TopicRules শিট নেই — রুলে কোনো বদল হবে না"; return plan; }
  var c = RI.c, rows = RI.T.rows, srcRules = [];
  sources.forEach(function (s) { (RI.byTopic[s] || []).forEach(function (i) { srcRules.push({ i: i, src: s }); }); });
  var tIdx = (RI.byTopic[target] || [])[0];
  if (!srcRules.length) { plan.note = "সোর্স টপিকগুলোতে কোনো রুল নেই"; return plan; }
  var norm = function (v, d) { return tm_s_(v).toLowerCase() || d; };
  var added = 0, moved = 0, deleted = 0, flagged = 0, base = tIdx !== undefined ? rows[tIdx] : null, baseIdx = tIdx;
  var kwList = base ? tm_list_(base[c.kw]) : [];
  var allIdx = (RI.byTopic[target] || []).concat(srcRules.map(function (x) { return x.i; }));
  allIdx.forEach(function (i) { plan.before.push({ rowNo: i + 2, values: tm_pad_(rows[i], RI.T.lc) }); });
  srcRules.forEach(function (sr) {
    var r = rows[sr.i];
    if (baseIdx === undefined) { plan.ops.push({ kind: "repoint", i: sr.i, activate: false }); baseIdx = sr.i; base = r; kwList = tm_list_(r[c.kw]); moved++; return; }
    var compat = norm(r[c.mi], "question") === norm(base[c.mi], "question") && norm(r[c.rb], "n") === norm(base[c.rb], "n") && norm(r[c.aw], "n") === norm(base[c.aw], "n")
              && (tm_s_(r[c.ex]) === "" || tm_s_(r[c.ex]) === tm_s_(base[c.ex]));
    if (compat) {
      var before = kwList.length; kwList = tm_union_([kwList, tm_list_(r[c.kw])]); added += kwList.length - before;
      plan.ops.push({ kind: "delete", i: sr.i }); deleted++;
    } else { plan.ops.push({ kind: "repoint", i: sr.i, activate: true, flag: true }); flagged++; }
  });
  plan.baseIdx = baseIdx; plan.kwFinal = kwList.join(", ");
  plan.note = (moved ? "১টা সোর্স-রুল টার্গেটের রুল হবে; " : "") + (added ? added + "টা নতুন keyword টার্গেট-রুলে যোগ হবে; " : "") + (deleted ? deleted + "টা রুল (keyword যোগ হয়ে) মুছবে; " : "") + (flagged ? flagged + "টা রুল অমিল সেটিং-এর, বন্ধ (active=N) অবস্থায় টার্গেটে যাবে — যাচাই করে চালু করো" : "");
  plan.note = plan.note.replace(/;\s*$/, "") || "রুলে কোনো বদল হবে না";
  return plan;
}
function tm_applyRulePlan_(RI, plan, target, finalName) {
  if (!RI.sh || !plan.ops.length && plan.baseIdx === undefined) return;
  var sh = RI.sh, c = RI.c, delRows = [];
  plan.ops.forEach(function (op) {
    var rn = op.i + 2;
    if (op.kind === "repoint") {
      sh.getRange(rn, c.tid + 1).setValue(target);
      if (c.tname >= 0) sh.getRange(rn, c.tname + 1).setValue(finalName);
      if (op.flag && c.act >= 0) sh.getRange(rn, c.act + 1).setValue("N");
      if (op.flag && c.note >= 0) { var old = tm_s_(RI.T.rows[op.i][c.note]); sh.getRange(rn, c.note + 1).setValue((old ? old + " | " : "") + "মার্জ থেকে এসেছে — যাচাই করে চালু করো"); }
    } else delRows.push(rn);
  });
  if (plan.baseIdx !== undefined && c.kw >= 0) {
    var bn = plan.baseIdx + 2;
    sh.getRange(bn, c.kw + 1).setValue(plan.kwFinal);
    if (c.tname >= 0) sh.getRange(bn, c.tname + 1).setValue(finalName);
  }
  delRows.sort(function (a, b) { return b - a; }).forEach(function (rn) { sh.deleteRow(rn); });
}
/* ───────────── অপ্রয়োজনীয় (০ প্রশ্ন) টপিক মোছা ───────────── */
function tm_deleteEmpty_(ss, p) {
  var ids = []; tm_arr_(p.ids).forEach(function (x) { if (ids.indexOf(x) < 0) ids.push(x); });
  if (!ids.length) return { status: "error", message: "কোনো টপিক বাছা হয়নি" };
  var TI = tm_topicsInfo_(ss), c = TI.c, rows = TI.T.rows, cnt = tm_counts_(ss, TI.byId), RI = tm_rulesInfo_(ss);
  var ok = [], skipped = [];
  ids.forEach(function (id) {
    if (TI.byId[id] === undefined) { skipped.push({ id: id, reason: "টপিক পাওয়া যায়নি" }); return; }
    var q = (cnt.q[id] || { total: 0 }).total, s = cnt.st[id] || 0;
    if (q > 0 || s > 0) { skipped.push({ id: id, reason: "এতে " + (q + s) + "টা প্রশ্ন আছে — আগে অন্য টপিকে মার্জ করো" }); return; }
    ok.push(id);
  });
  if (!ok.length) return { status: "success", deleted: [], skipped: skipped };
  var ruleRows = [], ruleIdx = [];
  ok.forEach(function (id) { (RI.byTopic[id] || []).forEach(function (i) { ruleIdx.push(i); ruleRows.push({ rowNo: i + 2, values: tm_pad_(RI.T.rows[i], RI.T.lc) }); }); });
  var log = { kind: "delete", topics: ok.map(function (id) { return { id: id, row: tm_pad_(rows[TI.byId[id]], TI.T.lc), rowNo: TI.byId[id] + 2 }; }), topicsHdr: TI.T.hdr, rules: ruleRows, rulesHdr: RI.T.hdr };
  var names = ok.map(function (id) { return tm_s_(rows[TI.byId[id]][c.name]); });
  var logId = tm_logWrite_(ss, "delete", "মোছা: " + names.slice(0, 6).join(", ") + (names.length > 6 ? " … +" + (names.length - 6) : "") + " (" + ok.length + "টা ফাঁকা টপিক)", log);
  ruleIdx.map(function (i) { return i + 2; }).sort(function (a, b) { return b - a; }).forEach(function (rn) { RI.sh.deleteRow(rn); });
  ok.map(function (id) { return TI.byId[id] + 2; }).sort(function (a, b) { return b - a; }).forEach(function (rn) { TI.sh.deleteRow(rn); });
  var dirty = {}; ok.forEach(function (id) { dirty[id] = 1; }); markTopicsDirty(dirty);
  qRefreshTopicCounts_(ss);
  try { markReindexNeeded_(); } catch (e1) {}
  return { status: "success", deleted: ok, skipped: skipped, log_id: logId, rulesRemoved: ruleIdx.length };
}

/* ───────────── Undo (সর্বশেষটা) ───────────── */
function tm_markUndone_(ss, rows) {
  var sh = ss.getSheetByName(TM_LOG_SHEET_); rows.forEach(function (rn) { sh.getRange(rn, 5).setValue("Y"); });
}
function tm_restoreTopicRow_(TI, hdrOld, row) {
  var lc = TI.T.lc, sh = TI.sh, id = tm_s_(row[hdrOld.indexOf("topic_id")]);
  if (TI.byId[id] !== undefined) return false;
  var out = TI.T.hdr.map(function (h) { var j = hdrOld.indexOf(h); return j >= 0 ? row[j] : ""; });
  sh.getRange(sh.getLastRow() + 1, 1, 1, lc).setValues([out]);
  return true;
}
function tm_restoreRules_(RI, rulesHdr, items) {
  if (!RI.sh || !items || !items.length) return 0;
  var sh = RI.sh, hdr = RI.T.hdr, n = 0, ridCol = hdr.indexOf("rule_id");
  var cur = sh.getLastRow() > 1 ? sh.getRange(2, ridCol + 1, sh.getLastRow() - 1, 1).getValues() : [];
  items.forEach(function (it) {
    var out = hdr.map(function (h) { var j = rulesHdr.indexOf(h); return j >= 0 ? it.values[j] : ""; });
    var rid = tm_s_(out[ridCol]), at = -1;
    for (var i = 0; i < cur.length; i++) if (tm_s_(cur[i][0]) === rid) { at = i + 2; break; }
    if (at > 0) sh.getRange(at, 1, 1, hdr.length).setValues([out]);
    else { sh.getRange(sh.getLastRow() + 1, 1, 1, hdr.length).setValues([out]); cur.push([rid]); }
    n++;
  });
  return n;
}
function tm_undo_(ss) {
  var sh = ss.getSheetByName(TM_LOG_SHEET_); if (!sh || sh.getLastRow() < 2) return { status: "error", message: "Undo করার মতো কিছু নেই" };
  var v = sh.getRange(2, 1, sh.getLastRow() - 1, 5).getValues(), logId = "";
  for (var i = v.length - 1; i >= 0; i--) if (Number(v[i][1]) === 1 && tm_s_(v[i][4]) !== "Y") { logId = tm_s_(v[i][0]); break; }
  if (!logId) return { status: "error", message: "Undo করার মতো কিছু নেই" };
  var L = tm_logRead_(ss, logId), P = L.payload, TI = tm_topicsInfo_(ss), RI = tm_rulesInfo_(ss), dirty = {}, res = { status: "success", log_id: logId, kind: L.kind };
  if (L.kind === "merge") {
    var restored = 0;
    P.sources.forEach(function (s) { if (tm_restoreTopicRow_(TI, P.topicsHdr, s.row)) restored++; TI = tm_topicsInfo_(ss); dirty[s.id] = 1; });
    dirty[P.target] = 1;
    // টার্গেটের নাম/ট্যাগ আগের অবস্থায়
    if (TI.byId[P.target] !== undefined) {
      var rn = TI.byId[P.target] + 2, old = P.targetRow, h = P.topicsHdr;
      ["topic_name", "tag_ids", "topic_tags"].forEach(function (col) {
        var a = TI.T.hdr.indexOf(col), b = h.indexOf(col); if (a >= 0 && b >= 0) TI.sh.getRange(rn, a + 1).setValue(old[b]);
      });
    }
    var qSets = {}, stSets = {}, srcName = {};
    P.sources.forEach(function (s) { srcName[s.id] = s.name; (P.qMoved[s.id] || []).forEach(function (id) { qSets[id] = s.id; }); (P.stMoved[s.id] || []).forEach(function (k) { stSets[k] = s.id; }); });
    res.questions = tm_applyToQuestions_(ss, function (id, topic) {
      if (topic !== P.target || !qSets[id]) return null;
      var src = qSets[id]; return { topic_id: src, sub_topic: P.qOldSub[id] !== undefined ? P.qOldSub[id] : srcName[src] };
    });
    res.study = tm_applyToStudy_(ss, function (key, topic) {
      if (topic !== P.target || !stSets[key]) return null;
      var src = stSets[key]; return { topic_id: src, sub_topic: srcName[src] };
    });
    res.rules = tm_restoreRules_(RI, P.rulesHdr, P.rulesBefore); res.topicsRestored = restored;
  } else if (L.kind === "delete") {
    var back = 0; P.topics.forEach(function (t) { if (tm_restoreTopicRow_(TI, P.topicsHdr, t.row)) back++; TI = tm_topicsInfo_(ss); dirty[t.id] = 1; });
    res.rules = tm_restoreRules_(RI, P.rulesHdr, P.rules); res.topicsRestored = back;
  } else return { status: "error", message: "অজানা লগ ধরন: " + L.kind };
  markTopicsDirty(dirty); qRefreshTopicCounts_(ss);
  try { markReindexNeeded_(); } catch (e1) {}
  tm_markUndone_(ss, L.rows);
  return res;
}

/* ───────────── HTTP রাউটার ───────────── */
function tm_handleAction_(name, p) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  try {
    if (name === "tm_getTopics") return tm_getTopics_(ss);
    if (name === "tm_getLog") return tm_getLog_(ss);
    if (name === "tm_mergePreview") return tm_merge_(ss, p, true);
    if (name === "tm_merge") return withWriteLock(function () { return tm_merge_(ss, p, false); });
    if (name === "tm_deleteEmpty") return withWriteLock(function () { return tm_deleteEmpty_(ss, p); });
    if (name === "tm_undo") return withWriteLock(function () { return tm_undo_(ss); });
    return { status: "error", message: "অজানা tm action: " + name };
  } catch (err) { try { logError_("tm_handleAction_:" + name, String(err && err.stack || err)); } catch (e2) {} return { status: "error", message: String(err && err.message || err) }; }
}
