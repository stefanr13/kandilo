import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

const scriptPath = resolve(process.cwd(), 'scripts/configure-stripe-live-webhook.mjs');

type WebhookSetupScript = {
  createStripeWebhookEndpoint(secretKey: string, options: {
    fetchImpl: typeof fetch;
  }): Promise<Record<string, unknown>>;
  main(args: string[], options: {
    env?: Record<string, string>;
    fetchImpl?: typeof fetch;
    stdout: { write(value: string): void };
    stderr: { write(value: string): void };
  }): Promise<number>;
  stripeWebhookCreateParams(): URLSearchParams;
  stripeWebhookCreatePlan(): {
    endpoint: string;
    expectedUrl: string;
    expectedApiVersion: string;
    requiredEvents: string[];
    curl: string;
  };
  validateArgs(args: string[]): void;
};

async function loadScript() {
  return import(pathToFileURL(scriptPath).href) as Promise<WebhookSetupScript>;
}

function writer() {
  let output = '';
  return {
    sink: {
      write(value: string) {
        output += value;
      },
    },
    output: () => output,
  };
}

function validEndpoint(overrides: Record<string, unknown> = {}) {
  return {
    id: 'we_live_created',
    object: 'webhook_endpoint',
    url: 'https://us-central1-kandilo-2f7a9.cloudfunctions.net/stripeWebhook',
    livemode: true,
    status: 'enabled',
    api_version: '2026-04-22.dahlia',
    enabled_events: [
      'checkout.session.completed',
      'checkout.session.expired',
      'checkout.session.async_payment_failed',
      'charge.refunded',
    ],
    secret: 'whsec_live_created_once',
    ...overrides,
  };
}

