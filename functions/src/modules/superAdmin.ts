import { AggregateField, FieldValue } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { logAuditEvent } from '../shared/audit';
import { auth, db } from '../shared/firebase';
import {
  appCheckCallableOptions,
  assertFreshAppCheck,
  assertSuperAdmin,
  replayProtectedCallableOptions,
} from '../shared/security';
import {
  assertEmail,
  assertHttpsUrl,
  assertMaxLength,
  assertNonEmptyString,
} from '../shared/validation';

function optionalString(value: unknown, max: number, field: string): string {
  if (value === undefined || value === null || value === '') {
    return '';
  }
  if (typeof value !== 'string') {
    throw new HttpsError('invalid-argument', `${field} must be a string.`);
  }
  const trimmed = value.trim();
  assertMaxLength(trimmed, max, field);
  return trimmed;
}

function optionalFiniteNumber(value: unknown, field: string): number {
  if (value === undefined || value === null || value === '') {
    return 0;
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new HttpsError('invalid-argument', `${field} must be a finite number.`);
  }
  return value;
}

function optionalLanguageList(value: unknown): string[] {
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value) || value.length > 20) {
    throw new HttpsError('invalid-argument', 'languages must contain at most 20 entries.');
  }
  return value
    .map((lang) => optionalString(lang, 50, 'languages entry'))
    .filter(Boolean);
}

async function getQueryCount(query: FirebaseFirestore.Query): Promise<number> {
  const snap = await query.count().get();
  return snap.data().count;
}

async function getQuerySum(query: FirebaseFirestore.Query, field: string): Promise<number> {
  const snap = await query.aggregate({ total: AggregateField.sum(field) }).get();
  const value = snap.data().total;
  return Number.isFinite(value) ? value : 0;
}

export const getSuperAdminStats = onCall({ ...appCheckCallableOptions, secrets: [] }, async (request) => {
  assertSuperAdmin(request);

  const churchesSnap = await db.collection('churches').limit(200).get();
  const stats = await Promise.all(
    churchesSnap.docs.map(async (churchDoc) => {
      const c = churchDoc.data();
      const churchId = churchDoc.id;

      const membersQuery = db.collection('churches').doc(churchId).collection('members');
      const eventsQuery = db.collection('events').where('churchId', '==', churchId);
      const newslettersQuery = db.collection('newsletters').where('churchId', '==', churchId);
      const completedGivingQuery = db
        .collection('giving')
        .where('churchId', '==', churchId)
        .where('status', '==', 'completed');

      const [memberCount, priestCount, adminCount, eventCount, newsletterCount, donationTotal] = await Promise.all([
        getQueryCount(membersQuery),
        getQueryCount(membersQuery.where('role', '==', 'priest')),
        getQueryCount(membersQuery.where('role', '==', 'admin')),
        getQueryCount(eventsQuery),
        getQueryCount(newslettersQuery),
        getQuerySum(completedGivingQuery, 'amount'),
      ]);

      return {
        churchId,
        name: c.name ?? '',
        city: c.city ?? '',
        state: c.state ?? '',
        denomination: c.denomination ?? '',
        isActive: c.isActive !== false,
        isVerified: c.isVerified ?? false,
        foundedYear: c.foundedYear ?? 0,
        memberCount,
        priestCount,
        adminCount,
        donationTotal,
        eventCount,
        newsletterCount,
        imageURL: c.imageURL ?? '',
      };
    })
  );

  return { stats };
});

