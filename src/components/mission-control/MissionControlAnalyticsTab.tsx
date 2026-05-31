import { motion } from 'motion/react';
import {
  AlertTriangle,
  Calendar,
  CheckCircle2,
  Church,
  DollarSign,
  ListChecks,
  Loader2,
  Newspaper,
  ReceiptText,
  ShieldCheck,
  XCircle,
} from 'lucide-react';
import {
  SuperAdminChurchStats,
  SuperAdminPaymentOperationsReadiness,
  SuperAdminTaxReceiptAuditEvent,
} from '../../types';
import {
  firstIncompletePaymentOperationsLaunchStep,
  paymentOperationsReadinessWarningLabel,
  paymentOperationsWebhookIssueCount,
  paymentOperationsWebhookIssueSummary,
  paymentOperationsLaunchSteps,
} from '../../lib/stripe/payment-operations-readiness';
import { receiptAuditIssueLabel, receiptAuditReviewCountLabel } from '../../lib/giving/receipt-audit';

interface MissionControlAnalyticsTabProps {
  stats: SuperAdminChurchStats[];
  paymentOperationsReadiness: SuperAdminPaymentOperationsReadiness | null;
  taxReceiptAuditEvents: SuperAdminTaxReceiptAuditEvent[];
  statsLoading: boolean;
}

