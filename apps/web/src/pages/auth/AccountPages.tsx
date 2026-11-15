import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';
import { Alert, Button, Spinner, TextInput } from '../../components/ui';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useErrorMessage } from '../../lib/format';
import { AuthLayout } from './AuthLayout';

export function VerifyEmailPage() {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const { status, reloadMe } = useAuth();
  const errorMessage = useErrorMessage();
  const [state, setState] = useState<'working' | 'done' | 'error'>('working');
  const [error, setError] = useState('');
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return; // StrictMode runs effects twice; the link is single-use.
    started.current = true;
    api('/auth/email/verify', { method: 'POST', body: { token: params.get('token') ?? '' } })
      .then(() => {
        setState('done');
        if (status === 'authenticated') void reloadMe();
      })
      .catch((err) => {
        setError(errorMessage(err));
        setState('error');
      });
  }, [params, status, reloadMe, errorMessage]);

  return (
    <AuthLayout title={t('verify.title')}>
      {state === 'working' && (
        <div className="flex justify-center py-6 text-primary-600">
          <Spinner />
        </div>
      )}
      {state === 'done' && (
        <div className="space-y-4">
          <Alert tone="success">{t('verify.done')}</Alert>
          <Link
            to={status === 'authenticated' ? '/app' : '/login'}
            className="block text-center font-semibold text-primary-600 hover:underline"
          >
            {t('common.continue')}
          </Link>
        </div>
      )}
      {state === 'error' && <Alert tone="danger">{error}</Alert>}
    </AuthLayout>
  );
}

export function ForgotPasswordPage() {
  const { t } = useTranslation();
  const errorMessage = useErrorMessage();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('/auth/password/forgot', { method: 'POST', body: { email } });
      setSent(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout title={t('reset.forgotTitle')} subtitle={t('reset.forgotSubtitle')}>
      {sent ? (
        <div className="space-y-4">
          <Alert tone="success">{t('reset.sent')}</Alert>
          <Link
            to="/login"
            className="block text-center font-semibold text-primary-600 hover:underline"
          >
            {t('auth.backToLogin')}
          </Link>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          {error && <Alert tone="danger">{error}</Alert>}
          <TextInput
            label={t('fields.email')}
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            dir="ltr"
          />
          <Button type="submit" loading={busy} className="w-full">
            {t('reset.sendLink')}
          </Button>
          <Link to="/login" className="block text-center text-sm text-primary-600 hover:underline">
            {t('auth.backToLogin')}
          </Link>
        </form>
      )}
    </AuthLayout>
  );
}

export function ResetPasswordPage() {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const errorMessage = useErrorMessage();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tooShort = password.length > 0 && password.length < 12;
  const mismatch = confirm.length > 0 && confirm !== password;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (tooShort || mismatch) return;
    setBusy(true);
    setError(null);
    try {
      await api('/auth/password/reset', {
        method: 'POST',
        body: { token: params.get('token') ?? '', password },
      });
      setDone(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout title={t('reset.title')}>
      {done ? (
        <div className="space-y-4">
          <Alert tone="success">{t('reset.done')}</Alert>
          <Link
            to="/login"
            className="block text-center font-semibold text-primary-600 hover:underline"
          >
            {t('nav.signIn')}
          </Link>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          {error && <Alert tone="danger">{error}</Alert>}
          <TextInput
            label={t('fields.newPassword')}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="new-password"
            hint={t('fields.passwordHint')}
            error={tooShort ? t('fields.passwordHint') : undefined}
          />
          <TextInput
            label={t('fields.confirmPassword')}
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            required
            autoComplete="new-password"
            error={mismatch ? t('fields.passwordMismatch') : undefined}
          />
          <Alert tone="neutral">{t('reset.signOutNotice')}</Alert>
          <Button type="submit" loading={busy} className="w-full">
            {t('reset.submit')}
          </Button>
        </form>
      )}
    </AuthLayout>
  );
}
