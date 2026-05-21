import { httpsCallable } from 'firebase/functions';
import { functions } from '../firebase-functions';

const REPLAY_PROTECTED_FUNCTIONS = new Set([
  'acceptInvitation',
  'assignChurchMembershipAsSuperAdmin',
  'createChurch',
  'createStripeCheckoutSession',
  'joinChurch',
  'promoteSuperAdmin',
  'sendInvitation',
  'sendPushNotification',
  'setChurchActiveState',
  'updateChurchAsSuperAdmin',
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
