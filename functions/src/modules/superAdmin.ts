import { AggregateField, FieldValue } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { logAuditEvent } from '../shared/audit';
import {
  STRIPE_API_VERSION,
  getResend,
  getStripe,
  resendApiKeyLooksValid,
  stripeSecretKeyMode,
  stripeWebhookSecretLooksValid,
} from '../shared/clients';
import { isFunctionsEmulatorTestMode } from '../shared/emulatorTest';
import { auth, db } from '../shared/firebase';
import { configuredStripeReturnAppUrl, stripeReturnAppUrlReadiness } from '../shared/appUrl';
import {
  appCheckCallableOptions,
  assertActiveChurchRole,
  assertFreshAppCheck,
  assertSuperAdmin,
  assertVerifiedNonAnonymousUser,
  checkRateLimit,
  replayProtectedCallableOptions,
} from '../shared/security';
import {
  CHURCH_PAYMENT_SETTINGS_COLLECTION,
  type ChurchPaymentSettings,
  churchPaymentSettingsWritePayload,
  loadChurchPaymentSettings,
  paymentSettingsAuditSummary,
  sanitizeChurchPaymentSettings,
  stripeConnectAccountIdLooksValid,
} from '../shared/paymentSettings';
import { publicTaxReceiptAuditCode } from '../shared/taxReceiptAudit';
import { retainedTaxReceiptPdfObjectMetadataReady } from '../shared/taxReceiptRetention';
import {
  assertBoolean,
  assertEmail,
  assertHttpsUrl,
  assertMaxLength,
  assertNonEmptyString,
  callableDataRecord,
} from '../shared/validation';

function optionalString(value: unknown, max: number, field: string): string {
  if (value === undefined || value === null || value === '') {
    return '';
  }
  if (typeof value !== 'string') {
    throw new HttpsError('invalid-argument', `${field} must be a string.`);
  }
  const trimmed = value.trim();
  assertMaxLength(trimmed, max, field);
  return trimmed;
}

function configuredAppUrl(): string {
  return configuredStripeReturnAppUrl(
    process.env.APP_URL,
    'https://app.kandilo.org',
    'Stripe Connect onboarding'
  );
}

const STRIPE_CONNECT_RETURN_STATE_PATTERN = /^[A-Za-z0-9_-]{32}$/;
const DEFAULT_TAX_GOODS_SERVICES_STATEMENT =
  'No goods or services were provided in exchange for this contribution other than intangible religious benefits.';
const CANADA_CRA_ELECTRONIC_RECEIPT_BLOCKER =
  'Canada/CRA tax receipts cannot be enabled until Kandilo supports read-only/non-editable PDF receipts that are protected from unauthorized access, encrypted, electronically signed under authorized parish control, retained, and printable on request.';

function assertStripeConnectReturnState(value: unknown): string {
  const returnState = assertNonEmptyString(value, 32, 'returnState');
  if (!STRIPE_CONNECT_RETURN_STATE_PATTERN.test(returnState)) {
    throw new HttpsError('invalid-argument', 'returnState is invalid.');
  }
  return returnState;
}

function stripeConnectOnboardingReturnUrl(
  churchId: string,
  status: 'return' | 'refresh',
  returnState: string
): string {
  const url = new URL(configuredAppUrl());
  url.searchParams.set('stripeConnect', status);
  url.searchParams.set('churchId', churchId);
  url.searchParams.set('state', returnState);
  return url.toString();
}

function stripeAccountLinkExpiresAtMillis(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value * 1000;
  }
  if (typeof value === 'string') {
    const millis = Date.parse(value);
    return Number.isFinite(millis) ? millis : null;
  }
  return null;
}

function stripeRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function stripeV2RequirementStatusBlocksRouting(value: unknown): boolean {
  return value === 'currently_due' || value === 'past_due';
}

function stripeV2AccountHasBlockingRequirements(account: unknown): boolean {
  const requirements = stripeRecord(stripeRecord(account).requirements);
  const summary = stripeRecord(requirements.summary);
  const minimumDeadline = stripeRecord(summary.minimum_deadline);
  if (stripeV2RequirementStatusBlocksRouting(minimumDeadline.status)) {
    return true;
  }

  const entries = Array.isArray(requirements.entries) ? requirements.entries : [];
  return entries.some((entry) => {
    const entryRecord = stripeRecord(entry);
    const entryDeadline = stripeRecord(entryRecord.minimum_deadline);
    if (stripeV2RequirementStatusBlocksRouting(entryDeadline.status)) {
      return true;
    }
    const impact = stripeRecord(entryRecord.impact);
    const restrictedCapabilities = Array.isArray(impact.restricts_capabilities)
      ? impact.restricts_capabilities
      : [];
    return restrictedCapabilities.some((capability) => {
      const deadline = stripeRecord(stripeRecord(capability).deadline);
      return stripeV2RequirementStatusBlocksRouting(deadline.status);
    });
  });
}

function stripeV2RecipientCapabilityStatus(account: unknown, capability: 'stripe_transfers' | 'payouts'): string {
  const configuration = stripeRecord(stripeRecord(account).configuration);
  const recipient = stripeRecord(configuration.recipient);
  const capabilities = stripeRecord(recipient.capabilities);
  const stripeBalance = stripeRecord(capabilities.stripe_balance);
  const capabilityRecord = stripeRecord(stripeBalance[capability]);
  return typeof capabilityRecord.status === 'string' ? capabilityRecord.status : '';
}

function stripeV1AccountReadyForRouting(account: unknown, accountId: string): boolean {
  const record = stripeRecord(account);
  const requirements = stripeRecord(record.requirements);
  const hasOpenRequirements =
    (Array.isArray(requirements.currently_due) && requirements.currently_due.length > 0)
    || (Array.isArray(requirements.past_due) && requirements.past_due.length > 0)
    || Boolean(requirements.disabled_reason);

  return record.deleted !== true
    && record.id === accountId
    && record.charges_enabled === true
    && record.payouts_enabled === true
    && record.details_submitted === true
    && !hasOpenRequirements;
}

function stripeV2AccountReadyForRouting(account: unknown, accountId: string): boolean {
  const record = stripeRecord(account);
  const transferStatus = stripeV2RecipientCapabilityStatus(account, 'stripe_transfers');
  const payoutStatus = stripeV2RecipientCapabilityStatus(account, 'payouts');
  return record.closed !== true
    && record.id === accountId
    && Array.isArray(record.applied_configurations)
    && record.applied_configurations.includes('recipient')
    && transferStatus === 'active'
    && (!payoutStatus || payoutStatus === 'active')
    && !stripeV2AccountHasBlockingRequirements(account);
}

async function assertStripeConnectAccountReadyForRouting(
  settings: ChurchPaymentSettings,
  churchId: string
): Promise<void> {
  let stripe: ReturnType<typeof getStripe>;
  try {
    stripe = getStripe();
  } catch (error) {
    console.error('Stripe Connect account verification unavailable:', {
      churchId,
      errorName: error instanceof Error ? error.name : typeof error,
    });
    throw new HttpsError(
      'failed-precondition',
      'Stripe is not configured for connected account verification.'
    );
  }

  let account: unknown;
  try {
    account = settings.stripeConnectAccountApi === 'v2'
      ? await stripe.v2.core.accounts.retrieve(settings.stripeConnectAccountId, {
        include: ['configuration.recipient', 'requirements'],
      })
      : await stripe.accounts.retrieve(settings.stripeConnectAccountId);
  } catch (error) {
    console.error('Stripe Connect account verification failed:', {
      churchId,
      stripeConnectAccountApi: settings.stripeConnectAccountApi,
      errorName: error instanceof Error ? error.name : typeof error,
      errorCode:
        typeof (error as { code?: unknown }).code === 'string'
          ? (error as { code: string }).code
          : undefined,
    });
    throw new HttpsError(
      'failed-precondition',
      'Stripe could not verify this connected account. Confirm the account ID, key mode, onboarding status, and restricted-key permissions before enabling parish routing.'
    );
  }

  const ready = settings.stripeConnectAccountApi === 'v2'
    ? stripeV2AccountReadyForRouting(account, settings.stripeConnectAccountId)
    : stripeV1AccountReadyForRouting(account, settings.stripeConnectAccountId);
  if (!ready) {
    throw new HttpsError(
      'failed-precondition',
      'This Stripe connected account is not ready for parish donation routing.'
    );
  }
}

function stripeConnectAccountDisplayName(church: FirebaseFirestore.DocumentData, churchId: string): string {
  const name = typeof church.name === 'string' ? church.name.trim() : '';
  return (name || churchId).slice(0, 200);
}

type StripeConnectAccountCountry = 'US' | 'CA';

function stripeConnectAccountCountry(church: FirebaseFirestore.DocumentData): StripeConnectAccountCountry {
  const country = typeof church.country === 'string' ? church.country.trim().toUpperCase() : '';
  if (country !== 'US' && country !== 'CA') {
    throw new HttpsError(
      'failed-precondition',
      'In-app Stripe connected account creation currently supports U.S. and Canadian parishes only.'
    );
  }
  return country;
}

function stripeConnectAccountDefaultsForCountry(country: StripeConnectAccountCountry): {
  currency: 'usd' | 'cad';
  locales: string[];
} {
  return country === 'CA'
    ? { currency: 'cad', locales: ['en-CA'] }
    : { currency: 'usd', locales: ['en-US'] };
}

function stripeConnectAccountEmail(church: FirebaseFirestore.DocumentData): string | undefined {
  const email = typeof church.contactEmail === 'string' ? church.contactEmail.trim() : '';
  if (!email) {
    return undefined;
  }
  return assertEmail(email, 'contactEmail');
}

function stripeConnectAccountRequiredEmail(church: FirebaseFirestore.DocumentData): string {
  const email = stripeConnectAccountEmail(church);
  if (!email) {
    throw new HttpsError(
      'failed-precondition',
      'In-app Stripe connected account creation requires a church contact email.'
    );
  }
  return email;
}

function stripeConnectAccountWebsite(church: FirebaseFirestore.DocumentData): string | undefined {
  const website = typeof church.website === 'string' ? church.website.trim() : '';
  return website.startsWith('https://') ? website : undefined;
}

function optionalFiniteNumber(value: unknown, field: string): number {
  if (value === undefined || value === null || value === '') {
    return 0;
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new HttpsError('invalid-argument', `${field} must be a finite number.`);
  }
  return value;
}

function optionalBoolean(value: unknown, field: string): boolean {
  if (value === undefined || value === null || value === '') {
    return false;
  }
  return assertBoolean(value, field);
}

function optionalLanguageList(value: unknown): string[] {
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value) || value.length > 20) {
    throw new HttpsError('invalid-argument', 'languages must contain at most 20 entries.');
  }
  return value
    .map((lang) => optionalString(lang, 50, 'languages entry'))
    .filter(Boolean);
}

function optionalHttpsUrl(value: unknown, max: number, field: string): string {
  const url = optionalString(value, max, field);
  return url ? assertHttpsUrl(url, field) : '';
}

