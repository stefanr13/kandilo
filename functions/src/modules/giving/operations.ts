import { FieldPath, FieldValue, Timestamp } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { getResend, resendConfigurationErrorCode } from '../../shared/clients';
import { db } from '../../shared/firebase';
import { SCHEDULE_REGION } from '../../shared/regions';
import { getPrimaryVerifiedEmailsForUids } from '../../shared/security';
import { sanitizedErrorContext } from '../../shared/logging';
import { renderTaxReceiptEmail } from '../../shared/emailTemplates';
import { renderTaxReceiptPdfAttachment, TAX_RECEIPT_PDF_TEMPLATE_VERSION, UNVERSIONED_TAX_RECEIPT_PDF_TEMPLATE_VERSION, TaxReceiptPdfAttachment, TaxReceiptPdfContribution, TaxReceiptPdfInput } from '../../shared/taxReceiptPdf';
import { loadRetainedTaxReceiptPdfAttachment, retainTaxReceiptPdfAttachment, TAX_RECEIPT_PDF_RETENTION_FAILED_CODE } from '../../shared/taxReceiptRetention';
import {
  ANNUAL_BULK_DONOR_LIMIT,
  ANNUAL_BULK_DONOR_SOURCE_PAGE_SIZE,
  ANNUAL_BULK_DONOR_SOURCE_SCAN_LIMIT,
  ANNUAL_RECEIPT_GIVING_CHANGED_REVIEW_CODE,
  ANNUAL_RECEIPT_MIXED_CURRENCY_REVIEW_CODE,
  ANNUAL_TAX_RECEIPT_WARNING,
  ANONYMOUS_DONOR_LABEL,
  CHURCH_TAX_RECEIPTS_NOT_ENABLED_CODE,
  CORRECTED_TAX_RECEIPT_NOTE,
  DEFAULT_TAX_GOODS_SERVICES_STATEMENT,
  PREVIOUSLY_RECEIPTED_ACK_REQUIRED_CODE,
  RECEIPT_CLAIM_TIMEOUT_MS,
  RECEIPT_MANAGER_GIVING_SAFE_VERSION,
  SCHEDULED_ANNUAL_CHURCH_PAGE_SIZE,
  SCHEDULED_ANNUAL_CHURCH_SCAN_LIMIT,
  SCHEDULED_ANNUAL_DONOR_LIMIT_PER_CHURCH,
  SCHEDULED_ANNUAL_RECEIPT_ACTOR_UID,
  SINGLE_RECEIPT_GIVING_CHANGED_REVIEW_CODE,
  SINGLE_RECEIPT_INCLUDED_IN_ANNUAL_CODE,
  STRIPE_FULL_REFUND_ANNUAL_REISSUE_REASON,
  STRIPE_FULL_REFUND_VOID_REASON,
  STRIPE_PARTIAL_REFUND_CORRECTED_REASON,
  STRIPE_PARTIAL_REFUND_REVIEW_REASON,
  TAX_RECEIPTS_COLLECTION,
  TAX_RECEIPT_COUNTERS_COLLECTION,
  TAX_RECEIPT_EVENTS_COLLECTION,
  TAX_RECEIPT_ID_PATTERN,
  TAX_RECEIPT_INVALID_CURRENCY_CODE,
  TAX_RECEIPT_MISSING_EMAIL_OR_AMOUNT_CODE,
  TAX_RECEIPT_MISSING_RECEIPT_NUMBER_CODE,
  TAX_RECEIPT_SUMMARIES_COLLECTION,
  TAX_RECEIPT_UNSUPPORTED_JURISDICTION_CODE,
} from './constants';
import {
  loadAnnualGivingDocs,
  validAnnualGivingFromSnaps,
} from './annual-giving';
import {
  failureCodeForAnnualReceipt,
  persistAnnualTaxReceiptIssueFailureSummary,
  safeHttpsErrorDetailCode,
  taxReceiptPreparationFailedHttpsError,
} from './operation-errors';
import {
  AnnualBatchDonorEntry,
  AnnualBatchDonorSelection,
  AnnualGivingAmountSummary,
  AnnualReceiptSummaryPrivacyOverrides,
  ReceiptCoveredGivingRefundDetails,
  ReceiptCoveredGivingRefundState,
  TaxReceiptIssueResult,
  annualContributionRecords,
  annualContributionRecordsMatchReceipt,
  annualGivingAmountSummary,
  annualGivingIncludesPreviouslyReceiptedEvidence,
  annualGivingIncludesPreviouslyReceiptedEvidenceInTransaction,
  annualPeriodLabel,
  annualPublicDonorIdentity,
  annualReceiptBlocksSingleReceipt,
  annualReceiptSummaryDonorOnlyPrivacyOverrides,
  annualReceiptSummaryFromReceipt,
  annualReceiptSummaryPrivacyOverridesFromCoveredGivingDocs,
  annualReceiptSummaryPrivacyOverridesFromCoveredGivingRecords,
  annualReceiptSummaryPrivacyOverridesFromGivingRecords,
  annualTaxReceiptDocId,
  annualReceiptYear,
  assertActiveChurchForTaxReceiptIssuance,
  assertAnnualGivingSingleCurrency,
  assertAnnualReceiptYearClosed,
  assertGivingCurrencyForTaxReceipt,
  assertStoredOfficialReceiptNumber,
  broadYearWindow,
  correctedAnnualTaxReceiptDocId,
  correctedTaxReceiptDocId,
  datePartsForReceipt,
  formatCurrency,
  givingIdentityUpdateForReceipt,
  givingIsExplicitlyNonAnonymous,
  givingIsSafeForTargetedReceiptManagerAction,
  isFullyRefundedGiving,
  isPartiallyRefundedGiving,
  isValidAnnualFullRefundReissueReceipt,
  isValidAnnualPartialRefundCorrectionReceipt,
  isValidExistingSingleTaxReceiptForGiving,
  isValidPartialRefundCorrectionReceipt,
  getDocumentSnapshotsById,
  logTaxReceiptEvent,
  newTaxReceiptEmailSendAttemptId,
  nextReceiptSequenceFromCounter,
  normalizedTaxReceiptCurrency,
  optionalTrimmedString,
  parseTaxReceiptSettings,
  partialRefundAmounts,
  publicDonorLabelCandidate,
  publicGivingDonorLabel,
  publicTaxReceiptNumber,
  receiptCounterDocId,
  receiptCoveredGivingIds,
  receiptNumberFor,
  reissuedAnnualTaxReceiptDocId,
  requireAnnualPreviouslyReceiptedAcknowledgement,
  requiredDonorTaxReceiptProfile,
  safeTaxReceiptDocId,
  sameStringSet,
  taxReceiptAlreadyEmailed,
  taxReceiptEmailIdempotencyKey,
  taxReceiptEmailSendAttemptId,
  taxReceiptEmailSendClaimIsFresh,
  taxReceiptEventData,
  taxReceiptRecordIsCorrected,
  timestampOrNow,
  unsupportedOfficialReceiptDeliveryJurisdictionForReceipt,
  unsupportedOfficialReceiptDeliveryMessage,
  upsertAnnualReceiptSummary,
  validExistingAnnualTaxReceipt,
} from './helpers';

export {
  failureCodeForAnnualReceipt,
  logAnnualBatchReviewSkips,
  persistAnnualTaxReceiptIssueFailureSummary,
  persistTaxReceiptIssueFailureForGiving,
  safeHttpsErrorDetailCode,
  taxReceiptEmailDeliveryFailureCode,
  taxReceiptPreparationFailedHttpsError,
} from './operation-errors';

export async function issueTaxReceiptForGiving(
  givingRef: FirebaseFirestore.DocumentReference,
  issuedBy: string
): Promise<TaxReceiptIssueResult> {
  let issueResult: TaxReceiptIssueResult | null = null;
  const issueState = {
    blockedByRefundState: 'none' as ReceiptCoveredGivingRefundState,
  };
  const initialGivingSnap = await givingRef.get();
  const initialUserId = optionalTrimmedString(initialGivingSnap.data()?.userId, 128);
  const authEmail =
    initialUserId ? (await getPrimaryVerifiedEmailsForUids([initialUserId]))[0] ?? '' : '';

  await db.runTransaction(async (tx) => {
    const givingSnap = await tx.get(givingRef);
    if (!givingSnap.exists) {
      throw new HttpsError('not-found', 'Donation not found.');
    }

    const giving = givingSnap.data() ?? {};
    const churchId = typeof giving.churchId === 'string' ? giving.churchId : '';
    const userId = typeof giving.userId === 'string' ? giving.userId : '';
    if (!churchId || !userId) {
      throw new HttpsError('failed-precondition', 'Donation metadata is incomplete.');
    }

    const receiptRef = db.collection(TAX_RECEIPTS_COLLECTION).doc(safeTaxReceiptDocId(givingRef.id));
    if (isFullyRefundedGiving(giving)) {
      const existingReceiptSnap = await tx.get(receiptRef);
      if (existingReceiptSnap.exists) {
        const refundDetails: ReceiptCoveredGivingRefundDetails = {
          state: 'full',
          givingDocs: [{
            id: givingRef.id,
            ref: givingRef,
            snap: givingSnap,
            data: giving,
          }],
        };
        issueState.blockedByRefundState = applyReceiptCoveredGivingRefundStateInTransaction(
          tx,
          receiptRef,
          existingReceiptSnap,
          existingReceiptSnap.data() ?? {},
          refundDetails,
          FieldValue.serverTimestamp()
        );
        return;
      }
      throw new HttpsError(
        'failed-precondition',
        'This donation has been fully refunded and cannot receive a tax receipt.'
      );
    }
    if (giving.status !== 'completed') {
      throw new HttpsError('failed-precondition', 'A tax receipt can only be issued for completed donations.');
    }

    const partialAmounts = partialRefundAmounts(giving);
    if (partialAmounts) {
      const correctedReceiptId = optionalTrimmedString(giving.taxReceiptId, 128);
      if (correctedReceiptId) {
        const correctedReceiptRef = db.collection(TAX_RECEIPTS_COLLECTION).doc(correctedReceiptId);
        const correctedReceiptSnap = await tx.get(correctedReceiptRef);
        const correctedReceipt = correctedReceiptSnap.data() ?? {};
        if (
          correctedReceiptSnap.exists
          && isValidPartialRefundCorrectionReceipt(correctedReceipt, givingRef.id, giving, partialAmounts)
        ) {
          issueResult = {
            receiptId: correctedReceiptRef.id,
            receiptNumber: publicTaxReceiptNumber(correctedReceipt.receiptNumber),
            created: false,
          };
          return;
        }
      }
      const existingReceiptId = optionalTrimmedString(giving.taxReceiptId, 128) || safeTaxReceiptDocId(givingRef.id);
      const staleReceiptRef = db.collection(TAX_RECEIPTS_COLLECTION).doc(existingReceiptId);
      const staleReceiptSnap = await tx.get(staleReceiptRef);
      if (staleReceiptSnap.exists) {
        const refundDetails: ReceiptCoveredGivingRefundDetails = {
          state: 'partial',
          givingDocs: [{
            id: givingRef.id,
            ref: givingRef,
            snap: givingSnap,
            data: giving,
          }],
        };
        issueState.blockedByRefundState = applyReceiptCoveredGivingRefundStateInTransaction(
          tx,
          staleReceiptRef,
          staleReceiptSnap,
          staleReceiptSnap.data() ?? {},
          refundDetails,
          FieldValue.serverTimestamp()
        );
        return;
      }
      throw new HttpsError(
        'failed-precondition',
        'This donation has been partially refunded and needs manual receipt review before a tax receipt can be issued.',
        { errorCode: STRIPE_PARTIAL_REFUND_REVIEW_REASON }
      );
    }

    const existingReceiptSnap = await tx.get(receiptRef);
    if (existingReceiptSnap.exists) {
      const existing = existingReceiptSnap.data() ?? {};
      if (!isValidExistingSingleTaxReceiptForGiving(existing, givingRef.id, giving)) {
        throw new HttpsError('failed-precondition', 'The existing tax receipt requires review.');
      }
      issueResult = {
        receiptId: receiptRef.id,
        receiptNumber: publicTaxReceiptNumber(existing.receiptNumber),
        created: false,
        emailSent: taxReceiptAlreadyEmailed(existing),
      };
      return;
    }

    const annualReceiptSnaps = await annualTaxReceiptSnapsForGivingIdsInTransaction(tx, [givingRef.id]);
    for (const annualReceiptSnap of annualReceiptSnaps.values()) {
      const annualReceipt = annualReceiptSnap.data() ?? {};
      if (annualReceiptBlocksSingleReceipt(annualReceipt, churchId, userId, givingRef.id)) {
        throw new HttpsError(
          'failed-precondition',
          'This donation is already included in an annual tax receipt. Use the annual receipt instead of issuing a separate single-donation receipt.',
          { errorCode: SINGLE_RECEIPT_INCLUDED_IN_ANNUAL_CODE }
        );
      }
    }

    const churchRef = db.collection('churches').doc(churchId);
    const userRef = db.collection('users').doc(userId);
    const memberRef = churchRef.collection('members').doc(userId);
    const [churchSnap, userSnap, memberSnap] = await Promise.all([
      tx.get(churchRef),
      tx.get(userRef),
      tx.get(memberRef),
    ]);
    if (!churchSnap.exists) {
      throw new HttpsError('not-found', 'Church not found.');
    }

    const church = churchSnap.data() ?? {};
    assertActiveChurchForTaxReceiptIssuance(church);
    const settings = parseTaxReceiptSettings(church);
    if (!settings) {
      throw new HttpsError(
        'failed-precondition',
        'Tax receipts are not enabled for this church.',
        { errorCode: CHURCH_TAX_RECEIPTS_NOT_ENABLED_CODE }
      );
    }

    const amountCents =
      typeof giving.amountCents === 'number'
        ? giving.amountCents
        : Math.round((typeof giving.amount === 'number' ? giving.amount : 0) * 100);
    if (!Number.isInteger(amountCents) || amountCents <= 0) {
      throw new HttpsError('failed-precondition', 'Donation amount is invalid.');
    }

    const currency = assertGivingCurrencyForTaxReceipt(giving);
    const receivedAt = timestampOrNow(giving.completedAt ?? giving.createdAt);
    const issuedAt = Timestamp.now();
    const receivedDate = datePartsForReceipt(receivedAt, church.timezone);
    const issuedDate = datePartsForReceipt(issuedAt, church.timezone);
    const counterRef = db
      .collection(TAX_RECEIPT_COUNTERS_COLLECTION)
      .doc(receiptCounterDocId(churchId, receivedDate.year));
    const counterSnap = await tx.get(counterRef);
    const nextSequence = nextReceiptSequenceFromCounter(counterSnap);
    const receiptNumber = receiptNumberFor(settings, churchId, receivedDate.year, nextSequence);
    const user = userSnap.data() ?? {};
    const member = memberSnap.data() ?? {};
    const givingDonorName = publicGivingDonorLabel(giving, user, member);
    const donorProfile = requiredDonorTaxReceiptProfile(user);
    const donorEmail = initialUserId === userId ? authEmail : '';
    if (!donorEmail) {
      throw new HttpsError(
        'failed-precondition',
        'The donor needs a verified email address before a tax receipt can be issued.',
        { errorCode: TAX_RECEIPT_MISSING_EMAIL_OR_AMOUNT_CODE }
      );
    }

    const churchName =
      optionalTrimmedString(giving.churchName, 200)
      || optionalTrimmedString(church.name, 200)
      || settings.organizationName;
    const purpose = optionalTrimmedString(giving.purpose, 200) || 'General Fund';
    const now = FieldValue.serverTimestamp();
    const receiptData = {
      churchId,
      churchName,
      userId,
      givingId: givingRef.id,
      kind: 'single',
      status: 'issued',
      pdfTemplateVersion: TAX_RECEIPT_PDF_TEMPLATE_VERSION,
      jurisdiction: settings.jurisdiction,
      receiptNumber,
      receiptYear: receivedDate.year,
      organizationName: settings.organizationName,
      organizationAddress: settings.organizationAddress,
      organizationTaxId: settings.taxId,
      donorName: donorProfile.donorName,
      donorAddress: donorProfile.donorAddress,
      donorEmail,
      amountCents,
      eligibleAmountCents: amountCents,
      currency,
      purpose,
      receivedAt,
      receivedDateLabel: receivedDate.label,
      issuedAt: now,
      issuedDateLabel: issuedDate.label,
      issuedBy,
      goodsServicesStatement: settings.goodsServicesStatement,
      receiptIssueLocation: settings.receiptIssueLocation,
      authorizedSignerName: settings.authorizedSignerName,
      authorizedSignerTitle: settings.authorizedSignerTitle,
      secureElectronicSignatureConfigured: settings.secureElectronicSignatureConfigured,
      receiptCopiesRetentionConfirmed: settings.receiptCopiesRetentionConfirmed,
      createdAt: now,
      updatedAt: now,
    };

    tx.set(receiptRef, receiptData);
    const event = taxReceiptEventData({
      action: 'issued',
      actorUid: issuedBy,
      receiptId: receiptRef.id,
      receipt: receiptData,
    });
    if (event) {
      tx.set(db.collection(TAX_RECEIPT_EVENTS_COLLECTION).doc(), event);
    }
    tx.set(
      counterRef,
      {
        churchId,
        year: receivedDate.year,
        lastSequence: nextSequence,
        updatedAt: now,
      },
      { merge: true }
    );
    tx.update(givingRef, {
      ...givingIdentityUpdateForReceipt(giving, givingDonorName),
      taxReceiptId: receiptRef.id,
      taxReceiptNumber: receiptNumber,
      taxReceiptStatus: 'issued',
      taxReceiptIssuedAt: now,
      taxReceiptError: FieldValue.delete(),
      updatedAt: now,
    });

    issueResult = {
      receiptId: receiptRef.id,
      receiptNumber,
      created: true,
    };
  });

  if (!issueResult) {
    if (issueState.blockedByRefundState === 'full') {
      throw new HttpsError(
        'failed-precondition',
        'This tax receipt has been voided because the donation was fully refunded.'
      );
    }
    if (issueState.blockedByRefundState === 'partial') {
      throw new HttpsError(
        'failed-precondition',
        'This tax receipt requires review because the donation was partially refunded.',
        { errorCode: STRIPE_PARTIAL_REFUND_REVIEW_REASON }
      );
    }
    throw new HttpsError('internal', 'Unable to issue tax receipt.');
  }
  return issueResult;
}

