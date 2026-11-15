import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { Price, useListingTitle } from '../../components/marketplace';
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
import { api, ApiError, downloadFile } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { formatDate, useErrorMessage, useLocalizedName } from '../../lib/format';
import type {
  Application,
  ApplicationDetail,
  CompanyProfile,
  LocalizedText,
  Offer,
  ProductMatch,
  Submission,
  Vault,
} from '../../lib/types';
import { DocStateBadge, UploadModal, useDocTypeName } from '../app/DocumentsPage';
import {
  ApplicationStatusBadge,
  OfferStatusBadge,
  SubmissionStatusBadge,
  Timeline,
} from './common';

interface EligibleQuotation {
  id: string;
  reference: string;
  total: string;
  listing: { reference: string; title: LocalizedText; organization: { legalName: string } | null };
}

export function ApplicationsPage() {
  const { t } = useTranslation();
  const { activeOrg } = useAuth();
  const title = useListingTitle();
  const errorMessage = useErrorMessage();
  const apps = useQuery({
    queryKey: ['applications', activeOrg?.organizationId],
    queryFn: () =>
      api<
        Array<
          Application & {
            submissions: Array<{ status: string }>;
            offers: Array<{ status: string }>;
          }
        >
      >('/applications', { org: true }),
  });
  return (
    <>
      <PageHeader
        title={t('financing.title')}
        subtitle={t('financing.subtitle')}
        actions={
          <Link
            to="/app/financing/new"
            className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white hover:bg-primary-900"
          >
            {t('financing.new')}
          </Link>
        }
      />
      {apps.isLoading ? (
        <Spinner />
      ) : apps.isError ? (
        <Alert tone="danger">{errorMessage(apps.error)}</Alert>
      ) : !apps.data?.length ? (
        <EmptyState>{t('financing.empty')}</EmptyState>
      ) : (
        <Table
          head={[
            t('financing.colReference'),
            t('financing.colEquipment'),
            t('financing.colFinanced'),
            t('financing.colDuration'),
            t('financing.colStatus'),
            t('financing.colActivity'),
          ]}
        >
          {apps.data.map((a) => (
            <tr key={a.id} className="hover:bg-gray-50">
              <Td>
                <Link
                  to={`/app/financing/${a.id}`}
                  className="font-semibold text-primary-600 hover:underline"
                >
                  {a.reference}
                </Link>
                <div className="text-xs text-gray-500">{formatDate(a.createdAt)}</div>
              </Td>
              <Td>{title(a.equipmentSnapshot.title)}</Td>
              <Td>
                <Price value={a.financedAmount} onRequest={false} bare />
              </Td>
              <Td>{t('financing.months', { count: a.durationMonths })}</Td>
              <Td>
                <ApplicationStatusBadge status={a.status} />
              </Td>
              <Td className="text-xs text-gray-600">
                {t('financing.activity', {
                  institutions: a.submissions.length,
                  offers: a.offers.filter((o) => o.status === 'ISSUED' || o.status === 'ACCEPTED')
                    .length,
                })}
              </Td>
            </tr>
          ))}
        </Table>
      )}
    </>
  );
}

function ProfileFields({
  profile,
  onChange,
}: {
  profile: CompanyProfile;
  onChange: (p: CompanyProfile) => void;
}) {
  const { t } = useTranslation();
  const num = (v: string) => (v === '' ? undefined : Number(v));
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <TextInput
        label={t('financing.yearsInBusiness')}
        type="number"
        min={0}
        max={200}
        value={profile.yearsInBusiness ?? ''}
        onChange={(e) => onChange({ ...profile, yearsInBusiness: num(e.target.value) })}
        dir="ltr"
      />
      <TextInput
        label={t('financing.employees')}
        type="number"
        min={0}
        value={profile.employees ?? ''}
        onChange={(e) => onChange({ ...profile, employees: num(e.target.value) })}
        dir="ltr"
      />
      <TextInput
        label={t('financing.annualRevenue')}
        value={profile.annualRevenue ?? ''}
        onChange={(e) =>
          onChange({
            ...profile,
            annualRevenue: e.target.value.replace(/[^\d.]/g, '') || undefined,
          })
        }
        inputMode="decimal"
        dir="ltr"
      />
      <TextInput
        label={t('financing.sector')}
        value={profile.sector ?? ''}
        onChange={(e) => onChange({ ...profile, sector: e.target.value || undefined })}
        maxLength={150}
      />
    </div>
  );
}

