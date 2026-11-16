import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { OrganizationStatus, OrganizationType } from '@tasheel/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams, useSearchParams } from 'react-router';
import { OrgStatusBadge } from '../../components/StatusBadge';
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  Modal,
  PageHeader,
  SelectInput,
  Spinner,
  Table,
  Td,
  TextInput,
} from '../../components/ui';
import { api } from '../../lib/api';
import { PlatformReport } from './AdminBilling';
import { OrgDocumentsPanel } from './OrgDocumentsPanel';
import { formatDate, useErrorMessage, useLocalizedName } from '../../lib/format';
import type {
  AdminOrganizationDetail,
  AdminOrganizationRow,
  AuditEntry,
  Kpis,
  Page,
} from '../../lib/types';

const TYPES: OrganizationType[] = ['BUSINESS', 'SUPPLIER', 'FINANCIAL_INSTITUTION'];
const STATUSES: OrganizationStatus[] = [
  'PENDING_VERIFICATION',
  'VERIFIED',
  'SUSPENDED',
  'REJECTED',
];

// ---------------------------------------------------------------------------
// KPIs
// ---------------------------------------------------------------------------

export function AdminDashboardPage() {
  const { t } = useTranslation();
  const errorMessage = useErrorMessage();
  const kpis = useQuery({
    queryKey: ['admin-kpis'],
    queryFn: () => api<Kpis>('/admin/kpis', { org: true }),
  });

  if (kpis.isLoading) return <Spinner />;
  if (kpis.isError || !kpis.data) return <Alert tone="danger">{errorMessage(kpis.error)}</Alert>;
  const k = kpis.data;
  const total = (type: OrganizationType) =>
    Object.values(k.organizations[type] ?? {}).reduce((a, b) => a + (b ?? 0), 0);

  const tiles = [
    {
      label: t('admin.kpi.pending'),
      value: k.pendingVerification,
      to: '/admin/organizations?status=PENDING_VERIFICATION',
      highlight: k.pendingVerification > 0,
    },
    { label: t('admin.kpi.businesses'), value: total('BUSINESS') },
    { label: t('admin.kpi.suppliers'), value: total('SUPPLIER') },
    { label: t('admin.kpi.institutions'), value: total('FINANCIAL_INSTITUTION') },
    { label: t('admin.kpi.users'), value: k.users },
    { label: t('admin.kpi.new30d'), value: k.newOrganizations30d },
  ];

  return (
    <>
      <PageHeader
        title={t('admin.dashboardTitle')}
        subtitle={t('admin.generatedAt', { date: formatDate(k.generatedAt, true) })}
      />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {tiles.map((tile) => {
          const body = (
            <div
              className={`rounded-lg border bg-white p-5 ${tile.highlight ? 'border-warning-600' : 'border-gray-200'}`}
            >
              <p className="text-sm text-gray-600">{tile.label}</p>
              <p
                className={`mt-1 text-3xl font-semibold tabular-nums ${tile.highlight ? 'text-warning-600' : 'text-primary-900'}`}
              >
                {tile.value}
              </p>
            </div>
          );
          return tile.to ? (
            <Link key={tile.label} to={tile.to} className="block hover:opacity-90">
              {body}
            </Link>
          ) : (
            <div key={tile.label}>{body}</div>
          );
        })}
      </div>
      <PlatformReport />
      <Card title={t('admin.byStatus')} className="mt-6">
        <Table head={[t('fields.type'), ...STATUSES.map((s) => t(`status.${s}`))]}>
          {TYPES.map((type) => (
            <tr key={type}>
              <Td className="font-semibold">{t(`orgType.${type}`)}</Td>
              {STATUSES.map((s) => (
                <Td key={s} className="tabular-nums">
                  {k.organizations[type]?.[s] ?? 0}
                </Td>
              ))}
            </tr>
          ))}
        </Table>
      </Card>
    </>
  );
}

// ---------------------------------------------------------------------------
// Organization list / verification queue
// ---------------------------------------------------------------------------

