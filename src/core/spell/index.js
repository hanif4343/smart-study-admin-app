/* বানান-পরীক্ষা চালু করার প্রবেশদ্বার — App.jsx থেকে একবার startSpellCheck() ডাকা হয়।
   ডিকশনারি (en_US.aff/.dic, ~৮৬০ KB) আলাদা ফাইল হিসেবে প্যাকেজে যায়; প্রথমবার কোনো ঘরে ফোকাস করলে লোড হয় (অফলাইনেও চলে), অ্যাপ খুলতে দেরি হয় না। */
import affUrl from "./en_US.aff?url";
import dicUrl from "./en_US.dic?url";
import { installSpellCheck } from "./spellDom.js";
export { isSpellEnabled, setSpellEnabled, subscribeSpell } from "./spellDom.js";

export function startSpellCheck() {
  installSpellCheck({
    loadDictionary: async () => {
      const [aff, dic] = await Promise.all([fetch(affUrl).then((r) => r.text()), fetch(dicUrl).then((r) => r.text())]);
      return { aff, dic };
    },
  });
}
