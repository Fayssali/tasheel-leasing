import { formatMoney } from '@tasheel/shared';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

/** A single headline figure. */
export function StatTile({
  label,
  value,
  hint,
  to,
  tone = 'default',
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  to?: string;
  tone?: 'default' | 'attention';
}) {
  const body = (
    <div
      className={`h-full rounded-lg border bg-white p-4 ${tone === 'attention' ? 'border-warning-600' : 'border-gray-200'}`}
    >
      <p className="text-sm text-gray-600">{label}</p>
      <p
        className={`mt-1 text-2xl font-semibold tabular-nums ${tone === 'attention' ? 'text-warning-600' : 'text-primary-900'}`}
        dir="ltr"
      >
        {value}
      </p>
      {hint && <p className="mt-1 text-xs text-gray-500">{hint}</p>}
    </div>
  );
  return to ? (
    <Link to={to} className="block h-full hover:opacity-90">
      {body}
    </Link>
  ) : (
    body
  );
}

export function Money({ value }: { value: string | number | null | undefined }) {
  const { i18n } = useTranslation();
  return <>{formatMoney(String(value ?? '0'), i18n.language)}</>;
}

/**
 * Six months of one measure as bars: one hue (single series, so no legend; the title names it),
 * thin bars with rounded data-ends on a recessive baseline, a 2px gap, a hover tooltip per bar,
 * and the same figures in a table for screen readers.
 */
export function MonthlyBars({
  title,
  series,
  money = false,
}: {
  title: string;
  series: Array<{ month: string; value: string }>;
  money?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const [hover, setHover] = useState<number | null>(null);
  const values = series.map((s) => Number(s.value));
  const max = Math.max(...values, 0);
  const label = (m: string) => {
    const d = new Date(`${m.slice(0, 7)}-01T00:00:00Z`);
    return Number.isNaN(d.getTime())
      ? m
      : new Intl.DateTimeFormat(i18n.language === 'ar' ? 'ar-DZ' : i18n.language, {
          month: 'short',
          timeZone: 'UTC',
        }).format(d);
  };
  const display = (v: string) =>
    money
      ? formatMoney(v, i18n.language)
      : Number(v).toLocaleString(i18n.language === 'ar' ? 'ar-DZ' : i18n.language);
  return (
    <figure className="rounded-lg border border-gray-200 bg-white p-4">
      <figcaption className="mb-3 text-sm font-semibold text-gray-900 text-start">
        {title}
      </figcaption>
      {max === 0 ? (
        <p className="py-8 text-center text-sm text-gray-500">{t('reports.noActivity')}</p>
      ) : (
        <div className="relative" onMouseLeave={() => setHover(null)}>
          <div
            className="flex h-32 items-end gap-[2px] border-b border-gray-200"
            dir="ltr"
            aria-hidden
          >
            {series.map((s, i) => (
              <div
                key={s.month}
                className="flex h-full flex-1 items-end"
                onMouseEnter={() => setHover(i)}
              >
                <div
                  className={`mx-auto w-3/5 rounded-t-[4px] ${hover === i ? 'bg-primary-900' : 'bg-primary-600'}`}
                  style={{
                    height: `${max ? Math.max((values[i]! / max) * 100, values[i]! > 0 ? 2 : 0) : 0}%`,
                  }}
                />
              </div>
            ))}
          </div>
          <div className="mt-1 flex text-[11px] text-gray-500" dir="ltr" aria-hidden>
            {series.map((s) => (
              <span key={s.month} className="flex-1 text-center">
                {label(s.month)}
              </span>
            ))}
          </div>
          {hover !== null && (
            <div
              className="pointer-events-none absolute -top-2 z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded bg-gray-900 px-2 py-1 text-xs text-white shadow"
              style={{ left: `${((hover + 0.5) / series.length) * 100}%` }}
              role="status"
            >
              {label(series[hover]!.month)} · {display(series[hover]!.value)}
            </div>
          )}
        </div>
      )}
      <table className="sr-only">
        <caption>{title}</caption>
        <tbody>
          {series.map((s) => (
            <tr key={s.month}>
              <th scope="row">{s.month}</th>
              <td>{display(s.value)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
