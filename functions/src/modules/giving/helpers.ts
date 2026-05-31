import { createHash, randomUUID } from 'node:crypto';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import { db } from '../../shared/firebase';
import { sanitizedErrorContext } from '../../shared/logging';
import { PUBLIC_TAX_RECEIPT_NUMBER_FALLBACK } from '../../shared/taxReceiptPdf';
import { publicTaxReceiptAuditCode } from '../../shared/taxReceiptAudit';
import { assertMaxLength } from '../../shared/validation';
import {
  ALLOWED_CURRENCIES,
  ANNUAL_RECEIPT_MIXED_CURRENCY_REVIEW_CODE,
  ANONYMOUS_DONOR_LABEL,
  CANADA_CRA_ELECTRONIC_RECEIPT_BLOCKER,
  CHURCH_INACTIVE_CODE,
  DEFAULT_TAX_GOODS_SERVICES_STATEMENT,
  GIVING_PRIVATE_PAYMENT_FIELDS,
  PREVIOUSLY_RECEIPTED_ACK_REQUIRED_CODE,
  RECEIPT_CLAIM_TIMEOUT_MS,
  RECEIPT_MANAGER_GIVING_SAFE_VERSION,
  STRIPE_FULL_REFUND_ANNUAL_REISSUE_REASON,
  STRIPE_PARTIAL_REFUND_CORRECTED_REASON,
  TAX_RECEIPTS_COLLECTION,
  TAX_RECEIPT_DONOR_PROFILE_INCOMPLETE_CODE,
  TAX_RECEIPT_EVENTS_COLLECTION,
  TAX_RECEIPT_ID_PATTERN,
  TAX_RECEIPT_INVALID_CURRENCY_CODE,
  TAX_RECEIPT_MANAGER_SUMMARY_SAFE_VERSION,
  TAX_RECEIPT_MISSING_RECEIPT_NUMBER_CODE,
  TAX_RECEIPT_SETUP_REQUIRED_CODE,
  TAX_RECEIPT_SUMMARIES_COLLECTION,
  TAX_RECEIPT_SUMMARY_PRIVATE_FIELDS,
  TAX_RECEIPT_UNSUPPORTED_JURISDICTION_CODE,
} from './constants';
export {
  canApplyCheckoutCompletion,
  canApplyCheckoutFailure,
  checkoutUrlIsSafe,
  findGivingRefForCharge,
  findGivingRefForSession,
  getAppUrl,
  givingPaymentMetadataRef,
  stripeConnectDestinationForChurch,
  stripeEventLivemode,
  stripeObjectId,
  timestampFromStripeSeconds,
} from './checkout-helpers';
type TaxReceiptSettings = {
  enabled: boolean;
  jurisdiction: 'US';
  eligibilityConfirmed: boolean;
  organizationName: string;
  organizationAddress: string;
  taxId: string;
  receiptPrefix: string;
  goodsServicesStatement: string;
  autoIssue: boolean;
  annualPreparationEnabled: boolean;
  annualAutoEmailEnabled: boolean;
  receiptIssueLocation: string;
  authorizedSignerName: string;
  authorizedSignerTitle: string;
  secureElectronicSignatureConfigured: boolean;
  receiptCopiesRetentionConfirmed: boolean;
};

export function donationCurrencyForChurch(church: FirebaseFirestore.DocumentData): 'usd' | 'cad' {
  const country = optionalTrimmedString(church.country, 10).toUpperCase();
  return country === 'CA' ? 'cad' : 'usd';
}

export function normalizedTaxReceiptCurrency(value: unknown): string {
  const currency = optionalTrimmedString(value, 10).toUpperCase();
  return ALLOWED_CURRENCIES.has(currency.toLowerCase()) ? currency : '';
}

export function assertGivingCurrencyForTaxReceipt(giving: FirebaseFirestore.DocumentData): string {
  const currency = normalizedTaxReceiptCurrency(giving.currency);
  if (currency) {
    return currency;
  }

  throw new HttpsError(
    'failed-precondition',
    'Donation currency is missing or unsupported for tax receipt issuance.',
    { errorCode: TAX_RECEIPT_INVALID_CURRENCY_CODE }
  );
}

export type TaxReceiptIssueResult = {
  receiptId: string;
  receiptNumber: string;
  created: boolean;
  emailSent?: boolean;
  contributionCount?: number;
};

export type BulkAnnualReceiptFailure = {
  code: string;
};

type TaxReceiptEventAction =
  | 'issued'
  | 'email_sent'
  | 'email_failed'
  | 'pdf_downloaded'
  | 'corrected'
  | 'annual_batch_item_failed'
  | 'annual_scheduled_item_failed'
  | 'annual_scheduled_review_summary'
  | 'review_required'
  | 'voided';

type TaxReceiptEventInput = {
  action: TaxReceiptEventAction;
  actorUid: string;
  receiptId?: string;
  receipt?: Record<string, unknown>;
  churchId?: string;
  userId?: string;
  givingId?: string;
  kind?: string;
  receiptYear?: number;
  errorCode?: string;
  reasonCode?: string;
  reviewCount?: number;
};

type DonorTaxReceiptAddress = {
  line1: string;
  line2: string;
  city: string;
  region: string;
  postalCode: string;
  country: string;
};

type AnnualPublicDonorIdentity = {
  donorLabel: string;
  donorAnonymous: boolean;
};

export function givingIsExplicitlyNonAnonymous(giving: FirebaseFirestore.DocumentData): boolean {
  return giving.anonymous === false;
}

export function taxReceiptAlreadyEmailed(receipt: Record<string, unknown>): boolean {
  return Boolean(
    storedOfficialReceiptNumber(receipt.receiptNumber)
    && (
      optionalTrimmedString(receipt.status, 20) === 'sent'
      || receipt.emailSentAt instanceof Timestamp
    )
  );
}

export function taxReceiptEmailSendClaimIsFresh(receipt: Record<string, unknown>): boolean {
  const sendingAt = receipt.emailSendingAt;
  return sendingAt instanceof Timestamp && Date.now() - sendingAt.toMillis() < RECEIPT_CLAIM_TIMEOUT_MS;
}

export function taxReceiptEmailSendAttemptId(value: unknown): string {
  const attemptId = typeof value === 'string' ? value.trim() : '';
  return /^[A-Za-z0-9_-]{16,80}$/.test(attemptId) ? attemptId : '';
}

export function newTaxReceiptEmailSendAttemptId(): string {
  return randomUUID().replace(/-/g, '');
}

