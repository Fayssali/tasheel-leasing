import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams, useSearchParams } from 'react-router';
import { MonthlyBars, Money, StatTile } from '../../components/charts';
import {
  Alert,
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
import { api } from '../../lib/api';
import { formatDate, useErrorMessage, useLocalizedName } from '../../lib/format';
import type {
  BillingSettings,
  Category,
  Commission,
  CommissionRule,
  Invoice,
} from '../../lib/types';
import {
  Amount,
  CommissionStatusBadge,
  InvoiceDocument,
  InvoiceStatusBadge,
} from '../billing/common';
import { useRuleSummary } from '../billing/PayerBilling';

const TABS = ['invoices', 'commissions', 'rules', 'settings'] as const;
const todayIso = () => new Date().toISOString().slice(0, 10);
const decimal = (v: string) => v.replace(/[^\d.]/g, '');

export function AdminBillingPage() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as (typeof TABS)[number]) ?? 'invoices';
  return (
    <>
      <PageHeader title={t('adminBilling.title')} subtitle={t('adminBilling.subtitle')} />
      <div className="mb-4 flex gap-2 border-b border-gray-200" role="tablist">
        {TABS.map((k) => (
          <button
            key={k}
            role="tab"
            aria-selected={tab === k}
            onClick={() => setParams({ tab: k })}
            className={`-mb-px border-b-2 px-3 py-2 text-sm ${tab === k ? 'border-primary-600 font-semibold text-primary-600' : 'border-transparent text-gray-600 hover:text-gray-900'}`}
          >
            {t(`adminBilling.tab.${k}`)}
          </button>
        ))}
      </div>
      {tab === 'invoices' && <InvoicesTab />}
      {tab === 'commissions' && <CommissionsTab />}
      {tab === 'rules' && <RulesTab />}
      {tab === 'settings' && <SettingsTab />}
    </>
  );
}

function InvoicesTab() {
  const { t } = useTranslation();
  const errorMessage = useErrorMessage();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState('');
  const [periodEnd, setPeriodEnd] = useState(todayIso());
  const [notice, setNotice] = useState<string | null>(null);
  const invoices = useQuery({
    queryKey: ['admin-invoices', status],
    queryFn: () => api<Invoice[]>('/admin/billing/invoices', { org: true, query: { status } }),
  });
  const generate = useMutation({
    mutationFn: () =>
      api<{ drafts: number }>('/admin/billing/invoices/generate', {
        method: 'POST',
        org: true,
        body: { periodEnd },
      }),
    onSuccess: (r) => {
      setNotice(t('adminBilling.draftsCreated', { count: r.drafts }));
      void queryClient.invalidateQueries({ queryKey: ['admin-invoices'] });
    },
  });
  return (
    <>
      <Card title={t('adminBilling.generateTitle')}>
        <div className="flex flex-wrap items-end gap-3">
          <TextInput
            label={t('adminBilling.periodEnd')}
            type="date"
            value={periodEnd}
            max={todayIso()}
            onChange={(e) => setPeriodEnd(e.target.value)}
            dir="ltr"
          />
          <Button loading={generate.isPending} onClick={() => generate.mutate()}>
            {t('adminBilling.generate')}
          </Button>
        </div>
        <p className="mt-2 text-xs text-gray-500">{t('adminBilling.generateHint')}</p>
        {notice && <Alert tone="success">{notice}</Alert>}
        {generate.isError && <Alert tone="danger">{errorMessage(generate.error)}</Alert>}
      </Card>
      <div className="my-4 flex flex-wrap gap-2">
        {['', 'DRAFT', 'ISSUED', 'PAID', 'CANCELLED'].map((s) => (
          <button
            key={s || 'all'}
            onClick={() => setStatus(s)}
            className={`rounded-full border px-3 py-1 text-sm ${status === s ? 'border-primary-600 bg-primary-50 font-semibold text-primary-600' : 'border-gray-300 bg-white'}`}
          >
            {s ? t(`invoiceStatus.${s}`) : t('common.all')}
          </button>
        ))}
      </div>
      {invoices.isLoading ? (
        <Spinner />
      ) : invoices.isError ? (
        <Alert tone="danger">{errorMessage(invoices.error)}</Alert>
      ) : !invoices.data?.length ? (
        <EmptyState>{t('adminBilling.noInvoices')}</EmptyState>
      ) : (
        <Table
          head={[
            t('invoice.number'),
            t('invoice.customer'),
            t('invoice.period'),
            t('invoice.total'),
            t('fields.status'),
          ]}
        >
          {invoices.data.map((i) => (
            <tr key={i.id} className="hover:bg-gray-50">
              <Td>
                <Link
                  to={`/admin/billing/invoices/${i.id}`}
                  className="font-mono font-semibold text-primary-600 hover:underline"
                  dir="ltr"
                >
                  {i.number ?? t('invoice.draft')}
                </Link>
                <div className="text-xs text-gray-500">
                  {i.kind === 'CREDIT_NOTE' ? t('invoice.creditNote') : t('invoice.invoice')}
                </div>
              </Td>
              <Td>{i.organizationName}</Td>
              <Td className="text-xs">
                {formatDate(i.periodStart)} – {formatDate(i.periodEnd)}
              </Td>
              <Td>
                <Amount value={i.total} />
              </Td>
              <Td>
                <InvoiceStatusBadge invoice={i} />
              </Td>
            </tr>
          ))}
        </Table>
      )}
    </>
  );
}

