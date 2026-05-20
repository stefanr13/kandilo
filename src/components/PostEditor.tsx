import React, { useState, useCallback } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import DOMPurify from 'dompurify';
import {
  Bold, Italic, Heading1, Heading2, List, ListOrdered, Undo, Redo,
  Sparkles, ArrowLeft, Save, Globe2, Loader2, X, ChevronDown,
} from 'lucide-react';
import { createPost, updatePost, type ChurchPost } from '../lib/db/posts';
import type { User as FirebaseUser } from 'firebase/auth';
import type { Role } from '../domain/church';
import { AI_WRITER_ENABLED } from '../config/features';
import { generateChurchPostContent, previewChurchPostTranslations } from '../lib/api/ai';
import { orderPostTranslationPreviewItems, type PostTranslationPreview } from '../lib/postTranslationPreview';
import type { Language } from '../types';
import { getExtraCopy, type ExtraCopy } from '../localization/extra';

const POST_SANITIZE_CONFIG = {
  ALLOWED_TAGS: ['h1','h2','h3','p','strong','em','ul','ol','li','br','a','blockquote','pre','code','hr'],
  ALLOWED_ATTR: ['href','target','rel'],
  ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|tel):|\/)/i,
};

interface PostEditorProps {
  churchId: string;
  currentUser: FirebaseUser | null;
  userRole: Role;
  post?: ChurchPost | null;
  onSaved: () => void;
  onBack: () => void;
  language?: Language;
}

// ─── Toolbar button helper ────────────────────────────────────────────────────
function ToolBtn({
  onClick, active, disabled, title, children,
}: {
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`w-9 h-9 flex items-center justify-center rounded-xl transition-all text-sm
        ${active ? 'bg-gray-900 text-white' : 'text-gray-500 hover:bg-gray-100 hover:text-gray-900'}
        ${disabled ? 'opacity-30 cursor-not-allowed' : ''}
      `}
    >
      {children}
    </button>
  );
}

