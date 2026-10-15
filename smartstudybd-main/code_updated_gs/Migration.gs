/* ═══════════════════════════════════════════════════════════════════════════
   Migration.gs — Quiz + QBank → একটাই `Questions` শিট (STEP 3)

   🔒 নিরাপত্তা: এই ফাইলের কোনো ফাংশন পুরনো QBank / Quiz / Exam_Appearances শিটে কিছু লেখে না, মোছে না।
      শুধু নতুন শিট বানায়: `Questions`, `Exam_Appearances_v2`, `_Migration_Report`।
      (পুরনোগুলো মোছার কাজ আলাদা, সব যাচাইয়ের পরে — এই ফাইলে নেই।)

   ▶ কীভাবে চালাবেন (ফোনের ব্রাউজারে script.google.com, "Desktop site" চালু করে):
      ১) Apps Script প্রজেক্টে "+" → Script → নাম `Migration` → এই পুরো কোড পেস্ট → Save
      ২) ওপরের ফাংশন-ড্রপডাউন থেকে বেছে ▶ Run চাপুন, এই ক্রমে:
           mig1_backup   → পুরো স্প্রেডশিটের কপি Drive-এ (লিংক `_Migration_Report`-এ)
           mig2_dryRun   → শুধু যাচাই; ফল `_Migration_Report` শিটে (✅/❌ প্রথম লাইনে)
           mig3_build    → নতুন `Questions` ও `Exam_Appearances_v2` বানায় (mig2 ✅ না হলে চলে না)
           mig4_verify   → বানানো শিট আবার পুরনোর সাথে মিলিয়ে দেখে
      ৩) প্রতিবার ফল দেখতে Google Sheets অ্যাপে `_Migration_Report` ট্যাব খুলুন।

   নিয়ম (ব্যবহারকারীর সাথে চূড়ান্ত):
     • QBank  QB-00247 → QN000247 (নম্বর হুবহু, ৬ সংখ্যা)
     • Quiz-only প্রশ্ন → QN(সর্বোচ্চ QB নম্বর + ১) থেকে ক্রমানুসারে
     • Quiz-এ ও QBank-এ একই প্রশ্ন (টেক্সট + Question Type + অপশন-সেট + উত্তর হুবহু) → একটাই সারি, in_quiz=Y
       টেক্সট এক কিন্তু অপশন/উত্তর আলাদা → আলাদা প্রশ্নই থাকে (মার্জ হয় না)
     • in_quiz: Quiz থেকে আসা সারি = Y (Quiz থেকে কিছু সরে না)। QBank-এর MCQ-তে Subject/Topic ঠিক করা থাকলে (classified=Y)
       আপনা-আপনি Y (যেমন ৪৫তম বিসিএস)। Subject/Topic ঠিক না থাকলে (পুল) বা Written হলে N — শুধু QBank-এ থাকে
     • classified = N যদি subject_id ∈ MIG_POOL_SUBJECTS বা ফাঁকা
     • AudienceTags নাম+আইডি; ফাঁকা = Job (TAG01); নাম/আইডি অমিল হলে নাম জেতে (Masters 1 → TAG02)
     • ৪টার কম option-এর MCQ: ফাঁকা slot-এ MIG_PLACEHOLDER বসে (অ্যাপে সার্চ করে ঠিক করার জন্য)
     • `correct`/সাল/অন্য অসঙ্গতি যেমন আছে তেমনই থাকে — ছোঁয়া হয় না
   ═══════════════════════════════════════════════════════════════════════════ */

var MIG_POOL_SUBJECTS = ["S13", "S16", "S30"];      // Unidentified / BCS পুল → classified = N
var MIG_PLACEHOLDER   = "(অপশন যোগ করুন)";
var MIG_FILL_MISSING_OPTIONS = true;
var MIG_QN_WIDTH = 6;
var MIG_JOB_ID = "TAG01", MIG_JOB_NAME = "Job";
var MIG_REPORT = "_Migration_Report";

