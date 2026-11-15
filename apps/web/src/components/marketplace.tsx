import { formatMoney } from '@tasheel/shared';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { getActiveOrg } from '../lib/api';
import { useLocalizedName } from '../lib/format';
import type { ListingCard as Card, LocalizedText } from '../lib/types';
import { Badge } from './ui';

const API = import.meta.env.VITE_API_URL ?? '/api/v1';

export const publicImageUrl = (id: string) => `${API}/marketplace/images/${id}`;

/** Localized listing title, falling back to the other language. */
export function useListingTitle() {
  const { i18n } = useTranslation();
  return (t: LocalizedText | null | undefined) =>
    (i18n.language === 'ar' ? t?.ar || t?.fr : t?.fr || t?.ar) ?? '';
}

export function Price({
  value,
  onRequest,
  includesVat,
  bare,
  className,
}: {
  value: string | null;
  onRequest: boolean;
  includesVat?: boolean;
  /** Amount only, without the HT/TTC suffix. */
  bare?: boolean;
  className?: string;
}) {
  const { t, i18n } = useTranslation();
  if (onRequest || value === null)
    return <span className={className}>{t('market.priceOnRequest')}</span>;
  return (
    <span className={className}>
      <span dir="ltr" className="tabular-nums">
        {formatMoney(value, i18n.language)}
      </span>{' '}
      {!bare && (
        <span className="text-xs font-normal text-gray-500">
          {includesVat ? t('market.ttc') : t('market.ht')}
        </span>
      )}
    </span>
  );
}

const CONDITION_TONE = { NEW: 'success', USED: 'neutral', REFURBISHED: 'info' } as const;

export function ConditionBadge({ condition }: { condition: Card['condition'] }) {
  const { t } = useTranslation();
  return <Badge tone={CONDITION_TONE[condition]}>{t(`market.condition.${condition}`)}</Badge>;
}

export function ListingCardView({ item }: { item: Card }) {
  const { t } = useTranslation();
  const title = useListingTitle();
  const localized = useLocalizedName();
  return (
    <Link
      to={`/marketplace/${item.reference}`}
      className="group flex flex-col overflow-hidden rounded-lg border border-gray-200 bg-white transition hover:border-primary-600 hover:shadow-sm"
    >
      <div className="aspect-[4/3] bg-gray-100">
        {item.coverImageId ? (
          <img
            src={publicImageUrl(item.coverImageId)}
            alt=""
            loading="lazy"
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full items-center justify-center text-xs text-gray-400">
            {t('market.noImage')}
          </div>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-2 p-4">
        <div className="flex items-center justify-between gap-2 text-xs text-gray-500">
          <span>{localized(item.categoryName)}</span>
          <ConditionBadge condition={item.condition} />
        </div>
        <h3 className="line-clamp-2 font-semibold text-gray-900 group-hover:text-primary-600 text-start">
          {title(item.title)}
        </h3>
        {(item.brand || item.model || item.year) && (
          <p className="text-xs text-gray-500" dir="auto">
            {[item.brand, item.model, item.year].filter(Boolean).join(' · ')}
          </p>
        )}
        <Price
          value={item.price}
          onRequest={item.priceOnRequest}
          includesVat={item.priceIncludesVat}
          className="mt-auto text-lg font-semibold text-primary-900"
        />
        <p className="truncate text-xs text-gray-500">{item.supplierName}</p>
      </div>
    </Link>
  );
}

export function Pagination({
  page,
  pageSize,
  total,
  onPage,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPage: (p: number) => void;
}) {
  const { t } = useTranslation();
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
  return (
    <nav
      className="mt-6 flex items-center justify-center gap-3 text-sm"
      aria-label={t('market.pagination')}
    >
      <button
        className="rounded border border-gray-300 px-3 py-1.5 disabled:opacity-40"
        disabled={page <= 1}
        onClick={() => onPage(page - 1)}
      >
        {t('market.previous')}
      </button>
      <span className="tabular-nums text-gray-600">
        {page} / {pages}
      </span>
      <button
        className="rounded border border-gray-300 px-3 py-1.5 disabled:opacity-40"
        disabled={page >= pages}
        onClick={() => onPage(page + 1)}
      >
        {t('market.next')}
      </button>
    </nav>
  );
}

/**
 * Image of a not-yet-published listing: <img> cannot send the Authorization header, so the
 * file is fetched with the session and shown from a blob URL.
 */
export function AuthedImage({
  path,
  token,
  className,
  alt = '',
}: {
  path: string;
  token: string | null;
  className?: string;
  alt?: string;
}) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let url: string | null = null;
    let cancelled = false;
    const org = getActiveOrg();
    void fetch(`${API}${path}`, {
      credentials: 'include',
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(org ? { 'X-Organization-Id': org } : {}),
      },
    })
      .then((r) => (r.ok ? r.blob() : null))
      .then((b) => {
        if (b && !cancelled) {
          url = URL.createObjectURL(b);
          setSrc(url);
        }
      });
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [path, token]);
  return src ? (
    <img src={src} alt={alt} className={className} />
  ) : (
    <div className={`${className ?? ''} animate-pulse bg-gray-100`} />
  );
}
