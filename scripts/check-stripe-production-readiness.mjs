#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse as parseDotenv } from 'dotenv';
import {
  evaluateLiveFunctionManifestSourceAlignment,
  evaluateLiveFunctionDeployment,
  evaluateLiveSchedulerJobs,
  expectedLiveFunctionsRuntime,
  liveFunctionDeploymentReadyLabel,
  liveFunctionSourceManifestReadyLabel,
  liveSchedulerJobReadyLabel,
  requiredLiveSchedulerJobs,
} from './readiness-live-functions.mjs';

const root = process.cwd();
const expectedProjectId = 'kandilo-2f7a9';
const expectedAppUrl = 'https://app.kandilo.org';
const expectedFirebaseStorageBucket = `${expectedProjectId}.firebasestorage.app`;
const expectedNativePackageId = 'com.kandilo.app';
const expectedStripeApiVersion = '2026-04-22.dahlia';
const expectedFunctionsRuntime = expectedLiveFunctionsRuntime;
const expectedNodeMajor = 22;
const stripeWebhookUrl = `https://us-central1-${expectedProjectId}.cloudfunctions.net/stripeWebhook`;
const backendSecretNames = ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'RESEND_API_KEY'];
const androidDebugSha256Fingerprint = '32:A4:45:9C:CF:F1:04:67:BF:56:73:31:BE:29:5F:F5:FB:E2:CD:7F:95:EA:51:FE:12:A1:90:DA:E7:39:95:DF';

function validateReadinessArgs(args) {
  const allowedFlags = new Set(['--live', '--strict-native-links', '--ci-static']);
  for (const arg of args) {
    const equalsIndex = arg.indexOf('=');
    const name = equalsIndex >= 0 ? arg.slice(0, equalsIndex) : arg;
    if (!arg.startsWith('-')) {
      throw new Error(`Unexpected positional argument: ${arg}`);
    }
    if (!allowedFlags.has(name)) {
      throw new Error(`Unknown argument ${name}.`);
    }
    if (equalsIndex >= 0) {
      throw new Error(`${name} does not accept a value.`);
    }
  }
}

const readinessArgs = process.argv.slice(2);
try {
  validateReadinessArgs(readinessArgs);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  console.error('Usage: npm run check:stripe-production -- [--live] [--strict-native-links] [--ci-static]');
  process.exit(1);
}
const includeLiveFirebase = readinessArgs.includes('--live');
const strictNativeLinks = readinessArgs.includes('--strict-native-links');
const ciStaticMode = readinessArgs.includes('--ci-static');
const nativeLinkSeverity = strictNativeLinks ? 'fail' : 'warn';

let failures = 0;
let warnings = 0;

function readText(relativePath) {
  const filePath = resolve(root, relativePath);
  return existsSync(filePath) ? readFileSync(filePath, 'utf8') : null;
}

function readGivingModuleSource() {
  const legacySingleFileSource = readText('functions/src/modules/giving.ts');
  if (legacySingleFileSource !== null) {
    return legacySingleFileSource;
  }

  const givingDir = resolve(root, 'functions/src/modules/giving');
  if (!existsSync(givingDir) || !statSync(givingDir).isDirectory()) {
    return '';
  }

  return readdirSync(givingDir)
    .filter((file) => file.endsWith('.ts'))
    .sort()
    .map((file) => readFileSync(resolve(givingDir, file), 'utf8'))
    .join('\n');
}

function readJson(relativePath) {
  const text = readText(relativePath);
  if (text === null) return null;
  try {
    return JSON.parse(text);
  } catch (error) {
    record(false, `${relativePath} is valid JSON`, error instanceof Error ? error.message : String(error));
    return null;
  }
}

function parseJsonText(text, label) {
  try {
    return JSON.parse(text);
  } catch (error) {
    record(false, label, error instanceof Error ? error.message : String(error));
    return null;
  }
}

function readEnv(relativePath) {
  const text = readText(relativePath);
  return text === null ? null : parseDotenv(text);
}

function record(ok, label, detail = '', severity = 'fail') {
  if (ok) {
    console.log(`OK   ${label}`);
    return;
  }

  if (severity === 'warn') {
    warnings += 1;
    console.log(`WARN ${label}${detail ? ` - ${detail}` : ''}`);
    return;
  }

  failures += 1;
  console.log(`FAIL ${label}${detail ? ` - ${detail}` : ''}`);
}

function currentNodeMajor() {
  const major = Number.parseInt(process.versions.node.split('.')[0] ?? '', 10);
  return Number.isFinite(major) ? major : 0;
}

function hasPlaceholder(value) {
  if (!value) return true;
  return /your-|AIza\.\.\.|123456789|abc123|6L\.\.\.|BN\.\.\.|MY_/i.test(value);
}

function hasIndex(indexes, collectionGroup, fields) {
  return indexes.some((index) => {
    if (index.collectionGroup !== collectionGroup) return false;
    if (!Array.isArray(index.fields)) return false;
    const comparableFields = index.fields.filter((field) => field.fieldPath !== '__name__');
    if (comparableFields.length !== fields.length) return false;
    return fields.every((field, indexPosition) => {
      const actual = comparableFields[indexPosition];
      return actual?.fieldPath === field.fieldPath && actual?.order === field.order;
    });
  });
}

function hostingHeaderEntries(firebaseJson, source) {
  const entries = firebaseJson?.hosting?.headers;
  return Array.isArray(entries) ? entries.filter((entry) => entry?.source === source) : [];
}

function hostingHeaderValue(entry, key) {
  const headers = Array.isArray(entry?.headers) ? entry.headers : [];
  return headers.find((header) => header?.key === key)?.value ?? '';
}

function nativeLinkHostingHeadersReady(firebaseJson) {
  const appleEntries = hostingHeaderEntries(firebaseJson, '/.well-known/apple-app-site-association');
  const androidEntries = hostingHeaderEntries(firebaseJson, '/.well-known/assetlinks.json');
  if (appleEntries.length !== 1 || androidEntries.length !== 1) {
    return false;
  }

  const appleEntry = appleEntries[0];
  const androidEntry = androidEntries[0];
  return hostingHeaderValue(appleEntry, 'Content-Type') === 'application/json'
    && hostingHeaderValue(appleEntry, 'Cache-Control') === 'no-cache'
    && hostingHeaderValue(androidEntry, 'Content-Type') === 'application/json'
    && hostingHeaderValue(androidEntry, 'Cache-Control') === 'no-cache'
    && hostingHeaderValue(androidEntry, 'Access-Control-Allow-Origin') === '*';
}

function includesEvery(text, needles) {
  return needles.every((needle) => text.includes(needle));
}

function includesCollapsedWhitespace(text, needle) {
  return text.replace(/\s+/g, ' ').includes(needle.replace(/\s+/g, ' '));
}

function includesAny(text, needles) {
  return needles.some((needle) => text.includes(needle));
}

function matchesEvery(text, patterns) {
  return patterns.every((pattern) => pattern.test(text));
}

function hasEnabledSecretVersion(secretMetadata, secretName) {
  const secrets = Array.isArray(secretMetadata?.secrets) ? secretMetadata.secrets : [];
  return secrets.some((entry) => (
    entry?.secret?.name === secretName
    && entry?.state === 'ENABLED'
    && typeof entry?.versionId === 'string'
    && entry.versionId.length > 0
  ));
}

function packageDependencyIsExactlyLocked(packageJson, packageLock, dependencyName) {
  const declaredVersion = packageJson?.dependencies?.[dependencyName];
  return typeof declaredVersion === 'string'
    && /^\d+\.\d+\.\d+$/.test(declaredVersion)
    && packageLock?.packages?.['']?.dependencies?.[dependencyName] === declaredVersion
    && packageLock?.packages?.[`node_modules/${dependencyName}`]?.version === declaredVersion;
}

function readInstalledStripeApiVersion() {
  const candidates = [
    'functions/node_modules/stripe/cjs/apiVersion.js',
    'functions/node_modules/stripe/esm/apiVersion.js',
  ];

  for (const candidate of candidates) {
    const source = readText(candidate);
    const match = source?.match(/ApiVersion\s*=\s*['"]([^'"]+)['"]/);
    if (match?.[1]) {
      return match[1];
    }
  }

  return null;
}

function sourceSlice(source, startNeedle, endNeedle) {
  const start = source.indexOf(startNeedle);
  const end = source.indexOf(endNeedle);
  return start >= 0 && end > start ? source.slice(start, end) : '';
}

function normalizeRulesSource(source) {
  return source.replaceAll('\r\n', '\n').trim();
}

function includesAnyEnv(env, names) {
  return names.some((name) => name in env);
}

function assetReferencesFromIndexHtml(html) {
  const references = Array.from(html.matchAll(/\b(?:src|href)=["']([^"']+)["']/gi))
    .map((match) => match[1])
    .filter((ref) => ref.startsWith('/assets/') && /\.(?:js|css)(?:\?|$)/.test(ref));
  return [...new Set(references)].sort();
}

function shouldCountHostingBuildInput(filePath) {
  const normalized = filePath.replaceAll('\\', '/');
  return !/\.test\.[cm]?[jt]sx?$/.test(normalized)
    && !/\.spec\.[cm]?[jt]sx?$/.test(normalized)
    && !normalized.includes('/__mocks__/');
}

function newestHostingBuildInputMtimeMs() {
  const inputs = [
    '.env.local',
    'index.html',
    'package-lock.json',
    'package.json',
    'public',
    'src',
    'tsconfig.json',
    'vite.config.ts',
  ];
  let newest = 0;

  function visit(filePath) {
    if (!existsSync(filePath)) {
      return;
    }
    const stat = statSync(filePath);
    if (stat.isDirectory()) {
      for (const entry of readdirSync(filePath)) {
        visit(resolve(filePath, entry));
      }
      return;
    }
    if (stat.isFile() && shouldCountHostingBuildInput(filePath)) {
      newest = Math.max(newest, stat.mtimeMs);
    }
  }

  for (const input of inputs) {
    visit(resolve(root, input));
  }
  return newest;
}

function firebaseCommand() {
  return process.platform === 'win32' ? 'npx.cmd' : 'npx';
}

function firebaseCommandArgs(args) {
  return ['--no-install', 'firebase', ...args];
}

function readFirebaseJson(args, label) {
  const result = spawnSync(
    firebaseCommand(),
    firebaseCommandArgs([...args, '--project', expectedProjectId, '--json']),
    {
      cwd: root,
      encoding: 'utf8',
    }
);
  if (result.error) {
    record(false, label, result.error.message);
    return null;
  }
  if (result.status !== 0) {
    record(false, label, (result.stderr || result.stdout || `exit ${result.status}`).trim());
    return null;
  }

  try {
    const parsed = JSON.parse(result.stdout);
    if (parsed.status && parsed.status !== 'success') {
      record(false, label, JSON.stringify(parsed.error ?? parsed));
      return null;
    }
    return parsed.result ?? parsed;
  } catch (error) {
    record(false, label, error instanceof Error ? error.message : String(error));
    return null;
  }
}

function readFirebaseCliAccessToken() {
  const label = 'Firebase CLI can provide authenticated access for live Firebase REST drift checks';
  const result = spawnSync(
    firebaseCommand(),
    firebaseCommandArgs(['login:list', '--json']),
    {
      cwd: root,
      encoding: 'utf8',
    }
  );
  if (result.error) {
    record(false, label, result.error.message);
    return null;
  }
  if (result.status !== 0) {
    record(false, label, 'Run npx --no-install firebase login before checking deployed Firebase REST resources.');
    return null;
  }

  try {
    const parsed = JSON.parse(result.stdout);
    const accounts = Array.isArray(parsed.result) ? parsed.result : [];
    const token = accounts
      .map((account) => account?.tokens?.access_token)
      .find((value) => typeof value === 'string' && value.length > 0);
    if (!token) {
      record(false, label, 'No active Firebase CLI account token was available.');
      return null;
    }
    return token;
  } catch (error) {
    record(false, label, error instanceof Error ? error.message : String(error));
    return null;
  }
}

async function readFirebaseRulesJson(path, accessToken, label) {
  if (typeof fetch !== 'function') {
    record(false, label, 'This Node.js runtime does not provide fetch.');
    return null;
  }

  try {
    const response = await fetch(`https://firebaserules.googleapis.com/v1${path}`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });
    if (!response.ok) {
      record(false, label, `HTTP ${response.status}`);
      return null;
    }
    record(true, label);
    return await response.json();
  } catch (error) {
    record(false, label, error instanceof Error ? error.message : String(error));
    return null;
  }
}

async function readCloudSchedulerJson(path, accessToken, label) {
  if (typeof fetch !== 'function') {
    record(false, label, 'This Node.js runtime does not provide fetch.');
    return null;
  }

  try {
    const response = await fetch(`https://cloudscheduler.googleapis.com/v1/${path}`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });
    if (!response.ok) {
      record(false, label, `HTTP ${response.status}`);
      return null;
    }
    record(true, label);
    return await response.json();
  } catch (error) {
    record(false, label, error instanceof Error ? error.message : String(error));
    return null;
  }
}

async function readPublicTextResponse(url, label) {
  if (typeof fetch !== 'function') {
    record(false, label, 'This Node.js runtime does not provide fetch.');
    return null;
  }

  const abortController = new AbortController();
  const timeout = setTimeout(() => abortController.abort(), 15_000);
  try {
    const response = await fetch(url, {
      headers: {
        'Cache-Control': 'no-cache',
      },
      signal: abortController.signal,
    });
    if (!response.ok) {
      record(false, label, `HTTP ${response.status}`);
      return null;
    }
    const text = await response.text();
    record(true, label);
    return { text, headers: response.headers };
  } catch (error) {
    record(false, label, error instanceof Error ? error.message : String(error));
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function deployedHostingSecurityHeadersReady(headers) {
  const csp = headers.get('content-security-policy') ?? '';
  const frameOptions = headers.get('x-frame-options') ?? '';
  const contentTypeOptions = headers.get('x-content-type-options') ?? '';
  const referrerPolicy = headers.get('referrer-policy') ?? '';
  const hsts = headers.get('strict-transport-security') ?? '';

  return frameOptions.toUpperCase() === 'DENY'
    && contentTypeOptions.toLowerCase() === 'nosniff'
    && referrerPolicy === 'strict-origin-when-cross-origin'
    && hsts.includes('max-age=')
    && csp.includes('https://*.cloudfunctions.net')
    && csp.includes("frame-ancestors 'none'")
    && csp.includes("object-src 'none'")
    && csp.includes("base-uri 'self'");
}

function jsonEquivalent(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function appleUniversalLinksReady(appleAppSiteAssociation) {
  const details = Array.isArray(appleAppSiteAssociation?.applinks?.details)
    ? appleAppSiteAssociation.applinks.details
    : [];

  return details.some((detail) => {
    const appId = typeof detail?.appID === 'string' ? detail.appID.trim() : '';
    const paths = Array.isArray(detail?.paths) ? detail.paths : [];
    return /^[A-Z0-9]{10}\.com\.kandilo\.app$/.test(appId)
      && paths.includes('/')
      && paths.includes('/join/*');
  });
}

function androidAppLinksReady(assetLinks) {
  if (!Array.isArray(assetLinks)) {
    return false;
  }

  return assetLinks.some((entry) => {
    const relation = Array.isArray(entry?.relation) ? entry.relation : [];
    const target = entry?.target ?? {};
    const fingerprints = Array.isArray(target.sha256_cert_fingerprints)
      ? target.sha256_cert_fingerprints
      : [];
    return relation.includes('delegate_permission/common.handle_all_urls')
      && target.namespace === 'android_app'
      && target.package_name === expectedNativePackageId
      && fingerprints.some((fingerprint) => {
        if (typeof fingerprint !== 'string') {
          return false;
        }
        const normalizedFingerprint = fingerprint.trim().toUpperCase();
        return normalizedFingerprint !== androidDebugSha256Fingerprint
          && /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/.test(normalizedFingerprint);
      });
  });
}

function nativeLinkFilesAvoidUnsafePlaceholders(appleAppSiteAssociation, assetLinks) {
  const serialized = JSON.stringify({
    appleAppSiteAssociation,
    assetLinks,
  });
  return !serialized.includes('TODO_TEAM_ID')
    && !serialized.includes(androidDebugSha256Fingerprint);
}

async function publicResourceAvailable(url) {
  const abortController = new AbortController();
  const timeout = setTimeout(() => abortController.abort(), 15_000);
  try {
    let response = await fetch(url, {
      headers: {
        'Cache-Control': 'no-cache',
      },
      method: 'HEAD',
      signal: abortController.signal,
    });
    if (response.status === 405 || response.status === 501) {
      response = await fetch(url, {
        headers: {
          'Cache-Control': 'no-cache',
        },
        signal: abortController.signal,
      });
    }
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

async function readLiveRulesSource(releaseNamePrefix, activeReleaseLabel, rulesetLabel, sourceLabel) {
  const accessToken = readFirebaseCliAccessToken();
  if (!accessToken) {
    return null;
  }

  const releases = [];
  let pageToken = '';
  do {
    const query = pageToken
      ? `?pageSize=100&pageToken=${encodeURIComponent(pageToken)}`
      : '?pageSize=100';
    const releasesPage = await readFirebaseRulesJson(
      `/projects/${expectedProjectId}/releases${query}`,
      accessToken,
      'Firebase Rules API can read deployed rules releases'
    );
    if (!releasesPage) {
      return null;
    }
    if (Array.isArray(releasesPage.releases)) {
      releases.push(...releasesPage.releases);
    }
    pageToken = typeof releasesPage.nextPageToken === 'string' ? releasesPage.nextPageToken : '';
  } while (pageToken);

  const release = releases
    .sort((a, b) => String(b.createTime ?? '').localeCompare(String(a.createTime ?? '')))
    .find((release) => (
      typeof release.name === 'string'
      && release.name.startsWith(releaseNamePrefix)
    ));
  const rulesetName = typeof release?.rulesetName === 'string' ? release.rulesetName : '';
  if (!rulesetName) {
    record(false, activeReleaseLabel);
    return null;
  }
  record(true, activeReleaseLabel);

  const ruleset = await readFirebaseRulesJson(
    `/${rulesetName}`,
    accessToken,
    rulesetLabel
  );
  const files = Array.isArray(ruleset?.source?.files) ? ruleset.source.files : [];
  const source = files
    .map((file) => (typeof file?.content === 'string' ? file.content : ''))
    .filter(Boolean)
    .join('\n');
  if (!source) {
    record(false, sourceLabel);
    return null;
  }
  record(true, sourceLabel);
  return source;
}

async function readLiveFirestoreRulesSource() {
  return readLiveRulesSource(
    `projects/${expectedProjectId}/releases/cloud.firestore`,
    'Live Firebase deployment has an active Firestore rules release',
    'Firebase Rules API can read deployed Firestore ruleset',
    'Live Firestore ruleset contains rule source'
  );
}

async function readLiveStorageRulesSource() {
  return readLiveRulesSource(
    `projects/${expectedProjectId}/releases/firebase.storage/`,
    'Live Firebase deployment has an active Storage rules release',
    'Firebase Rules API can read deployed Storage ruleset',
    'Live Storage ruleset contains rule source'
  );
}

async function checkLiveHostingDeployment() {
  const localIndexPath = resolve(root, 'dist/index.html');
  const localIndex = readText('dist/index.html');
  if (!localIndex) {
    record(
      false,
      'Local production Hosting build exists for live drift comparison',
      'Run npm run build before npm run check:firebase-live.'
    );
    return;
  }
  record(true, 'Local production Hosting build exists for live drift comparison');
  const localBuildMtime = statSync(localIndexPath).mtimeMs;
  const latestBuildInputMtime = newestHostingBuildInputMtimeMs();
  const localBuildFresh = latestBuildInputMtime === 0 || localBuildMtime + 1000 >= latestBuildInputMtime;
  record(
    localBuildFresh,
    'Local production Hosting build is current with frontend source inputs',
    'Run npm run build before npm run check:firebase-live.'
  );
  if (!localBuildFresh) {
    return;
  }

  const localAssets = assetReferencesFromIndexHtml(localIndex);
  record(
    localAssets.length > 0,
    'Local production Hosting build lists hashed app assets',
    'Run npm run build before deploying Hosting.'
  );
  if (localAssets.length === 0) {
    return;
  }

  const liveIndexResponse = await readPublicTextResponse(
    `${expectedAppUrl}/?kandilo_live_drift_check=${Date.now()}`,
    `Firebase Hosting serves ${expectedAppUrl}`
  );
  if (!liveIndexResponse) {
    return;
  }
  const liveIndex = liveIndexResponse.text;
  record(
    deployedHostingSecurityHeadersReady(liveIndexResponse.headers),
    'Live Firebase Hosting serves required receipt portal security headers',
    'Deploy firebase.json Hosting headers before live receipt testing.'
  );

  const missingAssets = localAssets.filter((asset) => !liveIndex.includes(asset));
  record(
    missingAssets.length === 0,
    'Live Firebase Hosting serves current production build asset references',
    missingAssets.length > 0
      ? `missing from live index: ${missingAssets.slice(0, 5).join(', ')}`
      : ''
  );

  if (missingAssets.length === 0) {
    const unavailableAssets = [];
    for (const asset of localAssets) {
      if (!await publicResourceAvailable(new URL(asset, expectedAppUrl).toString())) {
        unavailableAssets.push(asset);
      }
    }
    record(
      unavailableAssets.length === 0,
      'Live Firebase Hosting serves current production build asset files',
      unavailableAssets.length > 0
        ? `unavailable: ${unavailableAssets.slice(0, 5).join(', ')}`
        : ''
    );
  }

  const liveAppleAppSiteAssociationResponse = await readPublicTextResponse(
    `${expectedAppUrl}/.well-known/apple-app-site-association?kandilo_live_drift_check=${Date.now()}`,
    'Live Firebase Hosting serves Apple universal links file'
  );
  const liveAppleAppSiteAssociation = liveAppleAppSiteAssociationResponse
    ? parseJsonText(liveAppleAppSiteAssociationResponse.text, 'Live Apple universal links file is valid JSON')
    : null;
  if (liveAppleAppSiteAssociation && appleAppSiteAssociation) {
    record(
      jsonEquivalent(liveAppleAppSiteAssociation, appleAppSiteAssociation),
      'Live Apple universal links file matches local production configuration',
      'Deploy Hosting after updating public/.well-known/apple-app-site-association.'
    );
  }

  const liveAndroidAssetLinksResponse = await readPublicTextResponse(
    `${expectedAppUrl}/.well-known/assetlinks.json?kandilo_live_drift_check=${Date.now()}`,
    'Live Firebase Hosting serves Android app links file'
  );
  const liveAndroidAssetLinks = liveAndroidAssetLinksResponse
    ? parseJsonText(liveAndroidAssetLinksResponse.text, 'Live Android app links file is valid JSON')
    : null;
  if (liveAndroidAssetLinks && androidAssetLinks) {
    record(
      jsonEquivalent(liveAndroidAssetLinks, androidAssetLinks),
      'Live Android app links file matches local production configuration',
      'Deploy Hosting after updating public/.well-known/assetlinks.json.'
    );
  }

  if (liveAppleAppSiteAssociation && liveAndroidAssetLinks) {
    record(
      appleUniversalLinksReady(liveAppleAppSiteAssociation) && androidAppLinksReady(liveAndroidAssetLinks),
      'Live native universal/app links are production-final for Stripe and invitation returns',
      'Run npm run configure:native-links -- --apple-team-id TEAMID1234 --android-sha256 AA:BB:...:99 with the final App Store team ID and Play Store release signing fingerprint, or use --apple-from-xcode-project with --android-from-release-keystore when Xcode signing and release signing config are local, then deploy Hosting.',
      nativeLinkSeverity
    );
  }
}

async function checkLiveFirebaseDeployment(requiredIndexes) {
  console.log('');
  console.log('Live Firebase, Cloud Scheduler, Storage rules, and Hosting deployment drift check');
  console.log('');

  const functionsResult = readFirebaseJson(['functions:list'], 'Firebase CLI can read deployed Functions');
  if (Array.isArray(functionsResult)) {
    const functionDeployment = evaluateLiveFunctionDeployment(
      functionsResult,
      { expectedRuntime: expectedFunctionsRuntime }
    );
    record(
      functionDeployment.ok,
      liveFunctionDeploymentReadyLabel,
      functionDeployment.detail
    );
  }

  const schedulerRequirements = requiredLiveSchedulerJobs(expectedProjectId);
  if (schedulerRequirements.length > 0) {
    const accessToken = readFirebaseCliAccessToken();
    if (accessToken) {
      const schedulerJobs = [];
      for (const { id, name } of schedulerRequirements) {
        const schedulerJob = await readCloudSchedulerJson(
          name,
          accessToken,
          `Cloud Scheduler can read deployed schedule job for ${id}`
        );
        if (schedulerJob) schedulerJobs.push(schedulerJob);
      }
      const schedulerDeployment = evaluateLiveSchedulerJobs(
        schedulerJobs,
        { projectId: expectedProjectId }
      );
      record(
        schedulerDeployment.ok,
        liveSchedulerJobReadyLabel,
        schedulerDeployment.detail
      );
    }
  }

  for (const secretName of backendSecretNames) {
    const secretMetadata = readFirebaseJson(
      ['functions:secrets:get', secretName],
      `Firebase CLI can read metadata for Secret Manager secret ${secretName}`
    );
    if (secretMetadata) {
      record(
        hasEnabledSecretVersion(secretMetadata, secretName),
        `Live Secret Manager has an enabled version for ${secretName}`,
        'Set the secret with npm run configure:receipt-secrets or npx --no-install firebase functions:secrets:set before deploying Functions that depend on it.'
      );
    }
  }

  const indexesResult = readFirebaseJson(['firestore:indexes'], 'Firebase CLI can read deployed Firestore indexes');
  const deployedIndexes = indexesResult?.indexes;
  if (Array.isArray(deployedIndexes)) {
    const missingIndexes = requiredIndexes
      .filter((requiredIndex) => !hasIndex(deployedIndexes, requiredIndex.collectionGroup, requiredIndex.fields))
      .map((requiredIndex) => requiredIndex.label);
    record(
      missingIndexes.length === 0,
      'Live Firestore deployment includes required giving and tax receipt indexes',
      missingIndexes.length > 0 ? `missing: ${missingIndexes.join(', ')}` : ''
    );
  }

  const liveFirestoreRulesSource = await readLiveFirestoreRulesSource();
  if (liveFirestoreRulesSource) {
    record(
      firestoreReceiptPrivacyRulesReady(liveFirestoreRulesSource),
      'Live Firestore rules include required Stripe and tax receipt privacy boundaries',
      'Deploy firestore.rules before enabling live donations and tax receipts.'
    );
  }

  const liveStorageRulesSource = await readLiveStorageRulesSource();
  const localStorageRulesSource = readText('storage.rules') ?? '';
  if (liveStorageRulesSource && localStorageRulesSource) {
    record(
      normalizeRulesSource(liveStorageRulesSource) === normalizeRulesSource(localStorageRulesSource),
      'Live Firebase Storage rules match local storage.rules',
      'Deploy storage.rules before production receipt release smoke testing.'
    );
  }

  await checkLiveHostingDeployment();
}

console.log('Kandilo Stripe and tax receipt production readiness check');
console.log('');

record(
  currentNodeMajor() === expectedNodeMajor,
  `Local Node.js runtime is ${expectedNodeMajor}.x`,
  `Current runtime is ${process.versions.node}. Run nvm use 22 before production readiness, build, and deploy checks.`
);

const firebaserc = readJson('.firebaserc');
record(
  firebaserc?.projects?.default === expectedProjectId,
  `.firebaserc default project is ${expectedProjectId}`,
  'Wrong project means live keys/webhooks could be deployed to the wrong Firebase project.'
);

const functionsEnv = readEnv('functions/.env.production');
record(functionsEnv !== null, 'functions/.env.production exists');
if (functionsEnv) {
  record(
    functionsEnv.APP_URL === expectedAppUrl,
    `functions APP_URL is ${expectedAppUrl}`,
    'Stripe Checkout success/cancel URLs and email links must point at the production host.'
  );
  record(
    !includesAnyEnv(functionsEnv, backendSecretNames),
    'Stripe and email secrets are not stored in functions/.env.production',
    `Use Firebase Secret Manager for ${backendSecretNames.join(', ')}.`
  );
}

const rootEnv = readEnv('.env.local');
if (rootEnv) {
  record(true, '.env.local exists for the production web build');
} else {
  record(
    ciStaticMode,
    '.env.local exists for the production web build',
    ciStaticMode
      ? 'Skipped in CI static readiness mode; run npm run check:stripe-production locally or in deploy mode before building production Hosting assets.'
      : '',
    ciStaticMode ? 'warn' : 'fail'
  );
}
if (rootEnv) {
  const requiredWebEnv = [
    'VITE_FIREBASE_API_KEY',
    'VITE_FIREBASE_AUTH_DOMAIN',
    'VITE_FIREBASE_PROJECT_ID',
    'VITE_FIREBASE_STORAGE_BUCKET',
    'VITE_FIREBASE_MESSAGING_SENDER_ID',
    'VITE_FIREBASE_APP_ID',
    'VITE_FIREBASE_APP_CHECK_SITE_KEY',
  ];
  for (const envName of requiredWebEnv) {
    record(
      !hasPlaceholder(rootEnv[envName]),
      `${envName} is set and not a placeholder`,
      'This value is required before building production hosting assets.'
    );
  }
  record(
    rootEnv.VITE_FIREBASE_PROJECT_ID === expectedProjectId,
    `VITE_FIREBASE_PROJECT_ID is ${expectedProjectId}`,
    'The web app must call the same Firebase project that owns the deployed Functions.'
  );
  record(
    rootEnv.VITE_FIREBASE_STORAGE_BUCKET === expectedFirebaseStorageBucket,
    `VITE_FIREBASE_STORAGE_BUCKET is ${expectedFirebaseStorageBucket}`,
    'The hosted app and retained receipt PDF smoke verifier must target the production Firebase Storage bucket.'
  );
  record(
    rootEnv.VITE_USE_FIREBASE_EMULATORS !== 'true',
    'Production web build does not target Firebase emulators',
    'Use npm run dev:emulators only for local browser verification.'
  );
  record(
    !includesAnyEnv(rootEnv, backendSecretNames),
    'Stripe and email secrets are not stored in .env.local',
    'Browser env files must never hold backend Stripe or email-provider secrets.'
  );
}

const firebaseJson = readJson('firebase.json');
if (firebaseJson) {
  const csp = firebaseJson.hosting?.headers
    ?.flatMap((entry) => entry.headers ?? [])
    ?.find((header) => header.key === 'Content-Security-Policy')?.value ?? '';
  record(csp.includes('https://*.cloudfunctions.net'), 'Hosting CSP allows Firebase callable/HTTP Functions');
  record(
    nativeLinkHostingHeadersReady(firebaseJson),
    'Hosting serves native link well-known files with unambiguous no-cache JSON headers',
    'Keep exactly one Firebase Hosting header rule for each native link well-known file before deploying Stripe return links.'
  );
  record(
    firebaseJson.firestore?.location === 'northamerica-northeast2',
    'Firestore default database location is northamerica-northeast2'
  );
}

const appleAppSiteAssociation = readJson('public/.well-known/apple-app-site-association');
const androidAssetLinks = readJson('public/.well-known/assetlinks.json');
record(
  appleUniversalLinksReady(appleAppSiteAssociation) && androidAppLinksReady(androidAssetLinks),
  'Native universal/app links are production-final for Stripe and invitation returns',
  'Run npm run configure:native-links -- --apple-team-id TEAMID1234 --android-sha256 AA:BB:...:99 with the final App Store team ID and Play Store release signing fingerprint before relying on native HTTPS returns, or use --apple-from-xcode-project with --android-from-release-keystore when Xcode signing and release signing config are local.',
  nativeLinkSeverity
);
record(
  nativeLinkFilesAvoidUnsafePlaceholders(appleAppSiteAssociation, androidAssetLinks),
  'Checked-in native link files do not trust placeholder Apple or debug Android identifiers',
  'Keep public/.well-known files inert until configure:native-links rewrites them with final App Store Team ID and Play Store release signing fingerprints.'
);

const indexesJson = readJson('firestore.indexes.json');
let requiredFirestoreIndexes = [];
if (indexesJson) {
  const indexes = indexesJson.indexes ?? [];
  requiredFirestoreIndexes = [
    {
      label: 'church giving history',
      collectionGroup: 'giving',
      fields: [
        { fieldPath: 'churchId', order: 'ASCENDING' },
        { fieldPath: 'anonymous', order: 'ASCENDING' },
        { fieldPath: 'churchReceiptVisible', order: 'ASCENDING' },
        { fieldPath: 'donorEmail', order: 'ASCENDING' },
        { fieldPath: 'donorNamePublicSafe', order: 'ASCENDING' },
        { fieldPath: 'receiptManagerGivingSafeVersion', order: 'ASCENDING' },
        { fieldPath: 'status', order: 'ASCENDING' },
        { fieldPath: 'createdAt', order: 'DESCENDING' },
      ],
    },
    {
      label: 'donor giving history',
      collectionGroup: 'giving',
      fields: [
        { fieldPath: 'userId', order: 'ASCENDING' },
        { fieldPath: 'createdAt', order: 'DESCENDING' },
      ],
    },
    {
      label: 'donor annual receipt query',
      collectionGroup: 'giving',
      fields: [
        { fieldPath: 'churchId', order: 'ASCENDING' },
        { fieldPath: 'userId', order: 'ASCENDING' },
        { fieldPath: 'status', order: 'ASCENDING' },
        { fieldPath: 'completedAt', order: 'ASCENDING' },
      ],
    },
    {
      label: 'church annual batch receipt query',
      collectionGroup: 'giving',
      fields: [
        { fieldPath: 'churchId', order: 'ASCENDING' },
        { fieldPath: 'status', order: 'ASCENDING' },
        { fieldPath: 'completedAt', order: 'ASCENDING' },
      ],
    },
    {
      label: 'donor tax receipt list',
      collectionGroup: 'taxReceipts',
      fields: [
        { fieldPath: 'userId', order: 'ASCENDING' },
        { fieldPath: 'issuedAt', order: 'DESCENDING' },
      ],
    },
    {
      label: 'church annual receipt summary list',
      collectionGroup: 'taxReceiptSummaries',
      fields: [
        { fieldPath: 'churchId', order: 'ASCENDING' },
        { fieldPath: 'kind', order: 'ASCENDING' },
        { fieldPath: 'donorAnonymous', order: 'ASCENDING' },
        { fieldPath: 'churchReceiptVisible', order: 'ASCENDING' },
        { fieldPath: 'donorLabelPublicSafe', order: 'ASCENDING' },
        { fieldPath: 'receiptManagerSummarySafe', order: 'ASCENDING' },
        { fieldPath: 'receiptManagerSummarySafeVersion', order: 'ASCENDING' },
        { fieldPath: 'issuedAt', order: 'DESCENDING' },
      ],
    },
    {
      label: 'donor annual receipt summary list',
      collectionGroup: 'taxReceiptSummaries',
      fields: [
        { fieldPath: 'userId', order: 'ASCENDING' },
        { fieldPath: 'issuedAt', order: 'DESCENDING' },
      ],
    },
    {
      label: 'receipt email smoke audit query',
      collectionGroup: 'taxReceiptEvents',
      fields: [
        { fieldPath: 'action', order: 'ASCENDING' },
        { fieldPath: 'createdAt', order: 'DESCENDING' },
      ],
    },
    {
      label: 'annual receipt email smoke audit query',
      collectionGroup: 'taxReceiptEvents',
      fields: [
        { fieldPath: 'action', order: 'ASCENDING' },
        { fieldPath: 'kind', order: 'ASCENDING' },
        { fieldPath: 'createdAt', order: 'DESCENDING' },
      ],
    },
    {
      label: 'receipt-specific email smoke audit query',
      collectionGroup: 'taxReceiptEvents',
      fields: [
        { fieldPath: 'receiptId', order: 'ASCENDING' },
        { fieldPath: 'action', order: 'ASCENDING' },
        { fieldPath: 'createdAt', order: 'DESCENDING' },
      ],
    },
    {
      label: 'live receipt email smoke correlation query',
      collectionGroup: 'taxReceiptEvents',
      fields: [
        { fieldPath: 'action', order: 'ASCENDING' },
        { fieldPath: 'givingId', order: 'ASCENDING' },
        { fieldPath: 'createdAt', order: 'DESCENDING' },
      ],
    },
    {
      label: 'processed checkout webhook smoke query',
      collectionGroup: 'stripeWebhookEvents',
      fields: [
        { fieldPath: 'type', order: 'ASCENDING' },
        { fieldPath: 'status', order: 'ASCENDING' },
        { fieldPath: 'processedAt', order: 'DESCENDING' },
      ],
    },
    {
      label: 'live checkout receipt smoke correlation query',
      collectionGroup: 'stripeWebhookEvents',
      fields: [
        { fieldPath: 'type', order: 'ASCENDING' },
        { fieldPath: 'status', order: 'ASCENDING' },
        { fieldPath: 'livemode', order: 'ASCENDING' },
        { fieldPath: 'processedAt', order: 'DESCENDING' },
      ],
    },
    {
      label: 'live webhook issue smoke query',
      collectionGroup: 'stripeWebhookEvents',
      fields: [
        { fieldPath: 'status', order: 'ASCENDING' },
        { fieldPath: 'livemode', order: 'ASCENDING' },
        { fieldPath: 'processedAt', order: 'DESCENDING' },
      ],
    },
    {
      label: 'latest live webhook activity query',
      collectionGroup: 'stripeWebhookEvents',
      fields: [
        { fieldPath: 'livemode', order: 'ASCENDING' },
        { fieldPath: 'processedAt', order: 'DESCENDING' },
      ],
    },
  ];

  for (const requiredIndex of requiredFirestoreIndexes) {
    record(
      hasIndex(indexes, requiredIndex.collectionGroup, requiredIndex.fields),
      `Firestore index exists for ${requiredIndex.label}`
    );
  }
}

const indexSource = readText('functions/src/index.ts') ?? '';
record(
  includesEvery(indexSource, [
    'createStripeCheckoutSession',
    'createStripePaymentIntent',
    'stripeWebhook',
    'sendTaxReceipt',
    'sendCorrectedTaxReceipt',
    'sendAnnualTaxReceipt',
    'sendCorrectedAnnualTaxReceipt',
    'downloadTaxReceiptPdf',
    'sendChurchAnnualTaxReceipts',
    'sendChurchCorrectedAnnualTaxReceipts',
    'prepareYearEndAnnualTaxReceipts',
    'onGivingCreated',
    'getPaymentOperationsReadiness',
    'getTaxReceiptAuditEvents',
    'getChurchPaymentSettings',
    'updateChurchPaymentSettingsAsSuperAdmin',
    'createChurchStripeConnectAccountAsSuperAdmin',
    'createChurchStripeConnectOnboardingLink',
    'getChurchStripeConnectSetupStatus',
  ]),
  'Stripe and tax receipt Functions are exported, including legacy-safe shims, private payment settings, and SuperAdmin runtime readiness'
);

const functionsPackage = readJson('functions/package.json');
const functionsPackageLock = readJson('functions/package-lock.json');
if (functionsPackage) {
  record(
    packageDependencyIsExactlyLocked(functionsPackage, functionsPackageLock, 'pdf-lib'),
    'Functions dependency includes pdf-lib for tax receipt PDF attachments'
  );
  record(
    packageDependencyIsExactlyLocked(functionsPackage, functionsPackageLock, '@pdf-lib/fontkit')
    && packageDependencyIsExactlyLocked(functionsPackage, functionsPackageLock, '@fontsource/noto-sans'),
    'Functions dependencies include fontkit and packaged Noto Sans fonts for multilingual tax receipt PDFs'
  );
  record(
    packageDependencyIsExactlyLocked(functionsPackage, functionsPackageLock, 'resend'),
    'Functions dependency includes Resend for tax receipt email delivery'
  );
  record(
    packageDependencyIsExactlyLocked(functionsPackage, functionsPackageLock, 'stripe'),
    'Functions Stripe SDK is pinned in package.json and package-lock',
    'Use an exact stripe dependency in functions so webhook and Checkout behavior stays tied to the tested SDK.'
  );
}

const clientsSource = readText('functions/src/shared/clients.ts') ?? '';
const firebaseEmulatorSource = readText('src/lib/firebase/emulators.ts') ?? '';
const membershipDbSource = readText('src/lib/db/memberships.ts') ?? '';
const membershipDbTestSource = readText('src/lib/db/memberships.test.ts') ?? '';
const useChurchesSource = readText('src/hooks/useChurches.ts') ?? '';
const indexHtmlSource = readText('index.html') ?? '';
const webFirebaseSources = [
  readText('src/lib/firebase/auth.ts') ?? '',
  readText('src/lib/firebase/firestore.ts') ?? '',
  readText('src/lib/firebase/functions.ts') ?? '',
  readText('src/lib/firebase/storage.ts') ?? '',
  readText('src/lib/firebase/app-check.ts') ?? '',
].join('\n');
const installedStripeApiVersion = readInstalledStripeApiVersion();
record(
  clientsSource.includes(`export const STRIPE_API_VERSION = '${expectedStripeApiVersion}'`)
    && clientsSource.includes('apiVersion: STRIPE_API_VERSION')
    && includesEvery(clientsSource, [
      'export function stripeSecretKeyMode(secretKey: string): StripeSecretKeyMode',
      "normalized.startsWith('sk_live_') || normalized.startsWith('rk_live_')",
      "normalized.startsWith('sk_test_') || normalized.startsWith('rk_test_')",
      'STRIPE_SECRET_KEY has invalid format.',
      'export function stripeWebhookSecretLooksValid(secret: string): boolean',
      "secret.trim().startsWith('whsec_')",
    ]),
  `Stripe client pins current API version ${expectedStripeApiVersion}`,
  'Match this to the live webhook endpoint API version in Stripe Dashboard so Checkout and webhook payload shapes stay aligned, and keep runtime Stripe credential format guards in sync with Mission Control readiness.'
);
record(
  installedStripeApiVersion === expectedStripeApiVersion,
  'Functions Stripe client API version matches installed stripe-node default',
  installedStripeApiVersion
    ? `Installed stripe-node reports ${installedStripeApiVersion}. Update STRIPE_API_VERSION/docs/tests with the SDK upgrade.`
    : 'Install functions dependencies before running the production readiness check.'
);
const productionChecklistSource = readText('FIREBASE_PRODUCTION_CHECKLIST.md') ?? '';
const readmeSource = readText('README.md') ?? '';
const projectDetailsSource = readText('project-details-start-here.md') ?? '';
const emailStandardSource = readText('docs/EMAILS.md') ?? '';
const qaWebFirebaseSource = readText('docs/QA_WEB_FIREBASE.md') ?? '';
const envExampleSource = readText('.env.example') ?? '';
const ciWorkflowSource = readText('.github/workflows/ci.yml') ?? '';
const rootPackage = readJson('package.json');
const rootPackageLock = readJson('package-lock.json');
const deployHelperSource = readText('scripts/deploy-stripe-tax-receipts.mjs') ?? '';
const deployHelperTestSource = readText('src/lib/deploy-tax-receipts-script.test.ts') ?? '';
const readinessScriptSource = readText('scripts/check-stripe-production-readiness.mjs') ?? '';
const readinessLiveFunctionsSource = readText('scripts/readiness-live-functions.mjs') ?? '';
const nativeLinkConfiguratorSource = readText('scripts/configure-native-links.mjs') ?? '';
const nativeLinkConfiguratorTestSource = readText('src/lib/native-links-config-script.test.ts') ?? '';
const functionsIndexSource = readText('functions/src/index.ts') ?? '';
const functionsRegionsSource = readText('functions/src/shared/regions.ts') ?? '';
const authProfileBootstrapSource = readText('functions/src/onUserCreated.ts') ?? '';
const authProfileBootstrapTestSource = readText('tests/functions/onUserCreated.test.ts') ?? '';
const givingFunctionsSource = readGivingModuleSource();
const superAdminFunctionsSource = readText('functions/src/modules/superAdmin.ts') ?? '';
const liveResendCheckSource = readText('scripts/check-resend-live.mjs') ?? '';
const liveResendCheckTestSource = readText('src/lib/resend-live-script.test.ts') ?? '';
const liveAccountCheckSource = readText('scripts/check-stripe-live-account.mjs') ?? '';
const liveAccountCheckTestSource = readText('src/lib/stripe-live-account-script.test.ts') ?? '';
const liveWebhookCheckSource = readText('scripts/check-stripe-live-webhook.mjs') ?? '';
const liveWebhookCheckTestSource = readText('src/lib/stripe-live-webhook-script.test.ts') ?? '';
const liveWebhookConfigureSource = readText('scripts/configure-stripe-live-webhook.mjs') ?? '';
const liveWebhookConfigureTestSource = readText('src/lib/stripe-live-webhook-config-script.test.ts') ?? '';
const receiptSecretsConfigureSource = readText('scripts/configure-firebase-receipt-secrets.mjs') ?? '';
const receiptSecretsConfigureTestSource = readText('src/lib/firebase-receipt-secrets-config-script.test.ts') ?? '';
const liveDonationSmokeSource = readText('scripts/check-live-donation-smoke.mjs') ?? '';
const liveDonationSmokeTestSource = readText('src/lib/live-donation-smoke-script.test.ts') ?? '';
const liveAnnualReceiptSmokeSource = readText('scripts/check-live-annual-receipt-smoke.mjs') ?? '';
const liveAnnualReceiptSmokeTestSource = readText('src/lib/live-annual-receipt-smoke-script.test.ts') ?? '';
const visibilityAuditSource = readText('scripts/audit-tax-receipt-visibility.mjs') ?? '';
const visibilityAuditTestSource = readText('src/lib/tax-receipt-visibility-audit-script.test.ts') ?? '';
const taxReceiptGivingPrivacySourceTestSource =
  readText('src/lib/tax-receipt-giving-privacy-source.test.ts') ?? '';
const taxReceiptSummaryPrivacySourceTestSource =
  readText('src/lib/tax-receipt-summary-privacy-source.test.ts') ?? '';
const receiptEmulatorSeedSource = readText('scripts/seed-receipt-emulator.mjs') ?? '';
const receiptEmulatorSeedTestSource = readText('src/lib/seed-receipt-emulator-script.test.ts') ?? '';
const firebaseMessagingServiceWorkerSource = readText('public/firebase-messaging-sw.js') ?? '';
const saintMaintenanceSources = [
  readText('scripts/seed-saints.ts') ?? '',
  readText('scripts/migrate-saints-index.ts') ?? '',
  readText('scripts/migrate-saints-index-months.ts') ?? '',
].join('\n');
const adminCredentialHelperSourceList = [
  readText('scripts/bootstrap-admin.js') ?? '',
  readText('scripts/make-priest.js') ?? '',
  readText('scripts/set-super-admin.mjs') ?? '',
];
const liveFirebaseMutationHelperSourceList = [
  ...adminCredentialHelperSourceList,
  readText('scripts/seed-church-profiles.mjs') ?? '',
];
const liveFirebaseMutationHelperSources = liveFirebaseMutationHelperSourceList.join('\n');
record(
  envExampleSource.includes(`VITE_FIREBASE_STORAGE_BUCKET="${expectedFirebaseStorageBucket}"`)
    && projectDetailsSource.includes(`VITE_FIREBASE_STORAGE_BUCKET=${expectedFirebaseStorageBucket}`)
    && productionChecklistSource.includes(`VITE_FIREBASE_STORAGE_BUCKET=${expectedFirebaseStorageBucket}`)
    && liveDonationSmokeSource.includes('expectedFirebaseStorageBucket')
    && liveDonationSmokeSource.includes('retainedPdfStorageObjectMetadataUrl')
    && liveAnnualReceiptSmokeSource.includes('expectedFirebaseStorageBucket'),
  `.env example, setup docs, and live receipt smoke verifier agree on ${expectedFirebaseStorageBucket}`,
  'Use the production Firebase Storage bucket consistently so retained official receipt PDFs can be verified after the first live donation.'
);
record(
  productionChecklistSource.includes(stripeWebhookUrl)
  && productionChecklistSource.includes(`using Stripe API version \`${expectedStripeApiVersion}\``)
  && projectDetailsSource.includes(`Stripe API version \`${expectedStripeApiVersion}\``)
  && projectDetailsSource.includes(`live webhook endpoint API version must match \`${expectedStripeApiVersion}\``),
  'Production docs require the live webhook endpoint API version to match the Stripe client pin'
);
record(
  rootPackage?.scripts?.['configure:native-links'] === 'node scripts/configure-native-links.mjs'
  && includesEvery(nativeLinkConfiguratorSource, [
    'export function normalizeAppleTeamId',
    'export function appleTeamIdFromXcodeProject',
    'export function normalizeAndroidSha256Fingerprint',
    'export function androidSha256FingerprintFromReleaseKeystore',
    'export function nativeLinkStatus',
    '--status',
    '--apple-from-xcode-project',
    '--xcode-project',
    '--android-from-release-keystore',
    'DEVELOPMENT_TEAM',
    '-storepass:env',
    'keytool',
    'androidDebugSha256Fingerprint',
    'public/.well-known/apple-app-site-association',
    'public/.well-known/assetlinks.json',
    'Run npm run check:stripe-production -- --strict-native-links after updating these files.',
    'Kandilo native HTTPS return link status',
  ])
  && includesEvery(nativeLinkConfiguratorTestSource, [
    'prints a read-only native link status without requiring final identifiers',
    '--status is read-only',
    'rejects placeholders, missing release fingerprints',
    'derives the Apple Team ID from the Xcode project signing settings',
    'fails closed when Xcode signing has no unique Team ID',
    'derives the Android release SHA-256',
    'secret-store-pass',
    'debug keystore',
    'At least one Android release SHA-256 fingerprint is required',
    'validates without writing files in dry-run mode',
  ])
  && productionChecklistSource.includes('npm run configure:native-links -- --apple-team-id')
  && productionChecklistSource.includes('npm run configure:native-links -- --status')
  && productionChecklistSource.includes('--apple-from-xcode-project')
  && productionChecklistSource.includes('--android-from-release-keystore')
  && readmeSource.includes('npm run configure:native-links -- --status')
  && readmeSource.includes('--apple-from-xcode-project')
  && projectDetailsSource.includes('configure:native-links')
  && projectDetailsSource.includes('npm run configure:native-links -- --status')
  && projectDetailsSource.includes('--apple-from-xcode-project')
  && projectDetailsSource.includes('--android-from-release-keystore'),
  'Native universal/app-link final identifier configuration is guarded',
  'Use the guarded helper to update hosted well-known files with production Apple Team ID and Android release signing fingerprints, optionally deriving the Apple Team ID from Xcode and Android SHA-256 from the release keystore.'
);
record(
  rootPackage?.scripts?.['check:stripe-account-live'] === 'node scripts/check-stripe-live-account.mjs'
  && includesEvery(liveAccountCheckSource, [
    "const stripeAccountUrl = 'https://api.stripe.com/v1/account';",
    "import { expectedStripeApiVersion, stripeKeyMode } from './check-stripe-live-webhook.mjs';",
    "if (keyMode !== 'live')",
    'validateNoLiveCheckArgs',
    'Unknown argument',
    'Stripe account can create charges',
    'Stripe account can receive payouts',
    'Stripe account business details are submitted',
    'Stripe account has no currently due requirements',
    'Stripe account has no past-due requirements',
    'Stripe account is not disabled',
    'Stripe account has no eventually due requirements',
    'Stripe account has no future requirements queued',
    'future_requirements',
    'currentlyDueCount',
    'pastDueCount',
    'eventuallyDueCount',
    'futureCurrentlyDueCount',
    'futurePastDueCount',
    'futureEventuallyDueCount',
    'disabledReason',
    'return [`HTTP ${status}`, type, code]',
    'unreadable Stripe error response',
    'Authorization: `Bearer ${secretKey}`',
    "'Stripe-Version': expectedStripeApiVersion",
    'Stripe API version: ${expectedStripeApiVersion}',
    'without printing Stripe account IDs, business names, bank details, tax identifiers, or requirement field names',
  ])
  && includesEvery(liveAccountCheckTestSource, [
    'evaluateStripeAccountReadiness',
    'fetchStripeAccount',
    'charges_enabled: false',
    'business_profile.url',
    "not.toContain('business_profile.url')",
    "not.toContain('external_account')",
    'eventually due requirements',
    'future requirements without printing field names',
    'company.tax_id',
    "not.toContain('company.tax_id')",
    'rejects unknown CLI arguments before reading the live Stripe account',
    'stripeAccountUrl',
    'expectedStripeApiVersion',
    "'Stripe-Version': expectedStripeApiVersion",
    'surfaces Stripe API errors without printing private Stripe response details',
    "not.toContain('acct_123')",
    "not.toContain('Legal Parish Corp')",
  ])
  && productionChecklistSource.includes('npm run check:stripe-account-live')
  && productionChecklistSource.includes('same pinned Stripe API version used by Functions')
  && projectDetailsSource.includes('npm run check:stripe-account-live')
  && projectDetailsSource.includes('same pinned Stripe API version as the Functions client')
  && deployHelperSource.includes('npm run check:stripe-account-live'),
  'Live Stripe account activation verifier is available, documented, and tested without storing backend secrets or printing private Stripe account details'
);
record(
  rootPackage?.scripts?.['check:resend-live'] === 'node scripts/check-resend-live.mjs'
  && includesEvery(liveResendCheckSource, [
    "const resendDomainsUrl = 'https://api.resend.com/domains';",
    "const expectedResendDomain = 'kandilo.org';",
    "const verifiedStatus = 'verified';",
    'resendApiKeyLooksValid',
    "apiKey.trim().startsWith('re_')",
    'validateNoLiveCheckArgs',
    'Unknown argument',
    'Resend has the ${normalizedExpectedDomain} sending domain',
    'Resend sending domain ${normalizedExpectedDomain} is verified',
    'Resend has one ${normalizedExpectedDomain} domain entry',
    'Authorization: `Bearer ${apiKey}`',
    'parsed?.data?.data',
    'knownResendErrorNames',
    'safeResendErrorName',
    'return [`HTTP ${status}`, name]',
    'unreadable Resend error response',
    'exactly one verified sending domain without printing API key values or domain record details',
  ])
  && includesEvery(liveResendCheckTestSource, [
    'evaluateResendDomains',
    'fetchResendDomains',
    'resendApiKeyLooksValid',
    'status: \'pending\'',
    'not.toContain(\'domain_live_kandilo\')',
    'rejects duplicate domain entries',
    'expect(failingLabels(checks)).toContain(`Resend has one ${expectedResendDomain} domain entry`)',
    'rejects unknown CLI arguments before reading live Resend domains',
    'resendDomainsUrl',
    'surfaces Resend API errors without printing private response details',
    "not.toContain('resend_verification_token_123')",
    "not.toContain('Legal Parish Corp')",
    'hides unreadable Resend API error bodies',
  ])
  && productionChecklistSource.includes('npm run check:resend-live')
  && productionChecklistSource.includes('fails unless exactly one `kandilo.org` sending domain exists and is verified')
  && projectDetailsSource.includes('npm run check:resend-live')
  && projectDetailsSource.includes('fails unless exactly one `kandilo.org` sending domain exists and is verified')
  && deployHelperSource.includes('npm run check:resend-live'),
  'Live Resend sending-domain verifier is available, documented, and tested without storing backend secrets or printing private domain record details'
);
record(
  rootPackage?.scripts?.['check:stripe-webhook-live'] === 'node scripts/check-stripe-live-webhook.mjs'
  && includesEvery(liveWebhookCheckSource, [
    "const expectedProjectId = 'kandilo-2f7a9';",
    "const expectedStripeApiVersion = '2026-04-22.dahlia';",
    "const stripeWebhookEndpointListUrl = 'https://api.stripe.com/v1/webhook_endpoints';",
    "'checkout.session.completed'",
    "'checkout.session.expired'",
    "'checkout.session.async_payment_failed'",
    "'charge.refunded'",
    "endpoint?.livemode === true",
    "endpoint?.status === 'enabled'",
    'endpoint.api_version === expectedApiVersion',
    'validateNoLiveCheckArgs',
    'Unknown argument',
    'Live Stripe webhook endpoint uses explicit events instead of wildcard delivery',
    'Live Stripe webhook endpoint has no unrelated event subscriptions',
    'return [`HTTP ${status}`, type, code]',
    'unreadable Stripe error response',
    'Authorization: `Bearer ${secretKey}`',
    "'Stripe-Version': expectedStripeApiVersion",
    "if (keyMode !== 'live')",
    'Stripe only returns the webhook signing secret at endpoint creation time',
  ])
  && includesEvery(liveWebhookCheckTestSource, [
    'evaluateStripeWebhookEndpoints',
    'fetchStripeWebhookEndpoints',
    'stripeKeyMode',
    'duplicate enabled live endpoints',
    'wildcard events',
    'unrelated event subscriptions',
    'rejects unknown CLI arguments before reading live Stripe endpoints',
    'starting_after=we_page_1',
    "'Stripe-Version': expectedStripeApiVersion",
    'surfaces Stripe list errors without printing private Stripe response details',
    "not.toContain('we_123')",
    "not.toContain('acct_123')",
    "not.toContain('Legal Parish Corp')",
  ])
  && productionChecklistSource.includes('npm run check:stripe-webhook-live')
  && productionChecklistSource.includes('lists webhook endpoints through the Stripe API using the same pinned `Stripe-Version` request header')
  && projectDetailsSource.includes('npm run check:stripe-webhook-live')
  && projectDetailsSource.includes('using the same pinned `Stripe-Version` request header')
  && deployHelperSource.includes('npm run check:stripe-webhook-live'),
  'Live Stripe webhook endpoint verifier is available, documented, and tested without storing backend secrets locally'
);
record(
  rootPackage?.scripts?.['configure:stripe-webhook'] === 'node scripts/configure-stripe-live-webhook.mjs'
  && includesEvery(liveWebhookConfigureSource, [
    'stripeWebhookCreateParams',
    'stripeWebhookCreatePlan',
    'createStripeWebhookEndpoint',
    'validateArgs',
    'Unknown argument',
    '--confirm-project',
    '--print-secret-once',
    'Refusing to create a duplicate endpoint',
    'A matching live Stripe webhook endpoint is already configured and ready',
    'return [`HTTP ${status}`, type, code]',
    'unreadable Stripe error response',
    'Stripe-Version: ${expectedStripeApiVersion}',
    "'Stripe-Version': expectedStripeApiVersion",
    'enabled_events[]',
    'metadata[kandilo_surface]',
    'Store this one-time signing secret in Firebase Secret Manager as STRIPE_WEBHOOK_SECRET',
  ])
  && includesEvery(liveWebhookConfigureTestSource, [
    'prints a no-network setup plan',
    'creates the endpoint with a form-encoded Stripe API request',
    'Stripe-Version: 2026-04-22.dahlia',
    "'Stripe-Version': '2026-04-22.dahlia'",
    'refuses live creation unless the project and one-time secret output are explicitly acknowledged',
    'rejects unknown or malformed arguments before running network calls',
    'surfaces Stripe create errors without printing private Stripe response details',
    "not.toContain('we_123')",
    "not.toContain('acct_123')",
    "not.toContain('Legal Parish Corp')",
    'does not create duplicates',
    'refuses to create a duplicate',
  ])
  && productionChecklistSource.includes('npm run configure:stripe-webhook')
  && productionChecklistSource.includes('also pins the endpoint `api_version`')
  && projectDetailsSource.includes('configure:stripe-webhook')
  && projectDetailsSource.includes('helper sending the same pinned `Stripe-Version` request header and endpoint `api_version`')
  && deployHelperSource.includes('npm run configure:stripe-webhook'),
  'Live Stripe webhook setup helper is guarded, exact, and duplicate-safe',
  'Keep live webhook creation explicit because Stripe returns the whsec_... signing secret only once.'
);
record(
  rootPackage?.scripts?.['configure:receipt-secrets'] === 'node scripts/configure-firebase-receipt-secrets.mjs'
  && includesEvery(receiptSecretsConfigureSource, [
    "export const receiptSecretNames = ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'RESEND_API_KEY'];",
    'firebaseSecretSetArgs',
    'functions:secrets:set',
    'validateArgs',
    'Unknown argument',
    '--no-install',
    '--confirm-project',
    'assertExpectedFirebaseProject',
    'Enter the value only into the Firebase CLI prompt',
    'Deploy Functions, then run npm run check:firebase-live',
  ])
  && includesEvery(receiptSecretsConfigureTestSource, [
    'prints a no-network plan for the exact receipt production secrets',
    'builds pinned Firebase CLI arguments',
    'rejects unknown secret names',
    'rejects unknown or malformed arguments before invoking Firebase CLI',
    'requires explicit project confirmation and matching .firebaserc',
    'runs the pinned Firebase CLI once per selected receipt secret',
  ])
  && productionChecklistSource.includes('npm run configure:receipt-secrets')
  && projectDetailsSource.includes('configure:receipt-secrets')
  && deployHelperSource.includes('npm run configure:receipt-secrets'),
  'Receipt Firebase Secret Manager setup helper is project-confirmed and limited to receipt-path secrets',
  'Use the guarded helper instead of hand-typing project-sensitive Firebase secret commands.'
);
record(
  rootPackage?.scripts?.['check:live-donation-smoke'] === 'node scripts/check-live-donation-smoke.mjs'
  && includesEvery(liveDonationSmokeSource, [
    'readFirebaseCliAccessTokenForAudit',
    '--require-sent-receipt',
    '--max-age-hours <n>',
    'defaultMaxAgeHours = 72',
    '!/^\\d+$/.test(value)',
    'function timestampEvidenceString',
    '__firestoreTimestampValue',
    '--project <id>            Firebase project to read; must be ${expectedProjectId}.',
    'throw new Error(`--project must be ${expectedProjectId}.`);',
    'recentWebhookEventsQuery',
    'liveCompletedCheckoutEventsQuery',
    'readLiveCompletedCheckoutEventsWithFirestoreRest',
    "value: { stringValue: 'checkout.session.completed' }",
    "value: { stringValue: 'processed' }",
    'value: { booleanValue: true }',
    'taxReceiptEventsForReceiptQuery',
    'readTaxReceiptEventsForReceiptWithFirestoreRest',
    "field: { fieldPath: 'receiptId' }",
    "field: { fieldPath: 'action' }",
    "field: { fieldPath: 'createdAt' }",
    "direction: 'DESCENDING'",
    'checkout.session.completed',
    'livemode === true',
    'Live Checkout smoke was processed within the ${maxAgeHours}-hour freshness window',
    'Smoke donation reached a tax receipt-ready state',
    'Smoke donation official tax receipt was emailed',
    'Smoke donation has no tax receipt setup error',
    'Smoke donation has no tax receipt email error',
    'givingData !== null && receiptReadyStatuses.has(receiptStatus)',
    'Smoke donation giving record includes receipt-sent timestamp evidence',
    'Smoke donation church-facing donor email is blank',
    'Smoke donation church receipt visibility matches donor anonymity',
    'Smoke donation church-facing donor label safety marker matches donor anonymity',
    'Smoke donation church-facing giving safe version matches donor anonymity',
    'Smoke donation church-facing donor label is not an email address',
    'reservedAnonymousDonorLabel',
    'givingDonorName.length > 0 && givingDonorName !== reservedAnonymousDonorLabel',
    'Smoke donation church-facing donor label is non-empty and not the reserved anonymous label',
    'Stored official receipt record exists when the smoke donation is issued or sent',
    'Stored official receipt is a single-donation receipt',
    'Stored official receipt status is issued or sent',
    'Stored official receipt status matches the giving receipt state',
    'Stored official receipt matches the smoke giving document',
    'Stored official receipt matches the smoke church',
    'Stored official receipt matches the smoke donor account',
    'Smoke donation giving record includes positive amount evidence',
    'Stored official receipt amount matches the smoke donation',
    'Stored official receipt currency matches the smoke donation',
    'Stored official receipt includes an official receipt number',
    'Smoke donation giving mirror includes the official receipt number',
    'Smoke donation giving mirror receipt number matches the stored receipt',
    'Stored official receipt includes issue timestamp evidence',
    'Stored official receipt has no delivery error',
    'Stored official receipt has no failed-delivery timestamp',
    'Stored sent receipt includes email delivery timestamp evidence',
    'Stored official receipt issue timestamp is within the ${maxAgeHours}-hour freshness window',
    'Stored sent receipt email timestamp is within the ${maxAgeHours}-hour freshness window',
    'Smoke donation giving receipt-sent timestamp is within the ${maxAgeHours}-hour freshness window',
    'Stored sent receipt includes retained PDF storage metadata',
    'Stored sent receipt includes retained PDF hash evidence',
    'Stored sent receipt includes retained PDF byte-length evidence',
    'Stored sent receipt includes retained PDF timestamp evidence',
    'Stored sent receipt PDF retention status is retained',
    'Stored sent receipt retained PDF timestamp is within the ${maxAgeHours}-hour freshness window',
    'expectedFirebaseStorageBucket',
    'retainedPdfStorageObjectMetadataUrl',
    'readRetainedPdfObjectMetadataWithStorageRest',
    'Retained official receipt PDF object exists in Firebase Storage',
    'Retained official receipt PDF object matches stored path metadata',
    'Retained official receipt PDF object byte length matches stored metadata',
    'Retained official receipt PDF object hash metadata matches stored metadata',
    'Retained official receipt PDF object is marked as an official receipt copy',
    'Stored sent receipt has backend email-sent audit evidence',
    'Stored sent receipt email audit has timestamp evidence',
    'Stored sent receipt email audit is within the ${maxAgeHours}-hour freshness window',
    'Smoke freshness window',
    'taxReceiptEvents',
    'taxReceiptNumber',
    'taxReceiptSentAt',
    'anonymous',
    'donorEmail',
    'donorName',
    'donorNamePublicSafe',
    'receiptManagerGivingSafeVersion',
    'churchReceiptVisible',
    'email_sent',
    'emailSentAt',
    'givingId',
    'churchId',
    'userId',
    'amountCents',
    'eligibleAmountCents',
    'currency',
    'pdfStoragePath',
    'pdfSha256',
    'pdfByteLength',
    'pdfRetentionStatus',
    'pdfRetainedAt',
    'emailError',
    'emailFailedAt',
    'Inspected live completed Checkout events',
    'Inspected live webhook issue events',
    'Direct live webhook issue lookup has no validation/missing-giving/unpaid-session issues',
    'Direct live webhook issue count',
    'live issue statuses to inspect',
    'publicTaxReceiptNumberFallback',
    'officialReceiptNumberLooksAssigned',
    'givingTaxReceiptNumber',
    'not the public fallback',
    'givingPrivatePaymentFields',
    'givingOmitsPrivatePaymentFields',
    'Smoke donation church-facing giving mirror omits raw Stripe payment fields',
    'stripeSessionId',
    'stripeCheckoutSessionId',
    'stripeCheckoutSessionExpiresAt',
    'stripeCheckoutUrl',
    'stripeCheckoutSessionUrl',
    'stripePaymentIntentId',
    'stripePaymentStatus',
    'stripeChargeId',
    'stripeCustomerId',
    'stripeConnectAccountId',
    'stripeRefundId',
    'stripeRefundedChargeId',
    'checkoutSessionId',
    'checkoutUrl',
    'paymentIntentId',
    'chargeId',
    'refundId',
    'without exposing donor, church, giving, receipt, Stripe event, tax receipt event, payment, PDF metadata, amount, currency, or access-token values',
    'liveWebhookIssueEventsQuery',
    'readLiveWebhookIssueEventsWithFirestoreRest',
    'liveIssueEvents',
    'inspectedLiveIssueCount',
  ])
  && includesEvery(liveDonationSmokeTestSource, [
    'accepts a live processed Checkout webhook',
    'accepts Firestore REST timestamp markers from live reads',
    'keeps the live Checkout smoke visible when newer non-Checkout webhooks fill the recent activity window',
    'keeps the live Checkout smoke visible when newer test-mode Checkout completions fill the recent activity window',
    'keeps live webhook issues visible when newer test-mode Checkout completions fill the recent activity window',
    'fails when live Checkout smoke evidence is stale',
    'fails strict sent-receipt smoke when backend email audit evidence is stale',
    'fails strict sent-receipt smoke when receipt, mirror, or retained PDF timestamps are stale',
    'requires the retained official PDF object in Storage for strict sent-receipt smoke',
    'readRetainedPdfObjectMetadataWithStorageRest',
    'retainedPdfStorageObjectMetadataUrl',
    "expect(parseArgs(['--max-age-hours', '96']))",
    "expect(() => parseArgs(['--max-age-hours', '0'])).toThrow('--max-age-hours must be a positive integer');",
    "expect(() => parseArgs(['--limit', '50abc'])).toThrow('--limit must be a positive integer');",
    "expect(() => parseArgs(['--max-age-hours', '96hours'])).toThrow(",
    'liveCompletedCheckoutEventsQuery',
    'readLiveCompletedCheckoutEventsWithFirestoreRest',
    'manual-mode completed donations that are ready for receipt sending',
    'requires privacy-safe church-facing giving mirror state before receipt email smoke',
    'requires an emailed official receipt when the strict announcement flag is enabled',
    'requires backend audit evidence when strict sent-receipt smoke is enabled',
    'requires portal mirror and audit timestamps for strict sent-receipt smoke',
    'requires privacy-safe church-facing giving mirror state for strict sent-receipt smoke',
    'reservedAnonymousDonorLabel',
    'blankNonAnonymousDonorLabel',
    'Smoke donation church-facing donor label is non-empty and not the reserved anonymous label',
    'Smoke donation church-facing giving mirror omits raw Stripe payment fields',
    'stripeCheckoutSessionId',
    'stripePaymentIntentId',
    'stripeRefundedChargeId',
    'taxReceiptEventsForReceiptQuery',
    "expect(parseArgs(['--project', 'kandilo-2f7a9']))",
    "expect(() => parseArgs(['--project', 'staging-project'])).toThrow('--project must be kandilo-2f7a9');",
    'fails closed when the live Checkout webhook',
    'fails when an issued or sent smoke donation points to an unusable stored official receipt',
    "receiptNumber: 'unassigned'",
    "taxReceiptNumber: 'unassigned'",
    "taxReceiptNumber: 'STN-2026-9999'",
    'Direct live webhook issue lookup has no validation/missing-giving/unpaid-session issues',
    'fails when the direct live webhook issue lookup includes validation or missing-giving issues',
    'without exposing identifiers in CLI output',
  ])
  && productionChecklistSource.includes('npm run check:live-donation-smoke')
  && productionChecklistSource.includes('refuses `--project` values other than `kandilo-2f7a9`')
  && productionChecklistSource.includes('npm run check:live-donation-smoke -- --require-sent-receipt')
  && productionChecklistSource.includes('receipt-manager safe-version marker matching donor anonymity')
  && productionChecklistSource.includes('portal-visible receipt number matches the donor-only receipt number')
  && productionChecklistSource.includes('no raw Stripe payment identifier or checkout URL alias fields on the church-facing giving mirror')
  && productionChecklistSource.includes('retained PDF object exists in Firebase Storage')
  && productionChecklistSource.includes('default live donation smoke also confirms a receipt-ready church-facing `giving` mirror')
  && productionChecklistSource.includes('fails if explicitly non-anonymous giving has a blank public donor label or the reserved `Anonymous donor` label')
  && projectDetailsSource.includes('check:live-donation-smoke')
  && projectDetailsSource.includes('refuses `--project` values other than `kandilo-2f7a9`')
  && projectDetailsSource.includes('check:live-donation-smoke -- --require-sent-receipt')
  && projectDetailsSource.includes('receipt-manager safe-version marker matching donor anonymity')
  && projectDetailsSource.includes('portal-visible receipt number matches the donor-only receipt number')
  && projectDetailsSource.includes('no raw Stripe payment identifier or checkout URL alias fields on the church-facing giving mirror')
  && projectDetailsSource.includes('retained PDF object exists in Firebase Storage')
  && projectDetailsSource.includes('default live donation smoke now proves receipt-ready church-facing `giving` mirror privacy before receipt email smoke')
  && projectDetailsSource.includes('raw Stripe payment identifiers or checkout URL aliases must remain absent')
  && projectDetailsSource.includes('with privacy-safe church-facing giving mirror evidence and no raw Stripe payment identifier or checkout URL alias fields')
  && readmeSource.includes('verifies receipt-ready state, assigned receipt identity when issued, and a privacy-safe church-facing giving mirror')
  && qaWebFirebaseSource.includes('npm run check:live-donation-smoke')
  && qaWebFirebaseSource.includes('npm run check:live-donation-smoke -- --require-sent-receipt')
  && qaWebFirebaseSource.includes('portal-visible receipt number matches the donor-only receipt number')
  && qaWebFirebaseSource.includes('no raw Stripe payment identifier or checkout URL alias fields on the church-facing giving mirror')
  && qaWebFirebaseSource.includes('retained PDF object exists in Firebase Storage')
  && qaWebFirebaseSource.includes('receipt-ready privacy-safe church-facing giving mirror evidence')
  && qaWebFirebaseSource.includes('strict sent-receipt email/PDF/audit evidence')
  && qaWebFirebaseSource.includes('Live donation smoke coverage must prove receipt-ready church-facing giving mirror privacy before receipt email smoke')
  && deployHelperSource.includes('npm run check:live-donation-smoke')
  && deployHelperSource.includes('npm run check:live-donation-smoke -- --require-sent-receipt')
  && deployHelperTestSource.includes('default privacy-safe church-facing giving mirror state without raw Stripe payment fields')
  && !liveDonationSmokeSource.includes("'sentAt'"),
  'Live donation smoke verifier is project-bound, freshness-windowed, queries live processed Checkout smoke and live issue statuses directly, and proves checkout completion, giving completion, receipt readiness, absence of receipt errors, default privacy-safe church-facing giving mirror state without raw Stripe payment fields, stored official receipt identity/amount/currency/kind/status/assigned-number/fresh timestamp evidence, matching portal-visible receipt number evidence, retained PDF status/metadata plus Storage object presence/integrity metadata, backend email-sent audit evidence, and strict sent-receipt announcement gating without exposing private identifiers',
  'Run the default check after the first small live donation and the strict sent-receipt check before announcing tax receipts.'
);
record(
  rootPackage?.scripts?.['check:live-annual-receipt-smoke'] === 'node scripts/check-live-annual-receipt-smoke.mjs'
  && includesEvery(liveAnnualReceiptSmokeSource, [
    'readFirebaseCliAccessTokenForAudit',
    'recentAnnualEmailSentEventsQuery',
    'readRecentAnnualEmailSentEventsWithFirestoreRest',
    'readTaxReceiptEventsForReceiptWithFirestoreRest',
    'readDocumentWithFirestoreRest',
    'readRetainedPdfObjectMetadataWithStorageRest',
    'defaultMaxAgeHours = 72',
    'defaultMinContributions = 2',
    'minMinContributions = 2',
    '--receipt-id <annual_id>',
    '--min-contributions <n>',
    'recent annual smoke candidate',
    'throw new Error(`--project must be ${expectedProjectId}.`);',
    'annualReceiptIdPattern',
    'annualEmailEventCandidates',
    'loadLiveAnnualReceiptSmokeStateForTarget',
    'fallbackState',
    'function timestampEvidenceString',
    '__firestoreTimestampValue',
    "value: { stringValue: 'email_sent' }",
    "field: { fieldPath: 'kind' }",
    "value: { stringValue: 'annual' }",
    "field: { fieldPath: 'createdAt' }",
    "direction: 'DESCENDING'",
    'Annual receipt email audit is within the ${maxAgeHours}-hour freshness window',
    'Stored donor-only annual receipt record is readable',
    'Stored receipt is an annual receipt',
    'Stored annual receipt status is sent',
    'Stored annual receipt is an original year-end receipt',
    'Stored annual receipt is not marked correction-required',
    'Stored annual receipt is not voided',
    'Annual email audit event matches the stored annual receipt',
    'Stored annual receipt includes an official receipt number',
    'Stored annual receipt covers at least ${minContributions} contribution(s) with exact giving evidence',
    'Stored annual receipt has itemized contribution lines matching the receipt totals',
    'Stored annual receipt issue timestamp is within the ${maxAgeHours}-hour freshness window',
    'Stored annual receipt email timestamp is within the ${maxAgeHours}-hour freshness window',
    'Stored annual receipt retained PDF timestamp is within the ${maxAgeHours}-hour freshness window',
    'Retained annual receipt PDF object exists in Firebase Storage',
    'Retained annual receipt PDF object byte length matches stored metadata',
    'Retained annual receipt PDF object hash metadata matches stored metadata',
    'Staff-safe annual receipt summary mirror is readable',
    'Annual summary points to the stored annual receipt',
    'Annual summary receipt number matches the stored receipt',
    'Annual summary contribution count matches the stored receipt',
    'Annual summary is for an explicitly non-anonymous donor-year',
    'Annual summary is visible to receipt managers',
    'Annual summary donor label is marked public-safe',
    'Annual summary has the current receipt-manager safe marker',
    'reservedAnonymousDonorLabel',
    'Annual summary donor label is non-empty, not an email address, and not the reserved anonymous label',
    'Annual summary mirror omits private full-receipt fields',
    'annualSummaryPrivateFields',
    'receiptManagerSummarySafeVersion = 2',
    'givingIds',
    'donorEmail',
    'taxReceiptLegalName',
    'donorName',
    'donorAddress',
    'organizationTaxId',
    'contributions',
    'issuedBy',
    'pdfTemplateVersion',
    'pdfStoragePath',
    'pdfSha256',
    'pdfByteLength',
    'stripePaymentIntentId',
    'stripeCheckoutSessionUrl',
    'checkoutUrl',
    'stripeRefundStatus',
    'stripeConnectAccountId',
    'partialRefundGivingIds',
    'correctionForGivingId',
    'correctionForReceiptId',
    'correctionSourceReason',
    'correctedAt',
    'correctedBy',
    'correctionMarkedAt',
    'correctionMarkedBy',
    'voidedBy',
    'without exposing donor, church, receipt, giving, tax receipt event, PDF metadata, amount, currency, or access-token values',
  ])
  && includesEvery(liveAnnualReceiptSmokeTestSource, [
    'accepts a fresh sent annual receipt with a staff-safe summary and retained PDF evidence',
    'accepts Firestore REST timestamp markers from live annual reads',
    'fails closed when the annual smoke does not prove multi-contribution, itemized detail, or staff-safe summary evidence',
    'loads annual smoke state with field masks and without exposing identifiers in CLI output',
    'fails closed when annual smoke evidence is corrected or a refund reissue',
    'scans recent annual events until a staff-safe annual smoke candidate passes',
    'scans past newer corrected annual smoke events until an original annual candidate passes',
    'builds the annual email query and validates CLI arguments',
    "expect(parseArgs(['--project', 'kandilo-2f7a9']))",
    "expect(parseArgs(['--receipt-id', 'annual_abc123', '--min-contributions', '3']))",
    "expect(() => parseArgs(['--min-contributions', '1'])).toThrow('--min-contributions must be an integer from 2 to 100')",
    "expect(() => parseArgs(['--project', 'staging-project'])).toThrow('--project must be kandilo-2f7a9')",
    "expect(() => parseArgs(['--receipt-id', 'receipt_abc123'])).toThrow('--receipt-id must be an annual')",
    'Annual summary mirror omits private full-receipt fields',
    'Stored annual receipt covers at least 2 contribution(s) with exact giving evidence',
    'Stored annual receipt has itemized contribution lines matching the receipt totals',
    'reservedAnonymousSummaryLabel',
    'Annual summary donor label is non-empty, not an email address, and not the reserved anonymous label',
    "expect(receiptReadUrl).toContain('mask.fieldPaths=contributions')",
    "expect(output).not.toContain('annual_private_smoke')",
    "expect(output).not.toContain('giving-private-smoke-a')",
    "expect(output).not.toContain('taxReceipts/church-1/2025/annual_private_smoke.pdf')",
  ])
  && productionChecklistSource.includes('npm run check:live-annual-receipt-smoke')
  && productionChecklistSource.includes('covering at least two donations')
  && productionChecklistSource.includes('queries annual receipt email audit events by `action == email_sent` and `kind == annual`')
  && productionChecklistSource.includes('scans recent annual `taxReceiptEvents` records until a passing non-anonymous staff-safe annual receipt smoke candidate is found')
  && productionChecklistSource.includes('requires an original year-end annual receipt rather than a corrected or refund-reissue annual receipt')
  && productionChecklistSource.includes('itemized contribution lines whose count, currency, amount, and eligible totals match the annual receipt')
  && productionChecklistSource.includes('staff-safe `taxReceiptSummaries/{receiptId}` mirror')
  && projectDetailsSource.includes('check:live-annual-receipt-smoke')
  && projectDetailsSource.includes('non-anonymous closed-year annual receipt covering at least two donations')
  && projectDetailsSource.includes('scans recent annual receipt email audit events until it finds a passing non-anonymous staff-safe annual receipt smoke candidate')
  && projectDetailsSource.includes('itemized contribution lines whose count, currency, amount, and eligible totals match the annual receipt')
  && projectDetailsSource.includes('A corrected or refund-reissue annual receipt cannot satisfy this original annual smoke gate')
  && qaWebFirebaseSource.includes('npm run check:live-annual-receipt-smoke')
  && qaWebFirebaseSource.includes('itemized contribution-line detail matching the annual receipt totals')
  && qaWebFirebaseSource.includes('matching staff-safe annual summary mirror with no private full-receipt fields')
  && deployHelperSource.includes('npm run check:live-annual-receipt-smoke'),
  'Live annual receipt smoke verifier is project-bound, freshness-windowed, read-only, proves multi-contribution annual receipt delivery with itemized contribution-line totals plus staff-safe summary and retained PDF evidence, and does not print private identifiers',
  'Run it after sending a non-anonymous closed-year annual receipt before announcing year-end annual receipts.'
);
record(
  includesEvery(taxReceiptSummaryPrivacySourceTestSource, [
    'keeps annual summary private-field deny lists aligned across backend, rules, audit, and smoke gates',
    'const TAX_RECEIPT_SUMMARY_PRIVATE_FIELDS = [',
    'function taxReceiptSummaryOmitsPrivateFields',
    'const annualSummaryPrivateFields = [',
    "expect(rulesFields).toEqual(backendFields);",
    "expect(auditFields).toEqual(backendFields);",
    "expect(annualSmokeFields).toEqual(backendFields);",
    "expectUnique(backendFields, 'Functions TAX_RECEIPT_SUMMARY_PRIVATE_FIELDS')",
  ]),
  'Annual summary private-field deny lists stay aligned across Functions, Firestore rules, audit repair, and live annual smoke verification'
);
record(
  includesEvery(taxReceiptGivingPrivacySourceTestSource, [
    'keeps church-facing giving private payment deny lists aligned across backend, rules, audit, and smoke gates',
    'const GIVING_PRIVATE_PAYMENT_FIELDS = [',
    'function givingOmitsPrivatePaymentFields',
    'const givingPrivatePaymentFields = [',
    "expect(rulesFields).toEqual(backendFields);",
    "expect(auditFields).toEqual(backendFields);",
    "expect(liveSmokeFields).toEqual(backendFields);",
    "expectUnique(backendFields, 'Functions GIVING_PRIVATE_PAYMENT_FIELDS')",
  ]),
  'Church-facing giving private payment deny lists stay aligned across Functions, Firestore rules, audit repair, and live donation smoke verification'
);
record(
  includesEvery(firebaseEmulatorSource, [
    "VITE_USE_FIREBASE_EMULATORS === 'true'",
    "VITE_FIREBASE_EMULATOR_HOST || '127.0.0.1'",
    'VITE_FIREBASE_AUTH_EMULATOR_PORT || 9098',
    'VITE_FIRESTORE_EMULATOR_PORT || 8088',
    'VITE_FIREBASE_FUNCTIONS_EMULATOR_PORT || 5008',
    'VITE_FIREBASE_STORAGE_EMULATOR_PORT || 9198',
    'shouldConnectFirebaseEmulator',
    '__kandiloFirebaseEmulators',
  ])
  && includesEvery(webFirebaseSources, [
    'connectAuthEmulator',
    'connectFirestoreEmulator',
    'connectFunctionsEmulator',
    'connectStorageEmulator',
    'FIREBASE_EMULATORS_ENABLED',
  ])
  && includesEvery(indexHtmlSource, [
    'http://127.0.0.1:*',
    'ws://127.0.0.1:*',
    'http://localhost:*',
    'ws://localhost:*',
  ])
  && !indexHtmlSource.includes('upgrade-insecure-requests')
  && envExampleSource.includes('VITE_USE_FIREBASE_EMULATORS="false"')
  && (readText('package.json') ?? '').includes('"dev:emulators"')
  && qaWebFirebaseSource.includes('npm run dev:emulators'),
  'Frontend Firebase SDKs and local CSP support opt-in emulator wiring for receipt portal verification without production data'
);
record(
  includesEvery(membershipDbSource, [
    'export function subscribeToUserMemberships',
    'onError?: (error: unknown) => void',
    'onError?.(error)',
  ])
  && includesEvery(useChurchesSource, [
    'subscribeToUserMemberships(',
    'setMemberships([]);',
    'setLoading(false);',
  ])
  && includesEvery(membershipDbTestSource, [
    'routes auth-switch permission denials through the explicit listener error handler',
    "Object.assign(new Error('permission-denied'), { code: 'permission-denied' })",
    'expect(callback).not.toHaveBeenCalled();',
    'expect(onError).toHaveBeenCalledWith(permissionDenied);',
  ])
  && projectDetailsSource.includes('stale fanout listener to lose read permission')
  && productionChecklistSource.includes('stale receipt-manager roles or uncaught browser console errors from user membership fanout permission-denied listener transitions')
  && includesCollapsedWhitespace(
    qaWebFirebaseSource,
    'membership fanout listener permission-denied errors are handled without stale receipt-manager roles'
  ),
  'Current-user membership fanout listeners handle auth-switch permission denials without stale receipt-manager roles or uncaught browser errors'
);
record(
  rootPackage?.scripts?.['seed:receipt-emulator'] === 'node scripts/seed-receipt-emulator.mjs'
  && includesEvery(receiptEmulatorSeedSource, [
    "const PROJECT_ID = 'kandilo-2f7a9';",
    "const FIRESTORE_EMULATOR_HOST_ENV = 'FIRESTORE_EMULATOR_HOST';",
    "const AUTH_EMULATOR_HOST_ENV = 'FIREBASE_AUTH_EMULATOR_HOST';",
    'function assertLocalEmulatorHost',
    'function validateSeedArgs',
    'Unknown argument',
    'new URL(`http://${value}`)',
    'url.username || url.password',
    "url.pathname !== '/'",
    'Number.parseInt(url.port, 10)',
    'return url.host;',
    'Refusing to seed because',
    '/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents',
    '/emulator/v1/projects/${PROJECT_ID}/accounts',
    'treasurer@example.com',
    'member@example.com',
    "const CANADA_CHURCH_ID = 'church-ca-1';",
    "const canadaGivingId = 'giving_ca_2026_unsupported';",
    "const canadaAnnualGivingId = 'giving_ca_2025_annual_unsupported';",
    "name: 'Holy Trinity Orthodox Church'",
    "country: 'CA'",
    "jurisdiction: 'CA'",
    "currency: 'CAD'",
    "completedAt: `${annualYear}-08-14T16:20:00.000Z`",
    "taxReceiptStatus: 'not_configured'",
    "taxReceiptError: 'tax_receipt_unsupported_jurisdiction'",
    "const anonymousGivingId = 'giving_2026_anonymous';",
    "const unclassifiedGivingId = 'giving_2026_unclassified';",
    'includeAnonymousField: false',
    'donorNamePublicSafe: includeAnonymousField && anonymous === false',
    'receiptManagerGivingSafeVersion: includeAnonymousField && anonymous === false ? 1 : 0',
    'donorAnonymous: true',
    'donorLabelPublicSafe: donorAnonymous === false',
    'receiptManagerSummarySafeVersion: donorAnonymous === false ? 2 : 0',
    'Confirm anonymous and unclassified donor-owned rows do not appear in the treasurer queue.',
    'Switch to Holy Trinity Orthodox Church and confirm Canadian/CRA receipts are unavailable.',
    'the Canadian donation and annual row show the Canada/CRA unavailable state.',
    'taxReceiptSettings',
    'taxReceipts',
    'taxReceiptSummaries',
  ])
  && qaWebFirebaseSource.includes('npm run seed:receipt-emulator')
  && qaWebFirebaseSource.includes('treasurer@example.com')
  && qaWebFirebaseSource.includes('member@example.com')
  && qaWebFirebaseSource.includes('donor-owned anonymous/unclassified giving rows')
  && qaWebFirebaseSource.includes('anonymous annual summary mirror that remains donor-only')
  && qaWebFirebaseSource.includes('Holy Trinity Orthodox Church')
  && qaWebFirebaseSource.includes('closed-year annual donor row')
  && qaWebFirebaseSource.includes('Canada/CRA-specific')
  && qaWebFirebaseSource.includes('unavailable receipt copy')
  && readmeSource.includes('Canadian single and annual unavailable donor rows')
  && receiptEmulatorSeedTestSource.includes('rejects unknown CLI arguments before issuing clear requests')
  && receiptEmulatorSeedTestSource.includes('seeds a Canadian parish with Canada/CRA receipts unavailable for browser verification')
  && projectDetailsSource.includes('including U.S. privacy and Canadian single/annual Canada/CRA unavailable cases'),
  'Local receipt portal emulator seeder is guarded, documents donor/church privacy and Canada/CRA unavailable checks, and seeds receipt privacy cases for donor-owned anonymous/unclassified rows'
);
record(
  typeof rootPackage?.devDependencies?.['firebase-tools'] === 'string'
  && /^\d+\.\d+\.\d+$/.test(rootPackage.devDependencies['firebase-tools'])
  && rootPackageLock?.packages?.['']?.devDependencies?.['firebase-tools'] === rootPackage.devDependencies['firebase-tools']
  && rootPackageLock?.packages?.['node_modules/firebase-tools']?.version === rootPackage.devDependencies['firebase-tools']
  && functionsPackage?.scripts?.serve?.includes('npx --prefix .. --no-install firebase emulators:start --only auth,firestore,functions,storage')
  && functionsPackage?.scripts?.serve?.includes('STRIPE_SECRET_KEY=sk_test_kandilo_emulator')
  && functionsPackage?.scripts?.serve?.includes('RESEND_API_KEY=re_kandilo_emulator_test')
  && functionsPackage?.scripts?.deploy === 'npx --prefix .. --no-install firebase deploy --only functions'
  && envExampleSource.includes('npm run configure:receipt-secrets')
  && envExampleSource.includes('npx --no-install firebase functions:secrets:set RESEND_API_KEY --project kandilo-2f7a9')
  && envExampleSource.includes('npx --no-install firebase functions:secrets:set STRIPE_SECRET_KEY --project kandilo-2f7a9')
  && envExampleSource.includes('npx --no-install firebase functions:secrets:set STRIPE_WEBHOOK_SECRET --project kandilo-2f7a9')
  && liveFirebaseMutationHelperSources.includes('npx --no-install firebase login')
  && liveFirebaseMutationHelperSourceList.every((source) => includesEvery(source, [
    "const expectedProjectId = 'kandilo-2f7a9';",
    '--confirm-project',
    'assertExpectedProjectConfirmation(confirmProject);',
    'projectId: expectedProjectId',
  ])),
  'Firebase CLI is pinned in package.json, package-lock, guarded release scripts, nested Functions package scripts, secret/admin docs, privileged role-admin scripts, and live sample-data scripts require explicit project confirmation',
  'Install firebase-tools as an exact root devDependency and keep nested Functions package, secret, and admin-helper Firebase commands routed through the repo-pinned CLI with explicit kandilo-2f7a9 confirmation before privileged role and live sample-data writes.'
);

const rootFirebaseDependency = typeof rootPackage?.dependencies?.firebase === 'string'
  ? rootPackage.dependencies.firebase.replace(/^[^\d]*/, '')
  : '';
record(
  rootFirebaseDependency !== ''
  && includesEvery(firebaseMessagingServiceWorkerSource, [
    `importScripts('https://www.gstatic.com/firebasejs/${rootFirebaseDependency}/firebase-app-compat.js');`,
    `importScripts('https://www.gstatic.com/firebasejs/${rootFirebaseDependency}/firebase-messaging-compat.js');`,
  ])
  && projectDetailsSource.includes(`currently \`${rootFirebaseDependency}\``),
  'Firebase Messaging service worker compat SDK version matches the app Firebase dependency'
);

record(
  rootPackage?.scripts?.['test:firebase']?.startsWith('npx --no-install firebase emulators:exec')
  && rootPackage?.scripts?.['test:functions']?.includes('npx --no-install firebase emulators:exec --only auth,firestore,functions,storage')
  && rootPackage?.scripts?.['test:functions']?.includes('STRIPE_SECRET_KEY=sk_test_kandilo_emulator')
  && rootPackage?.scripts?.['test:functions']?.includes('RESEND_API_KEY=re_kandilo_emulator_test')
  && rootPackage?.scripts?.['test:functions']?.includes('GEMINI_API_KEY=gemini_emulator_test')
  && qaWebFirebaseSource.includes('npx --no-install firebase emulators:start --only auth,firestore,functions,storage')
  && qaWebFirebaseSource.includes('npx --no-install firebase emulators:exec --only firestore,storage')
  && qaWebFirebaseSource.includes('npx --no-install firebase emulators:exec --only auth,firestore,functions,storage')
  && qaWebFirebaseSource.includes('STRIPE_SECRET_KEY=sk_test_kandilo_emulator STRIPE_WEBHOOK_SECRET=whsec_kandilo_emulator_test RESEND_API_KEY=re_kandilo_emulator_test GEMINI_API_KEY=gemini_emulator_test APP_URL=http://localhost:3000 npx --no-install firebase emulators:start --only auth,firestore,functions,storage')
  && qaWebFirebaseSource.includes('STRIPE_SECRET_KEY=sk_test_kandilo_emulator STRIPE_WEBHOOK_SECRET=whsec_kandilo_emulator_test RESEND_API_KEY=re_kandilo_emulator_test GEMINI_API_KEY=gemini_emulator_test APP_URL=http://localhost:3000 npx --no-install firebase emulators:exec --only auth,firestore,functions,storage')
  && qaWebFirebaseSource.includes('Retained tax receipt PDF paths against the Storage emulator, never production Storage.')
  && qaWebFirebaseSource.includes('The dummy backend keys are local emulator sentinels only.')
  && projectDetailsSource.includes('Repo-pinned Firebase CLI from `devDependencies`')
  && projectDetailsSource.includes('npx --no-install firebase deploy --only functions')
  && projectDetailsSource.includes('npx --no-install firebase emulators:start')
  && projectDetailsSource.includes('npx --no-install firebase login')
  && !projectDetailsSource.includes('npx firebase-tools@latest login')
  && productionChecklistSource.includes('npx --no-install firebase functions:secrets:set GEMINI_API_KEY --project kandilo-2f7a9')
  && productionChecklistSource.includes('npx --no-install firebase deploy --only firestore:rules,firestore:indexes,storage --project kandilo-2f7a9')
  && productionChecklistSource.includes('npx --no-install firebase deploy --only functions --project kandilo-2f7a9')
  && productionChecklistSource.includes('npx --no-install firebase deploy --only hosting --project kandilo-2f7a9')
  && productionChecklistSource.includes('npx --no-install firebase functions:artifacts:setpolicy --project kandilo-2f7a9 --location=us-central1 --days=1 --force')
  && productionChecklistSource.includes('npx --no-install firebase functions:artifacts:setpolicy --project kandilo-2f7a9 --location=northamerica-northeast2 --days=1 --force')
  && !productionChecklistSource.includes('npx firebase-tools@latest')
  && readinessScriptSource.includes('Run npx --no-install firebase login before checking deployed Firebase REST resources.')
  && visibilityAuditSource.includes('Run npx --no-install firebase login before using the read-only REST audit fallback.')
  && saintMaintenanceSources.includes("const FIREBASE_LOGIN_COMMAND = 'npx --no-install firebase login';")
  && saintMaintenanceSources.includes('firestoreBatchWriteFailure')
  && saintMaintenanceSources.includes('Check Firebase CLI auth, Firestore permissions, and request shape.')
  && saintMaintenanceSources.includes('Partial write failures: ${failures.length} Firestore write(s) failed.')
  && !saintMaintenanceSources.includes('firebase-tools@latest login')
  && !saintMaintenanceSources.includes('await resp.text()')
  && !saintMaintenanceSources.includes('JSON.stringify(failures)'),
  'Firebase emulator/live-helper runbooks use the repo-pinned CLI, Storage-safe Functions tests, and privacy-safe Firestore REST write errors',
  'Use npx --no-install firebase for manual emulator/live operations and include Storage in Functions emulator tests so receipt verification does not depend on a global Firebase CLI version or production Storage.'
);
record(
  rootPackage?.scripts?.['check:stripe-production:ci'] === 'node scripts/check-stripe-production-readiness.mjs --ci-static'
  && ciWorkflowSource.includes('Stripe and tax receipt production readiness')
  && ciWorkflowSource.includes('node-version: 22')
  && ciWorkflowSource.includes('npm run check:stripe-production:ci')
  && readinessScriptSource.includes('function validateReadinessArgs(args)')
  && readinessScriptSource.includes('const expectedNodeMajor = 22;')
  && readinessScriptSource.includes('function currentNodeMajor()')
  && readinessScriptSource.includes('Local Node.js runtime is ${expectedNodeMajor}.x')
  && readinessScriptSource.includes('Run nvm use 22 before production readiness, build, and deploy checks.')
  && readinessScriptSource.includes("const ciStaticMode = readinessArgs.includes('--ci-static');")
  && readinessScriptSource.includes('Usage: npm run check:stripe-production -- [--live] [--strict-native-links] [--ci-static]')
  && readinessScriptSource.includes('Skipped in CI static readiness mode'),
  'CI runs static Stripe and tax receipt production readiness without live credentials',
  'Keep the static CI gate separate from the strict deploy gate so source/runbook regressions are caught without requiring .env.local or live Stripe/Firebase credentials.'
);
const liveFunctionSourceManifest = evaluateLiveFunctionManifestSourceAlignment({
  indexSource: functionsIndexSource,
  functionSources: [givingFunctionsSource, superAdminFunctionsSource],
  constantSources: [functionsRegionsSource],
});
record(
  liveFunctionSourceManifest.ok,
  liveFunctionSourceManifestReadyLabel,
  liveFunctionSourceManifest.detail
);
record(
  rootPackage?.scripts?.['deploy:tax-receipts:plan'] === 'node scripts/deploy-stripe-tax-receipts.mjs'
  && rootPackage?.scripts?.['deploy:tax-receipts'] === 'node scripts/deploy-stripe-tax-receipts.mjs --deploy'
  && includesEvery(deployHelperSource, [
    "const expectedProjectId = 'kandilo-2f7a9';",
    'const requiredNodeMajor = 22;',
    "const deployTargets = 'functions,firestore:rules,firestore:indexes,storage,hosting';",
    'function validateDeployArgs(rawArgs)',
    'Unknown argument',
    "const shouldDeploy = args.includes('--deploy');",
    "return ['--no-install', 'firebase', ...commandArgs];",
    'function assertExpectedNodeRuntime()',
    'assertExpectedNodeRuntime();',
    'Refusing to deploy without --confirm-project',
    "run(packageRunner(), ['run', 'check:stripe-production', '--', '--strict-native-links']);",
    "run(packageRunner(), ['run', 'lint']);",
    "run(packageRunner(), ['run', 'test:qa']);",
    "run(packageRunner(), ['run', 'build']);",
    "'deploy',",
    "'--non-interactive',",
    "run(packageRunner(), ['run', 'check:firebase-live', '--', '--strict-native-links']);",
    "run(packageRunner(), ['run', 'audit:tax-receipts', '--', '--fail-on-repairs']);",
    'npm run configure:native-links -- --apple-from-xcode-project --android-from-release-keystore',
  ])
  && includesEvery(readinessScriptSource, [
    "const strictNativeLinks = readinessArgs.includes('--strict-native-links');",
    "const nativeLinkSeverity = strictNativeLinks ? 'fail' : 'warn';",
    'validateReadinessArgs(readinessArgs);',
    'Unknown argument',
    'nativeLinkSeverity',
  ])
  && includesEvery(readinessScriptSource, [
    "from './readiness-live-functions.mjs';",
    'const expectedFunctionsRuntime = expectedLiveFunctionsRuntime;',
    'evaluateLiveFunctionManifestSourceAlignment({',
    'liveFunctionSourceManifestReadyLabel',
    'evaluateLiveFunctionDeployment(',
    'liveFunctionDeploymentReadyLabel',
    'requiredLiveSchedulerJobs(expectedProjectId)',
    'readCloudSchedulerJson',
    'Cloud Scheduler can read deployed schedule job for',
    'evaluateLiveSchedulerJobs(',
    'liveSchedulerJobReadyLabel',
    'function assetReferencesFromIndexHtml(html)',
    'function newestHostingBuildInputMtimeMs()',
    'Local production Hosting build is current with frontend source inputs',
    'async function readPublicTextResponse(url, label)',
    'function deployedHostingSecurityHeadersReady(headers)',
    'async function publicResourceAvailable(url)',
    "readText('dist/index.html')",
    'Firebase Hosting serves ${expectedAppUrl}',
    'Live Firebase Hosting serves required receipt portal security headers',
    'Live Firebase Hosting serves current production build asset references',
    'if (missingAssets.length === 0)',
    'Live Firebase Hosting serves current production build asset files',
    'Live Firebase Hosting serves Apple universal links file',
    'Live Apple universal links file matches local production configuration',
    'Live Firebase Hosting serves Android app links file',
    'Live Android app links file matches local production configuration',
    'Live native universal/app links are production-final for Stripe and invitation returns',
    'Live Firebase Storage rules match local storage.rules',
    'await checkLiveHostingDeployment();',
  ])
  && includesEvery(readinessLiveFunctionsSource, [
    "import ts from 'typescript';",
    "export const expectedLiveFunctionsRuntime = 'nodejs22';",
    'export const liveFunctionDeploymentReadyLabel',
    'export const liveFunctionSourceManifestReadyLabel',
    'export const liveSchedulerJobReadyLabel',
    'export const requiredLiveStripeTaxReceiptFunctions',
    'export function requiredLiveSchedulerJobs',
    'export function liveSchedulerJobNameForRequirement',
    'export function evaluateLiveSchedulerJobs',
    'export function evaluateLiveFunctionManifestSourceAlignment',
    'export function functionDeploymentDeclarationsFromSource',
    'export function exportedFunctionNamesFromIndexSource',
    "schedule: 'every 24 hours'",
    "timeZone: 'Etc/UTC'",
    'retryCount: 0',
    'scheduleMismatchedSchedulerJobs',
    'timeZoneMismatchedSchedulerJobs',
    'retryMismatchedSchedulerJobs',
    'function schedulerJobRetryCount',
    'function firebaseSecretName(value)',
    'function deployedFunctionSecretNames(fn)',
    'function functionDeploymentKey(fn)',
    'function numberValueFromNode',
    'function functionRuntime(fn)',
    'function functionState(fn)',
    'functionRuntime(deployed) !== expectedRuntime',
    'runtimeMismatchedFunctions',
    'stateMismatchedFunctions',
    'secretMismatchedFunctions',
    'unexpectedSecretMismatchedFunctions',
    'unexpectedSensitiveFunctionDeployments',
    'isSensitiveStripeTaxReceiptFunctionId',
    'unexpectedSensitiveFunctions',
    'unexpected sensitive deployments',
    'unexpected sensitive functions',
    'Live Firebase deployment includes required active Stripe and tax receipt Functions on Node.js 22 with exact secret bindings',
  ])
  && includesEvery(deployHelperTestSource, [
    "expect(result.stdout).toContain('Default mode is read-only.');",
    "expect(result.stdout).toContain('Required Node.js: 22.x');",
    "expect(result.stdout).toContain('Use the repo toolchain before deploy mode: nvm use 22');",
    "expect(result.stdout).toContain('npm run check:stripe-production -- --strict-native-links');",
    "expect(result.stdout).toContain('npm run build');",
    "expect(result.stdout).toContain('npm run check:firebase-live -- --strict-native-links');",
    "expect(result.stdout).toContain('npm run audit:tax-receipts -- --fail-on-repairs');",
    "expect(result.stdout).toContain('npm run configure:native-links -- --status');",
    "expect(result.stdout).toContain('npm run configure:native-links -- --apple-from-xcode-project --android-from-release-keystore');",
    "expect(result.stdout).toContain('Current local native-link derivation status:');",
    "expect(result.stdout).toContain('Apple Team ID:');",
    "expect(result.stdout).toContain('Android release signing:');",
    'toHaveLength(2)',
    "'npx --no-install firebase deploy --only functions,firestore:rules,firestore:indexes,storage,hosting'",
    'function nativeLinkDerivationStatus()',
    'appleTeamIdFromXcodeProject({ rootDir: root })',
    'androidReleaseSigningConfig({ rootDir: root })',
    "runDeployScript(['--deploy'])",
    "expect(result.stderr).toContain('Refusing to deploy without --confirm-project kandilo-2f7a9.');",
    "expect(result.stdout).not.toContain('firebase deploy --only');",
    "runDeployScript(['--deply'])",
    "expect(unknown.stderr).toContain('Unknown argument --deply.');",
    "expect(lintIndex).toBeGreaterThan(readinessIndex);",
    "expect(qaIndex).toBeGreaterThan(lintIndex);",
    "expect(buildIndex).toBeGreaterThan(qaIndex);",
    "expect(preDeployVisibilityAuditIndex).toBeGreaterThan(buildIndex);",
    "expect(deployIndex).toBeGreaterThan(preDeployVisibilityAuditIndex);",
    "expect(liveCheckIndex).toBeGreaterThan(deployIndex);",
    "expect(postDeployVisibilityAuditIndex).toBeGreaterThan(liveCheckIndex);",
    'stripeWebhook in northamerica-northeast2',
    'unexpected sensitive deployments: legacyStripePaymentIntent in us-central1',
    'evaluates live Cloud Scheduler cadence and timezone for annual receipt automation',
    'prepareYearEndAnnualTaxReceipts expected every 24 hours, got every 1 hours',
    'prepareYearEndAnnualTaxReceipts expected retryCount 0, got 5',
    "if (requirement.id === 'createStripePaymentIntent')",
    "if (requirement.id === 'prepareYearEndAnnualTaxReceipts')",
    'prepareYearEndAnnualTaxReceipts expected us-central1/scheduled secrets RESEND_API_KEY schedule every 1 hours timezone America/Edmonton retryCount 5, got us-central1/scheduled secrets RESEND_API_KEY schedule every 24 hours timezone Etc/UTC retryCount 0',
    'createStripePaymentIntent expected us-central1/callable secrets STRIPE_SECRET_KEY, got us-central1/callable secrets none',
    "const assetFileGateIndex = source.indexOf('if (missingAssets.length === 0)', missingAssetsIndex);",
    "expect(source.slice(missingAssetsIndex, appleCheckIndex)).not.toContain('return;');",
  ])
  && productionChecklistSource.includes('npm run deploy:tax-receipts:plan')
  && productionChecklistSource.includes('reports whether the current Xcode project and Android release-signing configuration can derive final native app-link identifiers locally')
  && productionChecklistSource.includes('npm run deploy:tax-receipts -- --confirm-project kandilo-2f7a9')
  && productionChecklistSource.includes('`npm run check:stripe-production -- --strict-native-links`, `npm run lint`, `npm run test:qa`, `npm run build`, `npm run audit:tax-receipts -- --fail-on-repairs`, deploys')
  && productionChecklistSource.includes('finishes with `npm run check:firebase-live -- --strict-native-links` plus `npm run audit:tax-receipts -- --fail-on-repairs`')
  && productionChecklistSource.includes('scheduled annual receipt job is enabled with the expected `every 24 hours` / `Etc/UTC` cadence and no automatic retries')
  && projectDetailsSource.includes('guarded `deploy:tax-receipts` helper')
  && projectDetailsSource.includes('`--strict-native-links` so incomplete native return files block release deployment')
  && projectDetailsSource.includes('run an explicit production web build')
  && projectDetailsSource.includes('run a pre-deploy legacy visibility audit')
  && projectDetailsSource.includes('reports whether the current Xcode project and Android release-signing configuration can derive the final native app-link identifiers locally')
  && projectDetailsSource.includes('reads the deployed Cloud Scheduler job for `prepareYearEndAnnualTaxReceipts`')
  && projectDetailsSource.includes('retry count is no longer zero')
  && projectDetailsSource.includes('then rerun `npm run audit:tax-receipts -- --fail-on-repairs` after deploy'),
  'Guarded tax receipt deploy helper requires Node 22, uses the repo-pinned Firebase CLI, and bundles strict native-link readiness, full QA, Functions, Firestore rules/indexes, Storage rules, Hosting, live drift verification, and legacy visibility audit gating'
);

const givingSource = readGivingModuleSource();
const superAdminSource = readText('functions/src/modules/superAdmin.ts') ?? '';
const sharedSecuritySource = readText('functions/src/shared/security.ts') ?? '';
const appUrlSource = readText('functions/src/shared/appUrl.ts') ?? '';
const paymentSettingsSource = readText('functions/src/shared/paymentSettings.ts') ?? '';
const apiClientSource = readText('src/lib/api/client.ts') ?? '';
const apiClientTestSource = readText('src/lib/api/client.test.ts') ?? '';
const missionControlApiSource = readText('src/lib/api/mission-control.ts') ?? '';
const givingDbSource = readText('src/lib/db/giving.ts') ?? '';
const givingDbSubscriptionTestSource = readText('src/lib/db/giving-subscriptions.test.ts') ?? '';
const profileDbSource = readText('src/lib/db/profile.ts') ?? '';
const profileDbTestSource = readText('src/lib/db/profile.test.ts') ?? '';
const firestoreMappersTestSource = readText('src/lib/db/firestoreMappers.test.ts') ?? '';
const receiptErrorsSource = readText('src/lib/giving/receipt-errors.ts') ?? '';
const receiptErrorsTestSource = readText('src/lib/giving/receipt-errors.test.ts') ?? '';
const receiptCurrencySource = readText('src/lib/giving/receipt-currency.ts') ?? '';
const receiptCurrencyTestSource = readText('src/lib/giving/receipt-currency.test.ts') ?? '';
const refundMetadataSource = readText('src/lib/giving/refund-metadata.ts') ?? '';
const receiptAuditSource = readText('src/lib/giving/receipt-audit.ts') ?? '';
const receiptAuditTestSource = readText('src/lib/giving/receipt-audit.test.ts') ?? '';
const taxReceiptAuditHelperSource = readText('functions/src/shared/taxReceiptAudit.ts') ?? '';
const appSource = readText('src/App.tsx') ?? '';
const appTestSource = readText('src/App.test.ts') ?? '';
const givingScreenSource = readText('src/components/GivingScreen.tsx') ?? '';
const givingScreenTestSource = readText('src/components/GivingScreen.test.ts') ?? '';
const navigationSource = readText('src/app/navigation.ts') ?? '';
const emailVerificationGateSource = readText('src/components/app/EmailVerificationGate.tsx') ?? '';
const emailVerificationGateTestSource = readText('src/components/app/EmailVerificationGate.test.ts') ?? '';
const authenticatedAppSource = readText('src/components/app/AuthenticatedApp.tsx') ?? '';
const authenticatedAppTestSource = readText('src/components/app/AuthenticatedApp.test.ts') ?? '';
const appScreenContentSource = readText('src/components/app/AppScreenContent.tsx') ?? '';
const churchDomainSource = readText('src/domain/church.ts') ?? '';
const rolesSource = readText('src/domain/roles.ts') ?? '';
const rolesTestSource = readText('src/domain/roles.test.ts') ?? '';
const managementModelSource = readText('src/features/management/management-model.ts') ?? '';
const managementModelTestSource = readText('src/features/management/management-model.test.ts') ?? '';
const managementViewSource = readText('src/features/management/ManagementView.tsx') ?? '';
const managementInviteSheetSource = readText('src/features/management/ManagementInviteSheet.tsx') ?? '';
const managementInviteSheetTestSource = readText('src/features/management/ManagementInviteSheet.test.ts') ?? '';
const managementReceiptsSource = readText('src/features/management/ManagementReceiptsTab.tsx') ?? '';
const managementReceiptsTestSource = readText('src/features/management/ManagementReceiptsTab.test.ts') ?? '';
const localizationSource = readText('src/localization/extra.ts') ?? '';
const missionControlFormConnectSource = readText('src/components/mission-control/missionControlForm.ts') ?? '';
const missionControlFormConnectTestSource = readText('src/components/mission-control/missionControlForm.test.ts') ?? '';
const missionControlHookSource = readText('src/components/mission-control/useMissionControl.ts') ?? '';
const churchFormSheetSourceForPaymentSettings = readText('src/components/mission-control/ChurchFormSheet.tsx') ?? '';
const receiptActionsSource = readText('src/features/management/receipt-actions.ts') ?? '';
const receiptActionsTestSource = readText('src/features/management/receipt-actions.test.ts') ?? '';
const donorReceiptActionsSource = readText('src/lib/giving/donor-receipt-actions.ts') ?? '';
const donorReceiptActionsTestSource = readText('src/lib/giving/donor-receipt-actions.test.ts') ?? '';
const checkoutHelpersSource = readText('src/lib/giving/checkout.ts') ?? '';
const checkoutHelpersTestSource = readText('src/lib/giving/checkout.test.ts') ?? '';
const stripeConnectHelpersSource = readText('src/lib/stripe/connect.ts') ?? '';
const stripeConnectHelpersTestSource = readText('src/lib/stripe/connect.test.ts') ?? '';
const taxReceiptBatchSourceTestSource = readText('src/lib/tax-receipt-batch-source.test.ts') ?? '';
const managementViewHookSource = readText('src/features/management/useManagementView.ts') ?? '';
const functionsCallablesTestSource = readText('tests/functions/callables.test.ts') ?? '';
const functionsTaxReceiptAuditSource = readText('functions/src/shared/taxReceiptAudit.ts') ?? '';
const functionsTaxReceiptAuditTestSource = readText('tests/functions/taxReceiptAudit.test.ts') ?? '';
const taxReceiptPdfTestSource = readText('tests/functions/taxReceiptPdf.test.ts') ?? '';
const taxReceiptRetentionTestSource = readText('tests/functions/taxReceiptRetention.test.ts') ?? '';
const paymentOperationsReadinessHelpersSource =
  readText('src/lib/stripe/payment-operations-readiness.ts') ?? '';
const paymentOperationsReadinessHelpersTestSource =
  readText('src/lib/stripe/payment-operations-readiness.test.ts') ?? '';
const givingStatusSource = sourceSlice(
  givingDbSource,
  'export async function getGivingStatus',
  'export async function getTaxReceipt'
);
const managementIndividualReceiptSendSource = sourceSlice(
  managementViewHookSource,
  'const handleSendTaxReceipt',
  'const handleSendChurchAnnualTaxReceipts'
);
const managementBulkReceiptSendSource = sourceSlice(
  managementViewHookSource,
  'const handleSendChurchAnnualTaxReceipts',
  'const openEventEditor'
);
const missionControlAnalyticsSource = readText('src/components/mission-control/MissionControlAnalyticsTab.tsx') ?? '';
const missionControlAnalyticsTestSource =
  readText('src/components/mission-control/MissionControlAnalyticsTab.test.ts') ?? '';
const taxReceiptPdfSource = readText('functions/src/shared/taxReceiptPdf.ts') ?? '';
const taxReceiptRetentionSource = readText('functions/src/shared/taxReceiptRetention.ts') ?? '';
const emailTemplatesSource = readText('functions/src/shared/emailTemplates.ts') ?? '';
const emailTemplatesTestSource = readText('tests/functions/emailTemplates.test.ts') ?? '';
const storageRulesSource = readText('storage.rules') ?? '';
const firebaseRulesTestSource = readText('tests/firebase/rules.test.ts') ?? '';
const functionsClientsTestSource = readText('tests/functions/clients.test.ts') ?? '';
const taxReceiptIssuanceStateSource = sourceSlice(
  churchDomainSource,
  'export function getTaxReceiptIssuanceState',
  'export function isTaxReceiptIssuanceReady'
);
record(
  includesEvery(authProfileBootstrapSource, [
    'export async function bootstrapUserProfileDocument',
    'await userRef.create({',
    "taxReceiptLegalName: '',",
    'taxReceiptAddress: {',
    'function isAlreadyExistsError',
    "code === 6 || code === 'already-exists' || code === 'ALREADY_EXISTS'",
    "return 'skipped_existing';",
    "return 'skipped_no_email';",
    'bootstrapUserProfileOnCreate',
  ])
  && functionsIndexSource.includes("export { bootstrapUserProfileOnCreate } from './onUserCreated';")
  && includesEvery(profileDbSource, [
    'export function buildUserProfileRepairPatch',
    'if (!isStringWithin(current.taxReceiptLegalName, MAX_TAX_RECEIPT_LEGAL_NAME_LENGTH))',
    'if (!isValidTaxReceiptAddress(current.taxReceiptAddress))',
    'await setDoc(ref, buildUserProfileRepairPatch(existing.data(), data), { merge: true });',
    'taxReceiptAddress: EMPTY_TAX_RECEIPT_ADDRESS',
  ])
  && includesEvery(authProfileBootstrapTestSource, [
    'creates new profiles with blank private tax receipt fields',
    'skips existing profile documents without overwriting donor receipt identity',
    'recognizes string already-exists errors from alternate Firestore runtimes',
    'does not create a profile for auth users without email addresses',
    'rethrows unexpected Firestore write failures',
  ])
  && projectDetailsSource.includes('create-only Firestore write and skips existing docs')
  && productionChecklistSource.includes('create-only Firestore write and skips existing user docs'),
  'Auth profile bootstrap creates missing donor profiles without overwriting private tax receipt identity'
);
record(
  includesEvery(appUrlSource, [
    'export function stripeReturnAppUrlReadiness(',
    'export function configuredStripeReturnAppUrl(',
    'runtimeValid: false',
    "errorCode: 'app_url_invalid'",
    "errorCode: 'app_url_not_base_url'",
    "errorCode: 'app_url_not_https'",
    "process.env.FUNCTIONS_EMULATOR === 'true'",
    "'localhost'",
    "'127.0.0.1'",
    'requires APP_URL to be a valid URL.',
    'requires APP_URL to be an HTTPS URL.',
    'requires APP_URL to be a base URL without credentials, query, or fragment.',
  ])
  && includesAny(givingSource, [
    "import { configuredStripeReturnAppUrl } from '../shared/appUrl';",
    "import { configuredStripeReturnAppUrl } from '../../shared/appUrl';",
  ])
  && givingSource.includes("configuredStripeReturnAppUrl(process.env.APP_URL, DEFAULT_APP_URL, 'Stripe Checkout')")
  && includesEvery(superAdminSource, [
    "import { configuredStripeReturnAppUrl, stripeReturnAppUrlReadiness } from '../shared/appUrl';",
    "configuredStripeReturnAppUrl(\n    process.env.APP_URL,\n    'https://app.kandilo.org',\n    'Stripe Connect onboarding'\n  )",
    "stripeReturnAppUrlReadiness(process.env.APP_URL, 'https://app.kandilo.org')",
    '&& appUrl.configured\n      && appUrl.runtimeValid',
    'if (error instanceof HttpsError) {\n        throw error;\n      }',
  ])
  && includesEvery(functionsClientsTestSource, [
    "import { configuredStripeReturnAppUrl, stripeReturnAppUrlReadiness } from '../../functions/src/shared/appUrl';",
    "requires HTTPS APP_URL outside the Functions emulator",
    "allows local HTTP APP_URL only inside the Functions emulator",
    "expect(configuredStripeReturnAppUrl('http://localhost:3000/', 'https://app.kandilo.org', 'Stripe Checkout'))",
    "expect(stripeReturnAppUrlReadiness('http://localhost:3000/', 'https://app.kandilo.org'))",
    "expect(() => configuredStripeReturnAppUrl('http://app.example.com', 'https://app.kandilo.org', 'Stripe Checkout'))",
    "Stripe Checkout requires APP_URL to be a base URL without credentials, query, or fragment.",
  ]),
  'Stripe Checkout and Connect onboarding return URLs fail closed for invalid or non-HTTPS APP_URL outside local Functions emulators'
);
record(
  includesEvery(clientsSource, [
    'export function resendApiKeyLooksValid(apiKey: string): boolean',
    'export function resendConfigurationErrorCode(error: unknown): ResendConfigurationErrorCode | null',
    "apiKey.trim().startsWith('re_')",
    "throw new ResendConfigurationError('resend_api_key_missing'",
    "throw new ResendConfigurationError(\n      'resend_api_key_invalid_format'",
    'RESEND_API_KEY has invalid format.',
    'function assertEmulatorResendEmailContract(payload: unknown, options: unknown): void',
    'tax receipt provider idempotency key',
  ])
  && includesEvery(superAdminSource, [
    'resendApiKeyLooksValid(resendApiKey)',
    'resend_api_key_invalid_format',
    'stripeSecretKeyMode(stripeSecretKey)',
    'stripeWebhookSecretLooksValid(stripeWebhookSecret)',
    'stripe_secret_key_unrecognized_mode',
    'stripe_webhook_secret_invalid_format',
  ])
  && includesEvery(functionsClientsTestSource, [
    "expect(resendApiKeyLooksValid('re_live_valid')).toBe(true);",
    "expect(resendApiKeyLooksValid('sk_live_wrong_provider')).toBe(false);",
    "expect(resendConfigurationErrorCode(error)).toBe('resend_api_key_missing');",
    "expect(resendConfigurationErrorCode(error)).toBe('resend_api_key_invalid_format');",
    "expect(resendConfigurationErrorCode(new Error('plain error'))).toBeNull();",
    'requires tax receipt provider idempotency keys in Functions emulator test mode',
    "expect(stripeSecretKeyMode('sk_live_valid')).toBe('live');",
    "expect(stripeSecretKeyMode('not_a_stripe_key')).toBe('unknown');",
    "expect(stripeWebhookSecretLooksValid('whsec_valid')).toBe(true);",
    "expect(() => getStripe()).toThrow('STRIPE_SECRET_KEY has invalid format.');",
  ])
  && includesEvery(givingSource, [
    "resendConfigurationErrorCode(error) ?? 'tax_receipt_send_failed'",
    "resendConfigurationErrorCode(receiptError) ?? 'receipt_send_failed'",
  ])
  && includesEvery(receiptErrorsSource, [
    "case 'resend_api_key_missing':",
    "case 'resend_api_key_invalid_format':",
    "case 'tax_receipt_missing_email_or_amount':",
    "case 'tax_receipt_donor_profile_incomplete':",
    "case 'tax_receipt_pdf_failed':",
    "case 'tax_receipt_provider_rejected':",
    "case 'tax_receipt_setup_required':",
    "case 'tax_receipt_unsupported_jurisdiction':",
	    "case 'receipt_audit_issue':",
	    "case 'tax_receipt_issue_failed':",
	    "case 'tax_receipt_invalid_currency':",
	    "case 'stripe_partial_refund_review_required':",
    'partialRefundReview',
    "case 'tax_receipt_preparation_failed':",
    'callableReceiptDeliveryErrorMessage',
    'receiptBatchFailureReason',
  ])
  && includesEvery(receiptErrorsTestSource, [
    "expect(receiptDeliveryErrorMessage('resend_api_key_missing', messages)).toBe('email missing');",
    "expect(receiptDeliveryErrorMessage('tax_receipt_donor_profile_incomplete', messages)).toBe('profile missing');",
    "expect(receiptDeliveryErrorMessage('tax_receipt_setup_required', messages)).toBe('setup required');",
    "expect(receiptDeliveryErrorMessage('tax_receipt_unsupported_jurisdiction', messages))",
	    "expect(receiptDeliveryErrorMessage('receipt_audit_issue', messages)).toBe('receipt issue');",
	    "expect(receiptDeliveryErrorMessage('tax_receipt_issue_failed', messages)).toBe('receipt issue');",
	    "expect(receiptDeliveryErrorMessage('tax_receipt_invalid_currency', messages)).toBe('receipt issue');",
	    "expect(receiptDeliveryErrorMessage('stripe_partial_refund_review_required', messages))",
    "expect(receiptDeliveryErrorMessage('tax_receipt_preparation_failed', messages)).toBe('fallback');",
    "expect(callableReceiptDeliveryErrorCode(error)).toBe('resend_api_key_invalid_format');",
    "expect(receiptBatchFailureReason([{ code: 'internal' }, { code: 'resend_api_key_missing' }], messages))",
    "expect(receiptBatchFailureReason([{ code: 'receipt_audit_issue' }], messages)).toBe('receipt issue');",
    "expect(receiptBatchFailureReason([{ code: 'tax_receipt_setup_required' }], messages))",
    "expect(receiptBatchFailureReason([{ code: 'tax_receipt_unsupported_jurisdiction' }], messages))",
    "expect(receiptBatchFailureReason([{ code: 'stripe_partial_refund_review_required' }], messages))",
    "userId: 'private-donor'",
  ])
  && includesEvery(givingScreenSource, [
    'callableReceiptDeliveryErrorMessage(error, receiptDeliveryErrorMessages)',
    'missingDonorProfile: extra.taxReceiptMissingDonorProfile',
    'genericIssue: extra.taxReceiptGenericIssue',
    'partialRefundReview: extra.taxReceiptPartialRefundReview',
    'setupRequired: extra.taxReceiptUnavailable',
    'unsupportedJurisdiction: extra.taxReceiptUnsupportedJurisdiction',
    'receiptDeliveryErrorMessage(',
  ])
  && includesEvery(managementViewHookSource, [
    'callableReceiptDeliveryErrorMessage(error, receiptDeliveryErrorMessages)',
    'missingDonorProfile: copy.receipts.missingDonorProfile',
    'genericIssue: copy.receipts.genericIssue',
    'partialRefundReview: copy.receipts.partialRefundReview',
    'setupRequired: copy.receipts.setupRequired',
    'unsupportedJurisdiction: copy.receipts.unsupportedJurisdictionSetupRequired',
    'receiptBatchFailureReason(result.failures, receiptDeliveryErrorMessages)',
  ])
  && includesEvery(managementReceiptsSource, [
    'missingDonorProfile: t.missingDonorProfile',
    'genericIssue: t.genericIssue',
    'partialRefundReview: t.partialRefundReview',
    'setupRequired: t.setupRequired',
    'unsupportedJurisdiction: t.unsupportedJurisdiction',
    'record.taxReceiptEmailError || record.taxReceiptError',
    'receiptDeliveryErrorMessage(',
  ])
  && includesEvery(givingDbSource, [
    'taxReceiptEmailError: string;',
    "taxReceiptEmailError: typeof data.taxReceiptEmailError === 'string' ? data.taxReceiptEmailError : ''",
  ]),
  'Stripe/Resend clients, SuperAdmin readiness, and receipt UIs share non-secret credential format guards and safe delivery error messages'
);
record(
  includesEvery(managementIndividualReceiptSendSource, [
    'const handleSendTaxReceipt',
    'const handleSendCorrectedTaxReceipt',
    'const handleSendAnnualTaxReceipt',
    'const handleSendCorrectedAnnualTaxReceipt',
  ])
  && !managementIndividualReceiptSendSource.includes('copy.receipts.setupRequired')
  && includesEvery(managementBulkReceiptSendSource, [
    'const handleSendChurchAnnualTaxReceipts = async (',
    'const handleSendChurchCorrectedAnnualTaxReceipts = async (',
    'acknowledgePreviouslyReceipted = false',
    'acknowledgePreviouslyReceipted,',
    'receiptSetupRequiredMessage',
    'setReceiptRecordsError(receiptSetupRequiredMessage)',
  ])
  && includesEvery(managementReceiptsSource, [
    'Summary mirrors intentionally omit covered giving IDs; the callable performs the exact duplicate guard.',
    'givingReceiptActionAvailability(',
    'unsupportedJurisdiction: recordUnsupportedJurisdiction',
    "taxReceiptIssuanceUnsupported: taxReceiptIssuanceState === 'unsupported_jurisdiction'",
    'coveredByAnnualReceiptOnly',
    't.unsupportedJurisdiction',
    't.includedInAnnual',
    'const singleReceiptAlreadySent = record.taxReceiptStatus === \'sent\';',
    'singleReceiptAlreadySent',
    't.resend',
      'DONOR_PROFILE_INCOMPLETE_ERROR',
      'const donorProfileIncomplete = !hasExistingSendableReceipt',
      't.donorProfileNeeded',
      't.retrySend',
      'profileIncomplete: summary.emailError === DONOR_PROFILE_INCOMPLETE_ERROR',
      'const annualProfileIncomplete',
      'candidate.profileIncomplete',
      'candidate.hasMixedCurrency',
      't.mixedCurrencyAnnualBlocked',
      'normalizedTaxReceiptCurrency(currency)',
      'hasMixedCurrency: !initialCurrency',
      'summaryInvalidCurrency',
      'candidate.hasCorrectablePartialRefund',
    'summaryUnsupportedJurisdiction',
    'const annualReceiptAlreadySent = summary?.status === \'sent\'',
    'const correctedAnnualReceiptAlreadySent = annualReceiptAlreadySent',
    'annualReceiptAlreadySent',
    't.resendAnnual',
    't.resendCorrectedAnnual',
    'The corrected annual batch is year-wide and privacy-preserving',
	  ])
	  && includesEvery(refundMetadataSource, [
	    'export function givingHasPartialRefundSignal',
	    "record.stripeRefundStatus === PARTIAL_REFUND_STATUS",
	    'export function givingHasCorrectablePartialRefundMetadata',
	    'refundedCents < originalCents',
	  ])
	  && includesEvery(receiptActionsSource, [
      'export function givingReceiptActionAvailability',
      'UNSUPPORTED_JURISDICTION_ERROR',
      'givingUnsupportedJurisdiction',
      'normalizedTaxReceiptCurrency(record.currency)',
      'invalidCurrency',
      'taxReceiptIssuanceUnsupported = false',
    'coveredByAnnualReceipt = false',
    'const coveredByAnnualReceiptOnly = coveredByAnnualReceipt && !hasExistingSendableReceipt',
    'hasAssignedTaxReceiptNumber(record.taxReceiptNumber)',
    'missingAssignedReceiptNumber',
    '&& !missingAssignedReceiptNumber',
    'taxReceiptIssuanceReady || hasExistingSendableReceipt',
    '&& !coveredByAnnualReceiptOnly',
	    'givingHasPartialRefundSignal(record)',
	    'givingHasCorrectablePartialRefundMetadata(record)',
      'export function annualReceiptActionAvailability',
      'summaryUnsupportedJurisdiction',
      'summaryInvalidCurrency',
      'amounts.taxReceiptIssuanceUnsupported',
      'MISSING_EMAIL_OR_AMOUNT_ERROR',
      'annualSummaryIssuanceGapRetryable',
      'summaryIssuanceGapRetryable',
      'annualSummaryDeliveryFailureRetryable',
      'summaryDeliveryFailureRetryable',
      'summaryMissingAssignedReceiptNumber',
      'hasAssignedTaxReceiptNumber(summary.receiptNumber)',
      'summaryMatchesCurrentPartialRefundCorrection',
      'partialRefundCorrectionSettled',
      'candidateAmountCents?: number',
      'candidateEligibleAmountCents?: number',
      'candidateHasMixedCurrency: boolean',
      'candidateHasPartialRefund: boolean',
      "summary.status === 'issued' || summary.status === 'sent'",
      '&& (!candidateHasPartialRefund || partialRefundCorrectionSettled)',
      '|| (candidateNeedsReview && !summaryReissueAvailable && !partialRefundCorrectionSettled)',
      'const canIssuePartialRefundCorrection',
	    '!candidateHasEligibleGiving',
      '!candidateHasMixedCurrency',
      'taxReceiptIssuanceReady || summarySettled',
  ])
  && includesEvery(receiptActionsTestSource, [
    'requires current receipt setup before sending a new single-donation receipt',
    'allows re-sending existing single-donation receipts when new issuance setup is no longer ready',
    'does not treat unassigned single receipt numbers as resendable receipt evidence',
    'blocks receipt-manager resends for unsupported-jurisdiction stored single receipts',
    'blocks receipt-manager legacy single resends when church receipt jurisdiction is unsupported',
    'blocks receipt-manager resends for unsupported-jurisdiction annual summaries',
    'blocks receipt-manager legacy annual resends when church receipt jurisdiction is unsupported',
    'blocks new single-donation sends already covered by a settled annual receipt',
	    'blocks stale single-donation resends after partial refunds until corrected issuance is available',
	    'treats Stripe partial-refund metadata as a correction signal before the review code is mirrored',
    'keeps non-correctable Stripe refund metadata on the review-only path',
    'blocks single-donation receipt actions when the giving currency is missing or unsupported',
      'allows re-sending settled annual summaries when new issuance setup is no longer ready',
      'does not treat unassigned annual receipt numbers as settled or retryable',
      'keeps donor-profile annual errors retryable only when issuance setup is ready',
      'keeps verified-email annual retry summaries sendable after account verification',
      'keeps donor-profile corrected annual errors on the corrected-send path',
      'keeps verified-email corrected annual retry summaries on the corrected-send path',
      'allows retrying existing annual receipt delivery failures after provider or PDF setup is fixed',
      'blocks non-retryable annual error summaries instead of treating them as settled resends',
      'blocks retryable annual delivery errors when no stored receipt id exists',
      'blocks settled annual summary resends when current donor-year giving now needs review',
      'keeps settled annual partial-refund corrections resendable when they match the current net amount',
      'keeps stale annual partial-refund corrections in review when the current net amount changed',
    'requires current receipt setup before corrected annual summary issuance',
	    'trusts stored partial-refund annual summaries only when current giving is not loaded',
    'does not show corrected annual issuance for generic review states the backend cannot correct',
    'blocks annual receipt actions for mixed-currency donor years before calling the backend',
    'blocks annual receipt actions when stored summary currency is missing or unsupported',
    ])
    && managementReceiptsTestSource.includes('labels donor-profile-incomplete receipt rows as retryable without exposing donor details')
    && managementReceiptsTestSource.includes('labels donor-profile-incomplete annual summaries as retryable without exposing receipt contents')
    && managementReceiptsTestSource.includes('labels verified-email annual summaries as retryable without exposing receipt contents')
    && managementReceiptsTestSource.includes('keeps existing annual delivery failures retryable without exposing full receipt details')
    && localizationSource.includes('Donor profile needed')
  && localizationSource.includes('Retry send')
  && managementReceiptsTestSource.includes('does not infer exact single-donation annual coverage from a summary mirror alone')
  && managementReceiptsTestSource.includes('labels repeat receipt delivery as resend actions for receipt managers')
  && managementReceiptsTestSource.includes('renders annual summary rows even when recent giving records are capped out')
  && managementReceiptsTestSource.includes('does not offer settled annual resends when visible donor-year giving now needs correction')
  && managementReceiptsTestSource.includes('shows matching corrected annual partial-refund receipts as resendable instead of review-only')
	  && managementReceiptsTestSource.includes('shows the corrected annual batch action when settled annual donor-years now need partial-refund correction')
	  && managementReceiptsTestSource.includes('keeps corrected annual batch actions available without staff-visible partial-refund rows')
	  && managementReceiptsTestSource.includes('uses Stripe partial-refund metadata for corrected annual actions before the review code is mirrored')
	  && managementReceiptsTestSource.includes('keeps invalid partial-refund metadata review-only instead of advertising corrected sends')
	  && managementReceiptsTestSource.includes('does not trust annual summary correction reasons over invalid current refund metadata')
	  && managementReceiptsTestSource.includes('marks missing or unsupported-currency annual donor years for review instead of offering a consolidated send')
	  && !managementReceiptsSource.includes('annualCorrectionYears.has(year)')
    && includesEvery(receiptCurrencySource, [
      "const SUPPORTED_TAX_RECEIPT_CURRENCIES = new Set(['USD', 'CAD'])",
      'export function normalizedTaxReceiptCurrency',
      'export function displayTaxReceiptCurrency',
      'export function formatTaxReceiptAmount',
      'const normalizedCurrency = normalizedTaxReceiptCurrency(currency);',
      'return rawCurrency ? `${amount} ${rawCurrency}` : amount;',
    ])
    && includesEvery(receiptCurrencyTestSource, [
      'formats invalid receipt currencies without inventing a supported currency',
      "expect(formatTaxReceiptAmount(5000, 'EUR')).toBe('50.00 EUR');",
      "expect(formatTaxReceiptAmount(5000, '')).toBe('50.00');",
    ])
    && givingScreenSource.includes('formatTaxReceiptAmount(amountCents, currency)')
    && managementReceiptsSource.includes('formatTaxReceiptAmount(amountCents, currency)')
    && givingDbSource.includes("import { normalizedTaxReceiptCurrency } from '../giving/receipt-currency';")
    && firestoreMappersTestSource.includes('does not default missing or unsupported receipt currencies into USD')
    && projectDetailsSource.includes('Receipt-manager buttons label repeat delivery of already-sent single and annual receipts as resend actions')
  && projectDetailsSource.includes('Existing annual receipts that failed during retryable delivery work')
  && projectDetailsSource.includes('When current donor-year giving rows already show a partial-refund correction/review state')
	  && projectDetailsSource.includes('Corrected annual batch actions are also shown by closed year')
	  && projectDetailsSource.includes('treat Stripe partial-refund metadata itself as a correction signal')
	  && projectDetailsSource.includes('Corrected-send buttons are narrower')
	  && projectDetailsSource.includes('invalid current refund metadata wins over the summary mirror')
	  && projectDetailsSource.includes('A settled corrected annual receipt whose safe amount mirror matches the current net eligible donor-year amount remains resendable')
    && projectDetailsSource.includes('Annual summaries currently require one explicit supported currency per donor-year')
    && projectDetailsSource.includes('New single-donation receipt issuance also fails closed when a non-voided annual receipt already covers that giving ID')
    && projectDetailsSource.includes('Known donor-profile-incomplete rows are shown as donor profile needed and retryable')
    && projectDetailsSource.includes('Verified-email annual retry summaries are shown as ready/retry-send')
    && projectDetailsSource.includes('Manual annual and corrected annual send attempts that hit the missing-profile or missing-verified-email backend guard persist staff-safe annual summary error rows')
    && productionChecklistSource.includes('safe verified-email retry summaries sendable once receipt setup is ready')
    && productionChecklistSource.includes('mixed-currency or missing-currency donor-year annual rows are marked for review')
    && productionChecklistSource.includes('new single-donation receipt issuance fails closed when a non-voided annual receipt already covers that giving ID')
    && productionChecklistSource.includes('known donor-profile-incomplete receipt-manager rows show donor profile needed and retry send')
    && productionChecklistSource.includes('Manual receipt-manager annual and corrected annual send attempts that fail on the backend missing-profile or missing-verified-email guard persist staff-safe annual summary error rows')
    && productionChecklistSource.includes('Verified-email annual retry summaries should show ready/retry-send guidance'),
  'Receipt-manager individual sends can resend stored receipts when new issuance is not ready, show known donor-profile-incomplete rows as retryable without exposing donor details, avoid summary-based per-gift annual coverage inference while relying on the backend exact duplicate guard, keep corrected annual actions partial-refund scoped, fail closed for mixed- or missing-currency annual rows, and require current receipt setup for bulk sends'
);
record(
  includesEvery(givingSource, [
    "const TAX_RECEIPT_DONOR_PROFILE_INCOMPLETE_CODE = 'tax_receipt_donor_profile_incomplete';",
    'function requiredDonorTaxReceiptProfile',
    'taxReceiptLegalName',
    'donorTaxReceiptAddressComplete',
    'errorCode: TAX_RECEIPT_DONOR_PROFILE_INCOMPLETE_CODE',
    'TAX_RECEIPT_SETUP_REQUIRED_CODE',
    '{ errorCode: TAX_RECEIPT_SETUP_REQUIRED_CODE }',
    'const donorProfile = requiredDonorTaxReceiptProfile(user);',
    'donorName: donorProfile.donorName',
    'donorAddress: donorProfile.donorAddress',
    'function churchRequiresTaxReceiptProfileBeforeCheckout',
    'requiredDonorTaxReceiptProfile(donorProfileSnap.data() ?? {})',
    'const isDonorProfileIncomplete = detailCode === TAX_RECEIPT_DONOR_PROFILE_INCOMPLETE_CODE;',
    'const isRecoverableIssuanceGap =',
    'const isReceiptSetupUnavailable =',
    "isRecoverableIssuanceGap\n          ? 'ready'",
    "publicTaxReceiptAuditCode(detailCode) || TAX_RECEIPT_ISSUE_FAILED_CODE",
      'function taxReceiptIssueFailureGivingUpdate',
      'persistTaxReceiptIssueFailureForGiving(givingRef, giving, error);',
      'function persistAnnualTaxReceiptIssueFailureSummary',
      "persistAnnualTaxReceiptIssueFailureSummary(churchId, targetUserId, year, 'annual', error);",
      "persistAnnualTaxReceiptIssueFailureSummary(churchId, userId, year, 'correctedAnnual', error);",
      "receiptId: '',",
      'TAX_RECEIPT_DONOR_PROFILE_INCOMPLETE_CODE',
      'TAX_RECEIPT_MISSING_EMAIL_OR_AMOUNT_CODE',
    ])
    && includesEvery(functionsCallablesTestSource, [
      'leaves auto-issued donations ready until the donor legal receipt profile is complete',
      'leaves auto-issued donations ready until the donor Auth email is verified',
      'persists a safe setup-required code when auto tax receipt setup is incomplete',
      'persists donor-profile-required state after manual receipt send attempts',
      'persists staff-safe annual donor-profile-required summaries after annual send attempts',
      'persists staff-safe annual verified-email-required summaries after annual send attempts',
      'persists staff-safe corrected annual donor-profile-required summaries after corrected annual send attempts',
      'requires verified email before creating hosted Stripe checkout sessions',
      'requires donor receipt profile before creating Checkout when tax receipts are ready',
      "taxReceiptError: 'tax_receipt_donor_profile_incomplete'",
      "taxReceiptError: 'tax_receipt_missing_email_or_amount'",
      "taxReceiptError: 'tax_receipt_setup_required'",
      "expect(JSON.stringify(setupRequiredGiving)).not.toContain('legal receipt address');",
      "errorCode: 'tax_receipt_donor_profile_incomplete'",
      "errorCode: 'tax_receipt_missing_email_or_amount'",
      "errorCode: 'tax_receipt_setup_required'",
    "donorName: 'Member Legal Donor'",
  ])
  && includesEvery(profileDbSource, [
    'export function sanitizeTaxReceiptProfileInput',
    'export async function updateUserTaxReceiptProfile',
    "await updateDoc(doc(db, 'users', uid), safeData);",
  ])
  && includesEvery(profileDbTestSource, [
    'trims and bounds receipt-only profile updates without directory fields',
    'sanitizeTaxReceiptProfileInput',
  ])
  && includesEvery(givingScreenSource, [
    "const TAX_RECEIPT_DONOR_PROFILE_INCOMPLETE_CODE = 'tax_receipt_donor_profile_incomplete';",
    "import { sendEmailVerificationEmail } from '../lib/api/auth';",
    'updateUserTaxReceiptProfile',
    'const [taxReceiptProfileForm, setTaxReceiptProfileForm] = useState<',
    'const handleSaveTaxReceiptProfile = async () => {',
    'await updateUserTaxReceiptProfile(currentUser.uid, taxReceiptProfileForm);',
    'setTaxReceiptProfileMessage(extra.taxReceiptProfileIncomplete);',
    'const currentUserNeedsEmailVerification = Boolean(',
    'currentUser.emailVerified !== true',
    'const [emailVerificationChecking, setEmailVerificationChecking] = useState(false);',
    'const [emailVerificationRefreshKey, setEmailVerificationRefreshKey] = useState(0);',
    'const handleSendEmailVerification = async () => {',
    'await sendEmailVerificationEmail();',
    'const handleCheckEmailVerification = async () => {',
    'await currentUser.reload();',
    'setEmailVerificationRefreshKey((current) => current + 1);',
    'const blockUntilEmailVerified = (setPrimaryMessage: (message: string) => void): boolean => {',
    'if (!currentUser || currentUser.isAnonymous || currentUser.emailVerified !== true) {',
    '}, [currentUser, emailVerificationRefreshKey]);',
    '&& currentUser.emailVerified === true;',
    'const taxReceiptProfileBlocksReceiptIssuance = Boolean(',
    'const taxReceiptProfileBlocksCheckout = taxReceiptProfileBlocksReceiptIssuance;',
    'const taxReceiptProfileRequiredMessage =',
    'const checkoutPrerequisiteBlocked =',
    'currentUserNeedsEmailVerification || taxReceiptProfileBlocksCheckout',
    'const checkoutPrerequisiteActionLabel = currentUserNeedsEmailVerification',
    'if (blockUntilEmailVerified(setCheckoutMessage)) {',
    'if (taxReceiptProfileBlocksCheckout) {',
    'if (blockUntilEmailVerified(setReceiptMessage)) {',
    'if (requiresReceiptProfile && taxReceiptProfileBlocksReceiptIssuanceForChurch(receiptChurchId)) {',
    'if (requiresReceiptProfile && taxReceiptProfileBlocksReceiptIssuanceForChurch(churchId)) {',
    'receiptSendBlockedByProfile',
    'disabled={sending || receiptSendBlockedByProfile}',
    'annualSendBlockedByProfile',
    'setTaxReceiptProfileMessage(',
    'extra.taxReceiptProfileRequired',
    'const renderEmailVerificationPrompt = (className = \'\') => {',
    'renderEmailVerificationPrompt(\'mb-4\')',
    'aria-disabled={checkoutPrerequisiteBlocked}',
    '{checkoutPrerequisiteActionLabel || t.continuePayment}',
    '{checkoutPrerequisiteBlocked && (',
    '{renderTaxReceiptProfilePrompt(true)}',
    '{checkoutPrerequisiteActionLabel || extra.completeSecureCheckout}',
    'profileExtra.taxReceiptLegalName',
    "setTaxReceiptAddressField('line1', event.target.value)",
    'const donorReceiptDeliveryErrorMessage = (',
      'safeReceiptErrorCode(errorCode) === TAX_RECEIPT_DONOR_PROFILE_INCOMPLETE_CODE',
      '&& !taxReceiptProfileBlocksReceiptIssuanceForChurch(churchId)',
      'donorReceiptDeliveryErrorMessage(',
      'const annualProfileIncomplete =',
      'annualReceiptErrorCode',
      'taxReceiptProfileBlocksReceiptIssuanceForChurch(record.churchId)',
    'record.taxReceiptError === TAX_RECEIPT_DONOR_PROFILE_INCOMPLETE_CODE',
    'extra.taxReceiptProfileNeeded',
    'taxReceiptProfileMissing',
    'taxReceiptProfileRequiredAction',
    'taxReceiptProfileSave',
    'taxReceiptMissingDonorProfile',
    'emailVerificationContinueAction',
    'emailVerificationRequiredAction',
    'emailVerificationCheckAction',
    'emailVerificationStillPending',
  ])
  && includesEvery(appSource, [
    "const EmailVerificationGate = lazy(() => import('./components/app/EmailVerificationGate'));",
    'const [emailVerificationRefreshKey, setEmailVerificationRefreshKey] = useState(0);',
    'if (!user.isAnonymous && user.emailVerified !== true) {',
    'key={`${user.uid}:${emailVerificationRefreshKey}`}',
    'onVerified={() => setEmailVerificationRefreshKey((current) => current + 1)}',
  ])
  && includesEvery(emailVerificationGateSource, [
    "import { sendEmailVerificationEmail } from '../../lib/api/auth';",
    "import { signOut } from '../../lib/auth';",
    'const handleSendVerification = async () => {',
    'const result = await sendEmailVerificationEmail();',
    'await user.reload().catch(() => undefined);',
    'const handleCheckVerification = async () => {',
    'await user.reload();',
    'confirmIfVerified(user.emailVerified === true);',
    'onVerified();',
    'void signOut()',
    't.emailVerificationBody',
  ])
  && givingScreenTestSource.includes('lets donors save private legal receipt details inline before Stripe checkout')
  && givingScreenTestSource.includes('shows missing donor receipt profile guidance beside receipt-history send actions')
  && givingScreenTestSource.includes('requires saved receipt details before Stripe checkout when receipt issuance is ready')
  && givingScreenTestSource.includes('requires verified email before Stripe checkout and receipt self-service')
  && givingScreenTestSource.includes('keeps existing receipt resends available while blocking new issuance until receipt details are saved')
  && appTestSource.includes('keeps unverified email accounts out of Firestore-backed app screens')
  && emailVerificationGateTestSource.includes('lets signed-in users resend and refresh account email verification before app data loads')
  && includesEvery(localizationSource, [
    'Kandilo requires a verified account email before opening parish data, invitations, donations, and official tax receipt tools.',
    'Save your legal name and mailing address before checkout so an official receipt can be emailed after donation.',
    'Legal name, address line 1, city, state/province, postal code, and country are required.',
    'Save your legal receipt details before continuing to Stripe so your official receipt can be emailed immediately after donation.',
    'Save receipt details to continue',
    'Email verification required',
    'Verify your account email before donating so Kandilo can send payment and tax receipts to your confirmed address.',
    'Send verification email',
    'Verify email to continue',
    "I've verified",
    'Email is not verified yet. Open the link in the verification email, then check again.',
    'Receipt profile needed',
    'The donor must complete their private legal receipt name and mailing address before this receipt can be emailed.',
  ])
  && projectDetailsSource.includes('Official receipt issuance now fails closed until the donor private profile has a legal receipt name and complete mailing address')
  && projectDetailsSource.includes("New official receipt issuance requires the donor's verified Firebase Auth email")
  && projectDetailsSource.includes('Auto-issue and manual single/annual send attempts that fail this verified-email guard persist only safe retry state')
  && projectDetailsSource.includes('App routing now holds unverified signed-in accounts on an email-verification gate before loading invitation acceptance or Firestore-backed parish screens')
  && projectDetailsSource.includes('Donor checkout and donor receipt self-service also preflight unverified Auth email in the Giving UI')
  && projectDetailsSource.includes('provide an explicit check-again action after the donor opens the verification link')
  && projectDetailsSource.includes('avoid Firestore receipt/profile reads that rules will deny while the account is still unverified')
  && projectDetailsSource.includes('requires the donor to save legal name/address details inline before Stripe Checkout')
  && projectDetailsSource.includes('payment review step mirrors the same checkout prerequisite prompts and action label')
  && projectDetailsSource.includes('The same profile gate now runs inside the Checkout callable before Stripe is initialized or any `giving` / `givingPaymentMetadata` records are written')
  && projectDetailsSource.includes('donor receipt history applies the same profile and verified-email gates to new single, corrected, annual, and corrected annual issuance actions')
  && projectDetailsSource.includes('labels currently profile-blocked ready receipts as receipt profile needed')
  && projectDetailsSource.includes('returns them to the normal available state as soon as the private profile is complete')
  && projectDetailsSource.includes('Stale donor-profile warning copy is also suppressed once the current private profile is complete')
  && projectDetailsSource.includes('Manual single-receipt send attempts that hit the same missing-profile backend guard persist the same safe retryable row state')
  && productionChecklistSource.includes('Official receipt issuance now fails closed until the donor private profile has a legal receipt name and complete mailing address')
  && productionChecklistSource.includes("new official receipt issuance requires the donor's verified Firebase Auth email")
  && productionChecklistSource.includes('Auto-issue and manual single/annual send attempts that fail this verified-email guard should persist only safe retry state')
  && productionChecklistSource.includes('Confirm app routing holds unverified signed-in accounts on the email-verification gate before loading invitation acceptance or Firestore-backed parish screens')
  && productionChecklistSource.includes('donor checkout details step requires donors to save those private receipt fields inline before Stripe Checkout')
  && productionChecklistSource.includes('donor payment review step mirrors the checkout prerequisite prompts and action label')
  && productionChecklistSource.includes('the backend Checkout callable enforces the same profile gate before Stripe initialization and before writing `giving` / `givingPaymentMetadata` records')
  && productionChecklistSource.includes('Confirm donor Giving blocks checkout and donor self-service receipt actions for unverified accounts before calling Stripe/receipt callables')
  && productionChecklistSource.includes('shows resend-verification guidance plus a check-again action after the donor opens the email link')
  && productionChecklistSource.includes('avoids denied receipt/profile Firestore reads while the account is unverified')
  && productionChecklistSource.includes('donor receipt-history rows with `taxReceiptError=\'tax_receipt_donor_profile_incomplete\'` show `Receipt profile needed` beside the existing private-profile prompt only while the current private receipt profile is incomplete/loading')
  && productionChecklistSource.includes('return to the normal available state and suppress stale donor-profile warning copy after the donor saves those private details')
  && productionChecklistSource.includes('Manual receipt-manager single-send attempts that fail on the backend missing-profile guard persist the same safe retryable row state')
  && productionChecklistSource.includes('donor receipt-history new-issuance actions use the same profile gate while preserving resends of already-issued stored receipts')
  && emailStandardSource.includes('New official receipt issuance also requires a verified Firebase Auth email for the donor')
  && emailStandardSource.includes('Auto-issue and manual single/annual send attempts that hit this verified-email guard persist only safe retry state')
  && emailStandardSource.includes('App routing blocks unverified signed-in accounts before invitation acceptance or Firestore-backed parish screens')
  && emailStandardSource.includes('the donor UI blocks Checkout/self-service receipt sends for unverified Auth, offers branded verification email resend, and lets donors check verification again after opening the email link')
  && localizationSource.includes('Ask the donor to verify their account email, and confirm the donation amount before retrying.')
  && includesEvery(sharedSecuritySource, [
    'export async function getPrimaryVerifiedEmailsForUids',
    'user.emailVerified === true',
  ])
  && includesEvery(givingSource, [
    'getPrimaryVerifiedEmailsForUids',
    'missingEmailOrAmountReceiptExists',
    'The donor needs a verified email address before a tax receipt can be issued.',
    'The donor needs a verified email address before a corrected annual tax receipt can be issued.',
  ])
  && functionsCallablesTestSource.includes('requires a verified donor Auth email before issuing a new official receipt'),
  'Official receipt issuance requires donor private legal receipt name/address and verified Auth email before issuing, blocks receipt-ready Stripe checkout until those details are saved, labels profile-blocked donor receipt rows explicitly, and keeps new receipt send actions profile-aware without blocking existing receipt resends'
);
record(
  /onSendAnnualReceipt=\{\(userId, year, acknowledgePreviouslyReceipted\)\s*=>\s*void management\.handleSendAnnualTaxReceipt\(userId, year, acknowledgePreviouslyReceipted\)\}/.test(managementViewSource)
  && /onSendCorrectedAnnualReceipt=\{\(userId, year, acknowledgePreviouslyReceipted\)\s*=>\s*void management\.handleSendCorrectedAnnualTaxReceipt\(userId, year, acknowledgePreviouslyReceipted\)\}/.test(managementViewSource)
  && /onSendChurchAnnualReceipts=\{\(year, acknowledgePreviouslyReceipted\)\s*=>\s*void management\.handleSendChurchAnnualTaxReceipts\(year, acknowledgePreviouslyReceipted\)\}/.test(managementViewSource)
  && /onSendChurchCorrectedAnnualReceipts=\{\(year, acknowledgePreviouslyReceipted\)\s*=>\s*void management\.handleSendChurchCorrectedAnnualTaxReceipts\(year, acknowledgePreviouslyReceipted\)\}/.test(managementViewSource)
  && includesEvery(managementReceiptsSource, [
    'onSendAnnualReceipt: (userId: string, year: number, acknowledgePreviouslyReceipted?: boolean) => void;',
    'onSendCorrectedAnnualReceipt: (userId: string, year: number, acknowledgePreviouslyReceipted?: boolean) => void;',
    'onSendChurchAnnualReceipts: (year: number, acknowledgePreviouslyReceipted?: boolean) => void;',
    'onSendChurchCorrectedAnnualReceipts: (year: number, acknowledgePreviouslyReceipted?: boolean) => void;',
    'const [pendingAnnualSend, setPendingAnnualSend] = useState<',
    'const confirmAnnualSend =',
    'needsPreviouslyReceiptedAcknowledgement',
    'pendingAnnualSend?.kind !== kind || pendingAnnualSend.key !== annualKey',
    'setPendingAnnualSend({ kind, key: annualKey });',
    'onSendAnnualReceipt(userId, year, needsPreviouslyReceiptedAcknowledgement);',
    'onSendCorrectedAnnualReceipt(userId, year, needsPreviouslyReceiptedAcknowledgement);',
    'onSendChurchAnnualReceipts(year, true);',
    'onSendChurchCorrectedAnnualReceipts(year, true);',
    'pendingBulkSend &&',
    't.previouslyReceiptedAckRequired',
    't.confirmAnnualSend',
    't.confirmCorrectedAnnualSend',
    't.confirmSendAllAnnual',
    't.confirmSendAllCorrectedAnnual',
    'candidate.includesPreviouslyReceipted || summary?.includesPreviouslyReceipted === true',
    'needsPreviouslyReceiptedAcknowledgement && (',
    '|| givingHasExistingSendableReceipt(record)',
    'aria-pressed={confirmingCurrentAction}',
    't.annualBatchPrivacyNote',
  ])
  && includesEvery(managementReceiptsTestSource, [
    'requires explicit confirmation before acknowledging previously receipted annual sends',
    'flags receipt-number-only annual candidates as previously receipted',
    'does not flag unassigned receipt-number annual candidates as previously receipted',
    'shows the annual duplicate-claim warning when only the summary mirror has the flag',
    'pendingAnnualSend',
    'onSendChurchAnnualReceipts(year, true);',
    'pendingBulkSend &&',
    'confirmAnnualSend',
    'keeps individual annual confirmation labels separate from batch confirmation labels',
    'Confirm annual send',
    'Confirm all annual',
  ])
  && includesEvery(localizationSource, [
    'annualBatchPrivacyNote: string;',
    'confirmAnnualSend: string;',
    'confirmCorrectedAnnualSend: string;',
    'confirmSendAllAnnual: string;',
    'confirmSendAllCorrectedAnnual: string;',
    'Bulk annual and corrected annual sends also include eligible privacy-protected donor-years',
  ]),
  'Receipt-manager annual sends require explicit acknowledgement for previously receipted gifts and disclose privacy-protected batch scope without exposing donor details'
);
record(
  includesEvery(givingScreenSource, [
    'donorGivingReceiptActionAvailability(',
    'matchedTaxReceipt,',
    'unsupportedJurisdiction: recordUnsupportedJurisdiction',
    'receiptActionContextForChurch(record.churchId)',
    "activeChurchTaxReceiptUnsupported: taxReceiptStateForChurch(churchId) === 'unsupported_jurisdiction'",
    "taxReceiptIssuanceUnsupported: annualTaxReceiptState === 'unsupported_jurisdiction'",
    'donorTaxReceiptActionAvailability(receipt,',
    'donorAnnualReceiptActionAvailability(',
    'candidateAmountCents: row.candidateAmountCents',
    'candidateEligibleAmountCents: row.candidateEligibleAmountCents',
    'row.candidateHasMixedCurrency',
    'annualReceiptMixedCurrencyBlocked',
    'donorTaxReceiptActionAvailability(selectedReceipt,',
    'unsupportedJurisdiction: receiptUnsupportedJurisdiction',
    'receiptUnsupportedJurisdiction',
    'const taxReceiptActionBlocked = (receipt: FirestoreTaxReceiptRecord): boolean => (',
    'const blockedTaxReceiptMessage = (receipt: FirestoreTaxReceiptRecord): string => {',
    'receiptAction.unsupportedJurisdiction',
    'receiptAction.missingAssignedReceiptNumber',
    'receiptAction.invalidCurrency',
    'return extra.taxReceiptGenericIssue;',
    'missingAssignedReceiptNumber: receiptMissingAssignedReceiptNumber',
    'invalidCurrency: receiptInvalidCurrency',
    'receiptMissingAssignedReceiptNumber || receiptInvalidCurrency',
    'const receiptDetailLabel = receiptUnsupportedJurisdiction',
    ': extra.officialTaxReceipt;',
    '{receiptDetailLabel}',
    'const standaloneReceiptAction =',
    'standaloneReceiptAction.missingAssignedReceiptNumber || standaloneReceiptAction.invalidCurrency',
    'if (selectedReceipt?.id === receiptId && taxReceiptActionBlocked(selectedReceipt))',
    '{!receiptActionBlocked && (',
    "if (givingPhase === 'success')",
    'parsePendingGivingCheckoutState(',
    'checkoutReturnMatchesPendingGiving(pending, givingId, sessionId)',
    'givingId: result.givingId',
    'sessionId: result.sessionId',
    'extra.receiptHistoryTitle',
    'const [focusReceiptHistory, setFocusReceiptHistory] = useState(false);',
    'const desktopReceiptHistoryRef = useRef<HTMLDivElement | null>(null);',
    'const mobileReceiptHistoryRef = useRef<HTMLDivElement | null>(null);',
    "window.matchMedia('(min-width: 1024px)').matches",
    "target?.scrollIntoView({ behavior: 'smooth', block: 'start' });",
    'target?.focus({ preventScroll: true });',
    'setFocusReceiptHistory(true);',
    'ref={desktopReceiptHistoryRef}',
    'ref={mobileReceiptHistoryRef}',
    'role="region"',
    'tabIndex={-1}',
    'aria-label={extra.receiptHistoryTitle}',
    'subscribeToUserProfile',
    'return subscribeToUserProfile(',
    'setTaxReceiptProfileReady(isTaxReceiptProfileComplete(profile));',
    'const renderTaxReceiptProfilePrompt = (showReadyState: boolean',
    "!showReadyState && taxReceiptProfileLoaded && taxReceiptProfileReady",
    "renderTaxReceiptProfilePrompt(false, 'mb-4')",
    'renderTaxReceiptProfilePrompt(true)',
    'const [pendingAnnualReceiptAck, setPendingAnnualReceiptAck] = useState<',
    'const confirmDonorAnnualReceiptSend =',
    'pendingAnnualReceiptAck?.key !== annualKey',
    'setPendingAnnualReceiptAck({ key: annualKey, corrected });',
    'setReceiptMessage(extra.taxReceiptPreviouslyReceiptedAckRequired);',
    'void handleSendAnnualTaxReceipt(',
    'annualIncludesPreviouslyReceipted',
    'row.candidateIncludesPreviouslyReceipted',
    'aria-pressed={confirmingAnnualSend}',
  ])
  && !givingScreenSource.includes('disabled={downloadingReceiptId === selectedReceipt.id || receiptActionBlocked}')
  && !givingScreenSource.includes('disabled={receiptActionBlocked}')
  && includesEvery(givingStatusSource, [
    'try {',
    '} catch {',
    "return 'unknown';",
  ])
    && includesEvery(givingScreenTestSource, [
      'marks donor giving rows covered by exact annual receipt giving IDs before offering single receipt sends',
      'requires explicit confirmation before donor annual receipt duplicate-claim acknowledgement',
      'opens donor annual receipts immediately after send responses return a receipt id',
      'pendingAnnualReceiptAck',
    'confirmDonorAnnualReceiptSend',
    "onClick={() => void handleSendAnnualTaxReceipt(",
    'hides donor PDF download and print controls for invalid full receipt records',
    'const receiptDetailLabel = receiptUnsupportedJurisdiction',
    'disabled={downloadingReceiptId === selectedReceipt.id || receiptActionBlocked}',
    'disabled={receiptActionBlocked}',
    'keeps immediate receipt history access on the post-Stripe success screen',
    'checkoutReturnMatchesPendingGiving(pending, givingId, sessionId)',
    'setFocusReceiptHistory(true);',
    'target?.focus({ preventScroll: true });',
    "successSource.indexOf('extra.receiptHistoryTitle')",
	    'keeps the donor tax receipt profile prompt live after Profile updates',
	    'return subscribeToUserProfile(',
	    'shows missing donor receipt profile guidance beside receipt-history send actions',
    'keeps donor receipt history populated from standalone receipts and annual summaries when giving history is capped',
	    'labels donor repeat receipt delivery as resend actions only after prior email delivery',
      "renderTaxReceiptProfilePrompt(false, 'mb-4')",
    ])
    && includesEvery(givingScreenSource, [
      'const annualCoveredGivingIds = new Set',
      'taxReceiptRecords.flatMap',
      "receipt.kind !== 'annual'",
      'return receipt.givingIds;',
      'const coveredByAnnualReceipt = annualCoveredGivingIds.has(record.id);',
      'coveredByAnnualReceipt: coveredByAnnualReceiptOnly',
      'receiptStatusLabel(record, coveredByAnnualReceiptOnly)',
      'taxReceiptIncludedInAnnual',
      'const receiptPreviouslyEmailed =',
      'const correctedReceiptAvailable =',
      'const standaloneReceiptPreviouslyEmailed =',
      'const standaloneCorrectedReceiptAvailable =',
      'const annualReceiptPreviouslyEmailed =',
      'const correctedAnnualReceiptAvailable =',
      'taxReceiptIsCorrected',
      'annualSummary?.correctedReceipt === true',
      'extra.resendTaxReceipt',
      'extra.resendCorrectedTaxReceipt',
      'extra.resendAnnualTaxReceipt',
      'extra.resendCorrectedAnnualTaxReceipt',
    ])
    && includesEvery(checkoutHelpersSource, [
      'export interface PendingGivingCheckoutState',
    'parsePendingGivingCheckoutState',
    'checkoutReturnMatchesPendingGiving',
    '} catch {',
    'expectedGivingId && expectedGivingId !== givingId',
    "expectedSessionId && expectedSessionId !== (sessionId ?? '')",
  ])
  && includesEvery(checkoutHelpersTestSource, [
    'parses pending checkout context only from JSON objects',
    "parsePendingGivingCheckoutState('{bad json')).toBeNull();",
    'binds successful Checkout returns to the pending giving and session ids when present',
    "checkoutReturnMatchesPendingGiving(null, 'giving-1', 'cs_test_1')",
  ])
  && includesEvery(givingDbSubscriptionTestSource, [
    'fails closed when checkout return status cannot read the giving document',
    "await expect(getGivingStatus('giving-1')).resolves.toBe('unknown');",
    'maps readable checkout return statuses without exposing receipt details',
	    ])
	    && includesEvery(refundMetadataSource, [
	      'export function givingHasPartialRefundSignal',
	      'export function givingHasCorrectablePartialRefundMetadata',
	      'refundedCents < originalCents',
	    ])
	    && includesEvery(donorReceiptActionsSource, [
      'export function donorGivingReceiptActionAvailability',
      'assignedTaxReceiptNumber(record.taxReceiptNumber)',
      'assignedTaxReceiptNumber(matchedReceipt?.receiptNumber)',
      'givingReceiptUnsupportedJurisdiction',
      'normalizedTaxReceiptCurrency(record.currency)',
      'invalidCurrency',
      'activeChurchTaxReceiptUnsupported?: boolean',
      'receiptIssuanceUnsupportedForChurch',
      'const canIssueNewReceipt = receiptIssuanceReadyForChurch(record.churchId, context);',
      'coveredByAnnualReceipt = false',
      'const coveredByAnnualReceiptOnly = coveredByAnnualReceipt && !hasExistingSendableReceipt',
      'missingAssignedReceiptNumber',
      '&& !missingAssignedReceiptNumber',
      'hasExistingSendableReceipt || canIssueNewReceipt',
      '&& !coveredByAnnualReceiptOnly',
	      'givingHasPartialRefundSignal(record)',
	      'givingHasCorrectablePartialRefundMetadata(record)',
    'export function donorTaxReceiptActionAvailability',
    'UNSUPPORTED_JURISDICTION_ERROR',
    'receiptUnsupportedJurisdiction',
    'normalizedTaxReceiptCurrency(receipt.currency)',
    '!hasAssignedTaxReceiptNumber(receipt.receiptNumber)',
    'receiptIssuanceReadyForChurch(receipt.churchId, context)',
	    'churchTimezoneForChurch: (churchId: string) => string;',
	    'const churchTimezone = input.churchTimezoneForChurch(record.churchId);',
    'export function donorAnnualReceiptActionAvailability',
    'MISSING_EMAIL_OR_AMOUNT_ERROR',
    'annualIssuanceGapRetryable',
    'receiptIssuanceGapRetryable',
    'annualDeliveryFailureRetryable',
    'receiptDeliveryFailureRetryable',
    'receiptMissingAssignedReceiptNumber',
    'receiptInvalidCurrency',
    'hasAssignedTaxReceiptNumber(receiptRecord?.receiptNumber)',
    'receiptUnsupportedJurisdiction: unsupportedJurisdiction',
    'amounts.taxReceiptIssuanceUnsupported',
    'candidateAmountCents: number;',
    'candidateEligibleAmountCents: number;',
    'receiptMatchesCurrentPartialRefundCorrection',
    'partialRefundCorrectionSettled',
    'candidateHasMixedCurrency: boolean',
    'candidateHasPartialRefund: boolean',
    'candidateIncludesPreviouslyReceipted: boolean',
    'hasAssignedTaxReceiptNumber(record.taxReceiptNumber)',
    "receipt.kind !== 'single'",
    'rows.get(donorAnnualReceiptRowKey(receipt.churchId, receipt.receiptYear))',
    'row.candidateHasMixedCurrency = true;',
    'if (!currency)',
    '|| (candidateNeedsReview && !receiptReissueAvailable && !partialRefundCorrectionSettled)',
    'const canIssuePartialRefundCorrection',
	    '!candidateHasEligibleGiving',
    '!candidateHasMixedCurrency',
    'activeChurchTaxReceiptReady || receiptSettled',
  ])
  && includesEvery(donorReceiptActionsTestSource, [
    'requires active church setup before sending a new receipt',
      'does not treat historical manual-ready donations as sendable without current setup evidence',
      'does not treat unknown historical donation receipt state as send-ready',
      'allows re-sending an existing single receipt after new setup becomes unavailable',
      'does not treat unassigned giving receipt numbers as resendable receipt evidence',
      'blocks giving-row resends for unsupported-jurisdiction stored receipts',
      'blocks legacy giving-row resends when the church is currently unsupported jurisdiction',
      'blocks new single-donation sends already covered by a settled annual receipt',
	      'blocks stale partial-refund receipts until corrected single issuance is available',
	      'uses Stripe partial-refund metadata as a correction signal before the review code is mirrored',
	      'keeps non-correctable Stripe refund metadata on the review-only path',
	      'blocks single-donation receipt actions when the giving currency is missing or unsupported',
	      'uses Stripe partial-refund metadata when building annual corrected receipt candidates',
	      'marks invalid partial-refund metadata as annual review without a corrected-send candidate',
    'blocks print, download, and standard resend for voided or review-required full receipt records',
    'blocks print, download, and resend for unsupported-jurisdiction full receipt records',
    'blocks print, download, and resend for full receipts without assigned numbers',
    'blocks print, download, and resend for full receipts with missing or unsupported currency',
    'requires active setup for corrected standalone single receipts but not settled resends',
    'allows re-sending settled annual receipts when new issuance setup is no longer ready',
    'does not treat unassigned annual receipt numbers as settled or retryable',
    'keeps verified-email annual retry summaries sendable after account verification',
    'keeps verified-email corrected annual retry summaries on the corrected-send path',
    'blocks settled annual resends for unsupported-jurisdiction receipt records',
    'blocks settled annual resends when the church is currently unsupported jurisdiction',
    'allows retrying existing annual receipt delivery failures after provider or PDF setup is fixed',
    'blocks non-retryable annual error records instead of treating them as settled resends',
    'blocks retryable annual delivery errors when no stored receipt id exists',
    'blocks settled annual receipt resends when current donor-year giving now needs review',
    'keeps settled annual partial-refund corrections resendable when they match the current net amount',
    'keeps stale annual partial-refund corrections in review when the current net amount changed',
    'marks annual donor-year candidates as previously receipted when giving history has individual receipt evidence',
	    'does not mark annual donor-year candidates as previously receipted from unassigned receipt numbers',
    'marks annual donor-year candidates as previously receipted from standalone single receipt records',
    'does not create annual donor-year rows only from standalone single receipts',
		    'keeps donor annual receipt rows across churches and uses each church timezone',
    'builds donor-only full annual receipt rows without active setup so donors can resend historical receipts',
	    'marks mixed-currency annual donor years and blocks annual receipt actions before backend calls',
    'marks missing or unsupported-currency annual donor years for review before backend calls',
    'blocks settled annual receipt actions when stored currency is missing or unsupported',
    'requires active setup before corrected annual issuance',
	    'trusts stored partial-refund annual summaries only when current giving is not loaded',
    'does not show corrected annual issuance for generic review states the backend cannot correct',
    ])
    && emailStandardSource.includes('historical receipt-number-only rows')
    && projectDetailsSource.includes('the success screen keeps a direct Receipts action in Giving, then scrolls and moves focus to the visible receipt-history panel')
    && projectDetailsSource.includes('the pending context is bound to the returned `givingId` and Stripe Checkout `sessionId`')
    && projectDetailsSource.includes('Checkout return status polling fails closed to an unknown state when a stale or unauthorized giving document cannot be read')
    && projectDetailsSource.includes('the donor portal marks those gifts as included only from the full annual receipt covered giving IDs')
    && projectDetailsSource.includes('Donor receipt-history buttons use the same distinction from stored delivery evidence')
    && projectDetailsSource.includes('Unsupported-jurisdiction full receipt records follow the same invalid-record print/download blocking path')
    && projectDetailsSource.includes('Unsupported-jurisdiction giving rows and annual mirrors also suppress donor and receipt-manager resend buttons')
    && projectDetailsSource.includes("derived from both stored receipt/giving error codes and the church's current unsupported-jurisdiction receipt setup")
    && productionChecklistSource.includes('Confirm donor browser-print controls also stay hidden for unsupported-jurisdiction full receipt records')
    && productionChecklistSource.includes('Confirm donor and receipt-manager send/resend buttons stay disabled for unsupported-jurisdiction stored giving rows')
    && productionChecklistSource.includes('driven by both mirrored `tax_receipt_unsupported_jurisdiction` errors and the current church unsupported-jurisdiction receipt setup')
    && qaWebFirebaseSource.includes('print/download blocking for unsupported-jurisdiction receipt records')
    && qaWebFirebaseSource.includes('disabled send/resend controls for unsupported-jurisdiction stored giving rows and annual summary mirrors')
    && qaWebFirebaseSource.includes("both mirrored unsupported-jurisdiction row errors and the church's current unsupported-jurisdiction setup state")
    && emailStandardSource.includes('Donor browser-print controls must also fail closed for unsupported-jurisdiction full receipt records')
    && emailStandardSource.includes('Donor and receipt-manager send buttons must also stay disabled for unsupported-jurisdiction stored giving rows')
    && emailStandardSource.includes("church's current unsupported-jurisdiction receipt setup")
    && projectDetailsSource.includes('Corrected single and annual receipt actions keep corrected wording')
    && projectDetailsSource.includes('safe annual summary `correctedReceipt` marker')
    && localizationSource.includes('Resend tax receipt')
    && localizationSource.includes('Resend corrected tax receipt')
    && localizationSource.includes('Resend annual tax receipt')
    && localizationSource.includes('Resend corrected annual tax receipt'),
    'Donor portal receipt actions fail closed for unknown historical receipt state, keep immediate post-Stripe receipt-history access, block annual-covered single sends, hide invalid or unsupported-jurisdiction full-receipt print/download controls, and require explicit annual duplicate-claim acknowledgement while preserving stored receipt resends and corrected receipt setup gates'
  );
const checkoutCreationSource = givingSource.slice(
  givingSource.indexOf('export const createStripeCheckoutSession'),
  givingSource.indexOf('export const stripeWebhook')
);
const checkoutUrlValidationSource = sourceSlice(
  givingSource,
  'function checkoutUrlIsSafe',
  'function timestampFromStripeSeconds'
);
const legacyPaymentIntentSource = givingSource.slice(
  givingSource.indexOf('export const createStripePaymentIntent'),
  givingSource.indexOf('export const onGivingCreated')
);
const legacyGivingCreatedSource = givingSource.slice(
  givingSource.indexOf('export const onGivingCreated'),
  givingSource.indexOf('export const onGivingCompleted')
);
const taxReceiptEmailSource = givingSource.slice(
  givingSource.indexOf('async function sendTaxReceiptEmail'),
  givingSource.indexOf('function markTaxReceiptReviewRequiredInTransaction')
);
const taxReceiptAuditSource = superAdminSource.slice(
  superAdminSource.indexOf('export const getTaxReceiptAuditEvents'),
  superAdminSource.indexOf('export const createChurch')
);
const donorGivingSubscriptionSource = sourceSlice(
  givingDbSource,
  'export function subscribeToUserGiving',
  'export function subscribeToUserTaxReceipts'
);
const donorAnnualSummarySubscriptionSource = sourceSlice(
  givingDbSource,
  'export function subscribeToUserAnnualTaxReceiptSummaries',
  'export function subscribeToChurchGivingForReceipts'
);
const churchGivingSubscriptionSource = sourceSlice(
  givingDbSource,
  'export function subscribeToChurchGivingForReceipts',
  'export function subscribeToChurchAnnualTaxReceiptSummaries'
);
const churchAnnualSummarySubscriptionStart = givingDbSource.indexOf(
  'export function subscribeToChurchAnnualTaxReceiptSummaries'
);
const churchAnnualSummarySubscriptionSource = churchAnnualSummarySubscriptionStart >= 0
  ? givingDbSource.slice(churchAnnualSummarySubscriptionStart)
  : '';
const replayProtectedDonationReceiptCallables = [
  'createStripeCheckoutSession',
  'createStripePaymentIntent',
  'sendTaxReceipt',
  'sendCorrectedTaxReceipt',
  'sendAnnualTaxReceipt',
  'sendCorrectedAnnualTaxReceipt',
  'downloadTaxReceiptPdf',
  'sendChurchAnnualTaxReceipts',
  'sendChurchCorrectedAnnualTaxReceipts',
];
const replayProtectedClientSetSource = apiClientSource.slice(
  apiClientSource.indexOf('const REPLAY_PROTECTED_FUNCTIONS'),
  apiClientSource.indexOf(']);', apiClientSource.indexOf('const REPLAY_PROTECTED_FUNCTIONS')) + 3
);
function functionExportSource(source, exportName) {
  const start = source.indexOf(`export const ${exportName}`);
  if (start < 0) return '';
  const next = source.indexOf('\nexport const ', start + 1);
  return next < 0 ? source.slice(start) : source.slice(start, next);
}
record(
  includesEvery(givingSource, [
    "stripe.webhooks.constructEvent(req.rawBody, sig, webhookSecret)",
    "case 'checkout.session.completed'",
    "case 'checkout.session.expired'",
    "case 'checkout.session.async_payment_failed'",
    "case 'charge.refunded'",
    'payment_intent_data',
    "db.collection('stripeWebhookEvents').doc(stripeEvent.id)",
    'timestampFromStripeSeconds(stripeEvent.created)',
    'canApplyCheckoutCompletion(giving.status)',
    "metadata.givingId === givingRef.id",
    'GIVING_PAYMENT_METADATA_COLLECTION',
    'givingPaymentMetadataRef(givingRef.id)',
    'givingPrivatePaymentFieldDeletes()',
    'tx.set(paymentMetadataRef',
    'storedStripeSessionId',
    'sessionIdMatches',
    'failureReason: FieldValue.delete()',
    "chargeMetadata.givingId === givingRef.id",
    'session.amount_total === expectedAmountCents',
    'stripeEventLivemode',
    'livemode',
    'STRIPE_FULL_REFUND_VOID_REASON',
    'STRIPE_PARTIAL_REFUND_REVIEW_REASON',
    'existingRefundedCents > refundedCents',
    "refundStatus: 'stale_refund_ignored'",
    'currentAmountRefundedCents',
    'Stripe client initialization failed:',
    'Stripe client misconfigured',
    'stripeWebhookSecretLooksValid(webhookSecret)',
    'Webhook secret misconfigured',
  ])
  && functionsCallablesTestSource.includes('recovers Checkout completion when Stripe session persistence was interrupted')
  && functionsCallablesTestSource.includes("adminDb.doc(`givingPaymentMetadata/${givingId}`).get()")
  && functionsCallablesTestSource.includes("not.toHaveProperty('stripePaymentIntentId')")
  && projectDetailsSource.includes('Checkout completion webhooks can recover a donation through signed Stripe Session metadata')
  && productionChecklistSource.includes('Checkout completion should still recover through signed Stripe metadata'),
  'Stripe webhook validates signature, idempotency, metadata, amount, metadata-only Checkout recovery, event-time completion, live/test event mode, out-of-order and stale refund events, required Checkout events, full refunds, and partial refund review'
);

record(
  includesEvery(checkoutUrlValidationSource, [
    'const parsed = new URL(url);',
    "parsed.protocol === 'https:'",
    "parsed.hostname === 'checkout.stripe.com'",
    '} catch {',
  ])
  && !checkoutUrlValidationSource.includes('startsWith(')
  && checkoutCreationSource.includes('if (!checkoutUrlIsSafe(session.url))')
  && taxReceiptBatchSourceTestSource.includes('validates backend Stripe Checkout redirects by parsed HTTPS host'),
  'Stripe Checkout callable validates returned Checkout redirects by parsed HTTPS host before exposing them to the client'
);

record(
  includesEvery(legacyPaymentIntentSource, [
    'Deprecated production compatibility shim',
    'This payment flow has been retired. Use Stripe Checkout.',
    'replayProtectedCallableOptions',
    'assertFreshAppCheck(request)',
  ])
  && !legacyPaymentIntentSource.includes('STRIPE_SECRET_KEY')
  && !givingSource.includes('paymentIntents.create'),
  'Retired PaymentIntent callable fails closed with replay-protected App Check and without binding Stripe secrets; donations use hosted Checkout only'
);

record(
  includesEvery(legacyGivingCreatedSource, [
    'export const onGivingCreated = onDocumentCreated',
    'region: FIRESTORE_REGION',
    "document: 'giving/{givingId}'",
    'Deprecated onGivingCreated trigger ignored.',
  ])
  && !legacyGivingCreatedSource.includes('STRIPE_SECRET_KEY')
  && !legacyGivingCreatedSource.includes('getStripe')
  && !legacyGivingCreatedSource.includes('checkout.sessions.create')
  && !legacyGivingCreatedSource.includes('paymentIntents.create')
  && !legacyGivingCreatedSource.includes('event.params.givingId'),
  'Retired giving create trigger is a no-op shim without raw giving-ID logging so production deploys overwrite legacy payment logic'
);

record(
  replayProtectedDonationReceiptCallables.every((fnName) => (
    replayProtectedClientSetSource.includes(`'${fnName}'`)
    && functionExportSource(givingSource, fnName).includes('replayProtectedCallableOptions')
    && functionExportSource(givingSource, fnName).includes('assertFreshAppCheck(request)')
  ))
  && apiClientSource.includes('limitedUseAppCheckTokens: true')
  && apiClientTestSource.includes('uses limited-use App Check tokens for every donation and receipt callable')
  && replayProtectedDonationReceiptCallables.every((fnName) => apiClientTestSource.includes(`'${fnName}'`)),
  'Donation and receipt callables use limited-use App Check replay protection on both client and backend',
  'High-value payment and official receipt actions must consume limited-use App Check tokens.'
);

record(
  includesEvery(superAdminSource, [
    'getPaymentOperationsReadiness',
    "secrets: ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'RESEND_API_KEY']",
    'stripeAccountReadinessSummary',
    'getStripe().accounts.retrieve(null)',
    'charges_enabled',
    'payouts_enabled',
    'details_submitted',
    'currently_due',
    'past_due',
    'eventually_due',
    'future_requirements',
    'futureCurrentlyDueCount',
    'futurePastDueCount',
    'futureEventuallyDueCount',
    'disabled_reason',
    'stripe_account_status_unavailable',
    'stripe_account_charges_disabled',
    'stripe_account_payouts_disabled',
    'stripe_account_details_missing',
    'stripe_account_requirements_due',
    'stripe_account_eventual_needs_due',
    'stripe_account_upcoming_requirements_due',
    'stripe_account_disabled',
    'stripeSecretKeyMode',
    'stripeWebhookSecretLooksValid',
    'PAYMENT_OPERATIONS_SMOKE_FRESHNESS_HOURS = 72',
    'timestampIsFresh',
    "collection('stripeWebhookEvents')",
    ".where('type', '==', 'checkout.session.completed')",
    ".where('status', '==', 'processed')",
    ".where('livemode', '==', true)",
    ".where('status', 'in', ['validation_failed', 'missing_giving', 'unpaid_session'])",
    'const [snap, liveSnap, checkoutSnap, liveCheckoutSnap, liveIssueSnap] = await Promise.all',
    'const liveDocs = liveSnap.docs.map',
    'const liveProcessedCheckoutCompletedEvents = liveCheckoutSnap.docs.map',
    'const liveIssueEvents = liveIssueSnap.docs.map',
    'const latestLive = liveDocs[0] ?? {}',
    "const liveProcessedCount = liveDocs.filter((event) => event.status === 'processed' && event.livemode === true).length",
    'const liveProcessedCheckoutCompletedCount = liveProcessedCheckoutCompletedEvents.length',
    'millisFromTimestamp(liveProcessedCheckoutCompletedEvents[0]?.processedAt)',
    'checkedLiveEventCount',
    'latestProcessedAtMillis',
    'latestLiveProcessedAtMillis',
    'latestCheckoutCompletedAtMillis',
    'latestLiveCheckoutCompletedAtMillis',
    'latestLivemode',
    'latestLiveType',
    'latestLiveStatus',
    'liveProcessedCount',
    'testProcessedCount',
    'processedCheckoutCompletedCount',
    'liveProcessedCheckoutCompletedCount',
    'testProcessedCheckoutCompletedCount',
    'checkoutSmokeFresh',
    'liveCheckoutSmokeFresh',
    'validationFailedCount',
    'liveIssueCount',
    'liveValidationFailedCount',
    'liveMissingGivingCount',
    'liveUnpaidSessionCount',
    'latestLiveIssueAtMillis',
    'const liveWebhookIssueCount = Number(webhookActivity.liveIssueCount) || 0',
    'blockingWebhookIssueCount',
    'taxReceiptEmailSmokeSummary',
    'taxReceiptAnnualSmokeSummary',
    'for (const annualEmailSentEvent of annualEmailSentEvents)',
    'fallbackSummary',
    "collection('taxReceiptEvents')",
    ".where('action', '==', 'email_sent')",
    ".where('kind', '==', 'annual')",
    ".orderBy('createdAt', 'desc')",
    'checkedLiveCheckoutGivingCount',
    'emailSentCount',
    'liveEmailSentCount',
    'latestEmailSentAtMillis',
    'latestLiveEmailSentAtMillis',
    'latestLiveCheckoutEmailSentAtMillis',
    'latestLiveCheckoutReceiptArtifactSummary',
    'latestLiveCheckoutGivingSentAtMillis',
    'latestLiveCheckoutReceiptIssuedAtMillis',
    'latestLiveCheckoutReceiptEmailSentAtMillis',
    'latestLiveCheckoutReceiptPdfRetainedAtMillis',
    'latestLiveCheckoutReceiptPdfObjectReady',
    'latestLiveCheckoutReceiptArtifactReady',
    'latestLiveCheckoutReceiptArtifactFresh',
    'latestAnnualEmailSentAtMillis',
    'latestAnnualReceiptIssuedAtMillis',
    'latestAnnualReceiptEmailSentAtMillis',
    'latestAnnualReceiptPdfRetainedAtMillis',
    'latestAnnualReceiptPdfObjectReady',
    'latestAnnualReceiptSummaryReady',
    'latestAnnualReceiptContributionDetailReady',
    'latestAnnualReceiptOriginalYearEndReady',
    'latestAnnualReceiptCorrectedOrReissue',
    'latestAnnualEmailSentFresh',
    'latestAnnualReceiptArtifactReady',
    'latestAnnualReceiptArtifactFresh',
    "collection('giving').doc(givingId).get()",
    "collection('taxReceipts').doc(receiptId).get()",
    "collection('taxReceiptSummaries').doc(receiptId).get()",
    'retainedTaxReceiptPdfObjectMetadataReady',
    'RECEIPT_MANAGER_GIVING_SAFE_VERSION',
    'RECEIPT_MANAGER_SUMMARY_SAFE_VERSION',
    'ANNUAL_SMOKE_MIN_DONATION_COUNT',
    'TAX_RECEIPT_SUMMARY_PRIVATE_FIELDS',
    'taxReceiptLegalName',
    'taxReceiptAddress',
    'issuedBy',
    'stripeConnectAccountId',
    'stripeCheckoutSessionUrl',
    'checkoutUrl',
    'stripeRefundStatus',
    'stripeAmountRefundedCents',
    'pdfTemplateVersion',
    'partialRefundGivingIds',
    'correctionForGivingId',
    'correctedBy',
    'correctionMarkedAt',
    'correctionMarkedBy',
    'voidedBy',
    'PUBLIC_TAX_RECEIPT_NUMBER_FALLBACK',
    'function officialReceiptNumberLooksAssigned',
    'officialReceiptNumberLooksAssigned(receipt.receiptNumber)',
    'givingTaxReceiptNumber',
    'officialReceiptNumberLooksAssigned(givingTaxReceiptNumber)',
    'givingTaxReceiptNumber === trimmedString(receipt.receiptNumber)',
    'GIVING_PRIVATE_PAYMENT_FIELDS',
    'function givingOmitsPrivatePaymentFields',
    'giving.receiptManagerGivingSafeVersion === RECEIPT_MANAGER_GIVING_SAFE_VERSION',
    'givingOmitsPrivatePaymentFields(giving)',
    'annualGivingCoverageReady',
    'annualContributionDetailReady',
    'annualReceiptHasCorrectionOrReissueEvidence',
    'taxReceiptSummaryOmitsPrivateFields',
    'emailEventMatchesStoredReceipt',
    'emailSentFresh',
    'liveEmailSentFresh',
    'latestLiveCheckoutEmailSentFresh',
    'latestLiveCheckoutReceiptArtifactReady === true',
    'latestLiveCheckoutReceiptArtifactFresh === true',
    'tax_receipt_email_smoke_missing',
    'tax_receipt_live_email_smoke_missing',
    'tax_receipt_email_smoke_stale',
    'tax_receipt_live_email_smoke_stale',
    'tax_receipt_live_receipt_artifacts_missing',
    'tax_receipt_live_receipt_artifacts_stale',
    'tax_receipt_annual_smoke_missing',
    'tax_receipt_annual_smoke_stale',
    'tax_receipt_annual_original_smoke_missing',
    'tax_receipt_annual_contribution_detail_missing',
    'tax_receipt_annual_artifacts_missing',
    'tax_receipt_annual_artifacts_stale',
    'webhookCheckoutSmokeReady',
    'webhookSmokeReady',
    'stripe_webhook_smoke_missing',
    'stripe_webhook_checkout_smoke_missing',
    'stripe_webhook_live_smoke_missing',
    'stripe_webhook_live_checkout_smoke_missing',
    'stripe_webhook_checkout_smoke_stale',
    'stripe_webhook_live_checkout_smoke_stale',
    'stripe_webhook_latest_live_not_processed',
    'stripe_webhook_recent_issues',
    'stripe_webhook_live_issues',
    'resend_api_key_invalid_format',
    'resendDomainReadinessSummary',
    'resend_domain_status_unavailable',
    'resend_domain_missing',
    'resend_domain_unverified',
    'resend_domain_duplicate',
    'stripeWebhookEndpointReadinessSummary',
    'REQUIRED_STRIPE_WEBHOOK_EVENTS',
    'stripe_webhook_endpoint_status_unavailable',
    'stripe_webhook_endpoint_missing',
    'stripe_webhook_endpoint_not_live',
    'stripe_webhook_endpoint_disabled',
    'stripe_webhook_endpoint_duplicate',
    'stripe_webhook_endpoint_api_version_mismatch',
    'stripe_webhook_endpoint_missing_events',
    'stripe_webhook_endpoint_wildcard_events',
    'stripe_webhook_endpoint_extra_events',
    'appUrl.errorCode',
    'appUrl.configured',
    'appUrl.runtimeValid',
    'productionReady',
    'formatValid: resendApiKeyFormatValid',
    'resendDomain',
    'taxReceiptDeliveryReady =',
    'resendDomain.verified === true',
    'Number(resendDomain.duplicateCount) === 0',
    'stripeAccount.ready === true',
    'stripeAccount',
    'webhookUrl',
    'stripeWebhookEndpoint',
    'stripeWebhookEndpoint.ready === true',
    'taxReceiptEmailSmoke',
    'taxReceiptEmailSmokeReady',
    'taxReceiptAnnualSmoke',
    'taxReceiptAnnualSmokeReady',
    'stripeApiVersion: STRIPE_API_VERSION',
    'warnings',
  ])
  && missionControlAnalyticsSource.includes('readiness?.stripeApiVersion')
  && missionControlAnalyticsSource.includes('formatStripeWebhookEndpoint(readiness)')
  && missionControlAnalyticsSource.includes('readiness.stripeWebhookEndpoint.ready === true')
  && missionControlAnalyticsSource.includes('formatStripeAccount(readiness?.stripeAccount)')
  && missionControlAnalyticsSource.includes('function stripeAccountQueuedRequirementSuffix')
  && missionControlAnalyticsSource.includes('const eventualRequirementCount = account?.eventuallyDueCount ?? 0')
  && missionControlAnalyticsSource.includes('queuedRequirementSegments.push(`eventual: ${eventualRequirementCount}`)')
  && missionControlAnalyticsSource.includes('futureCurrentlyDueCount + account.futurePastDueCount + account.futureEventuallyDueCount')
  && missionControlAnalyticsSource.includes('queuedRequirementSegments.push(`future: ${futureRequirementCount}`)')
  && missionControlAnalyticsTestSource.includes('shows Stripe queued requirement counts without exposing requirement field names')
  && missionControlAnalyticsTestSource.includes("expect(label).toBe('Ready, eventual: 2, future: 3')")
  && missionControlAnalyticsTestSource.includes("))).toBe('Requirements due, eventual: 2, future: 1')")
  && missionControlAnalyticsTestSource.includes("))).toBe('Payouts off, eventual: 1, future: 1')")
  && missionControlAnalyticsSource.includes('readiness?.stripeAccount.ready === true')
  && missionControlAnalyticsSource.includes('readiness.appUrl.runtimeValid === true')
  && missionControlAnalyticsSource.includes('liveProcessedCheckoutCompletedCount')
  && missionControlAnalyticsSource.includes('processedCheckoutCompletedCount')
  && missionControlAnalyticsSource.includes('liveCheckoutSmokeFresh === true')
  && missionControlAnalyticsSource.includes('checkoutSmokeFresh === true')
  && missionControlAnalyticsSource.includes('paymentOperationsReadinessWarningLabel(warning)')
  && !missionControlAnalyticsSource.includes('function formatReadinessWarning')
  && missionControlAnalyticsSource.includes('paymentOperationsWebhookIssueCount(readiness)')
  && missionControlAnalyticsSource.includes('paymentOperationsWebhookIssueSummary(readiness)')
  && missionControlAnalyticsSource.includes("stripeMode === 'live' ? 'Issue checks' : 'Validation issues'")
  && missionControlAnalyticsSource.includes('formatResendEmailReadiness(readiness)')
  && missionControlAnalyticsSource.includes('readiness?.taxReceiptDeliveryReady === true')
  && missionControlAnalyticsSource.includes('formatReceiptEmailSmoke(readiness)')
  && missionControlAnalyticsSource.includes('readiness?.taxReceiptEmailSmoke.ready === true')
  && missionControlAnalyticsSource.includes('Latest artifacts missing')
  && missionControlAnalyticsSource.includes('Latest artifacts stale')
  && missionControlAnalyticsSource.includes('formatAnnualReceiptSmoke(readiness)')
  && missionControlAnalyticsSource.includes('readiness?.taxReceiptAnnualSmoke.ready === true')
  && missionControlAnalyticsSource.includes('Annual smoke')
  && missionControlAnalyticsSource.includes('Original annual missing')
  && missionControlAnalyticsSource.includes('Summary missing')
  && missionControlAnalyticsSource.includes('Contribution detail missing')
  && missionControlAnalyticsSource.includes('PDF copy missing')
  && missionControlAnalyticsSource.includes('Domain unverified')
  && includesEvery(paymentOperationsReadinessHelpersSource, [
    'paymentOperationsLaunchSteps',
    'firstIncompletePaymentOperationsLaunchStep',
    'paymentOperationsReadinessWarningLabel',
    'Live webhook issue found',
    'Recent webhook issue found',
    'Unknown setup warning',
    'paymentOperationsWebhookIssueCount',
    'paymentOperationsRecentWebhookIssueCount',
    'paymentOperationsLiveWebhookIssueCount',
    'paymentOperationsWebhookIssueSummary',
    'Math.max(',
    "return `${paymentOperationsLiveWebhookIssueCount(readiness)} live / ${recentIssueCount} recent`;",
    'Set APP_URL to the production HTTPS app URL',
    'Set the live Stripe secret or restricted key',
    'Complete corporate, tax, bank, and verification requirements in Stripe',
    'Stripe eventual requirements queued',
    'stripe_account_eventual_needs_due',
    'Stripe future requirements queued',
    'stripe_account_upcoming_requirements_due',
    'Create the production webhook endpoint, store its signing secret, and verify the live endpoint configuration',
    'readiness.stripeWebhookEndpoint.ready',
    'stripe_webhook_endpoint_status_unavailable',
    'stripe_webhook_endpoint_missing',
    'stripe_webhook_endpoint_api_version_mismatch',
    'stripe_webhook_endpoint_missing_events',
    'stripe_webhook_endpoint_wildcard_events',
    'Set the live Resend API key and verify exactly one kandilo.org sending domain',
    'ready: readiness.taxReceiptDeliveryReady',
    'resend_domain_unverified',
    'Complete one small live Checkout donation',
    'liveProcessedCheckoutCompletedCount > 0',
    'liveCheckoutSmokeFresh === true',
    "latestLiveStatus === 'processed'",
    'stripe_webhook_latest_live_not_processed',
    'stripe_webhook_live_issues',
    'paymentOperationsWebhookIssueCount(readiness) === 0',
    'receipt_email_smoke',
    'Email the official receipt for the live smoke donation',
    'assigned stored receipt and portal mirror artifact evidence',
    'ready: receiptEmailSmokeReady(readiness)',
    'tax_receipt_email_smoke_missing',
    'tax_receipt_live_email_smoke_missing',
    'tax_receipt_live_email_smoke_stale',
    'tax_receipt_live_receipt_artifacts_missing',
    'tax_receipt_live_receipt_artifacts_stale',
    'annual_receipt_smoke',
    'Verify annual receipt smoke',
    'Send a non-anonymous closed-year annual receipt covering at least two donations',
    'itemized contribution detail, staff-safe summary, and retained PDF evidence',
    'ready: annualReceiptSmokeReady(readiness)',
    'tax_receipt_annual_smoke_missing',
    'tax_receipt_annual_smoke_stale',
    'tax_receipt_annual_original_smoke_missing',
    'tax_receipt_annual_contribution_detail_missing',
    'tax_receipt_annual_artifacts_missing',
    'tax_receipt_annual_artifacts_stale',
    'stripe_webhook_live_checkout_smoke_stale',
  ])
  && includesEvery(paymentOperationsReadinessHelpersTestSource, [
    'returns the production setup checklist in launch order',
    'points to the first incomplete setup action',
    'requires a clean live completed-Checkout webhook smoke result',
    'uses explicit latest live webhook status for live smoke readiness',
    'labels non-blocking Stripe future requirement warnings',
    "expect(paymentOperationsReadinessWarningLabel('stripe_account_upcoming_requirements_due')).toBe(",
    'labels non-blocking Stripe eventual requirement warnings',
    "expect(paymentOperationsReadinessWarningLabel('stripe_account_eventual_needs_due')).toBe(",
    'stripe_webhook_latest_live_not_processed',
    'tax_receipt_annual_contribution_detail_missing',
    'Annual contribution detail missing',
    'requires the direct live webhook issue lookup to be clean',
    'keeps recent and direct live webhook issue counts visible separately in live mode',
    "expect(paymentOperationsWebhookIssueSummary(recentOnlyIssue)).toBe('0 live / 2 recent')",
    'formats operator-facing warning labels without leaking unknown values',
    "expect(paymentOperationsReadinessWarningLabel('sk_live_private')).toBe('Unknown setup warning')",
    'requires the live Stripe webhook endpoint configuration before webhook smoke',
    'requires an official receipt email smoke result after the live checkout smoke',
    'requires an annual receipt smoke after the receipt email smoke',
    'keeps receipt email smoke incomplete until the latest live Checkout donation has email evidence',
    'keeps receipt email smoke incomplete until the latest live receipt artifacts are verified',
    'marks stale live smoke evidence incomplete even when historical counts exist',
    'keeps checkout smoke ahead of receipt and annual smoke in launch order',
    'requires the live Resend sending domain before receipt email readiness',
    'keeps duplicate Resend sending domains out of receipt email readiness',
    'keeps checklist output free of private runtime values',
  ])
  && missionControlAnalyticsSource.includes('paymentOperationsLaunchSteps(readiness)')
  && missionControlAnalyticsSource.includes('firstIncompletePaymentOperationsLaunchStep(readiness)')
  && missionControlAnalyticsSource.includes('Launch checklist')
  && missionControlAnalyticsSource.includes('Next: ${nextLaunchStep.label}')
  && productionChecklistSource.includes('ordered launch checklist with the next incomplete setup action')
  && productionChecklistSource.includes('direct live-mode completed-Checkout webhook smoke lookup')
  && productionChecklistSource.includes('official receipt email-sent smoke evidence')
  && productionChecklistSource.includes('fresh assigned stored receipt plus portal mirror artifact evidence')
  && productionChecklistSource.includes('runtime annual receipt smoke evidence with a staff-safe annual summary and retained PDF object integrity')
  && productionChecklistSource.includes('annual smoke check scans recent annual email audit events for a fresh non-anonymous annual receipt smoke candidate')
  && productionChecklistSource.includes('corrected or refund-reissue annual receipts do not satisfy the annual smoke gate')
  && productionChecklistSource.includes('receipt-manager safe-version marker matching donor anonymity and no raw Stripe payment identifier or checkout URL alias fields')
  && projectDetailsSource.includes('redacted payment/receipt readiness and ordered launch checklist')
  && projectDetailsSource.includes('annual receipt smoke evidence including itemized contribution-line readiness')
  && projectDetailsSource.includes('direct live-mode completed-Checkout webhook smoke lookup')
  && projectDetailsSource.includes('official receipt email-sent smoke evidence')
  && projectDetailsSource.includes('assigned stored receipt plus portal mirror artifact evidence')
  && projectDetailsSource.includes('runtime annual receipt smoke evidence with a staff-safe annual summary and retained PDF object integrity')
  && projectDetailsSource.includes('fresh non-anonymous annual receipt smoke candidate from recent annual email audit events')
  && projectDetailsSource.includes('corrected or refund-reissue annual receipts do not satisfy the runtime annual smoke gate')
  && qaWebFirebaseSource.includes('redacted annual receipt smoke readiness that scans recent annual email events for a fresh staff-safe annual summary and retained PDF object candidate')
  && projectDetailsSource.includes('no raw Stripe payment identifier or checkout URL alias fields on the church-facing giving mirror')
  && functionsCallablesTestSource.includes('requires a completed Checkout webhook before marking payment operations ready')
  && functionsCallablesTestSource.includes('requires backend email-sent audit evidence for the official receipt smoke gate')
  && functionsCallablesTestSource.includes('keeps live Checkout smoke visible when newer test-mode Checkout completions fill the general Checkout window')
  && functionsCallablesTestSource.includes('keeps live webhook issues visible when newer test-mode Checkout completions fill the general webhook window')
  && functionsCallablesTestSource.includes('private-giving-live-behind-test-noise')
  && functionsCallablesTestSource.includes('private-giving-live-issue-behind-test-noise')
  && functionsCallablesTestSource.includes('checkedLiveEventCount: 1')
  && functionsCallablesTestSource.includes('latestLiveStatus: \'processed\'')
  && functionsCallablesTestSource.includes('liveProcessedCheckoutCompletedCount: 1')
  && functionsCallablesTestSource.includes('liveValidationFailedCount: 1')
  && functionsCallablesTestSource.includes("expect(result.warnings).toContain('stripe_webhook_live_issues')")
  && functionsCallablesTestSource.includes("expect(result.warnings).not.toContain('stripe_webhook_recent_issues')")
  && functionsCallablesTestSource.includes('newer unrelated email-sent audit records cannot hide live receipt smoke')
  && functionsCallablesTestSource.includes('tracks whether receipt email smoke belongs to the newest live Checkout donation')
  && functionsCallablesTestSource.includes('tracks redacted receipt artifact readiness for the newest live Checkout smoke')
  && functionsCallablesTestSource.includes('tracks redacted annual receipt smoke readiness with staff-safe summary evidence')
  && functionsCallablesTestSource.includes('tax_receipt_annual_contribution_detail_missing')
  && functionsCallablesTestSource.includes('latestAnnualReceiptContributionDetailReady: true')
  && functionsCallablesTestSource.includes('keeps annual receipt smoke ready when newer privacy-protected annual events exist')
  && functionsCallablesTestSource.includes('requires original annual receipt smoke and scans past newer corrected annual events')
  && functionsCallablesTestSource.includes("receiptManagerGivingSafeVersion: 0")
  && functionsCallablesTestSource.includes('latestAnnualReceiptSummaryReady: true')
  && functionsCallablesTestSource.includes('latestAnnualReceiptCorrectedOrReissue: true')
  && functionsCallablesTestSource.includes("expect(correctedOnly.warnings).toContain('tax_receipt_annual_original_smoke_missing')")
  && functionsCallablesTestSource.includes('tax_receipt_annual_artifacts_missing')
  && functionsCallablesTestSource.includes("stripePaymentIntentId: 'pi_live_private_artifact_smoke'")
  && functionsCallablesTestSource.includes('stripePaymentIntentId: FieldValue.delete()')
  && superAdminSource.includes("trimmedString(receipt.pdfRetentionStatus) === 'retained'")
  && taxReceiptRetentionSource.includes('retainedTaxReceiptPdfObjectMetadataReady')
  && taxReceiptRetentionSource.includes('getMetadata()')
  && taxReceiptRetentionSource.includes("cleanText(customMetadata.retentionPurpose) === 'official_tax_receipt_copy'")
  && functionsCallablesTestSource.includes('latestLiveCheckoutReceiptPdfObjectReady: false')
  && functionsCallablesTestSource.includes("pdfRetentionStatus: 'failed'")
  && functionsCallablesTestSource.includes("pdfSha256: 'b'.repeat(64)")
  && functionsCallablesTestSource.includes("receiptNumber: 'unassigned'")
  && functionsCallablesTestSource.includes('taxReceiptNumber: FieldValue.delete()')
  && functionsCallablesTestSource.includes("taxReceiptNumber: 'unassigned'")
  && functionsCallablesTestSource.includes("taxReceiptNumber: 'STN-2026-999999'")
  && functionsCallablesTestSource.includes('requires fresh runtime smoke evidence before payment operations can be production-ready')
  && productionChecklistSource.includes('configured live Stripe webhook endpoint')
  && productionChecklistSource.includes('configured runtime-valid HTTPS return URL')
  && projectDetailsSource.includes('same Stripe return URL evaluator as Checkout and Connect onboarding')
  && projectDetailsSource.includes('redacted live Stripe webhook endpoint readiness')
  && projectDetailsSource.includes('direct live webhook issue-status counts')
  && projectDetailsSource.includes('configured runtime-valid `APP_URL`'),
  'SuperAdmin runtime readiness reports Stripe key, redacted Stripe account activation state, webhook secret, redacted live Stripe webhook endpoint state, Resend key/domain readiness, APP_URL, webhook endpoint, Stripe API version, redacted live/test completed-Checkout webhook activity with direct live-mode Checkout smoke and live issue lookups, redacted official receipt email smoke evidence, redacted assigned stored receipt plus portal mirror artifact evidence, and redacted annual receipt smoke evidence, and requires a verified live Stripe webhook endpoint, fresh live-mode completed-Checkout webhook smoke, live account, single verified receipt-email domain readiness, no live webhook issue statuses, fresh email-sent receipt smoke evidence, matching fresh privacy-safe assigned stored receipt artifacts with a matching portal receipt number, and fresh staff-safe annual receipt smoke evidence with itemized contribution-line proof before production-ready'
);

record(
  includesEvery(superAdminSource, [
    'function publicTaxReceiptAuditReceiptId',
    'publicTaxReceiptAuditReceiptId',
    "import { publicTaxReceiptAuditCode } from '../shared/taxReceiptAudit';",
    "kind === 'single'",
    "'single_receipt'",
    "kind === 'annual'",
    "'annual_receipt'",
    "'annual_correction_receipt'",
  ])
	  && includesEvery(taxReceiptAuditSource, [
	    'getTaxReceiptAuditEvents',
	    'publicTaxReceiptAuditReceiptId(data)',
	    'publicTaxReceiptAuditCode(data.errorCode)',
	    'publicTaxReceiptAuditCode(data.reasonCode)',
	    "data.action === 'annual_scheduled_review_summary'",
	    'reviewCount',
	    "actorUid && actorUid === targetUserId ? 'donor' : actorUid",
	    'receiptId:',
	    'createdAtMillis',
	  ])
  && includesAny(givingSource, [
    "import { GENERIC_TAX_RECEIPT_AUDIT_CODE, publicTaxReceiptAuditCode } from '../shared/taxReceiptAudit';",
    "import { GENERIC_TAX_RECEIPT_AUDIT_CODE, publicTaxReceiptAuditCode } from '../../shared/taxReceiptAudit';",
  ])
  && givingSource.includes('publicTaxReceiptAuditCode(input.errorCode)')
  && givingSource.includes('publicTaxReceiptAuditCode(input.reasonCode)')
  && includesEvery(functionsTaxReceiptAuditSource, [
    "GENERIC_TAX_RECEIPT_AUDIT_CODE = 'receipt_audit_issue'",
	    'PUBLIC_TAX_RECEIPT_AUDIT_CODES',
	    "'tax_receipt_setup_required'",
	    "'tax_receipt_invalid_currency'",
	    'publicTaxReceiptAuditCode',
    'PUBLIC_TAX_RECEIPT_AUDIT_CODES.has(code) ? code : GENERIC_TAX_RECEIPT_AUDIT_CODE',
  ])
  && includesEvery(functionsTaxReceiptAuditTestSource, [
    'keeps only public audit issue codes and redacts unknown strings',
	    "publicTaxReceiptAuditCode('sk_live_private')",
	    "publicTaxReceiptAuditCode('tax_receipt_setup_required')",
	    "publicTaxReceiptAuditCode('tax_receipt_invalid_currency')",
	    "publicTaxReceiptAuditCode('whsec_private')",
    "publicTaxReceiptAuditCode('failed-precondition')",
  ])
	  && includesEvery(receiptAuditSource, [
	    'receiptAuditIssueLabel',
	    'receiptAuditReviewCountLabel',
	    "receipt_audit_issue: 'Receipt issue'",
	    "tax_receipt_setup_required: 'Receipt setup required'",
	    "tax_receipt_send_failed: 'Receipt email failed'",
	    "stripe_partial_refund_review_required: 'Partial refund review needed'",
	    "return receiptAuditIssueLabels[code] ?? 'Receipt issue';",
	    "action !== 'annual_scheduled_review_summary'",
	    'donor-year',
	  ])
	  && includesEvery(receiptAuditTestSource, [
	    'renders safe operator labels without exposing raw unknown codes',
	    'renders aggregate scheduled review counts without donor identifiers',
	    "receiptAuditIssueLabel('tax_receipt_setup_required', '')",
	    "receiptAuditIssueLabel('sk_live_private', '')",
	    "receiptAuditIssueLabel('', 'whsec_private')",
	    "receiptAuditReviewCountLabel('annual_scheduled_review_summary', 4)",
	  ])
	  && missionControlAnalyticsSource.includes('receiptAuditIssueLabel(event.errorCode, event.reasonCode)')
	  && missionControlAnalyticsSource.includes('receiptAuditReviewCountLabel(event.action, event.reviewCount)')
	  && churchDomainSource.includes('reviewCount: number | null')
	  && !missionControlAnalyticsSource.includes('{event.errorCode || event.reasonCode}')
  && functionsCallablesTestSource.includes("errorCode: 'sk_live_private'")
  && functionsCallablesTestSource.includes("reasonCode: 'whsec_private'")
  && functionsCallablesTestSource.includes("expect(serialized).not.toContain('sk_live_private');")
  && functionsCallablesTestSource.includes("expect(serialized).not.toContain('whsec_private');")
  && !taxReceiptAuditSource.includes("userId: typeof data.userId === 'string'")
  && !taxReceiptAuditSource.includes("givingId: typeof data.givingId === 'string'"),
  'SuperAdmin receipt audit feed omits target donor UIDs and giving IDs from its callable response, redacts private receipt IDs, redacts donor-as-actor UIDs, sanitizes issue codes, and renders safe operator labels'
);

record(
  includesEvery(givingSource, [
    'const MIN_DONATION_CENTS = 50',
    'const MAX_DONATION_CENTS = 1_000_000',
    "const ALLOWED_CURRENCIES = new Set(['usd', 'cad'])",
    'function donationCurrencyForChurch',
    "country === 'CA' ? 'cad' : 'usd'",
    'assertIntegerInRange(',
    'ALLOWED_CURRENCIES.has(requestedCurrency)',
    'Unsupported currency for this church.',
  ]),
  'Checkout creation enforces church-country USD/CAD currency and donation amount bounds'
);

record(
  includesEvery(paymentSettingsSource, [
    "export const CHURCH_PAYMENT_SETTINGS_COLLECTION = 'churchPaymentSettings'",
    'stripeConnectAccountIdLooksValid',
    'sanitizeChurchPaymentSettings',
    'loadChurchPaymentSettings',
    'paymentSettingsAuditSummary',
    'churchPaymentSettingsWritePayload',
    'stripeConnectAccountApi',
  ])
  && includesEvery(givingSource, [
    'stripeConnectDestinationForChurch',
    'loadChurchPaymentSettings(churchId)',
    "settings.stripeConnectAccountApi === 'v2'",
    'stripe.v2.core.accounts.retrieve(settings.stripeConnectAccountId',
    'stripe.accounts.retrieve(settings.stripeConnectAccountId)',
    'stripeV2AccountReadyForRouting',
    'stripeV2AccountHasBlockingRequirements',
    'stripeV2RequirementStatusBlocksRouting',
    "transferStatus === 'active'",
    "stripeSettlement: stripeConnectDestination ? STRIPE_CONNECT_SETTLEMENT : STRIPE_PLATFORM_SETTLEMENT",
    'stripeConnectTransferConfigured: Boolean(stripeConnectDestination)',
    'paymentIntentData.transfer_data',
    'destination: stripeConnectDestination',
  ])
  && includesEvery(superAdminSource, [
    'getChurchPaymentSettings',
    'updateChurchPaymentSettingsAsSuperAdmin',
    'createChurchStripeConnectAccountAsSuperAdmin',
    'createChurchStripeConnectOnboardingLink',
    'replayProtectedCallableOptions',
    'assertFreshAppCheck(request)',
    "secrets: ['STRIPE_SECRET_KEY']",
    'stripe.v2.core.accounts.create',
    'stripeConnectAccountDefaultsForCountry',
    'In-app Stripe connected account creation currently supports U.S. and Canadian parishes only.',
    "configuration: {",
    "recipient: {",
    "stripe_transfers: { requested: true }",
    "dashboard: 'express'",
    'currency: accountDefaults.currency',
    'locales: accountDefaults.locales',
    "fees_collector: 'application'",
    "losses_collector: 'application'",
    "entity_type: 'non_profit'",
    'stripeConnectAccountCreatedByKandilo',
    "stripeConnectAccountApi: 'v2'",
    'stripeConnectRoutingEnabled: false',
    'assertStripeConnectAccountReadyForRouting',
    'stripe.v2.core.accounts.retrieve(settings.stripeConnectAccountId',
    'stripe.accounts.retrieve(settings.stripeConnectAccountId)',
    'Stripe could not verify this connected account',
    "checkRateLimit(request.auth!.uid, 'createChurchStripeConnectOnboardingLink', 3)",
    'CHURCH_PAYMENT_SETTINGS_COLLECTION',
    'paymentSettingsAuditSummary(previous)',
    'paymentSettingsAuditSummary(settings)',
    'requestedAccountApiProvided',
    'requestedSettings.stripeConnectAccountApi',
    'stripe.v2.core.accountLinks.create',
    "configurations: ['recipient']",
    'stripe.accountLinks.create',
    "type: 'account_onboarding'",
    'collection_options',
    'STRIPE_CONNECT_RETURN_STATE_PATTERN',
    'assertStripeConnectReturnState',
    'stripeConnectOnboardingReturnUrl',
    "url.searchParams.set('state', returnState)",
    "stripeConnectOnboardingReturnUrl(churchId, 'refresh', returnState)",
    "stripeConnectOnboardingReturnUrl(churchId, 'return', returnState)",
    "['priest', 'treasurer']",
    'stripeConnectAccountConfigured: true',
    'stripeConnectReturnStateBound: true',
  ])
  && includesEvery(indexSource, [
    'getChurchPaymentSettings',
    'updateChurchPaymentSettingsAsSuperAdmin',
    'createChurchStripeConnectAccountAsSuperAdmin',
    'createChurchStripeConnectOnboardingLink',
  ])
  && includesEvery(apiClientSource, [
    "'updateChurchPaymentSettingsAsSuperAdmin'",
    "'createChurchStripeConnectAccountAsSuperAdmin'",
    "'createChurchStripeConnectOnboardingLink'",
  ])
  && includesEvery(missionControlApiSource, [
    'createChurchStripeConnectAccountAsSuperAdmin',
    'createChurchStripeConnectOnboardingLink',
    'returnState',
  ])
  && includesEvery(missionControlFormConnectSource, [
    'buildChurchPaymentSettingsInput',
    'hasRequiredStripeConnectDetails',
    'mergeChurchPaymentSettingsForm',
    'stripeConnectAccountApi',
    "form.stripeConnectAccountApi === 'v1' ? 'v1' : 'v2'",
    'stripeConnectAccountCreationBlocker',
    'validStripeConnectCreationContactEmail',
    'Save church name, country, contact email, or website changes before creating a Stripe account.',
    'In-app Stripe account creation currently supports U.S. and Canadian parishes only.',
    'Save a valid church contact email before creating a Stripe account.',
  ])
  && includesEvery(missionControlFormConnectTestSource, [
    'blocks in-app Stripe account creation until saved U.S. or Canadian contact details are ready',
    'Save church name, country, contact email, or website changes before creating a Stripe account.',
    'Save a valid church contact email before creating a Stripe account.',
    'In-app Stripe account creation currently supports U.S. and Canadian parishes only.',
  ])
  && includesEvery(missionControlHookSource, [
    'fetchChurchPaymentSettings',
    'createChurchStripeConnectAccountAsSuperAdmin',
    'updateChurchPaymentSettingsAsSuperAdmin',
  ])
  && includesEvery(managementViewHookSource, [
    'try {\n      const returnState = createStripeConnectReturnState();',
    'createStripeConnectReturnState()',
    'createPendingStripeConnectOnboardingState(churchId, returnState)',
    'PENDING_STRIPE_CONNECT_STORAGE_KEY',
    'fetchChurchStripeConnectSetupStatus(churchId)',
    'setStripeConnectSetupStatus(status)',
    'stripeConnectSetupStatus?.stripeConnectAccountConfigured !== true',
    'copy.receipts.stripeSetupUnknown',
    'copy.receipts.stripeSetupMissing',
    'createChurchStripeConnectOnboardingLink(churchId, returnState)',
    'openExternalUrl(result.url)',
    'window.sessionStorage.removeItem(PENDING_STRIPE_CONNECT_STORAGE_KEY)',
    'stripeOnboardingLoading',
    'stripeConnectSetupStatus',
    'stripeConnectSetupStatusLoading',
    'copy.receipts.stripeOnboardingError',
    'stripeOnboardingReturnNotice',
    'stripeOnboardingRefreshNotice',
    "coerceManagementTabForRole('receipts', userRole)",
  ])
  && includesEvery(navigationSource, [
    'getStripeConnectReturnState',
    "stripeConnect')",
    'returnState',
    "return 'management';",
    'getInitialManagementTab',
  ])
  && includesEvery(authenticatedAppSource, [
    'APP_URL_OPENED_EVENT',
    'getStripeConnectReturnState',
    'parsePendingStripeConnectOnboardingState',
    'stripeConnectReturnMatchesPendingOnboarding',
    "const initialManagementTab = stripeConnectReturnSignal ? 'receipts' : null;",
    'replaceWithRootPath(window.history)',
    'waitingForStripeConnectChurch',
    'onStripeConnectReturnConsumed',
  ])
  && !authenticatedAppSource.includes('getInitialManagementTab(')
  && includesEvery(authenticatedAppTestSource, [
    'starts valid Stripe Connect returns directly on receipt management',
    "const initialManagementTab = stripeConnectReturnSignal ? 'receipts' : null;",
    "not.toContain('getInitialManagementTab(')",
  ])
  && includesEvery(appScreenContentSource, [
    'initialManagementTab',
    'stripeConnectReturnStatus',
    'stripeConnectReturnSequence',
    'onStripeConnectReturnConsumed',
  ])
  && includesEvery(managementViewSource, [
    'initialTab',
    'stripeConnectReturnStatus',
    'stripeConnectReturnSequence',
    'onStripeConnectReturnConsumed',
  ])
  && includesEvery(managementReceiptsSource, [
    'onOpenStripeConnectOnboarding',
    't.stripeOnboarding',
    'stripeConnectAccountConfigured',
    'stripeConnectAccountConfigured !== true',
    'stripeSetupStatusLabel',
    't.stripeSetupMissing',
    't.stripeSetupUnknown',
    'ExternalLink',
  ])
  && managementReceiptsTestSource.includes('keeps Stripe onboarding disabled when connected account setup status is unknown')
  && includesEvery(churchFormSheetSourceForPaymentSettings, [
    'Stripe Connect Routing',
    'Connected parish account',
    'Connected Account API',
    'Accounts v2 recipient',
    'Legacy v1 account',
    "stripeConnectAccountApi: 'v2'",
    'Create Stripe Account',
    'not written to the public church document',
    'stripeAccountCreationBlocker',
    '!canCreateStripeAccount',
  ])
  && includesEvery(firebaseRulesTestSource, [
    'churchPaymentSettings',
    'acct_private_test_123',
  ])
  && includesEvery(clientsSource, [
    'acct_KandiloV2PendingTransfers',
    'acct_KandiloV2PendingPayouts',
    'acct_KandiloV2CurrentlyDue',
    'acct_KandiloV2PastDue',
  ])
  && includesEvery(functionsCallablesTestSource, [
    'routes Checkout donations to backend-only Stripe Connect destination accounts when enabled',
    'cs_test_kandilo_connect_mock',
    "stripeSettlement: 'connected_account'",
    'refuses Checkout routing when a configured v2 Stripe Connect account is not ready',
    'acct_KandiloV2PendingTransfers',
    'acct_KandiloV2CurrentlyDue',
    "expect((await adminDb.collection('giving').get()).empty).toBe(true);",
    'keeps private church payment settings SuperAdmin-callable-only',
    'acct_KandiloFail',
    'acct_KandiloV2External',
    'creates backend-only Stripe Connect accounts before routing is enabled',
    'acct_KandiloCreated',
    "stripeConnectAccountApi: 'v2'",
    '"stripeConnectRoutingEnabled":false',
    'creates Canadian Stripe Connect accounts with country-derived defaults',
    "stripeConnectAccountCountry: 'CA'",
    'creates redacted Stripe Connect onboarding links for priests and treasurers only',
    'returns redacted Stripe Connect setup status to receipt managers',
    'returns missing Stripe Connect setup status without exposing private account settings',
    'getChurchStripeConnectSetupStatus',
    "'not_configured'",
    "returnState: 'A'.repeat(32)",
    '"stripeConnectReturnStateBound":true',
    'mock_kandilo_onboarding',
  ])
  && includesEvery(stripeConnectHelpersSource, [
    'PENDING_STRIPE_CONNECT_STORAGE_KEY',
    'createStripeConnectReturnState',
    'Secure random values are required for Stripe Connect onboarding.',
    'parsePendingStripeConnectOnboardingState',
    'stripeConnectReturnMatchesPendingOnboarding',
    'STRIPE_CONNECT_RETURN_STATE_MAX_AGE_MS',
  ])
  && !stripeConnectHelpersSource.includes('Math.random')
  && includesEvery(stripeConnectHelpersTestSource, [
    'creates bounded URL-safe return state tokens',
    'getRandomValues: undefined',
    'parses pending onboarding state only from valid JSON objects',
    'binds Stripe Connect returns to the pending church and return state',
  ])
  && productionChecklistSource.includes('backend-only `churchPaymentSettings/{churchId}`')
  && productionChecklistSource.includes('receipt-manager setup status stays redacted')
  && productionChecklistSource.includes('only after that setup status confirms a connected account is configured')
  && productionChecklistSource.includes('U.S. or Canadian Accounts v2 recipient connected account')
  && productionChecklistSource.includes('country-derived currency/locale details')
  && productionChecklistSource.includes('Mission Control defaults the account API selector to Accounts v2 recipient')
  && productionChecklistSource.includes('honors an explicit v1/v2 selection for pasted accounts')
  && productionChecklistSource.includes('Checkout re-checks the connected account readiness before creating a donation record')
  && productionChecklistSource.includes('Save those fields before creating the account')
  && projectDetailsSource.includes('backend-only `churchPaymentSettings/{churchId}`')
  && projectDetailsSource.includes('redacted connected-account setup status')
  && projectDetailsSource.includes('open Stripe-hosted onboarding only after that status confirms a configured account exists')
  && projectDetailsSource.includes('U.S. or Canadian Stripe Accounts v2 recipient connected account')
  && projectDetailsSource.includes('country-derived currency/locale details')
  && projectDetailsSource.includes('defaults pasted connected accounts to the Accounts v2 recipient API')
  && projectDetailsSource.includes('lets SuperAdmins explicitly choose the legacy v1 account path')
  && projectDetailsSource.includes('honors that selected API while preserving the stored API')
  && projectDetailsSource.includes('Checkout re-checks v2 recipient readiness before creating the donation')
  && projectDetailsSource.includes('The Mission Control create-account action is disabled while the church name, country, contact email, or website changes are unsaved')
  && qaWebFirebaseSource.includes('backend-only per-church Stripe Connect destination routing')
  && qaWebFirebaseSource.includes('redacted connected-account setup status')
  && qaWebFirebaseSource.includes('U.S. or Canadian Accounts v2 recipient connected-account creation with country-derived defaults'),
  'Per-church Stripe Connect destination routing uses backend-only payment settings, SuperAdmin callables, private account-id storage, saved-field account-creation preflights, U.S./Canadian country-derived account defaults, account existence/readiness checks, Checkout transfer_data, and session-bound receipt-manager return handling without writing connected account IDs to public church documents'
);

record(
  /payment_method_types:\s*\[\s*'card'\s*\]/.test(checkoutCreationSource)
  && checkoutCreationSource.includes("submit_type: 'donate'")
  && !checkoutCreationSource.includes('automatic_payment_methods')
  && clientsSource.includes('assertEmulatorCheckoutCreateContract')
  && clientsSource.includes('expected card-only donation Checkout parameters')
  && projectDetailsSource.includes('card-only Stripe Checkout Session')
  && productionChecklistSource.includes('pinned to card Checkout'),
  'Checkout creation pins hosted donations to immediate card payments for receipt readiness',
  'Do not allow Dashboard-enabled delayed payment methods until async success handling and delayed receipt states are implemented.'
);

record(
  includesEvery(givingSource, [
    "secrets: ['RESEND_API_KEY']",
    'yearQualifiedPrefix',
    'receiptCounterDocId(churchId, year)',
    'contributions: annualContributionRecords',
    'eligibleAmountCents: partialAmounts?.netAmountCents ?? amountCents',
    'renderTaxReceiptPdfAttachment(taxReceiptDeliveryDetails)',
    'loadRetainedTaxReceiptPdfAttachment(receiptId, receipt)',
    'retainTaxReceiptPdfAttachment(receiptRef, receiptId, receipt',
    'TAX_RECEIPT_PDF_RETENTION_FAILED_CODE',
    'attachments: [pdfAttachment]',
    'pdfTemplateVersion: TAX_RECEIPT_PDF_TEMPLATE_VERSION',
    'UNVERSIONED_TAX_RECEIPT_PDF_TEMPLATE_VERSION',
    'tax_receipt_preparation_failed',
    'TAX_RECEIPT_MISSING_RECEIPT_NUMBER_CODE',
    'function assertStoredOfficialReceiptNumber',
    'assertStoredOfficialReceiptNumber(receipt);',
    'This tax receipt has been voided and cannot be emailed.',
    'This tax receipt requires review before it can be emailed.',
    'downloadTaxReceiptPdf',
    'Only the donor can download this tax receipt.',
    'This tax receipt has been voided and cannot be downloaded.',
    'This tax receipt requires review before it can be downloaded.',
    'includesPreviouslyReceipted',
    'PREVIOUSLY_RECEIPTED_ACK_REQUIRED_CODE',
    'acknowledgePreviouslyReceipted',
    'requireAnnualPreviouslyReceiptedAcknowledgement',
    'emailSendingAt: FieldValue.serverTimestamp()',
    'taxReceiptEmailSendClaimIsFresh',
    'emailSendAttemptId',
    'taxReceiptEmailIdempotencyKey',
    '}, { idempotencyKey });',
    'CORRECTED_TAX_RECEIPT_NOTE',
    'existingAnnualTaxReceiptForResend',
    'isValidExistingSingleTaxReceiptForGiving',
    'The existing tax receipt requires review.',
    'isFullyRefundedGiving',
    'receiptCoveredGivingRefundDetails',
    'applyReceiptCoveredGivingRefundStateInTransaction',
    'receiptMatchesCurrentPartialRefundCorrectionState',
    'loadReceiptForPdfDownload',
    'STRIPE_FULL_REFUND_ANNUAL_REISSUE_REASON',
    'reissuedAnnualTaxReceiptDocId',
    'existingReissuedAnnualTaxReceiptForCurrentState',
    'isValidAnnualFullRefundReissueReceipt',
    'annualTaxReceiptSnapsForGivingIdsInTransaction',
    'voidPriorAnnualTaxReceiptsForCorrectionInTransaction',
    'validExistingAnnualTaxReceipt',
    'assertActiveChurchForTaxReceiptIssuance',
  ])
  && includesEvery(taxReceiptPdfSource, [
    'Contribution Detail',
    'Correction Note',
    'TaxReceiptPdfContribution',
    'TAX_RECEIPT_PDF_TEMPLATE_VERSION',
    'PUBLIC_TAX_RECEIPT_NUMBER_FALLBACK',
    'Generated by Kandilo.',
    'PDF template version:',
    '@pdf-lib/fontkit',
    '@fontsource/noto-sans/package.json',
    'noto-sans-cyrillic-ext-400-normal.woff',
    'noto-sans-greek-ext-400-normal.woff',
    'inputNeedsUnicodeFonts',
    'winAnsiPdfText',
  ])
  && !taxReceiptPdfSource.includes('Generated from Kandilo receipt record')
  && includesEvery(givingSource, [
    'PUBLIC_TAX_RECEIPT_NUMBER_FALLBACK',
    'function publicTaxReceiptNumber(value: unknown): string',
    'return receiptNumber && receiptNumber.toLowerCase() !== PUBLIC_TAX_RECEIPT_NUMBER_FALLBACK',
    'receiptNumber.toLowerCase() === PUBLIC_TAX_RECEIPT_NUMBER_FALLBACK',
    'function taxReceiptAlreadyEmailed(receipt: Record<string, unknown>): boolean',
    'storedOfficialReceiptNumber(receipt.receiptNumber)',
    'function receiptIdForSendResponse(receiptId: string, isOwner: boolean): string',
    'receiptNumber: publicTaxReceiptNumber(receipt.receiptNumber)',
    'taxReceiptNumber: publicTaxReceiptNumber(existing.receiptNumber)',
    'receiptId: receiptIdForSendResponse(receipt.receiptId, isOwner)',
  ])
  && (givingSource.match(/receiptId: receiptIdForSendResponse\(receipt\.receiptId, isOwner\)/g)?.length ?? 0) >= 4
  && includesEvery(functionsCallablesTestSource, [
    "'staff-annual-member'",
    'expect(JSON.stringify(staffIssuedAnnual)).not.toContain(staffIssuedAnnualReceiptId)',
    "receiptId: '',\n      receiptNumber: expectedReceiptNumber(CLOSED_ANNUAL_YEAR, 4)",
    "'staff-corrected-annual-member'",
    'expect(JSON.stringify(staffCorrectedAnnual)).not.toContain(staffCorrectedAnnualReceiptId)',
    "receiptId: '',\n      receiptNumber: expectedReceiptNumber(CLOSED_ANNUAL_YEAR, 23)",
  ])
  && !includesAny(givingSource, [
    'optionalTrimmedString(receipt.receiptNumber, 120) || receiptId',
    'receiptId: receipt.receiptId,',
    'String(existing.receiptNumber ?? receiptRef.id)',
    'String(primaryReceipt.receiptNumber ?? receiptRef.id)',
    'String(correctedReceipt.receiptNumber ?? correctedReceiptRef.id)',
    'String(existing.receiptNumber ?? correctedReceiptRef.id)',
    'String(transactionExisting.receiptNumber ?? correctedReceiptRef.id)',
    'String(existing.receiptNumber ?? reissuedReceiptRef.id)',
    'String(existing.receiptNumber ?? targetReceiptRef.id)',
  ])
  && includesEvery(taxReceiptRetentionSource, [
    'PUBLIC_TAX_RECEIPT_NUMBER_FALLBACK',
    'function publicReceiptNumberForAttachment(value: unknown): string',
    'receiptNumber.toLowerCase() !== PUBLIC_TAX_RECEIPT_NUMBER_FALLBACK',
    'export function taxReceiptPdfAttachmentFilename(receipt: Record<string, unknown>): string',
    'export function taxReceiptPdfAttachmentContentDisposition(receipt: Record<string, unknown>): string',
    'filename: taxReceiptPdfAttachmentFilename(receipt)',
    'contentDisposition: taxReceiptPdfAttachmentContentDisposition(receipt)',
    'getStorage().bucket().file(metadata.storagePath).save',
    'export function taxReceiptPdfSha256(buffer: Buffer): string',
    'retainedTaxReceiptPdfStoragePath',
    'retentionPurpose: \'official_tax_receipt_copy\'',
    'pdfStoragePath: metadata.storagePath',
    'pdfSha256: metadata.sha256',
    'pdfByteLength: metadata.byteLength',
    'pdfRetainedAt: FieldValue.serverTimestamp()',
    'isFunctionsEmulatorTestMode()',
  ])
  && !includesAny(taxReceiptRetentionSource, [
    'cleanText(receipt.receiptNumber, receiptId)',
    'filenamePart(receiptId)',
    'contentDisposition: `attachment; filename="${attachment.filename}"`',
  ])
  && includesEvery(taxReceiptRetentionTestSource, [
    'without donor identity fields',
    'computes the retained PDF hash with SHA-256',
    'does not expose internal receipt ids in retained attachment filenames when the public number is missing',
    'does not trust caller-provided retained attachment filenames for Storage content disposition',
    'tax-receipt-unassigned.pdf',
  ])
  && includesEvery(storageRulesSource, [
    'match /{allPaths=**}',
    'allow read, write: if false;',
  ])
  && includesEvery(firebaseRulesTestSource, [
    'keeps retained tax receipt PDFs backend-only for every client role',
    'const receiptPdfPath = `taxReceipts/${CHURCH_ID}/2026/giving-tax-1.pdf`;',
    'assertFails(getMetadata(ref(memberStorage, receiptPdfPath)))',
    'assertFails(getMetadata(ref(priestStorage, receiptPdfPath)))',
    'assertFails(getMetadata(ref(treasurerStorage, receiptPdfPath)))',
    'assertFails(getMetadata(ref(superAdminStorage, receiptPdfPath)))',
    "retentionPurpose: 'official_tax_receipt_copy'",
  ])
  && (givingSource.match(/pdfTemplateVersion: TAX_RECEIPT_PDF_TEMPLATE_VERSION/g)?.length ?? 0) >= 4
  && functionsCallablesTestSource.includes('pdfTemplateVersion: TAX_RECEIPT_PDF_TEMPLATE_VERSION')
  && functionsCallablesTestSource.includes("receiptData?.pdfStoragePath).toBe('taxReceipts/church-1/2026/giving-tax-1.pdf')")
  && functionsCallablesTestSource.includes('receiptData?.pdfSha256).toMatch(/^[a-f0-9]{64}$/)')
  && includesEvery(functionsCallablesTestSource, [
    'keeps full receipt PDF downloads donor-only even for receipt managers',
    'blocks stored official receipt email and PDF delivery when the receipt number is missing or fallback-only',
    'does not skip fallback-only annual receipts as already emailed in batches',
    'does not skip fallback-only corrected annual receipts as already emailed in batches',
    "receiptNumber: 'Unassigned'",
    "taxReceiptNumber: 'Unassigned'",
    "errorCode: 'tax_receipt_missing_receipt_number'",
    "expect(receiptSnap.data()).not.toHaveProperty('pdfStoragePath');",
  ])
  && receiptErrorsSource.includes("case 'tax_receipt_missing_receipt_number':")
  && receiptAuditSource.includes("tax_receipt_missing_receipt_number: 'Receipt number missing'")
  && taxReceiptAuditHelperSource.includes("'tax_receipt_missing_receipt_number'")
  && taxReceiptPdfTestSource.includes('PDF template version:')
  && taxReceiptPdfTestSource.includes("expect(pdfText).not.toContain('Generated from Kandilo receipt record')")
  && taxReceiptPdfTestSource.includes("expect(pdfText).not.toContain('annual_private_internal_123')")
  && taxReceiptPdfTestSource.includes("donorName: 'Мира Петровић'")
  && taxReceiptPdfTestSource.includes("expect(pdfText).not.toContain('????')")
  && includesEvery(givingDbSource, [
    'pdfStoragePath: string;',
    'pdfSha256: string;',
    'pdfByteLength: number | null;',
    'pdfRetainedAt: Date | null;',
  ])
  && productionChecklistSource.includes('stored `pdfTemplateVersion` printed in the footer')
  && productionChecklistSource.includes('tax_receipt_missing_receipt_number')
  && productionChecklistSource.includes('do not print internal receipt document IDs')
  && productionChecklistSource.includes('receipt-manager send responses redact raw receipt document IDs')
  && productionChecklistSource.includes('retain a backend-only PDF copy in Firebase Storage')
  && productionChecklistSource.includes('non-Latin donor legal names rendered through embedded Noto Sans subsets')
  && projectDetailsSource.includes('tax_receipt_missing_receipt_number')
  && projectDetailsSource.includes('legacy receipts without a stored marker render as `legacy-unversioned`')
  && projectDetailsSource.includes('do not print internal receipt document IDs')
  && projectDetailsSource.includes('receipt-manager send responses redact raw receipt document IDs')
  && projectDetailsSource.includes('Receipt-manager raw receipt ID redaction is covered for first-time annual issuance, first-time corrected annual issuance, and stored receipt resends')
  && projectDetailsSource.includes('retained official PDF copy')
  && emailStandardSource.includes('tax_receipt_missing_receipt_number')
  && qaWebFirebaseSource.includes('missing-official-receipt-number email/download behavior')
  && projectDetailsSource.includes('embed packaged Noto Sans subsets')
  && emailStandardSource.includes('retained backend-only PDF copy')
  && emailStandardSource.includes('donation confirmation email must explicitly say it is not an official tax receipt')
  && projectDetailsSource.includes('The donation confirmation email confirms a Stripe payment, explicitly says it is not an official tax receipt')
  && includesEvery(emailTemplatesSource, [
    'Donation confirmation from',
    'This payment confirmation is not an official tax receipt.',
    'Official tax receipts are sent separately when your parish has them available in Kandilo.',
  ])
  && includesEvery(emailTemplatesTestSource, [
    'renders donation confirmations without claiming tax receipt status',
    "expect(email.subject).toBe('Donation confirmation from St. Sava')",
    'This payment confirmation is not an official tax receipt',
  ])
  && emailTemplatesSource.includes('The attached PDF includes the itemized contribution detail for this annual receipt.')
  && emailTemplatesSource.includes('Corrected tax receipt')
  && emailTemplatesSource.includes('Original Amount')
  && includesEvery(givingScreenSource, [
    'getTaxReceipt(result.receiptId)',
    'receiptActionBlocked',
    'receiptDownloadErrorMessages',
    'setReceiptMessage(callableReceiptDeliveryErrorMessage(error, receiptDownloadErrorMessages));',
    'annualReceiptReissueAvailable',
    'donorAnnualReceiptRows({',
    'row.candidateHasEligibleGiving',
    'row.churchId',
    'taxReceiptCorrectionWarning',
    'taxReceiptCorrectedWarning',
    'taxReceiptOriginalAmount',
    'activeChurchTaxReceiptState',
    "setActiveChurchTaxReceiptReady(church?.isActive === true && receiptState === 'ready')",
	    'receiptChurchStates',
	    'taxReceiptStateForChurch(record.churchId)',
	    'receiptTimezoneForChurch',
	    'churchTimezoneForChurch: receiptTimezoneForChurch',
	    'receiptActionContextForChurch(record.churchId)',
    'receiptActionContextForChurch(receipt.churchId)',
    'taxReceiptReadyForChurch(row.churchId)',
  ])
  && donorReceiptActionsSource.includes('activeChurchTaxReceiptReady || receiptSettled')
  && givingDbSource.includes('stripeAmountRefundedCents')
    && includesEvery(managementReceiptsSource, [
      'givingNeedsTaxReceiptCorrection',
      'Summary mirrors intentionally omit covered giving IDs; the callable performs the exact duplicate guard.',
      'givingReceiptActionAvailability(',
      "taxReceiptIssuanceState === 'unsupported_jurisdiction'",
    'coveredByAnnualReceiptOnly',
    'annualReceiptActionAvailability(',
    'summaryReissueAvailable',
    'canSendCorrectedAnnualReceipt,',
    'The corrected annual batch is year-wide and privacy-preserving',
    'candidate.hasCompletedGiving',
	    'candidate.hasCorrectablePartialRefund',
    'netEligibleAmount',
    'refundedAmountCents',
  ])
  && includesEvery(receiptActionsSource, [
    'taxReceiptIssuanceReady || hasExistingSendableReceipt',
    'taxReceiptIssuanceReady || summarySettled',
	    'givingHasPartialRefundSignal(record)',
	    'givingHasCorrectablePartialRefundMetadata(record)',
    "const summaryVoided = summary?.status === 'voided';",
    'summaryReissueAvailable',
    'candidateHasEligibleGiving',
    'canIssuePartialRefundCorrection',
	    '!candidateHasEligibleGiving',
  ])
  && includesEvery(donorReceiptActionsSource, [
    'receiptReissueAvailable',
    'candidateHasEligibleGiving',
  ])
  && receiptActionsTestSource.includes('allows reissuing annual summaries voided by a full refund when eligible gifts remain')
  && donorReceiptActionsTestSource.includes('allows reissuing annual receipts voided by a full refund when eligible gifts remain')
  && functionsCallablesTestSource.includes('clears tax receipt email send claims when receipt preparation fails before provider delivery')
  && functionsCallablesTestSource.includes('reuses stale tax receipt email send attempt ids for provider idempotency')
  && functionsCallablesTestSource.includes('ignores stale partial refund events after a full refund has voided receipts')
  && functionsCallablesTestSource.includes('reissues annual tax receipts after a full refund voids a mixed annual receipt')
  && functionsCallablesTestSource.includes('voids stale annual receipts before resend when covered giving is already fully refunded')
  && functionsCallablesTestSource.includes('preserves missing annual receipt currency in voided staff summary mirrors')
  && functionsCallablesTestSource.includes('blocks stored annual receipt resends and PDF downloads when donor-year giving changes')
  && functionsCallablesTestSource.includes('voids stale fully refunded stored receipts before resend or donor PDF download')
  && functionsCallablesTestSource.includes('marks stale partially refunded single receipts review-required before resend')
  && functionsCallablesTestSource.includes('fails closed before emailing when an existing single receipt no longer matches the donation owner')
  && functionsCallablesTestSource.includes('fails closed before downloading when a stored single receipt no longer matches the donation owner')
  && functionsCallablesTestSource.includes('blocks donor PDF downloads for malformed stored receipts before retained PDF work')
	  && functionsCallablesTestSource.includes('blocks annual PDF downloads when contribution detail is missing')
	  && functionsCallablesTestSource.includes('normalizes malformed annual PDF download verification failures without safe public codes')
	  && functionsCallablesTestSource.includes('blocks annual PDF downloads when contribution detail no longer matches giving')
	  && functionsCallablesTestSource.includes("expectCallableFails(\n      callCallable(\n        'sendTaxReceipt',\n        { givingId: 'giving-preparation-fail' }")
	  && functionsCallablesTestSource.includes('reissues full-refund-voided annual receipts from church annual batches')
  && functionsCallablesTestSource.includes('voids earlier corrected annual receipts when a later partial refund changes the net amount')
	  && functionsCallablesTestSource.includes('requires acknowledgement before corrected annual batches include individually receipted gifts')
	  && functionsCallablesTestSource.includes('blocks new single-donation receipts when the donation is already covered by an annual receipt')
	  && functionsCallablesTestSource.includes('does not block single-donation receipts when an annual receipt only has an unassigned number')
	  && functionsCallablesTestSource.includes('fails closed when a completed donation is missing currency before assigning an official number')
	  && includesEvery(givingSource, [
	    'SINGLE_RECEIPT_INCLUDED_IN_ANNUAL_CODE',
	    'annualReceiptBlocksSingleReceipt',
	    '|| !storedOfficialReceiptNumber(receipt.receiptNumber)',
	    'SINGLE_RECEIPT_GIVING_CHANGED_REVIEW_CODE',
	    'ANNUAL_RECEIPT_GIVING_CHANGED_REVIEW_CODE',
	    'TAX_RECEIPT_INVALID_CURRENCY_CODE',
	    'function normalizedTaxReceiptCurrency',
	    'function assertGivingCurrencyForTaxReceipt',
	    'function assertTaxReceiptPdfRenderableReceipt',
	    'const currency = assertGivingCurrencyForTaxReceipt(giving)',
	    'const { kind, currency } = assertTaxReceiptPdfRenderableReceipt(receipt);',
	    'Tax receipt type is missing or unsupported for official PDF delivery.',
	    "assertSingleReceiptMatchesCurrentGivingForAction(receipt, 'downloaded')",
	    'async function assertSingleReceiptCurrentForPdfDownload',
	    'Tax receipt single-donation download verification failed:',
	    'async function assertSingleReceiptCurrentForEmailDelivery',
	    'isValidPartialRefundCorrectionReceipt(receipt, givingId, givingDoc.data, amounts)',
    "assertAnnualReceiptCoversCurrentGivingForAction(receipt, 'downloaded')",
    "assertAnnualReceiptCoversCurrentGivingForAction(receipt, 'emailed')",
    'async function assertAnnualReceiptCurrentForPdfDownload',
    'Tax receipt annual download verification failed:',
    'async function assertAnnualReceiptCurrentForEmailDelivery',
    'assertAnnualReceiptCoversCurrentGiving(existing, currentValidGiving, timezone)',
      'assertAnnualReceiptCoversCurrentGiving(primaryReceipt, validGiving, church.timezone)',
      'const annualReceiptSnaps = await annualTaxReceiptSnapsForGivingIdsInTransaction(tx, [givingRef.id]);',
	      'This donation is already included in an annual tax receipt',
		      "if (currencies.size !== 1 || currencies.has(''))",
		      'const currency = normalizedTaxReceiptCurrency(receipt.currency);',
		      'const currency = normalizedTaxReceiptCurrency(data.currency);',
	      'entry.hasMixedCurrency = true;',
	      'const receiptCurrency = normalizedTaxReceiptCurrency(receipt.currency);',
	      'amounts = annualGivingAmountSummary(validGiving)',
	      'currency = assertAnnualGivingSingleCurrency(validGiving)',
      'receipt.donationCount !== validGiving.length',
      'receipt.amountCents === amounts.amountCents',
      'receipt.eligibleAmountCents === amounts.eligibleAmountCents',
      'receipt.amountCents === amounts.eligibleAmountCents',
      'receipt.originalAmountCents === amounts.amountCents',
      'receipt.refundedAmountCents === amounts.refundedAmountCents',
      'function annualContributionRecordsMatchReceipt(',
      'expectedContributions = annualContributionRecords(validGiving, timezone, fallbackCurrency);',
      'optionalTrimmedString(record.dateLabel, 80) === expected.dateLabel',
      'optionalTrimmedString(record.purpose, 200) === expected.purpose',
      'annualContributionRecordsMatchReceipt(receipt, validGiving, timezone, currency)',
	    'Annual tax receipt contribution detail is missing.',
	    'const detailCode = safeHttpsErrorDetailCode(error);',
	    'const errorCode = detailCode || \'tax_receipt_preparation_failed\';',
	    'if (error instanceof HttpsError && detailCode)',
	    'Annual tax receipt contribution currency does not match the receipt currency.',
      'contributions.length !== donationCount',
      'contributionAmountTotalCents !== expectedContributionAmountTotalCents',
      'contributionEligibleTotalCents !== eligibleAmountCents',
      'primaryReceiptNeedsFullRefundVoid = true',
    'const reissueForFullRefund = primaryReceiptVoided || primaryReceiptNeedsFullRefundVoid',
    'This annual tax receipt no longer matches the donor-year donations',
  ])
  && taxReceiptBatchSourceTestSource.includes('blocks stored annual receipt resends and delivery when the current donor-year giving set changed')
  && taxReceiptBatchSourceTestSource.includes('validates stored single-donation receipts before re-emailing them')
	  && taxReceiptBatchSourceTestSource.includes('isValidExistingSingleTaxReceiptForGiving(existing, givingRef.id, giving)')
	  && taxReceiptBatchSourceTestSource.includes('assertSingleReceiptCurrentForEmailDelivery(receiptRef, receiptId, receipt, actorUid)')
  && taxReceiptBatchSourceTestSource.includes('assertSingleReceiptCurrentForPdfDownload(receipt)')
	  && taxReceiptBatchSourceTestSource.includes('function assertTaxReceiptPdfRenderableReceipt(')
	  && taxReceiptBatchSourceTestSource.includes('Annual tax receipt contribution detail is missing.')
  && taxReceiptBatchSourceTestSource.includes('taxReceiptDeliveryDetails = taxReceiptPdfInputFromReceipt(receiptId, receipt);')
  && taxReceiptBatchSourceTestSource.includes('renderTaxReceiptPdfAttachment(taxReceiptDeliveryDetails)')
  && taxReceiptBatchSourceTestSource.includes("resendSource.indexOf('const coveredRefundDetails = await receiptCoveredGivingRefundDetails(existing);')")
  && taxReceiptBatchSourceTestSource.includes('await assertAnnualReceiptCurrentForEmailDelivery(receiptRef, receiptId, receipt, actorUid);')
  && taxReceiptBatchSourceTestSource.includes('secondEmailGuard).toBeGreaterThan(firstEmailGuard)')
  && taxReceiptBatchSourceTestSource.includes("secondEmailGuard)\n      .toBeLessThan(emailSource.indexOf('await retainTaxReceiptPdfAttachment('))")
  && taxReceiptBatchSourceTestSource.includes('lastDownloadGuard).toBeGreaterThan(secondDownloadGuard)')
  && taxReceiptBatchSourceTestSource.includes("secondDownloadGuard)\n      .toBeLessThan(downloadSource.indexOf('await retainTaxReceiptPdfAttachment('))")
  && taxReceiptBatchSourceTestSource.includes('loadRetainedTaxReceiptPdfAttachment(receiptId, receipt)')
  && taxReceiptBatchSourceTestSource.includes("action: 'pdf_downloaded'")
  && taxReceiptBatchSourceTestSource.includes("noEligibleSource).not.toContain('await tx.get')")
  && taxReceiptBatchSourceTestSource.includes("issueSource.indexOf('const existingReissueSnap = await tx.get(targetReceiptRef);')")
	    && receiptErrorsSource.includes("case 'tax_receipt_pdf_retention_failed':")
	    && receiptErrorsSource.includes("case 'tax_receipt_invalid_currency':")
	    && receiptErrorsSource.includes("case 'tax_receipt_single_included_in_annual':")
    && receiptErrorsSource.includes("case 'tax_receipt_single_giving_changed_review_required':")
  && receiptErrorsSource.includes("case 'tax_receipt_annual_giving_changed_review_required':")
  && projectDetailsSource.includes('pre-send receipt preparation fails')
  && projectDetailsSource.includes('Malformed legacy receipt data without a safe public error code is normalized')
  && projectDetailsSource.includes('stale lower refund events are recorded as processed but ignored')
  && projectDetailsSource.includes('stale unvoided annual receipt is voided before a replacement is issued or emailed')
  && projectDetailsSource.includes('Stored annual receipt resend, email delivery, and donor PDF download also verify the covered donation IDs, totals, donation count, explicit supported currency, and itemized contribution lines still match the current closed-year donor-year set')
  && projectDetailsSource.includes('requires an explicit supported donation currency before reading the receipt counter')
  && projectDetailsSource.includes('Stored single-donation receipt email delivery and donor PDF download repeat the same match check')
    && projectDetailsSource.includes('Stored single-donation receipt resends also validate that the existing receipt still matches the donation')
    && projectDetailsSource.includes('New single-donation receipt issuance also fails closed when a non-voided annual receipt already covers that giving ID')
    && projectDetailsSource.includes('Email delivery and donor annual PDF downloads check this before retained/generated PDF work, again before retaining a newly generated PDF copy, and again immediately before provider delivery or the download audit log and return')
  && projectDetailsSource.includes('Donor PDF download failures use the same safe backend receipt error-code mapping as email sends')
  && projectDetailsSource.includes('Malformed donor PDF download preparation failures without a safe public error code are normalized')
  && projectDetailsSource.includes('stored receipt email and PDF paths re-check covered giving immediately before delivery/rendering/retention')
  && projectDetailsSource.includes('provider idempotency key')
  && projectDetailsSource.includes('voids any earlier corrected annual receipt')
	  && productionChecklistSource.includes('pre-send receipt preparation failures clear the send claim')
	  && productionChecklistSource.includes('Malformed legacy receipt data without a safe public error code is normalized')
  && productionChecklistSource.includes('malformed donor PDF download preparation failures without a safe public error code are normalized')
  && productionChecklistSource.includes('provider idempotency key')
  && productionChecklistSource.includes('stale lower partial refund events processed after a larger or full refund are ignored')
    && productionChecklistSource.includes('stored single-donation receipt resends fail closed before email preparation')
    && productionChecklistSource.includes('new single-donation receipt issuance fails closed when a non-voided annual receipt already covers that giving ID')
    && productionChecklistSource.includes('stored single-donation receipt email delivery and donor PDF downloads repeat the same church/donor/giving/amount/eligible/currency match check')
  && productionChecklistSource.includes('stale unvoided annual receipts are re-checked against covered giving')
  && functionsCallablesTestSource.includes('blocks stored annual receipt resends and PDF downloads when covered giving amounts change')
  && productionChecklistSource.includes('new single-donation receipt issuance fails closed before reading the receipt counter if the completed giving row lacks an explicit supported currency')
  && productionChecklistSource.includes('stored annual receipt resends, email deliveries, and PDF downloads fail closed if the donor-year giving set, totals, donation count, explicit supported currency, or itemized contribution lines changed or became missing')
  && productionChecklistSource.includes('validates annual contribution-line presence, date, purpose, currency, count, and amount/eligible totals before retained PDF lookup or generated PDF rendering')
  && productionChecklistSource.includes('annual summary mirrors preserve missing or unsupported receipt currency as review-only data instead of defaulting it to USD')
  && productionChecklistSource.includes('validates the receipt kind and explicit supported currency before retained PDF lookup or generated PDF rendering')
  && productionChecklistSource.includes('stored receipt email and PDF paths re-check covered giving before delivery/rendering/retention')
  && productionChecklistSource.includes('newly generated annual PDF copy retention after a late backdated donation, repaired giving row, missing currency, corrected amount, or stale annual line item')
  && productionChecklistSource.includes('later larger partial refunds void earlier corrected annual receipt records')
  && givingSource.includes('function nextReceiptSequenceFromCounter')
  && givingSource.includes('Tax receipt numbering is not ready')
  && functionsCallablesTestSource.includes('fails closed when the tax receipt counter is corrupt before assigning an official number')
  && projectDetailsSource.includes('receipt counter metadata is corrupt')
  && productionChecklistSource.includes('receipt counter metadata is corrupt')
  && qaWebFirebaseSource.includes('stale unvoided annual receipt voiding before resend')
  && qaWebFirebaseSource.includes('stored annual receipt resend and PDF download blocking when donor-year giving changed')
    && qaWebFirebaseSource.includes('stored single receipt match checks before resend email preparation')
    && qaWebFirebaseSource.includes('new single-donation receipt issuance blocking when a non-voided annual receipt already covers the giving ID')
    && qaWebFirebaseSource.includes('stored single receipt match checks for email delivery and donor PDF download')
  && qaWebFirebaseSource.includes('stored annual receipt email delivery runs the same donor-year guard after the send claim, before generated PDF retention, and before provider delivery')
  && qaWebFirebaseSource.includes('stored receipt email/PDF refund-state rechecks before delivery/rendering/retention')
  && qaWebFirebaseSource.includes('retained official PDF copy metadata and hash verification before resend/download')
  && qaWebFirebaseSource.includes('later larger partial refund annual corrections voiding earlier corrected annual receipt records')
  && functionsCallablesTestSource.includes('lets treasurers resend stored non-anonymous annual receipts after new issuance is disabled')
  && emailStandardSource.includes('provider idempotency key')
  && managementViewHookSource.includes("setTaxReceiptIssuanceReady(church.isActive === true && receiptState === 'ready')"),
    'Tax receipt email/PDF delivery uses RESEND_API_KEY, year-qualified receipt numbers, missing-number fail-closed guards, backend-only retained PDF copies with SHA-256 metadata and client-denied Storage rules coverage, generated PDFs with itemized annual and corrected receipt detail, prior-receipt annual flags, duplicate-send claiming, annual-covered single receipt issuance blocking, voided/review-required email resend guards, active-church new issuance gating, historical annual receipt resend and full-refund annual reissue, donor send-to-view opening, donor-only PDF downloads with invalid print/download blocking, and refund-aware receipt-manager amount display'
  );

const correctedSingleReceiptCallableSource = functionExportSource(givingSource, 'sendCorrectedTaxReceipt');
const correctedAnnualReceiptCallableSource = functionExportSource(givingSource, 'sendCorrectedAnnualTaxReceipt');
const correctedAnnualOwnerGateIndex = correctedAnnualReceiptCallableSource.indexOf('const isOwner = userId === request.auth!.uid');
const correctedAnnualActiveChurchIndex = correctedAnnualReceiptCallableSource.indexOf('const church = await assertActiveChurch(churchId);');
const correctedAnnualNonOwnerGateSource = sourceSlice(
  correctedAnnualReceiptCallableSource,
  'if (!isOwner)',
  'let receipt: TaxReceiptIssueResult'
);
record(
  includesEvery(correctedSingleReceiptCallableSource, [
    'const isOwner = donorUid === request.auth!.uid',
    'if (!isOwner)',
    'Only priests and treasurers can issue corrected tax receipts for parish donors.',
    'Corrected receipts for donations that are anonymous, unclassified, or hidden from the receipt manager can only be sent by the donor or through a privacy-preserving annual batch.',
  ])
  && includesEvery(correctedAnnualReceiptCallableSource, [
    'const isOwner = userId === request.auth!.uid',
    'if (!isOwner)',
    'Only priests and treasurers can issue corrected annual tax receipts for parish donors.',
    'Corrected annual receipts that include anonymous, unclassified, or receipt-manager-hidden donations can only be sent by the donor or through a privacy-preserving church-year batch.',
  ])
  && correctedAnnualOwnerGateIndex >= 0
  && correctedAnnualActiveChurchIndex > correctedAnnualOwnerGateIndex
  && correctedAnnualNonOwnerGateSource.includes('const church = await assertActiveChurch(churchId);')
  && includesEvery(givingScreenSource, [
    'sendCorrectedTaxReceipt',
    'sendCorrectedAnnualTaxReceipt',
    'emailCorrectedTaxReceipt',
    'emailCorrectedAnnualTaxReceipt',
  ])
  && includesEvery(emailStandardSource, [
    'donors can self-serve corrected single-donation and annual receipts for their own partially refunded gifts',
    'Priests and treasurers can send corrected single-donation and individual annual receipts only for receipt-manager-visible explicitly non-anonymous donor records',
    'privacy-preserving corrected annual batch path for anonymous, unclassified, or receipt-manager-hidden donor-years',
  ])
  && includesEvery(projectDetailsSource, [
    'Donors can self-serve corrected receipts for their own anonymous, unclassified, or receipt-manager-hidden gifts',
    'donors can self-serve corrected receipts for their own net eligible amount',
  ])
  && includesEvery(functionsCallablesTestSource, [
    "'sendCorrectedTaxReceipt',\n        { givingId: 'giving-partial-corrected' },\n        { uid: 'admin-1', email: 'admin@example.com' }",
    "'sendCorrectedAnnualTaxReceipt',\n        { churchId: CHURCH_ID, userId: 'member-1', year: CLOSED_ANNUAL_YEAR },\n        { uid: 'admin-1', email: 'admin@example.com' }",
  ])
  && donorGivingSubscriptionSource.includes('callback(snap.docs.map(mapGivingRecord));')
  && !donorGivingSubscriptionSource.includes('record.anonymous === false')
  && donorAnnualSummarySubscriptionSource.includes("callback(snap.docs.map(mapTaxReceiptSummaryRecord).filter((record) => record.kind === 'annual'));")
  && !donorAnnualSummarySubscriptionSource.includes('record.donorAnonymous === false')
  && includesEvery(givingDbSubscriptionTestSource, [
    'keeps anonymous giving visible in the donor-owned giving subscription',
    'keeps anonymous annual summaries visible in the donor-owned annual subscription',
    "id: 'giving-private'",
    "receiptId: 'annual-private'",
    'anonymous: true',
    'donorAnonymous: true',
  ]),
  'Donor portal supports owner self-service corrected receipts, including historical corrected annual re-sends, while staff corrected receipt sends remain privacy-scoped'
);

record(
  checkoutCreationSource.includes("donorEmail: '',")
  && checkoutCreationSource.includes('publicDonorLabelCandidate')
  && !checkoutCreationSource.includes('|| customerEmail')
  && givingSource.includes('function givingIsExplicitlyNonAnonymous')
  && givingSource.includes('label !== ANONYMOUS_DONOR_LABEL')
  && givingSource.includes('return publicDonorLabelCandidate(giving.donorName)')
  && givingSource.includes('if (!givingIsExplicitlyNonAnonymous(giving))')
  && givingSource.includes('return ANONYMOUS_DONOR_LABEL;')
  && givingSource.includes('giving.donorNamePublicSafe === true')
  && givingSource.includes('donorNamePublicSafe: !anonymous')
  && givingSource.includes('churchReceiptVisible: !anonymous')
  && givingSource.includes('RECEIPT_MANAGER_GIVING_SAFE_VERSION = 1')
  && givingSource.includes('TAX_RECEIPT_MANAGER_SUMMARY_SAFE_VERSION = 2')
  && givingSource.includes('receiptManagerGivingSafeVersion: anonymous ? 0 : RECEIPT_MANAGER_GIVING_SAFE_VERSION')
  && givingSource.includes('giving.receiptManagerGivingSafeVersion === RECEIPT_MANAGER_GIVING_SAFE_VERSION')
  && givingSource.includes('churchReceiptVisible: false')
  && givingSource.includes('churchReceiptVisible: true')
  && givingSource.includes('!givingIsSafeForTargetedReceiptManagerAction(docSnap.data())')
  && givingSource.includes('function annualReceiptSummaryPrivacyOverridesFromGivingRecords')
  && givingSource.includes('function annualReceiptSummaryPrivacyOverridesFromCoveredGivingRecords')
  && givingSource.includes('function annualReceiptSummaryPrivacyOverridesFromCoveredGivingDocs')
  && givingSource.includes('summaryPrivacyOverrides: AnnualReceiptSummaryPrivacyOverrides = annualReceiptSummaryDonorOnlyPrivacyOverrides()')
  && givingSource.includes('annualReceiptSummaryPrivacyOverridesFromCoveredGivingDocs(receipt, refundDetails.givingDocs)')
  && givingSource.includes('givingRecords.length === 0')
  && givingSource.includes('givingRecords.some(({ data }) => !givingIsSafeForTargetedReceiptManagerAction(data))')
  && givingSource.includes('...annualReceiptSummaryPrivacyOverridesFromGivingRecords(validGiving, receiptData)')
  && givingSource.includes('receipt.donorAnonymous !== false || !hasCoveredGivingIds')
  && givingSource.includes('const TAX_RECEIPT_SUMMARY_PRIVATE_FIELDS = [')
  && givingSource.includes('TAX_RECEIPT_SUMMARY_PRIVATE_FIELDS.map((field) => [field, FieldValue.delete()])')
  && givingSource.includes('function taxReceiptRecordIsCorrected')
  && givingSource.includes('correctedReceipt: taxReceiptRecordIsCorrected(receipt)')
  && givingSource.includes('donorLabelPublicSafe: donorAnonymous === false')
  && givingSource.includes('receiptManagerSummarySafe: donorAnonymous === false')
  && givingSource.includes('receiptManagerSummarySafeVersion: donorAnonymous === false ? TAX_RECEIPT_MANAGER_SUMMARY_SAFE_VERSION : 0')
  && givingSource.includes('summary.donorLabelPublicSafe = summary.donorAnonymous === false')
  && givingSource.includes('summary.receiptManagerSummarySafe = summary.donorAnonymous === false')
  && givingSource.includes('summary.receiptManagerSummarySafeVersion = summary.donorAnonymous === false ? TAX_RECEIPT_MANAGER_SUMMARY_SAFE_VERSION : 0')
  && givingDbSource.includes("const ANONYMOUS_DONOR_LABEL = 'Anonymous donor';")
  && givingDbSource.includes('trimmed !== ANONYMOUS_DONOR_LABEL')
  && givingDbSource.includes('publicDonorLabel(data.donorName)')
  && givingDbSource.includes('correctedReceipt: data.correctedReceipt === true')
  && givingDbSource.includes("donorEmail: '',")
  && churchGivingSubscriptionSource.includes("where('churchReceiptVisible', '==', true)")
  && churchGivingSubscriptionSource.includes("where('donorEmail', '==', '')")
  && churchGivingSubscriptionSource.includes("where('donorNamePublicSafe', '==', true)")
  && churchGivingSubscriptionSource.includes("where('receiptManagerGivingSafeVersion', '==', 1)")
  && churchGivingSubscriptionSource.includes("where('status', 'in', ['completed', 'refunded'])")
  && givingDbSource.includes('publicDonorLabel(data.donorLabel)')
  && givingDbSource.includes('const anonymous = data.anonymous !== false')
  && givingDbSource.includes('const donorName = anonymous ?')
  && givingDbSource.includes('donorNamePublicSafe:')
  && givingDbSource.includes('data.donorNamePublicSafe === true')
  && givingDbSource.includes('const donorAnonymous = data.donorAnonymous !== false')
  && givingDbSource.includes("const donorLabel = donorAnonymous ? '' : publicDonorLabel(data.donorLabel);")
  && givingDbSource.includes('donorLabel,')
  && givingDbSource.includes('const receiptManagerGivingSafeVersion =')
  && givingDbSource.includes('donorNamePublicSafe && data.receiptManagerGivingSafeVersion === 1 ? 1 : 0')
  && givingDbSource.includes('data.churchReceiptVisible === true')
  && givingDbSource.includes('receiptManagerGivingSafeVersion === 1')
  && givingDbSource.includes('const donorLabelPublicSafe =')
  && givingDbSource.includes("donorAnonymous === false\n    && donorLabel !== ''\n    && data.donorLabelPublicSafe === true")
  && givingDbSource.includes('const receiptManagerSummarySafe =')
  && givingDbSource.includes('donorLabelPublicSafe\n    && data.receiptManagerSummarySafe === true')
  && givingDbSource.includes('const receiptManagerSummarySafeVersion =')
  && givingDbSource.includes('receiptManagerSummarySafe && data.receiptManagerSummarySafeVersion === 2 ? 2 : 0')
  && churchAnnualSummarySubscriptionSource.includes("where('kind', '==', 'annual')")
  && churchAnnualSummarySubscriptionSource.includes("where('churchReceiptVisible', '==', true)")
  && churchAnnualSummarySubscriptionSource.includes("where('donorLabelPublicSafe', '==', true)")
  && churchAnnualSummarySubscriptionSource.includes("where('receiptManagerSummarySafe', '==', true)")
  && churchAnnualSummarySubscriptionSource.includes("where('receiptManagerSummarySafeVersion', '==', 2)")
  && churchGivingSubscriptionSource.includes('record.anonymous === false')
  && churchGivingSubscriptionSource.includes('record.churchReceiptVisible === true')
  && churchGivingSubscriptionSource.includes("record.donorEmail === ''")
  && churchGivingSubscriptionSource.includes('record.donorNamePublicSafe === true')
  && churchGivingSubscriptionSource.includes('record.receiptManagerGivingSafeVersion === 1')
  && churchGivingSubscriptionSource.includes("record.donorName !== ''")
  && churchGivingSubscriptionSource.includes("record.status === 'completed' || record.status === 'refunded'")
  && churchAnnualSummarySubscriptionSource.includes("record.kind === 'annual'")
  && churchAnnualSummarySubscriptionSource.includes('record.donorAnonymous === false')
  && churchAnnualSummarySubscriptionSource.includes('record.churchReceiptVisible === true')
  && churchAnnualSummarySubscriptionSource.includes('record.donorLabelPublicSafe === true')
  && churchAnnualSummarySubscriptionSource.includes("record.donorLabel !== ''")
  && churchAnnualSummarySubscriptionSource.includes('record.receiptManagerSummarySafe === true')
  && churchAnnualSummarySubscriptionSource.includes('record.receiptManagerSummarySafeVersion === 2')
  && includesEvery(givingDbSubscriptionTestSource, [
    'constrains church receipt subscriptions to backend-marked public rows',
    "id: 'giving-private'",
    "docSnapshot('giving-legacy-hidden'",
    "docSnapshot('giving-email-label-hidden'",
    "docSnapshot('giving-reserved-label-hidden'",
    "field: 'donorNamePublicSafe', operator: '==', value: true",
    "docSnapshot('single-malformed-visible'",
    "receiptId: 'annual-private'",
    "receiptId: 'annual-legacy-hidden'",
    "receiptId: 'annual-unsafe-visible'",
    "receiptId: 'annual-marker-only-visible'",
    "receiptId: 'annual-email-label-safe-marker-hidden'",
    "receiptId: 'annual-reserved-label-safe-marker-hidden'",
    'donorLabelPublicSafe: false',
    'receiptManagerSummarySafe: false',
    'receiptManagerSummarySafeVersion: 0',
    "field: 'receiptManagerGivingSafeVersion', operator: '==', value: 1",
    "field: 'donorLabelPublicSafe', operator: '==', value: true",
    "field: 'receiptManagerSummarySafe', operator: '==', value: true",
    "field: 'receiptManagerSummarySafeVersion', operator: '==', value: 2",
  ])
  && includesEvery(firestoreMappersTestSource, [
    'strips reserved anonymous labels from explicitly non-anonymous public receipt labels',
    "docSnapshot('giving-reserved-anonymous-label'",
    "docSnapshot('summary-reserved-anonymous-label'",
    'donorNamePublicSafe: true',
    'donorNamePublicSafe: false',
    'donorLabelPublicSafe: true',
    'receiptManagerSummarySafe: true',
    'receiptManagerSummarySafeVersion: 2',
    'donorLabelPublicSafe: false',
    'receiptManagerSummarySafe: false',
    'receiptManagerSummarySafeVersion: 0',
  ])
  && includesEvery(functionsCallablesTestSource, [
    'donorNamePublicSafe: false',
    'donorNamePublicSafe: true',
    'annual-tax-hidden-email-label',
    'donorLabelPublicSafe: false',
    'donorLabelPublicSafe: true',
    'receiptManagerSummarySafeVersion: 0',
    'receiptManagerSummarySafeVersion: 2',
    "receiptId: 'annual-refund-webhook'",
    "receiptId: 'annual-partial-refund-webhook'",
    "expect(summaryDoc.data()).not.toHaveProperty('donorEmail');",
    "expect(summaryDoc.data()).not.toHaveProperty('organizationTaxId');",
    "expect(summaryDoc.data()).not.toHaveProperty('pdfStoragePath');",
    'does not use reserved anonymous donor labels for explicitly non-anonymous receipt labels',
    "giving/reserved-anonymous-label-single",
    "giving/reserved-anonymous-label-annual",
    "expect(annualReceiptSnap.data()?.donorLabel).not.toBe('Anonymous donor');",
  ])
  && taxReceiptEmailSource.includes("givingUpdate.donorEmail = '';")
  && taxReceiptEmailSource.includes('givingUpdate.donorNamePublicSafe = true')
  && taxReceiptEmailSource.includes('givingUpdate.donorNamePublicSafe = false')
  && taxReceiptEmailSource.includes('givingUpdate.churchReceiptVisible = true')
  && taxReceiptEmailSource.includes('givingUpdate.churchReceiptVisible = false')
  && taxReceiptEmailSource.includes('givingUpdate.receiptManagerGivingSafeVersion = RECEIPT_MANAGER_GIVING_SAFE_VERSION')
  && taxReceiptEmailSource.includes('givingUpdate.receiptManagerGivingSafeVersion = 0')
  && includesEvery(emailStandardSource, [
    'receiptManagerGivingSafeVersion=1',
    'current giving safe version',
    'receiptManagerSummarySafeVersion=2',
    'current versioned safe markers',
  ])
  && givingSource.includes('function publicDisplayNameCandidate(value: unknown): string')
  && givingSource.includes('publicDisplayNameCandidate(user.displayName)')
  && givingSource.includes('publicDisplayNameCandidate(member.displayName)')
  && givingSource.includes('function annualPublicDonorIdentity(')
  && givingSource.includes('validGiving.some(({ data }) => !givingIsExplicitlyNonAnonymous(data))')
  && givingSource.includes('annualReceiptSummaryPrivacyOverridesFromGivingRecords(')
  && givingSource.includes('givingRecords.some(({ data }) => !givingIsSafeForTargetedReceiptManagerAction(data))')
  && !taxReceiptEmailSource.includes('givingUpdate.donorEmail = authDonorEmail')
    && managementReceiptsSource.includes('t.donorEmailProtected')
    && managementReceiptsSource.includes('record.churchReceiptVisible === true')
    && managementReceiptsSource.includes("record.donorEmail === ''")
    && managementReceiptsSource.includes('record.donorNamePublicSafe === true')
    && managementReceiptsSource.includes('record.receiptManagerGivingSafeVersion === 1')
    && managementReceiptsSource.includes('receiptManagerPublicLabelSafe(record.donorName)')
    && managementReceiptsSource.includes("record.status === 'completed' || record.status === 'refunded'")
    && managementReceiptsSource.includes('summary.churchReceiptVisible === true')
    && managementReceiptsSource.includes('summary.donorLabelPublicSafe === true')
    && managementReceiptsSource.includes('receiptManagerPublicLabelSafe(summary.donorLabel)')
    && managementReceiptsSource.includes('summary.receiptManagerSummarySafe === true')
    && managementReceiptsSource.includes('summary.receiptManagerSummarySafeVersion === 2')
    && managementReceiptsSource.includes('t.staffPrivacyNote')
    && localizationSource.includes('Receipt managers can send and resend official receipts by email')
    && localizationSource.includes('donor account email, legal name/address, and retained PDFs stay donor-only')
    && includesEvery(managementIndividualReceiptSendSource, [
      'await sendTaxReceipt({ givingId });',
      'await sendCorrectedTaxReceipt({ givingId });',
      'await sendAnnualTaxReceipt({ churchId, userId, year, acknowledgePreviouslyReceipted });',
      'await sendCorrectedAnnualTaxReceipt({ churchId, userId, year, acknowledgePreviouslyReceipted });',
    ])
    && !managementIndividualReceiptSendSource.includes('result.receiptId')
    && !managementIndividualReceiptSendSource.includes('getTaxReceipt(')
    && !managementIndividualReceiptSendSource.includes('downloadTaxReceiptPdf(')
    && !managementReceiptsSource.includes('getTaxReceipt')
    && !managementReceiptsSource.includes('downloadTaxReceiptPdf')
    && !managementReceiptsSource.includes('onViewReceipt')
    && !managementReceiptsSource.includes('onDownloadReceipt')
    && !managementReceiptsSource.includes('Eye,')
    && !managementReceiptsSource.includes('Download,')
    && !managementReceiptsSource.includes('Printer,')
    && includesEvery(managementReceiptsTestSource, [
      'keeps receipt manager send-focused without full receipt view or download hooks',
      'Receipt managers can send and resend official receipts by email',
      'donor account email, legal name/address, and retained PDFs stay donor-only',
      "expect(managementSendHookSource).toContain('await sendTaxReceipt({ givingId });');",
      "expect(managementSendHookSource).not.toContain('result.receiptId');",
      "expect(managementSendHookSource).not.toContain('getTaxReceipt(');",
      "expect(managementSendHookSource).not.toContain('downloadTaxReceiptPdf(');",
      "expect(source).not.toContain('getTaxReceipt');",
      "expect(source).not.toContain('downloadTaxReceiptPdf');",
      "expect(source).not.toContain('onViewReceipt');",
      "expect(html).not.toContain('View tax receipt');",
      "STN-2025-HIDDEN-BLANK-LABEL",
      'defensively excludes private donor rows from church receipt views',
      'STN-2025-HIDDEN-SINGLE',
      'STN-2025-HIDDEN-ANNUAL',
      'STN-2025-HIDDEN-LEGACY',
    'STN-2025-HIDDEN-LEGACY-ANNUAL',
    "expect(html).not.toContain('Pending Donor');",
	    "expect(html).not.toContain('Failed Donor');",
	    "expect(html).not.toContain('Hidden Donor');",
	    "expect(html).not.toContain('Legacy Donor');",
	    "expect(html).not.toContain('Anonymous donor');",
	    "expect(html).not.toContain('member-email-label@example.com');",
	    'STN-2025-HIDDEN-EMAIL-LABEL-ANNUAL',
	    'STN-2025-HIDDEN-RESERVED-LABEL',
	    ])
    && includesEvery(functionsCallablesTestSource, [
      'does not use email-shaped profile or membership display names as receipt labels',
      "displayName: 'Contact member@example.com'",
      "donorName: 'Parishioner'",
      "donorLabel: 'Parishioner'",
      'does not use reserved anonymous donor labels for explicitly non-anonymous receipt labels',
      'does not expose legacy email-shaped donor names in receipt labels',
      "donorAnonymous: false",
      "donorLabel: 'Anonymous donor'",
      'receiptManagerSummarySafeVersion: 0',
	    ])
    && managementReceiptsSource.includes('receiptManagerPublicLabelSafe')
    && managementReceiptsSource.includes('RESERVED_ANONYMOUS_DONOR_LABEL')
    && !managementReceiptsSource.includes('record.donorEmail || t.noEmail')
    && !managementReceiptsSource.includes('summary.userId || t.unknownDonor')
    && projectDetailsSource.includes('reserved `Anonymous donor` label on a non-anonymous mirror')
    && productionChecklistSource.includes('reserved `Anonymous donor` label as unsafe on explicitly non-anonymous giving rows')
    && qaWebFirebaseSource.includes('reserved `Anonymous donor` label as unsafe on explicitly non-anonymous giving rows'),
    'Church-facing giving records and receipt-manager UI keep donor email/private rows and full-receipt view/download actions out of operational views and donor labels, require backend-owned church receipt visibility for staff reads, and keep official receipt emails on Auth/private receipt data'
);

record(
  rootPackage?.scripts?.['audit:tax-receipts'] === 'node scripts/audit-tax-receipt-visibility.mjs'
  && includesEvery(visibilityAuditSource, [
    "const expectedProjectId = 'kandilo-2f7a9';",
    'planTaxReceiptVisibilityRepairs',
    'clear_church_facing_donor_email',
    'make_explicit_non_anonymous_giving_visible',
    'set_giving_label_safe_marker',
    'clear_giving_label_safe_marker',
    'set_giving_safe_version',
    'clear_giving_safe_version',
    'hide_anonymous_or_unclassified_giving',
    'givingSafeForReceiptManagerAnnualSummary',
    'coveredGivingSafeForReceiptManagerAnnualSummary',
    'giving.donorNamePublicSafe === true',
    'giving.receiptManagerGivingSafeVersion === receiptManagerGivingSafeVersion',
    'const receiptManagerGivingSafeVersion = 1;',
    'const receiptManagerSummarySafeVersionCurrent = 2;',
    'const coveredGivingLabel = givingIdsForAnnualReceipt(summary, receipt)',
    'publicDonorLabelCandidate(givingById.get(givingId)?.donorName)',
    "const donorProfileIncompleteReceiptError = 'tax_receipt_donor_profile_incomplete';",
    "const missingEmailOrAmountReceiptError = 'tax_receipt_missing_email_or_amount';",
    'annualReceiptIssuanceGapErrors',
    'isAnnualIssuanceGapRetrySummary',
    'annualIssuanceGapSummaryHasStaffSafeMarkers',
    'annualIssuanceGapSummaryVisibilityRepair',
    'const churchReceiptVisible = donorAnonymous === false;',
    'const donorLabelPublicSafe = donorAnonymous === false;',
    'const receiptManagerSummarySafe = donorAnonymous === false;',
    'const receiptManagerSummarySafeVersion = receiptManagerSummarySafe ? receiptManagerSummarySafeVersionCurrent : 0;',
    'annualSummaryPrivateFields',
    'givingPrivatePaymentFields',
    'annualSummaryJurisdictionFromReceipt',
    'mirror_annual_summary_jurisdiction',
    'mirrors the non-private receipt jurisdiction onto annual summary rows so unsupported-jurisdiction actions fail closed.',
    'receiptManagerGivingSafeVersion',
    'receiptManagerSummarySafe',
    'receiptManagerSummarySafeVersion',
    'donorLabelPublicSafe',
    'set_annual_summary_safe_marker',
    'clear_annual_summary_safe_marker',
    'set_annual_summary_safe_version',
    'clear_annual_summary_safe_version',
    'set_annual_summary_label_safe_marker',
    'clear_annual_summary_label_safe_marker',
    'clear_unissued_annual_retry_receipt_number',
    'remove_private_annual_summary_fields',
    'remove_private_giving_payment_fields',
    'deleteFields',
    'FieldValue.delete()',
    'publicDonorLabelCandidate',
    'FieldPath.documentId()',
    'defaultPageSize',
    'rawReadCount',
    "readCollectionDocs(db, 'giving', options)",
    "Refusing to repair without --confirm-project",
    'failOnRepairs',
    'taxReceiptVisibilityAuditFailureReasons',
    'taxReceiptVisibilityRepairBlockers',
    'taxReceiptVisibilityRepairConfirmationBlockers',
    'taxReceiptVisibilityRepairCommand',
    'taxReceiptVisibilityReadOnlyCompletionMessage',
    'validateTaxReceiptVisibilityAuditArgs',
    'taxReceiptVisibilityPostRepairVerificationFailureReasons',
    'verifyTaxReceiptVisibilityRepairsApplied',
    'Audit reached --limit',
    'Google Application Default Credentials are not available',
    'read-only Firestore REST audit through Firebase CLI auth',
    'confirmed Firestore REST repair through Firebase CLI auth',
    'readFirebaseCliAccessTokenForAudit',
    'readCollectionDocsWithFirestoreRest',
    'applyTaxReceiptVisibilityRepairsWithFirestoreRest',
    'mask.fieldPaths',
    'donorNamePublicSafe',
    'receiptManagerGivingSafeVersion',
    'documents:commit',
    'updateMask',
    'REQUEST_TIME',
    'currentDocument',
    'gcloud auth application-default login',
    'GOOGLE_APPLICATION_CREDENTIALS',
    'Repair mode refuses to write after incomplete scans',
    'Repair mode requires --confirm-repair-count',
    'Repair mode requires a complete reviewed scan so visibility is never changed with missing giving context or stale repair counts.',
    '!/^\\d+$/.test(value)',
    'Unknown argument',
    'Unexpected positional argument',
    'does not accept a value',
    'Run repair after review: ${repairCommand}',
    'Then rerun: npm run audit:tax-receipts -- --fail-on-repairs',
    'Read-only audit complete. No legacy receipt visibility repairs are needed.',
    'Post-repair verification passed; no legacy receipt visibility repairs remain.',
    'Post-repair verification must prove the receipt visibility gate is clean before deployment.',
    'Default mode is read-only',
    'FieldValue.serverTimestamp()',
    'Planned redacted repair effects:',
    'audit output omits donor emails, giving IDs, receipt IDs, tax identifiers, and receipt contents.',
  ])
  && matchesEvery(visibilityAuditSource, [
    /taxReceiptSummaries:\s*\[[\s\S]*?'jurisdiction'[\s\S]*?\]/,
    /taxReceipts:\s*\[[^\]]*'jurisdiction'[^\]]*\]/,
  ])
  && includesEvery(visibilityAuditTestSource, [
    'annual-giving-label-fallback',
    "donorLabel: 'Sophia Markovic'",
  ])
  && includesEvery(visibilityAuditTestSource, [
    'repairs church-visible giving metadata without exposing donor emails',
    'fails annual summary mirrors closed when covered giving is private, unclassified, or receipt-manager-hidden',
    'annual-hidden-label-giving',
    'Contact hidden@example.com',
    'annual-missing-giving-ids',
    'annual-profile-required-safe',
    'annual-verified-email-required-safe',
    'annual-profile-required-private-fields',
    'annual-profile-required-unsafe-marker',
    "emailError: 'tax_receipt_donor_profile_incomplete'",
    "emailError: 'tax_receipt_missing_email_or_amount'",
    "receiptId: ''",
    "receiptNumber: 'SHOULD-NOT-EXIST'",
    'clear_unissued_annual_retry_receipt_number',
    'donorLabelPublicSafe: true',
    'donorLabelPublicSafe: false',
    'receiptManagerSummarySafe: true',
    'receiptManagerSummarySafe: false',
    'receiptManagerSummarySafeVersion: 2',
    'receiptManagerSummarySafeVersion: 0',
    "jurisdiction: 'US'",
    "jurisdiction: 'CA'",
    'mirror_annual_summary_jurisdiction',
    'remove_private_annual_summary_fields',
    'deleteFields: [',
    "'pdfStoragePath'",
    "'stripeSessionId'",
    "'stripeCheckoutSessionId'",
    "'stripeCheckoutUrl'",
    "'stripeCheckoutSessionUrl'",
    "'stripePaymentIntentId'",
    "'stripeChargeId'",
    "'stripeCustomerId'",
    "'stripeConnectAccountId'",
    "'stripeRefundId'",
    "'stripeRefundedChargeId'",
    "'checkoutSessionId'",
    "'checkoutUrl'",
    "'paymentIntentId'",
    "'chargeId'",
    "'refundId'",
    'paymentMetadataUpdate',
    'givingPaymentMetadata',
    'firestoreRestWritesForRepair',
    "'organizationTaxId'",
    "'emailSendingAt'",
    "'emailSendAttemptId'",
    'keeps the repair mode guarded behind explicit production confirmation',
    'can fail a read-only release gate when repairs remain or the scan is incomplete',
    'prints actionable credential guidance instead of a raw stack trace',
    'encodes Firestore REST repair values without broad document replacement',
    'builds Firestore REST list URLs with field masks and page tokens',
    'paginates Firestore REST collection scans without leaking the access token',
    'marks Firestore REST scans incomplete when the read cap stops before the next page',
    'applies Firestore REST repairs through commit batches without leaking the access token',
    'blocks repair mode when the scan is incomplete',
    'requires the reviewed repair count before production repair writes',
    'keeps suggested production repair commands scoped to the reviewed scan',
    'does not print a repair command after a clean read-only production audit',
    'prints redacted repair effect descriptions without private identifiers',
    'rejects mistyped audit arguments before production reads or repairs',
    "expect(() => parseTaxReceiptVisibilityAuditArgs(['--limit', '5000extra'])).toThrow(",
    "expect(() => parseTaxReceiptVisibilityAuditArgs(['--confirm-repair-count', '1repair'])).toThrow(",
    'verifies repair mode before treating production visibility metadata as clean',
    'paginates collection scans and only reports the safety cap when more raw docs remain',
    'donorEmail: \'\',',
    'donorNamePublicSafe',
    'churchReceiptVisible: false',
  ])
  && includesEvery(productionChecklistSource, [
    'npm run audit:tax-receipts -- --fail-on-repairs',
    'Firebase CLI auth',
    'clean audits print that no legacy receipt visibility repairs are needed',
    'repair mode can use the same fallback only after',
    '--confirm-repair-count',
    '--church',
    '--page-size',
    'unknown or mistyped audit arguments',
    'immediately re-scans',
    'prints redacted planned repair effects',
    'clears church-facing donor emails',
    'preserves raw Stripe session/payment/charge identifiers and checkout URL aliases into backend-only `givingPaymentMetadata/{givingId}` before removing them from staff-readable giving rows',
    'covered giving is receipt-manager-safe',
    'sanitizes embedded email-shaped public labels',
    'donorLabelPublicSafe',
    'receiptManagerSummarySafe',
    'receiptManagerSummarySafeVersion',
    'backend summary rebuilds sanitize labels and delete private fields',
    'preserves already marker-safe blank-`receiptId` annual issuance-gap retry summaries without covered-giving proof while still deleting private fields',
    'paginated read-only legacy visibility audit',
  ])
  && projectDetailsSource.includes('audit-tax-receipt-visibility.mjs')
  && projectDetailsSource.includes('Firestore REST fallback using Firebase CLI auth')
  && projectDetailsSource.includes('Clean `npm run audit:tax-receipts -- --fail-on-repairs` runs now print that no legacy receipt visibility repairs are needed')
  && projectDetailsSource.includes('confirmed repair mode can use the same REST fallback')
  && projectDetailsSource.includes('--confirm-repair-count')
  && projectDetailsSource.includes('same `--church`, `--limit`, and `--page-size` scope')
  && projectDetailsSource.includes('unknown or mistyped audit arguments')
  && readmeSource.includes('prints redacted planned repair effects without donor emails, giving IDs, receipt IDs, tax identifiers, Stripe identifiers, checkout URL aliases, or receipt contents')
  && readmeSource.includes('clean audits print that no repairs are needed')
  && readmeSource.includes('preserves legacy raw Stripe payment identifiers and checkout URL aliases into backend-only payment metadata before removing them from staff-readable giving rows')
  && readmeSource.includes('mirrors non-private annual receipt jurisdiction onto annual summary rows')
  && productionChecklistSource.includes('review the aggregate counts and redacted planned repair effects')
  && productionChecklistSource.includes('omits donor emails, giving IDs, receipt IDs, tax identifiers, and receipt contents from terminal output')
  && productionChecklistSource.includes('mirrors non-private annual receipt jurisdiction onto annual summary rows')
  && projectDetailsSource.includes('receiptManagerSummarySafe')
  && projectDetailsSource.includes('donorLabelPublicSafe')
  && projectDetailsSource.includes('`receiptManagerSummarySafeVersion`')
  && projectDetailsSource.includes('Annual summary mirrors may also carry the non-private `jurisdiction`')
  && projectDetailsSource.includes('delete private full-receipt fields before setting the current marker version when rebuilding summary mirrors')
  && projectDetailsSource.includes('marker-safe blank-`receiptId` annual issuance-gap retry preservation')
  && projectDetailsSource.includes('Guarded legacy receipt visibility repairs merge any raw Stripe identifiers and checkout URL aliases from an old `giving/{givingId}` row into `givingPaymentMetadata/{givingId}`')
  && projectDetailsSource.includes('public-label safety marker')
  && projectDetailsSource.includes('the paginated read-only `audit:tax-receipts` legacy visibility audit with Firestore REST fallback using Firebase CLI auth, guarded complete-scan repair mode, confirmed repair REST fallback, exact `--confirm-repair-count` acknowledgement, post-repair clean re-scan verification, versioned giving safe marker repair, safe-marker annual summary repair, marker-safe blank-`receiptId` annual issuance-gap retry preservation, private annual summary field cleanup, backend-only preservation plus cleanup for legacy raw Stripe giving payment identifiers and checkout URL aliases, and `--fail-on-repairs` gate')
  && qaWebFirebaseSource.includes('guarded legacy visibility audit/repair coverage')
  && qaWebFirebaseSource.includes('Firebase CLI auth fallback')
  && qaWebFirebaseSource.includes('confirmed repair fallback')
  && qaWebFirebaseSource.includes('redacted planned repair effects that omit donor emails/giving IDs/receipt IDs/tax identifiers/receipt contents')
  && qaWebFirebaseSource.includes('post-repair clean re-scan verification')
  && qaWebFirebaseSource.includes('preserving raw Stripe identifiers and checkout URL aliases into backend-only payment metadata before removing them from staff-readable giving rows')
  && qaWebFirebaseSource.includes('preserving marker-safe blank-`receiptId` annual issuance-gap retry summaries')
  && qaWebFirebaseSource.includes('mirroring non-private annual receipt jurisdiction onto annual summary rows')
  && qaWebFirebaseSource.includes('the paginated `npm run audit:tax-receipts -- --fail-on-repairs`'),
  'Legacy tax receipt visibility audit is read-only by default with Firebase CLI auth fallback, reports clean audits clearly, repair-confirmed for production with guarded REST fallback, exact repair-count confirmation, post-repair clean re-scan verification, complete-scan guarded before writes, clears church-facing donor emails, preserves legacy Stripe identifiers in backend-only payment metadata before staff-readable cleanup, mirrors non-private annual receipt jurisdiction onto annual summaries, sets versioned staff-safe giving and annual summary markers, preserves marker-safe annual issuance-gap retry summaries, removes private annual summary fields, only makes receipt-manager-safe giving/annual summaries staff-visible, and can block release when repairs or incomplete scans remain'
);

record(
  includesEvery(givingSource, [
    'taxSettings?.autoIssue',
    "taxReceiptStatus: 'ready'",
    'taxReceiptError: FieldValue.delete()',
    'taxReceiptEmailError: FieldValue.delete()',
    "taxReceiptStatus: 'not_configured'",
    'church_tax_receipts_not_enabled',
    'church_inactive',
    'completedGivingNeedsTaxReceiptFollowUp',
    'processCompletedGivingTaxReceiptFollowUp',
    'const latestAfterFailure = await givingRef.get().catch(() => null);',
    'if (latestGiving && !completedGivingNeedsTaxReceiptFollowUp(latestGiving))',
    'function taxReceiptEmailDeliveryFailureCode',
    'emailDeliveryFailureCode || FieldValue.delete()',
    'after.receiptEmailSentAt && !completedGivingNeedsTaxReceiptFollowUp(after)',
    "return !status || status === 'issued'",
  ])
  && functionsCallablesTestSource.includes('preserves auto-issued receipt email errors for retry visibility')
  && functionsCallablesTestSource.includes('leaves auto-issued donations ready until the donor Auth email is verified')
  && givingDbSource.includes("value === 'ready'"),
  'Manual tax receipt mode marks active completed donations ready, inactive or disabled receipt settings remain not-configured, completed-donation follow-up can recover missing auto tax receipt state, and auto-issue delivery failures preserve retry-visible email errors'
);

const missionControlFormSource = readText('src/components/mission-control/missionControlForm.ts') ?? '';
const missionControlFormTestSource = readText('src/components/mission-control/missionControlForm.test.ts') ?? '';
const churchDomainTestSource = readText('src/domain/church.test.ts') ?? '';
const churchFormSheetSource = readText('src/components/mission-control/ChurchFormSheet.tsx') ?? '';
record(
  includesEvery(givingSource, [
    'settings.eligibilityConfirmed !== true',
    'must confirm tax receipt eligibility before receipts can be issued',
  ])
  && includesEvery(superAdminSource, [
    'taxReceiptSettings.eligibilityConfirmed',
    'require confirmation that the parish is eligible',
    'taxReceiptSettingsAuditSummary',
    'taxIdConfigured',
    'organizationAddressConfigured',
    'DEFAULT_TAX_GOODS_SERVICES_STATEMENT',
    '!settings.goodsServicesStatement',
    'settings.goodsServicesStatement = DEFAULT_TAX_GOODS_SERVICES_STATEMENT',
    'previous: taxReceiptSettingsAuditSummary',
    'next: taxReceiptSettingsAuditSummary',
  ])
  && includesEvery(missionControlFormSource, [
    'taxReceiptEligibilityConfirmed',
    "form.taxReceiptEligibilityConfirmed === 'true'",
    'DEFAULT_TAX_GOODS_SERVICES_STATEMENT',
    'form.taxReceiptGoodsServicesStatement.trim() || DEFAULT_TAX_GOODS_SERVICES_STATEMENT',
  ])
  && includesEvery(churchDomainSource, [
    'DEFAULT_TAX_GOODS_SERVICES_STATEMENT',
    'rawTaxReceiptSettings.goodsServicesStatement.trim()',
    'rawGoodsServicesStatement || DEFAULT_TAX_GOODS_SERVICES_STATEMENT',
  ])
  && includesEvery(churchDomainTestSource, [
    "mapChurchSummary('receipt-default'",
    "goodsServicesStatement: '   '",
    'DEFAULT_TAX_GOODS_SERVICES_STATEMENT',
  ])
  && includesEvery(missionControlFormTestSource, [
    'DEFAULT_TAX_GOODS_SERVICES_STATEMENT',
    'buildChurchInput(base).taxReceiptSettings.goodsServicesStatement',
  ])
  && includesEvery(functionsCallablesTestSource, [
    "receiptPrefix: 'HTD'",
    "goodsServicesStatement: '   '",
    'No goods or services were provided in exchange for this contribution other than intangible religious benefits.',
  ])
  && churchDomainSource.includes("return 'eligibility_unconfirmed'")
  && churchFormSheetSource.includes('I confirm this parish is eligible to issue U.S. charitable contribution acknowledgments'),
  'Tax receipt enablement requires a SuperAdmin eligibility attestation before issuance and logs redacted receipt-settings audit summaries'
);

record(
  includesEvery(productionChecklistSource, [
    'IRS written acknowledgments',
    'Kandilo does not currently issue non-cash, advantage/quid-pro-quo, vehicle, or other special-case charitable receipts',
  ])
  && includesEvery(projectDetailsSource, [
    'IRS written acknowledgments',
    'Current U.S. issuance is scoped to cash-donation written acknowledgments aligned to IRS charitable-contribution guidance',
    'It does not issue non-cash, advantage/quid-pro-quo, vehicle, or other special-case charitable receipts',
    'The U.S. renderer is for cash-donation written acknowledgments',
  ])
  && includesEvery(emailStandardSource, [
    'IRS written acknowledgments',
    'U.S. receipt emails/PDFs are scoped to cash-donation written acknowledgments under IRS charitable-contribution guidance',
  ]),
  'U.S. official tax receipt scope is tied to IRS written-acknowledgment guidance and excludes unsupported special-case receipts'
);

record(
  includesEvery(givingSource, [
    "settings.jurisdiction !== 'US'",
    'TAX_RECEIPT_UNSUPPORTED_JURISDICTION_CODE',
    "taxReceiptStatus: isUnsupportedJurisdiction\n        ?",
    'Canada/CRA receipt fields can be staged',
    'read-only/non-editable PDF receipts that are protected from unauthorized access',
    'electronically signed under authorized parish control',
    'retained, and printable on request',
    'function unsupportedOfficialReceiptDeliveryJurisdiction',
    'unsupportedOfficialReceiptDeliveryJurisdiction(receipt)',
    'TAX_RECEIPT_UNSUPPORTED_JURISDICTION_CODE',
    'receiptIssueLocation: settings.receiptIssueLocation',
    'authorizedSignerName: settings.authorizedSignerName',
  ])
  && includesEvery(missionControlFormSource, [
    "form.taxReceiptJurisdiction === 'CA'",
    'taxReceiptDetailsBlocker',
    'staged only while receipt issuing is disabled',
    'protected from unauthorized access',
    'taxReceiptIssueLocation',
    'taxReceiptAuthorizedSignerName',
    'taxReceiptSecureElectronicSignatureConfigured',
  ])
  && includesEvery(churchDomainSource, [
    "settings.jurisdiction !== 'US'",
    "return 'unsupported_jurisdiction'",
    'receiptIssueLocation',
    'secureElectronicSignatureConfigured',
  ])
  && taxReceiptIssuanceStateSource.indexOf("settings.jurisdiction !== 'US'") >= 0
  && taxReceiptIssuanceStateSource.indexOf('!settings.enabled') >= 0
  && taxReceiptIssuanceStateSource.indexOf("settings.jurisdiction !== 'US'")
    < taxReceiptIssuanceStateSource.indexOf('!settings.enabled')
  && includesEvery(givingScreenSource, [
    'activeChurchTaxReceiptState',
    'const receiptState = getTaxReceiptIssuanceState(church?.taxReceiptSettings);',
    "const TAX_RECEIPT_UNSUPPORTED_JURISDICTION_CODE = 'tax_receipt_unsupported_jurisdiction';",
    'record.taxReceiptError === TAX_RECEIPT_UNSUPPORTED_JURISDICTION_CODE',
    'taxReceiptUnsupportedJurisdiction',
    'const taxReceiptStatusLabel = (receipt: FirestoreTaxReceiptRecord): string => {',
    'const receiptAction = donorTaxReceiptActionAvailability(',
    'if (receiptAction.unsupportedJurisdiction) return extra.taxReceiptUnsupportedJurisdiction;',
    'if (receiptAction.missingAssignedReceiptNumber) return extra.taxReceiptGenericIssue;',
    'const annualUnavailableLabel =',
    'const annualSendButtonLabel =',
    'const annualProfileAwareSendButtonLabel =',
    'title={annualProfileAwareSendButtonLabel}',
    'aria-label={annualProfileAwareSendButtonLabel}',
  ])
  && includesEvery(managementViewHookSource, [
    'taxReceiptIssuanceState',
    'const receiptState = getTaxReceiptIssuanceState(church.taxReceiptSettings);',
    'unsupportedJurisdictionSetupRequired',
  ])
  && includesEvery(managementReceiptsSource, [
    'taxReceiptIssuanceState',
    "taxReceiptIssuanceState === 'unsupported_jurisdiction'",
    'unsupportedJurisdictionSetupRequired',
    'unsupportedJurisdiction',
  ])
  && includesEvery(superAdminSource, [
    'receiptIssueLocationConfigured',
    'authorizedSignerConfigured',
    'secureElectronicSignatureConfigured',
    'receiptCopiesRetentionConfirmed',
    'read-only/non-editable PDF receipts that are protected from unauthorized access',
    'electronically signed under authorized parish control',
    'retained, and printable on request',
  ])
  && includesEvery(taxReceiptPdfSource, [
    'CRA RECEIPT STAGING DRAFT',
    'NOT VALID FOR INCOME TAX PURPOSES',
    'Charity registration number',
    'Canada Revenue Agency',
    'canada.ca/charities-giving',
    'Authorized Signer',
    'Advantage',
  ])
  && includesEvery(emailTemplatesSource, [
    'CRA receipt staging draft',
    'not valid for income tax purposes',
    'Charity Registration No.',
    'Canada Revenue Agency',
    'Authorized Signer',
    'Advantage',
  ])
  && churchFormSheetSource.includes('Canada/CRA receipt fields can be staged here')
  && churchFormSheetSource.includes('taxReceiptDetailsBlocker(form)')
  && givingSource.includes('function unsupportedChurchReceiptSetupJurisdiction')
  && givingSource.includes('async function unsupportedOfficialReceiptDeliveryJurisdictionForReceipt')
  && givingSource.includes('await unsupportedOfficialReceiptDeliveryJurisdictionForReceipt(receipt)')
  && includesEvery(functionsCallablesTestSource, [
    "jurisdiction: 'CA',\n              enabled: true,",
    "message: expect.stringContaining('Canada/CRA tax receipts cannot be enabled')",
  ])
  && functionsCallablesTestSource.includes('marks Canadian completed donations not configured during tax receipt follow-up')
  && functionsCallablesTestSource.includes('blocks legacy Canada/CRA stored receipt email and PDF delivery paths')
  && functionsCallablesTestSource.includes('blocks stored receipt delivery when the current church receipt setup is Canada/CRA unsupported')
  && functionsCallablesTestSource.includes("emailError: 'tax_receipt_unsupported_jurisdiction'")
  && functionsCallablesTestSource.includes("taxReceiptError: 'tax_receipt_unsupported_jurisdiction'")
  && managementReceiptsTestSource.includes('surfaces the Canada/CRA blocker instead of generic not-enabled receipt copy')
  && givingScreenTestSource.includes('surfaces Canadian receipt unsupported state instead of generic not-enabled copy')
  && givingScreenTestSource.includes('const taxReceiptStatusLabelSource = source.slice')
  && givingScreenTestSource.includes('if (receiptAction.unsupportedJurisdiction) return extra.taxReceiptUnsupportedJurisdiction;')
  && givingScreenTestSource.includes('uses each donor receipt row church setup instead of the active parish setup')
  && givingScreenTestSource.includes("record.taxReceiptError === TAX_RECEIPT_UNSUPPORTED_JURISDICTION_CODE")
  && givingScreenTestSource.includes('title={annualProfileAwareSendButtonLabel}')
  && productionChecklistSource.includes('Canada/CRA staging fields now include issue location')
  && productionChecklistSource.includes('Canadian parishes must show Canada/CRA-specific unavailable copy')
  && productionChecklistSource.includes("taxReceiptError='tax_receipt_unsupported_jurisdiction'")
  && productionChecklistSource.includes('Mission Control should make the Canada/CRA enablement blocker explicit')
  && productionChecklistSource.includes('protected from unauthorized access, encrypted, electronically signed under authorized parish control, retained, and printable on request')
  && productionChecklistSource.includes('legacy or manually inserted non-U.S. stored receipt documents must still fail closed')
  && productionChecklistSource.includes('direct stored-receipt email/PDF retries fail closed before retained/generated PDF work')
  && projectDetailsSource.includes('Canada/CRA receipt setup can now stage')
  && projectDetailsSource.includes('Canada/CRA-specific unavailable copy in donor/church receipt portals')
  && projectDetailsSource.includes("taxReceiptError='tax_receipt_unsupported_jurisdiction'")
  && projectDetailsSource.includes('protected from unauthorized access, encrypted, electronically signed under authorized parish control, retained, and printable on request')
  && projectDetailsSource.includes('stored-receipt resend time, and donor PDF download time')
  && projectDetailsSource.includes("church's current unsupported-jurisdiction setup before retained/generated PDF work")
  && projectDetailsSource.includes('Legacy or manually inserted non-U.S. full receipt records are blocked again at email/PDF delivery time')
  && emailStandardSource.includes('CRA staging fields now exist')
  && emailStandardSource.includes('protected from unauthorized access, encrypted, electronically signed under authorized parish control, retained, and printable on request')
  && emailStandardSource.includes('Donor and church receipt portals must show a Canada/CRA-specific unavailable state')
  && emailStandardSource.includes('generic stored-receipt email/download paths must fail closed for legacy or manually inserted non-U.S. receipt records')
  && emailStandardSource.includes("church's current receipt setup is an unsupported jurisdiction")
  && qaWebFirebaseSource.includes('direct stored-receipt email/PDF callable retries before retained/generated PDF work')
  && qaWebFirebaseSource.includes('CRA-specific PDF/email rendering coverage'),
  'Canada/CRA tax receipt issuance remains blocked while CRA-required fields, signer metadata, and future PDF/email rendering are scaffolded'
);

record(
  includesEvery(givingSource, [
    'givingIsSafeForTargetedReceiptManagerAction',
    'assertReceiptManagerCanTargetGiving',
    'function givingOmitsPrivatePaymentFields',
    'giving.churchReceiptVisible === true',
    "optionalTrimmedString(giving.donorEmail, 254) === ''",
    '&& givingOmitsPrivatePaymentFields(giving)',
    'Donation receipts that are anonymous, unclassified, or hidden from the receipt manager can only be sent by the donor or through a privacy-preserving annual batch.',
    'Corrected receipts for donations that are anonymous, unclassified, or hidden from the receipt manager can only be sent by the donor or through a privacy-preserving annual batch.',
    'Annual receipts that include anonymous, unclassified, or receipt-manager-hidden donations can only be sent by the donor or through a privacy-preserving church-year batch.',
    'Corrected annual receipts that include anonymous, unclassified, or receipt-manager-hidden donations can only be sent by the donor or through a privacy-preserving church-year batch.',
    '!givingIsSafeForTargetedReceiptManagerAction(docSnap.data())',
    'taxReceiptAlreadyEmailed',
    'taxReceiptAlreadyEmailedAndSettled',
    'skippedAlreadyEmailedCount',
    'ANNUAL_BULK_DONOR_SOURCE_PAGE_SIZE',
    'ANNUAL_BULK_DONOR_SOURCE_SCAN_LIMIT',
    'baseQuery.startAfter(lastDoc).limit(pageSize)',
    'candidateDonorIds.slice(0, ANNUAL_BULK_DONOR_LIMIT)',
    'ANNUAL_RECEIPT_MIXED_CURRENCY_REVIEW_CODE',
    'entry.hasMixedCurrency',
    'reviewSkips',
    'logAnnualBatchReviewSkips',
    'skippedCount',
    'safeHttpsErrorDetailCode(error)',
    'safeHttpsErrorDetailCode(taxReceiptError)',
    'GENERIC_TAX_RECEIPT_AUDIT_CODE',
    'publicTaxReceiptAuditCode(detailCode) || GENERIC_TAX_RECEIPT_AUDIT_CODE',
    'publicTaxReceiptAuditCode(error.code) || GENERIC_TAX_RECEIPT_AUDIT_CODE',
    '{ errorCode }',
    'failures.push({ code })',
  ])
  && (
    givingSource.match(/assertActiveChurchForTaxReceiptIssuance\(church\);\n    if \(!parseTaxReceiptSettings\(church\)\)/g) ?? []
  ).length >= 2
  && productionChecklistSource.includes('prioritizes still-unsent donor-years beyond the first 250 recipients')
  && productionChecklistSource.includes('annual and corrected annual batch callables fail closed before donor scans when the church is inactive')
  && productionChecklistSource.includes('annual and corrected annual batch calls return a redacted mixed-currency review failure before consuming limited send slots')
  && qaWebFirebaseSource.includes('annual and corrected annual batches fail closed before donor scans when the church is inactive')
  && projectDetailsSource.includes('prioritize unsent donor-years on rerun so a large parish can progress beyond the first 250 already-sent recipients')
  && projectDetailsSource.includes('fails closed before donor scans when the church is inactive')
  && projectDetailsSource.includes('skip mixed- or missing-currency donor-years into redacted review failures before consuming limited send slots')
  && projectDetailsSource.includes('donor source scan is paged through the closed-year giving window')
  && functionsCallablesTestSource.includes('rejects annual batch callables while the church is inactive before donor-year scans')
  && functionsCallablesTestSource.includes('skips mixed- or missing-currency donor-years from annual batches for review without exposing donor ids')
  && functionsCallablesTestSource.includes('skips mixed- or missing-currency donor-years from corrected annual batches for review without exposing donor ids')
  && functionsCallablesTestSource.includes('does not require annual batch acknowledgement for unassigned receipt-number markers')
  && functionsCallablesTestSource.includes('does not require corrected annual batch acknowledgement for unassigned receipt-number markers')
  && functionsCallablesTestSource.includes("{ code: 'stripe_partial_refund_review_required' }")
  && functionsCallablesTestSource.includes("expect(JSON.stringify(batchResult)).not.toContain('failed-precondition');")
  && receiptErrorsSource.includes("case 'tax_receipt_annual_mixed_currency_review_required':")
  && functionsCallablesTestSource.includes('giving-tax-legacy-hidden')
  && functionsCallablesTestSource.includes('giving-tax-legacy-stripe-private')
  && functionsCallablesTestSource.includes("stripeCheckoutSessionId: 'cs_live_private'")
  && functionsCallablesTestSource.includes("stripePaymentIntentId: 'pi_live_private'")
  && functionsCallablesTestSource.includes('annual-target-hidden-staff')
  && !givingSource.includes('.limit(5_000)')
  && !givingSource.includes('donorId,\n          ...sanitizedErrorContext(error)'),
  'Tax receipt callables block targeted anonymous/unclassified/hidden/raw-Stripe-identifier receipt-manager sends, skip already-emailed and mixed- or missing-currency annual batch receipts, keep partial-refund batch failures specific but redacted, progress large reruns past already-sent donor-years, and redact annual batch failure responses/logs'
);

const scheduledAnnualPreparationSource = sourceSlice(
  givingSource,
  'async function prepareAnnualTaxReceiptsForChurch',
  'async function recordTaxReceiptEmailFailure'
);
record(
  includesEvery(givingSource, [
    'export const prepareYearEndAnnualTaxReceipts = onSchedule',
    'SCHEDULED_ANNUAL_CHURCH_PAGE_SIZE = 200',
    'SCHEDULED_ANNUAL_CHURCH_SCAN_LIMIT = 5_000',
    'SCHEDULED_ANNUAL_DONOR_LIMIT_PER_CHURCH = 50',
    'loadActiveChurchesForScheduledAnnualPreparation',
    'orderBy(FieldPath.documentId())',
    'activeChurchScanTruncated',
    'annualReceiptPreparationOptedIn',
    'annualReceiptAutoEmailOptedIn',
    'settings?.annualPreparationEnabled',
    'const shouldAutoEmail = annualReceiptAutoEmailOptedIn(church)',
    "secrets: ['RESEND_API_KEY']",
    'entry.hasMixedCurrency',
    'skippedMixedCurrencyCount',
    'skippedAlreadyEmailedCount',
    'emailSentCount',
    'annualGivingIncludesPreviouslyReceiptedEvidence(entry.validGiving, churchId, entry.userId)',
    'annualGivingIncludesPreviouslyReceiptedEvidenceInTransaction',
    'singleReceiptIsPreviouslyReceiptedAnnualEvidence',
    'Boolean(storedOfficialReceiptNumber(data.taxReceiptNumber))',
    'await sendTaxReceiptEmail(receipt.receiptId, SCHEDULED_ANNUAL_RECEIPT_ACTOR_UID)',
    "action: 'annual_scheduled_item_failed'",
    "action: 'annual_scheduled_review_summary'",
    'reviewCount: summary.count',
	    'logScheduledAnnualPreparationReviewSummaries(result)',
	    "schedule: 'every 24 hours'",
	    "timeZone: 'Etc/UTC'",
	    'retryCount: 0',
	  ])
  && superAdminSource.includes("data.action === 'annual_scheduled_review_summary'")
  && superAdminSource.includes('reviewCount')
  && missionControlAnalyticsSource.includes('receiptAuditReviewCountLabel(event.action, event.reviewCount)')
  && includesEvery(indexSource, [
    'prepareYearEndAnnualTaxReceipts',
  ])
  && includesEvery(superAdminSource, [
    'taxReceiptSettings.annualPreparationEnabled',
    'taxReceiptSettings.annualAutoEmailEnabled',
    'annualPreparationEnabled: settings.annualPreparationEnabled === true',
    'annualAutoEmailEnabled:',
  ])
  && includesEvery(missionControlFormSource, [
    'taxReceiptAnnualPreparationEnabled',
    'taxReceiptAnnualAutoEmailEnabled',
    "form.taxReceiptAnnualPreparationEnabled === 'true'",
    "annualPreparationEnabled && form.taxReceiptAnnualAutoEmailEnabled === 'true'",
  ])
  && churchDomainSource.includes('annualPreparationEnabled: rawTaxReceiptSettings.annualPreparationEnabled === true')
  && churchDomainSource.includes('annualAutoEmailEnabled:')
  && churchFormSheetSource.includes('Prepare annual receipt records after year-end without automatically emailing donors')
  && churchFormSheetSource.includes('Automatically email safe prepared annual receipts after year-end')
  && productionChecklistSource.includes('annual receipt preparation')
  && productionChecklistSource.includes('annual auto-email is separately opt-in')
  && productionChecklistSource.includes('mixed-currency, missing-currency, or previously individually receipted donor-years')
  && projectDetailsSource.includes('default-off annual receipt preparation')
  && projectDetailsSource.includes('annual auto-email is separately default-off')
  && projectDetailsSource.includes('writes aggregate backend-only review summary audit events without donor identifiers')
  && projectDetailsSource.includes('review category plus aggregate `reviewCount`')
  && emailStandardSource.includes('annual auto-email is separately default-off')
  && emailStandardSource.includes('writes aggregate backend-only review summary audit events without donor IDs')
  && productionChecklistSource.includes('writes aggregate backend-only review summary audit events without donor identifiers')
  && productionChecklistSource.includes('review category and aggregate `reviewCount`')
  && emailStandardSource.includes('report mixed-currency donor-years as redacted review failures before consuming limited send slots')
  && functionsCallablesTestSource.includes('requires acknowledgement before donor annual receipts include gifts with historical receipt numbers')
  && functionsCallablesTestSource.includes('requires acknowledgement before donor annual receipts include gifts with standalone single receipt records')
  && taxReceiptBatchSourceTestSource.includes('can separately opt into safe scheduled annual receipt emails')
  && scheduledAnnualPreparationSource.includes('sendTaxReceiptEmail'),
  'Scheduled year-end annual receipt preparation is opt-in, capped, separately auto-email opt-in, and skips refund, mixed- or missing-currency, or duplicate-claim donor-years that need manual review'
);

const taxReceiptRoleGateSource = sourceSlice(
  rolesSource,
  'export function canManageTaxReceipts',
  'export function canInviteChurchRole'
);
record(
  includesEvery(taxReceiptRoleGateSource, [
    'export function canManageTaxReceipts(role: NullableRole): boolean',
    'return isPriestRole(role) || isTreasurerRole(role);',
  ])
  && !taxReceiptRoleGateSource.includes('isAdminOrPriestRole')
  && includesEvery(managementModelSource, [
    "if (tab === 'receipts')",
    'return canManageTaxReceipts(role);',
    "return 'receipts';",
  ])
  && includesEvery(managementViewSource, [
    'showReceipts={management.canManageReceipts}',
    "management.canManageReceipts && management.activeTab === 'receipts'",
  ])
  && includesEvery(managementViewHookSource, [
    'const canManageReceipts = canManageTaxReceipts(userRole);',
    "const needsReceipts = activeTab === 'receipts' && canManageReceipts;",
    'if (!canManageReceipts) {\n      return;',
  ])
  && includesEvery(rolesTestSource, [
    "expect(canManageTaxReceipts('priest')).toBe(true);",
    "expect(canManageTaxReceipts('treasurer')).toBe(true);",
    "expect(canManageTaxReceipts('admin')).toBe(false);",
  ])
  && includesEvery(managementModelTestSource, [
    'keeps ordinary admins out of receipt-manager tabs',
    "expect(isManagementTabAllowedForRole('receipts', 'admin')).toBe(false);",
    "expect(coerceManagementTabForRole('receipts', 'admin')).toBe('dashboard');",
  ])
  && includesEvery(managementInviteSheetSource, [
    't.receiptAccessHint',
    'allowAdminInvites && (',
  ])
  && includesEvery(managementInviteSheetTestSource, [
    'guides priests to use Treasurer for parish financial receipt access',
    'Admin cannot manage tax receipts.',
  ])
  && includesEvery(localizationSource, [
    'Assign the parish financial administrator the Treasurer role; full receipt records stay in the donor portal.',
    'Tax receipt sending is limited to priests and treasurers. Parish financial administrators should be assigned the Treasurer role for receipt access.',
    'Use Treasurer for parish financial administrators who need receipt access. Admin cannot manage tax receipts.',
  ])
  && includesEvery(productionChecklistSource, [
    'regular admins cannot read giving or receipt records',
    'parish financial administrators are assigned the Treasurer role instead of the ordinary Admin role for receipt access',
    'priests/treasurers can read only non-anonymous receipt-manager giving/summaries',
  ])
  && includesEvery(projectDetailsSource, [
    'Privacy decision: regular parish admins do not receive donor giving or tax receipt access.',
    'Priests and treasurers can view only backend-marked, receipt-manager-safe church giving and annual summary rows',
    'Firestore tax receipt document reads and PDF downloads are donor-client-only.',
    'This keeps the church portal send-focused while avoiding broad access to full official receipt contents.',
  ])
  && includesEvery(functionsCallablesTestSource, [
    "'sendTaxReceipt',\n        { givingId: 'giving-tax-1' },\n        { uid: 'admin-1', email: 'admin@example.com' }",
    "'sendAnnualTaxReceipt',\n        { churchId: CHURCH_ID, year: CLOSED_ANNUAL_YEAR, userId: 'member-1' },\n        { uid: 'admin-1', email: 'admin@example.com' }",
    "'sendCorrectedTaxReceipt',\n        { givingId: 'giving-partial-corrected' },\n        { uid: 'admin-1', email: 'admin@example.com' }",
    "'sendCorrectedAnnualTaxReceipt',\n        { churchId: CHURCH_ID, userId: 'member-1', year: CLOSED_ANNUAL_YEAR },\n        { uid: 'admin-1', email: 'admin@example.com' }",
    "'sendChurchAnnualTaxReceipts',\n        { churchId: CHURCH_ID, year: CLOSED_ANNUAL_YEAR },\n        { uid: 'admin-1', email: 'admin@example.com' }",
    "'sendChurchCorrectedAnnualTaxReceipts',\n        { churchId: CHURCH_ID, year: CLOSED_ANNUAL_YEAR },\n        { uid: 'admin-1', email: 'admin@example.com' }",
    "{ uid: 'admin-1', email: 'admin@example.com' }",
    "'permission-denied'",
  ]),
  'Receipt-manager role gates keep tax receipt operations priest/treasurer-only with ordinary-admin exclusion covered by tests, docs, and product copy'
);

function firestoreReceiptPrivacyRulesReady(firestoreRules) {
  const userProfileRulesSource = sourceSlice(
    firestoreRules,
    'match /users/{userId}',
    'match /churchMemberships/{churchId}'
  );
  const taxReceiptRulesSource = sourceSlice(
    firestoreRules,
    'match /taxReceipts/{taxReceiptId}',
    'match /taxReceiptSummaries/{taxReceiptSummaryId}'
  );
  const givingRulesSource = sourceSlice(
    firestoreRules,
    'match /giving/{givingId}',
    'match /stripeWebhookEvents/{stripeWebhookEventId}'
  );
  const stripeWebhookRulesSource = sourceSlice(
    firestoreRules,
    'match /stripeWebhookEvents/{stripeWebhookEventId}',
    'match /churchPaymentSettings/{churchId}'
  );
  const paymentMetadataRulesSource = sourceSlice(
    firestoreRules,
    'match /givingPaymentMetadata/{givingId}',
    'match /churchPaymentSettings/{churchId}'
  );
  const paymentSettingsRulesSource = sourceSlice(
    firestoreRules,
    'match /churchPaymentSettings/{churchId}',
    'match /taxReceipts/{taxReceiptId}'
  );
  const taxReceiptSummaryRulesSource = sourceSlice(
    firestoreRules,
    'match /taxReceiptSummaries/{taxReceiptSummaryId}',
    'match /taxReceiptEvents/{taxReceiptEventId}'
  );

  return includesEvery(firestoreRules, [
    'match /users/{userId}',
    'taxReceiptLegalName',
    'taxReceiptAddress',
    'match /giving/{givingId}',
    'function givingPublicDonorNameSafe(giving)',
    'function givingOmitsPrivatePaymentFields(giving)',
    "'stripeSessionId'",
    "'stripeCheckoutSessionId'",
    "'stripeCheckoutUrl'",
    "'stripeCheckoutSessionUrl'",
    "'stripePaymentIntentId'",
    "'stripeChargeId'",
    "'stripeCustomerId'",
    "'stripeConnectAccountId'",
    "'stripeRefundId'",
    "'stripeRefundedChargeId'",
    "'checkoutSessionId'",
    "'checkoutUrl'",
    "'paymentIntentId'",
    "'chargeId'",
    "'refundId'",
    'match /stripeWebhookEvents/{stripeWebhookEventId}',
    'match /givingPaymentMetadata/{givingId}',
    'match /churchPaymentSettings/{churchId}',
    'match /taxReceipts/{taxReceiptId}',
    'match /taxReceiptSummaries/{taxReceiptSummaryId}',
    'function taxReceiptSummaryOmitsPrivateFields(summary)',
    'function taxReceiptSummaryPublicLabelSafe(summary)',
    'summary.donorLabelPublicSafe == true',
    "summary.donorLabel != 'Anonymous donor'",
    'summary.keys().hasAny([',
    "'donorEmail'",
    "'donorName'",
    "'donorAddress'",
    "'taxReceiptLegalName'",
    "'taxReceiptAddress'",
    "'organizationTaxId'",
    "'givingIds'",
    "'contributions'",
    "'issuedBy'",
    "'emailSendingAt'",
    "'emailSendAttemptId'",
    "'pdfTemplateVersion'",
    "'stripeCheckoutSessionUrl'",
    "'checkoutUrl'",
    "'stripeRefundStatus'",
    "'stripeAmountRefundedCents'",
    "'partialRefundGivingIds'",
    "'correctionForGivingId'",
    "'pdfStoragePath'",
    "'correctedBy'",
    "'correctionMarkedAt'",
    "'correctionMarkedBy'",
    "'voidedBy'",
    "summary.donorLabel.matches('.*[^\\\\s@]+@[^\\\\s@]+\\\\.[^\\\\s@]{2,}.*')",
    'resource.data.churchReceiptVisible == true',
    'resource.data.donorNamePublicSafe == true',
    "giving.donorName != 'Anonymous donor'",
    'resource.data.receiptManagerGivingSafeVersion == 1',
    'givingPublicDonorNameSafe(resource.data)',
    'resource.data.donorLabelPublicSafe == true',
    'resource.data.receiptManagerSummarySafe == true',
    'resource.data.receiptManagerSummarySafeVersion == 2',
    "resource.data.donorEmail == ''",
    "resource.data.status in ['completed', 'refunded']",
    "resource.data.kind == 'annual'",
    'resource.data.donorAnonymous == false',
    'match /taxReceiptEvents/{taxReceiptEventId}',
    'allow read: if false;',
  ])
    && userProfileRulesSource.includes('allow read: if isVerifiedNonAnonymous() && isOwner(userId);')
    && !userProfileRulesSource.includes('isSuperAdmin()')
    && givingRulesSource.includes('resource.data.anonymous == false')
    && givingRulesSource.includes('resource.data.churchReceiptVisible == true')
    && givingRulesSource.includes("resource.data.donorEmail == ''")
    && givingRulesSource.includes('resource.data.donorNamePublicSafe == true')
    && givingRulesSource.includes('resource.data.receiptManagerGivingSafeVersion == 1')
    && givingRulesSource.includes('givingPublicDonorNameSafe(resource.data)')
    && givingRulesSource.includes('givingOmitsPrivatePaymentFields(resource.data)')
    && givingRulesSource.includes("resource.data.status in ['completed', 'refunded']")
    && !givingRulesSource.includes('isSuperAdmin()')
    && stripeWebhookRulesSource.includes('allow read: if false;')
    && stripeWebhookRulesSource.includes('allow create, update, delete: if false;')
    && !stripeWebhookRulesSource.includes('isSuperAdmin()')
    && paymentMetadataRulesSource.includes('allow read: if false;')
    && paymentMetadataRulesSource.includes('allow create, update, delete: if false;')
    && !paymentMetadataRulesSource.includes('isSuperAdmin()')
    && paymentSettingsRulesSource.includes('allow read: if false;')
    && paymentSettingsRulesSource.includes('allow create, update, delete: if false;')
    && !paymentSettingsRulesSource.includes('isSuperAdmin()')
    && taxReceiptRulesSource.includes('allow read: if isVerifiedNonAnonymous() && isOwner(resource.data.userId);')
    && !taxReceiptRulesSource.includes('isSuperAdmin()')
    && taxReceiptSummaryRulesSource.includes("resource.data.kind == 'annual'")
    && taxReceiptSummaryRulesSource.includes('resource.data.donorAnonymous == false')
    && taxReceiptSummaryRulesSource.includes('resource.data.churchReceiptVisible == true')
    && taxReceiptSummaryRulesSource.includes('resource.data.donorLabelPublicSafe == true')
    && taxReceiptSummaryRulesSource.includes('resource.data.receiptManagerSummarySafe == true')
    && taxReceiptSummaryRulesSource.includes('resource.data.receiptManagerSummarySafeVersion == 2')
    && taxReceiptSummaryRulesSource.includes('taxReceiptSummaryPublicLabelSafe(resource.data)')
    && taxReceiptSummaryRulesSource.includes('taxReceiptSummaryOmitsPrivateFields(resource.data)')
    && !taxReceiptSummaryRulesSource.includes('isSuperAdmin()');
}

const firestoreRules = readText('firestore.rules') ?? '';
record(
  firestoreReceiptPrivacyRulesReady(firestoreRules),
  'Firestore rules keep private receipt profile fields owner-client-only, full tax receipt documents donor-only, church receipt-manager reads summary-scoped, and raw Stripe/payment/tax receipt audit records backend-only'
);

const taxReceiptRulesTestSource = sourceSlice(
  firebaseRulesTestSource,
  "await assertSucceeds(getDoc(doc(memberDb, 'taxReceipts/giving-1')));",
  "await assertSucceeds(getDoc(doc(memberDb, 'taxReceiptSummaries/annual-1')));"
);
record(
  matchesEvery(taxReceiptRulesTestSource, [
    /assertSucceeds\(getDoc\(doc\(memberDb, 'taxReceipts\/giving-1'\)\)\)/,
    /assertFails\(getDoc\(doc\(unverifiedMemberDb, 'taxReceipts\/giving-1'\)\)\)/,
    /assertFails\(getDoc\(doc\(anonymousMemberDb, 'taxReceipts\/giving-1'\)\)\)/,
    /assertFails\(getDoc\(doc\(priestDb, 'taxReceipts\/giving-1'\)\)\)/,
    /assertSucceeds\(getDocs\(query\(\s*collection\(memberDb, 'taxReceipts'\),\s*where\('userId', '==', 'member-1'\),\s*orderBy\('issuedAt', 'desc'\),\s*limit\(10\)\s*\)\)\)/,
    /assertFails\(getDocs\(query\(\s*collection\(memberDb, 'taxReceipts'\),\s*orderBy\('issuedAt', 'desc'\),\s*limit\(10\)\s*\)\)\)/,
    /assertFails\(getDocs\(query\(\s*collection\(priestDb, 'taxReceipts'\),\s*where\('churchId', '==', CHURCH_ID\),\s*orderBy\('issuedAt', 'desc'\),\s*limit\(10\)\s*\)\)\)/,
  ])
  && firebaseRulesTestSource.includes('keeps retained tax receipt PDFs backend-only for every client role')
  && firebaseRulesTestSource.includes('assertFails(getMetadata(ref(memberStorage, receiptPdfPath)))')
  && firebaseRulesTestSource.includes('assertFails(getMetadata(ref(priestStorage, receiptPdfPath)))')
  && firebaseRulesTestSource.includes('assertFails(getMetadata(ref(treasurerStorage, receiptPdfPath)))')
  && includesEvery(firebaseRulesTestSource, [
    'giving/giving-email-label-visible',
    "donorName: 'Contact member@example.com'",
    "donorName: 'Anonymous donor'",
    "donorNamePublicSafe: false",
    'fails closed for receipt-manager reads with reserved anonymous public labels on non-anonymous rows',
    'giving/giving-reserved-anonymous-label',
    'taxReceiptSummaries/annual-reserved-anonymous-label',
    "assertFails(getDoc(doc(priestDb, 'giving/giving-reserved-anonymous-label')))",
    "assertFails(getDoc(doc(priestDb, 'taxReceiptSummaries/annual-reserved-anonymous-label')))",
    "where('donorNamePublicSafe', '==', true)",
    "where('receiptManagerGivingSafeVersion', '==', 1)",
    "assertFails(getDoc(doc(priestDb, 'giving/giving-email-label-visible')))",
    "assertFails(getDoc(doc(treasurerDb, 'giving/giving-email-label-visible')))",
    "expect(freshPriestGiving.docs.map((giving) => giving.id)).not.toContain('giving-private-stripe-visible')",
    'taxReceiptSummaries/annual-private-field-leak',
    'taxReceiptSummaries/annual-private-field-safe-marker-leak',
    'taxReceiptSummaries/annual-email-label-safe-marker-leak',
    'taxReceiptSummaries/annual-profile-required',
    'taxReceiptSummaries/annual-verified-email-required',
    "assertFails(getDoc(doc(unverifiedMemberDb, 'taxReceiptSummaries/annual-1')))",
    "assertFails(getDoc(doc(anonymousMemberDb, 'taxReceiptSummaries/annual-1')))",
    "jurisdiction: 'CA'",
    "expect((await getDoc(doc(priestDb, 'taxReceiptSummaries/annual-1'))).data()?.jurisdiction).toBe('CA')",
    "receiptId: ''",
    "emailError: 'tax_receipt_donor_profile_incomplete'",
    "emailError: 'tax_receipt_missing_email_or_amount'",
    "receiptId: 'annual-private-field-safe-marker-leak'",
    "donorLabelPublicSafe: true",
    "receiptManagerSummarySafe: true",
    "receiptManagerSummarySafeVersion: 1",
    "donorEmail: 'member@example.com'",
    "donorLabel: 'member@example.com'",
    "donorName: 'Member Legal Name'",
    "donorAddress: '10 Donor Street'",
    "organizationTaxId: '12-3456789'",
    "givingIds: ['giving-1']",
    "emailSendingAt: Timestamp.fromDate(new Date('2026-01-15T12:19:00Z'))",
    "emailSendAttemptId: 'private-send-attempt-id-20260115'",
    "pdfStoragePath: 'taxReceipts/church-1/2025/annual-private-field-leak.pdf'",
    "where('donorLabelPublicSafe', '==', true)",
    "where('receiptManagerSummarySafe', '==', true)",
    "where('receiptManagerSummarySafeVersion', '==', 2)",
    "assertSucceeds(getDoc(doc(memberDb, 'taxReceiptSummaries/annual-private-field-leak')))",
    "assertFails(getDoc(doc(priestDb, 'taxReceiptSummaries/annual-private-field-leak')))",
    "assertFails(getDoc(doc(treasurerDb, 'taxReceiptSummaries/annual-private-field-leak')))",
    "assertSucceeds(getDoc(doc(priestDb, 'taxReceiptSummaries/annual-profile-required')))",
    "assertSucceeds(getDoc(doc(priestDb, 'taxReceiptSummaries/annual-verified-email-required')))",
    "assertFails(getDoc(doc(priestDb, 'taxReceiptSummaries/annual-email-label-safe-marker-leak')))",
    "assertFails(getDoc(doc(treasurerDb, 'taxReceiptSummaries/annual-email-label-safe-marker-leak')))",
    "assertFails(getDoc(doc(treasurerDb, 'taxReceiptSummaries/annual-reserved-anonymous-label')))",
    "expect(freshPriestSummaries.docs.map((summary) => summary.id)).toContain('annual-profile-required')",
    "expect(freshPriestSummaries.docs.map((summary) => summary.id)).toContain('annual-verified-email-required')",
    "expect(freshPriestSummaries.docs.map((summary) => summary.id)).not.toContain('annual-private-field-leak')",
    "expect(freshPriestSummaries.docs.map((summary) => summary.id)).not.toContain('annual-private-field-safe-marker-leak')",
    "expect(freshPriestSummaries.docs.map((summary) => summary.id)).not.toContain('annual-email-label-safe-marker-leak')",
  ]),
  'Firebase rules tests cover donor-only full tax receipt reads, donor-scoped receipt list queries, church raw receipt query denial, staff-readable non-private annual jurisdiction mirrors, staff-readable blank-receipt-id annual issuance-gap retry summaries, malformed private annual-summary mirror direct-read denial, email-shaped annual summary label denial, safe-marker constrained staff summary lists, and client-denied retained PDF Storage reads'
);

if (includeLiveFirebase) {
  await checkLiveFirebaseDeployment(requiredFirestoreIndexes);
} else {
  console.log('');
  console.log('Live Firebase, Cloud Scheduler, Storage rules, and Hosting deployment check not run. After deploying the tax receipt release surface, run:');
  console.log('- npm run check:firebase-live');
  console.log('- npm run audit:tax-receipts -- --fail-on-repairs');
}

console.log('');
console.log('Manual Stripe/Firebase/native checks still required before live donations:');
console.log('- Run npm run configure:native-links -- --status to confirm the checked-in well-known files are inert or configured and see whether local Xcode/release-signing inputs can derive final identifiers.');
console.log('- Run npm run configure:native-links -- --apple-team-id TEAMID1234 --android-sha256 AA:BB:...:99 with the final Apple Team ID and Android release signing fingerprint so strict native-link readiness can pass.');
console.log('- Or run npm run configure:native-links -- --apple-from-xcode-project --android-from-release-keystore when Xcode has the Apple team selected and android/keystore.properties or KANDILO_UPLOAD_* points at the release signing key.');
console.log(`- Activate the Stripe account and complete corporate/bank/tax details in the Stripe Dashboard.`);
console.log('- Run STRIPE_SECRET_KEY=sk_live_... npm run check:stripe-account-live to verify live Stripe account charge/payout/business-detail readiness without storing the key in repo env files.');
console.log(`- Run npm run configure:stripe-webhook to print the exact live Stripe webhook setup plan, then create a live endpoint at ${stripeWebhookUrl} with API version ${expectedStripeApiVersion}.`);
console.log('- Subscribe that endpoint only to checkout.session.completed, checkout.session.expired, checkout.session.async_payment_failed, and charge.refunded.');
console.log('- Run STRIPE_SECRET_KEY=sk_live_... npm run check:stripe-webhook-live to verify the live Stripe endpoint status/API version/exact event allowlist without storing the key in repo env files.');
console.log('- Run npm run configure:receipt-secrets to set STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, and RESEND_API_KEY through the project-confirmed Firebase Secret Manager helper.');
console.log('- Run RESEND_API_KEY=re_... npm run check:resend-live to verify the live Resend key can see exactly one verified kandilo.org sending domain without storing the key in repo env files.');
console.log('- Deploy Functions, Firestore rules, Firestore indexes, Storage rules, and Hosting after code or secret changes, then complete a small live donation, run npm run check:live-donation-smoke, send the official smoke receipt, run npm run check:live-donation-smoke -- --require-sent-receipt, send a non-anonymous closed-year annual receipt covering at least two donations, run npm run check:live-annual-receipt-smoke, and confirm donor/church portal visibility.');

console.log('');
if (failures > 0) {
  console.log(`Result: ${failures} failure(s), ${warnings} warning(s). Fix failures before enabling live Stripe donations and tax receipts.`);
  process.exit(1);
}

console.log(`Result: ready for manual Stripe/email live-mode setup (${warnings} warning(s)).`);
