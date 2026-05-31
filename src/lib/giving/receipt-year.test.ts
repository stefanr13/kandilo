import { describe, expect, it } from 'vitest';
import { getReceiptYear, getRecentClosedReceiptYears, isClosedReceiptYear } from './receipt-year';

describe('getReceiptYear', () => {
  it('uses the church timezone for annual receipt grouping', () => {
    const donationTime = new Date('2026-01-01T04:30:00Z');

    expect(getReceiptYear(donationTime, 'America/Chicago')).toBe(2025);
    expect(getReceiptYear(donationTime, 'UTC')).toBe(2026);
  });

  it('falls back to UTC for missing or invalid timezones', () => {
    const donationTime = new Date('2026-01-01T04:30:00Z');

    expect(getReceiptYear(donationTime)).toBe(2026);
    expect(getReceiptYear(donationTime, 'Not/A_Timezone')).toBe(2026);
  });

  it('treats only prior local receipt years as closed', () => {
    const localChicagoNewYear = new Date('2026-01-01T06:30:00Z');

    expect(isClosedReceiptYear(2025, 'America/Chicago', localChicagoNewYear)).toBe(true);
    expect(isClosedReceiptYear(2026, 'America/Chicago', localChicagoNewYear)).toBe(false);
  });

  it('returns recent closed years from the church timezone', () => {
    const chicagoNewYearsEve = new Date('2026-01-01T04:30:00Z');

    expect(getRecentClosedReceiptYears('America/Chicago', 3, chicagoNewYearsEve)).toEqual([
      2024,
      2023,
      2022,
    ]);
    expect(getRecentClosedReceiptYears('UTC', 2, chicagoNewYearsEve)).toEqual([2025, 2024]);
  });
});
