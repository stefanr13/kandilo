import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const scriptPath = resolve(process.cwd(), 'scripts/check-stripe-live-webhook.mjs');
const {
  evaluateStripeWebhookEndpoints,
  expectedStripeApiVersion,
  expectedStripeWebhookUrl,
  fetchStripeWebhookEndpoints,
  requiredWebhookEvents,
  stripeKeyMode,
  validateNoLiveCheckArgs,
} = await import('../../scripts/check-stripe-live-webhook.mjs');

type WebhookEndpoint = {
  id: string;
  url: string;
  livemode: boolean;
  status: string;
  api_version: string | null;
  enabled_events: string[];
};

type Check = {
  ok: boolean;
  label: string;
  detail: string;
  severity: string;
};

function validEndpoint(overrides: Partial<WebhookEndpoint> = {}): WebhookEndpoint {
  return {
    id: 'we_live_kandilo',
    url: expectedStripeWebhookUrl,
    livemode: true,
    status: 'enabled',
    api_version: expectedStripeApiVersion,
    enabled_events: [...requiredWebhookEvents],
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

describe('live Stripe webhook endpoint checker', () => {
  it('accepts one enabled live endpoint with the pinned API version and required events', () => {
    const { checks } = evaluateStripeWebhookEndpoints([validEndpoint()]);

    expect(failingLabels(checks)).toEqual([]);
    expect(warningLabels(checks)).toEqual([]);
  });

  it('rejects endpoints that are not live, enabled, version-pinned, or fully subscribed', () => {
    const { checks } = evaluateStripeWebhookEndpoints([
      validEndpoint({
        api_version: '2025-01-27.acacia',
        enabled_events: ['checkout.session.completed'],
        livemode: false,
        status: 'disabled',
      }),
    ]);

    expect(failingLabels(checks)).toEqual(expect.arrayContaining([
      'Matching Stripe webhook endpoint is live-mode',
      'Exactly one matching live Stripe webhook endpoint is enabled',
      `Live Stripe webhook endpoint API version is ${expectedStripeApiVersion}`,
      'Live Stripe webhook endpoint subscribes to required donation events',
    ]));
  });

  it('rejects duplicate enabled live endpoints for the production Firebase URL', () => {
    const { checks } = evaluateStripeWebhookEndpoints([
      validEndpoint({ id: 'we_live_first' }),
      validEndpoint({ id: 'we_live_second' }),
    ]);

    expect(failingLabels(checks)).toContain('Exactly one matching live Stripe webhook endpoint is enabled');
  });

  it('rejects wildcard events instead of the explicit donation events', () => {
    const wildcard = evaluateStripeWebhookEndpoints([
      validEndpoint({ enabled_events: ['*'] }),
    ]).checks;

    expect(failingLabels(wildcard)).toContain('Live Stripe webhook endpoint uses explicit events instead of wildcard delivery');
    expect(warningLabels(wildcard)).toEqual([]);
  });

  it('rejects unrelated event subscriptions on the production webhook endpoint', () => {
    const extraEvents = evaluateStripeWebhookEndpoints([
      validEndpoint({ enabled_events: [...requiredWebhookEvents, 'customer.created'] }),
    ]).checks;

    expect(failingLabels(extraEvents)).toContain('Live Stripe webhook endpoint has no unrelated event subscriptions');
    expect(warningLabels(extraEvents)).toEqual([]);
  });

  it('requires a live Stripe secret or restricted key for the network check', () => {
    expect(stripeKeyMode('sk_live_123')).toBe('live');
    expect(stripeKeyMode('rk_live_123')).toBe('live');
    expect(stripeKeyMode('sk_test_123')).toBe('test');
    expect(stripeKeyMode('rk_test_123')).toBe('test');
    expect(stripeKeyMode('whsec_123')).toBe('invalid');
  });

  it('rejects unknown CLI arguments before reading live Stripe endpoints', () => {
    expect(() => validateNoLiveCheckArgs(['--limit', '10'])).toThrow('Unknown argument --limit');
    expect(() => validateNoLiveCheckArgs(['project'])).toThrow('Unexpected positional argument');
    expect(() => validateNoLiveCheckArgs(['--help=true'])).toThrow('--help does not accept a value');

    const result = spawnSync(process.execPath, [scriptPath, '--limit', '10'], {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: { ...process.env, STRIPE_SECRET_KEY: 'sk_live_should_not_run' },
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Unknown argument --limit.');
    expect(result.stderr).toContain('Usage:');
    expect(result.stdout).toBe('');
  });

  it('lists Stripe webhook endpoints with pagination through a caller-supplied fetch implementation', async () => {
    const calls: string[] = [];
    const responses = [
      {
        has_more: true,
        data: [validEndpoint({ id: 'we_page_1' })],
      },
      {
        has_more: false,
        data: [validEndpoint({ id: 'we_page_2' })],
      },
    ];
    const fetchImpl = async (url: string | URL | Request, init?: RequestInit) => {
      calls.push(String(url));
      expect(init?.headers).toEqual({
        Authorization: 'Bearer sk_live_check',
        'Stripe-Version': expectedStripeApiVersion,
      });
      const body = responses.shift();
      return new Response(JSON.stringify(body), { status: 200 });
    };

    const endpoints = await fetchStripeWebhookEndpoints('sk_live_check', { fetchImpl });

    expect(endpoints.map((endpoint: WebhookEndpoint) => endpoint.id)).toEqual(['we_page_1', 'we_page_2']);
    expect(calls[0]).toContain('limit=100');
    expect(calls[1]).toContain('starting_after=we_page_1');
  });

  it('surfaces Stripe list errors without printing private Stripe response details', async () => {
    const fetchImpl = async () => new Response(JSON.stringify({
      error: {
        type: 'invalid_request_error',
        code: 'permission_error',
        message: 'Cannot list webhook endpoint we_123 for acct_123 at Legal Parish Corp',
      },
    }), { status: 403 });

    let message = '';
    try {
      await fetchStripeWebhookEndpoints('sk_live_check', { fetchImpl });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message).toContain('HTTP 403 - invalid_request_error - permission_error');
    expect(message).not.toContain('we_123');
    expect(message).not.toContain('acct_123');
    expect(message).not.toContain('Legal Parish Corp');
  });
});
