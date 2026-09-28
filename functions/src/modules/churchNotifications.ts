import { createHash } from 'node:crypto';
import { FieldPath, FieldValue, Timestamp } from 'firebase-admin/firestore';
import { onDocumentCreated, onDocumentUpdated } from 'firebase-functions/v2/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { getResend } from '../shared/clients';
import { db } from '../shared/firebase';
import { notifyChurchMembers } from '../shared/notify';
import { FIRESTORE_REGION } from '../shared/regions';
import {
  appCheckCallableOptions,
  assertFreshAppCheck,
  assertActiveChurchRole,
  assertVerifiedNonAnonymousUser,
  checkRateLimit,
  getPrimaryEmailsForUids,
  replayProtectedCallableOptions,
} from '../shared/security';
import { sanitizedErrorContext } from '../shared/logging';
import { renderNewsletterEmail, renderParishNotificationEmail } from '../shared/emailTemplates';
import {
  assertBoolean,
  assertEmail,
  assertHttpsUrl,
  assertIntegerInRange,
  assertNonEmptyString,
  callableDataRecord,
} from '../shared/validation';

const DEFAULT_APP_URL = 'https://app.kandilo.org';
const DEFAULT_MOBILE_APP_URL = 'kandilo://app/';
const NEWSLETTER_EMAIL_CLAIM_TIMEOUT_MS = 15 * 60 * 1000;
const MAX_NEWSLETTER_EMAIL_RECIPIENTS = 1000;
const MAX_NOTIFICATION_EMAIL_RECIPIENTS = 1000;
const EVENT_ANNOUNCEMENT_CHANNELS = new Set(['inApp', 'push', 'email']);
const EVENT_ANNOUNCEMENT_PRIORITIES = new Set(['info', 'urgent', 'offer']);
const EVENT_SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/;
const EVENT_MODULES = new Set(['tickets', 'schedule', 'foodDrink', 'campaigns', 'info']);
const EVENT_MENU_CURRENCIES = new Set(['CAD', 'USD']);
const EVENT_ORDER_STATUSES = new Set(['submitted', 'accepted', 'in_prep', 'ready', 'picked_up', 'cancelled']);
const ACTIVE_EVENT_FOOD_ORDER_STATUSES = ['submitted', 'payment_pending', 'paid', 'accepted', 'in_prep', 'ready'];
const FEATURED_EVENT_LOCKS_COLLECTION = 'eventFeaturedByChurch';
const MAX_EVENT_FOOD_ORDER_LINES = 20;
const MAX_EVENT_FOOD_ORDER_ITEMS = 99;
const MAX_EVENT_FOOD_ORDER_CENTS = 10000000;
const EVENT_DASHBOARD_ROW_LIMIT = 5000;
const EVENT_DASHBOARD_REVENUE_ORDER_STATUSES = new Set(['picked_up', 'paid']);
const EVENT_DASHBOARD_PENDING_ORDER_STATUSES = new Set(['submitted', 'accepted', 'in_prep', 'ready']);
const EVENT_DASHBOARD_TICKET_REVENUE_STATUSES = new Set(['paid', 'checked_in']);
const EVENT_DASHBOARD_DONATION_REVENUE_STATUSES = new Set(['completed', 'paid', 'succeeded', 'receipted']);
const EVENT_DASHBOARD_SCAN_SUCCESS_RESULTS = new Set(['accepted', 'reentry_accepted', 'requires_reentry_confirmation']);
const EVENT_TICKET_SCAN_RESULTS = new Set([
  'accepted',
  'reentry_accepted',
  'requires_reentry_confirmation',
  'invalid',
  'wrong_event',
  'cancelled',
  'refunded',
  'expired',
]);
const EVENT_MENU_INVENTORY_MODES = new Set(['unlimited', 'tracked']);

interface EventSetupChecklistRecord {
  basics: boolean;
  tickets: boolean;
  schedule: boolean;
  foodDrink: boolean;
  campaigns: boolean;
  staff: boolean;
  payments: boolean;
}

function getAppUrl(): string {
  return process.env.APP_URL?.trim() || DEFAULT_APP_URL;
}

function getMobileAppUrl(): string {
  return process.env.MOBILE_APP_URL?.trim() || DEFAULT_MOBILE_APP_URL;
}

function joinBaseUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}

function eventWebUrl(slug: string): string {
  return joinBaseUrl(getAppUrl(), `/e/${encodeURIComponent(slug)}`);
}

function eventMobileUrl(slug: string): string {
  return joinBaseUrl(getMobileAppUrl(), `/e/${encodeURIComponent(slug)}`);
}

function normalizeRecipientEmail(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(normalized) ? normalized : null;
}

async function getActiveChurch(churchId: string): Promise<FirebaseFirestore.DocumentData | null> {
  const churchDoc = await db.collection('churches').doc(churchId).get();
  const church = churchDoc.data();
  return church?.isActive === true ? church : null;
}

export const onEventCreated = onDocumentCreated({ region: FIRESTORE_REGION, document: 'events/{eventId}' }, async (event) => {
  const data = event.data?.data();
  if (!data) return;

  const { churchId, title, startTime } = data;
  if (typeof churchId !== 'string' || typeof title !== 'string' || !churchId || !title) return;
  if (!(await getActiveChurch(churchId))) return;

  try {
    await checkRateLimit(churchId, 'eventFanoutByChurch', 10, 60 * 60 * 1000);
  } catch (error) {
    console.warn('Event fanout suppressed by rate limit', { churchId, eventId: event.params.eventId });
    return;
  }

  const dateStr = startTime?.toDate
    ? startTime.toDate().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
    : 'upcoming';
  const safeTitle = title.slice(0, 120);

  await notifyChurchMembers(
    churchId,
    `New Event: ${safeTitle}`,
    `Join us for ${safeTitle} on ${dateStr}`,
    { type: 'event', eventId: event.params.eventId }
  );

  await db.collection('notifications').add({
    churchId,
    title: `New Event: ${safeTitle}`,
    body: `Join us for ${safeTitle} on ${dateStr}`,
    type: 'event',
    targetRoles: ['member', 'admin', 'treasurer', 'priest'],
    sentAt: FieldValue.serverTimestamp(),
    sentBy: 'system',
    deliveryStats: { sent: 0, failed: 0, opened: 0 },
  });
});

async function fanOutPublishedNewsletter(
  newsletterId: string,
  newsletterRef: FirebaseFirestore.DocumentReference<FirebaseFirestore.DocumentData>
): Promise<void> {
  const newsletterSnap = await newsletterRef.get();
  const newsletter = newsletterSnap.data();
  if (!newsletter || newsletter.status !== 'published') return;

  const { churchId, title, excerpt } = newsletter;
  if (typeof churchId !== 'string' || typeof title !== 'string' || !churchId || !title) return;

  const church = await getActiveChurch(churchId);
  if (!church) return;

  try {
    await checkRateLimit(churchId, 'newsletterFanoutByChurch', 5, 60 * 60 * 1000);
  } catch (error) {
    console.warn('Newsletter fanout suppressed by rate limit', {
      churchId,
      newsletterId,
    });
    return;
  }

  const claimed = await db.runTransaction(async (tx) => {
    const snap = await tx.get(newsletterRef);
    const current = snap.data();
    if (!current || current.status !== 'published' || current.emailSent) {
      return false;
    }

    const sendingAt = current.emailSendStartedAt;
    if (
      sendingAt instanceof Timestamp
      && Date.now() - sendingAt.toMillis() < NEWSLETTER_EMAIL_CLAIM_TIMEOUT_MS
    ) {
      return false;
    }

    tx.update(newsletterRef, {
      emailSendStartedAt: FieldValue.serverTimestamp(),
      emailSendError: FieldValue.delete(),
    });
    return true;
  });
  if (!claimed) return;

  const notificationTitle = `New Bulletin: ${title.slice(0, 120)}`;
  const notificationBody =
    typeof excerpt === 'string' && excerpt ? excerpt.slice(0, 240) : 'A new parish bulletin has been published.';

  try {
    await notifyChurchMembers(
      churchId,
      notificationTitle,
      notificationBody,
      { type: 'newsletter', newsletterId }
    );
  } catch (err) {
    console.error('Newsletter push fanout failed:', sanitizedErrorContext(err));
  }

  await db.collection('notifications').add({
    churchId,
    title: notificationTitle,
    body: notificationBody,
    type: 'newsletter',
    targetRoles: ['member', 'admin', 'treasurer', 'priest'],
    newsletterId,
    sentAt: FieldValue.serverTimestamp(),
    sentBy: 'system',
    deliveryStats: { sent: 0, failed: 0, opened: 0 },
  });

  try {
    const resend = getResend();
    const churchName: string = church.name ?? 'your parish';
    const membersSnap = await db
      .collection('churches')
      .doc(churchId)
      .collection('members')
      .where('status', '==', 'active')
      .get();

    const uids = membersSnap.docs.map((d) => d.id);
    const allEmails = await getPrimaryEmailsForUids(uids);
    const emails = allEmails.slice(0, MAX_NEWSLETTER_EMAIL_RECIPIENTS);

    const appUrl = getAppUrl();
    const mobileAppUrl = getMobileAppUrl();
    const newsletterEmail = renderNewsletterEmail({
      churchName,
      title,
      excerpt,
      appUrl,
      mobileAppUrl,
    });

    for (let i = 0; i < emails.length; i += 50) {
      const batch = emails.slice(i, i + 50);
      const response = await resend.batch.send(batch.map((recipientEmail) => ({
        from: 'Kandilo <bulletin@kandilo.org>',
        to: recipientEmail,
        subject: newsletterEmail.subject,
        html: newsletterEmail.html,
        text: newsletterEmail.text,
      })));
      if (response.error) {
        console.error('Newsletter email provider rejected request.', {
          errorName: response.error.name ?? 'ResendError',
          batchSize: batch.length,
        });
        throw new HttpsError('internal', 'Newsletter email could not be sent.');
      }
    }

    await newsletterRef.update({
      emailSent: true,
      emailSentAt: FieldValue.serverTimestamp(),
      emailSendStartedAt: FieldValue.delete(),
      emailRecipientCount: emails.length,
      emailRecipientTruncated: allEmails.length > emails.length,
    });
  } catch (err) {
    console.error('Newsletter email send failed:', sanitizedErrorContext(err));
    await newsletterRef.update({
      emailSendStartedAt: FieldValue.delete(),
      emailSendError: 'newsletter_email_failed',
    }).catch(() => undefined);
  }
}

