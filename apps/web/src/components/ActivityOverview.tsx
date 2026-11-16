import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { MonthlyBars, Money, StatTile } from './charts';
import { Spinner } from './ui';

type Series = Array<{ month: string; value: string }>;
type Overview = Record<string, string | number | null | Series> & { kind: string };

const pct = (v: unknown) => (v === null || v === undefined ? '—' : `${v} %`);

/** The organization's own activity, from /reports/overview (RLS-scoped). */
export function ActivityOverview() {
  const { t } = useTranslation();
  const { activeOrg } = useAuth();
  const report = useQuery({
    queryKey: ['overview', activeOrg?.organizationId],
    queryFn: () => api<Overview>('/reports/overview', { org: true }),
  });
  if (report.isLoading) return <Spinner />;
  const r = report.data;
  if (!r || !['SUPPLIER', 'BUSINESS', 'FINANCIAL_INSTITUTION'].includes(r.kind)) return null;
  const n = (k: string) => r[k] as number;

  let tiles: Array<{
    label: string;
    value: React.ReactNode;
    to?: string;
    attention?: boolean;
    hint?: string;
  }> = [];
  let chart: { title: string; series: Series } | null = null;
  if (r.kind === 'SUPPLIER') {
    tiles = [
      {
        label: t('reports.publishedListings'),
        value: n('publishedListings'),
        to: '/app/catalogue',
        hint: t('reports.views', { count: n('views') }),
      },
      {
        label: t('reports.requestsAwaiting'),
        value: n('requestsAwaiting'),
        to: '/app/quotations',
        attention: n('requestsAwaiting') > 0,
        hint: t('reports.ofTotal', { total: n('requestsReceived') }),
      },
      {
        label: t('reports.acceptanceRate'),
        value: pct(r.acceptanceRate),
        hint: t('reports.acceptedOfIssued', {
          accepted: n('quotationsAccepted'),
          issued: n('quotationsIssued'),
        }),
      },
      {
        label: t('reports.acceptedValue'),
        value: <Money value={r.acceptedValue as string} />,
        hint: t('reports.excludingVat'),
      },
      {
        label: t('reports.commissionsAccrued'),
        value: <Money value={r.commissionsAccrued as string} />,
        to: '/app/billing',
      },
      {
        label: t('reports.invoicesDue'),
        value: <Money value={r.invoicesDue as string} />,
        to: '/app/billing',
        attention: Number(r.invoicesDue) > 0,
      },
    ];
    chart = { title: t('reports.requestsByMonth'), series: r.requestsByMonth as Series };
  } else if (r.kind === 'BUSINESS') {
    tiles = [
      { label: t('reports.requestsSent'), value: n('requestsSent'), to: '/app/quotations' },
      {
        label: t('reports.quotationsReceived'),
        value: n('quotationsReceived'),
        hint: t('reports.accepted', { count: n('quotationsAccepted') }),
      },
      {
        label: t('reports.applicationsSubmitted'),
        value: n('applicationsSubmitted'),
        to: '/app/financing',
        hint: t('reports.drafts', { count: n('applicationsDraft') }),
      },
      {
        label: t('reports.offersReceived'),
        value: n('offersReceived'),
        to: '/app/financing',
        hint: t('reports.accepted', { count: n('offersAccepted') }),
      },
      { label: t('reports.financedAmount'), value: <Money value={r.financedAmount as string} /> },
    ];
  } else {
    tiles = [
      {
        label: t('reports.toReview'),
        value: n('toReview'),
        to: '/app/financing/inbox',
        attention: n('toReview') > 0,
        hint: t('reports.ofTotal', { total: n('received') }),
      },
      {
        label: t('reports.offerAcceptance'),
        value: pct(r.acceptanceRate),
        hint: t('reports.acceptedOfIssued', {
          accepted: n('offersAccepted'),
          issued: n('offersIssued'),
        }),
      },
      {
        label: t('reports.avgHoursToOffer'),
        value: r.avgHoursToFirstOffer
          ? t('reports.hours', { count: Number(r.avgHoursToFirstOffer) })
          : '—',
      },
      { label: t('reports.financedVolume'), value: <Money value={r.financedVolume as string} /> },
      {
        label: t('reports.commissionsAccrued'),
        value: <Money value={r.commissionsAccrued as string} />,
        to: '/app/billing',
      },
      {
        label: t('reports.invoicesDue'),
        value: <Money value={r.invoicesDue as string} />,
        to: '/app/billing',
        attention: Number(r.invoicesDue) > 0,
      },
    ];
    chart = { title: t('reports.receivedByMonth'), series: r.receivedByMonth as Series };
  }

  return (
    <section className="mt-6">
      <h2 className="mb-3 text-lg font-semibold text-start">{t('reports.activity')}</h2>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {tiles.map((tile) => (
          <StatTile
            key={tile.label}
            label={tile.label}
            value={tile.value}
            hint={tile.hint}
            to={tile.to}
            tone={tile.attention ? 'attention' : 'default'}
          />
        ))}
      </div>
      {chart && (
        <div className="mt-4 max-w-xl">
          <MonthlyBars title={chart.title} series={chart.series} />
        </div>
      )}
    </section>
  );
}
