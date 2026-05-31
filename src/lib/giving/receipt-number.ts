export const PUBLIC_TAX_RECEIPT_NUMBER_FALLBACK = 'unassigned';

export function assignedTaxReceiptNumber(value: unknown): string {
  if (typeof value !== 'string') {
    return '';
  }
  const receiptNumber = value.trim();
  return receiptNumber.toLowerCase() === PUBLIC_TAX_RECEIPT_NUMBER_FALLBACK ? '' : receiptNumber;
}

export function hasAssignedTaxReceiptNumber(value: unknown): boolean {
  return assignedTaxReceiptNumber(value).length > 0;
}