function sanitizedIdempotencyPart(value: unknown, fallback: string): string {
  const raw = typeof value === 'string' ? value.trim() : '';
  const sanitized = raw
    .replace(/[^A-Za-z0-9_-]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
  return sanitized || fallback;
}

export function taxReceiptEmailIdempotencyKey(receiptId: string, attemptId: string): string {
  const projectId = sanitizedIdempotencyPart(process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT, 'local');
  const digest = createHash('sha256')
    .update(`${projectId}:${receiptId}:${attemptId}`)
    .digest('base64url')
    .slice(0, 32);
  return `kandilo-${projectId}-tax-receipt-${digest}`;
}

export function givingPrivatePaymentFieldDeletes(): Record<string, FieldValue> {
  return Object.fromEntries(
    GIVING_PRIVATE_PAYMENT_FIELDS.map((field) => [field, FieldValue.delete()])
  );
}

function givingOmitsPrivatePaymentFields(giving: FirebaseFirestore.DocumentData): boolean {
  return GIVING_PRIVATE_PAYMENT_FIELDS.every((field) => !Object.prototype.hasOwnProperty.call(giving, field));
}

export function optionalTrimmedString(value: unknown, max: number): string {
  if (typeof value !== 'string') {
    return '';
  }
  const trimmed = value.trim();
  assertMaxLength(trimmed, max, 'value');
  return trimmed;
}

export function publicTaxReceiptNumber(value: unknown): string {
  const receiptNumber = typeof value === 'string' ? value.trim().slice(0, 120) : '';
  return receiptNumber && receiptNumber.toLowerCase() !== PUBLIC_TAX_RECEIPT_NUMBER_FALLBACK
    ? receiptNumber
    : PUBLIC_TAX_RECEIPT_NUMBER_FALLBACK;
}

function storedOfficialReceiptNumber(value: unknown): string {
  const receiptNumber = typeof value === 'string' ? value.trim().slice(0, 120) : '';
  return receiptNumber.toLowerCase() === PUBLIC_TAX_RECEIPT_NUMBER_FALLBACK ? '' : receiptNumber;
}

export function assertStoredOfficialReceiptNumber(receipt: Record<string, unknown>): void {
  if (storedOfficialReceiptNumber(receipt.receiptNumber)) {
    return;
  }
  throw new HttpsError(
    'failed-precondition',
    'This tax receipt is missing an official receipt number and needs review before it can be delivered.',
    { errorCode: TAX_RECEIPT_MISSING_RECEIPT_NUMBER_CODE }
  );
}

export function receiptIdForSendResponse(receiptId: string, isOwner: boolean): string {
  return isOwner ? receiptId : '';
}

function looksLikeEmail(value: string): boolean {
  return /[^\s@]+@[^\s@]+\.[^\s@]{2,}/i.test(value.trim());
}

export function publicDonorLabelCandidate(value: unknown): string {
  const label = optionalTrimmedString(value, 160);
  return label && label !== ANONYMOUS_DONOR_LABEL && !looksLikeEmail(label) ? label : '';
}

function publicDisplayNameCandidate(value: unknown): string {
  return publicDonorLabelCandidate(value);
}

export function givingIsSafeForTargetedReceiptManagerAction(giving: FirebaseFirestore.DocumentData): boolean {
  return givingIsExplicitlyNonAnonymous(giving)
    && giving.churchReceiptVisible === true
    && giving.donorNamePublicSafe === true
    && giving.receiptManagerGivingSafeVersion === RECEIPT_MANAGER_GIVING_SAFE_VERSION
    && publicDonorLabelCandidate(giving.donorName).length > 0
    && givingOmitsPrivatePaymentFields(giving)
    && optionalTrimmedString(giving.donorEmail, 254) === '';
}

export function assertReceiptManagerCanTargetGiving(giving: FirebaseFirestore.DocumentData, message: string): void {
  if (givingIsSafeForTargetedReceiptManagerAction(giving)) {
    return;
  }

  throw new HttpsError('permission-denied', message);
}

function taxReceiptAddressFromUser(user: FirebaseFirestore.DocumentData): DonorTaxReceiptAddress | null {
  const raw = user.taxReceiptAddress;
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return null;
  }

  const address = raw as Record<string, unknown>;
  const normalized = {
    line1: optionalTrimmedString(address.line1, 160),
    line2: optionalTrimmedString(address.line2, 160),
    city: optionalTrimmedString(address.city, 100),
    region: optionalTrimmedString(address.region, 100),
    postalCode: optionalTrimmedString(address.postalCode, 30),
    country: optionalTrimmedString(address.country, 80),
  };
  return Object.values(normalized).some(Boolean) ? normalized : null;
}

function formatDonorTaxReceiptAddress(address: DonorTaxReceiptAddress | null): string {
  if (!address) {
    return '';
  }

  const cityLine = [
    address.city,
    [address.region, address.postalCode].filter(Boolean).join(' '),
  ].filter(Boolean).join(', ');

  return [
    address.line1,
    address.line2,
    cityLine,
    address.country,
  ].filter(Boolean).join(', ');
}

function donorTaxReceiptAddressComplete(address: DonorTaxReceiptAddress | null): address is DonorTaxReceiptAddress {
  return Boolean(
    address?.line1
    && address.city
    && address.region
    && address.postalCode
    && address.country
  );
}

export function requiredDonorTaxReceiptProfile(user: FirebaseFirestore.DocumentData): {
  donorName: string;
  donorAddress: string;
} {
  const donorName = optionalTrimmedString(user.taxReceiptLegalName, 160);
  const donorAddressRecord = taxReceiptAddressFromUser(user);
  if (!donorName || !donorTaxReceiptAddressComplete(donorAddressRecord)) {
    throw new HttpsError(
      'failed-precondition',
      'The donor needs a legal receipt name and mailing address in their private profile before a tax receipt can be issued.',
      { errorCode: TAX_RECEIPT_DONOR_PROFILE_INCOMPLETE_CODE }
    );
  }

  return {
    donorName,
    donorAddress: formatDonorTaxReceiptAddress(donorAddressRecord),
  };
}

export function publicGivingDonorLabel(
  giving: FirebaseFirestore.DocumentData,
  user: FirebaseFirestore.DocumentData,
  member: FirebaseFirestore.DocumentData
): string {
  if (!givingIsExplicitlyNonAnonymous(giving)) {
    return ANONYMOUS_DONOR_LABEL;
  }

  return publicDonorLabelCandidate(giving.donorName)
    || publicDisplayNameCandidate(user.displayName)
    || publicDisplayNameCandidate(member.displayName)
    || 'Parishioner';
}

export function givingIdentityUpdateForReceipt(
  giving: FirebaseFirestore.DocumentData,
  donorLabel: string
): Record<string, unknown> {
  if (!givingIsExplicitlyNonAnonymous(giving)) {
    return {
      donorName: ANONYMOUS_DONOR_LABEL,
      donorEmail: '',
      donorNamePublicSafe: false,
      churchReceiptVisible: false,
      receiptManagerGivingSafeVersion: 0,
    };
  }

  return {
    donorName: donorLabel,
    donorEmail: '',
    donorNamePublicSafe: true,
    churchReceiptVisible: true,
    receiptManagerGivingSafeVersion: RECEIPT_MANAGER_GIVING_SAFE_VERSION,
  };
}

export function annualPublicDonorIdentity(
  validGiving: Array<{ data: FirebaseFirestore.DocumentData }>,
  user: FirebaseFirestore.DocumentData,
  member: FirebaseFirestore.DocumentData
): AnnualPublicDonorIdentity {
  if (validGiving.some(({ data }) => !givingIsExplicitlyNonAnonymous(data))) {
    return {
      donorLabel: ANONYMOUS_DONOR_LABEL,
      donorAnonymous: true,
    };
  }

  const firstGiving = validGiving[0]?.data ?? {};
  return {
    donorLabel:
      publicDonorLabelCandidate(firstGiving.donorName)
      || publicDisplayNameCandidate(user.displayName)
      || publicDisplayNameCandidate(member.displayName)
      || 'Parishioner',
    donorAnonymous: false,
  };
}

