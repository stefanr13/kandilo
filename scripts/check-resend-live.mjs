#!/usr/bin/env node

import { pathToFileURL } from 'node:url';

const resendDomainsUrl = 'https://api.resend.com/domains';
const expectedResendDomain = 'kandilo.org';
const verifiedStatus = 'verified';
const knownResendErrorNames = new Set([
  'application_error',
  'invalid_api_key',
  'not_found',
  'rate_limit_exceeded',
  'validation_error',
]);
const usage = `Usage:
  RESEND_API_KEY=re_... npm run check:resend-live

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

function resendApiKeyLooksValid(apiKey) {
  return typeof apiKey === 'string' && apiKey.trim().startsWith('re_');
}

function normalizeDomainName(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function safeResendErrorName(value) {
  return typeof value === 'string' && knownResendErrorNames.has(value) ? value : '';
}

function evaluateResendDomains(domains, {
  expectedDomain = expectedResendDomain,
} = {}) {
  const checks = [];
  const record = (ok, label, detail = '', severity = 'fail') => {
    checks.push({ ok, label, detail, severity });
  };

  if (!Array.isArray(domains)) {
    record(false, 'Resend returned a domain list', 'Expected a domains response with a data array.');
    return { checks, domain: null };
  }

  const normalizedExpectedDomain = normalizeDomainName(expectedDomain);
  const matches = domains.filter((domain) => normalizeDomainName(domain?.name) === normalizedExpectedDomain);
  record(
    matches.length > 0,
    `Resend has the ${normalizedExpectedDomain} sending domain`,
    `Add ${normalizedExpectedDomain} in the Resend Dashboard before sending production receipts.`
  );
  if (matches.length === 0) {
    return { checks, domain: null };
  }

  const verifiedMatches = matches.filter((domain) => domain?.status === verifiedStatus);
  record(
    verifiedMatches.length > 0,
    `Resend sending domain ${normalizedExpectedDomain} is verified`,
    matches.length > 0
      ? `Current status: ${String(matches[0]?.status || 'unknown')}. Complete DNS verification in Resend.`
      : ''
  );
  record(
    matches.length === 1,
    `Resend has one ${normalizedExpectedDomain} domain entry`,
    matches.length > 1
      ? 'Remove duplicate domain entries in Resend so receipt delivery uses the intended verified domain.'
      : ''
  );

  return { checks, domain: verifiedMatches[0] ?? matches[0] ?? null };
}

function resendApiErrorDetail(status, responseText) {
  if (!responseText) return `HTTP ${status}`;
  try {
    const parsed = JSON.parse(responseText);
    const name = safeResendErrorName(parsed?.name || parsed?.error?.name);
    return [`HTTP ${status}`, name]
      .filter((value) => typeof value === 'string' && value.length > 0)
      .join(' - ')
      .slice(0, 320);
  } catch {
    return `HTTP ${status} - unreadable Resend error response`;
  }
}

async function fetchResendDomains(apiKey, {
  fetchImpl = globalThis.fetch,
} = {}) {
  if (typeof fetchImpl !== 'function') {
    throw new Error('This Node.js runtime does not provide fetch.');
  }

  const response = await fetchImpl(resendDomainsUrl, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
  });
  const responseText = await response.text();
  if (!response.ok) {
    throw new Error(resendApiErrorDetail(response.status, responseText));
  }

  let parsed;
  try {
    parsed = responseText ? JSON.parse(responseText) : {};
  } catch {
    throw new Error('Resend domains response was not valid JSON.');
  }

  const domains = parsed?.data?.data;
  if (!Array.isArray(domains)) {
    throw new Error('Resend domains response did not include a data array.');
  }
  return domains;
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

  console.log('Kandilo live Resend sending-domain check');
  console.log('');
  console.log(`Expected sending domain: ${expectedResendDomain}`);
  console.log('This read-only check verifies the receipt email provider key can see exactly one verified sending domain without printing API key values or domain record details.');
  console.log('');

  const apiKey = process.env.RESEND_API_KEY ?? '';
  if (!resendApiKeyLooksValid(apiKey)) {
    console.error('FAIL RESEND_API_KEY must be provided as a live re_... key in the current shell environment.');
    console.error('Do not store the live key in .env.local or functions/.env.kandilo-2f7a9. Pass it only for this read-only check.');
    process.exit(1);
  }

  let domains;
  try {
    domains = await fetchResendDomains(apiKey);
  } catch (error) {
    console.error(`FAIL Resend domains can be listed - ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }

  const { checks, domain } = evaluateResendDomains(domains);
  const { failures, warnings } = printChecks(checks);

  console.log('');
  if (domain) {
    console.log(`Sending domain: ${normalizeDomainName(domain.name) || 'unknown'}`);
    console.log(`Domain status: ${String(domain.status || 'unknown')}`);
  }
  console.log('After this passes, store the live key as RESEND_API_KEY in Firebase Secret Manager, deploy Functions, then complete a receipt email smoke test.');
  console.log('');

  if (failures > 0) {
    console.log(`Result: ${failures} failure(s), ${warnings} warning(s). Fix Resend domain readiness before live receipt emails.`);
    process.exit(1);
  }
  console.log(`Result: live Resend sending-domain check passed with ${warnings} warning(s).`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  await main();
}

export {
  evaluateResendDomains,
  expectedResendDomain,
  fetchResendDomains,
  normalizeDomainName,
  resendApiKeyLooksValid,
  resendDomainsUrl,
  validateNoLiveCheckArgs,
};
