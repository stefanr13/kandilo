#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { deleteApp, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, Timestamp, getFirestore } from 'firebase-admin/firestore';

const PROJECT_ID = 'kandilo-2f7a9';
const CHURCH_ID = 'church-1';
const CANADA_CHURCH_ID = 'church-ca-1';
const PASSWORD = 'Password123!';
const FIRESTORE_EMULATOR_HOST_ENV = 'FIRESTORE_EMULATOR_HOST';
const AUTH_EMULATOR_HOST_ENV = 'FIREBASE_AUTH_EMULATOR_HOST';
const DEFAULT_FIRESTORE_EMULATOR_HOST = '127.0.0.1:8088';
const DEFAULT_AUTH_EMULATOR_HOST = '127.0.0.1:9098';
const usage = `Usage:
  npm run seed:receipt-emulator

Options:
  -h, --help   Show this help text.`;

function validateSeedArgs(args) {
  const helpFlags = new Set(['-h', '--help']);
  for (const arg of args) {
    if (!arg.startsWith('-')) {
      throw new Error(`Unexpected positional argument: ${arg}`);
    }

    const equalsIndex = arg.indexOf('=');
    const name = equalsIndex >= 0 ? arg.slice(0, equalsIndex) : arg;
    if (!helpFlags.has(name)) {
      throw new Error(`Unknown argument ${name}.`);
    }
    if (equalsIndex >= 0) {
      throw new Error(`${name} does not accept a value.`);
    }
  }
}

const seedArgs = process.argv.slice(2);
try {
  validateSeedArgs(seedArgs);
  if (seedArgs.includes('-h') || seedArgs.includes('--help')) {
    console.log(usage);
    process.exit(0);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  console.error('');
  console.error(usage);
  process.exit(1);
}

function useDefaultEmulatorHost(envName, defaultValue) {
  if (!process.env[envName]) {
    process.env[envName] = defaultValue;
  }
}

useDefaultEmulatorHost(FIRESTORE_EMULATOR_HOST_ENV, DEFAULT_FIRESTORE_EMULATOR_HOST);
useDefaultEmulatorHost(AUTH_EMULATOR_HOST_ENV, DEFAULT_AUTH_EMULATOR_HOST);
process.env.GCLOUD_PROJECT = PROJECT_ID;
process.env.GOOGLE_CLOUD_PROJECT = PROJECT_ID;

function assertLocalEmulatorHost(envName, host) {
  const value = String(host ?? '').trim();
  let url;

  try {
    url = new URL(`http://${value}`);
  } catch {
    throw new Error(
      `Refusing to seed because ${envName} must be a local emulator host:port value. Got: ${value || '<unset>'}`
    );
  }

  const normalizedHostname = url.hostname.toLowerCase();
  const isLocal = normalizedHostname === '127.0.0.1'
    || normalizedHostname === 'localhost'
    || normalizedHostname === '[::1]'
    || normalizedHostname === '::1';
  const port = Number.parseInt(url.port, 10);
  const hasUnexpectedUrlParts = Boolean(
    url.username || url.password || url.pathname !== '/' || url.search || url.hash
  );

  if (!isLocal || hasUnexpectedUrlParts || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(
      `Refusing to seed because ${envName} must be a local emulator host:port value. Got: ${value || '<unset>'}`
    );
  }

  return url.host;
}

const firestoreEmulatorHost = assertLocalEmulatorHost(
  FIRESTORE_EMULATOR_HOST_ENV,
  process.env[FIRESTORE_EMULATOR_HOST_ENV]
);
const authEmulatorHost = assertLocalEmulatorHost(
  AUTH_EMULATOR_HOST_ENV,
  process.env[AUTH_EMULATOR_HOST_ENV]
);

function assertFetchAvailable() {
  if (typeof fetch !== 'function') {
    throw new Error('This seed script requires a Node runtime with fetch support.');
  }
}

async function deleteEmulatorState(label, url) {
  const response = await fetch(url, { method: 'DELETE' });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`${label} emulator clear failed with HTTP ${response.status}${body ? `: ${body}` : ''}`);
  }
}

async function clearEmulators() {
  assertFetchAvailable();

  await Promise.all([
    deleteEmulatorState(
      'Firestore',
      `http://${firestoreEmulatorHost}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`
    ),
    deleteEmulatorState(
      'Auth',
      `http://${authEmulatorHost}/emulator/v1/projects/${PROJECT_ID}/accounts`
    ),
  ]);
}

