/* ══════════════════════════════════════════════════════════════════════════════════════
   AUTO-CLASSIFY — টপিক-ট্যাগ (TopicRules) দিয়ে QBank MCQ-কে আপনা-আপনি Subject/Topic-এ বসানো
   ──────────────────────────────────────────────────────────────────────────────────────
   ধাপ ১: `TopicRules` শিট + মিলানোর ইঞ্জিন + Preview/Apply/Undo (Apps Script editor থেকে চালান)।
   নির্ভরতা: code_updated.gs-এর helper (qHeader_, qUnified_, markTopicsDirty, qRefreshTopicCounts_ …) — একই প্রজেক্টে থাকতে হবে।

   চালানোর ফাংশন:
     rules_setup()      → TopicRules শিট বানায় (২টা নমুনা রুল সহ), Questions-এ auto_* কলাম যোগ করে। কিছু মোছে না।
     rules_preview()    → কিছু না বদলিয়ে `_AutoClassify_Report`-এ ফলাফল লেখে (কয়টা মিলবে, নমুনা, দ্বন্দ্ব)।
     rules_apply()      → ঠিক একই হিসাবে সত্যিই Subject/Topic বসায়।  (আগে preview দেখে নিন)
     rules_undoLast()   → সর্বশেষ apply-এর সব বদল ফেরত (সারি LOCK হয়, আর অটো ছোঁবে না)।
     rules_undoAll()    → সব অটো-বদল ফেরত।

   TopicRules কলাম:
     rule_id · topic_id · topic_name(শুধু পড়ার জন্য, ফর্মুলা) · keywords(কমা দিয়ে) · match_in(question|answer|both)
     · exclude_keywords · min_matches · priority · require_blank(Y/N) · answer_whole(Y/N) · answer_max_words · active(Y/N) · note
   মিলানোর নিয়ম:
     • English শব্দ = পুরো শব্দ (in front of-এর মতো একাধিক শব্দও চলে), বড়/ছোট হাতের ভেদ নেই।
     • বাংলা শব্দ = শব্দের শুরু মিললেই চলে (লাভ → লাভে, লাভের)। একটা বড় শব্দের ভেতরের ছোট ট্যাগ (ক্রয় ⊂ ক্রয়মূল্য) আলাদা গোনা হয় না।
     • answer = শুধু সঠিক অপশনের লেখা। answer_whole=Y হলে পুরো উত্তরটাই ট্যাগের একটা হতে হবে ("went to" ধরবে না, "to" ধরবে)।
     • require_blank=Y হলে প্রশ্নে ফাঁকা (____ / ... / …) থাকতে হবে।  answer_max_words = উত্তর সর্বোচ্চ কয় শব্দ।
     • exclude_keywords প্রশ্ন বা উত্তরের যেকোনোটায় থাকলে রুল বাতিল।
     • একাধিক রুল মিললে: বেশি priority জেতে; সমান হলে বেশি ট্যাগ-মিল জেতে; তাও সমান আর টপিক আলাদা হলে → দ্বন্দ্ব, অটো-মুভ হয় না।
   শুধু ওই প্রশ্নই বিবেচিত: QBank-এ আছে, MCQ (Written নয়), এখনো classified নয় (Subject ফাঁকা বা পুল S13/S16/S30), আর auto_rule ≠ LOCK।
   বদলায়: subject_id, topic_id, subject, sub_topic, classified=Y, in_quiz=Y, updatedAt + auto_rule/auto_matched/auto_at/auto_prev। মোছে না।
   ══════════════════════════════════════════════════════════════════════════════════════ */

var AC_RULES_SHEET_  = "TopicRules";
var AC_REPORT_SHEET_ = "_AutoClassify_Report";
var AC_RULE_HDR_ = ["rule_id", "topic_id", "topic_name", "keywords", "match_in", "exclude_keywords", "min_matches", "priority", "require_blank", "answer_whole", "answer_max_words", "active", "note"];
var AC_NEW_COLS_ = ["auto_rule", "auto_matched", "auto_at", "auto_prev"];
var AC_PREP_KEYWORDS_ = "in, on, at, into, onto, upon, over, above, under, below, beneath, underneath, behind, in front of, beside, besides, next to, between, among, amongst, inside, outside, within, without, to, from, for, of, off, out of, about, around, along, across, through, throughout, against, towards, toward, with, by, near, close to, up, down, before, after, during, since, until, till, up to, as, like, than, via, per, concerning, regarding, considering, despite, in spite of, according to, because of, due to, instead of, apart from, aside from, in place of, on behalf of";

