import { initializeApp as initializeAdminApp, deleteApp as deleteAdminApp, getApps } from 'firebase-admin/app';
import { getAuth as getAdminAuth } from 'firebase-admin/auth';
import { FieldValue, Timestamp, getFirestore } from 'firebase-admin/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const PROJECT_ID = 'kandilo-2f7a9';
const CHURCH_ID = 'church-1';
const AUTH_EMULATOR_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST ?? '127.0.0.1:9098';
const FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8088';
const FUNCTIONS_EMULATOR_ORIGIN = 'http://127.0.0.1:5008';
const PASSWORD = 'Password123!';
const SUPER_ADMIN_AUTH: TestAuthHeaders = {
  uid: 'priest-1',
  email: 'priest@example.com',
  superAdmin: true,
};

const adminApp = getApps()[0] ?? initializeAdminApp({ projectId: PROJECT_ID });
const adminAuth = getAdminAuth(adminApp);
const adminDb = getFirestore(adminApp);

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

function memberData(uid: string, email: string, role: 'priest' | 'admin' | 'member') {
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
  role: 'priest' | 'admin' | 'member'
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

async function seedBaseData(): Promise<void> {
  await Promise.all([
    createVerifiedUser('priest-1', 'priest@example.com', 'Priest One'),
    createVerifiedUser('admin-1', 'admin@example.com', 'Admin One'),
    createVerifiedUser('member-1', 'member@example.com', 'Member One'),
    createVerifiedUser('invitee-1', 'invitee@example.com', 'Invitee One'),
    createVerifiedUser('other-1', 'other@example.com', 'Other One'),
  ]);

  await adminDb.doc(`churches/${CHURCH_ID}`).set(churchData());
  await Promise.all([
    seedChurchMember('priest-1', 'priest@example.com', 'priest'),
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
  });

  it('sends member invitations from admins and blocks admin invitations unless caller is priest', async () => {
    const result = await callCallable<
      { churchId: string; inviteeEmail: string; role?: 'member' | 'admin' },
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
  });

  it('creates hosted Stripe checkout sessions only for active members', async () => {
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
      checkoutUrl: 'https://checkout.stripe.com/c/pay/cs_test_kandilo_mock',
      sessionId: 'cs_test_kandilo_mock',
    });

    const givingSnap = await adminDb.doc(`giving/${result.givingId}`).get();
    expect(givingSnap.data()).toMatchObject({
      churchId: CHURCH_ID,
      userId: 'member-1',
      donorRole: 'member',
      amountCents: 5000,
      currency: 'USD',
      status: 'pending',
      stripeCheckoutSessionId: 'cs_test_kandilo_mock',
    });

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
    ]);

    const result = await callCallable<Record<string, never>, {
      stats: Array<{
        churchId: string;
        memberCount: number;
        priestCount: number;
        adminCount: number;
        eventCount: number;
        newsletterCount: number;
        donationTotal: number;
      }>;
    }>('getSuperAdminStats', {}, SUPER_ADMIN_AUTH);

    const churchStats = result.stats.find((stats) => stats.churchId === CHURCH_ID);
    expect(churchStats).toMatchObject({
      memberCount: 3,
      priestCount: 1,
      adminCount: 1,
      eventCount: 1,
      newsletterCount: 1,
      donationTotal: 123.45,
    });

    await expectCallableFails(
      callCallable('getSuperAdminStats', {}, { uid: 'admin-1', email: 'admin@example.com' }),
      'permission-denied'
    );
  });

  it('processes Stripe checkout webhooks idempotently and records validation failures', async () => {
    const givingId = 'giving-webhook-1';
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
      (data) => data?.status === 'completed' && Boolean(data.receiptEmailSentAt),
      'completed giving receipt'
    );
    expect(completedGiving).toMatchObject({
      status: 'completed',
      stripePaymentIntentId: 'pi_test_webhook',
      stripePaymentStatus: 'paid',
    });

    const processedEvent = await adminDb.doc('stripeWebhookEvents/evt_checkout_completed').get();
    expect(processedEvent.data()).toMatchObject({
      type: 'checkout.session.completed',
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

  it('fans out manual notifications plus event and newsletter trigger records without external services', async () => {
    await expect(
      callCallable(
        'sendPushNotification',
        {
          churchId: CHURCH_ID,
          title: 'Service Reminder',
          body: 'Vespers begins at 6 PM.',
          targetRoles: ['member', 'admin'],
        },
        { uid: 'admin-1', email: 'admin@example.com' }
      )
    ).resolves.toEqual({ success: true });

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
      targetRoles: ['member', 'admin'],
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
    });

    const newsletter = await waitFor(
      async () => (await adminDb.doc('newsletters/newsletter-trigger-1').get()).data(),
      (data) => data?.emailSent === true,
      'newsletter email fanout'
    );
    expect(newsletter).toMatchObject({
      emailRecipientCount: 3,
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
