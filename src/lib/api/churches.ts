import { callFunction } from './client';
import type { ChurchSummary } from '../../domain/church';

export async function listActiveChurches(): Promise<ChurchSummary[]> {
  const result = await callFunction<Record<string, never>, { churches: ChurchSummary[] }>(
    'listActiveChurches',
    {}
  );
  return result.churches;
}

export async function joinChurch(churchId: string): Promise<{ success: boolean; alreadyMember?: boolean }> {
  return callFunction<{ churchId: string }, { success: boolean; alreadyMember?: boolean }>(
    'joinChurch',
    { churchId }
  );
}
