import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { ALLOWED_TONES, GeminiTone, getGemini } from '../shared/clients';
import {
  appCheckCallableOptions,
  assertActiveChurchRole,
  assertVerifiedNonAnonymousUser,
  checkRateLimit,
} from '../shared/security';
import { sanitizedErrorContext } from '../shared/logging';
import { assertNonEmptyString, callableDataRecord } from '../shared/validation';

const POST_TRANSLATION_PREVIEW_LANGUAGES = [
  'English',
  'Srpski (Latinica)',
  'Srpski (Ćirilica)',
  'Русский',
  'Română',
  'Українська',
] as const;

const GEMINI_TEXT_MODEL = 'gemini-3.1-flash-lite';

const POST_TRANSLATION_PREVIEW_MODELS = [
  GEMINI_TEXT_MODEL,
  'gemini-2.5-flash-lite',
] as const;

interface PostTranslationPreviewItem {
  language: string;
  text: string;
}

interface PostTranslationPreviewResult {
  detectedSourceLanguage: string;
  translations: PostTranslationPreviewItem[];
}

async function generatePostTranslationPreview(prompt: string): Promise<PostTranslationPreviewResult> {
  const ai = getGemini();
  const supportedLanguagesList = POST_TRANSLATION_PREVIEW_LANGUAGES.join(', ');
  const systemPrompt = `You are assisting an Orthodox Christian parish communications team.
The user will provide the original short prompt for a parish post or announcement.
Detect the prompt's source language.
Return strict JSON with this shape:
{
  "detectedSourceLanguage": "string",
  "translations": [
    {
      "language": "string",
      "text": "string"
    }
  ]
}
Translate the original prompt, not a full post, into these platform-supported languages: ${supportedLanguagesList}.
If the source language exactly matches one of those platform-supported languages, omit that language from the translations array.
If the source language is not one of those platform-supported languages, include all platform-supported languages.
Preserve meaning, tone, and Orthodox Christian terminology. Do not add notes, explanations, or markdown fences.`;

  let lastError: unknown;
  for (const model of POST_TRANSLATION_PREVIEW_MODELS) {
    try {
      const result = await ai.models.generateContent({
        model,
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        config: {
          systemInstruction: systemPrompt,
          responseMimeType: 'application/json',
        },
      });
      const text = result.text?.trim();
      if (!text) {
        throw new HttpsError('internal', 'Translation preview returned an empty response.');
      }

      const parsed = JSON.parse(text) as Partial<PostTranslationPreviewResult>;
      const detectedSourceLanguage =
        typeof parsed.detectedSourceLanguage === 'string'
          ? parsed.detectedSourceLanguage.trim()
          : '';
      const translations = Array.isArray(parsed.translations)
        ? parsed.translations.filter(
            (entry): entry is PostTranslationPreviewItem =>
              typeof entry === 'object' &&
              entry !== null &&
              typeof entry.language === 'string' &&
              typeof entry.text === 'string' &&
              entry.language.trim().length > 0 &&
              entry.text.trim().length > 0
          )
        : [];

      if (!detectedSourceLanguage) {
        throw new HttpsError('internal', 'Translation preview did not include a detected source language.');
      }

      return { detectedSourceLanguage, translations };
    } catch (error) {
      lastError = error;
      console.warn(
        `generatePostTranslationPreview failed for model ${model}`,
        sanitizedErrorContext(error)
      );
    }
  }

  if (lastError) {
    console.warn(
      'Unable to generate post translation preview after all model attempts.',
      sanitizedErrorContext(lastError)
    );
  }
  throw new HttpsError('internal', 'Unable to generate post translation preview.');
}

