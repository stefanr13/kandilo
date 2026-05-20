import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { onDocumentCreated, onDocumentUpdated } from 'firebase-functions/v2/firestore';
import { HttpsError, onCall, onRequest } from 'firebase-functions/v2/https';
import { getResend, getStripe } from '../shared/clients';
import { db } from '../shared/firebase';
import { FIRESTORE_REGION } from '../shared/regions';
import {
  appCheckCallableOptions,
  assertFreshAppCheck,
  assertActiveChurch,
  assertActiveChurchRole,
  assertVerifiedNonAnonymousUser,
  checkRateLimit,
  getPrimaryEmailsForUids,
  replayProtectedCallableOptions,
} from '../shared/security';
import { sanitizedErrorContext } from '../shared/logging';
import {
  assertBoolean,
  assertIntegerInRange,
  assertMaxLength,
  assertNonEmptyString,
  escapeHtml,
} from '../shared/validation';

const DEFAULT_APP_URL = 'https://app.kandilo.org';
const MIN_DONATION_CENTS = 50;
const MAX_DONATION_CENTS = 1_000_000;
const ALLOWED_CURRENCIES = new Set(['usd']);
const RECEIPT_CLAIM_TIMEOUT_MS = 15 * 60 * 1000;

function getAppUrl(): string {
  return process.env.APP_URL?.trim() || DEFAULT_APP_URL;
}

function checkoutUrlIsSafe(url: string | null): url is string {
  return typeof url === 'string' && url.startsWith('https://checkout.stripe.com/');
}

