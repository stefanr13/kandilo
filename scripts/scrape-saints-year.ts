import * as fs from 'fs';
import * as path from 'path';

type LangKey = 'sr_cyr' | 'sr_lat' | 'en' | 'ru' | 'uk' | 'ro';

interface ParsedSaint {
  name: string;
  description: string;
}

interface SaintName {
  sr_cyr: string;
  sr_lat: string;
  en: string;
  ru: string;
  uk: string;
  ro: string;
}

interface SaintDetail {
  name: SaintName;
  description: SaintName;
}

interface SaintDay {
  date: string;
  saints: SaintDetail[];
}

const SOURCE_ORIGIN = 'https://crkvenikalendar.com';
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36';
const SCRAPED_LANGS: Array<{ key: Exclude<LangKey, 'sr_lat'>; prefix: string }> = [
  { key: 'sr_cyr', prefix: 'datum' },
  { key: 'en', prefix: 'datumen' },
  { key: 'ru', prefix: 'datumru' },
  { key: 'uk', prefix: 'datumua' },
  { key: 'ro', prefix: 'datumro' },
];

const cyrToLatMap: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', ђ: 'đ', е: 'e', ж: 'ž', з: 'z', и: 'i',
  ј: 'j', к: 'k', л: 'l', љ: 'lj', м: 'm', н: 'n', њ: 'nj', о: 'o', п: 'p', р: 'r',
  с: 's', т: 't', ћ: 'ć', у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'č', џ: 'dž', ш: 'š',
  А: 'A', Б: 'B', В: 'V', Г: 'G', Д: 'D', Ђ: 'Đ', Е: 'E', Ж: 'Ž', З: 'Z', И: 'I',
  Ј: 'J', К: 'K', Л: 'L', Љ: 'Lj', М: 'M', Н: 'N', Њ: 'Nj', О: 'O', П: 'P', Р: 'R',
  С: 'S', Т: 'T', Ћ: 'Ć', У: 'U', Ф: 'F', Х: 'H', Ц: 'C', Ч: 'Č', Џ: 'Dž', Ш: 'Š',
};

function transliterate(text: string): string {
  return text.split('').map((char) => cyrToLatMap[char] ?? char).join('');
}

function decodeHtml(input: string): string {
  return input
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&iuml;/g, 'ï')
    .replace(/&icirc;/g, 'î')
    .replace(/&Icirc;/g, 'Î')
    .replace(/&acirc;/g, 'â')
    .replace(/&Acirc;/g, 'Â')
    .replace(/&ă/g, 'ă')
    .replace(/&ş/g, 'ş')
    .replace(/&ţ/g, 'ţ');
}

function cleanHtml(input: string): string {
  return decodeHtml(input)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function parseSaints(html: string): ParsedSaint[] {
  const saints: ParsedSaint[] = [];
  const re =
    /<span class="normalan_naslov">\s*<h1>([\s\S]*?)<\/h1>\s*<\/span>\s*<div[^>]*class="indexopis"[^>]*>([\s\S]*?)<\/div>/g;

  for (const match of html.matchAll(re)) {
    const descriptionMatch = match[2].match(/<span class="tekst_opis"[^>]*>([\s\S]*?)<\/span>/);
    saints.push({
      name: cleanHtml(match[1]),
      description: cleanHtml(descriptionMatch?.[1] ?? ''),
    });
  }

  return saints.filter((saint) => saint.name || saint.description);
}

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function parseCalendarFallbackNames(
  html: string,
  prefix: string,
  year: number,
  month: number,
  dayOfMonth: number
): ParsedSaint[] {
  const href = `/${prefix}-${year}-${month}-${dayOfMonth}`;
  const cellRe = new RegExp(
    `<td[\\s\\S]*?onClick="document\\.location\\.href='${escapeRegExp(href)}'"[\\s\\S]*?<\\/td>`,
    'i'
  );
  const cell = html.match(cellRe)?.[0];
  if (!cell) return [];

  const title = cell.match(/title="([\s\S]*?)"/)?.[1];
  const body = title?.match(/body=\[([\s\S]*?)\]$/)?.[1];
  if (!body) return [];

  return Array.from(body.matchAll(/<div[^>]*>([\s\S]*?)<\/div>/g))
    .map((match) => ({ name: cleanHtml(match[1]), description: '' }))
    .filter((saint) => saint.name);
}

async function fetchWithRetry(url: string, attempts = 3): Promise<string> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await fetch(url, { headers: { 'user-agent': USER_AGENT } });
      if (!response.ok) {
        throw new Error(`${response.status} ${response.statusText}`);
      }
      return await response.text();
    } catch (err) {
      lastError = err;
      await delay(500 * attempt);
    }
  }
  throw new Error(`Failed to fetch ${url}: ${String(lastError)}`);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function daysInYear(year: number): Date[] {
  const days: Date[] = [];
  for (const date = new Date(Date.UTC(year, 0, 1)); date.getUTCFullYear() === year; date.setUTCDate(date.getUTCDate() + 1)) {
    days.push(new Date(date));
  }
  return days;
}