export function AdminOrganizationsPage() {
  const { t } = useTranslation();
  const errorMessage = useErrorMessage();
  const [params, setParams] = useSearchParams();
  const status = params.get('status') ?? '';
  const type = params.get('type') ?? '';
  const [q, setQ] = useState(params.get('q') ?? '');

  const list = useInfiniteQuery({
    queryKey: ['admin-orgs', status, type, params.get('q') ?? ''],
    queryFn: ({ pageParam }) =>
      api<Page<AdminOrganizationRow>>('/admin/organizations', {
        org: true,
        query: { status, type, q: params.get('q') ?? '', cursor: pageParam, limit: 25 },
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

  const setFilter = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next);
  };
  const rows = list.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <>
      <PageHeader
        title={t('admin.orgsTitle')}
        subtitle={status === 'PENDING_VERIFICATION' ? t('admin.queueSubtitle') : undefined}
      />
      <Card className="mb-6">
        <form
          className="grid gap-4 sm:grid-cols-4 sm:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            setFilter('q', q.trim());
          }}
        >
          <SelectInput
            label={t('fields.status')}
            value={status}
            onChange={(e) => setFilter('status', e.target.value)}
            options={[
              { value: '', label: t('common.all') },
              ...STATUSES.map((s) => ({ value: s, label: t(`status.${s}`) })),
            ]}
          />
          <SelectInput
            label={t('fields.type')}
            value={type}
            onChange={(e) => setFilter('type', e.target.value)}
            options={[
              { value: '', label: t('common.all') },
              ...TYPES.map((ty) => ({ value: ty, label: t(`orgType.${ty}`) })),
            ]}
          />
          <TextInput
            label={t('admin.search')}
            placeholder={t('admin.searchHint')}
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <Button type="submit" variant="secondary">
            {t('common.search')}
          </Button>
        </form>
      </Card>

      <Card>
        {list.isLoading ? (
          <Spinner />
        ) : list.isError ? (
          <Alert tone="danger">{errorMessage(list.error)}</Alert>
        ) : rows.length === 0 ? (
          <EmptyState>{t('admin.noOrgs')}</EmptyState>
        ) : (
          <>
            <Table
              head={[
                t('fields.legalName'),
                t('fields.type'),
                t('fields.status'),
                t('fields.nif'),
                t('fields.wilayaCode'),
                t('admin.members'),
                t('admin.registered'),
              ]}
            >
              {rows.map((o) => (
                <tr key={o.id} className="hover:bg-gray-50">
                  <Td>
                    <Link
                      to={`/admin/organizations/${o.id}`}
                      className="font-semibold text-primary-600 hover:underline"
                    >
                      {o.legalName}
                    </Link>
                    {o.tradeName && (
                      <span className="block text-xs text-gray-500">{o.tradeName}</span>
                    )}
                  </Td>
                  <Td>{t(`orgType.${o.type}`)}</Td>
                  <Td>
                    <OrgStatusBadge status={o.status} />
                  </Td>
                  <Td>
                    <span dir="ltr">{o.nif ?? '—'}</span>
                  </Td>
                  <Td>{o.wilayaCode ?? '—'}</Td>
                  <Td className="tabular-nums">{o._count.members}</Td>
                  <Td>{formatDate(o.createdAt)}</Td>
                </tr>
              ))}
            </Table>
            {list.hasNextPage && (
              <div className="mt-4 flex justify-center">
                <Button
                  variant="secondary"
                  loading={list.isFetchingNextPage}
                  onClick={() => list.fetchNextPage()}
                >
                  {t('common.loadMore')}
                </Button>
              </div>
            )}
          </>
        )}
      </Card>
    </>
  );
}

// ---------------------------------------------------------------------------
// Organization detail + decisions
// ---------------------------------------------------------------------------

type Action = 'verify' | 'reject' | 'suspend' | 'reactivate';
const ACTIONS_BY_STATUS: Record<OrganizationStatus, Action[]> = {
  PENDING_VERIFICATION: ['verify', 'reject', 'suspend'],
  VERIFIED: ['suspend'],
  REJECTED: ['verify'],
  SUSPENDED: ['reactivate'],
};
const NEEDS_REASON: Action[] = ['reject', 'suspend'];

