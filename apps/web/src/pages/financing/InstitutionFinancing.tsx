import { computeInstallment, computeTotalCost } from '@tasheel/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams, useSearchParams } from 'react-router';
import { Price, useListingTitle } from '../../components/marketplace';
import {
  Alert,
  Badge,
  Button,
  Card,
  Checkbox,
  EmptyState,
  Modal,
  PageHeader,
  SelectInput,
  Spinner,
  Table,
  Td,
  TextInput,
} from '../../components/ui';
import { api, downloadFile } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { formatDate, useErrorMessage, useLocalizedName } from '../../lib/format';
import type {
  Category,
  DocumentType,
  FinancingProduct,
  InboxRow,
  ProductType,
  ReviewDetail,
} from '../../lib/types';
import { ScanBadge, sizeLabel } from '../app/DocumentsPage';
import { OfferStatusBadge, SubmissionStatusBadge, Timeline } from './common';

// ---------------------------------------------------------------------------- Products

interface ProductForm {
  nameFr: string;
  nameAr: string;
  productType: ProductType;
  minAmount: string;
  maxAmount: string;
  minDurationMonths: string;
  maxDurationMonths: string;
  minDownPaymentPct: string;
  categoryCodes: string[];
  wilayaCodes: string;
  minYearsInBusiness: string;
  indicativeRateMin: string;
  indicativeRateMax: string;
  requiredDocumentTypes: string[];
  isActive: boolean;
}

const EMPTY_PRODUCT: ProductForm = {
  nameFr: '',
  nameAr: '',
  productType: 'LEASING',
  minAmount: '',
  maxAmount: '',
  minDurationMonths: '12',
  maxDurationMonths: '60',
  minDownPaymentPct: '0',
  categoryCodes: [],
  wilayaCodes: '',
  minYearsInBusiness: '0',
  indicativeRateMin: '',
  indicativeRateMax: '',
  requiredDocumentTypes: [],
  isActive: true,
};

const toForm = (p: FinancingProduct): ProductForm => ({
  nameFr: p.name.fr ?? '',
  nameAr: p.name.ar ?? '',
  productType: p.productType,
  minAmount: String(Number(p.minAmount)),
  maxAmount: String(Number(p.maxAmount)),
  minDurationMonths: String(p.minDurationMonths),
  maxDurationMonths: String(p.maxDurationMonths),
  minDownPaymentPct: String(Number(p.minDownPaymentPct)),
  categoryCodes: p.categoryCodes,
  wilayaCodes: p.wilayaCodes.join(', '),
  minYearsInBusiness: String(p.minYearsInBusiness),
  indicativeRateMin: String(Number(p.indicativeRateMin)),
  indicativeRateMax: String(Number(p.indicativeRateMax)),
  requiredDocumentTypes: p.requiredDocumentTypes,
  isActive: p.isActive,
});

const decimal = (v: string) => v.replace(/[^\d.]/g, '');

