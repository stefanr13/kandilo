export function getReceiptYear(date: Date, timezone?: string): number {
  const timeZone = timezone?.trim() || 'UTC';

  try {
    const yearPart = new Intl.DateTimeFormat('en-US', {
      year: 'numeric',
      timeZone,
    }).formatToParts(date).find((part) => part.type === 'year')?.value;
    return yearPart ? Number.parseInt(yearPart, 10) : date.getUTCFullYear();
  } catch {
    return date.getUTCFullYear();
  }
}

export function isClosedReceiptYear(year: number, timezone?: string, now = new Date()): boolean {
  return year < getReceiptYear(now, timezone);
}

export function getRecentClosedReceiptYears(timezone?: string, count = 3, now = new Date()): number[] {
  const currentYear = getReceiptYear(now, timezone);
  return Array.from({ length: Math.max(0, count) }, (_, index) => currentYear - index - 1)
    .filter((year) => year >= 2000);
}
