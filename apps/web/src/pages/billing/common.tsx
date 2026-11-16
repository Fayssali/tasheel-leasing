import { formatMoney } from '@tasheel/shared';
import { useTranslation } from 'react-i18next';
import { Badge } from '../../components/ui';
import { formatDate } from '../../lib/format';
import type { Commission, Invoice, PartyIdentity } from '../../lib/types';

type Tone = 'neutral' | 'action' | 'success' | 'danger' | 'info';
const INVOICE_TONE: Record<Invoice['status'], Tone> = {
  DRAFT: 'neutral',
  ISSUED: 'action',
  PAID: 'success',
  CANCELLED: 'neutral',
};
const COMMISSION_TONE: Record<Commission['status'], Tone> = {
  ACCRUED: 'info',
  INVOICED: 'success',
  CANCELLED: 'neutral',
};

export function InvoiceStatusBadge({
  invoice,
}: {
  invoice: Pick<Invoice, 'status' | 'dueDate' | 'kind'>;
}) {
  const { t } = useTranslation();
  const overdue =
    invoice.kind === 'INVOICE' &&
    invoice.status === 'ISSUED' &&
    invoice.dueDate &&
    new Date(invoice.dueDate) < new Date(new Date().toISOString().slice(0, 10));
  if (overdue) return <Badge tone="danger">{t('invoiceStatus.OVERDUE')}</Badge>;
  return <Badge tone={INVOICE_TONE[invoice.status]}>{t(`invoiceStatus.${invoice.status}`)}</Badge>;
}

export function CommissionStatusBadge({ status }: { status: Commission['status'] }) {
  const { t } = useTranslation();
  return <Badge tone={COMMISSION_TONE[status]}>{t(`commissionStatus.${status}`)}</Badge>;
}

export function Amount({ value, className }: { value: string; className?: string }) {
  const { i18n } = useTranslation();
  return (
    <span dir="ltr" className={`tabular-nums ${className ?? ''}`}>
      {formatMoney(value, i18n.language)}
    </span>
  );
}

function Party({ title, p }: { title: string; p: PartyIdentity }) {
  const { t } = useTranslation();
  const ids: Array<[string, string | null | undefined]> = [
    ['RC', p.rcNumber],
    ['NIF', p.nif],
    ['NIS', p.nis],
    [t('invoice.article'), p.articleImposition],
  ];
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-gray-500">{title}</p>
      <p className="mt-1 font-semibold text-gray-900" dir="auto">
        {p.legalName}
      </p>
      {p.address && (
        <p className="text-sm text-gray-700" dir="auto">
          {p.address}
        </p>
      )}
      {p.wilayaCode && (
        <p className="text-sm text-gray-700">
          {t('fields.wilayaCode')} {p.wilayaCode}
        </p>
      )}
      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 text-xs text-gray-600" dir="ltr">
        {ids.map(([k, v]) => (
          <div key={k} className="contents">
            <dt>{k}</dt>
            <dd className="font-mono">{v || '—'}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/**
 * The invoice or credit note as a document. Snapshots taken at issue are shown, not the
 * organizations' current profiles. Printable (the shell is hidden when printing).
 */
export function InvoiceDocument({ invoice }: { invoice: Invoice }) {
  const { t } = useTranslation();
  const isCredit = invoice.kind === 'CREDIT_NOTE';
  return (
    <article className="rounded-lg border border-gray-200 bg-white p-8 print:border-0 print:p-0">
      <header className="flex flex-wrap items-start justify-between gap-6 border-b border-gray-200 pb-6">
        <Party title={t('invoice.issuer')} p={invoice.issuer} />
        <div className="text-end">
          <p className="text-2xl font-semibold text-primary-900">
            {isCredit ? t('invoice.creditNote') : t('invoice.invoice')}
          </p>
          <p className="font-mono text-lg" dir="ltr">
            {invoice.number ?? t('invoice.draft')}
          </p>
          <dl className="mt-2 space-y-0.5 text-sm text-gray-600">
            {invoice.issueDate && (
              <div>
                {t('invoice.issueDate')} : {formatDate(invoice.issueDate)}
              </div>
            )}
            {invoice.dueDate && !isCredit && (
              <div>
                {t('invoice.dueDate')} : {formatDate(invoice.dueDate)}
              </div>
            )}
            <div>
              {t('invoice.period')} :{' '}
              <bdi dir="ltr">
                {formatDate(invoice.periodStart)} – {formatDate(invoice.periodEnd)}
              </bdi>
            </div>
          </dl>
        </div>
      </header>
      <div className="grid gap-6 py-6 sm:grid-cols-2">
        <Party
          title={t('invoice.customer')}
          p={
            invoice.customer?.legalName ? invoice.customer : { legalName: invoice.organizationName }
          }
        />
        {invoice.notes && (
          <div>
            <p className="text-xs uppercase tracking-wide text-gray-500">
              {isCredit ? t('invoice.creditReason') : t('invoice.notes')}
            </p>
            <p className="mt-1 text-sm text-gray-700" dir="auto">
              {invoice.notes}
            </p>
          </div>
        )}
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-300 text-xs text-gray-500">
            <th className="py-2 text-start font-normal">{t('invoice.designation')}</th>
            <th className="py-2 text-end font-normal">{t('invoice.amountHt')}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {(invoice.lines ?? []).map((l) => (
            <tr key={l.id}>
              <td className="py-2">{l.label}</td>
              <td className="py-2 text-end">
                <Amount value={l.amount} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <dl className="ms-auto mt-6 w-full max-w-xs space-y-1 text-sm">
        <div className="flex justify-between">
          <dt className="text-gray-600">{t('invoice.subtotal')}</dt>
          <dd>
            <Amount value={invoice.subtotal} />
          </dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-gray-600">{t('invoice.vat', { rate: Number(invoice.vatRate) })}</dt>
          <dd>
            <Amount value={invoice.vatAmount} />
          </dd>
        </div>
        <div className="flex justify-between border-t border-gray-300 pt-1 text-base font-semibold">
          <dt>{t('invoice.total')}</dt>
          <dd>
            <Amount value={invoice.total} />
          </dd>
        </div>
      </dl>
      {!isCredit && (invoice.issuer.rib || invoice.issuer.bankName) && (
        <p className="mt-8 border-t border-gray-200 pt-4 text-xs text-gray-600">
          {t('invoice.payment')} : <bdi>{invoice.issuer.bankName}</bdi>{' '}
          <bdi className="font-mono" dir="ltr">
            {invoice.issuer.rib}
          </bdi>
        </p>
      )}
      {invoice.status === 'PAID' && invoice.paidAt && (
        <p className="mt-2 text-xs text-success-600">
          {t('invoice.paidOn', {
            date: formatDate(invoice.paidAt),
            reference: invoice.paymentReference ?? '',
          })}
        </p>
      )}
    </article>
  );
}
