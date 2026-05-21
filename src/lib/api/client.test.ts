import { httpsCallable } from 'firebase/functions';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { functions } from '../firebase-functions';
import { callFunction } from './client';

vi.mock('firebase/functions', () => ({
  httpsCallable: vi.fn(),
}));

vi.mock('../firebase-functions', () => ({
  functions: { name: 'mock-functions' },
}));

const httpsCallableMock = vi.mocked(httpsCallable);

function createCallableMock(data: unknown) {
  const callable = vi.fn().mockResolvedValue({ data });
  return Object.assign(callable, { stream: vi.fn() });
}

describe('callFunction', () => {
  beforeEach(() => {
    httpsCallableMock.mockReset();
  });

  it('returns callable data and uses limited-use App Check tokens for replay-protected functions', async () => {
    const callable = createCallableMock({ checkoutUrl: 'https://checkout.stripe.com/c/pay/1' });
    httpsCallableMock.mockReturnValue(callable);

    await expect(callFunction('createStripeCheckoutSession', { amountCents: 5000 })).resolves.toEqual({
      checkoutUrl: 'https://checkout.stripe.com/c/pay/1',
    });

    expect(httpsCallableMock).toHaveBeenCalledWith(functions, 'createStripeCheckoutSession', {
      limitedUseAppCheckTokens: true,
    });
    expect(callable).toHaveBeenCalledWith({ amountCents: 5000 });
  });

  it('uses limited-use App Check tokens for parish self-join requests', async () => {
    const callable = createCallableMock({ success: true });
    httpsCallableMock.mockReturnValue(callable);

    await expect(callFunction('joinChurch', { churchId: 'church-1' })).resolves.toEqual({ success: true });

    expect(httpsCallableMock).toHaveBeenCalledWith(functions, 'joinChurch', {
      limitedUseAppCheckTokens: true,
    });
    expect(callable).toHaveBeenCalledWith({ churchId: 'church-1' });
  });

  it('uses limited-use App Check tokens for branded auth emails', async () => {
    const callable = createCallableMock({ success: true });
    httpsCallableMock.mockReturnValue(callable);

    await expect(callFunction('sendPasswordResetEmail', { email: 'user@example.com' })).resolves.toEqual({
      success: true,
    });

    expect(httpsCallableMock).toHaveBeenCalledWith(functions, 'sendPasswordResetEmail', {
      limitedUseAppCheckTokens: true,
    });
    expect(callable).toHaveBeenCalledWith({ email: 'user@example.com' });
  });

  it('does not request replay protection for regular functions', async () => {
    const callable = createCallableMock({ ok: true });
    httpsCallableMock.mockReturnValue(callable);

    await expect(callFunction('faithAiChat', { message: 'hello' })).resolves.toEqual({ ok: true });

    expect(httpsCallableMock).toHaveBeenCalledWith(functions, 'faithAiChat', undefined);
    expect(callable).toHaveBeenCalledWith({ message: 'hello' });
  });
});
