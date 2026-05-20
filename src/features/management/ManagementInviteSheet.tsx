import { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { Loader2, X } from 'lucide-react';
import type { Language } from '../../types';
import { getExtraCopy } from '../../localization/extra';

interface InviteValues {
  inviteeEmail: string;
  role: 'member' | 'admin';
}

interface ManagementInviteSheetProps {
  isOpen: boolean;
  saving: boolean;
  allowAdminInvites: boolean;
  error: string;
  notice: string;
  onClose: () => void;
  onSubmit: (values: InviteValues) => Promise<void>;
  language: Language;
}

const INITIAL_VALUES: InviteValues = {
  inviteeEmail: '',
  role: 'member',
};

export default function ManagementInviteSheet({
  isOpen,
  saving,
  allowAdminInvites,
  error,
  notice,
  onClose,
  onSubmit,
  language,
}: ManagementInviteSheetProps) {
  const [values, setValues] = useState<InviteValues>(INITIAL_VALUES);
  const t = getExtraCopy(language).management.invite;
  const common = getExtraCopy(language).management.common;

  useEffect(() => {
    if (isOpen) {
      setValues(INITIAL_VALUES);
    }
  }, [isOpen]);

  if (!isOpen) {
    return null;
  }

  return (
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
        className="w-full max-w-2xl bg-white rounded-t-[40px] p-8 pb-10 shadow-2xl"
        onSubmit={async (event) => {
              event.preventDefault();
              await onSubmit(values);
            }}
      >
            <div className="flex items-start justify-between gap-6 mb-8">
              <div>
                <span className="text-[#937022] font-black text-[10px] tracking-[0.2em] uppercase mb-2 block">
                  {t.eyebrow}
                </span>
                <h3 className="text-3xl font-black text-gray-900 tracking-tighter">
                  {t.title}
                </h3>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="w-10 h-10 rounded-full bg-gray-50 text-gray-400 hover:text-gray-900 transition-colors flex items-center justify-center"
              >
                <X size={18} />
              </button>
            </div>

            <div className="space-y-4">
              <label className="space-y-2 block">
                <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1 block">
                  {t.email}
                </span>
                <input
                  type="email"
                  value={values.inviteeEmail}
                  onChange={(input) =>
                    setValues((current) => ({ ...current, inviteeEmail: input.target.value }))
                  }
                  className="w-full bg-gray-50 rounded-2xl px-5 py-4 text-sm font-bold text-gray-900 border-none focus:ring-2 focus:ring-[#800000]/20"
                  placeholder="name@example.com"
                  required
                />
              </label>

              <label className="space-y-2 block">
                <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1 block">
                  {t.role}
                </span>
                <select
                  value={values.role}
                  onChange={(input) =>
                    setValues((current) => ({
                      ...current,
                      role: input.target.value as InviteValues['role'],
                    }))
                  }
                  className="w-full bg-gray-50 rounded-2xl px-5 py-4 text-sm font-bold text-gray-900 border-none focus:ring-2 focus:ring-[#800000]/20 appearance-none"
                >
                  <option value="member">{t.member}</option>
                  {allowAdminInvites && <option value="admin">{t.admin}</option>}
                </select>
              </label>
            </div>

            {notice && <p className="mt-4 text-sm font-bold text-emerald-600 break-words">{notice}</p>}
            {error && <p className="mt-4 text-sm font-bold text-red-500">{error}</p>}

            <div className="mt-8 flex gap-3">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 py-4 bg-gray-100 text-gray-600 rounded-2xl font-black text-[10px] uppercase tracking-widest hover:bg-gray-200 transition-all"
              >
                {common.cancel}
              </button>
              <button
                type="submit"
                disabled={saving || Boolean(notice)}
                className="flex-1 py-4 bg-gray-900 text-white rounded-2xl font-black text-[10px] uppercase tracking-widest hover:bg-[#800000] transition-all disabled:opacity-60 flex items-center justify-center gap-2"
              >
                {saving ? <Loader2 size={14} className="animate-spin" /> : null}
                {notice ? t.created : t.send}
              </button>
            </div>
      </motion.form>
    </motion.div>
  );
}
