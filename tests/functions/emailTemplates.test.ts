import { describe, expect, it } from 'vitest';
import {
  renderDonationReceiptEmail,
  renderEmailVerificationEmail,
  renderInvitationEmail,
  renderNewsletterEmail,
  renderPasswordResetEmail,
  renderParishNotificationEmail,
  renderTaxReceiptEmail,
} from '../../functions/src/shared/emailTemplates';

describe('email templates', () => {
  it('renders branded invitation emails with escaped church context', () => {
    const email = renderInvitationEmail({
      churchName: 'St. Nicholas <Parish>',
      inviteUrl: 'https://app.kandilo.org/join/invite-1',
      mobileInviteUrl: 'kandilo://app/join/invite-1',
      role: 'admin',
      invitedByName: 'Father Stefan',
      expiresLabel: 'June 1, 2026',
    });

    expect(email.subject).toBe("You're invited to St. Nicholas Parish on Kandilo");
    expect(email.html).toContain('Kandilo');
    expect(email.html).toContain('St. Nicholas &lt;Parish&gt;');
    expect(email.html).toContain('Accept Invitation');
    expect(email.html).toContain('kandilo://app/join/invite-1');
    expect(email.html).not.toContain('<Parish>');
    expect(email.text).toContain('Role: parish admin');
  });

  it('renders newsletter emails with the church name for multi-church users', () => {
    const email = renderNewsletterEmail({
      churchName: 'Holy Trinity',
      title: 'Sunday Bulletin',
      excerpt: 'This week in the parish.',
      appUrl: 'https://app.kandilo.org',
      mobileAppUrl: 'kandilo://app/',
    });

    expect(email.subject).toBe('New bulletin from Holy Trinity: Sunday Bulletin');
    expect(email.html).toContain('Holy Trinity');
    expect(email.html).toContain('kandilo://app/');
    expect(email.text).toContain('Church: Holy Trinity');
  });

  it('renders donation confirmations without claiming tax receipt status', () => {
    const email = renderDonationReceiptEmail({
      displayName: 'Mira',
      churchName: 'St. Sava',
      formattedAmount: '$50.00',
      purpose: 'General Fund',
      dateLabel: 'May 21, 2026',
      givingId: 'giving-1',
    });

    expect(email.subject).toBe('Donation confirmation from St. Sava');
    expect(email.html).toContain('official tax receipts are sent separately');
    expect(email.html).toContain('This payment confirmation is not an official tax receipt');
    expect(email.html).toContain('the official receipt is sent separately');
    expect(email.html).toContain('Reference');
    expect(email.html).toContain('giving-1');
    expect(email.text).toContain('This payment confirmation is not an official tax receipt.');
    expect(email.text).toContain('Official tax receipts are sent separately');
    expect(email.html).not.toContain('registered non-profit');
  });

  it('renders official tax receipt details separately from payment receipts', () => {
    const email = renderTaxReceiptEmail({
      donorName: 'Mira Petrovic',
      donorAddress: '10 Donor Street, Chicago, IL 60601, US',
      churchName: 'St. Sava',
      organizationName: 'St. Sava Orthodox Church',
      organizationAddress: '123 Church Street, Phoenix, AZ',
      taxId: '12-3456789',
      formattedAmount: '$250.00',
      eligibleAmount: '$250.00',
      purpose: 'General Fund',
      receivedDateLabel: 'May 24, 2026',
      issuedDateLabel: 'May 24, 2026',
      receiptNumber: 'STS-2026-000001',
      goodsServicesStatement: 'No goods or services were provided in exchange for this contribution.',
    });

    expect(email.subject).toBe('Tax receipt from St. Sava');
    expect(email.html).toContain('STS-2026-000001');
    expect(email.html).toContain('Donor Address');
    expect(email.text).toContain('Donor address: 10 Donor Street, Chicago, IL 60601, US');
    expect(email.html).toContain('Eligible Amount');
    expect(email.text).toContain('No goods or services were provided');
  });

  it('renders staged Canada CRA receipt fields separately from U.S. acknowledgments', () => {
    const email = renderTaxReceiptEmail({
      jurisdiction: 'CA',
      donorName: 'Mira Petrovic',
      donorAddress: '10 Donor Street, Edmonton, AB T5J 0N3, CA',
      churchName: 'St. Sava',
      organizationName: 'St. Sava Serbian Orthodox Church',
      organizationAddress: '123 Church Street, Edmonton, AB',
      taxId: '12345 6789 RR0001',
      formattedAmount: '$250.00',
      eligibleAmount: '$250.00',
      purpose: 'General Fund',
      receivedDateLabel: 'May 24, 2026',
      issuedDateLabel: 'May 24, 2026',
      receiptNumber: 'STS-2026-000011',
      goodsServicesStatement: 'No advantage was provided.',
      receiptIssueLocation: 'Edmonton, Alberta',
      authorizedSignerName: 'Fr. Sava',
      authorizedSignerTitle: 'Parish Priest',
    });

    expect(email.subject).toBe('Canadian receipt staging draft from St. Sava');
    expect(email.html).toContain('CRA receipt staging draft');
    expect(email.html).toContain('not valid for income tax purposes');
    expect(email.html).not.toContain('issued an official receipt for income tax purposes');
    expect(email.html).toContain('Charity Registration No.');
    expect(email.text).toContain('Charity registration number: 12345 6789 RR0001');
    expect(email.text).toContain('Canada Revenue Agency: canada.ca/charities-giving');
    expect(email.text).toContain('Issued location: Edmonton, Alberta');
    expect(email.text).toContain('Authorized signer: Fr. Sava, Parish Priest');
    expect(email.html).toContain('Advantage');
    expect(email.text).toContain('No advantage was provided.');
  });

  it('renders annual tax receipt summary warnings', () => {
    const email = renderTaxReceiptEmail({
      donorName: 'Mira Petrovic',
      churchName: 'St. Sava',
      organizationName: 'St. Sava Orthodox Church',
      formattedAmount: '$525.00',
      eligibleAmount: '$525.00',
      purpose: 'Annual giving summary',
      receivedDateLabel: 'January 1 - December 31, 2026',
      issuedDateLabel: 'January 15, 2027',
      receiptNumber: 'STS-2026-000009',
      goodsServicesStatement: 'No goods or services were provided in exchange for this contribution.',
      coveredPeriodLabel: 'January 1 - December 31, 2026',
      contributionCount: 7,
      contributions: [
        {
          dateLabel: 'January 5, 2026',
          purpose: 'Candles',
          amount: '$25.00',
          eligibleAmount: '$25.00',
        },
      ],
      annualSummaryNote: 'Do not claim both individual and annual receipts for the same gifts.',
    });

    expect(email.html).toContain('Contributions Included');
    expect(email.html).toContain('Contribution Detail');
    expect(email.html).toContain('attached PDF includes the itemized contribution detail');
    expect(email.html).toContain('Covered Period');
    expect(email.text).toContain('Contribution detail: included in the attached PDF.');
    expect(email.text).toContain('Contributions included: 7');
    expect(email.text).toContain('Do not claim both individual and annual receipts');
  });

  it('renders corrected tax receipt context and adjusted amounts', () => {
    const email = renderTaxReceiptEmail({
      donorName: 'Mira Petrovic',
      churchName: 'St. Sava',
      organizationName: 'St. Sava Orthodox Church',
      formattedAmount: '$75.00',
      eligibleAmount: '$75.00',
      originalAmount: '$100.00',
      refundedAmount: '$25.00',
      purpose: 'General Fund',
      receivedDateLabel: 'May 24, 2026',
      issuedDateLabel: 'May 25, 2026',
      receiptNumber: 'STS-2026-000010',
      goodsServicesStatement: 'No goods or services were provided in exchange for this contribution.',
      correctionLabel: 'Corrected receipt',
      correctionNote:
        'This corrected receipt replaces a prior receipt after a partial refund or adjustment.',
    });

    expect(email.subject).toBe('Corrected tax receipt from St. Sava');
    expect(email.html).toContain('Receipt Type');
    expect(email.html).toContain('Corrected receipt');
    expect(email.html).toContain('Original Amount');
    expect(email.html).toContain('$100.00');
    expect(email.html).toContain('Refunded Amount');
    expect(email.text).toContain('Receipt type: Corrected receipt');
    expect(email.text).toContain('Original amount: $100.00');
    expect(email.text).toContain('Refunded amount: $25.00');
  });

  it('renders role-aware parish notification emails', () => {
    const email = renderParishNotificationEmail({
      churchName: 'St. George',
      title: 'Service Reminder',
      body: 'Vespers begins at 6 PM.',
      senderName: 'Parish Office',
      audienceRoles: ['member', 'admin', 'treasurer'],
      appUrl: 'https://app.kandilo.org',
      mobileAppUrl: 'kandilo://app/',
    });

    expect(email.subject).toBe('St. George: Service Reminder');
    expect(email.html).toContain('Parish Office');
    expect(email.html).toContain('members, admins, treasurers');
    expect(email.html).toContain('kandilo://app/');
    expect(email.text).toContain('If you belong to multiple churches');
  });

  it('renders branded auth action emails', () => {
    const verification = renderEmailVerificationEmail({
      displayName: 'Stefan',
      verificationUrl: 'https://example.com/verify',
    });
    const reset = renderPasswordResetEmail({
      displayName: 'Stefan',
      resetUrl: 'https://example.com/reset',
    });

    expect(verification.subject).toBe('Verify your Kandilo email');
    expect(verification.html).toContain('Verify Email');
    expect(reset.subject).toBe('Reset your Kandilo password');
    expect(reset.text).toContain('your memberships stay attached');
  });
});
