import type { User as FirebaseUser } from 'firebase/auth';
import { ArrowLeft, Loader2, RefreshCw, ShieldCheck } from 'lucide-react';

interface MissionControlHeaderProps {
  currentUser: FirebaseUser | null;
  loading: boolean;
  onBack: () => void;
  onRefresh: () => void;
}

export default function MissionControlHeader({
  currentUser,
  loading,
  onBack,
  onRefresh,
}: MissionControlHeaderProps) {
  return (
    <div className="px-6 pt-5 pb-4 flex items-center gap-4 border-b border-gray-800">
      <button
        onClick={onBack}
        className="w-9 h-9 rounded-xl bg-gray-800 flex items-center justify-center text-gray-400 hover:text-white transition-colors"
      >
        <ArrowLeft size={18} />
      </button>
      <div className="flex items-center gap-2 flex-1">
        <ShieldCheck size={20} className="text-[#800000]" />
        <div>
          <h1 className="text-sm font-black text-white tracking-tight leading-none">
            Mission Control
          </h1>
          <p className="text-[9px] font-bold text-gray-500 uppercase tracking-widest">
            Super Admin
          </p>
        </div>
      </div>
      <button
        onClick={onRefresh}
        disabled={loading}
        className="w-9 h-9 rounded-xl bg-gray-800 flex items-center justify-center text-gray-400 hover:text-white transition-colors"
      >
        {loading ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
      </button>
      <div className="w-8 h-8 rounded-full overflow-hidden bg-gray-700 flex-shrink-0">
        {currentUser?.photoURL ? (
          <img
            src={currentUser.photoURL}
            alt=""
            className="w-full h-full object-cover"
            referrerPolicy="no-referrer"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-gray-400 text-xs font-black">
            {currentUser?.displayName?.[0] ?? 'S'}
          </div>
        )}
      </div>
    </div>
  );
}