export const onNewsletterCreated = onDocumentCreated(
  { region: FIRESTORE_REGION, document: 'newsletters/{newsletterId}', secrets: ['RESEND_API_KEY'] },
  async (event) => {
    const created = event.data?.data();
    const newsletterRef = event.data?.ref;
    if (!created || created.status !== 'published' || !newsletterRef) return;

    await fanOutPublishedNewsletter(event.params.newsletterId, newsletterRef);
  }
);

export const onNewsletterPublished = onDocumentUpdated(
  { region: FIRESTORE_REGION, document: 'newsletters/{newsletterId}', secrets: ['RESEND_API_KEY'] },
  async (event) => {
    const before = event.data?.before.data();
    const after = event.data?.after.data();
    const newsletterRef = event.data?.after.ref;
    if (!before || !after || !newsletterRef) return;

    if (before.status === 'published' || after.status !== 'published') return;

    await fanOutPublishedNewsletter(event.params.newsletterId, newsletterRef);
  }
);

function normalizeEventSlug(value: unknown): string {
  const slug = assertNonEmptyString(value, 64, 'slug').toLowerCase();
  if (!EVENT_SLUG_PATTERN.test(slug)) {
    throw new HttpsError('invalid-argument', 'slug must use 3-64 lowercase letters, numbers, and hyphens.');
  }
  return slug;
}

function optionalString(value: unknown, max: number, field: string): string {
  if (value == null) {
    return '';
  }
  if (typeof value !== 'string') {
    throw new HttpsError('invalid-argument', `${field} must be a string.`);
  }
  const trimmed = value.trim();
  if (trimmed.length > max) {
    throw new HttpsError('invalid-argument', `${field} must be at most ${max} characters.`);
  }
  return trimmed;
}

function optionalHttpsUrl(value: unknown, field: string): string {
  const url = optionalString(value, 2000, field);
  return url ? assertHttpsUrl(url, field) : '';
}

function optionalEmail(value: unknown, field: string): string {
  const email = optionalString(value, 254, field);
  return email ? assertEmail(email, field) : '';
}

function optionalPhone(value: unknown, field: string): string {
  const phone = optionalString(value, 32, field);
  if (!phone) {
    return '';
  }
  if (!/^[0-9+().\-\s]{7,32}$/.test(phone)) {
    throw new HttpsError('invalid-argument', `${field} must be a valid phone number.`);
  }
  return phone.replace(/\s+/g, ' ').trim();
}

function normalizeMenuCurrency(value: unknown): string {
  const currency = assertNonEmptyString(value, 10, 'currency').toUpperCase();
  if (!EVENT_MENU_CURRENCIES.has(currency)) {
    throw new HttpsError('invalid-argument', 'Unsupported menu currency.');
  }
  return currency;
}

function optionalDocumentId(value: unknown, field: string): string {
  const id = optionalString(value, 128, field);
  if (id && !/^[A-Za-z0-9_-]{1,128}$/.test(id)) {
    throw new HttpsError('invalid-argument', `${field} is not valid.`);
  }
  return id;
}

function optionalScannerDeviceId(value: unknown): string {
  const deviceId = optionalString(value, 80, 'deviceId');
  if (!deviceId) {
    return '';
  }
  if (!/^[A-Za-z0-9_.:-]{1,80}$/.test(deviceId)) {
    throw new HttpsError('invalid-argument', 'deviceId is not valid.');
  }
  return deviceId;
}

function scanCodeHashes(code: string): string[] {
  const trimmed = code.trim();
  const candidates = [
    trimmed,
    trimmed.toUpperCase(),
    trimmed.replace(/\s+/g, '').toUpperCase(),
  ].filter(Boolean);
  return Array.from(new Set(candidates.map((candidate) => (
    createHash('sha256').update(candidate).digest('hex')
  ))));
}

function normalizeInventoryMode(value: unknown): 'unlimited' | 'tracked' {
  const mode = typeof value === 'string' && value.trim() ? value.trim() : 'unlimited';
  if (!EVENT_MENU_INVENTORY_MODES.has(mode)) {
    throw new HttpsError('invalid-argument', 'Unsupported inventory mode.');
  }
  return mode as 'unlimited' | 'tracked';
}

function orderCodeForId(orderId: string): string {
  const safe = orderId.replace(/[^A-Za-z0-9]/g, '').slice(-6).toUpperCase();
  return safe || 'ORDER';
}

function timestampIsPast(value: unknown, nowMs: number): boolean {
  return value instanceof Timestamp && value.toMillis() < nowMs;
}

async function assertEventPortalAdmin(eventId: string, uid: string): Promise<{
  eventRef: FirebaseFirestore.DocumentReference<FirebaseFirestore.DocumentData>;
  event: FirebaseFirestore.DocumentData;
  churchId: string;
}> {
  const eventRef = db.collection('eventPortals').doc(eventId);
  const eventSnap = await eventRef.get();
  const event = eventSnap.data();
  const churchId = typeof event?.churchId === 'string' ? event.churchId : '';
  if (!eventSnap.exists || !event || !churchId) {
    throw new HttpsError('not-found', 'Event not found.');
  }

  await assertActiveChurchRole(
    churchId,
    uid,
    ['admin', 'priest'],
    'Only active admins and priests can manage this event.'
  );
  return { eventRef, event, churchId };
}

interface EventDashboardSalesItem {
  id: string;
  type: 'ticket' | 'food';
  label: string;
  quantity: number;
  revenueCents: number;
  currency: string;
}

function dashboardString(data: FirebaseFirestore.DocumentData, fields: string[], fallback = ''): string {
  for (const field of fields) {
    const value = data[field];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return fallback;
}

function dashboardInteger(data: FirebaseFirestore.DocumentData, fields: string[], fallback = 0): number {
  for (const field of fields) {
    const value = data[field];
    if (typeof value === 'number' && Number.isInteger(value) && value >= 0) {
      return value;
    }
  }
  return fallback;
}

function dashboardCents(
  data: FirebaseFirestore.DocumentData,
  centsFields: string[],
  decimalAmountFields: string[] = []
): number {
  for (const field of centsFields) {
    const value = data[field];
    if (typeof value === 'number' && Number.isInteger(value) && value >= 0) {
      return value;
    }
  }
  for (const field of decimalAmountFields) {
    const value = data[field];
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
      return Math.round(value * 100);
    }
  }
  return 0;
}

function dashboardCurrency(data: FirebaseFirestore.DocumentData, fallback = 'CAD'): string {
  const currency = dashboardString(data, ['currency'], fallback).toUpperCase();
  return /^[A-Z]{3}$/.test(currency) ? currency : fallback;
}

function addSalesBreakdownItem(
  items: Map<string, EventDashboardSalesItem>,
  input: EventDashboardSalesItem
): void {
  if (input.quantity <= 0 && input.revenueCents <= 0) {
    return;
  }
  const existing = items.get(input.id);
  if (!existing) {
    items.set(input.id, input);
    return;
  }
  existing.quantity += input.quantity;
  existing.revenueCents += input.revenueCents;
}

function sortedOrderStatusCounts(statusCounts: Map<string, number>): Array<{ status: string; count: number }> {
  const order = ['submitted', 'accepted', 'in_prep', 'ready', 'picked_up', 'cancelled', 'refunded'];
  return Array.from(statusCounts.entries())
    .sort((a, b) => {
      const aIndex = order.indexOf(a[0]);
      const bIndex = order.indexOf(b[0]);
      return (aIndex === -1 ? order.length : aIndex) - (bIndex === -1 ? order.length : bIndex)
        || a[0].localeCompare(b[0]);
    })
    .map(([status, count]) => ({ status, count }));
}

async function loadGivingDocsByIds(
  givingIds: string[]
): Promise<Array<FirebaseFirestore.QueryDocumentSnapshot<FirebaseFirestore.DocumentData>>> {
  const uniqueIds = Array.from(new Set(givingIds.filter((id) => /^[A-Za-z0-9_-]{1,128}$/.test(id))));
  const docs: Array<FirebaseFirestore.QueryDocumentSnapshot<FirebaseFirestore.DocumentData>> = [];
  for (let i = 0; i < uniqueIds.length; i += 10) {
    const snap = await db.collection('giving')
      .where(FieldPath.documentId(), 'in', uniqueIds.slice(i, i + 10))
      .get();
    docs.push(...snap.docs);
  }
  return docs;
}

function assertOrderTransition(currentStatus: string, nextStatus: string): void {
  const allowed: Record<string, string[]> = {
    submitted: ['accepted', 'in_prep', 'cancelled'],
    accepted: ['in_prep', 'ready', 'cancelled'],
    in_prep: ['ready', 'cancelled'],
    ready: ['picked_up', 'cancelled'],
    picked_up: [],
    cancelled: [],
  };
  if (currentStatus === nextStatus) {
    return;
  }
  if (!EVENT_ORDER_STATUSES.has(nextStatus) || !(allowed[currentStatus] ?? []).includes(nextStatus)) {
    throw new HttpsError('failed-precondition', 'This order status transition is not allowed.');
  }
}

function parseEventTimestamp(value: unknown, field: string): Timestamp {
  if (typeof value !== 'string') {
    throw new HttpsError('invalid-argument', `${field} must be an ISO timestamp.`);
  }
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new HttpsError('invalid-argument', `${field} must be a valid timestamp.`);
  }
  return Timestamp.fromDate(date);
}

function parseOptionalEventTimestamp(value: unknown, field: string): Timestamp | null {
  if (value == null || value === '') {
    return null;
  }
  return parseEventTimestamp(value, field);
}

