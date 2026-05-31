import { describe, expect, it } from 'vitest';
import type { SuperAdminPaymentOperationsReadiness } from '../../types';
import { formatStripeAccount } from './MissionControlAnalyticsTab';

function stripeAccount(
  overrides: Partial<SuperAdminPaymentOperationsReadiness['stripeAccount']> = {}
): SuperAdminPaymentOperationsReadiness['stripeAccount'] {
  return {
    checked: true,
    ready: true,
    chargesEnabled: true,
    payoutsEnabled: true,
    detailsSubmitted: true,
    country: 'US',
    defaultCurrency: 'usd',
    disabledReason: '',
    currentlyDueCount: 0,
    pastDueCount: 0,
    eventuallyDueCount: 0,
    futureCurrentlyDueCount: 0,
    futurePastDueCount: 0,
    futureEventuallyDueCount: 0,
    errorCode: '',
    ...overrides,
  };
}

describe('MissionControlAnalyticsTab readiness formatting', () => {
  it('shows Stripe queued requirement counts without exposing requirement field names', () => {
    const label = formatStripeAccount(stripeAccount({
      eventuallyDueCount: 2,
      futureCurrentlyDueCount: 1,
      futurePastDueCount: 1,
      futureEventuallyDueCount: 1,
    }));

    expect(label).toBe('Ready, eventual: 2, future: 3');
    expect(label).not.toContain('company.tax_id');
    expect(label).not.toContain('representative');
    expect(label).not.toContain('owners.address');
  });

  it('keeps current Stripe account blockers primary while preserving queued counts', () => {
    expect(formatStripeAccount(stripeAccount({
      ready: false,
      currentlyDueCount: 2,
      eventuallyDueCount: 2,
      futureEventuallyDueCount: 1,
    }))).toBe('Requirements due, eventual: 2, future: 1');

    expect(formatStripeAccount(stripeAccount({
      ready: false,
      payoutsEnabled: false,
      eventuallyDueCount: 1,
      futureCurrentlyDueCount: 1,
    }))).toBe('Payouts off, eventual: 1, future: 1');
  });
});
