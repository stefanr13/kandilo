import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * The backend giving module was split from a single `giving.ts` file into a
 * `giving/` directory (constants/helpers/operations/functions + barrel). The
 * source-layout guard tests scan its raw text, so they read the concatenated
 * directory rather than a single file. Files are concatenated in sorted order;
 * each declaration pair the guards slice on stays co-located within one file.
 */
export function readGivingModuleSource(): string {
  const dir = resolve(process.cwd(), 'functions/src/modules/giving');
  return readdirSync(dir)
    .filter((file) => file.endsWith('.ts'))
    .sort()
    .map((file) => readFileSync(resolve(dir, file), 'utf8'))
    .join('\n');
}
