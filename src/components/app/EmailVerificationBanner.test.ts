import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('EmailVerificationBanner source', () => {
  it('auto-sends verification email and throttles manual resends without blocking app usage', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'src/components/app/EmailVerificationBanner.tsx'),
      'utf8'
    );
    const appSource = readFileSync(resolve(process.cwd(), 'src/App.tsx'), 'utf8');
    const appShellSource = readFileSync(
      resolve(process.cwd(), 'src/components/app/AppShell.tsx'),
      'utf8'
    );
    const invitationSource = readFileSync(
      resolve(process.cwd(), 'src/components/InvitationAcceptScreen.tsx'),
      'utf8'
    );

    expect(appSource).not.toContain('EmailVerificationGate');
    expect(appSource).not.toContain('user.emailVerified !== true');
    expect(appShellSource).toContain('verificationBanner?: ReactNode;');
    expect(source).toContain("import { firebaseAuthErrorCode, sendAccountEmailVerification } from '../../lib/auth';");
    expect(source).toContain("void sendVerification('auto');");
    expect(source).toContain('getEmailVerificationSendState(user.uid');
    expect(source).toContain('await sendAccountEmailVerification(user);');
    expect(source).toContain("firebaseAuthErrorCode(error) === 'auth/too-many-requests'");
    expect(source).toContain('markEmailVerificationEmailSent(user.uid);');
    expect(source).toContain('emailVerificationBannerTitle');
    expect(source).toContain('emailVerificationBannerSendAgain');
    expect(source).toContain("window.addEventListener('focus', handleFocus);");
    expect(invitationSource).toContain("import EmailVerificationBanner from './app/EmailVerificationBanner';");
    expect(invitationSource).toContain('t.verifyEmailToAccept');
  });
});
