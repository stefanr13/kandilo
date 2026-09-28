import { useMemo, useState } from 'react';
import { Building, CheckCircle2, PlusCircle } from 'lucide-react';
import { Church, Language } from '../../types';
import { TRANSLATIONS } from '../../translations';

interface ChurchSelectionScreenProps {
  churches: Church[];
  language: Language;
  onSelect: (church: Church) => void;
}

const MAX_VISIBLE_CHURCHES = 3;

export default function ChurchSelectionScreen({
  churches,
  language,
  onSelect,
}: ChurchSelectionScreenProps) {
  const [selectedChurchId, setSelectedChurchId] = useState(churches[0]?.id ?? null);
  const [showAllChurches, setShowAllChurches] = useState(false);
  const t = TRANSLATIONS[language].common;
  const sortedChurches = useMemo(() => [...churches].sort((a, b) => a.name.localeCompare(b.name)), [churches]);
  const visibleChurches = showAllChurches ? sortedChurches : sortedChurches.slice(0, MAX_VISIBLE_CHURCHES);

  const selectedChurch = churches.find((church) => church.id === selectedChurchId) ?? sortedChurches[0];

  return (
    <div className="min-h-screen bg-[#F7F4EF] p-6">
      <div className="mx-auto max-w-md pt-12">
        <h1 className="text-2xl font-black tracking-tight text-gray-900">{t.selectParish}</h1>
        <p className="mt-3 text-sm text-gray-500">
          Choose a parish to open your home screen.
        </p>

        <div className="mt-8 space-y-3">
          {visibleChurches.map((church) => (
            <button
              key={church.id}
              onClick={() => setSelectedChurchId(church.id)}
              className={`w-full rounded-3xl border bg-white p-4 text-left transition-all ${
                selectedChurchId === church.id
                  ? 'border-[#800000]/30 bg-[#800000]/5'
                  : 'border-transparent hover:bg-white/80'
              }`}
            >
              <div className="flex items-center gap-4">
                <div className="h-11 w-11 flex-shrink-0 overflow-hidden rounded-2xl bg-gray-100">
                  {church.image ? (
                    <img src={church.image} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-gray-300">
                      <Building size={18} />
                    </div>
                  )}
                </div>
                <div className="min-w-0">
                  <p className="truncate text-sm font-black text-gray-900">{church.name}</p>
                  <p className="truncate text-xs font-bold uppercase tracking-widest text-gray-400">{church.location}</p>
                </div>
                {selectedChurchId === church.id && (
                  <span className="ml-auto text-[#800000]">
                    <CheckCircle2 size={18} />
                  </span>
                )}
              </div>
            </button>
          ))}
        </div>

        {churches.length > MAX_VISIBLE_CHURCHES && !showAllChurches && (
          <button
            onClick={() => setShowAllChurches(true)}
            className="mt-4 flex items-center gap-2 text-xs font-black uppercase tracking-widest text-gray-700 underline underline-offset-4"
          >
            <PlusCircle size={14} />
            Add additional churches
          </button>
        )}

        <button
          onClick={() => {
            if (selectedChurch) {
              onSelect(selectedChurch);
            }
          }}
          className="mt-8 w-full rounded-2xl bg-[#800000] py-3 text-sm font-black uppercase tracking-[0.16em] text-white transition-colors hover:bg-[#6a0000] disabled:cursor-not-allowed disabled:bg-gray-300"
          disabled={!selectedChurch}
        >
          Continue
        </button>
      </div>
    </div>
  );
}
