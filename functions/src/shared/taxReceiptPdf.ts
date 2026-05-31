import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import fontkit from '@pdf-lib/fontkit';
import { PDFDocument, StandardFonts, rgb, type PDFPage, type PDFFont } from 'pdf-lib';

const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const MARGIN_X = 54;
const TOP_Y = PAGE_HEIGHT - 54;
const LINE_HEIGHT = 13;
const BODY_SIZE = 10;
const SMALL_SIZE = 8;
const LABEL_WIDTH = 145;
const FOOTER_Y = 54;
const CONTENT_BOTTOM_Y = FOOTER_Y + 58;
const CRA_NAME = 'Canada Revenue Agency';
const CRA_WEBSITE = 'canada.ca/charities-giving';
const CANADA_CRA_STAGING_DRAFT_NOTICE =
  'CRA RECEIPT STAGING DRAFT - NOT VALID FOR INCOME TAX PURPOSES UNTIL KANDILO SUPPORTS READ-ONLY, ENCRYPTED, ELECTRONICALLY SIGNED RECEIPTS';
export const PUBLIC_TAX_RECEIPT_NUMBER_FALLBACK = 'unassigned';
const WIN_ANSI_TEXT_PATTERN = /^[\x09\x0A\x0D\x20-\x7E\u00A0-\u00FF]*$/;
const CYRILLIC_TEXT_PATTERN = /[\u0400-\u052F]/;
const GREEK_TEXT_PATTERN = /[\u0370-\u03FF\u1F00-\u1FFF]/;

export const TAX_RECEIPT_PDF_TEMPLATE_VERSION = 'tax-receipt-us-ca-scaffold-2026-05-v2';
export const UNVERSIONED_TAX_RECEIPT_PDF_TEMPLATE_VERSION = 'legacy-unversioned';

const requireFromHere = createRequire(__filename);
const notoSansRoot = dirname(requireFromHere.resolve('@fontsource/noto-sans/package.json'));
const NOTO_SANS_FONT_FILES = {
  latinExtRegular: join(notoSansRoot, 'files/noto-sans-latin-ext-400-normal.woff'),
  latinExtBold: join(notoSansRoot, 'files/noto-sans-latin-ext-700-normal.woff'),
  cyrillicExtRegular: join(notoSansRoot, 'files/noto-sans-cyrillic-ext-400-normal.woff'),
  cyrillicExtBold: join(notoSansRoot, 'files/noto-sans-cyrillic-ext-700-normal.woff'),
  greekExtRegular: join(notoSansRoot, 'files/noto-sans-greek-ext-400-normal.woff'),
  greekExtBold: join(notoSansRoot, 'files/noto-sans-greek-ext-700-normal.woff'),
};

export type TaxReceiptPdfContribution = {
  dateLabel: string;
  purpose: string;
  amount: string;
  eligibleAmount: string;
};

export type TaxReceiptPdfInput = {
  receiptId: string;
  donorName: string;
  donorAddress?: string;
  churchName: string;
  organizationName: string;
  formattedAmount: string;
  eligibleAmount: string;
  purpose: string;
  receivedDateLabel: string;
  issuedDateLabel: string;
  receiptNumber: string;
  goodsServicesStatement: string;
  coveredPeriodLabel?: string;
  contributionCount?: number;
  contributions?: TaxReceiptPdfContribution[];
  annualSummaryNote?: string;
  correctionLabel?: string;
  correctionNote?: string;
  originalAmount?: string;
  refundedAmount?: string;
  pdfTemplateVersion?: string;
  jurisdiction?: string;
  taxId?: string;
  organizationAddress?: string;
  receiptIssueLocation?: string;
  authorizedSignerName?: string;
  authorizedSignerTitle?: string;
  secureElectronicSignatureConfigured?: boolean;
  receiptCopiesRetentionConfirmed?: boolean;
};

