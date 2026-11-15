/**
 * Financing calculations. Rates, criteria and fees always come from the institution's own
 * product or offer; nothing here is a platform assumption. Results are exact to the centime
 * (integer arithmetic) and anything shown before an offer is labelled indicative.
 */
import { fromCentimes, toCentimes } from './money';

const RATE_RE = /^\d{1,2}(\.\d{1,4})?$/;
const SCALE = 10n ** 18n;

/** "7.25" (annual %) → 72500 (ten-thousandths of a percent). */
function rateUnits(ratePct: string): bigint {
  if (!RATE_RE.test(ratePct)) throw new Error(`Invalid rate: ${ratePct}`);
  const [i = '0', f = ''] = ratePct.split('.');
  return BigInt(i) * 10_000n + BigInt(f.padEnd(4, '0'));
}

const divHalfUp = (num: bigint, den: bigint) => (num + den / 2n) / den;

export interface InstallmentInput {
  financedAmount: string;
  ratePct: string; // annual, as entered by the institution
  durationMonths: number;
  residualValue?: string; // purchase option paid at the end
}

export interface InstallmentResult {
  installment: string; // monthly, constant
  totalInstallments: string;
}

/**
 * Constant monthly installment of a financing with an optional residual value:
 * (P − RV/(1+r)^n) · r / (1 − (1+r)^−n), r = annual rate / 12. Rate 0 → (P − RV) / n.
 */
export function computeInstallment(input: InstallmentInput): InstallmentResult {
  const n = input.durationMonths;
  if (!Number.isInteger(n) || n < 1 || n > 240) throw new Error('Duration must be 1 to 240 months');
  const p = toCentimes(input.financedAmount);
  const rv = toCentimes(input.residualValue ?? '0');
  if (p <= 0n) throw new Error('Financed amount must be positive');
  if (rv < 0n || rv >= p) throw new Error('Residual value must be below the financed amount');

  const units = rateUnits(input.ratePct);
  let installment: bigint;
  if (units === 0n) {
    installment = divHalfUp(p - rv, BigInt(n));
  } else {
    const r = (units * SCALE) / 12_000_000n; // monthly rate × SCALE
    let pow = SCALE; // (1 + r)^n × SCALE
    for (let k = 0; k < n; k++) pow = (pow * (SCALE + r)) / SCALE;
    const principal = p * SCALE - (rv * SCALE * SCALE) / pow; // centimes × SCALE
    installment = divHalfUp(principal * r * pow, SCALE * SCALE * (pow - SCALE));
  }
  return {
    installment: fromCentimes(installment),
    totalInstallments: fromCentimes(installment * BigInt(n)),
  };
}

/** Total cost to the business: down payment + installments + fees + residual value. */
export function computeTotalCost(i: {
  downPayment: string;
  totalInstallments: string;
  fees: string;
  residualValue: string;
}): string {
  return fromCentimes(
    toCentimes(i.downPayment) +
      toCentimes(i.totalInstallments) +
      toCentimes(i.fees) +
      toCentimes(i.residualValue),
  );
}

export interface MatchProduct {
  productType: 'LEASING' | 'IJARA';
  minAmount: string;
  maxAmount: string;
  minDurationMonths: number;
  maxDurationMonths: number;
  minDownPaymentPct: string;
  categoryCodes: string[];
  wilayaCodes: string[];
  minYearsInBusiness: number;
}

export interface MatchApplication {
  equipmentAmount: string;
  downPayment: string;
  financedAmount: string;
  durationMonths: number;
  categoryCode: string;
  wilayaCode: string | null;
  yearsInBusiness: number | null;
  preferredType: 'LEASING' | 'IJARA' | null;
}

export type MatchCriterion =
  'amount' | 'duration' | 'downPayment' | 'category' | 'wilaya' | 'yearsInBusiness' | 'productType';

export interface MatchResult {
  /** Share of the product's published criteria met, 0–100. Indicative only. */
  score: number;
  checks: Array<{ criterion: MatchCriterion; met: boolean }>;
}

/**
 * Indicative fit between an application and a product's published criteria. It is a reading
 * aid for the business, never an eligibility or credit decision: only the institution decides.
 */
export function matchProduct(product: MatchProduct, app: MatchApplication): MatchResult {
  const financed = toCentimes(app.financedAmount);
  const equipment = toCentimes(app.equipmentAmount);
  const down = toCentimes(app.downPayment);
  const minPctHundredths = toCentimes(product.minDownPaymentPct); // "20.00" → 2000
  const checks: MatchResult['checks'] = [
    {
      criterion: 'amount',
      met: financed >= toCentimes(product.minAmount) && financed <= toCentimes(product.maxAmount),
    },
    {
      criterion: 'duration',
      met:
        app.durationMonths >= product.minDurationMonths &&
        app.durationMonths <= product.maxDurationMonths,
    },
    { criterion: 'downPayment', met: down * 10_000n >= minPctHundredths * equipment },
    {
      criterion: 'category',
      met: product.categoryCodes.length === 0 || product.categoryCodes.includes(app.categoryCode),
    },
    {
      criterion: 'wilaya',
      met:
        product.wilayaCodes.length === 0 ||
        (!!app.wilayaCode && product.wilayaCodes.includes(app.wilayaCode)),
    },
    {
      criterion: 'yearsInBusiness',
      met:
        product.minYearsInBusiness === 0 ||
        (app.yearsInBusiness ?? 0) >= product.minYearsInBusiness,
    },
  ];
  if (app.preferredType)
    checks.push({ criterion: 'productType', met: app.preferredType === product.productType });
  const met = checks.filter((c) => c.met).length;
  return { score: Math.round((met * 100) / checks.length), checks };
}
