import type { Language } from '../types';

export interface ExtraCopy {
  app: {
    unexpectedTitle: string;
    unexpectedBody: string;
    reloadApp: string;
  };
  auth: {
    invitationSignInContext: string;
    guestUnavailable: string;
    nativeSignInTitle: string;
    nativeSignInBody: string;
    motto: string;
    google: string;
    emailVerificationTitle: string;
    emailVerificationBody: string;
    emailVerificationEmailLabel: string;
    emailVerificationSend: string;
    emailVerificationSending: string;
    emailVerificationCheck: string;
    emailVerificationChecking: string;
    emailVerificationSent: string;
    emailVerificationConfirmed: string;
    emailVerificationStillPending: string;
    emailVerificationSendFailed: string;
    emailVerificationCheckFailed: string;
    emailVerificationSignOut: string;
    emailVerificationBannerTitle: string;
    emailVerificationBannerBody: string;
    emailVerificationBannerSendAgain: string;
    emailVerificationBannerAutoSent: string;
    emailVerificationRateLimited: string;
  };
  authErrors: Record<string, string>;
  invitation: {
    accepting: string;
    guestCannotAccept: string;
    alreadyMember: string;
    accepted: string;
    unableAccept: string;
    label: string;
    acceptedTitle: string;
    checkingTitle: string;
    signOut: string;
    continue: string;
    verifyEmailToAccept: string;
  };
  noMembership: {
    label: string;
    title: string;
    body: string;
    churchSelectorTitle: string;
    openProfile: string;
  };
  profile: {
    kandiloParishioner: string;
    myChurches: string;
    discoverChurches: string;
    noMemberships: string;
    noMembershipsYet: string;
    membershipInviteOnly: string;
    loadingChurches: string;
    unableLoadChurches: string;
    noPublicChurches: string;
    memberOfAllChurches: string;
    invitationRequired: string;
    askInvite: string;
    inviteOnly: string;
    joinChurch: string;
    joiningChurch: string;
    joinedChurch: string;
    unableJoinChurch: string;
    churchLimitReached: string;
    emailManaged: string;
    leave: string;
    confirm: string;
    no: string;
    leaveChurch: string;
    missionControl: string;
    signOut: string;
    uploadProfilePhoto: string;
    taxReceiptDetails: string;
    taxReceiptPrivacyNote: string;
    taxReceiptLegalName: string;
    taxReceiptAddressLine1: string;
    taxReceiptAddressLine2: string;
    taxReceiptCity: string;
    taxReceiptRegion: string;
    taxReceiptPostalCode: string;
    taxReceiptCountry: string;
    fullNameRequired: string;
    profileUpdated: string;
    profilePhotoUpdated: string;
    unableUpdateProfile: string;
    unableUpdateProfilePhoto: string;
    passwordFieldsRequired: string;
    passwordTooShort: string;
    passwordsMustMatch: string;
    passwordUpdated: string;
    passwordEmailOnly: string;
    avatarInvalidType: string;
    avatarTooLarge: string;
  };
  giving: {
    unexpectedCheckoutUrl: string;
    restoreFailed: string;
    confirmMissing: string;
    confirming: string;
    stripeFailed: string;
    stillConfirming: string;
    canceled: string;
    signInRequired: string;
    joinRequired: string;
    invalidAmount: string;
    unableCheckout: string;
    receiptsEmail: string;
    taxReceiptProfileTitle: string;
    taxReceiptProfileChecking: string;
    taxReceiptProfileReady: string;
    taxReceiptProfileMissing: string;
    taxReceiptProfileIncomplete: string;
    taxReceiptProfileRequired: string;
    taxReceiptProfileRequiredAction: string;
    taxReceiptProfileSave: string;
    taxReceiptProfileSaving: string;
    taxReceiptProfileSaved: string;
    taxReceiptProfileSaveFailed: string;
    taxReceiptProfileOpen: string;
    secureCheckout: string;
    yourParish: string;
    redirectStripe: string;
    donor: string;
    donorAddress: string;
    receipt: string;
    parishioner: string;
    noEmail: string;
    completeSecureCheckout: string;
    emailVerificationTitle: string;
    emailVerificationRequired: string;
    emailVerificationRequiredAction: string;
    emailVerificationContinueAction: string;
    emailVerificationCheckAction: string;
    emailVerificationSending: string;
    emailVerificationChecking: string;
    emailVerificationSent: string;
    emailVerificationConfirmed: string;
    emailVerificationStillPending: string;
    emailVerificationSendFailed: string;
    emailVerificationCheckFailed: string;
    yourImpact: string;
    familiesSupported: string;
    donatedThisMonth: string;
    goalProgress: string;
    avgStewardship: string;
    receiptHistoryTitle: string;
    receiptHistorySub: string;
    loadingReceipts: string;
    noReceiptHistory: string;
    emailTaxReceipt: string;
    resendTaxReceipt: string;
    emailCorrectedTaxReceipt: string;
    resendCorrectedTaxReceipt: string;
    emailAnnualTaxReceipt: string;
    resendAnnualTaxReceipt: string;
    emailCorrectedAnnualTaxReceipt: string;
    resendCorrectedAnnualTaxReceipt: string;
    viewTaxReceipt: string;
    downloadTaxReceipt: string;
    printTaxReceipt: string;
    closeReceipt: string;
    taxReceiptLoadError: string;
    taxReceiptDownloadError: string;
    officialTaxReceipt: string;
    receiptDetailsTitle: string;
    receiptDetailsSub: string;
    receiptNumber: string;
    taxId: string;
    issuedDate: string;
    receivedDate: string;
    amount: string;
    eligibleAmount: string;
    taxReceiptOriginalAmount: string;
    taxReceiptRefundedAmount: string;
    purpose: string;
    coveredPeriod: string;
    contributionsIncluded: string;
    contributionDetail: string;
    contributionDate: string;
    goodsServicesStatement: string;
    annualTaxReceipts: string;
    annualTaxReceipt: string;
    annualReceiptIncludesPreviouslyReceipted: string;
    annualReceiptMixedCurrencyBlocked: string;
    annualReceiptAvailable: string;
    annualReceiptReady: string;
    annualTaxReceiptSentNotice: string;
    correctedTaxReceiptSentNotice: string;
    correctedAnnualTaxReceiptSentNotice: string;
    taxReceiptAvailable: string;
    taxReceiptProfileNeeded: string;
    taxReceiptUnavailable: string;
    taxReceiptUnsupportedJurisdiction: string;
    taxReceiptIssued: string;
    taxReceiptSent: string;
    taxReceiptVoided: string;
    taxReceiptRefunded: string;
    taxReceiptVoidedWarning: string;
    taxReceiptCorrectionWarning: string;
    taxReceiptCorrectedWarning: string;
    taxReceiptPending: string;
    taxReceiptError: string;
    taxReceiptSentNotice: string;
    taxReceiptSendError: string;
    taxReceiptEmailNotConfigured: string;
    taxReceiptEmailInvalidConfiguration: string;
    taxReceiptMissingEmailOrAmount: string;
    taxReceiptMissingDonorProfile: string;
    taxReceiptPdfFailed: string;
    taxReceiptProviderRejected: string;
    taxReceiptGenericIssue: string;
    taxReceiptPreviouslyReceiptedAckRequired: string;
    taxReceiptPartialRefundReview: string;
    taxReceiptIncludedInAnnual: string;
    taxReceiptSingleGivingChanged: string;
    taxReceiptAnnualGivingChanged: string;
    taxReceiptAnnualMixedCurrency: string;
  };
  management: {
    tabs: {
      dashboard: string;
      members: string;
      events: string;
      eventPlatform: string;
      posts: string;
      newsletters: string;
      notifications: string;
      receipts: string;
      scanner: string;
    };
    roles: Record<'priest' | 'treasurer' | 'admin' | 'member', string>;
    statuses: Record<'active' | 'suspended' | 'pending', string>;
    common: {
      actions: string;
      cancel: string;
      loading: string;
      saveChanges: string;
      create: string;
      edit: string;
      delete: string;
      publish: string;
      saveDraft: string;
      draft: string;
      published: string;
      notPublished: string;
      title: string;
      content: string;
      excerpt: string;
    };
    dashboard: {
      eyebrow: string;
      title: string;
      totalMembers: string;
      active: string;
      upcomingEvents: string;
      scheduled: string;
      publishedBulletins: string;
      published: string;
      parishFeatures: string;
      featureSub: string;
      saintDays: string;
      saintDaysSub: string;
      stewardshipProgress: string;
      quickActions: string;
      addEvent: string;
      writePost: string;
      writeBulletin: string;
      sendAlert: string;
      viewDirectory: string;
      funds: {
        general: string;
        building: string;
        charity: string;
      };
    };
    members: {
      eyebrow: string;
      title: string;
      memberCount: (count: number) => string;
      invite: string;
      search: string;
      noMembers: string;
      noMembersSub: string;
      parishioner: string;
      role: string;
      joined: string;
      status: string;
      changeRole: string;
      setAs: (role: string) => string;
      reinstate: string;
      suspend: string;
    };
    events: {
      eyebrow: string;
      title: string;
      add: string;
      noEvents: string;
      noEventsSub: string;
    };
    posts: {
      eyebrow: string;
      title: string;
      count: (count: number) => string;
      newPost: string;
      noPosts: string;
      noPostsSub: string;
      createFirst: string;
      by: (author: string) => string;
      updated: (date: string) => string;
      untitled: string;
    };
    newsletters: {
      eyebrow: string;
      title: string;
      count: (count: number) => string;
      newBulletin: string;
      noBulletins: string;
      noBulletinsSub: string;
      createFirst: string;
      editBulletin: string;
      untitled: string;
      saveError: string;
      signedOutError: string;
      validationError: string;
      deleteError: string;
    };
    notifications: {
      eyebrow: string;
      title: string;
      cardTitle: string;
      cardSub: string;
      message: string;
      audience: string;
      members: string;
      admins: string;
      treasurers: string;
      priests: string;
      placeholderTitle: string;
      placeholderBody: string;
      send: string;
      sent: string;
      sendError: string;
      validationError: string;
      audienceError: string;
    };
    receipts: {
      eyebrow: string;
      title: string;
      cardTitle: string;
      cardSub: string;
      staffPrivacyNote: string;
      loading: string;
      emptyTitle: string;
      emptySub: string;
      restrictedTitle: string;
      restrictedSub: string;
      donor: string;
      amount: string;
      received: string;
      status: string;
      action: string;
      originalAmount: string;
      refundedAmount: string;
      netEligibleAmount: string;
      anonymousDonor: string;
      anonymousProtected: string;
      unknownDonor: string;
      noEmail: string;
      donorEmailProtected: string;
      ready: string;
      notConfigured: string;
      setupRequired: string;
      unsupportedJurisdiction: string;
      unsupportedJurisdictionSetupRequired: string;
      issued: string;
      sent: string;
      voided: string;
      error: string;
      donorProfileNeeded: string;
      send: string;
      resend: string;
      retrySend: string;
      sendCorrected: string;
      sending: string;
      annualSummaries: string;
      annualSummarySub: string;
      annualBatchPrivacyNote: string;
      annualSummary: string;
      sendAnnual: string;
      resendAnnual: string;
      resendCorrectedAnnual: string;
      includesPreviouslyReceipted: string;
      mixedCurrency: string;
      mixedCurrencyAnnualBlocked: string;
      annualSentNotice: string;
      correctedSentNotice: string;
      correctedAnnualSentNotice: string;
      sendAllAnnual: string;
      sendAllCorrectedAnnual: string;
      confirmAnnualSend: string;
      confirmCorrectedAnnualSend: string;
      confirmSendAllAnnual: string;
      confirmSendAllCorrectedAnnual: string;
      bulkSending: string;
      bulkCorrectedSending: string;
      bulkNoReceipts: string;
      bulkNoCorrectedReceipts: string;
      bulkAlreadySent: string;
      bulkCorrectedAlreadySent: string;
      bulkSentNotice: (count: number) => string;
      bulkPartialNotice: (sent: number, failed: number, truncated: boolean) => string;
      bulkCorrectedSentNotice: (count: number) => string;
      bulkCorrectedPartialNotice: (sent: number, failed: number, truncated: boolean) => string;
      loadError: string;
      sendError: string;
      emailNotConfigured: string;
      emailInvalidConfiguration: string;
      missingEmailOrAmount: string;
      missingDonorProfile: string;
      pdfFailed: string;
      providerRejected: string;
      genericIssue: string;
      includedInAnnual: string;
      previouslyReceiptedAckRequired: string;
      partialRefundReview: string;
      singleIncludedInAnnual: string;
      singleGivingChanged: string;
      annualGivingChanged: string;
      annualMixedCurrency: string;
      sentNotice: string;
      stripeOnboarding: string;
      openingStripeOnboarding: string;
      stripeSetupChecking: string;
      stripeSetupMissing: string;
      stripeSetupUnknown: string;
      stripeRoutingPending: string;
      stripeRoutingEnabled: string;
      stripeOnboardingOpened: string;
      stripeOnboardingReturnNotice: string;
      stripeOnboardingRefreshNotice: string;
      stripeOnboardingError: string;
    };
    scanner: {
      eyebrow: string;
      title: string;
      checkedIn: string;
      search: string;
      noEventsAvailable: string;
      noEventsTitle: string;
      noEventsSub: string;
      activeMembers: (count: number) => string;
      noActiveMembers: string;
      checkedInAction: string;
      checkInAction: string;
      loadError: string;
      updateError: string;
    };
    invite: {
      eyebrow: string;
      title: string;
      email: string;
      role: string;
      member: string;
      treasurer: string;
      admin: string;
      receiptAccessHint: string;
      send: string;
      created: string;
      unable: string;
      manual: (url: string) => string;
    };
    eventSheet: {
      allFields: string;
      signedOut: string;
      invalidDates: string;
      endAfterStart: string;
      unableSave: string;
      queuedWarning: string;
      failedAfterClose: string;
      failedToStart: string;
    };
  };
  postEditor: {
    back: string;
    savedAt: (time: string) => string;
    saveDraft: string;
    publish: string;
    titlePlaceholder: string;
    authorFallback: string;
    publishedAt: (date: string) => string;
    draft: string;
    beginPlaceholder: string;
    titleRequired: string;
    titleTooLong: string;
    saveFailed: string;
    aiWriter: string;
    aiGenerationFailed: string;
    translationPreviewFailed: string;
    aiPromptLabel: string;
    aiPromptPlaceholder: string;
    tone: string;
    previewOtherLanguages: string;
    previewing: string;
    generate: string;
    generating: string;
    preview: string;
    regenerate: string;
    insertIntoPost: string;
    otherLanguagePreviews: string;
    detectedSource: (language: string) => string;
  };
  fullCalendar: {
    title: string;
    filters: string;
    all: string;
    scheduleFor: (month: string, day: number) => string;
    selectDay: string;
    noEvents: string;
  };
}