export const createChurch = onCall({ ...replayProtectedCallableOptions, secrets: [] }, async (request) => {
  assertFreshAppCheck(request);
  assertSuperAdmin(request);

  const data = request.data as {
    name: string;
    denomination: string;
    jurisdiction: string;
    diocese: string;
    foundedYear: number;
    about: string;
    languages: string[];
    address: string;
    city: string;
    state: string;
    country: string;
    postalCode: string;
    latitude: number;
    longitude: number;
    timezone: string;
    phone: string;
    contactEmail: string;
    website: string;
    imageURL: string;
    coverImageURL: string;
  };

  const name = assertNonEmptyString(data.name, 200, 'name');
  const city = assertNonEmptyString(data.city, 100, 'city');
  const contactEmail = assertEmail(
    assertNonEmptyString(data.contactEmail, 254, 'contactEmail'),
    'contactEmail'
  );
  const denomination = optionalString(data.denomination, 200, 'denomination');
  const jurisdiction = optionalString(data.jurisdiction, 300, 'jurisdiction');
  const diocese = optionalString(data.diocese, 300, 'diocese');
  const foundedYear = optionalFiniteNumber(data.foundedYear, 'foundedYear');
  const about = optionalString(data.about, 5000, 'about');
  const languages = optionalLanguageList(data.languages);
  const address = optionalString(data.address, 500, 'address');
  const state = optionalString(data.state, 100, 'state');
  const country = optionalString(data.country, 10, 'country');
  const postalCode = optionalString(data.postalCode, 20, 'postalCode');
  const latitude = optionalFiniteNumber(data.latitude, 'latitude');
  const longitude = optionalFiniteNumber(data.longitude, 'longitude');
  const timezone = optionalString(data.timezone, 50, 'timezone');
  const phone = optionalString(data.phone, 30, 'phone');
  const website = optionalString(data.website, 2000, 'website');
  const imageURL = optionalString(data.imageURL, 2000, 'imageURL');
  const coverImageURL = optionalString(data.coverImageURL, 2000, 'coverImageURL');

  if (website) assertHttpsUrl(website, 'website');
  if (imageURL) assertHttpsUrl(imageURL, 'imageURL');
  if (coverImageURL) assertHttpsUrl(coverImageURL, 'coverImageURL');

  if (foundedYear !== 0 && (!Number.isInteger(foundedYear) || foundedYear < 1 || foundedYear > 3000)) {
    throw new HttpsError('invalid-argument', 'foundedYear must be a valid year.');
  }
  if (latitude !== 0 && (latitude < -90 || latitude > 90)) {
    throw new HttpsError('invalid-argument', 'latitude must be between -90 and 90.');
  }
  if (longitude !== 0 && (longitude < -180 || longitude > 180)) {
    throw new HttpsError('invalid-argument', 'longitude must be between -180 and 180.');
  }

  const slug = `${name} ${city}`
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 60);

  let finalId = slug;
  let attempt = 0;
  while ((await db.collection('churches').doc(finalId).get()).exists) {
    attempt++;
    finalId = `${slug}-${attempt}`;
  }

  await db.collection('churches').doc(finalId).set({
    name,
    denomination,
    jurisdiction,
    diocese,
    foundedYear,
    about,
    languages,
    address,
    city,
    state,
    country,
    postalCode,
    latitude,
    longitude,
    timezone,
    phone,
    contactEmail,
    website,
    imageURL,
    coverImageURL,
    clergy: [],
    serviceSchedule: [],
    socialMedia: { instagram: '', facebook: '', youtube: '' },
    isActive: true,
    isVerified: false,
    createdAt: FieldValue.serverTimestamp(),
    createdBy: request.auth!.uid,
  });

  await logAuditEvent(request.auth!.uid, 'createChurch', { churchId: finalId, name });

  return { success: true, churchId: finalId };
});

export const setChurchActiveState = onCall({ ...replayProtectedCallableOptions, secrets: [] }, async (request) => {
  assertFreshAppCheck(request);
  assertSuperAdmin(request);

  const { churchId, isActive } = request.data as { churchId: string; isActive: boolean };
  if (!churchId || typeof isActive !== 'boolean') {
    throw new HttpsError('invalid-argument', 'churchId and isActive (boolean) are required.');
  }

  const churchRef = db.collection('churches').doc(churchId);
  const snap = await churchRef.get();
  if (!snap.exists) {
    throw new HttpsError('not-found', 'Church not found.');
  }

  await churchRef.update({ isActive });
  await logAuditEvent(request.auth!.uid, 'setChurchActiveState', { churchId, isActive });

  return { success: true, churchId, isActive };
});

