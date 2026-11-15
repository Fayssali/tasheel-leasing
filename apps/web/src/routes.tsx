import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { createBrowserRouter, Navigate, useLocation } from 'react-router';
import { AppShell } from './components/AppShell';
import { Spinner } from './components/ui';
import { useAuth } from './lib/auth';
import type { Me } from './lib/types';
import {
  AdminAuditPage,
  AdminDashboardPage,
  AdminOrganizationDetailPage,
  AdminOrganizationsPage,
} from './pages/admin/AdminPages';
import { DashboardPage } from './pages/app/DashboardPage';
import { OrganizationPage } from './pages/app/OrganizationPage';
import { SecurityPage } from './pages/app/SecurityPage';
import { TeamPage } from './pages/app/TeamPage';
import { AcceptInvitationPage } from './pages/auth/AcceptInvitationPage';
import { ForgotPasswordPage, ResetPasswordPage, VerifyEmailPage } from './pages/auth/AccountPages';
import { LoginPage } from './pages/auth/LoginPage';
import { RegisterPage } from './pages/auth/RegisterPage';
import { LandingPage } from './pages/LandingPage';

/** Where a signed-in user lands: the admin console for Tasheel staff, the client area otherwise. */
export function homePathFor(me: Me | null): string {
  if (!me) return '/login';
  const stored = (() => {
    try {
      return localStorage.getItem('tasheel.activeOrg');
    } catch {
      return null;
    }
  })();
  const active = me.memberships.find((m) => m.organizationId === stored) ?? me.memberships[0];
  if (me.user.mfaSetupRequired)
    return active?.type === 'PLATFORM' ? '/admin/security' : '/app/security';
  return active?.type === 'PLATFORM' ? '/admin' : '/app';
}

function FullPageSpinner() {
  return (
    <div className="flex min-h-screen items-center justify-center text-primary-600">
      <Spinner />
    </div>
  );
}

/**
 * Signed-in only. When MFA is mandatory and not yet enabled, every page except Security
 * redirects there (the API would refuse them anyway with MFA_SETUP_REQUIRED).
 */
function RequireAuth({ children, area }: { children: ReactNode; area: 'app' | 'admin' }) {
  const { status, me, activeOrg } = useAuth();
  const location = useLocation();
  if (status === 'loading') return <FullPageSpinner />;
  if (status === 'anonymous' || !me) {
    return (
      <Navigate
        to={`/login?redirect=${encodeURIComponent(location.pathname + location.search)}`}
        replace
      />
    );
  }
  const securityPath = `/${area}/security`;
  if (me.user.mfaSetupRequired && location.pathname !== securityPath)
    return <Navigate to={securityPath} replace />;
  if (area === 'admin' && activeOrg?.type !== 'PLATFORM') return <Navigate to="/app" replace />;
  if (area === 'app' && activeOrg?.type === 'PLATFORM') return <Navigate to="/admin" replace />;
  return <>{children}</>;
}

/** Public auth pages bounce signed-in users home (except invitation and email links). */
function GuestOnly({ children }: { children: ReactNode }) {
  const { status, me } = useAuth();
  if (status === 'loading') return <FullPageSpinner />;
  if (status === 'authenticated') return <Navigate to={homePathFor(me)} replace />;
  return <>{children}</>;
}

function AppArea() {
  const { t } = useTranslation();
  return (
    <RequireAuth area="app">
      <AppShell
        area="app"
        nav={[
          { to: '/app', label: t('nav.dashboard'), end: true },
          { to: '/app/organization', label: t('nav.organization') },
          { to: '/app/team', label: t('nav.team') },
          { to: '/app/security', label: t('nav.security') },
        ]}
      />
    </RequireAuth>
  );
}

function AdminArea() {
  const { t } = useTranslation();
  return (
    <RequireAuth area="admin">
      <AppShell
        area="admin"
        nav={[
          { to: '/admin', label: t('nav.adminDashboard'), end: true },
          {
            to: '/admin/organizations?status=PENDING_VERIFICATION',
            label: t('nav.verificationQueue'),
            isActive: (path, q) =>
              path === '/admin/organizations' && q.get('status') === 'PENDING_VERIFICATION',
          },
          {
            to: '/admin/organizations',
            label: t('nav.organizations'),
            isActive: (path, q) =>
              path.startsWith('/admin/organizations') && q.get('status') !== 'PENDING_VERIFICATION',
          },
          { to: '/admin/audit', label: t('nav.audit') },
          { to: '/admin/team', label: t('nav.team') },
          { to: '/admin/security', label: t('nav.security') },
        ]}
      />
    </RequireAuth>
  );
}

export const router = createBrowserRouter([
  { path: '/', element: <LandingPage /> },
  {
    path: '/login',
    element: (
      <GuestOnly>
        <LoginPage />
      </GuestOnly>
    ),
  },
  {
    path: '/register',
    element: (
      <GuestOnly>
        <RegisterPage />
      </GuestOnly>
    ),
  },
  {
    path: '/forgot-password',
    element: (
      <GuestOnly>
        <ForgotPasswordPage />
      </GuestOnly>
    ),
  },
  { path: '/reset-password', element: <ResetPasswordPage /> },
  { path: '/verify-email', element: <VerifyEmailPage /> },
  { path: '/accept-invitation', element: <AcceptInvitationPage /> },
  {
    path: '/app',
    element: <AppArea />,
    children: [
      { index: true, element: <DashboardPage /> },
      { path: 'organization', element: <OrganizationPage /> },
      { path: 'team', element: <TeamPage /> },
      { path: 'security', element: <SecurityPage /> },
    ],
  },
  {
    path: '/admin',
    element: <AdminArea />,
    children: [
      { index: true, element: <AdminDashboardPage /> },
      { path: 'organizations', element: <AdminOrganizationsPage /> },
      { path: 'organizations/:id', element: <AdminOrganizationDetailPage /> },
      { path: 'audit', element: <AdminAuditPage /> },
      { path: 'team', element: <TeamPage /> },
      { path: 'security', element: <SecurityPage /> },
    ],
  },
  { path: '*', element: <Navigate to="/" replace /> },
]);
