#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  androidReleaseSigningConfig,
  appleTeamIdFromXcodeProject,
} from './configure-native-links.mjs';

const expectedProjectId = 'kandilo-2f7a9';
const requiredNodeMajor = 22;
const deployTargets = 'functions,firestore:rules,firestore:indexes,storage,hosting';
const usage = `Usage:
  npm run deploy:tax-receipts:plan
  npm run deploy:tax-receipts -- --confirm-project ${expectedProjectId}

Options:
  --deploy            Internal flag set by npm run deploy:tax-receipts.
  --confirm-project   Required with --deploy; must be ${expectedProjectId}.
  -h, --help          Show the read-only deploy plan.`;
const args = process.argv.slice(2);
validateDeployArgs(args);
const shouldDeploy = args.includes('--deploy');
const showHelp = args.includes('-h') || args.includes('--help');
const confirmProject = readArgValue('--confirm-project');
const root = process.cwd();

function readArgValue(name) {
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

function validateDeployArgs(rawArgs) {
  const flagOptions = new Set(['--deploy', '-h', '--help']);
  const valueOptions = new Set(['--confirm-project']);

  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];
    if (!arg.startsWith('-')) {
      console.error(`Unexpected positional argument: ${arg}`);
      console.error('');
      console.error(usage);
      process.exit(1);
    }

    const equalsIndex = arg.indexOf('=');
    const name = equalsIndex >= 0 ? arg.slice(0, equalsIndex) : arg;
    const inlineValue = equalsIndex >= 0 ? arg.slice(equalsIndex + 1) : null;

    if (flagOptions.has(name)) {
      if (inlineValue !== null) {
        console.error(`${name} does not accept a value.`);
        console.error('');
        console.error(usage);
        process.exit(1);
      }
      continue;
    }

    if (valueOptions.has(name)) {
      if (inlineValue !== null) {
        if (!inlineValue) {
          console.error(`Missing value for ${name}.`);
          console.error('');
          console.error(usage);
          process.exit(1);
        }
        continue;
      }

      const next = rawArgs[index + 1];
      if (!next || next.startsWith('-')) {
        console.error(`Missing value for ${name}.`);
        console.error('');
        console.error(usage);
        process.exit(1);
      }
      index += 1;
      continue;
    }

    console.error(`Unknown argument ${name}.`);
    console.error('');
    console.error(usage);
    process.exit(1);
  }
}

function packageRunner() {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm';
}

function npxRunner() {
  return process.platform === 'win32' ? 'npx.cmd' : 'npx';
}

function firebaseCliArgs(commandArgs) {
  return ['--no-install', 'firebase', ...commandArgs];
}

function currentNodeMajor() {
  return Number.parseInt(process.versions.node.split('.')[0] ?? '', 10);
}

function run(command, commandArgs) {
  const display = [command, ...commandArgs].join(' ');
  console.log(`\n> ${display}`);
  const result = spawnSync(command, commandArgs, {
    cwd: root,
    stdio: 'inherit',
    env: process.env,
  });

  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }

  if (result.status !== 0) {
    console.error(`Command failed with exit ${result.status}: ${display}`);
    process.exit(result.status ?? 1);
  }
}

function nativeLinkDerivationStatus() {
  let appleStatus = 'ready';
  let androidStatus = 'ready';

  try {
    appleTeamIdFromXcodeProject({ rootDir: root });
  } catch (error) {
    appleStatus = error instanceof Error ? error.message : String(error);
  }

  try {
    androidReleaseSigningConfig({ rootDir: root });
  } catch (error) {
    androidStatus = error instanceof Error ? error.message : String(error);
  }

  return { appleStatus, androidStatus };
}