export const assignChurchMembershipAsSuperAdmin = onCall({ ...replayProtectedCallableOptions, secrets: [] }, async (request) => {
  assertFreshAppCheck(request);
  assertSuperAdmin(request);

  const { churchId: rawChurchId, email: rawEmail, role: rawRole } = request.data as {
    churchId: unknown;
    email: unknown;
    role: unknown;
  };
  const churchId = assertNonEmptyString(rawChurchId, 128, 'churchId');
  const email = assertEmail(assertNonEmptyString(rawEmail, 254, 'email'), 'email');

  if (rawRole !== 'priest' && rawRole !== 'admin' && rawRole !== 'member') {
    throw new HttpsError('invalid-argument', 'role must be priest, admin, or member.');
  }
  const role = rawRole as 'priest' | 'admin' | 'member';

  const [churchDoc, targetUser] = await Promise.all([
    db.collection('churches').doc(churchId).get(),
    auth.getUserByEmail(email).catch((error) => {
      if ((error as { code?: string }).code === 'auth/user-not-found') {
        return null;
      }
      throw error;
    }),
  ]);

  if (!churchDoc.exists) {
    throw new HttpsError('not-found', 'Church not found.');
  }
  if (!targetUser) {
    throw new HttpsError('not-found', 'No Kandilo user exists for that email address.');
  }
  if (targetUser.disabled) {
    throw new HttpsError('failed-precondition', 'Cannot assign a disabled user.');
  }

  const church = churchDoc.data()!;
  const now = FieldValue.serverTimestamp();
  const location =
    [church.city, church.state].filter((value) => typeof value === 'string' && value).join(', ') ||
    church.location ||
    '';
  const displayName = targetUser.displayName ?? targetUser.email ?? email;
  const photoURL = targetUser.photoURL ?? '';

  const memberRef = db.collection('churches').doc(churchId).collection('members').doc(targetUser.uid);
  const userMembershipRef = db
    .collection('users')
    .doc(targetUser.uid)
    .collection('churchMemberships')
    .doc(churchId);
  const [existingMember, existingUserMembership] = await Promise.all([
    memberRef.get(),
    userMembershipRef.get(),
  ]);

  const batch = db.batch();
  batch.set(
    memberRef,
    {
      userId: targetUser.uid,
      churchId,
      role,
      status: 'active',
      displayName,
      email: targetUser.email ?? email,
      photoURL,
      joinedAt: existingMember.data()?.joinedAt ?? now,
      assignedBy: request.auth!.uid,
      updatedAt: now,
    },
    { merge: true }
  );
  batch.set(
    userMembershipRef,
    {
      churchId,
      churchName: church.name ?? '',
      location,
      imageURL: church.imageURL ?? '',
      role,
      status: 'active',
      joinedAt: existingUserMembership.data()?.joinedAt ?? now,
      assignedBy: request.auth!.uid,
      updatedAt: now,
    },
    { merge: true }
  );
  await batch.commit();

  await logAuditEvent(request.auth!.uid, 'assignChurchMembershipAsSuperAdmin', {
    churchId,
    targetUid: targetUser.uid,
    role,
  });

  return {
    success: true,
    churchId,
    uid: targetUser.uid,
    email: targetUser.email ?? email,
    role,
    emailVerified: targetUser.emailVerified,
  };
});

