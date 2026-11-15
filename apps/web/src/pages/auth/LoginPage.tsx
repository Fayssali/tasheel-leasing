import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { Alert, Button, TextInput } from '../../components/ui';
import { useAuth } from '../../lib/auth';
import { useErrorMessage } from '../../lib/format';
import { homePathFor } from '../../routes';
import { AuthLayout } from './AuthLayout';

export function LoginPage() {
  const { t } = useTranslation();
  const { login, verifyMfa } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const errorMessage = useErrorMessage();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mfaToken, setMfaToken] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const done = (me: Awaited<ReturnType<ReturnType<typeof useAuth>['reloadMe']>>) => {
    const redirect = params.get('redirect');
    navigate(redirect && redirect.startsWith('/') ? redirect : homePathFor(me), { replace: true });
  };

  const { reloadMe } = useAuth();

  async function submitPassword(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const challenge = await login(email.trim(), password);
      if (challenge) setMfaToken(challenge.mfaToken);
      else done(await reloadMe());
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function submitCode(e: FormEvent) {
    e.preventDefault();
    if (!mfaToken) return;
    setError(null);
    setBusy(true);
    try {
      await verifyMfa(mfaToken, code.trim());
      done(await reloadMe());
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (mfaToken) {
    return (
      <AuthLayout title={t('auth.mfaTitle')} subtitle={t('auth.mfaSubtitle')}>
        <form onSubmit={submitCode} className="space-y-4">
          {error && <Alert tone="danger">{error}</Alert>}
          <TextInput
            label={t('auth.mfaCode')}
            hint={t('auth.mfaCodeHint')}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            autoComplete="one-time-code"
            inputMode="text"
            autoFocus
            required
            dir="ltr"
          />
          <Button type="submit" loading={busy} className="w-full">
            {t('auth.verify')}
          </Button>
          <button
            type="button"
            className="w-full text-sm text-primary-600 hover:underline"
            onClick={() => setMfaToken(null)}
          >
            {t('auth.backToLogin')}
          </button>
        </form>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title={t('auth.loginTitle')} subtitle={t('auth.loginSubtitle')}>
      <form onSubmit={submitPassword} className="space-y-4">
        {error && <Alert tone="danger">{error}</Alert>}
        <TextInput
          label={t('fields.email')}
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          required
          dir="ltr"
        />
        <TextInput
          label={t('fields.password')}
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          required
        />
        <div className="text-end">
          <Link to="/forgot-password" className="text-sm text-primary-600 hover:underline">
            {t('auth.forgot')}
          </Link>
        </div>
        <Button type="submit" loading={busy} className="w-full">
          {t('nav.signIn')}
        </Button>
        <p className="text-center text-sm text-gray-600">
          {t('auth.noAccount')}{' '}
          <Link to="/register" className="font-semibold text-primary-600 hover:underline">
            {t('nav.register')}
          </Link>
        </p>
      </form>
    </AuthLayout>
  );
}
