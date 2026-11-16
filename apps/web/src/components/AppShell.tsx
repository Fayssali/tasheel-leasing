import { useMutation } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { homePathFor } from '../routes';
import { ApiStatus } from './ApiStatus';
import { LanguageSwitch } from './LanguageSwitch';
import { NotificationsNavItem } from '../pages/app/NotificationsPage';
import { OrgStatusBadge } from './StatusBadge';
import { Alert, Button } from './ui';

export interface NavItem {
  to: string;
  label: string;
  end?: boolean;
  /** Custom active test, for links that differ only by query string (e.g. the verification queue). */
  isActive?: (pathname: string, search: URLSearchParams) => boolean;
}

function OrgSwitcher() {
  const { t } = useTranslation();
  const { me, activeOrg, switchOrg } = useAuth();
  const navigate = useNavigate();
  if (!me || me.memberships.length === 0) return null;

  return (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-white/60">
        {t('shell.organization')}
      </span>
      <select
        className="w-full rounded-lg bg-white/10 px-2 py-2 text-sm text-white [&>option]:text-gray-900"
        value={activeOrg?.organizationId ?? ''}
        onChange={(e) => {
          switchOrg(e.target.value);
          const target = me.memberships.find((m) => m.organizationId === e.target.value);
          navigate(target?.type === 'PLATFORM' ? '/admin' : '/app');
        }}
      >
        {me.memberships.map((m) => (
          <option key={m.organizationId} value={m.organizationId}>
            {m.legalName} · {t(`orgType.${m.type}`)}
          </option>
        ))}
      </select>
    </label>
  );
}

function Banners() {
  const { t } = useTranslation();
  const { me, activeOrg } = useAuth();
  const [sent, setSent] = useState(false);
  const resend = useMutation({
    mutationFn: () => api('/auth/email/verification', { method: 'POST' }),
    onSuccess: () => setSent(true),
  });
  if (!me) return null;

  const banners: ReactNode[] = [];
  if (me.user.mfaSetupRequired) {
    banners.push(
      <Alert key="mfa" tone="action" title={t('shell.mfaRequiredTitle')}>
        {t('shell.mfaRequiredBody')}
      </Alert>,
    );
  }
  if (!me.user.emailVerified) {
    banners.push(
      <Alert
        key="email"
        tone="action"
        title={t('shell.emailUnverified')}
        action={
          sent ? (
            <span className="text-sm font-semibold">{t('shell.emailSent')}</span>
          ) : (
            <Button variant="secondary" loading={resend.isPending} onClick={() => resend.mutate()}>
              {t('shell.resendEmail')}
            </Button>
          )
        }
      />,
    );
  }
  if (activeOrg?.status === 'PENDING_VERIFICATION') {
    banners.push(
      <Alert key="pending" tone="info" title={t('shell.pendingTitle')}>
        {t('shell.pendingBody')}
      </Alert>,
    );
  }
  if (activeOrg && (activeOrg.status === 'SUSPENDED' || activeOrg.status === 'REJECTED')) {
    banners.push(
      <Alert key="blocked" tone="danger" title={t(`shell.blocked.${activeOrg.status}`)}>
        {t('shell.blockedBody')}
      </Alert>,
    );
  }
  return banners.length ? <div className="mb-6 space-y-3">{banners}</div> : null;
}

export function AppShell({ nav, area }: { nav: NavItem[]; area: 'app' | 'admin' }) {
  const { t } = useTranslation();
  const { me, activeOrg, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const search = new URLSearchParams(location.search);

  const sidebar = (
    <nav className="flex h-full flex-col gap-6 bg-primary-900 p-4 text-white">
      <div>
        <p className="text-lg font-semibold">{t('app.name')}</p>
        <p className="text-xs text-white/60">
          {area === 'admin' ? t('shell.adminArea') : t('shell.clientArea')}
        </p>
      </div>
      <OrgSwitcher />
      {activeOrg && (
        <div>
          <OrgStatusBadge status={activeOrg.status} />
        </div>
      )}
      <ul className="flex-1 space-y-1">
        {nav.map((item) => (
          <li key={item.to}>
            <NavLink
              to={item.to}
              end={item.end}
              onClick={() => setOpen(false)}
              className={({ isActive }) => {
                const active = item.isActive ? item.isActive(location.pathname, search) : isActive;
                return `block rounded-lg px-3 py-2 text-sm ${active ? 'bg-white/15 font-semibold' : 'text-white/80 hover:bg-white/10'}`;
              }}
            >
              {item.label}
            </NavLink>
          </li>
        ))}
      </ul>
      <NotificationsNavItem
        to={area === 'admin' ? '/admin/notifications' : '/app/notifications'}
        onNavigate={() => setOpen(false)}
      />
      <div className="space-y-3 border-t border-white/10 pt-4 text-sm">
        <p className="truncate text-white/80" title={me?.user.email}>
          {me?.user.firstName} {me?.user.lastName}
        </p>
        <LanguageSwitch />
        <button
          type="button"
          className="block w-full rounded-lg border border-white/20 px-3 py-1.5 text-start hover:bg-white/10"
          onClick={async () => {
            await logout();
            navigate('/login');
          }}
        >
          {t('shell.signOut')}
        </button>
      </div>
    </nav>
  );

  return (
    <div className="min-h-screen bg-gray-50 lg:flex print:bg-white">
      <aside className="hidden w-64 shrink-0 lg:block print:hidden">{sidebar}</aside>
      <div className="flex items-center justify-between bg-primary-900 px-4 py-3 text-white lg:hidden print:hidden">
        <span className="font-semibold">{t('app.name')}</span>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="rounded border border-white/30 px-2 py-1 text-sm"
          aria-expanded={open}
        >
          {t('shell.menu')}
        </button>
      </div>
      {open && <div className="lg:hidden">{sidebar}</div>}
      <div className="flex min-w-0 flex-1 flex-col">
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-8 print:max-w-none print:p-0">
          <div className="print:hidden">
            <Banners />
          </div>
          {me && me.memberships.length === 0 ? (
            <Alert tone="action" title={t('shell.noMembershipTitle')}>
              {t('shell.noMembershipBody')}
            </Alert>
          ) : (
            <Outlet />
          )}
        </main>
        <footer className="flex flex-col gap-2 border-t print:hidden border-gray-200 px-8 py-4 text-xs text-gray-500 sm:flex-row sm:items-center sm:justify-between">
          <p className="max-w-3xl text-start">{t('disclaimer.intermediary')}</p>
          <ApiStatus />
        </footer>
      </div>
    </div>
  );
}

/** Used by route guards: where should this user land? */
export { homePathFor };
