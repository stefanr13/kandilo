import { FieldValue } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import { db } from '../../shared/firebase';
import { GENERIC_TAX_RECEIPT_AUDIT_CODE, publicTaxReceiptAuditCode } from '../../shared/taxReceiptAudit';
import { TAX_RECEIPT_PDF_RETENTION_FAILED_CODE } from '../../shared/taxReceiptRetention';
import {
  SAFE_ERROR_DETAIL_CODE_PATTERN,
  STRIPE_PARTIAL_REFUND_REVIEW_REASON,
  TAX_RECEIPT_DONOR_PROFILE_INCOMPLETE_CODE,
  TAX_RECEIPT_ISSUE_FAILED_CODE,
  TAX_RECEIPT_MISSING_EMAIL_OR_AMOUNT_CODE,
  TAX_RECEIPT_MISSING_RECEIPT_NUMBER_CODE,
  TAX_RECEIPT_SUMMARIES_COLLECTION,
  TAX_RECEIPT_UNSUPPORTED_JURISDICTION_CODE,
} from './constants';
import {
  annualTaxReceiptDocId,
  annualGivingAmountSummary,
  annualGivingIncludesPreviouslyReceiptedEvidence,
  annualPublicDonorIdentity,
  annualReceiptSummaryFromReceipt,
  annualReceiptSummaryPrivacyOverridesFromGivingRecords,
  assertAnnualGivingSingleCurrency,
  correctedAnnualTaxReceiptDocId,
  logTaxReceiptEvent,
  optionalTrimmedString,
  AnnualBatchReviewSkip,
} from './helpers';
import {
  loadAnnualGivingDocs,
  validAnnualGivingFromSnaps,
} from './annual-giving';

export function safeHttpsErrorDetailCode(error: unknown): string {
  if (!(error instanceof HttpsError)) {
    return '';
  }
  const details = (error as HttpsError & { details?: unknown }).details;
  if (typeof details !== 'object' || details === null || Array.isArray(details)) {
    return '';
  }
  const rawCode = (details as Record<string, unknown>).errorCode;
  if (typeof rawCode !== 'string') {
    return '';
  }
  const code = rawCode.trim();
  return code.length <= 120 && SAFE_ERROR_DETAIL_CODE_PATTERN.test(code) ? code : '';
}

export function failureCodeForAnnualReceipt(error: unknown): string {
  const detailCode = safeHttpsErrorDetailCode(error);
  if (detailCode) {
    return publicTaxReceiptAuditCode(detailCode) || GENERIC_TAX_RECEIPT_AUDIT_CODE;
  }
  if (error instanceof HttpsError) {
    return publicTaxReceiptAuditCode(error.code) || GENERIC_TAX_RECEIPT_AUDIT_CODE;
  }
  return GENERIC_TAX_RECEIPT_AUDIT_CODE;
}

export function taxReceiptPreparationFailedHttpsError(message: string): HttpsError {
  return new HttpsError(
    'internal',
    message,
    { errorCode: 'tax_receipt_preparation_failed' }
  );
}

export function taxReceiptEmailDeliveryFailureCode(error: unknown): string {
  const detailCode = safeHttpsErrorDetailCode(error);
  if (!detailCode) {
    return '';
  }

  if ([
    TAX_RECEIPT_MISSING_RECEIPT_NUMBER_CODE,
    TAX_RECEIPT_PDF_RETENTION_FAILED_CODE,
    TAX_RECEIPT_UNSUPPORTED_JURISDICTION_CODE,
    'resend_api_key_invalid_format',
    'resend_api_key_missing',
    TAX_RECEIPT_MISSING_EMAIL_OR_AMOUNT_CODE,
    'tax_receipt_pdf_failed',
    'tax_receipt_preparation_failed',
    'tax_receipt_provider_rejected',
    'tax_receipt_send_failed',
  ].includes(detailCode)) {
    return publicTaxReceiptAuditCode(detailCode) || TAX_RECEIPT_ISSUE_FAILED_CODE;
  }

  return '';
}

function taxReceiptIssueFailureGivingUpdate(
  giving: FirebaseFirestore.DocumentData,
  error: unknown
): Record<string, unknown> | null {
  const detailCode = safeHttpsErrorDetailCode(error);
  if (![
    TAX_RECEIPT_DONOR_PROFILE_INCOMPLETE_CODE,
    TAX_RECEIPT_MISSING_EMAIL_OR_AMOUNT_CODE,
  ].includes(detailCode)) {
    return null;
  }

  const update: Record<string, unknown> = {
    taxReceiptError: detailCode,
    taxReceiptEmailError: FieldValue.delete(),
    updatedAt: FieldValue.serverTimestamp(),
  };
  const currentStatus = optionalTrimmedString(giving.taxReceiptStatus, 20);
  if (!currentStatus || currentStatus === 'error' || currentStatus === 'not_configured') {
    update.taxReceiptStatus = 'ready';
  }
  return update;
}