function CommissionsTab() {
  const { t } = useTranslation();
  const localized = useLocalizedName();
  const errorMessage = useErrorMessage();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const list = useQuery({
    queryKey: ['admin-commissions', status],
    queryFn: () =>
      api<Commission[]>('/admin/billing/commissions', { org: true, query: { status } }),
  });
  const accrue = useMutation({
    mutationFn: () =>
      api<{ accrued: number }>('/admin/billing/commissions/accrue-missing', {
        method: 'POST',
        org: true,
      }),
    onSuccess: (r) => {
      setNotice(t('adminBilling.accrued', { count: r.accrued }));
      void queryClient.invalidateQueries({ queryKey: ['admin-commissions'] });
    },
  });
  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          {['', 'ACCRUED', 'INVOICED', 'CANCELLED'].map((s) => (
            <button
              key={s || 'all'}
              onClick={() => setStatus(s)}
              className={`rounded-full border px-3 py-1 text-sm ${status === s ? 'border-primary-600 bg-primary-50 font-semibold text-primary-600' : 'border-gray-300 bg-white'}`}
            >
              {s ? t(`commissionStatus.${s}`) : t('common.all')}
            </button>
          ))}
        </div>
        <Button
          variant="secondary"
          loading={accrue.isPending}
          onClick={() => accrue.mutate()}
          title={t('adminBilling.accrueHint')}
        >
          {t('adminBilling.accrueMissing')}
        </Button>
      </div>
      {notice && <Alert tone="success">{notice}</Alert>}
      {accrue.isError && <Alert tone="danger">{errorMessage(accrue.error)}</Alert>}
      {list.isLoading ? (
        <Spinner />
      ) : list.isError ? (
        <Alert tone="danger">{errorMessage(list.error)}</Alert>
      ) : !list.data?.length ? (
        <EmptyState>{t('adminBilling.noCommissions')}</EmptyState>
      ) : (
        <Table
          head={[
            t('commissions.payer'),
            t('commissions.source'),
            t('commissions.rule'),
            t('commissions.base'),
            t('commissions.amount'),
            t('fields.status'),
            t('commissions.accruedAt'),
          ]}
        >
          {list.data.map((c) => (
            <tr key={c.id}>
              <Td>{c.organizationName}</Td>
              <Td className="font-mono">
                <span dir="ltr">{c.sourceReference}</span>
              </Td>
              <Td className="text-xs">{c.rule ? localized(c.rule.name) : '—'}</Td>
              <Td>
                <Amount value={c.baseAmount} />
              </Td>
              <Td>
                <Amount value={c.amount} className="font-semibold" />
              </Td>
              <Td>
                <CommissionStatusBadge status={c.status} />
              </Td>
              <Td>{formatDate(c.accruedAt)}</Td>
            </tr>
          ))}
        </Table>
      )}
    </>
  );
}

interface RuleForm {
  nameFr: string;
  nameAr: string;
  trigger: CommissionRule['trigger'];
  payerOrgId: string;
  basis: CommissionRule['basis'];
  ratePct: string;
  fixedAmount: string;
  minAmount: string;
  maxAmount: string;
  categoryCodes: string[];
  validFrom: string;
  validTo: string;
  isActive: boolean;
}

