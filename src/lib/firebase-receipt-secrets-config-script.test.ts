import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

const scriptPath = resolve(process.cwd(), 'scripts/configure-firebase-receipt-secrets.mjs');

type RunnerCall = {
  command: string;
  args: string[];
  options: {
    cwd?: string;
    stdio?: string;
    env?: NodeJS.ProcessEnv;
  };
};

type ReceiptSecretsScript = {
  assertAllowedReceiptSecretName(secretName: string): string;
  assertExpectedFirebaseProject(rootDir?: string): void;
  expectedProjectId: string;
  firebaseSecretSetArgs(secretName: string): string[];
  main(args: string[], options: {
    cwd?: string;
    stdout: { write(value: string): void };
    stderr: { write(value: string): void };
    runner?: (command: string, args: string[], options: RunnerCall['options']) => { status: number; error?: Error };
  }): Promise<number>;
  receiptSecretNames: string[];
  readDefaultFirebaseProject(rootDir?: string): string;
  validateArgs(args: string[]): void;
};

async function loadScript() {
  return import(pathToFileURL(scriptPath).href) as Promise<ReceiptSecretsScript>;
}

function tempRoot(projectId = 'kandilo-2f7a9') {
  const rootDir = mkdtempSync(join(tmpdir(), 'kandilo-receipt-secrets-'));
  writeFileSync(join(rootDir, '.firebaserc'), JSON.stringify({ projects: { default: projectId } }));
  return rootDir;
}

function writer() {
  let output = '';
  return {
    sink: {
      write(value: string) {
        output += value;
      },
    },
    output: () => output,
  };
}

describe('Firebase receipt Secret Manager setup helper', () => {
  it('prints a no-network plan for the exact receipt production secrets', async () => {
    const { main, receiptSecretNames } = await loadScript();
    const stdout = writer();
    const stderr = writer();

    const exitCode = await main([], {
      stdout: stdout.sink,
      stderr: stderr.sink,
      runner: () => {
        throw new Error('network should not run');
      },
    });

    expect(exitCode).toBe(0);
    expect(receiptSecretNames).toEqual(['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'RESEND_API_KEY']);
    expect(stdout.output()).toContain('Kandilo receipt production Secret Manager setup plan');
    expect(stdout.output()).toContain('npm run configure:receipt-secrets -- --set STRIPE_SECRET_KEY --confirm-project kandilo-2f7a9');
    expect(stderr.output()).toBe('');
  });

  it('builds pinned Firebase CLI arguments for one allowed secret', async () => {
    const { firebaseSecretSetArgs } = await loadScript();

    expect(firebaseSecretSetArgs('STRIPE_WEBHOOK_SECRET')).toEqual([
      '--no-install',
      'firebase',
      'functions:secrets:set',
      'STRIPE_WEBHOOK_SECRET',
      '--project',
      'kandilo-2f7a9',
    ]);
  });

  it('rejects unknown secret names before invoking Firebase CLI', async () => {
    const { assertAllowedReceiptSecretName, main } = await loadScript();
    const stderr = writer();

    expect(() => assertAllowedReceiptSecretName('GEMINI_API_KEY')).toThrow('Unsupported receipt secret');
    expect(await main(['--set', 'GEMINI_API_KEY', '--confirm-project', 'kandilo-2f7a9'], {
      stdout: writer().sink,
      stderr: stderr.sink,
      runner: () => {
        throw new Error('network should not run');
      },
    })).toBe(1);
    expect(stderr.output()).toContain('Unsupported receipt secret');
  });

  it('rejects unknown or malformed arguments before invoking Firebase CLI', async () => {
    const { main, validateArgs } = await loadScript();
    const stderr = writer();

    expect(() => validateArgs(['--set', 'STRIPE_SECRET_KEY', '--confirm-project', 'kandilo-2f7a9'])).not.toThrow();
    expect(() => validateArgs(['--set-all=true'])).toThrow('--set-all does not accept a value');
    expect(() => validateArgs(['--set'])).toThrow('Missing value for --set');
    expect(() => validateArgs(['--confirm-project'])).toThrow('Missing value for --confirm-project');
    expect(() => validateArgs(['--secret', 'STRIPE_SECRET_KEY'])).toThrow('Unknown argument --secret');
    expect(() => validateArgs(['STRIPE_SECRET_KEY'])).toThrow('Unexpected positional argument');

    expect(await main(['--secret', 'STRIPE_SECRET_KEY'], {
      stdout: writer().sink,
      stderr: stderr.sink,
      runner: () => {
        throw new Error('network should not run');
      },
    })).toBe(1);
    expect(stderr.output()).toContain('Unknown argument --secret');
  });

  it('requires explicit project confirmation and matching .firebaserc before writes', async () => {
    const { assertExpectedFirebaseProject, main } = await loadScript();
    const wrongRoot = tempRoot('wrong-project');
    try {
      expect(() => assertExpectedFirebaseProject(wrongRoot)).toThrow('default project must be kandilo-2f7a9');

      const missingConfirmation = writer();
      expect(await main(['--set', 'STRIPE_SECRET_KEY'], {
        cwd: wrongRoot,
        stdout: writer().sink,
        stderr: missingConfirmation.sink,
        runner: () => {
          throw new Error('network should not run');
        },
      })).toBe(1);
      expect(missingConfirmation.output()).toContain('--confirm-project kandilo-2f7a9');

      const wrongProject = writer();
      expect(await main(['--set', 'STRIPE_SECRET_KEY', '--confirm-project', 'kandilo-2f7a9'], {
        cwd: wrongRoot,
        stdout: writer().sink,
        stderr: wrongProject.sink,
        runner: () => {
          throw new Error('network should not run');
        },
      })).toBe(1);
      expect(wrongProject.output()).toContain('.firebaserc default project must be kandilo-2f7a9');
    } finally {
      rmSync(wrongRoot, { recursive: true, force: true });
    }
  });

  it('runs the pinned Firebase CLI once per selected receipt secret', async () => {
    const { main } = await loadScript();
    const rootDir = tempRoot();
    const stdout = writer();
    const calls: RunnerCall[] = [];
    try {
      const exitCode = await main(['--set-all', '--confirm-project', 'kandilo-2f7a9'], {
        cwd: rootDir,
        stdout: stdout.sink,
        stderr: writer().sink,
        runner: (command, args, options) => {
          calls.push({ command, args, options });
          return { status: 0 };
        },
      });

      expect(exitCode).toBe(0);
      expect(calls).toHaveLength(3);
      expect(calls.map((call) => call.args[3])).toEqual([
        'STRIPE_SECRET_KEY',
        'STRIPE_WEBHOOK_SECRET',
        'RESEND_API_KEY',
      ]);
      expect(calls.every((call) => call.args.includes('--no-install'))).toBe(true);
      expect(calls.every((call) => call.options.cwd === rootDir)).toBe(true);
      expect(stdout.output()).toContain('Receipt secrets updated');
    } finally {
      rmSync(rootDir, { recursive: true, force: true });
    }
  });
});
