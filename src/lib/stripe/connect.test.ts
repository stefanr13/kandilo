import { describe, expect, it } from 'vitest';
import {
  createPendingStripeConnectOnboardingState,
  createStripeConnectReturnState,
  parsePendingStripeConnectOnboardingState,
  STRIPE_CONNECT_RETURN_STATE_MAX_AGE_MS,
  stripeConnectReturnMatchesPendingOnboarding,
  stripeConnectReturnStateLooksValid,
} from './connect';

describe('Stripe Connect onboarding helpers', () => {
  it('creates bounded URL-safe return state tokens', () => {
    const returnState = createStripeConnectReturnState({
      getRandomValues: (bytes: Uint8Array) => {
        bytes.fill(63);
        return bytes;
      },
    });

    expect(returnState).toBe('-'.repeat(32));
    expect(stripeConnectReturnStateLooksValid(returnState)).toBe(true);
    expect(stripeConnectReturnStateLooksValid('too-short')).toBe(false);
    expect(stripeConnectReturnStateLooksValid(`${'_'.repeat(31)}/`)).toBe(false);
    expect(() => createStripeConnectReturnState(
      { getRandomValues: undefined } as unknown as Parameters<typeof createStripeConnectReturnState>[0]
    )).toThrow('Secure random values are required for Stripe Connect onboarding.');
  });

  it('parses pending onboarding state only from valid JSON objects', () => {
    const pending = createPendingStripeConnectOnboardingState(
      'church-1',
      '_'.repeat(32),
      1_000
    );

    expect(parsePendingStripeConnectOnboardingState(JSON.stringify(pending))).toEqual(pending);
    expect(parsePendingStripeConnectOnboardingState(null)).toBeNull();
    expect(parsePendingStripeConnectOnboardingState('{bad json')).toBeNull();
    expect(parsePendingStripeConnectOnboardingState('"not an object"')).toBeNull();
    expect(parsePendingStripeConnectOnboardingState(JSON.stringify({
      ...pending,
      returnState: 'bad/state',
    }))).toBeNull();
  });

  it('binds Stripe Connect returns to the pending church and return state', () => {
    const pending = createPendingStripeConnectOnboardingState(
      'church-1',
      '_'.repeat(32),
      1_000
    );

    expect(stripeConnectReturnMatchesPendingOnboarding(pending, 'church-1', '_'.repeat(32), 2_000)).toBe(true);
    expect(stripeConnectReturnMatchesPendingOnboarding(pending, 'church-2', '_'.repeat(32), 2_000)).toBe(false);
    expect(stripeConnectReturnMatchesPendingOnboarding(pending, 'church-1', 'A'.repeat(32), 2_000)).toBe(false);
    expect(stripeConnectReturnMatchesPendingOnboarding(null, 'church-1', '_'.repeat(32), 2_000)).toBe(false);
    expect(stripeConnectReturnMatchesPendingOnboarding(pending, 'church-1', '_'.repeat(32), 999)).toBe(false);
    expect(stripeConnectReturnMatchesPendingOnboarding(
      pending,
      'church-1',
      '_'.repeat(32),
      1_000 + STRIPE_CONNECT_RETURN_STATE_MAX_AGE_MS + 1
    )).toBe(false);
  });
});
