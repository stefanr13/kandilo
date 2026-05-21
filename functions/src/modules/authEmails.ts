import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { getResend } from '../shared/clients';
import { auth } from '../shared/firebase';
import {
  assertFreshAppCheck,
  assertNonAnonymousUser,
  checkRateLimit,
  normalizeEmail,
  replayProtectedCallableOptions,
} from '../shared/security';
import {
  renderEmailVerificationEmail,
  renderPasswordResetEmail,
} from '../shared/emailTemplates';
import { sanitizedErrorContext } from '../shared/logging';
import { assertEmail, assertNonEmptyString } from '../shared/validation';

const DEFAULT_APP_URL = 'https://app.kandilo.org';

function getAppUrl(): string {
  return process.env.APP_URL?.trim() || DEFAULT_APP_URL;
}

function actionCodeSettings(mode: 'verify-email' | 'reset-password') {
  return {
    url: `${getAppUrl()}/?authAction=${mode}`,
    handleCodeInApp: false,
  };
}

export const sendEmailVerificationEmail = onCall(
  { ...replayProtectedCallableOptions, secrets: ['RESEND_API_KEY'] },
  async (request) => {
    assertFreshAppCheck(request);
    assertNonAnonymousUser(request, 'A non-anonymous account is required to verify email.');
    await checkRateLimit(request.auth!.uid, 'sendEmailVerificationEmail', 3, 60 * 60 * 1000);

    const userRecord = await auth.getUser(request.auth!.uid);
    if (!userRecord.email) {
      throw new HttpsError('failed-precondition', 'Your account needs an email address before verification.');
    }
    if (userRecord.emailVerified) {
      return { success: true, emailSent: false, alreadyVerified: true };
    }

    const link = await auth.generateEmailVerificationLink(
      userRecord.email,
      actionCodeSettings('verify-email')
    );
    const email = renderEmailVerificationEmail({
      displayName: userRecord.displayName ?? 'there',
      verificationUrl: link,
    });

    const response = await getResend().emails.send({
      from: 'Kandilo <auth@kandilo.org>',
      to: userRecord.email,
      subject: email.subject,
      html: email.html,
      text: email.text,
    });
    if (response.error) {
      console.error('Email verification provider rejected request.', {
        errorName: response.error.name ?? 'ResendError',
      });
      throw new HttpsError('internal', 'Verification email could not be sent.');
    }

    return { success: true, emailSent: true };
  }
);

export const sendPasswordResetEmail = onCall(
  { ...replayProtectedCallableOptions, secrets: ['RESEND_API_KEY'] },
  async (request) => {
    assertFreshAppCheck(request);

    const { email: rawEmail } = request.data as { email?: unknown };
    const email = assertEmail(assertNonEmptyString(rawEmail, 254, 'email'), 'email');
    await checkRateLimit(normalizeEmail(email), 'sendPasswordResetEmail', 3, 60 * 60 * 1000);

    let userRecord;
    try {
      userRecord = await auth.getUserByEmail(email);
    } catch (error) {
      console.warn('Password reset requested for non-existent email.', sanitizedErrorContext(error));
      return { success: true, emailSent: false };
    }

    if (userRecord.disabled || !userRecord.email) {
      return { success: true, emailSent: false };
    }

    const link = await auth.generatePasswordResetLink(
      userRecord.email,
      actionCodeSettings('reset-password')
    );
    const resetEmail = renderPasswordResetEmail({
      displayName: userRecord.displayName ?? 'there',
      resetUrl: link,
    });

    const response = await getResend().emails.send({
      from: 'Kandilo <auth@kandilo.org>',
      to: userRecord.email,
      subject: resetEmail.subject,
      html: resetEmail.html,
      text: resetEmail.text,
    });
    if (response.error) {
      console.error('Password reset email provider rejected request.', {
        errorName: response.error.name ?? 'ResendError',
      });
      throw new HttpsError('internal', 'Password reset email could not be sent.');
    }

    return { success: true, emailSent: true };
  }
);
