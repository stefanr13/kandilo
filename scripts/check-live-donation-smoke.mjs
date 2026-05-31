#!/usr/bin/env node

import { pathToFileURL } from 'node:url';
import {
  expectedProjectId,
  firestoreRestValueToJs,
  readFirebaseCliAccessTokenForAudit,
} from './audit-tax-receipt-visibility.mjs';

const firestoreRestBaseUrl = 'https://firestore.googleapis.com/v1';
const storageRestBaseUrl = 'https://storage.googleapis.com/storage/v1';
export const expectedFirebaseStorageBucket = `${expectedProjectId}.firebasestorage.app`;
const defaultLimit = 25;
const maxLimit = 100;
const defaultMaxAgeHours = 72;
const maxMaxAgeHours = 24 * 31;
const liveWebhookIssueStatuses = new Set(['validation_failed', 'missing_giving', 'unpaid_session']);
const liveWebhookIssueStatusValues = [...liveWebhookIssueStatuses];
const receiptReadyStatuses = new Set(['ready', 'issued', 'sent']);
const storedReceiptStatuses = new Set(['issued', 'sent']);
const taxReceiptEventLimit = 25;
const liveCompletedCheckoutLimit = 25;
const liveWebhookIssueLimit = 50;
const publicTaxReceiptNumberFallback = 'unassigned';
const reservedAnonymousDonorLabel = 'Anonymous donor';
const givingPrivatePaymentFields = [
  'stripeSessionId',
  'stripeCheckoutSessionId',
  'stripeCheckoutSessionExpiresAt',
  'stripeCheckoutUrl',
  'stripeCheckoutSessionUrl',
  'stripePaymentIntentId',
  'stripePaymentStatus',
  'stripePaymentMethodId',
  'stripeChargeId',
  'stripeCustomerId',
  'stripeEventId',
  'stripeConnectAccountId',
  'stripeConnectTransferId',
  'stripeTransferId',
  'stripeDestinationAccountId',
  'stripeRefundId',
  'stripeRefundedChargeId',
  'checkoutSessionId',
  'checkoutSessionExpiresAt',
  'checkoutSessionUrl',
  'checkoutUrl',
  'paymentIntentId',
  'paymentStatus',
  'paymentMethodId',
  'chargeId',
  'customerId',
  'eventId',
  'refundId',
];

/**
 * @typedef {{ id: string, data: Record<string, unknown> }} SmokeDocument
 * @typedef {{ ok: boolean, label: string, detail: string }} SmokeCheck
 * @typedef {{ write(value: string): void }} TextWriter
 * @typedef {{ name?: unknown, size?: unknown, metadata?: Record<string, unknown> }} SmokeStorageObjectMetadata
 */

const usage = `Usage:
  npm run check:live-donation-smoke
  npm run check:live-donation-smoke -- --limit 50
  npm run check:live-donation-smoke -- --require-sent-receipt

Options:
  --project <id>            Firebase project to read; must be ${expectedProjectId}.
  --limit <n>               Recent webhook events, live Checkout completions, and live issue statuses to inspect, 1-${maxLimit}; defaults to ${defaultLimit}.
  --max-age-hours <n>       Require live smoke evidence within this many hours, 1-${maxMaxAgeHours}; defaults to ${defaultMaxAgeHours}.
  --require-sent-receipt    Require the smoke donation to have an emailed official tax receipt, privacy-safe giving mirror state, retained PDF evidence, and backend email audit evidence.
  -h, --help                Show this help text.`;

function readArgValue(args, name) {
  const equalsArg = args.find((arg) => arg.startsWith(`${name}=`));
  if (equalsArg) {
    return equalsArg.slice(name.length + 1);
  }

  const index = args.indexOf(name);
  if (index >= 0 && typeof args[index + 1] === 'string') {
    return args[index + 1];
  }

  return '';
}

function parsePositiveInteger(value, fallback, field, max) {
  if (!value) return fallback;
  if (!/^\d+$/.test(value)) {
    throw new Error(`${field} must be a positive integer up to ${max}.`);
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > max) {
    throw new Error(`${field} must be a positive integer up to ${max}.`);
  }
  return parsed;
}

