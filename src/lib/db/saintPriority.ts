import type { Language } from '../../types';
import { getSaintLocalizedText, type SaintIndexDay, type SaintName } from './saints';

type SaintPriorityRank = 'great_feast' | 'serbian_major' | 'common_slava' | 'notable_orthodox';

interface SaintPriorityOverride {
  monthDay: string;
  rank: SaintPriorityRank;
  title: string;
  match?: RegExp;
}

export interface SaintDayDisplay {
  featuredName: string;
  additionalNames: string[];
  hiddenAdditionalCount: number;
  rank: SaintPriorityRank | 'source_primary';
}

const PRIORITY_OVERRIDES: SaintPriorityOverride[] = [
  { monthDay: '01-07', rank: 'great_feast', title: 'The Nativity of Our Lord Jesus Christ', match: /nativity|christmas|рождество|божић/i },
  { monthDay: '01-08', rank: 'great_feast', title: 'Synaxis of the Most Holy Theotokos', match: /synaxis.*theotokos|сабор.*богород/i },
  { monthDay: '01-09', rank: 'common_slava', title: 'St Stephen the Archdeacon', match: /stephen|stefan|стефан/i },
  { monthDay: '01-14', rank: 'great_feast', title: 'The Circumcision of Our Lord and St Basil the Great', match: /circumcision|basil|васили/i },
  { monthDay: '01-19', rank: 'great_feast', title: 'Theophany of Our Lord', match: /theophany|baptism.*lord|богојав/i },
  { monthDay: '01-20', rank: 'common_slava', title: 'Synaxis of St John the Baptist', match: /john.*baptist|јован.*крст|иоанн.*крест/i },
  { monthDay: '01-27', rank: 'serbian_major', title: 'St Sava, First Archbishop of Serbia', match: /sava|сава/i },
  { monthDay: '02-12', rank: 'notable_orthodox', title: 'Synaxis of the Three Holy Hierarchs', match: /three.*hierarch|три.*јерар|три.*свят/i },
  { monthDay: '02-14', rank: 'common_slava', title: 'St Tryphon the Martyr', match: /tryphon|trifun|триф/i },
  { monthDay: '02-15', rank: 'great_feast', title: 'The Meeting of Our Lord in the Temple', match: /meeting.*lord|presentation.*lord|сретење|сретение/i },
  { monthDay: '04-07', rank: 'great_feast', title: 'The Annunciation of the Most Holy Theotokos', match: /annunciation|благов/i },
  { monthDay: '04-08', rank: 'notable_orthodox', title: 'Synaxis of the Archangel Gabriel', match: /gabriel|гаври/i },
  { monthDay: '05-06', rank: 'common_slava', title: 'St George the Great Martyr', match: /george|ђорђ|георги/i },
  { monthDay: '05-12', rank: 'serbian_major', title: 'St Basil of Ostrog', match: /basil.*ostrog|vasilije.*ostrog|васили.*острог/i },
  { monthDay: '05-24', rank: 'serbian_major', title: 'Sts Cyril and Methodius', match: /cyril.*method|кирил.*метод/i },
  { monthDay: '06-03', rank: 'notable_orthodox', title: 'Sts Constantine and Helen', match: /constantine.*helen|константин.*јелен|константин.*елен/i },
  { monthDay: '06-28', rank: 'serbian_major', title: 'St Prince Lazar and the Holy Serbian Martyrs', match: /lazar|лазар|kosovo|косов/i },
  { monthDay: '07-07', rank: 'great_feast', title: 'Nativity of St John the Baptist', match: /nativity.*john.*baptist|рођење.*јован|рожд.*иоанн/i },
  { monthDay: '07-12', rank: 'common_slava', title: 'The Holy Apostles Peter and Paul', match: /peter.*paul|петар.*павле|петр.*пав/i },
  { monthDay: '07-20', rank: 'common_slava', title: 'St Kyriaki, Great Martyr', match: /kyriaki|nedelja|недељ/i },
  { monthDay: '08-02', rank: 'common_slava', title: 'St Elijah the Prophet', match: /elijah|ilija|илиј|илия/i },
  { monthDay: '08-09', rank: 'common_slava', title: 'St Panteleimon the Great Martyr', match: /pantele/i },
  { monthDay: '08-12', rank: 'serbian_major', title: 'Venerable Mother Angelina of Serbia', match: /angelina|ангелин/i },
  { monthDay: '08-19', rank: 'great_feast', title: 'The Transfiguration of Our Lord', match: /transfiguration|преображе/i },
  { monthDay: '08-28', rank: 'great_feast', title: 'The Dormition of the Most Holy Theotokos', match: /dormition|успење|успение/i },
  { monthDay: '09-01', rank: 'notable_orthodox', title: 'The Church New Year', match: /church new year|indiction|индикт/i },
  { monthDay: '09-07', rank: 'serbian_major', title: 'Synaxis of Serbian Saints', match: /serbian saints|српск.*свет/i },
  { monthDay: '09-11', rank: 'great_feast', title: 'The Beheading of St John the Baptist', match: /beheading.*john|усековање|усекновение/i },
  { monthDay: '09-21', rank: 'great_feast', title: 'The Nativity of the Most Holy Theotokos', match: /nativity.*theotokos|рођење.*богород|рожд.*богород/i },
  { monthDay: '09-27', rank: 'great_feast', title: 'The Exaltation of the Holy Cross', match: /exaltation.*cross|воздвижење|воздвижение/i },
  { monthDay: '10-27', rank: 'common_slava', title: 'St Petka Paraskeva', match: /petka|paraskeva|петка|параскев/i },
  { monthDay: '10-31', rank: 'serbian_major', title: 'St Peter of Cetinje', match: /peter.*cetinje|petar.*cetinj|петар.*цетињ/i },
  { monthDay: '11-08', rank: 'common_slava', title: 'St Demetrius the Great Martyr', match: /demetri|dimitri|димитри/i },
  { monthDay: '11-21', rank: 'common_slava', title: 'Synaxis of the Archangel Michael', match: /michael|mihail|миха/i },
  { monthDay: '12-04', rank: 'great_feast', title: 'The Entrance of the Theotokos into the Temple', match: /entrance.*theotokos|presentation.*theotokos|вavede|введен/i },
  { monthDay: '12-19', rank: 'common_slava', title: 'St Nicholas the Wonderworker', match: /nicholas|nikola|никол/i },
];