function assertPlainObject(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new HttpsError('invalid-argument', `${field} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function validateFoundedYear(value: number): void {
  if (value !== 0 && (!Number.isInteger(value) || value < 1 || value > 3000)) {
    throw new HttpsError('invalid-argument', 'foundedYear must be a valid year.');
  }
}

function validateLatitude(value: number): void {
  if (value !== 0 && (value < -90 || value > 90)) {
    throw new HttpsError('invalid-argument', 'latitude must be between -90 and 90.');
  }
}

function validateLongitude(value: number): void {
  if (value !== 0 && (value < -180 || value > 180)) {
    throw new HttpsError('invalid-argument', 'longitude must be between -180 and 180.');
  }
}

function isAlreadyExistsError(error: unknown): boolean {
  const code = (error as { code?: unknown }).code;
  return code === 6 || code === 'already-exists' || code === 'ALREADY_EXISTS';
}

function optionalClergyList(value: unknown): FirebaseFirestore.DocumentData[] {
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value) || value.length > 20) {
    throw new HttpsError('invalid-argument', 'clergy must contain at most 20 entries.');
  }
  return value.map((entry, index) => {
    const field = `clergy[${index}]`;
    const record = assertPlainObject(entry, field);
    const email = optionalString(record.email, 254, `${field}.email`);
    return {
      name: optionalString(record.name, 120, `${field}.name`),
      title: optionalString(record.title, 120, `${field}.title`),
      photoURL: optionalHttpsUrl(record.photoURL, 2000, `${field}.photoURL`),
      email: email ? assertEmail(email, `${field}.email`) : '',
      bio: optionalString(record.bio, 1000, `${field}.bio`),
      isPrimary: optionalBoolean(record.isPrimary, `${field}.isPrimary`),
    };
  });
}

function optionalServiceSchedule(value: unknown): FirebaseFirestore.DocumentData[] {
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value) || value.length > 30) {
    throw new HttpsError('invalid-argument', 'serviceSchedule must contain at most 30 entries.');
  }
  return value.map((entry, index) => {
    const field = `serviceSchedule[${index}]`;
    const record = assertPlainObject(entry, field);
    return {
      day: optionalString(record.day, 80, `${field}.day`),
      name: optionalString(record.name, 120, `${field}.name`),
      time: optionalString(record.time, 80, `${field}.time`),
      notes: optionalString(record.notes, 500, `${field}.notes`),
    };
  });
}

function optionalSocialMedia(value: unknown): FirebaseFirestore.DocumentData {
  if (value === undefined || value === null) {
    return { instagram: '', facebook: '', youtube: '' };
  }
  const record = assertPlainObject(value, 'socialMedia');
  return {
    instagram: optionalString(record.instagram, 2000, 'socialMedia.instagram'),
    facebook: optionalString(record.facebook, 2000, 'socialMedia.facebook'),
    youtube: optionalString(record.youtube, 2000, 'socialMedia.youtube'),
  };
}

function optionalTaxReceiptSettings(value: unknown): FirebaseFirestore.DocumentData {
  if (value === undefined || value === null) {
    return {
      enabled: false,
      jurisdiction: 'US',
      eligibilityConfirmed: false,
      organizationName: '',
      organizationAddress: '',
      taxId: '',
      receiptPrefix: '',
      goodsServicesStatement: '',
      autoIssue: true,
      annualPreparationEnabled: false,
      annualAutoEmailEnabled: false,
      receiptIssueLocation: '',
      authorizedSignerName: '',
      authorizedSignerTitle: '',
      secureElectronicSignatureConfigured: false,
      receiptCopiesRetentionConfirmed: false,
    };
  }

  const record = assertPlainObject(value, 'taxReceiptSettings');
  const jurisdiction = optionalString(record.jurisdiction, 10, 'taxReceiptSettings.jurisdiction') || 'US';
  if (jurisdiction !== 'US' && jurisdiction !== 'CA') {
    throw new HttpsError('invalid-argument', 'taxReceiptSettings.jurisdiction must be US or CA.');
  }
  const enabled = optionalBoolean(record.enabled, 'taxReceiptSettings.enabled');
  const annualPreparationRequested =
    record.annualPreparationEnabled === undefined || record.annualPreparationEnabled === null
      ? false
      : assertBoolean(record.annualPreparationEnabled, 'taxReceiptSettings.annualPreparationEnabled');
  const annualAutoEmailRequested =
    record.annualAutoEmailEnabled === undefined || record.annualAutoEmailEnabled === null
      ? false
      : assertBoolean(record.annualAutoEmailEnabled, 'taxReceiptSettings.annualAutoEmailEnabled');

  const settings = {
    enabled,
    jurisdiction,
    eligibilityConfirmed:
      record.eligibilityConfirmed === undefined || record.eligibilityConfirmed === null
        ? false
        : assertBoolean(record.eligibilityConfirmed, 'taxReceiptSettings.eligibilityConfirmed'),
    organizationName: optionalString(record.organizationName, 200, 'taxReceiptSettings.organizationName'),
    organizationAddress: optionalString(record.organizationAddress, 500, 'taxReceiptSettings.organizationAddress'),
    taxId: optionalString(record.taxId, 80, 'taxReceiptSettings.taxId'),
    receiptPrefix: optionalString(record.receiptPrefix, 40, 'taxReceiptSettings.receiptPrefix'),
    goodsServicesStatement: optionalString(record.goodsServicesStatement, 500, 'taxReceiptSettings.goodsServicesStatement'),
    autoIssue:
      record.autoIssue === undefined || record.autoIssue === null
        ? true
        : assertBoolean(record.autoIssue, 'taxReceiptSettings.autoIssue'),
    annualPreparationEnabled: enabled && jurisdiction === 'US' && annualPreparationRequested,
    annualAutoEmailEnabled:
      enabled && jurisdiction === 'US' && annualPreparationRequested && annualAutoEmailRequested,
    receiptIssueLocation: optionalString(record.receiptIssueLocation, 120, 'taxReceiptSettings.receiptIssueLocation'),
    authorizedSignerName: optionalString(record.authorizedSignerName, 160, 'taxReceiptSettings.authorizedSignerName'),
    authorizedSignerTitle: optionalString(record.authorizedSignerTitle, 120, 'taxReceiptSettings.authorizedSignerTitle'),
    secureElectronicSignatureConfigured:
      record.secureElectronicSignatureConfigured === undefined
        || record.secureElectronicSignatureConfigured === null
        ? false
        : assertBoolean(
          record.secureElectronicSignatureConfigured,
          'taxReceiptSettings.secureElectronicSignatureConfigured'
        ),
    receiptCopiesRetentionConfirmed:
      record.receiptCopiesRetentionConfirmed === undefined || record.receiptCopiesRetentionConfirmed === null
        ? false
        : assertBoolean(record.receiptCopiesRetentionConfirmed, 'taxReceiptSettings.receiptCopiesRetentionConfirmed'),
  };
  if (settings.enabled && settings.jurisdiction === 'US' && !settings.goodsServicesStatement) {
    settings.goodsServicesStatement = DEFAULT_TAX_GOODS_SERVICES_STATEMENT;
  }

  if (settings.enabled && (!settings.organizationName || !settings.organizationAddress || !settings.taxId)) {
    throw new HttpsError(
      'invalid-argument',
      'Enabled tax receipts require a legal organization name, receipt address, and tax ID.'
    );
  }
  if (settings.enabled && settings.jurisdiction === 'US' && !settings.eligibilityConfirmed) {
    throw new HttpsError(
      'invalid-argument',
      'Enabled U.S. tax receipts require confirmation that the parish is eligible to issue charitable contribution acknowledgments and that receipt details are accurate.'
    );
  }
  if (settings.enabled && settings.jurisdiction === 'CA') {
    throw new HttpsError(
      'invalid-argument',
      CANADA_CRA_ELECTRONIC_RECEIPT_BLOCKER
    );
  }

  return settings;
}

function taxReceiptSettingsAuditSummary(value: unknown): Record<string, unknown> {
  const settings =
    typeof value === 'object' && value !== null && !Array.isArray(value)
      ? value as Record<string, unknown>
      : {};

  return {
    enabled: settings.enabled === true,
    jurisdiction: typeof settings.jurisdiction === 'string' ? settings.jurisdiction : '',
    eligibilityConfirmed: settings.eligibilityConfirmed === true,
    autoIssue: settings.autoIssue !== false,
    annualPreparationEnabled: settings.annualPreparationEnabled === true,
    annualAutoEmailEnabled:
      settings.annualPreparationEnabled === true
      && settings.annualAutoEmailEnabled === true,
    organizationNameConfigured:
      typeof settings.organizationName === 'string' && settings.organizationName.trim().length > 0,
    organizationAddressConfigured:
      typeof settings.organizationAddress === 'string' && settings.organizationAddress.trim().length > 0,
    taxIdConfigured: typeof settings.taxId === 'string' && settings.taxId.trim().length > 0,
    receiptPrefix:
      typeof settings.receiptPrefix === 'string' ? settings.receiptPrefix.trim().slice(0, 40) : '',
    goodsServicesStatementConfigured:
      typeof settings.goodsServicesStatement === 'string' && settings.goodsServicesStatement.trim().length > 0,
    receiptIssueLocationConfigured:
      typeof settings.receiptIssueLocation === 'string' && settings.receiptIssueLocation.trim().length > 0,
    authorizedSignerConfigured:
      typeof settings.authorizedSignerName === 'string' && settings.authorizedSignerName.trim().length > 0,
    authorizedSignerTitleConfigured:
      typeof settings.authorizedSignerTitle === 'string' && settings.authorizedSignerTitle.trim().length > 0,
    secureElectronicSignatureConfigured: settings.secureElectronicSignatureConfigured === true,
    receiptCopiesRetentionConfirmed: settings.receiptCopiesRetentionConfirmed === true,
  };
}

function getChurchLocation(church: FirebaseFirestore.DocumentData): string {
  return (
    [church.city, church.state].filter((value) => typeof value === 'string' && value).join(', ') ||
    church.location ||
    ''
  );
}

function buildChurchMembershipFanoutPatch(
  church: FirebaseFirestore.DocumentData,
  includedFields: Set<string>
): FirebaseFirestore.DocumentData {
  const patch: FirebaseFirestore.DocumentData = {};

  if (includedFields.has('name')) {
    patch.churchName = church.name ?? '';
  }
  if (includedFields.has('city') || includedFields.has('state') || includedFields.has('location')) {
    patch.location = getChurchLocation(church);
  }
  if (includedFields.has('imageURL')) {
    patch.imageURL = church.imageURL ?? '';
  }
  if (includedFields.has('isActive')) {
    patch.churchActive = church.isActive === true;
  }

  return patch;
}

async function updateChurchMembershipFanout(
  churchId: string,
  patch: FirebaseFirestore.DocumentData
): Promise<void> {
  if (Object.keys(patch).length === 0) {
    return;
  }

  const membersSnap = await db.collection('churches').doc(churchId).collection('members').get();
  let batch = db.batch();
  let pendingWrites = 0;

  const commitPending = async () => {
    if (pendingWrites === 0) {
      return;
    }
    await batch.commit();
    batch = db.batch();
    pendingWrites = 0;
  };

  for (const memberDoc of membersSnap.docs) {
    batch.set(
      db.collection('users').doc(memberDoc.id).collection('churchMemberships').doc(churchId),
      {
        ...patch,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    pendingWrites++;

    if (pendingWrites === 450) {
      await commitPending();
    }
  }

  await commitPending();
}

async function getQueryCount(query: FirebaseFirestore.Query): Promise<number> {
  const snap = await query.count().get();
  return snap.data().count;
}

async function getQuerySum(query: FirebaseFirestore.Query, field: string): Promise<number> {
  const snap = await query.aggregate({ total: AggregateField.sum(field) }).get();
  const value = snap.data().total;
  return Number.isFinite(value) ? value : 0;
}

function millisFromTimestamp(value: unknown): number | null {
  if (
    typeof value === 'object'
    && value !== null
    && typeof (value as { toMillis?: unknown }).toMillis === 'function'
  ) {
    return (value as { toMillis: () => number }).toMillis();
  }
  return null;
}

const PAYMENT_OPERATIONS_SMOKE_FRESHNESS_HOURS = 72;
const PAYMENT_OPERATIONS_SMOKE_FRESHNESS_MS = PAYMENT_OPERATIONS_SMOKE_FRESHNESS_HOURS * 60 * 60 * 1000;
const PAYMENT_OPERATIONS_SMOKE_FUTURE_SKEW_MS = 5 * 60 * 1000;
const RECEIPT_MANAGER_GIVING_SAFE_VERSION = 1;
const RECEIPT_MANAGER_SUMMARY_SAFE_VERSION = 2;
const ANNUAL_SMOKE_MIN_DONATION_COUNT = 2;
const PUBLIC_TAX_RECEIPT_NUMBER_FALLBACK = 'unassigned';
const GIVING_PRIVATE_PAYMENT_FIELDS = [
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
const TAX_RECEIPT_SUMMARY_PRIVATE_FIELDS = [
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

function timestampIsFresh(millis: number | null, nowMillis: number): boolean {
  if (typeof millis !== 'number' || !Number.isFinite(millis)) {
    return false;
  }
  return millis <= nowMillis + PAYMENT_OPERATIONS_SMOKE_FUTURE_SKEW_MS
    && nowMillis - millis <= PAYMENT_OPERATIONS_SMOKE_FRESHNESS_MS;
}

function trimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizedCurrency(value: unknown): string {
  const currency = trimmedString(value).toUpperCase();
  return /^[A-Z]{3}$/.test(currency) ? currency : '';
}

function officialReceiptNumberLooksAssigned(value: unknown): boolean {
  const receiptNumber = trimmedString(value);
  return receiptNumber.length > 0 && receiptNumber.toLowerCase() !== PUBLIC_TAX_RECEIPT_NUMBER_FALLBACK;
}

function receiptYearNumber(value: unknown): number | null {
  return Number.isInteger(value) && Number(value) >= 2000 && Number(value) <= 2100 ? Number(value) : null;
}

function hasPositiveInteger(value: unknown): boolean {
  return Number.isInteger(value) && Number(value) > 0;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasNoStringError(value: unknown): boolean {
  return !(typeof value === 'string' && value.trim().length > 0);
}

function hasNoTimestampEvidence(value: unknown): boolean {
  return value === undefined || value === null || value === '';
}

function hasRetainedPdfStoragePath(value: unknown): boolean {
  const path = trimmedString(value);
  return path.startsWith('taxReceipts/') && path.endsWith('.pdf');
}

function hasSha256Evidence(value: unknown): boolean {
  return /^[a-f0-9]{64}$/i.test(trimmedString(value));
}

function safeDocumentId(value: string): string {
  return /^[A-Za-z0-9_-]{1,180}$/.test(value) ? value : '';
}

function looksLikeEmail(value: string): boolean {
  return /[^\s@]+@[^\s@]+\.[^\s@]{2,}/i.test(value);
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
}

function annualGivingCoverageReady(givingIds: string[], donationCount: unknown): boolean {
  const uniqueGivingIds = new Set(givingIds);
  return Number.isInteger(donationCount)
    && Number(donationCount) >= ANNUAL_SMOKE_MIN_DONATION_COUNT
    && givingIds.length === Number(donationCount)
    && uniqueGivingIds.size === givingIds.length
    && givingIds.every((givingId) => Boolean(safeDocumentId(givingId)));
}

function annualContributionDetailReady(receipt: FirebaseFirestore.DocumentData): boolean {
  const contributions = Array.isArray(receipt.contributions) ? receipt.contributions : [];
  const currency = normalizedCurrency(receipt.currency);
  const donationCount = receipt.donationCount;
  const amountCents = receipt.amountCents;
  const eligibleAmountCents = receipt.eligibleAmountCents;

  if (
    !currency
    || !Number.isInteger(donationCount)
    || Number(donationCount) < ANNUAL_SMOKE_MIN_DONATION_COUNT
    || contributions.length !== Number(donationCount)
    || !hasPositiveInteger(amountCents)
    || !hasPositiveInteger(eligibleAmountCents)
  ) {
    return false;
  }

  let amountTotalCents = 0;
  let eligibleTotalCents = 0;
  for (const contribution of contributions) {
    if (!isPlainRecord(contribution)) return false;
    const contributionAmountCents = contribution.amountCents;
    const contributionEligibleAmountCents = contribution.eligibleAmountCents;
    if (
      !trimmedString(contribution.dateLabel)
      || !trimmedString(contribution.purpose)
      || !hasPositiveInteger(contributionAmountCents)
      || !hasPositiveInteger(contributionEligibleAmountCents)
      || Number(contributionEligibleAmountCents) > Number(contributionAmountCents)
      || normalizedCurrency(contribution.currency) !== currency
    ) {
      return false;
    }
    amountTotalCents += Number(contributionAmountCents);
    eligibleTotalCents += Number(contributionEligibleAmountCents);
  }

  return amountTotalCents === Number(amountCents) && eligibleTotalCents === Number(eligibleAmountCents);
}

function annualReceiptHasCorrectionOrReissueEvidence(
  receiptId: string,
  receipt: FirebaseFirestore.DocumentData,
  summary: FirebaseFirestore.DocumentData | null
): boolean {
  return receiptId.startsWith('annual_correction_')
    || trimmedString(receipt.correctionForReceiptId).length > 0
    || trimmedString(receipt.correctionSourceReason).length > 0
    || !hasNoTimestampEvidence(receipt.correctedAt)
    || summary?.correctedReceipt === true;
}

function givingOmitsPrivatePaymentFields(giving: FirebaseFirestore.DocumentData): boolean {
  return GIVING_PRIVATE_PAYMENT_FIELDS.every((field) => !Object.prototype.hasOwnProperty.call(giving, field));
}

function taxReceiptSummaryOmitsPrivateFields(summary: FirebaseFirestore.DocumentData): boolean {
  return TAX_RECEIPT_SUMMARY_PRIVATE_FIELDS.every(
    (field) => !Object.prototype.hasOwnProperty.call(summary, field)
  );
}

function configuredSecret(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function configuredStripeSecretKey(value: unknown): string {
  const configured = configuredSecret(value);
  if (
    isFunctionsEmulatorTestMode()
    && (!configured || stripeSecretKeyMode(configured) === 'unknown')
  ) {
    return 'sk_test_kandilo_emulator';
  }
  return configured;
}

function configuredStripeWebhookSecret(value: unknown): string {
  const configured = configuredSecret(value);
  if (
    isFunctionsEmulatorTestMode()
    && (!configured || !stripeWebhookSecretLooksValid(configured))
  ) {
    return 'whsec_kandilo_emulator_test';
  }
  return configured;
}

function configuredResendApiKey(value: unknown): string {
  const configured = configuredSecret(value);
  if (
    isFunctionsEmulatorTestMode()
    && (!configured || !resendApiKeyLooksValid(configured))
  ) {
    return 're_kandilo_emulator_test';
  }
  return configured;
}

function publicTaxReceiptAuditReceiptId(data: FirebaseFirestore.DocumentData): string {
  const receiptId = typeof data.receiptId === 'string' ? data.receiptId : '';
  if (!receiptId) {
    return '';
  }
  const kind = typeof data.kind === 'string' ? data.kind : '';
  const givingId = typeof data.givingId === 'string' ? data.givingId : '';
  if (kind === 'single' || (givingId && receiptId === givingId)) {
    return 'single_receipt';
  }
  if (kind === 'annual') {
    return receiptId.startsWith('annual_correction_') ? 'annual_correction_receipt' : 'annual_receipt';
  }
  return 'receipt';
}

function functionsProjectId(): string {
  return configuredSecret(process.env.GCLOUD_PROJECT)
    || configuredSecret(process.env.GCP_PROJECT)
    || 'kandilo-2f7a9';
}

function expectedStripeWebhookUrl(): string {
  return `https://us-central1-${functionsProjectId()}.cloudfunctions.net/stripeWebhook`;
}

const REQUIRED_STRIPE_WEBHOOK_EVENTS = [
  'checkout.session.completed',
  'checkout.session.expired',
  'checkout.session.async_payment_failed',
  'charge.refunded',
];

function enabledWebhookEvents(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((eventName): eventName is string => typeof eventName === 'string' && eventName.length > 0)
    : [];
}

function emptyStripeWebhookEndpointReadiness(errorCode = ''): Record<string, unknown> {
  return {
    checked: false,
    ready: false,
    configured: false,
    liveMode: false,
    enabled: false,
    duplicateCount: 0,
    apiVersionMatches: false,
    requiredEventsConfigured: false,
    explicitEventsOnly: false,
    noUnexpectedEvents: false,
    missingEventCount: REQUIRED_STRIPE_WEBHOOK_EVENTS.length,
    unexpectedEventCount: 0,
    errorCode,
  };
}

async function stripeWebhookEndpointReadinessSummary(
  stripeSecretKey: string,
  stripeMode: ReturnType<typeof stripeSecretKeyMode>,
  expectedUrl: string
): Promise<Record<string, unknown>> {
  if (!stripeSecretKey || stripeMode === 'unknown' || stripeMode === 'not_configured') {
    return emptyStripeWebhookEndpointReadiness();
  }
  if (stripeMode !== 'live') {
    return emptyStripeWebhookEndpointReadiness();
  }

  try {
    const response = await getStripe().webhookEndpoints.list({ limit: 100 });
    const endpoints: Record<string, unknown>[] = Array.isArray(response.data)
      ? response.data.filter((endpoint: unknown): endpoint is Record<string, unknown> => (
        typeof endpoint === 'object' && endpoint !== null && !Array.isArray(endpoint)
      ))
      : [];
    const urlMatches = endpoints.filter((endpoint) => endpoint.url === expectedUrl);
    const liveMatches = urlMatches.filter((endpoint) => endpoint.livemode === true);
    const enabledLiveMatches = liveMatches.filter(
      (endpoint) => endpoint.status === 'enabled'
    );
    const endpoint = enabledLiveMatches[0] ?? liveMatches[0] ?? urlMatches[0] ?? null;
    const events = enabledWebhookEvents(endpoint?.enabled_events);
    const wildcard = events.includes('*');
    const missingEventCount = wildcard
      ? 0
      : REQUIRED_STRIPE_WEBHOOK_EVENTS.filter((eventName) => !events.includes(eventName)).length;
    const unexpectedEventCount = wildcard
      ? 0
      : events.filter((eventName) => !REQUIRED_STRIPE_WEBHOOK_EVENTS.includes(eventName)).length;
    const duplicateCount = Math.max(enabledLiveMatches.length - 1, 0);
    const configured = urlMatches.length > 0;
    const liveMode = liveMatches.length > 0;
    const enabled = enabledLiveMatches.length === 1;
    const apiVersionMatches = endpoint?.api_version === STRIPE_API_VERSION;
    const requiredEventsConfigured = missingEventCount === 0;
    const explicitEventsOnly = !wildcard && events.length > 0;
    const noUnexpectedEvents = unexpectedEventCount === 0;
    const ready =
      configured
      && liveMode
      && enabled
      && duplicateCount === 0
      && apiVersionMatches
      && requiredEventsConfigured
      && explicitEventsOnly
      && noUnexpectedEvents;

    return {
      checked: true,
      ready,
      configured,
      liveMode,
      enabled,
      duplicateCount,
      apiVersionMatches,
      requiredEventsConfigured,
      explicitEventsOnly,
      noUnexpectedEvents,
      missingEventCount,
      unexpectedEventCount,
      errorCode: '',
    };
  } catch (error) {
    console.error('Stripe webhook endpoint readiness check failed:', {
      errorName: error instanceof Error ? error.name : 'UnknownError',
    });
    return emptyStripeWebhookEndpointReadiness('stripe_webhook_endpoint_status_unavailable');
  }
}

async function stripeWebhookActivitySummary(nowMillis: number): Promise<Record<string, unknown>> {
  const [snap, liveSnap, checkoutSnap, liveCheckoutSnap, liveIssueSnap] = await Promise.all([
    db
      .collection('stripeWebhookEvents')
      .orderBy('processedAt', 'desc')
      .limit(20)
      .get(),
    db
      .collection('stripeWebhookEvents')
      .where('livemode', '==', true)
      .orderBy('processedAt', 'desc')
      .limit(20)
      .get(),
    db
      .collection('stripeWebhookEvents')
      .where('type', '==', 'checkout.session.completed')
      .where('status', '==', 'processed')
      .orderBy('processedAt', 'desc')
      .limit(50)
      .get(),
    db
      .collection('stripeWebhookEvents')
      .where('type', '==', 'checkout.session.completed')
      .where('status', '==', 'processed')
      .where('livemode', '==', true)
      .orderBy('processedAt', 'desc')
      .limit(50)
      .get(),
    db
      .collection('stripeWebhookEvents')
      .where('status', 'in', ['validation_failed', 'missing_giving', 'unpaid_session'])
      .where('livemode', '==', true)
      .orderBy('processedAt', 'desc')
      .limit(50)
      .get(),
  ]);
  const docs = snap.docs.map((doc) => doc.data());
  const liveDocs = liveSnap.docs.map((doc) => doc.data());
  const processedCheckoutCompletedEvents = checkoutSnap.docs.map((doc) => doc.data());
  const liveProcessedCheckoutCompletedEvents = liveCheckoutSnap.docs.map((doc) => doc.data());
  const liveIssueEvents = liveIssueSnap.docs.map((doc) => doc.data());
  const latest = docs[0] ?? {};
  const latestLive = liveDocs[0] ?? {};
  const statuses = docs.map((event) => (typeof event.status === 'string' ? event.status : 'unknown'));
  const liveIssueStatuses = liveIssueEvents.map((event) => (
    typeof event.status === 'string' ? event.status : 'unknown'
  ));
  const liveProcessedCount = liveDocs.filter((event) => event.status === 'processed' && event.livemode === true).length;
  const testProcessedCount = docs.filter((event) => event.status === 'processed' && event.livemode === false).length;
  const liveProcessedCheckoutCompletedCount = liveProcessedCheckoutCompletedEvents.length;
  const testProcessedCheckoutCompletedCount = processedCheckoutCompletedEvents.filter(
    (event) => event.livemode === false
  ).length;
  const latestCheckoutCompletedAtMillis = millisFromTimestamp(processedCheckoutCompletedEvents[0]?.processedAt);
  const latestLiveCheckoutCompletedAtMillis = millisFromTimestamp(liveProcessedCheckoutCompletedEvents[0]?.processedAt);

  return {
    checkedEventCount: docs.length,
    checkedLiveEventCount: liveDocs.length,
    smokeFreshnessWindowHours: PAYMENT_OPERATIONS_SMOKE_FRESHNESS_HOURS,
    latestProcessedAtMillis: millisFromTimestamp(latest.processedAt),
    latestLiveProcessedAtMillis: millisFromTimestamp(latestLive.processedAt),
    latestCheckoutCompletedAtMillis,
    latestLiveCheckoutCompletedAtMillis,
    latestType: typeof latest.type === 'string' ? latest.type : '',
    latestStatus: typeof latest.status === 'string' ? latest.status : '',
    latestLivemode: typeof latest.livemode === 'boolean' ? latest.livemode : null,
    latestLiveType: typeof latestLive.type === 'string' ? latestLive.type : '',
    latestLiveStatus: typeof latestLive.status === 'string' ? latestLive.status : '',
    processedCount: statuses.filter((status) => status === 'processed').length,
    liveProcessedCount,
    testProcessedCount,
    processedCheckoutCompletedCount: processedCheckoutCompletedEvents.length,
    liveProcessedCheckoutCompletedCount,
    testProcessedCheckoutCompletedCount,
    checkoutSmokeFresh: timestampIsFresh(latestCheckoutCompletedAtMillis, nowMillis),
    liveCheckoutSmokeFresh: timestampIsFresh(latestLiveCheckoutCompletedAtMillis, nowMillis),
    validationFailedCount: statuses.filter((status) => status === 'validation_failed').length,
    missingGivingCount: statuses.filter((status) => status === 'missing_giving').length,
    unpaidSessionCount: statuses.filter((status) => status === 'unpaid_session').length,
    liveIssueCount: liveIssueEvents.length,
    liveValidationFailedCount: liveIssueStatuses.filter((status) => status === 'validation_failed').length,
    liveMissingGivingCount: liveIssueStatuses.filter((status) => status === 'missing_giving').length,
    liveUnpaidSessionCount: liveIssueStatuses.filter((status) => status === 'unpaid_session').length,
    latestLiveIssueAtMillis: millisFromTimestamp(liveIssueEvents[0]?.processedAt),
  };
}

async function taxReceiptEmailSmokeSummary(
  stripeMode: ReturnType<typeof stripeSecretKeyMode>,
  nowMillis: number
): Promise<Record<string, unknown>> {
  const [emailSentEventsSnap, liveCheckoutEventsSnap] = await Promise.all([
    db
      .collection('taxReceiptEvents')
      .where('action', '==', 'email_sent')
      .orderBy('createdAt', 'desc')
      .limit(50)
      .get(),
    db
      .collection('stripeWebhookEvents')
      .where('type', '==', 'checkout.session.completed')
      .where('status', '==', 'processed')
      .where('livemode', '==', true)
      .orderBy('processedAt', 'desc')
      .limit(50)
      .get(),
  ]);
  const emailSentEvents = emailSentEventsSnap.docs.map((doc) => doc.data());
  const liveCheckoutEvents = liveCheckoutEventsSnap.docs.map((doc) => doc.data());
  const latestLiveCheckoutGivingId = liveCheckoutEvents.find(
    (event) => typeof event.givingId === 'string' && event.givingId.length > 0
  )?.givingId as string | undefined;
  const liveCheckoutGivingIds = Array.from(new Set(
    liveCheckoutEvents
      .filter((event) => typeof event.givingId === 'string' && event.givingId.length > 0)
      .map((event) => event.givingId as string)
  )).slice(0, 30);
  const liveEmailSentEventsSnap = liveCheckoutGivingIds.length > 0
    ? await db
      .collection('taxReceiptEvents')
      .where('action', '==', 'email_sent')
      .where('givingId', 'in', liveCheckoutGivingIds)
      .orderBy('createdAt', 'desc')
      .limit(50)
      .get()
    : null;
  const liveEmailSentEvents = liveEmailSentEventsSnap?.docs.map((doc) => doc.data()) ?? [];
  const latestLiveCheckoutEmailSentEvent = latestLiveCheckoutGivingId
    ? liveEmailSentEvents.find((event) => event.givingId === latestLiveCheckoutGivingId)
    : null;
  const artifactSummary = await latestLiveCheckoutReceiptArtifactSummary(
    latestLiveCheckoutGivingId,
    latestLiveCheckoutEmailSentEvent ?? null,
    nowMillis
  );
  const latestEmailSentAtMillis = millisFromTimestamp(emailSentEvents[0]?.createdAt);
  const latestLiveEmailSentAtMillis = millisFromTimestamp(liveEmailSentEvents[0]?.createdAt);
  const latestLiveCheckoutEmailSentAtMillis = millisFromTimestamp(latestLiveCheckoutEmailSentEvent?.createdAt);
  const emailSentFresh = timestampIsFresh(latestEmailSentAtMillis, nowMillis);
  const liveEmailSentFresh = timestampIsFresh(latestLiveEmailSentAtMillis, nowMillis);
  const latestLiveCheckoutEmailSentFresh = timestampIsFresh(latestLiveCheckoutEmailSentAtMillis, nowMillis);

  return {
    checkedEventCount: emailSentEvents.length,
    smokeFreshnessWindowHours: PAYMENT_OPERATIONS_SMOKE_FRESHNESS_HOURS,
    checkedLiveCheckoutGivingCount: liveCheckoutGivingIds.length,
    emailSentCount: emailSentEvents.length,
    liveEmailSentCount: liveEmailSentEvents.length,
    latestEmailSentAtMillis,
    latestLiveEmailSentAtMillis,
    latestLiveCheckoutEmailSentAtMillis,
    emailSentFresh,
    liveEmailSentFresh,
    latestLiveCheckoutEmailSentFresh,
    ready: stripeMode === 'live'
      ? latestLiveCheckoutEmailSentAtMillis !== null
        && latestLiveCheckoutEmailSentFresh
        && artifactSummary.latestLiveCheckoutReceiptArtifactReady === true
        && artifactSummary.latestLiveCheckoutReceiptArtifactFresh === true
      : emailSentEvents.length > 0 && emailSentFresh,
    ...artifactSummary,
  };
}

async function latestLiveCheckoutReceiptArtifactSummary(
  latestLiveCheckoutGivingId: string | undefined,
  latestLiveCheckoutEmailSentEvent: FirebaseFirestore.DocumentData | null,
  nowMillis: number
): Promise<Record<string, unknown>> {
  const empty = {
    latestLiveCheckoutGivingSentAtMillis: null,
    latestLiveCheckoutReceiptIssuedAtMillis: null,
    latestLiveCheckoutReceiptEmailSentAtMillis: null,
    latestLiveCheckoutReceiptPdfRetainedAtMillis: null,
    latestLiveCheckoutReceiptPdfObjectReady: false,
    latestLiveCheckoutReceiptArtifactReady: false,
    latestLiveCheckoutReceiptArtifactFresh: false,
  };
  const givingId = safeDocumentId(trimmedString(latestLiveCheckoutGivingId));
  if (!givingId) return empty;

  const givingSnap = await db.collection('giving').doc(givingId).get();
  if (!givingSnap.exists) return empty;

  const giving = givingSnap.data() ?? {};
  const receiptId = safeDocumentId(trimmedString(giving.taxReceiptId) || givingId);
  const givingChurchId = trimmedString(giving.churchId);
  const givingUserId = trimmedString(giving.userId);
  const givingAmountCents = giving.amountCents;
  const givingCurrency = normalizedCurrency(giving.currency);
  const givingTaxReceiptNumber = trimmedString(giving.taxReceiptNumber);
  const givingSentAtMillis = millisFromTimestamp(giving.taxReceiptSentAt);
  const givingExplicitlyNonAnonymous = giving.anonymous === false;
  const givingDonorName = trimmedString(giving.donorName);

  if (!receiptId) {
    return {
      ...empty,
      latestLiveCheckoutGivingSentAtMillis: givingSentAtMillis,
    };
  }

  const receiptSnap = await db.collection('taxReceipts').doc(receiptId).get();
  if (!receiptSnap.exists) {
    return {
      ...empty,
      latestLiveCheckoutGivingSentAtMillis: givingSentAtMillis,
    };
  }

  const receipt = receiptSnap.data() ?? {};
  const receiptIssuedAtMillis = millisFromTimestamp(receipt.issuedAt);
  const receiptEmailSentAtMillis = millisFromTimestamp(receipt.emailSentAt);
  const receiptPdfRetainedAtMillis = millisFromTimestamp(receipt.pdfRetainedAt);
  const receiptChurchId = trimmedString(receipt.churchId);
  const receiptUserId = trimmedString(receipt.userId);
  const receiptAmountCents = receipt.amountCents;
  const receiptEligibleAmountCents = receipt.eligibleAmountCents;
  const receiptCurrency = normalizedCurrency(receipt.currency);
  const receiptPdfObjectReady = await retainedTaxReceiptPdfObjectMetadataReady(receiptSnap.id, receipt);
  const emailEvent = latestLiveCheckoutEmailSentEvent ?? {};
  const emailEventMatchesStoredReceipt =
    trimmedString(emailEvent.receiptId) === receiptSnap.id
    && trimmedString(emailEvent.givingId) === givingId
    && trimmedString(emailEvent.churchId) === receiptChurchId
    && trimmedString(emailEvent.userId) === receiptUserId
    && trimmedString(emailEvent.kind) === 'single';
  const artifactReady =
    giving.status === 'completed'
    && giving.taxReceiptStatus === 'sent'
    && hasNoStringError(giving.taxReceiptError)
    && hasNoStringError(giving.taxReceiptEmailError)
    && trimmedString(giving.donorEmail) === ''
    && (
      givingExplicitlyNonAnonymous
        ? giving.churchReceiptVisible === true
        : giving.churchReceiptVisible !== true
    )
    && (
      givingExplicitlyNonAnonymous
        ? giving.donorNamePublicSafe === true
        : giving.donorNamePublicSafe !== true
    )
    && (
      givingExplicitlyNonAnonymous
        ? giving.receiptManagerGivingSafeVersion === RECEIPT_MANAGER_GIVING_SAFE_VERSION
        : giving.receiptManagerGivingSafeVersion !== RECEIPT_MANAGER_GIVING_SAFE_VERSION
    )
    && (!givingDonorName || !looksLikeEmail(givingDonorName))
    && givingOmitsPrivatePaymentFields(giving)
    && receipt.kind === 'single'
    && receipt.status === 'sent'
    && trimmedString(receipt.givingId) === givingId
    && givingChurchId.length > 0
    && receiptChurchId === givingChurchId
    && givingUserId.length > 0
    && receiptUserId === givingUserId
    && hasPositiveInteger(givingAmountCents)
    && receiptAmountCents === givingAmountCents
    && receiptEligibleAmountCents === givingAmountCents
    && givingCurrency.length > 0
    && receiptCurrency === givingCurrency
    && officialReceiptNumberLooksAssigned(receipt.receiptNumber)
    && officialReceiptNumberLooksAssigned(givingTaxReceiptNumber)
    && givingTaxReceiptNumber === trimmedString(receipt.receiptNumber)
    && receiptIssuedAtMillis !== null
    && receiptEmailSentAtMillis !== null
    && givingSentAtMillis !== null
    && hasRetainedPdfStoragePath(receipt.pdfStoragePath)
    && hasSha256Evidence(receipt.pdfSha256)
    && hasPositiveInteger(receipt.pdfByteLength)
    && trimmedString(receipt.pdfRetentionStatus) === 'retained'
    && receiptPdfRetainedAtMillis !== null
    && receiptPdfObjectReady
    && hasNoStringError(receipt.emailError)
    && hasNoTimestampEvidence(receipt.emailFailedAt)
    && emailEventMatchesStoredReceipt;
  const artifactFresh =
    timestampIsFresh(receiptIssuedAtMillis, nowMillis)
    && timestampIsFresh(receiptEmailSentAtMillis, nowMillis)
    && timestampIsFresh(givingSentAtMillis, nowMillis)
    && timestampIsFresh(receiptPdfRetainedAtMillis, nowMillis);

  return {
    latestLiveCheckoutGivingSentAtMillis: givingSentAtMillis,
    latestLiveCheckoutReceiptIssuedAtMillis: receiptIssuedAtMillis,
    latestLiveCheckoutReceiptEmailSentAtMillis: receiptEmailSentAtMillis,
    latestLiveCheckoutReceiptPdfRetainedAtMillis: receiptPdfRetainedAtMillis,
    latestLiveCheckoutReceiptPdfObjectReady: receiptPdfObjectReady,
    latestLiveCheckoutReceiptArtifactReady: artifactReady,
    latestLiveCheckoutReceiptArtifactFresh: artifactFresh,
  };
}

async function taxReceiptAnnualSmokeSummary(nowMillis: number): Promise<Record<string, unknown>> {
  const annualEmailSentEventsSnap = await db
    .collection('taxReceiptEvents')
    .where('action', '==', 'email_sent')
    .where('kind', '==', 'annual')
    .orderBy('createdAt', 'desc')
    .limit(25)
    .get();
  const annualEmailSentEvents = annualEmailSentEventsSnap.docs.map((doc) => doc.data());
  const base = {
    checkedEventCount: annualEmailSentEvents.length,
    smokeFreshnessWindowHours: PAYMENT_OPERATIONS_SMOKE_FRESHNESS_HOURS,
    annualEmailSentCount: annualEmailSentEvents.length,
  };
  let fallbackSummary: Record<string, unknown> | null = null;

  for (const annualEmailSentEvent of annualEmailSentEvents) {
    const annualEmailSentAtMillis = millisFromTimestamp(annualEmailSentEvent.createdAt);
    const annualEmailSentFresh = timestampIsFresh(annualEmailSentAtMillis, nowMillis);
    const artifactSummary = await latestAnnualReceiptArtifactSummary(
      annualEmailSentEvent,
      nowMillis
    );
    const candidateSummary = {
      latestAnnualEmailSentAtMillis: annualEmailSentAtMillis,
      latestAnnualEmailSentFresh: annualEmailSentFresh,
      ...artifactSummary,
    };
    const candidateReady =
      annualEmailSentAtMillis !== null
      && annualEmailSentFresh
      && artifactSummary.latestAnnualReceiptSummaryReady === true
      && artifactSummary.latestAnnualReceiptArtifactReady === true
      && artifactSummary.latestAnnualReceiptArtifactFresh === true;

    if (candidateReady) {
      return {
        ...base,
        ...candidateSummary,
        ready: true,
      };
    }
    fallbackSummary ??= candidateSummary;
  }

  return {
    ...base,
    latestAnnualEmailSentAtMillis: null,
    latestAnnualEmailSentFresh: false,
    ...(fallbackSummary ?? await latestAnnualReceiptArtifactSummary(null, nowMillis)),
    ready: false,
  };
}

async function latestAnnualReceiptArtifactSummary(
  latestAnnualEmailSentEvent: FirebaseFirestore.DocumentData | null,
  nowMillis: number
): Promise<Record<string, unknown>> {
  const empty = {
    latestAnnualReceiptIssuedAtMillis: null,
    latestAnnualReceiptEmailSentAtMillis: null,
    latestAnnualReceiptPdfRetainedAtMillis: null,
    latestAnnualReceiptPdfObjectReady: false,
    latestAnnualReceiptSummaryReady: false,
    latestAnnualReceiptContributionDetailReady: false,
    latestAnnualReceiptOriginalYearEndReady: false,
    latestAnnualReceiptCorrectedOrReissue: false,
    latestAnnualReceiptArtifactReady: false,
    latestAnnualReceiptArtifactFresh: false,
  };
  const emailEvent = latestAnnualEmailSentEvent ?? {};
  const receiptId = safeDocumentId(trimmedString(emailEvent.receiptId));
  if (!receiptId) return empty;

  const [receiptSnap, summarySnap] = await Promise.all([
    db.collection('taxReceipts').doc(receiptId).get(),
    db.collection('taxReceiptSummaries').doc(receiptId).get(),
  ]);
  if (!receiptSnap.exists) return empty;

  const receipt = receiptSnap.data() ?? {};
  const summary = summarySnap.exists ? summarySnap.data() ?? {} : null;
  const receiptStatus = trimmedString(receipt.status);
  const receiptChurchId = trimmedString(receipt.churchId);
  const receiptUserId = trimmedString(receipt.userId);
  const receiptNumber = trimmedString(receipt.receiptNumber);
  const receiptYear = receiptYearNumber(receipt.receiptYear) ?? receiptYearNumber(receipt.annualYear);
  const receiptDonationCount = receipt.donationCount;
  const receiptGivingIds = stringArray(receipt.givingIds);
  const receiptIssuedAtMillis = millisFromTimestamp(receipt.issuedAt);
  const receiptEmailSentAtMillis = millisFromTimestamp(receipt.emailSentAt);
  const receiptPdfRetainedAtMillis = millisFromTimestamp(receipt.pdfRetainedAt);
  const receiptAmountCents = receipt.amountCents;
  const receiptEligibleAmountCents = receipt.eligibleAmountCents;
  const receiptCurrency = normalizedCurrency(receipt.currency);
  const contributionDetailReady = annualContributionDetailReady(receipt);
  const receiptPdfObjectReady = await retainedTaxReceiptPdfObjectMetadataReady(receiptSnap.id, receipt);
  const emailEventMatchesStoredReceipt =
    trimmedString(emailEvent.action) === 'email_sent'
    && trimmedString(emailEvent.receiptId) === receiptSnap.id
    && trimmedString(emailEvent.churchId) === receiptChurchId
    && trimmedString(emailEvent.userId) === receiptUserId
    && trimmedString(emailEvent.kind) === 'annual';
  const summaryEmailSentAtMillis = millisFromTimestamp(summary?.emailSentAt);
  const summaryYear = receiptYearNumber(summary?.receiptYear) ?? receiptYearNumber(summary?.annualYear);
  const summaryDonorLabel = trimmedString(summary?.donorLabel);
  const correctedOrReissueReceipt = annualReceiptHasCorrectionOrReissueEvidence(
    receiptSnap.id,
    receipt,
    summary
  );
  const originalYearEndReceiptReady = correctedOrReissueReceipt === false;
  const summaryReady =
    summary !== null
    && trimmedString(summary.kind) === 'annual'
    && trimmedString(summary.status) === receiptStatus
    && trimmedString(summary.receiptId) === receiptSnap.id
    && trimmedString(summary.churchId) === receiptChurchId
    && trimmedString(summary.userId) === receiptUserId
    && trimmedString(summary.receiptNumber) === receiptNumber
    && summaryYear !== null
    && summaryYear === receiptYear
    && summary.amountCents === receiptAmountCents
    && summary.eligibleAmountCents === receiptEligibleAmountCents
    && normalizedCurrency(summary.currency) === receiptCurrency
    && summary.donationCount === receiptDonationCount
    && summaryEmailSentAtMillis !== null
    && summaryEmailSentAtMillis === receiptEmailSentAtMillis
    && summary.donorAnonymous === false
    && summary.churchReceiptVisible === true
    && summary.donorLabelPublicSafe === true
    && summary.receiptManagerSummarySafe === true
    && summary.receiptManagerSummarySafeVersion === RECEIPT_MANAGER_SUMMARY_SAFE_VERSION
    && summaryDonorLabel.length > 0
    && !looksLikeEmail(summaryDonorLabel)
    && taxReceiptSummaryOmitsPrivateFields(summary);
  const artifactReady =
    receipt.kind === 'annual'
    && originalYearEndReceiptReady
    && receiptStatus === 'sent'
    && receipt.correctionRequired !== true
    && hasNoTimestampEvidence(receipt.voidedAt)
    && hasNoStringError(receipt.emailError)
    && hasNoTimestampEvidence(receipt.emailFailedAt)
    && emailEventMatchesStoredReceipt
    && receiptChurchId.length > 0
    && receiptUserId.length > 0
    && officialReceiptNumberLooksAssigned(receiptNumber)
    && hasPositiveInteger(receiptAmountCents)
    && hasPositiveInteger(receiptEligibleAmountCents)
    && receiptCurrency.length > 0
    && receiptYear !== null
    && annualGivingCoverageReady(receiptGivingIds, receiptDonationCount)
    && contributionDetailReady
    && receiptIssuedAtMillis !== null
    && receiptEmailSentAtMillis !== null
    && hasRetainedPdfStoragePath(receipt.pdfStoragePath)
    && hasSha256Evidence(receipt.pdfSha256)
    && hasPositiveInteger(receipt.pdfByteLength)
    && trimmedString(receipt.pdfRetentionStatus) === 'retained'
    && receiptPdfRetainedAtMillis !== null
    && receiptPdfObjectReady
    && summaryReady;
  const artifactFresh =
    timestampIsFresh(receiptIssuedAtMillis, nowMillis)
    && timestampIsFresh(receiptEmailSentAtMillis, nowMillis)
    && timestampIsFresh(receiptPdfRetainedAtMillis, nowMillis);

  return {
    latestAnnualReceiptIssuedAtMillis: receiptIssuedAtMillis,
    latestAnnualReceiptEmailSentAtMillis: receiptEmailSentAtMillis,
    latestAnnualReceiptPdfRetainedAtMillis: receiptPdfRetainedAtMillis,
    latestAnnualReceiptPdfObjectReady: receiptPdfObjectReady,
    latestAnnualReceiptSummaryReady: summaryReady,
    latestAnnualReceiptContributionDetailReady: contributionDetailReady,
    latestAnnualReceiptOriginalYearEndReady: originalYearEndReceiptReady,
    latestAnnualReceiptCorrectedOrReissue: correctedOrReissueReceipt,
    latestAnnualReceiptArtifactReady: artifactReady,
    latestAnnualReceiptArtifactFresh: artifactFresh,
  };
}

function countStripeRequirementFields(value: unknown): number {
  return Array.isArray(value)
    ? value.filter((entry) => typeof entry === 'string' && entry.length > 0).length
    : 0;
}

function emptyStripeAccountReadiness(errorCode = ''): Record<string, unknown> {
  return {
    checked: false,
    ready: false,
    chargesEnabled: false,
    payoutsEnabled: false,
    detailsSubmitted: false,
    country: '',
    defaultCurrency: '',
    disabledReason: '',
    currentlyDueCount: 0,
    pastDueCount: 0,
    eventuallyDueCount: 0,
    futureCurrentlyDueCount: 0,
    futurePastDueCount: 0,
    futureEventuallyDueCount: 0,
    errorCode,
  };
}

const EXPECTED_RESEND_SENDING_DOMAIN = 'kandilo.org';

function normalizeResendDomainName(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function emptyResendDomainReadiness(errorCode = ''): Record<string, unknown> {
  return {
    checked: false,
    domain: EXPECTED_RESEND_SENDING_DOMAIN,
    configured: false,
    verified: false,
    status: '',
    duplicateCount: 0,
    errorCode,
  };
}

async function resendDomainReadinessSummary(
  resendApiKey: string,
  resendApiKeyFormatValid: boolean
): Promise<Record<string, unknown>> {
  if (!resendApiKey || !resendApiKeyFormatValid) {
    return emptyResendDomainReadiness();
  }

  try {
    const response = await getResend().domains.list();
    const domains = Array.isArray(response.data?.data) ? response.data.data : [];
    const matches = domains.filter(
      (domain) => normalizeResendDomainName(domain?.name) === EXPECTED_RESEND_SENDING_DOMAIN
    );
    const verifiedMatches = matches.filter((domain) => domain?.status === 'verified');
    const firstMatch = verifiedMatches[0] ?? matches[0];

    return {
      checked: true,
      domain: EXPECTED_RESEND_SENDING_DOMAIN,
      configured: matches.length > 0,
      verified: verifiedMatches.length > 0,
      status: typeof firstMatch?.status === 'string'
        ? firstMatch.status
        : matches.length > 0 ? 'unknown' : 'missing',
      duplicateCount: Math.max(matches.length - 1, 0),
      errorCode: '',
    };
  } catch (error) {
    console.error('Resend domain readiness check failed:', {
      errorName: error instanceof Error ? error.name : 'UnknownError',
    });
    return emptyResendDomainReadiness('resend_domain_status_unavailable');
  }
}

async function stripeAccountReadinessSummary(
  stripeSecretKey: string,
  stripeMode: ReturnType<typeof stripeSecretKeyMode>
): Promise<Record<string, unknown>> {
  if (!stripeSecretKey || stripeMode === 'unknown' || stripeMode === 'not_configured') {
    return emptyStripeAccountReadiness();
  }

  try {
    const account = await getStripe().accounts.retrieve(null);
    const requirements =
      typeof account.requirements === 'object' && account.requirements !== null
        ? account.requirements as Record<string, unknown>
        : {};
    const futureRequirements =
      typeof account.future_requirements === 'object' && account.future_requirements !== null
        ? account.future_requirements as Record<string, unknown>
        : {};
    const currentlyDueCount = countStripeRequirementFields(requirements.currently_due);
    const pastDueCount = countStripeRequirementFields(requirements.past_due);
    const eventuallyDueCount = countStripeRequirementFields(requirements.eventually_due);
    const futureCurrentlyDueCount = countStripeRequirementFields(futureRequirements.currently_due);
    const futurePastDueCount = countStripeRequirementFields(futureRequirements.past_due);
    const futureEventuallyDueCount = countStripeRequirementFields(futureRequirements.eventually_due);
    const disabledReason =
      typeof requirements.disabled_reason === 'string' ? requirements.disabled_reason : '';
    const chargesEnabled = account.charges_enabled === true;
    const payoutsEnabled = account.payouts_enabled === true;
    const detailsSubmitted = account.details_submitted === true;
    const ready = chargesEnabled
      && payoutsEnabled
      && detailsSubmitted
      && currentlyDueCount === 0
      && pastDueCount === 0
      && !disabledReason;

    return {
      checked: true,
      ready,
      chargesEnabled,
      payoutsEnabled,
      detailsSubmitted,
      country: typeof account.country === 'string' ? account.country : '',
      defaultCurrency: typeof account.default_currency === 'string' ? account.default_currency : '',
      disabledReason,
      currentlyDueCount,
      pastDueCount,
      eventuallyDueCount,
      futureCurrentlyDueCount,
      futurePastDueCount,
      futureEventuallyDueCount,
      errorCode: '',
    };
  } catch (error) {
    console.error('Stripe account readiness check failed:', {
      errorName: error instanceof Error ? error.name : 'UnknownError',
    });
    return emptyStripeAccountReadiness('stripe_account_status_unavailable');
  }
}

export const getPaymentOperationsReadiness = onCall(
  {
    ...appCheckCallableOptions,
    secrets: ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'RESEND_API_KEY'],
  },
  async (request) => {
    assertSuperAdmin(request);

    const stripeSecretKey = configuredStripeSecretKey(process.env.STRIPE_SECRET_KEY);
    const stripeWebhookSecret = configuredStripeWebhookSecret(process.env.STRIPE_WEBHOOK_SECRET);
    const resendApiKey = configuredResendApiKey(process.env.RESEND_API_KEY);
    const configuredAppUrl = configuredSecret(process.env.APP_URL);
    const appUrl = stripeReturnAppUrlReadiness(process.env.APP_URL, 'https://app.kandilo.org');
    const stripeMode = stripeSecretKeyMode(stripeSecretKey);
    const webhookSecretLooksValid = !stripeWebhookSecret || stripeWebhookSecretLooksValid(stripeWebhookSecret);
    const resendApiKeyFormatValid = !resendApiKey || resendApiKeyLooksValid(resendApiKey);
    const warnings: string[] = [];
    const checkedAtMillis = Date.now();
    const webhookUrl = expectedStripeWebhookUrl();
    const webhookActivity = await stripeWebhookActivitySummary(checkedAtMillis);
    const stripeAccount = await stripeAccountReadinessSummary(stripeSecretKey, stripeMode);
    const stripeWebhookEndpoint = await stripeWebhookEndpointReadinessSummary(
      stripeSecretKey,
      stripeMode,
      webhookUrl
    );
    const resendDomain = await resendDomainReadinessSummary(resendApiKey, resendApiKeyFormatValid);
    const taxReceiptEmailSmoke = await taxReceiptEmailSmokeSummary(stripeMode, checkedAtMillis);
    const taxReceiptAnnualSmoke = await taxReceiptAnnualSmokeSummary(checkedAtMillis);

    if (!configuredAppUrl) warnings.push('app_url_missing');
    if (appUrl.errorCode) warnings.push(appUrl.errorCode);
    if (!stripeSecretKey) warnings.push('stripe_secret_key_missing');
    if (stripeMode === 'test') warnings.push('stripe_secret_key_test_mode');
    if (stripeMode === 'unknown') warnings.push('stripe_secret_key_unrecognized_mode');
    if (!stripeWebhookSecret) warnings.push('stripe_webhook_secret_missing');
    if (!webhookSecretLooksValid) warnings.push('stripe_webhook_secret_invalid_format');
    if (!resendApiKey) warnings.push('resend_api_key_missing');
    if (!resendApiKeyFormatValid) warnings.push('resend_api_key_invalid_format');
    if (resendApiKey && resendApiKeyFormatValid) {
      if (resendDomain.checked !== true) warnings.push(String(resendDomain.errorCode || 'resend_domain_status_unavailable'));
      if (resendDomain.checked === true && resendDomain.configured !== true) warnings.push('resend_domain_missing');
      if (
        resendDomain.checked === true
        && resendDomain.configured === true
        && resendDomain.verified !== true
      ) {
        warnings.push('resend_domain_unverified');
      }
      if (resendDomain.checked === true && Number(resendDomain.duplicateCount) > 0) {
        warnings.push('resend_domain_duplicate');
      }
    }
    if (stripeSecretKey && stripeMode !== 'unknown') {
      if (stripeAccount.checked !== true) warnings.push(String(stripeAccount.errorCode || 'stripe_account_status_unavailable'));
      if (stripeAccount.checked === true && stripeAccount.chargesEnabled !== true) warnings.push('stripe_account_charges_disabled');
      if (stripeAccount.checked === true && stripeAccount.payoutsEnabled !== true) warnings.push('stripe_account_payouts_disabled');
      if (stripeAccount.checked === true && stripeAccount.detailsSubmitted !== true) warnings.push('stripe_account_details_missing');
      if (
        stripeAccount.checked === true
        && (
          Number(stripeAccount.currentlyDueCount) > 0
          || Number(stripeAccount.pastDueCount) > 0
        )
      ) {
        warnings.push('stripe_account_requirements_due');
      }
      if (stripeAccount.checked === true && stripeAccount.disabledReason) warnings.push('stripe_account_disabled');
      if (stripeAccount.checked === true && Number(stripeAccount.eventuallyDueCount) > 0) {
        warnings.push('stripe_account_eventual_needs_due');
      }
      if (
        stripeAccount.checked === true
        && (
          Number(stripeAccount.futureCurrentlyDueCount) > 0
          || Number(stripeAccount.futurePastDueCount) > 0
          || Number(stripeAccount.futureEventuallyDueCount) > 0
        )
      ) {
        warnings.push('stripe_account_upcoming_requirements_due');
      }
    }
    if (stripeMode === 'live') {
      if (stripeWebhookEndpoint.checked !== true) {
        warnings.push(String(stripeWebhookEndpoint.errorCode || 'stripe_webhook_endpoint_status_unavailable'));
      } else if (stripeWebhookEndpoint.configured !== true) {
        warnings.push('stripe_webhook_endpoint_missing');
      } else {
        if (stripeWebhookEndpoint.liveMode !== true) warnings.push('stripe_webhook_endpoint_not_live');
        if (Number(stripeWebhookEndpoint.duplicateCount) > 0) warnings.push('stripe_webhook_endpoint_duplicate');
        if (
          stripeWebhookEndpoint.enabled !== true
          && Number(stripeWebhookEndpoint.duplicateCount) === 0
        ) {
          warnings.push('stripe_webhook_endpoint_disabled');
        }
        if (stripeWebhookEndpoint.apiVersionMatches !== true) {
          warnings.push('stripe_webhook_endpoint_api_version_mismatch');
        }
        if (stripeWebhookEndpoint.requiredEventsConfigured !== true) {
          warnings.push('stripe_webhook_endpoint_missing_events');
        }
        if (stripeWebhookEndpoint.explicitEventsOnly !== true) {
          warnings.push('stripe_webhook_endpoint_wildcard_events');
        }
        if (stripeWebhookEndpoint.noUnexpectedEvents !== true) {
          warnings.push('stripe_webhook_endpoint_extra_events');
        }
      }
    }
    const webhookIssueCount =
      Number(webhookActivity.validationFailedCount)
      + Number(webhookActivity.missingGivingCount)
      + Number(webhookActivity.unpaidSessionCount);
    const liveWebhookIssueCount = Number(webhookActivity.liveIssueCount) || 0;
    const blockingWebhookIssueCount = Math.max(webhookIssueCount, liveWebhookIssueCount);
    const processedCount = Number(webhookActivity.processedCount);
    const liveProcessedCount = Number(webhookActivity.liveProcessedCount);
    const processedCheckoutCompletedCount = Number(webhookActivity.processedCheckoutCompletedCount);
    const liveProcessedCheckoutCompletedCount = Number(webhookActivity.liveProcessedCheckoutCompletedCount);
    const checkoutSmokeFresh = webhookActivity.checkoutSmokeFresh === true;
    const liveCheckoutSmokeFresh = webhookActivity.liveCheckoutSmokeFresh === true;
    const requiresLiveWebhookSmoke = stripeMode === 'live';
    const latestRelevantWebhookStatus = requiresLiveWebhookSmoke
      ? String(webhookActivity.latestLiveStatus || '')
      : String(webhookActivity.latestStatus || '');
    const webhookCheckoutSmokeReady = requiresLiveWebhookSmoke
      ? liveProcessedCheckoutCompletedCount > 0 && liveCheckoutSmokeFresh
      : processedCheckoutCompletedCount > 0 && checkoutSmokeFresh;
    const webhookSmokeReady =
      webhookCheckoutSmokeReady
      && latestRelevantWebhookStatus === 'processed'
      && blockingWebhookIssueCount === 0;
    if (processedCount === 0) warnings.push('stripe_webhook_smoke_missing');
    if (processedCheckoutCompletedCount === 0) warnings.push('stripe_webhook_checkout_smoke_missing');
    if (processedCheckoutCompletedCount > 0 && !checkoutSmokeFresh) {
      warnings.push('stripe_webhook_checkout_smoke_stale');
    }
    if (requiresLiveWebhookSmoke && liveProcessedCheckoutCompletedCount === 0) {
      warnings.push('stripe_webhook_live_smoke_missing');
      warnings.push('stripe_webhook_live_checkout_smoke_missing');
    } else if (requiresLiveWebhookSmoke && liveProcessedCount === 0) {
      warnings.push('stripe_webhook_live_smoke_missing');
    }
    if (requiresLiveWebhookSmoke && liveProcessedCheckoutCompletedCount > 0 && !liveCheckoutSmokeFresh) {
      warnings.push('stripe_webhook_live_checkout_smoke_stale');
    }
    if (
      requiresLiveWebhookSmoke
      && liveProcessedCount > 0
      && webhookActivity.latestLiveStatus
      && webhookActivity.latestLiveStatus !== 'processed'
    ) {
      warnings.push('stripe_webhook_latest_live_not_processed');
    }
    if (webhookIssueCount > 0) warnings.push('stripe_webhook_recent_issues');
    if (liveWebhookIssueCount > 0) warnings.push('stripe_webhook_live_issues');
    if (Number(taxReceiptEmailSmoke.emailSentCount) === 0) warnings.push('tax_receipt_email_smoke_missing');
    if (Number(taxReceiptEmailSmoke.emailSentCount) > 0 && taxReceiptEmailSmoke.emailSentFresh !== true) {
      warnings.push('tax_receipt_email_smoke_stale');
    }
    if (
      requiresLiveWebhookSmoke
      && (
        Number(taxReceiptEmailSmoke.liveEmailSentCount) === 0
        || taxReceiptEmailSmoke.latestLiveCheckoutEmailSentAtMillis === null
      )
    ) {
      warnings.push('tax_receipt_live_email_smoke_missing');
    }
    if (
      requiresLiveWebhookSmoke
      && taxReceiptEmailSmoke.latestLiveCheckoutEmailSentAtMillis !== null
      && taxReceiptEmailSmoke.latestLiveCheckoutEmailSentFresh !== true
    ) {
      warnings.push('tax_receipt_live_email_smoke_stale');
    }
    if (
      requiresLiveWebhookSmoke
      && taxReceiptEmailSmoke.latestLiveCheckoutEmailSentAtMillis !== null
      && taxReceiptEmailSmoke.latestLiveCheckoutReceiptArtifactReady !== true
    ) {
      warnings.push('tax_receipt_live_receipt_artifacts_missing');
    }
    if (
      requiresLiveWebhookSmoke
      && taxReceiptEmailSmoke.latestLiveCheckoutReceiptArtifactReady === true
      && taxReceiptEmailSmoke.latestLiveCheckoutReceiptArtifactFresh !== true
    ) {
      warnings.push('tax_receipt_live_receipt_artifacts_stale');
    }
    if (Number(taxReceiptAnnualSmoke.annualEmailSentCount) === 0) {
      warnings.push('tax_receipt_annual_smoke_missing');
    }
    if (
      Number(taxReceiptAnnualSmoke.annualEmailSentCount) > 0
      && taxReceiptAnnualSmoke.latestAnnualEmailSentFresh !== true
    ) {
      warnings.push('tax_receipt_annual_smoke_stale');
    }
    if (
      taxReceiptAnnualSmoke.latestAnnualEmailSentAtMillis !== null
      && taxReceiptAnnualSmoke.latestAnnualReceiptCorrectedOrReissue === true
    ) {
      warnings.push('tax_receipt_annual_original_smoke_missing');
    }
    if (
      taxReceiptAnnualSmoke.latestAnnualEmailSentAtMillis !== null
      && taxReceiptAnnualSmoke.latestAnnualReceiptOriginalYearEndReady === true
      && taxReceiptAnnualSmoke.latestAnnualReceiptContributionDetailReady !== true
    ) {
      warnings.push('tax_receipt_annual_contribution_detail_missing');
    }
    if (
      taxReceiptAnnualSmoke.latestAnnualEmailSentAtMillis !== null
      && taxReceiptAnnualSmoke.latestAnnualReceiptArtifactReady !== true
    ) {
      warnings.push('tax_receipt_annual_artifacts_missing');
    }
    if (
      taxReceiptAnnualSmoke.latestAnnualReceiptArtifactReady === true
      && taxReceiptAnnualSmoke.latestAnnualReceiptArtifactFresh !== true
    ) {
      warnings.push('tax_receipt_annual_artifacts_stale');
    }

    const donationFlowReady =
      Boolean(stripeSecretKey)
      && Boolean(stripeWebhookSecret)
      && webhookSecretLooksValid
      && appUrl.configured
      && appUrl.runtimeValid
      && webhookSmokeReady
      && (stripeMode !== 'live' || stripeWebhookEndpoint.ready === true)
      && (stripeMode !== 'live' || stripeAccount.ready === true);
    const taxReceiptDeliveryReady =
      Boolean(resendApiKey)
      && resendApiKeyFormatValid
      && resendDomain.checked === true
      && resendDomain.verified === true
      && Number(resendDomain.duplicateCount) === 0;
    const taxReceiptEmailSmokeReady = taxReceiptEmailSmoke.ready === true;
    const taxReceiptAnnualSmokeReady = taxReceiptAnnualSmoke.ready === true;

    return {
      checkedAtMillis,
      appUrl,
      stripeSecretKey: {
        configured: Boolean(stripeSecretKey),
        mode: stripeMode,
      },
      stripeWebhookSecret: {
        configured: Boolean(stripeWebhookSecret),
        formatValid: webhookSecretLooksValid,
      },
      stripeApiVersion: STRIPE_API_VERSION,
      stripeWebhookEndpoint,
      resendApiKey: {
        configured: Boolean(resendApiKey),
        formatValid: resendApiKeyFormatValid,
      },
      resendDomain,
      stripeAccount,
      webhookUrl,
      webhookActivity,
      taxReceiptEmailSmoke,
      taxReceiptAnnualSmoke,
      donationFlowReady,
      taxReceiptDeliveryReady,
      productionReady:
        donationFlowReady
        && taxReceiptDeliveryReady
        && taxReceiptEmailSmokeReady
        && taxReceiptAnnualSmokeReady
        && stripeMode === 'live',
      warnings,
    };
  }
);

export const getSuperAdminStats = onCall({ ...appCheckCallableOptions, secrets: [] }, async (request) => {
  assertSuperAdmin(request);

  const churchesSnap = await db.collection('churches').limit(200).get();
  const stats = await Promise.all(
    churchesSnap.docs.map(async (churchDoc) => {
      const c = churchDoc.data();
      const churchId = churchDoc.id;

      const membersQuery = db.collection('churches').doc(churchId).collection('members');
      const eventsQuery = db.collection('events').where('churchId', '==', churchId);
      const newslettersQuery = db.collection('newsletters').where('churchId', '==', churchId);
      const completedGivingQuery = db
        .collection('giving')
        .where('churchId', '==', churchId)
        .where('status', '==', 'completed');

      const [memberCount, priestCount, treasurerCount, adminCount, eventCount, newsletterCount, donationTotal] = await Promise.all([
        getQueryCount(membersQuery),
        getQueryCount(membersQuery.where('role', '==', 'priest')),
        getQueryCount(membersQuery.where('role', '==', 'treasurer')),
        getQueryCount(membersQuery.where('role', '==', 'admin')),
        getQueryCount(eventsQuery),
        getQueryCount(newslettersQuery),
        getQuerySum(completedGivingQuery, 'amount'),
      ]);

      return {
        churchId,
        name: c.name ?? '',
        city: c.city ?? '',
        state: c.state ?? '',
        denomination: c.denomination ?? '',
        isActive: c.isActive === true,
        isVerified: c.isVerified ?? false,
        foundedYear: c.foundedYear ?? 0,
        memberCount,
        priestCount,
        treasurerCount,
        adminCount,
        donationTotal,
        eventCount,
        newsletterCount,
        imageURL: c.imageURL ?? '',
      };
    })
  );

  return { stats };
});

export const getTaxReceiptAuditEvents = onCall({ ...appCheckCallableOptions, secrets: [] }, async (request) => {
  assertSuperAdmin(request);

  const snap = await db
    .collection('taxReceiptEvents')
    .orderBy('createdAt', 'desc')
    .limit(100)
    .get();
  const churchIds = Array.from(new Set(
    snap.docs
      .map((doc) => doc.data().churchId)
      .filter((churchId): churchId is string => typeof churchId === 'string' && churchId.length > 0)
  ));
  const churchSnaps = await Promise.all(
    churchIds.map((churchId) => db.collection('churches').doc(churchId).get())
  );
  const churchNames = new Map(
    churchSnaps.map((churchSnap) => [
      churchSnap.id,
      typeof churchSnap.data()?.name === 'string' ? churchSnap.data()!.name : churchSnap.id,
    ])
  );

  const events = snap.docs.map((doc) => {
    const data = doc.data();
    const churchId = typeof data.churchId === 'string' ? data.churchId : '';
    const actorUid = typeof data.actorUid === 'string' ? data.actorUid : '';
    const targetUserId = typeof data.userId === 'string' ? data.userId : '';
    const reviewCount =
      data.action === 'annual_scheduled_review_summary'
      && typeof data.reviewCount === 'number'
      && Number.isInteger(data.reviewCount)
      && data.reviewCount > 0
        ? data.reviewCount
        : null;
    return {
      id: doc.id,
      action: typeof data.action === 'string' ? data.action : 'unknown',
      actorUid: actorUid && actorUid === targetUserId ? 'donor' : actorUid,
      churchId,
      churchName: churchNames.get(churchId) ?? churchId,
      receiptId: publicTaxReceiptAuditReceiptId(data),
      kind: typeof data.kind === 'string' ? data.kind : 'unknown',
      receiptYear: typeof data.receiptYear === 'number' ? data.receiptYear : null,
      annualYear: typeof data.annualYear === 'number' ? data.annualYear : null,
      errorCode: publicTaxReceiptAuditCode(data.errorCode),
      reasonCode: publicTaxReceiptAuditCode(data.reasonCode),
      reviewCount,
      createdAtMillis: millisFromTimestamp(data.createdAt),
    };
  });

  return { events };
});

export const getChurchPaymentSettings = onCall({ ...appCheckCallableOptions, secrets: [] }, async (request) => {
  assertSuperAdmin(request);

  const { churchId: rawChurchId } = callableDataRecord(request.data);
  const churchId = assertNonEmptyString(rawChurchId, 128, 'churchId');
  const churchSnap = await db.collection('churches').doc(churchId).get();
  if (!churchSnap.exists) {
    throw new HttpsError('not-found', 'Church not found.');
  }

  const settings = await loadChurchPaymentSettings(churchId);
  return {
    churchId,
    stripeConnectEnabled: settings.stripeConnectEnabled,
    stripeConnectAccountId: settings.stripeConnectAccountId,
    stripeConnectAccountApi: settings.stripeConnectAccountApi,
  };
});

export const updateChurchPaymentSettingsAsSuperAdmin = onCall(
  { ...replayProtectedCallableOptions, secrets: ['STRIPE_SECRET_KEY'] },
  async (request) => {
    assertFreshAppCheck(request);
    assertSuperAdmin(request);

    const { churchId: rawChurchId, settings: rawSettings } = callableDataRecord(request.data);
    const churchId = assertNonEmptyString(rawChurchId, 128, 'churchId');
    const requestedSettings = sanitizeChurchPaymentSettings(rawSettings);

    const churchSnap = await db.collection('churches').doc(churchId).get();
    if (!churchSnap.exists) {
      throw new HttpsError('not-found', 'Church not found.');
    }
    const settingsRef = db.collection(CHURCH_PAYMENT_SETTINGS_COLLECTION).doc(churchId);
    const previous = (await settingsRef.get()).data() ?? {};
    const previousSettings = sanitizeChurchPaymentSettings(previous);
    const requestedSettingsRecord =
      typeof rawSettings === 'object' && rawSettings !== null && !Array.isArray(rawSettings)
        ? rawSettings as Record<string, unknown>
        : {};
    const requestedAccountApiProvided =
      requestedSettingsRecord.stripeConnectAccountApi === 'v1'
      || requestedSettingsRecord.stripeConnectAccountApi === 'v2';
    const sameConnectedAccount =
      Boolean(requestedSettings.stripeConnectAccountId)
      && requestedSettings.stripeConnectAccountId === previousSettings.stripeConnectAccountId;
    const settings: ChurchPaymentSettings = {
      ...requestedSettings,
      stripeConnectAccountApi:
        !requestedSettings.stripeConnectAccountId
          ? 'v1'
        : sameConnectedAccount && !requestedAccountApiProvided
          ? previousSettings.stripeConnectAccountApi
          : requestedSettings.stripeConnectAccountApi,
    };
    if (settings.stripeConnectEnabled) {
      await assertStripeConnectAccountReadyForRouting(settings, churchId);
    }

    await settingsRef.set(churchPaymentSettingsWritePayload(settings, request.auth!.uid), { merge: true });
    await logAuditEvent(request.auth!.uid, 'updateChurchPaymentSettingsAsSuperAdmin', {
      churchId,
      previous: paymentSettingsAuditSummary(previous),
      next: paymentSettingsAuditSummary(settings),
    });

    return { success: true, churchId };
  }
);

export const createChurchStripeConnectAccountAsSuperAdmin = onCall(
  { ...replayProtectedCallableOptions, secrets: ['STRIPE_SECRET_KEY'] },
  async (request) => {
    assertFreshAppCheck(request);
    assertSuperAdmin(request);

    const { churchId: rawChurchId } = callableDataRecord(request.data);
    const churchId = assertNonEmptyString(rawChurchId, 128, 'churchId');

    const churchSnap = await db.collection('churches').doc(churchId).get();
    if (!churchSnap.exists) {
      throw new HttpsError('not-found', 'Church not found.');
    }
    const church = churchSnap.data() ?? {};
    if (church.isActive !== true) {
      throw new HttpsError('failed-precondition', 'This church is not currently active.');
    }

    const settingsRef = db.collection(CHURCH_PAYMENT_SETTINGS_COLLECTION).doc(churchId);
    const previous = (await settingsRef.get()).data() ?? {};
    const previousSettings = sanitizeChurchPaymentSettings(previous);
    if (previousSettings.stripeConnectAccountId) {
      throw new HttpsError(
        'failed-precondition',
        'This church already has a Stripe connected account configured.'
      );
    }

    const country = stripeConnectAccountCountry(church);
    const accountDefaults = stripeConnectAccountDefaultsForCountry(country);
    const displayName = stripeConnectAccountDisplayName(church, churchId);
    const contactEmail = stripeConnectAccountRequiredEmail(church);
    const website = stripeConnectAccountWebsite(church);
    let stripe: ReturnType<typeof getStripe>;
    try {
      stripe = getStripe();
    } catch (error) {
      console.error('Stripe Connect account creation unavailable:', {
        churchId,
        errorName: error instanceof Error ? error.name : typeof error,
      });
      throw new HttpsError(
        'failed-precondition',
        'Stripe is not configured for connected account creation.'
      );
    }

    let account: Awaited<ReturnType<typeof stripe.v2.core.accounts.create>>;
    try {
      account = await stripe.v2.core.accounts.create(
        {
          contact_email: contactEmail,
          dashboard: 'express',
          display_name: displayName,
          defaults: {
            currency: accountDefaults.currency,
            locales: accountDefaults.locales,
            profile: {
              doing_business_as: displayName,
              product_description: 'Charitable donations to an Orthodox parish.',
              ...(website ? { business_url: website } : {}),
            },
            responsibilities: {
              fees_collector: 'application',
              losses_collector: 'application',
            },
          },
          identity: {
            country,
            entity_type: 'non_profit',
          },
          configuration: {
            recipient: {
              capabilities: {
                stripe_balance: {
                  stripe_transfers: { requested: true },
                },
              },
            },
          },
          metadata: {
            kandiloChurchId: churchId,
            kandiloPurpose: 'church_donation_routing',
            kandiloConnectApi: 'v2',
          },
        },
        { idempotencyKey: `stripe_connect_account_v2_${churchId}` }
      );
    } catch (error) {
      console.error('Stripe Connect account creation failed:', {
        churchId,
        errorName: error instanceof Error ? error.name : typeof error,
        errorCode:
          typeof (error as { code?: unknown }).code === 'string'
            ? (error as { code: string }).code
            : undefined,
      });
      throw new HttpsError(
        'failed-precondition',
        'Stripe could not create a connected account for this church.'
      );
    }

    const accountId = typeof account.id === 'string' ? account.id : '';
    if (!stripeConnectAccountIdLooksValid(accountId)) {
      throw new HttpsError('failed-precondition', 'Stripe returned an invalid connected account ID.');
    }

    const settings: ChurchPaymentSettings = {
      stripeConnectEnabled: false,
      stripeConnectAccountId: accountId,
      stripeConnectAccountApi: 'v2',
    };
    await settingsRef.set({
      ...churchPaymentSettingsWritePayload(settings, request.auth!.uid),
      stripeConnectAccountCreatedByKandilo: true,
      stripeConnectAccountCreatedAt: FieldValue.serverTimestamp(),
      stripeConnectAccountCountry: country,
      stripeConnectAccountDashboard: 'express',
      stripeConnectAccountApi: 'v2',
    }, { merge: true });
    await logAuditEvent(request.auth!.uid, 'createChurchStripeConnectAccountAsSuperAdmin', {
      churchId,
      previous: paymentSettingsAuditSummary(previous),
      next: paymentSettingsAuditSummary(settings),
      stripeConnectAccountCreatedByKandilo: true,
      stripeConnectRoutingEnabled: false,
    });

    return {
      success: true,
      churchId,
      stripeConnectEnabled: false,
      stripeConnectAccountId: accountId,
      stripeConnectAccountApi: 'v2',
    };
  }
);

export const createChurchStripeConnectOnboardingLink = onCall(
  { ...replayProtectedCallableOptions, secrets: ['STRIPE_SECRET_KEY'] },
  async (request) => {
    assertFreshAppCheck(request);
    assertVerifiedNonAnonymousUser(
      request,
      'A verified, non-anonymous account is required to open Stripe onboarding.'
    );

    const { churchId: rawChurchId, returnState: rawReturnState } = callableDataRecord(request.data);
    const churchId = assertNonEmptyString(rawChurchId, 128, 'churchId');
    const returnState = assertStripeConnectReturnState(rawReturnState);
    await checkRateLimit(request.auth!.uid, 'createChurchStripeConnectOnboardingLink', 3);

    const churchSnap = await db.collection('churches').doc(churchId).get();
    if (!churchSnap.exists) {
      throw new HttpsError('not-found', 'Church not found.');
    }
    if (churchSnap.data()?.isActive !== true) {
      throw new HttpsError('failed-precondition', 'This church is not currently active.');
    }

    const isSuperAdmin = request.auth!.token['superAdmin'] === true;
    if (!isSuperAdmin) {
      await assertActiveChurchRole(
        churchId,
        request.auth!.uid,
        ['priest', 'treasurer'],
        'Only priests and treasurers can open Stripe onboarding for this church.'
      );
    }

    const settings = await loadChurchPaymentSettings(churchId);
    if (!settings.stripeConnectAccountId) {
      throw new HttpsError(
        'failed-precondition',
        'A Stripe connected account must be configured before onboarding can be opened.'
      );
    }

    let stripe: ReturnType<typeof getStripe>;
    try {
      stripe = getStripe();
    } catch (error) {
      console.error('Stripe Connect onboarding link unavailable:', {
        errorName: error instanceof Error ? error.name : typeof error,
      });
      throw new HttpsError(
        'failed-precondition',
        'Stripe is not configured for connected account onboarding.'
      );
    }

    let accountLink: { url?: unknown; expires_at?: unknown };
    try {
      if (settings.stripeConnectAccountApi === 'v2') {
        accountLink = await stripe.v2.core.accountLinks.create({
          account: settings.stripeConnectAccountId,
          use_case: {
            type: 'account_onboarding',
            account_onboarding: {
              configurations: ['recipient'],
              refresh_url: stripeConnectOnboardingReturnUrl(churchId, 'refresh', returnState),
              return_url: stripeConnectOnboardingReturnUrl(churchId, 'return', returnState),
              collection_options: {
                fields: 'eventually_due',
                future_requirements: 'include',
              },
            },
          },
        });
      } else {
        accountLink = await stripe.accountLinks.create({
          account: settings.stripeConnectAccountId,
          type: 'account_onboarding',
          refresh_url: stripeConnectOnboardingReturnUrl(churchId, 'refresh', returnState),
          return_url: stripeConnectOnboardingReturnUrl(churchId, 'return', returnState),
          collection_options: {
            fields: 'eventually_due',
            future_requirements: 'include',
          },
        });
      }
    } catch (error) {
      if (error instanceof HttpsError) {
        throw error;
      }
      console.error('Stripe Connect onboarding link creation failed:', {
        churchId,
        stripeConnectAccountApi: settings.stripeConnectAccountApi,
        errorName: error instanceof Error ? error.name : typeof error,
        errorCode:
          typeof (error as { code?: unknown }).code === 'string'
            ? (error as { code: string }).code
            : undefined,
      });
      throw new HttpsError(
        'failed-precondition',
        'Stripe onboarding could not be opened for this connected account.'
      );
    }
    const accountLinkUrl = typeof accountLink.url === 'string' ? accountLink.url : '';
    if (!accountLinkUrl) {
      throw new HttpsError(
        'failed-precondition',
        'Stripe onboarding did not return a usable account link.'
      );
    }

    await logAuditEvent(request.auth!.uid, 'createChurchStripeConnectOnboardingLink', {
      churchId,
      actorScope: isSuperAdmin ? 'superAdmin' : 'churchFinance',
      stripeConnectAccountConfigured: true,
      stripeConnectReturnStateBound: true,
    });

    return {
      success: true,
      url: accountLinkUrl,
      expiresAtMillis: stripeAccountLinkExpiresAtMillis(accountLink.expires_at),
    };
  }
);

export const getChurchStripeConnectSetupStatus = onCall(
  { ...appCheckCallableOptions, secrets: [] },
  async (request) => {
    assertVerifiedNonAnonymousUser(
      request,
      'A verified, non-anonymous account is required to view Stripe onboarding setup status.'
    );

    const { churchId: rawChurchId } = callableDataRecord(request.data);
    const churchId = assertNonEmptyString(rawChurchId, 128, 'churchId');
    const churchSnap = await db.collection('churches').doc(churchId).get();
    if (!churchSnap.exists) {
      throw new HttpsError('not-found', 'Church not found.');
    }

    const isSuperAdmin = request.auth!.token['superAdmin'] === true;
    if (!isSuperAdmin) {
      await assertActiveChurchRole(
        churchId,
        request.auth!.uid,
        ['priest', 'treasurer'],
        'Only priests and treasurers can view Stripe onboarding setup status for this church.'
      );
    }

    const settings = await loadChurchPaymentSettings(churchId);
    const stripeConnectAccountConfigured = Boolean(settings.stripeConnectAccountId);

    return {
      churchId,
      stripeConnectAccountConfigured,
      stripeConnectRoutingEnabled: settings.stripeConnectEnabled,
      stripeConnectAccountApi: stripeConnectAccountConfigured
        ? settings.stripeConnectAccountApi
        : 'not_configured',
    };
  }
);

export const createChurch = onCall({ ...replayProtectedCallableOptions, secrets: [] }, async (request) => {
  assertFreshAppCheck(request);
  assertSuperAdmin(request);

  const data = callableDataRecord(request.data);

  const name = assertNonEmptyString(data.name, 200, 'name');
  const city = assertNonEmptyString(data.city, 100, 'city');
  const contactEmail = assertEmail(
    assertNonEmptyString(data.contactEmail, 254, 'contactEmail'),
    'contactEmail'
  );
  const denomination = optionalString(data.denomination, 200, 'denomination');
  const jurisdiction = optionalString(data.jurisdiction, 300, 'jurisdiction');
  const diocese = optionalString(data.diocese, 300, 'diocese');
  const foundedYear = optionalFiniteNumber(data.foundedYear, 'foundedYear');
  const about = optionalString(data.about, 5000, 'about');
  const languages = optionalLanguageList(data.languages);
  const address = optionalString(data.address, 500, 'address');
  const state = optionalString(data.state, 100, 'state');
  const country = optionalString(data.country, 10, 'country');
  const postalCode = optionalString(data.postalCode, 20, 'postalCode');
  const latitude = optionalFiniteNumber(data.latitude, 'latitude');
  const longitude = optionalFiniteNumber(data.longitude, 'longitude');
  const timezone = optionalString(data.timezone, 50, 'timezone');
  const phone = optionalString(data.phone, 30, 'phone');
  const website = optionalString(data.website, 2000, 'website');
  const imageURL = optionalString(data.imageURL, 2000, 'imageURL');
  const coverImageURL = optionalString(data.coverImageURL, 2000, 'coverImageURL');
  const taxReceiptSettings = optionalTaxReceiptSettings(data.taxReceiptSettings);

  if (website) assertHttpsUrl(website, 'website');
  if (imageURL) assertHttpsUrl(imageURL, 'imageURL');
  if (coverImageURL) assertHttpsUrl(coverImageURL, 'coverImageURL');

  validateFoundedYear(foundedYear);
  validateLatitude(latitude);
  validateLongitude(longitude);

  const slug = `${name} ${city}`
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 60)
    || 'church';

  let finalId = slug;
  let attempt = 0;
  const churchCreateData = {
    name,
    denomination,
    jurisdiction,
    diocese,
    foundedYear,
    about,
    languages,
    address,
    city,
    state,
    country,
    postalCode,
    latitude,
    longitude,
    timezone,
    phone,
    contactEmail,
    website,
    imageURL,
    coverImageURL,
    clergy: [],
    serviceSchedule: [],
    socialMedia: { instagram: '', facebook: '', youtube: '' },
    taxReceiptSettings,
    isActive: true,
    isVerified: false,
    createdAt: FieldValue.serverTimestamp(),
    createdBy: request.auth!.uid,
  };

  while (true) {
    try {
      await db.collection('churches').doc(finalId).create(churchCreateData);
      break;
    } catch (error) {
      if (!isAlreadyExistsError(error)) {
        throw error;
      }
      attempt++;
      finalId = `${slug}-${attempt}`;
    }
  }

  await logAuditEvent(request.auth!.uid, 'createChurch', {
    churchId: finalId,
    name,
    taxReceiptSettings: taxReceiptSettingsAuditSummary(taxReceiptSettings),
  });

  return { success: true, churchId: finalId };
});

