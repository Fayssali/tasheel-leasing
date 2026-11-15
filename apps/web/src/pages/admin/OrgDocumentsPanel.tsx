import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Button, Card, EmptyState, Modal, Spinner, TextInput } from '../../components/ui';
import { api, downloadFile } from '../../lib/api';
import { formatDate, useErrorMessage } from '../../lib/format';
import type { Vault, VaultDocument } from '../../lib/types';
import { DocStateBadge, ScanBadge, sizeLabel, useDocTypeName } from '../app/DocumentsPage';

/** Verification papers of an organization, reviewed one by one by Tasheel staff. */
export function OrgDocumentsPanel({ organizationId }: { organizationId: string }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  const [rejecting, setRejecting] = useState<VaultDocument | null>(null);
  const [reason, setReason] = useState('');
  const docs = useQuery({
    queryKey: ['org-documents', organizationId],
    queryFn: () => api<Vault>(`/admin/organizations/${organizationId}/documents`, { org: true }),
  });
  const typeName = useDocTypeName(docs.data?.types);
  const review = useMutation({
    mutationFn: ({ id, decision }: { id: string; decision: 'accept' | 'reject' }) =>
      api(`/admin/documents/${id}/${decision}`, {
        method: 'POST',
        org: true,
        body: decision === 'reject' ? { reason: reason.trim() } : {},
      }),
    onSuccess: () => {
      setRejecting(null);
      setReason('');
      void queryClient.invalidateQueries({ queryKey: ['org-documents', organizationId] });
    },
  });

  return (
    <Card title={t('adminDocs.title')} className="mt-6">
      {docs.isLoading ? (
        <Spinner />
      ) : docs.isError || !docs.data ? (
        <Alert tone="danger">{errorMessage(docs.error)}</Alert>
      ) : (
        <>
          {review.isError && <Alert tone="danger">{errorMessage(review.error)}</Alert>}
          {docs.data.checklist.verification.length > 0 && (
            <div className="mb-4 flex flex-wrap gap-3 text-sm">
              {docs.data.checklist.verification.map((c) => (
                <span
                  key={c.typeCode}
                  className="flex items-center gap-2 rounded border border-gray-200 px-2 py-1"
                >
                  {typeName(c.typeCode)} <DocStateBadge state={c.state} />
                </span>
              ))}
            </div>
          )}
          {!docs.data.documents.length ? (
            <EmptyState>{t('adminDocs.empty')}</EmptyState>
          ) : (
            <ul className="divide-y divide-gray-100 text-sm">
              {docs.data.documents.map((d) => (
                <li key={d.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div>
                    <p className="font-semibold" dir="auto">
                      {typeName(d.typeCode)} — {d.title}
                    </p>
                    <p className="text-xs text-gray-500">
                      {sizeLabel(d.sizeBytes)} · {formatDate(d.createdAt)}
                      {d.expiresOn
                        ? ` · ${t('documents.expires', { date: formatDate(d.expiresOn) })}`
                        : ''}
                    </p>
                    <ScanBadge status={d.scanStatus} />
                  </div>
                  <div className="flex items-center gap-2">
                    <DocStateBadge state={d.reviewStatus} />
                    <Button
                      variant="ghost"
                      onClick={() => void downloadFile(`/documents/${d.id}/file`, d.fileName)}
                    >
                      {t('documents.download')}
                    </Button>
                    {d.reviewStatus !== 'ACCEPTED' && (
                      <Button
                        variant="secondary"
                        loading={review.isPending}
                        onClick={() => review.mutate({ id: d.id, decision: 'accept' })}
                      >
                        {t('adminDocs.accept')}
                      </Button>
                    )}
                    {d.reviewStatus !== 'REJECTED' && (
                      <Button variant="ghost" onClick={() => setRejecting(d)}>
                        {t('adminDocs.reject')}
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-xs text-gray-500">{t('adminDocs.hint')}</p>
        </>
      )}
      <Modal
        open={!!rejecting}
        title={t('adminDocs.rejectTitle')}
        onClose={() => setRejecting(null)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setRejecting(null)}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="danger"
              disabled={reason.trim().length < 3}
              loading={review.isPending}
              onClick={() => rejecting && review.mutate({ id: rejecting.id, decision: 'reject' })}
            >
              {t('common.confirm')}
            </Button>
          </>
        }
      >
        <TextInput
          label={t('adminDocs.reason')}
          hint={t('adminDocs.reasonHint')}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={500}
        />
      </Modal>
    </Card>
  );
}
