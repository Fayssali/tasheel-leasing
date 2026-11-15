import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';
import { AuthedImage, Price, useListingTitle } from '../../components/marketplace';
import { Alert, Badge, EmptyState, PageHeader, Spinner, Table, Td } from '../../components/ui';
import { api, getAccessToken } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { formatDate, useErrorMessage, useLocalizedName } from '../../lib/format';
import type { ListingStatus, SupplierListing } from '../../lib/types';

const STATUS_TONE: Record<ListingStatus, 'neutral' | 'action' | 'success' | 'danger' | 'info'> = {
  DRAFT: 'neutral',
  PENDING_REVIEW: 'action',
  PUBLISHED: 'success',
  ARCHIVED: 'neutral',
  REJECTED: 'danger',
};

export function ListingStatusBadge({ status }: { status: ListingStatus }) {
  const { t } = useTranslation();
  return <Badge tone={STATUS_TONE[status]}>{t(`listingStatus.${status}`)}</Badge>;
}

const FILTERS: Array<ListingStatus | ''> = [
  '',
  'DRAFT',
  'PENDING_REVIEW',
  'PUBLISHED',
  'REJECTED',
  'ARCHIVED',
];

export function SupplierListingsPage() {
  const { t } = useTranslation();
  const { activeOrg } = useAuth();
  const title = useListingTitle();
  const localized = useLocalizedName();
  const errorMessage = useErrorMessage();
  const [params, setParams] = useSearchParams();
  const status = params.get('status') ?? '';
  const listings = useQuery({
    queryKey: ['supplier-listings', activeOrg?.organizationId, status],
    queryFn: () =>
      api<Array<SupplierListing & { category: { name: Record<string, string> } }>>(
        '/supplier/listings',
        { org: true, query: { status } },
      ),
  });

  return (
    <>
      <PageHeader
        title={t('catalogue.title')}
        subtitle={t('catalogue.subtitle')}
        actions={
          <Link
            to="/app/catalogue/new"
            className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white hover:bg-primary-900"
          >
            {t('catalogue.new')}
          </Link>
        }
      />
      {activeOrg?.status !== 'VERIFIED' && (
        <Alert tone="action" title={t('catalogue.notVerifiedTitle')}>
          {t('catalogue.notVerifiedBody')}
        </Alert>
      )}
      <div className="my-4 flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button
            key={f || 'all'}
            onClick={() => setParams(f ? { status: f } : {})}
            className={`rounded-full border px-3 py-1 text-sm ${status === f ? 'border-primary-600 bg-primary-50 font-semibold text-primary-600' : 'border-gray-300 bg-white'}`}
          >
            {f ? t(`listingStatus.${f}`) : t('common.all')}
          </button>
        ))}
      </div>
      {listings.isLoading ? (
        <Spinner />
      ) : listings.isError ? (
        <Alert tone="danger">{errorMessage(listings.error)}</Alert>
      ) : !listings.data?.length ? (
        <EmptyState>{t('catalogue.empty')}</EmptyState>
      ) : (
        <Table
          head={[
            '',
            t('catalogue.colTitle'),
            t('catalogue.colCategory'),
            t('catalogue.colPrice'),
            t('catalogue.colStatus'),
            t('catalogue.colStats'),
            t('catalogue.colUpdated'),
          ]}
        >
          {listings.data.map((l) => (
            <tr key={l.id} className="hover:bg-gray-50">
              <Td>
                {l.images[0] ? (
                  <AuthedImage
                    path={`/supplier/listings/${l.id}/images/${l.images[0].id}`}
                    token={getAccessToken()}
                    className="h-12 w-16 rounded object-cover"
                  />
                ) : (
                  <div className="h-12 w-16 rounded bg-gray-100" />
                )}
              </Td>
              <Td>
                <Link
                  to={`/app/catalogue/${l.id}`}
                  className="font-semibold text-primary-600 hover:underline"
                >
                  {title(l.title) || t('catalogue.untitled')}
                </Link>
                <div className="text-xs text-gray-500">{l.reference}</div>
              </Td>
              <Td>{localized(l.category.name)}</Td>
              <Td>
                <Price
                  value={l.price}
                  onRequest={l.priceOnRequest}
                  includesVat={l.priceIncludesVat}
                />
              </Td>
              <Td>
                <ListingStatusBadge status={l.status} />
              </Td>
              <Td className="text-xs text-gray-600">
                {t('catalogue.stats', {
                  views: l.viewCount,
                  requests: l._count?.quotationRequests ?? 0,
                })}
              </Td>
              <Td className="text-xs text-gray-600">{formatDate(l.updatedAt)}</Td>
            </tr>
          ))}
        </Table>
      )}
    </>
  );
}
