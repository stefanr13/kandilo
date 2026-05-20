import { motion } from 'motion/react';
import {
  Book,
  ChevronRight,
  Church,
  ExternalLink,
  HeartHandshake,
  Instagram,
  MessageCircle,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { Language } from '../../types';
import { TRANSLATIONS } from '../../translations';

interface MoreScreenProps {
  onOpenProfile: () => void;
  onOpenCommunity: () => void;
  language: Language;
}

export default function MoreScreen({ onOpenProfile, onOpenCommunity, language }: MoreScreenProps) {
  const t = TRANSLATIONS[language].more;

  const resourceItems: Array<{
    label: string;
    icon: LucideIcon;
    sub: string;
    color?: string;
    onClick?: () => void;
  }> = [
    { label: t.communityDirectory, icon: Users, sub: t.communityDirectorySub, onClick: onOpenCommunity },
    { label: t.parishHistory, icon: Church, sub: t.parishHistorySub },
    { label: t.spiritualLibrary, icon: Book, sub: t.spiritualLibrarySub },
    { label: t.ministries, icon: HeartHandshake, sub: t.ministriesSub },
    { label: t.followInstagram, icon: Instagram, sub: t.instagramHandle, color: '#E4405F' },
    { label: t.contactUs, icon: MessageCircle, sub: t.contactUsSub },
  ];

  return (
    <motion.div
      key="more"
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 1.05 }}
      className="p-8 lg:w-full lg:max-w-6xl lg:mx-auto lg:px-10 lg:pt-8 lg:pb-12"
    >
      <div className="mb-10">
        <span className="text-[#937022] font-black text-[10px] tracking-[0.2em] uppercase mb-2 block">
          {t.parishResources}
        </span>
        <h1 className="text-4xl font-black text-gray-900 tracking-tighter">{t.title}</h1>
      </div>

      <div className="lg:grid lg:grid-cols-[1fr_340px] lg:gap-10 lg:items-start">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 mb-12 lg:mb-0">
          {resourceItems.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.label}
                onClick={item.onClick}
                className="w-full bg-white rounded-[24px] p-6 flex items-center gap-5 border border-gray-50 shadow-sm hover:bg-gray-50 hover:shadow-md transition-all group"
              >
                <div className="w-12 h-12 rounded-2xl bg-gray-50 flex items-center justify-center text-gray-400 group-hover:text-[#937022] transition-colors flex-shrink-0">
                  <Icon size={22} style={{ color: item.color }} />
                </div>
                <div className="flex-1 text-left">
                  <h4 className="font-bold text-gray-900 text-sm">{item.label}</h4>
                  <p className="text-[10px] text-gray-400 font-medium">{item.sub}</p>
                </div>
                {item.onClick ? (
                  <ChevronRight
                    size={16}
                    className="text-gray-200 group-hover:text-gray-400 transition-colors"
                  />
                ) : (
                  <ExternalLink
                    size={16}
                    className="text-gray-200 group-hover:text-gray-400 transition-colors"
                  />
                )}
              </button>
            );
          })}
        </div>

        <div className="p-8 bg-gray-900 rounded-[40px] text-center text-white relative overflow-hidden lg:sticky lg:top-6">
          <div className="absolute inset-0 bg-gradient-to-br from-[#800000]/20 via-transparent to-[#937022]/10" />
          <div className="relative z-10">
            <h3 className="text-xl font-black italic mb-2">{t.needInvitation}</h3>
            <p className="text-[10px] text-white/60 mb-6 leading-relaxed">
              {t.needInvitationSub}
            </p>
            <button
              onClick={onOpenProfile}
              className="bg-white text-gray-900 px-8 py-3 rounded-full font-black text-[10px] uppercase tracking-widest hover:bg-gray-100 transition-colors"
            >
              {t.viewChurches}
            </button>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
