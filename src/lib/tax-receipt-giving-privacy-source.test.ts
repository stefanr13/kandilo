import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readGivingModuleSource } from './givingModuleSource';

function extractQuotedList(source: string, anchor: string): string[] {
  const start = source.indexOf(anchor);
  expect(start).toBeGreaterThan(-1);

  const listMatch = source.slice(start).match(/\[([\s\S]*?)\]/);
  expect(listMatch).not.toBeNull();

  return Array.from((listMatch?.[1] ?? '').matchAll(/'([^']+)'/g), (match) => match[1]);
}

function expectUnique(fields: string[], label: string): void {
  expect(new Set(fields).size, `${label} contains duplicate private field names`).toBe(fields.length);
}

describe('tax receipt giving privacy source alignment', () => {
  it('keeps church-facing giving private payment deny lists aligned across backend, rules, audit, and smoke gates', () => {
    const functionsSource = readGivingModuleSource();
    const firestoreRulesSource = readFileSync(resolve(process.cwd(), 'firestore.rules'), 'utf8');
    const visibilityAuditSource = readFileSync(resolve(process.cwd(), 'scripts/audit-tax-receipt-visibility.mjs'), 'utf8');
    const liveDonationSmokeSource = readFileSync(resolve(process.cwd(), 'scripts/check-live-donation-smoke.mjs'), 'utf8');

    const backendFields = extractQuotedList(functionsSource, 'const GIVING_PRIVATE_PAYMENT_FIELDS = [');
    const rulesFields = extractQuotedList(firestoreRulesSource, 'function givingOmitsPrivatePaymentFields');
    const auditFields = extractQuotedList(visibilityAuditSource, 'const givingPrivatePaymentFields = [');
    const liveSmokeFields = extractQuotedList(liveDonationSmokeSource, 'const givingPrivatePaymentFields = [');

    expectUnique(backendFields, 'Functions GIVING_PRIVATE_PAYMENT_FIELDS');
    expectUnique(rulesFields, 'Firestore givingOmitsPrivatePaymentFields');
    expectUnique(auditFields, 'visibility audit givingPrivatePaymentFields');
    expectUnique(liveSmokeFields, 'live donation smoke givingPrivatePaymentFields');

    expect(rulesFields).toEqual(backendFields);
    expect(auditFields).toEqual(backendFields);
    expect(liveSmokeFields).toEqual(backendFields);
  });
});
