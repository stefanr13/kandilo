import { expect, it } from 'vitest';
import { getSaintPriorityMetadata } from '../../scripts/saint-priority';

it('selects the featured commemoration within each language rather than matching unrelated array positions', () => {
  const empty = { sr_cyr: '', sr_lat: '', en: '', ru: '', uk: '', ro: '' };
  const names = [
    { ...empty, en: 'St Sava of Serbia', ru: 'Другой святой' },
    { ...empty, en: 'Another saint', ru: 'Святитель Сава Сербский' },
  ];
  const metadata = getSaintPriorityMetadata('2026-01-27', names);
  expect(metadata.primaryName.en).toBe('St Sava of Serbia');
  expect(metadata.primaryName.ru).toBe('Святитель Сава Сербский');
  expect(metadata.primaryName.uk).toBe('');
});
