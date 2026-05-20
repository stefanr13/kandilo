import { Role, SuperAdminChurchInput, SuperAdminChurchStats } from '../../domain/church';
import { callFunction } from './client';

export async function fetchSuperAdminStats(): Promise<SuperAdminChurchStats[]> {
  const result = await callFunction<Record<string, never>, { stats: SuperAdminChurchStats[] }>(
    'getSuperAdminStats',
    {}
  );
  return result.stats;
}

export async function createChurchAsSuperAdmin(input: SuperAdminChurchInput): Promise<{ success: boolean; churchId: string }> {
  return callFunction<SuperAdminChurchInput, { success: boolean; churchId: string }>('createChurch', input);
}

export async function updateChurchAsSuperAdmin(
  churchId: string,
  updates: SuperAdminChurchInput
): Promise<{ success: boolean }> {
  return callFunction<
    { churchId: string; updates: SuperAdminChurchInput },
    { success: boolean }
  >('updateChurchAsSuperAdmin', { churchId, updates });
}

export async function setChurchActiveState(
  churchId: string,
  isActive: boolean
): Promise<{ success: boolean; churchId: string; isActive: boolean }> {
  return callFunction<
    { churchId: string; isActive: boolean },
    { success: boolean; churchId: string; isActive: boolean }
  >('setChurchActiveState', { churchId, isActive });
}

export async function assignChurchMembershipAsSuperAdmin(input: {
  churchId: string;
  email: string;
  role: Role;
}): Promise<{
  success: boolean;
  churchId: string;
  uid: string;
  email: string;
  role: Role;
  emailVerified: boolean;
}> {
  return callFunction<
    typeof input,
    {
      success: boolean;
      churchId: string;
      uid: string;
      email: string;
      role: Role;
      emailVerified: boolean;
    }
  >('assignChurchMembershipAsSuperAdmin', input);
}

export async function promoteUserToSuperAdmin(targetUid: string): Promise<{ success: boolean }> {
  return callFunction<{ targetUid: string }, { success: boolean }>('promoteSuperAdmin', { targetUid });
}
