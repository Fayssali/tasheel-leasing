import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link, useParams, useSearchParams } from 'react-router';
import { Alert, Button, EmptyState, PageHeader, Spinner, Table, Td } from '../../components/ui';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { formatDate, useErrorMessage, useLocalizedName } from '../../lib/format';
import type { Commission, CommissionRule, Invoice } from '../../lib/types';
import { Amount, CommissionStatusBadge, InvoiceDocument, InvoiceStatusBadge } from './common';

const TABS = ['invoices', 'commissions', 'rules'] as const;

/** Rule summary in words: "2 % (min. 5 000 DZD)" or "50 000 DZD per deal". */
export function useRuleSummary() {
  const { t } = useTranslation();
  return (
    r: Pick<CommissionRule, 'basis' | 'ratePct' | 'fixedAmount' | 'minAmount' | 'maxAmount'>,
  ) =>
    r.basis === 'PERCENT'
      ? [
          `${Number(r.ratePct)} %`,
          r.minAmount
            ? t('rules.min', { amount: Number(r.minAmount).toLocaleString('fr-DZ') })
            : null,
          r.maxAmount
            ? t('rules.max', { amount: Number(r.maxAmount).toLocaleString('fr-DZ') })
            : null,
        ]
          .filter(Boolean)
          .join(' · ')
      : t('rules.fixedPerDeal', { amount: Number(r.fixedAmount).toLocaleString('fr-DZ') });
}

