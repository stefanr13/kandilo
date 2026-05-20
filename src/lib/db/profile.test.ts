import { describe, expect, it, vi } from 'vitest';
import { sanitizeProfileInput } from './profile';

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
    });

    expect(safe).toMatchObject({
      displayName: 'Ana Member',
      phone: '555-0100',
      ministries: ['Choir', 'Parish Council'],
      description: 'Serves in choir.',
      showInDirectory: true,
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
      })
    ).toThrow('Ministry must be at most 50 characters.');
  });
});
