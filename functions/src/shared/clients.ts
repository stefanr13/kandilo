import { HttpsError } from 'firebase-functions/v2/https';
import { Resend } from 'resend';
import Stripe from 'stripe';
import { GoogleGenAI } from '@google/genai';
import { isFunctionsEmulatorTestMode } from './emulatorTest';

export function getResend(): Resend {
  if (isFunctionsEmulatorTestMode()) {
    return {
      emails: {
        send: async () => ({
          data: { id: 'mock-resend-email-id' },
          error: null,
        }),
      },
      batch: {
        send: async (messages: unknown[]) => ({
          data: messages.map((_, index) => ({ id: `mock-resend-batch-email-${index}` })),
          error: null,
        }),
      },
    } as unknown as Resend;
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error('RESEND_API_KEY is not configured.');
  return new Resend(apiKey);
}

// Stripe v22 CJS uses `export = StripeConstructor` which TypeScript sees as non-newable.
// Casting to `any` at construction is the standard workaround for CJS interop.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const StripeClass = Stripe as any;

export function getStripe(): ReturnType<typeof StripeClass> {
  if (isFunctionsEmulatorTestMode()) {
    return {
      checkout: {
        sessions: {
          create: async () => ({
            id: 'cs_test_kandilo_mock',
            url: 'https://checkout.stripe.com/c/pay/cs_test_kandilo_mock',
            expires_at: Math.floor(Date.now() / 1000) + 30 * 60,
          }),
        },
      },
      webhooks: {
        constructEvent: (payload: Buffer | string) => {
          const text = Buffer.isBuffer(payload) ? payload.toString('utf8') : payload;
          return JSON.parse(text);
        },
      },
    } as ReturnType<typeof StripeClass>;
  }

  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) throw new Error('STRIPE_SECRET_KEY is not configured.');
  return new StripeClass(secretKey, { apiVersion: '2025-03-31.basil' });
}

export function getGemini(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new HttpsError('internal', 'GEMINI_API_KEY is not configured.');
  return new GoogleGenAI({ apiKey });
}

export const ALLOWED_TONES = ['formal', 'warm', 'brief'] as const;
export type GeminiTone = (typeof ALLOWED_TONES)[number];
