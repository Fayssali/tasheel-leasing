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

export interface QuotationLineInput {
  label: string;
  quantity: number;
  unitPrice: string;
}

export interface QuotationTotals {
  lines: Array<QuotationLineInput & { lineTotal: string }>;
  subtotal: string;
  vatAmount: string;
  total: string;
}

const RATE_RE = /^\d{1,2}(\.\d{1,4})?$/;

/**
 * Quotation totals in integer centimes. VAT = subtotal × rate / 100, rounded half up to the
 * centime. The rate is whatever the supplier enters (no tax rate is hardcoded).
 */
export function computeQuotationTotals(
  lines: QuotationLineInput[],
  vatRate: string,
): QuotationTotals {
  if (!RATE_RE.test(vatRate)) throw new Error(`Invalid VAT rate: ${vatRate}`);
  const [ri = '0', rf = ''] = vatRate.split('.');
  const rateTenThousandths = BigInt(ri) * 10_000n + BigInt(rf.padEnd(4, '0')); // 19.5 → 195000

  let subtotal = 0n;
  const out = lines.map((l) => {
    if (!Number.isInteger(l.quantity) || l.quantity < 1)
      throw new Error('Quantity must be a positive integer');
    const lineTotal = toCentimes(l.unitPrice) * BigInt(l.quantity);
    subtotal += lineTotal;
    return { ...l, lineTotal: fromCentimes(lineTotal) };
  });
  // centimes × rate(1e-4 %) / (100 × 10 000), half up.
  const denom = 1_000_000n;
  const vat = (subtotal * rateTenThousandths + denom / 2n) / denom;
  return {
    lines: out,
    subtotal: fromCentimes(subtotal),
    vatAmount: fromCentimes(vat),
    total: fromCentimes(subtotal + vat),
  };
}

export interface InvoiceTotals {
  subtotal: string;
  vatAmount: string;
  total: string;
}

/**
 * Invoice totals from line amounts (excluding VAT) and the VAT rate configured by Tasheel.
 * VAT is computed once on the subtotal, rounded half away from zero to the centime, so a credit
 * note (negative lines) mirrors its invoice exactly.
 */
export function computeInvoiceTotals(lineAmounts: string[], vatRate: string): InvoiceTotals {
  if (!/^\d{1,2}(\.\d{1,4})?$/.test(vatRate)) throw new Error(`Invalid VAT rate: ${vatRate}`);
  const [ri = '0', rf = ''] = vatRate.split('.');
  const rate = BigInt(ri) * 10_000n + BigInt(rf.padEnd(4, '0'));
  const subtotal = lineAmounts.reduce((sum, a) => sum + toCentimes(a), 0n);
  const abs = subtotal < 0n ? -subtotal : subtotal;
  const vatAbs = (abs * rate + 500_000n) / 1_000_000n;
  const vat = subtotal < 0n ? -vatAbs : vatAbs;
  return {
    subtotal: fromCentimes(subtotal),
    vatAmount: fromCentimes(vat),
    total: fromCentimes(subtotal + vat),
  };
}
