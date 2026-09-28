import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestContext,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { getMetadata, ref, uploadString } from 'firebase/storage';

const PROJECT_ID = 'kandilo-2f7a9';
const CHURCH_ID = 'church-1';
const ACTIVE_CHURCH = {
  name: 'St. Nicholas',
  city: 'Chicago',
  state: 'IL',
  location: 'Chicago, IL',
  imageURL: 'https://example.com/church.jpg',
  isActive: true,
  isVerified: true,
  showSaintDays: false,
};

let testEnv: RulesTestEnvironment;

function verifiedContext(uid: string, email: string, extraClaims: Record<string, unknown> = {}): RulesTestContext {
  return testEnv.authenticatedContext(uid, {
    email,
    email_verified: true,
    firebase: { sign_in_provider: 'password' },
    ...extraClaims,
  });
}

function unverifiedContext(uid: string, email: string, extraClaims: Record<string, unknown> = {}): RulesTestContext {
  return testEnv.authenticatedContext(uid, {
    email,
    email_verified: false,
    firebase: { sign_in_provider: 'password' },
    ...extraClaims,
  });
}

function anonymousContext(uid = 'guest-1'): RulesTestContext {
  return testEnv.authenticatedContext(uid, {
    email_verified: false,
    firebase: { sign_in_provider: 'anonymous' },
  });
}

function unauthenticatedContext(): RulesTestContext {
  return testEnv.unauthenticatedContext();
}

function dbFor(context: RulesTestContext) {
  return context.firestore();
}

function storageFor(context: RulesTestContext) {
  return context.storage();
}

function userProfile(uid: string, email: string) {
  return {
    email,
    displayName: uid,
    photoURL: null,
    preferredLanguage: 'English',
    phone: '',
    ministries: [],
    description: '',
    showInDirectory: true,
    fcmTokens: [],
    createdAt: Timestamp.fromDate(new Date('2026-05-17T12:00:00Z')),
  };
}

function memberDoc(input: {
  uid: string;
  email: string;
  role: 'priest' | 'treasurer' | 'admin' | 'member';
  status?: 'active' | 'suspended';
  showInDirectory?: boolean;
}) {
  return {
    userId: input.uid,
    churchId: CHURCH_ID,
    role: input.role,
    status: input.status ?? 'active',
    displayName: input.uid,
    email: input.email,
    photoURL: '',
    joinedAt: Timestamp.fromDate(new Date('2026-05-17T12:00:00Z')),
    invitedBy: 'priest-1',
    phone: '',
    ministry: '',
    description: '',
    showInDirectory: input.showInDirectory ?? true,
  };
}

function membershipFanout(input: {
  role: 'priest' | 'treasurer' | 'admin' | 'member';
  status?: 'active' | 'suspended';
}) {
  return {
    churchId: CHURCH_ID,
    churchName: ACTIVE_CHURCH.name,
    location: ACTIVE_CHURCH.location,
    imageURL: ACTIVE_CHURCH.imageURL,
    role: input.role,
    status: input.status ?? 'active',
    joinedAt: Timestamp.fromDate(new Date('2026-05-17T12:00:00Z')),
  };
}

async function seedBaseData(): Promise<void> {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = dbFor(context);
    await Promise.all([
      setDoc(doc(db, `churches/${CHURCH_ID}`), ACTIVE_CHURCH),
      setDoc(doc(db, 'users/priest-1'), userProfile('priest-1', 'priest@example.com')),
      setDoc(doc(db, 'users/treasurer-1'), userProfile('treasurer-1', 'treasurer@example.com')),
      setDoc(doc(db, 'users/admin-1'), userProfile('admin-1', 'admin@example.com')),
      setDoc(doc(db, 'users/member-1'), userProfile('member-1', 'member@example.com')),
      setDoc(doc(db, 'users/member-2'), userProfile('member-2', 'member2@example.com')),
      setDoc(doc(db, 'users/suspended-1'), userProfile('suspended-1', 'suspended@example.com')),
      setDoc(
        doc(db, `churches/${CHURCH_ID}/members/priest-1`),
        memberDoc({ uid: 'priest-1', email: 'priest@example.com', role: 'priest' })
      ),
      setDoc(
        doc(db, `churches/${CHURCH_ID}/members/admin-1`),
        memberDoc({ uid: 'admin-1', email: 'admin@example.com', role: 'admin' })
      ),
      setDoc(
        doc(db, `churches/${CHURCH_ID}/members/treasurer-1`),
        memberDoc({ uid: 'treasurer-1', email: 'treasurer@example.com', role: 'treasurer' })
      ),
      setDoc(
        doc(db, `churches/${CHURCH_ID}/members/member-1`),
        memberDoc({ uid: 'member-1', email: 'member@example.com', role: 'member' })
      ),
      setDoc(
        doc(db, `churches/${CHURCH_ID}/members/member-2`),
        memberDoc({
          uid: 'member-2',
          email: 'member2@example.com',
          role: 'member',
          showInDirectory: false,
        })
      ),
      setDoc(
        doc(db, `churches/${CHURCH_ID}/members/suspended-1`),
        memberDoc({
          uid: 'suspended-1',
          email: 'suspended@example.com',
          role: 'member',
          status: 'suspended',
        })
      ),
      setDoc(
        doc(db, `users/priest-1/churchMemberships/${CHURCH_ID}`),
        membershipFanout({ role: 'priest' })
      ),
      setDoc(
        doc(db, `users/admin-1/churchMemberships/${CHURCH_ID}`),
        membershipFanout({ role: 'admin' })
      ),
      setDoc(
        doc(db, `users/treasurer-1/churchMemberships/${CHURCH_ID}`),
        membershipFanout({ role: 'treasurer' })
      ),
      setDoc(
        doc(db, `users/member-1/churchMemberships/${CHURCH_ID}`),
        membershipFanout({ role: 'member' })
      ),
      setDoc(
        doc(db, `users/member-2/churchMemberships/${CHURCH_ID}`),
        membershipFanout({ role: 'member' })
      ),
      setDoc(
        doc(db, `users/suspended-1/churchMemberships/${CHURCH_ID}`),
        membershipFanout({ role: 'member', status: 'suspended' })
      ),
      setDoc(doc(db, `churchPaymentSettings/${CHURCH_ID}`), {
        stripeConnectEnabled: true,
        stripeConnectAccountId: 'acct_private_test_123',
      }),
    ]);
  });
}

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules: readFileSync('firestore.rules', 'utf8'),
    },
    storage: {
      rules: readFileSync('storage.rules', 'utf8'),
    },
  });
});

beforeEach(async () => {
  await testEnv.clearFirestore();
  await testEnv.clearStorage();
  await seedBaseData();
});

afterAll(async () => {
  await testEnv.cleanup();
});

