import { useState } from 'react';
import { Bell, Loader2, Send } from 'lucide-react';
import type { Language } from '../../types';
import { getExtraCopy } from '../../localization/extra';

type NotificationRole = 'member' | 'admin' | 'priest';

interface ManagementNotificationsTabProps {
  isAdminOrPriest: boolean;
  sending: boolean;
  error: string;
  notice: string;
  onSend: (values: {
    title: string;
    body: string;
    targetRoles: NotificationRole[];
  }) => Promise<void>;
  language: Language;
}

const ROLE_OPTIONS: Array<{ value: NotificationRole; key: 'members' | 'admins' | 'priests' }> = [
  { value: 'member', key: 'members' },
  { value: 'admin', key: 'admins' },
  { value: 'priest', key: 'priests' },
];

export default function ManagementNotificationsTab({
  isAdminOrPriest,
  sending,
  error,
  notice,
  onSend,
  language,
}: ManagementNotificationsTabProps) {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [targetRoles, setTargetRoles] = useState<NotificationRole[]>(['member', 'admin', 'priest']);
  const [validationError, setValidationError] = useState('');
  const copy = getExtraCopy(language).management;
  const t = copy.notifications;

  const toggleRole = (role: NotificationRole) => {
    setTargetRoles((current) =>
      current.includes(role)
        ? current.filter((value) => value !== role)
        : [...current, role]
    );
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="p-6 xl:p-8 border-b border-gray-100 bg-white flex justify-between items-end">
        <div>
          <span className="text-[#937022] font-black text-[10px] tracking-[0.2em] uppercase mb-2 block">
            {t.eyebrow}
          </span>
          <h2 className="text-3xl font-black text-gray-900 tracking-tighter">{t.title}</h2>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6 xl:p-8 scrollbar-hide bg-gray-50/30">
        <div className="max-w-3xl mx-auto bg-white rounded-[28px] border border-gray-100 shadow-sm p-6 xl:p-8">
          <div className="flex items-center gap-4 mb-8">
            <div className="w-12 h-12 rounded-2xl bg-[#800000]/10 flex items-center justify-center text-[#800000]">
              <Bell size={22} />
            </div>
            <div>
              <h3 className="text-lg font-black text-gray-900">{t.cardTitle}</h3>
              <p className="text-xs text-gray-400 font-bold">
                {t.cardSub}
              </p>
            </div>
          </div>

          <form
            className="space-y-5"
            onSubmit={async (event) => {
              event.preventDefault();
              setValidationError('');
              if (!title.trim() || !body.trim()) {
                setValidationError(t.validationError);
                return;
              }
              if (targetRoles.length === 0) {
                setValidationError(t.audienceError);
                return;
              }
              await onSend({
                title: title.trim(),
                body: body.trim(),
                targetRoles,
              });
            }}
          >
            <label className="space-y-2 block">
              <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1 block">
                {copy.common.title}
              </span>
              <input
                value={title}
                onChange={(input) => setTitle(input.target.value)}
                maxLength={100}
                className="w-full bg-gray-50 rounded-2xl px-5 py-4 text-sm font-bold text-gray-900 border-none focus:ring-2 focus:ring-[#800000]/20"
                placeholder={t.placeholderTitle}
                disabled={!isAdminOrPriest || sending}
              />
            </label>

            <label className="space-y-2 block">
              <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1 block">
                {t.message}
              </span>
              <textarea
                value={body}
                onChange={(input) => setBody(input.target.value)}
                maxLength={300}
                rows={5}
                className="w-full bg-gray-50 rounded-2xl px-5 py-4 text-sm font-bold text-gray-900 border-none focus:ring-2 focus:ring-[#800000]/20 resize-none"
                placeholder={t.placeholderBody}
                disabled={!isAdminOrPriest || sending}
              />
            </label>

            <div>
              <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1 block mb-2">
                {t.audience}
              </span>
              <div className="flex flex-wrap gap-2">
                {ROLE_OPTIONS.map((role) => {
                  const checked = targetRoles.includes(role.value);
                  return (
                    <button
                      key={role.value}
                      type="button"
                      onClick={() => toggleRole(role.value)}
                      disabled={!isAdminOrPriest || sending}
                      className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest border transition-all ${
                        checked
                          ? 'bg-gray-900 text-white border-gray-900'
                          : 'bg-white text-gray-400 border-gray-100 hover:border-gray-300'
                      }`}
                    >
                      {t[role.key]}
                    </button>
                  );
                })}
              </div>
            </div>

            {(validationError || error) && (
              <p className="text-sm font-bold text-red-500">{validationError || error}</p>
            )}
            {notice && <p className="text-sm font-bold text-emerald-600">{notice}</p>}

            <button
              type="submit"
              disabled={!isAdminOrPriest || sending}
              className="w-full py-4 bg-gray-900 text-white rounded-2xl font-black text-[10px] uppercase tracking-widest hover:bg-[#800000] transition-all disabled:opacity-60 flex items-center justify-center gap-2"
            >
              {sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
              {t.send}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
