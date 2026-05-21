import { describe, expect, it } from 'vitest';
import {
  renderDonationReceiptEmail,
  renderEmailVerificationEmail,
  renderInvitationEmail,
  renderNewsletterEmail,
  renderPasswordResetEmail,
  renderParishNotificationEmail,
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

  it('renders donation receipts without claiming tax status', () => {
    const email = renderDonationReceiptEmail({
      displayName: 'Mira',
      churchName: 'St. Sava',
      formattedAmount: '$50.00',
      purpose: 'General Fund',
      dateLabel: 'May 21, 2026',
      givingId: 'giving-1',
    });

    expect(email.subject).toBe('Donation receipt from St. Sava');
    expect(email.html).toContain('Reference');
    expect(email.html).toContain('giving-1');
    expect(email.html).not.toContain('registered non-profit');
  });

  it('renders role-aware parish notification emails', () => {
    const email = renderParishNotificationEmail({
      churchName: 'St. George',
      title: 'Service Reminder',
      body: 'Vespers begins at 6 PM.',
      senderName: 'Parish Office',
      audienceRoles: ['member', 'admin'],
      appUrl: 'https://app.kandilo.org',
      mobileAppUrl: 'kandilo://app/',
    });

    expect(email.subject).toBe('St. George: Service Reminder');
    expect(email.html).toContain('Parish Office');
    expect(email.html).toContain('members, admins');
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