function timestampFromStripeSeconds(value: unknown): Timestamp | null {
  return typeof value === 'number' ? Timestamp.fromMillis(value * 1000) : null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function findGivingRefForSession(session: any): Promise<FirebaseFirestore.DocumentReference | null> {
  const metadataGivingId = typeof session.metadata?.givingId === 'string' ? session.metadata.givingId : '';
  if (/^[A-Za-z0-9_-]{1,128}$/.test(metadataGivingId)) {
    const ref = db.collection('giving').doc(metadataGivingId);
    if ((await ref.get()).exists) {
      return ref;
    }
  }

  if (typeof session.id !== 'string') {
    return null;
  }

  const snap = await db
    .collection('giving')
    .where('stripeCheckoutSessionId', '==', session.id)
    .limit(1)
    .get();

  return snap.empty ? null : snap.docs[0].ref;
}

export const createStripeCheckoutSession = onCall(
  { ...replayProtectedCallableOptions, secrets: ['STRIPE_SECRET_KEY'] },
  async (request) => {
    assertFreshAppCheck(request);
    assertVerifiedNonAnonymousUser(request, 'A verified, non-anonymous account is required to donate.');
    await checkRateLimit(request.auth!.uid, 'createStripeCheckoutSession', 5);

    const input = request.data as {
      churchId?: unknown;
      amountCents?: unknown;
      currency?: unknown;
      purpose?: unknown;
      anonymous?: unknown;
    };

    const churchId = assertNonEmptyString(input.churchId, 128, 'churchId');
    const amountCents = assertIntegerInRange(
      input.amountCents,
      MIN_DONATION_CENTS,
      MAX_DONATION_CENTS,
      'amountCents'
    );
    const normalizedCurrency =
      typeof input.currency === 'string' && input.currency.trim()
        ? input.currency.trim().toLowerCase()
        : 'usd';
    assertMaxLength(normalizedCurrency, 10, 'currency');
    if (!ALLOWED_CURRENCIES.has(normalizedCurrency)) {
      throw new HttpsError('invalid-argument', 'Unsupported currency.');
    }

    const purpose =
      typeof input.purpose === 'string' && input.purpose.trim()
        ? input.purpose.trim()
        : 'General Fund';
    assertMaxLength(purpose, 200, 'purpose');
    const anonymous =
      input.anonymous === undefined ? false : assertBoolean(input.anonymous, 'anonymous');

    const customerEmail =
      typeof request.auth!.token.email === 'string' ? request.auth!.token.email : undefined;
    if (!customerEmail) {
      throw new HttpsError('failed-precondition', 'Your account needs an email address before donating.');
    }

    const membership = await assertActiveChurchRole(
      churchId,
      request.auth!.uid,
      ['member', 'admin', 'priest'],
      'You must be an active member to donate to this church.'
    );
    const church = await assertActiveChurch(churchId);
    const churchName: string = typeof church.name === 'string' ? church.name : 'Parish';

    const givingRef = db.collection('giving').doc();
    const now = FieldValue.serverTimestamp();
    await givingRef.set({
      churchId,
      churchName,
      userId: request.auth!.uid,
      donorRole: membership.role ?? 'member',
      amount: amountCents / 100,
      amountCents,
      currency: normalizedCurrency.toUpperCase(),
      purpose,
      anonymous,
      recurring: false,
      status: 'creating',
      createdAt: now,
      updatedAt: now,
    });

    try {
      const stripe = getStripe();
      const appUrl = getAppUrl();
      const session = await stripe.checkout.sessions.create(
        {
          mode: 'payment',
          success_url: `${appUrl}/?giving=success&churchId=${encodeURIComponent(churchId)}&givingId=${givingRef.id}&session_id={CHECKOUT_SESSION_ID}`,
          cancel_url: `${appUrl}/?giving=cancel&churchId=${encodeURIComponent(churchId)}&givingId=${givingRef.id}`,
          customer_email: customerEmail,
          client_reference_id: givingRef.id,
          metadata: {
            givingId: givingRef.id,
            churchId,
            churchName,
            userId: request.auth!.uid,
            amountCents: String(amountCents),
            currency: normalizedCurrency,
            purpose,
            anonymous: anonymous ? 'true' : 'false',
          },
          line_items: [
            {
              quantity: 1,
              price_data: {
                currency: normalizedCurrency,
                unit_amount: amountCents,
                product_data: {
                  name: `${churchName} Donation`,
                  description: purpose,
                },
              },
            },
          ],
        },
        { idempotencyKey: `checkout_${givingRef.id}` }
      );

      if (!checkoutUrlIsSafe(session.url)) {
        throw new HttpsError('internal', 'Stripe did not return a valid Checkout URL.');
      }

      await givingRef.update({
        status: 'pending',
        stripeCheckoutSessionId: session.id,
        stripeCheckoutSessionExpiresAt: timestampFromStripeSeconds(session.expires_at),
        updatedAt: FieldValue.serverTimestamp(),
      });

      return {
        checkoutUrl: session.url,
        givingId: givingRef.id,
        sessionId: session.id,
      };
    } catch (error) {
      await givingRef.update({
        status: 'failed',
        failureReason: 'Unable to create Stripe Checkout session.',
        updatedAt: FieldValue.serverTimestamp(),
      }).catch(() => undefined);

      if (error instanceof HttpsError) {
        throw error;
      }
      console.error('Stripe Checkout session creation failed:', sanitizedErrorContext(error));
      throw new HttpsError('internal', 'Unable to start secure checkout right now.');
    }
  }
);

export const stripeWebhook = onRequest(
  { secrets: ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET'] },
  async (req, res) => {
    if (req.method !== 'POST') {
      res.status(405).set('Allow', 'POST').send('Method Not Allowed');
      return;
    }

    const stripe = getStripe();
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

    if (!webhookSecret) {
      console.error('STRIPE_WEBHOOK_SECRET not set');
      res.status(500).send('Webhook secret not configured');
      return;
    }

    const sig = req.headers['stripe-signature'];
    if (!sig) {
      res.status(400).send('Missing stripe-signature header');
      return;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let stripeEvent: any;
    try {
      stripeEvent = stripe.webhooks.constructEvent(req.rawBody, sig, webhookSecret);
    } catch (err) {
      console.error('Webhook signature verification failed:', sanitizedErrorContext(err));
      res.status(400).send('Webhook signature verification failed.');
      return;
    }

    try {
      switch (stripeEvent.type as string) {
        case 'checkout.session.completed':
        case 'checkout.session.expired':
        case 'checkout.session.async_payment_failed': {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const session = stripeEvent.data.object as any;
          const givingRef = await findGivingRefForSession(session);
          const eventRef = db.collection('stripeWebhookEvents').doc(stripeEvent.id);

          await db.runTransaction(async (tx) => {
            const existingEvent = await tx.get(eventRef);
            if (existingEvent.exists) {
              return;
            }

            if (!givingRef) {
              tx.set(eventRef, {
                type: stripeEvent.type,
                stripeSessionId: typeof session.id === 'string' ? session.id : null,
                status: 'missing_giving',
                processedAt: FieldValue.serverTimestamp(),
              });
              return;
            }

            const givingSnap = await tx.get(givingRef);
            if (!givingSnap.exists) {
              tx.set(eventRef, {
                type: stripeEvent.type,
                stripeSessionId: typeof session.id === 'string' ? session.id : null,
                givingId: givingRef.id,
                status: 'missing_giving',
                processedAt: FieldValue.serverTimestamp(),
              });
              return;
            }

            const giving = givingSnap.data()!;
            const expectedAmountCents =
              typeof giving.amountCents === 'number'
                ? giving.amountCents
                : Math.round(((giving.amount as number) ?? 0) * 100);
            const expectedCurrency = String(giving.currency ?? '').toLowerCase();
            const metadata = session.metadata ?? {};
            const metadataMatches =
              metadata.givingId === givingRef.id
              && metadata.churchId === giving.churchId
              && metadata.userId === giving.userId
              && metadata.amountCents === String(expectedAmountCents)
              && metadata.currency === expectedCurrency;
            const sessionMatches =
              session.id === giving.stripeCheckoutSessionId
              && session.amount_total === expectedAmountCents
              && String(session.currency ?? '').toLowerCase() === expectedCurrency;

            if (!metadataMatches || !sessionMatches) {
              tx.set(eventRef, {
                type: stripeEvent.type,
                stripeSessionId: typeof session.id === 'string' ? session.id : null,
                givingId: givingRef.id,
                status: 'validation_failed',
                processedAt: FieldValue.serverTimestamp(),
              });
              return;
            }

            if (stripeEvent.type === 'checkout.session.completed') {
              if (session.payment_status !== 'paid') {
                tx.set(eventRef, {
                  type: stripeEvent.type,
                  stripeSessionId: session.id,
                  givingId: givingRef.id,
                  status: 'unpaid_session',
                  processedAt: FieldValue.serverTimestamp(),
                });
                return;
              }

              if (giving.status !== 'completed') {
                tx.update(givingRef, {
                  status: 'completed',
                  completedAt: FieldValue.serverTimestamp(),
                  stripePaymentIntentId:
                    typeof session.payment_intent === 'string' ? session.payment_intent : null,
                  stripePaymentStatus: session.payment_status,
                  updatedAt: FieldValue.serverTimestamp(),
                });
              }
            } else if (giving.status !== 'completed') {
              tx.update(givingRef, {
                status: 'failed',
                failureReason:
                  stripeEvent.type === 'checkout.session.expired'
                    ? 'Checkout session expired.'
                    : 'Payment failed.',
                updatedAt: FieldValue.serverTimestamp(),
              });
            }

            tx.set(eventRef, {
              type: stripeEvent.type,
              stripeSessionId: session.id,
              givingId: givingRef.id,
              status: 'processed',
              processedAt: FieldValue.serverTimestamp(),
            });
          });
          break;
        }

        default:
          break;
      }
    } catch (err) {
      console.error('Webhook handler error:', sanitizedErrorContext(err));
      res.status(500).send('Internal error');
      return;
    }

    res.status(200).json({ received: true });
  }
);

// Deprecated production compatibility shim. This function name exists in the
// live project from an older payment flow; keep the export so the next deploy
// overwrites it with a safe implementation instead of leaving remote-only code.
export const createStripePaymentIntent = onCall(
  { ...appCheckCallableOptions, secrets: ['STRIPE_SECRET_KEY'] },
  async () => {
    throw new HttpsError('failed-precondition', 'This payment flow has been retired. Use Stripe Checkout.');
  }
);

// Deprecated production compatibility shim. Giving writes are now finalized by
// stripeWebhook and onGivingCompleted; create-trigger payment logic is disabled.
export const onGivingCreated = onDocumentCreated({ region: FIRESTORE_REGION, document: 'giving/{givingId}' }, async (event) => {
  console.warn('Deprecated onGivingCreated trigger ignored.', { givingId: event.params.givingId });
});

export const onGivingCompleted = onDocumentUpdated(
  { region: FIRESTORE_REGION, document: 'giving/{givingId}', secrets: ['RESEND_API_KEY'] },
  async (event) => {
    const before = event.data?.before.data();
    const after = event.data?.after.data();
    if (!after) return;
    if (before?.status === 'completed' || after.status !== 'completed' || after.receiptEmailSentAt) {
      return;
    }

    const givingRef = event.data?.after.ref;
    if (!givingRef) return;

    const claimed = await db.runTransaction(async (tx) => {
      const snap = await tx.get(givingRef);
      const current = snap.data();
      if (!current || current.status !== 'completed' || current.receiptEmailSentAt) {
        return false;
      }

      const sendingAt = current.receiptEmailSendingAt;
      if (sendingAt instanceof Timestamp && Date.now() - sendingAt.toMillis() < RECEIPT_CLAIM_TIMEOUT_MS) {
        return false;
      }

      tx.update(givingRef, {
        receiptEmailSendingAt: FieldValue.serverTimestamp(),
        receiptEmailError: FieldValue.delete(),
      });
      return true;
    });

    if (!claimed) return;

    const { userId, churchId, amount, currency = 'USD', purpose } = after;
    if (!userId || !churchId) {
      await givingRef.update({
        receiptEmailSendingAt: FieldValue.delete(),
        receiptEmailError: 'receipt_missing_metadata',
      }).catch(() => undefined);
      return;
    }

    try {
      const userDoc = await db.collection('users').doc(userId).get();
      const email = (await getPrimaryEmailsForUids([userId]))[0];
      const displayName: string = userDoc.data()?.displayName ?? 'Parishioner';
      if (!email) {
        await givingRef.update({
          receiptEmailSendingAt: FieldValue.delete(),
          receiptEmailError: 'receipt_missing_email',
        }).catch(() => undefined);
        return;
      }

      const churchDoc = await db.collection('churches').doc(churchId).get();
      const churchName: string = churchDoc.data()?.name ?? 'your parish';
      const formatted = new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency,
      }).format(amount);

      const resend = getResend();
      const safeName = escapeHtml(displayName);
      const safeChurch = escapeHtml(churchName);
      const safePurpose = escapeHtml(purpose ?? 'General Fund');
      const dateStr = new Date().toLocaleDateString('en-US', {
        year: 'numeric', month: 'long', day: 'numeric',
      });
      const response = await resend.emails.send({
        from: 'Kandilo <giving@kandilo.org>',
        to: email,
        subject: `Donation Receipt - ${safeChurch}`,
        html: `
          <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
            <h1 style="color: #800000;">Thank you, ${safeName}!</h1>
            <p>Your donation to <strong>${safeChurch}</strong> has been received.</p>
            <table style="width: 100%; border-collapse: collapse; margin: 24px 0;">
              <tr>
                <td style="padding: 8px; border-bottom: 1px solid #eee; color: #666;">Amount</td>
                <td style="padding: 8px; border-bottom: 1px solid #eee; font-weight: bold;">${formatted}</td>
              </tr>
              <tr>
                <td style="padding: 8px; border-bottom: 1px solid #eee; color: #666;">Purpose</td>
                <td style="padding: 8px; border-bottom: 1px solid #eee;">${safePurpose}</td>
              </tr>
              <tr>
                <td style="padding: 8px; color: #666;">Date</td>
                <td style="padding: 8px;">${dateStr}</td>
              </tr>
            </table>
            <p style="color: #666; font-size: 14px;">
              This email serves as your donation receipt. ${safeChurch} is a registered non-profit organization.
            </p>
            <p style="color: #aaa; font-size: 12px; margin-top: 24px;">
              Questions? Contact your parish office directly.
            </p>
          </div>
        `,
      });
      if (response.error) {
        console.error('Giving receipt email provider rejected request.', {
          errorName: response.error.name ?? 'ResendError',
        });
        throw new HttpsError('internal', 'Donation receipt email could not be sent.');
      }
      await givingRef.update({
        receiptEmailSentAt: FieldValue.serverTimestamp(),
        receiptEmailSendingAt: FieldValue.delete(),
      });
    } catch (err) {
      console.error('Giving receipt email failed:', sanitizedErrorContext(err));
      await givingRef.update({
        receiptEmailSendingAt: FieldValue.delete(),
        receiptEmailError: 'receipt_send_failed',
      }).catch(() => undefined);
    }
  }
);