function annualTaxReceiptDocId(churchId, userId, year) {
  const digest = createHash('sha256')
    .update(`${churchId}:${userId}:${year}`)
    .digest('base64url')
    .slice(0, 32);
  return `annual_${digest}`;
}

function timestamp(dateString) {
  return Timestamp.fromDate(new Date(dateString));
}

function churchLocation() {
  return 'Chicago, IL';
}

function canadaChurchLocation() {
  return 'Edmonton, AB';
}

function taxReceiptSettings() {
  return {
    enabled: true,
    jurisdiction: 'US',
    eligibilityConfirmed: true,
    organizationName: 'St. Nicholas Orthodox Church',
    organizationAddress: '123 Church Street, Chicago, IL 60601',
    taxId: '12-3456789',
    receiptPrefix: 'STN',
    goodsServicesStatement: 'No goods or services were provided in exchange for this contribution.',
    autoIssue: true,
    annualPreparationEnabled: false,
    annualAutoEmailEnabled: false,
  };
}

function canadaTaxReceiptSettings() {
  return {
    enabled: false,
    jurisdiction: 'CA',
    eligibilityConfirmed: false,
    organizationName: 'Holy Trinity Orthodox Church',
    organizationAddress: '222 Jasper Avenue, Edmonton, AB T5J 1X8',
    taxId: '123456789 RR 0001',
    receiptPrefix: 'HTE',
    goodsServicesStatement: '',
    autoIssue: false,
    annualPreparationEnabled: false,
    annualAutoEmailEnabled: false,
    receiptIssueLocation: 'Edmonton, Alberta',
    authorizedSignerName: 'Fr. Nicholas',
    authorizedSignerTitle: 'Parish Priest',
    secureElectronicSignatureConfigured: false,
    receiptCopiesRetentionConfirmed: true,
  };
}

function churchData() {
  return {
    name: 'St. Nicholas Orthodox Church',
    denomination: 'Eastern Orthodox',
    jurisdiction: 'Orthodox Church in America',
    diocese: 'Diocese of the Midwest',
    foundedYear: 1995,
    about: 'A parish community seeded for local receipt verification.',
    languages: ['English', 'Serbian'],
    address: '123 Church Street',
    city: 'Chicago',
    state: 'IL',
    country: 'US',
    postalCode: '60601',
    latitude: 41.8781,
    longitude: -87.6298,
    timezone: 'America/Chicago',
    phone: '+1 555 0100',
    contactEmail: 'office@example.com',
    website: 'https://example.com',
    imageURL: 'https://images.unsplash.com/photo-1721836413413-9756aff1d4bb?auto=format&fit=crop&w=1200&q=80',
    coverImageURL: 'https://images.unsplash.com/photo-1721836413413-9756aff1d4bb?auto=format&fit=crop&w=1600&q=80',
    clergy: [],
    serviceSchedule: [],
    socialMedia: {
      instagram: '',
      facebook: '',
      youtube: '',
    },
    taxReceiptSettings: taxReceiptSettings(),
    showSaintDays: false,
    createdAt: FieldValue.serverTimestamp(),
    createdBy: 'seed-script',
    isVerified: true,
    isActive: true,
  };
}

function canadaChurchData() {
  return {
    name: 'Holy Trinity Orthodox Church',
    denomination: 'Eastern Orthodox',
    jurisdiction: 'Orthodox Church in America',
    diocese: 'Archdiocese of Canada',
    foundedYear: 2002,
    about: 'A Canadian parish seeded to verify Canada/CRA receipt unavailable states.',
    languages: ['English'],
    address: '222 Jasper Avenue',
    city: 'Edmonton',
    state: 'AB',
    country: 'CA',
    postalCode: 'T5J 1X8',
    latitude: 53.5461,
    longitude: -113.4938,
    timezone: 'America/Edmonton',
    phone: '+1 780 555 0100',
    contactEmail: 'office-ca@example.com',
    website: 'https://example.ca',
    imageURL: 'https://images.unsplash.com/photo-1721836413413-9756aff1d4bb?auto=format&fit=crop&w=1200&q=80',
    coverImageURL: 'https://images.unsplash.com/photo-1721836413413-9756aff1d4bb?auto=format&fit=crop&w=1600&q=80',
    clergy: [],
    serviceSchedule: [],
    socialMedia: {
      instagram: '',
      facebook: '',
      youtube: '',
    },
    taxReceiptSettings: canadaTaxReceiptSettings(),
    showSaintDays: false,
    createdAt: FieldValue.serverTimestamp(),
    createdBy: 'seed-script',
    isVerified: true,
    isActive: true,
  };
}

