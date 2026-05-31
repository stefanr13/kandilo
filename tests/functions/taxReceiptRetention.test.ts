import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  taxReceiptPdfAttachmentContentDisposition,
  taxReceiptPdfAttachmentFilename,
  retainedTaxReceiptPdfStoragePath,
  taxReceiptPdfSha256,
} from '../../functions/src/shared/taxReceiptRetention';

describe('tax receipt PDF retention helpers', () => {
  it('uses backend-only stable storage paths without donor identity fields', () => {
    const path = retainedTaxReceiptPdfStoragePath('receipt/unsafe id', {
      churchId: 'church:1',
      receiptYear: 2026,
      donorEmail: 'donor@example.com',
      donorName: 'Private Donor',
    });

    expect(path).toBe('taxReceipts/church-1/2026/receipt-unsafe-id.pdf');
    expect(path).not.toContain('donor');
    expect(path).not.toContain('@');
  });

  it('computes the retained PDF hash with SHA-256', () => {
    const buffer = Buffer.from('%PDF-pretend-receipt');

    expect(taxReceiptPdfSha256(buffer)).toBe(
      createHash('sha256').update(buffer).digest('hex')
    );
  });

  it('does not expose internal receipt ids in retained attachment filenames when the public number is missing', async () => {
    const receiptId = 'annual_private_internal_123';

    expect(taxReceiptPdfAttachmentFilename({ receiptNumber: 'unassigned' }))
      .toBe('tax-receipt-unassigned.pdf');
    expect(taxReceiptPdfAttachmentFilename({ receiptNumber: '' }))
      .toBe('tax-receipt-unassigned.pdf');
    expect(taxReceiptPdfAttachmentFilename({ receiptNumber: '', receiptId }))
      .not.toContain(receiptId);
  });

  it('does not trust caller-provided retained attachment filenames for Storage content disposition', () => {
    const receiptId = 'annual_private_internal_123';

    expect(taxReceiptPdfAttachmentContentDisposition({ receiptNumber: '', receiptId }))
      .toBe('attachment; filename="tax-receipt-unassigned.pdf"');
    expect(taxReceiptPdfAttachmentContentDisposition({ receiptNumber: '', receiptId }))
      .not.toContain(receiptId);
  });
});
