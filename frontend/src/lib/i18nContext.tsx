import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { translations, type Language } from './i18n'

type I18nContextType = {
  lang: Language
  setLang: (lang: Language) => void
  t: (text: string) => string
}

const I18nContext = createContext<I18nContextType | undefined>(undefined)

const LANGUAGES: Language[] = ['en', 'pt', 'es', 'ru', 'fr', 'de']

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Language>(() => {
    const saved = localStorage.getItem('9drive_lang')
    return LANGUAGES.includes(saved as Language) ? (saved as Language) : 'pt'
  })

  useEffect(() => {
    localStorage.setItem('9drive_lang', lang)
    document.documentElement.lang = lang === 'pt' ? 'pt-BR' : lang
  }, [lang])

  const setLang = (newLang: Language) => setLangState(newLang)

  const t = (text: string) => {
    if (lang === 'en') return text
    return translations[lang]?.[text] ?? text
  }

  return (
    <I18nContext.Provider value={{ lang, setLang, t }}>
      {children}
    </I18nContext.Provider>
  )
}

export function useTranslation() {
  const context = useContext(I18nContext)
  if (!context) throw new Error('useTranslation must be used within an I18nProvider')
  return context
}
