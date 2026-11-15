import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { Price, publicImageUrl, useListingTitle } from '../../components/marketplace';
import { Alert, EmptyState, PageHeader, Spinner } from '../../components/ui';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useErrorMessage } from '../../lib/format';
import type { LocalizedText } from '../../lib/types';

interface FavouriteRow {
  id: string;
  listing: {
    id: string;
    reference: string;
    title: LocalizedText;
    price: string | null;
    priceOnRequest: boolean;
    organization: { legalName: string };
    images: Array<{ id: string }>;
  };
}

export function FavouritesPage() {
  const { t } = useTranslation();
  const { activeOrg } = useAuth();
  const queryClient = useQueryClient();
  const title = useListingTitle();
  const errorMessage = useErrorMessage();
  const favourites = useQuery({
    queryKey: ['favourites', activeOrg?.organizationId],
    queryFn: () => api<FavouriteRow[]>('/favourites', { org: true }),
  });
  const remove = useMutation({
    mutationFn: (listingId: string) =>
      api(`/favourites/${listingId}`, { method: 'DELETE', org: true }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['favourites'] }),
  });

  return (
    <>
      <PageHeader title={t('favourites.title')} subtitle={t('favourites.subtitle')} />
      {favourites.isLoading ? (
        <Spinner />
      ) : favourites.isError ? (
        <Alert tone="danger">{errorMessage(favourites.error)}</Alert>
      ) : !favourites.data?.length ? (
        <EmptyState>
          {t('favourites.empty')}{' '}
          <Link to="/marketplace" className="text-primary-600 hover:underline">
            {t('nav.marketplace')}
          </Link>
        </EmptyState>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {favourites.data.map(({ id, listing: l }) => (
            <li key={id} className="flex gap-3 rounded-lg border border-gray-200 bg-white p-3">
              <div className="h-20 w-24 shrink-0 overflow-hidden rounded bg-gray-100">
                {l.images[0] && (
                  <img
                    src={publicImageUrl(l.images[0].id)}
                    alt=""
                    className="h-full w-full object-cover"
                  />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <Link
                  to={`/marketplace/${l.reference}`}
                  className="line-clamp-2 font-semibold text-primary-600 hover:underline"
                >
                  {title(l.title)}
                </Link>
                <p className="truncate text-xs text-gray-500">{l.organization.legalName}</p>
                <Price
                  value={l.price}
                  onRequest={l.priceOnRequest}
                  className="text-sm font-semibold"
                />
                <button
                  onClick={() => remove.mutate(l.id)}
                  className="ms-3 text-xs text-danger-600 hover:underline"
                >
                  {t('common.remove')}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
