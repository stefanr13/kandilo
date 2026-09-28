#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const expectedNativePackageId = 'com.kandilo.app';
export const androidDebugSha256Fingerprint =
  '32:A4:45:9C:CF:F1:04:67:BF:56:73:31:BE:29:5F:F5:FB:E2:CD:7F:95:EA:51:FE:12:A1:90:DA:E7:39:95:DF';

const usage = `Usage:
  npm run configure:native-links -- --status
  npm run configure:native-links -- --apple-team-id TEAMID1234 --android-sha256 AA:BB:...:99
  npm run configure:native-links -- --apple-team-id TEAMID1234 --android-from-release-keystore
  npm run configure:native-links -- --apple-from-xcode-project --android-from-release-keystore

Options:
  --status               Print current checked-in file and local derivation status without writing files.
  --apple-team-id <id>     Apple Team ID for ${expectedNativePackageId}; must be 10 uppercase alphanumeric characters.
  --apple-from-xcode-project
                            Derive the Apple Team ID from the iOS Xcode project signing settings.
  --xcode-project <path>   Path to project.pbxproj when deriving the Apple Team ID. Defaults to ios/App/App.xcodeproj/project.pbxproj.
  --android-sha256 <fp>    Android release signing SHA-256 fingerprint for ${expectedNativePackageId}. Repeat for multiple release certificates.
  --android-from-release-keystore
                            Derive the Android SHA-256 from android/keystore.properties or KANDILO_UPLOAD_* env vars.
  --android-keystore-properties <path>
                            Path to release keystore properties when deriving the fingerprint. Defaults to android/keystore.properties.
  --dry-run               Validate and print the target files without writing them.
  -h, --help              Show this help text.`;

function requireOptionValue(args, index, optionName) {
  const value = args[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`${optionName} requires a value.`);
  }
  return value;
}

export function normalizeAppleTeamId(value) {
  const normalized = String(value ?? '').trim().toUpperCase();
  if (!/^[A-Z0-9]{10}$/.test(normalized)) {
    throw new Error('Apple Team ID must be exactly 10 uppercase letters or digits.');
  }
  return normalized;
}

export function appleTeamIdFromXcodeProject({
  rootDir = process.cwd(),
  projectPath = 'ios/App/App.xcodeproj/project.pbxproj',
} = {}) {
  const resolvedProjectPath = resolve(rootDir, projectPath);
  if (!existsSync(resolvedProjectPath)) {
    throw new Error('Xcode project file was not found for Apple Team ID derivation.');
  }

  const source = readFileSync(resolvedProjectPath, 'utf8');
  const teamIds = new Set();
  const packageIdPattern = expectedNativePackageId.replaceAll('.', '\\.');
  const packageIdRegex = new RegExp(`PRODUCT_BUNDLE_IDENTIFIER\\s*=\\s*"?${packageIdPattern}"?;?`);
  const buildSettingsBlocks = source.match(/buildSettings = \{[\s\S]*?\n\s*\};/g) ?? [];
  for (const block of buildSettingsBlocks) {
    if (!packageIdRegex.test(block)) {
      continue;
    }
    const match = block.match(/DEVELOPMENT_TEAM\s*=\s*"?([A-Z0-9]{10})"?;/);
    if (match?.[1]) {
      teamIds.add(normalizeAppleTeamId(match[1]));
    }
  }

  if (teamIds.size === 0) {
    throw new Error(`Xcode project does not contain DEVELOPMENT_TEAM for ${expectedNativePackageId}. Select the Apple developer team in Xcode or pass --apple-team-id.`);
  }
  if (teamIds.size > 1) {
    throw new Error(`Xcode project contains multiple DEVELOPMENT_TEAM values for ${expectedNativePackageId}. Pass --apple-team-id explicitly.`);
  }
  return [...teamIds][0];
}

function resolvedAppleTeamId({
  rootDir,
  appleTeamId,
  appleFromXcodeProject = false,
  xcodeProjectPath = 'ios/App/App.xcodeproj/project.pbxproj',
}) {
  const manualTeamId = appleTeamId ? normalizeAppleTeamId(appleTeamId) : '';
  const xcodeTeamId = appleFromXcodeProject
    ? appleTeamIdFromXcodeProject({ rootDir, projectPath: xcodeProjectPath })
    : '';

  if (manualTeamId && xcodeTeamId && manualTeamId !== xcodeTeamId) {
    throw new Error('Provided Apple Team ID does not match the Xcode project DEVELOPMENT_TEAM.');
  }
  return manualTeamId || xcodeTeamId;
}