function profileData(uid, email, displayName, receiptProfile = false) {
  return {
    email,
    displayName,
    photoURL: null,
    preferredLanguage: 'English',
    phone: '',
    ministries: [],
    description: '',
    showInDirectory: true,
    taxReceiptLegalName: receiptProfile ? 'Michael Petrovic' : '',
    taxReceiptAddress: receiptProfile
      ? {
          line1: '456 Donor Avenue',
          line2: 'Apt 4',
          city: 'Chicago',
          region: 'IL',
          postalCode: '60602',
          country: 'US',
        }
      : {
          line1: '',
          line2: '',
          city: '',
          region: '',
          postalCode: '',
          country: '',
        },
    fcmTokens: [],
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    uid,
  };
}

function memberData(uid, email, displayName, role, churchId = CHURCH_ID) {
  return {
    userId: uid,
    churchId,
    role,
    status: 'active',
    displayName,
    email,
    photoURL: '',
    phone: '',
    ministry: '',
    description: '',
    joinedAt: FieldValue.serverTimestamp(),
    showInDirectory: true,
  };
}

function membershipFanoutData(role, church = {
  id: CHURCH_ID,
  name: 'St. Nicholas Orthodox Church',
  location: churchLocation(),
  imageURL: 'https://images.unsplash.com/photo-1721836413413-9756aff1d4bb?auto=format&fit=crop&w=1200&q=80',
}) {
  return {
    churchId: church.id,
    churchName: church.name,
    location: church.location,
    imageURL: church.imageURL,
    role,
    status: 'active',
    churchActive: true,
    joinedAt: FieldValue.serverTimestamp(),
  };
}

function givingRecord({
  id,
  userId,
  donorName,
  amountCents,
  purpose,
  completedAt,
  churchId = CHURCH_ID,
  churchName = 'St. Nicholas Orthodox Church',
  currency = 'USD',
  taxReceiptId = '',
  taxReceiptNumber = '',
  taxReceiptStatus = 'ready',
  anonymous = false,
  includeAnonymousField = true,
}) {
  const record = {
    id,
    churchId,
    churchName,
    userId,
    donorRole: 'member',
    donorName,
    donorEmail: '',
    donorNamePublicSafe: includeAnonymousField && anonymous === false,
    churchReceiptVisible: includeAnonymousField && anonymous === false,
    receiptManagerGivingSafeVersion: includeAnonymousField && anonymous === false ? 1 : 0,
    amount: amountCents / 100,
    amountCents,
    currency,
    purpose,
    recurring: false,
    status: 'completed',
    stripeRefundStatus: '',
    stripeAmountRefundedCents: 0,
    completedAt: timestamp(completedAt),
    receiptEmailSentAt: timestamp(completedAt),
    receiptEmailDateLabel: new Date(completedAt).toLocaleDateString('en-US'),
    receiptEmailAmountCents: amountCents,
    taxReceiptId,
    taxReceiptNumber,
    taxReceiptStatus,
    taxReceiptError: '',
    taxReceiptEmailError: '',
    taxReceiptCorrectionRequired: false,
    taxReceiptCorrectionReason: '',
    taxReceiptIssuedAt: taxReceiptId ? timestamp(completedAt) : null,
    taxReceiptSentAt: taxReceiptId ? timestamp(completedAt) : null,
    createdAt: timestamp(completedAt),
    updatedAt: FieldValue.serverTimestamp(),
  };

  if (includeAnonymousField) {
    record.anonymous = anonymous;
  }

  return record;
}

