import { useEffect, useState } from "react";

export type Lang = "zh" | "en";
const STORAGE_KEY = "aw_lang";

export function useLang(): [Lang, (l: Lang) => void] {
  const [lang, setLangState] = useState<Lang>("zh");

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "en" || stored === "zh") setLangState(stored);
  }, []);

  function setLang(l: Lang) {
    localStorage.setItem(STORAGE_KEY, l);
    setLangState(l);
  }

  return [lang, setLang];
}
