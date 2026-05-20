/**
 * One-time bootstrap: creates the Firebase Auth account for the given email,
 * sets up the Firestore user profile, and promotes them to Priest in the given church.
 *
 * Usage: KANDILO_BOOTSTRAP_PASSWORD='...' node scripts/bootstrap-admin.js <email> <displayName> <churchId>
 */

import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

const [, , email, displayName, churchId] = process.argv;
const password = process.env.KANDILO_BOOTSTRAP_PASSWORD;

if (!email || !password || !displayName || !churchId) {
  console.error("Usage: KANDILO_BOOTSTRAP_PASSWORD='...' node scripts/bootstrap-admin.js <email> <displayName> <churchId>");
  process.exit(1);
}

initializeApp({ credential: applicationDefault(), projectId: 'kandilo-2f7a9' });
const auth = getAuth();
const db = getFirestore();

async function run() {
  // 1. Create or fetch the Firebase Auth user
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

  // 2. Fetch the church document
  const churchDoc = await db.collection('churches').doc(churchId).get();
  if (!churchDoc.exists) {
    console.error(`Church "${churchId}" not found.`);
    process.exit(1);
  }
  const church = churchDoc.data();

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