export const updateChurchAsSuperAdmin = onCall({ ...replayProtectedCallableOptions, secrets: [] }, async (request) => {
  assertFreshAppCheck(request);
  assertSuperAdmin(request);

  const { churchId, updates } = request.data as {
    churchId: string;
    updates: Record<string, unknown>;
  };

  if (!churchId || !updates || typeof updates !== 'object') {
    throw new HttpsError('invalid-argument', 'churchId and updates object are required.');
  }

  const CHURCH_UPDATABLE_FIELDS = new Set([
    'name', 'denomination', 'jurisdiction', 'diocese', 'foundedYear', 'about', 'languages',
    'address', 'city', 'state', 'country', 'postalCode', 'latitude', 'longitude', 'timezone',
    'phone', 'contactEmail', 'website', 'imageURL', 'coverImageURL',
    'clergy', 'serviceSchedule', 'socialMedia',
    'isActive', 'isVerified',
  ]);

  const safeUpdates = Object.fromEntries(
    Object.entries(updates as Record<string, unknown>).filter(([key]) => CHURCH_UPDATABLE_FIELDS.has(key))
  );

  if (Object.keys(safeUpdates).length === 0) {
    throw new HttpsError('invalid-argument', 'No updatable fields provided.');
  }

  const stringFieldLimits: Record<string, number> = {
    name: 200, denomination: 200, jurisdiction: 300, diocese: 300, about: 5000,
    address: 500, city: 100, state: 100, country: 10, postalCode: 20,
    timezone: 50, phone: 30, contactEmail: 254, website: 2000, imageURL: 2000, coverImageURL: 2000,
  };
  for (const [key, value] of Object.entries(safeUpdates)) {
    if (key in stringFieldLimits) {
      assertMaxLength(value, stringFieldLimits[key], key);
    }
  }
  if ('contactEmail' in safeUpdates && typeof safeUpdates.contactEmail === 'string') {
    safeUpdates.contactEmail = assertEmail(safeUpdates.contactEmail, 'contactEmail');
  }
  for (const key of ['website', 'imageURL', 'coverImageURL']) {
    const value = safeUpdates[key];
    if (typeof value === 'string' && value) {
      safeUpdates[key] = assertHttpsUrl(value, key);
    }
  }
  if ('languages' in safeUpdates) {
    if (!Array.isArray(safeUpdates.languages) || safeUpdates.languages.length > 20) {
      throw new HttpsError('invalid-argument', 'languages must contain at most 20 entries.');
    }
    for (const lang of safeUpdates.languages) {
      assertMaxLength(lang, 50, 'languages entry');
    }
  }
  if ('latitude' in safeUpdates && typeof safeUpdates.latitude === 'number'
    && (safeUpdates.latitude < -90 || safeUpdates.latitude > 90)) {
    throw new HttpsError('invalid-argument', 'latitude must be between -90 and 90.');
  }
  if ('longitude' in safeUpdates && typeof safeUpdates.longitude === 'number'
    && (safeUpdates.longitude < -180 || safeUpdates.longitude > 180)) {
    throw new HttpsError('invalid-argument', 'longitude must be between -180 and 180.');
  }

  const churchRef = db.collection('churches').doc(churchId);
  if (!(await churchRef.get()).exists) {
    throw new HttpsError('not-found', 'Church not found.');
  }

  await churchRef.update(safeUpdates);
  await logAuditEvent(request.auth!.uid, 'updateChurchAsSuperAdmin', { churchId, fields: Object.keys(safeUpdates) });

  return { success: true };
});

export const promoteSuperAdmin = onCall({ ...replayProtectedCallableOptions, secrets: [] }, async (request) => {
  assertFreshAppCheck(request);
  assertSuperAdmin(request);

  const { targetUid } = request.data as { targetUid: string };
  if (!targetUid) {
    throw new HttpsError('invalid-argument', 'targetUid is required.');
  }

  const targetUser = await auth.getUser(targetUid);
  if (targetUser.disabled) {
    throw new HttpsError('failed-precondition', 'Cannot promote a disabled user.');
  }
  if (!targetUser.emailVerified) {
    throw new HttpsError('failed-precondition', 'Target user must have a verified email address.');
  }
  const existing = targetUser.customClaims ?? {};
  await auth.setCustomUserClaims(targetUid, { ...existing, superAdmin: true });

  await logAuditEvent(request.auth!.uid, 'promoteSuperAdmin', { targetUid });

  return { success: true };
});
