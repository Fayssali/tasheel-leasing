import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeInstallment, computeTotalCost, matchProduct } from './financing';

test('constant installment matches the annuity formula to the centime', () => {
  // 10 000 000 DZD, 12 % a year, 36 months → 332 143.098… (checked with 60-digit decimals).
  const r = computeInstallment({
    financedAmount: '10000000.00',
    ratePct: '12',
    durationMonths: 36,
  });
  assert.equal(r.installment, '332143.10');
  assert.equal(r.totalInstallments, '11957151.60');
});

test('residual value lowers the installment by its present value', () => {
  const without = computeInstallment({
    financedAmount: '10000000',
    ratePct: '9.5',
    durationMonths: 48,
  });
  const withRv = computeInstallment({
    financedAmount: '10000000',
    ratePct: '9.5',
    durationMonths: 48,
    residualValue: '1000000',
  });
  assert.equal(without.installment, '251231.37');
  assert.ok(Number(withRv.installment) < Number(without.installment));
  assert.equal(withRv.installment, '234024.90');
});

test('zero rate splits the amount evenly, half-up to the centime', () => {
  assert.equal(
    computeInstallment({ financedAmount: '1000', ratePct: '0', durationMonths: 3 }).installment,
    '333.33',
  );
  assert.equal(
    computeInstallment({ financedAmount: '1000.01', ratePct: '0', durationMonths: 2 }).installment,
    '500.01',
  );
});

test('rejects impossible inputs', () => {
  assert.throws(() =>
    computeInstallment({ financedAmount: '0', ratePct: '5', durationMonths: 12 }),
  );
  assert.throws(() =>
    computeInstallment({ financedAmount: '100', ratePct: '5', durationMonths: 0 }),
  );
  assert.throws(() =>
    computeInstallment({ financedAmount: '100', ratePct: '150', durationMonths: 12 }),
  );
  assert.throws(() =>
    computeInstallment({
      financedAmount: '100',
      ratePct: '5',
      durationMonths: 12,
      residualValue: '100',
    }),
  );
});

test('total cost adds down payment, installments, fees and residual value', () => {
  assert.equal(
    computeTotalCost({
      downPayment: '2000000',
      totalInstallments: '11957151.24',
      fees: '50000',
      residualValue: '0.76',
    }),
    '14007152.00',
  );
});

test('indicative matching counts the published criteria met', () => {
  const product = {
    productType: 'LEASING' as const,
    minAmount: '1000000',
    maxAmount: '50000000',
    minDurationMonths: 12,
    maxDurationMonths: 60,
    minDownPaymentPct: '10',
    categoryCodes: ['construction'],
    wilayaCodes: [],
    minYearsInBusiness: 2,
  };
  const app = {
    equipmentAmount: '20000000',
    downPayment: '2000000',
    financedAmount: '18000000',
    durationMonths: 48,
    categoryCode: 'construction',
    wilayaCode: '16',
    yearsInBusiness: 5,
    preferredType: null,
  };
  assert.equal(matchProduct(product, app).score, 100);
  const weak = matchProduct(product, {
    ...app,
    downPayment: '1000000',
    financedAmount: '19000000',
    categoryCode: 'medical',
    preferredType: 'IJARA',
  });
  assert.equal(weak.score, 57); // 4 of 7
  assert.deepEqual(
    weak.checks.filter((c) => !c.met).map((c) => c.criterion),
    ['downPayment', 'category', 'productType'],
  );
});
