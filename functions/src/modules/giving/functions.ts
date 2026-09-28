import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { onDocumentCreated, onDocumentUpdated } from 'firebase-functions/v2/firestore';
import { HttpsError, onCall, onRequest } from 'firebase-functions/v2/https';
import { getResend, getStripe, resendConfigurationErrorCode, stripeWebhookSecretLooksValid } from '../../shared/clients';
import { db } from '../../shared/firebase';
import { FIRESTORE_REGION } from '../../shared/regions';
import { assertFreshAppCheck, assertActiveChurch, assertActiveChurchRole, assertVerifiedNonAnonymousUser, checkRateLimit, getPrimaryEmailsForUids, replayProtectedCallableOptions } from '../../shared/security';
import { sanitizedErrorContext } from '../../shared/logging';
import { renderDonationReceiptEmail } from '../../shared/emailTemplates';
import { renderTaxReceiptPdfAttachment, TaxReceiptPdfAttachment, TaxReceiptPdfInput } from '../../shared/taxReceiptPdf';
import { loadRetainedTaxReceiptPdfAttachment, retainTaxReceiptPdfAttachment, TaxReceiptPdfRetentionError, TAX_RECEIPT_PDF_RETENTION_FAILED_CODE } from '../../shared/taxReceiptRetention';
import { publicTaxReceiptAuditCode } from '../../shared/taxReceiptAudit';
import { assertBoolean, assertIntegerInRange, assertMaxLength, assertNonEmptyString, callableDataRecord } from '../../shared/validation';
import {
  ALLOWED_CURRENCIES,
  ANONYMOUS_DONOR_LABEL,
  CHURCH_INACTIVE_CODE,
  CHURCH_TAX_RECEIPTS_NOT_ENABLED_CODE,
  MAX_DONATION_CENTS,
  MIN_DONATION_CENTS,
  RECEIPT_CLAIM_TIMEOUT_MS,
  RECEIPT_MANAGER_GIVING_SAFE_VERSION,
  STRIPE_CONNECT_SETTLEMENT,
  STRIPE_FULL_REFUND_VOID_REASON,
  STRIPE_PARTIAL_REFUND_CORRECTED_REASON,
  STRIPE_PARTIAL_REFUND_REVIEW_REASON,
  STRIPE_PLATFORM_SETTLEMENT,
  TAX_RECEIPTS_COLLECTION,
  TAX_RECEIPT_DONOR_PROFILE_INCOMPLETE_CODE,
  TAX_RECEIPT_ID_PATTERN,
  TAX_RECEIPT_ISSUE_FAILED_CODE,
  TAX_RECEIPT_MISSING_EMAIL_OR_AMOUNT_CODE,
  TAX_RECEIPT_SETUP_REQUIRED_CODE,
  TAX_RECEIPT_UNSUPPORTED_JURISDICTION_CODE,
} from './constants';
import {
  BulkAnnualReceiptFailure,
  TaxReceiptIssueResult,
  assertActiveChurchForTaxReceiptIssuance,
  assertAnnualReceiptYearClosed,
  assertReceiptManagerCanTargetGiving,
  canApplyCheckoutCompletion,
  canApplyCheckoutFailure,
  checkoutUrlIsSafe,
  churchRequiresTaxReceiptProfileBeforeCheckout,
  datePartsForReceipt,
  donationCurrencyForChurch,
  findGivingRefForCharge,
  findGivingRefForSession,
  getAppUrl,
  givingPaymentMetadataRef,
  givingPrivatePaymentFieldDeletes,
  logTaxReceiptEvent,
  optionalTrimmedString,
  parseTaxReceiptSettings,
  publicDonorLabelCandidate,
  receiptIdForSendResponse,
  requiredDonorTaxReceiptProfile,
  safeTaxReceiptDocId,
  stripeConnectDestinationForChurch,
  stripeEventLivemode,
  stripeObjectId,
  timestampFromStripeSeconds,
  timestampOrNow,
  unsupportedOfficialReceiptDeliveryJurisdictionForReceipt,
  unsupportedOfficialReceiptDeliveryMessage,
} from './helpers';
import {
  annualGivingIncludesReceiptManagerUnsafeContribution,
  assertAnnualReceiptCurrentForPdfDownload,
  assertSingleReceiptCurrentForPdfDownload,
  failureCodeForAnnualReceipt,
  issueAnnualTaxReceiptForDonor,
  issueCorrectedAnnualTaxReceiptForDonor,
  issueCorrectedTaxReceiptForGiving,
  issueTaxReceiptForGiving,
  loadAnnualDonorIdsForChurch,
  loadAnnualPartialRefundDonorIdsForChurch,
  loadReceiptForPdfDownload,
  logAnnualBatchReviewSkips,
  markAnnualTaxReceiptsForGivingReview,
  markSingleTaxReceiptForGivingReview,
  persistAnnualTaxReceiptIssueFailureSummary,
  persistTaxReceiptIssueFailureForGiving,
  safeHttpsErrorDetailCode,
  sendTaxReceiptEmail,
  taxReceiptEmailDeliveryFailureCode,
  taxReceiptPdfInputFromReceipt,
  taxReceiptPreparationFailedHttpsError,
  voidAnnualTaxReceiptsForGiving,
  voidSingleTaxReceiptForGiving,
} from './operations';

const EVENT_SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/;

function optionalEventSlug(value: unknown, field: string): string {
  const slug = optionalTrimmedString(value, 128).toLowerCase();
  if (!slug) {
    return '';
  }
  if (!EVENT_SLUG_PATTERN.test(slug)) {
    throw new HttpsError('invalid-argument', `${field} is not valid.`);
  }
  return slug;
}

function optionalEventCampaignId(value: unknown): string {
  const campaignId = optionalTrimmedString(value, 128);
  if (!campaignId) {
    return '';
  }
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(campaignId)) {
    throw new HttpsError('invalid-argument', 'eventCampaignId is not valid.');
  }
  return campaignId;
}

async function assertEventDonationTarget(input: {
  churchId: string;
  eventId: string;
  eventCampaignId: string;
}): Promise<{
  eventId: string;
  eventTitle: string;
  eventCampaignId: string;
  eventCampaignTitle: string;
}> {
  let eventId = input.eventId;
  let eventCampaignTitle = '';

  if (input.eventCampaignId) {
    const campaignSnap = await db.collection('eventCampaigns').doc(input.eventCampaignId).get();
    const campaign = campaignSnap.data();
    if (
      !campaignSnap.exists
      || !campaign
      || campaign.active !== true
      || typeof campaign.eventId !== 'string'
      || !campaign.eventId
    ) {
      throw new HttpsError('failed-precondition', 'This event campaign is not accepting donations.');
    }
    if (eventId && campaign.eventId !== eventId) {
      throw new HttpsError('invalid-argument', 'Event campaign does not belong to this event.');
    }
    eventId = campaign.eventId;
    eventCampaignTitle = optionalTrimmedString(campaign.title, 120);
  }

  if (!eventId) {
    return {
      eventId: '',
      eventTitle: '',
      eventCampaignId: '',
      eventCampaignTitle: '',
    };
  }

  const eventSnap = await db.collection('eventPortals').doc(eventId).get();
  const event = eventSnap.data();
  if (
    !eventSnap.exists
    || !event
    || event.churchId !== input.churchId
    || event.status !== 'published'
    || event.campaignsEnabled !== true
  ) {
    throw new HttpsError('failed-precondition', 'This event is not accepting donations.');
  }

  return {
    eventId,
    eventTitle: optionalTrimmedString(event.title, 120),
    eventCampaignId: input.eventCampaignId,
    eventCampaignTitle,
  };
}