function monthDayFromDate(date: string): string {
  return date.slice(5, 10);
}

function findLocalizedPriorityName(
  names: SaintName[],
  language: Language,
  override: SaintPriorityOverride
): string {
  const matchedName = override.match
    ? names.find((name) => Object.values(name).some((value) => typeof value === 'string' && override.match?.test(value)))
    : null;

  return getSaintLocalizedText(matchedName, language, true) || override.title;
}

export function getSaintDayDisplay(
  day: SaintIndexDay | null | undefined,
  language: Language,
  additionalLimit = 3
): SaintDayDisplay {
  const names = day?.names ?? [];
  const localizedNames = names
    .map((name) => getSaintLocalizedText(name, language, false))
    .filter(Boolean);
  const override = day ? PRIORITY_OVERRIDES.find((entry) => entry.monthDay === monthDayFromDate(day.date)) : undefined;
  const featuredName = override
    ? findLocalizedPriorityName(names, language, override)
    : localizedNames[0] ?? '';
  const additionalNames = localizedNames
    .filter((name) => name !== featuredName)
    .slice(0, additionalLimit);
  const hiddenAdditionalCount = Math.max(localizedNames.filter((name) => name !== featuredName).length - additionalNames.length, 0);

  return {
    featuredName,
    additionalNames,
    hiddenAdditionalCount,
    rank: override?.rank ?? 'source_primary',
  };
}
