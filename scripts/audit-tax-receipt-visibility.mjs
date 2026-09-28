#!/usr/bin/env node

import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app';
import { FieldPath, FieldValue, getFirestore } from 'firebase-admin/firestore';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const expectedProjectId = 'kandilo-2f7a9';
const defaultScanLimit = 100000;
const maxScanLimit = 1000000;
const defaultPageSize = 500;
const writeBatchLimit = 200;
const anonymousDonorLabel = 'Anonymous donor';
const publicDonorFallback = 'Parishioner';
const firestoreRestBaseUrl = 'https://firestore.googleapis.com/v1';
const firestoreRestTimestampMarker = '__firestoreTimestampValue';
const donorProfileIncompleteReceiptError = 'tax_receipt_donor_profile_incomplete';
const missingEmailOrAmountReceiptError = 'tax_receipt_missing_email_or_amount';
const annualReceiptIssuanceGapErrors = new Set([
  donorProfileIncompleteReceiptError,
  missingEmailOrAmountReceiptError,
]);
const receiptManagerGivingSafeVersion = 1;
const receiptManagerSummarySafeVersionCurrent = 2;
const givingPaymentMetadataCollection = 'givingPaymentMetadata';
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
const firestoreRestFieldMasks = {
  giving: [
    'churchId',
    'userId',
    'amountCents',
    'currency',
    'anonymous',
    'donorEmail',
    'donorName',
    'donorNamePublicSafe',
    'churchReceiptVisible',
    'receiptManagerGivingSafeVersion',
    ...givingPrivatePaymentFields,
  ],
  taxReceiptSummaries: [
    'churchId',
    'kind',
    'donorAnonymous',
    'churchReceiptVisible',
    'receiptId',
    'receiptNumber',
    'status',
    'emailError',
    'receiptManagerSummarySafe',
    'receiptManagerSummarySafeVersion',
    'donorLabelPublicSafe',
    'donorLabel',
    'jurisdiction',
    ...annualSummaryPrivateFields,
  ],
  taxReceipts: ['churchId', 'kind', 'givingIds', 'donorLabel', 'donorName', 'jurisdiction'],
};

function optionalTrimmedString(value, max = 2000) {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, max);
}

function looksLikeEmail(value) {
  return /[^\s@]+@[^\s@]+\.[^\s@]{2,}/i.test(value.trim());
}

function publicDonorLabelCandidate(value) {
  const label = optionalTrimmedString(value, 160);
  if (!label || looksLikeEmail(label) || label === anonymousDonorLabel) {
    return '';
  }
  return label;
}

function validDocId(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,160}$/.test(value);
}

function documentRecord(id, data) {
  return {
    id,
    data: data && typeof data === 'object' ? data : {},
  };
}

function createRepair(collection, id, update, reasons, deleteFields = [], extra = {}) {
  return {
    collection,
    id,
    path: `${collection}/${id}`,
    update,
    deleteFields,
    reasons,
    ...extra,
  };
}

function paymentMetadataUpdateForGiving(data) {
  const update = {};
  const churchId = optionalTrimmedString(data.churchId, 128);
  const userId = optionalTrimmedString(data.userId, 128);
  const currency = optionalTrimmedString(data.currency, 10);
  if (churchId) {
    update.churchId = churchId;
  }
  if (userId) {
    update.userId = userId;
  }
  if (typeof data.amountCents === 'number' && Number.isFinite(data.amountCents)) {
    update.amountCents = data.amountCents;
  }
  if (currency) {
    update.currency = currency.toUpperCase();
  }

  for (const field of givingPrivatePaymentFields) {
    if (Object.prototype.hasOwnProperty.call(data, field) && data[field] !== undefined && data[field] !== null) {
      update[field] = data[field];
    }
  }

  return givingPrivatePaymentFields.some((field) => Object.prototype.hasOwnProperty.call(update, field))
    ? update
    : null;
}

function givingVisibilityRepair(doc) {
  const data = doc.data ?? {};
  const explicitNonAnonymous = data.anonymous === false;
  const update = {};
  const reasons = [];
  const deleteFields = [];
  const donorEmail = optionalTrimmedString(data.donorEmail, 254);
  const donorName = optionalTrimmedString(data.donorName, 160);

  if (explicitNonAnonymous) {
    if (data.churchReceiptVisible !== true) {
      update.churchReceiptVisible = true;
      reasons.push('make_explicit_non_anonymous_giving_visible');
    }
    if (data.donorNamePublicSafe !== true) {
      update.donorNamePublicSafe = true;
      reasons.push('set_giving_label_safe_marker');
    }
    if (data.receiptManagerGivingSafeVersion !== receiptManagerGivingSafeVersion) {
      update.receiptManagerGivingSafeVersion = receiptManagerGivingSafeVersion;
      reasons.push('set_giving_safe_version');
    }
    if (donorEmail) {
      update.donorEmail = '';
      reasons.push('clear_church_facing_donor_email');
    }
    if (!publicDonorLabelCandidate(donorName)) {
      update.donorName = publicDonorFallback;
      reasons.push('sanitize_public_donor_label');
    }
  } else {
    if (data.churchReceiptVisible !== false) {
      update.churchReceiptVisible = false;
      reasons.push('hide_anonymous_or_unclassified_giving');
    }
    if (data.donorNamePublicSafe !== false) {
      update.donorNamePublicSafe = false;
      reasons.push('clear_giving_label_safe_marker');
    }
    if (data.receiptManagerGivingSafeVersion !== 0) {
      update.receiptManagerGivingSafeVersion = 0;
      reasons.push('clear_giving_safe_version');
    }
    if (donorEmail) {
      update.donorEmail = '';
      reasons.push('clear_private_giving_donor_email');
    }
    if (data.anonymous === true && donorName !== anonymousDonorLabel) {
      update.donorName = anonymousDonorLabel;
      reasons.push('restore_anonymous_donor_label');
    } else if (data.anonymous !== true && looksLikeEmail(donorName)) {
      update.donorName = '';
      reasons.push('clear_email_shaped_unclassified_donor_label');
    }
  }

  for (const field of givingPrivatePaymentFields) {
    if (Object.prototype.hasOwnProperty.call(data, field)) {
      deleteFields.push(field);
    }
  }
  if (deleteFields.length > 0) {
    reasons.push('remove_private_giving_payment_fields');
  }

  const paymentMetadataUpdate = deleteFields.length > 0
    ? paymentMetadataUpdateForGiving(data)
    : null;

  return reasons.length === 0
    ? null
    : createRepair(
      'giving',
      doc.id,
      update,
      reasons,
      deleteFields,
      paymentMetadataUpdate ? { paymentMetadataUpdate } : {}
    );
}