// ─── AI generation panel ──────────────────────────────────────────────────────
function AIPanel({
  churchId,
  canPreviewOtherLanguages,
  copy,
  onInsert,
  onClose,
}: {
  churchId: string;
  canPreviewOtherLanguages: boolean;
  copy: ExtraCopy['postEditor'];
  onInsert: (text: string) => void;
  onClose: () => void;
}) {
  const [prompt, setPrompt] = useState('');
  const [tone, setTone] = useState<'formal' | 'warm' | 'brief'>('warm');
  const [loading, setLoading] = useState(false);
  const [translationLoading, setTranslationLoading] = useState(false);
  const [preview, setPreview] = useState('');
  const [translationPreview, setTranslationPreview] = useState<PostTranslationPreview | null>(null);
  const [error, setError] = useState('');
  const [translationError, setTranslationError] = useState('');

  const generate = async () => {
    if (!prompt.trim() || !churchId) return;
    setLoading(true);
    setError('');
    setPreview('');
    try {
      const result = await generateChurchPostContent({ churchId, prompt, tone });
      setPreview(result.text);
    } catch (e) {
      setError(copy.aiGenerationFailed);
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const previewOtherLanguages = async () => {
    if (!prompt.trim() || !churchId) return;
    setTranslationLoading(true);
    setTranslationError('');
    setTranslationPreview(null);
    try {
      const result = await previewChurchPostTranslations({ churchId, prompt });
      setTranslationPreview({
        detectedSourceLanguage: result.detectedSourceLanguage,
        translations: orderPostTranslationPreviewItems(result.translations),
      });
    } catch (e) {
      setTranslationError(copy.translationPreviewFailed);
      console.error(e);
    } finally {
      setTranslationLoading(false);
    }
  };

  const handleInsert = () => {
    if (!preview) return;
    // Convert basic markdown to HTML for TipTap
    const html = markdownToHtml(preview);
    onInsert(html);
    onClose();
  };

  return (
    <div className="border border-[#937022]/20 rounded-3xl bg-gradient-to-br from-amber-50/50 to-white p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Sparkles size={18} className="text-[#937022]" />
          <span className="font-black text-sm text-gray-900 uppercase tracking-widest">{copy.aiWriter}</span>
          <span className="text-[9px] font-bold text-[#937022] bg-[#937022]/10 px-2 py-0.5 rounded-full uppercase tracking-widest">Gemini</span>
        </div>
        <button onClick={onClose} className="w-8 h-8 flex items-center justify-center text-gray-400 hover:text-gray-900 rounded-full hover:bg-gray-100 transition-all">
          <X size={16} />
        </button>
      </div>

      <div>
        <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2 block">{copy.aiPromptLabel}</label>
        <textarea
          value={prompt}
          onChange={(e) => {
            setPrompt(e.target.value);
            setTranslationError('');
            setTranslationPreview(null);
          }}
          placeholder={copy.aiPromptPlaceholder}
          rows={3}
          className="w-full bg-white border border-gray-100 rounded-2xl px-4 py-3 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#937022]/20 resize-none shadow-sm"
        />
      </div>

      <div className="flex gap-2 items-center flex-wrap">
        <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest">{copy.tone}</label>
        {(['warm', 'formal', 'brief'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTone(t)}
            className={`px-3 py-1.5 rounded-xl text-[10px] font-bold capitalize transition-all ${tone === t ? 'bg-gray-900 text-white' : 'bg-white text-gray-500 border border-gray-100 hover:border-gray-300'}`}
          >
            {t}
          </button>
        ))}
        {canPreviewOtherLanguages && (
          <button
            onClick={previewOtherLanguages}
            disabled={translationLoading || !prompt.trim()}
            className="flex items-center gap-2 px-4 py-2 border border-[#937022]/20 text-[#937022] rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-amber-50 transition-all disabled:opacity-40"
          >
            {translationLoading ? <Loader2 size={14} className="animate-spin" /> : <Globe2 size={14} />}
            {translationLoading ? copy.previewing : copy.previewOtherLanguages}
          </button>
        )}
        <button
          onClick={generate}
          disabled={loading || !prompt.trim()}
          className="ml-auto flex items-center gap-2 px-5 py-2 bg-[#937022] text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-[#7a5c1a] transition-all disabled:opacity-40"
        >
          {loading ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
          {loading ? copy.generating : copy.generate}
        </button>
      </div>

      {error && <p className="text-xs text-red-500 font-bold">{error}</p>}
      {translationError && <p className="text-xs text-red-500 font-bold">{translationError}</p>}

      {preview && (
        <div>
          <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2 block">{copy.preview}</label>
          <div className="bg-white border border-gray-100 rounded-2xl p-4 max-h-60 overflow-y-auto text-sm text-gray-700 leading-relaxed whitespace-pre-wrap shadow-sm">
            {preview}
          </div>
          <div className="flex gap-2 mt-3">
            <button onClick={generate} className="flex items-center gap-1.5 px-4 py-2 border border-gray-200 text-gray-500 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-gray-50 transition-all">
              <Sparkles size={12} />
              {copy.regenerate}
            </button>
            <button onClick={handleInsert} className="flex-1 py-2 bg-gray-900 text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-[#800000] transition-all">
              {copy.insertIntoPost}
            </button>
          </div>
        </div>
      )}

      {translationPreview && translationPreview.translations.length > 0 && (
        <div>
          <div className="flex items-center justify-between gap-3 mb-3">
            <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest block">
              {copy.otherLanguagePreviews}
            </label>
            <span className="text-[10px] font-bold text-gray-400">
              {copy.detectedSource(translationPreview.detectedSourceLanguage)}
            </span>
          </div>
          <div className="space-y-3">
            {translationPreview.translations.map((translation) => (
              <div
                key={translation.language}
                className="bg-white border border-gray-100 rounded-2xl p-4 shadow-sm"
              >
                <div className="text-[10px] font-black text-[#937022] uppercase tracking-widest mb-2">
                  {translation.language}
                </div>
                <div className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">
                  {translation.text}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Minimal markdown → TipTap-compatible HTML ────────────────────────────────
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatInlineMarkdown(text: string): string {
  let line = escapeHtml(text);
  line = line.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  line = line.replace(/\*(.+?)\*/g, '<em>$1</em>');
  return line;
}

function markdownToHtml(md: string): string {
  return md
    .split('\n')
    .map((line) => {
      if (/^## (.+)/.test(line)) return `<h2>${formatInlineMarkdown(line.replace(/^## /, ''))}</h2>`;
      if (/^# (.+)/.test(line)) return `<h1>${formatInlineMarkdown(line.replace(/^# /, ''))}</h1>`;
      if (/^[-*] (.+)/.test(line)) return `<li>${formatInlineMarkdown(line.replace(/^[-*] /, ''))}</li>`;
      if (line.trim() === '') return '<p></p>';
      return `<p>${formatInlineMarkdown(line)}</p>`;
    })
    .join('');
}

function sanitizePostHtml(html: string): string {
  return DOMPurify.sanitize(html, POST_SANITIZE_CONFIG);
}

// ─── Main PostEditor ──────────────────────────────────────────────────────────
export default function PostEditor({
  churchId,
  currentUser,
  userRole,
  post,
  onSaved,
  onBack,
  language = 'English',
}: PostEditorProps) {
  const [title, setTitle] = useState(post?.title ?? '');
  const [showAI, setShowAI] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const copy = getExtraCopy(language).postEditor;

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        bulletList: { keepMarks: true },
        orderedList: { keepMarks: true },
      }),
      Placeholder.configure({
        placeholder: copy.beginPlaceholder,
      }),
    ],
    content: post?.contentHtml ?? '',
    editorProps: {
      attributes: {
        class: 'prose prose-sm lg:prose-base max-w-none focus:outline-none min-h-[320px] text-gray-800 leading-relaxed',
      },
    },
  });

  // Insert AI-generated HTML into editor
  const handleAIInsert = useCallback((html: string) => {
    if (!editor) return;
    editor.chain().focus().insertContent(sanitizePostHtml(html)).run();
  }, [editor]);

  const save = async (status: 'draft' | 'published') => {
    if (!title.trim()) { setSaveError(copy.titleRequired); return; }
    if (title.trim().length > 180) { setSaveError(copy.titleTooLong); return; }
    if (!editor) return;
    setSaving(true);
    setSaveError('');
    try {
      const contentHtml = sanitizePostHtml(editor.getHTML());
      const contentJSON = editor.getJSON();
      if (post) {
        await updatePost(churchId, post.id, { title: title.trim(), contentHtml, contentJSON, status });
      } else {
        await createPost(churchId, currentUser?.uid ?? '', currentUser?.displayName ?? copy.authorFallback, {
          title: title.trim(), contentHtml, contentJSON, status,
        });
      }
      setLastSaved(new Date());
      if (status === 'published') onSaved();
    } catch (e) {
      setSaveError(copy.saveFailed);
      console.error(e);
    } finally {
      setSaving(false);
    }
  };

  if (!editor) return null;

  return (
    <div className="flex flex-col h-full bg-white">
      {/* ── Top bar ─────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 bg-white sticky top-0 z-20">
        <button onClick={onBack} className="flex items-center gap-2 text-gray-500 hover:text-gray-900 transition-colors">
          <ArrowLeft size={18} />
          <span className="text-sm font-bold hidden sm:inline">{copy.back}</span>
        </button>

        <div className="flex items-center gap-2">
          {lastSaved && !saving && (
            <span className="text-[10px] text-gray-400 font-bold hidden sm:inline">
              {copy.savedAt(lastSaved.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }))}
            </span>
          )}
          <button
            onClick={() => save('draft')}
            disabled={saving}
            className="flex items-center gap-1.5 px-4 py-2.5 bg-gray-100 text-gray-700 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-gray-200 transition-all disabled:opacity-50"
          >
            {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
            {copy.saveDraft}
          </button>
          <button
            onClick={() => save('published')}
            disabled={saving}
            className="flex items-center gap-1.5 px-4 py-2.5 bg-[#800000] text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-[#8D1212] transition-all shadow-lg shadow-red-900/20 disabled:opacity-50"
          >
            {saving ? <Loader2 size={12} className="animate-spin" /> : <Globe2 size={12} />}
            {copy.publish}
          </button>
        </div>
      </div>

      {/* ── Scrollable editor area ───────────────────────────────── */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-6 lg:px-10 pt-8 pb-32">
          {/* Title */}
          <input
            type="text"
            placeholder={copy.titlePlaceholder}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full text-3xl lg:text-4xl font-black text-gray-900 tracking-tight placeholder:text-gray-200 border-none outline-none bg-transparent mb-6 leading-tight"
          />

          {/* Author & status */}
          <div className="flex items-center gap-3 mb-8 pb-6 border-b border-gray-100">
            <div className="w-8 h-8 rounded-xl bg-[#800000]/10 flex items-center justify-center text-[#800000] text-xs font-black">
              {(currentUser?.displayName ?? 'A').charAt(0).toUpperCase()}
            </div>
            <div>
              <p className="text-xs font-black text-gray-900">{currentUser?.displayName ?? copy.authorFallback}</p>
              <p className="text-[9px] text-gray-400 font-bold uppercase tracking-widest">
                {post?.status === 'published'
                  ? copy.publishedAt(post.publishedAt?.toLocaleDateString() ?? '')
                  : copy.draft}
              </p>
            </div>
          </div>

          {/* Rich text toolbar */}
          <div className="flex flex-wrap items-center gap-1 mb-4 p-2 bg-gray-50 rounded-2xl border border-gray-100 sticky top-[73px] z-10">
            <ToolBtn onClick={() => editor.chain().focus().toggleBold().run()} active={editor.isActive('bold')} title="Bold">
              <Bold size={15} />
            </ToolBtn>
            <ToolBtn onClick={() => editor.chain().focus().toggleItalic().run()} active={editor.isActive('italic')} title="Italic">
              <Italic size={15} />
            </ToolBtn>
            <div className="w-px h-6 bg-gray-200 mx-1" />
            <ToolBtn onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()} active={editor.isActive('heading', { level: 1 })} title="Heading 1">
              <Heading1 size={15} />
            </ToolBtn>
            <ToolBtn onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} active={editor.isActive('heading', { level: 2 })} title="Heading 2">
              <Heading2 size={15} />
            </ToolBtn>
            <div className="w-px h-6 bg-gray-200 mx-1" />
            <ToolBtn onClick={() => editor.chain().focus().toggleBulletList().run()} active={editor.isActive('bulletList')} title="Bullet list">
              <List size={15} />
            </ToolBtn>
            <ToolBtn onClick={() => editor.chain().focus().toggleOrderedList().run()} active={editor.isActive('orderedList')} title="Numbered list">
              <ListOrdered size={15} />
            </ToolBtn>
            <div className="w-px h-6 bg-gray-200 mx-1" />
            <ToolBtn onClick={() => editor.chain().focus().undo().run()} disabled={!editor.can().undo()} title="Undo">
              <Undo size={15} />
            </ToolBtn>
            <ToolBtn onClick={() => editor.chain().focus().redo().run()} disabled={!editor.can().redo()} title="Redo">
              <Redo size={15} />
            </ToolBtn>

            {AI_WRITER_ENABLED && (
            <div className="ml-auto">
              <button
                onClick={() => setShowAI(!showAI)}
                className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${
                  showAI ? 'bg-[#937022] text-white' : 'bg-white text-[#937022] border border-[#937022]/20 hover:bg-[#937022]/5'
                }`}
              >
                <Sparkles size={13} />
                {copy.aiWriter}
                <ChevronDown size={12} className={`transition-transform ${showAI ? 'rotate-180' : ''}`} />
              </button>
            </div>
            )}
          </div>

          {/* AI panel */}
          {AI_WRITER_ENABLED && showAI && (
            <div className="mb-6">
              <AIPanel
                churchId={churchId}
                canPreviewOtherLanguages={userRole === 'priest'}
                copy={copy}
                onInsert={handleAIInsert}
                onClose={() => setShowAI(false)}
              />
            </div>
          )}

          {/* Editor content */}
          <EditorContent editor={editor} />

          {saveError && (
            <p className="mt-4 text-xs text-red-500 font-bold">{saveError}</p>
          )}
        </div>
      </div>
    </div>
  );
}
