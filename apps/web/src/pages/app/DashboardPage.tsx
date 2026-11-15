import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { OrgStatusBadge } from '../../components/StatusBadge';
import { Card, PageHeader } from '../../components/ui';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useLocalizedName } from '../../lib/format';
import type { OrganizationProfile } from '../../lib/types';

/**
 * Phase 1 home: where the organization stands and what to do next. Business KPIs
 * (applications, offers, listings) replace the checklist as their modules arrive.
 */
export function DashboardPage() {
  const { t } = useTranslation();
  const { me, activeOrg } = useAuth();
  const localized = useLocalizedName();
  const profile = useQuery({
    queryKey: ['org', activeOrg?.organizationId],
    queryFn: () => api<OrganizationProfile>('/organizations/current', { org: true }),
    enabled: !!activeOrg && !me?.user.mfaSetupRequired,
  });
  if (!me || !activeOrg) return null;
  // The fields Tasheel needs to verify an organization.
  const profileComplete = !!(
    profile.data?.rcNumber &&
    profile.data?.nif &&
    profile.data?.wilayaCode &&
    profile.data?.address
  );

  const steps = [
    { done: true, label: t('dashboard.stepAccount') },
    { done: me.user.emailVerified, label: t('dashboard.stepEmail') },
    {
      done: me.user.mfaEnabled,
      label: t('dashboard.stepMfa'),
      to: '/app/security',
      required: me.user.mfaSetupRequired,
    },
    { done: profileComplete, label: t('dashboard.stepProfile'), to: '/app/organization' },
    { done: activeOrg.status === 'VERIFIED', label: t('dashboard.stepVerification') },
  ];

  return (
    <>
      <PageHeader
        title={t('dashboard.welcome', { name: me.user.firstName })}
        subtitle={activeOrg.legalName}
      />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card title={t('dashboard.organization')} className="lg:col-span-1">
          <dl className="space-y-3 text-sm">
            <div>
              <dt className="text-gray-500">{t('fields.type')}</dt>
              <dd className="font-semibold">{t(`orgType.${activeOrg.type}`)}</dd>
            </div>
            <div>
              <dt className="text-gray-500">{t('fields.status')}</dt>
              <dd>
                <OrgStatusBadge status={activeOrg.status} />
              </dd>
            </div>
            <div>
              <dt className="text-gray-500">{t('fields.yourRole')}</dt>
              <dd className="font-semibold">
                {activeOrg.roles.map((r) => localized(r.name)).join(', ')}
              </dd>
            </div>
          </dl>
        </Card>
        <Card title={t('dashboard.nextSteps')} className="lg:col-span-2">
          <ol className="space-y-3">
            {steps.map((s, i) => (
              <li key={i} className="flex items-center gap-3 text-sm">
                <span
                  aria-hidden
                  className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${s.done ? 'bg-success-600 text-white' : 'bg-gray-200 text-gray-600'}`}
                >
                  {s.done ? '✓' : i + 1}
                </span>
                <span className={s.done ? 'text-gray-500' : 'text-gray-900'}>
                  {s.label}
                  {s.required && !s.done && (
                    <strong className="ms-2 text-warning-600">{t('dashboard.required')}</strong>
                  )}
                </span>
                {s.to && !s.done && (
                  <Link
                    to={s.to}
                    className="ms-auto text-sm font-semibold text-primary-600 hover:underline"
                  >
                    {t('common.open')}
                  </Link>
                )}
              </li>
            ))}
          </ol>
        </Card>
      </div>
      <p className="mt-6 text-sm text-gray-500">{t('dashboard.comingSoon')}</p>
    </>
  );
}
