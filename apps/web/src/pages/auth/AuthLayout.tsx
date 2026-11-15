import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { LanguageSwitch } from '../../components/LanguageSwitch';

export function AuthLayout({
  title,
  subtitle,
  children,
  wide,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  wide?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex min-h-screen flex-col bg-gray-50">
      <header className="bg-primary-900 text-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <Link to="/" className="text-lg font-semibold">
            {t('app.name')}
          </Link>
          <LanguageSwitch />
        </div>
      </header>
      <main className="flex flex-1 items-start justify-center px-4 py-10">
        <div
          className={`w-full ${wide ? 'max-w-2xl' : 'max-w-md'} rounded-lg border border-gray-200 bg-white p-6 sm:p-8`}
        >
          <h1 className="text-xl font-semibold text-primary-900 text-start">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-gray-600 text-start">{subtitle}</p>}
          <div className="mt-6">{children}</div>
        </div>
      </main>
      <footer className="px-6 pb-6 text-center text-xs text-gray-500">
        {t('disclaimer.intermediary')}
      </footer>
    </div>
  );
}