function ProductModal({
  product,
  onClose,
}: {
  product: FinancingProduct | 'new';
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const localized = useLocalizedName();
  const errorMessage = useErrorMessage();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<ProductForm>(
    product === 'new' ? EMPTY_PRODUCT : toForm(product),
  );
  const set = <K extends keyof ProductForm>(k: K, v: ProductForm[K]) =>
    setForm((f) => ({ ...f, [k]: v }));
  const categories = useQuery({
    queryKey: ['categories'],
    queryFn: () => api<Category[]>('/marketplace/categories'),
    staleTime: 300_000,
  });
  const types = useQuery({
    queryKey: ['business-doc-types'],
    queryFn: () => api<DocumentType[]>('/institution/products/document-types', { org: true }),
  });
  const toggle = (k: 'categoryCodes' | 'requiredDocumentTypes', code: string) =>
    set(k, form[k].includes(code) ? form[k].filter((c) => c !== code) : [...form[k], code]);

  const save = useMutation({
    mutationFn: () => {
      const body = {
        name: { fr: form.nameFr.trim() || undefined, ar: form.nameAr.trim() || undefined },
        productType: form.productType,
        minAmount: form.minAmount,
        maxAmount: form.maxAmount,
        minDurationMonths: Number(form.minDurationMonths),
        maxDurationMonths: Number(form.maxDurationMonths),
        minDownPaymentPct: form.minDownPaymentPct || '0',
        categoryCodes: form.categoryCodes,
        wilayaCodes: form.wilayaCodes.split(/[,\s]+/).filter((w) => /^\d{2}$/.test(w)),
        minYearsInBusiness: Number(form.minYearsInBusiness || 0),
        indicativeRateMin: form.indicativeRateMin,
        indicativeRateMax: form.indicativeRateMax,
        requiredDocumentTypes: form.requiredDocumentTypes,
        isActive: form.isActive,
      };
      return product === 'new'
        ? api('/institution/products', { method: 'POST', org: true, body })
        : api(`/institution/products/${product.id}`, { method: 'PUT', org: true, body });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['products'] });
      onClose();
    },
  });
  function submit(e: FormEvent) {
    e.preventDefault();
    save.mutate();
  }
  // Business document types (what the institution may require from applicants).
  const docTypes = types.data ?? [];

  return (
    <Modal
      open
      title={product === 'new' ? t('products.newTitle') : t('products.editTitle')}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" form="product-form" loading={save.isPending}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <form
        id="product-form"
        onSubmit={submit}
        className="max-h-[65vh] space-y-4 overflow-y-auto pe-1"
      >
        {save.isError && <Alert tone="danger">{errorMessage(save.error)}</Alert>}
        <div className="grid gap-4 sm:grid-cols-2">
          <TextInput
            label={t('products.nameFr')}
            value={form.nameFr}
            onChange={(e) => set('nameFr', e.target.value)}
            maxLength={150}
          />
          <TextInput
            label={t('products.nameAr')}
            value={form.nameAr}
            onChange={(e) => set('nameAr', e.target.value)}
            maxLength={150}
            dir="rtl"
          />
          <SelectInput
            label={t('products.type')}
            value={form.productType}
            onChange={(e) => set('productType', e.target.value as ProductType)}
            options={(['LEASING', 'IJARA'] as const).map((x) => ({
              value: x,
              label: t(`productType.${x}`),
            }))}
          />
          <TextInput
            label={t('products.minYears')}
            type="number"
            min={0}
            max={100}
            value={form.minYearsInBusiness}
            onChange={(e) => set('minYearsInBusiness', e.target.value)}
            dir="ltr"
          />
          <TextInput
            label={t('products.minAmount')}
            value={form.minAmount}
            onChange={(e) => set('minAmount', decimal(e.target.value))}
            required
            inputMode="decimal"
            dir="ltr"
          />
          <TextInput
            label={t('products.maxAmount')}
            value={form.maxAmount}
            onChange={(e) => set('maxAmount', decimal(e.target.value))}
            required
            inputMode="decimal"
            dir="ltr"
          />
          <TextInput
            label={t('products.minDuration')}
            type="number"
            min={1}
            max={240}
            value={form.minDurationMonths}
            onChange={(e) => set('minDurationMonths', e.target.value)}
            required
            dir="ltr"
          />
          <TextInput
            label={t('products.maxDuration')}
            type="number"
            min={1}
            max={240}
            value={form.maxDurationMonths}
            onChange={(e) => set('maxDurationMonths', e.target.value)}
            required
            dir="ltr"
          />
          <TextInput
            label={t('products.minDownPayment')}
            value={form.minDownPaymentPct}
            onChange={(e) => set('minDownPaymentPct', decimal(e.target.value))}
            inputMode="decimal"
            dir="ltr"
          />
          <TextInput
            label={t('products.wilayas')}
            hint={t('products.wilayasHint')}
            value={form.wilayaCodes}
            onChange={(e) => set('wilayaCodes', e.target.value)}
            dir="ltr"
          />
          <TextInput
            label={t('products.rateMin')}
            value={form.indicativeRateMin}
            onChange={(e) => set('indicativeRateMin', decimal(e.target.value))}
            required
            inputMode="decimal"
            dir="ltr"
          />
          <TextInput
            label={t('products.rateMax')}
            value={form.indicativeRateMax}
            onChange={(e) => set('indicativeRateMax', decimal(e.target.value))}
            required
            inputMode="decimal"
            dir="ltr"
          />
        </div>
        <p className="text-xs text-gray-500">{t('products.rateHint')}</p>
        <fieldset>
          <legend className="mb-2 text-sm font-semibold text-gray-800">
            {t('products.categories')}
          </legend>
          <p className="mb-2 text-xs text-gray-500">{t('products.categoriesHint')}</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {(categories.data ?? []).map((c) => (
              <Checkbox
                key={c.code}
                label={localized(c.name)}
                checked={form.categoryCodes.includes(c.code)}
                onChange={() => toggle('categoryCodes', c.code)}
              />
            ))}
          </div>
        </fieldset>
        {docTypes.length > 0 && (
          <fieldset>
            <legend className="mb-2 text-sm font-semibold text-gray-800">
              {t('products.requiredDocuments')}
            </legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {docTypes.map((d) => (
                <Checkbox
                  key={d.code}
                  label={localized(d.name)}
                  checked={form.requiredDocumentTypes.includes(d.code)}
                  onChange={() => toggle('requiredDocumentTypes', d.code)}
                />
              ))}
            </div>
          </fieldset>
        )}
        <Checkbox
          label={t('products.active')}
          checked={form.isActive}
          onChange={(e) => set('isActive', e.target.checked)}
        />
      </form>
    </Modal>
  );
}

