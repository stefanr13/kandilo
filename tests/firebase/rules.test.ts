import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestContext,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import {
  deleteDoc,
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
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
  role: 'priest' | 'admin' | 'member';
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
  role: 'priest' | 'admin' | 'member';
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
  it('protects user profiles behind verified non-anonymous ownership', async () => {
    const ownerDb = dbFor(verifiedContext('member-1', 'member@example.com'));
    const otherDb = dbFor(verifiedContext('member-2', 'member2@example.com'));
    const guestDb = dbFor(anonymousContext());
    const ownerRef = doc(ownerDb, 'users/member-1');

    await assertSucceeds(getDoc(ownerRef));
    await assertFails(getDoc(doc(otherDb, 'users/member-1')));
    await assertFails(getDoc(doc(guestDb, 'users/member-1')));

    await assertSucceeds(
      updateDoc(ownerRef, {
        displayName: 'Updated Member',
        preferredLanguage: 'Română',
      })
    );
    await assertFails(updateDoc(ownerRef, { email: 'changed@example.com' }));
  });

  it('keeps membership reads and updates scoped by role', async () => {
    const memberDb = dbFor(verifiedContext('member-1', 'member@example.com'));
    const adminDb = dbFor(verifiedContext('admin-1', 'admin@example.com'));
    const priestDb = dbFor(verifiedContext('priest-1', 'priest@example.com'));
    const memberRefForMember = doc(memberDb, `churches/${CHURCH_ID}/members/member-1`);
    const hiddenMemberRefForMember = doc(memberDb, `churches/${CHURCH_ID}/members/member-2`);
    const memberRefForAdmin = doc(adminDb, `churches/${CHURCH_ID}/members/member-1`);
    const fanoutRefForAdmin = doc(adminDb, `users/member-1/churchMemberships/${CHURCH_ID}`);
    const memberRefForPriest = doc(priestDb, `churches/${CHURCH_ID}/members/member-1`);

    await assertSucceeds(getDoc(memberRefForMember));
    await assertFails(getDoc(hiddenMemberRefForMember));
    await assertSucceeds(getDoc(memberRefForAdmin));
    await assertFails(getDoc(doc(unauthenticatedContext().firestore(), `churches/${CHURCH_ID}/members/member-1`)));

    await assertSucceeds(updateDoc(memberRefForMember, { phone: '555-0100' }));
    await assertFails(updateDoc(memberRefForMember, { role: 'admin' }));

    await assertSucceeds(updateDoc(memberRefForAdmin, { status: 'suspended' }));
    await assertSucceeds(updateDoc(fanoutRefForAdmin, { status: 'suspended' }));
    await assertFails(updateDoc(memberRefForAdmin, { role: 'admin' }));

    await assertSucceeds(updateDoc(memberRefForPriest, { role: 'admin' }));
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

    await assertSucceeds(deleteDoc(doc(memberDb, `churches/${CHURCH_ID}/members/member-1`)));
    await assertSucceeds(deleteDoc(doc(memberDb, `users/member-1/churchMemberships/${CHURCH_ID}`)));
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
          amount: 50,
          amountCents: 5000,
          currency: 'USD',
          status: 'completed',
        }),
      ]);
    });

    const inviteeDb = dbFor(verifiedContext('invitee-1', 'invitee@example.com'));
    const memberDb = dbFor(verifiedContext('member-1', 'member@example.com'));
    const adminDb = dbFor(verifiedContext('admin-1', 'admin@example.com'));
    const priestDb = dbFor(verifiedContext('priest-1', 'priest@example.com'));

    await assertSucceeds(getDoc(doc(inviteeDb, 'invitations/invite-1')));
    await assertSucceeds(getDoc(doc(adminDb, 'invitations/invite-1')));
    await assertFails(getDoc(doc(memberDb, 'invitations/invite-1')));
    await assertFails(setDoc(doc(adminDb, 'invitations/invite-2'), { churchId: CHURCH_ID }));

    await assertSucceeds(getDoc(doc(memberDb, 'giving/giving-1')));
    await assertSucceeds(getDoc(doc(priestDb, 'giving/giving-1')));
    await assertFails(getDoc(doc(adminDb, 'giving/giving-1')));
    await assertFails(setDoc(doc(memberDb, 'giving/giving-2'), { churchId: CHURCH_ID }));
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
  });
});
