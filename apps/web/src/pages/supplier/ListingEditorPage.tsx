import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router';
import { AuthedImage } from '../../components/marketplace';
import {
  Alert,
  Button,
  Card,
  Checkbox,
  PageHeader,
  SelectInput,
  Spinner,
  TextInput,
} from '../../components/ui';
import { api, ApiError, getAccessToken } from '../../lib/api';
import { useErrorMessage, useLocalizedName } from '../../lib/format';
import type { Category, SupplierListing } from '../../lib/types';
import { ListingStatusBadge } from './SupplierListingsPage';

interface FormState {
  categoryId: string;
  titleFr: string;
  titleAr: string;
  descriptionFr: string;
  descriptionAr: string;
  brand: string;
  model: string;
  year: string;
  condition: 'NEW' | 'USED' | 'REFURBISHED';
  price: string;
  priceOnRequest: boolean;
  priceIncludesVat: boolean;
  availability: 'IN_STOCK' | 'ON_ORDER' | 'UNAVAILABLE';
  leadTimeDays: string;
  deliveryWilayas: string;
  warrantyMonths: string;
  specs: Record<string, string>;
}

const EMPTY: FormState = {
  categoryId: '',
  titleFr: '',
  titleAr: '',
  descriptionFr: '',
  descriptionAr: '',
  brand: '',
  model: '',
  year: '',
  condition: 'NEW',
  price: '',
  priceOnRequest: false,
  priceIncludesVat: false,
  availability: 'IN_STOCK',
  leadTimeDays: '',
  deliveryWilayas: '',
  warrantyMonths: '',
  specs: {},
};

const fromListing = (l: SupplierListing): FormState => ({
  categoryId: l.categoryId,
  titleFr: l.title.fr ?? '',
  titleAr: l.title.ar ?? '',
  descriptionFr: l.description?.fr ?? '',
  descriptionAr: l.description?.ar ?? '',
  brand: l.brand ?? '',
  model: l.model ?? '',
  year: l.year ? String(l.year) : '',
  condition: l.condition,
  price: l.price ? String(Number(l.price)) : '',
  priceOnRequest: l.priceOnRequest,
  priceIncludesVat: l.priceIncludesVat,
  availability: l.availability,
  leadTimeDays: l.leadTimeDays !== null ? String(l.leadTimeDays) : '',
  deliveryWilayas: l.deliveryWilayas.join(', '),
  warrantyMonths: l.warrantyMonths ? String(l.warrantyMonths) : '',
  specs: Object.fromEntries(Object.entries(l.specs ?? {}).map(([k, v]) => [k, String(v)])),
});

const num = (s: string) => (s.trim() === '' ? undefined : Number(s));

