import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readGivingModuleSource } from './givingModuleSource';

const functionsIndexPath = resolve(process.cwd(), 'functions/src/index.ts');
const readinessScriptPath = resolve(process.cwd(), 'scripts/check-stripe-production-readiness.mjs');

describe('tax receipt annual batch source scan', () => {
  it('pages closed-year giving source queries instead of stopping at the first fixed window', () => {
    const source = readGivingModuleSource();

    expect(source).toContain('const ANNUAL_BULK_DONOR_SOURCE_PAGE_SIZE = 1_000;');
    expect(source).toContain('const ANNUAL_BULK_DONOR_SOURCE_SCAN_LIMIT = 50_000;');
    expect(source).toContain('while (true)');
    expect(source).toContain('baseQuery.startAfter(lastDoc).limit(pageSize)');
    expect(source).toContain('sourceTruncated = true;');
    expect(source).not.toContain('.limit(5_000)');
  });

  it('keeps the production readiness check pinned to the paged batch scan', () => {
    const source = readFileSync(readinessScriptPath, 'utf8');

    expect(source).toContain('ANNUAL_BULK_DONOR_SOURCE_PAGE_SIZE');
    expect(source).toContain('ANNUAL_BULK_DONOR_SOURCE_SCAN_LIMIT');
    expect(source).toContain('baseQuery.startAfter(lastDoc).limit(pageSize)');
    expect(source).toContain("!givingSource.includes('.limit(5_000)')");
  });

  it('requires complete donor receipt profiles before receipt-ready Stripe checkout writes donation records', () => {
    const source = readGivingModuleSource();

    expect(source).toContain('function churchRequiresTaxReceiptProfileBeforeCheckout');
    expect(source).toContain('return parseTaxReceiptSettings(church) !== null;');
    expect(source).toContain('requiredDonorTaxReceiptProfile(donorProfileSnap.data() ?? {})');

    const checkoutStart = source.indexOf('export const createStripeCheckoutSession = onCall');
    const checkoutEnd = source.indexOf('export const stripeWebhook = onRequest', checkoutStart);
    expect(checkoutStart).toBeGreaterThan(-1);
    expect(checkoutEnd).toBeGreaterThan(checkoutStart);
    const checkoutSource = source.slice(checkoutStart, checkoutEnd);
    expect(checkoutSource.indexOf('churchRequiresTaxReceiptProfileBeforeCheckout(church)'))
      .toBeLessThan(checkoutSource.indexOf('let stripe: ReturnType<typeof getStripe>;'));
    expect(checkoutSource.indexOf('requiredDonorTaxReceiptProfile(donorProfileSnap.data() ?? {})'))
      .toBeLessThan(checkoutSource.indexOf("const givingRef = db.collection('giving').doc();"));
  });

  it('validates backend Stripe Checkout redirects by parsed HTTPS host', () => {
    const source = readGivingModuleSource();

    const helperStart = source.indexOf('function checkoutUrlIsSafe');
    const helperEnd = source.indexOf('function timestampFromStripeSeconds', helperStart);
    expect(helperStart).toBeGreaterThan(-1);
    expect(helperEnd).toBeGreaterThan(helperStart);
    const helperSource = source.slice(helperStart, helperEnd);

    expect(helperSource).toContain('const parsed = new URL(url);');
    expect(helperSource).toContain("parsed.protocol === 'https:'");
    expect(helperSource).toContain("parsed.hostname === 'checkout.stripe.com'");
    expect(helperSource).toContain('} catch {');
    expect(helperSource).not.toContain('startsWith(');
  });

  it('validates stored single-donation receipts before re-emailing them', () => {
    const source = readGivingModuleSource();

    expect(source).toContain('SINGLE_RECEIPT_GIVING_CHANGED_REVIEW_CODE');
    expect(source).toContain('TAX_RECEIPT_INVALID_CURRENCY_CODE');
    expect(source).toContain('function normalizedTaxReceiptCurrency(');
    expect(source).toContain('function assertGivingCurrencyForTaxReceipt(');
    expect(source).toContain('function unsupportedChurchReceiptSetupJurisdiction(');
    expect(source).toContain('async function unsupportedOfficialReceiptDeliveryJurisdictionForReceipt(');
    expect(source).toContain('function isValidExistingSingleTaxReceiptForGiving(');
    expect(source).toContain('function assertTaxReceiptPdfRenderableReceipt(');
    expect(source).toContain("optionalTrimmedString(receipt.kind, 20) === 'single'");
    expect(source).toContain("optionalTrimmedString(receipt.givingId, 128) === givingId");
    expect(source).toContain("optionalTrimmedString(receipt.userId, 128) === optionalTrimmedString(giving.userId, 128)");
    expect(source).toContain("giving.status === 'completed'");
    expect(source).toContain('receiptEligibleAmountCents === amountCents');
    expect(source).toContain('const receiptCurrency = normalizedTaxReceiptCurrency(receipt.currency);');
    expect(source).toContain('Boolean(receiptCurrency)');
    expect(source).toContain('const currency = assertGivingCurrencyForTaxReceipt(giving);');
    expect(source).toContain('const { kind, currency } = assertTaxReceiptPdfRenderableReceipt(receipt);');
    expect(source).toContain('const currency = normalizedTaxReceiptCurrency(receipt.currency);');
    expect(source).toContain('Tax receipt type is missing or unsupported for official PDF delivery.');
    expect(source).not.toContain("const currency = optionalTrimmedString(receipt.currency, 10) || 'USD';");
    expect(source).toContain('isValidPartialRefundCorrectionReceipt(');
    expect(source).toContain("optionalTrimmedString(receipt.correctionForGivingId, 128) === givingId");
    expect(source).toContain('receipt.originalAmountCents === amounts.originalAmountCents');
    expect(source).toContain('async function assertSingleReceiptMatchesCurrentGivingForAction');
    expect(source).toContain('async function assertSingleReceiptCurrentForPdfDownload');
    expect(source).toContain("assertSingleReceiptMatchesCurrentGivingForAction(receipt, 'downloaded')");
    expect(source).toContain('Tax receipt single-donation download verification failed:');
    expect(source).toContain("assertSingleReceiptCurrentForEmailDelivery(receiptRef, receiptId, receipt, actorUid)");

    const issueStart = source.indexOf('async function issueTaxReceiptForGiving');
    const correctedStart = source.indexOf('async function issueCorrectedTaxReceiptForGiving', issueStart);
    expect(issueStart).toBeGreaterThan(-1);
    expect(correctedStart).toBeGreaterThan(issueStart);
    const issueSource = source.slice(issueStart, correctedStart);
    const existingReceiptStart = issueSource.indexOf('if (existingReceiptSnap.exists)');
    const existingReceiptEnd = issueSource.indexOf('const churchRef = db.collection', existingReceiptStart);
    expect(existingReceiptStart).toBeGreaterThan(-1);
    expect(existingReceiptEnd).toBeGreaterThan(existingReceiptStart);
    const existingReceiptSource = issueSource.slice(existingReceiptStart, existingReceiptEnd);
    expect(existingReceiptSource).toContain('isValidExistingSingleTaxReceiptForGiving(existing, givingRef.id, giving)');
    expect(existingReceiptSource).toContain("throw new HttpsError('failed-precondition', 'The existing tax receipt requires review.');");

    const emailStart = source.indexOf('async function sendTaxReceiptEmail');
    const emailEnd = source.indexOf('const update: Record<string, unknown> = {', emailStart);
    expect(emailStart).toBeGreaterThan(-1);
    expect(emailEnd).toBeGreaterThan(emailStart);
    const emailSource = source.slice(emailStart, emailEnd);
    expect(emailSource).toContain('await unsupportedOfficialReceiptDeliveryJurisdictionForReceipt(receipt)');
    expect(emailSource.indexOf('await unsupportedOfficialReceiptDeliveryJurisdictionForReceipt(receipt)'))
      .toBeLessThan(emailSource.indexOf('assertStoredOfficialReceiptNumber(receipt);'));
    const emailGuard = 'await assertSingleReceiptCurrentForEmailDelivery(receiptRef, receiptId, receipt, actorUid);';
    const firstEmailGuard = emailSource.indexOf(emailGuard);
    const secondEmailGuard = emailSource.indexOf(emailGuard, firstEmailGuard + emailGuard.length);
    const lastEmailGuard = emailSource.lastIndexOf(emailGuard);
    expect(firstEmailGuard).toBeGreaterThan(-1);
    expect(firstEmailGuard)
      .toBeLessThan(emailSource.indexOf('pdfAttachment = await loadRetainedTaxReceiptPdfAttachment'));
    expect(secondEmailGuard).toBeGreaterThan(firstEmailGuard);
    expect(secondEmailGuard)
      .toBeLessThan(emailSource.indexOf('await retainTaxReceiptPdfAttachment('));
    expect(lastEmailGuard).toBeGreaterThan(secondEmailGuard);
    expect(lastEmailGuard)
      .toBeLessThan(emailSource.indexOf('const resend = getResend();'));

    const downloadStart = source.indexOf('export const downloadTaxReceiptPdf = onCall');
    const downloadEnd = source.indexOf('export const sendChurchAnnualTaxReceipts = onCall', downloadStart);
    expect(downloadStart).toBeGreaterThan(-1);
    expect(downloadEnd).toBeGreaterThan(downloadStart);
    const downloadSource = source.slice(downloadStart, downloadEnd);
    expect(downloadSource).toContain('await unsupportedOfficialReceiptDeliveryJurisdictionForReceipt(receipt)');
    expect(downloadSource.indexOf('await unsupportedOfficialReceiptDeliveryJurisdictionForReceipt(receipt)'))
      .toBeLessThan(downloadSource.indexOf('loadRetainedTaxReceiptPdfAttachment(receiptId, receipt)'));
    expect(downloadSource.indexOf('taxReceiptDeliveryDetails = taxReceiptPdfInputFromReceipt(receiptId, receipt);'))
      .toBeLessThan(downloadSource.indexOf('loadRetainedTaxReceiptPdfAttachment(receiptId, receipt)'));
    expect(downloadSource).toContain('renderTaxReceiptPdfAttachment(taxReceiptDeliveryDetails)');
    const downloadGuard = 'await assertSingleReceiptCurrentForPdfDownload(receipt);';
    const firstDownloadGuard = downloadSource.indexOf(downloadGuard);
    const secondDownloadGuard = downloadSource.indexOf(downloadGuard, firstDownloadGuard + downloadGuard.length);
    const lastDownloadGuard = downloadSource.lastIndexOf(downloadGuard);
    expect(firstDownloadGuard).toBeGreaterThan(-1);
    expect(firstDownloadGuard)
      .toBeLessThan(downloadSource.indexOf('loadRetainedTaxReceiptPdfAttachment(receiptId, receipt)'));
    expect(secondDownloadGuard).toBeGreaterThan(firstDownloadGuard);
    expect(secondDownloadGuard)
      .toBeLessThan(downloadSource.indexOf('await retainTaxReceiptPdfAttachment('));
    expect(lastDownloadGuard).toBeGreaterThan(secondDownloadGuard);
    expect(lastDownloadGuard)
      .toBeLessThan(downloadSource.indexOf("action: 'pdf_downloaded'"));
  });

  it('keeps internal receipt document ids out of public receipt-number fallbacks', () => {
    const source = readGivingModuleSource();
    const readinessSource = readFileSync(readinessScriptPath, 'utf8');

    expect(source).toContain('PUBLIC_TAX_RECEIPT_NUMBER_FALLBACK');
    expect(source).toContain('function publicTaxReceiptNumber(value: unknown): string');
    expect(source).toContain('return receiptNumber && receiptNumber.toLowerCase() !== PUBLIC_TAX_RECEIPT_NUMBER_FALLBACK');
    expect(source).toContain('receiptNumber.toLowerCase() === PUBLIC_TAX_RECEIPT_NUMBER_FALLBACK');
    expect(source).toContain('function taxReceiptAlreadyEmailed(receipt: Record<string, unknown>): boolean');
    expect(source).toContain('storedOfficialReceiptNumber(receipt.receiptNumber)');
    expect(source).toContain('function annualGivingIncludesPreviouslyReceipted(');
    expect(source).toContain('Boolean(storedOfficialReceiptNumber(data.taxReceiptNumber))');
    expect(source).not.toContain('Boolean(optionalTrimmedString(data.taxReceiptNumber, 120))');
    expect(source).toContain('function annualReceiptBlocksSingleReceipt(');
    expect(source).toContain('|| !storedOfficialReceiptNumber(receipt.receiptNumber)');
    expect(source).toContain('receiptNumber: publicTaxReceiptNumber(receipt.receiptNumber)');
    expect(source).toContain('taxReceiptNumber: publicTaxReceiptNumber(existing.receiptNumber)');
    expect(source).not.toContain('optionalTrimmedString(receipt.receiptNumber, 120) || receiptId');
    expect(source).not.toContain('String(existing.receiptNumber ?? receiptRef.id)');
    expect(source).not.toContain('String(primaryReceipt.receiptNumber ?? receiptRef.id)');
    expect(source).not.toContain('String(correctedReceipt.receiptNumber ?? correctedReceiptRef.id)');
    expect(source).not.toContain('String(existing.receiptNumber ?? correctedReceiptRef.id)');
    expect(source).not.toContain('String(transactionExisting.receiptNumber ?? correctedReceiptRef.id)');
    expect(source).not.toContain('String(existing.receiptNumber ?? reissuedReceiptRef.id)');
    expect(source).not.toContain('String(existing.receiptNumber ?? targetReceiptRef.id)');
    expect(readinessSource).toContain('PUBLIC_TAX_RECEIPT_NUMBER_FALLBACK');
    expect(readinessSource).toContain('internal receipt document IDs');
  });

  it('redacts raw receipt document ids from receipt-manager send responses', () => {
    const source = readGivingModuleSource();
    const readinessSource = readFileSync(readinessScriptPath, 'utf8');

    expect(source).toContain('function receiptIdForSendResponse(receiptId: string, isOwner: boolean): string');
    expect(source.match(/receiptId: receiptIdForSendResponse\(receipt\.receiptId, isOwner\)/g)?.length).toBe(4);
    expect(source).not.toContain('receiptId: receipt.receiptId,');
    expect(readinessSource).toContain('receiptIdForSendResponse(receipt.receiptId, isOwner)');
    expect(readinessSource).toContain('receipt-manager send responses redact raw receipt document IDs');
  });

  it('blocks stored annual receipt resends and delivery when the current donor-year giving set changed', () => {
    const source = readGivingModuleSource();
    const readinessSource = readFileSync(readinessScriptPath, 'utf8');

    expect(source).toContain('ANNUAL_RECEIPT_GIVING_CHANGED_REVIEW_CODE');
    expect(source).toContain('function assertAnnualReceiptCoversCurrentGiving(');
    expect(source).toContain('async function assertAnnualReceiptCurrentForPdfDownload');
    expect(source).toContain("assertAnnualReceiptCoversCurrentGivingForAction(receipt, 'downloaded')");
    expect(source).toContain("assertAnnualReceiptCoversCurrentGivingForAction(receipt, 'emailed')");
    expect(source).toContain('Tax receipt annual download verification failed:');
    expect(source).toContain('async function assertAnnualReceiptCurrentForEmailDelivery');
    expect(source).toContain('assertAnnualReceiptCoversCurrentGiving(existing, currentValidGiving, timezone)');
    expect(source).toContain('assertAnnualReceiptCoversCurrentGiving(primaryReceipt, validGiving, church.timezone)');
    expect(source).toContain("if (currencies.size !== 1 || currencies.has(''))");
    expect(source).toContain('const currency = normalizedTaxReceiptCurrency(data.currency);');
    expect(source).toContain('entry.hasMixedCurrency = true;');
    expect(source).toContain('const receiptCurrency = normalizedTaxReceiptCurrency(receipt.currency);');
    expect(source).toContain('amounts = annualGivingAmountSummary(validGiving)');
    expect(source).toContain('currency = assertAnnualGivingSingleCurrency(validGiving)');
    expect(source).toContain('receipt.donationCount !== validGiving.length');
    expect(source).toContain('receipt.amountCents === amounts.amountCents');
    expect(source).toContain('receipt.eligibleAmountCents === amounts.eligibleAmountCents');
    expect(source).toContain('receipt.amountCents === amounts.eligibleAmountCents');
    expect(source).toContain('receipt.originalAmountCents === amounts.amountCents');
    expect(source).toContain('receipt.refundedAmountCents === amounts.refundedAmountCents');
    expect(source).toContain('function annualContributionRecordsMatchReceipt(');
    expect(source).toContain('expectedContributions = annualContributionRecords(validGiving, timezone, fallbackCurrency);');
    expect(source).toContain("optionalTrimmedString(record.dateLabel, 80) === expected.dateLabel");
    expect(source).toContain("optionalTrimmedString(record.purpose, 200) === expected.purpose");
    expect(source).toContain('annualContributionRecordsMatchReceipt(receipt, validGiving, timezone, currency)');
    expect(source).toContain('Annual tax receipt contribution detail is missing.');
    expect(source).toContain('Annual tax receipt contribution currency does not match the receipt currency.');
    expect(source).toContain('contributions.length !== donationCount');
    expect(source).toContain('contributionAmountTotalCents !== expectedContributionAmountTotalCents');
    expect(source).toContain('contributionEligibleTotalCents !== eligibleAmountCents');
    expect(source).toContain('primaryReceiptNeedsFullRefundVoid = true');
    expect(source).toContain('const reissueForFullRefund = primaryReceiptVoided || primaryReceiptNeedsFullRefundVoid');
    expect(readinessSource).toContain('Stored annual receipt resend, email delivery, and donor PDF download also verify the covered donation IDs, totals, donation count, explicit supported currency, and itemized contribution lines still match the current closed-year donor-year set');

    const summaryStart = source.indexOf('function annualReceiptSummaryFromReceipt(');
    const summaryEnd = source.indexOf('function annualReceiptSummaryPrivacyOverridesFromGivingRecords', summaryStart);
    expect(summaryStart).toBeGreaterThan(-1);
    expect(summaryEnd).toBeGreaterThan(summaryStart);
    const summarySource = source.slice(summaryStart, summaryEnd);
    expect(summarySource).toContain('const currency = normalizedTaxReceiptCurrency(receipt.currency);');
    expect(summarySource).toContain('currency,');
    expect(summarySource).not.toContain("optionalTrimmedString(receipt.currency, 10) || 'USD'");

    const resendStart = source.indexOf('async function existingAnnualTaxReceiptForResend');
    const resendEnd = source.indexOf('async function loadAnnualDonorIdsForChurch');
    expect(resendStart).toBeGreaterThan(-1);
    expect(resendEnd).toBeGreaterThan(resendStart);
    const resendSource = source.slice(resendStart, resendEnd);
    expect(resendSource.indexOf('const coveredRefundDetails = await receiptCoveredGivingRefundDetails(existing);'))
      .toBeLessThan(resendSource.indexOf('assertAnnualReceiptCoversCurrentGiving(existing, currentValidGiving, timezone);'));

    const issueStart = source.indexOf('async function issueAnnualTaxReceiptForDonor');
    const issueEnd = source.indexOf('type ScheduledAnnualPreparationResult');
    expect(issueStart).toBeGreaterThan(-1);
    expect(issueEnd).toBeGreaterThan(issueStart);
    const issueSource = source.slice(issueStart, issueEnd);
    const noEligibleStart = issueSource.indexOf('if (validGiving.length === 0)');
    const noEligibleEnd = issueSource.indexOf('if (validGiving.some', noEligibleStart);
    expect(noEligibleStart).toBeGreaterThan(-1);
    expect(noEligibleEnd).toBeGreaterThan(noEligibleStart);
    const noEligibleSource = issueSource.slice(noEligibleStart, noEligibleEnd);
    expect(noEligibleSource).toContain('annualReceiptFullRefundVoidedWithoutEligibleGiving = true');
    expect(noEligibleSource).not.toContain('await tx.get');

    const reissueReadStart = issueSource.indexOf('const existingReissueSnap = await tx.get(targetReceiptRef);');
    const reissueReadEnd = issueSource.indexOf('issueResult = {', reissueReadStart);
    expect(reissueReadStart).toBeGreaterThan(-1);
    expect(reissueReadEnd).toBeGreaterThan(reissueReadStart);
    const reissueReadSource = issueSource.slice(reissueReadStart, reissueReadEnd);
    expect(reissueReadSource).toContain('voidTaxReceiptInTransaction(\n            tx,\n            receiptRef,');

    const emailStart = source.indexOf('async function sendTaxReceiptEmail');
    const emailEnd = source.indexOf('const update: Record<string, unknown> = {', emailStart);
    expect(emailStart).toBeGreaterThan(-1);
    expect(emailEnd).toBeGreaterThan(emailStart);
    const emailSource = source.slice(emailStart, emailEnd);
    const emailGuard = 'await assertAnnualReceiptCurrentForEmailDelivery(receiptRef, receiptId, receipt, actorUid);';
    const firstEmailGuard = emailSource.indexOf(emailGuard);
    const secondEmailGuard = emailSource.indexOf(emailGuard, firstEmailGuard + emailGuard.length);
    const lastEmailGuard = emailSource.lastIndexOf(emailGuard);
    expect(firstEmailGuard).toBeGreaterThan(-1);
    expect(firstEmailGuard)
      .toBeLessThan(emailSource.indexOf('pdfAttachment = await loadRetainedTaxReceiptPdfAttachment'));
    expect(secondEmailGuard).toBeGreaterThan(firstEmailGuard);
    expect(secondEmailGuard)
      .toBeLessThan(emailSource.indexOf('await retainTaxReceiptPdfAttachment('));
    expect(lastEmailGuard).toBeGreaterThan(secondEmailGuard);
    expect(lastEmailGuard)
      .toBeLessThan(emailSource.indexOf('const resend = getResend();'));

    const downloadStart = source.indexOf('export const downloadTaxReceiptPdf = onCall');
    const downloadEnd = source.indexOf('export const sendChurchAnnualTaxReceipts = onCall', downloadStart);
    expect(downloadStart).toBeGreaterThan(-1);
    expect(downloadEnd).toBeGreaterThan(downloadStart);
    const downloadSource = source.slice(downloadStart, downloadEnd);
    const downloadGuard = 'await assertAnnualReceiptCurrentForPdfDownload(receipt);';
    const firstDownloadGuard = downloadSource.indexOf(downloadGuard);
    const secondDownloadGuard = downloadSource.indexOf(downloadGuard, firstDownloadGuard + downloadGuard.length);
    const lastDownloadGuard = downloadSource.lastIndexOf(downloadGuard);
    expect(firstDownloadGuard).toBeGreaterThan(-1);
    expect(firstDownloadGuard)
      .toBeLessThan(downloadSource.indexOf('loadRetainedTaxReceiptPdfAttachment(receiptId, receipt)'));
    expect(secondDownloadGuard).toBeGreaterThan(firstDownloadGuard);
    expect(secondDownloadGuard)
      .toBeLessThan(downloadSource.indexOf('await retainTaxReceiptPdfAttachment('));
    expect(lastDownloadGuard).toBeGreaterThan(secondDownloadGuard);
    expect(lastDownloadGuard)
      .toBeLessThan(downloadSource.indexOf("action: 'pdf_downloaded'"));
  });

  it('can separately opt into safe scheduled annual receipt emails', () => {
    const source = readGivingModuleSource();
    const start = source.indexOf('function annualReceiptPreparationOptedIn');
    const end = source.indexOf('async function recordTaxReceiptEmailFailure');
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const preparationSource = source.slice(start, end);

    expect(preparationSource).toContain('settings?.annualPreparationEnabled');
    expect(preparationSource).toContain('annualReceiptAutoEmailOptedIn');
    expect(preparationSource).toContain('settings.annualAutoEmailEnabled === true');
    expect(preparationSource).toContain('const shouldAutoEmail = annualReceiptAutoEmailOptedIn(church)');
    expect(preparationSource).toContain('settings.enabled === true');
    expect(preparationSource).toContain("settings.jurisdiction === 'US'");
    expect(preparationSource).toContain('loadActiveChurchesForScheduledAnnualPreparation');
    expect(preparationSource).toContain('SCHEDULED_ANNUAL_CHURCH_PAGE_SIZE');
    expect(preparationSource).toContain('SCHEDULED_ANNUAL_CHURCH_SCAN_LIMIT');
    expect(preparationSource).toContain('orderBy(FieldPath.documentId())');
    expect(preparationSource).toContain('activeChurchScanTruncated');
    expect(preparationSource).toContain('entry.hasPartialRefund');
    expect(preparationSource)
      .toContain('annualGivingIncludesPreviouslyReceiptedEvidence(entry.validGiving, churchId, entry.userId)');
    expect(preparationSource).toContain('SCHEDULED_ANNUAL_DONOR_LIMIT_PER_CHURCH');
    expect(preparationSource).toContain('issueAnnualTaxReceiptForDonor(');
    expect(preparationSource).toContain('SCHEDULED_ANNUAL_RECEIPT_ACTOR_UID');
    expect(preparationSource).toContain('if (shouldAutoEmail)');
    expect(preparationSource).toContain('receipt.emailSent === true');
    expect(preparationSource).toContain('skippedAlreadyEmailedCount');
    expect(preparationSource).toContain('emailSentCount');
    expect(preparationSource).toContain('await sendTaxReceiptEmail(receipt.receiptId, SCHEDULED_ANNUAL_RECEIPT_ACTOR_UID)');
    expect(preparationSource).toContain("action: 'annual_scheduled_item_failed'");
    expect(preparationSource).toContain('logScheduledAnnualPreparationReviewSummaries(result)');
    expect(preparationSource).toContain("action: 'annual_scheduled_review_summary'");
    expect(preparationSource).toContain('reviewCount: summary.count');
    expect(preparationSource).toContain('STRIPE_PARTIAL_REFUND_REVIEW_REASON');
    expect(preparationSource).toContain('ANNUAL_RECEIPT_MIXED_CURRENCY_REVIEW_CODE');
    expect(preparationSource).toContain('PREVIOUSLY_RECEIPTED_ACK_REQUIRED_CODE');
  });

  it('exports scheduled annual receipt preparation for Firebase deployment checks', () => {
    const indexSource = readFileSync(functionsIndexPath, 'utf8');
    const readinessSource = readFileSync(readinessScriptPath, 'utf8');

    expect(indexSource).toContain('prepareYearEndAnnualTaxReceipts');
    expect(readinessSource).toContain('prepareYearEndAnnualTaxReceipts');
    expect(readinessSource).toContain('annualPreparationEnabled');
    expect(readinessSource).toContain("secrets: ['RESEND_API_KEY']");
  });
});
