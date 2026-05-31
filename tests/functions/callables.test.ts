import { createHash } from 'node:crypto';
import { initializeApp as initializeAdminApp, deleteApp as deleteAdminApp, getApps } from 'firebase-admin/app';
import { getAuth as getAdminAuth } from 'firebase-admin/auth';
import { FieldValue, Timestamp, getFirestore } from 'firebase-admin/firestore';
import { getStorage as getAdminStorage } from 'firebase-admin/storage';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { TAX_RECEIPT_PDF_TEMPLATE_VERSION } from '../../functions/src/shared/taxReceiptPdf';

const PROJECT_ID = 'kandilo-2f7a9';
const STORAGE_BUCKETS = [`${PROJECT_ID}.firebasestorage.app`, `${PROJECT_ID}.appspot.com`];
const CHURCH_ID = 'church-1';
const AUTH_EMULATOR_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST ?? '127.0.0.1:9098';
const FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8088';
const FUNCTIONS_EMULATOR_ORIGIN = 'http://127.0.0.1:5008';
const PASSWORD = 'Password123!';
const CLOSED_ANNUAL_YEAR = Math.max(2000, new Date().getUTCFullYear() - 2);
const OPEN_ANNUAL_YEAR = new Date().getUTCFullYear() + 1;
const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const SUPER_ADMIN_AUTH: TestAuthHeaders = {
  uid: 'priest-1',
  email: 'priest@example.com',
  superAdmin: true,
};

function expectedReceiptNumber(year: number, sequence: number): string {
  return `STN-${year}-${String(sequence).padStart(6, '0')}`;
}

function annualTaxReceiptDocId(churchId: string, userId: string, year: number): string {
  const digest = createHash('sha256')
    .update(`${churchId}:${userId}:${year}`)
    .digest('base64url')
    .slice(0, 32);
  return `annual_${digest}`;
}

function correctedAnnualTaxReceiptDocId(
  churchId: string,
  userId: string,
  year: number,
  correctionDigestInput: string
): string {
  const digest = createHash('sha256')
    .update(`${churchId}:${userId}:${year}:annual-partial-refund:${correctionDigestInput}`)
    .digest('base64url')
    .slice(0, 32);
  return `annual_correction_${digest}`;
}

function reissuedAnnualTaxReceiptDocId(
  churchId: string,
  userId: string,
  year: number,
  reissueDigestInput: string
): string {
  const digest = createHash('sha256')
    .update(`${churchId}:${userId}:${year}:annual-reissue:${reissueDigestInput}`)
    .digest('base64url')
    .slice(0, 32);
  return `annual_reissue_${digest}`;
}

async function seedRetainedPdfStorageObject(
  storagePath: string,
  sha256: string,
  byteLength: number
): Promise<void> {
  const content = Buffer.alloc(byteLength, 0x25);
  await Promise.all(STORAGE_BUCKETS.map((bucketName) =>
    adminStorage.bucket(bucketName).file(storagePath).save(content, {
      resumable: false,
      metadata: {
        cacheControl: 'private, no-store, max-age=0',
        contentType: 'application/pdf',
        metadata: {
          pdfSha256: sha256,
          retentionPurpose: 'official_tax_receipt_copy',
        },
      },
    })
  ));
}

const adminApp = getApps()[0] ?? initializeAdminApp({ projectId: PROJECT_ID });
const adminAuth = getAdminAuth(adminApp);
const adminDb = getFirestore(adminApp);
const adminStorage = getAdminStorage(adminApp);

type CallableStatus =
  | 'ok'
  | 'invalid-argument'
  | 'failed-precondition'
  | 'out-of-range'
  | 'unauthenticated'
  | 'permission-denied'
  | 'not-found'
  | 'aborted'
  | 'already-exists'
  | 'resource-exhausted'
  | 'cancelled'
  | 'data-loss'
  | 'unknown'
  | 'internal'
  | 'unavailable'
  | 'deadline-exceeded';

interface TestAuthHeaders {
  uid: string;
  email: string;
  emailVerified?: boolean;
  provider?: string;
  superAdmin?: boolean;
}

class CallableTestError extends Error {
  constructor(
    readonly status: string,
    message: string,
    readonly body: unknown
  ) {
    super(message);
  }
}

async function callCallable<Req, Res>(
  name: string,
  data: Req,
  auth?: TestAuthHeaders
): Promise<Res> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
  };

  if (auth) {
    headers['x-kandilo-test-uid'] = auth.uid;
    headers['x-kandilo-test-email'] = auth.email;
    headers['x-kandilo-test-email-verified'] = String(auth.emailVerified ?? true);
    headers['x-kandilo-test-provider'] = auth.provider ?? 'password';
    headers['x-kandilo-test-super-admin'] = String(auth.superAdmin ?? false);
  }

  const response = await fetch(
    `${FUNCTIONS_EMULATOR_ORIGIN}/${PROJECT_ID}/us-central1/${name}`,
    {
      method: 'POST',
      headers,
      body: JSON.stringify({
        data:
          auth && typeof data === 'object' && data !== null && !Array.isArray(data)
            ? { ...data, __testAuth: auth }
            : data,
      }),
    }
  );
  const body = await response.json() as {
    result?: Res;
    error?: { status?: string; message?: string };
  };

  if (!response.ok || body.error) {
    throw new CallableTestError(
      body.error?.status ?? `HTTP_${response.status}`,
      body.error?.message ?? 'Callable failed.',
      body
    );
  }

  return body.result as Res;
}

async function expectCallableFails(
  promise: Promise<unknown>,
  status: CallableStatus
): Promise<void> {
  await expect(promise).rejects.toMatchObject({ status: status.toUpperCase().replaceAll('-', '_') });
}

async function waitFor<T>(
  read: () => Promise<T>,
  predicate: (value: T) => boolean,
  label: string,
  timeoutMs = 10_000
): Promise<T> {
  const startedAt = Date.now();
  let lastValue: T | undefined;

  while (Date.now() - startedAt < timeoutMs) {
    lastValue = await read();
    if (predicate(lastValue)) {
      return lastValue;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new Error(`Timed out waiting for ${label}. Last value: ${JSON.stringify(lastValue)}`);
}

async function postFunction(
  name: string,
  body: unknown,
  headers: Record<string, string> = {}
): Promise<{ status: number; body: unknown }> {
  const response = await fetch(`${FUNCTIONS_EMULATOR_ORIGIN}/${PROJECT_ID}/us-central1/${name}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...headers,
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  const parsedBody = text ? JSON.parse(text) as unknown : null;
  return { status: response.status, body: parsedBody };
}

async function clearEmulators(): Promise<void> {
  await Promise.all([
    fetch(
      `http://${FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`,
      { method: 'DELETE' }
    ),
    fetch(`http://${AUTH_EMULATOR_HOST}/emulator/v1/projects/${PROJECT_ID}/accounts`, {
      method: 'DELETE',
    }),
  ]);
}

async function createVerifiedUser(uid: string, email: string, displayName = uid): Promise<void> {
  await adminAuth.createUser({
    uid,
    email,
    emailVerified: true,
    password: PASSWORD,
    displayName,
  });
}

function testTaxReceiptAddress() {
  return {
    line1: '10 Donor Street',
    line2: '',
    city: 'Chicago',
    region: 'IL',
    postalCode: '60601',
    country: 'US',
  };
}

async function seedUserProfile(uid: string, email: string, displayName: string, taxReceiptLegalName = displayName) {
  await adminDb.doc(`users/${uid}`).set({
    email,
    displayName,
    photoURL: null,
    preferredLanguage: 'English',
    phone: '',
    ministries: [],
    description: '',
    showInDirectory: false,
    taxReceiptLegalName,
    taxReceiptAddress: testTaxReceiptAddress(),
    fcmTokens: [],
    createdAt: FieldValue.serverTimestamp(),
  }, { merge: true });
}

function churchData() {
  return {
    name: 'St. Nicholas',
    city: 'Chicago',
    state: 'IL',
    location: 'Chicago, IL',
    imageURL: 'https://example.com/church.jpg',
    isActive: true,
    isVerified: true,
  };
}

function createChurchPayload() {
  return {
    name: 'Holy Trinity Orthodox Church',
    denomination: 'Eastern Orthodox',
    jurisdiction: 'Orthodox Church in America',
    diocese: 'Diocese of the Midwest',
    foundedYear: 1995,
    about: 'A parish community.',
    languages: ['English', 'Serbian'],
    address: '123 Main Street',
    city: 'Milwaukee',
    state: 'WI',
    country: 'US',
    postalCode: '53202',
    latitude: 43.0389,
    longitude: -87.9065,
    timezone: 'America/Chicago',
    phone: '+1 555 0100',
    contactEmail: 'office@example.com',
    website: 'https://example.com',
    imageURL: 'https://example.com/image.jpg',
    coverImageURL: 'https://example.com/cover.jpg',
  };
}

function rateLimitDocPath(fnName: string, subjectId: string): string {
  return `functionRateLimits/${encodeURIComponent(fnName)}:${encodeURIComponent(subjectId)}`;
}

function memberData(uid: string, email: string, role: 'priest' | 'treasurer' | 'admin' | 'member') {
  return {
    userId: uid,
    churchId: CHURCH_ID,
    role,
    status: 'active',
    displayName: uid,
    email,
    photoURL: '',
    joinedAt: FieldValue.serverTimestamp(),
    showInDirectory: true,
  };
}

async function seedChurchMember(
  uid: string,
  email: string,
  role: 'priest' | 'treasurer' | 'admin' | 'member'
): Promise<void> {
  const batch = adminDb.batch();
  batch.set(adminDb.doc(`churches/${CHURCH_ID}/members/${uid}`), memberData(uid, email, role));
  batch.set(adminDb.doc(`users/${uid}/churchMemberships/${CHURCH_ID}`), {
    churchId: CHURCH_ID,
    churchName: 'St. Nicholas',
    location: 'Chicago, IL',
    imageURL: 'https://example.com/church.jpg',
    role,
    status: 'active',
    joinedAt: FieldValue.serverTimestamp(),
  });
  await batch.commit();
}

async function seedSelfJoinMembership(
  uid: string,
  email: string,
  churchId: string,
  churchName: string
): Promise<void> {
  const batch = adminDb.batch();
  batch.set(adminDb.doc(`churches/${churchId}`), {
    ...churchData(),
    name: churchName,
  });
  batch.set(adminDb.doc(`churches/${churchId}/members/${uid}`), {
    userId: uid,
    churchId,
    role: 'member',
    status: 'active',
    displayName: uid,
    email,
    photoURL: '',
    joinedAt: FieldValue.serverTimestamp(),
    showInDirectory: true,
  });
  batch.set(adminDb.doc(`users/${uid}/churchMemberships/${churchId}`), {
    churchId,
    churchName,
    location: 'Chicago, IL',
    imageURL: 'https://example.com/church.jpg',
    role: 'member',
    status: 'active',
    joinedAt: FieldValue.serverTimestamp(),
  });
  await batch.commit();
}

async function setDocsInBatches(entries: Array<{ path: string; data: Record<string, unknown> }>): Promise<void> {
  for (let index = 0; index < entries.length; index += 400) {
    const batch = adminDb.batch();
    for (const entry of entries.slice(index, index + 400)) {
      batch.set(adminDb.doc(entry.path), entry.data);
    }
    await batch.commit();
  }
}

async function seedBaseData(): Promise<void> {
  await Promise.all([
    createVerifiedUser('priest-1', 'priest@example.com', 'Priest One'),
    createVerifiedUser('treasurer-1', 'treasurer@example.com', 'Treasurer One'),
    createVerifiedUser('admin-1', 'admin@example.com', 'Admin One'),
    createVerifiedUser('member-1', 'member@example.com', 'Member One'),
    createVerifiedUser('invitee-1', 'invitee@example.com', 'Invitee One'),
    createVerifiedUser('other-1', 'other@example.com', 'Other One'),
  ]);
  await Promise.all([
    seedUserProfile('priest-1', 'priest@example.com', 'Priest One'),
    seedUserProfile('treasurer-1', 'treasurer@example.com', 'Treasurer One'),
    seedUserProfile('admin-1', 'admin@example.com', 'Admin One'),
    seedUserProfile('member-1', 'member@example.com', 'Member One'),
    seedUserProfile('invitee-1', 'invitee@example.com', 'Invitee One'),
    seedUserProfile('other-1', 'other@example.com', 'Other One'),
  ]);

  await adminDb.doc(`churches/${CHURCH_ID}`).set(churchData());
  await Promise.all([
    seedChurchMember('priest-1', 'priest@example.com', 'priest'),
    seedChurchMember('treasurer-1', 'treasurer@example.com', 'treasurer'),
    seedChurchMember('admin-1', 'admin@example.com', 'admin'),
    seedChurchMember('member-1', 'member@example.com', 'member'),
  ]);
}

beforeAll(() => {
  process.env.GCLOUD_PROJECT = PROJECT_ID;
});

beforeEach(async () => {
  await clearEmulators();
  await seedBaseData();
});

afterAll(async () => {
  await deleteAdminApp(adminApp);
});

describe('Cloud Functions emulator', () => {
  it('accepts a pending invitation for the matching verified user', async () => {
    await adminDb.doc(`churches/${CHURCH_ID}`).update({
      location: FieldValue.delete(),
    });

    await adminDb.doc('invitations/invite-1').set({
      churchId: CHURCH_ID,
      churchName: 'St. Nicholas',
      invitedBy: 'admin-1',
      invitedByName: 'Admin One',
      inviteeEmail: 'invitee@example.com',
      role: 'member',
      status: 'pending',
      createdAt: FieldValue.serverTimestamp(),
      expiresAt: Timestamp.fromDate(new Date('2099-05-31T12:00:00Z')),
    });

    await expect(
      callCallable<{ invitationId: string }, { success: boolean }>(
        'acceptInvitation',
        { invitationId: 'invite-1' },
        { uid: 'invitee-1', email: 'invitee@example.com' }
      )
    ).resolves.toEqual({ success: true });

    const [memberSnap, fanoutSnap, inviteSnap] = await Promise.all([
      adminDb.doc(`churches/${CHURCH_ID}/members/invitee-1`).get(),
      adminDb.doc(`users/invitee-1/churchMemberships/${CHURCH_ID}`).get(),
      adminDb.doc('invitations/invite-1').get(),
    ]);

    expect(memberSnap.data()).toMatchObject({
      churchId: CHURCH_ID,
      role: 'member',
      status: 'active',
      email: 'invitee@example.com',
    });
    expect(fanoutSnap.data()).toMatchObject({
      churchId: CHURCH_ID,
      location: 'Chicago, IL',
      role: 'member',
      status: 'active',
    });
    expect(inviteSnap.data()?.status).toBe('accepted');
  });

  it('rejects invitation acceptance from a different email address', async () => {
    await adminDb.doc('invitations/invite-1').set({
      churchId: CHURCH_ID,
      churchName: 'St. Nicholas',
      invitedBy: 'admin-1',
      invitedByName: 'Admin One',
      inviteeEmail: 'invitee@example.com',
      role: 'member',
      status: 'pending',
      createdAt: FieldValue.serverTimestamp(),
      expiresAt: Timestamp.fromDate(new Date('2099-05-31T12:00:00Z')),
    });

    await expectCallableFails(
      callCallable('acceptInvitation', { invitationId: 'invite-1' }, {
        uid: 'other-1',
        email: 'other@example.com',
      }),
      'permission-denied'
    );
  });

  it('lets parish users self-join active churches and enforces the three-church abuse cap', async () => {
    await adminDb.doc('churches/church-2').set({
      ...churchData(),
      name: 'St. Sava',
      city: 'Phoenix',
      state: 'AZ',
      location: 'Phoenix, AZ',
      imageURL: 'https://example.com/st-sava.jpg',
    });

    await expect(
      callCallable<{ churchId: string }, { success: boolean; alreadyMember?: boolean }>(
        'joinChurch',
        { churchId: 'church-2' },
        { uid: 'other-1', email: 'other@example.com' }
      )
    ).resolves.toEqual({ success: true });

    const [memberSnap, fanoutSnap] = await Promise.all([
      adminDb.doc('churches/church-2/members/other-1').get(),
      adminDb.doc('users/other-1/churchMemberships/church-2').get(),
    ]);
    expect(memberSnap.data()).toMatchObject({
      userId: 'other-1',
      churchId: 'church-2',
      role: 'member',
      status: 'active',
      email: 'other@example.com',
    });
    expect(fanoutSnap.data()).toMatchObject({
      churchId: 'church-2',
      churchName: 'St. Sava',
      location: 'Phoenix, AZ',
      role: 'member',
      status: 'active',
    });

    await expect(
      callCallable<{ churchId: string }, { success: boolean; alreadyMember?: boolean }>(
        'joinChurch',
        { churchId: 'church-2' },
        { uid: 'other-1', email: 'other@example.com' }
      )
    ).resolves.toEqual({ success: true, alreadyMember: true });

    await Promise.all([
      seedSelfJoinMembership('invitee-1', 'invitee@example.com', 'limit-1', 'Limit One'),
      seedSelfJoinMembership('invitee-1', 'invitee@example.com', 'limit-2', 'Limit Two'),
      seedSelfJoinMembership('invitee-1', 'invitee@example.com', 'limit-3', 'Limit Three'),
      adminDb.doc('churches/limit-4').set({
        ...churchData(),
        name: 'Limit Four',
      }),
    ]);

    await expectCallableFails(
      callCallable('joinChurch', { churchId: 'limit-4' }, {
        uid: 'invitee-1',
        email: 'invitee@example.com',
      }),
      'resource-exhausted'
    );

    await adminDb.doc('churches/church-missing-active-flag').set({
      name: 'Missing Active Flag',
      city: 'Chicago',
      state: 'IL',
      location: 'Chicago, IL',
      imageURL: 'https://example.com/church.jpg',
      isVerified: true,
    });

    await expectCallableFails(
      callCallable('joinChurch', { churchId: 'church-missing-active-flag' }, {
        uid: 'member-1',
        email: 'member@example.com',
      }),
      'failed-precondition'
    );
  });

  it('rejects malformed callable payloads before side effects', async () => {
    await expectCallableFails(
      callCallable('joinChurch', null, {
        uid: 'member-1',
        email: 'member@example.com',
      }),
      'invalid-argument'
    );
    await expectCallableFails(
      callCallable('createStripeCheckoutSession', null, {
        uid: 'member-1',
        email: 'member@example.com',
      }),
      'invalid-argument'
    );
    await expectCallableFails(
      callCallable('sendPushNotification', null, {
        uid: 'admin-1',
        email: 'admin@example.com',
      }),
      'invalid-argument'
    );
    await expectCallableFails(
      callCallable('setChurchActiveState', null, SUPER_ADMIN_AUTH),
      'invalid-argument'
    );
  });

  it('sends branded auth action emails and avoids password-reset account enumeration', async () => {
    await adminAuth.createUser({
      uid: 'unverified-1',
      email: 'unverified@example.com',
      emailVerified: false,
      password: PASSWORD,
      displayName: 'Unverified One',
    });

    await expect(
      callCallable(
        'sendEmailVerificationEmail',
        {},
        { uid: 'unverified-1', email: 'unverified@example.com', emailVerified: false }
      )
    ).resolves.toMatchObject({
      success: true,
      emailSent: true,
    });

    await expect(
      callCallable(
        'sendEmailVerificationEmail',
        {},
        { uid: 'member-1', email: 'member@example.com' }
      )
    ).resolves.toMatchObject({
      success: true,
      emailSent: false,
      alreadyVerified: true,
    });

    await expect(
      callCallable('sendPasswordResetEmail', { email: 'member@example.com' })
    ).resolves.toMatchObject({
      success: true,
      emailSent: true,
    });

    await expect(
      callCallable('sendPasswordResetEmail', { email: 'missing@example.com' })
    ).resolves.toMatchObject({
      success: true,
      emailSent: true,
    });
    await expect(
      callCallable('sendPasswordResetEmail', { email: 'slash/user@example.com' })
    ).resolves.toMatchObject({
      success: true,
      emailSent: true,
    });
  });

  it('sends member invitations from admins and blocks elevated invitations unless caller is priest', async () => {
    const invitationChurchLimitRef = adminDb.doc(rateLimitDocPath('sendInvitationByChurch', CHURCH_ID));

    await expectCallableFails(
      callCallable(
        'sendInvitation',
        {
          churchId: CHURCH_ID,
          inviteeEmail: 'blocked@example.com',
          role: 'member',
        },
        { uid: 'member-1', email: 'member@example.com' }
      ),
      'permission-denied'
    );
    expect((await invitationChurchLimitRef.get()).exists).toBe(false);

    const result = await callCallable<
      { churchId: string; inviteeEmail: string; role?: 'member' | 'admin' | 'treasurer' },
      { success: boolean; invitationId: string; inviteUrl: string; emailSent: boolean }
    >(
      'sendInvitation',
      {
        churchId: CHURCH_ID,
        inviteeEmail: ' NewMember@Example.COM ',
        role: 'member',
      },
      { uid: 'admin-1', email: 'admin@example.com' }
    );

    expect(result).toMatchObject({
      success: true,
      emailSent: true,
    });
    expect(result.inviteUrl).toContain(`/join/${result.invitationId}`);

    const inviteSnap = await adminDb.doc(`invitations/${result.invitationId}`).get();
    expect(inviteSnap.data()).toMatchObject({
      churchId: CHURCH_ID,
      inviteeEmail: 'newmember@example.com',
      role: 'member',
      status: 'pending',
      emailDeliveryStatus: 'sent',
      emailProviderId: 'mock-resend-email-id',
    });
    expect((await invitationChurchLimitRef.get()).data()?.count).toBe(1);

    await expectCallableFails(
      callCallable(
        'sendInvitation',
        {
          churchId: CHURCH_ID,
          inviteeEmail: 'newadmin@example.com',
          role: 'admin',
        },
        { uid: 'admin-1', email: 'admin@example.com' }
      ),
      'permission-denied'
    );
    expect((await invitationChurchLimitRef.get()).data()?.count).toBe(1);

    await expectCallableFails(
      callCallable(
        'sendInvitation',
        {
          churchId: CHURCH_ID,
          inviteeEmail: 'newtreasurer@example.com',
          role: 'treasurer',
        },
        { uid: 'admin-1', email: 'admin@example.com' }
      ),
      'permission-denied'
    );
    expect((await invitationChurchLimitRef.get()).data()?.count).toBe(1);

    await expect(
      callCallable(
        'sendInvitation',
        {
          churchId: CHURCH_ID,
          inviteeEmail: 'newadmin@example.com',
          role: 'admin',
        },
        { uid: 'priest-1', email: 'priest@example.com' }
      )
    ).resolves.toMatchObject({
      success: true,
      emailSent: true,
    });

    await expect(
      callCallable(
        'sendInvitation',
        {
          churchId: CHURCH_ID,
          inviteeEmail: 'newtreasurer@example.com',
          role: 'treasurer',
        },
        { uid: 'priest-1', email: 'priest@example.com' }
      )
    ).resolves.toMatchObject({
      success: true,
      emailSent: true,
    });
  });

  it('creates hosted Stripe checkout sessions only for active members', async () => {
    await expectCallableFails(
      callCallable(
        'createStripePaymentIntent',
        {
          churchId: CHURCH_ID,
          amountCents: 5000,
          purpose: 'Legacy PaymentIntent attempt',
        },
        { uid: 'member-1', email: 'member@example.com' }
      ),
      'failed-precondition'
    );
    expect((await adminDb.collection('giving').count().get()).data().count).toBe(0);

    const memberResult = await callCallable<
      { churchId: string; amountCents: number; purpose?: string; anonymous?: boolean },
      { checkoutUrl: string; givingId: string; sessionId: string }
    >(
      'createStripeCheckoutSession',
      {
        churchId: CHURCH_ID,
        amountCents: 5000,
        purpose: 'General Fund',
        anonymous: false,
      },
      { uid: 'member-1', email: 'member@example.com' }
    );

    expect(memberResult).toMatchObject({
      checkoutUrl: 'https://checkout.stripe.com/c/pay/cs_test_kandilo_mock',
      sessionId: 'cs_test_kandilo_mock',
    });

    const givingSnap = await adminDb.doc(`giving/${memberResult.givingId}`).get();
    expect(givingSnap.data()).toMatchObject({
      churchId: CHURCH_ID,
      userId: 'member-1',
      donorRole: 'member',
      donorName: 'Parishioner',
      donorEmail: '',
      donorNamePublicSafe: true,
      receiptManagerGivingSafeVersion: 1,
      churchReceiptVisible: true,
      amountCents: 5000,
      currency: 'USD',
      status: 'pending',
    });
    expect(givingSnap.data()?.donorName).not.toContain('@');
    expect(givingSnap.data()).not.toHaveProperty('stripeCheckoutSessionId');
    expect(givingSnap.data()).not.toHaveProperty('stripeCheckoutSessionExpiresAt');
    expect(JSON.stringify(givingSnap.data())).not.toContain('cs_test_kandilo_mock');
    const paymentMetadataSnap = await adminDb.doc(`givingPaymentMetadata/${memberResult.givingId}`).get();
    expect(paymentMetadataSnap.data()).toMatchObject({
      churchId: CHURCH_ID,
      userId: 'member-1',
      amountCents: 5000,
      currency: 'USD',
      stripeCheckoutSessionId: 'cs_test_kandilo_mock',
    });

    const treasurerResult = await callCallable<
      { churchId: string; amountCents: number; purpose?: string; anonymous?: boolean },
      { checkoutUrl: string; givingId: string; sessionId: string }
    >(
      'createStripeCheckoutSession',
      {
        churchId: CHURCH_ID,
        amountCents: 2500,
        purpose: 'Candles',
        anonymous: true,
      },
      { uid: 'treasurer-1', email: 'treasurer@example.com' }
    );
    const treasurerGivingSnap = await adminDb.doc(`giving/${treasurerResult.givingId}`).get();
    expect(treasurerGivingSnap.data()).toMatchObject({
      churchId: CHURCH_ID,
      userId: 'treasurer-1',
      donorRole: 'treasurer',
      donorName: 'Anonymous donor',
      donorEmail: '',
      donorNamePublicSafe: false,
      churchReceiptVisible: false,
      amountCents: 2500,
      anonymous: true,
      status: 'pending',
    });

    await adminDb.doc(`churches/${CHURCH_ID}`).update({
      country: 'CA',
      city: 'Edmonton',
      state: 'AB',
      timezone: 'America/Edmonton',
    });
    const canadianResult = await callCallable<
      { churchId: string; amountCents: number; currency?: string; purpose?: string },
      { checkoutUrl: string; givingId: string; sessionId: string }
    >(
      'createStripeCheckoutSession',
      {
        churchId: CHURCH_ID,
        amountCents: 7500,
        currency: 'CAD',
        purpose: 'General Fund',
      },
      { uid: 'member-1', email: 'member@example.com' }
    );
    const canadianGivingSnap = await adminDb.doc(`giving/${canadianResult.givingId}`).get();
    expect(canadianGivingSnap.data()).toMatchObject({
      churchId: CHURCH_ID,
      amountCents: 7500,
      currency: 'CAD',
      status: 'pending',
    });

    await expectCallableFails(
      callCallable(
        'createStripeCheckoutSession',
        {
          churchId: CHURCH_ID,
          amountCents: 7500,
          currency: 'USD',
        },
        { uid: 'member-1', email: 'member@example.com' }
      ),
      'invalid-argument'
    );

    await expectCallableFails(
      callCallable(
        'createStripeCheckoutSession',
        {
          churchId: CHURCH_ID,
          amountCents: 5000,
        },
        { uid: 'other-1', email: 'other@example.com' }
      ),
      'permission-denied'
    );
  });

  it('requires verified email before creating hosted Stripe checkout sessions', async () => {
    await expectCallableFails(
      callCallable(
        'createStripeCheckoutSession',
        { churchId: CHURCH_ID, amountCents: 5000, purpose: 'General Fund' },
        { uid: 'member-1', email: 'member@example.com', emailVerified: false }
      ),
      'failed-precondition'
    );

    expect((await adminDb.collection('giving').count().get()).data().count).toBe(0);
    expect((await adminDb.collection('givingPaymentMetadata').count().get()).data().count).toBe(0);
  });

  it('requires donor receipt profile before creating Checkout when tax receipts are ready', async () => {
    await adminDb.doc(`churches/${CHURCH_ID}`).update({
      taxReceiptSettings: {
        enabled: true,
        eligibilityConfirmed: true,
        jurisdiction: 'US',
        organizationName: 'St. Nicholas Orthodox Church',
        organizationAddress: '123 Church Street, Chicago, IL',
        taxId: '12-3456789',
        receiptPrefix: 'STN',
        goodsServicesStatement:
          'No goods or services were provided in exchange for this contribution other than intangible religious benefits.',
        autoIssue: true,
      },
    });
    await adminDb.doc('users/member-1').set({
      taxReceiptLegalName: '',
      taxReceiptAddress: {
        line1: '',
        line2: '',
        city: '',
        region: '',
        postalCode: '',
        country: '',
      },
    }, { merge: true });

    await expect(
      callCallable(
        'createStripeCheckoutSession',
        {
          churchId: CHURCH_ID,
          amountCents: 5000,
          purpose: 'General Fund',
        },
        { uid: 'member-1', email: 'member@example.com' }
      )
    ).rejects.toMatchObject({
      status: 'FAILED_PRECONDITION',
      body: {
        error: {
          details: {
            errorCode: 'tax_receipt_donor_profile_incomplete',
          },
        },
      },
    });

    expect((await adminDb.collection('giving').count().get()).data().count).toBe(0);
    expect((await adminDb.collection('givingPaymentMetadata').count().get()).data().count).toBe(0);
  });

  it('routes Checkout donations to backend-only Stripe Connect destination accounts when enabled', async () => {
    await adminDb.doc(`churchPaymentSettings/${CHURCH_ID}`).set({
      stripeConnectEnabled: true,
      stripeConnectAccountId: 'acct_Kandilo123',
      updatedBy: 'priest-1',
      updatedAt: FieldValue.serverTimestamp(),
    });

    const result = await callCallable<
      { churchId: string; amountCents: number; purpose?: string; anonymous?: boolean },
      { checkoutUrl: string; givingId: string; sessionId: string }
    >(
      'createStripeCheckoutSession',
      {
        churchId: CHURCH_ID,
        amountCents: 5000,
        purpose: 'General Fund',
        anonymous: false,
      },
      { uid: 'member-1', email: 'member@example.com' }
    );

    expect(result).toMatchObject({
      checkoutUrl: 'https://checkout.stripe.com/c/pay/cs_test_kandilo_connect_mock',
      sessionId: 'cs_test_kandilo_connect_mock',
    });

    const givingSnap = await adminDb.doc(`giving/${result.givingId}`).get();
    expect(givingSnap.data()).toMatchObject({
      churchId: CHURCH_ID,
      userId: 'member-1',
      status: 'pending',
      stripeSettlement: 'connected_account',
      stripeConnectTransferConfigured: true,
    });
    expect(givingSnap.data()).not.toHaveProperty('stripeCheckoutSessionId');
    expect(JSON.stringify(givingSnap.data())).not.toContain('acct_Kandilo123');
    expect(JSON.stringify(givingSnap.data())).not.toContain('cs_test_kandilo_connect_mock');
    expect((await adminDb.doc(`givingPaymentMetadata/${result.givingId}`).get()).data()).toMatchObject({
      churchId: CHURCH_ID,
      userId: 'member-1',
      amountCents: 5000,
      currency: 'USD',
      stripeCheckoutSessionId: 'cs_test_kandilo_connect_mock',
      stripeSettlement: 'connected_account',
      stripeConnectTransferConfigured: true,
    });
  });

  it('refuses Checkout routing when a configured v2 Stripe Connect account is not ready', async () => {
    await adminDb.doc(`churchPaymentSettings/${CHURCH_ID}`).set({
      stripeConnectEnabled: true,
      stripeConnectAccountId: 'acct_KandiloV2CurrentlyDue',
      stripeConnectAccountApi: 'v2',
      updatedBy: 'super-admin',
      updatedAt: FieldValue.serverTimestamp(),
    });

    await expectCallableFails(
      callCallable(
        'createStripeCheckoutSession',
        {
          churchId: CHURCH_ID,
          amountCents: 5000,
          purpose: 'General Fund',
        },
        { uid: 'member-1', email: 'member@example.com' }
      ),
      'failed-precondition'
    );

    expect((await adminDb.collection('giving').get()).empty).toBe(true);
    expect((await adminDb.collection('givingPaymentMetadata').get()).empty).toBe(true);
  });

  it('keeps private church payment settings SuperAdmin-callable-only', async () => {
    await expectCallableFails(
      callCallable(
        'getChurchPaymentSettings',
        { churchId: CHURCH_ID },
        { uid: 'admin-1', email: 'admin@example.com' }
      ),
      'permission-denied'
    );
    await expectCallableFails(
      callCallable(
        'updateChurchPaymentSettingsAsSuperAdmin',
        {
          churchId: CHURCH_ID,
          settings: { stripeConnectEnabled: true, stripeConnectAccountId: 'not_an_account' },
        },
        SUPER_ADMIN_AUTH
      ),
      'invalid-argument'
    );

    await expectCallableFails(
      callCallable(
        'updateChurchPaymentSettingsAsSuperAdmin',
        {
          churchId: CHURCH_ID,
          settings: { stripeConnectEnabled: true, stripeConnectAccountId: 'acct_KandiloFail' },
        },
        SUPER_ADMIN_AUTH
      ),
      'failed-precondition'
    );

    await adminDb.doc(`churchPaymentSettings/${CHURCH_ID}`).set({
      stripeConnectEnabled: false,
      stripeConnectAccountId: 'acct_KandiloV2PendingTransfers',
      stripeConnectAccountApi: 'v2',
      updatedBy: 'super-admin',
      updatedAt: FieldValue.serverTimestamp(),
    });
    await expectCallableFails(
      callCallable(
        'updateChurchPaymentSettingsAsSuperAdmin',
        {
          churchId: CHURCH_ID,
          settings: {
            stripeConnectEnabled: true,
            stripeConnectAccountId: 'acct_KandiloV2PendingTransfers',
          },
        },
        SUPER_ADMIN_AUTH
      ),
      'failed-precondition'
    );
    expect((await adminDb.doc(`churchPaymentSettings/${CHURCH_ID}`).get()).data()).toMatchObject({
      stripeConnectEnabled: false,
      stripeConnectAccountId: 'acct_KandiloV2PendingTransfers',
      stripeConnectAccountApi: 'v2',
    });

    await adminDb.doc(`churchPaymentSettings/${CHURCH_ID}`).set({
      stripeConnectEnabled: false,
      stripeConnectAccountId: 'acct_KandiloV2CurrentlyDue',
      stripeConnectAccountApi: 'v2',
      updatedBy: 'super-admin',
      updatedAt: FieldValue.serverTimestamp(),
    });
    await expectCallableFails(
      callCallable(
        'updateChurchPaymentSettingsAsSuperAdmin',
        {
          churchId: CHURCH_ID,
          settings: {
            stripeConnectEnabled: true,
            stripeConnectAccountId: 'acct_KandiloV2CurrentlyDue',
          },
        },
        SUPER_ADMIN_AUTH
      ),
      'failed-precondition'
    );

    await expect(
      callCallable(
        'updateChurchPaymentSettingsAsSuperAdmin',
        {
          churchId: CHURCH_ID,
          settings: { stripeConnectEnabled: true, stripeConnectAccountId: 'acct_Kandilo123' },
        },
        SUPER_ADMIN_AUTH
      )
    ).resolves.toMatchObject({ success: true, churchId: CHURCH_ID });

    await expect(
      callCallable('getChurchPaymentSettings', { churchId: CHURCH_ID }, SUPER_ADMIN_AUTH)
    ).resolves.toMatchObject({
      churchId: CHURCH_ID,
      stripeConnectEnabled: true,
      stripeConnectAccountId: 'acct_Kandilo123',
      stripeConnectAccountApi: 'v1',
    });

    await expect(
      callCallable(
        'updateChurchPaymentSettingsAsSuperAdmin',
        {
          churchId: CHURCH_ID,
          settings: {
            stripeConnectEnabled: true,
            stripeConnectAccountId: 'acct_KandiloV2External',
            stripeConnectAccountApi: 'v2',
          },
        },
        SUPER_ADMIN_AUTH
      )
    ).resolves.toMatchObject({ success: true, churchId: CHURCH_ID });

    await expect(
      callCallable('getChurchPaymentSettings', { churchId: CHURCH_ID }, SUPER_ADMIN_AUTH)
    ).resolves.toMatchObject({
      churchId: CHURCH_ID,
      stripeConnectEnabled: true,
      stripeConnectAccountId: 'acct_KandiloV2External',
      stripeConnectAccountApi: 'v2',
    });

    const auditLogs = await adminDb.collection('platformAuditLog')
      .where('action', '==', 'updateChurchPaymentSettingsAsSuperAdmin')
      .get();
    expect(auditLogs.empty).toBe(false);
    expect(JSON.stringify(auditLogs.docs.map((docSnap) => docSnap.data()))).not.toContain('acct_Kandilo123');
    expect(JSON.stringify(auditLogs.docs.map((docSnap) => docSnap.data()))).not.toContain('acct_KandiloV2External');
  });

  it('creates backend-only Stripe Connect accounts before routing is enabled', async () => {
    await adminDb.doc(`churches/${CHURCH_ID}`).update({
      country: 'US',
      contactEmail: 'office@example.com',
      website: 'https://example.com',
    });

    await expectCallableFails(
      callCallable(
        'createChurchStripeConnectAccountAsSuperAdmin',
        { churchId: CHURCH_ID },
        { uid: 'admin-1', email: 'admin@example.com' }
      ),
      'permission-denied'
    );

    await expect(
      callCallable<
        { churchId: string },
        {
          success: boolean;
          churchId: string;
          stripeConnectEnabled: boolean;
          stripeConnectAccountId: string;
          stripeConnectAccountApi: 'v2';
        }
      >('createChurchStripeConnectAccountAsSuperAdmin', { churchId: CHURCH_ID }, SUPER_ADMIN_AUTH)
    ).resolves.toMatchObject({
      success: true,
      churchId: CHURCH_ID,
      stripeConnectEnabled: false,
      stripeConnectAccountId: 'acct_KandiloCreated',
      stripeConnectAccountApi: 'v2',
    });

    const paymentSettingsSnap = await adminDb.doc(`churchPaymentSettings/${CHURCH_ID}`).get();
    expect(paymentSettingsSnap.data()).toMatchObject({
      stripeConnectEnabled: false,
      stripeConnectAccountId: 'acct_KandiloCreated',
      stripeConnectAccountApi: 'v2',
      stripeConnectAccountCreatedByKandilo: true,
      stripeConnectAccountCountry: 'US',
      stripeConnectAccountDashboard: 'express',
    });

    await expect(
      callCallable(
        'updateChurchPaymentSettingsAsSuperAdmin',
        {
          churchId: CHURCH_ID,
          settings: { stripeConnectEnabled: true, stripeConnectAccountId: 'acct_KandiloCreated' },
        },
        SUPER_ADMIN_AUTH
      )
    ).resolves.toMatchObject({ success: true, churchId: CHURCH_ID });

    await expect(
      callCallable(
        'createChurchStripeConnectOnboardingLink',
        { churchId: CHURCH_ID, returnState: 'B'.repeat(32) },
        { uid: 'treasurer-1', email: 'treasurer@example.com' }
      )
    ).resolves.toMatchObject({
      success: true,
      url: 'https://connect.stripe.com/setup/mock_kandilo_onboarding',
      expiresAtMillis: expect.any(Number),
    });

    const updatedPaymentSettingsSnap = await adminDb.doc(`churchPaymentSettings/${CHURCH_ID}`).get();
    expect(updatedPaymentSettingsSnap.data()).toMatchObject({
      stripeConnectEnabled: true,
      stripeConnectAccountId: 'acct_KandiloCreated',
      stripeConnectAccountApi: 'v2',
    });

    await expectCallableFails(
      callCallable('createChurchStripeConnectAccountAsSuperAdmin', { churchId: CHURCH_ID }, SUPER_ADMIN_AUTH),
      'failed-precondition'
    );

    const auditLogs = await adminDb.collection('platformAuditLog')
      .where('action', '==', 'createChurchStripeConnectAccountAsSuperAdmin')
      .get();
    expect(auditLogs.empty).toBe(false);
    const serialized = JSON.stringify(auditLogs.docs.map((docSnap) => docSnap.data()));
    expect(serialized).toContain('"stripeConnectAccountCreatedByKandilo":true');
    expect(serialized).toContain('"stripeConnectRoutingEnabled":false');
    expect(serialized).not.toContain('acct_KandiloCreated');
  });

  it('creates Canadian Stripe Connect accounts with country-derived defaults', async () => {
    await adminDb.doc(`churches/${CHURCH_ID}`).update({
      name: 'St. George Canadian Orthodox Church',
      city: 'Edmonton',
      state: 'AB',
      country: 'CA',
      contactEmail: 'office@example.ca',
      website: 'https://example.ca',
      timezone: 'America/Edmonton',
    });

    await expect(
      callCallable<
        { churchId: string },
        {
          success: boolean;
          churchId: string;
          stripeConnectEnabled: boolean;
          stripeConnectAccountId: string;
          stripeConnectAccountApi: 'v2';
        }
      >('createChurchStripeConnectAccountAsSuperAdmin', { churchId: CHURCH_ID }, SUPER_ADMIN_AUTH)
    ).resolves.toMatchObject({
      success: true,
      churchId: CHURCH_ID,
      stripeConnectEnabled: false,
      stripeConnectAccountId: 'acct_KandiloCreated',
      stripeConnectAccountApi: 'v2',
    });

    const paymentSettingsSnap = await adminDb.doc(`churchPaymentSettings/${CHURCH_ID}`).get();
    expect(paymentSettingsSnap.data()).toMatchObject({
      stripeConnectEnabled: false,
      stripeConnectAccountId: 'acct_KandiloCreated',
      stripeConnectAccountApi: 'v2',
      stripeConnectAccountCreatedByKandilo: true,
      stripeConnectAccountCountry: 'CA',
      stripeConnectAccountDashboard: 'express',
    });
  });

  it('creates redacted Stripe Connect onboarding links for priests and treasurers only', async () => {
    await adminDb.doc(`churchPaymentSettings/${CHURCH_ID}`).set({
      stripeConnectEnabled: false,
      stripeConnectAccountId: 'acct_Kandilo123',
      updatedBy: 'super-admin',
      updatedAt: FieldValue.serverTimestamp(),
    });

    await expect(
      callCallable<
        { churchId: string; returnState: string },
        { success: boolean; url: string; expiresAtMillis: number | null }
      >(
        'createChurchStripeConnectOnboardingLink',
        { churchId: CHURCH_ID, returnState: 'A'.repeat(32) },
        { uid: 'treasurer-1', email: 'treasurer@example.com' }
      )
    ).resolves.toMatchObject({
      success: true,
      url: 'https://connect.stripe.com/setup/mock_kandilo_onboarding',
      expiresAtMillis: expect.any(Number),
    });

    await expectCallableFails(
      callCallable(
        'createChurchStripeConnectOnboardingLink',
        { churchId: CHURCH_ID, returnState: 'A'.repeat(32) },
        { uid: 'admin-1', email: 'admin@example.com' }
      ),
      'permission-denied'
    );
    await expectCallableFails(
      callCallable(
        'createChurchStripeConnectOnboardingLink',
        { churchId: CHURCH_ID, returnState: 'A'.repeat(32) },
        { uid: 'member-1', email: 'member@example.com' }
      ),
      'permission-denied'
    );

    const auditLogs = await adminDb.collection('platformAuditLog')
      .where('action', '==', 'createChurchStripeConnectOnboardingLink')
      .get();
    expect(auditLogs.empty).toBe(false);
    const serialized = JSON.stringify(auditLogs.docs.map((docSnap) => docSnap.data()));
    expect(serialized).toContain('"stripeConnectAccountConfigured":true');
    expect(serialized).toContain('"stripeConnectReturnStateBound":true');
    expect(serialized).not.toContain('acct_Kandilo123');
    expect(serialized).not.toContain('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');
  });

  it('returns redacted Stripe Connect setup status to receipt managers', async () => {
    await adminDb.doc(`churchPaymentSettings/${CHURCH_ID}`).set({
      stripeConnectEnabled: true,
      stripeConnectAccountId: 'acct_Kandilo123',
      stripeConnectAccountApi: 'v2',
      updatedBy: 'super-admin',
      updatedAt: FieldValue.serverTimestamp(),
    });

    await expect(
      callCallable<
        { churchId: string },
        {
          churchId: string;
          stripeConnectAccountConfigured: boolean;
          stripeConnectRoutingEnabled: boolean;
          stripeConnectAccountApi: 'v1' | 'v2' | 'not_configured';
        }
      >(
        'getChurchStripeConnectSetupStatus',
        { churchId: CHURCH_ID },
        { uid: 'treasurer-1', email: 'treasurer@example.com' }
      )
    ).resolves.toEqual({
      churchId: CHURCH_ID,
      stripeConnectAccountConfigured: true,
      stripeConnectRoutingEnabled: true,
      stripeConnectAccountApi: 'v2',
    });

    await expect(
      callCallable(
        'getChurchStripeConnectSetupStatus',
        { churchId: CHURCH_ID },
        SUPER_ADMIN_AUTH
      )
    ).resolves.toMatchObject({
      churchId: CHURCH_ID,
      stripeConnectAccountConfigured: true,
      stripeConnectRoutingEnabled: true,
      stripeConnectAccountApi: 'v2',
    });

    await expectCallableFails(
      callCallable(
        'getChurchStripeConnectSetupStatus',
        { churchId: CHURCH_ID },
        { uid: 'admin-1', email: 'admin@example.com' }
      ),
      'permission-denied'
    );

    const result = await callCallable<
      { churchId: string },
      { stripeConnectAccountConfigured: boolean; stripeConnectAccountApi: string }
    >(
      'getChurchStripeConnectSetupStatus',
      { churchId: CHURCH_ID },
      { uid: 'priest-1', email: 'priest@example.com' }
    );
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('acct_Kandilo123');
    expect(serialized).not.toContain('super-admin');
  });

  it('returns missing Stripe Connect setup status without exposing private account settings', async () => {
    const result = await callCallable<
      { churchId: string },
      {
        churchId: string;
        stripeConnectAccountConfigured: boolean;
        stripeConnectRoutingEnabled: boolean;
        stripeConnectAccountApi: 'v1' | 'v2' | 'not_configured';
      }
    >(
      'getChurchStripeConnectSetupStatus',
      { churchId: CHURCH_ID },
      { uid: 'treasurer-1', email: 'treasurer@example.com' }
    );

    expect(result).toEqual({
      churchId: CHURCH_ID,
      stripeConnectAccountConfigured: false,
      stripeConnectRoutingEnabled: false,
      stripeConnectAccountApi: 'not_configured',
    });
  });

  it('requires a configured Stripe Connect account before opening onboarding', async () => {
    await expectCallableFails(
      callCallable(
        'createChurchStripeConnectOnboardingLink',
        { churchId: CHURCH_ID, returnState: 'A'.repeat(32) },
        { uid: 'treasurer-1', email: 'treasurer@example.com' }
      ),
      'failed-precondition'
    );
  });

  it('keeps ordinary admins out of annual and batch receipt callables', async () => {
    await expectCallableFails(
      callCallable(
        'sendAnnualTaxReceipt',
        { churchId: CHURCH_ID, year: CLOSED_ANNUAL_YEAR, userId: 'member-1' },
        { uid: 'admin-1', email: 'admin@example.com' }
      ),
      'permission-denied'
    );
    await expectCallableFails(
      callCallable(
        'sendCorrectedAnnualTaxReceipt',
        { churchId: CHURCH_ID, year: CLOSED_ANNUAL_YEAR, userId: 'member-1' },
        { uid: 'admin-1', email: 'admin@example.com' }
      ),
      'permission-denied'
    );
    await expectCallableFails(
      callCallable(
        'sendChurchAnnualTaxReceipts',
        { churchId: CHURCH_ID, year: CLOSED_ANNUAL_YEAR },
        { uid: 'admin-1', email: 'admin@example.com' }
      ),
      'permission-denied'
    );
    await expectCallableFails(
      callCallable(
        'sendChurchCorrectedAnnualTaxReceipts',
        { churchId: CHURCH_ID, year: CLOSED_ANNUAL_YEAR },
        { uid: 'admin-1', email: 'admin@example.com' }
      ),
      'permission-denied'
    );

    expect((await adminDb.collection('taxReceipts').count().get()).data().count).toBe(0);
    expect((await adminDb.collection('taxReceiptSummaries').count().get()).data().count).toBe(0);
  });

  it('keeps full receipt PDF downloads donor-only even for receipt managers', async () => {
    await adminDb.doc('taxReceipts/giving-tax-staff-download').set({
      churchId: CHURCH_ID,
      userId: 'member-1',
      givingId: 'giving-tax-staff-download',
      kind: 'single',
      status: 'sent',
      receiptNumber: expectedReceiptNumber(2026, 42),
      receiptYear: 2026,
      amountCents: 5000,
      eligibleAmountCents: 5000,
      currency: 'USD',
    });

    for (const auth of [
      { uid: 'priest-1', email: 'priest@example.com' },
      { uid: 'treasurer-1', email: 'treasurer@example.com' },
      { uid: 'admin-1', email: 'admin@example.com' },
    ]) {
      await expectCallableFails(
        callCallable(
          'downloadTaxReceiptPdf',
          { receiptId: 'giving-tax-staff-download' },
          auth
        ),
        'permission-denied'
      );
    }

    expect((await adminDb.collection('taxReceiptEvents').count().get()).data().count).toBe(0);
  });

  it('issues and emails tax receipts for completed donations', async () => {
    await adminDb.doc(`churches/${CHURCH_ID}`).update({
      timezone: 'America/Chicago',
      taxReceiptSettings: {
        enabled: true,
        eligibilityConfirmed: true,
        jurisdiction: 'US',
        organizationName: 'St. Nicholas Orthodox Church',
        organizationAddress: '123 Church Street, Chicago, IL',
        taxId: '12-3456789',
        receiptPrefix: 'STN',
        goodsServicesStatement:
          'No goods or services were provided in exchange for this contribution other than intangible religious benefits.',
        autoIssue: true,
      },
    });
    await waitFor(
      async () => (await adminDb.doc('users/member-1').get()).data() ?? null,
      (data) => data?.email === 'member@example.com',
      'member profile bootstrap'
    );
    await adminDb.doc('users/member-1').set({
      taxReceiptLegalName: 'Mira Legal Donor',
      taxReceiptAddress: {
        line1: '10 Donor Street',
        line2: 'Unit 4',
        city: 'Chicago',
        region: 'IL',
        postalCode: '60601',
        country: 'US',
      },
    }, { merge: true });
    await waitFor(
      async () => (await adminDb.doc('users/member-1').get()).data() ?? null,
      (data) =>
        data?.taxReceiptLegalName === 'Mira Legal Donor'
        && data.taxReceiptAddress?.line1 === '10 Donor Street',
      'member tax receipt profile'
    );
    await adminDb.doc('giving/giving-tax-1').set({
      churchId: CHURCH_ID,
      churchName: 'St. Nicholas',
      userId: 'member-1',
      donorName: 'Member One',
      donorEmail: 'stale-profile@example.com',
      anonymous: false,
      amount: 75,
      amountCents: 7500,
      currency: 'USD',
      purpose: 'General Fund',
      status: 'completed',
      completedAt: Timestamp.fromDate(new Date('2026-05-24T16:00:00Z')),
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    const result = await callCallable<
      { givingId: string },
      { success: boolean; receiptId: string; receiptNumber: string; emailSent: boolean }
    >(
      'sendTaxReceipt',
      { givingId: 'giving-tax-1' },
      { uid: 'member-1', email: 'member@example.com' }
    );

    expect(result).toMatchObject({
      success: true,
      receiptId: 'giving-tax-1',
      receiptNumber: expectedReceiptNumber(2026, 1),
      emailSent: true,
    });

    const [receiptSnap, givingSnap, counterSnap] = await Promise.all([
      adminDb.doc('taxReceipts/giving-tax-1').get(),
      adminDb.doc('giving/giving-tax-1').get(),
      adminDb.doc('taxReceiptCounters/church-1_2026').get(),
    ]);
    expect(receiptSnap.data()).toMatchObject({
      churchId: CHURCH_ID,
      userId: 'member-1',
      givingId: 'giving-tax-1',
      receiptNumber: expectedReceiptNumber(2026, 1),
      status: 'sent',
      pdfTemplateVersion: TAX_RECEIPT_PDF_TEMPLATE_VERSION,
      organizationName: 'St. Nicholas Orthodox Church',
      donorName: 'Mira Legal Donor',
      donorAddress: '10 Donor Street, Unit 4, Chicago, IL 60601, US',
      donorEmail: 'member@example.com',
      amountCents: 7500,
      eligibleAmountCents: 7500,
    });
    const receiptData = receiptSnap.data();
    expect(receiptData?.pdfStoragePath).toBe('taxReceipts/church-1/2026/giving-tax-1.pdf');
    expect(receiptData?.pdfSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(receiptData?.pdfByteLength).toBeGreaterThan(1_000);
    expect(receiptData?.pdfRetentionStatus).toBe('retained');
    expect(receiptData?.pdfRetainedAt).toBeInstanceOf(Timestamp);
    expect(givingSnap.data()).toMatchObject({
      donorName: 'Member One',
      donorEmail: '',
      donorNamePublicSafe: true,
      receiptManagerGivingSafeVersion: 1,
      churchReceiptVisible: true,
      taxReceiptId: 'giving-tax-1',
      taxReceiptNumber: expectedReceiptNumber(2026, 1),
      taxReceiptStatus: 'sent',
    });
    expect(counterSnap.data()).toMatchObject({
      lastSequence: 1,
    });

    const pdfResult = await callCallable<
      { receiptId: string },
      { success: boolean; filename: string; contentType: string; content: string }
    >(
      'downloadTaxReceiptPdf',
      { receiptId: 'giving-tax-1' },
      { uid: 'member-1', email: 'member@example.com' }
    );
    expect(pdfResult).toMatchObject({
      success: true,
      filename: `tax-receipt-${expectedReceiptNumber(2026, 1)}.pdf`,
      contentType: 'application/pdf',
    });
    expect(Buffer.from(pdfResult.content, 'base64').subarray(0, 5).toString('utf8')).toBe('%PDF-');

    await adminDb.doc('taxReceipts/giving-tax-1').update({
      donorEmail: 'older-receipt@example.com',
    });
    await expect(
      callCallable(
        'sendTaxReceipt',
        { givingId: 'giving-tax-1' },
        { uid: 'member-1', email: 'member@example.com' }
      )
    ).resolves.toMatchObject({
      success: true,
      receiptId: 'giving-tax-1',
      receiptNumber: expectedReceiptNumber(2026, 1),
      created: false,
      emailSent: true,
    });
    expect((await adminDb.doc('taxReceipts/giving-tax-1').get()).data()).toMatchObject({
      donorEmail: 'member@example.com',
      status: 'sent',
    });
    expect((await adminDb.doc('giving/giving-tax-1').get()).data()).toMatchObject({
      donorEmail: '',
      churchReceiptVisible: true,
      taxReceiptStatus: 'sent',
    });

    await adminDb.doc(`churches/${CHURCH_ID}`).update({ isActive: false });
    await expect(
      callCallable(
        'sendTaxReceipt',
        { givingId: 'giving-tax-1' },
        { uid: 'member-1', email: 'member@example.com' }
      )
    ).resolves.toMatchObject({
      success: true,
      receiptId: 'giving-tax-1',
      receiptNumber: expectedReceiptNumber(2026, 1),
      created: false,
      emailSent: true,
    });
    await adminDb.doc('giving/giving-tax-inactive-new').set({
      churchId: CHURCH_ID,
      churchName: 'St. Nicholas',
      userId: 'member-1',
      donorName: 'Member One',
      donorEmail: 'member@example.com',
      anonymous: false,
      amount: 35,
      amountCents: 3500,
      currency: 'USD',
      purpose: 'General Fund',
      status: 'completed',
      completedAt: Timestamp.fromDate(new Date('2026-06-02T16:00:00Z')),
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    await expectCallableFails(
      callCallable(
        'sendTaxReceipt',
        { givingId: 'giving-tax-inactive-new' },
        { uid: 'member-1', email: 'member@example.com' }
      ),
      'failed-precondition'
    );
    expect((await adminDb.doc('taxReceipts/giving-tax-inactive-new').get()).exists).toBe(false);
    await adminDb.doc(`churches/${CHURCH_ID}`).update({ isActive: true });

    await adminDb.doc(`churches/${CHURCH_ID}`).update({
      'taxReceiptSettings.enabled': false,
    });
    await expect(
      callCallable(
        'sendTaxReceipt',
        { givingId: 'giving-tax-1' },
        { uid: 'treasurer-1', email: 'treasurer@example.com' }
      )
    ).resolves.toMatchObject({
      success: true,
      receiptId: '',
      receiptNumber: expectedReceiptNumber(2026, 1),
      created: false,
      emailSent: true,
    });
    expect((await adminDb.doc('taxReceiptCounters/church-1_2026').get()).data()).toMatchObject({
      lastSequence: 1,
    });
    await adminDb.doc(`churches/${CHURCH_ID}`).update({
      'taxReceiptSettings.enabled': true,
    });

    await adminDb.doc('giving/giving-tax-anon').set({
      churchId: CHURCH_ID,
      churchName: 'St. Nicholas',
      userId: 'member-1',
      donorName: 'Anonymous donor',
      donorEmail: '',
      amount: 40,
      amountCents: 4000,
      currency: 'USD',
      purpose: 'Candles',
      anonymous: true,
      status: 'completed',
      completedAt: Timestamp.fromDate(new Date('2026-06-01T16:00:00Z')),
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    await expect(
      callCallable(
        'sendTaxReceipt',
        { givingId: 'giving-tax-anon' },
        { uid: 'member-1', email: 'member@example.com' }
      )
    ).resolves.toMatchObject({
      success: true,
      receiptId: 'giving-tax-anon',
      receiptNumber: expectedReceiptNumber(2026, 2),
      emailSent: true,
    });
    expect((await adminDb.doc('taxReceipts/giving-tax-anon').get()).data()).toMatchObject({
      donorName: 'Mira Legal Donor',
      donorAddress: '10 Donor Street, Unit 4, Chicago, IL 60601, US',
      donorEmail: 'member@example.com',
      amountCents: 4000,
      status: 'sent',
    });
    expect((await adminDb.doc('giving/giving-tax-anon').get()).data()).toMatchObject({
      donorName: 'Anonymous donor',
      donorEmail: '',
      anonymous: true,
      taxReceiptStatus: 'sent',
    });

    await expectCallableFails(
      callCallable(
        'sendTaxReceipt',
        { givingId: 'giving-tax-anon' },
        { uid: 'treasurer-1', email: 'treasurer@example.com' }
      ),
      'permission-denied'
    );

    await adminDb.doc('giving/giving-tax-unclassified').set({
      churchId: CHURCH_ID,
      churchName: 'St. Nicholas',
      userId: 'other-1',
      donorName: 'Other One',
      donorEmail: 'other@example.com',
      amount: 30,
      amountCents: 3000,
      currency: 'USD',
      purpose: 'Candles',
      status: 'completed',
      completedAt: Timestamp.fromDate(new Date('2026-06-03T16:00:00Z')),
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    await expect(
      callCallable(
        'sendTaxReceipt',
        { givingId: 'giving-tax-unclassified' },
        { uid: 'other-1', email: 'other@example.com' }
      )
    ).resolves.toMatchObject({
      success: true,
      receiptId: 'giving-tax-unclassified',
      receiptNumber: expectedReceiptNumber(2026, 3),
      emailSent: true,
    });
    expect((await adminDb.doc('taxReceipts/giving-tax-unclassified').get()).data()).toMatchObject({
      donorName: 'Other One',
      donorEmail: 'other@example.com',
      amountCents: 3000,
      status: 'sent',
    });
    expect((await adminDb.doc('giving/giving-tax-unclassified').get()).data()).toMatchObject({
      donorName: 'Anonymous donor',
      donorEmail: '',
      taxReceiptStatus: 'sent',
    });
    await expectCallableFails(
      callCallable(
        'sendTaxReceipt',
        { givingId: 'giving-tax-unclassified' },
        { uid: 'treasurer-1', email: 'treasurer@example.com' }
      ),
      'permission-denied'
    );

    await adminDb.doc('giving/giving-tax-legacy-hidden').set({
      churchId: CHURCH_ID,
      churchName: 'St. Nicholas',
      userId: 'member-1',
      donorName: 'Member One',
      donorEmail: 'legacy-member@example.com',
      churchReceiptVisible: false,
      anonymous: false,
      amount: 45,
      amountCents: 4500,
      currency: 'USD',
      purpose: 'Candles',
      status: 'completed',
      completedAt: Timestamp.fromDate(new Date('2026-06-04T16:00:00Z')),
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    await expectCallableFails(
      callCallable(
        'sendTaxReceipt',
        { givingId: 'giving-tax-legacy-hidden' },
        { uid: 'treasurer-1', email: 'treasurer@example.com' }
      ),
      'permission-denied'
    );
    expect((await adminDb.doc('taxReceipts/giving-tax-legacy-hidden').get()).exists).toBe(false);

    await adminDb.doc('giving/giving-tax-legacy-stripe-private').set({
      churchId: CHURCH_ID,
      churchName: 'St. Nicholas',
      userId: 'member-1',
      donorName: 'Member One',
      donorEmail: '',
      churchReceiptVisible: true,
      donorNamePublicSafe: true,
      receiptManagerGivingSafeVersion: 1,
      anonymous: false,
      amount: 55,
      amountCents: 5500,
      currency: 'USD',
      purpose: 'Candles',
      status: 'completed',
      stripeCheckoutSessionId: 'cs_live_private',
      stripePaymentIntentId: 'pi_live_private',
      completedAt: Timestamp.fromDate(new Date('2026-06-05T16:00:00Z')),
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    await expectCallableFails(
      callCallable(
        'sendTaxReceipt',
        { givingId: 'giving-tax-legacy-stripe-private' },
        { uid: 'priest-1', email: 'priest@example.com' }
      ),
      'permission-denied'
    );
    expect((await adminDb.doc('taxReceipts/giving-tax-legacy-stripe-private').get()).exists).toBe(false);

    await expect(
      callCallable(
        'sendTaxReceipt',
        { givingId: 'giving-tax-1' },
        { uid: 'treasurer-1', email: 'treasurer@example.com' }
      )
    ).resolves.toMatchObject({
      success: true,
      receiptId: '',
      receiptNumber: expectedReceiptNumber(2026, 1),
      created: false,
      emailSent: true,
    });
    await expectCallableFails(
      callCallable(
        'sendTaxReceipt',
        { givingId: 'giving-tax-1' },
        { uid: 'admin-1', email: 'admin@example.com' }
      ),
      'permission-denied'
    );
    await expectCallableFails(
      callCallable(
        'downloadTaxReceiptPdf',
        { receiptId: 'giving-tax-1' },
        { uid: 'treasurer-1', email: 'treasurer@example.com' }
      ),
      'permission-denied'
    );
    await Promise.all([
      adminDb.doc('taxReceipts/giving-tax-voided-download').set({
        churchId: CHURCH_ID,
        userId: 'member-1',
        givingId: 'giving-tax-voided-download',
        kind: 'single',
        status: 'voided',
        receiptNumber: expectedReceiptNumber(2026, 91),
        receiptYear: 2026,
        amountCents: 1000,
        eligibleAmountCents: 1000,
        voidedAt: FieldValue.serverTimestamp(),
      }),
      adminDb.doc('taxReceipts/giving-tax-review-download').set({
        churchId: CHURCH_ID,
        userId: 'member-1',
        givingId: 'giving-tax-review-download',
        kind: 'single',
        status: 'error',
        receiptNumber: expectedReceiptNumber(2026, 92),
        receiptYear: 2026,
        amountCents: 1000,
        eligibleAmountCents: 1000,
        correctionRequired: true,
        correctionReason: 'stripe_partial_refund_review_required',
      }),
    ]);
    await expectCallableFails(
      callCallable(
        'downloadTaxReceiptPdf',
        { receiptId: 'giving-tax-voided-download' },
        { uid: 'member-1', email: 'member@example.com' }
      ),
      'failed-precondition'
    );
    await expectCallableFails(
      callCallable(
        'downloadTaxReceiptPdf',
        { receiptId: 'giving-tax-review-download' },
        { uid: 'member-1', email: 'member@example.com' }
      ),
      'failed-precondition'
    );

    const receiptEvents = await adminDb
      .collection('taxReceiptEvents')
      .where('receiptId', '==', 'giving-tax-1')
      .get();
    const eventData = receiptEvents.docs.map((doc) => doc.data());
    expect(eventData).toEqual(expect.arrayContaining([
      expect.objectContaining({
        action: 'issued',
        actorUid: 'member-1',
        churchId: CHURCH_ID,
        userId: 'member-1',
        givingId: 'giving-tax-1',
        kind: 'single',
        receiptYear: 2026,
      }),
      expect.objectContaining({
        action: 'email_sent',
        actorUid: 'member-1',
        churchId: CHURCH_ID,
        userId: 'member-1',
        givingId: 'giving-tax-1',
        kind: 'single',
        receiptYear: 2026,
      }),
      expect.objectContaining({
        action: 'email_sent',
        actorUid: 'treasurer-1',
        churchId: CHURCH_ID,
        userId: 'member-1',
        givingId: 'giving-tax-1',
        kind: 'single',
        receiptYear: 2026,
      }),
      expect.objectContaining({
        action: 'pdf_downloaded',
        actorUid: 'member-1',
        churchId: CHURCH_ID,
        userId: 'member-1',
        givingId: 'giving-tax-1',
        kind: 'single',
        receiptYear: 2026,
      }),
    ]));
    for (const event of eventData) {
      expect(event).not.toHaveProperty('donorEmail');
      expect(event).not.toHaveProperty('donorName');
      expect(event).not.toHaveProperty('donorAddress');
      expect(event).not.toHaveProperty('organizationTaxId');
      expect(event).not.toHaveProperty('organizationAddress');
    }

    await expectCallableFails(
      callCallable(
        'sendTaxReceipt',
        { givingId: 'giving-tax-1' },
        { uid: 'admin-1', email: 'admin@example.com' }
      ),
      'permission-denied'
    );
  });

  it('blocks donor PDF downloads for malformed stored receipts before retained PDF work', async () => {
    const receiptId = 'legacy-malformed-kind-download';
    await adminDb.doc(`taxReceipts/${receiptId}`).set({
      churchId: CHURCH_ID,
      churchName: 'St. Nicholas',
      userId: 'member-1',
      givingId: '',
      kind: 'legacy',
      status: 'sent',
      jurisdiction: 'US',
      receiptNumber: expectedReceiptNumber(2026, 93),
      receiptYear: 2026,
      organizationName: 'St. Nicholas Orthodox Church',
      organizationAddress: '123 Church Street, Chicago, IL',
      organizationTaxId: '12-3456789',
      donorName: 'Member One',
      donorEmail: 'member@example.com',
      amountCents: 1000,
      eligibleAmountCents: 1000,
      currency: 'USD',
      purpose: 'General Fund',
      receivedDateLabel: 'May 24, 2026',
      issuedDateLabel: 'May 24, 2026',
      goodsServicesStatement:
        'No goods or services were provided in exchange for this contribution other than intangible religious benefits.',
      emailSentAt: Timestamp.fromDate(new Date('2026-05-24T17:00:00Z')),
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    await expect(
      callCallable(
        'downloadTaxReceiptPdf',
        { receiptId },
        { uid: 'member-1', email: 'member@example.com' }
      )
    ).rejects.toMatchObject({
      status: 'FAILED_PRECONDITION',
      body: {
        error: {
          details: {
            errorCode: 'tax_receipt_preparation_failed',
          },
        },
      },
    });

    const [receiptSnap, eventsSnap] = await Promise.all([
      adminDb.doc(`taxReceipts/${receiptId}`).get(),
      adminDb
        .collection('taxReceiptEvents')
        .where('receiptId', '==', receiptId)
        .get(),
    ]);
    expect(receiptSnap.data()).not.toHaveProperty('pdfStoragePath');
    expect(receiptSnap.data()).not.toHaveProperty('pdfSha256');
    expect(eventsSnap.docs.map((doc) => doc.data())).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ action: 'pdf_downloaded' }),
    ]));
  });

  it('requires a verified donor Auth email before issuing a new official receipt', async () => {
    await adminAuth.createUser({
      uid: 'unverified-tax-donor',
      email: 'unverified-tax-donor@example.com',
      emailVerified: false,
      password: PASSWORD,
      displayName: 'Unverified Tax Donor',
    });
    await Promise.all([
      seedUserProfile('unverified-tax-donor', 'legacy-profile-donor@example.com', 'Unverified Tax Donor'),
      seedChurchMember('unverified-tax-donor', 'legacy-member-donor@example.com', 'member'),
      adminDb.doc(`churches/${CHURCH_ID}`).update({
        timezone: 'America/Chicago',
        taxReceiptSettings: {
          enabled: true,
          eligibilityConfirmed: true,
          jurisdiction: 'US',
          organizationName: 'St. Nicholas Orthodox Church',
          organizationAddress: '123 Church Street, Chicago, IL',
          taxId: '12-3456789',
          receiptPrefix: 'STN',
          goodsServicesStatement:
            'No goods or services were provided in exchange for this contribution other than intangible religious benefits.',
          autoIssue: true,
        },
      }),
    ]);
    await adminDb.doc('giving/giving-unverified-donor-email').set({
      churchId: CHURCH_ID,
      churchName: 'St. Nicholas',
      userId: 'unverified-tax-donor',
      donorName: 'Unverified Tax Donor',
      donorEmail: '',
      donorNamePublicSafe: true,
      receiptManagerGivingSafeVersion: 1,
      churchReceiptVisible: true,
      anonymous: false,
      amount: 75,
      amountCents: 7500,
      currency: 'USD',
      purpose: 'General Fund',
      status: 'completed',
      completedAt: Timestamp.fromDate(new Date('2026-05-24T16:00:00Z')),
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    await expectCallableFails(
      callCallable(
        'sendTaxReceipt',
        { givingId: 'giving-unverified-donor-email' },
        { uid: 'priest-1', email: 'priest@example.com' }
      ),
      'failed-precondition'
    );

    const [blockedGivingSnap, blockedReceiptSnap, blockedCounterSnap] = await Promise.all([
      adminDb.doc('giving/giving-unverified-donor-email').get(),
      adminDb.doc('taxReceipts/giving-unverified-donor-email').get(),
      adminDb.doc('taxReceiptCounters/church-1_2026').get(),
    ]);
    expect(blockedGivingSnap.data()).toMatchObject({
      taxReceiptStatus: 'ready',
      taxReceiptError: 'tax_receipt_missing_email_or_amount',
      donorEmail: '',
    });
    expect(blockedGivingSnap.data()).not.toHaveProperty('taxReceiptEmailError');
    expect(blockedReceiptSnap.exists).toBe(false);
    expect(blockedCounterSnap.exists).toBe(false);
  });

  it('blocks stored official receipt email and PDF delivery when the receipt number is missing or fallback-only', async () => {
    const givingId = 'giving-tax-missing-number';
    await Promise.all([
      adminDb.doc('giving/giving-tax-missing-number').set({
        churchId: CHURCH_ID,
        churchName: 'St. Nicholas',
        userId: 'member-1',
        donorName: 'Member One',
        donorEmail: '',
        anonymous: false,
        amount: 75,
        amountCents: 7500,
        currency: 'USD',
        purpose: 'General Fund',
        status: 'completed',
        taxReceiptId: givingId,
        taxReceiptNumber: 'Unassigned',
        taxReceiptStatus: 'issued',
        completedAt: Timestamp.fromDate(new Date('2026-05-24T16:00:00Z')),
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }),
      adminDb.doc('taxReceipts/giving-tax-missing-number').set({
        churchId: CHURCH_ID,
        churchName: 'St. Nicholas',
        userId: 'member-1',
        givingId,
        kind: 'single',
        status: 'issued',
        jurisdiction: 'US',
        receiptNumber: 'Unassigned',
        receiptYear: 2026,
        organizationName: 'St. Nicholas Orthodox Church',
        organizationAddress: '123 Church Street, Chicago, IL',
        organizationTaxId: '12-3456789',
        donorName: 'Member Legal Donor',
        donorAddress: '10 Donor Street, Chicago, IL 60601, US',
        donorEmail: 'member@example.com',
        amountCents: 7500,
        eligibleAmountCents: 7500,
        currency: 'USD',
        purpose: 'General Fund',
        receivedDateLabel: 'May 24, 2026',
        issuedDateLabel: 'May 24, 2026',
        goodsServicesStatement:
          'No goods or services were provided in exchange for this contribution other than intangible religious benefits.',
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }),
    ]);

    await expect(
      callCallable(
        'sendTaxReceipt',
        { givingId },
        { uid: 'member-1', email: 'member@example.com' }
      )
    ).rejects.toMatchObject({
      status: 'FAILED_PRECONDITION',
      body: {
        error: {
          details: {
            errorCode: 'tax_receipt_missing_receipt_number',
          },
        },
      },
    });
    await expect(
      callCallable(
        'downloadTaxReceiptPdf',
        { receiptId: givingId },
        { uid: 'member-1', email: 'member@example.com' }
      )
    ).rejects.toMatchObject({
      status: 'FAILED_PRECONDITION',
      body: {
        error: {
          details: {
            errorCode: 'tax_receipt_missing_receipt_number',
          },
        },
      },
    });

    const [receiptSnap, givingSnap, eventsSnap] = await Promise.all([
      adminDb.doc('taxReceipts/giving-tax-missing-number').get(),
      adminDb.doc('giving/giving-tax-missing-number').get(),
      adminDb
        .collection('taxReceiptEvents')
        .where('receiptId', '==', givingId)
        .get(),
    ]);
    expect(receiptSnap.data()).toMatchObject({
      status: 'error',
      emailError: 'tax_receipt_missing_receipt_number',
    });
    expect(receiptSnap.data()).not.toHaveProperty('emailSentAt');
    expect(receiptSnap.data()).not.toHaveProperty('pdfStoragePath');
    expect(givingSnap.data()).toMatchObject({
      taxReceiptStatus: 'error',
      taxReceiptError: 'tax_receipt_missing_receipt_number',
      taxReceiptEmailError: 'tax_receipt_missing_receipt_number',
    });
    expect(eventsSnap.docs.map((doc) => doc.data())).toEqual([
      expect.objectContaining({
        action: 'email_failed',
        actorUid: 'member-1',
        churchId: CHURCH_ID,
        userId: 'member-1',
        givingId,
        kind: 'single',
        receiptYear: 2026,
        errorCode: 'tax_receipt_missing_receipt_number',
      }),
    ]);
  });

  it('fails closed when the tax receipt counter is corrupt before assigning an official number', async () => {
    await adminDb.doc(`churches/${CHURCH_ID}`).update({
      timezone: 'America/Chicago',
      taxReceiptSettings: {
        enabled: true,
        eligibilityConfirmed: true,
        jurisdiction: 'US',
        organizationName: 'St. Nicholas Orthodox Church',
        organizationAddress: '123 Church Street, Chicago, IL',
        taxId: '12-3456789',
        receiptPrefix: 'STN',
        goodsServicesStatement: 'No goods or services were provided in exchange for this contribution.',
        autoIssue: true,
      },
    });
    await Promise.all([
      adminDb.doc('giving/giving-counter-corrupt').set({
        churchId: CHURCH_ID,
        churchName: 'St. Nicholas',
        userId: 'member-1',
        donorName: 'Member One',
        donorEmail: '',
        anonymous: false,
        amount: 60,
        amountCents: 6000,
        currency: 'USD',
        purpose: 'General Fund',
        status: 'completed',
        completedAt: Timestamp.fromDate(new Date('2026-05-24T16:00:00Z')),
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }),
      adminDb.doc('taxReceiptCounters/church-1_2026').set({
        churchId: CHURCH_ID,
        year: 2026,
        lastSequence: -1,
        updatedAt: FieldValue.serverTimestamp(),
      }),
    ]);

    await expectCallableFails(
      callCallable(
        'sendTaxReceipt',
        { givingId: 'giving-counter-corrupt' },
        { uid: 'member-1', email: 'member@example.com' }
      ),
      'failed-precondition'
    );

    expect((await adminDb.doc('taxReceipts/giving-counter-corrupt').get()).exists).toBe(false);
    expect((await adminDb.doc('giving/giving-counter-corrupt').get()).data()).not.toHaveProperty('taxReceiptNumber');
    expect((await adminDb.doc('taxReceiptCounters/church-1_2026').get()).data()).toMatchObject({
      lastSequence: -1,
    });
  });

  it('fails closed when a completed donation is missing currency before assigning an official number', async () => {
    await adminDb.doc(`churches/${CHURCH_ID}`).update({
      timezone: 'America/Chicago',
      taxReceiptSettings: {
        enabled: true,
        eligibilityConfirmed: true,
        jurisdiction: 'US',
        organizationName: 'St. Nicholas Orthodox Church',
        organizationAddress: '123 Church Street, Chicago, IL',
        taxId: '12-3456789',
        receiptPrefix: 'STN',
        goodsServicesStatement: 'No goods or services were provided in exchange for this contribution.',
        autoIssue: true,
      },
    });
    await adminDb.doc('giving/giving-missing-currency').set({
      churchId: CHURCH_ID,
      churchName: 'St. Nicholas',
      userId: 'member-1',
      donorName: 'Member One',
      donorEmail: '',
      anonymous: false,
      amount: 60,
      amountCents: 6000,
      purpose: 'General Fund',
      status: 'completed',
      completedAt: Timestamp.fromDate(new Date('2026-05-24T16:00:00Z')),
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    await expectCallableFails(
      callCallable(
        'sendTaxReceipt',
        { givingId: 'giving-missing-currency' },
        { uid: 'member-1', email: 'member@example.com' }
      ),
      'failed-precondition'
    );

    const [givingSnap, receiptSnap, counterSnap] = await Promise.all([
      adminDb.doc('giving/giving-missing-currency').get(),
      adminDb.doc('taxReceipts/giving-missing-currency').get(),
      adminDb.doc('taxReceiptCounters/church-1_2026').get(),
    ]);
    expect(givingSnap.data()).not.toHaveProperty('taxReceiptNumber');
    expect(givingSnap.data()).not.toHaveProperty('taxReceiptId');
    expect(receiptSnap.exists).toBe(false);
    expect(counterSnap.exists).toBe(false);
  });

  it('blocks new single-donation receipts when the donation is already covered by an annual receipt', async () => {
    await adminDb.doc(`churches/${CHURCH_ID}`).update({
      timezone: 'America/Chicago',
      taxReceiptSettings: {
        enabled: true,
        eligibilityConfirmed: true,
        jurisdiction: 'US',
        organizationName: 'St. Nicholas Orthodox Church',
        organizationAddress: '123 Church Street, Chicago, IL',
        taxId: '12-3456789',
        receiptPrefix: 'STN',
        goodsServicesStatement: 'No goods or services were provided in exchange for this contribution.',
        autoIssue: true,
      },
    });
    const givingId = 'single-covered-by-annual';
    const annualReceiptId = annualTaxReceiptDocId(CHURCH_ID, 'member-1', CLOSED_ANNUAL_YEAR);
    await Promise.all([
      adminDb.doc(`giving/${givingId}`).set({
        churchId: CHURCH_ID,
        churchName: 'St. Nicholas',
        userId: 'member-1',
        donorName: 'Member One',
        donorEmail: '',
        anonymous: false,
        amount: 90,
        amountCents: 9000,
        currency: 'USD',
        purpose: 'General Fund',
        status: 'completed',
        completedAt: Timestamp.fromDate(new Date(`${CLOSED_ANNUAL_YEAR}-04-10T16:00:00Z`)),
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }),
      adminDb.doc(`taxReceipts/${annualReceiptId}`).set({
        churchId: CHURCH_ID,
        churchName: 'St. Nicholas',
        userId: 'member-1',
        givingId: '',
        givingIds: [givingId],
        kind: 'annual',
        status: 'sent',
        receiptNumber: expectedReceiptNumber(CLOSED_ANNUAL_YEAR, 1),
        receiptYear: CLOSED_ANNUAL_YEAR,
        annualYear: CLOSED_ANNUAL_YEAR,
        amountCents: 9000,
        eligibleAmountCents: 9000,
        currency: 'USD',
        correctionRequired: false,
        correctionReason: '',
        voidedAt: null,
        voidReason: '',
      }),
    ]);

    await expectCallableFails(
      callCallable(
        'sendTaxReceipt',
        { givingId },
        { uid: 'member-1', email: 'member@example.com' }
      ),
      'failed-precondition'
    );

    expect((await adminDb.doc(`taxReceipts/${givingId}`).get()).exists).toBe(false);
    expect((await adminDb.doc(`giving/${givingId}`).get()).data()).not.toMatchObject({
      taxReceiptId: givingId,
      taxReceiptStatus: 'issued',
    });
  });

  it('does not block single-donation receipts when an annual receipt only has an unassigned number', async () => {
    await adminDb.doc(`churches/${CHURCH_ID}`).update({
      timezone: 'America/Chicago',
      taxReceiptSettings: {
        enabled: true,
        eligibilityConfirmed: true,
        jurisdiction: 'US',
        organizationName: 'St. Nicholas Orthodox Church',
        organizationAddress: '123 Church Street, Chicago, IL',
        taxId: '12-3456789',
        receiptPrefix: 'STN',
        goodsServicesStatement: 'No goods or services were provided in exchange for this contribution.',
        autoIssue: false,
      },
    });
    const givingId = 'single-covered-by-unassigned-annual';
    const annualReceiptId = annualTaxReceiptDocId(CHURCH_ID, 'member-1', CLOSED_ANNUAL_YEAR);
    await Promise.all([
      adminDb.doc(`giving/${givingId}`).set({
        churchId: CHURCH_ID,
        churchName: 'St. Nicholas',
        userId: 'member-1',
        donorName: 'Member One',
        donorEmail: '',
        anonymous: false,
        amount: 90,
        amountCents: 9000,
        currency: 'USD',
        purpose: 'General Fund',
        status: 'completed',
        completedAt: Timestamp.fromDate(new Date(`${CLOSED_ANNUAL_YEAR}-04-10T16:00:00Z`)),
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }),
      adminDb.doc(`taxReceipts/${annualReceiptId}`).set({
        churchId: CHURCH_ID,
        churchName: 'St. Nicholas',
        userId: 'member-1',
        givingId: '',
        givingIds: [givingId],
        kind: 'annual',
        status: 'sent',
        receiptNumber: 'Unassigned',
        receiptYear: CLOSED_ANNUAL_YEAR,
        annualYear: CLOSED_ANNUAL_YEAR,
        amountCents: 9000,
        eligibleAmountCents: 9000,
        currency: 'USD',
      }),
    ]);

    await expect(
      callCallable(
        'sendTaxReceipt',
        { givingId },
        { uid: 'member-1', email: 'member@example.com' }
      )
    ).resolves.toMatchObject({
      success: true,
      receiptId: givingId,
      receiptNumber: expectedReceiptNumber(CLOSED_ANNUAL_YEAR, 1),
      created: true,
      emailSent: true,
    });
    expect((await adminDb.doc(`taxReceipts/${givingId}`).get()).data()).toMatchObject({
      kind: 'single',
      status: 'sent',
      receiptNumber: expectedReceiptNumber(CLOSED_ANNUAL_YEAR, 1),
    });
  });

  it('records a redacted tax receipt email failure audit event', async () => {
    await Promise.all([
      adminDb.doc('giving/giving-email-fail').set({
        churchId: CHURCH_ID,
        churchName: 'St. Nicholas',
        userId: 'ghost-donor',
        donorName: 'Ghost Donor',
        donorEmail: '',
        anonymous: false,
        churchReceiptVisible: true,
        donorNamePublicSafe: true,
        receiptManagerGivingSafeVersion: 1,
        amount: 10,
        amountCents: 1000,
        currency: 'USD',
        purpose: 'General Fund',
        status: 'completed',
        completedAt: Timestamp.fromDate(new Date('2026-05-24T16:00:00Z')),
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }),
      adminDb.doc('taxReceipts/giving-email-fail').set({
        churchId: CHURCH_ID,
        churchName: 'St. Nicholas',
        userId: 'ghost-donor',
        givingId: 'giving-email-fail',
        kind: 'single',
        status: 'issued',
        jurisdiction: 'US',
        receiptNumber: 'STN-000099',
        receiptYear: 2026,
        organizationName: 'St. Nicholas Orthodox Church',
        donorName: 'Ghost Donor',
        donorEmail: '',
        amountCents: 1000,
        eligibleAmountCents: 1000,
        currency: 'USD',
        purpose: 'General Fund',
        receivedDateLabel: 'May 24, 2026',
        issuedDateLabel: 'May 24, 2026',
        goodsServicesStatement:
          'No goods or services were provided in exchange for this contribution other than intangible religious benefits.',
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }),
    ]);

    await expectCallableFails(
      callCallable(
        'sendTaxReceipt',
        { givingId: 'giving-email-fail' },
        { uid: 'priest-1', email: 'priest@example.com' }
      ),
      'failed-precondition'
    );

    const [receiptSnap, givingSnap, eventsSnap] = await Promise.all([
      adminDb.doc('taxReceipts/giving-email-fail').get(),
      adminDb.doc('giving/giving-email-fail').get(),
      adminDb
        .collection('taxReceiptEvents')
        .where('receiptId', '==', 'giving-email-fail')
        .get(),
    ]);
    expect(receiptSnap.data()).toMatchObject({
      status: 'error',
      emailError: 'tax_receipt_missing_email_or_amount',
    });
    expect(givingSnap.data()).toMatchObject({
      taxReceiptStatus: 'error',
      taxReceiptError: 'tax_receipt_missing_email_or_amount',
      taxReceiptEmailError: 'tax_receipt_missing_email_or_amount',
    });

    const events = eventsSnap.docs.map((doc) => doc.data());
    expect(events).toEqual([
      expect.objectContaining({
        action: 'email_failed',
        actorUid: 'priest-1',
        churchId: CHURCH_ID,
        userId: 'ghost-donor',
        givingId: 'giving-email-fail',
        kind: 'single',
        receiptYear: 2026,
        errorCode: 'tax_receipt_missing_email_or_amount',
      }),
    ]);
    expect(events[0]).not.toHaveProperty('donorEmail');
    expect(events[0]).not.toHaveProperty('donorName');
    expect(events[0]).not.toHaveProperty('donorAddress');
  });

  it('clears tax receipt email send claims when receipt preparation fails before provider delivery', async () => {
    await Promise.all([
      adminDb.doc('giving/giving-preparation-fail').set({
        churchId: CHURCH_ID,
        churchName: 'St. Nicholas',
        userId: 'member-1',
        donorName: 'Member One',
        donorEmail: '',
        anonymous: false,
        amount: 10,
        amountCents: 1000,
        currency: 'USD',
        purpose: 'General Fund',
        status: 'completed',
        taxReceiptId: 'giving-preparation-fail',
        taxReceiptNumber: 'STN-000098',
        taxReceiptStatus: 'issued',
        completedAt: Timestamp.fromDate(new Date('2026-05-24T16:00:00Z')),
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }),
      adminDb.doc('taxReceipts/giving-preparation-fail').set({
        churchId: CHURCH_ID,
        churchName: 'St. Nicholas',
        userId: 'member-1',
        givingId: 'giving-preparation-fail',
        kind: 'single',
        status: 'issued',
        jurisdiction: 'US',
        receiptNumber: 'STN-000098',
        receiptYear: 2026,
        organizationName: 'St. Nicholas Orthodox Church',
        donorName: 'Member One '.repeat(20),
        donorEmail: 'member@example.com',
        amountCents: 1000,
        eligibleAmountCents: 1000,
        currency: 'USD',
        purpose: 'General Fund',
        receivedDateLabel: 'May 24, 2026',
        issuedDateLabel: 'May 24, 2026',
        goodsServicesStatement:
          'No goods or services were provided in exchange for this contribution other than intangible religious benefits.',
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }),
    ]);

    await expectCallableFails(
      callCallable(
        'sendTaxReceipt',
        { givingId: 'giving-preparation-fail' },
        { uid: 'member-1', email: 'member@example.com' }
      ),
      'internal'
    );

    const [receiptSnap, givingSnap, eventsSnap] = await Promise.all([
      adminDb.doc('taxReceipts/giving-preparation-fail').get(),
      adminDb.doc('giving/giving-preparation-fail').get(),
      adminDb
        .collection('taxReceiptEvents')
        .where('receiptId', '==', 'giving-preparation-fail')
        .get(),
    ]);
    expect(receiptSnap.data()).toMatchObject({
      status: 'error',
      emailError: 'tax_receipt_preparation_failed',
    });
    expect(receiptSnap.data()).not.toHaveProperty('emailSendingAt');
    expect(receiptSnap.data()).not.toHaveProperty('emailSendAttemptId');
    expect(receiptSnap.data()).not.toHaveProperty('emailSentAt');
    expect(givingSnap.data()).toMatchObject({
      taxReceiptStatus: 'error',
      taxReceiptError: 'tax_receipt_preparation_failed',
      taxReceiptEmailError: 'tax_receipt_preparation_failed',
    });
    expect(eventsSnap.docs.map((doc) => doc.data())).toEqual([
      expect.objectContaining({
        action: 'email_failed',
        actorUid: 'member-1',
        churchId: CHURCH_ID,
        userId: 'member-1',
        givingId: 'giving-preparation-fail',
        kind: 'single',
        receiptYear: 2026,
        errorCode: 'tax_receipt_preparation_failed',
      }),
    ]);
    const event = eventsSnap.docs[0].data();
    expect(event).not.toHaveProperty('donorEmail');
    expect(event).not.toHaveProperty('donorName');
    expect(event).not.toHaveProperty('donorAddress');
  });

  it('does not downgrade an already-sent receipt when a later resend cannot be delivered', async () => {
    await Promise.all([
      adminDb.doc('giving/giving-resend-fail').set({
        churchId: CHURCH_ID,
        churchName: 'St. Nicholas',
        userId: 'member-1',
        donorName: 'Member One',
        donorEmail: '',
        anonymous: false,
        churchReceiptVisible: true,
        donorNamePublicSafe: true,
        receiptManagerGivingSafeVersion: 1,
        amount: 10,
        amountCents: 1000,
        currency: 'USD',
        purpose: 'General Fund',
        status: 'completed',
        taxReceiptId: 'giving-resend-fail',
        taxReceiptNumber: 'STN-000100',
        taxReceiptStatus: 'sent',
        completedAt: Timestamp.fromDate(new Date('2026-05-24T16:00:00Z')),
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }),
      adminDb.doc('taxReceipts/giving-resend-fail').set({
        churchId: CHURCH_ID,
        churchName: 'St. Nicholas',
        userId: 'member-1',
        givingId: 'giving-resend-fail',
        kind: 'single',
        status: 'sent',
        jurisdiction: 'US',
        receiptNumber: 'STN-000100',
        receiptYear: 2026,
        organizationName: 'St. Nicholas Orthodox Church',
        donorName: 'Member One '.repeat(20),
        donorEmail: '',
        amountCents: 1000,
        eligibleAmountCents: 1000,
        currency: 'USD',
        purpose: 'General Fund',
        receivedDateLabel: 'May 24, 2026',
        issuedDateLabel: 'May 24, 2026',
        goodsServicesStatement:
          'No goods or services were provided in exchange for this contribution other than intangible religious benefits.',
        emailSentAt: Timestamp.fromDate(new Date('2026-05-24T17:00:00Z')),
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }),
    ]);

    await expectCallableFails(
      callCallable(
        'sendTaxReceipt',
        { givingId: 'giving-resend-fail' },
        { uid: 'priest-1', email: 'priest@example.com' }
      ),
      'internal'
    );

    const [receiptSnap, givingSnap, eventsSnap] = await Promise.all([
      adminDb.doc('taxReceipts/giving-resend-fail').get(),
      adminDb.doc('giving/giving-resend-fail').get(),
      adminDb
        .collection('taxReceiptEvents')
        .where('receiptId', '==', 'giving-resend-fail')
        .get(),
    ]);
    expect(receiptSnap.data()).toMatchObject({
      status: 'sent',
      emailError: 'tax_receipt_preparation_failed',
    });
    expect(givingSnap.data()).toMatchObject({
      taxReceiptStatus: 'sent',
      taxReceiptEmailError: 'tax_receipt_preparation_failed',
    });
    expect(givingSnap.data()).not.toHaveProperty('taxReceiptError');
    expect(eventsSnap.docs.map((doc) => doc.data())).toEqual([
      expect.objectContaining({
        action: 'email_failed',
        actorUid: 'priest-1',
        churchId: CHURCH_ID,
        userId: 'member-1',
        givingId: 'giving-resend-fail',
        kind: 'single',
        receiptYear: 2026,
        errorCode: 'tax_receipt_preparation_failed',
      }),
    ]);
  });

  it('fails closed before emailing when an existing single receipt no longer matches the donation owner', async () => {
    await Promise.all([
      adminDb.doc('giving/giving-resend-owner-mismatch').set({
        churchId: CHURCH_ID,
        churchName: 'St. Nicholas',
        userId: 'member-1',
        donorName: 'Member One',
        donorEmail: '',
        anonymous: false,
        churchReceiptVisible: true,
        donorNamePublicSafe: true,
        receiptManagerGivingSafeVersion: 1,
        amount: 10,
        amountCents: 1000,
        currency: 'USD',
        purpose: 'General Fund',
        status: 'completed',
        taxReceiptId: 'giving-resend-owner-mismatch',
        taxReceiptNumber: 'STN-000101',
        taxReceiptStatus: 'sent',
        completedAt: Timestamp.fromDate(new Date('2026-05-24T16:00:00Z')),
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }),
      adminDb.doc('taxReceipts/giving-resend-owner-mismatch').set({
        churchId: CHURCH_ID,
        churchName: 'St. Nicholas',
        userId: 'other-1',
        givingId: 'giving-resend-owner-mismatch',
        kind: 'single',
        status: 'sent',
        jurisdiction: 'US',
        receiptNumber: 'STN-000101',
        receiptYear: 2026,
        organizationName: 'St. Nicholas Orthodox Church',
        donorName: 'Other Donor',
        donorEmail: 'other@example.com',
        amountCents: 1000,
        eligibleAmountCents: 1000,
        currency: 'USD',
        purpose: 'General Fund',
        receivedDateLabel: 'May 24, 2026',
        issuedDateLabel: 'May 24, 2026',
        goodsServicesStatement:
          'No goods or services were provided in exchange for this contribution other than intangible religious benefits.',
        emailSentAt: Timestamp.fromDate(new Date('2026-05-24T17:00:00Z')),
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }),
    ]);

    await expectCallableFails(
      callCallable(
        'sendTaxReceipt',
        { givingId: 'giving-resend-owner-mismatch' },
        { uid: 'priest-1', email: 'priest@example.com' }
      ),
      'failed-precondition'
    );

    const [receiptSnap, givingSnap, eventsSnap] = await Promise.all([
      adminDb.doc('taxReceipts/giving-resend-owner-mismatch').get(),
      adminDb.doc('giving/giving-resend-owner-mismatch').get(),
      adminDb
        .collection('taxReceiptEvents')
        .where('receiptId', '==', 'giving-resend-owner-mismatch')
        .get(),
    ]);
    expect(receiptSnap.data()).toMatchObject({
      status: 'sent',
      userId: 'other-1',
      donorEmail: 'other@example.com',
    });
    expect(receiptSnap.data()).not.toHaveProperty('emailSendingAt');
    expect(receiptSnap.data()).not.toHaveProperty('emailError');
    expect(givingSnap.data()).toMatchObject({
      taxReceiptStatus: 'sent',
      taxReceiptId: 'giving-resend-owner-mismatch',
    });
    expect(givingSnap.data()).not.toHaveProperty('taxReceiptEmailError');
    expect(eventsSnap.empty).toBe(true);
  });

  it('fails closed before downloading when a stored single receipt no longer matches the donation owner', async () => {
    await Promise.all([
      adminDb.doc('giving/giving-download-owner-mismatch').set({
        churchId: CHURCH_ID,
        churchName: 'St. Nicholas',
        userId: 'other-1',
        donorName: 'Other One',
        donorEmail: 'other@example.com',
        anonymous: false,
        amount: 10,
        amountCents: 1000,
        currency: 'USD',
        purpose: 'General Fund',
        status: 'completed',
        taxReceiptId: 'giving-download-owner-mismatch',
        taxReceiptNumber: 'STN-000102',
        taxReceiptStatus: 'sent',
        completedAt: Timestamp.fromDate(new Date('2026-05-24T16:00:00Z')),
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }),
      adminDb.doc('taxReceipts/giving-download-owner-mismatch').set({
        churchId: CHURCH_ID,
        churchName: 'St. Nicholas',
        userId: 'member-1',
        givingId: 'giving-download-owner-mismatch',
        kind: 'single',
        status: 'sent',
        jurisdiction: 'US',
        receiptNumber: 'STN-000102',
        receiptYear: 2026,
        organizationName: 'St. Nicholas Orthodox Church',
        donorName: 'Member One',
        donorEmail: 'member@example.com',
        amountCents: 1000,
        eligibleAmountCents: 1000,
        currency: 'USD',
        purpose: 'General Fund',
        receivedDateLabel: 'May 24, 2026',
        issuedDateLabel: 'May 24, 2026',
        goodsServicesStatement:
          'No goods or services were provided in exchange for this contribution other than intangible religious benefits.',
        emailSentAt: Timestamp.fromDate(new Date('2026-05-24T17:00:00Z')),
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }),
    ]);

    await expectCallableFails(
      callCallable(
        'downloadTaxReceiptPdf',
        { receiptId: 'giving-download-owner-mismatch' },
        { uid: 'member-1', email: 'member@example.com' }
      ),
      'failed-precondition'
    );

    const [receiptSnap, eventsSnap] = await Promise.all([
      adminDb.doc('taxReceipts/giving-download-owner-mismatch').get(),
      adminDb
        .collection('taxReceiptEvents')
        .where('receiptId', '==', 'giving-download-owner-mismatch')
        .get(),
    ]);
    expect(receiptSnap.data()).toMatchObject({
      status: 'sent',
      userId: 'member-1',
      donorEmail: 'member@example.com',
    });
    expect(receiptSnap.data()).not.toHaveProperty('pdfStoragePath');
    expect(receiptSnap.data()).not.toHaveProperty('pdfSha256');
    expect(eventsSnap.empty).toBe(true);
  });

  it('blocks email resends for voided or review-required tax receipts', async () => {
    const voidedAnnualYear = CLOSED_ANNUAL_YEAR;
    const reviewAnnualYear = CLOSED_ANNUAL_YEAR - 1;
    const voidedAnnualReceiptId = annualTaxReceiptDocId(CHURCH_ID, 'member-1', voidedAnnualYear);
    const reviewAnnualReceiptId = annualTaxReceiptDocId(CHURCH_ID, 'member-1', reviewAnnualYear);

    await Promise.all([
      adminDb.doc('giving/giving-voided-resend').set({
        churchId: CHURCH_ID,
        churchName: 'St. Nicholas',
        userId: 'member-1',
        donorName: 'Member One',
        donorEmail: 'member@example.com',
        anonymous: false,
        amount: 10,
        amountCents: 1000,
        currency: 'USD',
        purpose: 'General Fund',
        status: 'completed',
        taxReceiptId: 'giving-voided-resend',
        taxReceiptNumber: 'STN-000102',
        taxReceiptStatus: 'voided',
        completedAt: Timestamp.fromDate(new Date('2026-05-24T16:00:00Z')),
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }),
      adminDb.doc('taxReceipts/giving-voided-resend').set({
        churchId: CHURCH_ID,
        churchName: 'St. Nicholas',
        userId: 'member-1',
        givingId: 'giving-voided-resend',
        kind: 'single',
        status: 'voided',
        jurisdiction: 'US',
        receiptNumber: 'STN-000102',
        receiptYear: 2026,
        organizationName: 'St. Nicholas Orthodox Church',
        donorName: 'Member One',
        donorEmail: 'member@example.com',
        amountCents: 1000,
        eligibleAmountCents: 1000,
        currency: 'USD',
        purpose: 'General Fund',
        receivedDateLabel: 'May 24, 2026',
        issuedDateLabel: 'May 24, 2026',
        goodsServicesStatement:
          'No goods or services were provided in exchange for this contribution other than intangible religious benefits.',
        voidReason: 'stripe_full_refund',
        voidedAt: FieldValue.serverTimestamp(),
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }),
      adminDb.doc('giving/giving-review-resend').set({
        churchId: CHURCH_ID,
        churchName: 'St. Nicholas',
        userId: 'member-1',
        donorName: 'Member One',
        donorEmail: 'member@example.com',
        anonymous: false,
        amount: 20,
        amountCents: 2000,
        currency: 'USD',
        purpose: 'General Fund',
        status: 'completed',
        taxReceiptId: 'giving-review-resend',
        taxReceiptNumber: 'STN-000103',
        taxReceiptStatus: 'error',
        taxReceiptCorrectionRequired: true,
        taxReceiptCorrectionReason: 'stripe_partial_refund_review_required',
        completedAt: Timestamp.fromDate(new Date('2026-05-25T16:00:00Z')),
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }),
      adminDb.doc('taxReceipts/giving-review-resend').set({
        churchId: CHURCH_ID,
        churchName: 'St. Nicholas',
        userId: 'member-1',
        givingId: 'giving-review-resend',
        kind: 'single',
        status: 'error',
        jurisdiction: 'US',
        receiptNumber: 'STN-000103',
        receiptYear: 2026,
        organizationName: 'St. Nicholas Orthodox Church',
        donorName: 'Member One',
        donorEmail: 'member@example.com',
        amountCents: 2000,
        eligibleAmountCents: 2000,
        currency: 'USD',
        purpose: 'General Fund',
        receivedDateLabel: 'May 25, 2026',
        issuedDateLabel: 'May 25, 2026',
        goodsServicesStatement:
          'No goods or services were provided in exchange for this contribution other than intangible religious benefits.',
        correctionRequired: true,
        correctionReason: 'stripe_partial_refund_review_required',
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }),
      adminDb.doc(`taxReceipts/${voidedAnnualReceiptId}`).set({
        churchId: CHURCH_ID,
        churchName: 'St. Nicholas',
        userId: 'member-1',
        givingIds: ['annual-voided-resend-giving'],
        kind: 'annual',
        status: 'voided',
        jurisdiction: 'US',
        receiptNumber: expectedReceiptNumber(voidedAnnualYear, 102),
        receiptYear: voidedAnnualYear,
        annualYear: voidedAnnualYear,
        organizationName: 'St. Nicholas Orthodox Church',
        donorName: 'Member One',
        donorLabel: 'Member One',
        donorAnonymous: false,
        donorEmail: 'member@example.com',
        amountCents: 3000,
        eligibleAmountCents: 3000,
        currency: 'USD',
        purpose: 'Annual Giving',
        donationCount: 1,
        coveredPeriodLabel: `${voidedAnnualYear}`,
        issuedDateLabel: 'January 15, 2026',
        goodsServicesStatement:
          'No goods or services were provided in exchange for this contribution other than intangible religious benefits.',
        voidReason: 'stripe_full_refund',
        voidedAt: FieldValue.serverTimestamp(),
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }),
      adminDb.doc(`taxReceipts/${reviewAnnualReceiptId}`).set({
        churchId: CHURCH_ID,
        churchName: 'St. Nicholas',
        userId: 'member-1',
        givingIds: ['annual-review-resend-giving'],
        kind: 'annual',
        status: 'error',
        jurisdiction: 'US',
        receiptNumber: expectedReceiptNumber(reviewAnnualYear, 103),
        receiptYear: reviewAnnualYear,
        annualYear: reviewAnnualYear,
        organizationName: 'St. Nicholas Orthodox Church',
        donorName: 'Member One',
        donorLabel: 'Member One',
        donorAnonymous: false,
        donorEmail: 'member@example.com',
        amountCents: 4000,
        eligibleAmountCents: 4000,
        currency: 'USD',
        purpose: 'Annual Giving',
        donationCount: 1,
        coveredPeriodLabel: `${reviewAnnualYear}`,
        issuedDateLabel: 'January 15, 2026',
        goodsServicesStatement:
          'No goods or services were provided in exchange for this contribution other than intangible religious benefits.',
        correctionRequired: true,
        correctionReason: 'stripe_partial_refund_review_required',
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }),
    ]);

    await expectCallableFails(
      callCallable(
        'sendTaxReceipt',
        { givingId: 'giving-voided-resend' },
        { uid: 'member-1', email: 'member@example.com' }
      ),
      'failed-precondition'
    );
    await expectCallableFails(
      callCallable(
        'sendTaxReceipt',
        { givingId: 'giving-review-resend' },
        { uid: 'member-1', email: 'member@example.com' }
      ),
      'failed-precondition'
    );
    await expectCallableFails(
      callCallable(
        'sendAnnualTaxReceipt',
        { churchId: CHURCH_ID, year: voidedAnnualYear },
        { uid: 'member-1', email: 'member@example.com' }
      ),
      'failed-precondition'
    );
    await expectCallableFails(
      callCallable(
        'sendAnnualTaxReceipt',
        { churchId: CHURCH_ID, year: reviewAnnualYear },
        { uid: 'member-1', email: 'member@example.com' }
      ),
      'failed-precondition'
    );

    const [
      voidedReceiptSnap,
      reviewReceiptSnap,
      voidedAnnualReceiptSnap,
      reviewAnnualReceiptSnap,
    ] = await Promise.all([
      adminDb.doc('taxReceipts/giving-voided-resend').get(),
      adminDb.doc('taxReceipts/giving-review-resend').get(),
      adminDb.doc(`taxReceipts/${voidedAnnualReceiptId}`).get(),
      adminDb.doc(`taxReceipts/${reviewAnnualReceiptId}`).get(),
    ]);
    expect(voidedReceiptSnap.data()).toMatchObject({
      status: 'voided',
      voidReason: 'stripe_full_refund',
    });
    expect(reviewReceiptSnap.data()).toMatchObject({
      status: 'error',
      correctionRequired: true,
      correctionReason: 'stripe_partial_refund_review_required',
    });
    expect(voidedAnnualReceiptSnap.data()).toMatchObject({
      status: 'voided',
      voidReason: 'stripe_full_refund',
    });
    expect(reviewAnnualReceiptSnap.data()).toMatchObject({
      status: 'error',
      correctionRequired: true,
      correctionReason: 'stripe_partial_refund_review_required',
    });
    expect(voidedReceiptSnap.data()).not.toHaveProperty('emailSendingAt');
    expect(reviewReceiptSnap.data()).not.toHaveProperty('emailSendingAt');
    expect(voidedAnnualReceiptSnap.data()).not.toHaveProperty('emailSendingAt');
    expect(reviewAnnualReceiptSnap.data()).not.toHaveProperty('emailSendingAt');
    expect(voidedReceiptSnap.data()).not.toHaveProperty('emailSentAt');
    expect(reviewReceiptSnap.data()).not.toHaveProperty('emailSentAt');
    expect(voidedAnnualReceiptSnap.data()).not.toHaveProperty('emailSentAt');
    expect(reviewAnnualReceiptSnap.data()).not.toHaveProperty('emailSentAt');
  });

  it('voids stale fully refunded stored receipts before resend or donor PDF download', async () => {
    const annualReceiptId = annualTaxReceiptDocId(CHURCH_ID, 'member-1', CLOSED_ANNUAL_YEAR);
    await Promise.all([
      adminDb.doc('giving/giving-stale-full-resend').set({
        churchId: CHURCH_ID,
        churchName: 'St. Nicholas',
        userId: 'member-1',
        donorName: 'Member One',
        donorEmail: '',
        anonymous: false,
        amount: 50,
        amountCents: 5000,
        currency: 'USD',
        purpose: 'General Fund',
        status: 'refunded',
        stripeRefundStatus: 'refunded',
        stripeAmountRefundedCents: 5000,
        taxReceiptId: 'giving-stale-full-resend',
        taxReceiptNumber: expectedReceiptNumber(2026, 104),
        taxReceiptStatus: 'sent',
        completedAt: Timestamp.fromDate(new Date('2026-05-24T16:00:00Z')),
        refundedAt: Timestamp.fromDate(new Date('2026-06-01T16:00:00Z')),
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }),
      adminDb.doc('taxReceipts/giving-stale-full-resend').set({
        churchId: CHURCH_ID,
        churchName: 'St. Nicholas',
        userId: 'member-1',
        givingId: 'giving-stale-full-resend',
        kind: 'single',
        status: 'sent',
        jurisdiction: 'US',
        receiptNumber: expectedReceiptNumber(2026, 104),
        receiptYear: 2026,
        organizationName: 'St. Nicholas Orthodox Church',
        donorName: 'Member One',
        donorEmail: 'member@example.com',
        amountCents: 5000,
        eligibleAmountCents: 5000,
        currency: 'USD',
        purpose: 'General Fund',
        receivedDateLabel: 'May 24, 2026',
        issuedDateLabel: 'May 24, 2026',
        goodsServicesStatement:
          'No goods or services were provided in exchange for this contribution other than intangible religious benefits.',
        emailSentAt: Timestamp.fromDate(new Date('2026-05-24T16:05:00Z')),
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }),
      adminDb.doc('giving/annual-stale-full-download').set({
        churchId: CHURCH_ID,
        churchName: 'St. Nicholas',
        userId: 'member-1',
        donorName: 'Member One',
        donorEmail: '',
        anonymous: false,
        amount: 75,
        amountCents: 7500,
        currency: 'USD',
        purpose: 'Building Fund',
        status: 'refunded',
        stripeRefundStatus: 'refunded',
        stripeAmountRefundedCents: 7500,
        completedAt: Timestamp.fromDate(new Date(`${CLOSED_ANNUAL_YEAR}-07-15T16:00:00Z`)),
        refundedAt: Timestamp.fromDate(new Date(`${CLOSED_ANNUAL_YEAR + 1}-02-01T16:00:00Z`)),
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }),
      adminDb.doc(`taxReceipts/${annualReceiptId}`).set({
        churchId: CHURCH_ID,
        churchName: 'St. Nicholas',
        userId: 'member-1',
        givingId: '',
        givingIds: ['annual-stale-full-download'],
        kind: 'annual',
        status: 'sent',
        jurisdiction: 'US',
        receiptNumber: expectedReceiptNumber(CLOSED_ANNUAL_YEAR, 104),
        receiptYear: CLOSED_ANNUAL_YEAR,
        annualYear: CLOSED_ANNUAL_YEAR,
        organizationName: 'St. Nicholas Orthodox Church',
        donorLabel: 'Member One',
        donorAnonymous: false,
        donorName: 'Member One',
        donorEmail: 'member@example.com',
        amountCents: 7500,
        eligibleAmountCents: 7500,
        currency: 'USD',
        purpose: 'Annual giving summary',
        donationCount: 1,
        receivedDateLabel: `January 1 - December 31, ${CLOSED_ANNUAL_YEAR}`,
        coveredPeriodLabel: `January 1 - December 31, ${CLOSED_ANNUAL_YEAR}`,
        issuedAt: Timestamp.fromDate(new Date(`${CLOSED_ANNUAL_YEAR + 1}-01-15T12:00:00Z`)),
        issuedDateLabel: `January 15, ${CLOSED_ANNUAL_YEAR + 1}`,
        goodsServicesStatement:
          'No goods or services were provided in exchange for this contribution other than intangible religious benefits.',
        emailSentAt: Timestamp.fromDate(new Date(`${CLOSED_ANNUAL_YEAR + 1}-01-15T12:05:00Z`)),
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }),
      adminDb.doc(`taxReceiptSummaries/${annualReceiptId}`).set({
        receiptId: annualReceiptId,
        churchId: CHURCH_ID,
        userId: 'member-1',
        donorLabel: 'Member One',
        donorAnonymous: false,
        kind: 'annual',
        status: 'sent',
        receiptNumber: expectedReceiptNumber(CLOSED_ANNUAL_YEAR, 104),
        receiptYear: CLOSED_ANNUAL_YEAR,
        annualYear: CLOSED_ANNUAL_YEAR,
        amountCents: 7500,
        eligibleAmountCents: 7500,
        currency: 'USD',
        donationCount: 1,
        issuedAt: Timestamp.fromDate(new Date(`${CLOSED_ANNUAL_YEAR + 1}-01-15T12:00:00Z`)),
        emailSentAt: Timestamp.fromDate(new Date(`${CLOSED_ANNUAL_YEAR + 1}-01-15T12:05:00Z`)),
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }),
    ]);

    await expectCallableFails(
      callCallable(
        'sendTaxReceipt',
        { givingId: 'giving-stale-full-resend' },
        { uid: 'member-1', email: 'member@example.com' }
      ),
      'failed-precondition'
    );
    await expectCallableFails(
      callCallable(
        'downloadTaxReceiptPdf',
        { receiptId: annualReceiptId },
        { uid: 'member-1', email: 'member@example.com' }
      ),
      'failed-precondition'
    );

    const [singleGivingSnap, singleReceiptSnap, annualReceiptSnap, annualSummarySnap] = await Promise.all([
      adminDb.doc('giving/giving-stale-full-resend').get(),
      adminDb.doc('taxReceipts/giving-stale-full-resend').get(),
      adminDb.doc(`taxReceipts/${annualReceiptId}`).get(),
      adminDb.doc(`taxReceiptSummaries/${annualReceiptId}`).get(),
    ]);
    expect(singleGivingSnap.data()).toMatchObject({
      taxReceiptStatus: 'voided',
      taxReceiptVoidReason: 'stripe_full_refund',
    });
    expect(singleReceiptSnap.data()).toMatchObject({
      status: 'voided',
      voidReason: 'stripe_full_refund',
      voidedBy: 'system',
    });
    expect(annualReceiptSnap.data()).toMatchObject({
      status: 'voided',
      voidReason: 'stripe_full_refund',
      voidedBy: 'system',
    });
    expect(annualSummarySnap.data()).toMatchObject({
      status: 'voided',
      voidReason: 'stripe_full_refund',
    });
    expect(singleReceiptSnap.data()).not.toHaveProperty('emailSendingAt');
    expect(annualReceiptSnap.data()).not.toHaveProperty('emailSendingAt');

    const events = await adminDb
      .collection('taxReceiptEvents')
      .where('receiptId', 'in', ['giving-stale-full-resend', annualReceiptId])
      .get();
    expect(events.docs.map((doc) => doc.data())).toEqual(expect.arrayContaining([
      expect.objectContaining({
        action: 'voided',
        receiptId: 'giving-stale-full-resend',
        reasonCode: 'stripe_full_refund',
      }),
      expect.objectContaining({
        action: 'voided',
        receiptId: annualReceiptId,
        reasonCode: 'stripe_full_refund',
      }),
    ]));
  });

  it('marks stale partially refunded single receipts review-required before resend', async () => {
    await Promise.all([
      adminDb.doc('giving/giving-stale-partial-resend').set({
        churchId: CHURCH_ID,
        churchName: 'St. Nicholas',
        userId: 'member-1',
        donorName: 'Member One',
        donorEmail: '',
        anonymous: false,
        amount: 60,
        amountCents: 6000,
        currency: 'USD',
        purpose: 'General Fund',
        status: 'completed',
        stripeRefundStatus: 'partially_refunded',
        stripeAmountRefundedCents: 1500,
        taxReceiptId: 'giving-stale-partial-resend',
        taxReceiptNumber: expectedReceiptNumber(2026, 105),
        taxReceiptStatus: 'sent',
        completedAt: Timestamp.fromDate(new Date('2026-05-24T16:00:00Z')),
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }),
      adminDb.doc('taxReceipts/giving-stale-partial-resend').set({
        churchId: CHURCH_ID,
        churchName: 'St. Nicholas',
        userId: 'member-1',
        givingId: 'giving-stale-partial-resend',
        kind: 'single',
        status: 'sent',
        jurisdiction: 'US',
        receiptNumber: expectedReceiptNumber(2026, 105),
        receiptYear: 2026,
        organizationName: 'St. Nicholas Orthodox Church',
        donorName: 'Member One',
        donorEmail: 'member@example.com',
        amountCents: 6000,
        eligibleAmountCents: 6000,
        currency: 'USD',
        purpose: 'General Fund',
        receivedDateLabel: 'May 24, 2026',
        issuedDateLabel: 'May 24, 2026',
        goodsServicesStatement:
          'No goods or services were provided in exchange for this contribution other than intangible religious benefits.',
        emailSentAt: Timestamp.fromDate(new Date('2026-05-24T16:05:00Z')),
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }),
    ]);

    await expectCallableFails(
      callCallable(
        'sendTaxReceipt',
        { givingId: 'giving-stale-partial-resend' },
        { uid: 'member-1', email: 'member@example.com' }
      ),
      'failed-precondition'
    );

    const [givingSnap, receiptSnap, eventsSnap] = await Promise.all([
      adminDb.doc('giving/giving-stale-partial-resend').get(),
      adminDb.doc('taxReceipts/giving-stale-partial-resend').get(),
      adminDb
        .collection('taxReceiptEvents')
        .where('receiptId', '==', 'giving-stale-partial-resend')
        .get(),
    ]);
    expect(givingSnap.data()).toMatchObject({
      taxReceiptStatus: 'error',
      taxReceiptError: 'stripe_partial_refund_review_required',
      taxReceiptCorrectionRequired: true,
      taxReceiptCorrectionReason: 'stripe_partial_refund_review_required',
    });
    expect(receiptSnap.data()).toMatchObject({
      status: 'error',
      correctionRequired: true,
      correctionReason: 'stripe_partial_refund_review_required',
    });
    expect(receiptSnap.data()).not.toHaveProperty('emailSendingAt');
    expect(eventsSnap.docs.map((doc) => doc.data())).toEqual(expect.arrayContaining([
      expect.objectContaining({
        action: 'review_required',
        receiptId: 'giving-stale-partial-resend',
        reasonCode: 'stripe_partial_refund_review_required',
      }),
    ]));
  });

  it('reuses stale tax receipt email send attempt ids for provider idempotency', async () => {
    await Promise.all([
      adminDb.doc('giving/giving-email-claim').set({
        churchId: CHURCH_ID,
        churchName: 'St. Nicholas',
        userId: 'member-1',
        donorName: 'Member One',
        donorEmail: '',
        amount: 10,
        amountCents: 1000,
        currency: 'USD',
        purpose: 'General Fund',
        status: 'completed',
        taxReceiptId: 'giving-email-claim',
        taxReceiptNumber: 'STN-000101',
        taxReceiptStatus: 'issued',
        completedAt: Timestamp.fromDate(new Date('2026-05-24T16:00:00Z')),
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }),
      adminDb.doc('taxReceipts/giving-email-claim').set({
        churchId: CHURCH_ID,
        churchName: 'St. Nicholas',
        userId: 'member-1',
        givingId: 'giving-email-claim',
        kind: 'single',
        status: 'issued',
        jurisdiction: 'US',
        receiptNumber: 'STN-000101',
        receiptYear: 2026,
        organizationName: 'St. Nicholas Orthodox Church',
        donorName: 'Member One',
        donorEmail: 'member@example.com',
        amountCents: 1000,
        eligibleAmountCents: 1000,
        currency: 'USD',
        purpose: 'General Fund',
        receivedDateLabel: 'May 24, 2026',
        issuedDateLabel: 'May 24, 2026',
        goodsServicesStatement:
          'No goods or services were provided in exchange for this contribution other than intangible religious benefits.',
        emailSendingAt: Timestamp.fromDate(new Date()),
        emailSendAttemptId: 'active-claim-attempt-20260524',
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }),
    ]);

    await expectCallableFails(
      callCallable(
        'sendTaxReceipt',
        { givingId: 'giving-email-claim' },
        { uid: 'member-1', email: 'member@example.com' }
      ),
      'aborted'
    );
    let receiptSnap = await adminDb.doc('taxReceipts/giving-email-claim').get();
    expect(receiptSnap.data()).toMatchObject({
      status: 'issued',
    });
    expect(receiptSnap.data()?.emailSendingAt).toBeInstanceOf(Timestamp);
    expect(receiptSnap.data()?.emailSendAttemptId).toBe('active-claim-attempt-20260524');
    expect(receiptSnap.data()).not.toHaveProperty('emailSentAt');

    await adminDb.doc('taxReceipts/giving-email-claim').update({
      emailSendingAt: Timestamp.fromDate(new Date(Date.now() - 20 * 60 * 1000)),
    });
    await expect(
      callCallable(
        'sendTaxReceipt',
        { givingId: 'giving-email-claim' },
        { uid: 'member-1', email: 'member@example.com' }
      )
    ).resolves.toMatchObject({
      success: true,
      receiptId: 'giving-email-claim',
      emailSent: true,
    });

    receiptSnap = await adminDb.doc('taxReceipts/giving-email-claim').get();
    expect(receiptSnap.data()).toMatchObject({
      status: 'sent',
      donorEmail: 'member@example.com',
    });
    expect(receiptSnap.data()).not.toHaveProperty('emailSendingAt');
    expect(receiptSnap.data()).not.toHaveProperty('emailSendAttemptId');
    expect(receiptSnap.data()).toHaveProperty('emailSentAt');
  });

  it('does not expose legacy email-shaped donor names in receipt labels', async () => {
    await adminDb.doc(`churches/${CHURCH_ID}`).update({
      timezone: 'America/Chicago',
      taxReceiptSettings: {
        enabled: true,
        eligibilityConfirmed: true,
        jurisdiction: 'US',
        organizationName: 'St. Nicholas Orthodox Church',
        organizationAddress: '123 Church Street, Chicago, IL',
        taxId: '12-3456789',
        receiptPrefix: 'STN',
        goodsServicesStatement:
          'No goods or services were provided in exchange for this contribution other than intangible religious benefits.',
        autoIssue: false,
      },
    });
    await waitFor(
      async () => (await adminDb.doc('users/member-1').get()).data() ?? null,
      (data) => data?.displayName === 'Member One',
      'member profile bootstrap'
    );
    await Promise.all([
      adminDb.doc('giving/legacy-email-name-single').set({
        churchId: CHURCH_ID,
        churchName: 'St. Nicholas',
        userId: 'member-1',
        donorName: 'Contact member@example.com',
        donorEmail: 'legacy@example.com',
        anonymous: false,
        amount: 75,
        amountCents: 7500,
        currency: 'USD',
        purpose: 'General Fund',
        status: 'completed',
        completedAt: Timestamp.fromDate(new Date('2026-05-24T16:00:00Z')),
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }),
      adminDb.doc('giving/legacy-email-name-annual').set({
        churchId: CHURCH_ID,
        churchName: 'St. Nicholas',
        userId: 'member-1',
        donorName: 'Contact member@example.com',
        donorEmail: 'legacy@example.com',
        anonymous: false,
        amount: 125,
        amountCents: 12500,
        currency: 'USD',
        purpose: 'Building Fund',
        status: 'completed',
        completedAt: Timestamp.fromDate(new Date(`${CLOSED_ANNUAL_YEAR}-05-24T16:00:00Z`)),
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }),
    ]);

    await expect(
      callCallable(
        'sendTaxReceipt',
        { givingId: 'legacy-email-name-single' },
        { uid: 'member-1', email: 'member@example.com' }
      )
    ).resolves.toMatchObject({
      success: true,
      receiptId: 'legacy-email-name-single',
      emailSent: true,
    });

    const [singleReceiptSnap, singleGivingSnap] = await Promise.all([
      adminDb.doc('taxReceipts/legacy-email-name-single').get(),
      adminDb.doc('giving/legacy-email-name-single').get(),
    ]);
    expect(singleReceiptSnap.data()).toMatchObject({
      donorName: 'Member One',
      donorEmail: 'member@example.com',
    });
    expect(singleGivingSnap.data()).toMatchObject({
      donorName: 'Member One',
      donorEmail: '',
      donorNamePublicSafe: true,
      receiptManagerGivingSafeVersion: 1,
      churchReceiptVisible: true,
      taxReceiptStatus: 'sent',
    });
    expect(singleReceiptSnap.data()?.donorName).not.toContain('@');
    expect(singleGivingSnap.data()?.donorName).not.toContain('@');

    const annualResult = await callCallable<
      { churchId: string; year: number },
      { success: boolean; receiptId: string; receiptNumber: string; emailSent: boolean }
    >(
      'sendAnnualTaxReceipt',
      { churchId: CHURCH_ID, year: CLOSED_ANNUAL_YEAR },
      { uid: 'member-1', email: 'member@example.com' }
    );

    expect(annualResult).toMatchObject({
      success: true,
      emailSent: true,
    });
    const [annualReceiptSnap, annualSummarySnap] = await Promise.all([
      adminDb.doc(`taxReceipts/${annualResult.receiptId}`).get(),
      adminDb.doc(`taxReceiptSummaries/${annualResult.receiptId}`).get(),
    ]);
    expect(annualReceiptSnap.data()).toMatchObject({
      donorLabel: 'Member One',
      donorAnonymous: false,
      donorName: 'Member One',
      donorEmail: 'member@example.com',
    });
    expect(annualSummarySnap.data()).toMatchObject({
      donorLabel: 'Anonymous donor',
      donorAnonymous: true,
      churchReceiptVisible: false,
      donorLabelPublicSafe: false,
      receiptManagerSummarySafe: false,
      receiptManagerSummarySafeVersion: 0,
    });
    expect(annualReceiptSnap.data()?.donorLabel).not.toContain('@');
    expect(annualReceiptSnap.data()?.donorName).not.toContain('@');
    expect(annualSummarySnap.data()?.donorLabel).not.toContain('@');
    expect(annualSummarySnap.data()).not.toHaveProperty('donorEmail');
    expect(annualSummarySnap.data()).not.toHaveProperty('donorName');
  });

  it('does not use email-shaped profile or membership display names as receipt labels', async () => {
    await adminDb.doc(`churches/${CHURCH_ID}`).update({
      timezone: 'America/Chicago',
      taxReceiptSettings: {
        enabled: true,
        eligibilityConfirmed: true,
        jurisdiction: 'US',
        organizationName: 'St. Nicholas Orthodox Church',
        organizationAddress: '123 Church Street, Chicago, IL',
        taxId: '12-3456789',
        receiptPrefix: 'STN',
        goodsServicesStatement:
          'No goods or services were provided in exchange for this contribution other than intangible religious benefits.',
        autoIssue: false,
      },
    });
    await waitFor(
      async () => (await adminDb.doc('users/member-1').get()).data() ?? null,
      (data) => data?.displayName === 'Member One',
      'member profile bootstrap'
    );
    await Promise.all([
      adminDb.doc('users/member-1').set({ displayName: 'Contact member@example.com' }, { merge: true }),
      adminDb.doc(`churches/${CHURCH_ID}/members/member-1`).set({
        displayName: 'Contact member@example.com',
      }, { merge: true }),
      adminDb.doc('giving/email-display-name-single').set({
        churchId: CHURCH_ID,
        churchName: 'St. Nicholas',
        userId: 'member-1',
        donorName: 'Contact member@example.com',
        donorEmail: 'legacy@example.com',
        anonymous: false,
        amount: 45,
        amountCents: 4500,
        currency: 'USD',
        purpose: 'General Fund',
        status: 'completed',
        completedAt: Timestamp.fromDate(new Date('2026-05-24T16:00:00Z')),
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }),
      adminDb.doc('giving/email-display-name-annual').set({
        churchId: CHURCH_ID,
        churchName: 'St. Nicholas',
        userId: 'member-1',
        donorName: 'Contact member@example.com',
        donorEmail: 'legacy@example.com',
        anonymous: false,
        amount: 85,
        amountCents: 8500,
        currency: 'USD',
        purpose: 'Building Fund',
        status: 'completed',
        completedAt: Timestamp.fromDate(new Date(`${CLOSED_ANNUAL_YEAR}-04-24T16:00:00Z`)),
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }),
    ]);

    await expect(
      callCallable(
        'sendTaxReceipt',
        { givingId: 'email-display-name-single' },
        { uid: 'member-1', email: 'member@example.com' }
      )
    ).resolves.toMatchObject({
      success: true,
      receiptId: 'email-display-name-single',
      emailSent: true,
    });

    const singleReceiptSnap = await adminDb.doc('taxReceipts/email-display-name-single').get();
    const singleGivingSnap = await adminDb.doc('giving/email-display-name-single').get();
    expect(singleReceiptSnap.data()).toMatchObject({
      donorName: 'Member One',
      donorEmail: 'member@example.com',
    });
    expect(singleGivingSnap.data()).toMatchObject({
      donorName: 'Parishioner',
      donorEmail: '',
      donorNamePublicSafe: true,
      receiptManagerGivingSafeVersion: 1,
      churchReceiptVisible: true,
      taxReceiptStatus: 'sent',
    });
    expect(singleReceiptSnap.data()?.donorName).not.toContain('@');
    expect(singleGivingSnap.data()?.donorName).not.toContain('@');

    const annualResult = await callCallable<
      { churchId: string; year: number },
      { success: boolean; receiptId: string; receiptNumber: string; emailSent: boolean }
    >(
      'sendAnnualTaxReceipt',
      { churchId: CHURCH_ID, year: CLOSED_ANNUAL_YEAR },
      { uid: 'member-1', email: 'member@example.com' }
    );
    expect(annualResult).toMatchObject({
      success: true,
      emailSent: true,
    });

    const annualReceiptSnap = await adminDb.doc(`taxReceipts/${annualResult.receiptId}`).get();
    const annualSummarySnap = await adminDb.doc(`taxReceiptSummaries/${annualResult.receiptId}`).get();
    expect(annualReceiptSnap.data()).toMatchObject({
      donorLabel: 'Parishioner',
      donorAnonymous: false,
      donorName: 'Member One',
      donorEmail: 'member@example.com',
    });
    expect(annualSummarySnap.data()).toMatchObject({
      donorLabel: 'Anonymous donor',
      donorAnonymous: true,
      churchReceiptVisible: false,
      donorLabelPublicSafe: false,
      receiptManagerSummarySafe: false,
      receiptManagerSummarySafeVersion: 0,
    });
    expect(annualReceiptSnap.data()?.donorLabel).not.toContain('@');
    expect(annualReceiptSnap.data()?.donorName).not.toContain('@');
    expect(annualSummarySnap.data()?.donorLabel).not.toContain('@');
    expect(annualSummarySnap.data()).not.toHaveProperty('donorEmail');
    expect(annualSummarySnap.data()).not.toHaveProperty('donorName');
  });

  it('does not use reserved anonymous donor labels for explicitly non-anonymous receipt labels', async () => {
    await adminDb.doc(`churches/${CHURCH_ID}`).update({
      timezone: 'America/Chicago',
      taxReceiptSettings: {
        enabled: true,
        eligibilityConfirmed: true,
        jurisdiction: 'US',
        organizationName: 'St. Nicholas Orthodox Church',
        organizationAddress: '123 Church Street, Chicago, IL',
        taxId: '12-3456789',
        receiptPrefix: 'STN',
        goodsServicesStatement:
          'No goods or services were provided in exchange for this contribution other than intangible religious benefits.',
        autoIssue: false,
      },
    });
    await waitFor(
      async () => (await adminDb.doc('users/member-1').get()).data() ?? null,
      (data) => data?.displayName === 'Member One',
      'member profile bootstrap'
    );
    await Promise.all([
      adminDb.doc('giving/reserved-anonymous-label-single').set({
        churchId: CHURCH_ID,
        churchName: 'St. Nicholas',
        userId: 'member-1',
        donorName: 'Anonymous donor',
        donorEmail: 'legacy@example.com',
        anonymous: false,
        amount: 55,
        amountCents: 5500,
        currency: 'USD',
        purpose: 'General Fund',
        status: 'completed',
        completedAt: Timestamp.fromDate(new Date('2026-05-24T16:00:00Z')),
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }),
      adminDb.doc('giving/reserved-anonymous-label-annual').set({
        churchId: CHURCH_ID,
        churchName: 'St. Nicholas',
        userId: 'member-1',
        donorName: 'Anonymous donor',
        donorEmail: 'legacy@example.com',
        donorNamePublicSafe: true,
        churchReceiptVisible: true,
        receiptManagerGivingSafeVersion: 1,
        anonymous: false,
        amount: 95,
        amountCents: 9500,
        currency: 'USD',
        purpose: 'Building Fund',
        status: 'completed',
        completedAt: Timestamp.fromDate(new Date(`${CLOSED_ANNUAL_YEAR}-04-24T16:00:00Z`)),
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }),
    ]);

    await expect(
      callCallable(
        'sendTaxReceipt',
        { givingId: 'reserved-anonymous-label-single' },
        { uid: 'member-1', email: 'member@example.com' }
      )
    ).resolves.toMatchObject({
      success: true,
      receiptId: 'reserved-anonymous-label-single',
      emailSent: true,
    });

    const singleGivingSnap = await adminDb.doc('giving/reserved-anonymous-label-single').get();
    expect(singleGivingSnap.data()).toMatchObject({
      donorName: 'Member One',
      donorEmail: '',
      donorNamePublicSafe: true,
      receiptManagerGivingSafeVersion: 1,
      churchReceiptVisible: true,
      taxReceiptStatus: 'sent',
    });

    const annualResult = await callCallable<
      { churchId: string; year: number },
      { success: boolean; receiptId: string; receiptNumber: string; emailSent: boolean }
    >(
      'sendAnnualTaxReceipt',
      { churchId: CHURCH_ID, year: CLOSED_ANNUAL_YEAR },
      { uid: 'member-1', email: 'member@example.com' }
    );
    expect(annualResult).toMatchObject({
      success: true,
      emailSent: true,
    });

    const annualReceiptSnap = await adminDb.doc(`taxReceipts/${annualResult.receiptId}`).get();
    const annualSummarySnap = await adminDb.doc(`taxReceiptSummaries/${annualResult.receiptId}`).get();
    expect(annualReceiptSnap.data()).toMatchObject({
      donorLabel: 'Member One',
      donorAnonymous: false,
      donorName: 'Member One',
      donorEmail: 'member@example.com',
    });
    expect(annualSummarySnap.data()).toMatchObject({
      donorLabel: 'Anonymous donor',
      donorAnonymous: true,
      churchReceiptVisible: false,
      donorLabelPublicSafe: false,
      receiptManagerSummarySafe: false,
      receiptManagerSummarySafeVersion: 0,
    });
    expect(annualReceiptSnap.data()?.donorLabel).not.toBe('Anonymous donor');
  });

  it('blocks receipt managers from targeted annual sends for rows hidden from the receipt manager', async () => {
    await adminDb.doc(`churches/${CHURCH_ID}`).update({
      timezone: 'America/Chicago',
      taxReceiptSettings: {
        enabled: true,
        eligibilityConfirmed: true,
        jurisdiction: 'US',
        organizationName: 'St. Nicholas Orthodox Church',
        organizationAddress: '123 Church Street, Chicago, IL',
        taxId: '12-3456789',
        receiptPrefix: 'STN',
        goodsServicesStatement:
          'No goods or services were provided in exchange for this contribution other than intangible religious benefits.',
        autoIssue: false,
      },
    });
    await adminDb.doc('giving/annual-target-hidden-staff').set({
      churchId: CHURCH_ID,
      churchName: 'St. Nicholas',
      userId: 'member-1',
      donorName: 'Member One',
      donorEmail: 'legacy-member@example.com',
      churchReceiptVisible: false,
      anonymous: false,
      amount: 85,
      amountCents: 8500,
      currency: 'USD',
      purpose: 'General Fund',
      status: 'completed',
      completedAt: Timestamp.fromDate(new Date(`${CLOSED_ANNUAL_YEAR}-03-12T16:00:00Z`)),
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    await expectCallableFails(
      callCallable(
        'sendAnnualTaxReceipt',
        { churchId: CHURCH_ID, year: CLOSED_ANNUAL_YEAR, userId: 'member-1' },
        { uid: 'priest-1', email: 'priest@example.com' }
      ),
      'permission-denied'
    );
    expect((await adminDb.doc(`taxReceipts/${annualTaxReceiptDocId(CHURCH_ID, 'member-1', CLOSED_ANNUAL_YEAR)}`).get()).exists).toBe(false);
  });

  it('rejects tax receipt issuance until legal receipt details are complete', async () => {
    await adminDb.doc(`churches/${CHURCH_ID}`).update({
      timezone: 'America/Chicago',
      taxReceiptSettings: {
        enabled: true,
        eligibilityConfirmed: true,
        jurisdiction: 'US',
        organizationName: 'St. Nicholas Orthodox Church',
        organizationAddress: '',
        taxId: '',
        receiptPrefix: 'STN',
        goodsServicesStatement:
          'No goods or services were provided in exchange for this contribution other than intangible religious benefits.',
        autoIssue: true,
      },
    });
    await adminDb.doc('giving/giving-tax-incomplete-settings').set({
      churchId: CHURCH_ID,
      churchName: 'St. Nicholas',
      userId: 'member-1',
      donorName: 'Member One',
      donorEmail: 'member@example.com',
      amount: 75,
      amountCents: 7500,
      currency: 'USD',
      purpose: 'General Fund',
      status: 'completed',
      completedAt: Timestamp.fromDate(new Date('2026-05-24T16:00:00Z')),
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    await expect(
      callCallable(
        'sendTaxReceipt',
        { givingId: 'giving-tax-incomplete-settings' },
        { uid: 'member-1', email: 'member@example.com' }
      )
    ).rejects.toMatchObject({
      status: 'FAILED_PRECONDITION',
      body: {
        error: {
          details: {
            errorCode: 'tax_receipt_setup_required',
          },
        },
      },
    });
    expect((await adminDb.doc('taxReceipts/giving-tax-incomplete-settings').get()).exists).toBe(false);
  });

  it('rejects tax receipt issuance until parish receipt eligibility is confirmed', async () => {
    await adminDb.doc(`churches/${CHURCH_ID}`).update({
      timezone: 'America/Chicago',
      taxReceiptSettings: {
        enabled: true,
        jurisdiction: 'US',
        organizationName: 'St. Nicholas Orthodox Church',
        organizationAddress: '123 Church Street, Chicago, IL',
        taxId: '12-3456789',
        receiptPrefix: 'STN',
        goodsServicesStatement: 'No goods or services were provided.',
        autoIssue: true,
      },
    });

    await adminDb.doc('giving/giving-tax-unconfirmed-eligibility').set({
      churchId: CHURCH_ID,
      churchName: 'St. Nicholas',
      userId: 'member-1',
      donorName: 'Member One',
      donorEmail: 'member@example.com',
      amount: 50,
      amountCents: 5000,
      currency: 'USD',
      purpose: 'General Fund',
      anonymous: false,
      recurring: false,
      status: 'completed',
      completedAt: Timestamp.fromDate(new Date('2026-01-05T12:00:00Z')),
      createdAt: Timestamp.fromDate(new Date('2026-01-05T11:00:00Z')),
    });

    await expect(
      callCallable(
        'sendTaxReceipt',
        { givingId: 'giving-tax-unconfirmed-eligibility' },
        { uid: 'member-1', email: 'member@example.com' }
      )
    ).rejects.toMatchObject({
      status: 'FAILED_PRECONDITION',
      body: {
        error: {
          details: {
            errorCode: 'tax_receipt_setup_required',
          },
        },
      },
    });
    expect((await adminDb.doc('taxReceipts/giving-tax-unconfirmed-eligibility').get()).exists).toBe(false);
  });

  it('blocks Canada/CRA receipt issuance until a compliant electronic receipt flow exists', async () => {
    await adminDb.doc(`churches/${CHURCH_ID}`).update({
      timezone: 'America/Edmonton',
      taxReceiptSettings: {
        enabled: true,
        eligibilityConfirmed: true,
        jurisdiction: 'CA',
        organizationName: 'St. Nicholas Orthodox Church',
        organizationAddress: '123 Church Street, Edmonton, AB',
        taxId: '123456789RR0001',
        receiptPrefix: 'STN',
        goodsServicesStatement: 'No advantage was received by the donor.',
        autoIssue: true,
        receiptIssueLocation: 'Edmonton, Alberta',
        authorizedSignerName: 'Fr. Nicholas',
        authorizedSignerTitle: 'Parish Priest',
        secureElectronicSignatureConfigured: true,
        receiptCopiesRetentionConfirmed: true,
      },
    });
    await adminDb.doc('giving/giving-tax-canada').set({
      churchId: CHURCH_ID,
      churchName: 'St. Nicholas',
      userId: 'member-1',
      donorName: 'Member One',
      donorEmail: 'member@example.com',
      amount: 75,
      amountCents: 7500,
      currency: 'CAD',
      purpose: 'General Fund',
      status: 'completed',
      completedAt: Timestamp.fromDate(new Date('2026-05-24T16:00:00Z')),
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    await expectCallableFails(
      callCallable(
        'sendTaxReceipt',
        { givingId: 'giving-tax-canada' },
        { uid: 'member-1', email: 'member@example.com' }
      ),
      'failed-precondition'
    );
    expect((await adminDb.doc('taxReceipts/giving-tax-canada').get()).exists).toBe(false);
  });

  it('blocks legacy Canada/CRA stored receipt email and PDF delivery paths', async () => {
    await Promise.all([
      adminDb.doc('giving/giving-tax-canada-legacy').set({
        churchId: CHURCH_ID,
        churchName: 'St. Nicholas',
        userId: 'member-1',
        donorName: 'Member One',
        donorEmail: '',
        anonymous: false,
        amount: 75,
        amountCents: 7500,
        currency: 'CAD',
        purpose: 'General Fund',
        status: 'completed',
        taxReceiptId: 'giving-tax-canada-legacy',
        taxReceiptNumber: 'STN-2026-000777',
        taxReceiptStatus: 'issued',
        completedAt: Timestamp.fromDate(new Date('2026-05-24T16:00:00Z')),
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }),
      adminDb.doc('taxReceipts/giving-tax-canada-legacy').set({
        churchId: CHURCH_ID,
        churchName: 'St. Nicholas',
        userId: 'member-1',
        givingId: 'giving-tax-canada-legacy',
        kind: 'single',
        status: 'issued',
        jurisdiction: 'CA',
        receiptNumber: 'STN-2026-000777',
        receiptYear: 2026,
        organizationName: 'St. Nicholas Orthodox Church',
        organizationAddress: '123 Church Street, Edmonton, AB',
        organizationTaxId: '123456789RR0001',
        donorName: 'Member One',
        donorAddress: '10 Donor Street, Edmonton, AB T5J 0N3, CA',
        donorEmail: 'member@example.com',
        amountCents: 7500,
        eligibleAmountCents: 7500,
        currency: 'CAD',
        purpose: 'General Fund',
        receivedDateLabel: 'May 24, 2026',
        issuedDateLabel: 'May 24, 2026',
        goodsServicesStatement: 'No advantage was received by the donor.',
        receiptIssueLocation: 'Edmonton, Alberta',
        authorizedSignerName: 'Fr. Nicholas',
        authorizedSignerTitle: 'Parish Priest',
        secureElectronicSignatureConfigured: true,
        receiptCopiesRetentionConfirmed: true,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }),
    ]);

    await expect(
      callCallable(
        'sendTaxReceipt',
        { givingId: 'giving-tax-canada-legacy' },
        { uid: 'member-1', email: 'member@example.com' }
      )
    ).rejects.toMatchObject({
      status: 'FAILED_PRECONDITION',
      body: {
        error: {
          details: {
            errorCode: 'tax_receipt_unsupported_jurisdiction',
          },
        },
      },
    });

    await expect(
      callCallable(
        'downloadTaxReceiptPdf',
        { receiptId: 'giving-tax-canada-legacy' },
        { uid: 'member-1', email: 'member@example.com' }
      )
    ).rejects.toMatchObject({
      status: 'FAILED_PRECONDITION',
      body: {
        error: {
          details: {
            errorCode: 'tax_receipt_unsupported_jurisdiction',
          },
        },
      },
    });

    const [receiptSnap, givingSnap, eventsSnap] = await Promise.all([
      adminDb.doc('taxReceipts/giving-tax-canada-legacy').get(),
      adminDb.doc('giving/giving-tax-canada-legacy').get(),
      adminDb
        .collection('taxReceiptEvents')
        .where('receiptId', '==', 'giving-tax-canada-legacy')
        .get(),
    ]);
    expect(receiptSnap.data()).toMatchObject({
      status: 'error',
      emailError: 'tax_receipt_unsupported_jurisdiction',
    });
    expect(receiptSnap.data()).not.toHaveProperty('emailSentAt');
    expect(receiptSnap.data()).not.toHaveProperty('pdfStoragePath');
    expect(givingSnap.data()).toMatchObject({
      taxReceiptStatus: 'error',
      taxReceiptError: 'tax_receipt_unsupported_jurisdiction',
      taxReceiptEmailError: 'tax_receipt_unsupported_jurisdiction',
    });
    expect(eventsSnap.docs.map((doc) => doc.data())).toEqual([
      expect.objectContaining({
        action: 'email_failed',
        actorUid: 'member-1',
        churchId: CHURCH_ID,
        userId: 'member-1',
        givingId: 'giving-tax-canada-legacy',
        kind: 'single',
        receiptYear: 2026,
        errorCode: 'tax_receipt_unsupported_jurisdiction',
      }),
    ]);
  });

  it('blocks stored receipt delivery when the current church receipt setup is Canada/CRA unsupported', async () => {
    await Promise.all([
      adminDb.doc(`churches/${CHURCH_ID}`).update({
        timezone: 'America/Edmonton',
        taxReceiptSettings: {
          enabled: false,
          eligibilityConfirmed: false,
          jurisdiction: 'CA',
          annualPreparationEnabled: false,
          annualAutoEmailEnabled: false,
          receiptIssueLocation: 'Edmonton, Alberta',
          authorizedSignerName: 'Fr. Nicholas',
          authorizedSignerTitle: 'Parish Priest',
          secureElectronicSignatureConfigured: true,
          receiptCopiesRetentionConfirmed: true,
        },
      }),
      adminDb.doc('giving/giving-tax-current-canada-setup').set({
        churchId: CHURCH_ID,
        churchName: 'St. Nicholas',
        userId: 'member-1',
        donorName: 'Member One',
        donorEmail: '',
        anonymous: false,
        amount: 75,
        amountCents: 7500,
        currency: 'USD',
        purpose: 'General Fund',
        status: 'completed',
        taxReceiptId: 'giving-tax-current-canada-setup',
        taxReceiptNumber: 'STN-2026-000778',
        taxReceiptStatus: 'issued',
        completedAt: Timestamp.fromDate(new Date('2026-05-24T16:00:00Z')),
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }),
      adminDb.doc('taxReceipts/giving-tax-current-canada-setup').set({
        churchId: CHURCH_ID,
        churchName: 'St. Nicholas',
        userId: 'member-1',
        givingId: 'giving-tax-current-canada-setup',
        kind: 'single',
        status: 'issued',
        jurisdiction: 'US',
        receiptNumber: 'STN-2026-000778',
        receiptYear: 2026,
        organizationName: 'St. Nicholas Orthodox Church',
        organizationAddress: '123 Church Street, Chicago, IL',
        organizationTaxId: '12-3456789',
        donorName: 'Member One',
        donorAddress: '10 Donor Street, Chicago, IL 60601, US',
        donorEmail: 'member@example.com',
        amountCents: 7500,
        eligibleAmountCents: 7500,
        currency: 'USD',
        purpose: 'General Fund',
        receivedDateLabel: 'May 24, 2026',
        issuedDateLabel: 'May 24, 2026',
        goodsServicesStatement:
          'No goods or services were provided in exchange for this contribution other than intangible religious benefits.',
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }),
    ]);

    await expect(
      callCallable(
        'sendTaxReceipt',
        { givingId: 'giving-tax-current-canada-setup' },
        { uid: 'member-1', email: 'member@example.com' }
      )
    ).rejects.toMatchObject({
      status: 'FAILED_PRECONDITION',
      body: {
        error: {
          details: {
            errorCode: 'tax_receipt_unsupported_jurisdiction',
          },
        },
      },
    });

    await expect(
      callCallable(
        'downloadTaxReceiptPdf',
        { receiptId: 'giving-tax-current-canada-setup' },
        { uid: 'member-1', email: 'member@example.com' }
      )
    ).rejects.toMatchObject({
      status: 'FAILED_PRECONDITION',
      body: {
        error: {
          details: {
            errorCode: 'tax_receipt_unsupported_jurisdiction',
          },
        },
      },
    });

    const [receiptSnap, givingSnap, eventsSnap] = await Promise.all([
      adminDb.doc('taxReceipts/giving-tax-current-canada-setup').get(),
      adminDb.doc('giving/giving-tax-current-canada-setup').get(),
      adminDb
        .collection('taxReceiptEvents')
        .where('receiptId', '==', 'giving-tax-current-canada-setup')
        .get(),
    ]);
    expect(receiptSnap.data()).toMatchObject({
      status: 'error',
      jurisdiction: 'US',
      emailError: 'tax_receipt_unsupported_jurisdiction',
    });
    expect(receiptSnap.data()).not.toHaveProperty('emailSentAt');
    expect(receiptSnap.data()).not.toHaveProperty('pdfStoragePath');
    expect(givingSnap.data()).toMatchObject({
      taxReceiptStatus: 'error',
      taxReceiptError: 'tax_receipt_unsupported_jurisdiction',
      taxReceiptEmailError: 'tax_receipt_unsupported_jurisdiction',
    });
    expect(eventsSnap.docs.map((doc) => doc.data())).toEqual([
      expect.objectContaining({
        action: 'email_failed',
        actorUid: 'member-1',
        churchId: CHURCH_ID,
        userId: 'member-1',
        givingId: 'giving-tax-current-canada-setup',
        kind: 'single',
        receiptYear: 2026,
        errorCode: 'tax_receipt_unsupported_jurisdiction',
      }),
    ]);
  });

  it('blocks standard tax receipt issuance for partially refunded donations until corrected', async () => {
    await adminDb.doc(`churches/${CHURCH_ID}`).update({
      timezone: 'America/Chicago',
      taxReceiptSettings: {
        enabled: true,
        eligibilityConfirmed: true,
        jurisdiction: 'US',
        organizationName: 'St. Nicholas Orthodox Church',
        organizationAddress: '123 Church Street, Chicago, IL',
        taxId: '12-3456789',
        receiptPrefix: 'STN',
        goodsServicesStatement:
          'No goods or services were provided in exchange for this contribution other than intangible religious benefits.',
        autoIssue: false,
      },
    });
    await Promise.all([
      adminDb.doc('giving/giving-tax-partial-refund').set({
        churchId: CHURCH_ID,
        churchName: 'St. Nicholas',
        userId: 'member-1',
        donorName: 'Member One',
        donorEmail: '',
        anonymous: false,
        churchReceiptVisible: true,
        donorNamePublicSafe: true,
        receiptManagerGivingSafeVersion: 1,
        amount: 75,
        amountCents: 7500,
        currency: 'USD',
        purpose: 'General Fund',
        status: 'completed',
        stripeRefundStatus: 'partially_refunded',
        stripeAmountRefundedCents: 1000,
        completedAt: Timestamp.fromDate(new Date('2026-05-24T16:00:00Z')),
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }),
      adminDb.doc('giving/annual-tax-partial-refund').set({
        churchId: CHURCH_ID,
        churchName: 'St. Nicholas',
        userId: 'member-1',
        donorName: 'Member One',
        donorEmail: '',
        anonymous: false,
        churchReceiptVisible: true,
        donorNamePublicSafe: true,
        receiptManagerGivingSafeVersion: 1,
        amount: 40,
        amountCents: 4000,
        currency: 'USD',
        purpose: 'General Fund',
        status: 'completed',
        stripeRefundStatus: 'partially_refunded',
        stripeAmountRefundedCents: 500,
        completedAt: Timestamp.fromDate(new Date(`${CLOSED_ANNUAL_YEAR}-02-10T16:00:00Z`)),
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }),
    ]);

    await expectCallableFails(
      callCallable(
        'sendTaxReceipt',
        { givingId: 'giving-tax-partial-refund' },
        { uid: 'member-1', email: 'member@example.com' }
      ),
      'failed-precondition'
    );
    await expectCallableFails(
      callCallable(
        'sendAnnualTaxReceipt',
        { churchId: CHURCH_ID, year: CLOSED_ANNUAL_YEAR },
        { uid: 'member-1', email: 'member@example.com' }
      ),
      'failed-precondition'
    );
    const batchResult = await callCallable<unknown, {
      success: boolean;
      donorCount: number;
      createdCount: number;
      emailSentCount: number;
      skippedCount: number;
      failedCount: number;
      failures: Array<{ code: string; userId?: string }>;
    }>(
      'sendChurchAnnualTaxReceipts',
      { churchId: CHURCH_ID, year: CLOSED_ANNUAL_YEAR },
      { uid: 'priest-1', email: 'priest@example.com' }
    );
    expect(batchResult).toMatchObject({
      success: false,
      donorCount: 1,
      createdCount: 0,
      emailSentCount: 0,
      skippedCount: 0,
      failedCount: 1,
      failures: [
        { code: 'stripe_partial_refund_review_required' },
      ],
    });
    expect(batchResult.failures[0]).not.toHaveProperty('userId');
    expect(JSON.stringify(batchResult)).not.toContain('failed-precondition');

    const receipts = await adminDb.collection('taxReceipts').get();
    expect(receipts.empty).toBe(true);
  });

  it('lets donors and treasurers send corrected single-donation receipts after partial refunds', async () => {
    await adminDb.doc(`churches/${CHURCH_ID}`).update({
      timezone: 'America/Chicago',
      taxReceiptSettings: {
        enabled: true,
        eligibilityConfirmed: true,
        jurisdiction: 'US',
        organizationName: 'St. Nicholas Orthodox Church',
        organizationAddress: '123 Church Street, Chicago, IL',
        taxId: '12-3456789',
        receiptPrefix: 'STN',
        goodsServicesStatement:
          'No goods or services were provided in exchange for this contribution other than intangible religious benefits.',
        autoIssue: false,
      },
    });
    await Promise.all([
      adminDb.doc('taxReceiptCounters/church-1_2026').set({
        churchId: CHURCH_ID,
        year: 2026,
        lastSequence: 10,
        updatedAt: FieldValue.serverTimestamp(),
      }),
      adminDb.doc('giving/giving-partial-corrected').set({
        churchId: CHURCH_ID,
        churchName: 'St. Nicholas',
        userId: 'member-1',
        donorName: 'Member One',
        donorEmail: '',
        anonymous: false,
        churchReceiptVisible: true,
        donorNamePublicSafe: true,
        receiptManagerGivingSafeVersion: 1,
        amount: 75,
        amountCents: 7500,
        currency: 'USD',
        purpose: 'General Fund',
        status: 'completed',
        stripeRefundStatus: 'partially_refunded',
        stripeAmountRefundedCents: 2500,
        taxReceiptId: 'giving-partial-corrected',
        taxReceiptNumber: 'STN-000010',
        taxReceiptStatus: 'error',
        taxReceiptError: 'stripe_partial_refund_review_required',
        taxReceiptCorrectionRequired: true,
        taxReceiptCorrectionReason: 'stripe_partial_refund_review_required',
        completedAt: Timestamp.fromDate(new Date('2026-05-24T16:00:00Z')),
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }),
      adminDb.doc('giving/giving-partial-corrected-anon').set({
        churchId: CHURCH_ID,
        churchName: 'St. Nicholas',
        userId: 'member-1',
        donorName: 'Anonymous donor',
        donorEmail: '',
        anonymous: true,
        amount: 60,
        amountCents: 6000,
        currency: 'USD',
        purpose: 'General Fund',
        status: 'completed',
        stripeRefundStatus: 'partially_refunded',
        stripeAmountRefundedCents: 1000,
        taxReceiptCorrectionRequired: true,
        taxReceiptCorrectionReason: 'stripe_partial_refund_review_required',
        completedAt: Timestamp.fromDate(new Date('2026-05-25T16:00:00Z')),
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }),
      adminDb.doc('giving/giving-partial-corrected-unclassified').set({
        churchId: CHURCH_ID,
        churchName: 'St. Nicholas',
        userId: 'member-1',
        donorName: 'Member One',
        donorEmail: 'member@example.com',
        amount: 65,
        amountCents: 6500,
        currency: 'USD',
        purpose: 'General Fund',
        status: 'completed',
        stripeRefundStatus: 'partially_refunded',
        stripeAmountRefundedCents: 1500,
        taxReceiptCorrectionRequired: true,
        taxReceiptCorrectionReason: 'stripe_partial_refund_review_required',
        completedAt: Timestamp.fromDate(new Date('2026-05-26T16:00:00Z')),
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }),
      adminDb.doc('taxReceipts/giving-partial-corrected').set({
        churchId: CHURCH_ID,
        churchName: 'St. Nicholas',
        userId: 'member-1',
        givingId: 'giving-partial-corrected',
        kind: 'single',
        status: 'error',
        jurisdiction: 'US',
        receiptNumber: 'STN-000010',
        receiptYear: 2026,
        organizationName: 'St. Nicholas Orthodox Church',
        organizationAddress: '123 Church Street, Chicago, IL',
        organizationTaxId: '12-3456789',
        donorName: 'Member One',
        donorEmail: 'member@example.com',
        amountCents: 7500,
        eligibleAmountCents: 7500,
        currency: 'USD',
        purpose: 'General Fund',
        receivedAt: Timestamp.fromDate(new Date('2026-05-24T16:00:00Z')),
        receivedDateLabel: 'May 24, 2026',
        issuedAt: Timestamp.fromDate(new Date('2026-05-24T17:00:00Z')),
        issuedDateLabel: 'May 24, 2026',
        correctionRequired: true,
        correctionReason: 'stripe_partial_refund_review_required',
        goodsServicesStatement:
          'No goods or services were provided in exchange for this contribution other than intangible religious benefits.',
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }),
    ]);

    await expectCallableFails(
      callCallable(
        'sendCorrectedTaxReceipt',
        { givingId: 'giving-partial-corrected-anon' },
        { uid: 'treasurer-1', email: 'treasurer@example.com' }
      ),
      'permission-denied'
    );
    await expectCallableFails(
      callCallable(
        'sendCorrectedTaxReceipt',
        { givingId: 'giving-partial-corrected-unclassified' },
        { uid: 'treasurer-1', email: 'treasurer@example.com' }
      ),
      'permission-denied'
    );
    await expectCallableFails(
      callCallable(
        'sendCorrectedTaxReceipt',
        { givingId: 'giving-partial-corrected' },
        { uid: 'admin-1', email: 'admin@example.com' }
      ),
      'permission-denied'
    );
    expect((await adminDb
      .collection('taxReceipts')
      .where('givingId', '==', 'giving-partial-corrected-unclassified')
      .get()).empty).toBe(true);

    const donorCorrectedAnonymous = await callCallable<
      { givingId: string },
      {
        success: boolean;
        receiptId: string;
        receiptNumber: string;
        created: boolean;
        corrected: boolean;
        emailSent: boolean;
      }
    >(
      'sendCorrectedTaxReceipt',
      { givingId: 'giving-partial-corrected-anon' },
      { uid: 'member-1', email: 'member@example.com' }
    );
    expect(donorCorrectedAnonymous).toMatchObject({
      success: true,
      receiptNumber: expectedReceiptNumber(2026, 11),
      created: true,
      corrected: true,
      emailSent: true,
    });
    expect(donorCorrectedAnonymous.receiptId).toMatch(/^correction_[A-Za-z0-9_-]+$/);
    expect((await adminDb.doc(`taxReceipts/${donorCorrectedAnonymous.receiptId}`).get()).data()).toMatchObject({
      churchId: CHURCH_ID,
      userId: 'member-1',
      givingId: 'giving-partial-corrected-anon',
      status: 'sent',
      receiptNumber: expectedReceiptNumber(2026, 11),
      amountCents: 5000,
      eligibleAmountCents: 5000,
      originalAmountCents: 6000,
      refundedAmountCents: 1000,
      correctionForGivingId: 'giving-partial-corrected-anon',
      correctionSourceReason: 'stripe_partial_refund_corrected_reissue',
    });
    expect((await adminDb.doc('giving/giving-partial-corrected-anon').get()).data()).toMatchObject({
      donorName: 'Anonymous donor',
      donorEmail: '',
      anonymous: true,
      taxReceiptId: donorCorrectedAnonymous.receiptId,
      taxReceiptNumber: expectedReceiptNumber(2026, 11),
      taxReceiptStatus: 'sent',
    });

    const corrected = await callCallable<
      { givingId: string },
      {
        success: boolean;
        receiptId: string;
        receiptNumber: string;
        created: boolean;
        corrected: boolean;
        emailSent: boolean;
      }
    >(
      'sendCorrectedTaxReceipt',
      { givingId: 'giving-partial-corrected' },
      { uid: 'treasurer-1', email: 'treasurer@example.com' }
    );
    expect(corrected).toMatchObject({
      success: true,
      receiptId: '',
      receiptNumber: expectedReceiptNumber(2026, 12),
      created: true,
      corrected: true,
      emailSent: true,
    });

    const [oldReceipt, givingSnap, counterSnap] = await Promise.all([
      adminDb.doc('taxReceipts/giving-partial-corrected').get(),
      adminDb.doc('giving/giving-partial-corrected').get(),
      adminDb.doc('taxReceiptCounters/church-1_2026').get(),
    ]);
    const correctedReceiptId = givingSnap.data()?.taxReceiptId;
    expect(correctedReceiptId).toMatch(/^correction_[A-Za-z0-9_-]+$/);
    const correctedReceipt = await adminDb.doc(`taxReceipts/${correctedReceiptId}`).get();
    expect(oldReceipt.data()).toMatchObject({
      status: 'voided',
      voidReason: 'stripe_partial_refund_corrected_reissue',
      voidedBy: 'treasurer-1',
    });
    expect(correctedReceipt.data()).toMatchObject({
      churchId: CHURCH_ID,
      userId: 'member-1',
      givingId: 'giving-partial-corrected',
      status: 'sent',
      receiptNumber: expectedReceiptNumber(2026, 12),
      amountCents: 5000,
      eligibleAmountCents: 5000,
      originalAmountCents: 7500,
      refundedAmountCents: 2500,
      correctionForGivingId: 'giving-partial-corrected',
      correctionForReceiptId: 'giving-partial-corrected',
      correctionSourceReason: 'stripe_partial_refund_corrected_reissue',
    });
    expect(correctedReceipt.data()).not.toHaveProperty('correctionRequired');
    expect(givingSnap.data()).toMatchObject({
      taxReceiptId: correctedReceiptId,
      taxReceiptNumber: expectedReceiptNumber(2026, 12),
      taxReceiptStatus: 'sent',
    });
    expect(givingSnap.data()).not.toHaveProperty('taxReceiptCorrectionRequired');
    expect(givingSnap.data()).not.toHaveProperty('taxReceiptError');
    expect(counterSnap.data()).toMatchObject({
      lastSequence: 12,
    });

    await expect(
      callCallable(
        'sendTaxReceipt',
        { givingId: 'giving-partial-corrected' },
        { uid: 'treasurer-1', email: 'treasurer@example.com' }
      )
    ).resolves.toMatchObject({
      success: true,
      receiptId: '',
      receiptNumber: expectedReceiptNumber(2026, 12),
      created: false,
      emailSent: true,
    });

    const events = await adminDb
      .collection('taxReceiptEvents')
      .where('receiptId', 'in', ['giving-partial-corrected', correctedReceiptId])
      .get();
    expect(events.docs.map((doc) => doc.data())).toEqual(expect.arrayContaining([
      expect.objectContaining({
        action: 'voided',
        receiptId: 'giving-partial-corrected',
        reasonCode: 'stripe_partial_refund_corrected_reissue',
      }),
      expect.objectContaining({
        action: 'corrected',
        receiptId: correctedReceiptId,
        reasonCode: 'stripe_partial_refund_corrected_reissue',
      }),
      expect.objectContaining({
        action: 'email_sent',
        receiptId: correctedReceiptId,
      }),
    ]));
  });

  it('lets donors and treasurers send corrected annual tax receipts after partial refunds', async () => {
    await adminDb.doc(`churches/${CHURCH_ID}`).update({
      timezone: 'America/Chicago',
      taxReceiptSettings: {
        enabled: true,
        eligibilityConfirmed: true,
        jurisdiction: 'US',
        organizationName: 'St. Nicholas Orthodox Church',
        organizationAddress: '123 Church Street, Chicago, IL',
        taxId: '12-3456789',
        receiptPrefix: 'STN',
        goodsServicesStatement:
          'No goods or services were provided in exchange for this contribution other than intangible religious benefits.',
        autoIssue: false,
      },
    });
    const originalAnnualReceiptId = annualTaxReceiptDocId(CHURCH_ID, 'member-1', CLOSED_ANNUAL_YEAR);
    await Promise.all([
      adminDb.doc(`taxReceiptCounters/church-1_${CLOSED_ANNUAL_YEAR}`).set({
        churchId: CHURCH_ID,
        year: CLOSED_ANNUAL_YEAR,
        lastSequence: 20,
        updatedAt: FieldValue.serverTimestamp(),
      }),
      adminDb.doc('giving/annual-partial-corrected-1').set({
        churchId: CHURCH_ID,
        churchName: 'St. Nicholas',
        userId: 'member-1',
        donorName: 'Member One',
        donorEmail: '',
        anonymous: false,
        churchReceiptVisible: true,
        donorNamePublicSafe: true,
        receiptManagerGivingSafeVersion: 1,
        amount: 100,
        amountCents: 10000,
        currency: 'USD',
        purpose: 'General Fund',
        status: 'completed',
        stripeRefundStatus: 'partially_refunded',
        stripeAmountRefundedCents: 3000,
        taxReceiptCorrectionRequired: true,
        taxReceiptCorrectionReason: 'stripe_partial_refund_review_required',
        completedAt: Timestamp.fromDate(new Date(`${CLOSED_ANNUAL_YEAR}-03-10T16:00:00Z`)),
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }),
      adminDb.doc('giving/annual-partial-corrected-2').set({
        churchId: CHURCH_ID,
        churchName: 'St. Nicholas',
        userId: 'member-1',
        donorName: 'Member One',
        donorEmail: '',
        anonymous: false,
        churchReceiptVisible: true,
        donorNamePublicSafe: true,
        receiptManagerGivingSafeVersion: 1,
        amount: 25,
        amountCents: 2500,
        currency: 'USD',
        purpose: 'Building Fund',
        status: 'completed',
        completedAt: Timestamp.fromDate(new Date(`${CLOSED_ANNUAL_YEAR}-11-20T16:00:00Z`)),
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }),
      adminDb.doc('giving/annual-partial-corrected-anon').set({
        churchId: CHURCH_ID,
        churchName: 'St. Nicholas',
        userId: 'invitee-1',
        donorName: 'Anonymous donor',
        donorEmail: '',
        anonymous: true,
        amount: 45,
        amountCents: 4500,
        currency: 'USD',
        purpose: 'General Fund',
        status: 'completed',
        stripeRefundStatus: 'partially_refunded',
        stripeAmountRefundedCents: 1000,
        taxReceiptCorrectionRequired: true,
        taxReceiptCorrectionReason: 'stripe_partial_refund_review_required',
        completedAt: Timestamp.fromDate(new Date(`${CLOSED_ANNUAL_YEAR}-04-10T16:00:00Z`)),
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }),
      adminDb.doc(`taxReceipts/${originalAnnualReceiptId}`).set({
        churchId: CHURCH_ID,
        churchName: 'St. Nicholas',
        userId: 'member-1',
        givingId: '',
        givingIds: ['annual-partial-corrected-1', 'annual-partial-corrected-2'],
        kind: 'annual',
        status: 'error',
        jurisdiction: 'US',
        receiptNumber: 'STN-000020',
        receiptYear: CLOSED_ANNUAL_YEAR,
        annualYear: CLOSED_ANNUAL_YEAR,
        organizationName: 'St. Nicholas Orthodox Church',
        organizationAddress: '123 Church Street, Chicago, IL',
        organizationTaxId: '12-3456789',
        donorName: 'Member One',
        donorEmail: 'member@example.com',
        amountCents: 12500,
        eligibleAmountCents: 12500,
        currency: 'USD',
        purpose: 'Annual giving summary',
        donationCount: 2,
        receivedDateLabel: `January 1 - December 31, ${CLOSED_ANNUAL_YEAR}`,
        coveredPeriodLabel: `January 1 - December 31, ${CLOSED_ANNUAL_YEAR}`,
        issuedAt: Timestamp.fromDate(new Date(`${CLOSED_ANNUAL_YEAR + 1}-01-15T12:00:00Z`)),
        issuedDateLabel: `January 15, ${CLOSED_ANNUAL_YEAR + 1}`,
        correctionRequired: true,
        correctionReason: 'stripe_partial_refund_review_required',
        goodsServicesStatement:
          'No goods or services were provided in exchange for this contribution other than intangible religious benefits.',
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }),
      adminDb.doc(`taxReceiptSummaries/${originalAnnualReceiptId}`).set({
        receiptId: originalAnnualReceiptId,
        churchId: CHURCH_ID,
        userId: 'member-1',
        kind: 'annual',
        status: 'error',
        receiptNumber: 'STN-000020',
        receiptYear: CLOSED_ANNUAL_YEAR,
        annualYear: CLOSED_ANNUAL_YEAR,
        amountCents: 12500,
        eligibleAmountCents: 12500,
        currency: 'USD',
        donationCount: 2,
        issuedAt: Timestamp.fromDate(new Date(`${CLOSED_ANNUAL_YEAR + 1}-01-15T12:00:00Z`)),
        correctionRequired: true,
        correctionReason: 'stripe_partial_refund_review_required',
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }),
    ]);

    await expectCallableFails(
      callCallable(
        'sendCorrectedAnnualTaxReceipt',
        { churchId: CHURCH_ID, userId: 'invitee-1', year: CLOSED_ANNUAL_YEAR },
        { uid: 'treasurer-1', email: 'treasurer@example.com' }
      ),
      'permission-denied'
    );
    await expectCallableFails(
      callCallable(
        'sendCorrectedAnnualTaxReceipt',
        { churchId: CHURCH_ID, userId: 'member-1', year: CLOSED_ANNUAL_YEAR },
        { uid: 'admin-1', email: 'admin@example.com' }
      ),
      'permission-denied'
    );

    const corrected = await callCallable<
      { churchId: string; year: number },
      {
        success: boolean;
        receiptId: string;
        receiptNumber: string;
        created: boolean;
        corrected: boolean;
        contributionCount: number;
        emailSent: boolean;
      }
    >(
      'sendCorrectedAnnualTaxReceipt',
      { churchId: CHURCH_ID, year: CLOSED_ANNUAL_YEAR },
      { uid: 'member-1', email: 'member@example.com' }
    );
    expect(corrected).toMatchObject({
      success: true,
      receiptNumber: expectedReceiptNumber(CLOSED_ANNUAL_YEAR, 21),
      created: true,
      corrected: true,
      contributionCount: 2,
      emailSent: true,
    });
    expect(corrected.receiptId).toMatch(/^annual_correction_[A-Za-z0-9_-]+$/);

    const [oldReceipt, oldSummary, correctedReceipt, correctedSummary, counterSnap] = await Promise.all([
      adminDb.doc(`taxReceipts/${originalAnnualReceiptId}`).get(),
      adminDb.doc(`taxReceiptSummaries/${originalAnnualReceiptId}`).get(),
      adminDb.doc(`taxReceipts/${corrected.receiptId}`).get(),
      adminDb.doc(`taxReceiptSummaries/${corrected.receiptId}`).get(),
      adminDb.doc(`taxReceiptCounters/church-1_${CLOSED_ANNUAL_YEAR}`).get(),
    ]);
    expect(oldReceipt.data()).toMatchObject({
      status: 'voided',
      voidReason: 'stripe_partial_refund_corrected_reissue',
      voidedBy: 'member-1',
    });
    expect(oldSummary.data()).toMatchObject({
      status: 'voided',
      voidReason: 'stripe_partial_refund_corrected_reissue',
    });
    expect(correctedReceipt.data()).toMatchObject({
      churchId: CHURCH_ID,
      userId: 'member-1',
      donorLabel: 'Member One',
      donorAnonymous: false,
      kind: 'annual',
      status: 'sent',
      receiptNumber: expectedReceiptNumber(CLOSED_ANNUAL_YEAR, 21),
      receiptYear: CLOSED_ANNUAL_YEAR,
      annualYear: CLOSED_ANNUAL_YEAR,
      amountCents: 9500,
      eligibleAmountCents: 9500,
      originalAmountCents: 12500,
      refundedAmountCents: 3000,
      donationCount: 2,
      correctionForReceiptId: originalAnnualReceiptId,
      correctionSourceReason: 'stripe_partial_refund_corrected_reissue',
    });
    expect(correctedReceipt.data()?.partialRefundGivingIds).toEqual(['annual-partial-corrected-1']);
    expect(correctedReceipt.data()?.contributions).toEqual([
      {
        dateLabel: `March 10, ${CLOSED_ANNUAL_YEAR}`,
        purpose: 'General Fund',
        amountCents: 10000,
        eligibleAmountCents: 7000,
        currency: 'USD',
      },
      {
        dateLabel: `November 20, ${CLOSED_ANNUAL_YEAR}`,
        purpose: 'Building Fund',
        amountCents: 2500,
        eligibleAmountCents: 2500,
        currency: 'USD',
      },
    ]);
    expect(correctedReceipt.data()).not.toHaveProperty('correctionRequired');
    expect(correctedSummary.data()).toMatchObject({
      receiptId: corrected.receiptId,
      churchId: CHURCH_ID,
      userId: 'member-1',
      donorLabel: 'Member One',
      donorAnonymous: false,
      kind: 'annual',
      status: 'sent',
      receiptNumber: expectedReceiptNumber(CLOSED_ANNUAL_YEAR, 21),
      receiptYear: CLOSED_ANNUAL_YEAR,
      amountCents: 9500,
      eligibleAmountCents: 9500,
      donationCount: 2,
      correctedReceipt: true,
    });
    expect(correctedSummary.data()).not.toHaveProperty('contributions');
    expect(correctedSummary.data()).not.toHaveProperty('donorEmail');
    expect(correctedSummary.data()).not.toHaveProperty('donorName');
    expect(correctedSummary.data()).not.toHaveProperty('givingIds');
    expect(correctedSummary.data()).not.toHaveProperty('partialRefundGivingIds');
    expect(correctedSummary.data()).not.toHaveProperty('issuedBy');
    expect(correctedSummary.data()).not.toHaveProperty('pdfTemplateVersion');
    expect(correctedSummary.data()).not.toHaveProperty('correctionForReceiptId');
    expect(correctedSummary.data()).not.toHaveProperty('correctionSourceReason');
    expect(correctedSummary.data()).not.toHaveProperty('correctedAt');
    expect(correctedSummary.data()).not.toHaveProperty('correctedBy');
    expect(correctedSummary.data()).not.toHaveProperty('correctionMarkedAt');
    expect(correctedSummary.data()).not.toHaveProperty('voidedBy');
    expect(counterSnap.data()).toMatchObject({
      lastSequence: 21,
    });

    await expect(
      callCallable(
        'sendCorrectedAnnualTaxReceipt',
        { churchId: CHURCH_ID, userId: 'member-1', year: CLOSED_ANNUAL_YEAR },
        { uid: 'treasurer-1', email: 'treasurer@example.com' }
      )
    ).resolves.toMatchObject({
      success: true,
      receiptId: '',
      receiptNumber: expectedReceiptNumber(CLOSED_ANNUAL_YEAR, 21),
      created: false,
      corrected: true,
      contributionCount: 2,
      emailSent: true,
    });

    await expect(
      callCallable(
        'sendAnnualTaxReceipt',
        { churchId: CHURCH_ID, year: CLOSED_ANNUAL_YEAR },
        { uid: 'member-1', email: 'member@example.com' }
      )
    ).resolves.toMatchObject({
      success: true,
      receiptId: corrected.receiptId,
      receiptNumber: expectedReceiptNumber(CLOSED_ANNUAL_YEAR, 21),
      created: false,
      contributionCount: 2,
      emailSent: true,
    });

    // Regression: voids earlier corrected annual receipts when a later partial refund changes the net amount.
    await Promise.all([
      adminDb.doc('giving/annual-partial-corrected-1').update({
        stripeAmountRefundedCents: 4000,
        taxReceiptCorrectionRequired: true,
        taxReceiptCorrectionReason: 'stripe_partial_refund_review_required',
        taxReceiptCorrectionMarkedAt: FieldValue.serverTimestamp(),
        taxReceiptStatus: 'error',
        taxReceiptError: 'stripe_partial_refund_review_required',
        updatedAt: FieldValue.serverTimestamp(),
      }),
      adminDb.doc(`taxReceipts/${corrected.receiptId}`).update({
        status: 'error',
        correctionRequired: true,
        correctionReason: 'stripe_partial_refund_review_required',
        correctionMarkedAt: FieldValue.serverTimestamp(),
        correctionMarkedBy: 'stripe-webhook',
        updatedAt: FieldValue.serverTimestamp(),
      }),
      adminDb.doc(`taxReceiptSummaries/${corrected.receiptId}`).update({
        status: 'error',
        correctionRequired: true,
        correctionReason: 'stripe_partial_refund_review_required',
        correctionMarkedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }),
    ]);

    const laterCorrected = await callCallable<
      { churchId: string; year: number },
      {
        success: boolean;
        receiptId: string;
        receiptNumber: string;
        created: boolean;
        corrected: boolean;
        contributionCount: number;
        emailSent: boolean;
      }
    >(
      'sendCorrectedAnnualTaxReceipt',
      { churchId: CHURCH_ID, year: CLOSED_ANNUAL_YEAR },
      { uid: 'member-1', email: 'member@example.com' }
    );
    expect(laterCorrected).toMatchObject({
      success: true,
      receiptNumber: expectedReceiptNumber(CLOSED_ANNUAL_YEAR, 22),
      created: true,
      corrected: true,
      contributionCount: 2,
      emailSent: true,
    });
    expect(laterCorrected.receiptId).toMatch(/^annual_correction_[A-Za-z0-9_-]+$/);
    expect(laterCorrected.receiptId).not.toBe(corrected.receiptId);

    const [
      oldCorrectedReceipt,
      oldCorrectedSummary,
      laterCorrectedReceipt,
      laterCorrectedSummary,
      laterCounterSnap,
    ] = await Promise.all([
      adminDb.doc(`taxReceipts/${corrected.receiptId}`).get(),
      adminDb.doc(`taxReceiptSummaries/${corrected.receiptId}`).get(),
      adminDb.doc(`taxReceipts/${laterCorrected.receiptId}`).get(),
      adminDb.doc(`taxReceiptSummaries/${laterCorrected.receiptId}`).get(),
      adminDb.doc(`taxReceiptCounters/church-1_${CLOSED_ANNUAL_YEAR}`).get(),
    ]);
    expect(oldCorrectedReceipt.data()).toMatchObject({
      status: 'voided',
      voidReason: 'stripe_partial_refund_corrected_reissue',
      voidedBy: 'member-1',
    });
    expect(oldCorrectedReceipt.data()).not.toHaveProperty('correctionRequired');
    expect(oldCorrectedSummary.data()).toMatchObject({
      status: 'voided',
      voidReason: 'stripe_partial_refund_corrected_reissue',
    });
    expect(laterCorrectedReceipt.data()).toMatchObject({
      churchId: CHURCH_ID,
      userId: 'member-1',
      kind: 'annual',
      status: 'sent',
      receiptNumber: expectedReceiptNumber(CLOSED_ANNUAL_YEAR, 22),
      receiptYear: CLOSED_ANNUAL_YEAR,
      annualYear: CLOSED_ANNUAL_YEAR,
      amountCents: 8500,
      eligibleAmountCents: 8500,
      originalAmountCents: 12500,
      refundedAmountCents: 4000,
      donationCount: 2,
      correctionForReceiptId: originalAnnualReceiptId,
      correctionSourceReason: 'stripe_partial_refund_corrected_reissue',
    });
    expect(laterCorrectedReceipt.data()?.partialRefundGivingIds).toEqual(['annual-partial-corrected-1']);
    expect(laterCorrectedReceipt.data()?.contributions).toEqual([
      {
        dateLabel: `March 10, ${CLOSED_ANNUAL_YEAR}`,
        purpose: 'General Fund',
        amountCents: 10000,
        eligibleAmountCents: 6000,
        currency: 'USD',
      },
      {
        dateLabel: `November 20, ${CLOSED_ANNUAL_YEAR}`,
        purpose: 'Building Fund',
        amountCents: 2500,
        eligibleAmountCents: 2500,
        currency: 'USD',
      },
    ]);
    expect(laterCorrectedSummary.data()).toMatchObject({
      receiptId: laterCorrected.receiptId,
      churchId: CHURCH_ID,
      userId: 'member-1',
      kind: 'annual',
      status: 'sent',
      receiptNumber: expectedReceiptNumber(CLOSED_ANNUAL_YEAR, 22),
      receiptYear: CLOSED_ANNUAL_YEAR,
      amountCents: 8500,
      eligibleAmountCents: 8500,
      donationCount: 2,
      correctedReceipt: true,
    });
    expect(laterCorrectedSummary.data()).not.toHaveProperty('correctionForReceiptId');
    expect(laterCorrectedSummary.data()).not.toHaveProperty('correctionSourceReason');
    expect(laterCorrectedSummary.data()).not.toHaveProperty('partialRefundGivingIds');
    expect(laterCorrectedSummary.data()).not.toHaveProperty('issuedBy');
    expect(laterCorrectedSummary.data()).not.toHaveProperty('pdfTemplateVersion');
    expect(laterCorrectedSummary.data()).not.toHaveProperty('correctedAt');
    expect(laterCorrectedSummary.data()).not.toHaveProperty('correctedBy');
    expect(laterCorrectedSummary.data()).not.toHaveProperty('correctionMarkedAt');
    expect(laterCorrectedSummary.data()).not.toHaveProperty('voidedBy');
    expect(laterCounterSnap.data()).toMatchObject({
      lastSequence: 22,
    });

    await createVerifiedUser(
      'staff-corrected-annual-member',
      'staff-corrected-annual-member@example.com',
      'Staff Corrected Annual Member'
    );
    await seedUserProfile(
      'staff-corrected-annual-member',
      'staff-corrected-annual-member@example.com',
      'Staff Corrected Annual Member'
    );
    await seedChurchMember(
      'staff-corrected-annual-member',
      'staff-corrected-annual-member@example.com',
      'member'
    );

    const staffCorrectedAnnualGivingId = 'staff-corrected-annual-giving';
    const staffCorrectionDigestInput = `${staffCorrectedAnnualGivingId}:6800:1800`;
    const staffOriginalAnnualReceiptId = annualTaxReceiptDocId(
      CHURCH_ID,
      'staff-corrected-annual-member',
      CLOSED_ANNUAL_YEAR
    );
    const staffCorrectedAnnualReceiptId = correctedAnnualTaxReceiptDocId(
      CHURCH_ID,
      'staff-corrected-annual-member',
      CLOSED_ANNUAL_YEAR,
      staffCorrectionDigestInput
    );
    await Promise.all([
      adminDb.doc(`giving/${staffCorrectedAnnualGivingId}`).set({
        churchId: CHURCH_ID,
        churchName: 'St. Nicholas',
        userId: 'staff-corrected-annual-member',
        donorName: 'Staff Corrected Annual Member',
        donorEmail: '',
        anonymous: false,
        churchReceiptVisible: true,
        donorNamePublicSafe: true,
        receiptManagerGivingSafeVersion: 1,
        amount: 68,
        amountCents: 6800,
        currency: 'USD',
        purpose: 'Building Fund',
        status: 'completed',
        stripeRefundStatus: 'partially_refunded',
        stripeAmountRefundedCents: 1800,
        taxReceiptCorrectionRequired: true,
        taxReceiptCorrectionReason: 'stripe_partial_refund_review_required',
        taxReceiptStatus: 'error',
        taxReceiptError: 'stripe_partial_refund_review_required',
        completedAt: Timestamp.fromDate(new Date(`${CLOSED_ANNUAL_YEAR}-06-12T16:00:00Z`)),
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }),
      adminDb.doc(`taxReceipts/${staffOriginalAnnualReceiptId}`).set({
        churchId: CHURCH_ID,
        churchName: 'St. Nicholas',
        userId: 'staff-corrected-annual-member',
        givingId: '',
        givingIds: [staffCorrectedAnnualGivingId],
        kind: 'annual',
        status: 'error',
        jurisdiction: 'US',
        receiptNumber: expectedReceiptNumber(CLOSED_ANNUAL_YEAR, 19),
        receiptYear: CLOSED_ANNUAL_YEAR,
        annualYear: CLOSED_ANNUAL_YEAR,
        organizationName: 'St. Nicholas Orthodox Church',
        organizationAddress: '123 Church Street, Chicago, IL',
        organizationTaxId: '12-3456789',
        donorLabel: 'Staff Corrected Annual Member',
        donorAnonymous: false,
        donorName: 'Staff Corrected Annual Member',
        donorAddress: '10 Donor Street, Chicago, IL 60601, US',
        donorEmail: 'staff-corrected-annual-member@example.com',
        amountCents: 6800,
        eligibleAmountCents: 6800,
        currency: 'USD',
        purpose: 'Annual giving summary',
        donationCount: 1,
        receivedDateLabel: `January 1 - December 31, ${CLOSED_ANNUAL_YEAR}`,
        coveredPeriodLabel: `January 1 - December 31, ${CLOSED_ANNUAL_YEAR}`,
        issuedAt: Timestamp.fromDate(new Date(`${CLOSED_ANNUAL_YEAR + 1}-01-15T12:00:00Z`)),
        issuedDateLabel: `January 15, ${CLOSED_ANNUAL_YEAR + 1}`,
        correctionRequired: true,
        correctionReason: 'stripe_partial_refund_review_required',
        goodsServicesStatement:
          'No goods or services were provided in exchange for this contribution other than intangible religious benefits.',
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }),
      adminDb.doc(`taxReceiptSummaries/${staffOriginalAnnualReceiptId}`).set({
        receiptId: staffOriginalAnnualReceiptId,
        churchId: CHURCH_ID,
        userId: 'staff-corrected-annual-member',
        kind: 'annual',
        status: 'error',
        receiptNumber: expectedReceiptNumber(CLOSED_ANNUAL_YEAR, 19),
        receiptYear: CLOSED_ANNUAL_YEAR,
        annualYear: CLOSED_ANNUAL_YEAR,
        amountCents: 6800,
        eligibleAmountCents: 6800,
        currency: 'USD',
        donationCount: 1,
        donorLabel: 'Staff Corrected Annual Member',
        donorAnonymous: false,
        churchReceiptVisible: true,
        donorLabelPublicSafe: true,
        receiptManagerSummarySafe: true,
        receiptManagerSummarySafeVersion: 2,
        issuedAt: Timestamp.fromDate(new Date(`${CLOSED_ANNUAL_YEAR + 1}-01-15T12:00:00Z`)),
        correctionRequired: true,
        correctionReason: 'stripe_partial_refund_review_required',
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }),
    ]);

    const staffCorrectedAnnual = await callCallable<
      { churchId: string; userId: string; year: number },
      {
        success: boolean;
        receiptId: string;
        receiptNumber: string;
        created: boolean;
        corrected: boolean;
        contributionCount: number;
        emailSent: boolean;
      }
    >(
      'sendCorrectedAnnualTaxReceipt',
      { churchId: CHURCH_ID, userId: 'staff-corrected-annual-member', year: CLOSED_ANNUAL_YEAR },
      { uid: 'treasurer-1', email: 'treasurer@example.com' }
    );
    expect(staffCorrectedAnnual).toMatchObject({
      success: true,
      receiptId: '',
      receiptNumber: expectedReceiptNumber(CLOSED_ANNUAL_YEAR, 23),
      created: true,
      corrected: true,
      contributionCount: 1,
      emailSent: true,
    });
    expect(JSON.stringify(staffCorrectedAnnual)).not.toContain(staffCorrectedAnnualReceiptId);

    const [
      staffOriginalAnnualReceipt,
      staffOriginalAnnualSummary,
      staffCorrectedAnnualReceipt,
      staffCorrectedAnnualSummary,
      staffCorrectedAnnualCounterSnap,
    ] = await Promise.all([
      adminDb.doc(`taxReceipts/${staffOriginalAnnualReceiptId}`).get(),
      adminDb.doc(`taxReceiptSummaries/${staffOriginalAnnualReceiptId}`).get(),
      adminDb.doc(`taxReceipts/${staffCorrectedAnnualReceiptId}`).get(),
      adminDb.doc(`taxReceiptSummaries/${staffCorrectedAnnualReceiptId}`).get(),
      adminDb.doc(`taxReceiptCounters/church-1_${CLOSED_ANNUAL_YEAR}`).get(),
    ]);
    expect(staffOriginalAnnualReceipt.data()).toMatchObject({
      status: 'voided',
      voidReason: 'stripe_partial_refund_corrected_reissue',
      voidedBy: 'treasurer-1',
    });
    expect(staffOriginalAnnualSummary.data()).toMatchObject({
      status: 'voided',
      voidReason: 'stripe_partial_refund_corrected_reissue',
    });
    expect(staffCorrectedAnnualReceipt.data()).toMatchObject({
      churchId: CHURCH_ID,
      userId: 'staff-corrected-annual-member',
      donorLabel: 'Staff Corrected Annual Member',
      donorAnonymous: false,
      donorName: 'Staff Corrected Annual Member',
      donorAddress: '10 Donor Street, Chicago, IL 60601, US',
      donorEmail: 'staff-corrected-annual-member@example.com',
      kind: 'annual',
      status: 'sent',
      receiptNumber: expectedReceiptNumber(CLOSED_ANNUAL_YEAR, 23),
      receiptYear: CLOSED_ANNUAL_YEAR,
      annualYear: CLOSED_ANNUAL_YEAR,
      amountCents: 5000,
      eligibleAmountCents: 5000,
      originalAmountCents: 6800,
      refundedAmountCents: 1800,
      donationCount: 1,
      correctionForReceiptId: staffOriginalAnnualReceiptId,
      correctionSourceReason: 'stripe_partial_refund_corrected_reissue',
    });
    expect(staffCorrectedAnnualReceipt.data()?.partialRefundGivingIds).toEqual([
      staffCorrectedAnnualGivingId,
    ]);
    expect(staffCorrectedAnnualReceipt.data()?.contributions).toEqual([
      {
        dateLabel: `June 12, ${CLOSED_ANNUAL_YEAR}`,
        purpose: 'Building Fund',
        amountCents: 6800,
        eligibleAmountCents: 5000,
        currency: 'USD',
      },
    ]);
    expect(staffCorrectedAnnualReceipt.data()).not.toHaveProperty('correctionRequired');
    expect(staffCorrectedAnnualSummary.data()).toMatchObject({
      receiptId: staffCorrectedAnnualReceiptId,
      churchId: CHURCH_ID,
      userId: 'staff-corrected-annual-member',
      donorLabel: 'Staff Corrected Annual Member',
      donorAnonymous: false,
      churchReceiptVisible: true,
      donorLabelPublicSafe: true,
      receiptManagerSummarySafe: true,
      receiptManagerSummarySafeVersion: 2,
      kind: 'annual',
      status: 'sent',
      receiptNumber: expectedReceiptNumber(CLOSED_ANNUAL_YEAR, 23),
      receiptYear: CLOSED_ANNUAL_YEAR,
      amountCents: 5000,
      eligibleAmountCents: 5000,
      donationCount: 1,
      correctedReceipt: true,
    });
    expect(staffCorrectedAnnualSummary.data()).not.toHaveProperty('contributions');
    expect(staffCorrectedAnnualSummary.data()).not.toHaveProperty('donorEmail');
    expect(staffCorrectedAnnualSummary.data()).not.toHaveProperty('donorName');
    expect(staffCorrectedAnnualSummary.data()).not.toHaveProperty('donorAddress');
    expect(staffCorrectedAnnualSummary.data()).not.toHaveProperty('givingIds');
    expect(staffCorrectedAnnualSummary.data()).not.toHaveProperty('partialRefundGivingIds');
    expect(staffCorrectedAnnualSummary.data()).not.toHaveProperty('issuedBy');
    expect(staffCorrectedAnnualSummary.data()).not.toHaveProperty('pdfTemplateVersion');
    expect(staffCorrectedAnnualSummary.data()).not.toHaveProperty('correctionForReceiptId');
    expect(staffCorrectedAnnualSummary.data()).not.toHaveProperty('correctionSourceReason');
    expect(staffCorrectedAnnualSummary.data()).not.toHaveProperty('correctedAt');
    expect(staffCorrectedAnnualSummary.data()).not.toHaveProperty('correctedBy');
    expect(staffCorrectedAnnualCounterSnap.data()).toMatchObject({
      lastSequence: 23,
    });

    await expect(
      callCallable(
        'sendAnnualTaxReceipt',
        { churchId: CHURCH_ID, year: CLOSED_ANNUAL_YEAR },
        { uid: 'member-1', email: 'member@example.com' }
      )
    ).resolves.toMatchObject({
      success: true,
      receiptId: laterCorrected.receiptId,
      receiptNumber: expectedReceiptNumber(CLOSED_ANNUAL_YEAR, 22),
      created: false,
      contributionCount: 2,
      emailSent: true,
    });

    await adminDb.doc(`churches/${CHURCH_ID}`).update({ isActive: false });
    await expect(
      callCallable(
        'sendCorrectedAnnualTaxReceipt',
        { churchId: CHURCH_ID, year: CLOSED_ANNUAL_YEAR },
        { uid: 'member-1', email: 'member@example.com' }
      )
    ).resolves.toMatchObject({
      success: true,
      receiptId: laterCorrected.receiptId,
      receiptNumber: expectedReceiptNumber(CLOSED_ANNUAL_YEAR, 22),
      created: false,
      corrected: true,
      contributionCount: 2,
      emailSent: true,
    });
    await adminDb
      .doc(rateLimitDocPath('sendCorrectedAnnualTaxReceipt', 'treasurer-1'))
      .delete();
    await expectCallableFails(
      callCallable(
        'sendCorrectedAnnualTaxReceipt',
        { churchId: CHURCH_ID, userId: 'member-1', year: CLOSED_ANNUAL_YEAR },
        { uid: 'treasurer-1', email: 'treasurer@example.com' }
      ),
      'failed-precondition'
    );

    const events = await adminDb
      .collection('taxReceiptEvents')
      .where('receiptId', 'in', [originalAnnualReceiptId, corrected.receiptId, laterCorrected.receiptId])
      .get();
    expect(events.docs.map((doc) => doc.data())).toEqual(expect.arrayContaining([
      expect.objectContaining({
        action: 'voided',
        receiptId: originalAnnualReceiptId,
        reasonCode: 'stripe_partial_refund_corrected_reissue',
      }),
      expect.objectContaining({
        action: 'voided',
        receiptId: corrected.receiptId,
        reasonCode: 'stripe_partial_refund_corrected_reissue',
      }),
      expect.objectContaining({
        action: 'corrected',
        receiptId: laterCorrected.receiptId,
        kind: 'annual',
        reasonCode: 'stripe_partial_refund_corrected_reissue',
      }),
      expect.objectContaining({
        action: 'email_sent',
        receiptId: laterCorrected.receiptId,
      }),
    ]));
  });

  it('requires acknowledgement before donor annual receipts include gifts with historical receipt numbers', async () => {
    await adminDb.doc(`churches/${CHURCH_ID}`).update({
      timezone: 'America/Chicago',
      taxReceiptSettings: {
        enabled: true,
        eligibilityConfirmed: true,
        jurisdiction: 'US',
        organizationName: 'St. Nicholas Orthodox Church',
        organizationAddress: '123 Church Street, Chicago, IL',
        taxId: '12-3456789',
        receiptPrefix: 'STN',
        goodsServicesStatement:
          'No goods or services were provided in exchange for this contribution other than intangible religious benefits.',
        autoIssue: false,
      },
    });
    await adminDb.doc('giving/annual-ack-member').set({
      churchId: CHURCH_ID,
      churchName: 'St. Nicholas',
      userId: 'member-1',
      donorName: 'Member One',
      donorEmail: '',
      anonymous: false,
      amount: 40,
      amountCents: 4000,
      currency: 'USD',
      purpose: 'General Fund',
      status: 'completed',
      taxReceiptId: '',
      taxReceiptNumber: expectedReceiptNumber(CLOSED_ANNUAL_YEAR, 90),
      taxReceiptStatus: 'ready',
      completedAt: Timestamp.fromDate(new Date(`${CLOSED_ANNUAL_YEAR}-02-10T16:00:00Z`)),
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    await expectCallableFails(
      callCallable(
        'sendAnnualTaxReceipt',
        { churchId: CHURCH_ID, year: CLOSED_ANNUAL_YEAR },
        { uid: 'member-1', email: 'member@example.com' }
      ),
      'failed-precondition'
    );
    const unacknowledgedAnnualSnap = await adminDb
      .doc(`taxReceipts/${annualTaxReceiptDocId(CHURCH_ID, 'member-1', CLOSED_ANNUAL_YEAR)}`)
      .get();
    expect(unacknowledgedAnnualSnap.exists).toBe(false);

    const acknowledged = await callCallable<
      { churchId: string; year: number; acknowledgePreviouslyReceipted?: boolean },
      {
        success: boolean;
        receiptId: string;
        receiptNumber: string;
        created: boolean;
        contributionCount: number;
        emailSent: boolean;
      }
    >(
      'sendAnnualTaxReceipt',
      {
        churchId: CHURCH_ID,
        year: CLOSED_ANNUAL_YEAR,
        acknowledgePreviouslyReceipted: true,
      },
      { uid: 'member-1', email: 'member@example.com' }
    );
    expect(acknowledged).toMatchObject({
      success: true,
      created: true,
      contributionCount: 1,
      emailSent: true,
    });
    const acknowledgedReceipt = await adminDb.doc(`taxReceipts/${acknowledged.receiptId}`).get();
    expect(acknowledgedReceipt.data()).toMatchObject({
      status: 'sent',
      includesPreviouslyReceipted: true,
    });
  });

  it('requires acknowledgement before donor annual receipts include gifts with standalone single receipt records', async () => {
    await adminDb.doc(`churches/${CHURCH_ID}`).update({
      timezone: 'America/Chicago',
      taxReceiptSettings: {
        enabled: true,
        eligibilityConfirmed: true,
        jurisdiction: 'US',
        organizationName: 'St. Nicholas Orthodox Church',
        organizationAddress: '123 Church Street, Chicago, IL',
        taxId: '12-3456789',
        receiptPrefix: 'STN',
        goodsServicesStatement:
          'No goods or services were provided in exchange for this contribution other than intangible religious benefits.',
        autoIssue: false,
      },
    });
    await adminDb.doc('giving/annual-ack-standalone-receipt').set({
      churchId: CHURCH_ID,
      churchName: 'St. Nicholas',
      userId: 'member-1',
      donorName: 'Member One',
      donorEmail: '',
      anonymous: false,
      amount: 42,
      amountCents: 4200,
      currency: 'USD',
      purpose: 'General Fund',
      status: 'completed',
      taxReceiptId: '',
      taxReceiptNumber: '',
      taxReceiptStatus: 'ready',
      completedAt: Timestamp.fromDate(new Date(`${CLOSED_ANNUAL_YEAR}-02-11T16:00:00Z`)),
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    await adminDb.doc('taxReceipts/annual-ack-standalone-receipt').set({
      churchId: CHURCH_ID,
      churchName: 'St. Nicholas',
      userId: 'member-1',
      givingId: 'annual-ack-standalone-receipt',
      givingIds: [],
      kind: 'single',
      status: 'sent',
      jurisdiction: 'US',
      receiptNumber: expectedReceiptNumber(CLOSED_ANNUAL_YEAR, 91),
      receiptYear: CLOSED_ANNUAL_YEAR,
      organizationName: 'St. Nicholas Orthodox Church',
      organizationAddress: '123 Church Street, Chicago, IL',
      organizationTaxId: '12-3456789',
      donorName: 'Member One',
      donorAddress: '1 Main Street, Chicago, IL 60601',
      donorEmail: 'member@example.com',
      amountCents: 4200,
      eligibleAmountCents: 4200,
      currency: 'USD',
      purpose: 'General Fund',
      receivedAt: Timestamp.fromDate(new Date(`${CLOSED_ANNUAL_YEAR}-02-11T16:00:00Z`)),
      issuedAt: Timestamp.fromDate(new Date(`${CLOSED_ANNUAL_YEAR}-02-12T16:00:00Z`)),
      emailSentAt: Timestamp.fromDate(new Date(`${CLOSED_ANNUAL_YEAR}-02-12T16:05:00Z`)),
      goodsServicesStatement:
        'No goods or services were provided in exchange for this contribution other than intangible religious benefits.',
      correctionRequired: false,
      correctionReason: '',
    });

    await expectCallableFails(
      callCallable(
        'sendAnnualTaxReceipt',
        { churchId: CHURCH_ID, year: CLOSED_ANNUAL_YEAR },
        { uid: 'member-1', email: 'member@example.com' }
      ),
      'failed-precondition'
    );
    const unacknowledgedAnnualSnap = await adminDb
      .doc(`taxReceipts/${annualTaxReceiptDocId(CHURCH_ID, 'member-1', CLOSED_ANNUAL_YEAR)}`)
      .get();
    expect(unacknowledgedAnnualSnap.exists).toBe(false);

    const acknowledged = await callCallable<
      { churchId: string; year: number; acknowledgePreviouslyReceipted?: boolean },
      {
        success: boolean;
        receiptId: string;
        created: boolean;
        contributionCount: number;
        emailSent: boolean;
      }
    >(
      'sendAnnualTaxReceipt',
      {
        churchId: CHURCH_ID,
        year: CLOSED_ANNUAL_YEAR,
        acknowledgePreviouslyReceipted: true,
      },
      { uid: 'member-1', email: 'member@example.com' }
    );
    expect(acknowledged).toMatchObject({
      success: true,
      created: true,
      contributionCount: 1,
      emailSent: true,
    });
    expect((await adminDb.doc(`taxReceipts/${acknowledged.receiptId}`).get()).data()).toMatchObject({
      status: 'sent',
      includesPreviouslyReceipted: true,
    });
  });

  it('issues annual tax receipt summaries across multiple completed donations after the donor year closes', async () => {
    await adminDb.doc(`churches/${CHURCH_ID}`).update({
      timezone: 'America/Chicago',
      taxReceiptSettings: {
        enabled: true,
        eligibilityConfirmed: true,
        jurisdiction: 'US',
        organizationName: 'St. Nicholas Orthodox Church',
        organizationAddress: '123 Church Street, Chicago, IL',
        taxId: '12-3456789',
        receiptPrefix: 'STN',
        goodsServicesStatement:
          'No goods or services were provided in exchange for this contribution other than intangible religious benefits.',
        autoIssue: false,
      },
    });
    await createVerifiedUser('member-email-label', 'member-email-label@example.com', 'Contact member@example.com');
    await createVerifiedUser('member-2', 'member2@example.com', 'Member Two');
    await seedUserProfile('member-email-label', 'member-email-label@example.com', 'Contact member@example.com', 'Email Label Legal Donor');
    await seedChurchMember('member-email-label', 'member-email-label@example.com', 'member');
    await seedUserProfile('member-2', 'member2@example.com', 'Member Two');
    await adminDb.doc(`churches/${CHURCH_ID}/members/member-email-label`).set({
      displayName: 'Contact member@example.com',
    }, { merge: true });
    const legacyUnclassifiedAnnualReceiptId = annualTaxReceiptDocId(
      CHURCH_ID,
      'invitee-1',
      CLOSED_ANNUAL_YEAR
    );
    await Promise.all([
      adminDb.doc('giving/annual-tax-1').set({
        churchId: CHURCH_ID,
        churchName: 'St. Nicholas',
        userId: 'member-1',
        donorName: 'Anonymous donor',
        donorEmail: '',
        amount: 25,
        amountCents: 2500,
        currency: 'USD',
        purpose: 'General Fund',
        anonymous: true,
        status: 'completed',
        taxReceiptId: 'annual-tax-1',
        taxReceiptNumber: expectedReceiptNumber(CLOSED_ANNUAL_YEAR, 98),
        completedAt: Timestamp.fromDate(new Date(`${CLOSED_ANNUAL_YEAR}-01-15T16:00:00Z`)),
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }),
      adminDb.doc('giving/annual-tax-2').set({
        churchId: CHURCH_ID,
        churchName: 'St. Nicholas',
        userId: 'member-1',
        donorName: 'Member One',
        donorEmail: 'member@example.com',
        anonymous: false,
        amount: 80,
        amountCents: 8000,
        currency: 'USD',
        purpose: 'Building Fund',
        status: 'completed',
        completedAt: Timestamp.fromDate(new Date(`${CLOSED_ANNUAL_YEAR}-12-20T16:00:00Z`)),
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }),
      adminDb.doc('giving/annual-tax-other-inactive-new').set({
        churchId: CHURCH_ID,
        churchName: 'St. Nicholas',
        userId: 'other-1',
        donorName: 'Other One',
        donorEmail: 'other@example.com',
        amount: 65,
        amountCents: 6500,
        currency: 'USD',
        purpose: 'General Fund',
        status: 'completed',
        completedAt: Timestamp.fromDate(new Date(`${CLOSED_ANNUAL_YEAR}-09-20T16:00:00Z`)),
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }),
      adminDb.doc('giving/annual-tax-ambiguous').set({
        churchId: CHURCH_ID,
        churchName: 'St. Nicholas',
        userId: 'member-2',
        donorName: 'Member Two',
        donorEmail: 'member2@example.com',
        amount: 55,
        amountCents: 5500,
        currency: 'USD',
        purpose: 'Building Fund',
        status: 'completed',
        completedAt: Timestamp.fromDate(new Date(`${CLOSED_ANNUAL_YEAR}-08-20T16:00:00Z`)),
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }),
      adminDb.doc('giving/annual-tax-legacy-unclassified').set({
        churchId: CHURCH_ID,
        churchName: 'St. Nicholas',
        userId: 'invitee-1',
        donorName: 'Invitee One',
        donorEmail: 'invitee@example.com',
        amount: 45,
        amountCents: 4500,
        currency: 'USD',
        purpose: 'General Fund',
        status: 'completed',
        completedAt: Timestamp.fromDate(new Date(`${CLOSED_ANNUAL_YEAR}-07-20T16:00:00Z`)),
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }),
      adminDb.doc('giving/annual-tax-hidden-email-label').set({
        churchId: CHURCH_ID,
        churchName: 'St. Nicholas',
        userId: 'member-email-label',
        donorName: 'Contact member@example.com',
        donorEmail: '',
        anonymous: false,
        donorNamePublicSafe: false,
        churchReceiptVisible: true,
        amount: 35,
        amountCents: 3500,
        currency: 'USD',
        purpose: 'General Fund',
        status: 'completed',
        completedAt: Timestamp.fromDate(new Date(`${CLOSED_ANNUAL_YEAR}-06-20T16:00:00Z`)),
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }),
      adminDb.doc(`taxReceipts/${legacyUnclassifiedAnnualReceiptId}`).set({
        churchId: CHURCH_ID,
        churchName: 'St. Nicholas',
        userId: 'invitee-1',
        givingId: '',
        givingIds: ['annual-tax-legacy-unclassified'],
        kind: 'annual',
        status: 'issued',
        jurisdiction: 'US',
        receiptNumber: expectedReceiptNumber(CLOSED_ANNUAL_YEAR, 99),
        receiptYear: CLOSED_ANNUAL_YEAR,
        annualYear: CLOSED_ANNUAL_YEAR,
        organizationName: 'St. Nicholas Orthodox Church',
        organizationAddress: '123 Church Street, Chicago, IL',
        organizationTaxId: '12-3456789',
        donorLabel: 'Invitee One',
        donorName: 'Invitee One',
        donorAddress: '',
        donorEmail: 'invitee@example.com',
        amountCents: 4500,
        eligibleAmountCents: 4500,
        currency: 'USD',
        purpose: 'Annual giving summary',
        donationCount: 1,
        contributions: [
          {
            dateLabel: `July 20, ${CLOSED_ANNUAL_YEAR}`,
            purpose: 'General Fund',
            amountCents: 4500,
            eligibleAmountCents: 4500,
            currency: 'USD',
          },
        ],
        receivedAt: Timestamp.fromDate(new Date(`${CLOSED_ANNUAL_YEAR}-07-20T16:00:00Z`)),
        receivedDateLabel: `January 1 - December 31, ${CLOSED_ANNUAL_YEAR}`,
        coveredPeriodLabel: `January 1 - December 31, ${CLOSED_ANNUAL_YEAR}`,
        firstContributionAt: Timestamp.fromDate(new Date(`${CLOSED_ANNUAL_YEAR}-07-20T16:00:00Z`)),
        lastContributionAt: Timestamp.fromDate(new Date(`${CLOSED_ANNUAL_YEAR}-07-20T16:00:00Z`)),
        issuedAt: Timestamp.fromDate(new Date(`${CLOSED_ANNUAL_YEAR + 1}-01-20T12:00:00Z`)),
        issuedDateLabel: `January 20, ${CLOSED_ANNUAL_YEAR + 1}`,
        issuedBy: 'system',
        goodsServicesStatement:
          'No goods or services were provided in exchange for this contribution other than intangible religious benefits.',
        duplicateClaimWarning: 'Do not claim this annual receipt with separate single-donation receipts for the same gifts.',
        includesPreviouslyReceipted: false,
        createdAt: Timestamp.fromDate(new Date(`${CLOSED_ANNUAL_YEAR + 1}-01-20T12:00:00Z`)),
        updatedAt: Timestamp.fromDate(new Date(`${CLOSED_ANNUAL_YEAR + 1}-01-20T12:00:00Z`)),
      }),
      adminDb.doc('giving/annual-tax-outside').set({
        churchId: CHURCH_ID,
        churchName: 'St. Nicholas',
        userId: 'member-1',
        donorName: 'Member One',
        donorEmail: 'member@example.com',
        amount: 500,
        amountCents: 50000,
        currency: 'USD',
        purpose: 'General Fund',
        status: 'completed',
        completedAt: Timestamp.fromDate(new Date(`${CLOSED_ANNUAL_YEAR - 1}-12-20T16:00:00Z`)),
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }),
      adminDb.doc('giving/annual-tax-pending').set({
        churchId: CHURCH_ID,
        churchName: 'St. Nicholas',
        userId: 'member-1',
        donorName: 'Member One',
        donorEmail: 'member@example.com',
        amount: 100,
        amountCents: 10000,
        currency: 'USD',
        purpose: 'General Fund',
        status: 'pending',
        completedAt: Timestamp.fromDate(new Date(`${CLOSED_ANNUAL_YEAR}-05-24T16:00:00Z`)),
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }),
    ]);

    await expectCallableFails(
      callCallable(
        'sendAnnualTaxReceipt',
        { churchId: CHURCH_ID, year: OPEN_ANNUAL_YEAR },
        { uid: 'other-1', email: 'other@example.com' }
      ),
      'failed-precondition'
    );

    const result = await callCallable<
      { churchId: string; year: number; acknowledgePreviouslyReceipted?: boolean },
      {
        success: boolean;
        receiptId: string;
        receiptNumber: string;
        contributionCount: number;
        emailSent: boolean;
      }
    >(
      'sendAnnualTaxReceipt',
      {
        churchId: CHURCH_ID,
        year: CLOSED_ANNUAL_YEAR,
        acknowledgePreviouslyReceipted: true,
      },
      { uid: 'member-1', email: 'member@example.com' }
    );

    expect(result).toMatchObject({
      success: true,
      receiptNumber: expectedReceiptNumber(CLOSED_ANNUAL_YEAR, 1),
      contributionCount: 2,
      emailSent: true,
    });
    expect(result.receiptId).toMatch(/^annual_[A-Za-z0-9_-]+$/);

    const [receiptSnap, counterSnap, summarySnap] = await Promise.all([
      adminDb.doc(`taxReceipts/${result.receiptId}`).get(),
      adminDb.doc(`taxReceiptCounters/church-1_${CLOSED_ANNUAL_YEAR}`).get(),
      adminDb.doc(`taxReceiptSummaries/${result.receiptId}`).get(),
    ]);
    expect(receiptSnap.data()).toMatchObject({
      churchId: CHURCH_ID,
      userId: 'member-1',
      kind: 'annual',
      status: 'sent',
      pdfTemplateVersion: TAX_RECEIPT_PDF_TEMPLATE_VERSION,
      receiptNumber: expectedReceiptNumber(CLOSED_ANNUAL_YEAR, 1),
      annualYear: CLOSED_ANNUAL_YEAR,
      amountCents: 10500,
      eligibleAmountCents: 10500,
      donationCount: 2,
      receivedDateLabel: `January 1 - December 31, ${CLOSED_ANNUAL_YEAR}`,
      coveredPeriodLabel: `January 1 - December 31, ${CLOSED_ANNUAL_YEAR}`,
      includesPreviouslyReceipted: true,
      donorLabel: 'Anonymous donor',
      donorAnonymous: true,
      donorName: 'Member One',
      donorEmail: 'member@example.com',
    });
    expect(receiptSnap.data()?.givingIds).toEqual(['annual-tax-1', 'annual-tax-2']);
    expect(receiptSnap.data()?.contributions).toEqual([
      {
        dateLabel: `January 15, ${CLOSED_ANNUAL_YEAR}`,
        purpose: 'General Fund',
        amountCents: 2500,
        eligibleAmountCents: 2500,
        currency: 'USD',
      },
      {
        dateLabel: `December 20, ${CLOSED_ANNUAL_YEAR}`,
        purpose: 'Building Fund',
        amountCents: 8000,
        eligibleAmountCents: 8000,
        currency: 'USD',
      },
    ]);
    expect(counterSnap.data()).toMatchObject({ lastSequence: 1 });
    expect(summarySnap.data()).toMatchObject({
      receiptId: result.receiptId,
      churchId: CHURCH_ID,
      userId: 'member-1',
      donorLabel: 'Anonymous donor',
      donorAnonymous: true,
      churchReceiptVisible: false,
      donorLabelPublicSafe: false,
      receiptManagerSummarySafe: false,
      receiptManagerSummarySafeVersion: 0,
      kind: 'annual',
      status: 'sent',
      jurisdiction: 'US',
      receiptNumber: expectedReceiptNumber(CLOSED_ANNUAL_YEAR, 1),
      receiptYear: CLOSED_ANNUAL_YEAR,
      amountCents: 10500,
      eligibleAmountCents: 10500,
      donationCount: 2,
      includesPreviouslyReceipted: true,
    });
    expect(summarySnap.data()).not.toHaveProperty('donorEmail');
    expect(summarySnap.data()).not.toHaveProperty('contributions');
    expect(summarySnap.data()).not.toHaveProperty('donorName');
    expect(summarySnap.data()).not.toHaveProperty('donorAddress');
    expect(summarySnap.data()).not.toHaveProperty('organizationTaxId');

    const ambiguousAnnual = await callCallable<
      { churchId: string; year: number },
      {
        success: boolean;
        receiptId: string;
        receiptNumber: string;
        contributionCount: number;
        emailSent: boolean;
      }
    >(
      'sendAnnualTaxReceipt',
      { churchId: CHURCH_ID, year: CLOSED_ANNUAL_YEAR },
      { uid: 'member-2', email: 'member2@example.com' }
    );
    expect(ambiguousAnnual).toMatchObject({
      success: true,
      receiptNumber: expectedReceiptNumber(CLOSED_ANNUAL_YEAR, 2),
      contributionCount: 1,
      emailSent: true,
    });
    const ambiguousSummary = await adminDb.doc(`taxReceiptSummaries/${ambiguousAnnual.receiptId}`).get();
    expect(ambiguousSummary.data()).toMatchObject({
      receiptId: ambiguousAnnual.receiptId,
      churchId: CHURCH_ID,
      userId: 'member-2',
      donorLabel: 'Anonymous donor',
      donorAnonymous: true,
      churchReceiptVisible: false,
      donorLabelPublicSafe: false,
      receiptManagerSummarySafe: false,
      receiptManagerSummarySafeVersion: 0,
      kind: 'annual',
      status: 'sent',
      receiptNumber: expectedReceiptNumber(CLOSED_ANNUAL_YEAR, 2),
      receiptYear: CLOSED_ANNUAL_YEAR,
      amountCents: 5500,
      eligibleAmountCents: 5500,
      donationCount: 1,
    });
    expect(ambiguousSummary.data()).not.toHaveProperty('donorEmail');
    await expectCallableFails(
      callCallable(
        'sendAnnualTaxReceipt',
        { churchId: CHURCH_ID, year: CLOSED_ANNUAL_YEAR, userId: 'member-2' },
        { uid: 'treasurer-1', email: 'treasurer@example.com' }
      ),
      'permission-denied'
    );

    const legacyAnnual = await callCallable<
      { churchId: string; year: number },
      {
        success: boolean;
        receiptId: string;
        receiptNumber: string;
        contributionCount: number;
        emailSent: boolean;
      }
    >(
      'sendAnnualTaxReceipt',
      { churchId: CHURCH_ID, year: CLOSED_ANNUAL_YEAR },
      { uid: 'invitee-1', email: 'invitee@example.com' }
    );
    expect(legacyAnnual).toMatchObject({
      success: true,
      receiptId: legacyUnclassifiedAnnualReceiptId,
      receiptNumber: expectedReceiptNumber(CLOSED_ANNUAL_YEAR, 99),
      contributionCount: 1,
      emailSent: true,
    });
    const legacySummary = await adminDb.doc(`taxReceiptSummaries/${legacyUnclassifiedAnnualReceiptId}`).get();
    expect(legacySummary.data()).toMatchObject({
      receiptId: legacyUnclassifiedAnnualReceiptId,
      churchId: CHURCH_ID,
      userId: 'invitee-1',
      donorLabel: 'Anonymous donor',
      donorAnonymous: true,
      churchReceiptVisible: false,
      donorLabelPublicSafe: false,
      receiptManagerSummarySafe: false,
      receiptManagerSummarySafeVersion: 0,
      kind: 'annual',
      status: 'sent',
      receiptNumber: expectedReceiptNumber(CLOSED_ANNUAL_YEAR, 99),
      receiptYear: CLOSED_ANNUAL_YEAR,
      amountCents: 4500,
      eligibleAmountCents: 4500,
      donationCount: 1,
    });
    expect(legacySummary.data()).not.toHaveProperty('donorEmail');
    expect(legacySummary.data()).not.toHaveProperty('contributions');
    await expectCallableFails(
      callCallable(
        'sendAnnualTaxReceipt',
        { churchId: CHURCH_ID, year: CLOSED_ANNUAL_YEAR, userId: 'invitee-1' },
        { uid: 'treasurer-1', email: 'treasurer@example.com' }
      ),
      'permission-denied'
    );

    const hiddenLabelAnnual = await callCallable<
      { churchId: string; year: number },
      {
        success: boolean;
        receiptId: string;
        receiptNumber: string;
        contributionCount: number;
        emailSent: boolean;
      }
    >(
      'sendAnnualTaxReceipt',
      { churchId: CHURCH_ID, year: CLOSED_ANNUAL_YEAR },
      { uid: 'member-email-label', email: 'member-email-label@example.com' }
    );
    expect(hiddenLabelAnnual).toMatchObject({
      success: true,
      contributionCount: 1,
      emailSent: true,
    });
    const [hiddenLabelReceipt, hiddenLabelSummary] = await Promise.all([
      adminDb.doc(`taxReceipts/${hiddenLabelAnnual.receiptId}`).get(),
      adminDb.doc(`taxReceiptSummaries/${hiddenLabelAnnual.receiptId}`).get(),
    ]);
    expect(hiddenLabelReceipt.data()).toMatchObject({
      donorLabel: 'Parishioner',
      donorAnonymous: false,
      donorName: 'Email Label Legal Donor',
      donorEmail: 'member-email-label@example.com',
    });
    expect(hiddenLabelSummary.data()).toMatchObject({
      receiptId: hiddenLabelAnnual.receiptId,
      churchId: CHURCH_ID,
      userId: 'member-email-label',
      donorLabel: 'Anonymous donor',
      donorAnonymous: true,
      churchReceiptVisible: false,
      donorLabelPublicSafe: false,
      receiptManagerSummarySafe: false,
      receiptManagerSummarySafeVersion: 0,
      kind: 'annual',
      status: 'sent',
      receiptYear: CLOSED_ANNUAL_YEAR,
      amountCents: 3500,
      eligibleAmountCents: 3500,
      donationCount: 1,
    });
    expect(hiddenLabelSummary.data()).not.toHaveProperty('donorEmail');
    await expectCallableFails(
      callCallable(
        'sendAnnualTaxReceipt',
        { churchId: CHURCH_ID, year: CLOSED_ANNUAL_YEAR, userId: 'member-email-label' },
        { uid: 'priest-1', email: 'priest@example.com' }
      ),
      'permission-denied'
    );

    await createVerifiedUser('staff-annual-member', 'staff-annual-member@example.com', 'Staff Annual Member');
    await seedUserProfile(
      'staff-annual-member',
      'staff-annual-member@example.com',
      'Staff Annual Member',
      'Staff Annual Legal Donor'
    );
    await seedChurchMember('staff-annual-member', 'staff-annual-member@example.com', 'member');
    await adminDb.doc('giving/annual-tax-staff-first-issue').set({
      churchId: CHURCH_ID,
      churchName: 'St. Nicholas',
      userId: 'staff-annual-member',
      donorName: 'Staff Annual Member',
      donorEmail: '',
      anonymous: false,
      churchReceiptVisible: true,
      donorNamePublicSafe: true,
      receiptManagerGivingSafeVersion: 1,
      amount: 62,
      amountCents: 6200,
      currency: 'USD',
      purpose: 'General Fund',
      status: 'completed',
      completedAt: Timestamp.fromDate(new Date(`${CLOSED_ANNUAL_YEAR}-04-12T16:00:00Z`)),
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    const staffIssuedAnnualReceiptId = annualTaxReceiptDocId(
      CHURCH_ID,
      'staff-annual-member',
      CLOSED_ANNUAL_YEAR
    );
    const staffIssuedAnnual = await callCallable<
      { churchId: string; year: number; userId: string },
      {
        success: boolean;
        receiptId: string;
        receiptNumber: string;
        created: boolean;
        contributionCount: number;
        emailSent: boolean;
      }
    >(
      'sendAnnualTaxReceipt',
      { churchId: CHURCH_ID, year: CLOSED_ANNUAL_YEAR, userId: 'staff-annual-member' },
      { uid: 'priest-1', email: 'priest@example.com' }
    );
    expect(staffIssuedAnnual).toMatchObject({
      success: true,
      receiptId: '',
      receiptNumber: expectedReceiptNumber(CLOSED_ANNUAL_YEAR, 4),
      created: true,
      contributionCount: 1,
      emailSent: true,
    });
    expect(JSON.stringify(staffIssuedAnnual)).not.toContain(staffIssuedAnnualReceiptId);
    const [staffIssuedReceipt, staffIssuedSummary] = await Promise.all([
      adminDb.doc(`taxReceipts/${staffIssuedAnnualReceiptId}`).get(),
      adminDb.doc(`taxReceiptSummaries/${staffIssuedAnnualReceiptId}`).get(),
    ]);
    expect(staffIssuedReceipt.data()).toMatchObject({
      churchId: CHURCH_ID,
      userId: 'staff-annual-member',
      kind: 'annual',
      status: 'sent',
      receiptNumber: expectedReceiptNumber(CLOSED_ANNUAL_YEAR, 4),
      donationCount: 1,
      donorName: 'Staff Annual Legal Donor',
      donorEmail: 'staff-annual-member@example.com',
    });
    expect(staffIssuedSummary.data()).toMatchObject({
      receiptId: staffIssuedAnnualReceiptId,
      churchId: CHURCH_ID,
      userId: 'staff-annual-member',
      donorLabel: 'Staff Annual Member',
      donorAnonymous: false,
      churchReceiptVisible: true,
      donorLabelPublicSafe: true,
      receiptManagerSummarySafe: true,
      receiptManagerSummarySafeVersion: 2,
      kind: 'annual',
      status: 'sent',
      receiptNumber: expectedReceiptNumber(CLOSED_ANNUAL_YEAR, 4),
      donationCount: 1,
    });
    expect(staffIssuedSummary.data()).not.toHaveProperty('donorEmail');
    expect(staffIssuedSummary.data()).not.toHaveProperty('contributions');
    expect(staffIssuedSummary.data()).not.toHaveProperty('donorName');
    expect(staffIssuedSummary.data()).not.toHaveProperty('donorAddress');

    await adminDb.doc(`churches/${CHURCH_ID}`).update({ isActive: false });
    await expect(
      callCallable(
        'sendAnnualTaxReceipt',
        {
          churchId: CHURCH_ID,
          year: CLOSED_ANNUAL_YEAR,
          acknowledgePreviouslyReceipted: true,
        },
        { uid: 'member-1', email: 'member@example.com' }
      )
    ).resolves.toMatchObject({
      success: true,
      receiptId: result.receiptId,
      receiptNumber: expectedReceiptNumber(CLOSED_ANNUAL_YEAR, 1),
      created: false,
      emailSent: true,
      contributionCount: 2,
    });
    await expectCallableFails(
      callCallable(
        'sendAnnualTaxReceipt',
        { churchId: CHURCH_ID, year: CLOSED_ANNUAL_YEAR },
        { uid: 'other-1', email: 'other@example.com' }
      ),
      'failed-precondition'
    );
    expect((await adminDb.doc(`taxReceipts/${annualTaxReceiptDocId(CHURCH_ID, 'other-1', CLOSED_ANNUAL_YEAR)}`).get()).exists).toBe(false);

    await adminDb.doc(`churches/${CHURCH_ID}`).update({
      isActive: true,
      taxReceiptSettings: {
        enabled: false,
      },
    });
    await expect(
      callCallable(
        'sendAnnualTaxReceipt',
        {
          churchId: CHURCH_ID,
          year: CLOSED_ANNUAL_YEAR,
          acknowledgePreviouslyReceipted: true,
        },
        { uid: 'member-1', email: 'member@example.com' }
      )
    ).resolves.toMatchObject({
      success: true,
      receiptId: result.receiptId,
      receiptNumber: expectedReceiptNumber(CLOSED_ANNUAL_YEAR, 1),
      created: false,
      emailSent: true,
      contributionCount: 2,
    });

    await expectCallableFails(
      callCallable(
        'sendAnnualTaxReceipt',
        { churchId: CHURCH_ID, year: CLOSED_ANNUAL_YEAR, userId: 'member-1' },
        { uid: 'priest-1', email: 'priest@example.com' }
      ),
      'permission-denied'
    );

    await expectCallableFails(
      callCallable(
        'sendAnnualTaxReceipt',
        { churchId: CHURCH_ID, year: CLOSED_ANNUAL_YEAR, userId: 'member-1' },
        { uid: 'treasurer-1', email: 'treasurer@example.com' }
      ),
      'permission-denied'
    );

    const annualEvents = await adminDb
      .collection('taxReceiptEvents')
      .where('receiptId', '==', result.receiptId)
      .get();
    const annualEventData = annualEvents.docs.map((doc) => doc.data());
    expect(annualEventData).toEqual(expect.arrayContaining([
      expect.objectContaining({
        action: 'issued',
        actorUid: 'member-1',
        churchId: CHURCH_ID,
        userId: 'member-1',
        kind: 'annual',
        receiptYear: CLOSED_ANNUAL_YEAR,
        annualYear: CLOSED_ANNUAL_YEAR,
      }),
      expect.objectContaining({
        action: 'email_sent',
        actorUid: 'member-1',
        churchId: CHURCH_ID,
        userId: 'member-1',
        kind: 'annual',
        receiptYear: CLOSED_ANNUAL_YEAR,
        annualYear: CLOSED_ANNUAL_YEAR,
      }),
    ]));
    for (const event of annualEventData) {
      expect(event).not.toHaveProperty('donorEmail');
      expect(event).not.toHaveProperty('donorName');
      expect(event).not.toHaveProperty('donorAddress');
      expect(event).not.toHaveProperty('organizationTaxId');
      expect(event).not.toHaveProperty('organizationAddress');
    }
    expect(annualEventData).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ action: 'email_sent', actorUid: 'priest-1' }),
    ]));
    expect(annualEventData).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ action: 'email_sent', actorUid: 'treasurer-1' }),
    ]));

    await expectCallableFails(
      callCallable(
        'sendAnnualTaxReceipt',
        { churchId: CHURCH_ID, year: CLOSED_ANNUAL_YEAR, userId: 'member-1' },
        { uid: 'admin-1', email: 'admin@example.com' }
      ),
      'permission-denied'
    );
  });

  it('lets treasurers resend stored non-anonymous annual receipts after new issuance is disabled', async () => {
    const annualReceiptId = annualTaxReceiptDocId(CHURCH_ID, 'member-1', CLOSED_ANNUAL_YEAR);
    await adminDb.doc(`churches/${CHURCH_ID}`).update({
      timezone: 'America/Chicago',
      taxReceiptSettings: {
        enabled: true,
        eligibilityConfirmed: true,
        jurisdiction: 'US',
        organizationName: 'St. Nicholas Orthodox Church',
        organizationAddress: '123 Church Street, Chicago, IL',
        taxId: '12-3456789',
        receiptPrefix: 'STN',
        goodsServicesStatement:
          'No goods or services were provided in exchange for this contribution other than intangible religious benefits.',
        autoIssue: false,
      },
    });
    await adminDb.doc('giving/annual-staff-disabled-resend').set({
      churchId: CHURCH_ID,
      churchName: 'St. Nicholas',
      userId: 'member-1',
      donorName: 'Member One',
      donorEmail: '',
      anonymous: false,
      churchReceiptVisible: true,
      donorNamePublicSafe: true,
      receiptManagerGivingSafeVersion: 1,
      amount: 84,
      amountCents: 8400,
      currency: 'USD',
      purpose: 'General Fund',
      status: 'completed',
      taxReceiptStatus: 'ready',
      completedAt: Timestamp.fromDate(new Date(`${CLOSED_ANNUAL_YEAR}-04-20T16:00:00Z`)),
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    await expect(
      callCallable(
        'sendAnnualTaxReceipt',
        { churchId: CHURCH_ID, year: CLOSED_ANNUAL_YEAR },
        { uid: 'member-1', email: 'member@example.com' }
      )
    ).resolves.toMatchObject({
      success: true,
      receiptId: annualReceiptId,
      receiptNumber: expectedReceiptNumber(CLOSED_ANNUAL_YEAR, 1),
      created: true,
      contributionCount: 1,
      emailSent: true,
    });

    await adminDb.doc(`churches/${CHURCH_ID}`).update({
      'taxReceiptSettings.enabled': false,
    });

    await expect(
      callCallable(
        'sendAnnualTaxReceipt',
        { churchId: CHURCH_ID, year: CLOSED_ANNUAL_YEAR, userId: 'member-1' },
        { uid: 'treasurer-1', email: 'treasurer@example.com' }
      )
    ).resolves.toMatchObject({
      success: true,
      receiptId: '',
      receiptNumber: expectedReceiptNumber(CLOSED_ANNUAL_YEAR, 1),
      created: false,
      contributionCount: 1,
      emailSent: true,
    });

    const [receiptSnap, summarySnap, counterSnap, eventsSnap] = await Promise.all([
      adminDb.doc(`taxReceipts/${annualReceiptId}`).get(),
      adminDb.doc(`taxReceiptSummaries/${annualReceiptId}`).get(),
      adminDb.doc(`taxReceiptCounters/${CHURCH_ID}_${CLOSED_ANNUAL_YEAR}`).get(),
      adminDb
        .collection('taxReceiptEvents')
        .where('receiptId', '==', annualReceiptId)
        .get(),
    ]);
    expect(receiptSnap.data()).toMatchObject({
      status: 'sent',
      receiptNumber: expectedReceiptNumber(CLOSED_ANNUAL_YEAR, 1),
      donorEmail: 'member@example.com',
      donationCount: 1,
    });
    expect(summarySnap.data()).toMatchObject({
      receiptId: annualReceiptId,
      status: 'sent',
      churchReceiptVisible: true,
      donorLabelPublicSafe: true,
      receiptManagerSummarySafe: true,
      receiptManagerSummarySafeVersion: 2,
    });
    expect(counterSnap.data()).toMatchObject({ lastSequence: 1 });
    expect(eventsSnap.docs.map((doc) => doc.data())).toEqual(expect.arrayContaining([
      expect.objectContaining({
        action: 'email_sent',
        actorUid: 'treasurer-1',
        receiptId: annualReceiptId,
      }),
    ]));
  });

  it('reissues annual tax receipts after a full refund voids a mixed annual receipt', async () => {
    await adminDb.doc(`churches/${CHURCH_ID}`).update({
      timezone: 'America/Chicago',
      taxReceiptSettings: {
        enabled: true,
        eligibilityConfirmed: true,
        jurisdiction: 'US',
        organizationName: 'St. Nicholas Orthodox Church',
        organizationAddress: '123 Church Street, Chicago, IL',
        taxId: '12-3456789',
        receiptPrefix: 'STN',
        goodsServicesStatement:
          'No goods or services were provided in exchange for this contribution other than intangible religious benefits.',
        autoIssue: false,
      },
    });
    const originalReceiptId = annualTaxReceiptDocId(CHURCH_ID, 'member-1', CLOSED_ANNUAL_YEAR);
    const reissuedReceiptId = reissuedAnnualTaxReceiptDocId(
      CHURCH_ID,
      'member-1',
      CLOSED_ANNUAL_YEAR,
      'annual-reissue-kept:7000:0'
    );

    await Promise.all([
      adminDb.doc(`taxReceiptCounters/${CHURCH_ID}_${CLOSED_ANNUAL_YEAR}`).set({
        churchId: CHURCH_ID,
        year: CLOSED_ANNUAL_YEAR,
        lastSequence: 99,
        updatedAt: FieldValue.serverTimestamp(),
      }),
      adminDb.doc('giving/annual-reissue-refunded').set({
        churchId: CHURCH_ID,
        churchName: 'St. Nicholas',
        userId: 'member-1',
        donorName: 'Member One',
        donorEmail: '',
        anonymous: false,
        amount: 50,
        amountCents: 5000,
        currency: 'USD',
        purpose: 'General Fund',
        status: 'refunded',
        stripeRefundStatus: 'refunded',
        stripeAmountRefundedCents: 5000,
        completedAt: Timestamp.fromDate(new Date(`${CLOSED_ANNUAL_YEAR}-03-10T16:00:00Z`)),
        refundedAt: Timestamp.fromDate(new Date(`${CLOSED_ANNUAL_YEAR + 1}-02-01T16:00:00Z`)),
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }),
      adminDb.doc('giving/annual-reissue-kept').set({
        churchId: CHURCH_ID,
        churchName: 'St. Nicholas',
        userId: 'member-1',
        donorName: 'Member One',
        donorEmail: '',
        anonymous: false,
        amount: 70,
        amountCents: 7000,
        currency: 'USD',
        purpose: 'Building Fund',
        status: 'completed',
        completedAt: Timestamp.fromDate(new Date(`${CLOSED_ANNUAL_YEAR}-09-15T16:00:00Z`)),
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }),
      adminDb.doc(`taxReceipts/${originalReceiptId}`).set({
        churchId: CHURCH_ID,
        churchName: 'St. Nicholas',
        userId: 'member-1',
        givingId: '',
        givingIds: ['annual-reissue-refunded', 'annual-reissue-kept'],
        kind: 'annual',
        status: 'voided',
        voidReason: 'stripe_full_refund',
        jurisdiction: 'US',
        receiptNumber: expectedReceiptNumber(CLOSED_ANNUAL_YEAR, 99),
        receiptYear: CLOSED_ANNUAL_YEAR,
        annualYear: CLOSED_ANNUAL_YEAR,
        organizationName: 'St. Nicholas Orthodox Church',
        organizationAddress: '123 Church Street, Chicago, IL',
        organizationTaxId: '12-3456789',
        donorLabel: 'Member One',
        donorAnonymous: false,
        donorName: 'Member One',
        donorEmail: 'member@example.com',
        amountCents: 12000,
        eligibleAmountCents: 12000,
        currency: 'USD',
        purpose: 'Annual giving summary',
        donationCount: 2,
        receivedDateLabel: `January 1 - December 31, ${CLOSED_ANNUAL_YEAR}`,
        coveredPeriodLabel: `January 1 - December 31, ${CLOSED_ANNUAL_YEAR}`,
        issuedAt: Timestamp.fromDate(new Date(`${CLOSED_ANNUAL_YEAR + 1}-01-15T12:00:00Z`)),
        issuedDateLabel: `January 15, ${CLOSED_ANNUAL_YEAR + 1}`,
        goodsServicesStatement:
          'No goods or services were provided in exchange for this contribution other than intangible religious benefits.',
        voidedAt: Timestamp.fromDate(new Date(`${CLOSED_ANNUAL_YEAR + 1}-02-01T16:00:00Z`)),
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }),
      adminDb.doc(`taxReceiptSummaries/${originalReceiptId}`).set({
        receiptId: originalReceiptId,
        churchId: CHURCH_ID,
        userId: 'member-1',
        donorLabel: 'Member One',
        donorAnonymous: false,
        kind: 'annual',
        status: 'voided',
        voidReason: 'stripe_full_refund',
        receiptNumber: expectedReceiptNumber(CLOSED_ANNUAL_YEAR, 99),
        receiptYear: CLOSED_ANNUAL_YEAR,
        annualYear: CLOSED_ANNUAL_YEAR,
        amountCents: 12000,
        eligibleAmountCents: 12000,
        currency: 'USD',
        donationCount: 2,
        issuedAt: Timestamp.fromDate(new Date(`${CLOSED_ANNUAL_YEAR + 1}-01-15T12:00:00Z`)),
        voidedAt: Timestamp.fromDate(new Date(`${CLOSED_ANNUAL_YEAR + 1}-02-01T16:00:00Z`)),
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }),
    ]);

    const result = await callCallable<
      { churchId: string; year: number },
      {
        success: boolean;
        receiptId: string;
        receiptNumber: string;
        created: boolean;
        contributionCount: number;
        emailSent: boolean;
      }
    >(
      'sendAnnualTaxReceipt',
      { churchId: CHURCH_ID, year: CLOSED_ANNUAL_YEAR },
      { uid: 'member-1', email: 'member@example.com' }
    );

    expect(result).toMatchObject({
      success: true,
      receiptId: reissuedReceiptId,
      receiptNumber: expectedReceiptNumber(CLOSED_ANNUAL_YEAR, 100),
      created: true,
      contributionCount: 1,
      emailSent: true,
    });

    const [originalReceiptSnap, reissuedReceiptSnap, reissuedSummarySnap, counterSnap] = await Promise.all([
      adminDb.doc(`taxReceipts/${originalReceiptId}`).get(),
      adminDb.doc(`taxReceipts/${reissuedReceiptId}`).get(),
      adminDb.doc(`taxReceiptSummaries/${reissuedReceiptId}`).get(),
      adminDb.doc(`taxReceiptCounters/${CHURCH_ID}_${CLOSED_ANNUAL_YEAR}`).get(),
    ]);
    expect(originalReceiptSnap.data()).toMatchObject({
      status: 'voided',
      voidReason: 'stripe_full_refund',
    });
    expect(reissuedReceiptSnap.data()).toMatchObject({
      churchId: CHURCH_ID,
      userId: 'member-1',
      kind: 'annual',
      status: 'sent',
      receiptNumber: expectedReceiptNumber(CLOSED_ANNUAL_YEAR, 100),
      receiptYear: CLOSED_ANNUAL_YEAR,
      annualYear: CLOSED_ANNUAL_YEAR,
      amountCents: 7000,
      eligibleAmountCents: 7000,
      donationCount: 1,
      correctionForReceiptId: originalReceiptId,
      correctionSourceReason: 'stripe_full_refund_annual_reissue',
    });
    expect(reissuedReceiptSnap.data()?.givingIds).toEqual(['annual-reissue-kept']);
    expect(reissuedReceiptSnap.data()?.contributions).toEqual([
      {
        dateLabel: `September 15, ${CLOSED_ANNUAL_YEAR}`,
        purpose: 'Building Fund',
        amountCents: 7000,
        eligibleAmountCents: 7000,
        currency: 'USD',
      },
    ]);
    expect(reissuedSummarySnap.data()).toMatchObject({
      receiptId: reissuedReceiptId,
      churchId: CHURCH_ID,
      userId: 'member-1',
      kind: 'annual',
      status: 'sent',
      receiptNumber: expectedReceiptNumber(CLOSED_ANNUAL_YEAR, 100),
      receiptYear: CLOSED_ANNUAL_YEAR,
      amountCents: 7000,
      eligibleAmountCents: 7000,
      donationCount: 1,
    });
    expect(counterSnap.data()).toMatchObject({ lastSequence: 100 });

    await adminDb.doc(`churches/${CHURCH_ID}`).update({ isActive: false });
    await expect(
      callCallable(
        'sendAnnualTaxReceipt',
        { churchId: CHURCH_ID, year: CLOSED_ANNUAL_YEAR },
        { uid: 'member-1', email: 'member@example.com' }
      )
    ).resolves.toMatchObject({
      success: true,
      receiptId: reissuedReceiptId,
      receiptNumber: expectedReceiptNumber(CLOSED_ANNUAL_YEAR, 100),
      created: false,
      emailSent: true,
      contributionCount: 1,
    });
  });

  it('voids stale annual receipts before resend when covered giving is already fully refunded', async () => {
    await adminDb.doc(`churches/${CHURCH_ID}`).update({
      timezone: 'America/Chicago',
      taxReceiptSettings: {
        enabled: true,
        eligibilityConfirmed: true,
        jurisdiction: 'US',
        organizationName: 'St. Nicholas Orthodox Church',
        organizationAddress: '123 Church Street, Chicago, IL',
        taxId: '12-3456789',
        receiptPrefix: 'STN',
        goodsServicesStatement:
          'No goods or services were provided in exchange for this contribution other than intangible religious benefits.',
        autoIssue: false,
      },
    });
    const staleReceiptId = annualTaxReceiptDocId(CHURCH_ID, 'member-1', CLOSED_ANNUAL_YEAR);
    const replacementReceiptId = reissuedAnnualTaxReceiptDocId(
      CHURCH_ID,
      'member-1',
      CLOSED_ANNUAL_YEAR,
      'annual-stale-refund-kept:6500:0'
    );

    await Promise.all([
      adminDb.doc(`taxReceiptCounters/${CHURCH_ID}_${CLOSED_ANNUAL_YEAR}`).set({
        churchId: CHURCH_ID,
        year: CLOSED_ANNUAL_YEAR,
        lastSequence: 31,
        updatedAt: FieldValue.serverTimestamp(),
      }),
      adminDb.doc('giving/annual-stale-refund-voided').set({
        churchId: CHURCH_ID,
        churchName: 'St. Nicholas',
        userId: 'member-1',
        donorName: 'Member One',
        donorEmail: '',
        anonymous: false,
        amount: 50,
        amountCents: 5000,
        currency: 'USD',
        purpose: 'General Fund',
        status: 'refunded',
        stripeRefundStatus: 'refunded',
        stripeAmountRefundedCents: 5000,
        completedAt: Timestamp.fromDate(new Date(`${CLOSED_ANNUAL_YEAR}-03-10T16:00:00Z`)),
        refundedAt: Timestamp.fromDate(new Date(`${CLOSED_ANNUAL_YEAR + 1}-02-01T16:00:00Z`)),
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }),
      adminDb.doc('giving/annual-stale-refund-kept').set({
        churchId: CHURCH_ID,
        churchName: 'St. Nicholas',
        userId: 'member-1',
        donorName: 'Member One',
        donorEmail: '',
        anonymous: false,
        amount: 65,
        amountCents: 6500,
        currency: 'USD',
        purpose: 'Building Fund',
        status: 'completed',
        completedAt: Timestamp.fromDate(new Date(`${CLOSED_ANNUAL_YEAR}-09-15T16:00:00Z`)),
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }),
      adminDb.doc(`taxReceipts/${staleReceiptId}`).set({
        churchId: CHURCH_ID,
        churchName: 'St. Nicholas',
        userId: 'member-1',
        givingId: '',
        givingIds: ['annual-stale-refund-voided', 'annual-stale-refund-kept'],
        kind: 'annual',
        status: 'sent',
        jurisdiction: 'US',
        receiptNumber: expectedReceiptNumber(CLOSED_ANNUAL_YEAR, 31),
        receiptYear: CLOSED_ANNUAL_YEAR,
        annualYear: CLOSED_ANNUAL_YEAR,
        organizationName: 'St. Nicholas Orthodox Church',
        organizationAddress: '123 Church Street, Chicago, IL',
        organizationTaxId: '12-3456789',
        donorLabel: 'Member One',
        donorAnonymous: false,
        donorName: 'Member One',
        donorEmail: 'member@example.com',
        amountCents: 11500,
        eligibleAmountCents: 11500,
        currency: 'USD',
        purpose: 'Annual giving summary',
        donationCount: 2,
        receivedDateLabel: `January 1 - December 31, ${CLOSED_ANNUAL_YEAR}`,
        coveredPeriodLabel: `January 1 - December 31, ${CLOSED_ANNUAL_YEAR}`,
        issuedAt: Timestamp.fromDate(new Date(`${CLOSED_ANNUAL_YEAR + 1}-01-15T12:00:00Z`)),
        issuedDateLabel: `January 15, ${CLOSED_ANNUAL_YEAR + 1}`,
        goodsServicesStatement:
          'No goods or services were provided in exchange for this contribution other than intangible religious benefits.',
        emailSentAt: Timestamp.fromDate(new Date(`${CLOSED_ANNUAL_YEAR + 1}-01-15T12:05:00Z`)),
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }),
      adminDb.doc(`taxReceiptSummaries/${staleReceiptId}`).set({
        receiptId: staleReceiptId,
        churchId: CHURCH_ID,
        userId: 'member-1',
        donorLabel: 'Member One',
        donorAnonymous: false,
        kind: 'annual',
        status: 'sent',
        receiptNumber: expectedReceiptNumber(CLOSED_ANNUAL_YEAR, 31),
        receiptYear: CLOSED_ANNUAL_YEAR,
        annualYear: CLOSED_ANNUAL_YEAR,
        amountCents: 11500,
        eligibleAmountCents: 11500,
        currency: 'USD',
        donationCount: 2,
        issuedAt: Timestamp.fromDate(new Date(`${CLOSED_ANNUAL_YEAR + 1}-01-15T12:00:00Z`)),
        emailSentAt: Timestamp.fromDate(new Date(`${CLOSED_ANNUAL_YEAR + 1}-01-15T12:05:00Z`)),
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }),
    ]);

    await expect(
      callCallable(
        'sendAnnualTaxReceipt',
        { churchId: CHURCH_ID, year: CLOSED_ANNUAL_YEAR },
        { uid: 'member-1', email: 'member@example.com' }
      )
    ).resolves.toMatchObject({
      success: true,
      receiptId: replacementReceiptId,
      receiptNumber: expectedReceiptNumber(CLOSED_ANNUAL_YEAR, 32),
      created: true,
      contributionCount: 1,
      emailSent: true,
    });

    const [staleReceiptSnap, staleSummarySnap, replacementReceiptSnap, replacementSummarySnap, counterSnap] =
      await Promise.all([
        adminDb.doc(`taxReceipts/${staleReceiptId}`).get(),
        adminDb.doc(`taxReceiptSummaries/${staleReceiptId}`).get(),
        adminDb.doc(`taxReceipts/${replacementReceiptId}`).get(),
        adminDb.doc(`taxReceiptSummaries/${replacementReceiptId}`).get(),
        adminDb.doc(`taxReceiptCounters/${CHURCH_ID}_${CLOSED_ANNUAL_YEAR}`).get(),
      ]);

    expect(staleReceiptSnap.data()).toMatchObject({
      status: 'voided',
      voidReason: 'stripe_full_refund',
      voidedBy: 'system',
    });
    expect(staleSummarySnap.data()).toMatchObject({
      status: 'voided',
      voidReason: 'stripe_full_refund',
    });
    expect(replacementReceiptSnap.data()).toMatchObject({
      userId: 'member-1',
      kind: 'annual',
      status: 'sent',
      receiptNumber: expectedReceiptNumber(CLOSED_ANNUAL_YEAR, 32),
      amountCents: 6500,
      eligibleAmountCents: 6500,
      donationCount: 1,
      correctionForReceiptId: staleReceiptId,
      correctionSourceReason: 'stripe_full_refund_annual_reissue',
    });
    expect(replacementReceiptSnap.data()?.givingIds).toEqual(['annual-stale-refund-kept']);
    expect(replacementSummarySnap.data()).toMatchObject({
      receiptId: replacementReceiptId,
      status: 'sent',
      amountCents: 6500,
      eligibleAmountCents: 6500,
      donationCount: 1,
    });
    expect(counterSnap.data()).toMatchObject({ lastSequence: 32 });

    const events = await adminDb
      .collection('taxReceiptEvents')
      .where('receiptId', 'in', [staleReceiptId, replacementReceiptId])
      .get();
    expect(events.docs.map((doc) => doc.data())).toEqual(expect.arrayContaining([
      expect.objectContaining({
        action: 'voided',
        receiptId: staleReceiptId,
        reasonCode: 'stripe_full_refund',
      }),
      expect.objectContaining({
        action: 'email_sent',
        receiptId: replacementReceiptId,
      }),
    ]));
  });

  it('preserves missing annual receipt currency in voided staff summary mirrors', async () => {
    await adminDb.doc(`churches/${CHURCH_ID}`).update({
      timezone: 'America/Chicago',
      taxReceiptSettings: {
        enabled: true,
        eligibilityConfirmed: true,
        jurisdiction: 'US',
        organizationName: 'St. Nicholas Orthodox Church',
        organizationAddress: '123 Church Street, Chicago, IL',
        taxId: '12-3456789',
        receiptPrefix: 'STN',
        goodsServicesStatement:
          'No goods or services were provided in exchange for this contribution other than intangible religious benefits.',
        autoIssue: false,
      },
    });
    const staleReceiptId = annualTaxReceiptDocId(CHURCH_ID, 'member-1', CLOSED_ANNUAL_YEAR);

    await Promise.all([
      adminDb.doc('giving/annual-missing-currency-voided').set({
        churchId: CHURCH_ID,
        churchName: 'St. Nicholas',
        userId: 'member-1',
        donorName: 'Member One',
        donorEmail: '',
        anonymous: false,
        amount: 50,
        amountCents: 5000,
        currency: 'USD',
        purpose: 'General Fund',
        status: 'completed',
        stripeRefundStatus: 'refunded',
        stripeAmountRefundedCents: 5000,
        completedAt: Timestamp.fromDate(new Date(`${CLOSED_ANNUAL_YEAR}-03-10T16:00:00Z`)),
        refundedAt: Timestamp.fromDate(new Date(`${CLOSED_ANNUAL_YEAR + 1}-02-01T16:00:00Z`)),
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }),
      adminDb.doc(`taxReceipts/${staleReceiptId}`).set({
        churchId: CHURCH_ID,
        churchName: 'St. Nicholas',
        userId: 'member-1',
        givingId: '',
        givingIds: ['annual-missing-currency-voided'],
        kind: 'annual',
        status: 'sent',
        jurisdiction: 'US',
        receiptNumber: expectedReceiptNumber(CLOSED_ANNUAL_YEAR, 52),
        receiptYear: CLOSED_ANNUAL_YEAR,
        annualYear: CLOSED_ANNUAL_YEAR,
        organizationName: 'St. Nicholas Orthodox Church',
        organizationAddress: '123 Church Street, Chicago, IL',
        organizationTaxId: '12-3456789',
        donorLabel: 'Member One',
        donorAnonymous: false,
        donorName: 'Member One',
        donorEmail: 'member@example.com',
        amountCents: 5000,
        eligibleAmountCents: 5000,
        purpose: 'Annual giving summary',
        donationCount: 1,
        receivedDateLabel: `January 1 - December 31, ${CLOSED_ANNUAL_YEAR}`,
        coveredPeriodLabel: `January 1 - December 31, ${CLOSED_ANNUAL_YEAR}`,
        issuedAt: Timestamp.fromDate(new Date(`${CLOSED_ANNUAL_YEAR + 1}-01-15T12:00:00Z`)),
        issuedDateLabel: `January 15, ${CLOSED_ANNUAL_YEAR + 1}`,
        goodsServicesStatement:
          'No goods or services were provided in exchange for this contribution other than intangible religious benefits.',
        emailSentAt: Timestamp.fromDate(new Date(`${CLOSED_ANNUAL_YEAR + 1}-01-15T12:05:00Z`)),
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }),
      adminDb.doc(`taxReceiptSummaries/${staleReceiptId}`).set({
        receiptId: staleReceiptId,
        churchId: CHURCH_ID,
        userId: 'member-1',
        donorLabel: 'Member One',
        donorAnonymous: false,
        kind: 'annual',
        status: 'sent',
        receiptNumber: expectedReceiptNumber(CLOSED_ANNUAL_YEAR, 52),
        receiptYear: CLOSED_ANNUAL_YEAR,
        annualYear: CLOSED_ANNUAL_YEAR,
        amountCents: 5000,
        eligibleAmountCents: 5000,
        currency: 'USD',
        donationCount: 1,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }),
    ]);

    await expectCallableFails(
      callCallable(
        'sendAnnualTaxReceipt',
        { churchId: CHURCH_ID, year: CLOSED_ANNUAL_YEAR },
        { uid: 'member-1', email: 'member@example.com' }
      ),
      'failed-precondition'
    );

    const [receiptSnap, summarySnap] = await Promise.all([
      adminDb.doc(`taxReceipts/${staleReceiptId}`).get(),
      adminDb.doc(`taxReceiptSummaries/${staleReceiptId}`).get(),
    ]);

    expect(receiptSnap.data()).toMatchObject({
      status: 'voided',
      voidReason: 'stripe_full_refund',
      voidedBy: 'system',
    });
    expect(summarySnap.data()).toMatchObject({
      receiptId: staleReceiptId,
      status: 'voided',
      voidReason: 'stripe_full_refund',
      currency: '',
    });
  });

  it('blocks stored annual receipt resends and PDF downloads when donor-year giving changes', async () => {
    await adminDb.doc(`churches/${CHURCH_ID}`).update({
      timezone: 'America/Chicago',
      taxReceiptSettings: {
        enabled: true,
        eligibilityConfirmed: true,
        jurisdiction: 'US',
        organizationName: 'St. Nicholas Orthodox Church',
        organizationAddress: '123 Church Street, Chicago, IL',
        taxId: '12-3456789',
        receiptPrefix: 'STN',
        goodsServicesStatement:
          'No goods or services were provided in exchange for this contribution other than intangible religious benefits.',
        autoIssue: false,
      },
    });
    const staleReceiptId = annualTaxReceiptDocId(CHURCH_ID, 'member-1', CLOSED_ANNUAL_YEAR);
    const originalEmailSentAt = Timestamp.fromDate(new Date(`${CLOSED_ANNUAL_YEAR + 1}-01-15T12:05:00Z`));
    await Promise.all([
      adminDb.doc(`taxReceiptCounters/${CHURCH_ID}_${CLOSED_ANNUAL_YEAR}`).set({
        churchId: CHURCH_ID,
        year: CLOSED_ANNUAL_YEAR,
        lastSequence: 44,
        updatedAt: FieldValue.serverTimestamp(),
      }),
      adminDb.doc('giving/annual-giving-set-original').set({
        churchId: CHURCH_ID,
        churchName: 'St. Nicholas',
        userId: 'member-1',
        donorName: 'Member One',
        donorEmail: '',
        anonymous: false,
        churchReceiptVisible: true,
        donorNamePublicSafe: true,
        receiptManagerGivingSafeVersion: 1,
        amount: 30,
        amountCents: 3000,
        currency: 'USD',
        purpose: 'General Fund',
        status: 'completed',
        completedAt: Timestamp.fromDate(new Date(`${CLOSED_ANNUAL_YEAR}-03-10T16:00:00Z`)),
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }),
      adminDb.doc('giving/annual-giving-set-late').set({
        churchId: CHURCH_ID,
        churchName: 'St. Nicholas',
        userId: 'member-1',
        donorName: 'Member One',
        donorEmail: '',
        anonymous: false,
        churchReceiptVisible: true,
        donorNamePublicSafe: true,
        receiptManagerGivingSafeVersion: 1,
        amount: 45,
        amountCents: 4500,
        currency: 'USD',
        purpose: 'Building Fund',
        status: 'completed',
        completedAt: Timestamp.fromDate(new Date(`${CLOSED_ANNUAL_YEAR}-11-20T16:00:00Z`)),
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }),
      adminDb.doc(`taxReceipts/${staleReceiptId}`).set({
        churchId: CHURCH_ID,
        churchName: 'St. Nicholas',
        userId: 'member-1',
        givingId: '',
        givingIds: ['annual-giving-set-original'],
        kind: 'annual',
        status: 'sent',
        jurisdiction: 'US',
        receiptNumber: expectedReceiptNumber(CLOSED_ANNUAL_YEAR, 44),
        receiptYear: CLOSED_ANNUAL_YEAR,
        annualYear: CLOSED_ANNUAL_YEAR,
        organizationName: 'St. Nicholas Orthodox Church',
        organizationAddress: '123 Church Street, Chicago, IL',
        organizationTaxId: '12-3456789',
        donorLabel: 'Member One',
        donorAnonymous: false,
        donorName: 'Member One',
        donorEmail: 'member@example.com',
        amountCents: 3000,
        eligibleAmountCents: 3000,
        currency: 'USD',
        purpose: 'Annual giving summary',
        donationCount: 1,
        receivedDateLabel: `January 1 - December 31, ${CLOSED_ANNUAL_YEAR}`,
        coveredPeriodLabel: `January 1 - December 31, ${CLOSED_ANNUAL_YEAR}`,
        issuedAt: Timestamp.fromDate(new Date(`${CLOSED_ANNUAL_YEAR + 1}-01-15T12:00:00Z`)),
        issuedDateLabel: `January 15, ${CLOSED_ANNUAL_YEAR + 1}`,
        goodsServicesStatement:
          'No goods or services were provided in exchange for this contribution other than intangible religious benefits.',
        emailSentAt: originalEmailSentAt,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }),
      adminDb.doc(`taxReceiptSummaries/${staleReceiptId}`).set({
        receiptId: staleReceiptId,
        churchId: CHURCH_ID,
        userId: 'member-1',
        donorLabel: 'Member One',
        donorAnonymous: false,
        kind: 'annual',
        status: 'sent',
        receiptNumber: expectedReceiptNumber(CLOSED_ANNUAL_YEAR, 44),
        receiptYear: CLOSED_ANNUAL_YEAR,
        annualYear: CLOSED_ANNUAL_YEAR,
        amountCents: 3000,
        eligibleAmountCents: 3000,
        currency: 'USD',
        donationCount: 1,
        issuedAt: Timestamp.fromDate(new Date(`${CLOSED_ANNUAL_YEAR + 1}-01-15T12:00:00Z`)),
        emailSentAt: originalEmailSentAt,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }),
    ]);

    await expectCallableFails(
      callCallable(
        'sendAnnualTaxReceipt',
        { churchId: CHURCH_ID, year: CLOSED_ANNUAL_YEAR },
        { uid: 'member-1', email: 'member@example.com' }
      ),
      'failed-precondition'
    );
    await expectCallableFails(
      callCallable(
        'sendAnnualTaxReceipt',
        { churchId: CHURCH_ID, userId: 'member-1', year: CLOSED_ANNUAL_YEAR },
        { uid: 'treasurer-1', email: 'treasurer@example.com' }
      ),
      'failed-precondition'
    );
    await expectCallableFails(
      callCallable(
        'downloadTaxReceiptPdf',
        { receiptId: staleReceiptId },
        { uid: 'member-1', email: 'member@example.com' }
      ),
      'failed-precondition'
    );

    const [receiptSnap, summarySnap, counterSnap, eventsSnap] = await Promise.all([
      adminDb.doc(`taxReceipts/${staleReceiptId}`).get(),
      adminDb.doc(`taxReceiptSummaries/${staleReceiptId}`).get(),
      adminDb.doc(`taxReceiptCounters/${CHURCH_ID}_${CLOSED_ANNUAL_YEAR}`).get(),
      adminDb
        .collection('taxReceiptEvents')
        .where('receiptId', '==', staleReceiptId)
        .get(),
    ]);
    expect(receiptSnap.data()).toMatchObject({
      status: 'sent',
      receiptNumber: expectedReceiptNumber(CLOSED_ANNUAL_YEAR, 44),
      amountCents: 3000,
      eligibleAmountCents: 3000,
      donationCount: 1,
      emailSentAt: originalEmailSentAt,
    });
    expect(receiptSnap.data()?.givingIds).toEqual(['annual-giving-set-original']);
    expect(receiptSnap.data()).not.toHaveProperty('emailSendingAt');
    expect(receiptSnap.data()).not.toHaveProperty('correctionRequired');
    expect(receiptSnap.data()).not.toHaveProperty('voidReason');
    expect(summarySnap.data()).toMatchObject({
      status: 'sent',
      amountCents: 3000,
      eligibleAmountCents: 3000,
      donationCount: 1,
      emailSentAt: originalEmailSentAt,
    });
    expect(counterSnap.data()).toMatchObject({ lastSequence: 44 });
    expect(eventsSnap.empty).toBe(true);
  });

  it('blocks stored annual receipt resends and PDF downloads when covered giving amounts change', async () => {
    await adminDb.doc(`churches/${CHURCH_ID}`).update({
      timezone: 'America/Chicago',
      taxReceiptSettings: {
        enabled: true,
        eligibilityConfirmed: true,
        jurisdiction: 'US',
        organizationName: 'St. Nicholas Orthodox Church',
        organizationAddress: '123 Church Street, Chicago, IL',
        taxId: '12-3456789',
        receiptPrefix: 'STN',
        goodsServicesStatement:
          'No goods or services were provided in exchange for this contribution other than intangible religious benefits.',
        autoIssue: false,
      },
    });
    const staleReceiptId = annualTaxReceiptDocId(CHURCH_ID, 'member-1', CLOSED_ANNUAL_YEAR);
    const originalEmailSentAt = Timestamp.fromDate(new Date(`${CLOSED_ANNUAL_YEAR + 1}-01-15T12:05:00Z`));
    await Promise.all([
      adminDb.doc('giving/annual-giving-amount-changed').set({
        churchId: CHURCH_ID,
        churchName: 'St. Nicholas',
        userId: 'member-1',
        donorName: 'Member One',
        donorEmail: '',
        anonymous: false,
        churchReceiptVisible: true,
        donorNamePublicSafe: true,
        receiptManagerGivingSafeVersion: 1,
        amount: 45,
        amountCents: 4500,
        currency: 'USD',
        purpose: 'General Fund',
        status: 'completed',
        completedAt: Timestamp.fromDate(new Date(`${CLOSED_ANNUAL_YEAR}-03-10T16:00:00Z`)),
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }),
      adminDb.doc(`taxReceipts/${staleReceiptId}`).set({
        churchId: CHURCH_ID,
        churchName: 'St. Nicholas',
        userId: 'member-1',
        givingId: '',
        givingIds: ['annual-giving-amount-changed'],
        kind: 'annual',
        status: 'sent',
        jurisdiction: 'US',
        receiptNumber: expectedReceiptNumber(CLOSED_ANNUAL_YEAR, 45),
        receiptYear: CLOSED_ANNUAL_YEAR,
        annualYear: CLOSED_ANNUAL_YEAR,
        organizationName: 'St. Nicholas Orthodox Church',
        organizationAddress: '123 Church Street, Chicago, IL',
        organizationTaxId: '12-3456789',
        donorLabel: 'Member One',
        donorAnonymous: false,
        donorName: 'Member One',
        donorEmail: 'member@example.com',
        amountCents: 3000,
        eligibleAmountCents: 3000,
        currency: 'USD',
        purpose: 'Annual giving summary',
        donationCount: 1,
        receivedDateLabel: `January 1 - December 31, ${CLOSED_ANNUAL_YEAR}`,
        coveredPeriodLabel: `January 1 - December 31, ${CLOSED_ANNUAL_YEAR}`,
        issuedAt: Timestamp.fromDate(new Date(`${CLOSED_ANNUAL_YEAR + 1}-01-15T12:00:00Z`)),
        issuedDateLabel: `January 15, ${CLOSED_ANNUAL_YEAR + 1}`,
        goodsServicesStatement:
          'No goods or services were provided in exchange for this contribution other than intangible religious benefits.',
        emailSentAt: originalEmailSentAt,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }),
    ]);

    await expectCallableFails(
      callCallable(
        'sendAnnualTaxReceipt',
        { churchId: CHURCH_ID, year: CLOSED_ANNUAL_YEAR },
        { uid: 'member-1', email: 'member@example.com' }
      ),
      'failed-precondition'
    );
    await expectCallableFails(
      callCallable(
        'downloadTaxReceiptPdf',
        { receiptId: staleReceiptId },
        { uid: 'member-1', email: 'member@example.com' }
      ),
      'failed-precondition'
    );
    expect((await adminDb.doc(`taxReceipts/${staleReceiptId}`).get()).data()).toMatchObject({
      status: 'sent',
      receiptNumber: expectedReceiptNumber(CLOSED_ANNUAL_YEAR, 45),
      amountCents: 3000,
      eligibleAmountCents: 3000,
      donationCount: 1,
      emailSentAt: originalEmailSentAt,
    });
  });

  it('blocks annual PDF downloads when contribution detail is missing', async () => {
    await adminDb.doc(`churches/${CHURCH_ID}`).update({
      timezone: 'America/Chicago',
      taxReceiptSettings: {
        enabled: true,
        eligibilityConfirmed: true,
        jurisdiction: 'US',
        organizationName: 'St. Nicholas Orthodox Church',
        organizationAddress: '123 Church Street, Chicago, IL',
        taxId: '12-3456789',
        receiptPrefix: 'STN',
        goodsServicesStatement:
          'No goods or services were provided in exchange for this contribution other than intangible religious benefits.',
        autoIssue: false,
      },
    });
    const receiptId = annualTaxReceiptDocId(CHURCH_ID, 'member-1', CLOSED_ANNUAL_YEAR);

    await Promise.all([
      adminDb.doc('giving/annual-missing-contributions-download').set({
        churchId: CHURCH_ID,
        churchName: 'St. Nicholas',
        userId: 'member-1',
        donorName: 'Member One',
        donorEmail: '',
        anonymous: false,
        amount: 50,
        amountCents: 5000,
        currency: 'USD',
        purpose: 'General Fund',
        status: 'completed',
        completedAt: Timestamp.fromDate(new Date(`${CLOSED_ANNUAL_YEAR}-03-10T16:00:00Z`)),
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }),
      adminDb.doc(`taxReceipts/${receiptId}`).set({
        churchId: CHURCH_ID,
        churchName: 'St. Nicholas',
        userId: 'member-1',
        givingId: '',
        givingIds: ['annual-missing-contributions-download'],
        kind: 'annual',
        status: 'sent',
        jurisdiction: 'US',
        receiptNumber: expectedReceiptNumber(CLOSED_ANNUAL_YEAR, 54),
        receiptYear: CLOSED_ANNUAL_YEAR,
        annualYear: CLOSED_ANNUAL_YEAR,
        organizationName: 'St. Nicholas Orthodox Church',
        organizationAddress: '123 Church Street, Chicago, IL',
        organizationTaxId: '12-3456789',
        donorLabel: 'Member One',
        donorAnonymous: false,
        donorName: 'Member One',
        donorEmail: 'member@example.com',
        amountCents: 5000,
        eligibleAmountCents: 5000,
        currency: 'USD',
        purpose: 'Annual giving summary',
        donationCount: 1,
        receivedDateLabel: `January 1 - December 31, ${CLOSED_ANNUAL_YEAR}`,
        coveredPeriodLabel: `January 1 - December 31, ${CLOSED_ANNUAL_YEAR}`,
        issuedAt: Timestamp.fromDate(new Date(`${CLOSED_ANNUAL_YEAR + 1}-01-15T12:00:00Z`)),
        issuedDateLabel: `January 15, ${CLOSED_ANNUAL_YEAR + 1}`,
        goodsServicesStatement:
          'No goods or services were provided in exchange for this contribution other than intangible religious benefits.',
        emailSentAt: Timestamp.fromDate(new Date(`${CLOSED_ANNUAL_YEAR + 1}-01-15T12:05:00Z`)),
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }),
    ]);

    await expect(
      callCallable(
        'downloadTaxReceiptPdf',
        { receiptId },
        { uid: 'member-1', email: 'member@example.com' }
      )
    ).rejects.toMatchObject({
      status: 'FAILED_PRECONDITION',
      body: {
        error: {
          details: {
            errorCode: 'tax_receipt_annual_giving_changed_review_required',
          },
        },
      },
    });

    const [receiptSnap, eventsSnap] = await Promise.all([
      adminDb.doc(`taxReceipts/${receiptId}`).get(),
      adminDb
        .collection('taxReceiptEvents')
        .where('receiptId', '==', receiptId)
        .get(),
    ]);
    expect(receiptSnap.data()).not.toHaveProperty('pdfStoragePath');
    expect(receiptSnap.data()).not.toHaveProperty('pdfSha256');
    expect(eventsSnap.docs.map((doc) => doc.data())).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ action: 'pdf_downloaded' }),
    ]));
  });

  it('normalizes malformed annual PDF download verification failures without safe public codes', async () => {
    const receiptId = 'annual_malformed_no_code_download';
    await adminDb.doc(`taxReceipts/${receiptId}`).set({
      userId: 'member-1',
      givingId: '',
      givingIds: [],
      kind: 'annual',
      status: 'sent',
      jurisdiction: 'US',
      receiptNumber: expectedReceiptNumber(CLOSED_ANNUAL_YEAR, 58),
      receiptYear: CLOSED_ANNUAL_YEAR,
      annualYear: CLOSED_ANNUAL_YEAR,
      organizationName: 'St. Nicholas Orthodox Church',
      organizationAddress: '123 Church Street, Chicago, IL',
      organizationTaxId: '12-3456789',
      donorName: 'Member One',
      donorEmail: 'member@example.com',
      amountCents: 5000,
      eligibleAmountCents: 5000,
      currency: 'USD',
      purpose: 'Annual giving summary',
      donationCount: 1,
      contributions: [
        {
          dateLabel: 'March 10, 2024',
          purpose: 'General Fund',
          amountCents: 5000,
          eligibleAmountCents: 5000,
          currency: 'USD',
        },
      ],
      receivedDateLabel: `January 1 - December 31, ${CLOSED_ANNUAL_YEAR}`,
      coveredPeriodLabel: `January 1 - December 31, ${CLOSED_ANNUAL_YEAR}`,
      issuedAt: Timestamp.fromDate(new Date(`${CLOSED_ANNUAL_YEAR + 1}-01-15T12:00:00Z`)),
      issuedDateLabel: `January 15, ${CLOSED_ANNUAL_YEAR + 1}`,
      goodsServicesStatement:
        'No goods or services were provided in exchange for this contribution other than intangible religious benefits.',
      emailSentAt: Timestamp.fromDate(new Date(`${CLOSED_ANNUAL_YEAR + 1}-01-15T12:05:00Z`)),
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    await expect(
      callCallable(
        'downloadTaxReceiptPdf',
        { receiptId },
        { uid: 'member-1', email: 'member@example.com' }
      )
    ).rejects.toMatchObject({
      status: 'INTERNAL',
      body: {
        error: {
          details: {
            errorCode: 'tax_receipt_preparation_failed',
          },
        },
      },
    });

    const [receiptSnap, eventsSnap] = await Promise.all([
      adminDb.doc(`taxReceipts/${receiptId}`).get(),
      adminDb
        .collection('taxReceiptEvents')
        .where('receiptId', '==', receiptId)
        .get(),
    ]);
    expect(receiptSnap.data()).not.toHaveProperty('pdfStoragePath');
    expect(receiptSnap.data()).not.toHaveProperty('pdfSha256');
    expect(eventsSnap.docs.map((doc) => doc.data())).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ action: 'pdf_downloaded' }),
    ]));
  });

  it('blocks annual PDF downloads when contribution detail no longer matches giving', async () => {
    await adminDb.doc(`churches/${CHURCH_ID}`).update({
      timezone: 'America/Chicago',
      taxReceiptSettings: {
        enabled: true,
        eligibilityConfirmed: true,
        jurisdiction: 'US',
        organizationName: 'St. Nicholas Orthodox Church',
        organizationAddress: '123 Church Street, Chicago, IL',
        taxId: '12-3456789',
        receiptPrefix: 'STN',
        goodsServicesStatement:
          'No goods or services were provided in exchange for this contribution other than intangible religious benefits.',
        autoIssue: false,
      },
    });
    const receiptId = annualTaxReceiptDocId(CHURCH_ID, 'member-1', CLOSED_ANNUAL_YEAR);

    await Promise.all([
      adminDb.doc('giving/annual-stale-contribution-line-download').set({
        churchId: CHURCH_ID,
        churchName: 'St. Nicholas',
        userId: 'member-1',
        donorName: 'Member One',
        donorEmail: '',
        anonymous: false,
        amount: 50,
        amountCents: 5000,
        currency: 'USD',
        purpose: 'General Fund',
        status: 'completed',
        completedAt: Timestamp.fromDate(new Date(`${CLOSED_ANNUAL_YEAR}-03-10T16:00:00Z`)),
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }),
      adminDb.doc(`taxReceipts/${receiptId}`).set({
        churchId: CHURCH_ID,
        churchName: 'St. Nicholas',
        userId: 'member-1',
        givingId: '',
        givingIds: ['annual-stale-contribution-line-download'],
        kind: 'annual',
        status: 'sent',
        jurisdiction: 'US',
        receiptNumber: expectedReceiptNumber(CLOSED_ANNUAL_YEAR, 55),
        receiptYear: CLOSED_ANNUAL_YEAR,
        annualYear: CLOSED_ANNUAL_YEAR,
        organizationName: 'St. Nicholas Orthodox Church',
        organizationAddress: '123 Church Street, Chicago, IL',
        organizationTaxId: '12-3456789',
        donorLabel: 'Member One',
        donorAnonymous: false,
        donorName: 'Member One',
        donorEmail: 'member@example.com',
        amountCents: 5000,
        eligibleAmountCents: 5000,
        currency: 'USD',
        purpose: 'Annual giving summary',
        donationCount: 1,
        contributions: [
          {
            dateLabel: `March 10, ${CLOSED_ANNUAL_YEAR}`,
            purpose: 'Building Fund',
            amountCents: 5000,
            eligibleAmountCents: 5000,
            currency: 'USD',
          },
        ],
        receivedDateLabel: `January 1 - December 31, ${CLOSED_ANNUAL_YEAR}`,
        coveredPeriodLabel: `January 1 - December 31, ${CLOSED_ANNUAL_YEAR}`,
        issuedAt: Timestamp.fromDate(new Date(`${CLOSED_ANNUAL_YEAR + 1}-01-15T12:00:00Z`)),
        issuedDateLabel: `January 15, ${CLOSED_ANNUAL_YEAR + 1}`,
        goodsServicesStatement:
          'No goods or services were provided in exchange for this contribution other than intangible religious benefits.',
        emailSentAt: Timestamp.fromDate(new Date(`${CLOSED_ANNUAL_YEAR + 1}-01-15T12:05:00Z`)),
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }),
    ]);

    await expect(
      callCallable(
        'downloadTaxReceiptPdf',
        { receiptId },
        { uid: 'member-1', email: 'member@example.com' }
      )
    ).rejects.toMatchObject({
      status: 'FAILED_PRECONDITION',
      body: {
        error: {
          details: {
            errorCode: 'tax_receipt_annual_giving_changed_review_required',
          },
        },
      },
    });

    const [receiptSnap, eventsSnap] = await Promise.all([
      adminDb.doc(`taxReceipts/${receiptId}`).get(),
      adminDb
        .collection('taxReceiptEvents')
        .where('receiptId', '==', receiptId)
        .get(),
    ]);
    expect(receiptSnap.data()).not.toHaveProperty('pdfStoragePath');
    expect(receiptSnap.data()).not.toHaveProperty('pdfSha256');
    expect(eventsSnap.docs.map((doc) => doc.data())).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ action: 'pdf_downloaded' }),
    ]));
  });

  it('reissues full-refund-voided annual receipts from church annual batches', async () => {
    await adminDb.doc(`churches/${CHURCH_ID}`).update({
      timezone: 'America/Chicago',
      taxReceiptSettings: {
        enabled: true,
        eligibilityConfirmed: true,
        jurisdiction: 'US',
        organizationName: 'St. Nicholas Orthodox Church',
        organizationAddress: '123 Church Street, Chicago, IL',
        taxId: '12-3456789',
        receiptPrefix: 'STN',
        goodsServicesStatement:
          'No goods or services were provided in exchange for this contribution other than intangible religious benefits.',
        autoIssue: false,
      },
    });
    const originalReceiptId = annualTaxReceiptDocId(CHURCH_ID, 'member-1', CLOSED_ANNUAL_YEAR);
    const reissuedReceiptId = reissuedAnnualTaxReceiptDocId(
      CHURCH_ID,
      'member-1',
      CLOSED_ANNUAL_YEAR,
      'bulk-annual-reissue-kept:7000:0'
    );

    await Promise.all([
      adminDb.doc(`taxReceiptCounters/${CHURCH_ID}_${CLOSED_ANNUAL_YEAR}`).set({
        churchId: CHURCH_ID,
        year: CLOSED_ANNUAL_YEAR,
        lastSequence: 40,
        updatedAt: FieldValue.serverTimestamp(),
      }),
      adminDb.doc('giving/bulk-annual-reissue-refunded').set({
        churchId: CHURCH_ID,
        churchName: 'St. Nicholas',
        userId: 'member-1',
        donorName: 'Member One',
        donorEmail: '',
        anonymous: false,
        amount: 50,
        amountCents: 5000,
        currency: 'USD',
        purpose: 'General Fund',
        status: 'refunded',
        stripeRefundStatus: 'refunded',
        stripeAmountRefundedCents: 5000,
        completedAt: Timestamp.fromDate(new Date(`${CLOSED_ANNUAL_YEAR}-03-10T16:00:00Z`)),
        refundedAt: Timestamp.fromDate(new Date(`${CLOSED_ANNUAL_YEAR + 1}-02-01T16:00:00Z`)),
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }),
      adminDb.doc('giving/bulk-annual-reissue-kept').set({
        churchId: CHURCH_ID,
        churchName: 'St. Nicholas',
        userId: 'member-1',
        donorName: 'Member One',
        donorEmail: '',
        anonymous: false,
        amount: 70,
        amountCents: 7000,
        currency: 'USD',
        purpose: 'Building Fund',
        status: 'completed',
        completedAt: Timestamp.fromDate(new Date(`${CLOSED_ANNUAL_YEAR}-09-15T16:00:00Z`)),
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }),
      adminDb.doc(`taxReceipts/${originalReceiptId}`).set({
        churchId: CHURCH_ID,
        churchName: 'St. Nicholas',
        userId: 'member-1',
        givingId: '',
        givingIds: ['bulk-annual-reissue-refunded', 'bulk-annual-reissue-kept'],
        kind: 'annual',
        status: 'voided',
        voidReason: 'stripe_full_refund',
        receiptNumber: expectedReceiptNumber(CLOSED_ANNUAL_YEAR, 40),
        receiptYear: CLOSED_ANNUAL_YEAR,
        annualYear: CLOSED_ANNUAL_YEAR,
        amountCents: 12000,
        eligibleAmountCents: 12000,
        currency: 'USD',
        donationCount: 2,
        issuedAt: Timestamp.fromDate(new Date(`${CLOSED_ANNUAL_YEAR + 1}-01-15T12:00:00Z`)),
        voidedAt: Timestamp.fromDate(new Date(`${CLOSED_ANNUAL_YEAR + 1}-02-01T16:00:00Z`)),
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }),
    ]);

    await expect(
      callCallable(
        'sendChurchAnnualTaxReceipts',
        { churchId: CHURCH_ID, year: CLOSED_ANNUAL_YEAR },
        { uid: 'priest-1', email: 'priest@example.com' }
      )
    ).resolves.toMatchObject({
      success: true,
      donorCount: 1,
      createdCount: 1,
      emailSentCount: 1,
      skippedCount: 0,
      failedCount: 0,
      truncated: false,
    });

    const [originalReceiptSnap, reissuedReceiptSnap, reissuedSummarySnap, counterSnap] = await Promise.all([
      adminDb.doc(`taxReceipts/${originalReceiptId}`).get(),
      adminDb.doc(`taxReceipts/${reissuedReceiptId}`).get(),
      adminDb.doc(`taxReceiptSummaries/${reissuedReceiptId}`).get(),
      adminDb.doc(`taxReceiptCounters/${CHURCH_ID}_${CLOSED_ANNUAL_YEAR}`).get(),
    ]);
    expect(originalReceiptSnap.data()).toMatchObject({
      status: 'voided',
      voidReason: 'stripe_full_refund',
    });
    expect(reissuedReceiptSnap.data()).toMatchObject({
      userId: 'member-1',
      kind: 'annual',
      status: 'sent',
      receiptNumber: expectedReceiptNumber(CLOSED_ANNUAL_YEAR, 41),
      amountCents: 7000,
      eligibleAmountCents: 7000,
      donationCount: 1,
      correctionForReceiptId: originalReceiptId,
      correctionSourceReason: 'stripe_full_refund_annual_reissue',
    });
    expect(reissuedReceiptSnap.data()?.givingIds).toEqual(['bulk-annual-reissue-kept']);
    expect(reissuedSummarySnap.data()).toMatchObject({
      receiptId: reissuedReceiptId,
      userId: 'member-1',
      status: 'sent',
      receiptNumber: expectedReceiptNumber(CLOSED_ANNUAL_YEAR, 41),
      amountCents: 7000,
      eligibleAmountCents: 7000,
      donationCount: 1,
    });
    expect(counterSnap.data()).toMatchObject({ lastSequence: 41 });

    await expect(
      callCallable(
        'sendChurchAnnualTaxReceipts',
        { churchId: CHURCH_ID, year: CLOSED_ANNUAL_YEAR },
        { uid: 'treasurer-1', email: 'treasurer@example.com' }
      )
    ).resolves.toMatchObject({
      success: true,
      donorCount: 1,
      createdCount: 0,
      emailSentCount: 0,
      skippedCount: 1,
      failedCount: 0,
      truncated: false,
    });
  });

  it('lets priests send annual tax receipt batches for all donors in a closed church year', async () => {
    await adminDb.doc(`churches/${CHURCH_ID}`).update({
      timezone: 'America/Chicago',
      taxReceiptSettings: {
        enabled: true,
        eligibilityConfirmed: true,
        jurisdiction: 'US',
        organizationName: 'St. Nicholas Orthodox Church',
        organizationAddress: '123 Church Street, Chicago, IL',
        taxId: '12-3456789',
        receiptPrefix: 'STN',
        goodsServicesStatement:
          'No goods or services were provided in exchange for this contribution other than intangible religious benefits.',
        autoIssue: false,
      },
    });
    await Promise.all([
      adminDb.doc('giving/bulk-annual-member').set({
        churchId: CHURCH_ID,
        churchName: 'St. Nicholas',
        userId: 'member-1',
        donorName: 'Member One',
        donorEmail: '',
        anonymous: false,
        churchReceiptVisible: true,
        donorNamePublicSafe: true,
        receiptManagerGivingSafeVersion: 1,
        amount: 40,
        amountCents: 4000,
        currency: 'USD',
        purpose: 'General Fund',
        status: 'completed',
        completedAt: Timestamp.fromDate(new Date(`${CLOSED_ANNUAL_YEAR}-02-10T16:00:00Z`)),
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }),
      adminDb.doc('giving/bulk-annual-invitee').set({
        churchId: CHURCH_ID,
        churchName: 'St. Nicholas',
        userId: 'invitee-1',
        donorName: 'Invitee One',
        donorEmail: '',
        anonymous: false,
        churchReceiptVisible: true,
        donorNamePublicSafe: true,
        receiptManagerGivingSafeVersion: 1,
        amount: 60,
        amountCents: 6000,
        currency: 'USD',
        purpose: 'Building Fund',
        status: 'completed',
        completedAt: Timestamp.fromDate(new Date(`${CLOSED_ANNUAL_YEAR}-04-10T16:00:00Z`)),
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }),
      adminDb.doc('giving/bulk-annual-pending').set({
        churchId: CHURCH_ID,
        churchName: 'St. Nicholas',
        userId: 'other-1',
        donorName: 'Other One',
        donorEmail: 'other@example.com',
        amount: 90,
        amountCents: 9000,
        currency: 'USD',
        purpose: 'General Fund',
        status: 'pending',
        completedAt: Timestamp.fromDate(new Date(`${CLOSED_ANNUAL_YEAR}-04-10T16:00:00Z`)),
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }),
    ]);

    const result = await callCallable<
      { churchId: string; year: number },
      {
        success: boolean;
        donorCount: number;
        createdCount: number;
        emailSentCount: number;
        skippedCount: number;
        failedCount: number;
        truncated: boolean;
      }
    >(
      'sendChurchAnnualTaxReceipts',
      { churchId: CHURCH_ID, year: CLOSED_ANNUAL_YEAR },
      { uid: 'priest-1', email: 'priest@example.com' }
    );

    expect(result).toMatchObject({
      success: true,
      donorCount: 2,
      createdCount: 2,
      emailSentCount: 2,
      skippedCount: 0,
      failedCount: 0,
      truncated: false,
    });

    const receipts = await adminDb
      .collection('taxReceipts')
      .where('churchId', '==', CHURCH_ID)
      .where('kind', '==', 'annual')
      .get();
    const summaries = await adminDb
      .collection('taxReceiptSummaries')
      .where('churchId', '==', CHURCH_ID)
      .where('kind', '==', 'annual')
      .get();
    expect(receipts.docs.map((doc) => doc.data().userId).sort()).toEqual(['invitee-1', 'member-1']);
    expect(receipts.docs.map((doc) => doc.data().amountCents).sort((a, b) => a - b)).toEqual([4000, 6000]);
    expect(summaries.docs.map((doc) => doc.data().userId).sort()).toEqual(['invitee-1', 'member-1']);
    expect(summaries.docs.map((doc) => doc.data().status)).toEqual(['sent', 'sent']);
    expect(summaries.docs.map((doc) => doc.data().receiptManagerSummarySafeVersion)).toEqual([2, 2]);
    for (const summaryDoc of summaries.docs) {
      expect(summaryDoc.data()).toMatchObject({
        churchReceiptVisible: true,
        donorLabelPublicSafe: true,
        receiptManagerSummarySafe: true,
        receiptManagerSummarySafeVersion: 2,
        jurisdiction: 'US',
      });
      expect(summaryDoc.data()).not.toHaveProperty('donorEmail');
      expect(summaryDoc.data()).not.toHaveProperty('donorName');
      expect(summaryDoc.data()).not.toHaveProperty('donorAddress');
      expect(summaryDoc.data()).not.toHaveProperty('organizationTaxId');
      expect(summaryDoc.data()).not.toHaveProperty('givingIds');
      expect(summaryDoc.data()).not.toHaveProperty('contributions');
      expect(summaryDoc.data()).not.toHaveProperty('emailSendingAt');
      expect(summaryDoc.data()).not.toHaveProperty('emailSendAttemptId');
      expect(summaryDoc.data()).not.toHaveProperty('pdfStoragePath');
      expect(summaryDoc.data()).not.toHaveProperty('pdfSha256');
    }

    await expect(
      callCallable(
        'sendChurchAnnualTaxReceipts',
        { churchId: CHURCH_ID, year: CLOSED_ANNUAL_YEAR },
        { uid: 'treasurer-1', email: 'treasurer@example.com' }
      )
    ).resolves.toMatchObject({
      success: true,
      donorCount: 2,
      createdCount: 0,
      emailSentCount: 0,
      skippedCount: 2,
      failedCount: 0,
      truncated: false,
    });

    await expectCallableFails(
      callCallable(
        'sendChurchAnnualTaxReceipts',
        { churchId: CHURCH_ID, year: CLOSED_ANNUAL_YEAR },
        { uid: 'admin-1', email: 'admin@example.com' }
      ),
      'permission-denied'
    );
  });

  it('skips mixed- or missing-currency donor-years from annual batches for review without exposing donor ids', async () => {
    await adminDb.doc(`churches/${CHURCH_ID}`).update({
      timezone: 'America/Chicago',
      taxReceiptSettings: {
        enabled: true,
        eligibilityConfirmed: true,
        jurisdiction: 'US',
        organizationName: 'St. Nicholas Orthodox Church',
        organizationAddress: '123 Church Street, Chicago, IL',
        taxId: '12-3456789',
        receiptPrefix: 'STN',
        goodsServicesStatement:
          'No goods or services were provided in exchange for this contribution other than intangible religious benefits.',
        autoIssue: false,
      },
    });
    await Promise.all([
      adminDb.doc('giving/bulk-annual-mixed-usd').set({
        churchId: CHURCH_ID,
        churchName: 'St. Nicholas',
        userId: 'member-1',
        donorName: 'Member One',
        donorEmail: 'member@example.com',
        amount: 40,
        amountCents: 4000,
        currency: 'USD',
        purpose: 'General Fund',
        status: 'completed',
        completedAt: Timestamp.fromDate(new Date(`${CLOSED_ANNUAL_YEAR}-02-10T16:00:00Z`)),
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }),
      adminDb.doc('giving/bulk-annual-mixed-cad').set({
        churchId: CHURCH_ID,
        churchName: 'St. Nicholas',
        userId: 'member-1',
        donorName: 'Member One',
        donorEmail: 'member@example.com',
        amount: 60,
        amountCents: 6000,
        currency: 'CAD',
        purpose: 'Building Fund',
        status: 'completed',
        completedAt: Timestamp.fromDate(new Date(`${CLOSED_ANNUAL_YEAR}-04-10T16:00:00Z`)),
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }),
      adminDb.doc('giving/bulk-annual-missing-currency').set({
        churchId: CHURCH_ID,
        churchName: 'St. Nicholas',
        userId: 'invitee-1',
        donorName: 'Invitee One',
        donorEmail: 'invitee@example.com',
        amount: 35,
        amountCents: 3500,
        purpose: 'General Fund',
        status: 'completed',
        completedAt: Timestamp.fromDate(new Date(`${CLOSED_ANNUAL_YEAR}-03-10T16:00:00Z`)),
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }),
    ]);

    const result = await callCallable<
      { churchId: string; year: number },
      {
        success: boolean;
        donorCount: number;
        createdCount: number;
        emailSentCount: number;
        skippedCount: number;
        failedCount: number;
        truncated: boolean;
        failures: Array<{ code: string; userId?: string }>;
      }
    >(
      'sendChurchAnnualTaxReceipts',
      { churchId: CHURCH_ID, year: CLOSED_ANNUAL_YEAR },
      { uid: 'priest-1', email: 'priest@example.com' }
    );

    expect(result).toMatchObject({
      success: false,
      donorCount: 2,
      createdCount: 0,
      emailSentCount: 0,
      skippedCount: 0,
      failedCount: 2,
      truncated: false,
      failures: [
        { code: 'tax_receipt_annual_mixed_currency_review_required' },
        { code: 'tax_receipt_annual_mixed_currency_review_required' },
      ],
    });
    expect(result.failures[0]).not.toHaveProperty('userId');
    expect((await adminDb.doc(`taxReceipts/${annualTaxReceiptDocId(CHURCH_ID, 'member-1', CLOSED_ANNUAL_YEAR)}`).get()).exists)
      .toBe(false);
    expect((await adminDb.doc(`taxReceipts/${annualTaxReceiptDocId(CHURCH_ID, 'invitee-1', CLOSED_ANNUAL_YEAR)}`).get()).exists)
      .toBe(false);

    const eventData = (await adminDb.collection('taxReceiptEvents').get()).docs.map((doc) => doc.data());
    expect(eventData).toEqual(expect.arrayContaining([
      expect.objectContaining({
        action: 'annual_batch_item_failed',
        churchId: CHURCH_ID,
        userId: 'member-1',
        kind: 'annual',
        receiptYear: CLOSED_ANNUAL_YEAR,
        errorCode: 'tax_receipt_annual_mixed_currency_review_required',
      }),
      expect.objectContaining({
        action: 'annual_batch_item_failed',
        churchId: CHURCH_ID,
        userId: 'invitee-1',
        kind: 'annual',
        receiptYear: CLOSED_ANNUAL_YEAR,
        errorCode: 'tax_receipt_annual_mixed_currency_review_required',
      }),
    ]));
  });

  it('requires acknowledgement before annual batches include individually receipted gifts', async () => {
    await adminDb.doc(`churches/${CHURCH_ID}`).update({
      timezone: 'America/Chicago',
      taxReceiptSettings: {
        enabled: true,
        eligibilityConfirmed: true,
        jurisdiction: 'US',
        organizationName: 'St. Nicholas Orthodox Church',
        organizationAddress: '123 Church Street, Chicago, IL',
        taxId: '12-3456789',
        receiptPrefix: 'STN',
        goodsServicesStatement:
          'No goods or services were provided in exchange for this contribution other than intangible religious benefits.',
        autoIssue: false,
      },
    });
    await adminDb.doc('giving/bulk-annual-ack-member').set({
      churchId: CHURCH_ID,
      churchName: 'St. Nicholas',
      userId: 'member-1',
      donorName: 'Member One',
      donorEmail: '',
      anonymous: false,
      amount: 40,
      amountCents: 4000,
      currency: 'USD',
      purpose: 'General Fund',
      status: 'completed',
      taxReceiptId: 'bulk-annual-ack-member',
      taxReceiptNumber: expectedReceiptNumber(CLOSED_ANNUAL_YEAR, 10),
      taxReceiptStatus: 'sent',
      completedAt: Timestamp.fromDate(new Date(`${CLOSED_ANNUAL_YEAR}-02-10T16:00:00Z`)),
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    const unacknowledged = await callCallable<
      { churchId: string; year: number },
      {
        success: boolean;
        donorCount: number;
        createdCount: number;
        emailSentCount: number;
        skippedCount: number;
        failedCount: number;
        truncated: boolean;
        failures: Array<{ code: string }>;
      }
    >(
      'sendChurchAnnualTaxReceipts',
      { churchId: CHURCH_ID, year: CLOSED_ANNUAL_YEAR },
      { uid: 'priest-1', email: 'priest@example.com' }
    );
    expect(unacknowledged).toMatchObject({
      success: false,
      donorCount: 1,
      createdCount: 0,
      emailSentCount: 0,
      skippedCount: 0,
      failedCount: 1,
      truncated: false,
      failures: [{ code: 'tax_receipt_previously_receipted_ack_required' }],
    });
    const unacknowledgedReceipt = await adminDb
      .doc(`taxReceipts/${annualTaxReceiptDocId(CHURCH_ID, 'member-1', CLOSED_ANNUAL_YEAR)}`)
      .get();
    expect(unacknowledgedReceipt.exists).toBe(false);

    const acknowledged = await callCallable<
      { churchId: string; year: number; acknowledgePreviouslyReceipted?: boolean },
      {
        success: boolean;
        donorCount: number;
        createdCount: number;
        emailSentCount: number;
        skippedCount: number;
        failedCount: number;
        truncated: boolean;
      }
    >(
      'sendChurchAnnualTaxReceipts',
      {
        churchId: CHURCH_ID,
        year: CLOSED_ANNUAL_YEAR,
        acknowledgePreviouslyReceipted: true,
      },
      { uid: 'treasurer-1', email: 'treasurer@example.com' }
    );
    expect(acknowledged).toMatchObject({
      success: true,
      donorCount: 1,
      createdCount: 1,
      emailSentCount: 1,
      skippedCount: 0,
      failedCount: 0,
      truncated: false,
    });
    const acknowledgedReceipt = await adminDb
      .doc(`taxReceipts/${annualTaxReceiptDocId(CHURCH_ID, 'member-1', CLOSED_ANNUAL_YEAR)}`)
      .get();
    expect(acknowledgedReceipt.data()).toMatchObject({
      status: 'sent',
      includesPreviouslyReceipted: true,
    });
  });

  it('does not require annual batch acknowledgement for unassigned receipt-number markers', async () => {
    await adminDb.doc(`churches/${CHURCH_ID}`).update({
      timezone: 'America/Chicago',
      taxReceiptSettings: {
        enabled: true,
        eligibilityConfirmed: true,
        jurisdiction: 'US',
        organizationName: 'St. Nicholas Orthodox Church',
        organizationAddress: '123 Church Street, Chicago, IL',
        taxId: '12-3456789',
        receiptPrefix: 'STN',
        goodsServicesStatement:
          'No goods or services were provided in exchange for this contribution other than intangible religious benefits.',
        autoIssue: false,
      },
    });
    await adminDb.doc('giving/bulk-annual-unassigned-marker').set({
      churchId: CHURCH_ID,
      churchName: 'St. Nicholas',
      userId: 'member-1',
      donorName: 'Member One',
      donorEmail: '',
      anonymous: false,
      amount: 40,
      amountCents: 4000,
      currency: 'USD',
      purpose: 'General Fund',
      status: 'completed',
      taxReceiptId: 'bulk-annual-unassigned-marker',
      taxReceiptNumber: 'unassigned',
      taxReceiptStatus: 'sent',
      completedAt: Timestamp.fromDate(new Date(`${CLOSED_ANNUAL_YEAR}-02-10T16:00:00Z`)),
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    const result = await callCallable<
      { churchId: string; year: number },
      {
        success: boolean;
        donorCount: number;
        createdCount: number;
        emailSentCount: number;
        skippedCount: number;
        failedCount: number;
        truncated: boolean;
      }
    >(
      'sendChurchAnnualTaxReceipts',
      { churchId: CHURCH_ID, year: CLOSED_ANNUAL_YEAR },
      { uid: 'priest-1', email: 'priest@example.com' }
    );
    expect(result).toMatchObject({
      success: true,
      donorCount: 1,
      createdCount: 1,
      emailSentCount: 1,
      skippedCount: 0,
      failedCount: 0,
      truncated: false,
    });
    const receipt = await adminDb
      .doc(`taxReceipts/${annualTaxReceiptDocId(CHURCH_ID, 'member-1', CLOSED_ANNUAL_YEAR)}`)
      .get();
    expect(receipt.data()).toMatchObject({
      status: 'sent',
      includesPreviouslyReceipted: false,
    });
  });

  it('requires acknowledgement before corrected annual batches include individually receipted gifts', async () => {
    await adminDb.doc(`churches/${CHURCH_ID}`).update({
      timezone: 'America/Chicago',
      taxReceiptSettings: {
        enabled: true,
        eligibilityConfirmed: true,
        jurisdiction: 'US',
        organizationName: 'St. Nicholas Orthodox Church',
        organizationAddress: '123 Church Street, Chicago, IL',
        taxId: '12-3456789',
        receiptPrefix: 'STN',
        goodsServicesStatement:
          'No goods or services were provided in exchange for this contribution other than intangible religious benefits.',
        autoIssue: false,
      },
    });
    await adminDb.doc('giving/bulk-corrected-annual-ack-member').set({
      churchId: CHURCH_ID,
      churchName: 'St. Nicholas',
      userId: 'member-1',
      donorName: 'Member One',
      donorEmail: '',
      anonymous: false,
      amount: 40,
      amountCents: 4000,
      currency: 'USD',
      purpose: 'General Fund',
      status: 'completed',
      stripeRefundStatus: 'partially_refunded',
      stripeAmountRefundedCents: 1000,
      taxReceiptId: 'bulk-corrected-annual-ack-member-single',
      taxReceiptNumber: expectedReceiptNumber(CLOSED_ANNUAL_YEAR, 11),
      taxReceiptStatus: 'sent',
      taxReceiptCorrectionRequired: true,
      taxReceiptCorrectionReason: 'stripe_partial_refund_review_required',
      completedAt: Timestamp.fromDate(new Date(`${CLOSED_ANNUAL_YEAR}-02-10T16:00:00Z`)),
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    const unacknowledged = await callCallable<
      { churchId: string; year: number },
      {
        success: boolean;
        donorCount: number;
        createdCount: number;
        emailSentCount: number;
        skippedCount: number;
        failedCount: number;
        truncated: boolean;
        failures: Array<{ code: string }>;
      }
    >(
      'sendChurchCorrectedAnnualTaxReceipts',
      { churchId: CHURCH_ID, year: CLOSED_ANNUAL_YEAR },
      { uid: 'priest-1', email: 'priest@example.com' }
    );
    expect(unacknowledged).toMatchObject({
      success: false,
      donorCount: 1,
      createdCount: 0,
      emailSentCount: 0,
      skippedCount: 0,
      failedCount: 1,
      truncated: false,
      failures: [{ code: 'tax_receipt_previously_receipted_ack_required' }],
    });
    const correctedReceiptId = correctedAnnualTaxReceiptDocId(
      CHURCH_ID,
      'member-1',
      CLOSED_ANNUAL_YEAR,
      'bulk-corrected-annual-ack-member:4000:1000'
    );
    expect((await adminDb.doc(`taxReceipts/${correctedReceiptId}`).get()).exists).toBe(false);

    const acknowledged = await callCallable<
      { churchId: string; year: number; acknowledgePreviouslyReceipted?: boolean },
      {
        success: boolean;
        donorCount: number;
        createdCount: number;
        emailSentCount: number;
        skippedCount: number;
        failedCount: number;
        truncated: boolean;
      }
    >(
      'sendChurchCorrectedAnnualTaxReceipts',
      {
        churchId: CHURCH_ID,
        year: CLOSED_ANNUAL_YEAR,
        acknowledgePreviouslyReceipted: true,
      },
      { uid: 'treasurer-1', email: 'treasurer@example.com' }
    );
    expect(acknowledged).toMatchObject({
      success: true,
      donorCount: 1,
      createdCount: 1,
      emailSentCount: 1,
      skippedCount: 0,
      failedCount: 0,
      truncated: false,
    });
    expect((await adminDb.doc(`taxReceipts/${correctedReceiptId}`).get()).data()).toMatchObject({
      status: 'sent',
      includesPreviouslyReceipted: true,
      eligibleAmountCents: 3000,
      refundedAmountCents: 1000,
    });
  });

  it('does not require corrected annual batch acknowledgement for unassigned receipt-number markers', async () => {
    await adminDb.doc(`churches/${CHURCH_ID}`).update({
      timezone: 'America/Chicago',
      taxReceiptSettings: {
        enabled: true,
        eligibilityConfirmed: true,
        jurisdiction: 'US',
        organizationName: 'St. Nicholas Orthodox Church',
        organizationAddress: '123 Church Street, Chicago, IL',
        taxId: '12-3456789',
        receiptPrefix: 'STN',
        goodsServicesStatement:
          'No goods or services were provided in exchange for this contribution other than intangible religious benefits.',
        autoIssue: false,
      },
    });
    const givingId = 'bulk-corrected-annual-unassigned-marker';
    await adminDb.doc(`giving/${givingId}`).set({
      churchId: CHURCH_ID,
      churchName: 'St. Nicholas',
      userId: 'member-1',
      donorName: 'Member One',
      donorEmail: '',
      anonymous: false,
      amount: 40,
      amountCents: 4000,
      currency: 'USD',
      purpose: 'General Fund',
      status: 'completed',
      stripeRefundStatus: 'partially_refunded',
      stripeAmountRefundedCents: 1000,
      taxReceiptId: `${givingId}-single`,
      taxReceiptNumber: 'unassigned',
      taxReceiptStatus: 'sent',
      taxReceiptCorrectionRequired: true,
      taxReceiptCorrectionReason: 'stripe_partial_refund_review_required',
      completedAt: Timestamp.fromDate(new Date(`${CLOSED_ANNUAL_YEAR}-02-10T16:00:00Z`)),
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    const result = await callCallable<
      { churchId: string; year: number },
      {
        success: boolean;
        donorCount: number;
        createdCount: number;
        emailSentCount: number;
        skippedCount: number;
        failedCount: number;
        truncated: boolean;
      }
    >(
      'sendChurchCorrectedAnnualTaxReceipts',
      { churchId: CHURCH_ID, year: CLOSED_ANNUAL_YEAR },
      { uid: 'priest-1', email: 'priest@example.com' }
    );
    expect(result).toMatchObject({
      success: true,
      donorCount: 1,
      createdCount: 1,
      emailSentCount: 1,
      skippedCount: 0,
      failedCount: 0,
      truncated: false,
    });
    const correctedReceiptId = correctedAnnualTaxReceiptDocId(
      CHURCH_ID,
      'member-1',
      CLOSED_ANNUAL_YEAR,
      `${givingId}:4000:1000`
    );
    expect((await adminDb.doc(`taxReceipts/${correctedReceiptId}`).get()).data()).toMatchObject({
      status: 'sent',
      includesPreviouslyReceipted: false,
      eligibleAmountCents: 3000,
      refundedAmountCents: 1000,
    });
  });

  it('prioritizes unsent annual donor-years after already emailed batch entries', async () => {
    await adminDb.doc(`churches/${CHURCH_ID}`).update({
      timezone: 'America/Chicago',
      taxReceiptSettings: {
        enabled: true,
        eligibilityConfirmed: true,
        jurisdiction: 'US',
        organizationName: 'St. Nicholas Orthodox Church',
        organizationAddress: '123 Church Street, Chicago, IL',
        taxId: '12-3456789',
        receiptPrefix: 'STN',
        goodsServicesStatement:
          'No goods or services were provided in exchange for this contribution other than intangible religious benefits.',
        autoIssue: false,
      },
    });

    const existingSentEntries: Array<{ path: string; data: Record<string, unknown> }> = [];
    for (let index = 0; index < 250; index += 1) {
      const donorId = `bulk-sent-donor-${String(index).padStart(3, '0')}`;
      const givingId = `bulk-sent-giving-${String(index).padStart(3, '0')}`;
      const receiptId = annualTaxReceiptDocId(CHURCH_ID, donorId, CLOSED_ANNUAL_YEAR);
      existingSentEntries.push(
        {
          path: `giving/${givingId}`,
          data: {
            churchId: CHURCH_ID,
            churchName: 'St. Nicholas',
            userId: donorId,
            donorName: `Sent Donor ${index}`,
            donorEmail: '',
            amount: 10,
            amountCents: 1000,
            currency: 'USD',
            purpose: 'General Fund',
            status: 'completed',
            completedAt: Timestamp.fromDate(new Date(`${CLOSED_ANNUAL_YEAR}-01-01T12:00:00Z`)),
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
          },
        },
        {
          path: `taxReceipts/${receiptId}`,
          data: {
            churchId: CHURCH_ID,
            userId: donorId,
            kind: 'annual',
            status: 'sent',
            receiptNumber: expectedReceiptNumber(CLOSED_ANNUAL_YEAR, index + 1),
            receiptYear: CLOSED_ANNUAL_YEAR,
            annualYear: CLOSED_ANNUAL_YEAR,
            amountCents: 1000,
            eligibleAmountCents: 1000,
            donationCount: 1,
            emailSentAt: Timestamp.fromDate(new Date(`${CLOSED_ANNUAL_YEAR + 1}-01-15T12:00:00Z`)),
            issuedAt: Timestamp.fromDate(new Date(`${CLOSED_ANNUAL_YEAR + 1}-01-15T12:00:00Z`)),
          },
        }
      );
    }
    await setDocsInBatches(existingSentEntries);
    await Promise.all([
      adminDb.doc(`taxReceiptCounters/church-1_${CLOSED_ANNUAL_YEAR}`).set({
        churchId: CHURCH_ID,
        year: CLOSED_ANNUAL_YEAR,
        lastSequence: 250,
        updatedAt: FieldValue.serverTimestamp(),
      }),
      adminDb.doc('giving/bulk-annual-unsent-after-sent').set({
        churchId: CHURCH_ID,
        churchName: 'St. Nicholas',
        userId: 'member-1',
        donorName: 'Member One',
        donorEmail: 'member@example.com',
        amount: 45,
        amountCents: 4500,
        currency: 'USD',
        purpose: 'Building Fund',
        status: 'completed',
        completedAt: Timestamp.fromDate(new Date(`${CLOSED_ANNUAL_YEAR}-12-10T16:00:00Z`)),
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }),
    ]);

    const result = await callCallable<
      { churchId: string; year: number },
      {
        success: boolean;
        donorCount: number;
        createdCount: number;
        emailSentCount: number;
        skippedCount: number;
        failedCount: number;
        truncated: boolean;
      }
    >(
      'sendChurchAnnualTaxReceipts',
      { churchId: CHURCH_ID, year: CLOSED_ANNUAL_YEAR },
      { uid: 'priest-1', email: 'priest@example.com' }
    );

    expect(result).toMatchObject({
      success: true,
      donorCount: 251,
      createdCount: 1,
      emailSentCount: 1,
      skippedCount: 250,
      failedCount: 0,
      truncated: false,
    });
    expect((await adminDb.doc(`taxReceipts/${annualTaxReceiptDocId(CHURCH_ID, 'member-1', CLOSED_ANNUAL_YEAR)}`).get()).data()).toMatchObject({
      userId: 'member-1',
      receiptNumber: expectedReceiptNumber(CLOSED_ANNUAL_YEAR, 251),
      status: 'sent',
    });
  });

  it('does not skip fallback-only annual receipts as already emailed in batches', async () => {
    await adminDb.doc(`churches/${CHURCH_ID}`).update({
      timezone: 'America/Chicago',
      taxReceiptSettings: {
        enabled: true,
        eligibilityConfirmed: true,
        jurisdiction: 'US',
        organizationName: 'St. Nicholas Orthodox Church',
        organizationAddress: '123 Church Street, Chicago, IL',
        taxId: '12-3456789',
        receiptPrefix: 'STN',
        goodsServicesStatement:
          'No goods or services were provided in exchange for this contribution other than intangible religious benefits.',
        autoIssue: false,
      },
    });

    const receiptId = annualTaxReceiptDocId(CHURCH_ID, 'member-1', CLOSED_ANNUAL_YEAR);
    await Promise.all([
      adminDb.doc('giving/bulk-annual-fallback-sent').set({
        churchId: CHURCH_ID,
        churchName: 'St. Nicholas',
        userId: 'member-1',
        donorName: 'Member One',
        donorEmail: 'member@example.com',
        amount: 45,
        amountCents: 4500,
        currency: 'USD',
        purpose: 'Building Fund',
        status: 'completed',
        completedAt: Timestamp.fromDate(new Date(`${CLOSED_ANNUAL_YEAR}-12-10T16:00:00Z`)),
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }),
      adminDb.doc(`taxReceipts/${receiptId}`).set({
        churchId: CHURCH_ID,
        churchName: 'St. Nicholas',
        userId: 'member-1',
        donorName: 'Member One',
        donorEmail: 'member@example.com',
        kind: 'annual',
        status: 'sent',
        receiptNumber: 'Unassigned',
        receiptYear: CLOSED_ANNUAL_YEAR,
        annualYear: CLOSED_ANNUAL_YEAR,
        amountCents: 4500,
        eligibleAmountCents: 4500,
        currency: 'USD',
        donationCount: 1,
        givingIds: ['bulk-annual-fallback-sent'],
        contributions: [
          {
            dateLabel: `December 10, ${CLOSED_ANNUAL_YEAR}`,
            purpose: 'Building Fund',
            amountCents: 4500,
            eligibleAmountCents: 4500,
            currency: 'USD',
          },
        ],
        emailSentAt: Timestamp.fromDate(new Date(`${CLOSED_ANNUAL_YEAR + 1}-01-15T12:00:00Z`)),
        issuedAt: Timestamp.fromDate(new Date(`${CLOSED_ANNUAL_YEAR + 1}-01-15T12:00:00Z`)),
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }),
    ]);

    const result = await callCallable<
      { churchId: string; year: number },
      {
        success: boolean;
        donorCount: number;
        createdCount: number;
        emailSentCount: number;
        skippedCount: number;
        failedCount: number;
        truncated: boolean;
        failures: Array<{ code: string }>;
      }
    >(
      'sendChurchAnnualTaxReceipts',
      { churchId: CHURCH_ID, year: CLOSED_ANNUAL_YEAR },
      { uid: 'priest-1', email: 'priest@example.com' }
    );

    expect(result).toMatchObject({
      success: false,
      donorCount: 1,
      createdCount: 0,
      emailSentCount: 0,
      skippedCount: 0,
      failedCount: 1,
      truncated: false,
      failures: [{ code: 'tax_receipt_missing_receipt_number' }],
    });
    const receiptSnap = await adminDb.doc(`taxReceipts/${receiptId}`).get();
    expect(receiptSnap.data()).toMatchObject({
      status: 'error',
      emailError: 'tax_receipt_missing_receipt_number',
    });
  });

  it('lets priests send corrected annual tax receipt batches for partial-refund donors', async () => {
    await adminDb.doc(`churches/${CHURCH_ID}`).update({
      timezone: 'America/Chicago',
      taxReceiptSettings: {
        enabled: true,
        eligibilityConfirmed: true,
        jurisdiction: 'US',
        organizationName: 'St. Nicholas Orthodox Church',
        organizationAddress: '123 Church Street, Chicago, IL',
        taxId: '12-3456789',
        receiptPrefix: 'STN',
        goodsServicesStatement:
          'No goods or services were provided in exchange for this contribution other than intangible religious benefits.',
        autoIssue: false,
      },
    });
    await Promise.all([
      adminDb.doc(`taxReceiptCounters/church-1_${CLOSED_ANNUAL_YEAR}`).set({
        churchId: CHURCH_ID,
        year: CLOSED_ANNUAL_YEAR,
        lastSequence: 30,
        updatedAt: FieldValue.serverTimestamp(),
      }),
      adminDb.doc('giving/bulk-corrected-annual-member-partial').set({
        churchId: CHURCH_ID,
        churchName: 'St. Nicholas',
        userId: 'member-1',
        donorName: 'Member One',
        donorEmail: 'member@example.com',
        amount: 100,
        amountCents: 10000,
        currency: 'USD',
        purpose: 'General Fund',
        status: 'completed',
        stripeRefundStatus: 'partially_refunded',
        stripeAmountRefundedCents: 2500,
        taxReceiptCorrectionRequired: true,
        taxReceiptCorrectionReason: 'stripe_partial_refund_review_required',
        completedAt: Timestamp.fromDate(new Date(`${CLOSED_ANNUAL_YEAR}-02-10T16:00:00Z`)),
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }),
      adminDb.doc('giving/bulk-corrected-annual-member-regular').set({
        churchId: CHURCH_ID,
        churchName: 'St. Nicholas',
        userId: 'member-1',
        donorName: 'Member One',
        donorEmail: 'member@example.com',
        amount: 15,
        amountCents: 1500,
        currency: 'USD',
        purpose: 'Building Fund',
        status: 'completed',
        completedAt: Timestamp.fromDate(new Date(`${CLOSED_ANNUAL_YEAR}-04-10T16:00:00Z`)),
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }),
      adminDb.doc('giving/bulk-corrected-annual-invitee-partial').set({
        churchId: CHURCH_ID,
        churchName: 'St. Nicholas',
        userId: 'invitee-1',
        donorName: 'Invitee One',
        donorEmail: 'invitee@example.com',
        amount: 40,
        amountCents: 4000,
        currency: 'USD',
        purpose: 'General Fund',
        status: 'completed',
        stripeRefundStatus: 'partially_refunded',
        stripeAmountRefundedCents: 1000,
        taxReceiptCorrectionRequired: true,
        taxReceiptCorrectionReason: 'stripe_partial_refund_review_required',
        completedAt: Timestamp.fromDate(new Date(`${CLOSED_ANNUAL_YEAR}-05-10T16:00:00Z`)),
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }),
      adminDb.doc('giving/bulk-corrected-annual-anonymous-failing').set({
        churchId: CHURCH_ID,
        churchName: 'St. Nicholas',
        userId: 'anonymous-failed-donor',
        donorName: 'Anonymous donor',
        donorEmail: '',
        anonymous: true,
        amount: 30,
        amountCents: 3000,
        currency: 'USD',
        purpose: 'General Fund',
        status: 'completed',
        stripeRefundStatus: 'partially_refunded',
        stripeAmountRefundedCents: 500,
        taxReceiptCorrectionRequired: true,
        taxReceiptCorrectionReason: 'stripe_partial_refund_review_required',
        completedAt: Timestamp.fromDate(new Date(`${CLOSED_ANNUAL_YEAR}-06-10T16:00:00Z`)),
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }),
      adminDb.doc('giving/bulk-corrected-annual-normal-only').set({
        churchId: CHURCH_ID,
        churchName: 'St. Nicholas',
        userId: 'other-1',
        donorName: 'Other One',
        donorEmail: 'other@example.com',
        amount: 75,
        amountCents: 7500,
        currency: 'USD',
        purpose: 'General Fund',
        status: 'completed',
        completedAt: Timestamp.fromDate(new Date(`${CLOSED_ANNUAL_YEAR}-07-10T16:00:00Z`)),
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }),
    ]);

    const result = await callCallable<
      { churchId: string; year: number },
      {
        success: boolean;
        donorCount: number;
        createdCount: number;
        emailSentCount: number;
        skippedCount: number;
        failedCount: number;
        truncated: boolean;
        failures: Array<{ code: string; userId?: string }>;
      }
    >(
      'sendChurchCorrectedAnnualTaxReceipts',
      { churchId: CHURCH_ID, year: CLOSED_ANNUAL_YEAR },
      { uid: 'priest-1', email: 'priest@example.com' }
    );

    expect(result).toMatchObject({
      success: false,
      donorCount: 3,
      createdCount: 2,
      emailSentCount: 2,
      skippedCount: 0,
      failedCount: 1,
      truncated: false,
      failures: [
        { code: 'tax_receipt_donor_profile_incomplete' },
      ],
    });
    expect(result.failures[0]).not.toHaveProperty('userId');

    const receipts = await adminDb
      .collection('taxReceipts')
      .where('churchId', '==', CHURCH_ID)
      .where('kind', '==', 'annual')
      .get();
    const receiptData = receipts.docs.map((doc) => doc.data());
    expect(receipts.docs.map((doc) => doc.id).every((id) => id.startsWith('annual_correction_'))).toBe(true);
    expect(receiptData.map((receipt) => receipt.userId).sort()).toEqual(['invitee-1', 'member-1']);
    expect(receiptData.map((receipt) => receipt.eligibleAmountCents).sort((a, b) => a - b)).toEqual([3000, 9000]);
    expect(receiptData.map((receipt) => receipt.refundedAmountCents).sort((a, b) => a - b)).toEqual([1000, 2500]);
    expect(receiptData).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ userId: 'other-1' }),
    ]));

    await expect(
      callCallable(
        'sendChurchCorrectedAnnualTaxReceipts',
        { churchId: CHURCH_ID, year: CLOSED_ANNUAL_YEAR },
        { uid: 'treasurer-1', email: 'treasurer@example.com' }
      )
    ).resolves.toMatchObject({
      success: false,
      donorCount: 3,
      createdCount: 0,
      emailSentCount: 0,
      skippedCount: 2,
      failedCount: 1,
      truncated: false,
      failures: [
        { code: 'tax_receipt_donor_profile_incomplete' },
      ],
    });

    await expectCallableFails(
      callCallable(
        'sendChurchCorrectedAnnualTaxReceipts',
        { churchId: CHURCH_ID, year: CLOSED_ANNUAL_YEAR },
        { uid: 'admin-1', email: 'admin@example.com' }
      ),
      'permission-denied'
    );
  });

  it('skips mixed- or missing-currency donor-years from corrected annual batches for review without exposing donor ids', async () => {
    await adminDb.doc(`churches/${CHURCH_ID}`).update({
      timezone: 'America/Chicago',
      taxReceiptSettings: {
        enabled: true,
        eligibilityConfirmed: true,
        jurisdiction: 'US',
        organizationName: 'St. Nicholas Orthodox Church',
        organizationAddress: '123 Church Street, Chicago, IL',
        taxId: '12-3456789',
        receiptPrefix: 'STN',
        goodsServicesStatement:
          'No goods or services were provided in exchange for this contribution other than intangible religious benefits.',
        autoIssue: false,
      },
    });
    await Promise.all([
      adminDb.doc('giving/bulk-corrected-annual-mixed-usd').set({
        churchId: CHURCH_ID,
        churchName: 'St. Nicholas',
        userId: 'member-1',
        donorName: 'Member One',
        donorEmail: 'member@example.com',
        amount: 100,
        amountCents: 10000,
        currency: 'USD',
        purpose: 'General Fund',
        status: 'completed',
        stripeRefundStatus: 'partially_refunded',
        stripeAmountRefundedCents: 2500,
        taxReceiptCorrectionRequired: true,
        taxReceiptCorrectionReason: 'stripe_partial_refund_review_required',
        completedAt: Timestamp.fromDate(new Date(`${CLOSED_ANNUAL_YEAR}-02-10T16:00:00Z`)),
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }),
      adminDb.doc('giving/bulk-corrected-annual-mixed-cad').set({
        churchId: CHURCH_ID,
        churchName: 'St. Nicholas',
        userId: 'member-1',
        donorName: 'Member One',
        donorEmail: 'member@example.com',
        amount: 30,
        amountCents: 3000,
        currency: 'CAD',
        purpose: 'Building Fund',
        status: 'completed',
        completedAt: Timestamp.fromDate(new Date(`${CLOSED_ANNUAL_YEAR}-04-10T16:00:00Z`)),
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }),
      adminDb.doc('giving/bulk-corrected-annual-missing-currency').set({
        churchId: CHURCH_ID,
        churchName: 'St. Nicholas',
        userId: 'invitee-1',
        donorName: 'Invitee One',
        donorEmail: 'invitee@example.com',
        amount: 50,
        amountCents: 5000,
        purpose: 'General Fund',
        status: 'completed',
        stripeRefundStatus: 'partially_refunded',
        stripeAmountRefundedCents: 1000,
        taxReceiptCorrectionRequired: true,
        taxReceiptCorrectionReason: 'stripe_partial_refund_review_required',
        completedAt: Timestamp.fromDate(new Date(`${CLOSED_ANNUAL_YEAR}-03-10T16:00:00Z`)),
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }),
    ]);

    const result = await callCallable<
      { churchId: string; year: number },
      {
        success: boolean;
        donorCount: number;
        createdCount: number;
        emailSentCount: number;
        skippedCount: number;
        failedCount: number;
        truncated: boolean;
        failures: Array<{ code: string; userId?: string }>;
      }
    >(
      'sendChurchCorrectedAnnualTaxReceipts',
      { churchId: CHURCH_ID, year: CLOSED_ANNUAL_YEAR },
      { uid: 'priest-1', email: 'priest@example.com' }
    );

    expect(result).toMatchObject({
      success: false,
      donorCount: 2,
      createdCount: 0,
      emailSentCount: 0,
      skippedCount: 0,
      failedCount: 2,
      truncated: false,
      failures: [
        { code: 'tax_receipt_annual_mixed_currency_review_required' },
        { code: 'tax_receipt_annual_mixed_currency_review_required' },
      ],
    });
    expect(result.failures[0]).not.toHaveProperty('userId');
    const receipts = await adminDb.collection('taxReceipts').get();
    expect(receipts.docs.some((doc) => doc.id.startsWith('annual_correction_'))).toBe(false);

    const eventData = (await adminDb.collection('taxReceiptEvents').get()).docs.map((doc) => doc.data());
    expect(eventData).toEqual(expect.arrayContaining([
      expect.objectContaining({
        action: 'annual_batch_item_failed',
        churchId: CHURCH_ID,
        userId: 'member-1',
        kind: 'annual',
        receiptYear: CLOSED_ANNUAL_YEAR,
        errorCode: 'tax_receipt_annual_mixed_currency_review_required',
        reasonCode: 'stripe_partial_refund_corrected_reissue',
      }),
      expect.objectContaining({
        action: 'annual_batch_item_failed',
        churchId: CHURCH_ID,
        userId: 'invitee-1',
        kind: 'annual',
        receiptYear: CLOSED_ANNUAL_YEAR,
        errorCode: 'tax_receipt_annual_mixed_currency_review_required',
        reasonCode: 'stripe_partial_refund_corrected_reissue',
      }),
    ]));
  });

  it('prioritizes unsent corrected annual donor-years after already emailed correction entries', async () => {
    await adminDb.doc(`churches/${CHURCH_ID}`).update({
      timezone: 'America/Chicago',
      taxReceiptSettings: {
        enabled: true,
        eligibilityConfirmed: true,
        jurisdiction: 'US',
        organizationName: 'St. Nicholas Orthodox Church',
        organizationAddress: '123 Church Street, Chicago, IL',
        taxId: '12-3456789',
        receiptPrefix: 'STN',
        goodsServicesStatement:
          'No goods or services were provided in exchange for this contribution other than intangible religious benefits.',
        autoIssue: false,
      },
    });

    const existingCorrectedEntries: Array<{ path: string; data: Record<string, unknown> }> = [];
    for (let index = 0; index < 250; index += 1) {
      const donorId = `bulk-corrected-sent-donor-${String(index).padStart(3, '0')}`;
      const givingId = `bulk-corrected-sent-giving-${String(index).padStart(3, '0')}`;
      const correctionDigestInput = `${givingId}:2000:500`;
      const receiptId = correctedAnnualTaxReceiptDocId(
        CHURCH_ID,
        donorId,
        CLOSED_ANNUAL_YEAR,
        correctionDigestInput
      );
      existingCorrectedEntries.push(
        {
          path: `giving/${givingId}`,
          data: {
            churchId: CHURCH_ID,
            churchName: 'St. Nicholas',
            userId: donorId,
            donorName: `Corrected Donor ${index}`,
            donorEmail: '',
            amount: 20,
            amountCents: 2000,
            currency: 'USD',
            purpose: 'General Fund',
            status: 'completed',
            stripeRefundStatus: 'partially_refunded',
            stripeAmountRefundedCents: 500,
            taxReceiptCorrectionRequired: true,
            taxReceiptCorrectionReason: 'stripe_partial_refund_review_required',
            completedAt: Timestamp.fromDate(new Date(`${CLOSED_ANNUAL_YEAR}-01-01T12:00:00Z`)),
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
          },
        },
        {
          path: `taxReceipts/${receiptId}`,
          data: {
            churchId: CHURCH_ID,
            userId: donorId,
            kind: 'annual',
            status: 'sent',
            receiptNumber: expectedReceiptNumber(CLOSED_ANNUAL_YEAR, index + 1),
            receiptYear: CLOSED_ANNUAL_YEAR,
            annualYear: CLOSED_ANNUAL_YEAR,
            amountCents: 1500,
            eligibleAmountCents: 1500,
            originalAmountCents: 2000,
            refundedAmountCents: 500,
            donationCount: 1,
            correctionSourceReason: 'stripe_partial_refund_corrected_reissue',
            emailSentAt: Timestamp.fromDate(new Date(`${CLOSED_ANNUAL_YEAR + 1}-01-15T12:00:00Z`)),
            issuedAt: Timestamp.fromDate(new Date(`${CLOSED_ANNUAL_YEAR + 1}-01-15T12:00:00Z`)),
          },
        }
      );
    }
    await setDocsInBatches(existingCorrectedEntries);
    await Promise.all([
      adminDb.doc(`taxReceiptCounters/church-1_${CLOSED_ANNUAL_YEAR}`).set({
        churchId: CHURCH_ID,
        year: CLOSED_ANNUAL_YEAR,
        lastSequence: 250,
        updatedAt: FieldValue.serverTimestamp(),
      }),
      adminDb.doc('giving/bulk-corrected-unsent-after-sent').set({
        churchId: CHURCH_ID,
        churchName: 'St. Nicholas',
        userId: 'member-1',
        donorName: 'Member One',
        donorEmail: 'member@example.com',
        amount: 100,
        amountCents: 10000,
        currency: 'USD',
        purpose: 'Building Fund',
        status: 'completed',
        stripeRefundStatus: 'partially_refunded',
        stripeAmountRefundedCents: 2500,
        taxReceiptCorrectionRequired: true,
        taxReceiptCorrectionReason: 'stripe_partial_refund_review_required',
        completedAt: Timestamp.fromDate(new Date(`${CLOSED_ANNUAL_YEAR}-12-10T16:00:00Z`)),
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }),
    ]);

    const result = await callCallable<
      { churchId: string; year: number },
      {
        success: boolean;
        donorCount: number;
        createdCount: number;
        emailSentCount: number;
        skippedCount: number;
        failedCount: number;
        truncated: boolean;
      }
    >(
      'sendChurchCorrectedAnnualTaxReceipts',
      { churchId: CHURCH_ID, year: CLOSED_ANNUAL_YEAR },
      { uid: 'priest-1', email: 'priest@example.com' }
    );

    const memberCorrectionDigestInput = 'bulk-corrected-unsent-after-sent:10000:2500';
    const memberCorrectedReceiptId = correctedAnnualTaxReceiptDocId(
      CHURCH_ID,
      'member-1',
      CLOSED_ANNUAL_YEAR,
      memberCorrectionDigestInput
    );

    expect(result).toMatchObject({
      success: true,
      donorCount: 251,
      createdCount: 1,
      emailSentCount: 1,
      skippedCount: 250,
      failedCount: 0,
      truncated: false,
    });
    expect((await adminDb.doc(`taxReceipts/${memberCorrectedReceiptId}`).get()).data()).toMatchObject({
      userId: 'member-1',
      receiptNumber: expectedReceiptNumber(CLOSED_ANNUAL_YEAR, 251),
      status: 'sent',
      eligibleAmountCents: 7500,
      refundedAmountCents: 2500,
    });
  });

  it('does not skip fallback-only corrected annual receipts as already emailed in batches', async () => {
    await adminDb.doc(`churches/${CHURCH_ID}`).update({
      timezone: 'America/Chicago',
      taxReceiptSettings: {
        enabled: true,
        eligibilityConfirmed: true,
        jurisdiction: 'US',
        organizationName: 'St. Nicholas Orthodox Church',
        organizationAddress: '123 Church Street, Chicago, IL',
        taxId: '12-3456789',
        receiptPrefix: 'STN',
        goodsServicesStatement:
          'No goods or services were provided in exchange for this contribution other than intangible religious benefits.',
        autoIssue: false,
      },
    });

    const givingId = 'bulk-corrected-fallback-sent';
    const correctionDigestInput = `${givingId}:10000:2500`;
    const receiptId = correctedAnnualTaxReceiptDocId(
      CHURCH_ID,
      'member-1',
      CLOSED_ANNUAL_YEAR,
      correctionDigestInput
    );
    await Promise.all([
      adminDb.doc(`giving/${givingId}`).set({
        churchId: CHURCH_ID,
        churchName: 'St. Nicholas',
        userId: 'member-1',
        donorName: 'Member One',
        donorEmail: 'member@example.com',
        amount: 100,
        amountCents: 10000,
        currency: 'USD',
        purpose: 'Building Fund',
        status: 'completed',
        stripeRefundStatus: 'partially_refunded',
        stripeAmountRefundedCents: 2500,
        taxReceiptCorrectionRequired: true,
        taxReceiptCorrectionReason: 'stripe_partial_refund_review_required',
        completedAt: Timestamp.fromDate(new Date(`${CLOSED_ANNUAL_YEAR}-12-10T16:00:00Z`)),
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }),
      adminDb.doc(`taxReceipts/${receiptId}`).set({
        churchId: CHURCH_ID,
        churchName: 'St. Nicholas',
        userId: 'member-1',
        donorName: 'Member One',
        donorEmail: 'member@example.com',
        givingIds: [givingId],
        kind: 'annual',
        status: 'sent',
        receiptNumber: 'Unassigned',
        receiptYear: CLOSED_ANNUAL_YEAR,
        annualYear: CLOSED_ANNUAL_YEAR,
        amountCents: 7500,
        eligibleAmountCents: 7500,
        originalAmountCents: 10000,
        refundedAmountCents: 2500,
        currency: 'USD',
        donationCount: 1,
        contributions: [
          {
            dateLabel: `December 10, ${CLOSED_ANNUAL_YEAR}`,
            purpose: 'Building Fund',
            amountCents: 10000,
            eligibleAmountCents: 7500,
            currency: 'USD',
          },
        ],
        correctionSourceReason: 'stripe_partial_refund_corrected_reissue',
        emailSentAt: Timestamp.fromDate(new Date(`${CLOSED_ANNUAL_YEAR + 1}-01-15T12:00:00Z`)),
        issuedAt: Timestamp.fromDate(new Date(`${CLOSED_ANNUAL_YEAR + 1}-01-15T12:00:00Z`)),
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }),
    ]);

    const result = await callCallable<
      { churchId: string; year: number },
      {
        success: boolean;
        donorCount: number;
        createdCount: number;
        emailSentCount: number;
        skippedCount: number;
        failedCount: number;
        truncated: boolean;
        failures: Array<{ code: string }>;
      }
    >(
      'sendChurchCorrectedAnnualTaxReceipts',
      { churchId: CHURCH_ID, year: CLOSED_ANNUAL_YEAR },
      { uid: 'priest-1', email: 'priest@example.com' }
    );

    expect(result).toMatchObject({
      success: false,
      donorCount: 1,
      createdCount: 0,
      emailSentCount: 0,
      skippedCount: 0,
      failedCount: 1,
      truncated: false,
      failures: [{ code: 'tax_receipt_missing_receipt_number' }],
    });
    const receiptSnap = await adminDb.doc(`taxReceipts/${receiptId}`).get();
    expect(receiptSnap.data()).toMatchObject({
      status: 'error',
      emailError: 'tax_receipt_missing_receipt_number',
    });
  });

  it('rejects annual tax receipt batches before the receipt year has closed', async () => {
    await adminDb.doc(`churches/${CHURCH_ID}`).update({
      timezone: 'America/Chicago',
      taxReceiptSettings: {
        enabled: true,
        eligibilityConfirmed: true,
        jurisdiction: 'US',
        organizationName: 'St. Nicholas Orthodox Church',
        organizationAddress: '123 Church Street, Chicago, IL',
        taxId: '12-3456789',
        receiptPrefix: 'STN',
        goodsServicesStatement:
          'No goods or services were provided in exchange for this contribution other than intangible religious benefits.',
        autoIssue: false,
      },
    });

    await expectCallableFails(
      callCallable(
        'sendChurchAnnualTaxReceipts',
        { churchId: CHURCH_ID, year: OPEN_ANNUAL_YEAR },
        { uid: 'priest-1', email: 'priest@example.com' }
      ),
      'failed-precondition'
    );
  });

  it('rejects annual batch callables while the church is inactive before donor-year scans', async () => {
    await adminDb.doc(`churches/${CHURCH_ID}`).update({
      isActive: false,
      timezone: 'America/Chicago',
      taxReceiptSettings: {
        enabled: true,
        eligibilityConfirmed: true,
        jurisdiction: 'US',
        organizationName: 'St. Nicholas Orthodox Church',
        organizationAddress: '123 Church Street, Chicago, IL',
        taxId: '12-3456789',
        receiptPrefix: 'STN',
        goodsServicesStatement:
          'No goods or services were provided in exchange for this contribution other than intangible religious benefits.',
        autoIssue: false,
      },
    });
    await Promise.all([
      adminDb.doc('giving/inactive-bulk-annual-member').set({
        churchId: CHURCH_ID,
        churchName: 'St. Nicholas',
        userId: 'member-1',
        donorName: 'Member One',
        donorEmail: '',
        anonymous: false,
        amount: 40,
        amountCents: 4000,
        currency: 'USD',
        purpose: 'General Fund',
        status: 'completed',
        completedAt: Timestamp.fromDate(new Date(`${CLOSED_ANNUAL_YEAR}-02-10T16:00:00Z`)),
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }),
      adminDb.doc('giving/inactive-bulk-corrected-member').set({
        churchId: CHURCH_ID,
        churchName: 'St. Nicholas',
        userId: 'member-1',
        donorName: 'Member One',
        donorEmail: '',
        anonymous: false,
        amount: 70,
        amountCents: 7000,
        currency: 'USD',
        purpose: 'Building Fund',
        status: 'completed',
        stripeRefundStatus: 'partially_refunded',
        stripeAmountRefundedCents: 2000,
        taxReceiptCorrectionRequired: true,
        taxReceiptCorrectionReason: 'stripe_partial_refund_review_required',
        completedAt: Timestamp.fromDate(new Date(`${CLOSED_ANNUAL_YEAR}-05-10T16:00:00Z`)),
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }),
    ]);

    await expectCallableFails(
      callCallable(
        'sendChurchAnnualTaxReceipts',
        { churchId: CHURCH_ID, year: CLOSED_ANNUAL_YEAR },
        { uid: 'priest-1', email: 'priest@example.com' }
      ),
      'failed-precondition'
    );
    await expectCallableFails(
      callCallable(
        'sendChurchCorrectedAnnualTaxReceipts',
        { churchId: CHURCH_ID, year: CLOSED_ANNUAL_YEAR },
        { uid: 'treasurer-1', email: 'treasurer@example.com' }
      ),
      'failed-precondition'
    );

    const receiptEvents = await adminDb
      .collection('taxReceiptEvents')
      .where('churchId', '==', CHURCH_ID)
      .get();
    expect(receiptEvents.empty).toBe(true);
  });

  it('rejects annual tax receipt batches before church tax receipt settings are enabled', async () => {
    await adminDb.doc('giving/bulk-annual-unconfigured').set({
      churchId: CHURCH_ID,
      churchName: 'St. Nicholas',
      userId: 'member-1',
      donorName: 'Member One',
      donorEmail: 'member@example.com',
      amount: 40,
      amountCents: 4000,
      currency: 'USD',
      purpose: 'General Fund',
      status: 'completed',
      completedAt: Timestamp.fromDate(new Date(`${CLOSED_ANNUAL_YEAR}-02-10T16:00:00Z`)),
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    await expectCallableFails(
      callCallable(
        'sendChurchAnnualTaxReceipts',
        { churchId: CHURCH_ID, year: CLOSED_ANNUAL_YEAR },
        { uid: 'priest-1', email: 'priest@example.com' }
      ),
      'failed-precondition'
    );
  });

  it('rejects malformed AI writer inputs before provider calls', async () => {
    await expectCallableFails(
      callCallable(
        'faithAiChat',
        null,
        { uid: 'member-1', email: 'member@example.com' }
      ),
      'invalid-argument'
    );
    await expectCallableFails(
      callCallable(
        'faithAiChat',
        {
          message: 'What is prayer?',
          history: [null],
        },
        { uid: 'member-1', email: 'member@example.com' }
      ),
      'invalid-argument'
    );

    await expectCallableFails(
      callCallable(
        'generatePostContent',
        {
          churchId: 42,
          prompt: 'Write a short Sunday announcement.',
          tone: 'warm',
        },
        { uid: 'admin-1', email: 'admin@example.com' }
      ),
      'invalid-argument'
    );

    await expectCallableFails(
      callCallable(
        'previewPostTranslations',
        {
          churchId: CHURCH_ID,
          prompt: 42,
        },
        { uid: 'admin-1', email: 'admin@example.com' }
      ),
      'invalid-argument'
    );

    await expectCallableFails(
      callCallable(
        'generatePostContent',
        {
          churchId: CHURCH_ID,
          prompt: 'Write a short Sunday announcement.',
          tone: 'casual',
        },
        { uid: 'admin-1', email: 'admin@example.com' }
      ),
      'invalid-argument'
    );
  });

  it('enforces super-admin callable permissions and writes expected church/user state', async () => {
    await expectCallableFails(
      callCallable('createChurch', createChurchPayload(), {
        uid: 'admin-1',
        email: 'admin@example.com',
      }),
      'permission-denied'
    );

    const created = await callCallable<
      ReturnType<typeof createChurchPayload>,
      { success: boolean; churchId: string }
    >('createChurch', createChurchPayload(), SUPER_ADMIN_AUTH);

    expect(created).toMatchObject({
      success: true,
      churchId: 'holy-trinity-orthodox-church-milwaukee',
    });

    const createdChurch = await adminDb.doc(`churches/${created.churchId}`).get();
    expect(createdChurch.data()).toMatchObject({
      name: 'Holy Trinity Orthodox Church',
      city: 'Milwaukee',
      isActive: true,
      isVerified: false,
      createdBy: 'priest-1',
    });

    await expectCallableFails(
      callCallable(
        'createChurch',
        {
          ...createChurchPayload(),
          name: 'Unconfirmed Tax Parish',
          contactEmail: 'unconfirmed-tax@example.com',
          taxReceiptSettings: {
            enabled: true,
            jurisdiction: 'US',
            organizationName: 'Unconfirmed Tax Parish',
            organizationAddress: '1 Church Street, Milwaukee, WI',
            taxId: '12-3456789',
          },
        },
        SUPER_ADMIN_AUTH
      ),
      'invalid-argument'
    );
    await expectCallableFails(
      callCallable(
        'createChurch',
        {
          ...createChurchPayload(),
          name: 'Incomplete Tax Parish',
          contactEmail: 'incomplete-tax@example.com',
          taxReceiptSettings: {
            enabled: true,
            eligibilityConfirmed: true,
            jurisdiction: 'US',
            organizationName: 'Incomplete Tax Parish',
            organizationAddress: '',
            taxId: '',
          },
        },
        SUPER_ADMIN_AUTH
      ),
      'invalid-argument'
    );
    await expectCallableFails(
      callCallable(
        'createChurch',
        {
          ...createChurchPayload(),
          name: 'Canadian Tax Parish',
          contactEmail: 'canadian-tax@example.com',
          country: 'CA',
          taxReceiptSettings: {
            enabled: true,
            eligibilityConfirmed: true,
            jurisdiction: 'CA',
            organizationName: 'Canadian Tax Parish',
            organizationAddress: '1 Church Street, Edmonton, AB',
            taxId: '123456789RR0001',
          },
        },
        SUPER_ADMIN_AUTH
      ),
      'invalid-argument'
    );

    await expect(
      callCallable('createChurch', {
        ...createChurchPayload(),
        contactEmail: 'office-duplicate@example.com',
      }, SUPER_ADMIN_AUTH)
    ).resolves.toMatchObject({
      success: true,
      churchId: 'holy-trinity-orthodox-church-milwaukee-1',
    });

    await expect(
      callCallable(
        'setChurchActiveState',
        { churchId: created.churchId, isActive: false },
        SUPER_ADMIN_AUTH
      )
    ).resolves.toMatchObject({
      success: true,
      churchId: created.churchId,
      isActive: false,
    });

    await expect(
      callCallable(
        'setChurchActiveState',
        { churchId: CHURCH_ID, isActive: false },
        SUPER_ADMIN_AUTH
      )
    ).resolves.toMatchObject({
      success: true,
      churchId: CHURCH_ID,
      isActive: false,
    });
    expect((await adminDb.doc(`users/member-1/churchMemberships/${CHURCH_ID}`).get()).data()).toMatchObject({
      churchActive: false,
    });

    await expect(
      callCallable(
        'setChurchActiveState',
        { churchId: CHURCH_ID, isActive: true },
        SUPER_ADMIN_AUTH
      )
    ).resolves.toMatchObject({
      success: true,
      churchId: CHURCH_ID,
      isActive: true,
    });
    expect((await adminDb.doc(`users/member-1/churchMemberships/${CHURCH_ID}`).get()).data()).toMatchObject({
      churchActive: true,
    });

    await expect(
      callCallable(
        'updateChurchAsSuperAdmin',
        {
          churchId: created.churchId,
          updates: {
            name: 'Holy Trinity Cathedral',
            website: 'https://holy-trinity.example.com',
            ignoredField: 'must not be written',
          },
        },
        SUPER_ADMIN_AUTH
      )
    ).resolves.toEqual({ success: true });

    const updatedChurch = await adminDb.doc(`churches/${created.churchId}`).get();
    expect(updatedChurch.data()).toMatchObject({
      name: 'Holy Trinity Cathedral',
      website: 'https://holy-trinity.example.com/',
      isActive: false,
    });
    expect(updatedChurch.data()).not.toHaveProperty('ignoredField');

    await expectCallableFails(
      callCallable(
        'updateChurchAsSuperAdmin',
        {
          churchId: created.churchId,
          updates: { name: 42 },
        },
        SUPER_ADMIN_AUTH
      ),
      'invalid-argument'
    );
    await expectCallableFails(
      callCallable(
        'updateChurchAsSuperAdmin',
        {
          churchId: created.churchId,
          updates: { isActive: 'false' },
        },
        SUPER_ADMIN_AUTH
      ),
      'invalid-argument'
    );
    await expectCallableFails(
      callCallable(
        'updateChurchAsSuperAdmin',
        {
          churchId: created.churchId,
          updates: {
            taxReceiptSettings: {
              enabled: true,
              jurisdiction: 'US',
              organizationName: 'Holy Trinity Cathedral',
              organizationAddress: '1 Church Street, Milwaukee, WI',
              taxId: '12-3456789',
            },
          },
        },
        SUPER_ADMIN_AUTH
      ),
      'invalid-argument'
    );
    await expectCallableFails(
      callCallable(
        'updateChurchAsSuperAdmin',
        {
          churchId: created.churchId,
          updates: {
            taxReceiptSettings: {
              enabled: true,
              eligibilityConfirmed: true,
              jurisdiction: 'US',
              organizationName: 'Holy Trinity Cathedral',
              organizationAddress: '',
              taxId: '   ',
            },
          },
        },
        SUPER_ADMIN_AUTH
      ),
      'invalid-argument'
    );
    await expectCallableFails(
      callCallable(
        'updateChurchAsSuperAdmin',
        {
          churchId: created.churchId,
          updates: {
            taxReceiptSettings: {
              enabled: true,
              eligibilityConfirmed: true,
              jurisdiction: 'CA',
              organizationName: 'Holy Trinity Cathedral',
              organizationAddress: '1 Church Street, Edmonton, AB',
              taxId: '123456789RR0001',
            },
          },
        },
        SUPER_ADMIN_AUTH
      ),
      'invalid-argument'
    );

    const validTaxReceiptSettings = {
      enabled: true,
      eligibilityConfirmed: true,
      jurisdiction: 'US',
      organizationName: 'Holy Trinity Cathedral',
      organizationAddress: '1 Cathedral Way, Milwaukee, WI',
      taxId: '12-3456789',
      receiptPrefix: 'HTC',
      goodsServicesStatement:
        'No goods or services were provided in exchange for this contribution other than intangible religious benefits.',
      autoIssue: false,
      annualPreparationEnabled: true,
      annualAutoEmailEnabled: true,
      receiptIssueLocation: 'Milwaukee, Wisconsin',
      authorizedSignerName: 'Fr. Trinity',
      authorizedSignerTitle: 'Rector',
      secureElectronicSignatureConfigured: false,
      receiptCopiesRetentionConfirmed: true,
    };
    await expect(
      callCallable(
        'updateChurchAsSuperAdmin',
        {
          churchId: created.churchId,
          updates: {
            taxReceiptSettings: validTaxReceiptSettings,
          },
        },
        SUPER_ADMIN_AUTH
      )
    ).resolves.toEqual({ success: true });
    expect((await adminDb.doc(`churches/${created.churchId}`).get()).data()?.taxReceiptSettings).toMatchObject(
      validTaxReceiptSettings
    );

    const auditLogs = await adminDb.collection('platformAuditLog').get();
    const taxReceiptSettingsAudit = auditLogs.docs
      .map((docSnap) => docSnap.data())
      .find((entry) => {
        const details = entry.details as Record<string, unknown> | undefined;
        return entry.action === 'updateChurchAsSuperAdmin'
          && details?.churchId === created.churchId
          && Array.isArray(details.fields)
          && details.fields.includes('taxReceiptSettings');
      });
    expect(taxReceiptSettingsAudit?.details).toMatchObject({
      churchId: created.churchId,
      taxReceiptSettings: {
        previous: {
          enabled: false,
          taxIdConfigured: false,
        },
        next: {
          enabled: true,
          jurisdiction: 'US',
          eligibilityConfirmed: true,
          autoIssue: false,
          annualPreparationEnabled: true,
          annualAutoEmailEnabled: true,
          organizationNameConfigured: true,
          organizationAddressConfigured: true,
          taxIdConfigured: true,
          receiptPrefix: 'HTC',
          goodsServicesStatementConfigured: true,
          receiptIssueLocationConfigured: true,
          authorizedSignerConfigured: true,
          authorizedSignerTitleConfigured: true,
          secureElectronicSignatureConfigured: false,
          receiptCopiesRetentionConfirmed: true,
        },
      },
    });
    expect(JSON.stringify(taxReceiptSettingsAudit)).not.toContain('12-3456789');
    expect(JSON.stringify(taxReceiptSettingsAudit)).not.toContain('1 Cathedral Way');
    expect(JSON.stringify(taxReceiptSettingsAudit)).not.toContain('Fr. Trinity');

    await expect(
      callCallable(
        'updateChurchAsSuperAdmin',
        {
          churchId: created.churchId,
          updates: {
            taxReceiptSettings: {
              enabled: false,
              eligibilityConfirmed: false,
              jurisdiction: 'CA',
              annualPreparationEnabled: true,
              annualAutoEmailEnabled: true,
              receiptIssueLocation: 'Edmonton, Alberta',
              authorizedSignerName: 'Fr. Trinity',
              authorizedSignerTitle: 'Rector',
              secureElectronicSignatureConfigured: true,
              receiptCopiesRetentionConfirmed: true,
            },
          },
        },
        SUPER_ADMIN_AUTH
      )
    ).resolves.toEqual({ success: true });
    expect((await adminDb.doc(`churches/${created.churchId}`).get()).data()?.taxReceiptSettings)
      .toMatchObject({
        enabled: false,
        jurisdiction: 'CA',
        annualPreparationEnabled: false,
        annualAutoEmailEnabled: false,
        receiptIssueLocation: 'Edmonton, Alberta',
        secureElectronicSignatureConfigured: true,
        receiptCopiesRetentionConfirmed: true,
      });

    await expect(
      callCallable(
        'updateChurchAsSuperAdmin',
        {
          churchId: created.churchId,
          updates: {
            taxReceiptSettings: {
              ...validTaxReceiptSettings,
              jurisdiction: 'CA',
              enabled: true,
              eligibilityConfirmed: false,
              receiptIssueLocation: 'Edmonton, Alberta',
              authorizedSignerName: 'Fr. Trinity',
              authorizedSignerTitle: 'Rector',
              secureElectronicSignatureConfigured: true,
              receiptCopiesRetentionConfirmed: true,
            },
          },
        },
        SUPER_ADMIN_AUTH
      )
    ).rejects.toMatchObject({
      status: 'INVALID_ARGUMENT',
      message: expect.stringContaining('Canada/CRA tax receipts cannot be enabled'),
    });

    await expect(
      callCallable(
        'updateChurchAsSuperAdmin',
        {
          churchId: created.churchId,
          updates: {
            taxReceiptSettings: {
              ...validTaxReceiptSettings,
              receiptPrefix: 'HTD',
              goodsServicesStatement: '   ',
            },
          },
        },
        SUPER_ADMIN_AUTH
      )
    ).resolves.toEqual({ success: true });
    expect((await adminDb.doc(`churches/${created.churchId}`).get()).data()?.taxReceiptSettings)
      .toMatchObject({
        receiptPrefix: 'HTD',
        goodsServicesStatement:
          'No goods or services were provided in exchange for this contribution other than intangible religious benefits.',
      });

    await expect(
      callCallable(
        'updateChurchAsSuperAdmin',
        {
          churchId: CHURCH_ID,
          updates: { isActive: false },
        },
        SUPER_ADMIN_AUTH
      )
    ).resolves.toEqual({ success: true });
    expect((await adminDb.doc(`users/admin-1/churchMemberships/${CHURCH_ID}`).get()).data()).toMatchObject({
      churchActive: false,
    });

    await expect(
      callCallable(
        'updateChurchAsSuperAdmin',
        {
          churchId: CHURCH_ID,
          updates: { isActive: true },
        },
        SUPER_ADMIN_AUTH
      )
    ).resolves.toEqual({ success: true });
    expect((await adminDb.doc(`users/admin-1/churchMemberships/${CHURCH_ID}`).get()).data()).toMatchObject({
      churchActive: true,
    });

    await expect(
      callCallable(
        'updateChurchAsSuperAdmin',
        {
          churchId: CHURCH_ID,
          updates: {
            name: 'St. Nicholas Cathedral',
            city: 'Cleveland',
            state: 'OH',
            imageURL: 'https://example.com/st-nicholas-cathedral.jpg',
          },
        },
        SUPER_ADMIN_AUTH
      )
    ).resolves.toEqual({ success: true });
    expect((await adminDb.doc(`users/member-1/churchMemberships/${CHURCH_ID}`).get()).data()).toMatchObject({
      churchName: 'St. Nicholas Cathedral',
      location: 'Cleveland, OH',
      imageURL: 'https://example.com/st-nicholas-cathedral.jpg',
      churchActive: true,
    });

    const nonLatinCreated = await callCallable<
      ReturnType<typeof createChurchPayload>,
      { success: boolean; churchId: string }
    >(
      'createChurch',
      {
        ...createChurchPayload(),
        name: '\u0421\u0432\u0435\u0442\u0438 \u0421\u0430\u0432\u0430',
        city: '\u0411\u0435\u043e\u0433\u0440\u0430\u0434',
        contactEmail: 'belgrade@example.com',
      },
      SUPER_ADMIN_AUTH
    );
    expect(nonLatinCreated).toMatchObject({
      success: true,
      churchId: 'church',
    });

    await expect(
      callCallable(
        'assignChurchMembershipAsSuperAdmin',
        {
          churchId: created.churchId,
          email: 'other@example.com',
          role: 'admin',
        },
        SUPER_ADMIN_AUTH
      )
    ).resolves.toMatchObject({
      success: true,
      churchId: created.churchId,
      uid: 'other-1',
      email: 'other@example.com',
      role: 'admin',
      emailVerified: true,
    });

    const [memberSnap, fanoutSnap] = await Promise.all([
      adminDb.doc(`churches/${created.churchId}/members/other-1`).get(),
      adminDb.doc(`users/other-1/churchMemberships/${created.churchId}`).get(),
    ]);
    expect(memberSnap.data()).toMatchObject({
      userId: 'other-1',
      role: 'admin',
      status: 'active',
      assignedBy: 'priest-1',
    });
    expect(fanoutSnap.data()).toMatchObject({
      churchId: created.churchId,
      churchName: 'Holy Trinity Cathedral',
      role: 'admin',
      status: 'active',
      churchActive: false,
    });

    await adminDb.doc('churches/church-2').set({
      ...churchData(),
      name: 'St. Sava',
      city: 'Phoenix',
      state: 'AZ',
      location: 'Phoenix, AZ',
      imageURL: 'https://example.com/st-sava.jpg',
    });

    await expect(
      callCallable(
        'assignChurchMembershipAsSuperAdmin',
        {
          churchId: CHURCH_ID,
          email: 'invitee@example.com',
          role: 'priest',
        },
        SUPER_ADMIN_AUTH
      )
    ).resolves.toMatchObject({
      success: true,
      churchId: CHURCH_ID,
      uid: 'invitee-1',
      role: 'priest',
    });
    await expect(
      callCallable(
        'assignChurchMembershipAsSuperAdmin',
        {
          churchId: 'church-2',
          email: 'invitee@example.com',
          role: 'priest',
        },
        SUPER_ADMIN_AUTH
      )
    ).resolves.toMatchObject({
      success: true,
      churchId: 'church-2',
      uid: 'invitee-1',
      role: 'priest',
    });

    const [firstPriestFanout, secondPriestFanout, secondPriestMember] = await Promise.all([
      adminDb.doc(`users/invitee-1/churchMemberships/${CHURCH_ID}`).get(),
      adminDb.doc('users/invitee-1/churchMemberships/church-2').get(),
      adminDb.doc('churches/church-2/members/invitee-1').get(),
    ]);
    expect(firstPriestFanout.data()).toMatchObject({
      churchId: CHURCH_ID,
      role: 'priest',
      status: 'active',
    });
    expect(secondPriestFanout.data()).toMatchObject({
      churchId: 'church-2',
      churchName: 'St. Sava',
      location: 'Phoenix, AZ',
      role: 'priest',
      status: 'active',
    });
    expect(secondPriestMember.data()).toMatchObject({
      userId: 'invitee-1',
      churchId: 'church-2',
      role: 'priest',
      status: 'active',
    });

    await expect(
      callCallable('promoteSuperAdmin', { targetUid: 'other-1' }, SUPER_ADMIN_AUTH)
    ).resolves.toEqual({ success: true });
    expect((await adminAuth.getUser('other-1')).customClaims).toMatchObject({
      superAdmin: true,
    });
  });

  it('returns super-admin stats with membership, content, and giving aggregates', async () => {
    await Promise.all([
      adminDb.doc('events/event-stats-1').set({
        churchId: CHURCH_ID,
        title: 'Vespers',
        startTime: Timestamp.fromDate(new Date('2030-01-06T18:00:00Z')),
      }),
      adminDb.doc('newsletters/newsletter-stats-1').set({
        churchId: CHURCH_ID,
        title: 'January Bulletin',
        status: 'published',
      }),
      adminDb.doc('giving/giving-stats-1').set({
        churchId: CHURCH_ID,
        status: 'completed',
        amount: 123.45,
      }),
      adminDb.doc('churches/church-missing-active-flag').set({
        name: 'Legacy Missing Active Flag',
        city: 'Chicago',
        state: 'IL',
        location: 'Chicago, IL',
        imageURL: 'https://example.com/church.jpg',
        isVerified: true,
      }),
    ]);

    const result = await callCallable<Record<string, never>, {
      stats: Array<{
        churchId: string;
        isActive: boolean;
        memberCount: number;
        priestCount: number;
        treasurerCount: number;
        adminCount: number;
        eventCount: number;
        newsletterCount: number;
        donationTotal: number;
      }>;
    }>('getSuperAdminStats', {}, SUPER_ADMIN_AUTH);

    const churchStats = result.stats.find((stats) => stats.churchId === CHURCH_ID);
    expect(churchStats).toMatchObject({
      memberCount: 4,
      priestCount: 1,
      treasurerCount: 1,
      adminCount: 1,
      eventCount: 1,
      newsletterCount: 1,
      donationTotal: 123.45,
    });
    expect(result.stats.find((stats) => stats.churchId === 'church-missing-active-flag')).toMatchObject({
      isActive: false,
    });

    await expectCallableFails(
      callCallable('getSuperAdminStats', {}, { uid: 'admin-1', email: 'admin@example.com' }),
      'permission-denied'
    );
  });

  it('returns redacted payment operations readiness to SuperAdmins only', async () => {
    const checkoutProcessedAt = Timestamp.fromMillis(Date.now() - 2 * HOUR_MS);
    const issueProcessedAt = Timestamp.fromMillis(checkoutProcessedAt.toMillis() + HOUR_MS);

    await Promise.all([
      adminDb.doc('stripeWebhookEvents/event-old').set({
        type: 'checkout.session.completed',
        livemode: false,
        status: 'processed',
        givingId: 'private-giving-old',
        stripeSessionId: 'cs_live_private_old',
        processedAt: checkoutProcessedAt,
      }),
      adminDb.doc('stripeWebhookEvents/event-new').set({
        type: 'charge.refunded',
        livemode: true,
        status: 'validation_failed',
        givingId: 'private-giving-new',
        stripePaymentIntentId: 'pi_live_private',
        processedAt: issueProcessedAt,
      }),
    ]);

    const result = await callCallable<Record<string, never>, {
      checkedAtMillis: number;
      appUrl: {
        configured: boolean;
        value: string;
        usesHttps: boolean;
        runtimeValid: boolean;
        errorCode: string;
      };
      stripeSecretKey: {
        configured: boolean;
        mode: 'live' | 'test' | 'unknown' | 'not_configured';
      };
      stripeWebhookSecret: {
        configured: boolean;
        formatValid: boolean;
      };
      stripeApiVersion: string;
      stripeWebhookEndpoint: {
        checked: boolean;
        ready: boolean;
        configured: boolean;
        liveMode: boolean;
        enabled: boolean;
        duplicateCount: number;
        apiVersionMatches: boolean;
        requiredEventsConfigured: boolean;
        explicitEventsOnly: boolean;
        noUnexpectedEvents: boolean;
        missingEventCount: number;
        unexpectedEventCount: number;
        errorCode: string;
      };
      resendApiKey: {
        configured: boolean;
        formatValid: boolean;
      };
      resendDomain: {
        checked: boolean;
        domain: string;
        configured: boolean;
        verified: boolean;
        status: string;
        duplicateCount: number;
        errorCode: string;
      };
      stripeAccount: {
        checked: boolean;
        ready: boolean;
        chargesEnabled: boolean;
        payoutsEnabled: boolean;
        detailsSubmitted: boolean;
        country: string;
        defaultCurrency: string;
        disabledReason: string;
        currentlyDueCount: number;
        pastDueCount: number;
        eventuallyDueCount: number;
        futureCurrentlyDueCount: number;
        futurePastDueCount: number;
        futureEventuallyDueCount: number;
        errorCode: string;
      };
      webhookUrl: string;
      webhookActivity: {
        checkedEventCount: number;
        checkedLiveEventCount: number;
        smokeFreshnessWindowHours: number;
        latestProcessedAtMillis: number | null;
        latestLiveProcessedAtMillis: number | null;
        latestCheckoutCompletedAtMillis: number | null;
        latestLiveCheckoutCompletedAtMillis: number | null;
        latestType: string;
        latestStatus: string;
        latestLivemode: boolean | null;
        latestLiveType: string;
        latestLiveStatus: string;
        processedCount: number;
        liveProcessedCount: number;
        testProcessedCount: number;
        processedCheckoutCompletedCount: number;
        liveProcessedCheckoutCompletedCount: number;
        testProcessedCheckoutCompletedCount: number;
        checkoutSmokeFresh: boolean;
        liveCheckoutSmokeFresh: boolean;
        validationFailedCount: number;
        missingGivingCount: number;
        unpaidSessionCount: number;
      };
      taxReceiptEmailSmoke: {
        checkedEventCount: number;
        smokeFreshnessWindowHours: number;
        checkedLiveCheckoutGivingCount: number;
        emailSentCount: number;
        liveEmailSentCount: number;
        latestEmailSentAtMillis: number | null;
        latestLiveEmailSentAtMillis: number | null;
        latestLiveCheckoutEmailSentAtMillis: number | null;
        emailSentFresh: boolean;
        liveEmailSentFresh: boolean;
        latestLiveCheckoutEmailSentFresh: boolean;
        ready: boolean;
      };
      taxReceiptAnnualSmoke: {
        checkedEventCount: number;
        smokeFreshnessWindowHours: number;
        annualEmailSentCount: number;
        latestAnnualEmailSentAtMillis: number | null;
        latestAnnualReceiptIssuedAtMillis: number | null;
        latestAnnualReceiptEmailSentAtMillis: number | null;
        latestAnnualReceiptPdfRetainedAtMillis: number | null;
        latestAnnualReceiptPdfObjectReady: boolean;
        latestAnnualReceiptSummaryReady: boolean;
        latestAnnualEmailSentFresh: boolean;
        latestAnnualReceiptArtifactReady: boolean;
        latestAnnualReceiptArtifactFresh: boolean;
        ready: boolean;
      };
      donationFlowReady: boolean;
      taxReceiptDeliveryReady: boolean;
      productionReady: boolean;
      warnings: string[];
    }>('getPaymentOperationsReadiness', {}, SUPER_ADMIN_AUTH);

    expect(result.checkedAtMillis).toEqual(expect.any(Number));
    expect(result.appUrl).toMatchObject({
      configured: expect.any(Boolean),
      value: expect.stringMatching(/^https?:\/\//),
      usesHttps: expect.any(Boolean),
      runtimeValid: true,
      errorCode: '',
    });
    expect(result.stripeSecretKey).toMatchObject({
      configured: expect.any(Boolean),
      mode: expect.stringMatching(/^(live|test|unknown|not_configured)$/),
    });
    expect(result.stripeWebhookSecret).toMatchObject({
      configured: expect.any(Boolean),
      formatValid: expect.any(Boolean),
    });
    expect(result.stripeApiVersion).toBe('2026-04-22.dahlia');
    expect(result.stripeWebhookEndpoint).toMatchObject({
      checked: result.stripeSecretKey.mode === 'live',
      ready: expect.any(Boolean),
      configured: expect.any(Boolean),
      liveMode: expect.any(Boolean),
      enabled: expect.any(Boolean),
      duplicateCount: expect.any(Number),
      apiVersionMatches: expect.any(Boolean),
      requiredEventsConfigured: expect.any(Boolean),
      explicitEventsOnly: expect.any(Boolean),
      noUnexpectedEvents: expect.any(Boolean),
      missingEventCount: expect.any(Number),
      unexpectedEventCount: expect.any(Number),
      errorCode: expect.any(String),
    });
    expect(result.resendApiKey).toMatchObject({
      configured: expect.any(Boolean),
      formatValid: expect.any(Boolean),
    });
    expect(result.resendDomain).toMatchObject({
      checked: result.resendApiKey.configured && result.resendApiKey.formatValid,
      domain: 'kandilo.org',
      configured: expect.any(Boolean),
      verified: expect.any(Boolean),
      status: expect.any(String),
      duplicateCount: expect.any(Number),
      errorCode: expect.any(String),
    });
    expect(result.stripeAccount).toMatchObject({
      checked: true,
      ready: true,
      chargesEnabled: true,
      payoutsEnabled: true,
      detailsSubmitted: true,
      country: 'US',
      defaultCurrency: 'usd',
      disabledReason: '',
      currentlyDueCount: 0,
      pastDueCount: 0,
      eventuallyDueCount: 0,
      futureCurrentlyDueCount: 0,
      futurePastDueCount: 0,
      futureEventuallyDueCount: 0,
      errorCode: '',
    });
    if (result.resendApiKey.configured) {
      expect(result.taxReceiptDeliveryReady).toBe(
        result.resendApiKey.formatValid
          && result.resendDomain.checked
          && result.resendDomain.verified
          && result.resendDomain.duplicateCount === 0
      );
    } else {
      expect(result.taxReceiptDeliveryReady).toBe(false);
    }
    expect(result.webhookUrl).toBe('https://us-central1-kandilo-2f7a9.cloudfunctions.net/stripeWebhook');
    expect(result.webhookActivity).toMatchObject({
      checkedEventCount: 2,
      checkedLiveEventCount: 1,
      smokeFreshnessWindowHours: 72,
      latestProcessedAtMillis: issueProcessedAt.toMillis(),
      latestLiveProcessedAtMillis: issueProcessedAt.toMillis(),
      latestCheckoutCompletedAtMillis: checkoutProcessedAt.toMillis(),
      latestLiveCheckoutCompletedAtMillis: null,
      latestType: 'charge.refunded',
      latestStatus: 'validation_failed',
      latestLivemode: true,
      latestLiveType: 'charge.refunded',
      latestLiveStatus: 'validation_failed',
      processedCount: 1,
      liveProcessedCount: 0,
      testProcessedCount: 1,
      processedCheckoutCompletedCount: 1,
      liveProcessedCheckoutCompletedCount: 0,
      testProcessedCheckoutCompletedCount: 1,
      checkoutSmokeFresh: true,
      liveCheckoutSmokeFresh: false,
      validationFailedCount: 1,
      missingGivingCount: 0,
      unpaidSessionCount: 0,
    });
    expect(result.taxReceiptEmailSmoke).toMatchObject({
      checkedEventCount: 0,
      smokeFreshnessWindowHours: 72,
      checkedLiveCheckoutGivingCount: 0,
      emailSentCount: 0,
      liveEmailSentCount: 0,
      latestEmailSentAtMillis: null,
      latestLiveEmailSentAtMillis: null,
      latestLiveCheckoutEmailSentAtMillis: null,
      emailSentFresh: false,
      liveEmailSentFresh: false,
      latestLiveCheckoutEmailSentFresh: false,
      ready: false,
    });
    expect(result.taxReceiptAnnualSmoke).toMatchObject({
      checkedEventCount: 0,
      smokeFreshnessWindowHours: 72,
      annualEmailSentCount: 0,
      latestAnnualEmailSentAtMillis: null,
      latestAnnualReceiptIssuedAtMillis: null,
      latestAnnualReceiptEmailSentAtMillis: null,
      latestAnnualReceiptPdfRetainedAtMillis: null,
      latestAnnualReceiptPdfObjectReady: false,
      latestAnnualReceiptSummaryReady: false,
      latestAnnualEmailSentFresh: false,
      latestAnnualReceiptArtifactReady: false,
      latestAnnualReceiptArtifactFresh: false,
      ready: false,
    });
    expect(result.donationFlowReady).toBe(false);
    expect(result.productionReady).toBe(false);
    expect(result.warnings).toContain('stripe_webhook_recent_issues');
    expect(result.warnings).toContain('stripe_webhook_live_issues');
    expect(result.warnings).toContain('tax_receipt_email_smoke_missing');
    expect(result.warnings).toContain('tax_receipt_annual_smoke_missing');
    expect(result.warnings).not.toContain('stripe_webhook_smoke_missing');
    if (result.stripeSecretKey.mode === 'live') {
      expect(result.warnings).toContain('stripe_webhook_live_smoke_missing');
      expect(result.warnings).toContain('stripe_webhook_live_checkout_smoke_missing');
      expect(result.warnings).toContain('tax_receipt_live_email_smoke_missing');
    }
    expect(result.warnings.every((warning) => typeof warning === 'string')).toBe(true);

    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('sk_');
    expect(serialized).not.toContain('rk_');
    expect(serialized).not.toContain('whsec_');
    expect(serialized).not.toContain('re_');
    expect(serialized).not.toContain('acct_');
    expect(serialized).not.toContain('private-giving');
    expect(serialized).not.toContain('cs_live_private');
    expect(serialized).not.toContain('pi_live_private');
    expect(serialized).not.toContain('private-user');
    expect(serialized).not.toContain('private-receipt');

    await expectCallableFails(
      callCallable('getPaymentOperationsReadiness', {}, { uid: 'admin-1', email: 'admin@example.com' }),
      'permission-denied'
    );
  });

  it('requires a completed Checkout webhook before marking payment operations ready', async () => {
    await adminDb.doc('stripeWebhookEvents/refund-only').set({
      type: 'charge.refunded',
      livemode: false,
      status: 'processed',
      givingId: 'private-giving-refund',
      stripePaymentIntentId: 'pi_live_private_refund',
      processedAt: Timestamp.fromDate(new Date('2026-05-24T14:00:00Z')),
    });

    const result = await callCallable<Record<string, never>, {
      webhookActivity: {
        checkedEventCount: number;
        latestType: string;
        latestStatus: string;
        processedCount: number;
        processedCheckoutCompletedCount: number;
        liveProcessedCheckoutCompletedCount: number;
        checkoutSmokeFresh: boolean;
        liveCheckoutSmokeFresh: boolean;
      };
      donationFlowReady: boolean;
      productionReady: boolean;
      warnings: string[];
    }>('getPaymentOperationsReadiness', {}, SUPER_ADMIN_AUTH);

    expect(result.webhookActivity).toMatchObject({
      checkedEventCount: 1,
      latestType: 'charge.refunded',
      latestStatus: 'processed',
      processedCount: 1,
      processedCheckoutCompletedCount: 0,
      liveProcessedCheckoutCompletedCount: 0,
      checkoutSmokeFresh: false,
      liveCheckoutSmokeFresh: false,
    });
    expect(result.donationFlowReady).toBe(false);
    expect(result.productionReady).toBe(false);
    expect(result.warnings).not.toContain('stripe_webhook_smoke_missing');
    expect(result.warnings).toContain('stripe_webhook_checkout_smoke_missing');
  });

  it('requires backend email-sent audit evidence for the official receipt smoke gate', async () => {
    const liveCheckoutProcessedAt = Timestamp.fromMillis(Date.now() - 2 * HOUR_MS);
    const receiptEmailSentAt = Timestamp.fromMillis(liveCheckoutProcessedAt.toMillis() + 5 * MINUTE_MS);
    const noiseBaseMillis = liveCheckoutProcessedAt.toMillis() + 30 * MINUTE_MS;

    await adminDb.doc('stripeWebhookEvents/live-checkout-smoke').set({
      type: 'checkout.session.completed',
      livemode: true,
      status: 'processed',
      givingId: 'private-giving-live-smoke',
      stripeSessionId: 'cs_live_private_smoke',
      processedAt: liveCheckoutProcessedAt,
    });
    await setDocsInBatches(Array.from({ length: 60 }, (_, index) => ({
      path: `stripeWebhookEvents/newer-non-checkout-smoke-${index}`,
      data: {
        type: index % 2 === 0 ? 'charge.refunded' : 'checkout.session.expired',
        livemode: true,
        status: 'processed',
        givingId: `private-webhook-noise-${index}`,
        processedAt: Timestamp.fromMillis(noiseBaseMillis + index * MINUTE_MS + 30 * 1000),
      },
    })));

    const missing = await callCallable<Record<string, never>, {
      webhookActivity: {
        processedCheckoutCompletedCount: number;
        liveProcessedCheckoutCompletedCount: number;
        checkoutSmokeFresh: boolean;
        liveCheckoutSmokeFresh: boolean;
      };
      taxReceiptEmailSmoke: {
        checkedEventCount: number;
        smokeFreshnessWindowHours: number;
        checkedLiveCheckoutGivingCount: number;
        emailSentCount: number;
        liveEmailSentCount: number;
        latestLiveCheckoutEmailSentAtMillis: number | null;
        emailSentFresh: boolean;
        liveEmailSentFresh: boolean;
        latestLiveCheckoutEmailSentFresh: boolean;
        ready: boolean;
      };
      productionReady: boolean;
      warnings: string[];
    }>('getPaymentOperationsReadiness', {}, SUPER_ADMIN_AUTH);

    expect(missing.webhookActivity).toMatchObject({
      processedCheckoutCompletedCount: 1,
      liveProcessedCheckoutCompletedCount: 1,
      checkoutSmokeFresh: true,
      liveCheckoutSmokeFresh: true,
    });
    expect(missing.taxReceiptEmailSmoke).toMatchObject({
      checkedEventCount: 0,
      smokeFreshnessWindowHours: 72,
      checkedLiveCheckoutGivingCount: 1,
      emailSentCount: 0,
      liveEmailSentCount: 0,
      latestLiveCheckoutEmailSentAtMillis: null,
      emailSentFresh: false,
      liveEmailSentFresh: false,
      latestLiveCheckoutEmailSentFresh: false,
      ready: false,
    });
    expect(missing.productionReady).toBe(false);
    expect(missing.warnings).toContain('tax_receipt_email_smoke_missing');
    if (missing.warnings.includes('stripe_secret_key_test_mode')) {
      expect(missing.warnings).not.toContain('tax_receipt_live_email_smoke_missing');
    }

    await adminDb.doc('taxReceiptEvents/live-receipt-email-smoke').set({
      action: 'email_sent',
      actorUid: 'treasurer-1',
      churchId: CHURCH_ID,
      userId: 'private-user-live-smoke',
      receiptId: 'private-receipt-live-smoke',
      givingId: 'private-giving-live-smoke',
      kind: 'single',
      receiptYear: 2026,
      createdAt: receiptEmailSentAt,
    });
    await setDocsInBatches(Array.from({ length: 60 }, (_, index) => ({
      path: `taxReceiptEvents/newer-non-email-smoke-${index}`,
      data: {
        action: index % 2 === 0 ? 'pdf_downloaded' : 'email_failed',
        actorUid: 'treasurer-1',
        churchId: CHURCH_ID,
        userId: `private-user-noise-${index}`,
        receiptId: `private-receipt-noise-${index}`,
        givingId: `private-giving-noise-${index}`,
        kind: 'single',
        receiptYear: 2026,
        createdAt: Timestamp.fromMillis(noiseBaseMillis + index * MINUTE_MS),
      },
    })));

    const result = await callCallable<Record<string, never>, {
      webhookActivity: {
        processedCheckoutCompletedCount: number;
        liveProcessedCheckoutCompletedCount: number;
        checkoutSmokeFresh: boolean;
        liveCheckoutSmokeFresh: boolean;
      };
      taxReceiptEmailSmoke: {
        checkedEventCount: number;
        smokeFreshnessWindowHours: number;
        checkedLiveCheckoutGivingCount: number;
        emailSentCount: number;
        liveEmailSentCount: number;
        latestEmailSentAtMillis: number | null;
        latestLiveEmailSentAtMillis: number | null;
        latestLiveCheckoutEmailSentAtMillis: number | null;
        emailSentFresh: boolean;
        liveEmailSentFresh: boolean;
        latestLiveCheckoutEmailSentFresh: boolean;
        ready: boolean;
      };
      warnings: string[];
    }>('getPaymentOperationsReadiness', {}, SUPER_ADMIN_AUTH);

    expect(result.webhookActivity).toMatchObject({
      processedCheckoutCompletedCount: 1,
      liveProcessedCheckoutCompletedCount: 1,
      checkoutSmokeFresh: true,
      liveCheckoutSmokeFresh: true,
    });
    expect(result.taxReceiptEmailSmoke).toMatchObject({
      checkedEventCount: 1,
      smokeFreshnessWindowHours: 72,
      checkedLiveCheckoutGivingCount: 1,
      emailSentCount: 1,
      liveEmailSentCount: 1,
      latestEmailSentAtMillis: receiptEmailSentAt.toMillis(),
      latestLiveEmailSentAtMillis: receiptEmailSentAt.toMillis(),
      latestLiveCheckoutEmailSentAtMillis: receiptEmailSentAt.toMillis(),
      emailSentFresh: true,
      liveEmailSentFresh: true,
      latestLiveCheckoutEmailSentFresh: true,
      ready: true,
    });
    expect(result.warnings).not.toContain('tax_receipt_email_smoke_missing');
    expect(result.warnings).not.toContain('tax_receipt_live_email_smoke_missing');

    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('private-giving-live-smoke');
    expect(serialized).not.toContain('private-user-live-smoke');
    expect(serialized).not.toContain('private-receipt-live-smoke');
    expect(serialized).not.toContain('cs_live_private_smoke');
  });

  it('keeps live Checkout smoke visible when newer test-mode Checkout completions fill the general Checkout window', async () => {
    const liveCheckoutProcessedAt = Timestamp.fromMillis(Date.now() - 2 * HOUR_MS);
    const noiseBaseMillis = liveCheckoutProcessedAt.toMillis() + 30 * MINUTE_MS;
    const latestTestCheckoutProcessedAt = Timestamp.fromMillis(noiseBaseMillis + 59 * MINUTE_MS);

    await adminDb.doc('stripeWebhookEvents/live-checkout-behind-test-noise').set({
      type: 'checkout.session.completed',
      livemode: true,
      status: 'processed',
      givingId: 'private-giving-live-behind-test-noise',
      stripeSessionId: 'cs_live_private_behind_test_noise',
      processedAt: liveCheckoutProcessedAt,
    });
    await setDocsInBatches(Array.from({ length: 60 }, (_, index) => ({
      path: `stripeWebhookEvents/newer-test-checkout-noise-${index}`,
      data: {
        type: 'checkout.session.completed',
        livemode: false,
        status: 'processed',
        givingId: `private-test-checkout-noise-${index}`,
        stripeSessionId: `cs_test_private_noise_${index}`,
        processedAt: Timestamp.fromMillis(noiseBaseMillis + index * MINUTE_MS),
      },
    })));

    const result = await callCallable<Record<string, never>, {
      webhookActivity: {
        checkedLiveEventCount: number;
        processedCheckoutCompletedCount: number;
        liveProcessedCount: number;
        liveProcessedCheckoutCompletedCount: number;
        testProcessedCheckoutCompletedCount: number;
        latestCheckoutCompletedAtMillis: number | null;
        latestLiveCheckoutCompletedAtMillis: number | null;
        latestLiveProcessedAtMillis: number | null;
        latestLiveType: string;
        latestLiveStatus: string;
        checkoutSmokeFresh: boolean;
        liveCheckoutSmokeFresh: boolean;
      };
      warnings: string[];
    }>('getPaymentOperationsReadiness', {}, SUPER_ADMIN_AUTH);

    expect(result.webhookActivity).toMatchObject({
      checkedLiveEventCount: 1,
      processedCheckoutCompletedCount: 50,
      liveProcessedCount: 1,
      liveProcessedCheckoutCompletedCount: 1,
      testProcessedCheckoutCompletedCount: 50,
      latestCheckoutCompletedAtMillis: latestTestCheckoutProcessedAt.toMillis(),
      latestLiveCheckoutCompletedAtMillis: liveCheckoutProcessedAt.toMillis(),
      latestLiveProcessedAtMillis: liveCheckoutProcessedAt.toMillis(),
      latestLiveType: 'checkout.session.completed',
      latestLiveStatus: 'processed',
      checkoutSmokeFresh: true,
      liveCheckoutSmokeFresh: true,
    });
    expect(result.warnings).not.toContain('stripe_webhook_live_smoke_missing');
    expect(result.warnings).not.toContain('stripe_webhook_latest_live_not_processed');

    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('private-giving-live-behind-test-noise');
    expect(serialized).not.toContain('private-test-checkout-noise');
    expect(serialized).not.toContain('cs_live_private_behind_test_noise');
    expect(serialized).not.toContain('cs_test_private_noise');
  });

  it('keeps live webhook issues visible when newer test-mode Checkout completions fill the general webhook window', async () => {
    const liveIssueProcessedAt = Timestamp.fromMillis(Date.now() - 90 * MINUTE_MS);
    const noiseBaseMillis = liveIssueProcessedAt.toMillis() + 30 * MINUTE_MS;

    await adminDb.doc('stripeWebhookEvents/live-issue-behind-test-noise').set({
      type: 'checkout.session.completed',
      livemode: true,
      status: 'validation_failed',
      givingId: 'private-giving-live-issue-behind-test-noise',
      stripeSessionId: 'cs_live_private_issue_behind_test_noise',
      processedAt: liveIssueProcessedAt,
    });
    await setDocsInBatches(Array.from({ length: 60 }, (_, index) => ({
      path: `stripeWebhookEvents/newer-test-webhook-noise-${index}`,
      data: {
        type: 'checkout.session.completed',
        livemode: false,
        status: 'processed',
        givingId: `private-test-webhook-noise-${index}`,
        stripeSessionId: `cs_test_private_webhook_noise_${index}`,
        processedAt: Timestamp.fromMillis(noiseBaseMillis + index * MINUTE_MS),
      },
    })));

    const result = await callCallable<Record<string, never>, {
      webhookActivity: {
        checkedEventCount: number;
        validationFailedCount: number;
        liveIssueCount: number;
        liveValidationFailedCount: number;
        liveMissingGivingCount: number;
        liveUnpaidSessionCount: number;
        latestLiveIssueAtMillis: number | null;
      };
      warnings: string[];
    }>('getPaymentOperationsReadiness', {}, SUPER_ADMIN_AUTH);

    expect(result.webhookActivity).toMatchObject({
      checkedEventCount: 20,
      validationFailedCount: 0,
      liveIssueCount: 1,
      liveValidationFailedCount: 1,
      liveMissingGivingCount: 0,
      liveUnpaidSessionCount: 0,
      latestLiveIssueAtMillis: liveIssueProcessedAt.toMillis(),
    });
    expect(result.warnings).toContain('stripe_webhook_live_issues');
    expect(result.warnings).not.toContain('stripe_webhook_recent_issues');

    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('private-giving-live-issue-behind-test-noise');
    expect(serialized).not.toContain('private-test-webhook-noise');
    expect(serialized).not.toContain('cs_live_private_issue_behind_test_noise');
    expect(serialized).not.toContain('cs_test_private_webhook_noise');
  });

  it('newer unrelated email-sent audit records cannot hide live receipt smoke', async () => {
    const liveCheckoutProcessedAt = Timestamp.fromMillis(Date.now() - 2 * HOUR_MS);
    const receiptEmailSentAt = Timestamp.fromMillis(liveCheckoutProcessedAt.toMillis() + 5 * MINUTE_MS);
    const noiseBaseMillis = liveCheckoutProcessedAt.toMillis() + 30 * MINUTE_MS;
    const latestUnrelatedEmailSentAt = Timestamp.fromMillis(noiseBaseMillis + 59 * MINUTE_MS);

    await Promise.all([
      adminDb.doc('stripeWebhookEvents/live-checkout-smoke').set({
        type: 'checkout.session.completed',
        livemode: true,
        status: 'processed',
        givingId: 'private-giving-live-smoke',
        stripeSessionId: 'cs_live_private_smoke',
        processedAt: liveCheckoutProcessedAt,
      }),
      adminDb.doc('taxReceiptEvents/live-receipt-email-smoke').set({
        action: 'email_sent',
        actorUid: 'treasurer-1',
        churchId: CHURCH_ID,
        userId: 'private-user-live-smoke',
        receiptId: 'private-receipt-live-smoke',
        givingId: 'private-giving-live-smoke',
        kind: 'single',
        receiptYear: 2026,
        createdAt: receiptEmailSentAt,
      }),
    ]);
    await setDocsInBatches(Array.from({ length: 60 }, (_, index) => ({
      path: `taxReceiptEvents/newer-unrelated-email-smoke-${index}`,
      data: {
        action: 'email_sent',
        actorUid: 'treasurer-1',
        churchId: CHURCH_ID,
        userId: `private-user-unrelated-${index}`,
        receiptId: `private-receipt-unrelated-${index}`,
        givingId: `private-giving-unrelated-${index}`,
        kind: 'single',
        receiptYear: 2026,
        createdAt: Timestamp.fromMillis(noiseBaseMillis + index * MINUTE_MS),
      },
    })));

    const result = await callCallable<Record<string, never>, {
      taxReceiptEmailSmoke: {
        checkedEventCount: number;
        checkedLiveCheckoutGivingCount: number;
        emailSentCount: number;
        liveEmailSentCount: number;
        latestEmailSentAtMillis: number | null;
        latestLiveEmailSentAtMillis: number | null;
        latestLiveCheckoutEmailSentAtMillis: number | null;
        emailSentFresh: boolean;
        liveEmailSentFresh: boolean;
        latestLiveCheckoutEmailSentFresh: boolean;
        ready: boolean;
      };
      warnings: string[];
    }>('getPaymentOperationsReadiness', {}, SUPER_ADMIN_AUTH);

    expect(result.taxReceiptEmailSmoke).toMatchObject({
      checkedEventCount: 50,
      checkedLiveCheckoutGivingCount: 1,
      emailSentCount: 50,
      liveEmailSentCount: 1,
      latestEmailSentAtMillis: latestUnrelatedEmailSentAt.toMillis(),
      latestLiveEmailSentAtMillis: receiptEmailSentAt.toMillis(),
      latestLiveCheckoutEmailSentAtMillis: receiptEmailSentAt.toMillis(),
      emailSentFresh: true,
      liveEmailSentFresh: true,
      latestLiveCheckoutEmailSentFresh: true,
      ready: true,
    });
    expect(result.warnings).not.toContain('tax_receipt_email_smoke_missing');
    expect(result.warnings).not.toContain('tax_receipt_live_email_smoke_missing');

    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('private-giving-live-smoke');
    expect(serialized).not.toContain('private-user-live-smoke');
    expect(serialized).not.toContain('private-receipt-live-smoke');
    expect(serialized).not.toContain('cs_live_private_smoke');
  });

  it('tracks whether receipt email smoke belongs to the newest live Checkout donation', async () => {
    const olderCheckoutProcessedAt = Timestamp.fromMillis(Date.now() - 2 * HOUR_MS);
    const newestCheckoutProcessedAt = Timestamp.fromMillis(olderCheckoutProcessedAt.toMillis() + 60 * MINUTE_MS);
    const olderReceiptEmailSentAt = Timestamp.fromMillis(olderCheckoutProcessedAt.toMillis() + 5 * MINUTE_MS);

    await Promise.all([
      adminDb.doc('stripeWebhookEvents/older-live-checkout-with-email').set({
        type: 'checkout.session.completed',
        livemode: true,
        status: 'processed',
        givingId: 'private-giving-older-live-smoke',
        stripeSessionId: 'cs_live_private_older_smoke',
        processedAt: olderCheckoutProcessedAt,
      }),
      adminDb.doc('stripeWebhookEvents/newest-live-checkout-without-email').set({
        type: 'checkout.session.completed',
        livemode: true,
        status: 'processed',
        givingId: 'private-giving-newest-live-smoke',
        stripeSessionId: 'cs_live_private_newest_smoke',
        processedAt: newestCheckoutProcessedAt,
      }),
      adminDb.doc('taxReceiptEvents/older-live-receipt-email-smoke').set({
        action: 'email_sent',
        actorUid: 'treasurer-1',
        churchId: CHURCH_ID,
        userId: 'private-user-older-live-smoke',
        receiptId: 'private-receipt-older-live-smoke',
        givingId: 'private-giving-older-live-smoke',
        kind: 'single',
        receiptYear: 2026,
        createdAt: olderReceiptEmailSentAt,
      }),
    ]);

    const result = await callCallable<Record<string, never>, {
      taxReceiptEmailSmoke: {
        checkedLiveCheckoutGivingCount: number;
        emailSentCount: number;
        liveEmailSentCount: number;
        latestEmailSentAtMillis: number | null;
        latestLiveEmailSentAtMillis: number | null;
        latestLiveCheckoutEmailSentAtMillis: number | null;
        emailSentFresh: boolean;
        liveEmailSentFresh: boolean;
        latestLiveCheckoutEmailSentFresh: boolean;
        ready: boolean;
      };
      warnings: string[];
    }>('getPaymentOperationsReadiness', {}, SUPER_ADMIN_AUTH);

    expect(result.taxReceiptEmailSmoke).toMatchObject({
      checkedLiveCheckoutGivingCount: 2,
      emailSentCount: 1,
      liveEmailSentCount: 1,
      latestEmailSentAtMillis: olderReceiptEmailSentAt.toMillis(),
      latestLiveEmailSentAtMillis: olderReceiptEmailSentAt.toMillis(),
      latestLiveCheckoutEmailSentAtMillis: null,
      emailSentFresh: true,
      liveEmailSentFresh: true,
      latestLiveCheckoutEmailSentFresh: false,
    });
    if (!result.warnings.includes('stripe_secret_key_test_mode')) {
      expect(result.taxReceiptEmailSmoke.ready).toBe(false);
      expect(result.warnings).toContain('tax_receipt_live_email_smoke_missing');
    }

    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('private-giving-newest-live-smoke');
    expect(serialized).not.toContain('private-giving-older-live-smoke');
    expect(serialized).not.toContain('private-user-older-live-smoke');
    expect(serialized).not.toContain('private-receipt-older-live-smoke');
    expect(serialized).not.toContain('cs_live_private_newest_smoke');
    expect(serialized).not.toContain('cs_live_private_older_smoke');
  });

  it('tracks redacted receipt artifact readiness for the newest live Checkout smoke', async () => {
    const freshTimestamp = Timestamp.fromMillis(Date.now() - 5 * 60 * 1000);
    const staleTimestamp = Timestamp.fromMillis(Date.now() - 96 * 60 * 60 * 1000);
    const retainedPdfStoragePath = 'taxReceipts/church-1/2026/private-receipt-artifact-smoke.pdf';
    const retainedPdfSha256 = 'a'.repeat(64);
    const retainedPdfByteLength = 2048;

    await Promise.all([
      adminDb.doc('stripeWebhookEvents/live-checkout-artifact-smoke').set({
        type: 'checkout.session.completed',
        livemode: true,
        status: 'processed',
        givingId: 'private-giving-artifact-smoke',
        stripeSessionId: 'cs_live_private_artifact_smoke',
        processedAt: freshTimestamp,
      }),
      adminDb.doc('taxReceiptEvents/live-receipt-artifact-smoke').set({
        action: 'email_sent',
        actorUid: 'treasurer-1',
        churchId: CHURCH_ID,
        userId: 'private-user-artifact-smoke',
        receiptId: 'private-receipt-artifact-smoke',
        givingId: 'private-giving-artifact-smoke',
        kind: 'single',
        receiptYear: 2026,
        createdAt: freshTimestamp,
      }),
    ]);

    const missingArtifacts = await callCallable<Record<string, never>, {
      taxReceiptEmailSmoke: {
        latestLiveCheckoutEmailSentAtMillis: number | null;
        latestLiveCheckoutReceiptPdfObjectReady: boolean;
        latestLiveCheckoutReceiptArtifactReady: boolean;
        latestLiveCheckoutReceiptArtifactFresh: boolean;
        ready: boolean;
      };
      warnings: string[];
    }>('getPaymentOperationsReadiness', {}, SUPER_ADMIN_AUTH);

    expect(missingArtifacts.taxReceiptEmailSmoke).toMatchObject({
      latestLiveCheckoutEmailSentAtMillis: expect.any(Number),
      latestLiveCheckoutReceiptPdfObjectReady: false,
      latestLiveCheckoutReceiptArtifactReady: false,
      latestLiveCheckoutReceiptArtifactFresh: false,
    });
    if (!missingArtifacts.warnings.includes('stripe_secret_key_test_mode')) {
      expect(missingArtifacts.taxReceiptEmailSmoke.ready).toBe(false);
      expect(missingArtifacts.warnings).toContain('tax_receipt_live_receipt_artifacts_missing');
    }

    await Promise.all([
      adminDb.doc('giving/private-giving-artifact-smoke').set({
        churchId: CHURCH_ID,
        churchName: 'St. Nicholas',
        userId: 'private-user-artifact-smoke',
        donorName: 'Parishioner',
        donorEmail: '',
        donorNamePublicSafe: true,
        receiptManagerGivingSafeVersion: 0,
        churchReceiptVisible: true,
        anonymous: false,
        amount: 25,
        amountCents: 2500,
        currency: 'USD',
        purpose: 'General Fund',
        status: 'completed',
        taxReceiptId: 'private-receipt-artifact-smoke',
        taxReceiptNumber: 'STN-2026-000555',
        taxReceiptStatus: 'sent',
        taxReceiptSentAt: freshTimestamp,
        stripePaymentIntentId: 'pi_live_private_artifact_smoke',
        stripePaymentStatus: 'paid',
        completedAt: freshTimestamp,
        createdAt: freshTimestamp,
        updatedAt: freshTimestamp,
      }),
      adminDb.doc('taxReceipts/private-receipt-artifact-smoke').set({
        churchId: CHURCH_ID,
        churchName: 'St. Nicholas',
        userId: 'private-user-artifact-smoke',
        givingId: 'private-giving-artifact-smoke',
        kind: 'single',
        status: 'sent',
        receiptNumber: 'STN-2026-000555',
        receiptYear: 2026,
        organizationName: 'St. Nicholas Orthodox Church',
        donorName: 'Parishioner',
        donorEmail: 'member@example.com',
        amountCents: 2500,
        eligibleAmountCents: 2500,
        currency: 'USD',
        purpose: 'General Fund',
        issuedAt: freshTimestamp,
        emailSentAt: freshTimestamp,
        pdfStoragePath: retainedPdfStoragePath,
        pdfSha256: retainedPdfSha256,
        pdfByteLength: retainedPdfByteLength,
        pdfRetentionStatus: 'retained',
        pdfRetainedAt: staleTimestamp,
        createdAt: freshTimestamp,
        updatedAt: freshTimestamp,
      }),
    ]);
    await seedRetainedPdfStorageObject(retainedPdfStoragePath, retainedPdfSha256, retainedPdfByteLength);

    const unsafeGivingMirror = await callCallable<Record<string, never>, {
      taxReceiptEmailSmoke: {
        latestLiveCheckoutReceiptPdfObjectReady: boolean;
        latestLiveCheckoutReceiptArtifactReady: boolean;
        latestLiveCheckoutReceiptArtifactFresh: boolean;
        ready: boolean;
      };
      warnings: string[];
    }>('getPaymentOperationsReadiness', {}, SUPER_ADMIN_AUTH);

    expect(unsafeGivingMirror.taxReceiptEmailSmoke).toMatchObject({
      latestLiveCheckoutReceiptPdfObjectReady: true,
      latestLiveCheckoutReceiptArtifactReady: false,
      latestLiveCheckoutReceiptArtifactFresh: false,
    });
    if (!unsafeGivingMirror.warnings.includes('stripe_secret_key_test_mode')) {
      expect(unsafeGivingMirror.taxReceiptEmailSmoke.ready).toBe(false);
      expect(unsafeGivingMirror.warnings).toContain('tax_receipt_live_receipt_artifacts_missing');
    }

    await adminDb.doc('giving/private-giving-artifact-smoke').update({
      receiptManagerGivingSafeVersion: 1,
      stripePaymentIntentId: FieldValue.delete(),
      stripePaymentStatus: FieldValue.delete(),
    });

    await adminDb.doc('giving/private-giving-artifact-smoke').update({
      taxReceiptNumber: FieldValue.delete(),
    });

    const missingGivingReceiptNumber = await callCallable<Record<string, never>, {
      taxReceiptEmailSmoke: {
        latestLiveCheckoutReceiptPdfObjectReady: boolean;
        latestLiveCheckoutReceiptArtifactReady: boolean;
        latestLiveCheckoutReceiptArtifactFresh: boolean;
        ready: boolean;
      };
      warnings: string[];
    }>('getPaymentOperationsReadiness', {}, SUPER_ADMIN_AUTH);

    expect(missingGivingReceiptNumber.taxReceiptEmailSmoke).toMatchObject({
      latestLiveCheckoutReceiptPdfObjectReady: true,
      latestLiveCheckoutReceiptArtifactReady: false,
      latestLiveCheckoutReceiptArtifactFresh: false,
    });
    if (!missingGivingReceiptNumber.warnings.includes('stripe_secret_key_test_mode')) {
      expect(missingGivingReceiptNumber.taxReceiptEmailSmoke.ready).toBe(false);
      expect(missingGivingReceiptNumber.warnings).toContain('tax_receipt_live_receipt_artifacts_missing');
    }

    await adminDb.doc('giving/private-giving-artifact-smoke').update({
      taxReceiptNumber: 'unassigned',
    });

    const unassignedGivingReceiptNumber = await callCallable<Record<string, never>, {
      taxReceiptEmailSmoke: {
        latestLiveCheckoutReceiptPdfObjectReady: boolean;
        latestLiveCheckoutReceiptArtifactReady: boolean;
        latestLiveCheckoutReceiptArtifactFresh: boolean;
        ready: boolean;
      };
      warnings: string[];
    }>('getPaymentOperationsReadiness', {}, SUPER_ADMIN_AUTH);

    expect(unassignedGivingReceiptNumber.taxReceiptEmailSmoke).toMatchObject({
      latestLiveCheckoutReceiptPdfObjectReady: true,
      latestLiveCheckoutReceiptArtifactReady: false,
      latestLiveCheckoutReceiptArtifactFresh: false,
    });
    if (!unassignedGivingReceiptNumber.warnings.includes('stripe_secret_key_test_mode')) {
      expect(unassignedGivingReceiptNumber.taxReceiptEmailSmoke.ready).toBe(false);
      expect(unassignedGivingReceiptNumber.warnings).toContain('tax_receipt_live_receipt_artifacts_missing');
    }

    await adminDb.doc('giving/private-giving-artifact-smoke').update({
      taxReceiptNumber: 'STN-2026-999999',
    });

    const mismatchedGivingReceiptNumber = await callCallable<Record<string, never>, {
      taxReceiptEmailSmoke: {
        latestLiveCheckoutReceiptPdfObjectReady: boolean;
        latestLiveCheckoutReceiptArtifactReady: boolean;
        latestLiveCheckoutReceiptArtifactFresh: boolean;
        ready: boolean;
      };
      warnings: string[];
    }>('getPaymentOperationsReadiness', {}, SUPER_ADMIN_AUTH);

    expect(mismatchedGivingReceiptNumber.taxReceiptEmailSmoke).toMatchObject({
      latestLiveCheckoutReceiptPdfObjectReady: true,
      latestLiveCheckoutReceiptArtifactReady: false,
      latestLiveCheckoutReceiptArtifactFresh: false,
    });
    if (!mismatchedGivingReceiptNumber.warnings.includes('stripe_secret_key_test_mode')) {
      expect(mismatchedGivingReceiptNumber.taxReceiptEmailSmoke.ready).toBe(false);
      expect(mismatchedGivingReceiptNumber.warnings).toContain('tax_receipt_live_receipt_artifacts_missing');
    }

    await adminDb.doc('giving/private-giving-artifact-smoke').update({
      taxReceiptNumber: 'STN-2026-000555',
    });

    const staleArtifacts = await callCallable<Record<string, never>, {
      taxReceiptEmailSmoke: {
        latestLiveCheckoutGivingSentAtMillis: number | null;
        latestLiveCheckoutReceiptIssuedAtMillis: number | null;
        latestLiveCheckoutReceiptEmailSentAtMillis: number | null;
        latestLiveCheckoutReceiptPdfRetainedAtMillis: number | null;
        latestLiveCheckoutReceiptPdfObjectReady: boolean;
        latestLiveCheckoutReceiptArtifactReady: boolean;
        latestLiveCheckoutReceiptArtifactFresh: boolean;
        ready: boolean;
      };
      warnings: string[];
    }>('getPaymentOperationsReadiness', {}, SUPER_ADMIN_AUTH);

    expect(staleArtifacts.taxReceiptEmailSmoke).toMatchObject({
      latestLiveCheckoutGivingSentAtMillis: expect.any(Number),
      latestLiveCheckoutReceiptIssuedAtMillis: expect.any(Number),
      latestLiveCheckoutReceiptEmailSentAtMillis: expect.any(Number),
      latestLiveCheckoutReceiptPdfRetainedAtMillis: staleTimestamp.toMillis(),
      latestLiveCheckoutReceiptPdfObjectReady: true,
      latestLiveCheckoutReceiptArtifactReady: true,
      latestLiveCheckoutReceiptArtifactFresh: false,
    });
    if (!staleArtifacts.warnings.includes('stripe_secret_key_test_mode')) {
      expect(staleArtifacts.taxReceiptEmailSmoke.ready).toBe(false);
      expect(staleArtifacts.warnings).toContain('tax_receipt_live_receipt_artifacts_stale');
    }

    await adminDb.doc('taxReceipts/private-receipt-artifact-smoke').update({
      pdfRetainedAt: freshTimestamp,
      pdfRetentionStatus: 'failed',
    });

    const failedRetentionStatus = await callCallable<Record<string, never>, {
      taxReceiptEmailSmoke: {
        latestLiveCheckoutReceiptPdfObjectReady: boolean;
        latestLiveCheckoutReceiptArtifactReady: boolean;
        latestLiveCheckoutReceiptArtifactFresh: boolean;
        ready: boolean;
      };
      warnings: string[];
    }>('getPaymentOperationsReadiness', {}, SUPER_ADMIN_AUTH);

    expect(failedRetentionStatus.taxReceiptEmailSmoke).toMatchObject({
      latestLiveCheckoutReceiptPdfObjectReady: true,
      latestLiveCheckoutReceiptArtifactReady: false,
      latestLiveCheckoutReceiptArtifactFresh: true,
    });
    if (!failedRetentionStatus.warnings.includes('stripe_secret_key_test_mode')) {
      expect(failedRetentionStatus.taxReceiptEmailSmoke.ready).toBe(false);
      expect(failedRetentionStatus.warnings).toContain('tax_receipt_live_receipt_artifacts_missing');
    }

    await adminDb.doc('taxReceipts/private-receipt-artifact-smoke').update({
      pdfRetentionStatus: 'retained',
      pdfSha256: 'b'.repeat(64),
    });

    const mismatchedStorageObject = await callCallable<Record<string, never>, {
      taxReceiptEmailSmoke: {
        latestLiveCheckoutReceiptPdfObjectReady: boolean;
        latestLiveCheckoutReceiptArtifactReady: boolean;
        latestLiveCheckoutReceiptArtifactFresh: boolean;
        ready: boolean;
      };
      warnings: string[];
    }>('getPaymentOperationsReadiness', {}, SUPER_ADMIN_AUTH);

    expect(mismatchedStorageObject.taxReceiptEmailSmoke).toMatchObject({
      latestLiveCheckoutReceiptPdfObjectReady: false,
      latestLiveCheckoutReceiptArtifactReady: false,
      latestLiveCheckoutReceiptArtifactFresh: true,
    });
    if (!mismatchedStorageObject.warnings.includes('stripe_secret_key_test_mode')) {
      expect(mismatchedStorageObject.taxReceiptEmailSmoke.ready).toBe(false);
      expect(mismatchedStorageObject.warnings).toContain('tax_receipt_live_receipt_artifacts_missing');
    }

    await adminDb.doc('taxReceipts/private-receipt-artifact-smoke').update({
      pdfSha256: retainedPdfSha256,
      receiptNumber: 'unassigned',
    });

    const unassignedReceiptNumber = await callCallable<Record<string, never>, {
      taxReceiptEmailSmoke: {
        latestLiveCheckoutReceiptPdfObjectReady: boolean;
        latestLiveCheckoutReceiptArtifactReady: boolean;
        latestLiveCheckoutReceiptArtifactFresh: boolean;
        ready: boolean;
      };
      warnings: string[];
    }>('getPaymentOperationsReadiness', {}, SUPER_ADMIN_AUTH);

    expect(unassignedReceiptNumber.taxReceiptEmailSmoke).toMatchObject({
      latestLiveCheckoutReceiptPdfObjectReady: true,
      latestLiveCheckoutReceiptArtifactReady: false,
      latestLiveCheckoutReceiptArtifactFresh: true,
    });
    if (!unassignedReceiptNumber.warnings.includes('stripe_secret_key_test_mode')) {
      expect(unassignedReceiptNumber.taxReceiptEmailSmoke.ready).toBe(false);
      expect(unassignedReceiptNumber.warnings).toContain('tax_receipt_live_receipt_artifacts_missing');
    }

    await adminDb.doc('taxReceipts/private-receipt-artifact-smoke').update({
      receiptNumber: 'STN-2026-000555',
    });

    const ready = await callCallable<Record<string, never>, {
      taxReceiptEmailSmoke: {
        latestLiveCheckoutReceiptPdfObjectReady: boolean;
        latestLiveCheckoutReceiptArtifactReady: boolean;
        latestLiveCheckoutReceiptArtifactFresh: boolean;
        ready: boolean;
      };
      warnings: string[];
    }>('getPaymentOperationsReadiness', {}, SUPER_ADMIN_AUTH);

    expect(ready.taxReceiptEmailSmoke).toMatchObject({
      latestLiveCheckoutReceiptPdfObjectReady: true,
      latestLiveCheckoutReceiptArtifactReady: true,
      latestLiveCheckoutReceiptArtifactFresh: true,
      ready: true,
    });
    expect(ready.warnings).not.toContain('tax_receipt_live_receipt_artifacts_missing');
    expect(ready.warnings).not.toContain('tax_receipt_live_receipt_artifacts_stale');

    const serialized = JSON.stringify(ready);
    expect(serialized).not.toContain('private-giving-artifact-smoke');
    expect(serialized).not.toContain('private-user-artifact-smoke');
    expect(serialized).not.toContain('private-receipt-artifact-smoke');
    expect(serialized).not.toContain('cs_live_private_artifact_smoke');
    expect(serialized).not.toContain('pi_live_private_artifact_smoke');
  });

  it('tracks redacted annual receipt smoke readiness with staff-safe summary evidence', async () => {
    const freshTimestamp = Timestamp.fromMillis(Date.now() - 5 * 60 * 1000);
    const annualReceiptId = 'annual_runtime_smoke';
    const retainedPdfStoragePath = `taxReceipts/${CHURCH_ID}/${CLOSED_ANNUAL_YEAR}/${annualReceiptId}.pdf`;
    const retainedPdfSha256 = 'c'.repeat(64);
    const retainedPdfByteLength = 3072;
    const receiptNumber = expectedReceiptNumber(CLOSED_ANNUAL_YEAR, 888);
    const annualSmokeContributions = [
      {
        dateLabel: `March 10, ${CLOSED_ANNUAL_YEAR}`,
        purpose: 'General Fund',
        amountCents: 2500,
        eligibleAmountCents: 2500,
        currency: 'USD',
      },
      {
        dateLabel: `November 20, ${CLOSED_ANNUAL_YEAR}`,
        purpose: 'Candles',
        amountCents: 5000,
        eligibleAmountCents: 5000,
        currency: 'USD',
      },
    ];

    await adminDb.doc('taxReceiptEvents/annual-runtime-smoke').set({
      action: 'email_sent',
      actorUid: 'treasurer-1',
      churchId: CHURCH_ID,
      userId: 'private-user-annual-smoke',
      receiptId: annualReceiptId,
      kind: 'annual',
      receiptYear: CLOSED_ANNUAL_YEAR,
      createdAt: freshTimestamp,
    });

    const missingArtifacts = await callCallable<Record<string, never>, {
      taxReceiptAnnualSmoke: {
        checkedEventCount: number;
        annualEmailSentCount: number;
        latestAnnualEmailSentAtMillis: number | null;
        latestAnnualReceiptPdfObjectReady: boolean;
        latestAnnualReceiptSummaryReady: boolean;
        latestAnnualReceiptContributionDetailReady: boolean;
        latestAnnualEmailSentFresh: boolean;
        latestAnnualReceiptArtifactReady: boolean;
        latestAnnualReceiptArtifactFresh: boolean;
        ready: boolean;
      };
      warnings: string[];
    }>('getPaymentOperationsReadiness', {}, SUPER_ADMIN_AUTH);

    expect(missingArtifacts.taxReceiptAnnualSmoke).toMatchObject({
      checkedEventCount: 1,
      annualEmailSentCount: 1,
      latestAnnualEmailSentAtMillis: expect.any(Number),
      latestAnnualReceiptPdfObjectReady: false,
      latestAnnualReceiptSummaryReady: false,
      latestAnnualReceiptContributionDetailReady: false,
      latestAnnualEmailSentFresh: true,
      latestAnnualReceiptArtifactReady: false,
      latestAnnualReceiptArtifactFresh: false,
      ready: false,
    });
    expect(missingArtifacts.warnings).toContain('tax_receipt_annual_artifacts_missing');

    await Promise.all([
      adminDb.doc(`taxReceipts/${annualReceiptId}`).set({
        churchId: CHURCH_ID,
        churchName: 'St. Nicholas',
        userId: 'private-user-annual-smoke',
        kind: 'annual',
        status: 'sent',
        receiptNumber,
        receiptYear: CLOSED_ANNUAL_YEAR,
        annualYear: CLOSED_ANNUAL_YEAR,
        organizationName: 'St. Nicholas Orthodox Church',
        donorName: 'Member One',
        donorEmail: 'member@example.com',
        amountCents: 7500,
        eligibleAmountCents: 7500,
        currency: 'USD',
        purpose: 'Annual giving summary',
        donationCount: 2,
        givingIds: ['annual-smoke-giving-1', 'annual-smoke-giving-2'],
        contributions: annualSmokeContributions,
        issuedAt: freshTimestamp,
        emailSentAt: freshTimestamp,
        pdfStoragePath: retainedPdfStoragePath,
        pdfSha256: retainedPdfSha256,
        pdfByteLength: retainedPdfByteLength,
        pdfRetentionStatus: 'retained',
        pdfRetainedAt: freshTimestamp,
        createdAt: freshTimestamp,
        updatedAt: freshTimestamp,
      }),
      adminDb.doc(`taxReceiptSummaries/${annualReceiptId}`).set({
        receiptId: annualReceiptId,
        churchId: CHURCH_ID,
        userId: 'private-user-annual-smoke',
        donorLabel: 'Member One',
        donorAnonymous: false,
        churchReceiptVisible: true,
        donorLabelPublicSafe: true,
        receiptManagerSummarySafe: true,
        receiptManagerSummarySafeVersion: 2,
        kind: 'annual',
        status: 'sent',
        receiptNumber,
        receiptYear: CLOSED_ANNUAL_YEAR,
        annualYear: CLOSED_ANNUAL_YEAR,
        amountCents: 7500,
        eligibleAmountCents: 7500,
        currency: 'USD',
        donationCount: 2,
        issuedAt: freshTimestamp,
        emailSentAt: freshTimestamp,
        createdAt: freshTimestamp,
        updatedAt: freshTimestamp,
      }),
    ]);
    await seedRetainedPdfStorageObject(retainedPdfStoragePath, retainedPdfSha256, retainedPdfByteLength);

    await adminDb.doc(`taxReceipts/${annualReceiptId}`).update({
      contributions: FieldValue.delete(),
    });

    const missingContributionDetail = await callCallable<Record<string, never>, {
      taxReceiptAnnualSmoke: {
        latestAnnualReceiptSummaryReady: boolean;
        latestAnnualReceiptContributionDetailReady: boolean;
        latestAnnualReceiptArtifactReady: boolean;
        ready: boolean;
      };
      warnings: string[];
    }>('getPaymentOperationsReadiness', {}, SUPER_ADMIN_AUTH);

    expect(missingContributionDetail.taxReceiptAnnualSmoke).toMatchObject({
      latestAnnualReceiptSummaryReady: true,
      latestAnnualReceiptContributionDetailReady: false,
      latestAnnualReceiptArtifactReady: false,
      ready: false,
    });
    expect(missingContributionDetail.warnings).toContain('tax_receipt_annual_contribution_detail_missing');
    expect(missingContributionDetail.warnings).toContain('tax_receipt_annual_artifacts_missing');

    await adminDb.doc(`taxReceipts/${annualReceiptId}`).update({
      contributions: annualSmokeContributions,
    });

    await adminDb.doc(`taxReceiptSummaries/${annualReceiptId}`).update({
      taxReceiptLegalName: 'Private Legal Name',
      taxReceiptAddress: {
        line1: '10 Donor Street',
        city: 'Chicago',
        region: 'IL',
        postalCode: '60601',
        country: 'US',
      },
      stripeConnectAccountId: 'acct_private_annual_smoke',
      stripeRefundStatus: 'partially_refunded',
      stripeAmountRefundedCents: 1000,
    });

    const unsafeSummary = await callCallable<Record<string, never>, {
      taxReceiptAnnualSmoke: {
        latestAnnualReceiptPdfObjectReady: boolean;
        latestAnnualReceiptSummaryReady: boolean;
        latestAnnualReceiptContributionDetailReady: boolean;
        latestAnnualReceiptArtifactReady: boolean;
        ready: boolean;
      };
      warnings: string[];
    }>('getPaymentOperationsReadiness', {}, SUPER_ADMIN_AUTH);

    expect(unsafeSummary.taxReceiptAnnualSmoke).toMatchObject({
      latestAnnualReceiptPdfObjectReady: true,
      latestAnnualReceiptSummaryReady: false,
      latestAnnualReceiptContributionDetailReady: true,
      latestAnnualReceiptArtifactReady: false,
      ready: false,
    });
    expect(unsafeSummary.warnings).toContain('tax_receipt_annual_artifacts_missing');

    await adminDb.doc(`taxReceiptSummaries/${annualReceiptId}`).update({
      taxReceiptLegalName: FieldValue.delete(),
      taxReceiptAddress: FieldValue.delete(),
      stripeConnectAccountId: FieldValue.delete(),
      stripeRefundStatus: FieldValue.delete(),
      stripeAmountRefundedCents: FieldValue.delete(),
    });

    const ready = await callCallable<Record<string, never>, {
      taxReceiptAnnualSmoke: {
        latestAnnualEmailSentAtMillis: number | null;
        latestAnnualReceiptIssuedAtMillis: number | null;
        latestAnnualReceiptEmailSentAtMillis: number | null;
        latestAnnualReceiptPdfRetainedAtMillis: number | null;
        latestAnnualReceiptPdfObjectReady: boolean;
        latestAnnualReceiptSummaryReady: boolean;
        latestAnnualReceiptContributionDetailReady: boolean;
        latestAnnualEmailSentFresh: boolean;
        latestAnnualReceiptArtifactReady: boolean;
        latestAnnualReceiptArtifactFresh: boolean;
        ready: boolean;
      };
      warnings: string[];
    }>('getPaymentOperationsReadiness', {}, SUPER_ADMIN_AUTH);

    expect(ready.taxReceiptAnnualSmoke).toMatchObject({
      latestAnnualEmailSentAtMillis: expect.any(Number),
      latestAnnualReceiptIssuedAtMillis: expect.any(Number),
      latestAnnualReceiptEmailSentAtMillis: expect.any(Number),
      latestAnnualReceiptPdfRetainedAtMillis: expect.any(Number),
      latestAnnualReceiptPdfObjectReady: true,
      latestAnnualReceiptSummaryReady: true,
      latestAnnualReceiptContributionDetailReady: true,
      latestAnnualEmailSentFresh: true,
      latestAnnualReceiptArtifactReady: true,
      latestAnnualReceiptArtifactFresh: true,
      ready: true,
    });
    expect(ready.warnings).not.toContain('tax_receipt_annual_smoke_missing');
    expect(ready.warnings).not.toContain('tax_receipt_annual_artifacts_missing');
    expect(ready.warnings).not.toContain('tax_receipt_annual_artifacts_stale');

    const serialized = JSON.stringify(ready);
    expect(serialized).not.toContain(annualReceiptId);
    expect(serialized).not.toContain('private-user-annual-smoke');
    expect(serialized).not.toContain('annual-smoke-giving');
    expect(serialized).not.toContain('member@example.com');
  });

  it('keeps annual receipt smoke ready when newer privacy-protected annual events exist', async () => {
    const validTimestamp = Timestamp.fromMillis(Date.now() - 10 * 60 * 1000);
    const privateTimestamp = Timestamp.fromMillis(Date.now() - 5 * 60 * 1000);
    const annualReceiptId = 'annual_runtime_smoke_candidate';
    const privateAnnualReceiptId = 'annual_runtime_smoke_private_newer';
    const retainedPdfStoragePath = `taxReceipts/${CHURCH_ID}/${CLOSED_ANNUAL_YEAR}/${annualReceiptId}.pdf`;
    const retainedPdfSha256 = 'd'.repeat(64);
    const retainedPdfByteLength = 4096;
    const receiptNumber = expectedReceiptNumber(CLOSED_ANNUAL_YEAR, 889);
    const annualCandidateContributions = [
      {
        dateLabel: `January 15, ${CLOSED_ANNUAL_YEAR}`,
        purpose: 'General Fund',
        amountCents: 4500,
        eligibleAmountCents: 4500,
        currency: 'USD',
      },
      {
        dateLabel: `December 20, ${CLOSED_ANNUAL_YEAR}`,
        purpose: 'Candles',
        amountCents: 8000,
        eligibleAmountCents: 8000,
        currency: 'USD',
      },
    ];

    await Promise.all([
      adminDb.doc('taxReceiptEvents/annual-runtime-smoke-private-newer').set({
        action: 'email_sent',
        actorUid: 'treasurer-1',
        churchId: CHURCH_ID,
        userId: 'private-user-annual-newer',
        receiptId: privateAnnualReceiptId,
        kind: 'annual',
        receiptYear: CLOSED_ANNUAL_YEAR,
        createdAt: privateTimestamp,
      }),
      adminDb.doc('taxReceiptEvents/annual-runtime-smoke-valid-older').set({
        action: 'email_sent',
        actorUid: 'treasurer-1',
        churchId: CHURCH_ID,
        userId: 'private-user-annual-candidate',
        receiptId: annualReceiptId,
        kind: 'annual',
        receiptYear: CLOSED_ANNUAL_YEAR,
        createdAt: validTimestamp,
      }),
      adminDb.doc(`taxReceipts/${privateAnnualReceiptId}`).set({
        churchId: CHURCH_ID,
        userId: 'private-user-annual-newer',
        kind: 'annual',
        status: 'sent',
        receiptNumber: expectedReceiptNumber(CLOSED_ANNUAL_YEAR, 890),
        receiptYear: CLOSED_ANNUAL_YEAR,
        amountCents: 2500,
        eligibleAmountCents: 2500,
        currency: 'USD',
        donationCount: 2,
        givingIds: ['private-newer-giving-1', 'private-newer-giving-2'],
        issuedAt: privateTimestamp,
        emailSentAt: privateTimestamp,
        createdAt: privateTimestamp,
        updatedAt: privateTimestamp,
      }),
      adminDb.doc(`taxReceipts/${annualReceiptId}`).set({
        churchId: CHURCH_ID,
        churchName: 'St. Nicholas',
        userId: 'private-user-annual-candidate',
        kind: 'annual',
        status: 'sent',
        receiptNumber,
        receiptYear: CLOSED_ANNUAL_YEAR,
        annualYear: CLOSED_ANNUAL_YEAR,
        organizationName: 'St. Nicholas Orthodox Church',
        donorName: 'Member One',
        donorEmail: 'member@example.com',
        amountCents: 12500,
        eligibleAmountCents: 12500,
        currency: 'USD',
        purpose: 'Annual giving summary',
        donationCount: 2,
        givingIds: ['annual-candidate-giving-1', 'annual-candidate-giving-2'],
        contributions: annualCandidateContributions,
        issuedAt: validTimestamp,
        emailSentAt: validTimestamp,
        pdfStoragePath: retainedPdfStoragePath,
        pdfSha256: retainedPdfSha256,
        pdfByteLength: retainedPdfByteLength,
        pdfRetentionStatus: 'retained',
        pdfRetainedAt: validTimestamp,
        createdAt: validTimestamp,
        updatedAt: validTimestamp,
      }),
      adminDb.doc(`taxReceiptSummaries/${annualReceiptId}`).set({
        receiptId: annualReceiptId,
        churchId: CHURCH_ID,
        userId: 'private-user-annual-candidate',
        donorLabel: 'Member One',
        donorAnonymous: false,
        churchReceiptVisible: true,
        donorLabelPublicSafe: true,
        receiptManagerSummarySafe: true,
        receiptManagerSummarySafeVersion: 2,
        kind: 'annual',
        status: 'sent',
        receiptNumber,
        receiptYear: CLOSED_ANNUAL_YEAR,
        annualYear: CLOSED_ANNUAL_YEAR,
        amountCents: 12500,
        eligibleAmountCents: 12500,
        currency: 'USD',
        donationCount: 2,
        issuedAt: validTimestamp,
        emailSentAt: validTimestamp,
        createdAt: validTimestamp,
        updatedAt: validTimestamp,
      }),
    ]);
    await seedRetainedPdfStorageObject(retainedPdfStoragePath, retainedPdfSha256, retainedPdfByteLength);

    const result = await callCallable<Record<string, never>, {
      taxReceiptAnnualSmoke: {
        checkedEventCount: number;
        annualEmailSentCount: number;
        latestAnnualEmailSentAtMillis: number | null;
        latestAnnualReceiptSummaryReady: boolean;
        latestAnnualReceiptContributionDetailReady: boolean;
        latestAnnualReceiptArtifactReady: boolean;
        latestAnnualReceiptArtifactFresh: boolean;
        ready: boolean;
      };
      warnings: string[];
    }>('getPaymentOperationsReadiness', {}, SUPER_ADMIN_AUTH);

    expect(result.taxReceiptAnnualSmoke).toMatchObject({
      checkedEventCount: 2,
      annualEmailSentCount: 2,
      latestAnnualEmailSentAtMillis: validTimestamp.toMillis(),
      latestAnnualReceiptSummaryReady: true,
      latestAnnualReceiptContributionDetailReady: true,
      latestAnnualReceiptArtifactReady: true,
      latestAnnualReceiptArtifactFresh: true,
      ready: true,
    });
    expect(result.warnings).not.toContain('tax_receipt_annual_artifacts_missing');

    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(annualReceiptId);
    expect(serialized).not.toContain(privateAnnualReceiptId);
    expect(serialized).not.toContain('private-user-annual-candidate');
    expect(serialized).not.toContain('private-user-annual-newer');
    expect(serialized).not.toContain('annual-candidate-giving');
    expect(serialized).not.toContain('private-newer-giving');
  });

  it('requires original annual receipt smoke and scans past newer corrected annual events', async () => {
    const validTimestamp = Timestamp.fromMillis(Date.now() - 12 * 60 * 1000);
    const correctedTimestamp = Timestamp.fromMillis(Date.now() - 4 * 60 * 1000);
    const annualReceiptId = 'annual_runtime_original_smoke_candidate';
    const correctedAnnualReceiptId = 'annual_correction_runtime_smoke_newer';
    const correctedPdfStoragePath = `taxReceipts/${CHURCH_ID}/${CLOSED_ANNUAL_YEAR}/${correctedAnnualReceiptId}.pdf`;
    const correctedPdfSha256 = 'e'.repeat(64);
    const correctedPdfByteLength = 2048;
    const retainedPdfStoragePath = `taxReceipts/${CHURCH_ID}/${CLOSED_ANNUAL_YEAR}/${annualReceiptId}.pdf`;
    const retainedPdfSha256 = 'f'.repeat(64);
    const retainedPdfByteLength = 4096;
    const correctedReceiptNumber = expectedReceiptNumber(CLOSED_ANNUAL_YEAR, 891);
    const receiptNumber = expectedReceiptNumber(CLOSED_ANNUAL_YEAR, 892);
    const originalAnnualContributions = [
      {
        dateLabel: `February 2, ${CLOSED_ANNUAL_YEAR}`,
        purpose: 'General Fund',
        amountCents: 5000,
        eligibleAmountCents: 5000,
        currency: 'USD',
      },
      {
        dateLabel: `October 14, ${CLOSED_ANNUAL_YEAR}`,
        purpose: 'Icons',
        amountCents: 7000,
        eligibleAmountCents: 7000,
        currency: 'USD',
      },
    ];

    await Promise.all([
      adminDb.doc('taxReceiptEvents/annual-runtime-smoke-corrected-newer').set({
        action: 'email_sent',
        actorUid: 'treasurer-1',
        churchId: CHURCH_ID,
        userId: 'private-user-annual-corrected',
        receiptId: correctedAnnualReceiptId,
        kind: 'annual',
        receiptYear: CLOSED_ANNUAL_YEAR,
        createdAt: correctedTimestamp,
      }),
      adminDb.doc(`taxReceipts/${correctedAnnualReceiptId}`).set({
        churchId: CHURCH_ID,
        userId: 'private-user-annual-corrected',
        kind: 'annual',
        status: 'sent',
        receiptNumber: correctedReceiptNumber,
        receiptYear: CLOSED_ANNUAL_YEAR,
        annualYear: CLOSED_ANNUAL_YEAR,
        amountCents: 6200,
        eligibleAmountCents: 5000,
        currency: 'USD',
        donationCount: 2,
        givingIds: ['corrected-smoke-giving-1', 'corrected-smoke-giving-2'],
        correctionForReceiptId: 'annual_original_runtime_smoke',
        correctionSourceReason: 'stripe_partial_refund_corrected_reissue',
        correctedAt: correctedTimestamp,
        issuedAt: correctedTimestamp,
        emailSentAt: correctedTimestamp,
        pdfStoragePath: correctedPdfStoragePath,
        pdfSha256: correctedPdfSha256,
        pdfByteLength: correctedPdfByteLength,
        pdfRetentionStatus: 'retained',
        pdfRetainedAt: correctedTimestamp,
        createdAt: correctedTimestamp,
        updatedAt: correctedTimestamp,
      }),
      adminDb.doc(`taxReceiptSummaries/${correctedAnnualReceiptId}`).set({
        receiptId: correctedAnnualReceiptId,
        churchId: CHURCH_ID,
        userId: 'private-user-annual-corrected',
        donorLabel: 'Member One',
        donorAnonymous: false,
        churchReceiptVisible: true,
        donorLabelPublicSafe: true,
        receiptManagerSummarySafe: true,
        receiptManagerSummarySafeVersion: 2,
        kind: 'annual',
        status: 'sent',
        correctedReceipt: true,
        receiptNumber: correctedReceiptNumber,
        receiptYear: CLOSED_ANNUAL_YEAR,
        annualYear: CLOSED_ANNUAL_YEAR,
        amountCents: 6200,
        eligibleAmountCents: 5000,
        currency: 'USD',
        donationCount: 2,
        issuedAt: correctedTimestamp,
        emailSentAt: correctedTimestamp,
        createdAt: correctedTimestamp,
        updatedAt: correctedTimestamp,
      }),
    ]);
    await seedRetainedPdfStorageObject(
      correctedPdfStoragePath,
      correctedPdfSha256,
      correctedPdfByteLength
    );

    const correctedOnly = await callCallable<Record<string, never>, {
      taxReceiptAnnualSmoke: {
        latestAnnualReceiptOriginalYearEndReady: boolean;
        latestAnnualReceiptCorrectedOrReissue: boolean;
        latestAnnualReceiptSummaryReady: boolean;
        latestAnnualReceiptArtifactReady: boolean;
        ready: boolean;
      };
      warnings: string[];
    }>('getPaymentOperationsReadiness', {}, SUPER_ADMIN_AUTH);

    expect(correctedOnly.taxReceiptAnnualSmoke).toMatchObject({
      latestAnnualReceiptOriginalYearEndReady: false,
      latestAnnualReceiptCorrectedOrReissue: true,
      latestAnnualReceiptSummaryReady: true,
      latestAnnualReceiptArtifactReady: false,
      ready: false,
    });
    expect(correctedOnly.warnings).toContain('tax_receipt_annual_original_smoke_missing');

    await Promise.all([
      adminDb.doc('taxReceiptEvents/annual-runtime-smoke-original-older').set({
        action: 'email_sent',
        actorUid: 'treasurer-1',
        churchId: CHURCH_ID,
        userId: 'private-user-annual-original',
        receiptId: annualReceiptId,
        kind: 'annual',
        receiptYear: CLOSED_ANNUAL_YEAR,
        createdAt: validTimestamp,
      }),
      adminDb.doc(`taxReceipts/${annualReceiptId}`).set({
        churchId: CHURCH_ID,
        userId: 'private-user-annual-original',
        kind: 'annual',
        status: 'sent',
        receiptNumber,
        receiptYear: CLOSED_ANNUAL_YEAR,
        annualYear: CLOSED_ANNUAL_YEAR,
        amountCents: 12000,
        eligibleAmountCents: 12000,
        currency: 'USD',
        donationCount: 2,
        givingIds: ['original-smoke-giving-1', 'original-smoke-giving-2'],
        contributions: originalAnnualContributions,
        issuedAt: validTimestamp,
        emailSentAt: validTimestamp,
        pdfStoragePath: retainedPdfStoragePath,
        pdfSha256: retainedPdfSha256,
        pdfByteLength: retainedPdfByteLength,
        pdfRetentionStatus: 'retained',
        pdfRetainedAt: validTimestamp,
        createdAt: validTimestamp,
        updatedAt: validTimestamp,
      }),
      adminDb.doc(`taxReceiptSummaries/${annualReceiptId}`).set({
        receiptId: annualReceiptId,
        churchId: CHURCH_ID,
        userId: 'private-user-annual-original',
        donorLabel: 'Member One',
        donorAnonymous: false,
        churchReceiptVisible: true,
        donorLabelPublicSafe: true,
        receiptManagerSummarySafe: true,
        receiptManagerSummarySafeVersion: 2,
        kind: 'annual',
        status: 'sent',
        receiptNumber,
        receiptYear: CLOSED_ANNUAL_YEAR,
        annualYear: CLOSED_ANNUAL_YEAR,
        amountCents: 12000,
        eligibleAmountCents: 12000,
        currency: 'USD',
        donationCount: 2,
        issuedAt: validTimestamp,
        emailSentAt: validTimestamp,
        createdAt: validTimestamp,
        updatedAt: validTimestamp,
      }),
    ]);
    await seedRetainedPdfStorageObject(retainedPdfStoragePath, retainedPdfSha256, retainedPdfByteLength);

    const result = await callCallable<Record<string, never>, {
      taxReceiptAnnualSmoke: {
        checkedEventCount: number;
        latestAnnualReceiptOriginalYearEndReady: boolean;
        latestAnnualReceiptCorrectedOrReissue: boolean;
        latestAnnualReceiptContributionDetailReady: boolean;
        latestAnnualReceiptArtifactReady: boolean;
        ready: boolean;
      };
      warnings: string[];
    }>('getPaymentOperationsReadiness', {}, SUPER_ADMIN_AUTH);

    expect(result.taxReceiptAnnualSmoke).toMatchObject({
      checkedEventCount: 2,
      latestAnnualReceiptOriginalYearEndReady: true,
      latestAnnualReceiptCorrectedOrReissue: false,
      latestAnnualReceiptContributionDetailReady: true,
      latestAnnualReceiptArtifactReady: true,
      ready: true,
    });
    expect(result.warnings).not.toContain('tax_receipt_annual_original_smoke_missing');
    expect(result.warnings).not.toContain('tax_receipt_annual_artifacts_missing');

    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(annualReceiptId);
    expect(serialized).not.toContain(correctedAnnualReceiptId);
    expect(serialized).not.toContain('private-user-annual-original');
    expect(serialized).not.toContain('private-user-annual-corrected');
    expect(serialized).not.toContain('corrected-smoke-giving');
    expect(serialized).not.toContain('original-smoke-giving');
  });

  it('requires fresh runtime smoke evidence before payment operations can be production-ready', async () => {
    const staleTimestamp = Timestamp.fromMillis(Date.now() - 96 * 60 * 60 * 1000);
    await Promise.all([
      adminDb.doc('stripeWebhookEvents/stale-live-checkout-smoke').set({
        type: 'checkout.session.completed',
        livemode: true,
        status: 'processed',
        givingId: 'private-giving-stale-smoke',
        stripeSessionId: 'cs_live_private_stale_smoke',
        processedAt: staleTimestamp,
      }),
      adminDb.doc('taxReceiptEvents/stale-live-receipt-email-smoke').set({
        action: 'email_sent',
        actorUid: 'treasurer-1',
        churchId: CHURCH_ID,
        userId: 'private-user-stale-smoke',
        receiptId: 'private-receipt-stale-smoke',
        givingId: 'private-giving-stale-smoke',
        kind: 'single',
        receiptYear: 2026,
        createdAt: staleTimestamp,
      }),
    ]);

    const result = await callCallable<Record<string, never>, {
      webhookActivity: {
        processedCheckoutCompletedCount: number;
        liveProcessedCheckoutCompletedCount: number;
        checkoutSmokeFresh: boolean;
        liveCheckoutSmokeFresh: boolean;
      };
      taxReceiptEmailSmoke: {
        checkedEventCount: number;
        emailSentCount: number;
        liveEmailSentCount: number;
        latestLiveCheckoutEmailSentAtMillis: number | null;
        emailSentFresh: boolean;
        liveEmailSentFresh: boolean;
        latestLiveCheckoutEmailSentFresh: boolean;
        ready: boolean;
      };
      donationFlowReady: boolean;
      productionReady: boolean;
      warnings: string[];
    }>('getPaymentOperationsReadiness', {}, SUPER_ADMIN_AUTH);

    expect(result.webhookActivity).toMatchObject({
      processedCheckoutCompletedCount: 1,
      liveProcessedCheckoutCompletedCount: 1,
      checkoutSmokeFresh: false,
      liveCheckoutSmokeFresh: false,
    });
    expect(result.taxReceiptEmailSmoke).toMatchObject({
      checkedEventCount: 1,
      emailSentCount: 1,
      liveEmailSentCount: 1,
      latestLiveCheckoutEmailSentAtMillis: new Date(staleTimestamp.toDate()).getTime(),
      emailSentFresh: false,
      liveEmailSentFresh: false,
      latestLiveCheckoutEmailSentFresh: false,
      ready: false,
    });
    expect(result.donationFlowReady).toBe(false);
    expect(result.productionReady).toBe(false);
    expect(result.warnings).toContain('stripe_webhook_checkout_smoke_stale');
    expect(result.warnings).toContain('tax_receipt_email_smoke_stale');
    if (result.warnings.includes('stripe_secret_key_test_mode')) {
      expect(result.warnings).not.toContain('tax_receipt_live_email_smoke_stale');
    }

    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('private-giving-stale-smoke');
    expect(serialized).not.toContain('private-user-stale-smoke');
    expect(serialized).not.toContain('private-receipt-stale-smoke');
    expect(serialized).not.toContain('cs_live_private_stale_smoke');
  });

  it('returns redacted SuperAdmin tax receipt audit events', async () => {
    await Promise.all([
      adminDb.doc('taxReceiptEvents/event-old').set({
        action: 'issued',
        actorUid: 'private-donor-uid',
        churchId: CHURCH_ID,
        userId: 'private-donor-uid',
        receiptId: 'private-giving-id',
        givingId: 'private-giving-id',
        kind: 'single',
        receiptYear: 2026,
        donorEmail: 'member@example.com',
        donorName: 'Member One',
        organizationTaxId: '12-3456789',
        errorCode: 'sk_live_private',
        reasonCode: 'whsec_private',
        createdAt: Timestamp.fromDate(new Date('2026-05-24T12:00:00Z')),
      }),
      adminDb.doc('taxReceiptEvents/event-new').set({
        action: 'email_failed',
        actorUid: 'treasurer-1',
        churchId: CHURCH_ID,
        userId: 'private-annual-donor-uid',
        receiptId: 'annual_abc123',
        givingId: 'private-annual-giving-id',
        kind: 'annual',
        receiptYear: 2025,
        annualYear: 2025,
        errorCode: 'tax_receipt_send_failed',
        donorAddress: '123 Private Street',
        createdAt: Timestamp.fromDate(new Date('2026-05-24T13:00:00Z')),
      }),
      adminDb.doc('taxReceiptEvents/event-correction').set({
        action: 'corrected',
        actorUid: 'treasurer-1',
        churchId: CHURCH_ID,
        userId: 'private-corrected-annual-donor-uid',
        receiptId: 'annual_correction_private123',
        kind: 'annual',
        receiptYear: 2025,
        annualYear: 2025,
        reasonCode: 'stripe_partial_refund_corrected_reissue',
        createdAt: Timestamp.fromDate(new Date('2026-05-24T12:30:00Z')),
      }),
      adminDb.doc('taxReceiptEvents/event-scheduled-review-summary').set({
        action: 'annual_scheduled_review_summary',
        actorUid: 'system',
        churchId: CHURCH_ID,
        userId: null,
        receiptId: null,
        givingId: null,
        kind: 'annual',
        receiptYear: 2025,
        annualYear: 2025,
        errorCode: 'tax_receipt_previously_receipted_ack_required',
        reviewCount: 4,
        createdAt: Timestamp.fromDate(new Date('2026-05-24T12:45:00Z')),
      }),
    ]);

    const result = await callCallable<Record<string, never>, {
      events: Array<{
        id: string;
        action: string;
        actorUid: string;
        churchName: string;
        receiptId: string;
        errorCode: string;
        reviewCount: number | null;
        createdAtMillis: number;
        userId?: string;
        givingId?: string;
        donorEmail?: string;
        donorName?: string;
        donorAddress?: string;
        organizationTaxId?: string;
      }>;
    }>('getTaxReceiptAuditEvents', {}, SUPER_ADMIN_AUTH);

    expect(result.events.map((event) => event.id).slice(0, 3)).toEqual([
      'event-new',
      'event-scheduled-review-summary',
      'event-correction',
    ]);
    expect(result.events[0]).toMatchObject({
      action: 'email_failed',
      actorUid: 'treasurer-1',
      churchName: 'St. Nicholas',
      receiptId: 'annual_receipt',
      errorCode: 'tax_receipt_send_failed',
      createdAtMillis: new Date('2026-05-24T13:00:00Z').getTime(),
    });
    expect(result.events[1]).toMatchObject({
      action: 'annual_scheduled_review_summary',
      actorUid: 'system',
      receiptId: '',
      errorCode: 'tax_receipt_previously_receipted_ack_required',
      reviewCount: 4,
    });
    expect(result.events[2]).toMatchObject({
      action: 'corrected',
      actorUid: 'treasurer-1',
      receiptId: 'annual_correction_receipt',
    });
    expect(result.events[3]).toMatchObject({
      action: 'issued',
      actorUid: 'donor',
      receiptId: 'single_receipt',
      errorCode: 'receipt_audit_issue',
      reasonCode: 'receipt_audit_issue',
    });
    for (const event of result.events) {
      expect(event).not.toHaveProperty('donorEmail');
      expect(event).not.toHaveProperty('donorName');
      expect(event).not.toHaveProperty('donorAddress');
      expect(event).not.toHaveProperty('organizationTaxId');
      expect(event).not.toHaveProperty('userId');
      expect(event).not.toHaveProperty('givingId');
    }
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('private-donor-uid');
    expect(serialized).not.toContain('private-annual-donor-uid');
    expect(serialized).not.toContain('private-corrected-annual-donor-uid');
    expect(serialized).not.toContain('private-giving-id');
    expect(serialized).not.toContain('private-annual-giving-id');
    expect(serialized).not.toContain('annual_abc123');
    expect(serialized).not.toContain('annual_correction_private123');
    expect(serialized).not.toContain('sk_live_private');
    expect(serialized).not.toContain('whsec_private');

    await expectCallableFails(
      callCallable('getTaxReceiptAuditEvents', {}, { uid: 'admin-1', email: 'admin@example.com' }),
      'permission-denied'
    );
  });

  it('processes Stripe checkout webhooks idempotently and records validation failures', async () => {
    const givingId = 'giving-webhook-1';
    const checkoutCompletedAt = Math.floor(new Date('2026-01-01T05:30:00Z').getTime() / 1000);
    await adminDb.doc(`churches/${CHURCH_ID}`).update({
      timezone: 'America/Chicago',
      taxReceiptSettings: {
        enabled: true,
        eligibilityConfirmed: true,
        jurisdiction: 'US',
        organizationName: 'St. Nicholas Orthodox Church',
        organizationAddress: '123 Church Street, Chicago, IL',
        taxId: '12-3456789',
        receiptPrefix: 'STN',
        goodsServicesStatement:
          'No goods or services were provided in exchange for this contribution other than intangible religious benefits.',
        autoIssue: true,
      },
    });
    await adminDb.doc(`giving/${givingId}`).set({
      churchId: CHURCH_ID,
      churchName: 'St. Nicholas',
      userId: 'member-1',
      amount: 50,
      amountCents: 5000,
      currency: 'USD',
      purpose: 'General Fund',
      status: 'pending',
      stripeCheckoutSessionId: 'cs_test_webhook',
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    const completedEvent = {
      id: 'evt_checkout_completed',
      type: 'checkout.session.completed',
      livemode: false,
      created: checkoutCompletedAt,
      data: {
        object: {
          id: 'cs_test_webhook',
          payment_status: 'paid',
          payment_intent: 'pi_test_webhook',
          amount_total: 5000,
          currency: 'usd',
          metadata: {
            givingId,
            churchId: CHURCH_ID,
            userId: 'member-1',
            amountCents: '5000',
            currency: 'usd',
          },
        },
      },
    };

    await expect(
      postFunction('stripeWebhook', completedEvent, { 'stripe-signature': 'sig_test' })
    ).resolves.toMatchObject({
      status: 200,
      body: { received: true },
    });

    const completedGiving = await waitFor(
      async () => (await adminDb.doc(`giving/${givingId}`).get()).data(),
      (data) =>
        data?.status === 'completed'
        && Boolean(data.receiptEmailSentAt)
        && data.taxReceiptStatus === 'sent',
      'completed giving receipt'
    );
    expect(completedGiving).toMatchObject({
      status: 'completed',
      receiptEmailDateLabel: 'December 31, 2025',
      receiptEmailAmountCents: 5000,
      taxReceiptId: givingId,
      taxReceiptStatus: 'sent',
    });
    expect(completedGiving).not.toHaveProperty('stripeCheckoutSessionId');
    expect(completedGiving).not.toHaveProperty('stripePaymentIntentId');
    expect(completedGiving).not.toHaveProperty('stripePaymentStatus');
    expect((await adminDb.doc(`givingPaymentMetadata/${givingId}`).get()).data()).toMatchObject({
      churchId: CHURCH_ID,
      userId: 'member-1',
      amountCents: 5000,
      currency: 'USD',
      stripeCheckoutSessionId: 'cs_test_webhook',
      stripePaymentIntentId: 'pi_test_webhook',
      stripePaymentStatus: 'paid',
    });
    expect(completedGiving?.completedAt.toMillis()).toBe(checkoutCompletedAt * 1000);
    expect((await adminDb.doc(`taxReceipts/${givingId}`).get()).data()).toMatchObject({
      churchId: CHURCH_ID,
      userId: 'member-1',
      givingId,
      status: 'sent',
      receiptNumber: expectedReceiptNumber(2025, 1),
      receiptYear: 2025,
      receivedDateLabel: 'December 31, 2025',
      amountCents: 5000,
      eligibleAmountCents: 5000,
    });

    await adminDb.doc(`giving/${givingId}`).update({
      anonymous: true,
      donorName: 'Anonymous donor',
      donorEmail: '',
      donorNamePublicSafe: false,
      churchReceiptVisible: false,
    });

    await Promise.all([
      adminDb.doc('taxReceipts/annual-refund-webhook').set({
        churchId: CHURCH_ID,
        churchName: 'St. Nicholas',
        userId: 'member-1',
        givingId: '',
        givingIds: [givingId],
        kind: 'annual',
        status: 'sent',
        jurisdiction: 'US',
        receiptNumber: 'STN-000002',
        receiptYear: CLOSED_ANNUAL_YEAR,
        annualYear: CLOSED_ANNUAL_YEAR,
        organizationName: 'St. Nicholas Orthodox Church',
        organizationAddress: '123 Church Street, Chicago, IL',
        organizationTaxId: '12-3456789',
        donorLabel: 'Member One',
        donorAnonymous: false,
        donorName: 'Member One',
        donorEmail: 'member@example.com',
        amountCents: 5000,
        eligibleAmountCents: 5000,
        currency: 'USD',
        purpose: 'Annual giving summary',
        donationCount: 1,
        receivedDateLabel: `January 1 - December 31, ${CLOSED_ANNUAL_YEAR}`,
        coveredPeriodLabel: `January 1 - December 31, ${CLOSED_ANNUAL_YEAR}`,
        issuedAt: Timestamp.fromDate(new Date(`${CLOSED_ANNUAL_YEAR + 1}-01-15T12:00:00Z`)),
        issuedDateLabel: `January 15, ${CLOSED_ANNUAL_YEAR + 1}`,
        goodsServicesStatement:
          'No goods or services were provided in exchange for this contribution other than intangible religious benefits.',
        emailSentAt: Timestamp.fromDate(new Date(`${CLOSED_ANNUAL_YEAR + 1}-01-15T12:05:00Z`)),
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }),
      adminDb.doc('taxReceiptSummaries/annual-refund-webhook').set({
        receiptId: 'annual-refund-webhook',
        churchId: CHURCH_ID,
        userId: 'member-1',
        kind: 'annual',
        status: 'sent',
        receiptNumber: 'STN-000002',
        receiptYear: CLOSED_ANNUAL_YEAR,
        annualYear: CLOSED_ANNUAL_YEAR,
        donorLabel: 'Member One',
        donorAnonymous: false,
        churchReceiptVisible: true,
        donorLabelPublicSafe: true,
        receiptManagerSummarySafe: true,
        receiptManagerSummarySafeVersion: 2,
        amountCents: 5000,
        eligibleAmountCents: 5000,
        currency: 'USD',
        donationCount: 1,
        issuedAt: Timestamp.fromDate(new Date(`${CLOSED_ANNUAL_YEAR + 1}-01-15T12:00:00Z`)),
        emailSentAt: Timestamp.fromDate(new Date(`${CLOSED_ANNUAL_YEAR + 1}-01-15T12:05:00Z`)),
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }),
    ]);

    const refundEvent = {
      id: 'evt_charge_refunded',
      type: 'charge.refunded',
      livemode: false,
      created: Math.floor(new Date('2026-05-25T16:00:00Z').getTime() / 1000),
      data: {
        object: {
          id: 'ch_test_refund',
          payment_intent: 'pi_test_webhook',
          amount: 5000,
          amount_refunded: 5000,
          refunded: true,
          currency: 'usd',
        },
      },
    };

    await expect(
      postFunction('stripeWebhook', refundEvent, { 'stripe-signature': 'sig_test' })
    ).resolves.toMatchObject({
      status: 200,
      body: { received: true },
    });

    const refundedGiving = await waitFor(
      async () => (await adminDb.doc(`giving/${givingId}`).get()).data(),
      (data) => data?.status === 'refunded' && data.taxReceiptStatus === 'voided',
      'refunded giving receipt void'
    );
    expect(refundedGiving).toMatchObject({
      status: 'refunded',
      stripeRefundStatus: 'refunded',
      stripeAmountRefundedCents: 5000,
      taxReceiptStatus: 'voided',
      taxReceiptVoidReason: 'stripe_full_refund',
    });
    expect(refundedGiving).not.toHaveProperty('stripeRefundedChargeId');
    expect(refundedGiving).not.toHaveProperty('stripePaymentIntentId');
    expect((await adminDb.doc(`givingPaymentMetadata/${givingId}`).get()).data()).toMatchObject({
      stripeCheckoutSessionId: 'cs_test_webhook',
      stripePaymentIntentId: 'pi_test_webhook',
      stripeRefundedChargeId: 'ch_test_refund',
      stripeAmountRefundedCents: 5000,
      stripeRefundStatus: 'refunded',
    });

    const [voidedReceipt, voidedAnnualReceipt, voidedAnnualSummary, refundWebhookEvent] = await Promise.all([
      adminDb.doc(`taxReceipts/${givingId}`).get(),
      adminDb.doc('taxReceipts/annual-refund-webhook').get(),
      adminDb.doc('taxReceiptSummaries/annual-refund-webhook').get(),
      adminDb.doc('stripeWebhookEvents/evt_charge_refunded').get(),
    ]);
    expect(voidedReceipt.data()).toMatchObject({
      status: 'voided',
      voidReason: 'stripe_full_refund',
      voidedBy: 'stripe',
    });
    expect(voidedAnnualReceipt.data()).toMatchObject({
      status: 'voided',
      voidReason: 'stripe_full_refund',
      voidedBy: 'stripe',
    });
    expect(voidedAnnualSummary.data()).toMatchObject({
      status: 'voided',
      voidReason: 'stripe_full_refund',
      donorLabel: 'Anonymous donor',
      donorAnonymous: true,
      churchReceiptVisible: false,
      donorLabelPublicSafe: false,
      receiptManagerSummarySafe: false,
      receiptManagerSummarySafeVersion: 0,
    });
    expect(voidedAnnualSummary.data()).not.toHaveProperty('donorEmail');
    expect(voidedAnnualSummary.data()).not.toHaveProperty('organizationTaxId');
    expect(voidedAnnualSummary.data()).not.toHaveProperty('pdfStoragePath');
    expect(refundWebhookEvent.data()).toMatchObject({
      type: 'charge.refunded',
      livemode: false,
      stripeChargeId: 'ch_test_refund',
      stripePaymentIntentId: 'pi_test_webhook',
      givingId,
      status: 'processed',
      refundStatus: 'refunded',
      amountRefundedCents: 5000,
    });

    await expectCallableFails(
      callCallable(
        'sendTaxReceipt',
        { givingId },
        { uid: 'member-1', email: 'member@example.com' }
      ),
      'failed-precondition'
    );

    const voidEvents = await adminDb
      .collection('taxReceiptEvents')
      .where('action', '==', 'voided')
      .get();
    const voidEventData = voidEvents.docs.map((doc) => doc.data());
    expect(voidEventData).toEqual(expect.arrayContaining([
      expect.objectContaining({
        actorUid: 'stripe',
        receiptId: givingId,
        churchId: CHURCH_ID,
        userId: 'member-1',
        givingId,
        kind: 'single',
        reasonCode: 'stripe_full_refund',
      }),
      expect.objectContaining({
        actorUid: 'stripe',
        receiptId: 'annual-refund-webhook',
        churchId: CHURCH_ID,
        userId: 'member-1',
        kind: 'annual',
        reasonCode: 'stripe_full_refund',
      }),
    ]));
    for (const event of voidEventData) {
      expect(event).not.toHaveProperty('donorEmail');
      expect(event).not.toHaveProperty('donorName');
      expect(event).not.toHaveProperty('donorAddress');
      expect(event).not.toHaveProperty('organizationTaxId');
      expect(event).not.toHaveProperty('organizationAddress');
    }

    await Promise.all([
      adminDb.doc('giving/giving-webhook-partial-refund').set({
        churchId: CHURCH_ID,
        churchName: 'St. Nicholas',
        userId: 'member-1',
        anonymous: true,
        donorName: 'Anonymous donor',
        donorEmail: '',
        donorNamePublicSafe: false,
        churchReceiptVisible: false,
        amount: 50,
        amountCents: 5000,
        currency: 'USD',
        purpose: 'General Fund',
        status: 'completed',
        stripePaymentIntentId: 'pi_test_partial_refund',
        taxReceiptId: 'giving-webhook-partial-refund',
        taxReceiptNumber: 'STN-000003',
        taxReceiptStatus: 'sent',
        completedAt: Timestamp.fromDate(new Date('2026-05-24T16:00:00Z')),
        receiptEmailSentAt: Timestamp.fromDate(new Date('2026-05-24T16:01:00Z')),
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }),
      adminDb.doc('taxReceipts/giving-webhook-partial-refund').set({
        churchId: CHURCH_ID,
        churchName: 'St. Nicholas',
        userId: 'member-1',
        givingId: 'giving-webhook-partial-refund',
        kind: 'single',
        status: 'sent',
        jurisdiction: 'US',
        receiptNumber: 'STN-000003',
        receiptYear: 2026,
        organizationName: 'St. Nicholas Orthodox Church',
        organizationAddress: '123 Church Street, Chicago, IL',
        organizationTaxId: '12-3456789',
        donorName: 'Member One',
        donorEmail: 'member@example.com',
        amountCents: 5000,
        eligibleAmountCents: 5000,
        currency: 'USD',
        purpose: 'General Fund',
        receivedDateLabel: 'May 24, 2026',
        issuedDateLabel: 'May 24, 2026',
        goodsServicesStatement:
          'No goods or services were provided in exchange for this contribution other than intangible religious benefits.',
        emailSentAt: Timestamp.fromDate(new Date('2026-05-24T16:01:00Z')),
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }),
      adminDb.doc('taxReceipts/annual-partial-refund-webhook').set({
        churchId: CHURCH_ID,
        churchName: 'St. Nicholas',
        userId: 'member-1',
        givingId: '',
        givingIds: ['giving-webhook-partial-refund'],
        kind: 'annual',
        status: 'sent',
        jurisdiction: 'US',
        receiptNumber: 'STN-000004',
        receiptYear: CLOSED_ANNUAL_YEAR,
        annualYear: CLOSED_ANNUAL_YEAR,
        organizationName: 'St. Nicholas Orthodox Church',
        organizationAddress: '123 Church Street, Chicago, IL',
        organizationTaxId: '12-3456789',
        donorLabel: 'Member One',
        donorAnonymous: false,
        donorName: 'Member One',
        donorEmail: 'member@example.com',
        amountCents: 5000,
        eligibleAmountCents: 5000,
        currency: 'USD',
        purpose: 'Annual giving summary',
        donationCount: 1,
        receivedDateLabel: `January 1 - December 31, ${CLOSED_ANNUAL_YEAR}`,
        coveredPeriodLabel: `January 1 - December 31, ${CLOSED_ANNUAL_YEAR}`,
        issuedAt: Timestamp.fromDate(new Date(`${CLOSED_ANNUAL_YEAR + 1}-01-15T12:00:00Z`)),
        issuedDateLabel: `January 15, ${CLOSED_ANNUAL_YEAR + 1}`,
        goodsServicesStatement:
          'No goods or services were provided in exchange for this contribution other than intangible religious benefits.',
        emailSentAt: Timestamp.fromDate(new Date(`${CLOSED_ANNUAL_YEAR + 1}-01-15T12:05:00Z`)),
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }),
      adminDb.doc('taxReceiptSummaries/annual-partial-refund-webhook').set({
        receiptId: 'annual-partial-refund-webhook',
        churchId: CHURCH_ID,
        userId: 'member-1',
        kind: 'annual',
        status: 'sent',
        receiptNumber: 'STN-000004',
        receiptYear: CLOSED_ANNUAL_YEAR,
        annualYear: CLOSED_ANNUAL_YEAR,
        donorLabel: 'Member One',
        donorAnonymous: false,
        churchReceiptVisible: true,
        donorLabelPublicSafe: true,
        receiptManagerSummarySafe: true,
        receiptManagerSummarySafeVersion: 2,
        amountCents: 5000,
        eligibleAmountCents: 5000,
        currency: 'USD',
        donationCount: 1,
        issuedAt: Timestamp.fromDate(new Date(`${CLOSED_ANNUAL_YEAR + 1}-01-15T12:00:00Z`)),
        emailSentAt: Timestamp.fromDate(new Date(`${CLOSED_ANNUAL_YEAR + 1}-01-15T12:05:00Z`)),
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }),
    ]);

    const partialRefundEvent = {
      id: 'evt_charge_partially_refunded',
      type: 'charge.refunded',
      livemode: false,
      created: Math.floor(new Date('2026-05-25T17:00:00Z').getTime() / 1000),
      data: {
        object: {
          id: 'ch_test_partial_refund',
          payment_intent: 'pi_test_partial_refund',
          amount: 5000,
          amount_refunded: 1000,
          refunded: false,
          currency: 'usd',
        },
      },
    };

    await expect(
      postFunction('stripeWebhook', partialRefundEvent, { 'stripe-signature': 'sig_test' })
    ).resolves.toMatchObject({
      status: 200,
      body: { received: true },
    });

    const [
      partialGiving,
      partialReceipt,
      partialAnnualReceipt,
      partialAnnualSummary,
      partialWebhookEvent,
    ] = await Promise.all([
      adminDb.doc('giving/giving-webhook-partial-refund').get(),
      adminDb.doc('taxReceipts/giving-webhook-partial-refund').get(),
      adminDb.doc('taxReceipts/annual-partial-refund-webhook').get(),
      adminDb.doc('taxReceiptSummaries/annual-partial-refund-webhook').get(),
      adminDb.doc('stripeWebhookEvents/evt_charge_partially_refunded').get(),
    ]);
    expect(partialGiving.data()).toMatchObject({
      status: 'completed',
      stripeRefundStatus: 'partially_refunded',
      stripeAmountRefundedCents: 1000,
      taxReceiptStatus: 'error',
      taxReceiptError: 'stripe_partial_refund_review_required',
      taxReceiptCorrectionRequired: true,
      taxReceiptCorrectionReason: 'stripe_partial_refund_review_required',
    });
    expect(partialGiving.data()).not.toHaveProperty('stripePaymentIntentId');
    expect(partialGiving.data()).not.toHaveProperty('stripeRefundedChargeId');
    expect((await adminDb.doc('givingPaymentMetadata/giving-webhook-partial-refund').get()).data()).toMatchObject({
      stripePaymentIntentId: 'pi_test_partial_refund',
      stripeRefundedChargeId: 'ch_test_partial_refund',
      stripeAmountRefundedCents: 1000,
      stripeRefundStatus: 'partially_refunded',
    });
    for (const receiptSnap of [partialReceipt, partialAnnualReceipt, partialAnnualSummary]) {
      expect(receiptSnap.data()).toMatchObject({
        status: 'error',
        correctionRequired: true,
        correctionReason: 'stripe_partial_refund_review_required',
      });
    }
    expect(partialAnnualSummary.data()).toMatchObject({
      donorLabel: 'Anonymous donor',
      donorAnonymous: true,
      churchReceiptVisible: false,
      donorLabelPublicSafe: false,
      receiptManagerSummarySafe: false,
      receiptManagerSummarySafeVersion: 0,
    });
    expect(partialAnnualSummary.data()).not.toHaveProperty('donorEmail');
    expect(partialAnnualSummary.data()).not.toHaveProperty('organizationTaxId');
    expect(partialAnnualSummary.data()).not.toHaveProperty('pdfStoragePath');
    expect(partialWebhookEvent.data()).toMatchObject({
      type: 'charge.refunded',
      livemode: false,
      stripeChargeId: 'ch_test_partial_refund',
      stripePaymentIntentId: 'pi_test_partial_refund',
      givingId: 'giving-webhook-partial-refund',
      status: 'processed',
      refundStatus: 'partially_refunded',
      amountRefundedCents: 1000,
    });

    await expectCallableFails(
      callCallable(
        'sendTaxReceipt',
        { givingId: 'giving-webhook-partial-refund' },
        { uid: 'member-1', email: 'member@example.com' }
      ),
      'failed-precondition'
    );

    const reviewEvents = await adminDb
      .collection('taxReceiptEvents')
      .where('action', '==', 'review_required')
      .get();
    const reviewEventData = reviewEvents.docs.map((doc) => doc.data());
    expect(reviewEventData).toEqual(expect.arrayContaining([
      expect.objectContaining({
        actorUid: 'stripe',
        receiptId: 'giving-webhook-partial-refund',
        churchId: CHURCH_ID,
        userId: 'member-1',
        givingId: 'giving-webhook-partial-refund',
        kind: 'single',
        reasonCode: 'stripe_partial_refund_review_required',
      }),
      expect.objectContaining({
        actorUid: 'stripe',
        receiptId: 'annual-partial-refund-webhook',
        churchId: CHURCH_ID,
        userId: 'member-1',
        kind: 'annual',
        reasonCode: 'stripe_partial_refund_review_required',
      }),
    ]));
    for (const event of reviewEventData) {
      expect(event).not.toHaveProperty('donorEmail');
      expect(event).not.toHaveProperty('donorName');
      expect(event).not.toHaveProperty('donorAddress');
      expect(event).not.toHaveProperty('organizationTaxId');
      expect(event).not.toHaveProperty('organizationAddress');
    }

    const processedEvent = await adminDb.doc('stripeWebhookEvents/evt_checkout_completed').get();
    expect(processedEvent.data()).toMatchObject({
      type: 'checkout.session.completed',
      livemode: false,
      stripeSessionId: 'cs_test_webhook',
      givingId,
      status: 'processed',
    });

    await adminDb.doc('giving/giving-webhook-invalid').set({
      churchId: CHURCH_ID,
      churchName: 'St. Nicholas',
      userId: 'member-1',
      amount: 50,
      amountCents: 5000,
      currency: 'USD',
      purpose: 'General Fund',
      status: 'pending',
      stripeCheckoutSessionId: 'cs_test_invalid',
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    const invalidEvent = {
      id: 'evt_checkout_invalid',
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_test_invalid',
          payment_status: 'paid',
          amount_total: 4999,
          currency: 'usd',
          metadata: {
            givingId: 'giving-webhook-invalid',
            churchId: CHURCH_ID,
            userId: 'member-1',
            amountCents: '5000',
            currency: 'usd',
          },
        },
      },
    };

    await expect(
      postFunction('stripeWebhook', invalidEvent, { 'stripe-signature': 'sig_test' })
    ).resolves.toMatchObject({
      status: 200,
      body: { received: true },
    });

    const [invalidGiving, invalidWebhookEvent] = await Promise.all([
      adminDb.doc('giving/giving-webhook-invalid').get(),
      adminDb.doc('stripeWebhookEvents/evt_checkout_invalid').get(),
    ]);
    expect(invalidGiving.data()?.status).toBe('pending');
    expect(invalidWebhookEvent.data()).toMatchObject({
      status: 'validation_failed',
      givingId: 'giving-webhook-invalid',
    });
  });

  it('recovers Checkout completion when Stripe session persistence was interrupted', async () => {
    const givingId = 'giving-checkout-session-update-lost';
    const completedAt = Math.floor(new Date('2026-02-01T18:30:00Z').getTime() / 1000);
    await adminDb.doc(`giving/${givingId}`).set({
      churchId: CHURCH_ID,
      churchName: 'St. Nicholas',
      userId: 'member-1',
      amount: 75,
      amountCents: 7500,
      currency: 'USD',
      purpose: 'Candles',
      status: 'failed',
      failureReason: 'Unable to create Stripe Checkout session.',
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    await expect(
      postFunction(
        'stripeWebhook',
        {
          id: 'evt_checkout_metadata_recovery',
          type: 'checkout.session.completed',
          livemode: false,
          created: completedAt,
          data: {
            object: {
              id: 'cs_test_metadata_recovery',
              payment_status: 'paid',
              payment_intent: 'pi_test_metadata_recovery',
              amount_total: 7500,
              currency: 'usd',
              metadata: {
                givingId,
                churchId: CHURCH_ID,
                userId: 'member-1',
                amountCents: '7500',
                currency: 'usd',
              },
            },
          },
        },
        { 'stripe-signature': 'sig_test' }
      )
    ).resolves.toMatchObject({
      status: 200,
      body: { received: true },
    });

    const recoveredGiving = await waitFor(
      async () => (await adminDb.doc(`giving/${givingId}`).get()).data(),
      (data) =>
        data?.status === 'completed'
        && Boolean(data.receiptEmailSentAt),
      'metadata-only checkout completion recovery'
    );
    expect(recoveredGiving).toMatchObject({
      status: 'completed',
      taxReceiptStatus: 'not_configured',
      taxReceiptError: 'church_tax_receipts_not_enabled',
    });
    expect(recoveredGiving).not.toHaveProperty('stripeCheckoutSessionId');
    expect(recoveredGiving).not.toHaveProperty('stripePaymentIntentId');
    expect(recoveredGiving).not.toHaveProperty('stripePaymentStatus');
    expect((await adminDb.doc(`givingPaymentMetadata/${givingId}`).get()).data()).toMatchObject({
      stripeCheckoutSessionId: 'cs_test_metadata_recovery',
      stripePaymentIntentId: 'pi_test_metadata_recovery',
      stripePaymentStatus: 'paid',
    });
    expect(recoveredGiving?.completedAt.toMillis()).toBe(completedAt * 1000);
    expect(recoveredGiving).not.toHaveProperty('failureReason');

    expect((await adminDb.doc('stripeWebhookEvents/evt_checkout_metadata_recovery').get()).data()).toMatchObject({
      type: 'checkout.session.completed',
      livemode: false,
      stripeSessionId: 'cs_test_metadata_recovery',
      givingId,
      status: 'processed',
    });
  });

  it('recovers tax receipt auto-issue when the donation receipt follow-up already completed first', async () => {
    const givingId = 'giving-auto-tax-recovery';
    await adminDb.doc(`churches/${CHURCH_ID}`).update({
      timezone: 'America/Chicago',
      taxReceiptSettings: {
        enabled: true,
        eligibilityConfirmed: true,
        jurisdiction: 'US',
        organizationName: 'St. Nicholas Orthodox Church',
        organizationAddress: '123 Church Street, Chicago, IL',
        taxId: '12-3456789',
        receiptPrefix: 'STN',
        goodsServicesStatement:
          'No goods or services were provided in exchange for this contribution other than intangible religious benefits.',
        autoIssue: true,
      },
    });
    await adminDb.doc(`giving/${givingId}`).set({
      churchId: CHURCH_ID,
      churchName: 'St. Nicholas',
      userId: 'member-1',
      donorName: 'Member One',
      donorEmail: '',
      amount: 42,
      amountCents: 4200,
      currency: 'USD',
      purpose: 'Candles',
      status: 'completed',
      completedAt: Timestamp.fromDate(new Date('2026-02-14T18:00:00Z')),
      receiptEmailSentAt: Timestamp.fromDate(new Date('2026-02-14T18:01:00Z')),
      receiptEmailDateLabel: 'February 14, 2026',
      receiptEmailAmountCents: 4200,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    await adminDb.doc(`giving/${givingId}`).update({
      recoveryProbeAt: FieldValue.serverTimestamp(),
    });

    const recoveredGiving = await waitFor(
      async () => (await adminDb.doc(`giving/${givingId}`).get()).data(),
      (data) => data?.taxReceiptStatus === 'sent',
      'recovered auto-issued tax receipt'
    );
    expect(recoveredGiving).toMatchObject({
      status: 'completed',
      receiptEmailDateLabel: 'February 14, 2026',
      receiptEmailAmountCents: 4200,
      taxReceiptId: givingId,
      taxReceiptStatus: 'sent',
    });
    expect((await adminDb.doc(`taxReceipts/${givingId}`).get()).data()).toMatchObject({
      churchId: CHURCH_ID,
      userId: 'member-1',
      givingId,
      status: 'sent',
      receiptNumber: expectedReceiptNumber(2026, 1),
      receiptYear: 2026,
      amountCents: 4200,
      eligibleAmountCents: 4200,
    });
  });

  it('preserves auto-issued receipt email errors for retry visibility', async () => {
    const givingId = 'giving-auto-email-error-preserved';
    await adminDb.doc(`churches/${CHURCH_ID}`).update({
      timezone: 'America/Chicago',
      taxReceiptSettings: {
        enabled: true,
        eligibilityConfirmed: true,
        jurisdiction: 'US',
        organizationName: 'St. Nicholas Orthodox Church',
        organizationAddress: '123 Church Street, Chicago, IL',
        taxId: '12-3456789',
        receiptPrefix: 'STN',
        goodsServicesStatement:
          'No goods or services were provided in exchange for this contribution other than intangible religious benefits.',
        autoIssue: true,
      },
    });
    await Promise.all([
      adminDb.doc(`giving/${givingId}`).set({
        churchId: CHURCH_ID,
        churchName: 'St. Nicholas',
        userId: 'member-1',
        donorName: 'Member One',
        donorEmail: '',
        amount: 10,
        amountCents: 1000,
        currency: 'USD',
        purpose: 'General Fund',
        status: 'completed',
        taxReceiptId: givingId,
        taxReceiptNumber: 'STN-2026-000099',
        taxReceiptStatus: 'issued',
        completedAt: Timestamp.fromDate(new Date('2026-05-24T16:00:00Z')),
        receiptEmailSentAt: Timestamp.fromDate(new Date('2026-05-24T16:01:00Z')),
        receiptEmailDateLabel: 'May 24, 2026',
        receiptEmailAmountCents: 1000,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }),
      adminDb.doc(`taxReceipts/${givingId}`).set({
        churchId: CHURCH_ID,
        churchName: 'St. Nicholas',
        userId: 'member-1',
        givingId,
        kind: 'single',
        status: 'issued',
        jurisdiction: 'US',
        receiptNumber: 'STN-2026-000099',
        receiptYear: 2026,
        organizationName: 'St. Nicholas Orthodox Church',
        organizationAddress: '123 Church Street, Chicago, IL',
        organizationTaxId: '12-3456789',
        donorName: 'Member One '.repeat(20),
        donorEmail: 'member@example.com',
        amountCents: 1000,
        eligibleAmountCents: 1000,
        currency: 'USD',
        purpose: 'General Fund',
        receivedDateLabel: 'May 24, 2026',
        issuedDateLabel: 'May 24, 2026',
        goodsServicesStatement:
          'No goods or services were provided in exchange for this contribution other than intangible religious benefits.',
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }),
    ]);

    await adminDb.doc(`giving/${givingId}`).update({
      autoEmailErrorProbeAt: FieldValue.serverTimestamp(),
    });

    const givingWithEmailError = await waitFor(
      async () => (await adminDb.doc(`giving/${givingId}`).get()).data(),
      (data) => data?.taxReceiptEmailError === 'tax_receipt_preparation_failed',
      'auto-issued tax receipt email error preservation'
    );
    expect(givingWithEmailError).toMatchObject({
      taxReceiptStatus: 'error',
      taxReceiptError: 'tax_receipt_preparation_failed',
      taxReceiptEmailError: 'tax_receipt_preparation_failed',
    });
    expect((await adminDb.doc(`taxReceipts/${givingId}`).get()).data()).toMatchObject({
      status: 'error',
      emailError: 'tax_receipt_preparation_failed',
    });
  });

  it('leaves auto-issued donations ready until the donor legal receipt profile is complete', async () => {
    const givingId = 'giving-auto-profile-required';
    await adminDb.doc(`churches/${CHURCH_ID}`).update({
      timezone: 'America/Chicago',
      taxReceiptSettings: {
        enabled: true,
        eligibilityConfirmed: true,
        jurisdiction: 'US',
        organizationName: 'St. Nicholas Orthodox Church',
        organizationAddress: '123 Church Street, Chicago, IL',
        taxId: '12-3456789',
        receiptPrefix: 'STN',
        goodsServicesStatement:
          'No goods or services were provided in exchange for this contribution other than intangible religious benefits.',
        autoIssue: true,
      },
    });
    await adminDb.doc('users/member-1').set({
      taxReceiptLegalName: '',
      taxReceiptAddress: {
        line1: '',
        line2: '',
        city: '',
        region: '',
        postalCode: '',
        country: '',
      },
    }, { merge: true });
    await adminDb.doc(`giving/${givingId}`).set({
      churchId: CHURCH_ID,
      churchName: 'St. Nicholas',
      userId: 'member-1',
      donorName: 'Member One',
      donorEmail: '',
      amount: 42,
      amountCents: 4200,
      currency: 'USD',
      purpose: 'Candles',
      status: 'completed',
      completedAt: Timestamp.fromDate(new Date('2026-02-14T18:00:00Z')),
      receiptEmailSentAt: Timestamp.fromDate(new Date('2026-02-14T18:01:00Z')),
      receiptEmailDateLabel: 'February 14, 2026',
      receiptEmailAmountCents: 4200,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    await adminDb.doc(`giving/${givingId}`).update({
      receiptProfileProbeAt: FieldValue.serverTimestamp(),
    });

    const readyGiving = await waitFor(
      async () => (await adminDb.doc(`giving/${givingId}`).get()).data(),
      (data) => data?.taxReceiptStatus === 'ready',
      'profile-required tax receipt follow-up'
    );
    expect(readyGiving).toMatchObject({
      status: 'completed',
      taxReceiptStatus: 'ready',
      taxReceiptError: 'tax_receipt_donor_profile_incomplete',
    });
    expect((await adminDb.doc(`taxReceipts/${givingId}`).get()).exists).toBe(false);
    expect((await adminDb.doc('taxReceiptCounters/church-1_2026').get()).exists).toBe(false);

    await expect(
      callCallable(
        'sendTaxReceipt',
        { givingId },
        { uid: 'member-1', email: 'member@example.com' }
      )
    ).rejects.toMatchObject({
      status: 'FAILED_PRECONDITION',
      body: {
        error: {
          details: {
            errorCode: 'tax_receipt_donor_profile_incomplete',
          },
        },
      },
    });

    await seedUserProfile('member-1', 'member@example.com', 'Member One', 'Member Legal Donor');
    await expect(
      callCallable(
        'sendTaxReceipt',
        { givingId },
        { uid: 'member-1', email: 'member@example.com' }
      )
    ).resolves.toMatchObject({
      success: true,
      receiptId: givingId,
      receiptNumber: expectedReceiptNumber(2026, 1),
      emailSent: true,
    });
    expect((await adminDb.doc(`taxReceipts/${givingId}`).get()).data()).toMatchObject({
      donorName: 'Member Legal Donor',
      donorAddress: '10 Donor Street, Chicago, IL 60601, US',
      status: 'sent',
    });
  });

  it('leaves auto-issued donations ready until the donor Auth email is verified', async () => {
    const userId = 'unverified-auto-receipt-donor';
    const givingId = 'giving-auto-verified-email-required';
    await adminAuth.createUser({
      uid: userId,
      email: 'unverified-auto-receipt-donor@example.com',
      emailVerified: false,
      password: PASSWORD,
      displayName: 'Unverified Auto Donor',
    });
    await Promise.all([
      seedUserProfile(userId, 'legacy-auto-profile@example.com', 'Unverified Auto Donor'),
      seedChurchMember(userId, 'legacy-auto-member@example.com', 'member'),
      adminDb.doc(`churches/${CHURCH_ID}`).update({
        timezone: 'America/Chicago',
        taxReceiptSettings: {
          enabled: true,
          eligibilityConfirmed: true,
          jurisdiction: 'US',
          organizationName: 'St. Nicholas Orthodox Church',
          organizationAddress: '123 Church Street, Chicago, IL',
          taxId: '12-3456789',
          receiptPrefix: 'STN',
          goodsServicesStatement:
            'No goods or services were provided in exchange for this contribution other than intangible religious benefits.',
          autoIssue: true,
        },
      }),
    ]);
    await adminDb.doc(`giving/${givingId}`).set({
      churchId: CHURCH_ID,
      churchName: 'St. Nicholas',
      userId,
      donorName: 'Unverified Auto Donor',
      donorEmail: '',
      amount: 42,
      amountCents: 4200,
      currency: 'USD',
      purpose: 'Candles',
      status: 'completed',
      completedAt: Timestamp.fromDate(new Date('2026-02-14T18:00:00Z')),
      receiptEmailSentAt: Timestamp.fromDate(new Date('2026-02-14T18:01:00Z')),
      receiptEmailDateLabel: 'February 14, 2026',
      receiptEmailAmountCents: 4200,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    await adminDb.doc(`giving/${givingId}`).update({
      verifiedEmailProbeAt: FieldValue.serverTimestamp(),
    });

    const readyGiving = await waitFor(
      async () => (await adminDb.doc(`giving/${givingId}`).get()).data(),
      (data) => data?.taxReceiptStatus === 'ready',
      'verified-email-required tax receipt follow-up'
    );
    expect(readyGiving).toMatchObject({
      status: 'completed',
      taxReceiptStatus: 'ready',
      taxReceiptError: 'tax_receipt_missing_email_or_amount',
      donorEmail: '',
    });
    expect(readyGiving).not.toHaveProperty('taxReceiptEmailError');
    expect((await adminDb.doc(`taxReceipts/${givingId}`).get()).exists).toBe(false);
    expect((await adminDb.doc('taxReceiptCounters/church-1_2026').get()).exists).toBe(false);

    await adminAuth.updateUser(userId, { emailVerified: true });
    await expect(
      callCallable(
        'sendTaxReceipt',
        { givingId },
        { uid: userId, email: 'unverified-auto-receipt-donor@example.com' }
      )
    ).resolves.toMatchObject({
      success: true,
      receiptId: givingId,
      receiptNumber: expectedReceiptNumber(2026, 1),
      emailSent: true,
    });
    expect((await adminDb.doc(`taxReceipts/${givingId}`).get()).data()).toMatchObject({
      donorName: 'Unverified Auto Donor',
      donorEmail: 'unverified-auto-receipt-donor@example.com',
      donorAddress: '10 Donor Street, Chicago, IL 60601, US',
      status: 'sent',
    });
    const sentGiving = (await adminDb.doc(`giving/${givingId}`).get()).data();
    expect(sentGiving).toMatchObject({
      donorEmail: '',
      taxReceiptStatus: 'sent',
      taxReceiptId: givingId,
    });
    expect(sentGiving).not.toHaveProperty('taxReceiptError');
    expect(sentGiving).not.toHaveProperty('taxReceiptEmailError');
  });

  it('persists a safe setup-required code when auto tax receipt setup is incomplete', async () => {
    const givingId = 'giving-auto-setup-required';
    await seedUserProfile('member-1', 'member@example.com', 'Member One', 'Member Legal Donor');
    await adminDb.doc(`churches/${CHURCH_ID}`).update({
      timezone: 'America/Chicago',
      taxReceiptSettings: {
        enabled: true,
        eligibilityConfirmed: true,
        jurisdiction: 'US',
        organizationName: 'St. Nicholas Orthodox Church',
        organizationAddress: '',
        taxId: '',
        receiptPrefix: 'STN',
        goodsServicesStatement:
          'No goods or services were provided in exchange for this contribution other than intangible religious benefits.',
        autoIssue: true,
      },
    });
    await adminDb.doc(`giving/${givingId}`).set({
      churchId: CHURCH_ID,
      churchName: 'St. Nicholas',
      userId: 'member-1',
      donorName: 'Member One',
      donorEmail: '',
      amount: 42,
      amountCents: 4200,
      currency: 'USD',
      purpose: 'Candles',
      status: 'completed',
      completedAt: Timestamp.fromDate(new Date('2026-02-14T18:00:00Z')),
      receiptEmailSentAt: Timestamp.fromDate(new Date('2026-02-14T18:01:00Z')),
      receiptEmailDateLabel: 'February 14, 2026',
      receiptEmailAmountCents: 4200,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    await adminDb.doc(`giving/${givingId}`).update({
      setupRequiredProbeAt: FieldValue.serverTimestamp(),
    });

    const setupRequiredGiving = await waitFor(
      async () => (await adminDb.doc(`giving/${givingId}`).get()).data(),
      (data) => data?.taxReceiptStatus === 'not_configured',
      'setup-required tax receipt follow-up'
    );
    expect(setupRequiredGiving).toMatchObject({
      status: 'completed',
      taxReceiptStatus: 'not_configured',
      taxReceiptError: 'tax_receipt_setup_required',
    });
    expect(JSON.stringify(setupRequiredGiving)).not.toContain('legal receipt address');
    expect(JSON.stringify(setupRequiredGiving)).not.toContain('tax ID');
    expect((await adminDb.doc(`taxReceipts/${givingId}`).get()).exists).toBe(false);
  });

  it('persists donor-profile-required state after manual receipt send attempts', async () => {
    const givingId = 'giving-manual-profile-required';
    await adminDb.doc(`churches/${CHURCH_ID}`).update({
      timezone: 'America/Chicago',
      taxReceiptSettings: {
        enabled: true,
        eligibilityConfirmed: true,
        jurisdiction: 'US',
        organizationName: 'St. Nicholas Orthodox Church',
        organizationAddress: '123 Church Street, Chicago, IL',
        taxId: '12-3456789',
        receiptPrefix: 'STN',
        goodsServicesStatement:
          'No goods or services were provided in exchange for this contribution other than intangible religious benefits.',
        autoIssue: false,
      },
    });
    await adminDb.doc('users/member-1').set({
      taxReceiptLegalName: '',
      taxReceiptAddress: {
        line1: '',
        line2: '',
        city: '',
        region: '',
        postalCode: '',
        country: '',
      },
    }, { merge: true });
    await adminDb.doc(`giving/${givingId}`).set({
      churchId: CHURCH_ID,
      churchName: 'St. Nicholas',
      userId: 'member-1',
      donorName: 'Manual Profile Donor',
      donorEmail: '',
      anonymous: false,
      churchReceiptVisible: true,
      donorNamePublicSafe: true,
      receiptManagerGivingSafeVersion: 1,
      amount: 42,
      amountCents: 4200,
      currency: 'USD',
      purpose: 'Candles',
      status: 'completed',
      taxReceiptStatus: 'ready',
      completedAt: Timestamp.fromDate(new Date('2026-02-14T18:00:00Z')),
      receiptEmailSentAt: Timestamp.fromDate(new Date('2026-02-14T18:01:00Z')),
      receiptEmailDateLabel: 'February 14, 2026',
      receiptEmailAmountCents: 4200,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    await expect(
      callCallable(
        'sendTaxReceipt',
        { givingId },
        { uid: 'priest-1', email: 'priest@example.com' }
      )
    ).rejects.toMatchObject({
      status: 'FAILED_PRECONDITION',
      body: {
        error: {
          details: {
            errorCode: 'tax_receipt_donor_profile_incomplete',
          },
        },
      },
    });

    const blockedGiving = (await adminDb.doc(`giving/${givingId}`).get()).data();
    expect(blockedGiving).toMatchObject({
      taxReceiptStatus: 'ready',
      taxReceiptError: 'tax_receipt_donor_profile_incomplete',
      donorEmail: '',
    });
    expect(blockedGiving).not.toHaveProperty('taxReceiptEmailError');
    expect((await adminDb.doc(`taxReceipts/${givingId}`).get()).exists).toBe(false);
    expect((await adminDb.doc('taxReceiptCounters/church-1_2026').get()).exists).toBe(false);

    await seedUserProfile('member-1', 'member@example.com', 'Member One', 'Member Legal Donor');
    await expect(
      callCallable(
        'sendTaxReceipt',
        { givingId },
        { uid: 'priest-1', email: 'priest@example.com' }
      )
    ).resolves.toMatchObject({
      success: true,
      receiptId: '',
      receiptNumber: expectedReceiptNumber(2026, 1),
      emailSent: true,
    });
    const sentGiving = (await adminDb.doc(`giving/${givingId}`).get()).data();
    expect(sentGiving).toMatchObject({
      taxReceiptStatus: 'sent',
      taxReceiptId: givingId,
      donorEmail: '',
    });
    expect(sentGiving).not.toHaveProperty('taxReceiptError');
    expect(sentGiving).not.toHaveProperty('taxReceiptEmailError');
    expect((await adminDb.doc(`taxReceipts/${givingId}`).get()).data()).toMatchObject({
      donorName: 'Member Legal Donor',
      donorAddress: '10 Donor Street, Chicago, IL 60601, US',
      status: 'sent',
    });
  });

  it('persists staff-safe annual donor-profile-required summaries after annual send attempts', async () => {
    const givingId = 'annual-profile-required-giving';
    const annualReceiptId = annualTaxReceiptDocId(CHURCH_ID, 'member-1', CLOSED_ANNUAL_YEAR);
    await adminDb.doc(`churches/${CHURCH_ID}`).update({
      timezone: 'America/Chicago',
      taxReceiptSettings: {
        enabled: true,
        eligibilityConfirmed: true,
        jurisdiction: 'US',
        organizationName: 'St. Nicholas Orthodox Church',
        organizationAddress: '123 Church Street, Chicago, IL',
        taxId: '12-3456789',
        receiptPrefix: 'STN',
        goodsServicesStatement:
          'No goods or services were provided in exchange for this contribution other than intangible religious benefits.',
        autoIssue: false,
      },
    });
    await adminDb.doc('users/member-1').set({
      taxReceiptLegalName: '',
      taxReceiptAddress: {
        line1: '',
        line2: '',
        city: '',
        region: '',
        postalCode: '',
        country: '',
      },
    }, { merge: true });
    await adminDb.doc(`giving/${givingId}`).set({
      churchId: CHURCH_ID,
      churchName: 'St. Nicholas',
      userId: 'member-1',
      donorName: 'Annual Profile Donor',
      donorEmail: '',
      anonymous: false,
      churchReceiptVisible: true,
      donorNamePublicSafe: true,
      receiptManagerGivingSafeVersion: 1,
      amount: 64,
      amountCents: 6400,
      currency: 'USD',
      purpose: 'General Fund',
      status: 'completed',
      taxReceiptStatus: 'ready',
      completedAt: Timestamp.fromDate(new Date(`${CLOSED_ANNUAL_YEAR}-03-14T18:00:00Z`)),
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    await expect(
      callCallable(
        'sendAnnualTaxReceipt',
        { churchId: CHURCH_ID, year: CLOSED_ANNUAL_YEAR, userId: 'member-1' },
        { uid: 'priest-1', email: 'priest@example.com' }
      )
    ).rejects.toMatchObject({
      status: 'FAILED_PRECONDITION',
      body: {
        error: {
          details: {
            errorCode: 'tax_receipt_donor_profile_incomplete',
          },
        },
      },
    });

    const [blockedSummarySnap, blockedReceiptSnap, blockedCounterSnap] = await Promise.all([
      adminDb.doc(`taxReceiptSummaries/${annualReceiptId}`).get(),
      adminDb.doc(`taxReceipts/${annualReceiptId}`).get(),
      adminDb.doc(`taxReceiptCounters/${CHURCH_ID}_${CLOSED_ANNUAL_YEAR}`).get(),
    ]);
    expect(blockedSummarySnap.data()).toMatchObject({
      receiptId: '',
      churchId: CHURCH_ID,
      userId: 'member-1',
      kind: 'annual',
      status: 'error',
      receiptYear: CLOSED_ANNUAL_YEAR,
      receiptNumber: '',
      amountCents: 6400,
      eligibleAmountCents: 6400,
      currency: 'USD',
      donationCount: 1,
      donorLabel: 'Annual Profile Donor',
      donorAnonymous: false,
      churchReceiptVisible: true,
      donorLabelPublicSafe: true,
      receiptManagerSummarySafe: true,
      receiptManagerSummarySafeVersion: 2,
      emailError: 'tax_receipt_donor_profile_incomplete',
      includesPreviouslyReceipted: false,
    });
    expect(blockedSummarySnap.data()).not.toHaveProperty('givingIds');
    expect(blockedSummarySnap.data()).not.toHaveProperty('donorEmail');
    expect(blockedSummarySnap.data()).not.toHaveProperty('donorName');
    expect(blockedSummarySnap.data()).not.toHaveProperty('donorAddress');
    expect(blockedReceiptSnap.exists).toBe(false);
    expect(blockedCounterSnap.exists).toBe(false);

    await seedUserProfile('member-1', 'member@example.com', 'Member One', 'Member Legal Donor');
    await expect(
      callCallable(
        'sendAnnualTaxReceipt',
        { churchId: CHURCH_ID, year: CLOSED_ANNUAL_YEAR, userId: 'member-1' },
        { uid: 'priest-1', email: 'priest@example.com' }
      )
    ).resolves.toMatchObject({
      success: true,
      receiptId: '',
      receiptNumber: expectedReceiptNumber(CLOSED_ANNUAL_YEAR, 1),
      emailSent: true,
    });
    const [sentReceiptSnap, sentSummarySnap] = await Promise.all([
      adminDb.doc(`taxReceipts/${annualReceiptId}`).get(),
      adminDb.doc(`taxReceiptSummaries/${annualReceiptId}`).get(),
    ]);
    expect(sentReceiptSnap.data()).toMatchObject({
      status: 'sent',
      donorName: 'Member Legal Donor',
      donorAddress: '10 Donor Street, Chicago, IL 60601, US',
      receiptNumber: expectedReceiptNumber(CLOSED_ANNUAL_YEAR, 1),
    });
    expect(sentSummarySnap.data()).toMatchObject({
      receiptId: annualReceiptId,
      status: 'sent',
      receiptNumber: expectedReceiptNumber(CLOSED_ANNUAL_YEAR, 1),
    });
    expect(sentSummarySnap.data()?.emailError).toBeUndefined();
  });

  it('persists staff-safe annual verified-email-required summaries after annual send attempts', async () => {
    const userId = 'unverified-annual-donor';
    const givingId = 'annual-verified-email-required-giving';
    const annualReceiptId = annualTaxReceiptDocId(CHURCH_ID, userId, CLOSED_ANNUAL_YEAR);
    await adminAuth.createUser({
      uid: userId,
      email: 'unverified-annual-donor@example.com',
      emailVerified: false,
      password: PASSWORD,
      displayName: 'Unverified Annual Donor',
    });
    await Promise.all([
      seedUserProfile(userId, 'legacy-annual-profile@example.com', 'Unverified Annual Donor'),
      seedChurchMember(userId, 'legacy-annual-member@example.com', 'member'),
      adminDb.doc(`churches/${CHURCH_ID}`).update({
        timezone: 'America/Chicago',
        taxReceiptSettings: {
          enabled: true,
          eligibilityConfirmed: true,
          jurisdiction: 'US',
          organizationName: 'St. Nicholas Orthodox Church',
          organizationAddress: '123 Church Street, Chicago, IL',
          taxId: '12-3456789',
          receiptPrefix: 'STN',
          goodsServicesStatement:
            'No goods or services were provided in exchange for this contribution other than intangible religious benefits.',
          autoIssue: false,
        },
      }),
    ]);
    await adminDb.doc(`giving/${givingId}`).set({
      churchId: CHURCH_ID,
      churchName: 'St. Nicholas',
      userId,
      donorName: 'Unverified Annual Donor',
      donorEmail: '',
      anonymous: false,
      churchReceiptVisible: true,
      donorNamePublicSafe: true,
      receiptManagerGivingSafeVersion: 1,
      amount: 64,
      amountCents: 6400,
      currency: 'USD',
      purpose: 'General Fund',
      status: 'completed',
      taxReceiptStatus: 'ready',
      completedAt: Timestamp.fromDate(new Date(`${CLOSED_ANNUAL_YEAR}-03-14T18:00:00Z`)),
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    await expect(
      callCallable(
        'sendAnnualTaxReceipt',
        { churchId: CHURCH_ID, year: CLOSED_ANNUAL_YEAR, userId },
        { uid: 'priest-1', email: 'priest@example.com' }
      )
    ).rejects.toMatchObject({
      status: 'FAILED_PRECONDITION',
      body: {
        error: {
          details: {
            errorCode: 'tax_receipt_missing_email_or_amount',
          },
        },
      },
    });

    const [blockedSummarySnap, blockedReceiptSnap, blockedCounterSnap] = await Promise.all([
      adminDb.doc(`taxReceiptSummaries/${annualReceiptId}`).get(),
      adminDb.doc(`taxReceipts/${annualReceiptId}`).get(),
      adminDb.doc(`taxReceiptCounters/${CHURCH_ID}_${CLOSED_ANNUAL_YEAR}`).get(),
    ]);
    expect(blockedSummarySnap.data()).toMatchObject({
      receiptId: '',
      churchId: CHURCH_ID,
      userId,
      kind: 'annual',
      status: 'error',
      receiptYear: CLOSED_ANNUAL_YEAR,
      receiptNumber: '',
      amountCents: 6400,
      eligibleAmountCents: 6400,
      currency: 'USD',
      donationCount: 1,
      donorLabel: 'Unverified Annual Donor',
      donorAnonymous: false,
      churchReceiptVisible: true,
      donorLabelPublicSafe: true,
      receiptManagerSummarySafe: true,
      receiptManagerSummarySafeVersion: 2,
      emailError: 'tax_receipt_missing_email_or_amount',
      includesPreviouslyReceipted: false,
    });
    expect(blockedSummarySnap.data()).not.toHaveProperty('givingIds');
    expect(blockedSummarySnap.data()).not.toHaveProperty('donorEmail');
    expect(blockedSummarySnap.data()).not.toHaveProperty('donorName');
    expect(blockedSummarySnap.data()).not.toHaveProperty('donorAddress');
    expect(blockedReceiptSnap.exists).toBe(false);
    expect(blockedCounterSnap.exists).toBe(false);

    await adminAuth.updateUser(userId, { emailVerified: true });
    await expect(
      callCallable(
        'sendAnnualTaxReceipt',
        { churchId: CHURCH_ID, year: CLOSED_ANNUAL_YEAR, userId },
        { uid: 'priest-1', email: 'priest@example.com' }
      )
    ).resolves.toMatchObject({
      success: true,
      receiptId: '',
      receiptNumber: expectedReceiptNumber(CLOSED_ANNUAL_YEAR, 1),
      emailSent: true,
    });
    const [sentReceiptSnap, sentSummarySnap] = await Promise.all([
      adminDb.doc(`taxReceipts/${annualReceiptId}`).get(),
      adminDb.doc(`taxReceiptSummaries/${annualReceiptId}`).get(),
    ]);
    expect(sentReceiptSnap.data()).toMatchObject({
      status: 'sent',
      donorName: 'Unverified Annual Donor',
      donorEmail: 'unverified-annual-donor@example.com',
      receiptNumber: expectedReceiptNumber(CLOSED_ANNUAL_YEAR, 1),
    });
    expect(sentSummarySnap.data()).toMatchObject({
      receiptId: annualReceiptId,
      status: 'sent',
      receiptNumber: expectedReceiptNumber(CLOSED_ANNUAL_YEAR, 1),
    });
    expect(sentSummarySnap.data()).not.toHaveProperty('emailError');
  });

  it('persists staff-safe corrected annual donor-profile-required summaries after corrected annual send attempts', async () => {
    const givingId = 'corrected-annual-profile-required-giving';
    const correctionDigestInput = `${givingId}:7200:1200`;
    const correctedAnnualReceiptId = correctedAnnualTaxReceiptDocId(
      CHURCH_ID,
      'member-1',
      CLOSED_ANNUAL_YEAR,
      correctionDigestInput
    );
    await adminDb.doc(`churches/${CHURCH_ID}`).update({
      timezone: 'America/Chicago',
      taxReceiptSettings: {
        enabled: true,
        eligibilityConfirmed: true,
        jurisdiction: 'US',
        organizationName: 'St. Nicholas Orthodox Church',
        organizationAddress: '123 Church Street, Chicago, IL',
        taxId: '12-3456789',
        receiptPrefix: 'STN',
        goodsServicesStatement:
          'No goods or services were provided in exchange for this contribution other than intangible religious benefits.',
        autoIssue: false,
      },
    });
    await adminDb.doc('users/member-1').set({
      taxReceiptLegalName: '',
      taxReceiptAddress: {
        line1: '',
        line2: '',
        city: '',
        region: '',
        postalCode: '',
        country: '',
      },
    }, { merge: true });
    await adminDb.doc(`giving/${givingId}`).set({
      churchId: CHURCH_ID,
      churchName: 'St. Nicholas',
      userId: 'member-1',
      donorName: 'Corrected Annual Profile Donor',
      donorEmail: '',
      anonymous: false,
      churchReceiptVisible: true,
      donorNamePublicSafe: true,
      receiptManagerGivingSafeVersion: 1,
      amount: 72,
      amountCents: 7200,
      currency: 'USD',
      purpose: 'Building Fund',
      status: 'completed',
      stripeRefundStatus: 'partially_refunded',
      stripeAmountRefundedCents: 1200,
      taxReceiptCorrectionRequired: true,
      taxReceiptCorrectionReason: 'stripe_partial_refund_review_required',
      taxReceiptStatus: 'error',
      taxReceiptError: 'stripe_partial_refund_review_required',
      completedAt: Timestamp.fromDate(new Date(`${CLOSED_ANNUAL_YEAR}-04-14T18:00:00Z`)),
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    await expect(
      callCallable(
        'sendCorrectedAnnualTaxReceipt',
        { churchId: CHURCH_ID, year: CLOSED_ANNUAL_YEAR, userId: 'member-1' },
        { uid: 'treasurer-1', email: 'treasurer@example.com' }
      )
    ).rejects.toMatchObject({
      status: 'FAILED_PRECONDITION',
      body: {
        error: {
          details: {
            errorCode: 'tax_receipt_donor_profile_incomplete',
          },
        },
      },
    });

    const [blockedSummarySnap, blockedReceiptSnap, blockedCounterSnap] = await Promise.all([
      adminDb.doc(`taxReceiptSummaries/${correctedAnnualReceiptId}`).get(),
      adminDb.doc(`taxReceipts/${correctedAnnualReceiptId}`).get(),
      adminDb.doc(`taxReceiptCounters/${CHURCH_ID}_${CLOSED_ANNUAL_YEAR}`).get(),
    ]);
    expect(blockedSummarySnap.data()).toMatchObject({
      receiptId: '',
      churchId: CHURCH_ID,
      userId: 'member-1',
      kind: 'annual',
      status: 'error',
      receiptYear: CLOSED_ANNUAL_YEAR,
      receiptNumber: '',
      amountCents: 6000,
      eligibleAmountCents: 6000,
      currency: 'USD',
      donationCount: 1,
      donorLabel: 'Corrected Annual Profile Donor',
      donorAnonymous: false,
      churchReceiptVisible: true,
      donorLabelPublicSafe: true,
      receiptManagerSummarySafe: true,
      receiptManagerSummarySafeVersion: 2,
      emailError: 'tax_receipt_donor_profile_incomplete',
      correctionRequired: true,
      correctionReason: 'stripe_partial_refund_review_required',
      includesPreviouslyReceipted: false,
    });
    expect(blockedSummarySnap.data()).not.toHaveProperty('givingIds');
    expect(blockedSummarySnap.data()).not.toHaveProperty('donorEmail');
    expect(blockedSummarySnap.data()).not.toHaveProperty('donorName');
    expect(blockedSummarySnap.data()).not.toHaveProperty('donorAddress');
    expect(blockedReceiptSnap.exists).toBe(false);
    expect(blockedCounterSnap.exists).toBe(false);

    await seedUserProfile('member-1', 'member@example.com', 'Member One', 'Member Legal Donor');
    await expect(
      callCallable(
        'sendCorrectedAnnualTaxReceipt',
        { churchId: CHURCH_ID, year: CLOSED_ANNUAL_YEAR, userId: 'member-1' },
        { uid: 'treasurer-1', email: 'treasurer@example.com' }
      )
    ).resolves.toMatchObject({
      success: true,
      receiptId: '',
      receiptNumber: expectedReceiptNumber(CLOSED_ANNUAL_YEAR, 1),
      corrected: true,
      emailSent: true,
    });
    const [sentReceiptSnap, sentSummarySnap] = await Promise.all([
      adminDb.doc(`taxReceipts/${correctedAnnualReceiptId}`).get(),
      adminDb.doc(`taxReceiptSummaries/${correctedAnnualReceiptId}`).get(),
    ]);
    expect(sentReceiptSnap.data()).toMatchObject({
      status: 'sent',
      donorName: 'Member Legal Donor',
      donorAddress: '10 Donor Street, Chicago, IL 60601, US',
      receiptNumber: expectedReceiptNumber(CLOSED_ANNUAL_YEAR, 1),
      amountCents: 6000,
      eligibleAmountCents: 6000,
      originalAmountCents: 7200,
      refundedAmountCents: 1200,
      correctionSourceReason: 'stripe_partial_refund_corrected_reissue',
    });
    expect(sentSummarySnap.data()).toMatchObject({
      receiptId: correctedAnnualReceiptId,
      status: 'sent',
      receiptNumber: expectedReceiptNumber(CLOSED_ANNUAL_YEAR, 1),
      correctedReceipt: true,
      correctionRequired: false,
      correctionReason: '',
    });
    expect(sentSummarySnap.data()).not.toHaveProperty('correctionForReceiptId');
    expect(sentSummarySnap.data()).not.toHaveProperty('correctionSourceReason');
    expect(sentSummarySnap.data()).not.toHaveProperty('correctedAt');
    expect(sentSummarySnap.data()).not.toHaveProperty('correctionMarkedAt');
    expect(sentSummarySnap.data()?.emailError).toBeUndefined();
  });

  it('marks Canadian completed donations not configured during tax receipt follow-up', async () => {
    const givingId = 'giving-auto-tax-canada-not-configured';
    await adminDb.doc(`churches/${CHURCH_ID}`).update({
      timezone: 'America/Edmonton',
      taxReceiptSettings: {
        enabled: true,
        eligibilityConfirmed: true,
        jurisdiction: 'CA',
        organizationName: 'St. Nicholas Orthodox Church',
        organizationAddress: '123 Church Street, Edmonton, AB',
        taxId: '123456789RR0001',
        receiptPrefix: 'STN',
        goodsServicesStatement: 'No advantage was received by the donor.',
        autoIssue: true,
        receiptIssueLocation: 'Edmonton, Alberta',
        authorizedSignerName: 'Fr. Nicholas',
        authorizedSignerTitle: 'Parish Priest',
        secureElectronicSignatureConfigured: true,
        receiptCopiesRetentionConfirmed: true,
      },
    });
    await adminDb.doc(`giving/${givingId}`).set({
      churchId: CHURCH_ID,
      churchName: 'St. Nicholas',
      userId: 'member-1',
      donorName: 'Member One',
      donorEmail: '',
      amount: 84,
      amountCents: 8400,
      currency: 'CAD',
      purpose: 'Building Fund',
      status: 'completed',
      completedAt: Timestamp.fromDate(new Date('2026-05-24T16:00:00Z')),
      receiptEmailSentAt: Timestamp.fromDate(new Date('2026-05-24T16:01:00Z')),
      receiptEmailDateLabel: 'May 24, 2026',
      receiptEmailAmountCents: 8400,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    await adminDb.doc(`giving/${givingId}`).update({
      canadaReceiptProbeAt: FieldValue.serverTimestamp(),
    });

    const recoveredGiving = await waitFor(
      async () => (await adminDb.doc(`giving/${givingId}`).get()).data(),
      (data) => data?.taxReceiptStatus === 'not_configured',
      'Canadian unsupported tax receipt follow-up'
    );
    expect(recoveredGiving).toMatchObject({
      status: 'completed',
      taxReceiptStatus: 'not_configured',
      taxReceiptError: 'tax_receipt_unsupported_jurisdiction',
      taxReceiptEmailError: 'tax_receipt_unsupported_jurisdiction',
    });
    expect((await adminDb.doc(`taxReceipts/${givingId}`).get()).exists).toBe(false);
  });

  it('marks Stripe-completed donations ready when tax receipts are configured for manual issuance', async () => {
    const givingId = 'giving-webhook-manual-ready';
    const checkoutCompletedAt = Math.floor(new Date('2026-02-14T18:00:00Z').getTime() / 1000);
    await adminDb.doc(`churches/${CHURCH_ID}`).update({
      timezone: 'America/Chicago',
      taxReceiptSettings: {
        enabled: true,
        eligibilityConfirmed: true,
        jurisdiction: 'US',
        organizationName: 'St. Nicholas Orthodox Church',
        organizationAddress: '123 Church Street, Chicago, IL',
        taxId: '12-3456789',
        receiptPrefix: 'STN',
        goodsServicesStatement:
          'No goods or services were provided in exchange for this contribution other than intangible religious benefits.',
        autoIssue: false,
      },
    });
    await adminDb.doc(`giving/${givingId}`).set({
      churchId: CHURCH_ID,
      churchName: 'St. Nicholas',
      userId: 'member-1',
      amount: 35,
      amountCents: 3500,
      currency: 'USD',
      purpose: 'Candles',
      status: 'pending',
      stripeCheckoutSessionId: 'cs_test_manual_ready',
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    await expect(
      postFunction('stripeWebhook', {
        id: 'evt_checkout_manual_ready',
        type: 'checkout.session.completed',
        created: checkoutCompletedAt,
        data: {
          object: {
            id: 'cs_test_manual_ready',
            payment_status: 'paid',
            payment_intent: 'pi_test_manual_ready',
            amount_total: 3500,
            currency: 'usd',
            metadata: {
              givingId,
              churchId: CHURCH_ID,
              userId: 'member-1',
              amountCents: '3500',
              currency: 'usd',
            },
          },
        },
      }, { 'stripe-signature': 'sig_test' })
    ).resolves.toMatchObject({
      status: 200,
      body: { received: true },
    });

    const completedGiving = await waitFor(
      async () => (await adminDb.doc(`giving/${givingId}`).get()).data(),
      (data) =>
        data?.status === 'completed'
        && Boolean(data.receiptEmailSentAt)
        && data.taxReceiptStatus === 'ready',
      'manual receipt-ready giving'
    );
    expect(completedGiving).toMatchObject({
      status: 'completed',
      taxReceiptStatus: 'ready',
    });
    expect(completedGiving).not.toHaveProperty('stripeCheckoutSessionId');
    expect(completedGiving).not.toHaveProperty('stripePaymentIntentId');
    expect((await adminDb.doc(`givingPaymentMetadata/${givingId}`).get()).data()).toMatchObject({
      stripeCheckoutSessionId: 'cs_test_manual_ready',
      stripePaymentIntentId: 'pi_test_manual_ready',
      stripePaymentStatus: 'paid',
    });
    expect(completedGiving).not.toHaveProperty('taxReceiptError');
    expect(completedGiving).not.toHaveProperty('taxReceiptEmailError');
    expect((await adminDb.doc(`taxReceipts/${givingId}`).get()).exists).toBe(false);

    await expect(
      callCallable(
        'sendTaxReceipt',
        { givingId },
        { uid: 'member-1', email: 'member@example.com' }
      )
    ).resolves.toMatchObject({
      success: true,
      receiptId: givingId,
      created: true,
      emailSent: true,
    });
    expect((await adminDb.doc(`giving/${givingId}`).get()).data()).toMatchObject({
      taxReceiptStatus: 'sent',
      taxReceiptId: givingId,
    });

    const inactiveGivingId = 'giving-manual-inactive-not-ready';
    await adminDb.doc(`churches/${CHURCH_ID}`).update({ isActive: false });
    await adminDb.doc(`giving/${inactiveGivingId}`).set({
      churchId: CHURCH_ID,
      churchName: 'St. Nicholas',
      userId: 'member-1',
      donorName: 'Member One',
      donorEmail: '',
      amount: 30,
      amountCents: 3000,
      currency: 'USD',
      purpose: 'Candles',
      status: 'completed',
      completedAt: Timestamp.fromDate(new Date('2026-02-15T18:00:00Z')),
      receiptEmailSentAt: Timestamp.fromDate(new Date('2026-02-15T18:01:00Z')),
      receiptEmailDateLabel: 'February 15, 2026',
      receiptEmailAmountCents: 3000,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    await adminDb.doc(`giving/${inactiveGivingId}`).update({
      inactiveProbeAt: FieldValue.serverTimestamp(),
    });

    const inactiveGiving = await waitFor(
      async () => (await adminDb.doc(`giving/${inactiveGivingId}`).get()).data(),
      (data) => data?.taxReceiptStatus === 'not_configured',
      'inactive church manual receipt status'
    );
    expect(inactiveGiving).toMatchObject({
      status: 'completed',
      taxReceiptStatus: 'not_configured',
      taxReceiptError: 'church_inactive',
    });
    expect(inactiveGiving).not.toHaveProperty('taxReceiptEmailError');
    expect((await adminDb.doc(`taxReceipts/${inactiveGivingId}`).get()).exists).toBe(false);
    await expectCallableFails(
      callCallable(
        'sendTaxReceipt',
        { givingId: inactiveGivingId },
        { uid: 'member-1', email: 'member@example.com' }
      ),
      'failed-precondition'
    );
  });

  it('keeps refunded donations refunded when Stripe events arrive out of order', async () => {
    const givingId = 'giving-refund-before-completion';
    await adminDb.doc(`giving/${givingId}`).set({
      churchId: CHURCH_ID,
      churchName: 'St. Nicholas',
      userId: 'member-1',
      amount: 50,
      amountCents: 5000,
      currency: 'USD',
      purpose: 'General Fund',
      status: 'pending',
      stripeCheckoutSessionId: 'cs_test_out_of_order',
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    const stripeMetadata = {
      givingId,
      churchId: CHURCH_ID,
      userId: 'member-1',
      amountCents: '5000',
      currency: 'usd',
    };
    const refundFirstEvent = {
      id: 'evt_refund_before_checkout_completion',
      type: 'charge.refunded',
      created: Math.floor(new Date('2026-06-01T16:00:00Z').getTime() / 1000),
      data: {
        object: {
          id: 'ch_test_out_of_order',
          payment_intent: 'pi_test_out_of_order',
          amount: 5000,
          amount_refunded: 5000,
          refunded: true,
          currency: 'usd',
          metadata: stripeMetadata,
        },
      },
    };

    await expect(
      postFunction('stripeWebhook', refundFirstEvent, { 'stripe-signature': 'sig_test' })
    ).resolves.toMatchObject({
      status: 200,
      body: { received: true },
    });

    const refundedGiving = await waitFor(
      async () => (await adminDb.doc(`giving/${givingId}`).get()).data(),
      (data) => data?.status === 'refunded' && data.stripeRefundStatus === 'refunded',
      'out-of-order refund'
    );
    expect(refundedGiving).toMatchObject({
      status: 'refunded',
      stripeRefundStatus: 'refunded',
      stripeAmountRefundedCents: 5000,
    });
    expect(refundedGiving).not.toHaveProperty('stripeCheckoutSessionId');
    expect(refundedGiving).not.toHaveProperty('stripePaymentIntentId');
    expect(refundedGiving).not.toHaveProperty('stripeRefundedChargeId');
    expect((await adminDb.doc(`givingPaymentMetadata/${givingId}`).get()).data()).toMatchObject({
      stripePaymentIntentId: 'pi_test_out_of_order',
      stripeRefundedChargeId: 'ch_test_out_of_order',
      stripeAmountRefundedCents: 5000,
      stripeRefundStatus: 'refunded',
    });

    const completedLaterEvent = {
      id: 'evt_checkout_completion_after_refund',
      type: 'checkout.session.completed',
      created: Math.floor(new Date('2026-06-01T15:59:30Z').getTime() / 1000),
      data: {
        object: {
          id: 'cs_test_out_of_order',
          payment_status: 'paid',
          payment_intent: 'pi_test_out_of_order',
          amount_total: 5000,
          currency: 'usd',
          metadata: stripeMetadata,
        },
      },
    };

    await expect(
      postFunction('stripeWebhook', completedLaterEvent, { 'stripe-signature': 'sig_test' })
    ).resolves.toMatchObject({
      status: 200,
      body: { received: true },
    });

    await waitFor(
      async () => (await adminDb.doc('stripeWebhookEvents/evt_checkout_completion_after_refund').get()).data(),
      (data) => data?.status === 'processed',
      'late checkout completion event'
    );
    const [finalGiving, receiptSnap] = await Promise.all([
      adminDb.doc(`giving/${givingId}`).get(),
      adminDb.doc(`taxReceipts/${givingId}`).get(),
    ]);
    expect(finalGiving.data()).toMatchObject({
      status: 'refunded',
      stripeRefundStatus: 'refunded',
    });
    expect(finalGiving.data()).not.toHaveProperty('stripePaymentIntentId');
    expect((await adminDb.doc(`givingPaymentMetadata/${givingId}`).get()).data()).toMatchObject({
      stripeCheckoutSessionId: 'cs_test_out_of_order',
      stripePaymentIntentId: 'pi_test_out_of_order',
      stripeRefundedChargeId: 'ch_test_out_of_order',
      stripeRefundStatus: 'refunded',
    });
    expect(finalGiving.data()).not.toHaveProperty('receiptEmailSentAt');
    expect(receiptSnap.exists).toBe(false);
  });

  it('ignores stale partial refund events after a full refund has voided receipts', async () => {
    const givingId = 'giving-stale-partial-after-full-refund';
    const annualReceiptId = annualTaxReceiptDocId(CHURCH_ID, 'member-stale-refund', 2026);
    const now = FieldValue.serverTimestamp();
    await Promise.all([
      adminDb.doc(`giving/${givingId}`).set({
        churchId: CHURCH_ID,
        churchName: 'St. Nicholas',
        userId: 'member-stale-refund',
        donorName: 'Member One',
        donorEmail: '',
        anonymous: false,
        amount: 50,
        amountCents: 5000,
        currency: 'USD',
        purpose: 'General Fund',
        status: 'completed',
        stripeCheckoutSessionId: 'cs_test_stale_refund',
        stripePaymentIntentId: 'pi_test_stale_refund',
        taxReceiptId: givingId,
        taxReceiptNumber: 'STN-2026-000777',
        taxReceiptStatus: 'sent',
        completedAt: Timestamp.fromDate(new Date('2026-05-24T16:00:00Z')),
        taxReceiptSentAt: Timestamp.fromDate(new Date('2026-05-24T16:05:00Z')),
        createdAt: now,
        updatedAt: now,
      }),
      adminDb.doc(`taxReceipts/${givingId}`).set({
        churchId: CHURCH_ID,
        churchName: 'St. Nicholas',
        userId: 'member-stale-refund',
        givingId,
        kind: 'single',
        status: 'sent',
        jurisdiction: 'US',
        receiptNumber: 'STN-2026-000777',
        receiptYear: 2026,
        organizationName: 'St. Nicholas Orthodox Church',
        donorName: 'Member One',
        donorEmail: 'member@example.com',
        amountCents: 5000,
        eligibleAmountCents: 5000,
        currency: 'USD',
        purpose: 'General Fund',
        receivedDateLabel: 'May 24, 2026',
        issuedDateLabel: 'May 24, 2026',
        goodsServicesStatement:
          'No goods or services were provided in exchange for this contribution other than intangible religious benefits.',
        emailSentAt: Timestamp.fromDate(new Date('2026-05-24T16:05:00Z')),
        createdAt: now,
        updatedAt: now,
      }),
      adminDb.doc(`taxReceipts/${annualReceiptId}`).set({
        churchId: CHURCH_ID,
        churchName: 'St. Nicholas',
        userId: 'member-stale-refund',
        givingIds: [givingId],
        kind: 'annual',
        status: 'sent',
        jurisdiction: 'US',
        receiptNumber: 'STN-2026-000778',
        receiptYear: 2026,
        annualYear: 2026,
        organizationName: 'St. Nicholas Orthodox Church',
        donorName: 'Member One',
        donorLabel: 'Member One',
        donorAnonymous: false,
        donorEmail: 'member@example.com',
        donationCount: 1,
        amountCents: 5000,
        eligibleAmountCents: 5000,
        currency: 'USD',
        coveredPeriodLabel: 'January 1, 2026 - December 31, 2026',
        contributionLines: [
          {
            givingId,
            receivedDateLabel: 'May 24, 2026',
            purpose: 'General Fund',
            amountCents: 5000,
            eligibleAmountCents: 5000,
          },
        ],
        issuedDateLabel: 'December 31, 2026',
        goodsServicesStatement:
          'No goods or services were provided in exchange for this contribution other than intangible religious benefits.',
        emailSentAt: Timestamp.fromDate(new Date('2026-12-31T16:05:00Z')),
        createdAt: now,
        updatedAt: now,
      }),
    ]);

    const stripeMetadata = {
      givingId,
      churchId: CHURCH_ID,
      userId: 'member-stale-refund',
      amountCents: '5000',
      currency: 'usd',
    };

    await expect(
      postFunction(
        'stripeWebhook',
        {
          id: 'evt_full_refund_before_stale_partial',
          type: 'charge.refunded',
          created: Math.floor(new Date('2026-06-01T16:00:00Z').getTime() / 1000),
          data: {
            object: {
              id: 'ch_test_stale_refund',
              payment_intent: 'pi_test_stale_refund',
              amount: 5000,
              amount_refunded: 5000,
              refunded: true,
              currency: 'usd',
              metadata: stripeMetadata,
            },
          },
        },
        { 'stripe-signature': 'sig_test' }
      )
    ).resolves.toMatchObject({
      status: 200,
      body: { received: true },
    });

    await waitFor(
      async () => (await adminDb.doc(`taxReceipts/${annualReceiptId}`).get()).data(),
      (data) => data?.status === 'voided',
      'full refund annual receipt void'
    );

    await expect(
      postFunction(
        'stripeWebhook',
        {
          id: 'evt_stale_partial_after_full_refund',
          type: 'charge.refunded',
          created: Math.floor(new Date('2026-06-01T15:59:00Z').getTime() / 1000),
          data: {
            object: {
              id: 'ch_test_stale_refund',
              payment_intent: 'pi_test_stale_refund',
              amount: 5000,
              amount_refunded: 1000,
              refunded: false,
              currency: 'usd',
              metadata: stripeMetadata,
            },
          },
        },
        { 'stripe-signature': 'sig_test' }
      )
    ).resolves.toMatchObject({
      status: 200,
      body: { received: true },
    });

    const [
      givingSnap,
      singleReceiptSnap,
      annualReceiptSnap,
      annualSummarySnap,
      staleEventSnap,
    ] = await Promise.all([
      adminDb.doc(`giving/${givingId}`).get(),
      adminDb.doc(`taxReceipts/${givingId}`).get(),
      adminDb.doc(`taxReceipts/${annualReceiptId}`).get(),
      adminDb.doc(`taxReceiptSummaries/${annualReceiptId}`).get(),
      adminDb.doc('stripeWebhookEvents/evt_stale_partial_after_full_refund').get(),
    ]);

    expect(givingSnap.data()).toMatchObject({
      status: 'refunded',
      stripeRefundStatus: 'refunded',
      stripeAmountRefundedCents: 5000,
      taxReceiptStatus: 'voided',
      taxReceiptVoidReason: 'stripe_full_refund',
    });
    expect(givingSnap.data()).not.toHaveProperty('stripeCheckoutSessionId');
    expect(givingSnap.data()).not.toHaveProperty('stripePaymentIntentId');
    expect(givingSnap.data()).not.toHaveProperty('stripeRefundedChargeId');
    expect(givingSnap.data()).not.toHaveProperty('taxReceiptCorrectionRequired');
    expect(givingSnap.data()).not.toHaveProperty('taxReceiptCorrectionReason');
    expect(givingSnap.data()).not.toHaveProperty('taxReceiptError');
    expect((await adminDb.doc(`givingPaymentMetadata/${givingId}`).get()).data()).toMatchObject({
      stripePaymentIntentId: 'pi_test_stale_refund',
      stripeRefundedChargeId: 'ch_test_stale_refund',
      stripeAmountRefundedCents: 5000,
      stripeRefundStatus: 'refunded',
    });
    expect(singleReceiptSnap.data()).toMatchObject({
      status: 'voided',
      voidReason: 'stripe_full_refund',
    });
    expect(singleReceiptSnap.data()).not.toHaveProperty('correctionRequired');
    expect(annualReceiptSnap.data()).toMatchObject({
      status: 'voided',
      voidReason: 'stripe_full_refund',
    });
    expect(annualReceiptSnap.data()).not.toHaveProperty('correctionRequired');
    expect(annualSummarySnap.data()).toMatchObject({
      status: 'voided',
      voidReason: 'stripe_full_refund',
    });
    expect(annualSummarySnap.data()).not.toHaveProperty('correctionRequired');
    expect(staleEventSnap.data()).toMatchObject({
      status: 'processed',
      refundStatus: 'stale_refund_ignored',
      amountRefundedCents: 1000,
      currentAmountRefundedCents: 5000,
    });
  });

  it('fans out manual notifications plus event and newsletter trigger records without external services', async () => {
    const notificationChurchLimitRef = adminDb.doc(rateLimitDocPath('sendPushNotificationByChurch', CHURCH_ID));

    await expectCallableFails(
      callCallable(
        'sendPushNotification',
        {
          churchId: CHURCH_ID,
          title: 'Member Attempt',
          body: 'Members cannot send parish-wide notifications.',
        },
        { uid: 'member-1', email: 'member@example.com' }
      ),
      'permission-denied'
    );
    expect((await notificationChurchLimitRef.get()).exists).toBe(false);

    await expect(
      callCallable(
        'sendPushNotification',
        {
          churchId: CHURCH_ID,
          title: 'Service Reminder',
          body: 'Vespers begins at 6 PM.',
          targetRoles: ['member', 'admin', 'treasurer'],
        },
        { uid: 'admin-1', email: 'admin@example.com' }
      )
    ).resolves.toEqual({ success: true });
    expect((await notificationChurchLimitRef.get()).data()?.count).toBe(1);

    await expectCallableFails(
      callCallable(
        'sendPushNotification',
        {
          churchId: CHURCH_ID,
          title: 'Member Attempt',
          body: 'Members cannot send parish-wide notifications.',
        },
        { uid: 'member-1', email: 'member@example.com' }
      ),
      'permission-denied'
    );
    expect((await notificationChurchLimitRef.get()).data()?.count).toBe(1);

    await adminDb.doc(`churches/${CHURCH_ID}`).update({ isActive: false });
    await expectCallableFails(
      callCallable(
        'sendPushNotification',
        {
          churchId: CHURCH_ID,
          title: 'Inactive Church Attempt',
          body: 'Inactive churches cannot send parish-wide notifications.',
        },
        { uid: 'admin-1', email: 'admin@example.com' }
      ),
      'failed-precondition'
    );
    await adminDb.doc(`churches/${CHURCH_ID}`).update({ isActive: true });

    await adminDb.doc('events/event-trigger-1').set({
      churchId: CHURCH_ID,
      title: 'Feast Day Liturgy',
      startTime: Timestamp.fromDate(new Date('2030-01-07T15:00:00Z')),
    });

    await adminDb.doc('newsletters/newsletter-trigger-1').set({
      churchId: CHURCH_ID,
      title: 'Parish Bulletin',
      excerpt: 'This week in the parish.',
      content: '<p>This week in the parish.</p>',
      status: 'draft',
      emailSent: false,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    await adminDb.doc('newsletters/newsletter-trigger-1').update({
      status: 'published',
      publishedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    const manualNotification = await waitFor(
      async () => {
        const snap = await adminDb
          .collection('notifications')
          .where('type', '==', 'manual')
          .where('churchId', '==', CHURCH_ID)
          .limit(1)
          .get();
        return snap.empty ? null : snap.docs[0].data();
      },
      (data) => data?.title === 'Service Reminder',
      'manual notification record'
    );
    expect(manualNotification).toMatchObject({
      sentBy: 'admin-1',
      sentByName: 'admin-1',
      targetRoles: ['member', 'admin', 'treasurer'],
      churchName: 'St. Nicholas',
      emailSent: true,
      emailRecipientCount: 3,
      emailRecipientTruncated: false,
    });

    const eventNotification = await waitFor(
      async () => {
        const snap = await adminDb
          .collection('notifications')
          .where('type', '==', 'event')
          .where('churchId', '==', CHURCH_ID)
          .limit(1)
          .get();
        return snap.empty ? null : snap.docs[0].data();
      },
      (data) => data?.title === 'New Event: Feast Day Liturgy',
      'event trigger notification record'
    );
    expect(eventNotification).toMatchObject({
      body: 'Join us for Feast Day Liturgy on Monday, January 7',
      sentBy: 'system',
      targetRoles: ['member', 'admin', 'treasurer', 'priest'],
    });

    const newsletter = await waitFor(
      async () => (await adminDb.doc('newsletters/newsletter-trigger-1').get()).data(),
      (data) => data?.emailSent === true,
      'newsletter email fanout'
    );
    expect(newsletter).toMatchObject({
      emailRecipientCount: 4,
      emailRecipientTruncated: false,
    });

    const newsletterNotification = await waitFor(
      async () => {
        const snap = await adminDb
          .collection('notifications')
          .where('type', '==', 'newsletter')
          .where('churchId', '==', CHURCH_ID)
          .limit(1)
          .get();
        return snap.empty ? null : snap.docs[0].data();
      },
      (data) => data?.title === 'New Bulletin: Parish Bulletin',
      'newsletter trigger notification record'
    );
    expect(newsletterNotification).toMatchObject({
      newsletterId: 'newsletter-trigger-1',
      sentBy: 'system',
      targetRoles: ['member', 'admin', 'treasurer', 'priest'],
    });

    const pushAttempts = await waitFor(
      async () => {
        const snap = await adminDb
          .collection('functionTestPushNotifications')
          .where('churchId', '==', CHURCH_ID)
          .get();
        return snap.docs.map((doc) => doc.data());
      },
      (records) => records.length >= 3,
      'emulator push fanout records'
    );
    expect(pushAttempts.map((record) => record.title)).toEqual(
      expect.arrayContaining([
        'Service Reminder',
        'New Event: Feast Day Liturgy',
        'New Bulletin: Parish Bulletin',
      ])
    );
  });
});
