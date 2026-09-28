import { createHash } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { db } from '../shared/firebase';
import { assertFreshAppCheck, assertNonAnonymousUser, assertVerifiedNonAnonymousUser, checkRateLimit, replayProtectedCallableOptions } from '../shared/security';
import { assertNonEmptyString, callableDataRecord } from '../shared/validation';

export function pushTokenId(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export const registerPushToken = onCall(replayProtectedCallableOptions, async (request) => {
  assertFreshAppCheck(request);
  assertVerifiedNonAnonymousUser(request);
  const uid = request.auth!.uid;
  const token = assertNonEmptyString(callableDataRecord(request.data).token, 4096, 'token');
  if (token.length < 20 || /^[a-f0-9]{64}$/i.test(token)) {
    throw new HttpsError('invalid-argument', 'An FCM registration token is required.');
  }
  await checkRateLimit(uid, 'registerPushToken', 30);
  const tokenRef = db.collection('pushTokenOwners').doc(pushTokenId(token));
  const userRef = db.collection('users').doc(uid);
  await db.runTransaction(async (tx) => {
    const [owner, user] = await Promise.all([tx.get(tokenRef), tx.get(userRef)]);
    if (!user.exists) throw new HttpsError('failed-precondition', 'Your profile is not ready. Please retry.');
    const previousUid = owner.data()?.userId;
    const previousUser = typeof previousUid === 'string' && previousUid !== uid
      ? await tx.get(db.collection('users').doc(previousUid)) : null;
    if (previousUser?.exists) tx.update(previousUser.ref, { fcmTokens: FieldValue.arrayRemove(token) });
    const tokens = Array.isArray(user.data()?.fcmTokens)
      ? user.data()!.fcmTokens.filter((value: unknown): value is string => typeof value === 'string' && value !== token) : [];
    tx.update(userRef, { fcmTokens: [...tokens, token].slice(-10) });
    tx.set(tokenRef, { userId: uid, updatedAt: FieldValue.serverTimestamp() });
  });
  return { success: true };
});

export const unregisterPushToken = onCall(replayProtectedCallableOptions, async (request) => {
  assertFreshAppCheck(request);
  assertNonAnonymousUser(request);
  const uid = request.auth!.uid;
  const token = assertNonEmptyString(callableDataRecord(request.data).token, 4096, 'token');
  const tokenRef = db.collection('pushTokenOwners').doc(pushTokenId(token));
  const userRef = db.collection('users').doc(uid);
  await db.runTransaction(async (tx) => {
    const [owner, user] = await Promise.all([tx.get(tokenRef), tx.get(userRef)]);
    if (owner.data()?.userId === uid) tx.delete(tokenRef);
    if (user.exists) tx.update(userRef, { fcmTokens: FieldValue.arrayRemove(token) });
  });
  return { success: true };
});
