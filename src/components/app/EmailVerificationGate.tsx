import { useState } from 'react';
import type { User as FirebaseUser } from 'firebase/auth';
import { CheckCircle2, Loader2, LogOut, Mail } from 'lucide-react';
import { signOut } from '../../lib/auth';
import { sendEmailVerificationEmail } from '../../lib/api/auth';
import { getExtraCopy } from '../../localization/extra';
import type { Language } from '../../types';

interface EmailVerificationGateProps {
  user: FirebaseUser;
  language: Language;
  onVerified: () => void;
}

export default function EmailVerificationGate({
  user,
  language,
  onVerified,
}: EmailVerificationGateProps) {
  const t = getExtraCopy(language).auth;
  const [sending, setSending] = useState(false);
  const [checking, setChecking] = useState(false);
  const [message, setMessage] = useState('');

  const confirmIfVerified = (verified: boolean) => {
    if (!verified) {
      setMessage(t.emailVerificationStillPending);
      return;
    }

    setMessage(t.emailVerificationConfirmed);
    onVerified();
  };

  const handleSendVerification = async () => {
    setSending(true);
    setMessage('');
    try {
      const result = await sendEmailVerificationEmail();
      await user.reload().catch(() => undefined);
      if (result.alreadyVerified || user.emailVerified === true) {
        confirmIfVerified(true);
      } else {
        setMessage(t.emailVerificationSent);
      }
    } catch (error) {
      console.error('Failed to send account email verification:', error);
      setMessage(t.emailVerificationSendFailed);
    } finally {
      setSending(false);
    }
  };

  const handleCheckVerification = async () => {
    setChecking(true);
    setMessage('');
    try {
      await user.reload();
      confirmIfVerified(user.emailVerified === true);
    } catch (error) {
      console.error('Failed to refresh account email verification state:', error);
      setMessage(t.emailVerificationCheckFailed);
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#F7F4EF] px-6 py-10">
      <div className="w-full max-w-md rounded-[32px] border border-gray-100 bg-white p-8 shadow-2xl shadow-black/10">
        <div className="mb-6 flex h-14 w-14 items-center justify-center rounded-2xl bg-[#800000]/10 text-[#800000]">
          <Mail size={26} />
        </div>

        <p className="mb-2 text-[10px] font-black uppercase tracking-[0.25em] text-[#937022]">
          Kandilo
        </p>
        <h1 className="text-3xl font-black tracking-tight text-gray-900">
          {t.emailVerificationTitle}
        </h1>
        <p className="mt-4 text-sm font-medium leading-relaxed text-gray-500">
          {t.emailVerificationBody}
        </p>

        <div className="mt-6 rounded-2xl bg-gray-50 p-4">
          <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">
            {t.emailVerificationEmailLabel}
          </p>
          <p className="mt-1 break-all text-sm font-black text-gray-900">
            {user.email}
          </p>
        </div>

        {message && (
          <p className="mt-4 rounded-2xl bg-amber-50 p-4 text-xs font-bold leading-relaxed text-amber-700">
            {message}
          </p>
        )}

        <div className="mt-8 grid gap-3">
          <button
            type="button"
            onClick={() => void handleSendVerification()}
            disabled={sending || checking}
            className="flex h-12 items-center justify-center gap-2 rounded-2xl bg-gray-900 px-5 text-[10px] font-black uppercase tracking-widest text-white transition-colors hover:bg-[#800000] disabled:opacity-50"
          >
            {sending ? <Loader2 size={15} className="animate-spin" /> : <Mail size={15} />}
            {sending ? t.emailVerificationSending : t.emailVerificationSend}
          </button>
          <button
            type="button"
            onClick={() => void handleCheckVerification()}
            disabled={sending || checking}
            className="flex h-12 items-center justify-center gap-2 rounded-2xl border border-amber-200 bg-white px-5 text-[10px] font-black uppercase tracking-widest text-amber-800 transition-colors hover:border-amber-300 hover:bg-amber-50 disabled:opacity-50"
          >
            {checking ? <Loader2 size={15} className="animate-spin" /> : <CheckCircle2 size={15} />}
            {checking ? t.emailVerificationChecking : t.emailVerificationCheck}
          </button>
          <button
            type="button"
            onClick={() => void signOut()}
            className="flex h-12 items-center justify-center gap-2 rounded-2xl bg-gray-50 px-5 text-[10px] font-black uppercase tracking-widest text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900"
          >
            <LogOut size={15} />
            {t.emailVerificationSignOut}
          </button>
        </div>
      </div>
    </div>
  );
}