const ENGLISH: ExtraCopy = {
  app: {
    unexpectedTitle: 'Something went wrong.',
    unexpectedBody: 'An unexpected error occurred. Please try reloading the app.',
    reloadApp: 'Reload App',
  },
  auth: {
    invitationSignInContext: 'Sign in with the email address that received this invitation. Guest access cannot accept church invitations.',
    guestUnavailable: 'Guest sign-in is not available right now. Please sign in or create an account.',
    nativeSignInTitle: 'Native Sign-In',
    nativeSignInBody: 'Use email and password in the iOS and Android apps. Google sign-in stays web-only until the native OAuth flow is configured end-to-end.',
    motto: 'Faith • Community • Tradition',
    google: 'Google',
    emailVerificationTitle: 'Verify your email',
    emailVerificationBody: 'Kandilo uses a verified account email for invitations, donations, and official tax receipt tools.',
    emailVerificationEmailLabel: 'Account email',
    emailVerificationSend: 'Send verification email',
    emailVerificationSending: 'Sending verification',
    emailVerificationCheck: "I've verified",
    emailVerificationChecking: 'Checking verification',
    emailVerificationSent: 'Verification email sent. Open the link, then return to Kandilo.',
    emailVerificationConfirmed: 'Email verified. Opening Kandilo...',
    emailVerificationStillPending: 'Email is not verified yet. Open the link in the verification email, then check again.',
    emailVerificationSendFailed: 'Unable to send a verification email right now. Try again or contact support.',
    emailVerificationCheckFailed: 'Unable to check email verification right now. Try again or contact support.',
    emailVerificationSignOut: 'Sign out',
    emailVerificationBannerTitle: 'Waiting for email verification',
    emailVerificationBannerBody: 'We sent a verification link to your account email. You can keep using Kandilo while you verify.',
    emailVerificationBannerSendAgain: 'Send again',
    emailVerificationBannerAutoSent: 'Verification email sent. Check your inbox and open the link when you can.',
    emailVerificationRateLimited: 'Please wait before requesting another verification email.',
  },
  authErrors: {
    'auth/user-not-found': 'Invalid email or password.',
    'auth/wrong-password': 'Invalid email or password.',
    'auth/invalid-credential': 'Invalid email or password.',
    'auth/email-already-in-use': 'An account already exists with this email.',
    'auth/weak-password': 'Password must be at least 6 characters.',
    'auth/invalid-email': 'Please enter a valid email address.',
    'auth/too-many-requests': 'Too many attempts. Please try again later.',
    'auth/network-request-failed': 'Network error. Please check your connection.',
    'auth/popup-closed-by-user': 'Sign-in was cancelled.',
    'auth/cancelled-popup-request': 'Sign-in was cancelled.',
    'auth/operation-not-allowed': 'This sign-in method is not enabled.',
    'auth/native-google-sign-in-unavailable': 'Google sign-in is not yet available in the native app. Use email and password.',
    fallback: 'An unexpected error occurred. Please try again.',
  },
  invitation: {
    accepting: 'Accepting your parish invitation...',
    guestCannotAccept: 'Guest accounts cannot accept church invitations. Sign out and use the invited email address.',
    alreadyMember: 'You are already a member of this parish.',
    accepted: 'Your invitation was accepted successfully.',
    unableAccept: 'Unable to accept this invitation right now.',
    label: 'Parish Invitation',
    acceptedTitle: 'Invitation accepted.',
    checkingTitle: 'Checking your invitation.',
    signOut: 'Sign Out',
    continue: 'Continue to Kandilo',
    verifyEmailToAccept: 'Verify your account email before accepting this invitation. You can keep using Kandilo and return from the invitation link after verifying.',
  },
  noMembership: {
    label: 'Membership Required',
    title: 'Your parish access can start now.',
    body: 'You can join any listed church as a member right away. Ask a parish admin or priest for an invitation if you need elevated roles.',
    churchSelectorTitle: 'Church selector',
    openProfile: 'Select Church',
  },
  profile: {
    kandiloParishioner: 'Kandilo Parishioner',
    myChurches: 'My Churches',
    discoverChurches: 'Discover Churches',
    noMemberships: 'You do not have any church memberships yet.',
    noMembershipsYet: "You haven't joined any churches yet.",
    membershipInviteOnly: 'Join any listed church as a parish member. Priests and admins can still assign elevated roles.',
    loadingChurches: 'Loading churches...',
    unableLoadChurches: 'Unable to load churches right now.',
    noPublicChurches: 'No public churches are listed right now.',
    memberOfAllChurches: "You're a member of all available churches.",
    invitationRequired: 'Open Membership',
    askInvite: 'Join this church to see parish updates and participate as a member.',
    inviteOnly: 'Available',
    joinChurch: 'Join',
    joiningChurch: 'Joining...',
    joinedChurch: 'Church joined.',
    unableJoinChurch: 'Unable to join this church right now.',
    churchLimitReached: 'You can join up to 3 churches. Leave a church before joining another.',
    emailManaged: 'Email is managed by your sign-in provider.',
    leave: 'Leave',
    confirm: 'Confirm',
    no: 'No',
    leaveChurch: 'Leave church',
    missionControl: 'Mission Control',
    signOut: 'Sign Out',
    uploadProfilePhoto: 'Upload profile photo',
    taxReceiptDetails: 'Tax Receipt Details',
    taxReceiptPrivacyNote: 'These private details are used for official tax receipt PDFs and emails. They are not shown in the parish directory.',
    taxReceiptLegalName: 'Legal Name',
    taxReceiptAddressLine1: 'Address Line 1',
    taxReceiptAddressLine2: 'Address Line 2',
    taxReceiptCity: 'City',
    taxReceiptRegion: 'State / Province',
    taxReceiptPostalCode: 'Postal Code',
    taxReceiptCountry: 'Country',
    fullNameRequired: 'Full name is required.',
    profileUpdated: 'Profile updated.',
    profilePhotoUpdated: 'Profile photo updated.',
    unableUpdateProfile: 'Unable to update your profile right now.',
    unableUpdateProfilePhoto: 'Unable to update your profile photo.',
    passwordFieldsRequired: 'All password fields are required.',
    passwordTooShort: 'New password must be at least 8 characters.',
    passwordsMustMatch: 'New password and confirmation must match.',
    passwordUpdated: 'Password updated.',
    passwordEmailOnly: 'Password changes are only available for email/password accounts.',
    avatarInvalidType: 'Profile photos must be JPG, PNG, or WebP images.',
    avatarTooLarge: 'Profile photos must be smaller than 5 MB.',
  },
  giving: {
    unexpectedCheckoutUrl: 'Unexpected checkout URL.',
    restoreFailed: 'Failed to restore pending giving state:',
    confirmMissing: 'We could not confirm this donation. Please contact your parish office if payment was taken.',
    confirming: 'Confirming your donation with Stripe...',
    stripeFailed: 'Stripe did not complete this donation. Please review and try again.',
    stillConfirming: 'Your donation is still being confirmed. A receipt will be emailed after confirmation.',
    canceled: 'Checkout was canceled. You can review your donation and try again.',
    signInRequired: 'Please sign in with your parish account before making a donation.',
    joinRequired: 'Join a parish before making a donation.',
    invalidAmount: 'Donation amount must be between $0.50 and $10,000.00.',
    unableCheckout: 'Unable to start secure checkout right now.',
    receiptsEmail: 'Receipts are sent to the email on your Kandilo account.',
    taxReceiptProfileTitle: 'Receipt profile',
    taxReceiptProfileChecking: 'Checking your saved legal receipt details...',
    taxReceiptProfileReady: 'Your saved legal name and mailing address are ready for official receipt PDFs.',
    taxReceiptProfileMissing: 'Save your legal name and mailing address before checkout so an official receipt can be emailed after donation.',
    taxReceiptProfileIncomplete: 'Legal name, address line 1, city, state/province, postal code, and country are required.',
    taxReceiptProfileRequired: 'Save your legal receipt details before continuing to Stripe so your official receipt can be emailed immediately after donation.',
    taxReceiptProfileRequiredAction: 'Save receipt details to continue',
    taxReceiptProfileSave: 'Save receipt details',
    taxReceiptProfileSaving: 'Saving...',
    taxReceiptProfileSaved: 'Receipt details saved.',
    taxReceiptProfileSaveFailed: 'Unable to save receipt details right now.',
    taxReceiptProfileOpen: 'Update Profile',
    secureCheckout: 'Secure Checkout',
    yourParish: 'Your parish',
    redirectStripe: 'You will be redirected to Stripe Checkout to securely complete this donation.',
    donor: 'Donor',
    donorAddress: 'Donor address',
    receipt: 'Receipt',
    parishioner: 'Parishioner',
    noEmail: 'No email on file',
    completeSecureCheckout: 'Complete Secure Checkout',
    emailVerificationTitle: 'Email verification required',
    emailVerificationRequired: 'Verify your account email before donating so Kandilo can send payment and tax receipts to your confirmed address.',
    emailVerificationRequiredAction: 'Send verification email',
    emailVerificationContinueAction: 'Verify email to continue',
    emailVerificationCheckAction: "I've verified",
    emailVerificationSending: 'Sending verification',
    emailVerificationChecking: 'Checking verification',
    emailVerificationSent: 'Verification email sent. Open the link, then return to Kandilo before donating.',
    emailVerificationConfirmed: 'Email verified. You can continue your donation.',
    emailVerificationStillPending: 'Email is not verified yet. Open the link in the verification email, then check again.',
    emailVerificationSendFailed: 'Unable to send a verification email right now. Try again or contact support.',
    emailVerificationCheckFailed: 'Unable to check email verification right now. Try again or contact support.',
    yourImpact: 'Your Impact',
    familiesSupported: 'Families Supported',
    donatedThisMonth: 'Donated This Month',
    goalProgress: 'Goal Progress',
    avgStewardship: 'Avg. Stewardship',
    receiptHistoryTitle: 'Receipts',
    receiptHistorySub: 'Your giving records',
    loadingReceipts: 'Loading receipts...',
    noReceiptHistory: 'Completed donations and tax receipts will appear here.',
    emailTaxReceipt: 'Email tax receipt',
    resendTaxReceipt: 'Resend tax receipt',
    emailCorrectedTaxReceipt: 'Email corrected tax receipt',
    resendCorrectedTaxReceipt: 'Resend corrected tax receipt',
    emailAnnualTaxReceipt: 'Email annual tax receipt',
    resendAnnualTaxReceipt: 'Resend annual tax receipt',
    emailCorrectedAnnualTaxReceipt: 'Email corrected annual tax receipt',
    resendCorrectedAnnualTaxReceipt: 'Resend corrected annual tax receipt',
    viewTaxReceipt: 'View tax receipt',
    downloadTaxReceipt: 'Download PDF',
    printTaxReceipt: 'Print tax receipt',
    closeReceipt: 'Close receipt',
    taxReceiptLoadError: 'Unable to load this tax receipt right now.',
    taxReceiptDownloadError: 'Unable to download this tax receipt right now.',
    officialTaxReceipt: 'Official tax receipt',
    receiptDetailsTitle: 'Tax receipt details',
    receiptDetailsSub: 'This full record is visible only to you and Kandilo support.',
    receiptNumber: 'Receipt number',
    taxId: 'Tax ID',
    issuedDate: 'Issued',
    receivedDate: 'Received',
    amount: 'Amount',
    eligibleAmount: 'Eligible amount',
    taxReceiptOriginalAmount: 'Original amount',
    taxReceiptRefundedAmount: 'Refunded amount',
    purpose: 'Purpose',
    coveredPeriod: 'Covered period',
    contributionsIncluded: 'Contributions included',
    contributionDetail: 'Contribution detail',
    contributionDate: 'Date',
    goodsServicesStatement: 'Goods and services statement',
    annualTaxReceipts: 'Annual summaries',
    annualTaxReceipt: 'annual tax receipt',
    annualReceiptIncludesPreviouslyReceipted: 'May include gifts that also have individual receipts.',
    annualReceiptMixedCurrencyBlocked: 'This donor year has missing, unsupported, or mixed currency data and needs parish review before a consolidated receipt can be sent.',
    annualReceiptAvailable: 'Year-end summary available',
    annualReceiptReady: 'Annual summary issued',
    annualTaxReceiptSentNotice: 'Annual tax receipt emailed.',
    correctedTaxReceiptSentNotice: 'Corrected tax receipt emailed.',
    correctedAnnualTaxReceiptSentNotice: 'Corrected annual tax receipt emailed.',
    taxReceiptAvailable: 'Tax receipt available',
    taxReceiptProfileNeeded: 'Receipt profile needed',
    taxReceiptUnavailable: 'Tax receipts not enabled',
    taxReceiptUnsupportedJurisdiction: 'Canadian tax receipts unavailable',
    taxReceiptIssued: 'Tax receipt issued',
    taxReceiptSent: 'Tax receipt emailed',
    taxReceiptVoided: 'Tax receipt voided',
    taxReceiptRefunded: 'Donation refunded',
    taxReceiptVoidedWarning: 'This receipt has been voided and should not be used for tax filing.',
    taxReceiptCorrectionWarning: 'This receipt needs review before it can be used for tax filing.',
    taxReceiptCorrectedWarning: 'This corrected receipt reflects a refund or adjustment. Use the eligible amount shown here instead of the prior receipt.',
    taxReceiptPending: 'Awaiting completion',
    taxReceiptError: 'Receipt needs review',
    taxReceiptSentNotice: 'Tax receipt emailed.',
    taxReceiptSendError: 'Unable to send this tax receipt right now.',
    taxReceiptEmailNotConfigured: 'Receipt email delivery is not configured yet. Please contact the parish office.',
    taxReceiptEmailInvalidConfiguration: 'Receipt email delivery needs platform setup before this can be sent. Please contact the parish office.',
    taxReceiptMissingEmailOrAmount: 'Verify your account email before retrying this receipt, or contact the parish office if the amount looks wrong.',
    taxReceiptMissingDonorProfile: 'Add your legal receipt name and mailing address in Profile before this receipt can be emailed.',
    taxReceiptPdfFailed: 'The receipt PDF could not be generated. Please try again or contact support.',
    taxReceiptProviderRejected: 'The email provider rejected this receipt. Please confirm your account email with the parish office.',
    taxReceiptGenericIssue: 'This receipt needs review before it can be sent.',
    taxReceiptPreviouslyReceiptedAckRequired: 'Confirm the annual receipt warning before emailing a summary that may include individually receipted gifts.',
    taxReceiptPartialRefundReview: 'This receipt needs correction after a partial refund. Use the corrected receipt action before sending.',
    taxReceiptIncludedInAnnual: 'Included in annual tax receipt',
    taxReceiptSingleGivingChanged: 'This receipt needs review because the donation changed after it was issued. Please try again after the parish updates the receipt.',
    taxReceiptAnnualGivingChanged: 'This annual receipt needs review because the donor-year giving records changed. Please try again after the parish updates the year-end receipt.',
    taxReceiptAnnualMixedCurrency: 'This annual receipt needs parish review because the donor-year has missing, unsupported, or mixed currency data.',
  },
  management: {
    tabs: {
      dashboard: 'Overview',
      members: 'Directory',
      events: 'Events',
      eventPlatform: 'Event Setup',
      posts: 'Posts',
      newsletters: 'Bulletins',
      notifications: 'Alerts',
      receipts: 'Receipts',
      scanner: 'Check-in',
    },
    roles: { priest: 'Priest', treasurer: 'Treasurer', admin: 'Admin', member: 'Member' },
    statuses: { active: 'Active', suspended: 'Suspended', pending: 'Pending' },
    common: {
      actions: 'Actions',
      cancel: 'Cancel',
      loading: 'Loading',
      saveChanges: 'Save Changes',
      create: 'Create',
      edit: 'Edit',
      delete: 'Delete',
      publish: 'Publish',
      saveDraft: 'Save Draft',
      draft: 'Draft',
      published: 'Published',
      notPublished: 'Not published',
      title: 'Title',
      content: 'Content',
      excerpt: 'Excerpt',
    },
    dashboard: {
      eyebrow: 'Parish Overview',
      title: 'Admin Dashboard.',
      totalMembers: 'Total Members',
      active: 'Active',
      upcomingEvents: 'Upcoming Events',
      scheduled: 'Scheduled',
      publishedBulletins: 'Published Bulletins',
      published: 'Published',
      parishFeatures: 'Parish Features',
      featureSub: 'Customize what your community sees',
      saintDays: 'Orthodox Saint Days',
      saintDaysSub: 'Show the daily saint commemoration on the home screen and mark saint days on the calendar. Recommended for Serbian Orthodox parishes.',
      stewardshipProgress: 'Stewardship Progress',
      quickActions: 'Quick Actions',
      addEvent: 'Add Event',
      writePost: 'Write Post',
      writeBulletin: 'Write Bulletin',
      sendAlert: 'Send Alert',
      viewDirectory: 'View Directory',
      funds: { general: 'General Fund', building: 'Building Fund', charity: 'Charity Fund' },
    },
    members: {
      eyebrow: 'Parish Database',
      title: 'Parish Directory.',
      memberCount: (count) => `${count} members`,
      invite: 'Invite Parishioner',
      search: 'Search by name or email...',
      noMembers: 'No members found',
      noMembersSub: 'Invite parishioners to get started',
      parishioner: 'Parishioner',
      role: 'Role',
      joined: 'Joined',
      status: 'Status',
      changeRole: 'Change Role',
      setAs: (role) => `Set as ${role}`,
      reinstate: 'Reinstate Member',
      suspend: 'Suspend Member',
    },
    events: {
      eyebrow: 'Liturgical Life',
      title: 'Event Schedule.',
      add: 'Add Event',
      noEvents: 'No events yet',
      noEventsSub: 'Create the first event for your parish',
    },
    posts: {
      eyebrow: 'Parish Communications',
      title: 'Posts',
      count: (count) => `${count} posts`,
      newPost: 'New Post',
      noPosts: 'No posts yet',
      noPostsSub: 'Write posts to keep your parishioners informed: announcements, reflections, schedules.',
      createFirst: 'Create First Post',
      by: (author) => `By ${author}`,
      updated: (date) => `Updated ${date}`,
      untitled: 'Untitled Post',
    },
    newsletters: {
      eyebrow: 'Parish Communications',
      title: 'Bulletins',
      count: (count) => `${count} bulletins`,
      newBulletin: 'New Bulletin',
      noBulletins: 'No bulletins yet',
      noBulletinsSub: 'Publish parish bulletins to notify members and keep an archive on the home screen.',
      createFirst: 'Create First Bulletin',
      editBulletin: 'Edit Bulletin',
      untitled: 'Untitled Bulletin',
      saveError: 'Unable to save this bulletin right now.',
      signedOutError: 'Please sign in again before saving bulletins.',
      validationError: 'Title, excerpt, and content are required.',
      deleteError: 'Unable to delete this bulletin right now.',
    },
    notifications: {
      eyebrow: 'Parish Alerts',
      title: 'Notifications',
      cardTitle: 'Send parish notification',
      cardSub: 'Sends a push notification and stores it in the parish notification log.',
      message: 'Message',
      audience: 'Audience',
      members: 'Members',
      admins: 'Admins',
      treasurers: 'Treasurers',
      priests: 'Priests',
      placeholderTitle: 'Service reminder',
      placeholderBody: 'Confession begins at 5:30 PM before Vespers.',
      send: 'Send Notification',
      sent: 'Notification sent.',
      sendError: 'Unable to send this notification right now.',
      validationError: 'Title and message are required.',
      audienceError: 'Select at least one audience.',
    },
    receipts: {
      eyebrow: 'Stewardship Records',
      title: 'Tax Receipts',
      cardTitle: 'Issue donor tax receipts',
      cardSub: 'Priests and treasurers can send official tax receipts from Kandilo. Assign the parish financial administrator the Treasurer role; full receipt records stay in the donor portal.',
      staffPrivacyNote: 'Receipt managers can send and resend official receipts by email. Full receipt records, donor account email, legal name/address, and retained PDFs stay donor-only.',
      loading: 'Loading receipt records...',
      emptyTitle: 'No completed donations',
      emptySub: 'Completed Stripe donations will appear here after webhooks confirm payment.',
      restrictedTitle: 'Finance access required',
      restrictedSub: 'Tax receipt sending is limited to priests and treasurers. Parish financial administrators should be assigned the Treasurer role for receipt access.',
      donor: 'Donor',
      amount: 'Amount',
      received: 'Received',
      status: 'Status',
      action: 'Action',
      originalAmount: 'Original',
      refundedAmount: 'Refunded',
      netEligibleAmount: 'Net eligible',
      anonymousDonor: 'Anonymous donor',
      anonymousProtected: 'Hidden in parish views',
      unknownDonor: 'Unknown donor',
      noEmail: 'No email on file',
      donorEmailProtected: 'Email hidden in parish views',
      ready: 'Ready',
      notConfigured: 'Not enabled',
      setupRequired: 'Tax receipt settings need to be enabled in Mission Control before receipts can be sent.',
      unsupportedJurisdiction: 'Canadian receipts unavailable',
      unsupportedJurisdictionSetupRequired: 'Canadian/CRA official receipts are not available yet. Kandilo must add read-only, encrypted, electronically signed receipt delivery with protected records and retained printable copies before Canadian receipts can be sent.',
      issued: 'Issued',
      sent: 'Sent',
      voided: 'Voided',
      error: 'Review',
      donorProfileNeeded: 'Donor profile needed',
      send: 'Send',
      resend: 'Resend',
      retrySend: 'Retry send',
      sendCorrected: 'Send corrected',
      sending: 'Sending',
      annualSummaries: 'Annual summaries',
      annualSummarySub: 'Send one consolidated receipt after a donor year closes. Donors should not claim both individual and annual receipts for the same gifts.',
      annualBatchPrivacyNote: 'Bulk annual and corrected annual sends also include eligible privacy-protected donor-years that are not listed here; identities and full receipt records stay donor-only.',
      annualSummary: 'Annual summary',
      sendAnnual: 'Send annual',
      resendAnnual: 'Resend annual',
      resendCorrectedAnnual: 'Resend corrected annual',
      includesPreviouslyReceipted: 'Includes individually receipted gifts',
      mixedCurrency: 'Mixed currency',
      mixedCurrencyAnnualBlocked: 'This donor year has missing, unsupported, or mixed currency data and needs review before a consolidated receipt can be sent.',
      annualSentNotice: 'Annual tax receipt emailed.',
      correctedSentNotice: 'Corrected tax receipt emailed.',
      correctedAnnualSentNotice: 'Corrected annual tax receipt emailed.',
      sendAllAnnual: 'Send all annual',
      sendAllCorrectedAnnual: 'Send corrected annual',
      confirmAnnualSend: 'Confirm annual send',
      confirmCorrectedAnnualSend: 'Confirm corrected send',
      confirmSendAllAnnual: 'Confirm all annual',
      confirmSendAllCorrectedAnnual: 'Confirm all corrected',
      bulkSending: 'Sending annual receipts',
      bulkCorrectedSending: 'Sending corrected receipts',
      bulkNoReceipts: 'No annual tax receipts were sent.',
      bulkNoCorrectedReceipts: 'No corrected annual tax receipts were sent.',
      bulkAlreadySent: 'All eligible annual tax receipts were already emailed.',
      bulkCorrectedAlreadySent: 'All eligible corrected annual tax receipts were already emailed.',
      bulkSentNotice: (count) => `${count} annual tax receipt${count === 1 ? '' : 's'} emailed.`,
      bulkPartialNotice: (sent, failed, truncated) => `${sent} annual receipt${sent === 1 ? '' : 's'} emailed. ${failed} failed.${truncated ? ' More donors remain beyond the batch limit.' : ''}`,
      bulkCorrectedSentNotice: (count) => `${count} corrected annual tax receipt${count === 1 ? '' : 's'} emailed.`,
      bulkCorrectedPartialNotice: (sent, failed, truncated) => `${sent} corrected annual receipt${sent === 1 ? '' : 's'} emailed. ${failed} failed.${truncated ? ' More donors remain beyond the batch limit.' : ''}`,
      loadError: 'Unable to load receipt records right now.',
      sendError: 'Unable to send this tax receipt right now.',
      emailNotConfigured: 'Receipt email delivery is not configured. Ask a SuperAdmin to set the live Resend API key before retrying.',
      emailInvalidConfiguration: 'Receipt email delivery has an invalid provider key format. Ask a SuperAdmin to check the Resend API key before retrying.',
      missingEmailOrAmount: 'Ask the donor to verify their account email, and confirm the donation amount before retrying.',
      missingDonorProfile: 'The donor must complete their private legal receipt name and mailing address before this receipt can be emailed.',
      pdfFailed: 'The receipt PDF could not be generated. Review the receipt fields or contact Kandilo support.',
      providerRejected: 'The email provider rejected this receipt. Confirm the donor email and retry.',
      genericIssue: 'This receipt needs review before it can be sent.',
      includedInAnnual: 'Included in annual',
      previouslyReceiptedAckRequired: 'Confirm the annual receipt warning before sending receipts that include individually receipted gifts.',
      partialRefundReview: 'This receipt needs correction after a partial refund. Use the corrected receipt action before sending.',
      singleIncludedInAnnual: 'This donation is already included in an annual receipt. Use the annual receipt instead of sending a separate receipt.',
      singleGivingChanged: 'This receipt needs review because the donation changed after it was issued. Reissue the donation receipt before sending.',
      annualGivingChanged: 'This annual receipt needs review because donor-year giving changed after it was issued. Reissue the year-end receipt before sending.',
      annualMixedCurrency: 'This donor year has missing, unsupported, or mixed currency data and needs review before a consolidated receipt can be sent.',
      sentNotice: 'Tax receipt emailed.',
      stripeOnboarding: 'Open Stripe onboarding',
      openingStripeOnboarding: 'Opening Stripe',
      stripeSetupChecking: 'Checking Stripe connected-account setup...',
      stripeSetupMissing: 'Ask a SuperAdmin to create or attach a Stripe connected account before opening onboarding.',
      stripeSetupUnknown: 'Stripe connected-account setup could not be confirmed yet. Ask a SuperAdmin to confirm setup before opening onboarding.',
      stripeRoutingPending: 'Stripe connected account is configured. Routing stays off until onboarding and SuperAdmin review are complete.',
      stripeRoutingEnabled: 'Stripe connected account routing is enabled for this parish.',
      stripeOnboardingOpened: 'Stripe onboarding opened.',
      stripeOnboardingReturnNotice: 'Stripe onboarding returned. Mission Control readiness will update after Stripe processes the connected account requirements.',
      stripeOnboardingRefreshNotice: 'Stripe onboarding link expired. Open Stripe onboarding again to continue setup.',
      stripeOnboardingError: 'Unable to open Stripe onboarding. Ask a SuperAdmin to confirm the connected account and live Stripe key.',
    },
    scanner: {
      eyebrow: 'Parish Attendance',
      title: 'Event Check-in.',
      checkedIn: 'Checked In',
      search: 'Search active members...',
      noEventsAvailable: 'No events available',
      noEventsTitle: 'No events to check in',
      noEventsSub: 'Create an event first, then return here to record attendance.',
      activeMembers: (count) => `${count} active members`,
      noActiveMembers: 'No active members found',
      checkedInAction: 'Checked in',
      checkInAction: 'Check in',
      loadError: 'Unable to load check-ins right now.',
      updateError: 'Unable to update check-in right now.',
    },
    invite: {
      eyebrow: 'Parish Database',
      title: 'Invite Parishioner.',
      email: 'Email',
      role: 'Role',
      member: 'Member',
      treasurer: 'Treasurer',
      admin: 'Admin',
      receiptAccessHint: 'Use Treasurer for parish financial administrators who need receipt access. Admin cannot manage tax receipts.',
      send: 'Send Invitation',
      created: 'Invitation Created',
      unable: 'Unable to send the invitation right now.',
      manual: (url) => `Invitation created, but the email could not be delivered. Share this link manually: ${url}`,
    },
    eventSheet: {
      allFields: 'Please complete all event fields.',
      signedOut: 'Please sign in again before saving events.',
      invalidDates: 'Start and end times are required.',
      endAfterStart: 'End time must be after the start time.',
      unableSave: 'Unable to save this event right now.',
      queuedWarning: 'Event save is still awaiting Firestore confirmation after the sheet closed.',
      failedAfterClose: 'Failed to save event after the sheet closed:',
      failedToStart: 'Failed to start event save after the sheet closed:',
    },
  },
  postEditor: {
    back: 'Back to Posts',
    savedAt: (time) => `Saved ${time}`,
    saveDraft: 'Save Draft',
    publish: 'Publish',
    titlePlaceholder: 'Post title...',
    authorFallback: 'Author',
    publishedAt: (date) => `Published - ${date}`,
    draft: 'Draft',
    beginPlaceholder: 'Begin writing your post...',
    titleRequired: 'Post title is required.',
    titleTooLong: 'Post title must be at most 180 characters.',
    saveFailed: 'Failed to save. Please try again.',
    aiWriter: 'AI Writer',
    aiGenerationFailed: 'AI generation failed. Please try again.',
    translationPreviewFailed: 'Translation preview failed. Please try again.',
    aiPromptLabel: 'What should the post be about?',
    aiPromptPlaceholder: 'e.g. Announce the Pascha schedule, remind parishioners about fasting, share a reflection on Great Lent...',
    tone: 'Tone:',
    previewOtherLanguages: 'Preview post in other languages',
    previewing: 'Previewing...',
    generate: 'Generate',
    generating: 'Generating...',
    preview: 'Preview',
    regenerate: 'Regenerate',
    insertIntoPost: 'Insert into Post',
    otherLanguagePreviews: 'Other language previews',
    detectedSource: (language) => `Detected source: ${language}`,
  },
  fullCalendar: {
    title: 'Full Calendar',
    filters: 'Filters',
    all: 'All',
    scheduleFor: (month, day) => `Schedule for ${month} ${day}`,
    selectDay: 'Select a day',
    noEvents: 'No events scheduled for this day',
  },
};

