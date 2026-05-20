import { BarChart3, Church, Star } from 'lucide-react';

export type MCTab = 'overview' | 'churches' | 'analytics';

interface MissionControlTabBarProps {
  activeTab: MCTab;
  onTabChange: (tab: MCTab) => void;
}

const TABS = [
  { id: 'overview', label: 'Overview', icon: BarChart3 },
  { id: 'churches', label: 'Churches', icon: Church },
  { id: 'analytics', label: 'Analytics', icon: Star },
] as const;

export default function MissionControlTabBar({
  activeTab,
  onTabChange,
}: MissionControlTabBarProps) {
  return (
    <div className="flex border-b border-gray-800 px-4 pt-2 gap-1 flex-shrink-0">
      {TABS.map(({ id, label, icon: Icon }) => (
        <button
          key={id}
          onClick={() => onTabChange(id)}
          className={`flex items-center gap-1.5 px-4 py-2.5 rounded-t-xl text-[10px] font-black uppercase tracking-widest transition-all ${
            activeTab === id ? 'bg-gray-800 text-white' : 'text-gray-500 hover:text-gray-300'
          }`}
        >
          <Icon size={13} />
          {label}
        </button>
      ))}
    </div>
  );
}
