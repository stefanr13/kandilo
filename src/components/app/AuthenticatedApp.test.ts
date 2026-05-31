import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('AuthenticatedApp Stripe Connect return routing', () => {
  it('starts valid Stripe Connect returns directly on receipt management', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/components/app/AuthenticatedApp.tsx'), 'utf8');

    expect(source).toContain("const initialManagementTab = stripeConnectReturnSignal ? 'receipts' : null;");
    expect(source).not.toContain('getInitialManagementTab(');
  });
});
