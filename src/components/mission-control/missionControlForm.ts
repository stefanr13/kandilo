import {
  ChurchPaymentSettings,
  ChurchPaymentSettingsInput,
  ChurchSummary,
  DEFAULT_TAX_GOODS_SERVICES_STATEMENT,
  SuperAdminChurchInput,
} from '../../domain/church';

export interface ChurchFormData {
  name: string;
  denomination: string;
  jurisdiction: string;
  diocese: string;
  foundedYear: string;
  about: string;
  languages: string;
  address: string;
  city: string;
  state: string;
  country: string;
  postalCode: string;
  latitude: string;
  longitude: string;
  timezone: string;
  phone: string;
  contactEmail: string;
  website: string;
  imageURL: string;
  coverImageURL: string;
  stripeConnectEnabled: string;
  stripeConnectAccountId: string;
  stripeConnectAccountApi?: string;
  taxReceiptsEnabled: string;
  taxReceiptJurisdiction: string;
  taxReceiptEligibilityConfirmed: string;
  taxReceiptOrganizationName: string;
  taxReceiptOrganizationAddress: string;
  taxReceiptTaxId: string;
  taxReceiptPrefix: string;
  taxReceiptGoodsServicesStatement: string;
  taxReceiptAutoIssue: string;
  taxReceiptAnnualPreparationEnabled: string;
  taxReceiptAnnualAutoEmailEnabled: string;
  taxReceiptIssueLocation: string;
  taxReceiptAuthorizedSignerName: string;
  taxReceiptAuthorizedSignerTitle: string;
  taxReceiptSecureElectronicSignatureConfigured: string;
  taxReceiptCopiesRetentionConfirmed: string;
}

export const EMPTY_CHURCH_FORM: ChurchFormData = {
  name: '',
  denomination: 'Eastern Orthodox',
  jurisdiction: '',
  diocese: '',
  foundedYear: '',
  about: '',
  languages: 'English',
  address: '',
  city: '',
  state: '',
  country: 'US',
  postalCode: '',
  latitude: '',
  longitude: '',
  timezone: 'America/New_York',
  phone: '',
  contactEmail: '',
  website: '',
  imageURL: '',
  coverImageURL: '',
  stripeConnectEnabled: 'false',
  stripeConnectAccountId: '',
  stripeConnectAccountApi: 'v2',
  taxReceiptsEnabled: 'false',
  taxReceiptJurisdiction: 'US',
  taxReceiptEligibilityConfirmed: 'false',
  taxReceiptOrganizationName: '',
  taxReceiptOrganizationAddress: '',
  taxReceiptTaxId: '',
  taxReceiptPrefix: '',
  taxReceiptGoodsServicesStatement: '',
  taxReceiptAutoIssue: 'true',
  taxReceiptAnnualPreparationEnabled: 'false',
  taxReceiptAnnualAutoEmailEnabled: 'false',
  taxReceiptIssueLocation: '',
  taxReceiptAuthorizedSignerName: '',
  taxReceiptAuthorizedSignerTitle: '',
  taxReceiptSecureElectronicSignatureConfigured: 'false',
  taxReceiptCopiesRetentionConfirmed: 'false',
};

export const CANADA_CRA_ELECTRONIC_RECEIPT_BLOCKER =
  'Canada/CRA receipts can be staged only while receipt issuing is disabled until Kandilo supports read-only/non-editable PDF receipts that are protected from unauthorized access, encrypted, electronically signed under authorized parish control, retained, and printable on request.';