function givingIdsForAnnualReceipt(summary, receipt) {
  const raw = Array.isArray(receipt?.givingIds)
    ? receipt.givingIds
    : Array.isArray(summary?.givingIds)
      ? summary.givingIds
      : [];
  return raw.filter(validDocId);
}

function givingSafeForReceiptManagerAnnualSummary(giving) {
  return giving?.anonymous === false
    && giving.churchReceiptVisible === true
    && giving.donorNamePublicSafe === true
    && giving.receiptManagerGivingSafeVersion === receiptManagerGivingSafeVersion
    && optionalTrimmedString(giving.donorEmail, 254) === ''
    && givingPrivatePaymentFields.every((field) => !Object.prototype.hasOwnProperty.call(giving, field))
    && Boolean(publicDonorLabelCandidate(giving.donorName));
}

function coveredGivingSafeForReceiptManagerAnnualSummary(givingIds, givingById) {
  if (givingIds.length === 0) {
    return null;
  }
  return givingIds.every((givingId) => (
    givingSafeForReceiptManagerAnnualSummary(givingById.get(givingId))
  ));
}

function intendedAnnualDonorAnonymous(summary, receipt, givingById) {
  const givingIds = givingIdsForAnnualReceipt(summary, receipt);
  const allCoveredGivingPublic = coveredGivingSafeForReceiptManagerAnnualSummary(givingIds, givingById);
  if (allCoveredGivingPublic === true) {
    return false;
  }
  if (allCoveredGivingPublic === false || allCoveredGivingPublic === null) {
    return true;
  }
  return true;
}

function annualPublicDonorLabel(summary, receipt, givingById) {
  const coveredGivingLabel = givingIdsForAnnualReceipt(summary, receipt)
    .map((givingId) => publicDonorLabelCandidate(givingById.get(givingId)?.donorName))
    .find(Boolean);
  return publicDonorLabelCandidate(summary.donorLabel)
    || publicDonorLabelCandidate(receipt?.donorLabel)
    || publicDonorLabelCandidate(receipt?.donorName)
    || coveredGivingLabel
    || publicDonorFallback;
}

function annualSummaryJurisdictionFromReceipt(receipt) {
  return Object.prototype.hasOwnProperty.call(receipt ?? {}, 'jurisdiction')
    ? optionalTrimmedString(receipt.jurisdiction, 10)
    : null;
}

function isAnnualIssuanceGapRetrySummary(summary) {
  return summary?.kind === 'annual'
    && optionalTrimmedString(summary.status, 30) === 'error'
    && annualReceiptIssuanceGapErrors.has(optionalTrimmedString(summary.emailError, 120))
    && Object.prototype.hasOwnProperty.call(summary, 'receiptId')
    && optionalTrimmedString(summary.receiptId, 160) === '';
}

function annualIssuanceGapSummaryHasStaffSafeMarkers(summary) {
  return summary?.donorAnonymous === false
    && summary.churchReceiptVisible === true
    && summary.receiptManagerSummarySafe === true
    && summary.receiptManagerSummarySafeVersion === receiptManagerSummarySafeVersionCurrent
    && summary.donorLabelPublicSafe === true;
}

function annualIssuanceGapSummaryVisibilityRepair(doc) {
  const data = doc.data ?? {};
  const staffVisible = annualIssuanceGapSummaryHasStaffSafeMarkers(data);
  const donorAnonymous = !staffVisible;
  const churchReceiptVisible = staffVisible;
  const receiptManagerSummarySafe = staffVisible;
  const receiptManagerSummarySafeVersion = staffVisible ? receiptManagerSummarySafeVersionCurrent : 0;
  const donorLabelPublicSafe = staffVisible;
  const donorLabel = staffVisible
    ? publicDonorLabelCandidate(data.donorLabel) || publicDonorFallback
    : anonymousDonorLabel;
  const update = {};
  const deleteFields = [];
  const reasons = [];

  if (data.donorAnonymous !== donorAnonymous) {
    update.donorAnonymous = donorAnonymous;
    reasons.push(donorAnonymous ? 'hide_annual_summary' : 'make_annual_summary_visible');
  }
  if (data.churchReceiptVisible !== churchReceiptVisible) {
    update.churchReceiptVisible = churchReceiptVisible;
    reasons.push(churchReceiptVisible ? 'set_annual_summary_visibility' : 'clear_annual_summary_visibility');
  }
  if (data.receiptManagerSummarySafe !== receiptManagerSummarySafe) {
    update.receiptManagerSummarySafe = receiptManagerSummarySafe;
    reasons.push(receiptManagerSummarySafe ? 'set_annual_summary_safe_marker' : 'clear_annual_summary_safe_marker');
  }
  if (data.receiptManagerSummarySafeVersion !== receiptManagerSummarySafeVersion) {
    update.receiptManagerSummarySafeVersion = receiptManagerSummarySafeVersion;
    reasons.push(receiptManagerSummarySafe ? 'set_annual_summary_safe_version' : 'clear_annual_summary_safe_version');
  }
  if (data.donorLabelPublicSafe !== donorLabelPublicSafe) {
    update.donorLabelPublicSafe = donorLabelPublicSafe;
    reasons.push(donorLabelPublicSafe ? 'set_annual_summary_label_safe_marker' : 'clear_annual_summary_label_safe_marker');
  }
  if (optionalTrimmedString(data.donorLabel, 160) !== donorLabel) {
    update.donorLabel = donorLabel;
    reasons.push(donorAnonymous ? 'restore_annual_anonymous_label' : 'sanitize_annual_public_label');
  }
  if (Object.prototype.hasOwnProperty.call(data, 'receiptNumber') && optionalTrimmedString(data.receiptNumber, 160) !== '') {
    update.receiptNumber = '';
    reasons.push('clear_unissued_annual_retry_receipt_number');
  }
  for (const field of annualSummaryPrivateFields) {
    if (Object.prototype.hasOwnProperty.call(data, field)) {
      deleteFields.push(field);
    }
  }
  if (deleteFields.length > 0) {
    reasons.push('remove_private_annual_summary_fields');
  }

  return reasons.length === 0
    ? null
    : createRepair('taxReceiptSummaries', doc.id, update, reasons, deleteFields);
}

