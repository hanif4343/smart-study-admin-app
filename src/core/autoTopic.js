/* ══════════ অটো-টপিক (Math / GK) — Topic Tag-এর রুল দিয়ে প্রশ্ন-উত্তর দেখে টপিক বেছে নেওয়া ══════════
   AutoClassify.gs-এর ac_classify_ ইঞ্জিনের হুবহু JS-পোর্ট (কীওয়ার্ড মিল, match_in, exclude, min_matches, priority, require_blank,
   answer_whole, answer_max_words) — সার্ভারে যা মিলত, ফোনেও সেটাই মিলে। শুধু সাজেশন: ভুল হলে ইউজার নিজে বদলাতে পারে।
   রুল tt_getRules থেকে একবার এনে ক্যাশ করা হয়। */
import { ttGetRules } from "./topicTags.js";

const norm = (s) => String(s == null ? "" : s).normalize("NFC").replace(/\s+/g, " ").trim();
const splitList = (s) => String(s == null ? "" : s).split(/[,،;\n]+/).map(norm).filter(Boolean);
const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const isLatin = (kw) => /[A-Za-z]/.test(kw);

function findAll(text, kw) {
  const out = [], t = norm(text); if (!t || !kw) return out;
  const re = isLatin(kw) ? new RegExp("(?<![A-Za-z0-9])" + escRe(kw).replace(/\s+/g, "\\s+") + "(?![A-Za-z0-9])", "gi")
                          : new RegExp("(?<![\\u0980-\\u09FFA-Za-z0-9])" + escRe(kw).replace(/\s+/g, "\\s+"), "g");
  let m; while ((m = re.exec(t)) !== null) { out.push({ kw, start: m.index, end: m.index + m[0].length }); if (m[0].length === 0) re.lastIndex++; }
  return out;
}
function distinctKeywords(matches) {
  const keep = [];
  matches.forEach((a, i) => {
    const inside = matches.some((b, j) => j !== i && b.kw !== a.kw && b.start <= a.start && b.end >= a.end && (b.end - b.start) > (a.end - a.start));
    if (!inside && keep.indexOf(a.kw) < 0) keep.push(a.kw);
  });
  return keep;
}
const matchAll = (texts, keywords) => { let all = []; texts.forEach((t) => keywords.forEach((k) => { all = all.concat(findAll(t, k)); })); return distinctKeywords(all); };
const hasBlank = (t) => /_{2,}|\.{3,}|…|-{3,}|\(\s*\)|\[\s*\]/.test(String(t || ""));
const wordCount = (s) => { const t = norm(s); return t ? t.split(" ").length : 0; };