export const setChurchActiveState = onCall({ ...replayProtectedCallableOptions, secrets: [] }, async (request) => {
  assertFreshAppCheck(request);
  assertSuperAdmin(request);

  const { churchId: rawChurchId, isActive: rawIsActive } = callableDataRecord(request.data);
  const churchId = assertNonEmptyString(rawChurchId, 128, 'churchId');
  const isActive = assertBoolean(rawIsActive, 'isActive');

  const churchRef = db.collection('churches').doc(churchId);
  const snap = await churchRef.get();
  if (!snap.exists) {
    throw new HttpsError('not-found', 'Church not found.');
  }

  await churchRef.update({ isActive });
  await updateChurchMembershipFanout(churchId, { churchActive: isActive });
  await logAuditEvent(request.auth!.uid, 'setChurchActiveState', { churchId, isActive });

  return { success: true, churchId, isActive };
});

export const assignChurchMembershipAsSuperAdmin = onCall({ ...replayProtectedCallableOptions, secrets: [] }, async (request) => {
  assertFreshAppCheck(request);
  assertSuperAdmin(request);

  const { churchId: rawChurchId, email: rawEmail, role: rawRole } = callableDataRecord(request.data);
  const churchId = assertNonEmptyString(rawChurchId, 128, 'churchId');
  const email = assertEmail(assertNonEmptyString(rawEmail, 254, 'email'), 'email');

  if (rawRole !== 'priest' && rawRole !== 'treasurer' && rawRole !== 'admin' && rawRole !== 'member') {
    throw new HttpsError('invalid-argument', 'role must be priest, treasurer, admin, or member.');
  }
  const role = rawRole as 'priest' | 'treasurer' | 'admin' | 'member';

  const [churchDoc, targetUser] = await Promise.all([
    db.collection('churches').doc(churchId).get(),
    auth.getUserByEmail(email).catch((error) => {
      if ((error as { code?: string }).code === 'auth/user-not-found') {
        return null;
      }
      throw error;
    }),
  ]);

  if (!churchDoc.exists) {
    throw new HttpsError('not-found', 'Church not found.');
  }
  if (!targetUser) {
    throw new HttpsError('not-found', 'No Kandilo user exists for that email address.');
  }
  if (targetUser.disabled) {
    throw new HttpsError('failed-precondition', 'Cannot assign a disabled user.');
  }

  const church = churchDoc.data()!;
  const now = FieldValue.serverTimestamp();
  const location = getChurchLocation(church);
  const displayName = targetUser.displayName ?? targetUser.email ?? email;
  const photoURL = targetUser.photoURL ?? '';

  const memberRef = db.collection('churches').doc(churchId).collection('members').doc(targetUser.uid);
  const userMembershipRef = db
    .collection('users')
    .doc(targetUser.uid)
    .collection('churchMemberships')
    .doc(churchId);
  const [existingMember, existingUserMembership] = await Promise.all([
    memberRef.get(),
    userMembershipRef.get(),
  ]);

  const batch = db.batch();
  batch.set(
    memberRef,
    {
      userId: targetUser.uid,
      churchId,
      role,
      status: 'active',
      displayName,
      email: targetUser.email ?? email,
      photoURL,
      joinedAt: existingMember.data()?.joinedAt ?? now,
      assignedBy: request.auth!.uid,
      updatedAt: now,
    },
    { merge: true }
  );
  batch.set(
    userMembershipRef,
    {
      churchId,
      churchName: church.name ?? '',
      location,
      imageURL: church.imageURL ?? '',
      role,
      status: 'active',
      churchActive: church.isActive === true,
      joinedAt: existingUserMembership.data()?.joinedAt ?? now,
      assignedBy: request.auth!.uid,
      updatedAt: now,
    },
    { merge: true }
  );
  await batch.commit();

  await logAuditEvent(request.auth!.uid, 'assignChurchMembershipAsSuperAdmin', {
    churchId,
    targetUid: targetUser.uid,
    role,
  });

  return {
    success: true,
    churchId,
    uid: targetUser.uid,
    email: targetUser.email ?? email,
    role,
    emailVerified: targetUser.emailVerified,
  };
});

