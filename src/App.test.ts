import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('App auth routing', () => {
  it('can short-circuit production to the coming soon screen before auth loads', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/App.tsx'), 'utf8');
    const comingSoonIndex = source.indexOf('if (COMING_SOON_ENABLED) {');
    const authIndex = source.indexOf('const { user, loading: authLoading, isSuperAdmin } = useAuth();');

    expect(source).toContain("import ComingSoonScreen from './components/app/ComingSoonScreen';");
    expect(source).toContain("import { COMING_SOON_ENABLED } from './config/features';");
    expect(source).toContain('return <ComingSoonScreen />;');
    expect(comingSoonIndex).toBeGreaterThan(-1);
    expect(authIndex).toBeGreaterThan(comingSoonIndex);
  });

  it('does not gate app routing on email verification', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/App.tsx'), 'utf8');
    const invitationIndex = source.indexOf('if (pendingInvitationId) {');
    const appIndex = source.indexOf('<AuthenticatedApp');

    expect(source).not.toContain('EmailVerificationGate');
    expect(source).not.toContain('emailVerificationRefreshKey');
    expect(source).not.toContain('if (!user.isAnonymous && user.emailVerified !== true) {');
    expect(invitationIndex).toBeGreaterThan(source.indexOf('if (!user) {'));
    expect(appIndex).toBeGreaterThan(invitationIndex);
  });
});
