import { useState } from 'react';
import { CalendarDays, Church, X, Check } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Church as ChurchType, Language } from '../types';
import { TRANSLATIONS } from '../translations';

interface HeaderProps {
  onProfileClick?: () => void;
  userChurches?: ChurchType[];
  activeChurch?: ChurchType;
  onChurchChange?: (church: ChurchType) => void;
  language: Language;
  activeEventTitle?: string | null;
  onReturnToEvent?: () => void;
}

export default function Header({
  onProfileClick,
  userChurches = [],
  activeChurch,
  onChurchChange,
  language,
  activeEventTitle,
  onReturnToEvent,
}: HeaderProps) {
  const [showChurchSwitcher, setShowChurchSwitcher] = useState(false);
  const t = TRANSLATIONS[language].common;

  const sortedChurches = [...userChurches].sort((a, b) => a.name.localeCompare(b.name));

  return (
    <>
      <header className="flex items-center justify-between px-6 lg:px-8 pb-3 bg-white sticky top-0 z-40 border-b border-gray-50" style={{ paddingTop: 'calc(env(safe-area-inset-top) + 1rem)' }}>
        {/* Logo — visible on mobile; hidden on desktop (sidebar shows it) */}
        <div className="flex items-center gap-3 lg:hidden">
          <div className="w-10 h-10 flex items-center justify-center overflow-hidden bg-[#800000] rounded-xl shadow-lg shadow-red-900/20">
            <Church className="text-white" size={24} />
          </div>
          <span className="font-black text-xl tracking-tighter uppercase text-gray-900 leading-none">Kandilo</span>
        </div>

        {/* Desktop Header Left Side (Empty to keep it super clean and minimalist) */}
        <div className="hidden lg:block flex-1" />

        <div className="flex items-center gap-4 text-gray-800">
          {activeEventTitle && onReturnToEvent && (
            <button
              onClick={onReturnToEvent}
              className="hidden items-center gap-2 rounded-xl bg-[#800000]/10 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-[#800000] transition-colors hover:bg-[#800000] hover:text-white sm:flex"
              title={activeEventTitle}
            >
              <CalendarDays size={15} />
              Event
            </button>
          )}
          {userChurches.length > 1 && (
            <button 
              onClick={() => setShowChurchSwitcher(true)}
              className="p-2 hover:bg-gray-50 rounded-xl transition-colors text-gray-400 hover:text-[#800000] lg:hidden"
            >
              <Church size={22} />
            </button>
          )}
          <button 
            onClick={onProfileClick}
            className="w-9 h-9 bg-gray-200 rounded-full overflow-hidden border border-gray-100 hover:scale-105 transition-transform active:scale-95"
          >
            <div className="w-full h-full bg-[#800000] flex items-center justify-center text-white font-black text-xs">
              K
            </div>
          </button>
        </div>
      </header>

      <AnimatePresence>
        {showChurchSwitcher && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-sm flex items-end justify-center"
          >
            <motion.div
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 200 }}
              className="w-full max-w-md bg-white rounded-t-[48px] p-8 pb-12 shadow-2xl"
            >
              <div className="flex items-center justify-between mb-8">
                <div>
                  <h3 className="text-2xl font-black text-gray-900 tracking-tight">{t.switchChurch}</h3>
                  <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest mt-1">{t.selectParish}</p>
                </div>
                <button 
                  onClick={() => setShowChurchSwitcher(false)}
                  className="w-10 h-10 bg-gray-50 rounded-full flex items-center justify-center text-gray-400 hover:text-gray-900 transition-colors"
                >
                  <X size={20} />
                </button>
              </div>
              
              <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-2 custom-scrollbar">
                {sortedChurches.map((church) => (
                  <button 
                    key={church.id}
                    onClick={() => {
                      onChurchChange?.(church);
                      setShowChurchSwitcher(false);
                    }}
                    className={`w-full flex items-center gap-4 p-4 rounded-3xl transition-all border ${
                      activeChurch?.id === church.id 
                        ? 'bg-[#800000]/5 border-[#800000]/20' 
                        : 'bg-gray-50 border-transparent hover:bg-gray-100'
                    }`}
                  >
                    <div className="w-14 h-14 rounded-2xl overflow-hidden flex-shrink-0">
                      <img 
                        src={church.image} 
                        alt={church.name} 
                        className="w-full h-full object-cover"
                        referrerPolicy="no-referrer"
                      />
                    </div>
                    <div className="flex-1 text-left">
                      <h4 className={`font-black text-sm ${activeChurch?.id === church.id ? 'text-[#800000]' : 'text-gray-900'}`}>
                        {church.name}
                      </h4>
                      <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest">{church.location}</p>
                    </div>
                    {activeChurch?.id === church.id && (
                      <div className="w-8 h-8 bg-[#800000] rounded-full flex items-center justify-center text-white">
                        <Check size={16} />
                      </div>
                    )}
                  </button>
                ))}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
