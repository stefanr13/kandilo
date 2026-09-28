import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

const scriptPath = resolve(process.cwd(), 'scripts/configure-native-links.mjs');
const releaseFingerprint =
  '00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF';
const compactReleaseFingerprint = releaseFingerprint.replaceAll(':', '').toLowerCase();

type NativeLinksScript = {
  androidDebugSha256Fingerprint: string;
  configureNativeLinks(options: {
    rootDir?: string;
    appleTeamId?: string;
    appleFromXcodeProject?: boolean;
    xcodeProjectPath?: string;
    androidSha256Fingerprints: string[];
    androidFromReleaseKeystore?: boolean;
    androidKeystorePropertiesPath?: string;
    env?: Record<string, string | undefined>;
    spawnSyncFn?: typeof spawnSync;
    dryRun?: boolean;
  }): {
    dryRun: boolean;
    files: Array<{ relativePath: string; filePath: string; contents: string }>;
  };
  appleTeamIdFromXcodeProject(options?: {
    rootDir?: string;
    projectPath?: string;
  }): string;
  androidSha256FingerprintFromKeytoolOutput(output: string): string;
  parsePropertiesFile(contents: string): Record<string, string>;
  normalizeAppleTeamId(value: string): string;
  normalizeAndroidSha256Fingerprint(value: string): string;
  nativeLinkStatus(options?: {
    rootDir?: string;
    env?: Record<string, string | undefined>;
  }): {
    checkedInAppleUniversalLinks: string;
    checkedInAndroidAppLinks: string;
    derivation: {
      appleStatus: string;
      androidStatus: string;
    };
  };
  parseConfigureNativeLinksArgs(args: string[]): {
    appleTeamId?: string;
    appleFromXcodeProject: boolean;
    xcodeProjectPath: string;
    androidSha256Fingerprints: string[];
    androidFromReleaseKeystore: boolean;
    androidKeystorePropertiesPath: string;
    dryRun: boolean;
    status: boolean;
    help: boolean;
  };
};

async function loadScript() {
  return import(pathToFileURL(scriptPath).href) as Promise<NativeLinksScript>;
}

function tempRoot() {
  return mkdtempSync(join(tmpdir(), 'kandilo-native-links-'));
}