export function buildChurchInput(form: ChurchFormData): SuperAdminChurchInput {
  const taxReceiptsEnabled = form.taxReceiptsEnabled === 'true';
  const taxReceiptJurisdiction = form.taxReceiptJurisdiction === 'CA' ? 'CA' : 'US';
  const annualPreparationEnabled =
    taxReceiptsEnabled
    && taxReceiptJurisdiction === 'US'
    && form.taxReceiptAnnualPreparationEnabled === 'true';
  const annualAutoEmailEnabled =
    annualPreparationEnabled && form.taxReceiptAnnualAutoEmailEnabled === 'true';

  return {
    name: form.name,
    denomination: form.denomination,
    jurisdiction: form.jurisdiction,
    diocese: form.diocese,
    foundedYear: Number.parseInt(form.foundedYear, 10) || 0,
    about: form.about,
    latitude: Number.parseFloat(form.latitude) || 0,
    longitude: Number.parseFloat(form.longitude) || 0,
    address: form.address,
    city: form.city,
    state: form.state,
    country: form.country,
    postalCode: form.postalCode,
    timezone: form.timezone,
    phone: form.phone,
    contactEmail: form.contactEmail,
    website: form.website,
    imageURL: form.imageURL,
    coverImageURL: form.coverImageURL,
    languages: form.languages.split(',').map((language) => language.trim()).filter(Boolean),
    taxReceiptSettings: {
      enabled: taxReceiptsEnabled,
      jurisdiction: taxReceiptJurisdiction,
      eligibilityConfirmed: form.taxReceiptEligibilityConfirmed === 'true',
      organizationName: form.taxReceiptOrganizationName.trim(),
      organizationAddress: form.taxReceiptOrganizationAddress.trim(),
      taxId: form.taxReceiptTaxId.trim(),
      receiptPrefix: form.taxReceiptPrefix.trim(),
      goodsServicesStatement:
        taxReceiptsEnabled && taxReceiptJurisdiction === 'US'
          ? form.taxReceiptGoodsServicesStatement.trim() || DEFAULT_TAX_GOODS_SERVICES_STATEMENT
          : form.taxReceiptGoodsServicesStatement.trim(),
      autoIssue: form.taxReceiptAutoIssue !== 'false',
      annualPreparationEnabled,
      annualAutoEmailEnabled,
      receiptIssueLocation: form.taxReceiptIssueLocation.trim(),
      authorizedSignerName: form.taxReceiptAuthorizedSignerName.trim(),
      authorizedSignerTitle: form.taxReceiptAuthorizedSignerTitle.trim(),
      secureElectronicSignatureConfigured:
        form.taxReceiptSecureElectronicSignatureConfigured === 'true',
      receiptCopiesRetentionConfirmed: form.taxReceiptCopiesRetentionConfirmed === 'true',
    },
  };
}

export function buildChurchPaymentSettingsInput(form: ChurchFormData): ChurchPaymentSettingsInput {
  return {
    stripeConnectEnabled: form.stripeConnectEnabled === 'true',
    stripeConnectAccountId: form.stripeConnectAccountId.trim(),
    stripeConnectAccountApi: form.stripeConnectAccountApi === 'v1' ? 'v1' : 'v2',
  };
}

export function hasRequiredStripeConnectDetails(form: ChurchFormData): boolean {
  if (form.stripeConnectEnabled !== 'true' && !form.stripeConnectAccountId.trim()) {
    return true;
  }
  return /^acct_[A-Za-z0-9]{8,64}$/.test(form.stripeConnectAccountId.trim());
}

function normalizedStripeConnectCreationSource(form: ChurchFormData) {
  return {
    name: form.name.trim(),
    country: form.country.trim().toUpperCase(),
    contactEmail: form.contactEmail.trim().toLowerCase(),
    website: form.website.trim(),
  };
}

export function validStripeConnectCreationContactEmail(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return normalized.length > 0
    && normalized.length <= 254
    && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(normalized);
}

export function stripeConnectAccountCreationBlocker(
  form: ChurchFormData,
  persistedForm?: ChurchFormData
): string {
  if (form.stripeConnectAccountId.trim()) {
    return 'This church already has a Stripe connected account configured.';
  }

  const source = normalizedStripeConnectCreationSource(form);
  const persistedSource = persistedForm
    ? normalizedStripeConnectCreationSource(persistedForm)
    : source;
  const hasUnsavedStripeSourceChange = source.name !== persistedSource.name
    || source.country !== persistedSource.country
    || source.contactEmail !== persistedSource.contactEmail
    || source.website !== persistedSource.website;

  if (hasUnsavedStripeSourceChange) {
    return 'Save church name, country, contact email, or website changes before creating a Stripe account.';
  }

  if (source.country !== 'US' && source.country !== 'CA') {
    return 'In-app Stripe account creation currently supports U.S. and Canadian parishes only.';
  }

  if (!validStripeConnectCreationContactEmail(source.contactEmail)) {
    return 'Save a valid church contact email before creating a Stripe account.';
  }

  return '';
}

