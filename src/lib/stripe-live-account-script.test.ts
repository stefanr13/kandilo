import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const scriptPath = resolve(process.cwd(), 'scripts/check-stripe-live-account.mjs');
const {
  countRequirementFields,
  evaluateStripeAccountReadiness,
  fetchStripeAccount,
  stripeAccountUrl,
  validateNoLiveCheckArgs,
} = await import('../../scripts/check-stripe-live-account.mjs');
const { expectedStripeApiVersion } = await import('../../scripts/check-stripe-live-webhook.mjs');

type StripeAccountFixture = {
  charges_enabled: boolean;
  payouts_enabled: boolean;
  details_submitted: boolean;
  country: string;
  default_currency: string;
  requirements: {
    currently_due: string[];
    past_due: string[];
    eventually_due: string[];
    disabled_reason: string | null;
  };
  future_requirements?: {
    currently_due: string[];
    past_due: string[];
    eventually_due: string[];
    disabled_reason: string | null;
  };
};

type Check = {
  ok: boolean;
  label: string;
  detail: string;
  severity: string;
};

function accountFixture(overrides: Partial<StripeAccountFixture> = {}): StripeAccountFixture {
  return {
    charges_enabled: true,
    payouts_enabled: true,
    details_submitted: true,
    country: 'US',
    default_currency: 'usd',
    requirements: {
      currently_due: [],
      past_due: [],
      eventually_due: [],
      disabled_reason: null,
    },
    future_requirements: {
      currently_due: [],
      past_due: [],
      eventually_due: [],
      disabled_reason: null,
    },
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

describe('live Stripe account readiness checker', () => {
  it('accepts an activated live account without due requirements', () => {
    const { checks, summary } = evaluateStripeAccountReadiness(accountFixture());

    expect(summary.ready).toBe(true);
    expect(summary.country).toBe('US');
    expect(summary.defaultCurrency).toBe('usd');
    expect(failingLabels(checks)).toEqual([]);
    expect(warningLabels(checks)).toEqual([]);
  });

  it('rejects accounts that cannot charge, pay out, or confirm submitted details', () => {
    const { checks, summary } = evaluateStripeAccountReadiness(accountFixture({
      charges_enabled: false,
      payouts_enabled: false,
      details_submitted: false,
      requirements: {
        currently_due: ['business_profile.url', 'representative.first_name'],
        past_due: ['external_account'],
        eventually_due: [],
        disabled_reason: 'requirements.past_due',
      },
    }));

    expect(summary.ready).toBe(false);
    expect(summary.currentlyDueCount).toBe(2);
    expect(summary.pastDueCount).toBe(1);
    expect(summary.disabled).toBe(true);
    expect(failingLabels(checks)).toEqual(expect.arrayContaining([
      'Stripe account can create charges',
      'Stripe account can receive payouts',
      'Stripe account business details are submitted',
      'Stripe account has no currently due requirements',
      'Stripe account has no past-due requirements',
      'Stripe account is not disabled',
    ]));
    expect(checks.map((check) => check.detail).join('\n')).not.toContain('business_profile.url');
    expect(checks.map((check) => check.detail).join('\n')).not.toContain('external_account');
  });

  it('warns but does not fail on eventually due requirements', () => {
    const { checks, summary } = evaluateStripeAccountReadiness(accountFixture({
      requirements: {
        currently_due: [],
        past_due: [],
        eventually_due: ['owners.address.line1'],
        disabled_reason: null,
      },
    }));

    expect(summary.ready).toBe(true);
    expect(summary.eventuallyDueCount).toBe(1);
    expect(failingLabels(checks)).toEqual([]);
    expect(warningLabels(checks)).toContain('Stripe account has no eventually due requirements');
    expect(checks.map((check) => check.detail).join('\n')).not.toContain('owners.address.line1');
  });

  it('warns but does not fail on future requirements without printing field names', () => {
    const { checks, summary } = evaluateStripeAccountReadiness(accountFixture({
      future_requirements: {
        currently_due: ['company.tax_id'],
        past_due: ['representative.verification.document'],
        eventually_due: ['owners.address.line1'],
        disabled_reason: null,
      },
    }));

    expect(summary.ready).toBe(true);
    expect(summary.futureCurrentlyDueCount).toBe(1);
    expect(summary.futurePastDueCount).toBe(1);
    expect(summary.futureEventuallyDueCount).toBe(1);
    expect(failingLabels(checks)).toEqual([]);
    expect(warningLabels(checks)).toContain('Stripe account has no future requirements queued');
    const detail = checks.map((check) => check.detail).join('\n');
    expect(detail).toContain('3 future requirement(s)');
    expect(detail).not.toContain('company.tax_id');
    expect(detail).not.toContain('representative.verification.document');
    expect(detail).not.toContain('owners.address.line1');
  });

  it('counts only populated requirement field names', () => {
    expect(countRequirementFields(['business_profile.url', '', null, 'external_account'])).toBe(2);
    expect(countRequirementFields('business_profile.url')).toBe(0);
  });

  it('rejects unknown CLI arguments before reading the live Stripe account', () => {
    expect(() => validateNoLiveCheckArgs(['--account'])).toThrow('Unknown argument --account');
    expect(() => validateNoLiveCheckArgs(['acct_live'])).toThrow('Unexpected positional argument');
    expect(() => validateNoLiveCheckArgs(['--help=true'])).toThrow('--help does not accept a value');

    const result = spawnSync(process.execPath, [scriptPath, '--account'], {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: { ...process.env, STRIPE_SECRET_KEY: 'sk_live_should_not_run' },
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Unknown argument --account.');
    expect(result.stderr).toContain('Usage:');
    expect(result.stdout).toBe('');
  });

  it('fetches the Stripe account with a caller-supplied fetch implementation', async () => {
    const fetchImpl = async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toBe(stripeAccountUrl);
      expect(init?.headers).toEqual({
        Authorization: 'Bearer sk_live_check',
        'Stripe-Version': expectedStripeApiVersion,
      });
      return new Response(JSON.stringify(accountFixture()), { status: 200 });
    };

    const account = await fetchStripeAccount('sk_live_check', { fetchImpl });

    expect(account).toMatchObject({ charges_enabled: true, payouts_enabled: true });
  });

  it('surfaces Stripe API errors without printing private Stripe response details', async () => {
    const fetchImpl = async () => new Response(JSON.stringify({
      error: {
        type: 'invalid_request_error',
        code: 'resource_missing',
        message: 'No such account acct_123 for business_profile.url at Legal Parish Corp',
      },
    }), { status: 404 });

    let message = '';
    try {
      await fetchStripeAccount('sk_live_check', { fetchImpl });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message).toContain('HTTP 404 - invalid_request_error - resource_missing');
    expect(message).not.toContain('acct_123');
    expect(message).not.toContain('business_profile.url');
    expect(message).not.toContain('Legal Parish Corp');
  });
});