/* ───────────────────────── মিলানোর ইঞ্জিন (শিট-নিরপেক্ষ, টেস্টযোগ্য) ───────────────────────── */
function ac_norm_(s) { return String(s == null ? "" : s).normalize("NFC").replace(/\s+/g, " ").trim(); }
function ac_splitList_(s) { return String(s == null ? "" : s).split(/[,،;\n]+/).map(function (x) { return ac_norm_(x); }).filter(function (x) { return x; }); }
function ac_escRe_(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
function ac_isLatin_(kw) { return /[A-Za-z]/.test(kw); }

/** text-এ keyword-এর সব মিল: [{kw,start,end}] */
function ac_findAll_(text, kw) {
  var out = [], t = ac_norm_(text);
  if (!t || !kw) return out;
  var re;
  if (ac_isLatin_(kw)) re = new RegExp("(?<![A-Za-z0-9])" + ac_escRe_(kw).replace(/\s+/g, "\\s+") + "(?![A-Za-z0-9])", "gi");
  else re = new RegExp("(?<![\\u0980-\\u09FFA-Za-z0-9])" + ac_escRe_(kw).replace(/\s+/g, "\\s+"), "g");
  var m;
  while ((m = re.exec(t)) !== null) { out.push({ kw: kw, start: m.index, end: m.index + m[0].length }); if (m[0].length === 0) re.lastIndex++; }
  return out;
}
/** বড় মিলের ভেতরে পুরোপুরি থাকা ছোট (ভিন্ন keyword-এর) মিল বাদ → distinct keyword তালিকা */
function ac_distinctKeywords_(matches) {
  var keep = [];
  matches.forEach(function (a, i) {
    var inside = matches.some(function (b, j) { return j !== i && b.kw !== a.kw && b.start <= a.start && b.end >= a.end && (b.end - b.start) > (a.end - a.start); });
    if (!inside && keep.indexOf(a.kw) < 0) keep.push(a.kw);
  });
  return keep;
}
function ac_matchAll_(texts, keywords) {
  var all = [];
  texts.forEach(function (t) { keywords.forEach(function (k) { all = all.concat(ac_findAll_(t, k)); }); });
  return ac_distinctKeywords_(all);
}

/** correct কলাম থেকে সঠিক উত্তরের লেখা (অপশনের লেখা, নাহলে ১-৪/option১ ধরনের সূচক হলে সেই অপশন) */
function ac_answerText_(q) {
  var opts = [q.option1, q.option2, q.option3, q.option4].map(ac_norm_);
  var c = ac_norm_(q.correct);
  if (!c) return "";
  if (opts.indexOf(c) >= 0) return c;
  var m = /^(?:option\s*)?([1-4])$/i.exec(c);
  if (m && opts[parseInt(m[1], 10) - 1]) return opts[parseInt(m[1], 10) - 1];
  return c;
}
function ac_hasBlank_(text) { return /_{2,}|\.{3,}|…|-{3,}|\(\s*\)|\[\s*\]/.test(String(text || "")); }
function ac_wordCount_(s) { var t = ac_norm_(s); return t ? t.split(" ").length : 0; }

/** একটা রুল একটা প্রশ্নে খাটে কিনা → null অথবা {matched:[...], count} */
function ac_evalRule_(rule, q, answer) {
  var scopeQ = (rule.match_in === "question" || rule.match_in === "both");
  var scopeA = (rule.match_in === "answer" || rule.match_in === "both");
  if (rule.require_blank && !ac_hasBlank_(q.question)) return null;
  if (rule.answer_max_words && ac_wordCount_(answer) > rule.answer_max_words) return null;
  if (rule.exclude.length && ac_matchAll_([q.question, answer], rule.exclude).length) return null;

  var matched;
  if (rule.answer_whole && scopeA) {
    var a = ac_norm_(answer).replace(/[\s.,;:!?'"।]+$/g, "").replace(/^[\s'"]+/, "").toLowerCase();
    matched = [];
    for (var i = 0; i < rule.keywords.length; i++) if (rule.keywords[i].toLowerCase() === a) { matched.push(rule.keywords[i]); break; }
    if (scopeQ) matched = matched.concat(ac_matchAll_([q.question], rule.keywords));
  } else {
    var texts = []; if (scopeQ) texts.push(q.question); if (scopeA) texts.push(answer);
    matched = ac_matchAll_(texts, rule.keywords);
  }
  if (matched.length < Math.max(1, rule.min_matches)) return null;
  return { matched: matched, count: matched.length };
}

/** সব রুল চালিয়ে বিজয়ী: {status:"match"|"conflict"|"none", rule, matched, others[]} */
function ac_classify_(rules, q) {
  var answer = ac_answerText_(q), hits = [];
  rules.forEach(function (r) { var h = ac_evalRule_(r, q, answer); if (h) hits.push({ rule: r, matched: h.matched, count: h.count }); });
  if (!hits.length) return { status: "none" };
  hits.sort(function (a, b) { return (b.rule.priority - a.rule.priority) || (b.count - a.count); });
  var top = hits[0], tied = hits.filter(function (h) { return h.rule.priority === top.rule.priority && h.count === top.count && h.rule.topic_id !== top.rule.topic_id; });
  if (tied.length) return { status: "conflict", hits: hits };
  return { status: "match", rule: top.rule, matched: top.matched, hits: hits };
}


/* ───────────────────────── ট্যাগ সাজেস্ট: টপিকে আগে থেকে বসানো প্রশ্ন দেখে কোন শব্দ ওই টপিকের "নিজস্ব" ───────────────────────── */
var AC_BN_SUFFIX_ = ["গুলোর", "গুলোকে", "গুলো", "গুলি", "দের", "েরই", "ের", "কে", "তে", "টির", "টি", "টা"];
var AC_STOP_ = { "the": 1, "and": 1, "for": 1, "are": 1, "was": 1, "were": 1, "that": 1, "this": 1, "with": 1, "from": 1, "which": 1, "what": 1, "has": 1, "have": 1, "had": 1, "not": 1, "his": 1, "her": 1, "its": 1, "they": 1, "their": 1, "who": 1, "how": 1, "when": 1, "where": 1, "কত": 1, "কী": 1, "কি": 1, "কোন": 1, "কোনটি": 1, "কোনটা": 1, "এবং": 1, "ও": 1, "এই": 1, "ওই": 1, "যে": 1, "যা": 1, "না": 1, "হয়": 1, "হল": 1, "হলে": 1, "থেকে": 1, "জন্য": 1, "করে": 1, "করা": 1, "হবে": 1, "কোনো": 1, "একটি": 1, "তার": 1, "এর": 1 };
function ac_stem_(w) {
  if (!/[\u0980-\u09FF]/.test(w)) return w;
  for (var i = 0; i < AC_BN_SUFFIX_.length; i++) { var sf = AC_BN_SUFFIX_[i]; if (w.length - sf.length >= 3 && w.slice(-sf.length) === sf) return w.slice(0, -sf.length); }
  return w;
}
function ac_tokens_(text) {
  var t = ac_norm_(text).toLowerCase(), out = {}, m, re = /[a-z][a-z'-]{2,}|[\u0980-\u09FF]{2,}/g;
  while ((m = re.exec(t)) !== null) { var w = ac_stem_(m[0].replace(/^['-]+|['-]+$/g, "")); if (w.length >= (/[\u0980-\u09FF]/.test(w) ? 3 : 3) && !AC_STOP_[w]) out[w] = 1; }
  return out;
}
/** topicId-র প্রশ্নে কোন শব্দ/উত্তর বেশি আর অন্য টপিকে কম — scope: "question" | "answer" (answer = পুরো উত্তর, ≤৩ শব্দ) */
function ac_suggest_(ss, topicId, scope) {
  var sh = ss.getSheetByName(Q_UNIFIED_SHEET_); if (!sh || sh.getLastRow() < 2) return { error: "Questions ফাঁকা" };
  var H = qHeader_(sh), ix = H.idx, n = sh.getLastRow() - 1, vals = sh.getRange(2, 1, n, H.lc).getValues();
  var inTopic = {}, all = {}, nTopic = 0, nAll = 0;
  for (var i = 0; i < n; i++) {
    var row = vals[i]; if (!String(row[ix["id"]] || "").trim()) continue;
    var sid = String(row[ix["subjectid"]] || "").trim(), tid = String(row[ix["topicid"]] || "").trim();
    if (!qIsClassified_(sid) || !tid) continue;                       // শুধু হাতে/আগে থেকে ঠিক করা প্রশ্ন থেকে শেখা
    if (String(row[ix["questiontype"]] || "").trim().toLowerCase() === "written") continue;
    var q = ac_qObj_(row, ix), toks = {};
    if (scope === "answer") { var a = ac_answerText_(q).replace(/[\s.,;:!?'"।]+$/g, "").replace(/^[\s'"]+/, "").toLowerCase(); if (a && ac_wordCount_(a) <= 3) toks[a] = 1; }
    else toks = ac_tokens_(q.question);
    nAll++; var mine = (tid === topicId); if (mine) nTopic++;
    for (var k in toks) { all[k] = (all[k] || 0) + 1; if (mine) inTopic[k] = (inTopic[k] || 0) + 1; }
  }
  if (!nTopic) return { error: "এই টপিকে আগে থেকে ঠিক করা MCQ নেই — শেখার মতো ডাটা নেই", nTopic: 0 };
  var out = [];
  for (var w in inTopic) {
    var df = inTopic[w], tot = all[w]; if (df < Math.min(3, nTopic)) continue;
    var prec = df / tot, cov = df / nTopic; if (prec < 0.5) continue;
    out.push({ kw: w, inTopic: df, total: tot, precision: Math.round(prec * 100), coverage: Math.round(cov * 100), score: cov * prec * prec });
  }
  out.sort(function (a, b) { return b.score - a.score; });
  return { nTopic: nTopic, nAll: nAll, suggestions: out.slice(0, 40).map(function (o) { delete o.score; return o; }) };
}

/* ───────────────────────── শিট I/O ───────────────────────── */
function ac_readRules_(ss) {
  var sh = ss.getSheetByName(AC_RULES_SHEET_);
  var res = { rules: [], problems: [] };
  if (!sh) { res.problems.push("TopicRules শিট নেই — আগে rules_setup চালান"); return res; }
  var v = sh.getDataRange().getValues(); if (v.length < 2) return res;
  var h = v[0].map(function (x) { return String(x).trim(); });
  var ix = function (n) { return h.indexOf(n); };
  var topics = {}, tsh = ss.getSheetByName("Topics"), subjects = {};
  if (tsh && tsh.getLastRow() > 1) { var td = tsh.getDataRange().getValues(), th = td[0]; for (var i = 1; i < td.length; i++) topics[String(td[i][th.indexOf("topic_id")]).trim()] = { name: String(td[i][th.indexOf("topic_name")]).trim(), subject_id: String(td[i][th.indexOf("subject_id")]).trim() }; }
  var ssh = ss.getSheetByName("Subjects");
  if (ssh && ssh.getLastRow() > 1) { var sd = ssh.getDataRange().getValues(), sh2 = sd[0]; for (var j = 1; j < sd.length; j++) subjects[String(sd[j][sh2.indexOf("subject_id")]).trim()] = String(sd[j][sh2.indexOf("subject_name")]).trim(); }
  for (var r = 1; r < v.length; r++) {
    var row = v[r], rid = String(row[ix("rule_id")] || "").trim(); if (!rid && !String(row[ix("topic_id")] || "").trim()) continue;
    if (String(row[ix("active")] == null ? "Y" : row[ix("active")]).trim().toUpperCase() === "N") continue;
    var tid = String(row[ix("topic_id")] || "").trim(), t = topics[tid];
    var label = rid || ("সারি " + (r + 1));
    if (!t) { res.problems.push(label + ": topic_id '" + tid + "' Topics শিটে নেই — বাদ"); continue; }
    var kws = ac_splitList_(row[ix("keywords")]);
    if (!kws.length) { res.problems.push(label + ": keywords ফাঁকা — বাদ"); continue; }
    var mi = String(row[ix("match_in")] || "both").trim().toLowerCase();
    if (["question", "answer", "both"].indexOf(mi) < 0) { res.problems.push(label + ": match_in '" + mi + "' ভুল (question/answer/both) — বাদ"); continue; }
    res.rules.push({
      rule_id: rid || ("R" + (r + 1)), topic_id: tid, topic_name: t.name, subject_id: t.subject_id, subject_name: subjects[t.subject_id] || "",
      keywords: kws, match_in: mi, exclude: ac_splitList_(row[ix("exclude_keywords")]),
      min_matches: parseInt(row[ix("min_matches")], 10) || 1, priority: parseInt(row[ix("priority")], 10) || 0,
      require_blank: String(row[ix("require_blank")] || "").trim().toUpperCase() === "Y",
      answer_whole: String(row[ix("answer_whole")] || "").trim().toUpperCase() === "Y",
      answer_max_words: parseInt(row[ix("answer_max_words")], 10) || 0
    });
  }
  return res;
}

/** প্রার্থী প্রশ্ন বাছাই — শুধু QBank-এ থাকা MCQ (শুধু-Quiz প্রশ্ন, Written, LOCK বা "ঠিক আছে" চিহ্নিত অটো-মুভ কখনো নয়)।
 *  mode: "blank" (ডিফল্ট) = শুধু Subject ফাঁকা/পুল · "subject" = বাছা subj-এর ঠিক-করা প্রশ্নও · "all" = সব ঠিক-করা প্রশ্নও */
function ac_isCandidate_(row, ix, mode, subj) {
  var g = function (k) { var c = ix[k]; return c === undefined ? "" : row[c]; };
  if (!String(g("id")).trim() || !String(g("question")).trim()) return false;
  if (String(g("questiontype")).trim().toLowerCase() === "written") return false;
  if (ix["inqbank"] !== undefined && !qY_(g("inqbank"))) return false;
  var ar = String(g("autorule")).trim();
  if (ar === "LOCK" || ar.indexOf("OK:") === 0) return false;
  var sid = String(g("subjectid")).trim();
  if (!qIsClassified_(sid)) return true;                       // ফাঁকা/পুল — সবসময় প্রার্থী
  if (mode === "all") return true;
  if (mode === "subject") return sid === String(subj || "").trim();
  return false;
}
function ac_qObj_(row, ix) {
  var g = function (k) { var c = ix[k]; return c === undefined ? "" : row[c]; };
  return { id: String(g("id")).trim(), question: String(g("question")), option1: g("option1"), option2: g("option2"), option3: g("option3"), option4: g("option4"), correct: g("correct") };
}

/** পুরো রান — apply=false হলে শুধু হিসাব */
function ac_run_(apply, onlyRuleId, mode, subj, opts) {
  opts = opts || {};
  var incSet = null, excSet = {};
  if (opts.includeIds && opts.includeIds.length) { incSet = {}; opts.includeIds.forEach(function (x) { incSet[String(x)] = 1; }); }
  (opts.excludeIds || []).forEach(function (x) { excSet[String(x)] = 1; });
  mode = (mode === "subject" || mode === "all") ? mode : "blank";
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(Q_UNIFIED_SHEET_);
  if (!sh) return { error: "Questions শিট নেই" };
  var rr = ac_readRules_(ss);
  if (onlyRuleId) rr.rules = rr.rules.filter(function (r) { return r.rule_id === onlyRuleId; });
  if (mode === "subject") rr.rules = rr.rules.filter(function (r) { return r.subject_id === String(subj || "").trim(); });   // এই Subject-এর রুল দিয়েই শুধু
  if (!rr.rules.length) return { error: "কোনো সক্রিয় ও বৈধ রুল নেই" + (rr.problems.length ? " — " + rr.problems.join(" | ") : ""), problems: rr.problems };
  var H = qHeader_(sh), ix = H.idx;
  if (apply) {
    var miss = AC_NEW_COLS_.filter(function (c) { return ix[qNormKey_(c)] === undefined; });
    if (miss.length) return { error: "Questions-এ কলাম নেই: " + miss.join(", ") + " — আগে rules_setup চালান" };
  }
  var n = sh.getLastRow() - 1; if (n < 1) return { error: "Questions ফাঁকা" };
  var vals = sh.getRange(2, 1, n, H.lc).getValues();
  var tmap = ac_topicMap_(ss), subjNames = {}; Object.keys(tmap).forEach(function (k) { subjNames[tmap[k].subject_id] = tmap[k].subject_name; });
  var curLabel = function (row) { var t = ix["topicid"] !== undefined ? tmap[String(row[ix["topicid"]] || "").trim()] : null; return t ? t.subject_name + " › " + t.name : (String(row[ix["subjectid"]] || "").trim() ? (subjNames[String(row[ix["subjectid"]]).trim()] || String(row[ix["subjectid"]]).trim()) : ""); };
  var res = { candidates: 0, matched: 0, same: 0, conflict: 0, none: 0, perRule: {}, samples: {}, conflictSamples: [], problems: rr.problems, changes: [], items: [], total: n, mode: mode };
  rr.rules.forEach(function (r) { res.perRule[r.rule_id] = 0; res.samples[r.rule_id] = []; });
  for (var i = 0; i < n; i++) {
    var row = vals[i]; if (!ac_isCandidate_(row, ix, mode, subj)) continue;
    res.candidates++;
    var q = ac_qObj_(row, ix), c = ac_classify_(rr.rules, q);
    if (c.status === "none") { res.none++; continue; }
    if (c.status === "conflict") { res.conflict++; if (res.conflictSamples.length < 8) res.conflictSamples.push({ id: q.id, q: q.question, rules: c.hits.map(function (h) { return h.rule.subject_name + " › " + h.rule.topic_name + " (" + h.matched.join("/") + ")"; }).join(" vs ") }); continue; }
    if (ix["topicid"] !== undefined && String(row[ix["topicid"]] || "").trim() === c.rule.topic_id && qIsClassified_(row[ix["subjectid"]])) { res.same++; continue; }   // আগে থেকেই ঠিক টপিকে
    res.matched++; res.perRule[c.rule.rule_id]++;
    if (!apply && res.items.length < 5000) res.items.push({ id: q.id, q: q.question, a: ac_answerText_(q), m: c.matched, from: curLabel(row), topic: c.rule.subject_name + " › " + c.rule.topic_name, rule: c.rule.rule_id });
    if (res.samples[c.rule.rule_id].length < 6) res.samples[c.rule.rule_id].push({ id: q.id, q: q.question, a: ac_answerText_(q), m: c.matched.join(", "), from: curLabel(row) });
    res.changes.push({ i: i, rule: c.rule, matched: c.matched });
  }
  res.rules = rr.rules;
  if (!apply) return res;

  // ── Apply: লক নিয়ে আবার পড়ে সেই একই হিসাব লিখি ──
  var lock = LockService.getScriptLock(); lock.waitLock(30000);
  try {
    H = qHeader_(sh); ix = H.idx; n = sh.getLastRow() - 1;
    vals = sh.getRange(2, 1, n, H.lc).getValues();
    var batch = Utilities.formatDate(new Date(), "Asia/Dhaka", "yyyy-MM-dd HH:mm:ss"), nowMs = Date.now(), dirty = {}, applied = 0, excluded = 0, perRuleApplied = {};
    var cols = ["subjectid", "topicid", "subject", "subtopic", "classified", "inquiz", "updatedat", "autorule", "automatched", "autoat", "autoprev"];
    var colArr = {}; cols.forEach(function (k) { if (ix[k] !== undefined) colArr[k] = vals.map(function (r) { return [r[ix[k]]]; }); });
    for (var j = 0; j < n; j++) {
      var row2 = vals[j]; if (!ac_isCandidate_(row2, ix, mode, subj)) continue;
      var q2 = ac_qObj_(row2, ix);
      if (excSet[q2.id]) { colArr["autorule"][j][0] = "LOCK"; excluded++; continue; }   // আনমার্ক করা — টপিক না বদলে LOCK, আর রুলে আসবে না
      if (incSet && !incSet[q2.id]) continue;                                           // Preview-তে যা দেখানো হয়েছিল শুধু তাই
      var c2 = ac_classify_(rr.rules, q2);
      if (c2.status !== "match") continue;
      if (String(row2[ix["topicid"]] || "").trim() === c2.rule.topic_id && qIsClassified_(row2[ix["subjectid"]])) continue;   // আগে থেকেই ঠিক
      var r = c2.rule, prev = String(row2[ix["autoprev"]] || "").trim() || [row2[ix["subjectid"]], row2[ix["topicid"]], row2[ix["subject"]], row2[ix["subtopic"]], row2[ix["inquiz"]]].join("§");   // প্রথম অটো-মুভের আগের অবস্থাই রাখি
      if (ix["topicid"] !== undefined && String(row2[ix["topicid"]] || "").trim()) dirty[String(row2[ix["topicid"]]).trim()] = 1;   // পুরনো টপিকও CDN-এ আপডেট হবে
      dirty[r.topic_id] = 1;
      colArr["subjectid"][j][0] = r.subject_id; colArr["topicid"][j][0] = r.topic_id;
      if (colArr["subject"]) colArr["subject"][j][0] = r.subject_name;
      if (colArr["subtopic"]) colArr["subtopic"][j][0] = r.topic_name;
      colArr["classified"][j][0] = "Y"; colArr["inquiz"][j][0] = "Y";
      if (colArr["updatedat"]) colArr["updatedat"][j][0] = nowMs;
      colArr["autorule"][j][0] = r.rule_id; colArr["automatched"][j][0] = c2.matched.join(", "); colArr["autoat"][j][0] = batch; colArr["autoprev"][j][0] = prev;
      applied++; perRuleApplied[r.rule_id] = (perRuleApplied[r.rule_id] || 0) + 1;
    }
    cols.forEach(function (k) { if (colArr[k]) sh.getRange(2, ix[k] + 1, n, 1).setValues(colArr[k].map(function (x) { var v = x[0]; return [(typeof v === "string" && v.charAt(0) === "'") ? "'" + v : v]; })); });
    markTopicsDirty(dirty); qRefreshTopicCounts_(ss);
    res.applied = applied; res.excluded = excluded; res.batch = batch; res.perRuleApplied = perRuleApplied; res.dirtyTopics = Object.keys(dirty).length;
  } finally { lock.releaseLock(); }
  return res;
}

function ac_undo_(onlyLast) {
  var ss = SpreadsheetApp.getActiveSpreadsheet(), sh = ss.getSheetByName(Q_UNIFIED_SHEET_);
  if (!sh) return { error: "Questions শিট নেই" };
  var H = qHeader_(sh), ix = H.idx;
  if (ix["autorule"] === undefined) return { error: "auto_* কলাম নেই — আগে rules_setup চালান" };
  var lock = LockService.getScriptLock(); lock.waitLock(30000);
  try {
    var n = sh.getLastRow() - 1, vals = sh.getRange(2, 1, n, H.lc).getValues(), last = "";
    if (onlyLast) vals.forEach(function (r) { var a = String(r[ix["autoat"]] || ""); var rl = String(r[ix["autorule"]] || ""); if (rl && rl !== "LOCK" && a > last) last = a; });
    var cols = ["subjectid", "topicid", "subject", "subtopic", "classified", "inquiz", "updatedat", "autorule", "automatched", "autoat", "autoprev"];
    var colArr = {}; cols.forEach(function (k) { if (ix[k] !== undefined) colArr[k] = vals.map(function (r) { return [r[ix[k]]]; }); });
    var undone = 0, dirty = {}, nowMs = Date.now();
    for (var i = 0; i < n; i++) {
      var rl = String(vals[i][ix["autorule"]] || "").trim(), prev = String(vals[i][ix["autoprev"]] || "");
      if (!rl || rl === "LOCK" || !prev) continue;
      if (onlyLast && String(vals[i][ix["autoat"]] || "") !== last) continue;
      var p = prev.split("§");
      dirty[String(vals[i][ix["topicid"]] || "").trim()] = 1; if (p[1]) dirty[p[1]] = 1;
      colArr["subjectid"][i][0] = p[0] || ""; colArr["topicid"][i][0] = p[1] || "";
      if (colArr["subject"]) colArr["subject"][i][0] = p[2] || ""; if (colArr["subtopic"]) colArr["subtopic"][i][0] = p[3] || "";
      colArr["classified"][i][0] = qIsClassified_(p[0]) ? "Y" : "N"; colArr["inquiz"][i][0] = p[4] === undefined ? colArr["inquiz"][i][0] : p[4];
      if (colArr["updatedat"]) colArr["updatedat"][i][0] = nowMs;
      colArr["autorule"][i][0] = "LOCK"; colArr["automatched"][i][0] = ""; colArr["autoprev"][i][0] = "";
      undone++;
    }
    cols.forEach(function (k) { if (colArr[k]) sh.getRange(2, ix[k] + 1, n, 1).setValues(colArr[k].map(function (x) { var v = x[0]; return [(typeof v === "string" && v.charAt(0) === "'") ? "'" + v : v]; })); });
    if (undone) { markTopicsDirty(dirty); qRefreshTopicCounts_(ss); }
    return { undone: undone, batch: last };
  } finally { lock.releaseLock(); }
}

/* ───────────────────────── রিপোর্ট ───────────────────────── */
function ac_writeReport_(lines) {
  var ss = SpreadsheetApp.getActiveSpreadsheet(), sh = ss.getSheetByName(AC_REPORT_SHEET_) || ss.insertSheet(AC_REPORT_SHEET_);
  var stamp = Utilities.formatDate(new Date(), "Asia/Dhaka", "dd/MM/yyyy HH:mm:ss");
  var out = lines.map(function (l) { return [String(l).substring(0, 2000)]; });
  var start = sh.getLastRow() + 1;
  sh.getRange(start, 1, out.length, 1).setValues(out);
  sh.setColumnWidth(1, 900);
  return stamp;
}
function ac_trunc_(s, n) { s = ac_norm_(s); return s.length > n ? s.substring(0, n) + "…" : s; }
function ac_reportLines_(res, title) {
  var L = [""];
  if (res.error) { L.push("❌ " + title + " — " + res.error); return L; }
  var stamp = Utilities.formatDate(new Date(), "Asia/Dhaka", "dd/MM/yyyy HH:mm:ss");
  L.push("🔎 " + title + " — " + stamp);
  L.push("Questions " + res.total + " সারি · প্রার্থী (QBank MCQ, classified নয়): " + res.candidates);
  L.push("✔ মিলেছে (অটো-মুভ): " + res.matched + " · ⚠ দ্বন্দ্ব: " + res.conflict + " · কোনো রুল মেলেনি: " + res.none);
  res.problems.forEach(function (p) { L.push("⚠ রুল সমস্যা: " + p); });
  res.rules.forEach(function (r) {
    L.push("");
    L.push("▶ " + r.rule_id + " → " + r.subject_name + " / " + r.topic_name + " (" + r.topic_id + ") · match_in=" + r.match_in + " · মিলেছে: " + res.perRule[r.rule_id]);
    res.samples[r.rule_id].forEach(function (s) { L.push("   • " + s.id + " [" + s.m + "] " + ac_trunc_(s.q, 90) + "  ⇒ উত্তর: " + ac_trunc_(s.a, 30)); });
  });
  if (res.conflictSamples.length) { L.push(""); L.push("⚠ দ্বন্দ্বের নমুনা (হাতে টপিক বসাতে হবে):"); res.conflictSamples.forEach(function (c) { L.push("   • " + c.id + " " + ac_trunc_(c.q, 80) + " ⇒ " + c.rules); }); }
  return L;
}

/* ───────────────────────── Editor থেকে চালানোর ফাংশন ───────────────────────── */
function rules_setup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet(), msg = [];
  // ১) Questions-এ auto_* কলাম
  var q = ss.getSheetByName(Q_UNIFIED_SHEET_);
  if (!q) { ac_writeReport_(["❌ Questions শিট নেই"]); return; }
  var H = qHeader_(q), lc = H.lc, added = [];
  AC_NEW_COLS_.forEach(function (c) { if (H.idx[qNormKey_(c)] === undefined) { lc++; q.getRange(1, lc).setValue(c); q.getRange(2, lc, Math.max(1, q.getMaxRows() - 1), 1).setNumberFormat("@"); added.push(c); } });
  msg.push(added.length ? "✅ Questions-এ কলাম যোগ: " + added.join(", ") : "ℹ️ Questions-এ auto_* কলাম আগে থেকেই আছে");
  // ২) TopicRules শিট
  var tr = ss.getSheetByName(AC_RULES_SHEET_);
  if (tr) { msg.push("ℹ️ TopicRules আগে থেকেই আছে — নমুনা রুল যোগ করা হয়নি"); }
  else {
    tr = ss.insertSheet(AC_RULES_SHEET_);
    tr.getRange(1, 1, 1, AC_RULE_HDR_.length).setValues([AC_RULE_HDR_]).setFontWeight("bold");
    tr.setFrozenRows(1);
    var topics = {}, ts = ss.getSheetByName("Topics");
    if (ts && ts.getLastRow() > 1) { var d = ts.getDataRange().getValues(); for (var i = 1; i < d.length; i++) topics[String(d[i][d[0].indexOf("topic_id")]).trim()] = 1; }
    var pl = topics["S04_T31"] ? "Y" : "N", pp = topics["S03_T24"] ? "Y" : "N";
    var rows = [
      ["PROFIT_LOSS", "S04_T31", "", "ক্রয়মূল্য, বিক্রয়মূল্য, ক্রয়, বিক্রয়, লাভ, ক্ষতি, লোকসান, profit, loss, cost price, selling price", "question", "", 2, 0, "N", "N", "", pl, "পাটিগণিত → লাভ-ক্ষতি। কমপক্ষে ২টা ভিন্ন ট্যাগ মিললে। min_matches কমালে বেশি ধরবে, ভুলও বাড়বে।"],
      ["PREPOSITION", "S03_T24", "", AC_PREP_KEYWORDS_, "answer", "", 1, 0, "Y", "Y", "", pp, "প্রশ্নে ফাঁকা (____) থাকতে হবে এবং পুরো উত্তরটাই একটা preposition হতে হবে। 'went to'-র মতো উত্তর ধরবে না।"]
    ];
    tr.getRange(2, 1, rows.length, rows[0].length).setValues(rows);
    tr.getRange(2, 3, rows.length, 1).setFormulas(rows.map(function (r, k) { return ['=IFERROR(VLOOKUP(B' + (k + 2) + ',Topics!A:B,2,FALSE),"")']; }));
    tr.setColumnWidth(4, 420); tr.setColumnWidth(13, 420);
    msg.push("✅ TopicRules শিট তৈরি (২টা নমুনা রুল)" + (pl === "N" || pp === "N" ? " — ⚠ কিছু topic_id Topics-এ পাওয়া যায়নি, ওই রুল active=N" : ""));
  }
  msg.push("➡ এখন rules_preview চালান।");
  ac_writeReport_([""].concat(msg));
}
function rules_preview() {
  var res = ac_run_(false);
  ac_writeReport_(ac_reportLines_(res, "PREVIEW (কিছু বদলানো হয়নি)").concat(res.error ? [] : ["➡ ঠিক লাগলে rules_apply চালান।"]));
}
function rules_apply() {
  var res = ac_run_(true);
  var L = ac_reportLines_(res, "APPLY");
  if (!res.error) {
    L.push(""); L.push("✅ বদলানো হয়েছে: " + res.applied + "টি প্রশ্ন · batch " + res.batch + " · dirty টপিক " + res.dirtyTopics);
    Object.keys(res.perRuleApplied).forEach(function (k) { L.push("   " + k + ": " + res.perRuleApplied[k]); });
    L.push("➡ এখন Admin → Publish ট্যাবে Publish Now চালান। ভুল মনে হলে rules_undoLast।");
  }
  ac_writeReport_(L);
}
function rules_undoLast() { var r = ac_undo_(true); ac_writeReport_(["", r.error ? "❌ UNDO — " + r.error : "↩ UNDO (সর্বশেষ batch " + r.batch + "): " + r.undone + "টি প্রশ্ন আগের অবস্থায় ফিরেছে, LOCK হয়েছে। Publish Now চালান।"]); }
function rules_undoAll() { var r = ac_undo_(false); ac_writeReport_(["", r.error ? "❌ UNDO ALL — " + r.error : "↩ UNDO ALL: " + r.undone + "টি প্রশ্ন আগের অবস্থায় ফিরেছে, LOCK হয়েছে। Publish Now চালান।"]); }


/* ══════════════════════════════════════════════════════════════════════════════════════
   ধাপ ২ — ADMIN APP API (doGet: action=tt_* · doPost: type=tt_*)
   ══════════════════════════════════════════════════════════════════════════════════════ */
var AC_SETTING_UPLOAD_ = "AUTO_ON_UPLOAD";   // Script Property: Y (ডিফল্ট) / N

function ac_uploadEnabled_() { return (PropertiesService.getScriptProperties().getProperty(AC_SETTING_UPLOAD_) || "Y") !== "N"; }

/** TopicRules শিট না থাকলে (নমুনা রুল ছাড়া) বানায়; Questions-এ auto_* কলাম না থাকলে যোগ করে */
function ac_ensureInfra_(ss) {
  var q = ss.getSheetByName(Q_UNIFIED_SHEET_);
  if (!q) throw new Error("Questions শিট নেই");
  var H = qHeader_(q), lc = H.lc;
  AC_NEW_COLS_.forEach(function (c) { if (H.idx[qNormKey_(c)] === undefined) { lc++; q.getRange(1, lc).setValue(c); q.getRange(2, lc, Math.max(1, q.getMaxRows() - 1), 1).setNumberFormat("@"); } });
  var tr = ss.getSheetByName(AC_RULES_SHEET_);
  if (!tr) { tr = ss.insertSheet(AC_RULES_SHEET_); tr.getRange(1, 1, 1, AC_RULE_HDR_.length).setValues([AC_RULE_HDR_]).setFontWeight("bold"); tr.setFrozenRows(1); tr.setColumnWidth(4, 420); tr.setColumnWidth(13, 420); }
  return tr;
}
function ac_hasAutoCols_(ss) {
  var q = ss.getSheetByName(Q_UNIFIED_SHEET_); if (!q) return false;
  var H = qHeader_(q); return AC_NEW_COLS_.every(function (c) { return H.idx[qNormKey_(c)] !== undefined; });
}
function ac_topicMap_(ss) {
  var m = {}, tsh = ss.getSheetByName("Topics"), subj = {}, ssh = ss.getSheetByName("Subjects");
  if (ssh && ssh.getLastRow() > 1) { var sd = ssh.getDataRange().getValues(), sh = sd[0]; for (var j = 1; j < sd.length; j++) subj[String(sd[j][sh.indexOf("subject_id")]).trim()] = String(sd[j][sh.indexOf("subject_name")]).trim(); }
  if (tsh && tsh.getLastRow() > 1) { var td = tsh.getDataRange().getValues(), th = td[0]; for (var i = 1; i < td.length; i++) { var id = String(td[i][th.indexOf("topic_id")]).trim(); if (id) m[id] = { topic_id: id, name: String(td[i][th.indexOf("topic_name")]).trim(), subject_id: String(td[i][th.indexOf("subject_id")]).trim(), subject_name: subj[String(td[i][th.indexOf("subject_id")]).trim()] || "" }; } }
  return m;
}

/** শিটের সারি → রুল-অবজেক্ট (UI-র জন্য কাঁচা মান) */
function ac_rawRules_(ss) {
  var sh = ss.getSheetByName(AC_RULES_SHEET_); if (!sh || sh.getLastRow() < 2) return [];
  var v = sh.getDataRange().getValues(), h = v[0].map(function (x) { return String(x).trim(); }), out = [];
  for (var r = 1; r < v.length; r++) {
    var o = { row: r + 1 };
    AC_RULE_HDR_.forEach(function (k) { var c = h.indexOf(k); o[k] = c >= 0 ? v[r][c] : ""; });
    if (!String(o.rule_id).trim() && !String(o.topic_id).trim()) continue;
    o.rule_id = String(o.rule_id).trim(); o.topic_id = String(o.topic_id).trim();
    o.active = String(o.active === "" ? "Y" : o.active).trim().toUpperCase() === "N" ? "N" : "Y";
    out.push(o);
  }
  return out;
}

/** UI-র রুল-ফর্ম → ac_evalRule_-এর রুল-অবজেক্ট (যাচাইসহ) — ড্রাফট টেস্ট ও সেভ দুটোতেই */
function ac_buildRule_(raw, topics) {
  var tid = String(raw.topic_id || "").trim(), t = topics[tid];
  if (!t) throw new Error("topic_id '" + tid + "' Topics-এ নেই");
  var kws = ac_splitList_(raw.keywords); if (!kws.length) throw new Error("keywords ফাঁকা");
  var mi = String(raw.match_in || "both").trim().toLowerCase();
  if (["question", "answer", "both"].indexOf(mi) < 0) throw new Error("match_in হতে হবে question/answer/both");
  var yn = function (v) { return String(v || "").trim().toUpperCase() === "Y"; };
  return { rule_id: String(raw.rule_id || "DRAFT"), topic_id: tid, topic_name: t.name, subject_id: t.subject_id, subject_name: t.subject_name,
    keywords: kws, match_in: mi, exclude: ac_splitList_(raw.exclude_keywords), min_matches: parseInt(raw.min_matches, 10) || 1, priority: parseInt(raw.priority, 10) || 0,
    require_blank: yn(raw.require_blank), answer_whole: yn(raw.answer_whole), answer_max_words: parseInt(raw.answer_max_words, 10) || 0 };
}

/** একটা রুল একটা প্রশ্নে কেন মিলল/মিলল না — টেস্ট বক্সের জন্য */
function ac_explain_(rule, q, answer) {
  var hit = ac_evalRule_(rule, q, answer);
  if (hit) return { rule_id: rule.rule_id, topic: rule.subject_name + " / " + rule.topic_name, hit: true, matched: hit.matched, reason: "মিলেছে" };
  var why = "";
  if (rule.require_blank && !ac_hasBlank_(q.question)) why = "প্রশ্নে ফাঁকা (____) নেই";
  else if (rule.answer_max_words && ac_wordCount_(answer) > rule.answer_max_words) why = "উত্তর " + rule.answer_max_words + " শব্দের বেশি";
  else if (rule.exclude.length && ac_matchAll_([q.question, answer], rule.exclude).length) why = "বাদ-শব্দ পাওয়া গেছে: " + ac_matchAll_([q.question, answer], rule.exclude).join(", ");
  else if (rule.answer_whole && (rule.match_in === "answer" || rule.match_in === "both")) why = "পুরো উত্তরটা কোনো ট্যাগ নয়";
  else {
    var texts = []; if (rule.match_in !== "answer") texts.push(q.question); if (rule.match_in !== "question") texts.push(answer);
    var m = ac_matchAll_(texts, rule.keywords); why = "মিল " + m.length + "টি" + (m.length ? " (" + m.join(", ") + ")" : "") + ", দরকার " + Math.max(1, rule.min_matches) + "টি";
  }
  return { rule_id: rule.rule_id, topic: rule.subject_name + " / " + rule.topic_name, hit: false, matched: [], reason: why };
}

/** আপলোডের সময়: সক্রিয় থাকলে রুলগুলো একবার লোড করে ফেরত, নাহলে null */
function ac_uploadContext_(ss, ix) {
  try {
    if (!ac_uploadEnabled_() || !ss.getSheetByName(AC_RULES_SHEET_) || !ac_hasAutoCols_(ss)) return null;
    var rr = ac_readRules_(ss); return rr.rules.length ? { rules: rr.rules } : null;
  } catch (err) { logError_("ac_uploadContext_", String(err)); return null; }
}

function ac_slim_(res) {
  if (res.error) return { status: "error", message: res.error, problems: res.problems || [] };
  var rules = (res.rules || []).map(function (r) { return { rule_id: r.rule_id, topic: r.subject_name + " / " + r.topic_name, topic_id: r.topic_id, count: res.perRule[r.rule_id] || 0, applied: res.perRuleApplied ? (res.perRuleApplied[r.rule_id] || 0) : undefined, samples: res.samples[r.rule_id] || [] }; });
  return { status: "success", total: res.total, candidates: res.candidates, matched: res.matched, same: res.same || 0, mode: res.mode, items: res.items || [], excluded: res.excluded || 0, conflict: res.conflict, none: res.none, rules: rules, conflictSamples: res.conflictSamples, problems: res.problems, applied: res.applied, batch: res.batch, dirtyTopics: res.dirtyTopics };
}

/** একটা প্রশ্ন-আইডির শিট-সারি (১-ভিত্তিক) */
function ac_findRow_(sh, ix, id) {
  var n = sh.getLastRow() - 1; if (n < 1) return 0;
  var ids = sh.getRange(2, ix["id"] + 1, n, 1).getValues();
  for (var i = 0; i < n; i++) if (String(ids[i][0]).trim() === id) return i + 2;
  return 0;
}

function ac_review_(ss, kind, cursor, limit) {
  var sh = ss.getSheetByName(Q_UNIFIED_SHEET_); var H = qHeader_(sh), ix = H.idx;
  if (ix["autorule"] === undefined) return { status: "success", items: [], total: 0, nextCursor: null };
  var n = sh.getLastRow() - 1; if (n < 1) return { status: "success", items: [], total: 0, nextCursor: null };
  var vals = sh.getRange(2, 1, n, H.lc).getValues(), items = [];
  var g = function (row, k) { var c = ix[k]; return c === undefined ? "" : row[c]; };
  if (kind === "conflict") {
    var rr = ac_readRules_(ss);
    for (var i = 0; i < n; i++) {
      var row = vals[i]; if (!ac_isCandidate_(row, ix, "blank", "")) continue;
      var q = ac_qObj_(row, ix), c = ac_classify_(rr.rules, q);
      if (c.status === "conflict") items.push({ id: q.id, question: ac_trunc_(q.question, 180), answer: ac_trunc_(ac_answerText_(q), 60), detail: c.hits.map(function (h) { return h.rule.subject_name + " › " + h.rule.topic_name + " (" + h.matched.join(", ") + ")"; }).join("  vs  ") });
    }
  } else {
    for (var j = 0; j < n; j++) {
      var r2 = vals[j], ar = String(g(r2, "autorule") || "").trim();
      if (!ar || ar === "LOCK" || ar.indexOf("OK:") === 0) continue;
      items.push({ id: String(g(r2, "id")).trim(), question: ac_trunc_(g(r2, "question"), 180), answer: ac_trunc_(ac_answerText_(ac_qObj_(r2, ix)), 60), rule: ar, matched: String(g(r2, "automatched") || ""), subject: String(g(r2, "subject") || ""), topic: String(g(r2, "subtopic") || ""), topic_id: String(g(r2, "topicid") || ""), at: String(g(r2, "autoat") || "") });
    }
    items.sort(function (a, b) { return a.at < b.at ? 1 : a.at > b.at ? -1 : 0; });
  }
  var total = items.length, st = parseInt(cursor, 10) || 0, lim = Math.min(200, parseInt(limit, 10) || 50), page = items.slice(st, st + lim);
  return { status: "success", items: page, total: total, nextCursor: (st + lim < total) ? st + lim : null };
}

function ac_undoOne_(ss, id, confirmOnly) {
  var sh = ss.getSheetByName(Q_UNIFIED_SHEET_), H = qHeader_(sh), ix = H.idx;
  var row = ac_findRow_(sh, ix, id); if (!row) return { status: "error", message: "প্রশ্ন পাওয়া যায়নি: " + id };
  var rv = sh.getRange(row, 1, 1, H.lc).getValues()[0], ar = String(rv[ix["autorule"]] || "").trim(), prev = String(rv[ix["autoprev"]] || "");
  if (!ar || ar === "LOCK") return { status: "error", message: "এই প্রশ্ন অটো-মুভ করা না" };
  var set = function (k, v) { if (ix[k] !== undefined) sh.getRange(row, ix[k] + 1).setValue(v); };
  if (confirmOnly) { set("autorule", "OK:" + ar.replace(/^OK:/, "")); set("autoprev", ""); return { status: "success" }; }
  if (!prev) return { status: "error", message: "আগের অবস্থার তথ্য নেই (auto_prev ফাঁকা)" };
  var p = prev.split("§"), dirty = {}; dirty[String(rv[ix["topicid"]] || "").trim()] = 1; if (p[1]) dirty[p[1]] = 1;
  set("subjectid", p[0] || ""); set("topicid", p[1] || ""); set("subject", p[2] || ""); set("subtopic", p[3] || "");
  set("classified", qIsClassified_(p[0]) ? "Y" : "N"); if (p[4] !== undefined) set("inquiz", p[4]);
  set("updatedat", Date.now()); set("autorule", "LOCK"); set("automatched", ""); set("autoprev", "");
  markTopicsDirty(dirty); qRefreshTopicCounts_(ss);
  return { status: "success" };
}

function ac_wrap_(r) { return r.error ? { status: "error", message: r.error } : Object.assign({ status: "success" }, r); }

/** HTTP রাউটার — p = e.parameter (GET) বা POST body */
function ac_handleAction_(name, p) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  try {
    if (name === "tt_getSettings") {
      var has = !!ss.getSheetByName(AC_RULES_SHEET_), cols = ac_hasAutoCols_(ss), cnt = 0;
      if (has) cnt = ac_rawRules_(ss).filter(function (r) { return r.active === "Y"; }).length;
      return { status: "success", uploadAuto: ac_uploadEnabled_(), rulesSheet: has, autoCols: cols, activeRules: cnt };
    }
    if (name === "tt_setSettings") { PropertiesService.getScriptProperties().setProperty(AC_SETTING_UPLOAD_, String(p.uploadAuto) === "N" ? "N" : "Y"); return { status: "success", uploadAuto: String(p.uploadAuto) !== "N" }; }
    if (name === "tt_setup") { ac_ensureInfra_(ss); return { status: "success" }; }
    if (name === "tt_getRules") { return { status: "success", exists: !!ss.getSheetByName(AC_RULES_SHEET_), rules: ac_rawRules_(ss) }; }
    if (name === "tt_saveRule") {
      var topics = ac_topicMap_(ss), raw = p.rule || {}, built = ac_buildRule_(raw, topics);
      return withWriteLock(function () {
        var tr = ac_ensureInfra_(ss), v = tr.getDataRange().getValues(), h = v[0].map(function (x) { return String(x).trim(); });
        var rid = String(raw.rule_id || "").trim();
        if (!rid) { var base = "R_" + built.topic_id, k = 1, used = {}; for (var i = 1; i < v.length; i++) used[String(v[i][h.indexOf("rule_id")]).trim()] = 1; rid = base; while (used[rid]) { k++; rid = base + "_" + k; } }
        var row = parseInt(raw.row, 10) || 0;
        if (!row) { for (var j = 1; j < v.length; j++) if (String(v[j][h.indexOf("rule_id")]).trim() === rid) { row = j + 1; break; } }
        var vals = AC_RULE_HDR_.map(function (k2) {
          if (k2 === "rule_id") return rid; if (k2 === "topic_name") return built.topic_name;
          if (k2 === "active") return String(raw.active || "Y").toUpperCase() === "N" ? "N" : "Y";
          if (k2 === "match_in") return built.match_in;
          if (k2 === "require_blank" || k2 === "answer_whole") return String(raw[k2] || "").toUpperCase() === "Y" ? "Y" : "N";
          var x = raw[k2]; return x == null ? "" : x;
        });
        if (row) tr.getRange(row, 1, 1, vals.length).setValues([vals]); else { row = tr.getLastRow() + 1; tr.getRange(row, 1, 1, vals.length).setValues([vals]); }
        return { status: "success", rule_id: rid, row: row };
      });
    }
    if (name === "tt_deleteRule") {
      var tr2 = ss.getSheetByName(AC_RULES_SHEET_); if (!tr2) return { status: "error", message: "TopicRules নেই" };
      var row2 = parseInt(p.row, 10) || 0, rid2 = String(p.rule_id || "").trim();
      if (rid2) { var v2 = tr2.getDataRange().getValues(), c2 = v2[0].indexOf("rule_id"); for (var q = 1; q < v2.length; q++) if (String(v2[q][c2]).trim() === rid2) { row2 = q + 1; break; } }
      if (row2 < 2) return { status: "error", message: "রুল পাওয়া যায়নি" };
      tr2.deleteRow(row2); return { status: "success" };
    }
    if (name === "tt_test") {
      var topics2 = ac_topicMap_(ss), qq = p.q || {}, rules = [];
      if (p.rule) rules.push(ac_buildRule_(p.rule, topics2));
      else rules = ac_readRules_(ss).rules;
      if (!rules.length) return { status: "error", message: "কোনো রুল নেই" };
      var qo = { id: "TEST", question: String(qq.question || ""), option1: qq.option1, option2: qq.option2, option3: qq.option3, option4: qq.option4, correct: qq.correct };
      var ans = ac_answerText_(qo), ex = rules.map(function (r) { return ac_explain_(r, qo, ans); }), c3 = ac_classify_(rules, qo);
      return { status: "success", answer: ans, result: c3.status, winner: c3.status === "match" ? { rule_id: c3.rule.rule_id, topic: c3.rule.subject_name + " / " + c3.rule.topic_name, topic_id: c3.rule.topic_id, matched: c3.matched } : null, explain: ex };
    }
    if (name === "tt_suggest") { var sg = ac_suggest_(ss, String(p.topic_id || "").trim(), p.scope === "answer" ? "answer" : "question"); return sg.error ? { status: "error", message: sg.error } : Object.assign({ status: "success" }, sg); }
    if (name === "tt_preview") return ac_slim_(ac_run_(false, p.ruleId || "", p.mode || "blank", p.subject_id || ""));
    if (name === "tt_apply") { if (!ac_hasAutoCols_(ss)) ac_ensureInfra_(ss); return ac_slim_(ac_run_(true, p.ruleId || "", p.mode || "blank", p.subject_id || "", { includeIds: p.includeIds, excludeIds: p.excludeIds })); }
    if (name === "tt_undoLast") return ac_wrap_(ac_undo_(true));
    if (name === "tt_undoAll") return ac_wrap_(ac_undo_(false));
    if (name === "tt_review") return ac_review_(ss, p.kind === "conflict" ? "conflict" : "auto", p.cursor, p.limit);
    if (name === "tt_undoOne") return ac_undoOne_(ss, String(p.id || "").trim(), false);
    if (name === "tt_confirmOne") return ac_undoOne_(ss, String(p.id || "").trim(), true);
    return { status: "error", message: "অজানা tt action: " + name };
  } catch (err) { return { status: "error", message: String(err && err.message || err) }; }
}
