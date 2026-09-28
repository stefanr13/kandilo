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
const DONATION_AND_RECEIPT_REPLAY_PROTECTED_FUNCTIONS = [
  'createStripeCheckoutSession',
  'createStripePaymentIntent',
  'sendTaxReceipt',
  'sendCorrectedTaxReceipt',
  'sendAnnualTaxReceipt',
  'sendCorrectedAnnualTaxReceipt',
  'downloadTaxReceiptPdf',
  'sendChurchAnnualTaxReceipts',
  'sendChurchCorrectedAnnualTaxReceipts',
  'createChurchStripeConnectAccountAsSuperAdmin',
  'createChurchStripeConnectOnboardingLink',
] as const;
const EVENT_REPLAY_PROTECTED_FUNCTIONS = [
  'saveEventPortalSetup',
  'upsertEventMenuItem',
  'deleteEventMenuItem',
  'submitEventFoodOrder',
  'updateEventFoodOrderStatus',
  'sendEventAnnouncement',
] as const;

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

  it('uses limited-use App Check tokens for corrected annual receipt batches', async () => {
    const callable = createCallableMock({ success: true, emailSentCount: 2 });
    httpsCallableMock.mockReturnValue(callable);

    await expect(
      callFunction('sendChurchCorrectedAnnualTaxReceipts', { churchId: 'church-1', year: 2025 })
    ).resolves.toEqual({ success: true, emailSentCount: 2 });

    expect(httpsCallableMock).toHaveBeenCalledWith(functions, 'sendChurchCorrectedAnnualTaxReceipts', {
      limitedUseAppCheckTokens: true,
    });
    expect(callable).toHaveBeenCalledWith({ churchId: 'church-1', year: 2025 });
  });

  it('uses limited-use App Check tokens for private church payment settings updates', async () => {
    const callable = createCallableMock({ success: true });
    httpsCallableMock.mockReturnValue(callable);

    await expect(
      callFunction('updateChurchPaymentSettingsAsSuperAdmin', {
        churchId: 'church-1',
        settings: { stripeConnectEnabled: true, stripeConnectAccountId: 'acct_test123456' },
      })
    ).resolves.toEqual({ success: true });

    expect(httpsCallableMock).toHaveBeenCalledWith(functions, 'updateChurchPaymentSettingsAsSuperAdmin', {
      limitedUseAppCheckTokens: true,
    });
  });

  it('uses limited-use App Check tokens for every donation and receipt callable', async () => {
    for (const functionName of DONATION_AND_RECEIPT_REPLAY_PROTECTED_FUNCTIONS) {
      const callable = createCallableMock({ ok: functionName });
      httpsCallableMock.mockReset();
      httpsCallableMock.mockReturnValue(callable);

      await expect(callFunction(functionName, { marker: functionName })).resolves.toEqual({ ok: functionName });

      expect(httpsCallableMock).toHaveBeenCalledWith(functions, functionName, {
        limitedUseAppCheckTokens: true,
      });
      expect(callable).toHaveBeenCalledWith({ marker: functionName });
    }
  });

  it('uses limited-use App Check tokens for every event platform write callable', async () => {
    for (const functionName of EVENT_REPLAY_PROTECTED_FUNCTIONS) {
      const callable = createCallableMock({ ok: functionName });
      httpsCallableMock.mockReset();
      httpsCallableMock.mockReturnValue(callable);

      await expect(callFunction(functionName, { marker: functionName })).resolves.toEqual({ ok: functionName });

      expect(httpsCallableMock).toHaveBeenCalledWith(functions, functionName, {
        limitedUseAppCheckTokens: true,
      });
      expect(callable).toHaveBeenCalledWith({ marker: functionName });
    }
  });

  it('does not request replay protection for regular functions', async () => {
    const callable = createCallableMock({ ok: true });
    httpsCallableMock.mockReturnValue(callable);

    await expect(callFunction('faithAiChat', { message: 'hello' })).resolves.toEqual({ ok: true });

    expect(httpsCallableMock).toHaveBeenCalledWith(functions, 'faithAiChat', undefined);
    expect(callable).toHaveBeenCalledWith({ message: 'hello' });
  });
});