export function normalizeAndroidSha256Fingerprint(value) {
  const raw = String(value ?? '').trim().toUpperCase();
  if (raw.includes(':') && !/^([0-9A-F]{2}:){31}[0-9A-F]{2}$/.test(raw)) {
    throw new Error('Android SHA-256 fingerprint must be 32 hex bytes, colon-separated when colons are used.');
  }

  const compact = raw.replaceAll(':', '');
  if (!/^[0-9A-F]{64}$/.test(compact)) {
    throw new Error('Android SHA-256 fingerprint must contain exactly 32 hex bytes.');
  }

  const normalized = compact.match(/.{2}/g)?.join(':') ?? '';
  if (normalized === androidDebugSha256Fingerprint) {
    throw new Error('Android SHA-256 fingerprint must be the release signing certificate, not the known debug keystore fingerprint.');
  }
  return normalized;
}

export function normalizeAndroidSha256Fingerprints(values) {
  const seen = new Set();
  const normalized = [];
  for (const value of values) {
    const fingerprint = normalizeAndroidSha256Fingerprint(value);
    if (!seen.has(fingerprint)) {
      seen.add(fingerprint);
      normalized.push(fingerprint);
    }
  }

  if (normalized.length === 0) {
    throw new Error('At least one Android release SHA-256 fingerprint is required.');
  }
  return normalized;
}

export function parsePropertiesFile(contents) {
  const properties = {};
  for (const rawLine of String(contents ?? '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || line.startsWith('!')) {
      continue;
    }
    const separatorIndex = [...line]
      .map((char, index) => (char === '=' || char === ':' ? index : -1))
      .find((index) => index >= 0);
    if (separatorIndex === undefined || separatorIndex < 0) {
      continue;
    }
    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim();
    if (key) {
      properties[key] = value;
    }
  }
  return properties;
}

function resolveAndroidStoreFile(rootDir, storeFile) {
  if (isAbsolute(storeFile)) {
    return storeFile;
  }
  return resolve(rootDir, 'android/app', storeFile);
}

export function androidReleaseSigningConfig({
  rootDir = process.cwd(),
  propertiesPath = 'android/keystore.properties',
  env = process.env,
}) {
  const resolvedPropertiesPath = resolve(rootDir, propertiesPath);
  const properties = existsSync(resolvedPropertiesPath)
    ? parsePropertiesFile(readFileSync(resolvedPropertiesPath, 'utf8'))
    : {};

  const storeFile = properties.storeFile || env.KANDILO_UPLOAD_STORE_FILE || '';
  const config = {
    storeFile: storeFile ? resolveAndroidStoreFile(rootDir, storeFile) : '',
    storePassword: properties.storePassword || env.KANDILO_UPLOAD_STORE_PASSWORD || '',
    keyAlias: properties.keyAlias || env.KANDILO_UPLOAD_KEY_ALIAS || '',
    keyPassword: properties.keyPassword || env.KANDILO_UPLOAD_KEY_PASSWORD || '',
  };

  const missing = Object.entries(config)
    .filter(([, value]) => !value)
    .map(([key]) => key);
  if (missing.length > 0) {
    throw new Error(
      `Android release keystore config is incomplete. Set android/keystore.properties or KANDILO_UPLOAD_* env vars. Missing: ${missing.join(', ')}.`
    );
  }
  if (!existsSync(config.storeFile)) {
    throw new Error('Android release keystore file was not found at the configured storeFile path.');
  }
  return config;
}

export function androidSha256FingerprintFromKeytoolOutput(output) {
  const match = String(output ?? '').match(/SHA-?256:\s*([0-9A-Fa-f:]{64,95})/);
  if (!match) {
    throw new Error('keytool output did not contain a SHA-256 certificate fingerprint.');
  }
  return normalizeAndroidSha256Fingerprint(match[1]);
}

