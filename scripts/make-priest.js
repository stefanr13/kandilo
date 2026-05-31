/**
 * One-time setup script: promotes a Firebase Auth user to Priest in a church.
 *
 * Usage:
 *   node scripts/make-priest.js <userUid> <churchId> --confirm-project kandilo-2f7a9
 *
 * Example (after signing up in the app and finding your UID in Firebase Console → Auth):
 *   node scripts/make-priest.js abc123uid st-simeon-south-miami --confirm-project kandilo-2f7a9
 *
 * Requires GOOGLE_APPLICATION_CREDENTIALS or firebase-admin default credentials.
 * Easiest: run `npx --no-install firebase login` first, then this script uses the CLI credentials.
 */

import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

const expectedProjectId = 'kandilo-2f7a9';

function usage() {
  console.error(`Usage: node scripts/make-priest.js <userUid> <churchId> --confirm-project ${expectedProjectId}`);
  console.error(`Example: node scripts/make-priest.js abc123 st-simeon-south-miami --confirm-project ${expectedProjectId}`);
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

  if (positional.length !== 2) {
    fail('Expected exactly <userUid> and <churchId>.');
  }

  return {
    uid: positional[0],
    churchId: positional[1],
    confirmProject,
  };
}

function assertExpectedProjectConfirmation(confirmProject) {
  if (confirmProject !== expectedProjectId) {
    fail(`Refusing to grant priest membership without --confirm-project ${expectedProjectId}.`);
  }
}

const { uid, churchId, confirmProject } = parseArgs(process.argv.slice(2));
assertExpectedProjectConfirmation(confirmProject);

const app = initializeApp({ credential: applicationDefault(), projectId: expectedProjectId });
const auth = getAuth(app);
const db = getFirestore(app);

async function run() {
  const churchRef = db.collection('churches').doc(churchId);
  const churchDoc = await churchRef.get();

  if (!churchDoc.exists) {
    console.error(`Church "${churchId}" not found in Firestore.`);
    process.exit(1);
  }

  const churchName = churchDoc.data().name;
  const user = await auth.getUser(uid);
  const now = FieldValue.serverTimestamp();
  const membershipData = {
    userId: uid,
    churchId,
    role: 'priest',
    status: 'active',
    displayName: user.displayName ?? '',
    email: user.email ?? '',
    photoURL: user.photoURL ?? null,
    joinedAt: now,
    invitedBy: null,
  };

  // Fan-out write: update both paths atomically
  const batch = db.batch();

  // churches/{churchId}/members/{uid}
  batch.set(db.collection('churches').doc(churchId).collection('members').doc(uid), membershipData);

  // users/{uid}/churchMemberships/{churchId}
  batch.set(db.collection('users').doc(uid).collection('churchMemberships').doc(churchId), {
    ...membershipData,
    churchName,
    imageURL: churchDoc.data().imageURL ?? '',
    location: churchDoc.data().location ?? '',
  });

  await batch.commit();

  console.log(`✓ User ${uid} is now a Priest at "${churchName}" (${churchId})`);
}

run().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
