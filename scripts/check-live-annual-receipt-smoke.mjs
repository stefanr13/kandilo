#!/usr/bin/env node

import { pathToFileURL } from 'node:url';
import {
  expectedProjectId,
  firestoreRestValueToJs,
  readFirebaseCliAccessTokenForAudit,
} from './audit-tax-receipt-visibility.mjs';
import {
  expectedFirebaseStorageBucket,
  firestoreRestRunQueryUrl,
  readDocumentWithFirestoreRest,
  readRetainedPdfObjectMetadataWithStorageRest,
  readTaxReceiptEventsForReceiptWithFirestoreRest,
} from './check-live-donation-smoke.mjs';

const defaultLimit = 50;
const maxLimit = 100;
const defaultMaxAgeHours = 72;
const maxMaxAgeHours = 24 * 31;
const defaultMinContributions = 2;
const minMinContributions = 2;
const maxMinContributions = 100;
const annualReceiptIdPattern = /^annual_[A-Za-z0-9_-]{1,170}$/;
const publicTaxReceiptNumberFallback = 'unassigned';
const reservedAnonymousDonorLabel = 'Anonymous donor';
const receiptManagerSummarySafeVersion = 2;
const annualSummaryPrivateFields = [
  'givingId',
  'givingIds',
  'donorEmail',
  'donorName',
  'donorAddress',
  'donorLegalName',
  'donorMailingAddress',
  'taxReceiptLegalName',
  'taxReceiptAddress',
  'legalName',
  'mailingAddress',
  'address',
  'email',
  'memberEmail',
  'receiptEmail',
  'organizationName',
  'organizationAddress',
  'organizationTaxId',
  'purpose',
  'contributions',
  'coveredPeriodLabel',
  'duplicateClaimWarning',
  'issuedBy',
  'emailSendingAt',
  'emailSendAttemptId',
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
  'stripeRefundStatus',
  'stripeRefundedChargeId',
  'stripeAmountRefundedCents',
  'stripeRefundedAt',
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
  'refundStatus',
  'amountRefundedCents',
  'receivedAt',
  'receivedDateLabel',
  'goodsServicesStatement',
  'pdfTemplateVersion',
  'pdfStoragePath',
  'pdfSha256',
  'pdfByteLength',
  'pdfRetainedAt',
  'pdfRetentionStatus',
  'receiptIssueLocation',
  'authorizedSignerName',
  'authorizedSignerTitle',
  'secureElectronicSignatureConfigured',
  'receiptCopiesRetentionConfirmed',
  'partialRefundGivingIds',
  'originalAmountCents',
  'refundedAmountCents',
  'correctionForGivingId',
  'correctionForReceiptId',
  'correctionSourceReason',
  'correctedAt',
  'correctedBy',
  'correctionMarkedAt',
  'correctionMarkedBy',
  'voidedBy',
];

/**
 * @typedef {{ id: string, data: Record<string, unknown> }} AnnualSmokeDocument
 * @typedef {{ ok: boolean, label: string, detail: string }} AnnualSmokeCheck
 * @typedef {{ write(value: string): void }} TextWriter
 * @typedef {{ name?: unknown, size?: unknown, metadata?: Record<string, unknown> }} AnnualSmokeStorageObjectMetadata
 */

const usage = `Usage:
  npm run check:live-annual-receipt-smoke
  npm run check:live-annual-receipt-smoke -- --receipt-id annual_...
  npm run check:live-annual-receipt-smoke -- --min-contributions 3

Options:
  --project <id>              Firebase project to read; must be ${expectedProjectId}.
  --limit <n>                 Recent receipt email events to inspect, 1-${maxLimit}; defaults to ${defaultLimit}.
  --max-age-hours <n>         Require annual receipt smoke evidence within this many hours, 1-${maxMaxAgeHours}; defaults to ${defaultMaxAgeHours}.
  --min-contributions <n>     Minimum annual contribution count to prove, ${minMinContributions}-${maxMinContributions}; defaults to ${defaultMinContributions}.
  --receipt-id <annual_id>    Validate a specific annual receipt instead of scanning recent annual email smoke events.
  -h, --help                  Show this help text.`;

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

