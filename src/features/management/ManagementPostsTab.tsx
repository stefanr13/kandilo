import { Edit3, FileText, Loader2, Plus, Trash2 } from 'lucide-react';
import type { Language } from '../../types';
import { getExtraCopy } from '../../localization/extra';
import type { ChurchPost } from '../../lib/db/posts';

interface ManagementPostsTabProps {
  posts: ChurchPost[];
  postsLoading: boolean;
  deletingPostId: string | null;
  isAdminOrPriest: boolean;
  onCreatePost: () => void;
  onEditPost: (post: ChurchPost) => void;
  onDeletePost: (postId: string) => void;
  language: Language;
}

export default function ManagementPostsTab({
  posts,
  postsLoading,
  deletingPostId,
  isAdminOrPriest,
  onCreatePost,
  onEditPost,
  onDeletePost,
  language,
}: ManagementPostsTabProps) {
  const copy = getExtraCopy(language).management;
  const t = copy.posts;

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="p-6 xl:p-8 border-b border-gray-100 bg-white flex flex-col gap-5 sm:flex-row sm:justify-between sm:items-end">
        <div>
          <span className="text-[#937022] font-black text-[10px] tracking-[0.2em] uppercase mb-2 block">
            {t.eyebrow}
          </span>
          <h2 className="text-3xl font-black text-gray-900 tracking-tighter">
            {t.title}
            {!postsLoading && (
              <span className="ml-3 text-base text-gray-400 font-bold">{t.count(posts.length)}</span>
            )}
          </h2>
        </div>
        {isAdminOrPriest && (
          <button
            onClick={onCreatePost}
            className="w-full sm:w-auto flex items-center justify-center gap-2 px-6 py-3 bg-gray-900 text-white rounded-2xl font-black text-[10px] uppercase tracking-widest hover:bg-[#800000] transition-all"
          >
            <Plus size={16} />
            {t.newPost}
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-6 xl:p-8 scrollbar-hide bg-gray-50/30">
        {postsLoading ? (
          <div className="flex items-center justify-center h-48">
            <Loader2 size={32} className="text-[#800000] animate-spin" />
          </div>
        ) : posts.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-72 text-center">
            <div className="w-20 h-20 bg-gray-50 rounded-[32px] flex items-center justify-center text-gray-200 mb-6">
              <FileText size={40} />
            </div>
            <h3 className="text-xl font-black text-gray-900">{t.noPosts}</h3>
            <p className="text-sm text-gray-400 mt-2 max-w-xs">
              {t.noPostsSub}
            </p>
            {isAdminOrPriest && (
              <button
                onClick={onCreatePost}
                className="mt-8 px-8 py-4 bg-gray-900 text-white rounded-2xl font-black text-[10px] uppercase tracking-widest hover:bg-[#800000] transition-all"
              >
                {t.createFirst}
              </button>
            )}
          </div>
        ) : (
          <div className="max-w-5xl mx-auto space-y-4">
            {posts.map((post) => (
              <div
                key={post.id}
                className="bg-white rounded-[28px] border border-gray-100 shadow-sm p-5 xl:p-6 flex flex-col sm:flex-row sm:items-start gap-4 sm:gap-6 hover:border-gray-200 transition-all"
              >
                <div
                  className={`w-2.5 h-2.5 rounded-full mt-1.5 flex-shrink-0 ${
                    post.status === 'published' ? 'bg-green-400' : 'bg-amber-400'
                  }`}
                />

                <div className="flex-1 min-w-0 w-full">
                  <div className="flex flex-wrap items-center gap-3 mb-2">
                    <span
                      className={`px-2.5 py-1 rounded-lg text-[9px] font-black uppercase tracking-widest ${
                        post.status === 'published'
                          ? 'bg-green-50 text-green-700'
                          : 'bg-amber-50 text-amber-700'
                      }`}
                    >
                      {post.status === 'published' ? copy.common.published : copy.common.draft}
                    </span>
                    <span className="text-[10px] font-bold text-gray-400">
                      {post.status === 'published' && post.publishedAt
                        ? post.publishedAt.toLocaleDateString(undefined, {
                            month: 'short',
                            day: 'numeric',
                            year: 'numeric',
                          })
                        : t.updated(post.updatedAt.toLocaleDateString())}
                    </span>
                  </div>
                  <h3 className="text-lg font-black text-gray-900 tracking-tight mb-1 truncate">
                    {post.title || t.untitled}
                  </h3>
                  <p className="text-xs text-gray-400 font-bold">{t.by(post.authorName)}</p>
                </div>

                {isAdminOrPriest && (
                  <div className="flex gap-2 flex-shrink-0">
                    <button
                      onClick={() => onEditPost(post)}
                      className="flex items-center gap-1.5 px-4 py-2.5 bg-gray-50 text-gray-700 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-gray-100 transition-all"
                    >
                      <Edit3 size={13} />
                      {copy.common.edit}
                    </button>
                    <button
                      onClick={() => onDeletePost(post.id)}
                      disabled={deletingPostId === post.id}
                      className="p-2.5 text-gray-300 hover:text-red-400 hover:bg-red-50 rounded-xl transition-all"
                    >
                      {deletingPostId === post.id ? (
                        <Loader2 size={16} className="animate-spin" />
                      ) : (
                        <Trash2 size={16} />
                      )}
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
