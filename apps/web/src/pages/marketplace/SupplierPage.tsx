import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';
import { ListingCardView, Pagination } from '../../components/marketplace';
import { PublicLayout } from '../../components/PublicLayout';
import { Alert, EmptyState, Spinner } from '../../components/ui';
import { api } from '../../lib/api';
import { formatDate, useErrorMessage } from '../../lib/format';
import type { SearchResult } from '../../lib/types';

interface PublicSupplier {
  id: string;
  legalName: string;
  tradeName: string | null;
  wilayaCode: string | null;
  verifiedAt: string | null;
}

export function SupplierPage() {
  const { t } = useTranslation();
  const { id = '' } = useParams();
  const errorMessage = useErrorMessage();
  const [page, setPage] = useState(1);
  const supplier = useQuery({
    queryKey: ['supplier', id],
    queryFn: () => api<PublicSupplier>(`/marketplace/suppliers/${id}`),
  });
  const listings = useQuery({
    queryKey: ['supplier-listings', id, page],
    queryFn: () => api<SearchResult>('/marketplace/listings', { query: { supplierId: id, page } }),
    enabled: supplier.isSuccess,
  });

  return (
    <PublicLayout>
      <div className="mx-auto max-w-7xl px-6 py-8">
        {supplier.isLoading ? (
          <Spinner />
        ) : supplier.isError || !supplier.data ? (
          <Alert tone="danger">{errorMessage(supplier.error)}</Alert>
        ) : (
          <>
            <div className="mb-8 rounded-lg border border-gray-200 bg-white p-6">
              <h1 className="text-2xl font-semibold text-primary-900 text-start">
                {supplier.data.tradeName || supplier.data.legalName}
              </h1>
              {supplier.data.tradeName && (
                <p className="text-sm text-gray-600">{supplier.data.legalName}</p>
              )}
              <p className="mt-2 text-xs text-gray-500">
                {t('market.verifiedSupplierSince', { date: formatDate(supplier.data.verifiedAt) })}
                {supplier.data.wilayaCode
                  ? ` · ${t('fields.wilayaCode')} ${supplier.data.wilayaCode}`
                  : ''}
              </p>
            </div>
            <h2 className="mb-4 text-lg font-semibold text-start">
              {t('market.supplierCatalogue')}
            </h2>
            {listings.data?.items.length === 0 ? (
              <EmptyState>{t('market.noResults')}</EmptyState>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {listings.data?.items.map((item) => (
                  <ListingCardView key={item.id} item={item} />
                ))}
              </div>
            )}
            {listings.data && (
              <Pagination
                page={listings.data.page}
                pageSize={listings.data.pageSize}
                total={listings.data.total}
                onPage={setPage}
              />
            )}
          </>
        )}
      </div>
    </PublicLayout>
  );
}