function annualSummaryVisibilityRepair(doc, receiptById, givingById) {
  const data = doc.data ?? {};
  if (data.kind !== 'annual') {
    return null;
  }

  if (isAnnualIssuanceGapRetrySummary(data)) {
    return annualIssuanceGapSummaryVisibilityRepair(doc);
  }

  const receipt = receiptById.get(doc.id) ?? {};
  const donorAnonymous = intendedAnnualDonorAnonymous(data, receipt, givingById);
  const churchReceiptVisible = donorAnonymous === false;
  const donorLabel = donorAnonymous
    ? anonymousDonorLabel
    : annualPublicDonorLabel(data, receipt, givingById);
  const receiptManagerSummarySafe = donorAnonymous === false;
  const receiptManagerSummarySafeVersion = receiptManagerSummarySafe ? receiptManagerSummarySafeVersionCurrent : 0;
  const donorLabelPublicSafe = donorAnonymous === false;
  const update = {};
  const deleteFields = [];
  const reasons = [];

  if (data.donorAnonymous !== donorAnonymous) {
    update.donorAnonymous = donorAnonymous;
    reasons.push(donorAnonymous ? 'hide_annual_summary' : 'make_annual_summary_visible');
  }
  if (data.churchReceiptVisible !== churchReceiptVisible) {
    update.churchReceiptVisible = churchReceiptVisible;
    reasons.push(churchReceiptVisible ? 'set_annual_summary_visibility' : 'clear_annual_summary_visibility');
  }
  if (data.receiptManagerSummarySafe !== receiptManagerSummarySafe) {
    update.receiptManagerSummarySafe = receiptManagerSummarySafe;
    reasons.push(receiptManagerSummarySafe ? 'set_annual_summary_safe_marker' : 'clear_annual_summary_safe_marker');
  }
  if (data.receiptManagerSummarySafeVersion !== receiptManagerSummarySafeVersion) {
    update.receiptManagerSummarySafeVersion = receiptManagerSummarySafeVersion;
    reasons.push(receiptManagerSummarySafe ? 'set_annual_summary_safe_version' : 'clear_annual_summary_safe_version');
  }
  if (data.donorLabelPublicSafe !== donorLabelPublicSafe) {
    update.donorLabelPublicSafe = donorLabelPublicSafe;
    reasons.push(donorLabelPublicSafe ? 'set_annual_summary_label_safe_marker' : 'clear_annual_summary_label_safe_marker');
  }
  if (optionalTrimmedString(data.donorLabel, 160) !== donorLabel) {
    update.donorLabel = donorLabel;
    reasons.push(donorAnonymous ? 'restore_annual_anonymous_label' : 'sanitize_annual_public_label');
  }
  const receiptJurisdiction = annualSummaryJurisdictionFromReceipt(receipt);
  if (
    receiptJurisdiction !== null
    && optionalTrimmedString(data.jurisdiction, 10) !== receiptJurisdiction
  ) {
    update.jurisdiction = receiptJurisdiction;
    reasons.push('mirror_annual_summary_jurisdiction');
  }
  for (const field of annualSummaryPrivateFields) {
    if (Object.prototype.hasOwnProperty.call(data, field)) {
      deleteFields.push(field);
    }
  }
  if (deleteFields.length > 0) {
    reasons.push('remove_private_annual_summary_fields');
  }

  return reasons.length === 0
    ? null
    : createRepair('taxReceiptSummaries', doc.id, update, reasons, deleteFields);
}

function reasonCounts(repairs) {
  const counts = {};
  for (const repair of repairs) {
    for (const reason of repair.reasons) {
      counts[reason] = (counts[reason] ?? 0) + 1;
    }
  }
  return counts;
}

const repairEffectDescriptions = {
  clear_church_facing_donor_email:
    'clears a church-facing donor email from explicitly non-anonymous giving while keeping official receipt delivery backend-owned.',
  clear_email_shaped_unclassified_donor_label:
    'clears an email-shaped donor label from unclassified giving so receipt managers do not see account emails.',
  clear_private_giving_donor_email:
    'clears a donor email from anonymous or unclassified giving that remains hidden from receipt managers.',
  clear_giving_label_safe_marker:
    'clears the giving public-label safety marker while the giving row remains hidden from receipt managers.',
  clear_annual_summary_safe_marker:
    'removes the staff-safe marker from an annual summary that should remain donor-only.',
  clear_annual_summary_safe_version:
    'sets the annual summary staff-safe version to 0 for donor-only receipt history.',
  clear_annual_summary_label_safe_marker:
    'clears the annual summary public-label safety marker while the donor-year remains hidden from receipt managers.',
  clear_annual_summary_visibility:
    'marks an annual summary donor-only because covered giving is anonymous, unclassified, receipt-manager-hidden, or missing from the receipt evidence.',
  clear_unissued_annual_retry_receipt_number:
    'removes a receipt number from an annual issuance-gap retry row because no official receipt was issued.',
  hide_anonymous_or_unclassified_giving:
    'keeps anonymous or unclassified giving hidden from receipt-manager Firestore reads.',
  hide_annual_summary:
    'keeps an annual summary hidden from receipt-manager Firestore reads.',
  make_annual_summary_visible:
    'marks an annual summary visible only when covered giving is explicitly non-anonymous and receipt-manager-safe.',
  mirror_annual_summary_jurisdiction:
    'mirrors the non-private receipt jurisdiction onto annual summary rows so unsupported-jurisdiction actions fail closed.',
  make_explicit_non_anonymous_giving_visible:
    'marks explicitly non-anonymous giving visible for receipt-manager send-focused reads.',
  remove_private_annual_summary_fields:
    'deletes private full-receipt fields from annual summary mirrors before any staff-safe marker is trusted.',
  remove_private_giving_payment_fields:
    'preserves raw Stripe session, payment, charge, refund, customer, and Connect account aliases in backend-only payment metadata before removing them from staff-readable giving rows.',
  restore_anonymous_donor_label:
    'restores the anonymous donor label for anonymous giving.',
  restore_annual_anonymous_label:
    'restores the anonymous donor label for donor-only annual summaries.',
  sanitize_annual_public_label:
    'uses a safe public donor label for annual summaries without exposing email-shaped labels.',
  sanitize_public_donor_label:
    `uses ${publicDonorFallback} when a church-facing giving donor label is missing, private, or includes email-shaped text.`,
  set_giving_label_safe_marker:
    'sets the giving public-label safety marker after replacing embedded email-shaped labels with a safe public label.',
  set_annual_summary_safe_marker:
    'sets the backend-owned staff-safe marker for receipt-manager-safe annual summaries.',
  set_annual_summary_safe_version:
    'sets the current staff-safe marker version for receipt-manager-safe annual summaries.',
  set_annual_summary_label_safe_marker:
    'sets the annual summary public-label safety marker after replacing embedded email-shaped labels with a safe public label.',
  set_annual_summary_visibility:
    'marks an explicitly non-anonymous annual summary visible for receipt-manager send-focused reads.',
};

