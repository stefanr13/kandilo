import {
  ChurchPaymentSettings,
  ChurchPaymentSettingsInput,
  ChurchStripeConnectAccountCreationResult,
  ChurchStripeConnectOnboardingLink,
  ChurchStripeConnectSetupStatus,
  Role,
  SuperAdminPaymentOperationsReadiness,
  SuperAdminChurchInput,
  SuperAdminChurchStats,
  SuperAdminTaxReceiptAuditEvent,
} from '../../domain/church';
import { callFunction } from './client';

export async function fetchPaymentOperationsReadiness(): Promise<SuperAdminPaymentOperationsReadiness> {
  return callFunction<Record<string, never>, SuperAdminPaymentOperationsReadiness>(
    'getPaymentOperationsReadiness',
    {}
  );
}

export async function fetchSuperAdminStats(): Promise<SuperAdminChurchStats[]> {
  const result = await callFunction<Record<string, never>, { stats: SuperAdminChurchStats[] }>(
    'getSuperAdminStats',
    {}
  );
  return result.stats;
}

export async function fetchTaxReceiptAuditEvents(): Promise<SuperAdminTaxReceiptAuditEvent[]> {
  const result = await callFunction<Record<string, never>, { events: SuperAdminTaxReceiptAuditEvent[] }>(
    'getTaxReceiptAuditEvents',
    {}
  );
  return result.events;
}

export async function fetchChurchPaymentSettings(churchId: string): Promise<ChurchPaymentSettings> {
  return callFunction<{ churchId: string }, ChurchPaymentSettings>(
    'getChurchPaymentSettings',
    { churchId }
  );
}

export async function updateChurchPaymentSettingsAsSuperAdmin(
  churchId: string,
  settings: ChurchPaymentSettingsInput
): Promise<{ success: boolean; churchId: string }> {
  return callFunction<
    { churchId: string; settings: ChurchPaymentSettingsInput },
    { success: boolean; churchId: string }
  >('updateChurchPaymentSettingsAsSuperAdmin', { churchId, settings });
}

export async function createChurchStripeConnectAccountAsSuperAdmin(
  churchId: string
): Promise<ChurchStripeConnectAccountCreationResult> {
  return callFunction<
    { churchId: string },
    ChurchStripeConnectAccountCreationResult
  >('createChurchStripeConnectAccountAsSuperAdmin', { churchId });
}

export async function createChurchStripeConnectOnboardingLink(
  churchId: string,
  returnState: string
): Promise<ChurchStripeConnectOnboardingLink> {
  return callFunction<
    { churchId: string; returnState: string },
    ChurchStripeConnectOnboardingLink
  >('createChurchStripeConnectOnboardingLink', { churchId, returnState });
}

export async function fetchChurchStripeConnectSetupStatus(
  churchId: string
): Promise<ChurchStripeConnectSetupStatus> {
  return callFunction<{ churchId: string }, ChurchStripeConnectSetupStatus>(
    'getChurchStripeConnectSetupStatus',
    { churchId }
  );
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
