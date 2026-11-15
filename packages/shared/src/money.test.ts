import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fromCentimes, isMoneyString, toCentimes } from './money';

test('round-trips money strings through centimes without float error', () => {
  assert.equal(fromCentimes(toCentimes('15000000.00')), '15000000.00');
  assert.equal(fromCentimes(toCentimes('0.1') + toCentimes('0.2')), '0.30');
  assert.equal(fromCentimes(toCentimes('-12.5')), '-12.50');
});

test('rejects malformed amounts', () => {
  assert.equal(isMoneyString('1e6'), false);
  assert.equal(isMoneyString('12.345'), false);
  assert.throws(() => toCentimes('abc'));
});

import { computeQuotationTotals } from './money';

test('computes quotation totals exactly, VAT rounded half up to the centime', () => {
  const t = computeQuotationTotals(
    [
      { label: 'Pelle', quantity: 2, unitPrice: '7500000.00' },
      { label: 'Transport', quantity: 1, unitPrice: '125000.55' },
    ],
    '19',
  );
  assert.equal(t.subtotal, '15125000.55');
  assert.equal(t.vatAmount, '2873750.10'); // 2 873 750.1045 → .10
  assert.equal(t.total, '17998750.65');
  assert.equal(t.lines[0]!.lineTotal, '15000000.00');
  assert.equal(
    computeQuotationTotals([{ label: 'x', quantity: 1, unitPrice: '0.05' }], '10').vatAmount,
    '0.01',
  ); // 0.005 → 0.01
  assert.equal(
    computeQuotationTotals([{ label: 'x', quantity: 3, unitPrice: '10' }], '0').total,
    '30.00',
  );
  assert.throws(() => computeQuotationTotals([{ label: 'x', quantity: 1, unitPrice: '1' }], '100'));
});
