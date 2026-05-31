/**
 * One-time bootstrap: creates the Firebase Auth account for the given email,
 * sets up the Firestore user profile, and promotes them to Priest in the given church.
 *
 * Usage: KANDILO_BOOTSTRAP_PASSWORD='...' node scripts/bootstrap-admin.js <email> <displayName> <churchId> --confirm-project kandilo-2f7a9
 */

import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

const expectedProjectId = 'kandilo-2f7a9';
const password = process.env.KANDILO_BOOTSTRAP_PASSWORD;

function usage() {
  console.error(`Usage: KANDILO_BOOTSTRAP_PASSWORD='...' node scripts/bootstrap-admin.js <email> <displayName> <churchId> --confirm-project ${expectedProjectId}`);
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

  if (positional.length !== 3) {
    fail('Expected exactly <email>, <displayName>, and <churchId>.');
  }

  return {
    email: positional[0],
    displayName: positional[1],
    churchId: positional[2],
    confirmProject,
  };
}

function assertExpectedProjectConfirmation(confirmProject) {
  if (confirmProject !== expectedProjectId) {
    fail(`Refusing to bootstrap a priest account without --confirm-project ${expectedProjectId}.`);
  }
}

const { email, displayName, churchId, confirmProject } = parseArgs(process.argv.slice(2));

if (!email || !password || !displayName || !churchId) {
  fail('Missing email, display name, church ID, or KANDILO_BOOTSTRAP_PASSWORD.');
}
assertExpectedProjectConfirmation(confirmProject);

const app = initializeApp({ credential: applicationDefault(), projectId: expectedProjectId });
const auth = getAuth(app);
const db = getFirestore(app);

async function run() {
  // 1. Fetch the church document before creating an Auth account.
  const churchDoc = await db.collection('churches').doc(churchId).get();
  if (!churchDoc.exists) {
    console.error(`Church "${churchId}" not found.`);
    process.exit(1);
  }
  const church = churchDoc.data();

  // 2. Create or fetch the Firebase Auth user
  let uid;
  try {
    const existing = await auth.getUserByEmail(email);
    uid = existing.uid;
    console.log(`User already exists with UID: ${uid}`);
  } catch {
    const created = await auth.createUser({ email, password, displayName });
    uid = created.uid;
    console.log(`Created Auth user with UID: ${uid}`);
  }

  const now = FieldValue.serverTimestamp();

  // 3. Atomic fan-out write: user profile + both membership paths
  const batch = db.batch();

  // users/{uid}
  batch.set(
    db.collection('users').doc(uid),
    {
      uid,
      email,
      displayName,
      photoURL: null,
      preferredLanguage: 'English',
      phone: '',
      ministries: [],
      description: '',
      showInDirectory: false,
      fcmTokens: [],
      createdAt: now,
    },
    { merge: true }
  );

  const membershipData = {
    userId: uid,
    churchId,
    role: 'priest',
    status: 'active',
    joinedAt: now,
    invitedBy: null,
  };

  // churches/{churchId}/members/{uid}
  batch.set(
    db.collection('churches').doc(churchId).collection('members').doc(uid),
    { ...membershipData, displayName, email, photoURL: null }
  );

  // users/{uid}/churchMemberships/{churchId}
  batch.set(
    db.collection('users').doc(uid).collection('churchMemberships').doc(churchId),
    {
      ...membershipData,
      churchName: church.name,
      imageURL: church.imageURL ?? '',
      location: church.location ?? '',
    }
  );

  await batch.commit();

  console.log('');
  console.log(`✓ Auth account ready     : ${email}`);
  console.log(`✓ Firestore profile ready: users/${uid}`);
  console.log(`✓ Priest membership set  : ${church.name} (${churchId})`);
  console.log('');
  console.log('Sign in at https://kandilo-2f7a9.web.app with the email and password you provided.');
}

run().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
