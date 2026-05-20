import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const PROJECT_ID = 'kandilo-2f7a9';
const DATABASE = '(default)';
const COLLECTION = 'saints';
const BATCH_SIZE = 50; // conservative: each saint doc can be large
const SAINTS_YEAR = process.env.SAINTS_YEAR ?? '2026';
const DATA_FILE = path.resolve(process.cwd(), `src/data/saints_${SAINTS_YEAR}_full.json`);
const FIREBASE_TOOLS_CONFIG = path.join(
  os.homedir(),
  '.config/configstore/firebase-tools.json'
);

const FIRESTORE_BASE =
  `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/${DATABASE}/documents`;

interface SaintName {
  sr_cyr: string;
  sr_lat: string;
  en: string;
  ru: string;
  uk: string;
  ro?: string;
}

interface Saint {
  name: SaintName;
  description: SaintName;
}

interface SaintDay {
  date: string;
  saints: Saint[];
}

// ── Firestore REST value converters ──────────────────────────────────────────

type FirestoreValue =
  | { stringValue: string }
  | { arrayValue: { values: FirestoreValue[] } }
  | { mapValue: { fields: Record<string, FirestoreValue> } }
  | { nullValue: 'NULL_VALUE' };

function toFSString(s: string): FirestoreValue {
  return { stringValue: s };
}

function toFSMap(obj: Record<string, string>): FirestoreValue {
  const fields: Record<string, FirestoreValue> = {};
  for (const [k, v] of Object.entries(obj)) {
    fields[k] = toFSString(v);
  }
  return { mapValue: { fields } };
}

function saintToFSMap(saint: Saint): FirestoreValue {
  return {
    mapValue: {
      fields: {
        name: toFSMap(saint.name as unknown as Record<string, string>),
        description: toFSMap(saint.description as unknown as Record<string, string>),
      },
    },
  };
}

function dayToFSFields(day: SaintDay): Record<string, FirestoreValue> {
  return {
    date: toFSString(day.date),
    saints: {
      arrayValue: {
        values: day.saints.map(saintToFSMap),
      },
    },
  };
}

// ── Auth ──────────────────────────────────────────────────────────────────────

function loadAccessToken(): string {
  if (!fs.existsSync(FIREBASE_TOOLS_CONFIG)) {
    throw new Error(
      `Firebase tools config not found. Run: npx firebase-tools@latest login`
    );
  }
  const config = JSON.parse(fs.readFileSync(FIREBASE_TOOLS_CONFIG, 'utf-8'));
  const tokens = config?.tokens;
  if (!tokens?.access_token) {
    throw new Error('No access token found. Run: npx firebase-tools@latest login');
  }
  const expiresAt: number = tokens.expires_at ?? 0;
  const now = Date.now();
  if (now >= expiresAt) {
    throw new Error('Firebase access token has expired. Run: npx firebase-tools@latest login');
  }
  console.log(`Token valid for ~${Math.round((expiresAt - now) / 60000)} more minutes.`);
  return tokens.access_token as string;
}

// ── Validation ────────────────────────────────────────────────────────────────

function validateData(data: unknown[]): SaintDay[] {
  const REQUIRED_LANGS = ['sr_cyr', 'sr_lat', 'en', 'ru', 'uk'] as const;

  if (!Array.isArray(data) || data.length === 0) {
    throw new Error('Data file is empty or not an array.');
  }

  for (let i = 0; i < data.length; i++) {
    const entry = data[i] as SaintDay;
    if (!entry.date || !/^\d{4}-\d{2}-\d{2}$/.test(entry.date)) {
      throw new Error(`Entry at index ${i} has invalid or missing date field.`);
    }
    if (!Array.isArray(entry.saints)) {
      throw new Error(`Entry ${entry.date} is missing the saints array field.`);
    }
    for (const saint of entry.saints) {
      for (const lang of REQUIRED_LANGS) {
        if (typeof saint.name?.[lang] !== 'string' || typeof saint.description?.[lang] !== 'string') {
          throw new Error(
            `Entry ${entry.date}: saint is missing language key "${lang}" in name or description.`
          );
        }
      }
    }
  }

  return data as SaintDay[];
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function chunk<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

// ── Firestore REST batchWrite ─────────────────────────────────────────────────

interface BatchWrite {
  writes: Array<{
    update: {
      name: string;
      fields: Record<string, FirestoreValue>;
    };
  }>;
}

async function batchWrite(writes: BatchWrite['writes'], token: string): Promise<void> {
  const url = `${FIRESTORE_BASE}:batchWrite`;
  const body: BatchWrite = { writes };

  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`Firestore batchWrite failed (${resp.status}): ${errText}`);
  }

  const result = await resp.json() as { writeResults?: unknown[]; status?: unknown[] };
  const statuses = result.status as Array<{ code?: number; message?: string }> | undefined;
  if (statuses) {
    const failures = statuses.filter((s) => s?.code && s.code !== 0);
    if (failures.length > 0) {
      throw new Error(`Partial write failures: ${JSON.stringify(failures)}`);
    }
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function seed(): Promise<void> {
  console.log('=== Saints Calendar Seed Script ===\n');

  // 1. Load and validate source data
  if (!fs.existsSync(DATA_FILE)) {
    throw new Error(`Source file not found: ${DATA_FILE}`);
  }
  const raw = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
  const days = validateData(raw);
  console.log(`Validated ${days.length} days (${days.filter((d) => d.saints.length === 0).length} with empty saints array)`);
  console.log(`Data file: ${DATA_FILE}`);

  // 2. Load auth token
  const token = loadAccessToken();

  // 3. Build batches and upload
  const batches = chunk(days, BATCH_SIZE);
  console.log(
    `\nUploading ${days.length} documents to "${COLLECTION}" collection`
  );
  console.log(`Strategy: ${batches.length} batch(es) × ${BATCH_SIZE} docs via Firestore REST batchWrite\n`);

  let totalWritten = 0;
  for (let batchIdx = 0; batchIdx < batches.length; batchIdx++) {
    const batchDays = batches[batchIdx];

    const writes = batchDays.map((day) => ({
      update: {
        name: `projects/${PROJECT_ID}/databases/${DATABASE}/documents/${COLLECTION}/${day.date}`,
        fields: dayToFSFields(day),
      },
    }));

    await batchWrite(writes, token);
    totalWritten += batchDays.length;

    console.log(
      `  [${batchIdx + 1}/${batches.length}] ${batchDays[0].date} → ${batchDays[batchDays.length - 1].date}` +
        ` (${batchDays.length} docs) — total: ${totalWritten}/${days.length}`
    );
  }

  console.log(`\nDone! Successfully seeded ${totalWritten} documents into "${COLLECTION}" collection.`);
  console.log(`Project: ${PROJECT_ID} | Firestore: https://console.firebase.google.com/project/${PROJECT_ID}/firestore`);
}

seed().catch((err) => {
  console.error('\nSeed failed:', err.message);
  process.exit(1);
});
