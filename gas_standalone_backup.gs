/**
 * ══════════════════════════════════════════════════════════════
 *  Smart Study — GAS STANDALONE BACKUP
 *  App এর সাথে কোনো connection নেই।
 *  Firebase থেকে data pull করে Google Sheet এ backup দেয়।
 *
 *  Setup:
 *  1. এই file Google Apps Script এ নতুন project বানিয়ে paste করো
 *  2. নিচের CONFIG fill করো
 *  3. Triggers > Add Trigger > syncAllToSheet > Time-driven > Every 30 min
 * ══════════════════════════════════════════════════════════════
 */

const CONFIG = {
  FIREBASE_URL:  "https://YOUR-PROJECT-default-rtdb.firebaseio.com/",
  DB_SECRET:     "YOUR_FIREBASE_DB_SECRET",   // Firebase > Project Settings > Service Accounts > Database secrets
  SPREADSHEET_ID:"YOUR_GOOGLE_SHEET_ID",      // Sheet URL এর /d/ পরের অংশ
};

/* ── Sheet নাম → Firebase path mapping ── */
const SHEETS = [
  { tab: "QBank",          path: "QBank"          },
  { tab: "Quiz",           path: "Quiz"            },
  { tab: "Study",          path: "Study"           },
  { tab: "Users",          path: "Users"           },
  { tab: "Reports",        path: "Reports"         },
  { tab: "UserTechniques", path: "UserTechniques"  },
];

/* ══ Main trigger function — প্রতি ৩০ মিনিটে এটা রান হবে ══ */
function syncAllToSheet() {
  const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  const errors = [];

  SHEETS.forEach(({ tab, path }) => {
    try {
      const data = fbGet(path);
      if (!data) { Logger.log(`${tab}: empty`); return; }

      const rows = objectToRows(data);
      if (rows.length === 0) { Logger.log(`${tab}: no rows`); return; }

      writeToSheet(ss, tab, rows);
      Logger.log(`${tab}: ${rows.length} rows written`);
    } catch (e) {
      errors.push(`${tab}: ${e.message}`);
      Logger.log(`ERROR ${tab}: ${e.message}`);
    }
  });

  if (errors.length > 0) {
    Logger.log("Errors: " + errors.join(", "));
  }
}

/* ── Firebase থেকে data fetch ── */
function fbGet(path) {
  const url = CONFIG.FIREBASE_URL + path + ".json?auth=" + CONFIG.DB_SECRET;
  const resp = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  if (resp.getResponseCode() !== 200) {
    throw new Error("Firebase HTTP " + resp.getResponseCode());
  }
  return JSON.parse(resp.getContentText());
}

/* ── Firebase object → 2D array (header + rows) ── */
function objectToRows(data) {
  if (!data || typeof data !== "object") return [];

  const items = Object.entries(data).map(([key, val]) => {
    if (typeof val !== "object" || val === null) return null;
    return { _fbKey: key, ...val };
  }).filter(Boolean);

  if (items.length === 0) return [];

  // সব keys collect করো header এর জন্য
  const allKeys = [];
  const keySet = new Set();
  items.forEach(item => {
    Object.keys(item).forEach(k => {
      if (!keySet.has(k)) { keySet.add(k); allKeys.push(k); }
    });
  });

  const rows = [allKeys]; // header row
  items.forEach(item => {
    rows.push(allKeys.map(k => {
      const v = item[k];
      if (v === null || v === undefined) return "";
      if (typeof v === "object") return JSON.stringify(v);
      return v;
    }));
  });

  return rows;
}

/* ── Sheet এ লিখে দাও (পুরো sheet replace) ── */
function writeToSheet(ss, tabName, rows) {
  let sheet = ss.getSheetByName(tabName);
  if (!sheet) {
    sheet = ss.insertSheet(tabName);
  }

  sheet.clearContents();

  if (rows.length === 0) return;

  const range = sheet.getRange(1, 1, rows.length, rows[0].length);
  range.setValues(rows);

  // Header bold করো
  sheet.getRange(1, 1, 1, rows[0].length).setFontWeight("bold");
  sheet.setFrozenRows(1);
}

/* ══ Manual trigger — একটা নির্দিষ্ট sheet sync করতে ══ */
function syncQBank()  { syncSingle("QBank",  "QBank");  }
function syncUsers()  { syncSingle("Users",  "Users");  }
function syncReports(){ syncSingle("Reports","Reports"); }

function syncSingle(tab, path) {
  const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  const data = fbGet(path);
  const rows = objectToRows(data);
  writeToSheet(ss, tab, rows);
  Logger.log(`${tab}: ${rows.length} rows written`);
}