describe('Firestore rules', () => {
  it('protects user profiles behind signed-in non-anonymous ownership', async () => {
    const ownerDb = dbFor(verifiedContext('member-1', 'member@example.com'));
    const unverifiedOwnerDb = dbFor(unverifiedContext('member-1', 'member@example.com'));
    const otherDb = dbFor(verifiedContext('member-2', 'member2@example.com'));
    const guestDb = dbFor(anonymousContext());
    const superAdminDb = dbFor(verifiedContext('super-1', 'super@example.com', { superAdmin: true }));
    const unverifiedSuperAdminDb = dbFor(
      unverifiedContext('super-unverified', 'super-unverified@example.com', { superAdmin: true })
    );
    const ownerRef = doc(ownerDb, 'users/member-1');

    await assertSucceeds(getDoc(ownerRef));
    await assertSucceeds(getDoc(doc(unverifiedOwnerDb, 'users/member-1')));
    await assertFails(getDoc(doc(otherDb, 'users/member-1')));
    await assertFails(getDoc(doc(guestDb, 'users/member-1')));
    await assertFails(getDoc(doc(superAdminDb, 'users/member-1')));
    await assertFails(getDoc(doc(unverifiedSuperAdminDb, 'users/member-1')));

    await assertSucceeds(
      updateDoc(ownerRef, {
        displayName: 'Updated Member',
        preferredLanguage: 'Română',
      })
    );
    await assertSucceeds(
      updateDoc(doc(unverifiedOwnerDb, 'users/member-1'), {
        displayName: 'Updated Unverified Member',
        preferredLanguage: 'English',
      })
    );
    await assertSucceeds(
      updateDoc(ownerRef, {
        taxReceiptLegalName: 'Legal Donor Name',
        taxReceiptAddress: {
          line1: '10 Church Street',
          line2: 'Suite 2',
          city: 'Chicago',
          region: 'IL',
          postalCode: '60601',
          country: 'US',
        },
      })
    );
    await assertFails(
      updateDoc(ownerRef, {
        taxReceiptAddress: {
          line1: '10 Church Street',
          city: 'Chicago',
          country: 'US',
          unreviewedField: 'not allowed',
        },
      })
    );
    await assertFails(updateDoc(ownerRef, { email: 'changed@example.com' }));

    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(dbFor(context), 'users/legacy-1'), {
        email: 'legacy@example.com',
        displayName: 'Legacy Member',
        createdAt: Timestamp.fromDate(new Date('2026-05-17T12:00:00Z')),
      });
    });
    const legacyDb = dbFor(verifiedContext('legacy-1', 'legacy@example.com'));
    await assertSucceeds(
      updateDoc(doc(legacyDb, 'users/legacy-1'), {
        displayName: 'Legacy Member',
        photoURL: null,
        preferredLanguage: 'English',
        phone: '',
        ministries: [],
        description: '',
        showInDirectory: false,
        taxReceiptLegalName: '',
        fcmTokens: [],
      })
    );
  });

  it('keeps broad church metadata writes backend-only', async () => {
    const adminDb = dbFor(verifiedContext('admin-1', 'admin@example.com'));
    const superAdminDb = dbFor(verifiedContext('super-1', 'super@example.com', { superAdmin: true }));

    await assertSucceeds(updateDoc(doc(adminDb, `churches/${CHURCH_ID}`), { showSaintDays: true }));
    await assertFails(updateDoc(doc(adminDb, `churches/${CHURCH_ID}`), { name: 'Renamed Parish' }));
    await assertFails(updateDoc(doc(superAdminDb, `churches/${CHURCH_ID}`), { isActive: false }));
    await assertFails(setDoc(doc(superAdminDb, 'churches/direct-client-create'), {
      ...ACTIVE_CHURCH,
      name: 'Direct Client Create',
    }));
  });

  it('allows public discovery queries for active churches only', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = dbFor(context);
      await setDoc(doc(db, 'churches/inactive-church'), {
        ...ACTIVE_CHURCH,
        name: 'Inactive Parish',
        isActive: false,
      });
    });

    const publicDb = dbFor(unauthenticatedContext());
    await assertSucceeds(getDocs(query(
      collection(publicDb, 'churches'),
      where('isActive', '==', true),
      limit(100)
    )));
    await assertFails(getDoc(doc(publicDb, 'churches/inactive-church')));
  });

  it('keeps membership reads and updates scoped by role', async () => {
    const memberDb = dbFor(verifiedContext('member-1', 'member@example.com'));
    const adminDb = dbFor(verifiedContext('admin-1', 'admin@example.com'));
    const treasurerDb = dbFor(verifiedContext('treasurer-1', 'treasurer@example.com'));
    const priestDb = dbFor(verifiedContext('priest-1', 'priest@example.com'));
    const memberRefForMember = doc(memberDb, `churches/${CHURCH_ID}/members/member-1`);
    const hiddenMemberRefForMember = doc(memberDb, `churches/${CHURCH_ID}/members/member-2`);
    const hiddenMemberRefForTreasurer = doc(treasurerDb, `churches/${CHURCH_ID}/members/member-2`);
    const memberRefForAdmin = doc(adminDb, `churches/${CHURCH_ID}/members/member-1`);
    const fanoutRefForAdmin = doc(adminDb, `users/member-1/churchMemberships/${CHURCH_ID}`);
    const memberRefForPriest = doc(priestDb, `churches/${CHURCH_ID}/members/member-1`);
    const fanoutRefForPriest = doc(priestDb, `users/member-1/churchMemberships/${CHURCH_ID}`);

    await assertSucceeds(getDoc(memberRefForMember));
    await assertFails(getDoc(hiddenMemberRefForMember));
    await assertSucceeds(getDoc(memberRefForAdmin));
    await assertFails(getDoc(hiddenMemberRefForTreasurer));
    await assertFails(getDoc(doc(unauthenticatedContext().firestore(), `churches/${CHURCH_ID}/members/member-1`)));

    await assertSucceeds(updateDoc(memberRefForMember, { phone: '555-0100' }));
    await assertFails(updateDoc(memberRefForMember, { role: 'admin' }));

    await assertSucceeds(updateDoc(memberRefForAdmin, { status: 'suspended' }));
    await assertSucceeds(updateDoc(fanoutRefForAdmin, { status: 'suspended' }));
    await assertFails(updateDoc(memberRefForAdmin, { role: 'admin' }));

    await assertSucceeds(updateDoc(memberRefForPriest, { role: 'treasurer' }));
    await assertSucceeds(updateDoc(fanoutRefForPriest, { role: 'treasurer' }));
    await assertFails(updateDoc(memberRefForPriest, { role: 'priest' }));
    await assertFails(setDoc(doc(adminDb, `churches/${CHURCH_ID}/members/new-member`), memberDoc({
      uid: 'new-member',
      email: 'new@example.com',
      role: 'member',
    })));
  });

  it('blocks direct client membership creates while allowing members to leave', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = dbFor(context);
      await setDoc(doc(db, 'churches/church-2'), {
        ...ACTIVE_CHURCH,
        name: 'St. Sava',
        city: 'Phoenix',
        state: 'AZ',
        location: 'Phoenix, AZ',
      });
    });

    const memberDb = dbFor(verifiedContext('member-1', 'member@example.com'));
    const directSelfJoinBatch = writeBatch(memberDb);
    directSelfJoinBatch.set(doc(memberDb, 'churches/church-2/members/member-1'), {
      userId: 'member-1',
      churchId: 'church-2',
      role: 'member',
      status: 'active',
      displayName: 'Member One',
      email: 'member@example.com',
      photoURL: '',
      joinedAt: serverTimestamp(),
      showInDirectory: true,
    });
    directSelfJoinBatch.set(doc(memberDb, 'users/member-1/churchMemberships/church-2'), {
      churchId: 'church-2',
      churchName: 'St. Sava',
      location: 'Phoenix, AZ',
      imageURL: 'https://example.com/church.jpg',
      role: 'member',
      status: 'active',
      joinedAt: serverTimestamp(),
    });
    await assertFails(directSelfJoinBatch.commit());

    await assertFails(deleteDoc(doc(memberDb, `churches/${CHURCH_ID}/members/member-1`)));
    await assertFails(deleteDoc(doc(memberDb, `users/member-1/churchMemberships/${CHURCH_ID}`)));
    const leave = writeBatch(memberDb);
    leave.delete(doc(memberDb, `churches/${CHURCH_ID}/members/member-1`));
    leave.delete(doc(memberDb, `users/member-1/churchMemberships/${CHURCH_ID}`));
    await assertSucceeds(leave.commit());
  });

  it('preserves suspended memberships and prevents unverified directory access', async () => {
    const unverified = dbFor(unverifiedContext('member-1', 'member@example.com'));
    await assertFails(getDoc(doc(unverified, `churches/${CHURCH_ID}/members/admin-1`)));
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'newsletters/verification-policy'), { churchId: CHURCH_ID, status: 'published' });
    });
    await assertFails(getDoc(doc(unverified, 'newsletters/verification-policy')));
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await updateDoc(doc(dbFor(context), `churches/${CHURCH_ID}/members/member-1`), { status: 'suspended' });
      await updateDoc(doc(dbFor(context), `users/member-1/churchMemberships/${CHURCH_ID}`), { status: 'suspended' });
    });
    const member = dbFor(verifiedContext('member-1', 'member@example.com'));
    await assertFails(deleteDoc(doc(member, `churches/${CHURCH_ID}/members/member-1`)));
    await assertFails(deleteDoc(doc(member, `users/member-1/churchMemberships/${CHURCH_ID}`)));
    const leave = writeBatch(member);
    leave.delete(doc(member, `churches/${CHURCH_ID}/members/member-1`));
    leave.delete(doc(member, `users/member-1/churchMemberships/${CHURCH_ID}`));
    await assertFails(leave.commit());
  });

  it('enforces invitation and giving read/write boundaries', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = dbFor(context);
      await Promise.all([
        setDoc(doc(db, 'invitations/invite-1'), {
          churchId: CHURCH_ID,
          churchName: ACTIVE_CHURCH.name,
          invitedBy: 'admin-1',
          inviteeEmail: 'invitee@example.com',
          role: 'member',
          status: 'pending',
          createdAt: Timestamp.fromDate(new Date('2026-05-17T12:00:00Z')),
          expiresAt: Timestamp.fromDate(new Date('2026-05-31T12:00:00Z')),
        }),
        setDoc(doc(db, 'giving/giving-1'), {
          churchId: CHURCH_ID,
          userId: 'member-1',
          anonymous: false,
          churchReceiptVisible: true,
          donorName: 'Member One',
          donorEmail: '',
          donorNamePublicSafe: true,
          receiptManagerGivingSafeVersion: 1,
          amount: 50,
          amountCents: 5000,
          currency: 'USD',
          status: 'completed',
          createdAt: Timestamp.fromDate(new Date('2026-05-24T16:00:00Z')),
        }),
        setDoc(doc(db, 'giving/giving-anonymous'), {
          churchId: CHURCH_ID,
          userId: 'member-1',
          anonymous: true,
          donorName: 'Anonymous donor',
          donorEmail: '',
          donorNamePublicSafe: false,
          amount: 75,
          amountCents: 7500,
          currency: 'USD',
          status: 'completed',
          createdAt: Timestamp.fromDate(new Date('2026-05-24T17:00:00Z')),
        }),
        setDoc(doc(db, 'giving/giving-ambiguous-anonymity'), {
          churchId: CHURCH_ID,
          userId: 'member-1',
          amount: 40,
          amountCents: 4000,
          currency: 'USD',
          status: 'completed',
          createdAt: Timestamp.fromDate(new Date('2026-05-24T18:00:00Z')),
        }),
        setDoc(doc(db, 'giving/giving-legacy-email'), {
          churchId: CHURCH_ID,
          userId: 'member-1',
          anonymous: false,
          donorName: 'member@example.com',
          donorEmail: 'legacy-member@example.com',
          donorNamePublicSafe: false,
          amount: 60,
          amountCents: 6000,
          currency: 'USD',
          status: 'completed',
          createdAt: Timestamp.fromDate(new Date('2026-05-24T19:00:00Z')),
        }),
        setDoc(doc(db, 'giving/giving-pending'), {
          churchId: CHURCH_ID,
          userId: 'member-1',
          anonymous: false,
          churchReceiptVisible: true,
          donorName: 'Pending Donor',
          donorEmail: '',
          donorNamePublicSafe: true,
          receiptManagerGivingSafeVersion: 1,
          amount: 65,
          amountCents: 6500,
          currency: 'USD',
          status: 'pending',
          createdAt: Timestamp.fromDate(new Date('2026-05-24T19:10:00Z')),
        }),
        setDoc(doc(db, 'giving/giving-failed'), {
          churchId: CHURCH_ID,
          userId: 'member-1',
          anonymous: false,
          churchReceiptVisible: true,
          donorName: 'Failed Donor',
          donorEmail: '',
          donorNamePublicSafe: true,
          receiptManagerGivingSafeVersion: 1,
          amount: 70,
          amountCents: 7000,
          currency: 'USD',
          status: 'failed',
          createdAt: Timestamp.fromDate(new Date('2026-05-24T19:20:00Z')),
        }),
        setDoc(doc(db, 'taxReceipts/giving-1'), {
          churchId: CHURCH_ID,
          userId: 'member-1',
          givingId: 'giving-1',
          receiptNumber: 'STN-2026-000001',
          status: 'sent',
          issuedAt: Timestamp.fromDate(new Date('2026-05-24T16:10:00Z')),
        }),
        setDoc(doc(db, 'taxReceiptSummaries/annual-1'), {
          receiptId: 'annual-1',
          churchId: CHURCH_ID,
          userId: 'member-1',
          kind: 'annual',
          jurisdiction: 'CA',
          receiptYear: 2025,
          receiptNumber: 'STN-2025-000009',
          status: 'sent',
          correctedReceipt: true,
          donorLabel: 'Member One',
          donorAnonymous: false,
          churchReceiptVisible: true,
          donorLabelPublicSafe: true,
          receiptManagerSummarySafe: true,
          receiptManagerSummarySafeVersion: 2,
          issuedAt: Timestamp.fromDate(new Date('2026-01-15T12:00:00Z')),
        }),
        setDoc(doc(db, 'taxReceiptSummaries/annual-profile-required'), {
          receiptId: '',
          churchId: CHURCH_ID,
          userId: 'member-1',
          kind: 'annual',
          receiptYear: 2025,
          receiptNumber: '',
          status: 'error',
          donorLabel: 'Member One',
          donorAnonymous: false,
          churchReceiptVisible: true,
          donorLabelPublicSafe: true,
          receiptManagerSummarySafe: true,
          receiptManagerSummarySafeVersion: 2,
          emailError: 'tax_receipt_donor_profile_incomplete',
          issuedAt: Timestamp.fromDate(new Date('2026-01-15T12:03:00Z')),
        }),
        setDoc(doc(db, 'taxReceiptSummaries/annual-verified-email-required'), {
          receiptId: '',
          churchId: CHURCH_ID,
          userId: 'member-1',
          kind: 'annual',
          receiptYear: 2025,
          receiptNumber: '',
          status: 'error',
          donorLabel: 'Member One',
          donorAnonymous: false,
          churchReceiptVisible: true,
          donorLabelPublicSafe: true,
          receiptManagerSummarySafe: true,
          receiptManagerSummarySafeVersion: 2,
          emailError: 'tax_receipt_missing_email_or_amount',
          issuedAt: Timestamp.fromDate(new Date('2026-01-15T12:04:00Z')),
        }),
        setDoc(doc(db, 'taxReceiptSummaries/annual-legacy-email'), {
          receiptId: 'annual-legacy-email',
          churchId: CHURCH_ID,
          userId: 'member-1',
          kind: 'annual',
          receiptYear: 2025,
          receiptNumber: 'STN-2025-000012',
          status: 'sent',
          donorLabel: 'member@example.com',
          donorAnonymous: false,
          issuedAt: Timestamp.fromDate(new Date('2026-01-15T12:05:00Z')),
        }),
        setDoc(doc(db, 'taxReceiptSummaries/annual-anonymous'), {
          receiptId: 'annual-anonymous',
          churchId: CHURCH_ID,
          userId: 'member-1',
          kind: 'annual',
          receiptYear: 2025,
          receiptNumber: 'STN-2025-000010',
          status: 'sent',
          donorLabel: 'Anonymous donor',
          donorAnonymous: true,
          issuedAt: Timestamp.fromDate(new Date('2026-01-15T12:00:00Z')),
        }),
        setDoc(doc(db, 'taxReceiptSummaries/annual-ambiguous-anonymity'), {
          receiptId: 'annual-ambiguous-anonymity',
          churchId: CHURCH_ID,
          userId: 'member-1',
          kind: 'annual',
          receiptYear: 2025,
          receiptNumber: 'STN-2025-000011',
          status: 'sent',
          issuedAt: Timestamp.fromDate(new Date('2026-01-15T12:00:00Z')),
        }),
        setDoc(doc(db, 'taxReceiptSummaries/single-malformed-visible'), {
          receiptId: 'single-malformed-visible',
          churchId: CHURCH_ID,
          userId: 'member-1',
          kind: 'single',
          receiptYear: 2025,
          receiptNumber: 'STN-2025-000013',
          status: 'sent',
          donorLabel: 'Member One',
          donorAnonymous: false,
          churchReceiptVisible: true,
          issuedAt: Timestamp.fromDate(new Date('2026-01-15T12:10:00Z')),
        }),
        setDoc(doc(db, 'taxReceiptEvents/event-1'), {
          action: 'email_sent',
          actorUid: 'priest-1',
          churchId: CHURCH_ID,
          userId: 'member-1',
          receiptId: 'giving-1',
          kind: 'single',
          receiptYear: 2026,
          createdAt: Timestamp.fromDate(new Date('2026-05-24T16:00:00Z')),
        }),
        setDoc(doc(db, 'stripeWebhookEvents/evt_checkout_completed'), {
          type: 'checkout.session.completed',
          stripeSessionId: 'cs_live_private',
          stripePaymentIntentId: 'pi_live_private',
          givingId: 'giving-1',
          status: 'processed',
          processedAt: Timestamp.fromDate(new Date('2026-05-24T16:05:00Z')),
        }),
      ]);
    });

    const inviteeDb = dbFor(verifiedContext('invitee-1', 'invitee@example.com'));
    const memberDb = dbFor(verifiedContext('member-1', 'member@example.com'));
    const unverifiedMemberDb = dbFor(unverifiedContext('member-1', 'member@example.com'));
    const anonymousMemberDb = dbFor(anonymousContext('member-1'));
    const adminDb = dbFor(verifiedContext('admin-1', 'admin@example.com'));
    const treasurerDb = dbFor(verifiedContext('treasurer-1', 'treasurer@example.com'));
    const priestDb = dbFor(verifiedContext('priest-1', 'priest@example.com'));
    const superAdminDb = dbFor(verifiedContext('super-1', 'super@example.com', { superAdmin: true }));

    await assertSucceeds(getDoc(doc(inviteeDb, 'invitations/invite-1')));
    await assertSucceeds(getDoc(doc(adminDb, 'invitations/invite-1')));
    await assertFails(getDoc(doc(memberDb, 'invitations/invite-1')));
    await assertFails(setDoc(doc(adminDb, 'invitations/invite-2'), { churchId: CHURCH_ID }));

    await assertSucceeds(getDoc(doc(memberDb, 'giving/giving-1')));
    await assertSucceeds(getDoc(doc(priestDb, 'giving/giving-1')));
    await assertSucceeds(getDoc(doc(treasurerDb, 'giving/giving-1')));
    await assertFails(getDoc(doc(adminDb, 'giving/giving-1')));
    await assertFails(getDoc(doc(superAdminDb, 'giving/giving-1')));
    await assertSucceeds(getDoc(doc(memberDb, 'giving/giving-anonymous')));
    await assertFails(getDoc(doc(priestDb, 'giving/giving-anonymous')));
    await assertFails(getDoc(doc(treasurerDb, 'giving/giving-anonymous')));
    await assertFails(getDoc(doc(superAdminDb, 'giving/giving-anonymous')));
    await assertSucceeds(getDoc(doc(memberDb, 'giving/giving-ambiguous-anonymity')));
    await assertFails(getDoc(doc(priestDb, 'giving/giving-ambiguous-anonymity')));
    await assertFails(getDoc(doc(treasurerDb, 'giving/giving-ambiguous-anonymity')));
    await assertSucceeds(getDoc(doc(memberDb, 'giving/giving-legacy-email')));
    await assertFails(getDoc(doc(priestDb, 'giving/giving-legacy-email')));
    await assertFails(getDoc(doc(treasurerDb, 'giving/giving-legacy-email')));
    await assertSucceeds(getDoc(doc(memberDb, 'giving/giving-pending')));
    await assertFails(getDoc(doc(priestDb, 'giving/giving-pending')));
    await assertFails(getDoc(doc(treasurerDb, 'giving/giving-pending')));
    await assertSucceeds(getDoc(doc(memberDb, 'giving/giving-failed')));
    await assertFails(getDoc(doc(priestDb, 'giving/giving-failed')));
    await assertFails(getDoc(doc(treasurerDb, 'giving/giving-failed')));
    await assertSucceeds(getDocs(query(
      collection(priestDb, 'giving'),
      where('churchId', '==', CHURCH_ID),
      where('anonymous', '==', false),
      where('churchReceiptVisible', '==', true),
      where('donorEmail', '==', ''),
      where('donorNamePublicSafe', '==', true),
      where('receiptManagerGivingSafeVersion', '==', 1),
      where('status', 'in', ['completed', 'refunded']),
      orderBy('createdAt', 'desc'),
      limit(10)
    )));
    await assertFails(getDocs(query(
      collection(priestDb, 'giving'),
      where('churchId', '==', CHURCH_ID),
      where('anonymous', '==', false),
      where('churchReceiptVisible', '==', true),
      where('donorEmail', '==', ''),
      orderBy('createdAt', 'desc'),
      limit(10)
    )));
    await assertFails(getDocs(query(
      collection(priestDb, 'giving'),
      where('churchId', '==', CHURCH_ID),
      where('anonymous', '==', false),
      where('churchReceiptVisible', '==', true),
      orderBy('createdAt', 'desc'),
      limit(10)
    )));
    await assertFails(getDocs(query(
      collection(priestDb, 'giving'),
      where('churchId', '==', CHURCH_ID),
      orderBy('createdAt', 'desc'),
      limit(10)
    )));
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = dbFor(context);
      await Promise.all([
        setDoc(doc(db, 'giving/giving-private-stripe-visible'), {
          churchId: CHURCH_ID,
          userId: 'member-1',
          anonymous: false,
          churchReceiptVisible: true,
          donorName: 'Member One',
          donorEmail: '',
          donorNamePublicSafe: true,
          amount: 50,
          amountCents: 5000,
          currency: 'USD',
          status: 'completed',
          stripeSessionId: 'cs_live_private_alias',
          stripeCheckoutSessionId: 'cs_live_private',
          stripeCheckoutUrl: 'https://checkout.stripe.com/private',
          stripeCheckoutSessionUrl: 'https://checkout.stripe.com/private/session',
          stripePaymentIntentId: 'pi_live_private',
          stripePaymentStatus: 'paid',
          stripeChargeId: 'ch_live_private',
          stripeCustomerId: 'cus_live_private',
          stripeConnectAccountId: 'acct_live_private',
          stripeRefundId: 're_live_private',
          checkoutSessionId: 'cs_live_private_legacy',
          checkoutUrl: 'https://checkout.stripe.com/private/legacy',
          paymentIntentId: 'pi_live_private_legacy',
          chargeId: 'ch_live_private_legacy',
          refundId: 're_live_private_legacy',
          createdAt: Timestamp.fromDate(new Date('2026-05-24T19:30:00Z')),
        }),
        setDoc(doc(db, 'givingPaymentMetadata/giving-1'), {
          churchId: CHURCH_ID,
          userId: 'member-1',
          stripeCheckoutSessionId: 'cs_live_private',
          stripePaymentIntentId: 'pi_live_private',
          stripeRefundedChargeId: 'ch_live_private',
        }),
      ]);
    });
    await assertSucceeds(getDoc(doc(memberDb, 'giving/giving-private-stripe-visible')));
    await assertFails(getDoc(doc(priestDb, 'giving/giving-private-stripe-visible')));
    await assertFails(getDoc(doc(treasurerDb, 'giving/giving-private-stripe-visible')));
    const freshPriestGiving = await assertSucceeds(getDocs(query(
      collection(priestDb, 'giving'),
      where('churchId', '==', CHURCH_ID),
      where('anonymous', '==', false),
      where('churchReceiptVisible', '==', true),
      where('donorEmail', '==', ''),
      where('donorNamePublicSafe', '==', true),
      where('receiptManagerGivingSafeVersion', '==', 1),
      where('status', 'in', ['completed', 'refunded']),
      orderBy('createdAt', 'desc'),
      limit(10)
    )));
    expect(freshPriestGiving.docs.map((giving) => giving.id)).not.toContain('giving-private-stripe-visible');
    await assertFails(getDoc(doc(memberDb, 'givingPaymentMetadata/giving-1')));
    await assertFails(getDoc(doc(priestDb, 'givingPaymentMetadata/giving-1')));
    await assertFails(getDoc(doc(treasurerDb, 'givingPaymentMetadata/giving-1')));
    await assertFails(getDoc(doc(adminDb, 'givingPaymentMetadata/giving-1')));
    await assertFails(getDoc(doc(superAdminDb, 'givingPaymentMetadata/giving-1')));
    await assertFails(setDoc(doc(superAdminDb, 'givingPaymentMetadata/giving-2'), {
      stripeCheckoutSessionId: 'cs_live_private_2',
    }));
    await assertFails(setDoc(doc(memberDb, 'giving/giving-2'), { churchId: CHURCH_ID }));

    await assertSucceeds(getDoc(doc(memberDb, 'taxReceipts/giving-1')));
    await assertFails(getDoc(doc(unverifiedMemberDb, 'taxReceipts/giving-1')));
    await assertFails(getDoc(doc(anonymousMemberDb, 'taxReceipts/giving-1')));
    await assertFails(getDoc(doc(priestDb, 'taxReceipts/giving-1')));
    await assertFails(getDoc(doc(treasurerDb, 'taxReceipts/giving-1')));
    await assertFails(getDoc(doc(adminDb, 'taxReceipts/giving-1')));
    await assertFails(getDoc(doc(superAdminDb, 'taxReceipts/giving-1')));
    await assertSucceeds(getDocs(query(
      collection(memberDb, 'taxReceipts'),
      where('userId', '==', 'member-1'),
      orderBy('issuedAt', 'desc'),
      limit(10)
    )));
    await assertFails(getDocs(query(
      collection(memberDb, 'taxReceipts'),
      orderBy('issuedAt', 'desc'),
      limit(10)
    )));
    await assertFails(getDocs(query(
      collection(priestDb, 'taxReceipts'),
      where('churchId', '==', CHURCH_ID),
      orderBy('issuedAt', 'desc'),
      limit(10)
    )));
    await assertFails(setDoc(doc(memberDb, 'taxReceipts/giving-2'), { churchId: CHURCH_ID }));

    await assertSucceeds(getDoc(doc(memberDb, 'taxReceiptSummaries/annual-1')));
    await assertFails(getDoc(doc(unverifiedMemberDb, 'taxReceiptSummaries/annual-1')));
    await assertFails(getDoc(doc(anonymousMemberDb, 'taxReceiptSummaries/annual-1')));
    await assertSucceeds(getDoc(doc(priestDb, 'taxReceiptSummaries/annual-1')));
    await assertSucceeds(getDoc(doc(treasurerDb, 'taxReceiptSummaries/annual-1')));
    expect((await getDoc(doc(priestDb, 'taxReceiptSummaries/annual-1'))).data()?.jurisdiction).toBe('CA');
    await assertFails(getDoc(doc(adminDb, 'taxReceiptSummaries/annual-1')));
    await assertFails(getDoc(doc(superAdminDb, 'taxReceiptSummaries/annual-1')));
    await assertSucceeds(getDoc(doc(memberDb, 'taxReceiptSummaries/annual-profile-required')));
    await assertSucceeds(getDoc(doc(priestDb, 'taxReceiptSummaries/annual-profile-required')));
    await assertSucceeds(getDoc(doc(treasurerDb, 'taxReceiptSummaries/annual-profile-required')));
    await assertFails(getDoc(doc(adminDb, 'taxReceiptSummaries/annual-profile-required')));
    await assertFails(getDoc(doc(superAdminDb, 'taxReceiptSummaries/annual-profile-required')));
    await assertSucceeds(getDoc(doc(memberDb, 'taxReceiptSummaries/annual-verified-email-required')));
    await assertSucceeds(getDoc(doc(priestDb, 'taxReceiptSummaries/annual-verified-email-required')));
    await assertSucceeds(getDoc(doc(treasurerDb, 'taxReceiptSummaries/annual-verified-email-required')));
    await assertFails(getDoc(doc(adminDb, 'taxReceiptSummaries/annual-verified-email-required')));
    await assertFails(getDoc(doc(superAdminDb, 'taxReceiptSummaries/annual-verified-email-required')));
    await assertSucceeds(getDoc(doc(memberDb, 'taxReceiptSummaries/annual-legacy-email')));
    await assertFails(getDoc(doc(priestDb, 'taxReceiptSummaries/annual-legacy-email')));
    await assertFails(getDoc(doc(treasurerDb, 'taxReceiptSummaries/annual-legacy-email')));
    await assertSucceeds(getDocs(query(
      collection(memberDb, 'taxReceiptSummaries'),
      where('userId', '==', 'member-1'),
      orderBy('issuedAt', 'desc'),
      limit(10)
    )));
    await assertFails(getDocs(query(
      collection(memberDb, 'taxReceiptSummaries'),
      orderBy('issuedAt', 'desc'),
      limit(10)
    )));
    await assertSucceeds(getDoc(doc(memberDb, 'taxReceiptSummaries/annual-anonymous')));
    await assertFails(getDoc(doc(priestDb, 'taxReceiptSummaries/annual-anonymous')));
    await assertFails(getDoc(doc(treasurerDb, 'taxReceiptSummaries/annual-anonymous')));
    await assertFails(getDoc(doc(superAdminDb, 'taxReceiptSummaries/annual-anonymous')));
    await assertSucceeds(getDoc(doc(memberDb, 'taxReceiptSummaries/annual-ambiguous-anonymity')));
    await assertFails(getDoc(doc(priestDb, 'taxReceiptSummaries/annual-ambiguous-anonymity')));
    await assertFails(getDoc(doc(treasurerDb, 'taxReceiptSummaries/annual-ambiguous-anonymity')));
    await assertSucceeds(getDoc(doc(memberDb, 'taxReceiptSummaries/single-malformed-visible')));
    await assertFails(getDoc(doc(priestDb, 'taxReceiptSummaries/single-malformed-visible')));
    await assertFails(getDoc(doc(treasurerDb, 'taxReceiptSummaries/single-malformed-visible')));
    await assertSucceeds(getDocs(query(
      collection(priestDb, 'taxReceiptSummaries'),
      where('churchId', '==', CHURCH_ID),
      where('kind', '==', 'annual'),
      where('donorAnonymous', '==', false),
      where('churchReceiptVisible', '==', true),
      where('donorLabelPublicSafe', '==', true),
      where('receiptManagerSummarySafe', '==', true),
      where('receiptManagerSummarySafeVersion', '==', 2),
      orderBy('issuedAt', 'desc'),
      limit(10)
    )));
    await assertFails(getDocs(query(
      collection(priestDb, 'taxReceiptSummaries'),
      where('churchId', '==', CHURCH_ID),
      where('kind', '==', 'annual'),
      where('donorAnonymous', '==', false),
      orderBy('issuedAt', 'desc'),
      limit(10)
    )));
    await assertFails(getDocs(query(
      collection(priestDb, 'taxReceiptSummaries'),
      where('churchId', '==', CHURCH_ID),
      where('donorAnonymous', '==', false),
      where('churchReceiptVisible', '==', true),
      where('donorLabelPublicSafe', '==', true),
      orderBy('issuedAt', 'desc'),
      limit(10)
    )));

    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(dbFor(context), 'taxReceiptSummaries/annual-private-field-leak'), {
        receiptId: 'annual-private-field-leak',
        churchId: CHURCH_ID,
        userId: 'member-1',
        kind: 'annual',
        receiptYear: 2025,
        receiptNumber: 'STN-2025-000014',
        status: 'sent',
        donorLabel: 'Member One',
        donorAnonymous: false,
        churchReceiptVisible: true,
        donorEmail: 'member@example.com',
        donorName: 'Member Legal Name',
        donorAddress: '10 Donor Street',
        organizationTaxId: '12-3456789',
        givingIds: ['giving-1'],
        contributions: [{ amountCents: 5000, currency: 'USD' }],
        emailSendingAt: Timestamp.fromDate(new Date('2026-01-15T12:19:00Z')),
        emailSendAttemptId: 'private-send-attempt-id-20260115',
        pdfStoragePath: 'taxReceipts/church-1/2025/annual-private-field-leak.pdf',
        issuedAt: Timestamp.fromDate(new Date('2026-01-15T12:20:00Z')),
      });
      await setDoc(doc(dbFor(context), 'taxReceiptSummaries/annual-private-field-safe-marker-leak'), {
        receiptId: 'annual-private-field-safe-marker-leak',
        churchId: CHURCH_ID,
        userId: 'member-1',
        kind: 'annual',
        receiptYear: 2025,
        receiptNumber: 'STN-2025-000015',
        status: 'sent',
        donorLabel: 'Member One',
        donorAnonymous: false,
        churchReceiptVisible: true,
        donorLabelPublicSafe: true,
        receiptManagerSummarySafe: true,
        receiptManagerSummarySafeVersion: 1,
        donorEmail: 'member@example.com',
        organizationTaxId: '12-3456789',
        emailSendingAt: Timestamp.fromDate(new Date('2026-01-15T12:24:00Z')),
        emailSendAttemptId: 'private-send-attempt-id-20260115-safe',
        pdfStoragePath: 'taxReceipts/church-1/2025/annual-private-field-safe-marker-leak.pdf',
        issuedAt: Timestamp.fromDate(new Date('2026-01-15T12:25:00Z')),
      });
      await setDoc(doc(dbFor(context), 'taxReceiptSummaries/annual-email-label-safe-marker-leak'), {
        receiptId: 'annual-email-label-safe-marker-leak',
        churchId: CHURCH_ID,
        userId: 'member-1',
        kind: 'annual',
        receiptYear: 2025,
        receiptNumber: 'STN-2025-000016',
        status: 'sent',
        donorLabel: 'member@example.com',
        donorAnonymous: false,
        churchReceiptVisible: true,
        donorLabelPublicSafe: false,
        receiptManagerSummarySafe: true,
        receiptManagerSummarySafeVersion: 2,
        issuedAt: Timestamp.fromDate(new Date('2026-01-15T12:26:00Z')),
      });
    });
    await assertSucceeds(getDoc(doc(memberDb, 'taxReceiptSummaries/annual-private-field-leak')));
    await assertFails(getDoc(doc(priestDb, 'taxReceiptSummaries/annual-private-field-leak')));
    await assertFails(getDoc(doc(treasurerDb, 'taxReceiptSummaries/annual-private-field-leak')));
    await assertSucceeds(getDoc(doc(memberDb, 'taxReceiptSummaries/annual-private-field-safe-marker-leak')));
    await assertFails(getDoc(doc(priestDb, 'taxReceiptSummaries/annual-private-field-safe-marker-leak')));
    await assertFails(getDoc(doc(treasurerDb, 'taxReceiptSummaries/annual-private-field-safe-marker-leak')));
    await assertSucceeds(getDoc(doc(memberDb, 'taxReceiptSummaries/annual-email-label-safe-marker-leak')));
    await assertFails(getDoc(doc(priestDb, 'taxReceiptSummaries/annual-email-label-safe-marker-leak')));
    await assertFails(getDoc(doc(treasurerDb, 'taxReceiptSummaries/annual-email-label-safe-marker-leak')));
    const freshPriestDb = dbFor(verifiedContext('priest-1', 'priest@example.com'));
    const freshPriestSummaries = await assertSucceeds(getDocs(query(
      collection(freshPriestDb, 'taxReceiptSummaries'),
      where('churchId', '==', CHURCH_ID),
      where('kind', '==', 'annual'),
      where('donorAnonymous', '==', false),
      where('churchReceiptVisible', '==', true),
      where('donorLabelPublicSafe', '==', true),
      where('receiptManagerSummarySafe', '==', true),
      where('receiptManagerSummarySafeVersion', '==', 2),
      orderBy('issuedAt', 'desc'),
      limit(10)
    )));
    expect(freshPriestSummaries.docs.map((summary) => summary.id)).toContain('annual-profile-required');
    expect(freshPriestSummaries.docs.map((summary) => summary.id)).toContain('annual-verified-email-required');
    expect(freshPriestSummaries.docs.map((summary) => summary.id)).not.toContain('annual-private-field-leak');
    expect(freshPriestSummaries.docs.map((summary) => summary.id)).not.toContain('annual-private-field-safe-marker-leak');
    expect(freshPriestSummaries.docs.map((summary) => summary.id)).not.toContain('annual-email-label-safe-marker-leak');
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(dbFor(context), 'taxReceiptSummaries/annual-alias-private-field-current-marker-leak'), {
        receiptId: 'annual-alias-private-field-current-marker-leak',
        churchId: CHURCH_ID,
        userId: 'member-1',
        kind: 'annual',
        receiptYear: 2025,
        receiptNumber: 'STN-2025-000017',
        status: 'sent',
        donorLabel: 'Member One',
        donorAnonymous: false,
        churchReceiptVisible: true,
        donorLabelPublicSafe: true,
        receiptManagerSummarySafe: true,
        receiptManagerSummarySafeVersion: 2,
        taxReceiptLegalName: 'Member Legal Name',
        taxReceiptAddress: {
          line1: '10 Donor Street',
          city: 'Chicago',
          region: 'IL',
          postalCode: '60601',
          country: 'US',
        },
        issuedBy: 'system',
        pdfTemplateVersion: 'tax-receipt-pdf-v1',
        partialRefundGivingIds: ['giving-private-refund'],
        correctionForGivingId: 'giving-private-correction',
        stripePaymentIntentId: 'pi_live_private',
        stripeCheckoutSessionUrl: 'https://checkout.stripe.com/private/session',
        stripeRefundStatus: 'partially_refunded',
        stripeAmountRefundedCents: 1000,
        stripeConnectAccountId: 'acct_private',
        checkoutSessionExpiresAt: Timestamp.fromDate(new Date('2026-01-15T13:00:00Z')),
        checkoutUrl: 'https://checkout.stripe.com/private/legacy',
        eventId: 'evt_private',
        correctedBy: 'treasurer-1',
        correctionMarkedAt: Timestamp.fromDate(new Date('2026-01-15T13:01:00Z')),
        correctionMarkedBy: 'treasurer-2',
        voidedBy: 'stripe',
        issuedAt: Timestamp.fromDate(new Date('2026-01-15T12:28:00Z')),
      });
    });
    await assertSucceeds(getDoc(doc(memberDb, 'taxReceiptSummaries/annual-alias-private-field-current-marker-leak')));
    await assertFails(getDoc(doc(priestDb, 'taxReceiptSummaries/annual-alias-private-field-current-marker-leak')));
    await assertFails(getDoc(doc(treasurerDb, 'taxReceiptSummaries/annual-alias-private-field-current-marker-leak')));
    await assertFails(setDoc(doc(priestDb, 'taxReceiptSummaries/annual-2'), { churchId: CHURCH_ID }));

    await assertFails(getDoc(doc(memberDb, 'taxReceiptEvents/event-1')));
    await assertFails(getDoc(doc(priestDb, 'taxReceiptEvents/event-1')));
    await assertFails(getDoc(doc(treasurerDb, 'taxReceiptEvents/event-1')));
    await assertFails(getDoc(doc(adminDb, 'taxReceiptEvents/event-1')));
    await assertFails(getDoc(doc(superAdminDb, 'taxReceiptEvents/event-1')));
    await assertFails(setDoc(doc(superAdminDb, 'taxReceiptEvents/event-2'), { churchId: CHURCH_ID }));

    await assertFails(getDoc(doc(memberDb, 'stripeWebhookEvents/evt_checkout_completed')));
    await assertFails(getDoc(doc(priestDb, 'stripeWebhookEvents/evt_checkout_completed')));
    await assertFails(getDoc(doc(treasurerDb, 'stripeWebhookEvents/evt_checkout_completed')));
    await assertFails(getDoc(doc(adminDb, 'stripeWebhookEvents/evt_checkout_completed')));
    await assertFails(getDoc(doc(superAdminDb, 'stripeWebhookEvents/evt_checkout_completed')));
    await assertFails(setDoc(doc(superAdminDb, 'stripeWebhookEvents/evt_manual'), { status: 'processed' }));

    await assertFails(getDoc(doc(memberDb, `churchPaymentSettings/${CHURCH_ID}`)));
    await assertFails(getDoc(doc(priestDb, `churchPaymentSettings/${CHURCH_ID}`)));
    await assertFails(getDoc(doc(treasurerDb, `churchPaymentSettings/${CHURCH_ID}`)));
    await assertFails(getDoc(doc(adminDb, `churchPaymentSettings/${CHURCH_ID}`)));
    await assertFails(getDoc(doc(superAdminDb, `churchPaymentSettings/${CHURCH_ID}`)));
    await assertFails(setDoc(doc(superAdminDb, `churchPaymentSettings/${CHURCH_ID}`), {
      stripeConnectEnabled: false,
    }));
  });

  it('fails closed for receipt-manager giving reads with embedded email-shaped donor labels', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(dbFor(context), 'giving/giving-email-label-visible'), {
        churchId: CHURCH_ID,
        userId: 'member-1',
        anonymous: false,
        churchReceiptVisible: true,
        donorName: 'Contact member@example.com',
        donorEmail: '',
        donorNamePublicSafe: false,
        receiptManagerGivingSafeVersion: 0,
        amount: 60,
        amountCents: 6000,
        currency: 'USD',
        status: 'completed',
        createdAt: Timestamp.fromDate(new Date('2026-05-24T19:00:00Z')),
      });
    });

    const memberDb = dbFor(verifiedContext('member-1', 'member@example.com'));
    const priestDb = dbFor(verifiedContext('priest-1', 'priest@example.com'));
    const treasurerDb = dbFor(verifiedContext('treasurer-1', 'treasurer@example.com'));

    await assertSucceeds(getDoc(doc(memberDb, 'giving/giving-email-label-visible')));
    await assertFails(getDoc(doc(priestDb, 'giving/giving-email-label-visible')));
    await assertFails(getDoc(doc(treasurerDb, 'giving/giving-email-label-visible')));
    const priestGiving = await assertSucceeds(getDocs(query(
      collection(priestDb, 'giving'),
      where('churchId', '==', CHURCH_ID),
      where('anonymous', '==', false),
      where('churchReceiptVisible', '==', true),
      where('donorEmail', '==', ''),
      where('donorNamePublicSafe', '==', true),
      where('receiptManagerGivingSafeVersion', '==', 1),
      where('status', 'in', ['completed', 'refunded']),
      orderBy('createdAt', 'desc'),
      limit(10)
    )));
    expect(priestGiving.docs.map((giving) => giving.id)).not.toContain('giving-email-label-visible');
  });

  it('fails closed for receipt-manager reads with reserved anonymous public labels on non-anonymous rows', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = dbFor(context);
      await Promise.all([
        setDoc(doc(db, 'giving/giving-reserved-anonymous-label'), {
          churchId: CHURCH_ID,
          userId: 'member-1',
          anonymous: false,
          churchReceiptVisible: true,
          donorName: 'Anonymous donor',
          donorEmail: '',
          donorNamePublicSafe: true,
          receiptManagerGivingSafeVersion: 1,
          amount: 60,
          amountCents: 6000,
          currency: 'USD',
          status: 'completed',
          createdAt: Timestamp.fromDate(new Date('2026-05-24T19:05:00Z')),
        }),
        setDoc(doc(db, 'taxReceiptSummaries/annual-reserved-anonymous-label'), {
          receiptId: 'annual-reserved-anonymous-label',
          churchId: CHURCH_ID,
          userId: 'member-1',
          kind: 'annual',
          receiptYear: 2025,
          receiptNumber: 'STN-2025-000018',
          status: 'sent',
          donorLabel: 'Anonymous donor',
          donorAnonymous: false,
          churchReceiptVisible: true,
          donorLabelPublicSafe: true,
          receiptManagerSummarySafe: true,
          receiptManagerSummarySafeVersion: 2,
          issuedAt: Timestamp.fromDate(new Date('2026-01-15T12:27:00Z')),
        }),
      ]);
    });

    const memberDb = dbFor(verifiedContext('member-1', 'member@example.com'));
    const priestDb = dbFor(verifiedContext('priest-1', 'priest@example.com'));
    const treasurerDb = dbFor(verifiedContext('treasurer-1', 'treasurer@example.com'));

    await assertSucceeds(getDoc(doc(memberDb, 'giving/giving-reserved-anonymous-label')));
    await assertFails(getDoc(doc(priestDb, 'giving/giving-reserved-anonymous-label')));
    await assertFails(getDoc(doc(treasurerDb, 'giving/giving-reserved-anonymous-label')));
    await assertSucceeds(getDoc(doc(memberDb, 'taxReceiptSummaries/annual-reserved-anonymous-label')));
    await assertFails(getDoc(doc(priestDb, 'taxReceiptSummaries/annual-reserved-anonymous-label')));
    await assertFails(getDoc(doc(treasurerDb, 'taxReceiptSummaries/annual-reserved-anonymous-label')));
  });

  it('enforces event, newsletter, and post authoring permissions', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = dbFor(context);
      await Promise.all([
        setDoc(doc(db, 'events/event-1'), {
          churchId: CHURCH_ID,
          createdBy: 'admin-1',
          title: 'Liturgy',
          description: 'Sunday service',
          startTime: Timestamp.fromDate(new Date('2026-05-24T10:00:00Z')),
          endTime: Timestamp.fromDate(new Date('2026-05-24T12:00:00Z')),
          location: 'Nave',
          category: 'Divine Liturgy',
          notificationSent: false,
          createdAt: Timestamp.fromDate(new Date('2026-05-17T12:00:00Z')),
        }),
        setDoc(doc(db, 'newsletters/newsletter-published'), {
          churchId: CHURCH_ID,
          title: 'Published Bulletin',
          content: 'Published content',
          excerpt: 'Published',
          status: 'published',
          publishedAt: Timestamp.fromDate(new Date('2026-05-17T12:00:00Z')),
          createdBy: 'admin-1',
          emailSent: false,
          createdAt: Timestamp.fromDate(new Date('2026-05-17T12:00:00Z')),
          updatedAt: Timestamp.fromDate(new Date('2026-05-17T12:00:00Z')),
        }),
        setDoc(doc(db, 'newsletters/newsletter-draft'), {
          churchId: CHURCH_ID,
          title: 'Draft Bulletin',
          content: 'Draft content',
          excerpt: 'Draft',
          status: 'draft',
          publishedAt: null,
          createdBy: 'admin-1',
          emailSent: false,
          createdAt: Timestamp.fromDate(new Date('2026-05-17T12:00:00Z')),
          updatedAt: Timestamp.fromDate(new Date('2026-05-17T12:00:00Z')),
        }),
        setDoc(doc(db, `churches/${CHURCH_ID}/posts/post-published`), {
          churchId: CHURCH_ID,
          authorId: 'admin-1',
          authorName: 'Admin',
          title: 'Published Post',
          contentHtml: '<p>Hello</p>',
          contentJSON: { type: 'doc' },
          status: 'published',
          createdAt: Timestamp.fromDate(new Date('2026-05-17T12:00:00Z')),
          updatedAt: Timestamp.fromDate(new Date('2026-05-17T12:00:00Z')),
          publishedAt: Timestamp.fromDate(new Date('2026-05-17T12:00:00Z')),
        }),
        setDoc(doc(db, `churches/${CHURCH_ID}/posts/post-draft`), {
          churchId: CHURCH_ID,
          authorId: 'admin-1',
          authorName: 'Admin',
          title: 'Draft Post',
          contentHtml: '<p>Hello</p>',
          contentJSON: { type: 'doc' },
          status: 'draft',
          createdAt: Timestamp.fromDate(new Date('2026-05-17T12:00:00Z')),
          updatedAt: Timestamp.fromDate(new Date('2026-05-17T12:00:00Z')),
          publishedAt: null,
        }),
      ]);
    });

    const memberDb = dbFor(verifiedContext('member-1', 'member@example.com'));
    const adminDb = dbFor(verifiedContext('admin-1', 'admin@example.com'));
    const priestDb = dbFor(verifiedContext('priest-1', 'priest@example.com'));
    const eventPayload = {
      churchId: CHURCH_ID,
      createdBy: 'admin-1',
      title: 'Vespers',
      description: 'Evening prayer',
      startTime: Timestamp.fromDate(new Date('2026-05-25T18:00:00Z')),
      endTime: Timestamp.fromDate(new Date('2026-05-25T19:00:00Z')),
      location: 'Nave',
      category: 'Vespers',
      notificationSent: false,
      createdAt: serverTimestamp(),
    };

    await assertSucceeds(getDoc(doc(memberDb, 'events/event-1')));
    await assertFails(setDoc(doc(memberDb, 'events/event-member-create'), {
      ...eventPayload,
      createdBy: 'member-1',
    }));
    await assertSucceeds(setDoc(doc(adminDb, 'events/event-admin-create'), eventPayload));

    await assertSucceeds(getDoc(doc(memberDb, 'newsletters/newsletter-published')));
    await assertFails(getDoc(doc(memberDb, 'newsletters/newsletter-draft')));
    await assertSucceeds(updateDoc(doc(adminDb, 'newsletters/newsletter-draft'), {
      status: 'published',
      publishedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }));
    await assertFails(deleteDoc(doc(adminDb, 'newsletters/newsletter-published')));
    await assertSucceeds(deleteDoc(doc(priestDb, 'newsletters/newsletter-published')));

    await assertSucceeds(getDoc(doc(memberDb, `churches/${CHURCH_ID}/posts/post-published`)));
    await assertFails(getDoc(doc(memberDb, `churches/${CHURCH_ID}/posts/post-draft`)));
    await assertFails(setDoc(doc(memberDb, `churches/${CHURCH_ID}/posts/member-post`), {
      churchId: CHURCH_ID,
      authorId: 'member-1',
      authorName: 'Member',
      title: 'Member Post',
      contentHtml: '<p>Hello</p>',
      contentJSON: { type: 'doc' },
      status: 'draft',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      publishedAt: null,
    }));
    await assertSucceeds(setDoc(doc(adminDb, `churches/${CHURCH_ID}/posts/admin-post`), {
      churchId: CHURCH_ID,
      authorId: 'admin-1',
      authorName: 'Admin',
      title: 'Admin Post',
      contentHtml: '<p>Hello</p>',
      contentJSON: { type: 'doc' },
      status: 'draft',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      publishedAt: null,
    }));

    await testEnv.withSecurityRulesDisabled(async (context) => {
      await updateDoc(doc(dbFor(context), `churches/${CHURCH_ID}`), { isActive: false });
    });

    await assertSucceeds(getDoc(doc(memberDb, `churches/${CHURCH_ID}/members/member-1`)));
    await assertFails(getDoc(doc(memberDb, 'events/event-1')));
    await assertFails(setDoc(doc(adminDb, 'events/event-inactive-create'), {
      ...eventPayload,
      title: 'Inactive Event',
      createdAt: serverTimestamp(),
    }));
    await assertFails(getDoc(doc(memberDb, `churches/${CHURCH_ID}/posts/post-published`)));
    await assertFails(setDoc(doc(adminDb, `churches/${CHURCH_ID}/posts/admin-post-inactive`), {
      churchId: CHURCH_ID,
      authorId: 'admin-1',
      authorName: 'Admin',
      title: 'Inactive Admin Post',
      contentHtml: '<p>Hello</p>',
      contentJSON: { type: 'doc' },
      status: 'draft',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      publishedAt: null,
    }));
  });

  it('protects public event platform docs and keeps ticket private data backend-only', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const adminDb = dbFor(context);
      await setDoc(doc(adminDb, 'eventPortals/serbian-fest'), {
        churchId: CHURCH_ID,
        organizationId: CHURCH_ID,
        organizationType: 'church',
        title: 'Serbian Fest',
        slug: 'serbian-fest',
        status: 'published',
        startsAt: Timestamp.fromDate(new Date('2026-06-01T12:00:00Z')),
        endsAt: Timestamp.fromDate(new Date('2026-06-01T23:00:00Z')),
        venueName: 'Parish Hall',
        venueAddress: '123 Main Street',
        heroImageURL: '',
        description: 'Food, music, and parish fellowship.',
        modules: ['tickets', 'schedule', 'info'],
        focusEnabled: true,
        focusStartsAt: null,
        focusEndsAt: null,
        ticketsEnabled: true,
        gateScanningEnabled: true,
        reEntryEnabled: true,
        foodDrinkEnabled: false,
        foodOrderingEnabled: false,
        campaignsEnabled: false,
        setupChecklist: {
          basics: true,
          tickets: false,
          schedule: false,
          foodDrink: false,
          campaigns: false,
          staff: false,
          payments: false,
        },
      });
      await setDoc(doc(adminDb, 'eventPortals/public-uid-leak'), {
        churchId: CHURCH_ID,
        organizationId: CHURCH_ID,
        organizationType: 'church',
        title: 'UID Leak',
        slug: 'public-uid-leak',
        status: 'published',
        startsAt: Timestamp.fromDate(new Date('2026-06-01T12:00:00Z')),
        endsAt: Timestamp.fromDate(new Date('2026-06-01T23:00:00Z')),
        venueName: 'Parish Hall',
        venueAddress: '123 Main Street',
        heroImageURL: '',
        description: 'This row should not be public because it exposes staff ids.',
        modules: ['schedule', 'info'],
        focusEnabled: false,
        focusStartsAt: null,
        focusEndsAt: null,
        ticketsEnabled: false,
        gateScanningEnabled: false,
        reEntryEnabled: true,
        foodDrinkEnabled: false,
        foodOrderingEnabled: false,
        campaignsEnabled: false,
        setupChecklist: {
          basics: true,
          tickets: false,
          schedule: false,
          foodDrink: false,
          campaigns: false,
          staff: false,
          payments: false,
        },
        createdBy: 'admin-1',
      });
      await setDoc(doc(adminDb, 'eventPortals/event-draft'), {
        churchId: CHURCH_ID,
        organizationId: CHURCH_ID,
        organizationType: 'church',
        title: 'Draft',
        slug: 'draft',
        status: 'draft',
        startsAt: Timestamp.fromDate(new Date('2026-06-01T12:00:00Z')),
        endsAt: Timestamp.fromDate(new Date('2026-06-01T23:00:00Z')),
        focusEnabled: false,
      });
      await setDoc(doc(adminDb, 'eventTicketPrivate/ticket-1'), {
        eventId: 'serbian-fest',
        buyerEmail: 'guest@example.com',
        signedLookupToken: 'private-token',
      });
      await setDoc(doc(adminDb, 'eventTicketScans/scan-1'), {
        eventId: 'serbian-fest',
        ticketId: 'ticket-1',
        result: 'accepted',
      });
      await setDoc(doc(adminDb, 'eventAnnouncements/announcement-1'), {
        eventId: 'serbian-fest',
        churchId: CHURCH_ID,
        title: 'Weather alert',
        body: 'Please take shelter in the tents.',
        priority: 'urgent',
        channels: ['inApp'],
        status: 'sent',
        sentAt: Timestamp.fromDate(new Date('2026-06-01T14:00:00Z')),
        sentByName: 'Event Admin',
      });
      await setDoc(doc(adminDb, 'eventAnnouncements/announcement-private-delivery'), {
        eventId: 'serbian-fest',
        churchId: CHURCH_ID,
        title: 'Delivery leak',
        body: 'This row contains delivery internals.',
        priority: 'info',
        channels: ['inApp', 'email'],
        status: 'sent',
        sentAt: Timestamp.fromDate(new Date('2026-06-01T14:05:00Z')),
        sentByName: 'Event Admin',
        sentBy: 'admin-1',
        deliveryStats: { emailRecipientCount: 10 },
      });
      await setDoc(doc(adminDb, 'eventAnnouncementDelivery/announcement-1'), {
        eventId: 'serbian-fest',
        churchId: CHURCH_ID,
        sentBy: 'admin-1',
        deliveryStats: { emailRecipientCount: 10 },
      });
      await setDoc(doc(adminDb, 'eventTicketTiers/tier-active'), {
        eventId: 'serbian-fest',
        name: 'Admission',
        description: 'General admission',
        priceCents: 1000,
        currency: 'CAD',
        capacity: null,
        perOrderLimit: 8,
        saleStartsAt: null,
        saleEndsAt: null,
        active: true,
      });
      await setDoc(doc(adminDb, 'eventTicketTiers/tier-inactive'), {
        eventId: 'serbian-fest',
        name: 'Hidden Admission',
        description: 'Unpublished price',
        priceCents: 1000,
        currency: 'CAD',
        capacity: null,
        perOrderLimit: 8,
        saleStartsAt: null,
        saleEndsAt: null,
        active: false,
      });
      await setDoc(doc(adminDb, 'eventMenuItems/menu-private-notes'), {
        eventId: 'serbian-fest',
        category: 'Food',
        name: 'Cevapi',
        description: 'Plate',
        priceCents: 1200,
        currency: 'CAD',
        available: true,
        soldOut: false,
        maxPerOrder: 10,
        inventoryMode: 'unlimited',
        quantityAvailable: null,
        quantitySold: 0,
        sortOrder: 0,
        prepNotes: 'Private kitchen note',
      });
      await setDoc(doc(adminDb, 'eventMenuItems/menu-public'), {
        eventId: 'serbian-fest',
        churchId: CHURCH_ID,
        category: 'Food',
        name: 'Cevapi',
        description: 'Plate',
        priceCents: 1200,
        currency: 'CAD',
        available: true,
        soldOut: false,
        maxPerOrder: 10,
        inventoryMode: 'tracked',
        quantityAvailable: 25,
        quantitySold: 3,
        sortOrder: 0,
      });
      await setDoc(doc(adminDb, 'eventMenuItems/menu-sold-out'), {
        eventId: 'serbian-fest',
        churchId: CHURCH_ID,
        category: 'Drink',
        name: 'Knjaz Miloš',
        description: 'Sparkling water',
        priceCents: 300,
        currency: 'CAD',
        available: true,
        soldOut: true,
        maxPerOrder: 10,
        inventoryMode: 'unlimited',
        quantityAvailable: null,
        quantitySold: 0,
        sortOrder: 1,
      });
      await setDoc(doc(adminDb, 'eventOrders/order-1'), {
        eventId: 'serbian-fest',
        churchId: CHURCH_ID,
        orderCode: 'ABC123',
        customerName: 'Guest',
        customerEmail: 'guest@example.com',
        customerPhone: '',
        items: [{ menuItemId: 'menu-public', name: 'Cevapi', quantity: 1, unitPriceCents: 1200, lineTotalCents: 1200 }],
        totalCents: 1200,
        status: 'submitted',
        createdAt: Timestamp.fromDate(new Date('2026-06-01T14:10:00Z')),
      });
      await setDoc(doc(adminDb, 'eventOrderPrivate/order-1'), {
        eventId: 'serbian-fest',
        customerEmail: 'guest@example.com',
      });
    });

    const publicDb = dbFor(unauthenticatedContext());
    const memberDb = dbFor(verifiedContext('member-1', 'member@example.com'));
    const adminDb = dbFor(verifiedContext('admin-1', 'admin@example.com'));

    await assertSucceeds(getDoc(doc(publicDb, 'eventPortals/serbian-fest')));
    await assertFails(getDoc(doc(publicDb, 'eventPortals/public-uid-leak')));
    await assertSucceeds(getDoc(doc(publicDb, 'eventAnnouncements/announcement-1')));
    await assertFails(getDoc(doc(publicDb, 'eventAnnouncements/announcement-private-delivery')));
    await assertFails(getDoc(doc(publicDb, 'eventAnnouncementDelivery/announcement-1')));
    await assertFails(getDoc(doc(adminDb, 'eventAnnouncementDelivery/announcement-1')));
    await assertSucceeds(getDoc(doc(publicDb, 'eventTicketTiers/tier-active')));
    await assertFails(getDoc(doc(publicDb, 'eventTicketTiers/tier-inactive')));
    await assertSucceeds(getDoc(doc(publicDb, 'eventMenuItems/menu-public')));
    await assertSucceeds(getDoc(doc(publicDb, 'eventMenuItems/menu-sold-out')));
    await assertFails(getDoc(doc(publicDb, 'eventMenuItems/menu-private-notes')));
    await assertFails(getDoc(doc(publicDb, 'eventPortals/event-draft')));
    await assertFails(getDoc(doc(publicDb, 'eventTicketPrivate/ticket-1')));
    await assertFails(getDoc(doc(memberDb, 'eventTicketPrivate/ticket-1')));
    await assertFails(getDoc(doc(publicDb, 'eventOrders/order-1')));
    await assertSucceeds(getDoc(doc(adminDb, 'eventOrders/order-1')));
    await assertFails(getDoc(doc(adminDb, 'eventOrderPrivate/order-1')));
    await assertFails(setDoc(doc(adminDb, 'eventOrders/order-forged'), {
      eventId: 'serbian-fest',
      status: 'submitted',
    }));
    await assertSucceeds(getDoc(doc(adminDb, 'eventTicketScans/scan-1')));
    await assertFails(setDoc(doc(adminDb, 'eventTicketScans/scan-2'), {
      eventId: 'serbian-fest',
      ticketId: 'ticket-1',
      result: 'accepted',
    }));
    await assertFails(setDoc(doc(adminDb, 'eventAnnouncements/admin-forged'), {
      eventId: 'serbian-fest',
      churchId: CHURCH_ID,
      title: 'Forged',
      body: 'No direct writes.',
      status: 'sent',
    }));
    await assertFails(setDoc(doc(memberDb, 'eventPortals/member-created'), {
      churchId: CHURCH_ID,
      organizationId: CHURCH_ID,
      organizationType: 'church',
      title: 'Member Event',
      slug: 'member-event',
      status: 'draft',
      startsAt: Timestamp.fromDate(new Date('2026-06-01T12:00:00Z')),
      endsAt: Timestamp.fromDate(new Date('2026-06-01T23:00:00Z')),
    }));
    await assertFails(setDoc(doc(adminDb, 'eventPortals/admin-created'), {
      churchId: CHURCH_ID,
      organizationId: CHURCH_ID,
      organizationType: 'church',
      title: 'Admin Event',
      slug: 'admin-event',
      status: 'draft',
      startsAt: Timestamp.fromDate(new Date('2026-06-01T12:00:00Z')),
      endsAt: Timestamp.fromDate(new Date('2026-06-01T23:00:00Z')),
    }));
  });
});

