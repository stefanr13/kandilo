import { Home, Calendar, Heart, MoreHorizontal, Sparkles, ShieldCheck } from 'lucide-react';
import { Screen, Language, Role } from '../types';
import { TRANSLATIONS } from '../translations';
import { FAITH_AI_ENABLED } from '../config/features';
import { canAccessManagementTools } from '../domain/roles';

interface BottomNavProps {
  currentScreen: Screen;
  onScreenChange: (screen: Screen) => void;
  language: Language;
  userRole?: Role | null;
}

export default function BottomNav({ currentScreen, onScreenChange, language, userRole }: BottomNavProps) {
  const t = TRANSLATIONS[language].nav;
  const canManage = canAccessManagementTools(userRole);

  const navItems = [
    { id: 'home' as Screen, label: t.home, icon: Home },
    { id: 'events' as Screen, label: t.events, icon: Calendar },
    { id: 'giving' as Screen, label: t.giving, icon: Heart, isCenter: true },
    ...(FAITH_AI_ENABLED ? [{ id: 'faith' as Screen, label: t.faith, icon: Sparkles }] : []),
    canManage
      ? { id: 'management' as Screen, label: t.manage, icon: ShieldCheck }
      : { id: 'more' as Screen, label: t.more, icon: MoreHorizontal },
  ];

  return (
    <div className="relative min-h-[96px] bg-white border-t border-gray-100 px-2 flex items-center justify-between" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
      {/* Left side */}
      <div className="flex flex-1 justify-around">
        {navItems.slice(0, 2).map((item) => {
          const Icon = item.icon;
          const isActive = currentScreen === item.id;
          return (
            <button
              key={item.id}
              onClick={() => onScreenChange(item.id)}
              className={`flex flex-col items-center justify-center gap-1 transition-colors ${
                isActive ? 'text-[#937022]' : 'text-gray-400'
              }`}
            >
              <Icon size={20} strokeWidth={isActive ? 2.5 : 2} />
              <span className="text-[9px] font-bold">{item.label}</span>
            </button>
          );
        })}
      </div>

      {/* Center focal button */}
      <div className="relative -top-6 flex flex-col items-center px-2">
        <button
          onClick={() => onScreenChange('giving')}
          className="w-16 h-16 rounded-full flex items-center justify-center shadow-xl transition-all active:scale-95 bg-[#800000] text-white ring-4 ring-white"
        >
          <Heart size={32} />
        </button>
        <span className={`text-[10px] font-bold mt-2 ${currentScreen === 'giving' ? 'text-[#937022]' : 'text-gray-400'}`}>
          {t.giving}
        </span>
      </div>

      {/* Right side */}
      <div className="flex flex-1 justify-around">
        {navItems.slice(3).map((item) => {
          const Icon = item.icon;
          const isActive = currentScreen === item.id;
          return (
            <button
              key={item.id}
              onClick={() => onScreenChange(item.id)}
              className={`flex flex-col items-center justify-center gap-1 transition-colors ${
                isActive ? 'text-[#937022]' : 'text-gray-400'
              }`}
            >
              <Icon size={20} strokeWidth={isActive ? 2.5 : 2} />
              <span className="text-[9px] font-bold">{item.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
