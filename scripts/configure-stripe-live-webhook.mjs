#!/usr/bin/env node

import { pathToFileURL } from 'node:url';
import {
  evaluateStripeWebhookEndpoints,
  expectedStripeApiVersion,
  expectedStripeWebhookUrl,
  fetchStripeWebhookEndpoints,
  requiredWebhookEvents,
  stripeKeyMode,
} from './check-stripe-live-webhook.mjs';

const expectedProjectId = 'kandilo-2f7a9';
const stripeWebhookEndpointCreateUrl = 'https://api.stripe.com/v1/webhook_endpoints';
const webhookDescription = 'Kandilo live donations and tax receipts';

const usage = `Usage:
  npm run configure:stripe-webhook
  STRIPE_SECRET_KEY=sk_live_... npm run configure:stripe-webhook -- --create --confirm-project ${expectedProjectId} --print-secret-once

Options:
  --create              Create the live Stripe webhook endpoint when none exists for the production URL.
  --confirm-project     Required with --create; must be ${expectedProjectId}.
  --print-secret-once   Required with --create; prints Stripe's one-time whsec_... value so it can be set in Firebase Secret Manager.
  -h, --help            Show this help text.`;

function argValue(args, name) {
  const equalsArg = args.find((arg) => arg.startsWith(`${name}=`));
  if (equalsArg) {
    return equalsArg.slice(name.length + 1);
  }

  const index = args.indexOf(name);
  if (index >= 0 && typeof args[index + 1] === 'string') {
    return args[index + 1];
  }

  return '';
}

export function validateArgs(args) {
  const flagOptions = new Set(['--create', '--print-secret-once', '-h', '--help']);
  const valueOptions = new Set(['--confirm-project']);

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg.startsWith('-')) {
      throw new Error(`Unexpected positional argument: ${arg}`);
    }

    const equalsIndex = arg.indexOf('=');
    const name = equalsIndex >= 0 ? arg.slice(0, equalsIndex) : arg;
    const inlineValue = equalsIndex >= 0 ? arg.slice(equalsIndex + 1) : null;

    if (flagOptions.has(name)) {
      if (inlineValue !== null) {
        throw new Error(`${name} does not accept a value.`);
      }
      continue;
    }

    if (valueOptions.has(name)) {
      if (inlineValue !== null) {
        if (!inlineValue) {
          throw new Error(`Missing value for ${name}.`);
        }
        continue;
      }

      const next = args[index + 1];
      if (!next || next.startsWith('-')) {
        throw new Error(`Missing value for ${name}.`);
      }
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument ${name}.`);
  }
}

function hasFailures(checks) {
  return checks.some((check) => !check.ok && check.severity !== 'warn');
}

function hasUrlMatch(checks) {
  return checks.some((check) => check.label.startsWith('Stripe has a webhook endpoint for') && check.ok);
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

export function stripeWebhookCreateParams({
  expectedUrl = expectedStripeWebhookUrl,
  expectedApiVersion = expectedStripeApiVersion,
  requiredEvents = requiredWebhookEvents,
} = {}) {
  const params = new URLSearchParams();
  params.set('url', expectedUrl);
  params.set('api_version', expectedApiVersion);
  params.set('description', webhookDescription);
  params.set('metadata[kandilo_project]', expectedProjectId);
  params.set('metadata[kandilo_surface]', 'donations_tax_receipts');
  for (const eventName of requiredEvents) {
    params.append('enabled_events[]', eventName);
  }
  return params;
}

export function stripeWebhookCreatePlan() {
  const params = stripeWebhookCreateParams();
  return {
    endpoint: stripeWebhookEndpointCreateUrl,
    expectedUrl: expectedStripeWebhookUrl,
    expectedApiVersion: expectedStripeApiVersion,
    requiredEvents: [...requiredWebhookEvents],
    description: webhookDescription,
    curl: [
      `curl -X POST ${stripeWebhookEndpointCreateUrl}`,
      '  -H "Authorization: Bearer $STRIPE_SECRET_KEY"',
      `  -H "Stripe-Version: ${expectedStripeApiVersion}"`,
      '  -H "Content-Type: application/x-www-form-urlencoded"',
      ...Array.from(params.entries()).map(([key, value]) => `  --data-urlencode "${key}=${value}"`),
    ].join(' \\\n'),
  };
}

export async function createStripeWebhookEndpoint(secretKey, {
  fetchImpl = globalThis.fetch,
} = {}) {
  if (typeof fetchImpl !== 'function') {
    throw new Error('This Node.js runtime does not provide fetch.');
  }

  const response = await fetchImpl(stripeWebhookEndpointCreateUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${secretKey}`,
      'Stripe-Version': expectedStripeApiVersion,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: stripeWebhookCreateParams().toString(),
  });
  const responseText = await response.text();
  if (!response.ok) {
    throw new Error(stripeApiErrorDetail(response.status, responseText));
  }

  let parsed;
  try {
    parsed = responseText ? JSON.parse(responseText) : {};
  } catch {
    throw new Error('Stripe webhook endpoint create response was not valid JSON.');
  }

  if (typeof parsed.id !== 'string' || typeof parsed.secret !== 'string' || !parsed.secret.startsWith('whsec_')) {
    throw new Error('Stripe webhook endpoint create response did not include the one-time whsec_... signing secret.');
  }

  return parsed;
}

