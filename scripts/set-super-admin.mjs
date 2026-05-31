/**
 * Sets the { superAdmin: true } Firebase Auth custom claim on a given user.
 *
 * Usage:
 *   node scripts/set-super-admin.mjs <uid> --confirm-project kandilo-2f7a9
 *
 * Requires: GOOGLE_APPLICATION_CREDENTIALS env var pointing to a service account key,
 * OR run `npx --no-install firebase login` first (uses gcloud ADC via firebase-admin).
 *
 * After running, the user must sign out and sign back in (or call getIdToken(true))
 * for the new claim to appear in their token.
 */

import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

const expectedProjectId = 'kandilo-2f7a9';

function usage() {
  console.error(`Usage: node scripts/set-super-admin.mjs <uid> --confirm-project ${expectedProjectId}`);
}

function fail(message) {
  console.error(message);
  usage();
  process.exit(1);
}

function parseArgs(rawArgs) {
  const positional = [];
  let confirmProject = '';

  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];
    if (arg === '--confirm-project') {
      const value = rawArgs[index + 1];
      if (!value || value.startsWith('--')) {
        fail('Missing value for --confirm-project.');
      }
      confirmProject = value;
      index += 1;
    } else if (arg.startsWith('--')) {
      fail(`Unknown argument ${arg}.`);
    } else {
      positional.push(arg);
    }
  }

  if (positional.length !== 1) {
    fail('Expected exactly <uid>.');
  }

  return {
    uid: positional[0],
    confirmProject,
  };
}

function assertExpectedProjectConfirmation(confirmProject) {
  if (confirmProject !== expectedProjectId) {
    fail(`Refusing to grant superAdmin without --confirm-project ${expectedProjectId}.`);
  }
}

const { uid, confirmProject } = parseArgs(process.argv.slice(2));
assertExpectedProjectConfirmation(confirmProject);

const app = initializeApp({ credential: applicationDefault(), projectId: expectedProjectId });

const auth = getAuth(app);

async function run() {
  const user = await auth.getUser(uid);
  console.log(`Found user: ${user.email} (${user.uid})`);

  const existing = user.customClaims ?? {};
  await auth.setCustomUserClaims(uid, { ...existing, superAdmin: true });

  console.log(`✓ superAdmin: true claim set on ${user.email}`);
  console.log('  The user must refresh their ID token (sign out / sign in) for it to take effect.');
}

run().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