export type TaxReceiptPdfAttachment = {
  filename: string;
  content: string;
  contentType: 'application/pdf';
};

type ReceiptPdfFontSet = {
  regularFont: PDFFont;
  boldFont: PDFFont;
  latinExtRegularFont?: PDFFont;
  latinExtBoldFont?: PDFFont;
  cyrillicExtRegularFont?: PDFFont;
  cyrillicExtBoldFont?: PDFFont;
  greekExtRegularFont?: PDFFont;
  greekExtBoldFont?: PDFFont;
};

function cleanText(value: string | undefined, fallback = ''): string {
  const trimmed = (value ?? '').replace(/\s+/g, ' ').trim();
  return trimmed || fallback;
}

function pdfText(value: string): string {
  return value
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '?')
    .replace(/\s+/g, ' ')
    .trim();
}

function winAnsiPdfText(value: string): string {
  return pdfText(value).replace(/[^\x09\x0A\x0D\x20-\x7E\u00A0-\u00FF]/g, '?');
}

function fontSupportsText(font: PDFFont, text: string): boolean {
  try {
    font.widthOfTextAtSize(text, BODY_SIZE);
    return true;
  } catch {
    return false;
  }
}

function selectUnicodeFont(text: string, bold: boolean, fonts: ReceiptPdfFontSet): PDFFont {
  const candidates: PDFFont[] = [];
  if (CYRILLIC_TEXT_PATTERN.test(text) && fonts.cyrillicExtRegularFont && fonts.cyrillicExtBoldFont) {
    candidates.push(bold ? fonts.cyrillicExtBoldFont : fonts.cyrillicExtRegularFont);
  }
  if (GREEK_TEXT_PATTERN.test(text) && fonts.greekExtRegularFont && fonts.greekExtBoldFont) {
    candidates.push(bold ? fonts.greekExtBoldFont : fonts.greekExtRegularFont);
  }
  for (const font of [
    bold ? fonts.latinExtBoldFont : fonts.latinExtRegularFont,
    bold ? fonts.cyrillicExtBoldFont : fonts.cyrillicExtRegularFont,
    bold ? fonts.greekExtBoldFont : fonts.greekExtRegularFont,
  ]) {
    if (font) {
      candidates.push(font);
    }
  }

  for (const font of candidates) {
    if (fontSupportsText(font, text)) {
      return font;
    }
  }
  return bold ? fonts.boldFont : fonts.regularFont;
}

function inputNeedsUnicodeFonts(input: TaxReceiptPdfInput): boolean {
  return !WIN_ANSI_TEXT_PATTERN.test(JSON.stringify(input));
}

async function embedReceiptFonts(
  pdfDoc: PDFDocument,
  includeUnicodeFonts: boolean
): Promise<ReceiptPdfFontSet> {
  const [regularFont, boldFont] = await Promise.all([
    pdfDoc.embedFont(StandardFonts.Helvetica),
    pdfDoc.embedFont(StandardFonts.HelveticaBold),
  ]);

  if (!includeUnicodeFonts) {
    return { regularFont, boldFont };
  }

  pdfDoc.registerFontkit(fontkit);
  const [
    latinExtRegularFont,
    latinExtBoldFont,
    cyrillicExtRegularFont,
    cyrillicExtBoldFont,
    greekExtRegularFont,
    greekExtBoldFont,
  ] = await Promise.all([
    pdfDoc.embedFont(readFileSync(NOTO_SANS_FONT_FILES.latinExtRegular)),
    pdfDoc.embedFont(readFileSync(NOTO_SANS_FONT_FILES.latinExtBold)),
    pdfDoc.embedFont(readFileSync(NOTO_SANS_FONT_FILES.cyrillicExtRegular)),
    pdfDoc.embedFont(readFileSync(NOTO_SANS_FONT_FILES.cyrillicExtBold)),
    pdfDoc.embedFont(readFileSync(NOTO_SANS_FONT_FILES.greekExtRegular)),
    pdfDoc.embedFont(readFileSync(NOTO_SANS_FONT_FILES.greekExtBold)),
  ]);

  return {
    regularFont,
    boldFont,
    latinExtRegularFont,
    latinExtBoldFont,
    cyrillicExtRegularFont,
    cyrillicExtBoldFont,
    greekExtRegularFont,
    greekExtBoldFont,
  };
}

