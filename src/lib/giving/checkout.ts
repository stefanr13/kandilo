export const PENDING_GIVING_STORAGE_KEY = 'kandilo:pendingGiving';
export const GIVING_CONFIRMATION_ATTEMPTS = 10;
export const GIVING_CONFIRMATION_DELAY_MS = 1200;

export function assertStripeCheckoutUrl(url: string, errorMessage: string): string {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' || parsed.hostname !== 'checkout.stripe.com') {
    throw new Error(errorMessage);
  }
  return parsed.toString();
}
