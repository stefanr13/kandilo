import { describe, expect, it } from 'vitest';
import {
  displayTaxReceiptCurrency,
  formatTaxReceiptAmount,
  normalizedTaxReceiptCurrency,
} from './receipt-currency';

describe('receipt currency helpers', () => {
  it('normalizes only supported official receipt currencies', () => {
    expect(normalizedTaxReceiptCurrency('usd')).toBe('USD');
    expect(normalizedTaxReceiptCurrency(' CAD ')).toBe('CAD');
    expect(normalizedTaxReceiptCurrency('EUR')).toBe('');
    expect(normalizedTaxReceiptCurrency('')).toBe('');
  });

  it('keeps legacy display fallback available for non-receipt amount contexts', () => {
    expect(displayTaxReceiptCurrency('usd')).toBe('USD');
    expect(displayTaxReceiptCurrency('EUR', 'CAD')).toBe('CAD');
  });

  it('formats invalid receipt currencies without inventing a supported currency', () => {
    expect(formatTaxReceiptAmount(5000, 'USD')).toBe('$50.00');
    expect(formatTaxReceiptAmount(5000, 'cad')).toBe('CA$50.00');
    expect(formatTaxReceiptAmount(5000, 'EUR')).toBe('50.00 EUR');
    expect(formatTaxReceiptAmount(5000, '')).toBe('50.00');
  });
});
