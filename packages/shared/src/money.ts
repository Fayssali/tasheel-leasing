/**
 * Money is exchanged as a decimal string with 2 decimals ("15000000.00") and stored as
 * NUMERIC(18,2). Never use JavaScript floating point for amounts.
 * Arithmetic is done in integer centimes with BigInt.
 */

const MONEY_RE = /^-?\d{1,16}(\.\d{1,2})?$/;

export const DEFAULT_CURRENCY = 'DZD';

export function isMoneyString(value: string): boolean {
  return MONEY_RE.test(value);
}

export function toCentimes(value: string): bigint {
  if (!isMoneyString(value)) throw new Error(`Invalid money string: ${value}`);
  const negative = value.startsWith('-');
  const [intPart = '0', fracPart = ''] = value.replace('-', '').split('.');
  const cents = BigInt(intPart) * 100n + BigInt(fracPart.padEnd(2, '0'));
  return negative ? -cents : cents;
}

export function fromCentimes(cents: bigint): string {
  const negative = cents < 0n;
  const abs = negative ? -cents : cents;
  const intPart = abs / 100n;
  const frac = (abs % 100n).toString().padStart(2, '0');
  return `${negative ? '-' : ''}${intPart}.${frac}`;
}

/** Locale-aware display, e.g. "15 000 000 DZD" (fr) or "15,000,000 د.ج.‏" (ar). Display only. */
export function formatMoney(value: string, locale: string, currency = DEFAULT_CURRENCY): string {
  const cents = toCentimes(value);
  const hasCents = cents % 100n !== 0n;
  // Intl accepts decimal strings without converting through float in modern runtimes.
  return new Intl.NumberFormat(locale === 'ar' ? 'ar-DZ-u-nu-latn' : `${locale}-DZ`, {
    style: 'currency',
    currency,
    minimumFractionDigits: hasCents ? 2 : 0,
    maximumFractionDigits: 2,
  }).format(value as unknown as number);
}
