const STORAGE_PREFIX = 'kandilo.emailVerification.sentAt.';
const RESEND_WINDOW_MS = 60 * 60 * 1000;
const RESEND_LIMIT = 3;

export const EMAIL_VERIFICATION_RESEND_COOLDOWN_MS = 10 * 60 * 1000;

function storageKey(uid: string) {
  return `${STORAGE_PREFIX}${uid}`;
}

function readAttempts(uid: string, now: number): number[] {
  if (typeof window === 'undefined') {
    return [];
  }

  try {
    const raw = window.localStorage.getItem(storageKey(uid));
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
      .filter((sentAt) => now - sentAt < RESEND_WINDOW_MS)
      .sort((a, b) => a - b);
  } catch {
    return [];
  }
}

function writeAttempts(uid: string, attempts: number[]) {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.localStorage.setItem(storageKey(uid), JSON.stringify(attempts));
  } catch {
    // Server-side rate limiting remains authoritative when local storage is unavailable.
  }
}

export function getEmailVerificationSendState(uid: string, now = Date.now()) {
  const attempts = readAttempts(uid, now);
  const lastAttemptAt = attempts.at(-1) ?? 0;
  const cooldownAllowedAt = lastAttemptAt + EMAIL_VERIFICATION_RESEND_COOLDOWN_MS;
  const limitAllowedAt =
    attempts.length >= RESEND_LIMIT
      ? attempts[0] + RESEND_WINDOW_MS
      : now;
  const nextAllowedAt = Math.max(cooldownAllowedAt, limitAllowedAt);

  return {
    canSend: nextAllowedAt <= now,
    nextAllowedAt,
    remainingMs: Math.max(0, nextAllowedAt - now),
  };
}

export function markEmailVerificationEmailSent(uid: string, now = Date.now()) {
  const attempts = readAttempts(uid, now);
  writeAttempts(uid, [...attempts, now]);
}