export function parseTaxReceiptSettings(church: FirebaseFirestore.DocumentData): TaxReceiptSettings | null {
  const raw = church.taxReceiptSettings;
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return null;
  }

  const settings = raw as Record<string, unknown>;
  if (settings.enabled !== true) {
    return null;
  }
  if (settings.jurisdiction !== 'US') {
    throw new HttpsError(
      'failed-precondition',
      CANADA_CRA_ELECTRONIC_RECEIPT_BLOCKER,
      { errorCode: TAX_RECEIPT_UNSUPPORTED_JURISDICTION_CODE }
    );
  }
  if (settings.eligibilityConfirmed !== true) {
    throw new HttpsError(
      'failed-precondition',
      'This church must confirm tax receipt eligibility before receipts can be issued.',
      { errorCode: TAX_RECEIPT_SETUP_REQUIRED_CODE }
    );
  }

  const organizationName = optionalTrimmedString(settings.organizationName, 200);
  if (!organizationName) {
    throw new HttpsError(
      'failed-precondition',
      'This church needs a legal receipt organization name before tax receipts can be issued.',
      { errorCode: TAX_RECEIPT_SETUP_REQUIRED_CODE }
    );
  }
  const organizationAddress = optionalTrimmedString(settings.organizationAddress, 500);
  if (!organizationAddress) {
    throw new HttpsError(
      'failed-precondition',
      'This church needs a legal receipt address before tax receipts can be issued.',
      { errorCode: TAX_RECEIPT_SETUP_REQUIRED_CODE }
    );
  }
  const taxId = optionalTrimmedString(settings.taxId, 80);
  if (!taxId) {
    throw new HttpsError(
      'failed-precondition',
      'This church needs a tax ID before tax receipts can be issued.',
      { errorCode: TAX_RECEIPT_SETUP_REQUIRED_CODE }
    );
  }

  return {
    enabled: true,
    jurisdiction: 'US',
    eligibilityConfirmed: true,
    organizationName,
    organizationAddress,
    taxId,
    receiptPrefix: optionalTrimmedString(settings.receiptPrefix, 40),
    goodsServicesStatement:
      optionalTrimmedString(settings.goodsServicesStatement, 500)
      || DEFAULT_TAX_GOODS_SERVICES_STATEMENT,
    autoIssue: settings.autoIssue !== false,
    annualPreparationEnabled: settings.annualPreparationEnabled === true,
    annualAutoEmailEnabled:
      settings.annualPreparationEnabled === true
      && settings.annualAutoEmailEnabled === true,
    receiptIssueLocation: optionalTrimmedString(settings.receiptIssueLocation, 120),
    authorizedSignerName: optionalTrimmedString(settings.authorizedSignerName, 160),
    authorizedSignerTitle: optionalTrimmedString(settings.authorizedSignerTitle, 120),
    secureElectronicSignatureConfigured: settings.secureElectronicSignatureConfigured === true,
    receiptCopiesRetentionConfirmed: settings.receiptCopiesRetentionConfirmed === true,
  };
}

export function churchRequiresTaxReceiptProfileBeforeCheckout(church: FirebaseFirestore.DocumentData): boolean {
  try {
    return parseTaxReceiptSettings(church) !== null;
  } catch (error) {
    if (error instanceof HttpsError) {
      return false;
    }
    throw error;
  }
}

export function assertActiveChurchForTaxReceiptIssuance(church: FirebaseFirestore.DocumentData): void {
  if (church.isActive !== true) {
    throw new HttpsError(
      'failed-precondition',
      'This church is not currently active.',
      { errorCode: CHURCH_INACTIVE_CODE }
    );
  }
}

export function timestampOrNow(value: unknown): Timestamp {
  return value instanceof Timestamp ? value : Timestamp.now();
}

export async function getDocumentSnapshotsById(
  refs: FirebaseFirestore.DocumentReference[]
): Promise<Map<string, FirebaseFirestore.DocumentSnapshot>> {
  const snapsById = new Map<string, FirebaseFirestore.DocumentSnapshot>();
  for (let index = 0; index < refs.length; index += 300) {
    const batch = refs.slice(index, index + 300);
    if (batch.length === 0) {
      continue;
    }
    const snaps = await db.getAll(...batch);
    for (const snap of snaps) {
      snapsById.set(snap.id, snap);
    }
  }
  return snapsById;
}

export function isPartiallyRefundedGiving(giving: FirebaseFirestore.DocumentData): boolean {
  const refundStatus = optionalTrimmedString(giving.stripeRefundStatus, 40);
  const refundedCents = typeof giving.stripeAmountRefundedCents === 'number'
    ? giving.stripeAmountRefundedCents
    : 0;
  return giving.status === 'completed' && (refundStatus === 'partially_refunded' || refundedCents > 0);
}

function givingAmountCentsOrZero(giving: FirebaseFirestore.DocumentData): number {
  const amountCents =
    typeof giving.amountCents === 'number'
      ? giving.amountCents
      : Math.round((typeof giving.amount === 'number' ? giving.amount : 0) * 100);
  return Number.isInteger(amountCents) && amountCents > 0 ? amountCents : 0;
}

export function isFullyRefundedGiving(giving: FirebaseFirestore.DocumentData): boolean {
  const refundStatus = optionalTrimmedString(giving.stripeRefundStatus, 40);
  const refundedCents = typeof giving.stripeAmountRefundedCents === 'number'
    ? giving.stripeAmountRefundedCents
    : 0;
  const amountCents = givingAmountCentsOrZero(giving);
  return giving.status === 'refunded'
    || refundStatus === 'refunded'
    || (amountCents > 0 && refundedCents >= amountCents);
}

export function datePartsForReceipt(timestamp: Timestamp, timezone: unknown): { year: number; label: string } {
  const timeZone = typeof timezone === 'string' && timezone.trim() ? timezone.trim() : 'UTC';
  const date = timestamp.toDate();
  const options: Intl.DateTimeFormatOptions = {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone,
  };

  try {
    const formatter = new Intl.DateTimeFormat('en-US', options);
    const yearPart = formatter.formatToParts(date).find((part) => part.type === 'year')?.value;
    return {
      year: yearPart ? Number.parseInt(yearPart, 10) : date.getUTCFullYear(),
      label: formatter.format(date),
    };
  } catch {
    const formatter = new Intl.DateTimeFormat('en-US', { ...options, timeZone: 'UTC' });
    return {
      year: date.getUTCFullYear(),
      label: formatter.format(date),
    };
  }
}

export function formatCurrency(amountCents: number, currency: string): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
  }).format(amountCents / 100);
}

export function receiptCounterDocId(churchId: string, year: number): string {
  return `${churchId}_${year}`;
}

export function receiptNumberFor(settings: TaxReceiptSettings, churchId: string, year: number, sequence: number): string {
  const fallbackPrefix = churchId
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 24) || 'CHURCH';
  const configuredPrefix = settings.receiptPrefix
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
  const basePrefix = configuredPrefix || fallbackPrefix;
  const yearQualifiedPrefix = new RegExp(`(^|-)${year}$`).test(basePrefix)
    ? basePrefix
    : `${basePrefix}-${year}`;
  return `${yearQualifiedPrefix}-${String(sequence).padStart(6, '0')}`;
}