export default function MissionControlAnalyticsTab({
  stats,
  paymentOperationsReadiness,
  taxReceiptAuditEvents,
  statsLoading,
}: MissionControlAnalyticsTabProps) {
  return (
    <motion.div
      key="analytics"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      className="p-6 space-y-4"
    >
      {statsLoading ? (
        <div className="flex items-center justify-center gap-2 py-12">
          <Loader2 size={20} className="animate-spin text-gray-600" />
        </div>
      ) : (
        <>
          <PaymentOperationsPanel readiness={paymentOperationsReadiness} />

          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <p className="text-[9px] font-black text-gray-500 uppercase tracking-widest">
                Receipt Audit
              </p>
              <div className="flex items-center gap-1 rounded-full bg-gray-800 px-3 py-1 text-[9px] font-black uppercase tracking-widest text-gray-500">
                <ShieldCheck size={11} />
                Redacted
              </div>
            </div>
            {taxReceiptAuditEvents.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-gray-800 p-5 text-center">
                <p className="text-xs font-bold text-gray-500">No receipt activity yet.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {taxReceiptAuditEvents.slice(0, 12).map((event) => {
                  const auditIssueLabel = receiptAuditIssueLabel(event.errorCode, event.reasonCode);
                  const auditReviewCountLabel = receiptAuditReviewCountLabel(event.action, event.reviewCount);
                  return (
                    <div key={event.id} className="rounded-2xl bg-gray-800/60 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex min-w-0 items-start gap-3">
                          <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-[#800000]/30 text-[#ffb4b4]">
                            <ReceiptText size={15} />
                          </div>
                          <div className="min-w-0">
                            <p className="truncate text-xs font-black uppercase tracking-widest text-white">
                              {formatReceiptAction(event.action)}
                            </p>
                            <p className="mt-1 truncate text-[10px] font-bold text-gray-500">
                              {event.churchName || event.churchId || 'Unknown church'}
                            </p>
                          </div>
                        </div>
                        <p className="flex-shrink-0 text-[10px] font-bold text-gray-500">
                          {formatAuditTime(event.createdAtMillis)}
                        </p>
                      </div>
                      <div className="mt-3 grid grid-cols-2 gap-2 text-[10px] font-bold text-gray-500 sm:grid-cols-4">
                        <AuditMeta label="Receipt" value={event.receiptId || '—'} />
                        <AuditMeta label="Kind" value={event.kind || '—'} />
                        <AuditMeta label="Year" value={String(event.receiptYear ?? event.annualYear ?? '—')} />
                        <AuditMeta label="Actor" value={event.actorUid || 'system'} />
                      </div>
                      {(auditIssueLabel || auditReviewCountLabel) && (
                        <div className="mt-3 space-y-2">
                          {auditIssueLabel && (
                            <p className="rounded-xl bg-gray-950/40 px-3 py-2 text-[10px] font-bold text-amber-300">
                              {auditIssueLabel}
                            </p>
                          )}
                          {auditReviewCountLabel && (
                            <p className="rounded-xl bg-gray-950/40 px-3 py-2 text-[10px] font-bold text-sky-200">
                              {auditReviewCountLabel}
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="space-y-3">
            <p className="text-[9px] font-black text-gray-500 uppercase tracking-widest">
              Per-Church Breakdown
            </p>

            {stats.map((church) => (
              <div key={church.churchId} className="bg-gray-800/60 rounded-2xl p-4 space-y-3">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl overflow-hidden bg-gray-700 flex-shrink-0">
                    {church.imageURL ? (
                      <img
                        src={church.imageURL}
                        alt=""
                        className="w-full h-full object-cover"
                        referrerPolicy="no-referrer"
                      />
                    ) : (
                      <Church size={16} className="m-auto mt-2.5 text-gray-500" />
                    )}
                  </div>
                  <div>
                    <p className="text-sm font-black text-white">{church.name}</p>
                    <p className="text-[10px] text-gray-500 font-bold">
                      {church.city}, {church.state} · Est. {church.foundedYear || '—'}
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-4 gap-2">
                  <MetricCard
                    value={church.priestCount}
                    label="Clergy"
                    accentClassName="text-[#800000]"
                  />
                  <MetricCard
                    value={church.treasurerCount ?? 0}
                    label="Finance"
                    accentClassName="text-emerald-400"
                  />
                  <MetricCard
                    value={church.adminCount}
                    label="Admins"
                    accentClassName="text-amber-500"
                  />
                  <MetricCard
                    value={church.memberCount - church.priestCount - (church.treasurerCount ?? 0) - church.adminCount}
                    label="Members"
                    accentClassName="text-gray-400"
                  />
                </div>

                <div className="flex items-center justify-between bg-gray-700/30 rounded-xl px-4 py-3">
                  <div className="flex items-center gap-2">
                    <DollarSign size={14} className="text-emerald-400" />
                    <span className="text-xs font-black text-gray-300">Total Donations</span>
                  </div>
                  <span className="text-sm font-black text-emerald-400">
                    $
                    {church.donationTotal.toLocaleString('en-US', {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
                  </span>
                </div>

                <div className="flex gap-2">
                  <ActivityPill
                    icon={Calendar}
                    value={`${church.eventCount} events`}
                    iconClassName="text-blue-400"
                  />
                  <ActivityPill
                    icon={Newspaper}
                    value={`${church.newsletterCount} bulletins`}
                    iconClassName="text-purple-400"
                  />
                  <div className="flex-1 flex items-center gap-2 bg-gray-700/30 rounded-xl px-3 py-2">
                    {church.isVerified ? (
                      <CheckCircle2 size={12} className="text-emerald-400" />
                    ) : (
                      <XCircle size={12} className="text-gray-600" />
                    )}
                    <span
                      className={`text-[10px] font-black ${
                        church.isVerified ? 'text-emerald-400' : 'text-gray-600'
                      }`}
                    >
                      {church.isVerified ? 'Verified' : 'Unverified'}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </motion.div>
  );
}

function PaymentOperationsPanel({
  readiness,
}: {
  readiness: SuperAdminPaymentOperationsReadiness | null;
}) {
  const productionReady = readiness?.productionReady === true;
  const stripeMode = readiness?.stripeSecretKey.mode;
  const webhookIssueCount = readiness ? paymentOperationsWebhookIssueCount(readiness) : 0;
  const webhookIssueSummary = readiness ? paymentOperationsWebhookIssueSummary(readiness) : '0';
  const liveWebhookSmokeReady =
    (readiness?.webhookActivity.liveProcessedCheckoutCompletedCount ?? 0) > 0
    && readiness?.webhookActivity.liveCheckoutSmokeFresh === true
    && readiness?.webhookActivity.latestLiveStatus === 'processed'
    && webhookIssueCount === 0;
  const webhookSmokeReady =
    stripeMode === 'live'
      ? liveWebhookSmokeReady
      : (readiness?.webhookActivity.processedCheckoutCompletedCount ?? 0) > 0
        && readiness?.webhookActivity.checkoutSmokeFresh === true
        && readiness?.webhookActivity.latestStatus === 'processed'
        && webhookIssueCount === 0;
  const latestEventReady =
    stripeMode === 'live'
      ? readiness?.webhookActivity.latestLiveStatus === 'processed'
      : readiness?.webhookActivity.latestStatus === 'processed';
  const receiptEmailSmokeReady = readiness?.taxReceiptEmailSmoke.ready === true;
  const annualReceiptSmokeReady = readiness?.taxReceiptAnnualSmoke.ready === true;
  const launchSteps = paymentOperationsLaunchSteps(readiness);
  const nextLaunchStep = firstIncompletePaymentOperationsLaunchStep(readiness);
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[9px] font-black text-gray-500 uppercase tracking-widest">
          Payments & Receipts
        </p>
        <div
          className={`flex items-center gap-1 rounded-full px-3 py-1 text-[9px] font-black uppercase tracking-widest ${
            productionReady
              ? 'bg-emerald-500/15 text-emerald-300'
              : 'bg-amber-500/15 text-amber-300'
          }`}
        >
          {productionReady ? <CheckCircle2 size={11} /> : <AlertTriangle size={11} />}
          {productionReady ? 'Production ready' : 'Setup needed'}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <ReadinessTile
          label="Stripe key"
          value={formatStripeMode(readiness?.stripeSecretKey.mode)}
          ready={readiness?.stripeSecretKey.configured === true && readiness.stripeSecretKey.mode === 'live'}
        />
        <ReadinessTile
          label="Stripe account"
          value={formatStripeAccount(readiness?.stripeAccount)}
          ready={readiness?.stripeAccount.ready === true}
        />
        <ReadinessTile
          label="Webhook secret"
          value={formatWebhookSecret(readiness)}
          ready={
            readiness?.stripeWebhookSecret.configured === true
            && readiness.stripeWebhookSecret.formatValid === true
          }
        />
        <ReadinessTile
          label="Webhook endpoint"
          value={formatStripeWebhookEndpoint(readiness)}
          ready={
            readiness?.stripeSecretKey.mode === 'live'
            && readiness.stripeWebhookEndpoint.ready === true
          }
        />
        <ReadinessTile
          label="Stripe API"
          value={readiness?.stripeApiVersion || 'Missing'}
          ready={Boolean(readiness?.stripeApiVersion)}
        />
        <ReadinessTile
          label="Receipt email"
          value={formatResendEmailReadiness(readiness)}
          ready={readiness?.taxReceiptDeliveryReady === true}
        />
        <ReadinessTile
          label="Return URL"
          value={readiness?.appUrl.value || 'Missing'}
          ready={readiness?.appUrl.configured === true && readiness.appUrl.runtimeValid === true}
        />
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-5">
        <ReadinessTile
          label={stripeMode === 'live' ? 'Live webhook' : 'Webhook activity'}
          value={
            readiness?.webhookActivity.checkedEventCount
              ? stripeMode === 'live'
                ? `${readiness.webhookActivity.liveProcessedCheckoutCompletedCount} live checkout`
                : `${readiness.webhookActivity.processedCheckoutCompletedCount} checkout`
              : 'None yet'
          }
          ready={webhookSmokeReady}
        />
        <ReadinessTile
          label={stripeMode === 'live' ? 'Latest live event' : 'Latest event'}
          value={
            stripeMode === 'live'
              ? readiness?.webhookActivity.latestLiveType
                ? `${formatWebhookEvent(readiness.webhookActivity.latestLiveType)} / live`
                : 'None yet'
              : `${formatWebhookEvent(readiness?.webhookActivity.latestType)}${
                readiness?.webhookActivity.latestLivemode === true
                  ? ' / live'
                  : readiness?.webhookActivity.latestLivemode === false
                    ? ' / test'
                    : ''
              }`
          }
          ready={latestEventReady}
        />
        <ReadinessTile
          label="Receipt smoke"
          value={formatReceiptEmailSmoke(readiness)}
          ready={receiptEmailSmokeReady}
        />
        <ReadinessTile
          label="Annual smoke"
          value={formatAnnualReceiptSmoke(readiness)}
          ready={annualReceiptSmokeReady}
        />
        <ReadinessTile
          label={stripeMode === 'live' ? 'Issue checks' : 'Validation issues'}
          value={webhookIssueSummary}
          ready={webhookIssueCount === 0}
        />
      </div>

      {readiness?.webhookUrl && (
        <div className="rounded-2xl bg-gray-800/60 p-4">
          <p className="text-[8px] font-black uppercase tracking-widest text-gray-600">
            Webhook endpoint
          </p>
          <p className="mt-2 break-all text-[10px] font-bold text-gray-400">{readiness.webhookUrl}</p>
        </div>
      )}

      {readiness && launchSteps.length > 0 && (
        <div className="rounded-2xl bg-gray-800/60 p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[8px] font-black uppercase tracking-widest text-gray-600">
                Launch checklist
              </p>
              <p className="mt-1 text-[10px] font-bold text-gray-400">
                {nextLaunchStep ? `Next: ${nextLaunchStep.label}` : 'All production launch steps are complete.'}
              </p>
            </div>
            <ListChecks size={16} className={nextLaunchStep ? 'text-amber-300' : 'text-emerald-400'} />
          </div>
          <div className="mt-3 space-y-2">
            {launchSteps.map((step, index) => (
              <div key={step.id} className="flex items-start gap-3 rounded-xl bg-gray-950/30 px-3 py-2">
                <div
                  className={`mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full text-[9px] font-black ${
                    step.ready ? 'bg-emerald-500/15 text-emerald-300' : 'bg-amber-500/15 text-amber-300'
                  }`}
                >
                  {step.ready ? <CheckCircle2 size={12} /> : index + 1}
                </div>
                <div className="min-w-0">
                  <p className="text-[10px] font-black text-white">{step.label}</p>
                  <p className="mt-0.5 text-[10px] font-bold leading-relaxed text-gray-500">{step.detail}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {readiness && readiness.warnings.length > 0 && (
        <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 p-4">
          <p className="text-[9px] font-black uppercase tracking-widest text-amber-300">
            Remaining setup
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {readiness.warnings.map((warning) => (
              <span
                key={warning}
                className="rounded-full bg-gray-950/40 px-3 py-1 text-[9px] font-black uppercase tracking-widest text-amber-200"
              >
                {paymentOperationsReadinessWarningLabel(warning)}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ReadinessTile({
  label,
  value,
  ready,
}: {
  label: string;
  value: string;
  ready: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-2xl bg-gray-800/60 p-4">
      <div className="min-w-0">
        <p className="text-[8px] font-black uppercase tracking-widest text-gray-600">{label}</p>
        <p className="mt-1 truncate text-xs font-black text-white">{value}</p>
      </div>
      {ready ? (
        <CheckCircle2 size={16} className="flex-shrink-0 text-emerald-400" />
      ) : (
        <XCircle size={16} className="flex-shrink-0 text-amber-300" />
      )}
    </div>
  );
}

function formatStripeMode(mode?: SuperAdminPaymentOperationsReadiness['stripeSecretKey']['mode']): string {
  if (mode === 'live') return 'Live mode';
  if (mode === 'test') return 'Test mode';
  if (mode === 'unknown') return 'Unrecognized';
  return 'Missing';
}

function stripeAccountQueuedRequirementSuffix(
  account?: SuperAdminPaymentOperationsReadiness['stripeAccount']
): string {
  const queuedRequirementSegments: string[] = [];
  const eventualRequirementCount = account?.eventuallyDueCount ?? 0;
  if (eventualRequirementCount > 0) {
    queuedRequirementSegments.push(`eventual: ${eventualRequirementCount}`);
  }
  const futureRequirementCount = account
    ? account.futureCurrentlyDueCount + account.futurePastDueCount + account.futureEventuallyDueCount
    : 0;
  if (futureRequirementCount > 0) {
    queuedRequirementSegments.push(`future: ${futureRequirementCount}`);
  }
  return queuedRequirementSegments.length > 0 ? `, ${queuedRequirementSegments.join(', ')}` : '';
}

export function formatStripeAccount(account?: SuperAdminPaymentOperationsReadiness['stripeAccount']): string {
  if (!account?.checked) {
    return account?.errorCode ? 'Unavailable' : 'Not checked';
  }
  const queuedSuffix = stripeAccountQueuedRequirementSuffix(account);
  if (account.ready) return `Ready${queuedSuffix}`;
  if (account.disabledReason) return `Disabled${queuedSuffix}`;
  if (!account.detailsSubmitted) return `Details missing${queuedSuffix}`;
  if (!account.chargesEnabled) return `Charges off${queuedSuffix}`;
  if (!account.payoutsEnabled) return `Payouts off${queuedSuffix}`;
  if (account.currentlyDueCount > 0 || account.pastDueCount > 0) return `Requirements due${queuedSuffix}`;
  return `Review needed${queuedSuffix}`;
}

function formatWebhookSecret(readiness?: SuperAdminPaymentOperationsReadiness | null): string {
  if (!readiness?.stripeWebhookSecret.configured) return 'Missing';
  return readiness.stripeWebhookSecret.formatValid ? 'Configured' : 'Invalid format';
}

function formatStripeWebhookEndpoint(readiness?: SuperAdminPaymentOperationsReadiness | null): string {
  const endpoint = readiness?.stripeWebhookEndpoint;
  if (readiness?.stripeSecretKey.mode !== 'live') return 'Live check pending';
  if (!endpoint?.checked) return endpoint?.errorCode ? 'Unavailable' : 'Not checked';
  if (!endpoint.configured) return 'Endpoint missing';
  if (!endpoint.liveMode) return 'Not live';
  if (endpoint.duplicateCount > 0) return 'Duplicate endpoints';
  if (!endpoint.enabled) return 'Disabled';
  if (!endpoint.apiVersionMatches) return 'API mismatch';
  if (!endpoint.requiredEventsConfigured) return 'Missing events';
  if (!endpoint.explicitEventsOnly) return 'Wildcard events';
  if (!endpoint.noUnexpectedEvents) return 'Extra events';
  return 'Verified';
}

function formatResendEmailReadiness(readiness?: SuperAdminPaymentOperationsReadiness | null): string {
  if (!readiness?.resendApiKey.configured) return 'Missing';
  if (!readiness.resendApiKey.formatValid) return 'Invalid format';
  if (!readiness.resendDomain.checked) return 'Domain unchecked';
  if (!readiness.resendDomain.configured) return 'Domain missing';
  if (!readiness.resendDomain.verified) return 'Domain unverified';
  if (readiness.resendDomain.duplicateCount > 0) return 'Verified, duplicates';
  return 'Verified domain';
}

function formatReceiptEmailSmoke(readiness?: SuperAdminPaymentOperationsReadiness | null): string {
  if (!readiness?.taxReceiptEmailSmoke.checkedEventCount) return 'None yet';
  if (readiness.stripeSecretKey.mode === 'live') {
    if (readiness.taxReceiptEmailSmoke.ready) {
      return `${readiness.taxReceiptEmailSmoke.liveEmailSentCount} live sent`;
    }
    if (readiness.taxReceiptEmailSmoke.latestLiveCheckoutEmailSentAtMillis === null) {
      return 'Latest smoke missing';
    }
    if (readiness.taxReceiptEmailSmoke.latestLiveCheckoutReceiptPdfObjectReady === false) {
      return 'Latest PDF copy missing';
    }
    if (!readiness.taxReceiptEmailSmoke.latestLiveCheckoutReceiptArtifactReady) {
      return 'Latest artifacts missing';
    }
    if (!readiness.taxReceiptEmailSmoke.latestLiveCheckoutReceiptArtifactFresh) {
      return 'Latest artifacts stale';
    }
    return 'Latest smoke stale';
  }
  return readiness.taxReceiptEmailSmoke.emailSentFresh
    ? `${readiness.taxReceiptEmailSmoke.emailSentCount} sent`
    : 'Smoke stale';
}

function formatAnnualReceiptSmoke(readiness?: SuperAdminPaymentOperationsReadiness | null): string {
  if (!readiness?.taxReceiptAnnualSmoke.checkedEventCount) return 'None yet';
  if (readiness.taxReceiptAnnualSmoke.ready) {
    return `${readiness.taxReceiptAnnualSmoke.annualEmailSentCount} annual sent`;
  }
  if (readiness.taxReceiptAnnualSmoke.latestAnnualReceiptCorrectedOrReissue) {
    return 'Original annual missing';
  }
  if (!readiness.taxReceiptAnnualSmoke.latestAnnualReceiptSummaryReady) {
    return 'Summary missing';
  }
  if (!readiness.taxReceiptAnnualSmoke.latestAnnualReceiptContributionDetailReady) {
    return 'Contribution detail missing';
  }
  if (!readiness.taxReceiptAnnualSmoke.latestAnnualReceiptPdfObjectReady) {
    return 'PDF copy missing';
  }
  if (!readiness.taxReceiptAnnualSmoke.latestAnnualReceiptArtifactReady) {
    return 'Artifacts missing';
  }
  if (!readiness.taxReceiptAnnualSmoke.latestAnnualReceiptArtifactFresh) {
    return 'Artifacts stale';
  }
  return 'Smoke stale';
}

function formatWebhookEvent(value?: string): string {
  if (!value) return 'None yet';
  return value.replace(/\./g, ' ').replace(/_/g, ' ');
}

function formatReceiptAction(action: string): string {
  return action.replace(/_/g, ' ');
}

function formatAuditTime(value: number | null): string {
  if (!value) {
    return '—';
  }
  return new Date(value).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function AuditMeta({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-xl bg-gray-950/30 px-3 py-2">
      <p className="text-[8px] font-black uppercase tracking-widest text-gray-600">{label}</p>
      <p className="mt-1 truncate text-[10px] font-bold text-gray-400">{value}</p>
    </div>
  );
}

function MetricCard({
  value,
  label,
  accentClassName,
}: {
  value: number;
  label: string;
  accentClassName: string;
}) {
  return (
    <div className="bg-gray-700/50 rounded-xl p-3 text-center">
      <p className="text-lg font-black text-white">{value}</p>
      <p className={`text-[9px] font-black uppercase tracking-widest ${accentClassName}`}>
        {label}
      </p>
    </div>
  );
}

function ActivityPill({
  icon: Icon,
  value,
  iconClassName,
}: {
  icon: React.ElementType;
  value: string;
  iconClassName: string;
}) {
  return (
    <div className="flex-1 flex items-center gap-2 bg-gray-700/30 rounded-xl px-3 py-2">
      <Icon size={12} className={iconClassName} />
      <span className="text-[10px] font-black text-gray-400">{value}</span>
    </div>
  );
}