export function hasRequiredTaxReceiptDetails(form: ChurchFormData): boolean {
  return taxReceiptDetailsBlocker(form) === '';
}

export function taxReceiptDetailsBlocker(form: ChurchFormData): string {
  if (form.taxReceiptsEnabled !== 'true') {
    return '';
  }
  if (form.taxReceiptJurisdiction === 'CA') {
    return CANADA_CRA_ELECTRONIC_RECEIPT_BLOCKER;
  }

  const missing: string[] = [];
  if (form.taxReceiptEligibilityConfirmed !== 'true') {
    missing.push('SuperAdmin eligibility attestation');
  }
  if (!form.taxReceiptOrganizationName.trim()) {
    missing.push('legal organization name');
  }
  if (!form.taxReceiptOrganizationAddress.trim()) {
    missing.push('receipt address');
  }
  if (!form.taxReceiptTaxId.trim()) {
    missing.push('tax ID');
  }

  return missing.length > 0
    ? `Enabled U.S. tax receipts require ${missing.join(', ')}.`
    : '';
}

export function buildEditChurchForm(church: ChurchSummary): ChurchFormData {
  return {
    name: church.name,
    denomination: church.denomination,
    jurisdiction: church.jurisdiction,
    diocese: church.diocese,
    foundedYear: String(church.foundedYear || ''),
    about: church.about,
    languages: church.languages.join(', '),
    address: church.address,
    city: church.city,
    state: church.state,
    country: church.country,
    postalCode: church.postalCode,
    latitude: church.latitude ? String(church.latitude) : '',
    longitude: church.longitude ? String(church.longitude) : '',
    timezone: church.timezone || 'America/New_York',
    phone: church.phone,
    contactEmail: church.contactEmail,
    website: church.website,
    imageURL: church.imageURL,
    coverImageURL: church.coverImageURL,
    stripeConnectEnabled: 'false',
    stripeConnectAccountId: '',
    taxReceiptsEnabled: church.taxReceiptSettings.enabled ? 'true' : 'false',
    taxReceiptJurisdiction: church.taxReceiptSettings.jurisdiction,
    taxReceiptEligibilityConfirmed: church.taxReceiptSettings.eligibilityConfirmed ? 'true' : 'false',
    taxReceiptOrganizationName: church.taxReceiptSettings.organizationName,
    taxReceiptOrganizationAddress: church.taxReceiptSettings.organizationAddress,
    taxReceiptTaxId: church.taxReceiptSettings.taxId,
    taxReceiptPrefix: church.taxReceiptSettings.receiptPrefix,
    taxReceiptGoodsServicesStatement: church.taxReceiptSettings.goodsServicesStatement,
    taxReceiptAutoIssue: church.taxReceiptSettings.autoIssue ? 'true' : 'false',
    taxReceiptAnnualPreparationEnabled: church.taxReceiptSettings.annualPreparationEnabled ? 'true' : 'false',
    taxReceiptAnnualAutoEmailEnabled: church.taxReceiptSettings.annualAutoEmailEnabled ? 'true' : 'false',
    taxReceiptIssueLocation: church.taxReceiptSettings.receiptIssueLocation,
    taxReceiptAuthorizedSignerName: church.taxReceiptSettings.authorizedSignerName,
    taxReceiptAuthorizedSignerTitle: church.taxReceiptSettings.authorizedSignerTitle,
    taxReceiptSecureElectronicSignatureConfigured:
      church.taxReceiptSettings.secureElectronicSignatureConfigured ? 'true' : 'false',
    taxReceiptCopiesRetentionConfirmed:
      church.taxReceiptSettings.receiptCopiesRetentionConfirmed ? 'true' : 'false',
  };
}

export function mergeChurchPaymentSettingsForm(
  form: ChurchFormData,
  settings: ChurchPaymentSettings
): ChurchFormData {
  return {
    ...form,
    stripeConnectEnabled: settings.stripeConnectEnabled ? 'true' : 'false',
    stripeConnectAccountId: settings.stripeConnectAccountId,
    stripeConnectAccountApi: settings.stripeConnectAccountApi,
  };
}
