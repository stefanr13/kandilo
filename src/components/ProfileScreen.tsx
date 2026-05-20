import { useRef, useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  ArrowLeft, Camera, Mail, Phone, FileText, CheckCircle2,
  Lock, X, Eye, EyeOff, Globe, LogOut, Church, LogOut as LeaveIcon,
  Loader2, MapPin, ShieldCheck,
} from 'lucide-react';
import {
  EmailAuthProvider,
  reauthenticateWithCredential,
  updatePassword as updateFirebasePassword,
  updateProfile as updateFirebaseProfile,
  type User as FirebaseUser,
} from 'firebase/auth';

import { ChurchSummary } from '../domain/church';
import { Language, ChurchMembership } from '../types';
import { TRANSLATIONS } from '../translations';
import { getExtraCopy } from '../localization/extra';
import { getFirebaseAuthError, signOut } from '../lib/auth';
import { leaveChurch, listAllChurches } from '../lib/db/churches';
import { getUserProfile, updateUserAvatar, updateUserProfile } from '../lib/db/profile';
import { uploadUserAvatar } from '../lib/storage/uploads';

interface ProfileScreenProps {
  onBack: () => void;
  language: Language;
  onLanguageChange: (lang: Language) => void;
  user?: FirebaseUser | null;
  memberships?: ChurchMembership[];
  isSuperAdmin?: boolean;
  onOpenMissionControl?: () => void;
}

const LANGUAGES: Language[] = [
  'English', 'Srpski (Latinica)', 'Srpski (Ćirilica)', 'Русский', 'Română', 'Українська'
];