const toRuleForm = (r: CommissionRule | null): RuleForm => ({
  nameFr: r?.name.fr ?? '',
  nameAr: r?.name.ar ?? '',
  trigger: r?.trigger ?? 'QUOTATION_ACCEPTED',
  payerOrgId: r?.payerOrgId ?? '',
  basis: r?.basis ?? 'PERCENT',
  ratePct: r?.ratePct ? String(Number(r.ratePct)) : '',
  fixedAmount: r?.fixedAmount ? String(Number(r.fixedAmount)) : '',
  minAmount: r?.minAmount ? String(Number(r.minAmount)) : '',
  maxAmount: r?.maxAmount ? String(Number(r.maxAmount)) : '',
  categoryCodes: r?.categoryCodes ?? [],
  validFrom: r?.validFrom?.slice(0, 10) ?? todayIso(),
  validTo: r?.validTo?.slice(0, 10) ?? '',
  isActive: r?.isActive ?? true,
});

function RuleModal({ rule, onClose }: { rule: CommissionRule | null; onClose: () => void }) {
  const { t } = useTranslation();
  const localized = useLocalizedName();
  const errorMessage = useErrorMessage();
  const queryClient = useQueryClient();
  const [f, setF] = useState<RuleForm>(toRuleForm(rule));
  const set = <K extends keyof RuleForm>(k: K, v: RuleForm[K]) => setF((x) => ({ ...x, [k]: v }));
  const categories = useQuery({
    queryKey: ['categories'],
    queryFn: () => api<Category[]>('/marketplace/categories'),
    staleTime: 300_000,
  });
  const payers = useQuery({
    queryKey: ['payer-orgs', f.trigger],
    queryFn: () =>
      api<{ items: Array<{ id: string; legalName: string }> }>('/admin/organizations', {
        org: true,
        query: {
          type: f.trigger === 'QUOTATION_ACCEPTED' ? 'SUPPLIER' : 'FINANCIAL_INSTITUTION',
          status: 'VERIFIED',
          limit: 100,
        },
      }),
  });
  const save = useMutation({
    mutationFn: () => {
      const body = {
        name: { fr: f.nameFr.trim() || undefined, ar: f.nameAr.trim() || undefined },
        trigger: f.trigger,
        payerOrgId: f.payerOrgId || undefined,
        basis: f.basis,
        ratePct: f.basis === 'PERCENT' ? f.ratePct : undefined,
        fixedAmount: f.basis === 'FIXED' ? f.fixedAmount : undefined,
        minAmount: f.basis === 'PERCENT' && f.minAmount ? f.minAmount : undefined,
        maxAmount: f.basis === 'PERCENT' && f.maxAmount ? f.maxAmount : undefined,
        categoryCodes: f.categoryCodes,
        validFrom: f.validFrom,
        validTo: f.validTo || undefined,
        isActive: f.isActive,
      };
      return rule
        ? api(`/admin/billing/rules/${rule.id}`, { method: 'PUT', org: true, body })
        : api('/admin/billing/rules', { method: 'POST', org: true, body });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin-rules'] });
      onClose();
    },
  });
  function submit(e: FormEvent) {
    e.preventDefault();
    save.mutate();
  }
  return (
    <Modal
      open
      title={rule ? t('rules.editTitle') : t('rules.newTitle')}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" form="rule-form" loading={save.isPending}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <form
        id="rule-form"
        onSubmit={submit}
        className="max-h-[65vh] space-y-4 overflow-y-auto pe-1"
      >
        {save.isError && <Alert tone="danger">{errorMessage(save.error)}</Alert>}
        <div className="grid gap-4 sm:grid-cols-2">
          <TextInput
            label={t('rules.nameFr')}
            value={f.nameFr}
            onChange={(e) => set('nameFr', e.target.value)}
            maxLength={150}
          />
          <TextInput
            label={t('rules.nameAr')}
            value={f.nameAr}
            onChange={(e) => set('nameAr', e.target.value)}
            maxLength={150}
            dir="rtl"
          />
          <SelectInput
            label={t('rules.trigger')}
            value={f.trigger}
            onChange={(e) =>
              setF((x) => ({
                ...x,
                trigger: e.target.value as RuleForm['trigger'],
                payerOrgId: '',
              }))
            }
            options={(['QUOTATION_ACCEPTED', 'OFFER_ACCEPTED'] as const).map((v) => ({
              value: v,
              label: t(`rules.triggerLabel.${v}`),
            }))}
          />
          <SelectInput
            label={t('rules.payer')}
            value={f.payerOrgId}
            onChange={(e) => set('payerOrgId', e.target.value)}
            options={[
              { value: '', label: t('rules.allPayers') },
              ...(payers.data?.items ?? []).map((o) => ({ value: o.id, label: o.legalName })),
            ]}
          />
          <SelectInput
            label={t('rules.basis')}
            value={f.basis}
            onChange={(e) => set('basis', e.target.value as RuleForm['basis'])}
            options={[
              { value: 'PERCENT', label: t('rules.percent') },
              { value: 'FIXED', label: t('rules.fixed') },
            ]}
          />
          {f.basis === 'PERCENT' ? (
            <TextInput
              label={t('rules.ratePct')}
              value={f.ratePct}
              onChange={(e) => set('ratePct', decimal(e.target.value))}
              required
              inputMode="decimal"
              dir="ltr"
            />
          ) : (
            <TextInput
              label={t('rules.fixedAmount')}
              value={f.fixedAmount}
              onChange={(e) => set('fixedAmount', decimal(e.target.value))}
              required
              inputMode="decimal"
              dir="ltr"
            />
          )}
          {f.basis === 'PERCENT' && (
            <>
              <TextInput
                label={t('rules.minAmount')}
                value={f.minAmount}
                onChange={(e) => set('minAmount', decimal(e.target.value))}
                inputMode="decimal"
                dir="ltr"
              />
              <TextInput
                label={t('rules.maxAmount')}
                value={f.maxAmount}
                onChange={(e) => set('maxAmount', decimal(e.target.value))}
                inputMode="decimal"
                dir="ltr"
              />
            </>
          )}
          <TextInput
            label={t('rules.validFrom')}
            type="date"
            value={f.validFrom}
            onChange={(e) => set('validFrom', e.target.value)}
            required
            dir="ltr"
          />
          <TextInput
            label={t('rules.validTo')}
            type="date"
            value={f.validTo}
            onChange={(e) => set('validTo', e.target.value)}
            dir="ltr"
          />
        </div>
        <fieldset>
          <legend className="mb-2 text-sm font-semibold text-gray-800">
            {t('rules.categories')}
          </legend>
          <p className="mb-2 text-xs text-gray-500">{t('rules.categoriesHint')}</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {(categories.data ?? []).map((c) => (
              <Checkbox
                key={c.code}
                label={localized(c.name)}
                checked={f.categoryCodes.includes(c.code)}
                onChange={() =>
                  set(
                    'categoryCodes',
                    f.categoryCodes.includes(c.code)
                      ? f.categoryCodes.filter((x) => x !== c.code)
                      : [...f.categoryCodes, c.code],
                  )
                }
              />
            ))}
          </div>
        </fieldset>
        <Checkbox
          label={t('rules.active')}
          checked={f.isActive}
          onChange={(e) => set('isActive', e.target.checked)}
        />
        <p className="text-xs text-gray-500">{t('rules.precedence')}</p>
      </form>
    </Modal>
  );
}

