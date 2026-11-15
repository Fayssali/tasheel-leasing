import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  Modal,
  PageHeader,
  SelectInput,
  Spinner,
  TextInput,
} from '../../components/ui';
import { api, downloadFile } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { formatDate, useErrorMessage, useLocalizedName } from '../../lib/format';
import type { DocState, DocumentType, Vault, VaultDocument } from '../../lib/types';

const STATE_TONE: Record<DocState, 'neutral' | 'action' | 'success' | 'danger'> = {
  MISSING: 'neutral',
  PENDING: 'action',
  ACCEPTED: 'success',
  REJECTED: 'danger',
  EXPIRED: 'danger',
};

export function DocStateBadge({ state }: { state: DocState }) {
  const { t } = useTranslation();
  return <Badge tone={STATE_TONE[state]}>{t(`docState.${state}`)}</Badge>;
}

export function ScanBadge({ status }: { status: VaultDocument['scanStatus'] }) {
  const { t } = useTranslation();
  if (status === 'CLEAN')
    return <span className="text-xs text-success-600">{t('documents.scanClean')}</span>;
  if (status === 'NOT_SCANNED')
    return <span className="text-xs text-gray-500">{t('documents.scanSkipped')}</span>;
  return <span className="text-xs text-danger-600">{t('documents.scanPending')}</span>;
}