export function ProductsPage() {
  const { t } = useTranslation();
  const { activeOrg } = useAuth();
  const localized = useLocalizedName();
  const errorMessage = useErrorMessage();
  const [editing, setEditing] = useState<FinancingProduct | 'new' | null>(null);
  const products = useQuery({
    queryKey: ['products', activeOrg?.organizationId],
    queryFn: () => api<FinancingProduct[]>('/institution/products', { org: true }),
  });
  return (
    <>
      <PageHeader
        title={t('products.title')}
        subtitle={t('products.subtitle')}
        actions={<Button onClick={() => setEditing('new')}>{t('products.new')}</Button>}
      />
      {products.isLoading ? (
        <Spinner />
      ) : products.isError ? (
        <Alert tone="danger">{errorMessage(products.error)}</Alert>
      ) : !products.data?.length ? (
        <EmptyState>{t('products.empty')}</EmptyState>
      ) : (
        <Table
          head={[
            t('products.colName'),
            t('products.colAmounts'),
            t('products.colDuration'),
            t('products.colRates'),
            t('products.colActivity'),
            '',
          ]}
        >
          {products.data.map((p) => (
            <tr key={p.id}>
              <Td>
                <span className="font-semibold">{localized(p.name)}</span>
                <div className="flex gap-1 text-xs text-gray-500">
                  {t(`productType.${p.productType}`)}{' '}
                  {!p.isActive && <Badge tone="neutral">{t('products.inactive')}</Badge>}
                </div>
              </Td>
              <Td>
                <Price value={p.minAmount} onRequest={false} bare /> –{' '}
                <Price value={p.maxAmount} onRequest={false} bare />
              </Td>
              <Td>
                {t('products.durationRange', {
                  min: p.minDurationMonths,
                  max: p.maxDurationMonths,
                })}
              </Td>
              <Td>
                {t('financing.rateRange', {
                  min: Number(p.indicativeRateMin),
                  max: Number(p.indicativeRateMax),
                })}
              </Td>
              <Td className="text-xs text-gray-600">
                {t('products.activity', {
                  submissions: p._count?.submissions ?? 0,
                  offers: p._count?.offers ?? 0,
                })}
              </Td>
              <Td>
                <Button variant="ghost" onClick={() => setEditing(p)}>
                  {t('common.edit')}
                </Button>
              </Td>
            </tr>
          ))}
        </Table>
      )}
      {editing && <ProductModal product={editing} onClose={() => setEditing(null)} />}
    </>
  );
}

// ---------------------------------------------------------------------------- Inbox

const FILTERS = [
  '',
  'SENT',
  'UNDER_REVIEW',
  'INFO_REQUESTED',
  'OFFER_MADE',
  'DECLINED',
  'CLOSED',
] as const;

