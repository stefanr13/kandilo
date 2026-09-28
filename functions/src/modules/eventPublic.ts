import { Timestamp } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { db } from '../shared/firebase';
import { appCheckCallableOptions } from '../shared/security';
import { callableDataRecord } from '../shared/validation';

// Public responses are explicit projections. Never return complete Admin SDK
// documents: legacy rows may contain staff notes or delivery/customer metadata.
const PORTAL_FIELDS = ['organizationId', 'organizationType', 'churchId', 'title', 'slug', 'status',
  'startsAt', 'endsAt', 'venueName', 'venueAddress', 'heroImageURL', 'description', 'modules',
  'focusEnabled', 'focusStartsAt', 'focusEndsAt', 'ticketsEnabled', 'gateScanningEnabled',
  'reEntryEnabled', 'foodDrinkEnabled', 'foodOrderingEnabled', 'campaignsEnabled'];
const SECTIONS = {
  ticketTiers: { collection: 'eventTicketTiers', flag: 'active', value: true, fields: ['eventId', 'name', 'description', 'priceCents', 'currency', 'capacity', 'perOrderLimit', 'saleStartsAt', 'saleEndsAt', 'active'] },
  scheduleItems: { collection: 'eventScheduleItems', flag: 'published', value: true, fields: ['eventId', 'title', 'description', 'startTime', 'endTime', 'stage', 'location', 'performerIds', 'imageURL', 'published'] },
  performers: { collection: 'eventPerformers', flag: 'published', value: true, fields: ['eventId', 'name', 'subtitle', 'description', 'imageURL', 'links', 'published'] },
  menuItems: { collection: 'eventMenuItems', flag: 'available', value: true, fields: ['eventId', 'category', 'name', 'description', 'priceCents', 'currency', 'available', 'soldOut', 'maxPerOrder', 'inventoryMode', 'quantityAvailable', 'sortOrder'] },
  campaigns: { collection: 'eventCampaigns', flag: 'active', value: true, fields: ['eventId', 'title', 'description', 'suggestedAmountCents', 'active'] },
  announcements: { collection: 'eventAnnouncements', flag: 'status', value: 'sent', fields: ['eventId', 'churchId', 'title', 'body', 'priority', 'channels', 'sentByName', 'sentAt', 'status'] },
} as const;

function publicRecord(doc: FirebaseFirestore.DocumentSnapshot, fields: readonly string[]): Record<string, unknown> {
  const data = doc.data() ?? {};
  const result: Record<string, unknown> = { id: doc.id };
  for (const field of fields) {
    const value = data[field];
    if (value instanceof Timestamp) result[field] = value.toDate().toISOString();
    else if (value === null || ['string', 'boolean', 'number'].includes(typeof value)) result[field] = value;
    else if (Array.isArray(value)) result[field] = value.filter((item) => typeof item === 'string');
  }
  return result;
}

function eventId(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/.test(value)) {
    throw new HttpsError('invalid-argument', 'Event link is not valid.');
  }
  return value;
}

export const getPublicEventContent = onCall(appCheckCallableOptions, async (request) => {
  const id = eventId(callableDataRecord(request.data).eventId);
  const portalRef = db.collection('eventPortals').doc(id);
  return db.runTransaction(async (tx) => {
    const portal = await tx.get(portalRef);
    const data = portal.data();
    if (!data || data.status !== 'published' || data.slug !== id || typeof data.churchId !== 'string') {
      return { portal: null };
    }
    const church = await tx.get(db.collection('churches').doc(data.churchId));
    if (church.data()?.isActive !== true) return { portal: null };

    const sections = await Promise.all(Object.entries(SECTIONS).map(async ([name, section]) => {
      let query = db.collection(section.collection).where('eventId', '==', id)
        .where(section.flag, '==', section.value);
      if (name === 'announcements') query = query.orderBy('sentAt', 'desc');
      const snapshot = await tx.get(query.limit(name === 'announcements' ? 10 : 500));
      return [name, snapshot.docs.map((doc) => publicRecord(doc, section.fields))] as const;
    }));
    return { portal: publicRecord(portal, PORTAL_FIELDS), ...Object.fromEntries(sections) };
  });
});

export const getFeaturedEventPortals = onCall(appCheckCallableOptions, async (request) => {
  const { churchIds } = callableDataRecord(request.data);
  if (!Array.isArray(churchIds) || churchIds.length > 10
    || churchIds.some((id) => typeof id !== 'string' || !id || id.length > 128 || id.includes('/'))) {
    throw new HttpsError('invalid-argument', 'Choose up to 10 valid churches.');
  }
  if (!churchIds.length) return { portals: [] };
  const churches = await db.getAll(...churchIds.map((id) => db.collection('churches').doc(id)));
  const activeIds = churches.filter((doc) => doc.data()?.isActive === true).map((doc) => doc.id);
  if (!activeIds.length) return { portals: [] };
  const snapshot = await db.collection('eventPortals').where('churchId', 'in', activeIds)
    .where('status', '==', 'published').where('focusEnabled', '==', true)
    .where('startsAt', '<=', Timestamp.fromMillis(Date.now() + 14 * 24 * 60 * 60 * 1000))
    .orderBy('startsAt', 'desc').limit(100).get();
  const now = Date.now();
  return { portals: snapshot.docs.filter((doc) => {
    const data = doc.data();
    const start = data.focusStartsAt ?? data.startsAt;
    const end = data.focusEndsAt ?? data.endsAt;
    return data.slug === doc.id && start instanceof Timestamp && end instanceof Timestamp
      && start.toMillis() <= now && end.toMillis() >= now;
  }).map((doc) => publicRecord(doc, PORTAL_FIELDS)) };
});