export default function ProfileScreen({ onBack, language, onLanguageChange, user, memberships = [], isSuperAdmin = false, onOpenMissionControl }: ProfileScreenProps) {
  const t = TRANSLATIONS[language].profile;
  const commonT = TRANSLATIONS[language].common;
  const extra = getExtraCopy(language).profile;

  const [allChurches, setAllChurches] = useState<ChurchSummary[]>([]);
  const [churchesLoading, setChurchesLoading] = useState(true);
  const [churchesError, setChurchesError] = useState('');
  const [leavingId, setLeavingId] = useState<string | null>(null);
  const [confirmLeaveId, setConfirmLeaveId] = useState<string | null>(null);
  const [profileSaving, setProfileSaving] = useState(false);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState(user?.photoURL ?? '');
  const [profileMessage, setProfileMessage] = useState('');
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [passwordError, setPasswordError] = useState('');

  useEffect(() => {
    setChurchesError('');
    listAllChurches()
      .then(setAllChurches)
      .catch((error) => {
        console.error('Failed to load churches:', error);
        setChurchesError(extra.unableLoadChurches);
      })
      .finally(() => setChurchesLoading(false));
  }, [extra.unableLoadChurches]);

  const joinedIds = new Set(memberships.map((m) => m.churchId));
  const availableChurches = allChurches.filter((c) => !joinedIds.has(c.id));
  const noAvailableChurchesMessage =
    memberships.length === 0
      ? extra.noPublicChurches
      : extra.memberOfAllChurches;

  const handleLeave = async (churchId: string) => {
    if (!user) return;
    setLeavingId(churchId);
    setConfirmLeaveId(null);
    try {
      await leaveChurch(user.uid, churchId);
    } catch (err) {
      console.error('Failed to leave church:', err);
    } finally {
      setLeavingId(null);
    }
  };

  const [formData, setFormData] = useState({
    fullName: user?.displayName ?? '',
    email: user?.email ?? '',
    cell: '',
    ministries: [] as string[],
    description: '',
    showInDirectory: true,
    preferredLanguage: language,
  });

  useEffect(() => {
    if (!user) {
      return;
    }

    let cancelled = false;

    void getUserProfile(user.uid)
      .then((profile) => {
        if (cancelled) {
          return;
        }

        setFormData({
          fullName: profile?.displayName || user.displayName || '',
          email: user.email ?? profile?.email ?? '',
          cell: profile?.phone ?? '',
          ministries: profile?.ministries ?? [],
          description: profile?.description ?? '',
          showInDirectory: profile?.showInDirectory ?? true,
          preferredLanguage: profile?.preferredLanguage ?? language,
        });
      })
      .catch((error) => {
        console.error('Failed to load profile:', error);
      });

    return () => {
      cancelled = true;
    };
  }, [language, user]);

  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [passwordForm, setPasswordForm] = useState({
    current: '',
    new: '',
    confirm: ''
  });
  const [showPasswords, setShowPasswords] = useState({
    current: false,
    new: false,
    confirm: false
  });

  const canChangePassword = user?.providerData.some((provider) => provider.providerId === 'password') ?? false;
  const avatarInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setAvatarUrl(user?.photoURL ?? '');
  }, [user?.photoURL]);

  const toggleMinistry = (ministry: string) => {
    const newMinistries = formData.ministries.includes(ministry)
      ? formData.ministries.filter(m => m !== ministry)
      : [...formData.ministries, ministry];
    setFormData({ ...formData, ministries: newMinistries });
  };

  const handleSaveProfile = async () => {
    if (!user) return;

    const fullName = formData.fullName.trim();
    if (!fullName) {
      setProfileMessage(extra.fullNameRequired);
      return;
    }

    setProfileSaving(true);
    setProfileMessage('');
    try {
      if (fullName !== (user.displayName ?? '')) {
        await updateFirebaseProfile(user, { displayName: fullName });
      }

      await updateUserProfile(user.uid, {
        displayName: fullName,
        preferredLanguage: formData.preferredLanguage,
        phone: formData.cell.trim(),
        ministries: formData.ministries,
        description: formData.description.trim(),
        showInDirectory: formData.showInDirectory,
      });

      if (formData.preferredLanguage !== language) {
        onLanguageChange(formData.preferredLanguage);
      }

      setProfileMessage(extra.profileUpdated);
    } catch (error) {
      console.error('Failed to update profile:', error);
      setProfileMessage(extra.unableUpdateProfile);
    } finally {
      setProfileSaving(false);
    }
  };

  const handleAvatarFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !user) {
      return;
    }

    setAvatarUploading(true);
    setProfileMessage('');
    try {
      const { url } = await uploadUserAvatar(user.uid, file);
      await updateFirebaseProfile(user, { photoURL: url });
      await updateUserAvatar(user.uid, url);
      setAvatarUrl(url);
      setProfileMessage(extra.profilePhotoUpdated);
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      if (message.includes('JPG') || message.includes('PNG') || message.includes('WebP')) {
        setProfileMessage(extra.avatarInvalidType);
      } else if (message.includes('5 MB')) {
        setProfileMessage(extra.avatarTooLarge);
      } else {
        setProfileMessage(extra.unableUpdateProfilePhoto);
      }
    } finally {
      setAvatarUploading(false);
    }
  };

  const handlePasswordUpdate = async () => {
    if (!user || !user.email || !canChangePassword) {
      return;
    }

    if (!passwordForm.current || !passwordForm.new || !passwordForm.confirm) {
      setPasswordError(extra.passwordFieldsRequired);
      return;
    }
    if (passwordForm.new.length < 8) {
      setPasswordError(extra.passwordTooShort);
      return;
    }
    if (passwordForm.new !== passwordForm.confirm) {
      setPasswordError(extra.passwordsMustMatch);
      return;
    }

    setPasswordSaving(true);
    setPasswordError('');
    try {
      const credential = EmailAuthProvider.credential(user.email, passwordForm.current);
      await reauthenticateWithCredential(user, credential);
      await updateFirebasePassword(user, passwordForm.new);
      setShowPasswordModal(false);
      setPasswordForm({ current: '', new: '', confirm: '' });
      setShowPasswords({ current: false, new: false, confirm: false });
      setProfileMessage(extra.passwordUpdated);
    } catch (error) {
      const code =
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        typeof error.code === 'string'
          ? error.code
          : '';
      setPasswordError(getFirebaseAuthError(code, language));
    } finally {
      setPasswordSaving(false);
    }
  };

  const renderInviteOnlyMeta = (church: ChurchSummary, iconSize: number) => (
    <div className="mt-1.5 space-y-1">
      <p className="text-[9px] font-black uppercase tracking-widest text-[#937022]">
        {extra.invitationRequired}
      </p>
      {church.contactEmail && (
        <p className="flex items-center gap-1 text-[9px] font-bold text-gray-400">
          <Mail size={iconSize} />
          {church.contactEmail}
        </p>
      )}
      {!church.contactEmail && church.phone && (
        <p className="flex items-center gap-1 text-[9px] font-bold text-gray-400">
          <Phone size={iconSize} />
          {church.phone}
        </p>
      )}
      {!church.contactEmail && !church.phone && (
        <p className="text-[9px] font-bold text-gray-400">
          {extra.askInvite}
        </p>
      )}
    </div>
  );

  return (
    <motion.div 
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      className="bg-white min-h-full pb-24 relative"
    >
      {/* Header */}
      <div className="px-8 pb-6 flex items-center gap-6 border-b border-gray-50 sticky top-0 bg-white z-10" style={{ paddingTop: 'calc(env(safe-area-inset-top) + 1.25rem)' }}>
        <button 
          onClick={onBack}
          className="w-10 h-10 flex items-center justify-center text-gray-900 hover:bg-gray-50 rounded-full transition-colors"
        >
          <ArrowLeft size={24} />
        </button>
        <h1 className="text-xl font-black text-gray-900 tracking-tight">{t.title}</h1>
      </div>

      <div className="p-8 lg:w-full lg:max-w-6xl lg:mx-auto lg:px-10 lg:pt-8 lg:grid lg:grid-cols-[280px_1fr] lg:gap-12 lg:items-start">
        {/* ── Left panel: avatar + churches ──────────────────────── */}
        <div>
          {/* Profile Image Section */}
          <div className="flex flex-col items-center mb-10">
            <div className="relative group">
              <div className="w-32 h-32 rounded-[48px] overflow-hidden border-4 border-white shadow-2xl shadow-black/10">
                <img
                  src={avatarUrl || `https://i.pravatar.cc/150?u=${user?.uid ?? 'default'}`}
                  alt={formData.fullName}
                  className="w-full h-full object-cover"
                  referrerPolicy="no-referrer"
                />
              </div>
              <input
                ref={avatarInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={(event) => void handleAvatarFileChange(event)}
              />
              <button
                type="button"
                onClick={() => avatarInputRef.current?.click()}
                disabled={avatarUploading}
                className="absolute -bottom-2 -right-2 w-10 h-10 bg-[#800000] text-white rounded-2xl flex items-center justify-center shadow-lg border-4 border-white hover:scale-110 transition-transform disabled:opacity-60 disabled:hover:scale-100"
                title={extra.uploadProfilePhoto}
              >
                {avatarUploading ? <Loader2 size={18} className="animate-spin" /> : <Camera size={18} />}
              </button>
            </div>
            <h2 className="mt-4 text-2xl font-black text-gray-900 tracking-tight">{formData.fullName}</h2>
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mt-1">{extra.kandiloParishioner}</p>
          </div>

          {/* Desktop-only: My Churches + Discover in left panel */}
          <div className="hidden lg:block space-y-6">
            {/* My Churches */}
            <div className="space-y-3">
              <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">{extra.myChurches}</label>
              {memberships.length === 0 && !churchesLoading && <p className="text-xs text-gray-400 font-medium pl-1">{extra.noMemberships}</p>}
              {memberships.map((m) => (
                <div key={m.churchId} className="flex items-center gap-3 bg-gray-50 rounded-2xl px-4 py-3">
                  <div className="w-9 h-9 rounded-xl overflow-hidden flex-shrink-0 bg-gray-200">
                    {m.imageURL ? <img src={m.imageURL} alt={m.churchName} className="w-full h-full object-cover" referrerPolicy="no-referrer" /> : <div className="w-full h-full flex items-center justify-center"><Church size={16} className="text-gray-400" /></div>}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-black text-gray-900 truncate">{m.churchName}</p>
                    <p className="text-[9px] font-bold text-gray-400 uppercase tracking-widest mt-0.5">{m.role}</p>
                  </div>
                  {confirmLeaveId === m.churchId ? (
                    <div className="flex gap-1">
                      <button onClick={() => handleLeave(m.churchId)} disabled={leavingId === m.churchId} className="text-[9px] font-black uppercase px-2 py-1 bg-red-500 text-white rounded-lg">{leavingId === m.churchId ? <Loader2 size={10} className="animate-spin" /> : extra.leave}</button>
                      <button onClick={() => setConfirmLeaveId(null)} className="text-[9px] font-black uppercase px-2 py-1 bg-gray-200 text-gray-600 rounded-lg">{extra.no}</button>
                    </div>
                  ) : (
                    <button onClick={() => setConfirmLeaveId(m.churchId)} className="w-7 h-7 flex items-center justify-center text-gray-300 hover:text-red-400 transition-colors rounded-lg hover:bg-red-50" title={extra.leaveChurch}><LeaveIcon size={14} /></button>
                  )}
                </div>
              ))}
            </div>

            {/* Discover Churches */}
            <div className="space-y-3">
              <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">{extra.discoverChurches}</label>
              <p className="text-xs text-gray-400 font-medium pl-1">{extra.membershipInviteOnly}</p>
              {churchesLoading && <div className="flex items-center gap-2 pl-1"><Loader2 size={12} className="animate-spin text-gray-300" /><span className="text-xs text-gray-400">{extra.loadingChurches}</span></div>}
              {!churchesLoading && churchesError && <p className="text-xs text-red-500 font-medium pl-1">{churchesError}</p>}
              {!churchesLoading && !churchesError && availableChurches.length === 0 && <p className="text-xs text-gray-400 font-medium pl-1">{noAvailableChurchesMessage}</p>}
              {availableChurches.map((church) => (
                <div key={church.id} className="flex items-center gap-3 border border-gray-100 rounded-2xl px-4 py-3 bg-white">
                  <div className="w-9 h-9 rounded-xl overflow-hidden flex-shrink-0 bg-gray-100">
                    {church.imageURL ? <img src={church.imageURL} alt={church.name} className="w-full h-full object-cover" referrerPolicy="no-referrer" /> : <div className="w-full h-full flex items-center justify-center"><Church size={16} className="text-gray-300" /></div>}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-black text-gray-900 truncate">{church.name}</p>
                    <p className="text-[9px] font-bold text-gray-400 flex items-center gap-1 mt-0.5"><MapPin size={9} />{church.location}</p>
                    {renderInviteOnlyMeta(church, 9)}
                  </div>
                  <span className="rounded-xl bg-amber-50 px-3 py-1.5 text-[9px] font-black uppercase tracking-widest text-amber-800">
                    {extra.inviteOnly}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ── Right panel: form fields + actions ─────────────────── */}
        <div className="space-y-6">
          <div className="space-y-2">
            <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">{t.fullName}</label>
            <input 
              type="text" 
              value={formData.fullName}
              onChange={(e) => setFormData({...formData, fullName: e.target.value})}
              className="w-full bg-gray-50 border-none rounded-2xl px-6 py-4 text-sm font-bold text-gray-900 focus:ring-2 focus:ring-[#800000]/20 transition-all"
            />
          </div>

          <div className="space-y-2">
            <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">{t.email}</label>
            <div className="relative">
              <Mail size={16} className="absolute left-6 top-1/2 -translate-y-1/2 text-gray-300" />
              <input 
                type="email" 
                value={formData.email}
                readOnly
                className="w-full bg-gray-50 border-none rounded-2xl pl-14 pr-6 py-4 text-sm font-bold text-gray-900 transition-all"
              />
            </div>
            <p className="text-[10px] font-bold text-gray-400 ml-1">{extra.emailManaged}</p>
          </div>

          <div className="space-y-2">
            <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">{t.cell}</label>
            <div className="relative">
              <Phone size={16} className="absolute left-6 top-1/2 -translate-y-1/2 text-gray-300" />
              <input 
                type="tel" 
                value={formData.cell}
                onChange={(e) => setFormData({...formData, cell: e.target.value})}
                className="w-full bg-gray-50 border-none rounded-2xl pl-14 pr-6 py-4 text-sm font-bold text-gray-900 focus:ring-2 focus:ring-[#800000]/20 transition-all"
              />
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">{t.preferredLanguage}</label>
            <div className="relative">
              <Globe size={16} className="absolute left-6 top-1/2 -translate-y-1/2 text-gray-300" />
              <select 
                value={formData.preferredLanguage}
                onChange={(e) =>
                  setFormData({ ...formData, preferredLanguage: e.target.value as Language })
                }
                className="w-full bg-gray-50 border-none rounded-2xl pl-14 pr-6 py-4 text-sm font-bold text-gray-900 focus:ring-2 focus:ring-[#800000]/20 transition-all appearance-none"
              >
                {LANGUAGES.map(lang => (
                  <option key={lang} value={lang}>{lang}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="space-y-4">
            <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">{t.ministriesInvolved}</label>
            <div className="flex flex-wrap gap-2">
              {Object.entries(t.ministryList).map(([key, value]) => (
                <button
                  key={key}
                  onClick={() => toggleMinistry(key)}
                  className={`px-4 py-2 rounded-xl text-[10px] font-bold transition-all ${
                    formData.ministries.includes(key)
                      ? 'bg-[#800000] text-white shadow-md'
                      : 'bg-gray-50 text-gray-500 border border-gray-100'
                  }`}
                >
                  {value}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">{t.spiritualBio}</label>
            <div className="relative">
              <FileText size={16} className="absolute left-6 top-6 text-gray-300" />
              <textarea 
                value={formData.description}
                onChange={(e) => setFormData({...formData, description: e.target.value})}
                rows={4}
                className="w-full bg-gray-50 border-none rounded-2xl pl-14 pr-6 py-4 text-sm font-bold text-gray-900 focus:ring-2 focus:ring-[#800000]/20 transition-all resize-none"
              />
            </div>
          </div>

          <button 
            onClick={() => setFormData({...formData, showInDirectory: !formData.showInDirectory})}
            className="w-full flex items-center gap-4 p-6 bg-gray-50 rounded-3xl group hover:bg-gray-100 transition-all"
          >
            <div className={`w-6 h-6 rounded-lg flex items-center justify-center transition-all ${formData.showInDirectory ? 'bg-[#800000] text-white' : 'bg-white border-2 border-gray-200'}`}>
              {formData.showInDirectory && <CheckCircle2 size={16} />}
            </div>
            <div className="flex-1 text-left">
              <h4 className="text-sm font-black text-gray-900 leading-tight">{t.showInDirectory}</h4>
              <p className="text-[10px] text-gray-400 font-bold mt-0.5">{t.showInDirectorySub}</p>
            </div>
          </button>

          {/* ── My Churches (mobile only — desktop shows in left panel) ── */}
          <div className="lg:hidden space-y-3">
            <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">
              {extra.myChurches}
            </label>

            {memberships.length === 0 && !churchesLoading && (
              <p className="text-xs text-gray-400 font-medium pl-1">
                {extra.noMembershipsYet}
              </p>
            )}

            {memberships.map((m) => (
              <div
                key={m.churchId}
                className="flex items-center gap-4 bg-gray-50 rounded-2xl px-5 py-4"
              >
                <div className="w-10 h-10 rounded-xl overflow-hidden flex-shrink-0 bg-gray-200">
                  {m.imageURL ? (
                    <img src={m.imageURL} alt={m.churchName} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <Church size={18} className="text-gray-400" />
                    </div>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-black text-gray-900 truncate">{m.churchName}</p>
                  <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mt-0.5">
                    {m.role} · {m.location}
                  </p>
                </div>
                {confirmLeaveId === m.churchId ? (
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleLeave(m.churchId)}
                      disabled={leavingId === m.churchId}
                      className="text-[9px] font-black uppercase tracking-widest px-3 py-1.5 bg-red-500 text-white rounded-xl"
                    >
                      {leavingId === m.churchId ? <Loader2 size={12} className="animate-spin" /> : extra.confirm}
                    </button>
                    <button
                      onClick={() => setConfirmLeaveId(null)}
                      className="text-[9px] font-black uppercase tracking-widest px-3 py-1.5 bg-gray-200 text-gray-600 rounded-xl"
                    >
                      {commonT.cancel}
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setConfirmLeaveId(m.churchId)}
                    className="w-8 h-8 flex items-center justify-center text-gray-300 hover:text-red-400 transition-colors rounded-xl hover:bg-red-50"
                    title={extra.leaveChurch}
                  >
                    <LeaveIcon size={16} />
                  </button>
                )}
              </div>
            ))}
          </div>

          {/* ── Discover Churches (mobile only — desktop shows in left panel) ── */}
          <div className="lg:hidden space-y-3">
            <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">
              {extra.discoverChurches}
            </label>
            <p className="text-xs text-gray-400 font-medium pl-1">
              {extra.membershipInviteOnly}
            </p>

            {churchesLoading && (
              <div className="flex items-center gap-2 pl-1">
                <Loader2 size={14} className="animate-spin text-gray-300" />
                <span className="text-xs text-gray-400">{extra.loadingChurches}</span>
              </div>
            )}

            {!churchesLoading && churchesError && (
              <p className="text-xs text-red-500 font-medium pl-1">
                {churchesError}
              </p>
            )}

            {!churchesLoading && !churchesError && availableChurches.length === 0 && (
              <p className="text-xs text-gray-400 font-medium pl-1">
                {noAvailableChurchesMessage}
              </p>
            )}

            {availableChurches.map((church) => (
              <div
                key={church.id}
                className="flex items-center gap-4 border border-gray-100 rounded-2xl px-5 py-4 bg-white"
              >
                <div className="w-10 h-10 rounded-xl overflow-hidden flex-shrink-0 bg-gray-100">
                  {church.imageURL ? (
                    <img src={church.imageURL} alt={church.name} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <Church size={18} className="text-gray-300" />
                    </div>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-black text-gray-900 truncate">{church.name}</p>
                  <p className="text-[10px] font-bold text-gray-400 flex items-center gap-1 mt-0.5">
                    <MapPin size={10} />
                    {church.location}
                  </p>
                  {renderInviteOnlyMeta(church, 10)}
                </div>
                <span className="rounded-xl bg-amber-50 px-3 py-1.5 text-[9px] font-black uppercase tracking-widest text-amber-800">
                  {extra.inviteOnly}
                </span>
              </div>
            ))}
          </div>

          <div className="pt-4 space-y-4">
            {profileMessage && (
              <p className={`text-sm font-bold ${
                [extra.profileUpdated, extra.profilePhotoUpdated, extra.passwordUpdated].includes(profileMessage)
                  ? 'text-emerald-600'
                  : 'text-red-500'
              }`}>
                {profileMessage}
              </p>
            )}

            {isSuperAdmin && onOpenMissionControl && (
              <button
                onClick={onOpenMissionControl}
                className="w-full py-5 bg-[#800000] text-white rounded-3xl font-black text-[10px] uppercase tracking-widest shadow-xl shadow-red-900/20 hover:bg-[#8D1212] transition-all active:scale-95 flex items-center justify-center gap-2"
              >
                <ShieldCheck size={16} />
                {extra.missionControl}
              </button>
            )}

            <button
              onClick={() => void handleSaveProfile()}
              disabled={profileSaving}
              className="w-full py-5 bg-gray-900 text-white rounded-3xl font-black text-[10px] uppercase tracking-widest hover:bg-[#800000] transition-all shadow-xl shadow-black/10 active:scale-95 disabled:opacity-60 flex items-center justify-center gap-2"
            >
              {profileSaving ? <Loader2 size={14} className="animate-spin" /> : null}
              {t.updateProfile}
            </button>
            
            <button 
              onClick={() => {
                if (!canChangePassword) {
                  setProfileMessage(extra.passwordEmailOnly);
                  return;
                }
                setPasswordError('');
                setShowPasswordModal(true);
              }}
              className="w-full py-5 bg-white text-gray-400 border border-gray-100 rounded-3xl font-black text-[10px] uppercase tracking-widest hover:text-[#800000] hover:border-[#800000]/20 transition-all active:scale-95 flex items-center justify-center gap-2 disabled:opacity-60"
            >
              <Lock size={14} />
              {t.changePassword}
            </button>

            <button
              onClick={signOut}
              className="w-full py-5 bg-white text-red-400 border border-red-100 rounded-3xl font-black text-[10px] uppercase tracking-widest hover:bg-red-50 transition-all active:scale-95 flex items-center justify-center gap-2"
            >
              <LogOut size={14} />
              {extra.signOut}
            </button>
          </div>
        </div>
        {/* end right panel */}
      </div>
      {/* end grid */}

      {/* Password Modal */}
      <AnimatePresence>
        {showPasswordModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-[100] bg-black/60 backdrop-blur-sm flex items-end justify-center"
          >
            <motion.div
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 200 }}
              className="w-full max-w-xl bg-white rounded-t-[48px] p-8 pb-12 shadow-2xl"
            >
              <div className="flex items-center justify-between mb-8">
                <h3 className="text-2xl font-black text-gray-900 tracking-tight">{t.changePassword}</h3>
                <button 
                  onClick={() => setShowPasswordModal(false)}
                  className="w-10 h-10 bg-gray-50 rounded-full flex items-center justify-center text-gray-400 hover:text-gray-900 transition-colors"
                >
                  <X size={20} />
                </button>
              </div>

              <div className="space-y-6">
                {passwordError && <p className="text-sm font-bold text-red-500">{passwordError}</p>}

                <div className="space-y-2">
                  <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">{t.currentPassword}</label>
                  <div className="relative">
                    <input 
                      type={showPasswords.current ? 'text' : 'password'}
                      value={passwordForm.current}
                      onChange={(e) => setPasswordForm({...passwordForm, current: e.target.value})}
                      className="w-full bg-gray-50 border-none rounded-2xl px-6 py-4 text-sm font-bold text-gray-900 focus:ring-2 focus:ring-[#800000]/20 transition-all"
                      placeholder="••••••••"
                    />
                    <button 
                      onClick={() => setShowPasswords({...showPasswords, current: !showPasswords.current})}
                      className="absolute right-6 top-1/2 -translate-y-1/2 text-gray-300 hover:text-gray-600 transition-colors"
                    >
                      {showPasswords.current ? <EyeOff size={18} /> : <Eye size={18} />}
                    </button>
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">{t.newPassword}</label>
                  <div className="relative">
                    <input 
                      type={showPasswords.new ? 'text' : 'password'}
                      value={passwordForm.new}
                      onChange={(e) => setPasswordForm({...passwordForm, new: e.target.value})}
                      className="w-full bg-gray-50 border-none rounded-2xl px-6 py-4 text-sm font-bold text-gray-900 focus:ring-2 focus:ring-[#800000]/20 transition-all"
                      placeholder="••••••••"
                    />
                    <button 
                      onClick={() => setShowPasswords({...showPasswords, new: !showPasswords.new})}
                      className="absolute right-6 top-1/2 -translate-y-1/2 text-gray-300 hover:text-gray-600 transition-colors"
                    >
                      {showPasswords.new ? <EyeOff size={18} /> : <Eye size={18} />}
                    </button>
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">{t.confirmNewPassword}</label>
                  <div className="relative">
                    <input 
                      type={showPasswords.confirm ? 'text' : 'password'}
                      value={passwordForm.confirm}
                      onChange={(e) => setPasswordForm({...passwordForm, confirm: e.target.value})}
                      className="w-full bg-gray-50 border-none rounded-2xl px-6 py-4 text-sm font-bold text-gray-900 focus:ring-2 focus:ring-[#800000]/20 transition-all"
                      placeholder="••••••••"
                    />
                    <button 
                      onClick={() => setShowPasswords({...showPasswords, confirm: !showPasswords.confirm})}
                      className="absolute right-6 top-1/2 -translate-y-1/2 text-gray-300 hover:text-gray-600 transition-colors"
                    >
                      {showPasswords.confirm ? <EyeOff size={18} /> : <Eye size={18} />}
                    </button>
                  </div>
                </div>

                <button 
                  onClick={() => void handlePasswordUpdate()}
                  disabled={passwordSaving}
                  className="w-full py-5 bg-[#800000] text-white rounded-3xl font-black text-[10px] uppercase tracking-widest shadow-xl shadow-red-900/20 hover:bg-[#8D1212] transition-all active:scale-95 mt-4 disabled:opacity-60 flex items-center justify-center gap-2"
                >
                  {passwordSaving ? <Loader2 size={14} className="animate-spin" /> : null}
                  {t.updatePassword}
                </button>

                <button
                  onClick={() => {
                    setShowPasswordModal(false);
                    setPasswordError('');
                  }}
                  className="w-full py-4 bg-gray-100 text-gray-600 rounded-3xl font-black text-[10px] uppercase tracking-widest hover:bg-gray-200 transition-all"
                >
                  {commonT.cancel}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
