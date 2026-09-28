import { useState, useEffect, useRef } from 'react';
import {
  Heart,
  CheckCircle2,
  Mail,
  X,
  ChevronRight,
  Gift,
  HandHeart,
  Loader2,
  ReceiptText,
  Send,
  Eye,
  Printer,
  Download,
} from 'lucide-react';
import { motion } from 'motion/react';
import confetti from 'canvas-confetti';
import type { User as FirebaseUser } from 'firebase/auth';
import { APP_URL_OPENED_EVENT, getGivingCheckoutState, type AppLocationSnapshot } from '../app/navigation';
import { openExternalUrl } from '../app/native';
import {
  createGivingCheckoutSession,
  downloadTaxReceiptPdf,
  sendAnnualTaxReceipt,
  sendCorrectedAnnualTaxReceipt,
  sendCorrectedTaxReceipt,
  sendTaxReceipt,
} from '../lib/api/giving';
import { firebaseAuthErrorCode, sendAccountEmailVerification } from '../lib/auth';
import {
  getGivingStatus,
  getTaxReceipt,
  subscribeToUserAnnualTaxReceiptSummaries,
  subscribeToUserTaxReceipts,
  subscribeToUserGiving,
  type FirestoreGivingRecord,
  type FirestoreTaxReceiptRecord,
  type FirestoreTaxReceiptSummaryRecord,
  type GivingStatus,
} from '../lib/db/giving';
import {
  assertStripeCheckoutUrl,
  checkoutReturnMatchesPendingGiving,
  GIVING_CONFIRMATION_ATTEMPTS,
  GIVING_CONFIRMATION_DELAY_MS,
  parsePendingGivingCheckoutState,
  PENDING_GIVING_STORAGE_KEY,
  type PendingGivingCheckoutState,
} from '../lib/giving/checkout';
import {
  callableReceiptDeliveryErrorMessage,
  receiptDeliveryErrorMessage,
  safeReceiptErrorCode,
  type ReceiptDeliveryErrorMessages,
} from '../lib/giving/receipt-errors';
import {
  displayTaxReceiptCurrency,
  formatTaxReceiptAmount,
  normalizedTaxReceiptCurrency,
} from '../lib/giving/receipt-currency';
import {
  donorAnnualReceiptActionAvailability,
  donorAnnualReceiptRows,
  donorGivingReceiptActionAvailability,
  donorTaxReceiptActionAvailability,
} from '../lib/giving/donor-receipt-actions';
import { subscribeToChurch } from '../lib/db/churches';
import {
  EMPTY_TAX_RECEIPT_ADDRESS,
  isTaxReceiptProfileComplete,
  subscribeToUserProfile,
  updateUserTaxReceiptProfile,
} from '../lib/db/profile';
import {
  donationCurrencyForChurchCountry,
  getTaxReceiptIssuanceState,
  type DonationCurrency,
  type TaxReceiptIssuanceState,
} from '../domain/church';
import { Screen, Language, Church, type TaxReceiptAddress } from '../types';
import { TRANSLATIONS } from '../translations';
import { getExtraCopy } from '../localization/extra';

interface GivingScreenProps {
  onScreenChange?: (screen: Screen) => void;
  language?: Language;
  activeChurch: Church | null;
  activeChurchId: string | null;
  currentUser?: FirebaseUser | null;
}

type GivingPhase = 'none' | 'details' | 'payment' | 'success';

const TAX_RECEIPT_UNSUPPORTED_JURISDICTION_CODE = 'tax_receipt_unsupported_jurisdiction';
const TAX_RECEIPT_DONOR_PROFILE_INCOMPLETE_CODE = 'tax_receipt_donor_profile_incomplete';
const TAX_RECEIPT_MISSING_EMAIL_OR_AMOUNT_CODE = 'tax_receipt_missing_email_or_amount';

interface ReceiptChurchState {
  taxReceiptState: TaxReceiptIssuanceState;
  taxReceiptReady: boolean;
  timezone: string;
}

async function waitForGivingStatus(givingId: string): Promise<GivingStatus> {
  for (let attempt = 0; attempt < GIVING_CONFIRMATION_ATTEMPTS; attempt++) {
    const status = await getGivingStatus(givingId);
    if (status === 'completed' || status === 'failed') {
      return status;
    }
    await new Promise((resolve) => window.setTimeout(resolve, GIVING_CONFIRMATION_DELAY_MS));
  }
  return getGivingStatus(givingId);
}

