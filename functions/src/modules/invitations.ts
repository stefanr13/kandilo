import { FieldValue } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { getResend } from '../shared/clients';
import { db, auth } from '../shared/firebase';
import { FIRESTORE_REGION } from '../shared/regions';
import {
  assertFreshAppCheck,
  assertActiveChurchRole,
  assertVerifiedNonAnonymousUser,
  checkRateLimit,
  normalizeEmail,
  replayProtectedCallableOptions,
} from '../shared/security';
import { sanitizedErrorContext } from '../shared/logging';
import { assertEmail, assertNonEmptyString, escapeHtml } from '../shared/validation';

const DEFAULT_APP_URL = 'https://app.kandilo.org';

function getAppUrl(): string {
  return process.env.APP_URL?.trim() || DEFAULT_APP_URL;
}

export const acceptInvitation = onCall({ ...replayProtectedCallableOptions, secrets: [] }, async (request) => {
  assertFreshAppCheck(request);
  assertVerifiedNonAnonymousUser(request, 'A verified, non-anonymous account is required to accept invitations.');

  const { invitationId: rawInvitationId } = request.data as { invitationId: unknown };
  const invitationId = assertNonEmptyString(rawInvitationId, 128, 'invitationId');

  const inviteRef = db.collection('invitations').doc(invitationId);
  const inviteDoc = await inviteRef.get();

  if (!inviteDoc.exists) {
    throw new HttpsError('not-found', 'Invitation not found.');
  }

  const invite = inviteDoc.data()!;

  if (invite.status !== 'pending') {
    throw new HttpsError('failed-precondition', `Invitation is already ${invite.status}.`);
  }

  const expiresAt: FirebaseFirestore.Timestamp = invite.expiresAt;
  if (expiresAt && expiresAt.toDate() < new Date()) {
    await inviteRef.update({ status: 'expired' });
    throw new HttpsError('deadline-exceeded', 'This invitation has expired.');
  }

  const userRecord = await auth.getUser(request.auth!.uid);
  const inviteeEmail = normalizeEmail(invite.inviteeEmail ?? '');
  if (normalizeEmail(userRecord.email ?? '') !== inviteeEmail) {
    throw new HttpsError('permission-denied', 'This invitation was sent to a different email address.');
  }

  const { churchId } = invite;
  const uid = request.auth!.uid;
  const role = invite.role as string | undefined;

  if (!['member', 'admin'].includes(role ?? '')) {
    throw new HttpsError('failed-precondition', 'Invitation role is invalid.');
  }

  const existingMember = await db.collection('churches').doc(churchId).collection('members').doc(uid).get();
  if (existingMember.exists) {
    if (existingMember.data()?.status !== 'active') {
      throw new HttpsError('failed-precondition', 'This membership is not active.');
    }
    await inviteRef.update({ status: 'accepted' });
    return { success: true, alreadyMember: true };
  }

  const churchDoc = await db.collection('churches').doc(churchId).get();
  const church = churchDoc.data();
  if (!church) {
    throw new HttpsError('not-found', 'Church not found.');
  }
  if (church.isActive === false) {
    throw new HttpsError('failed-precondition', 'This church is not currently accepting memberships.');
  }

  const inviterUid = typeof invite.invitedBy === 'string' ? invite.invitedBy : '';
  if (!inviterUid) {
    throw new HttpsError('failed-precondition', 'Invitation metadata is incomplete.');
  }

  const inviterMembership = await assertActiveChurchRole(
    churchId,
    inviterUid,
    ['admin', 'priest'],
    'This invitation is no longer valid.'
  );
  if (role === 'admin' && inviterMembership.role !== 'priest') {
    throw new HttpsError('permission-denied', 'Only priests may invite another admin.');
  }

  const displayName = userRecord.displayName ?? '';
  const email = userRecord.email ?? '';
  const photoURL = userRecord.photoURL ?? '';
  const now = FieldValue.serverTimestamp();
  const batch = db.batch();

  batch.set(db.collection('churches').doc(churchId).collection('members').doc(uid), {
    userId: uid,
    churchId,
    role,
    status: 'active',
    displayName,
    email,
    photoURL,
    joinedAt: now,
  });

  batch.set(db.collection('users').doc(uid).collection('churchMemberships').doc(churchId), {
    churchId,
    churchName: church.name ?? '',
    location: church.location ?? '',
    imageURL: church.imageURL ?? '',
    role,
    status: 'active',
    joinedAt: now,
  });

  batch.update(inviteRef, { status: 'accepted', acceptedAt: now });

  await batch.commit();

  return { success: true };
});

