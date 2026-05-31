import {
  collection,
  doc,
  getDoc,
  limit,
  onSnapshot,
  orderBy,
  query,
  Timestamp,
  where,
} from 'firebase/firestore';
import { db } from '../firebase/firestore';
import { normalizedTaxReceiptCurrency } from '../giving/receipt-currency';
import { assignedTaxReceiptNumber } from '../giving/receipt-number';

const ANONYMOUS_DONOR_LABEL = 'Anonymous donor';

export type GivingStatus = 'creating' | 'pending' | 'completed' | 'failed' | 'refunded' | 'unknown';
export type TaxReceiptStatus = 'not_configured' | 'ready' | 'issued' | 'sent' | 'error' | 'voided' | 'unknown';

export interface FirestoreGivingRecord {
  id: string;
  churchId: string;
  churchName: string;
  userId: string;
  donorName: string;
  donorEmail: string;
  donorNamePublicSafe: boolean;
  churchReceiptVisible: boolean;
  receiptManagerGivingSafeVersion: number;
  amountCents: number;
  amount: number;
  currency: string;
  purpose: string;
  anonymous: boolean;
  status: GivingStatus;
  stripeRefundStatus: string;
  stripeAmountRefundedCents: number;
  createdAt: Date | null;
  completedAt: Date | null;
  taxReceiptId: string;
  taxReceiptNumber: string;
  taxReceiptStatus: TaxReceiptStatus;
  taxReceiptError: string;
  taxReceiptEmailError: string;
  taxReceiptCorrectionRequired: boolean;
  taxReceiptCorrectionReason: string;
}

export interface FirestoreTaxReceiptRecord {
  id: string;
  churchId: string;
  churchName: string;
  userId: string;
  givingId: string;
  givingIds: string[];
  kind: 'single' | 'annual' | 'unknown';
  status: TaxReceiptStatus;
  jurisdiction: string;
  receiptNumber: string;
  receiptYear: number | null;
  organizationName: string;
  organizationAddress: string;
  organizationTaxId: string;
  donorName: string;
  donorAddress: string;
  donorEmail: string;
  amountCents: number;
  eligibleAmountCents: number;
  originalAmountCents: number | null;
  refundedAmountCents: number | null;
  currency: string;
  purpose: string;
  donationCount: number | null;
  contributions: FirestoreTaxReceiptContribution[];
  coveredPeriodLabel: string;
  duplicateClaimWarning: string;
  includesPreviouslyReceipted: boolean;
  receivedAt: Date | null;
  receivedDateLabel: string;
  issuedAt: Date | null;
  issuedDateLabel: string;
  goodsServicesStatement: string;
  pdfStoragePath: string;
  pdfSha256: string;
  pdfByteLength: number | null;
  pdfRetainedAt: Date | null;
  pdfRetentionStatus: string;
  receiptIssueLocation: string;
  authorizedSignerName: string;
  authorizedSignerTitle: string;
  secureElectronicSignatureConfigured: boolean;
  receiptCopiesRetentionConfirmed: boolean;
  emailSentAt: Date | null;
  emailFailedAt: Date | null;
  emailError: string;
  correctionRequired: boolean;
  correctionReason: string;
  correctionForReceiptId: string;
  correctionSourceReason: string;
  correctedAt: Date | null;
  voidedAt: Date | null;
  voidReason: string;
}

export interface FirestoreTaxReceiptContribution {
  dateLabel: string;
  purpose: string;
  amountCents: number;
  eligibleAmountCents: number;
  currency: string;
}

export interface FirestoreTaxReceiptSummaryRecord {
  id: string;
  receiptId: string;
  churchId: string;
  userId: string;
  donorLabel: string;
  donorAnonymous: boolean;
  churchReceiptVisible: boolean;
  donorLabelPublicSafe: boolean;
  receiptManagerSummarySafe: boolean;
  receiptManagerSummarySafeVersion: number;
  kind: 'annual' | 'unknown';
  status: TaxReceiptStatus;
  jurisdiction: string;
  receiptYear: number | null;
  receiptNumber: string;
  amountCents: number;
  eligibleAmountCents: number;
  currency: string;
  donationCount: number | null;
  includesPreviouslyReceipted: boolean;
  issuedAt: Date | null;
  emailSentAt: Date | null;
  emailFailedAt: Date | null;
  emailError: string;
  correctedReceipt: boolean;
  correctionRequired: boolean;
  correctionReason: string;
  voidedAt: Date | null;
  voidReason: string;
}