var MIG_OUT_COLS = [
  "id", "legacy_id",
  "question", "option1", "option2", "option3", "option4", "correct", "explanation", "technique",
  "Question Type", "group_id", "group_heading", "sub_index", "formatstyle", "visualurl", "Question Paper",
  "subject_id", "topic_id", "subject", "sub_topic", "classified",
  "in_quiz",
  "AudienceTags", "AudienceTags_ids",
  "added_by", "Timestamp", "updatedAt"
];
// এই কলামগুলো টেক্সট-ফরম্যাটে লেখা হয় (তারিখ/সংখ্যা/ফর্মুলায় রূপান্তর ঠেকাতে)
var MIG_TEXT_COLS = ["id","legacy_id","question","option1","option2","option3","option4","correct","explanation","technique",
  "group_heading","formatstyle","visualurl","Question Paper","subject","sub_topic","AudienceTags","AudienceTags_ids"];

/* ───────────── ছোট সহায়ক ───────────── */
function mig_s_(x) { return (x === null || x === undefined) ? "" : String(x).trim(); }
function mig_key_(h) { return mig_s_(h).toLowerCase().replace(/[\s_]+/g, ""); }
function mig_norm_(s) { return mig_s_(s).normalize("NFC").toLowerCase().replace(/[\s\u200b\u200c\u200d]+/g, " ").trim(); }
function mig_loose_(s) { return mig_s_(s).normalize("NFC").toLowerCase().replace(/[\s\u200b-\u200d.,;:!?।'"‘’“”()\[\]{}\-–—]+/g, ""); }
function mig_qn_(n) { var t = String(n); while (t.length < MIG_QN_WIDTH) t = "0" + t; return "QN" + t; }
function mig_num_(id) { var m = /(\d+)/.exec(mig_s_(id)); return m ? parseInt(m[1], 10) : null; }
function mig_isJunk_(r) {
  var opts = [r.option1, r.option2, r.option3, r.option4].map(mig_s_).filter(function (x) { return x; });
  if (opts.length && opts.every(function (o) { return /^অপ\s*[১-৪1-4]$/.test(o); })) return true;
  var q = mig_norm_(r.question);
  return q === "প্রশ্ন" || q === "প্রশ্ন:" || mig_s_(r.correct) === "উত্তর";
}

/* শিট পড়া: হেডার-নাম (ছোট হাতের, _/স্পেস বাদ) → প্রথম কলাম */
function mig_read_(ss, name) {
  var sh = ss.getSheetByName(name);
  if (!sh) throw new Error("শিট পাওয়া যায়নি: " + name);
  var vals = sh.getDataRange().getValues();
  var hdr = vals[0], col = {};
  for (var i = 0; i < hdr.length; i++) { var k = mig_key_(hdr[i]); if (k && col[k] === undefined) col[k] = i; }
  var rows = [];
  for (var r = 1; r < vals.length; r++) {
    var row = vals[r], blank = true;
    for (var c = 0; c < row.length; c++) if (mig_s_(row[c]) !== "") { blank = false; break; }
    if (!blank) rows.push(row);
  }
  return { hdr: hdr, col: col, rows: rows };
}
function mig_get_(t, row, key) { var i = t.col[key]; return i === undefined ? "" : row[i]; }

/* QBank/Quiz-এর রো → একই কাঠামোর অবজেক্ট (মান আসল টাইপেই থাকে) */
function mig_std_(t, row, sheetName) {
  var g = function (k) { return mig_get_(t, row, k); };
  return {
    legacy_id: mig_s_(g("id")), question: g("question"),
    option1: g("option1"), option2: g("option2"), option3: g("option3"), option4: g("option4"),
    correct: g("correct"), explanation: g("explanation"), technique: g("technique"),
    qtype: mig_s_(g("questiontype")) || "MCQ",
    group_id: mig_s_(g("groupid")), group_heading: g("groupheading"), sub_index: g("subindex"),
    formatstyle: g("formatstyle"), visualurl: g("visualurl"), qpaper: g("questionpaper"),
    subject_id: mig_s_(g("subjectid")), topic_id: mig_s_(g("topicid")),
    subject_old: mig_s_(g("subject")), subtopic_old: mig_s_(g("subtopic")),
    tag_name: mig_s_(g("audiencetags")), tag_ids: mig_s_(g("audiencetagsids")),
    added_by: g("addedby"), timestamp: g("timestamp"), updatedAt: g("updatedat"),
    _sheet: sheetName
  };
}

/* ───────────── মূল গণনা (কিছুই লেখে না) ───────────── */
function mig_compute_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var tags = {}, name2tag = {}, subj = {}, topic = {}, topicSubj = {};
  var tg = mig_read_(ss, "Tags"), sj = mig_read_(ss, "Subjects"), tp = mig_read_(ss, "Topics");
  tg.rows.forEach(function (r) { var id = mig_s_(mig_get_(tg, r, "tagid")), nm = mig_s_(mig_get_(tg, r, "tagname")); if (id) { tags[id] = nm; name2tag[nm.toLowerCase()] = id; } });
  sj.rows.forEach(function (r) { var id = mig_s_(mig_get_(sj, r, "subjectid")); if (id) subj[id] = mig_s_(mig_get_(sj, r, "subjectname")); });
  tp.rows.forEach(function (r) { var id = mig_s_(mig_get_(tp, r, "topicid")); if (id) { topic[id] = mig_s_(mig_get_(tp, r, "topicname")); topicSubj[id] = mig_s_(mig_get_(tp, r, "subjectid")); } });

  var tQB = mig_read_(ss, "QBank"), tQZ = mig_read_(ss, "Quiz"), tEA = mig_read_(ss, "Exam_Appearances");
  var qb = tQB.rows.map(function (r) { return mig_std_(tQB, r, "QBank"); }).filter(function (r) { return r.legacy_id; });
  var qz = tQZ.rows.map(function (r) { return mig_std_(tQZ, r, "Quiz"); }).filter(function (r) { return r.legacy_id; });
  var gates = [], notes = {};

  /* Audience */
  var tagFix = 0, tagBlank = 0;
  qb.concat(qz).forEach(function (r) {
    var nm = r.tag_name, ids = r.tag_ids, fromName = nm ? name2tag[nm.toLowerCase()] : "";
    if (!nm && !ids) { r.tag_name = MIG_JOB_NAME; r.tag_ids = MIG_JOB_ID; tagBlank++; }
    else if (nm && !ids) { r.tag_ids = fromName || ""; }
    else if (ids && !nm) { r.tag_name = tags[ids] || ""; }
    else if (fromName && fromName !== ids) { r.tag_ids = fromName; tagFix++; }
  });

  /* Quiz ↔ QBank একই প্রশ্ন */
  var byHash = {};
  qb.forEach(function (r) { if (mig_isJunk_(r)) return; var h = mig_norm_(r.question); if (h) (byHash[h] = byHash[h] || []).push(r); });
  var optSet = function (r) { return [r.option1, r.option2, r.option3, r.option4].map(mig_loose_).sort().join("|"); };
  var merged = {}, reviewCnt = 0;
  qz.forEach(function (z) {
    if (mig_isJunk_(z)) return;
    var c = byHash[mig_norm_(z.question)];
    if (!c) return;
    var same = null;
    for (var i = 0; i < c.length; i++) {
      if (c[i].qtype === z.qtype && mig_loose_(c[i].correct) === mig_loose_(z.correct) && optSet(c[i]) === optSet(z)) { same = c[i]; break; }
    }
    if (same) merged[z.legacy_id] = same; else reviewCnt++;
  });

  /* আইডি বরাদ্দ */
  var maxQB = 0;
  qb.forEach(function (r) { var n = mig_num_(r.legacy_id); if (n > maxQB) maxQB = n; });
  var idMap = {};            // পুরনো আইডি → নতুন
  qb.forEach(function (r) { r.id = mig_qn_(mig_num_(r.legacy_id)); r.in_quiz = "N"; r.legacyAll = r.legacy_id; idMap[r.legacy_id] = r.id; });
  var next = maxQB + 1, quizOnly = [], mergedCnt = 0;
  qz.forEach(function (z) {
    var tgt = merged[z.legacy_id];
    if (tgt) {
      idMap[z.legacy_id] = tgt.id; mergedCnt++;
      tgt.in_quiz = "Y"; tgt.legacyAll = tgt.legacyAll + "|" + z.legacy_id;
      var tPool = MIG_POOL_SUBJECTS.indexOf(tgt.subject_id) >= 0 || !tgt.subject_id;
      var zPool = MIG_POOL_SUBJECTS.indexOf(z.subject_id) >= 0 || !z.subject_id;
      if (tPool && !zPool) { tgt.subject_id = z.subject_id; tgt.topic_id = z.topic_id; }
      if (!tgt.tag_ids || (tgt.tag_ids === MIG_JOB_ID && z.tag_ids && z.tag_ids !== MIG_JOB_ID)) { tgt.tag_name = z.tag_name; tgt.tag_ids = z.tag_ids; }
      if (!mig_s_(tgt.explanation) && mig_s_(z.explanation)) tgt.explanation = z.explanation;
    } else {
      z.id = mig_qn_(next++); z.in_quiz = "Y"; z.legacyAll = z.legacy_id; idMap[z.legacy_id] = z.id; quizOnly.push(z);
    }
  });
  var all = qb.concat(quizOnly);

  /* আউটপুট রো */
  var filled = 0, autoQuiz = 0;
  var out = all.map(function (r) {
    var o = { option1: r.option1, option2: r.option2, option3: r.option3, option4: r.option4 };
    if (MIG_FILL_MISSING_OPTIONS && r.qtype !== "Written") {
      var n = [o.option1, o.option2, o.option3, o.option4].filter(function (x) { return mig_s_(x) !== ""; }).length;
      if (n < 4 && n > 0) {
        ["option1", "option2", "option3", "option4"].forEach(function (k) { if (mig_s_(o[k]) === "") { o[k] = MIG_PLACEHOLDER; } });
        filled++;
      }
    }
    var sid = r.subject_id, tid = r.topic_id;
    var classified = (!sid || MIG_POOL_SUBJECTS.indexOf(sid) >= 0) ? "N" : "Y";
    if (r._sheet === "QBank" && r.in_quiz !== "Y" && r.qtype !== "Written" && classified === "Y") { r.in_quiz = "Y"; autoQuiz++; }
    var rec = {
      "id": r.id, "legacy_id": r.legacyAll,
      "question": r.question, "option1": o.option1, "option2": o.option2, "option3": o.option3, "option4": o.option4,
      "correct": r.correct, "explanation": r.explanation, "technique": r.technique,
      "Question Type": r.qtype, "group_id": r.group_id, "group_heading": r.group_heading, "sub_index": r.sub_index,
      "formatstyle": r.formatstyle, "visualurl": r.visualurl, "Question Paper": r.qpaper,
      "subject_id": sid, "topic_id": tid,
      "subject": subj[sid] || r.subject_old, "sub_topic": topic[tid] || r.subtopic_old, "classified": classified,
      "in_quiz": r.in_quiz,
      "AudienceTags": r.tag_name, "AudienceTags_ids": r.tag_ids,
      "added_by": r.added_by, "Timestamp": r.timestamp, "updatedAt": r.updatedAt
    };
    return { rec: rec, src: r };
  });
  var outRows = out.map(function (x) { return MIG_OUT_COLS.map(function (c) { var v = x.rec[c]; return (v === undefined || v === null) ? "" : v; }); });

  /* Exam_Appearances_v2 */
  var eaMissing = 0, eaIdI = tEA.col["questionid"];
  var eaOut = [tEA.hdr.slice()];
  tEA.rows.forEach(function (r) {
    var c = r.slice(), old = mig_s_(c[eaIdI]), nw = idMap[old];
    if (!nw) { eaMissing++; } else { c[eaIdI] = nw; }
    eaOut.push(c);
  });

  /* ── গেট ── */
  var G = function (name, ok, detail) { gates.push({ name: name, ok: !!ok, detail: detail || "" }); };
  var ids = out.map(function (x) { return x.rec.id; }), idSet = {}; ids.forEach(function (i) { idSet[i] = 1; });
  G("G1 মোট সারি = QBank + Quiz − মার্জড", all.length === qb.length + qz.length - mergedCnt, all.length + " = " + qb.length + " + " + qz.length + " − " + mergedCnt);
  G("G2 নতুন আইডি ইউনিক", Object.keys(idSet).length === ids.length, Object.keys(idSet).length + "/" + ids.length);
  var oldCnt = Object.keys(idMap).length;
  G("G3 প্রতিটা পুরনো আইডি ম্যাপে আছে", oldCnt === qb.length + qz.length, oldCnt + " / " + (qb.length + qz.length));
  G("G4 Exam_Appearances-এর সব question_id নতুন আইডিতে মিলেছে", eaMissing === 0, "অমিল " + eaMissing);
  G("G5 EA সারিসংখ্যা অপরিবর্তিত", eaOut.length - 1 === tEA.rows.length, (eaOut.length - 1) + " = " + tEA.rows.length);
  var eaBad = 0;
  tEA.rows.forEach(function (r, i) { var o = eaOut[i + 1]; for (var c = 0; c < r.length; c++) { if (c !== eaIdI && mig_s_(r[c]) !== mig_s_(o[c])) { eaBad++; break; } } });
  G("G6 EA-র শুধু question_id বদলেছে", eaBad === 0, "পার্থক্য " + eaBad);
  var contentBad = 0;
  out.forEach(function (x) {
    var s = x.src, r = x.rec;
    ["question", "correct"].forEach(function (k) { if (mig_s_(s[k]) !== mig_s_(r[k])) contentBad++; });
    ["option1", "option2", "option3", "option4"].forEach(function (k) {
      var a = mig_s_(s[k]), b = mig_s_(r[k]);
      if (a !== b && !(a === "" && b === MIG_PLACEHOLDER)) contentBad++;
    });
  });
  G("G7 প্রশ্ন/অপশন/correct হুবহু অপরিবর্তিত (প্লেসহোল্ডার বাদে)", contentBad === 0, "পার্থক্য " + contentBad);
  G("G8 Written-এ in_quiz=Y নেই", !out.some(function (x) { return x.rec["Question Type"] === "Written" && x.rec.in_quiz === "Y"; }), "");
  var grp = {};
  out.forEach(function (x) { var g = x.rec.group_id; if (g) { (grp[g] = grp[g] || {})[x.rec.topic_id + "/" + x.rec.in_quiz] = 1; } });
  var grpBad = Object.keys(grp).filter(function (g) { return Object.keys(grp[g]).length > 1; }).length;
  G("G9 গ্রুপের সব সদস্য একই টপিক ও in_quiz-এ", grpBad === 0, Object.keys(grp).length + "টা গ্রুপ, ভাঙা " + grpBad);
  G("G10 QBank-এর নম্বর হুবহু (QB-n → QN n)", qb.every(function (r) { return r.id === mig_qn_(mig_num_(r.legacy_id)); }), "");
  var qbIds = {}; qb.forEach(function (r) { qbIds[r.id] = 1; });
  G("G11 Quiz-only আইডি QBank-এর সাথে সংঘর্ষ করে না", quizOnly.every(function (z) { return !qbIds[z.id]; }), "");

  /* অসঙ্গতির সারাংশ (শুধু গণনা — কিছু বদলানো হয় না) */
  var mism = 0, unkSubj = 0, unkTopic = 0, lt4 = 0, noOpt = 0;
  all.forEach(function (r) {
    if (r.qtype !== "Written") {
      var opts = [r.option1, r.option2, r.option3, r.option4].map(mig_s_);
      var nOpt = opts.filter(function (x) { return x; }).length;
      if (nOpt === 0) noOpt++;                       // শুধু প্রশ্ন+উত্তর (যেমন "এক কথায় প্রকাশ") — অপরিবর্তিত
      else if (opts.indexOf(mig_s_(r.correct)) < 0) mism++;
      if (nOpt > 0 && nOpt < 4) lt4++;
    }
    if (!r.subject_id || !subj[r.subject_id]) unkSubj++;
    if (!r.topic_id || !topic[r.topic_id]) unkTopic++;
  });
  return {
    gates: gates, allPass: gates.every(function (g) { return g.ok; }),
    outRows: outRows, eaOut: eaOut, idMap: idMap,
    stats: {
      qbank: qb.length, quiz: qz.length, merged: mergedCnt, review: reviewCnt, total: all.length, quizOnly: quizOnly.length,
      inQuizY: out.filter(function (x) { return x.rec.in_quiz === "Y"; }).length,
      classifiedY: out.filter(function (x) { return x.rec.classified === "Y"; }).length,
      written: out.filter(function (x) { return x.rec["Question Type"] === "Written"; }).length,
      firstQuizOnly: quizOnly.length ? quizOnly[0].id : "-", lastId: ids.length ? mig_qn_(next - 1) : "-",
      autoQuiz: autoQuiz, tagFix: tagFix, tagBlank: tagBlank, placeholderFilled: filled, mismatchCorrect: mism, lt4: lt4, noOpt: noOpt,
      unknownSubject: unkSubj, unknownTopic: unkTopic, ea: tEA.rows.length
    }
  };
}

/* ───────────── রিপোর্ট শিট ───────────── */
function mig_report_(lines, append) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(MIG_REPORT) || ss.insertSheet(MIG_REPORT);
  if (!append) sh.clear();
  var start = append ? sh.getLastRow() + 1 : 1;
  if (sh.getMaxRows() < start + lines.length) sh.insertRowsAfter(sh.getMaxRows(), start + lines.length - sh.getMaxRows());
  sh.getRange(start, 1, lines.length, 1).setNumberFormat("@").setValues(lines.map(function (l) { return [l]; }));
  sh.setColumnWidth(1, 700);
  return sh;
}
function mig_stamp_() { return Utilities.formatDate(new Date(), "Asia/Dhaka", "dd/MM/yyyy HH:mm:ss"); }
function mig_summaryLines_(res, title) {
  var s = res.stats, L = [];
  L.push((res.allPass ? "✅ সব গেট পাস" : "❌ গেট ফেল — mig3_build চলবে না") + "  —  " + title + "  —  " + mig_stamp_());
  L.push("QBank " + s.qbank + " · Quiz " + s.quiz + " · Exam_Appearances " + s.ea);
  L.push("নতুন Questions: " + s.total + " সারি (QBank " + s.qbank + " + Quiz-only " + s.quizOnly + "; মার্জড " + s.merged + ")");
  L.push("in_quiz=Y " + s.inQuizY + " (এর মধ্যে QBank-এর ঠিক-করা MCQ আপনা-আপনি: " + s.autoQuiz + ") · classified=Y " + s.classifiedY + " · Written " + s.written);
  L.push("নতুন আইডি: Quiz-only শুরু " + s.firstQuizOnly + " … শেষ " + s.lastId);
  L.push("");
  res.gates.forEach(function (g) { L.push((g.ok ? "✅ " : "❌ ") + g.name + (g.detail ? " — " + g.detail : "")); });
  L.push("");
  L.push("— অসঙ্গতি (কিছুই বদলানো হয়নি; অ্যাপ থেকে পড়তে পড়তে ঠিক করবেন) —");
  L.push("correct অপশনের সাথে মেলে না: " + s.mismatchCorrect);
  L.push("১–৩টা option-এর MCQ — ফাঁকা slot-এ প্লেসহোল্ডার বসেছে: " + s.placeholderFilled);
  L.push("কোনো option-ই নেই (শুধু প্রশ্ন+উত্তর, যেমন এক কথায় প্রকাশ) — অপরিবর্তিত: " + s.noOpt);
  L.push("subject_id ফাঁকা/Subjects-এ নেই: " + s.unknownSubject + " · topic_id ফাঁকা/Topics-এ নেই: " + s.unknownTopic);
  L.push("Audience: নাম/আইডি অমিল ঠিক " + s.tagFix + " · ফাঁকা→Job " + s.tagBlank);
  L.push("টেক্সট এক কিন্তু উত্তর/অপশন আলাদা (আলাদা প্রশ্নই থাকবে): " + s.review);
  return L;
}

/* ═══ STEP 1 — ব্যাকআপ ═══ */
function mig1_backup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var name = ss.getName() + " BACKUP " + Utilities.formatDate(new Date(), "Asia/Dhaka", "yyyy-MM-dd HH-mm");
  var copy = DriveApp.getFileById(ss.getId()).makeCopy(name);
  mig_report_(["✅ ব্যাকআপ তৈরি — " + mig_stamp_(), "নাম: " + name, "লিংক: " + copy.getUrl()], false);
  Logger.log(copy.getUrl());
}

