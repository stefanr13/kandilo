import { describe, expect, it } from 'vitest';
import { orderPostTranslationPreviewItems } from './postTranslationPreview';

describe('orderPostTranslationPreviewItems', () => {
  it('orders supported translations and removes duplicates or unsupported entries', () => {
    expect(orderPostTranslationPreviewItems([
      { language: 'Русский', text: 'Тест' },
      { language: 'English', text: 'Test' },
      { language: 'Spanish', text: 'Prueba' },
      { language: 'Română', text: 'Test' },
      { language: 'english', text: 'Duplicate' },
      { language: 'Українська', text: 'Тест' },
    ])).toEqual([
      { language: 'English', text: 'Test' },
      { language: 'Русский', text: 'Тест' },
      { language: 'Română', text: 'Test' },
      { language: 'Українська', text: 'Тест' },
    ]);
  });
});
