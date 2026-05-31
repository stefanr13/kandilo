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

describe('tax receipt annual summary privacy source alignment', () => {
  it('keeps annual summary private-field deny lists aligned across backend, rules, audit, and smoke gates', () => {
    const functionsSource = readGivingModuleSource();
    const firestoreRulesSource = readFileSync(resolve(process.cwd(), 'firestore.rules'), 'utf8');
    const visibilityAuditSource = readFileSync(resolve(process.cwd(), 'scripts/audit-tax-receipt-visibility.mjs'), 'utf8');
    const annualSmokeSource = readFileSync(resolve(process.cwd(), 'scripts/check-live-annual-receipt-smoke.mjs'), 'utf8');

    const backendFields = extractQuotedList(functionsSource, 'const TAX_RECEIPT_SUMMARY_PRIVATE_FIELDS = [');
    const rulesFields = extractQuotedList(firestoreRulesSource, 'function taxReceiptSummaryOmitsPrivateFields');
    const auditFields = extractQuotedList(visibilityAuditSource, 'const annualSummaryPrivateFields = [');
    const annualSmokeFields = extractQuotedList(annualSmokeSource, 'const annualSummaryPrivateFields = [');

    expectUnique(backendFields, 'Functions TAX_RECEIPT_SUMMARY_PRIVATE_FIELDS');
    expectUnique(rulesFields, 'Firestore taxReceiptSummaryOmitsPrivateFields');
    expectUnique(auditFields, 'visibility audit annualSummaryPrivateFields');
    expectUnique(annualSmokeFields, 'live annual smoke annualSummaryPrivateFields');

    expect(rulesFields).toEqual(backendFields);
    expect(auditFields).toEqual(backendFields);
    expect(annualSmokeFields).toEqual(backendFields);
  });
});
