import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation, useParams } from 'react-router';
import {
  ConditionBadge,
  Price,
  publicImageUrl,
  useListingTitle,
} from '../../components/marketplace';
import { PublicLayout } from '../../components/PublicLayout';
import { Alert, Button, Card, Modal, Spinner, TextInput } from '../../components/ui';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useErrorMessage, useLocalizedName } from '../../lib/format';
import type { ListingDetail } from '../../lib/types';

const API = import.meta.env.VITE_API_URL ?? '/api/v1';

export function ListingPage() {
  const { t, i18n } = useTranslation();
  const { reference = '' } = useParams();
  const location = useLocation();
  const { status, activeOrg } = useAuth();
  const queryClient = useQueryClient();
  const title = useListingTitle();
  const localized = useLocalizedName();
  const errorMessage = useErrorMessage();
  const [imageIndex, setImageIndex] = useState(0);
  const [quoteOpen, setQuoteOpen] = useState(false);
  const [quantity, setQuantity] = useState('1');
  const [message, setMessage] = useState('');
  const [wilaya, setWilaya] = useState('');
  const [sentRef, setSentRef] = useState<string | null>(null);

  const listing = useQuery({
    queryKey: ['listing', reference],
    queryFn: () => api<ListingDetail>(`/marketplace/listings/${reference}`),
  });
  const isBusiness = status === 'authenticated' && activeOrg?.type === 'BUSINESS';
  const favourites = useQuery({
    queryKey: ['favourites', activeOrg?.organizationId],
    queryFn: () => api<Array<{ listing: { id: string } }>>('/favourites', { org: true }),
    enabled: isBusiness,
  });
  const isFavourite =
    !!listing.data && (favourites.data ?? []).some((f) => f.listing.id === listing.data!.id);

  const toggleFavourite = useMutation({
    mutationFn: () =>
      isFavourite
        ? api(`/favourites/${listing.data!.id}`, { method: 'DELETE', org: true })
        : api('/favourites', { method: 'POST', org: true, body: { listingId: listing.data!.id } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['favourites'] }),
  });
  const requestQuote = useMutation({
    mutationFn: () =>
      api<{ reference: string }>('/quotation-requests', {
        method: 'POST',
        org: true,
        body: {
          listingId: listing.data!.id,
          quantity: Number(quantity),
          message: message.trim() || undefined,
          deliveryWilaya: wilaya || undefined,
        },
      }),
    onSuccess: (res) => {
      setSentRef(res.reference);
      setQuoteOpen(false);
      void queryClient.invalidateQueries({ queryKey: ['quotation-requests'] });
    },
  });

  if (listing.isLoading)
    return (
      <PublicLayout>
        <div className="p-10">
          <Spinner />
        </div>
      </PublicLayout>
    );
  if (listing.isError || !listing.data)
    return (
      <PublicLayout>
        <div className="mx-auto max-w-3xl p-10">
          <Alert tone="danger">{errorMessage(listing.error)}</Alert>
        </div>
      </PublicLayout>
    );

  const l = listing.data;
  const description =
    i18n.language === 'ar'
      ? l.description.ar || l.description.fr
      : l.description.fr || l.description.ar;
  const specRows = l.category.specSchema.filter(
    (f) => l.specs[f.key] !== undefined && l.specs[f.key] !== '',
  );
  const specValue = (key: string) => {
    const field = l.category.specSchema.find((f) => f.key === key)!;
    const raw = l.specs[key];
    if (field.type === 'select')
      return localized(field.options?.find((o) => o.value === raw)?.label) || String(raw);
    return `${raw}${field.unit ? ` ${field.unit}` : ''}`;
  };
  const mainImage = l.images[imageIndex] ?? l.images[0];

  const details: Array<[string, string]> = [
    [t('market.reference'), l.reference],
    [t('market.brandModel'), [l.brand, l.model].filter(Boolean).join(' ') || '—'],
    [t('market.year'), l.year ? String(l.year) : '—'],
    [t('market.availabilityLabel'), t(`market.availability.${l.availability}`)],
    [
      t('market.leadTime'),
      l.leadTimeDays !== null ? t('market.days', { count: l.leadTimeDays }) : '—',
    ],
    [
      t('market.warranty'),
      l.warrantyMonths ? t('market.months', { count: l.warrantyMonths }) : '—',
    ],
    [
      t('market.delivery'),
      l.deliveryWilayas.length ? l.deliveryWilayas.join(', ') : t('market.nationwide'),
    ],
  ];

  function submitQuote(e: FormEvent) {
    e.preventDefault();
    requestQuote.mutate();
  }

  return (
    <PublicLayout>
      <div className="mx-auto max-w-7xl px-6 py-8">
        <nav className="mb-4 text-sm text-gray-500">
          <Link to="/marketplace" className="hover:underline">
            {t('nav.marketplace')}
          </Link>{' '}
          /{' '}
          <Link to={`/marketplace?category=${l.category.code}`} className="hover:underline">
            {localized(l.category.name)}
          </Link>
        </nav>

        <div className="grid gap-8 lg:grid-cols-[1.3fr_1fr]">
          <div>
            <div className="aspect-[4/3] overflow-hidden rounded-lg border border-gray-200 bg-white">
              {mainImage ? (
                <img
                  src={publicImageUrl(mainImage.id)}
                  alt={title(l.title)}
                  className="h-full w-full object-contain"
                />
              ) : null}
            </div>
            {l.images.length > 1 && (
              <div className="mt-3 flex gap-2 overflow-x-auto">
                {l.images.map((img, i) => (
                  <button
                    key={img.id}
                    onClick={() => setImageIndex(i)}
                    className={`h-16 w-20 shrink-0 overflow-hidden rounded border ${i === imageIndex ? 'border-primary-600 ring-2 ring-primary-600/20' : 'border-gray-200'}`}
                  >
                    <img
                      src={publicImageUrl(img.id)}
                      alt=""
                      className="h-full w-full object-cover"
                    />
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="space-y-5">
            <div>
              <div className="mb-2 flex items-center gap-2">
                <ConditionBadge condition={l.condition} />
                <span className="text-xs text-gray-500">{l.reference}</span>
              </div>
              <h1 className="text-2xl font-semibold text-primary-900 text-start">
                {title(l.title)}
              </h1>
              <Price
                value={l.price}
                onRequest={l.priceOnRequest}
                includesVat={l.priceIncludesVat}
                className="mt-3 block text-2xl font-semibold text-primary-900"
              />
            </div>

            {sentRef && (
              <Alert tone="success" title={t('market.quoteSentTitle')}>
                {t('market.quoteSentBody', { reference: sentRef })}
              </Alert>
            )}

            <div className="space-y-2">
              {isBusiness ? (
                <>
                  <Button
                    variant="accent"
                    className="w-full"
                    onClick={() => setQuoteOpen(true)}
                    disabled={activeOrg?.status !== 'VERIFIED'}
                  >
                    {t('market.requestQuote')}
                  </Button>
                  {activeOrg?.status !== 'VERIFIED' && (
                    <p className="text-xs text-warning-600">{t('market.verifiedOnly')}</p>
                  )}
                  <Button
                    variant="secondary"
                    className="w-full"
                    loading={toggleFavourite.isPending}
                    onClick={() => toggleFavourite.mutate()}
                  >
                    {isFavourite ? t('market.removeFavourite') : t('market.addFavourite')}
                  </Button>
                </>
              ) : status === 'authenticated' ? (
                <p className="text-sm text-gray-600">{t('market.businessOnly')}</p>
              ) : (
                <Link
                  to={`/login?redirect=${encodeURIComponent(location.pathname)}`}
                  className="block rounded-lg bg-accent-500 px-4 py-2.5 text-center font-semibold text-primary-900 hover:brightness-95"
                >
                  {t('market.signInToQuote')}
                </Link>
              )}
              <Button variant="ghost" className="w-full" disabled title={t('market.financingSoon')}>
                {t('market.requestFinancing')} · {t('market.soon')}
              </Button>
            </div>

            <Card title={t('market.supplier')}>
              <Link
                to={`/marketplace/suppliers/${l.organization.id}`}
                className="font-semibold text-primary-600 hover:underline"
              >
                {l.organization.tradeName || l.organization.legalName}
              </Link>
              <p className="mt-1 text-xs text-gray-500">
                {t('market.verifiedSupplier')}
                {l.organization.wilayaCode
                  ? ` · ${t('fields.wilayaCode')} ${l.organization.wilayaCode}`
                  : ''}
              </p>
            </Card>
          </div>
        </div>

        <div className="mt-8 grid gap-6 lg:grid-cols-[1.3fr_1fr]">
          <div className="space-y-6">
            {description && (
              <Card title={t('market.description')}>
                <p className="whitespace-pre-line text-sm leading-relaxed text-gray-700" dir="auto">
                  {description}
                </p>
              </Card>
            )}
            {specRows.length > 0 && (
              <Card title={t('market.specifications')}>
                <dl className="divide-y divide-gray-100 text-sm">
                  {specRows.map((f) => (
                    <div key={f.key} className="flex justify-between gap-4 py-2">
                      <dt className="text-gray-500">{localized(f.label)}</dt>
                      <dd className="font-semibold" dir="auto">
                        {specValue(f.key)}
                      </dd>
                    </div>
                  ))}
                </dl>
              </Card>
            )}
          </div>
          <div className="space-y-6">
            <Card title={t('market.details')}>
              <dl className="divide-y divide-gray-100 text-sm">
                {details.map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-4 py-2">
                    <dt className="text-gray-500">{k}</dt>
                    <dd className="font-semibold" dir="auto">
                      {v}
                    </dd>
                  </div>
                ))}
              </dl>
            </Card>
            {l.documents.length > 0 && (
              <Card title={t('market.documents')}>
                <ul className="space-y-2 text-sm">
                  {l.documents.map((d) => (
                    <li key={d.id}>
                      <a
                        href={`${API}/marketplace/documents/${d.id}`}
                        className="text-primary-600 hover:underline"
                        dir="auto"
                      >
                        {d.fileName}
                      </a>{' '}
                      <span className="text-xs text-gray-500">
                        ({t('market.sizeKb', { size: Math.ceil(d.sizeBytes / 1024) })})
                      </span>
                    </li>
                  ))}
                </ul>
              </Card>
            )}
          </div>
        </div>
      </div>

      <Modal
        open={quoteOpen}
        title={t('market.requestQuoteTitle')}
        onClose={() => setQuoteOpen(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setQuoteOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" form="quote-form" loading={requestQuote.isPending}>
              {t('market.sendRequest')}
            </Button>
          </>
        }
      >
        <form id="quote-form" onSubmit={submitQuote} className="space-y-4">
          {requestQuote.isError && <Alert tone="danger">{errorMessage(requestQuote.error)}</Alert>}
          <p className="text-sm text-gray-700" dir="auto">
            {title(l.title)}
          </p>
          <div className="grid grid-cols-2 gap-4">
            <TextInput
              label={t('market.quantity')}
              type="number"
              min={1}
              max={10000}
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              required
              dir="ltr"
            />
            <TextInput
              label={t('market.deliveryWilaya')}
              value={wilaya}
              onChange={(e) => setWilaya(e.target.value.replace(/\D/g, '').slice(0, 2))}
              inputMode="numeric"
              dir="ltr"
            />
          </div>
          <label className="block space-y-1">
            <span className="block text-sm font-semibold text-gray-800">{t('market.message')}</span>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={4}
              maxLength={2000}
              className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              dir="auto"
            />
          </label>
          <p className="text-xs text-gray-500">{t('market.shareNotice')}</p>
        </form>
      </Modal>
    </PublicLayout>
  );
}
