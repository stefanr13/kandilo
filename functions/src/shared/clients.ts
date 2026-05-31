import { HttpsError } from 'firebase-functions/v2/https';
import { Resend } from 'resend';
import Stripe from 'stripe';
import { GoogleGenAI } from '@google/genai';
import { isFunctionsEmulatorTestMode } from './emulatorTest';

export function resendApiKeyLooksValid(apiKey: string): boolean {
  return apiKey.trim().startsWith('re_');
}

export type ResendConfigurationErrorCode =
  | 'resend_api_key_missing'
  | 'resend_api_key_invalid_format';

export class ResendConfigurationError extends Error {
  constructor(readonly code: ResendConfigurationErrorCode, message: string) {
    super(message);
    this.name = 'ResendConfigurationError';
  }
}

export function resendConfigurationErrorCode(error: unknown): ResendConfigurationErrorCode | null {
  return error instanceof ResendConfigurationError ? error.code : null;
}

export type StripeSecretKeyMode = 'live' | 'test' | 'unknown' | 'not_configured';

export function stripeSecretKeyMode(secretKey: string): StripeSecretKeyMode {
  const normalized = secretKey.trim();
  if (!normalized) {
    return 'not_configured';
  }
  if (normalized.startsWith('sk_live_') || normalized.startsWith('rk_live_')) {
    return 'live';
  }
  if (normalized.startsWith('sk_test_') || normalized.startsWith('rk_test_')) {
    return 'test';
  }
  return 'unknown';
}

export function stripeWebhookSecretLooksValid(secret: string): boolean {
  return secret.trim().startsWith('whsec_');
}

export function getResend(): Resend {
  if (isFunctionsEmulatorTestMode()) {
    return {
      emails: {
        send: async (payload: unknown, options: unknown) => {
          assertEmulatorResendEmailContract(payload, options);
          return {
            data: { id: 'mock-resend-email-id' },
            error: null,
          };
        },
      },
      batch: {
        send: async (messages: unknown[]) => ({
          data: messages.map((_, index) => ({ id: `mock-resend-batch-email-${index}` })),
          error: null,
        }),
      },
      domains: {
        list: async () => ({
          data: {
            data: [{
              id: 'domain_kandilo_mock',
              name: 'kandilo.org',
              status: 'verified',
              created_at: new Date(0).toISOString(),
              region: 'us-east-1',
            }],
          },
          error: null,
        }),
      },
    } as unknown as Resend;
  }

  const apiKey = process.env.RESEND_API_KEY?.trim() ?? '';
  if (!apiKey) {
    throw new ResendConfigurationError('resend_api_key_missing', 'RESEND_API_KEY is not configured.');
  }
  if (!resendApiKeyLooksValid(apiKey)) {
    throw new ResendConfigurationError(
      'resend_api_key_invalid_format',
      'RESEND_API_KEY has invalid format.'
    );
  }
  return new Resend(apiKey);
}

// Stripe v22 CJS uses `export = StripeConstructor` which TypeScript sees as non-newable.
// Casting to `any` at construction is the standard workaround for CJS interop.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const StripeClass = Stripe as any;
export const STRIPE_API_VERSION = '2026-04-22.dahlia';

function assertEmulatorResendEmailContract(payload: unknown, options: unknown): void {
  const message = recordFromUnknown(payload);
  const attachments = Array.isArray(message.attachments) ? message.attachments : [];
  if (attachments.length === 0) {
    return;
  }

  const requestOptions = recordFromUnknown(options);
  const idempotencyKey = typeof requestOptions.idempotencyKey === 'string'
    ? requestOptions.idempotencyKey
    : '';
  if (!/^kandilo-[A-Za-z0-9_-]{1,80}-tax-receipt-[A-Za-z0-9_-]{16,80}$/.test(idempotencyKey)) {
    throw new Error('Resend email emulator expected a tax receipt provider idempotency key.');
  }
  if (
    message.from !== 'Kandilo <giving@kandilo.org>'
    || typeof message.to !== 'string'
    || !message.to.includes('@')
    || typeof message.subject !== 'string'
    || !message.subject
    || typeof message.html !== 'string'
    || !message.html
    || typeof message.text !== 'string'
    || !message.text
  ) {
    throw new Error('Resend email emulator expected complete tax receipt email parameters.');
  }
}

