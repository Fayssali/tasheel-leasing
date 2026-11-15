import { useQuery } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { Alert, Button, Checkbox, Spinner, TextInput } from '../../components/ui';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useErrorMessage, useLocalizedName } from '../../lib/format';
import type { LocalizedName, TokenResponse } from '../../lib/types';
import { AuthLayout } from './AuthLayout';

interface Preview {
  organizationName: string;
  organizationType: string;
  email: string;
  role: { code: string; name: LocalizedName };
  expiresAt: string;
  existingAccount: boolean;
}

export function AcceptInvitationPage() {
  const { t, i18n } = useTranslation();
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const navigate = useNavigate();
  const { status, me, adoptTokens, reloadMe, switchOrg } = useAuth();
  const errorMessage = useErrorMessage();
  const localized = useLocalizedName();

  const preview = useQuery({
    queryKey: ['invitation-preview', token],
    queryFn: () => api<Preview>('/invitations/preview', { query: { token } }),
    retry: false,
  });

  const [form, setForm] = useState({ firstName: '', lastName: '', password: '', confirm: '' });
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  async function acceptNew(e: FormEvent) {
    e.preventDefault();
    if (form.password.length < 12 || form.password !== form.confirm) return;
    setBusy(true);
    setError(null);
    try {
      const tokens = await api<TokenResponse>('/invitations/accept', {
        method: 'POST',
        body: {
          token,
          firstName: form.firstName,
          lastName: form.lastName,
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

  async function acceptExisting() {
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ organizationId: string }>('/invitations/accept-existing', {
        method: 'POST',
        body: { token },
      });
      await reloadMe();
      switchOrg(res.organizationId);
      navigate('/app', { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const p = preview.data;
  return (
    <AuthLayout title={t('invite.title')}>
      {preview.isLoading && (
        <div className="flex justify-center py-6 text-primary-600">
          <Spinner />
        </div>
      )}
      {preview.isError && <Alert tone="danger">{errorMessage(preview.error)}</Alert>}
      {p && (
        <div className="space-y-5">
          <Alert tone="info" title={p.organizationName}>
            {t('invite.summary', { role: localized(p.role.name), email: p.email })}
          </Alert>
          {error && <Alert tone="danger">{error}</Alert>}

          {status === 'authenticated' && (
            <div className="space-y-3">
              {me?.user.email.toLowerCase() === p.email.toLowerCase() ? (
                <Button onClick={acceptExisting} loading={busy} className="w-full" variant="accent">
                  {t('invite.join')}
                </Button>
              ) : (
                <Alert tone="action">{t('invite.wrongAccount', { email: p.email })}</Alert>
              )}
            </div>
          )}

          {status === 'anonymous' && p.existingAccount && (
            <div className="space-y-3">
              <p className="text-sm text-gray-700">{t('invite.signInFirst')}</p>
              <Link
                to={`/login?redirect=${encodeURIComponent(`/accept-invitation?token=${encodeURIComponent(token)}`)}`}
                className="block rounded-lg bg-primary-600 px-4 py-2 text-center text-sm font-semibold text-white hover:bg-primary-900"
              >
                {t('nav.signIn')}
              </Link>
            </div>
          )}

          {status === 'anonymous' && !p.existingAccount && (
            <form onSubmit={acceptNew} className="space-y-4">
              <p className="text-sm text-gray-700">{t('invite.createAccount')}</p>
              <div className="grid gap-4 sm:grid-cols-2">
                <TextInput
                  label={t('fields.firstName')}
                  value={form.firstName}
                  onChange={set('firstName')}
                  required
                />
                <TextInput
                  label={t('fields.lastName')}
                  value={form.lastName}
                  onChange={set('lastName')}
                  required
                />
              </div>
              <TextInput label={t('fields.email')} value={p.email} disabled dir="ltr" />
              <TextInput
                label={t('fields.password')}
                type="password"
                value={form.password}
                onChange={set('password')}
                required
                autoComplete="new-password"
                hint={t('fields.passwordHint')}
              />
              <TextInput
                label={t('fields.confirmPassword')}
                type="password"
                value={form.confirm}
                onChange={set('confirm')}
                required
                autoComplete="new-password"
                error={
                  form.confirm && form.confirm !== form.password
                    ? t('fields.passwordMismatch')
                    : undefined
                }
              />
              <Checkbox
                label={t('register.consent')}
                checked={acceptTerms}
                onChange={(e) => setAcceptTerms(e.target.checked)}
                required
              />
              <Button type="submit" loading={busy} className="w-full" variant="accent">
                {t('invite.createAndJoin')}
              </Button>
            </form>
          )}
        </div>
      )}
    </AuthLayout>
  );
}
