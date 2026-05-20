/**
 * Creates monthly aggregate docs for low-cost calendar rendering.
 *
 * saints_index_months/{YYYY-MM}
 *   month: string
 *   days: Record<YYYY-MM-DD, { date, names }>
 *
 * Calendar month views read one aggregate document instead of querying
 * 28-31 daily saints_index documents.
 *
 * Run with: SAINTS_YEAR=2027 npx tsx scripts/migrate-saints-index-months.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const PROJECT_ID = 'kandilo-2f7a9';
const DATABASE = '(default)';
const MONTH_COLLECTION = 'saints_index_months';
const SAINTS_YEAR = process.env.SAINTS_YEAR ?? '2026';
const DATA_FILE = path.resolve(process.cwd(), `src/data/saints_${SAINTS_YEAR}_full.json`);
const FIREBASE_TOOLS_CONFIG = path.join(
  os.homedir(),
  '.config/configstore/firebase-tools.json'
);
const FIRESTORE_BASE =
  `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/${DATABASE}/documents`;

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

type FSString = { stringValue: string };
type FSMap = { mapValue: { fields: Record<string, FSValue> } };
type FSArray = { arrayValue: { values: FSValue[] } };
type FSValue = FSString | FSMap | FSArray;

const str = (s: string): FSString => ({ stringValue: s });

function langMapToFS(m: LangMap): FSMap {
  return {
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
  };
}

function dayToFS(day: SaintDay): FSMap {
  return {
    mapValue: {
      fields: {
        date: str(day.date),
        names: {
          arrayValue: {
            values: day.saints.map((saint) => langMapToFS(saint.name)),
          },
        },
      },
    },
  };
}

function monthToFields(month: string, days: SaintDay[]): Record<string, FSValue> {
  return {
    month: str(month),
    days: {
      mapValue: {
        fields: Object.fromEntries(days.map((day) => [day.date, dayToFS(day)])),
      },
    },
  };
}

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

function groupByMonth(days: SaintDay[]): Map<string, SaintDay[]> {
  const months = new Map<string, SaintDay[]>();
  for (const day of days) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day.date)) {
      throw new Error(`Invalid date: ${day.date}`);
    }
    const month = day.date.slice(0, 7);
    months.set(month, [...(months.get(month) ?? []), day]);
  }

  for (const [month, monthDays] of months) {
    monthDays.sort((a, b) => a.date.localeCompare(b.date));
    const expected = new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0).getDate();
    if (monthDays.length !== expected) {
      throw new Error(`${month} has ${monthDays.length} days; expected ${expected}.`);
    }
  }

  return new Map([...months.entries()].sort(([a], [b]) => a.localeCompare(b)));
}

async function writeMonth(month: string, days: SaintDay[], token: string): Promise<void> {
  const body = {
    writes: [
      {
        update: {
          name: `projects/${PROJECT_ID}/databases/${DATABASE}/documents/${MONTH_COLLECTION}/${month}`,
          fields: monthToFields(month, days),
        },
      },
    ],
  };

  const resp = await fetch(`${FIRESTORE_BASE}:batchWrite`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    throw new Error(`batchWrite failed (${resp.status}): ${await resp.text()}`);
  }
}

async function migrate(): Promise<void> {
  console.log('=== Saints Monthly Index Migration ===\n');

  if (!fs.existsSync(DATA_FILE)) {
    throw new Error(`Source file not found: ${DATA_FILE}`);
  }
  const days: SaintDay[] = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
  const months = groupByMonth(days);
  console.log(`Source: ${days.length} days from ${DATA_FILE}`);
  console.log(`Writing ${months.size} monthly aggregate documents.\n`);

  const token = loadAccessToken();

  let total = 0;
  for (const [month, monthDays] of months) {
    await writeMonth(month, monthDays, token);
    total++;
    console.log(`  [${total}/${months.size}] ${month} (${monthDays.length} days)`);
  }

  console.log(`\nDone! ${total} documents written to "${MONTH_COLLECTION}".`);
}

migrate().catch((err) => {
  console.error('\nMigration failed:', err.message);
  process.exit(1);
});
