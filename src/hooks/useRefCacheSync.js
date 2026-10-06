/* কোনো পেজের refData state-কে শেয়ার্ড reference cache-এর সাথে সিঙ্কে রাখে —
   ব্যাকগ্রাউন্ডে (বা অন্য পেজে) নতুন ডেটা এলে এই পেজের state নিজে থেকে আপডেট হয়।
   ব্যবহার: const[refData,setRefData]=useState(getCachedReferenceData); useRefCacheSync(setRefData); */
import { useEffect } from "react";
import { subscribeReferenceData } from "../core/refCache.js";

export function useRefCacheSync(setter){
  useEffect(()=>subscribeReferenceData(d=>setter(d)),[setter]);
}
