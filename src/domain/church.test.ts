import { describe, expect, it } from 'vitest';
import {
  buildChurchLocation,
  DEFAULT_TAX_GOODS_SERVICES_STATEMENT,
  donationCurrencyForChurchCountry,
  getTaxReceiptIssuanceState,
  isTaxReceiptIssuanceReady,
  mapChurchSummary,
  toChurch,
} from './church';

describe('church domain mapping', () => {
  it('builds a readable location with city and state fallback rules', () => {
    expect(buildChurchLocation({ city: 'Phoenix', state: 'AZ' })).toBe('Phoenix, AZ');
    expect(buildChurchLocation({ city: 'Phoenix', state: '', legacyLocation: 'Legacy' })).toBe(
      'Legacy'
    );
    expect(buildChurchLocation({ city: 'Phoenix', state: '' })).toBe('Phoenix');
  });

  it('maps raw church data into a normalized summary', () => {
    const church = mapChurchSummary('st-nicholas', {
      name: 'St. Nicholas',
      city: 'Chicago',
      state: 'IL',
      imageURL: 'https://example.com/thumb.jpg',
      socialMedia: { instagram: 'ig' },
      clergy: [{ name: 'Fr. John', title: 'Priest', photoURL: '', email: '', bio: '', isPrimary: true }],
    });

    expect(church.id).toBe('st-nicholas');
    expect(church.location).toBe('Chicago, IL');
    expect(church.coverImageURL).toBe('https://example.com/thumb.jpg');
    expect(church.socialMedia.facebook).toBe('');
    expect(church.clergy).toHaveLength(1);
    expect(church.isActive).toBe(false);
    expect(mapChurchSummary('active', { isActive: true }).isActive).toBe(true);
    expect(mapChurchSummary('receipt-default', {
      taxReceiptSettings: {
        enabled: true,
        jurisdiction: 'US',
        eligibilityConfirmed: true,
        organizationName: 'St. George Orthodox Church',
        organizationAddress: '123 Main St, Denver, CO',
        taxId: '12-3456789',
        goodsServicesStatement: '   ',
      },
    }).taxReceiptSettings.goodsServicesStatement).toBe(DEFAULT_TAX_GOODS_SERVICES_STATEMENT);
  });

  it('converts a church summary into the compact app church model', () => {
    expect(
      toChurch({
        id: 'abc',
        name: 'St. George',
        location: 'Denver, CO',
        imageURL: 'https://example.com/church.jpg',
      })
    ).toEqual({
      id: 'abc',
      name: 'St. George',
      location: 'Denver, CO',
      image: 'https://example.com/church.jpg',
    });
  });

  it('uses CAD donations for Canadian parishes and USD otherwise', () => {
    expect(donationCurrencyForChurchCountry('CA')).toBe('CAD');
    expect(donationCurrencyForChurchCountry(' ca ')).toBe('CAD');
    expect(donationCurrencyForChurchCountry('US')).toBe('USD');
    expect(donationCurrencyForChurchCountry('')).toBe('USD');
    expect(donationCurrencyForChurchCountry(undefined)).toBe('USD');
  });

  it('reports whether tax receipt settings are ready for issuance', () => {
    const readySettings = {
      enabled: true,
      jurisdiction: 'US' as const,
      eligibilityConfirmed: true,
      organizationName: 'St. Nicholas Orthodox Church',
      organizationAddress: '123 Church Street, Chicago, IL',
      taxId: '12-3456789',
      receiptPrefix: 'STN',
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

    expect(getTaxReceiptIssuanceState(null)).toBe('disabled');
    expect(getTaxReceiptIssuanceState({ ...readySettings, enabled: false })).toBe('disabled');
    expect(getTaxReceiptIssuanceState({
      ...readySettings,
      enabled: false,
      jurisdiction: 'CA',
    })).toBe('unsupported_jurisdiction');
    expect(getTaxReceiptIssuanceState({ ...readySettings, jurisdiction: 'CA' })).toBe(
      'unsupported_jurisdiction'
    );
    expect(getTaxReceiptIssuanceState({ ...readySettings, taxId: '   ' })).toBe(
      'missing_required_details'
    );
    expect(getTaxReceiptIssuanceState({ ...readySettings, eligibilityConfirmed: false })).toBe(
      'eligibility_unconfirmed'
    );
    expect(getTaxReceiptIssuanceState(readySettings)).toBe('ready');
    expect(isTaxReceiptIssuanceReady(readySettings)).toBe(true);
    expect(isTaxReceiptIssuanceReady({ ...readySettings, eligibilityConfirmed: false })).toBe(false);
    expect(isTaxReceiptIssuanceReady({ ...readySettings, organizationAddress: '' })).toBe(false);
  });
});
