/* একটা ঘরের টাইপিং ট্র্যাকার হুক — ঘরে: onChange/onInput-এ tk.input(নতুনমান, {inputType, composing, auto}), onBlur-এ tk.blur()।
   বাইরে থেকে মান বদলালে (সেভের পর খালি, ড্রাফট লোড) নিজে sync হয়। label = ইতিহাসে ঘরের নাম (যেমন "বাক্য", "উত্তর")। */
import { useEffect, useRef } from "react";
import { createBoxTracker } from "../core/typingTracker.js";
import { typingSink, typingSession } from "../core/typingStats.js";
import { findErrors } from "../core/spell/spellDom.js";

// বাকি ইংরেজি ভুল-বানান গোনা (ডিকশনারি লোড না হলে ০)
const spellCount = (text) => { try { return findErrors(text).length; } catch { return 0; } };

export function useTypingTrack(value, label) {
  const ref = useRef(null);
  if (!ref.current) ref.current = createBoxTracker({ sink: typingSink, session: typingSession, label: label || "ঘর", spellCount });
  useEffect(() => { ref.current.sync(String(value == null ? "" : value)); }, [value]);
  useEffect(() => () => ref.current && ref.current.dispose(), []);
  return ref.current;
}
