// নতুন আসল email-কে admin বানায়। (নতুন email আগে থেকে থাকলে সেটাকেই admin করে,
// না থাকলে পুরনো fake account-এর email বদলে দেয়।)
import { initializeApp, cert } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { randomBytes } from "node:crypto";

const [oldEmail, newEmail] = process.argv.slice(2);
if (!oldEmail || !newEmail) { console.log("পুরনো আর নতুন email দিন"); process.exit(1); }
if (!process.env.FIREBASE_SERVICE_ACCOUNT) { console.log("❌ FIREBASE_SERVICE_ACCOUNT secret সেট করা নেই"); process.exit(1); }

initializeApp({ credential: cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) });
const auth = getAuth();

let existing = null;
try { existing = await auth.getUserByEmail(newEmail); } catch (e) {
  if (e.code !== "auth/user-not-found") throw e;
}

if (existing) {
  // নতুন email-এ account আগেই আছে → সেটাকেই admin বানাও (কিছু মোছা হয় না)
  const claims = existing.customClaims || {};
  await auth.setCustomUserClaims(existing.uid, { ...claims, admin: true });
  await auth.revokeRefreshTokens(existing.uid);
  console.log(`✅ ${newEmail} (UID ${existing.uid}) এখন admin।`);
  console.log("এই email-এর আগের password দিয়ে লগইন করুন, মনে না থাকলে অ্যাপে \"পাসওয়ার্ড ভুলে গেছেন?\" চাপুন।");
} else {
  const user = await auth.getUserByEmail(oldEmail);
  await auth.updateUser(user.uid, {
    email: newEmail,
    emailVerified: true,
    password: randomBytes(18).toString("base64url"),
  });
  const claims = user.customClaims || {};
  if (claims.admin !== true) await auth.setCustomUserClaims(user.uid, { ...claims, admin: true });
  await auth.revokeRefreshTokens(user.uid);
  console.log(`✅ ${newEmail} এখন admin। অ্যাপে "পাসওয়ার্ড ভুলে গেছেন?" চেপে নতুন password সেট করুন।`);
}
