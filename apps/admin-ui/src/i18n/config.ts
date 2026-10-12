import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './locales/en.json';
import ptBR from './locales/pt-BR.json';

export const SUPPORTED_LANGUAGES = ['pt-BR', 'en'] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];
export const DEFAULT_LANGUAGE: SupportedLanguage = 'pt-BR';

const STORAGE_KEY = 'admin-ui:language';

function isSupportedLanguage(value: string | null): value is SupportedLanguage {
  return SUPPORTED_LANGUAGES.includes(value as SupportedLanguage);
}

function getInitialLanguage(): SupportedLanguage {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (isSupportedLanguage(stored)) return stored;
  } catch {
    // localStorage unavailable (e.g. private browsing) — fall back to the default.
  }
  return DEFAULT_LANGUAGE;
}

void i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    'pt-BR': { translation: ptBR },
  },
  lng: getInitialLanguage(),
  fallbackLng: DEFAULT_LANGUAGE,
  interpolation: { escapeValue: false },
});

i18n.on('languageChanged', (lng) => {
  try {
    localStorage.setItem(STORAGE_KEY, lng);
  } catch {
    // Per-viewer convenience only — losing the preference on reload is fine.
  }
});

export default i18n;
