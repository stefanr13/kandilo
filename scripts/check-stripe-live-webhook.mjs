#!/usr/bin/env node

import { pathToFileURL } from 'node:url';

const expectedProjectId = 'kandilo-2f7a9';
const expectedStripeApiVersion = '2026-04-22.dahlia';
const expectedStripeWebhookUrl = `https://us-central1-${expectedProjectId}.cloudfunctions.net/stripeWebhook`;
const requiredWebhookEvents = [
  'checkout.session.completed',
  'checkout.session.expired',
  'checkout.session.async_payment_failed',
  'charge.refunded',
];
const stripeWebhookEndpointListUrl = 'https://api.stripe.com/v1/webhook_endpoints';
const usage = `Usage:
  STRIPE_SECRET_KEY=sk_live_... npm run check:stripe-webhook-live

Options:
  -h, --help   Show this help text.`;

function validateNoLiveCheckArgs(args) {
  const helpFlags = new Set(['-h', '--help']);
  for (const arg of args) {
    if (!arg.startsWith('-')) {
      throw new Error(`Unexpected positional argument: ${arg}`);
    }

    const equalsIndex = arg.indexOf('=');
    const name = equalsIndex >= 0 ? arg.slice(0, equalsIndex) : arg;
    if (!helpFlags.has(name)) {
      throw new Error(`Unknown argument ${name}.`);
    }
    if (equalsIndex >= 0) {
      throw new Error(`${name} does not accept a value.`);
    }
  }
}

function stripeKeyMode(secretKey) {
  const normalized = typeof secretKey === 'string' ? secretKey.trim() : '';
  if (normalized.startsWith('sk_live_') || normalized.startsWith('rk_live_')) return 'live';
  if (normalized.startsWith('sk_test_') || normalized.startsWith('rk_test_')) return 'test';
  return 'invalid';
}

function requiredEventsMissing(enabledEvents, requiredEvents = requiredWebhookEvents) {
  if (!Array.isArray(enabledEvents)) return [...requiredEvents];
  if (enabledEvents.includes('*')) return [];
  return requiredEvents.filter((eventName) => !enabledEvents.includes(eventName));
}

function unexpectedEvents(enabledEvents, requiredEvents = requiredWebhookEvents) {
  if (!Array.isArray(enabledEvents) || enabledEvents.includes('*')) return [];
  return enabledEvents.filter((eventName) => !requiredEvents.includes(eventName));
}

function evaluateStripeWebhookEndpoints(endpoints, {
  expectedApiVersion = expectedStripeApiVersion,
  expectedUrl = expectedStripeWebhookUrl,
  requiredEvents = requiredWebhookEvents,
} = {}) {
  const checks = [];
  const record = (ok, label, detail = '', severity = 'fail') => {
    checks.push({ ok, label, detail, severity });
  };

  if (!Array.isArray(endpoints)) {
    record(false, 'Stripe returned a webhook endpoint list', 'Expected a list response with a data array.');
    return { checks, endpoint: null };
  }

  const urlMatches = endpoints.filter((endpoint) => endpoint?.url === expectedUrl);
  record(
    urlMatches.length > 0,
    `Stripe has a webhook endpoint for ${expectedUrl}`,
    `Create the endpoint at ${expectedUrl} before live donation testing.`
  );
  if (urlMatches.length === 0) {
    return { checks, endpoint: null };
  }

  const liveUrlMatches = urlMatches.filter((endpoint) => endpoint?.livemode === true);
  record(
    liveUrlMatches.length > 0,
    'Matching Stripe webhook endpoint is live-mode',
    'Use a live Stripe Dashboard endpoint, not a test-mode or Stripe CLI endpoint.'
  );

  const enabledLiveMatches = liveUrlMatches.filter((endpoint) => endpoint?.status === 'enabled');
  record(
    enabledLiveMatches.length === 1,
    'Exactly one matching live Stripe webhook endpoint is enabled',
    enabledLiveMatches.length === 0
      ? 'Enable the live endpoint before live donation testing.'
      : 'Disable duplicate live endpoints for this URL to avoid duplicate webhook deliveries.'
  );
  const endpoint = enabledLiveMatches[0] ?? liveUrlMatches[0] ?? urlMatches[0] ?? null;
  if (!endpoint) {
    return { checks, endpoint: null };
  }

  record(
    endpoint.api_version === expectedApiVersion,
    `Live Stripe webhook endpoint API version is ${expectedApiVersion}`,
    endpoint.api_version
      ? `Stripe endpoint reports ${endpoint.api_version}. Recreate or update it to match the Functions Stripe client pin.`
      : 'Stripe endpoint is using the account default API version; set an explicit endpoint API version.'
  );

  const missingEvents = requiredEventsMissing(endpoint.enabled_events, requiredEvents);
  record(
    missingEvents.length === 0,
    'Live Stripe webhook endpoint subscribes to required donation events',
    missingEvents.length > 0 ? `Missing: ${missingEvents.join(', ')}` : ''
  );

  if (Array.isArray(endpoint.enabled_events) && endpoint.enabled_events.includes('*')) {
    record(
      false,
      'Live Stripe webhook endpoint uses explicit events instead of wildcard delivery',
      'Narrow the endpoint to the required donation events to reduce unnecessary webhook traffic.'
    );
  } else {
    const extraEvents = unexpectedEvents(endpoint.enabled_events, requiredEvents);
    record(
      extraEvents.length === 0,
      'Live Stripe webhook endpoint has no unrelated event subscriptions',
      extraEvents.length > 0 ? `Extra events: ${extraEvents.join(', ')}` : ''
    );
  }

  return { checks, endpoint };
}

