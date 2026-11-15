import { useMutation } from '@tanstack/react-query';
import QRCode from 'qrcode';
import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Badge, Button, Card, PageHeader, TextInput } from '../../components/ui';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useErrorMessage } from '../../lib/format';

function RecoveryCodes({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  return (
    <div className="space-y-4">
      <Alert tone="action" title={t('security.recoveryTitle')}>
        {t('security.recoveryBody')}
      </Alert>
      <ul
        className="grid grid-cols-2 gap-2 rounded-lg bg-gray-50 p-4 font-mono text-sm sm:grid-cols-5"
        dir="ltr"
      >
        {codes.map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ul>
      <div className="flex gap-2">
        <Button
          variant="secondary"
          onClick={async () => {
            await navigator.clipboard.writeText(codes.join('\n'));
            setCopied(true);
          }}
        >
          {copied ? t('common.copied') : t('common.copy')}
        </Button>
        <Button onClick={onDone}>{t('security.savedCodes')}</Button>
      </div>
    </div>
  );
}

export function SecurityPage() {
  const { t } = useTranslation();
  const { me, reloadMe } = useAuth();
  const errorMessage = useErrorMessage();

  const [password, setPassword] = useState('');
  const [setup, setSetup] = useState<{ secret: string; otpauthUri: string } | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [codes, setCodes] = useState<string[] | null>(null);
  const [regenCode, setRegenCode] = useState('');

  useEffect(() => {
    if (setup) void QRCode.toDataURL(setup.otpauthUri, { margin: 1, width: 200 }).then(setQr);
  }, [setup]);

  const start = useMutation({
    mutationFn: () =>
      api<{ secret: string; otpauthUri: string }>('/auth/mfa/setup', {
        method: 'POST',
        body: { password },
      }),
    onSuccess: (data) => {
      setSetup(data);
      setPassword('');
    },
  });
  const enable = useMutation({
    mutationFn: () =>
      api<{ recoveryCodes: string[] }>('/auth/mfa/enable', { method: 'POST', body: { code } }),
    onSuccess: (data) => {
      setCodes(data.recoveryCodes);
      setSetup(null);
      setCode('');
    },
  });
  const regenerate = useMutation({
    mutationFn: () =>
      api<{ recoveryCodes: string[] }>('/auth/mfa/recovery-codes', {
        method: 'POST',
        body: { code: regenCode },
      }),
    onSuccess: (data) => {
      setCodes(data.recoveryCodes);
      setRegenCode('');
    },
  });

  if (!me) return null;
  const enabled = me.user.mfaEnabled;

  return (
    <>
      <PageHeader title={t('security.title')} subtitle={t('security.subtitle')} />
      <Card
        title={t('security.mfa')}
        actions={
          enabled ? (
            <Badge tone="success">{t('security.enabled')}</Badge>
          ) : (
            <Badge tone={me.user.mfaSetupRequired ? 'action' : 'neutral'}>
              {t('security.disabled')}
            </Badge>
          )
        }
      >
        {codes ? (
          <RecoveryCodes
            codes={codes}
            onDone={async () => {
              setCodes(null);
              await reloadMe();
            }}
          />
        ) : enabled ? (
          <form
            className="space-y-4"
            onSubmit={(e: FormEvent) => {
              e.preventDefault();
              regenerate.mutate();
            }}
          >
            <p className="text-sm text-gray-700">{t('security.enabledBody')}</p>
            {regenerate.isError && <Alert tone="danger">{errorMessage(regenerate.error)}</Alert>}
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <div className="sm:w-60">
                <TextInput
                  label={t('auth.mfaCode')}
                  value={regenCode}
                  onChange={(e) => setRegenCode(e.target.value)}
                  required
                  dir="ltr"
                  autoComplete="one-time-code"
                />
              </div>
              <Button type="submit" variant="secondary" loading={regenerate.isPending}>
                {t('security.regenerate')}
              </Button>
            </div>
          </form>
        ) : setup ? (
          <form
            className="space-y-4"
            onSubmit={(e: FormEvent) => {
              e.preventDefault();
              enable.mutate();
            }}
          >
            <ol className="list-decimal space-y-2 ps-5 text-sm text-gray-700">
              <li>{t('security.step1')}</li>
              <li>{t('security.step2')}</li>
            </ol>
            <div className="flex flex-col items-start gap-4 sm:flex-row">
              {qr && (
                <img
                  src={qr}
                  alt={t('security.qrAlt')}
                  width={200}
                  height={200}
                  className="rounded border border-gray-200"
                />
              )}
              <div className="space-y-2 text-sm">
                <p className="text-gray-600">{t('security.manualKey')}</p>
                <code className="block break-all rounded bg-gray-50 p-2 font-mono" dir="ltr">
                  {setup.secret.match(/.{1,4}/g)?.join(' ')}
                </code>
              </div>
            </div>
            {enable.isError && <Alert tone="danger">{errorMessage(enable.error)}</Alert>}
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <div className="sm:w-60">
                <TextInput
                  label={t('security.enterCode')}
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  required
                  inputMode="numeric"
                  dir="ltr"
                  autoComplete="one-time-code"
                />
              </div>
              <Button type="submit" loading={enable.isPending}>
                {t('security.activate')}
              </Button>
            </div>
          </form>
        ) : (
          <form
            className="space-y-4"
            onSubmit={(e: FormEvent) => {
              e.preventDefault();
              start.mutate();
            }}
          >
            <p className="text-sm text-gray-700">
              {me.user.mfaSetupRequired ? t('security.requiredBody') : t('security.optionalBody')}
            </p>
            {start.isError && <Alert tone="danger">{errorMessage(start.error)}</Alert>}
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <div className="sm:w-72">
                <TextInput
                  label={t('security.confirmPassword')}
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                />
              </div>
              <Button type="submit" variant="accent" loading={start.isPending}>
                {t('security.start')}
              </Button>
            </div>
          </form>
        )}
      </Card>
    </>
  );
}