/* ═══ STEP 2 — ড্রাই-রান (শুধু যাচাই; কিছু বানায় না) ═══ */
function mig2_dryRun() {
  var res = mig_compute_();
  mig_report_(mig_summaryLines_(res, "ড্রাই-রান"), true);
  Logger.log(res.allPass ? "PASS" : "FAIL");
}

/* ═══ STEP 3 — বিল্ড (নতুন শিট বানায়; পুরনোগুলো অপরিবর্তিত) ═══ */
function mig3_build() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (ss.getSheetByName("Questions") || ss.getSheetByName("Exam_Appearances_v2")) {
    mig_report_(["❌ থামানো হলো: `Questions` বা `Exam_Appearances_v2` আগে থেকেই আছে। নতুন করে বানাতে হলে ওই দুটো ট্যাব নিজে মুছে আবার চালান।"], true);
    return;
  }
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) { mig_report_(["❌ লক পাওয়া যায়নি — অ্যাপ থেকে কেউ লিখছে। কয়েক মিনিট পরে চেষ্টা করুন।"], true); return; }
  try {
    var res = mig_compute_();
    if (!res.allPass) { mig_report_(mig_summaryLines_(res, "বিল্ড থামানো হলো"), true); return; }

    var q = ss.insertSheet("Questions");
    mig_write_(q, [MIG_OUT_COLS].concat(res.outRows), MIG_OUT_COLS);
    q.setFrozenRows(1);
    var ea = ss.insertSheet("Exam_Appearances_v2");
    mig_write_(ea, res.eaOut, null);
    ea.setFrozenRows(1);
    SpreadsheetApp.flush();

    var L = mig_summaryLines_(res, "বিল্ড সম্পন্ন");
    L.push("");
    L.push("নতুন ট্যাব: Questions (" + res.outRows.length + " সারি), Exam_Appearances_v2 (" + (res.eaOut.length - 1) + " সারি)");
    L.push("➡ এখন mig4_verify চালান।");
    mig_report_(L, true);
  } finally { lock.releaseLock(); }
}

