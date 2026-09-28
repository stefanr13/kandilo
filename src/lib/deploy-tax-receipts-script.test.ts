import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { readGivingModuleSource } from './givingModuleSource';

const scriptPath = resolve(process.cwd(), 'scripts/deploy-stripe-tax-receipts.mjs');
const readinessScriptPath = resolve(process.cwd(), 'scripts/check-stripe-production-readiness.mjs');
const liveFunctionsReadinessPath = resolve(process.cwd(), 'scripts/readiness-live-functions.mjs');
const ciWorkflowPath = resolve(process.cwd(), '.github/workflows/ci.yml');
const firebaseJsonPath = resolve(process.cwd(), 'firebase.json');
const functionsPackagePath = resolve(process.cwd(), 'functions/package.json');
const envExamplePath = resolve(process.cwd(), '.env.example');
const bootstrapAdminScriptPath = resolve(process.cwd(), 'scripts/bootstrap-admin.js');
const makePriestScriptPath = resolve(process.cwd(), 'scripts/make-priest.js');
const seedChurchProfilesScriptPath = resolve(process.cwd(), 'scripts/seed-church-profiles.mjs');
const setSuperAdminScriptPath = resolve(process.cwd(), 'scripts/set-super-admin.mjs');

function runDeployScript(args: string[] = []) {
  return spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });
}

function runNodeScript(script: string, args: string[] = [], env: NodeJS.ProcessEnv = {}) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
}

type LiveFunctionRequirement = {
  id: string;
  region: string;
  trigger: 'callable' | 'https' | 'event' | 'scheduled';
  schedule?: string;
  timeZone?: string;
  retryCount?: number;
  secrets?: string[];
};

type LiveFunctionMetadata = {
  id: string;
  region: string;
  runtime: string;
  state: string;
  secretEnvironmentVariables: ReturnType<typeof secretEnvironmentVariables>;
  callableTrigger?: Record<string, never>;
  httpsTrigger?: Record<string, never>;
  eventTrigger?: Record<string, never>;
  scheduleTrigger?: {
    schedule?: string;
    timeZone?: string;
  };
};

function secretEnvironmentVariables(secrets: string[] = []) {
  return secrets.map((secret) => ({
    key: secret,
    secret: `projects/kandilo-2f7a9/secrets/${secret}/versions/latest`,
  }));
}

function liveFunctionForRequirement(requirement: LiveFunctionRequirement) {
  const fn: LiveFunctionMetadata = {
    id: requirement.id,
    region: requirement.region,
    runtime: 'nodejs22',
    state: 'ACTIVE',
    secretEnvironmentVariables: secretEnvironmentVariables(requirement.secrets),
  };

  if (requirement.trigger === 'callable') {
    fn.callableTrigger = {};
  } else if (requirement.trigger === 'https') {
    fn.httpsTrigger = {};
  } else if (requirement.trigger === 'event') {
    fn.eventTrigger = {};
  } else {
    fn.scheduleTrigger = {};
  }

  return fn;
}

function liveSchedulerJobForRequirement(
  projectId: string,
  requirement: LiveFunctionRequirement,
  jobNameForRequirement: (projectId: string, requirement: LiveFunctionRequirement) => string,
) {
  return {
    name: jobNameForRequirement(projectId, requirement),
    schedule: requirement.schedule,
    timeZone: requirement.timeZone,
    retryConfig: requirement.retryCount === undefined ? undefined : { retryCount: requirement.retryCount },
    state: 'ENABLED',
  };
}