export async function getGivingStatus(givingId: string): Promise<GivingStatus> {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(givingId)) {
    return 'unknown';
  }

  try {
    const snap = await getDoc(doc(db, 'giving', givingId));
    if (!snap.exists()) {
      return 'unknown';
    }

    const status = snap.data().status;
    return status === 'creating' || status === 'pending' || status === 'completed' || status === 'failed' || status === 'refunded'
      ? status
      : 'unknown';
  } catch {
    return 'unknown';
  }
}

export async function getTaxReceipt(receiptId: string): Promise<FirestoreTaxReceiptRecord | null> {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(receiptId)) {
    return null;
  }

  const snap = await getDoc(doc(db, 'taxReceipts', receiptId));
  if (!snap.exists()) {
    return null;
  }

  return mapTaxReceiptRecord(snap);
}

function toDate(value: unknown): Date | null {
  return value instanceof Timestamp ? value.toDate() : null;
}

function toGivingStatus(value: unknown): GivingStatus {
  return value === 'creating' || value === 'pending' || value === 'completed' || value === 'failed' || value === 'refunded'
    ? value
    : 'unknown';
}

function toTaxReceiptStatus(value: unknown): TaxReceiptStatus {
  return value === 'not_configured'
    || value === 'ready'
    || value === 'issued'
    || value === 'sent'
    || value === 'error'
    || value === 'voided'
    ? value
    : 'unknown';
}

function toReceiptKind(value: unknown): FirestoreTaxReceiptRecord['kind'] {
  return value === 'single' || value === 'annual' ? value : 'unknown';
}

function mapTaxReceiptContribution(value: unknown): FirestoreTaxReceiptContribution | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }
  const data = value as Record<string, unknown>;
  const amountCents = typeof data.amountCents === 'number' ? data.amountCents : 0;
  if (amountCents <= 0) {
    return null;
  }
  return {
    dateLabel: typeof data.dateLabel === 'string' ? data.dateLabel : '',
    purpose: typeof data.purpose === 'string' ? data.purpose : 'General Fund',
    amountCents,
    eligibleAmountCents:
      typeof data.eligibleAmountCents === 'number' ? data.eligibleAmountCents : amountCents,
    currency: normalizedTaxReceiptCurrency(data.currency),
  };
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
    .filter(Boolean);
}

function looksLikeEmail(value: string): boolean {
  return /[^\s@]+@[^\s@]+\.[^\s@]{2,}/i.test(value.trim());
}

function publicDonorLabel(value: unknown): string {
  if (typeof value !== 'string') {
    return '';
  }
  const trimmed = value.trim();
  return trimmed && trimmed !== ANONYMOUS_DONOR_LABEL && !looksLikeEmail(trimmed) ? trimmed : '';
}

export function mapGivingRecord(d: { id: string; data: () => Record<string, unknown> }): FirestoreGivingRecord {
  const data = d.data();
  const amountCents =
    typeof data.amountCents === 'number'
      ? data.amountCents
      : Math.round((typeof data.amount === 'number' ? data.amount : 0) * 100);
  const anonymous = data.anonymous !== false;
  const donorName = anonymous ? '' : publicDonorLabel(data.donorName);
  const donorNamePublicSafe =
    anonymous === false
    && data.donorNamePublicSafe === true
    && donorName !== '';
  const receiptManagerGivingSafeVersion =
    donorNamePublicSafe && data.receiptManagerGivingSafeVersion === 1 ? 1 : 0;

  return {
    id: d.id,
    churchId: typeof data.churchId === 'string' ? data.churchId : '',
    churchName: typeof data.churchName === 'string' ? data.churchName : '',
    userId: typeof data.userId === 'string' ? data.userId : '',
    donorName,
    donorEmail: '',
    donorNamePublicSafe,
    churchReceiptVisible:
      data.churchReceiptVisible === true
      && donorNamePublicSafe
      && receiptManagerGivingSafeVersion === 1,
    receiptManagerGivingSafeVersion,
    amountCents,
    amount: typeof data.amount === 'number' ? data.amount : amountCents / 100,
    currency: normalizedTaxReceiptCurrency(data.currency),
    purpose: typeof data.purpose === 'string' ? data.purpose : 'General Fund',
    anonymous,
    status: toGivingStatus(data.status),
    stripeRefundStatus: typeof data.stripeRefundStatus === 'string' ? data.stripeRefundStatus : '',
    stripeAmountRefundedCents:
      typeof data.stripeAmountRefundedCents === 'number' ? data.stripeAmountRefundedCents : 0,
    createdAt: toDate(data.createdAt),
    completedAt: toDate(data.completedAt),
    taxReceiptId: typeof data.taxReceiptId === 'string' ? data.taxReceiptId : '',
    taxReceiptNumber: assignedTaxReceiptNumber(data.taxReceiptNumber),
    taxReceiptStatus: toTaxReceiptStatus(data.taxReceiptStatus),
    taxReceiptError: typeof data.taxReceiptError === 'string' ? data.taxReceiptError : '',
    taxReceiptEmailError: typeof data.taxReceiptEmailError === 'string' ? data.taxReceiptEmailError : '',
    taxReceiptCorrectionRequired: data.taxReceiptCorrectionRequired === true,
    taxReceiptCorrectionReason:
      typeof data.taxReceiptCorrectionReason === 'string' ? data.taxReceiptCorrectionReason : '',
  };
}