function mig_write_(sh, data, headerNames) {
  var nRows = data.length, nCols = data[0].length;
  if (sh.getMaxRows() < nRows) sh.insertRowsAfter(sh.getMaxRows(), nRows - sh.getMaxRows());
  if (sh.getMaxColumns() < nCols) sh.insertColumnsAfter(sh.getMaxColumns(), nCols - sh.getMaxColumns());
  if (headerNames) {                       // টেক্সট-ফরম্যাট আগে, তারপর মান
    headerNames.forEach(function (h, i) { if (MIG_TEXT_COLS.indexOf(h) >= 0) sh.getRange(1, i + 1, sh.getMaxRows(), 1).setNumberFormat("@"); });
  } else {
    sh.getRange(1, 1, sh.getMaxRows(), nCols).setNumberFormat("@");
  }
  // ফিক্স: Google Sheets লেখার সময় শুরুর একটা ' (অ্যাপোস্ট্রফি) টেক্সট-মার্কার ভেবে কেটে ফেলে।
  // তাই যে সেলের লেখা ' দিয়ে শুরু, তার সামনে আরেকটা ' বসাই — ফলে আসল ' থেকে যায়।
  data = data.map(function (row, ri) {
    if (ri === 0) return row;                       // হেডার অপরিবর্তিত
    return row.map(function (v) { return (typeof v === "string" && v.charAt(0) === "'") ? "'" + v : v; });
  });
  var CH = 2000;
  for (var i = 0; i < nRows; i += CH) {
    var part = data.slice(i, i + CH);
    sh.getRange(i + 1, 1, part.length, nCols).setValues(part);
  }
}

