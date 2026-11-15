import { computeQuotationTotals } from '@tasheel/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { Price, useListingTitle } from '../../components/marketplace';
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  Modal,
  PageHeader,
  Spinner,
  TextInput,
} from '../../components/ui';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { formatDate, useErrorMessage } from '../../lib/format';
import type { Quotation, QuotationRequestRow } from '../../lib/types';

const REQUEST_TONE = {
  OPEN: 'action',
  QUOTED: 'info',
  CLOSED: 'success',
  CANCELLED: 'neutral',
} as const;
const QUOTE_TONE = {
  ISSUED: 'info',
  ACCEPTED: 'success',
  DECLINED: 'danger',
  EXPIRED: 'neutral',
  WITHDRAWN: 'neutral',
} as const;

function QuotationView({ q }: { q: Quotation }) {
  const { t } = useTranslation();
  return (
    <div className="rounded-lg border border-gray-200 p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <span className="font-semibold">{q.reference}</span>
        <span className="flex items-center gap-2 text-xs text-gray-500">
          {t('quotes.validUntil', { date: formatDate(q.validUntil) })}
          <Badge tone={QUOTE_TONE[q.status]}>{t(`quoteStatus.${q.status}`)}</Badge>
        </span>
      </div>
      <table className="w-full text-sm">
        <thead className="text-xs text-gray-500">
          <tr>
            <th className="py-1 text-start font-normal">{t('quotes.line')}</th>
            <th className="py-1 text-end font-normal">{t('market.quantity')}</th>
            <th className="py-1 text-end font-normal">{t('quotes.unitPrice')}</th>
            <th className="py-1 text-end font-normal">{t('quotes.lineTotal')}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {q.lines.map((l, i) => (
            <tr key={i}>
              <td className="py-1.5" dir="auto">
                {l.label}
              </td>
              <td className="py-1.5 text-end tabular-nums">{l.quantity}</td>
              <td className="py-1.5 text-end">
                <Price value={l.unitPrice} onRequest={false} bare />
              </td>
              <td className="py-1.5 text-end">
                <Price value={l.lineTotal} onRequest={false} bare />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <dl className="mt-3 space-y-1 border-t border-gray-200 pt-3 text-sm">
        <div className="flex justify-between">
          <dt className="text-gray-500">{t('quotes.subtotal')}</dt>
          <dd>
            <Price value={q.subtotal} onRequest={false} />
          </dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-gray-500">{t('quotes.vat', { rate: Number(q.vatRate) })}</dt>
          <dd>
            <Price value={q.vatAmount} onRequest={false} bare />
          </dd>
        </div>
        <div className="flex justify-between text-base font-semibold">
          <dt>{t('quotes.total')}</dt>
          <dd>
            <Price value={q.total} onRequest={false} includesVat />
          </dd>
        </div>
      </dl>
      {(q.deliveryTerms || q.notes) && (
        <div className="mt-3 space-y-1 text-xs text-gray-600" dir="auto">
          {q.deliveryTerms && (
            <p>
              {t('quotes.deliveryTerms')}: {q.deliveryTerms}
            </p>
          )}
          {q.notes && <p className="whitespace-pre-line">{q.notes}</p>}
        </div>
      )}
    </div>
  );
}

interface LineDraft {
  label: string;
  quantity: string;
  unitPrice: string;
}

function IssueModal({
  request,
  onClose,
}: {
  request: QuotationRequestRow | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  const title = useListingTitle();
  const [lines, setLines] = useState<LineDraft[]>([]);
  const [vatRate, setVatRate] = useState('');
  const [validUntil, setValidUntil] = useState('');
  const [deliveryTerms, setDeliveryTerms] = useState('');
  const [notes, setNotes] = useState('');
  const [openedFor, setOpenedFor] = useState<string | null>(null);

  if (request && openedFor !== request.id) {
    setOpenedFor(request.id);
    setLines([
      {
        label: title(request.listing.title),
        quantity: String(request.quantity),
        unitPrice: request.listing.price ? String(Number(request.listing.price)) : '',
      },
    ]);
    setVatRate('');
    setValidUntil('');
    setDeliveryTerms('');
    setNotes('');
  }

  const issue = useMutation({
    mutationFn: () =>
      api(`/supplier/quotation-requests/${request!.id}/quotations`, {
        method: 'POST',
        org: true,
        body: {
          lines: lines.map((l) => ({
            label: l.label.trim(),
            quantity: Number(l.quantity),
            unitPrice: l.unitPrice.trim(),
          })),
          vatRate: vatRate.trim(),
          validUntil,
          deliveryTerms: deliveryTerms.trim() || undefined,
          notes: notes.trim() || undefined,
        },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['supplier-quotations'] });
      onClose();
    },
  });

  let preview: ReturnType<typeof computeQuotationTotals> | null = null;
  try {
    if (vatRate && lines.every((l) => l.label && l.unitPrice && Number(l.quantity) >= 1)) {
      preview = computeQuotationTotals(
        lines.map((l) => ({
          label: l.label,
          quantity: Number(l.quantity),
          unitPrice: l.unitPrice,
        })),
        vatRate,
      );
    }
  } catch {
    preview = null;
  }
  const update = (i: number, patch: Partial<LineDraft>) =>
    setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  function submit(e: FormEvent) {
    e.preventDefault();
    issue.mutate();
  }

  return (
    <Modal
      open={!!request}
      title={t('quotes.issueTitle', { reference: request?.reference ?? '' })}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" form="issue-form" loading={issue.isPending}>
            {t('quotes.send')}
          </Button>
        </>
      }
    >
      <form id="issue-form" onSubmit={submit} className="space-y-4">
        {issue.isError && <Alert tone="danger">{errorMessage(issue.error)}</Alert>}
        {lines.map((l, i) => (
          <div key={i} className="grid grid-cols-[1fr_80px_140px_auto] items-end gap-2">
            <TextInput
              label={i === 0 ? t('quotes.line') : ''}
              aria-label={t('quotes.line')}
              value={l.label}
              onChange={(e) => update(i, { label: e.target.value })}
              required
              maxLength={200}
            />
            <TextInput
              label={i === 0 ? t('market.quantity') : ''}
              aria-label={t('market.quantity')}
              type="number"
              min={1}
              value={l.quantity}
              onChange={(e) => update(i, { quantity: e.target.value })}
              required
              dir="ltr"
            />
            <TextInput
              label={i === 0 ? t('quotes.unitPriceHt') : ''}
              aria-label={t('quotes.unitPriceHt')}
              value={l.unitPrice}
              onChange={(e) => update(i, { unitPrice: e.target.value.replace(/[^\d.]/g, '') })}
              required
              inputMode="decimal"
              dir="ltr"
            />
            <button
              type="button"
              disabled={lines.length === 1}
              onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}
              className="mb-2 text-xs text-danger-600 disabled:opacity-30"
            >
              {t('common.remove')}
            </button>
          </div>
        ))}
        <Button
          type="button"
          variant="ghost"
          onClick={() => setLines((ls) => [...ls, { label: '', quantity: '1', unitPrice: '' }])}
          disabled={lines.length >= 50}
        >
          {t('quotes.addLine')}
        </Button>
        <div className="grid grid-cols-2 gap-4">
          <TextInput
            label={t('quotes.vatRate')}
            hint={t('quotes.vatRateHint')}
            value={vatRate}
            onChange={(e) => setVatRate(e.target.value.replace(/[^\d.]/g, ''))}
            required
            inputMode="decimal"
            dir="ltr"
          />
          <TextInput
            label={t('quotes.validUntilLabel')}
            type="date"
            value={validUntil}
            onChange={(e) => setValidUntil(e.target.value)}
            required
            min={new Date().toISOString().slice(0, 10)}
            dir="ltr"
          />
        </div>
        <TextInput
          label={t('quotes.deliveryTerms')}
          value={deliveryTerms}
          onChange={(e) => setDeliveryTerms(e.target.value)}
          maxLength={1000}
        />
        <label className="block space-y-1">
          <span className="block text-sm font-semibold text-gray-800">{t('quotes.notes')}</span>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            maxLength={2000}
            className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            dir="auto"
          />
        </label>
        {preview && (
          <dl className="space-y-1 rounded-lg bg-gray-50 p-3 text-sm">
            <div className="flex justify-between">
              <dt>{t('quotes.subtotal')}</dt>
              <dd>
                <Price value={preview.subtotal} onRequest={false} />
              </dd>
            </div>
            <div className="flex justify-between">
              <dt>{t('quotes.vat', { rate: Number(vatRate) })}</dt>
              <dd>
                <Price value={preview.vatAmount} onRequest={false} bare />
              </dd>
            </div>
            <div className="flex justify-between font-semibold">
              <dt>{t('quotes.total')}</dt>
              <dd>
                <Price value={preview.total} onRequest={false} includesVat />
              </dd>
            </div>
          </dl>
        )}
      </form>
    </Modal>
  );
}

export function QuotationsPage() {
  const { t } = useTranslation();
  const { activeOrg } = useAuth();
  const queryClient = useQueryClient();
  const title = useListingTitle();
  const errorMessage = useErrorMessage();
  const isSupplier = activeOrg?.type === 'SUPPLIER';
  const [issuing, setIssuing] = useState<QuotationRequestRow | null>(null);

  const key = isSupplier ? 'supplier-quotations' : 'quotation-requests';
  const rows = useQuery({
    queryKey: [key, activeOrg?.organizationId],
    queryFn: () =>
      api<QuotationRequestRow[]>(
        isSupplier ? '/supplier/quotation-requests' : '/quotation-requests',
        { org: true },
      ),
  });
  const act = useMutation({
    mutationFn: (path: string) => api(path, { method: 'POST', org: true }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [key] }),
  });

  return (
    <>
      <PageHeader
        title={t('quotes.title')}
        subtitle={isSupplier ? t('quotes.subtitleSupplier') : t('quotes.subtitleBusiness')}
      />
      {act.isError && <Alert tone="danger">{errorMessage(act.error)}</Alert>}
      {rows.isLoading ? (
        <Spinner />
      ) : rows.isError ? (
        <Alert tone="danger">{errorMessage(rows.error)}</Alert>
      ) : !rows.data?.length ? (
        <EmptyState>
          {isSupplier ? (
            t('quotes.emptySupplier')
          ) : (
            <>
              {t('quotes.emptyBusiness')}{' '}
              <Link to="/marketplace" className="text-primary-600 hover:underline">
                {t('nav.marketplace')}
              </Link>
            </>
          )}
        </EmptyState>
      ) : (
        <div className="space-y-4">
          {rows.data.map((r) => {
            const open = r.quotations.find((q) => q.status === 'ISSUED');
            return (
              <Card
                key={r.id}
                title={
                  <span className="flex flex-wrap items-center gap-2">
                    <Link to={`/marketplace/${r.listing.reference}`} className="hover:underline">
                      {title(r.listing.title)}
                    </Link>
                    <Badge tone={REQUEST_TONE[r.status]}>{t(`requestStatus.${r.status}`)}</Badge>
                  </span>
                }
                actions={
                  <span className="text-xs text-gray-500">
                    {r.reference} · {formatDate(r.createdAt)}
                  </span>
                }
              >
                <div className="mb-4 grid gap-1 text-sm text-gray-700">
                  {isSupplier ? (
                    <p>{t('quotes.from', { business: r.businessName, person: r.requesterName })}</p>
                  ) : (
                    <p>{t('quotes.to', { supplier: r.listing.organization?.legalName ?? '' })}</p>
                  )}
                  <p>
                    {t('market.quantity')}: {r.quantity}
                    {r.deliveryWilaya
                      ? ` · ${t('market.deliveryWilaya')}: ${r.deliveryWilaya}`
                      : ''}
                  </p>
                  {r.message && (
                    <p
                      className="whitespace-pre-line rounded bg-gray-50 p-2 text-gray-600"
                      dir="auto"
                    >
                      {r.message}
                    </p>
                  )}
                </div>
                <div className="space-y-3">
                  {r.quotations.map((q) => (
                    <QuotationView key={q.id} q={q} />
                  ))}
                </div>
                <div className="mt-4 flex flex-wrap justify-end gap-2">
                  {isSupplier && ['OPEN', 'QUOTED'].includes(r.status) && (
                    <>
                      {open && (
                        <Button
                          variant="secondary"
                          onClick={() =>
                            act.mutate(
                              `/supplier/quotation-requests/quotations/${open.id}/withdraw`,
                            )
                          }
                        >
                          {t('quotes.withdraw')}
                        </Button>
                      )}
                      <Button onClick={() => setIssuing(r)}>
                        {open ? t('quotes.revise') : t('quotes.issue')}
                      </Button>
                    </>
                  )}
                  {!isSupplier && open && r.status !== 'CANCELLED' && (
                    <>
                      <Button
                        variant="secondary"
                        onClick={() =>
                          act.mutate(`/quotation-requests/quotations/${open.id}/decline`)
                        }
                      >
                        {t('quotes.decline')}
                      </Button>
                      <Button
                        variant="accent"
                        onClick={() =>
                          act.mutate(`/quotation-requests/quotations/${open.id}/accept`)
                        }
                      >
                        {t('quotes.accept')}
                      </Button>
                    </>
                  )}
                  {!isSupplier && ['OPEN', 'QUOTED'].includes(r.status) && (
                    <Button
                      variant="ghost"
                      onClick={() => act.mutate(`/quotation-requests/${r.id}/cancel`)}
                    >
                      {t('quotes.cancelRequest')}
                    </Button>
                  )}
                </div>
                {!isSupplier &&
                  r.status === 'CLOSED' &&
                  (() => {
                    const accepted = r.quotations.find((q) => q.status === 'ACCEPTED');
                    return accepted ? (
                      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded bg-primary-50 p-3">
                        <p className="text-xs text-gray-700">{t('quotes.acceptedNext')}</p>
                        <Link
                          to={`/app/financing/new?quotation=${accepted.id}`}
                          className="rounded-lg bg-primary-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-primary-900"
                        >
                          {t('quotes.requestFinancing')}
                        </Link>
                      </div>
                    ) : null;
                  })()}
              </Card>
            );
          })}
        </div>
      )}
      {isSupplier && <IssueModal request={issuing} onClose={() => setIssuing(null)} />}
    </>
  );
}
