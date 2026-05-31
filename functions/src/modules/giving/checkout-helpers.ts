import { Timestamp } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import { getStripe } from '../../shared/clients';
import { configuredStripeReturnAppUrl } from '../../shared/appUrl';
import { db } from '../../shared/firebase';
import { sanitizedErrorContext } from '../../shared/logging';
import { loadChurchPaymentSettings, ChurchPaymentSettings } from '../../shared/paymentSettings';
import {
  DEFAULT_APP_URL,
  GIVING_PAYMENT_METADATA_COLLECTION,
} from './constants';

export function givingPaymentMetadataRef(givingId: string): FirebaseFirestore.DocumentReference {
  return db.collection(GIVING_PAYMENT_METADATA_COLLECTION).doc(givingId);
}

export function getAppUrl(): string {
  return configuredStripeReturnAppUrl(process.env.APP_URL, DEFAULT_APP_URL, 'Stripe Checkout');
}

export function checkoutUrlIsSafe(url: string | null): url is string {
  if (typeof url !== 'string') {
    return false;
  }

  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && parsed.hostname === 'checkout.stripe.com';
  } catch {
    return false;
  }
}

export function timestampFromStripeSeconds(value: unknown): Timestamp | null {
  return typeof value === 'number' ? Timestamp.fromMillis(value * 1000) : null;
}

export function canApplyCheckoutCompletion(status: unknown): boolean {
  return status === undefined || status === null || status === 'creating' || status === 'pending' || status === 'failed';
}

export function canApplyCheckoutFailure(status: unknown): boolean {
  return status === undefined || status === null || status === 'creating' || status === 'pending';
}

export function stripeObjectId(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    const id = (value as Record<string, unknown>).id;
    return typeof id === 'string' ? id : '';
  }
  return '';
}

function stripeRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function stripeV2RequirementStatusBlocksRouting(value: unknown): boolean {
  return value === 'currently_due' || value === 'past_due';
}

function stripeV2AccountHasBlockingRequirements(account: unknown): boolean {
  const requirements = stripeRecord(stripeRecord(account).requirements);
  const summary = stripeRecord(requirements.summary);
  const minimumDeadline = stripeRecord(summary.minimum_deadline);
  if (stripeV2RequirementStatusBlocksRouting(minimumDeadline.status)) {
    return true;
  }

  const entries = Array.isArray(requirements.entries) ? requirements.entries : [];
  return entries.some((entry) => {
    const entryRecord = stripeRecord(entry);
    const entryDeadline = stripeRecord(entryRecord.minimum_deadline);
    if (stripeV2RequirementStatusBlocksRouting(entryDeadline.status)) {
      return true;
    }
    const impact = stripeRecord(entryRecord.impact);
    const restrictedCapabilities = Array.isArray(impact.restricts_capabilities)
      ? impact.restricts_capabilities
      : [];
    return restrictedCapabilities.some((capability) => {
      const deadline = stripeRecord(stripeRecord(capability).deadline);
      return stripeV2RequirementStatusBlocksRouting(deadline.status);
    });
  });
}

function stripeV2RecipientCapabilityStatus(account: unknown, capability: 'stripe_transfers' | 'payouts'): string {
  const configuration = stripeRecord(stripeRecord(account).configuration);
  const recipient = stripeRecord(configuration.recipient);
  const capabilities = stripeRecord(recipient.capabilities);
  const stripeBalance = stripeRecord(capabilities.stripe_balance);
  const capabilityRecord = stripeRecord(stripeBalance[capability]);
  return typeof capabilityRecord.status === 'string' ? capabilityRecord.status : '';
}

function stripeV1AccountReadyForRouting(account: unknown, accountId: string): boolean {
  const record = stripeRecord(account);
  const requirements = stripeRecord(record.requirements);
  const hasOpenRequirements =
    (Array.isArray(requirements.currently_due) && requirements.currently_due.length > 0)
    || (Array.isArray(requirements.past_due) && requirements.past_due.length > 0)
    || Boolean(requirements.disabled_reason);

  return record.id === accountId
    && record.charges_enabled === true
    && record.payouts_enabled === true
    && record.details_submitted === true
    && !hasOpenRequirements;
}

function stripeV2AccountReadyForRouting(account: unknown, accountId: string): boolean {
  const record = stripeRecord(account);
  const transferStatus = stripeV2RecipientCapabilityStatus(account, 'stripe_transfers');
  const payoutStatus = stripeV2RecipientCapabilityStatus(account, 'payouts');
  return record.closed !== true
    && record.id === accountId
    && Array.isArray(record.applied_configurations)
    && record.applied_configurations.includes('recipient')
    && transferStatus === 'active'
    && (!payoutStatus || payoutStatus === 'active')
    && !stripeV2AccountHasBlockingRequirements(account);
}

