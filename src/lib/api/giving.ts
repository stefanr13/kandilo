import { callFunction } from './client';

export async function createGivingCheckoutSession(input: {
  churchId: string;
  amountCents: number;
  currency?: string;
  purpose?: string;
  anonymous?: boolean;
}): Promise<{ checkoutUrl: string; givingId: string; sessionId: string }> {
  return callFunction<typeof input, { checkoutUrl: string; givingId: string; sessionId: string }>(
    'createStripeCheckoutSession',
    input
  );
}
