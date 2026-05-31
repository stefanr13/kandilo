import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const scriptPath = resolve(process.cwd(), 'scripts/seed-receipt-emulator.mjs');

function runSeedScriptWithEnv(env: NodeJS.ProcessEnv) {
  return spawnSync(process.execPath, [scriptPath], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: {
      ...process.env,
      FIRESTORE_EMULATOR_HOST: '127.0.0.1:8088',
      FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9098',
      ...env,
    },
  });
}

describe('receipt emulator seed script', () => {
  it('normalizes emulator hosts with URL parsing before clearing data', () => {
    const source = readFileSync(scriptPath, 'utf8');
    const hostValidationSource = source.slice(
      source.indexOf('function assertLocalEmulatorHost'),
      source.indexOf('const firestoreEmulatorHost')
    );

    expect(source).toContain('function assertLocalEmulatorHost');
    expect(source).toContain('new URL(`http://${value}`)');
    expect(source).toContain('url.username || url.password');
    expect(source).toContain("url.pathname !== '/'");
    expect(source).toContain('Number.parseInt(url.port, 10)');
    expect(source).toContain('return url.host;');
    expect(hostValidationSource).not.toContain('.startsWith(');
  });

  it('rejects emulator host authority tricks', () => {
    const result = runSeedScriptWithEnv({
      FIRESTORE_EMULATOR_HOST: '127.0.0.1:8088@evil.example',
    });

    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain(
      'Refusing to seed because FIRESTORE_EMULATOR_HOST must be a local emulator host:port value'
    );
  });

  it('rejects emulator host paths before issuing clear requests', () => {
    const result = runSeedScriptWithEnv({
      FIREBASE_AUTH_EMULATOR_HOST: 'localhost:9098/path',
    });

    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain(
      'Refusing to seed because FIREBASE_AUTH_EMULATOR_HOST must be a local emulator host:port value'
    );
  });

  it('rejects unknown CLI arguments before issuing clear requests', () => {
    const result = spawnSync(process.execPath, [scriptPath, '--project', 'kandilo-2f7a9'], {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: {
        ...process.env,
        FIRESTORE_EMULATOR_HOST: '127.0.0.1:8088',
        FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9098',
      },
    });

    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('Unknown argument --project.');
    expect(result.stderr).toContain('Usage:');
  });

  it('seeds donor-owned anonymous and unclassified receipt privacy cases', () => {
    const source = readFileSync(scriptPath, 'utf8');

    expect(source).toContain("const anonymousGivingId = 'giving_2026_anonymous';");
    expect(source).toContain("const unclassifiedGivingId = 'giving_2026_unclassified';");
    expect(source).toContain('includeAnonymousField = true');
    expect(source).toContain('record.anonymous = anonymous;');
    expect(source).toContain('includeAnonymousField: false');
    expect(source).toContain('donorNamePublicSafe: includeAnonymousField && anonymous === false');
    expect(source).toContain('const privateAnnualGivingId = `giving_${privateAnnualYear}_anonymous`;');
    expect(source).toContain('donorAnonymous: true');
    expect(source).toContain('donorLabelPublicSafe: donorAnonymous === false');
    expect(source).toContain('receiptManagerSummarySafeVersion: donorAnonymous === false ? 2 : 0');
    expect(source).toContain('receiptManagerGivingSafeVersion: includeAnonymousField && anonymous === false ? 1 : 0');
    expect(source).not.toContain('stripeCheckoutSessionId: `cs_test_${id}`');
    expect(source).not.toContain('stripePaymentIntentId: `pi_test_${id}`');
    expect(source).toContain('Confirm anonymous and unclassified donor-owned rows do not appear in the treasurer queue.');
    expect(source).toContain('Sign in as member@example.com and confirm anonymous/unclassified rows remain visible in Giving.');
  });

  it('seeds a Canadian parish with Canada/CRA receipts unavailable for browser verification', () => {
    const source = readFileSync(scriptPath, 'utf8');

    expect(source).toContain("const CANADA_CHURCH_ID = 'church-ca-1';");
    expect(source).toContain("const canadaGivingId = 'giving_ca_2026_unsupported';");
    expect(source).toContain("const canadaAnnualGivingId = 'giving_ca_2025_annual_unsupported';");
    expect(source).toContain("name: 'Holy Trinity Orthodox Church'");
    expect(source).toContain("country: 'CA'");
    expect(source).toContain("jurisdiction: 'CA'");
    expect(source).toContain('receiptIssueLocation: \'Edmonton, Alberta\'');
    expect(source).toContain('secureElectronicSignatureConfigured: false');
    expect(source).toContain('receiptCopiesRetentionConfirmed: true');
    expect(source).toContain("currency: 'CAD'");
    expect(source).toContain("completedAt: `${annualYear}-08-14T16:20:00.000Z`");
    expect(source).toContain("taxReceiptStatus: 'not_configured'");
    expect(source).toContain("taxReceiptError: 'tax_receipt_unsupported_jurisdiction'");
    expect(source).toContain('Switch to Holy Trinity Orthodox Church and confirm Canadian/CRA receipts are unavailable.');
    expect(source).toContain('the Canadian donation and annual row show the Canada/CRA unavailable state.');
  });
});
