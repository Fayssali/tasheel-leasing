import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { OrgStatusBadge } from '../../components/StatusBadge';
import {
  Alert,
  Button,
  Card,
  PageHeader,
  SelectInput,
  Spinner,
  TextInput,
} from '../../components/ui';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { formatDate, useErrorMessage } from '../../lib/format';
import type { OrganizationProfile } from '../../lib/types';

const IDENTITY = ['legalName', 'rcNumber', 'nif', 'nis', 'articleImposition'] as const;
const OTHER = ['tradeName', 'wilayaCode', 'address', 'email', 'phone'] as const;
type Editable = (typeof IDENTITY)[number] | (typeof OTHER)[number] | 'defaultLocale';

export function OrganizationPage() {
  const { t } = useTranslation();
  const { activeOrg, reloadMe } = useAuth();
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();

  const profile = useQuery({
    queryKey: ['org', activeOrg?.organizationId],
    queryFn: () => api<OrganizationProfile>('/organizations/current', { org: true }),
  });
  const [form, setForm] = useState<Record<Editable, string>>({} as Record<Editable, string>);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!profile.data) return;
    const next = {} as Record<Editable, string>;
    for (const k of [...IDENTITY, ...OTHER, 'defaultLocale'] as Editable[])
      next[k] = (profile.data[k] as string | null) ?? '';
    setForm(next);
  }, [profile.data]);

  const canEdit = profile.data?.permissions?.includes('organization.update') ?? false;
  const identityLocked = profile.data?.status === 'VERIFIED';

  const save = useMutation({
    mutationFn: (body: Partial<Record<Editable, string>>) =>
      api<OrganizationProfile>('/organizations/current', { method: 'PATCH', org: true, body }),
    onSuccess: async () => {
      setSaved(true);
      await queryClient.invalidateQueries({ queryKey: ['org'] });
      await reloadMe();
    },
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!profile.data) return;
    setSaved(false);
    // Send only changed, non-empty fields; identity fields only when editable.
    const body: Partial<Record<Editable, string>> = {};
    for (const k of [
      ...(identityLocked ? [] : IDENTITY),
      ...OTHER,
      'defaultLocale',
    ] as Editable[]) {
      const value = form[k]?.trim() ?? '';
      if (value && value !== ((profile.data[k] as string | null) ?? '')) body[k] = value;
    }
    if (Object.keys(body).length) save.mutate(body);
  }

  if (profile.isLoading) return <Spinner />;
  if (profile.isError || !profile.data)
    return <Alert tone="danger">{errorMessage(profile.error)}</Alert>;
  const p = profile.data;
  const set = (k: Editable) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));
  const ltr = new Set<Editable>([
    'rcNumber',
    'nif',
    'nis',
    'articleImposition',
    'wilayaCode',
    'email',
    'phone',
  ]);

  return (
    <>
      <PageHeader
        title={t('org.title')}
        subtitle={p.legalName}
        actions={<OrgStatusBadge status={p.status} />}
      />
      {p.statusReason && (
        <div className="mb-6">
          <Alert tone="danger" title={t('org.statusReason')}>
            {p.statusReason}
          </Alert>
        </div>
      )}
      <form onSubmit={submit} className="space-y-6">
        <Card title={t('org.identity')}>
          {identityLocked && (
            <div className="mb-4">
              <Alert tone="neutral">
                {t('org.identityLocked', { date: formatDate(p.verifiedAt) })}
              </Alert>
            </div>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            {IDENTITY.map((k) => (
              <TextInput
                key={k}
                label={t(`fields.${k}`)}
                value={form[k] ?? ''}
                onChange={set(k)}
                disabled={!canEdit || identityLocked}
                dir={ltr.has(k) ? 'ltr' : undefined}
              />
            ))}
          </div>
        </Card>
        <Card title={t('org.contact')}>
          <div className="grid gap-4 sm:grid-cols-2">
            {OTHER.map((k) => (
              <TextInput
                key={k}
                label={t(`fields.${k}`)}
                value={form[k] ?? ''}
                onChange={set(k)}
                disabled={!canEdit}
                dir={ltr.has(k) ? 'ltr' : undefined}
                hint={k === 'wilayaCode' ? t('fields.wilayaHint') : undefined}
              />
            ))}
            <SelectInput
              label={t('fields.defaultLocale')}
              value={form.defaultLocale ?? 'fr'}
              onChange={set('defaultLocale')}
              disabled={!canEdit}
              options={[
                { value: 'fr', label: t('language.fr') },
                { value: 'ar', label: t('language.ar') },
              ]}
            />
          </div>
        </Card>
        {save.isError && <Alert tone="danger">{errorMessage(save.error)}</Alert>}
        {saved && <Alert tone="success">{t('common.saved')}</Alert>}
        {canEdit && (
          <div className="flex justify-end">
            <Button type="submit" loading={save.isPending}>
              {t('common.save')}
            </Button>
          </div>
        )}
      </form>
    </>
  );
}