const SR_LAT: ExtraCopy = {
  ...ENGLISH,
  app: {
    unexpectedTitle: 'Nešto nije u redu.',
    unexpectedBody: 'Došlo je do neočekivane greške. Pokušajte da ponovo učitate aplikaciju.',
    reloadApp: 'Ponovo učitaj',
  },
  auth: {
    invitationSignInContext: 'Prijavite se email adresom na koju je stigla pozivnica. Gosti ne mogu prihvatiti crkvene pozivnice.',
    guestUnavailable: 'Prijava kao gost trenutno nije dostupna. Prijavite se ili kreirajte nalog.',
    nativeSignInTitle: 'Prijava u aplikaciji',
    nativeSignInBody: 'Koristite email i lozinku u iOS i Android aplikacijama. Google prijava ostaje samo za web dok se native OAuth tok ne podesi do kraja.',
    motto: 'Vera • Zajednica • Predanje',
    google: 'Google',
    emailVerificationTitle: 'Potvrdite email',
    emailVerificationBody: 'Kandilo koristi potvrđen email naloga za pozivnice, donacije i alate za zvanične poreske potvrde.',
    emailVerificationEmailLabel: 'Email naloga',
    emailVerificationSend: 'Pošalji email za potvrdu',
    emailVerificationSending: 'Slanje potvrde',
    emailVerificationCheck: 'Potvrdio/la sam',
    emailVerificationChecking: 'Provera potvrde',
    emailVerificationSent: 'Email za potvrdu je poslat. Otvorite link, pa se vratite u Kandilo.',
    emailVerificationConfirmed: 'Email je potvrđen. Otvaramo Kandilo...',
    emailVerificationStillPending: 'Email još nije potvrđen. Otvorite link u emailu za potvrdu, pa proverite ponovo.',
    emailVerificationSendFailed: 'Trenutno nije moguće poslati email za potvrdu. Pokušajte ponovo ili kontaktirajte podršku.',
    emailVerificationCheckFailed: 'Trenutno nije moguće proveriti potvrdu emaila. Pokušajte ponovo ili kontaktirajte podršku.',
    emailVerificationSignOut: 'Odjavi se',
    emailVerificationBannerTitle: 'Čekamo potvrdu emaila',
    emailVerificationBannerBody: 'Poslali smo link za potvrdu na email vašeg naloga. Možete nastaviti da koristite Kandilo dok potvrđujete email.',
    emailVerificationBannerSendAgain: 'Pošalji ponovo',
    emailVerificationBannerAutoSent: 'Email za potvrdu je poslat. Proverite inbox i otvorite link kada možete.',
    emailVerificationRateLimited: 'Sačekajte pre nego što zatražite još jedan email za potvrdu.',
  },
  authErrors: {
    'auth/user-not-found': 'Email ili lozinka nisu ispravni.',
    'auth/wrong-password': 'Email ili lozinka nisu ispravni.',
    'auth/invalid-credential': 'Email ili lozinka nisu ispravni.',
    'auth/email-already-in-use': 'Nalog sa ovim emailom već postoji.',
    'auth/weak-password': 'Lozinka mora imati najmanje 6 karaktera.',
    'auth/invalid-email': 'Unesite važeću email adresu.',
    'auth/too-many-requests': 'Previše pokušaja. Pokušajte kasnije.',
    'auth/network-request-failed': 'Greška mreže. Proverite vezu.',
    'auth/popup-closed-by-user': 'Prijava je otkazana.',
    'auth/cancelled-popup-request': 'Prijava je otkazana.',
    'auth/operation-not-allowed': 'Ovaj način prijave nije omogućen.',
    'auth/native-google-sign-in-unavailable': 'Google prijava još nije dostupna u native aplikaciji. Koristite email i lozinku.',
    fallback: 'Došlo je do neočekivane greške. Pokušajte ponovo.',
  },
  invitation: {
    accepting: 'Prihvatamo vašu parohijsku pozivnicu...',
    guestCannotAccept: 'Gost nalozi ne mogu prihvatiti crkvene pozivnice. Odjavite se i koristite pozvanu email adresu.',
    alreadyMember: 'Već ste član ove parohije.',
    accepted: 'Pozivnica je uspešno prihvaćena.',
    unableAccept: 'Trenutno nije moguće prihvatiti pozivnicu.',
    label: 'Parohijska pozivnica',
    acceptedTitle: 'Pozivnica prihvaćena.',
    checkingTitle: 'Provera pozivnice.',
    signOut: 'Odjavi se',
    continue: 'Nastavi u Kandilo',
    verifyEmailToAccept: 'Potvrdite email naloga pre prihvatanja ove pozivnice. Možete nastaviti da koristite Kandilo i vratiti se preko linka pozivnice nakon potvrde.',
  },
  noMembership: {
    label: 'Članstvo je potrebno',
    title: 'Pristup parohiji počinje pozivnicom.',
    body: 'Zamolite administratora ili sveštenika da pošalje pozivnicu na vašu email adresu. Dok čekate, možete pregledati crkve.',
    churchSelectorTitle: 'Izbor crkve',
    openProfile: 'Izaberi crkvu',
  },
  profile: {
    ...ENGLISH.profile,
    kandiloParishioner: 'Kandilo parohijan',
    myChurches: 'Moje crkve',
    discoverChurches: 'Pronađi crkve',
    noMemberships: 'Još nemate crkvena članstva.',
    noMembershipsYet: 'Još se niste pridružili nijednoj crkvi.',
    membershipInviteOnly: 'Pridružite se bilo kojoj navedenoj crkvi kao parohijski član. Sveštenici i administratori mogu dodeliti više uloge.',
    loadingChurches: 'Učitavanje crkava...',
    unableLoadChurches: 'Trenutno nije moguće učitati crkve.',
    noPublicChurches: 'Trenutno nema javno navedenih crkava.',
    memberOfAllChurches: 'Član ste svih dostupnih crkava.',
    invitationRequired: 'Otvoreno članstvo',
    askInvite: 'Pridružite se ovoj crkvi da vidite parohijske objave i učestvujete kao član.',
    inviteOnly: 'Dostupno',
    joinChurch: 'Pridruži se',
    joiningChurch: 'Pridruživanje...',
    joinedChurch: 'Pridružili ste se crkvi.',
    unableJoinChurch: 'Trenutno nije moguće pridružiti se ovoj crkvi.',
    churchLimitReached: 'Možete se pridružiti najviše 3 crkve. Napustite jednu crkvu pre pridruživanja drugoj.',
    emailManaged: 'Email se upravlja preko vašeg načina prijave.',
    leave: 'Napusti',
    confirm: 'Potvrdi',
    no: 'Ne',
    leaveChurch: 'Napusti crkvu',
    signOut: 'Odjavi se',
    fullNameRequired: 'Ime i prezime je obavezno.',
    profileUpdated: 'Profil je ažuriran.',
    profilePhotoUpdated: 'Fotografija profila je ažurirana.',
    unableUpdateProfile: 'Trenutno nije moguće ažurirati profil.',
    unableUpdateProfilePhoto: 'Nije moguće ažurirati fotografiju profila.',
    passwordFieldsRequired: 'Sva polja za lozinku su obavezna.',
    passwordTooShort: 'Nova lozinka mora imati najmanje 8 karaktera.',
    passwordsMustMatch: 'Nova lozinka i potvrda moraju se poklapati.',
    passwordUpdated: 'Lozinka je ažurirana.',
    passwordEmailOnly: 'Promena lozinke je dostupna samo za email/lozinka naloge.',
  },
  giving: {
    ...ENGLISH.giving,
    confirmMissing: 'Ne možemo potvrditi ovu donaciju. Kontaktirajte parohijsku kancelariju ako je uplata skinuta.',
    confirming: 'Potvrđujemo donaciju preko Stripe-a...',
    stripeFailed: 'Stripe nije završio donaciju. Proverite i pokušajte ponovo.',
    stillConfirming: 'Donacija se još potvrđuje. Potvrda će stići emailom nakon potvrde.',
    canceled: 'Plaćanje je otkazano. Možete proveriti donaciju i pokušati ponovo.',
    signInRequired: 'Prijavite se parohijskim nalogom pre donacije.',
    joinRequired: 'Pridružite se parohiji pre donacije.',
    invalidAmount: 'Iznos donacije mora biti između $0.50 i $10,000.00.',
    unableCheckout: 'Trenutno nije moguće pokrenuti sigurno plaćanje.',
    receiptsEmail: 'Potvrde se šalju na email vašeg Kandilo naloga.',
    secureCheckout: 'Sigurno plaćanje',
    yourParish: 'Vaša parohija',
    redirectStripe: 'Bićete preusmereni na Stripe Checkout da sigurno završite donaciju.',
    donor: 'Donator',
    receipt: 'Potvrda',
    parishioner: 'Parohijan',
    noEmail: 'Email nije dostupan',
    completeSecureCheckout: 'Završi sigurno plaćanje',
    yourImpact: 'Vaš doprinos',
    familiesSupported: 'Podržane porodice',
    donatedThisMonth: 'Donirano ovog meseca',
    goalProgress: 'Napredak cilja',
    avgStewardship: 'Prosečno starateljstvo',
  },
  management: {
    ...ENGLISH.management,
    tabs: { dashboard: 'Pregled', members: 'Imenik', events: 'Događaji', eventPlatform: 'Podešavanje događaja', posts: 'Objave', newsletters: 'Bilteni', notifications: 'Obaveštenja', receipts: 'Potvrde', scanner: 'Prijava' },
    roles: { priest: 'Sveštenik', treasurer: 'Blagajnik', admin: 'Administrator', member: 'Član' },
    statuses: { active: 'Aktivan', suspended: 'Suspendovan', pending: 'Na čekanju' },
    common: { ...ENGLISH.management.common, actions: 'Akcije', cancel: 'Otkaži', saveChanges: 'Sačuvaj izmene', edit: 'Izmeni', publish: 'Objavi', saveDraft: 'Sačuvaj nacrt', draft: 'Nacrt', published: 'Objavljeno', notPublished: 'Nije objavljeno', title: 'Naslov', content: 'Sadržaj', excerpt: 'Sažetak' },
    dashboard: { ...ENGLISH.management.dashboard, eyebrow: 'Pregled parohije', title: 'Administracija.', totalMembers: 'Ukupno članova', active: 'Aktivni', upcomingEvents: 'Predstojeći događaji', scheduled: 'Zakazano', publishedBulletins: 'Objavljeni bilteni', published: 'Objavljeno', parishFeatures: 'Parohijske opcije', featureSub: 'Podesite šta zajednica vidi', saintDays: 'Pravoslavni svetitelji', saintDaysSub: 'Prikaži dnevni spomen svetitelja na početnoj strani i kalendaru.', stewardshipProgress: 'Napredak starateljstva', quickActions: 'Brze akcije', addEvent: 'Dodaj događaj', writePost: 'Napiši objavu', writeBulletin: 'Napiši bilten', sendAlert: 'Pošalji obaveštenje', viewDirectory: 'Vidi imenik', funds: { general: 'Opšti fond', building: 'Građevinski fond', charity: 'Dobrotvorni fond' } },
    members: { ...ENGLISH.management.members, invite: 'Pozovi parohijana', search: 'Pretraži po imenu ili emailu...', noMembers: 'Nema članova', noMembersSub: 'Pozovite parohijane za početak', parishioner: 'Parohijan', role: 'Uloga', joined: 'Pridružen', status: 'Status', changeRole: 'Promeni ulogu', setAs: (role) => `Postavi kao ${role}`, reinstate: 'Vrati člana', suspend: 'Suspenduj člana', memberCount: (count) => `${count} članova`, eyebrow: 'Parohijska baza', title: 'Parohijski imenik.' },
    events: { eyebrow: 'Bogoslužbeni život', title: 'Raspored događaja.', add: 'Dodaj događaj', noEvents: 'Još nema događaja', noEventsSub: 'Kreirajte prvi događaj za parohiju' },
    posts: { ...ENGLISH.management.posts, eyebrow: 'Parohijske komunikacije', title: 'Objave', count: (count) => `${count} objava`, newPost: 'Nova objava', noPosts: 'Još nema objava', noPostsSub: 'Pišite objave da informišete parohijane.', createFirst: 'Kreiraj prvu objavu', by: (author) => `Autor: ${author}`, updated: (date) => `Ažurirano ${date}`, untitled: 'Objava bez naslova' },
    newsletters: { ...ENGLISH.management.newsletters, eyebrow: 'Parohijske komunikacije', title: 'Bilteni', count: (count) => `${count} biltena`, newBulletin: 'Novi bilten', noBulletins: 'Još nema biltena', noBulletinsSub: 'Objavite biltene da obavestite članove i sačuvate arhivu.', createFirst: 'Kreiraj prvi bilten', editBulletin: 'Izmeni bilten', untitled: 'Bilten bez naslova', saveError: 'Trenutno nije moguće sačuvati bilten.', signedOutError: 'Prijavite se ponovo pre čuvanja biltena.', validationError: 'Naslov, sažetak i sadržaj su obavezni.', deleteError: 'Trenutno nije moguće obrisati bilten.' },
    notifications: { ...ENGLISH.management.notifications, eyebrow: 'Parohijska obaveštenja', title: 'Obaveštenja', cardTitle: 'Pošalji parohijsko obaveštenje', cardSub: 'Šalje push obaveštenje i čuva ga u dnevniku parohije.', message: 'Poruka', audience: 'Primaoci', members: 'Članovi', admins: 'Administratori', treasurers: 'Blagajnici', priests: 'Sveštenici', send: 'Pošalji obaveštenje', sent: 'Obaveštenje poslato.', sendError: 'Trenutno nije moguće poslati obaveštenje.', validationError: 'Naslov i poruka su obavezni.', audienceError: 'Izaberite bar jednu publiku.' },
    scanner: { ...ENGLISH.management.scanner, eyebrow: 'Parohijska prisutnost', title: 'Prijava za događaj.', checkedIn: 'Prijavljeno', search: 'Pretraži aktivne članove...', noEventsAvailable: 'Nema dostupnih događaja', noEventsTitle: 'Nema događaja za prijavu', noEventsSub: 'Prvo kreirajte događaj, pa se vratite ovde da zabeležite prisutnost.', activeMembers: (count) => `${count} aktivnih članova`, noActiveMembers: 'Nema aktivnih članova', checkedInAction: 'Prijavljen', checkInAction: 'Prijavi', loadError: 'Trenutno nije moguće učitati prijave.', updateError: 'Trenutno nije moguće ažurirati prijavu.' },
    invite: { ...ENGLISH.management.invite, email: 'Email', role: 'Uloga', member: 'Član', treasurer: 'Blagajnik', admin: 'Administrator', send: 'Pošalji pozivnicu', created: 'Pozivnica kreirana', unable: 'Trenutno nije moguće poslati pozivnicu.', manual: (url) => `Pozivnica je kreirana, ali email nije isporučen. Podelite link ručno: ${url}` },
    eventSheet: { ...ENGLISH.management.eventSheet, allFields: 'Popunite sva polja događaja.', signedOut: 'Prijavite se ponovo pre čuvanja događaja.', invalidDates: 'Početak i kraj su obavezni.', endAfterStart: 'Kraj mora biti posle početka.', unableSave: 'Trenutno nije moguće sačuvati događaj.' },
  },
  postEditor: {
    ...ENGLISH.postEditor,
    back: 'Nazad na objave',
    savedAt: (time) => `Sačuvano ${time}`,
    saveDraft: 'Sačuvaj nacrt',
    publish: 'Objavi',
    titlePlaceholder: 'Naslov objave...',
    authorFallback: 'Autor',
    publishedAt: (date) => `Objavljeno - ${date}`,
    draft: 'Nacrt',
    beginPlaceholder: 'Počnite da pišete objavu...',
    titleRequired: 'Naslov objave je obavezan.',
    titleTooLong: 'Naslov objave može imati najviše 180 karaktera.',
    saveFailed: 'Čuvanje nije uspelo. Pokušajte ponovo.',
  },
  fullCalendar: {
    title: 'Ceo kalendar',
    filters: 'Filteri',
    all: 'Sve',
    scheduleFor: (month, day) => `Raspored za ${day}. ${month}`,
    selectDay: 'Izaberite dan',
    noEvents: 'Nema zakazanih događaja za ovaj dan',
  },
};