function baseTaxReceipt({ receiptId, userId, amountCents, receiptNumber, receiptYear, issuedAt }) {
  return {
    churchId: CHURCH_ID,
    churchName: 'St. Nicholas Orthodox Church',
    userId,
    givingId: receiptId,
    kind: 'single',
    status: 'sent',
    jurisdiction: 'US',
    receiptNumber,
    receiptYear,
    organizationName: 'St. Nicholas Orthodox Church',
    organizationAddress: '123 Church Street, Chicago, IL 60601',
    organizationTaxId: '12-3456789',
    donorName: 'Michael Petrovic',
    donorAddress: '456 Donor Avenue, Apt 4, Chicago, IL 60602, US',
    donorEmail: 'member@example.com',
    amountCents,
    eligibleAmountCents: amountCents,
    originalAmountCents: null,
    refundedAmountCents: null,
    currency: 'USD',
    purpose: 'General Fund',
    donationCount: null,
    contributions: [],
    coveredPeriodLabel: '',
    duplicateClaimWarning: '',
    includesPreviouslyReceipted: false,
    receivedAt: issuedAt,
    receivedDateLabel: 'Mar 12, 2026',
    issuedAt,
    issuedDateLabel: 'Mar 12, 2026',
    issuedBy: 'treasurer-1',
    goodsServicesStatement: 'No goods or services were provided in exchange for this contribution.',
    emailSentAt: issuedAt,
    emailFailedAt: null,
    emailError: '',
    correctionRequired: false,
    correctionReason: '',
    correctionForReceiptId: '',
    correctionSourceReason: '',
    correctedAt: null,
    voidedAt: null,
    voidReason: '',
    createdAt: issuedAt,
    updatedAt: FieldValue.serverTimestamp(),
  };
}

function annualReceipt({
  receiptId,
  givingIds,
  year,
  issuedAt,
  receiptNumber = `STN-${year}-000002`,
  amountCents = 19500,
  contributions,
}) {
  const annualContributions = contributions ?? [
    {
      dateLabel: `Feb 2, ${year}`,
      purpose: 'General Fund',
      amountCents: 7500,
      eligibleAmountCents: 7500,
      currency: 'USD',
    },
    {
      dateLabel: `Nov 18, ${year}`,
      purpose: 'Building Fund',
      amountCents: 12000,
      eligibleAmountCents: 12000,
      currency: 'USD',
    },
  ];

  return {
    churchId: CHURCH_ID,
    churchName: 'St. Nicholas Orthodox Church',
    userId: 'member-1',
    givingId: '',
    givingIds,
    kind: 'annual',
    status: 'sent',
    jurisdiction: 'US',
    receiptNumber,
    receiptYear: year,
    annualYear: year,
    organizationName: 'St. Nicholas Orthodox Church',
    organizationAddress: '123 Church Street, Chicago, IL 60601',
    organizationTaxId: '12-3456789',
    donorName: 'Michael Petrovic',
    donorAddress: '456 Donor Avenue, Apt 4, Chicago, IL 60602, US',
    donorEmail: 'member@example.com',
    amountCents,
    eligibleAmountCents: amountCents,
    originalAmountCents: null,
    refundedAmountCents: null,
    currency: 'USD',
    purpose: 'Annual giving summary',
    donationCount: annualContributions.length,
    contributions: annualContributions,
    coveredPeriodLabel: `Jan 1, ${year} - Dec 31, ${year}`,
    duplicateClaimWarning: 'Do not claim both this annual receipt and individual receipts for the same donations.',
    includesPreviouslyReceipted: false,
    receivedAt: null,
    receivedDateLabel: '',
    issuedAt,
    issuedDateLabel: `Jan 8, ${year + 1}`,
    issuedBy: 'treasurer-1',
    goodsServicesStatement: 'No goods or services were provided in exchange for this contribution.',
    emailSentAt: issuedAt,
    emailFailedAt: null,
    emailError: '',
    correctionRequired: false,
    correctionReason: '',
    correctionForReceiptId: '',
    correctionSourceReason: '',
    correctedAt: null,
    voidedAt: null,
    voidReason: '',
    createdAt: issuedAt,
    updatedAt: FieldValue.serverTimestamp(),
  };
}

