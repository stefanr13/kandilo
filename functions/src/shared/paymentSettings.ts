import { FieldValue } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import { db } from './firebase';

export const CHURCH_PAYMENT_SETTINGS_COLLECTION = 'churchPaymentSettings';

export type StripeConnectAccountApi = 'v1' | 'v2';

export type ChurchPaymentSettings = {
  stripeConnectEnabled: boolean;
  stripeConnectAccountId: string;
  stripeConnectAccountApi: StripeConnectAccountApi;
};

const STRIPE_CONNECT_ACCOUNT_ID_PATTERN = /^acct_[A-Za-z0-9]{8,64}$/;

export function stripeConnectAccountIdLooksValid(value: string): boolean {
  return STRIPE_CONNECT_ACCOUNT_ID_PATTERN.test(value.trim());
}

export function sanitizeChurchPaymentSettings(value: unknown): ChurchPaymentSettings {
  const record =
    typeof value === 'object' && value !== null && !Array.isArray(value)
      ? value as Record<string, unknown>
      : {};
  const stripeConnectEnabled = record.stripeConnectEnabled === true;
  const stripeConnectAccountId =
    typeof record.stripeConnectAccountId === 'string' ? record.stripeConnectAccountId.trim() : '';
  const stripeConnectAccountApi = record.stripeConnectAccountApi === 'v2' ? 'v2' : 'v1';

  if (stripeConnectAccountId && !stripeConnectAccountIdLooksValid(stripeConnectAccountId)) {
    throw new HttpsError('invalid-argument', 'stripeConnectAccountId must be a valid Stripe connected account ID.');
  }
  if (stripeConnectEnabled && !stripeConnectAccountId) {
    throw new HttpsError(
      'invalid-argument',
      'Enabled Stripe Connect routing requires a connected account ID.'
    );
  }

  return {
    stripeConnectEnabled,
    stripeConnectAccountId,
    stripeConnectAccountApi,
  };
}

export async function loadChurchPaymentSettings(churchId: string): Promise<ChurchPaymentSettings> {
  const snap = await db.collection(CHURCH_PAYMENT_SETTINGS_COLLECTION).doc(churchId).get();
  return sanitizeChurchPaymentSettings(snap.data() ?? {});
}

export function paymentSettingsAuditSummary(value: unknown): Record<string, unknown> {
  const settings =
    typeof value === 'object' && value !== null && !Array.isArray(value)
      ? value as Record<string, unknown>
      : {};
  const accountId = typeof settings.stripeConnectAccountId === 'string'
    ? settings.stripeConnectAccountId.trim()
    : '';

  return {
    stripeConnectEnabled: settings.stripeConnectEnabled === true,
    stripeConnectAccountConfigured: stripeConnectAccountIdLooksValid(accountId),
    stripeConnectAccountApi: settings.stripeConnectAccountApi === 'v2' ? 'v2' : 'v1',
  };
}

export function churchPaymentSettingsWritePayload(
  settings: ChurchPaymentSettings,
  actorUid: string
): Record<string, unknown> {
  return {
    stripeConnectEnabled: settings.stripeConnectEnabled,
    stripeConnectAccountId: settings.stripeConnectAccountId,
    stripeConnectAccountApi: settings.stripeConnectAccountId
      ? settings.stripeConnectAccountApi
      : FieldValue.delete(),
    updatedAt: FieldValue.serverTimestamp(),
    updatedBy: actorUid,
  };
}