function assertEmulatorCheckoutCreateContract(params: unknown, options: unknown): void {
  const session = typeof params === 'object' && params !== null && !Array.isArray(params)
    ? params as Record<string, unknown>
    : {};
  const metadata = typeof session.metadata === 'object' && session.metadata !== null && !Array.isArray(session.metadata)
    ? session.metadata as Record<string, unknown>
    : {};
  const paymentIntentData =
    typeof session.payment_intent_data === 'object'
      && session.payment_intent_data !== null
      && !Array.isArray(session.payment_intent_data)
      ? session.payment_intent_data as Record<string, unknown>
      : {};
  const paymentIntentMetadata =
    typeof paymentIntentData.metadata === 'object'
      && paymentIntentData.metadata !== null
      && !Array.isArray(paymentIntentData.metadata)
      ? paymentIntentData.metadata as Record<string, unknown>
      : {};
  const transferData =
    typeof paymentIntentData.transfer_data === 'object'
      && paymentIntentData.transfer_data !== null
      && !Array.isArray(paymentIntentData.transfer_data)
      ? paymentIntentData.transfer_data as Record<string, unknown>
      : null;
  const requestOptions = typeof options === 'object' && options !== null && !Array.isArray(options)
    ? options as Record<string, unknown>
    : {};
  const paymentMethods = Array.isArray(session.payment_method_types) ? session.payment_method_types : [];
  const givingId = typeof metadata.givingId === 'string' ? metadata.givingId : '';
  const lineItem = Array.isArray(session.line_items) && session.line_items.length === 1
    ? recordFromUnknown(session.line_items[0])
    : {};
  const priceData = recordFromUnknown(lineItem.price_data);

  if (
    session.mode !== 'payment'
    || paymentMethods.length !== 1
    || paymentMethods[0] !== 'card'
    || session.submit_type !== 'donate'
  ) {
    throw new Error('Stripe Checkout emulator expected card-only donation Checkout parameters.');
  }
  if (
    !givingId
    || paymentIntentMetadata.givingId !== givingId
    || paymentIntentMetadata.churchId !== metadata.churchId
    || paymentIntentMetadata.userId !== metadata.userId
    || paymentIntentMetadata.amountCents !== metadata.amountCents
    || paymentIntentMetadata.currency !== metadata.currency
    || requestOptions.idempotencyKey !== `checkout_${givingId}`
  ) {
    throw new Error('Stripe Checkout emulator expected copied PaymentIntent metadata and idempotency key.');
  }
  if (
    transferData
    && (typeof transferData.destination !== 'string' || !transferData.destination.startsWith('acct_'))
  ) {
    throw new Error('Stripe Checkout emulator expected a valid Connect destination account.');
  }
  if (
    lineItem.quantity !== 1
    || priceData.currency !== metadata.currency
    || priceData.unit_amount !== Number(metadata.amountCents)
  ) {
    throw new Error('Stripe Checkout emulator expected line item currency and amount to match metadata.');
  }
}

