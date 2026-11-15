import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { isRtl, MVP_LOCALES, type Locale } from '@tasheel/shared';
import fr from '@tasheel/i18n/locales/fr.json';
import ar from '@tasheel/i18n/locales/ar.json';
import en from '@tasheel/i18n/locales/en.json';

const STORAGE_KEY = 'tasheel.locale';

function initialLocale(): Locale {
  try {
    const saved = localStorage.getItem(STORAGE_KEY) as Locale | null;
    if (saved && MVP_LOCALES.includes(saved)) return saved;
  } catch {
    /* storage unavailable */
  }
  return 'fr';
}

/** Sets <html lang/dir> so Tailwind logical utilities (ms-*, ps-*, text-start) mirror for Arabic. */
export function applyDocumentLocale(locale: Locale): void {
  document.documentElement.lang = locale;
  document.documentElement.dir = isRtl(locale) ? 'rtl' : 'ltr';
}

export function changeLocale(locale: Locale): void {
  void i18n.changeLanguage(locale);
  applyDocumentLocale(locale);
  try {
    localStorage.setItem(STORAGE_KEY, locale);
  } catch {
    /* storage unavailable */
  }
}

const locale = initialLocale();

void i18n.use(initReactI18next).init({
  resources: { fr: { translation: fr }, ar: { translation: ar }, en: { translation: en } },
  lng: locale,
  fallbackLng: 'fr',
  interpolation: { escapeValue: false },
});
applyDocumentLocale(locale);

export default i18n;
