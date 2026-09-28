import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { User as FirebaseUser } from 'firebase/auth';
import { Loader2, Mail } from 'lucide-react';
import { firebaseAuthErrorCode, sendAccountEmailVerification } from '../../lib/auth';
import {
  getEmailVerificationSendState,
  markEmailVerificationEmailSent,
} from '../../lib/emailVerificationThrottle';
import { getExtraCopy } from '../../localization/extra';
import type { Language } from '../../types';

interface EmailVerificationBannerProps {
  user: FirebaseUser;
  language: Language;
}

function formatRemainingTime(ms: number) {
  const totalSeconds = Math.max(1, Math.ceil(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  if (minutes >= 1) {
    return `${minutes}m`;
  }

  return `${seconds}s`;
}

export default function EmailVerificationBanner({
  user,
  language,
}: EmailVerificationBannerProps) {
  const t = getExtraCopy(language).auth;
  const autoSendKey = useRef<string | null>(null);
  const [sending, setSending] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [message, setMessage] = useState('');
  const [now, setNow] = useState(() => Date.now());
  const sendState = useMemo(
    () => getEmailVerificationSendState(user.uid, now),
    [now, user.uid]
  );

  useEffect(() => {
    if (sendState.canSend) {
      return undefined;
    }

    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [sendState.canSend]);

  const refreshVerificationState = useCallback(async () => {
    try {
      await user.reload();
      if (user.emailVerified === true) {
        await user.getIdToken(true);
        setHidden(true);
      }
    } catch {
      // Keep the banner visible; failed refreshes should not interrupt app usage.
    }
  }, [user]);

  useEffect(() => {
    const handleFocus = () => {
      void refreshVerificationState();
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void refreshVerificationState();
      }
    };

    window.addEventListener('focus', handleFocus);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [refreshVerificationState]);

  const sendVerification = useCallback(async (mode: 'auto' | 'manual') => {
    const latestSendState = getEmailVerificationSendState(user.uid);
    setNow(Date.now());
    if (!latestSendState.canSend) {
      setMessage(t.emailVerificationRateLimited);
      return;
    }

    setSending(true);
    setMessage('');
    try {
      const result = await sendAccountEmailVerification(user);
      await user.reload().catch(() => undefined);
      if (result.alreadyVerified || user.emailVerified === true) {
        await user.getIdToken(true);
        setHidden(true);
        return;
      }

      markEmailVerificationEmailSent(user.uid);
      setNow(Date.now());
      setMessage(
        mode === 'auto'
          ? t.emailVerificationBannerAutoSent
          : t.emailVerificationSent
      );
    } catch (error) {
      if (firebaseAuthErrorCode(error) === 'auth/too-many-requests') {
        console.warn('Email verification send rate-limited:', error);
        setMessage(t.emailVerificationRateLimited);
      } else {
        console.error('Failed to send account email verification:', error);
        setMessage(t.emailVerificationSendFailed);
      }
    } finally {
      setSending(false);
    }
  }, [
    t.emailVerificationBannerAutoSent,
    t.emailVerificationRateLimited,
    t.emailVerificationSendFailed,
    t.emailVerificationSent,
    user,
  ]);

  useEffect(() => {
    if (hidden || user.isAnonymous || user.emailVerified === true) {
      return;
    }

    if (autoSendKey.current === user.uid || !sendState.canSend) {
      return;
    }

    autoSendKey.current = user.uid;
    void sendVerification('auto');
  }, [hidden, sendState.canSend, sendVerification, user.emailVerified, user.isAnonymous, user.uid]);

  if (hidden || user.isAnonymous || user.emailVerified === true) {
    return null;
  }

  const resendLabel = sendState.canSend
    ? t.emailVerificationBannerSendAgain
    : `${t.emailVerificationBannerSendAgain} in ${formatRemainingTime(sendState.remainingMs)}`;

  return (
    <div className="z-30 border-b border-amber-200 bg-amber-50 px-4 py-3 text-amber-950 shadow-sm">
      <div className="mx-auto flex max-w-5xl items-center gap-3">
        <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-white text-[#800000] shadow-sm">
          <Mail size={18} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-black uppercase tracking-widest">
            {t.emailVerificationBannerTitle}
          </p>
          <p className="mt-0.5 text-xs font-semibold leading-snug text-amber-900">
            {message || t.emailVerificationBannerBody}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void sendVerification('manual')}
          disabled={sending || !sendState.canSend}
          className="flex h-9 flex-shrink-0 items-center justify-center gap-2 rounded-xl bg-gray-900 px-3 text-[10px] font-black uppercase tracking-widest text-white transition-colors hover:bg-[#800000] disabled:cursor-not-allowed disabled:bg-amber-200 disabled:text-amber-900"
        >
          {sending ? <Loader2 size={14} className="animate-spin" /> : <Mail size={14} />}
          <span className="hidden sm:inline">{sending ? t.emailVerificationSending : resendLabel}</span>
          <span className="sm:hidden">{sending ? t.emailVerificationSending : t.emailVerificationBannerSendAgain}</span>
        </button>
      </div>
    </div>
  );
}
