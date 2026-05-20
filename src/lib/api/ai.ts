import { callFunction } from './client';
import type { PostTranslationPreview } from '../postTranslationPreview';

export interface FaithAiHistoryEntry {
  role: 'user' | 'model';
  text: string;
}

export async function sendFaithAiChat(input: {
  message: string;
  history: FaithAiHistoryEntry[];
}): Promise<{ text: string }> {
  return callFunction<typeof input, { text: string }>('faithAiChat', input);
}

export async function generateChurchPostContent(input: {
  churchId: string;
  prompt: string;
  tone: 'formal' | 'warm' | 'brief';
}): Promise<{ text: string }> {
  return callFunction<typeof input, { text: string }>('generatePostContent', input);
}

export async function previewChurchPostTranslations(input: {
  churchId: string;
  prompt: string;
}): Promise<PostTranslationPreview> {
  return callFunction<typeof input, PostTranslationPreview>('previewPostTranslations', input);
}
