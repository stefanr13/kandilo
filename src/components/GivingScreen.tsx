import { useState, useEffect } from 'react';
import {
  Heart,
  CheckCircle2,
  Star,
  Mail,
  X,
  ChevronRight,
  Gift,
  HandHeart,
  Loader2,
  MapPin,
} from 'lucide-react';
import { motion } from 'motion/react';
import confetti from 'canvas-confetti';
import type { User as FirebaseUser } from 'firebase/auth';
import { APP_URL_OPENED_EVENT, getGivingCheckoutState, type AppLocationSnapshot } from '../app/navigation';
import { openExternalUrl } from '../app/native';
import { createGivingCheckoutSession } from '../lib/api/giving';
import { getGivingStatus, type GivingStatus } from '../lib/db/giving';
import {
  assertStripeCheckoutUrl,
  GIVING_CONFIRMATION_ATTEMPTS,
  GIVING_CONFIRMATION_DELAY_MS,
  PENDING_GIVING_STORAGE_KEY,
} from '../lib/giving/checkout';
import { Screen, Language, Church } from '../types';
import { TRANSLATIONS } from '../translations';
import { getExtraCopy } from '../localization/extra';

interface GivingScreenProps {
  onScreenChange?: (screen: Screen) => void;
  language?: Language;
  activeChurch: Church | null;
  activeChurchId: string | null;
  currentUser?: FirebaseUser | null;
}

type GivingPhase = 'none' | 'details' | 'payment' | 'success';

async function waitForGivingStatus(givingId: string): Promise<GivingStatus> {
  for (let attempt = 0; attempt < GIVING_CONFIRMATION_ATTEMPTS; attempt++) {
    const status = await getGivingStatus(givingId);
    if (status === 'completed' || status === 'failed') {
      return status;
    }
    await new Promise((resolve) => window.setTimeout(resolve, GIVING_CONFIRMATION_DELAY_MS));
  }
  return getGivingStatus(givingId);
}

