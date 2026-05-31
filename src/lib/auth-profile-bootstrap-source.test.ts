import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const onUserCreatedPath = resolve(process.cwd(), 'functions/src/onUserCreated.ts');
const profileDbPath = resolve(process.cwd(), 'src/lib/db/profile.ts');
const readinessScriptPath = resolve(process.cwd(), 'scripts/check-stripe-production-readiness.mjs');
const projectDetailsPath = resolve(process.cwd(), 'project-details-start-here.md');
const productionChecklistPath = resolve(process.cwd(), 'FIREBASE_PRODUCTION_CHECKLIST.md');

describe('auth profile bootstrap source scan', () => {
  it('keeps auth-created profiles from overwriting private receipt identity', () => {
    const onUserCreatedSource = readFileSync(onUserCreatedPath, 'utf8');
    const profileDbSource = readFileSync(profileDbPath, 'utf8');
    const readinessSource = readFileSync(readinessScriptPath, 'utf8');
    const projectDetailsSource = readFileSync(projectDetailsPath, 'utf8');
    const productionChecklistSource = readFileSync(productionChecklistPath, 'utf8');

    expect(onUserCreatedSource).toContain('await userRef.create({');
    expect(onUserCreatedSource).toContain("return 'skipped_existing';");
    expect(onUserCreatedSource).toContain("code === 6 || code === 'already-exists' || code === 'ALREADY_EXISTS'");
    expect(onUserCreatedSource).toContain("taxReceiptLegalName: '',");
    expect(onUserCreatedSource).toContain('taxReceiptAddress: {');

    expect(profileDbSource).toContain('export function buildUserProfileRepairPatch');
    expect(profileDbSource).toContain('await setDoc(ref, buildUserProfileRepairPatch(existing.data(), data), { merge: true });');
    expect(profileDbSource).toContain('if (!isStringWithin(current.taxReceiptLegalName, MAX_TAX_RECEIPT_LEGAL_NAME_LENGTH))');
    expect(profileDbSource).toContain('if (!isValidTaxReceiptAddress(current.taxReceiptAddress))');

    expect(readinessSource).toContain('Auth profile bootstrap creates missing donor profiles without overwriting private tax receipt identity');
    expect(projectDetailsSource).toContain('create-only Firestore write and skips existing docs');
    expect(productionChecklistSource).toContain('create-only Firestore write and skips existing user docs');
  });
});
