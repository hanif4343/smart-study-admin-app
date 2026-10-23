/* একটা ঘরের টাইপিং ট্র্যাকার হুক — ঘরে: onChange/onInput-এ tk.input(নতুনমান), onBlur-এ tk.blur()।
   বাইরে থেকে মান বদলালে (সেভের পর খালি, ড্রাফট লোড) নিজে sync হয়। */
import { useEffect, useRef } from "react";
import { createBoxTracker } from "../core/typingTracker.js";
import { typingSink } from "../core/typingStats.js";

export function useTypingTrack(value) {
  const ref = useRef(null);
  if (!ref.current) ref.current = createBoxTracker({ sink: typingSink });
  useEffect(() => { ref.current.sync(String(value == null ? "" : value)); }, [value]);
  useEffect(() => () => ref.current && ref.current.dispose(), []);
  return ref.current;
}
