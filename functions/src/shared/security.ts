import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { CallableRequest, HttpsError } from 'firebase-functions/v2/https';
import { isFunctionsEmulatorTestMode } from './emulatorTest';
import { auth, db } from './firebase';
import { ChurchMembershipRecord, ChurchRole } from './types';

const RATE_LIMITS_COLLECTION = 'functionRateLimits';

function hydrateFunctionsEmulatorTestAuth(request: CallableRequest<unknown>): void {
  if (request.auth || !isFunctionsEmulatorTestMode()) {
    return;
  }

  const testAuth =
    typeof request.data === 'object' && request.data !== null
      ? (request.data as { __testAuth?: Record<string, unknown> }).__testAuth
      : undefined;

  const uid =
    request.rawRequest.header('x-kandilo-test-uid')?.trim()
    || (typeof testAuth?.uid === 'string' ? testAuth.uid.trim() : '');
  if (!uid) {
    return;
  }

  const email =
    request.rawRequest.header('x-kandilo-test-email')?.trim()
    || (typeof testAuth?.email === 'string' ? testAuth.email.trim() : undefined);
  const provider =
    request.rawRequest.header('x-kandilo-test-provider')?.trim()
    || (typeof testAuth?.provider === 'string' ? testAuth.provider.trim() : 'password');
  const superAdmin =
    request.rawRequest.header('x-kandilo-test-super-admin') === 'true'
    || testAuth?.superAdmin === true;
  const emailVerified =
    request.rawRequest.header('x-kandilo-test-email-verified') !== 'false'
    && testAuth?.emailVerified !== false;

  (request as CallableRequest<unknown> & { auth: NonNullable<CallableRequest<unknown>['auth']> }).auth = {
    uid,
    rawToken: 'kandilo-functions-emulator-test-token',
    token: {
      aud: process.env.GCLOUD_PROJECT ?? '',
      auth_time: 0,
      email,
      email_verified: emailVerified,
      exp: 0,
      firebase: {
        identities: email ? { email: [email] } : {},
        sign_in_provider: provider,
      },
      iat: 0,
      iss: '',
      sub: uid,
      uid,
      ...(superAdmin ? { superAdmin: true } : {}),
    },
  };
}

export const appCheckCallableOptions = isFunctionsEmulatorTestMode()
  ? ({
      invoker: 'public',
    } as const)
  : ({
      enforceAppCheck: true,
      invoker: 'public',
    } as const);

export const replayProtectedCallableOptions = isFunctionsEmulatorTestMode()
  ? ({
      invoker: 'public',
    } as const)
  : ({
      enforceAppCheck: true,
      consumeAppCheckToken: true,
      invoker: 'public',
    } as const);

export function assertFreshAppCheck(request: CallableRequest<unknown>): void {
  if (!request.app) {
    if (isFunctionsEmulatorTestMode()) {
      return;
    }

    throw new HttpsError('permission-denied', 'Valid app attestation is required.');
  }

  if (request.app.alreadyConsumed) {
    throw new HttpsError('permission-denied', 'This request was already used. Please retry.');
  }
}

export async function checkRateLimit(
  subjectId: string,
  fnName: string,
  maxPerWindow: number,
  windowMs = 60_000
): Promise<void> {
  const nowMs = Date.now();
  const resetAt = Timestamp.fromMillis(nowMs + windowMs);
  const rateLimitRef = db.collection(RATE_LIMITS_COLLECTION).doc(`${fnName}:${subjectId}`);

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(rateLimitRef);
    const currentResetAt = snap.data()?.resetAt;
    const currentCount = typeof snap.data()?.count === 'number' ? snap.data()!.count : 0;
    const windowExpired =
      !(currentResetAt instanceof Timestamp) || currentResetAt.toMillis() <= nowMs;

    if (!snap.exists || windowExpired) {
      tx.set(rateLimitRef, {
        count: 1,
        fnName,
        subjectId,
        resetAt,
        expiresAt: resetAt,
        updatedAt: FieldValue.serverTimestamp(),
      });
      return;
    }

    if (currentCount >= maxPerWindow) {
      throw new HttpsError('resource-exhausted', 'Rate limit exceeded. Please try again shortly.');
    }

    tx.update(rateLimitRef, {
      count: currentCount + 1,
      expiresAt: currentResetAt,
      updatedAt: FieldValue.serverTimestamp(),
    });
  });
}

export function assertVerifiedNonAnonymousUser(
  request: CallableRequest<unknown>,
  errorMessage = 'A verified, non-anonymous account is required.'
): void {
  hydrateFunctionsEmulatorTestAuth(request);

  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Must be signed in.');
  }

  const signInProvider = request.auth.token.firebase?.sign_in_provider;
  if (signInProvider === 'anonymous') {
    throw new HttpsError('permission-denied', errorMessage);
  }

  if (request.auth.token.email_verified !== true) {
    throw new HttpsError('failed-precondition', 'Please verify your email address first.');
  }
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function assertActiveChurchRole(
  churchId: string,
  uid: string,
  allowedRoles: ChurchRole[],
  errorMessage: string
): Promise<ChurchMembershipRecord> {
  const membershipSnap = await db
    .collection('churches')
    .doc(churchId)
    .collection('members')
    .doc(uid)
    .get();

  const membership = membershipSnap.data() as ChurchMembershipRecord | undefined;
  const role = membership?.role;

  if (!membershipSnap.exists || membership?.status !== 'active' || !role || !allowedRoles.includes(role as ChurchRole)) {
    throw new HttpsError('permission-denied', errorMessage);
  }

  return membership;
}

export async function assertActiveChurch(churchId: string): Promise<FirebaseFirestore.DocumentData> {
  const churchSnap = await db.collection('churches').doc(churchId).get();
  if (!churchSnap.exists) {
    throw new HttpsError('not-found', 'Church not found.');
  }

  const church = churchSnap.data() ?? {};
  if (church.isActive === false) {
    throw new HttpsError('failed-precondition', 'This church is not currently active.');
  }

  return church;
}

export async function getPrimaryEmailsForUids(uids: string[]): Promise<string[]> {
  const uniqueUids = [...new Set(uids.filter(Boolean))];
  const emails = new Set<string>();

  for (let i = 0; i < uniqueUids.length; i += 100) {
    const chunk = uniqueUids.slice(i, i + 100);
    const result = await auth.getUsers(chunk.map((uid) => ({ uid })));
    for (const user of result.users) {
      if (user.email) {
        emails.add(normalizeEmail(user.email));
      }
    }
  }

  return [...emails];
}

export function assertSuperAdmin(request: CallableRequest<unknown>): void {
  hydrateFunctionsEmulatorTestAuth(request);

  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Must be signed in.');
  }
  const signInProvider = request.auth.token.firebase?.sign_in_provider;
  if (signInProvider === 'anonymous' || request.auth.token.email_verified !== true) {
    throw new HttpsError('permission-denied', 'A verified, non-anonymous account is required.');
  }
  if (request.auth.token['superAdmin'] !== true) {
    throw new HttpsError('permission-denied', 'Super admin access required.');
  }
}