function annualSummary({
  receiptId,
  year,
  issuedAt,
  donorLabel = 'Michael Petrovic',
  donorAnonymous = false,
  receiptNumber = `STN-${year}-000002`,
  amountCents = 19500,
  donationCount = 2,
}) {
  return {
    receiptId,
    churchId: CHURCH_ID,
    userId: 'member-1',
    donorLabel,
    donorAnonymous,
    churchReceiptVisible: donorAnonymous === false,
    donorLabelPublicSafe: donorAnonymous === false,
    receiptManagerSummarySafe: donorAnonymous === false,
    receiptManagerSummarySafeVersion: donorAnonymous === false ? 2 : 0,
    kind: 'annual',
    status: 'sent',
    jurisdiction: 'US',
    receiptYear: year,
    annualYear: year,
    receiptNumber,
    amountCents,
    eligibleAmountCents: amountCents,
    currency: 'USD',
    donationCount,
    includesPreviouslyReceipted: false,
    issuedAt,
    emailSentAt: issuedAt,
    emailFailedAt: null,
    emailError: '',
    correctionRequired: false,
    correctionReason: '',
    correctionMarkedAt: null,
    voidedAt: null,
    voidReason: '',
    createdAt: issuedAt,
    updatedAt: FieldValue.serverTimestamp(),
  };
}

async function createVerifiedUser(auth, uid, email, displayName) {
  await auth.createUser({
    uid,
    email,
    emailVerified: true,
    password: PASSWORD,
    displayName,
  });
}