async function assertStripeConnectReadyForCheckout(
  stripe: ReturnType<typeof getStripe>,
  settings: ChurchPaymentSettings,
  churchId: string
): Promise<void> {
  let account: unknown;
  try {
    account = settings.stripeConnectAccountApi === 'v2'
      ? await stripe.v2.core.accounts.retrieve(settings.stripeConnectAccountId, {
        include: ['configuration.recipient', 'requirements'],
      })
      : await stripe.accounts.retrieve(settings.stripeConnectAccountId);
  } catch (error) {
    console.error('Stripe connected account readiness check failed:', {
      churchId,
      stripeConnectAccountApi: settings.stripeConnectAccountApi,
      ...sanitizedErrorContext(error),
    });
    throw new HttpsError(
      'failed-precondition',
      'This parish payment account is not ready for live donation routing.'
    );
  }

  const ready = settings.stripeConnectAccountApi === 'v2'
    ? stripeV2AccountReadyForRouting(account, settings.stripeConnectAccountId)
    : stripeV1AccountReadyForRouting(account, settings.stripeConnectAccountId);
  if (!ready) {
    throw new HttpsError(
      'failed-precondition',
      'This parish payment account is not ready for live donation routing.'
    );
  }
}

export async function stripeConnectDestinationForChurch(
  stripe: ReturnType<typeof getStripe>,
  churchId: string
): Promise<string> {
  const settings = await loadChurchPaymentSettings(churchId);
  if (!settings.stripeConnectEnabled) {
    return '';
  }

  await assertStripeConnectReadyForCheckout(stripe, settings, churchId);

  return settings.stripeConnectAccountId;
}

export function stripeEventLivemode(event: { livemode?: unknown; data?: { object?: { livemode?: unknown } } }): boolean | null {
  if (typeof event.livemode === 'boolean') {
    return event.livemode;
  }
  const objectLivemode = event.data?.object?.livemode;
  return typeof objectLivemode === 'boolean' ? objectLivemode : null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function findGivingRefForSession(session: any): Promise<FirebaseFirestore.DocumentReference | null> {
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

  const metadataSnap = await db
    .collection(GIVING_PAYMENT_METADATA_COLLECTION)
    .where('stripeCheckoutSessionId', '==', session.id)
    .limit(1)
    .get();
  if (!metadataSnap.empty) {
    const ref = db.collection('giving').doc(metadataSnap.docs[0].id);
    if ((await ref.get()).exists) {
      return ref;
    }
  }

  const snap = await db
    .collection('giving')
    .where('stripeCheckoutSessionId', '==', session.id)
    .limit(1)
    .get();
  return snap.empty ? null : snap.docs[0].ref;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function findGivingRefForCharge(charge: any): Promise<FirebaseFirestore.DocumentReference | null> {
  const metadataGivingId = typeof charge.metadata?.givingId === 'string' ? charge.metadata.givingId : '';
  const paymentIntentId = stripeObjectId(charge.payment_intent);

  if (/^[A-Za-z0-9_-]{1,128}$/.test(metadataGivingId)) {
    const ref = db.collection('giving').doc(metadataGivingId);
    const snap = await ref.get();
    if (snap.exists) {
      const giving = snap.data() ?? {};
      const paymentMetadata = (await givingPaymentMetadataRef(metadataGivingId).get()).data() ?? {};
      const expectedAmountCents =
        typeof giving.amountCents === 'number'
          ? giving.amountCents
          : Math.round((typeof giving.amount === 'number' ? giving.amount : 0) * 100);
      const metadataMatches =
        charge.metadata.churchId === giving.churchId
        && charge.metadata.userId === giving.userId
        && charge.metadata.amountCents === String(expectedAmountCents)
        && charge.metadata.currency === String(giving.currency ?? '').toLowerCase();
      const paymentIntentMatches =
        typeof paymentMetadata.stripePaymentIntentId === 'string'
        && paymentMetadata.stripePaymentIntentId === paymentIntentId;
      if (
        !paymentIntentId
        || paymentIntentMatches
        || giving.stripePaymentIntentId === paymentIntentId
        || metadataMatches
      ) {
        return ref;
      }
    }
  }

  if (!paymentIntentId) {
    return null;
  }

  const metadataSnap = await db
    .collection(GIVING_PAYMENT_METADATA_COLLECTION)
    .where('stripePaymentIntentId', '==', paymentIntentId)
    .limit(1)
    .get();
  if (!metadataSnap.empty) {
    const ref = db.collection('giving').doc(metadataSnap.docs[0].id);
    if ((await ref.get()).exists) {
      return ref;
    }
  }

  const snap = await db
    .collection('giving')
    .where('stripePaymentIntentId', '==', paymentIntentId)
    .limit(1)
    .get();
  return snap.empty ? null : snap.docs[0].ref;
}
