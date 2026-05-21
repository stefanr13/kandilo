import { callFunction } from './client';

export async function joinChurch(churchId: string): Promise<{ success: boolean; alreadyMember?: boolean }> {
  return callFunction<{ churchId: string }, { success: boolean; alreadyMember?: boolean }>(
    'joinChurch',
    { churchId }
  );
}
