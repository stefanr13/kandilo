#!/usr/bin/env node

import { pathToFileURL } from 'node:url';
import { expectedStripeApiVersion, stripeKeyMode } from './check-stripe-live-webhook.mjs';

const stripeAccountUrl = 'https://api.stripe.com/v1/account';
const usage = `Usage:
  STRIPE_SECRET_KEY=sk_live_... npm run check:stripe-account-live

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

function stripeRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value
    : {};
}

function countRequirementFields(value) {
  return Array.isArray(value)
    ? value.filter((item) => typeof item === 'string' && item.trim().length > 0).length
    : 0;
}

function evaluateStripeAccountReadiness(account) {
  const checks = [];
  const record = (ok, label, detail = '', severity = 'fail') => {
    checks.push({ ok, label, detail, severity });
  };

  if (typeof account !== 'object' || account === null || Array.isArray(account)) {
    record(false, 'Stripe returned an account object', 'Expected a JSON account response from /v1/account.');
    return {
      checks,
      summary: {
        checked: false,
        ready: false,
        chargesEnabled: false,
        payoutsEnabled: false,
        detailsSubmitted: false,
        currentlyDueCount: 0,
        pastDueCount: 0,
        eventuallyDueCount: 0,
        futureCurrentlyDueCount: 0,
        futurePastDueCount: 0,
        futureEventuallyDueCount: 0,
        disabled: false,
        country: '',
        defaultCurrency: '',
      },
    };
  }

  const requirements = stripeRecord(account.requirements);
  const futureRequirements = stripeRecord(account.future_requirements);
  const currentlyDueCount = countRequirementFields(requirements.currently_due);
  const pastDueCount = countRequirementFields(requirements.past_due);
  const eventuallyDueCount = countRequirementFields(requirements.eventually_due);
  const futureCurrentlyDueCount = countRequirementFields(futureRequirements.currently_due);
  const futurePastDueCount = countRequirementFields(futureRequirements.past_due);
  const futureEventuallyDueCount = countRequirementFields(futureRequirements.eventually_due);
  const futureRequirementCount =
    futureCurrentlyDueCount + futurePastDueCount + futureEventuallyDueCount;
  const futureRequirementDetail = futureRequirementCount > 0
    ? [
      `Stripe reports ${futureRequirementCount} future requirement(s):`,
      `${futureCurrentlyDueCount} currently due,`,
      `${futurePastDueCount} past due,`,
      `${futureEventuallyDueCount} eventually due.`,
      'Track them in the Stripe Dashboard before they become current requirements.',
    ].join(' ')
    : '';
  const disabledReason =
    typeof requirements.disabled_reason === 'string' ? requirements.disabled_reason : '';
  const chargesEnabled = account.charges_enabled === true;
  const payoutsEnabled = account.payouts_enabled === true;
  const detailsSubmitted = account.details_submitted === true;
  const country = typeof account.country === 'string' ? account.country : '';
  const defaultCurrency =
    typeof account.default_currency === 'string' ? account.default_currency : '';
  const ready =
    chargesEnabled
    && payoutsEnabled
    && detailsSubmitted
    && currentlyDueCount === 0
    && pastDueCount === 0
    && !disabledReason;

  record(
    chargesEnabled,
    'Stripe account can create charges',
    'Complete Stripe account activation before live donations.'
  );
  record(
    payoutsEnabled,
    'Stripe account can receive payouts',
    'Add and verify bank/payout details in Stripe before live donations.'
  );
  record(
    detailsSubmitted,
    'Stripe account business details are submitted',
    'Complete corporate, tax, and representative details in Stripe.'
  );
  record(
    currentlyDueCount === 0,
    'Stripe account has no currently due requirements',
    currentlyDueCount > 0
      ? `Stripe reports ${currentlyDueCount} currently due requirement(s). Resolve them in the Stripe Dashboard.`
      : ''
  );
  record(
    pastDueCount === 0,
    'Stripe account has no past-due requirements',
    pastDueCount > 0
      ? `Stripe reports ${pastDueCount} past-due requirement(s). Resolve them in the Stripe Dashboard.`
      : ''
  );
  record(
    !disabledReason,
    'Stripe account is not disabled',
    disabledReason
      ? 'Stripe reports a disabled account state. Resolve it in the Stripe Dashboard.'
      : ''
  );
  record(
    eventuallyDueCount === 0,
    'Stripe account has no eventually due requirements',
    eventuallyDueCount > 0
      ? `Stripe reports ${eventuallyDueCount} future requirement(s). These are not launch-blocking, but should be tracked.`
      : '',
    'warn'
  );
  record(
    futureRequirementCount === 0,
    'Stripe account has no future requirements queued',
    futureRequirementDetail,
    'warn'
  );

  return {
    checks,
    summary: {
      checked: true,
      ready,
      chargesEnabled,
      payoutsEnabled,
      detailsSubmitted,
      currentlyDueCount,
      pastDueCount,
      eventuallyDueCount,
      futureCurrentlyDueCount,
      futurePastDueCount,
      futureEventuallyDueCount,
      disabled: Boolean(disabledReason),
      country,
      defaultCurrency,
    },
  };
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

async function fetchStripeAccount(secretKey, {
  fetchImpl = globalThis.fetch,
} = {}) {
  if (typeof fetchImpl !== 'function') {
    throw new Error('This Node.js runtime does not provide fetch.');
  }

  const response = await fetchImpl(stripeAccountUrl, {
    headers: {
      Authorization: `Bearer ${secretKey}`,
      'Stripe-Version': expectedStripeApiVersion,
    },
  });
  const responseText = await response.text();
  if (!response.ok) {
    throw new Error(stripeApiErrorDetail(response.status, responseText));
  }

  try {
    return responseText ? JSON.parse(responseText) : {};
  } catch {
    throw new Error('Stripe account response was not valid JSON.');
  }
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

  console.log('Kandilo live Stripe account readiness check');
  console.log('');
  console.log('This read-only check verifies coarse launch readiness without printing Stripe account IDs, business names, bank details, tax identifiers, or requirement field names.');
  console.log(`Stripe API version: ${expectedStripeApiVersion}`);
  console.log('');

  const secretKey = process.env.STRIPE_SECRET_KEY ?? '';
  const keyMode = stripeKeyMode(secretKey);
  if (keyMode !== 'live') {
    console.error('FAIL STRIPE_SECRET_KEY must be provided as a live sk_live_... or rk_live_... key in the current shell environment.');
    console.error('Do not store the live key in .env.local or functions/.env.production. Pass it only for this read-only check.');
    process.exit(1);
  }

  let account;
  try {
    account = await fetchStripeAccount(secretKey);
  } catch (error) {
    console.error(`FAIL Stripe account can be retrieved - ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }

  const { checks, summary } = evaluateStripeAccountReadiness(account);
  const { failures, warnings } = printChecks(checks);

  console.log('');
  if (summary.checked) {
    console.log(`Account country: ${summary.country || 'unknown'}`);
    console.log(`Default currency: ${summary.defaultCurrency || 'unknown'}`);
  }
  console.log('After this passes, create and verify the live webhook endpoint, set Firebase Secret Manager values, deploy the receipt release surface, then complete a small live donation smoke test.');
  console.log('');

  if (failures > 0) {
    console.log(`Result: ${failures} failure(s), ${warnings} warning(s). Finish Stripe account activation before live donations.`);
    process.exit(1);
  }
  console.log(`Result: live Stripe account readiness check passed with ${warnings} warning(s).`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  await main();
}

export {
  countRequirementFields,
  evaluateStripeAccountReadiness,
  fetchStripeAccount,
  stripeAccountUrl,
  validateNoLiveCheckArgs,
};
