import { escapeHtml } from './validation';

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

interface EmailDetail {
  label: string;
  value: string;
}

interface EmailCta {
  label: string;
  url: string;
}

interface EmailLayoutInput {
  preheader: string;
  subject: string;
  eyebrow: string;
  title: string;
  subtitle: string;
  churchName?: string;
  bodyHtml: string;
  cta?: EmailCta;
  mobileCta?: EmailCta;
  details?: EmailDetail[];
  footerNote: string;
  textLines: string[];
}

const APP_NAME = 'Kandilo';
const BRAND_RED = '#800000';
const BRAND_RED_DARK = '#6F0000';
const BRAND_GOLD = '#937022';
const INK = '#111827';
const MUTED = '#6B7280';
const SOFT_BG = '#F7F4EF';
const PANEL_BG = '#FFFFFF';
const BORDER = '#ECE7DF';
const CRA_NAME = 'Canada Revenue Agency';
const CRA_WEBSITE = 'canada.ca/charities-giving';
const CANADA_CRA_STAGING_DRAFT_NOTICE =
  'CRA receipt staging draft - not valid for income tax purposes until Kandilo supports read-only, encrypted, electronically signed receipts.';

function cleanText(value: string, fallback = ''): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized || fallback;
}

function cleanSubject(value: string): string {
  return cleanText(value).replace(/[<>]/g, '').slice(0, 160);
}

function safeUrl(url: string): string {
  return escapeHtml(url.trim());
}

function detailRows(details: EmailDetail[] = []): string {
  if (details.length === 0) {
    return '';
  }

  const rows = details.map((detail) => `
    <tr>
      <td style="padding: 14px 0; border-bottom: 1px solid #F0EDE8; color: ${MUTED}; font-size: 12px; font-weight: 700; text-transform: uppercase;">
        ${escapeHtml(detail.label)}
      </td>
      <td align="right" style="padding: 14px 0; border-bottom: 1px solid #F0EDE8; color: ${INK}; font-size: 14px; font-weight: 800;">
        ${escapeHtml(detail.value)}
      </td>
    </tr>
  `).join('');

  return `
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin: 22px 0 8px;">
      ${rows}
    </table>
  `;
}

function ctaBlock(cta?: EmailCta): string {
  if (!cta) {
    return '';
  }

  return `
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin: 28px 0 8px;">
      <tr>
        <td bgcolor="${BRAND_RED}" style="border-radius: 16px; background: ${BRAND_RED};">
          <a href="${safeUrl(cta.url)}" style="background: ${BRAND_RED}; border: 1px solid ${BRAND_RED_DARK}; border-radius: 16px; color: #FFFFFF; display: inline-block; font-size: 13px; font-weight: 900; letter-spacing: 0.08em; line-height: 18px; padding: 15px 24px; text-decoration: none; text-transform: uppercase;">
            ${escapeHtml(cta.label)}
          </a>
        </td>
      </tr>
    </table>
  `;
}

function mobileCtaBlock(cta?: EmailCta): string {
  if (!cta) {
    return '';
  }

  return `
    <p style="color: ${MUTED}; font-family: Arial, Helvetica, sans-serif; font-size: 12px; font-weight: 700; line-height: 19px; margin: 14px 0 0;">
      Installed mobile app?
      <a href="${safeUrl(cta.url)}" style="color: ${BRAND_RED}; font-weight: 900; text-decoration: none;">
        ${escapeHtml(cta.label)}
      </a>
    </p>
  `;
}

function churchBadge(churchName?: string): string {
  if (!churchName) {
    return '';
  }

  return `
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin: 0 0 22px;">
      <tr>
        <td style="background: #F9F7F3; border: 1px solid ${BORDER}; border-radius: 999px; color: ${BRAND_RED}; font-size: 12px; font-weight: 900; padding: 8px 13px;">
          ${escapeHtml(churchName)}
        </td>
      </tr>
    </table>
  `;
}

