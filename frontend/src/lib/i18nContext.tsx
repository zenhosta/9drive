import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { translations, type Language } from './i18n'

type I18nContextType = {
  lang: Language
  setLang: (lang: Language) => void
  t: (key: keyof typeof translations['en']) => string
}

const I18nContext = createContext<I18nContextType | undefined>(undefined)

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Language>(() => {
    const saved = localStorage.getItem('9drive_lang')
    return (saved === 'en' || saved === 'pt' || saved === 'es' || saved === 'ru' || saved === 'fr' || saved === 'de') ? saved : 'pt'
  })

  useEffect(() => {
    localStorage.setItem('9drive_lang', lang)
  }, [lang])

  const setLang = (newLang: Language) => {
    setLangState(newLang)
  }

  const t = (key: keyof typeof translations['en']) => {
    const dict = translations[lang] || translations['en']
    return (dict as any)[key] || translations['en'][key] || key
  }

  return (
    <I18nContext.Provider value={{ lang, setLang, t }}>
      {children}
    </I18nContext.Provider>
  )
}

export function useTranslation() {
  const context = useContext(I18nContext)
  if (!context) {
    throw new Error('useTranslation must be used within an I18nProvider')
  }
  return context
}
