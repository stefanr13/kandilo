import { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Mail,
  Lock,
  User,
  ArrowRight,
  ChevronLeft,
  Chrome as Google,
  Globe,
  LogIn,
  Loader2,
} from 'lucide-react';
import { Language } from '../types';
import { signIn, signUp, signInWithGoogle, signInAsGuest, resetPassword, getFirebaseAuthError } from '../lib/auth';
import { isNativePlatform } from '../app/native';
import { getExtraCopy } from '../localization/extra';

interface AuthScreenProps {
  onLogin: (language: Language) => void;
  hideGuestOption?: boolean;
  contextMessage?: string;
}

type AuthMode = 'language' | 'landing' | 'signin' | 'signup' | 'forgot-password';

const TRANSLATIONS: Record<
  Language,
  {
    tagline: string;
    getStarted: string;
    signIn: string;
    welcome: string;
    join: string;
    reset: string;
    description: string;
    guest: string;
    chooseLanguage: string;
    chooseLanguageSub: string;
    back: string;
    orContinueWith: string;
    forgotPassword: string;
    signInBtn: string;
    createAccount: string;
    sendResetLink: string;
    signInSub: string;
    signUpSub: string;
    resetSub: string;
    noAccount: string;
    hasAccount: string;
    signUpLink: string;
    signInLink: string;
    fullName: string;
    emailAddress: string;
    password: string;
    resetSent: string;
    checkInbox: string;
    nameRequired: string;
    emailRequired: string;
    emailInvalid: string;
    passwordRequired: string;
    passwordLength: string;
  }
