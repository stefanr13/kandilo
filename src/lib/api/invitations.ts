import { callFunction } from './client';

export async function acceptInvitation(invitationId: string): Promise<{ success: boolean; alreadyMember?: boolean }> {
  return callFunction<{ invitationId: string }, { success: boolean; alreadyMember?: boolean }>(
    'acceptInvitation',
    { invitationId }
  );
}

export async function sendInvitation(input: {
  churchId: string;
  inviteeEmail: string;
  role?: 'member' | 'admin';
}): Promise<{ success: boolean; invitationId: string; inviteUrl?: string; emailSent?: boolean }> {
  return callFunction<
    typeof input,
    { success: boolean; invitationId: string; inviteUrl?: string; emailSent?: boolean }
  >('sendInvitation', input);
}