function eventSetupChecklist(value: unknown): EventSetupChecklistRecord {
  const record = typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  return {
    basics: record.basics === true,
    tickets: record.tickets === true,
    schedule: record.schedule === true,
    foodDrink: record.foodDrink === true,
    campaigns: record.campaigns === true,
    staff: record.staff === true,
    payments: record.payments === true,
  };
}

function eventModules(input: {
  ticketsEnabled: boolean;
  foodDrinkEnabled: boolean;
  campaignsEnabled: boolean;
}): string[] {
  const modules = [
    ...(input.ticketsEnabled ? ['tickets'] : []),
    'schedule',
    ...(input.foodDrinkEnabled ? ['foodDrink'] : []),
    ...(input.campaignsEnabled ? ['campaigns'] : []),
    'info',
  ];
  return modules.filter((module) => EVENT_MODULES.has(module));
}

function assertPublishReady(input: {
  title: string;
  description: string;
  venueName: string;
  venueAddress: string;
  startsAt: Timestamp;
  endsAt: Timestamp;
  ticketsEnabled: boolean;
  gateScanningEnabled: boolean;
  foodDrinkEnabled: boolean;
  foodOrderingEnabled: boolean;
  campaignsEnabled: boolean;
  checklist: EventSetupChecklistRecord;
}): void {
  if (
    !input.checklist.basics
    || input.title.length < 3
    || input.description.length < 10
    || input.venueName.length < 2
    || input.venueAddress.length < 4
    || input.endsAt.toMillis() <= input.startsAt.toMillis()
  ) {
    throw new HttpsError('failed-precondition', 'Complete valid event basics before publishing.');
  }
  if (input.ticketsEnabled && !input.checklist.tickets) {
    throw new HttpsError('failed-precondition', 'Complete ticket display readiness before publishing tickets.');
  }
  if (input.gateScanningEnabled) {
    if (!input.ticketsEnabled || !input.checklist.tickets || !input.checklist.staff) {
      throw new HttpsError('failed-precondition', 'Complete ticket and scanner staff readiness before enabling gate scanning.');
    }
  }
  if (input.foodDrinkEnabled && !input.checklist.foodDrink) {
    throw new HttpsError('failed-precondition', 'Complete menu display readiness before publishing food and drink.');
  }
  if (input.foodOrderingEnabled && (!input.foodDrinkEnabled || !input.checklist.staff)) {
    throw new HttpsError('failed-precondition', 'Complete food ordering staff readiness before enabling online orders.');
  }
  if (input.campaignsEnabled && !input.checklist.campaigns) {
    throw new HttpsError('failed-precondition', 'Complete campaign display readiness before publishing campaigns.');
  }
}

function orderReferencesMenuItem(order: FirebaseFirestore.DocumentData, menuItemId: string): boolean {
  const items = Array.isArray(order.items) ? order.items : [];
  return items.some((item) => (
    item
    && typeof item === 'object'
    && !Array.isArray(item)
    && (item as FirebaseFirestore.DocumentData).menuItemId === menuItemId
  ));
}

async function assertNoActiveOrdersForMenuItem(
  tx: FirebaseFirestore.Transaction,
  eventId: string,
  menuItemId: string
): Promise<void> {
  const activeOrdersSnap = await tx.get(
    db.collection('eventOrders')
      .where('eventId', '==', eventId)
      .where('status', 'in', ACTIVE_EVENT_FOOD_ORDER_STATUSES)
      .limit(200)
  );
  for (const orderDoc of activeOrdersSnap.docs) {
    if (orderReferencesMenuItem(orderDoc.data(), menuItemId)) {
      throw new HttpsError(
        'failed-precondition',
        'This menu item has active food orders. Hide or sell it out until orders are completed or cancelled.'
      );
    }
  }
  if (activeOrdersSnap.size >= 200) {
    throw new HttpsError('failed-precondition', 'Too many active orders to safely change this menu item right now.');
  }
}

async function eventAnnouncementRecipientEmails(eventId: string, churchId: string): Promise<{
  allEmails: string[];
  truncated: boolean;
}> {
  const membersSnap = await db
    .collection('churches')
    .doc(churchId)
    .collection('members')
    .where('status', '==', 'active')
    .get();
  const memberEmails = await getPrimaryEmailsForUids(membersSnap.docs.map((doc) => doc.id));

  const ticketPrivateSnap = await db
    .collection('eventTicketPrivate')
    .where('eventId', '==', eventId)
    .limit(MAX_NOTIFICATION_EMAIL_RECIPIENTS)
    .get();
  const ticketEmails = ticketPrivateSnap.docs.flatMap((doc) => {
    const data = doc.data();
    return [
      normalizeRecipientEmail(data.buyerEmail),
      normalizeRecipientEmail(data.attendeeEmail),
      normalizeRecipientEmail(data.email),
    ].filter((email): email is string => Boolean(email));
  });

  const uniqueEmails = Array.from(new Set([...memberEmails, ...ticketEmails]));
  return {
    allEmails: uniqueEmails.slice(0, MAX_NOTIFICATION_EMAIL_RECIPIENTS),
    truncated: uniqueEmails.length > MAX_NOTIFICATION_EMAIL_RECIPIENTS
      || ticketPrivateSnap.size >= MAX_NOTIFICATION_EMAIL_RECIPIENTS,
  };
}

export const saveEventPortalSetup = onCall({ ...replayProtectedCallableOptions, secrets: [] }, async (request) => {
  assertFreshAppCheck(request);
  assertVerifiedNonAnonymousUser(request, 'A verified, non-anonymous account is required to save event setup.');
  await checkRateLimit(request.auth!.uid, 'saveEventPortalSetup', 20);

  const input = callableDataRecord(request.data);
  const churchId = assertNonEmptyString(input.churchId, 128, 'churchId');
  const slug = normalizeEventSlug(input.slug);
  const eventId = optionalString(input.eventId, 128, 'eventId');
  if (eventId && eventId !== slug) {
    throw new HttpsError('invalid-argument', 'Saved event slugs are immutable.');
  }

  await assertActiveChurchRole(
    churchId,
    request.auth!.uid,
    ['admin', 'priest'],
    'Only active admins and priests can save event setup.'
  );
  await checkRateLimit(churchId, 'saveEventPortalSetupByChurch', 60, 60 * 60 * 1000);

  const title = assertNonEmptyString(input.title, 180, 'title');
  const description = assertNonEmptyString(input.description, 5000, 'description');
  const venueName = assertNonEmptyString(input.venueName, 180, 'venueName');
  const venueAddress = assertNonEmptyString(input.venueAddress, 300, 'venueAddress');
  const heroImageURL = optionalHttpsUrl(input.heroImageURL, 'heroImageURL');
  const startsAt = parseEventTimestamp(input.startsAt, 'startsAt');
  const endsAt = parseEventTimestamp(input.endsAt, 'endsAt');
  if (endsAt.toMillis() <= startsAt.toMillis()) {
    throw new HttpsError('invalid-argument', 'endsAt must be after startsAt.');
  }
  const status = input.status === 'published' ? 'published' : 'draft';
  const requestedFocusEnabled = assertBoolean(input.focusEnabled, 'focusEnabled');
  const focusStartsAt = parseOptionalEventTimestamp(input.focusStartsAt, 'focusStartsAt');
  const focusEndsAt = parseOptionalEventTimestamp(input.focusEndsAt, 'focusEndsAt');
  if (focusStartsAt && focusEndsAt && focusEndsAt.toMillis() <= focusStartsAt.toMillis()) {
    throw new HttpsError('invalid-argument', 'focusEndsAt must be after focusStartsAt.');
  }
  const ticketsEnabled = assertBoolean(input.ticketsEnabled, 'ticketsEnabled');
  const gateScanningEnabled = assertBoolean(input.gateScanningEnabled, 'gateScanningEnabled');
  const reEntryEnabled = assertBoolean(input.reEntryEnabled, 'reEntryEnabled');
  const foodDrinkEnabled = assertBoolean(input.foodDrinkEnabled, 'foodDrinkEnabled');
  const foodOrderingEnabled = assertBoolean(input.foodOrderingEnabled, 'foodOrderingEnabled');
  const campaignsEnabled = assertBoolean(input.campaignsEnabled, 'campaignsEnabled');
  const checklist = eventSetupChecklist(input.setupChecklist);

  if (status === 'published') {
    assertPublishReady({
      title,
      description,
      venueName,
      venueAddress,
      startsAt,
      endsAt,
      ticketsEnabled,
      gateScanningEnabled,
      foodDrinkEnabled,
      foodOrderingEnabled,
      campaignsEnabled,
      checklist,
    });
  }

  const focusEnabled = status === 'published' && requestedFocusEnabled;
  const eventRef = db.collection('eventPortals').doc(slug);
  const focusLockRef = db.collection(FEATURED_EVENT_LOCKS_COLLECTION).doc(churchId);
  const now = FieldValue.serverTimestamp();
  const callerUid = request.auth!.uid;

  await db.runTransaction(async (tx) => {
    const existingSnap = await tx.get(eventRef);
    const lockSnap = await tx.get(focusLockRef);
    const lockedEventId = typeof lockSnap.data()?.eventId === 'string'
      ? lockSnap.data()!.eventId as string
      : '';
    const lockedEventSnap = lockedEventId && lockedEventId !== slug
      ? await tx.get(db.collection('eventPortals').doc(lockedEventId))
      : null;
    const focusedSnap = focusEnabled
      ? await tx.get(db.collection('eventPortals').where('churchId', '==', churchId).where('focusEnabled', '==', true))
      : null;
    const ticketTierSnap = status === 'published' && ticketsEnabled
      ? await tx.get(db.collection('eventTicketTiers').where('eventId', '==', slug).where('active', '==', true).limit(1))
      : null;
    const menuSnap = status === 'published' && foodDrinkEnabled
      ? await tx.get(db.collection('eventMenuItems').where('eventId', '==', slug).where('available', '==', true).limit(25))
      : null;
    const campaignSnap = status === 'published' && campaignsEnabled
      ? await tx.get(db.collection('eventCampaigns').where('eventId', '==', slug).where('active', '==', true).limit(1))
      : null;

    const existing = existingSnap.data();
    if (existingSnap.exists && existing?.churchId !== churchId) {
      throw new HttpsError('already-exists', 'This public event URL is already in use.');
    }
    if (status === 'published' && ticketsEnabled && ticketTierSnap?.empty) {
      throw new HttpsError('failed-precondition', 'Add at least one active ticket tier before publishing ticket information.');
    }
    if (status === 'published' && foodDrinkEnabled && menuSnap?.empty) {
      throw new HttpsError('failed-precondition', 'Add at least one available menu item before publishing food and drink.');
    }
    if (
      status === 'published'
      && foodOrderingEnabled
      && !(menuSnap?.docs ?? []).some((doc) => doc.data().soldOut !== true)
    ) {
      throw new HttpsError('failed-precondition', 'Add at least one orderable menu item before accepting food orders.');
    }
    if (status === 'published' && campaignsEnabled && campaignSnap?.empty) {
      throw new HttpsError('failed-precondition', 'Add at least one active event campaign before publishing campaign cards.');
    }

    const portalRecord: FirebaseFirestore.DocumentData = {
      organizationId: churchId,
      organizationType: 'church',
      churchId,
      title,
      slug,
      status,
      startsAt,
      endsAt,
      venueName,
      venueAddress,
      heroImageURL,
      description,
      modules: eventModules({ ticketsEnabled, foodDrinkEnabled, campaignsEnabled }),
      focusEnabled,
      focusStartsAt,
      focusEndsAt,
      ticketsEnabled,
      gateScanningEnabled: ticketsEnabled && gateScanningEnabled,
      reEntryEnabled,
      foodDrinkEnabled,
      foodOrderingEnabled: foodDrinkEnabled && foodOrderingEnabled,
      campaignsEnabled,
      setupChecklist: checklist,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };

    tx.set(eventRef, portalRecord);

    if (focusEnabled) {
      for (const focusedDoc of focusedSnap?.docs ?? []) {
        if (focusedDoc.id !== slug) {
          tx.update(focusedDoc.ref, {
            focusEnabled: false,
            updatedAt: now,
          });
        }
      }
      if (lockedEventSnap?.exists) {
        tx.update(lockedEventSnap.ref, {
          focusEnabled: false,
          updatedAt: now,
        });
      }
      tx.set(focusLockRef, {
        churchId,
        eventId: slug,
        updatedAt: now,
        updatedBy: callerUid,
      });
    } else if (lockedEventId === slug) {
      tx.delete(focusLockRef);
    }
  });

  return {
    success: true,
    eventId: slug,
    slug,
    status,
  };
});