export function nextReceiptSequenceFromCounter(counterSnap: FirebaseFirestore.DocumentSnapshot): number {
  const currentSequence = counterSnap.data()?.lastSequence;
  if (currentSequence === undefined || currentSequence === null) {
    return 1;
  }
  if (
    !Number.isSafeInteger(currentSequence)
    || currentSequence < 0
    || currentSequence >= Number.MAX_SAFE_INTEGER
  ) {
    throw new HttpsError(
      'failed-precondition',
      'Tax receipt numbering is not ready. Ask a SuperAdmin to review the receipt counter before issuing receipts.',
      { errorCode: TAX_RECEIPT_SETUP_REQUIRED_CODE }
    );
  }
  return currentSequence + 1;
}

export function safeTaxReceiptDocId(givingId: string): string {
  if (!TAX_RECEIPT_ID_PATTERN.test(givingId)) {
    throw new HttpsError('invalid-argument', 'givingId is invalid.');
  }
  return givingId;
}

export function annualTaxReceiptDocId(churchId: string, userId: string, year: number): string {
  const digest = createHash('sha256')
    .update(`${churchId}:${userId}:${year}`)
    .digest('base64url')
    .slice(0, 32);
  return `annual_${digest}`;
}

export function annualReceiptYear(receipt: Record<string, unknown>): number | null {
  if (typeof receipt.receiptYear === 'number') {
    return receipt.receiptYear;
  }
  return typeof receipt.annualYear === 'number' ? receipt.annualYear : null;
}

export function receiptCoveredGivingIds(receipt: Record<string, unknown>): string[] {
  const ids = new Set<string>();
  const givingId = optionalTrimmedString(receipt.givingId, 128);
  if (givingId && TAX_RECEIPT_ID_PATTERN.test(givingId)) {
    ids.add(givingId);
  }
  if (Array.isArray(receipt.givingIds)) {
    for (const value of receipt.givingIds) {
      if (typeof value === 'string' && TAX_RECEIPT_ID_PATTERN.test(value)) {
        ids.add(value);
      }
    }
  }
  return Array.from(ids);
}

export function validExistingAnnualTaxReceipt(
  receipt: Record<string, unknown>,
  churchId: string,
  userId: string,
  year: number
): boolean {
  return optionalTrimmedString(receipt.kind, 20) === 'annual'
    && optionalTrimmedString(receipt.churchId, 128) === churchId
    && optionalTrimmedString(receipt.userId, 128) === userId
    && annualReceiptYear(receipt) === year;
}

export function correctedTaxReceiptDocId(givingId: string, refundedAmountCents: number): string {
  const digest = createHash('sha256')
    .update(`${givingId}:partial-refund:${refundedAmountCents}`)
    .digest('base64url')
    .slice(0, 32);
  return `correction_${digest}`;
}

export function correctedAnnualTaxReceiptDocId(
  churchId: string,
  userId: string,
  year: number,
  correctionDigestInput: string
): string {
  const digest = createHash('sha256')
    .update(`${churchId}:${userId}:${year}:annual-partial-refund:${correctionDigestInput}`)
    .digest('base64url')
    .slice(0, 32);
  return `annual_correction_${digest}`;
}

export function reissuedAnnualTaxReceiptDocId(
  churchId: string,
  userId: string,
  year: number,
  reissueDigestInput: string
): string {
  const digest = createHash('sha256')
    .update(`${churchId}:${userId}:${year}:annual-reissue:${reissueDigestInput}`)
    .digest('base64url')
    .slice(0, 32);
  return `annual_reissue_${digest}`;
}

export function annualPeriodLabel(year: number): string {
  return `January 1 - December 31, ${year}`;
}

export function partialRefundAmounts(giving: FirebaseFirestore.DocumentData): {
  originalAmountCents: number;
  refundedAmountCents: number;
  netAmountCents: number;
} | null {
  if (!isPartiallyRefundedGiving(giving)) {
    return null;
  }

  const originalAmountCents =
    typeof giving.amountCents === 'number'
      ? giving.amountCents
      : Math.round((typeof giving.amount === 'number' ? giving.amount : 0) * 100);
  const refundedAmountCents =
    typeof giving.stripeAmountRefundedCents === 'number' ? giving.stripeAmountRefundedCents : 0;
  if (
    !Number.isInteger(originalAmountCents)
    || !Number.isInteger(refundedAmountCents)
    || originalAmountCents <= 0
    || refundedAmountCents <= 0
    || refundedAmountCents >= originalAmountCents
  ) {
    return null;
  }

  return {
    originalAmountCents,
    refundedAmountCents,
    netAmountCents: originalAmountCents - refundedAmountCents,
  };
}

export function isValidPartialRefundCorrectionReceipt(
  receipt: Record<string, unknown>,
  givingId: string,
  giving: FirebaseFirestore.DocumentData,
  amounts: { originalAmountCents: number; refundedAmountCents: number; netAmountCents: number }
): boolean {
  const givingCurrency = normalizedTaxReceiptCurrency(giving.currency);
  const receiptCurrency = normalizedTaxReceiptCurrency(receipt.currency);

  return optionalTrimmedString(receipt.kind, 20) === 'single'
    && optionalTrimmedString(receipt.status, 20) !== 'voided'
    && receipt.correctionRequired !== true
    && !optionalTrimmedString(receipt.correctionReason, 120)
    && optionalTrimmedString(receipt.givingId, 128) === givingId
    && optionalTrimmedString(receipt.churchId, 128) === optionalTrimmedString(giving.churchId, 128)
    && optionalTrimmedString(receipt.userId, 128) === optionalTrimmedString(giving.userId, 128)
    && optionalTrimmedString(receipt.correctionForGivingId, 128) === givingId
    && typeof receipt.amountCents === 'number'
    && receipt.amountCents === amounts.netAmountCents
    && typeof receipt.eligibleAmountCents === 'number'
    && receipt.eligibleAmountCents === amounts.netAmountCents
    && typeof receipt.originalAmountCents === 'number'
    && receipt.originalAmountCents === amounts.originalAmountCents
    && typeof receipt.refundedAmountCents === 'number'
    && receipt.refundedAmountCents === amounts.refundedAmountCents
    && Boolean(receiptCurrency)
    && Boolean(givingCurrency)
    && receiptCurrency === givingCurrency;
}

export function isValidExistingSingleTaxReceiptForGiving(
  receipt: Record<string, unknown>,
  givingId: string,
  giving: FirebaseFirestore.DocumentData
): boolean {
  const amountCents = givingAmountCentsOrZero(giving);
  const receiptAmountCents = typeof receipt.amountCents === 'number' ? receipt.amountCents : 0;
  const receiptEligibleAmountCents =
    typeof receipt.eligibleAmountCents === 'number' ? receipt.eligibleAmountCents : receiptAmountCents;
  const givingCurrency = normalizedTaxReceiptCurrency(giving.currency);
  const receiptCurrency = normalizedTaxReceiptCurrency(receipt.currency);

  return optionalTrimmedString(receipt.kind, 20) === 'single'
    && optionalTrimmedString(receipt.givingId, 128) === givingId
    && optionalTrimmedString(receipt.churchId, 128) === optionalTrimmedString(giving.churchId, 128)
    && optionalTrimmedString(receipt.userId, 128) === optionalTrimmedString(giving.userId, 128)
    && optionalTrimmedString(receipt.status, 20) !== 'voided'
    && receipt.correctionRequired !== true
    && !optionalTrimmedString(receipt.correctionReason, 120)
    && giving.status === 'completed'
    && !isFullyRefundedGiving(giving)
    && !isPartiallyRefundedGiving(giving)
    && amountCents > 0
    && receiptAmountCents === amountCents
    && receiptEligibleAmountCents === amountCents
    && Boolean(receiptCurrency)
    && Boolean(givingCurrency)
    && receiptCurrency === givingCurrency;
}

