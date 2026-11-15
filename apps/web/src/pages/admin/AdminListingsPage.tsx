import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';
import { Price, useListingTitle } from '../../components/marketplace';
import {
  Alert,
  Button,
  Card,
  EmptyState,
  Modal,
  PageHeader,
  Spinner,
  Table,
  Td,
  TextInput,
} from '../../components/ui';
import { api } from '../../lib/api';
import { formatDate, useErrorMessage, useLocalizedName } from '../../lib/format';
import type { ListingStatus, LocalizedName, LocalizedText } from '../../lib/types';
import { ListingStatusBadge } from '../supplier/SupplierListingsPage';

interface QueueRow {
  id: string;
  reference: string;
  title: LocalizedText;
  status: ListingStatus;
  price: string | null;
  priceOnRequest: boolean;
  priceIncludesVat: boolean;
  updatedAt: string;
  category: { name: LocalizedName };
  organization: { id: string; legalName: string };
}

export function AdminListingsPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const title = useListingTitle();
  const localized = useLocalizedName();
  const errorMessage = useErrorMessage();
  const [params, setParams] = useSearchParams();
  const status = (params.get('status') ?? 'PENDING_REVIEW') as ListingStatus;
  const [rejecting, setRejecting] = useState<{
    row: QueueRow;
    action: 'reject' | 'unpublish';
  } | null>(null);
  const [reason, setReason] = useState('');

  const settings = useQuery({
    queryKey: ['marketplace-settings'],
    queryFn: () => api<{ moderation: boolean }>('/admin/settings/marketplace', { org: true }),
  });
  const queue = useQuery({
    queryKey: ['admin-listings', status],
    queryFn: () => api<QueueRow[]>('/admin/listings', { org: true, query: { status } }),
  });
  const toggle = useMutation({
    mutationFn: (enabled: boolean) =>
      api('/admin/settings/marketplace/moderation', {
        method: 'PUT',
        org: true,
        body: { enabled },
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['marketplace-settings'] }),
  });
  const moderate = useMutation({
    mutationFn: ({
      id,
      action,
      reason: r,
    }: {
      id: string;
      action: 'approve' | 'reject' | 'unpublish';
      reason?: string;
    }) =>
      api(`/admin/listings/${id}/${action}`, {
        method: 'POST',
        org: true,
        body: r ? { reason: r } : {},
      }),
    onSuccess: () => {
      setRejecting(null);
      setReason('');
      void queryClient.invalidateQueries({ queryKey: ['admin-listings'] });
    },
  });

  return (
    <>
      <PageHeader title={t('moderation.title')} subtitle={t('moderation.subtitle')} />
      <Card title={t('moderation.settingTitle')}>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <p className="max-w-2xl text-sm text-gray-600">
            {settings.data?.moderation ? t('moderation.settingOn') : t('moderation.settingOff')}
          </p>
          <Button
            variant="secondary"
            loading={toggle.isPending}
            disabled={!settings.data}
            onClick={() => toggle.mutate(!settings.data?.moderation)}
          >
            {settings.data?.moderation ? t('moderation.turnOff') : t('moderation.turnOn')}
          </Button>
        </div>
        {toggle.isError && <Alert tone="danger">{errorMessage(toggle.error)}</Alert>}
      </Card>

      <div className="my-4 flex flex-wrap gap-2">
        {(['PENDING_REVIEW', 'PUBLISHED', 'REJECTED'] as const).map((s) => (
          <button
            key={s}
            onClick={() => setParams({ status: s })}
            className={`rounded-full border px-3 py-1 text-sm ${status === s ? 'border-primary-600 bg-primary-50 font-semibold text-primary-600' : 'border-gray-300 bg-white'}`}
          >
            {t(`listingStatus.${s}`)}
          </button>
        ))}
      </div>
      {moderate.isError && <Alert tone="danger">{errorMessage(moderate.error)}</Alert>}
      {queue.isLoading ? (
        <Spinner />
      ) : queue.isError ? (
        <Alert tone="danger">{errorMessage(queue.error)}</Alert>
      ) : !queue.data?.length ? (
        <EmptyState>{t('moderation.empty')}</EmptyState>
      ) : (
        <Table
          head={[
            t('catalogue.colTitle'),
            t('market.supplier'),
            t('catalogue.colCategory'),
            t('catalogue.colPrice'),
            t('catalogue.colStatus'),
            t('catalogue.colUpdated'),
            '',
          ]}
        >
          {queue.data.map((row) => (
            <tr key={row.id}>
              <Td>
                {row.status === 'PUBLISHED' ? (
                  <Link
                    to={`/marketplace/${row.reference}`}
                    className="font-semibold text-primary-600 hover:underline"
                  >
                    {title(row.title)}
                  </Link>
                ) : (
                  <span className="font-semibold">{title(row.title)}</span>
                )}
                <div className="text-xs text-gray-500">{row.reference}</div>
              </Td>
              <Td>
                <Link
                  to={`/admin/organizations/${row.organization.id}`}
                  className="hover:underline"
                >
                  {row.organization.legalName}
                </Link>
              </Td>
              <Td>{localized(row.category.name)}</Td>
              <Td>
                <Price
                  value={row.price}
                  onRequest={row.priceOnRequest}
                  includesVat={row.priceIncludesVat}
                />
              </Td>
              <Td>
                <ListingStatusBadge status={row.status} />
              </Td>
              <Td className="text-xs text-gray-600">{formatDate(row.updatedAt, true)}</Td>
              <Td>
                <div className="flex justify-end gap-2">
                  {row.status === 'PENDING_REVIEW' && (
                    <>
                      <Button
                        variant="secondary"
                        onClick={() => setRejecting({ row, action: 'reject' })}
                      >
                        {t('moderation.reject')}
                      </Button>
                      <Button
                        onClick={() => moderate.mutate({ id: row.id, action: 'approve' })}
                        loading={moderate.isPending}
                      >
                        {t('moderation.approve')}
                      </Button>
                    </>
                  )}
                  {row.status === 'PUBLISHED' && (
                    <Button
                      variant="secondary"
                      onClick={() => setRejecting({ row, action: 'unpublish' })}
                    >
                      {t('moderation.unpublish')}
                    </Button>
                  )}
                </div>
              </Td>
            </tr>
          ))}
        </Table>
      )}

      <Modal
        open={!!rejecting}
        title={
          rejecting?.action === 'unpublish'
            ? t('moderation.unpublishTitle')
            : t('moderation.rejectTitle')
        }
        onClose={() => setRejecting(null)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setRejecting(null)}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="danger"
              disabled={reason.trim().length < 3}
              loading={moderate.isPending}
              onClick={() =>
                rejecting &&
                moderate.mutate({
                  id: rejecting.row.id,
                  action: rejecting.action,
                  reason: reason.trim(),
                })
              }
            >
              {t('common.confirm')}
            </Button>
          </>
        }
      >
        <TextInput
          label={t('moderation.reason')}
          hint={t('moderation.reasonHint')}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={500}
        />
      </Modal>
    </>
  );
}