export const sendInvitation = onCall({ ...replayProtectedCallableOptions, secrets: ['RESEND_API_KEY'] }, async (request) => {
  assertFreshAppCheck(request);
  assertVerifiedNonAnonymousUser(request, 'A verified, non-anonymous account is required to invite members.');
  await checkRateLimit(request.auth!.uid, 'sendInvitation', 5);

  const { churchId: rawChurchId, inviteeEmail: rawInviteeEmail, role = 'member' } = request.data as {
    churchId: unknown;
    inviteeEmail: unknown;
    role?: unknown;
  };

  const churchId = assertNonEmptyString(rawChurchId, 128, 'churchId');
  const normalizedInviteeEmail = assertEmail(
    assertNonEmptyString(rawInviteeEmail, 254, 'inviteeEmail'),
    'inviteeEmail'
  );

  if (role !== 'member' && role !== 'admin') {
    throw new HttpsError('invalid-argument', 'role must be member or admin.');
  }

  await checkRateLimit(churchId, 'sendInvitationByChurch', 30, 60 * 60 * 1000);

  const callerMembership = await assertActiveChurchRole(
    churchId,
    request.auth!.uid,
    ['admin', 'priest'],
    'Only active admins and priests can invite members.'
  );
  const callerRole = callerMembership.role;
  if (role === 'admin' && callerRole !== 'priest') {
    throw new HttpsError('permission-denied', 'Only priests can invite another admin.');
  }

  const churchDoc = await db.collection('churches').doc(churchId).get();
  if (!churchDoc.exists) {
    throw new HttpsError('not-found', 'Church not found.');
  }
  if (churchDoc.data()?.isActive === false) {
    throw new HttpsError('failed-precondition', 'Inactive churches cannot issue invitations.');
  }
  const churchName: string = churchDoc.data()?.name ?? 'your parish';

  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 14);

  const inviteRef = await db.collection('invitations').add({
    churchId,
    churchName,
    invitedBy: request.auth!.uid,
    invitedByName: callerMembership.displayName ?? '',
    inviteeEmail: normalizedInviteeEmail,
    role,
    status: 'pending',
    emailDeliveryStatus: 'pending',
    createdAt: FieldValue.serverTimestamp(),
    expiresAt,
  });

  const appUrl = getAppUrl();
  const inviteUrl = `${appUrl}/join/${inviteRef.id}`;

  try {
    const resend = getResend();
    const safeChurchName = escapeHtml(churchName);
    const safeInviteUrl = escapeHtml(inviteUrl);
    const response = await resend.emails.send({
      from: 'Kandilo <invite@kandilo.org>',
      to: normalizedInviteeEmail,
      subject: `You've been invited to ${safeChurchName} on Kandilo`,
      html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
          <h1 style="color: #800000;">You're invited!</h1>
          <p>You've been invited to join <strong>${safeChurchName}</strong> on Kandilo, the digital platform for Orthodox parish communities.</p>
          <a href="${safeInviteUrl}" style="display: inline-block; background: #800000; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: bold; margin: 16px 0;">
            Accept Invitation
          </a>
          <p style="color: #aaa; font-size: 12px; margin-top: 24px;">
            This invitation expires in 14 days. If you did not expect this, you can safely ignore this email.
          </p>
        </div>
      `,
    });
    if (response.error) {
      console.error('Invitation email provider rejected request.', {
        errorName: response.error.name ?? 'ResendError',
      });
      throw new Error('Invitation email provider rejected request.');
    }
    await inviteRef.update({
      emailDeliveryStatus: 'sent',
      emailSentAt: FieldValue.serverTimestamp(),
      emailProviderId: response.data?.id ?? '',
    });
  } catch (err) {
    console.error('Invitation email failed:', sanitizedErrorContext(err));
    await inviteRef.update({
      emailDeliveryStatus: 'failed',
      emailFailureAt: FieldValue.serverTimestamp(),
    });
    return {
      success: true,
      invitationId: inviteRef.id,
      inviteUrl,
      emailSent: false,
    };
  }

  return { success: true, invitationId: inviteRef.id, inviteUrl, emailSent: true };
});

export const cleanupExpiredInvitations = onSchedule({ schedule: 'every 24 hours', region: FIRESTORE_REGION }, async () => {
  const now = new Date();
  const snap = await db
    .collection('invitations')
    .where('status', '==', 'pending')
    .where('expiresAt', '<', now)
    .get();

  if (snap.empty) return;

  let batch = db.batch();
  let pendingWrites = 0;
  for (const doc of snap.docs) {
    batch.update(doc.ref, { status: 'expired' });
    pendingWrites++;
    if (pendingWrites === 450) {
      await batch.commit();
      batch = db.batch();
      pendingWrites = 0;
    }
  }
  if (pendingWrites > 0) {
    await batch.commit();
  }

  console.log(`Marked ${snap.size} invitation(s) as expired.`);
});
