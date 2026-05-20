/**
 * Sets the { superAdmin: true } Firebase Auth custom claim on a given user.
 *
 * Usage:
 *   node scripts/set-super-admin.mjs <uid>
 *
 * Requires: GOOGLE_APPLICATION_CREDENTIALS env var pointing to a service account key,
 * OR run `firebase login` first (uses gcloud ADC via firebase-admin).
 *
 * After running, the user must sign out and sign back in (or call getIdToken(true))
 * for the new claim to appear in their token.
 */

import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

const uid = process.argv[2];
if (!uid) {
  console.error('Usage: node scripts/set-super-admin.mjs <uid>');
  process.exit(1);
}

initializeApp({ credential: applicationDefault(), projectId: 'kandilo-2f7a9' });

const auth = getAuth();

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