function renderLayout(input: EmailLayoutInput): RenderedEmail {
  const text = [
    input.title,
    input.subtitle,
    input.churchName ? `Church: ${input.churchName}` : '',
    ...input.textLines,
    input.cta ? `${input.cta.label}: ${input.cta.url}` : '',
    input.mobileCta ? `${input.mobileCta.label}: ${input.mobileCta.url}` : '',
    input.footerNote,
  ].filter(Boolean).join('\n\n');

  const html = `<!doctype html>
<html>
  <head>
    <meta http-equiv="Content-Type" content="text/html; charset=utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="color-scheme" content="light">
    <meta name="supported-color-schemes" content="light">
    <title>${escapeHtml(input.subject)}</title>
  </head>
  <body style="margin: 0; padding: 0; background: ${SOFT_BG}; -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%;">
    <div style="display: none; max-height: 0; overflow: hidden; opacity: 0; color: transparent;">
      ${escapeHtml(input.preheader)}
    </div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background: ${SOFT_BG}; margin: 0; padding: 0; width: 100%;">
      <tr>
        <td align="center" style="padding: 32px 14px;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width: 640px; width: 100%;">
            <tr>
              <td style="padding: 0 0 16px;">
                <table role="presentation" cellspacing="0" cellpadding="0" border="0">
                  <tr>
                    <td width="42" height="42" align="center" bgcolor="${BRAND_RED}" style="background: ${BRAND_RED}; border-radius: 14px; color: #FFFFFF; font-family: Arial, Helvetica, sans-serif; font-size: 20px; font-weight: 900;">
                      K
                    </td>
                    <td style="padding-left: 12px; color: ${INK}; font-family: Arial, Helvetica, sans-serif; font-size: 22px; font-weight: 900; letter-spacing: -0.02em;">
                      ${APP_NAME}
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td bgcolor="${PANEL_BG}" style="background: ${PANEL_BG}; border: 1px solid ${BORDER}; border-radius: 28px; padding: 34px 30px 30px;">
                <p style="color: ${BRAND_GOLD}; font-family: Arial, Helvetica, sans-serif; font-size: 11px; font-weight: 900; letter-spacing: 0.18em; line-height: 16px; margin: 0 0 12px; text-transform: uppercase;">
                  ${escapeHtml(input.eyebrow)}
                </p>
                <h1 style="color: ${INK}; font-family: Arial, Helvetica, sans-serif; font-size: 34px; font-weight: 900; letter-spacing: -0.03em; line-height: 38px; margin: 0 0 12px;">
                  ${escapeHtml(input.title)}
                </h1>
                <p style="color: ${MUTED}; font-family: Arial, Helvetica, sans-serif; font-size: 15px; font-weight: 600; line-height: 24px; margin: 0 0 22px;">
                  ${escapeHtml(input.subtitle)}
                </p>
                ${churchBadge(input.churchName)}
                <div style="color: #374151; font-family: Arial, Helvetica, sans-serif; font-size: 15px; font-weight: 500; line-height: 25px;">
                  ${input.bodyHtml}
                </div>
                ${detailRows(input.details)}
                ${ctaBlock(input.cta)}
                ${mobileCtaBlock(input.mobileCta)}
              </td>
            </tr>
            <tr>
              <td style="padding: 18px 6px 0; color: #8A8175; font-family: Arial, Helvetica, sans-serif; font-size: 12px; font-weight: 600; line-height: 19px;">
                ${escapeHtml(input.footerNote)}
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  return {
    subject: input.subject,
    html,
    text,
  };
}

function roleLabel(role: 'member' | 'admin' | 'treasurer'): string {
  if (role === 'admin') return 'parish admin';
  if (role === 'treasurer') return 'parish treasurer';
  return 'parish member';
}

function roleAudienceLabel(roles: string[]): string {
  const labels = roles.map((role) => {
    if (role === 'priest') return 'priests';
    if (role === 'treasurer') return 'treasurers';
    if (role === 'admin') return 'admins';
    return 'members';
  });
  return labels.join(', ');
}

export function renderInvitationEmail(input: {
  churchName: string;
  inviteUrl: string;
  mobileInviteUrl?: string;
  role: 'member' | 'admin' | 'treasurer';
  invitedByName?: string;
  expiresLabel: string;
}): RenderedEmail {
  const churchName = cleanText(input.churchName, 'your parish');
  const invitedBy = cleanText(input.invitedByName ?? '', 'A parish admin');
  const role = roleLabel(input.role);

  return renderLayout({
    subject: cleanSubject(`You're invited to ${churchName} on Kandilo`),
    preheader: `${invitedBy} invited you to join ${churchName} as a ${role}.`,
    eyebrow: 'Parish Invitation',
    title: "You're invited.",
    subtitle: `${invitedBy} invited you to join ${churchName} on Kandilo.`,
    churchName,
    bodyHtml: `
      <p style="margin: 0 0 14px;">Accept this invitation to connect with parish updates, bulletins, events, giving, and community tools for <strong style="color: ${INK};">${escapeHtml(churchName)}</strong>.</p>
      <p style="margin: 0;">You will join as a <strong style="color: ${INK};">${escapeHtml(role)}</strong>. If you belong to multiple churches, Kandilo will let you switch between them after signing in.</p>
    `,
    cta: { label: 'Accept Invitation', url: input.inviteUrl },
    mobileCta: input.mobileInviteUrl
      ? { label: 'Open in Kandilo', url: input.mobileInviteUrl }
      : undefined,
    details: [
      { label: 'Role', value: role },
      { label: 'Expires', value: input.expiresLabel },
    ],
    footerNote: 'This invitation was sent by a parish admin or priest. If you were not expecting it, you can ignore this email.',
    textLines: [
      `Invited by: ${invitedBy}`,
      `Role: ${role}`,
      `Expires: ${input.expiresLabel}`,
    ],
  });
}