export default function GivingScreen({
  onScreenChange,
  language = 'English',
  activeChurch,
  activeChurchId,
  currentUser,
}: GivingScreenProps) {
  const [givingPhase, setGivingPhase] = useState<GivingPhase>('none');
  const [amount, setAmount] = useState<string>('50');
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [checkoutMessage, setCheckoutMessage] = useState('');
  const [emailVerificationSending, setEmailVerificationSending] = useState(false);
  const [emailVerificationChecking, setEmailVerificationChecking] = useState(false);
  const [emailVerificationMessage, setEmailVerificationMessage] = useState('');
  const [emailVerificationRefreshKey, setEmailVerificationRefreshKey] = useState(0);
  const [givingRecords, setGivingRecords] = useState<FirestoreGivingRecord[]>([]);
  const [givingRecordsLoading, setGivingRecordsLoading] = useState(false);
  const [taxReceiptRecords, setTaxReceiptRecords] = useState<FirestoreTaxReceiptRecord[]>([]);
  const [taxReceiptRecordsLoading, setTaxReceiptRecordsLoading] = useState(false);
  const [annualTaxReceiptSummaries, setAnnualTaxReceiptSummaries] = useState<FirestoreTaxReceiptSummaryRecord[]>([]);
  const [annualTaxReceiptSummariesLoading, setAnnualTaxReceiptSummariesLoading] = useState(false);
  const [receiptMessage, setReceiptMessage] = useState('');
  const [sendingReceiptId, setSendingReceiptId] = useState<string | null>(null);
  const [sendingAnnualReceiptKey, setSendingAnnualReceiptKey] = useState<string | null>(null);
  const [pendingAnnualReceiptAck, setPendingAnnualReceiptAck] = useState<{
    key: string;
    corrected: boolean;
  } | null>(null);
  const [loadingReceiptId, setLoadingReceiptId] = useState<string | null>(null);
  const [downloadingReceiptId, setDownloadingReceiptId] = useState<string | null>(null);
  const [selectedReceipt, setSelectedReceipt] = useState<FirestoreTaxReceiptRecord | null>(null);
  const [activeChurchTimezone, setActiveChurchTimezone] = useState('UTC');
  const [activeChurchDonationCurrency, setActiveChurchDonationCurrency] = useState<DonationCurrency>('USD');
  const [activeChurchTaxReceiptState, setActiveChurchTaxReceiptState] =
    useState<TaxReceiptIssuanceState>('disabled');
  const [activeChurchTaxReceiptReady, setActiveChurchTaxReceiptReady] = useState(false);
  const [receiptChurchStates, setReceiptChurchStates] = useState<Record<string, ReceiptChurchState>>({});
  const [taxReceiptProfileLoaded, setTaxReceiptProfileLoaded] = useState(false);
  const [taxReceiptProfileReady, setTaxReceiptProfileReady] = useState(false);
  const [taxReceiptProfileSaving, setTaxReceiptProfileSaving] = useState(false);
  const [taxReceiptProfileMessage, setTaxReceiptProfileMessage] = useState('');
  const [taxReceiptProfileForm, setTaxReceiptProfileForm] = useState<{
    taxReceiptLegalName: string;
    taxReceiptAddress: TaxReceiptAddress;
  }>({
    taxReceiptLegalName: currentUser?.displayName ?? '',
    taxReceiptAddress: EMPTY_TAX_RECEIPT_ADDRESS,
  });
  const [focusReceiptHistory, setFocusReceiptHistory] = useState(false);
  const desktopReceiptHistoryRef = useRef<HTMLDivElement | null>(null);
  const mobileReceiptHistoryRef = useRef<HTMLDivElement | null>(null);

  const t = TRANSLATIONS[language].giving;
  const extraCopy = getExtraCopy(language);
  const extra = extraCopy.giving;
  const profileExtra = extraCopy.profile;
  const receiptDeliveryErrorMessages: ReceiptDeliveryErrorMessages = {
    fallback: extra.taxReceiptSendError,
    emailNotConfigured: extra.taxReceiptEmailNotConfigured,
    emailInvalidConfiguration: extra.taxReceiptEmailInvalidConfiguration,
    missingEmailOrAmount: extra.taxReceiptMissingEmailOrAmount,
    missingDonorProfile: extra.taxReceiptMissingDonorProfile,
    pdfFailed: extra.taxReceiptPdfFailed,
    providerRejected: extra.taxReceiptProviderRejected,
    genericIssue: extra.taxReceiptGenericIssue,
    setupRequired: extra.taxReceiptUnavailable,
    unsupportedJurisdiction: extra.taxReceiptUnsupportedJurisdiction,
    previouslyReceiptedAckRequired: extra.taxReceiptPreviouslyReceiptedAckRequired,
    partialRefundReview: extra.taxReceiptPartialRefundReview,
    singleIncludedInAnnual: extra.taxReceiptIncludedInAnnual,
    singleGivingChanged: extra.taxReceiptSingleGivingChanged,
    annualGivingChanged: extra.taxReceiptAnnualGivingChanged,
    annualMixedCurrency: extra.taxReceiptAnnualMixedCurrency,
  };
  const receiptDownloadErrorMessages: ReceiptDeliveryErrorMessages = {
    ...receiptDeliveryErrorMessages,
    fallback: extra.taxReceiptDownloadError,
  };
  const donationCurrencyPrefix = activeChurchDonationCurrency === 'CAD' ? 'CA$' : '$';
  const formatDonationAmount = (value: number, maximumFractionDigits = 2) => (
    new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: activeChurchDonationCurrency,
      minimumFractionDigits: maximumFractionDigits,
      maximumFractionDigits,
    }).format(value)
  );
  const formatDonationCents = (valueCents: number, maximumFractionDigits = 2) => (
    formatDonationAmount(valueCents / 100, maximumFractionDigits)
  );

  const [givingData, setGivingData] = useState({
    fullName: currentUser?.displayName ?? '',
    email: currentUser?.email ?? '',
    purpose: t.generalFund,
    anonymous: false
  });

  useEffect(() => {
    const scrollContainer = document.querySelector('main');
    if (scrollContainer) {
      scrollContainer.scrollTo({ top: 0, behavior: 'instant' });
    }
  }, [givingPhase]);

  useEffect(() => {
    if (!focusReceiptHistory || givingPhase !== 'none') {
      return undefined;
    }

    const timeout = window.setTimeout(() => {
      const desktopLayoutVisible =
        typeof window.matchMedia === 'function'
        && window.matchMedia('(min-width: 1024px)').matches;
      const target = desktopLayoutVisible
        ? desktopReceiptHistoryRef.current
        : mobileReceiptHistoryRef.current;

      target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      target?.focus({ preventScroll: true });
      setFocusReceiptHistory(false);
    }, 0);

    return () => window.clearTimeout(timeout);
  }, [focusReceiptHistory, givingPhase]);

  useEffect(() => {
    setGivingData((current) => ({
      ...current,
      fullName: currentUser?.displayName ?? current.fullName,
      email: currentUser?.email ?? current.email,
    }));
  }, [currentUser]);

  useEffect(() => {
    if (!currentUser || currentUser.isAnonymous || currentUser.emailVerified !== true) {
      setGivingRecords([]);
      setGivingRecordsLoading(false);
      return undefined;
    }

    setGivingRecordsLoading(true);
    return subscribeToUserGiving(
      currentUser.uid,
      (records) => {
        setGivingRecords(records);
        setGivingRecordsLoading(false);
      },
      (error) => {
        console.error('Failed to load giving records:', error);
        setGivingRecords([]);
        setGivingRecordsLoading(false);
      }
    );
  }, [currentUser, emailVerificationRefreshKey]);

  useEffect(() => {
    if (!currentUser || currentUser.isAnonymous || currentUser.emailVerified !== true) {
      setTaxReceiptProfileLoaded(false);
      setTaxReceiptProfileReady(false);
      setTaxReceiptProfileMessage('');
      setTaxReceiptProfileForm({
        taxReceiptLegalName: '',
        taxReceiptAddress: EMPTY_TAX_RECEIPT_ADDRESS,
      });
      return undefined;
    }

    setTaxReceiptProfileLoaded(false);
    return subscribeToUserProfile(
      currentUser.uid,
      (profile) => {
        setTaxReceiptProfileReady(isTaxReceiptProfileComplete(profile));
        setTaxReceiptProfileForm({
          taxReceiptLegalName:
            profile?.taxReceiptLegalName
            || profile?.displayName
            || currentUser.displayName
            || '',
          taxReceiptAddress: profile?.taxReceiptAddress ?? EMPTY_TAX_RECEIPT_ADDRESS,
        });
        setTaxReceiptProfileLoaded(true);
      },
      (error) => {
        console.error('Failed to load tax receipt profile:', error);
        setTaxReceiptProfileReady(false);
        setTaxReceiptProfileLoaded(true);
      }
    );
  }, [currentUser, emailVerificationRefreshKey]);

  useEffect(() => {
    if (!currentUser || currentUser.isAnonymous || currentUser.emailVerified !== true) {
      setTaxReceiptRecords([]);
      setTaxReceiptRecordsLoading(false);
      return undefined;
    }

    setTaxReceiptRecordsLoading(true);
    return subscribeToUserTaxReceipts(
      currentUser.uid,
      (records) => {
        setTaxReceiptRecords(records);
        setTaxReceiptRecordsLoading(false);
      },
      (error) => {
        console.error('Failed to load tax receipt records:', error);
        setTaxReceiptRecords([]);
        setTaxReceiptRecordsLoading(false);
      }
    );
  }, [currentUser, emailVerificationRefreshKey]);

  useEffect(() => {
    if (!currentUser || currentUser.isAnonymous || currentUser.emailVerified !== true) {
      setAnnualTaxReceiptSummaries([]);
      setAnnualTaxReceiptSummariesLoading(false);
      return undefined;
    }

    setAnnualTaxReceiptSummariesLoading(true);
    return subscribeToUserAnnualTaxReceiptSummaries(
      currentUser.uid,
      (records) => {
        setAnnualTaxReceiptSummaries(records);
        setAnnualTaxReceiptSummariesLoading(false);
      },
      (error) => {
        console.error('Failed to load annual tax receipt summaries:', error);
        setAnnualTaxReceiptSummaries([]);
        setAnnualTaxReceiptSummariesLoading(false);
      }
    );
  }, [currentUser, emailVerificationRefreshKey]);

  useEffect(() => {
    if (!activeChurchId) {
      setActiveChurchTimezone('UTC');
      setActiveChurchDonationCurrency('USD');
      setActiveChurchTaxReceiptState('disabled');
      setActiveChurchTaxReceiptReady(false);
      return undefined;
    }

    return subscribeToChurch(activeChurchId, (church) => {
      const receiptState = getTaxReceiptIssuanceState(church?.taxReceiptSettings);
      setActiveChurchTimezone(church?.timezone || 'UTC');
      setActiveChurchDonationCurrency(donationCurrencyForChurchCountry(church?.country));
      setActiveChurchTaxReceiptState(church?.isActive === true ? receiptState : 'disabled');
      setActiveChurchTaxReceiptReady(church?.isActive === true && receiptState === 'ready');
    });
  }, [activeChurchId]);

  const receiptChurchIds = Array.from(new Set([
    activeChurchId,
    ...givingRecords.map((record) => record.churchId),
    ...taxReceiptRecords.map((receipt) => receipt.churchId),
    ...annualTaxReceiptSummaries.map((summary) => summary.churchId),
  ].filter((churchId): churchId is string => Boolean(churchId)))).sort();
  const receiptChurchIdsKey = receiptChurchIds.join('|');

  useEffect(() => {
    if (receiptChurchIds.length === 0) {
      setReceiptChurchStates({});
      return undefined;
    }

    const expectedChurchIds = new Set(receiptChurchIds);
    setReceiptChurchStates((current) => Object.fromEntries(
      Object.entries(current).filter(([churchId]) => expectedChurchIds.has(churchId))
    ));

    let canceled = false;
    const unsubscribers = receiptChurchIds.map((churchId) => subscribeToChurch(churchId, (church) => {
      if (canceled) {
        return;
      }
      const receiptState = getTaxReceiptIssuanceState(church?.taxReceiptSettings);
      setReceiptChurchStates((current) => ({
        ...current,
        [churchId]: {
          taxReceiptState: church?.isActive === true ? receiptState : 'disabled',
          taxReceiptReady: church?.isActive === true && receiptState === 'ready',
          timezone: church?.timezone || 'UTC',
        },
      }));
    }));

    return () => {
      canceled = true;
      unsubscribers.forEach((unsubscribe) => unsubscribe());
    };
  }, [receiptChurchIdsKey]);

  useEffect(() => {
    try {
      const raw = window.sessionStorage.getItem(PENDING_GIVING_STORAGE_KEY);
      if (!raw) {
        return;
      }

      const saved = parsePendingGivingCheckoutState(raw);
      if (!saved) {
        return;
      }

      if (saved.amount) {
        setAmount(saved.amount);
      }
      setGivingData((current) => ({
        ...current,
        fullName: saved.fullName ?? current.fullName,
        email: saved.email ?? current.email,
        purpose: saved.purpose ?? current.purpose,
        anonymous: saved.anonymous ?? current.anonymous,
      }));
    } catch (error) {
      console.warn(extra.restoreFailed, error);
    }
  }, [extra.restoreFailed]);

  useEffect(() => {
    const applyCheckoutState = async (search: string) => {
      const checkoutState = getGivingCheckoutState(search);
      const params = new URLSearchParams(search);
      const givingId = params.get('givingId');
      const sessionId = params.get('session_id');

      if (checkoutState === 'success') {
        if (!givingId) {
          setGivingPhase('payment');
          setCheckoutMessage(extra.confirmMissing);
          window.history.replaceState({}, '', '/');
          return;
        }
        const pending = parsePendingGivingCheckoutState(
          window.sessionStorage.getItem(PENDING_GIVING_STORAGE_KEY)
        );
        if (!checkoutReturnMatchesPendingGiving(pending, givingId, sessionId)) {
          setGivingPhase('payment');
          setCheckoutMessage(extra.confirmMissing);
          window.history.replaceState({}, '', '/');
          return;
        }

        setGivingPhase('payment');
        setCheckoutMessage(extra.confirming);
        const status = await waitForGivingStatus(givingId);
        if (status === 'completed') {
          window.sessionStorage.removeItem(PENDING_GIVING_STORAGE_KEY);
          setCheckoutMessage('');
          triggerSuccessCelebration();
        } else if (status === 'failed') {
          setCheckoutMessage(extra.stripeFailed);
        } else {
          setCheckoutMessage(extra.stillConfirming);
        }
        window.history.replaceState({}, '', '/');
        return;
      }

      if (checkoutState === 'cancel') {
        setGivingPhase('payment');
        setCheckoutMessage(extra.canceled);
        window.history.replaceState({}, '', '/');
      }
    };

    const handleNativeUrl = (event: Event) => {
      const snapshot = (event as CustomEvent<AppLocationSnapshot>).detail;
      void applyCheckoutState(snapshot.search);
    };

    void applyCheckoutState(window.location.search);
    window.addEventListener(APP_URL_OPENED_EVENT, handleNativeUrl as EventListener);

    return () => {
      window.removeEventListener(APP_URL_OPENED_EVENT, handleNativeUrl as EventListener);
    };
  }, [extra.canceled, extra.confirming, extra.confirmMissing, extra.stillConfirming, extra.stripeFailed]);

  const triggerSuccessCelebration = () => {
    setGivingPhase('success');
    confetti({
      particleCount: 150,
      spread: 70,
      origin: { y: 0.6 },
      colors: ['#800000', '#937022', '#FFFFFF']
    });
  };

  const amountCents = Math.round(Number.parseFloat(amount || '0') * 100);
  const taxReceiptStateForChurch = (churchId: string | null | undefined): TaxReceiptIssuanceState => {
    if (churchId && churchId === activeChurchId) {
      return activeChurchTaxReceiptState;
    }
    return churchId ? receiptChurchStates[churchId]?.taxReceiptState ?? 'disabled' : 'disabled';
  };
  const taxReceiptReadyForChurch = (churchId: string | null | undefined): boolean => {
    if (churchId && churchId === activeChurchId) {
      return activeChurchTaxReceiptReady;
    }
    return churchId ? receiptChurchStates[churchId]?.taxReceiptReady === true : false;
  };
  const receiptTimezoneForChurch = (churchId: string): string => (
    churchId === activeChurchId
      ? activeChurchTimezone
      : receiptChurchStates[churchId]?.timezone || 'UTC'
  );
  const receiptActionContextForChurch = (churchId: string) => ({
    activeChurchId: churchId,
    activeChurchTaxReceiptReady: taxReceiptReadyForChurch(churchId),
    activeChurchTaxReceiptUnsupported: taxReceiptStateForChurch(churchId) === 'unsupported_jurisdiction',
  });
  const taxReceiptProfileIncompleteOrSaving = Boolean(
    currentUser
    && !currentUser.isAnonymous
    && (!taxReceiptProfileLoaded || !taxReceiptProfileReady || taxReceiptProfileSaving)
  );
  const taxReceiptProfileBlocksReceiptIssuanceForChurch = (
    churchId: string | null | undefined
  ) => Boolean(taxReceiptReadyForChurch(churchId) && taxReceiptProfileIncompleteOrSaving);
  const taxReceiptProfileBlocksReceiptIssuance = Boolean(
    taxReceiptProfileBlocksReceiptIssuanceForChurch(activeChurchId)
  );
  const taxReceiptProfileBlocksCheckout = taxReceiptProfileBlocksReceiptIssuance;
  const taxReceiptProfileRequiredMessage =
    taxReceiptProfileLoaded ? extra.taxReceiptProfileRequired : extra.taxReceiptProfileChecking;
  const currentUserNeedsEmailVerification = Boolean(
    currentUser && !currentUser.isAnonymous && currentUser.emailVerified !== true
  );
  const checkoutPrerequisiteBlocked =
    currentUserNeedsEmailVerification || taxReceiptProfileBlocksCheckout;
  const checkoutPrerequisiteActionLabel = currentUserNeedsEmailVerification
    ? extra.emailVerificationContinueAction
    : taxReceiptProfileBlocksCheckout
      ? taxReceiptProfileLoaded
        ? extra.taxReceiptProfileRequiredAction
        : extra.taxReceiptProfileChecking
      : '';

  const handleSendEmailVerification = async () => {
    if (!currentUser || currentUser.isAnonymous) {
      setEmailVerificationMessage(extra.signInRequired);
      return;
    }

    setEmailVerificationSending(true);
    setEmailVerificationMessage('');
    try {
      const result = await sendAccountEmailVerification(currentUser);
      await currentUser.reload().catch(() => undefined);
      setEmailVerificationRefreshKey((current) => current + 1);
      setEmailVerificationMessage(
        result.alreadyVerified || currentUser.emailVerified === true
          ? extra.emailVerificationConfirmed
          : extra.emailVerificationSent
      );
    } catch (error) {
      if (firebaseAuthErrorCode(error) === 'auth/too-many-requests') {
        console.warn('Email verification send rate-limited:', error);
        setEmailVerificationMessage(extra.emailVerificationStillPending);
      } else {
        console.error('Failed to send email verification:', error);
        setEmailVerificationMessage(extra.emailVerificationSendFailed);
      }
    } finally {
      setEmailVerificationSending(false);
    }
  };

  const handleCheckEmailVerification = async () => {
    if (!currentUser || currentUser.isAnonymous) {
      setEmailVerificationMessage(extra.signInRequired);
      return;
    }

    setEmailVerificationChecking(true);
    setEmailVerificationMessage('');
    try {
      await currentUser.reload();
      setEmailVerificationRefreshKey((current) => current + 1);
      setEmailVerificationMessage(
        currentUser.emailVerified === true
          ? extra.emailVerificationConfirmed
          : extra.emailVerificationStillPending
      );
    } catch (error) {
      console.error('Failed to refresh email verification state:', error);
      setEmailVerificationMessage(extra.emailVerificationCheckFailed);
    } finally {
      setEmailVerificationChecking(false);
    }
  };

  const blockUntilEmailVerified = (setPrimaryMessage: (message: string) => void): boolean => {
    if (!currentUserNeedsEmailVerification) {
      return false;
    }
    setEmailVerificationMessage(extra.emailVerificationRequired);
    setPrimaryMessage(extra.emailVerificationRequired);
    return true;
  };

  const donorReceiptDeliveryErrorMessage = (
    errorCode: unknown,
    churchId: string | null | undefined = activeChurchId
  ): string => {
    if (
      safeReceiptErrorCode(errorCode) === TAX_RECEIPT_DONOR_PROFILE_INCOMPLETE_CODE
      && !taxReceiptProfileBlocksReceiptIssuanceForChurch(churchId)
    ) {
      return '';
    }
    return receiptDeliveryErrorMessage(errorCode, receiptDeliveryErrorMessages);
  };

  const setTaxReceiptAddressField = (field: keyof TaxReceiptAddress, value: string) => {
    setTaxReceiptProfileMessage('');
    setTaxReceiptProfileForm((current) => ({
      ...current,
      taxReceiptAddress: {
        ...current.taxReceiptAddress,
        [field]: value,
      },
    }));
  };

  const handleSaveTaxReceiptProfile = async () => {
    if (!currentUser || currentUser.isAnonymous) {
      setTaxReceiptProfileMessage(extra.signInRequired);
      return;
    }
    if (!isTaxReceiptProfileComplete(taxReceiptProfileForm)) {
      setTaxReceiptProfileMessage(extra.taxReceiptProfileIncomplete);
      return;
    }

    setTaxReceiptProfileSaving(true);
    setTaxReceiptProfileMessage('');
    try {
      await updateUserTaxReceiptProfile(currentUser.uid, taxReceiptProfileForm);
      setTaxReceiptProfileReady(true);
      setTaxReceiptProfileMessage(extra.taxReceiptProfileSaved);
    } catch (error) {
      console.error('Failed to save tax receipt profile:', error);
      setTaxReceiptProfileMessage(extra.taxReceiptProfileSaveFailed);
    } finally {
      setTaxReceiptProfileSaving(false);
    }
  };

  const handleCheckout = async () => {
    if (!currentUser || currentUser.isAnonymous) {
      setCheckoutMessage(extra.signInRequired);
      return;
    }
    if (!activeChurchId) {
      setCheckoutMessage(extra.joinRequired);
      return;
    }
    if (blockUntilEmailVerified(setCheckoutMessage)) {
      setGivingPhase('details');
      return;
    }
    if (!Number.isFinite(amountCents) || !amountCents || amountCents < 50 || amountCents > 1_000_000) {
      setCheckoutMessage(extra.invalidAmount);
      return;
    }
    if (taxReceiptProfileBlocksCheckout) {
      setTaxReceiptProfileMessage(taxReceiptProfileRequiredMessage);
      setGivingPhase('details');
      return;
    }

    setCheckoutLoading(true);
    setCheckoutMessage('');
    try {
      const pendingGiving: PendingGivingCheckoutState = {
        amount,
        currency: activeChurchDonationCurrency,
        fullName: givingData.fullName,
        email: givingData.email,
        purpose: givingData.purpose,
        anonymous: givingData.anonymous,
      };
      window.sessionStorage.setItem(
        PENDING_GIVING_STORAGE_KEY,
        JSON.stringify(pendingGiving)
      );
      const result = await createGivingCheckoutSession({
        churchId: activeChurchId,
        amountCents,
        currency: activeChurchDonationCurrency,
        purpose: givingData.purpose,
        anonymous: givingData.anonymous,
        donorName: givingData.fullName,
      });
      window.sessionStorage.setItem(
        PENDING_GIVING_STORAGE_KEY,
        JSON.stringify({
          ...pendingGiving,
          givingId: result.givingId,
          sessionId: result.sessionId,
        })
      );
      await openExternalUrl(assertStripeCheckoutUrl(result.checkoutUrl, extra.unexpectedCheckoutUrl));
    } catch (error) {
      console.error('Failed to start checkout:', error);
      setCheckoutMessage(extra.unableCheckout);
      window.sessionStorage.removeItem(PENDING_GIVING_STORAGE_KEY);
    } finally {
      setCheckoutLoading(false);
    }
  };

  const handleSendTaxReceipt = async (
    givingId: string,
    corrected = false,
    requiresReceiptProfile = false,
    receiptChurchId: string | null | undefined = activeChurchId
  ) => {
    if (blockUntilEmailVerified(setReceiptMessage)) {
      return;
    }
    if (requiresReceiptProfile && taxReceiptProfileBlocksReceiptIssuanceForChurch(receiptChurchId)) {
      setTaxReceiptProfileMessage(taxReceiptProfileRequiredMessage);
      setReceiptMessage(taxReceiptProfileRequiredMessage);
      return;
    }

    setSendingReceiptId(givingId);
    setReceiptMessage('');
    try {
      const result = corrected
        ? await sendCorrectedTaxReceipt({ givingId })
        : await sendTaxReceipt({ givingId });
      setReceiptMessage(corrected ? extra.correctedTaxReceiptSentNotice : extra.taxReceiptSentNotice);
      try {
        const receipt = await getTaxReceipt(result.receiptId);
        if (receipt) {
          setSelectedReceipt(receipt);
        }
      } catch (loadError) {
        console.error('Failed to load tax receipt after sending:', loadError);
      }
    } catch (error) {
      console.error('Failed to send tax receipt:', error);
      setReceiptMessage(callableReceiptDeliveryErrorMessage(error, receiptDeliveryErrorMessages));
    } finally {
      setSendingReceiptId(null);
    }
  };

  const handleViewTaxReceipt = async (receiptId: string) => {
    setLoadingReceiptId(receiptId);
    setReceiptMessage('');
    try {
      const receipt = await getTaxReceipt(receiptId);
      if (!receipt) {
        setReceiptMessage(extra.taxReceiptLoadError);
        return;
      }
      setSelectedReceipt(receipt);
    } catch (error) {
      console.error('Failed to load tax receipt:', error);
      setReceiptMessage(extra.taxReceiptLoadError);
    } finally {
      setLoadingReceiptId(null);
    }
  };

  const handleSendAnnualTaxReceipt = async (
    churchId: string,
    year: number,
    corrected = false,
    acknowledgePreviouslyReceipted = false,
    requiresReceiptProfile = false
  ) => {
    if (!churchId) {
      setReceiptMessage(extra.joinRequired);
      return;
    }
    if (blockUntilEmailVerified(setReceiptMessage)) {
      return;
    }
    if (requiresReceiptProfile && taxReceiptProfileBlocksReceiptIssuanceForChurch(churchId)) {
      setTaxReceiptProfileMessage(taxReceiptProfileRequiredMessage);
      setReceiptMessage(taxReceiptProfileRequiredMessage);
      return;
    }

    const annualKey = `${churchId}:${year}`;
    setSendingAnnualReceiptKey(annualKey);
    setReceiptMessage('');
    try {
      const result = corrected
        ? await sendCorrectedAnnualTaxReceipt({ churchId, year, acknowledgePreviouslyReceipted })
        : await sendAnnualTaxReceipt({ churchId, year, acknowledgePreviouslyReceipted });
      setReceiptMessage(
        corrected ? extra.correctedAnnualTaxReceiptSentNotice : extra.annualTaxReceiptSentNotice
      );
      try {
        const receipt = await getTaxReceipt(result.receiptId);
        if (receipt) {
          setSelectedReceipt(receipt);
        }
      } catch (loadError) {
        console.error('Failed to load annual tax receipt after sending:', loadError);
      }
    } catch (error) {
      console.error('Failed to send annual tax receipt:', error);
      setReceiptMessage(callableReceiptDeliveryErrorMessage(error, receiptDeliveryErrorMessages));
    } finally {
      setSendingAnnualReceiptKey(null);
      setPendingAnnualReceiptAck(null);
    }
  };

  const confirmDonorAnnualReceiptSend = (
    churchId: string,
    year: number,
    corrected: boolean,
    needsPreviouslyReceiptedAcknowledgement: boolean,
    requiresReceiptProfile: boolean
  ) => {
    if (blockUntilEmailVerified(setReceiptMessage)) {
      return;
    }
    if (requiresReceiptProfile && taxReceiptProfileBlocksReceiptIssuanceForChurch(churchId)) {
      setTaxReceiptProfileMessage(taxReceiptProfileRequiredMessage);
      setReceiptMessage(taxReceiptProfileRequiredMessage);
      return;
    }

    const annualKey = `${churchId}:${year}`;
    if (
      needsPreviouslyReceiptedAcknowledgement
      && (
        pendingAnnualReceiptAck?.key !== annualKey
        || pendingAnnualReceiptAck.corrected !== corrected
      )
    ) {
      setPendingAnnualReceiptAck({ key: annualKey, corrected });
      setReceiptMessage(extra.taxReceiptPreviouslyReceiptedAckRequired);
      return;
    }

    setPendingAnnualReceiptAck(null);
    void handleSendAnnualTaxReceipt(
      churchId,
      year,
      corrected,
      needsPreviouslyReceiptedAcknowledgement,
      requiresReceiptProfile
    );
  };

  const taxReceiptActionBlocked = (receipt: FirestoreTaxReceiptRecord): boolean => (
    donorTaxReceiptActionAvailability(receipt, receiptActionContextForChurch(receipt.churchId)).actionBlocked
  );

  const blockedTaxReceiptMessage = (receipt: FirestoreTaxReceiptRecord): string => {
    const receiptAction = donorTaxReceiptActionAvailability(receipt, receiptActionContextForChurch(receipt.churchId));
    if (receiptAction.unsupportedJurisdiction) {
      return extra.taxReceiptUnsupportedJurisdiction;
    }
    if (receiptAction.missingAssignedReceiptNumber) {
      return extra.taxReceiptGenericIssue;
    }
    if (receiptAction.invalidCurrency) {
      return extra.taxReceiptGenericIssue;
    }
    return receipt.status === 'voided'
      ? extra.taxReceiptVoidedWarning
      : extra.taxReceiptCorrectionWarning;
  };

  const taxReceiptIsCorrected = (receipt: FirestoreTaxReceiptRecord | undefined): boolean => Boolean(
    receipt
    && (
      receipt.correctionForReceiptId
      || receipt.correctionSourceReason
      || receipt.correctedAt
      || (
        typeof receipt.originalAmountCents === 'number'
        && typeof receipt.refundedAmountCents === 'number'
        && receipt.originalAmountCents > receipt.eligibleAmountCents
        && receipt.refundedAmountCents > 0
      )
    )
  );

  const handlePrintTaxReceipt = () => {
    if (!selectedReceipt) {
      return;
    }
    if (taxReceiptActionBlocked(selectedReceipt)) {
      setReceiptMessage(blockedTaxReceiptMessage(selectedReceipt));
      return;
    }

    document.body.classList.add('tax-receipt-printing');
    const cleanup = () => {
      document.body.classList.remove('tax-receipt-printing');
      window.removeEventListener('afterprint', cleanup);
    };
    window.addEventListener('afterprint', cleanup);
    window.print();
    window.setTimeout(cleanup, 1000);
  };

  const savePdfAttachment = (filename: string, content: string, contentType: string) => {
    const byteCharacters = window.atob(content);
    const byteArrays: Uint8Array[] = [];
    for (let offset = 0; offset < byteCharacters.length; offset += 1024) {
      const slice = byteCharacters.slice(offset, offset + 1024);
      const bytes = new Uint8Array(slice.length);
      for (let index = 0; index < slice.length; index += 1) {
        bytes[index] = slice.charCodeAt(index);
      }
      byteArrays.push(bytes);
    }

    const blob = new Blob(byteArrays, { type: contentType });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename || 'tax-receipt.pdf';
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(url);
  };

  const handleDownloadTaxReceipt = async (receiptId: string) => {
    if (selectedReceipt?.id === receiptId && taxReceiptActionBlocked(selectedReceipt)) {
      setReceiptMessage(blockedTaxReceiptMessage(selectedReceipt));
      return;
    }
    if (blockUntilEmailVerified(setReceiptMessage)) {
      return;
    }

    setDownloadingReceiptId(receiptId);
    setReceiptMessage('');
    try {
      const attachment = await downloadTaxReceiptPdf({ receiptId });
      savePdfAttachment(attachment.filename, attachment.content, attachment.contentType);
    } catch (error) {
      console.error('Failed to download tax receipt:', error);
      setReceiptMessage(callableReceiptDeliveryErrorMessage(error, receiptDownloadErrorMessages));
    } finally {
      setDownloadingReceiptId(null);
    }
  };

  const formatGivingAmount = (record: FirestoreGivingRecord) => (
    new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: displayTaxReceiptCurrency(record.currency, activeChurchDonationCurrency),
    }).format(record.amountCents / 100)
  );

  const formatGivingDate = (record: FirestoreGivingRecord) => (
    (() => {
      const date = record.completedAt ?? record.createdAt;
      return date
        ? date.toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
          })
        : '-';
    })()
  );

  const formatTaxReceiptDate = (receipt: FirestoreTaxReceiptRecord) => {
    const date = receipt.receivedAt ?? receipt.issuedAt;
    return date
      ? date.toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
        })
      : '-';
  };

  const receiptStatusLabel = (record: FirestoreGivingRecord, coveredByAnnualReceipt = false): string => {
    const recordTaxReceiptState = taxReceiptStateForChurch(record.churchId);
    const recordTaxReceiptReady = taxReceiptReadyForChurch(record.churchId);
    const recordUnsupportedJurisdiction =
      record.taxReceiptError === TAX_RECEIPT_UNSUPPORTED_JURISDICTION_CODE
      || record.taxReceiptEmailError === TAX_RECEIPT_UNSUPPORTED_JURISDICTION_CODE
      || recordTaxReceiptState === 'unsupported_jurisdiction';
    const recordInvalidCurrency = !normalizedTaxReceiptCurrency(record.currency);
    const unavailableLabel = (
      recordUnsupportedJurisdiction
    )
      ? extra.taxReceiptUnsupportedJurisdiction
      : extra.taxReceiptUnavailable;
    if (coveredByAnnualReceipt) return extra.taxReceiptIncludedInAnnual;
    if (record.taxReceiptStatus === 'voided') return extra.taxReceiptVoided;
    if (recordUnsupportedJurisdiction) return extra.taxReceiptUnsupportedJurisdiction;
    if (recordInvalidCurrency) return extra.taxReceiptError;
    if (record.taxReceiptStatus === 'error' || record.taxReceiptCorrectionRequired || record.taxReceiptCorrectionReason) {
      return extra.taxReceiptError;
    }
    if (record.taxReceiptStatus === 'sent') return extra.taxReceiptSent;
    if (record.taxReceiptStatus === 'issued') return extra.taxReceiptIssued;
    if (record.taxReceiptStatus === 'ready') {
      if (
        taxReceiptProfileBlocksReceiptIssuanceForChurch(record.churchId)
        && (
          record.taxReceiptError === TAX_RECEIPT_DONOR_PROFILE_INCOMPLETE_CODE
          || record.taxReceiptEmailError === TAX_RECEIPT_DONOR_PROFILE_INCOMPLETE_CODE
        )
      ) {
        return extra.taxReceiptProfileNeeded;
      }
      return recordTaxReceiptReady
        ? extra.taxReceiptAvailable
        : unavailableLabel;
    }
    if (record.taxReceiptStatus === 'not_configured') {
      return recordTaxReceiptReady
        ? extra.taxReceiptAvailable
        : unavailableLabel;
    }
    if (record.status === 'refunded') return extra.taxReceiptRefunded;
    if (
      record.status === 'completed'
      && !recordTaxReceiptReady
    ) {
      return unavailableLabel;
    }
    if (record.status === 'completed') {
      return recordTaxReceiptReady
        ? extra.taxReceiptAvailable
        : unavailableLabel;
    }
    return extra.taxReceiptPending;
  };

  const taxReceiptStatusLabel = (receipt: FirestoreTaxReceiptRecord): string => {
    const receiptAction = donorTaxReceiptActionAvailability(
      receipt,
      receiptActionContextForChurch(receipt.churchId)
    );
    if (receiptAction.unsupportedJurisdiction) return extra.taxReceiptUnsupportedJurisdiction;
    if (receiptAction.missingAssignedReceiptNumber) return extra.taxReceiptGenericIssue;
    if (receiptAction.invalidCurrency) return extra.taxReceiptError;
    if (receipt.status === 'voided') return extra.taxReceiptVoided;
    if (receipt.correctionRequired || receipt.correctionReason || receipt.status === 'error') {
      return extra.taxReceiptError;
    }
    if (receipt.status === 'sent') return extra.taxReceiptSent;
    if (receipt.status === 'issued') return extra.taxReceiptIssued;
    return extra.taxReceiptPending;
  };

  const formatReceiptAmount = (
    amountCents: number,
    currency: string
  ) => formatTaxReceiptAmount(amountCents, currency);

  const renderTaxReceiptDetail = () => {
    if (!selectedReceipt) return null;
    const {
      unsupportedJurisdiction: receiptUnsupportedJurisdiction,
      missingAssignedReceiptNumber: receiptMissingAssignedReceiptNumber,
      invalidCurrency: receiptInvalidCurrency,
      needsReview: receiptNeedsReview,
      actionBlocked: receiptActionBlocked,
    } = donorTaxReceiptActionAvailability(selectedReceipt, receiptActionContextForChurch(selectedReceipt.churchId));
    const receiptDeliveryHelp = receiptUnsupportedJurisdiction
      ? extra.taxReceiptUnsupportedJurisdiction
      : receiptMissingAssignedReceiptNumber || receiptInvalidCurrency
        ? extra.taxReceiptGenericIssue
      : donorReceiptDeliveryErrorMessage(selectedReceipt.emailError, selectedReceipt.churchId);
    const receiptDetailLabel = receiptUnsupportedJurisdiction
      ? extra.taxReceiptUnsupportedJurisdiction
      : extra.officialTaxReceipt;
    const receiptIsCorrected = Boolean(
      selectedReceipt.correctionSourceReason
      || selectedReceipt.correctedAt
      || ((selectedReceipt.originalAmountCents ?? 0) > 0 && (selectedReceipt.refundedAmountCents ?? 0) > 0)
    );

    return (
      <div className="fixed inset-0 z-[220] flex items-end justify-center bg-black/60 px-4 py-6 backdrop-blur-sm sm:items-center">
        <div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-[28px] bg-white shadow-2xl">
          <div className="tax-receipt-print bg-white p-6 sm:p-8">
            <div className="tax-receipt-no-print mb-6 flex items-start justify-between gap-4 border-b border-gray-100 pb-5">
              <div>
                <span className="mb-2 block text-[10px] font-black uppercase tracking-[0.2em] text-[#937022]">
                  {receiptDetailLabel}
                </span>
                <h2 className="text-2xl font-black tracking-tight text-gray-900">
                  {extra.receiptDetailsTitle}
                </h2>
                <p className="mt-1 text-sm font-medium text-gray-500">{extra.receiptDetailsSub}</p>
              </div>
              <button
                onClick={() => setSelectedReceipt(null)}
                className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-gray-50 text-gray-400 hover:bg-gray-100"
                aria-label={extra.closeReceipt}
                title={extra.closeReceipt}
              >
                <X size={18} />
              </button>
            </div>

            <div className="mb-8 border-b-2 border-gray-900 pb-6">
              <p className="text-[10px] font-black uppercase tracking-[0.2em] text-[#937022]">
                {receiptDetailLabel}
              </p>
              <h3 className="mt-2 text-3xl font-black tracking-tight text-gray-900">
                {selectedReceipt.organizationName || selectedReceipt.churchName}
              </h3>
              {selectedReceipt.organizationAddress && (
                <p className="mt-2 whitespace-pre-line text-sm font-medium leading-relaxed text-gray-500">
                  {selectedReceipt.organizationAddress}
                </p>
              )}
              {selectedReceipt.organizationTaxId && (
                <p className="mt-2 text-sm font-bold text-gray-700">
                  {extra.taxId}: {selectedReceipt.organizationTaxId}
                </p>
              )}
            </div>

            {selectedReceipt.status === 'voided' && (
              <p className="mb-6 rounded-2xl bg-red-50 p-4 text-xs font-bold leading-relaxed text-red-700">
                {extra.taxReceiptVoidedWarning}
              </p>
            )}
            {receiptNeedsReview && (
              <p className="mb-6 rounded-2xl bg-amber-50 p-4 text-xs font-bold leading-relaxed text-amber-700">
                {extra.taxReceiptCorrectionWarning}
              </p>
            )}
            {receiptIsCorrected && !receiptNeedsReview && selectedReceipt.status !== 'voided' && (
              <p className="mb-6 rounded-2xl bg-blue-50 p-4 text-xs font-bold leading-relaxed text-blue-700">
                {extra.taxReceiptCorrectedWarning}
              </p>
            )}
            {receiptDeliveryHelp && (
              <p className="mb-6 rounded-2xl bg-amber-50 p-4 text-xs font-bold leading-relaxed text-amber-700">
                {receiptDeliveryHelp}
              </p>
            )}

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="rounded-2xl bg-gray-50 p-4">
                <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">
                  {extra.receiptNumber}
                </p>
                <p className="mt-1 text-sm font-black text-gray-900">
                  {selectedReceipt.receiptNumber || '-'}
                </p>
              </div>
              <div className="rounded-2xl bg-gray-50 p-4">
                <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">
                  {extra.issuedDate}
                </p>
                <p className="mt-1 text-sm font-black text-gray-900">
                  {selectedReceipt.issuedDateLabel || '-'}
                </p>
              </div>
              <div className="rounded-2xl bg-gray-50 p-4">
                <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">
                  {extra.donor}
                </p>
                <p className="mt-1 text-sm font-black text-gray-900">{selectedReceipt.donorName}</p>
                <p className="mt-1 break-all text-xs font-bold text-gray-500">{selectedReceipt.donorEmail}</p>
                {selectedReceipt.donorAddress && (
                  <p className="mt-2 text-xs font-bold leading-relaxed text-gray-500">
                    {selectedReceipt.donorAddress}
                  </p>
                )}
              </div>
              <div className="rounded-2xl bg-gray-50 p-4">
                <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">
                  {extra.receivedDate}
                </p>
                <p className="mt-1 text-sm font-black text-gray-900">
                  {selectedReceipt.receivedDateLabel || '-'}
                </p>
              </div>
              <div className="rounded-2xl bg-gray-50 p-4">
                <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">
                  {extra.amount}
                </p>
                <p className="mt-1 text-sm font-black text-gray-900">
                  {formatReceiptAmount(selectedReceipt.amountCents, selectedReceipt.currency)}
                </p>
              </div>
              <div className="rounded-2xl bg-gray-50 p-4">
                <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">
                  {extra.eligibleAmount}
                </p>
                <p className="mt-1 text-sm font-black text-gray-900">
                  {formatReceiptAmount(selectedReceipt.eligibleAmountCents, selectedReceipt.currency)}
                </p>
              </div>
              {(selectedReceipt.originalAmountCents ?? 0) > 0 && (
                <div className="rounded-2xl bg-gray-50 p-4">
                  <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">
                    {extra.taxReceiptOriginalAmount}
                  </p>
                  <p className="mt-1 text-sm font-black text-gray-900">
                    {formatReceiptAmount(selectedReceipt.originalAmountCents ?? 0, selectedReceipt.currency)}
                  </p>
                </div>
              )}
              {(selectedReceipt.refundedAmountCents ?? 0) > 0 && (
                <div className="rounded-2xl bg-gray-50 p-4">
                  <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">
                    {extra.taxReceiptRefundedAmount}
                  </p>
                  <p className="mt-1 text-sm font-black text-gray-900">
                    {formatReceiptAmount(selectedReceipt.refundedAmountCents ?? 0, selectedReceipt.currency)}
                  </p>
                </div>
              )}
            </div>

            <div className="mt-6 rounded-2xl border border-gray-100 p-4">
              <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">
                {extra.purpose}
              </p>
              <p className="mt-1 text-sm font-bold text-gray-900">{selectedReceipt.purpose}</p>
            </div>

            {selectedReceipt.kind === 'annual' && (
              <>
                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  <div className="rounded-2xl border border-gray-100 p-4">
                    <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">
                      {extra.coveredPeriod}
                    </p>
                    <p className="mt-1 text-sm font-bold text-gray-900">
                      {selectedReceipt.coveredPeriodLabel || selectedReceipt.receivedDateLabel}
                    </p>
                  </div>
                  <div className="rounded-2xl border border-gray-100 p-4">
                    <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">
                      {extra.contributionsIncluded}
                    </p>
                    <p className="mt-1 text-sm font-bold text-gray-900">
                      {selectedReceipt.donationCount ?? '-'}
                    </p>
                  </div>
                </div>
                {selectedReceipt.contributions.length > 0 && (
                  <div className="mt-4 rounded-2xl border border-gray-100 p-4">
                    <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">
                      {extra.contributionDetail}
                    </p>
                    <div className="mt-3 divide-y divide-gray-100">
                      {selectedReceipt.contributions.map((contribution, index) => (
                        <div
                          key={`${contribution.dateLabel}-${contribution.purpose}-${index}`}
                          className="grid gap-2 py-3 text-xs font-bold text-gray-600 sm:grid-cols-[1fr_1.3fr_auto_auto] sm:items-start"
                        >
                          <div>
                            <p className="text-[9px] font-black uppercase tracking-widest text-gray-400">
                              {extra.contributionDate}
                            </p>
                            <p className="mt-1 text-gray-900">{contribution.dateLabel || '-'}</p>
                          </div>
                          <div>
                            <p className="text-[9px] font-black uppercase tracking-widest text-gray-400">
                              {extra.purpose}
                            </p>
                            <p className="mt-1">{contribution.purpose}</p>
                          </div>
                          <div>
                            <p className="text-[9px] font-black uppercase tracking-widest text-gray-400">
                              {extra.amount}
                            </p>
                            <p className="mt-1">{formatReceiptAmount(contribution.amountCents, contribution.currency)}</p>
                          </div>
                          <div>
                            <p className="text-[9px] font-black uppercase tracking-widest text-gray-400">
                              {extra.eligibleAmount}
                            </p>
                            <p className="mt-1 text-gray-900">
                              {formatReceiptAmount(contribution.eligibleAmountCents, contribution.currency)}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}

            <div className="mt-4 rounded-2xl border border-gray-100 p-4">
              <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">
                {extra.goodsServicesStatement}
              </p>
              <p className="mt-2 text-sm font-medium leading-relaxed text-gray-600">
                {selectedReceipt.goodsServicesStatement}
              </p>
            </div>

            {selectedReceipt.duplicateClaimWarning && (
              <p className="mt-4 rounded-2xl bg-amber-50 p-4 text-xs font-bold leading-relaxed text-amber-700">
                {selectedReceipt.duplicateClaimWarning}
              </p>
            )}

            <div className="tax-receipt-no-print mt-6 flex flex-col gap-3 sm:flex-row">
              {!receiptActionBlocked && (
                <>
                  <button
                    onClick={() => void handleDownloadTaxReceipt(selectedReceipt.id)}
                    disabled={downloadingReceiptId === selectedReceipt.id}
                    className="flex h-12 flex-1 items-center justify-center gap-2 rounded-2xl bg-[#800000] px-4 text-[10px] font-black uppercase tracking-widest text-white hover:bg-[#8D1212] disabled:opacity-50"
                  >
                    {downloadingReceiptId === selectedReceipt.id ? (
                      <Loader2 size={15} className="animate-spin" />
                    ) : (
                      <Download size={15} />
                    )}
                    {extra.downloadTaxReceipt}
                  </button>
                  <button
                    onClick={handlePrintTaxReceipt}
                    className="flex h-12 flex-1 items-center justify-center gap-2 rounded-2xl bg-gray-900 px-4 text-[10px] font-black uppercase tracking-widest text-white hover:bg-[#800000]"
                  >
                    <Printer size={15} />
                    {extra.printTaxReceipt}
                  </button>
                </>
              )}
              <button
                onClick={() => setSelectedReceipt(null)}
                className="flex h-12 flex-1 items-center justify-center rounded-2xl bg-gray-50 px-4 text-[10px] font-black uppercase tracking-widest text-gray-500 hover:bg-gray-100"
              >
                {extra.closeReceipt}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  };

  const receiptGivingRecords = givingRecords;
  const singleTaxReceipts = taxReceiptRecords.filter((receipt) => receipt.kind === 'single');
  const singleTaxReceiptByGivingId = new Map<string, FirestoreTaxReceiptRecord>();
  singleTaxReceipts.forEach((receipt) => {
    if (receipt.givingId && !singleTaxReceiptByGivingId.has(receipt.givingId)) {
      singleTaxReceiptByGivingId.set(receipt.givingId, receipt);
    }
  });
  const visibleGivingIds = new Set(receiptGivingRecords.map((record) => record.id));
  const visibleTaxReceiptIds = new Set(
    receiptGivingRecords
      .flatMap((record) => [
        record.taxReceiptId,
        singleTaxReceiptByGivingId.get(record.id)?.id ?? '',
      ])
      .filter(Boolean)
  );
  const standaloneSingleTaxReceipts = singleTaxReceipts.filter(
    (receipt) => !visibleTaxReceiptIds.has(receipt.id) && !visibleGivingIds.has(receipt.givingId)
  );
  const annualRows = donorAnnualReceiptRows({
    givingRecords,
    taxReceiptRecords,
    annualSummaries: annualTaxReceiptSummaries,
    churchTimezoneForChurch: receiptTimezoneForChurch,
  });
  const annualCoveredGivingIds = new Set(
    taxReceiptRecords.flatMap((receipt) => {
      if (
        receipt.kind !== 'annual'
        || receipt.status === 'voided'
        || receipt.correctionRequired === true
        || receipt.correctionReason
      ) {
        return [];
      }
      return receipt.givingIds;
    })
  );
  const receiptHistoryLoading =
    givingRecordsLoading || taxReceiptRecordsLoading || annualTaxReceiptSummariesLoading;
  const receiptHistoryHasEntries =
    receiptGivingRecords.length > 0 || standaloneSingleTaxReceipts.length > 0 || annualRows.length > 0;
  const hasReceiptReadyChurch = receiptChurchIds.some((churchId) => taxReceiptReadyForChurch(churchId));
  const showTaxReceiptProfilePrompt =
    hasReceiptReadyChurch
    && currentUser !== null
    && currentUser !== undefined
    && !currentUser.isAnonymous
    && currentUser.emailVerified === true;
  const renderEmailVerificationPrompt = (className = '') => {
    if (!currentUserNeedsEmailVerification) {
      return null;
    }

    return (
      <div className={`${className} rounded-2xl border border-amber-100 bg-amber-50 p-4`}>
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-700">
            <Mail size={17} />
          </div>
          <div className="min-w-0 flex-1">
            <h4 className="text-xs font-black uppercase tracking-widest text-gray-900">
              {extra.emailVerificationTitle}
            </h4>
            <p className="mt-1 text-xs font-bold leading-relaxed text-gray-600">
              {extra.emailVerificationRequired}
            </p>
            {emailVerificationMessage && (
              <p className="mt-2 text-xs font-bold leading-relaxed text-amber-700">
                {emailVerificationMessage}
              </p>
            )}
          </div>
        </div>
        <div className="mt-4 flex flex-col gap-2 sm:flex-row">
          <button
            type="button"
            onClick={() => void handleSendEmailVerification()}
            disabled={emailVerificationSending || emailVerificationChecking}
            className="flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-gray-900 px-4 text-[10px] font-black uppercase tracking-widest text-white transition-all hover:bg-[#800000] disabled:opacity-50 sm:w-auto"
          >
            {emailVerificationSending ? <Loader2 size={14} className="animate-spin" /> : <Mail size={14} />}
            {emailVerificationSending ? extra.emailVerificationSending : extra.emailVerificationRequiredAction}
          </button>
          <button
            type="button"
            onClick={() => void handleCheckEmailVerification()}
            disabled={emailVerificationSending || emailVerificationChecking}
            className="flex h-10 w-full items-center justify-center gap-2 rounded-xl border border-amber-200 bg-white px-4 text-[10px] font-black uppercase tracking-widest text-amber-800 transition-all hover:border-amber-300 hover:bg-amber-100 disabled:opacity-50 sm:w-auto"
          >
            {emailVerificationChecking ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
            {emailVerificationChecking ? extra.emailVerificationChecking : extra.emailVerificationCheckAction}
          </button>
        </div>
      </div>
    );
  };
  const renderTaxReceiptProfilePrompt = (showReadyState: boolean, className = '') => {
    if (!showTaxReceiptProfilePrompt || (!showReadyState && taxReceiptProfileLoaded && taxReceiptProfileReady)) {
      return null;
    }

    return (
      <div
        className={`${className} rounded-2xl border p-4 ${
          taxReceiptProfileLoaded && taxReceiptProfileReady
            ? 'border-emerald-100 bg-emerald-50'
            : 'border-amber-100 bg-amber-50'
        }`}
      >
        <div className="flex items-start gap-3">
          <div
            className={`mt-0.5 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl ${
              taxReceiptProfileLoaded && taxReceiptProfileReady
                ? 'bg-emerald-100 text-emerald-700'
                : 'bg-amber-100 text-amber-700'
            }`}
          >
            {taxReceiptProfileLoaded ? <ReceiptText size={17} /> : <Loader2 size={17} className="animate-spin" />}
          </div>
          <div className="min-w-0 flex-1">
            <h4 className="text-xs font-black uppercase tracking-widest text-gray-900">
              {extra.taxReceiptProfileTitle}
            </h4>
            <p className="mt-1 text-xs font-bold leading-relaxed text-gray-600">
              {!taxReceiptProfileLoaded
                ? extra.taxReceiptProfileChecking
                : taxReceiptProfileReady
                  ? extra.taxReceiptProfileReady
                  : extra.taxReceiptProfileMissing}
            </p>
          </div>
        </div>
        {taxReceiptProfileLoaded && !taxReceiptProfileReady && (
          <div className="mt-4 space-y-3">
            <div className="space-y-2">
              <label className="text-[10px] font-black uppercase tracking-widest text-gray-500">
                {profileExtra.taxReceiptLegalName}
              </label>
              <input
                type="text"
                value={taxReceiptProfileForm.taxReceiptLegalName}
                onChange={(event) => {
                  setTaxReceiptProfileMessage('');
                  setTaxReceiptProfileForm((current) => ({
                    ...current,
                    taxReceiptLegalName: event.target.value,
                  }));
                }}
                className="h-11 w-full rounded-xl border-none bg-white px-4 text-sm font-bold text-gray-900 shadow-sm focus:ring-2 focus:ring-[#800000]/20"
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2 sm:col-span-2">
                <label className="text-[10px] font-black uppercase tracking-widest text-gray-500">
                  {profileExtra.taxReceiptAddressLine1}
                </label>
                <input
                  type="text"
                  value={taxReceiptProfileForm.taxReceiptAddress.line1}
                  onChange={(event) => setTaxReceiptAddressField('line1', event.target.value)}
                  className="h-11 w-full rounded-xl border-none bg-white px-4 text-sm font-bold text-gray-900 shadow-sm focus:ring-2 focus:ring-[#800000]/20"
                />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <label className="text-[10px] font-black uppercase tracking-widest text-gray-500">
                  {profileExtra.taxReceiptAddressLine2}
                </label>
                <input
                  type="text"
                  value={taxReceiptProfileForm.taxReceiptAddress.line2}
                  onChange={(event) => setTaxReceiptAddressField('line2', event.target.value)}
                  className="h-11 w-full rounded-xl border-none bg-white px-4 text-sm font-bold text-gray-900 shadow-sm focus:ring-2 focus:ring-[#800000]/20"
                />
              </div>
              <div className="space-y-2">
                <label className="text-[10px] font-black uppercase tracking-widest text-gray-500">
                  {profileExtra.taxReceiptCity}
                </label>
                <input
                  type="text"
                  value={taxReceiptProfileForm.taxReceiptAddress.city}
                  onChange={(event) => setTaxReceiptAddressField('city', event.target.value)}
                  className="h-11 w-full rounded-xl border-none bg-white px-4 text-sm font-bold text-gray-900 shadow-sm focus:ring-2 focus:ring-[#800000]/20"
                />
              </div>
              <div className="space-y-2">
                <label className="text-[10px] font-black uppercase tracking-widest text-gray-500">
                  {profileExtra.taxReceiptRegion}
                </label>
                <input
                  type="text"
                  value={taxReceiptProfileForm.taxReceiptAddress.region}
                  onChange={(event) => setTaxReceiptAddressField('region', event.target.value)}
                  className="h-11 w-full rounded-xl border-none bg-white px-4 text-sm font-bold text-gray-900 shadow-sm focus:ring-2 focus:ring-[#800000]/20"
                />
              </div>
              <div className="space-y-2">
                <label className="text-[10px] font-black uppercase tracking-widest text-gray-500">
                  {profileExtra.taxReceiptPostalCode}
                </label>
                <input
                  type="text"
                  value={taxReceiptProfileForm.taxReceiptAddress.postalCode}
                  onChange={(event) => setTaxReceiptAddressField('postalCode', event.target.value)}
                  className="h-11 w-full rounded-xl border-none bg-white px-4 text-sm font-bold text-gray-900 shadow-sm focus:ring-2 focus:ring-[#800000]/20"
                />
              </div>
              <div className="space-y-2">
                <label className="text-[10px] font-black uppercase tracking-widest text-gray-500">
                  {profileExtra.taxReceiptCountry}
                </label>
                <input
                  type="text"
                  value={taxReceiptProfileForm.taxReceiptAddress.country}
                  onChange={(event) => setTaxReceiptAddressField('country', event.target.value)}
                  className="h-11 w-full rounded-xl border-none bg-white px-4 text-sm font-bold text-gray-900 shadow-sm focus:ring-2 focus:ring-[#800000]/20"
                />
              </div>
            </div>
            {taxReceiptProfileMessage && (
              <p className="text-xs font-bold leading-relaxed text-amber-700">
                {taxReceiptProfileMessage}
              </p>
            )}
            <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
              <button
                type="button"
                onClick={() => void handleSaveTaxReceiptProfile()}
                disabled={taxReceiptProfileSaving}
                className="flex h-10 items-center justify-center gap-2 rounded-xl bg-gray-900 px-4 text-[10px] font-black uppercase tracking-widest text-white transition-all hover:bg-[#800000] disabled:opacity-50"
              >
                {taxReceiptProfileSaving ? <Loader2 size={14} className="animate-spin" /> : <ReceiptText size={14} />}
                {taxReceiptProfileSaving ? extra.taxReceiptProfileSaving : extra.taxReceiptProfileSave}
              </button>
              <button
                type="button"
                onClick={() => onScreenChange?.('profile')}
                className="flex h-10 items-center justify-center gap-2 rounded-xl bg-white px-4 text-[10px] font-black uppercase tracking-widest text-gray-600 shadow-sm transition-all hover:bg-gray-900 hover:text-white"
              >
                {extra.taxReceiptProfileOpen}
                <ChevronRight size={14} />
              </button>
            </div>
          </div>
        )}
      </div>
    );
  };

  const renderReceiptHistory = () => (
    <div className="bg-white rounded-[32px] p-6 shadow-sm border border-gray-100">
      <div className="flex items-center gap-3 mb-5">
        <div className="w-11 h-11 rounded-2xl bg-[#800000]/10 flex items-center justify-center text-[#800000]">
          <ReceiptText size={22} />
        </div>
        <div>
          <h3 className="font-black text-gray-900 text-base tracking-tight">{extra.receiptHistoryTitle}</h3>
          <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest">
            {extra.receiptHistorySub}
          </p>
        </div>
      </div>

      {receiptMessage && (
        <p className="mb-4 text-xs font-bold text-[#800000]">{receiptMessage}</p>
      )}

      {renderEmailVerificationPrompt('mb-4')}
      {renderTaxReceiptProfilePrompt(false, 'mb-4')}

      {receiptHistoryLoading ? (
        <div className="flex items-center gap-2 text-xs font-bold text-gray-400">
          <Loader2 size={14} className="animate-spin" />
          {extra.loadingReceipts}
        </div>
      ) : !receiptHistoryHasEntries ? (
        <p className="text-sm font-medium text-gray-400 leading-relaxed">{extra.noReceiptHistory}</p>
      ) : (
        <div className="space-y-3">
          {receiptGivingRecords.map((record) => {
            const matchedTaxReceipt = singleTaxReceiptByGivingId.get(record.id);
            const coveredByAnnualReceipt = annualCoveredGivingIds.has(record.id);
            const {
              receiptId: recordTaxReceiptId,
              receiptNumber: recordTaxReceiptNumber,
              hasExistingSendableReceipt,
              unsupportedJurisdiction: recordUnsupportedJurisdiction,
              coveredByAnnualReceipt: coveredByAnnualReceiptOnly,
              canSendReceipt,
              canSendCorrectedReceipt,
            } = donorGivingReceiptActionAvailability(
              record,
              matchedTaxReceipt,
              receiptActionContextForChurch(record.churchId),
              coveredByAnnualReceipt
            );
            const receiptDeliveryHelp = donorReceiptDeliveryErrorMessage(
              record.taxReceiptEmailError || record.taxReceiptError,
              record.churchId
            );
            const sending = sendingReceiptId === record.id;
            const receiptSendRequiresProfile = canSendCorrectedReceipt || (canSendReceipt && !hasExistingSendableReceipt);
            const receiptSendBlockedByProfile =
              receiptSendRequiresProfile && taxReceiptProfileBlocksReceiptIssuanceForChurch(record.churchId);
            const canOfferReceiptSend = canSendReceipt || canSendCorrectedReceipt;
            const receiptPreviouslyEmailed =
              record.taxReceiptStatus === 'sent'
              || matchedTaxReceipt?.status === 'sent'
              || Boolean(matchedTaxReceipt?.emailSentAt);
            const correctedReceiptAvailable =
              canSendReceipt
              && !canSendCorrectedReceipt
              && taxReceiptIsCorrected(matchedTaxReceipt);
            const receiptSendButtonLabel = receiptSendBlockedByProfile
              ? extra.taxReceiptProfileRequiredAction
              : recordUnsupportedJurisdiction
                ? extra.taxReceiptUnsupportedJurisdiction
              : correctedReceiptAvailable
                ? receiptPreviouslyEmailed
                  ? extra.resendCorrectedTaxReceipt
                  : extra.emailCorrectedTaxReceipt
              : canSendCorrectedReceipt
                ? extra.emailCorrectedTaxReceipt
              : receiptPreviouslyEmailed
                ? extra.resendTaxReceipt
                : extra.emailTaxReceipt;
            return (
              <div key={record.id} className="rounded-2xl border border-gray-100 bg-gray-50 p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-sm font-black text-gray-900">{formatGivingAmount(record)}</p>
                    <p className="mt-1 truncate text-xs font-bold text-gray-500">
                      {record.churchName || activeChurch?.name || extra.yourParish}
                    </p>
                    <p className="mt-1 text-[10px] font-bold uppercase tracking-widest text-gray-400">
                      {record.purpose} / {formatGivingDate(record)}
                    </p>
                    <p className="mt-2 text-[10px] font-black uppercase tracking-widest text-[#937022]">
                      {receiptStatusLabel(record, coveredByAnnualReceiptOnly)}
                      {recordTaxReceiptNumber ? ` / ${recordTaxReceiptNumber}` : ''}
                    </p>
                    {receiptDeliveryHelp && (
                      <p className="mt-2 max-w-md text-xs font-bold leading-relaxed text-amber-700">
                        {receiptDeliveryHelp}
                      </p>
                    )}
                  </div>
                  {(recordTaxReceiptId || canOfferReceiptSend) && (
                    <div className="flex flex-shrink-0 items-center gap-2">
                      {recordTaxReceiptId && (
                        <button
                          onClick={() => void handleViewTaxReceipt(recordTaxReceiptId)}
                          disabled={loadingReceiptId === recordTaxReceiptId}
                          className="flex h-10 w-10 items-center justify-center rounded-xl bg-white text-gray-500 shadow-sm transition-all hover:bg-gray-900 hover:text-white disabled:opacity-50"
                          title={extra.viewTaxReceipt}
                          aria-label={extra.viewTaxReceipt}
                        >
                          {loadingReceiptId === recordTaxReceiptId ? (
                            <Loader2 size={16} className="animate-spin" />
                          ) : (
                            <Eye size={16} />
                          )}
                        </button>
                      )}
                      {canOfferReceiptSend && (
                        <button
                          onClick={() => void handleSendTaxReceipt(
                            record.id,
                            canSendCorrectedReceipt,
                            receiptSendRequiresProfile,
                            record.churchId
                          )}
                          disabled={sending || receiptSendBlockedByProfile}
                          className="flex h-10 w-10 items-center justify-center rounded-xl bg-white text-[#800000] shadow-sm transition-all hover:bg-[#800000] hover:text-white disabled:opacity-50"
                          title={receiptSendButtonLabel}
                          aria-label={receiptSendButtonLabel}
                        >
                          {sending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
          {standaloneSingleTaxReceipts.map((receipt) => {
            const standaloneReceiptAction =
              donorTaxReceiptActionAvailability(receipt, receiptActionContextForChurch(receipt.churchId));
            const receiptDeliveryHelp = standaloneReceiptAction.unsupportedJurisdiction
              ? extra.taxReceiptUnsupportedJurisdiction
              : standaloneReceiptAction.missingAssignedReceiptNumber || standaloneReceiptAction.invalidCurrency
                ? extra.taxReceiptGenericIssue
              : donorReceiptDeliveryErrorMessage(receipt.emailError, receipt.churchId);
            const {
              canSendReceipt,
              canSendCorrectedReceipt,
            } = standaloneReceiptAction;
            const sending = sendingReceiptId === receipt.givingId;
            const correctedReceiptSendBlockedByProfile =
              canSendCorrectedReceipt && taxReceiptProfileBlocksReceiptIssuanceForChurch(receipt.churchId);
            const standaloneReceiptPreviouslyEmailed =
              receipt.status === 'sent'
              || Boolean(receipt.emailSentAt);
            const standaloneCorrectedReceiptAvailable =
              (canSendReceipt || canSendCorrectedReceipt)
              && taxReceiptIsCorrected(receipt);
            const standaloneSendButtonLabel = correctedReceiptSendBlockedByProfile
              ? extra.taxReceiptProfileRequiredAction
              : standaloneCorrectedReceiptAvailable
                ? standaloneReceiptPreviouslyEmailed
                  ? extra.resendCorrectedTaxReceipt
                  : extra.emailCorrectedTaxReceipt
              : canSendCorrectedReceipt
                ? extra.emailCorrectedTaxReceipt
              : standaloneReceiptPreviouslyEmailed
                ? extra.resendTaxReceipt
                : extra.emailTaxReceipt;
            return (
              <div key={receipt.id} className="rounded-2xl border border-gray-100 bg-gray-50 p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-sm font-black text-gray-900">
                      {formatReceiptAmount(receipt.amountCents, receipt.currency)}
                    </p>
                    <p className="mt-1 truncate text-xs font-bold text-gray-500">
                      {receipt.churchName || activeChurch?.name || extra.yourParish}
                    </p>
                    <p className="mt-1 text-[10px] font-bold uppercase tracking-widest text-gray-400">
                      {receipt.purpose} / {formatTaxReceiptDate(receipt)}
                    </p>
                    <p className="mt-2 text-[10px] font-black uppercase tracking-widest text-[#937022]">
                      {taxReceiptStatusLabel(receipt)}
                      {receipt.receiptNumber ? ` / ${receipt.receiptNumber}` : ''}
                    </p>
                    {receiptDeliveryHelp && (
                      <p className="mt-2 max-w-md text-xs font-bold leading-relaxed text-amber-700">
                        {receiptDeliveryHelp}
                      </p>
                    )}
                  </div>
                  <div className="flex flex-shrink-0 items-center gap-2">
                    <button
                      onClick={() => void handleViewTaxReceipt(receipt.id)}
                      disabled={loadingReceiptId === receipt.id}
                      className="flex h-10 w-10 items-center justify-center rounded-xl bg-white text-gray-500 shadow-sm transition-all hover:bg-gray-900 hover:text-white disabled:opacity-50"
                      title={extra.viewTaxReceipt}
                      aria-label={extra.viewTaxReceipt}
                    >
                      {loadingReceiptId === receipt.id ? (
                        <Loader2 size={16} className="animate-spin" />
                      ) : (
                        <Eye size={16} />
                      )}
                    </button>
                    {(canSendReceipt || canSendCorrectedReceipt) && (
                      <button
                        onClick={() => void handleSendTaxReceipt(
                          receipt.givingId,
                          Boolean(canSendCorrectedReceipt),
                          Boolean(canSendCorrectedReceipt),
                          receipt.churchId
                        )}
                        disabled={sending || correctedReceiptSendBlockedByProfile}
                        className="flex h-10 w-10 items-center justify-center rounded-xl bg-white text-[#800000] shadow-sm transition-all hover:bg-[#800000] hover:text-white disabled:opacity-50"
                        title={standaloneSendButtonLabel}
                        aria-label={standaloneSendButtonLabel}
                      >
                        {sending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {!receiptHistoryLoading && annualRows.length > 0 && (
        <div className="mt-5 border-t border-gray-100 pt-5">
          <p className="mb-3 text-[10px] font-black uppercase tracking-widest text-gray-400">
            {extra.annualTaxReceipts}
          </p>
          <div className="space-y-3">
            {annualRows.map((row) => {
              const year = row.year;
              const annualReceipt = row.receipt;
              const annualSummary = row.summary;
              const annualReceiptRecord = annualReceipt ?? annualSummary;
              const annualReceiptId = annualReceipt?.id ?? annualSummary?.receiptId ?? '';
              const annualReceiptNumber = annualReceipt?.receiptNumber || annualSummary?.receiptNumber || '';
              const annualReceiptErrorCode = annualReceipt?.emailError || annualSummary?.emailError;
              const annualProfileIncomplete =
                safeReceiptErrorCode(annualReceiptErrorCode) === TAX_RECEIPT_DONOR_PROFILE_INCOMPLETE_CODE;
              const annualMissingVerifiedEmail =
                safeReceiptErrorCode(annualReceiptErrorCode) === TAX_RECEIPT_MISSING_EMAIL_OR_AMOUNT_CODE;
              const annualTaxReceiptState = taxReceiptStateForChurch(row.churchId);
              const annualTaxReceiptReady = taxReceiptReadyForChurch(row.churchId);
              const annualKey = row.key;
              const sending = sendingAnnualReceiptKey === annualKey;
              const annualIncludesPreviouslyReceipted =
                row.candidateIncludesPreviouslyReceipted
                || annualReceipt?.includesPreviouslyReceipted === true
                || annualSummary?.includesPreviouslyReceipted === true;
              const {
                receiptVoided: annualReceiptVoided,
                receiptDeliveryFailureRetryable: annualReceiptDeliveryFailureRetryable,
                receiptReissueAvailable: annualReceiptReissueAvailable,
                receiptSettled: annualReceiptSettled,
                receiptUnsupportedJurisdiction: annualReceiptUnsupportedJurisdiction,
                receiptNeedsReview: annualReceiptNeedsReview,
                canSendCorrectedAnnualReceipt,
                canSendAnnualReceipt,
              } = donorAnnualReceiptActionAvailability(
                annualReceiptRecord,
                row.candidateNeedsReview,
                row.candidateHasMixedCurrency,
                row.candidateHasPartialRefund,
                row.candidateHasEligibleGiving,
                annualTaxReceiptReady,
                {
                  candidateAmountCents: row.candidateAmountCents,
                  candidateEligibleAmountCents: row.candidateEligibleAmountCents,
                  taxReceiptIssuanceUnsupported: annualTaxReceiptState === 'unsupported_jurisdiction',
                }
              );
              const receiptDeliveryHelp = annualReceiptUnsupportedJurisdiction
                ? extra.taxReceiptUnsupportedJurisdiction
                : donorReceiptDeliveryErrorMessage(annualReceiptErrorCode, row.churchId);
              const confirmingAnnualSend =
                annualIncludesPreviouslyReceipted
                && pendingAnnualReceiptAck?.key === annualKey
                && pendingAnnualReceiptAck.corrected === canSendCorrectedAnnualReceipt;
              const annualUnavailableLabel =
                annualTaxReceiptState === 'unsupported_jurisdiction'
                  ? extra.taxReceiptUnsupportedJurisdiction
                  : extra.taxReceiptUnavailable;
              const annualReceiptPreviouslyEmailed =
                annualReceipt?.status === 'sent'
                || annualSummary?.status === 'sent'
                || Boolean(annualReceipt?.emailSentAt || annualSummary?.emailSentAt);
              const correctedAnnualReceiptAvailable =
                canSendAnnualReceipt
                && !canSendCorrectedAnnualReceipt
                && (taxReceiptIsCorrected(annualReceipt) || annualSummary?.correctedReceipt === true);
              const annualSendButtonLabel = confirmingAnnualSend
                ? extra.taxReceiptPreviouslyReceiptedAckRequired
                : correctedAnnualReceiptAvailable
                  ? annualReceiptPreviouslyEmailed
                    ? extra.resendCorrectedAnnualTaxReceipt
                    : extra.emailCorrectedAnnualTaxReceipt
                : canSendCorrectedAnnualReceipt
                  ? extra.emailCorrectedAnnualTaxReceipt
                : canSendAnnualReceipt
                  ? annualReceiptPreviouslyEmailed
                    ? extra.resendAnnualTaxReceipt
                    : extra.emailAnnualTaxReceipt
                : annualReceiptUnsupportedJurisdiction
                  ? extra.taxReceiptUnsupportedJurisdiction
                : annualReceiptVoided
                  ? extra.taxReceiptVoided
                : annualReceiptNeedsReview
                  ? extra.taxReceiptError
                : !annualTaxReceiptReady && !annualReceiptSettled
                  ? annualUnavailableLabel
                  : extra.emailAnnualTaxReceipt;
              const annualSendRequiresProfile =
                canSendCorrectedAnnualReceipt
                || (canSendAnnualReceipt && !annualReceiptSettled && !annualReceiptDeliveryFailureRetryable);
              const annualSendBlockedByProfile =
                annualSendRequiresProfile && taxReceiptProfileBlocksReceiptIssuanceForChurch(row.churchId);
              const annualProfileAwareSendButtonLabel = annualSendBlockedByProfile
                ? extra.taxReceiptProfileRequiredAction
                : annualSendButtonLabel;
              return (
                <div key={row.key} className="rounded-2xl border border-gray-100 bg-gray-50 p-4">
                  <div className="flex items-center justify-between gap-4">
                    <div className="min-w-0">
                      <p className="text-sm font-black text-gray-900">
                        {year} {extra.annualTaxReceipt}
                      </p>
                      {row.churchName && (
                        <p className="mt-1 truncate text-xs font-bold text-gray-500">
                          {row.churchName}
                        </p>
                      )}
                      <p className="mt-1 truncate text-[10px] font-black uppercase tracking-widest text-[#937022]">
                        {annualReceiptReissueAvailable
                          ? extra.annualReceiptAvailable
                        : annualReceiptVoided
                          ? extra.taxReceiptVoided
                        : annualProfileIncomplete
                          ? taxReceiptProfileBlocksReceiptIssuanceForChurch(row.churchId)
                            ? extra.taxReceiptProfileNeeded
                            : extra.annualReceiptAvailable
                        : annualMissingVerifiedEmail
                          ? extra.annualReceiptAvailable
                        : annualReceiptDeliveryFailureRetryable
                          ? extra.taxReceiptError
                        : annualReceiptNeedsReview
                            ? extra.taxReceiptError
                          : annualReceiptRecord
                          ? `${extra.annualReceiptReady}${annualReceiptNumber ? ` / ${annualReceiptNumber}` : ''}`
                          : !annualTaxReceiptReady && !annualReceiptSettled
                            ? annualUnavailableLabel
                          : extra.annualReceiptAvailable}
                      </p>
                      {annualIncludesPreviouslyReceipted && (
                        <p className="mt-2 text-[10px] font-bold leading-relaxed text-amber-700">
                          {extra.annualReceiptIncludesPreviouslyReceipted}
                        </p>
                      )}
                      {row.candidateHasMixedCurrency && (
                        <p className="mt-2 text-[10px] font-bold leading-relaxed text-amber-700">
                          {extra.annualReceiptMixedCurrencyBlocked}
                        </p>
                      )}
                      {confirmingAnnualSend && (
                        <p className="mt-1 max-w-md text-[10px] font-bold leading-relaxed text-amber-700">
                          {extra.taxReceiptPreviouslyReceiptedAckRequired}
                        </p>
                      )}
                      {receiptDeliveryHelp && (
                        <p className="mt-2 max-w-md text-xs font-bold leading-relaxed text-amber-700">
                          {receiptDeliveryHelp}
                        </p>
                      )}
                    </div>
                    <div className="flex flex-shrink-0 items-center gap-2">
                      {annualReceiptId && (
                        <button
                          onClick={() => {
                            if (annualReceipt) {
                              setSelectedReceipt(annualReceipt);
                              return;
                            }
                            void handleViewTaxReceipt(annualReceiptId);
                          }}
                          disabled={loadingReceiptId === annualReceiptId}
                          className="flex h-10 w-10 items-center justify-center rounded-xl bg-white text-gray-500 shadow-sm transition-all hover:bg-gray-900 hover:text-white disabled:opacity-50"
                          title={extra.viewTaxReceipt}
                          aria-label={extra.viewTaxReceipt}
                        >
                          {loadingReceiptId === annualReceiptId ? (
                            <Loader2 size={16} className="animate-spin" />
                          ) : (
                            <Eye size={16} />
                          )}
                        </button>
                      )}
                      <button
                        onClick={() => confirmDonorAnnualReceiptSend(
                          row.churchId,
                          year,
                          canSendCorrectedAnnualReceipt,
                          annualIncludesPreviouslyReceipted,
                          annualSendRequiresProfile
                        )}
                        disabled={
                          sending
                          || annualSendBlockedByProfile
                          || (!canSendAnnualReceipt && !canSendCorrectedAnnualReceipt)
                        }
                        className={`flex h-10 w-10 items-center justify-center rounded-xl bg-white shadow-sm transition-all disabled:opacity-50 ${
                          confirmingAnnualSend
                            ? 'text-amber-700 ring-2 ring-amber-300 hover:bg-amber-700 hover:text-white'
                            : 'text-[#800000] hover:bg-[#800000] hover:text-white'
                        }`}
                        aria-pressed={confirmingAnnualSend}
                        title={annualProfileAwareSendButtonLabel}
                        aria-label={annualProfileAwareSendButtonLabel}
                      >
                        {sending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );

  if (givingPhase === 'details') {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="min-h-full bg-white overflow-y-auto scrollbar-hide p-8 pb-32"
      >
        <div className="lg:max-w-2xl lg:mx-auto">
        <div className="mb-10 flex justify-between items-start">
          <div>
            <span className="text-[#937022] font-black text-[10px] tracking-[0.2em] uppercase mb-2 block">{t.step} 1 {t.of} 2</span>
            <h2 className="text-3xl font-black text-gray-900 tracking-tighter">{t.details}</h2>
            <p className="text-gray-400 text-sm mt-2 font-medium">{t.supportSub}</p>
          </div>
          <button onClick={() => setGivingPhase('none')} className="p-2 bg-gray-50 rounded-full">
            <X size={20} className="text-gray-400" />
          </button>
        </div>

        <div className="space-y-6">
          <div className="space-y-2">
            <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">{t.selectAmount}</label>
            <div className="grid grid-cols-3 gap-3">
              {['25', '50', '100', '250', '500'].map((val) => (
                <button
                  key={val}
                  onClick={() => setAmount(val)}
                  className={`py-4 rounded-2xl font-black text-sm transition-all ${amount === val ? 'bg-[#800000] text-white shadow-lg shadow-red-900/20' : 'bg-gray-50 text-gray-400 hover:bg-gray-100'}`}
                >
                  {formatDonationAmount(Number(val), 0)}
                </button>
              ))}
              <div className="relative">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 font-bold text-xs">
                  {donationCurrencyPrefix}
                </span>
                <input
                  type="number"
                  placeholder={t.other}
                  value={amount === '25' || amount === '50' || amount === '100' || amount === '250' || amount === '500' ? '' : amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="w-full bg-gray-50 border-none rounded-2xl pl-12 pr-4 py-4 text-sm font-bold text-gray-900 focus:ring-2 focus:ring-[#800000]/20 transition-all"
                />
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">{t.fullName}</label>
            <input
              type="text"
              placeholder="John Doe"
              value={givingData.fullName}
              onChange={(e) => setGivingData({...givingData, fullName: e.target.value})}
              className="w-full bg-gray-50 border-none rounded-2xl px-6 py-4 text-sm font-bold text-gray-900 focus:ring-2 focus:ring-[#800000]/20 transition-all"
            />
          </div>

          <div className="space-y-2">
            <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">{t.email}</label>
            <div className="relative">
              <Mail size={16} className="absolute left-6 top-1/2 -translate-y-1/2 text-gray-300" />
              <input
                type="email"
                value={givingData.email}
                readOnly
                className="w-full bg-gray-50 border-none rounded-2xl pl-14 pr-6 py-4 text-sm font-bold text-gray-900 focus:ring-2 focus:ring-[#800000]/20 transition-all"
              />
            </div>
            <p className="text-[10px] font-bold text-gray-400 ml-1">
              {extra.receiptsEmail}
            </p>
          </div>

          {renderEmailVerificationPrompt()}

          {renderTaxReceiptProfilePrompt(true)}

          <div className="space-y-2">
            <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">{t.purpose}</label>
            <select
              value={givingData.purpose}
              onChange={(e) => setGivingData({...givingData, purpose: e.target.value})}
              className="w-full bg-gray-50 border-none rounded-2xl px-6 py-4 text-sm font-bold text-gray-900 focus:ring-2 focus:ring-[#800000]/20 transition-all appearance-none"
            >
              <option>{t.generalFund}</option>
              <option>{t.buildingFund}</option>
              <option>{t.charityOutreach}</option>
              <option>{t.choirLiturgical}</option>
              <option>{t.youthPrograms}</option>
            </select>
          </div>

          <div className="space-y-4 pt-4">
            <button
              onClick={() => setGivingData({...givingData, anonymous: !givingData.anonymous})}
              className="w-full flex items-center gap-4 p-5 bg-gray-50 rounded-2xl group transition-all"
            >
              <div className={`w-5 h-5 rounded-md flex items-center justify-center transition-all ${givingData.anonymous ? 'bg-[#800000] text-white' : 'bg-white border-2 border-gray-200'}`}>
                {givingData.anonymous && <CheckCircle2 size={12} />}
              </div>
              <div className="flex-1 text-left">
                <h4 className="text-xs font-black text-gray-900 leading-tight">{t.anonymous}</h4>
                <p className="text-[9px] text-gray-400 font-bold mt-0.5">{t.anonymousSub}</p>
              </div>
            </button>
          </div>

          <button
            onClick={() => {
              if (blockUntilEmailVerified(setTaxReceiptProfileMessage)) {
                return;
              }
              if (taxReceiptProfileBlocksCheckout) {
                setTaxReceiptProfileMessage(
                  taxReceiptProfileLoaded ? extra.taxReceiptProfileRequired : extra.taxReceiptProfileChecking
                );
                return;
              }
              setGivingPhase('payment');
            }}
            aria-disabled={checkoutPrerequisiteBlocked}
            className={`w-full py-5 bg-gray-900 text-white rounded-3xl font-black text-[10px] uppercase tracking-widest hover:bg-[#800000] transition-all shadow-xl shadow-black/10 mt-8 ${
              checkoutPrerequisiteBlocked ? 'opacity-60' : ''
            }`}
          >
            {checkoutPrerequisiteActionLabel || t.continuePayment}
          </button>
        </div>
        </div>
      </motion.div>
    );
  }

  if (givingPhase === 'payment') {
    return (
      <motion.div
        initial={{ opacity: 0, x: 20 }}
        animate={{ opacity: 1, x: 0 }}
        className="min-h-full bg-white overflow-y-auto scrollbar-hide p-8 pb-32"
      >
        <div className="lg:max-w-2xl lg:mx-auto">
        <div className="mb-10 flex justify-between items-start">
          <div>
            <span className="text-[#937022] font-black text-[10px] tracking-[0.2em] uppercase mb-2 block">{t.step} 2 {t.of} 2</span>
            <h2 className="text-3xl font-black text-gray-900 tracking-tighter">{t.checkout}</h2>
            <p className="text-gray-400 text-sm mt-2 font-medium">{t.secureSub}</p>
          </div>
          <button onClick={() => setGivingPhase('details')} className="p-2 bg-gray-50 rounded-full">
            <ChevronRight size={20} className="text-gray-400 rotate-180" />
          </button>
        </div>

        <div className="space-y-6">
          <div className="bg-gray-50 rounded-3xl p-6 space-y-3">
            <p className="text-[10px] font-black text-[#937022] uppercase tracking-widest">
              {extra.secureCheckout}
            </p>
            <h3 className="text-xl font-black text-gray-900 tracking-tight">
              {activeChurch?.name ?? extra.yourParish}
            </h3>
            <p className="text-sm font-medium text-gray-500 leading-relaxed">
              {extra.redirectStripe}
            </p>
            <div className="grid grid-cols-2 gap-4 pt-2 text-xs font-bold text-gray-500">
              <div>
                <p className="text-[10px] font-black text-gray-300 uppercase tracking-widest mb-1">
                  {extra.donor}
                </p>
                <p className="text-gray-900">{givingData.fullName || currentUser?.displayName || extra.parishioner}</p>
              </div>
              <div>
                <p className="text-[10px] font-black text-gray-300 uppercase tracking-widest mb-1">
                  {extra.receipt}
                </p>
                <p className="text-gray-900 break-all">{givingData.email || currentUser?.email || extra.noEmail}</p>
              </div>
            </div>
          </div>

          <div className="bg-gray-50 rounded-3xl p-6 mt-4">
            <div className="flex justify-between items-center mb-2">
              <span className="text-xs font-bold text-gray-500">{t.donationAmount}</span>
              <span className="text-xs font-black text-gray-900">{formatDonationCents(amountCents)}</span>
            </div>
            <div className="flex justify-between items-center mb-2">
              <span className="text-xs font-bold text-gray-500">{t.purpose}</span>
              <span className="text-xs font-black text-gray-900">{givingData.purpose}</span>
            </div>
            <div className="flex justify-between items-center pt-4 border-t border-gray-200">
              <span className="text-sm font-black text-gray-900">{t.totalOffering}</span>
              <span className="text-sm font-black text-[#937022]">{formatDonationCents(amountCents)}</span>
            </div>
          </div>

          {checkoutMessage && (
            <p className="text-sm font-bold text-red-500">{checkoutMessage}</p>
          )}

          {checkoutPrerequisiteBlocked && (
            <div className="space-y-3">
              {renderEmailVerificationPrompt()}
              {renderTaxReceiptProfilePrompt(true)}
            </div>
          )}

          <button
            onClick={() => void handleCheckout()}
            disabled={checkoutLoading}
            aria-disabled={checkoutPrerequisiteBlocked}
            className="w-full py-5 bg-[#800000] text-white rounded-3xl font-black text-[10px] uppercase tracking-widest shadow-xl shadow-red-900/20 hover:bg-[#8D1212] transition-all active:scale-95 mt-4 disabled:opacity-60 flex items-center justify-center gap-2"
          >
            {checkoutLoading ? <Loader2 size={14} className="animate-spin" /> : null}
            {checkoutPrerequisiteActionLabel || extra.completeSecureCheckout}
          </button>
        </div>
        </div>
      </motion.div>
    );
  }

  if (givingPhase === 'success') {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="min-h-full bg-white flex flex-col items-center justify-center p-8 pb-32 text-center"
      >
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ type: 'spring', damping: 15, stiffness: 200 }}
          className="w-24 h-24 bg-red-50 text-[#800000] rounded-full flex items-center justify-center mb-8"
        >
          <Heart size={48} fill="currentColor" />
        </motion.div>

        <h2 className="text-4xl font-black text-gray-900 tracking-tighter mb-4">{t.thankYou}</h2>
        <p className="text-gray-500 text-sm font-medium leading-relaxed mb-10 max-w-[280px]">
          {t.successMessage.replace('{amount}', formatDonationAmount(Number.parseFloat(amount || '0')))}
        </p>

        <div className="w-full max-w-[320px] space-y-3">
          <button
            onClick={() => {
              window.sessionStorage.removeItem(PENDING_GIVING_STORAGE_KEY);
              setFocusReceiptHistory(true);
              setGivingPhase('none');
            }}
            className="w-full py-5 bg-[#800000] text-white rounded-3xl font-black text-[10px] uppercase tracking-widest hover:bg-[#8D1212] transition-all shadow-xl shadow-red-900/20 flex items-center justify-center gap-3"
          >
            <ReceiptText size={16} />
            {extra.receiptHistoryTitle}
          </button>
          <button
            onClick={() => {
              window.sessionStorage.removeItem(PENDING_GIVING_STORAGE_KEY);
              setGivingPhase('none');
              onScreenChange?.('home');
            }}
            className="w-full py-5 bg-gray-900 text-white rounded-3xl font-black text-[10px] uppercase tracking-widest hover:bg-[#800000] transition-all shadow-xl shadow-black/10 flex items-center justify-center gap-3"
          >
            {t.backHome}
            <ChevronRight size={16} />
          </button>
        </div>
      </motion.div>
    );
  }

  const onlineGivingOptions = [
    { title: t.oneTimeTitle, sub: t.oneTimeSub, icon: Gift },
  ];
  const activeParishName = activeChurch?.name ?? extra.yourParish;

  return (
    <div className="pb-32 bg-[#F9F9F9] min-h-full">
      {renderTaxReceiptDetail()}
      {/* ── Desktop 2-column layout ──────────────────────────────── */}
      <div className="hidden lg:grid lg:w-full lg:max-w-6xl lg:mx-auto lg:grid-cols-[minmax(0,0.95fr)_minmax(360px,1.05fr)] lg:gap-10 lg:px-10 lg:pt-10 lg:items-start">
        {/* Left: header + stewardship card */}
        <div>
          <div className="mb-8">
            <span className="text-[#937022] font-black text-[10px] tracking-[0.2em] uppercase mb-2 block">{t.title}</span>
            <h1 className="text-5xl font-black text-gray-900 tracking-tighter leading-none">{t.donateNow}.</h1>
            <p className="text-gray-400 text-sm mt-4 font-medium leading-relaxed max-w-sm">{t.description}</p>
          </div>

          <div className="bg-white rounded-[40px] p-8 shadow-sm border border-gray-100">
            <div className="flex items-center gap-4 mb-8">
              <div className="w-14 h-14 bg-red-50 rounded-2xl flex items-center justify-center text-[#800000]">
                <HandHeart size={28} />
              </div>
              <div>
                <h3 className="font-black text-gray-900 text-lg tracking-tight">{t.oneTimeTitle}</h3>
                <p className="text-[10px] text-[#937022] font-bold uppercase tracking-widest">
                  {activeParishName}
                </p>
              </div>
            </div>
            <p className="mb-6 text-sm font-medium leading-relaxed text-gray-500">
              {extra.redirectStripe}
            </p>
            <div className="mb-8 grid grid-cols-2 gap-3">
              <div className="rounded-2xl bg-gray-50 p-4">
                <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">
                  {t.donationAmount}
                </p>
                <p className="mt-1 text-sm font-black text-gray-900">
                  {activeChurchDonationCurrency}
                </p>
              </div>
              <div className="rounded-2xl bg-gray-50 p-4">
                <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">
                  {t.purpose}
                </p>
                <p className="mt-1 text-sm font-black text-gray-900">
                  {t.generalFund}
                </p>
              </div>
            </div>
            <button
              onClick={() => setGivingPhase('details')}
              className="w-full py-5 bg-[#800000] text-white rounded-full font-black text-xs uppercase tracking-[0.2em] shadow-xl shadow-red-900/20 hover:bg-[#8D1212] transition-all active:scale-95"
            >
              {t.makeDonation}
            </button>
          </div>
        </div>

        {/* Right: ways to give */}
        <div>
          <h2 className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] mb-6">{t.waysToGive}</h2>
          <div className="space-y-4">
            {onlineGivingOptions.map((item) => (
              <button
                key={item.title}
                type="button"
                onClick={() => setGivingPhase('details')}
                className="w-full bg-white rounded-[24px] p-5 flex items-center gap-5 border border-transparent hover:border-gray-100 transition-all shadow-sm cursor-pointer hover:shadow-md text-left"
              >
                <div className="w-12 h-12 rounded-2xl bg-gray-50 flex items-center justify-center text-[#937022]">
                  <item.icon size={22} />
                </div>
                <div className="flex-1">
                  <h4 className="font-bold text-gray-900 text-sm">{item.title}</h4>
                  <p className="text-[10px] text-gray-400 mt-0.5 font-medium">{item.sub}</p>
                </div>
                <ChevronRight size={16} className="text-gray-200" />
              </button>
            ))}
          </div>

          <div
            ref={desktopReceiptHistoryRef}
            className="mt-8"
            role="region"
            tabIndex={-1}
            aria-label={extra.receiptHistoryTitle}
          >
            {renderReceiptHistory()}
          </div>
        </div>
      </div>

      {/* ── Mobile layout (unchanged) ────────────────────────────── */}
      <div className="lg:hidden">
        <div className="px-8 pt-12 mb-10 text-center">
          <span className="text-[#937022] font-black text-[10px] tracking-[0.2em] uppercase mb-2 block">{t.title}</span>
          <h1 className="text-5xl font-black text-gray-900 tracking-tighter leading-none">{t.donateNow}.</h1>
          <p className="text-gray-400 text-sm mt-4 max-w-[280px] mx-auto font-medium leading-relaxed">{t.description}</p>
        </div>

        <div className="px-6 mb-12">
          <div className="bg-white rounded-[40px] p-8 shadow-sm border border-gray-100">
            <div className="flex items-center gap-4 mb-8">
              <div className="w-14 h-14 bg-red-50 rounded-2xl flex items-center justify-center text-[#800000]">
                <HandHeart size={28} />
              </div>
              <div>
                <h3 className="font-black text-gray-900 text-lg tracking-tight">{t.oneTimeTitle}</h3>
                <p className="text-[10px] text-[#937022] font-bold uppercase tracking-widest">
                  {activeParishName}
                </p>
              </div>
            </div>
            <p className="mb-6 text-sm font-medium leading-relaxed text-gray-500">
              {extra.redirectStripe}
            </p>
            <div className="mb-8 grid grid-cols-2 gap-3">
              <div className="rounded-2xl bg-gray-50 p-4">
                <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">
                  {t.donationAmount}
                </p>
                <p className="mt-1 text-sm font-black text-gray-900">
                  {activeChurchDonationCurrency}
                </p>
              </div>
              <div className="rounded-2xl bg-gray-50 p-4">
                <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">
                  {t.purpose}
                </p>
                <p className="mt-1 text-sm font-black text-gray-900">
                  {t.generalFund}
                </p>
              </div>
            </div>
            <button onClick={() => setGivingPhase('details')} className="w-full py-5 bg-[#800000] text-white rounded-full font-black text-xs uppercase tracking-[0.2em] shadow-xl shadow-red-900/20 hover:bg-[#8D1212] transition-all active:scale-95">
              {t.makeDonation}
            </button>
          </div>
        </div>

        <div
          ref={mobileReceiptHistoryRef}
          className="px-6 mb-12"
          role="region"
          tabIndex={-1}
          aria-label={extra.receiptHistoryTitle}
        >
          {renderReceiptHistory()}
        </div>

        <div className="px-8 space-y-4">
          <h2 className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] mb-4 ml-2">{t.waysToGive}</h2>
          {onlineGivingOptions.map((item) => (
            <button
              key={item.title}
              type="button"
              onClick={() => setGivingPhase('details')}
              className="w-full bg-white rounded-[24px] p-5 flex items-center gap-5 border border-transparent hover:border-gray-100 transition-all shadow-sm text-left"
            >
              <div className="w-12 h-12 rounded-2xl bg-gray-50 flex items-center justify-center text-gray-400">
                <item.icon size={22} />
              </div>
              <div className="flex-1">
                <h4 className="font-bold text-gray-900 text-sm">{item.title}</h4>
                <p className="text-[10px] text-gray-400 mt-0.5 font-medium">{item.sub}</p>
              </div>
              <ChevronRight size={16} className="text-gray-200" />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
