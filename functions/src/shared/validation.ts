import { HttpsError } from 'firebase-functions/v2/https';

export function assertMaxLength(value: unknown, max: number, field: string): void {
  if (typeof value === 'string' && value.length > max) {
    throw new HttpsError('invalid-argument', `${field} must be at most ${max} characters.`);
  }
}

export function assertNonEmptyString(value: unknown, max: number, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new HttpsError('invalid-argument', `${field} is required.`);
  }
  const trimmed = value.trim();
  assertMaxLength(trimmed, max, field);
  return trimmed;
}

export function assertBoolean(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') {
    throw new HttpsError('invalid-argument', `${field} must be a boolean.`);
  }
  return value;
}

export function assertIntegerInRange(
  value: unknown,
  min: number,
  max: number,
  field: string
): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    throw new HttpsError('invalid-argument', `${field} must be an integer between ${min} and ${max}.`);
  }
  return value;
}

export function assertHttpUrl(value: string, field: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new HttpsError('invalid-argument', `${field} must be a valid URL.`);
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new HttpsError('invalid-argument', `${field} must be an http/https URL.`);
  }

  return parsed.toString();
}

export function assertHttpsUrl(value: string, field: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new HttpsError('invalid-argument', `${field} must be a valid URL.`);
  }

  if (parsed.protocol !== 'https:') {
    throw new HttpsError('invalid-argument', `${field} must be an https URL.`);
  }

  return parsed.toString();
}

export function assertEmail(value: string, field: string): string {
  const normalized = value.trim().toLowerCase();
  assertMaxLength(normalized, 254, field);

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  if (!emailRegex.test(normalized)) {
    throw new HttpsError('invalid-argument', `${field} must be a valid email address.`);
  }

  return normalized;
}

export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