function filenamePart(value: string): string {
  return cleanText(value, 'receipt')
    .replace(/[^A-Za-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'receipt';
}

function wrapText(text: string, maxChars: number): string[] {
  const normalized = pdfText(text);
  if (!normalized) {
    return [''];
  }

  const lines: string[] = [];
  let current = '';
  for (const word of normalized.split(' ')) {
    if (!word) continue;
    if (word.length > maxChars) {
      if (current) {
        lines.push(current);
        current = '';
      }
      for (let i = 0; i < word.length; i += maxChars) {
        lines.push(word.slice(i, i + maxChars));
      }
      continue;
    }
    const next = current ? `${current} ${word}` : word;
    if (next.length > maxChars && current) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }
  if (current) {
    lines.push(current);
  }
  return lines;
}

export async function renderTaxReceiptPdfAttachment(
  input: TaxReceiptPdfInput
): Promise<TaxReceiptPdfAttachment> {
  const pdfDoc = await PDFDocument.create();
  const pdfTemplateVersion = cleanText(input.pdfTemplateVersion, TAX_RECEIPT_PDF_TEMPLATE_VERSION);
  const publicReceiptNumber = cleanText(input.receiptNumber, PUBLIC_TAX_RECEIPT_NUMBER_FALLBACK);
  const isCanadaReceipt = input.jurisdiction === 'CA';
  pdfDoc.setTitle(`Tax Receipt ${publicReceiptNumber}`);
  pdfDoc.setSubject(`Kandilo official tax receipt copy (${pdfTemplateVersion})`);
  pdfDoc.setCreator('Kandilo');
  pdfDoc.setProducer('Kandilo Cloud Functions');

  let page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  const fonts = await embedReceiptFonts(pdfDoc, inputNeedsUnicodeFonts(input));
  const muted = rgb(0.35, 0.35, 0.35);
  const ink = rgb(0.08, 0.08, 0.08);
  const accent = rgb(0.5, 0, 0);
  let y = TOP_Y;

  const addPage = () => {
    page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    y = TOP_Y;
  };

  const ensureSpace = (height: number) => {
    if (y - height < CONTENT_BOTTOM_Y) {
      addPage();
    }
  };

  const drawPageText = (
    targetPage: PDFPage,
    text: string,
    x: number,
    lineY: number,
    options: { size?: number; bold?: boolean; color?: ReturnType<typeof rgb> } = {}
  ) => {
    const normalized = pdfText(text);
    const bold = options.bold === true;
    const selectedFont = WIN_ANSI_TEXT_PATTERN.test(normalized)
      ? (bold ? fonts.boldFont : fonts.regularFont)
      : selectUnicodeFont(normalized, bold, fonts);
    const safeText =
      selectedFont === fonts.regularFont || selectedFont === fonts.boldFont
        ? winAnsiPdfText(normalized)
        : normalized;

    targetPage.drawText(safeText, {
      x,
      y: lineY,
      size: options.size ?? BODY_SIZE,
      font: selectedFont,
      color: options.color ?? ink,
    });
  };

  const drawLine = (
    text: string,
    x: number,
    lineY: number,
    options: { size?: number; bold?: boolean; color?: ReturnType<typeof rgb> } = {}
  ) => drawPageText(page, text, x, lineY, options);

  const drawNoteBlock = (title: string, body: string) => {
    // Keep the heading with at least its first body line so it never orphans
    // at the page bottom; subsequent lines paginate individually.
    ensureSpace(6 + LINE_HEIGHT + 2 + LINE_HEIGHT);
    y -= 6;
    drawLine(title, MARGIN_X, y, { size: BODY_SIZE, bold: true });
    y -= 15;
    for (const line of wrapText(body, 88)) {
      ensureSpace(LINE_HEIGHT);
      drawLine(line, MARGIN_X, y, { size: BODY_SIZE, color: muted });
      y -= LINE_HEIGHT;
    }
  };

  drawLine(
    isCanadaReceipt ? CANADA_CRA_STAGING_DRAFT_NOTICE : 'OFFICIAL TAX RECEIPT',
    MARGIN_X,
    y,
    { size: 9, bold: true, color: accent }
  );
  y -= 22;
  drawLine(cleanText(input.organizationName, cleanText(input.churchName, 'Parish')), MARGIN_X, y, {
    size: 18,
    bold: true,
  });
  y -= 18;
  for (const line of wrapText(cleanText(input.organizationAddress, ''), 80)) {
    if (!line) continue;
    drawLine(line, MARGIN_X, y, { size: 9, color: muted });
    y -= 11;
  }
  if (input.taxId) {
    drawLine(
      `${isCanadaReceipt ? 'Charity registration number' : 'Tax ID'}: ${input.taxId}`,
      MARGIN_X,
      y,
      { size: 9, bold: true }
    );
    y -= 14;
  }
  if (isCanadaReceipt) {
    drawLine(`${CRA_NAME}: ${CRA_WEBSITE}`, MARGIN_X, y, { size: 9, color: muted });
    y -= 14;
  }

  y -= 8;
  page.drawLine({
    start: { x: MARGIN_X, y },
    end: { x: PAGE_WIDTH - MARGIN_X, y },
    thickness: 1,
    color: rgb(0.15, 0.15, 0.15),
  });
  y -= 24;

  const rawDetails: Array<[string, string]> = [
    ['Receipt No.', publicReceiptNumber],
    ['Receipt Type', cleanText(input.correctionLabel, '')],
    ['Donor', cleanText(input.donorName, 'Parishioner')],
    ['Donor Address', cleanText(input.donorAddress, '')],
    ['Original Amount', cleanText(input.originalAmount, '')],
    ['Refunded Amount', cleanText(input.refundedAmount, '')],
    ['Amount', cleanText(input.formattedAmount, '$0.00')],
    ['Eligible Amount', cleanText(input.eligibleAmount, cleanText(input.formattedAmount, '$0.00'))],
    ['Purpose', cleanText(input.purpose, 'General Fund')],
    ['Contributions Included', typeof input.contributionCount === 'number' ? String(input.contributionCount) : ''],
    ['Covered Period', cleanText(input.coveredPeriodLabel, '')],
    ['Received', cleanText(input.receivedDateLabel, 'Recorded donation date')],
    ['Issued', cleanText(input.issuedDateLabel, '')],
    ['Issued Location', isCanadaReceipt ? cleanText(input.receiptIssueLocation, '') : ''],
    [
      isCanadaReceipt ? 'Authorized Signer' : 'Authorized Signature',
      isCanadaReceipt
        ? cleanText(
          [input.authorizedSignerName, input.authorizedSignerTitle]
            .map((value) => cleanText(value, ''))
            .filter(Boolean)
            .join(', '),
          ''
        )
        : '',
    ],
    [isCanadaReceipt ? 'Advantage' : 'Goods / Services', cleanText(input.goodsServicesStatement, '')],
  ];
  const details = rawDetails.filter(([, value]) => Boolean(value));

  for (const [label, value] of details) {
    const valueLines = wrapText(value, 64);
    const rowHeight = Math.max(LINE_HEIGHT, valueLines.length * LINE_HEIGHT) + 6;
    ensureSpace(rowHeight);
    drawLine(label, MARGIN_X, y, { size: BODY_SIZE, bold: true });
    valueLines.forEach((line, index) => {
      drawLine(line, MARGIN_X + LABEL_WIDTH, y - (index * LINE_HEIGHT), { size: BODY_SIZE });
    });
    y -= rowHeight;
  }

  if (input.correctionNote) {
    drawNoteBlock('Correction Note', input.correctionNote);
  }

  if (input.annualSummaryNote) {
    drawNoteBlock('Annual Summary Note', input.annualSummaryNote);
  }

  const contributions = (input.contributions ?? [])
    .filter((item) => cleanText(item.dateLabel) && cleanText(item.amount));
  if (contributions.length > 0) {
    const drawContributionHeader = () => {
      drawLine('Contribution Detail', MARGIN_X, y, { size: BODY_SIZE, bold: true });
      y -= 17;
      drawLine('Date', MARGIN_X, y, { size: SMALL_SIZE, bold: true, color: muted });
      drawLine('Purpose', MARGIN_X + 92, y, { size: SMALL_SIZE, bold: true, color: muted });
      drawLine('Amount', PAGE_WIDTH - MARGIN_X - 150, y, { size: SMALL_SIZE, bold: true, color: muted });
      drawLine('Eligible', PAGE_WIDTH - MARGIN_X - 70, y, { size: SMALL_SIZE, bold: true, color: muted });
      y -= 12;
    };

    y -= 12;
    ensureSpace(58);
    drawContributionHeader();
    for (const contribution of contributions) {
      const purposeLines = wrapText(cleanText(contribution.purpose, 'General Fund'), 34);
      const rowHeight = Math.max(16, purposeLines.length * 11) + 6;
      if (y - rowHeight < CONTENT_BOTTOM_Y) {
        addPage();
        drawContributionHeader();
      }
      drawLine(cleanText(contribution.dateLabel), MARGIN_X, y, { size: SMALL_SIZE });
      purposeLines.forEach((line, index) => {
        drawLine(line, MARGIN_X + 92, y - (index * 11), { size: SMALL_SIZE });
      });
      drawLine(cleanText(contribution.amount), PAGE_WIDTH - MARGIN_X - 150, y, { size: SMALL_SIZE });
      drawLine(cleanText(contribution.eligibleAmount, contribution.amount), PAGE_WIDTH - MARGIN_X - 70, y, { size: SMALL_SIZE });
      y -= rowHeight;
    }
  }

  const footerLines = [
    'Generated by Kandilo.',
    `PDF template version: ${pdfTemplateVersion}.`,
    isCanadaReceipt ? CANADA_CRA_STAGING_DRAFT_NOTICE : '',
    isCanadaReceipt ? `${CRA_NAME}: ${CRA_WEBSITE}.` : '',
    `Questions about deductibility, corrections, or replacement receipts should go to ${cleanText(input.churchName, 'the parish')}.`,
  ].filter(Boolean);

  for (const receiptPage of pdfDoc.getPages()) {
    receiptPage.drawLine({
      start: { x: MARGIN_X, y: FOOTER_Y + 38 },
      end: { x: PAGE_WIDTH - MARGIN_X, y: FOOTER_Y + 38 },
      thickness: 0.5,
      color: rgb(0.82, 0.82, 0.82),
    });
    let footerLineY = FOOTER_Y + 22;
    for (const line of footerLines) {
      for (const wrapped of wrapText(line, 104)) {
        drawPageText(receiptPage, wrapped, MARGIN_X, footerLineY, {
          size: SMALL_SIZE,
          color: muted,
        });
        footerLineY -= 10;
      }
    }
  }

  const bytes = await pdfDoc.save({ useObjectStreams: false });
  return {
    filename: `tax-receipt-${filenamePart(publicReceiptNumber)}.pdf`,
    content: Buffer.from(bytes).toString('base64'),
    contentType: 'application/pdf',
  };
}