export function renderNewsletterEmail(input: {
  churchName: string;
  title: string;
  excerpt?: string;
  appUrl: string;
  mobileAppUrl?: string;
}): RenderedEmail {
  const churchName = cleanText(input.churchName, 'your parish');
  const title = cleanText(input.title, 'Parish Bulletin');
  const excerpt = cleanText(input.excerpt ?? '', 'A new parish bulletin has been published.');

  return renderLayout({
    subject: cleanSubject(`New bulletin from ${churchName}: ${title}`),
    preheader: `${churchName} published a new bulletin: ${title}.`,
    eyebrow: 'Parish Bulletin',
    title,
    subtitle: excerpt,
    churchName,
    bodyHtml: `
      <p style="margin: 0;">A new bulletin is available for <strong style="color: ${INK};">${escapeHtml(churchName)}</strong>. Open Kandilo to read the full bulletin and view parish updates in context.</p>
    `,
    cta: { label: 'Read in Kandilo', url: input.appUrl },
    mobileCta: input.mobileAppUrl
      ? { label: 'Open in Kandilo', url: input.mobileAppUrl }
      : undefined,
    footerNote: `You are receiving this because you are an active member of ${churchName} on Kandilo. If you belong to multiple churches, select ${churchName} in the app to view this bulletin.`,
    textLines: [excerpt],
  });
}

export function renderDonationReceiptEmail(input: {
  displayName: string;
  churchName: string;
  formattedAmount: string;
  purpose: string;
  dateLabel: string;
  givingId: string;
}): RenderedEmail {
  const displayName = cleanText(input.displayName, 'Parishioner');
  const churchName = cleanText(input.churchName, 'your parish');
  const purpose = cleanText(input.purpose, 'General Fund');

  return renderLayout({
    subject: cleanSubject(`Donation confirmation from ${churchName}`),
    preheader: `${input.formattedAmount} donation received by ${churchName}; official tax receipts are sent separately when available.`,
    eyebrow: 'Donation Confirmation',
    title: `Thank you, ${displayName}.`,
    subtitle: `Your donation to ${churchName} has been received.`,
    churchName,
    bodyHtml: `
      <p style="margin: 0 0 14px;">This confirms the donation recorded through Kandilo for <strong style="color: ${INK};">${escapeHtml(churchName)}</strong>.</p>
      <p style="margin: 0;">This payment confirmation is not an official tax receipt. If your parish issues tax receipts through Kandilo, the official receipt is sent separately with the receipt number and PDF attachment.</p>
    `,
    details: [
      { label: 'Amount', value: input.formattedAmount },
      { label: 'Purpose', value: purpose },
      { label: 'Date', value: input.dateLabel },
      { label: 'Reference', value: input.givingId },
    ],
    footerNote: `Questions about this gift or official tax documentation should go directly to ${churchName}. Kandilo records the transaction but your parish handles official receipts and acknowledgements.`,
    textLines: [
      'This payment confirmation is not an official tax receipt.',
      'Official tax receipts are sent separately when your parish has them available in Kandilo.',
      `Amount: ${input.formattedAmount}`,
      `Purpose: ${purpose}`,
      `Date: ${input.dateLabel}`,
      `Reference: ${input.givingId}`,
    ],
  });
}