const SR_CYR: ExtraCopy = {
  ...SR_LAT,
  app: {
    unexpectedTitle: 'Нешто није у реду.',
    unexpectedBody: 'Дошло је до неочекиване грешке. Покушајте поново да учитате апликацију.',
    reloadApp: 'Поново учитај',
  },
  auth: {
    ...SR_LAT.auth,
    invitationSignInContext: 'Пријавите се емаил адресом на коју је стигла позивница. Гости не могу прихватити црквене позивнице.',
    guestUnavailable: 'Пријава као гост тренутно није доступна. Пријавите се или креирајте налог.',
    nativeSignInTitle: 'Пријава у апликацији',
    nativeSignInBody: 'Користите емаил и лозинку у iOS и Android апликацијама. Google пријава остаје само за веб док се native OAuth ток не подеси до краја.',
    motto: 'Вера • Заједница • Предање',
    google: 'Google',
  },
  authErrors: {
    ...SR_LAT.authErrors,
    'auth/user-not-found': 'Емаил или лозинка нису исправни.',
    'auth/wrong-password': 'Емаил или лозинка нису исправни.',
    'auth/invalid-credential': 'Емаил или лозинка нису исправни.',
    'auth/email-already-in-use': 'Налог са овим емаилом већ постоји.',
    'auth/weak-password': 'Лозинка мора имати најмање 6 карактера.',
    'auth/invalid-email': 'Унесите важећу емаил адресу.',
    'auth/too-many-requests': 'Превише покушаја. Покушајте касније.',
    'auth/network-request-failed': 'Грешка мреже. Проверите везу.',
    fallback: 'Дошло је до неочекиване грешке. Покушајте поново.',
  },
  invitation: {
    accepting: 'Прихватамо вашу парохијску позивницу...',
    guestCannotAccept: 'Гост налози не могу прихватити црквене позивнице. Одјавите се и користите позвану емаил адресу.',
    alreadyMember: 'Већ сте члан ове парохије.',
    accepted: 'Позивница је успешно прихваћена.',
    unableAccept: 'Тренутно није могуће прихватити позивницу.',
    label: 'Парохијска позивница',
    acceptedTitle: 'Позивница прихваћена.',
    checkingTitle: 'Провера позивнице.',
    signOut: 'Одјави се',
    continue: 'Настави у Кандило',
    verifyEmailToAccept: 'Потврдите емаил налога пре прихватања ове позивнице. Можете наставити да користите Кандило и вратити се преко линка позивнице након потврде.',
  },
  noMembership: {
    label: 'Чланство је потребно',
    title: 'Приступ парохији почиње позивницом.',
    body: 'Замолите администратора или свештеника да пошаље позивницу на вашу емаил адресу. Док чекате, можете прегледати цркве.',
    churchSelectorTitle: 'Избор цркве',
    openProfile: 'Изабери цркву',
  },
  profile: { ...SR_LAT.profile, kandiloParishioner: 'Кандило парохијан', myChurches: 'Моје цркве', discoverChurches: 'Пронађи цркве', signOut: 'Одјави се' },
  management: { ...SR_LAT.management, scanner: { ...SR_LAT.management.scanner, eyebrow: 'Парохијска присутност', title: 'Пријава за догађај.', checkedIn: 'Пријављено', search: 'Претражи активне чланове...', noEventsAvailable: 'Нема доступних догађаја', noEventsTitle: 'Нема догађаја за пријаву', noEventsSub: 'Прво креирајте догађај, па се вратите овде да забележите присутност.', activeMembers: (count) => `${count} активних чланова`, noActiveMembers: 'Нема активних чланова', checkedInAction: 'Пријављен', checkInAction: 'Пријави', loadError: 'Тренутно није могуће учитати пријаве.', updateError: 'Тренутно није могуће ажурирати пријаву.' } },
  fullCalendar: {
    title: 'Цео календар',
    filters: 'Филтери',
    all: 'Све',
    scheduleFor: (month, day) => `Распоред за ${day}. ${month}`,
    selectDay: 'Изаберите дан',
    noEvents: 'Нема заказаних догађаја за овај дан',
  },
};

