import { describe, expect, it } from 'vitest';
import {
  buildChurchLocation,
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
});