function evalRule(rule, q, answer) {
  const scopeQ = rule.match_in === "question" || rule.match_in === "both", scopeA = rule.match_in === "answer" || rule.match_in === "both";
  if (rule.require_blank && !hasBlank(q.question)) return null;
  if (rule.answer_max_words && wordCount(answer) > rule.answer_max_words) return null;
  if (rule.exclude.length && matchAll([q.question, answer], rule.exclude).length) return null;
  let matched;
  if (rule.answer_whole && scopeA) {
    const a = norm(answer).replace(/[\s.,;:!?'"।]+$/g, "").replace(/^[\s'"]+/, "").toLowerCase();
    matched = []; for (let i = 0; i < rule.keywords.length; i++) if (rule.keywords[i].toLowerCase() === a) { matched.push(rule.keywords[i]); break; }
    if (scopeQ) matched = matched.concat(matchAll([q.question], rule.keywords));
  } else {
    const texts = []; if (scopeQ) texts.push(q.question); if (scopeA) texts.push(answer);
    matched = matchAll(texts, rule.keywords);
  }
  if (matched.length < Math.max(1, rule.min_matches)) return null;
  return { matched, count: matched.length };
}
export function classify(rules, q) {
  const answer = norm(q.answer ?? q.correct ?? ""), hits = [];
  rules.forEach((r) => { const h = evalRule(r, { question: q.question }, answer); if (h) hits.push({ rule: r, matched: h.matched, count: h.count }); });
  if (!hits.length) return { status: "none" };
  hits.sort((a, b) => (b.rule.priority - a.rule.priority) || (b.count - a.count));
  const top = hits[0], tied = hits.filter((h) => h.rule.priority === top.rule.priority && h.count === top.count && h.rule.topic_id !== top.rule.topic_id);
  if (tied.length) return { status: "conflict", hits };
  return { status: "match", rule: top.rule, matched: top.matched, hits };
}

/* tt_getRules-এর কাঁচা রুল → ব্যবহারযোগ্য রুল (সক্রিয়, টপিক আছে, keywords আছে)। topicMap: {topic_id:{name,subject_id,subject_name}} */
export function buildRules(raw, topicMap) {
  const yn = (v) => String(v || "").trim().toUpperCase() === "Y", out = [];
  (raw || []).forEach((r) => {
    if (String(r.active === "" || r.active == null ? "Y" : r.active).trim().toUpperCase() === "N") return;
    const t = topicMap[String(r.topic_id || "").trim()], kws = splitList(r.keywords); if (!t || !kws.length) return;
    const mi = String(r.match_in || "both").trim().toLowerCase();
    out.push({ rule_id: String(r.rule_id || ""), topic_id: String(r.topic_id).trim(), topic_name: t.name, subject_id: t.subject_id, subject_name: t.subject_name, keywords: kws,
      match_in: ["question", "answer", "both"].includes(mi) ? mi : "both", exclude: splitList(r.exclude_keywords), min_matches: parseInt(r.min_matches, 10) || 1, priority: parseInt(r.priority, 10) || 0,
      require_blank: yn(r.require_blank), answer_whole: yn(r.answer_whole), answer_max_words: parseInt(r.answer_max_words, 10) || 0 });
  });
  return out;
}
export function topicMapFromRef(refData) {
  const sub = {}; (refData?.subjects || []).forEach((s) => { sub[s.subject_id] = s.subject_name; });
  const m = {}; (refData?.topics || []).forEach((t) => { m[t.topic_id] = { name: t.topic_name, subject_id: t.subject_id, subject_name: sub[t.subject_id] || "" }; });
  return m;
}

/* প্রশ্ন+উত্তর → সেরা টপিক বা null (মিল না থাকলে বা দুই টপিক সমান-সমান হলে null)।
   allowedSubjectIds: শুধু এই সাবজেক্টের রুল ধরা হবে (খালি/null = সব) */
export function autoTopicFor(rules, { question, answer }, allowedSubjectIds) {
  if (!norm(question)) return null;
  const pool = allowedSubjectIds && allowedSubjectIds.length ? rules.filter((r) => allowedSubjectIds.includes(r.subject_id)) : rules;
  const res = classify(pool, { question, answer });
  if (res.status !== "match") return null;
  const r = res.rule; return { topic_id: r.topic_id, topic_name: r.topic_name, subject_id: r.subject_id, subject_name: r.subject_name, matched: res.matched, rule_id: r.rule_id };
}

/* রুল-ক্যাশ: ৫ মিনিট। force=true হলে নতুন করে আনে (Topic Manager/Topic Tag থেকে রুল বদলালে) */
let cache = { key: "", ts: 0, p: null };
export function loadRules(gasSecret, refData, force = false) {
  const key = gasSecret + "|" + (refData?.topics || []).length;
  if (!force && cache.p && cache.key === key && Date.now() - cache.ts < 300000) return cache.p;
  cache = { key, ts: Date.now(), p: ttGetRules(gasSecret).then((r) => (r && r.status === "success" ? buildRules(r.rules, topicMapFromRef(refData)) : [])).catch(() => []) };
  return cache.p;
}