export function androidSha256FingerprintFromReleaseKeystore({
  rootDir = process.cwd(),
  propertiesPath = 'android/keystore.properties',
  env = process.env,
  spawnSyncFn = spawnSync,
} = {}) {
  const config = androidReleaseSigningConfig({ rootDir, propertiesPath, env });
  const keytoolEnv = {
    ...env,
    KANDILO_KEYTOOL_STOREPASS: config.storePassword,
    KANDILO_KEYTOOL_KEYPASS: config.keyPassword,
  };
  const result = spawnSyncFn('keytool', [
    '-list',
    '-v',
    '-keystore',
    config.storeFile,
    '-alias',
    config.keyAlias,
    '-storepass:env',
    'KANDILO_KEYTOOL_STOREPASS',
    '-keypass:env',
    'KANDILO_KEYTOOL_KEYPASS',
  ], {
    encoding: 'utf8',
    env: keytoolEnv,
  });

  if (result.error) {
    throw new Error(`Unable to run keytool: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error('keytool could not read the configured Android release keystore.');
  }
  return androidSha256FingerprintFromKeytoolOutput(`${result.stdout ?? ''}\n${result.stderr ?? ''}`);
}

export function buildAppleAppSiteAssociation(appleTeamId, packageId = expectedNativePackageId) {
  return {
    applinks: {
      apps: [],
      details: [
        {
          appID: `${normalizeAppleTeamId(appleTeamId)}.${packageId}`,
          paths: ['/', '/join/*', '/e/*'],
        },
      ],
    },
  };
}

export function buildAndroidAssetLinks(androidSha256Fingerprints, packageId = expectedNativePackageId) {
  return [
    {
      relation: ['delegate_permission/common.handle_all_urls'],
      target: {
        namespace: 'android_app',
        package_name: packageId,
        sha256_cert_fingerprints: normalizeAndroidSha256Fingerprints(androidSha256Fingerprints),
      },
    },
  ];
}

export function nativeLinkFileContents({ appleTeamId, androidSha256Fingerprints }) {
  const appleAppSiteAssociation = buildAppleAppSiteAssociation(appleTeamId);
  const androidAssetLinks = buildAndroidAssetLinks(androidSha256Fingerprints);
  return [
    {
      relativePath: 'public/.well-known/apple-app-site-association',
      contents: `${JSON.stringify(appleAppSiteAssociation, null, 2)}\n`,
    },
    {
      relativePath: 'public/.well-known/assetlinks.json',
      contents: `${JSON.stringify(androidAssetLinks, null, 2)}\n`,
    },
  ];
}

function readJsonFile(rootDir, relativePath) {
  return JSON.parse(readFileSync(resolve(rootDir, relativePath), 'utf8'));
}

function checkedInAppleUniversalLinksStatus(rootDir) {
  try {
    const appleAppSiteAssociation = readJsonFile(rootDir, 'public/.well-known/apple-app-site-association');
    const serialized = JSON.stringify(appleAppSiteAssociation);
    if (serialized.includes('TODO_TEAM_ID')) {
      return 'unsafe; checked-in file still contains a placeholder Apple Team ID';
    }

    const details = Array.isArray(appleAppSiteAssociation?.applinks?.details)
      ? appleAppSiteAssociation.applinks.details
      : [];
    const hasFinalAppId = details.some((detail) => {
      const appId = typeof detail?.appID === 'string' ? detail.appID : '';
      const paths = Array.isArray(detail?.paths) ? detail.paths : [];
      return /^[A-Z0-9]{10}\.com\.kandilo\.app$/.test(appId)
        && paths.includes('/')
        && paths.includes('/join/*')
        && paths.includes('/e/*');
    });

    return hasFinalAppId
      ? 'configured for com.kandilo.app'
      : 'inert; no final Apple Team ID is trusted by the checked-in file';
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return `unreadable; ${message}`;
  }
}

function checkedInAndroidAppLinksStatus(rootDir) {
  try {
    const assetLinks = readJsonFile(rootDir, 'public/.well-known/assetlinks.json');
    const entries = Array.isArray(assetLinks) ? assetLinks : [];
    const fingerprints = entries.flatMap((entry) => {
      const target = entry?.target ?? {};
      if (target.namespace !== 'android_app' || target.package_name !== expectedNativePackageId) {
        return [];
      }
      return Array.isArray(target.sha256_cert_fingerprints)
        ? target.sha256_cert_fingerprints
        : [];
    });
    const releaseFingerprints = [];
    const invalidFingerprints = [];
    for (const fingerprint of fingerprints) {
      try {
        releaseFingerprints.push(normalizeAndroidSha256Fingerprint(fingerprint));
      } catch {
        invalidFingerprints.push(fingerprint);
      }
    }

    if (invalidFingerprints.length > 0) {
      return 'unsafe; checked-in file contains an invalid or debug Android SHA-256 fingerprint';
    }

    return releaseFingerprints.length > 0
      ? `configured for ${expectedNativePackageId} with ${releaseFingerprints.length} release fingerprint(s)`
      : 'inert; no release Android SHA-256 fingerprint is trusted by the checked-in file';
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return `unreadable; ${message}`;
  }
}

export function nativeLinkDerivationStatus({
  rootDir = process.cwd(),
  env = process.env,
} = {}) {
  let appleStatus = 'ready';
  let androidStatus = 'ready';

  try {
    appleTeamIdFromXcodeProject({ rootDir });
  } catch (error) {
    appleStatus = error instanceof Error ? error.message : String(error);
  }

  try {
    androidReleaseSigningConfig({ rootDir, env });
  } catch (error) {
    androidStatus = error instanceof Error ? error.message : String(error);
  }

  return { appleStatus, androidStatus };
}

export function nativeLinkStatus({
  rootDir = process.cwd(),
  env = process.env,
} = {}) {
  return {
    checkedInAppleUniversalLinks: checkedInAppleUniversalLinksStatus(rootDir),
    checkedInAndroidAppLinks: checkedInAndroidAppLinksStatus(rootDir),
    derivation: nativeLinkDerivationStatus({ rootDir, env }),
  };
}

export function configureNativeLinks({
  rootDir = process.cwd(),
  appleTeamId,
  appleFromXcodeProject = false,
  xcodeProjectPath = 'ios/App/App.xcodeproj/project.pbxproj',
  androidSha256Fingerprints = [],
  androidFromReleaseKeystore = false,
  androidKeystorePropertiesPath = 'android/keystore.properties',
  env = process.env,
  spawnSyncFn = spawnSync,
  dryRun = false,
}) {
  const validationErrors = [];
  let resolvedAppleTeamIdValue = '';
  const resolvedAndroidSha256Fingerprints = [...androidSha256Fingerprints];

  try {
    resolvedAppleTeamIdValue = resolvedAppleTeamId({
      rootDir,
      appleTeamId,
      appleFromXcodeProject,
      xcodeProjectPath,
    });
  } catch (error) {
    validationErrors.push(error);
  }

  if (androidFromReleaseKeystore) {
    try {
      resolvedAndroidSha256Fingerprints.push(androidSha256FingerprintFromReleaseKeystore({
        rootDir,
        propertiesPath: androidKeystorePropertiesPath,
        env,
        spawnSyncFn,
      }));
    } catch (error) {
      validationErrors.push(error);
    }
  }

  if (validationErrors.length === 1) {
    throw validationErrors[0];
  }
  if (validationErrors.length > 1) {
    throw new Error(`Native link configuration has multiple blockers:\n${validationErrors
      .map((error) => `- ${error instanceof Error ? error.message : String(error)}`)
      .join('\n')}`);
  }

  const files = nativeLinkFileContents({
    appleTeamId: resolvedAppleTeamIdValue,
    androidSha256Fingerprints: resolvedAndroidSha256Fingerprints,
  });
  const results = files.map((file) => ({
    ...file,
    filePath: resolve(rootDir, file.relativePath),
  }));

  if (!dryRun) {
    for (const file of results) {
      mkdirSync(dirname(file.filePath), { recursive: true });
      writeFileSync(file.filePath, file.contents);
    }
  }

  return {
    dryRun,
    files: results,
  };
}

export function parseConfigureNativeLinksArgs(args) {
  const parsed = {
    appleFromXcodeProject: false,
    xcodeProjectPath: 'ios/App/App.xcodeproj/project.pbxproj',
    androidSha256Fingerprints: [],
    androidFromReleaseKeystore: false,
    androidKeystorePropertiesPath: 'android/keystore.properties',
    dryRun: false,
    status: false,
    help: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '-h' || arg === '--help') {
      parsed.help = true;
    } else if (arg === '--status') {
      parsed.status = true;
    } else if (arg === '--dry-run') {
      parsed.dryRun = true;
    } else if (arg === '--apple-team-id') {
      parsed.appleTeamId = requireOptionValue(args, index, arg);
      index += 1;
    } else if (arg.startsWith('--apple-team-id=')) {
      parsed.appleTeamId = arg.slice('--apple-team-id='.length);
    } else if (arg === '--apple-from-xcode-project') {
      parsed.appleFromXcodeProject = true;
    } else if (arg === '--xcode-project') {
      parsed.xcodeProjectPath = requireOptionValue(args, index, arg);
      parsed.appleFromXcodeProject = true;
      index += 1;
    } else if (arg.startsWith('--xcode-project=')) {
      parsed.xcodeProjectPath = arg.slice('--xcode-project='.length);
      parsed.appleFromXcodeProject = true;
    } else if (arg === '--android-sha256') {
      parsed.androidSha256Fingerprints.push(requireOptionValue(args, index, arg));
      index += 1;
    } else if (arg.startsWith('--android-sha256=')) {
      parsed.androidSha256Fingerprints.push(arg.slice('--android-sha256='.length));
    } else if (arg === '--android-from-release-keystore') {
      parsed.androidFromReleaseKeystore = true;
    } else if (arg === '--android-keystore-properties') {
      parsed.androidKeystorePropertiesPath = requireOptionValue(args, index, arg);
      parsed.androidFromReleaseKeystore = true;
      index += 1;
    } else if (arg.startsWith('--android-keystore-properties=')) {
      parsed.androidKeystorePropertiesPath = arg.slice('--android-keystore-properties='.length);
      parsed.androidFromReleaseKeystore = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return parsed;
}

export function main(args = process.argv.slice(2), { rootDir = process.cwd(), stdout = process.stdout, stderr = process.stderr } = {}) {
  try {
    const parsed = parseConfigureNativeLinksArgs(args);
    if (parsed.help) {
      stdout.write(`${usage}\n`);
      return 0;
    }
    if (parsed.status) {
      if (
        parsed.appleTeamId
        || parsed.appleFromXcodeProject
        || parsed.androidSha256Fingerprints.length > 0
        || parsed.androidFromReleaseKeystore
        || parsed.dryRun
      ) {
        throw new Error('--status is read-only and cannot be combined with write/derivation options.');
      }

      const status = nativeLinkStatus({ rootDir });
      stdout.write('Kandilo native HTTPS return link status\n');
      stdout.write(`- Checked-in Apple universal links: ${status.checkedInAppleUniversalLinks}\n`);
      stdout.write(`- Checked-in Android app links: ${status.checkedInAndroidAppLinks}\n`);
      stdout.write(`- Apple Team ID derivation: ${status.derivation.appleStatus}\n`);
      stdout.write(`- Android release signing derivation: ${status.derivation.androidStatus}\n`);
      stdout.write('Run npm run configure:native-links -- --apple-from-xcode-project --android-from-release-keystore when both derivation inputs are ready, or pass explicit final identifiers.\n');
      return 0;
    }

    const result = configureNativeLinks({
      rootDir,
      appleTeamId: parsed.appleTeamId,
      appleFromXcodeProject: parsed.appleFromXcodeProject,
      xcodeProjectPath: parsed.xcodeProjectPath,
      androidSha256Fingerprints: parsed.androidSha256Fingerprints,
      androidFromReleaseKeystore: parsed.androidFromReleaseKeystore,
      androidKeystorePropertiesPath: parsed.androidKeystorePropertiesPath,
      dryRun: parsed.dryRun,
    });

    for (const file of result.files) {
      stdout.write(`${result.dryRun ? 'Would write' : 'Wrote'} ${file.relativePath}\n`);
      if (result.dryRun) {
        stdout.write(file.contents);
      }
    }
    stdout.write('Run npm run check:stripe-production -- --strict-native-links after updating these files.\n');
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    stderr.write(`${message}\n\n${usage}\n`);
    return 1;
  }
}

const currentFilePath = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === currentFilePath) {
  process.exitCode = main();
}