const RU: ExtraCopy = {
  ...ENGLISH,
  app: {
    unexpectedTitle: 'Что-то пошло не так.',
    unexpectedBody: 'Произошла неожиданная ошибка. Попробуйте перезагрузить приложение.',
    reloadApp: 'Перезагрузить',
  },
  auth: {
    ...ENGLISH.auth,
    invitationSignInContext: 'Войдите с email-адресом, на которую пришло приглашение. Гостевой доступ не может принимать церковные приглашения.',
    guestUnavailable: 'Гостевой вход сейчас недоступен. Войдите или создайте аккаунт.',
    nativeSignInTitle: 'Вход в приложении',
    nativeSignInBody: 'Используйте email и пароль в iOS и Android. Google-вход остается только для веба до полной настройки native OAuth.',
    motto: 'Вера • Община • Предание',
    google: 'Google',
  },
  authErrors: {
    'auth/user-not-found': 'Неверный email или пароль.',
    'auth/wrong-password': 'Неверный email или пароль.',
    'auth/invalid-credential': 'Неверный email или пароль.',
    'auth/email-already-in-use': 'Аккаунт с этим email уже существует.',
    'auth/weak-password': 'Пароль должен содержать минимум 6 символов.',
    'auth/invalid-email': 'Введите действительный email.',
    'auth/too-many-requests': 'Слишком много попыток. Попробуйте позже.',
    'auth/network-request-failed': 'Ошибка сети. Проверьте соединение.',
    'auth/popup-closed-by-user': 'Вход отменен.',
    'auth/cancelled-popup-request': 'Вход отменен.',
    'auth/operation-not-allowed': 'Этот способ входа не включен.',
    'auth/native-google-sign-in-unavailable': 'Google-вход пока недоступен в native приложении. Используйте email и пароль.',
    fallback: 'Произошла неожиданная ошибка. Попробуйте еще раз.',
  },
  invitation: {
    accepting: 'Принимаем ваше приходское приглашение...',
    guestCannotAccept: 'Гостевые аккаунты не могут принимать церковные приглашения. Выйдите и используйте приглашенный email.',
    alreadyMember: 'Вы уже являетесь членом этого прихода.',
    accepted: 'Приглашение успешно принято.',
    unableAccept: 'Сейчас не удалось принять приглашение.',
    label: 'Приходское приглашение',
    acceptedTitle: 'Приглашение принято.',
    checkingTitle: 'Проверяем приглашение.',
    signOut: 'Выйти',
    continue: 'Продолжить в Kandilo',
    verifyEmailToAccept: ENGLISH.invitation.verifyEmailToAccept,
  },
  noMembership: {
    label: 'Требуется членство',
    title: 'Доступ к приходу начинается с приглашения.',
    body: 'Попросите администратора или священника отправить приглашение на ваш email. Пока ждете, можно посмотреть доступные приходы.',
    churchSelectorTitle: 'Выбор церкви',
    openProfile: 'Выбрать церковь',
  },
  profile: { ...ENGLISH.profile, kandiloParishioner: 'Прихожанин Kandilo', myChurches: 'Мои церкви', discoverChurches: 'Найти церкви', signOut: 'Выйти' },
  giving: { ...ENGLISH.giving, secureCheckout: 'Безопасная оплата', yourParish: 'Ваш приход', donor: 'Жертвователь', receipt: 'Квитанция', parishioner: 'Прихожанин', noEmail: 'Email не указан', completeSecureCheckout: 'Завершить безопасную оплату', yourImpact: 'Ваш вклад', familiesSupported: 'Семей поддержано', donatedThisMonth: 'Пожертвовано в этом месяце', goalProgress: 'Прогресс цели', avgStewardship: 'Среднее пожертвование' },
  management: { ...ENGLISH.management, tabs: { dashboard: 'Обзор', members: 'Справочник', events: 'События', eventPlatform: 'Настройка события', posts: 'Посты', newsletters: 'Бюллетени', notifications: 'Оповещения', receipts: 'Квитанции', scanner: 'Регистрация' }, roles: { priest: 'Священник', treasurer: 'Казначей', admin: 'Администратор', member: 'Член' }, scanner: { ...ENGLISH.management.scanner, eyebrow: 'Приходская посещаемость', title: 'Регистрация на событие.', checkedIn: 'Отмечены', search: 'Поиск активных членов...', noEventsAvailable: 'Нет доступных событий', noEventsTitle: 'Нет событий для регистрации', noEventsSub: 'Сначала создайте событие, затем вернитесь сюда, чтобы отметить посещаемость.', activeMembers: (count) => `${count} активных членов`, noActiveMembers: 'Активные члены не найдены', checkedInAction: 'Отмечен', checkInAction: 'Отметить', loadError: 'Сейчас не удалось загрузить регистрации.', updateError: 'Сейчас не удалось обновить регистрацию.' } },
  postEditor: { ...ENGLISH.postEditor, back: 'Назад к постам', saveDraft: 'Сохранить черновик', publish: 'Опубликовать', titlePlaceholder: 'Заголовок поста...', draft: 'Черновик' },
  fullCalendar: { title: 'Полный календарь', filters: 'Фильтры', all: 'Все', scheduleFor: (month, day) => `Расписание на ${day} ${month}`, selectDay: 'Выберите день', noEvents: 'На этот день событий нет' },
};