function taxReceiptVisibilityRepairEffectLines(report) {
  const counts = report?.reasonCounts && typeof report.reasonCounts === 'object'
    ? report.reasonCounts
    : {};

  return Object.entries(counts)
    .filter(([, count]) => Number(count) > 0)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([reason, count]) => {
      const description = repairEffectDescriptions[reason]
        ?? 'updates legacy receipt visibility metadata without printing private document identifiers.';
      return `  ${reason}: ${count} - ${description}`;
    });
}

function planTaxReceiptVisibilityRepairs({
  givingDocs = [],
  annualSummaryDocs = [],
  annualReceiptDocs = [],
} = {}) {
  const givingRecords = givingDocs.map((doc) => documentRecord(doc.id, doc.data));
  const annualSummaryRecords = annualSummaryDocs.map((doc) => documentRecord(doc.id, doc.data));
  const annualReceiptRecords = annualReceiptDocs.map((doc) => documentRecord(doc.id, doc.data));
  const givingById = new Map(givingRecords.map((doc) => [doc.id, doc.data]));
  const receiptById = new Map(annualReceiptRecords.map((doc) => [doc.id, doc.data]));
  const repairs = [
    ...givingRecords.map(givingVisibilityRepair).filter(Boolean),
    ...annualSummaryRecords
      .map((doc) => annualSummaryVisibilityRepair(doc, receiptById, givingById))
      .filter(Boolean),
  ];

  return {
    scanned: {
      giving: givingRecords.length,
      annualSummaries: annualSummaryRecords.length,
      annualReceipts: annualReceiptRecords.length,
    },
    repairCount: repairs.length,
    givingRepairCount: repairs.filter((repair) => repair.collection === 'giving').length,
    annualSummaryRepairCount: repairs.filter((repair) => repair.collection === 'taxReceiptSummaries').length,
    reasonCounts: reasonCounts(repairs),
    repairs,
  };
}

function reportRepairCount(report) {
  return typeof report.repairCount === 'number'
    ? report.repairCount
    : Array.isArray(report.repairs)
      ? report.repairs.length
      : 0;
}

function readArgValue(args, name) {
  const equalsArg = args.find((arg) => arg.startsWith(`${name}=`));
  if (equalsArg) return equalsArg.slice(name.length + 1);
  const index = args.indexOf(name);
  return index >= 0 && typeof args[index + 1] === 'string' ? args[index + 1] : '';
}