function printPlan() {
  const nativeLinkStatus = nativeLinkDerivationStatus();

  console.log('Kandilo Stripe/tax receipt Firebase deploy helper');
  console.log('');
  console.log(`Project: ${expectedProjectId}`);
  console.log(`Required Node.js: ${requiredNodeMajor}.x`);
  console.log(`Current Node.js: ${process.versions.node}`);
  console.log(`Use the repo toolchain before deploy mode: nvm use ${requiredNodeMajor}`);
  console.log(`Deploy targets: ${deployTargets}`);
  console.log('');
  console.log('Default mode is read-only. To deploy the current tax receipt Firebase and portal surface, run:');
  console.log(`npm run deploy:tax-receipts -- --confirm-project ${expectedProjectId}`);
  console.log('');
  console.log('That command will run:');
  console.log('- npm run check:stripe-production -- --strict-native-links');
  console.log('- npm run lint');
  console.log('- npm run test:qa');
  console.log('- npm run build');
  console.log('- npm run audit:tax-receipts -- --fail-on-repairs');
  console.log(`- npx --no-install firebase deploy --only ${deployTargets} --project ${expectedProjectId} --non-interactive`);
  console.log('- npm run check:firebase-live -- --strict-native-links');
  console.log('- npm run audit:tax-receipts -- --fail-on-repairs');
  console.log('');
  console.log('Before deploy/live receipt smoke testing, finish native return links and verify Stripe account activation, receipt email domain readiness, and the live Dashboard webhook separately with:');
  console.log('npm run configure:native-links -- --status');
  console.log('npm run configure:native-links -- --apple-team-id TEAMID1234 --android-sha256 AA:BB:...:99');
  console.log('npm run configure:native-links -- --apple-from-xcode-project --android-from-release-keystore');
  console.log('npm run configure:native-links -- --apple-team-id TEAMID1234 --android-from-release-keystore');
  console.log('STRIPE_SECRET_KEY=sk_live_... npm run check:stripe-account-live');
  console.log('RESEND_API_KEY=re_... npm run check:resend-live');
  console.log('npm run configure:stripe-webhook');
  console.log('npm run configure:receipt-secrets');
  console.log('STRIPE_SECRET_KEY=sk_live_... npm run check:stripe-webhook-live');
  console.log('npm run check:live-donation-smoke');
  console.log('npm run check:live-donation-smoke -- --require-sent-receipt');
  console.log('npm run check:live-annual-receipt-smoke');
  console.log('');
  console.log('Current local native-link derivation status:');
  console.log(`- Apple Team ID: ${nativeLinkStatus.appleStatus}`);
  console.log(`- Android release signing: ${nativeLinkStatus.androidStatus}`);
}

function assertExpectedNodeRuntime() {
  if (currentNodeMajor() !== requiredNodeMajor) {
    console.error(`Node.js ${requiredNodeMajor}.x is required for this production deploy; current runtime is ${process.versions.node}.`);
    console.error('Switch to the repo toolchain from .nvmrc/.node-version before running deploy mode.');
    process.exit(1);
  }
}

function assertExpectedFirebaseProject() {
  const firebasercPath = resolve(root, '.firebaserc');
  if (!existsSync(firebasercPath)) {
    console.error('.firebaserc is missing; refusing to deploy.');
    process.exit(1);
  }

  let firebaserc;
  try {
    firebaserc = JSON.parse(readFileSync(firebasercPath, 'utf8'));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }

  if (firebaserc?.projects?.default !== expectedProjectId) {
    console.error(`.firebaserc default project must be ${expectedProjectId}; refusing to deploy.`);
    process.exit(1);
  }
}

if (showHelp || !shouldDeploy) {
  printPlan();
  process.exit(0);
}

if (confirmProject !== expectedProjectId) {
  console.error(`Refusing to deploy without --confirm-project ${expectedProjectId}.`);
  console.error(`Run: npm run deploy:tax-receipts -- --confirm-project ${expectedProjectId}`);
  process.exit(1);
}

assertExpectedFirebaseProject();
assertExpectedNodeRuntime();

run(packageRunner(), ['run', 'check:stripe-production', '--', '--strict-native-links']);
run(packageRunner(), ['run', 'lint']);
run(packageRunner(), ['run', 'test:qa']);
run(packageRunner(), ['run', 'build']);
run(packageRunner(), ['run', 'audit:tax-receipts', '--', '--fail-on-repairs']);
run(npxRunner(), firebaseCliArgs([
  'deploy',
  '--only',
  deployTargets,
  '--project',
  expectedProjectId,
  '--non-interactive',
]));
run(packageRunner(), ['run', 'check:firebase-live', '--', '--strict-native-links']);
run(packageRunner(), ['run', 'audit:tax-receipts', '--', '--fail-on-repairs']);
