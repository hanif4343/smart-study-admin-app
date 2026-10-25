// Admin account-এর fake email বদলে আসল email বসানোর স্ক্রিপ্ট (GitHub Actions থেকে চলে)।
// UID, admin permission (custom claim) আর সব ডেটা আগের মতোই থাকে।
import { initializeApp, cert } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { randomBytes } from "node:crypto";

const [oldEmail, newEmail] = process.argv.slice(2);
if (!oldEmail || !newEmail) { console.log("পুরনো আর নতুন email দিন"); process.exit(1); }
if (!process.env.FIREBASE_SERVICE_ACCOUNT) { console.log("❌ FIREBASE_SERVICE_ACCOUNT secret সেট করা নেই"); process.exit(1); }

initializeApp({ credential: cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) });
const auth = getAuth();

const user = await auth.getUserByEmail(oldEmail);
console.log("পাওয়া গেছে UID:", user.uid, "| claims:", JSON.stringify(user.customClaims || {}));

// random password বসানো হচ্ছে (লগে দেখানো হবে না) — পরে "Password ভুলে গেছেন?" দিয়ে নিজের password দিন
await auth.updateUser(user.uid, {
  email: newEmail,
  emailVerified: true,
  password: randomBytes(18).toString("base64url"),
});

const claims = user.customClaims || {};
if (claims.admin !== true) {
  await auth.setCustomUserClaims(user.uid, { ...claims, admin: true });
  console.log("admin claim সেট করা হয়েছে");
}
await auth.revokeRefreshTokens(user.uid);
console.log(`✅ সম্পন্ন! ${newEmail} এখন admin email। অ্যাপে "পাসওয়ার্ড ভুলে গেছেন?" চেপে নতুন password সেট করুন।`);