describe('Storage rules', () => {
  it('allows constrained owner avatar uploads only', async () => {
    const ownerStorage = storageFor(verifiedContext('member-1', 'member@example.com'));
    const otherStorage = storageFor(verifiedContext('member-2', 'member2@example.com'));
    const avatarPath = 'users/member-1/avatar/avatar-valid.webp';

    await assertSucceeds(
      uploadString(ref(ownerStorage, avatarPath), 'image-data', 'raw', {
        contentType: 'image/webp',
        customMetadata: { ownerUid: 'member-1' },
      })
    );
    await assertFails(
      uploadString(ref(otherStorage, 'users/member-1/avatar/avatar-other.webp'), 'image-data', 'raw', {
        contentType: 'image/webp',
        customMetadata: { ownerUid: 'member-2' },
      })
    );
    await assertFails(
      uploadString(ref(ownerStorage, 'users/member-1/avatar/not-avatar.webp'), 'image-data', 'raw', {
        contentType: 'image/webp',
        customMetadata: { ownerUid: 'member-1' },
      })
    );
    await assertFails(
      uploadString(ref(ownerStorage, 'users/member-1/avatar/avatar-valid.txt'), 'text', 'raw', {
        contentType: 'text/plain',
        customMetadata: { ownerUid: 'member-1' },
      })
    );
  });

  it('enforces post attachment roles and member reads', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = dbFor(context);
      await setDoc(doc(db, `churches/${CHURCH_ID}/posts/post-1`), {
        churchId: CHURCH_ID,
        authorId: 'admin-1',
        authorName: 'Admin',
        title: 'Attachment Post',
        contentHtml: '<p>Hello</p>',
        contentJSON: { type: 'doc' },
        status: 'published',
        createdAt: Timestamp.fromDate(new Date('2026-05-17T12:00:00Z')),
        updatedAt: Timestamp.fromDate(new Date('2026-05-17T12:00:00Z')),
        publishedAt: Timestamp.fromDate(new Date('2026-05-17T12:00:00Z')),
      });
    });

    const adminStorage = storageFor(verifiedContext('admin-1', 'admin@example.com'));
    const memberStorage = storageFor(verifiedContext('member-1', 'member@example.com'));
    const guestStorage = storageFor(anonymousContext());
    const attachmentPath = `churches/${CHURCH_ID}/posts/post-1/bulletin.pdf`;

    await assertSucceeds(
      uploadString(ref(adminStorage, attachmentPath), 'pdf-data', 'raw', {
        contentType: 'application/pdf',
      })
    );
    await assertSucceeds(getMetadata(ref(memberStorage, attachmentPath)));
    await assertFails(getMetadata(ref(guestStorage, attachmentPath)));
    await assertFails(
      uploadString(ref(memberStorage, `churches/${CHURCH_ID}/posts/post-1/member.pdf`), 'pdf-data', 'raw', {
        contentType: 'application/pdf',
      })
    );
    await assertFails(
      uploadString(ref(adminStorage, `churches/${CHURCH_ID}/posts/missing-post/file.pdf`), 'pdf-data', 'raw', {
        contentType: 'application/pdf',
      })
    );

    await testEnv.withSecurityRulesDisabled(async (context) => {
      await updateDoc(doc(dbFor(context), `churches/${CHURCH_ID}`), { isActive: false });
    });

    await assertFails(getMetadata(ref(memberStorage, attachmentPath)));
    await assertFails(
      uploadString(ref(adminStorage, `churches/${CHURCH_ID}/posts/post-1/inactive.pdf`), 'pdf-data', 'raw', {
        contentType: 'application/pdf',
      })
    );
  });

  it('keeps retained tax receipt PDFs backend-only for every client role', async () => {
    const receiptPdfPath = `taxReceipts/${CHURCH_ID}/2026/giving-tax-1.pdf`;
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await uploadString(ref(storageFor(context), receiptPdfPath), '%PDF-1.7 retained tax receipt', 'raw', {
        contentType: 'application/pdf',
        customMetadata: {
          retentionPurpose: 'official_tax_receipt_copy',
          receiptId: 'giving-tax-1',
        },
      });
    });

    const memberStorage = storageFor(verifiedContext('member-1', 'member@example.com'));
    const priestStorage = storageFor(verifiedContext('priest-1', 'priest@example.com'));
    const treasurerStorage = storageFor(verifiedContext('treasurer-1', 'treasurer@example.com'));
    const adminStorage = storageFor(verifiedContext('admin-1', 'admin@example.com'));
    const superAdminStorage = storageFor(verifiedContext('super-1', 'super@example.com', { superAdmin: true }));
    const guestStorage = storageFor(anonymousContext());
    const publicStorage = storageFor(unauthenticatedContext());

    await assertFails(getMetadata(ref(memberStorage, receiptPdfPath)));
    await assertFails(getMetadata(ref(priestStorage, receiptPdfPath)));
    await assertFails(getMetadata(ref(treasurerStorage, receiptPdfPath)));
    await assertFails(getMetadata(ref(adminStorage, receiptPdfPath)));
    await assertFails(getMetadata(ref(superAdminStorage, receiptPdfPath)));
    await assertFails(getMetadata(ref(guestStorage, receiptPdfPath)));
    await assertFails(getMetadata(ref(publicStorage, receiptPdfPath)));
    await assertFails(
      uploadString(ref(memberStorage, receiptPdfPath), '%PDF-1.7 donor overwrite', 'raw', {
        contentType: 'application/pdf',
      })
    );
    await assertFails(
      uploadString(ref(priestStorage, `taxReceipts/${CHURCH_ID}/2026/priest-write.pdf`), '%PDF-1.7 priest', 'raw', {
        contentType: 'application/pdf',
      })
    );
  });
});
