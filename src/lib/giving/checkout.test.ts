import { describe, expect, it } from 'vitest';
import { assertStripeCheckoutUrl } from './checkout';

describe('giving checkout helpers', () => {
  it('accepts only Stripe Checkout https URLs', () => {
    expect(
      assertStripeCheckoutUrl(
        'https://checkout.stripe.com/c/pay/cs_test_123?client_reference_id=giving-1',
        'Unexpected checkout URL.'
      )
    ).toBe('https://checkout.stripe.com/c/pay/cs_test_123?client_reference_id=giving-1');

    expect(() =>
      assertStripeCheckoutUrl('http://checkout.stripe.com/c/pay/cs_test_123', 'Unexpected checkout URL.')
    ).toThrow('Unexpected checkout URL.');
    expect(() =>
      assertStripeCheckoutUrl('https://checkout.stripe.com.evil.test/c/pay/cs_test_123', 'Unexpected checkout URL.')
    ).toThrow('Unexpected checkout URL.');
    expect(() =>
      assertStripeCheckoutUrl('not-a-url', 'Unexpected checkout URL.')
    ).toThrow();
  });
});