function parseIntegerAtLeast(value, fallback, field, min, max) {
  if (!value) return fallback;
  if (!/^\d+$/.test(value)) {
    throw new Error(`${field} must be an integer from ${min} to ${max}.`);
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${field} must be an integer from ${min} to ${max}.`);
  }
  return parsed;
}

function validateArgs(args) {
  const valueOptions = new Set(['--project', '--limit', '--max-age-hours', '--min-contributions', '--receipt-id']);
  const flagOptions = new Set(['-h', '--help']);

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
  const receiptId = readArgValue(args, '--receipt-id').trim();
  if (receiptId && !annualReceiptIdPattern.test(receiptId)) {
    throw new Error('--receipt-id must be an annual tax receipt document id starting with annual_.');
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
    minContributions: parseIntegerAtLeast(
      readArgValue(args, '--min-contributions'),
      defaultMinContributions,
      '--min-contributions',
      minMinContributions,
      maxMinContributions
    ),
    receiptId,
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
 * @returns {AnnualSmokeDocument}
 */
function firestoreRestDocumentToAnnualSmokeDoc(document) {
  const firestoreDocument = /** @type {{ name?: unknown, fields?: unknown }} */ (document ?? {});
  const name = typeof firestoreDocument.name === 'string' ? firestoreDocument.name : '';
  const id = name.split('/').filter(Boolean).at(-1) ?? '';
  return {
    id,
    data: firestoreRestFieldsToData(firestoreDocument.fields ?? {}),
  };
}

/**
 * @param {number} [limit]
 */
export function recentAnnualEmailSentEventsQuery(limit = defaultLimit) {
  return {
    structuredQuery: {
      select: {
        fields: [
          { fieldPath: 'action' },
          { fieldPath: 'receiptId' },
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
                field: { fieldPath: 'action' },
                op: 'EQUAL',
                value: { stringValue: 'email_sent' },
              },
            },
            {
              fieldFilter: {
                field: { fieldPath: 'kind' },
                op: 'EQUAL',
                value: { stringValue: 'annual' },
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
      limit,
    },
  };
}

/**
 * @param {typeof fetch} fetchImpl
 * @param {string} accessToken
 * @param {{ projectId?: string, limit?: number }} [options]
 * @returns {Promise<AnnualSmokeDocument[]>}
 */
export async function readRecentAnnualEmailSentEventsWithFirestoreRest(fetchImpl, accessToken, {
  projectId = expectedProjectId,
  limit = defaultLimit,
} = {}) {
  if (typeof fetchImpl !== 'function') {
    throw new Error('Live annual receipt smoke check requires a Node.js runtime with fetch.');
  }

  const response = await fetchImpl(firestoreRestRunQueryUrl(projectId), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(recentAnnualEmailSentEventsQuery(limit)),
  });
  if (!response.ok) {
    throw new Error(`Firestore REST annual receipt email query failed with HTTP ${response.status}.`);
  }

  const rows = await response.json();
  if (!Array.isArray(rows)) {
    throw new Error('Firestore REST annual receipt email query did not return an array.');
  }

  return rows
    .map((row) => row?.document)
    .filter(Boolean)
    .map(firestoreRestDocumentToAnnualSmokeDoc);
}

function trimmedString(value) {
  return typeof value === 'string' ? value.trim() : '';
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

function sameTimestampEvidence(left, right) {
  const leftMillis = timestampEvidenceMillis(left);
  const rightMillis = timestampEvidenceMillis(right);
  return leftMillis !== null && rightMillis !== null && leftMillis === rightMillis;
}

function hasNoErrorEvidence(value) {
  return !(typeof value === 'string' && value.trim().length > 0);
}

function hasNoTimestampEvidence(value) {
  return value === undefined || value === null || value === '';
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

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function looksLikeEmail(value) {
  return /[^\s@]+@[^\s@]+\.[^\s@]{2,}/i.test(value.trim());
}

function receiptYear(value) {
  return Number.isInteger(value) && value >= 2000 && value <= 2100 ? value : null;
}

function stringArray(value) {
  return Array.isArray(value) ? value.filter((entry) => typeof entry === 'string') : [];
}

function hasValidAnnualGivingCoverage(givingIds, donationCount, minContributions) {
  const uniqueGivingIds = new Set(givingIds);
  return Number.isInteger(donationCount)
    && donationCount >= minContributions
    && givingIds.length === donationCount
    && uniqueGivingIds.size === givingIds.length
    && givingIds.every((givingId) => /^[A-Za-z0-9_-]{1,180}$/.test(givingId));
}

function hasValidAnnualContributionDetail(receiptData, minContributions) {
  if (!isPlainObject(receiptData)) return false;
  const contributions = Array.isArray(receiptData.contributions) ? receiptData.contributions : [];
  const currency = normalizedCurrency(receiptData.currency);
  const donationCount = receiptData.donationCount;
  const amountCents = receiptData.amountCents;
  const eligibleAmountCents = receiptData.eligibleAmountCents;

  if (
    !currency
    || !Number.isInteger(donationCount)
    || donationCount < minContributions
    || contributions.length !== donationCount
    || !hasPositiveInteger(amountCents)
    || !hasPositiveInteger(eligibleAmountCents)
  ) {
    return false;
  }

  let amountTotalCents = 0;
  let eligibleTotalCents = 0;
  for (const contribution of contributions) {
    if (!isPlainObject(contribution)) return false;
    const dateLabel = trimmedString(contribution.dateLabel);
    const purpose = trimmedString(contribution.purpose);
    const contributionAmountCents = contribution.amountCents;
    const contributionEligibleAmountCents = contribution.eligibleAmountCents;
    const contributionCurrency = normalizedCurrency(contribution.currency);
    if (
      !dateLabel
      || !purpose
      || !hasPositiveInteger(contributionAmountCents)
      || !hasPositiveInteger(contributionEligibleAmountCents)
      || contributionEligibleAmountCents > contributionAmountCents
      || contributionCurrency !== currency
    ) {
      return false;
    }
    amountTotalCents += contributionAmountCents;
    eligibleTotalCents += contributionEligibleAmountCents;
  }

  return amountTotalCents === amountCents && eligibleTotalCents === eligibleAmountCents;
}

function hasRetainedPdfStoragePath(value) {
  if (typeof value !== 'string') return false;
  const path = value.trim();
  return path.startsWith('taxReceipts/') && path.endsWith('.pdf');
}

function hasSha256Evidence(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value.trim());
}

function hasByteLengthEvidence(value) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
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

function annualEmailEventMatchesReceipt(event, receiptId, receiptData) {
  const eventData = event?.data ?? {};
  return eventData.action === 'email_sent'
    && trimmedString(eventData.receiptId) === receiptId
    && trimmedString(eventData.churchId) === trimmedString(receiptData?.churchId)
    && trimmedString(eventData.userId) === trimmedString(receiptData?.userId)
    && trimmedString(eventData.kind) === 'annual';
}

function annualEmailEventCandidate(events, receiptId = '') {
  return events.find((event) => {
    const eventReceiptId = trimmedString(event?.data?.receiptId);
    return event?.data?.action === 'email_sent'
      && event?.data?.kind === 'annual'
      && annualReceiptIdPattern.test(eventReceiptId)
      && (!receiptId || eventReceiptId === receiptId);
  }) ?? null;
}

function annualEmailEventCandidates(events, receiptId = '') {
  return events.filter((event) => {
    const eventReceiptId = trimmedString(event?.data?.receiptId);
    return event?.data?.action === 'email_sent'
      && event?.data?.kind === 'annual'
      && annualReceiptIdPattern.test(eventReceiptId)
      && (!receiptId || eventReceiptId === receiptId);
  });
}

function annualReceiptHasCorrectionOrReissueEvidence(receiptId, receiptData, summaryData) {
  return receiptId.startsWith('annual_correction_')
    || trimmedString(receiptData?.correctionForReceiptId).length > 0
    || trimmedString(receiptData?.correctionSourceReason).length > 0
    || hasTimestampEvidence(receiptData?.correctedAt)
    || summaryData?.correctedReceipt === true;
}

/**
 * @param {AnnualSmokeCheck[]} checks
 * @param {boolean} ok
 * @param {string} label
 * @param {string} [detail]
 */
function record(checks, ok, label, detail = '') {
  checks.push({ ok, label, detail });
}

/**
 * @param {{ annualEmailEvents?: AnnualSmokeDocument[], annualEmailEvent?: AnnualSmokeDocument | null, taxReceipt?: AnnualSmokeDocument | null, taxReceiptSummary?: AnnualSmokeDocument | null, retainedPdfObject?: AnnualSmokeStorageObjectMetadata | null, nowMillis?: number, maxAgeHours?: number, minContributions?: number }} [state]
 * @returns {{ ok: boolean, checks: AnnualSmokeCheck[], inspectedAnnualEmailEventCount: number, receiptStatus: string, summaryVisibility: string }}
 */
export function evaluateLiveAnnualReceiptSmoke({
  annualEmailEvents = [],
  annualEmailEvent = null,
  taxReceipt = null,
  taxReceiptSummary = null,
  retainedPdfObject = null,
  nowMillis = Date.now(),
  maxAgeHours = defaultMaxAgeHours,
  minContributions = defaultMinContributions,
} = {}) {
  const checks = [];
  const selectedEvent = annualEmailEvent ?? annualEmailEventCandidate(annualEmailEvents);
  const receiptId = trimmedString(selectedEvent?.data?.receiptId) || trimmedString(taxReceipt?.id);
  const receiptData = taxReceipt?.data ?? null;
  const summaryData = taxReceiptSummary?.data ?? null;
  const receiptStatus = trimmedString(receiptData?.status);
  const receiptKind = trimmedString(receiptData?.kind);
  const receiptNumber = trimmedString(receiptData?.receiptNumber);
  const receiptChurchId = trimmedString(receiptData?.churchId);
  const receiptUserId = trimmedString(receiptData?.userId);
  const annualYear = receiptYear(receiptData?.receiptYear) ?? receiptYear(receiptData?.annualYear);
  const amountCents = receiptData?.amountCents;
  const eligibleAmountCents = receiptData?.eligibleAmountCents;
  const currency = normalizedCurrency(receiptData?.currency);
  const donationCount = receiptData?.donationCount;
  const givingIds = stringArray(receiptData?.givingIds);
  const retainedPdfStoragePath = receiptData?.pdfStoragePath;
  const retainedPdfSha256 = receiptData?.pdfSha256;
  const retainedPdfByteLength = receiptData?.pdfByteLength;
  const retainedPdfStatus = trimmedString(receiptData?.pdfRetentionStatus);
  const retainedPdfRetainedAt = receiptData?.pdfRetainedAt;
  const retainedPdfObjectPath = trimmedString(retainedPdfObject?.name);
  const retainedPdfObjectSizeBytes = storageObjectSizeBytes(retainedPdfObject);
  const retainedPdfObjectSha256 = storageObjectCustomMetadataValue(retainedPdfObject, 'pdfSha256');
  const retainedPdfObjectPurpose = storageObjectCustomMetadataValue(retainedPdfObject, 'retentionPurpose');
  const summaryReceiptId = trimmedString(summaryData?.receiptId);
  const summaryReceiptNumber = trimmedString(summaryData?.receiptNumber);
  const summaryStatus = trimmedString(summaryData?.status);
  const summaryKind = trimmedString(summaryData?.kind);
  const summaryChurchId = trimmedString(summaryData?.churchId);
  const summaryUserId = trimmedString(summaryData?.userId);
  const summaryAnnualYear = receiptYear(summaryData?.receiptYear) ?? receiptYear(summaryData?.annualYear);
  const summaryDonorLabel = trimmedString(summaryData?.donorLabel);
  const annualReceiptCorrectionOrReissue = annualReceiptHasCorrectionOrReissueEvidence(
    receiptId,
    receiptData,
    summaryData
  );
  const summaryPrivateFieldLeakCount = annualSummaryPrivateFields.filter((field) =>
    Object.prototype.hasOwnProperty.call(summaryData ?? {}, field)
  ).length;

  record(
    checks,
    annualEmailEvents.length > 0 || selectedEvent !== null,
    'Recent annual receipt email audit activity exists in Firestore',
    'Send a non-anonymous annual tax receipt after deploy and rerun the annual smoke check.'
  );
  record(
    checks,
    selectedEvent !== null,
    'Recent annual receipt email audit event was found',
    'Expected a taxReceiptEvents email_sent record whose kind is annual.'
  );
  record(
    checks,
    hasFreshTimestampEvidence(selectedEvent?.data?.createdAt, nowMillis, maxAgeHours),
    `Annual receipt email audit is within the ${maxAgeHours}-hour freshness window`,
    'Send a fresh annual tax receipt and rerun the annual smoke check.'
  );
  record(
    checks,
    receiptId.length > 0 && annualReceiptIdPattern.test(receiptId),
    'Annual receipt smoke uses an annual receipt document id',
    'Expected an annual_ receipt id from the backend audit event.'
  );
  record(
    checks,
    receiptData !== null,
    'Stored donor-only annual receipt record is readable',
    'Expected a donor-only taxReceipts document for the annual receipt.'
  );
  if (receiptData !== null) {
    record(checks, receiptKind === 'annual', 'Stored receipt is an annual receipt', 'Expected kind annual.');
    record(checks, receiptStatus === 'sent', 'Stored annual receipt status is sent', 'Expected sent.');
    record(
      checks,
      !annualReceiptCorrectionOrReissue,
      'Stored annual receipt is an original year-end receipt',
      'Use the standard annual receipt smoke, not a corrected or refund-reissue annual receipt, before announcing year-end receipts.'
    );
    record(
      checks,
      receiptData.correctionRequired !== true,
      'Stored annual receipt is not marked correction-required',
      'Resolve review-required annual receipt state before treating annual receipts as live-ready.'
    );
    record(
      checks,
      hasNoTimestampEvidence(receiptData.voidedAt) && receiptStatus !== 'voided',
      'Stored annual receipt is not voided',
      'Use a current, non-voided annual receipt for the annual smoke.'
    );
    record(
      checks,
      hasNoErrorEvidence(receiptData.emailError),
      'Stored annual receipt has no delivery error',
      'Clear lingering emailError on the donor-only annual receipt before treating the annual smoke as ready.'
    );
    record(
      checks,
      hasNoTimestampEvidence(receiptData.emailFailedAt),
      'Stored annual receipt has no failed-delivery timestamp',
      'Clear lingering emailFailedAt on the donor-only annual receipt before treating the annual smoke as ready.'
    );
    record(
      checks,
      annualEmailEventMatchesReceipt(selectedEvent, taxReceipt?.id ?? receiptId, receiptData),
      'Annual email audit event matches the stored annual receipt',
      'Expected receipt, church, donor account, and annual kind evidence to match.'
    );
    record(
      checks,
      officialReceiptNumberLooksAssigned(receiptNumber),
      'Stored annual receipt includes an official receipt number',
      'Expected an assigned receiptNumber on the donor-only annual receipt, not the public fallback.'
    );
    record(
      checks,
      hasPositiveInteger(amountCents) && hasPositiveInteger(eligibleAmountCents),
      'Stored annual receipt includes positive amount evidence',
      'Expected positive stored annual amount and eligible amount evidence.'
    );
    record(
      checks,
      currency.length > 0,
      'Stored annual receipt includes explicit supported currency evidence',
      'Expected a three-letter annual receipt currency.'
    );
    record(
      checks,
      typeof annualYear === 'number',
      'Stored annual receipt includes receipt-year evidence',
      'Expected annualYear or receiptYear on the donor-only annual receipt.'
    );
    record(
      checks,
      hasValidAnnualGivingCoverage(givingIds, donationCount, minContributions),
      `Stored annual receipt covers at least ${minContributions} contribution(s) with exact giving evidence`,
      'Create a closed-year annual receipt that covers the expected number of donation records.'
    );
    record(
      checks,
      hasValidAnnualContributionDetail(receiptData, minContributions),
      'Stored annual receipt has itemized contribution lines matching the receipt totals',
      'Expected donor-only annual receipt contributions with date, purpose, currency, count, amount, and eligible total evidence.'
    );
    record(
      checks,
      hasTimestampEvidence(receiptData.issuedAt),
      'Stored annual receipt includes issue timestamp evidence',
      'Expected issuedAt on the donor-only annual receipt.'
    );
    record(
      checks,
      hasFreshTimestampEvidence(receiptData.issuedAt, nowMillis, maxAgeHours),
      `Stored annual receipt issue timestamp is within the ${maxAgeHours}-hour freshness window`,
      'Issue a fresh annual receipt and rerun the annual smoke check.'
    );
    record(
      checks,
      hasTimestampEvidence(receiptData.emailSentAt),
      'Stored annual receipt includes email delivery timestamp evidence',
      'Expected emailSentAt on the donor-only annual receipt.'
    );
    record(
      checks,
      hasFreshTimestampEvidence(receiptData.emailSentAt, nowMillis, maxAgeHours),
      `Stored annual receipt email timestamp is within the ${maxAgeHours}-hour freshness window`,
      'Email a fresh annual receipt and rerun the annual smoke check.'
    );
    record(
      checks,
      hasRetainedPdfStoragePath(retainedPdfStoragePath),
      'Stored annual receipt includes retained PDF storage metadata',
      'Expected backend-only PDF retention metadata on the donor-only annual receipt.'
    );
    record(
      checks,
      hasSha256Evidence(retainedPdfSha256),
      'Stored annual receipt includes retained PDF hash evidence',
      'Expected a SHA-256 hash for the retained annual receipt PDF.'
    );
    record(
      checks,
      hasByteLengthEvidence(retainedPdfByteLength),
      'Stored annual receipt includes retained PDF byte-length evidence',
      'Expected a positive byte length for the retained annual receipt PDF.'
    );
    record(
      checks,
      retainedPdfStatus === 'retained',
      'Stored annual receipt PDF retention status is retained',
      'Expected pdfRetentionStatus to be retained.'
    );
    record(
      checks,
      hasTimestampEvidence(retainedPdfRetainedAt),
      'Stored annual receipt includes retained PDF timestamp evidence',
      'Expected pdfRetainedAt on the donor-only annual receipt.'
    );
    record(
      checks,
      hasFreshTimestampEvidence(retainedPdfRetainedAt, nowMillis, maxAgeHours),
      `Stored annual receipt retained PDF timestamp is within the ${maxAgeHours}-hour freshness window`,
      'Retain a fresh official annual PDF copy and rerun the annual smoke check.'
    );
  }

  record(
    checks,
    retainedPdfObject !== null,
    'Retained annual receipt PDF object exists in Firebase Storage',
    `Expected the backend-only retained PDF object to exist in ${expectedFirebaseStorageBucket}.`
  );
  record(
    checks,
    retainedPdfObjectPath.length > 0 && retainedPdfObjectPath === retainedPdfStoragePath,
    'Retained annual receipt PDF object matches stored path metadata',
    'Expected the retained annual PDF object name to match the donor-only receipt metadata.'
  );
  record(
    checks,
    retainedPdfObjectSizeBytes !== null && retainedPdfObjectSizeBytes === retainedPdfByteLength,
    'Retained annual receipt PDF object byte length matches stored metadata',
    'Expected the retained annual PDF object size to match the donor-only receipt metadata.'
  );
  record(
    checks,
    retainedPdfObjectSha256.length > 0 && retainedPdfObjectSha256 === retainedPdfSha256,
    'Retained annual receipt PDF object hash metadata matches stored metadata',
    'Expected the retained annual PDF object SHA-256 metadata to match the donor-only receipt metadata.'
  );
  record(
    checks,
    retainedPdfObjectPurpose === 'official_tax_receipt_copy',
    'Retained annual receipt PDF object is marked as an official receipt copy',
    'Expected the retained annual PDF object to carry official tax receipt retention metadata.'
  );

  record(
    checks,
    summaryData !== null,
    'Staff-safe annual receipt summary mirror is readable',
    'Expected a taxReceiptSummaries mirror for the sent annual receipt.'
  );
  if (summaryData !== null && receiptData !== null) {
    record(checks, summaryKind === 'annual', 'Annual summary mirror is annual kind', 'Expected kind annual.');
    record(checks, summaryStatus === receiptStatus, 'Annual summary status matches the donor-only receipt', 'Expected sent.');
    record(
      checks,
      summaryReceiptId === (taxReceipt?.id ?? receiptId),
      'Annual summary points to the stored annual receipt',
      'Expected the annual summary receiptId to match the donor-only annual receipt.'
    );
    record(
      checks,
      summaryChurchId.length > 0 && summaryChurchId === receiptChurchId,
      'Annual summary church matches the stored receipt',
      'Expected annual summary church evidence to match the donor-only annual receipt.'
    );
    record(
      checks,
      summaryUserId.length > 0 && summaryUserId === receiptUserId,
      'Annual summary donor account matches the stored receipt',
      'Expected annual summary donor account evidence to match the donor-only annual receipt.'
    );
    record(
      checks,
      summaryReceiptNumber.length > 0 && summaryReceiptNumber === receiptNumber,
      'Annual summary receipt number matches the stored receipt',
      'Expected the portal-visible annual receipt number to match the donor-only receipt number.'
    );
    record(
      checks,
      summaryAnnualYear === annualYear,
      'Annual summary receipt year matches the stored receipt',
      'Expected annual summary year evidence to match the donor-only annual receipt.'
    );
    record(
      checks,
      summaryData.amountCents === amountCents && summaryData.eligibleAmountCents === eligibleAmountCents,
      'Annual summary amount evidence matches the stored receipt',
      'Expected annual summary amount evidence to match the donor-only annual receipt.'
    );
    record(
      checks,
      normalizedCurrency(summaryData.currency) === currency,
      'Annual summary currency matches the stored receipt',
      'Expected annual summary currency to match the donor-only annual receipt.'
    );
    record(
      checks,
      summaryData.donationCount === donationCount,
      'Annual summary contribution count matches the stored receipt',
      'Expected annual summary donationCount to match the donor-only annual receipt.'
    );
    record(
      checks,
      sameTimestampEvidence(summaryData.emailSentAt, receiptData.emailSentAt),
      'Annual summary email timestamp matches the stored receipt',
      'Expected annual summary emailSentAt to match the donor-only annual receipt.'
    );
    record(
      checks,
      summaryData.donorAnonymous === false,
      'Annual summary is for an explicitly non-anonymous donor-year',
      'Use a non-anonymous annual receipt to prove the church receipt portal mirror.'
    );
    record(
      checks,
      summaryData.churchReceiptVisible === true,
      'Annual summary is visible to receipt managers',
      'Expected churchReceiptVisible to be true for the non-anonymous annual smoke.'
    );
    record(
      checks,
      summaryData.donorLabelPublicSafe === true,
      'Annual summary donor label is marked public-safe',
      'Expected donorLabelPublicSafe to be true for the annual smoke.'
    );
    record(
      checks,
      summaryData.receiptManagerSummarySafe === true
        && summaryData.receiptManagerSummarySafeVersion === receiptManagerSummarySafeVersion,
      'Annual summary has the current receipt-manager safe marker',
      `Expected receiptManagerSummarySafeVersion ${receiptManagerSummarySafeVersion}.`
    );
    record(
      checks,
      summaryDonorLabel.length > 0
        && summaryDonorLabel !== reservedAnonymousDonorLabel
        && !looksLikeEmail(summaryDonorLabel),
      'Annual summary donor label is non-empty, not an email address, and not the reserved anonymous label',
      'Expected a staff-safe public donor label, not donor email, legal receipt details, or the anonymous fallback.'
    );
    record(
      checks,
      summaryPrivateFieldLeakCount === 0,
      'Annual summary mirror omits private full-receipt fields',
      summaryPrivateFieldLeakCount > 0
        ? `${summaryPrivateFieldLeakCount} private field(s) were present on the annual summary mirror.`
        : ''
    );
  }

  return {
    ok: checks.every((check) => check.ok),
    checks,
    inspectedAnnualEmailEventCount: annualEmailEvents.length,
    receiptStatus,
    summaryVisibility: summaryData?.churchReceiptVisible === true ? 'staff-visible' : 'donor-only-or-missing',
  };
}

/**
 * @param {AnnualSmokeCheck[]} checks
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
 * @param {{ accessToken: string, fetchImpl: typeof fetch, projectId: string, annualEmailEvents: AnnualSmokeDocument[], annualEmailEvent: AnnualSmokeDocument | null, targetReceiptId: string }} options
 * @returns {Promise<{ annualEmailEvents: AnnualSmokeDocument[], annualEmailEvent: AnnualSmokeDocument | null, taxReceipt: AnnualSmokeDocument | null, taxReceiptSummary: AnnualSmokeDocument | null, retainedPdfObject: AnnualSmokeStorageObjectMetadata | null }>}
 */
async function loadLiveAnnualReceiptSmokeStateForTarget({
  accessToken,
  fetchImpl,
  projectId,
  annualEmailEvents,
  annualEmailEvent,
  targetReceiptId,
}) {
  const taxReceipt = targetReceiptId
    ? await readDocumentWithFirestoreRest(fetchImpl, accessToken, {
      projectId,
      collectionName: 'taxReceipts',
      documentId: targetReceiptId,
      fieldMasks: [
        'kind',
        'status',
        'givingId',
        'givingIds',
        'contributions',
        'churchId',
        'userId',
        'amountCents',
        'eligibleAmountCents',
        'currency',
        'receiptNumber',
        'receiptYear',
        'annualYear',
        'donationCount',
        'issuedAt',
        'emailSentAt',
        'pdfStoragePath',
        'pdfSha256',
        'pdfByteLength',
        'pdfRetentionStatus',
        'pdfRetainedAt',
        'emailError',
        'emailFailedAt',
        'correctionForReceiptId',
        'correctionSourceReason',
        'correctedAt',
        'correctionRequired',
        'correctionReason',
        'voidedAt',
        'voidReason',
        'includesPreviouslyReceipted',
        'donorAnonymous',
      ],
    })
    : null;
  const taxReceiptSummary = targetReceiptId
    ? await readDocumentWithFirestoreRest(fetchImpl, accessToken, {
      projectId,
      collectionName: 'taxReceiptSummaries',
      documentId: targetReceiptId,
      fieldMasks: [
        'receiptId',
        'churchId',
        'userId',
        'kind',
        'status',
        'jurisdiction',
        'receiptYear',
        'annualYear',
        'receiptNumber',
        'amountCents',
        'eligibleAmountCents',
        'currency',
        'donationCount',
        'includesPreviouslyReceipted',
        'donorLabel',
        'donorAnonymous',
        'churchReceiptVisible',
        'donorLabelPublicSafe',
        'receiptManagerSummarySafe',
        'receiptManagerSummarySafeVersion',
        'issuedAt',
        'emailSentAt',
        'emailFailedAt',
        'emailError',
        'correctedReceipt',
        'correctionRequired',
        'correctionReason',
        'voidedAt',
        'voidReason',
        ...annualSummaryPrivateFields,
      ],
    })
    : null;
  const retainedPdfStoragePath = typeof taxReceipt?.data?.pdfStoragePath === 'string'
    ? taxReceipt.data.pdfStoragePath
    : '';
  const retainedPdfObject = hasRetainedPdfStoragePath(retainedPdfStoragePath)
    ? await readRetainedPdfObjectMetadataWithStorageRest(fetchImpl, accessToken, {
      storagePath: retainedPdfStoragePath,
    })
    : null;

  return {
    annualEmailEvents,
    annualEmailEvent,
    taxReceipt,
    taxReceiptSummary,
    retainedPdfObject,
  };
}

function emptyLiveAnnualReceiptSmokeState(annualEmailEvents = [], annualEmailEvent = null) {
  return {
    annualEmailEvents,
    annualEmailEvent,
    taxReceipt: null,
    taxReceiptSummary: null,
    retainedPdfObject: null,
  };
}

/**
 * @param {{ accessToken: string, fetchImpl?: typeof fetch, projectId?: string, limit?: number, receiptId?: string, maxAgeHours?: number, minContributions?: number, nowMillis?: number }} options
 * @returns {Promise<{ annualEmailEvents: AnnualSmokeDocument[], annualEmailEvent: AnnualSmokeDocument | null, taxReceipt: AnnualSmokeDocument | null, taxReceiptSummary: AnnualSmokeDocument | null, retainedPdfObject: AnnualSmokeStorageObjectMetadata | null }>}
 */
export async function loadLiveAnnualReceiptSmokeState({
  accessToken,
  fetchImpl = globalThis.fetch,
  projectId = expectedProjectId,
  limit = defaultLimit,
  receiptId = '',
  maxAgeHours = defaultMaxAgeHours,
  minContributions = defaultMinContributions,
  nowMillis = Date.now(),
}) {
  const annualEmailEvents = receiptId
    ? await readTaxReceiptEventsForReceiptWithFirestoreRest(fetchImpl, accessToken, { projectId, receiptId })
    : await readRecentAnnualEmailSentEventsWithFirestoreRest(fetchImpl, accessToken, { projectId, limit });
  const candidates = annualEmailEventCandidates(annualEmailEvents, receiptId);
  if (receiptId) {
    const annualEmailEvent = candidates[0] ?? null;
    return annualEmailEvent
      ? loadLiveAnnualReceiptSmokeStateForTarget({
        accessToken,
        fetchImpl,
        projectId,
        annualEmailEvents,
        annualEmailEvent,
        targetReceiptId: receiptId,
      })
      : emptyLiveAnnualReceiptSmokeState(annualEmailEvents, null);
  }

  let fallbackState = null;
  for (const annualEmailEvent of candidates) {
    const targetReceiptId = trimmedString(annualEmailEvent?.data?.receiptId);
    const candidateState = await loadLiveAnnualReceiptSmokeStateForTarget({
      accessToken,
      fetchImpl,
      projectId,
      annualEmailEvents,
      annualEmailEvent,
      targetReceiptId,
    });
    const result = evaluateLiveAnnualReceiptSmoke({
      ...candidateState,
      nowMillis,
      maxAgeHours,
      minContributions,
    });
    if (result.ok) {
      return candidateState;
    }
    fallbackState ??= candidateState;
  }

  return fallbackState ?? emptyLiveAnnualReceiptSmokeState(annualEmailEvents, null);
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

    stdout.write('Kandilo live annual receipt smoke check\n\n');
    stdout.write(`Project: ${options.projectId}\n`);
    stdout.write(`Recent annual email event limit: ${options.limit}\n`);
    stdout.write(`Smoke freshness window: ${options.maxAgeHours} hours\n`);
    stdout.write(`Minimum annual contribution count: ${options.minContributions}\n`);
    stdout.write(`Target receipt id: ${options.receiptId ? 'provided' : 'recent annual smoke candidate'}\n\n`);

    const accessToken = accessTokenReader();
    const state = await loadLiveAnnualReceiptSmokeState({
      accessToken,
      fetchImpl,
      projectId: options.projectId,
      limit: options.limit,
      receiptId: options.receiptId,
      maxAgeHours: options.maxAgeHours,
      minContributions: options.minContributions,
    });
    const result = evaluateLiveAnnualReceiptSmoke({
      ...state,
      maxAgeHours: options.maxAgeHours,
      minContributions: options.minContributions,
    });
    const failures = printChecks(result.checks, stdout);
    stdout.write(`\nInspected annual receipt email events: ${result.inspectedAnnualEmailEventCount}\n`);
    stdout.write(`Annual receipt state: ${result.receiptStatus || 'missing'}\n`);
    stdout.write(`Annual summary visibility: ${result.summaryVisibility}\n\n`);

    if (failures > 0) {
      stdout.write(`Result: ${failures} failure(s). Send and verify a non-anonymous annual receipt before announcing year-end receipts.\n`);
      return 1;
    }
    stdout.write('Result: live annual receipt smoke check passed without exposing donor, church, receipt, giving, tax receipt event, PDF metadata, amount, currency, or access-token values.\n');
    return 0;
  } catch (error) {
    stderr.write(`${error instanceof Error ? error.message : String(error)}\n\n${usage}\n`);
    return 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  process.exitCode = await main();
}