/* ═══ STEP 4 — যাচাই (বানানো শিট ↔ পুরনো শিট, প্রতিটা সারি) ═══ */
function mig4_verify() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var q = ss.getSheetByName("Questions"), ea2 = ss.getSheetByName("Exam_Appearances_v2");
  if (!q || !ea2) { mig_report_(["❌ `Questions`/`Exam_Appearances_v2` নেই — আগে mig3_build চালান।"], true); return; }
  var exp = mig_compute_();                       // পুরনো শিট থেকে প্রত্যাশিত ফল আবার গণনা
  var live = q.getDataRange().getValues(), liveEa = ea2.getDataRange().getValues();
  var problems = [], add = function (m) { if (problems.length < 25) problems.push(m); };
  var hdrOk = MIG_OUT_COLS.every(function (c, i) { return mig_s_(live[0][i]) === c; });
  if (!hdrOk) add("হেডার মেলেনি");
  var liveRows = live.slice(1).filter(function (r) { return mig_s_(r[0]) !== ""; });
  if (liveRows.length !== exp.outRows.length) add("সারিসংখ্যা: শিটে " + liveRows.length + ", প্রত্যাশিত " + exp.outRows.length);
  var byId = {}; liveRows.forEach(function (r) { byId[mig_s_(r[0])] = r; });
  var diffs = 0, missing = 0;
  exp.outRows.forEach(function (e) {
    var r = byId[mig_s_(e[0])];
    if (!r) { missing++; return; }
    for (var c = 0; c < e.length; c++) if (mig_s_(e[c]) !== mig_s_(r[c])) { diffs++; if (diffs <= 10) add("অমিল " + e[0] + " কলাম " + MIG_OUT_COLS[c]); break; }
  });
  if (missing) add("শিটে নেই: " + missing + "টা আইডি");
  if (diffs) add("মোট অমিল সারি: " + diffs);
  var eaRows = liveEa.slice(1);
  if (eaRows.length !== exp.eaOut.length - 1) add("EA সারিসংখ্যা: " + eaRows.length + " বনাম " + (exp.eaOut.length - 1));
  var qIdSet = byId, eaBad = 0;
  eaRows.forEach(function (r, i) {
    var e = exp.eaOut[i + 1];
    for (var c = 0; c < e.length; c++) if (mig_s_(e[c]) !== mig_s_(r[c])) { eaBad++; break; }
    if (!qIdSet[mig_s_(r[1])]) eaBad++;
  });
  if (eaBad) add("EA অমিল/অনুপস্থিত question_id: " + eaBad);
  var ok = problems.length === 0;
  var L = [(ok ? "✅ VERIFY পাস — Questions ও Exam_Appearances_v2 পুরনো ডাটার সাথে হুবহু মিলেছে" : "❌ VERIFY ফেল") + " — " + mig_stamp_()];
  L.push("Questions " + liveRows.length + " সারি · Exam_Appearances_v2 " + eaRows.length + " সারি");
  problems.forEach(function (p) { L.push("• " + p); });
  mig_report_(L, true);
}


