import { callFunction } from './client';

export async function sendPushNotification(input: {
  churchId: string;
  title: string;
  body: string;
  targetRoles: Array<'member' | 'admin' | 'priest'>;
}): Promise<{ success: boolean }> {
  return callFunction<typeof input, { success: boolean }>('sendPushNotification', input);
}