const typeOptions = (t: (k: string) => string) => [
  { value: '', label: t('financing.noPreference') },
  { value: 'LEASING', label: t('productType.LEASING') },
  { value: 'IJARA', label: t('productType.IJARA') },
];

export function NewApplicationPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const title = useListingTitle();
  const errorMessage = useErrorMessage();
  const [quotationId, setQuotationId] = useState(params.get('quotation') ?? '');
  const [downPayment, setDownPayment] = useState('');
  const [duration, setDuration] = useState('48');
  const [preferredType, setPreferredType] = useState('');
  const [purpose, setPurpose] = useState('');
  const [profile, setProfile] = useState<CompanyProfile>({});
  const quotations = useQuery({
    queryKey: ['eligible-quotations'],
    queryFn: () => api<EligibleQuotation[]>('/applications/eligible-quotations', { org: true }),
  });
  const chosen = quotations.data?.find((q) => q.id === quotationId);

  const create = useMutation({
    mutationFn: () =>
      api<{ id: string }>('/applications', {
        method: 'POST',
        org: true,
        body: {
          quotationId,
          downPayment: downPayment || '0',
          durationMonths: Number(duration),
          preferredType: preferredType || undefined,
          purpose: purpose.trim() || undefined,
          companyProfile: profile,
        },
      }),
    onSuccess: (res) => navigate(`/app/financing/${res.id}`, { replace: true }),
  });
  function submit(e: FormEvent) {
    e.preventDefault();
    create.mutate();
  }

  if (quotations.isLoading) return <Spinner />;
  return (
    <>
      <PageHeader title={t('financing.newTitle')} subtitle={t('financing.newSubtitle')} />
      {!quotations.data?.length ? (
        <EmptyState>
          {t('financing.noAcceptedQuotation')}{' '}
          <Link to="/app/quotations" className="text-primary-600 hover:underline">
            {t('nav.quotations')}
          </Link>
        </EmptyState>
      ) : (
        <form onSubmit={submit} className="max-w-3xl space-y-6">
          {create.isError && <Alert tone="danger">{errorMessage(create.error)}</Alert>}
          <Card title={t('financing.sectionEquipment')}>
            <SelectInput
              label={t('financing.quotation')}
              value={quotationId}
              required
              onChange={(e) => setQuotationId(e.target.value)}
              options={[
                { value: '', label: t('financing.chooseQuotation'), disabled: true },
                ...quotations.data.map((q) => ({
                  value: q.id,
                  label: `${q.reference} — ${title(q.listing.title)}`,
                })),
              ]}
            />
            {chosen && (
              <p className="mt-3 text-sm text-gray-700">
                {t('financing.quotationTotal')}:{' '}
                <Price
                  value={chosen.total}
                  onRequest={false}
                  includesVat
                  className="font-semibold"
                />{' '}
                · {chosen.listing.organization?.legalName}
              </p>
            )}
          </Card>
          <Card title={t('financing.sectionRequest')}>
            <div className="grid gap-4 sm:grid-cols-3">
              <TextInput
                label={t('financing.downPayment')}
                hint={t('financing.downPaymentHint')}
                value={downPayment}
                onChange={(e) => setDownPayment(e.target.value.replace(/[^\d.]/g, ''))}
                inputMode="decimal"
                dir="ltr"
              />
              <TextInput
                label={t('financing.durationMonths')}
                type="number"
                min={1}
                max={240}
                value={duration}
                onChange={(e) => setDuration(e.target.value)}
                required
                dir="ltr"
              />
              <SelectInput
                label={t('financing.preferredType')}
                value={preferredType}
                onChange={(e) => setPreferredType(e.target.value)}
                options={typeOptions(t)}
              />
            </div>
            <label className="mt-4 block space-y-1">
              <span className="block text-sm font-semibold text-gray-800">
                {t('financing.purpose')}
              </span>
              <textarea
                value={purpose}
                onChange={(e) => setPurpose(e.target.value)}
                rows={3}
                maxLength={2000}
                className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                dir="auto"
              />
            </label>
          </Card>
          <Card title={t('financing.sectionCompany')}>
            <p className="mb-3 text-xs text-gray-600">{t('financing.companyHint')}</p>
            <ProfileFields profile={profile} onChange={setProfile} />
          </Card>
          <div className="flex justify-end">
            <Button type="submit" loading={create.isPending}>
              {t('financing.createDraft')}
            </Button>
          </div>
        </form>
      )}
    </>
  );
}

