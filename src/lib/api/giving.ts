import { callFunction } from './client';

export async function createGivingCheckoutSession(input: {
  churchId: string;
  amountCents: number;
  currency?: string;
  purpose?: string;
  anonymous?: boolean;
  donorName?: string;
  eventId?: string;
  eventPortalId?: string;
  eventCampaignId?: string;
}): Promise<{ checkoutUrl: string; givingId: string; sessionId: string }> {
  return callFunction<typeof input, { checkoutUrl: string; givingId: string; sessionId: string }>(
    'createStripeCheckoutSession',
    input
  );
}

export async function sendTaxReceipt(input: {
  givingId: string;
}): Promise<{
  success: boolean;
  receiptId: string;
  receiptNumber: string;
  created: boolean;
  emailSent: boolean;
}> {
  return callFunction<typeof input, {
    success: boolean;
    receiptId: string;
    receiptNumber: string;
    created: boolean;
    emailSent: boolean;
  }>('sendTaxReceipt', input);
}

export async function sendCorrectedTaxReceipt(input: {
  givingId: string;
}): Promise<{
  success: boolean;
  receiptId: string;
  receiptNumber: string;
  created: boolean;
  corrected: boolean;
  emailSent: boolean;
}> {
  return callFunction<typeof input, {
    success: boolean;
    receiptId: string;
    receiptNumber: string;
    created: boolean;
    corrected: boolean;
    emailSent: boolean;
  }>('sendCorrectedTaxReceipt', input);
}

export async function sendAnnualTaxReceipt(input: {
  churchId: string;
  year: number;
  userId?: string;
  acknowledgePreviouslyReceipted?: boolean;
}): Promise<{
  success: boolean;
  receiptId: string;
  receiptNumber: string;
  created: boolean;
  contributionCount: number | null;
  emailSent: boolean;
}> {
  return callFunction<typeof input, {
    success: boolean;
    receiptId: string;
    receiptNumber: string;
    created: boolean;
    contributionCount: number | null;
    emailSent: boolean;
  }>('sendAnnualTaxReceipt', input);
}

export async function sendCorrectedAnnualTaxReceipt(input: {
  churchId: string;
  userId?: string;
  year: number;
  acknowledgePreviouslyReceipted?: boolean;
}): Promise<{
  success: boolean;
  receiptId: string;
  receiptNumber: string;
  created: boolean;
  corrected: boolean;
  contributionCount: number | null;
  emailSent: boolean;
}> {
  return callFunction<typeof input, {
    success: boolean;
    receiptId: string;
    receiptNumber: string;
    created: boolean;
    corrected: boolean;
    contributionCount: number | null;
    emailSent: boolean;
  }>('sendCorrectedAnnualTaxReceipt', input);
}

export async function downloadTaxReceiptPdf(input: {
  receiptId: string;
}): Promise<{
  success: boolean;
  filename: string;
  content: string;
  contentType: 'application/pdf';
}> {
  return callFunction<typeof input, {
    success: boolean;
    filename: string;
    content: string;
    contentType: 'application/pdf';
  }>('downloadTaxReceiptPdf', input);
}

export async function sendChurchAnnualTaxReceipts(input: {
  churchId: string;
  year: number;
  acknowledgePreviouslyReceipted?: boolean;
}): Promise<{
  success: boolean;
  donorCount: number;
  createdCount: number;
  emailSentCount: number;
  skippedCount: number;
  failedCount: number;
  truncated: boolean;
  failures: Array<{ code: string }>;
}> {
  return callFunction<typeof input, {
    success: boolean;
    donorCount: number;
    createdCount: number;
    emailSentCount: number;
    skippedCount: number;
    failedCount: number;
    truncated: boolean;
    failures: Array<{ code: string }>;
  }>('sendChurchAnnualTaxReceipts', input);
}

export async function sendChurchCorrectedAnnualTaxReceipts(input: {
  churchId: string;
  year: number;
  acknowledgePreviouslyReceipted?: boolean;
}): Promise<{
  success: boolean;
  donorCount: number;
  createdCount: number;
  emailSentCount: number;
  skippedCount: number;
  failedCount: number;
  truncated: boolean;
  failures: Array<{ code: string }>;
}> {
  return callFunction<typeof input, {
    success: boolean;
    donorCount: number;
    createdCount: number;
    emailSentCount: number;
    skippedCount: number;
    failedCount: number;
    truncated: boolean;
    failures: Array<{ code: string }>;
  }>('sendChurchCorrectedAnnualTaxReceipts', input);
}