export function AdminOrganizationDetailPage() {
  const { t } = useTranslation();
  const { id = '' } = useParams();
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  const localized = useLocalizedName();
  const [pending, setPending] = useState<Action | null>(null);
  const [reason, setReason] = useState('');

  const org = useQuery({
    queryKey: ['admin-org', id],
    queryFn: () => api<AdminOrganizationDetail>(`/admin/organizations/${id}`, { org: true }),
  });
  const logs = useQuery({
    queryKey: ['admin-org-logs', id],
    queryFn: () =>
      api<Page<AuditEntry>>('/admin/audit-logs', {
        org: true,
        query: { organizationId: id, limit: 20 },
      }),
  });

  const decide = useMutation({
    mutationFn: (action: Action) =>
      api(`/admin/organizations/${id}/${action}`, {
        method: 'POST',
        org: true,
        body: reason.trim() ? { reason: reason.trim() } : {},
      }),
    onSuccess: async () => {
      setPending(null);
      setReason('');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['admin-org', id] }),
        queryClient.invalidateQueries({ queryKey: ['admin-org-logs', id] }),
        queryClient.invalidateQueries({ queryKey: ['admin-orgs'] }),
        queryClient.invalidateQueries({ queryKey: ['admin-kpis'] }),
      ]);
    },
  });

  if (org.isLoading) return <Spinner />;
  if (org.isError || !org.data) return <Alert tone="danger">{errorMessage(org.error)}</Alert>;
  const o = org.data;
  const fields: Array<[string, string | null]> = [
    ['tradeName', o.tradeName],
    ['rcNumber', o.rcNumber],
    ['nif', o.nif],
    ['nis', o.nis],
    ['articleImposition', o.articleImposition],
    ['wilayaCode', o.wilayaCode],
    ['address', o.address],
    ['email', o.email],
    ['phone', o.phone],
  ];

  return (
    <>
      <Link
        to="/admin/organizations"
        className="mb-4 inline-block text-sm text-primary-600 hover:underline"
      >
        ← {t('admin.backToList')}
      </Link>
      <PageHeader
        title={o.legalName}
        subtitle={`${t(`orgType.${o.type}`)} · ${t('admin.registered')} ${formatDate(o.createdAt)}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <OrgStatusBadge status={o.status} />
            {ACTIONS_BY_STATUS[o.status].map((a) => (
              <Button
                key={a}
                variant={a === 'verify' || a === 'reactivate' ? 'primary' : 'danger'}
                onClick={() => setPending(a)}
              >
                {t(`admin.action.${a}`)}
              </Button>
            ))}
          </div>
        }
      />
      {o.statusReason && (
        <div className="mb-6">
          <Alert tone="danger" title={t('org.statusReason')}>
            {o.statusReason}
          </Alert>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title={t('admin.verificationFile')}>
          <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
            {fields.map(([k, v]) => (
              <div key={k}>
                <dt className="text-gray-500">{t(`fields.${k}`)}</dt>
                <dd className="font-semibold" dir={v && /^[\d\s/+-]+$/.test(v) ? 'ltr' : undefined}>
                  {v || <span className="font-normal text-warning-600">{t('admin.missing')}</span>}
                </dd>
              </div>
            ))}
          </dl>
          <p className="mt-4 text-xs text-gray-500">{t('admin.documentsLater')}</p>
        </Card>

        <Card title={t('admin.members')}>
          <ul className="divide-y divide-gray-100 text-sm">
            {o.members.map((m) => (
              <li key={m.id} className="py-2">
                <p className="font-semibold">
                  {m.user.firstName} {m.user.lastName}{' '}
                  <span className="font-normal text-gray-500">
                    · {m.roles.map((r) => localized(r.role.name)).join(', ')}
                  </span>
                </p>
                <p className="text-gray-600" dir="ltr">
                  {m.user.email}
                </p>
                <div className="mt-1 flex flex-wrap gap-2">
                  <Badge tone={m.user.emailVerifiedAt ? 'success' : 'action'}>
                    {m.user.emailVerifiedAt ? t('admin.emailVerified') : t('admin.emailUnverified')}
                  </Badge>
                  <Badge tone={m.user.mfaEnabled ? 'success' : 'neutral'}>
                    {m.user.mfaEnabled ? t('admin.mfaOn') : t('admin.mfaOff')}
                  </Badge>
                  <span className="text-xs text-gray-500">
                    {t('admin.lastLogin')}: {formatDate(m.user.lastLoginAt, true)}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      {o.type !== 'PLATFORM' && <OrgDocumentsPanel organizationId={o.id} />}

      <Card title={t('admin.history')} className="mt-6">
        <AuditTable entries={logs.data?.items ?? []} loading={logs.isLoading} />
      </Card>

      <Modal
        open={pending !== null}
        title={pending ? t(`admin.confirm.${pending}`, { name: o.legalName }) : ''}
        onClose={() => setPending(null)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setPending(null)}>
              {t('common.cancel')}
            </Button>
            <Button
              variant={pending === 'verify' || pending === 'reactivate' ? 'primary' : 'danger'}
              loading={decide.isPending}
              disabled={
                pending !== null && NEEDS_REASON.includes(pending) && reason.trim().length < 3
              }
              onClick={() => pending && decide.mutate(pending)}
            >
              {pending ? t(`admin.action.${pending}`) : ''}
            </Button>
          </>
        }
      >
        {decide.isError && <Alert tone="danger">{errorMessage(decide.error)}</Alert>}
        <p className="text-sm text-gray-700">{t('admin.notifyNotice')}</p>
        {pending && NEEDS_REASON.includes(pending) && (
          <TextInput
            label={t('admin.reason')}
            hint={t('admin.reasonHint')}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            required
            minLength={3}
          />
        )}
      </Modal>
    </>
  );
}

// ---------------------------------------------------------------------------
// Audit log
// ---------------------------------------------------------------------------

function AuditTable({ entries, loading }: { entries: AuditEntry[]; loading?: boolean }) {
  const { t } = useTranslation();
  if (loading) return <Spinner />;
  if (entries.length === 0) return <EmptyState>{t('admin.noAudit')}</EmptyState>;
  return (
    <Table head={[t('admin.when'), t('admin.actionCol'), t('admin.entity'), t('admin.details')]}>
      {entries.map((e) => (
        <tr key={e.id}>
          <Td className="whitespace-nowrap">{formatDate(e.createdAt, true)}</Td>
          <Td>
            <code className="text-xs" dir="ltr">
              {e.action}
            </code>
          </Td>
          <Td className="text-xs text-gray-600">{e.entityType}</Td>
          <Td>
            {e.diff ? (
              <code
                className="block max-w-md truncate text-xs text-gray-600"
                dir="ltr"
                title={JSON.stringify(e.diff)}
              >
                {JSON.stringify(e.diff)}
              </code>
            ) : (
              '—'
            )}
          </Td>
        </tr>
      ))}
    </Table>
  );
}

export function AdminAuditPage() {
  const { t } = useTranslation();
  const errorMessage = useErrorMessage();
  const [action, setAction] = useState('');
  const [applied, setApplied] = useState('');

  const logs = useInfiniteQuery({
    queryKey: ['admin-audit', applied],
    queryFn: ({ pageParam }) =>
      api<Page<AuditEntry>>('/admin/audit-logs', {
        org: true,
        query: { action: applied, cursor: pageParam, limit: 50 },
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

  return (
    <>
      <PageHeader title={t('admin.auditTitle')} subtitle={t('admin.auditSubtitle')} />
      <Card className="mb-6">
        <form
          className="flex flex-col gap-3 sm:flex-row sm:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            setApplied(action.trim());
          }}
        >
          <div className="sm:w-80">
            <TextInput
              label={t('admin.actionFilter')}
              placeholder="auth. · organization. · member."
              value={action}
              onChange={(e) => setAction(e.target.value)}
              dir="ltr"
            />
          </div>
          <Button type="submit" variant="secondary">
            {t('common.search')}
          </Button>
        </form>
      </Card>
      <Card>
        {logs.isError ? (
          <Alert tone="danger">{errorMessage(logs.error)}</Alert>
        ) : (
          <>
            <AuditTable
              entries={logs.data?.pages.flatMap((p) => p.items) ?? []}
              loading={logs.isLoading}
            />
            {logs.hasNextPage && (
              <div className="mt-4 flex justify-center">
                <Button
                  variant="secondary"
                  loading={logs.isFetchingNextPage}
                  onClick={() => logs.fetchNextPage()}
                >
                  {t('common.loadMore')}
                </Button>
              </div>
            )}
          </>
        )}
      </Card>
    </>
  );
}