function OffersComparison({
  offers,
  submissions,
  open,
  onDecide,
  deciding,
}: {
  offers: Offer[];
  submissions: Submission[];
  open: boolean;
  onDecide: (o: Offer, d: 'accept' | 'decline') => void;
  deciding: boolean;
}) {
  const { t } = useTranslation();
  const visible = offers.filter((o) => o.status !== 'WITHDRAWN');
  if (!visible.length) return null;
  const name = (o: Offer) =>
    submissions.find((s) => s.id === o.submissionId)?.institutionName ?? '';
  const cheapest = visible
    .filter((o) => o.status === 'ISSUED')
    .sort((a, b) => Number(a.totalCost) - Number(b.totalCost))[0]?.id;
  const rows: Array<[string, (o: Offer) => React.ReactNode]> = [
    [
      t('offers.installment'),
      (o) => <Price value={o.installmentAmount} onRequest={false} bare className="font-semibold" />,
    ],
    [t('offers.duration'), (o) => t('financing.months', { count: o.durationMonths })],
    [t('offers.rate'), (o) => `${Number(o.ratePct)} %`],
    [t('offers.financed'), (o) => <Price value={o.financedAmount} onRequest={false} bare />],
    [t('offers.downPayment'), (o) => <Price value={o.downPayment} onRequest={false} bare />],
    [t('offers.fees'), (o) => <Price value={o.feesAmount} onRequest={false} bare />],
    [t('offers.residual'), (o) => <Price value={o.residualValue} onRequest={false} bare />],
    [
      t('offers.totalCost'),
      (o) => <Price value={o.totalCost} onRequest={false} bare className="font-semibold" />,
    ],
    [t('offers.validUntil'), (o) => formatDate(o.validUntil)],
  ];
  return (
    <Card title={t('offers.title')}>
      <p className="mb-3 text-xs text-gray-600">{t('offers.disclaimer')}</p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th />
              {visible.map((o) => (
                <th key={o.id} className="px-3 py-2 text-start align-top">
                  <div className="font-semibold">{name(o)}</div>
                  <div className="text-xs font-normal text-gray-500">{o.reference}</div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    <OfferStatusBadge status={o.status} />
                    {o.id === cheapest && visible.length > 1 && (
                      <Badge tone="info">{t('offers.lowestCost')}</Badge>
                    )}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.map(([label, cell]) => (
              <tr key={label}>
                <td className="py-2 pe-3 text-gray-500">{label}</td>
                {visible.map((o) => (
                  <td key={o.id} className="px-3 py-2">
                    {cell(o)}
                  </td>
                ))}
              </tr>
            ))}
            <tr>
              <td className="py-2 pe-3 text-gray-500">{t('offers.conditions')}</td>
              {visible.map((o) => (
                <td
                  key={o.id}
                  className="whitespace-pre-line px-3 py-2 text-xs text-gray-600"
                  dir="auto"
                >
                  {o.conditions || '—'}
                </td>
              ))}
            </tr>
            {open && (
              <tr>
                <td />
                {visible.map((o) => (
                  <td key={o.id} className="px-3 py-3">
                    {o.status === 'ISSUED' && (
                      <div className="flex flex-col gap-2">
                        <Button
                          variant="accent"
                          loading={deciding}
                          onClick={() => onDecide(o, 'accept')}
                        >
                          {t('offers.accept')}
                        </Button>
                        <Button
                          variant="secondary"
                          disabled={deciding}
                          onClick={() => onDecide(o, 'decline')}
                        >
                          {t('offers.decline')}
                        </Button>
                      </div>
                    )}
                  </td>
                ))}
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

export function ApplicationPage() {
  const { t } = useTranslation();
  const { id = '' } = useParams();
  const { activeOrg } = useAuth();
  const queryClient = useQueryClient();
  const title = useListingTitle();
  const localized = useLocalizedName();
  const errorMessage = useErrorMessage();
  const [selected, setSelected] = useState<string[]>([]);
  const [uploadType, setUploadType] = useState<string | null>(null);
  const [replyTo, setReplyTo] = useState<Submission | null>(null);
  const [replyNote, setReplyNote] = useState('');
  const [confirm, setConfirm] = useState<{ offer: Offer; decision: 'accept' | 'decline' } | null>(
    null,
  );
  const [editing, setEditing] = useState(false);

  const app = useQuery({
    queryKey: ['application', id],
    queryFn: () => api<ApplicationDetail>(`/applications/${id}`, { org: true }),
  });
  const vault = useQuery({
    queryKey: ['vault', activeOrg?.organizationId],
    queryFn: () => api<Vault>('/documents', { org: true }),
  });
  const matches = useQuery({
    queryKey: ['matches', id],
    queryFn: () => api<ProductMatch[]>(`/applications/${id}/matches`, { org: true }),
    enabled: app.data?.status === 'DRAFT' || app.data?.status === 'SUBMITTED',
  });
  const typeName = useDocTypeName(vault.data?.types);
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['application', id] });
    void queryClient.invalidateQueries({ queryKey: ['applications'] });
    void queryClient.invalidateQueries({ queryKey: ['matches', id] });
  };

  const attach = useMutation({
    mutationFn: (documentIds: string[]) =>
      api(`/applications/${id}/documents`, { method: 'POST', org: true, body: { documentIds } }),
    onSuccess: refresh,
  });
  const detach = useMutation({
    mutationFn: (documentId: string) =>
      api(`/applications/${id}/documents/${documentId}`, { method: 'DELETE', org: true }),
    onSuccess: refresh,
  });
  const submit = useMutation({
    mutationFn: () =>
      api(`/applications/${id}/submit`, {
        method: 'POST',
        org: true,
        body: { productIds: selected },
      }),
    onSuccess: () => {
      setSelected([]);
      refresh();
    },
  });
  const withdraw = useMutation({
    mutationFn: () => api(`/applications/${id}/withdraw`, { method: 'POST', org: true }),
    onSuccess: refresh,
  });
  const reply = useMutation({
    mutationFn: () =>
      api(`/applications/submissions/${replyTo!.id}/reply`, {
        method: 'POST',
        org: true,
        body: { note: replyNote.trim() },
      }),
    onSuccess: () => {
      setReplyTo(null);
      setReplyNote('');
      refresh();
    },
  });
  const decide = useMutation({
    mutationFn: ({ offer, decision }: { offer: Offer; decision: 'accept' | 'decline' }) =>
      api(`/applications/offers/${offer.id}/${decision}`, { method: 'POST', org: true }),
    onSuccess: () => {
      setConfirm(null);
      refresh();
    },
  });

  if (app.isLoading) return <Spinner />;
  if (app.isError || !app.data) return <Alert tone="danger">{errorMessage(app.error)}</Alert>;
  const a = app.data;
  const isOpen = a.status === 'DRAFT' || a.status === 'SUBMITTED';
  const attachedIds = new Set(a.documents.map((d) => d.document.id));
  const attachedTypes = new Set(a.documents.map((d) => d.document.typeCode));
  const sentTo = new Set(a.submissions.map((s) => s.institutionOrgId));
  const missing =
    submit.error instanceof ApiError
      ? ((submit.error.details as { missing?: string[] } | undefined)?.missing ?? [])
      : [];
  const requiredTypes = new Set([
    ...(vault.data?.checklist.application.map((c) => c.typeCode) ?? []),
    ...(matches.data
      ?.filter((m) => selected.includes(m.productId))
      .flatMap((m) => m.requiredDocumentTypes) ?? []),
  ]);
  const available = (vault.data?.documents ?? []).filter(
    (d) => !attachedIds.has(d.id) && d.scanStatus !== 'INFECTED' && d.scanStatus !== 'PENDING',
  );

  const remaining = (matches.data ?? []).filter((m) => !sentTo.has(m.institutionOrgId));
  const toggle = (m: ProductMatch) =>
    setSelected((cur) =>
      cur.includes(m.productId)
        ? cur.filter((x) => x !== m.productId)
        : [
            ...cur.filter(
              (x) =>
                matches.data?.find((y) => y.productId === x)?.institutionOrgId !==
                m.institutionOrgId,
            ),
            m.productId,
          ],
    );

  return (
    <>
      <PageHeader
        title={`${a.reference} · ${title(a.equipmentSnapshot.title)}`}
        subtitle={<ApplicationStatusBadge status={a.status} />}
        actions={
          <Link to="/app/financing" className="text-sm text-primary-600 hover:underline">
            {t('financing.backToList')}
          </Link>
        }
      />
      {a.status === 'OFFER_ACCEPTED' && (
        <Alert tone="success" title={t('financing.acceptedTitle')}>
          {t('financing.acceptedBody')}
        </Alert>
      )}
      {(attach.isError || detach.isError || withdraw.isError || decide.isError) && (
        <Alert tone="danger">
          {errorMessage(attach.error ?? detach.error ?? withdraw.error ?? decide.error)}
        </Alert>
      )}

      <div className="mt-4 grid gap-6 xl:grid-cols-[1fr_380px]">
        <div className="space-y-6">
          <OffersComparison
            offers={a.offers}
            submissions={a.submissions}
            open={a.status === 'SUBMITTED'}
            deciding={decide.isPending}
            onDecide={(offer, decision) => setConfirm({ offer, decision })}
          />

          {a.submissions.length > 0 && (
            <Card title={t('financing.institutions')}>
              <div className="space-y-5">
                {a.submissions.map((s) => (
                  <div key={s.id} className="rounded-lg border border-gray-200 p-4">
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="font-semibold">{s.institutionName}</p>
                        {s.product && (
                          <p className="text-xs text-gray-500">
                            {localized(s.product.name)} ·{' '}
                            {t(`productType.${s.product.productType}`)}
                          </p>
                        )}
                      </div>
                      <SubmissionStatusBadge status={s.status} />
                    </div>
                    {s.status === 'DECLINED' && s.declineReason && (
                      <Alert tone="neutral">
                        {t('financing.declinedReason', { reason: s.declineReason })}
                      </Alert>
                    )}
                    {s.status === 'INFO_REQUESTED' && (
                      <Alert
                        tone="action"
                        title={t('financing.infoRequestedTitle')}
                        action={
                          <Button onClick={() => setReplyTo(s)}>{t('financing.reply')}</Button>
                        }
                      >
                        {[...s.events].reverse().find((e) => e.kind === 'INFO_REQUESTED')?.note}
                      </Alert>
                    )}
                    <Timeline events={s.events} ownOrg={activeOrg?.organizationId} />
                  </div>
                ))}
              </div>
            </Card>
          )}

          {isOpen && (a.status === 'DRAFT' || remaining.length > 0) && (
            <Card
              title={
                a.status === 'DRAFT' ? t('financing.matchesTitle') : t('financing.moreInstitutions')
              }
            >
              <p className="mb-3 text-xs text-gray-600">{t('financing.matchesDisclaimer')}</p>
              {matches.isLoading ? (
                <Spinner />
              ) : !remaining.length ? (
                <EmptyState>{t('financing.noProducts')}</EmptyState>
              ) : (
                <ul className="space-y-3">
                  {remaining.map((m) => {
                    return (
                      <li
                        key={m.productId}
                        className={`rounded-lg border p-4 ${selected.includes(m.productId) ? 'border-primary-600 bg-primary-50/40' : 'border-gray-200'}`}
                      >
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <label className="flex items-start gap-3">
                            <input
                              type="checkbox"
                              className="mt-1"
                              checked={selected.includes(m.productId)}
                              onChange={() => toggle(m)}
                            />
                            <span>
                              <span className="block font-semibold">{m.institutionName}</span>
                              <span className="block text-sm text-gray-600">
                                {localized(m.name)} · {t(`productType.${m.productType}`)}
                              </span>
                            </span>
                          </label>
                          <div className="text-end">
                            <div className="text-lg font-semibold text-primary-900">
                              {t('financing.fit', { score: m.score })}
                            </div>
                            <div className="text-xs text-gray-500">{t('financing.indicative')}</div>
                          </div>
                        </div>
                        <div className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
                          <p>
                            {t('financing.indicativeInstallment')}:{' '}
                            <Price value={m.installmentRange.min} onRequest={false} bare /> –{' '}
                            <Price value={m.installmentRange.max} onRequest={false} bare />
                            <span className="text-gray-500">
                              {' '}
                              (
                              {t('financing.rateRange', {
                                min: Number(m.indicativeRateMin),
                                max: Number(m.indicativeRateMax),
                              })}
                              )
                            </span>
                          </p>
                          <p className="flex flex-wrap gap-x-3 gap-y-1">
                            {m.checks.map((c) => (
                              <span
                                key={c.criterion}
                                className={c.met ? 'text-success-600' : 'text-danger-600'}
                              >
                                {c.met ? '✓' : '✗'} {t(`criteria.${c.criterion}`)}
                              </span>
                            ))}
                          </p>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
              {submit.isError && (
                <Alert tone="danger">
                  {errorMessage(submit.error)}
                  {missing.length > 0 && ` ${missing.map(typeName).join(', ')}`}
                </Alert>
              )}
              <div className="mt-4 flex flex-wrap items-center justify-end gap-3">
                {activeOrg?.status !== 'VERIFIED' && (
                  <span className="text-xs text-warning-600">{t('financing.verifiedOnly')}</span>
                )}
                <Button
                  onClick={() => submit.mutate()}
                  loading={submit.isPending}
                  disabled={!selected.length || activeOrg?.status !== 'VERIFIED'}
                >
                  {t('financing.submit', { count: selected.length })}
                </Button>
              </div>
            </Card>
          )}
        </div>

        <div className="space-y-6">
          <Card
            title={t('financing.summary')}
            actions={
              a.status === 'DRAFT' ? (
                <Button variant="ghost" onClick={() => setEditing(true)}>
                  {t('common.edit')}
                </Button>
              ) : undefined
            }
          >
            <dl className="space-y-2 text-sm">
              {(
                [
                  [
                    t('financing.equipmentAmount'),
                    <Price key="e" value={a.equipmentAmount} onRequest={false} bare />,
                  ],
                  [
                    t('offers.downPayment'),
                    <Price key="d" value={a.downPayment} onRequest={false} bare />,
                  ],
                  [
                    t('financing.financedAmount'),
                    <Price
                      key="f"
                      value={a.financedAmount}
                      onRequest={false}
                      bare
                      className="font-semibold"
                    />,
                  ],
                  [t('offers.duration'), t('financing.months', { count: a.durationMonths })],
                  [
                    t('financing.preferredType'),
                    a.preferredType
                      ? t(`productType.${a.preferredType}`)
                      : t('financing.noPreference'),
                  ],
                  [t('financing.quotation'), a.equipmentSnapshot.quotationReference],
                  [t('market.supplier'), a.equipmentSnapshot.supplierName ?? '—'],
                ] as Array<[string, React.ReactNode]>
              ).map(([k, v]) => (
                <div key={k} className="flex justify-between gap-3">
                  <dt className="text-gray-500">{k}</dt>
                  <dd className="text-end">{v}</dd>
                </div>
              ))}
            </dl>
            {a.purpose && (
              <p
                className="mt-3 whitespace-pre-line rounded bg-gray-50 p-2 text-xs text-gray-700"
                dir="auto"
              >
                {a.purpose}
              </p>
            )}
          </Card>

          <Card title={t('financing.attachments')}>
            <p className="mb-3 text-xs text-gray-600">{t('financing.attachmentsHint')}</p>
            <ul className="space-y-2 text-sm">
              {[...requiredTypes].map((code) => {
                const doc = a.documents.find((d) => d.document.typeCode === code)?.document;
                return (
                  <li key={code} className="flex items-center justify-between gap-2">
                    <span>
                      {typeName(code)} <span className="text-xs text-danger-600">*</span>
                    </span>
                    {doc ? (
                      <DocStateBadge
                        state={
                          doc.expiresOn && new Date(doc.expiresOn) < new Date()
                            ? 'EXPIRED'
                            : doc.reviewStatus
                        }
                      />
                    ) : (
                      <DocStateBadge state="MISSING" />
                    )}
                  </li>
                );
              })}
            </ul>
            <ul className="mt-4 divide-y divide-gray-100 border-t border-gray-100 text-sm">
              {a.documents.map(({ document: d }) => (
                <li key={d.id} className="flex items-center justify-between gap-2 py-2">
                  <button
                    className="truncate text-start text-primary-600 hover:underline"
                    onClick={() => void downloadFile(`/documents/${d.id}/file`, d.fileName)}
                    dir="auto"
                  >
                    {d.title}
                  </button>
                  {a.status === 'DRAFT' && (
                    <button
                      className="text-xs text-danger-600 hover:underline"
                      onClick={() => detach.mutate(d.id)}
                    >
                      {t('common.remove')}
                    </button>
                  )}
                </li>
              ))}
            </ul>
            {isOpen && (
              <div className="mt-4 space-y-2">
                {available.length > 0 && (
                  <SelectInput
                    label={t('financing.attachFromVault')}
                    value=""
                    onChange={(e) => e.target.value && attach.mutate([e.target.value])}
                    options={[
                      { value: '', label: t('financing.chooseDocument') },
                      ...available.map((d) => ({
                        value: d.id,
                        label: `${typeName(d.typeCode)} — ${d.title}`,
                      })),
                    ]}
                  />
                )}
                <SelectInput
                  label={t('financing.uploadNew')}
                  value=""
                  onChange={(e) => e.target.value && setUploadType(e.target.value)}
                  options={[
                    { value: '', label: t('documents.chooseType') },
                    ...(vault.data?.types ?? []).map((x) => ({
                      value: x.code,
                      label: `${localized(x.name)}${attachedTypes.has(x.code) ? ' ✓' : ''}`,
                    })),
                  ]}
                />
              </div>
            )}
          </Card>

          {isOpen && (
            <Button
              variant="ghost"
              className="w-full"
              loading={withdraw.isPending}
              onClick={() => window.confirm(t('financing.withdrawConfirm')) && withdraw.mutate()}
            >
              {t('financing.withdraw')}
            </Button>
          )}
        </div>
      </div>

      {vault.data && (
        <UploadModal
          open={!!uploadType}
          onClose={() => setUploadType(null)}
          types={vault.data.types}
          defaultType={uploadType ?? undefined}
          onUploaded={(docId) => attach.mutate([docId])}
        />
      )}
      {editing && (
        <EditApplicationModal app={a} onClose={() => setEditing(false)} onSaved={refresh} />
      )}

      <Modal
        open={!!replyTo}
        title={t('financing.replyTitle', { institution: replyTo?.institutionName ?? '' })}
        onClose={() => setReplyTo(null)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setReplyTo(null)}>
              {t('common.cancel')}
            </Button>
            <Button
              loading={reply.isPending}
              disabled={replyNote.trim().length < 3}
              onClick={() => reply.mutate()}
            >
              {t('financing.sendReply')}
            </Button>
          </>
        }
      >
        {reply.isError && <Alert tone="danger">{errorMessage(reply.error)}</Alert>}
        <p className="mb-3 text-xs text-gray-600">{t('financing.replyHint')}</p>
        <textarea
          value={replyNote}
          onChange={(e) => setReplyNote(e.target.value)}
          rows={5}
          maxLength={2000}
          className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
          dir="auto"
        />
      </Modal>

      <Modal
        open={!!confirm}
        title={confirm?.decision === 'accept' ? t('offers.acceptTitle') : t('offers.declineTitle')}
        onClose={() => setConfirm(null)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirm(null)}>
              {t('common.cancel')}
            </Button>
            <Button
              variant={confirm?.decision === 'accept' ? 'accent' : 'danger'}
              loading={decide.isPending}
              onClick={() => confirm && decide.mutate(confirm)}
            >
              {t('common.confirm')}
            </Button>
          </>
        }
      >
        <p className="text-sm text-gray-700">
          {confirm?.decision === 'accept' ? t('offers.acceptBody') : t('offers.declineBody')}
        </p>
      </Modal>
    </>
  );
}

function EditApplicationModal({
  app,
  onClose,
  onSaved,
}: {
  app: ApplicationDetail;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const errorMessage = useErrorMessage();
  const [downPayment, setDownPayment] = useState(String(Number(app.downPayment)));
  const [duration, setDuration] = useState(String(app.durationMonths));
  const [preferredType, setPreferredType] = useState(app.preferredType ?? '');
  const [purpose, setPurpose] = useState(app.purpose ?? '');
  const [profile, setProfile] = useState<CompanyProfile>(app.companyProfile ?? {});
  const save = useMutation({
    mutationFn: () =>
      api(`/applications/${app.id}`, {
        method: 'PUT',
        org: true,
        body: {
          downPayment: downPayment || '0',
          durationMonths: Number(duration),
          preferredType: preferredType || undefined,
          purpose: purpose.trim() || undefined,
          companyProfile: profile,
        },
      }),
    onSuccess: () => {
      onSaved();
      onClose();
    },
  });
  return (
    <Modal
      open
      title={t('financing.editTitle')}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button loading={save.isPending} onClick={() => save.mutate()}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {save.isError && <Alert tone="danger">{errorMessage(save.error)}</Alert>}
        <div className="grid gap-4 sm:grid-cols-3">
          <TextInput
            label={t('financing.downPayment')}
            value={downPayment}
            onChange={(e) => setDownPayment(e.target.value.replace(/[^\d.]/g, ''))}
            inputMode="decimal"
            dir="ltr"
          />
          <TextInput
            label={t('financing.durationMonths')}
            type="number"
            min={1}
            max={240}
            value={duration}
            onChange={(e) => setDuration(e.target.value)}
            dir="ltr"
          />
          <SelectInput
            label={t('financing.preferredType')}
            value={preferredType}
            onChange={(e) => setPreferredType(e.target.value)}
            options={typeOptions(t)}
          />
        </div>
        <label className="block space-y-1">
          <span className="block text-sm font-semibold text-gray-800">
            {t('financing.purpose')}
          </span>
          <textarea
            value={purpose}
            onChange={(e) => setPurpose(e.target.value)}
            rows={3}
            maxLength={2000}
            className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            dir="auto"
          />
        </label>
        <ProfileFields profile={profile} onChange={setProfile} />
      </div>
    </Modal>
  );
}
