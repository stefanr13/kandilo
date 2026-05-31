import type { FieldValue, Timestamp } from 'firebase/firestore';

export type Role = 'priest' | 'treasurer' | 'admin' | 'member';
export type MembershipStatus = 'active' | 'pending' | 'suspended';

export interface Church {
  id: string;
  name: string;
  location: string;
  image: string;
}

export interface ClergyMember {
  name: string;
  title: string;
  photoURL: string;
  email: string;
  bio: string;
  isPrimary: boolean;
}

export interface ServiceScheduleEntry {
  day: string;
  name: string;
  time: string;
  notes: string;
}

export interface ChurchSocialMedia {
  instagram: string;
  facebook: string;
  youtube: string;
}

export interface ChurchTaxReceiptSettings {
  enabled: boolean;
  jurisdiction: 'US' | 'CA';
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
}

export interface ChurchPaymentSettings {
  churchId: string;
  stripeConnectEnabled: boolean;
  stripeConnectAccountId: string;
  stripeConnectAccountApi: 'v1' | 'v2';
}

export interface ChurchPaymentSettingsInput {
  stripeConnectEnabled: boolean;
  stripeConnectAccountId: string;
  stripeConnectAccountApi: 'v1' | 'v2';
}

export interface ChurchStripeConnectOnboardingLink {
  success: boolean;
  url: string;
  expiresAtMillis: number | null;
}

export interface ChurchStripeConnectAccountCreationResult {
  success: boolean;
  churchId: string;
  stripeConnectEnabled: boolean;
  stripeConnectAccountId: string;
  stripeConnectAccountApi: 'v2';
}

export interface ChurchStripeConnectSetupStatus {
  churchId: string;
  stripeConnectAccountConfigured: boolean;
  stripeConnectRoutingEnabled: boolean;
  stripeConnectAccountApi: 'v1' | 'v2' | 'not_configured';
}

export interface ChurchEditableFields {
  name: string;
  denomination: string;
  jurisdiction: string;
  diocese: string;
  foundedYear: number;
  about: string;
  languages: string[];
  address: string;
  city: string;
  state: string;
  country: string;
  postalCode: string;
  latitude: number;
  longitude: number;
  timezone: string;
  phone: string;
  contactEmail: string;
  website: string;
  imageURL: string;
  coverImageURL: string;
  clergy: ClergyMember[];
  serviceSchedule: ServiceScheduleEntry[];
  socialMedia: ChurchSocialMedia;
  taxReceiptSettings: ChurchTaxReceiptSettings;
  /** Whether to display Orthodox saint days in the calendar and home screen. Off by default. */
  showSaintDays: boolean;
}

export interface ChurchDoc extends ChurchEditableFields {
  createdAt: Timestamp | FieldValue;
  createdBy: string;
  isVerified: boolean;
  isActive: boolean;
}

export interface ChurchSummary extends ChurchEditableFields {
  id: string;
  location: string;
  isVerified: boolean;
  isActive: boolean;
}

export type SuperAdminChurchInput = Omit<
  ChurchEditableFields,
  'clergy' | 'serviceSchedule' | 'socialMedia' | 'showSaintDays'
>;

export interface SuperAdminChurchStats {
  churchId: string;
  name: string;
  city: string;
  state: string;
  denomination: string;
  isActive: boolean;
  isVerified: boolean;
  foundedYear: number;
  memberCount: number;
  priestCount: number;
  treasurerCount: number;
  adminCount: number;
  donationTotal: number;
  eventCount: number;
  newsletterCount: number;
  imageURL: string;
}

export interface SuperAdminTaxReceiptAuditEvent {
  id: string;
  action: string;
  actorUid: string;
  churchId: string;
  churchName: string;
  receiptId: string;
  kind: string;
  receiptYear: number | null;
  annualYear: number | null;
  errorCode: string;
  reasonCode: string;
  reviewCount: number | null;
  createdAtMillis: number | null;
}