function RulesTab() {
  const { t } = useTranslation();
  const localized = useLocalizedName();
  const errorMessage = useErrorMessage();
  const summary = useRuleSummary();
  const [editing, setEditing] = useState<CommissionRule | null | 'new'>(null);
  const rules = useQuery({
    queryKey: ['admin-rules'],
    queryFn: () => api<CommissionRule[]>('/admin/billing/rules', { org: true }),
  });
  return (
    <>
      <div className="mb-4 flex justify-end">
        <Button onClick={() => setEditing('new')}>{t('rules.new')}</Button>
      </div>
      {rules.isLoading ? (
        <Spinner />
      ) : rules.isError ? (
        <Alert tone="danger">{errorMessage(rules.error)}</Alert>
      ) : !rules.data?.length ? (
        <EmptyState>{t('rules.empty')}</EmptyState>
      ) : (
        <Table
          head={[
            t('rules.name'),
            t('rules.trigger'),
            t('rules.terms'),
            t('rules.validity'),
            t('rules.used'),
            '',
          ]}
        >
          {rules.data.map((r) => (
            <tr key={r.id} className={r.isActive ? '' : 'opacity-60'}>
              <Td className="font-semibold">
                {localized(r.name)}
                <div className="text-xs font-normal text-gray-500">
                  {r.payerOrgId ? t('rules.specific') : t('rules.allPayers')}
                </div>
              </Td>
              <Td>{t(`rules.triggerLabel.${r.trigger}`)}</Td>
              <Td>{summary(r)}</Td>
              <Td className="text-xs">
                {formatDate(r.validFrom)} –{' '}
                {r.validTo ? formatDate(r.validTo) : t('rules.openEnded')}
                {!r.isActive && <div>{t('rules.inactive')}</div>}
              </Td>
              <Td className="tabular-nums">{r._count?.commissions ?? 0}</Td>
              <Td>
                <Button variant="ghost" onClick={() => setEditing(r)}>
                  {t('common.edit')}
                </Button>
              </Td>
            </tr>
          ))}
        </Table>
      )}
      {editing && (
        <RuleModal rule={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />
      )}
    </>
  );
}

const EMPTY_SETTINGS: BillingSettings = {
  issuer: {
    legalName: '',
    address: '',
    wilayaCode: '',
    rcNumber: '',
    nif: '',
    nis: '',
    articleImposition: '',
    bankName: '',
    rib: '',
    email: '',
    phone: '',
  },
  vatRate: '',
  paymentTermsDays: 30,
  invoicePrefix: '',
  creditNotePrefix: '',
};

function SettingsTab() {
  const { t } = useTranslation();
  const errorMessage = useErrorMessage();
  const queryClient = useQueryClient();
  const settings = useQuery({
    queryKey: ['billing-settings'],
    queryFn: () => api<BillingSettings | null>('/admin/billing/settings', { org: true }),
  });
  const [f, setF] = useState<BillingSettings>(EMPTY_SETTINGS);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    if (settings.data)
      setF({
        ...EMPTY_SETTINGS,
        ...settings.data,
        issuer: { ...EMPTY_SETTINGS.issuer, ...settings.data.issuer },
      });
  }, [settings.data]);
  const issuer = (k: keyof BillingSettings['issuer'], v: string) =>
    setF((x) => ({ ...x, issuer: { ...x.issuer, [k]: v } }));
  const save = useMutation({
    mutationFn: () =>
      api('/admin/billing/settings', {
        method: 'PUT',
        org: true,
        body: {
          ...f,
          issuer: Object.fromEntries(Object.entries(f.issuer).filter(([, v]) => v !== '')),
          paymentTermsDays: Number(f.paymentTermsDays),
        },
      }),
    onSuccess: () => {
      setSaved(true);
      void queryClient.invalidateQueries({ queryKey: ['billing-settings'] });
    },
  });
  if (settings.isLoading) return <Spinner />;
  const fields: Array<[keyof BillingSettings['issuer'], boolean]> = [
    ['legalName', true],
    ['address', true],
    ['wilayaCode', true],
    ['rcNumber', true],
    ['nif', true],
    ['nis', true],
    ['articleImposition', true],
    ['bankName', false],
    ['rib', false],
    ['email', false],
    ['phone', false],
  ];
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        setSaved(false);
        save.mutate();
      }}
      className="max-w-3xl space-y-6"
    >
      {!settings.data && <Alert tone="action">{t('adminBilling.notConfigured')}</Alert>}
      {saved && <Alert tone="success">{t('adminBilling.settingsSaved')}</Alert>}
      {save.isError && <Alert tone="danger">{errorMessage(save.error)}</Alert>}
      <Card title={t('adminBilling.issuer')}>
        <p className="mb-3 text-xs text-gray-600">{t('adminBilling.issuerHint')}</p>
        <div className="grid gap-4 sm:grid-cols-2">
          {fields.map(([k, required]) => (
            <TextInput
              key={k}
              label={t(`adminBilling.field.${k}`)}
              value={f.issuer[k] ?? ''}
              required={required}
              onChange={(e) => issuer(k, e.target.value)}
              dir={
                ['rib', 'nif', 'nis', 'rcNumber', 'articleImposition', 'wilayaCode'].includes(k)
                  ? 'ltr'
                  : 'auto'
              }
            />
          ))}
        </div>
      </Card>
      <Card title={t('adminBilling.terms')}>
        <div className="grid gap-4 sm:grid-cols-2">
          <TextInput
            label={t('adminBilling.vatRate')}
            hint={t('adminBilling.vatHint')}
            value={f.vatRate}
            required
            onChange={(e) => setF((x) => ({ ...x, vatRate: decimal(e.target.value) }))}
            inputMode="decimal"
            dir="ltr"
          />
          <TextInput
            label={t('adminBilling.paymentTerms')}
            type="number"
            min={0}
            max={180}
            value={f.paymentTermsDays}
            required
            onChange={(e) => setF((x) => ({ ...x, paymentTermsDays: Number(e.target.value) }))}
            dir="ltr"
          />
          <TextInput
            label={t('adminBilling.invoicePrefix')}
            value={f.invoicePrefix}
            required
            maxLength={6}
            onChange={(e) =>
              setF((x) => ({
                ...x,
                invoicePrefix: e.target.value.toUpperCase().replace(/[^A-Z]/g, ''),
              }))
            }
            dir="ltr"
          />
          <TextInput
            label={t('adminBilling.creditNotePrefix')}
            value={f.creditNotePrefix}
            required
            maxLength={6}
            onChange={(e) =>
              setF((x) => ({
                ...x,
                creditNotePrefix: e.target.value.toUpperCase().replace(/[^A-Z]/g, ''),
              }))
            }
            dir="ltr"
          />
        </div>
        <p className="mt-2 text-xs text-gray-500">{t('adminBilling.numberingHint')}</p>
      </Card>
      <div className="flex justify-end">
        <Button type="submit" loading={save.isPending}>
          {t('common.save')}
        </Button>
      </div>
    </form>
  );
}

