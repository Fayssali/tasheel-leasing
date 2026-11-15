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