async function seedScenario() {
  await clearEmulators();

  const app = getApps()[0] ?? initializeApp({ projectId: PROJECT_ID });
  const auth = getAuth(app);
  const db = getFirestore(app);

  await Promise.all([
    createVerifiedUser(auth, 'treasurer-1', 'treasurer@example.com', 'Treasurer One'),
    createVerifiedUser(auth, 'member-1', 'member@example.com', 'Member One'),
  ]);

  const singleGivingId = 'giving_2026_single';
  const anonymousGivingId = 'giving_2026_anonymous';
  const unclassifiedGivingId = 'giving_2026_unclassified';
  const canadaGivingId = 'giving_ca_2026_unsupported';
  const canadaAnnualGivingId = 'giving_ca_2025_annual_unsupported';
  const annualGivingIds = ['giving_2025_annual_1', 'giving_2025_annual_2'];
  const annualYear = new Date().getUTCFullYear() - 1;
  const annualReceiptId = annualTaxReceiptDocId(CHURCH_ID, 'member-1', annualYear);
  const privateAnnualYear = annualYear - 1;
  const privateAnnualGivingId = `giving_${privateAnnualYear}_anonymous`;
  const privateAnnualReceiptId = annualTaxReceiptDocId(CHURCH_ID, 'member-1', privateAnnualYear);
  const singleIssuedAt = timestamp('2026-03-12T16:20:00.000Z');
  const annualIssuedAt = timestamp(`${annualYear + 1}-01-08T16:20:00.000Z`);
  const privateAnnualIssuedAt = timestamp(`${privateAnnualYear + 1}-01-08T16:20:00.000Z`);

  const writes = [
    { path: `churches/${CHURCH_ID}`, data: churchData() },
    { path: `churches/${CANADA_CHURCH_ID}`, data: canadaChurchData() },
    { path: 'users/treasurer-1', data: profileData('treasurer-1', 'treasurer@example.com', 'Treasurer One') },
    { path: 'users/member-1', data: profileData('member-1', 'member@example.com', 'Member One', true) },
    {
      path: `churches/${CHURCH_ID}/members/treasurer-1`,
      data: memberData('treasurer-1', 'treasurer@example.com', 'Treasurer One', 'treasurer'),
    },
    {
      path: `churches/${CHURCH_ID}/members/member-1`,
      data: memberData('member-1', 'member@example.com', 'Michael Petrovic', 'member'),
    },
    {
      path: `churches/${CANADA_CHURCH_ID}/members/treasurer-1`,
      data: memberData('treasurer-1', 'treasurer@example.com', 'Treasurer One', 'treasurer', CANADA_CHURCH_ID),
    },
    {
      path: `churches/${CANADA_CHURCH_ID}/members/member-1`,
      data: memberData('member-1', 'member@example.com', 'Michael Petrovic', 'member', CANADA_CHURCH_ID),
    },
    {
      path: `users/treasurer-1/churchMemberships/${CHURCH_ID}`,
      data: membershipFanoutData('treasurer'),
    },
    {
      path: `users/member-1/churchMemberships/${CHURCH_ID}`,
      data: membershipFanoutData('member'),
    },
    {
      path: `users/treasurer-1/churchMemberships/${CANADA_CHURCH_ID}`,
      data: membershipFanoutData('treasurer', {
        id: CANADA_CHURCH_ID,
        name: 'Holy Trinity Orthodox Church',
        location: canadaChurchLocation(),
        imageURL: 'https://images.unsplash.com/photo-1721836413413-9756aff1d4bb?auto=format&fit=crop&w=1200&q=80',
      }),
    },
    {
      path: `users/member-1/churchMemberships/${CANADA_CHURCH_ID}`,
      data: membershipFanoutData('member', {
        id: CANADA_CHURCH_ID,
        name: 'Holy Trinity Orthodox Church',
        location: canadaChurchLocation(),
        imageURL: 'https://images.unsplash.com/photo-1721836413413-9756aff1d4bb?auto=format&fit=crop&w=1200&q=80',
      }),
    },
    {
      path: `giving/${singleGivingId}`,
      data: givingRecord({
        id: singleGivingId,
        userId: 'member-1',
        donorName: 'Michael Petrovic',
        amountCents: 5000,
        purpose: 'General Fund',
        completedAt: '2026-03-12T16:20:00.000Z',
        taxReceiptId: singleGivingId,
        taxReceiptNumber: 'STN-2026-000001',
        taxReceiptStatus: 'sent',
      }),
    },
    {
      path: `giving/${anonymousGivingId}`,
      data: givingRecord({
        id: anonymousGivingId,
        userId: 'member-1',
        donorName: 'Anonymous donor',
        amountCents: 3500,
        purpose: 'Candle Fund',
        completedAt: '2026-04-02T16:20:00.000Z',
        anonymous: true,
      }),
    },
    {
      path: `giving/${unclassifiedGivingId}`,
      data: givingRecord({
        id: unclassifiedGivingId,
        userId: 'member-1',
        donorName: '',
        amountCents: 4200,
        purpose: 'Memorial Fund',
        completedAt: '2026-04-10T16:20:00.000Z',
        includeAnonymousField: false,
      }),
    },
    {
      path: `giving/${canadaGivingId}`,
      data: givingRecord({
        id: canadaGivingId,
        churchId: CANADA_CHURCH_ID,
        churchName: 'Holy Trinity Orthodox Church',
        userId: 'member-1',
        donorName: 'Michael Petrovic',
        amountCents: 6500,
        currency: 'CAD',
        purpose: 'General Fund',
        completedAt: '2026-05-02T16:20:00.000Z',
        taxReceiptStatus: 'not_configured',
        taxReceiptError: 'tax_receipt_unsupported_jurisdiction',
      }),
    },
    {
      path: `giving/${canadaAnnualGivingId}`,
      data: givingRecord({
        id: canadaAnnualGivingId,
        churchId: CANADA_CHURCH_ID,
        churchName: 'Holy Trinity Orthodox Church',
        userId: 'member-1',
        donorName: 'Michael Petrovic',
        amountCents: 8400,
        currency: 'CAD',
        purpose: 'Building Fund',
        completedAt: `${annualYear}-08-14T16:20:00.000Z`,
        taxReceiptStatus: 'not_configured',
        taxReceiptError: 'tax_receipt_unsupported_jurisdiction',
      }),
    },
    {
      path: `giving/${annualGivingIds[0]}`,
      data: givingRecord({
        id: annualGivingIds[0],
        userId: 'member-1',
        donorName: 'Michael Petrovic',
        amountCents: 7500,
        purpose: 'General Fund',
        completedAt: `${annualYear}-02-02T16:20:00.000Z`,
      }),
    },
    {
      path: `giving/${annualGivingIds[1]}`,
      data: givingRecord({
        id: annualGivingIds[1],
        userId: 'member-1',
        donorName: 'Michael Petrovic',
        amountCents: 12000,
        purpose: 'Building Fund',
        completedAt: `${annualYear}-11-18T16:20:00.000Z`,
      }),
    },
    {
      path: `giving/${privateAnnualGivingId}`,
      data: givingRecord({
        id: privateAnnualGivingId,
        userId: 'member-1',
        donorName: 'Anonymous donor',
        amountCents: 8800,
        purpose: 'Alms Fund',
        completedAt: `${privateAnnualYear}-09-14T16:20:00.000Z`,
        anonymous: true,
        taxReceiptId: privateAnnualReceiptId,
        taxReceiptNumber: `STN-${privateAnnualYear}-000003`,
        taxReceiptStatus: 'sent',
      }),
    },
    {
      path: `taxReceipts/${singleGivingId}`,
      data: baseTaxReceipt({
        receiptId: singleGivingId,
        userId: 'member-1',
        amountCents: 5000,
        receiptNumber: 'STN-2026-000001',
        receiptYear: 2026,
        issuedAt: singleIssuedAt,
      }),
    },
    {
      path: `taxReceipts/${annualReceiptId}`,
      data: annualReceipt({
        receiptId: annualReceiptId,
        givingIds: annualGivingIds,
        year: annualYear,
        issuedAt: annualIssuedAt,
      }),
    },
    {
      path: `taxReceiptSummaries/${annualReceiptId}`,
      data: annualSummary({
        receiptId: annualReceiptId,
        year: annualYear,
        issuedAt: annualIssuedAt,
      }),
    },
    {
      path: `taxReceipts/${privateAnnualReceiptId}`,
      data: annualReceipt({
        receiptId: privateAnnualReceiptId,
        givingIds: [privateAnnualGivingId],
        year: privateAnnualYear,
        issuedAt: privateAnnualIssuedAt,
        receiptNumber: `STN-${privateAnnualYear}-000003`,
        amountCents: 8800,
        contributions: [
          {
            dateLabel: `Sep 14, ${privateAnnualYear}`,
            purpose: 'Alms Fund',
            amountCents: 8800,
            eligibleAmountCents: 8800,
            currency: 'USD',
          },
        ],
      }),
    },
    {
      path: `taxReceiptSummaries/${privateAnnualReceiptId}`,
      data: annualSummary({
        receiptId: privateAnnualReceiptId,
        year: privateAnnualYear,
        issuedAt: privateAnnualIssuedAt,
        donorLabel: 'Anonymous donor',
        donorAnonymous: true,
        receiptNumber: `STN-${privateAnnualYear}-000003`,
        amountCents: 8800,
        donationCount: 1,
      }),
    },
    {
      path: `taxReceiptCounters/${CHURCH_ID}_2026`,
      data: {
        churchId: CHURCH_ID,
        year: 2026,
        lastSequence: 1,
        updatedAt: FieldValue.serverTimestamp(),
      },
    },
    {
      path: `taxReceiptCounters/${CHURCH_ID}_${annualYear}`,
      data: {
        churchId: CHURCH_ID,
        year: annualYear,
        lastSequence: 2,
        updatedAt: FieldValue.serverTimestamp(),
      },
    },
    {
      path: `taxReceiptCounters/${CHURCH_ID}_${privateAnnualYear}`,
      data: {
        churchId: CHURCH_ID,
        year: privateAnnualYear,
        lastSequence: 3,
        updatedAt: FieldValue.serverTimestamp(),
      },
    },
  ];

  for (let index = 0; index < writes.length; index += 400) {
    const batch = db.batch();
    for (const entry of writes.slice(index, index + 400)) {
      batch.set(db.doc(entry.path), entry.data);
    }
    await batch.commit();
  }

  await deleteApp(app);

  console.log('Seeded local Firebase receipt scenario.');
  console.log('');
  console.log('Local users:');
  console.log(`  Treasurer: treasurer@example.com / ${PASSWORD}`);
  console.log(`  Donor:     member@example.com / ${PASSWORD}`);
  console.log('');
  console.log('Suggested browser check:');
  console.log('  1. Start the app with: npm run dev:emulators');
  console.log('  2. Sign in as treasurer@example.com.');
  console.log('  3. Open Management and verify the Receipts tab shows protected donor email labels.');
  console.log('  4. Confirm anonymous and unclassified donor-owned rows do not appear in the treasurer queue.');
  console.log('  5. Switch to Holy Trinity Orthodox Church and confirm Canadian/CRA receipts are unavailable.');
  console.log('  6. Sign in as member@example.com and confirm anonymous/unclassified rows remain visible in Giving.');
  console.log('  7. Switch to Holy Trinity Orthodox Church and confirm the Canadian donation and annual row show the Canada/CRA unavailable state.');
}

seedScenario().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
