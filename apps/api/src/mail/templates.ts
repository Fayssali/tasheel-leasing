import ar from '@tasheel/i18n/locales/ar.json';
import en from '@tasheel/i18n/locales/en.json';
import fr from '@tasheel/i18n/locales/fr.json';
import { isRtl, type Locale } from '@tasheel/shared';
import type { OutgoingMail } from './mailer';

type Catalogue = typeof fr;
const CATALOGUES: Record<Locale, Catalogue> = { fr, ar, en };

function lookup(locale: Locale, key: string): string {
  const read = (cat: Catalogue) =>
    key
      .split('.')
      .reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], cat);
  const value = read(CATALOGUES[locale]) ?? read(CATALOGUES.fr);
  if (typeof value !== 'string') throw new Error(`Missing translation: ${key}`);
  return value;
}

function interpolate(text: string, vars: Record<string, string | number>): string {
  return text.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(vars[name] ?? ''));
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

interface TemplateInput {
  locale: Locale;
  to: string;
  name: string;
  /** Translation key prefix, e.g. "email.verify". */
  key:
    | 'email.verify'
    | 'email.reset'
    | 'email.passwordChanged'
    | 'email.invite'
    | 'email.orgVerified'
    | 'email.orgRejected'
    | 'email.orgSuspended'
    | 'email.quoteRequested'
    | 'email.quoteIssued'
    | 'email.quoteAccepted'
    | 'email.quoteDeclined'
    | 'email.documentRejected'
    | 'email.applicationReceived'
    | 'email.infoRequested'
    | 'email.infoProvided'
    | 'email.offerReceived'
    | 'email.applicationDeclined'
    | 'email.offerAccepted'
    | 'email.offerDeclined'
    | 'email.applicationWithdrawn'
    | 'email.invoiceIssued';
  vars?: Record<string, string | number>;
  /** Call-to-action link; omitted for notification-only emails. */
  actionUrl?: string;
}

/** Builds a plain-text + HTML email in the user's language, right-to-left for Arabic. */
export function buildMail({
  locale,
  to,
  name,
  key,
  vars = {},
  actionUrl,
}: TemplateInput): OutgoingMail {
  const t = (k: string) => interpolate(lookup(locale, k), { name, ...vars });
  const subject = t(`${key}.subject`);
  const greeting = name.trim() ? t('email.greeting') : t('email.greetingNoName');
  const body = t(`${key}.body`);
  const footer = t('email.footer');
  const ignore = actionUrl ? t('email.ignore') : null;
  const cta = actionUrl ? t(`${key}.cta`) : null;

  const text = [
    greeting,
    '',
    body,
    ...(actionUrl ? ['', `${cta}: ${actionUrl}`] : []),
    ...(ignore ? ['', ignore] : []),
    '',
    '—',
    footer,
  ].join('\n');

  const dir = isRtl(locale) ? 'rtl' : 'ltr';
  const align = dir === 'rtl' ? 'right' : 'left';
  const button =
    actionUrl && cta
      ? `<p style="margin:24px 0"><a href="${escapeHtml(actionUrl)}" style="background:#D99A2B;color:#0B2E4F;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600">${escapeHtml(cta)}</a></p>
         <p style="font-size:12px;color:#6b7280;word-break:break-all">${escapeHtml(actionUrl)}</p>`
      : '';

  const html = `<!doctype html><html lang="${locale}" dir="${dir}"><body style="margin:0;background:#f3f4f6;font-family:'IBM Plex Sans','IBM Plex Sans Arabic',Arial,sans-serif">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px">
    <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;text-align:${align}">
      <tr><td style="background:#0B2E4F;color:#ffffff;padding:16px 24px;font-weight:600;border-radius:8px 8px 0 0">Tasheel Leasing</td></tr>
      <tr><td style="padding:24px;color:#111827;line-height:1.6">
        <p>${escapeHtml(greeting)}</p>
        <p>${escapeHtml(body)}</p>
        ${button}
        ${ignore ? `<p style="font-size:13px;color:#6b7280">${escapeHtml(ignore)}</p>` : ''}
      </td></tr>
      <tr><td style="padding:16px 24px;border-top:1px solid #e5e7eb;font-size:12px;color:#6b7280">${escapeHtml(footer)}</td></tr>
    </table>
  </td></tr></table></body></html>`;

  return { to, subject, text, html };
}