export const faithAiChat = onCall({ ...appCheckCallableOptions, secrets: ['GEMINI_API_KEY'] }, async (request) => {
  assertVerifiedNonAnonymousUser(request, 'Faith AI is available only to verified, non-anonymous accounts.');
  await checkRateLimit(request.auth!.uid, 'faithAiChat', 20);

  const data = callableDataRecord(request.data);
  const { message, history = [] } = data;

  if (!message || typeof message !== 'string' || message.trim().length === 0) {
    throw new HttpsError('invalid-argument', 'message is required.');
  }
  if (message.length > 2000) {
    throw new HttpsError('invalid-argument', 'message must be ≤ 2000 characters.');
  }

  if (!Array.isArray(history)) {
    throw new HttpsError('invalid-argument', 'history must be an array.');
  }
  if (history.length > 40) {
    throw new HttpsError('invalid-argument', 'history must contain at most 40 messages.');
  }
  const safeHistory: { role: 'user' | 'model'; text: string }[] = [];
  for (const entry of history) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      throw new HttpsError('invalid-argument', 'history entries must be objects.');
    }
    const { role, text } = entry as Record<string, unknown>;
    if (role !== 'user' && role !== 'model') {
      throw new HttpsError('invalid-argument', "history entries must have role 'user' or 'model'.");
    }
    if (typeof text !== 'string' || text.length > 4000) {
      throw new HttpsError('invalid-argument', 'Each history entry text must be a string ≤ 4000 characters.');
    }
    safeHistory.push({ role, text });
  }

  const ai = getGemini();
  const systemPrompt = `You are a knowledgeable and compassionate Orthodox Christian spiritual guide. 
You help parishioners understand Orthodox theology, traditions, saints, fasting practices, sacraments, 
and the liturgical calendar. Respond with warmth and depth, grounded in the Church Fathers and Orthodox 
tradition. Keep responses clear and appropriate for all ages. If asked about something outside Orthodox 
Christianity, gently redirect to how the faith might address the topic.`;

  const contents = [
    ...safeHistory.map((h) => ({
      role: h.role,
      parts: [{ text: h.text }],
    })),
    { role: 'user' as const, parts: [{ text: message }] },
  ];

  try {
    const result = await ai.models.generateContent({
      model: GEMINI_TEXT_MODEL,
      contents,
      config: { systemInstruction: systemPrompt },
    });

    return { text: result.text ?? '' };
  } catch (error) {
    console.error('faithAiChat failed:', sanitizedErrorContext(error));
    throw new HttpsError('unavailable', 'Faith AI is temporarily unavailable.');
  }
});

export const previewPostTranslations = onCall({ ...appCheckCallableOptions, secrets: ['GEMINI_API_KEY'] }, async (request) => {
  assertVerifiedNonAnonymousUser(request, 'A verified, non-anonymous account is required to preview translations.');
  await checkRateLimit(request.auth!.uid, 'previewPostTranslations', 10);

  const data = callableDataRecord(request.data);
  const { churchId: rawChurchId, prompt: rawPrompt } = data;
  const churchId = assertNonEmptyString(rawChurchId, 128, 'churchId');
  const prompt = assertNonEmptyString(rawPrompt, 1000, 'prompt');

  await assertActiveChurchRole(
    churchId,
    request.auth!.uid,
    ['admin', 'priest'],
    'Only active admins and priests can preview post translations.'
  );

  const preview = await generatePostTranslationPreview(prompt);

  return {
    detectedSourceLanguage: preview.detectedSourceLanguage,
    translations: preview.translations,
  };
});

export const generatePostContent = onCall({ ...appCheckCallableOptions, secrets: ['GEMINI_API_KEY'] }, async (request) => {
  assertVerifiedNonAnonymousUser(request, 'A verified, non-anonymous account is required to generate content.');
  await checkRateLimit(request.auth!.uid, 'generatePostContent', 10);

  const data = callableDataRecord(request.data);
  const { churchId: rawChurchId, prompt: rawPrompt, tone = 'warm' } = data;
  const churchId = assertNonEmptyString(rawChurchId, 128, 'churchId');
  const prompt = assertNonEmptyString(rawPrompt, 1000, 'prompt');

  if (tone !== 'formal' && tone !== 'warm' && tone !== 'brief') {
    throw new HttpsError('invalid-argument', `tone must be one of: ${ALLOWED_TONES.join(', ')}.`);
  }
  const safeTone: GeminiTone = tone;

  await assertActiveChurchRole(
    churchId,
    request.auth!.uid,
    ['admin', 'priest'],
    'Only active admins and priests can generate post content.'
  );

  const toneInstructions: Record<GeminiTone, string> = {
    formal: 'Use a formal, reverent tone suitable for official parish communications.',
    warm: 'Use a warm, pastoral tone that feels personal and inviting to parishioners.',
    brief: 'Be concise. Use short paragraphs. Get to the point quickly while remaining respectful.',
  };

  const systemPrompt = `You are a writer for an Orthodox Christian parish. Write a parish post or announcement 
in Markdown format. Use ## for section headings, **bold** for emphasis, and - for bullet points where appropriate.
${toneInstructions[safeTone]}
Keep the content faithful to Orthodox Christian theology and tradition. Do not include placeholder text like [Church Name].`;

  const ai = getGemini();
  try {
    const result = await ai.models.generateContent({
      model: GEMINI_TEXT_MODEL,
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      config: { systemInstruction: systemPrompt },
    });

    return { text: result.text ?? '' };
  } catch (error) {
    console.error('generatePostContent failed:', sanitizedErrorContext(error));
    throw new HttpsError('unavailable', 'AI post generation is temporarily unavailable.');
  }
});