export function mapTaxReceiptRecord(d: { id: string; data: () => Record<string, unknown> }): FirestoreTaxReceiptRecord {
  const data = d.data();
  const amountCents = typeof data.amountCents === 'number' ? data.amountCents : 0;

  return {
    id: d.id,
    churchId: typeof data.churchId === 'string' ? data.churchId : '',
    churchName: typeof data.churchName === 'string' ? data.churchName : '',
    userId: typeof data.userId === 'string' ? data.userId : '',
    givingId: typeof data.givingId === 'string' ? data.givingId : '',
    givingIds: stringArray(data.givingIds),
    kind: toReceiptKind(data.kind),
    status: toTaxReceiptStatus(data.status),
    jurisdiction: typeof data.jurisdiction === 'string' ? data.jurisdiction : '',
    receiptNumber: assignedTaxReceiptNumber(data.receiptNumber),
    receiptYear: typeof data.receiptYear === 'number' ? data.receiptYear : null,
    organizationName: typeof data.organizationName === 'string' ? data.organizationName : '',
    organizationAddress: typeof data.organizationAddress === 'string' ? data.organizationAddress : '',
    organizationTaxId: typeof data.organizationTaxId === 'string' ? data.organizationTaxId : '',
    donorName: typeof data.donorName === 'string' ? data.donorName : '',
    donorAddress: typeof data.donorAddress === 'string' ? data.donorAddress : '',
    donorEmail: typeof data.donorEmail === 'string' ? data.donorEmail : '',
    amountCents,
    eligibleAmountCents:
      typeof data.eligibleAmountCents === 'number' ? data.eligibleAmountCents : amountCents,
    originalAmountCents:
      typeof data.originalAmountCents === 'number' ? data.originalAmountCents : null,
    refundedAmountCents:
      typeof data.refundedAmountCents === 'number' ? data.refundedAmountCents : null,
    currency: normalizedTaxReceiptCurrency(data.currency),
    purpose: typeof data.purpose === 'string' ? data.purpose : 'General Fund',
    donationCount: typeof data.donationCount === 'number' ? data.donationCount : null,
    contributions: Array.isArray(data.contributions)
      ? data.contributions
        .map(mapTaxReceiptContribution)
        .filter((entry): entry is FirestoreTaxReceiptContribution => entry !== null)
      : [],
    coveredPeriodLabel: typeof data.coveredPeriodLabel === 'string' ? data.coveredPeriodLabel : '',
    duplicateClaimWarning:
      typeof data.duplicateClaimWarning === 'string' ? data.duplicateClaimWarning : '',
    includesPreviouslyReceipted: data.includesPreviouslyReceipted === true,
    receivedAt: toDate(data.receivedAt),
    receivedDateLabel: typeof data.receivedDateLabel === 'string' ? data.receivedDateLabel : '',
    issuedAt: toDate(data.issuedAt),
    issuedDateLabel: typeof data.issuedDateLabel === 'string' ? data.issuedDateLabel : '',
    goodsServicesStatement:
      typeof data.goodsServicesStatement === 'string' ? data.goodsServicesStatement : '',
    pdfStoragePath: typeof data.pdfStoragePath === 'string' ? data.pdfStoragePath : '',
    pdfSha256: typeof data.pdfSha256 === 'string' ? data.pdfSha256 : '',
    pdfByteLength: typeof data.pdfByteLength === 'number' ? data.pdfByteLength : null,
    pdfRetainedAt: toDate(data.pdfRetainedAt),
    pdfRetentionStatus: typeof data.pdfRetentionStatus === 'string' ? data.pdfRetentionStatus : '',
    receiptIssueLocation:
      typeof data.receiptIssueLocation === 'string' ? data.receiptIssueLocation : '',
    authorizedSignerName:
      typeof data.authorizedSignerName === 'string' ? data.authorizedSignerName : '',
    authorizedSignerTitle:
      typeof data.authorizedSignerTitle === 'string' ? data.authorizedSignerTitle : '',
    secureElectronicSignatureConfigured: data.secureElectronicSignatureConfigured === true,
    receiptCopiesRetentionConfirmed: data.receiptCopiesRetentionConfirmed === true,
    emailSentAt: toDate(data.emailSentAt),
    emailFailedAt: toDate(data.emailFailedAt),
    emailError: typeof data.emailError === 'string' ? data.emailError : '',
    correctionRequired: data.correctionRequired === true,
    correctionReason: typeof data.correctionReason === 'string' ? data.correctionReason : '',
    correctionForReceiptId: typeof data.correctionForReceiptId === 'string' ? data.correctionForReceiptId : '',
    correctionSourceReason:
      typeof data.correctionSourceReason === 'string' ? data.correctionSourceReason : '',
    correctedAt: toDate(data.correctedAt),
    voidedAt: toDate(data.voidedAt),
    voidReason: typeof data.voidReason === 'string' ? data.voidReason : '',
  };
}