export const getEventDashboardMetrics = onCall({ ...appCheckCallableOptions, secrets: [] }, async (request) => {
  assertVerifiedNonAnonymousUser(request, 'A verified, non-anonymous account is required to view event dashboards.');
  await checkRateLimit(request.auth!.uid, 'getEventDashboardMetrics', 30);

  const input = callableDataRecord(request.data);
  const eventId = normalizeEventSlug(input.eventId);
  const { event, churchId } = await assertEventPortalAdmin(eventId, request.auth!.uid);
  await checkRateLimit(churchId, 'getEventDashboardMetricsByChurch', 240, 60 * 60 * 1000);

  let currency = dashboardCurrency(event);
  let hasMetricCurrency = typeof event.currency === 'string' && /^[A-Z]{3}$/.test(event.currency.toUpperCase());
  let multiCurrency = false;
  const canAddToHeadlineTotal = (itemCurrency: string): boolean => {
    if (!hasMetricCurrency) {
      currency = itemCurrency;
      hasMetricCurrency = true;
      return true;
    }
    if (itemCurrency !== currency) {
      multiCurrency = true;
      return false;
    }
    return true;
  };

  let entrySalesCents = 0;
  let foodSalesCents = 0;
  let pendingFoodSalesCents = 0;
  let donationCents = 0;
  let ticketsSold = 0;
  let foodOrders = 0;
  let pendingFoodOrders = 0;
  let foodItemsSold = 0;
  let donationCount = 0;
  const salesBreakdown = new Map<string, EventDashboardSalesItem>();
  const orderStatusCounts = new Map<string, number>();

  const [
    ticketsSnap,
    scansSnap,
    ordersSnap,
    campaignsSnap,
    eventDonationsSnap,
    eventPortalDonationsSnap,
    eventPaymentMetadataSnap,
  ] = await Promise.all([
    db.collection('eventTickets').where('eventId', '==', eventId).limit(EVENT_DASHBOARD_ROW_LIMIT).get(),
    db.collection('eventTicketScans').where('eventId', '==', eventId).limit(EVENT_DASHBOARD_ROW_LIMIT).get(),
    db.collection('eventOrders').where('eventId', '==', eventId).limit(EVENT_DASHBOARD_ROW_LIMIT).get(),
    db.collection('eventCampaigns').where('eventId', '==', eventId).limit(EVENT_DASHBOARD_ROW_LIMIT).get(),
    db.collection('giving').where('eventId', '==', eventId).limit(EVENT_DASHBOARD_ROW_LIMIT).get(),
    db.collection('giving').where('eventPortalId', '==', eventId).limit(EVENT_DASHBOARD_ROW_LIMIT).get(),
    db.collection('givingPaymentMetadata').where('eventPortalId', '==', eventId).limit(EVENT_DASHBOARD_ROW_LIMIT).get(),
  ]);

  let truncated =
    ticketsSnap.size >= EVENT_DASHBOARD_ROW_LIMIT
    || scansSnap.size >= EVENT_DASHBOARD_ROW_LIMIT
    || ordersSnap.size >= EVENT_DASHBOARD_ROW_LIMIT
    || campaignsSnap.size >= EVENT_DASHBOARD_ROW_LIMIT
    || eventDonationsSnap.size >= EVENT_DASHBOARD_ROW_LIMIT
    || eventPortalDonationsSnap.size >= EVENT_DASHBOARD_ROW_LIMIT
    || eventPaymentMetadataSnap.size >= EVENT_DASHBOARD_ROW_LIMIT;

  for (const ticketDoc of ticketsSnap.docs) {
    const ticket = ticketDoc.data();
    const status = dashboardString(ticket, ['status'], 'paid');
    if (!EVENT_DASHBOARD_TICKET_REVENUE_STATUSES.has(status)) {
      continue;
    }

    const quantity = Math.max(1, dashboardInteger(ticket, ['quantity', 'ticketCount'], 1));
    const ticketCurrency = dashboardCurrency(ticket, currency);
    const explicitTotalCents = dashboardCents(ticket, ['totalCents', 'amountCents', 'paidCents'], ['amount']);
    const unitPriceCents = dashboardCents(ticket, ['unitPriceCents', 'priceCents']);
    const revenueCents = explicitTotalCents || unitPriceCents * quantity;
    const label = dashboardString(ticket, ['tierName', 'ticketTierName', 'name'], 'Entry ticket');
    ticketsSold += quantity;
    if (canAddToHeadlineTotal(ticketCurrency)) {
      entrySalesCents += revenueCents;
    }
    addSalesBreakdownItem(salesBreakdown, {
      id: `ticket:${dashboardString(ticket, ['tierId', 'ticketTierId'], ticketDoc.id)}`,
      type: 'ticket',
      label,
      quantity,
      revenueCents,
      currency: ticketCurrency,
    });
  }

  const successfulScanTicketIds = new Set<string>();
  for (const scanDoc of scansSnap.docs) {
    const scan = scanDoc.data();
    const result = dashboardString(scan, ['result', 'status'], 'accepted');
    if (!EVENT_DASHBOARD_SCAN_SUCCESS_RESULTS.has(result) || scan.admitted === false) {
      continue;
    }
    successfulScanTicketIds.add(dashboardString(scan, ['ticketId', 'eventTicketId', 'code'], scanDoc.id));
  }

  for (const orderDoc of ordersSnap.docs) {
    const order = orderDoc.data();
    const status = dashboardString(order, ['status'], 'submitted');
    const paymentStatus = dashboardString(order, ['paymentStatus'], '');
    const orderCurrency = dashboardCurrency(order, currency);
    const totalCents = dashboardCents(order, ['totalCents', 'subtotalCents']);
    const isRevenueOrder =
      EVENT_DASHBOARD_REVENUE_ORDER_STATUSES.has(status)
      || paymentStatus === 'paid_at_pickup'
      || paymentStatus === 'paid';
    const isPendingOrder = EVENT_DASHBOARD_PENDING_ORDER_STATUSES.has(status);
    orderStatusCounts.set(status, (orderStatusCounts.get(status) ?? 0) + 1);

    if (isRevenueOrder) {
      foodOrders += 1;
      if (canAddToHeadlineTotal(orderCurrency)) {
        foodSalesCents += totalCents;
      }
    } else if (isPendingOrder) {
      pendingFoodOrders += 1;
      if (canAddToHeadlineTotal(orderCurrency)) {
        pendingFoodSalesCents += totalCents;
      }
    }

    const items = Array.isArray(order.items) ? order.items : [];
    if (!isRevenueOrder) {
      continue;
    }
    for (const item of items) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        continue;
      }
      const record = item as FirebaseFirestore.DocumentData;
      const quantity = dashboardInteger(record, ['quantity']);
      const lineTotalCents = dashboardCents(record, ['lineTotalCents']);
      foodItemsSold += quantity;
      addSalesBreakdownItem(salesBreakdown, {
        id: `food:${dashboardString(record, ['menuItemId'], 'unknown')}`,
        type: 'food',
        label: dashboardString(record, ['name'], 'Menu item'),
        quantity,
        revenueCents: lineTotalCents,
        currency: orderCurrency,
      });
    }
  }

  const eventCampaignIds = campaignsSnap.docs.map((doc) => doc.id);
  const campaignDonationSnaps = [];
  const campaignPaymentMetadataSnaps = [];
  for (let i = 0; i < eventCampaignIds.length; i += 10) {
    campaignDonationSnaps.push(
      await db.collection('giving')
        .where('eventCampaignId', 'in', eventCampaignIds.slice(i, i + 10))
        .limit(EVENT_DASHBOARD_ROW_LIMIT)
        .get()
    );
    campaignPaymentMetadataSnaps.push(
      await db.collection('givingPaymentMetadata')
        .where('eventCampaignId', 'in', eventCampaignIds.slice(i, i + 10))
        .limit(EVENT_DASHBOARD_ROW_LIMIT)
        .get()
    );
  }

  const donationDocsById = new Map<string, FirebaseFirestore.QueryDocumentSnapshot<FirebaseFirestore.DocumentData>>();
  for (const doc of eventDonationsSnap.docs) {
    donationDocsById.set(doc.id, doc);
  }
  for (const doc of eventPortalDonationsSnap.docs) {
    donationDocsById.set(doc.id, doc);
  }
  for (const snap of campaignDonationSnaps) {
    truncated = truncated || snap.size >= EVENT_DASHBOARD_ROW_LIMIT;
    for (const doc of snap.docs) {
      donationDocsById.set(doc.id, doc);
    }
  }
  const metadataGivingIds = [
    ...eventPaymentMetadataSnap.docs.map((doc) => doc.id),
    ...campaignPaymentMetadataSnaps.flatMap((snap) => {
      truncated = truncated || snap.size >= EVENT_DASHBOARD_ROW_LIMIT;
      return snap.docs.map((doc) => doc.id);
    }),
  ];
  for (const doc of await loadGivingDocsByIds(metadataGivingIds)) {
    donationDocsById.set(doc.id, doc);
  }

  for (const donationDoc of donationDocsById.values()) {
    const donation = donationDoc.data();
    const status = dashboardString(donation, ['status'], '');
    if (!EVENT_DASHBOARD_DONATION_REVENUE_STATUSES.has(status)) {
      continue;
    }
    const donationCurrency = dashboardCurrency(donation, currency);
    const amountCents = dashboardCents(donation, ['amountCents', 'eligibleAmountCents'], ['amount']);
    donationCount += 1;
    if (canAddToHeadlineTotal(donationCurrency)) {
      donationCents += amountCents;
    }
  }

  const salesItems = Array.from(salesBreakdown.values())
    .sort((a, b) => b.revenueCents - a.revenueCents || b.quantity - a.quantity || a.label.localeCompare(b.label))
    .slice(0, 25);

  return {
    eventId,
    currency,
    entrySalesCents,
    foodSalesCents,
    pendingFoodSalesCents,
    totalSalesCents: entrySalesCents + foodSalesCents,
    donationCents,
    ticketsSold,
    qrCheckIns: successfulScanTicketIds.size,
    scanAttempts: scansSnap.size,
    foodOrders,
    pendingFoodOrders,
    foodItemsSold,
    donationCount,
    salesBreakdown: salesItems,
    orderStatusCounts: sortedOrderStatusCounts(orderStatusCounts),
    generatedAt: new Date().toISOString(),
    truncated,
    multiCurrency,
  };
});