export function renderTaxReceiptEmail(input: {
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
  contributions?: Array<{
    dateLabel: string;
    purpose: string;
    amount: string;
    eligibleAmount: string;
  }>;
  annualSummaryNote?: string;
  correctionLabel?: string;
  correctionNote?: string;
  originalAmount?: string;
  refundedAmount?: string;
  jurisdiction?: string;
  taxId?: string;
  organizationAddress?: string;
  receiptIssueLocation?: string;
  authorizedSignerName?: string;
  authorizedSignerTitle?: string;
  secureElectronicSignatureConfigured?: boolean;
  receiptCopiesRetentionConfirmed?: boolean;
}): RenderedEmail {
  const donorName = cleanText(input.donorName, 'Parishioner');
  const donorAddress = cleanText(input.donorAddress ?? '', '');
  const churchName = cleanText(input.churchName, 'your parish');
  const organizationName = cleanText(input.organizationName, churchName);
  const purpose = cleanText(input.purpose, 'General Fund');
  const correctionLabel = cleanText(input.correctionLabel ?? '', '');
  const correctionNote = cleanText(input.correctionNote ?? '', '');
  const organizationAddress = cleanText(input.organizationAddress ?? '', '');
  const isCanadaReceipt = input.jurisdiction === 'CA';
  const authorizedSigner = [input.authorizedSignerName, input.authorizedSignerTitle]
    .map((value) => cleanText(value ?? '', ''))
    .filter(Boolean)
    .join(', ');
  const goodsServicesStatement = cleanText(
    input.goodsServicesStatement,
    'No goods or services were provided in exchange for this contribution.'
  );
  const details: EmailDetail[] = [
    { label: 'Receipt No.', value: input.receiptNumber },
    ...(correctionLabel ? [{ label: 'Receipt Type', value: correctionLabel }] : []),
    ...(organizationAddress ? [{ label: 'Organization Address', value: organizationAddress }] : []),
    ...(input.taxId ? [{ label: isCanadaReceipt ? 'Charity Registration No.' : 'Tax ID', value: input.taxId }] : []),
    ...(isCanadaReceipt ? [{ label: 'CRA', value: `${CRA_NAME}, ${CRA_WEBSITE}` }] : []),
    { label: 'Donor', value: donorName },
    ...(donorAddress ? [{ label: 'Donor Address', value: donorAddress }] : []),
    ...(input.originalAmount ? [{ label: 'Original Amount', value: input.originalAmount }] : []),
    ...(input.refundedAmount ? [{ label: 'Refunded Amount', value: input.refundedAmount }] : []),
    { label: 'Amount', value: input.formattedAmount },
    { label: 'Eligible Amount', value: input.eligibleAmount },
    { label: 'Purpose', value: purpose },
    ...(input.contributions?.length
      ? [{ label: 'Contribution Detail', value: 'Included in the attached PDF.' }]
      : []),
    ...(typeof input.contributionCount === 'number'
      ? [{ label: 'Contributions Included', value: String(input.contributionCount) }]
      : []),
    ...(input.coveredPeriodLabel ? [{ label: 'Covered Period', value: input.coveredPeriodLabel }] : []),
    { label: 'Received', value: input.receivedDateLabel },
    { label: 'Issued', value: input.issuedDateLabel },
    ...(isCanadaReceipt && input.receiptIssueLocation
      ? [{ label: 'Issued Location', value: input.receiptIssueLocation }]
      : []),
    ...(isCanadaReceipt && authorizedSigner
      ? [{ label: 'Authorized Signer', value: authorizedSigner }]
      : []),
    { label: isCanadaReceipt ? 'Advantage' : 'Goods / Services', value: goodsServicesStatement },
  ];

  const receiptIsCorrected = Boolean(correctionLabel || correctionNote);

  return renderLayout({
    subject: cleanSubject(
      isCanadaReceipt
        ? `Canadian receipt staging draft from ${churchName}`
        : `${receiptIsCorrected ? 'Corrected tax receipt' : 'Tax receipt'} from ${churchName}`
    ),
    preheader: isCanadaReceipt
      ? `Canadian receipt staging draft for ${input.formattedAmount} from ${churchName}.`
      : `${input.formattedAmount} ${receiptIsCorrected ? 'corrected ' : ''}tax receipt from ${churchName}.`,
    eyebrow: isCanadaReceipt ? 'CRA Staging Draft' : (receiptIsCorrected ? 'Corrected Tax Receipt' : 'Tax Receipt'),
    title: isCanadaReceipt
      ? 'Canadian receipt staging draft.'
      : (receiptIsCorrected ? 'Your corrected tax receipt is ready.' : 'Your tax receipt is ready.'),
    subtitle: isCanadaReceipt
      ? CANADA_CRA_STAGING_DRAFT_NOTICE
      : `${organizationName} issued a charitable contribution acknowledgment for your records.`,
    churchName,
    bodyHtml: `
      <p style="margin: 0 0 14px;">This receipt acknowledges the contribution recorded through Kandilo for <strong style="color: ${INK};">${escapeHtml(organizationName)}</strong>.</p>
      ${correctionNote ? `<p style="margin: 0 0 14px; color: ${INK}; font-weight: 700;">${escapeHtml(correctionNote)}</p>` : ''}
      <p style="margin: 0 0 14px;">Keep this email with your tax records. Kandilo provides the platform; the parish is responsible for the official receipt details.</p>
      ${input.contributions?.length ? `<p style="margin: 0 0 14px;">The attached PDF includes the itemized contribution detail for this annual receipt.</p>` : ''}
      ${input.annualSummaryNote ? `<p style="margin: 0; color: ${MUTED};">${escapeHtml(cleanText(input.annualSummaryNote, ''))}</p>` : ''}
    `,
    details,
    footerNote: `This receipt was issued by ${organizationName}. Questions about deductibility, corrections, or replacement receipts should go directly to ${churchName}.`,
    textLines: [
      `Receipt No.: ${input.receiptNumber}`,
      `Organization: ${organizationName}`,
      organizationAddress ? `Organization address: ${organizationAddress}` : '',
      input.taxId ? `${isCanadaReceipt ? 'Charity registration number' : 'Tax ID'}: ${input.taxId}` : '',
      isCanadaReceipt ? `${CRA_NAME}: ${CRA_WEBSITE}` : '',
      correctionLabel ? `Receipt type: ${correctionLabel}` : '',
      correctionNote,
      `Donor: ${donorName}`,
      donorAddress ? `Donor address: ${donorAddress}` : '',
      input.originalAmount ? `Original amount: ${input.originalAmount}` : '',
      input.refundedAmount ? `Refunded amount: ${input.refundedAmount}` : '',
      `Amount: ${input.formattedAmount}`,
      `Eligible amount: ${input.eligibleAmount}`,
      `Purpose: ${purpose}`,
      input.contributions?.length ? 'Contribution detail: included in the attached PDF.' : '',
      input.contributionCount ? `Contributions included: ${input.contributionCount}` : '',
      input.coveredPeriodLabel ? `Covered period: ${input.coveredPeriodLabel}` : '',
      `Received: ${input.receivedDateLabel}`,
      `Issued: ${input.issuedDateLabel}`,
      isCanadaReceipt && input.receiptIssueLocation ? `Issued location: ${input.receiptIssueLocation}` : '',
      isCanadaReceipt && authorizedSigner ? `Authorized signer: ${authorizedSigner}` : '',
      goodsServicesStatement,
      isCanadaReceipt ? CANADA_CRA_STAGING_DRAFT_NOTICE : '',
      input.annualSummaryNote ? cleanText(input.annualSummaryNote, '') : '',
    ].filter(Boolean),
  });
}

