import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('saints priority Firestore source', () => {
  it('keeps Serbian Orthodox priority generation in migration scripts, not the client UI', () => {
    const root = process.cwd();
    const dailyIndex = readFileSync(resolve(root, 'scripts/migrate-saints-index.ts'), 'utf8');
    const monthlyIndex = readFileSync(resolve(root, 'scripts/migrate-saints-index-months.ts'), 'utf8');
    const fullSeed = readFileSync(resolve(root, 'scripts/seed-saints.ts'), 'utf8');
    const displayHelper = readFileSync(resolve(root, 'src/lib/db/saintDisplay.ts'), 'utf8');

    expect(dailyIndex).toContain('getSaintPriorityMetadata');
    expect(monthlyIndex).toContain('getSaintPriorityMetadata');
    expect(fullSeed).toContain('getSaintPriorityMetadata');
    expect(displayHelper).toContain('day?.primaryName');
    expect(displayHelper).not.toContain('PRIORITY_OVERRIDES');
  });
});