export interface SuperAdminPaymentOperationsReadiness {
  checkedAtMillis: number;
  appUrl: {
    configured: boolean;
    value: string;
    usesHttps: boolean;
    runtimeValid: boolean;
    errorCode: string;
  };
  stripeSecretKey: {
    configured: boolean;
    mode: 'live' | 'test' | 'unknown' | 'not_configured';
  };
  stripeWebhookSecret: {
    configured: boolean;
    formatValid: boolean;
  };
  stripeApiVersion: string;
  stripeWebhookEndpoint: {
    checked: boolean;
    ready: boolean;
    configured: boolean;
    liveMode: boolean;
    enabled: boolean;
    duplicateCount: number;
    apiVersionMatches: boolean;
    requiredEventsConfigured: boolean;
    explicitEventsOnly: boolean;
    noUnexpectedEvents: boolean;
    missingEventCount: number;
    unexpectedEventCount: number;
    errorCode: string;
  };
  resendApiKey: {
    configured: boolean;
    formatValid: boolean;
  };
  resendDomain: {
    checked: boolean;
    domain: string;
    configured: boolean;
    verified: boolean;
    status: string;
    duplicateCount: number;
    errorCode: string;
  };
  stripeAccount: {
    checked: boolean;
    ready: boolean;
    chargesEnabled: boolean;
    payoutsEnabled: boolean;
    detailsSubmitted: boolean;
    country: string;
    defaultCurrency: string;
    disabledReason: string;
    currentlyDueCount: number;
    pastDueCount: number;
    eventuallyDueCount: number;
    futureCurrentlyDueCount: number;
    futurePastDueCount: number;
    futureEventuallyDueCount: number;
    errorCode: string;
  };
  webhookUrl: string;
  webhookActivity: {
    checkedEventCount: number;
    checkedLiveEventCount: number;
    smokeFreshnessWindowHours: number;
    latestProcessedAtMillis: number | null;
    latestLiveProcessedAtMillis: number | null;
    latestCheckoutCompletedAtMillis: number | null;
    latestLiveCheckoutCompletedAtMillis: number | null;
    latestType: string;
    latestStatus: string;
    latestLivemode: boolean | null;
    latestLiveType: string;
    latestLiveStatus: string;
    processedCount: number;
    liveProcessedCount: number;
    testProcessedCount: number;
    processedCheckoutCompletedCount: number;
    liveProcessedCheckoutCompletedCount: number;
    testProcessedCheckoutCompletedCount: number;
    checkoutSmokeFresh: boolean;
    liveCheckoutSmokeFresh: boolean;
    validationFailedCount: number;
    missingGivingCount: number;
    unpaidSessionCount: number;
    liveIssueCount: number;
    liveValidationFailedCount: number;
    liveMissingGivingCount: number;
    liveUnpaidSessionCount: number;
    latestLiveIssueAtMillis: number | null;
  };
  taxReceiptEmailSmoke: {
    checkedEventCount: number;
    smokeFreshnessWindowHours: number;
    checkedLiveCheckoutGivingCount: number;
    emailSentCount: number;
    liveEmailSentCount: number;
    latestEmailSentAtMillis: number | null;
    latestLiveEmailSentAtMillis: number | null;
    latestLiveCheckoutEmailSentAtMillis: number | null;
    latestLiveCheckoutGivingSentAtMillis: number | null;
    latestLiveCheckoutReceiptIssuedAtMillis: number | null;
    latestLiveCheckoutReceiptEmailSentAtMillis: number | null;
    latestLiveCheckoutReceiptPdfRetainedAtMillis: number | null;
    latestLiveCheckoutReceiptPdfObjectReady: boolean;
    emailSentFresh: boolean;
    liveEmailSentFresh: boolean;
    latestLiveCheckoutEmailSentFresh: boolean;
    latestLiveCheckoutReceiptArtifactReady: boolean;
    latestLiveCheckoutReceiptArtifactFresh: boolean;
    ready: boolean;
  };
  taxReceiptAnnualSmoke: {
    checkedEventCount: number;
    smokeFreshnessWindowHours: number;
    annualEmailSentCount: number;
    latestAnnualEmailSentAtMillis: number | null;
    latestAnnualReceiptIssuedAtMillis: number | null;
    latestAnnualReceiptEmailSentAtMillis: number | null;
    latestAnnualReceiptPdfRetainedAtMillis: number | null;
    latestAnnualReceiptPdfObjectReady: boolean;
    latestAnnualReceiptSummaryReady: boolean;
    latestAnnualReceiptContributionDetailReady: boolean;
    latestAnnualReceiptOriginalYearEndReady: boolean;
    latestAnnualReceiptCorrectedOrReissue: boolean;
    latestAnnualEmailSentFresh: boolean;
    latestAnnualReceiptArtifactReady: boolean;
    latestAnnualReceiptArtifactFresh: boolean;
    ready: boolean;
  };
  donationFlowReady: boolean;
  taxReceiptDeliveryReady: boolean;
  productionReady: boolean;
  warnings: string[];
}

