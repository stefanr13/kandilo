import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('GivingScreen receipt safeguards', () => {
  it('requires explicit confirmation before donor annual receipt duplicate-claim acknowledgement', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/components/GivingScreen.tsx'), 'utf8');

    expect(source).toContain('const [pendingAnnualReceiptAck, setPendingAnnualReceiptAck] = useState<');
    expect(source).toContain('const confirmDonorAnnualReceiptSend =');
    expect(source).toContain('needsPreviouslyReceiptedAcknowledgement');
    expect(source).toContain('setPendingAnnualReceiptAck({ key: annualKey, corrected });');
    expect(source).toContain('setReceiptMessage(extra.taxReceiptPreviouslyReceiptedAckRequired);');
    expect(source).toContain('void handleSendAnnualTaxReceipt(');
    expect(source).toContain('annualIncludesPreviouslyReceipted');
    expect(source).toContain('row.candidateIncludesPreviouslyReceipted');
    expect(source).toContain('row.candidateHasMixedCurrency');
    expect(source).toContain('extra.annualReceiptMixedCurrencyBlocked');
    expect(source).toContain('aria-pressed={confirmingAnnualSend}');
    expect(source).not.toContain('onClick={() => void handleSendAnnualTaxReceipt(');
  });

  it('opens donor annual receipts immediately after send responses return a receipt id', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/components/GivingScreen.tsx'), 'utf8');
    const annualSendSource = source.slice(
      source.indexOf('const handleSendAnnualTaxReceipt = async'),
      source.indexOf('const confirmDonorAnnualReceiptSend =')
    );

    expect(annualSendSource).toContain('const result = corrected');
    expect(annualSendSource).toContain('? await sendCorrectedAnnualTaxReceipt({ churchId, year, acknowledgePreviouslyReceipted })');
    expect(annualSendSource).toContain(': await sendAnnualTaxReceipt({ churchId, year, acknowledgePreviouslyReceipted });');
    expect(annualSendSource).toContain('const receipt = await getTaxReceipt(result.receiptId);');
    expect(annualSendSource).toContain('if (receipt) {');
    expect(annualSendSource).toContain('setSelectedReceipt(receipt);');
    expect(annualSendSource).toContain("console.error('Failed to load annual tax receipt after sending:', loadError);");
  });

  it('marks donor giving rows covered by exact annual receipt giving IDs before offering single receipt sends', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/components/GivingScreen.tsx'), 'utf8');
    const receiptHistorySource = source.slice(
      source.indexOf('const annualRows = donorAnnualReceiptRows({'),
      source.indexOf("if (givingPhase === 'details')")
    );

    expect(receiptHistorySource).toContain('const annualCoveredGivingIds = new Set');
    expect(receiptHistorySource).toContain('taxReceiptRecords.flatMap');
    expect(receiptHistorySource).toContain("receipt.kind !== 'annual'");
    expect(receiptHistorySource).toContain("receipt.status === 'voided'");
    expect(receiptHistorySource).toContain('|| receipt.correctionReason');
    expect(receiptHistorySource).toContain('return receipt.givingIds;');
    expect(receiptHistorySource).toContain('const coveredByAnnualReceipt = annualCoveredGivingIds.has(record.id);');
    expect(receiptHistorySource).toContain('coveredByAnnualReceipt: coveredByAnnualReceiptOnly');
    expect(receiptHistorySource).toContain('donorGivingReceiptActionAvailability(');
    expect(receiptHistorySource).toContain('matchedTaxReceipt,');
    expect(receiptHistorySource).toContain('unsupportedJurisdiction: recordUnsupportedJurisdiction');
    expect(receiptHistorySource).toContain('recordUnsupportedJurisdiction');
    expect(receiptHistorySource).toContain('? extra.taxReceiptUnsupportedJurisdiction');
    expect(receiptHistorySource).toContain('coveredByAnnualReceipt');
    expect(receiptHistorySource).toContain('receiptStatusLabel(record, coveredByAnnualReceiptOnly)');
    expect(source).toContain('taxReceiptIncludedInAnnual');
    expect(receiptHistorySource).not.toContain('settledAnnualReceiptKeys');
    expect(source).not.toContain('donorAnnualReceiptRowKey');
  });

  it('hides donor PDF download and print controls for invalid full receipt records', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/components/GivingScreen.tsx'), 'utf8');

    expect(source).toContain('const taxReceiptActionBlocked = (receipt: FirestoreTaxReceiptRecord): boolean => (');
    expect(source).toContain('const blockedTaxReceiptMessage = (receipt: FirestoreTaxReceiptRecord): string => {');
    expect(source).toContain('const receiptAction = donorTaxReceiptActionAvailability(receipt, receiptActionContextForChurch(receipt.churchId));');
    expect(source).toContain('receiptAction.unsupportedJurisdiction');
    expect(source).toContain('return extra.taxReceiptUnsupportedJurisdiction;');
    expect(source).toContain('receiptAction.missingAssignedReceiptNumber');
    expect(source).toContain('receiptAction.invalidCurrency');
    expect(source).toContain('return extra.taxReceiptGenericIssue;');
    expect(source).toContain('unsupportedJurisdiction: receiptUnsupportedJurisdiction');
    expect(source).toContain('missingAssignedReceiptNumber: receiptMissingAssignedReceiptNumber');
    expect(source).toContain('invalidCurrency: receiptInvalidCurrency');
    expect(source).toContain('receiptMissingAssignedReceiptNumber || receiptInvalidCurrency');
    expect(source).toContain('const receiptDetailLabel = receiptUnsupportedJurisdiction');
    expect(source).toContain(': extra.officialTaxReceipt;');
    expect(source).toContain('{receiptDetailLabel}');
    expect(source).toContain('formatTaxReceiptAmount(amountCents, currency)');
    expect(source).toContain('const standaloneReceiptAction =');
    expect(source).toContain('standaloneReceiptAction.missingAssignedReceiptNumber || standaloneReceiptAction.invalidCurrency');
    expect(source).toContain('if (taxReceiptActionBlocked(selectedReceipt))');
    expect(source).toContain('setReceiptMessage(blockedTaxReceiptMessage(selectedReceipt));');
    expect(source).toContain('if (selectedReceipt?.id === receiptId && taxReceiptActionBlocked(selectedReceipt))');
    expect(source).toContain('{!receiptActionBlocked && (');
    expect(source).toContain('onClick={() => void handleDownloadTaxReceipt(selectedReceipt.id)}');
    expect(source).toContain('onClick={handlePrintTaxReceipt}');
    expect(source).not.toContain('disabled={downloadingReceiptId === selectedReceipt.id || receiptActionBlocked}');
    expect(source).not.toContain('disabled={receiptActionBlocked}');
  });

  it('maps safe backend receipt error codes for donor PDF download failures', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/components/GivingScreen.tsx'), 'utf8');
    const downloadSource = source.slice(
      source.indexOf('const receiptDownloadErrorMessages: ReceiptDeliveryErrorMessages = {'),
      source.indexOf('const formatGivingAmount =')
    );

    expect(source).toContain('unsupportedJurisdiction: extra.taxReceiptUnsupportedJurisdiction');
    expect(downloadSource).toContain('...receiptDeliveryErrorMessages');
    expect(downloadSource).toContain('fallback: extra.taxReceiptDownloadError');
    expect(downloadSource).toContain('await downloadTaxReceiptPdf({ receiptId });');
    expect(downloadSource).toContain(
      'setReceiptMessage(callableReceiptDeliveryErrorMessage(error, receiptDownloadErrorMessages));'
    );
    expect(downloadSource).not.toContain('setReceiptMessage(extra.taxReceiptDownloadError);');
  });

  it('keeps immediate receipt history access on the post-Stripe success screen', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/components/GivingScreen.tsx'), 'utf8');
    const successSource = source.slice(
      source.indexOf("if (givingPhase === 'success')"),
      source.indexOf('const onlineGivingOptions = [')
    );

    expect(successSource).toContain('extra.receiptHistoryTitle');
    expect(successSource).toContain('<ReceiptText size={16} />');
    expect(source).toContain('parsePendingGivingCheckoutState(');
    expect(source).toContain('checkoutReturnMatchesPendingGiving(pending, givingId, sessionId)');
    expect(source).toContain('givingId: result.givingId');
    expect(source).toContain('sessionId: result.sessionId');
    expect(source).toContain('const [focusReceiptHistory, setFocusReceiptHistory] = useState(false);');
    expect(source).toContain('const desktopReceiptHistoryRef = useRef<HTMLDivElement | null>(null);');
    expect(source).toContain('const mobileReceiptHistoryRef = useRef<HTMLDivElement | null>(null);');
    expect(source).toContain("window.matchMedia('(min-width: 1024px)').matches");
    expect(source).toContain("target?.scrollIntoView({ behavior: 'smooth', block: 'start' });");
    expect(source).toContain('target?.focus({ preventScroll: true });');
    expect(successSource).toContain('setFocusReceiptHistory(true);');
    expect(successSource).toContain("setGivingPhase('none');");
    expect(successSource).toContain("onScreenChange?.('home');");
    expect(successSource.indexOf('extra.receiptHistoryTitle')).toBeLessThan(
      successSource.indexOf("onScreenChange?.('home');")
    );
    expect(source).toContain('ref={desktopReceiptHistoryRef}');
    expect(source).toContain('ref={mobileReceiptHistoryRef}');
    expect(source).toContain('role="region"');
    expect(source).toContain('tabIndex={-1}');
    expect(source).toContain('aria-label={extra.receiptHistoryTitle}');
  });

  it('does not advertise unsupported giving modes or hardcoded campaign metrics', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/components/GivingScreen.tsx'), 'utf8');
    const publicGivingSource = source.slice(source.indexOf('const onlineGivingOptions = ['));

    expect(publicGivingSource).toContain('const onlineGivingOptions = [');
    expect(publicGivingSource).toContain('t.oneTimeTitle');
    expect(publicGivingSource).toContain("onClick={() => setGivingPhase('details')}");
    expect(publicGivingSource).not.toContain('t.monthlyTitle');
    expect(publicGivingSource).not.toContain('t.buildingTitle');
    expect(publicGivingSource).not.toContain('t.inPersonTitle');
    expect(publicGivingSource).not.toContain('extra.yourImpact');
    expect(publicGivingSource).not.toContain('$250,000');
    expect(publicGivingSource).not.toContain('$162,500');
    expect(publicGivingSource).not.toContain("'342'");
    expect(publicGivingSource).not.toContain("'$12K'");
    expect(publicGivingSource).not.toContain("'89%'");
    expect(publicGivingSource).not.toContain("'5 yrs'");
  });

  it('uses the active church currency for Checkout and visible donation amounts', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/components/GivingScreen.tsx'), 'utf8');

    expect(source).toContain('donationCurrencyForChurchCountry(church?.country)');
    expect(source).toContain("const [activeChurchDonationCurrency, setActiveChurchDonationCurrency] = useState<DonationCurrency>('USD');");
    expect(source).toContain("const donationCurrencyPrefix = activeChurchDonationCurrency === 'CAD' ? 'CA$' : '$';");
    expect(source).toContain('currency: activeChurchDonationCurrency');
    expect(source).toContain('formatDonationAmount(Number(val), 0)');
    expect(source).toContain('formatDonationCents(amountCents)');
    expect(source).not.toContain('${(amountCents / 100).toFixed(2)}');
    expect(source).not.toContain("t.successMessage.replace('{amount}', `$${amount}`)");
  });

  it('surfaces Canadian receipt unsupported state instead of generic not-enabled copy', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/components/GivingScreen.tsx'), 'utf8');
    const churchReceiptStateSource = source.slice(
      source.indexOf('return subscribeToChurch(activeChurchId, (church) => {'),
      source.indexOf('const receiptStatusLabel =')
    );
    const taxReceiptStatusLabelSource = source.slice(
      source.indexOf('const taxReceiptStatusLabel ='),
      source.indexOf('const formatReceiptAmount =')
    );

    expect(source).toContain('const [activeChurchTaxReceiptState, setActiveChurchTaxReceiptState]');
    expect(churchReceiptStateSource).toContain('const receiptState = getTaxReceiptIssuanceState(church?.taxReceiptSettings);');
    expect(churchReceiptStateSource).toContain("setActiveChurchTaxReceiptState(church?.isActive === true ? receiptState : 'disabled');");
    expect(source).toContain("const TAX_RECEIPT_UNSUPPORTED_JURISDICTION_CODE = 'tax_receipt_unsupported_jurisdiction';");
    expect(source).toContain('const recordUnsupportedJurisdiction =');
    expect(source).toContain('record.taxReceiptError === TAX_RECEIPT_UNSUPPORTED_JURISDICTION_CODE');
    expect(source).toContain('const recordTaxReceiptState = taxReceiptStateForChurch(record.churchId);');
    expect(source).toContain("recordTaxReceiptState === 'unsupported_jurisdiction'");
    expect(source).toContain('extra.taxReceiptUnsupportedJurisdiction');
    expect(source).toContain('const annualUnavailableLabel =');
    expect(source).toContain('? extra.taxReceiptUnsupportedJurisdiction');
    expect(source).toContain('? annualUnavailableLabel');
    expect(source).toContain('const annualSendButtonLabel =');
    expect(source).toContain('const annualProfileAwareSendButtonLabel =');
    expect(source).toContain('title={annualProfileAwareSendButtonLabel}');
    expect(source).toContain('aria-label={annualProfileAwareSendButtonLabel}');
    expect(taxReceiptStatusLabelSource).toContain('const receiptAction = donorTaxReceiptActionAvailability(');
    expect(taxReceiptStatusLabelSource).toContain('receiptActionContextForChurch(receipt.churchId)');
    expect(taxReceiptStatusLabelSource).toContain('if (receiptAction.unsupportedJurisdiction) return extra.taxReceiptUnsupportedJurisdiction;');
    expect(taxReceiptStatusLabelSource).toContain('if (receiptAction.missingAssignedReceiptNumber) return extra.taxReceiptGenericIssue;');
  });

  it('uses each donor receipt row church setup instead of the active parish setup', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/components/GivingScreen.tsx'), 'utf8');
    const receiptHistorySource = source.slice(
      source.indexOf('const receiptGivingRecords = givingRecords;'),
      source.indexOf("if (givingPhase === 'details')")
    );

    expect(source).toContain('const [receiptChurchStates, setReceiptChurchStates]');
    expect(source).toContain('...givingRecords.map((record) => record.churchId)');
    expect(source).toContain('...taxReceiptRecords.map((receipt) => receipt.churchId)');
    expect(source).toContain('...annualTaxReceiptSummaries.map((summary) => summary.churchId)');
    expect(source).toContain('const taxReceiptStateForChurch =');
    expect(source).toContain('const taxReceiptReadyForChurch =');
    expect(source).toContain('const receiptTimezoneForChurch =');
    expect(source).toContain('const receiptActionContextForChurch =');
    expect(source).toContain("activeChurchTaxReceiptUnsupported: taxReceiptStateForChurch(churchId) === 'unsupported_jurisdiction'");
    expect(receiptHistorySource).toContain('const singleTaxReceipts = taxReceiptRecords.filter((receipt) => receipt.kind === \'single\');');
    expect(receiptHistorySource).toContain('churchTimezoneForChurch: receiptTimezoneForChurch');
    expect(receiptHistorySource).toContain('receiptActionContextForChurch(record.churchId)');
    expect(receiptHistorySource).toContain('receiptActionContextForChurch(receipt.churchId)');
    expect(receiptHistorySource).toContain('taxReceiptProfileBlocksReceiptIssuanceForChurch(record.churchId)');
    expect(receiptHistorySource).toContain('taxReceiptProfileBlocksReceiptIssuanceForChurch(receipt.churchId)');
    expect(receiptHistorySource).toContain('const annualTaxReceiptState = taxReceiptStateForChurch(row.churchId);');
    expect(receiptHistorySource).toContain('const annualTaxReceiptReady = taxReceiptReadyForChurch(row.churchId);');
    expect(receiptHistorySource).toContain("taxReceiptIssuanceUnsupported: annualTaxReceiptState === 'unsupported_jurisdiction'");
    expect(receiptHistorySource).toContain('taxReceiptProfileBlocksReceiptIssuanceForChurch(row.churchId)');
    expect(receiptHistorySource).not.toContain('activeChurchId,');
    expect(receiptHistorySource).not.toContain('churchTimezone: activeChurchTimezone');
    expect(receiptHistorySource).not.toContain('const activeSingleTaxReceipts');
    expect(source).not.toContain('const recordBelongsToActiveChurch =');
  });

  it('keeps donor receipt history populated from standalone receipts and annual summaries when giving history is capped', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/components/GivingScreen.tsx'), 'utf8');
    const receiptStateSource = source.slice(
      source.indexOf('const receiptGivingRecords = givingRecords;'),
      source.indexOf('const hasReceiptReadyChurch =')
    );
    const receiptHistorySource = source.slice(
      source.indexOf('const renderReceiptHistory = () => ('),
      source.indexOf("if (givingPhase === 'details')")
    );

    expect(receiptStateSource).toContain('const standaloneSingleTaxReceipts = singleTaxReceipts.filter(');
    expect(receiptStateSource).toContain('!visibleTaxReceiptIds.has(receipt.id)');
    expect(receiptStateSource).toContain('!visibleGivingIds.has(receipt.givingId)');
    expect(receiptStateSource).toContain('const annualRows = donorAnnualReceiptRows({');
    expect(receiptStateSource).toContain('annualSummaries: annualTaxReceiptSummaries');
    expect(receiptStateSource).toContain('const receiptHistoryHasEntries =');
    expect(receiptStateSource).toContain(
      'receiptGivingRecords.length > 0 || standaloneSingleTaxReceipts.length > 0 || annualRows.length > 0'
    );
    expect(receiptHistorySource).toContain('!receiptHistoryHasEntries');
    expect(receiptHistorySource).toContain('{standaloneSingleTaxReceipts.map((receipt) => {');
    expect(receiptHistorySource).toContain('{!receiptHistoryLoading && annualRows.length > 0 && (');
    expect(receiptHistorySource).toContain('{annualRows.map((row) => {');
  });

  it('keeps the donor tax receipt profile prompt live after Profile updates', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/components/GivingScreen.tsx'), 'utf8');
    const profileEffectSource = source.slice(
      source.indexOf('useEffect(() => {\n    if (!currentUser || currentUser.isAnonymous || currentUser.emailVerified !== true) {\n      setTaxReceiptProfileLoaded(false);'),
      source.indexOf('useEffect(() => {\n    if (!activeChurchId) {')
    );

    expect(source).toContain('subscribeToUserProfile');
    expect(profileEffectSource).toContain('currentUser.emailVerified !== true');
    expect(profileEffectSource).toContain('return subscribeToUserProfile(');
    expect(profileEffectSource).toContain('setTaxReceiptProfileReady(isTaxReceiptProfileComplete(profile));');
    expect(profileEffectSource).toContain('setTaxReceiptProfileLoaded(true);');
    expect(profileEffectSource).not.toContain('getUserProfile(currentUser.uid)');
  });

  it('shows missing donor receipt profile guidance beside receipt-history send actions', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/components/GivingScreen.tsx'), 'utf8');
    const receiptHistorySource = source.slice(
      source.indexOf('const renderReceiptHistory = () => ('),
      source.indexOf('if (givingPhase === \'details\')')
    );

    expect(source).toContain('const renderTaxReceiptProfilePrompt = (showReadyState: boolean');
    expect(source).toContain('!showReadyState && taxReceiptProfileLoaded && taxReceiptProfileReady');
    expect(receiptHistorySource).toContain("renderTaxReceiptProfilePrompt(false, 'mb-4')");
    expect(receiptHistorySource).toContain('receiptSendRequiresProfile');
    expect(receiptHistorySource).toContain('receiptSendBlockedByProfile');
    expect(receiptHistorySource).toContain('disabled={sending || receiptSendBlockedByProfile}');
    expect(receiptHistorySource).toContain('extra.taxReceiptProfileRequiredAction');
    expect(source).toContain('TAX_RECEIPT_DONOR_PROFILE_INCOMPLETE_CODE');
    expect(source).toContain('taxReceiptProfileBlocksReceiptIssuanceForChurch(record.churchId)');
    expect(source).toContain('record.taxReceiptError === TAX_RECEIPT_DONOR_PROFILE_INCOMPLETE_CODE');
    expect(source).toContain('extra.taxReceiptProfileNeeded');
    expect(source).toContain('const donorReceiptDeliveryErrorMessage = (');
    expect(source).toContain('safeReceiptErrorCode(errorCode) === TAX_RECEIPT_DONOR_PROFILE_INCOMPLETE_CODE');
    expect(source).toContain('&& !taxReceiptProfileBlocksReceiptIssuanceForChurch(churchId)');
    expect(receiptHistorySource).toContain('donorReceiptDeliveryErrorMessage(');
    expect(source).toContain('renderTaxReceiptProfilePrompt(true)');
  });

  it('lets donors save private legal receipt details inline before Stripe checkout', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/components/GivingScreen.tsx'), 'utf8');
    const promptSource = source.slice(
      source.indexOf('const renderTaxReceiptProfilePrompt = (showReadyState: boolean'),
      source.indexOf('const renderReceiptHistory = () => (')
    );

    expect(source).toContain('updateUserTaxReceiptProfile');
    expect(source).toContain('const [taxReceiptProfileForm, setTaxReceiptProfileForm] = useState<');
    expect(source).toContain('const handleSaveTaxReceiptProfile = async () => {');
    expect(source).toContain('await updateUserTaxReceiptProfile(currentUser.uid, taxReceiptProfileForm);');
    expect(source).toContain('setTaxReceiptProfileMessage(extra.taxReceiptProfileIncomplete);');
    expect(promptSource).toContain('profileExtra.taxReceiptLegalName');
    expect(promptSource).toContain("setTaxReceiptAddressField('line1', event.target.value)");
    expect(promptSource).toContain("setTaxReceiptAddressField('postalCode', event.target.value)");
    expect(promptSource).toContain('extra.taxReceiptProfileSave');
    expect(promptSource).toContain('extra.taxReceiptProfileOpen');
  });

  it('requires saved receipt details before Stripe checkout when receipt issuance is ready', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/components/GivingScreen.tsx'), 'utf8');
    const checkoutSource = source.slice(
      source.indexOf('const taxReceiptProfileBlocksReceiptIssuance = Boolean('),
      source.indexOf('const handleSendTaxReceipt = async')
    );
    const detailsSource = source.slice(
      source.indexOf("if (givingPhase === 'details')"),
      source.indexOf("if (givingPhase === 'payment')")
    );
    const paymentSource = source.slice(
      source.indexOf("if (givingPhase === 'payment')"),
      source.indexOf("if (givingPhase === 'success')")
    );

    expect(source).toContain('const taxReceiptProfileIncompleteOrSaving = Boolean(');
    expect(source).toContain('!taxReceiptProfileLoaded || !taxReceiptProfileReady || taxReceiptProfileSaving');
    expect(source).toContain('const checkoutPrerequisiteBlocked =');
    expect(source).toContain('currentUserNeedsEmailVerification || taxReceiptProfileBlocksCheckout');
    expect(source).toContain('const checkoutPrerequisiteActionLabel = currentUserNeedsEmailVerification');
    expect(checkoutSource).toContain('taxReceiptProfileBlocksReceiptIssuanceForChurch(activeChurchId)');
    expect(checkoutSource).toContain('if (taxReceiptProfileBlocksCheckout) {');
    expect(checkoutSource).toContain('setTaxReceiptProfileMessage(');
    expect(checkoutSource).toContain('extra.taxReceiptProfileRequired');
    expect(checkoutSource).toContain("setGivingPhase('details');");
    expect(detailsSource).toContain('if (taxReceiptProfileBlocksCheckout) {');
    expect(detailsSource).toContain('aria-disabled={checkoutPrerequisiteBlocked}');
    expect(detailsSource).toContain('{checkoutPrerequisiteActionLabel || t.continuePayment}');
    expect(paymentSource).toContain('{checkoutPrerequisiteBlocked && (');
    expect(paymentSource).toContain('{renderTaxReceiptProfilePrompt(true)}');
    expect(paymentSource).toContain('aria-disabled={checkoutPrerequisiteBlocked}');
    expect(paymentSource).toContain('{checkoutPrerequisiteActionLabel || extra.completeSecureCheckout}');
  });

  it('requires verified email before Stripe checkout and receipt self-service', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/components/GivingScreen.tsx'), 'utf8');
    const emailGateSource = source.slice(
      source.indexOf('const currentUserNeedsEmailVerification = Boolean('),
      source.indexOf('const donorReceiptDeliveryErrorMessage = (')
    );
    const checkoutSource = source.slice(
      source.indexOf('const handleCheckout = async () => {'),
      source.indexOf('const handleSendTaxReceipt = async')
    );
    const detailsSource = source.slice(
      source.indexOf("if (givingPhase === 'details')"),
      source.indexOf("if (givingPhase === 'payment')")
    );
    const receiptHistorySource = source.slice(
      source.indexOf('const renderReceiptHistory = () => ('),
      source.indexOf("if (givingPhase === 'details')")
    );

    expect(source).toContain("import { firebaseAuthErrorCode, sendAccountEmailVerification } from '../lib/auth';");
    expect(source).toContain('const currentUserNeedsEmailVerification = Boolean(');
    expect(source).toContain('currentUser.emailVerified !== true');
    expect(source).toContain('const [emailVerificationChecking, setEmailVerificationChecking] = useState(false);');
    expect(source).toContain('const [emailVerificationRefreshKey, setEmailVerificationRefreshKey] = useState(0);');
    expect(source).toContain('const handleSendEmailVerification = async () => {');
    expect(source).toContain('await sendAccountEmailVerification(currentUser);');
    expect(source).toContain("firebaseAuthErrorCode(error) === 'auth/too-many-requests'");
    expect(source).toContain('const handleCheckEmailVerification = async () => {');
    expect(source).toContain('await currentUser.reload();');
    expect(source).toContain('setEmailVerificationRefreshKey((current) => current + 1);');
    expect(emailGateSource).toContain('const blockUntilEmailVerified = (setPrimaryMessage: (message: string) => void): boolean => {');
    expect(checkoutSource).toContain('if (blockUntilEmailVerified(setCheckoutMessage)) {');
    expect(checkoutSource).toContain("setGivingPhase('details');");
    expect(source).toContain('if (blockUntilEmailVerified(setReceiptMessage)) {');
    expect(source).toContain('if (!currentUser || currentUser.isAnonymous || currentUser.emailVerified !== true) {');
    expect(source).toContain('}, [currentUser, emailVerificationRefreshKey]);');
    expect(source).toContain('&& currentUser.emailVerified === true;');
    expect(detailsSource).toContain('{renderEmailVerificationPrompt()}');
    expect(detailsSource).toContain('aria-disabled={checkoutPrerequisiteBlocked}');
    expect(source).toContain('const checkoutPrerequisiteActionLabel = currentUserNeedsEmailVerification');
    expect(source).toContain('? extra.emailVerificationContinueAction');
    expect(source).toContain('extra.emailVerificationRequiredAction');
    expect(source).toContain('extra.emailVerificationStillPending');
    expect(source).toContain('extra.emailVerificationCheckAction');
    expect(receiptHistorySource).toContain("{renderEmailVerificationPrompt('mb-4')}");
  });

  it('keeps existing receipt resends available while blocking new issuance until receipt details are saved', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/components/GivingScreen.tsx'), 'utf8');
    const receiptHistorySource = source.slice(
      source.indexOf('const renderReceiptHistory = () => ('),
      source.indexOf('if (givingPhase === \'details\')')
    );

    expect(source).toContain('const taxReceiptProfileBlocksReceiptIssuance = Boolean(');
    expect(source).toContain('const taxReceiptProfileBlocksCheckout = taxReceiptProfileBlocksReceiptIssuance;');
    expect(source).toContain('const taxReceiptProfileRequiredMessage =');
    expect(source).toContain('requiresReceiptProfile = false');
    expect(source).toContain('if (requiresReceiptProfile && taxReceiptProfileBlocksReceiptIssuanceForChurch(receiptChurchId)) {');
    expect(source).toContain('if (requiresReceiptProfile && taxReceiptProfileBlocksReceiptIssuanceForChurch(churchId)) {');
    expect(receiptHistorySource).toContain('hasExistingSendableReceipt');
    expect(receiptHistorySource).toContain('canSendReceipt && !hasExistingSendableReceipt');
    expect(receiptHistorySource).toContain('canSendCorrectedReceipt && taxReceiptProfileBlocksReceiptIssuanceForChurch(receipt.churchId)');
    expect(receiptHistorySource).toContain('annualSendRequiresProfile');
    expect(receiptHistorySource).toContain('annualSendBlockedByProfile');
    expect(receiptHistorySource).toContain('!annualReceiptSettled');
    expect(receiptHistorySource).toContain('!annualReceiptDeliveryFailureRetryable');
    expect(receiptHistorySource).toContain('annualProfileAwareSendButtonLabel');
  });

  it('labels donor repeat receipt delivery as resend actions only after prior email delivery', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/components/GivingScreen.tsx'), 'utf8');
    const localizationSource = readFileSync(resolve(process.cwd(), 'src/localization/extra.ts'), 'utf8');
    const receiptHistorySource = source.slice(
      source.indexOf('const renderReceiptHistory = () => ('),
      source.indexOf('if (givingPhase === \'details\')')
    );

    expect(localizationSource).toContain('resendTaxReceipt: string;');
    expect(localizationSource).toContain('resendCorrectedTaxReceipt: string;');
    expect(localizationSource).toContain('resendAnnualTaxReceipt: string;');
    expect(localizationSource).toContain('resendCorrectedAnnualTaxReceipt: string;');
    expect(localizationSource).toContain("resendTaxReceipt: 'Resend tax receipt'");
    expect(localizationSource).toContain("resendCorrectedTaxReceipt: 'Resend corrected tax receipt'");
    expect(localizationSource).toContain("resendAnnualTaxReceipt: 'Resend annual tax receipt'");
    expect(localizationSource).toContain("resendCorrectedAnnualTaxReceipt: 'Resend corrected annual tax receipt'");
    expect(source).toContain('const taxReceiptIsCorrected = (receipt: FirestoreTaxReceiptRecord | undefined): boolean => Boolean(');
    expect(source).toContain('receipt.correctionForReceiptId');
    expect(source).toContain('receipt.correctionSourceReason');
    expect(source).toContain('receipt.correctedAt');
    expect(receiptHistorySource).toContain('const receiptPreviouslyEmailed =');
    expect(receiptHistorySource).toContain("record.taxReceiptStatus === 'sent'");
    expect(receiptHistorySource).toContain("matchedTaxReceipt?.status === 'sent'");
    expect(receiptHistorySource).toContain('Boolean(matchedTaxReceipt?.emailSentAt)');
    expect(receiptHistorySource).toContain('const correctedReceiptAvailable =');
    expect(receiptHistorySource).toContain('taxReceiptIsCorrected(matchedTaxReceipt)');
    expect(receiptHistorySource).toContain('? extra.resendTaxReceipt');
    expect(receiptHistorySource).toContain('? extra.resendCorrectedTaxReceipt');
    expect(receiptHistorySource).toContain('const standaloneReceiptPreviouslyEmailed =');
    expect(receiptHistorySource).toContain("receipt.status === 'sent'");
    expect(receiptHistorySource).toContain('Boolean(receipt.emailSentAt)');
    expect(receiptHistorySource).toContain('const standaloneCorrectedReceiptAvailable =');
    expect(receiptHistorySource).toContain('taxReceiptIsCorrected(receipt)');
    expect(receiptHistorySource).toContain('const annualReceiptPreviouslyEmailed =');
    expect(receiptHistorySource).toContain("annualReceipt?.status === 'sent'");
    expect(receiptHistorySource).toContain("annualSummary?.status === 'sent'");
    expect(receiptHistorySource).toContain('Boolean(annualReceipt?.emailSentAt || annualSummary?.emailSentAt)');
    expect(receiptHistorySource).toContain('const correctedAnnualReceiptAvailable =');
    expect(receiptHistorySource).toContain('taxReceiptIsCorrected(annualReceipt)');
    expect(receiptHistorySource).toContain('annualSummary?.correctedReceipt === true');
    expect(receiptHistorySource).toContain('? extra.resendAnnualTaxReceipt');
    expect(receiptHistorySource).toContain('? extra.resendCorrectedAnnualTaxReceipt');
  });
});