function validateArgs(args) {
  const valueOptions = new Set(['--project', '--limit', '--max-age-hours']);
  const flagOptions = new Set(['-h', '--help', '--require-sent-receipt']);

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg.startsWith('-')) {
      throw new Error(`Unexpected positional argument: ${arg}`);
    }

    const equalsIndex = arg.indexOf('=');
    const name = equalsIndex >= 0 ? arg.slice(0, equalsIndex) : arg;
    const inlineValue = equalsIndex >= 0 ? arg.slice(equalsIndex + 1) : null;

    if (flagOptions.has(name)) {
      if (inlineValue !== null) {
        throw new Error(`${name} does not accept a value.`);
      }
      continue;
    }

    if (valueOptions.has(name)) {
      if (inlineValue !== null) {
        if (!inlineValue) {
          throw new Error(`Missing value for ${name}.`);
        }
        continue;
      }
      const next = args[index + 1];
      if (!next || next.startsWith('-')) {
        throw new Error(`Missing value for ${name}.`);
      }
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument ${name}.`);
  }
}

export function parseArgs(args) {
  validateArgs(args);
  const projectId = readArgValue(args, '--project') || expectedProjectId;
  if (projectId !== expectedProjectId) {
    throw new Error(`--project must be ${expectedProjectId}.`);
  }
  return {
    help: args.includes('-h') || args.includes('--help'),
    projectId,
    limit: parsePositiveInteger(readArgValue(args, '--limit'), defaultLimit, '--limit', maxLimit),
    maxAgeHours: parsePositiveInteger(
      readArgValue(args, '--max-age-hours'),
      defaultMaxAgeHours,
      '--max-age-hours',
      maxMaxAgeHours
    ),
    requireSentReceipt: args.includes('--require-sent-receipt'),
  };
}

/**
 * @param {unknown} fields
 * @returns {Record<string, unknown>}
 */
function firestoreRestFieldsToData(fields) {
  const data = {};
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)) {
    return data;
  }

  for (const [key, value] of Object.entries(fields)) {
    data[key] = firestoreRestValueToJs(value);
  }
  return data;
}

/**
 * @param {unknown} document
 * @returns {SmokeDocument}
 */
function firestoreRestDocumentToSmokeDoc(document) {
  const firestoreDocument = /** @type {{ name?: unknown, fields?: unknown }} */ (document ?? {});
  const name = typeof firestoreDocument.name === 'string' ? firestoreDocument.name : '';
  const id = name.split('/').filter(Boolean).at(-1) ?? '';
  return {
    id,
    data: firestoreRestFieldsToData(firestoreDocument.fields ?? {}),
  };
}

export function firestoreRestRunQueryUrl(projectId) {
  return new URL(`${firestoreRestBaseUrl}/projects/${encodeURIComponent(projectId)}/databases/(default)/documents:runQuery`);
}

export function firestoreRestDocumentUrl(projectId, collectionName, documentId, fieldMasks = []) {
  const url = new URL(
    `${firestoreRestBaseUrl}/projects/${encodeURIComponent(projectId)}/databases/(default)/documents/${encodeURIComponent(collectionName)}/${encodeURIComponent(documentId)}`
  );
  for (const fieldPath of fieldMasks) {
    url.searchParams.append('mask.fieldPaths', fieldPath);
  }
  return url;
}

export function retainedPdfStorageObjectMetadataUrl(
  bucketName = expectedFirebaseStorageBucket,
  storagePath
) {
  if (!bucketName || typeof bucketName !== 'string') {
    throw new Error('Firebase Storage bucket is required for retained receipt PDF verification.');
  }
  if (!hasRetainedPdfStoragePath(storagePath)) {
    throw new Error('A valid retained tax receipt PDF storage path is required.');
  }

  const url = new URL(
    `${storageRestBaseUrl}/b/${encodeURIComponent(bucketName)}/o/${encodeURIComponent(storagePath.trim())}`
  );
  url.searchParams.set('fields', 'name,size,metadata');
  return url;
}

/**
 * @param {number} [limit]
 */
export function recentWebhookEventsQuery(limit = defaultLimit) {
  return {
    structuredQuery: {
      select: {
        fields: [
          { fieldPath: 'type' },
          { fieldPath: 'status' },
          { fieldPath: 'livemode' },
          { fieldPath: 'givingId' },
          { fieldPath: 'processedAt' },
        ],
      },
      from: [{ collectionId: 'stripeWebhookEvents' }],
      orderBy: [
        {
          field: { fieldPath: 'processedAt' },
          direction: 'DESCENDING',
        },
      ],
      limit,
    },
  };
}

/**
 * @param {number} [limit]
 */
export function liveCompletedCheckoutEventsQuery(limit = liveCompletedCheckoutLimit) {
  return {
    structuredQuery: {
      select: {
        fields: [
          { fieldPath: 'type' },
          { fieldPath: 'status' },
          { fieldPath: 'livemode' },
          { fieldPath: 'givingId' },
          { fieldPath: 'processedAt' },
        ],
      },
      from: [{ collectionId: 'stripeWebhookEvents' }],
      where: {
        compositeFilter: {
          op: 'AND',
          filters: [
            {
              fieldFilter: {
                field: { fieldPath: 'type' },
                op: 'EQUAL',
                value: { stringValue: 'checkout.session.completed' },
              },
            },
            {
              fieldFilter: {
                field: { fieldPath: 'status' },
                op: 'EQUAL',
                value: { stringValue: 'processed' },
              },
            },
            {
              fieldFilter: {
                field: { fieldPath: 'livemode' },
                op: 'EQUAL',
                value: { booleanValue: true },
              },
            },
          ],
        },
      },
      orderBy: [
        {
          field: { fieldPath: 'processedAt' },
          direction: 'DESCENDING',
        },
      ],
      limit,
    },
  };
}

/**
 * @param {number} [limit]
 */
export function liveWebhookIssueEventsQuery(limit = liveWebhookIssueLimit) {
  return {
    structuredQuery: {
      select: {
        fields: [
          { fieldPath: 'type' },
          { fieldPath: 'status' },
          { fieldPath: 'livemode' },
          { fieldPath: 'processedAt' },
        ],
      },
      from: [{ collectionId: 'stripeWebhookEvents' }],
      where: {
        compositeFilter: {
          op: 'AND',
          filters: [
            {
              fieldFilter: {
                field: { fieldPath: 'status' },
                op: 'IN',
                value: {
                  arrayValue: {
                    values: liveWebhookIssueStatusValues.map((status) => ({ stringValue: status })),
                  },
                },
              },
            },
            {
              fieldFilter: {
                field: { fieldPath: 'livemode' },
                op: 'EQUAL',
                value: { booleanValue: true },
              },
            },
          ],
        },
      },
      orderBy: [
        {
          field: { fieldPath: 'processedAt' },
          direction: 'DESCENDING',
        },
      ],
      limit,
    },
  };
}

export function taxReceiptEventsForReceiptQuery(receiptId) {
  return {
    structuredQuery: {
      select: {
        fields: [
          { fieldPath: 'action' },
          { fieldPath: 'receiptId' },
          { fieldPath: 'givingId' },
          { fieldPath: 'churchId' },
          { fieldPath: 'userId' },
          { fieldPath: 'kind' },
          { fieldPath: 'receiptYear' },
          { fieldPath: 'createdAt' },
        ],
      },
      from: [{ collectionId: 'taxReceiptEvents' }],
      where: {
        compositeFilter: {
          op: 'AND',
          filters: [
            {
              fieldFilter: {
                field: { fieldPath: 'receiptId' },
                op: 'EQUAL',
                value: { stringValue: receiptId },
              },
            },
            {
              fieldFilter: {
                field: { fieldPath: 'action' },
                op: 'EQUAL',
                value: { stringValue: 'email_sent' },
              },
            },
          ],
        },
      },
      orderBy: [
        {
          field: { fieldPath: 'createdAt' },
          direction: 'DESCENDING',
        },
      ],
      limit: taxReceiptEventLimit,
    },
  };
}

/**
 * @param {typeof fetch} fetchImpl
 * @param {string} accessToken
 * @param {{ projectId?: string, limit?: number }} [options]
 * @returns {Promise<SmokeDocument[]>}
 */
export async function readRecentWebhookEventsWithFirestoreRest(fetchImpl, accessToken, {
  projectId = expectedProjectId,
  limit = defaultLimit,
} = {}) {
  if (typeof fetchImpl !== 'function') {
    throw new Error('Live donation smoke check requires a Node.js runtime with fetch.');
  }

  const response = await fetchImpl(firestoreRestRunQueryUrl(projectId), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(recentWebhookEventsQuery(limit)),
  });
  if (!response.ok) {
    throw new Error(`Firestore REST webhook query failed with HTTP ${response.status}.`);
  }

  const rows = await response.json();
  if (!Array.isArray(rows)) {
    throw new Error('Firestore REST webhook query did not return an array.');
  }

  return rows
    .map((row) => row?.document)
    .filter(Boolean)
    .map(firestoreRestDocumentToSmokeDoc);
}

/**
 * @param {typeof fetch} fetchImpl
 * @param {string} accessToken
 * @param {{ projectId?: string, limit?: number }} [options]
 * @returns {Promise<SmokeDocument[]>}
 */
export async function readLiveCompletedCheckoutEventsWithFirestoreRest(fetchImpl, accessToken, {
  projectId = expectedProjectId,
  limit = liveCompletedCheckoutLimit,
} = {}) {
  if (typeof fetchImpl !== 'function') {
    throw new Error('Live donation smoke check requires a Node.js runtime with fetch.');
  }

  const response = await fetchImpl(firestoreRestRunQueryUrl(projectId), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(liveCompletedCheckoutEventsQuery(limit)),
  });
  if (!response.ok) {
    throw new Error(`Firestore REST live Checkout query failed with HTTP ${response.status}.`);
  }

  const rows = await response.json();
  if (!Array.isArray(rows)) {
    throw new Error('Firestore REST live Checkout query did not return an array.');
  }

  return rows
    .map((row) => row?.document)
    .filter(Boolean)
    .map(firestoreRestDocumentToSmokeDoc);
}

/**
 * @param {typeof fetch} fetchImpl
 * @param {string} accessToken
 * @param {{ projectId?: string, limit?: number }} [options]
 * @returns {Promise<SmokeDocument[]>}
 */
export async function readLiveWebhookIssueEventsWithFirestoreRest(fetchImpl, accessToken, {
  projectId = expectedProjectId,
  limit = liveWebhookIssueLimit,
} = {}) {
  if (typeof fetchImpl !== 'function') {
    throw new Error('Live donation smoke check requires a Node.js runtime with fetch.');
  }

  const response = await fetchImpl(firestoreRestRunQueryUrl(projectId), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(liveWebhookIssueEventsQuery(limit)),
  });
  if (!response.ok) {
    throw new Error(`Firestore REST live webhook issue query failed with HTTP ${response.status}.`);
  }

  const rows = await response.json();
  if (!Array.isArray(rows)) {
    throw new Error('Firestore REST live webhook issue query did not return an array.');
  }

  return rows
    .map((row) => row?.document)
    .filter(Boolean)
    .map(firestoreRestDocumentToSmokeDoc);
}

export async function readTaxReceiptEventsForReceiptWithFirestoreRest(fetchImpl, accessToken, {
  projectId = expectedProjectId,
  receiptId,
}) {
  if (!receiptId || !/^[A-Za-z0-9_-]{1,180}$/.test(receiptId)) {
    return [];
  }
  if (typeof fetchImpl !== 'function') {
    throw new Error('Live donation smoke check requires a Node.js runtime with fetch.');
  }

  const response = await fetchImpl(firestoreRestRunQueryUrl(projectId), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(taxReceiptEventsForReceiptQuery(receiptId)),
  });
  if (!response.ok) {
    throw new Error(`Firestore REST tax receipt event query failed with HTTP ${response.status}.`);
  }

  const rows = await response.json();
  if (!Array.isArray(rows)) {
    throw new Error('Firestore REST tax receipt event query did not return an array.');
  }

  return rows
    .map((row) => row?.document)
    .filter(Boolean)
    .map(firestoreRestDocumentToSmokeDoc);
}

/**
 * @param {typeof fetch} fetchImpl
 * @param {string} accessToken
 * @param {{ bucketName?: string, storagePath: string }} options
 * @returns {Promise<SmokeStorageObjectMetadata | null>}
 */
export async function readRetainedPdfObjectMetadataWithStorageRest(fetchImpl, accessToken, {
  bucketName = expectedFirebaseStorageBucket,
  storagePath,
}) {
  if (!hasRetainedPdfStoragePath(storagePath)) {
    return null;
  }
  if (typeof fetchImpl !== 'function') {
    throw new Error('Live donation smoke check requires a Node.js runtime with fetch.');
  }

  const response = await fetchImpl(retainedPdfStorageObjectMetadataUrl(bucketName, storagePath), {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new Error(`Firebase Storage retained receipt PDF metadata read failed with HTTP ${response.status}.`);
  }

  const objectMetadata = await response.json();
  if (!objectMetadata || typeof objectMetadata !== 'object' || Array.isArray(objectMetadata)) {
    throw new Error('Firebase Storage retained receipt PDF metadata did not return an object.');
  }
  return objectMetadata;
}

/**
 * @param {typeof fetch} fetchImpl
 * @param {string} accessToken
 * @param {{ projectId?: string, collectionName: string, documentId: string, fieldMasks?: string[] }} options
 * @returns {Promise<SmokeDocument | null>}
 */
export async function readDocumentWithFirestoreRest(fetchImpl, accessToken, {
  projectId = expectedProjectId,
  collectionName,
  documentId,
  fieldMasks = [],
}) {
  if (!documentId || !/^[A-Za-z0-9_-]{1,180}$/.test(documentId)) {
    return null;
  }

  const response = await fetchImpl(
    firestoreRestDocumentUrl(projectId, collectionName, documentId, fieldMasks),
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    }
  );
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new Error(`Firestore REST read for ${collectionName} failed with HTTP ${response.status}.`);
  }

  return firestoreRestDocumentToSmokeDoc(await response.json());
}

/**
 * @param {SmokeCheck[]} checks
 * @param {boolean} ok
 * @param {string} label
 * @param {string} [detail]
 */
function record(checks, ok, label, detail = '') {
  checks.push({ ok, label, detail });
}

function timestampEvidenceString(value) {
  if (typeof value === 'string') {
    return value.trim();
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const timestampValue = value.__firestoreTimestampValue;
    return typeof timestampValue === 'string' ? timestampValue.trim() : '';
  }
  return '';
}

function hasTimestampEvidence(value) {
  return timestampEvidenceString(value).length > 0;
}

function timestampEvidenceMillis(value) {
  const timestamp = timestampEvidenceString(value);
  if (!timestamp) return null;
  const millis = Date.parse(timestamp);
  return Number.isFinite(millis) ? millis : null;
}

function hasFreshTimestampEvidence(value, nowMillis, maxAgeHours) {
  const timestampMillis = timestampEvidenceMillis(value);
  if (timestampMillis === null || !Number.isFinite(nowMillis)) return false;
  const maxAgeMillis = maxAgeHours * 60 * 60 * 1000;
  const futureSkewMillis = 5 * 60 * 1000;
  return timestampMillis <= nowMillis + futureSkewMillis && nowMillis - timestampMillis <= maxAgeMillis;
}

function hasRetainedPdfStoragePath(value) {
  if (typeof value !== 'string') return false;
  const path = value.trim();
  return path.startsWith('taxReceipts/') && path.endsWith('.pdf');
}

function storageObjectSizeBytes(objectMetadata) {
  const size = objectMetadata?.size;
  if (typeof size === 'number' && Number.isInteger(size) && size > 0) return size;
  if (typeof size === 'string' && /^\d+$/.test(size)) {
    const parsed = Number(size);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
  }
  return null;
}

function storageObjectCustomMetadataValue(objectMetadata, key) {
  const metadata = objectMetadata?.metadata;
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return '';
  return trimmedString(metadata[key]);
}

function hasSha256Evidence(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value.trim());
}

function hasByteLengthEvidence(value) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function hasNoErrorEvidence(value) {
  return !(typeof value === 'string' && value.trim().length > 0);
}

function hasNoTimestampEvidence(value) {
  return value === undefined || value === null || value === '';
}

function trimmedString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function looksLikeEmail(value) {
  return /[^\s@]+@[^\s@]+\.[^\s@]{2,}/i.test(value.trim());
}

function normalizedCurrency(value) {
  const currency = trimmedString(value).toUpperCase();
  return /^[A-Z]{3}$/.test(currency) ? currency : '';
}

function officialReceiptNumberLooksAssigned(value) {
  const receiptNumber = trimmedString(value);
  return receiptNumber.length > 0 && receiptNumber.toLowerCase() !== publicTaxReceiptNumberFallback;
}

function hasPositiveInteger(value) {
  return Number.isInteger(value) && value > 0;
}

function givingOmitsPrivatePaymentFields(givingData) {
  if (!givingData || typeof givingData !== 'object' || Array.isArray(givingData)) {
    return false;
  }
  return givingPrivatePaymentFields.every((field) => !Object.prototype.hasOwnProperty.call(givingData, field));
}

/**
 * @param {SmokeDocument[]} events
 * @returns {SmokeDocument | null}
 */
function liveCompletedCheckoutEvent(events) {
  return events.find((event) => (
    event?.data?.type === 'checkout.session.completed'
    && event.data.status === 'processed'
    && event.data.livemode === true
    && typeof event.data.givingId === 'string'
    && event.data.givingId.length > 0
  )) ?? null;
}

/**
 * @param {{ webhookEvents?: SmokeDocument[], liveCheckoutEvents?: SmokeDocument[], liveIssueEvents?: SmokeDocument[], giving?: SmokeDocument | null, taxReceipt?: SmokeDocument | null, taxReceiptEvents?: SmokeDocument[], retainedPdfObject?: SmokeStorageObjectMetadata | null, requireSentReceipt?: boolean, nowMillis?: number, maxAgeHours?: number }} [state]
 * @returns {{ ok: boolean, checks: SmokeCheck[], inspectedWebhookCount: number, inspectedLiveCheckoutCount: number, inspectedLiveIssueCount: number, liveIssueCount: number, receiptStatus: string }}
 */
export function evaluateLiveDonationSmoke({
  webhookEvents = [],
  liveCheckoutEvents = webhookEvents,
  liveIssueEvents = webhookEvents,
  giving = null,
  taxReceipt = null,
  taxReceiptEvents = [],
  retainedPdfObject = null,
  requireSentReceipt = false,
  nowMillis = Date.now(),
  maxAgeHours = defaultMaxAgeHours,
} = {}) {
  const checks = [];
  const liveCompletedCheckout = liveCompletedCheckoutEvent(liveCheckoutEvents);
  const liveIssueCount = liveIssueEvents.filter((event) => (
    event?.data?.livemode === true
    && liveWebhookIssueStatuses.has(String(event.data.status ?? ''))
  )).length;
  const givingData = giving?.data ?? null;
  const receiptStatus = typeof givingData?.taxReceiptStatus === 'string' ? givingData.taxReceiptStatus : '';
  const givingReceiptError = givingData?.taxReceiptError;
  const givingReceiptEmailError = givingData?.taxReceiptEmailError;
  const givingTaxReceiptSentAt = givingData?.taxReceiptSentAt;
  const givingTaxReceiptNumber = trimmedString(givingData?.taxReceiptNumber);
  const givingAnonymous = givingData?.anonymous;
  const givingDonorEmail = trimmedString(givingData?.donorEmail);
  const givingDonorName = trimmedString(givingData?.donorName);
  const givingDonorNamePublicSafe = givingData?.donorNamePublicSafe;
  const givingReceiptManagerGivingSafeVersion = givingData?.receiptManagerGivingSafeVersion;
  const givingChurchReceiptVisible = givingData?.churchReceiptVisible;
  const givingExplicitlyNonAnonymous = givingAnonymous === false;
  const givingChurchId = trimmedString(givingData?.churchId);
  const givingUserId = trimmedString(givingData?.userId);
  const givingAmountCents = givingData?.amountCents;
  const givingCurrency = normalizedCurrency(givingData?.currency);
  const expectsStoredReceipt = storedReceiptStatuses.has(receiptStatus);
  const taxReceiptData = taxReceipt?.data ?? null;
  const storedReceiptKind = typeof taxReceiptData?.kind === 'string' ? taxReceiptData.kind : '';
  const storedReceiptStatus = typeof taxReceiptData?.status === 'string' ? taxReceiptData.status : '';
  const storedReceiptNumber =
    typeof taxReceiptData?.receiptNumber === 'string' ? taxReceiptData.receiptNumber.trim() : '';
  const storedReceiptGivingId = trimmedString(taxReceiptData?.givingId);
  const storedReceiptChurchId = trimmedString(taxReceiptData?.churchId);
  const storedReceiptUserId = trimmedString(taxReceiptData?.userId);
  const storedReceiptAmountCents = taxReceiptData?.amountCents;
  const storedReceiptEligibleAmountCents = taxReceiptData?.eligibleAmountCents;
  const storedReceiptCurrency = normalizedCurrency(taxReceiptData?.currency);
  const storedReceiptIssuedAt = taxReceiptData?.issuedAt;
  const storedReceiptEmailSentAt = taxReceiptData?.emailSentAt;
  const storedReceiptEmailError = taxReceiptData?.emailError;
  const storedReceiptEmailFailedAt = taxReceiptData?.emailFailedAt;
  const retainedPdfStoragePath = taxReceiptData?.pdfStoragePath;
  const retainedPdfSha256 = taxReceiptData?.pdfSha256;
  const retainedPdfByteLength = taxReceiptData?.pdfByteLength;
  const retainedPdfStatus = trimmedString(taxReceiptData?.pdfRetentionStatus);
  const retainedPdfRetainedAt = taxReceiptData?.pdfRetainedAt;
  const retainedPdfObjectPath = trimmedString(retainedPdfObject?.name);
  const retainedPdfObjectSizeBytes = storageObjectSizeBytes(retainedPdfObject);
  const retainedPdfObjectSha256 = storageObjectCustomMetadataValue(retainedPdfObject, 'pdfSha256');
  const retainedPdfObjectPurpose = storageObjectCustomMetadataValue(retainedPdfObject, 'retentionPurpose');
  const matchingEmailSentAuditEvent = taxReceiptEvents.find((event) => {
    const eventData = event?.data ?? {};
    return eventData.action === 'email_sent'
      && trimmedString(eventData.receiptId) === taxReceipt?.id
      && trimmedString(eventData.givingId) === storedReceiptGivingId
      && trimmedString(eventData.churchId) === storedReceiptChurchId
      && trimmedString(eventData.userId) === storedReceiptUserId
      && trimmedString(eventData.kind) === storedReceiptKind;
  }) ?? null;

  record(
    checks,
    webhookEvents.length > 0,
    'Recent Stripe webhook activity exists in Firestore',
    'Complete a small live Checkout donation after deploy.'
  );
  record(
    checks,
    liveCompletedCheckout !== null,
    'Recent live checkout.session.completed webhook was processed',
    'Complete a small live Checkout donation after deploy.'
  );
  record(
    checks,
    hasFreshTimestampEvidence(liveCompletedCheckout?.data?.processedAt, nowMillis, maxAgeHours),
    `Live Checkout smoke was processed within the ${maxAgeHours}-hour freshness window`,
    'Complete a new small live Checkout donation after the current deploy and rerun the smoke check.'
  );
  record(
    checks,
    liveIssueCount === 0,
    'Direct live webhook issue lookup has no validation/missing-giving/unpaid-session issues',
    liveIssueCount > 0 ? `${liveIssueCount} live issue(s) found in the direct lookup.` : ''
  );
  record(
    checks,
    givingData !== null,
    'Smoke donation giving document is readable',
    'The processed webhook must point at a giving record.'
  );
  record(
    checks,
    givingData?.status === 'completed',
    'Smoke donation giving record is completed',
    givingData ? `Current status: ${String(givingData.status ?? 'missing')}` : ''
  );
  record(
    checks,
    receiptReadyStatuses.has(receiptStatus),
    'Smoke donation reached a tax receipt-ready state',
    receiptStatus
      ? `Current receipt state: ${receiptStatus}`
      : 'Expected ready, issued, or sent.'
  );
  if (requireSentReceipt) {
    record(
      checks,
      receiptStatus === 'sent',
      'Smoke donation official tax receipt was emailed',
      receiptStatus
        ? `Current receipt state: ${receiptStatus}. Email the official tax receipt before announcing live tax receipts.`
        : 'Expected sent.'
    );
  }
  if (givingData !== null) {
    record(
      checks,
      hasNoErrorEvidence(givingReceiptError),
      'Smoke donation has no tax receipt setup error',
      'Clear lingering taxReceiptError before treating the live smoke as ready.'
    );
    record(
      checks,
      hasNoErrorEvidence(givingReceiptEmailError),
      'Smoke donation has no tax receipt email error',
      'Clear lingering taxReceiptEmailError before treating the live smoke as ready.'
    );
  }
  if (givingData !== null && receiptReadyStatuses.has(receiptStatus)) {
    record(
      checks,
      givingDonorEmail === '',
      'Smoke donation church-facing donor email is blank',
      'Expected donorEmail to be blank on the giving document used by church receipt views.'
    );
    record(
      checks,
      givingExplicitlyNonAnonymous
        ? givingChurchReceiptVisible === true
        : givingChurchReceiptVisible !== true,
      'Smoke donation church receipt visibility matches donor anonymity',
      'Expected churchReceiptVisible to be true only for explicitly non-anonymous giving.'
    );
    record(
      checks,
      givingExplicitlyNonAnonymous
        ? givingDonorNamePublicSafe === true
        : givingDonorNamePublicSafe !== true,
      'Smoke donation church-facing donor label safety marker matches donor anonymity',
      'Expected donorNamePublicSafe to be true only for explicitly non-anonymous giving.'
    );
    record(
      checks,
      givingExplicitlyNonAnonymous
        ? givingReceiptManagerGivingSafeVersion === 1
        : givingReceiptManagerGivingSafeVersion !== 1,
      'Smoke donation church-facing giving safe version matches donor anonymity',
      'Expected receiptManagerGivingSafeVersion to be 1 only for explicitly non-anonymous giving.'
    );
    record(
      checks,
      !givingDonorName || !looksLikeEmail(givingDonorName),
      'Smoke donation church-facing donor label is not an email address',
      'Expected donorName to avoid email-shaped private identity in church receipt views.'
    );
    record(
      checks,
      givingExplicitlyNonAnonymous
        ? givingDonorName.length > 0 && givingDonorName !== reservedAnonymousDonorLabel
        : true,
      'Smoke donation church-facing donor label is non-empty and not the reserved anonymous label',
      'Expected explicitly non-anonymous giving to have a safe public label, not the anonymous fallback.'
    );
    record(
      checks,
      givingOmitsPrivatePaymentFields(givingData),
      'Smoke donation church-facing giving mirror omits raw Stripe payment fields',
      'Expected Stripe session, PaymentIntent, payment-status, expiry, and charge identifiers to stay backend-only.'
    );
  }
  if (expectsStoredReceipt) {
    record(
      checks,
      taxReceiptData !== null,
      'Stored official receipt record exists when the smoke donation is issued or sent',
      'Expected a donor-only taxReceipts document for the issued/sent receipt.'
    );
    record(
      checks,
      storedReceiptKind === 'single',
      'Stored official receipt is a single-donation receipt',
      storedReceiptKind ? `Current stored receipt kind: ${storedReceiptKind}` : 'Expected single.'
    );
    record(
      checks,
      storedReceiptStatuses.has(storedReceiptStatus),
      'Stored official receipt status is issued or sent',
      storedReceiptStatus
        ? `Current stored receipt state: ${storedReceiptStatus}`
        : 'Expected issued or sent.'
    );
    record(
      checks,
      storedReceiptStatus === receiptStatus,
      'Stored official receipt status matches the giving receipt state',
      storedReceiptStatus && receiptStatus
        ? `Giving receipt state: ${receiptStatus}; stored receipt state: ${storedReceiptStatus}`
        : ''
    );
    record(
      checks,
      storedReceiptGivingId.length > 0 && storedReceiptGivingId === giving?.id,
      'Stored official receipt matches the smoke giving document',
      'Expected the donor-only receipt to reference the processed giving document.'
    );
    record(
      checks,
      givingChurchId.length > 0 && storedReceiptChurchId === givingChurchId,
      'Stored official receipt matches the smoke church',
      'Expected the donor-only receipt church to match the processed giving document.'
    );
    record(
      checks,
      givingUserId.length > 0 && storedReceiptUserId === givingUserId,
      'Stored official receipt matches the smoke donor account',
      'Expected the donor-only receipt donor account to match the processed giving document.'
    );
    record(
      checks,
      hasPositiveInteger(givingAmountCents),
      'Smoke donation giving record includes positive amount evidence',
      'Expected a positive integer amount on the processed giving document.'
    );
    record(
      checks,
      hasPositiveInteger(givingAmountCents)
        && storedReceiptAmountCents === givingAmountCents
        && storedReceiptEligibleAmountCents === givingAmountCents,
      'Stored official receipt amount matches the smoke donation',
      'Expected stored receipt amount and eligible amount to match the live smoke donation.'
    );
    record(
      checks,
      givingCurrency.length > 0 && storedReceiptCurrency === givingCurrency,
      'Stored official receipt currency matches the smoke donation',
      'Expected stored receipt currency to match the processed giving document.'
    );
    record(
      checks,
      officialReceiptNumberLooksAssigned(storedReceiptNumber),
      'Stored official receipt includes an official receipt number',
      'Expected an assigned receiptNumber on the donor-only receipt, not the public fallback.'
    );
    record(
      checks,
      officialReceiptNumberLooksAssigned(givingTaxReceiptNumber),
      'Smoke donation giving mirror includes the official receipt number',
      'Expected an assigned taxReceiptNumber on the processed giving document, not the public fallback.'
    );
    record(
      checks,
      givingTaxReceiptNumber.length > 0 && givingTaxReceiptNumber === storedReceiptNumber,
      'Smoke donation giving mirror receipt number matches the stored receipt',
      'Expected giving.taxReceiptNumber to match the donor-only receiptNumber.'
    );
    record(
      checks,
      hasTimestampEvidence(storedReceiptIssuedAt),
      'Stored official receipt includes issue timestamp evidence',
      'Expected issuedAt on the donor-only receipt.'
    );
    record(
      checks,
      hasNoErrorEvidence(storedReceiptEmailError),
      'Stored official receipt has no delivery error',
      'Clear lingering emailError on the donor-only receipt before treating the live smoke as ready.'
    );
    record(
      checks,
      hasNoTimestampEvidence(storedReceiptEmailFailedAt),
      'Stored official receipt has no failed-delivery timestamp',
      'Clear lingering emailFailedAt on the donor-only receipt before treating the live smoke as ready.'
    );
    if (receiptStatus === 'sent') {
      record(
        checks,
        hasTimestampEvidence(storedReceiptEmailSentAt),
        'Stored sent receipt includes email delivery timestamp evidence',
        'Expected emailSentAt on the donor-only receipt.'
      );
      record(
        checks,
        hasTimestampEvidence(givingTaxReceiptSentAt),
        'Smoke donation giving record includes receipt-sent timestamp evidence',
        'Expected taxReceiptSentAt on the processed giving document.'
      );
      if (requireSentReceipt) {
        record(
          checks,
          hasFreshTimestampEvidence(storedReceiptIssuedAt, nowMillis, maxAgeHours),
          `Stored official receipt issue timestamp is within the ${maxAgeHours}-hour freshness window`,
          'Issue or resend the official receipt for the current smoke donation and rerun the strict smoke check.'
        );
        record(
          checks,
          hasFreshTimestampEvidence(storedReceiptEmailSentAt, nowMillis, maxAgeHours),
          `Stored sent receipt email timestamp is within the ${maxAgeHours}-hour freshness window`,
          'Email the official receipt for the current smoke donation and rerun the strict smoke check.'
        );
        record(
          checks,
          hasFreshTimestampEvidence(givingTaxReceiptSentAt, nowMillis, maxAgeHours),
          `Smoke donation giving receipt-sent timestamp is within the ${maxAgeHours}-hour freshness window`,
          'Email the official receipt for the current smoke donation so the giving mirror is current.'
        );
      }
      record(
        checks,
        hasRetainedPdfStoragePath(retainedPdfStoragePath),
        'Stored sent receipt includes retained PDF storage metadata',
        'Expected backend-only PDF retention metadata on the donor-only receipt.'
      );
      record(
        checks,
        hasSha256Evidence(retainedPdfSha256),
        'Stored sent receipt includes retained PDF hash evidence',
        'Expected a SHA-256 hash for the retained receipt PDF.'
      );
      record(
        checks,
        hasByteLengthEvidence(retainedPdfByteLength),
        'Stored sent receipt includes retained PDF byte-length evidence',
        'Expected a positive byte length for the retained receipt PDF.'
      );
      record(
        checks,
        hasTimestampEvidence(retainedPdfRetainedAt),
        'Stored sent receipt includes retained PDF timestamp evidence',
        'Expected pdfRetainedAt on the donor-only receipt.'
      );
      record(
        checks,
        retainedPdfStatus === 'retained',
        'Stored sent receipt PDF retention status is retained',
        retainedPdfStatus
          ? `Current PDF retention state: ${retainedPdfStatus}`
          : 'Expected pdfRetentionStatus to be retained.'
      );
      if (requireSentReceipt) {
        record(
          checks,
          hasFreshTimestampEvidence(retainedPdfRetainedAt, nowMillis, maxAgeHours),
          `Stored sent receipt retained PDF timestamp is within the ${maxAgeHours}-hour freshness window`,
          'Retain a fresh official PDF copy for the current smoke receipt and rerun the strict smoke check.'
        );
        record(
          checks,
          retainedPdfObject !== null,
          'Retained official receipt PDF object exists in Firebase Storage',
          'Expected the backend-only retained PDF object to exist in the production Storage bucket.'
        );
        record(
          checks,
          retainedPdfObjectPath.length > 0 && retainedPdfObjectPath === retainedPdfStoragePath,
          'Retained official receipt PDF object matches stored path metadata',
          'Expected the retained PDF object name to match the donor-only receipt metadata.'
        );
        record(
          checks,
          retainedPdfObjectSizeBytes !== null && retainedPdfObjectSizeBytes === retainedPdfByteLength,
          'Retained official receipt PDF object byte length matches stored metadata',
          'Expected the retained PDF object size to match the donor-only receipt metadata.'
        );
        record(
          checks,
          retainedPdfObjectSha256.length > 0 && retainedPdfObjectSha256 === retainedPdfSha256,
          'Retained official receipt PDF object hash metadata matches stored metadata',
          'Expected the retained PDF object SHA-256 metadata to match the donor-only receipt metadata.'
        );
        record(
          checks,
          retainedPdfObjectPurpose === 'official_tax_receipt_copy',
          'Retained official receipt PDF object is marked as an official receipt copy',
          'Expected the retained PDF object to carry official tax receipt retention metadata.'
        );
        record(
          checks,
          matchingEmailSentAuditEvent !== null,
          'Stored sent receipt has backend email-sent audit evidence',
          'Expected a backend-only taxReceiptEvents email_sent record for the smoke receipt.'
        );
        record(
          checks,
          hasTimestampEvidence(matchingEmailSentAuditEvent?.data?.createdAt),
          'Stored sent receipt email audit has timestamp evidence',
          'Expected createdAt on the backend-only taxReceiptEvents email_sent record.'
        );
        record(
          checks,
          hasFreshTimestampEvidence(matchingEmailSentAuditEvent?.data?.createdAt, nowMillis, maxAgeHours),
          `Stored sent receipt email audit is within the ${maxAgeHours}-hour freshness window`,
          'Email the official receipt for the current smoke donation and rerun the strict smoke check.'
        );
      }
    }
  }

  return {
    ok: checks.every((check) => check.ok),
    checks,
    inspectedWebhookCount: webhookEvents.length,
    inspectedLiveCheckoutCount: liveCheckoutEvents.length,
    inspectedLiveIssueCount: liveIssueEvents.length,
    liveIssueCount,
    receiptStatus,
  };
}

/**
 * @param {SmokeCheck[]} checks
 * @param {TextWriter} stdout
 */
function printChecks(checks, stdout) {
  let failures = 0;
  for (const check of checks) {
    if (check.ok) {
      stdout.write(`OK   ${check.label}\n`);
      continue;
    }
    failures += 1;
    stdout.write(`FAIL ${check.label}${check.detail ? ` - ${check.detail}` : ''}\n`);
  }
  return failures;
}

/**
 * @param {{ accessToken: string, fetchImpl?: typeof fetch, projectId?: string, limit?: number, requireSentReceipt?: boolean }} options
 * @returns {Promise<{ webhookEvents: SmokeDocument[], liveCheckoutEvents: SmokeDocument[], liveIssueEvents: SmokeDocument[], giving: SmokeDocument | null, taxReceipt: SmokeDocument | null, taxReceiptEvents: SmokeDocument[], retainedPdfObject: SmokeStorageObjectMetadata | null }>}
 */
export async function loadLiveDonationSmokeState({
  accessToken,
  fetchImpl = globalThis.fetch,
  projectId = expectedProjectId,
  limit = defaultLimit,
  requireSentReceipt = false,
}) {
  const webhookEvents = await readRecentWebhookEventsWithFirestoreRest(fetchImpl, accessToken, { projectId, limit });
  const liveCheckoutEvents = await readLiveCompletedCheckoutEventsWithFirestoreRest(fetchImpl, accessToken, {
    projectId,
    limit,
  });
  const liveIssueEvents = await readLiveWebhookIssueEventsWithFirestoreRest(fetchImpl, accessToken, {
    projectId,
    limit,
  });
  const candidate = liveCompletedCheckoutEvent(liveCheckoutEvents);
  const givingId = typeof candidate?.data?.givingId === 'string' ? candidate.data.givingId : '';
  const giving = givingId
    ? await readDocumentWithFirestoreRest(fetchImpl, accessToken, {
      projectId,
      collectionName: 'giving',
      documentId: givingId,
      fieldMasks: [
        'status',
        'taxReceiptStatus',
        'taxReceiptId',
        'taxReceiptNumber',
        'taxReceiptError',
        'taxReceiptEmailError',
        'taxReceiptSentAt',
        'anonymous',
        'donorEmail',
        'donorName',
        'donorNamePublicSafe',
        'receiptManagerGivingSafeVersion',
        'churchReceiptVisible',
        'churchId',
        'userId',
        'amountCents',
        'currency',
        ...givingPrivatePaymentFields,
      ],
    })
    : null;
  const receiptId = typeof giving?.data?.taxReceiptId === 'string' && giving.data.taxReceiptId
    ? giving.data.taxReceiptId
    : givingId;
  const receiptStatus = typeof giving?.data?.taxReceiptStatus === 'string' ? giving.data.taxReceiptStatus : '';
  const taxReceipt = storedReceiptStatuses.has(receiptStatus) && receiptId
    ? await readDocumentWithFirestoreRest(fetchImpl, accessToken, {
      projectId,
      collectionName: 'taxReceipts',
      documentId: receiptId,
      fieldMasks: [
        'kind',
        'status',
        'givingId',
        'churchId',
        'userId',
        'amountCents',
        'eligibleAmountCents',
        'currency',
        'receiptNumber',
        'issuedAt',
        'emailSentAt',
        'pdfStoragePath',
        'pdfSha256',
        'pdfByteLength',
        'pdfRetentionStatus',
        'pdfRetainedAt',
        'emailError',
        'emailFailedAt',
      ],
    })
    : null;
  const taxReceiptEvents = requireSentReceipt && receiptStatus === 'sent' && receiptId
    ? await readTaxReceiptEventsForReceiptWithFirestoreRest(fetchImpl, accessToken, {
      projectId,
      receiptId,
    })
    : [];
  const retainedPdfStoragePath = typeof taxReceipt?.data?.pdfStoragePath === 'string'
    ? taxReceipt.data.pdfStoragePath
    : '';
  const retainedPdfObject = requireSentReceipt
    && receiptStatus === 'sent'
    && hasRetainedPdfStoragePath(retainedPdfStoragePath)
    ? await readRetainedPdfObjectMetadataWithStorageRest(fetchImpl, accessToken, {
      storagePath: retainedPdfStoragePath,
    })
    : null;

  return {
    webhookEvents,
    liveCheckoutEvents,
    liveIssueEvents,
    giving,
    taxReceipt,
    taxReceiptEvents,
    retainedPdfObject,
  };
}

/**
 * @param {string[]} [args]
 * @param {{ accessTokenReader?: () => string, fetchImpl?: typeof fetch, stdout?: TextWriter, stderr?: TextWriter }} [deps]
 */
export async function main(args = process.argv.slice(2), {
  accessTokenReader = readFirebaseCliAccessTokenForAudit,
  fetchImpl = globalThis.fetch,
  stdout = process.stdout,
  stderr = process.stderr,
} = {}) {
  try {
    const options = parseArgs(args);
    if (options.help) {
      stdout.write(`${usage}\n`);
      return 0;
    }

    stdout.write('Kandilo live donation smoke check\n\n');
    stdout.write(`Project: ${options.projectId}\n`);
    stdout.write(`Recent webhook event limit: ${options.limit}\n`);
    stdout.write(`Smoke freshness window: ${options.maxAgeHours} hours\n`);
    stdout.write(`Require sent tax receipt: ${options.requireSentReceipt ? 'yes' : 'no'}\n\n`);

    const accessToken = accessTokenReader();
    const state = await loadLiveDonationSmokeState({
      accessToken,
      fetchImpl,
      projectId: options.projectId,
      limit: options.limit,
      requireSentReceipt: options.requireSentReceipt,
    });
    const result = evaluateLiveDonationSmoke({
      ...state,
      requireSentReceipt: options.requireSentReceipt,
      maxAgeHours: options.maxAgeHours,
    });
    const failures = printChecks(result.checks, stdout);
    stdout.write(`\nInspected recent webhook events: ${result.inspectedWebhookCount}\n`);
    stdout.write(`Inspected live completed Checkout events: ${result.inspectedLiveCheckoutCount}\n`);
    stdout.write(`Inspected live webhook issue events: ${result.inspectedLiveIssueCount}\n`);
    stdout.write(`Direct live webhook issue count: ${result.liveIssueCount}\n`);
    stdout.write(`Smoke receipt state: ${result.receiptStatus || 'missing'}\n\n`);

    if (failures > 0) {
      stdout.write(`Result: ${failures} failure(s). Complete and verify a small live donation before announcing tax receipts.\n`);
      return 1;
    }
    stdout.write('Result: live donation smoke check passed without exposing donor, church, giving, receipt, Stripe event, tax receipt event, payment, PDF metadata, amount, currency, or access-token values.\n');
    return 0;
  } catch (error) {
    stderr.write(`${error instanceof Error ? error.message : String(error)}\n\n${usage}\n`);
    return 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  process.exitCode = await main();
}