export type AnnualGivingAmountSummary = {
  givingIds: string[];
  amountCents: number;
  eligibleAmountCents: number;
  refundedAmountCents: number;
  partialRefundGivingIds: string[];
  correctionDigestInput: string;
};

export type AnnualBatchDonorEntry = {
  userId: string;
  validGiving: Array<{
    snap: FirebaseFirestore.QueryDocumentSnapshot;
    data: FirebaseFirestore.DocumentData;
  }>;
  hasPartialRefund: boolean;
  hasMixedCurrency: boolean;
  currency: string;
};

export type AnnualBatchReviewSkip = {
  userId: string;
  code: string;
};

export type AnnualBatchDonorSelection = {
  donorIds: string[];
  skippedAlreadyEmailedCount: number;
  reviewSkips: AnnualBatchReviewSkip[];
  truncated: boolean;
};

type AnnualContributionRecord = {
  dateLabel: string;
  purpose: string;
  amountCents: number;
  eligibleAmountCents: number;
  currency: string;
};

export type ReceiptCoveredGivingRefundState = 'none' | 'partial' | 'full';

export type ReceiptCoveredGivingRefundDetails = {
  state: ReceiptCoveredGivingRefundState;
  givingDocs: Array<{
    id: string;
    ref: FirebaseFirestore.DocumentReference;
    snap: FirebaseFirestore.DocumentSnapshot;
    data: FirebaseFirestore.DocumentData;
  }>;
};

export type AnnualReceiptSummaryPrivacyOverrides = {
  donorAnonymous: boolean;
  donorLabel: string;
};

function originalGivingAmountCents(data: FirebaseFirestore.DocumentData): number {
  const amountCents =
    typeof data.amountCents === 'number'
      ? data.amountCents
      : Math.round((typeof data.amount === 'number' ? data.amount : 0) * 100);
  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    throw new HttpsError('failed-precondition', 'One or more donation amounts are invalid.');
  }
  return amountCents;
}

export function annualGivingAmountSummary(
  validGiving: Array<{
    snap: FirebaseFirestore.DocumentSnapshot;
    data: FirebaseFirestore.DocumentData;
  }>
): AnnualGivingAmountSummary {
  let amountCents = 0;
  let eligibleAmountCents = 0;
  let refundedAmountCents = 0;
  const givingIds: string[] = [];
  const partialRefundGivingIds: string[] = [];
  const correctionParts: string[] = [];

  for (const { snap, data } of validGiving) {
    const originalAmountCents = originalGivingAmountCents(data);
    const partialAmounts = partialRefundAmounts(data);
    if (isPartiallyRefundedGiving(data) && !partialAmounts) {
      throw new HttpsError(
        'failed-precondition',
        'One or more partially refunded donations have invalid refund metadata and need manual review.'
      );
    }

    const refundedCents = partialAmounts?.refundedAmountCents ?? 0;
    const netCents = partialAmounts?.netAmountCents ?? originalAmountCents;
    givingIds.push(snap.id);
    amountCents += originalAmountCents;
    eligibleAmountCents += netCents;
    refundedAmountCents += refundedCents;
    correctionParts.push(`${snap.id}:${originalAmountCents}:${refundedCents}`);
    if (refundedCents > 0) {
      partialRefundGivingIds.push(snap.id);
    }
  }

  return {
    givingIds,
    amountCents,
    eligibleAmountCents,
    refundedAmountCents,
    partialRefundGivingIds,
    correctionDigestInput: correctionParts.sort().join('|'),
  };
}

type AnnualGivingReceiptEvidence = {
  snap?: FirebaseFirestore.DocumentSnapshot;
  data: FirebaseFirestore.DocumentData;
};

function annualGivingIncludesPreviouslyReceipted(
  validGiving: AnnualGivingReceiptEvidence[]
): boolean {
  return validGiving.some(({ data }) =>
    Boolean(storedOfficialReceiptNumber(data.taxReceiptNumber))
  );
}

function annualGivingReceiptIds(validGiving: AnnualGivingReceiptEvidence[]): string[] {
  return Array.from(new Set(validGiving
    .map(({ snap }) => snap?.id ?? '')
    .filter((givingId) => TAX_RECEIPT_ID_PATTERN.test(givingId))));
}

function annualGivingSingleReceiptRefs(
  validGiving: AnnualGivingReceiptEvidence[]
): FirebaseFirestore.DocumentReference[] {
  const receiptIds = new Set<string>();
  for (const { snap, data } of validGiving) {
    const givingId = snap?.id ?? '';
    if (TAX_RECEIPT_ID_PATTERN.test(givingId)) {
      receiptIds.add(safeTaxReceiptDocId(givingId));
    }
    const taxReceiptId = optionalTrimmedString(data.taxReceiptId, 128);
    if (TAX_RECEIPT_ID_PATTERN.test(taxReceiptId)) {
      receiptIds.add(taxReceiptId);
    }
  }

  return Array.from(receiptIds)
    .map((receiptId) => db.collection(TAX_RECEIPTS_COLLECTION).doc(receiptId));
}

function singleReceiptIsPreviouslyReceiptedAnnualEvidence(
  receiptId: string,
  receipt: Record<string, unknown>,
  givingIds: Set<string>,
  churchId: string,
  userId: string
): boolean {
  const receiptGivingId = optionalTrimmedString(receipt.givingId, 128);
  return optionalTrimmedString(receipt.kind, 20) === 'single'
    && optionalTrimmedString(receipt.status, 20) !== 'voided'
    && optionalTrimmedString(receipt.churchId, 128) === churchId
    && optionalTrimmedString(receipt.userId, 128) === userId
    && storedOfficialReceiptNumber(receipt.receiptNumber) !== ''
    && (givingIds.has(receiptGivingId) || givingIds.has(receiptId));
}

function annualGivingSingleReceiptSnapsIncludePreviouslyReceipted(
  validGiving: AnnualGivingReceiptEvidence[],
  receiptSnaps: Iterable<FirebaseFirestore.DocumentSnapshot>,
  churchId: string,
  userId: string
): boolean {
  const givingIds = new Set(annualGivingReceiptIds(validGiving));
  if (givingIds.size === 0) {
    return false;
  }

  for (const receiptSnap of receiptSnaps) {
    if (
      receiptSnap.exists
      && singleReceiptIsPreviouslyReceiptedAnnualEvidence(
        receiptSnap.id,
        receiptSnap.data() ?? {},
        givingIds,
        churchId,
        userId
      )
    ) {
      return true;
    }
  }
  return false;
}

export async function annualGivingIncludesPreviouslyReceiptedEvidence(
  validGiving: AnnualGivingReceiptEvidence[],
  churchId: string,
  userId: string
): Promise<boolean> {
  if (annualGivingIncludesPreviouslyReceipted(validGiving)) {
    return true;
  }
  const receiptRefs = annualGivingSingleReceiptRefs(validGiving);
  if (receiptRefs.length === 0) {
    return false;
  }
  const receiptSnaps = await getDocumentSnapshotsById(receiptRefs);
  return annualGivingSingleReceiptSnapsIncludePreviouslyReceipted(
    validGiving,
    receiptSnaps.values(),
    churchId,
    userId
  );
}

