import { describe, expect, it, vi } from 'vitest';
import {
  buildUserProfileRepairPatch,
  hasTaxReceiptAddressDetails,
  isTaxReceiptProfileComplete,
  sanitizeProfileInput,
  sanitizeTaxReceiptProfileInput,
} from './profile';

vi.mock('../firebase/firestore', () => ({ db: {} }));

describe('profile Firestore input helpers', () => {
  it('trims and bounds profile fields before fan-out writes', () => {
    const safe = sanitizeProfileInput({
      displayName: '  Ana Member  ',
      preferredLanguage: 'English',
      phone: '  555-0100  ',
      ministries: ['  Choir  ', '', '  Parish Council  '],
      description: '  Serves in choir.  ',
      showInDirectory: true,
      taxReceiptLegalName: '  Ana M. Petrov  ',
      taxReceiptAddress: {
        line1: '  10 Church St  ',
        line2: '  Apt 4  ',
        city: '  Chicago  ',
        region: '  IL  ',
        postalCode: '  60601  ',
        country: '  US  ',
      },
    });

    expect(safe).toMatchObject({
      displayName: 'Ana Member',
      phone: '555-0100',
      ministries: ['Choir', 'Parish Council'],
      description: 'Serves in choir.',
      showInDirectory: true,
      taxReceiptLegalName: 'Ana M. Petrov',
      taxReceiptAddress: {
        line1: '10 Church St',
        line2: 'Apt 4',
        city: 'Chicago',
        region: 'IL',
        postalCode: '60601',
        country: 'US',
      },
    });
  });

  it('rejects oversized profile values', () => {
    expect(() =>
      sanitizeProfileInput({
        displayName: 'a'.repeat(121),
        preferredLanguage: 'English',
        phone: '',
        ministries: [],
        description: '',
        showInDirectory: false,
        taxReceiptLegalName: '',
      })
    ).toThrow('Display name must be at most 120 characters.');

    expect(() =>
      sanitizeProfileInput({
        displayName: 'Ana',
        preferredLanguage: 'English',
        phone: '',
        ministries: ['a'.repeat(51)],
        description: '',
        showInDirectory: false,
        taxReceiptLegalName: '',
      })
    ).toThrow('Ministry must be at most 50 characters.');

    expect(() =>
      sanitizeProfileInput({
        displayName: 'Ana',
        preferredLanguage: 'English',
        phone: '',
        ministries: [],
        description: '',
        showInDirectory: false,
        taxReceiptLegalName: 'a'.repeat(161),
      })
    ).toThrow('Tax receipt legal name must be at most 160 characters.');
  });

  it('trims and bounds receipt-only profile updates without directory fields', () => {
    expect(sanitizeTaxReceiptProfileInput({
      taxReceiptLegalName: '  Ana M. Petrov  ',
      taxReceiptAddress: {
        line1: '  10 Church St  ',
        line2: '  Apt 4  ',
        city: '  Chicago  ',
        region: '  IL  ',
        postalCode: '  60601  ',
        country: '  US  ',
      },
    })).toEqual({
      taxReceiptLegalName: 'Ana M. Petrov',
      taxReceiptAddress: {
        line1: '10 Church St',
        line2: 'Apt 4',
        city: 'Chicago',
        region: 'IL',
        postalCode: '60601',
        country: 'US',
      },
    });

    expect(() =>
      sanitizeTaxReceiptProfileInput({
        taxReceiptLegalName: 'Ana',
        taxReceiptAddress: { line1: 'a'.repeat(161) },
      })
    ).toThrow('Tax receipt address line 1 must be at most 160 characters.');
  });

  it('backfills allowed defaults when repairing legacy profile documents', () => {
    expect(buildUserProfileRepairPatch(
      {
        email: 'ana@example.com',
        phone: 123,
        ministries: ['Choir', 'a'.repeat(51)],
        description: 'a'.repeat(1001),
        showInDirectory: 'yes',
        photoURL: 'http://example.com/avatar.png',
        taxReceiptLegalName: 'a'.repeat(161),
        taxReceiptAddress: { line1: '10 Church St', extra: true },
        fcmTokens: Array.from({ length: 11 }, (_, index) => `token-${index}`),
      },
      {
        displayName: 'Ana Member',
        photoURL: null,
      }
    )).toEqual({
      displayName: 'Ana Member',
      photoURL: null,
      preferredLanguage: 'English',
      phone: '',
      ministries: [],
      description: '',
      showInDirectory: false,
      taxReceiptLegalName: '',
      taxReceiptAddress: {
        line1: '',
        line2: '',
        city: '',
        region: '',
        postalCode: '',
        country: '',
      },
      fcmTokens: [],
    });
  });

  it('keeps valid optional profile fields untouched during repair', () => {
    expect(buildUserProfileRepairPatch(
      {
        preferredLanguage: 'English',
        phone: '',
        ministries: ['Choir'],
        description: '',
        showInDirectory: true,
        photoURL: 'https://example.com/avatar.png',
        taxReceiptLegalName: 'Ana M. Petrov',
        taxReceiptAddress: { line1: '10 Church St' },
        fcmTokens: ['token-1'],
      },
      {
        displayName: 'Ana Member',
        photoURL: null,
      }
    )).toEqual({
      displayName: 'Ana Member',
    });
  });

  it('detects donor tax receipt profile readiness without exposing directory fields', () => {
    expect(isTaxReceiptProfileComplete({
      taxReceiptLegalName: '  Ana M. Petrov  ',
      taxReceiptAddress: {
        line1: '  10 Church St  ',
        city: 'Chicago',
        region: 'IL',
        postalCode: '60601',
        country: 'US',
      },
    })).toBe(true);

    expect(hasTaxReceiptAddressDetails({
      line1: '10 Church St',
      city: 'Chicago',
      region: 'IL',
      postalCode: '60601',
      country: 'US',
    })).toBe(true);

    expect(isTaxReceiptProfileComplete({
      taxReceiptLegalName: 'Ana M. Petrov',
      taxReceiptAddress: {
        line1: '10 Church St',
        city: 'Chicago',
        region: '',
        postalCode: '60601',
        country: 'US',
      },
    })).toBe(false);

    expect(isTaxReceiptProfileComplete({
      taxReceiptLegalName: '',
      taxReceiptAddress: {
        line1: '10 Church St',
        city: 'Chicago',
        region: 'IL',
        postalCode: '60601',
        country: 'US',
      },
    })).toBe(false);
  });
});