export function AdminInvoicePage() {
  const { t } = useTranslation();
  const { id = '' } = useParams();
  const errorMessage = useErrorMessage();
  const queryClient = useQueryClient();
  const [modal, setModal] = useState<'paid' | 'credit' | null>(null);
  const [paidOn, setPaidOn] = useState(todayIso());
  const [reference, setReference] = useState('');
  const [reason, setReason] = useState('');
  const [release, setRelease] = useState(true);
  const invoice = useQuery({
    queryKey: ['admin-invoice', id],
    queryFn: () => api<Invoice>(`/admin/billing/invoices/${id}`, { org: true }),
  });
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['admin-invoice', id] });
    void queryClient.invalidateQueries({ queryKey: ['admin-invoices'] });
    void queryClient.invalidateQueries({ queryKey: ['admin-commissions'] });
  };
  const act = useMutation({
    mutationFn: (what: 'issue' | 'discard' | 'paid' | 'credit') =>
      what === 'paid'
        ? api(`/admin/billing/invoices/${id}/paid`, {
            method: 'POST',
            org: true,
            body: { paidOn, reference: reference.trim() },
          })
        : what === 'credit'
          ? api(`/admin/billing/invoices/${id}/credit-note`, {
              method: 'POST',
              org: true,
              body: { reason: reason.trim(), releaseCommissions: release },
            })
          : api(`/admin/billing/invoices/${id}/${what}`, { method: 'POST', org: true }),
    onSuccess: () => {
      setModal(null);
      refresh();
    },
  });
  if (invoice.isLoading) return <Spinner />;
  if (invoice.isError || !invoice.data)
    return <Alert tone="danger">{errorMessage(invoice.error)}</Alert>;
  const i = invoice.data;
  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link to="/admin/billing" className="text-sm text-primary-600 hover:underline">
          {t('billing.back')}
        </Link>
        <div className="flex flex-wrap items-center gap-2">
          <InvoiceStatusBadge invoice={i} />
          {i.status === 'DRAFT' && (
            <>
              <Button
                variant="ghost"
                loading={act.isPending}
                onClick={() =>
                  window.confirm(t('adminBilling.discardConfirm')) && act.mutate('discard')
                }
              >
                {t('adminBilling.discard')}
              </Button>
              <Button
                loading={act.isPending}
                onClick={() =>
                  window.confirm(t('adminBilling.issueConfirm')) && act.mutate('issue')
                }
              >
                {t('adminBilling.issue')}
              </Button>
            </>
          )}
          {i.kind === 'INVOICE' && i.status === 'ISSUED' && (
            <Button onClick={() => setModal('paid')}>{t('adminBilling.markPaid')}</Button>
          )}
          {i.kind === 'INVOICE' && (i.status === 'ISSUED' || i.status === 'PAID') && (
            <Button variant="secondary" onClick={() => setModal('credit')}>
              {t('adminBilling.creditNote')}
            </Button>
          )}
          <Button variant="secondary" onClick={() => window.print()}>
            {t('invoice.print')}
          </Button>
        </div>
      </div>
      {act.isError && <Alert tone="danger">{errorMessage(act.error)}</Alert>}
      {i.status === 'DRAFT' && <Alert tone="info">{t('adminBilling.draftNotice')}</Alert>}
      <InvoiceDocument invoice={i} />

      <Modal
        open={modal === 'paid'}
        title={t('adminBilling.markPaid')}
        onClose={() => setModal(null)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setModal(null)}>
              {t('common.cancel')}
            </Button>
            <Button
              loading={act.isPending}
              disabled={reference.trim().length < 2}
              onClick={() => act.mutate('paid')}
            >
              {t('common.confirm')}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <TextInput
            label={t('adminBilling.paidOn')}
            type="date"
            max={todayIso()}
            value={paidOn}
            onChange={(e) => setPaidOn(e.target.value)}
            dir="ltr"
          />
          <TextInput
            label={t('adminBilling.paymentReference')}
            hint={t('adminBilling.paymentReferenceHint')}
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            maxLength={100}
          />
        </div>
      </Modal>
      <Modal
        open={modal === 'credit'}
        title={t('adminBilling.creditNoteTitle')}
        onClose={() => setModal(null)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setModal(null)}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="danger"
              loading={act.isPending}
              disabled={reason.trim().length < 3}
              onClick={() => act.mutate('credit')}
            >
              {t('adminBilling.issueCreditNote')}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <p className="text-sm text-gray-700">{t('adminBilling.creditNoteBody')}</p>
          <TextInput
            label={t('adminBilling.creditReason')}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={500}
          />
          <Checkbox
            label={t('adminBilling.releaseCommissions')}
            checked={release}
            onChange={(e) => setRelease(e.target.checked)}
          />
          <p className="text-xs text-gray-500">
            {release ? t('adminBilling.releaseHint') : t('adminBilling.cancelHint')}
          </p>
        </div>
      </Modal>
    </>
  );
}