const RO: ExtraCopy = {
  ...ENGLISH,
  app: {
    unexpectedTitle: 'Ceva nu a mers bine.',
    unexpectedBody: 'A apărut o eroare neașteptată. Te rugăm să reîncarci aplicația.',
    reloadApp: 'Reîncarcă',
  },
  auth: {
    ...ENGLISH.auth,
    invitationSignInContext: 'Autentifică-te cu adresa de email care a primit invitația. Conturile de vizitator nu pot accepta invitații.',
    guestUnavailable: 'Autentificarea ca vizitator nu este disponibilă acum. Autentifică-te sau creează un cont.',
    nativeSignInTitle: 'Autentificare în aplicație',
    nativeSignInBody: 'Folosește email și parolă în aplicațiile iOS și Android. Autentificarea Google rămâne doar web până la configurarea completă OAuth.',
    motto: 'Credință • Comunitate • Tradiție',
    google: 'Google',
  },
  authErrors: {
    'auth/user-not-found': 'Email sau parolă incorectă.',
    'auth/wrong-password': 'Email sau parolă incorectă.',
    'auth/invalid-credential': 'Email sau parolă incorectă.',
    'auth/email-already-in-use': 'Există deja un cont cu acest email.',
    'auth/weak-password': 'Parola trebuie să aibă minimum 6 caractere.',
    'auth/invalid-email': 'Introdu o adresă de email validă.',
    'auth/too-many-requests': 'Prea multe încercări. Încearcă mai târziu.',
    'auth/network-request-failed': 'Eroare de rețea. Verifică conexiunea.',
    'auth/popup-closed-by-user': 'Autentificarea a fost anulată.',
    'auth/cancelled-popup-request': 'Autentificarea a fost anulată.',
    'auth/operation-not-allowed': 'Această metodă de autentificare nu este activată.',
    'auth/native-google-sign-in-unavailable': 'Autentificarea Google nu este încă disponibilă în aplicația nativă. Folosește email și parolă.',
    fallback: 'A apărut o eroare neașteptată. Încearcă din nou.',
  },
  invitation: {
    accepting: 'Acceptăm invitația parohială...',
    guestCannotAccept: 'Conturile de vizitator nu pot accepta invitații. Deconectează-te și folosește emailul invitat.',
    alreadyMember: 'Ești deja membru al acestei parohii.',
    accepted: 'Invitația a fost acceptată cu succes.',
    unableAccept: 'Nu se poate accepta invitația acum.',
    label: 'Invitație parohială',
    acceptedTitle: 'Invitație acceptată.',
    checkingTitle: 'Verificăm invitația.',
    signOut: 'Deconectare',
    continue: 'Continuă în Kandilo',
    verifyEmailToAccept: ENGLISH.invitation.verifyEmailToAccept,
  },
  noMembership: {
    label: 'Este necesară calitatea de membru',
    title: 'Accesul la parohie începe cu o invitație.',
    body: 'Cere unui administrator sau preot să trimită o invitație la adresa ta de email. Poți vedea bisericile listate în timp ce aștepți.',
    churchSelectorTitle: 'Selector biserică',
    openProfile: 'Selectează biserica',
  },
  profile: { ...ENGLISH.profile, kandiloParishioner: 'Enoriaș Kandilo', myChurches: 'Bisericile mele', discoverChurches: 'Descoperă biserici', signOut: 'Deconectare' },
  giving: { ...ENGLISH.giving, secureCheckout: 'Plată securizată', yourParish: 'Parohia ta', donor: 'Donator', receipt: 'Chitanță', parishioner: 'Enoriaș', noEmail: 'Niciun email', completeSecureCheckout: 'Finalizează plata securizată', yourImpact: 'Impactul tău', familiesSupported: 'Familii sprijinite', donatedThisMonth: 'Donat luna aceasta', goalProgress: 'Progresul obiectivului', avgStewardship: 'Donație medie' },
  management: { ...ENGLISH.management, tabs: { dashboard: 'Privire generală', members: 'Director', events: 'Evenimente', eventPlatform: 'Configurare eveniment', posts: 'Postări', newsletters: 'Buletine', notifications: 'Alerte', receipts: 'Chitanțe', scanner: 'Check-in' }, roles: { priest: 'Preot', treasurer: 'Trezorier', admin: 'Administrator', member: 'Membru' }, scanner: { ...ENGLISH.management.scanner, eyebrow: 'Prezență parohială', title: 'Check-in eveniment.', checkedIn: 'Înregistrați', search: 'Caută membri activi...', noEventsAvailable: 'Nu există evenimente disponibile', noEventsTitle: 'Nu există evenimente pentru check-in', noEventsSub: 'Creează mai întâi un eveniment, apoi revino aici pentru prezență.', activeMembers: (count) => `${count} membri activi`, noActiveMembers: 'Nu s-au găsit membri activi', checkedInAction: 'Înregistrat', checkInAction: 'Înregistrează', loadError: 'Nu se pot încărca înregistrările acum.', updateError: 'Nu se poate actualiza check-in-ul acum.' } },
  postEditor: { ...ENGLISH.postEditor, back: 'Înapoi la postări', saveDraft: 'Salvează ciornă', publish: 'Publică', titlePlaceholder: 'Titlul postării...', draft: 'Ciornă' },
  fullCalendar: { title: 'Calendar complet', filters: 'Filtre', all: 'Toate', scheduleFor: (month, day) => `Program pentru ${day} ${month}`, selectDay: 'Selectează o zi', noEvents: 'Nu sunt evenimente programate pentru această zi' },
};

