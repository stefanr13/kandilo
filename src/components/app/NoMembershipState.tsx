import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Building, CheckCircle2, Loader2, X, ChevronDown, Check } from 'lucide-react';
import type { Language } from '../../types';
import { getExtraCopy } from '../../localization/extra';
import { joinChurch } from '../../lib/api/churches';
import { listAllChurches } from '../../lib/db/churches';
import type { ChurchSummary } from '../../domain/church';

interface NoMembershipStateProps {
  language: Language;
  canJoin?: boolean;
}

const MAX_VISIBLE_CHURCHES = 3;

export default function NoMembershipState({ language, canJoin = false }: NoMembershipStateProps) {
  const copy = getExtraCopy(language);
  const t = copy.noMembership;
  const profileCopy = copy.profile;
  const [selectorOpen, setSelectorOpen] = useState(false);
  const [churches, setChurches] = useState<ChurchSummary[]>([]);
  const [loadingChurches, setLoadingChurches] = useState(false);
  const [churchesError, setChurchesError] = useState('');
  const [selectedChurchIds, setSelectedChurchIds] = useState<Array<string | null>>([]);
  const [joiningId, setJoiningId] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [additionalDropdownOpen, setAdditionalDropdownOpen] = useState(false);

  const sortedChurches = useMemo(() => [...churches].sort((a, b) => a.name.localeCompare(b.name)), [churches]);
  const primaryVisibleChurches = sortedChurches.slice(0, MAX_VISIBLE_CHURCHES);
  const selectedChurches = useMemo(
    () => selectedChurchIds
      .filter((churchId): churchId is string => Boolean(churchId))
      .map((churchId) => sortedChurches.find((church) => church.id === churchId))
      .filter((church): church is ChurchSummary => Boolean(church)),
    [selectedChurchIds, sortedChurches]
  );
  const primarySelectedChurch =
    sortedChurches.find((church) => church.id === selectedChurchIds[0]) ?? sortedChurches[0] ?? null;

  const availableAdditionalChurches = useMemo(() => {
    return sortedChurches.filter((church) => church.id !== primarySelectedChurch?.id);
  }, [sortedChurches, primarySelectedChurch]);

  const additionalSelectedChurches = useMemo(() => {
    return selectedChurchIds
      .slice(1)
      .filter((churchId): churchId is string => Boolean(churchId) && churchId !== primarySelectedChurch?.id)
      .map((churchId) => sortedChurches.find((c) => c.id === churchId))
      .filter((church): church is ChurchSummary => Boolean(church));
  }, [selectedChurchIds, primarySelectedChurch, sortedChurches]);

  const toggleAdditionalChurch = (churchId: string) => {
    setSelectedChurchIds((current) => {
      const primaryId = current[0];
      const currentAdditionals = current.slice(1).filter((id): id is string => Boolean(id) && id !== primaryId);

      if (currentAdditionals.includes(churchId)) {
        const nextAdditionals = currentAdditionals.filter(id => id !== churchId);
        return [primaryId, ...nextAdditionals];
      } else {
        if (currentAdditionals.length >= 2) {
          return current; // Limit of 3 total reached
        }
        return [primaryId, ...currentAdditionals, churchId];
      }
    });
  };

  useEffect(() => {
    if (!selectorOpen || churches.length > 0 || loadingChurches || churchesError) {
      return;
    }

    setLoadingChurches(true);
    setChurchesError('');
    void listAllChurches()
      .then((results) => {
        setChurches(results);
        setSelectedChurchIds(results[0]?.id ? [results[0].id] : []);
      })
      .catch((error) => {
        console.error('Failed to load churches:', error);
        setChurchesError(profileCopy.unableLoadChurches);
      })
      .finally(() => setLoadingChurches(false));
  }, [churches.length, churchesError, loadingChurches, profileCopy.unableLoadChurches, selectorOpen]);

  const selectChurchAt = (slotIndex: number, churchId: string | null) => {
    setSelectedChurchIds((current) => {
      const next = [...current];
      while (next.length <= slotIndex) {
        next.push(null);
      }
      const normalizedChurchId = churchId || null;
      for (let index = 0; index < next.length; index += 1) {
        if (index !== slotIndex && next[index] === normalizedChurchId) {
          next[index] = null;
        }
      }
      next[slotIndex] = normalizedChurchId;
      return next;
    });
  };

  const handleJoinSelectedChurches = async () => {
    if (!canJoin || selectedChurches.length === 0) {
      return;
    }

    setJoiningId('selected-churches');
    setMessage('');
    try {
      for (const church of selectedChurches) {
        await joinChurch(church.id);
      }
      setMessage(selectedChurches.length > 1 ? `${selectedChurches.length} churches joined.` : profileCopy.joinedChurch);
      setSelectorOpen(false);
    } catch (error) {
      console.error('Failed to join church:', error);
      const code =
        typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
          ? error.code
          : '';
      setMessage(code === 'functions/resource-exhausted'
        ? profileCopy.churchLimitReached
        : profileCopy.unableJoinChurch);
    } finally {
      setJoiningId(null);
    }
  };

  return (
    <>
      {!canJoin && <p className="px-6 pt-6 text-center text-sm text-amber-900">{copy.giving.emailVerificationRequiredAction}</p>}
      <div className="flex h-full items-center justify-center p-8">
        <div className="max-w-md rounded-[32px] bg-white p-8 text-center shadow-xl shadow-black/5">
          <p className="mb-2 text-[10px] font-black uppercase tracking-[0.25em] text-[#937022]">
            {t.label}
          </p>
          <h2 className="mb-3 text-3xl font-black tracking-tight text-gray-900">
            {t.title}
          </h2>
          <p className="text-sm leading-relaxed text-gray-500">
            {t.body}
          </p>
          {message && (
            <p className={`mt-5 text-xs font-bold ${message === profileCopy.joinedChurch ? 'text-emerald-600' : 'text-red-500'}`}>
              {message}
            </p>
          )}
          <button
            onClick={() => {
              setChurchesError('');
              setSelectorOpen(true);
            }}
            className="mt-6 rounded-2xl bg-gray-900 px-5 py-3 text-[10px] font-black uppercase tracking-widest text-white transition-colors hover:bg-[#800000]"
          >
            {t.openProfile}
          </button>
        </div>
      </div>

      <AnimatePresence>
        {selectorOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[120] flex items-end justify-center bg-black/60 px-4 backdrop-blur-sm sm:items-center"
          >
            <motion.div
              initial={{ y: 32, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 32, opacity: 0 }}
              transition={{ type: 'spring', damping: 26, stiffness: 220 }}
              className="w-full max-w-md rounded-t-[36px] bg-white p-6 pb-8 shadow-2xl sm:rounded-[36px] sm:p-8"
            >
              <div className="mb-6 flex items-start justify-between gap-4">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-[0.25em] text-[#937022]">
                    {t.label}
                  </p>
                  <h3 className="mt-2 text-2xl font-black tracking-tight text-gray-900">
                    {t.churchSelectorTitle}
                  </h3>
                </div>
                <button
                  onClick={() => setSelectorOpen(false)}
                  className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-gray-50 text-gray-400 transition-colors hover:text-gray-900"
                  aria-label="Close church selector"
                >
                  <X size={20} />
                </button>
              </div>

              {loadingChurches && (
                <div className="flex items-center gap-2 rounded-2xl bg-gray-50 px-4 py-4 text-xs font-bold text-gray-500">
                  <Loader2 size={14} className="animate-spin" />
                  {profileCopy.loadingChurches}
                </div>
              )}

              {!loadingChurches && churchesError && (
                <p className="rounded-2xl bg-red-50 px-4 py-4 text-xs font-bold text-red-600">
                  {churchesError}
                </p>
              )}

              {!loadingChurches && !churchesError && churches.length === 0 && (
                <p className="rounded-2xl bg-gray-50 px-4 py-4 text-xs font-bold text-gray-500">
                  {profileCopy.noPublicChurches}
                </p>
              )}

              {!loadingChurches && !churchesError && primaryVisibleChurches.length > 0 && (
                <div className="space-y-4">
                  <div className="space-y-3">
                    {primaryVisibleChurches.map((church) => (
                      <button
                        key={church.id}
                        onClick={() => selectChurchAt(0, church.id)}
                        className={`w-full rounded-3xl border bg-white p-4 text-left transition-all ${
                          primarySelectedChurch?.id === church.id
                            ? 'border-[#800000]/30 bg-[#800000]/5'
                            : 'border-gray-100 hover:bg-gray-50'
                        }`}
                      >
                        <div className="flex items-center gap-4">
                          <div className="h-11 w-11 flex-shrink-0 overflow-hidden rounded-2xl bg-gray-100">
                            {church.imageURL ? (
                              <img src={church.imageURL} alt="" className="h-full w-full object-cover" referrerPolicy="no-referrer" />
                            ) : (
                              <div className="flex h-full w-full items-center justify-center text-gray-300">
                                <Building size={18} />
                              </div>
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-black text-gray-900">{church.name}</p>
                            <p className="truncate text-xs font-bold uppercase tracking-widest text-gray-400">{church.location}</p>
                          </div>
                          {primarySelectedChurch?.id === church.id && (
                            <span className="text-[#800000]">
                              <CheckCircle2 size={18} />
                            </span>
                          )}
                        </div>
                      </button>
                    ))}
                  </div>

                  {/* More churches select box (Keep this in case they want to change primary church to one not in the top 3 visible ones) */}
                  {sortedChurches.length > primaryVisibleChurches.length && (
                    <div className="rounded-2xl border border-gray-100 bg-gray-50 p-3">
                      <label className="block text-[10px] font-black uppercase tracking-widest text-gray-400">
                        {profileCopy.discoverChurches || 'More churches'}
                      </label>
                      <select
                        value={
                          primaryVisibleChurches.some((church) => church.id === primarySelectedChurch?.id)
                            ? ''
                            : primarySelectedChurch?.id ?? ''
                        }
                        onChange={(event) => {
                          if (event.target.value) {
                            selectChurchAt(0, event.target.value);
                          }
                        }}
                        className="mt-2 w-full rounded-xl border border-gray-200 bg-white px-3 py-3 text-sm font-bold text-gray-900 outline-none transition-colors focus:border-[#800000]/40"
                        aria-label="More churches"
                      >
                        <option value="">Choose another listed church</option>
                        {sortedChurches.slice(MAX_VISIBLE_CHURCHES).map((church) => (
                          <option key={church.id} value={church.id}>
                            {church.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  {/* Modern Multi-Select Dropdown for Additional Parishes */}
                  {availableAdditionalChurches.length > 0 && (
                    <div className="space-y-2.5 relative">
                      <label className="block text-[10px] font-black uppercase tracking-widest text-gray-400 ml-1">
                        Subscribe to additional parishes (Select up to 2)
                      </label>

                      <div className="relative">
                        <button
                          type="button"
                          onClick={() => setAdditionalDropdownOpen(!additionalDropdownOpen)}
                          className={`w-full flex items-center justify-between rounded-2xl border px-4 py-3.5 text-sm font-black transition-all text-left bg-white ${
                            additionalDropdownOpen
                              ? 'border-[#800000] shadow-sm'
                              : 'border-gray-100 hover:border-gray-200 shadow-xs'
                          }`}
                        >
                          <span className={additionalSelectedChurches.length > 0 ? 'text-gray-900' : 'text-gray-400'}>
                            {additionalSelectedChurches.length === 0
                              ? 'Choose additional parishes'
                              : additionalSelectedChurches.length === 1
                              ? '1 additional parish selected'
                              : '2 additional parishes selected'}
                          </span>
                          <ChevronDown
                            size={16}
                            className={`text-gray-400 transition-transform duration-300 ${
                              additionalDropdownOpen ? 'rotate-180 text-[#800000]' : ''
                            }`}
                          />
                        </button>

                        <AnimatePresence>
                          {additionalDropdownOpen && (
                            <>
                              {/* Invisible backdrop to close the dropdown when clicking outside */}
                              <div
                                className="fixed inset-0 z-10"
                                onClick={() => setAdditionalDropdownOpen(false)}
                              />

                              <motion.div
                                initial={{ opacity: 0, y: -8 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, y: -8 }}
                                transition={{ duration: 0.15 }}
                                className="absolute left-0 right-0 mt-2 max-h-60 overflow-y-auto rounded-2xl border border-gray-100 bg-white p-2 shadow-xl z-20 space-y-1 scrollbar-hide"
                              >
                                {availableAdditionalChurches.map((church) => {
                                  const isSelected = additionalSelectedChurches.some((c) => c.id === church.id);
                                  const isAtLimit = additionalSelectedChurches.length >= 2;
                                  const isDisabled = isAtLimit && !isSelected;

                                  return (
                                    <button
                                      key={church.id}
                                      type="button"
                                      disabled={isDisabled}
                                      onClick={() => toggleAdditionalChurch(church.id)}
                                      className={`w-full flex items-center justify-between px-3.5 py-3 rounded-xl transition-all text-left ${
                                        isSelected
                                          ? 'bg-[#800000]/5 text-[#800000]'
                                          : isDisabled
                                          ? 'opacity-40 cursor-not-allowed'
                                          : 'hover:bg-gray-50 text-gray-700'
                                      }`}
                                    >
                                      <div className="flex items-center gap-3 min-w-0">
                                        <div className="h-8 w-8 flex-shrink-0 overflow-hidden rounded-lg bg-gray-100">
                                          {church.imageURL ? (
                                            <img src={church.imageURL} alt="" className="h-full w-full object-cover" referrerPolicy="no-referrer" />
                                          ) : (
                                            <div className="flex h-full w-full items-center justify-center text-gray-300">
                                              <Building size={14} />
                                            </div>
                                          )}
                                        </div>
                                        <div className="min-w-0">
                                          <p className="truncate text-xs font-black">{church.name}</p>
                                          <p className="truncate text-[10px] font-bold uppercase tracking-wider text-gray-400">{church.location}</p>
                                        </div>
                                      </div>
                                      {isSelected && (
                                        <Check size={16} className="text-[#800000] flex-shrink-0" />
                                      )}
                                    </button>
                                  );
                                })}

                                {additionalSelectedChurches.length >= 2 && (
                                  <div className="px-3.5 py-2 border-t border-gray-50 mt-1">
                                    <p className="text-[9px] font-black text-gray-400 uppercase tracking-wider">
                                      Maximum of 3 total parishes reached
                                    </p>
                                  </div>
                                )}
                              </motion.div>
                            </>
                          )}
                        </AnimatePresence>
                      </div>

                      {/* Display Selected Additional Parishes as Premium Interactive Chips */}
                      {additionalSelectedChurches.length > 0 && (
                        <div className="flex flex-wrap gap-2 pt-1">
                          {additionalSelectedChurches.map((church) => (
                            <div
                              key={church.id}
                              className="flex items-center gap-1.5 rounded-full bg-[#800000]/5 px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-[#800000] border border-[#800000]/10"
                            >
                              <span>{church.name}</span>
                              <button
                                type="button"
                                onClick={() => toggleAdditionalChurch(church.id)}
                                className="hover:bg-[#800000]/10 p-0.5 rounded-full transition-colors"
                                title="Remove parish"
                              >
                                <X size={10} strokeWidth={2.5} />
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {selectedChurches.length > 1 && (
                <div className="mt-4 flex flex-wrap gap-2">
                  {selectedChurches.map((church) => (
                    <span key={church.id} className="rounded-full bg-[#800000]/5 px-3 py-1 text-[10px] font-black uppercase tracking-widest text-[#800000]">
                      {church.name}
                    </span>
                  ))}
                </div>
              )}

              <button
                onClick={() => void handleJoinSelectedChurches()}
                disabled={selectedChurches.length === 0 || Boolean(joiningId)}
                className="mt-8 flex w-full items-center justify-center gap-2 rounded-2xl bg-[#800000] py-3 text-sm font-black uppercase tracking-[0.16em] text-white transition-colors hover:bg-[#6a0000] disabled:cursor-not-allowed disabled:bg-gray-300"
              >
                {joiningId ? <Loader2 size={16} className="animate-spin" /> : null}
                {joiningId ? profileCopy.joiningChurch : selectedChurches.length > 1 ? 'Select Churches' : t.openProfile}
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
