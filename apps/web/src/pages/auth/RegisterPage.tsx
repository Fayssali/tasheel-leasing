import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';
import { Alert, Button, Checkbox, TextInput } from '../../components/ui';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useErrorMessage } from '../../lib/format';
import type { TokenResponse } from '../../lib/types';
import { AuthLayout } from './AuthLayout';

type OrgType = 'BUSINESS' | 'SUPPLIER' | 'FINANCIAL_INSTITUTION';
const TYPES: OrgType[] = ['BUSINESS', 'SUPPLIER', 'FINANCIAL_INSTITUTION'];

export function RegisterPage() {
  const { t, i18n } = useTranslation();
  const { adoptTokens } = useAuth();
  const navigate = useNavigate();
  const errorMessage = useErrorMessage();

  const [type, setType] = useState<OrgType>('BUSINESS');
  const [form, setForm] = useState({
    legalName: '',
    tradeName: '',
    rcNumber: '',
    nif: '',
    nis: '',
    wilayaCode: '',
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    password: '',
    confirm: '',
  });
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const passwordTooShort = form.password.length > 0 && form.password.length < 12;
  const mismatch = form.confirm.length > 0 && form.confirm !== form.password;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (passwordTooShort || mismatch) return;
    setError(null);
    setBusy(true);
    const optional = (v: string) => (v.trim() ? v.trim() : undefined);
    try {
      const tokens = await api<TokenResponse>('/auth/register', {
        method: 'POST',
        body: {
          organizationType: type,
          legalName: form.legalName,
          tradeName: optional(form.tradeName),
          rcNumber: optional(form.rcNumber),
          nif: optional(form.nif),
          nis: optional(form.nis),
          wilayaCode: optional(form.wilayaCode),
          firstName: form.firstName,
          lastName: form.lastName,
          email: form.email,
          phone: optional(form.phone),
          password: form.password,
          locale: i18n.language === 'ar' ? 'ar' : 'fr',
          acceptTerms,
        },
      });
      await adoptTokens(tokens);
      navigate('/app', { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout title={t('register.title')} subtitle={t('register.subtitle')} wide>
      <form onSubmit={submit} className="space-y-6">
        {error && <Alert tone="danger">{error}</Alert>}

        <fieldset>
          <legend className="mb-2 text-sm font-semibold text-gray-800">
            {t('register.typeQuestion')}
          </legend>
          <div className="grid gap-3 sm:grid-cols-3">
            {TYPES.map((ty) => (
              <label
                key={ty}
                className={`cursor-pointer rounded-lg border p-3 text-start ${type === ty ? 'border-primary-600 bg-primary-50 ring-2 ring-primary-600/20' : 'border-gray-300'}`}
              >
                <input
                  type="radio"
                  name="type"
                  value={ty}
                  checked={type === ty}
                  onChange={() => setType(ty)}
                  className="sr-only"
                />
                <span className="block text-sm font-semibold text-gray-900">
                  {t(`orgType.${ty}`)}
                </span>
                <span className="mt-1 block text-xs text-gray-600">
                  {t(`register.typeHint.${ty}`)}
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset className="space-y-4">
          <legend className="text-sm font-semibold uppercase tracking-wide text-gray-500">
            {t('register.organization')}
          </legend>
          <TextInput
            label={t('fields.legalName')}
            value={form.legalName}
            onChange={set('legalName')}
            required
            minLength={2}
          />
          <TextInput
            label={t('fields.tradeName')}
            value={form.tradeName}
            onChange={set('tradeName')}
          />
          <div className="grid gap-4 sm:grid-cols-3">
            <TextInput
              label={t('fields.rcNumber')}
              value={form.rcNumber}
              onChange={set('rcNumber')}
              dir="ltr"
            />
            <TextInput
              label={t('fields.nif')}
              value={form.nif}
              onChange={set('nif')}
              dir="ltr"
              inputMode="numeric"
            />
            <TextInput
              label={t('fields.nis')}
              value={form.nis}
              onChange={set('nis')}
              dir="ltr"
              inputMode="numeric"
            />
          </div>
          <TextInput
            label={t('fields.wilayaCode')}
            hint={t('fields.wilayaHint')}
            value={form.wilayaCode}
            onChange={set('wilayaCode')}
            pattern="\d{2}"
            maxLength={2}
            inputMode="numeric"
            dir="ltr"
            className="sm:w-32"
          />
        </fieldset>

        <fieldset className="space-y-4">
          <legend className="text-sm font-semibold uppercase tracking-wide text-gray-500">
            {t('register.administrator')}
          </legend>
          <div className="grid gap-4 sm:grid-cols-2">
            <TextInput
              label={t('fields.firstName')}
              value={form.firstName}
              onChange={set('firstName')}
              required
              autoComplete="given-name"
            />
            <TextInput
              label={t('fields.lastName')}
              value={form.lastName}
              onChange={set('lastName')}
              required
              autoComplete="family-name"
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <TextInput
              label={t('fields.email')}
              type="email"
              value={form.email}
              onChange={set('email')}
              required
              autoComplete="email"
              dir="ltr"
            />
            <TextInput
              label={t('fields.phone')}
              type="tel"
              value={form.phone}
              onChange={set('phone')}
              autoComplete="tel"
              dir="ltr"
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <TextInput
              label={t('fields.password')}
              type="password"
              value={form.password}
              onChange={set('password')}
              required
              autoComplete="new-password"
              hint={t('fields.passwordHint')}
              error={passwordTooShort ? t('fields.passwordHint') : undefined}
            />
            <TextInput
              label={t('fields.confirmPassword')}
              type="password"
              value={form.confirm}
              onChange={set('confirm')}
              required
              autoComplete="new-password"
              error={mismatch ? t('fields.passwordMismatch') : undefined}
            />
          </div>
        </fieldset>

        <Checkbox
          label={t('register.consent')}
          checked={acceptTerms}
          onChange={(e) => setAcceptTerms(e.target.checked)}
          required
        />

        <Alert tone="neutral">{t('register.verificationNotice')}</Alert>

        <Button type="submit" loading={busy} className="w-full" variant="accent">
          {t('register.submit')}
        </Button>
        <p className="text-center text-sm text-gray-600">
          {t('auth.haveAccount')}{' '}
          <Link to="/login" className="font-semibold text-primary-600 hover:underline">
            {t('nav.signIn')}
          </Link>
        </p>
      </form>
    </AuthLayout>
  );
}