function parsePositiveInteger(value, fallback, field, max = 100000) {
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

function parseOptionalNonNegativeInteger(value, field, max = 100000) {
  if (!value) return null;
  if (!/^\d+$/.test(value)) {
    throw new Error(`${field} must be an integer from 0 to ${max}.`);
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > max) {
    throw new Error(`${field} must be an integer from 0 to ${max}.`);
  }
  return parsed;
}

function validateTaxReceiptVisibilityAuditArgs(args) {
  const valueOptions = new Set([
    '--project',
    '--church',
    '--confirm-project',
    '--confirm-repair-count',
    '--limit',
    '--page-size',
  ]);
  const flagOptions = new Set([
    '--repair',
    '--fail-on-repairs',
  ]);

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg.startsWith('--')) {
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
      if (!next || next.startsWith('--')) {
        throw new Error(`Missing value for ${name}.`);
      }
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument ${name}.`);
  }
}

function parseArgs(args) {
  validateTaxReceiptVisibilityAuditArgs(args);
  return {
    projectId: readArgValue(args, '--project') || expectedProjectId,
    churchId: readArgValue(args, '--church'),
    confirmProject: readArgValue(args, '--confirm-project'),
    confirmRepairCount: parseOptionalNonNegativeInteger(
      readArgValue(args, '--confirm-repair-count'),
      '--confirm-repair-count'
    ),
    limit: parsePositiveInteger(readArgValue(args, '--limit'), defaultScanLimit, '--limit', maxScanLimit),
    pageSize: parsePositiveInteger(readArgValue(args, '--page-size'), defaultPageSize, '--page-size', 1000),
    repair: args.includes('--repair'),
    failOnRepairs: args.includes('--fail-on-repairs'),
  };
}

function shellQuote(value) {
  const text = String(value);
  return /^[A-Za-z0-9_./:=+-]+$/.test(text)
    ? text
    : `'${text.replaceAll("'", "'\\''")}'`;
}

function initializeFirestore(projectId) {
  const app = getApps()[0] ?? initializeApp({ projectId });
  return getFirestore(app);
}

function firebaseCommand() {
  return process.platform === 'win32' ? 'npx.cmd' : 'npx';
}

function firebaseCommandArgs(args) {
  return ['--no-install', 'firebase', ...args];
}

function readFirebaseCliAccessTokenForAudit() {
  const result = spawnSync(
    firebaseCommand(),
    firebaseCommandArgs(['login:list', '--json']),
    {
      encoding: 'utf8',
    }
  );
  if (result.error) {
    throw new Error(`Firebase CLI auth check failed: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error('Firebase CLI auth check failed. Run npx --no-install firebase login before using the read-only REST audit fallback.');
  }

  let parsed;
  try {
    parsed = JSON.parse(result.stdout);
  } catch (error) {
    throw new Error(`Firebase CLI auth output was not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }

  const accounts = Array.isArray(parsed.result) ? parsed.result : [];
  const accessToken = accounts
    .map((account) => account?.tokens?.access_token)
    .find((value) => typeof value === 'string' && value.length > 0);
  if (!accessToken) {
    throw new Error('Firebase CLI auth check did not return an active account access token.');
  }
  return accessToken;
}

function isMissingDefaultCredentialsError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return /Could not load the default credentials/i.test(message);
}

function taxReceiptVisibilityAuditRuntimeErrorMessage(error) {
  const message = error instanceof Error ? error.message : String(error);
  if (isMissingDefaultCredentialsError(error)) {
    return [
      'Unable to read Firestore because Google Application Default Credentials are not available.',
      'Read-only audit mode can also use Firebase CLI auth as a fallback when npx --no-install firebase login is available.',
      `Repair mode can use Firebase CLI auth only after --repair --confirm-project ${expectedProjectId}; Admin SDK credentials also work, for example: gcloud auth application-default login && npm run audit:tax-receipts -- --fail-on-repairs`,
      'Alternatively set GOOGLE_APPLICATION_CREDENTIALS to a service-account JSON file with read access before running the audit.',
      'Do not run repair mode until the read-only audit completes and the aggregate repair counts have been reviewed.',
    ].join('\n');
  }
  if (/Firebase CLI auth/i.test(message)) {
    return [
      'Unable to read Firestore through Firebase CLI auth.',
      'Run npx --no-install firebase login, or set GOOGLE_APPLICATION_CREDENTIALS to a service-account JSON file with read access before running the audit.',
      'Do not run repair mode until the read-only audit completes and the aggregate repair counts have been reviewed.',
    ].join('\n');
  }

  return `Tax receipt visibility audit failed: ${message}`;
}

function firestoreRestValueToJs(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  if ('stringValue' in value) return value.stringValue;
  if ('booleanValue' in value) return value.booleanValue === true;
  if ('integerValue' in value) {
    const parsed = Number.parseInt(String(value.integerValue), 10);
    return Number.isNaN(parsed) ? undefined : parsed;
  }
  if ('doubleValue' in value) return Number(value.doubleValue);
  if ('timestampValue' in value) {
    return { [firestoreRestTimestampMarker]: value.timestampValue };
  }
  if ('nullValue' in value) return null;
  if ('arrayValue' in value) {
    const values = Array.isArray(value.arrayValue?.values) ? value.arrayValue.values : [];
    return values.map(firestoreRestValueToJs);
  }
  if ('mapValue' in value) {
    return firestoreRestFieldsToData(value.mapValue?.fields ?? {});
  }
  return undefined;
}

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

function firestoreRestDocumentToAuditDoc(document) {
  const name = typeof document?.name === 'string' ? document.name : '';
  const id = name.split('/').filter(Boolean).at(-1) ?? '';
  return {
    id,
    data: firestoreRestFieldsToData(document?.fields ?? {}),
  };
}

function firestoreRestListDocumentsUrl(projectId, collectionName, { pageSize, pageToken = '' } = {}) {
  const url = new URL(
    `${firestoreRestBaseUrl}/projects/${encodeURIComponent(projectId)}/databases/(default)/documents/${encodeURIComponent(collectionName)}`
  );
  url.searchParams.set('pageSize', String(pageSize));
  for (const fieldPath of firestoreRestFieldMasks[collectionName] ?? []) {
    url.searchParams.append('mask.fieldPaths', fieldPath);
  }
  if (pageToken) {
    url.searchParams.set('pageToken', pageToken);
  }
  return url;
}

function firestoreRestCommitUrl(projectId) {
  return new URL(`${firestoreRestBaseUrl}/projects/${encodeURIComponent(projectId)}/databases/(default)/documents:commit`);
}

function firestoreRestDocumentName(projectId, collectionName, documentId) {
  return `projects/${projectId}/databases/(default)/documents/${collectionName}/${documentId}`;
}

function jsValueToFirestoreRestValue(value) {
  if (
    value
    && typeof value === 'object'
    && !Array.isArray(value)
    && typeof value[firestoreRestTimestampMarker] === 'string'
  ) {
    return { timestampValue: value[firestoreRestTimestampMarker] };
  }
  if (typeof value === 'string') {
    return { stringValue: value };
  }
  if (typeof value === 'boolean') {
    return { booleanValue: value };
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Number.isInteger(value)
      ? { integerValue: String(value) }
      : { doubleValue: value };
  }
  if (value === null) {
    return { nullValue: null };
  }
  if (Array.isArray(value)) {
    return { arrayValue: { values: value.map(jsValueToFirestoreRestValue) } };
  }
  if (value && typeof value === 'object') {
    return {
      mapValue: {
        fields: Object.fromEntries(
          Object.entries(value).map(([key, nestedValue]) => [key, jsValueToFirestoreRestValue(nestedValue)])
        ),
      },
    };
  }
  return { nullValue: null };
}

function firestoreRestWriteForRepair(projectId, repair) {
  const updateFields = Object.entries(repair.update ?? {})
    .filter(([, value]) => value !== undefined);
  const updatedFieldPaths = updateFields.map(([key]) => key);
  const deleteFieldPaths = Array.isArray(repair.deleteFields)
    ? repair.deleteFields.filter((field) => typeof field === 'string' && !updatedFieldPaths.includes(field))
    : [];
  if (updateFields.length === 0 && deleteFieldPaths.length === 0) {
    throw new Error(`Repair ${repair.path} has no update fields.`);
  }

  return {
    update: {
      name: firestoreRestDocumentName(projectId, repair.collection, repair.id),
      fields: Object.fromEntries(
        updateFields.map(([key, value]) => [key, jsValueToFirestoreRestValue(value)])
      ),
    },
    updateMask: {
      fieldPaths: [...updatedFieldPaths, ...deleteFieldPaths],
    },
    updateTransforms: [{
      fieldPath: 'updatedAt',
      setToServerValue: 'REQUEST_TIME',
    }],
    currentDocument: {
      exists: true,
    },
  };
}

function firestoreRestPaymentMetadataWriteForRepair(projectId, repair) {
  const update = repair.paymentMetadataUpdate;
  if (!update || typeof update !== 'object' || Array.isArray(update)) {
    return null;
  }
  const updateFields = Object.entries(update)
    .filter(([, value]) => value !== undefined);
  if (updateFields.length === 0) {
    return null;
  }

  return {
    update: {
      name: firestoreRestDocumentName(projectId, givingPaymentMetadataCollection, repair.id),
      fields: Object.fromEntries(
        updateFields.map(([key, value]) => [key, jsValueToFirestoreRestValue(value)])
      ),
    },
    updateMask: {
      fieldPaths: updateFields.map(([key]) => key),
    },
    updateTransforms: [{
      fieldPath: 'updatedAt',
      setToServerValue: 'REQUEST_TIME',
    }],
  };
}

function firestoreRestWritesForRepair(projectId, repair) {
  return [
    firestoreRestPaymentMetadataWriteForRepair(projectId, repair),
    firestoreRestWriteForRepair(projectId, repair),
  ].filter(Boolean);
}

async function readCollectionDocsWithFirestoreRest(
  fetchImpl,
  accessToken,
  collectionName,
  { projectId = expectedProjectId, churchId, kind, limit, pageSize }
) {
  if (typeof fetchImpl !== 'function') {
    throw new Error('Firestore REST audit fallback requires a Node.js runtime with fetch.');
  }

  const docs = [];
  let rawReadCount = 0;
  let pageToken = '';
  let limitReached = false;

  while (rawReadCount < limit) {
    const requestLimit = Math.min(pageSize, limit - rawReadCount);
    const url = firestoreRestListDocumentsUrl(projectId, collectionName, { pageSize: requestLimit, pageToken });
    const response = await fetchImpl(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });
    if (!response.ok) {
      throw new Error(`Firestore REST read for ${collectionName} failed with HTTP ${response.status}.`);
    }

    const body = await response.json();
    const restDocs = Array.isArray(body.documents) ? body.documents : [];
    rawReadCount += restDocs.length;
    for (const restDoc of restDocs) {
      const doc = firestoreRestDocumentToAuditDoc(restDoc);
      if (!doc.id) {
        continue;
      }
      if (churchId && doc.data.churchId !== churchId) {
        continue;
      }
      if (kind && doc.data.kind !== kind) {
        continue;
      }
      docs.push(doc);
    }

    pageToken = typeof body.nextPageToken === 'string' ? body.nextPageToken : '';
    if (!pageToken) {
      break;
    }
    if (rawReadCount >= limit) {
      limitReached = true;
      break;
    }
  }

  return {
    docs,
    rawReadCount,
    limitReached,
  };
}

async function readCollectionDocs(db, collectionName, { churchId, kind, limit, pageSize }) {
  const docs = [];
  let rawReadCount = 0;
  let lastDoc = null;
  let completed = false;

  while (rawReadCount < limit) {
    const remaining = limit - rawReadCount;
    const requestLimit = remaining <= pageSize ? remaining + 1 : pageSize;
    let query = db
      .collection(collectionName)
      .orderBy(FieldPath.documentId())
      .limit(requestLimit);

    if (lastDoc) {
      query = query.startAfter(lastDoc);
    }

    const snap = await query.get();
    if (snap.empty) {
      completed = true;
      break;
    }

    const rawDocs = snap.docs.slice(0, remaining);
    rawReadCount += rawDocs.length;
    for (const doc of rawDocs) {
      const data = doc.data();
      if (churchId && data.churchId !== churchId) {
        continue;
      }
      if (kind && data.kind !== kind) {
        continue;
      }
      docs.push({ id: doc.id, data });
    }

    if (snap.docs.length > remaining) {
      break;
    }
    if (snap.docs.length < requestLimit) {
      completed = true;
      break;
    }

    lastDoc = rawDocs.at(-1) ?? snap.docs.at(-1);
    if (!lastDoc) {
      completed = true;
      break;
    }
  }

  return {
    docs,
    rawReadCount,
    limitReached: !completed,
  };
}

async function loadTaxReceiptVisibilityScan(db, options) {
  const [givingScan, annualSummaryScan, annualReceiptScan] = await Promise.all([
    readCollectionDocs(db, 'giving', options),
    readCollectionDocs(db, 'taxReceiptSummaries', { ...options, kind: 'annual' }),
    readCollectionDocs(db, 'taxReceipts', { ...options, kind: 'annual' }),
  ]);

  return {
    givingDocs: givingScan.docs,
    annualSummaryDocs: annualSummaryScan.docs,
    annualReceiptDocs: annualReceiptScan.docs,
    rawReadCount: {
      giving: givingScan.rawReadCount,
      annualSummaries: annualSummaryScan.rawReadCount,
      annualReceipts: annualReceiptScan.rawReadCount,
    },
    limitReached: {
      giving: givingScan.limitReached,
      annualSummaries: annualSummaryScan.limitReached,
      annualReceipts: annualReceiptScan.limitReached,
    },
  };
}

async function loadTaxReceiptVisibilityScanWithFirestoreRest(accessToken, options, fetchImpl = fetch) {
  const [givingScan, annualSummaryScan, annualReceiptScan] = await Promise.all([
    readCollectionDocsWithFirestoreRest(fetchImpl, accessToken, 'giving', options),
    readCollectionDocsWithFirestoreRest(fetchImpl, accessToken, 'taxReceiptSummaries', { ...options, kind: 'annual' }),
    readCollectionDocsWithFirestoreRest(fetchImpl, accessToken, 'taxReceipts', { ...options, kind: 'annual' }),
  ]);

  return {
    givingDocs: givingScan.docs,
    annualSummaryDocs: annualSummaryScan.docs,
    annualReceiptDocs: annualReceiptScan.docs,
    rawReadCount: {
      giving: givingScan.rawReadCount,
      annualSummaries: annualSummaryScan.rawReadCount,
      annualReceipts: annualReceiptScan.rawReadCount,
    },
    limitReached: {
      giving: givingScan.limitReached,
      annualSummaries: annualSummaryScan.limitReached,
      annualReceipts: annualReceiptScan.limitReached,
    },
  };
}

async function applyTaxReceiptVisibilityRepairs(db, repairs) {
  let written = 0;
  for (let index = 0; index < repairs.length; index += writeBatchLimit) {
    const batch = db.batch();
    for (const repair of repairs.slice(index, index + writeBatchLimit)) {
      if (repair.paymentMetadataUpdate && typeof repair.paymentMetadataUpdate === 'object') {
        batch.set(
          db.collection(givingPaymentMetadataCollection).doc(repair.id),
          {
            ...repair.paymentMetadataUpdate,
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
      }
      const deleteUpdate = Object.fromEntries(
        (repair.deleteFields ?? []).map((field) => [field, FieldValue.delete()])
      );
      batch.update(db.collection(repair.collection).doc(repair.id), {
        ...repair.update,
        ...deleteUpdate,
        updatedAt: FieldValue.serverTimestamp(),
      });
      written += 1;
    }
    await batch.commit();
  }
  return written;
}

async function applyTaxReceiptVisibilityRepairsWithFirestoreRest(
  fetchImpl,
  accessToken,
  repairs,
  { projectId = expectedProjectId } = {}
) {
  if (typeof fetchImpl !== 'function') {
    throw new Error('Firestore REST repair fallback requires a Node.js runtime with fetch.');
  }

  let written = 0;
  for (let index = 0; index < repairs.length; index += writeBatchLimit) {
    const repairBatch = repairs.slice(index, index + writeBatchLimit);
    if (repairBatch.length === 0) {
      continue;
    }

    const response = await fetchImpl(firestoreRestCommitUrl(projectId), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        writes: repairBatch.flatMap((repair) => firestoreRestWritesForRepair(projectId, repair)),
      }),
    });
    if (!response.ok) {
      throw new Error(`Firestore REST repair commit failed with HTTP ${response.status}.`);
    }
    written += repairBatch.length;
  }
  return written;
}

function limitReachedNames(scan) {
  return Object.entries(scan.limitReached ?? {})
    .filter(([, reached]) => reached === true)
    .map(([name]) => name);
}

function taxReceiptVisibilityAuditFailureReasons(report, scan, options) {
  if (!options.failOnRepairs || options.repair) {
    return [];
  }

  const reasons = [];
  const repairCount = reportRepairCount(report);
  if (repairCount > 0) {
    reasons.push(`${repairCount} legacy receipt visibility repair(s) are still needed.`);
  }

  const limitedCollections = limitReachedNames(scan);
  if (limitedCollections.length > 0) {
    reasons.push(`Audit reached --limit=${options.limit} for: ${limitedCollections.join(', ')}.`);
  }

  return reasons;
}

function taxReceiptVisibilityRepairBlockers(scan, options) {
  const limitedCollections = limitReachedNames(scan);
  if (limitedCollections.length === 0) {
    return [];
  }

  return [
    `Repair mode refuses to write after incomplete scans. Rerun with --limit above ${options.limit} for: ${limitedCollections.join(', ')}.`,
  ];
}

function taxReceiptVisibilityRepairConfirmationBlockers(report, options) {
  if (!options.repair) {
    return [];
  }

  const repairCount = reportRepairCount(report);
  if (repairCount === 0) {
    return [];
  }
  if (options.confirmRepairCount === null || options.confirmRepairCount === undefined) {
    return [
      `Repair mode requires --confirm-repair-count ${repairCount} after reviewing the read-only audit output.`,
    ];
  }
  if (options.confirmRepairCount !== repairCount) {
    return [
      `Repair count confirmation ${options.confirmRepairCount} does not match current repair count ${repairCount}. Rerun the read-only audit and review the current counts before repairing.`,
    ];
  }

  return [];
}

function taxReceiptVisibilityPostRepairVerificationFailureReasons(report, scan, options) {
  const reasons = [];
  const repairCount = reportRepairCount(report);
  if (repairCount > 0) {
    reasons.push(`${repairCount} legacy receipt visibility repair(s) still remain after repair.`);
  }

  const limitedCollections = limitReachedNames(scan);
  if (limitedCollections.length > 0) {
    reasons.push(`Post-repair verification reached --limit=${options.limit} for: ${limitedCollections.join(', ')}.`);
  }

  return reasons;
}

function taxReceiptVisibilityRepairCommand(options, report) {
  const args = [
    'npm',
    'run',
    'audit:tax-receipts',
    '--',
    '--repair',
    '--confirm-project',
    expectedProjectId,
  ];
  if (options.churchId) {
    args.push('--church', options.churchId);
  }
  if (options.limit !== defaultScanLimit) {
    args.push('--limit', String(options.limit));
  }
  if (options.pageSize !== defaultPageSize) {
    args.push('--page-size', String(options.pageSize));
  }
  args.push('--confirm-repair-count', String(reportRepairCount(report)));
  return args.map(shellQuote).join(' ');
}

function taxReceiptVisibilityReadOnlyCompletionMessage(options, report) {
  if (reportRepairCount(report) === 0) {
    return 'Read-only audit complete. No legacy receipt visibility repairs are needed.';
  }

  const repairCommand = taxReceiptVisibilityRepairCommand(options, report);
  return `Read-only audit complete. To apply these repairs after review, run: ${repairCommand}`;
}

async function verifyTaxReceiptVisibilityRepairsApplied({
  db,
  accessToken,
  options,
  fetchImpl = fetch,
}) {
  const verificationScan = accessToken
    ? await loadTaxReceiptVisibilityScanWithFirestoreRest(accessToken, options, fetchImpl)
    : await loadTaxReceiptVisibilityScan(db, options);
  const verificationReport = planTaxReceiptVisibilityRepairs(verificationScan);
  const failureReasons = taxReceiptVisibilityPostRepairVerificationFailureReasons(
    verificationReport,
    verificationScan,
    options
  );

  return {
    scan: verificationScan,
    report: verificationReport,
    failureReasons,
  };
}

function printReport(report, scan, options) {
  console.log('Kandilo tax receipt visibility audit');
  console.log('');
  console.log(`Project: ${options.projectId}`);
  console.log(`Church scope: ${options.churchId || 'all churches'}`);
  console.log(`Mode: ${options.repair ? 'repair' : 'read-only audit'}`);
  console.log('');
  console.log(`Scanned giving documents: ${report.scanned.giving}`);
  console.log(`Scanned annual summary mirrors: ${report.scanned.annualSummaries}`);
  console.log(`Scanned annual receipt records: ${report.scanned.annualReceipts}`);
  if (scan.rawReadCount) {
    console.log(`Raw giving documents read: ${scan.rawReadCount.giving}`);
    console.log(`Raw tax receipt summary documents read: ${scan.rawReadCount.annualSummaries}`);
    console.log(`Raw tax receipt documents read: ${scan.rawReadCount.annualReceipts}`);
  }
  for (const [name, reached] of Object.entries(scan.limitReached)) {
    if (reached) {
      console.log(`WARN ${name} scan reached --limit=${options.limit}; rerun with a higher limit.`);
    }
  }
  console.log('');
  console.log(`Repairs needed: ${report.repairCount}`);
  console.log(`  giving: ${report.givingRepairCount}`);
  console.log(`  annual summary mirrors: ${report.annualSummaryRepairCount}`);
  for (const [reason, count] of Object.entries(report.reasonCounts).sort()) {
    console.log(`  ${reason}: ${count}`);
  }
  const effectLines = taxReceiptVisibilityRepairEffectLines(report);
  if (effectLines.length > 0) {
    console.log('');
    console.log('Planned redacted repair effects:');
    for (const line of effectLines) {
      console.log(line);
    }
    console.log('  audit output omits donor emails, giving IDs, receipt IDs, tax identifiers, and receipt contents.');
  }
}

async function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }

  if (options.repair && options.confirmProject !== expectedProjectId) {
    console.error(`Refusing to repair without --confirm-project ${expectedProjectId}.`);
    console.error('Default mode is read-only; run repair only after reviewing the audit output.');
    process.exit(1);
  }
  if (options.repair && options.projectId !== expectedProjectId) {
    console.error(`Refusing to repair unexpected project ${options.projectId}.`);
    process.exit(1);
  }

  let scan;
  let report;
  let db;
  let repairAccessToken = '';
  try {
    // Resolve credentials before Firestore starts concurrent gRPC initialization.
    // A missing ADC must reach the CLI-auth fallback, not an unhandled rejection.
    if (!process.env.FIRESTORE_EMULATOR_HOST) {
      await applicationDefault().getAccessToken();
    }
    db = initializeFirestore(options.projectId);
    scan = await loadTaxReceiptVisibilityScan(db, options);
    report = planTaxReceiptVisibilityRepairs(scan);
  } catch (error) {
    if (isMissingDefaultCredentialsError(error)) {
      console.error(
        options.repair
          ? 'Google Application Default Credentials are not available; trying confirmed Firestore REST repair through Firebase CLI auth.'
          : 'Google Application Default Credentials are not available; trying read-only Firestore REST audit through Firebase CLI auth.'
      );
      try {
        repairAccessToken = readFirebaseCliAccessTokenForAudit();
        scan = await loadTaxReceiptVisibilityScanWithFirestoreRest(repairAccessToken, options);
        report = planTaxReceiptVisibilityRepairs(scan);
      } catch (fallbackError) {
        console.error(taxReceiptVisibilityAuditRuntimeErrorMessage(fallbackError));
        process.exit(1);
      }
    } else {
      console.error(taxReceiptVisibilityAuditRuntimeErrorMessage(error));
      process.exit(1);
    }
  }
  if (!scan || !report) {
    console.error('Tax receipt visibility audit failed before a scan report could be created.');
    process.exit(1);
  }
  printReport(report, scan, options);

  if (!options.repair) {
    const failureReasons = taxReceiptVisibilityAuditFailureReasons(report, scan, options);
    const completionMessage = taxReceiptVisibilityReadOnlyCompletionMessage(options, report);
    if (failureReasons.length > 0) {
      const repairCommand = taxReceiptVisibilityRepairCommand(options, report);
      console.error('');
      console.error(completionMessage);
      for (const reason of failureReasons) {
        console.error(`FAIL ${reason}`);
      }
      console.error(`Run repair after review: ${repairCommand}`);
      console.error('Then rerun: npm run audit:tax-receipts -- --fail-on-repairs');
      process.exit(1);
    }
    console.log('');
    console.log(completionMessage);
    return;
  }

  const repairBlockers = taxReceiptVisibilityRepairBlockers(scan, options);
  const repairConfirmationBlockers = taxReceiptVisibilityRepairConfirmationBlockers(report, options);
  const blockers = [...repairBlockers, ...repairConfirmationBlockers];
  if (blockers.length > 0) {
    console.error('');
    for (const blocker of blockers) {
      console.error(`FAIL ${blocker}`);
    }
    console.error('Repair mode requires a complete reviewed scan so visibility is never changed with missing giving context or stale repair counts.');
    process.exit(1);
  }

  let written;
  try {
    written = repairAccessToken
      ? await applyTaxReceiptVisibilityRepairsWithFirestoreRest(fetch, repairAccessToken, report.repairs, options)
      : await applyTaxReceiptVisibilityRepairs(db, report.repairs);
  } catch (error) {
    console.error(taxReceiptVisibilityAuditRuntimeErrorMessage(error));
    process.exit(1);
  }
  console.log('');
  console.log(`Applied ${written} tax receipt visibility repair(s).`);

  let verification;
  try {
    verification = await verifyTaxReceiptVisibilityRepairsApplied({
      db,
      accessToken: repairAccessToken,
      options,
    });
  } catch (error) {
    console.error(taxReceiptVisibilityAuditRuntimeErrorMessage(error));
    process.exit(1);
  }

  if (verification.failureReasons.length > 0) {
    console.error('');
    for (const reason of verification.failureReasons) {
      console.error(`FAIL ${reason}`);
    }
    console.error('Post-repair verification must prove the receipt visibility gate is clean before deployment.');
    process.exit(1);
  }

  console.log('Post-repair verification passed; no legacy receipt visibility repairs remain.');
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  await main();
}

export {
  anonymousDonorLabel,
  applyTaxReceiptVisibilityRepairs,
  applyTaxReceiptVisibilityRepairsWithFirestoreRest,
  expectedProjectId,
  firestoreRestCommitUrl,
  firestoreRestDocumentToAuditDoc,
  firestoreRestListDocumentsUrl,
  firestoreRestValueToJs,
  firestoreRestWriteForRepair,
  firestoreRestWritesForRepair,
  givingVisibilityRepair,
  intendedAnnualDonorAnonymous,
  jsValueToFirestoreRestValue,
  loadTaxReceiptVisibilityScan,
  loadTaxReceiptVisibilityScanWithFirestoreRest,
  planTaxReceiptVisibilityRepairs,
  publicDonorFallback,
  parseArgs,
  readCollectionDocs,
  readCollectionDocsWithFirestoreRest,
  readFirebaseCliAccessTokenForAudit,
  reportRepairCount,
  shellQuote,
  taxReceiptVisibilityAuditRuntimeErrorMessage,
  taxReceiptVisibilityRepairConfirmationBlockers,
  taxReceiptVisibilityRepairBlockers,
  taxReceiptVisibilityAuditFailureReasons,
  taxReceiptVisibilityRepairEffectLines,
  taxReceiptVisibilityRepairCommand,
  taxReceiptVisibilityReadOnlyCompletionMessage,
  taxReceiptVisibilityPostRepairVerificationFailureReasons,
  validateTaxReceiptVisibilityAuditArgs,
  verifyTaxReceiptVisibilityRepairsApplied,
};
