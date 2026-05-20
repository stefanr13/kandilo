/**
 * One-time setup script: promotes a Firebase Auth user to Priest in a church.
 *
 * Usage:
 *   node scripts/make-priest.js <userUid> <churchId>
 *
 * Example (after signing up in the app and finding your UID in Firebase Console → Auth):
 *   node scripts/make-priest.js abc123uid st-simeon-south-miami
 *
 * Requires GOOGLE_APPLICATION_CREDENTIALS or firebase-admin default credentials.
 * Easiest: run `firebase login` first, then this script uses the CLI credentials.
 */

import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

const [, , uid, churchId] = process.argv;

if (!uid || !churchId) {
  console.error('Usage: node scripts/make-priest.js <userUid> <churchId>');
  console.error('Example: node scripts/make-priest.js abc123 st-simeon-south-miami');
  process.exit(1);
}

initializeApp({ credential: applicationDefault() });
const auth = getAuth();
const db = getFirestore();

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