describe('tax receipt deploy helper', () => {
  it('defaults to a read-only deploy plan', () => {
    const result = runDeployScript();

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Default mode is read-only.');
    expect(result.stdout).toContain('Required Node.js: 22.x');
    expect(result.stdout).toContain('Current Node.js:');
    expect(result.stdout).toContain('Use the repo toolchain before deploy mode: nvm use 22');
    expect(result.stdout).toContain('npm run check:stripe-production -- --strict-native-links');
    expect(result.stdout).toContain('npm run lint');
    expect(result.stdout).toContain('npm run test:qa');
    expect(result.stdout).toContain('npm run build');
    expect(result.stdout).toContain(
      'npx --no-install firebase deploy --only functions,firestore:rules,firestore:indexes,storage,hosting'
    );
    expect(result.stdout).toContain('npm run check:firebase-live -- --strict-native-links');
    expect(result.stdout).toContain('npm run audit:tax-receipts -- --fail-on-repairs');
    expect(result.stdout.match(/npm run audit:tax-receipts -- --fail-on-repairs/g)).toHaveLength(2);
    expect(result.stdout).toContain('Before deploy/live receipt smoke testing, finish native return links');
    expect(result.stdout).toContain('npm run configure:native-links -- --status');
    expect(result.stdout).toContain('npm run configure:native-links -- --apple-team-id TEAMID1234 --android-sha256 AA:BB:...:99');
    expect(result.stdout).toContain('npm run configure:native-links -- --apple-from-xcode-project --android-from-release-keystore');
    expect(result.stdout).toContain('npm run check:stripe-account-live');
    expect(result.stdout).toContain('npm run check:resend-live');
    expect(result.stdout).toContain('npm run configure:stripe-webhook');
    expect(result.stdout).toContain('npm run configure:receipt-secrets');
    expect(result.stdout).toContain('npm run check:stripe-webhook-live');
    expect(result.stdout).toContain('npm run check:live-donation-smoke');
    expect(result.stdout).toContain('npm run check:live-donation-smoke -- --require-sent-receipt');
    expect(result.stdout).toContain('npm run check:live-annual-receipt-smoke');
    expect(result.stdout).toContain('Current local native-link derivation status:');
    expect(result.stdout).toContain('Apple Team ID:');
    expect(result.stdout).toContain('Android release signing:');
    expect(result.stderr).toBe('');
  });

  it('refuses deploy mode without explicit live project confirmation', () => {
    const result = runDeployScript(['--deploy']);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Refusing to deploy without --confirm-project kandilo-2f7a9.');
    expect(result.stdout).not.toContain('firebase deploy --only');
  });

  it('rejects mistyped deploy helper arguments before any deploy gate runs', () => {
    const unknown = runDeployScript(['--deply']);

    expect(unknown.status).toBe(1);
    expect(unknown.stderr).toContain('Unknown argument --deply.');
    expect(unknown.stderr).toContain('Usage:');
    expect(unknown.stdout).toBe('');

    const malformed = runDeployScript(['--deploy=true']);
    expect(malformed.status).toBe(1);
    expect(malformed.stderr).toContain('--deploy does not accept a value.');
    expect(malformed.stdout).toBe('');

    const missingValue = runDeployScript(['--deploy', '--confirm-project']);
    expect(missingValue.status).toBe(1);
    expect(missingValue.stderr).toContain('Missing value for --confirm-project.');
    expect(missingValue.stdout).toBe('');
  });

  it('keeps local gates before the Firebase deploy command', () => {
    const source = readFileSync(scriptPath, 'utf8');
    const readinessIndex = source.indexOf("run(packageRunner(), ['run', 'check:stripe-production', '--', '--strict-native-links']);");
    const lintIndex = source.indexOf("run(packageRunner(), ['run', 'lint']);");
    const qaIndex = source.indexOf("run(packageRunner(), ['run', 'test:qa']);");
    const buildIndex = source.indexOf("run(packageRunner(), ['run', 'build']);");
    const preDeployVisibilityAuditIndex =
      source.indexOf("run(packageRunner(), ['run', 'audit:tax-receipts', '--', '--fail-on-repairs']);");
    const deployIndex = source.indexOf("'deploy',");
    const liveCheckIndex = source.indexOf("run(packageRunner(), ['run', 'check:firebase-live', '--', '--strict-native-links']);");
    const postDeployVisibilityAuditIndex =
      source.lastIndexOf("run(packageRunner(), ['run', 'audit:tax-receipts', '--', '--fail-on-repairs']);");

    expect(readinessIndex).toBeGreaterThan(-1);
    expect(lintIndex).toBeGreaterThan(readinessIndex);
    expect(qaIndex).toBeGreaterThan(lintIndex);
    expect(buildIndex).toBeGreaterThan(qaIndex);
    expect(preDeployVisibilityAuditIndex).toBeGreaterThan(buildIndex);
    expect(deployIndex).toBeGreaterThan(preDeployVisibilityAuditIndex);
    expect(liveCheckIndex).toBeGreaterThan(deployIndex);
    expect(postDeployVisibilityAuditIndex).toBeGreaterThan(liveCheckIndex);
    expect(source).toContain('const requiredNodeMajor = 22;');
    expect(source).toContain("return ['--no-install', 'firebase', ...commandArgs];");
    expect(source).toContain('function assertExpectedNodeRuntime()');
    expect(source).toContain('function validateDeployArgs(rawArgs)');
    expect(source).toContain('function nativeLinkDerivationStatus()');
    expect(source).toContain('appleTeamIdFromXcodeProject({ rootDir: root })');
    expect(source).toContain('androidReleaseSigningConfig({ rootDir: root })');
    expect(source).toContain('Unknown argument');
    expect(source).toContain('assertExpectedNodeRuntime();');
    expect(source).toContain("const deployTargets = 'functions,firestore:rules,firestore:indexes,storage,hosting';");
    expect(source).toContain('Refusing to deploy without --confirm-project');
  });

  it('runs static Stripe and tax receipt production readiness in CI without live credentials', () => {
    const rootPackage = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8'));
    const readinessSource = readFileSync(readinessScriptPath, 'utf8');
    const ciWorkflowSource = readFileSync(ciWorkflowPath, 'utf8');

    expect(rootPackage.scripts['check:stripe-production:ci']).toBe(
      'node scripts/check-stripe-production-readiness.mjs --ci-static',
    );
    expect(readinessSource).toContain('function validateReadinessArgs(args)');
    expect(readinessSource).toContain('const expectedNodeMajor = 22;');
    expect(readinessSource).toContain('function currentNodeMajor()');
    expect(readinessSource).toContain('Local Node.js runtime is ${expectedNodeMajor}.x');
    expect(readinessSource).toContain('Run nvm use 22 before production readiness, build, and deploy checks.');
    expect(readinessSource).toContain("const ciStaticMode = readinessArgs.includes('--ci-static');");
    expect(readinessSource).toContain('Usage: npm run check:stripe-production -- [--live] [--strict-native-links] [--ci-static]');
    expect(readinessSource).toContain('Skipped in CI static readiness mode');
    expect(readinessSource).toContain('CI runs static Stripe and tax receipt production readiness without live credentials');
    expect(ciWorkflowSource).toContain('Stripe and tax receipt production readiness');
    expect(ciWorkflowSource).toContain('node-version: 22');
    expect(ciWorkflowSource).toContain('npm run check:stripe-production:ci');
    expect(ciWorkflowSource.indexOf('npm --prefix functions ci')).toBeLessThan(
      ciWorkflowSource.indexOf('npm run check:stripe-production:ci'),
    );
  });

  it('pins nested Functions package and admin docs Firebase commands to the repo CLI', () => {
    const functionsPackage = JSON.parse(readFileSync(functionsPackagePath, 'utf8'));
    const readinessSource = readFileSync(readinessScriptPath, 'utf8');
    const envExampleSource = readFileSync(envExamplePath, 'utf8');
    const makePriestSource = readFileSync(makePriestScriptPath, 'utf8');

    expect(functionsPackage.scripts.serve).toContain(
      'npx --prefix .. --no-install firebase emulators:start --only auth,firestore,functions,storage',
    );
    expect(functionsPackage.scripts.serve).toContain('STRIPE_SECRET_KEY=sk_test_kandilo_emulator');
    expect(functionsPackage.scripts.serve).toContain('RESEND_API_KEY=re_kandilo_emulator_test');
    expect(functionsPackage.scripts.deploy).toBe('npx --prefix .. --no-install firebase deploy --only functions');
    expect(envExampleSource).toContain('npm run configure:receipt-secrets');
    expect(envExampleSource).toContain(
      'npx --no-install firebase functions:secrets:set RESEND_API_KEY --project kandilo-2f7a9',
    );
    expect(envExampleSource).toContain(
      'npx --no-install firebase functions:secrets:set STRIPE_SECRET_KEY --project kandilo-2f7a9',
    );
    expect(envExampleSource).toContain(
      'npx --no-install firebase functions:secrets:set STRIPE_WEBHOOK_SECRET --project kandilo-2f7a9',
    );
    expect(envExampleSource).toContain('VITE_FIREBASE_STORAGE_BUCKET="kandilo-2f7a9.firebasestorage.app"');
    expect(readinessSource).toContain(
      '.env example, setup docs, and live receipt smoke verifier agree on ${expectedFirebaseStorageBucket}',
    );
    expect(makePriestSource).toContain('npx --no-install firebase login');
    expect(readinessSource).toContain(
      'Firebase CLI is pinned in package.json, package-lock, guarded release scripts, nested Functions package scripts, secret/admin docs, privileged role-admin scripts, and live sample-data scripts require explicit project confirmation',
    );
  });

  it('guards privileged role-admin and live sample-data scripts with explicit production project confirmation', () => {
    const helpers = [
      {
        path: makePriestScriptPath,
        args: ['user-1', 'church-1'],
        missingMessage: 'Refusing to grant priest membership without --confirm-project kandilo-2f7a9.',
      },
      {
        path: bootstrapAdminScriptPath,
        args: ['admin@example.com', 'Admin User', 'church-1'],
        env: { KANDILO_BOOTSTRAP_PASSWORD: 'test-password-123' },
        missingMessage: 'Refusing to bootstrap a priest account without --confirm-project kandilo-2f7a9.',
      },
      {
        path: setSuperAdminScriptPath,
        args: ['user-1'],
        missingMessage: 'Refusing to grant superAdmin without --confirm-project kandilo-2f7a9.',
      },
      {
        path: seedChurchProfilesScriptPath,
        args: [],
        missingMessage: 'Refusing to update sample church profiles without --confirm-project kandilo-2f7a9.',
      },
    ];

    for (const helper of helpers) {
      const source = readFileSync(helper.path, 'utf8');
      expect(source).toContain("const expectedProjectId = 'kandilo-2f7a9';");
      expect(source).toContain('--confirm-project');
      expect(source).toContain('assertExpectedProjectConfirmation(confirmProject);');
      expect(source).toContain('projectId: expectedProjectId');

      const missingConfirmation = runNodeScript(helper.path, helper.args, helper.env);
      expect(missingConfirmation.status).toBe(1);
      expect(missingConfirmation.stderr).toContain(helper.missingMessage);
      expect(missingConfirmation.stderr).toContain('--confirm-project kandilo-2f7a9');
      expect(missingConfirmation.stdout).toBe('');

      const wrongProject = runNodeScript(helper.path, [...helper.args, '--confirm-project', 'staging-project'], helper.env);
      expect(wrongProject.status).toBe(1);
      expect(wrongProject.stderr).toContain(helper.missingMessage);
      expect(wrongProject.stdout).toBe('');

      const missingConfirmProjectValue = runNodeScript(helper.path, [...helper.args, '--confirm-project'], helper.env);
      expect(missingConfirmProjectValue.status).toBe(1);
      expect(missingConfirmProjectValue.stderr).toContain('Missing value for --confirm-project.');
      expect(missingConfirmProjectValue.stdout).toBe('');

      const unknownArg = runNodeScript(helper.path, [...helper.args, '--project', 'staging-project'], helper.env);
      expect(unknownArg.status).toBe(1);
      expect(unknownArg.stderr).toContain('Unknown argument --project.');
      expect(unknownArg.stdout).toBe('');
    }

    const bootstrapSource = readFileSync(bootstrapAdminScriptPath, 'utf8');
    expect(bootstrapSource.indexOf("const churchDoc = await db.collection('churches').doc(churchId).get();"))
      .toBeLessThan(bootstrapSource.indexOf('const existing = await auth.getUserByEmail(email);'));
    expect(bootstrapSource.indexOf("const churchDoc = await db.collection('churches').doc(churchId).get();"))
      .toBeLessThan(bootstrapSource.indexOf('const created = await auth.createUser({ email, password, displayName });'));
  }, 20_000); // Sixteen CLI subprocesses can exceed the unit-test default on CI.

  it('rejects mistyped production readiness flags before running checks', () => {
    const result = spawnSync(process.execPath, [readinessScriptPath, '--strict-native-link'], {
      cwd: process.cwd(),
      encoding: 'utf8',
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Unknown argument --strict-native-link.');
    expect(result.stderr).toContain('Usage: npm run check:stripe-production');
    expect(result.stdout).toBe('');
  });

  it('checks live Hosting freshness after the guarded release deploy', () => {
    const source = readFileSync(readinessScriptPath, 'utf8');
    const liveFunctionSource = readFileSync(liveFunctionsReadinessPath, 'utf8');

    expect(source).toContain('function assetReferencesFromIndexHtml(html)');
    expect(source).toContain('function newestHostingBuildInputMtimeMs()');
    expect(source).toContain('function parseJsonText(text, label)');
    expect(source).toContain('function jsonEquivalent(left, right)');
    expect(source).toContain('Local production Hosting build is current with frontend source inputs');
    expect(source).toContain('async function readPublicTextResponse(url, label)');
    expect(source).toContain('function deployedHostingSecurityHeadersReady(headers)');
    expect(source).toContain("from './readiness-live-functions.mjs';");
    expect(source).toContain('const expectedFunctionsRuntime = expectedLiveFunctionsRuntime;');
    expect(source).toContain('evaluateLiveFunctionDeployment(');
    expect(source).toContain('liveFunctionDeploymentReadyLabel');
    expect(source).toContain('requiredLiveSchedulerJobs(expectedProjectId)');
    expect(source).toContain('readCloudSchedulerJson');
    expect(source).toContain('evaluateLiveSchedulerJobs(');
    expect(source).toContain('liveSchedulerJobReadyLabel');
    expect(liveFunctionSource).toContain("export const expectedLiveFunctionsRuntime = 'nodejs22';");
    expect(liveFunctionSource).toContain('export const liveSchedulerJobReadyLabel');
    expect(liveFunctionSource).toContain('function expectedScheduleRequirements');
    expect(liveFunctionSource).toContain('export function requiredLiveSchedulerJobs');
    expect(liveFunctionSource).toContain('export function evaluateLiveSchedulerJobs');
    expect(liveFunctionSource).toContain('function schedulerJobRetryCount');
    expect(liveFunctionSource).toContain('function numberValueFromNode');
    expect(liveFunctionSource).toContain('function firebaseSecretName(value)');
    expect(liveFunctionSource).toContain('function deployedFunctionSecretNames(fn)');
    expect(liveFunctionSource).toContain('function functionDeploymentKey(fn)');
    expect(liveFunctionSource).toContain('function functionRuntime(fn)');
    expect(liveFunctionSource).toContain('function functionState(fn)');
    expect(liveFunctionSource).toContain('functionRuntime(deployed) !== expectedRuntime');
    expect(liveFunctionSource).toContain('runtimeMismatchedFunctions');
    expect(liveFunctionSource).toContain('stateMismatchedFunctions');
    expect(liveFunctionSource).toContain('secretMismatchedFunctions');
    expect(liveFunctionSource).toContain('retryMismatchedSchedulerJobs');
    expect(liveFunctionSource).toContain('unexpectedSecretMismatchedFunctions');
    expect(liveFunctionSource).toContain('unexpectedSensitiveFunctionDeployments');
    expect(liveFunctionSource).toContain('isSensitiveStripeTaxReceiptFunctionId');
    expect(liveFunctionSource).toContain('unexpectedSensitiveFunctions');
    expect(liveFunctionSource).toContain('unexpected sensitive deployments');
    expect(liveFunctionSource).toContain('unexpected sensitive functions');
    expect(liveFunctionSource).toContain('Live Firebase deployment includes required active Stripe and tax receipt Functions on Node.js 22 with exact secret bindings');
    expect(liveFunctionSource).toContain('Live Cloud Scheduler jobs for tax receipt automation are enabled with the expected cadence, timezone, and retry policy');
    expect(liveFunctionSource).toContain("schedule: 'every 24 hours'");
    expect(liveFunctionSource).toContain("timeZone: 'Etc/UTC'");
    expect(liveFunctionSource).toContain('retryCount: 0');
    expect(source).toContain('async function publicResourceAvailable(url)');
    expect(source).toContain("readText('dist/index.html')");
    expect(source).toContain('Firebase Hosting serves ${expectedAppUrl}');
    expect(source).toContain('Live Firebase Hosting serves required receipt portal security headers');
    expect(source).toContain('Live Firebase Hosting serves current production build asset references');
    expect(source).toContain('Live Firebase Hosting serves current production build asset files');
    expect(source).toContain('Live Firebase Hosting serves Apple universal links file');
    expect(source).toContain('Live Apple universal links file matches local production configuration');
    expect(source).toContain('Live Firebase Hosting serves Android app links file');
    expect(source).toContain('Live Android app links file matches local production configuration');
    expect(source).toContain('Live native universal/app links are production-final for Stripe and invitation returns');
    expect(source).toContain('await checkLiveHostingDeployment();');

    const missingAssetsIndex = source.indexOf('const missingAssets = localAssets.filter');
    const assetFileGateIndex = source.indexOf('if (missingAssets.length === 0)', missingAssetsIndex);
    const appleCheckIndex = source.indexOf('Live Firebase Hosting serves Apple universal links file');
    expect(assetFileGateIndex).toBeGreaterThan(missingAssetsIndex);
    expect(appleCheckIndex).toBeGreaterThan(assetFileGateIndex);
    expect(source.slice(missingAssetsIndex, appleCheckIndex)).not.toContain('return;');
  });

  it('evaluates live Function deployment state and exact secret bindings from Firebase metadata', async () => {
    const {
      evaluateLiveFunctionDeployment,
      requiredLiveStripeTaxReceiptFunctions,
    } = await import(pathToFileURL(liveFunctionsReadinessPath).href);
    const requirements = requiredLiveStripeTaxReceiptFunctions as LiveFunctionRequirement[];
    const deployedFunctions = requirements.map(liveFunctionForRequirement);

    const ready = evaluateLiveFunctionDeployment(deployedFunctions);

    expect(ready.ok).toBe(true);
    expect(ready.detail).toBe('');

    const driftedFunctions = [
      ...deployedFunctions,
      liveFunctionForRequirement({
        id: 'legacyStripePaymentIntent',
        region: 'us-central1',
        trigger: 'callable',
        secrets: ['STRIPE_SECRET_KEY'],
      }),
      liveFunctionForRequirement({
        id: 'stripeWebhook',
        region: 'northamerica-northeast2',
        trigger: 'https',
        secrets: ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET'],
      }),
    ]
      .filter((fn) => fn.id !== 'sendAnnualTaxReceipt')
      .map((fn) => {
        if (fn.id === 'stripeWebhook') {
          return { ...fn, runtime: 'nodejs20' };
        }
        if (fn.id === 'sendTaxReceipt') {
          return { ...fn, state: 'FAILED' };
        }
        if (fn.id === 'getTaxReceiptAuditEvents') {
          const withoutCallableTrigger = { ...fn };
          delete withoutCallableTrigger.callableTrigger;
          return { ...withoutCallableTrigger, region: 'us-central1', eventTrigger: {} };
        }
        if (fn.id === 'getPaymentOperationsReadiness') {
          return {
            ...fn,
            secretEnvironmentVariables: secretEnvironmentVariables(['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET']),
          };
        }
        if (fn.id === 'createStripePaymentIntent') {
          return {
            ...fn,
            secretEnvironmentVariables: secretEnvironmentVariables(['STRIPE_SECRET_KEY']),
          };
        }
        return fn;
      });

    const drifted = evaluateLiveFunctionDeployment(driftedFunctions);

    expect(drifted.ok).toBe(false);
    expect(drifted.missingFunctions).toContain('sendAnnualTaxReceipt');
    expect(drifted.mismatchedFunctions).toContain(
      'getTaxReceiptAuditEvents expected us-central1/callable, got us-central1/event'
    );
    expect(drifted.runtimeMismatchedFunctions).toContain('stripeWebhook expected nodejs22, got nodejs20');
    expect(drifted.stateMismatchedFunctions).toContain('sendTaxReceipt expected ACTIVE, got FAILED');
    expect(drifted.secretMismatchedFunctions).toContain('getPaymentOperationsReadiness missing RESEND_API_KEY');
    expect(drifted.unexpectedSecretMismatchedFunctions).toContain(
      'createStripePaymentIntent has unexpected STRIPE_SECRET_KEY'
    );
    expect(drifted.unexpectedSensitiveFunctionDeployments).toContain(
      'legacyStripePaymentIntent in us-central1'
    );
    expect(drifted.unexpectedSensitiveFunctionDeployments).toContain(
      'stripeWebhook in northamerica-northeast2'
    );
    expect(drifted.unexpectedSensitiveFunctions).toContain('legacyStripePaymentIntent');
    expect(drifted.detail).toContain('missing: sendAnnualTaxReceipt');
    expect(drifted.detail).toContain('state: sendTaxReceipt expected ACTIVE, got FAILED');
    expect(drifted.detail).toContain('unexpected secrets: createStripePaymentIntent has unexpected STRIPE_SECRET_KEY');
    expect(drifted.detail).toContain('unexpected sensitive deployments: legacyStripePaymentIntent in us-central1');
    expect(drifted.detail).toContain('unexpected sensitive functions: legacyStripePaymentIntent');
  });

  it('evaluates live Cloud Scheduler cadence and timezone for annual receipt automation', async () => {
    const {
      evaluateLiveSchedulerJobs,
      liveSchedulerJobNameForRequirement,
      requiredLiveStripeTaxReceiptFunctions,
    } = await import(pathToFileURL(liveFunctionsReadinessPath).href);
    const requirements = requiredLiveStripeTaxReceiptFunctions as LiveFunctionRequirement[];
    const scheduledRequirements = requirements.filter((requirement) => requirement.trigger === 'scheduled');
    const schedulerJobs = scheduledRequirements.map((requirement) =>
      liveSchedulerJobForRequirement(
        'kandilo-2f7a9',
        requirement,
        liveSchedulerJobNameForRequirement,
      )
    );

    expect(scheduledRequirements).toEqual([
      expect.objectContaining({
        id: 'prepareYearEndAnnualTaxReceipts',
        schedule: 'every 24 hours',
        timeZone: 'Etc/UTC',
        retryCount: 0,
      }),
    ]);

    const ready = evaluateLiveSchedulerJobs(schedulerJobs, { projectId: 'kandilo-2f7a9' });

    expect(ready.ok).toBe(true);
    expect(ready.detail).toBe('');

    const driftedSchedulerJobs = schedulerJobs.map((job) => ({
      ...job,
      schedule: 'every 1 hours',
      timeZone: 'America/Edmonton',
      retryConfig: { retryCount: 5 },
      state: 'PAUSED',
    }));
    const drifted = evaluateLiveSchedulerJobs(driftedSchedulerJobs, { projectId: 'kandilo-2f7a9' });

    expect(drifted.ok).toBe(false);
    expect(drifted.scheduleMismatchedSchedulerJobs).toContain(
      'prepareYearEndAnnualTaxReceipts expected every 24 hours, got every 1 hours (projects/kandilo-2f7a9/locations/us-central1/jobs/firebase-schedule-prepareYearEndAnnualTaxReceipts-us-central1)'
    );
    expect(drifted.timeZoneMismatchedSchedulerJobs).toContain(
      'prepareYearEndAnnualTaxReceipts expected Etc/UTC, got America/Edmonton (projects/kandilo-2f7a9/locations/us-central1/jobs/firebase-schedule-prepareYearEndAnnualTaxReceipts-us-central1)'
    );
    expect(drifted.stateMismatchedSchedulerJobs).toContain(
      'prepareYearEndAnnualTaxReceipts expected ENABLED, got PAUSED (projects/kandilo-2f7a9/locations/us-central1/jobs/firebase-schedule-prepareYearEndAnnualTaxReceipts-us-central1)'
    );
    expect(drifted.retryMismatchedSchedulerJobs).toContain(
      'prepareYearEndAnnualTaxReceipts expected retryCount 0, got 5 (projects/kandilo-2f7a9/locations/us-central1/jobs/firebase-schedule-prepareYearEndAnnualTaxReceipts-us-central1)'
    );
    expect(drifted.detail).toContain('schedule: prepareYearEndAnnualTaxReceipts expected every 24 hours');
    expect(drifted.detail).toContain('timezone: prepareYearEndAnnualTaxReceipts expected Etc/UTC');
    expect(drifted.detail).toContain('state: prepareYearEndAnnualTaxReceipts expected ENABLED');
    expect(drifted.detail).toContain('retry: prepareYearEndAnnualTaxReceipts expected retryCount 0');
  });

  it('keeps the live Function deployment manifest aligned with local source declarations', async () => {
    const {
      evaluateLiveFunctionManifestSourceAlignment,
      requiredLiveStripeTaxReceiptFunctions,
    } = await import(pathToFileURL(liveFunctionsReadinessPath).href);
    const indexSource = readFileSync(resolve(process.cwd(), 'functions/src/index.ts'), 'utf8');
    const regionsSource = readFileSync(resolve(process.cwd(), 'functions/src/shared/regions.ts'), 'utf8');
    const givingSource = readGivingModuleSource();
    const superAdminSource = readFileSync(resolve(process.cwd(), 'functions/src/modules/superAdmin.ts'), 'utf8');

    const aligned = evaluateLiveFunctionManifestSourceAlignment({
      indexSource,
      functionSources: [givingSource, superAdminSource],
      constantSources: [regionsSource],
    });

    expect(aligned.ok).toBe(true);
    expect(aligned.detail).toBe('');

    const driftedRequirements = [
      ...(requiredLiveStripeTaxReceiptFunctions as LiveFunctionRequirement[])
      .map((requirement) => {
        if (requirement.id === 'prepareYearEndAnnualTaxReceipts') {
          return {
            ...requirement,
            schedule: 'every 1 hours',
            timeZone: 'America/Edmonton',
            retryCount: 5,
          };
        }
        if (requirement.id === 'sendTaxReceipt') {
          return { ...requirement, secrets: [] };
        }
        if (requirement.id === 'createStripePaymentIntent') {
          return { ...requirement, secrets: ['STRIPE_SECRET_KEY'] };
        }
        if (requirement.id === 'onGivingCompleted') {
          return { ...requirement, region: 'us-central1' };
        }
        return requirement;
      }),
      { id: 'missingReceiptFunction', region: 'us-central1', trigger: 'callable' as const },
    ];
    const drifted = evaluateLiveFunctionManifestSourceAlignment({
      indexSource,
      functionSources: [givingSource, superAdminSource],
      constantSources: [regionsSource],
      requiredFunctions: driftedRequirements,
    });

    expect(drifted.ok).toBe(false);
    expect(drifted.sourceMismatchedFunctions).toContain(
      'sendTaxReceipt expected us-central1/callable secrets none, got us-central1/callable secrets RESEND_API_KEY'
    );
    expect(drifted.sourceMismatchedFunctions).toContain(
      'createStripePaymentIntent expected us-central1/callable secrets STRIPE_SECRET_KEY, got us-central1/callable secrets none'
    );
    expect(drifted.sourceMismatchedFunctions).toContain(
      'onGivingCompleted expected us-central1/event secrets RESEND_API_KEY, got northamerica-northeast2/event secrets RESEND_API_KEY'
    );
	    expect(drifted.sourceMismatchedFunctions).toContain(
	      'prepareYearEndAnnualTaxReceipts expected us-central1/scheduled secrets RESEND_API_KEY schedule every 1 hours timezone America/Edmonton retryCount 5, got us-central1/scheduled secrets RESEND_API_KEY schedule every 24 hours timezone Etc/UTC retryCount 0'
	    );
    expect(drifted.missingExports).toContain('missingReceiptFunction');
    expect(drifted.missingSourceDeclarations).toContain('missingReceiptFunction');
  });

  it('guards the configured Stripe API version against the installed SDK default', () => {
    const source = readFileSync(readinessScriptPath, 'utf8');

    expect(source).toContain('function readInstalledStripeApiVersion()');
    expect(source).toContain('functions/node_modules/stripe/cjs/apiVersion.js');
    expect(source).toContain('functions/node_modules/stripe/esm/apiVersion.js');
    expect(source).toContain(
      'Functions Stripe client API version matches installed stripe-node default'
    );
    expect(source).toContain(
      'Update STRIPE_API_VERSION/docs/tests with the SDK upgrade.'
    );
  });

  it('surfaces native universal and app-link production identifiers for Stripe returns', () => {
    const source = readFileSync(readinessScriptPath, 'utf8');

    expect(source).toContain('function appleUniversalLinksReady(appleAppSiteAssociation)');
    expect(source).toContain('function androidAppLinksReady(assetLinks)');
    expect(source).toContain('function nativeLinkFilesAvoidUnsafePlaceholders(appleAppSiteAssociation, assetLinks)');
    expect(source).toContain("readJson('public/.well-known/apple-app-site-association')");
    expect(source).toContain("readJson('public/.well-known/assetlinks.json')");
    expect(source).toContain('Native universal/app links are production-final for Stripe and invitation returns');
    expect(source).toContain('Checked-in native link files do not trust placeholder Apple or debug Android identifiers');
    expect(source).toContain('Run npm run configure:native-links -- --status');
    expect(source).toContain('Run npm run configure:native-links -- --apple-team-id TEAMID1234 --android-sha256 AA:BB:...:99');
    expect(source).toContain('--apple-from-xcode-project');
    expect(source).toContain('final App Store team ID and Play Store release signing fingerprint');
    expect(source).toContain('Manual Stripe/Firebase/native checks still required before live donations');
    expect(source).toContain('const normalizedFingerprint = fingerprint.trim().toUpperCase();');
    expect(source).toContain("const strictNativeLinks = readinessArgs.includes('--strict-native-links');");
    expect(source).toContain('validateReadinessArgs(readinessArgs);');
    expect(source).toContain("const nativeLinkSeverity = strictNativeLinks ? 'fail' : 'warn';");
    expect(source).toContain('nativeLinkSeverity');
    expect(source).toContain("readText('scripts/configure-native-links.mjs')");
    expect(source).toContain("rootPackage?.scripts?.['configure:native-links']");
    expect(source).toContain('Native universal/app-link final identifier configuration is guarded');
    expect(source).toContain('function nativeLinkHostingHeadersReady(firebaseJson)');
    expect(source).toContain('Hosting serves native link well-known files with unambiguous no-cache JSON headers');
    expect(source).toContain('Access-Control-Allow-Origin');
  });

  it('keeps native-link Hosting headers singular and no-cache for Stripe returns', () => {
    const firebaseJson = JSON.parse(readFileSync(firebaseJsonPath, 'utf8'));
    const headers = firebaseJson.hosting.headers as Array<{
      source: string;
      headers: Array<{ key: string; value: string }>;
    }>;
    const appleEntries = headers.filter((entry) => entry.source === '/.well-known/apple-app-site-association');
    const androidEntries = headers.filter((entry) => entry.source === '/.well-known/assetlinks.json');
    const headerValue = (
      entry: { headers: Array<{ key: string; value: string }> },
      key: string
    ) => entry.headers.find((header) => header.key === key)?.value;

    expect(appleEntries).toHaveLength(1);
    expect(androidEntries).toHaveLength(1);
    expect(headerValue(appleEntries[0], 'Content-Type')).toBe('application/json');
    expect(headerValue(appleEntries[0], 'Cache-Control')).toBe('no-cache');
    expect(headerValue(androidEntries[0], 'Content-Type')).toBe('application/json');
    expect(headerValue(androidEntries[0], 'Cache-Control')).toBe('no-cache');
    expect(headerValue(androidEntries[0], 'Access-Control-Allow-Origin')).toBe('*');
  });

  it('surfaces guarded live Stripe webhook endpoint setup before live donations', () => {
    const source = readFileSync(readinessScriptPath, 'utf8');

    expect(source).toContain("readText('scripts/configure-stripe-live-webhook.mjs')");
    expect(source).toContain("rootPackage?.scripts?.['configure:stripe-webhook']");
    expect(source).toContain('Live Stripe webhook setup helper is guarded, exact, and duplicate-safe');
    expect(source).toContain('validateArgs');
    expect(source).toContain('Unknown argument');
    expect(source).toContain('--print-secret-once');
    expect(source).toContain('Refusing to create a duplicate endpoint');
    expect(source).toContain('Store this one-time signing secret in Firebase Secret Manager as STRIPE_WEBHOOK_SECRET');
  });

  it('surfaces guarded Firebase Secret Manager setup for receipt-path secrets', () => {
    const source = readFileSync(readinessScriptPath, 'utf8');

    expect(source).toContain("readText('scripts/configure-firebase-receipt-secrets.mjs')");
    expect(source).toContain("rootPackage?.scripts?.['configure:receipt-secrets']");
    expect(source).toContain('Receipt Firebase Secret Manager setup helper is project-confirmed');
    expect(source).toContain('STRIPE_SECRET_KEY');
    expect(source).toContain('STRIPE_WEBHOOK_SECRET');
    expect(source).toContain('RESEND_API_KEY');
    expect(source).toContain('functions:secrets:set');
    expect(source).toContain('validateArgs');
    expect(source).toContain('Unknown argument');
    expect(source).toContain('assertExpectedFirebaseProject');
  });

  it('surfaces the read-only live donation smoke verifier before announcing receipts', () => {
    const source = readFileSync(readinessScriptPath, 'utf8');

    expect(source).toContain("readText('scripts/check-live-donation-smoke.mjs')");
    expect(source).toContain("rootPackage?.scripts?.['check:live-donation-smoke']");
    expect(source).toContain('Live donation smoke verifier is project-bound, freshness-windowed, queries live processed Checkout smoke and live issue statuses directly, and proves checkout completion, giving completion, receipt readiness, absence of receipt errors, default privacy-safe church-facing giving mirror state without raw Stripe payment fields, stored official receipt identity/amount/currency/kind/status/assigned-number/fresh timestamp evidence, matching portal-visible receipt number evidence, retained PDF status/metadata plus Storage object presence/integrity metadata, backend email-sent audit evidence, and strict sent-receipt announcement gating without exposing private identifiers');
    expect(source).toContain('--require-sent-receipt');
    expect(source).toContain('Smoke donation reached a tax receipt-ready state');
    expect(source).toContain('Smoke donation official tax receipt was emailed');
    expect(source).toContain('Smoke donation giving record includes receipt-sent timestamp evidence');
    expect(source).toContain('Smoke donation church-facing donor email is blank');
    expect(source).toContain('Smoke donation church receipt visibility matches donor anonymity');
    expect(source).toContain('Smoke donation church-facing giving safe version matches donor anonymity');
    expect(source).toContain('Smoke donation church-facing donor label is not an email address');
    expect(source).toContain('Smoke donation has no tax receipt setup error');
    expect(source).toContain('Smoke donation has no tax receipt email error');
    expect(source).toContain('Stored official receipt is a single-donation receipt');
    expect(source).toContain('Stored official receipt status is issued or sent');
    expect(source).toContain('Stored official receipt matches the smoke giving document');
    expect(source).toContain('Stored official receipt amount matches the smoke donation');
    expect(source).toContain('Stored official receipt currency matches the smoke donation');
    expect(source).toContain('Stored official receipt includes an official receipt number');
    expect(source).toContain('Smoke donation giving mirror includes the official receipt number');
    expect(source).toContain('Smoke donation giving mirror receipt number matches the stored receipt');
    expect(source).toContain('Stored official receipt has no delivery error');
    expect(source).toContain('Stored sent receipt includes email delivery timestamp evidence');
    expect(source).toContain('Stored sent receipt PDF retention status is retained');
    expect(source).toContain('Stored sent receipt includes retained PDF hash evidence');
    expect(source).toContain('Retained official receipt PDF object exists in Firebase Storage');
    expect(source).toContain('Retained official receipt PDF object byte length matches stored metadata');
    expect(source).toContain('Retained official receipt PDF object hash metadata matches stored metadata');
    expect(source).toContain('Stored sent receipt has backend email-sent audit evidence');
    expect(source).toContain('Stored sent receipt email audit has timestamp evidence');
    expect(source).toContain('taxReceiptSentAt');
    expect(source).toContain('taxReceiptNumber');
    expect(source).toContain('anonymous');
    expect(source).toContain('donorEmail');
    expect(source).toContain('donorName');
    expect(source).toContain('churchReceiptVisible');
    expect(source).toContain('taxReceiptEventsForReceiptQuery');
    expect(source).toContain('pdfRetainedAt');
    expect(source).toContain('pdfRetentionStatus');
    expect(source).toContain('without exposing donor, church, giving, receipt, Stripe event, tax receipt event, payment, PDF metadata, amount, currency, or access-token values');
    expect(source).toContain('Run the default check after the first small live donation and the strict sent-receipt check before announcing tax receipts.');
  });

  it('tracks receipt emulator seed privacy scenarios for local portal QA', () => {
    const source = readFileSync(readinessScriptPath, 'utf8');

    expect(source).toContain("const anonymousGivingId = 'giving_2026_anonymous';");
    expect(source).toContain("const unclassifiedGivingId = 'giving_2026_unclassified';");
    expect(source).toContain('function validateSeedArgs');
    expect(source).toContain('Unknown argument');
    expect(source).toContain('includeAnonymousField: false');
    expect(source).toContain('donorAnonymous: true');
    expect(source).toContain('donor-owned anonymous/unclassified giving rows');
    expect(source).toContain('anonymous annual summary mirror that remains donor-only');
    expect(source).toContain(
      'Local receipt portal emulator seeder is guarded, documents donor/church privacy and Canada/CRA unavailable checks'
    );
  });

  it('guards church receipt views against private donor row regressions', () => {
    const source = readFileSync(readinessScriptPath, 'utf8');

    expect(source).toContain("readText('src/lib/db/giving-subscriptions.test.ts')");
    expect(source).toContain('const donorGivingSubscriptionSource = sourceSlice(');
    expect(source).toContain('const donorAnnualSummarySubscriptionSource = sourceSlice(');
    expect(source).toContain('keeps anonymous giving visible in the donor-owned giving subscription');
    expect(source).toContain('keeps anonymous annual summaries visible in the donor-owned annual subscription');
    expect(source).toContain("callback(snap.docs.map(mapTaxReceiptSummaryRecord).filter((record) => record.kind === 'annual'));");
    expect(source).toContain("readText('src/features/management/ManagementReceiptsTab.test.ts')");
    expect(source).toContain('record.churchReceiptVisible === true');
    expect(source).toContain("record.donorEmail === ''");
    expect(source).toContain('record.donorNamePublicSafe === true');
    expect(source).toContain('record.receiptManagerGivingSafeVersion === 1');
    expect(source).toContain("record.kind === 'annual'");
    expect(source).toContain('record.donorAnonymous === false');
    expect(source).toContain("where('kind', '==', 'annual')");
    expect(source).toContain("where('churchReceiptVisible', '==', true)");
    expect(source).toContain("where('donorEmail', '==', '')");
    expect(source).toContain("where('donorNamePublicSafe', '==', true)");
    expect(source).toContain("where('receiptManagerGivingSafeVersion', '==', 1)");
    expect(source).toContain('summary.churchReceiptVisible === true');
    expect(source).toContain('constrains church receipt subscriptions to backend-marked public rows');
    expect(source).toContain('keeps receipt manager send-focused without full receipt view or download hooks');
    expect(source).toContain('giving-tax-legacy-hidden');
    expect(source).toContain('annual-target-hidden-staff');
    expect(source).toContain("expect(source).not.toContain('getTaxReceipt');");
    expect(source).toContain("expect(source).not.toContain('downloadTaxReceiptPdf');");
    expect(source).toContain("expect(source).not.toContain('onViewReceipt');");
    expect(source).toContain("expect(html).not.toContain('View tax receipt');");
    expect(source).toContain('defensively excludes private donor rows from church receipt views');
    expect(source).toContain('require backend-owned church receipt visibility for staff reads');
  });

  it('guards retained receipt PDF storage against client reads', () => {
    const source = readFileSync(readinessScriptPath, 'utf8');

    expect(source).toContain('keeps retained tax receipt PDFs backend-only for every client role');
    expect(source).toContain('const receiptPdfPath = `taxReceipts/${CHURCH_ID}/2026/giving-tax-1.pdf`;');
    expect(source).toContain('assertFails(getMetadata(ref(memberStorage, receiptPdfPath)))');
    expect(source).toContain('assertFails(getMetadata(ref(priestStorage, receiptPdfPath)))');
    expect(source).toContain('assertFails(getMetadata(ref(treasurerStorage, receiptPdfPath)))');
    expect(source).toContain('assertFails(getMetadata(ref(superAdminStorage, receiptPdfPath)))');
    expect(source).toContain('client-denied Storage rules coverage');
    expect(source).toContain('client-denied retained PDF Storage reads');
  });

  it('requires explicit annual receipt acknowledgement before duplicate-claim risk is accepted', () => {
    const source = readFileSync(readinessScriptPath, 'utf8');

    expect(source).toContain('const [pendingAnnualSend, setPendingAnnualSend] = useState<');
    expect(source).toContain('const confirmAnnualSend =');
    expect(source).toContain('needsPreviouslyReceiptedAcknowledgement');
    expect(source).toContain('setPendingAnnualSend({ kind, key: annualKey });');
    expect(source).toContain('onSendAnnualReceipt(userId, year, needsPreviouslyReceiptedAcknowledgement);');
    expect(source).toContain('onSendCorrectedAnnualReceipt(userId, year, needsPreviouslyReceiptedAcknowledgement);');
    expect(source).toContain('requires explicit confirmation before acknowledging previously receipted annual sends');
    expect(source).toContain('Receipt-manager annual sends require explicit acknowledgement for previously receipted gifts');
    expect(source).toContain("readText('src/components/GivingScreen.test.ts')");
    expect(source).toContain('const [pendingAnnualReceiptAck, setPendingAnnualReceiptAck] = useState<');
    expect(source).toContain('const confirmDonorAnnualReceiptSend =');
    expect(source).toContain('setPendingAnnualReceiptAck({ key: annualKey, corrected });');
    expect(source).toContain('aria-pressed={confirmingAnnualSend}');
    expect(source).toContain('requires explicit confirmation before donor annual receipt duplicate-claim acknowledgement');
    expect(source).toContain('Donor portal receipt actions fail closed for unknown historical receipt state, keep immediate post-Stripe receipt-history access, block annual-covered single sends, hide invalid or unsupported-jurisdiction full-receipt print/download controls, and require explicit annual duplicate-claim acknowledgement');
    expect(source).toContain('does not infer exact single-donation annual coverage from a summary mirror alone');
    expect(source).toContain('avoid summary-based per-gift annual coverage inference while relying on the backend exact duplicate guard');
  });

  it('guards donor receipt PDF and print actions against invalid receipt reuse', () => {
    const source = readFileSync(readinessScriptPath, 'utf8');

    expect(source).toContain('const taxReceiptActionBlocked = (receipt: FirestoreTaxReceiptRecord): boolean => (');
    expect(source).toContain('const blockedTaxReceiptMessage = (receipt: FirestoreTaxReceiptRecord): string => {');
    expect(source).toContain('receiptAction.missingAssignedReceiptNumber');
    expect(source).toContain('return extra.taxReceiptGenericIssue;');
    expect(source).toContain('if (selectedReceipt?.id === receiptId && taxReceiptActionBlocked(selectedReceipt))');
    expect(source).toContain('{!receiptActionBlocked && (');
    expect(source).toContain("!givingScreenSource.includes('disabled={downloadingReceiptId === selectedReceipt.id || receiptActionBlocked}')");
    expect(source).toContain("!givingScreenSource.includes('disabled={receiptActionBlocked}')");
    expect(source).toContain('hides donor PDF download and print controls for invalid full receipt records');
    expect(source).toContain('hide invalid or unsupported-jurisdiction full-receipt print/download controls');
  });

  it('guards immediate donor receipt access after Stripe success', () => {
    const source = readFileSync(readinessScriptPath, 'utf8');

    expect(source).toContain("if (givingPhase === 'success')");
    expect(source).toContain('extra.receiptHistoryTitle');
    expect(source).toContain('keeps immediate receipt history access on the post-Stripe success screen');
    expect(source).toContain('target?.focus({ preventScroll: true });');
    expect(source).toContain('role="region"');
    expect(source).toContain('tabIndex={-1}');
    expect(source).toContain('checkoutReturnMatchesPendingGiving(pending, givingId, sessionId)');
    expect(source).toContain('binds successful Checkout returns to the pending giving and session ids when present');
    expect(source).toContain('the pending context is bound to the returned `givingId` and Stripe Checkout `sessionId`');
    expect(source).toContain('fails closed when checkout return status cannot read the giving document');
    expect(source).toContain('Checkout return status polling fails closed to an unknown state');
    expect(source).toContain("successSource.indexOf('extra.receiptHistoryTitle')");
    expect(source).toContain('keep immediate post-Stripe receipt-history access');
    expect(source).toContain('the success screen keeps a direct Receipts action in Giving, then scrolls and moves focus to the visible receipt-history panel');
  });

  it('guards Stripe Connect onboarding returns with session-bound state', () => {
    const source = readFileSync(readinessScriptPath, 'utf8');

    expect(source).toContain("readText('src/lib/stripe/connect.ts')");
    expect(source).toContain("readText('functions/src/shared/appUrl.ts')");
    expect(source).toContain('configuredStripeReturnAppUrl');
    expect(source).toContain('requires APP_URL to be an HTTPS URL.');
    expect(source).toContain("if (error instanceof HttpsError) {\\n        throw error;\\n      }");
    expect(source).toContain('STRIPE_CONNECT_RETURN_STATE_PATTERN');
    expect(source).toContain("url.searchParams.set('state', returnState)");
    expect(source).toContain('createStripeConnectReturnState()');
    expect(source).toContain("try {\\n      const returnState = createStripeConnectReturnState();");
    expect(source).toContain('Secure random values are required for Stripe Connect onboarding.');
    expect(source).toContain("!stripeConnectHelpersSource.includes('Math.random')");
    expect(source).toContain("readText('src/components/app/AuthenticatedApp.test.ts')");
    expect(source).toContain("const initialManagementTab = stripeConnectReturnSignal ? 'receipts' : null;");
    expect(source).toContain("!authenticatedAppSource.includes('getInitialManagementTab(')");
    expect(source).toContain('stripeConnectReturnMatchesPendingOnboarding');
    expect(source).toContain('getChurchStripeConnectSetupStatus');
    expect(source).toContain('fetchChurchStripeConnectSetupStatus(churchId)');
    expect(source).toContain('returns redacted Stripe Connect setup status to receipt managers');
    expect(source).toContain('returns missing Stripe Connect setup status without exposing private account settings');
    expect(source).toContain('receipt-manager setup status stays redacted');
    expect(source).toContain('redacted connected-account setup status');
    expect(source).toContain('return URLs fail closed for invalid or non-HTTPS APP_URL outside local Functions emulators');
    expect(source).toContain('binds Stripe Connect returns to the pending church and return state');
    expect(source).toContain('session-bound receipt-manager return handling');
  });

  it('guards Stripe Connect account creation against stale church details', () => {
    const source = readFileSync(readinessScriptPath, 'utf8');

    expect(source).toContain('stripeConnectAccountCreationBlocker');
    expect(source).toContain('validStripeConnectCreationContactEmail');
    expect(source).toContain('Save church name, country, contact email, or website changes before creating a Stripe account.');
    expect(source).toContain('In-app Stripe account creation currently supports U.S. and Canadian parishes only.');
    expect(source).toContain('Save a valid church contact email before creating a Stripe account.');
    expect(source).toContain('blocks in-app Stripe account creation until saved U.S. or Canadian contact details are ready');
    expect(source).toContain('creates Canadian Stripe Connect accounts with country-derived defaults');
    expect(source).toContain('U.S./Canadian country-derived account defaults');
    expect(source).toContain('!canCreateStripeAccount');
    expect(source).toContain('Save those fields before creating the account');
    expect(source).toContain('The Mission Control create-account action is disabled while the church name, country, contact email, or website changes are unsaved');
    expect(source).toContain('saved-field account-creation preflights');
  });

  it('guards the SuperAdmin payment operations launch checklist', () => {
    const source = readFileSync(readinessScriptPath, 'utf8');

    expect(source).toContain("readText('src/lib/stripe/payment-operations-readiness.ts')");
    expect(source).toContain("readText('src/lib/stripe/payment-operations-readiness.test.ts')");
    expect(source).toContain('paymentOperationsLaunchSteps');
    expect(source).toContain('firstIncompletePaymentOperationsLaunchStep');
    expect(source).toContain('Complete one small live Checkout donation');
    expect(source).toContain('requires a clean live completed-Checkout webhook smoke result');
    expect(source).toContain('keeps checklist output free of private runtime values');
    expect(source).toContain('ordered launch checklist with the next incomplete setup action');
    expect(source).toContain('redacted payment/receipt readiness and ordered launch checklist');
  });
});
