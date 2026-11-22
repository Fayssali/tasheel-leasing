import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DEMO_ROLE_KEY, DEMO_ROLES, demoRole, type DemoRole } from './mock';

const ORG = '0193a1b2-0000-7000-8000-0000000000aa';
const PLATFORM = '0193a1b2-0000-7000-8000-0000000000ff';
const HOME: Record<DemoRole, string> = {
  anon: '#/',
  business: '#/app',
  supplier: '#/app',
  bank: '#/app',
  admin: '#/admin',
};

/** Floating panel of the browser-only demo: pick whose eyes you look through. */
export function DemoSwitcher() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(true);
  const current = demoRole();

  const choose = (role: DemoRole) => {
    try {
      localStorage.setItem(DEMO_ROLE_KEY, role);
      localStorage.setItem('tasheel.activeOrg', role === 'admin' ? PLATFORM : ORG);
    } catch {
      /* storage unavailable: the role cannot change */
    }
    window.location.hash = HOME[role];
    window.location.reload();
  };

  return (
    <div className="fixed bottom-4 end-4 z-50 w-72 rounded-xl border border-gray-200 bg-white shadow-xl print:hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between rounded-t-xl bg-primary-900 px-4 py-2 text-sm font-semibold text-white"
        aria-expanded={open}
      >
        {t('demo.switcher.title')}
        <span aria-hidden="true">{open ? '−' : '+'}</span>
      </button>
      {open && (
        <div className="space-y-2 p-3">
          <p className="text-xs text-gray-600">{t('demo.switcher.hint')}</p>
          {DEMO_ROLES.map((role) => (
            <button
              key={role}
              type="button"
              onClick={() => choose(role)}
              className={`block w-full rounded-lg border px-3 py-2 text-start text-sm ${
                role === current
                  ? 'border-primary-600 bg-primary-50 font-semibold text-primary-900'
                  : 'border-gray-200 hover:bg-gray-50'
              }`}
            >
              {t(`demo.switcher.role.${role}`)}
              {role === current && <span className="sr-only"> ({t('demo.switcher.current')})</span>}
            </button>
          ))}
          <p className="text-xs text-gray-500">{t('demo.switcher.readOnly')}</p>
        </div>
      )}
    </div>
  );
}