export const EMPTY_CHURCH_SOCIAL_MEDIA: ChurchSocialMedia = {
  instagram: '',
  facebook: '',
  youtube: '',
};

export const DEFAULT_TAX_GOODS_SERVICES_STATEMENT =
  'No goods or services were provided in exchange for this contribution other than intangible religious benefits.';

export const EMPTY_TAX_RECEIPT_SETTINGS: ChurchTaxReceiptSettings = {
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

export type DonationCurrency = 'USD' | 'CAD';

export function donationCurrencyForChurchCountry(country: string | null | undefined): DonationCurrency {
  return country?.trim().toUpperCase() === 'CA' ? 'CAD' : 'USD';
}

export type TaxReceiptIssuanceState =
  | 'disabled'
  | 'unsupported_jurisdiction'
  | 'eligibility_unconfirmed'
  | 'missing_required_details'
  | 'ready';

export function getTaxReceiptIssuanceState(
  settings: ChurchTaxReceiptSettings | null | undefined
): TaxReceiptIssuanceState {
  if (!settings) {
    return 'disabled';
  }

  if (settings.jurisdiction !== 'US') {
    return 'unsupported_jurisdiction';
  }

  if (!settings.enabled) {
    return 'disabled';
  }

  if (!settings.eligibilityConfirmed) {
    return 'eligibility_unconfirmed';
  }

  if (
    !settings.organizationName.trim()
    || !settings.organizationAddress.trim()
    || !settings.taxId.trim()
  ) {
    return 'missing_required_details';
  }

  return 'ready';
}

export function isTaxReceiptIssuanceReady(
  settings: ChurchTaxReceiptSettings | null | undefined
): boolean {
  return getTaxReceiptIssuanceState(settings) === 'ready';
}

export function buildChurchLocation({
  city,
  state,
  legacyLocation,
}: {
  city: string;
  state: string;
  legacyLocation?: string;
}): string {
  if (legacyLocation) return legacyLocation;
  if (city && state) return `${city}, ${state}`;
  return city || state;
}

export function mapChurchSummary(
  id: string,
  data: Record<string, unknown>
): ChurchSummary {
  const city = typeof data.city === 'string' ? data.city : '';
  const state = typeof data.state === 'string' ? data.state : '';
  const legacyLocation = typeof data.location === 'string' ? data.location : '';
  const rawTaxReceiptSettings =
    typeof data.taxReceiptSettings === 'object' && data.taxReceiptSettings !== null
      ? data.taxReceiptSettings as Record<string, unknown>
      : {};
  const taxReceiptSettingsEnabled = rawTaxReceiptSettings.enabled === true;
  const taxReceiptJurisdiction = rawTaxReceiptSettings.jurisdiction === 'CA' ? 'CA' : 'US';
  const rawGoodsServicesStatement =
    typeof rawTaxReceiptSettings.goodsServicesStatement === 'string'
      ? rawTaxReceiptSettings.goodsServicesStatement.trim()
      : '';
  const goodsServicesStatement =
    taxReceiptSettingsEnabled && taxReceiptJurisdiction === 'US'
      ? rawGoodsServicesStatement || DEFAULT_TAX_GOODS_SERVICES_STATEMENT
      : rawGoodsServicesStatement;

  return {
    id,
    name: typeof data.name === 'string' ? data.name : '',
    location: buildChurchLocation({ city, state, legacyLocation }),
    imageURL: typeof data.imageURL === 'string' ? data.imageURL : '',
    coverImageURL:
      typeof data.coverImageURL === 'string'
        ? data.coverImageURL
        : typeof data.imageURL === 'string'
          ? data.imageURL
          : '',
    denomination: typeof data.denomination === 'string' ? data.denomination : '',
    jurisdiction: typeof data.jurisdiction === 'string' ? data.jurisdiction : '',
    diocese: typeof data.diocese === 'string' ? data.diocese : '',
    foundedYear: typeof data.foundedYear === 'number' ? data.foundedYear : 0,
    about: typeof data.about === 'string' ? data.about : '',
    languages: Array.isArray(data.languages)
      ? data.languages.filter((value): value is string => typeof value === 'string')
      : [],
    address: typeof data.address === 'string' ? data.address : '',
    city,
    state,
    country: typeof data.country === 'string' ? data.country : '',
    postalCode: typeof data.postalCode === 'string' ? data.postalCode : '',
    latitude: typeof data.latitude === 'number' ? data.latitude : 0,
    longitude: typeof data.longitude === 'number' ? data.longitude : 0,
    timezone: typeof data.timezone === 'string' ? data.timezone : '',
    phone: typeof data.phone === 'string' ? data.phone : '',
    contactEmail: typeof data.contactEmail === 'string' ? data.contactEmail : '',
    website: typeof data.website === 'string' ? data.website : '',
    clergy: Array.isArray(data.clergy)
      ? data.clergy.filter(
          (value): value is ClergyMember =>
            typeof value === 'object' && value !== null && typeof value.name === 'string'
        )
      : [],
    serviceSchedule: Array.isArray(data.serviceSchedule)
      ? data.serviceSchedule.filter(
          (value): value is ServiceScheduleEntry =>
            typeof value === 'object' && value !== null && typeof value.day === 'string'
        )
      : [],
    socialMedia:
      typeof data.socialMedia === 'object' && data.socialMedia !== null
        ? {
            instagram:
              typeof (data.socialMedia as Record<string, unknown>).instagram === 'string'
                ? (data.socialMedia as Record<string, string>).instagram
                : '',
            facebook:
              typeof (data.socialMedia as Record<string, unknown>).facebook === 'string'
                ? (data.socialMedia as Record<string, string>).facebook
                : '',
            youtube:
              typeof (data.socialMedia as Record<string, unknown>).youtube === 'string'
                ? (data.socialMedia as Record<string, string>).youtube
                : '',
          }
        : EMPTY_CHURCH_SOCIAL_MEDIA,
    taxReceiptSettings: {
      enabled: taxReceiptSettingsEnabled,
      jurisdiction: taxReceiptJurisdiction,
      eligibilityConfirmed: rawTaxReceiptSettings.eligibilityConfirmed === true,
      organizationName:
        typeof rawTaxReceiptSettings.organizationName === 'string'
          ? rawTaxReceiptSettings.organizationName
          : '',
      organizationAddress:
        typeof rawTaxReceiptSettings.organizationAddress === 'string'
          ? rawTaxReceiptSettings.organizationAddress
          : '',
      taxId: typeof rawTaxReceiptSettings.taxId === 'string' ? rawTaxReceiptSettings.taxId : '',
      receiptPrefix:
        typeof rawTaxReceiptSettings.receiptPrefix === 'string'
          ? rawTaxReceiptSettings.receiptPrefix
          : '',
      goodsServicesStatement,
      autoIssue: rawTaxReceiptSettings.autoIssue !== false,
      annualPreparationEnabled: rawTaxReceiptSettings.annualPreparationEnabled === true,
      annualAutoEmailEnabled:
        rawTaxReceiptSettings.annualPreparationEnabled === true
        && rawTaxReceiptSettings.annualAutoEmailEnabled === true,
      receiptIssueLocation:
        typeof rawTaxReceiptSettings.receiptIssueLocation === 'string'
          ? rawTaxReceiptSettings.receiptIssueLocation
          : '',
      authorizedSignerName:
        typeof rawTaxReceiptSettings.authorizedSignerName === 'string'
          ? rawTaxReceiptSettings.authorizedSignerName
          : '',
      authorizedSignerTitle:
        typeof rawTaxReceiptSettings.authorizedSignerTitle === 'string'
          ? rawTaxReceiptSettings.authorizedSignerTitle
          : '',
      secureElectronicSignatureConfigured:
        rawTaxReceiptSettings.secureElectronicSignatureConfigured === true,
      receiptCopiesRetentionConfirmed:
        rawTaxReceiptSettings.receiptCopiesRetentionConfirmed === true,
    },
    isVerified: data.isVerified === true,
    isActive: data.isActive === true,
    showSaintDays: data.showSaintDays === true,
  };
}

export function toChurch(
  summary: Pick<ChurchSummary, 'id' | 'name' | 'location' | 'imageURL'>
): Church {
  return {
    id: summary.id,
    name: summary.name,
    location: summary.location,
    image: summary.imageURL,
  };
}
