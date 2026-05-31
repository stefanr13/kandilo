import { describe, expect, it } from 'vitest';
import {
  assertStripeCheckoutUrl,
  checkoutReturnMatchesPendingGiving,
  parsePendingGivingCheckoutState,
} from './checkout';

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

  it('parses pending checkout context only from JSON objects', () => {
    expect(parsePendingGivingCheckoutState(null)).toBeNull();
    expect(parsePendingGivingCheckoutState('{"amount":"50","givingId":"giving-1"}')).toMatchObject({
      amount: '50',
      givingId: 'giving-1',
    });
    expect(parsePendingGivingCheckoutState('{"amount":"50","currency":"CAD"}')).toMatchObject({
      amount: '50',
      currency: 'CAD',
    });
    expect(parsePendingGivingCheckoutState('{bad json')).toBeNull();
    expect(parsePendingGivingCheckoutState('"not an object"')).toBeNull();
  });

  it('binds successful Checkout returns to the pending giving and session ids when present', () => {
    expect(checkoutReturnMatchesPendingGiving(null, 'giving-1', 'cs_test_1')).toBe(true);
    expect(checkoutReturnMatchesPendingGiving({ amount: '50' }, 'giving-1', 'cs_test_1')).toBe(true);
    expect(
      checkoutReturnMatchesPendingGiving(
        { givingId: 'giving-1', sessionId: 'cs_test_1' },
        'giving-1',
        'cs_test_1'
      )
    ).toBe(true);
    expect(
      checkoutReturnMatchesPendingGiving(
        { givingId: 'giving-1', sessionId: 'cs_test_1' },
        'giving-2',
        'cs_test_1'
      )
    ).toBe(false);
    expect(
      checkoutReturnMatchesPendingGiving(
        { givingId: 'giving-1', sessionId: 'cs_test_1' },
        'giving-1',
        'cs_test_2'
      )
    ).toBe(false);
    expect(
      checkoutReturnMatchesPendingGiving(
        { givingId: 'giving-1', sessionId: 'cs_test_1' },
        'giving-1',
        null
      )
    ).toBe(false);
  });
});
