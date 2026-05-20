import { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { Loader2, X } from 'lucide-react';
import type { FirestoreEvent } from '../../lib/db/events';
import type { Language } from '../../types';

interface EventFormValues {
  title: string;
  description: string;
  location: string;
  category: string;
  startAt: string;
  endAt: string;
}

interface ManagementEventSheetProps {
  event: FirestoreEvent | null;
  isOpen: boolean;
  saving: boolean;
  error: string;
  onClose: () => void;
  onSubmit: (values: EventFormValues) => boolean;
  language?: Language;
}

const SHEET_T: Record<Language, {
  liturgicalLife: string; editEvent: string; addEvent: string;
  title: string; start: string; end: string; category: string;
  location: string; description: string; cancel: string;
  saveChanges: string; createEvent: string; endBeforeStart: string;
}> = {
  English: { liturgicalLife: 'Liturgical Life', editEvent: 'Edit Event.', addEvent: 'Add Event.', title: 'Title', start: 'Start', end: 'End', category: 'Category', location: 'Location', description: 'Description', cancel: 'Cancel', saveChanges: 'Save Changes', createEvent: 'Create Event', endBeforeStart: 'End time must be after start time' },
  'Srpski (Latinica)': { liturgicalLife: 'Bogoslužbeni život', editEvent: 'Izmeni događaj.', addEvent: 'Dodaj događaj.', title: 'Naslov', start: 'Početak', end: 'Kraj', category: 'Kategorija', location: 'Lokacija', description: 'Opis', cancel: 'Otkaži', saveChanges: 'Sačuvaj izmene', createEvent: 'Kreiraj događaj', endBeforeStart: 'Vreme završetka mora biti posle početka' },
  'Srpski (Ćirilica)': { liturgicalLife: 'Богослужбени живот', editEvent: 'Измени догађај.', addEvent: 'Додај догађај.', title: 'Наслов', start: 'Почетак', end: 'Крај', category: 'Категорија', location: 'Локација', description: 'Опис', cancel: 'Откажи', saveChanges: 'Сачувај измене', createEvent: 'Креирај догађај', endBeforeStart: 'Време завршетка мора бити после почетка' },
  Русский: { liturgicalLife: 'Богослужебная жизнь', editEvent: 'Редактировать.', addEvent: 'Добавить событие.', title: 'Название', start: 'Начало', end: 'Конец', category: 'Категория', location: 'Место', description: 'Описание', cancel: 'Отмена', saveChanges: 'Сохранить', createEvent: 'Создать событие', endBeforeStart: 'Время окончания должно быть после начала' },
  Română: { liturgicalLife: 'Viața liturgică', editEvent: 'Editează eveniment.', addEvent: 'Adaugă eveniment.', title: 'Titlu', start: 'Început', end: 'Sfârșit', category: 'Categorie', location: 'Locație', description: 'Descriere', cancel: 'Anulează', saveChanges: 'Salvează', createEvent: 'Creează eveniment', endBeforeStart: 'Ora de sfârșit trebuie să fie după ora de început' },
  Українська: { liturgicalLife: 'Богослужбове життя', editEvent: 'Редагувати подію.', addEvent: 'Додати подію.', title: 'Назва', start: 'Початок', end: 'Кінець', category: 'Категорія', location: 'Місце', description: 'Опис', cancel: 'Скасувати', saveChanges: 'Зберегти', createEvent: 'Створити подію', endBeforeStart: 'Час закінчення повинен бути після початку' },
};

const DEFAULT_CATEGORY = 'Divine Liturgy';

function toLocalInputValue(date: Date): string {
  const offsetMs = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
}

function buildInitialValues(event: FirestoreEvent | null): EventFormValues {
  const now = new Date();
  const start = event?.startTime ?? new Date(now.getTime() + 60 * 60 * 1000);
  const end = event?.endTime ?? new Date(start.getTime() + 60 * 60 * 1000);

  return {
    title: event?.title ?? '',
    description: event?.description ?? '',
    location: event?.location ?? '',
    category: event?.category ?? DEFAULT_CATEGORY,
    startAt: toLocalInputValue(start),
    endAt: toLocalInputValue(end),
  };
}

export default function ManagementEventSheet({
  event,
  isOpen,
  saving,
  error,
  onClose,
  onSubmit,
  language = 'English',
}: ManagementEventSheetProps) {
  const t = SHEET_T[language];
  const [values, setValues] = useState<EventFormValues>(buildInitialValues(event));
  const [validationError, setValidationError] = useState('');

  useEffect(() => {
    if (isOpen) {
      setValues(buildInitialValues(event));
      setValidationError('');
    }
  }, [event, isOpen]);

  if (!isOpen) {
    return null;
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="absolute inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-end justify-center"
      onClick={(event) => event.stopPropagation()}
    >
      <motion.form
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        transition={{ type: 'spring', damping: 26, stiffness: 220 }}
        className="w-full max-w-3xl bg-white rounded-t-[40px] p-8 pb-10 shadow-2xl max-h-[90vh] overflow-y-auto"
        onSubmit={(eventValue) => {
              eventValue.preventDefault();
              setValidationError('');
              if (new Date(values.endAt) <= new Date(values.startAt)) {
                setValidationError(t.endBeforeStart);
                return;
              }
              const submitted = onSubmit(values);
              if (submitted) {
                onClose();
              }
            }}
      >
            <div className="flex items-start justify-between gap-6 mb-8">
              <div>
                <span className="text-[#937022] font-black text-[10px] tracking-[0.2em] uppercase mb-2 block">
                  {t.liturgicalLife}
                </span>
                <h3 className="text-3xl font-black text-gray-900 tracking-tighter">
                  {event ? t.editEvent : t.addEvent}
                </h3>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="w-10 h-10 rounded-full bg-gray-50 text-gray-400 hover:text-gray-900 transition-colors flex items-center justify-center"
              >
                <X size={18} />
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <label className="space-y-2 md:col-span-2">
                <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1 block">
                  {t.title}
                </span>
                <input
                  value={values.title}
                  onChange={(input) => setValues((current) => ({ ...current, title: input.target.value }))}
                  className="w-full bg-gray-50 rounded-2xl px-5 py-4 text-sm font-bold text-gray-900 border-none focus:ring-2 focus:ring-[#800000]/20"
                  required
                />
              </label>

              <label className="space-y-2">
                <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1 block">
                  {t.start}
                </span>
                <input
                  type="datetime-local"
                  value={values.startAt}
                  onChange={(input) => setValues((current) => ({ ...current, startAt: input.target.value }))}
                  className="w-full bg-gray-50 rounded-2xl px-5 py-4 text-sm font-bold text-gray-900 border-none focus:ring-2 focus:ring-[#800000]/20"
                  required
                />
              </label>

              <label className="space-y-2">
                <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1 block">
                  {t.end}
                </span>
                <input
                  type="datetime-local"
                  value={values.endAt}
                  onChange={(input) => setValues((current) => ({ ...current, endAt: input.target.value }))}
                  className="w-full bg-gray-50 rounded-2xl px-5 py-4 text-sm font-bold text-gray-900 border-none focus:ring-2 focus:ring-[#800000]/20"
                  required
                />
              </label>

              <label className="space-y-2">
                <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1 block">
                  {t.category}
                </span>
                <input
                  value={values.category}
                  onChange={(input) => setValues((current) => ({ ...current, category: input.target.value }))}
                  className="w-full bg-gray-50 rounded-2xl px-5 py-4 text-sm font-bold text-gray-900 border-none focus:ring-2 focus:ring-[#800000]/20"
                  required
                />
              </label>

              <label className="space-y-2">
                <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1 block">
                  {t.location}
                </span>
                <input
                  value={values.location}
                  onChange={(input) => setValues((current) => ({ ...current, location: input.target.value }))}
                  className="w-full bg-gray-50 rounded-2xl px-5 py-4 text-sm font-bold text-gray-900 border-none focus:ring-2 focus:ring-[#800000]/20"
                  required
                />
              </label>

              <label className="space-y-2 md:col-span-2">
                <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1 block">
                  {t.description}
                </span>
                <textarea
                  value={values.description}
                  onChange={(input) =>
                    setValues((current) => ({ ...current, description: input.target.value }))
                  }
                  rows={5}
                  className="w-full bg-gray-50 rounded-2xl px-5 py-4 text-sm font-bold text-gray-900 border-none focus:ring-2 focus:ring-[#800000]/20 resize-none"
                  required
                />
              </label>
            </div>

            {(error || validationError) && <p className="mt-4 text-sm font-bold text-red-500">{error || validationError}</p>}

            <div className="mt-8 flex gap-3">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 py-4 bg-gray-100 text-gray-600 rounded-2xl font-black text-[10px] uppercase tracking-widest hover:bg-gray-200 transition-all"
              >
                {t.cancel}
              </button>
              <button
                type="submit"
                disabled={saving}
                className="flex-1 py-4 bg-[#800000] text-white rounded-2xl font-black text-[10px] uppercase tracking-widest hover:bg-[#8D1212] transition-all disabled:opacity-60 flex items-center justify-center gap-2"
              >
                {saving ? <Loader2 size={14} className="animate-spin" /> : null}
                {event ? t.saveChanges : t.createEvent}
              </button>
            </div>
      </motion.form>
    </motion.div>
  );
}
