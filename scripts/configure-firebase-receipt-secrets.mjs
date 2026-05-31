#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const expectedProjectId = 'kandilo-2f7a9';
export const receiptSecretNames = ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'RESEND_API_KEY'];

const usage = `Usage:
  npm run configure:receipt-secrets
  npm run configure:receipt-secrets -- --set STRIPE_SECRET_KEY --confirm-project ${expectedProjectId}
  npm run configure:receipt-secrets -- --set-all --confirm-project ${expectedProjectId}

Options:
  --set <name>          Set one receipt production secret through the pinned Firebase CLI.
  --set-all             Set STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, and RESEND_API_KEY in sequence.
  --confirm-project     Required when setting secrets; must be ${expectedProjectId}.
  -h, --help            Show this help text.`;

function readArgValue(args, name) {
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
  const flagOptions = new Set(['--set-all', '-h', '--help']);
  const valueOptions = new Set(['--set', '--confirm-project']);

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

function npxRunner() {
  return process.platform === 'win32' ? 'npx.cmd' : 'npx';
}

export function assertAllowedReceiptSecretName(secretName) {
  if (!receiptSecretNames.includes(secretName)) {
    throw new Error(`Unsupported receipt secret: ${secretName || '(missing)'}. Allowed values: ${receiptSecretNames.join(', ')}.`);
  }
  return secretName;
}

export function firebaseSecretSetArgs(secretName, {
  projectId = expectedProjectId,
} = {}) {
  assertAllowedReceiptSecretName(secretName);
  return [
    '--no-install',
    'firebase',
    'functions:secrets:set',
    secretName,
    '--project',
    projectId,
  ];
}

export function readDefaultFirebaseProject(rootDir = process.cwd()) {
  const firebasercPath = resolve(rootDir, '.firebaserc');
  if (!existsSync(firebasercPath)) {
    throw new Error('.firebaserc is missing; refusing to set live receipt secrets.');
  }

  let firebaserc;
  try {
    firebaserc = JSON.parse(readFileSync(firebasercPath, 'utf8'));
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : String(error));
  }

  return firebaserc?.projects?.default ?? '';
}

export function assertExpectedFirebaseProject(rootDir = process.cwd()) {
  const actualProjectId = readDefaultFirebaseProject(rootDir);
  if (actualProjectId !== expectedProjectId) {
    throw new Error(`.firebaserc default project must be ${expectedProjectId}; got ${actualProjectId || '(missing)'}.`);
  }
}

function selectedSecretNames(args) {
  const singleSecret = readArgValue(args, '--set');
  const setAll = args.includes('--set-all');
  if (singleSecret && setAll) {
    throw new Error('Use either --set <name> or --set-all, not both.');
  }
  if (setAll) {
    return [...receiptSecretNames];
  }
  if (singleSecret) {
    return [assertAllowedReceiptSecretName(singleSecret)];
  }
  return [];
}

function printPlan(stdout) {
  stdout.write('Kandilo receipt production Secret Manager setup plan\n\n');
  stdout.write(`Project: ${expectedProjectId}\n`);
  stdout.write(`Required secrets: ${receiptSecretNames.join(', ')}\n\n`);
  stdout.write('Set each value from a private terminal. The helper invokes the repo-pinned Firebase CLI and does not read or print secret values:\n');
  for (const secretName of receiptSecretNames) {
    stdout.write(`npm run configure:receipt-secrets -- --set ${secretName} --confirm-project ${expectedProjectId}\n`);
  }
  stdout.write('\nAfter setting or rotating any receipt secret, deploy Functions and run npm run check:firebase-live.\n');
}

export function runFirebaseSecretSet(secretName, {
  runner = spawnSync,
  cwd = process.cwd(),
  stdio = 'inherit',
  env = process.env,
} = {}) {
  const command = npxRunner();
  const commandArgs = firebaseSecretSetArgs(secretName);
  return runner(command, commandArgs, {
    cwd,
    stdio,
    env,
  });
}

export async function main(args = process.argv.slice(2), {
  cwd = process.cwd(),
  stdout = process.stdout,
  stderr = process.stderr,
  runner = spawnSync,
} = {}) {
  try {
    validateArgs(args);

    if (args.includes('-h') || args.includes('--help')) {
      stdout.write(`${usage}\n`);
      return 0;
    }

    const secretsToSet = selectedSecretNames(args);
    if (secretsToSet.length === 0) {
      printPlan(stdout);
      return 0;
    }

    const confirmProject = readArgValue(args, '--confirm-project');
    if (confirmProject !== expectedProjectId) {
      throw new Error(`Refusing to set live receipt secrets without --confirm-project ${expectedProjectId}.`);
    }
    assertExpectedFirebaseProject(cwd);

    for (const secretName of secretsToSet) {
      stdout.write(`\nSetting ${secretName} for ${expectedProjectId}. Enter the value only into the Firebase CLI prompt.\n`);
      const result = runFirebaseSecretSet(secretName, { runner, cwd });
      if (result.error) {
        throw result.error;
      }
      if (result.status !== 0) {
        return result.status ?? 1;
      }
    }

    stdout.write('\nReceipt secrets updated. Deploy Functions, then run npm run check:firebase-live.\n');
    return 0;
  } catch (error) {
    stderr.write(`${error instanceof Error ? error.message : String(error)}\n\n${usage}\n`);
    return 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  process.exitCode = await main();
}