function printPlan(stdout) {
  const plan = stripeWebhookCreatePlan();
  stdout.write('Kandilo live Stripe webhook setup plan\n\n');
  stdout.write(`Expected endpoint URL: ${plan.expectedUrl}\n`);
  stdout.write(`Expected Stripe API version: ${plan.expectedApiVersion}\n`);
  stdout.write(`Required events: ${plan.requiredEvents.join(', ')}\n\n`);
  stdout.write('Dashboard setup must use the same URL, API version, and exact events. API setup can use this request shape:\n');
  stdout.write(`${plan.curl}\n\n`);
  stdout.write(`To create through this guarded helper, run from a private shell:\nSTRIPE_SECRET_KEY=sk_live_... npm run configure:stripe-webhook -- --create --confirm-project ${expectedProjectId} --print-secret-once\n\n`);
  stdout.write('After creation, set the printed whsec_... value as STRIPE_WEBHOOK_SECRET in Firebase Secret Manager, deploy Functions, then run npm run check:stripe-webhook-live and npm run check:firebase-live.\n');
}

export async function main(args = process.argv.slice(2), {
  env = process.env,
  fetchImpl = globalThis.fetch,
  stdout = process.stdout,
  stderr = process.stderr,
} = {}) {
  try {
    validateArgs(args);
  } catch (error) {
    stderr.write(`${error instanceof Error ? error.message : String(error)}\n\n${usage}\n`);
    return 1;
  }

  if (args.includes('-h') || args.includes('--help')) {
    stdout.write(`${usage}\n`);
    return 0;
  }

  const shouldCreate = args.includes('--create');
  if (!shouldCreate) {
    printPlan(stdout);
    return 0;
  }

  const confirmProject = argValue(args, '--confirm-project');
  if (confirmProject !== expectedProjectId) {
    stderr.write(`Refusing to create a live Stripe webhook without --confirm-project ${expectedProjectId}.\n\n${usage}\n`);
    return 1;
  }

  if (!args.includes('--print-secret-once')) {
    stderr.write('Refusing to create the live Stripe webhook without --print-secret-once. Stripe returns the webhook signing secret only at endpoint creation time; run from a private shell and store it immediately in Firebase Secret Manager.\n\n');
    stderr.write(`${usage}\n`);
    return 1;
  }

  const secretKey = env.STRIPE_SECRET_KEY ?? '';
  if (stripeKeyMode(secretKey) !== 'live') {
    stderr.write('STRIPE_SECRET_KEY must be provided as a live sk_live_... or rk_live_... key in the current shell environment. Do not store it in repo env files.\n\n');
    stderr.write(`${usage}\n`);
    return 1;
  }

  const existingEndpoints = await fetchStripeWebhookEndpoints(secretKey, { fetchImpl });
  const existingEvaluation = evaluateStripeWebhookEndpoints(existingEndpoints);
  const existingHasFailures = hasFailures(existingEvaluation.checks);
  if (hasUrlMatch(existingEvaluation.checks)) {
    if (!existingHasFailures) {
      stdout.write('A matching live Stripe webhook endpoint is already configured and ready. No endpoint was created.\n');
      return 0;
    }

    stderr.write('A Stripe webhook endpoint already exists for the production URL, but it is not ready. Refusing to create a duplicate endpoint; fix or disable the existing endpoint, then rerun npm run check:stripe-webhook-live.\n');
    return 1;
  }

  const created = await createStripeWebhookEndpoint(secretKey, { fetchImpl });
  const createdEvaluation = evaluateStripeWebhookEndpoints([created]);
  if (hasFailures(createdEvaluation.checks)) {
    stderr.write('Stripe created a webhook endpoint, but the returned endpoint does not match Kandilo production requirements. Inspect the endpoint in Stripe Dashboard before proceeding.\n');
    return 1;
  }

  stdout.write('Created Kandilo live Stripe webhook endpoint.\n');
  stdout.write('Store this one-time signing secret in Firebase Secret Manager as STRIPE_WEBHOOK_SECRET:\n');
  stdout.write(`${created.secret}\n`);
  stdout.write('\nThen run: STRIPE_SECRET_KEY=sk_live_... npm run check:stripe-webhook-live\n');
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try {
    process.exitCode = await main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