export async function issueCorrectedTaxReceiptForGiving(
  givingRef: FirebaseFirestore.DocumentReference,
  issuedBy: string
): Promise<TaxReceiptIssueResult> {
  let issueResult: TaxReceiptIssueResult | null = null;
  const initialGivingSnap = await givingRef.get();
  const initialUserId = optionalTrimmedString(initialGivingSnap.data()?.userId, 128);
  const authEmail =
    initialUserId ? (await getPrimaryVerifiedEmailsForUids([initialUserId]))[0] ?? '' : '';

  await db.runTransaction(async (tx) => {
    const givingSnap = await tx.get(givingRef);
    if (!givingSnap.exists) {
      throw new HttpsError('not-found', 'Donation not found.');
    }

    const giving = givingSnap.data() ?? {};
    if (giving.status !== 'completed') {
      throw new HttpsError('failed-precondition', 'Corrected tax receipts can only be issued for completed donations.');
    }
    const amounts = partialRefundAmounts(giving);
    if (!amounts) {
      throw new HttpsError(
        'failed-precondition',
        'Corrected tax receipts currently require a partial Stripe refund on the donation.'
      );
    }

    const churchId = typeof giving.churchId === 'string' ? giving.churchId : '';
    const userId = typeof giving.userId === 'string' ? giving.userId : '';
    if (!churchId || !userId) {
      throw new HttpsError('failed-precondition', 'Donation metadata is incomplete.');
    }

    const correctedReceiptRef = db
      .collection(TAX_RECEIPTS_COLLECTION)
      .doc(correctedTaxReceiptDocId(givingRef.id, amounts.refundedAmountCents));
    const correctedReceiptSnap = await tx.get(correctedReceiptRef);
    if (correctedReceiptSnap.exists) {
      const existing = correctedReceiptSnap.data() ?? {};
      if (!isValidPartialRefundCorrectionReceipt(existing, givingRef.id, giving, amounts)) {
        throw new HttpsError('failed-precondition', 'The existing corrected tax receipt requires review.');
      }
      tx.update(givingRef, {
        taxReceiptId: correctedReceiptRef.id,
        taxReceiptNumber: publicTaxReceiptNumber(existing.receiptNumber),
        taxReceiptStatus: optionalTrimmedString(existing.status, 20) || 'issued',
        taxReceiptCorrectionRequired: FieldValue.delete(),
        taxReceiptCorrectionReason: FieldValue.delete(),
        taxReceiptCorrectionMarkedAt: FieldValue.delete(),
        taxReceiptError: FieldValue.delete(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      issueResult = {
        receiptId: correctedReceiptRef.id,
        receiptNumber: publicTaxReceiptNumber(existing.receiptNumber),
        created: false,
      };
      return;
    }

    const churchRef = db.collection('churches').doc(churchId);
    const userRef = db.collection('users').doc(userId);
    const memberRef = churchRef.collection('members').doc(userId);
    const originalReceiptId =
      optionalTrimmedString(giving.taxReceiptId, 128)
      || (TAX_RECEIPT_ID_PATTERN.test(givingRef.id) ? givingRef.id : '');
    const originalReceiptRef = originalReceiptId
      ? db.collection(TAX_RECEIPTS_COLLECTION).doc(originalReceiptId)
      : null;
    const [churchSnap, userSnap, memberSnap, originalReceiptSnap] = await Promise.all([
      tx.get(churchRef),
      tx.get(userRef),
      tx.get(memberRef),
      originalReceiptRef ? tx.get(originalReceiptRef) : Promise.resolve(null),
    ]);
    if (!churchSnap.exists) {
      throw new HttpsError('not-found', 'Church not found.');
    }

    const church = churchSnap.data() ?? {};
    assertActiveChurchForTaxReceiptIssuance(church);
    const settings = parseTaxReceiptSettings(church);
    if (!settings) {
      throw new HttpsError(
        'failed-precondition',
        'Tax receipts are not enabled for this church.',
        { errorCode: CHURCH_TAX_RECEIPTS_NOT_ENABLED_CODE }
      );
    }

    const currency = assertGivingCurrencyForTaxReceipt(giving);
    const receivedAt = timestampOrNow(giving.completedAt ?? giving.createdAt);
    const issuedAt = Timestamp.now();
    const receivedDate = datePartsForReceipt(receivedAt, church.timezone);
    const issuedDate = datePartsForReceipt(issuedAt, church.timezone);
    const counterRef = db
      .collection(TAX_RECEIPT_COUNTERS_COLLECTION)
      .doc(receiptCounterDocId(churchId, receivedDate.year));
    const counterSnap = await tx.get(counterRef);
    const nextSequence = nextReceiptSequenceFromCounter(counterSnap);
    const receiptNumber = receiptNumberFor(settings, churchId, receivedDate.year, nextSequence);
    const user = userSnap.data() ?? {};
    const member = memberSnap.data() ?? {};
    const givingDonorName = publicGivingDonorLabel(giving, user, member);
    const donorProfile = requiredDonorTaxReceiptProfile(user);
    const donorEmail = initialUserId === userId ? authEmail : '';
    if (!donorEmail) {
      throw new HttpsError(
        'failed-precondition',
        'The donor needs a verified email address before a corrected tax receipt can be issued.',
        { errorCode: TAX_RECEIPT_MISSING_EMAIL_OR_AMOUNT_CODE }
      );
    }

    const churchName =
      optionalTrimmedString(giving.churchName, 200)
      || optionalTrimmedString(church.name, 200)
      || settings.organizationName;
    const purpose = optionalTrimmedString(giving.purpose, 200) || 'General Fund';
    const now = FieldValue.serverTimestamp();
    if (originalReceiptRef && originalReceiptSnap) {
      voidTaxReceiptInTransaction(
        tx,
        originalReceiptRef,
        originalReceiptSnap,
        STRIPE_PARTIAL_REFUND_CORRECTED_REASON,
        issuedBy,
        now
      );
    }

    const receiptData = {
      churchId,
      churchName,
      userId,
      givingId: givingRef.id,
      kind: 'single',
      status: 'issued',
      pdfTemplateVersion: TAX_RECEIPT_PDF_TEMPLATE_VERSION,
      jurisdiction: settings.jurisdiction,
      receiptNumber,
      receiptYear: receivedDate.year,
      organizationName: settings.organizationName,
      organizationAddress: settings.organizationAddress,
      organizationTaxId: settings.taxId,
      donorName: donorProfile.donorName,
      donorAddress: donorProfile.donorAddress,
      donorEmail,
      amountCents: amounts.netAmountCents,
      eligibleAmountCents: amounts.netAmountCents,
      originalAmountCents: amounts.originalAmountCents,
      refundedAmountCents: amounts.refundedAmountCents,
      currency,
      purpose,
      receivedAt,
      receivedDateLabel: receivedDate.label,
      issuedAt: now,
      issuedDateLabel: issuedDate.label,
      issuedBy,
      correctionForGivingId: givingRef.id,
      correctionForReceiptId: originalReceiptId || null,
      correctionSourceReason: STRIPE_PARTIAL_REFUND_CORRECTED_REASON,
      correctedAt: now,
      correctedBy: issuedBy,
      goodsServicesStatement: settings.goodsServicesStatement,
      receiptIssueLocation: settings.receiptIssueLocation,
      authorizedSignerName: settings.authorizedSignerName,
      authorizedSignerTitle: settings.authorizedSignerTitle,
      secureElectronicSignatureConfigured: settings.secureElectronicSignatureConfigured,
      receiptCopiesRetentionConfirmed: settings.receiptCopiesRetentionConfirmed,
      createdAt: now,
      updatedAt: now,
    };

    tx.set(correctedReceiptRef, receiptData);
    const issuedEvent = taxReceiptEventData({
      action: 'issued',
      actorUid: issuedBy,
      receiptId: correctedReceiptRef.id,
      receipt: receiptData,
    });
    if (issuedEvent) {
      tx.set(db.collection(TAX_RECEIPT_EVENTS_COLLECTION).doc(), issuedEvent);
    }
    const correctedEvent = taxReceiptEventData({
      action: 'corrected',
      actorUid: issuedBy,
      receiptId: correctedReceiptRef.id,
      receipt: receiptData,
      reasonCode: STRIPE_PARTIAL_REFUND_CORRECTED_REASON,
    });
    if (correctedEvent) {
      tx.set(db.collection(TAX_RECEIPT_EVENTS_COLLECTION).doc(), correctedEvent);
    }
    tx.set(
      counterRef,
      {
        churchId,
        year: receivedDate.year,
        lastSequence: nextSequence,
        updatedAt: now,
      },
      { merge: true }
    );
    tx.update(givingRef, {
      ...givingIdentityUpdateForReceipt(giving, givingDonorName),
      taxReceiptId: correctedReceiptRef.id,
      taxReceiptNumber: receiptNumber,
      taxReceiptStatus: 'issued',
      taxReceiptIssuedAt: now,
      taxReceiptCorrectedAt: now,
      taxReceiptCorrectedBy: issuedBy,
      taxReceiptCorrectionRequired: FieldValue.delete(),
      taxReceiptCorrectionReason: FieldValue.delete(),
      taxReceiptCorrectionMarkedAt: FieldValue.delete(),
      taxReceiptError: FieldValue.delete(),
      taxReceiptEmailError: FieldValue.delete(),
      taxReceiptVoidReason: FieldValue.delete(),
      updatedAt: now,
    });

    issueResult = {
      receiptId: correctedReceiptRef.id,
      receiptNumber,
      created: true,
    };
  });

  if (!issueResult) {
    throw new HttpsError('internal', 'Unable to issue corrected tax receipt.');
  }
  return issueResult;
}

export async function annualGivingIncludesReceiptManagerUnsafeContribution(
  churchId: string,
  userId: string,
  year: number,
  timezone: unknown
): Promise<boolean> {
  const annualGivingDocs = await loadAnnualGivingDocs(churchId, userId, year, timezone);
  return annualGivingDocs.some((docSnap) => !givingIsSafeForTargetedReceiptManagerAction(docSnap.data()));
}

function receiptSingleGivingId(receipt: Record<string, unknown>): string {
  const kind = optionalTrimmedString(receipt.kind, 20);
  const givingId = optionalTrimmedString(receipt.givingId, 128);
  return kind === 'single' && TAX_RECEIPT_ID_PATTERN.test(givingId) ? givingId : '';
}

async function receiptCoveredGivingRefundDetails(
  receipt: Record<string, unknown>,
  tx?: FirebaseFirestore.Transaction
): Promise<ReceiptCoveredGivingRefundDetails> {
  const givingIds = receiptCoveredGivingIds(receipt);
  const givingDocs: ReceiptCoveredGivingRefundDetails['givingDocs'] = [];
  if (givingIds.length === 0) {
    return { state: 'none', givingDocs };
  }

  let sawPartialRefund = false;
  let state: ReceiptCoveredGivingRefundState = 'none';
  for (const givingId of givingIds) {
    const givingRef = db.collection('giving').doc(givingId);
    const givingSnap = tx ? await tx.get(givingRef) : await givingRef.get();
    const giving = givingSnap.data() ?? {};
    givingDocs.push({
      id: givingId,
      ref: givingRef,
      snap: givingSnap,
      data: giving,
    });
    if (isFullyRefundedGiving(giving)) {
      state = 'full';
      break;
    }
    sawPartialRefund = sawPartialRefund || isPartiallyRefundedGiving(giving);
  }
  if (state !== 'full' && sawPartialRefund) {
    state = 'partial';
  }
  return { state, givingDocs };
}

async function existingAnnualTaxReceiptForResend(
  receiptRef: FirebaseFirestore.DocumentReference,
  churchId: string,
  userId: string,
  year: number,
  timezone: unknown,
  acknowledgePreviouslyReceipted: boolean
): Promise<TaxReceiptIssueResult | null> {
  const existingReceipt = await receiptRef.get();
  if (!existingReceipt.exists) {
    return null;
  }

  const existing = existingReceipt.data() ?? {};
  if (!validExistingAnnualTaxReceipt(existing, churchId, userId, year)) {
    throw new HttpsError('failed-precondition', 'The existing annual tax receipt requires review.');
  }
  if (optionalTrimmedString(existing.status, 20) === 'voided') {
    return null;
  }

  const coveredRefundDetails = await receiptCoveredGivingRefundDetails(existing);
  const coveredRefundState = coveredRefundDetails.state;
  if (coveredRefundState === 'full') {
    await db.runTransaction(async (tx) => {
      const receiptSnap = await tx.get(receiptRef);
      if (!receiptSnap.exists) {
        return;
      }
      const receipt = receiptSnap.data() ?? {};
      if (!validExistingAnnualTaxReceipt(receipt, churchId, userId, year)) {
        return;
      }
      const refundDetails = await receiptCoveredGivingRefundDetails(receipt, tx);
      if (refundDetails.state !== 'full') {
        return;
      }
      voidTaxReceiptInTransaction(
        tx,
        receiptRef,
        receiptSnap,
        STRIPE_FULL_REFUND_VOID_REASON,
        'system',
        FieldValue.serverTimestamp(),
        annualReceiptSummaryPrivacyOverridesFromCoveredGivingDocs(receipt, refundDetails.givingDocs)
      );
    });
    return null;
  }
  if (existing.correctionRequired !== true && coveredRefundState === 'partial') {
    await db.runTransaction(async (tx) => {
      const receiptSnap = await tx.get(receiptRef);
      if (!receiptSnap.exists) {
        return;
      }
      const receipt = receiptSnap.data() ?? {};
      if (!validExistingAnnualTaxReceipt(receipt, churchId, userId, year)) {
        return;
      }
      const refundDetails = await receiptCoveredGivingRefundDetails(receipt, tx);
      if (refundDetails.state !== 'partial') {
        return;
      }
      markTaxReceiptReviewRequiredInTransaction(
        tx,
        receiptRef,
        receiptSnap,
        STRIPE_PARTIAL_REFUND_REVIEW_REASON,
        'system',
        FieldValue.serverTimestamp(),
        annualReceiptSummaryPrivacyOverridesFromCoveredGivingDocs(receipt, refundDetails.givingDocs)
      );
    });
    throw new HttpsError(
      'failed-precondition',
      'One or more donations were partially refunded and need manual receipt review before an annual tax receipt can be emailed.',
      { errorCode: STRIPE_PARTIAL_REFUND_REVIEW_REASON }
    );
  }

  const currentAnnualGivingDocs = await loadAnnualGivingDocs(churchId, userId, year, timezone);
  const currentValidGiving = validAnnualGivingFromSnaps(
    currentAnnualGivingDocs,
    churchId,
    userId,
    year,
    timezone
  );
  assertAnnualReceiptCoversCurrentGiving(existing, currentValidGiving, timezone);

  const coveredGiving = coveredRefundDetails.givingDocs
    .filter((doc) => doc.snap.exists)
    .map((doc) => ({ snap: doc.snap, data: doc.data }));
  const coveredGivingIncludesPreviouslyReceipted =
    await annualGivingIncludesPreviouslyReceiptedEvidence(coveredGiving, churchId, userId);
  requireAnnualPreviouslyReceiptedAcknowledgement(
    existing.includesPreviouslyReceipted === true || coveredGivingIncludesPreviouslyReceipted,
    acknowledgePreviouslyReceipted
  );
  await upsertAnnualReceiptSummary(receiptRef.id, existing);
  return {
    receiptId: receiptRef.id,
    receiptNumber: publicTaxReceiptNumber(existing.receiptNumber),
    created: false,
    emailSent: taxReceiptAlreadyEmailed(existing),
    contributionCount: typeof existing.donationCount === 'number' ? existing.donationCount : undefined,
  };
}

export async function loadAnnualDonorIdsForChurch(
  churchId: string,
  year: number,
  timezone: unknown
): Promise<AnnualBatchDonorSelection> {
  const { entries, sourceTruncated } = await loadAnnualDonorEntriesForChurch(churchId, year, timezone);
  const reviewSkips = entries
    .filter((entry) => entry.hasMixedCurrency)
    .map((entry) => ({
      userId: entry.userId,
      code: ANNUAL_RECEIPT_MIXED_CURRENCY_REVIEW_CODE,
    }));
  const sendableEntries = entries.filter((entry) => !entry.hasMixedCurrency);
  const receiptRefs = sendableEntries.map((entry) =>
    db.collection(TAX_RECEIPTS_COLLECTION).doc(annualTaxReceiptDocId(churchId, entry.userId, year))
  );
  const receiptSnaps = await getDocumentSnapshotsById(receiptRefs);
  const readyDonorIds: string[] = [];
  const reviewDonorIds: string[] = [];
  let skippedAlreadyEmailedCount = 0;

  for (const entry of sendableEntries) {
    const receiptId = annualTaxReceiptDocId(churchId, entry.userId, year);
    const receiptSnap = receiptSnaps.get(receiptId);
    const receipt = receiptSnap?.data() ?? {};
    if (receiptSnap?.exists && taxReceiptAlreadyEmailedAndSettled(receipt)) {
      skippedAlreadyEmailedCount += 1;
      continue;
    }

    if (entry.hasPartialRefund) {
      reviewDonorIds.push(entry.userId);
    } else {
      readyDonorIds.push(entry.userId);
    }
  }

  const candidateDonorIds = [...readyDonorIds, ...reviewDonorIds];
  return {
    donorIds: candidateDonorIds.slice(0, ANNUAL_BULK_DONOR_LIMIT),
    skippedAlreadyEmailedCount,
    reviewSkips,
    truncated: sourceTruncated || candidateDonorIds.length > ANNUAL_BULK_DONOR_LIMIT,
  };
}

export async function loadAnnualPartialRefundDonorIdsForChurch(
  churchId: string,
  year: number,
  timezone: unknown
): Promise<AnnualBatchDonorSelection> {
  const { entries, sourceTruncated } = await loadAnnualDonorEntriesForChurch(churchId, year, timezone);
  const partialRefundEntries = entries.filter((entry) => entry.hasPartialRefund);
  const reviewSkips = partialRefundEntries
    .filter((entry) => entry.hasMixedCurrency)
    .map((entry) => ({
      userId: entry.userId,
      code: ANNUAL_RECEIPT_MIXED_CURRENCY_REVIEW_CODE,
    }));
  const sendablePartialRefundEntries = partialRefundEntries.filter((entry) => !entry.hasMixedCurrency);
  const correctedReceiptRefs: FirebaseFirestore.DocumentReference[] = [];
  const correctedReceiptIdByDonorId = new Map<string, string>();

  for (const entry of sendablePartialRefundEntries) {
    try {
      const amounts = annualGivingAmountSummary(entry.validGiving);
      if (amounts.partialRefundGivingIds.length === 0) {
        continue;
      }
      const receiptId = correctedAnnualTaxReceiptDocId(
        churchId,
        entry.userId,
        year,
        amounts.correctionDigestInput
      );
      correctedReceiptIdByDonorId.set(entry.userId, receiptId);
      correctedReceiptRefs.push(db.collection(TAX_RECEIPTS_COLLECTION).doc(receiptId));
    } catch {
      // Keep this donor in the batch so the issuer records the normal failure.
    }
  }

  const correctedReceiptSnaps = await getDocumentSnapshotsById(correctedReceiptRefs);
  const candidateDonorIds: string[] = [];
  let skippedAlreadyEmailedCount = 0;

  for (const entry of sendablePartialRefundEntries) {
    const receiptId = correctedReceiptIdByDonorId.get(entry.userId);
    const receiptSnap = receiptId ? correctedReceiptSnaps.get(receiptId) : undefined;
    const receipt = receiptSnap?.data() ?? {};
    let alreadyEmailedCurrentCorrection = false;
    if (receiptSnap?.exists && receiptId) {
      try {
        const amounts = annualGivingAmountSummary(entry.validGiving);
        alreadyEmailedCurrentCorrection =
          isValidAnnualPartialRefundCorrectionReceipt(
            receipt,
            churchId,
            entry.userId,
            year,
            amounts,
            entry.validGiving.length
          )
          && taxReceiptAlreadyEmailedAndSettled(receipt);
      } catch {
        alreadyEmailedCurrentCorrection = false;
      }
    }

    if (alreadyEmailedCurrentCorrection) {
      skippedAlreadyEmailedCount += 1;
      continue;
    }
    candidateDonorIds.push(entry.userId);
  }

  return {
    donorIds: candidateDonorIds.slice(0, ANNUAL_BULK_DONOR_LIMIT),
    skippedAlreadyEmailedCount,
    reviewSkips,
    truncated: sourceTruncated || candidateDonorIds.length > ANNUAL_BULK_DONOR_LIMIT,
  };
}

async function loadAnnualDonorEntriesForChurch(
  churchId: string,
  year: number,
  timezone: unknown
): Promise<{ entries: AnnualBatchDonorEntry[]; sourceTruncated: boolean }> {
  const { start, end } = broadYearWindow(year);
  const baseQuery = db
    .collection('giving')
    .where('churchId', '==', churchId)
    .where('status', '==', 'completed')
    .where('completedAt', '>=', start)
    .where('completedAt', '<', end)
    .orderBy('completedAt', 'asc');
  const entriesByDonorId = new Map<string, AnnualBatchDonorEntry>();
  let lastDoc: FirebaseFirestore.QueryDocumentSnapshot | null = null;
  let scannedCount = 0;
  let sourceTruncated = false;

  while (true) {
    const remainingScanBudget = ANNUAL_BULK_DONOR_SOURCE_SCAN_LIMIT - scannedCount;
    if (remainingScanBudget <= 0) {
      sourceTruncated = true;
      break;
    }

    const pageSize = Math.min(ANNUAL_BULK_DONOR_SOURCE_PAGE_SIZE, remainingScanBudget);
    let pageQuery: FirebaseFirestore.Query = baseQuery.limit(pageSize);
    if (lastDoc) {
      pageQuery = baseQuery.startAfter(lastDoc).limit(pageSize);
    }
    const snap = await pageQuery.get();
    if (snap.empty) {
      break;
    }

    for (const docSnap of snap.docs) {
      const data = docSnap.data();
      const completedAt = data.completedAt;
      const userId = optionalTrimmedString(data.userId, 128);
      if (
        userId
        && completedAt instanceof Timestamp
        && datePartsForReceipt(completedAt, timezone).year === year
      ) {
        const entry = entriesByDonorId.get(userId) ?? {
          userId,
          validGiving: [],
          hasPartialRefund: false,
          hasMixedCurrency: false,
          currency: '',
        };
        entry.validGiving.push({ snap: docSnap, data });
        entry.hasPartialRefund = entry.hasPartialRefund || isPartiallyRefundedGiving(data);
        const currency = normalizedTaxReceiptCurrency(data.currency);
        if (!currency) {
          entry.hasMixedCurrency = true;
        } else if (!entry.currency) {
          entry.currency = currency;
        } else if (entry.currency !== currency) {
          entry.hasMixedCurrency = true;
        }
        entriesByDonorId.set(userId, entry);
      }
    }

    scannedCount += snap.docs.length;
    if (snap.docs.length < pageSize) {
      break;
    }
    lastDoc = snap.docs[snap.docs.length - 1];
    if (scannedCount >= ANNUAL_BULK_DONOR_SOURCE_SCAN_LIMIT) {
      sourceTruncated = true;
      break;
    }
  }

  return {
    entries: Array.from(entriesByDonorId.values()),
    sourceTruncated,
  };
}

function taxReceiptAlreadyEmailedAndSettled(receipt: Record<string, unknown>): boolean {
  return taxReceiptAlreadyEmailed(receipt)
    && optionalTrimmedString(receipt.status, 20) !== 'voided'
    && receipt.correctionRequired !== true
    && !optionalTrimmedString(receipt.correctionReason, 120);
}

function assertTaxReceiptPdfRenderableReceipt(
  receipt: Record<string, unknown>
): { kind: 'single' | 'annual'; currency: string } {
  const kind = optionalTrimmedString(receipt.kind, 20);
  if (kind !== 'single' && kind !== 'annual') {
    throw new HttpsError(
      'failed-precondition',
      'Tax receipt type is missing or unsupported for official PDF delivery.',
      { errorCode: 'tax_receipt_preparation_failed' }
    );
  }

  const currency = normalizedTaxReceiptCurrency(receipt.currency);
  if (!currency) {
    throw new HttpsError(
      'failed-precondition',
      'Tax receipt currency is missing or unsupported for official PDF delivery.',
      { errorCode: TAX_RECEIPT_INVALID_CURRENCY_CODE }
    );
  }

  return { kind, currency };
}

function annualReceiptCoversCurrentGiving(
  receipt: Record<string, unknown>,
  validGiving: Array<{
    snap: FirebaseFirestore.DocumentSnapshot;
    data: FirebaseFirestore.DocumentData;
  }>,
  timezone: unknown
): boolean {
  const currentGivingIds = validGiving.map(({ snap }) => snap.id);
  if (currentGivingIds.length === 0 || !sameStringSet(receipt.givingIds, currentGivingIds)) {
    return false;
  }

  let amounts: AnnualGivingAmountSummary;
  let currency: string;
  try {
    amounts = annualGivingAmountSummary(validGiving);
    currency = assertAnnualGivingSingleCurrency(validGiving);
  } catch {
    return false;
  }

  const receiptCurrency = normalizedTaxReceiptCurrency(receipt.currency);
  if (
    !receiptCurrency
    || receiptCurrency !== currency
    || receipt.donationCount !== validGiving.length
  ) {
    return false;
  }

  if (!annualContributionRecordsMatchReceipt(receipt, validGiving, timezone, currency)) {
    return false;
  }

  if (optionalTrimmedString(receipt.correctionSourceReason, 120) === STRIPE_PARTIAL_REFUND_CORRECTED_REASON) {
    return receipt.amountCents === amounts.eligibleAmountCents
      && receipt.eligibleAmountCents === amounts.eligibleAmountCents
      && receipt.originalAmountCents === amounts.amountCents
      && receipt.refundedAmountCents === amounts.refundedAmountCents;
  }

  return receipt.amountCents === amounts.amountCents
    && receipt.eligibleAmountCents === amounts.eligibleAmountCents;
}

function assertAnnualReceiptCoversCurrentGiving(
  receipt: Record<string, unknown>,
  validGiving: Array<{
    snap: FirebaseFirestore.DocumentSnapshot;
    data: FirebaseFirestore.DocumentData;
  }>,
  timezone: unknown,
  action = 'emailed'
): void {
  if (annualReceiptCoversCurrentGiving(receipt, validGiving, timezone)) {
    return;
  }

  throw new HttpsError(
    'failed-precondition',
    `This annual tax receipt no longer matches the donor-year donations and needs manual review before it can be ${action}.`,
    { errorCode: ANNUAL_RECEIPT_GIVING_CHANGED_REVIEW_CODE }
  );
}

async function assertAnnualReceiptCoversCurrentGivingForAction(
  receipt: Record<string, unknown>,
  action: 'downloaded' | 'emailed'
): Promise<void> {
  if (optionalTrimmedString(receipt.kind, 20) !== 'annual') {
    return;
  }

  const churchId = optionalTrimmedString(receipt.churchId, 128);
  const userId = optionalTrimmedString(receipt.userId, 128);
  const year = annualReceiptYear(receipt);
  if (!churchId || !userId || typeof year !== 'number') {
    throw new HttpsError('failed-precondition', 'The annual tax receipt requires review.');
  }

  const churchSnap = await db.collection('churches').doc(churchId).get();
  if (!churchSnap.exists) {
    throw new HttpsError('failed-precondition', 'The annual tax receipt requires review.');
  }
  const church = churchSnap.data() ?? {};
  const currentAnnualGivingDocs = await loadAnnualGivingDocs(churchId, userId, year, church.timezone);
  const currentValidGiving = validAnnualGivingFromSnaps(
    currentAnnualGivingDocs,
    churchId,
    userId,
    year,
    church.timezone
  );
  assertAnnualReceiptCoversCurrentGiving(receipt, currentValidGiving, church.timezone, action);
}

async function assertSingleReceiptMatchesCurrentGivingForAction(
  receipt: Record<string, unknown>,
  action: 'downloaded' | 'emailed'
): Promise<void> {
  if (optionalTrimmedString(receipt.kind, 20) !== 'single') {
    return;
  }

  const givingId = receiptSingleGivingId(receipt);
  if (!givingId) {
    throw new HttpsError(
      'failed-precondition',
      'This tax receipt needs manual review before it can be used.',
      { errorCode: SINGLE_RECEIPT_GIVING_CHANGED_REVIEW_CODE }
    );
  }

  const givingSnap = await db.collection('giving').doc(givingId).get();
  if (!givingSnap.exists) {
    throw new HttpsError(
      'failed-precondition',
      'This tax receipt no longer matches the donation and needs manual review before it can be used.',
      { errorCode: SINGLE_RECEIPT_GIVING_CHANGED_REVIEW_CODE }
    );
  }

  const giving = givingSnap.data() ?? {};
  const partialAmounts = partialRefundAmounts(giving);
  const matchesCurrentGiving = partialAmounts
    ? isValidPartialRefundCorrectionReceipt(receipt, givingId, giving, partialAmounts)
    : isValidExistingSingleTaxReceiptForGiving(receipt, givingId, giving);
  if (matchesCurrentGiving) {
    return;
  }

  throw new HttpsError(
    'failed-precondition',
    `This tax receipt no longer matches the donation and needs manual review before it can be ${action}.`,
    { errorCode: SINGLE_RECEIPT_GIVING_CHANGED_REVIEW_CODE }
  );
}

async function annualTaxReceiptSnapsForGivingIdsInTransaction(
  tx: FirebaseFirestore.Transaction,
  givingIds: string[]
): Promise<Map<string, FirebaseFirestore.DocumentSnapshot>> {
  const snapsById = new Map<string, FirebaseFirestore.DocumentSnapshot>();
  const uniqueGivingIds = Array.from(new Set(givingIds.filter((givingId) => TAX_RECEIPT_ID_PATTERN.test(givingId))));

  for (const givingId of uniqueGivingIds) {
    const snap = await tx.get(
      db.collection(TAX_RECEIPTS_COLLECTION).where('givingIds', 'array-contains', givingId)
    );
    for (const docSnap of snap.docs) {
      snapsById.set(docSnap.id, docSnap);
    }
  }

  return snapsById;
}

function voidPriorAnnualTaxReceiptsForCorrectionInTransaction(
  tx: FirebaseFirestore.Transaction,
  receiptSnapsById: Map<string, FirebaseFirestore.DocumentSnapshot>,
  replacementReceiptId: string,
  churchId: string,
  userId: string,
  year: number,
  summaryPrivacyGiving: Array<{
    snap: FirebaseFirestore.DocumentSnapshot;
    data: FirebaseFirestore.DocumentData;
  }>,
  actorUid: string,
  now: FirebaseFirestore.FieldValue
): void {
  for (const receiptSnap of receiptSnapsById.values()) {
    if (receiptSnap.id === replacementReceiptId) {
      continue;
    }

    const receipt = receiptSnap.data() ?? {};
    if (!validExistingAnnualTaxReceipt(receipt, churchId, userId, year)) {
      continue;
    }

    voidTaxReceiptInTransaction(
      tx,
      receiptSnap.ref,
      receiptSnap,
      STRIPE_PARTIAL_REFUND_CORRECTED_REASON,
      actorUid,
      now,
      annualReceiptSummaryPrivacyOverridesFromCoveredGivingRecords(
        receipt,
        summaryPrivacyGiving.map(({ snap, data }) => ({
          id: snap.id,
          exists: snap.exists,
          data,
        }))
      )
    );
  }
}

export async function issueCorrectedAnnualTaxReceiptForDonor(
  churchId: string,
  userId: string,
  year: number,
  issuedBy: string,
  acknowledgePreviouslyReceipted = false
): Promise<TaxReceiptIssueResult> {
  if (!TAX_RECEIPT_ID_PATTERN.test(churchId) || !TAX_RECEIPT_ID_PATTERN.test(userId)) {
    throw new HttpsError('invalid-argument', 'churchId or userId is invalid.');
  }

  const churchRef = db.collection('churches').doc(churchId);
  const userRef = db.collection('users').doc(userId);
  const memberRef = churchRef.collection('members').doc(userId);
  const [churchSnap, userSnap, memberSnap] = await Promise.all([
    churchRef.get(),
    userRef.get(),
    memberRef.get(),
  ]);
  if (!churchSnap.exists) {
    throw new HttpsError('not-found', 'Church not found.');
  }

  const church = churchSnap.data() ?? {};
  assertAnnualReceiptYearClosed(year, church.timezone);
  const existingCorrectedReceipt = await existingCorrectedAnnualTaxReceiptForCurrentState(
    churchId,
    userId,
    year,
    church.timezone,
    issuedBy,
    acknowledgePreviouslyReceipted
  );
  if (existingCorrectedReceipt) {
    return existingCorrectedReceipt;
  }

  assertActiveChurchForTaxReceiptIssuance(church);
  const settings = parseTaxReceiptSettings(church);
  if (!settings) {
    throw new HttpsError(
      'failed-precondition',
      'Tax receipts are not enabled for this church.',
      { errorCode: CHURCH_TAX_RECEIPTS_NOT_ENABLED_CODE }
    );
  }

  const annualGivingDocs = await loadAnnualGivingDocs(churchId, userId, year, church.timezone);
  if (annualGivingDocs.length === 0) {
    throw new HttpsError('failed-precondition', 'No completed donations were found for this donor and year.');
  }
  const authEmail = (await getPrimaryVerifiedEmailsForUids([userId]))[0] ?? '';

  let issueResult: TaxReceiptIssueResult | null = null;
  await db.runTransaction(async (tx) => {
    const originalReceiptRef = db
      .collection(TAX_RECEIPTS_COLLECTION)
      .doc(annualTaxReceiptDocId(churchId, userId, year));
    const counterRef = db
      .collection(TAX_RECEIPT_COUNTERS_COLLECTION)
      .doc(receiptCounterDocId(churchId, year));
    const [counterSnap, originalReceiptSnap, ...givingSnaps] = await Promise.all([
      tx.get(counterRef),
      tx.get(originalReceiptRef),
      ...annualGivingDocs.map((docSnap) => tx.get(docSnap.ref)),
    ]);
    const validGiving = validAnnualGivingFromSnaps(givingSnaps, churchId, userId, year, church.timezone);
    if (validGiving.length === 0) {
      throw new HttpsError('failed-precondition', 'No completed donations were found for this donor and year.');
    }

    const amounts = annualGivingAmountSummary(validGiving);
    if (amounts.partialRefundGivingIds.length === 0) {
      throw new HttpsError(
        'failed-precondition',
        'Corrected annual tax receipts currently require at least one partially refunded donation.'
      );
    }
    const includesPreviouslyReceipted = await annualGivingIncludesPreviouslyReceiptedEvidenceInTransaction(
      tx,
      validGiving,
      churchId,
      userId
    );
    requireAnnualPreviouslyReceiptedAcknowledgement(
      includesPreviouslyReceipted,
      acknowledgePreviouslyReceipted
    );

    const currency = assertAnnualGivingSingleCurrency(validGiving);
    const correctedReceiptRef = db
      .collection(TAX_RECEIPTS_COLLECTION)
      .doc(correctedAnnualTaxReceiptDocId(churchId, userId, year, amounts.correctionDigestInput));
    const correctedReceiptSnap = await tx.get(correctedReceiptRef);
    const priorAnnualReceiptSnaps = await annualTaxReceiptSnapsForGivingIdsInTransaction(tx, amounts.givingIds);
    if (originalReceiptSnap.exists) {
      priorAnnualReceiptSnaps.set(originalReceiptRef.id, originalReceiptSnap);
    }
    const now = FieldValue.serverTimestamp();
    if (correctedReceiptSnap.exists) {
      const existing = correctedReceiptSnap.data() ?? {};
      if (!isValidAnnualPartialRefundCorrectionReceipt(
        existing,
        churchId,
        userId,
        year,
        amounts,
        validGiving.length
      )) {
        throw new HttpsError('failed-precondition', 'The existing corrected annual tax receipt requires review.');
      }
      requireAnnualPreviouslyReceiptedAcknowledgement(
        existing.includesPreviouslyReceipted === true || includesPreviouslyReceipted,
        acknowledgePreviouslyReceipted
      );
      voidPriorAnnualTaxReceiptsForCorrectionInTransaction(
        tx,
        priorAnnualReceiptSnaps,
        correctedReceiptRef.id,
        churchId,
        userId,
        year,
        validGiving,
        issuedBy,
        now
      );
      const summary = annualReceiptSummaryFromReceipt(
        correctedReceiptRef.id,
        existing,
        annualReceiptSummaryPrivacyOverridesFromGivingRecords(validGiving, existing)
      );
      if (summary) {
        tx.set(db.collection(TAX_RECEIPT_SUMMARIES_COLLECTION).doc(correctedReceiptRef.id), summary, { merge: true });
      }
      issueResult = {
        receiptId: correctedReceiptRef.id,
        receiptNumber: publicTaxReceiptNumber(existing.receiptNumber),
        created: false,
        emailSent: taxReceiptAlreadyEmailed(existing),
        contributionCount: typeof existing.donationCount === 'number' ? existing.donationCount : validGiving.length,
      };
      return;
    }

    const nextSequence = nextReceiptSequenceFromCounter(counterSnap);
    const receiptNumber = receiptNumberFor(settings, churchId, year, nextSequence);
    const user = userSnap.data() ?? {};
    const member = memberSnap.data() ?? {};
    const firstGiving = validGiving[0].data;
    const publicDonorIdentity = annualPublicDonorIdentity(validGiving, user, member);
    const donorProfile = requiredDonorTaxReceiptProfile(user);
    const donorEmail = authEmail;
    if (!donorEmail) {
      throw new HttpsError(
        'failed-precondition',
        'The donor needs a verified email address before a corrected annual tax receipt can be issued.',
        { errorCode: TAX_RECEIPT_MISSING_EMAIL_OR_AMOUNT_CODE }
      );
    }

    const churchName =
      optionalTrimmedString(firstGiving.churchName, 200)
      || optionalTrimmedString(church.name, 200)
      || settings.organizationName;
    const completedDates = validGiving
      .map(({ data }) => data.completedAt)
      .filter((value): value is Timestamp => value instanceof Timestamp)
      .sort((a, b) => a.toMillis() - b.toMillis());
    const issuedAt = Timestamp.now();
    const issuedDate = datePartsForReceipt(issuedAt, church.timezone);
    voidPriorAnnualTaxReceiptsForCorrectionInTransaction(
      tx,
      priorAnnualReceiptSnaps,
      correctedReceiptRef.id,
      churchId,
      userId,
      year,
      validGiving,
      issuedBy,
      now
    );

    const receiptData = {
      churchId,
      churchName,
      userId,
      givingId: '',
      givingIds: amounts.givingIds,
      kind: 'annual',
      status: 'issued',
      pdfTemplateVersion: TAX_RECEIPT_PDF_TEMPLATE_VERSION,
      jurisdiction: settings.jurisdiction,
      receiptNumber,
      receiptYear: year,
      annualYear: year,
      organizationName: settings.organizationName,
      organizationAddress: settings.organizationAddress,
      organizationTaxId: settings.taxId,
      donorLabel: publicDonorIdentity.donorLabel,
      donorAnonymous: publicDonorIdentity.donorAnonymous,
      donorName: donorProfile.donorName,
      donorAddress: donorProfile.donorAddress,
      donorEmail,
      amountCents: amounts.eligibleAmountCents,
      eligibleAmountCents: amounts.eligibleAmountCents,
      originalAmountCents: amounts.amountCents,
      refundedAmountCents: amounts.refundedAmountCents,
      partialRefundGivingIds: amounts.partialRefundGivingIds,
      currency,
      purpose: 'Annual giving summary',
      donationCount: validGiving.length,
      contributions: annualContributionRecords(validGiving, church.timezone, currency),
      receivedAt: completedDates[completedDates.length - 1],
      receivedDateLabel: annualPeriodLabel(year),
      coveredPeriodLabel: annualPeriodLabel(year),
      firstContributionAt: completedDates[0],
      lastContributionAt: completedDates[completedDates.length - 1],
      issuedAt: now,
      issuedDateLabel: issuedDate.label,
      issuedBy,
      correctionForReceiptId: originalReceiptSnap.exists ? originalReceiptRef.id : null,
      correctionSourceReason: STRIPE_PARTIAL_REFUND_CORRECTED_REASON,
      correctedAt: now,
      correctedBy: issuedBy,
      goodsServicesStatement: settings.goodsServicesStatement,
      receiptIssueLocation: settings.receiptIssueLocation,
      authorizedSignerName: settings.authorizedSignerName,
      authorizedSignerTitle: settings.authorizedSignerTitle,
      secureElectronicSignatureConfigured: settings.secureElectronicSignatureConfigured,
      receiptCopiesRetentionConfirmed: settings.receiptCopiesRetentionConfirmed,
      duplicateClaimWarning: ANNUAL_TAX_RECEIPT_WARNING,
      includesPreviouslyReceipted,
      createdAt: now,
      updatedAt: now,
    };

    tx.set(correctedReceiptRef, receiptData);
    const issuedEvent = taxReceiptEventData({
      action: 'issued',
      actorUid: issuedBy,
      receiptId: correctedReceiptRef.id,
      receipt: receiptData,
    });
    if (issuedEvent) {
      tx.set(db.collection(TAX_RECEIPT_EVENTS_COLLECTION).doc(), issuedEvent);
    }
    const correctedEvent = taxReceiptEventData({
      action: 'corrected',
      actorUid: issuedBy,
      receiptId: correctedReceiptRef.id,
      receipt: receiptData,
      reasonCode: STRIPE_PARTIAL_REFUND_CORRECTED_REASON,
    });
    if (correctedEvent) {
      tx.set(db.collection(TAX_RECEIPT_EVENTS_COLLECTION).doc(), correctedEvent);
    }
    const summary = annualReceiptSummaryFromReceipt(correctedReceiptRef.id, receiptData, {
      ...annualReceiptSummaryPrivacyOverridesFromGivingRecords(validGiving, receiptData),
      emailSentAt: null,
      createdAt: now,
    });
    if (summary) {
      tx.set(db.collection(TAX_RECEIPT_SUMMARIES_COLLECTION).doc(correctedReceiptRef.id), summary, { merge: true });
    }
    tx.set(
      counterRef,
      {
        churchId,
        year,
        lastSequence: nextSequence,
        updatedAt: now,
      },
      { merge: true }
    );

    issueResult = {
      receiptId: correctedReceiptRef.id,
      receiptNumber,
      created: true,
      emailSent: false,
      contributionCount: validGiving.length,
    };
  });

  if (!issueResult) {
    throw new HttpsError('internal', 'Unable to issue corrected annual tax receipt.');
  }
  return issueResult;
}

async function existingCorrectedAnnualTaxReceiptForCurrentState(
  churchId: string,
  userId: string,
  year: number,
  timezone: unknown,
  actorUid: string,
  acknowledgePreviouslyReceipted: boolean
): Promise<TaxReceiptIssueResult | null> {
  const annualGivingDocs = await loadAnnualGivingDocs(churchId, userId, year, timezone);
  if (annualGivingDocs.length === 0) {
    return null;
  }

  const givingSnaps = await Promise.all(annualGivingDocs.map((docSnap) => docSnap.ref.get()));
  const validGiving = validAnnualGivingFromSnaps(givingSnaps, churchId, userId, year, timezone);
  if (validGiving.length === 0) {
    return null;
  }

  const amounts = annualGivingAmountSummary(validGiving);
  if (amounts.partialRefundGivingIds.length === 0) {
    return null;
  }

  const correctedReceiptRef = db
    .collection(TAX_RECEIPTS_COLLECTION)
    .doc(correctedAnnualTaxReceiptDocId(churchId, userId, year, amounts.correctionDigestInput));
  const correctedReceiptSnap = await correctedReceiptRef.get();
  if (!correctedReceiptSnap.exists) {
    return null;
  }

  const existing = correctedReceiptSnap.data() ?? {};
  if (!isValidAnnualPartialRefundCorrectionReceipt(
    existing,
    churchId,
    userId,
    year,
    amounts,
    validGiving.length
  )) {
    throw new HttpsError('failed-precondition', 'The existing corrected annual tax receipt requires review.');
  }
  const includesPreviouslyReceipted =
    await annualGivingIncludesPreviouslyReceiptedEvidence(validGiving, churchId, userId);
  requireAnnualPreviouslyReceiptedAcknowledgement(
    existing.includesPreviouslyReceipted === true || includesPreviouslyReceipted,
    acknowledgePreviouslyReceipted
  );

  let result: TaxReceiptIssueResult | null = null;
  await db.runTransaction(async (tx) => {
    const originalReceiptRef = db
      .collection(TAX_RECEIPTS_COLLECTION)
      .doc(annualTaxReceiptDocId(churchId, userId, year));
    const [transactionCorrectedSnap, originalReceiptSnap] = await Promise.all([
      tx.get(correctedReceiptRef),
      tx.get(originalReceiptRef),
    ]);
    const priorAnnualReceiptSnaps = await annualTaxReceiptSnapsForGivingIdsInTransaction(tx, amounts.givingIds);
    if (originalReceiptSnap.exists) {
      priorAnnualReceiptSnaps.set(originalReceiptRef.id, originalReceiptSnap);
    }

    if (!transactionCorrectedSnap.exists) {
      throw new HttpsError('failed-precondition', 'The existing corrected annual tax receipt requires review.');
    }
    const transactionExisting = transactionCorrectedSnap.data() ?? {};
    if (!isValidAnnualPartialRefundCorrectionReceipt(
      transactionExisting,
      churchId,
      userId,
      year,
      amounts,
      validGiving.length
    )) {
      throw new HttpsError('failed-precondition', 'The existing corrected annual tax receipt requires review.');
    }
    const transactionIncludesPreviouslyReceipted =
      await annualGivingIncludesPreviouslyReceiptedEvidenceInTransaction(tx, validGiving, churchId, userId);
    requireAnnualPreviouslyReceiptedAcknowledgement(
      transactionExisting.includesPreviouslyReceipted === true || transactionIncludesPreviouslyReceipted,
      acknowledgePreviouslyReceipted
    );

    const now = FieldValue.serverTimestamp();
    voidPriorAnnualTaxReceiptsForCorrectionInTransaction(
      tx,
      priorAnnualReceiptSnaps,
      correctedReceiptRef.id,
      churchId,
      userId,
      year,
      validGiving,
      actorUid,
      now
    );
    const summary = annualReceiptSummaryFromReceipt(
      correctedReceiptRef.id,
      transactionExisting,
      annualReceiptSummaryPrivacyOverridesFromGivingRecords(validGiving, transactionExisting)
    );
    if (summary) {
      tx.set(db.collection(TAX_RECEIPT_SUMMARIES_COLLECTION).doc(correctedReceiptRef.id), summary, { merge: true });
    }
    result = {
      receiptId: correctedReceiptRef.id,
      receiptNumber: publicTaxReceiptNumber(transactionExisting.receiptNumber),
      created: false,
      emailSent: taxReceiptAlreadyEmailed(transactionExisting),
      contributionCount:
        typeof transactionExisting.donationCount === 'number'
          ? transactionExisting.donationCount
          : validGiving.length,
    };
  });

  if (!result) {
    throw new HttpsError('internal', 'Unable to load corrected annual tax receipt.');
  }
  return result;
}

async function existingReissuedAnnualTaxReceiptForCurrentState(
  primaryReceiptRef: FirebaseFirestore.DocumentReference,
  churchId: string,
  userId: string,
  year: number,
  timezone: unknown,
  acknowledgePreviouslyReceipted: boolean
): Promise<TaxReceiptIssueResult | null> {
  const primaryReceiptSnap = await primaryReceiptRef.get();
  const primaryReceipt = primaryReceiptSnap.data() ?? {};
  if (!primaryReceiptSnap.exists || optionalTrimmedString(primaryReceipt.status, 20) !== 'voided') {
    return null;
  }

  const annualGivingDocs = await loadAnnualGivingDocs(churchId, userId, year, timezone);
  if (annualGivingDocs.length === 0) {
    return null;
  }

  const givingSnaps = await Promise.all(annualGivingDocs.map((docSnap) => docSnap.ref.get()));
  const validGiving = validAnnualGivingFromSnaps(givingSnaps, churchId, userId, year, timezone);
  if (validGiving.length === 0) {
    return null;
  }

  const amounts = annualGivingAmountSummary(validGiving);
  if (amounts.partialRefundGivingIds.length > 0) {
    return null;
  }

  const reissuedReceiptRef = db
    .collection(TAX_RECEIPTS_COLLECTION)
    .doc(reissuedAnnualTaxReceiptDocId(churchId, userId, year, amounts.correctionDigestInput));
  const reissuedReceiptSnap = await reissuedReceiptRef.get();
  if (!reissuedReceiptSnap.exists) {
    return null;
  }

  const existing = reissuedReceiptSnap.data() ?? {};
  if (!isValidAnnualFullRefundReissueReceipt(
    existing,
    churchId,
    userId,
    year,
    amounts,
    validGiving.length
  )) {
    throw new HttpsError('failed-precondition', 'The existing reissued annual tax receipt requires review.');
  }

  const includesPreviouslyReceipted =
    await annualGivingIncludesPreviouslyReceiptedEvidence(validGiving, churchId, userId);
  requireAnnualPreviouslyReceiptedAcknowledgement(
    existing.includesPreviouslyReceipted === true || includesPreviouslyReceipted,
    acknowledgePreviouslyReceipted
  );
  await upsertAnnualReceiptSummary(reissuedReceiptRef.id, existing);
  return {
    receiptId: reissuedReceiptRef.id,
    receiptNumber: publicTaxReceiptNumber(existing.receiptNumber),
    created: false,
    emailSent: taxReceiptAlreadyEmailed(existing),
    contributionCount: typeof existing.donationCount === 'number' ? existing.donationCount : validGiving.length,
  };
}

export async function issueAnnualTaxReceiptForDonor(
  churchId: string,
  userId: string,
  year: number,
  issuedBy: string,
  acknowledgePreviouslyReceipted = false
): Promise<TaxReceiptIssueResult> {
  if (!TAX_RECEIPT_ID_PATTERN.test(churchId) || !TAX_RECEIPT_ID_PATTERN.test(userId)) {
    throw new HttpsError('invalid-argument', 'churchId or userId is invalid.');
  }

  const churchRef = db.collection('churches').doc(churchId);
  const userRef = db.collection('users').doc(userId);
  const memberRef = churchRef.collection('members').doc(userId);
  const receiptRef = db.collection(TAX_RECEIPTS_COLLECTION).doc(annualTaxReceiptDocId(churchId, userId, year));
  const [churchSnap, userSnap, memberSnap] = await Promise.all([
    churchRef.get(),
    userRef.get(),
    memberRef.get(),
  ]);
  if (!churchSnap.exists) {
    throw new HttpsError('not-found', 'Church not found.');
  }

  const church = churchSnap.data() ?? {};
  assertAnnualReceiptYearClosed(year, church.timezone);
  const existingCorrectedReceipt = await existingCorrectedAnnualTaxReceiptForCurrentState(
    churchId,
    userId,
    year,
    church.timezone,
    issuedBy,
    acknowledgePreviouslyReceipted
  );
  if (existingCorrectedReceipt) {
    return existingCorrectedReceipt;
  }

  const existingReissuedReceipt = await existingReissuedAnnualTaxReceiptForCurrentState(
    receiptRef,
    churchId,
    userId,
    year,
    church.timezone,
    acknowledgePreviouslyReceipted
  );
  if (existingReissuedReceipt) {
    return existingReissuedReceipt;
  }

  const existingAnnualReceipt = await existingAnnualTaxReceiptForResend(
    receiptRef,
    churchId,
    userId,
    year,
    church.timezone,
    acknowledgePreviouslyReceipted
  );
  if (existingAnnualReceipt) {
    return existingAnnualReceipt;
  }

  assertActiveChurchForTaxReceiptIssuance(church);
  const settings = parseTaxReceiptSettings(church);
  if (!settings) {
    throw new HttpsError(
      'failed-precondition',
      'Tax receipts are not enabled for this church.',
      { errorCode: CHURCH_TAX_RECEIPTS_NOT_ENABLED_CODE }
    );
  }

  const annualGivingDocs = await loadAnnualGivingDocs(churchId, userId, year, church.timezone);
  if (annualGivingDocs.length === 0) {
    throw new HttpsError('failed-precondition', 'No completed donations were found for this donor and year.');
  }
  const authEmail = (await getPrimaryVerifiedEmailsForUids([userId]))[0] ?? '';

  let issueResult: TaxReceiptIssueResult | null = null;
  let annualReceiptFullRefundVoidedWithoutEligibleGiving = false;
  await db.runTransaction(async (tx) => {
    annualReceiptFullRefundVoidedWithoutEligibleGiving = false;
    const counterRef = db
      .collection(TAX_RECEIPT_COUNTERS_COLLECTION)
      .doc(receiptCounterDocId(churchId, year));
    const [primaryReceiptSnap, counterSnap, ...givingSnaps] = await Promise.all([
      tx.get(receiptRef),
      tx.get(counterRef),
      ...annualGivingDocs.map((docSnap) => tx.get(docSnap.ref)),
    ]);
    const primaryReceipt = primaryReceiptSnap.data() ?? {};
    const primaryReceiptVoided =
      primaryReceiptSnap.exists && optionalTrimmedString(primaryReceipt.status, 20) === 'voided';
    const validGiving = validAnnualGivingFromSnaps(givingSnaps, churchId, userId, year, church.timezone);
    let primaryReceiptNeedsFullRefundVoid = false;
    let primaryReceiptRefundDetails: ReceiptCoveredGivingRefundDetails | null = null;
    if (primaryReceiptSnap.exists && !primaryReceiptVoided) {
      primaryReceiptRefundDetails = await receiptCoveredGivingRefundDetails(primaryReceipt, tx);
      if (primaryReceiptRefundDetails.state === 'full') {
        primaryReceiptNeedsFullRefundVoid = true;
      } else if (primaryReceiptRefundDetails.state === 'partial') {
        throw new HttpsError(
          'failed-precondition',
          'One or more donations were partially refunded and need manual receipt review before an annual tax receipt can be emailed.',
          { errorCode: STRIPE_PARTIAL_REFUND_REVIEW_REASON }
        );
      } else {
        assertAnnualReceiptCoversCurrentGiving(primaryReceipt, validGiving, church.timezone);
        const includesPreviouslyReceipted = await annualGivingIncludesPreviouslyReceiptedEvidenceInTransaction(
          tx,
          validGiving,
          churchId,
          userId
        );
        requireAnnualPreviouslyReceiptedAcknowledgement(
          primaryReceipt.includesPreviouslyReceipted === true || includesPreviouslyReceipted,
          acknowledgePreviouslyReceipted
        );
        issueResult = {
          receiptId: receiptRef.id,
          receiptNumber: publicTaxReceiptNumber(primaryReceipt.receiptNumber),
          created: false,
          emailSent: taxReceiptAlreadyEmailed(primaryReceipt),
          contributionCount:
            typeof primaryReceipt.donationCount === 'number' ? primaryReceipt.donationCount : undefined,
        };
        return;
      }
    }

    if (validGiving.length === 0) {
      if (primaryReceiptNeedsFullRefundVoid) {
        voidTaxReceiptInTransaction(
          tx,
          receiptRef,
          primaryReceiptSnap,
          STRIPE_FULL_REFUND_VOID_REASON,
          'system',
          FieldValue.serverTimestamp(),
          annualReceiptSummaryPrivacyOverridesFromCoveredGivingDocs(
            primaryReceipt,
            primaryReceiptRefundDetails?.givingDocs ?? []
          )
        );
        annualReceiptFullRefundVoidedWithoutEligibleGiving = true;
        return;
      }
      throw new HttpsError('failed-precondition', 'No completed donations were found for this donor and year.');
    }
    if (validGiving.some(({ data }) => isPartiallyRefundedGiving(data))) {
      throw new HttpsError(
        'failed-precondition',
        'One or more donations were partially refunded and need manual receipt review before an annual tax receipt can be issued.',
        { errorCode: STRIPE_PARTIAL_REFUND_REVIEW_REASON }
      );
    }
    const includesPreviouslyReceipted = await annualGivingIncludesPreviouslyReceiptedEvidenceInTransaction(
      tx,
      validGiving,
      churchId,
      userId
    );
    requireAnnualPreviouslyReceiptedAcknowledgement(
      includesPreviouslyReceipted,
      acknowledgePreviouslyReceipted
    );

    const currency = assertAnnualGivingSingleCurrency(validGiving);
    const amounts = annualGivingAmountSummary(validGiving);
    const amountCents = amounts.amountCents;
    const reissueForFullRefund = primaryReceiptVoided || primaryReceiptNeedsFullRefundVoid;
    const targetReceiptRef = reissueForFullRefund
      ? db
        .collection(TAX_RECEIPTS_COLLECTION)
        .doc(reissuedAnnualTaxReceiptDocId(churchId, userId, year, amounts.correctionDigestInput))
      : receiptRef;
    if (reissueForFullRefund) {
      const existingReissueSnap = await tx.get(targetReceiptRef);
      if (existingReissueSnap.exists) {
        const existing = existingReissueSnap.data() ?? {};
        if (!isValidAnnualFullRefundReissueReceipt(
          existing,
          churchId,
          userId,
          year,
          amounts,
          validGiving.length
        )) {
          throw new HttpsError('failed-precondition', 'The existing reissued annual tax receipt requires review.');
        }
        requireAnnualPreviouslyReceiptedAcknowledgement(
          existing.includesPreviouslyReceipted === true || includesPreviouslyReceipted,
          acknowledgePreviouslyReceipted
        );
        if (primaryReceiptNeedsFullRefundVoid) {
          voidTaxReceiptInTransaction(
            tx,
            receiptRef,
            primaryReceiptSnap,
            STRIPE_FULL_REFUND_VOID_REASON,
            'system',
            FieldValue.serverTimestamp(),
            annualReceiptSummaryPrivacyOverridesFromCoveredGivingDocs(
              primaryReceipt,
              primaryReceiptRefundDetails?.givingDocs ?? []
            )
          );
        }
        issueResult = {
          receiptId: targetReceiptRef.id,
          receiptNumber: publicTaxReceiptNumber(existing.receiptNumber),
          created: false,
          emailSent: taxReceiptAlreadyEmailed(existing),
          contributionCount:
            typeof existing.donationCount === 'number' ? existing.donationCount : validGiving.length,
        };
        return;
      }
    }

    const nextSequence = nextReceiptSequenceFromCounter(counterSnap);
    const receiptNumber = receiptNumberFor(settings, churchId, year, nextSequence);
    const user = userSnap.data() ?? {};
    const member = memberSnap.data() ?? {};
    const firstGiving = validGiving[0].data;
    const publicDonorIdentity = annualPublicDonorIdentity(validGiving, user, member);
    const donorProfile = requiredDonorTaxReceiptProfile(user);
    const donorEmail = authEmail;
    if (!donorEmail) {
      throw new HttpsError(
        'failed-precondition',
        'The donor needs a verified email address before a tax receipt can be issued.',
        { errorCode: TAX_RECEIPT_MISSING_EMAIL_OR_AMOUNT_CODE }
      );
    }

    const churchName =
      optionalTrimmedString(firstGiving.churchName, 200)
      || optionalTrimmedString(church.name, 200)
      || settings.organizationName;
    const completedDates = validGiving
      .map(({ data }) => data.completedAt)
      .filter((value): value is Timestamp => value instanceof Timestamp)
      .sort((a, b) => a.toMillis() - b.toMillis());
    const issuedAt = Timestamp.now();
    const issuedDate = datePartsForReceipt(issuedAt, church.timezone);
    const now = FieldValue.serverTimestamp();
    if (primaryReceiptNeedsFullRefundVoid) {
      voidTaxReceiptInTransaction(
        tx,
        receiptRef,
        primaryReceiptSnap,
        STRIPE_FULL_REFUND_VOID_REASON,
        'system',
        now,
        annualReceiptSummaryPrivacyOverridesFromCoveredGivingDocs(
          primaryReceipt,
          primaryReceiptRefundDetails?.givingDocs ?? []
        )
      );
    }

    const receiptData = {
      churchId,
      churchName,
      userId,
      givingId: '',
      givingIds: amounts.givingIds,
      kind: 'annual',
      status: 'issued',
      pdfTemplateVersion: TAX_RECEIPT_PDF_TEMPLATE_VERSION,
      jurisdiction: settings.jurisdiction,
      receiptNumber,
      receiptYear: year,
      annualYear: year,
      organizationName: settings.organizationName,
      organizationAddress: settings.organizationAddress,
      organizationTaxId: settings.taxId,
      donorLabel: publicDonorIdentity.donorLabel,
      donorAnonymous: publicDonorIdentity.donorAnonymous,
      donorName: donorProfile.donorName,
      donorAddress: donorProfile.donorAddress,
      donorEmail,
      amountCents,
      eligibleAmountCents: amountCents,
      currency,
      purpose: 'Annual giving summary',
      donationCount: validGiving.length,
      contributions: annualContributionRecords(validGiving, church.timezone, currency),
      receivedAt: completedDates[completedDates.length - 1],
      receivedDateLabel: annualPeriodLabel(year),
      coveredPeriodLabel: annualPeriodLabel(year),
      firstContributionAt: completedDates[0],
      lastContributionAt: completedDates[completedDates.length - 1],
      issuedAt: now,
      issuedDateLabel: issuedDate.label,
      issuedBy,
      correctionForReceiptId: reissueForFullRefund ? receiptRef.id : null,
      correctionSourceReason: reissueForFullRefund ? STRIPE_FULL_REFUND_ANNUAL_REISSUE_REASON : null,
      correctedAt: reissueForFullRefund ? now : null,
      correctedBy: reissueForFullRefund ? issuedBy : null,
      goodsServicesStatement: settings.goodsServicesStatement,
      receiptIssueLocation: settings.receiptIssueLocation,
      authorizedSignerName: settings.authorizedSignerName,
      authorizedSignerTitle: settings.authorizedSignerTitle,
      secureElectronicSignatureConfigured: settings.secureElectronicSignatureConfigured,
      receiptCopiesRetentionConfirmed: settings.receiptCopiesRetentionConfirmed,
      duplicateClaimWarning: ANNUAL_TAX_RECEIPT_WARNING,
      includesPreviouslyReceipted,
      createdAt: now,
      updatedAt: now,
    };

    tx.set(targetReceiptRef, receiptData);
    const event = taxReceiptEventData({
      action: 'issued',
      actorUid: issuedBy,
      receiptId: targetReceiptRef.id,
      receipt: receiptData,
    });
    if (event) {
      tx.set(db.collection(TAX_RECEIPT_EVENTS_COLLECTION).doc(), event);
    }
    if (reissueForFullRefund) {
      const correctedEvent = taxReceiptEventData({
        action: 'corrected',
        actorUid: issuedBy,
        receiptId: targetReceiptRef.id,
        receipt: receiptData,
        reasonCode: STRIPE_FULL_REFUND_ANNUAL_REISSUE_REASON,
      });
      if (correctedEvent) {
        tx.set(db.collection(TAX_RECEIPT_EVENTS_COLLECTION).doc(), correctedEvent);
      }
    }
    const summary = annualReceiptSummaryFromReceipt(targetReceiptRef.id, receiptData, {
      ...annualReceiptSummaryPrivacyOverridesFromGivingRecords(validGiving, receiptData),
      emailSentAt: null,
      createdAt: now,
    });
    if (summary) {
      tx.set(db.collection(TAX_RECEIPT_SUMMARIES_COLLECTION).doc(targetReceiptRef.id), summary, { merge: true });
    }
    tx.set(
      counterRef,
      {
        churchId,
        year,
        lastSequence: nextSequence,
        updatedAt: now,
      },
      { merge: true }
    );

    issueResult = {
      receiptId: targetReceiptRef.id,
      receiptNumber,
      created: true,
      emailSent: false,
      contributionCount: validGiving.length,
    };
  });

  if (annualReceiptFullRefundVoidedWithoutEligibleGiving) {
    throw new HttpsError(
      'failed-precondition',
      'This annual tax receipt has been voided because all covered donations were fully refunded.'
    );
  }
  if (!issueResult) {
    throw new HttpsError('internal', 'Unable to issue annual tax receipt.');
  }
  return issueResult;
}

type ScheduledAnnualPreparationResult = {
  churchId: string;
  year: number;
  donorCount: number;
  preparedCount: number;
  existingCount: number;
  emailSentCount: number;
  skippedAlreadyEmailedCount: number;
  skippedPartialRefundCount: number;
  skippedMixedCurrencyCount: number;
  skippedPreviouslyReceiptedCount: number;
  skippedLimitCount: number;
  failedCount: number;
  truncated: boolean;
};

type ScheduledActiveChurchScanResult = {
  docs: FirebaseFirestore.QueryDocumentSnapshot[];
  truncated: boolean;
};

function annualReceiptPreparationOptedIn(church: FirebaseFirestore.DocumentData): boolean {
  const raw = church.taxReceiptSettings;
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return false;
  }
  const settings = raw as Record<string, unknown>;
  return settings.enabled === true
    && settings.jurisdiction === 'US'
    && settings.annualPreparationEnabled === true;
}

function annualReceiptAutoEmailOptedIn(church: FirebaseFirestore.DocumentData): boolean {
  const raw = church.taxReceiptSettings;
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return false;
  }
  const settings = raw as Record<string, unknown>;
  return settings.enabled === true
    && settings.jurisdiction === 'US'
    && settings.annualPreparationEnabled === true
    && settings.annualAutoEmailEnabled === true;
}

async function loadActiveChurchesForScheduledAnnualPreparation(): Promise<ScheduledActiveChurchScanResult> {
  const docs: FirebaseFirestore.QueryDocumentSnapshot[] = [];
  const baseQuery = db
    .collection('churches')
    .where('isActive', '==', true)
    .orderBy(FieldPath.documentId());
  let lastDoc: FirebaseFirestore.QueryDocumentSnapshot | null = null;
  let scannedCount = 0;
  let truncated = false;

  while (true) {
    const remainingScanBudget = SCHEDULED_ANNUAL_CHURCH_SCAN_LIMIT - scannedCount;
    if (remainingScanBudget <= 0) {
      truncated = true;
      break;
    }

    const pageSize = Math.min(SCHEDULED_ANNUAL_CHURCH_PAGE_SIZE, remainingScanBudget);
    let pageQuery: FirebaseFirestore.Query = baseQuery.limit(pageSize);
    if (lastDoc) {
      pageQuery = baseQuery.startAfter(lastDoc).limit(pageSize);
    }

    const snap = await pageQuery.get();
    if (snap.empty) {
      break;
    }

    docs.push(...snap.docs);
    scannedCount += snap.docs.length;
    if (snap.docs.length < pageSize) {
      break;
    }

    lastDoc = snap.docs[snap.docs.length - 1];
    if (scannedCount >= SCHEDULED_ANNUAL_CHURCH_SCAN_LIMIT) {
      truncated = true;
      break;
    }
  }

  return { docs, truncated };
}

function previousClosedAnnualReceiptYear(timezone: unknown): number {
  return datePartsForReceipt(Timestamp.now(), timezone).year - 1;
}

async function prepareAnnualTaxReceiptsForChurch(
  churchId: string,
  church: FirebaseFirestore.DocumentData
): Promise<ScheduledAnnualPreparationResult> {
  const year = previousClosedAnnualReceiptYear(church.timezone);
  const result: ScheduledAnnualPreparationResult = {
    churchId,
    year,
    donorCount: 0,
    preparedCount: 0,
    existingCount: 0,
    emailSentCount: 0,
    skippedAlreadyEmailedCount: 0,
    skippedPartialRefundCount: 0,
    skippedMixedCurrencyCount: 0,
    skippedPreviouslyReceiptedCount: 0,
    skippedLimitCount: 0,
    failedCount: 0,
    truncated: false,
  };

  const settings = parseTaxReceiptSettings(church);
  if (!settings?.annualPreparationEnabled) {
    return result;
  }
  const shouldAutoEmail = annualReceiptAutoEmailOptedIn(church);
  assertActiveChurchForTaxReceiptIssuance(church);
  assertAnnualReceiptYearClosed(year, church.timezone);

  const { entries, sourceTruncated } = await loadAnnualDonorEntriesForChurch(churchId, year, church.timezone);
  result.donorCount = entries.length;
  result.truncated = sourceTruncated;

  let attemptedCount = 0;
  for (const entry of entries) {
    if (entry.hasMixedCurrency) {
      result.skippedMixedCurrencyCount += 1;
      continue;
    }
    if (entry.hasPartialRefund) {
      result.skippedPartialRefundCount += 1;
      continue;
    }
    if (await annualGivingIncludesPreviouslyReceiptedEvidence(entry.validGiving, churchId, entry.userId)) {
      result.skippedPreviouslyReceiptedCount += 1;
      continue;
    }
    if (attemptedCount >= SCHEDULED_ANNUAL_DONOR_LIMIT_PER_CHURCH) {
      result.skippedLimitCount += 1;
      continue;
    }

    attemptedCount += 1;
    try {
      const receipt = await issueAnnualTaxReceiptForDonor(
        churchId,
        entry.userId,
        year,
        SCHEDULED_ANNUAL_RECEIPT_ACTOR_UID,
        false
      );
      if (receipt.created) {
        result.preparedCount += 1;
      } else {
        result.existingCount += 1;
      }
      if (shouldAutoEmail) {
        if (receipt.emailSent === true) {
          result.skippedAlreadyEmailedCount += 1;
        } else {
          await sendTaxReceiptEmail(receipt.receiptId, SCHEDULED_ANNUAL_RECEIPT_ACTOR_UID);
          result.emailSentCount += 1;
        }
      }
    } catch (error) {
      result.failedCount += 1;
      const code = failureCodeForAnnualReceipt(error);
      await persistAnnualTaxReceiptIssueFailureSummary(churchId, entry.userId, year, 'annual', error);
      console.error('Scheduled annual tax receipt preparation item failed:', {
        churchId,
        year,
        ...sanitizedErrorContext(error),
      });
      await logTaxReceiptEvent({
        action: 'annual_scheduled_item_failed',
        actorUid: SCHEDULED_ANNUAL_RECEIPT_ACTOR_UID,
        churchId,
        userId: entry.userId,
        kind: 'annual',
        receiptYear: year,
        errorCode: code,
      });
    }
  }

  return result;
}

async function logScheduledAnnualPreparationReviewSummaries(
  result: ScheduledAnnualPreparationResult
): Promise<void> {
  const reviewSummaries = [
    {
      count: result.skippedPartialRefundCount,
      errorCode: STRIPE_PARTIAL_REFUND_REVIEW_REASON,
    },
    {
      count: result.skippedMixedCurrencyCount,
      errorCode: ANNUAL_RECEIPT_MIXED_CURRENCY_REVIEW_CODE,
    },
    {
      count: result.skippedPreviouslyReceiptedCount,
      errorCode: PREVIOUSLY_RECEIPTED_ACK_REQUIRED_CODE,
    },
  ];

  await Promise.all(reviewSummaries
    .filter((summary) => summary.count > 0)
    .map((summary) => logTaxReceiptEvent({
      action: 'annual_scheduled_review_summary',
      actorUid: SCHEDULED_ANNUAL_RECEIPT_ACTOR_UID,
      churchId: result.churchId,
      kind: 'annual',
      receiptYear: result.year,
      errorCode: summary.errorCode,
      reviewCount: summary.count,
    })));
}

export const prepareYearEndAnnualTaxReceipts = onSchedule(
  {
    schedule: 'every 24 hours',
    region: SCHEDULE_REGION,
    timeZone: 'Etc/UTC',
    retryCount: 0,
    secrets: ['RESEND_API_KEY'],
  },
  async () => {
    const activeChurchScan = await loadActiveChurchesForScheduledAnnualPreparation();
    const results: ScheduledAnnualPreparationResult[] = [];
    let skippedChurchCount = 0;
    let failedChurchCount = 0;

    for (const churchDoc of activeChurchScan.docs) {
      const church = churchDoc.data();
      if (!annualReceiptPreparationOptedIn(church)) {
        skippedChurchCount += 1;
        continue;
      }

      try {
        const result = await prepareAnnualTaxReceiptsForChurch(churchDoc.id, church);
        await logScheduledAnnualPreparationReviewSummaries(result);
        results.push(result);
      } catch (error) {
        failedChurchCount += 1;
        console.error('Scheduled annual tax receipt preparation failed:', {
          churchId: churchDoc.id,
          ...sanitizedErrorContext(error),
        });
      }
    }

    console.log('Scheduled annual tax receipt preparation completed:', {
      scannedChurchCount: activeChurchScan.docs.length,
      activeChurchScanTruncated: activeChurchScan.truncated,
      optedInChurchCount: results.length,
      skippedChurchCount,
      failedChurchCount,
      preparedCount: results.reduce((sum, item) => sum + item.preparedCount, 0),
      existingCount: results.reduce((sum, item) => sum + item.existingCount, 0),
      emailSentCount: results.reduce((sum, item) => sum + item.emailSentCount, 0),
      skippedAlreadyEmailedCount:
        results.reduce((sum, item) => sum + item.skippedAlreadyEmailedCount, 0),
      skippedPartialRefundCount: results.reduce((sum, item) => sum + item.skippedPartialRefundCount, 0),
      skippedMixedCurrencyCount: results.reduce((sum, item) => sum + item.skippedMixedCurrencyCount, 0),
      skippedPreviouslyReceiptedCount: results.reduce((sum, item) => sum + item.skippedPreviouslyReceiptedCount, 0),
      skippedLimitCount: results.reduce((sum, item) => sum + item.skippedLimitCount, 0),
      failedItemCount: results.reduce((sum, item) => sum + item.failedCount, 0),
      truncatedChurchCount: results.filter((item) => item.truncated).length,
    });
  }
);

async function recordTaxReceiptEmailFailure(
  receiptRef: FirebaseFirestore.DocumentReference,
  receiptId: string,
  receipt: Record<string, unknown>,
  actorUid: string,
  errorCode: string
): Promise<void> {
  const now = FieldValue.serverTimestamp();
  const wasAlreadySent = taxReceiptAlreadyEmailed(receipt);
  const failureStatus = wasAlreadySent ? 'sent' : 'error';
  await receiptRef.update({
    status: failureStatus,
    emailSendingAt: FieldValue.delete(),
    emailSendAttemptId: FieldValue.delete(),
    emailError: errorCode,
    emailFailedAt: now,
    updatedAt: now,
  }).catch(() => undefined);
  await upsertAnnualReceiptSummary(receiptId, receipt, {
    status: failureStatus,
    emailError: errorCode,
    emailFailedAt: FieldValue.serverTimestamp(),
  }).catch(() => undefined);

  const givingId = optionalTrimmedString(receipt.givingId, 128);
  if (givingId) {
    const givingUpdate: Record<string, unknown> = {
      taxReceiptStatus: failureStatus,
      taxReceiptEmailError: errorCode,
      updatedAt: FieldValue.serverTimestamp(),
    };
    if (failureStatus === 'error') {
      givingUpdate.taxReceiptError = errorCode;
    } else {
      givingUpdate.taxReceiptError = FieldValue.delete();
    }
    await db.collection('giving').doc(givingId).update(givingUpdate).catch(() => undefined);
  }

  await logTaxReceiptEvent({
    action: 'email_failed',
    actorUid,
    receiptId,
    receipt,
    errorCode,
  });
}

async function assertAnnualReceiptCurrentForEmailDelivery(
  receiptRef: FirebaseFirestore.DocumentReference,
  receiptId: string,
  receipt: Record<string, unknown>,
  actorUid: string
): Promise<void> {
  try {
    await assertAnnualReceiptCoversCurrentGivingForAction(receipt, 'emailed');
  } catch (error) {
    const detailCode = safeHttpsErrorDetailCode(error);
    const errorCode = detailCode || 'tax_receipt_preparation_failed';
    console.error('Tax receipt annual giving-set verification failed:', sanitizedErrorContext(error));
    await recordTaxReceiptEmailFailure(
      receiptRef,
      receiptId,
      receipt,
      actorUid,
      errorCode
    );
    if (error instanceof HttpsError && detailCode) {
      throw error;
    }
    throw taxReceiptPreparationFailedHttpsError('Tax receipt email could not be prepared.');
  }
}

async function assertSingleReceiptCurrentForEmailDelivery(
  receiptRef: FirebaseFirestore.DocumentReference,
  receiptId: string,
  receipt: Record<string, unknown>,
  actorUid: string
): Promise<void> {
  try {
    await assertSingleReceiptMatchesCurrentGivingForAction(receipt, 'emailed');
  } catch (error) {
    const detailCode = safeHttpsErrorDetailCode(error);
    const errorCode = detailCode || 'tax_receipt_preparation_failed';
    console.error('Tax receipt single-donation verification failed:', sanitizedErrorContext(error));
    await recordTaxReceiptEmailFailure(
      receiptRef,
      receiptId,
      receipt,
      actorUid,
      errorCode
    );
    if (error instanceof HttpsError && detailCode) {
      throw error;
    }
    throw taxReceiptPreparationFailedHttpsError('Tax receipt email could not be prepared.');
  }
}

export async function assertSingleReceiptCurrentForPdfDownload(receipt: Record<string, unknown>): Promise<void> {
  try {
    await assertSingleReceiptMatchesCurrentGivingForAction(receipt, 'downloaded');
  } catch (error) {
    if (error instanceof HttpsError && safeHttpsErrorDetailCode(error)) {
      throw error;
    }
    console.error('Tax receipt single-donation download verification failed:', sanitizedErrorContext(error));
    throw taxReceiptPreparationFailedHttpsError('Tax receipt PDF could not be prepared.');
  }
}

export async function assertAnnualReceiptCurrentForPdfDownload(receipt: Record<string, unknown>): Promise<void> {
  try {
    await assertAnnualReceiptCoversCurrentGivingForAction(receipt, 'downloaded');
  } catch (error) {
    if (error instanceof HttpsError && safeHttpsErrorDetailCode(error)) {
      throw error;
    }
    console.error('Tax receipt annual download verification failed:', sanitizedErrorContext(error));
    throw taxReceiptPreparationFailedHttpsError('Tax receipt PDF could not be prepared.');
  }
}

async function claimTaxReceiptEmailSend(
  receiptRef: FirebaseFirestore.DocumentReference
): Promise<Record<string, unknown>> {
  let claimedReceipt: Record<string, unknown> | null = null;
  const claimState = {
    blockedByRefundState: 'none' as ReceiptCoveredGivingRefundState,
  };

  await db.runTransaction(async (tx) => {
    const receiptSnap = await tx.get(receiptRef);
    if (!receiptSnap.exists) {
      throw new HttpsError('not-found', 'Tax receipt not found.');
    }

    const receipt = receiptSnap.data() ?? {};
    if (optionalTrimmedString(receipt.status, 20) === 'voided') {
      throw new HttpsError('failed-precondition', 'This tax receipt has been voided and cannot be emailed.');
    }
    if (receipt.correctionRequired === true || optionalTrimmedString(receipt.correctionReason, 120)) {
      throw new HttpsError('failed-precondition', 'This tax receipt requires review before it can be emailed.');
    }
    const refundDetails = await receiptCoveredGivingRefundDetails(receipt, tx);
    claimState.blockedByRefundState = applyReceiptCoveredGivingRefundStateInTransaction(
      tx,
      receiptRef,
      receiptSnap,
      receipt,
      refundDetails,
      FieldValue.serverTimestamp()
    );
    if (claimState.blockedByRefundState !== 'none') {
      return;
    }
    if (taxReceiptEmailSendClaimIsFresh(receipt)) {
      throw new HttpsError('aborted', 'This tax receipt email is already being sent.');
    }

    const sendingAt = receipt.emailSendingAt;
    const staleClaimCanReuseAttempt =
      sendingAt instanceof Timestamp
      && Date.now() - sendingAt.toMillis() >= RECEIPT_CLAIM_TIMEOUT_MS;
    const existingAttemptId = staleClaimCanReuseAttempt
      ? taxReceiptEmailSendAttemptId(receipt.emailSendAttemptId)
      : '';
    const emailSendAttemptId = existingAttemptId || newTaxReceiptEmailSendAttemptId();

    tx.update(receiptRef, {
      emailSendingAt: FieldValue.serverTimestamp(),
      emailSendAttemptId,
      emailError: FieldValue.delete(),
      emailFailedAt: FieldValue.delete(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    claimedReceipt = { ...receipt, emailSendAttemptId };
  });

  if (claimState.blockedByRefundState === 'full') {
    throw new HttpsError(
      'failed-precondition',
      'This tax receipt has been voided because one or more covered donations were fully refunded.'
    );
  }
  if (claimState.blockedByRefundState === 'partial') {
    throw new HttpsError(
      'failed-precondition',
      'This tax receipt requires review because one or more covered donations were partially refunded.',
      { errorCode: STRIPE_PARTIAL_REFUND_REVIEW_REASON }
    );
  }
  if (!claimedReceipt) {
    throw new HttpsError('internal', 'Unable to claim tax receipt email send.');
  }

  return claimedReceipt;
}

export function taxReceiptPdfInputFromReceipt(
  receiptId: string,
  receipt: Record<string, unknown>
): TaxReceiptPdfInput {
  const donorName = optionalTrimmedString(receipt.donorName, 160) || 'Parishioner';
  const donorAddress = optionalTrimmedString(receipt.donorAddress, 700);
  const churchName = optionalTrimmedString(receipt.churchName, 200) || 'your parish';
  const organizationName = optionalTrimmedString(receipt.organizationName, 200) || churchName;
  const amountCents = typeof receipt.amountCents === 'number' ? receipt.amountCents : 0;
  const eligibleAmountCents =
    typeof receipt.eligibleAmountCents === 'number' ? receipt.eligibleAmountCents : amountCents;
  const { kind, currency } = assertTaxReceiptPdfRenderableReceipt(receipt);
  const originalAmountCents =
    typeof receipt.originalAmountCents === 'number' ? receipt.originalAmountCents : 0;
  const refundedAmountCents =
    typeof receipt.refundedAmountCents === 'number' ? receipt.refundedAmountCents : 0;
  const isCorrectedReceipt = taxReceiptRecordIsCorrected(receipt);
  if (kind === 'annual' && !Array.isArray(receipt.contributions)) {
    throw new HttpsError(
      'failed-precondition',
      'Annual tax receipt contribution detail is missing.',
      { errorCode: 'tax_receipt_preparation_failed' }
    );
  }

  const contributionRecords = Array.isArray(receipt.contributions) ? receipt.contributions : [];
  const contributions: TaxReceiptPdfContribution[] = [];
  let contributionAmountTotalCents = 0;
  let contributionEligibleTotalCents = 0;
  for (const entry of contributionRecords) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      if (kind === 'annual') {
        throw new HttpsError(
          'failed-precondition',
          'Annual tax receipt contribution detail is incomplete.',
          { errorCode: 'tax_receipt_preparation_failed' }
        );
      }
      continue;
    }
    const record = entry as Record<string, unknown>;
    const rawContributionCurrency = optionalTrimmedString(record.currency, 10);
    const contributionCurrency = rawContributionCurrency
      ? normalizedTaxReceiptCurrency(rawContributionCurrency)
      : currency;
    if (!contributionCurrency) {
      throw new HttpsError(
        'failed-precondition',
        'Tax receipt contribution currency is missing or unsupported for official PDF delivery.',
        { errorCode: TAX_RECEIPT_INVALID_CURRENCY_CODE }
      );
    }
    if (kind === 'annual' && contributionCurrency !== currency) {
      throw new HttpsError(
        'failed-precondition',
        'Annual tax receipt contribution currency does not match the receipt currency.',
        { errorCode: 'tax_receipt_preparation_failed' }
      );
    }
    const contributionAmountCents =
      typeof record.amountCents === 'number' ? record.amountCents : 0;
    const contributionEligibleAmountCents =
      typeof record.eligibleAmountCents === 'number'
        ? record.eligibleAmountCents
        : contributionAmountCents;
    if (
      !Number.isInteger(contributionAmountCents)
      || contributionAmountCents <= 0
      || !Number.isInteger(contributionEligibleAmountCents)
      || contributionEligibleAmountCents <= 0
      || contributionEligibleAmountCents > contributionAmountCents
    ) {
      if (kind === 'annual') {
        throw new HttpsError(
          'failed-precondition',
          'Annual tax receipt contribution detail is incomplete.',
          { errorCode: 'tax_receipt_preparation_failed' }
        );
      }
      continue;
    }
    contributionAmountTotalCents += contributionAmountCents;
    contributionEligibleTotalCents += contributionEligibleAmountCents;
    contributions.push({
      dateLabel: optionalTrimmedString(record.dateLabel, 80) || 'Recorded donation date',
      purpose: optionalTrimmedString(record.purpose, 200) || 'General Fund',
      amount: formatCurrency(contributionAmountCents, contributionCurrency),
      eligibleAmount: formatCurrency(contributionEligibleAmountCents, contributionCurrency),
    });
  }

  if (amountCents <= 0) {
    throw new HttpsError('failed-precondition', 'Tax receipt is missing amount details.');
  }
  if (kind === 'annual') {
    const donationCount = typeof receipt.donationCount === 'number' ? receipt.donationCount : 0;
    const expectedContributionAmountTotalCents =
      originalAmountCents > 0 && refundedAmountCents > 0 ? originalAmountCents : amountCents;
    if (
      !Number.isInteger(donationCount)
      || donationCount <= 0
      || contributions.length !== donationCount
    ) {
      throw new HttpsError(
        'failed-precondition',
        'Annual tax receipt contribution detail does not match the donation count.',
        { errorCode: 'tax_receipt_preparation_failed' }
      );
    }
    if (
      contributionAmountTotalCents !== expectedContributionAmountTotalCents
      || contributionEligibleTotalCents !== eligibleAmountCents
    ) {
      throw new HttpsError(
        'failed-precondition',
        'Annual tax receipt contribution detail does not match the receipt totals.',
        { errorCode: 'tax_receipt_preparation_failed' }
      );
    }
  }

  return {
    receiptId,
    donorName,
    donorAddress,
    churchName,
    organizationName,
    formattedAmount: formatCurrency(amountCents, currency),
    eligibleAmount: formatCurrency(eligibleAmountCents, currency),
    purpose: optionalTrimmedString(receipt.purpose, 200) || 'General Fund',
    receivedDateLabel: optionalTrimmedString(receipt.receivedDateLabel, 80) || 'Recorded donation date',
    issuedDateLabel: optionalTrimmedString(receipt.issuedDateLabel, 80) || new Date().toLocaleDateString('en-US'),
    receiptNumber: publicTaxReceiptNumber(receipt.receiptNumber),
    goodsServicesStatement:
      optionalTrimmedString(receipt.goodsServicesStatement, 500)
      || DEFAULT_TAX_GOODS_SERVICES_STATEMENT,
    coveredPeriodLabel: optionalTrimmedString(receipt.coveredPeriodLabel, 120),
    contributionCount: typeof receipt.donationCount === 'number' ? receipt.donationCount : undefined,
    contributions,
    annualSummaryNote:
      kind === 'annual'
        ? optionalTrimmedString(receipt.duplicateClaimWarning, 500) || ANNUAL_TAX_RECEIPT_WARNING
        : undefined,
    correctionLabel: isCorrectedReceipt ? 'Corrected receipt' : undefined,
    correctionNote: isCorrectedReceipt ? CORRECTED_TAX_RECEIPT_NOTE : undefined,
    originalAmount: originalAmountCents > 0 ? formatCurrency(originalAmountCents, currency) : undefined,
    refundedAmount: refundedAmountCents > 0 ? formatCurrency(refundedAmountCents, currency) : undefined,
    pdfTemplateVersion:
      optionalTrimmedString(receipt.pdfTemplateVersion, 80)
      || UNVERSIONED_TAX_RECEIPT_PDF_TEMPLATE_VERSION,
    jurisdiction: optionalTrimmedString(receipt.jurisdiction, 10),
    taxId: optionalTrimmedString(receipt.organizationTaxId, 80),
    organizationAddress: optionalTrimmedString(receipt.organizationAddress, 500),
    receiptIssueLocation: optionalTrimmedString(receipt.receiptIssueLocation, 120),
    authorizedSignerName: optionalTrimmedString(receipt.authorizedSignerName, 160),
    authorizedSignerTitle: optionalTrimmedString(receipt.authorizedSignerTitle, 120),
    secureElectronicSignatureConfigured: receipt.secureElectronicSignatureConfigured === true,
    receiptCopiesRetentionConfirmed: receipt.receiptCopiesRetentionConfirmed === true,
  };
}

export async function sendTaxReceiptEmail(receiptId: string, actorUid = 'system'): Promise<void> {
  if (!TAX_RECEIPT_ID_PATTERN.test(receiptId)) {
    throw new HttpsError('invalid-argument', 'receiptId is invalid.');
  }

  const receiptRef = db.collection(TAX_RECEIPTS_COLLECTION).doc(receiptId);
  const receipt = await claimTaxReceiptEmailSend(receiptRef);
  await assertSingleReceiptCurrentForEmailDelivery(receiptRef, receiptId, receipt, actorUid);
  await assertAnnualReceiptCurrentForEmailDelivery(receiptRef, receiptId, receipt, actorUid);
  let receiptUserId = '';
  let storedDonorEmail = '';
  let authDonorEmail = '';
  let donorEmail = '';
  let givingId = '';
  let preparationFailureRecorded = false;
  let taxReceiptDeliveryDetails: TaxReceiptPdfInput;
  let emailMessage: ReturnType<typeof renderTaxReceiptEmail>;

  try {
    receiptUserId = optionalTrimmedString(receipt.userId, 128);
    storedDonorEmail = optionalTrimmedString(receipt.donorEmail, 254);
    authDonorEmail =
      receiptUserId ? (await getPrimaryVerifiedEmailsForUids([receiptUserId]))[0] ?? '' : '';
    donorEmail = authDonorEmail || storedDonorEmail;
    givingId = optionalTrimmedString(receipt.givingId, 128);
    const amountCents = typeof receipt.amountCents === 'number' ? receipt.amountCents : 0;

    if (!donorEmail || amountCents <= 0) {
      await recordTaxReceiptEmailFailure(
        receiptRef,
        receiptId,
        receipt,
        actorUid,
        TAX_RECEIPT_MISSING_EMAIL_OR_AMOUNT_CODE
      );
      preparationFailureRecorded = true;
      throw new HttpsError(
        'failed-precondition',
        'Tax receipt is missing email or amount details.',
        { errorCode: TAX_RECEIPT_MISSING_EMAIL_OR_AMOUNT_CODE }
      );
    }

    const unsupportedJurisdiction = await unsupportedOfficialReceiptDeliveryJurisdictionForReceipt(receipt);
    if (unsupportedJurisdiction) {
      await recordTaxReceiptEmailFailure(
        receiptRef,
        receiptId,
        receipt,
        actorUid,
        TAX_RECEIPT_UNSUPPORTED_JURISDICTION_CODE
      );
      preparationFailureRecorded = true;
      throw new HttpsError(
        'failed-precondition',
        unsupportedOfficialReceiptDeliveryMessage(unsupportedJurisdiction),
        { errorCode: TAX_RECEIPT_UNSUPPORTED_JURISDICTION_CODE }
      );
    }
    try {
      assertStoredOfficialReceiptNumber(receipt);
    } catch (error) {
      await recordTaxReceiptEmailFailure(
        receiptRef,
        receiptId,
        receipt,
        actorUid,
        TAX_RECEIPT_MISSING_RECEIPT_NUMBER_CODE
      );
      preparationFailureRecorded = true;
      throw error;
    }

    taxReceiptDeliveryDetails = taxReceiptPdfInputFromReceipt(receiptId, receipt);
    emailMessage = renderTaxReceiptEmail(taxReceiptDeliveryDetails);
  } catch (error) {
    if (error instanceof HttpsError && preparationFailureRecorded) {
      throw error;
    }
    const detailCode = safeHttpsErrorDetailCode(error);
    const errorCode = detailCode || 'tax_receipt_preparation_failed';
    console.error('Tax receipt email preparation failed:', sanitizedErrorContext(error));
    await recordTaxReceiptEmailFailure(
      receiptRef,
      receiptId,
      receipt,
      actorUid,
      errorCode
    );
    if (error instanceof HttpsError && detailCode) {
      throw error;
    }
    throw new HttpsError(
      'internal',
      'Tax receipt email could not be prepared.',
      { errorCode }
    );
  }

  let pdfAttachment: TaxReceiptPdfAttachment | null = null;
  try {
    pdfAttachment = await loadRetainedTaxReceiptPdfAttachment(receiptId, receipt);
  } catch (error) {
    console.error('Tax receipt PDF retention verification failed:', sanitizedErrorContext(error));
    await recordTaxReceiptEmailFailure(
      receiptRef,
      receiptId,
      receipt,
      actorUid,
      TAX_RECEIPT_PDF_RETENTION_FAILED_CODE
    );
    throw new HttpsError(
      'internal',
      'Tax receipt PDF copy could not be verified.',
      { errorCode: TAX_RECEIPT_PDF_RETENTION_FAILED_CODE }
    );
  }

  if (!pdfAttachment) {
    let renderedAttachment: TaxReceiptPdfAttachment;
    try {
      renderedAttachment = await renderTaxReceiptPdfAttachment(taxReceiptDeliveryDetails);
    } catch (error) {
      console.error('Tax receipt PDF generation failed:', sanitizedErrorContext(error));
      await recordTaxReceiptEmailFailure(
        receiptRef,
        receiptId,
        receipt,
        actorUid,
        'tax_receipt_pdf_failed'
      );
      throw new HttpsError(
        'internal',
        'Tax receipt PDF could not be generated.',
        { errorCode: 'tax_receipt_pdf_failed' }
      );
    }
    pdfAttachment = renderedAttachment;
    await assertSingleReceiptCurrentForEmailDelivery(receiptRef, receiptId, receipt, actorUid);
    await assertAnnualReceiptCurrentForEmailDelivery(receiptRef, receiptId, receipt, actorUid);
    try {
      await retainTaxReceiptPdfAttachment(receiptRef, receiptId, receipt, renderedAttachment);
    } catch (error) {
      console.error('Tax receipt PDF retention failed:', sanitizedErrorContext(error));
      await recordTaxReceiptEmailFailure(
        receiptRef,
        receiptId,
        receipt,
        actorUid,
        TAX_RECEIPT_PDF_RETENTION_FAILED_CODE
      );
      throw new HttpsError(
        'internal',
        'Tax receipt PDF copy could not be retained.',
        { errorCode: TAX_RECEIPT_PDF_RETENTION_FAILED_CODE }
      );
    }
  }

  if (!pdfAttachment) {
    throw new HttpsError('internal', 'Tax receipt PDF could not be prepared.');
  }

  await assertSingleReceiptCurrentForEmailDelivery(receiptRef, receiptId, receipt, actorUid);
  await assertAnnualReceiptCurrentForEmailDelivery(receiptRef, receiptId, receipt, actorUid);
  const emailSendAttemptId = taxReceiptEmailSendAttemptId(receipt.emailSendAttemptId);
  if (!emailSendAttemptId) {
    await recordTaxReceiptEmailFailure(
      receiptRef,
      receiptId,
      receipt,
      actorUid,
      'tax_receipt_send_failed'
    );
    throw new HttpsError(
      'internal',
      'Tax receipt email could not be sent.',
      { errorCode: 'tax_receipt_send_failed' }
    );
  }
  const idempotencyKey = taxReceiptEmailIdempotencyKey(receiptId, emailSendAttemptId);

  try {
    const resend = getResend();
    const response = await resend.emails.send({
      from: 'Kandilo <giving@kandilo.org>',
      to: donorEmail,
      subject: emailMessage.subject,
      html: emailMessage.html,
      text: emailMessage.text,
      attachments: [pdfAttachment],
    }, { idempotencyKey });
    if (response.error) {
      console.error('Tax receipt email provider rejected request.', {
        errorName: response.error.name ?? 'ResendError',
      });
      await recordTaxReceiptEmailFailure(
        receiptRef,
        receiptId,
        receipt,
        actorUid,
        'tax_receipt_provider_rejected'
      );
      throw new HttpsError(
        'internal',
        'Tax receipt email could not be sent.',
        { errorCode: 'tax_receipt_provider_rejected' }
      );
    }
  } catch (error) {
    if (error instanceof HttpsError) {
      throw error;
    }
    console.error('Tax receipt email send failed:', sanitizedErrorContext(error));
    const errorCode = resendConfigurationErrorCode(error) ?? 'tax_receipt_send_failed';
    await recordTaxReceiptEmailFailure(
      receiptRef,
      receiptId,
      receipt,
      actorUid,
      errorCode
    );
    throw new HttpsError(
      'internal',
      'Tax receipt email could not be sent.',
      { errorCode }
    );
  }

  const update: Record<string, unknown> = {
    status: 'sent',
    emailSendingAt: FieldValue.delete(),
    emailSendAttemptId: FieldValue.delete(),
    emailSentAt: FieldValue.serverTimestamp(),
    emailError: FieldValue.delete(),
    emailFailedAt: FieldValue.delete(),
    updatedAt: FieldValue.serverTimestamp(),
  };
  if (authDonorEmail && authDonorEmail !== storedDonorEmail) {
    update.donorEmail = authDonorEmail;
  }
  await receiptRef.update(update);
  await upsertAnnualReceiptSummary(receiptRef.id, receipt, {
    status: 'sent',
    emailSentAt: FieldValue.serverTimestamp(),
    emailError: FieldValue.delete(),
    emailFailedAt: FieldValue.delete(),
  });
  if (givingId) {
    const givingRef = db.collection('giving').doc(givingId);
    const givingSnap = await givingRef.get().catch(() => null);
    const givingIsChurchVisible = givingSnap ? givingIsExplicitlyNonAnonymous(givingSnap.data() ?? {}) : false;
    const givingUpdate: Record<string, unknown> = {
      taxReceiptStatus: 'sent',
      taxReceiptSentAt: FieldValue.serverTimestamp(),
      taxReceiptError: FieldValue.delete(),
      taxReceiptEmailError: FieldValue.delete(),
      updatedAt: FieldValue.serverTimestamp(),
    };
    if (givingIsChurchVisible) {
      givingUpdate.donorName =
        publicDonorLabelCandidate(givingSnap?.data()?.donorName)
        || publicDonorLabelCandidate(receipt.donorLabel)
        || 'Parishioner';
      givingUpdate.donorEmail = '';
      givingUpdate.donorNamePublicSafe = true;
      givingUpdate.churchReceiptVisible = true;
      givingUpdate.receiptManagerGivingSafeVersion = RECEIPT_MANAGER_GIVING_SAFE_VERSION;
    } else {
      givingUpdate.donorName = ANONYMOUS_DONOR_LABEL;
      givingUpdate.donorEmail = '';
      givingUpdate.donorNamePublicSafe = false;
      givingUpdate.churchReceiptVisible = false;
      givingUpdate.receiptManagerGivingSafeVersion = 0;
    }
    await givingRef.update(givingUpdate).catch(() => undefined);
  }
  await logTaxReceiptEvent({
    action: 'email_sent',
    actorUid,
    receiptId,
    receipt,
  });
}

export async function loadReceiptForPdfDownload(
  receiptRef: FirebaseFirestore.DocumentReference,
  requesterUid: string
): Promise<Record<string, unknown>> {
  let receiptForDownload: Record<string, unknown> | null = null;
  const downloadState = {
    blockedByRefundState: 'none' as ReceiptCoveredGivingRefundState,
  };

  await db.runTransaction(async (tx) => {
    const receiptSnap = await tx.get(receiptRef);
    if (!receiptSnap.exists) {
      throw new HttpsError('not-found', 'Tax receipt not found.');
    }

    const receipt = receiptSnap.data() ?? {};
    if (optionalTrimmedString(receipt.userId, 128) !== requesterUid) {
      throw new HttpsError('permission-denied', 'Only the donor can download this tax receipt.');
    }
    if (optionalTrimmedString(receipt.status, 20) === 'voided') {
      throw new HttpsError('failed-precondition', 'This tax receipt has been voided and cannot be downloaded.');
    }
    if (receipt.correctionRequired === true || optionalTrimmedString(receipt.correctionReason, 120)) {
      throw new HttpsError('failed-precondition', 'This tax receipt requires review before it can be downloaded.');
    }
    assertStoredOfficialReceiptNumber(receipt);

    const refundDetails = await receiptCoveredGivingRefundDetails(receipt, tx);
    downloadState.blockedByRefundState = applyReceiptCoveredGivingRefundStateInTransaction(
      tx,
      receiptRef,
      receiptSnap,
      receipt,
      refundDetails,
      FieldValue.serverTimestamp()
    );
    if (downloadState.blockedByRefundState !== 'none') {
      return;
    }

    receiptForDownload = receipt;
  });

  if (downloadState.blockedByRefundState === 'full') {
    throw new HttpsError(
      'failed-precondition',
      'This tax receipt has been voided because one or more covered donations were fully refunded.'
    );
  }
  if (downloadState.blockedByRefundState === 'partial') {
    throw new HttpsError(
      'failed-precondition',
      'This tax receipt requires review because one or more covered donations were partially refunded.',
      { errorCode: STRIPE_PARTIAL_REFUND_REVIEW_REASON }
    );
  }
  if (!receiptForDownload) {
    throw new HttpsError('internal', 'Unable to load tax receipt.');
  }

  return receiptForDownload;
}

function markTaxReceiptReviewRequiredInTransaction(
  tx: FirebaseFirestore.Transaction,
  receiptRef: FirebaseFirestore.DocumentReference,
  receiptSnap: FirebaseFirestore.DocumentSnapshot,
  reasonCode: string,
  actorUid: string,
  now: FirebaseFirestore.FieldValue,
  summaryPrivacyOverrides: AnnualReceiptSummaryPrivacyOverrides = annualReceiptSummaryDonorOnlyPrivacyOverrides()
): boolean {
  if (!receiptSnap.exists) {
    return false;
  }

  const receipt = receiptSnap.data() ?? {};
  if (optionalTrimmedString(receipt.status, 20) === 'voided') {
    return false;
  }

  const update = {
    status: 'error',
    correctionRequired: true,
    correctionReason: reasonCode,
    correctionMarkedAt: now,
    correctionMarkedBy: actorUid,
    emailSendingAt: FieldValue.delete(),
    emailSendAttemptId: FieldValue.delete(),
    updatedAt: now,
  };
  tx.update(receiptRef, update);

  const summary = annualReceiptSummaryFromReceipt(
    receiptRef.id,
    {
      ...receipt,
      status: 'error',
      correctionRequired: true,
      correctionReason: reasonCode,
    },
    {
      ...summaryPrivacyOverrides,
      status: 'error',
      correctionRequired: true,
      correctionReason: reasonCode,
      correctionMarkedAt: now,
      emailSendingAt: FieldValue.delete(),
      emailSendAttemptId: FieldValue.delete(),
    }
  );
  if (summary) {
    tx.set(db.collection(TAX_RECEIPT_SUMMARIES_COLLECTION).doc(receiptRef.id), summary, { merge: true });
  }

  const event = taxReceiptEventData({
    action: 'review_required',
    actorUid,
    receiptId: receiptRef.id,
    receipt,
    reasonCode,
  });
  if (event) {
    tx.set(db.collection(TAX_RECEIPT_EVENTS_COLLECTION).doc(), event);
  }

  return true;
}

function voidTaxReceiptInTransaction(
  tx: FirebaseFirestore.Transaction,
  receiptRef: FirebaseFirestore.DocumentReference,
  receiptSnap: FirebaseFirestore.DocumentSnapshot,
  reasonCode: string,
  actorUid: string,
  now: FirebaseFirestore.FieldValue,
  summaryPrivacyOverrides: AnnualReceiptSummaryPrivacyOverrides = annualReceiptSummaryDonorOnlyPrivacyOverrides()
): boolean {
  if (!receiptSnap.exists) {
    return false;
  }

  const receipt = receiptSnap.data() ?? {};
  if (optionalTrimmedString(receipt.status, 20) === 'voided') {
    return false;
  }

  const update = {
    status: 'voided',
    voidReason: reasonCode,
    voidedAt: now,
    voidedBy: actorUid,
    correctionRequired: FieldValue.delete(),
    correctionReason: FieldValue.delete(),
    correctionMarkedAt: FieldValue.delete(),
    correctionMarkedBy: FieldValue.delete(),
    emailSendingAt: FieldValue.delete(),
    emailSendAttemptId: FieldValue.delete(),
    emailError: FieldValue.delete(),
    emailFailedAt: FieldValue.delete(),
    updatedAt: now,
  };
  tx.update(receiptRef, update);

  const summary = annualReceiptSummaryFromReceipt(
    receiptRef.id,
    {
      ...receipt,
      status: 'voided',
      voidReason: reasonCode,
      voidedAt: now,
    },
    {
      ...summaryPrivacyOverrides,
      status: 'voided',
      voidReason: reasonCode,
      voidedAt: now,
      correctionRequired: FieldValue.delete(),
      correctionReason: FieldValue.delete(),
      correctionMarkedAt: FieldValue.delete(),
      emailSendingAt: FieldValue.delete(),
      emailSendAttemptId: FieldValue.delete(),
      emailError: FieldValue.delete(),
      emailFailedAt: FieldValue.delete(),
    }
  );
  if (summary) {
    tx.set(db.collection(TAX_RECEIPT_SUMMARIES_COLLECTION).doc(receiptRef.id), summary, { merge: true });
  }

  const event = taxReceiptEventData({
    action: 'voided',
    actorUid,
    receiptId: receiptRef.id,
    receipt,
    reasonCode,
  });
  if (event) {
    tx.set(db.collection(TAX_RECEIPT_EVENTS_COLLECTION).doc(), event);
  }

  return true;
}

function updateSingleGivingVoidedByReceiptRefundStateInTransaction(
  tx: FirebaseFirestore.Transaction,
  receipt: Record<string, unknown>,
  refundDetails: ReceiptCoveredGivingRefundDetails,
  reasonCode: string,
  now: FirebaseFirestore.FieldValue
): void {
  const givingId = receiptSingleGivingId(receipt);
  if (!givingId) {
    return;
  }
  const givingDoc = refundDetails.givingDocs.find((doc) => doc.id === givingId);
  if (!givingDoc?.snap.exists) {
    return;
  }

  tx.update(givingDoc.ref, {
    taxReceiptStatus: 'voided',
    taxReceiptVoidReason: reasonCode,
    taxReceiptVoidedAt: now,
    taxReceiptCorrectionRequired: FieldValue.delete(),
    taxReceiptCorrectionReason: FieldValue.delete(),
    taxReceiptCorrectionMarkedAt: FieldValue.delete(),
    taxReceiptError: FieldValue.delete(),
    taxReceiptEmailError: FieldValue.delete(),
    updatedAt: now,
  });
}

function updateSingleGivingReviewRequiredByReceiptRefundStateInTransaction(
  tx: FirebaseFirestore.Transaction,
  receipt: Record<string, unknown>,
  refundDetails: ReceiptCoveredGivingRefundDetails,
  reasonCode: string,
  now: FirebaseFirestore.FieldValue
): void {
  const givingId = receiptSingleGivingId(receipt);
  if (!givingId) {
    return;
  }
  const givingDoc = refundDetails.givingDocs.find((doc) => doc.id === givingId);
  if (!givingDoc?.snap.exists) {
    return;
  }

  tx.update(givingDoc.ref, {
    taxReceiptStatus: 'error',
    taxReceiptError: reasonCode,
    taxReceiptCorrectionRequired: true,
    taxReceiptCorrectionReason: reasonCode,
    taxReceiptCorrectionMarkedAt: now,
    updatedAt: now,
  });
}

function receiptMatchesCurrentPartialRefundCorrectionState(
  receipt: Record<string, unknown>,
  refundDetails: ReceiptCoveredGivingRefundDetails
): boolean {
  if (refundDetails.state !== 'partial') {
    return false;
  }

  const kind = optionalTrimmedString(receipt.kind, 20);
  if (kind === 'single') {
    const givingId = receiptSingleGivingId(receipt);
    const givingDoc = refundDetails.givingDocs.find((doc) => doc.id === givingId);
    const amounts = givingDoc ? partialRefundAmounts(givingDoc.data) : null;
    if (!givingDoc || !amounts) {
      return false;
    }
    return isValidPartialRefundCorrectionReceipt(receipt, givingId, givingDoc.data, amounts);
  }

  if (kind !== 'annual') {
    return false;
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
    return false;
  }

  const annualGiving = refundDetails.givingDocs
    .filter((doc) => doc.snap.exists)
    .map((doc) => ({ snap: doc.snap, data: doc.data }));
  if (annualGiving.length === 0) {
    return false;
  }

  try {
    const amounts = annualGivingAmountSummary(annualGiving);
    return amounts.partialRefundGivingIds.length > 0
      && isValidAnnualPartialRefundCorrectionReceipt(
        receipt,
        churchId,
        userId,
        receiptYear,
        amounts,
        annualGiving.length
      );
  } catch {
    return false;
  }
}

function applyReceiptCoveredGivingRefundStateInTransaction(
  tx: FirebaseFirestore.Transaction,
  receiptRef: FirebaseFirestore.DocumentReference,
  receiptSnap: FirebaseFirestore.DocumentSnapshot,
  receipt: Record<string, unknown>,
  refundDetails: ReceiptCoveredGivingRefundDetails,
  now: FirebaseFirestore.FieldValue
): ReceiptCoveredGivingRefundState {
  const summaryPrivacyOverrides = annualReceiptSummaryPrivacyOverridesFromCoveredGivingDocs(
    receipt,
    refundDetails.givingDocs
  );
  if (refundDetails.state === 'full') {
    voidTaxReceiptInTransaction(
      tx,
      receiptRef,
      receiptSnap,
      STRIPE_FULL_REFUND_VOID_REASON,
      'system',
      now,
      summaryPrivacyOverrides
    );
    updateSingleGivingVoidedByReceiptRefundStateInTransaction(
      tx,
      receipt,
      refundDetails,
      STRIPE_FULL_REFUND_VOID_REASON,
      now
    );
    return 'full';
  }

  if (refundDetails.state === 'partial') {
    if (receiptMatchesCurrentPartialRefundCorrectionState(receipt, refundDetails)) {
      return 'none';
    }
    markTaxReceiptReviewRequiredInTransaction(
      tx,
      receiptRef,
      receiptSnap,
      STRIPE_PARTIAL_REFUND_REVIEW_REASON,
      'system',
      now,
      summaryPrivacyOverrides
    );
    updateSingleGivingReviewRequiredByReceiptRefundStateInTransaction(
      tx,
      receipt,
      refundDetails,
      STRIPE_PARTIAL_REFUND_REVIEW_REASON,
      now
    );
    return 'partial';
  }

  return 'none';
}

export async function markSingleTaxReceiptForGivingReview(
  givingRef: FirebaseFirestore.DocumentReference,
  reasonCode: string,
  actorUid: string
): Promise<void> {
  await db.runTransaction(async (tx) => {
    const givingSnap = await tx.get(givingRef);
    if (!givingSnap.exists) {
      return;
    }

    const giving = givingSnap.data() ?? {};
    const receiptId =
      optionalTrimmedString(giving.taxReceiptId, 128)
      || (TAX_RECEIPT_ID_PATTERN.test(givingRef.id) ? givingRef.id : '');
    if (!receiptId) {
      return;
    }

    const receiptRef = db.collection(TAX_RECEIPTS_COLLECTION).doc(receiptId);
    const receiptSnap = await tx.get(receiptRef);
    if (!markTaxReceiptReviewRequiredInTransaction(
      tx,
      receiptRef,
      receiptSnap,
      reasonCode,
      actorUid,
      FieldValue.serverTimestamp()
    )) {
      return;
    }

    tx.update(givingRef, {
      taxReceiptStatus: 'error',
      taxReceiptError: reasonCode,
      taxReceiptCorrectionRequired: true,
      taxReceiptCorrectionReason: reasonCode,
      taxReceiptCorrectionMarkedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
  });
}

export async function voidSingleTaxReceiptForGiving(
  givingRef: FirebaseFirestore.DocumentReference,
  reasonCode: string,
  actorUid: string
): Promise<void> {
  await db.runTransaction(async (tx) => {
    const givingSnap = await tx.get(givingRef);
    if (!givingSnap.exists) {
      return;
    }

    const giving = givingSnap.data() ?? {};
    const receiptId =
      optionalTrimmedString(giving.taxReceiptId, 128)
      || (TAX_RECEIPT_ID_PATTERN.test(givingRef.id) ? givingRef.id : '');
    const now = FieldValue.serverTimestamp();
    let receiptExists = false;
    if (receiptId) {
      const receiptRef = db.collection(TAX_RECEIPTS_COLLECTION).doc(receiptId);
      const receiptSnap = await tx.get(receiptRef);
      receiptExists = receiptSnap.exists;
      voidTaxReceiptInTransaction(tx, receiptRef, receiptSnap, reasonCode, actorUid, now);
    }

    const currentReceiptStatus = optionalTrimmedString(giving.taxReceiptStatus, 20);
    const shouldMarkGivingVoided =
      receiptExists
      || Boolean(optionalTrimmedString(giving.taxReceiptId, 128))
      || ['issued', 'sent', 'error', 'voided'].includes(currentReceiptStatus);
    if (!shouldMarkGivingVoided) {
      return;
    }

    tx.update(givingRef, {
      taxReceiptStatus: 'voided',
      taxReceiptVoidReason: reasonCode,
      taxReceiptVoidedAt: now,
      taxReceiptCorrectionRequired: FieldValue.delete(),
      taxReceiptCorrectionReason: FieldValue.delete(),
      taxReceiptCorrectionMarkedAt: FieldValue.delete(),
      taxReceiptError: FieldValue.delete(),
      taxReceiptEmailError: FieldValue.delete(),
      updatedAt: now,
    });
  });
}

export async function markAnnualTaxReceiptsForGivingReview(
  givingId: string,
  reasonCode: string,
  actorUid: string
): Promise<void> {
  const annualReceipts = await db
    .collection(TAX_RECEIPTS_COLLECTION)
    .where('givingIds', 'array-contains', givingId)
    .get();

  for (const receiptDoc of annualReceipts.docs) {
    await db.runTransaction(async (tx) => {
      const receiptSnap = await tx.get(receiptDoc.ref);
      const receipt = receiptSnap.data() ?? {};
      const refundDetails = await receiptCoveredGivingRefundDetails(receipt, tx);
      markTaxReceiptReviewRequiredInTransaction(
        tx,
        receiptDoc.ref,
        receiptSnap,
        reasonCode,
        actorUid,
        FieldValue.serverTimestamp(),
        annualReceiptSummaryPrivacyOverridesFromCoveredGivingDocs(receipt, refundDetails.givingDocs)
      );
    });
  }
}

export async function voidAnnualTaxReceiptsForGiving(
  givingId: string,
  reasonCode: string,
  actorUid: string
): Promise<void> {
  const annualReceipts = await db
    .collection(TAX_RECEIPTS_COLLECTION)
    .where('givingIds', 'array-contains', givingId)
    .get();

  for (const receiptDoc of annualReceipts.docs) {
    await db.runTransaction(async (tx) => {
      const receiptSnap = await tx.get(receiptDoc.ref);
      const receipt = receiptSnap.data() ?? {};
      const refundDetails = await receiptCoveredGivingRefundDetails(receipt, tx);
      voidTaxReceiptInTransaction(
        tx,
        receiptDoc.ref,
        receiptSnap,
        reasonCode,
        actorUid,
        FieldValue.serverTimestamp(),
        annualReceiptSummaryPrivacyOverridesFromCoveredGivingDocs(receipt, refundDetails.givingDocs)
      );
    });
  }
}