describe('native link configuration helper', () => {
  it('keeps checked-in native link placeholders inert until final release identifiers are configured', async () => {
    const { androidDebugSha256Fingerprint, nativeLinkStatus } = await loadScript();
    const appleFile = readFileSync(
      resolve(process.cwd(), 'public/.well-known/apple-app-site-association'),
      'utf8'
    );
    const androidFile = readFileSync(
      resolve(process.cwd(), 'public/.well-known/assetlinks.json'),
      'utf8'
    );

    expect(appleFile).not.toContain('TODO_TEAM_ID');
    expect(androidFile).not.toContain(androidDebugSha256Fingerprint);

    const status = nativeLinkStatus();
    expect(status.checkedInAppleUniversalLinks).toContain('inert');
    expect(status.checkedInAndroidAppLinks).toContain('inert');
  });

  it('prints a read-only native link status without requiring final identifiers', async () => {
    const result = spawnSync(process.execPath, [scriptPath, '--status'], {
      cwd: process.cwd(),
      encoding: 'utf8',
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Kandilo native HTTPS return link status');
    expect(result.stdout).toContain('Checked-in Apple universal links:');
    expect(result.stdout).toContain('Checked-in Android app links:');
    expect(result.stdout).toContain('Apple Team ID derivation:');
    expect(result.stdout).toContain('Android release signing derivation:');
    expect(result.stdout).toContain('Run npm run configure:native-links');
    expect(result.stdout).not.toContain('Wrote public/.well-known');
    expect(result.stderr).toBe('');
  });

  it('reports unsafe checked-in native link placeholders separately from inert files', async () => {
    const { androidDebugSha256Fingerprint, nativeLinkStatus } = await loadScript();
    const rootDir = tempRoot();
    try {
      mkdirSync(join(rootDir, 'public/.well-known'), { recursive: true });
      writeFileSync(join(rootDir, 'public/.well-known/apple-app-site-association'), JSON.stringify({
        applinks: {
          apps: [],
          details: [{ appID: 'TODO_TEAM_ID.com.kandilo.app', paths: ['/', '/join/*'] }],
        },
      }));
      writeFileSync(join(rootDir, 'public/.well-known/assetlinks.json'), JSON.stringify([
        {
          relation: ['delegate_permission/common.handle_all_urls'],
          target: {
            namespace: 'android_app',
            package_name: 'com.kandilo.app',
            sha256_cert_fingerprints: [androidDebugSha256Fingerprint],
          },
        },
      ]));

      const status = nativeLinkStatus({ rootDir, env: {} });

      expect(status.checkedInAppleUniversalLinks).toContain('unsafe');
      expect(status.checkedInAndroidAppLinks).toContain('unsafe');
    } finally {
      rmSync(rootDir, { recursive: true, force: true });
    }
  });

  it('writes final Apple universal-link and Android app-link files with normalized identifiers', async () => {
    const { configureNativeLinks } = await loadScript();
    const rootDir = tempRoot();
    try {
      const result = configureNativeLinks({
        rootDir,
        appleTeamId: 'ab12cd34ef',
        androidSha256Fingerprints: [compactReleaseFingerprint],
      });

      expect(result.dryRun).toBe(false);
      expect(result.files.map((file) => file.relativePath)).toEqual([
        'public/.well-known/apple-app-site-association',
        'public/.well-known/assetlinks.json',
      ]);

      const appleFile = JSON.parse(readFileSync(join(rootDir, 'public/.well-known/apple-app-site-association'), 'utf8'));
      const androidFile = JSON.parse(readFileSync(join(rootDir, 'public/.well-known/assetlinks.json'), 'utf8'));

      expect(appleFile.applinks.details[0]).toEqual({
        appID: 'AB12CD34EF.com.kandilo.app',
        paths: ['/', '/join/*', '/e/*'],
      });
      expect(androidFile[0]).toEqual({
        relation: ['delegate_permission/common.handle_all_urls'],
        target: {
          namespace: 'android_app',
          package_name: 'com.kandilo.app',
          sha256_cert_fingerprints: [releaseFingerprint],
        },
      });
    } finally {
      rmSync(rootDir, { recursive: true, force: true });
    }
  });

  it('validates without writing files in dry-run mode', async () => {
    const { configureNativeLinks } = await loadScript();
    const rootDir = tempRoot();
    try {
      const result = configureNativeLinks({
        rootDir,
        appleTeamId: 'AB12CD34EF',
        androidSha256Fingerprints: [releaseFingerprint],
        dryRun: true,
      });

      expect(result.dryRun).toBe(true);
      expect(result.files[0].contents).toContain('AB12CD34EF.com.kandilo.app');
      expect(result.files[1].contents).toContain(releaseFingerprint);
      expect(existsSync(join(rootDir, 'public/.well-known/apple-app-site-association'))).toBe(false);
      expect(existsSync(join(rootDir, 'public/.well-known/assetlinks.json'))).toBe(false);
    } finally {
      rmSync(rootDir, { recursive: true, force: true });
    }
  });

  it('derives the Apple Team ID from the Xcode project signing settings', async () => {
    const { appleTeamIdFromXcodeProject, configureNativeLinks } = await loadScript();
    const rootDir = tempRoot();
    try {
      mkdirSync(join(rootDir, 'ios/App/App.xcodeproj'), { recursive: true });
      writeFileSync(join(rootDir, 'ios/App/App.xcodeproj/project.pbxproj'), `
        buildSettings = {
          DEVELOPMENT_TEAM = AB12CD34EF;
          PRODUCT_BUNDLE_IDENTIFIER = com.kandilo.app;
        };
        buildSettings = {
          DEVELOPMENT_TEAM = AB12CD34EF;
          PRODUCT_BUNDLE_IDENTIFIER = com.kandilo.app;
        };
      `);

      expect(appleTeamIdFromXcodeProject({ rootDir })).toBe('AB12CD34EF');

      const result = configureNativeLinks({
        rootDir,
        appleFromXcodeProject: true,
        androidSha256Fingerprints: [releaseFingerprint],
        dryRun: true,
      });

      expect(result.files[0].contents).toContain('AB12CD34EF.com.kandilo.app');
    } finally {
      rmSync(rootDir, { recursive: true, force: true });
    }
  });

  it('fails closed when Xcode signing has no unique Team ID for Kandilo', async () => {
    const { appleTeamIdFromXcodeProject, configureNativeLinks } = await loadScript();
    const rootDir = tempRoot();
    try {
      mkdirSync(join(rootDir, 'ios/App/App.xcodeproj'), { recursive: true });
      writeFileSync(join(rootDir, 'ios/App/App.xcodeproj/project.pbxproj'), `
        buildSettings = {
          CODE_SIGN_STYLE = Automatic;
          PRODUCT_BUNDLE_IDENTIFIER = com.kandilo.app;
        };
      `);

      expect(() => appleTeamIdFromXcodeProject({ rootDir })).toThrow('DEVELOPMENT_TEAM');

      writeFileSync(join(rootDir, 'ios/App/App.xcodeproj/project.pbxproj'), `
        buildSettings = {
          DEVELOPMENT_TEAM = AB12CD34EF;
          PRODUCT_BUNDLE_IDENTIFIER = com.kandilo.app;
        };
        buildSettings = {
          DEVELOPMENT_TEAM = ZZ99YY88XX;
          PRODUCT_BUNDLE_IDENTIFIER = com.kandilo.app;
        };
      `);
      expect(() => appleTeamIdFromXcodeProject({ rootDir })).toThrow('multiple DEVELOPMENT_TEAM');

      writeFileSync(join(rootDir, 'ios/App/App.xcodeproj/project.pbxproj'), `
        buildSettings = {
          DEVELOPMENT_TEAM = AB12CD34EF;
          PRODUCT_BUNDLE_IDENTIFIER = com.kandilo.app;
        };
      `);
      expect(() => configureNativeLinks({
        rootDir,
        appleTeamId: 'ZZ99YY88XX',
        appleFromXcodeProject: true,
        androidSha256Fingerprints: [releaseFingerprint],
        dryRun: true,
      })).toThrow('does not match');
    } finally {
      rmSync(rootDir, { recursive: true, force: true });
    }
  });

  it('reports every derived native-link blocker before writing files', async () => {
    const { configureNativeLinks } = await loadScript();
    const rootDir = tempRoot();
    try {
      mkdirSync(join(rootDir, 'ios/App/App.xcodeproj'), { recursive: true });
      writeFileSync(join(rootDir, 'ios/App/App.xcodeproj/project.pbxproj'), `
        buildSettings = {
          CODE_SIGN_STYLE = Automatic;
          PRODUCT_BUNDLE_IDENTIFIER = com.kandilo.app;
        };
      `);

      expect(() => configureNativeLinks({
        rootDir,
        appleFromXcodeProject: true,
        androidSha256Fingerprints: [],
        androidFromReleaseKeystore: true,
        dryRun: true,
        env: {},
      })).toThrow(/multiple blockers:[\s\S]*DEVELOPMENT_TEAM[\s\S]*Android release keystore config is incomplete/);
      expect(existsSync(join(rootDir, 'public/.well-known/apple-app-site-association'))).toBe(false);
      expect(existsSync(join(rootDir, 'public/.well-known/assetlinks.json'))).toBe(false);
    } finally {
      rmSync(rootDir, { recursive: true, force: true });
    }
  });

  it('derives the Android release SHA-256 from the configured release keystore without command-line passwords', async () => {
    const {
      androidSha256FingerprintFromKeytoolOutput,
      configureNativeLinks,
      parsePropertiesFile,
    } = await loadScript();
    const rootDir = tempRoot();
    try {
      mkdirSync(join(rootDir, 'android'), { recursive: true });
      writeFileSync(join(rootDir, 'android/release.jks'), 'fake keystore for mocked keytool');
      writeFileSync(join(rootDir, 'android/keystore.properties'), [
        'storeFile=../release.jks',
        'storePassword=secret-store-pass',
        'keyAlias=kandilo-release',
        'keyPassword=secret-key-pass',
      ].join('\n'));

      const keytoolOutput = `Certificate fingerprints:\n\t SHA256: ${releaseFingerprint}\n`;
      expect(androidSha256FingerprintFromKeytoolOutput(keytoolOutput)).toBe(releaseFingerprint);
      expect(parsePropertiesFile('storeFile=/tmp/release.jks\nkeyAlias: kandilo-release\n')).toEqual({
        storeFile: '/tmp/release.jks',
        keyAlias: 'kandilo-release',
      });

      const calls: Array<{ command: string; args: string[]; env?: NodeJS.ProcessEnv }> = [];
      const result = configureNativeLinks({
        rootDir,
        appleTeamId: 'AB12CD34EF',
        androidSha256Fingerprints: [],
        androidFromReleaseKeystore: true,
        dryRun: true,
        env: {},
        spawnSyncFn: ((command: string, args: string[], options: { env?: NodeJS.ProcessEnv }) => {
          calls.push({ command, args, env: options.env });
          return {
            status: 0,
            stdout: keytoolOutput,
            stderr: '',
          };
        }) as typeof spawnSync,
      });

      expect(result.files[1].contents).toContain(releaseFingerprint);
      expect(calls).toHaveLength(1);
      expect(calls[0].command).toBe('keytool');
      expect(calls[0].args).toContain('-storepass:env');
      expect(calls[0].args).toContain('-keypass:env');
      expect(calls[0].args).not.toContain('secret-store-pass');
      expect(calls[0].args).not.toContain('secret-key-pass');
      expect(calls[0].env?.KANDILO_KEYTOOL_STOREPASS).toBe('secret-store-pass');
      expect(calls[0].env?.KANDILO_KEYTOOL_KEYPASS).toBe('secret-key-pass');
    } finally {
      rmSync(rootDir, { recursive: true, force: true });
    }
  });

  it('rejects placeholders, missing release fingerprints, and known debug Android fingerprints', async () => {
    const {
      androidDebugSha256Fingerprint,
      configureNativeLinks,
      normalizeAppleTeamId,
      normalizeAndroidSha256Fingerprint,
    } = await loadScript();

    expect(() => normalizeAppleTeamId('TODO_TEAM_ID')).toThrow('exactly 10');
    expect(() => normalizeAndroidSha256Fingerprint(androidDebugSha256Fingerprint)).toThrow('debug keystore');
    expect(() => configureNativeLinks({
      appleTeamId: 'AB12CD34EF',
      androidSha256Fingerprints: [],
      dryRun: true,
    })).toThrow('At least one Android release SHA-256 fingerprint is required');
  });

  it('parses repeated release fingerprints and refuses missing CLI arguments', async () => {
    const { parseConfigureNativeLinksArgs } = await loadScript();

    expect(parseConfigureNativeLinksArgs([
      '--apple-team-id=AB12CD34EF',
      '--apple-from-xcode-project',
      '--xcode-project',
      'ios/App.xcodeproj/project.pbxproj',
      '--android-sha256',
      releaseFingerprint,
      '--android-sha256=11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00',
      '--android-from-release-keystore',
      '--android-keystore-properties',
      'android/upload.properties',
      '--dry-run',
    ])).toEqual({
      appleTeamId: 'AB12CD34EF',
      appleFromXcodeProject: true,
      xcodeProjectPath: 'ios/App.xcodeproj/project.pbxproj',
      androidSha256Fingerprints: [
        releaseFingerprint,
        '11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00',
      ],
      androidFromReleaseKeystore: true,
      androidKeystorePropertiesPath: 'android/upload.properties',
      dryRun: true,
      status: false,
      help: false,
    });

    expect(parseConfigureNativeLinksArgs(['--status'])).toEqual({
      appleFromXcodeProject: false,
      xcodeProjectPath: 'ios/App/App.xcodeproj/project.pbxproj',
      androidSha256Fingerprints: [],
      androidFromReleaseKeystore: false,
      androidKeystorePropertiesPath: 'android/keystore.properties',
      dryRun: false,
      status: true,
      help: false,
    });

    const result = spawnSync(process.execPath, [scriptPath, '--apple-team-id', 'AB12CD34EF'], {
      cwd: process.cwd(),
      encoding: 'utf8',
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('At least one Android release SHA-256 fingerprint is required.');
    expect(result.stderr).toContain('Usage:');

    const combinedStatus = spawnSync(process.execPath, [scriptPath, '--status', '--dry-run'], {
      cwd: process.cwd(),
      encoding: 'utf8',
    });

    expect(combinedStatus.status).toBe(1);
    expect(combinedStatus.stderr).toContain('--status is read-only');
    expect(combinedStatus.stdout).toBe('');
  });
});