export async function annualGivingIncludesPreviouslyReceiptedEvidenceInTransaction(
  tx: FirebaseFirestore.Transaction,
  validGiving: AnnualGivingReceiptEvidence[],
  churchId: string,
  userId: string
): Promise<boolean> {
  if (annualGivingIncludesPreviouslyReceipted(validGiving)) {
    return true;
  }
  const receiptRefs = annualGivingSingleReceiptRefs(validGiving);
  if (receiptRefs.length === 0) {
    return false;
  }
  const receiptSnaps = await Promise.all(receiptRefs.map((receiptRef) => tx.get(receiptRef)));
  return annualGivingSingleReceiptSnapsIncludePreviouslyReceipted(
    validGiving,
    receiptSnaps,
    churchId,
    userId
  );
}

export function annualReceiptBlocksSingleReceipt(
  receipt: Record<string, unknown>,
  churchId: string,
  userId: string,
  givingId: string
): boolean {
  if (
    optionalTrimmedString(receipt.kind, 20) !== 'annual'
    || optionalTrimmedString(receipt.status, 20) === 'voided'
    || optionalTrimmedString(receipt.churchId, 128) !== churchId
    || optionalTrimmedString(receipt.userId, 128) !== userId
    || !storedOfficialReceiptNumber(receipt.receiptNumber)
    || !Array.isArray(receipt.givingIds)
  ) {
    return false;
  }

  return receipt.givingIds.some((value) => value === givingId);
}

function annualGivingCurrencySet(
  validGiving: Array<{
    data: FirebaseFirestore.DocumentData;
  }>
): Set<string> {
  return new Set(validGiving.map(({ data }) => normalizedTaxReceiptCurrency(data.currency)));
}

export function assertAnnualGivingSingleCurrency(
  validGiving: Array<{
    data: FirebaseFirestore.DocumentData;
  }>
): string {
  const currencies = annualGivingCurrencySet(validGiving);
  if (currencies.size !== 1 || currencies.has('')) {
    throw new HttpsError(
      'failed-precondition',
      'Annual tax receipts currently require one currency per summary.',
      { errorCode: ANNUAL_RECEIPT_MIXED_CURRENCY_REVIEW_CODE }
    );
  }
  return [...currencies][0];
}

export function requireAnnualPreviouslyReceiptedAcknowledgement(
  includesPreviouslyReceipted: boolean,
  acknowledged: boolean
): void {
  if (!includesPreviouslyReceipted || acknowledged) {
    return;
  }
  throw new HttpsError(
    'failed-precondition',
    'This annual tax receipt includes one or more donations that already have individual receipts. Confirm before sending it.',
    { errorCode: PREVIOUSLY_RECEIPTED_ACK_REQUIRED_CODE }
  );
}

export function annualContributionRecords(
  validGiving: Array<{
    data: FirebaseFirestore.DocumentData;
  }>,
  timezone: unknown,
  fallbackCurrency: string
): AnnualContributionRecord[] {
  return validGiving.map(({ data }) => {
    const completedAt = data.completedAt;
    if (!(completedAt instanceof Timestamp)) {
      throw new HttpsError('failed-precondition', 'One or more donation dates are invalid.');
    }
    const amountCents = originalGivingAmountCents(data);
    const partialAmounts = partialRefundAmounts(data);
    if (isPartiallyRefundedGiving(data) && !partialAmounts) {
      throw new HttpsError(
        'failed-precondition',
        'One or more partially refunded donations have invalid refund metadata and need manual review.'
      );
    }
    const currency = normalizedTaxReceiptCurrency(data.currency) || fallbackCurrency;
    return {
      dateLabel: datePartsForReceipt(completedAt, timezone).label,
      purpose: optionalTrimmedString(data.purpose, 200) || 'General Fund',
      amountCents,
      eligibleAmountCents: partialAmounts?.netAmountCents ?? amountCents,
      currency,
    };
  });
}

export function annualContributionRecordsMatchReceipt(
  receipt: Record<string, unknown>,
  validGiving: Array<{
    data: FirebaseFirestore.DocumentData;
  }>,
  timezone: unknown,
  fallbackCurrency: string
): boolean {
  const contributionRecords = receipt.contributions;
  if (!Array.isArray(contributionRecords)) {
    return false;
  }

  let expectedContributions: AnnualContributionRecord[];
  try {
    expectedContributions = annualContributionRecords(validGiving, timezone, fallbackCurrency);
  } catch {
    return false;
  }

  if (contributionRecords.length !== expectedContributions.length) {
    return false;
  }

  return expectedContributions.every((expected, index) => {
    const actual = contributionRecords[index];
    if (typeof actual !== 'object' || actual === null || Array.isArray(actual)) {
      return false;
    }
    const record = actual as Record<string, unknown>;
    const actualCurrency = normalizedTaxReceiptCurrency(record.currency);
    return optionalTrimmedString(record.dateLabel, 80) === expected.dateLabel
      && optionalTrimmedString(record.purpose, 200) === expected.purpose
      && record.amountCents === expected.amountCents
      && record.eligibleAmountCents === expected.eligibleAmountCents
      && actualCurrency === expected.currency;
  });
}

export function isValidAnnualPartialRefundCorrectionReceipt(
  receipt: Record<string, unknown>,
  churchId: string,
  userId: string,
  year: number,
  amounts: AnnualGivingAmountSummary,
  donationCount: number
): boolean {
  return optionalTrimmedString(receipt.kind, 20) === 'annual'
    && optionalTrimmedString(receipt.status, 20) !== 'voided'
    && receipt.correctionRequired !== true
    && !optionalTrimmedString(receipt.correctionReason, 120)
    && optionalTrimmedString(receipt.churchId, 128) === churchId
    && optionalTrimmedString(receipt.userId, 128) === userId
    && typeof receipt.receiptYear === 'number'
    && receipt.receiptYear === year
    && typeof receipt.annualYear === 'number'
    && receipt.annualYear === year
    && typeof receipt.amountCents === 'number'
    && receipt.amountCents === amounts.eligibleAmountCents
    && typeof receipt.eligibleAmountCents === 'number'
    && receipt.eligibleAmountCents === amounts.eligibleAmountCents
    && typeof receipt.originalAmountCents === 'number'
    && receipt.originalAmountCents === amounts.amountCents
    && typeof receipt.refundedAmountCents === 'number'
    && receipt.refundedAmountCents === amounts.refundedAmountCents
    && typeof receipt.donationCount === 'number'
    && receipt.donationCount === donationCount
    && optionalTrimmedString(receipt.correctionSourceReason, 120) === STRIPE_PARTIAL_REFUND_CORRECTED_REASON;
}

export function sameStringSet(left: unknown, right: string[]): boolean {
  if (!Array.isArray(left)) {
    return false;
  }
  const actual = left.filter((value): value is string => typeof value === 'string').sort();
  const expected = [...right].sort();
  return actual.length === expected.length && actual.every((value, index) => value === expected[index]);
}