describe('live Stripe webhook setup helper', () => {
  it('prints a no-network setup plan with the exact production endpoint parameters', async () => {
    const { stripeWebhookCreateParams, stripeWebhookCreatePlan } = await loadScript();
    const params = stripeWebhookCreateParams();
    const events = params.getAll('enabled_events[]');
    const plan = stripeWebhookCreatePlan();

    expect(params.get('url')).toBe('https://us-central1-kandilo-2f7a9.cloudfunctions.net/stripeWebhook');
    expect(params.get('api_version')).toBe('2026-04-22.dahlia');
    expect(params.get('description')).toBe('Kandilo live donations and tax receipts');
    expect(params.get('metadata[kandilo_project]')).toBe('kandilo-2f7a9');
    expect(events).toEqual([
      'checkout.session.completed',
      'checkout.session.expired',
      'checkout.session.async_payment_failed',
      'charge.refunded',
    ]);
    expect(plan.curl).toContain('Authorization: Bearer $STRIPE_SECRET_KEY');
    expect(plan.curl).toContain('Stripe-Version: 2026-04-22.dahlia');
    expect(plan.curl).toContain('enabled_events[]=checkout.session.completed');
  });

  it('creates the endpoint with a form-encoded Stripe API request and returns the one-time signing secret', async () => {
    const { createStripeWebhookEndpoint } = await loadScript();
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response(JSON.stringify(validEndpoint()), { status: 200 });
    };

    const created = await createStripeWebhookEndpoint('sk_live_configure', { fetchImpl });

    expect(created.secret).toBe('whsec_live_created_once');
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://api.stripe.com/v1/webhook_endpoints');
    expect(calls[0].init.method).toBe('POST');
    expect(calls[0].init.headers).toEqual({
      Authorization: 'Bearer sk_live_configure',
      'Stripe-Version': '2026-04-22.dahlia',
      'Content-Type': 'application/x-www-form-urlencoded',
    });
    expect(String(calls[0].init.body)).toContain('api_version=2026-04-22.dahlia');
    expect(String(calls[0].init.body)).toContain('enabled_events%5B%5D=charge.refunded');
  });

  it('surfaces Stripe create errors without printing private Stripe response details', async () => {
    const { createStripeWebhookEndpoint } = await loadScript();
    const fetchImpl = async () => new Response(JSON.stringify({
      error: {
        type: 'invalid_request_error',
        code: 'url_invalid',
        message: 'Endpoint URL rejected for we_123 on acct_123 at Legal Parish Corp',
      },
    }), { status: 400 });

    let message = '';
    try {
      await createStripeWebhookEndpoint('sk_live_configure', { fetchImpl });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message).toContain('HTTP 400 - invalid_request_error - url_invalid');
    expect(message).not.toContain('we_123');
    expect(message).not.toContain('acct_123');
    expect(message).not.toContain('Legal Parish Corp');
  });

  it('refuses live creation unless the project and one-time secret output are explicitly acknowledged', async () => {
    const { main } = await loadScript();
    const stdout = writer();
    const stderr = writer();

    expect(await main(['--create'], {
      env: { STRIPE_SECRET_KEY: 'sk_live_configure' },
      fetchImpl: (() => Promise.reject(new Error('network should not run'))) as typeof fetch,
      stdout: stdout.sink,
      stderr: stderr.sink,
    })).toBe(1);
    expect(stderr.output()).toContain('--confirm-project kandilo-2f7a9');

    const missingPrint = writer();
    expect(await main(['--create', '--confirm-project', 'kandilo-2f7a9'], {
      env: { STRIPE_SECRET_KEY: 'sk_live_configure' },
      fetchImpl: (() => Promise.reject(new Error('network should not run'))) as typeof fetch,
      stdout: writer().sink,
      stderr: missingPrint.sink,
    })).toBe(1);
    expect(missingPrint.output()).toContain('--print-secret-once');
  });

  it('rejects unknown or malformed arguments before running network calls', async () => {
    const { main, validateArgs } = await loadScript();
    const stderr = writer();

    expect(() => validateArgs(['--create', '--confirm-project', 'kandilo-2f7a9'])).not.toThrow();
    expect(() => validateArgs(['--create=true'])).toThrow('--create does not accept a value');
    expect(() => validateArgs(['--confirm-project'])).toThrow('Missing value for --confirm-project');
    expect(() => validateArgs(['--unknown'])).toThrow('Unknown argument --unknown');
    expect(() => validateArgs(['kandilo-2f7a9'])).toThrow('Unexpected positional argument');

    const exitCode = await main(['--create', '--unknown'], {
      env: { STRIPE_SECRET_KEY: 'sk_live_configure' },
      fetchImpl: (() => Promise.reject(new Error('network should not run'))) as typeof fetch,
      stdout: writer().sink,
      stderr: stderr.sink,
    });

    expect(exitCode).toBe(1);
    expect(stderr.output()).toContain('Unknown argument --unknown');
  });

  it('does not create duplicates when a production URL endpoint already exists', async () => {
    const { main } = await loadScript();
    const stdout = writer();
    const stderr = writer();
    let createCalled = false;
    const fetchImpl = async (_url: string | URL | Request, init?: RequestInit) => {
      if (init?.method === 'POST') {
        createCalled = true;
        return new Response(JSON.stringify(validEndpoint()), { status: 200 });
      }
      return new Response(JSON.stringify({ data: [validEndpoint()], has_more: false }), { status: 200 });
    };

    const exitCode = await main(['--create', '--confirm-project', 'kandilo-2f7a9', '--print-secret-once'], {
      env: { STRIPE_SECRET_KEY: 'sk_live_configure' },
      fetchImpl,
      stdout: stdout.sink,
      stderr: stderr.sink,
    });

    expect(exitCode).toBe(0);
    expect(createCalled).toBe(false);
    expect(stdout.output()).toContain('already configured and ready');
    expect(stderr.output()).toBe('');
  });

  it('creates and prints the one-time webhook signing secret when no production URL endpoint exists', async () => {
    const { main } = await loadScript();
    const stdout = writer();
    const calls: string[] = [];
    const fetchImpl = async (url: string | URL | Request, init?: RequestInit) => {
      calls.push(`${init?.method ?? 'GET'} ${String(url)}`);
      if (init?.method === 'POST') {
        return new Response(JSON.stringify(validEndpoint()), { status: 200 });
      }
      return new Response(JSON.stringify({ data: [], has_more: false }), { status: 200 });
    };

    const exitCode = await main(['--create', '--confirm-project', 'kandilo-2f7a9', '--print-secret-once'], {
      env: { STRIPE_SECRET_KEY: 'sk_live_configure' },
      fetchImpl,
      stdout: stdout.sink,
      stderr: writer().sink,
    });

    expect(exitCode).toBe(0);
    expect(calls[0]).toContain('GET https://api.stripe.com/v1/webhook_endpoints');
    expect(calls[1]).toBe('POST https://api.stripe.com/v1/webhook_endpoints');
    expect(stdout.output()).toContain('Created Kandilo live Stripe webhook endpoint');
    expect(stdout.output()).toContain('whsec_live_created_once');
  });

  it('refuses to create a duplicate when the existing production URL endpoint is misconfigured', async () => {
    const { main } = await loadScript();
    const stderr = writer();
    let createCalled = false;
    const fetchImpl = async (_url: string | URL | Request, init?: RequestInit) => {
      if (init?.method === 'POST') {
        createCalled = true;
      }
      return new Response(JSON.stringify({
        data: [validEndpoint({ enabled_events: ['checkout.session.completed'] })],
        has_more: false,
      }), { status: 200 });
    };

    const exitCode = await main(['--create', '--confirm-project', 'kandilo-2f7a9', '--print-secret-once'], {
      env: { STRIPE_SECRET_KEY: 'sk_live_configure' },
      fetchImpl,
      stdout: writer().sink,
      stderr: stderr.sink,
    });

    expect(exitCode).toBe(1);
    expect(createCalled).toBe(false);
    expect(stderr.output()).toContain('Refusing to create a duplicate endpoint');
  });

  it('keeps the CLI plan mode free of live credential requirements', () => {
    const result = spawnSync(process.execPath, [scriptPath], {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: {},
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Kandilo live Stripe webhook setup plan');
    expect(result.stdout).toContain('checkout.session.async_payment_failed');
    expect(result.stdout).toContain('npm run configure:stripe-webhook -- --create');
    expect(result.stderr).toBe('');
  });
});