export function InboxPage() {
  const { t } = useTranslation();
  const { activeOrg } = useAuth();
  const title = useListingTitle();
  const errorMessage = useErrorMessage();
  const [params, setParams] = useSearchParams();
  const status = params.get('status') ?? '';
  const rows = useQuery({
    queryKey: ['inbox', activeOrg?.organizationId, status],
    queryFn: () => api<InboxRow[]>('/institution/applications', { org: true, query: { status } }),
  });
  return (
    <>
      <PageHeader title={t('inbox.title')} subtitle={t('inbox.subtitle')} />
      <div className="mb-4 flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button
            key={f || 'all'}
            onClick={() => setParams(f ? { status: f } : {})}
            className={`rounded-full border px-3 py-1 text-sm ${status === f ? 'border-primary-600 bg-primary-50 font-semibold text-primary-600' : 'border-gray-300 bg-white'}`}
          >
            {f ? t(`submissionStatus.${f}`) : t('common.all')}
          </button>
        ))}
      </div>
      {rows.isLoading ? (
        <Spinner />
      ) : rows.isError ? (
        <Alert tone="danger">{errorMessage(rows.error)}</Alert>
      ) : !rows.data?.length ? (
        <EmptyState>{t('inbox.empty')}</EmptyState>
      ) : (
        <Table
          head={[
            t('financing.colReference'),
            t('inbox.colBusiness'),
            t('financing.colEquipment'),
            t('financing.colFinanced'),
            t('financing.colDuration'),
            t('inbox.colFit'),
            t('financing.colStatus'),
          ]}
        >
          {rows.data.map((r) => (
            <tr key={r.id} className="hover:bg-gray-50">
              <Td>
                <Link
                  to={`/app/financing/inbox/${r.id}`}
                  className="font-semibold text-primary-600 hover:underline"
                >
                  {r.application.reference}
                </Link>
                <div className="text-xs text-gray-500">{formatDate(r.createdAt)}</div>
              </Td>
              <Td>{r.application.businessSnapshot.legalName}</Td>
              <Td>{title(r.application.equipmentSnapshot.title)}</Td>
              <Td>
                <Price value={r.application.financedAmount} onRequest={false} bare />
              </Td>
              <Td>{t('financing.months', { count: r.application.durationMonths })}</Td>
              <Td className="text-xs">
                {r.matchScore !== null ? t('financing.fit', { score: r.matchScore }) : '—'}
              </Td>
              <Td>
                <SubmissionStatusBadge status={r.status} />
              </Td>
            </tr>
          ))}
        </Table>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------- Review

function OfferModal({ detail, onClose }: { detail: ReviewDetail; onClose: () => void }) {
  const { t } = useTranslation();
  const errorMessage = useErrorMessage();
  const queryClient = useQueryClient();
  const a = detail.application;
  const [financed, setFinanced] = useState(String(Number(a.financedAmount)));
  const [down, setDown] = useState(String(Number(a.downPayment)));
  const [duration, setDuration] = useState(String(a.durationMonths));
  const [rate, setRate] = useState('');
  const [residual, setResidual] = useState('0');
  const [fees, setFees] = useState('0');
  const [validUntil, setValidUntil] = useState('');
  const [conditions, setConditions] = useState('');

  let preview: { installment: string; totalCost: string } | null = null;
  try {
    if (rate && financed) {
      const s = computeInstallment({
        financedAmount: financed,
        ratePct: rate,
        durationMonths: Number(duration),
        residualValue: residual || '0',
      });
      preview = {
        installment: s.installment,
        totalCost: computeTotalCost({
          downPayment: down || '0',
          totalInstallments: s.totalInstallments,
          fees: fees || '0',
          residualValue: residual || '0',
        }),
      };
    }
  } catch {
    preview = null;
  }

  const issue = useMutation({
    mutationFn: () =>
      api(`/institution/applications/${detail.id}/offers`, {
        method: 'POST',
        org: true,
        body: {
          productId: detail.product?.id,
          financedAmount: financed,
          downPayment: down || '0',
          durationMonths: Number(duration),
          ratePct: rate,
          residualValue: residual || '0',
          feesAmount: fees || '0',
          validUntil,
          conditions: conditions.trim() || undefined,
        },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['review', detail.id] });
      void queryClient.invalidateQueries({ queryKey: ['inbox'] });
      onClose();
    },
  });
  function submit(e: FormEvent) {
    e.preventDefault();
    issue.mutate();
  }

  return (
    <Modal
      open
      title={t('review.offerTitle', { reference: a.reference })}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            type="submit"
            form="offer-form"
            loading={issue.isPending}
            disabled={!preview || !validUntil}
          >
            {t('review.sendOffer')}
          </Button>
        </>
      }
    >
      <form id="offer-form" onSubmit={submit} className="space-y-4">
        {issue.isError && <Alert tone="danger">{errorMessage(issue.error)}</Alert>}
        <div className="grid gap-4 sm:grid-cols-2">
          <TextInput
            label={t('offers.financed')}
            value={financed}
            onChange={(e) => setFinanced(decimal(e.target.value))}
            required
            inputMode="decimal"
            dir="ltr"
          />
          <TextInput
            label={t('offers.downPayment')}
            value={down}
            onChange={(e) => setDown(decimal(e.target.value))}
            inputMode="decimal"
            dir="ltr"
          />
          <TextInput
            label={t('offers.durationMonths')}
            type="number"
            min={1}
            max={240}
            value={duration}
            onChange={(e) => setDuration(e.target.value)}
            required
            dir="ltr"
          />
          <TextInput
            label={t('review.rate')}
            hint={t('review.rateHint')}
            value={rate}
            onChange={(e) => setRate(decimal(e.target.value))}
            required
            inputMode="decimal"
            dir="ltr"
          />
          <TextInput
            label={t('offers.residual')}
            hint={t('review.residualHint')}
            value={residual}
            onChange={(e) => setResidual(decimal(e.target.value))}
            inputMode="decimal"
            dir="ltr"
          />
          <TextInput
            label={t('offers.fees')}
            value={fees}
            onChange={(e) => setFees(decimal(e.target.value))}
            inputMode="decimal"
            dir="ltr"
          />
          <TextInput
            label={t('offers.validUntil')}
            type="date"
            min={new Date().toISOString().slice(0, 10)}
            value={validUntil}
            onChange={(e) => setValidUntil(e.target.value)}
            required
            dir="ltr"
          />
        </div>
        <label className="block space-y-1">
          <span className="block text-sm font-semibold text-gray-800">
            {t('offers.conditions')}
          </span>
          <textarea
            value={conditions}
            onChange={(e) => setConditions(e.target.value)}
            rows={3}
            maxLength={3000}
            className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            dir="auto"
          />
        </label>
        {preview && (
          <dl className="space-y-1 rounded-lg bg-gray-50 p-3 text-sm">
            <div className="flex justify-between">
              <dt>{t('offers.installment')}</dt>
              <dd className="font-semibold">
                <Price value={preview.installment} onRequest={false} bare />
              </dd>
            </div>
            <div className="flex justify-between">
              <dt>{t('offers.totalCost')}</dt>
              <dd>
                <Price value={preview.totalCost} onRequest={false} bare />
              </dd>
            </div>
          </dl>
        )}
        <p className="text-xs text-gray-500">{t('review.offerNotice')}</p>
      </form>
    </Modal>
  );
}

