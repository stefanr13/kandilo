export const PENDING_GIVING_STORAGE_KEY = 'kandilo:pendingGiving';
export const GIVING_CONFIRMATION_ATTEMPTS = 10;
export const GIVING_CONFIRMATION_DELAY_MS = 1200;

export interface PendingGivingCheckoutState {
  amount?: string;
  currency?: string;
  fullName?: string;
  email?: string;
  purpose?: string;
  anonymous?: boolean;
  givingId?: string;
  sessionId?: string;
}

export function assertStripeCheckoutUrl(url: string, errorMessage: string): string {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' || parsed.hostname !== 'checkout.stripe.com') {
    throw new Error(errorMessage);
  }
  return parsed.toString();
}

export function parsePendingGivingCheckoutState(raw: string | null): PendingGivingCheckoutState | null {
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? parsed as PendingGivingCheckoutState
      : null;
  } catch {
    return null;
  }
}

export function checkoutReturnMatchesPendingGiving(
  pending: PendingGivingCheckoutState | null,
  givingId: string,
  sessionId: string | null
): boolean {
  const expectedGivingId = pending?.givingId?.trim() ?? '';
  const expectedSessionId = pending?.sessionId?.trim() ?? '';

  if (expectedGivingId && expectedGivingId !== givingId) {
    return false;
  }
  if (expectedSessionId && expectedSessionId !== (sessionId ?? '')) {
    return false;
  }

  return true;
}
