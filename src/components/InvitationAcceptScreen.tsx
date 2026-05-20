import { useEffect, useRef, useState } from 'react';
import type { User as FirebaseUser } from 'firebase/auth';
import { CheckCircle2, Loader2, LogOut, TriangleAlert } from 'lucide-react';
import { signOut } from '../lib/auth';
import { acceptInvitation } from '../lib/api/invitations';
import type { Language } from '../types';
import { getExtraCopy } from '../localization/extra';

interface InvitationAcceptScreenProps {
  invitationId: string;
  user: FirebaseUser;
  language: Language;
  onContinue: () => void;
}

type AcceptState = 'loading' | 'success' | 'error' | 'needs-account';

function toUserMessage(error: unknown, fallback: string): string {
  console.warn('Invitation accept failed:', error);
  return fallback;
}

export default function InvitationAcceptScreen({
  invitationId,
  user,
  language,
  onContinue,
}: InvitationAcceptScreenProps) {
  const t = getExtraCopy(language).invitation;
  const [state, setState] = useState<AcceptState>('loading');
  const [message, setMessage] = useState(t.accepting);
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    if (user.isAnonymous) {
      setState('needs-account');
      setMessage(t.guestCannotAccept);
      return;
    }

    const accept = async () => {
      try {
        const result = await acceptInvitation(invitationId);
        setState('success');
        setMessage(
          result.alreadyMember
            ? t.alreadyMember
            : t.accepted
        );
      } catch (error) {
        setState('error');
        setMessage(toUserMessage(error, t.unableAccept));
      }
    };

    void accept();
  }, [invitationId, t, user]);

  const icon =
    state === 'loading' ? (
      <Loader2 size={28} className="animate-spin text-[#800000]" />
    ) : state === 'success' ? (
      <CheckCircle2 size={28} className="text-green-600" />
    ) : (
      <TriangleAlert size={28} className="text-amber-600" />
    );

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-6">
      <div className="w-full max-w-md bg-white rounded-[32px] shadow-2xl shadow-black/10 border border-gray-100 p-8">
        <div className="w-14 h-14 rounded-2xl bg-gray-50 flex items-center justify-center mb-6">
          {icon}
        </div>

        <p className="text-[10px] font-black text-[#937022] uppercase tracking-[0.25em] mb-2">
          {t.label}
        </p>
        <h1 className="text-3xl font-black text-gray-900 tracking-tight mb-4">
          {state === 'success' ? t.acceptedTitle : t.checkingTitle}
        </h1>
        <p className="text-sm text-gray-500 leading-relaxed">{message}</p>

        <div className="mt-8 flex gap-3">
          {state === 'needs-account' ? (
            <button
              onClick={() => void signOut()}
              className="w-full flex items-center justify-center gap-2 rounded-2xl bg-gray-900 px-5 py-4 text-[10px] font-black uppercase tracking-widest text-white transition-colors hover:bg-[#800000]"
            >
              <LogOut size={14} />
              {t.signOut}
            </button>
          ) : (
            <button
              onClick={onContinue}
              className="w-full rounded-2xl bg-gray-900 px-5 py-4 text-[10px] font-black uppercase tracking-widest text-white transition-colors hover:bg-[#800000]"
            >
              {t.continue}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
