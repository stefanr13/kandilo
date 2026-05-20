/**
 * Creates the lean `saints_index` collection from the source saints JSON.
 *
 * saints_index/{date}
 *   date:  string  (YYYY-MM-DD)
 *   names: Array<{ sr_cyr, sr_lat, en, ru, uk, ro? }>
 *
 * The calendar UI reads from saints_index (names only).
 * The day-detail view reads from saints/{date} (full data including descriptions).
 *
 * Run with: SAINTS_YEAR=2027 npx tsx scripts/migrate-saints-index.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const PROJECT_ID = 'kandilo-2f7a9';
const DATABASE = '(default)';
const INDEX_COLLECTION = 'saints_index';
const BATCH_SIZE = 100;
const SAINTS_YEAR = process.env.SAINTS_YEAR ?? '2026';
const DATA_FILE = path.resolve(process.cwd(), `src/data/saints_${SAINTS_YEAR}_full.json`);
const FIREBASE_TOOLS_CONFIG = path.join(
  os.homedir(),
  '.config/configstore/firebase-tools.json'
);
const FIRESTORE_BASE =
  `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/${DATABASE}/documents`;

// ── Types ─────────────────────────────────────────────────────────────────────

interface LangMap {
  sr_cyr: string;
  sr_lat: string;
  en: string;
  ru: string;
  uk: string;
  ro?: string;
}

interface Saint {
  name: LangMap;
  description: LangMap;
}

interface SaintDay {
  date: string;
  saints: Saint[];
}

// ── Firestore REST value converters ──────────────────────────────────────────

type FSString = { stringValue: string };
type FSMap = { mapValue: { fields: Record<string, FSValue> } };
type FSArray = { arrayValue: { values: FSValue[] } };
type FSValue = FSString | FSMap | FSArray;

const str = (s: string): FSString => ({ stringValue: s });

const langMapToFS = (m: LangMap): FSMap => ({
  mapValue: {
    fields: {
      sr_cyr: str(m.sr_cyr),
      sr_lat: str(m.sr_lat),
      en: str(m.en),
      ru: str(m.ru),
      uk: str(m.uk),
      ...(m.ro !== undefined ? { ro: str(m.ro) } : {}),
    },
  },
});

function dayToIndexFields(day: SaintDay): Record<string, FSValue> {
  return {
    date: str(day.date),
    names: {
      arrayValue: {
        values: day.saints.map((s) => langMapToFS(s.name)),
      },
    },
  };
}

// ── Auth ──────────────────────────────────────────────────────────────────────

function loadAccessToken(): string {
  if (!fs.existsSync(FIREBASE_TOOLS_CONFIG)) {
    throw new Error('Firebase tools config not found. Run: npx firebase-tools@latest login');
  }
  const config = JSON.parse(fs.readFileSync(FIREBASE_TOOLS_CONFIG, 'utf-8'));
  const tokens = config?.tokens;
  if (!tokens?.access_token) {
    throw new Error('No access token. Run: npx firebase-tools@latest login');
  }
  const expiresAt: number = tokens.expires_at ?? 0;
  if (Date.now() >= expiresAt) {
    throw new Error('Token expired. Run: npx firebase-tools@latest login');
  }
  console.log(`Token valid for ~${Math.round((expiresAt - Date.now()) / 60000)} more minutes.`);
  return tokens.access_token as string;
}

// ── Firestore REST batchWrite ─────────────────────────────────────────────────

async function batchWrite(
  writes: Array<{ update: { name: string; fields: Record<string, FSValue> } }>,
  token: string
): Promise<void> {
  const resp = await fetch(`${FIRESTORE_BASE}:batchWrite`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ writes }),
  });

  if (!resp.ok) {
    throw new Error(`batchWrite failed (${resp.status}): ${await resp.text()}`);
  }

  const result = await resp.json() as { status?: Array<{ code?: number; message?: string }> };
  const failures = (result.status ?? []).filter((s) => s?.code && s.code !== 0);
  if (failures.length > 0) {
    throw new Error(`Partial write failures: ${JSON.stringify(failures)}`);
  }
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function migrate(): Promise<void> {
  console.log('=== Saints Index Migration ===\n');
  console.log('Building lean saints_index collection (names only, no descriptions).\n');

  if (!fs.existsSync(DATA_FILE)) {
    throw new Error(`Source file not found: ${DATA_FILE}`);
  }
  const days: SaintDay[] = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
  console.log(`Source: ${days.length} days from ${DATA_FILE}`);

  const token = loadAccessToken();

  const batches = chunk(days, BATCH_SIZE);
  console.log(
    `\nWriting ${days.length} index documents to "${INDEX_COLLECTION}"`
  );
  console.log(`Strategy: ${batches.length} batch(es) × ${BATCH_SIZE} docs\n`);

  let total = 0;
  for (let i = 0; i < batches.length; i++) {
    const batchDays = batches[i];

    const writes = batchDays.map((day) => ({
      update: {
        name: `projects/${PROJECT_ID}/databases/${DATABASE}/documents/${INDEX_COLLECTION}/${day.date}`,
        fields: dayToIndexFields(day),
      },
    }));

    await batchWrite(writes, token);
    total += batchDays.length;
    console.log(
      `  [${i + 1}/${batches.length}] ${batchDays[0].date} → ${batchDays[batchDays.length - 1].date}` +
        ` (${batchDays.length} docs) — total: ${total}/${days.length}`
    );
  }

  console.log(`\nDone! ${total} index documents written to "${INDEX_COLLECTION}".`);
  console.log('\nCalendar UI should now read from saints_index/{date} (names only).');
  console.log('Day-detail view should read from saints/{date} (full data).');
}

migrate().catch((err) => {
  console.error('\nMigration failed:', err.message);
  process.exit(1);
});
