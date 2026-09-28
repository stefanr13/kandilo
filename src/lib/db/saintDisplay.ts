import type { Language } from '../../types';
import { getSaintLocalizedText, type SaintIndexDay } from './saints';

export interface SaintDayDisplay {
  featuredName: string;
  additionalNames: string[];
  hiddenAdditionalCount: number;
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
  const featuredName = getSaintLocalizedText(day?.primaryName, language, true) || localizedNames[0] || '';
  const additionalNames = localizedNames
    .filter((name) => name !== featuredName)
    .slice(0, additionalLimit);
  const hiddenAdditionalCount = Math.max(
    localizedNames.filter((name) => name !== featuredName).length - additionalNames.length,
    0
  );

  return {
    featuredName,
    additionalNames,
    hiddenAdditionalCount,
  };
}