export function ReviewPage() {
  const { t } = useTranslation();
  const { id = '' } = useParams();
  const { activeOrg } = useAuth();
  const queryClient = useQueryClient();
  const title = useListingTitle();
  const errorMessage = useErrorMessage();
  const [action, setAction] = useState<'info' | 'decline' | 'offer' | null>(null);
  const [text, setText] = useState('');
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const detail = useQuery({
    queryKey: ['review', id],
    queryFn: () => api<ReviewDetail>(`/institution/applications/${id}`, { org: true }),
  });
  const profile = useQuery({
    queryKey: ['org-permissions', activeOrg?.organizationId],
    queryFn: () => api<{ permissions?: string[] }>('/organizations/current', { org: true }),
  });
  const canOffer = profile.data?.permissions?.includes('offer.issue') ?? false;

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['review', id] });
    void queryClient.invalidateQueries({ queryKey: ['inbox'] });
  };
  const act = useMutation({
    mutationFn: () =>
      action === 'info'
        ? api(`/institution/applications/${id}/request-info`, {
            method: 'POST',
            org: true,
            body: { note: text.trim() },
          })
        : api(`/institution/applications/${id}/decline`, {
            method: 'POST',
            org: true,
            body: { reason: text.trim() },
          }),
    onSuccess: () => {
      setAction(null);
      setText('');
      refresh();
    },
  });
  const withdraw = useMutation({
    mutationFn: (offerId: string) =>
      api(`/institution/applications/offers/${offerId}/withdraw`, { method: 'POST', org: true }),
    onSuccess: refresh,
  });

  if (detail.isLoading) return <Spinner />;
  if (detail.isError || !detail.data)
    return <Alert tone="danger">{errorMessage(detail.error)}</Alert>;
  const d = detail.data;
  const a = d.application;
  const b = a.businessSnapshot;
  const open =
    ['SENT', 'UNDER_REVIEW', 'INFO_REQUESTED', 'OFFER_MADE'].includes(d.status) &&
    a.status === 'SUBMITTED';

  return (
    <>
      <PageHeader
        title={`${a.reference} · ${b.legalName ?? ''}`}
        subtitle={<SubmissionStatusBadge status={d.status} />}
        actions={
          <Link to="/app/financing/inbox" className="text-sm text-primary-600 hover:underline">
            {t('inbox.back')}
          </Link>
        }
      />
      {a.status === 'OFFER_ACCEPTED' && d.offers.some((o) => o.status === 'ACCEPTED') && (
        <Alert tone="success" title={t('review.acceptedTitle')}>
          {t('review.acceptedBody')}
        </Alert>
      )}
      {(withdraw.isError || downloadError) && (
        <Alert tone="danger">{downloadError ?? errorMessage(withdraw.error)}</Alert>
      )}
      <p className="mb-4 text-xs text-gray-500">{t('review.notice')}</p>

      <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
        <div className="space-y-6">
          <Card title={t('review.request')}>
            <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
              {(
                [
                  [t('financing.colEquipment'), title(a.equipmentSnapshot.title)],
                  [
                    t('market.brandModel'),
                    [a.equipmentSnapshot.brand, a.equipmentSnapshot.model, a.equipmentSnapshot.year]
                      .filter(Boolean)
                      .join(' · ') || '—',
                  ],
                  [t('market.supplier'), a.equipmentSnapshot.supplierName ?? '—'],
                  [t('financing.quotation'), a.equipmentSnapshot.quotationReference],
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
                  [
                    t('review.product'),
                    d.product ? `${d.product.name.fr ?? d.product.name.ar ?? ''}` : '—',
                  ],
                ] as Array<[string, React.ReactNode]>
              ).map(([k, v]) => (
                <div key={k} className="flex justify-between gap-3 border-b border-gray-100 py-1">
                  <dt className="text-gray-500">{k}</dt>
                  <dd className="text-end">{v}</dd>
                </div>
              ))}
            </dl>
            {a.purpose && (
              <p
                className="mt-3 whitespace-pre-line rounded bg-gray-50 p-2 text-sm text-gray-700"
                dir="auto"
              >
                {a.purpose}
              </p>
            )}
          </Card>

          <Card title={t('review.documents')}>
            {!a.documents.length ? (
              <EmptyState>{t('review.noDocuments')}</EmptyState>
            ) : (
              <ul className="divide-y divide-gray-100 text-sm">
                {a.documents.map(({ document: doc }) => (
                  <li
                    key={doc.id}
                    className="flex flex-wrap items-center justify-between gap-3 py-2"
                  >
                    <div>
                      <p className="font-semibold" dir="auto">
                        {doc.title}
                      </p>
                      <p className="text-xs text-gray-500">
                        {sizeLabel(doc.sizeBytes)} · {formatDate(doc.createdAt)}
                        {doc.expiresOn
                          ? ` · ${t('documents.expires', { date: formatDate(doc.expiresOn) })}`
                          : ''}
                      </p>
                      <ScanBadge status={doc.scanStatus} />
                    </div>
                    <button
                      className="text-primary-600 hover:underline"
                      onClick={() =>
                        downloadFile(`/documents/${doc.id}/file`, doc.fileName).catch(() =>
                          setDownloadError(t('documents.downloadFailed')),
                        )
                      }
                    >
                      {t('documents.download')}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-3 text-xs text-gray-500">{t('review.downloadsAudited')}</p>
          </Card>

          {d.offers.length > 0 && (
            <Card title={t('review.yourOffers')}>
              <ul className="space-y-3 text-sm">
                {d.offers.map((o) => (
                  <li
                    key={o.id}
                    className="flex flex-wrap items-center justify-between gap-3 rounded border border-gray-200 p-3"
                  >
                    <div>
                      <p className="font-semibold">
                        {o.reference} · <Price value={o.installmentAmount} onRequest={false} bare />{' '}
                        × {o.durationMonths}
                      </p>
                      <p className="text-xs text-gray-500">
                        {Number(o.ratePct)} % · {t('offers.totalCost')}{' '}
                        <Price value={o.totalCost} onRequest={false} bare /> ·{' '}
                        {t('offers.validUntil')} {formatDate(o.validUntil)}
                      </p>
                    </div>
                    <span className="flex items-center gap-2">
                      <OfferStatusBadge status={o.status} />
                      {o.status === 'ISSUED' && canOffer && (
                        <Button
                          variant="ghost"
                          loading={withdraw.isPending}
                          onClick={() => withdraw.mutate(o.id)}
                        >
                          {t('review.withdrawOffer')}
                        </Button>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>

        <div className="space-y-6">
          <Card title={t('review.business')}>
            <dl className="space-y-2 text-sm">
              {(
                [
                  [t('fields.legalName'), b.legalName],
                  [t('fields.nif'), b.nif],
                  [t('fields.rcNumber'), b.rcNumber],
                  [t('fields.nis'), b.nis],
                  [t('fields.wilayaCode'), b.wilayaCode],
                  [t('financing.yearsInBusiness'), a.companyProfile.yearsInBusiness],
                  [t('financing.employees'), a.companyProfile.employees],
                  [
                    t('financing.annualRevenue'),
                    a.companyProfile.annualRevenue ? (
                      <Price
                        key="r"
                        value={a.companyProfile.annualRevenue}
                        onRequest={false}
                        bare
                      />
                    ) : null,
                  ],
                  [t('financing.sector'), a.companyProfile.sector],
                ] as Array<[string, React.ReactNode]>
              ).map(([k, v]) => (
                <div key={k} className="flex justify-between gap-3">
                  <dt className="text-gray-500">{k}</dt>
                  <dd className="text-end" dir="auto">
                    {v ?? '—'}
                  </dd>
                </div>
              ))}
            </dl>
            <p className="mt-3 text-xs text-gray-500">{t('review.declared')}</p>
          </Card>

          {open && (
            <Card title={t('review.actions')}>
              <div className="flex flex-col gap-2">
                {canOffer && (
                  <Button onClick={() => setAction('offer')}>
                    {d.offers.some((o) => o.status === 'ISSUED')
                      ? t('review.replaceOffer')
                      : t('review.makeOffer')}
                  </Button>
                )}
                {!canOffer && <p className="text-xs text-gray-500">{t('review.offerAdminOnly')}</p>}
                {['SENT', 'UNDER_REVIEW'].includes(d.status) && (
                  <Button variant="secondary" onClick={() => setAction('info')}>
                    {t('review.requestInfo')}
                  </Button>
                )}
                <Button variant="ghost" onClick={() => setAction('decline')}>
                  {t('review.decline')}
                </Button>
              </div>
            </Card>
          )}

          <Card title={t('review.timeline')}>
            <Timeline events={d.events} ownOrg={activeOrg?.organizationId} />
          </Card>
        </div>
      </div>

      {action === 'offer' && <OfferModal detail={d} onClose={() => setAction(null)} />}
      <Modal
        open={action === 'info' || action === 'decline'}
        title={action === 'info' ? t('review.requestInfoTitle') : t('review.declineTitle')}
        onClose={() => setAction(null)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setAction(null)}>
              {t('common.cancel')}
            </Button>
            <Button
              variant={action === 'decline' ? 'danger' : 'primary'}
              loading={act.isPending}
              disabled={text.trim().length < 3}
              onClick={() => act.mutate()}
            >
              {t('common.confirm')}
            </Button>
          </>
        }
      >
        {act.isError && <Alert tone="danger">{errorMessage(act.error)}</Alert>}
        <p className="mb-3 text-xs text-gray-600">
          {action === 'info' ? t('review.requestInfoHint') : t('review.declineHint')}
        </p>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={5}
          maxLength={2000}
          className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
          dir="auto"
        />
      </Modal>
    </>
  );
}
