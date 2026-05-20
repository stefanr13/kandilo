import type { Language } from '../types';

export const PLATFORM_POST_PREVIEW_LANGUAGES: readonly Language[] = [
  'English',
  'Srpski (Latinica)',
  'Srpski (Ćirilica)',
  'Русский',
  'Română',
  'Українська',
] as const;

export interface PostTranslationPreviewItem {
  language: string;
  text: string;
}

export interface PostTranslationPreview {
  detectedSourceLanguage: string;
  translations: PostTranslationPreviewItem[];
}

export function orderPostTranslationPreviewItems(
  items: readonly PostTranslationPreviewItem[]
): PostTranslationPreviewItem[] {
  const byLanguage = new Map<string, PostTranslationPreviewItem>();

  for (const item of items) {
    const normalizedLanguage = item.language.trim().toLocaleLowerCase();
    const matchingLanguage = PLATFORM_POST_PREVIEW_LANGUAGES.find(
      (language) => language.toLocaleLowerCase() === normalizedLanguage
    );

    if (!matchingLanguage || byLanguage.has(matchingLanguage)) {
      continue;
    }

    const text = item.text.trim();
    if (!text) {
      continue;
    }

    byLanguage.set(matchingLanguage, {
      language: matchingLanguage,
      text,
    });
  }

  return PLATFORM_POST_PREVIEW_LANGUAGES.flatMap((language) => {
    const item = byLanguage.get(language);
    return item ? [item] : [];
  });
}