function recordFromUnknown(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export function getStripe(): ReturnType<typeof StripeClass> {
  if (isFunctionsEmulatorTestMode()) {
    return {
      checkout: {
        sessions: {
          create: async (params: unknown, options: unknown) => {
            assertEmulatorCheckoutCreateContract(params, options);
            const session = typeof params === 'object' && params !== null && !Array.isArray(params)
              ? params as Record<string, unknown>
              : {};
            const paymentIntentData =
              typeof session.payment_intent_data === 'object'
                && session.payment_intent_data !== null
                && !Array.isArray(session.payment_intent_data)
                ? session.payment_intent_data as Record<string, unknown>
                : {};
            const hasConnectDestination =
              typeof paymentIntentData.transfer_data === 'object'
              && paymentIntentData.transfer_data !== null
              && !Array.isArray(paymentIntentData.transfer_data);
            const id = hasConnectDestination ? 'cs_test_kandilo_connect_mock' : 'cs_test_kandilo_mock';
            return {
              id,
              url: `https://checkout.stripe.com/c/pay/${id}`,
              expires_at: Math.floor(Date.now() / 1000) + 30 * 60,
            };
          },
        },
      },
      v2: {
        core: {
          accounts: {
            create: async (params: unknown, options: unknown) => {
              const accountParams = recordFromUnknown(params);
              const requestOptions = recordFromUnknown(options);
              const configuration = recordFromUnknown(accountParams.configuration);
              const recipient = recordFromUnknown(configuration.recipient);
              const recipientCapabilities = recordFromUnknown(recipient.capabilities);
              const stripeBalance = recordFromUnknown(recipientCapabilities.stripe_balance);
              const stripeTransfers = recordFromUnknown(stripeBalance.stripe_transfers);
              const defaults = recordFromUnknown(accountParams.defaults);
              const defaultsProfile = recordFromUnknown(defaults.profile);
              const responsibilities = recordFromUnknown(defaults.responsibilities);
              const identity = recordFromUnknown(accountParams.identity);
              const metadata = recordFromUnknown(accountParams.metadata);
              const identityCountry = typeof identity.country === 'string' ? identity.country : '';
              const expectedCurrencyByCountry: Record<string, string> = { US: 'usd', CA: 'cad' };
              const expectedLocaleByCountry: Record<string, string> = { US: 'en-US', CA: 'en-CA' };
              const expectedCurrency = expectedCurrencyByCountry[identityCountry];
              const expectedLocale = expectedLocaleByCountry[identityCountry];
              const locales = Array.isArray(defaults.locales) ? defaults.locales : [];

              if (
                accountParams.type !== undefined
                || accountParams.business_type !== undefined
                || accountParams.controller !== undefined
                || accountParams.capabilities !== undefined
                || accountParams.dashboard !== 'express'
                || typeof accountParams.contact_email !== 'string'
                || !accountParams.contact_email.includes('@')
                || expectedCurrency === undefined
                || defaults.currency !== expectedCurrency
                || locales.length !== 1
                || locales[0] !== expectedLocale
                || defaultsProfile.product_description !== 'Charitable donations to an Orthodox parish.'
                || responsibilities.fees_collector !== 'application'
                || responsibilities.losses_collector !== 'application'
                || identity.entity_type !== 'non_profit'
                || stripeTransfers.requested !== true
                || typeof metadata.kandiloChurchId !== 'string'
                || metadata.kandiloConnectApi !== 'v2'
                || requestOptions.idempotencyKey !== `stripe_connect_account_v2_${metadata.kandiloChurchId}`
              ) {
                throw new Error('Stripe Account emulator expected Accounts v2 recipient account parameters.');
              }

              return {
                id: 'acct_KandiloCreated',
                object: 'v2.core.account',
                applied_configurations: ['recipient'],
                dashboard: 'express',
                display_name: accountParams.display_name,
                contact_email: accountParams.contact_email,
                livemode: false,
                created: new Date().toISOString(),
                metadata: accountParams.metadata,
                configuration: {
                  recipient: {
                    applied: true,
                    capabilities: {
                      stripe_balance: {
                        stripe_transfers: {
                          status: 'pending',
                          status_details: [{ code: 'requirements_past_due', resolution: 'provide_info' }],
                        },
                      },
                    },
                  },
                },
                requirements: {
                  summary: { minimum_deadline: { status: 'currently_due' } },
                },
              };
            },
            retrieve: async (accountId?: string | null) => {
              const requestedAccountId = typeof accountId === 'string' ? accountId : '';
              if (
                requestedAccountId === 'acct_KandiloV2Fail'
                || (requestedAccountId && process.env.KANDILO_MOCK_STRIPE_CONNECT_ACCOUNT_RETRIEVE_FAIL === 'true')
              ) {
                throw new Error('Mock Stripe v2 connected account retrieval failed.');
              }
              const transferStatus =
                requestedAccountId === 'acct_KandiloV2PendingTransfers'
                || process.env.KANDILO_MOCK_STRIPE_V2_TRANSFERS_ACTIVE === 'false'
                  ? 'pending'
                  : 'active';
              const payoutStatus =
                requestedAccountId === 'acct_KandiloV2PendingPayouts'
                || process.env.KANDILO_MOCK_STRIPE_V2_PAYOUTS_ACTIVE === 'false'
                  ? 'pending'
                  : 'active';
              const requirementStatus =
                requestedAccountId === 'acct_KandiloV2CurrentlyDue'
                || process.env.KANDILO_MOCK_STRIPE_V2_CURRENTLY_DUE === 'true'
                  ? 'currently_due'
                  : requestedAccountId === 'acct_KandiloV2PastDue'
                    || process.env.KANDILO_MOCK_STRIPE_V2_PAST_DUE === 'true'
                    ? 'past_due'
                    : null;

              return {
                id: requestedAccountId || 'acct_kandilo_v2_platform_mock',
                object: 'v2.core.account',
                closed: false,
                applied_configurations: ['recipient'],
                dashboard: 'express',
                livemode: false,
                created: new Date().toISOString(),
                configuration: {
                  recipient: {
                    applied: true,
                    capabilities: {
                      stripe_balance: {
                        stripe_transfers: {
                          status: transferStatus,
                          status_details: transferStatus === 'active'
                            ? []
                            : [{ code: 'requirements_past_due', resolution: 'provide_info' }],
                        },
                        payouts: {
                          status: payoutStatus,
                          status_details: payoutStatus === 'active'
                            ? []
                            : [{ code: 'requirements_past_due', resolution: 'provide_info' }],
                        },
                      },
                    },
                  },
                },
                requirements: requirementStatus
                  ? {
                    summary: { minimum_deadline: { status: requirementStatus } },
                    entries: [{
                      minimum_deadline: { status: requirementStatus },
                      impact: {
                        restricts_capabilities: [{
                          capability: 'stripe_balance.stripe_transfers',
                          configuration: 'recipient',
                          deadline: { status: requirementStatus },
                        }],
                      },
                    }],
                  }
                  : { summary: {} },
              };
            },
          },
          accountLinks: {
            create: async (params: unknown) => {
              const linkParams = recordFromUnknown(params);
              const useCase = recordFromUnknown(linkParams.use_case);
              const onboarding = recordFromUnknown(useCase.account_onboarding);
              const collectionOptions = recordFromUnknown(onboarding.collection_options);
              const configurations = Array.isArray(onboarding.configurations)
                ? onboarding.configurations
                : [];
              if (
                typeof linkParams.account !== 'string'
                || !linkParams.account.startsWith('acct_')
                || useCase.type !== 'account_onboarding'
                || configurations.length !== 1
                || configurations[0] !== 'recipient'
                || typeof onboarding.refresh_url !== 'string'
                || typeof onboarding.return_url !== 'string'
                || collectionOptions.fields !== 'eventually_due'
                || collectionOptions.future_requirements !== 'include'
              ) {
                throw new Error('Stripe Account Link emulator expected Accounts v2 onboarding parameters.');
              }
              const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
              return {
                object: 'v2.core.account_link',
                account: linkParams.account,
                created: new Date().toISOString(),
                expires_at: expiresAt,
                livemode: false,
                url: 'https://connect.stripe.com/setup/mock_kandilo_onboarding',
                use_case: {
                  type: 'account_onboarding',
                  account_onboarding: onboarding,
                },
              };
            },
          },
        },
      },
      accounts: {
        create: async (params: unknown, options: unknown) => {
          const accountParams = typeof params === 'object' && params !== null && !Array.isArray(params)
            ? params as Record<string, unknown>
            : {};
          const requestOptions = typeof options === 'object' && options !== null && !Array.isArray(options)
            ? options as Record<string, unknown>
            : {};
          const capabilities = typeof accountParams.capabilities === 'object'
            && accountParams.capabilities !== null
            && !Array.isArray(accountParams.capabilities)
            ? accountParams.capabilities as Record<string, unknown>
            : {};
          const controller = typeof accountParams.controller === 'object'
            && accountParams.controller !== null
            && !Array.isArray(accountParams.controller)
            ? accountParams.controller as Record<string, unknown>
            : {};
          const controllerFees = typeof controller.fees === 'object'
            && controller.fees !== null
            && !Array.isArray(controller.fees)
            ? controller.fees as Record<string, unknown>
            : {};
          const controllerLosses = typeof controller.losses === 'object'
            && controller.losses !== null
            && !Array.isArray(controller.losses)
            ? controller.losses as Record<string, unknown>
            : {};
          const controllerDashboard = typeof controller.stripe_dashboard === 'object'
            && controller.stripe_dashboard !== null
            && !Array.isArray(controller.stripe_dashboard)
            ? controller.stripe_dashboard as Record<string, unknown>
            : {};
          const cardPayments = typeof capabilities.card_payments === 'object'
            && capabilities.card_payments !== null
            && !Array.isArray(capabilities.card_payments)
            ? capabilities.card_payments as Record<string, unknown>
            : {};
          const transfers = typeof capabilities.transfers === 'object'
            && capabilities.transfers !== null
            && !Array.isArray(capabilities.transfers)
            ? capabilities.transfers as Record<string, unknown>
            : {};
          const metadata = typeof accountParams.metadata === 'object'
            && accountParams.metadata !== null
            && !Array.isArray(accountParams.metadata)
            ? accountParams.metadata as Record<string, unknown>
            : {};

          if (
            accountParams.type !== undefined
            || accountParams.country !== 'US'
            || accountParams.default_currency !== 'usd'
            || accountParams.business_type !== 'non_profit'
            || cardPayments.requested !== true
            || transfers.requested !== true
            || controllerFees.payer !== 'application'
            || controllerLosses.payments !== 'application'
            || controller.requirement_collection !== 'stripe'
            || controllerDashboard.type !== 'express'
            || typeof metadata.kandiloChurchId !== 'string'
            || requestOptions.idempotencyKey !== `stripe_connect_account_${metadata.kandiloChurchId}`
          ) {
            throw new Error('Stripe Account emulator expected controller-based Express account creation parameters.');
          }

          return {
            id: 'acct_KandiloCreated',
            charges_enabled: false,
            payouts_enabled: false,
            details_submitted: false,
            country: 'US',
            default_currency: 'usd',
            requirements: {
              currently_due: ['business_profile.url'],
              past_due: [],
              eventually_due: ['external_account'],
              disabled_reason: 'requirements.past_due',
            },
          };
        },
        retrieve: async (accountId?: string | null) => {
          const requestedAccountId = typeof accountId === 'string' ? accountId : '';
          if (
            requestedAccountId === 'acct_KandiloFail'
            || (requestedAccountId && process.env.KANDILO_MOCK_STRIPE_CONNECT_ACCOUNT_RETRIEVE_FAIL === 'true')
          ) {
            throw new Error('Mock Stripe connected account retrieval failed.');
          }

          return {
            id: requestedAccountId || 'acct_kandilo_platform_mock',
            charges_enabled: process.env.KANDILO_MOCK_STRIPE_ACCOUNT_CHARGES_ENABLED !== 'false',
            payouts_enabled: process.env.KANDILO_MOCK_STRIPE_ACCOUNT_PAYOUTS_ENABLED !== 'false',
            details_submitted: process.env.KANDILO_MOCK_STRIPE_ACCOUNT_DETAILS_SUBMITTED !== 'false',
            country: 'US',
            default_currency: 'usd',
            requirements: {
              currently_due: process.env.KANDILO_MOCK_STRIPE_ACCOUNT_CURRENTLY_DUE === 'true'
                ? ['business_profile.url']
                : [],
              past_due: process.env.KANDILO_MOCK_STRIPE_ACCOUNT_PAST_DUE === 'true'
                ? ['external_account']
                : [],
              eventually_due: process.env.KANDILO_MOCK_STRIPE_ACCOUNT_EVENTUALLY_DUE === 'true'
                ? ['company.tax_id']
                : [],
              disabled_reason: process.env.KANDILO_MOCK_STRIPE_ACCOUNT_DISABLED_REASON || null,
            },
            future_requirements: {
              currently_due: process.env.KANDILO_MOCK_STRIPE_ACCOUNT_FUTURE_CURRENTLY_DUE === 'true'
                ? ['company.tax_id']
                : [],
              past_due: process.env.KANDILO_MOCK_STRIPE_ACCOUNT_FUTURE_PAST_DUE === 'true'
                ? ['representative.verification.document']
                : [],
              eventually_due: process.env.KANDILO_MOCK_STRIPE_ACCOUNT_FUTURE_EVENTUALLY_DUE === 'true'
                ? ['owners.address.line1']
                : [],
              disabled_reason: null,
            },
          };
        },
      },
      accountLinks: {
        create: async (params: unknown) => {
          const linkParams = typeof params === 'object' && params !== null && !Array.isArray(params)
            ? params as Record<string, unknown>
            : {};
          if (
            typeof linkParams.account !== 'string'
            || !linkParams.account.startsWith('acct_')
            || linkParams.type !== 'account_onboarding'
            || typeof linkParams.refresh_url !== 'string'
            || typeof linkParams.return_url !== 'string'
          ) {
            throw new Error('Stripe Account Link emulator expected account onboarding parameters.');
          }
          return {
            object: 'account_link',
            created: Math.floor(Date.now() / 1000),
            expires_at: Math.floor(Date.now() / 1000) + 5 * 60,
            url: 'https://connect.stripe.com/setup/mock_kandilo_onboarding',
          };
        },
      },
      webhookEndpoints: {
        list: async () => ({
          data: [{
            id: 'we_kandilo_mock',
            object: 'webhook_endpoint',
            url: `https://us-central1-${process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT || 'kandilo-2f7a9'}.cloudfunctions.net/stripeWebhook`,
            livemode: true,
            status: 'enabled',
            api_version: STRIPE_API_VERSION,
            enabled_events: [
              'checkout.session.completed',
              'checkout.session.expired',
              'checkout.session.async_payment_failed',
              'charge.refunded',
            ],
          }],
          has_more: false,
        }),
      },
      webhooks: {
        constructEvent: (payload: Buffer | string) => {
          const text = Buffer.isBuffer(payload) ? payload.toString('utf8') : payload;
          return JSON.parse(text);
        },
      },
    } as ReturnType<typeof StripeClass>;
  }

  const secretKey = process.env.STRIPE_SECRET_KEY?.trim() ?? '';
  if (!secretKey) throw new Error('STRIPE_SECRET_KEY is not configured.');
  if (stripeSecretKeyMode(secretKey) === 'unknown') throw new Error('STRIPE_SECRET_KEY has invalid format.');
  return new StripeClass(secretKey, { apiVersion: STRIPE_API_VERSION });
}

export function getGemini(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new HttpsError('internal', 'GEMINI_API_KEY is not configured.');
  return new GoogleGenAI({ apiKey });
}

export const ALLOWED_TONES = ['formal', 'warm', 'brief'] as const;
export type GeminiTone = (typeof ALLOWED_TONES)[number];
