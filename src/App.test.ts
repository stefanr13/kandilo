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

  it('keeps unverified email accounts out of Firestore-backed app screens', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/App.tsx'), 'utf8');
    const gateIndex = source.indexOf('if (!user.isAnonymous && user.emailVerified !== true) {');
    const invitationIndex = source.indexOf('if (pendingInvitationId) {');
    const appIndex = source.indexOf('<AuthenticatedApp');

    expect(source).toContain("const EmailVerificationGate = lazy(() => import('./components/app/EmailVerificationGate'));");
    expect(source).toContain('const [emailVerificationRefreshKey, setEmailVerificationRefreshKey] = useState(0);');
    expect(gateIndex).toBeGreaterThan(source.indexOf('if (!user) {'));
    expect(gateIndex).toBeGreaterThan(-1);
    expect(invitationIndex).toBeGreaterThan(gateIndex);
    expect(appIndex).toBeGreaterThan(gateIndex);
    expect(source).toContain('key={`${user.uid}:${emailVerificationRefreshKey}`}');
    expect(source).toContain('onVerified={() => setEmailVerificationRefreshKey((current) => current + 1)}');
  });
});