export const scanEventTicket = onCall({ ...replayProtectedCallableOptions, secrets: [] }, async (request) => {
  assertFreshAppCheck(request);
  assertVerifiedNonAnonymousUser(request, 'A verified, non-anonymous account is required to scan event tickets.');
  await checkRateLimit(request.auth!.uid, 'scanEventTicket', 120);

  const input = callableDataRecord(request.data);
  const eventId = normalizeEventSlug(input.eventId);
  const code = assertNonEmptyString(input.code, 256, 'code');
  if (code.trim().length < 6) {
    throw new HttpsError('invalid-argument', 'Ticket code is not valid.');
  }
  const deviceId = optionalScannerDeviceId(input.deviceId);
  const confirmReEntry = input.confirmReEntry === undefined
    ? false
    : assertBoolean(input.confirmReEntry, 'confirmReEntry');
  const { eventRef, churchId } = await assertEventPortalAdmin(eventId, request.auth!.uid);
  await checkRateLimit(churchId, 'scanEventTicketByChurch', 1200, 60 * 60 * 1000);

  const hashes = scanCodeHashes(code);
  const scanRef = db.collection('eventTicketScans').doc();
  const scanHashPrefix = hashes[0]?.slice(0, 12) ?? '';
  const now = FieldValue.serverTimestamp();

  const result = await db.runTransaction(async (tx) => {
    const eventSnap = await tx.get(eventRef);
    const event = eventSnap.data();
    if (!eventSnap.exists || !event || event.status !== 'published' || event.gateScanningEnabled !== true) {
      throw new HttpsError('failed-precondition', 'Gate scanning is not enabled for this event.');
    }

    const allPrivateMatches = new Map<string, FirebaseFirestore.QueryDocumentSnapshot<FirebaseFirestore.DocumentData>>();
    const privateMatches = new Map<string, FirebaseFirestore.QueryDocumentSnapshot<FirebaseFirestore.DocumentData>>();
    for (const field of ['scanTokenHash', 'qrTokenHash', 'manualCodeHash', 'ticketCodeHash']) {
      for (const hash of hashes) {
        const snap = await tx.get(
          db.collection('eventTicketPrivate')
            .where(field, '==', hash)
            .limit(3)
        );
        for (const doc of snap.docs) {
          allPrivateMatches.set(doc.id, doc);
          if (doc.data().eventId === eventId) {
            privateMatches.set(doc.id, doc);
          }
        }
      }
    }

    if (privateMatches.size !== 1) {
      const wrongEvent = privateMatches.size === 0 && allPrivateMatches.size > 0;
      tx.set(scanRef, {
        eventId,
        churchId,
        ticketId: '',
        result: wrongEvent ? 'wrong_event' : 'invalid',
        admitted: false,
        staffUid: request.auth!.uid,
        deviceId,
        scanHashPrefix,
        scannedAt: now,
      });
      return {
        result: wrongEvent ? 'wrong_event' : 'invalid',
        admitted: false,
        requiresStaffConfirmation: false,
        reason: wrongEvent ? 'Ticket belongs to another event.' : 'Ticket was not found.',
        ticketId: '',
        scanCount: 0,
      };
    }

    const privateDoc = Array.from(privateMatches.values())[0];
    const privateTicket = privateDoc.data();
    const ticketId = typeof privateTicket.ticketId === 'string' && privateTicket.ticketId.trim()
      ? privateTicket.ticketId.trim()
      : privateDoc.id;
    const ticketRef = db.collection('eventTickets').doc(ticketId);
    const ticketSnap = await tx.get(ticketRef);
    const ticket = ticketSnap.data();
    const currentScanCount = typeof ticket?.scanCount === 'number' && Number.isInteger(ticket.scanCount) && ticket.scanCount >= 0
      ? ticket.scanCount
      : 0;
    const reEntryEnabled = event.reEntryEnabled === true && ticket?.reEntryEnabled !== false;

    let scanResult = 'accepted';
    let admitted = true;
    let requiresStaffConfirmation = false;
    let reason = 'Ticket is valid.';

    if (!ticketSnap.exists || !ticket) {
      scanResult = 'invalid';
      admitted = false;
      reason = 'Ticket was not found.';
    } else if (ticket.eventId !== eventId) {
      scanResult = 'wrong_event';
      admitted = false;
      reason = 'Ticket belongs to another event.';
    } else if (ticket.status === 'cancelled') {
      scanResult = 'cancelled';
      admitted = false;
      reason = 'Ticket is cancelled.';
    } else if (ticket.status === 'refunded') {
      scanResult = 'refunded';
      admitted = false;
      reason = 'Ticket is refunded.';
    } else if (ticket.status === 'expired') {
      scanResult = 'expired';
      admitted = false;
      reason = 'Ticket is expired.';
    } else if (!['paid', 'checked_in'].includes(ticket.status)) {
      scanResult = 'invalid';
      admitted = false;
      reason = 'Ticket is not paid or issued.';
    } else if (timestampIsPast(ticket.expiresAt, Date.now()) || timestampIsPast(event.endsAt, Date.now())) {
      scanResult = 'expired';
      admitted = false;
      reason = 'Ticket is expired.';
    } else if (currentScanCount > 0 && !reEntryEnabled) {
      scanResult = 'requires_reentry_confirmation';
      admitted = false;
      requiresStaffConfirmation = true;
      reason = 'Ticket has already been scanned and re-entry is disabled.';
    } else if (currentScanCount > 0 && !confirmReEntry) {
      scanResult = 'requires_reentry_confirmation';
      admitted = false;
      requiresStaffConfirmation = true;
      reason = 'Ticket has already been scanned. Confirm re-entry before admitting.';
    } else if (currentScanCount > 0) {
      scanResult = 'reentry_accepted';
      requiresStaffConfirmation = true;
      reason = 'Re-entry accepted.';
    }

    if (!EVENT_TICKET_SCAN_RESULTS.has(scanResult)) {
      scanResult = 'invalid';
      admitted = false;
      requiresStaffConfirmation = false;
      reason = 'Ticket is not valid.';
    }

    const nextScanCount = admitted ? currentScanCount + 1 : currentScanCount;
    tx.set(scanRef, {
      eventId,
      churchId,
      ticketId: ticketSnap.exists ? ticketId : '',
      result: scanResult,
      admitted,
      requiresStaffConfirmation,
      staffUid: request.auth!.uid,
      deviceId,
      scanHashPrefix,
      priorScanCount: currentScanCount,
      scannedAt: now,
    });

    if (ticketSnap.exists && ticket && admitted) {
      tx.update(ticketRef, {
        status: ticket.status === 'paid' ? 'checked_in' : ticket.status,
        scanCount: FieldValue.increment(1),
        checkedInAt: currentScanCount === 0 ? now : ticket.checkedInAt ?? now,
        lastScanAt: now,
        lastScanResult: scanResult,
        lastScannedBy: request.auth!.uid,
        updatedAt: now,
      });
      tx.set(privateDoc.ref, {
        lastScanAt: now,
        lastScanResult: scanResult,
        scanCount: FieldValue.increment(1),
        updatedAt: now,
      }, { merge: true });
    }

    return {
      result: scanResult,
      admitted,
      requiresStaffConfirmation,
      reason,
      ticketId: ticketSnap.exists ? ticketId : '',
      scanCount: nextScanCount,
    };
  });

  return {
    success: true,
    scanId: scanRef.id,
    ...result,
  };
});

