import { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { BookOpen, Edit3, Loader2, Plus, Trash2, X } from 'lucide-react';
import type { Language } from '../../types';
import { getExtraCopy } from '../../localization/extra';
import type { FirestoreNewsletter, NewsletterStatus } from '../../lib/db/newsletters';

interface NewsletterValues {
  title: string;
  excerpt: string;
  content: string;
  status: NewsletterStatus;
}

interface ManagementNewslettersTabProps {
  newsletters: FirestoreNewsletter[];
  newslettersLoading: boolean;
  deletingNewsletterId: string | null;
  newsletterSaving: boolean;
  newsletterSaveError: string;
  isAdminOrPriest: boolean;
  isPriest: boolean;
  onSaveNewsletter: (newsletterId: string | null, values: NewsletterValues) => Promise<boolean>;
  onDeleteNewsletter: (newsletterId: string) => Promise<void>;
  language: Language;
}

const EMPTY_VALUES: NewsletterValues = {
  title: '',
  excerpt: '',
  content: '',
  status: 'draft',
};

function valuesFromNewsletter(newsletter: FirestoreNewsletter | null): NewsletterValues {
  if (!newsletter) {
    return EMPTY_VALUES;
  }

  return {
    title: newsletter.title,
    excerpt: newsletter.excerpt,
    content: newsletter.content,
    status: newsletter.status,
  };
}

export default function ManagementNewslettersTab({
  newsletters,
  newslettersLoading,
  deletingNewsletterId,
  newsletterSaving,
  newsletterSaveError,
  isAdminOrPriest,
  isPriest,
  onSaveNewsletter,
  onDeleteNewsletter,
  language,
}: ManagementNewslettersTabProps) {
  const [editingNewsletter, setEditingNewsletter] = useState<FirestoreNewsletter | null | undefined>(undefined);
  const [values, setValues] = useState<NewsletterValues>(EMPTY_VALUES);
  const [validationError, setValidationError] = useState('');
  const copy = getExtraCopy(language).management;
  const t = copy.newsletters;

  const editorOpen = editingNewsletter !== undefined;

  useEffect(() => {
    if (editorOpen) {
      setValues(valuesFromNewsletter(editingNewsletter ?? null));
      setValidationError('');
    }
  }, [editingNewsletter, editorOpen]);

  const submit = async (status: NewsletterStatus) => {
    setValidationError('');
    const title = values.title.trim();
    const excerpt = values.excerpt.trim();
    const content = values.content.trim();
    if (!title || !excerpt || !content) {
      setValidationError(t.validationError);
      return;
    }

    const saved = await onSaveNewsletter(editingNewsletter?.id ?? null, {
      title,
      excerpt,
      content,
      status,
    });
    if (saved) {
      setEditingNewsletter(undefined);
    }
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="p-6 xl:p-8 border-b border-gray-100 bg-white flex flex-col gap-5 sm:flex-row sm:justify-between sm:items-end">
        <div>
          <span className="text-[#937022] font-black text-[10px] tracking-[0.2em] uppercase mb-2 block">
            {t.eyebrow}
          </span>
          <h2 className="text-3xl font-black text-gray-900 tracking-tighter">
            {t.title}
            {!newslettersLoading && (
              <span className="ml-3 text-base text-gray-400 font-bold">{t.count(newsletters.length)}</span>
            )}
          </h2>
        </div>
        {isAdminOrPriest && (
          <button
            onClick={() => setEditingNewsletter(null)}
            className="w-full sm:w-auto flex items-center justify-center gap-2 px-6 py-3 bg-gray-900 text-white rounded-2xl font-black text-[10px] uppercase tracking-widest hover:bg-[#800000] transition-all"
          >
            <Plus size={16} />
            {t.newBulletin}
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-6 xl:p-8 scrollbar-hide bg-gray-50/30">
        {newslettersLoading ? (
          <div className="flex items-center justify-center h-48">
            <Loader2 size={32} className="text-[#800000] animate-spin" />
          </div>
        ) : newsletters.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-72 text-center">
            <div className="w-20 h-20 bg-gray-50 rounded-[28px] flex items-center justify-center text-gray-200 mb-6">
              <BookOpen size={40} />
            </div>
            <h3 className="text-xl font-black text-gray-900">{t.noBulletins}</h3>
            <p className="text-sm text-gray-400 mt-2 max-w-xs">
              {t.noBulletinsSub}
            </p>
            {isAdminOrPriest && (
              <button
                onClick={() => setEditingNewsletter(null)}
                className="mt-8 px-8 py-4 bg-gray-900 text-white rounded-2xl font-black text-[10px] uppercase tracking-widest hover:bg-[#800000] transition-all"
              >
                {t.createFirst}
              </button>
            )}
          </div>
        ) : (
          <div className="max-w-5xl mx-auto space-y-4">
            {newsletters.map((newsletter) => (
              <div
                key={newsletter.id}
                className="bg-white rounded-[28px] border border-gray-100 shadow-sm p-5 xl:p-6 flex flex-col sm:flex-row sm:items-start gap-4 sm:gap-6 hover:border-gray-200 transition-all"
              >
                <div
                  className={`w-2.5 h-2.5 rounded-full mt-1.5 flex-shrink-0 ${
                    newsletter.status === 'published' ? 'bg-green-400' : 'bg-amber-400'
                  }`}
                />

                <div className="flex-1 min-w-0 w-full">
                  <div className="flex flex-wrap items-center gap-3 mb-2">
                    <span
                      className={`px-2.5 py-1 rounded-lg text-[9px] font-black uppercase tracking-widest ${
                        newsletter.status === 'published'
                          ? 'bg-green-50 text-green-700'
                          : 'bg-amber-50 text-amber-700'
                      }`}
                    >
                      {newsletter.status === 'published' ? copy.common.published : copy.common.draft}
                    </span>
                    <span className="text-[10px] font-bold text-gray-400">
                      {newsletter.publishedAt
                        ? newsletter.publishedAt.toLocaleDateString(undefined, {
                            month: 'short',
                            day: 'numeric',
                            year: 'numeric',
                          })
                        : copy.common.notPublished}
                    </span>
                  </div>
                  <h3 className="text-lg font-black text-gray-900 tracking-tight mb-1 truncate">
                    {newsletter.title || t.untitled}
                  </h3>
                  <p className="text-xs text-gray-400 font-bold line-clamp-2">{newsletter.excerpt}</p>
                </div>

                {isAdminOrPriest && (
                  <div className="flex gap-2 flex-shrink-0">
                    <button
                      onClick={() => setEditingNewsletter(newsletter)}
                      className="flex items-center gap-1.5 px-4 py-2.5 bg-gray-50 text-gray-700 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-gray-100 transition-all"
                    >
                      <Edit3 size={13} />
                      {copy.common.edit}
                    </button>
                    {isPriest && (
                      <button
                        onClick={() => void onDeleteNewsletter(newsletter.id)}
                        disabled={deletingNewsletterId === newsletter.id}
                        className="p-2.5 text-gray-300 hover:text-red-400 hover:bg-red-50 rounded-xl transition-all"
                      >
                        {deletingNewsletterId === newsletter.id ? (
                          <Loader2 size={16} className="animate-spin" />
                        ) : (
                          <Trash2 size={16} />
                        )}
                      </button>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {editorOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="absolute inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-end justify-center"
          onClick={(event) => event.stopPropagation()}
        >
          <motion.form
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            transition={{ type: 'spring', damping: 26, stiffness: 220 }}
            className="w-full max-w-3xl bg-white rounded-t-[40px] p-6 sm:p-8 pb-10 shadow-2xl max-h-[90vh] overflow-y-auto"
            onSubmit={(event) => {
              event.preventDefault();
              void submit(values.status);
            }}
          >
            <div className="flex items-start justify-between gap-6 mb-8">
              <div>
                <span className="text-[#937022] font-black text-[10px] tracking-[0.2em] uppercase mb-2 block">
                  {t.title}
                </span>
                <h3 className="text-3xl font-black text-gray-900 tracking-tighter">
                  {editingNewsletter ? t.editBulletin : t.newBulletin}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setEditingNewsletter(undefined)}
                className="w-10 h-10 rounded-full bg-gray-50 text-gray-400 hover:text-gray-900 transition-colors flex items-center justify-center"
              >
                <X size={18} />
              </button>
            </div>

            <div className="space-y-4">
              <label className="space-y-2 block">
                <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1 block">
                  {copy.common.title}
                </span>
                <input
                  value={values.title}
                  onChange={(input) => setValues((current) => ({ ...current, title: input.target.value }))}
                  maxLength={180}
                  className="w-full bg-gray-50 rounded-2xl px-5 py-4 text-sm font-bold text-gray-900 border-none focus:ring-2 focus:ring-[#800000]/20"
                  required
                />
              </label>

              <label className="space-y-2 block">
                <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1 block">
                  {copy.common.excerpt}
                </span>
                <textarea
                  value={values.excerpt}
                  onChange={(input) => setValues((current) => ({ ...current, excerpt: input.target.value }))}
                  maxLength={500}
                  rows={3}
                  className="w-full bg-gray-50 rounded-2xl px-5 py-4 text-sm font-bold text-gray-900 border-none focus:ring-2 focus:ring-[#800000]/20 resize-none"
                  required
                />
              </label>

              <label className="space-y-2 block">
                <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1 block">
                  {copy.common.content}
                </span>
                <textarea
                  value={values.content}
                  onChange={(input) => setValues((current) => ({ ...current, content: input.target.value }))}
                  maxLength={30000}
                  rows={10}
                  className="w-full bg-gray-50 rounded-2xl px-5 py-4 text-sm font-bold text-gray-900 border-none focus:ring-2 focus:ring-[#800000]/20 resize-none"
                  required
                />
              </label>
            </div>

            {(validationError || newsletterSaveError) && (
              <p className="mt-4 text-sm font-bold text-red-500">{validationError || newsletterSaveError}</p>
            )}

            <div className="mt-8 flex flex-col sm:flex-row gap-3">
              <button
                type="button"
                onClick={() => setEditingNewsletter(undefined)}
                className="flex-1 py-4 bg-gray-100 text-gray-600 rounded-2xl font-black text-[10px] uppercase tracking-widest hover:bg-gray-200 transition-all"
              >
                {copy.common.cancel}
              </button>
              {editingNewsletter?.status !== 'published' && (
                <button
                  type="button"
                  onClick={() => void submit('draft')}
                  disabled={newsletterSaving}
                  className="flex-1 py-4 bg-gray-100 text-gray-700 rounded-2xl font-black text-[10px] uppercase tracking-widest hover:bg-gray-200 transition-all disabled:opacity-60 flex items-center justify-center gap-2"
                >
                  {newsletterSaving ? <Loader2 size={14} className="animate-spin" /> : null}
                  {copy.common.saveDraft}
                </button>
              )}
              <button
                type="button"
                onClick={() => void submit('published')}
                disabled={newsletterSaving}
                className="flex-1 py-4 bg-[#800000] text-white rounded-2xl font-black text-[10px] uppercase tracking-widest hover:bg-[#8D1212] transition-all disabled:opacity-60 flex items-center justify-center gap-2"
              >
                {newsletterSaving ? <Loader2 size={14} className="animate-spin" /> : null}
                {editingNewsletter?.status === 'published' ? copy.common.saveChanges : copy.common.publish}
              </button>
            </div>
          </motion.form>
        </motion.div>
      )}
    </div>
  );
}