export const updateChurchAsSuperAdmin = onCall({ ...replayProtectedCallableOptions, secrets: [] }, async (request) => {
  assertFreshAppCheck(request);
  assertSuperAdmin(request);

  const { churchId: rawChurchId, updates } = callableDataRecord(request.data);
  const churchId = assertNonEmptyString(rawChurchId, 128, 'churchId');

  if (!updates || typeof updates !== 'object' || Array.isArray(updates)) {
    throw new HttpsError('invalid-argument', 'churchId and updates object are required.');
  }

  const CHURCH_UPDATABLE_FIELDS = new Set([
    'name', 'denomination', 'jurisdiction', 'diocese', 'foundedYear', 'about', 'languages',
    'address', 'city', 'state', 'country', 'postalCode', 'latitude', 'longitude', 'timezone',
    'phone', 'contactEmail', 'website', 'imageURL', 'coverImageURL',
    'clergy', 'serviceSchedule', 'socialMedia',
    'taxReceiptSettings',
    'isActive', 'isVerified',
  ]);

  const stringFieldLimits: Record<string, number> = {
    name: 200, denomination: 200, jurisdiction: 300, diocese: 300, about: 5000,
    address: 500, city: 100, state: 100, country: 10, postalCode: 20,
    timezone: 50, phone: 30,
  };

  const safeUpdates: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(updates as Record<string, unknown>)) {
    if (!CHURCH_UPDATABLE_FIELDS.has(key)) {
      continue;
    }

    if (key in stringFieldLimits) {
      safeUpdates[key] = optionalString(value, stringFieldLimits[key], key);
      continue;
    }

    if (key === 'contactEmail') {
      const contactEmail = optionalString(value, 254, 'contactEmail');
      safeUpdates.contactEmail = contactEmail ? assertEmail(contactEmail, 'contactEmail') : '';
      continue;
    }

    if (key === 'website' || key === 'imageURL' || key === 'coverImageURL') {
      safeUpdates[key] = optionalHttpsUrl(value, 2000, key);
      continue;
    }

    if (key === 'languages') {
      safeUpdates.languages = optionalLanguageList(value);
      continue;
    }

    if (key === 'foundedYear') {
      const foundedYear = optionalFiniteNumber(value, 'foundedYear');
      validateFoundedYear(foundedYear);
      safeUpdates.foundedYear = foundedYear;
      continue;
    }

    if (key === 'latitude') {
      const latitude = optionalFiniteNumber(value, 'latitude');
      validateLatitude(latitude);
      safeUpdates.latitude = latitude;
      continue;
    }

    if (key === 'longitude') {
      const longitude = optionalFiniteNumber(value, 'longitude');
      validateLongitude(longitude);
      safeUpdates.longitude = longitude;
      continue;
    }

    if (key === 'isActive' || key === 'isVerified') {
      safeUpdates[key] = assertBoolean(value, key);
      continue;
    }

    if (key === 'clergy') {
      safeUpdates.clergy = optionalClergyList(value);
      continue;
    }

    if (key === 'serviceSchedule') {
      safeUpdates.serviceSchedule = optionalServiceSchedule(value);
      continue;
    }

    if (key === 'socialMedia') {
      safeUpdates.socialMedia = optionalSocialMedia(value);
      continue;
    }

    if (key === 'taxReceiptSettings') {
      safeUpdates.taxReceiptSettings = optionalTaxReceiptSettings(value);
    }
  }

  if (Object.keys(safeUpdates).length === 0) {
    throw new HttpsError('invalid-argument', 'No updatable fields provided.');
  }

  const churchRef = db.collection('churches').doc(churchId);
  const churchSnap = await churchRef.get();
  if (!churchSnap.exists) {
    throw new HttpsError('not-found', 'Church not found.');
  }
  const nextChurch = {
    ...(churchSnap.data() ?? {}),
    ...safeUpdates,
  };

  await churchRef.update(safeUpdates);
  await updateChurchMembershipFanout(
    churchId,
    buildChurchMembershipFanoutPatch(nextChurch, new Set(Object.keys(safeUpdates)))
  );
  const auditDetails: Record<string, unknown> = { churchId, fields: Object.keys(safeUpdates) };
  if (Object.prototype.hasOwnProperty.call(safeUpdates, 'taxReceiptSettings')) {
    auditDetails.taxReceiptSettings = {
      previous: taxReceiptSettingsAuditSummary(churchSnap.data()?.taxReceiptSettings),
      next: taxReceiptSettingsAuditSummary(safeUpdates.taxReceiptSettings),
    };
  }
  await logAuditEvent(request.auth!.uid, 'updateChurchAsSuperAdmin', auditDetails);

  return { success: true };
});

export const promoteSuperAdmin = onCall({ ...replayProtectedCallableOptions, secrets: [] }, async (request) => {
  assertFreshAppCheck(request);
  assertSuperAdmin(request);

  const { targetUid: rawTargetUid } = callableDataRecord(request.data);
  const targetUid = assertNonEmptyString(rawTargetUid, 128, 'targetUid');

  const targetUser = await auth.getUser(targetUid);
  if (targetUser.disabled) {
    throw new HttpsError('failed-precondition', 'Cannot promote a disabled user.');
  }
  if (!targetUser.emailVerified) {
    throw new HttpsError('failed-precondition', 'Target user must have a verified email address.');
  }
  const existing = targetUser.customClaims ?? {};
  await auth.setCustomUserClaims(targetUid, { ...existing, superAdmin: true });

  await logAuditEvent(request.auth!.uid, 'promoteSuperAdmin', { targetUid });

  return { success: true };
});
