import { createHash } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { isFunctionsEmulatorTestMode } from './emulatorTest';
import {
  PUBLIC_TAX_RECEIPT_NUMBER_FALLBACK,
  type TaxReceiptPdfAttachment,
} from './taxReceiptPdf';

const TAX_RECEIPT_PDF_STORAGE_ROOT = 'taxReceipts';
const PDF_HASH_PATTERN = /^[a-f0-9]{64}$/;
const emulatorPdfCopies = new Map<string, Buffer>();

export const TAX_RECEIPT_PDF_RETENTION_FAILED_CODE = 'tax_receipt_pdf_retention_failed';

export type RetainedTaxReceiptPdfMetadata = {
  storagePath: string;
  sha256: string;
  byteLength: number;
};

export class TaxReceiptPdfRetentionError extends Error {
  readonly code = TAX_RECEIPT_PDF_RETENTION_FAILED_CODE;

  constructor(message: string) {
    super(message);
    this.name = 'TaxReceiptPdfRetentionError';
  }
}

function cleanText(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() || fallback : fallback;
}

function storagePathPart(value: unknown, fallback: string): string {
  const cleaned = cleanText(value, fallback)
    .replace(/[^A-Za-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 128);
  return cleaned || fallback;
}

function receiptYearPart(receipt: Record<string, unknown>): string {
  const year =
    typeof receipt.receiptYear === 'number'
      ? receipt.receiptYear
      : typeof receipt.annualYear === 'number'
        ? receipt.annualYear
        : 0;
  return Number.isInteger(year) && year >= 1900 && year <= 2200 ? String(year) : 'unknown-year';
}

function filenamePart(value: string): string {
  return storagePathPart(value, 'receipt').slice(0, 80) || 'receipt';
}

function publicReceiptNumberForAttachment(value: unknown): string {
  const receiptNumber = cleanText(value);
  return receiptNumber && receiptNumber.toLowerCase() !== PUBLIC_TAX_RECEIPT_NUMBER_FALLBACK
    ? receiptNumber
    : PUBLIC_TAX_RECEIPT_NUMBER_FALLBACK;
}

export function taxReceiptPdfAttachmentFilename(receipt: Record<string, unknown>): string {
  return `tax-receipt-${filenamePart(publicReceiptNumberForAttachment(receipt.receiptNumber))}.pdf`;
}

export function taxReceiptPdfAttachmentContentDisposition(receipt: Record<string, unknown>): string {
  return `attachment; filename="${taxReceiptPdfAttachmentFilename(receipt)}"`;
}

function pdfBufferFromAttachment(attachment: TaxReceiptPdfAttachment): Buffer {
  const buffer = Buffer.from(attachment.content, 'base64');
  if (buffer.byteLength < 5 || buffer.subarray(0, 5).toString('utf8') !== '%PDF-') {
    throw new TaxReceiptPdfRetentionError('Tax receipt PDF attachment is not a valid PDF.');
  }
  return buffer;
}

export function taxReceiptPdfSha256(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

export function retainedTaxReceiptPdfStoragePath(
  receiptId: string,
  receipt: Record<string, unknown>
): string {
  return [
    TAX_RECEIPT_PDF_STORAGE_ROOT,
    storagePathPart(receipt.churchId, 'unknown-church'),
    receiptYearPart(receipt),
    `${storagePathPart(receiptId, 'receipt')}.pdf`,
  ].join('/');
}

function retentionMetadataFromReceipt(
  receiptId: string,
  receipt: Record<string, unknown>
): RetainedTaxReceiptPdfMetadata | null {
  const storagePath = cleanText(receipt.pdfStoragePath);
  const sha256 = cleanText(receipt.pdfSha256);
  const byteLength = typeof receipt.pdfByteLength === 'number' ? receipt.pdfByteLength : 0;

  if (!storagePath && !sha256 && !byteLength) {
    return null;
  }
  if (
    storagePath !== retainedTaxReceiptPdfStoragePath(receiptId, receipt)
    || !PDF_HASH_PATTERN.test(sha256)
    || !Number.isInteger(byteLength)
    || byteLength <= 0
  ) {
    throw new TaxReceiptPdfRetentionError('Tax receipt PDF retention metadata is invalid.');
  }

  return { storagePath, sha256, byteLength };
}

function attachmentFromBuffer(receipt: Record<string, unknown>, buffer: Buffer): TaxReceiptPdfAttachment {
  return {
    filename: taxReceiptPdfAttachmentFilename(receipt),
    content: buffer.toString('base64'),
    contentType: 'application/pdf',
  };
}

function emulatorPdfCopyKey(metadata: RetainedTaxReceiptPdfMetadata): string {
  return `${metadata.storagePath}#${metadata.sha256}`;
}

export async function loadRetainedTaxReceiptPdfAttachment(
  receiptId: string,
  receipt: Record<string, unknown>
): Promise<TaxReceiptPdfAttachment | null> {
  const metadata = retentionMetadataFromReceipt(receiptId, receipt);
  if (!metadata) {
    return null;
  }

  let buffer: Buffer;
  if (isFunctionsEmulatorTestMode()) {
    const retained = emulatorPdfCopies.get(emulatorPdfCopyKey(metadata));
    if (!retained) {
      return null;
    }
    buffer = retained;
  } else {
    try {
      const [downloaded] = await getStorage().bucket().file(metadata.storagePath).download();
      buffer = downloaded;
    } catch {
      throw new TaxReceiptPdfRetentionError('Stored tax receipt PDF copy could not be loaded.');
    }
  }

  const sha256 = taxReceiptPdfSha256(buffer);
  if (sha256 !== metadata.sha256 || buffer.byteLength !== metadata.byteLength) {
    throw new TaxReceiptPdfRetentionError('Stored tax receipt PDF copy failed integrity verification.');
  }

  return attachmentFromBuffer(receipt, buffer);
}

export async function retainedTaxReceiptPdfObjectMetadataReady(
  receiptId: string,
  receipt: Record<string, unknown>
): Promise<boolean> {
  let metadata: RetainedTaxReceiptPdfMetadata | null = null;
  try {
    metadata = retentionMetadataFromReceipt(receiptId, receipt);
  } catch {
    return false;
  }
  if (!metadata) {
    return false;
  }

  try {
    const [objectMetadata] = await getStorage().bucket().file(metadata.storagePath).getMetadata();
    const size =
      typeof objectMetadata.size === 'number'
        ? objectMetadata.size
        : typeof objectMetadata.size === 'string'
          ? Number(objectMetadata.size)
          : 0;
    const customMetadata =
      objectMetadata.metadata && typeof objectMetadata.metadata === 'object'
        ? objectMetadata.metadata as Record<string, unknown>
        : {};

    return Number.isInteger(size)
      && size === metadata.byteLength
      && cleanText(customMetadata.pdfSha256) === metadata.sha256
      && cleanText(customMetadata.retentionPurpose) === 'official_tax_receipt_copy';
  } catch {
    return false;
  }
}

export async function retainTaxReceiptPdfAttachment(
  receiptRef: FirebaseFirestore.DocumentReference,
  receiptId: string,
  receipt: Record<string, unknown>,
  attachment: TaxReceiptPdfAttachment
): Promise<RetainedTaxReceiptPdfMetadata> {
  const buffer = pdfBufferFromAttachment(attachment);
  const metadata: RetainedTaxReceiptPdfMetadata = {
    storagePath: retainedTaxReceiptPdfStoragePath(receiptId, receipt),
    sha256: taxReceiptPdfSha256(buffer),
    byteLength: buffer.byteLength,
  };

  const existingMetadata = retentionMetadataFromReceipt(receiptId, receipt);
  if (existingMetadata && !isFunctionsEmulatorTestMode()) {
    if (
      existingMetadata.storagePath === metadata.storagePath
      && existingMetadata.sha256 === metadata.sha256
      && existingMetadata.byteLength === metadata.byteLength
    ) {
      return existingMetadata;
    }
    throw new TaxReceiptPdfRetentionError('Tax receipt PDF retention metadata does not match the generated PDF.');
  }

  if (isFunctionsEmulatorTestMode()) {
    emulatorPdfCopies.set(emulatorPdfCopyKey(metadata), buffer);
  } else {
    try {
      await getStorage().bucket().file(metadata.storagePath).save(buffer, {
        resumable: false,
        validation: 'crc32c',
        metadata: {
          cacheControl: 'private, no-store, max-age=0',
          contentDisposition: taxReceiptPdfAttachmentContentDisposition(receipt),
          contentType: attachment.contentType,
          metadata: {
            receiptId,
            churchId: storagePathPart(receipt.churchId, 'unknown-church'),
            receiptYear: receiptYearPart(receipt),
            pdfSha256: metadata.sha256,
            retentionPurpose: 'official_tax_receipt_copy',
          },
        },
      });
    } catch {
      throw new TaxReceiptPdfRetentionError('Tax receipt PDF copy could not be stored.');
    }
  }

  await receiptRef.update({
    pdfStoragePath: metadata.storagePath,
    pdfSha256: metadata.sha256,
    pdfByteLength: metadata.byteLength,
    pdfRetentionStatus: 'retained',
    pdfRetainedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });

  return metadata;
}
