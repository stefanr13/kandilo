import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { onDocumentCreated, onDocumentUpdated } from 'firebase-functions/v2/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { getResend } from '../shared/clients';
import { db } from '../shared/firebase';
import { notifyChurchMembers } from '../shared/notify';
import { FIRESTORE_REGION } from '../shared/regions';
import {
  assertFreshAppCheck,
  assertActiveChurchRole,
  assertVerifiedNonAnonymousUser,
  checkRateLimit,
  getPrimaryEmailsForUids,
  replayProtectedCallableOptions,
} from '../shared/security';
import { sanitizedErrorContext } from '../shared/logging';
import { renderNewsletterEmail, renderParishNotificationEmail } from '../shared/emailTemplates';
import { assertNonEmptyString } from '../shared/validation';

const DEFAULT_APP_URL = 'https://app.kandilo.org';
const DEFAULT_MOBILE_APP_URL = 'kandilo://app/';
const NEWSLETTER_EMAIL_CLAIM_TIMEOUT_MS = 15 * 60 * 1000;
const MAX_NEWSLETTER_EMAIL_RECIPIENTS = 1000;
const MAX_NOTIFICATION_EMAIL_RECIPIENTS = 1000;

function getAppUrl(): string {
  return process.env.APP_URL?.trim() || DEFAULT_APP_URL;
}

function getMobileAppUrl(): string {
  return process.env.MOBILE_APP_URL?.trim() || DEFAULT_MOBILE_APP_URL;
}

export const onEventCreated = onDocumentCreated({ region: FIRESTORE_REGION, document: 'events/{eventId}' }, async (event) => {
  const data = event.data?.data();
  if (!data) return;

  const { churchId, title, startTime } = data;
  if (typeof churchId !== 'string' || typeof title !== 'string' || !churchId || !title) return;

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
    targetRoles: ['member', 'admin', 'priest'],
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
    targetRoles: ['member', 'admin', 'priest'],
    newsletterId,
    sentAt: FieldValue.serverTimestamp(),
    sentBy: 'system',
    deliveryStats: { sent: 0, failed: 0, opened: 0 },
  });

  try {
    const resend = getResend();
    const churchDoc = await db.collection('churches').doc(churchId).get();
    const churchName: string = churchDoc.data()?.name ?? 'your parish';
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

export const sendPushNotification = onCall({ ...replayProtectedCallableOptions, secrets: ['RESEND_API_KEY'] }, async (request) => {
  assertFreshAppCheck(request);
  assertVerifiedNonAnonymousUser(request, 'A verified, non-anonymous account is required to send notifications.');
  await checkRateLimit(request.auth!.uid, 'sendPushNotification', 5);

  const { churchId: rawChurchId, title: rawTitle, body: rawBody, targetRoles = ['member', 'admin', 'priest'] } = request.data as {
    churchId: unknown;
    title: unknown;
    body: unknown;
    targetRoles?: unknown;
  };

  const churchId = assertNonEmptyString(rawChurchId, 128, 'churchId');
  const title = assertNonEmptyString(rawTitle, 100, 'title');
  const body = assertNonEmptyString(rawBody, 300, 'body');
  await checkRateLimit(churchId, 'sendPushNotificationByChurch', 20, 60 * 60 * 1000);

  if (!Array.isArray(targetRoles) || targetRoles.length === 0 || targetRoles.length > 3) {
    throw new HttpsError('invalid-argument', 'targetRoles must contain between 1 and 3 roles.');
  }
  if (targetRoles.some((role) => !['member', 'admin', 'priest'].includes(role))) {
    throw new HttpsError('invalid-argument', 'targetRoles contains an unsupported role.');
  }

  const callerMembership = await assertActiveChurchRole(
    churchId,
    request.auth!.uid,
    ['admin', 'priest'],
    'Only active admins and priests can send notifications.'
  );
  const callerName: string = callerMembership.displayName ?? 'Parish Admin';
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
