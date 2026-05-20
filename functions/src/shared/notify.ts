import { FieldValue } from 'firebase-admin/firestore';
import { isFunctionsEmulatorTestMode } from './emulatorTest';
import { db, fcm } from './firebase';

const INVALID_FCM_ERROR_CODES = new Set([
  'messaging/invalid-registration-token',
  'messaging/registration-token-not-registered',
]);
const MAX_TOKENS_PER_USER = 10;
const MAX_TOKENS_PER_FANOUT = 5000;

export async function notifyChurchMembers(
  churchId: string,
  title: string,
  body: string,
  data: Record<string, string> = {},
  targetRoles?: string[]
): Promise<void> {
  if (isFunctionsEmulatorTestMode()) {
    await db.collection('functionTestPushNotifications').add({
      churchId,
      title,
      body,
      data,
      targetRoles: targetRoles ?? ['member', 'admin', 'priest'],
      recordedAt: FieldValue.serverTimestamp(),
    });
    return;
  }

  let membersQuery: FirebaseFirestore.Query = db
    .collection('churches')
    .doc(churchId)
    .collection('members')
    .where('status', '==', 'active');

  if (targetRoles && targetRoles.length > 0) {
    membersQuery = membersQuery.where('role', 'in', targetRoles);
  }

  const membersSnap = await membersQuery.get();
  const uids = membersSnap.docs.map((d) => d.id);
  if (uids.length === 0) return;

  const allTokens: string[] = [];
  const tokenOwners = new Map<string, string>();
  const chunkSize = 500;

  for (let i = 0; i < uids.length; i += chunkSize) {
    const chunk = uids.slice(i, i + chunkSize);
    const usersSnap = await db.getAll(...chunk.map((uid) => db.collection('users').doc(uid)));
    for (const userDoc of usersSnap) {
      if (userDoc.exists) {
        const fcmTokens = Array.isArray(userDoc.data()?.fcmTokens) ? userDoc.data()?.fcmTokens : [];
        const cleanTokens = fcmTokens
          .filter((token: unknown): token is string => typeof token === 'string' && token.length > 0)
          .slice(-MAX_TOKENS_PER_USER);
        for (const token of cleanTokens) {
          allTokens.push(token);
          tokenOwners.set(token, userDoc.id);
          if (allTokens.length >= MAX_TOKENS_PER_FANOUT) {
            break;
          }
        }
        if (allTokens.length >= MAX_TOKENS_PER_FANOUT) {
          break;
        }
      }
    }
    if (allTokens.length >= MAX_TOKENS_PER_FANOUT) {
      console.warn('Notification fanout token cap reached', { churchId, cap: MAX_TOKENS_PER_FANOUT });
      break;
    }
  }

  const tokens = [...new Set(allTokens.filter(Boolean))];
  if (tokens.length === 0) return;

  const staleTokensByUser = new Map<string, string[]>();

  for (let i = 0; i < tokens.length; i += 500) {
    const batch = tokens.slice(i, i + 500);
    const response = await fcm.sendEachForMulticast({
      tokens: batch,
      notification: { title, body },
      data,
      android: { priority: 'high' },
      apns: { payload: { aps: { sound: 'default' } } },
    });

    response.responses.forEach((result, index) => {
      if (result.success || !result.error || !INVALID_FCM_ERROR_CODES.has(result.error.code)) {
        return;
      }

      const token = batch[index];
      const userId = tokenOwners.get(token);
      if (!userId) {
        return;
      }

      const userTokens = staleTokensByUser.get(userId) ?? [];
      userTokens.push(token);
      staleTokensByUser.set(userId, userTokens);
    });
  }

  if (staleTokensByUser.size === 0) {
    return;
  }

  const cleanupBatch = db.batch();
  for (const [userId, staleTokens] of staleTokensByUser) {
    cleanupBatch.update(db.collection('users').doc(userId), {
      fcmTokens: FieldValue.arrayRemove(...staleTokens),
    });
  }
  await cleanupBatch.commit();
}
