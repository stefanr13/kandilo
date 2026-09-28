import { onCall } from 'firebase-functions/v2/https';
import { db } from '../shared/firebase';
import { assertNonAnonymousUser, checkRateLimit } from '../shared/security';

const DISCOVER_CHURCH_LIMIT = 100;

function safeString(value: unknown, maxLength: number): string {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function churchLocation(data: FirebaseFirestore.DocumentData): string {
  const legacyLocation = safeString(data.location, 160);
  if (legacyLocation) {
    return legacyLocation;
  }

  const city = safeString(data.city, 80);
  const state = safeString(data.state, 80);
  if (city && state) {
    return `${city}, ${state}`;
  }
  return city || state;
}

export const listActiveChurches = onCall({ invoker: 'public' }, async (request) => {
  assertNonAnonymousUser(request, 'A non-anonymous account is required to browse churches.');
  await checkRateLimit(request.auth!.uid, 'listActiveChurches', 60, 60 * 1000);

  const snapshot = await db
    .collection('churches')
    .where('isActive', '==', true)
    .limit(DISCOVER_CHURCH_LIMIT)
    .get();

  const churches = snapshot.docs
    .map((doc) => {
      const data = doc.data();
      return {
        id: doc.id,
        name: safeString(data.name, 160),
        location: churchLocation(data),
        imageURL: safeString(data.imageURL, 1000),
        contactEmail: safeString(data.contactEmail, 254),
        phone: safeString(data.phone, 80),
        isVerified: data.isVerified === true,
        isActive: true,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  return { churches };
});