export const upsertEventMenuItem = onCall({ ...replayProtectedCallableOptions, secrets: [] }, async (request) => {
  assertFreshAppCheck(request);
  assertVerifiedNonAnonymousUser(request, 'A verified, non-anonymous account is required to manage event menus.');
  await checkRateLimit(request.auth!.uid, 'upsertEventMenuItem', 60);

  const input = callableDataRecord(request.data);
  const eventId = normalizeEventSlug(input.eventId);
  const { churchId } = await assertEventPortalAdmin(eventId, request.auth!.uid);
  await checkRateLimit(churchId, 'upsertEventMenuItemByChurch', 300, 60 * 60 * 1000);

  const menuItemId = optionalDocumentId(input.menuItemId, 'menuItemId');
  const category = assertNonEmptyString(input.category, 80, 'category');
  const name = assertNonEmptyString(input.name, 140, 'name');
  const description = optionalString(input.description, 500, 'description');
  const priceCents = assertIntegerInRange(input.priceCents, 0, MAX_EVENT_FOOD_ORDER_CENTS, 'priceCents');
  const currency = normalizeMenuCurrency(input.currency);
  const available = assertBoolean(input.available, 'available');
  const soldOut = assertBoolean(input.soldOut, 'soldOut');
  const maxPerOrder = assertIntegerInRange(input.maxPerOrder, 1, MAX_EVENT_FOOD_ORDER_ITEMS, 'maxPerOrder');
  const inventoryMode = normalizeInventoryMode(input.inventoryMode);
  const quantityAvailable = inventoryMode === 'tracked'
    ? assertIntegerInRange(input.quantityAvailable, 0, 1000000, 'quantityAvailable')
    : null;
  const sortOrder = assertIntegerInRange(input.sortOrder, -100000, 100000, 'sortOrder');

  const menuItemRef = menuItemId
    ? db.collection('eventMenuItems').doc(menuItemId)
    : db.collection('eventMenuItems').doc();
  const now = FieldValue.serverTimestamp();

  await db.runTransaction(async (tx) => {
    const existingSnap = await tx.get(menuItemRef);
    const existing = existingSnap.data();
    if (existingSnap.exists && existing?.eventId !== eventId) {
      throw new HttpsError('permission-denied', 'This menu item belongs to another event.');
    }
    if (
      existingSnap.exists
      && existing
      && existing.inventoryMode !== inventoryMode
    ) {
      await assertNoActiveOrdersForMenuItem(tx, eventId, menuItemRef.id);
    }
    const quantitySold = typeof existing?.quantitySold === 'number' && Number.isInteger(existing.quantitySold) && existing.quantitySold >= 0
      ? existing.quantitySold
      : 0;

    tx.set(menuItemRef, {
      eventId,
      churchId,
      category,
      name,
      description,
      priceCents,
      currency,
      available,
      soldOut: inventoryMode === 'tracked' && quantityAvailable === 0 ? true : soldOut,
      maxPerOrder,
      inventoryMode,
      quantityAvailable,
      quantitySold,
      sortOrder,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    });
  });

  return {
    success: true,
    menuItemId: menuItemRef.id,
  };
});

export const deleteEventMenuItem = onCall({ ...replayProtectedCallableOptions, secrets: [] }, async (request) => {
  assertFreshAppCheck(request);
  assertVerifiedNonAnonymousUser(request, 'A verified, non-anonymous account is required to manage event menus.');
  await checkRateLimit(request.auth!.uid, 'deleteEventMenuItem', 30);

  const input = callableDataRecord(request.data);
  const eventId = normalizeEventSlug(input.eventId);
  await assertEventPortalAdmin(eventId, request.auth!.uid);
  const menuItemId = optionalDocumentId(input.menuItemId, 'menuItemId');
  if (!menuItemId) {
    throw new HttpsError('invalid-argument', 'menuItemId is required.');
  }

  const menuItemRef = db.collection('eventMenuItems').doc(menuItemId);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(menuItemRef);
    if (!snap.exists) {
      return;
    }
    if (snap.data()?.eventId !== eventId) {
      throw new HttpsError('permission-denied', 'This menu item belongs to another event.');
    }
    await assertNoActiveOrdersForMenuItem(tx, eventId, menuItemId);
    tx.delete(menuItemRef);
  });

  return { success: true };
});

function foodOrderRequestId(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value)) {
    throw new HttpsError('invalid-argument', 'A valid order request ID is required. Refresh the page and try again.');
  }
  return value.toLowerCase();
}

function foodOrderId(eventId: string, requestId: string): string {
  return createHash('sha256').update(`${eventId}:${requestId}`).digest('hex');
}

export const getEventFoodOrder = onCall(appCheckCallableOptions, async (request) => {
  const input = callableDataRecord(request.data);
  const eventId = normalizeEventSlug(input.eventId);
  const requestId = foodOrderRequestId(input.requestId);
  // The random request ID is a customer-held receipt secret, never a public order code.
  const order = (await db.collection('eventOrders').doc(foodOrderId(eventId, requestId)).get()).data();
  if (!order || order.eventId !== eventId) return { order: null };
  return { order: {
    orderCode: order.orderCode, totalCents: order.totalCents, currency: order.currency,
    status: order.status, paymentStatus: order.paymentStatus,
  } };
});