const UK: ExtraCopy = {
  ...ENGLISH,
  app: {
    unexpectedTitle: 'Щось пішло не так.',
    unexpectedBody: 'Сталася неочікувана помилка. Спробуйте перезавантажити додаток.',
    reloadApp: 'Перезавантажити',
  },
  auth: {
    ...ENGLISH.auth,
    invitationSignInContext: 'Увійдіть з email-адресою, на яку надійшло запрошення. Гостьовий доступ не може приймати церковні запрошення.',
    guestUnavailable: 'Гостьовий вхід зараз недоступний. Увійдіть або створіть акаунт.',
    nativeSignInTitle: 'Вхід у додатку',
    nativeSignInBody: 'Використовуйте email і пароль в iOS та Android. Google-вхід залишається тільки вебом до повного налаштування native OAuth.',
    motto: 'Віра • Спільнота • Передання',
    google: 'Google',
  },
  authErrors: {
    'auth/user-not-found': 'Неправильний email або пароль.',
    'auth/wrong-password': 'Неправильний email або пароль.',
    'auth/invalid-credential': 'Неправильний email або пароль.',
    'auth/email-already-in-use': 'Акаунт з цим email вже існує.',
    'auth/weak-password': 'Пароль має містити щонайменше 6 символів.',
    'auth/invalid-email': 'Введіть дійсну email-адресу.',
    'auth/too-many-requests': 'Забагато спроб. Спробуйте пізніше.',
    'auth/network-request-failed': 'Помилка мережі. Перевірте зʼєднання.',
    'auth/popup-closed-by-user': 'Вхід скасовано.',
    'auth/cancelled-popup-request': 'Вхід скасовано.',
    'auth/operation-not-allowed': 'Цей спосіб входу не увімкнено.',
    'auth/native-google-sign-in-unavailable': 'Google-вхід ще недоступний у native додатку. Використовуйте email і пароль.',
    fallback: 'Сталася неочікувана помилка. Спробуйте ще раз.',
  },
  invitation: {
    accepting: 'Приймаємо ваше парафіяльне запрошення...',
    guestCannotAccept: 'Гостьові акаунти не можуть приймати церковні запрошення. Вийдіть і використайте запрошений email.',
    alreadyMember: 'Ви вже є членом цієї парафії.',
    accepted: 'Запрошення успішно прийнято.',
    unableAccept: 'Зараз не вдалося прийняти запрошення.',
    label: 'Парафіяльне запрошення',
    acceptedTitle: 'Запрошення прийнято.',
    checkingTitle: 'Перевіряємо запрошення.',
    signOut: 'Вийти',
    continue: 'Продовжити в Kandilo',
    verifyEmailToAccept: ENGLISH.invitation.verifyEmailToAccept,
  },
  noMembership: {
    label: 'Потрібне членство',
    title: 'Доступ до парафії починається із запрошення.',
    body: 'Попросіть адміністратора або священника надіслати запрошення на вашу email-адресу. Поки чекаєте, можна переглядати доступні церкви.',
    churchSelectorTitle: 'Вибір церкви',
    openProfile: 'Вибрати церкву',
  },
  profile: { ...ENGLISH.profile, kandiloParishioner: 'Парафіянин Kandilo', myChurches: 'Мої церкви', discoverChurches: 'Знайти церкви', signOut: 'Вийти' },
  giving: { ...ENGLISH.giving, secureCheckout: 'Безпечна оплата', yourParish: 'Ваша парафія', donor: 'Жертводавець', receipt: 'Квитанція', parishioner: 'Парафіянин', noEmail: 'Email не вказано', completeSecureCheckout: 'Завершити безпечну оплату', yourImpact: 'Ваш внесок', familiesSupported: 'Сімей підтримано', donatedThisMonth: 'Пожертвувано цього місяця', goalProgress: 'Прогрес цілі', avgStewardship: 'Середня пожертва' },
  management: { ...ENGLISH.management, tabs: { dashboard: 'Огляд', members: 'Довідник', events: 'Події', eventPlatform: 'Налаштування події', posts: 'Пости', newsletters: 'Бюлетені', notifications: 'Оповіщення', receipts: 'Квитанції', scanner: 'Реєстрація' }, roles: { priest: 'Священник', treasurer: 'Скарбник', admin: 'Адміністратор', member: 'Член' }, scanner: { ...ENGLISH.management.scanner, eyebrow: 'Парафіяльна відвідуваність', title: 'Реєстрація на подію.', checkedIn: 'Зареєстровано', search: 'Пошук активних членів...', noEventsAvailable: 'Немає доступних подій', noEventsTitle: 'Немає подій для реєстрації', noEventsSub: 'Спочатку створіть подію, а потім поверніться сюди, щоб записати відвідуваність.', activeMembers: (count) => `${count} активних членів`, noActiveMembers: 'Активних членів не знайдено', checkedInAction: 'Зареєстровано', checkInAction: 'Зареєструвати', loadError: 'Зараз не вдалося завантажити реєстрації.', updateError: 'Зараз не вдалося оновити реєстрацію.' } },
  postEditor: { ...ENGLISH.postEditor, back: 'Назад до постів', saveDraft: 'Зберегти чернетку', publish: 'Опублікувати', titlePlaceholder: 'Заголовок поста...', draft: 'Чернетка' },
  fullCalendar: { title: 'Повний календар', filters: 'Фільтри', all: 'Усе', scheduleFor: (month, day) => `Розклад на ${day} ${month}`, selectDay: 'Виберіть день', noEvents: 'На цей день подій не заплановано' },
};

export const EXTRA_COPY: Record<Language, ExtraCopy> = {
  English: ENGLISH,
  'Srpski (Latinica)': SR_LAT,
  'Srpski (Ćirilica)': SR_CYR,
  Русский: RU,
  Română: RO,
  Українська: UK,
};

export function getExtraCopy(language: Language): ExtraCopy {
  return EXTRA_COPY[language] ?? ENGLISH;
}

export function getLocalizedAuthError(code: string, language: Language): string {
  const messages = getExtraCopy(language).authErrors;
  return messages[code] ?? messages.fallback;
}