export const createStripeCheckoutSession = onCall(
  { ...replayProtectedCallableOptions, secrets: ['STRIPE_SECRET_KEY'] },
  async (request) => {
    assertFreshAppCheck(request);
    assertVerifiedNonAnonymousUser(request, 'A verified, non-anonymous account is required to donate.');
    await checkRateLimit(request.auth!.uid, 'createStripeCheckoutSession', 5);

    const input = callableDataRecord(request.data);

    const churchId = assertNonEmptyString(input.churchId, 128, 'churchId');
    const amountCents = assertIntegerInRange(
      input.amountCents,
      MIN_DONATION_CENTS,
      MAX_DONATION_CENTS,
      'amountCents'
    );
    const requestedCurrency =
      typeof input.currency === 'string' && input.currency.trim()
        ? input.currency.trim().toLowerCase()
        : '';
    assertMaxLength(requestedCurrency, 10, 'currency');
    if (requestedCurrency && !ALLOWED_CURRENCIES.has(requestedCurrency)) {
      throw new HttpsError('invalid-argument', 'Unsupported currency.');
    }

    const purpose =
      typeof input.purpose === 'string' && input.purpose.trim()
        ? input.purpose.trim()
        : 'General Fund';
    assertMaxLength(purpose, 200, 'purpose');
    const anonymous =
      input.anonymous === undefined ? false : assertBoolean(input.anonymous, 'anonymous');
    const requestedEventId = optionalEventSlug(input.eventPortalId ?? input.eventId, 'eventPortalId');
    const requestedEventCampaignId = optionalEventCampaignId(input.eventCampaignId);

    const customerEmail =
      typeof request.auth!.token.email === 'string' ? request.auth!.token.email : undefined;
    if (!customerEmail) {
      throw new HttpsError('failed-precondition', 'Your account needs an email address before donating.');
    }
    const donorName =
      publicDonorLabelCandidate(input.donorName)
      || publicDonorLabelCandidate(request.auth!.token.name)
      || 'Parishioner';
    const storedDonorName = anonymous ? ANONYMOUS_DONOR_LABEL : donorName;

    const membership = await assertActiveChurchRole(
      churchId,
      request.auth!.uid,
      ['member', 'admin', 'treasurer', 'priest'],
      'You must be an active member to donate to this church.'
    );
    const church = await assertActiveChurch(churchId);
    const churchName: string = typeof church.name === 'string' ? church.name : 'Parish';
    const normalizedCurrency = donationCurrencyForChurch(church);
    if (requestedCurrency && requestedCurrency !== normalizedCurrency) {
      throw new HttpsError('invalid-argument', 'Unsupported currency for this church.');
    }
    if (churchRequiresTaxReceiptProfileBeforeCheckout(church)) {
      const donorProfileSnap = await db.collection('users').doc(request.auth!.uid).get();
      requiredDonorTaxReceiptProfile(donorProfileSnap.data() ?? {});
    }
    const eventDonationTarget = await assertEventDonationTarget({
      churchId,
      eventId: requestedEventId,
      eventCampaignId: requestedEventCampaignId,
    });
    let stripe: ReturnType<typeof getStripe>;
    let stripeConnectDestination = '';
    try {
      stripe = getStripe();
      stripeConnectDestination = await stripeConnectDestinationForChurch(stripe, churchId);
    } catch (error) {
      if (error instanceof HttpsError) {
        throw error;
      }
      console.error('Stripe Checkout setup failed:', sanitizedErrorContext(error));
      throw new HttpsError('internal', 'Unable to start secure checkout right now.');
    }

    const givingRef = db.collection('giving').doc();
    const now = FieldValue.serverTimestamp();
    await givingRef.set({
      churchId,
      churchName,
      userId: request.auth!.uid,
      donorRole: membership.role ?? 'member',
      donorName: storedDonorName,
      donorEmail: '',
      donorNamePublicSafe: !anonymous,
      churchReceiptVisible: !anonymous,
      receiptManagerGivingSafeVersion: anonymous ? 0 : RECEIPT_MANAGER_GIVING_SAFE_VERSION,
      amount: amountCents / 100,
      amountCents,
      currency: normalizedCurrency.toUpperCase(),
      purpose,
      anonymous,
      recurring: false,
      stripeSettlement: stripeConnectDestination ? STRIPE_CONNECT_SETTLEMENT : STRIPE_PLATFORM_SETTLEMENT,
      stripeConnectTransferConfigured: Boolean(stripeConnectDestination),
      status: 'creating',
      createdAt: now,
      updatedAt: now,
    });

    try {
      const appUrl = getAppUrl();
      const stripeMetadata = {
        givingId: givingRef.id,
        churchId,
        churchName,
        userId: request.auth!.uid,
        donorName: storedDonorName,
        amountCents: String(amountCents),
        currency: normalizedCurrency,
        purpose,
        anonymous: anonymous ? 'true' : 'false',
        stripeSettlement: stripeConnectDestination ? STRIPE_CONNECT_SETTLEMENT : STRIPE_PLATFORM_SETTLEMENT,
        ...(eventDonationTarget.eventId ? { eventPortalId: eventDonationTarget.eventId } : {}),
        ...(eventDonationTarget.eventCampaignId ? { eventCampaignId: eventDonationTarget.eventCampaignId } : {}),
      };
      const paymentIntentData: {
        metadata: typeof stripeMetadata;
        transfer_data?: { destination: string };
      } = {
        metadata: stripeMetadata,
      };
      if (stripeConnectDestination) {
        paymentIntentData.transfer_data = {
          destination: stripeConnectDestination,
        };
      }
      const session = await stripe.checkout.sessions.create(
        {
          mode: 'payment',
          payment_method_types: ['card'],
          submit_type: 'donate',
          success_url: `${appUrl}/?giving=success&churchId=${encodeURIComponent(churchId)}&givingId=${givingRef.id}${eventDonationTarget.eventId ? `&eventId=${encodeURIComponent(eventDonationTarget.eventId)}` : ''}&session_id={CHECKOUT_SESSION_ID}`,
          cancel_url: `${appUrl}/?giving=cancel&churchId=${encodeURIComponent(churchId)}&givingId=${givingRef.id}${eventDonationTarget.eventId ? `&eventId=${encodeURIComponent(eventDonationTarget.eventId)}` : ''}`,
          customer_email: customerEmail,
          client_reference_id: givingRef.id,
          metadata: stripeMetadata,
          payment_intent_data: paymentIntentData,
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

      const checkoutBatch = db.batch();
      checkoutBatch.set(givingPaymentMetadataRef(givingRef.id), {
        churchId,
        userId: request.auth!.uid,
        amountCents,
        currency: normalizedCurrency.toUpperCase(),
        stripeCheckoutSessionId: session.id,
        stripeCheckoutSessionExpiresAt: timestampFromStripeSeconds(session.expires_at),
        stripeSettlement: stripeConnectDestination ? STRIPE_CONNECT_SETTLEMENT : STRIPE_PLATFORM_SETTLEMENT,
        stripeConnectTransferConfigured: Boolean(stripeConnectDestination),
        ...(eventDonationTarget.eventId ? {
          eventPortalId: eventDonationTarget.eventId,
          eventPortalTitle: eventDonationTarget.eventTitle,
        } : {}),
        ...(eventDonationTarget.eventCampaignId ? {
          eventCampaignId: eventDonationTarget.eventCampaignId,
          eventCampaignTitle: eventDonationTarget.eventCampaignTitle,
        } : {}),
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      checkoutBatch.update(givingRef, {
        status: 'pending',
        ...givingPrivatePaymentFieldDeletes(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      await checkoutBatch.commit();

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

    let stripe: ReturnType<typeof getStripe>;
    try {
      stripe = getStripe();
    } catch (error) {
      console.error('Stripe client initialization failed:', sanitizedErrorContext(error));
      res.status(500).send('Stripe client misconfigured');
      return;
    }

    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET?.trim() ?? '';

    if (!webhookSecret) {
      console.error('STRIPE_WEBHOOK_SECRET not set');
      res.status(500).send('Webhook secret not configured');
      return;
    }
    if (!stripeWebhookSecretLooksValid(webhookSecret)) {
      console.error('STRIPE_WEBHOOK_SECRET has invalid format');
      res.status(500).send('Webhook secret misconfigured');
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
      const livemode = stripeEventLivemode(stripeEvent);
      switch (stripeEvent.type as string) {
        case 'checkout.session.completed':
        case 'checkout.session.expired':
        case 'checkout.session.async_payment_failed': {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const session = stripeEvent.data.object as any;
          const givingRef = await findGivingRefForSession(session);
          const eventRef = db.collection('stripeWebhookEvents').doc(stripeEvent.id);
          const sessionId = typeof session.id === 'string' ? session.id : '';

          await db.runTransaction(async (tx) => {
            const existingEvent = await tx.get(eventRef);
            if (existingEvent.exists) {
              return;
            }

            if (!givingRef) {
              tx.set(eventRef, {
                type: stripeEvent.type,
                livemode,
                stripeSessionId: sessionId || null,
                status: 'missing_giving',
                processedAt: FieldValue.serverTimestamp(),
              });
              return;
            }

            const givingSnap = await tx.get(givingRef);
            if (!givingSnap.exists) {
              tx.set(eventRef, {
                type: stripeEvent.type,
                livemode,
                stripeSessionId: sessionId || null,
                givingId: givingRef.id,
                status: 'missing_giving',
                processedAt: FieldValue.serverTimestamp(),
              });
              return;
            }

            const giving = givingSnap.data()!;
            const paymentMetadataRef = givingPaymentMetadataRef(givingRef.id);
            const paymentMetadataSnap = await tx.get(paymentMetadataRef);
            const paymentMetadata = paymentMetadataSnap.data() ?? {};
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
            const storedStripeSessionId =
              typeof paymentMetadata.stripeCheckoutSessionId === 'string'
                ? paymentMetadata.stripeCheckoutSessionId
                : typeof giving.stripeCheckoutSessionId === 'string'
                  ? giving.stripeCheckoutSessionId
                  : '';
            const sessionIdMatches = Boolean(
              sessionId && (storedStripeSessionId ? sessionId === storedStripeSessionId : metadataMatches)
            );
            const sessionMatches =
              sessionIdMatches
              && session.amount_total === expectedAmountCents
              && String(session.currency ?? '').toLowerCase() === expectedCurrency;

            if (!metadataMatches || !sessionMatches) {
              tx.set(eventRef, {
                type: stripeEvent.type,
                livemode,
                stripeSessionId: sessionId || null,
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
                  livemode,
                  stripeSessionId: sessionId,
                  givingId: givingRef.id,
                  status: 'unpaid_session',
                  processedAt: FieldValue.serverTimestamp(),
                });
                return;
              }

              const completedAt = timestampFromStripeSeconds(stripeEvent.created) ?? FieldValue.serverTimestamp();
              const stripePaymentIntentId = stripeObjectId(session.payment_intent);
              const paymentMetadataUpdate: Record<string, unknown> = {
                churchId: giving.churchId,
                userId: giving.userId,
                amountCents: expectedAmountCents,
                currency: expectedCurrency.toUpperCase(),
                stripeCheckoutSessionId: sessionId,
                stripePaymentStatus:
                  typeof session.payment_status === 'string'
                    ? session.payment_status
                    : FieldValue.delete(),
                checkoutCompletedAt: completedAt,
                updatedAt: FieldValue.serverTimestamp(),
              };
              if (stripePaymentIntentId) {
                paymentMetadataUpdate.stripePaymentIntentId = stripePaymentIntentId;
              } else {
                paymentMetadataUpdate.stripePaymentIntentId = FieldValue.delete();
              }
              tx.set(paymentMetadataRef, paymentMetadataUpdate, { merge: true });

              if (canApplyCheckoutCompletion(giving.status)) {
                tx.update(givingRef, {
                  status: 'completed',
                  completedAt,
                  ...givingPrivatePaymentFieldDeletes(),
                  failureReason: FieldValue.delete(),
                  updatedAt: FieldValue.serverTimestamp(),
                });
              }
            } else if (canApplyCheckoutFailure(giving.status)) {
              tx.set(paymentMetadataRef, {
                churchId: giving.churchId,
                userId: giving.userId,
                amountCents: expectedAmountCents,
                currency: expectedCurrency.toUpperCase(),
                stripeCheckoutSessionId: sessionId,
                stripePaymentStatus:
                  typeof session.payment_status === 'string'
                    ? session.payment_status
                    : FieldValue.delete(),
                checkoutFailureType: stripeEvent.type,
                updatedAt: FieldValue.serverTimestamp(),
              }, { merge: true });
              tx.update(givingRef, {
                status: 'failed',
                ...givingPrivatePaymentFieldDeletes(),
                failureReason:
                  stripeEvent.type === 'checkout.session.expired'
                    ? 'Checkout session expired.'
                    : 'Payment failed.',
                updatedAt: FieldValue.serverTimestamp(),
              });
            }

            tx.set(eventRef, {
              type: stripeEvent.type,
              livemode,
              stripeSessionId: sessionId,
              givingId: givingRef.id,
              status: 'processed',
              processedAt: FieldValue.serverTimestamp(),
            });
          });
          break;
        }

        case 'charge.refunded': {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const charge = stripeEvent.data.object as any;
          const givingRef = await findGivingRefForCharge(charge);
          const eventRef = db.collection('stripeWebhookEvents').doc(stripeEvent.id);
          const paymentIntentId = stripeObjectId(charge.payment_intent);
          const refundRecordedAt = timestampFromStripeSeconds(stripeEvent.created) ?? FieldValue.serverTimestamp();
          let shouldVoidReceipts = false;
          let shouldMarkReceiptsForReview = false;

          await db.runTransaction(async (tx) => {
            const existingEvent = await tx.get(eventRef);
            if (existingEvent.exists) {
              return;
            }

            if (!paymentIntentId || !givingRef) {
              tx.set(eventRef, {
                type: stripeEvent.type,
                livemode,
                stripeChargeId: typeof charge.id === 'string' ? charge.id : null,
                stripePaymentIntentId: paymentIntentId || null,
                status: 'missing_giving',
                processedAt: FieldValue.serverTimestamp(),
              });
              return;
            }

            const givingSnap = await tx.get(givingRef);
            if (!givingSnap.exists) {
              tx.set(eventRef, {
                type: stripeEvent.type,
                livemode,
                stripeChargeId: typeof charge.id === 'string' ? charge.id : null,
                stripePaymentIntentId: paymentIntentId,
                givingId: givingRef.id,
                status: 'missing_giving',
                processedAt: FieldValue.serverTimestamp(),
              });
              return;
            }

            const giving = givingSnap.data()!;
            const paymentMetadataRef = givingPaymentMetadataRef(givingRef.id);
            const paymentMetadataSnap = await tx.get(paymentMetadataRef);
            const paymentMetadata = paymentMetadataSnap.data() ?? {};
            const expectedAmountCents =
              typeof giving.amountCents === 'number'
                ? giving.amountCents
                : Math.round(((giving.amount as number) ?? 0) * 100);
            const expectedCurrency = String(giving.currency ?? '').toLowerCase();
            const chargeAmountCents = typeof charge.amount === 'number' ? charge.amount : expectedAmountCents;
            const refundedCents = typeof charge.amount_refunded === 'number' ? charge.amount_refunded : 0;
            const chargeCurrency = String(charge.currency ?? '').toLowerCase();
            const chargeMetadata = charge.metadata ?? {};
            const metadataMatches =
              chargeMetadata.givingId === givingRef.id
              && chargeMetadata.churchId === giving.churchId
              && chargeMetadata.userId === giving.userId
              && chargeMetadata.amountCents === String(expectedAmountCents)
              && chargeMetadata.currency === expectedCurrency;
            const paymentIntentMatches =
              (typeof paymentMetadata.stripePaymentIntentId === 'string'
                && paymentMetadata.stripePaymentIntentId === paymentIntentId)
              || giving.stripePaymentIntentId === paymentIntentId;
            const chargeMatches =
              (paymentIntentMatches || metadataMatches)
              && chargeAmountCents === expectedAmountCents
              && chargeCurrency === expectedCurrency;

            if (!chargeMatches) {
              tx.set(eventRef, {
                type: stripeEvent.type,
                livemode,
                stripeChargeId: typeof charge.id === 'string' ? charge.id : null,
                stripePaymentIntentId: paymentIntentId,
                givingId: givingRef.id,
                status: 'validation_failed',
                processedAt: FieldValue.serverTimestamp(),
              });
              return;
            }

            if (refundedCents <= 0) {
              tx.set(eventRef, {
                type: stripeEvent.type,
                livemode,
                stripeChargeId: typeof charge.id === 'string' ? charge.id : null,
                stripePaymentIntentId: paymentIntentId,
                givingId: givingRef.id,
                status: 'no_refund_amount',
                processedAt: FieldValue.serverTimestamp(),
              });
              return;
            }

            const fullRefund = charge.refunded === true || refundedCents >= expectedAmountCents;
            const existingRefundedCents =
              typeof giving.stripeAmountRefundedCents === 'number' ? giving.stripeAmountRefundedCents : 0;
            const existingFullRefund =
              giving.status === 'refunded'
              || giving.stripeRefundStatus === 'refunded'
              || existingRefundedCents >= expectedAmountCents;
            if ((existingFullRefund && !fullRefund) || existingRefundedCents > refundedCents) {
              tx.set(eventRef, {
                type: stripeEvent.type,
                livemode,
                stripeChargeId: typeof charge.id === 'string' ? charge.id : null,
                stripePaymentIntentId: paymentIntentId,
                givingId: givingRef.id,
                status: 'processed',
                refundStatus: 'stale_refund_ignored',
                amountRefundedCents: refundedCents,
                currentAmountRefundedCents: existingRefundedCents,
                processedAt: FieldValue.serverTimestamp(),
              });
              return;
            }

            const refundStatus = fullRefund ? 'refunded' : 'partially_refunded';
            const givingUpdate: Record<string, unknown> = {
              ...givingPrivatePaymentFieldDeletes(),
              stripeAmountRefundedCents: refundedCents,
              stripeRefundedAt: refundRecordedAt,
              updatedAt: FieldValue.serverTimestamp(),
            };

            if (fullRefund) {
              shouldVoidReceipts = true;
              givingUpdate.status = 'refunded';
              givingUpdate.stripeRefundStatus = refundStatus;
              givingUpdate.refundedAt = refundRecordedAt;
              givingUpdate.failureReason = 'Donation refunded in Stripe.';
            } else {
              shouldMarkReceiptsForReview = true;
              givingUpdate.stripeRefundStatus = refundStatus;
              givingUpdate.taxReceiptStatus = 'error';
              givingUpdate.taxReceiptError = STRIPE_PARTIAL_REFUND_REVIEW_REASON;
              givingUpdate.taxReceiptCorrectionRequired = true;
              givingUpdate.taxReceiptCorrectionReason = STRIPE_PARTIAL_REFUND_REVIEW_REASON;
              givingUpdate.taxReceiptCorrectionMarkedAt = FieldValue.serverTimestamp();
            }

            tx.update(givingRef, givingUpdate as FirebaseFirestore.UpdateData<FirebaseFirestore.DocumentData>);
            tx.set(paymentMetadataRef, {
              churchId: giving.churchId,
              userId: giving.userId,
              amountCents: expectedAmountCents,
              currency: expectedCurrency.toUpperCase(),
              stripePaymentIntentId: paymentIntentId,
              stripeRefundedChargeId:
                typeof charge.id === 'string'
                  ? charge.id
                  : FieldValue.delete(),
              stripeAmountRefundedCents: refundedCents,
              stripeRefundStatus: refundStatus,
              stripeRefundedAt: refundRecordedAt,
              updatedAt: FieldValue.serverTimestamp(),
            }, { merge: true });
            tx.set(eventRef, {
              type: stripeEvent.type,
              livemode,
              stripeChargeId: typeof charge.id === 'string' ? charge.id : null,
              stripePaymentIntentId: paymentIntentId,
              givingId: givingRef.id,
              status: 'processed',
              refundStatus: fullRefund ? 'refunded' : 'partially_refunded',
              amountRefundedCents: refundedCents,
              processedAt: FieldValue.serverTimestamp(),
            });
          });

          if (shouldVoidReceipts && givingRef) {
            await voidSingleTaxReceiptForGiving(givingRef, STRIPE_FULL_REFUND_VOID_REASON, 'stripe');
            await voidAnnualTaxReceiptsForGiving(givingRef.id, STRIPE_FULL_REFUND_VOID_REASON, 'stripe');
          } else if (shouldMarkReceiptsForReview && givingRef) {
            await markSingleTaxReceiptForGivingReview(
              givingRef,
              STRIPE_PARTIAL_REFUND_REVIEW_REASON,
              'stripe'
            );
            await markAnnualTaxReceiptsForGivingReview(
              givingRef.id,
              STRIPE_PARTIAL_REFUND_REVIEW_REASON,
              'stripe'
            );
          }
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

export const sendTaxReceipt = onCall(
  { ...replayProtectedCallableOptions, secrets: ['RESEND_API_KEY'] },
  async (request) => {
    assertFreshAppCheck(request);
    assertVerifiedNonAnonymousUser(request, 'A verified, non-anonymous account is required to send tax receipts.');
    await checkRateLimit(request.auth!.uid, 'sendTaxReceipt', 5);

    const input = callableDataRecord(request.data);
    const givingId = assertNonEmptyString(input.givingId, 128, 'givingId');
    if (!TAX_RECEIPT_ID_PATTERN.test(givingId)) {
      throw new HttpsError('invalid-argument', 'givingId is invalid.');
    }

    const givingRef = db.collection('giving').doc(givingId);
    const givingSnap = await givingRef.get();
    if (!givingSnap.exists) {
      throw new HttpsError('not-found', 'Donation not found.');
    }

    const giving = givingSnap.data() ?? {};
    const churchId = typeof giving.churchId === 'string' ? giving.churchId : '';
    const donorUid = typeof giving.userId === 'string' ? giving.userId : '';
    if (!churchId || !donorUid) {
      throw new HttpsError('failed-precondition', 'Donation metadata is incomplete.');
    }

    const isOwner = donorUid === request.auth!.uid;
    if (!isOwner) {
      await assertActiveChurchRole(
        churchId,
        request.auth!.uid,
        ['priest', 'treasurer'],
        'Only priests and treasurers can issue tax receipts for parish donors.'
      );
      assertReceiptManagerCanTargetGiving(
        giving,
        'Donation receipts that are anonymous, unclassified, or hidden from the receipt manager can only be sent by the donor or through a privacy-preserving annual batch.'
      );
    }

    let receipt: TaxReceiptIssueResult;
    try {
      receipt = await issueTaxReceiptForGiving(givingRef, request.auth!.uid);
    } catch (error) {
      await persistTaxReceiptIssueFailureForGiving(givingRef, giving, error);
      throw error;
    }
    await sendTaxReceiptEmail(receipt.receiptId, request.auth!.uid);

    return {
      success: true,
      receiptId: receiptIdForSendResponse(receipt.receiptId, isOwner),
      receiptNumber: receipt.receiptNumber,
      created: receipt.created,
      emailSent: true,
    };
  }
);

export const sendCorrectedTaxReceipt = onCall(
  { ...replayProtectedCallableOptions, secrets: ['RESEND_API_KEY'] },
  async (request) => {
    assertFreshAppCheck(request);
    assertVerifiedNonAnonymousUser(request, 'A verified, non-anonymous account is required to send corrected tax receipts.');
    await checkRateLimit(request.auth!.uid, 'sendCorrectedTaxReceipt', 3);

    const input = callableDataRecord(request.data);
    const givingId = assertNonEmptyString(input.givingId, 128, 'givingId');
    if (!TAX_RECEIPT_ID_PATTERN.test(givingId)) {
      throw new HttpsError('invalid-argument', 'givingId is invalid.');
    }

    const givingRef = db.collection('giving').doc(givingId);
    const givingSnap = await givingRef.get();
    if (!givingSnap.exists) {
      throw new HttpsError('not-found', 'Donation not found.');
    }

    const giving = givingSnap.data() ?? {};
    const churchId = typeof giving.churchId === 'string' ? giving.churchId : '';
    const donorUid = typeof giving.userId === 'string' ? giving.userId : '';
    if (!churchId) {
      throw new HttpsError('failed-precondition', 'Donation metadata is incomplete.');
    }
    if (!donorUid) {
      throw new HttpsError('failed-precondition', 'Donation metadata is incomplete.');
    }
    const isOwner = donorUid === request.auth!.uid;
    if (!isOwner) {
      await assertActiveChurchRole(
        churchId,
        request.auth!.uid,
        ['priest', 'treasurer'],
        'Only priests and treasurers can issue corrected tax receipts for parish donors.'
      );
      assertReceiptManagerCanTargetGiving(
        giving,
        'Corrected receipts for donations that are anonymous, unclassified, or hidden from the receipt manager can only be sent by the donor or through a privacy-preserving annual batch.'
      );
    }

    let receipt: TaxReceiptIssueResult;
    try {
      receipt = await issueCorrectedTaxReceiptForGiving(givingRef, request.auth!.uid);
    } catch (error) {
      await persistTaxReceiptIssueFailureForGiving(givingRef, giving, error);
      throw error;
    }
    await sendTaxReceiptEmail(receipt.receiptId, request.auth!.uid);

    return {
      success: true,
      receiptId: receiptIdForSendResponse(receipt.receiptId, isOwner),
      receiptNumber: receipt.receiptNumber,
      created: receipt.created,
      corrected: true,
      emailSent: true,
    };
  }
);

export const sendAnnualTaxReceipt = onCall(
  { ...replayProtectedCallableOptions, secrets: ['RESEND_API_KEY'] },
  async (request) => {
    assertFreshAppCheck(request);
    assertVerifiedNonAnonymousUser(request, 'A verified, non-anonymous account is required to send tax receipts.');
    await checkRateLimit(request.auth!.uid, 'sendAnnualTaxReceipt', 3);

    const input = callableDataRecord(request.data);
    const churchId = assertNonEmptyString(input.churchId, 128, 'churchId');
    const year = assertIntegerInRange(
      input.year,
      2000,
      new Date().getUTCFullYear() + 1,
      'year'
    );
    const targetUserId =
      input.userId === undefined
        ? request.auth!.uid
        : assertNonEmptyString(input.userId, 128, 'userId');
    const acknowledgePreviouslyReceipted = input.acknowledgePreviouslyReceipted === true;

    const isOwner = targetUserId === request.auth!.uid;
    if (!isOwner) {
      await assertActiveChurchRole(
        churchId,
        request.auth!.uid,
        ['priest', 'treasurer'],
        'Only priests and treasurers can issue annual tax receipts for parish donors.'
      );
      const church = await assertActiveChurch(churchId);
      if (await annualGivingIncludesReceiptManagerUnsafeContribution(churchId, targetUserId, year, church.timezone)) {
        throw new HttpsError(
          'permission-denied',
          'Annual receipts that include anonymous, unclassified, or receipt-manager-hidden donations can only be sent by the donor or through a privacy-preserving church-year batch.'
        );
      }
    }

    let receipt: TaxReceiptIssueResult;
    try {
      receipt = await issueAnnualTaxReceiptForDonor(
        churchId,
        targetUserId,
        year,
        request.auth!.uid,
        acknowledgePreviouslyReceipted
      );
    } catch (error) {
      await persistAnnualTaxReceiptIssueFailureSummary(churchId, targetUserId, year, 'annual', error);
      throw error;
    }
    await sendTaxReceiptEmail(receipt.receiptId, request.auth!.uid);

    return {
      success: true,
      receiptId: receiptIdForSendResponse(receipt.receiptId, isOwner),
      receiptNumber: receipt.receiptNumber,
      created: receipt.created,
      contributionCount: receipt.contributionCount ?? null,
      emailSent: true,
    };
  }
);

export const sendCorrectedAnnualTaxReceipt = onCall(
  { ...replayProtectedCallableOptions, secrets: ['RESEND_API_KEY'] },
  async (request) => {
    assertFreshAppCheck(request);
    assertVerifiedNonAnonymousUser(request, 'A verified, non-anonymous account is required to send corrected tax receipts.');
    await checkRateLimit(request.auth!.uid, 'sendCorrectedAnnualTaxReceipt', 3);

    const input = callableDataRecord(request.data);
    const churchId = assertNonEmptyString(input.churchId, 128, 'churchId');
    const userId =
      input.userId === undefined
        ? request.auth!.uid
        : assertNonEmptyString(input.userId, 128, 'userId');
    const acknowledgePreviouslyReceipted = input.acknowledgePreviouslyReceipted === true;
    const year = assertIntegerInRange(
      input.year,
      2000,
      new Date().getUTCFullYear() + 1,
      'year'
    );
    const isOwner = userId === request.auth!.uid;
    if (!isOwner) {
      await assertActiveChurchRole(
        churchId,
        request.auth!.uid,
        ['priest', 'treasurer'],
        'Only priests and treasurers can issue corrected annual tax receipts for parish donors.'
      );
      const church = await assertActiveChurch(churchId);
      if (await annualGivingIncludesReceiptManagerUnsafeContribution(churchId, userId, year, church.timezone)) {
        throw new HttpsError(
          'permission-denied',
          'Corrected annual receipts that include anonymous, unclassified, or receipt-manager-hidden donations can only be sent by the donor or through a privacy-preserving church-year batch.'
        );
      }
    }

    let receipt: TaxReceiptIssueResult;
    try {
      receipt = await issueCorrectedAnnualTaxReceiptForDonor(
        churchId,
        userId,
        year,
        request.auth!.uid,
        acknowledgePreviouslyReceipted
      );
    } catch (error) {
      await persistAnnualTaxReceiptIssueFailureSummary(churchId, userId, year, 'correctedAnnual', error);
      throw error;
    }
    await sendTaxReceiptEmail(receipt.receiptId, request.auth!.uid);

    return {
      success: true,
      receiptId: receiptIdForSendResponse(receipt.receiptId, isOwner),
      receiptNumber: receipt.receiptNumber,
      created: receipt.created,
      corrected: true,
      contributionCount: receipt.contributionCount ?? null,
      emailSent: true,
    };
  }
);

export const downloadTaxReceiptPdf = onCall(
  replayProtectedCallableOptions,
  async (request) => {
    assertFreshAppCheck(request);
    assertVerifiedNonAnonymousUser(request, 'A verified, non-anonymous account is required to download tax receipts.');
    await checkRateLimit(request.auth!.uid, 'downloadTaxReceiptPdf', 10);

    const input = callableDataRecord(request.data);
    const receiptId = assertNonEmptyString(input.receiptId, 128, 'receiptId');
    if (!TAX_RECEIPT_ID_PATTERN.test(receiptId)) {
      throw new HttpsError('invalid-argument', 'receiptId is invalid.');
    }

    const receiptRef = db.collection(TAX_RECEIPTS_COLLECTION).doc(receiptId);
    const receipt = await loadReceiptForPdfDownload(receiptRef, request.auth!.uid);
    await assertSingleReceiptCurrentForPdfDownload(receipt);
    await assertAnnualReceiptCurrentForPdfDownload(receipt);
    const unsupportedJurisdiction = await unsupportedOfficialReceiptDeliveryJurisdictionForReceipt(receipt);
    if (unsupportedJurisdiction) {
      throw new HttpsError(
        'failed-precondition',
        unsupportedOfficialReceiptDeliveryMessage(unsupportedJurisdiction),
        { errorCode: TAX_RECEIPT_UNSUPPORTED_JURISDICTION_CODE }
      );
    }
    let taxReceiptDeliveryDetails: TaxReceiptPdfInput;
    try {
      taxReceiptDeliveryDetails = taxReceiptPdfInputFromReceipt(receiptId, receipt);
    } catch (error) {
      if (error instanceof HttpsError && safeHttpsErrorDetailCode(error)) {
        throw error;
      }
      console.error('Tax receipt PDF download preparation failed:', sanitizedErrorContext(error));
      throw taxReceiptPreparationFailedHttpsError('Tax receipt PDF could not be prepared.');
    }

    let attachment: TaxReceiptPdfAttachment | null = null;
    try {
      attachment = await loadRetainedTaxReceiptPdfAttachment(receiptId, receipt);
    } catch (error) {
      console.error('Tax receipt retained PDF download verification failed:', sanitizedErrorContext(error));
      throw new HttpsError(
        'internal',
        'Tax receipt PDF copy could not be verified.',
        { errorCode: TAX_RECEIPT_PDF_RETENTION_FAILED_CODE }
      );
    }
    if (!attachment) {
      let renderedAttachment: TaxReceiptPdfAttachment;
      try {
        renderedAttachment = await renderTaxReceiptPdfAttachment(taxReceiptDeliveryDetails);
      } catch (error) {
        console.error('Tax receipt PDF download generation failed:', sanitizedErrorContext(error));
        throw new HttpsError(
          'internal',
          'Tax receipt PDF could not be generated.',
          { errorCode: 'tax_receipt_pdf_failed' }
        );
      }
      attachment = renderedAttachment;
      await assertSingleReceiptCurrentForPdfDownload(receipt);
      await assertAnnualReceiptCurrentForPdfDownload(receipt);
      try {
        await retainTaxReceiptPdfAttachment(receiptRef, receiptId, receipt, renderedAttachment);
      } catch (error) {
        console.error('Tax receipt PDF download retention failed:', sanitizedErrorContext(error));
        throw new HttpsError(
          'internal',
          'Tax receipt PDF copy could not be retained.',
          { errorCode: error instanceof TaxReceiptPdfRetentionError
            ? TAX_RECEIPT_PDF_RETENTION_FAILED_CODE
            : 'tax_receipt_pdf_failed' }
        );
      }
    }
    await assertSingleReceiptCurrentForPdfDownload(receipt);
    await assertAnnualReceiptCurrentForPdfDownload(receipt);
    await logTaxReceiptEvent({
      action: 'pdf_downloaded',
      actorUid: request.auth!.uid,
      receiptId,
      receipt,
    });

    return {
      success: true,
      filename: attachment.filename,
      content: attachment.content,
      contentType: attachment.contentType,
    };
  }
);

export const sendChurchAnnualTaxReceipts = onCall(
  { ...replayProtectedCallableOptions, secrets: ['RESEND_API_KEY'] },
  async (request) => {
    assertFreshAppCheck(request);
    assertVerifiedNonAnonymousUser(request, 'A verified, non-anonymous account is required to send tax receipts.');
    await checkRateLimit(request.auth!.uid, 'sendChurchAnnualTaxReceipts', 1);

    const input = callableDataRecord(request.data);
    const churchId = assertNonEmptyString(input.churchId, 128, 'churchId');
    const year = assertIntegerInRange(
      input.year,
      2000,
      new Date().getUTCFullYear() + 1,
      'year'
    );
    const acknowledgePreviouslyReceipted = input.acknowledgePreviouslyReceipted === true;
    await assertActiveChurchRole(
      churchId,
      request.auth!.uid,
      ['priest', 'treasurer'],
      'Only priests and treasurers can send annual tax receipt batches.'
    );

    const churchSnap = await db.collection('churches').doc(churchId).get();
    if (!churchSnap.exists) {
      throw new HttpsError('not-found', 'Church not found.');
    }
    const church = churchSnap.data() ?? {};
    assertActiveChurchForTaxReceiptIssuance(church);
    if (!parseTaxReceiptSettings(church)) {
      throw new HttpsError(
        'failed-precondition',
        'Tax receipts are not enabled for this church.',
        { errorCode: CHURCH_TAX_RECEIPTS_NOT_ENABLED_CODE }
      );
    }
    assertAnnualReceiptYearClosed(year, church.timezone);

    const {
      donorIds,
      skippedAlreadyEmailedCount,
      reviewSkips,
      truncated,
    } = await loadAnnualDonorIdsForChurch(churchId, year, church.timezone);
    await logAnnualBatchReviewSkips(reviewSkips, {
      actorUid: request.auth!.uid,
      churchId,
      year,
    });
    const failures: BulkAnnualReceiptFailure[] = reviewSkips.map((skip) => ({ code: skip.code }));
    let createdCount = 0;
    let emailSentCount = 0;
    let skippedCount = skippedAlreadyEmailedCount;

    for (const donorId of donorIds) {
      try {
        const receipt = await issueAnnualTaxReceiptForDonor(
          churchId,
          donorId,
          year,
          request.auth!.uid,
          acknowledgePreviouslyReceipted
        );
        if (receipt.emailSent === true) {
          skippedCount += 1;
          continue;
        }
        await sendTaxReceiptEmail(receipt.receiptId, request.auth!.uid);
        if (receipt.created) {
          createdCount += 1;
        }
        emailSentCount += 1;
      } catch (error) {
        console.error('Annual tax receipt batch item failed:', {
          churchId,
          year,
          ...sanitizedErrorContext(error),
        });
        const code = failureCodeForAnnualReceipt(error);
        await persistAnnualTaxReceiptIssueFailureSummary(churchId, donorId, year, 'annual', error);
        failures.push({ code });
        await logTaxReceiptEvent({
          action: 'annual_batch_item_failed',
          actorUid: request.auth!.uid,
          churchId,
          userId: donorId,
          kind: 'annual',
          receiptYear: year,
          errorCode: code,
        });
      }
    }

    return {
      success: failures.length === 0,
      donorCount: donorIds.length + skippedAlreadyEmailedCount + reviewSkips.length,
      createdCount,
      emailSentCount,
      skippedCount,
      failedCount: failures.length,
      truncated,
      failures: failures.slice(0, 25),
    };
  }
);

export const sendChurchCorrectedAnnualTaxReceipts = onCall(
  { ...replayProtectedCallableOptions, secrets: ['RESEND_API_KEY'] },
  async (request) => {
    assertFreshAppCheck(request);
    assertVerifiedNonAnonymousUser(request, 'A verified, non-anonymous account is required to send corrected tax receipts.');
    await checkRateLimit(request.auth!.uid, 'sendChurchCorrectedAnnualTaxReceipts', 1);

    const input = callableDataRecord(request.data);
    const churchId = assertNonEmptyString(input.churchId, 128, 'churchId');
    const year = assertIntegerInRange(
      input.year,
      2000,
      new Date().getUTCFullYear() + 1,
      'year'
    );
    const acknowledgePreviouslyReceipted = input.acknowledgePreviouslyReceipted === true;
    await assertActiveChurchRole(
      churchId,
      request.auth!.uid,
      ['priest', 'treasurer'],
      'Only priests and treasurers can send corrected annual tax receipt batches.'
    );

    const churchSnap = await db.collection('churches').doc(churchId).get();
    if (!churchSnap.exists) {
      throw new HttpsError('not-found', 'Church not found.');
    }
    const church = churchSnap.data() ?? {};
    assertActiveChurchForTaxReceiptIssuance(church);
    if (!parseTaxReceiptSettings(church)) {
      throw new HttpsError(
        'failed-precondition',
        'Tax receipts are not enabled for this church.',
        { errorCode: CHURCH_TAX_RECEIPTS_NOT_ENABLED_CODE }
      );
    }
    assertAnnualReceiptYearClosed(year, church.timezone);

    const {
      donorIds,
      skippedAlreadyEmailedCount,
      reviewSkips,
      truncated,
    } = await loadAnnualPartialRefundDonorIdsForChurch(
      churchId,
      year,
      church.timezone
    );
    await logAnnualBatchReviewSkips(reviewSkips, {
      actorUid: request.auth!.uid,
      churchId,
      year,
      reasonCode: STRIPE_PARTIAL_REFUND_CORRECTED_REASON,
    });
    const failures: BulkAnnualReceiptFailure[] = reviewSkips.map((skip) => ({ code: skip.code }));
    let createdCount = 0;
    let emailSentCount = 0;
    let skippedCount = skippedAlreadyEmailedCount;

    for (const donorId of donorIds) {
      try {
        const receipt = await issueCorrectedAnnualTaxReceiptForDonor(
          churchId,
          donorId,
          year,
          request.auth!.uid,
          acknowledgePreviouslyReceipted
        );
        if (receipt.emailSent === true) {
          skippedCount += 1;
          continue;
        }
        await sendTaxReceiptEmail(receipt.receiptId, request.auth!.uid);
        if (receipt.created) {
          createdCount += 1;
        }
        emailSentCount += 1;
      } catch (error) {
        console.error('Corrected annual tax receipt batch item failed:', {
          churchId,
          year,
          ...sanitizedErrorContext(error),
        });
        const code = failureCodeForAnnualReceipt(error);
        await persistAnnualTaxReceiptIssueFailureSummary(churchId, donorId, year, 'correctedAnnual', error);
        failures.push({ code });
        await logTaxReceiptEvent({
          action: 'annual_batch_item_failed',
          actorUid: request.auth!.uid,
          churchId,
          userId: donorId,
          kind: 'annual',
          receiptYear: year,
          errorCode: code,
          reasonCode: STRIPE_PARTIAL_REFUND_CORRECTED_REASON,
        });
      }
    }

    return {
      success: failures.length === 0,
      donorCount: donorIds.length + skippedAlreadyEmailedCount + reviewSkips.length,
      createdCount,
      emailSentCount,
      skippedCount,
      failedCount: failures.length,
      truncated,
      failures: failures.slice(0, 25),
    };
  }
);

// Deprecated production compatibility shim. This function name exists in the
// live project from an older payment flow; keep the export so the next deploy
// overwrites it with a safe implementation instead of leaving remote-only code.
export const createStripePaymentIntent = onCall(
  replayProtectedCallableOptions,
  async (request) => {
    assertFreshAppCheck(request);
    throw new HttpsError('failed-precondition', 'This payment flow has been retired. Use Stripe Checkout.');
  }
);

// Deprecated production compatibility shim. Giving writes are now finalized by
// stripeWebhook and onGivingCompleted; create-trigger payment logic is disabled.
export const onGivingCreated = onDocumentCreated({ region: FIRESTORE_REGION, document: 'giving/{givingId}' }, async () => {
  console.warn('Deprecated onGivingCreated trigger ignored.');
});

function completedGivingNeedsTaxReceiptFollowUp(giving: FirebaseFirestore.DocumentData): boolean {
  if (giving.status !== 'completed') {
    return false;
  }

  const status = optionalTrimmedString(giving.taxReceiptStatus, 20);
  return !status || status === 'issued';
}

async function processCompletedGivingTaxReceiptFollowUp(
  givingRef: FirebaseFirestore.DocumentReference,
  giving: FirebaseFirestore.DocumentData
): Promise<void> {
  if (!completedGivingNeedsTaxReceiptFollowUp(giving)) {
    return;
  }

  const status = optionalTrimmedString(giving.taxReceiptStatus, 20);
  const churchId = optionalTrimmedString(giving.churchId, 128);
  if (!churchId) {
    await givingRef.update({
      taxReceiptStatus: 'error',
      taxReceiptError: 'tax_receipt_missing_church',
      updatedAt: FieldValue.serverTimestamp(),
    }).catch(() => undefined);
    return;
  }

  try {
    const churchDoc = await db.collection('churches').doc(churchId).get();
    const church = churchDoc.data() ?? {};
    if (churchDoc.exists && church.isActive !== true && !status) {
      await givingRef.update({
        taxReceiptStatus: 'not_configured',
        taxReceiptError: CHURCH_INACTIVE_CODE,
        taxReceiptEmailError: FieldValue.delete(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      return;
    }

    const taxSettings = parseTaxReceiptSettings(church);
    if (taxSettings?.autoIssue) {
      const taxReceipt = await issueTaxReceiptForGiving(givingRef, 'system');
      if (taxReceipt.emailSent === true) {
        await givingRef.update({
          taxReceiptStatus: 'sent',
          taxReceiptError: FieldValue.delete(),
          taxReceiptEmailError: FieldValue.delete(),
          updatedAt: FieldValue.serverTimestamp(),
        }).catch(() => undefined);
        return;
      }
      await sendTaxReceiptEmail(taxReceipt.receiptId, 'system');
    } else if (taxSettings && !status) {
      await givingRef.update({
        taxReceiptStatus: 'ready',
        taxReceiptError: FieldValue.delete(),
        taxReceiptEmailError: FieldValue.delete(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    } else if (!taxSettings && !status) {
      await givingRef.update({
        taxReceiptStatus: 'not_configured',
        taxReceiptError: CHURCH_TAX_RECEIPTS_NOT_ENABLED_CODE,
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
  } catch (taxReceiptError) {
    // A concurrent manual/background sender owns delivery and its final state.
    if (taxReceiptError instanceof HttpsError && taxReceiptError.code === 'aborted') return;
    const latestAfterFailure = await givingRef.get().catch(() => null);
    const latestGiving = latestAfterFailure?.data();
    if (latestGiving && !completedGivingNeedsTaxReceiptFollowUp(latestGiving)) {
      return;
    }

    const detailCode = safeHttpsErrorDetailCode(taxReceiptError);
    const emailDeliveryFailureCode = taxReceiptEmailDeliveryFailureCode(taxReceiptError);
    const isUnsupportedJurisdiction = detailCode === TAX_RECEIPT_UNSUPPORTED_JURISDICTION_CODE;
    const isDonorProfileIncomplete = detailCode === TAX_RECEIPT_DONOR_PROFILE_INCOMPLETE_CODE;
    const isMissingEmailOrAmount = detailCode === TAX_RECEIPT_MISSING_EMAIL_OR_AMOUNT_CODE;
    let missingEmailOrAmountReceiptExists = false;
    if (isMissingEmailOrAmount) {
      const receiptSnap = await db
        .collection(TAX_RECEIPTS_COLLECTION)
        .doc(safeTaxReceiptDocId(givingRef.id))
        .get()
        .catch(() => null);
      missingEmailOrAmountReceiptExists = receiptSnap?.exists === true;
    }
    const isRecoverableIssuanceGap =
      isDonorProfileIncomplete || (isMissingEmailOrAmount && !missingEmailOrAmountReceiptExists);
    const isReceiptSetupUnavailable =
      detailCode === TAX_RECEIPT_SETUP_REQUIRED_CODE ||
      detailCode === CHURCH_TAX_RECEIPTS_NOT_ENABLED_CODE ||
      detailCode === CHURCH_INACTIVE_CODE;
    const isExpectedSetupGap =
      isUnsupportedJurisdiction ||
      isRecoverableIssuanceGap ||
      isReceiptSetupUnavailable ||
      isMissingEmailOrAmount ||
      (
        !detailCode &&
        taxReceiptError instanceof HttpsError &&
        taxReceiptError.code === 'failed-precondition'
      );
    if (!isExpectedSetupGap) {
      console.error('Tax receipt auto-issue failed:', sanitizedErrorContext(taxReceiptError));
    }
    const givingUpdate: FirebaseFirestore.UpdateData<FirebaseFirestore.DocumentData> = {
      taxReceiptStatus: isUnsupportedJurisdiction
        ? 'not_configured'
        : isReceiptSetupUnavailable
          ? 'not_configured'
        : isRecoverableIssuanceGap
          ? 'ready'
          : 'error',
      taxReceiptError: isUnsupportedJurisdiction
        ? TAX_RECEIPT_UNSUPPORTED_JURISDICTION_CODE
        : isReceiptSetupUnavailable
          ? publicTaxReceiptAuditCode(detailCode)
        : isRecoverableIssuanceGap
          ? detailCode
        : publicTaxReceiptAuditCode(detailCode) || TAX_RECEIPT_ISSUE_FAILED_CODE,
      updatedAt: FieldValue.serverTimestamp(),
    };
    givingUpdate.taxReceiptEmailError = isRecoverableIssuanceGap
      ? FieldValue.delete()
      : emailDeliveryFailureCode || FieldValue.delete();
    await db.runTransaction(async (tx) => {
      const current = (await tx.get(givingRef)).data();
      if (current && completedGivingNeedsTaxReceiptFollowUp(current)) {
        tx.update(givingRef, givingUpdate);
      }
    });
  }
}

export const onGivingCompleted = onDocumentUpdated(
  { region: FIRESTORE_REGION, document: 'giving/{givingId}', secrets: ['RESEND_API_KEY'], retry: true },
  async (event) => {
    const after = event.data?.after.data();
    if (!after) return;
    if (after.status !== 'completed') {
      return;
    }

    const givingRef = event.data?.after.ref;
    if (!givingRef) return;

    if (after.receiptEmailSentAt && !completedGivingNeedsTaxReceiptFollowUp(after)) {
      return;
    }

    // Only the completion event delivers the confirmation. Its automatic event
    // retries retain the same before/after snapshots; our bookkeeping updates do not.
    const completionEvent = event.data?.before.data()?.status !== 'completed';
    let deliveryRetryError: unknown;
    const claimed = completionEvent && await db.runTransaction(async (tx) => {
      const snap = await tx.get(givingRef);
      const current = snap.data();
      if (!current || current.status !== 'completed' || current.receiptEmailSentAt) {
        return false;
      }

      if ((current.receiptEmailAttempts ?? 0) >= 5) return false;

      const sendingAt = current.receiptEmailSendingAt;
      if (sendingAt instanceof Timestamp && Date.now() - sendingAt.toMillis() < RECEIPT_CLAIM_TIMEOUT_MS) {
        throw new Error('Donation confirmation delivery is already in progress.');
      }

      tx.update(givingRef, {
        receiptEmailSendingAt: FieldValue.serverTimestamp(),
        receiptEmailAttempts: FieldValue.increment(1),
        receiptEmailError: FieldValue.delete(),
      });
      return true;
    });

    if (claimed) {
      const { userId, churchId, amount, currency = 'USD', purpose } = after;
      if (!userId || !churchId) {
        await givingRef.update({
          receiptEmailSendingAt: FieldValue.delete(),
          receiptEmailError: 'receipt_missing_metadata',
        }).catch(() => undefined);
      } else {
        try {
          const userDoc = await db.collection('users').doc(userId).get();
          const email = (await getPrimaryEmailsForUids([userId]))[0];
          const displayName: string = userDoc.data()?.displayName ?? 'Parishioner';
          if (!email) {
            await givingRef.update({
              receiptEmailSendingAt: FieldValue.delete(),
              receiptEmailError: 'receipt_missing_email',
            }).catch(() => undefined);
          } else {
            const churchDoc = await db.collection('churches').doc(churchId).get();
            const church = churchDoc.data() ?? {};
            const churchName: string = church.name ?? 'your parish';
            const amountCents =
              typeof after.amountCents === 'number'
                ? after.amountCents
                : Math.round((typeof amount === 'number' ? amount : 0) * 100);
            if (!Number.isInteger(amountCents) || amountCents <= 0) {
              await givingRef.update({
                receiptEmailSendingAt: FieldValue.delete(),
                receiptEmailError: 'receipt_missing_amount',
              }).catch(() => undefined);
            } else {
              const normalizedCurrency = typeof currency === 'string' && currency.trim() ? currency.trim() : 'USD';
              const formatted = new Intl.NumberFormat('en-US', {
                style: 'currency',
                currency: normalizedCurrency,
              }).format(amountCents / 100);

              const receiptDate = datePartsForReceipt(
                timestampOrNow(after.completedAt ?? after.createdAt),
                church.timezone
              );
              const emailMessage = renderDonationReceiptEmail({
                displayName,
                churchName,
                formattedAmount: formatted,
                purpose: purpose ?? 'General Fund',
                dateLabel: receiptDate.label,
                givingId: givingRef.id,
              });
              try {
                const resend = getResend();
                const response = await resend.emails.send({
                  from: 'Kandilo <giving@kandilo.org>',
                  to: email,
                  subject: emailMessage.subject,
                  html: emailMessage.html,
                  text: emailMessage.text,
                }, { idempotencyKey: `donation-confirmation-${givingRef.id}` });
                if (response.error) {
                  console.error('Giving receipt email provider rejected request.', {
                    errorName: response.error.name ?? 'ResendError',
                  });
                  throw new HttpsError('internal', 'Donation receipt email could not be sent.');
                }
                await givingRef.update({
                  receiptEmailSentAt: FieldValue.serverTimestamp(),
                  receiptEmailDateLabel: receiptDate.label,
                  receiptEmailAmountCents: amountCents,
                  receiptEmailSendingAt: FieldValue.delete(),
                });
              } catch (receiptError) {
                console.error('Giving receipt email failed:', sanitizedErrorContext(receiptError));
                deliveryRetryError = receiptError;
                const errorCode = resendConfigurationErrorCode(receiptError) ?? 'receipt_send_failed';
                await givingRef.update({
                  receiptEmailSendingAt: FieldValue.delete(),
                  receiptEmailError: errorCode,
                }).catch(() => undefined);
              }
            }
          }
        } catch (err) {
          deliveryRetryError = err;
          console.error('Giving completion follow-up failed:', sanitizedErrorContext(err));
          await givingRef.update({
            receiptEmailSendingAt: FieldValue.delete(),
            receiptEmailError: 'receipt_followup_failed',
          }).catch(() => undefined);
        }
      }
    }

    const latestGiving = (await givingRef.get()).data() ?? after;
    if (completedGivingNeedsTaxReceiptFollowUp(latestGiving)) {
      await processCompletedGivingTaxReceiptFollowUp(givingRef, latestGiving);
    }
    if (deliveryRetryError) throw deliveryRetryError;
  }
);