export function renderParishNotificationEmail(input: {
  churchName: string;
  title: string;
  body: string;
  senderName: string;
  audienceRoles: string[];
  appUrl: string;
  mobileAppUrl?: string;
}): RenderedEmail {
  const churchName = cleanText(input.churchName, 'your parish');
  const title = cleanText(input.title, 'Parish Notification');
  const body = cleanText(input.body, 'A parish notification was sent.');
  const senderName = cleanText(input.senderName, 'Parish Admin');
  const audience = roleAudienceLabel(input.audienceRoles);

  return renderLayout({
    subject: cleanSubject(`${churchName}: ${title}`),
    preheader: `${title} from ${churchName}.`,
    eyebrow: 'Parish Notification',
    title,
    subtitle: body,
    churchName,
    bodyHtml: `
      <p style="margin: 0 0 14px;">${escapeHtml(body)}</p>
      <p style="margin: 0;">This notification was sent by <strong style="color: ${INK};">${escapeHtml(senderName)}</strong> for <strong style="color: ${INK};">${escapeHtml(churchName)}</strong>.</p>
    `,
    cta: { label: 'Open Kandilo', url: input.appUrl },
    mobileCta: input.mobileAppUrl
      ? { label: 'Open in Kandilo', url: input.mobileAppUrl }
      : undefined,
    details: [
      { label: 'Sent by', value: senderName },
      { label: 'Audience', value: audience },
    ],
    footerNote: `You are receiving this because your active role at ${churchName} is included in this notification. If you belong to multiple churches, switch to ${churchName} in Kandilo for the right context.`,
    textLines: [
      body,
      `Sent by: ${senderName}`,
      `Audience: ${audience}`,
    ],
  });
}