export function BillingPage() {
  const { t } = useTranslation();
  const { activeOrg } = useAuth();
  const localized = useLocalizedName();
  const errorMessage = useErrorMessage();
  const summary = useRuleSummary();
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as (typeof TABS)[number]) ?? 'invoices';
  const org = activeOrg?.organizationId;
  const invoices = useQuery({
    queryKey: ['my-invoices', org],
    queryFn: () => api<Invoice[]>('/billing/invoices', { org: true }),
    enabled: tab === 'invoices',
  });
  const commissions = useQuery({
    queryKey: ['my-commissions', org],
    queryFn: () => api<Commission[]>('/billing/commissions', { org: true }),
    enabled: tab === 'commissions',
  });
  const rules = useQuery({
    queryKey: ['my-rules', org],
    queryFn: () => api<CommissionRule[]>('/billing/rules', { org: true }),
    enabled: tab === 'rules',
  });
  const current = { invoices, commissions, rules }[tab];

  return (
    <>
      <PageHeader title={t('billing.title')} subtitle={t('billing.subtitle')} />
      <div className="mb-4 flex gap-2 border-b border-gray-200" role="tablist">
        {TABS.map((k) => (
          <button
            key={k}
            role="tab"
            aria-selected={tab === k}
            onClick={() => setParams({ tab: k })}
            className={`-mb-px border-b-2 px-3 py-2 text-sm ${tab === k ? 'border-primary-600 font-semibold text-primary-600' : 'border-transparent text-gray-600 hover:text-gray-900'}`}
          >
            {t(`billing.tab.${k}`)}
          </button>
        ))}
      </div>
      {current.isLoading ? (
        <Spinner />
      ) : current.isError ? (
        <Alert tone="danger">{errorMessage(current.error)}</Alert>
      ) : tab === 'invoices' ? (
        !invoices.data?.length ? (
          <EmptyState>{t('billing.noInvoices')}</EmptyState>
        ) : (
          <Table
            head={[
              t('invoice.number'),
              t('invoice.issueDate'),
              t('invoice.dueDate'),
              t('invoice.total'),
              t('fields.status'),
            ]}
          >
            {invoices.data.map((i) => (
              <tr key={i.id} className="hover:bg-gray-50">
                <Td>
                  <Link
                    to={`/app/billing/invoices/${i.id}`}
                    className="font-mono font-semibold text-primary-600 hover:underline"
                    dir="ltr"
                  >
                    {i.number}
                  </Link>
                  <div className="text-xs text-gray-500">
                    {i.kind === 'CREDIT_NOTE' ? t('invoice.creditNote') : t('invoice.invoice')}
                  </div>
                </Td>
                <Td>{formatDate(i.issueDate)}</Td>
                <Td>{i.kind === 'INVOICE' ? formatDate(i.dueDate) : '—'}</Td>
                <Td>
                  <Amount value={i.total} />
                </Td>
                <Td>
                  <InvoiceStatusBadge invoice={i} />
                </Td>
              </tr>
            ))}
          </Table>
        )
      ) : tab === 'commissions' ? (
        !commissions.data?.length ? (
          <EmptyState>{t('billing.noCommissions')}</EmptyState>
        ) : (
          <Table
            head={[
              t('commissions.source'),
              t('commissions.base'),
              t('commissions.rate'),
              t('commissions.amount'),
              t('fields.status'),
              t('commissions.accruedAt'),
            ]}
          >
            {commissions.data.map((c) => (
              <tr key={c.id}>
                <Td className="font-mono">
                  <span dir="ltr">{c.sourceReference}</span>
                </Td>
                <Td>
                  <Amount value={c.baseAmount} />
                </Td>
                <Td>{c.ratePct ? `${Number(c.ratePct)} %` : t('rules.fixed')}</Td>
                <Td>
                  <Amount value={c.amount} className="font-semibold" />
                </Td>
                <Td>
                  <CommissionStatusBadge status={c.status} />
                  {c.invoice?.number && (
                    <div className="font-mono text-xs text-gray-500" dir="ltr">
                      {c.invoice.number}
                    </div>
                  )}
                </Td>
                <Td>{formatDate(c.accruedAt)}</Td>
              </tr>
            ))}
          </Table>
        )
      ) : !rules.data?.length ? (
        <EmptyState>{t('billing.noRules')}</EmptyState>
      ) : (
        <>
          <p className="mb-3 text-sm text-gray-600">{t('billing.rulesHint')}</p>
          <Table
            head={[t('rules.name'), t('rules.trigger'), t('rules.terms'), t('rules.validity')]}
          >
            {rules.data.map((r) => (
              <tr key={r.id}>
                <Td className="font-semibold">
                  {localized(r.name)}
                  {r.payerOrgId && (
                    <div className="text-xs font-normal text-gray-500">{t('rules.specific')}</div>
                  )}
                </Td>
                <Td>{t(`rules.triggerLabel.${r.trigger}`)}</Td>
                <Td>{summary(r)}</Td>
                <Td>
                  {formatDate(r.validFrom)} –{' '}
                  {r.validTo ? formatDate(r.validTo) : t('rules.openEnded')}
                </Td>
              </tr>
            ))}
          </Table>
        </>
      )}
    </>
  );
}

export function InvoicePage({ admin = false }: { admin?: boolean }) {
  const { t } = useTranslation();
  const { id = '' } = useParams();
  const errorMessage = useErrorMessage();
  const invoice = useQuery({
    queryKey: ['invoice', id, admin],
    queryFn: () =>
      api<Invoice>(admin ? `/admin/billing/invoices/${id}` : `/billing/invoices/${id}`, {
        org: true,
      }),
  });
  if (invoice.isLoading) return <Spinner />;
  if (invoice.isError || !invoice.data)
    return <Alert tone="danger">{errorMessage(invoice.error)}</Alert>;
  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link
          to={admin ? '/admin/billing' : '/app/billing'}
          className="text-sm text-primary-600 hover:underline"
        >
          {t('billing.back')}
        </Link>
        <div className="flex items-center gap-3">
          <InvoiceStatusBadge invoice={invoice.data} />
          <Button variant="secondary" onClick={() => window.print()}>
            {t('invoice.print')}
          </Button>
        </div>
      </div>
      <InvoiceDocument invoice={invoice.data} />
    </>
  );
}
