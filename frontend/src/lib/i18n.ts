import pt from './translations/pt'
import es from './translations/es'
import ru from './translations/ru'
import fr from './translations/fr'
import de from './translations/de'

export type Language = 'en' | 'pt' | 'es' | 'ru' | 'fr' | 'de'

export const languageNames: Record<Language, string> = {
  en: 'English',
  pt: 'Português (Brasil)',
  es: 'Español',
  ru: 'Русский',
  fr: 'Français',
  de: 'Deutsch',
}

/**
 * Keys are the English source strings used directly in the UI.
 * Lookup falls back to the key itself, so a missing translation never breaks the page.
 */
export const translations: Record<Exclude<Language, 'en'>, Record<string, string>> = {
  pt,
  es,
  ru,
  fr,
  de,
}
