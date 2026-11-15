import { useTranslation } from 'react-i18next';
import { ApiStatus } from './components/ApiStatus';
import { LanguageSwitch } from './components/LanguageSwitch';

/**
 * Placeholder shell for Phase 1. Routing, auth screens and the four portals are added
 * as the foundation module lands.
 */
export function App() {
  const { t } = useTranslation();

  return (
    <div className="min-h-screen bg-white text-gray-900 flex flex-col">
      <header className="bg-primary-900 text-white">
        <div className="mx-auto max-w-6xl px-6 py-4 flex items-center justify-between gap-4">
          <div>
            <p className="text-lg font-semibold">{t('app.name')}</p>
            <p className="text-xs text-white/70">{t('app.tagline')}</p>
          </div>
          <div className="flex items-center gap-3">
            <LanguageSwitch />
            <button className="rounded-lg border border-white/30 px-3 py-1.5 text-sm hover:bg-white/10">
              {t('nav.signIn')}
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 mx-auto w-full max-w-6xl px-6 py-16">
        <p className="mb-4 inline-block rounded-full bg-warning-600/10 px-3 py-1 text-xs font-semibold text-warning-600">
          {t('home.status')}
        </p>
        <h1 className="text-3xl font-semibold text-primary-900 text-start">{t('home.title')}</h1>
        <p className="mt-3 max-w-2xl text-gray-600 text-start">{t('home.subtitle')}</p>
        <button className="mt-8 rounded-lg bg-accent-500 px-5 py-2.5 font-semibold text-primary-900 hover:brightness-95">
          {t('home.cta')}
        </button>
      </main>

      <footer className="border-t border-gray-200">
        <div className="mx-auto max-w-6xl px-6 py-4 flex flex-col gap-2 text-xs text-gray-500 sm:flex-row sm:items-center sm:justify-between">
          <p className="max-w-3xl text-start">{t('disclaimer.intermediary')}</p>
          <ApiStatus />
        </div>
      </footer>
    </div>
  );
}
