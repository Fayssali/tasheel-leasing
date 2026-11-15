import { buildMail } from '../src/mail/templates';

describe('email templates', () => {
  const link = 'https://app.tasheel.local/reset-password?token=abc';

  it('builds a French reset email with the link and the intermediary disclaimer', () => {
    const mail = buildMail({
      locale: 'fr',
      to: 'a@b.dz',
      name: 'Amel',
      key: 'email.reset',
      vars: { minutes: 30 },
      actionUrl: link,
    });
    expect(mail.subject).toContain('Réinitialisation');
    expect(mail.text).toContain('Bonjour Amel,');
    expect(mail.text).toContain('30 minutes');
    expect(mail.text).toContain(link);
    expect(mail.html).toContain('dir="ltr"');
    expect(mail.text).toMatch(/ni une banque ni une société de leasing/);
  });

  it('builds an Arabic email right-to-left', () => {
    const mail = buildMail({
      locale: 'ar',
      to: 'a@b.dz',
      name: 'أمال',
      key: 'email.verify',
      vars: { hours: 48 },
      actionUrl: link,
    });
    expect(mail.html).toContain('dir="rtl"');
    expect(mail.html).toContain('lang="ar"');
    expect(mail.text).toContain('مرحبًا أمال');
    expect(mail.text).toContain('48');
  });

  it('escapes user-provided values in HTML', () => {
    const mail = buildMail({
      locale: 'en',
      to: 'a@b.dz',
      name: '<script>x</script>',
      key: 'email.passwordChanged',
    });
    expect(mail.html).not.toContain('<script>');
    expect(mail.html).toContain('&lt;script&gt;');
  });

  it('omits the button and the "ignore" line for notification-only emails', () => {
    const mail = buildMail({
      locale: 'en',
      to: 'a@b.dz',
      name: 'Sam',
      key: 'email.passwordChanged',
    });
    expect(mail.html).not.toContain('<a href');
    expect(mail.text).not.toContain('ignore');
  });
});