/* ═══ STEP 5 — `in_qbank` কলাম যোগ (Admin App নতুন নিয়মে লেখার আগে ১ বার চালান) ═══
   Questions শিটের শেষে `in_qbank` (Y/N) কলাম বসায়: Y = প্রশ্নটা QBank-এ আছে।
   আজকের QBank ভিউয়ের সাথে হুবহু মিলিয়ে ভরে: (in_quiz ≠ Y) অথবা (legacy_id-তে QB- আছে) → Y, বাকি (শুধু-Quiz থেকে আসা) → N।
   এরপর Student App-এর QBank ভিউ এই কলাম থেকেই চলে, আর Admin App-এর লেখা (Quiz/QBank-এ যোগ, মোছা) এই কলাম মেনেই হয়।
   কিছু মোছে/বদলায় না — শুধু নতুন কলাম। আগে থেকে থাকলে কিছু করে না। Run: mig5_addInQbank */
function mig5_addInQbank() {
  var ss = SpreadsheetApp.getActiveSpreadsheet(), sh = ss.getSheetByName("Questions");
  if (!sh) { mig_report_(["❌ Questions শিট নেই — আগে mig3_build চালান"], true); return; }
  var lc = sh.getLastColumn(), n = sh.getLastRow() - 1;
  var hdr = sh.getRange(1, 1, 1, lc).getValues()[0].map(function (h) { return String(h).trim(); });
  if (hdr.indexOf("in_qbank") >= 0) { mig_report_(["ℹ️ in_qbank কলাম আগে থেকেই আছে — কিছু করা হয়নি — " + mig_stamp_()], true); return; }
  var iq = hdr.indexOf("in_quiz"), lg = hdr.indexOf("legacy_id"), idc = hdr.indexOf("id");
  if (iq < 0 || lg < 0 || idc < 0) { mig_report_(["❌ in_quiz/legacy_id/id কলাম পাওয়া যায়নি"], true); return; }
  var col = lc + 1, out = [], y = 0, no = 0;
  if (n > 0) {
    var vals = sh.getRange(2, 1, n, lc).getValues();
    for (var r = 0; r < n; r++) {
      if (!String(vals[r][idc] == null ? "" : vals[r][idc]).trim()) { out.push([""]); continue; }
      var inQuiz = String(vals[r][iq]).trim().toUpperCase() === "Y";
      var inBank = !inQuiz || String(vals[r][lg] == null ? "" : vals[r][lg]).indexOf("QB-") >= 0;
      out.push([inBank ? "Y" : "N"]); if (inBank) y++; else no++;
    }
  }
  sh.getRange(1, col).setValue("in_qbank");
  sh.getRange(2, col, Math.max(n, 1), 1).setNumberFormat("@");
  if (n > 0) sh.getRange(2, col, n, 1).setValues(out);
  mig_report_(["✅ in_qbank কলাম যোগ হয়েছে (কলাম " + col + ") — QBank-এ আছে (Y): " + y + " · শুধু Quiz (N): " + no + " — " + mig_stamp_(),
               "➡ এখন নতুন code_updated.gs ডিপ্লয় করে Publish: markAllTopicsDirty → publishNow।"], true);
}
