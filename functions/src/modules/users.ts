import * as v1 from 'firebase-functions/v1';
import { db } from '../shared/firebase';
import { getStorage } from 'firebase-admin/storage';
import { AUTH_TRIGGER_REGION } from '../shared/regions';
import { normalizeEmail } from '../shared/security';

export const onUserDeleted = v1.runWith({ failurePolicy: true }).region(AUTH_TRIGGER_REGION).auth.user().onDelete(async (user) => {
  const uid = user.uid;
  const email = user.email ? normalizeEmail(user.email) : null;

  const membershipsSnap = await db
    .collection('users')
    .doc(uid)
    .collection('churchMemberships')
    .get();

  const [sentInvitesSnap, receivedInvitesSnap, tokenOwners, memberDocs, customerOrders] = await Promise.all([
    db.collection('invitations').where('invitedBy', '==', uid).get(),
    email ? db.collection('invitations').where('inviteeEmail', '==', email).get() : null,
    db.collection('pushTokenOwners').where('userId', '==', uid).get(),
    db.collectionGroup('members').where('userId', '==', uid).get(),
    db.collection('eventOrderPrivate').where('requestUserId', '==', uid).get(),
  ]);

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

  const extraDeletes = new Map<string, FirebaseFirestore.DocumentReference>();
  for (const doc of [...sentInvitesSnap.docs, ...(receivedInvitesSnap?.docs ?? []), ...tokenOwners.docs, ...memberDocs.docs]) {
    extraDeletes.set(doc.ref.path, doc.ref);
  }
  for (const ref of extraDeletes.values()) {
    await flushIfNeeded(); currentBatch.delete(ref); opCount++;
  }
  for (const privateOrder of customerOrders.docs) {
    const orderRef = db.collection('eventOrders').doc(privateOrder.id);
    const order = await orderRef.get();
    if (order.exists) {
      await flushIfNeeded();
      currentBatch.update(orderRef, { customerName: 'Deleted account', customerEmail: '', customerPhone: '', specialInstructions: '' });
      opCount++;
    }
    await flushIfNeeded(); currentBatch.delete(privateOrder.ref); opCount++;
  }

  await currentBatch.commit();
  await getStorage().bucket().deleteFiles({ prefix: `users/${uid}/` });
  console.log(`Cleaned up Firestore data for deleted user ${uid}`);
});
