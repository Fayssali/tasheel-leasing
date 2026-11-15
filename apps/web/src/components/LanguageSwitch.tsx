import { useTranslation } from 'react-i18next';
import { MVP_LOCALES, type Locale } from '@tasheel/shared';
import { changeLocale } from '../i18n';

export function LanguageSwitch() {
  const { t, i18n } = useTranslation();

  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="sr-only">{t('language.label')}</span>
      <select
        className="rounded-lg bg-white/10 px-2 py-1.5 text-white [&>option]:text-gray-900"
        value={i18n.language}
        onChange={(e) => changeLocale(e.target.value as Locale)}
      >
        {MVP_LOCALES.map((l) => (
          <option key={l} value={l}>
            {t(`language.${l}`)}
          </option>
        ))}
      </select>
    </label>
  );
}
