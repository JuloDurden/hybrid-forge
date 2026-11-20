import { useEffect, useState } from 'react'

export type Lang = 'fr' | 'en'
const KEY = 'hf.lang'
const EVT = 'hf-lang'

function read(): Lang {
  try {
    return localStorage.getItem(KEY) === 'en' ? 'en' : 'fr'
  } catch {
    return 'fr'
  }
}

/** Langue d'affichage des noms de mouvements (mémorisée sur l'appareil). */
export function useMovementLang(): [Lang, (l: Lang) => void] {
  const [lang, setLang] = useState<Lang>(read)
  useEffect(() => {
    const on = () => setLang(read())
    window.addEventListener(EVT, on)
    return () => window.removeEventListener(EVT, on)
  }, [])
  return [
    lang,
    (l: Lang) => {
      try { localStorage.setItem(KEY, l) } catch { /* stockage indisponible */ }
      window.dispatchEvent(new Event(EVT))
    },
  ]
}

export const displayName = (m: { name: string; en: string }, lang: Lang) => (lang === 'en' ? m.en : m.name)
export const otherName = (m: { name: string; en: string }, lang: Lang) => (lang === 'en' ? m.name : m.en)
