import { httpsCallable } from 'firebase/functions';
import { functions } from '../firebase-functions';

const REPLAY_PROTECTED_FUNCTIONS = new Set([
  'acceptInvitation',
  'assignChurchMembershipAsSuperAdmin',
  'createChurch',
  'createChurchStripeConnectAccountAsSuperAdmin',
  'createStripeCheckoutSession',
  'createStripePaymentIntent',
  'createChurchStripeConnectOnboardingLink',
  'downloadTaxReceiptPdf',
  'deleteEventMenuItem',
  'joinChurch',
  'registerPushToken',
  'unregisterPushToken',
  'promoteSuperAdmin',
  'sendInvitation',
  'sendAnnualTaxReceipt',
  'sendChurchAnnualTaxReceipts',
  'sendChurchCorrectedAnnualTaxReceipts',
  'sendCorrectedAnnualTaxReceipt',
  'sendCorrectedTaxReceipt',
  'sendEmailVerificationEmail',
  'saveEventPortalSetup',
  'scanEventTicket',
  'sendPasswordResetEmail',
  'sendEventAnnouncement',
  'sendPushNotification',
  'sendTaxReceipt',
  'setChurchActiveState',
  'submitEventFoodOrder',
  'updateEventFoodOrderStatus',
  'updateChurchAsSuperAdmin',
  'updateChurchPaymentSettingsAsSuperAdmin',
  'upsertEventMenuItem',
]);

export async function callFunction<Req, Res>(name: string, data: Req): Promise<Res> {
  const callable = httpsCallable<Req, Res>(
    functions,
    name,
    REPLAY_PROTECTED_FUNCTIONS.has(name)
      ? { limitedUseAppCheckTokens: true }
      : undefined
  );
  const result = await callable(data);
  return result.data;
}