function dateKey(date: Date): string {
  return [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, '0'),
    String(date.getUTCDate()).padStart(2, '0'),
  ].join('-');
}

function buildEmptyMap(): SaintName {
  return { sr_cyr: '', sr_lat: '', en: '', ru: '', uk: '', ro: '' };
}

async function scrapeDay(date: Date): Promise<{ day: SaintDay; counts: Record<string, number> }> {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + 1;
  const dayOfMonth = date.getUTCDate();
  const key = dateKey(date);
  const parsedByLang = new Map<LangKey, ParsedSaint[]>();

  await Promise.all(
    SCRAPED_LANGS.map(async ({ key: langKey, prefix }) => {
      const html = await fetchWithRetry(`${SOURCE_ORIGIN}/${prefix}-${year}-${month}-${dayOfMonth}`);
      const parsed = parseSaints(html);
      parsedByLang.set(
        langKey,
        parsed.length > 0
          ? parsed
          : parseCalendarFallbackNames(html, prefix, year, month, dayOfMonth)
      );
    })
  );

  const srSaints = parsedByLang.get('sr_cyr') ?? [];
  parsedByLang.set(
    'sr_lat',
    srSaints.map((saint) => ({
      name: transliterate(saint.name),
      description: transliterate(saint.description),
    }))
  );

  const maxSaints = Math.max(...Array.from(parsedByLang.values()).map((saints) => saints.length));
  if (maxSaints === 0) {
    throw new Error(`No saints parsed for ${key}`);
  }

  const saints: SaintDetail[] = [];
  for (let i = 0; i < maxSaints; i++) {
    const name = buildEmptyMap();
    const description = buildEmptyMap();

    for (const langKey of ['sr_cyr', 'sr_lat', 'en', 'ru', 'uk', 'ro'] as const) {
      const saint = parsedByLang.get(langKey)?.[i];
      name[langKey] = saint?.name ?? '';
      description[langKey] = saint?.description ?? '';
    }

    saints.push({ name, description });
  }

  return {
    day: { date: key, saints },
    counts: Object.fromEntries(
      Array.from(parsedByLang.entries()).map(([langKey, saints]) => [langKey, saints.length])
    ) as Record<string, number>,
  };
}

function parseYear(): number {
  const argYear = process.argv.find((arg) => /^\d{4}$/.test(arg));
  const year = Number(process.env.SAINTS_YEAR ?? argYear ?? '2027');
  if (!Number.isInteger(year) || year < 1970 || year > 2100) {
    throw new Error('Provide a valid year between 1970 and 2100.');
  }
  return year;
}

async function main(): Promise<void> {
  const year = parseYear();
  const outputFile = path.resolve(process.cwd(), `src/data/saints_${year}_full.json`);

  if (fs.existsSync(outputFile) && process.env.OVERWRITE !== '1') {
    throw new Error(`Output file already exists: ${outputFile}. Set OVERWRITE=1 to replace it.`);
  }

  console.log(`Scraping saints calendar data for ${year}`);
  console.log(`Source: ${SOURCE_ORIGIN}/index_en.php`);
  console.log(`Output: ${outputFile}\n`);

  const allDays = daysInYear(year);
  const result: SaintDay[] = [];
  const mismatchedDays: Array<{ date: string; counts: Record<string, number> }> = [];

  for (const [index, date] of allDays.entries()) {
    const { day, counts } = await scrapeDay(date);
    result.push(day);

    const uniqueCounts = new Set(Object.values(counts));
    if (uniqueCounts.size > 1) {
      mismatchedDays.push({ date: day.date, counts });
    }

    if ((index + 1) % 25 === 0 || index === allDays.length - 1) {
      console.log(`  ${index + 1}/${allDays.length} days scraped, latest ${day.date}`);
    }

    await delay(125);
  }

  fs.writeFileSync(outputFile, `${JSON.stringify(result, null, 2)}\n`, 'utf-8');

  console.log(`\nWrote ${result.length} days.`);
  console.log(`Total saint rows: ${result.reduce((sum, day) => sum + day.saints.length, 0)}`);
  console.log(`Days with uneven source-language counts: ${mismatchedDays.length}`);
  if (mismatchedDays.length > 0) {
    console.log('Sample uneven days:');
    for (const item of mismatchedDays.slice(0, 8)) {
      console.log(`  ${item.date}: ${JSON.stringify(item.counts)}`);
    }
  }
}

main().catch((err) => {
  console.error(`\nScrape failed: ${err.message}`);
  process.exit(1);
});