export function mapTaxReceiptSummaryRecord(
  d: { id: string; data: () => Record<string, unknown> }
): FirestoreTaxReceiptSummaryRecord {
  const data = d.data();
  const amountCents = typeof data.amountCents === 'number' ? data.amountCents : 0;
  const donorAnonymous = data.donorAnonymous !== false;
  const donorLabel = donorAnonymous ? '' : publicDonorLabel(data.donorLabel);
  const donorLabelPublicSafe =
    donorAnonymous === false
    && donorLabel !== ''
    && data.donorLabelPublicSafe === true;
  const receiptManagerSummarySafe =
    donorLabelPublicSafe
    && data.receiptManagerSummarySafe === true;
  const receiptManagerSummarySafeVersion =
    receiptManagerSummarySafe && data.receiptManagerSummarySafeVersion === 2 ? 2 : 0;

  return {
    id: d.id,
    receiptId: typeof data.receiptId === 'string' ? data.receiptId : d.id,
    churchId: typeof data.churchId === 'string' ? data.churchId : '',
    userId: typeof data.userId === 'string' ? data.userId : '',
    donorLabel,
    donorAnonymous,
    churchReceiptVisible:
      data.churchReceiptVisible === true
      && donorLabelPublicSafe
      && receiptManagerSummarySafe
      && receiptManagerSummarySafeVersion === 2,
    donorLabelPublicSafe,
    receiptManagerSummarySafe,
    receiptManagerSummarySafeVersion,
    kind: data.kind === 'annual' ? 'annual' : 'unknown',
    status: toTaxReceiptStatus(data.status),
    jurisdiction: typeof data.jurisdiction === 'string' ? data.jurisdiction : '',
    receiptYear: typeof data.receiptYear === 'number' ? data.receiptYear : null,
    receiptNumber: assignedTaxReceiptNumber(data.receiptNumber),
    amountCents,
    eligibleAmountCents:
      typeof data.eligibleAmountCents === 'number' ? data.eligibleAmountCents : amountCents,
    currency: normalizedTaxReceiptCurrency(data.currency),
    donationCount: typeof data.donationCount === 'number' ? data.donationCount : null,
    includesPreviouslyReceipted: data.includesPreviouslyReceipted === true,
    issuedAt: toDate(data.issuedAt),
    emailSentAt: toDate(data.emailSentAt),
    emailFailedAt: toDate(data.emailFailedAt),
    emailError: typeof data.emailError === 'string' ? data.emailError : '',
    correctedReceipt: data.correctedReceipt === true,
    correctionRequired: data.correctionRequired === true,
    correctionReason: typeof data.correctionReason === 'string' ? data.correctionReason : '',
    voidedAt: toDate(data.voidedAt),
    voidReason: typeof data.voidReason === 'string' ? data.voidReason : '',
  };
}

