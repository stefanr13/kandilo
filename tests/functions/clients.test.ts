import { afterEach, describe, expect, it } from 'vitest';
import {
  getResend,
  getStripe,
  resendConfigurationErrorCode,
  resendApiKeyLooksValid,
  stripeSecretKeyMode,
  stripeWebhookSecretLooksValid,
} from '../../functions/src/shared/clients';
import { configuredStripeReturnAppUrl, stripeReturnAppUrlReadiness } from '../../functions/src/shared/appUrl';

const originalEnv = {
  FUNCTIONS_EMULATOR: process.env.FUNCTIONS_EMULATOR,
  KANDILO_FUNCTIONS_TEST_MODE: process.env.KANDILO_FUNCTIONS_TEST_MODE,
  RESEND_API_KEY: process.env.RESEND_API_KEY,
  STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
};

function restoreEnv(name: keyof typeof originalEnv): void {
  const value = originalEnv[name];
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

afterEach(() => {
  restoreEnv('FUNCTIONS_EMULATOR');
  restoreEnv('KANDILO_FUNCTIONS_TEST_MODE');
  restoreEnv('RESEND_API_KEY');
  restoreEnv('STRIPE_SECRET_KEY');
});

describe('shared email clients', () => {
  it('uses one non-secret Resend API key format guard for readiness and runtime sends', () => {
    expect(resendApiKeyLooksValid('re_live_valid')).toBe(true);
    expect(resendApiKeyLooksValid('  re_live_valid  ')).toBe(true);
    expect(resendApiKeyLooksValid('sk_live_wrong_provider')).toBe(false);
    expect(resendApiKeyLooksValid('')).toBe(false);

    process.env.FUNCTIONS_EMULATOR = 'false';
    process.env.KANDILO_FUNCTIONS_TEST_MODE = 'false';
    delete process.env.RESEND_API_KEY;

    try {
      getResend();
      throw new Error('Expected getResend to throw for missing RESEND_API_KEY.');
    } catch (error) {
      expect(resendConfigurationErrorCode(error)).toBe('resend_api_key_missing');
      expect(error).toMatchObject({ message: 'RESEND_API_KEY is not configured.' });
    }

    process.env.RESEND_API_KEY = 'sk_live_wrong_provider';

    try {
      getResend();
      throw new Error('Expected getResend to throw for invalid RESEND_API_KEY.');
    } catch (error) {
      expect(resendConfigurationErrorCode(error)).toBe('resend_api_key_invalid_format');
      expect(error).toMatchObject({ message: 'RESEND_API_KEY has invalid format.' });
    }
    expect(resendConfigurationErrorCode(new Error('plain error'))).toBeNull();
  });

  it('provides a verified Kandilo domain in Functions emulator test mode without exposing domain record details', async () => {
    process.env.FUNCTIONS_EMULATOR = 'true';
    process.env.KANDILO_FUNCTIONS_TEST_MODE = 'true';
    process.env.RESEND_API_KEY = 're_emulator_test';

    const response = await getResend().domains.list();

    expect(response.error).toBeNull();
    expect(response.data?.data).toEqual([
      expect.objectContaining({
        name: 'kandilo.org',
        status: 'verified',
      }),
    ]);
    expect(JSON.stringify(response)).not.toContain('RESEND_API_KEY');
    expect(JSON.stringify(response)).not.toContain('re_emulator_test');
  });

  it('requires tax receipt provider idempotency keys in Functions emulator test mode', async () => {
    process.env.FUNCTIONS_EMULATOR = 'true';
    process.env.KANDILO_FUNCTIONS_TEST_MODE = 'true';
    process.env.RESEND_API_KEY = 're_emulator_test';

    const taxReceiptEmail = {
      from: 'Kandilo <giving@kandilo.org>',
      to: 'member@example.com',
      subject: 'Official tax receipt',
      html: '<p>Your official tax receipt is attached.</p>',
      text: 'Your official tax receipt is attached.',
      attachments: [{
        filename: 'tax-receipt.pdf',
        content: Buffer.from('mock-pdf').toString('base64'),
      }],
    };
    const resend = getResend();

    await expect(resend.emails.send(taxReceiptEmail))
      .rejects.toThrow('Resend email emulator expected a tax receipt provider idempotency key.');
    await expect(resend.emails.send(taxReceiptEmail, {
      idempotencyKey: 'kandilo-local-tax-receipt-abcdefghijklmnopqrstuvwxyz123456',
    })).resolves.toMatchObject({
      data: { id: 'mock-resend-email-id' },
      error: null,
    });
  });

  it('uses one non-secret Stripe credential format guard for readiness and runtime clients', () => {
    expect(stripeSecretKeyMode('sk_live_valid')).toBe('live');
    expect(stripeSecretKeyMode('rk_live_valid')).toBe('live');
    expect(stripeSecretKeyMode('sk_test_valid')).toBe('test');
    expect(stripeSecretKeyMode('rk_test_valid')).toBe('test');
    expect(stripeSecretKeyMode('not_a_stripe_key')).toBe('unknown');
    expect(stripeSecretKeyMode('')).toBe('not_configured');
    expect(stripeWebhookSecretLooksValid('whsec_valid')).toBe(true);
    expect(stripeWebhookSecretLooksValid('sk_live_wrong_secret')).toBe(false);

    process.env.FUNCTIONS_EMULATOR = 'false';
    process.env.KANDILO_FUNCTIONS_TEST_MODE = 'false';
    process.env.STRIPE_SECRET_KEY = 'not_a_stripe_key';

    expect(() => getStripe()).toThrow('STRIPE_SECRET_KEY has invalid format.');
  });
});

describe('shared Stripe return URL config', () => {
  it('requires HTTPS APP_URL outside the Functions emulator', () => {
    process.env.FUNCTIONS_EMULATOR = 'false';

    expect(configuredStripeReturnAppUrl(undefined, 'https://app.kandilo.org', 'Stripe Checkout'))
      .toBe('https://app.kandilo.org');
    expect(configuredStripeReturnAppUrl(' https://app.example.com/ ', 'https://app.kandilo.org', 'Stripe Checkout'))
      .toBe('https://app.example.com');
    expect(() => configuredStripeReturnAppUrl('not a url', 'https://app.kandilo.org', 'Stripe Checkout'))
      .toThrow('Stripe Checkout requires APP_URL to be a valid URL.');
    expect(() => configuredStripeReturnAppUrl('http://app.example.com', 'https://app.kandilo.org', 'Stripe Checkout'))
      .toThrow('Stripe Checkout requires APP_URL to be an HTTPS URL.');
    expect(() => configuredStripeReturnAppUrl('https://app.example.com/?next=checkout', 'https://app.kandilo.org', 'Stripe Checkout'))
      .toThrow('Stripe Checkout requires APP_URL to be a base URL without credentials, query, or fragment.');
    expect(stripeReturnAppUrlReadiness('https://app.example.com/?next=checkout', 'https://app.kandilo.org'))
      .toMatchObject({
        configured: true,
        value: 'https://app.example.com/?next=checkout',
        usesHttps: true,
        runtimeValid: false,
        errorCode: 'app_url_not_base_url',
      });
  });

  it('allows local HTTP APP_URL only inside the Functions emulator', () => {
    process.env.FUNCTIONS_EMULATOR = 'true';

    expect(configuredStripeReturnAppUrl('http://localhost:3000/', 'https://app.kandilo.org', 'Stripe Checkout'))
      .toBe('http://localhost:3000');
    expect(configuredStripeReturnAppUrl('http://127.0.0.1:3000/', 'https://app.kandilo.org', 'Stripe Connect onboarding'))
      .toBe('http://127.0.0.1:3000');
    expect(() => configuredStripeReturnAppUrl('http://app.example.com', 'https://app.kandilo.org', 'Stripe Checkout'))
      .toThrow('Stripe Checkout requires APP_URL to be an HTTPS URL.');
    expect(stripeReturnAppUrlReadiness('http://localhost:3000/', 'https://app.kandilo.org'))
      .toMatchObject({
        configured: true,
        value: 'http://localhost:3000',
        usesHttps: false,
        runtimeValid: true,
        errorCode: '',
      });
  });
});
