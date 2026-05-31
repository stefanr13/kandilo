export const PENDING_STRIPE_CONNECT_STORAGE_KEY = 'kandilo:pendingStripeConnect';
export const STRIPE_CONNECT_RETURN_STATE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

const RETURN_STATE_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-';
const RETURN_STATE_PATTERN = /^[A-Za-z0-9_-]{32}$/;

type RandomValueProvider = {
  getRandomValues: (bytes: Uint8Array) => Uint8Array;
};

export interface PendingStripeConnectOnboardingState {
  churchId: string;
  returnState: string;
  createdAtMillis: number;
}

export function stripeConnectReturnStateLooksValid(value: string): boolean {
  return RETURN_STATE_PATTERN.test(value);
}

export function createStripeConnectReturnState(
  cryptoRef: RandomValueProvider | undefined =
    typeof globalThis.crypto === 'undefined' ? undefined : globalThis.crypto
): string {
  if (!cryptoRef?.getRandomValues) {
    throw new Error('Secure random values are required for Stripe Connect onboarding.');
  }

  const bytes = new Uint8Array(32);
  cryptoRef.getRandomValues(bytes);

  return Array.from(bytes, (byte) => RETURN_STATE_ALPHABET[byte & 63]).join('');
}

export function createPendingStripeConnectOnboardingState(
  churchId: string,
  returnState: string,
  createdAtMillis = Date.now()
): PendingStripeConnectOnboardingState {
  return {
    churchId,
    returnState,
    createdAtMillis,
  };
}

export function parsePendingStripeConnectOnboardingState(
  raw: string | null
): PendingStripeConnectOnboardingState | null {
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return null;
    }

    const record = parsed as Record<string, unknown>;
    const churchId = typeof record.churchId === 'string' ? record.churchId.trim() : '';
    const returnState = typeof record.returnState === 'string' ? record.returnState.trim() : '';
    const createdAtMillis =
      typeof record.createdAtMillis === 'number' && Number.isFinite(record.createdAtMillis)
        ? record.createdAtMillis
        : 0;

    if (!churchId || !stripeConnectReturnStateLooksValid(returnState) || createdAtMillis <= 0) {
      return null;
    }

    return {
      churchId,
      returnState,
      createdAtMillis,
    };
  } catch {
    return null;
  }
}

export function stripeConnectReturnMatchesPendingOnboarding(
  pending: PendingStripeConnectOnboardingState | null,
  churchId: string,
  returnState: string,
  nowMillis = Date.now()
): boolean {
  if (!pending || !stripeConnectReturnStateLooksValid(returnState)) {
    return false;
  }

  return pending.churchId === churchId
    && pending.returnState === returnState
    && nowMillis >= pending.createdAtMillis
    && nowMillis - pending.createdAtMillis <= STRIPE_CONNECT_RETURN_STATE_MAX_AGE_MS;
}
