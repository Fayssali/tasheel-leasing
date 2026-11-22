import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, NavLink } from 'react-router';
import { useAuth } from '../lib/auth';
import { homePathFor } from '../routes';
import { ApiStatus, DemoBanner } from './ApiStatus';
import { LanguageSwitch } from './LanguageSwitch';

/** Header and footer of the public site (home, marketplace, equipment and supplier pages). */
export function PublicLayout({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const { status, me } = useAuth();
  return (
    <div className="flex min-h-screen flex-col bg-gray-50 text-gray-900">
      <DemoBanner />
      <header className="bg-primary-900 text-white">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-6 py-4">
          <div className="flex items-center gap-8">
            <Link to="/" className="text-lg font-semibold">
              {t('app.name')}
            </Link>
            <NavLink
              to="/marketplace"
              className={({ isActive }) =>
                `text-sm ${isActive ? 'font-semibold' : 'text-white/80 hover:text-white'}`
              }
            >
              {t('nav.marketplace')}
            </NavLink>
          </div>
          <div className="flex items-center gap-3">
            <LanguageSwitch />
            <Link
              to={status === 'authenticated' ? homePathFor(me) : '/login'}
              className="rounded-lg border border-white/30 px-3 py-1.5 text-sm hover:bg-white/10"
            >
              {status === 'authenticated' ? t('nav.myArea') : t('nav.signIn')}
            </Link>
          </div>
        </div>
      </header>
      <main className="flex-1">{children}</main>
      <footer className="border-t border-gray-200 bg-white">
        <div className="mx-auto flex max-w-7xl flex-col gap-2 px-6 py-4 text-xs text-gray-500 sm:flex-row sm:items-center sm:justify-between">
          <p className="max-w-3xl text-start">{t('disclaimer.intermediary')}</p>
          <ApiStatus />
        </div>
      </footer>
    </div>
  );
}