export const sizeLabel = (bytes: number) =>
  bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.ceil(bytes / 1024)} KB`;

export function useDocTypeName(types: DocumentType[] | undefined) {
  const localized = useLocalizedName();
  return (code: string) => localized(types?.find((t) => t.code === code)?.name) || code;
}

export function UploadModal({
  open,
  onClose,
  types,
  replace,
  defaultType,
  onUploaded,
}: {
  open: boolean;
  onClose: () => void;
  types: DocumentType[];
  replace?: VaultDocument | null;
  defaultType?: string;
  onUploaded?: (id: string) => void;
}) {
  const { t } = useTranslation();
  const localized = useLocalizedName();
  const errorMessage = useErrorMessage();
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [typeCode, setTypeCode] = useState('');
  const [title, setTitle] = useState('');
  const [expiresOn, setExpiresOn] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [openedFor, setOpenedFor] = useState<string | null>(null);

  const key = `${open}-${replace?.id ?? ''}-${defaultType ?? ''}`;
  if (open && openedFor !== key) {
    setOpenedFor(key);
    setTypeCode(replace?.typeCode ?? defaultType ?? '');
    setTitle('');
    setExpiresOn('');
    setFile(null);
  }
  const type = types.find((x) => x.code === typeCode);

  const upload = useMutation({
    mutationFn: () => {
      const data = new FormData();
      data.append('typeCode', typeCode);
      if (title.trim()) data.append('title', title.trim());
      if (expiresOn) data.append('expiresOn', expiresOn);
      if (replace) data.append('replacesId', replace.id);
      data.append('file', file!);
      return api<{ id: string }>('/documents', { method: 'POST', org: true, body: data });
    },
    onSuccess: (res) => {
      void queryClient.invalidateQueries({ queryKey: ['vault'] });
      onUploaded?.(res.id);
      onClose();
    },
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    upload.mutate();
  }

  return (
    <Modal
      open={open}
      title={replace ? t('documents.replaceTitle') : t('documents.uploadTitle')}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            type="submit"
            form="upload-form"
            loading={upload.isPending}
            disabled={!file || !typeCode}
          >
            {t('documents.upload')}
          </Button>
        </>
      }
    >
      <form id="upload-form" onSubmit={submit} className="space-y-4">
        {upload.isError && <Alert tone="danger">{errorMessage(upload.error)}</Alert>}
        <SelectInput
          label={t('documents.type')}
          value={typeCode}
          disabled={!!replace}
          required
          onChange={(e) => setTypeCode(e.target.value)}
          options={[
            { value: '', label: t('documents.chooseType'), disabled: true },
            ...types.map((x) => ({ value: x.code, label: localized(x.name) })),
          ]}
        />
        <TextInput
          label={t('documents.titleLabel')}
          hint={t('documents.titleHint')}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={200}
        />
        {type?.hasExpiry && (
          <TextInput
            label={t('documents.expiresOn')}
            type="date"
            value={expiresOn}
            min={new Date().toISOString().slice(0, 10)}
            onChange={(e) => setExpiresOn(e.target.value)}
            dir="ltr"
          />
        )}
        <div>
          <input
            ref={fileRef}
            type="file"
            accept="application/pdf,image/jpeg,image/png"
            className="hidden"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
          <Button type="button" variant="secondary" onClick={() => fileRef.current?.click()}>
            {file ? file.name : t('documents.chooseFile')}
          </Button>
          <p className="mt-1 text-xs text-gray-500">{t('documents.fileHint')}</p>
        </div>
      </form>
    </Modal>
  );
}

export function DocumentsPage() {
  const { t } = useTranslation();
  const { activeOrg } = useAuth();
  const errorMessage = useErrorMessage();
  const vault = useQuery({
    queryKey: ['vault', activeOrg?.organizationId],
    queryFn: () => api<Vault>('/documents', { org: true }),
  });
  const typeName = useDocTypeName(vault.data?.types);
  const [uploading, setUploading] = useState<{ type?: string; replace?: VaultDocument } | null>(
    null,
  );
  const [downloadError, setDownloadError] = useState<string | null>(null);

  if (vault.isLoading) return <Spinner />;
  if (vault.isError || !vault.data) return <Alert tone="danger">{errorMessage(vault.error)}</Alert>;
  const { checklist, documents, types } = vault.data;

  const Checklist = ({
    title,
    hint,
    items,
  }: {
    title: string;
    hint: string;
    items: Vault['checklist']['verification'];
  }) =>
    items.length ? (
      <Card title={title}>
        <p className="mb-3 text-xs text-gray-600">{hint}</p>
        <ul className="divide-y divide-gray-100 text-sm">
          {items.map((c) => (
            <li key={c.typeCode} className="flex items-center justify-between gap-3 py-2">
              <span>{typeName(c.typeCode)}</span>
              <span className="flex items-center gap-3">
                <DocStateBadge state={c.state} />
                {(c.state === 'MISSING' || c.state === 'EXPIRED' || c.state === 'REJECTED') && (
                  <button
                    className="text-xs text-primary-600 hover:underline"
                    onClick={() =>
                      setUploading({
                        type: c.typeCode,
                        replace: documents.find((d) => d.typeCode === c.typeCode),
                      })
                    }
                  >
                    {c.state === 'MISSING' ? t('documents.add') : t('documents.replace')}
                  </button>
                )}
              </span>
            </li>
          ))}
        </ul>
      </Card>
    ) : null;

  return (
    <>
      <PageHeader
        title={t('documents.title')}
        subtitle={t('documents.subtitle')}
        actions={<Button onClick={() => setUploading({})}>{t('documents.uploadTitle')}</Button>}
      />
      {downloadError && <Alert tone="danger">{downloadError}</Alert>}
      <div className="grid gap-6 lg:grid-cols-2">
        <Checklist
          title={t('documents.verificationChecklist')}
          hint={t('documents.verificationHint')}
          items={checklist.verification}
        />
        <Checklist
          title={t('documents.applicationChecklist')}
          hint={t('documents.applicationHint')}
          items={checklist.application}
        />
      </div>
      <div className="mt-6">
        <Card title={t('documents.allDocuments')}>
          {documents.length === 0 ? (
            <EmptyState>{t('documents.empty')}</EmptyState>
          ) : (
            <ul className="divide-y divide-gray-100">
              {documents.map((d) => (
                <li key={d.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="font-semibold text-gray-900" dir="auto">
                      {d.title}
                    </p>
                    <p className="text-xs text-gray-500">
                      {typeName(d.typeCode)} · {sizeLabel(d.sizeBytes)} · {formatDate(d.createdAt)}
                      {d.expiresOn
                        ? ` · ${t('documents.expires', { date: formatDate(d.expiresOn) })}`
                        : ''}
                    </p>
                    <ScanBadge status={d.scanStatus} />
                    {d.reviewStatus === 'REJECTED' && d.reviewReason && (
                      <p className="mt-1 text-xs text-danger-600">
                        {t('documents.rejectedReason', { reason: d.reviewReason })}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    <DocStateBadge state={d.reviewStatus} />
                    <button
                      className="text-sm text-primary-600 hover:underline"
                      onClick={() =>
                        downloadFile(`/documents/${d.id}/file`, d.fileName).catch(() =>
                          setDownloadError(t('documents.downloadFailed')),
                        )
                      }
                    >
                      {t('documents.download')}
                    </button>
                    <button
                      className="text-sm text-primary-600 hover:underline"
                      onClick={() => setUploading({ replace: d })}
                    >
                      {t('documents.replace')}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
      <p className="mt-4 text-xs text-gray-500">{t('documents.privacy')}</p>
      <UploadModal
        open={!!uploading}
        onClose={() => setUploading(null)}
        types={types}
        replace={uploading?.replace}
        defaultType={uploading?.type}
      />
    </>
  );
}
