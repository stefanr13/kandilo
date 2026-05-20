import { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { Loader2, Plus, X } from 'lucide-react';
import { ChurchFormData } from './missionControlForm';

interface ChurchFormSheetProps {
  initial: ChurchFormData;
  title: string;
  loading: boolean;
  onSubmit: (data: ChurchFormData) => void;
  onCancel: () => void;
}

const TIMEZONES = [
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Phoenix',
  'Europe/Belgrade',
  'Europe/Athens',
  'Europe/Moscow',
] as const;

export default function ChurchFormSheet({
  initial,
  title,
  loading,
  onSubmit,
  onCancel,
}: ChurchFormSheetProps) {
  const [form, setForm] = useState<ChurchFormData>(initial);

  useEffect(() => {
    setForm(initial);
  }, [initial]);

  const updateField =
    (key: keyof ChurchFormData) =>
    (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
      setForm((current) => ({ ...current, [key]: event.target.value }));
    };

  const inputClassName =
    'w-full bg-gray-50 border-none rounded-xl px-4 py-3 text-sm font-bold text-gray-900 focus:ring-2 focus:ring-[#800000]/20 transition-all';
  const labelClassName =
    'text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1 block mb-1';

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="absolute inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-end"
    >
      <motion.div
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={{ type: 'spring', damping: 26, stiffness: 220 }}
        className="w-full bg-white rounded-t-[40px] flex flex-col"
        style={{ maxHeight: '92vh' }}
      >
        <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b border-gray-50 flex-shrink-0">
          <h3 className="text-xl font-black text-gray-900 tracking-tight">{title}</h3>
          <button
            onClick={onCancel}
            className="w-9 h-9 bg-gray-100 rounded-full flex items-center justify-center text-gray-400"
          >
            <X size={18} />
          </button>
        </div>

        <div className="overflow-y-auto px-6 pb-8 space-y-4 flex-1">
          <FormSection heading="Identity" />
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className={labelClassName}>Parish Name *</label>
              <input
                className={inputClassName}
                value={form.name}
                onChange={updateField('name')}
                placeholder="St. Nicholas Orthodox Church"
              />
            </div>
            <div>
              <label className={labelClassName}>Denomination</label>
              <input
                className={inputClassName}
                value={form.denomination}
                onChange={updateField('denomination')}
              />
            </div>
            <div>
              <label className={labelClassName}>Founded Year</label>
              <input
                className={inputClassName}
                type="number"
                value={form.foundedYear}
                onChange={updateField('foundedYear')}
                placeholder="1920"
              />
            </div>
            <div className="col-span-2">
              <label className={labelClassName}>Jurisdiction</label>
              <input
                className={inputClassName}
                value={form.jurisdiction}
                onChange={updateField('jurisdiction')}
                placeholder="Serbian Orthodox Diocese of Eastern America"
              />
            </div>
            <div className="col-span-2">
              <label className={labelClassName}>Diocese</label>
              <input
                className={inputClassName}
                value={form.diocese}
                onChange={updateField('diocese')}
                placeholder="Diocese of Eastern America"
              />
            </div>
            <div className="col-span-2">
              <label className={labelClassName}>Languages (comma separated)</label>
              <input
                className={inputClassName}
                value={form.languages}
                onChange={updateField('languages')}
                placeholder="English, Serbian"
              />
            </div>
            <div className="col-span-2">
              <label className={labelClassName}>About</label>
              <textarea
                className={inputClassName}
                rows={3}
                value={form.about}
                onChange={updateField('about')}
                placeholder="Brief history and mission of the parish…"
              />
            </div>
          </div>

          <FormSection heading="Location & Contact" />
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className={labelClassName}>Street Address *</label>
              <input
                className={inputClassName}
                value={form.address}
                onChange={updateField('address')}
                placeholder="123 Main St"
              />
            </div>
            <div>
              <label className={labelClassName}>City *</label>
              <input
                className={inputClassName}
                value={form.city}
                onChange={updateField('city')}
                placeholder="New York"
              />
            </div>
            <div>
              <label className={labelClassName}>State</label>
              <input
                className={inputClassName}
                value={form.state}
                onChange={updateField('state')}
                placeholder="NY"
              />
            </div>
            <div>
              <label className={labelClassName}>Country</label>
              <input
                className={inputClassName}
                value={form.country}
                onChange={updateField('country')}
                placeholder="US"
              />
            </div>
            <div>
              <label className={labelClassName}>Postal Code</label>
              <input
                className={inputClassName}
                value={form.postalCode}
                onChange={updateField('postalCode')}
                placeholder="10001"
              />
            </div>
            <div>
              <label className={labelClassName}>Latitude</label>
              <input
                className={inputClassName}
                type="number"
                step="any"
                value={form.latitude}
                onChange={updateField('latitude')}
                placeholder="40.7128"
              />
            </div>
            <div>
              <label className={labelClassName}>Longitude</label>
              <input
                className={inputClassName}
                type="number"
                step="any"
                value={form.longitude}
                onChange={updateField('longitude')}
                placeholder="-74.0060"
              />
            </div>
            <div>
              <label className={labelClassName}>Timezone</label>
              <select
                className={inputClassName}
                value={form.timezone}
                onChange={updateField('timezone')}
              >
                {TIMEZONES.map((timezone) => (
                  <option key={timezone} value={timezone}>
                    {timezone}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClassName}>Phone</label>
              <input
                className={inputClassName}
                value={form.phone}
                onChange={updateField('phone')}
                placeholder="+1 (212) 555-0100"
              />
            </div>
            <div>
              <label className={labelClassName}>Contact Email *</label>
              <input
                className={inputClassName}
                type="email"
                value={form.contactEmail}
                onChange={updateField('contactEmail')}
                placeholder="office@church.org"
              />
            </div>
            <div className="col-span-2">
              <label className={labelClassName}>Website</label>
              <input
                className={inputClassName}
                value={form.website}
                onChange={updateField('website')}
                placeholder="https://church.org"
              />
            </div>
          </div>

          <FormSection heading="Media" />
          <div className="grid grid-cols-1 gap-3">
            <div>
              <label className={labelClassName}>Thumbnail Image URL</label>
              <input
                className={inputClassName}
                value={form.imageURL}
                onChange={updateField('imageURL')}
                placeholder="https://…"
              />
            </div>
            <div>
              <label className={labelClassName}>Cover / Hero Image URL</label>
              <input
                className={inputClassName}
                value={form.coverImageURL}
                onChange={updateField('coverImageURL')}
                placeholder="https://…"
              />
            </div>
          </div>
        </div>

        <div className="px-6 pb-8 pt-4 border-t border-gray-50 flex-shrink-0">
          <button
            onClick={() => onSubmit(form)}
            disabled={loading || !form.name.trim() || !form.city.trim() || !form.contactEmail.trim()}
            className="w-full py-4 bg-[#800000] text-white rounded-2xl font-black text-[10px] uppercase tracking-widest flex items-center justify-center gap-2 disabled:opacity-40 active:scale-95 transition-all"
          >
            {loading ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
            {title}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

function FormSection({ heading }: { heading: string }) {
  return (
    <div className="pt-4 pb-1 border-t border-gray-100">
      <p className="text-[9px] font-black text-[#800000] uppercase tracking-[0.2em]">
        {heading}
      </p>
    </div>
  );
}