export async function persistTaxReceiptIssueFailureForGiving(
  givingRef: FirebaseFirestore.DocumentReference,
  giving: FirebaseFirestore.DocumentData,
  error: unknown
): Promise<void> {
  const update = taxReceiptIssueFailureGivingUpdate(giving, error);
  if (!update) {
    return;
  }
  await givingRef.update(update).catch(() => undefined);
}

export async function persistAnnualTaxReceiptIssueFailureSummary(
  churchId: string,
  userId: string,
  year: number,
  kind: 'annual' | 'correctedAnnual',
  error: unknown
): Promise<void> {
  const detailCode = safeHttpsErrorDetailCode(error);
  if (![
    TAX_RECEIPT_DONOR_PROFILE_INCOMPLETE_CODE,
    TAX_RECEIPT_MISSING_EMAIL_OR_AMOUNT_CODE,
  ].includes(detailCode)) {
    return;
  }

  try {
    const churchRef = db.collection('churches').doc(churchId);
    const userRef = db.collection('users').doc(userId);
    const memberRef = churchRef.collection('members').doc(userId);
    const [churchSnap, userSnap, memberSnap] = await Promise.all([
      churchRef.get(),
      userRef.get(),
      memberRef.get(),
    ]);
    if (!churchSnap.exists) {
      return;
    }

    const church = churchSnap.data() ?? {};
    const annualGivingDocs = await loadAnnualGivingDocs(churchId, userId, year, church.timezone);
    const validGiving = validAnnualGivingFromSnaps(annualGivingDocs, churchId, userId, year, church.timezone);
    if (validGiving.length === 0) {
      return;
    }

    const amounts = annualGivingAmountSummary(validGiving);
    const correctedAnnual = kind === 'correctedAnnual';
    if (correctedAnnual && amounts.partialRefundGivingIds.length === 0) {
      return;
    }

    const summaryDocId = correctedAnnual
      ? correctedAnnualTaxReceiptDocId(churchId, userId, year, amounts.correctionDigestInput)
      : annualTaxReceiptDocId(churchId, userId, year);
    const currency = assertAnnualGivingSingleCurrency(validGiving);
    const user = userSnap.data() ?? {};
    const member = memberSnap.data() ?? {};
    const publicDonorIdentity = annualPublicDonorIdentity(validGiving, user, member);
    const now = FieldValue.serverTimestamp();
    const includesPreviouslyReceipted =
      await annualGivingIncludesPreviouslyReceiptedEvidence(validGiving, churchId, userId);
    const receiptLike = {
      churchId,
      userId,
      kind: 'annual',
      status: 'error',
      receiptYear: year,
      annualYear: year,
      receiptNumber: '',
      amountCents: correctedAnnual ? amounts.eligibleAmountCents : amounts.amountCents,
      eligibleAmountCents: amounts.eligibleAmountCents,
      currency,
      donationCount: validGiving.length,
      givingIds: amounts.givingIds,
      donorLabel: publicDonorIdentity.donorLabel,
      donorAnonymous: publicDonorIdentity.donorAnonymous,
      includesPreviouslyReceipted,
      issuedAt: now,
      emailFailedAt: now,
      emailError: detailCode,
      correctionRequired: correctedAnnual,
      correctionReason: correctedAnnual ? STRIPE_PARTIAL_REFUND_REVIEW_REASON : '',
    };
    const summary = annualReceiptSummaryFromReceipt(summaryDocId, receiptLike, {
      ...annualReceiptSummaryPrivacyOverridesFromGivingRecords(validGiving, receiptLike),
      receiptId: '',
      receiptNumber: '',
      emailSentAt: null,
      updatedAt: now,
      createdAt: now,
    });
    if (!summary) {
      return;
    }

    await db.collection(TAX_RECEIPT_SUMMARIES_COLLECTION).doc(summaryDocId).set(summary, { merge: true });
  } catch {
    // Preserve the original callable failure; this mirror is retry/help text only.
  }
}

export async function logAnnualBatchReviewSkips(
  reviewSkips: AnnualBatchReviewSkip[],
  input: {
    actorUid: string;
    churchId: string;
    year: number;
    reasonCode?: string;
  }
): Promise<void> {
  await Promise.all(reviewSkips.map((skip) => logTaxReceiptEvent({
    action: 'annual_batch_item_failed',
    actorUid: input.actorUid,
    churchId: input.churchId,
    userId: skip.userId,
    kind: 'annual',
    receiptYear: input.year,
    errorCode: skip.code,
    reasonCode: input.reasonCode,
  })));
}