> = {
  English: {
    tagline: 'Your digital companion for spiritual growth and parish connection.',
    getStarted: 'Get Started',
    signIn: 'Sign In',
    welcome: 'Welcome to Kandilo.',
    join: 'Join the Parish.',
    reset: 'Reset Password.',
    description: 'Orthodox Community',
    guest: 'Continue as Guest',
    chooseLanguage: 'Choose your language.',
    chooseLanguageSub: "Select the language you'd like to use for the Kandilo app.",
    back: 'Back',
    orContinueWith: 'Or continue with',
    forgotPassword: 'Forgot Password?',
    signInBtn: 'Sign In',
    createAccount: 'Create Account',
    sendResetLink: 'Send Reset Link',
    signInSub: 'Sign in to stay connected with your community.',
    signUpSub: 'Create an account to access all features.',
    resetSub: 'Enter your email to receive a reset link.',
    noAccount: "Don't have an account?",
    hasAccount: 'Already have an account?',
    signUpLink: 'Sign Up',
    signInLink: 'Sign In',
    fullName: 'Full Name',
    emailAddress: 'Email Address',
    password: 'Password',
    resetSent: 'Reset link sent!',
    checkInbox: 'Check your email inbox.',
    nameRequired: 'Full name is required',
    emailRequired: 'Email is required',
    emailInvalid: 'Email is invalid',
    passwordRequired: 'Password is required',
    passwordLength: 'Password must be at least 8 characters',
  },
  'Srpski (Latinica)': {
    tagline: 'Vaš digitalni saputnik za duhovni rast i povezanost sa parohijom.',
    getStarted: 'Kreni',
    signIn: 'Prijavi se',
    welcome: 'Dobrodošli u Kandilo.',
    join: 'Pridruži se parohiji.',
    reset: 'Resetuj lozinku.',
    description: 'Pravoslavna zajednica',
    guest: 'Nastavi kao gost',
    chooseLanguage: 'Izaberite jezik.',
    chooseLanguageSub: 'Izaberite jezik koji želite da koristite u Kandilo aplikaciji.',
    back: 'Nazad',
    orContinueWith: 'Ili nastavite sa',
    forgotPassword: 'Zaboravili lozinku?',
    signInBtn: 'Prijavi se',
    createAccount: 'Kreiraj nalog',
    sendResetLink: 'Pošalji link za reset',
    signInSub: 'Prijavite se da ostanete povezani sa svojom zajednicom.',
    signUpSub: 'Kreirajte nalog za pristup svim funkcijama.',
    resetSub: 'Unesite email da primite link za resetovanje.',
    noAccount: 'Nemate nalog?',
    hasAccount: 'Već imate nalog?',
    signUpLink: 'Registruj se',
    signInLink: 'Prijavi se',
    fullName: 'Ime i prezime',
    emailAddress: 'Email adresa',
    password: 'Lozinka',
    resetSent: 'Link za reset je poslat!',
    checkInbox: 'Proverite vaš email.',
    nameRequired: 'Ime je obavezno',
    emailRequired: 'Email je obavezan',
    emailInvalid: 'Email nije validan',
    passwordRequired: 'Lozinka je obavezna',
    passwordLength: 'Lozinka mora imati najmanje 8 karaktera',
  },
  'Srpski (Ćirilica)': {
    tagline: 'Ваш дигитални сапутник за духовни раст и повезаност са парохијом.',
    getStarted: 'Крени',
    signIn: 'Пријави се',
    welcome: 'Добродошли у Кандило.',
    join: 'Придружи се парохији.',
    reset: 'Ресетуј лозинку.',
    description: 'Православна заједница',
    guest: 'Настави као гост',
    chooseLanguage: 'Изаберите језик.',
    chooseLanguageSub: 'Изаберите језик који желите да користите у Кандило апликацији.',
    back: 'Назад',
    orContinueWith: 'Или наставите са',
    forgotPassword: 'Заборавили лозинку?',
    signInBtn: 'Пријави се',
    createAccount: 'Креирај налог',
    sendResetLink: 'Пошаљи линк за ресет',
    signInSub: 'Пријавите се да останете повезани са својом заједницом.',
    signUpSub: 'Креирајте налог за приступ свим функцијама.',
    resetSub: 'Унесите емаил да примите линк за ресетовање.',
    noAccount: 'Немате налог?',
    hasAccount: 'Већ имате налог?',
    signUpLink: 'Региструј се',
    signInLink: 'Пријави се',
    fullName: 'Име и презиме',
    emailAddress: 'Емаил адреса',
    password: 'Лозинка',
    resetSent: 'Линк за ресет је послат!',
    checkInbox: 'Проверите ваш емаил.',
    nameRequired: 'Име је обавезно',
    emailRequired: 'Емаил је обавезан',
    emailInvalid: 'Емаил није валидан',
    passwordRequired: 'Лозинка је обавезна',
    passwordLength: 'Лозинка мора имати најмање 8 карактера',
  },
  Русский: {
    tagline: 'Ваш цифровой спутник для духовного роста и связи с приходом.',
    getStarted: 'Начать',
    signIn: 'Войти',
    welcome: 'Добро пожаловать в Кандило.',
    join: 'Присоединиться к приходу.',
    reset: 'Сбросить пароль.',
    description: 'Православная община',
    guest: 'Продолжить как гость',
    chooseLanguage: 'Выберите язык.',
    chooseLanguageSub: 'Выберите язык для приложения Кандило.',
    back: 'Назад',
    orContinueWith: 'Или продолжите с',
    forgotPassword: 'Забыли пароль?',
    signInBtn: 'Войти',
    createAccount: 'Создать аккаунт',
    sendResetLink: 'Отправить ссылку',
    signInSub: 'Войдите, чтобы оставаться на связи с общиной.',
    signUpSub: 'Создайте аккаунт для доступа ко всем функциям.',
    resetSub: 'Введите email для получения ссылки на сброс.',
    noAccount: 'Нет аккаунта?',
    hasAccount: 'Уже есть аккаунт?',
    signUpLink: 'Регистрация',
    signInLink: 'Войти',
    fullName: 'Полное имя',
    emailAddress: 'Электронная почта',
    password: 'Пароль',
    resetSent: 'Ссылка для сброса отправлена!',
    checkInbox: 'Проверьте вашу почту.',
    nameRequired: 'Имя обязательно',
    emailRequired: 'Email обязателен',
    emailInvalid: 'Email недействителен',
    passwordRequired: 'Пароль обязателен',
    passwordLength: 'Пароль должен содержать минимум 8 символов',
  },
  Română: {
    tagline: 'Partenerul tău digital pentru creștere spirituală și conexiune cu parohia.',
    getStarted: 'Începe acum',
    signIn: 'Autentificare',
    welcome: 'Bun venit la Kandilo.',
    join: 'Alătură-te parohiei.',
    reset: 'Resetează parola.',
    description: 'Comunitatea Ortodoxă',
    guest: 'Continuă ca vizitator',
    chooseLanguage: 'Alegeți limba.',
    chooseLanguageSub: 'Selectați limba pe care doriți să o utilizați în aplicația Kandilo.',
    back: 'Înapoi',
    orContinueWith: 'Sau continuă cu',
    forgotPassword: 'Ai uitat parola?',
    signInBtn: 'Autentificare',
    createAccount: 'Creează cont',
    sendResetLink: 'Trimite link de resetare',
    signInSub: 'Autentifică-te pentru a rămâne conectat cu comunitatea ta.',
    signUpSub: 'Creează un cont pentru acces la toate funcțiile.',
    resetSub: 'Introdu emailul pentru a primi un link de resetare.',
    noAccount: 'Nu ai cont?',
    hasAccount: 'Ai deja cont?',
    signUpLink: 'Înregistrare',
    signInLink: 'Autentificare',
    fullName: 'Nume complet',
    emailAddress: 'Adresă de email',
    password: 'Parolă',
    resetSent: 'Link-ul de resetare a fost trimis!',
    checkInbox: 'Verifică-ți emailul.',
    nameRequired: 'Numele este obligatoriu',
    emailRequired: 'Emailul este obligatoriu',
    emailInvalid: 'Emailul nu este valid',
    passwordRequired: 'Parola este obligatorie',
    passwordLength: 'Parola trebuie să aibă minimum 8 caractere',
  },
  Українська: {
    tagline: 'Ваш цифровий супутник для духовного зростання та зв\u2019язку з парафією.',
    getStarted: 'Розпочати',
    signIn: 'Увійти',
    welcome: 'Ласкаво просимо до Кандило.',
    join: 'Приєднатися до парафії.',
    reset: 'Скинути пароль.',
    description: 'Православна громада',
    guest: 'Продовжити як гість',
    chooseLanguage: 'Оберіть мову.',
    chooseLanguageSub: 'Оберіть мову для додатку Кандило.',
    back: 'Назад',
    orContinueWith: 'Або продовжте з',
    forgotPassword: 'Забули пароль?',
    signInBtn: 'Увійти',
    createAccount: 'Створити акаунт',
    sendResetLink: 'Надіслати посилання',
    signInSub: 'Увійдіть, щоб залишатися на зв\u2019язку з громадою.',
    signUpSub: 'Створіть акаунт для доступу до всіх функцій.',
    resetSub: 'Введіть email для отримання посилання на скидання.',
    noAccount: 'Немає акаунту?',
    hasAccount: 'Вже є акаунт?',
    signUpLink: 'Реєстрація',
    signInLink: 'Увійти',
    fullName: 'Повне ім\u2019я',
    emailAddress: 'Електронна пошта',
    password: 'Пароль',
    resetSent: 'Посилання для скидання надіслано!',
    checkInbox: 'Перевірте вашу пошту.',
    nameRequired: 'Ім\u2019я обов\u2019язкове',
    emailRequired: 'Email обов\u2019язковий',
    emailInvalid: 'Email недійсний',
    passwordRequired: 'Пароль обов\u2019язковий',
    passwordLength: 'Пароль повинен містити мінімум 8 символів',
  },
};