/** Platform activity and money, on the admin dashboard. */
export function PlatformReport() {
  const { t } = useTranslation();
  const report = useQuery({
    queryKey: ['admin-reports'],
    queryFn: () =>
      api<Record<string, string | number | Array<{ month: string; value: string }>>>(
        '/admin/reports',
        { org: true },
      ),
  });
  if (!report.data) return null;
  const r = report.data;
  return (
    <section className="mt-6">
      <h2 className="mb-3 text-lg font-semibold text-start">{t('reports.platformTitle')}</h2>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label={t('reports.publishedListings')}
          value={r.publishedListings as number}
          hint={t('reports.requestsTotal', { count: r.quotationRequests as number })}
        />
        <StatTile
          label={t('reports.acceptedValue')}
          value={<Money value={r.acceptedQuotationValue as string} />}
          hint={t('reports.acceptedQuotations', { count: r.acceptedQuotations as number })}
        />
        <StatTile
          label={t('reports.financedVolume')}
          value={<Money value={r.financedVolume as string} />}
          hint={t('reports.acceptedOffers', { count: r.acceptedOffers as number })}
        />
        <StatTile
          label={t('reports.commissionsAccrued')}
          value={<Money value={r.commissionsAccrued as string} />}
          to="/admin/billing?tab=commissions"
          hint={t('reports.toInvoice')}
        />
        <StatTile
          label={t('reports.receivables')}
          value={<Money value={r.receivables as string} />}
          to="/admin/billing"
        />
        <StatTile
          label={t('reports.overdue')}
          value={<Money value={r.overdue as string} />}
          to="/admin/billing?tab=invoices"
          tone={Number(r.overdue) > 0 ? 'attention' : 'default'}
        />
        <StatTile label={t('reports.collected')} value={<Money value={r.collected as string} />} />
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <MonthlyBars
          title={t('reports.financedByMonth')}
          series={r.financedByMonth as Array<{ month: string; value: string }>}
          money
        />
        <MonthlyBars
          title={t('reports.commissionsByMonth')}
          series={r.commissionsByMonth as Array<{ month: string; value: string }>}
          money
        />
      </div>
    </section>
  );
}