export function ListingEditorPage() {
  const { t } = useTranslation();
  const { id } = useParams();
  const isNew = !id;
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const localized = useLocalizedName();
  const errorMessage = useErrorMessage();
  const [form, setForm] = useState<FormState>(EMPTY);
  const [notice, setNotice] = useState<string | null>(null);
  const imageInput = useRef<HTMLInputElement>(null);
  const docInput = useRef<HTMLInputElement>(null);

  const categories = useQuery({
    queryKey: ['categories'],
    queryFn: () => api<Category[]>('/marketplace/categories'),
    staleTime: 300_000,
  });
  const listing = useQuery({
    queryKey: ['supplier-listing', id],
    queryFn: () => api<SupplierListing>(`/supplier/listings/${id}`, { org: true }),
    enabled: !isNew,
  });
  useEffect(() => {
    if (listing.data) setForm(fromListing(listing.data));
  }, [listing.data]);

  const category = categories.data?.find((c) => c.id === form.categoryId);
  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }));
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['supplier-listing', id] });
    void queryClient.invalidateQueries({ queryKey: ['supplier-listings'] });
  };

  const save = useMutation({
    mutationFn: () => {
      const body = {
        categoryId: form.categoryId,
        title: { fr: form.titleFr.trim() || undefined, ar: form.titleAr.trim() || undefined },
        description: {
          fr: form.descriptionFr.trim() || undefined,
          ar: form.descriptionAr.trim() || undefined,
        },
        brand: form.brand.trim() || undefined,
        model: form.model.trim() || undefined,
        year: num(form.year),
        condition: form.condition,
        price: form.priceOnRequest || !form.price.trim() ? undefined : form.price.trim(),
        priceOnRequest: form.priceOnRequest,
        priceIncludesVat: form.priceIncludesVat,
        availability: form.availability,
        leadTimeDays: num(form.leadTimeDays),
        deliveryWilayas: form.deliveryWilayas.split(/[,\s]+/).filter((w) => /^\d{2}$/.test(w)),
        warrantyMonths: num(form.warrantyMonths),
        specs: Object.fromEntries(Object.entries(form.specs).filter(([, v]) => v.trim() !== '')),
      };
      return isNew
        ? api<{ id: string }>('/supplier/listings', { method: 'POST', org: true, body })
        : api<{ id: string }>(`/supplier/listings/${id}`, { method: 'PUT', org: true, body });
    },
    onSuccess: (res) => {
      setNotice(t('catalogue.saved'));
      refresh();
      if (isNew) navigate(`/app/catalogue/${res.id}`, { replace: true });
    },
  });
  const action = useMutation({
    mutationFn: (what: 'submit' | 'archive' | 'restore') =>
      api<{ status: string }>(`/supplier/listings/${id}/${what}`, { method: 'POST', org: true }),
    onSuccess: (res) => {
      setNotice(t(`catalogue.after.${res.status}`));
      refresh();
    },
  });
  const upload = useMutation({
    mutationFn: ({ kind, file }: { kind: 'images' | 'documents'; file: File }) => {
      const data = new FormData();
      data.append('file', file);
      return api(`/supplier/listings/${id}/${kind}`, { method: 'POST', org: true, body: data });
    },
    onSuccess: refresh,
  });
  const remove = useMutation({
    mutationFn: (path: string) =>
      api(`/supplier/listings/${id}/${path}`, { method: 'DELETE', org: true }),
    onSuccess: refresh,
  });
  const reorder = useMutation({
    mutationFn: (imageIds: string[]) =>
      api(`/supplier/listings/${id}/images/order`, {
        method: 'PATCH',
        org: true,
        body: { imageIds },
      }),
    onSuccess: refresh,
  });

  if (!isNew && listing.isLoading) return <Spinner />;
  if (!isNew && listing.isError) return <Alert tone="danger">{errorMessage(listing.error)}</Alert>;
  const l = listing.data;
  const editable = isNew || (l && l.status !== 'ARCHIVED');
  const missing =
    action.error instanceof ApiError
      ? ((action.error.details as { missing?: string[] } | undefined)?.missing ?? [])
      : [];

  function submit(e: FormEvent) {
    e.preventDefault();
    setNotice(null);
    save.mutate();
  }
  const moveImage = (index: number, delta: number) => {
    if (!l) return;
    const ids = l.images.map((i) => i.id);
    const [moved] = ids.splice(index, 1);
    ids.splice(index + delta, 0, moved!);
    reorder.mutate(ids);
  };

  return (
    <>
      <PageHeader
        title={isNew ? t('catalogue.newTitle') : t('catalogue.editTitle')}
        subtitle={l ? l.reference : t('catalogue.newSubtitle')}
        actions={
          <Link to="/app/catalogue" className="text-sm text-primary-600 hover:underline">
            {t('catalogue.backToList')}
          </Link>
        }
      />
      {notice && <Alert tone="success">{notice}</Alert>}
      {l?.status === 'REJECTED' && l.statusReason && (
        <Alert tone="danger" title={t('catalogue.rejectedTitle')}>
          {l.statusReason}
        </Alert>
      )}
      {(save.isError || action.isError || upload.isError || remove.isError) && (
        <Alert tone="danger">
          {errorMessage(save.error ?? action.error ?? upload.error ?? remove.error)}
          {missing.length > 0 && ` (${missing.map((m) => t(`catalogue.missing.${m}`)).join(', ')})`}
        </Alert>
      )}

      <div className="mt-4 grid gap-6 xl:grid-cols-[1fr_340px]">
        <form id="listing-form" onSubmit={submit} className="space-y-6">
          <fieldset disabled={!editable} className="space-y-6">
            <Card title={t('catalogue.sectionGeneral')}>
              <div className="grid gap-4 sm:grid-cols-2">
                <SelectInput
                  label={t('catalogue.category')}
                  value={form.categoryId}
                  required
                  onChange={(e) =>
                    setForm((f) => ({ ...f, categoryId: e.target.value, specs: {} }))
                  }
                  options={[
                    { value: '', label: t('catalogue.chooseCategory'), disabled: true },
                    ...(categories.data ?? []).map((c) => ({
                      value: c.id,
                      label: localized(c.name),
                    })),
                  ]}
                />
                <SelectInput
                  label={t('catalogue.condition')}
                  value={form.condition}
                  onChange={(e) => set('condition', e.target.value as FormState['condition'])}
                  options={(['NEW', 'USED', 'REFURBISHED'] as const).map((c) => ({
                    value: c,
                    label: t(`market.condition.${c}`),
                  }))}
                />
                <TextInput
                  label={t('catalogue.titleFr')}
                  value={form.titleFr}
                  onChange={(e) => set('titleFr', e.target.value)}
                  maxLength={200}
                />
                <TextInput
                  label={t('catalogue.titleAr')}
                  value={form.titleAr}
                  onChange={(e) => set('titleAr', e.target.value)}
                  maxLength={200}
                  dir="rtl"
                />
                <TextInput
                  label={t('catalogue.brand')}
                  value={form.brand}
                  onChange={(e) => set('brand', e.target.value)}
                  maxLength={100}
                />
                <TextInput
                  label={t('catalogue.model')}
                  value={form.model}
                  onChange={(e) => set('model', e.target.value)}
                  maxLength={100}
                />
                <TextInput
                  label={t('market.year')}
                  type="number"
                  min={1950}
                  max={2100}
                  value={form.year}
                  onChange={(e) => set('year', e.target.value)}
                  dir="ltr"
                />
              </div>
              <p className="mt-2 text-xs text-gray-500">{t('catalogue.titleHint')}</p>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                {(['descriptionFr', 'descriptionAr'] as const).map((k) => (
                  <label key={k} className="block space-y-1">
                    <span className="block text-sm font-semibold text-gray-800">
                      {t(`catalogue.${k}`)}
                    </span>
                    <textarea
                      value={form[k]}
                      onChange={(e) => set(k, e.target.value)}
                      rows={6}
                      maxLength={5000}
                      dir={k === 'descriptionAr' ? 'rtl' : 'auto'}
                      className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                    />
                  </label>
                ))}
              </div>
            </Card>

            <Card title={t('catalogue.sectionPrice')}>
              <div className="grid gap-4 sm:grid-cols-2">
                <TextInput
                  label={t('catalogue.price')}
                  hint={t('catalogue.priceHint')}
                  value={form.price}
                  onChange={(e) => set('price', e.target.value.replace(/[^\d.]/g, ''))}
                  disabled={form.priceOnRequest}
                  inputMode="decimal"
                  dir="ltr"
                />
                <SelectInput
                  label={t('market.availabilityLabel')}
                  value={form.availability}
                  onChange={(e) => set('availability', e.target.value as FormState['availability'])}
                  options={(['IN_STOCK', 'ON_ORDER', 'UNAVAILABLE'] as const).map((a) => ({
                    value: a,
                    label: t(`market.availability.${a}`),
                  }))}
                />
                <Checkbox
                  label={t('catalogue.priceOnRequest')}
                  checked={form.priceOnRequest}
                  onChange={(e) => set('priceOnRequest', e.target.checked)}
                />
                <Checkbox
                  label={t('catalogue.priceIncludesVat')}
                  checked={form.priceIncludesVat}
                  onChange={(e) => set('priceIncludesVat', e.target.checked)}
                />
                <TextInput
                  label={t('catalogue.leadTimeDays')}
                  type="number"
                  min={0}
                  max={365}
                  value={form.leadTimeDays}
                  onChange={(e) => set('leadTimeDays', e.target.value)}
                  dir="ltr"
                />
                <TextInput
                  label={t('catalogue.warrantyMonths')}
                  type="number"
                  min={0}
                  max={120}
                  value={form.warrantyMonths}
                  onChange={(e) => set('warrantyMonths', e.target.value)}
                  dir="ltr"
                />
                <TextInput
                  label={t('catalogue.deliveryWilayas')}
                  hint={t('catalogue.deliveryWilayasHint')}
                  value={form.deliveryWilayas}
                  onChange={(e) => set('deliveryWilayas', e.target.value)}
                  dir="ltr"
                />
              </div>
            </Card>

            {category && category.specSchema.length > 0 && (
              <Card title={t('catalogue.sectionSpecs')}>
                <div className="grid gap-4 sm:grid-cols-2">
                  {category.specSchema.map((f) =>
                    f.type === 'select' ? (
                      <SelectInput
                        key={f.key}
                        label={localized(f.label)}
                        value={form.specs[f.key] ?? ''}
                        onChange={(e) => set('specs', { ...form.specs, [f.key]: e.target.value })}
                        options={[
                          { value: '', label: '—' },
                          ...(f.options ?? []).map((o) => ({
                            value: o.value,
                            label: localized(o.label),
                          })),
                        ]}
                      />
                    ) : (
                      <TextInput
                        key={f.key}
                        label={`${localized(f.label)}${f.unit ? ` (${f.unit})` : ''}`}
                        value={form.specs[f.key] ?? ''}
                        onChange={(e) => set('specs', { ...form.specs, [f.key]: e.target.value })}
                        inputMode={f.type === 'number' ? 'decimal' : undefined}
                        dir={f.type === 'number' ? 'ltr' : 'auto'}
                      />
                    ),
                  )}
                </div>
              </Card>
            )}
          </fieldset>
          {editable && (
            <div className="flex justify-end">
              <Button type="submit" loading={save.isPending}>
                {isNew ? t('catalogue.createDraft') : t('common.save')}
              </Button>
            </div>
          )}
        </form>

        <div className="space-y-6">
          {l && (
            <Card title={t('catalogue.sectionPublication')}>
              <div className="mb-3 flex items-center justify-between">
                <ListingStatusBadge status={l.status} />
                {l.status === 'PUBLISHED' && (
                  <Link
                    to={`/marketplace/${l.reference}`}
                    className="text-sm text-primary-600 hover:underline"
                  >
                    {t('catalogue.viewPublic')}
                  </Link>
                )}
              </div>
              <p className="mb-4 text-xs text-gray-600">{t(`catalogue.statusHelp.${l.status}`)}</p>
              <div className="flex flex-col gap-2">
                {['DRAFT', 'REJECTED'].includes(l.status) && (
                  <Button onClick={() => action.mutate('submit')} loading={action.isPending}>
                    {t('catalogue.submit')}
                  </Button>
                )}
                {['PUBLISHED', 'PENDING_REVIEW', 'DRAFT', 'REJECTED'].includes(l.status) && (
                  <Button
                    variant="secondary"
                    onClick={() => action.mutate('archive')}
                    loading={action.isPending}
                  >
                    {t('catalogue.archive')}
                  </Button>
                )}
                {l.status === 'ARCHIVED' && (
                  <Button
                    variant="secondary"
                    onClick={() => action.mutate('restore')}
                    loading={action.isPending}
                  >
                    {t('catalogue.restore')}
                  </Button>
                )}
              </div>
            </Card>
          )}

          {l ? (
            <>
              <Card
                title={t('catalogue.images', { count: l.images.length })}
                actions={
                  editable && l.images.length < 10 ? (
                    <Button
                      variant="ghost"
                      onClick={() => imageInput.current?.click()}
                      loading={upload.isPending && upload.variables?.kind === 'images'}
                    >
                      {t('catalogue.addImage')}
                    </Button>
                  ) : undefined
                }
              >
                <input
                  ref={imageInput}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) upload.mutate({ kind: 'images', file });
                    e.target.value = '';
                  }}
                />
                {l.images.length === 0 ? (
                  <p className="text-sm text-gray-500">{t('catalogue.imagesHint')}</p>
                ) : (
                  <ul className="grid grid-cols-2 gap-3">
                    {l.images.map((img, i) => (
                      <li key={img.id} className="relative">
                        <AuthedImage
                          path={`/supplier/listings/${l.id}/images/${img.id}`}
                          token={getAccessToken()}
                          className="aspect-[4/3] w-full rounded object-cover"
                        />
                        {i === 0 && (
                          <span className="absolute start-1 top-1 rounded bg-primary-900/80 px-1.5 py-0.5 text-[10px] text-white">
                            {t('catalogue.cover')}
                          </span>
                        )}
                        {editable && (
                          <div className="mt-1 flex justify-between text-xs">
                            <span className="flex gap-1">
                              <button
                                type="button"
                                disabled={i === 0}
                                onClick={() => moveImage(i, -1)}
                                className="rounded border px-1.5 disabled:opacity-30"
                                aria-label={t('catalogue.moveEarlier')}
                              >
                                ↑
                              </button>
                              <button
                                type="button"
                                disabled={i === l.images.length - 1}
                                onClick={() => moveImage(i, 1)}
                                className="rounded border px-1.5 disabled:opacity-30"
                                aria-label={t('catalogue.moveLater')}
                              >
                                ↓
                              </button>
                            </span>
                            <button
                              type="button"
                              onClick={() => remove.mutate(`images/${img.id}`)}
                              className="text-danger-600 hover:underline"
                            >
                              {t('common.remove')}
                            </button>
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </Card>

              <Card
                title={t('market.documents')}
                actions={
                  editable && l.documents.length < 5 ? (
                    <Button
                      variant="ghost"
                      onClick={() => docInput.current?.click()}
                      loading={upload.isPending && upload.variables?.kind === 'documents'}
                    >
                      {t('catalogue.addDocument')}
                    </Button>
                  ) : undefined
                }
              >
                <input
                  ref={docInput}
                  type="file"
                  accept="application/pdf"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) upload.mutate({ kind: 'documents', file });
                    e.target.value = '';
                  }}
                />
                {l.documents.length === 0 ? (
                  <p className="text-sm text-gray-500">{t('catalogue.documentsHint')}</p>
                ) : (
                  <ul className="space-y-2 text-sm">
                    {l.documents.map((d) => (
                      <li key={d.id} className="flex items-center justify-between gap-2">
                        <span className="truncate" dir="auto">
                          {d.fileName}
                        </span>
                        {editable && (
                          <button
                            type="button"
                            onClick={() => remove.mutate(`documents/${d.id}`)}
                            className="text-xs text-danger-600 hover:underline"
                          >
                            {t('common.remove')}
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </>
          ) : (
            <Alert tone="info">{t('catalogue.filesAfterDraft')}</Alert>
          )}
        </div>
      </div>
    </>
  );
}