export const submitEventFoodOrder = onCall({ ...replayProtectedCallableOptions, secrets: [] }, async (request) => {
  assertFreshAppCheck(request);

  const input = callableDataRecord(request.data);
  const eventId = normalizeEventSlug(input.eventId);
  const requestId = foodOrderRequestId(input.requestId);
  const customerName = assertNonEmptyString(input.customerName, 120, 'customerName');
  const customerEmail = optionalEmail(input.customerEmail, 'customerEmail');
  const customerPhone = optionalPhone(input.customerPhone, 'customerPhone');
  if (!customerEmail && !customerPhone) {
    throw new HttpsError('invalid-argument', 'Enter an email address or phone number so staff can contact you about pickup.');
  }
  const specialInstructions = optionalString(input.specialInstructions, 500, 'specialInstructions');

  const rawItems = Array.isArray(input.items) ? input.items : [];
  if (rawItems.length === 0 || rawItems.length > MAX_EVENT_FOOD_ORDER_LINES) {
    throw new HttpsError('invalid-argument', 'Choose between 1 and 20 menu items.');
  }

  const requestedItems = new Map<string, number>();
  for (const rawItem of rawItems) {
    if (typeof rawItem !== 'object' || rawItem === null || Array.isArray(rawItem)) {
      throw new HttpsError('invalid-argument', 'Order items are not valid.');
    }
    const itemRecord = rawItem as Record<string, unknown>;
    const menuItemId = optionalDocumentId(itemRecord.menuItemId, 'menuItemId');
    if (!menuItemId) {
      throw new HttpsError('invalid-argument', 'menuItemId is required.');
    }
    const quantity = assertIntegerInRange(itemRecord.quantity, 1, MAX_EVENT_FOOD_ORDER_ITEMS, 'quantity');
    requestedItems.set(menuItemId, (requestedItems.get(menuItemId) ?? 0) + quantity);
  }

  const totalRequestedQuantity = Array.from(requestedItems.values()).reduce((sum, quantity) => sum + quantity, 0);
  if (totalRequestedQuantity > MAX_EVENT_FOOD_ORDER_ITEMS) {
    throw new HttpsError('invalid-argument', 'Order quantity is too large.');
  }

  const rateSubject = request.auth?.uid || createHash('sha256').update(request.rawRequest.ip || 'anonymous').digest('hex');
  await checkRateLimit(rateSubject, 'submitEventFoodOrder', 5);
  await checkRateLimit(eventId, 'submitEventFoodOrderByEvent', 120);

  const orderRef = db.collection('eventOrders').doc(foodOrderId(eventId, requestId));
  const requestDigest = createHash('sha256').update(JSON.stringify({
    customerName, customerEmail, customerPhone, specialInstructions,
    items: Array.from(requestedItems.entries()).sort(([a], [b]) => a.localeCompare(b)),
  })).digest('hex');
  const privateRef = db.collection('eventOrderPrivate').doc(orderRef.id);
  const now = FieldValue.serverTimestamp();

  const result = await db.runTransaction(async (tx) => {
    const existingOrder = await tx.get(orderRef);
    if (existingOrder.exists) {
      const privateOrder = await tx.get(privateRef);
      if (privateOrder.data()?.requestDigest !== requestDigest) {
        throw new HttpsError('already-exists', 'This order request was already used for a different order.');
      }
      const existing = existingOrder.data()!;
      return { orderCode: existing.orderCode, totalCents: existing.totalCents, currency: existing.currency, status: existing.status, paymentStatus: existing.paymentStatus ?? 'unknown' };
    }
    const eventRef = db.collection('eventPortals').doc(eventId);
    const eventSnap = await tx.get(eventRef);
    const event = eventSnap.data();
    if (!eventSnap.exists || !event || event.status !== 'published') {
      throw new HttpsError('failed-precondition', 'This event is not accepting food orders.');
    }
    if (event.foodDrinkEnabled !== true || event.foodOrderingEnabled !== true) {
      throw new HttpsError('failed-precondition', 'Food ordering is not enabled for this event.');
    }
    if (timestampIsPast(event.endsAt, Date.now())) {
      throw new HttpsError('failed-precondition', 'Food ordering is closed for this event.');
    }
    const churchId = typeof event.churchId === 'string' ? event.churchId : '';
    if (!churchId) {
      throw new HttpsError('failed-precondition', 'This event is not ready for ordering.');
    }

    const church = await tx.get(db.collection('churches').doc(churchId));
    if (church.data()?.isActive !== true) {
      throw new HttpsError('failed-precondition', 'This parish is not accepting orders.');
    }

    const menuItemRefs = Array.from(requestedItems.keys()).map((menuItemId) => (
      db.collection('eventMenuItems').doc(menuItemId)
    ));
    const menuItemSnaps = await Promise.all(menuItemRefs.map((ref) => tx.get(ref)));
    const orderItems = [];
    let currency = '';
    let subtotalCents = 0;
    for (const menuItemSnap of menuItemSnaps) {
      const menuItem = menuItemSnap.data();
      const quantity = requestedItems.get(menuItemSnap.id) ?? 0;
      if (
        !menuItemSnap.exists
        || !menuItem
        || menuItem.eventId !== eventId
        || menuItem.available !== true
        || menuItem.soldOut === true
      ) {
        throw new HttpsError('failed-precondition', 'One or more menu items are no longer available.');
      }
      const itemCurrency = typeof menuItem.currency === 'string' ? menuItem.currency.toUpperCase() : '';
      if (!EVENT_MENU_CURRENCIES.has(itemCurrency)) {
        throw new HttpsError('failed-precondition', 'One or more menu items have invalid pricing.');
      }
      if (currency && currency !== itemCurrency) {
        throw new HttpsError('failed-precondition', 'All menu items in an order must use the same currency.');
      }
      currency = itemCurrency;
      const maxPerOrder = typeof menuItem.maxPerOrder === 'number' && Number.isInteger(menuItem.maxPerOrder)
        ? menuItem.maxPerOrder
        : 10;
      if (quantity > maxPerOrder) {
        throw new HttpsError('failed-precondition', `${menuItem.name ?? 'This item'} has a lower per-order limit.`);
      }
      const priceCents = typeof menuItem.priceCents === 'number' && Number.isInteger(menuItem.priceCents)
        ? menuItem.priceCents
        : -1;
      if (priceCents < 0 || priceCents > MAX_EVENT_FOOD_ORDER_CENTS) {
        throw new HttpsError('failed-precondition', 'One or more menu items have invalid pricing.');
      }
      const lineTotalCents = priceCents * quantity;
      subtotalCents += lineTotalCents;
      if (subtotalCents > MAX_EVENT_FOOD_ORDER_CENTS) {
        throw new HttpsError('invalid-argument', 'Order total is too large.');
      }
      const inventoryMode = menuItem.inventoryMode === 'tracked' ? 'tracked' : 'unlimited';
      const quantityAvailable = typeof menuItem.quantityAvailable === 'number' && Number.isInteger(menuItem.quantityAvailable)
        ? menuItem.quantityAvailable
        : null;
      if (inventoryMode === 'tracked') {
        if (quantityAvailable === null || quantityAvailable < quantity) {
          throw new HttpsError('failed-precondition', `${menuItem.name ?? 'This item'} is sold out or does not have enough inventory.`);
        }
        tx.update(menuItemSnap.ref, {
          quantityAvailable: FieldValue.increment(-quantity),
          quantitySold: FieldValue.increment(quantity),
          soldOut: quantityAvailable - quantity <= 0,
          updatedAt: now,
        });
      }
      orderItems.push({
        menuItemId: menuItemSnap.id,
        category: typeof menuItem.category === 'string' ? menuItem.category.slice(0, 80) : 'Menu',
        name: typeof menuItem.name === 'string' ? menuItem.name.slice(0, 140) : 'Menu item',
        quantity,
        unitPriceCents: priceCents,
        lineTotalCents,
        inventoryMode,
      });
    }

    const paymentStatus = subtotalCents > 0 ? 'pay_at_pickup' : 'not_required';
    const orderRecord = {
      eventId,
      churchId,
      orderCode: orderCodeForId(orderRef.id),
      customerName,
      customerEmail,
      customerPhone,
      specialInstructions,
      items: orderItems,
      itemCount: totalRequestedQuantity,
      subtotalCents,
      totalCents: subtotalCents,
      currency: currency || 'CAD',
      status: 'submitted',
      paymentStatus,
      paymentMethod: 'pay_at_pickup',
      inventoryAllocated: orderItems.some((item) => item.inventoryMode === 'tracked'),
      inventoryRestockedAt: null,
      createdAt: now,
      updatedAt: now,
      acceptedAt: null,
      readyAt: null,
      pickedUpAt: null,
      cancelledAt: null,
      cancellationReason: '',
    };
    tx.set(orderRef, orderRecord);
    tx.set(privateRef, {
      eventId,
      churchId,
      orderId: orderRef.id,
      customerEmail,
      customerPhone,
      requestUserId: request.auth?.uid ?? '',
      requestDigest,
      createdAt: now,
      updatedAt: now,
    });

    return {
      orderCode: orderRecord.orderCode,
      totalCents: subtotalCents,
      currency: orderRecord.currency,
      status: orderRecord.status,
      paymentStatus: orderRecord.paymentStatus,
    };
  });

  return {
    success: true,
    orderId: orderRef.id,
    orderCode: result.orderCode,
    totalCents: result.totalCents,
    currency: result.currency,
    status: result.status,
    paymentStatus: result.paymentStatus,
  };
});

export const updateEventFoodOrderStatus = onCall({ ...replayProtectedCallableOptions, secrets: [] }, async (request) => {
  assertFreshAppCheck(request);
  assertVerifiedNonAnonymousUser(request, 'A verified, non-anonymous account is required to manage food orders.');
  await checkRateLimit(request.auth!.uid, 'updateEventFoodOrderStatus', 60);

  const input = callableDataRecord(request.data);
  const eventId = normalizeEventSlug(input.eventId);
  const orderId = optionalDocumentId(input.orderId, 'orderId');
  if (!orderId) {
    throw new HttpsError('invalid-argument', 'orderId is required.');
  }
  const nextStatus = assertNonEmptyString(input.status, 32, 'status');
  if (!EVENT_ORDER_STATUSES.has(nextStatus)) {
    throw new HttpsError('invalid-argument', 'Unsupported order status.');
  }
  const paymentCollected = input.paymentCollected === undefined
    ? false
    : assertBoolean(input.paymentCollected, 'paymentCollected');
  const cancellationReason = optionalString(input.cancellationReason, 240, 'cancellationReason');
  const { churchId } = await assertEventPortalAdmin(eventId, request.auth!.uid);
  await checkRateLimit(churchId, 'updateEventFoodOrderStatusByChurch', 300, 60 * 60 * 1000);

  const orderRef = db.collection('eventOrders').doc(orderId);
  const now = FieldValue.serverTimestamp();
  await db.runTransaction(async (tx) => {
    const orderSnap = await tx.get(orderRef);
    const order = orderSnap.data();
    if (!orderSnap.exists || !order || order.eventId !== eventId) {
      throw new HttpsError('not-found', 'Order not found.');
    }
    const currentStatus = typeof order.status === 'string' ? order.status : 'submitted';
    assertOrderTransition(currentStatus, nextStatus);
    if (nextStatus === 'picked_up' && order.totalCents > 0 && !paymentCollected && order.paymentStatus !== 'paid_at_pickup') {
      throw new HttpsError('failed-precondition', 'Confirm payment was collected before pickup.');
    }

    const update: FirebaseFirestore.UpdateData<FirebaseFirestore.DocumentData> = {
      status: nextStatus,
      updatedAt: now,
      updatedBy: request.auth!.uid,
    };
    if (nextStatus === 'accepted' && currentStatus !== 'accepted') {
      update.acceptedAt = now;
    }
    if (nextStatus === 'ready' && currentStatus !== 'ready') {
      update.readyAt = now;
    }
    if (nextStatus === 'picked_up' && currentStatus !== 'picked_up') {
      update.pickedUpAt = now;
      update.paymentStatus = order.totalCents > 0 ? 'paid_at_pickup' : 'not_required';
    }
    if (nextStatus === 'cancelled' && currentStatus !== 'cancelled') {
      update.cancelledAt = now;
      update.cancellationReason = cancellationReason || 'Cancelled by event staff.';
      if (order.inventoryAllocated === true && !(order.inventoryRestockedAt instanceof Timestamp)) {
        const items = Array.isArray(order.items) ? order.items : [];
        const trackedItems = items
          .filter((item): item is FirebaseFirestore.DocumentData => (
            item
            && typeof item === 'object'
            && !Array.isArray(item)
            && item.inventoryMode === 'tracked'
            && typeof item.menuItemId === 'string'
            && typeof item.quantity === 'number'
            && Number.isInteger(item.quantity)
            && item.quantity > 0
          ));
        const menuRefs = trackedItems.map((item) => db.collection('eventMenuItems').doc(item.menuItemId));
        const menuSnaps = await Promise.all(menuRefs.map((ref) => tx.get(ref)));
        menuSnaps.forEach((menuSnap, index) => {
          const menuItem = menuSnap.data();
          const quantity = trackedItems[index].quantity;
          const quantitySold = typeof menuItem?.quantitySold === 'number' && Number.isInteger(menuItem.quantitySold)
            ? menuItem.quantitySold
            : -1;
          if (
            !menuSnap.exists
            || !menuItem
            || menuItem.eventId !== eventId
            || menuItem.inventoryMode !== 'tracked'
            || quantitySold < quantity
          ) {
            throw new HttpsError('failed-precondition', 'Tracked inventory could not be restored for this order.');
          }
          tx.update(menuSnap.ref, {
            quantityAvailable: FieldValue.increment(quantity),
            quantitySold: FieldValue.increment(-quantity),
            soldOut: false,
            updatedAt: now,
          });
        });
        update.inventoryRestockedAt = now;
      }
    }
    tx.update(orderRef, update);
  });

  return { success: true };
});