export function renderEmailVerificationEmail(input: {
  displayName: string;
  verificationUrl: string;
}): RenderedEmail {
  const displayName = cleanText(input.displayName, 'there');

  return renderLayout({
    subject: 'Verify your Kandilo email',
    preheader: 'Confirm your email address to finish setting up Kandilo.',
    eyebrow: 'Account Verification',
    title: `Welcome, ${displayName}.`,
    subtitle: 'Confirm your email address to finish setting up your Kandilo account.',
    bodyHtml: `
      <p style="margin: 0;">Once verified, you can join or manage parish communities, receive church-specific updates, and keep your Kandilo profile connected across web and mobile.</p>
    `,
    cta: { label: 'Verify Email', url: input.verificationUrl },
    footerNote: 'If you did not create a Kandilo account, you can ignore this email.',
    textLines: [
      'Confirm your email address to finish setting up your Kandilo account.',
    ],
  });
}

export function renderPasswordResetEmail(input: {
  displayName: string;
  resetUrl: string;
}): RenderedEmail {
  const displayName = cleanText(input.displayName, 'there');

  return renderLayout({
    subject: 'Reset your Kandilo password',
    preheader: 'Use this secure link to reset your Kandilo password.',
    eyebrow: 'Password Reset',
    title: `Hi, ${displayName}.`,
    subtitle: 'Use this secure link to reset your Kandilo password.',
    bodyHtml: `
      <p style="margin: 0;">This link is only for your Kandilo account. If you belong to multiple churches, your memberships stay attached to the same account after your password is changed.</p>
    `,
    cta: { label: 'Reset Password', url: input.resetUrl },
    footerNote: 'If you did not request a password reset, you can ignore this email and your password will remain unchanged.',
    textLines: [
      'Use this secure link to reset your Kandilo password.',
      'If you belong to multiple churches, your memberships stay attached to the same account after your password is changed.',
    ],
  });
}