function stripeApiErrorDetail(status, responseText) {
  if (!responseText) return `HTTP ${status}`;
  try {
    const parsed = JSON.parse(responseText);
    const code = parsed?.error?.code;
    const type = parsed?.error?.type;
    return [`HTTP ${status}`, type, code]
      .filter((value) => typeof value === 'string' && value.length > 0)
      .join(' - ')
      .slice(0, 320);
  } catch {
    return `HTTP ${status} - unreadable Stripe error response`;
  }
}

async function fetchStripeWebhookEndpoints(secretKey, {
  fetchImpl = globalThis.fetch,
  pageLimit = 20,
} = {}) {
  if (typeof fetchImpl !== 'function') {
    throw new Error('This Node.js runtime does not provide fetch.');
  }

  const endpoints = [];
  let startingAfter = '';
  for (let page = 0; page < pageLimit; page += 1) {
    const params = new URLSearchParams({ limit: '100' });
    if (startingAfter) {
      params.set('starting_after', startingAfter);
    }
    const response = await fetchImpl(`${stripeWebhookEndpointListUrl}?${params}`, {
      headers: {
        Authorization: `Bearer ${secretKey}`,
        'Stripe-Version': expectedStripeApiVersion,
      },
    });
    const responseText = await response.text();
    if (!response.ok) {
      throw new Error(stripeApiErrorDetail(response.status, responseText));
    }

    let parsed;
    try {
      parsed = responseText ? JSON.parse(responseText) : {};
    } catch {
      throw new Error('Stripe webhook endpoint list response was not valid JSON.');
    }

    if (!Array.isArray(parsed.data)) {
      throw new Error('Stripe webhook endpoint list response did not include a data array.');
    }

    endpoints.push(...parsed.data);
    if (parsed.has_more !== true || parsed.data.length === 0) {
      return endpoints;
    }

    const lastEndpoint = parsed.data.at(-1);
    startingAfter = typeof lastEndpoint?.id === 'string' ? lastEndpoint.id : '';
    if (!startingAfter) {
      throw new Error('Stripe webhook endpoint pagination did not include a cursor id.');
    }
  }

  throw new Error(`Stripe webhook endpoint list exceeded ${pageLimit} pages; narrow the account webhook endpoints and retry.`);
}

function printChecks(checks) {
  let failures = 0;
  let warnings = 0;
  for (const check of checks) {
    if (check.ok) {
      console.log(`OK   ${check.label}`);
      continue;
    }
    if (check.severity === 'warn') {
      warnings += 1;
      console.log(`WARN ${check.label}${check.detail ? ` - ${check.detail}` : ''}`);
      continue;
    }
    failures += 1;
    console.log(`FAIL ${check.label}${check.detail ? ` - ${check.detail}` : ''}`);
  }
  return { failures, warnings };
}

async function main() {
  const args = process.argv.slice(2);
  try {
    validateNoLiveCheckArgs(args);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    console.error('');
    console.error(usage);
    process.exit(1);
  }
  if (args.includes('-h') || args.includes('--help')) {
    console.log(usage);
    return;
  }

  console.log('Kandilo live Stripe webhook endpoint check');
  console.log('');
  console.log(`Expected endpoint: ${expectedStripeWebhookUrl}`);
  console.log(`Expected Stripe API version: ${expectedStripeApiVersion}`);
  console.log(`Required events: ${requiredWebhookEvents.join(', ')}`);
  console.log('');

  const secretKey = process.env.STRIPE_SECRET_KEY ?? '';
  const keyMode = stripeKeyMode(secretKey);
  if (keyMode !== 'live') {
    console.error('FAIL STRIPE_SECRET_KEY must be provided as a live sk_live_... or rk_live_... key in the current shell environment.');
    console.error('Do not store the live key in .env.local or functions/.env.kandilo-2f7a9. Pass it only for this read-only check.');
    process.exit(1);
  }

  let endpoints;
  try {
    endpoints = await fetchStripeWebhookEndpoints(secretKey);
  } catch (error) {
    console.error(`FAIL Stripe webhook endpoints can be listed - ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }

  const { checks } = evaluateStripeWebhookEndpoints(endpoints);
  const { failures, warnings } = printChecks(checks);

  console.log('');
  console.log('Note: Stripe only returns the webhook signing secret at endpoint creation time. After this passes, set that live whsec_... value as STRIPE_WEBHOOK_SECRET in Firebase Secret Manager, deploy Functions, then run npm run check:firebase-live and a small live donation smoke test.');
  console.log('');

  if (failures > 0) {
    console.log(`Result: ${failures} failure(s), ${warnings} warning(s). Fix the live Stripe webhook endpoint before live donations.`);
    process.exit(1);
  }
  console.log(`Result: live Stripe webhook endpoint check passed with ${warnings} warning(s).`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  await main();
}

export {
  evaluateStripeWebhookEndpoints,
  expectedStripeApiVersion,
  expectedStripeWebhookUrl,
  fetchStripeWebhookEndpoints,
  requiredEventsMissing,
  requiredWebhookEvents,
  stripeKeyMode,
  unexpectedEvents,
  validateNoLiveCheckArgs,
};
