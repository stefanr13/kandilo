import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TAX_GOODS_SERVICES_STATEMENT,
} from '../../domain/church';
import {
  buildChurchInput,
  buildChurchPaymentSettingsInput,
  buildEditChurchForm,
  hasRequiredStripeConnectDetails,
  hasRequiredTaxReceiptDetails,
  mergeChurchPaymentSettingsForm,
  stripeConnectAccountCreationBlocker,
  taxReceiptDetailsBlocker,
} from './missionControlForm';

describe('mission control church form mapping', () => {
  it('builds numeric and array fields from string form values', () => {
    expect(
      buildChurchInput({
        name: 'St. George',
        denomination: 'Eastern Orthodox',
        jurisdiction: 'OCA',
        diocese: 'West',
        foundedYear: '1985',
        about: 'About',
        languages: 'English, Serbian',
        address: '123 Main St',
        city: 'Denver',
        state: 'CO',
        country: 'US',
        postalCode: '80202',
        latitude: '39.7392',
        longitude: '-104.9903',
        timezone: 'America/Denver',
        phone: '123',
        contactEmail: 'office@example.com',
        website: 'https://example.com',
        imageURL: 'https://example.com/thumb.jpg',
        coverImageURL: 'https://example.com/cover.jpg',
        stripeConnectEnabled: 'true',
        stripeConnectAccountId: 'acct_test123456',
        taxReceiptsEnabled: 'true',
        taxReceiptJurisdiction: 'US',
        taxReceiptEligibilityConfirmed: 'true',
        taxReceiptOrganizationName: 'St. George Orthodox Church',
        taxReceiptOrganizationAddress: '123 Main St, Denver, CO',
        taxReceiptTaxId: '12-3456789',
        taxReceiptPrefix: 'STG',
        taxReceiptGoodsServicesStatement: 'No goods or services were provided.',
        taxReceiptAutoIssue: 'true',
        taxReceiptAnnualPreparationEnabled: 'true',
        taxReceiptAnnualAutoEmailEnabled: 'true',
        taxReceiptIssueLocation: 'Denver, Colorado',
        taxReceiptAuthorizedSignerName: 'Fr. George',
        taxReceiptAuthorizedSignerTitle: 'Parish Priest',
        taxReceiptSecureElectronicSignatureConfigured: 'true',
        taxReceiptCopiesRetentionConfirmed: 'true',
      })
    ).toEqual({
      name: 'St. George',
      denomination: 'Eastern Orthodox',
      jurisdiction: 'OCA',
      diocese: 'West',
      foundedYear: 1985,
      about: 'About',
      languages: ['English', 'Serbian'],
      address: '123 Main St',
      city: 'Denver',
      state: 'CO',
      country: 'US',
      postalCode: '80202',
      latitude: 39.7392,
      longitude: -104.9903,
      timezone: 'America/Denver',
      phone: '123',
      contactEmail: 'office@example.com',
      website: 'https://example.com',
      imageURL: 'https://example.com/thumb.jpg',
      coverImageURL: 'https://example.com/cover.jpg',
      taxReceiptSettings: {
        enabled: true,
        jurisdiction: 'US',
        eligibilityConfirmed: true,
        organizationName: 'St. George Orthodox Church',
        organizationAddress: '123 Main St, Denver, CO',
        taxId: '12-3456789',
        receiptPrefix: 'STG',
        goodsServicesStatement: 'No goods or services were provided.',
        autoIssue: true,
        annualPreparationEnabled: true,
        annualAutoEmailEnabled: true,
        receiptIssueLocation: 'Denver, Colorado',
        authorizedSignerName: 'Fr. George',
        authorizedSignerTitle: 'Parish Priest',
        secureElectronicSignatureConfigured: true,
        receiptCopiesRetentionConfirmed: true,
      },
    });
  });

  it('hydrates edit form values from a full church summary', () => {
    expect(
      buildEditChurchForm({
        id: 'church-1',
        name: 'St. Nicholas',
        location: 'Chicago, IL',
        imageURL: 'https://example.com/thumb.jpg',
        coverImageURL: 'https://example.com/cover.jpg',
        denomination: 'Eastern Orthodox',
        jurisdiction: 'OCA',
        diocese: 'Midwest',
        foundedYear: 1920,
        about: 'Historic parish',
        languages: ['English', 'Romanian'],
        address: '1 Church St',
        city: 'Chicago',
        state: 'IL',
        country: 'US',
        postalCode: '60601',
        latitude: 41.8818,
        longitude: -87.6231,
        timezone: 'America/Chicago',
        phone: '123',
        contactEmail: 'office@example.com',
        website: 'https://example.com',
        clergy: [],
        serviceSchedule: [],
        socialMedia: { instagram: '', facebook: '', youtube: '' },
        taxReceiptSettings: {
          enabled: true,
          jurisdiction: 'US',
          eligibilityConfirmed: true,
          organizationName: 'St. Nicholas Orthodox Church',
          organizationAddress: '1 Church St, Chicago, IL',
          taxId: '98-7654321',
          receiptPrefix: 'STN',
          goodsServicesStatement: 'No goods or services were provided.',
          autoIssue: false,
          annualPreparationEnabled: true,
          annualAutoEmailEnabled: true,
          receiptIssueLocation: 'Chicago, Illinois',
          authorizedSignerName: 'Fr. Nicholas',
          authorizedSignerTitle: 'Rector',
          secureElectronicSignatureConfigured: true,
          receiptCopiesRetentionConfirmed: true,
        },
        isVerified: true,
        isActive: true,
        showSaintDays: false,
      })
    ).toMatchObject({
      name: 'St. Nicholas',
      jurisdiction: 'OCA',
      diocese: 'Midwest',
      languages: 'English, Romanian',
      address: '1 Church St',
      city: 'Chicago',
      state: 'IL',
      country: 'US',
      postalCode: '60601',
      latitude: '41.8818',
      longitude: '-87.6231',
      timezone: 'America/Chicago',
      phone: '123',
      contactEmail: 'office@example.com',
      website: 'https://example.com',
      imageURL: 'https://example.com/thumb.jpg',
      coverImageURL: 'https://example.com/cover.jpg',
      stripeConnectEnabled: 'false',
      stripeConnectAccountId: '',
      taxReceiptsEnabled: 'true',
      taxReceiptEligibilityConfirmed: 'true',
      taxReceiptOrganizationName: 'St. Nicholas Orthodox Church',
      taxReceiptAutoIssue: 'false',
      taxReceiptAnnualPreparationEnabled: 'true',
      taxReceiptAnnualAutoEmailEnabled: 'true',
      taxReceiptIssueLocation: 'Chicago, Illinois',
      taxReceiptAuthorizedSignerName: 'Fr. Nicholas',
      taxReceiptAuthorizedSignerTitle: 'Rector',
      taxReceiptSecureElectronicSignatureConfigured: 'true',
      taxReceiptCopiesRetentionConfirmed: 'true',
    });
  });

  it('requires legal receipt details before enabled tax receipts can be saved', () => {
    const base = {
      name: 'St. George',
      denomination: 'Eastern Orthodox',
      jurisdiction: 'OCA',
      diocese: 'West',
      foundedYear: '1985',
      about: '',
      languages: 'English',
      address: '123 Main St',
      city: 'Denver',
      state: 'CO',
      country: 'US',
      postalCode: '80202',
      latitude: '39.7392',
      longitude: '-104.9903',
      timezone: 'America/Denver',
      phone: '',
      contactEmail: 'office@example.com',
      website: '',
      imageURL: '',
      coverImageURL: '',
      stripeConnectEnabled: 'false',
      stripeConnectAccountId: '',
      taxReceiptsEnabled: 'true',
      taxReceiptJurisdiction: 'US',
      taxReceiptEligibilityConfirmed: 'true',
      taxReceiptOrganizationName: 'St. George Orthodox Church',
      taxReceiptOrganizationAddress: '123 Main St, Denver, CO',
      taxReceiptTaxId: '12-3456789',
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

    expect(hasRequiredTaxReceiptDetails(base)).toBe(true);
    expect(buildChurchInput(base).taxReceiptSettings.goodsServicesStatement)
      .toBe(DEFAULT_TAX_GOODS_SERVICES_STATEMENT);
    expect(hasRequiredTaxReceiptDetails({ ...base, taxReceiptEligibilityConfirmed: 'false' })).toBe(false);
    expect(taxReceiptDetailsBlocker({ ...base, taxReceiptEligibilityConfirmed: 'false' }))
      .toContain('SuperAdmin eligibility attestation');
    expect(hasRequiredTaxReceiptDetails({ ...base, taxReceiptOrganizationAddress: '' })).toBe(false);
    expect(hasRequiredTaxReceiptDetails({ ...base, taxReceiptTaxId: '   ' })).toBe(false);
    expect(hasRequiredTaxReceiptDetails({ ...base, taxReceiptJurisdiction: 'CA' })).toBe(false);
    expect(taxReceiptDetailsBlocker({ ...base, taxReceiptJurisdiction: 'CA' }))
      .toContain('staged only while receipt issuing is disabled');
    expect(hasRequiredTaxReceiptDetails({
      ...base,
      taxReceiptsEnabled: 'false',
      taxReceiptEligibilityConfirmed: 'false',
      taxReceiptOrganizationName: '',
      taxReceiptOrganizationAddress: '',
      taxReceiptTaxId: '',
    })).toBe(true);
    expect(buildChurchInput({
      ...base,
      taxReceiptsEnabled: 'false',
      taxReceiptAnnualPreparationEnabled: 'true',
      taxReceiptAnnualAutoEmailEnabled: 'true',
    }).taxReceiptSettings.annualPreparationEnabled).toBe(false);
    expect(buildChurchInput({
      ...base,
      taxReceiptAnnualPreparationEnabled: 'false',
      taxReceiptAnnualAutoEmailEnabled: 'true',
    }).taxReceiptSettings.annualAutoEmailEnabled).toBe(false);
    expect(taxReceiptDetailsBlocker({
      ...base,
      taxReceiptsEnabled: 'false',
      taxReceiptEligibilityConfirmed: 'false',
      taxReceiptOrganizationName: '',
      taxReceiptOrganizationAddress: '',
      taxReceiptTaxId: '',
    })).toBe('');
  });

  it('maps Canada CRA staging fields while keeping enabled Canada issuance blocked', () => {
    const form = {
      name: 'St. George',
      denomination: 'Eastern Orthodox',
      jurisdiction: 'OCA',
      diocese: 'West',
      foundedYear: '1985',
      about: '',
      languages: 'English',
      address: '123 Main St',
      city: 'Edmonton',
      state: 'AB',
      country: 'CA',
      postalCode: 'T5J 0N3',
      latitude: '53.5461',
      longitude: '-113.4938',
      timezone: 'America/Edmonton',
      phone: '',
      contactEmail: 'office@example.ca',
      website: '',
      imageURL: '',
      coverImageURL: '',
      stripeConnectEnabled: 'false',
      stripeConnectAccountId: '',
      taxReceiptsEnabled: 'false',
      taxReceiptJurisdiction: 'CA',
      taxReceiptEligibilityConfirmed: 'false',
      taxReceiptOrganizationName: 'St. George Orthodox Church',
      taxReceiptOrganizationAddress: '123 Main St, Edmonton, AB',
      taxReceiptTaxId: '12345 6789 RR0001',
      taxReceiptPrefix: 'STG',
      taxReceiptGoodsServicesStatement: 'No advantage was provided.',
      taxReceiptAutoIssue: 'true',
      taxReceiptAnnualPreparationEnabled: 'true',
      taxReceiptAnnualAutoEmailEnabled: 'false',
      taxReceiptIssueLocation: ' Edmonton, Alberta ',
      taxReceiptAuthorizedSignerName: ' Fr. George ',
      taxReceiptAuthorizedSignerTitle: ' Parish Priest ',
      taxReceiptSecureElectronicSignatureConfigured: 'true',
      taxReceiptCopiesRetentionConfirmed: 'true',
    };

    expect(buildChurchInput(form).taxReceiptSettings).toMatchObject({
      enabled: false,
      jurisdiction: 'CA',
      receiptIssueLocation: 'Edmonton, Alberta',
      authorizedSignerName: 'Fr. George',
      authorizedSignerTitle: 'Parish Priest',
      annualPreparationEnabled: false,
      annualAutoEmailEnabled: false,
      secureElectronicSignatureConfigured: true,
      receiptCopiesRetentionConfirmed: true,
    });
    expect(hasRequiredTaxReceiptDetails({ ...form, taxReceiptsEnabled: 'true' })).toBe(false);
  });

  it('keeps Stripe Connect settings out of public church input and maps them separately', () => {
    const form = {
      name: 'St. George',
      denomination: 'Eastern Orthodox',
      jurisdiction: 'OCA',
      diocese: 'West',
      foundedYear: '1985',
      about: '',
      languages: 'English',
      address: '123 Main St',
      city: 'Denver',
      state: 'CO',
      country: 'US',
      postalCode: '80202',
      latitude: '39.7392',
      longitude: '-104.9903',
      timezone: 'America/Denver',
      phone: '',
      contactEmail: 'office@example.com',
      website: '',
      imageURL: '',
      coverImageURL: '',
      stripeConnectEnabled: 'true',
      stripeConnectAccountId: ' acct_test123456 ',
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

    expect(JSON.stringify(buildChurchInput(form))).not.toContain('acct_test123456');
    expect(buildChurchPaymentSettingsInput(form)).toEqual({
      stripeConnectEnabled: true,
      stripeConnectAccountId: 'acct_test123456',
      stripeConnectAccountApi: 'v2',
    });
    expect(hasRequiredStripeConnectDetails(form)).toBe(true);
    expect(hasRequiredStripeConnectDetails({ ...form, stripeConnectAccountId: 'not_an_account' })).toBe(false);
    expect(hasRequiredStripeConnectDetails({
      ...form,
      stripeConnectEnabled: 'false',
      stripeConnectAccountId: '',
    })).toBe(true);
  });

  it('keeps in-app Stripe account creation pinned to Accounts v2 in the sheet state', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'src/components/mission-control/ChurchFormSheet.tsx'),
      'utf8'
    );

    expect(source).toContain('Connected Account API');
    expect(source).toContain('Accounts v2 recipient');
    expect(source).toContain("stripeConnectAccountApi: 'v2'");
  });

  it('blocks in-app Stripe account creation until saved U.S. or Canadian contact details are ready', () => {
    const base = {
      name: 'St. George',
      denomination: 'Eastern Orthodox',
      jurisdiction: 'OCA',
      diocese: 'West',
      foundedYear: '1985',
      about: '',
      languages: 'English',
      address: '123 Main St',
      city: 'Denver',
      state: 'CO',
      country: 'US',
      postalCode: '80202',
      latitude: '39.7392',
      longitude: '-104.9903',
      timezone: 'America/Denver',
      phone: '',
      contactEmail: 'office@example.com',
      website: 'https://example.com',
      imageURL: '',
      coverImageURL: '',
      stripeConnectEnabled: 'false',
      stripeConnectAccountId: '',
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

    expect(stripeConnectAccountCreationBlocker(base, base)).toBe('');
    expect(stripeConnectAccountCreationBlocker({
      ...base,
      contactEmail: '',
    })).toBe('Save a valid church contact email before creating a Stripe account.');
    expect(stripeConnectAccountCreationBlocker({
      ...base,
      country: 'CA',
    }, {
      ...base,
      country: 'CA',
    })).toBe('');
    expect(stripeConnectAccountCreationBlocker({
      ...base,
      country: 'GB',
    })).toBe('In-app Stripe account creation currently supports U.S. and Canadian parishes only.');
    expect(stripeConnectAccountCreationBlocker({
      ...base,
      contactEmail: 'new-office@example.com',
    }, base)).toBe('Save church name, country, contact email, or website changes before creating a Stripe account.');
    expect(stripeConnectAccountCreationBlocker({
      ...base,
      stripeConnectAccountId: 'acct_test123456',
    }, base)).toBe('This church already has a Stripe connected account configured.');
  });

  it('merges private payment settings into the SuperAdmin edit form', () => {
    const base = buildEditChurchForm({
      id: 'church-1',
      name: 'St. Nicholas',
      location: 'Chicago, IL',
      imageURL: '',
      coverImageURL: '',
      denomination: 'Eastern Orthodox',
      jurisdiction: '',
      diocese: '',
      foundedYear: 0,
      about: '',
      languages: [],
      address: '',
      city: 'Chicago',
      state: 'IL',
      country: 'US',
      postalCode: '',
      latitude: 0,
      longitude: 0,
      timezone: 'America/Chicago',
      phone: '',
      contactEmail: 'office@example.com',
      website: '',
      clergy: [],
      serviceSchedule: [],
      socialMedia: { instagram: '', facebook: '', youtube: '' },
      taxReceiptSettings: {
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
      },
      isVerified: true,
      isActive: true,
      showSaintDays: false,
    });

    expect(mergeChurchPaymentSettingsForm(base, {
      churchId: 'church-1',
      stripeConnectEnabled: true,
      stripeConnectAccountId: 'acct_test123456',
      stripeConnectAccountApi: 'v1',
    })).toMatchObject({
      stripeConnectEnabled: 'true',
      stripeConnectAccountId: 'acct_test123456',
      stripeConnectAccountApi: 'v1',
    });
  });
});
