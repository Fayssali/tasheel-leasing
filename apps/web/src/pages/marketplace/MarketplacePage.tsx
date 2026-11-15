import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { ListingCardView, Pagination } from '../../components/marketplace';
import { PublicLayout } from '../../components/PublicLayout';
import { Alert, Button, EmptyState, SelectInput, Spinner, TextInput } from '../../components/ui';
import { api } from '../../lib/api';
import { useErrorMessage, useLocalizedName } from '../../lib/format';
import type { Category, SearchResult } from '../../lib/types';

const FILTER_KEYS = [
  'q',
  'category',
  'condition',
  'wilaya',
  'minPrice',
  'maxPrice',
  'sort',
  'page',
] as const;

export function MarketplacePage() {
  const { t } = useTranslation();
  const localized = useLocalizedName();
  const errorMessage = useErrorMessage();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState(params.get('q') ?? '');
  const [minPrice, setMinPrice] = useState(params.get('minPrice') ?? '');
  const [maxPrice, setMaxPrice] = useState(params.get('maxPrice') ?? '');
  useEffect(() => setQ(params.get('q') ?? ''), [params]);

  const query = Object.fromEntries(FILTER_KEYS.map((k) => [k, params.get(k) ?? undefined]));
  const categories = useQuery({
    queryKey: ['categories'],
    queryFn: () => api<Category[]>('/marketplace/categories'),
    staleTime: 300_000,
  });
  const results = useQuery({
    queryKey: ['search', query],
    queryFn: () => api<SearchResult>('/marketplace/listings', { query }),
    placeholderData: keepPreviousData,
  });

  const set = (patch: Record<string, string | undefined>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    if (!('page' in patch)) next.delete('page');
    setParams(next);
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    set({
      q: q.trim() || undefined,
      minPrice: minPrice.trim() || undefined,
      maxPrice: maxPrice.trim() || undefined,
    });
  };
  const active = params.get('category');

  return (
    <PublicLayout>
      <section className="bg-primary-900 pb-8 text-white">
        <div className="mx-auto max-w-7xl px-6">
          <h1 className="text-2xl font-semibold text-start">{t('market.title')}</h1>
          <p className="mt-1 text-sm text-white/70 text-start">{t('market.subtitle')}</p>
          <form onSubmit={submit} className="mt-5 flex gap-2">
            <input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t('market.searchPlaceholder')}
              aria-label={t('market.searchPlaceholder')}
              className="w-full rounded-lg border-0 bg-white px-4 py-3 text-gray-900 placeholder:text-gray-400 focus:ring-2 focus:ring-accent-500"
            />
            <Button type="submit" variant="accent" className="px-6">
              {t('common.search')}
            </Button>
          </form>
        </div>
      </section>

      <div className="mx-auto grid max-w-7xl gap-6 px-6 py-8 lg:grid-cols-[260px_1fr]">
        <aside className="space-y-6">
          <div>
            <h2 className="mb-2 text-sm font-semibold text-gray-900 text-start">
              {t('market.categories')}
            </h2>
            <ul className="space-y-1 text-sm">
              <li>
                <button
                  onClick={() => set({ category: undefined })}
                  className={`w-full rounded px-2 py-1.5 text-start ${!active ? 'bg-primary-50 font-semibold text-primary-600' : 'hover:bg-gray-100'}`}
                >
                  {t('common.all')}
                </button>
              </li>
              {(categories.data ?? []).map((c) => (
                <li key={c.id}>
                  <button
                    onClick={() => set({ category: c.code })}
                    className={`flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-start ${active === c.code ? 'bg-primary-50 font-semibold text-primary-600' : 'hover:bg-gray-100'}`}
                  >
                    <span>{localized(c.name)}</span>
                    <span className="text-xs tabular-nums text-gray-400">{c.listingCount}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
          <form
            onSubmit={submit}
            className="space-y-4 rounded-lg border border-gray-200 bg-white p-4"
          >
            <SelectInput
              label={t('market.filterCondition')}
              value={params.get('condition') ?? ''}
              onChange={(e) => set({ condition: e.target.value || undefined })}
              options={[
                { value: '', label: t('common.all') },
                ...(['NEW', 'USED', 'REFURBISHED'] as const).map((c) => ({
                  value: c,
                  label: t(`market.condition.${c}`),
                })),
              ]}
            />
            <TextInput
              label={t('market.filterWilaya')}
              hint={t('fields.wilayaHint')}
              value={params.get('wilaya') ?? ''}
              onChange={(e) =>
                set({ wilaya: /^\d{2}$/.test(e.target.value) ? e.target.value : undefined })
              }
              maxLength={2}
              inputMode="numeric"
              dir="ltr"
            />
            <div className="grid grid-cols-2 gap-2">
              <TextInput
                label={t('market.minPrice')}
                value={minPrice}
                onChange={(e) => setMinPrice(e.target.value.replace(/[^\d]/g, ''))}
                inputMode="numeric"
                dir="ltr"
              />
              <TextInput
                label={t('market.maxPrice')}
                value={maxPrice}
                onChange={(e) => setMaxPrice(e.target.value.replace(/[^\d]/g, ''))}
                inputMode="numeric"
                dir="ltr"
              />
            </div>
            <Button type="submit" variant="secondary" className="w-full">
              {t('market.applyFilters')}
            </Button>
          </form>
        </aside>

        <section>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-gray-600">
              {results.data ? t('market.resultCount', { count: results.data.total }) : ' '}
            </p>
            <label className="flex items-center gap-2 text-sm">
              <span className="text-gray-600">{t('market.sort')}</span>
              <select
                className="rounded border border-gray-300 px-2 py-1.5"
                value={params.get('sort') ?? ''}
                onChange={(e) => set({ sort: e.target.value || undefined })}
              >
                <option value="">
                  {params.get('q') ? t('market.sortRelevance') : t('market.sortNewest')}
                </option>
                <option value="newest">{t('market.sortNewest')}</option>
                <option value="price_asc">{t('market.sortPriceAsc')}</option>
                <option value="price_desc">{t('market.sortPriceDesc')}</option>
              </select>
            </label>
          </div>
          {results.isLoading ? (
            <Spinner />
          ) : results.isError ? (
            <Alert tone="danger">{errorMessage(results.error)}</Alert>
          ) : results.data && results.data.items.length === 0 ? (
            <EmptyState>{t('market.noResults')}</EmptyState>
          ) : (
            <>
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {results.data?.items.map((item) => (
                  <ListingCardView key={item.id} item={item} />
                ))}
              </div>
              {results.data && (
                <Pagination
                  page={results.data.page}
                  pageSize={results.data.pageSize}
                  total={results.data.total}
                  onPage={(p) => set({ page: String(p) })}
                />
              )}
            </>
          )}
        </section>
      </div>
    </PublicLayout>
  );
}
