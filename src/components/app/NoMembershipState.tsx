import type { Language } from '../../types';
import { getExtraCopy } from '../../localization/extra';

interface NoMembershipStateProps {
  onOpenProfile: () => void;
  language: Language;
}

export default function NoMembershipState({ onOpenProfile, language }: NoMembershipStateProps) {
  const t = getExtraCopy(language).noMembership;

  return (
    <div className="flex h-full items-center justify-center p-8">
      <div className="max-w-md rounded-[32px] bg-white p-8 text-center shadow-xl shadow-black/5">
        <p className="mb-2 text-[10px] font-black uppercase tracking-[0.25em] text-[#937022]">
          {t.label}
        </p>
        <h2 className="mb-3 text-3xl font-black tracking-tight text-gray-900">
          {t.title}
        </h2>
        <p className="text-sm leading-relaxed text-gray-500">
          {t.body}
        </p>
        <button
          onClick={onOpenProfile}
          className="mt-6 rounded-2xl bg-gray-900 px-5 py-3 text-[10px] font-black uppercase tracking-widest text-white transition-colors hover:bg-[#800000]"
        >
          {t.openProfile}
        </button>
      </div>
    </div>
  );
}
