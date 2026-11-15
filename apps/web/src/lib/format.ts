import { useTranslation } from 'react-i18next';
import { ApiError } from './api';
import type { LocalizedName } from './types';

/** Dates as dd/mm/yyyy in every locale (Phase 0 specification, section 8.2), Western digits. */
export function formatDate(iso: string | null | undefined, withTime = false): string {
  if (!iso) return '—';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  const date = `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
  return withTime ? `${date} ${pad(d.getHours())}:${pad(d.getMinutes())}` : date;
}

export function useLocalizedName() {
  const { i18n } = useTranslation();
  return (name: LocalizedName | null | undefined) => {
    if (!name) return '';
    const lang = i18n.language as keyof LocalizedName;
    return name[lang] ?? name.fr ?? name.en ?? '';
  };
}

/** Human message for an API error, from the error code catalogue, falling back to the server text. */
export function useErrorMessage() {
  const { t, i18n } = useTranslation();
  return (err: unknown): string => {
    if (err instanceof ApiError) {
      const key = `errors.${err.code}`;
      return i18n.exists(key) ? t(key) : err.message || t('errors.GENERIC');
    }
    return t('errors.NETWORK');
  };
}