export const sendPushNotification = onCall({ ...replayProtectedCallableOptions, secrets: ['RESEND_API_KEY'] }, async (request) => {
  assertFreshAppCheck(request);
  assertVerifiedNonAnonymousUser(request, 'A verified, non-anonymous account is required to send notifications.');
  await checkRateLimit(request.auth!.uid, 'sendPushNotification', 5);

  const {
    churchId: rawChurchId,
    title: rawTitle,
    body: rawBody,
    targetRoles = ['member', 'admin', 'treasurer', 'priest'],
  } = callableDataRecord(request.data);

  const churchId = assertNonEmptyString(rawChurchId, 128, 'churchId');
  const title = assertNonEmptyString(rawTitle, 100, 'title');
  const body = assertNonEmptyString(rawBody, 300, 'body');

  if (!Array.isArray(targetRoles) || targetRoles.length === 0 || targetRoles.length > 4) {
    throw new HttpsError('invalid-argument', 'targetRoles must contain between 1 and 4 roles.');
  }
  if (targetRoles.some((role) => !['member', 'admin', 'treasurer', 'priest'].includes(role))) {
    throw new HttpsError('invalid-argument', 'targetRoles contains an unsupported role.');
  }

  const callerMembership = await assertActiveChurchRole(
    churchId,
    request.auth!.uid,
    ['admin', 'priest'],
    'Only active admins and priests can send notifications.'
  );
  const callerName: string = callerMembership.displayName ?? 'Parish Admin';
  await checkRateLimit(churchId, 'sendPushNotificationByChurch', 20, 60 * 60 * 1000);

  const churchDoc = await db.collection('churches').doc(churchId).get();
  const churchName: string = churchDoc.data()?.name ?? 'your parish';

  await notifyChurchMembers(churchId, title, body, {
    type: 'manual',
    sentBy: request.auth!.uid,
  }, targetRoles);

  let emailSent = false;
  let emailRecipientCount = 0;
  let emailRecipientTruncated = false;
  let emailSendError: string | undefined;

  try {
    const resend = getResend();
    let membersQuery: FirebaseFirestore.Query = db
      .collection('churches')
      .doc(churchId)
      .collection('members')
      .where('status', '==', 'active');

    membersQuery = membersQuery.where('role', 'in', targetRoles);
    const membersSnap = await membersQuery.get();
    const allEmails = await getPrimaryEmailsForUids(membersSnap.docs.map((doc) => doc.id));
    const emails = allEmails.slice(0, MAX_NOTIFICATION_EMAIL_RECIPIENTS);
    const appUrl = getAppUrl();
    const mobileAppUrl = getMobileAppUrl();
    const notificationEmail = renderParishNotificationEmail({
      churchName,
      title,
      body,
      senderName: callerName,
      audienceRoles: targetRoles,
      appUrl,
      mobileAppUrl,
    });

    for (let i = 0; i < emails.length; i += 50) {
      const batch = emails.slice(i, i + 50);
      const response = await resend.batch.send(batch.map((email) => ({
        from: 'Kandilo <notifications@kandilo.org>',
        to: email,
        subject: notificationEmail.subject,
        html: notificationEmail.html,
        text: notificationEmail.text,
      })));
      if (response.error) {
        console.error('Notification email provider rejected request.', {
          errorName: response.error.name ?? 'ResendError',
          batchSize: batch.length,
        });
        throw new HttpsError('internal', 'Notification email could not be sent.');
      }
    }

    emailSent = emails.length > 0;
    emailRecipientCount = emails.length;
    emailRecipientTruncated = allEmails.length > emails.length;
  } catch (err) {
    console.error('Notification email send failed:', sanitizedErrorContext(err));
    emailSendError = 'notification_email_failed';
  }

  const notificationRecord: FirebaseFirestore.DocumentData = {
    churchId,
    churchName,
    title,
    body,
    type: 'manual',
    targetRoles,
    sentAt: FieldValue.serverTimestamp(),
    sentBy: request.auth!.uid,
    sentByName: callerName,
    emailSent,
    emailRecipientCount,
    emailRecipientTruncated,
    deliveryStats: { sent: 0, failed: 0, opened: 0 },
  };

  if (emailSendError) {
    notificationRecord.emailSendError = emailSendError;
  }

  await db.collection('notifications').add(notificationRecord);

  return { success: true };
});

export const sendEventAnnouncement = onCall({ ...replayProtectedCallableOptions, secrets: ['RESEND_API_KEY'] }, async (request) => {
  assertFreshAppCheck(request);
  assertVerifiedNonAnonymousUser(request, 'A verified, non-anonymous account is required to send event announcements.');
  await checkRateLimit(request.auth!.uid, 'sendEventAnnouncement', 10);

  const input = callableDataRecord(request.data);
  const eventId = normalizeEventSlug(input.eventId);
  const title = assertNonEmptyString(input.title, 120, 'title');
  const body = assertNonEmptyString(input.body, 500, 'body');
  const rawPriority = typeof input.priority === 'string' ? input.priority : 'info';
  const priority = EVENT_ANNOUNCEMENT_PRIORITIES.has(rawPriority) ? rawPriority : 'info';
  const rawChannels = Array.isArray(input.channels) ? input.channels : ['inApp', 'push', 'email'];
  const channels = rawChannels
    .filter((channel): channel is string => typeof channel === 'string')
    .filter((channel) => EVENT_ANNOUNCEMENT_CHANNELS.has(channel));

  if (channels.length === 0) {
    throw new HttpsError('invalid-argument', 'At least one announcement channel is required.');
  }

  const eventSnap = await db.collection('eventPortals').doc(eventId).get();
  const eventPortal = eventSnap.data();
  if (!eventSnap.exists || !eventPortal) {
    throw new HttpsError('not-found', 'Event was not found.');
  }
  const churchId = typeof eventPortal.churchId === 'string' ? eventPortal.churchId : '';
  const eventTitle = typeof eventPortal.title === 'string' ? eventPortal.title : 'Event';
  const eventSlug = typeof eventPortal.slug === 'string' && EVENT_SLUG_PATTERN.test(eventPortal.slug)
    ? eventPortal.slug
    : '';
  if (!churchId) {
    throw new HttpsError('failed-precondition', 'Standalone event announcements are not enabled yet.');
  }
  if (eventPortal.status !== 'published') {
    throw new HttpsError('failed-precondition', 'Publish the event before sending announcements.');
  }
  if (!eventSlug) {
    throw new HttpsError('failed-precondition', 'Event must have a valid public slug before announcements can be sent.');
  }
  if (eventSlug !== eventId) {
    throw new HttpsError('failed-precondition', 'Event slug must match its public URL before announcements can be sent.');
  }

  const callerMembership = await assertActiveChurchRole(
    churchId,
    request.auth!.uid,
    ['admin', 'priest'],
    'Only active admins and priests can send event announcements.'
  );
  const callerName: string = callerMembership.displayName ?? 'Event Admin';
  await checkRateLimit(churchId, 'sendEventAnnouncementByChurch', 30, 60 * 60 * 1000);

  const announcementRef = db.collection('eventAnnouncements').doc();
  const announcementRecord: FirebaseFirestore.DocumentData = {
    eventId,
    churchId,
    title,
    body,
    priority,
    channels,
    status: 'sent',
    sentAt: FieldValue.serverTimestamp(),
    sentByName: callerName,
  };

  let pushSent = false;
  const deliveredChannels = new Set<string>(channels.includes('inApp') ? ['inApp'] : []);
  const failedChannels = new Set<string>();
  if (channels.includes('push')) {
    try {
      await notifyChurchMembers(churchId, title, body, {
        type: 'eventAnnouncement',
        eventId,
        eventSlug: eventId,
        announcementId: announcementRef.id,
        priority,
      });
      pushSent = true;
      deliveredChannels.add('push');
    } catch (error) {
      console.error('Event announcement push fanout failed:', sanitizedErrorContext(error));
      failedChannels.add('push');
    }
  }

  let emailSent = false;
  let emailRecipientCount = 0;
  let emailRecipientTruncated = false;
  if (channels.includes('email')) {
    try {
      const churchDoc = await db.collection('churches').doc(churchId).get();
      const churchName: string = churchDoc.data()?.name ?? 'your parish';
      const { allEmails: emails, truncated } = await eventAnnouncementRecipientEmails(eventId, churchId);
      const appUrl = eventWebUrl(eventSlug);
      const mobileAppUrl = eventMobileUrl(eventSlug);
      const email = renderParishNotificationEmail({
        churchName: `${eventTitle} via ${churchName}`,
        title,
        body,
        senderName: callerName,
        audienceRoles: ['member', 'admin', 'treasurer', 'priest'],
        appUrl,
        mobileAppUrl,
      });
      const resend = getResend();
      for (let i = 0; i < emails.length; i += 50) {
        const batch = emails.slice(i, i + 50);
        const response = await resend.batch.send(batch.map((recipientEmail) => ({
          from: 'Kandilo <notifications@kandilo.org>',
          to: recipientEmail,
          subject: email.subject,
          html: email.html,
          text: email.text,
        })));
        if (response.error) {
          throw new HttpsError('internal', 'Event announcement email could not be sent.');
        }
      }
      emailSent = emails.length > 0;
      emailRecipientCount = emails.length;
      emailRecipientTruncated = truncated;
      if (emailSent) {
        deliveredChannels.add('email');
      }
    } catch (error) {
      console.error('Event announcement email send failed:', sanitizedErrorContext(error));
      failedChannels.add('email');
    }
  }

  const deliveryRecord = {
    eventId,
    churchId,
    sentBy: request.auth!.uid,
    sentByName: callerName,
    requestedChannels: channels,
    deliveredChannels: Array.from(deliveredChannels),
    failedChannels: Array.from(failedChannels),
    sentAt: FieldValue.serverTimestamp(),
    deliveryStats: {
      pushSent,
      emailSent,
      emailRecipientCount,
      emailRecipientTruncated,
    },
  };

  await db.batch()
    .set(announcementRef, announcementRecord)
    .set(db.collection('eventAnnouncementDelivery').doc(announcementRef.id), deliveryRecord)
    .commit();

  return {
    success: true,
    announcementId: announcementRef.id,
    pushSent,
    emailSent,
    emailRecipientCount,
  };
});