export function isValidAnnualFullRefundReissueReceipt(
  receipt: Record<string, unknown>,
  churchId: string,
  userId: string,
  year: number,
  amounts: AnnualGivingAmountSummary,
  donationCount: number
): boolean {
  return validExistingAnnualTaxReceipt(receipt, churchId, userId, year)
    && optionalTrimmedString(receipt.status, 20) !== 'voided'
    && receipt.correctionRequired !== true
    && !optionalTrimmedString(receipt.correctionReason, 120)
    && sameStringSet(receipt.givingIds, amounts.givingIds)
    && typeof receipt.amountCents === 'number'
    && receipt.amountCents === amounts.amountCents
    && typeof receipt.eligibleAmountCents === 'number'
    && receipt.eligibleAmountCents === amounts.eligibleAmountCents
    && typeof receipt.donationCount === 'number'
    && receipt.donationCount === donationCount
    && optionalTrimmedString(receipt.correctionSourceReason, 120) === STRIPE_FULL_REFUND_ANNUAL_REISSUE_REASON;
}

export function taxReceiptRecordIsCorrected(receipt: Record<string, unknown>): boolean {
  const originalAmountCents =
    typeof receipt.originalAmountCents === 'number' ? receipt.originalAmountCents : 0;
  const refundedAmountCents =
    typeof receipt.refundedAmountCents === 'number' ? receipt.refundedAmountCents : 0;
  const eligibleAmountCents =
    typeof receipt.eligibleAmountCents === 'number' ? receipt.eligibleAmountCents : 0;
  return Boolean(
    optionalTrimmedString(receipt.correctionSourceReason, 120)
    || receipt.correctedAt
    || (
      originalAmountCents > eligibleAmountCents
      && refundedAmountCents > 0
    )
  );
}

function unsupportedOfficialReceiptDeliveryJurisdiction(receipt: Record<string, unknown>): string {
  const jurisdiction = optionalTrimmedString(receipt.jurisdiction, 10).toUpperCase();
  return jurisdiction && jurisdiction !== 'US' ? jurisdiction : '';
}

function unsupportedChurchReceiptSetupJurisdiction(church: FirebaseFirestore.DocumentData): string {
  const raw = church.taxReceiptSettings;
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return '';
  }

  const jurisdiction = optionalTrimmedString((raw as Record<string, unknown>).jurisdiction, 10).toUpperCase();
  return jurisdiction && jurisdiction !== 'US' ? jurisdiction : '';
}

export async function unsupportedOfficialReceiptDeliveryJurisdictionForReceipt(
  receipt: Record<string, unknown>
): Promise<string> {
  const receiptJurisdiction = unsupportedOfficialReceiptDeliveryJurisdiction(receipt);
  if (receiptJurisdiction) {
    return receiptJurisdiction;
  }

  const churchId = optionalTrimmedString(receipt.churchId, 128);
  if (!churchId) {
    return '';
  }
  const churchSnap = await db.collection('churches').doc(churchId).get();
  return churchSnap.exists ? unsupportedChurchReceiptSetupJurisdiction(churchSnap.data() ?? {}) : '';
}

export function unsupportedOfficialReceiptDeliveryMessage(jurisdiction: string): string {
  if (jurisdiction === 'CA') {
    return CANADA_CRA_ELECTRONIC_RECEIPT_BLOCKER;
  }
  return 'This tax receipt jurisdiction is not supported for official delivery.';
}

export function annualReceiptSummaryFromReceipt(
  receiptId: string,
  receipt: Record<string, unknown>,
  overrides: Record<string, unknown> = {}
): Record<string, unknown> | null {
  if (receipt.kind !== 'annual') {
    return null;
  }

  const churchId = optionalTrimmedString(receipt.churchId, 128);
  const userId = optionalTrimmedString(receipt.userId, 128);
  const receiptYear =
    typeof receipt.receiptYear === 'number'
      ? receipt.receiptYear
      : typeof receipt.annualYear === 'number'
        ? receipt.annualYear
        : null;
  if (!churchId || !userId || typeof receiptYear !== 'number') {
    return null;
  }

  const amountCents = typeof receipt.amountCents === 'number' ? receipt.amountCents : 0;
  const currency = normalizedTaxReceiptCurrency(receipt.currency);
  const hasCoveredGivingIds = Array.isArray(receipt.givingIds)
    && receipt.givingIds.some((value) => typeof value === 'string' && TAX_RECEIPT_ID_PATTERN.test(value));
  const donorAnonymous = receipt.donorAnonymous !== false || !hasCoveredGivingIds;
  const donorLabel = donorAnonymous
    ? ANONYMOUS_DONOR_LABEL
    : publicDonorLabelCandidate(receipt.donorLabel) || 'Parishioner';
  const privateFieldDeletes = Object.fromEntries(
    TAX_RECEIPT_SUMMARY_PRIVATE_FIELDS.map((field) => [field, FieldValue.delete()])
  );
  const summary = {
    receiptId,
    churchId,
    userId,
    kind: 'annual',
    status: optionalTrimmedString(receipt.status, 20) || 'issued',
    jurisdiction: optionalTrimmedString(receipt.jurisdiction, 10),
    receiptYear,
    annualYear: receiptYear,
    receiptNumber: publicTaxReceiptNumber(receipt.receiptNumber),
    amountCents,
    eligibleAmountCents:
      typeof receipt.eligibleAmountCents === 'number' ? receipt.eligibleAmountCents : amountCents,
    currency,
    donationCount: typeof receipt.donationCount === 'number' ? receipt.donationCount : null,
    includesPreviouslyReceipted: receipt.includesPreviouslyReceipted === true,
    donorLabel,
    donorAnonymous,
    churchReceiptVisible: donorAnonymous === false,
    donorLabelPublicSafe: donorAnonymous === false,
    receiptManagerSummarySafe: donorAnonymous === false,
    receiptManagerSummarySafeVersion: donorAnonymous === false ? TAX_RECEIPT_MANAGER_SUMMARY_SAFE_VERSION : 0,
    issuedAt: receipt.issuedAt ?? null,
    emailSentAt: receipt.emailSentAt ?? null,
    emailFailedAt: receipt.emailFailedAt ?? null,
    emailError: optionalTrimmedString(receipt.emailError, 200),
    correctedReceipt: taxReceiptRecordIsCorrected(receipt),
    correctionRequired: receipt.correctionRequired === true,
    correctionReason: optionalTrimmedString(receipt.correctionReason, 120),
    voidedAt: receipt.voidedAt ?? null,
    voidReason: optionalTrimmedString(receipt.voidReason, 120),
    updatedAt: FieldValue.serverTimestamp(),
    ...overrides,
    ...privateFieldDeletes,
  };
  summary.donorLabel = summary.donorAnonymous === false
    ? publicDonorLabelCandidate(summary.donorLabel) || 'Parishioner'
    : ANONYMOUS_DONOR_LABEL;
  summary.churchReceiptVisible = summary.donorAnonymous === false;
  summary.donorLabelPublicSafe = summary.donorAnonymous === false;
  summary.receiptManagerSummarySafe = summary.donorAnonymous === false;
  summary.receiptManagerSummarySafeVersion = summary.donorAnonymous === false ? TAX_RECEIPT_MANAGER_SUMMARY_SAFE_VERSION : 0;
  return summary;
}

