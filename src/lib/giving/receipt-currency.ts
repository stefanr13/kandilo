const SUPPORTED_TAX_RECEIPT_CURRENCIES = new Set(['USD', 'CAD']);

export function normalizedTaxReceiptCurrency(value: unknown): string {
  if (typeof value !== 'string') {
    return '';
  }

  const normalized = value.trim().toUpperCase();
  return SUPPORTED_TAX_RECEIPT_CURRENCIES.has(normalized) ? normalized : '';
}

export function displayTaxReceiptCurrency(value: unknown, fallback = 'USD'): string {
  return normalizedTaxReceiptCurrency(value) || fallback;
}

export function formatTaxReceiptAmount(
  amountCents: number,
  currency: unknown,
  locale = 'en-US'
): string {
  const normalizedCurrency = normalizedTaxReceiptCurrency(currency);
  if (normalizedCurrency) {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: normalizedCurrency,
    }).format(amountCents / 100);
  }

  const amount = new Intl.NumberFormat(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amountCents / 100);
  const rawCurrency = typeof currency === 'string' ? currency.trim().toUpperCase() : '';
  return rawCurrency ? `${amount} ${rawCurrency}` : amount;
}