export default function AuthScreen({
  onLogin,
  hideGuestOption = false,
  contextMessage,
}: AuthScreenProps) {
  const [mode, setMode] = useState<AuthMode>('language');
  const [selectedLanguage, setSelectedLanguage] = useState<Language>('English');
  const [formData, setFormData] = useState({
    fullName: '',
    email: '',
    phone: '',
    password: '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [authError, setAuthError] = useState('');
  const [resetSent, setResetSent] = useState(false);
  const nativePlatform = isNativePlatform();

  const t = TRANSLATIONS[selectedLanguage];
  const extra = getExtraCopy(selectedLanguage).auth;

  const validate = (): boolean => {
    const newErrors: Record<string, string> = {};
    if (mode === 'signup' && !formData.fullName.trim()) {
      newErrors.fullName = t.nameRequired;
    }
    if (!formData.email.trim()) {
      newErrors.email = t.emailRequired;
    } else if (!/\S+@\S+\.\S+/.test(formData.email)) {
      newErrors.email = t.emailInvalid;
    }
    if (mode !== 'forgot-password') {
      if (!formData.password) {
        newErrors.password = t.passwordRequired;
      } else if (formData.password.length < 8) {
        newErrors.password = t.passwordLength;
      }
    }
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;

    setLoading(true);
    setAuthError('');

    try {
      if (mode === 'signin') {
        await signIn(formData.email, formData.password);
        onLogin(selectedLanguage);
      } else if (mode === 'signup') {
        await signUp(formData.email, formData.password, formData.fullName);
        onLogin(selectedLanguage);
      } else if (mode === 'forgot-password') {
        await resetPassword(formData.email);
        setResetSent(true);
      }
    } catch (err: unknown) {
      const code = (err as { code?: string }).code ?? '';
      setAuthError(getFirebaseAuthError(code, selectedLanguage));
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleLogin = async () => {
    setLoading(true);
    setAuthError('');
    try {
      await signInWithGoogle();
      onLogin(selectedLanguage);
    } catch (err: unknown) {
      const code = (err as { code?: string }).code ?? '';
      setAuthError(getFirebaseAuthError(code, selectedLanguage));
    } finally {
      setLoading(false);
    }
  };

  const handleGuestLogin = async () => {
    setLoading(true);
    setAuthError('');
    try {
      await signInAsGuest();
      onLogin(selectedLanguage);
    } catch (err: unknown) {
      const code = (err as { code?: string }).code ?? '';
      const message = code ? getFirebaseAuthError(code, selectedLanguage) : '';
      setAuthError(
        message && message !== getFirebaseAuthError('', selectedLanguage)
          ? message
          : extra.guestUnavailable
      );
    } finally {
      setLoading(false);
    }
  };

  if (mode === 'language') {
    return (
      <div className="flex min-h-full flex-col bg-white px-8 pt-20 pb-12 overflow-y-auto scrollbar-hide lg:min-h-screen lg:items-center lg:justify-center lg:bg-[#F7F4EF] lg:px-10 lg:py-12">
        <div className="w-full lg:max-w-xl lg:rounded-[36px] lg:border lg:border-gray-100 lg:bg-white lg:p-10 lg:shadow-xl lg:shadow-black/5">
          <div className="mb-12">
            <div className="w-16 h-16 bg-[#800000] rounded-[24px] flex items-center justify-center text-white shadow-xl shadow-red-900/20 mb-6">
              <Globe size={32} />
            </div>
            <h1 className="text-4xl font-black text-gray-900 tracking-tighter leading-tight">
              {t.chooseLanguage}
            </h1>
            <p className="text-sm text-gray-400 mt-2 font-medium">
              {t.chooseLanguageSub}
            </p>
          </div>

          <div className="space-y-3">
            {(Object.keys(TRANSLATIONS) as Language[]).map((lang) => (
              <button
                key={lang}
                onClick={() => {
                  setSelectedLanguage(lang);
                  setMode('landing');
                }}
                className="w-full bg-gray-50 hover:bg-gray-100 border border-transparent hover:border-gray-200 rounded-2xl p-5 flex items-center justify-between transition-all group active:scale-[0.98]"
              >
                <span className="text-sm font-black text-gray-900 uppercase tracking-widest">{lang}</span>
                <ChevronLeft size={18} className="text-gray-300 rotate-180 group-hover:text-[#937022] transition-colors" />
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (mode === 'landing') {
    return (
      <div className="flex h-full flex-col bg-white overflow-hidden lg:min-h-screen lg:flex-row lg:gap-6 lg:bg-[#F7F4EF] lg:p-6">
        <div className="relative h-[60%] w-full lg:h-auto lg:flex-1 lg:overflow-hidden lg:rounded-[36px]">
          <img
            src="https://images.unsplash.com/photo-1721836413413-9756aff1d4bb?auto=format&fit=crop&w=1200&q=80"
            alt="Parish Church"
            className="w-full h-full object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-white via-white/20 to-transparent" />
          <div className="absolute top-12 left-8">
            <div className="w-12 h-12 bg-[#800000] rounded-2xl flex items-center justify-center text-white shadow-xl shadow-red-900/20">
              <Flame size={24} />
            </div>
          </div>
          <button
            onClick={() => setMode('language')}
            className="absolute top-12 right-8 w-10 h-10 bg-white/20 backdrop-blur-md rounded-xl flex items-center justify-center text-white hover:bg-white/40 transition-colors"
          >
            <Globe size={18} />
          </button>
        </div>

        <div className="flex-1 px-8 pb-12 flex flex-col justify-center -mt-20 relative z-10 lg:mt-0 lg:max-w-md lg:rounded-[36px] lg:bg-white lg:px-10 lg:py-12 lg:shadow-xl lg:shadow-black/5">
          {contextMessage && (
            <div className="mb-6 rounded-2xl bg-amber-50 px-4 py-3">
              <p className="text-[11px] font-black text-amber-800">{contextMessage}</p>
            </div>
          )}

          <div className="mb-10">
            <span className="text-[#937022] font-black text-[10px] tracking-[0.3em] uppercase mb-2 block">
              {t.description}
            </span>
            <h1 className="text-5xl font-black text-gray-900 tracking-tighter leading-none mb-4">
              Kandilo.
            </h1>
            <p className="text-sm text-gray-400 font-medium leading-relaxed max-w-[260px]">{t.tagline}</p>
          </div>

          <div className="space-y-4">
            {authError && (
              <div className="bg-red-50 rounded-2xl px-4 py-3">
                <p className="text-[11px] font-black text-red-600">{authError}</p>
              </div>
            )}
            <button
              onClick={() => setMode('signup')}
              disabled={loading}
              className="w-full bg-gray-900 text-white py-5 rounded-2xl font-black text-[10px] uppercase tracking-widest flex items-center justify-center gap-2 hover:bg-[#800000] transition-all shadow-xl shadow-black/10 active:scale-[0.98] disabled:opacity-50"
            >
              {t.getStarted}
              <ArrowRight size={16} />
            </button>
            <button
              onClick={() => setMode('signin')}
              disabled={loading}
              className="w-full bg-[#937022] text-white py-5 rounded-2xl font-black text-[10px] uppercase tracking-widest flex items-center justify-center gap-2 hover:bg-[#7a5d1c] transition-all shadow-xl shadow-amber-900/10 active:scale-[0.98] disabled:opacity-50"
            >
              <LogIn size={16} />
              {t.signIn}
            </button>
            {!hideGuestOption && (
              <button
                onClick={handleGuestLogin}
                disabled={loading}
                className="w-full bg-white text-gray-400 py-3 rounded-2xl font-black text-[9px] uppercase tracking-[0.2em] flex items-center justify-center gap-2 hover:text-gray-600 transition-all active:scale-[0.98] disabled:opacity-50"
              >
                {loading ? <Loader2 size={14} className="animate-spin" /> : t.guest}
              </button>
            )}
          </div>

          <div className="mt-12 pt-8 border-t border-gray-50 text-center">
            <p className="text-[9px] font-black text-gray-300 uppercase tracking-[0.2em]">
              {extra.motto}
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-full flex-col bg-white px-8 pt-20 pb-12 overflow-y-auto scrollbar-hide lg:min-h-screen lg:items-center lg:justify-center lg:bg-[#F7F4EF] lg:p-0">
      <AnimatePresence mode="wait">
        <motion.div
          key={mode}
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -20 }}
          transition={{ duration: 0.3 }}
          className="flex flex-col h-full lg:h-auto lg:w-full lg:max-w-md lg:rounded-[36px] lg:border lg:border-gray-100 lg:bg-white lg:p-10 lg:shadow-xl lg:shadow-black/5"
        >
          <button
            onClick={() => { setMode('landing'); setAuthError(''); setResetSent(false); }}
            className="flex items-center gap-2 text-gray-400 hover:text-gray-900 transition-colors mb-8 -ml-2"
          >
            <ChevronLeft size={20} />
            <span className="text-xs font-black uppercase tracking-widest">{t.back}</span>
          </button>

          <div className="mb-12">
            {contextMessage && (
              <div className="mb-6 rounded-2xl bg-amber-50 px-4 py-3">
                <p className="text-[11px] font-black text-amber-800">{contextMessage}</p>
              </div>
            )}

            <div className="w-16 h-16 bg-[#800000] rounded-[24px] flex items-center justify-center text-white shadow-xl shadow-red-900/20 mb-6">
              <Flame size={32} />
            </div>
            <h1 className="text-4xl font-black text-gray-900 tracking-tighter leading-tight">
              {mode === 'signin' ? t.welcome : mode === 'signup' ? t.join : t.reset}
            </h1>
            <p className="text-sm text-gray-400 mt-2 font-medium">
              {mode === 'signin'
                ? t.signInSub
                : mode === 'signup'
                ? t.signUpSub
                : t.resetSub}
            </p>
          </div>

          {resetSent ? (
            <div className="bg-green-50 rounded-2xl p-6 text-center">
              <p className="text-sm font-black text-green-700">{t.resetSent}</p>
              <p className="text-xs text-green-600 mt-1">{t.checkInbox}</p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              {mode === 'signup' && (
                <div className="space-y-1">
                  <div className="relative">
                    <User size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" />
                    <input
                      type="text"
                      placeholder={t.fullName}
                      value={formData.fullName}
                      onChange={(e) => setFormData({ ...formData, fullName: e.target.value })}
                      className={`w-full bg-gray-50 border-none rounded-2xl pl-12 pr-6 py-4 text-sm font-bold text-gray-900 focus:ring-2 ${errors.fullName ? 'focus:ring-red-500' : 'focus:ring-[#800000]/20'} transition-all`}
                    />
                  </div>
                  {errors.fullName && (
                    <p className="text-[10px] font-black text-red-500 uppercase tracking-widest pl-4">
                      {errors.fullName}
                    </p>
                  )}
                </div>
              )}

              <div className="space-y-1">
                <div className="relative">
                  <Mail size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input
                    type="email"
                    placeholder={t.emailAddress}
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    className={`w-full bg-gray-50 border-none rounded-2xl pl-12 pr-6 py-4 text-sm font-bold text-gray-900 focus:ring-2 ${errors.email ? 'focus:ring-red-500' : 'focus:ring-[#800000]/20'} transition-all`}
                  />
                </div>
                {errors.email && (
                  <p className="text-[10px] font-black text-red-500 uppercase tracking-widest pl-4">
                    {errors.email}
                  </p>
                )}
              </div>

              {mode !== 'forgot-password' && (
                <div className="space-y-1">
                  <div className="relative">
                    <Lock size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" />
                    <input
                      type="password"
                      placeholder={t.password}
                      value={formData.password}
                      onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                      className={`w-full bg-gray-50 border-none rounded-2xl pl-12 pr-6 py-4 text-sm font-bold text-gray-900 focus:ring-2 ${errors.password ? 'focus:ring-red-500' : 'focus:ring-[#800000]/20'} transition-all`}
                    />
                  </div>
                  {errors.password && (
                    <p className="text-[10px] font-black text-red-500 uppercase tracking-widest pl-4">
                      {errors.password}
                    </p>
                  )}
                </div>
              )}

              {mode === 'signin' && (
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={() => setMode('forgot-password')}
                    className="text-[10px] font-black text-gray-400 uppercase tracking-widest hover:text-[#937022] transition-colors"
                  >
                    {t.forgotPassword}
                  </button>
                </div>
              )}

              {authError && (
                <div className="bg-red-50 rounded-2xl px-4 py-3">
                  <p className="text-[11px] font-black text-red-600">{authError}</p>
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full bg-gray-900 text-white py-4 rounded-2xl font-black text-[10px] uppercase tracking-widest flex items-center justify-center gap-2 hover:bg-[#800000] transition-all shadow-xl shadow-black/10 active:scale-[0.98] disabled:opacity-50"
              >
                {loading ? (
                  <Loader2 size={18} className="animate-spin" />
                ) : (
                  <>
                    {mode === 'signin' ? t.signInBtn : mode === 'signup' ? t.createAccount : t.sendResetLink}
                    <ArrowRight size={16} />
                  </>
                )}
              </button>
            </form>
          )}

          {mode !== 'forgot-password' && !resetSent && (
            <div className="mt-12">
              <div className="flex items-center gap-4 mb-8">
                <div className="h-px flex-1 bg-gray-100" />
                <span className="text-[10px] font-black text-gray-300 uppercase tracking-widest">
                  {t.orContinueWith}
                </span>
                <div className="h-px flex-1 bg-gray-100" />
              </div>

              {nativePlatform ? (
                <div className="rounded-2xl border border-amber-100 bg-amber-50 px-4 py-4">
                  <p className="text-[10px] font-black uppercase tracking-widest text-amber-800">
                    {extra.nativeSignInTitle}
                  </p>
                  <p className="mt-2 text-xs font-medium leading-relaxed text-amber-900">
                    {extra.nativeSignInBody}
                  </p>
                </div>
              ) : (
                <div>
                  <button
                    onClick={handleGoogleLogin}
                    disabled={loading}
                    className="w-full flex items-center justify-center gap-3 py-4 bg-white border border-gray-100 rounded-2xl hover:bg-gray-50 transition-all active:scale-95 shadow-sm disabled:opacity-50"
                  >
                    <Google size={18} className="text-red-500" />
                    <span className="text-[10px] font-black uppercase tracking-widest">{extra.google}</span>
                  </button>
                </div>
              )}
            </div>
          )}

          <div className="mt-auto pt-12 text-center">
            <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">
              {mode === 'signin' ? t.noAccount : t.hasAccount}
              <button
                onClick={() => { setMode(mode === 'signin' ? 'signup' : 'signin'); setAuthError(''); }}
                className="ml-2 text-[#937022] hover:underline"
              >
                {mode === 'signin' ? t.signUpLink : t.signInLink}
              </button>
            </p>
          </div>
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

const Flame = ({ size }: { size: number }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.5"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z" />
  </svg>
);
