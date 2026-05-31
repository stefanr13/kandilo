import { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { Landmark, Loader2, Plus, X } from 'lucide-react';
import {
  CANADA_CRA_ELECTRONIC_RECEIPT_BLOCKER,
  ChurchFormData,
  hasRequiredStripeConnectDetails,
  stripeConnectAccountCreationBlocker,
  taxReceiptDetailsBlocker,
} from './missionControlForm';

interface ChurchFormSheetProps {
  initial: ChurchFormData;
  title: string;
  loading: boolean;
  onSubmit: (data: ChurchFormData) => void;
  onCancel: () => void;
  onCreateStripeConnectAccount?: (data: ChurchFormData) => Promise<string>;
}

const TIMEZONES = [
  'America/New_York',
  'America/Chicago',
  'America/Edmonton',
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
  onCreateStripeConnectAccount,
}: ChurchFormSheetProps) {
  const [form, setForm] = useState<ChurchFormData>(initial);
  const [stripeAccountLoading, setStripeAccountLoading] = useState(false);
  const [stripeAccountResult, setStripeAccountResult] = useState('');

  useEffect(() => {
    setForm(initial);
  }, [initial]);

  const updateField =
    (key: keyof ChurchFormData) =>
    (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
      setForm((current) => ({ ...current, [key]: event.target.value }));
    };
  const updateCheckbox =
    (key: keyof ChurchFormData) =>
    (event: React.ChangeEvent<HTMLInputElement>) => {
      setForm((current) => ({ ...current, [key]: event.target.checked ? 'true' : 'false' }));
    };

  const handleCreateStripeConnectAccount = async () => {
    if (!onCreateStripeConnectAccount || form.stripeConnectAccountId.trim()) {
      return;
    }
    const blocker = stripeConnectAccountCreationBlocker(form, initial);
    if (blocker) {
      setStripeAccountResult(blocker);
      return;
    }
    setStripeAccountLoading(true);
    setStripeAccountResult('');
    try {
      const accountId = await onCreateStripeConnectAccount(form);
      setForm((current) => ({
        ...current,
        stripeConnectEnabled: 'false',
        stripeConnectAccountId: accountId,
        stripeConnectAccountApi: 'v2',
      }));
      setStripeAccountResult('Stripe account created. Enable routing after onboarding is complete.');
    } catch (error) {
      setStripeAccountResult((error as Error).message);
    } finally {
      setStripeAccountLoading(false);
    }
  };

  const inputClassName =
    'w-full bg-gray-50 border-none rounded-xl px-4 py-3 text-sm font-bold text-gray-900 focus:ring-2 focus:ring-[#800000]/20 transition-all';
  const labelClassName =
    'text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1 block mb-1';
  const taxReceiptBlocker = taxReceiptDetailsBlocker(form);
  const canSubmit = Boolean(
    form.name.trim()
    && form.city.trim()
    && form.contactEmail.trim()
    && hasRequiredStripeConnectDetails(form)
    && !taxReceiptBlocker
  );
  const stripeAccountCreationBlocker = stripeConnectAccountCreationBlocker(form, initial);
  const canCreateStripeAccount = !stripeAccountCreationBlocker;
  const taxReceiptAnnualPreparationAvailable =
    form.taxReceiptsEnabled === 'true' && form.taxReceiptJurisdiction === 'US';
  const taxReceiptAnnualAutoEmailAvailable =
    taxReceiptAnnualPreparationAvailable && form.taxReceiptAnnualPreparationEnabled === 'true';

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

          <FormSection heading="Stripe Routing" />
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelClassName}>Stripe Connect Routing</label>
              <select
                className={inputClassName}
                value={form.stripeConnectEnabled}
                onChange={updateField('stripeConnectEnabled')}
              >
                <option value="false">Platform account</option>
                <option value="true">Connected parish account</option>
              </select>
            </div>
            <div>
              <label className={labelClassName}>Connected Account ID</label>
              <input
                className={inputClassName}
                value={form.stripeConnectAccountId}
                onChange={updateField('stripeConnectAccountId')}
                placeholder="acct_..."
              />
            </div>
            <div>
              <label className={labelClassName}>Connected Account API</label>
              <select
                className={inputClassName}
                value={form.stripeConnectAccountApi ?? 'v2'}
                onChange={updateField('stripeConnectAccountApi')}
              >
                <option value="v2">Accounts v2 recipient</option>
                <option value="v1">Legacy v1 account</option>
              </select>
            </div>
            {(form.stripeConnectEnabled === 'true' || form.stripeConnectAccountId.trim()) &&
              !hasRequiredStripeConnectDetails(form) && (
              <p className="col-span-2 rounded-xl bg-amber-50 px-4 py-3 text-xs font-bold leading-relaxed text-amber-800">
                Enter a valid Stripe connected account ID before enabling parish routing. The ID is stored in backend-only payment settings and is not written to the public church document.
              </p>
            )}
            {onCreateStripeConnectAccount && !form.stripeConnectAccountId.trim() && (
              <div className="col-span-2 flex flex-col gap-2 rounded-xl bg-gray-50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="space-y-1">
                  <p className="text-xs font-bold leading-relaxed text-gray-600">
                    Create a U.S. or Canadian Accounts v2 recipient account, then use Management receipts to finish Stripe onboarding.
                  </p>
                  {stripeAccountCreationBlocker && (
                    <p className="text-[11px] font-bold leading-relaxed text-amber-700">
                      {stripeAccountCreationBlocker}
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => void handleCreateStripeConnectAccount()}
                  disabled={loading || stripeAccountLoading || !canCreateStripeAccount}
                  className="inline-flex items-center justify-center gap-2 rounded-lg bg-gray-900 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-white transition-all hover:bg-gray-800 disabled:opacity-50"
                >
                  {stripeAccountLoading ? <Loader2 size={13} className="animate-spin" /> : <Landmark size={13} />}
                  Create Stripe Account
                </button>
              </div>
            )}
            {stripeAccountResult && (
              <p
                className={`col-span-2 text-xs font-bold ${
                  stripeAccountResult.toLowerCase().includes('created')
                    ? 'text-emerald-700'
                    : 'text-red-700'
                }`}
              >
                {stripeAccountResult}
              </p>
            )}
          </div>

          <FormSection heading="Tax Receipts" />
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelClassName}>Enable Receipts</label>
              <select
                className={inputClassName}
                value={form.taxReceiptsEnabled}
                onChange={updateField('taxReceiptsEnabled')}
              >
                <option value="false">Disabled</option>
                <option value="true">Enabled</option>
              </select>
            </div>
            <div>
              <label className={labelClassName}>Jurisdiction</label>
              <select
                className={inputClassName}
                value={form.taxReceiptJurisdiction}
                onChange={updateField('taxReceiptJurisdiction')}
              >
                <option value="US">United States</option>
                <option value="CA">Canada</option>
              </select>
            </div>
            <div className="col-span-2">
              <label className={labelClassName}>Legal Organization Name *</label>
              <input
                className={inputClassName}
                value={form.taxReceiptOrganizationName}
                onChange={updateField('taxReceiptOrganizationName')}
                placeholder="St. Nicholas Orthodox Church"
              />
            </div>
            <div className="col-span-2">
              <label className={labelClassName}>Receipt Address *</label>
              <input
                className={inputClassName}
                value={form.taxReceiptOrganizationAddress}
                onChange={updateField('taxReceiptOrganizationAddress')}
                placeholder="123 Main St, New York, NY"
              />
            </div>
            <div>
              <label className={labelClassName}>Tax ID / Registration No. *</label>
              <input
                className={inputClassName}
                value={form.taxReceiptTaxId}
                onChange={updateField('taxReceiptTaxId')}
                placeholder="12-3456789"
              />
            </div>
            <div>
              <label className={labelClassName}>Receipt Prefix</label>
              <input
                className={inputClassName}
                value={form.taxReceiptPrefix}
                onChange={updateField('taxReceiptPrefix')}
                placeholder="STN"
              />
            </div>
            <div>
              <label className={labelClassName}>Auto Issue</label>
              <select
                className={inputClassName}
                value={form.taxReceiptAutoIssue}
                onChange={updateField('taxReceiptAutoIssue')}
              >
                <option value="true">Enabled</option>
                <option value="false">Manual</option>
              </select>
            </div>
            <label
              className={`col-span-2 flex items-start gap-3 rounded-xl bg-gray-50 px-4 py-3 text-xs font-bold leading-relaxed text-gray-600 ${
                taxReceiptAnnualPreparationAvailable ? '' : 'opacity-60'
              }`}
            >
              <input
                type="checkbox"
                checked={
                  taxReceiptAnnualPreparationAvailable
                  && form.taxReceiptAnnualPreparationEnabled === 'true'
                }
                onChange={updateCheckbox('taxReceiptAnnualPreparationEnabled')}
                disabled={!taxReceiptAnnualPreparationAvailable}
                className="mt-0.5 h-4 w-4 rounded border-gray-300 text-[#800000] focus:ring-[#800000]/20 disabled:cursor-not-allowed"
              />
              <span>
                Prepare annual receipt records after year-end without automatically emailing donors.
              </span>
            </label>
            <label
              className={`col-span-2 flex items-start gap-3 rounded-xl bg-amber-50 px-4 py-3 text-xs font-bold leading-relaxed text-amber-900 ${
                taxReceiptAnnualAutoEmailAvailable ? '' : 'opacity-60'
              }`}
            >
              <input
                type="checkbox"
                checked={
                  taxReceiptAnnualAutoEmailAvailable
                  && form.taxReceiptAnnualAutoEmailEnabled === 'true'
                }
                onChange={updateCheckbox('taxReceiptAnnualAutoEmailEnabled')}
                disabled={!taxReceiptAnnualAutoEmailAvailable}
                className="mt-0.5 h-4 w-4 rounded border-amber-300 text-[#800000] focus:ring-[#800000]/20 disabled:cursor-not-allowed"
              />
              <span>
                Automatically email safe prepared annual receipts after year-end. Donor-years with refunds, mixed currencies, or prior individual receipts still require donor or priest/treasurer review.
              </span>
            </label>
            <div className="col-span-2">
              <label className={labelClassName}>Goods / Services Statement</label>
              <textarea
                className={inputClassName}
                rows={2}
                value={form.taxReceiptGoodsServicesStatement}
                onChange={updateField('taxReceiptGoodsServicesStatement')}
                placeholder="No goods or services were provided in exchange for this contribution other than intangible religious benefits."
              />
            </div>
            {form.taxReceiptJurisdiction === 'CA' && (
              <>
                <div>
                  <label className={labelClassName}>Receipt Issue Location</label>
                  <input
                    className={inputClassName}
                    value={form.taxReceiptIssueLocation}
                    onChange={updateField('taxReceiptIssueLocation')}
                    placeholder="Edmonton, Alberta"
                  />
                </div>
                <div>
                  <label className={labelClassName}>Authorized Signer Name</label>
                  <input
                    className={inputClassName}
                    value={form.taxReceiptAuthorizedSignerName}
                    onChange={updateField('taxReceiptAuthorizedSignerName')}
                    placeholder="Fr. Nicholas"
                  />
                </div>
                <div className="col-span-2">
                  <label className={labelClassName}>Authorized Signer Title</label>
                  <input
                    className={inputClassName}
                    value={form.taxReceiptAuthorizedSignerTitle}
                    onChange={updateField('taxReceiptAuthorizedSignerTitle')}
                    placeholder="Parish Priest"
                  />
                </div>
                <label className="col-span-2 flex items-start gap-3 rounded-xl bg-gray-50 px-4 py-3 text-xs font-bold leading-relaxed text-gray-600">
                  <input
                    type="checkbox"
                    checked={form.taxReceiptSecureElectronicSignatureConfigured === 'true'}
                    onChange={updateCheckbox('taxReceiptSecureElectronicSignatureConfigured')}
                    className="mt-0.5 h-4 w-4 rounded border-gray-300 text-[#800000] focus:ring-[#800000]/20"
                  />
                  <span>
                    Secure electronic signature material is controlled by the authorized signer for a future encrypted and signed PDF receipt flow.
                  </span>
                </label>
                <label className="col-span-2 flex items-start gap-3 rounded-xl bg-gray-50 px-4 py-3 text-xs font-bold leading-relaxed text-gray-600">
                  <input
                    type="checkbox"
                    checked={form.taxReceiptCopiesRetentionConfirmed === 'true'}
                    onChange={updateCheckbox('taxReceiptCopiesRetentionConfirmed')}
                    className="mt-0.5 h-4 w-4 rounded border-gray-300 text-[#800000] focus:ring-[#800000]/20"
                  />
                  <span>
                    The parish can retain copies of email-issued official receipts, protect contribution records from unauthorized access, and print hard copies on request.
                  </span>
                </label>
              </>
            )}
            {form.taxReceiptJurisdiction === 'CA' && (
              <p className={`col-span-2 rounded-xl px-4 py-3 text-xs font-bold leading-relaxed ${
                taxReceiptBlocker ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-800'
              }`}
              >
                {taxReceiptBlocker
                  || `Canada/CRA receipt fields can be staged here while Enable Receipts remains Disabled. ${CANADA_CRA_ELECTRONIC_RECEIPT_BLOCKER}`}
              </p>
            )}
            {taxReceiptBlocker && form.taxReceiptJurisdiction === 'US' && (
              <p className="col-span-2 rounded-xl bg-red-50 px-4 py-3 text-xs font-bold leading-relaxed text-red-700">
                {taxReceiptBlocker}
              </p>
            )}
            {form.taxReceiptsEnabled === 'true' && form.taxReceiptJurisdiction === 'US' && (
              <label className="col-span-2 flex items-start gap-3 rounded-xl bg-amber-50 px-4 py-3 text-xs font-bold leading-relaxed text-amber-900">
                <input
                  type="checkbox"
                  checked={form.taxReceiptEligibilityConfirmed === 'true'}
                  onChange={updateCheckbox('taxReceiptEligibilityConfirmed')}
                  className="mt-0.5 h-4 w-4 rounded border-amber-300 text-[#800000] focus:ring-[#800000]/20"
                />
                <span>
                  I confirm this parish is eligible to issue U.S. charitable contribution acknowledgments, the receipt organization details match official records, and the configured goods/services statement is accurate for these donations.
                </span>
              </label>
            )}
          </div>
        </div>

        <div className="px-6 pb-8 pt-4 border-t border-gray-50 flex-shrink-0">
          <button
            onClick={() => onSubmit(form)}
            disabled={loading || !canSubmit}
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