export function subscribeToUserGiving(
  uid: string,
  callback: (records: FirestoreGivingRecord[]) => void,
  onError?: (error: Error) => void
): () => void {
  const ref = query(
    collection(db, 'giving'),
    where('userId', '==', uid),
    orderBy('createdAt', 'desc'),
    limit(50)
  );
  return onSnapshot(
    ref,
    (snap) => {
      callback(snap.docs.map(mapGivingRecord));
    },
    (error) => {
      onError?.(error);
    }
  );
}

export function subscribeToUserTaxReceipts(
  uid: string,
  callback: (records: FirestoreTaxReceiptRecord[]) => void,
  onError?: (error: Error) => void
): () => void {
  const ref = query(
    collection(db, 'taxReceipts'),
    where('userId', '==', uid),
    orderBy('issuedAt', 'desc'),
    limit(50)
  );
  return onSnapshot(
    ref,
    (snap) => {
      callback(snap.docs.map(mapTaxReceiptRecord));
    },
    (error) => {
      onError?.(error);
    }
  );
}

export function subscribeToUserAnnualTaxReceiptSummaries(
  uid: string,
  callback: (records: FirestoreTaxReceiptSummaryRecord[]) => void,
  onError?: (error: Error) => void
): () => void {
  const ref = query(
    collection(db, 'taxReceiptSummaries'),
    where('userId', '==', uid),
    orderBy('issuedAt', 'desc'),
    limit(50)
  );
  return onSnapshot(
    ref,
    (snap) => {
      callback(snap.docs.map(mapTaxReceiptSummaryRecord).filter((record) => record.kind === 'annual'));
    },
    (error) => {
      onError?.(error);
    }
  );
}

export function subscribeToChurchGivingForReceipts(
  churchId: string,
  callback: (records: FirestoreGivingRecord[]) => void,
  onError?: (error: Error) => void
): () => void {
  const ref = query(
    collection(db, 'giving'),
    where('churchId', '==', churchId),
    where('anonymous', '==', false),
    where('churchReceiptVisible', '==', true),
    where('donorEmail', '==', ''),
    where('donorNamePublicSafe', '==', true),
    where('receiptManagerGivingSafeVersion', '==', 1),
    where('status', 'in', ['completed', 'refunded']),
    orderBy('createdAt', 'desc'),
    limit(100)
  );
  return onSnapshot(
    ref,
    (snap) => {
      callback(snap.docs
        .map(mapGivingRecord)
        .filter((record) => (
          record.anonymous === false
          && record.churchReceiptVisible === true
          && record.donorEmail === ''
          && record.donorNamePublicSafe === true
          && record.receiptManagerGivingSafeVersion === 1
          && record.donorName !== ''
          && (record.status === 'completed' || record.status === 'refunded')
        )));
    },
    (error) => {
      onError?.(error);
    }
  );
}

export function subscribeToChurchAnnualTaxReceiptSummaries(
  churchId: string,
  callback: (records: FirestoreTaxReceiptSummaryRecord[]) => void,
  onError?: (error: Error) => void
): () => void {
  const ref = query(
    collection(db, 'taxReceiptSummaries'),
    where('churchId', '==', churchId),
    where('kind', '==', 'annual'),
    where('donorAnonymous', '==', false),
    where('churchReceiptVisible', '==', true),
    where('donorLabelPublicSafe', '==', true),
    where('receiptManagerSummarySafe', '==', true),
    where('receiptManagerSummarySafeVersion', '==', 2),
    orderBy('issuedAt', 'desc'),
    limit(500)
  );
  return onSnapshot(
    ref,
    (snap) => {
      callback(snap.docs
        .map(mapTaxReceiptSummaryRecord)
        .filter((record) => (
          record.kind === 'annual'
          && record.donorAnonymous === false
          && record.churchReceiptVisible === true
          && record.donorLabelPublicSafe === true
          && record.donorLabel !== ''
          && record.receiptManagerSummarySafe === true
          && record.receiptManagerSummarySafeVersion === 2
        )));
    },
    (error) => {
      onError?.(error);
    }
  );
}