export function annualReceiptSummaryPrivacyOverridesFromGivingRecords(
  givingRecords: Array<{ data: FirebaseFirestore.DocumentData }>,
  receipt: Record<string, unknown>
): AnnualReceiptSummaryPrivacyOverrides {
  if (
    givingRecords.length === 0
    || givingRecords.some(({ data }) => !givingIsSafeForTargetedReceiptManagerAction(data))
  ) {
    return {
      donorAnonymous: true,
      donorLabel: ANONYMOUS_DONOR_LABEL,
    };
  }

  const firstGiving = givingRecords[0]?.data ?? {};
  return {
    donorAnonymous: false,
    donorLabel:
      publicDonorLabelCandidate(receipt.donorLabel)
      || publicDonorLabelCandidate(firstGiving.donorName)
      || 'Parishioner',
  };
}

export function annualReceiptSummaryDonorOnlyPrivacyOverrides(): AnnualReceiptSummaryPrivacyOverrides {
  return {
    donorAnonymous: true,
    donorLabel: ANONYMOUS_DONOR_LABEL,
  };
}

export function annualReceiptSummaryPrivacyOverridesFromCoveredGivingRecords(
  receipt: Record<string, unknown>,
  givingRecordsById: Array<{
    id: string;
    exists: boolean;
    data: FirebaseFirestore.DocumentData;
  }>
): AnnualReceiptSummaryPrivacyOverrides {
  const coveredGivingIds = receiptCoveredGivingIds(receipt);
  if (coveredGivingIds.length === 0) {
    return annualReceiptSummaryDonorOnlyPrivacyOverrides();
  }

  const docsById = new Map(givingRecordsById.map((doc) => [doc.id, doc]));
  const givingRecords: Array<{ data: FirebaseFirestore.DocumentData }> = [];
  for (const givingId of coveredGivingIds) {
    const givingDoc = docsById.get(givingId);
    if (!givingDoc?.exists) {
      return annualReceiptSummaryDonorOnlyPrivacyOverrides();
    }
    givingRecords.push({ data: givingDoc.data });
  }

  return annualReceiptSummaryPrivacyOverridesFromGivingRecords(givingRecords, receipt);
}

export function annualReceiptSummaryPrivacyOverridesFromCoveredGivingDocs(
  receipt: Record<string, unknown>,
  givingDocs: ReceiptCoveredGivingRefundDetails['givingDocs']
): AnnualReceiptSummaryPrivacyOverrides {
  return annualReceiptSummaryPrivacyOverridesFromCoveredGivingRecords(
    receipt,
    givingDocs.map((doc) => ({
      id: doc.id,
      exists: doc.snap.exists,
      data: doc.data,
    }))
  );
}

async function annualReceiptSummaryPrivacyOverrides(
  receipt: Record<string, unknown>
): Promise<AnnualReceiptSummaryPrivacyOverrides> {
  if (receipt.donorAnonymous === true) {
    return annualReceiptSummaryDonorOnlyPrivacyOverrides();
  }

  const givingIds = Array.isArray(receipt.givingIds)
    ? receipt.givingIds.filter((value): value is string => (
        typeof value === 'string' && TAX_RECEIPT_ID_PATTERN.test(value)
      ))
    : [];
  if (givingIds.length === 0) {
    return annualReceiptSummaryDonorOnlyPrivacyOverrides();
  }

  const snapsById = await getDocumentSnapshotsById(
    givingIds.map((givingId) => db.collection('giving').doc(givingId))
  );
  const givingRecords = givingIds.map((givingId) => {
    const snap = snapsById.get(givingId);
    return {
      data: snap?.exists === true ? snap.data() ?? {} : {},
    };
  });

  return annualReceiptSummaryPrivacyOverridesFromGivingRecords(givingRecords, receipt);
}

export async function upsertAnnualReceiptSummary(
  receiptId: string,
  receipt: Record<string, unknown>,
  overrides: Record<string, unknown> = {}
): Promise<void> {
  if (receipt.kind !== 'annual') {
    return;
  }

  const privacyOverrides = await annualReceiptSummaryPrivacyOverrides(receipt);
  const summary = annualReceiptSummaryFromReceipt(receiptId, receipt, {
    ...overrides,
    ...privacyOverrides,
  });
  if (!summary) {
    return;
  }
  summary.churchReceiptVisible = summary.donorAnonymous === false;
  summary.donorLabelPublicSafe = summary.donorAnonymous === false;
  summary.receiptManagerSummarySafe = summary.donorAnonymous === false;
  summary.receiptManagerSummarySafeVersion = summary.donorAnonymous === false ? TAX_RECEIPT_MANAGER_SUMMARY_SAFE_VERSION : 0;

  await db.collection(TAX_RECEIPT_SUMMARIES_COLLECTION).doc(receiptId).set(summary, { merge: true });
}

export function taxReceiptEventData(input: TaxReceiptEventInput): Record<string, unknown> | null {
  const receipt = input.receipt ?? {};
  const churchId = input.churchId || optionalTrimmedString(receipt.churchId, 128);
  const userId = input.userId || optionalTrimmedString(receipt.userId, 128);
  const aggregateScheduledEvent = input.action === 'annual_scheduled_review_summary';
  if (!churchId || (!userId && !aggregateScheduledEvent)) {
    return null;
  }

  const receiptYear =
    typeof input.receiptYear === 'number'
      ? input.receiptYear
      : typeof receipt.receiptYear === 'number'
        ? receipt.receiptYear
        : typeof receipt.annualYear === 'number'
          ? receipt.annualYear
          : null;
  const kind = input.kind || optionalTrimmedString(receipt.kind, 20) || 'unknown';
  const givingId = input.givingId ?? optionalTrimmedString(receipt.givingId, 128);
  const event: Record<string, unknown> = {
    action: input.action,
    actorUid: input.actorUid || 'system',
    churchId,
    userId: userId || null,
    receiptId: input.receiptId || null,
    givingId: givingId || null,
    kind,
    receiptYear,
    annualYear: kind === 'annual' ? receiptYear : null,
    createdAt: FieldValue.serverTimestamp(),
  };
  const errorCode = publicTaxReceiptAuditCode(input.errorCode);
  const reasonCode = publicTaxReceiptAuditCode(input.reasonCode);
  if (errorCode) {
    event.errorCode = errorCode;
  }
  if (reasonCode) {
    event.reasonCode = reasonCode;
  }
  if (
    aggregateScheduledEvent
    && typeof input.reviewCount === 'number'
    && Number.isInteger(input.reviewCount)
    && input.reviewCount > 0
  ) {
    event.reviewCount = input.reviewCount;
  }
  return event;
}

export async function logTaxReceiptEvent(input: TaxReceiptEventInput): Promise<void> {
  const event = taxReceiptEventData(input);
  if (!event) {
    return;
  }

  try {
    await db.collection(TAX_RECEIPT_EVENTS_COLLECTION).doc().set(event);
  } catch (error) {
    console.error('Tax receipt event logging failed:', sanitizedErrorContext(error));
  }
}

export function assertAnnualReceiptYearClosed(year: number, timezone: unknown): void {
  const currentReceiptYear = datePartsForReceipt(Timestamp.now(), timezone).year;
  if (year >= currentReceiptYear) {
    throw new HttpsError(
      'failed-precondition',
      'Annual tax receipts can be issued only after the receipt year has ended. Use individual receipts for current-year donations.'
    );
  }
}

export function broadYearWindow(year: number): { start: Timestamp; end: Timestamp } {
  return {
    start: Timestamp.fromDate(new Date(Date.UTC(year - 1, 11, 31))),
    end: Timestamp.fromDate(new Date(Date.UTC(year + 1, 0, 2))),
  };
}
