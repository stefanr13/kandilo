import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('EmailVerificationGate source', () => {
  it('lets signed-in users resend and refresh account email verification before app data loads', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'src/components/app/EmailVerificationGate.tsx'),
      'utf8'
    );

    expect(source).toContain("import { sendEmailVerificationEmail } from '../../lib/api/auth';");
    expect(source).toContain("import { signOut } from '../../lib/auth';");
    expect(source).toContain('const handleSendVerification = async () => {');
    expect(source).toContain('const result = await sendEmailVerificationEmail();');
    expect(source).toContain('await user.reload().catch(() => undefined);');
    expect(source).toContain('const handleCheckVerification = async () => {');
    expect(source).toContain('await user.reload();');
    expect(source).toContain('confirmIfVerified(user.emailVerified === true);');
    expect(source).toContain('onVerified();');
    expect(source).toContain('void signOut()');
    expect(source).toContain('t.emailVerificationBody');
  });
});
