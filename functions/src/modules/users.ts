import * as v1 from 'firebase-functions/v1';
import { db } from '../shared/firebase';
import { AUTH_TRIGGER_REGION } from '../shared/regions';
import { normalizeEmail } from '../shared/security';

export const onUserDeleted = v1.region(AUTH_TRIGGER_REGION).auth.user().onDelete(async (user) => {
  const uid = user.uid;
  const email = user.email ? normalizeEmail(user.email) : null;

  const membershipsSnap = await db
    .collection('users')
    .doc(uid)
    .collection('churchMemberships')
    .get();

  const sentInvitesSnap = await db
    .collection('invitations')
    .where('invitedBy', '==', uid)
    .where('status', '==', 'pending')
    .get();

  const receivedInvitesSnap = email
    ? await db
        .collection('invitations')
        .where('inviteeEmail', '==', email)
        .where('status', '==', 'pending')
        .get()
    : null;

  const BATCH_LIMIT = 490;
  let currentBatch = db.batch();
  let opCount = 0;

  const flushIfNeeded = async () => {
    if (opCount >= BATCH_LIMIT) {
      await currentBatch.commit();
      currentBatch = db.batch();
      opCount = 0;
    }
  };

  for (const membershipDoc of membershipsSnap.docs) {
    await flushIfNeeded();
    const churchId = membershipDoc.id;
    currentBatch.delete(db.collection('churches').doc(churchId).collection('members').doc(uid));
    opCount++;
    await flushIfNeeded();
    currentBatch.delete(membershipDoc.ref);
    opCount++;
  }

  await flushIfNeeded();
  currentBatch.delete(db.collection('users').doc(uid));
  opCount++;

  for (const inviteDoc of sentInvitesSnap.docs) {
    await flushIfNeeded();
    currentBatch.update(inviteDoc.ref, { status: 'cancelled' });
    opCount++;
  }

  if (receivedInvitesSnap) {
    for (const inviteDoc of receivedInvitesSnap.docs) {
      await flushIfNeeded();
      currentBatch.update(inviteDoc.ref, { status: 'cancelled' });
      opCount++;
    }
  }

  await currentBatch.commit();
  console.log(`Cleaned up Firestore data for deleted user ${uid}`);
});