export default function GivingScreen({
  onScreenChange,
  language = 'English',
  activeChurch,
  activeChurchId,
  currentUser,
}: GivingScreenProps) {
  const [givingPhase, setGivingPhase] = useState<GivingPhase>('none');
  const [amount, setAmount] = useState<string>('50');
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [checkoutMessage, setCheckoutMessage] = useState('');
  
  const t = TRANSLATIONS[language].giving;
  const extra = getExtraCopy(language).giving;

  const [givingData, setGivingData] = useState({
    fullName: currentUser?.displayName ?? '',
    email: currentUser?.email ?? '',
    purpose: t.generalFund,
    anonymous: false
  });

  useEffect(() => {
    const scrollContainer = document.querySelector('main');
    if (scrollContainer) {
      scrollContainer.scrollTo({ top: 0, behavior: 'instant' });
    }
  }, [givingPhase]);

  useEffect(() => {
    setGivingData((current) => ({
      ...current,
      fullName: currentUser?.displayName ?? current.fullName,
      email: currentUser?.email ?? current.email,
    }));
  }, [currentUser]);

  useEffect(() => {
    try {
      const raw = window.sessionStorage.getItem(PENDING_GIVING_STORAGE_KEY);
      if (!raw) {
        return;
      }

      const saved = JSON.parse(raw) as {
        amount?: string;
        fullName?: string;
        email?: string;
        purpose?: string;
        anonymous?: boolean;
      };

      if (saved.amount) {
        setAmount(saved.amount);
      }
      setGivingData((current) => ({
        ...current,
        fullName: saved.fullName ?? current.fullName,
        email: saved.email ?? current.email,
        purpose: saved.purpose ?? current.purpose,
        anonymous: saved.anonymous ?? current.anonymous,
      }));
    } catch (error) {
      console.warn(extra.restoreFailed, error);
    }
  }, [extra.restoreFailed]);

  useEffect(() => {
    const applyCheckoutState = async (search: string) => {
      const checkoutState = getGivingCheckoutState(search);
      const params = new URLSearchParams(search);
      const givingId = params.get('givingId');

      if (checkoutState === 'success') {
        if (!givingId) {
          setGivingPhase('payment');
          setCheckoutMessage(extra.confirmMissing);
          window.history.replaceState({}, '', '/');
          return;
        }

        setGivingPhase('payment');
        setCheckoutMessage(extra.confirming);
        const status = await waitForGivingStatus(givingId);
        if (status === 'completed') {
          window.sessionStorage.removeItem(PENDING_GIVING_STORAGE_KEY);
          setCheckoutMessage('');
          triggerSuccessCelebration();
        } else if (status === 'failed') {
          setCheckoutMessage(extra.stripeFailed);
        } else {
          setCheckoutMessage(extra.stillConfirming);
        }
        window.history.replaceState({}, '', '/');
        return;
      }

      if (checkoutState === 'cancel') {
        setGivingPhase('payment');
        setCheckoutMessage(extra.canceled);
        window.history.replaceState({}, '', '/');
      }
    };

    const handleNativeUrl = (event: Event) => {
      const snapshot = (event as CustomEvent<AppLocationSnapshot>).detail;
      void applyCheckoutState(snapshot.search);
    };

    void applyCheckoutState(window.location.search);
    window.addEventListener(APP_URL_OPENED_EVENT, handleNativeUrl as EventListener);

    return () => {
      window.removeEventListener(APP_URL_OPENED_EVENT, handleNativeUrl as EventListener);
    };
  }, [extra.canceled, extra.confirming, extra.confirmMissing, extra.stillConfirming, extra.stripeFailed]);

  const triggerSuccessCelebration = () => {
    setGivingPhase('success');
    confetti({
      particleCount: 150,
      spread: 70,
      origin: { y: 0.6 },
      colors: ['#800000', '#937022', '#FFFFFF']
    });
  };

  const amountCents = Math.round(Number.parseFloat(amount || '0') * 100);

  const handleCheckout = async () => {
    if (!currentUser || currentUser.isAnonymous) {
      setCheckoutMessage(extra.signInRequired);
      return;
    }
    if (!activeChurchId) {
      setCheckoutMessage(extra.joinRequired);
      return;
    }
    if (!Number.isFinite(amountCents) || !amountCents || amountCents < 50 || amountCents > 1_000_000) {
      setCheckoutMessage(extra.invalidAmount);
      return;
    }

    setCheckoutLoading(true);
    setCheckoutMessage('');
    try {
      window.sessionStorage.setItem(
        PENDING_GIVING_STORAGE_KEY,
        JSON.stringify({
          amount,
          fullName: givingData.fullName,
          email: givingData.email,
          purpose: givingData.purpose,
          anonymous: givingData.anonymous,
        })
      );
      const result = await createGivingCheckoutSession({
        churchId: activeChurchId,
        amountCents,
        purpose: givingData.purpose,
        anonymous: givingData.anonymous,
      });
      await openExternalUrl(assertStripeCheckoutUrl(result.checkoutUrl, extra.unexpectedCheckoutUrl));
    } catch (error) {
      console.error('Failed to start checkout:', error);
      setCheckoutMessage(extra.unableCheckout);
      window.sessionStorage.removeItem(PENDING_GIVING_STORAGE_KEY);
    } finally {
      setCheckoutLoading(false);
    }
  };

  if (givingPhase === 'details') {
    return (
      <motion.div 
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="min-h-full bg-white overflow-y-auto scrollbar-hide p-8 pb-32"
      >
        <div className="lg:max-w-2xl lg:mx-auto">
        <div className="mb-10 flex justify-between items-start">
          <div>
            <span className="text-[#937022] font-black text-[10px] tracking-[0.2em] uppercase mb-2 block">{t.step} 1 {t.of} 2</span>
            <h2 className="text-3xl font-black text-gray-900 tracking-tighter">{t.details}</h2>
            <p className="text-gray-400 text-sm mt-2 font-medium">{t.supportSub}</p>
          </div>
          <button onClick={() => setGivingPhase('none')} className="p-2 bg-gray-50 rounded-full">
            <X size={20} className="text-gray-400" />
          </button>
        </div>

        <div className="space-y-6">
          <div className="space-y-2">
            <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">{t.selectAmount}</label>
            <div className="grid grid-cols-3 gap-3">
              {['25', '50', '100', '250', '500'].map((val) => (
                <button 
                  key={val}
                  onClick={() => setAmount(val)}
                  className={`py-4 rounded-2xl font-black text-sm transition-all ${amount === val ? 'bg-[#800000] text-white shadow-lg shadow-red-900/20' : 'bg-gray-50 text-gray-400 hover:bg-gray-100'}`}
                >
                  ${val}
                </button>
              ))}
              <div className="relative">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 font-bold text-xs">$</span>
                <input 
                  type="number" 
                  placeholder={t.other}
                  value={amount === '25' || amount === '50' || amount === '100' || amount === '250' || amount === '500' ? '' : amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="w-full bg-gray-50 border-none rounded-2xl pl-8 pr-4 py-4 text-sm font-bold text-gray-900 focus:ring-2 focus:ring-[#800000]/20 transition-all"
                />
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">{t.fullName}</label>
            <input 
              type="text" 
              placeholder="John Doe"
              value={givingData.fullName}
              onChange={(e) => setGivingData({...givingData, fullName: e.target.value})}
              className="w-full bg-gray-50 border-none rounded-2xl px-6 py-4 text-sm font-bold text-gray-900 focus:ring-2 focus:ring-[#800000]/20 transition-all"
            />
          </div>

          <div className="space-y-2">
            <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">{t.email}</label>
            <div className="relative">
              <Mail size={16} className="absolute left-6 top-1/2 -translate-y-1/2 text-gray-300" />
              <input 
                type="email" 
                value={givingData.email}
                readOnly
                className="w-full bg-gray-50 border-none rounded-2xl pl-14 pr-6 py-4 text-sm font-bold text-gray-900 focus:ring-2 focus:ring-[#800000]/20 transition-all"
              />
            </div>
            <p className="text-[10px] font-bold text-gray-400 ml-1">
              {extra.receiptsEmail}
            </p>
          </div>

          <div className="space-y-2">
            <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">{t.purpose}</label>
            <select 
              value={givingData.purpose}
              onChange={(e) => setGivingData({...givingData, purpose: e.target.value})}
              className="w-full bg-gray-50 border-none rounded-2xl px-6 py-4 text-sm font-bold text-gray-900 focus:ring-2 focus:ring-[#800000]/20 transition-all appearance-none"
            >
              <option>{t.generalFund}</option>
              <option>{t.buildingFund}</option>
              <option>{t.charityOutreach}</option>
              <option>{t.choirLiturgical}</option>
              <option>{t.youthPrograms}</option>
            </select>
          </div>

          <div className="space-y-4 pt-4">
            <button 
              onClick={() => setGivingData({...givingData, anonymous: !givingData.anonymous})}
              className="w-full flex items-center gap-4 p-5 bg-gray-50 rounded-2xl group transition-all"
            >
              <div className={`w-5 h-5 rounded-md flex items-center justify-center transition-all ${givingData.anonymous ? 'bg-[#800000] text-white' : 'bg-white border-2 border-gray-200'}`}>
                {givingData.anonymous && <CheckCircle2 size={12} />}
              </div>
              <div className="flex-1 text-left">
                <h4 className="text-xs font-black text-gray-900 leading-tight">{t.anonymous}</h4>
                <p className="text-[9px] text-gray-400 font-bold mt-0.5">{t.anonymousSub}</p>
              </div>
            </button>
          </div>

          <button 
            onClick={() => setGivingPhase('payment')}
            className="w-full py-5 bg-gray-900 text-white rounded-3xl font-black text-[10px] uppercase tracking-widest hover:bg-[#800000] transition-all shadow-xl shadow-black/10 mt-8"
          >
            {t.continuePayment}
          </button>
        </div>
        </div>
      </motion.div>
    );
  }

  if (givingPhase === 'payment') {
    return (
      <motion.div 
        initial={{ opacity: 0, x: 20 }}
        animate={{ opacity: 1, x: 0 }}
        className="min-h-full bg-white overflow-y-auto scrollbar-hide p-8 pb-32"
      >
        <div className="lg:max-w-2xl lg:mx-auto">
        <div className="mb-10 flex justify-between items-start">
          <div>
            <span className="text-[#937022] font-black text-[10px] tracking-[0.2em] uppercase mb-2 block">{t.step} 2 {t.of} 2</span>
            <h2 className="text-3xl font-black text-gray-900 tracking-tighter">{t.checkout}</h2>
            <p className="text-gray-400 text-sm mt-2 font-medium">{t.secureSub}</p>
          </div>
          <button onClick={() => setGivingPhase('details')} className="p-2 bg-gray-50 rounded-full">
            <ChevronRight size={20} className="text-gray-400 rotate-180" />
          </button>
        </div>

        <div className="space-y-6">
          <div className="bg-gray-50 rounded-3xl p-6 space-y-3">
            <p className="text-[10px] font-black text-[#937022] uppercase tracking-widest">
              {extra.secureCheckout}
            </p>
            <h3 className="text-xl font-black text-gray-900 tracking-tight">
              {activeChurch?.name ?? extra.yourParish}
            </h3>
            <p className="text-sm font-medium text-gray-500 leading-relaxed">
              {extra.redirectStripe}
            </p>
            <div className="grid grid-cols-2 gap-4 pt-2 text-xs font-bold text-gray-500">
              <div>
                <p className="text-[10px] font-black text-gray-300 uppercase tracking-widest mb-1">
                  {extra.donor}
                </p>
                <p className="text-gray-900">{givingData.fullName || currentUser?.displayName || extra.parishioner}</p>
              </div>
              <div>
                <p className="text-[10px] font-black text-gray-300 uppercase tracking-widest mb-1">
                  {extra.receipt}
                </p>
                <p className="text-gray-900 break-all">{givingData.email || currentUser?.email || extra.noEmail}</p>
              </div>
            </div>
          </div>

          <div className="bg-gray-50 rounded-3xl p-6 mt-4">
            <div className="flex justify-between items-center mb-2">
              <span className="text-xs font-bold text-gray-500">{t.donationAmount}</span>
              <span className="text-xs font-black text-gray-900">${(amountCents / 100).toFixed(2)}</span>
            </div>
            <div className="flex justify-between items-center mb-2">
              <span className="text-xs font-bold text-gray-500">{t.purpose}</span>
              <span className="text-xs font-black text-gray-900">{givingData.purpose}</span>
            </div>
            <div className="flex justify-between items-center pt-4 border-t border-gray-200">
              <span className="text-sm font-black text-gray-900">{t.totalOffering}</span>
              <span className="text-sm font-black text-[#937022]">${(amountCents / 100).toFixed(2)}</span>
            </div>
          </div>

          {checkoutMessage && (
            <p className="text-sm font-bold text-red-500">{checkoutMessage}</p>
          )}

          <button 
            onClick={() => void handleCheckout()}
            disabled={checkoutLoading}
            className="w-full py-5 bg-[#800000] text-white rounded-3xl font-black text-[10px] uppercase tracking-widest shadow-xl shadow-red-900/20 hover:bg-[#8D1212] transition-all active:scale-95 mt-4 disabled:opacity-60 flex items-center justify-center gap-2"
          >
            {checkoutLoading ? <Loader2 size={14} className="animate-spin" /> : null}
            {extra.completeSecureCheckout}
          </button>
        </div>
        </div>
      </motion.div>
    );
  }

  if (givingPhase === 'success') {
    return (
      <motion.div 
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="min-h-full bg-white flex flex-col items-center justify-center p-8 pb-32 text-center"
      >
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ type: 'spring', damping: 15, stiffness: 200 }}
          className="w-24 h-24 bg-red-50 text-[#800000] rounded-full flex items-center justify-center mb-8"
        >
          <Heart size={48} fill="currentColor" />
        </motion.div>
        
        <h2 className="text-4xl font-black text-gray-900 tracking-tighter mb-4">{t.thankYou}</h2>
        <p className="text-gray-500 text-sm font-medium leading-relaxed mb-10 max-w-[280px]">
          {t.successMessage.replace('{amount}', `$${amount}`)}
        </p>
        
        <button 
          onClick={() => {
            window.sessionStorage.removeItem(PENDING_GIVING_STORAGE_KEY);
            setGivingPhase('none');
            onScreenChange?.('home');
          }}
          className="w-full py-5 bg-gray-900 text-white rounded-3xl font-black text-[10px] uppercase tracking-widest hover:bg-[#800000] transition-all shadow-xl shadow-black/10 flex items-center justify-center gap-3"
        >
          {t.backHome}
          <ChevronRight size={16} />
        </button>
      </motion.div>
    );
  }

  const waysToGive = [
    { title: t.oneTimeTitle, sub: t.oneTimeSub, icon: Gift },
    { title: t.monthlyTitle, sub: t.monthlySub, icon: Heart },
    { title: t.buildingTitle, sub: t.buildingSub, icon: Star },
    { title: t.inPersonTitle, sub: t.inPersonSub, icon: MapPin },
  ];

  return (
    <div className="pb-32 bg-[#F9F9F9] min-h-full">
      {/* ── Desktop 2-column layout ──────────────────────────────── */}
      <div className="hidden lg:grid lg:w-full lg:max-w-6xl lg:mx-auto lg:grid-cols-[minmax(0,0.95fr)_minmax(360px,1.05fr)] lg:gap-10 lg:px-10 lg:pt-10 lg:items-start">
        {/* Left: header + stewardship card */}
        <div>
          <div className="mb-8">
            <span className="text-[#937022] font-black text-[10px] tracking-[0.2em] uppercase mb-2 block">{t.title}</span>
            <h1 className="text-5xl font-black text-gray-900 tracking-tighter leading-none">{t.donateNow}.</h1>
            <p className="text-gray-400 text-sm mt-4 font-medium leading-relaxed max-w-sm">{t.description}</p>
          </div>

          <div className="bg-white rounded-[40px] p-8 shadow-sm border border-gray-100">
            <div className="flex items-center gap-4 mb-8">
              <div className="w-14 h-14 bg-red-50 rounded-2xl flex items-center justify-center text-[#800000]">
                <HandHeart size={28} />
              </div>
              <div>
                <h3 className="font-black text-gray-900 text-lg tracking-tight">{t.stewardship}</h3>
                <p className="text-[10px] text-[#937022] font-bold uppercase tracking-widest">{t.goal}: $250,000</p>
              </div>
            </div>
            <div className="w-full h-3 bg-gray-50 rounded-full overflow-hidden mb-4">
              <motion.div initial={{ width: 0 }} animate={{ width: '65%' }} transition={{ duration: 1.5, ease: "easeOut" }} className="h-full bg-[#800000]" />
            </div>
            <div className="flex justify-between items-center mb-8">
              <span className="text-[10px] font-black text-gray-900">$162,500 {t.raised}</span>
              <span className="text-[10px] font-black text-[#937022]">65% {t.ofGoal}</span>
            </div>
            <button
              onClick={() => setGivingPhase('details')}
              className="w-full py-5 bg-[#800000] text-white rounded-full font-black text-xs uppercase tracking-[0.2em] shadow-xl shadow-red-900/20 hover:bg-[#8D1212] transition-all active:scale-95"
            >
              {t.makeDonation}
            </button>
          </div>
        </div>

        {/* Right: ways to give */}
        <div>
          <h2 className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] mb-6">{t.waysToGive}</h2>
          <div className="space-y-4">
            {waysToGive.map((item, i) => (
              <div key={i} className="bg-white rounded-[24px] p-5 flex items-center gap-5 border border-transparent hover:border-gray-100 transition-all shadow-sm cursor-pointer hover:shadow-md">
                <div className="w-12 h-12 rounded-2xl bg-gray-50 flex items-center justify-center text-[#937022]">
                  <item.icon size={22} />
                </div>
                <div className="flex-1">
                  <h4 className="font-bold text-gray-900 text-sm">{item.title}</h4>
                  <p className="text-[10px] text-gray-400 mt-0.5 font-medium">{item.sub}</p>
                </div>
                <ChevronRight size={16} className="text-gray-200" />
              </div>
            ))}
          </div>

          {/* Impact stats */}
          <div className="mt-8 bg-gray-900 rounded-[32px] p-8 text-white">
            <h3 className="text-lg font-black tracking-tight mb-6">{extra.yourImpact}</h3>
            <div className="grid grid-cols-2 gap-4">
              {[
                { value: '342', label: extra.familiesSupported },
                { value: '$12K', label: extra.donatedThisMonth },
                { value: '89%', label: extra.goalProgress },
                { value: '5 yrs', label: extra.avgStewardship },
              ].map(({ value, label }) => (
                <div key={label} className="bg-white/5 rounded-2xl p-4">
                  <p className="text-2xl font-black text-[#937022] tracking-tight">{value}</p>
                  <p className="text-[10px] text-white/50 font-bold uppercase tracking-widest mt-1">{label}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ── Mobile layout (unchanged) ────────────────────────────── */}
      <div className="lg:hidden">
        <div className="px-8 pt-12 mb-10 text-center">
          <span className="text-[#937022] font-black text-[10px] tracking-[0.2em] uppercase mb-2 block">{t.title}</span>
          <h1 className="text-5xl font-black text-gray-900 tracking-tighter leading-none">{t.donateNow}.</h1>
          <p className="text-gray-400 text-sm mt-4 max-w-[280px] mx-auto font-medium leading-relaxed">{t.description}</p>
        </div>

        <div className="px-6 mb-12">
          <div className="bg-white rounded-[40px] p-8 shadow-sm border border-gray-100">
            <div className="flex items-center gap-4 mb-8">
              <div className="w-14 h-14 bg-red-50 rounded-2xl flex items-center justify-center text-[#800000]">
                <HandHeart size={28} />
              </div>
              <div>
                <h3 className="font-black text-gray-900 text-lg tracking-tight">{t.stewardship}</h3>
                <p className="text-[10px] text-[#937022] font-bold uppercase tracking-widest">{t.goal}: $250,000</p>
              </div>
            </div>
            <div className="w-full h-3 bg-gray-50 rounded-full overflow-hidden mb-4">
              <motion.div initial={{ width: 0 }} animate={{ width: '65%' }} transition={{ duration: 1.5, ease: "easeOut" }} className="h-full bg-[#800000]" />
            </div>
            <div className="flex justify-between items-center mb-8">
              <span className="text-[10px] font-black text-gray-900">$162,500 {t.raised}</span>
              <span className="text-[10px] font-black text-[#937022]">65% {t.ofGoal}</span>
            </div>
            <button onClick={() => setGivingPhase('details')} className="w-full py-5 bg-[#800000] text-white rounded-full font-black text-xs uppercase tracking-[0.2em] shadow-xl shadow-red-900/20 hover:bg-[#8D1212] transition-all active:scale-95">
              {t.makeDonation}
            </button>
          </div>
        </div>

        <div className="px-8 space-y-4">
          <h2 className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] mb-4 ml-2">{t.waysToGive}</h2>
          {waysToGive.map((item, i) => (
            <div key={i} className="bg-white rounded-[24px] p-5 flex items-center gap-5 border border-transparent hover:border-gray-100 transition-all shadow-sm">
              <div className="w-12 h-12 rounded-2xl bg-gray-50 flex items-center justify-center text-gray-400">
                <item.icon size={22} />
              </div>
              <div className="flex-1">
                <h4 className="font-bold text-gray-900 text-sm">{item.title}</h4>
                <p className="text-[10px] text-gray-400 mt-0.5 font-medium">{item.sub}</p>
              </div>
              <ChevronRight size={16} className="text-gray-200" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
