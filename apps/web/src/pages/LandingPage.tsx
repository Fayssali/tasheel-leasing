import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { ApiStatus } from '../components/ApiStatus';
import { LanguageSwitch } from '../components/LanguageSwitch';
import { useAuth } from '../lib/auth';
import { homePathFor } from '../routes';

/** Public home. The marketplace (Phase 2) will replace the hero with equipment search. */
export function LandingPage() {
  const { t } = useTranslation();
  const { status, me } = useAuth();
  const signedIn = status === 'authenticated';

  return (
    <div className="flex min-h-screen flex-col bg-white text-gray-900">
      <header className="bg-primary-900 text-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-4">
          <div>
            <p className="text-lg font-semibold">{t('app.name')}</p>
            <p className="text-xs text-white/70">{t('app.tagline')}</p>
          </div>
          <div className="flex items-center gap-3">
            <LanguageSwitch />
            {signedIn ? (
              <Link
                to={homePathFor(me)}
                className="rounded-lg border border-white/30 px-3 py-1.5 text-sm hover:bg-white/10"
              >
                {t('nav.myArea')}
              </Link>
            ) : (
              <Link
                to="/login"
                className="rounded-lg border border-white/30 px-3 py-1.5 text-sm hover:bg-white/10"
              >
                {t('nav.signIn')}
              </Link>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-16">
        <p className="mb-4 inline-block rounded-full bg-warning-600/10 px-3 py-1 text-xs font-semibold text-warning-600">
          {t('home.status')}
        </p>
        <h1 className="text-3xl font-semibold text-primary-900 text-start">{t('home.title')}</h1>
        <p className="mt-3 max-w-2xl text-gray-600 text-start">{t('home.subtitle')}</p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link
            to={signedIn ? homePathFor(me) : '/register'}
            className="rounded-lg bg-accent-500 px-5 py-2.5 font-semibold text-primary-900 hover:brightness-95"
          >
            {t('home.cta')}
          </Link>
          {!signedIn && (
            <Link
              to="/register"
              className="rounded-lg border border-gray-300 px-5 py-2.5 font-semibold text-primary-900 hover:bg-gray-50"
            >
              {t('home.ctaPartner')}
            </Link>
          )}
        </div>
        <div className="mt-16 grid gap-6 sm:grid-cols-3">
          {(['business', 'supplier', 'institution'] as const).map((k) => (
            <div key={k} className="rounded-lg border border-gray-200 p-5">
              <h2 className="font-semibold text-primary-900 text-start">
                {t(`home.for.${k}.title`)}
              </h2>
              <p className="mt-2 text-sm text-gray-600 text-start">{t(`home.for.${k}.body`)}</p>
            </div>
          ))}
        </div>
      </main>

      <footer className="border-t border-gray-200">
        <div className="mx-auto flex max-w-6xl flex-col gap-2 px-6 py-4 text-xs text-gray-500 sm:flex-row sm:items-center sm:justify-between">
          <p className="max-w-3xl text-start">{t('disclaimer.intermediary')}</p>
          <ApiStatus />
        </div>
      </footer>
    </div>
  );
}
