import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const scriptPath = resolve(process.cwd(), 'scripts/check-resend-live.mjs');
const {
  evaluateResendDomains,
  expectedResendDomain,
  fetchResendDomains,
  normalizeDomainName,
  resendApiKeyLooksValid,
  resendDomainsUrl,
  validateNoLiveCheckArgs,
} = await import('../../scripts/check-resend-live.mjs');

type ResendDomainFixture = {
  id: string;
  name: string;
  status: string;
  created_at: string;
  region: string;
};

type Check = {
  ok: boolean;
  label: string;
  detail: string;
  severity: string;
};

function domainFixture(overrides: Partial<ResendDomainFixture> = {}): ResendDomainFixture {
  return {
    id: 'domain_live_kandilo',
    name: expectedResendDomain,
    status: 'verified',
    created_at: '2026-05-25T00:00:00.000Z',
    region: 'us-east-1',
    ...overrides,
  };
}

function failingLabels(checks: Check[]) {
  return checks
    .filter((check) => !check.ok && check.severity !== 'warn')
    .map((check) => check.label);
}

function warningLabels(checks: Check[]) {
  return checks
    .filter((check) => !check.ok && check.severity === 'warn')
    .map((check) => check.label);
}

describe('live Resend sending-domain checker', () => {
  it('accepts one verified Kandilo sending domain', () => {
    const { checks, domain } = evaluateResendDomains([domainFixture()]);

    expect(domain?.name).toBe(expectedResendDomain);
    expect(failingLabels(checks)).toEqual([]);
    expect(warningLabels(checks)).toEqual([]);
  });

  it('rejects missing or unverified sending domains', () => {
    const missing = evaluateResendDomains([domainFixture({ name: 'example.org' })]).checks;
    const pending = evaluateResendDomains([domainFixture({ status: 'pending' })]).checks;

    expect(failingLabels(missing)).toContain(`Resend has the ${expectedResendDomain} sending domain`);
    expect(failingLabels(pending)).toContain(`Resend sending domain ${expectedResendDomain} is verified`);
    expect(pending.map((check) => check.detail).join('\n')).toContain('Current status: pending.');
    expect(pending.map((check) => check.detail).join('\n')).not.toContain('domain_live_kandilo');
  });

  it('rejects duplicate domain entries without exposing domain record details', () => {
    const { checks } = evaluateResendDomains([
      domainFixture({ id: 'first' }),
      domainFixture({ id: 'second' }),
    ]);

    expect(failingLabels(checks)).toContain(`Resend has one ${expectedResendDomain} domain entry`);
    expect(warningLabels(checks)).toEqual([]);
    expect(checks.map((check) => check.detail).join('\n')).not.toContain('first');
    expect(checks.map((check) => check.detail).join('\n')).not.toContain('second');
  });

  it('normalizes domain names and accepts only Resend-shaped API keys', () => {
    expect(normalizeDomainName('  KANDILO.ORG  ')).toBe('kandilo.org');
    expect(normalizeDomainName(null)).toBe('');
    expect(resendApiKeyLooksValid('re_live_123')).toBe(true);
    expect(resendApiKeyLooksValid(' sk_live_123')).toBe(false);
    expect(resendApiKeyLooksValid('')).toBe(false);
  });

  it('rejects unknown CLI arguments before reading live Resend domains', () => {
    expect(() => validateNoLiveCheckArgs(['--domain', expectedResendDomain])).toThrow('Unknown argument --domain');
    expect(() => validateNoLiveCheckArgs([expectedResendDomain])).toThrow('Unexpected positional argument');
    expect(() => validateNoLiveCheckArgs(['--help=true'])).toThrow('--help does not accept a value');

    const result = spawnSync(process.execPath, [scriptPath, '--domain', expectedResendDomain], {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: { ...process.env, RESEND_API_KEY: 're_should_not_run' },
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Unknown argument --domain.');
    expect(result.stderr).toContain('Usage:');
    expect(result.stdout).toBe('');
  });

  it('lists Resend domains with a caller-supplied fetch implementation', async () => {
    const fetchImpl = async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toBe(resendDomainsUrl);
      expect(init?.headers).toEqual({ Authorization: 'Bearer re_live_check' });
      return new Response(JSON.stringify({
        data: {
          data: [domainFixture()],
        },
      }), { status: 200 });
    };

    const domains = await fetchResendDomains('re_live_check', { fetchImpl });

    expect(domains).toHaveLength(1);
    expect(domains[0]).toMatchObject({ name: expectedResendDomain, status: 'verified' });
  });

  it('surfaces Resend API errors without printing private response details', async () => {
    const fetchImpl = async () => new Response(JSON.stringify({
      name: 'validation_error',
      code: 'domain_live_kandilo',
      message: 'Invalid API key for domain_live_kandilo using resend_verification_token_123.',
      error: {
        name: 'domain_live_kandilo',
        message: 'Legal Parish Corp receipt sender failed DNS validation.',
      },
    }), { status: 401 });

    let errorMessage = '';
    try {
      await fetchResendDomains('re_live_check', { fetchImpl });
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : String(error);
    }

    expect(errorMessage).toBe('HTTP 401 - validation_error');
    expect(errorMessage).not.toContain('domain_live_kandilo');
    expect(errorMessage).not.toContain('resend_verification_token_123');
    expect(errorMessage).not.toContain('Legal Parish Corp');
    expect(errorMessage).not.toContain('Invalid API key');
  });

  it('hides unreadable Resend API error bodies', async () => {
    const fetchImpl = async () => new Response(
      'domain_live_kandilo resend_verification_token_123 Legal Parish Corp',
      { status: 500 }
    );

    await expect(fetchResendDomains('re_live_check', { fetchImpl })).rejects.toThrow(
      'HTTP 500 - unreadable Resend error response'
    );
  });
});
