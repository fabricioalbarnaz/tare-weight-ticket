import { useTranslation } from 'react-i18next';
import { SUPPORTED_LANGUAGES, type SupportedLanguage } from '../i18n/config';

export function LanguageSwitcher() {
  const { t, i18n } = useTranslation();

  return (
    <select
      value={i18n.language}
      onChange={(e) => i18n.changeLanguage(e.target.value as SupportedLanguage)}
      aria-label={t('language.label')}
      className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-700"
    >
      {SUPPORTED_LANGUAGES.map((lang) => (
        <option key={lang} value={lang}>
          {t(`language.${lang}`)}
        </option>
      ))}
    </select>
  );
}
