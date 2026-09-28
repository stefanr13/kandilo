# Kandilo — Project Details (Start Here)

> **Living Document Notice for LLMs and Developers**
>
> This file is the single source of truth for the Kandilo project. It must be kept up to date.
> After any significant work — new features, schema changes, security patches, dependency upgrades,
> Cloud Function additions, Firestore rule changes, or architectural decisions — update the relevant
> section(s) of this document before closing the task. An outdated document is worse than no document.

---

## 1. What Is Kandilo?

Kandilo is a **digital parish platform** built exclusively for **Eastern Orthodox Christian communities**. It connects parishioners, priests, and parish administrators through a mobile-first web app with in-repo native iOS/Android Capacitor shells.

The name "Kandilo" (Кандило) refers to the oil lamp hung before icons in Orthodox churches — a symbol of prayer, presence, and community light.

### Target Users

| User Type | Who They Are | What They Do |
|-----------|-------------|--------------|
| **Parishioners (members)** | Regular church attendees, baptized members | Read posts and bulletins, view events, make donations, use the AI spiritual guide, receive push notifications |
| **Admins** | Parish council members, secretaries, appointed lay leaders | Everything a member can do + manage the parish directory, create/publish posts and events, send invitations, send push notifications |
| **Treasurers** | Parish finance or stewardship officers | Everything a member can do + access the send-focused receipt management queue for backend-marked, explicitly non-anonymous donations and annual summaries |
| **Priests** | Ordained clergy of the parish | Everything admins can do + assign/change roles (including elevating to admin or priest), delete newsletters, generate AI content |
| **Super Admins** | Platform operators (Kandilo company staff) | Full platform control: create churches, deactivate/reactivate churches, update any church, promote other users to super admin, view platform-wide stats via Mission Control |
| **Guests** | Anonymous visitors | Read-only access to the unauthenticated landing screen; cannot join churches, accept invitations, or access community content |

### Core Value Proposition

- Orthodox-specific: liturgical calendar, fasting awareness, multilingual support (English, Serbian Latin/Cyrillic, Russian, Romanian, Ukrainian), Faith AI grounded in Orthodox theology
- Parish-centric: every piece of content (posts, events, bulletins, notifications, donations) is scoped to a specific church
- Multi-church: a single user can be a member of multiple parishes with different roles in each
- Native-quality web: works as a PWA, and wraps in Capacitor for App Store / Play Store distribution

---

## 2. Technology Stack

### Frontend

| Layer | Technology | Version | Notes |
|-------|-----------|---------|-------|
| UI Framework | React | 19 | Concurrent mode, no legacy class components |
| Build Tool | Vite | 6 | ESM-native, HMR |
| Language | TypeScript | ~5.8 | Strict mode |
| Styling | Tailwind CSS | 4 (Vite plugin) | No separate config file; uses `@tailwindcss/vite` |
| Animation | Motion (Framer Motion successor) | 12 | `motion/react` import path |
| Rich Text Editor | TipTap | 3 | Used in PostEditor for parish post creation |
| Icons | Lucide React | 0.546 | |
| HTML Sanitization | DOMPurify | Latest | Applied to all `dangerouslySetInnerHTML` usage |
| Native Shell | Capacitor | 8 | iOS 17+ / Android 14+ targets, push notifications, deep-link handling, splash screen, status bar, in-app browser |
| Push (web) | Firebase Messaging | 12.x | Service worker at `public/firebase-messaging-sw.js` |
| Confetti | canvas-confetti | 1.9 | Used on donation success screen |

### Backend (Firebase)

| Service | Purpose |
|---------|---------|
| **Firebase Authentication** | Email/password, Google OAuth on web, anonymous; custom claims for `superAdmin` |
| **Cloud Firestore** | Primary database; all app data |
| **Firebase Storage** | Church logos, cover images, user avatars, post attachments, backend-only retained official tax receipt PDF copies |
| **Cloud Functions v2** | All server-side business logic (Node 22, TypeScript) |
| **Cloud Functions v1** | Auth trigger only (`onUserDeleted`) — v2 does not expose auth delete triggers |
| **Firebase Cloud Messaging** | Push notifications to web and native devices |
| **Firebase Hosting** | Serves the SPA; security headers, rewrites to `index.html` |

### Cloud Function Dependencies

| Package | Version | Usage |
|---------|---------|-------|
| `firebase-admin` | 13.x | Firestore, Auth, FCM admin access |
| `firebase-functions` | 7.x | v2 `onCall`, `onRequest`, `onSchedule`, `onDocumentCreated/Updated`; v1 auth triggers |
| `@google/genai` | 1.48 | Gemini 2.0 Flash Lite for Faith AI chat and post content generation |
| `stripe` | 22.x | Hosted Checkout sessions and webhook validation for donations |
| `resend` | 4.x | Transactional email (invitations, newsletters, donation receipts) |

### Firebase Project

- **Project ID**: `kandilo-2f7a9`
- **Default database**: `(default)` in `northamerica-northeast2`
- **Primary app host**: `app.kandilo.org` (legacy fallback hosts still accepted in native URL parsing: `kandilo.app`, `kandilo-2f7a9.firebaseapp.com`)
- **Functions region**: callable/HTTP/auth/scheduled functions in `us-central1`; Firestore triggers in `northamerica-northeast2` via `functions/src/shared/regions.ts`

---

## 3. Repository Structure

```
kandilo/
├── src/                          # Frontend SPA source
│   ├── App.tsx                   # Thin auth gate; lazy-hands off to auth, invitation, or authenticated app entry
│   ├── main.tsx                  # React entry point
│   ├── index.css                 # Global styles
│   ├── types.ts                  # Shared frontend-facing type exports
│   ├── translations.ts           # All UI strings for 6 languages
│   ├── app/
│   │   ├── navigation.ts         # Screen state machine + invitation path parsing helpers
│   │   └── native.ts             # Capacitor-native bootstrap, deep-link/app-url handling, secure external browser helper
│   ├── domain/
│   │   └── church.ts             # Canonical church domain types + Firestore mappers
│   ├── components/
│   │   ├── AuthScreen.tsx        # Language picker + sign in/up/forgot-password/guest
│   │   ├── HomeScreen.tsx        # Parish home: posts, events, bulletins, saint of the day
│   │   ├── ManagementView.tsx    # Compatibility re-export to the management feature module
│   │   ├── MissionControlScreen.tsx # Super admin shell composed from mission-control/*
│   │   ├── PostEditor.tsx        # Rich text post editor with AI generation panel
│   │   ├── FaithAIScreen.tsx     # Orthodox AI spiritual chat interface
│   │   ├── GivingScreen.tsx      # Donation flow with hosted Stripe Checkout handoff + return-state handling
│   │   ├── ProfileScreen.tsx     # User profile persistence, password change, church leave, invite-only church discovery, language, sign out
│   │   ├── InvitationAcceptScreen.tsx # Accepts emailed church invitations at /join/{invitationId}
│   │   ├── ScheduleScreen.tsx    # Event list and event detail
│   │   ├── FullCalendar.tsx      # Monthly calendar view
│   │   ├── CommunityView.tsx     # Community/social features
│   │   ├── BottomNav.tsx         # Mobile bottom navigation
│   │   ├── DesktopSidebar.tsx    # Desktop left sidebar navigation
│   │   ├── Header.tsx            # Top bar with church switcher
│   │   ├── app/
│   │   │   ├── AuthenticatedApp.tsx # Authenticated app entry: notifications, shell composition, screen routing
│   │   │   ├── AppShell.tsx      # Shared authenticated shell: sidebar, header, bottom nav
│   │   │   ├── AppScreenContent.tsx # Screen switcher with lazy-loaded non-home screens
│   │   │   ├── AppLoadingScreen.tsx # Shared app loading state
│   │   │   ├── MoreScreen.tsx    # Static "More" screen extracted from App
│   │   │   └── NoMembershipState.tsx # Invite-only empty state for non-members
│   │   └── mission-control/
│   │       ├── ChurchFormSheet.tsx # Add/edit church sheet
│   │       ├── MissionControlHeader.tsx # Mission Control header chrome
│   │       ├── MissionControlTabBar.tsx # Tab navigation
│   │       ├── MissionControlOverviewTab.tsx # Overview tab content
│   │       ├── MissionControlChurchesTab.tsx # Church list/admin tab content
│   │       ├── MissionControlAnalyticsTab.tsx # Analytics tab content with redacted payment/receipt readiness and ordered launch checklist, including direct live-mode completed-Checkout webhook smoke lookup
│   │       ├── missionControlForm.ts # Form shape + mapping helpers
│   │       └── useMissionControl.ts # Mission Control data/actions hook
│   ├── features/
│   │   └── management/
│   │       ├── ManagementView.tsx # Feature entry point
│   │       ├── useManagementView.ts # Management controller hook
│   │       ├── management-model.ts # Pure management selectors/helpers
│   │       ├── ManagementSidebar.tsx # Management chrome/sidebar
│   │       ├── ManagementDashboardTab.tsx # Overview tab
│   │       ├── ManagementEventSheet.tsx # Create/edit event sheet
│   │       ├── ManagementInviteSheet.tsx # Member invitation sheet
│   │       ├── ManagementMembersTab.tsx # Members tab
│   │       ├── ManagementEventsTab.tsx # Events tab
│   │       ├── ManagementPostsTab.tsx # Posts tab
│   │       └── ManagementScannerTab.tsx # Event attendance check-in tab
│   ├── hooks/
│   │   ├── useAuth.ts            # Auth state + superAdmin claim check
│   │   ├── useChurches.ts        # User's church memberships as UI Church objects
│   │   ├── useChurchData.ts      # Members, events, newsletters for management view
│   │   ├── useEvents.ts          # Real-time events subscription for active church
│   │   ├── useActiveChurchSelection.ts # Keeps selected church valid as memberships change
│   │   ├── usePendingInvitation.ts # Invitation route parsing + clear helper
│   │   └── usePublishedChurchPosts.ts # Published church posts subscription
│   ├── lib/
│   │   ├── firebase.ts           # Compatibility barrel over service-specific frontend Firebase modules
│   │   ├── firebase-functions.ts # Shared frontend Cloud Functions client
│   │   ├── auth.ts               # Auth helpers: signIn, signUp, Google, guest, reset
│   │   ├── db.ts                 # Public Firestore data-layer barrel
│   │   ├── notifications.ts      # FCM token registration (web + native)
│   │   ├── storage/
│   │   │   └── uploads.ts        # Validated Firebase Storage uploads (avatars)
│   │   ├── firebase/
│   │   │   ├── app.ts            # Shared Firebase app singleton
│   │   │   ├── app-check.ts      # Deferred App Check initialization for data/callable services
│   │   │   ├── auth.ts           # Auth-only Firebase client export
│   │   │   ├── firestore.ts      # Firestore client export
│   │   │   ├── functions.ts      # Cloud Functions client export
│   │   │   ├── messaging.ts      # Lazy messaging loader
│   │   │   └── storage.ts        # Storage client export
│   │   ├── api/
│   │       ├── client.ts         # Typed httpsCallable wrapper used by the UI
│   │       ├── ai.ts             # Faith AI + post-generation function calls
│   │       ├── giving.ts         # Giving checkout callable
│   │       ├── invitations.ts    # Invitation callables
│   │       └── mission-control.ts # Super-admin callables
│   │   └── db/
│   │       ├── churches.ts       # Church discovery + self-leave helpers
│   │       ├── profile.ts        # User profile reads/writes + FCM token writes
│   │       ├── memberships.ts    # Membership subscriptions + role/status updates
│   │       ├── events.ts         # Event subscriptions + writes
│   │       ├── newsletters.ts    # Newsletter subscriptions
│   │       ├── posts.ts          # Church post subscriptions + writes
│   │       └── checkIns.ts       # Event attendance check-in subscriptions + writes
│   └── data/
│       ├── events.ts             # Static fallback event data (used before real data loads)
│       └── newsletters.ts        # Static fallback newsletter data
├── functions/
│   ├── src/
│   │   ├── index.ts              # Thin export barrel for deployed Cloud Functions
│   │   ├── onUserCreated.ts      # v1 auth onCreate profile bootstrap trigger (`bootstrapUserProfileOnCreate`)
│   │   ├── modules/
│   │   │   ├── ai.ts             # Faith AI and post-generation callables
│   │   │   ├── churchNotifications.ts # Event/newsletter triggers + manual push callable
│   │   │   ├── giving.ts         # Stripe payment flow + donation receipt trigger
│   │   │   ├── invitations.ts    # Invitation lifecycle callables + expiry cleanup
│   │   │   ├── superAdmin.ts     # Super-admin callables for Mission Control
│   │   │   └── users.ts          # Auth deletion cleanup trigger
│   │   └── shared/
│   │       ├── audit.ts          # Platform audit log helpers
│   │       ├── clients.ts        # Resend, Stripe, Gemini client factories/constants
│   │       ├── emulatorTest.ts   # Shared emulator-test mode guard for no-production-service tests
│   │       ├── firebase.ts       # Admin SDK initialization + shared db/auth/fcm exports
│   │       ├── notify.ts         # Reusable FCM notification helpers
│   │       ├── security.ts       # Auth, role, recipient, and rate-limit enforcement
│   │       ├── types.ts          # Shared backend domain types
│   │       └── validation.ts     # Input validation + HTML escaping helpers
│   ├── lib/                      # Compiled JS output (gitignored in production)
│   ├── package.json              # Functions-specific deps (Node 22)
│   └── tsconfig.json
├── public/
│   ├── firebase-messaging-sw.js  # FCM service worker (background push handler)
│   ├── kandilo-icon.svg          # Notification icon fallback
│   ├── kandilo-badge.svg         # Notification badge fallback
│   ├── privacy-policy.html       # Production privacy policy page
│   └── support.html              # Production support page
├── docs/
│   └── QA_WEB_FIREBASE.md        # Standard web frontend + Firebase QA baseline
├── .github/
│   └── workflows/
│       └── ci.yml                # Pull request/main CI gate for web, Firebase rules, Functions emulator tests, and builds
├── scripts/
│   ├── set-super-admin.mjs          # CLI: project-confirmed grant superAdmin claim to a UID
│   ├── make-priest.js               # CLI: project-confirmed assign priest role in a church
│   ├── bootstrap-admin.js           # CLI: project-confirmed bootstrap initial priest/admin
│   ├── seed-church-profiles.mjs     # CLI: project-confirmed seed Firestore with sample church data
│   ├── seed-saints.ts               # CLI: seed saints/{date} collection (full detail) from JSON
│   ├── migrate-saints-index.ts      # CLI: seed saints_index/{date} collection (names only) from JSON
│   ├── configure-github-branch-protection.mjs # CLI: require the CI job on main branch protection
│   ├── configure-native-links.mjs # CLI: validate and write production Apple/Android well-known app-link identifiers, with optional Xcode Apple Team ID and Android release-keystore fingerprint derivation
│   ├── configure-firebase-receipt-secrets.mjs # CLI: project-confirmed Firebase Secret Manager setup for receipt-path secrets
│   ├── configure-stripe-live-webhook.mjs # CLI: no-network live webhook setup plan plus guarded endpoint creation
│   ├── check-live-donation-smoke.mjs # CLI: read-only live donation webhook/giving/receipt smoke verifier
│   ├── check-stripe-production-readiness.mjs # CLI: static Stripe/tax receipt/Firebase readiness preflight plus optional live Firebase drift check before live donations
│   ├── audit-tax-receipt-visibility.mjs # CLI: paginated read-only legacy receipt visibility audit plus guarded metadata repair
│   ├── seed-receipt-emulator.mjs # CLI: local-only Auth/Firestore emulator receipt portal scenario seeder, including U.S. privacy and Canadian single/annual Canada/CRA unavailable cases
│   └── write-firebase-messaging-sw-config.mjs # CLI: generate gitignored FCM service worker config from env vars
├── ios/                          # Capacitor iOS project (App Store target)
├── android/                      # Capacitor Android project (Play Store target)
├── firestore.rules               # Firestore security rules
├── storage.rules                 # Firebase Storage security rules
├── firestore.indexes.json        # Composite index definitions
├── firebase.json                 # Firebase hosting, functions, Firestore, Storage config
├── .firebaserc                   # Default project alias → kandilo-2f7a9
├── .nvmrc                        # Node 22 local toolchain hint
├── .node-version                 # Node 22 local toolchain hint
├── .env.example                  # Documents required env vars (never commit .env.local)
├── vite.config.ts                # Vite config; notes GEMINI_API_KEY is server-side only
├── capacitor.config.ts           # Capacitor: appId, webDir, iOS/Android settings
├── tsconfig.json                 # Frontend TS config
├── package.json                  # Frontend + root dependencies
└── project-details-start-here.md # THIS FILE
```

---

## 4. Authentication System

### Auth Methods

1. **Email/Password** — standard Firebase Auth; minimum password length 8 characters enforced client-side
2. **Google OAuth (web only)** — popup flow via `signInWithPopup`; profile synced to Firestore on first login. The native shells intentionally hide Google sign-in until a full native OAuth flow is configured.
3. **Anonymous (Guest)** — `signInAnonymously`; guests can browse but are blocked from church membership, invitation acceptance, and other privileged writes
4. **Facebook** — not exposed in production UI; add only after Firebase provider setup is complete

### Custom Claims

- `superAdmin: true` — set via the `promoteSuperAdmin` Cloud Function or `scripts/set-super-admin.mjs` with `--confirm-project kandilo-2f7a9`
- Claims are JWT-embedded; token refresh required after claim change (user must sign out and back in, or call `getIdToken(true)`)
- The `useAuth` hook reads claims via `getIdTokenResult(false)` on auth state change and exposes `isSuperAdmin` to the app
- `refreshSuperAdminClaim()` forces a token refresh (`getIdTokenResult(true)`) — used from Mission Control after promoting a user

### User Profile Sync

Profiles are protected by two layers:

1. `bootstrapUserProfileOnCreate` is a backend Firebase Auth `onCreate` trigger that creates a default `users/{uid}` document for every new Auth user. It uses a create-only Firestore write and skips existing docs, so an auth-profile race or retry cannot overwrite the donor's private tax receipt legal name/address.
2. `useAuth()` also calls `createOrUpdateUserProfile()` after auth state loads, so existing users self-heal if their profile document is missing.

On every explicit sign-in/signup path (email, Google):
1. Firebase Auth creates/updates the Auth record
2. `createOrUpdateUserProfile()` in `src/lib/db/profile.ts` writes to `users/{uid}` — creates if new, updates `displayName`/`photoURL` if existing; `email` is treated as Auth-managed and immutable from the client after creation
3. FCM token is registered immediately after sign-in for non-anonymous users
4. `ProfileScreen.tsx` persists editable profile fields (`displayName`, `preferredLanguage`, `phone`, `ministries`, `description`, `showInDirectory`) back to Firestore and fans display fields out to membership docs for parish directory consistency

### Auth Flow in `App.tsx`

```
App renders
  → useAuth() subscribes onAuthStateChanged
  → loading=true shows spinner
  → user=null → lazy-renders <AuthScreen>
  → user set + invitation URL → lazy-renders <InvitationAcceptScreen>
  → user set → lazy-renders <AuthenticatedApp>

AuthenticatedApp renders
  → requestNotificationPermission() is imported on demand for non-anonymous users
  → useChurches/useEvents/usePublishedChurchPosts subscribe for the active church
  → AppShell composes shared chrome
  → AppScreenContent lazy-loads non-home authenticated screens
  → isSuperAdmin drives "Mission Control" button visibility in ProfileScreen
```

---

## 5. Firestore Data Model

All data lives in a single `(default)` database. Collections:

### `users/{uid}`

The canonical user profile document.

| Field | Type | Description |
|-------|------|-------------|
| `email` | string | From Firebase Auth |
| `displayName` | string | Display name |
| `photoURL` | string \| null | Profile photo URL |
| `preferredLanguage` | string | One of the 6 supported `Language` values |
| `phone` | string | Optional contact number |
| `ministries` | string[] | Ministry involvement tags |
| `description` | string | Free-form profile biography |
| `showInDirectory` | boolean | Whether this member opts into directory visibility |
| `taxReceiptLegalName` | string | Legal name required before issuing official tax receipts; owner-only profile data, not fanned out to church directory records |
| `taxReceiptAddress` | map | Donor mailing address required before issuing official tax receipts: `line1`, `line2`, `city`, `region`, `postalCode`, `country`; owner-only profile data |
| `fcmTokens` | string[] | Up to 10 FCM push tokens (newest kept, oldest pruned) |
| `createdAt` | Timestamp | Account creation time |

**Subcollection**: `users/{uid}/churchMemberships/{churchId}` — denormalized mirror of the user's church membership for fast loading without cross-collection joins.

| Field | Type | Description |
|-------|------|-------------|
| `churchId` | string | |
| `churchName` | string | Denormalized from church doc |
| `imageURL` | string | Church thumbnail |
| `location` | string | `"City, State"` string |
| `role` | `'priest' \| 'treasurer' \| 'admin' \| 'member'` | |
| `status` | `'active' \| 'pending' \| 'suspended'` | |
| `churchActive` | boolean | Mirrored from `churches/{churchId}.isActive`; hidden from normal user church selection when `false` |
| `joinedAt` | Timestamp | |

### `churches/{churchId}`

The document ID is a URL-safe slug generated from `name + city` (e.g. `st-nicholas-new-york`). Created only by super admin via `createChurch` function.

Key fields: `name`, `denomination`, `jurisdiction`, `diocese`, `foundedYear`, `about`, `languages[]`, `address`, `city`, `state`, `country`, `postalCode`, `latitude`, `longitude`, `timezone`, `phone`, `contactEmail`, `website`, `imageURL`, `coverImageURL`, `clergy[]`, `serviceSchedule[]`, `socialMedia{}`, `isActive`, `isVerified`, `createdAt`, `createdBy`.

**Subcollection**: `churches/{churchId}/members/{uid}` — the authoritative source of membership. Used by Firestore rules for all authorization checks.

| Field | Type | Description |
|-------|------|-------------|
| `userId` | string | Mirrors doc ID |
| `churchId` | string | Mirrors parent |
| `role` | `'priest' \| 'treasurer' \| 'admin' \| 'member'` | **Authorization-critical** |
| `status` | `'active' \| 'suspended'` | Only `active` users pass `isMember()` check |
| `displayName`, `email`, `photoURL` | string | Denormalized for directory display |
| `phone`, `ministry`, `description`, `showInDirectory` | string / boolean | Optional profile fields fanned out from `users/{uid}` |
| `joinedAt` | Timestamp | |

**Subcollection**: `churches/{churchId}/posts/{postId}` — rich-text posts authored by admins/priests.

| Field | Type | Description |
|-------|------|-------------|
| `churchId` | string | Redundant but required for rules |
| `authorId` | string | UID of author |
| `authorName` | string | Denormalized display name |
| `title` | string | |
| `contentHtml` | string | TipTap HTML output; sanitized with DOMPurify on render |
| `contentJSON` | object | TipTap JSON for re-editing |
| `status` | `'draft' \| 'published'` | |
| `createdAt`, `updatedAt`, `publishedAt` | Timestamp | |

### `events/{eventId}`

Top-level collection (not a subcollection) but filtered by `churchId` via query.

Fields: `churchId`, `title`, `description`, `startTime`, `endTime`, `location`, `category`, `createdBy`, `notificationSent`, `commemoration`.

### `newsletters/{newsletterId}`

| Field | Type | Description |
|-------|------|-------------|
| `churchId` | string | |
| `title`, `content`, `excerpt` | string | |
| `status` | `'draft' \| 'published'` | Trigger fires when changed to `published` |
| `publishedAt` | Timestamp | |
| `emailSent` | boolean | Set to `true` after batch email send |
| `createdBy` | string | UID |

### `invitations/{invitationId}`

| Field | Type | Description |
|-------|------|-------------|
| `churchId` | string | |
| `churchName` | string | Denormalized |
| `invitedBy` | string | UID of sender |
| `invitedByName` | string | Denormalized |
| `inviteeEmail` | string | Target email |
| `role` | `'member' \| 'admin' \| 'treasurer'` | Role to grant on acceptance; priest-created invitations only can assign `admin` or `treasurer` |
| `status` | `'pending' \| 'accepted' \| 'expired' \| 'cancelled'` | |
| `expiresAt` | Timestamp | 14 days from creation |
| `createdAt`, `acceptedAt` | Timestamp | |

### `notifications/{notificationId}`

Write-only by Cloud Functions (client `allow write: if false`).

Fields: `churchId`, `title`, `body`, `type` (`'event' \| 'newsletter' \| 'manual'`), `targetRoles[]`, `sentAt`, `sentBy`, `sentByName`, `deliveryStats{}`.

### `giving/{givingId}`

Write-only by Cloud Functions. Client creation, update, and delete all blocked.

Fields: `churchId`, `churchName`, `userId`, `donorRole`, `donorName`, `donorEmail` (blank/legacy only for church-facing operational rows), `donorNamePublicSafe`, `receiptManagerGivingSafeVersion`, `churchReceiptVisible`, `amount` (in dollars, not cents), `amountCents`, `currency`, `purpose`, `anonymous`, `recurring`, `status` (`'creating' \| 'pending' \| 'completed' \| 'failed' \| 'refunded'`), `stripeRefundStatus`, `stripeAmountRefundedCents`, `stripeRefundedAt`, `completedAt`, `refundedAt`, `receiptEmailSentAt`, `receiptEmailDateLabel`, `receiptEmailAmountCents`, `taxReceiptId`, `taxReceiptNumber`, `taxReceiptStatus`, `taxReceiptError`, `taxReceiptEmailError`, `taxReceiptCorrectionRequired`, `taxReceiptCorrectionReason`, `taxReceiptIssuedAt`, `taxReceiptSentAt`, `taxReceiptCorrectedAt`, `taxReceiptCorrectedBy`, `taxReceiptVoidedAt`, `taxReceiptVoidReason`, `failureReason`, `createdAt`, `updatedAt`. New giving records intentionally do not store the donor's account email or raw Stripe session, Checkout URL, PaymentIntent, payment-status, expiry, charge, customer, refund, transfer, or Connect account identifiers/aliases because receipt managers can read operational giving rows only when `anonymous == false`, `churchReceiptVisible == true`, `donorEmail == ""`, `donorNamePublicSafe == true`, `receiptManagerGivingSafeVersion == 1`, `donorName` has no embedded email-shaped text, there are no raw Stripe payment/session/checkout/refund/account fields on the row, and `status` is completed or refunded; checkout and receipt rebuilds also refuse to use embedded email-shaped `donorName`, profile `displayName`, or membership `displayName` values as public labels, so a missing safe display name becomes `Parishioner` rather than an account email. Legacy non-anonymous rows that still contain a donor email, an email-shaped public donor label, raw Stripe payment identifiers or checkout URL aliases, or lack the backend-owned current giving safe version fail closed for receipt-manager Firestore reads until Cloud Functions rewrite the safe church-facing identity or the guarded `npm run audit:tax-receipts -- --repair --confirm-project kandilo-2f7a9 --confirm-repair-count N` metadata repair clears church-facing emails, preserves legacy raw Stripe payment identifiers and checkout URL aliases into backend-only payment metadata, removes those fields from staff-readable giving rows, and sets safe visibility after the reviewed repair count is confirmed and a post-repair re-scan proves no repairs remain. Official payment and tax receipt delivery resolves the donor's Firebase Auth/private profile data inside Cloud Functions and stores the official email only on donor-only `taxReceipts`. For anonymous or unclassified donations, the church-readable donor identity remains anonymous/blank, and receipt managers are not allowed to read the `giving` document because Firestore cannot hide `userId` at field level.

New official receipt issuance requires the donor's verified Firebase Auth email and never falls back to stale `giving`, profile, or membership email fields; stored receipt resends may still use the official email already retained on the donor-only receipt record if the current Auth email cannot be re-verified. Auto-issue and manual single/annual send attempts that fail this verified-email guard persist only safe retry state such as `tax_receipt_missing_email_or_amount`, blank receipt IDs, safe public donor labels, and no donor contact/legal fields, so staff can ask the donor to verify their account email without seeing private receipt details. App routing no longer blocks unverified signed-in accounts from opening the web or mobile app; the shell shows a waiting-for-verification banner, sends the branded verification email automatically when allowed, and rate-limits "Send again" through client-side cooldown plus the backend callable limit. Member content and directory contact details require verified email and active parish membership; public discovery remains available before verification. Donor checkout and donor receipt self-service also preflight unverified Auth email in the Giving UI, can send the branded verification email, provide an explicit check-again action after the donor opens the verification link, and keep the donor out of Stripe Checkout until the verified account email can support payment and official receipt delivery. Donor and receipt-manager annual action helpers keep those safe verified-email retry summaries sendable once receipt setup is ready again, without treating them as generic review failures or stored-receipt delivery retries.

Targeted receipt-manager callables use the same fail-closed safety gate as church-facing reads: anonymous, unclassified, hidden, unsafe-label, donor-email-bearing, and raw-Stripe-identifier legacy rows can be served by the donor or privacy-preserving annual batch paths, but priests/treasurers cannot target them directly until repaired.

### `givingPaymentMetadata/{givingId}`

Server-owned backend-only Stripe payment metadata keyed by the corresponding `giving/{givingId}`. Client reads and writes are blocked for every role, including donors, receipt managers, and SuperAdmins; Mission Control and readiness callables return only redacted aggregate payment health. This collection holds raw Stripe identifiers needed for webhook idempotency, metadata-only Checkout recovery, refund matching, and support investigations without placing those identifiers on staff-readable giving rows.

Guarded legacy receipt visibility repairs merge any raw Stripe identifiers and checkout URL aliases from an old `giving/{givingId}` row into `givingPaymentMetadata/{givingId}` before deleting those fields from the staff-readable giving document, so the privacy repair does not discard refund or support metadata.

Fields: `churchId`, `userId`, `amountCents`, `currency`, `stripeSessionId`, `stripeCheckoutSessionId`, `stripeCheckoutSessionExpiresAt`, `stripeCheckoutUrl`, `stripeCheckoutSessionUrl`, `stripePaymentIntentId`, `stripePaymentStatus`, `stripePaymentMethodId`, `stripeChargeId`, `stripeCustomerId`, `stripeEventId`, `stripeConnectAccountId`, `stripeConnectTransferId`, `stripeTransferId`, `stripeDestinationAccountId`, `stripeRefundId`, `stripeRefundedChargeId`, `checkoutSessionId`, `checkoutSessionExpiresAt`, `checkoutSessionUrl`, `checkoutUrl`, `paymentIntentId`, `paymentStatus`, `paymentMethodId`, `chargeId`, `customerId`, `eventId`, `refundId`, `checkoutCompletedAt`, `checkoutFailureType`, `stripeAmountRefundedCents`, `stripeRefundStatus`, `stripeRefundedAt`, `stripeSettlement`, `stripeConnectTransferConfigured`, `createdAt`, `updatedAt`.

### `taxReceipts/{taxReceiptId}`

Server-owned official receipt records. For original single-donation receipts, the document ID matches the `giving/{givingId}` document ID. Corrected single-donation receipts after partial refunds use a deterministic `correction_{hash}` ID for `(givingId, refundedAmountCents)`. Annual summary receipts use a deterministic `annual_{hash}` ID for `(churchId, userId, year)`, and corrected annual summaries after partial refunds use a deterministic `annual_correction_{hash}` ID for the donor/year/current refund state. Client creation, update, and delete are blocked; issuance and email delivery go through Cloud Functions.

Fields: `churchId`, `churchName`, `userId`, `givingId`, `givingIds` (annual only), `kind` (`'single' \| 'annual'`), `status` (`'issued' \| 'sent' \| 'error' \| 'voided'`), `pdfTemplateVersion`, `pdfStoragePath`, `pdfSha256`, `pdfByteLength`, `pdfRetainedAt`, `pdfRetentionStatus`, `jurisdiction`, `receiptNumber`, `receiptYear`, `annualYear` (annual only), `organizationName`, `organizationAddress`, `organizationTaxId`, `donorName`, `donorAddress`, `donorEmail`, `amountCents`, `eligibleAmountCents`, `originalAmountCents` (corrections only), `refundedAmountCents` (corrections only), `partialRefundGivingIds` (corrected annual only), `currency`, `purpose`, `donationCount` (annual only), `contributions[]` (annual full receipt only: `dateLabel`, `purpose`, `amountCents`, `eligibleAmountCents`, `currency`), `receivedAt`, `receivedDateLabel`, `coveredPeriodLabel` (annual only), `issuedAt`, `issuedDateLabel`, `issuedBy`, `goodsServicesStatement`, `duplicateClaimWarning` (annual only), `emailSendingAt`, `emailSendAttemptId`, `emailSentAt`, `emailFailedAt`, `emailError`, `correctionRequired`, `correctionReason`, `correctionMarkedAt`, `correctionMarkedBy`, `correctionForGivingId`, `correctionForReceiptId`, `correctionSourceReason`, `correctedAt`, `correctedBy`, `voidedAt`, `voidedBy`, `voidReason`, `createdAt`, `updatedAt`.

### `taxReceiptSummaries/{taxReceiptId}`

Server-owned operational mirrors for annual receipt status. These documents intentionally omit full official receipt details such as donor legal name, donor email, donor address, organization tax ID, address, goods/services statement, covered donation IDs, partial-refund giving IDs, correction giving IDs, correction timestamps, itemized contribution lines, retained PDF/PDF-template metadata, backend email send-claim/idempotency metadata, and operator UIDs such as issued/corrected/correction-marking/voided actors. They may include a `donorLabel` copied from church-facing giving/member display data so priests and treasurers can identify older annual summary rows without reading the official receipt; when any covered contribution is anonymous, lacks explicit non-anonymous metadata, is receipt-manager-hidden, or the annual receipt no longer carries covered-giving proof, the mirror stores `donorAnonymous=true`, `churchReceiptVisible=false`, `donorLabelPublicSafe=false`, and an anonymous label instead of a donor identity, and receipt managers cannot read that mirror because it still contains the donor `userId`. Safe blank-`receiptId` annual issuance-gap retry summaries, such as missing donor profile or missing verified Auth email rows, may remain staff-readable without covered-giving proof only when they already carry the current backend-owned safe markers, a safe public donor label, and no private full-receipt fields. Refund, void, and review-required rewrites re-check covered giving before rebuilding annual mirrors and fall back to donor-only markers when that proof is missing or unsafe. Annual summary mirrors may also carry the non-private `jurisdiction` from the official annual receipt so unsupported-jurisdiction send/resend controls fail closed without exposing full receipt contents. Donors use them as the stable annual receipt index in the Giving portal, so annual receipt status stays visible even when the donor's recent giving/receipt history limits do not include that year. Donors can read their own mirrors; priests and treasurers can read only receipt-manager-safe annual mirrors with `kind == 'annual'`, backend-owned `churchReceiptVisible == true`, backend-owned `donorLabelPublicSafe == true`, backend-owned `receiptManagerSummarySafe == true`, and backend-owned `receiptManagerSummarySafeVersion == 2`. Staff list queries require the current versioned safe marker plus the public-label safety marker, and Cloud Functions delete private full-receipt fields before setting the current marker version when rebuilding summary mirrors, so malformed or legacy mirrors without those markers fail closed until rebuilt. Anonymous, unclassified, receipt-manager-hidden, or missing-evidence mirrors are donor-client-only unless they are those marker-safe annual issuance-gap retry summaries. Regular admins and SuperAdmin browser clients cannot read raw summary documents. Client writes are blocked.

Fields: `receiptId`, `churchId`, `userId`, `donorLabel`, `donorAnonymous`, `churchReceiptVisible`, `donorLabelPublicSafe`, `receiptManagerSummarySafe`, `receiptManagerSummarySafeVersion`, `jurisdiction`, `kind` (`'annual'`), `status` (`'issued' \| 'sent' \| 'error' \| 'voided'`), `receiptYear`, `annualYear`, `receiptNumber`, `amountCents`, `eligibleAmountCents`, `currency`, `donationCount`, `includesPreviouslyReceipted`, `issuedAt`, `emailSentAt`, `emailFailedAt`, `emailError`, `correctionRequired`, `correctionReason`, `voidedAt`, `voidReason`, `createdAt`, `updatedAt`.

### `taxReceiptEvents/{eventId}`

Server-owned redacted audit events for official receipt issuance and delivery attempts. These records are written by Cloud Functions and are not directly client-readable, including by SuperAdmin clients; Mission Control uses the `getTaxReceiptAuditEvents` callable, which returns a whitelisted redacted feed. Stored event records intentionally omit donor email, donor name, organization tax ID/address, goods/services statement, and covered donation IDs. The Mission Control feed also redacts target donor UIDs, giving IDs, and raw receipt document IDs into typed placeholders such as `single_receipt`, `annual_receipt`, and `annual_correction_receipt`.

Fields: `action` (`'issued' \| 'email_sent' \| 'email_failed' \| 'pdf_downloaded' \| 'corrected' \| 'annual_batch_item_failed' \| 'annual_scheduled_item_failed' \| 'annual_scheduled_review_summary' \| 'review_required' \| 'voided'`), `actorUid`, `churchId`, `userId`, `receiptId`, `givingId`, `kind`, `receiptYear`, `annualYear`, `errorCode`, `reasonCode`, `reviewCount`, `createdAt`. Scheduled annual review summary events are aggregate SuperAdmin/operator audit records and intentionally omit donor IDs, giving IDs, receipt IDs, and receipt contents; `reviewCount` is the aggregate skipped donor-year count for that review category.

Receipt numbering is backed by `taxReceiptCounters/{churchId}_{year}` and incremented transactionally by Cloud Functions. New generated numbers are year-qualified even when a parish configures a short custom prefix such as `STN`, so a visible receipt number is not reused when the next receipt year starts. If the configured prefix already ends with the receipt year, Functions do not append the year a second time. Receipt issuance fails closed if receipt counter metadata is corrupt rather than assigning an invalid official receipt number.

Tax receipt settings live on `churches/{churchId}.taxReceiptSettings` and are updated only through audited super-admin callables. Enabled receipt settings require a legal organization name, receipt address, tax ID, and explicit SuperAdmin eligibility attestation before Mission Control will save them or Functions will issue receipts. The attestation confirms the parish is eligible to issue U.S. charitable contribution acknowledgments, the receipt organization details match official records, and the configured goods/services statement is accurate for those donations; if the U.S. statement is left blank, Mission Control and Functions persist the standard no-goods/services statement for intangible religious benefits so readiness/audit state matches issued receipts. Current U.S. issuance is scoped to cash-donation written acknowledgments aligned to IRS charitable-contribution guidance: [IRS written acknowledgments](https://www.irs.gov/charities-non-profits/charitable-organizations/charitable-contributions-written-acknowledgments). It does not issue non-cash, advantage/quid-pro-quo, vehicle, or other special-case charitable receipts. Settings changes write a platform audit entry with redacted before/after receipt-setting state, including whether legal/tax fields are configured, but not the tax ID, legal address, authorized signer name/title, or goods/services text. Current automated issuance supports U.S. cash donation acknowledgments only and sends an HTML email plus a generated PDF attachment. Canada settings can be staged only while disabled, and Mission Control shows the same blocker before submit if a SuperAdmin attempts to enable Canada/CRA receipt issuing; enabling Canada/CRA receipts is also rejected by Functions until Kandilo can produce read-only/non-editable PDF receipts that are protected from unauthorized access, encrypted, electronically signed under authorized parish control, retained, and printable on request. Legacy or manually inserted non-U.S. full receipt records are blocked again at email/PDF delivery time, and stored receipt email/PDF paths also check the church's current unsupported-jurisdiction receipt setup, so direct callable retries cannot accidentally deliver Canada/CRA staging drafts.

Donor browser-print controls also treat unsupported-jurisdiction full receipt records as blocked, while the donor-only record remains visible for history.

Donor and receipt-manager send/resend action helpers also treat unsupported-jurisdiction stored giving rows and annual summary mirrors as blocked, even when a legacy receipt ID or receipt number exists.

That blocked action state is derived from both stored receipt/giving error codes and the church's current unsupported-jurisdiction receipt setup, so legacy rows without a mirrored error still do not show a resend affordance for Canadian staged settings.

### `eventCheckIns/{eventId_userId}`

Manual event attendance check-in records for the management check-in tab.

Fields: `churchId`, `eventId`, `userId`, `memberName`, `memberEmail`, `checkedInBy`, `checkedInAt`.

Security rules: admins/priests of the church can create/read/delete check-ins; members can read their own check-in records; direct updates are blocked.

### `platformAuditLog/{logId}`

Write-only by Cloud Functions (Admin SDK bypasses rules). Super admins can read.

Fields: `actorUid`, `action`, `details{}`, `timestamp`.

### `saints/{date}` — Full saint day data

Document ID is the calendar date in `YYYY-MM-DD` format (e.g. `2026-01-01`). Contains the complete saint data including long multilingual descriptions. **Used only for day-detail views** — never for calendar/month rendering.

| Field | Type | Description |
|-------|------|-------------|
| `date` | string | `YYYY-MM-DD` |
| `saints` | array | Array of saint objects, each with `name` and `description` sub-maps |
| `saints[].name` | map | `{ sr_cyr, sr_lat, en, ru, uk }` — the saint's name in 5 languages |
| `saints[].description` | map | `{ sr_cyr, sr_lat, en, ru, uk }` — full hagiographic text in 5 languages (can be 500–2000 chars per language) |

Days that are major feasts with no individual saints listed (e.g. Serbian Orthodox Christmas Jan 7, Holy Week) have `saints: []`.

Seeded via `scripts/seed-saints.ts`. Security rules: **public read** (unauthenticated), **no client write**.

### `saints_index/{date}` — Lean calendar index

Document ID matches `saints/{date}`. Contains **only saint names** — no descriptions. Designed specifically for the calendar month view to avoid downloading kilobytes of hagiographic text per day.

| Field | Type | Description |
|-------|------|-------------|
| `date` | string | `YYYY-MM-DD` |
| `names` | array | Array of `{ sr_cyr, sr_lat, en, ru, uk }` name maps — one per saint |

Seeded via `scripts/migrate-saints-index.ts`. Security rules: **public read**, **no client write**.

#### Saints Calendar — Read Pattern

```
Calendar / month view
  → reads saints_index/{date}  (names only, ~1–3 KB/doc, 31 reads/month)

Day detail view (user taps a day)
  → reads saints/{date}        (full data, one on-demand read)
```

**Never** read from `saints` for the calendar view. This avoids fetching 50–200 KB of description text per day when only the saint names are displayed.

#### Adding or Updating Future Year Data

When a new year's saint data is ready:

1. Place the source file at `src/data/saints_{YEAR}_full.json` following the exact same structure:
   ```json
   [
     {
       "date": "YYYY-MM-DD",
       "saints": [
         {
           "name":        { "sr_cyr": "...", "sr_lat": "...", "en": "...", "ru": "...", "uk": "..." },
           "description": { "sr_cyr": "...", "sr_lat": "...", "en": "...", "ru": "...", "uk": "..." }
         }
       ]
     }
   ]
   ```
2. Update `DATA_FILE` in **both** seed scripts to point at the new file, then run both scripts:
   ```bash
   npx tsx scripts/seed-saints.ts          # writes saints/{date} (full detail)
   npx tsx scripts/migrate-saints-index.ts  # writes saints_index/{date} (names only)
   ```
3. Make sure your Firebase CLI session is valid (`npx --no-install firebase login`) before running — the scripts use the stored OAuth token.
4. Update Firestore security rules if the collection was not already covered by a public-read rule.

---

## 6. Cloud Functions Reference

Functions deploy from `functions/src/index.ts`, but that file is now only an export barrel. Business logic is split by domain in `functions/src/modules/*`, and shared security/client helpers live in `functions/src/shared/*`. Deploy through the guarded receipt helper for the Stripe/tax receipt surface, or use `npx --no-install firebase deploy --only functions` when intentionally running a direct Functions-only deploy from this repo.

### Callable Functions (invoked via `httpsCallable` from the frontend)

| Function | Auth Required | Role Required | Rate Limit | Description |
|----------|--------------|---------------|------------|-------------|
| `acceptInvitation` | Yes (verified, non-anonymous email account) | None | None | Accepts a pending invitation; atomically creates member + churchMembership docs |
| `sendInvitation` | Yes | Active Admin or Priest of church | 10/min | Creates invitation doc + sends email via Resend; only priests may invite admin or treasurer roles |
| `createStripeCheckoutSession` | Yes | Active member/admin/treasurer/priest of church | 5/min | Creates hosted Stripe Checkout session + pending `giving` doc; returns `checkoutUrl` |
| `createStripePaymentIntent` | Replay-protected App Check | None | None | Retired compatibility shim that always fails closed; kept exported so deployments overwrite any older raw PaymentIntent callable with the Checkout-only flow |
| `sendTaxReceipt` | Yes | Donor owner, or Priest/Treasurer for explicitly non-anonymous church donations | 5/min | Issues an idempotent single-donation tax receipt when configured and emails it with a PDF attachment to the donor's Auth email; parish financial administrators should use the Treasurer role rather than the ordinary Admin role for receipt access |
| `sendCorrectedTaxReceipt` | Yes | Donor owner, or Priest/Treasurer for explicitly non-anonymous church donations | 3/min | Voids a stale single-donation receipt after a partial Stripe refund, issues a replacement for the net eligible amount, and emails it with a PDF attachment |
| `sendAnnualTaxReceipt` | Yes | Donor owner, or Priest/Treasurer for donor-years where every covered donation is explicitly non-anonymous | 3/min | Issues an idempotent annual tax receipt summary for a church/donor/year and emails it with a PDF attachment to the donor's Auth email |
| `sendCorrectedAnnualTaxReceipt` | Yes | Donor owner, or Priest/Treasurer for donor-years where every covered donation is explicitly non-anonymous | 3/min | Voids a stale annual summary after one or more partial Stripe refunds, issues a replacement for the net eligible donor/year amount, and emails it with a PDF attachment |
| `downloadTaxReceiptPdf` | Yes | Donor owner only | 10/min | Returns the retained official PDF copy when present, otherwise generates and retains one before download; priests/treasurers cannot fetch the full PDF |
| `sendChurchAnnualTaxReceipts` | Yes | Priest or Treasurer | 1/min | Sends missing or previously unsent annual tax receipt summaries with PDF attachments for all donors with completed donations in an active church/year, reissues full-refund-voided mixed annual receipts for remaining eligible gifts, skips mixed- or missing-currency donor-years into redacted review failures, skips already-emailed annual receipts on rerun, fails closed before donor scans when the church is inactive, and caps batches at 250 donors per call |
| `sendChurchCorrectedAnnualTaxReceipts` | Yes | Priest or Treasurer | 1/min | Sends missing or previously unsent corrected annual tax receipt summaries with PDF attachments for all donors in an active church/year who have partially refunded completed donations, skips mixed- or missing-currency donor-years into redacted review failures, skips already-emailed corrected annual receipts on rerun, fails closed before donor scans when the church is inactive, and caps batches at 250 donors per call |
| `getPaymentOperationsReadiness` | Yes | `superAdmin` claim | None | Returns redacted runtime Stripe/Webhook/Resend/APP_URL readiness booleans, Stripe mode, warnings, expected webhook URL, recent webhook activity counts, direct live webhook issue-status counts, official receipt smoke evidence, and annual receipt smoke evidence including itemized contribution-line readiness without exposing secret values or donation identifiers |
| `getTaxReceiptAuditEvents` | Yes | `superAdmin` claim | None | Returns the latest redacted tax receipt audit events for Mission Control without target donor UID, giving ID, donor-as-actor UID, single receipt document ID, donor email, donor name, donor address, organization tax ID, goods/services text, or receipt contents |
| `getChurchPaymentSettings` | Yes | `superAdmin` claim | None | Returns backend-only per-church Stripe Connect routing settings for Mission Control |
| `updateChurchPaymentSettingsAsSuperAdmin` | Yes | `superAdmin` claim | None | Writes backend-only Stripe Connect routing settings with redacted audit summaries after verifying enabled connected accounts are ready for routing with the configured Stripe key |
| `createChurchStripeConnectAccountAsSuperAdmin` | Yes | `superAdmin` claim | None | Creates a U.S. or Canadian Stripe Accounts v2 recipient connected account with Express dashboard access, stores its account ID/API version in backend-only payment settings, and leaves routing disabled until onboarding is complete |
| `createChurchStripeConnectOnboardingLink` | Yes | Priest, Treasurer, or `superAdmin` claim | 3/min | Creates a single-use Stripe-hosted onboarding link for a configured connected account before or after routing is enabled without returning or logging the connected account ID; Kandilo-created v2 accounts use recipient onboarding, and the return/refresh URL is bound to a client-generated session state token |
| `getChurchStripeConnectSetupStatus` | Yes | Priest, Treasurer, or `superAdmin` claim | None | Returns redacted connected-account setup status for the receipt manager without exposing the Stripe connected account ID, requirement fields, business details, bank details, or tax identifiers |
| `sendPushNotification` | Yes | Active Admin or Priest of church | 5/min | Sends FCM multicast to church members filtered by validated `targetRoles` |
| `getSuperAdminStats` | Yes | `superAdmin` claim | None | Returns per-church stats for Mission Control (capped at 200 churches) |
| `createChurch` | Yes | `superAdmin` claim | None | Creates new church with collision-safe slug ID |
| `setChurchActiveState` | Yes | `superAdmin` claim | None | Toggles `isActive` and mirrors `churchActive` into user membership fanout docs |
| `assignChurchMembershipAsSuperAdmin` | Yes | `superAdmin` claim | None | Assigns a user to a church and mirrors the church active state into membership fanout |
| `updateChurchAsSuperAdmin` | Yes | `superAdmin` claim | None | Updates church fields via explicit allowlist and mirrors public church name/location/image/active state into membership fanout docs |
| `promoteSuperAdmin` | Yes | `superAdmin` claim | None | Sets `superAdmin: true` custom claim on target UID |
| `faithAiChat` | Yes (verified, non-anonymous + App Check) | Any signed-in user | 20/min | Gemini 2.0 Flash Lite Orthodox spiritual chat |
| `generatePostContent` | Yes (App Check) | Active Admin or Priest of church | 10/min | Gemini 2.0 Flash Lite post content generation |

### HTTP Function

| Function | Method | Auth | Description |
|----------|--------|------|-------------|
| `stripeWebhook` | POST only | Stripe signature header | Handles Checkout completion / failure events and refund events; updates `giving` doc status, voids fully refunded receipts, and marks partial refunds for manual receipt review |

### Background Triggers

| Function | Trigger | Description |
|----------|---------|-------------|
| `onEventCreated` | Firestore `onDocumentCreated('events/{eventId}')` | Sends FCM to all church members; writes notification doc |
| `onNewsletterPublished` | Firestore `onDocumentUpdated('newsletters/{newsletterId}')` | On status change to `published`: sends FCM + batch email to all members |
| `onGivingCreated` | Firestore `onDocumentCreated('giving/{givingId}')` | Retired no-op compatibility shim kept deployed so older production create-trigger payment logic is overwritten by the Checkout-only flow without logging raw giving document IDs |
| `onGivingCompleted` | Firestore `onDocumentUpdated('giving/{givingId}')` | Sends donation receipt email exactly once when status transitions to `completed`; auto-issues/sends a tax receipt only when U.S. tax receipt settings are enabled with auto-issue on, otherwise marks configured manual-mode donations receipt-ready |
| `bootstrapUserProfileOnCreate` | Auth v1 `onCreate` | Creates a default `users/{uid}` profile document for every new Auth user |
| `onUserDeleted` | Auth v1 `onDelete` | Cleans up all Firestore data: deletes member docs, churchMembership docs, user doc; cancels pending invitations |

### Scheduled Function

| Function | Schedule | Description |
|----------|---------|-------------|
| `cleanupExpiredInvitations` | Every 24 hours | Finds all `status=pending` invitations past `expiresAt`; marks them `expired` |

### Secrets Management

Secrets are never in `.env` or code. They are stored in Firebase Secret Manager and injected at function runtime:

| Secret | Used By |
|--------|---------|
| `GEMINI_API_KEY` | `faithAiChat`, `previewPostTranslations`, `generatePostContent` |
| `RESEND_API_KEY` | `sendEmailVerificationEmail`, `sendPasswordResetEmail`, `sendInvitation`, `onNewsletterCreated`, `onNewsletterPublished`, `sendPushNotification`, `onGivingCompleted`, `sendTaxReceipt`, `sendCorrectedTaxReceipt`, `sendAnnualTaxReceipt`, `sendCorrectedAnnualTaxReceipt`, `sendChurchAnnualTaxReceipts`, `sendChurchCorrectedAnnualTaxReceipts`, `getPaymentOperationsReadiness` |
| `STRIPE_SECRET_KEY` | `createStripeCheckoutSession`, `stripeWebhook`, `getPaymentOperationsReadiness`, `updateChurchPaymentSettingsAsSuperAdmin`, `createChurchStripeConnectAccountAsSuperAdmin`, `createChurchStripeConnectOnboardingLink` |
| `STRIPE_WEBHOOK_SECRET` | `stripeWebhook`, `getPaymentOperationsReadiness` |

The live drift check expects exact Stripe/tax receipt release-surface secret bindings. Retired compatibility shims such as `createStripePaymentIntent` and `onGivingCreated`, plus read/download-only receipt functions such as `downloadTaxReceiptPdf`, should not keep stale Stripe or Resend secret bindings after deployment.

Set receipt-path production secrets with `npm run configure:receipt-secrets -- --set SECRET_NAME --confirm-project kandilo-2f7a9`, or run `npm run configure:receipt-secrets -- --set-all --confirm-project kandilo-2f7a9` to set `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, and `RESEND_API_KEY` in sequence. The helper validates `.firebaserc`, uses the repo-pinned Firebase CLI, and lets the Firebase CLI prompt collect the secret value so the value is not read from env or printed by Kandilo tooling.

---

## 7. Security Architecture

### Firestore Rules Summary

Rules are in `firestore.rules`. Key helper functions:

- `isVerifiedNonAnonymous()` — verified Firebase Auth user, excluding anonymous sessions
- `isOwner(userId)` — `request.auth.uid == userId`
- `isSuperAdmin()` — `request.auth.token.superAdmin == true` (JWT claim, zero reads)
- `isActiveChurch(churchId)` — church exists and `isActive == true`
- `getMembership(churchId)` — reads `churches/{id}/members/{uid}`
- `isMember(churchId)` — active member of an active church
- `isAdmin(churchId)` — active church + active role is `admin` or `priest`
- `isPriest(churchId)` — active church + active role is `priest`
- `isReceiptManager(churchId)` — active church + active role is `priest` or `treasurer`
- `adminMayEditChurchSettings()` — limits client church edits to low-risk settings such as `showSaintDays`

**Authorization matrix** (key rules):

| Resource | Create | Read | Update | Delete |
|----------|--------|------|--------|--------|
| `users/{uid}` | Owner | Owner | Owner (profile, directory, language, avatar, FCM token allowlist) | Never |
| `users/{uid}/churchMemberships/{cid}` | Never (functions only) | Owner or SuperAdmin | Priest role/status; Admin status only | Owner |
| `churches/{cid}` | Never (functions only) | Verified signed-in + active church, or SuperAdmin | Active Admin/Priest for low-risk settings only; broader changes via audited SuperAdmin callables | Never |
| `churches/{cid}/members/{uid}` | Never (functions only) | Member or SuperAdmin | Priest role/status/profile allowlist; Admin status only; Owner profile allowlist | Admin or Owner |
| `churches/{cid}/posts/{pid}` | Admin/Priest (churchId+authorId match) | Admin/Priest always; Member only if published | Admin/Priest (immutable: churchId, authorId) | Admin/Priest |
| `events/{eid}` | Admin of church | Member or SuperAdmin | Admin (churchId immutable) | Admin |
| `newsletters/{nid}` | Admin | Member or SuperAdmin | Admin (churchId immutable) | Priest only |
| `invitations/{iid}` | Never (functions only) | SuperAdmin, invitee (verified email), or Admin | Never (functions only) | Never |
| `notifications/{nid}` | Never (functions only) | Member or SuperAdmin | Never | Never |
| `giving/{gid}` | Never (functions only) | Owner, or Priest/Treasurer for explicitly non-anonymous completed/refunded gifts with `churchReceiptVisible == true`, `donorNamePublicSafe == true`, `receiptManagerGivingSafeVersion == 1`, a non-email public donor label, blank `donorEmail`, and no raw Stripe payment identifiers or checkout URL aliases only | Never | Never |
| `taxReceipts/{rid}` | Never (functions only) | Owner only | Never | Never |
| `taxReceiptSummaries/{rid}` | Never (functions only) | Owner, or Priest/Treasurer for non-anonymous summaries with `churchReceiptVisible == true`, `donorLabelPublicSafe == true`, `receiptManagerSummarySafe == true`, and `receiptManagerSummarySafeVersion == 2` only | Never | Never |
| `taxReceiptEvents/{eid}` | Never (functions only) | Never (use redacted `getTaxReceiptAuditEvents`) | Never | Never |
| `eventCheckIns/{id}` | Admin; event/member/shape validated | Admin, owner, or SuperAdmin | Never | Admin |
| `platformAuditLog/{lid}` | Never (functions only) | SuperAdmin | Never | Never |

### Storage Rules Summary

Rules are in `storage.rules`.

| Path | Read | Write |
|------|------|-------|
| `churches/{churchId}/{fileName}` (single segment) | Verified signed-in + active church | Never (functions only) |
| `users/{userId}/avatar/{fileName}` | Signed-in | Owner; <5MB; `image/*` only |
| `churches/{churchId}/posts/{postId}/{fileName}` | Active member (Firestore check) | Active admin/priest (Firestore check); <10MB; `image/*` or `application/pdf` |
| Everything else | Never | Never |

### Security Headers (firebase.json)

Applied to all hosting routes:

| Header | Value |
|--------|-------|
| `Content-Security-Policy` | `default-src 'self'`; scripts/frames allow Firebase Auth + reCAPTCHA/App Check origins; img-src restricted to known domains; no `unsafe-eval` |
| `Strict-Transport-Security` | `max-age=63072000; includeSubDomains; preload` (2 years) |
| `X-Frame-Options` | `DENY` |
| `X-Content-Type-Options` | `nosniff` |
| `X-XSS-Protection` | `1; mode=block` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `Permissions-Policy` | Camera, mic, geolocation, payment restricted to `(self)` |

### Rate Limiting (Cloud Functions)

Firestore-backed per-subject counters in `functionRateLimits/{fnName}:{subjectId}`. Shared across instances and windowed by `resetAt`.

| Function | Limit |
|----------|-------|
| `faithAiChat` | 20 req/min |
| `generatePostContent` | 10 req/min |
| `sendInvitation` | 10 req/min |
| `createStripeCheckoutSession` | 5 req/min |
| `sendTaxReceipt` | 5 req/min |
| `sendCorrectedTaxReceipt` | 3 req/min |
| `sendAnnualTaxReceipt` | 3 req/min |
| `sendCorrectedAnnualTaxReceipt` | 3 req/min |
| `downloadTaxReceiptPdf` | 10 req/min |
| `sendChurchAnnualTaxReceipts` | 1 req/min |
| `sendChurchCorrectedAnnualTaxReceipts` | 1 req/min |
| `createChurchStripeConnectAccountAsSuperAdmin` | SuperAdmin-only |
| `createChurchStripeConnectOnboardingLink` | 3 req/min |
| `sendPushNotification` | 5 req/min |

### XSS Protection

Post content HTML (`contentHtml`) is sanitized with DOMPurify before being passed to `dangerouslySetInnerHTML` in `HomeScreen.tsx`. Allowed tags: `h1, h2, h3, p, strong, em, ul, ol, li, br, a, blockquote, pre, code, hr`. Allowed attributes: `href, target, rel` only.

---

## 8. Frontend Architecture

### Screen Routing

The app has no full router. Navigation is state-driven through `src/app/navigation.ts`, which owns `currentScreen`, event-detail handoff state, and the `/join/{invitationId}` path parser used for emailed invitations. The `Screen` type is:

```
'home' | 'events' | 'giving' | 'community' | 'faith' | 'more' | 'calendar' | 'profile' | 'management' | 'superadmin'
```

### Layout

- **Mobile (< lg breakpoint)**: Single-column phone-width layout (max-w-sm), centered. Bottom navigation bar (`BottomNav`). Header bar with church switcher.
- **Desktop (≥ lg breakpoint)**: Fixed left sidebar (`DesktopSidebar`, 240px wide) with direct access to Home, Events, Community, Giving, More, and role-gated Management. Content uses desktop-width constraints instead of stretching mobile panels across the viewport. No bottom nav.
- **Management desktop**: Priest/admin/treasurer tools use an additional management rail (`ManagementSidebar`) that is compact on smaller desktop widths and expands with labels at wide desktop breakpoints; tables and operational cards are protected against horizontal overflow.
- **Full-screen screens**: `calendar`, `profile`, and `superadmin` suppress the chrome (header + nav).

### Church State

- `useChurches(uid)` subscribes to `users/{uid}/churchMemberships` in real time and clears local membership state through the explicit listener error path if an auth switch causes a stale fanout listener to lose read permission
- The first loaded church becomes `activeChurch`
- The user can switch active church via a picker in `Header`
- `userRole` is derived per active church from `getRoleInChurch(activeChurchId)`
- Role controls which nav items and management tabs are visible

### Data Flow

```
Firebase Auth
  → useAuth() → user, isSuperAdmin
  → useChurches(uid) → memberships, churches, getRoleInChurch

Active church selected
  → useEvents(activeChurchId) → real-time events
  → subscribeToPublishedPosts(activeChurchId) → real-time posts for HomeScreen
  → ManagementView uses useChurchData(churchId) → members + events + newsletters

UI actions needing backend authority
  → src/lib/api/* typed wrappers
  → firebase-functions.ts shared client
  → httpsCallable(...) Cloud Functions
```

### Loading Strategy

- `App.tsx` eagerly loads only the auth-state gate, invitation-path detection, and shared loading UI
- `AuthScreen`, `InvitationAcceptScreen`, and `AuthenticatedApp` are lazy-loaded from `App.tsx`
- Non-home authenticated screens are lazy-loaded from `AppScreenContent`
- `MissionControlScreen` is lazy-loaded from `AuthenticatedApp`
- `PostEditor` is lazy-loaded from the management feature so TipTap and editor-only dependencies are excluded from the initial app bundle
- Firebase frontend clients are split by service, so the auth gate no longer eagerly initializes Firestore, App Check, Cloud Functions, storage, or messaging
- `src/lib/auth.ts` lazy-loads profile-write Firestore code only for sign-up / Google sign-in flows
- `src/app/native.ts` dynamically imports Capacitor plugins only on native platforms, keeping the web entry bundle smaller
- `src/app/native.ts` now also registers `@capacitor/app` launch/app URL listeners so custom-scheme and future universal-link returns can update the SPA location without a full reload
- This keeps the initial bundle focused on the auth decision and defers the authenticated shell, data layer, editor, and native-only code until needed

### Frontend Boundaries

- Components should not call `httpsCallable` directly; Cloud Function access is centralized under `src/lib/api/*`
- `src/lib/db.ts` is now a barrel; Firestore logic is split under `src/lib/db/*` by domain while preserving the existing import surface
- `src/domain/church.ts` is the canonical source for church models and Firestore-to-UI mapping
- `src/App.tsx` now only gates between auth, invitation acceptance, and the authenticated app entry
- `src/components/app/AuthenticatedApp.tsx` owns authenticated subscriptions, notification registration, shell composition, and top-level screen routing
- Mission Control is split into a data hook plus tab/form subcomponents under `src/components/mission-control/*`, leaving `MissionControlScreen.tsx` as a small coordinator
- Management is split into a feature entry point, controller hook, and tab subcomponents under `src/features/management/*`

### Internationalization

- 6 languages: English, Srpski (Latinica), Srpski (Ćirilica), Русский, Română, Українська
- All UI strings in `src/translations.ts`
- Language selected at first launch on `AuthScreen` (language picker is the first screen)
- Persisted to `users/{uid}.preferredLanguage` from `ProfileScreen`, then reflected back into app state after save
- The `FaithAIScreen` also has a local language selector that maps to Gemini prompt language context

### Key Component Responsibilities

| Component | Responsibility |
|-----------|---------------|
| `App.tsx` | Thin auth gate: resolves auth state, invitation handoff, and lazy entry selection |
| `AuthenticatedApp.tsx` | Authenticated entry: subscriptions, notification setup, shell composition, top-level screen routing |
| `AuthScreen.tsx` | Language selection → landing → sign in/up/forgot/guest flows; guest entry is suppressed when opening an invitation link |
| `HomeScreen.tsx` | Parish news feed: published posts, upcoming events, bulletins (static data), saint of the day |
| `ManagementView.tsx` | Thin feature entry for the admin/priest/treasurer control panel |
| `useManagementView.ts` | Management controller hook: subscriptions, counts, permissions, mutations |
| `PostEditor.tsx` | TipTap rich text editor + AI generation panel (calls `generatePostContent`) |
| `FaithAIScreen.tsx` | Chat UI; calls `faithAiChat`; maintains local conversation history |
| `GivingScreen.tsx` | Multi-step donation flow that creates a hosted Stripe Checkout session and restores state after redirect |
| `CommunityView.tsx` | Real-time parish directory from active member profiles, respecting `showInDirectory` |
| `ProfileScreen.tsx` | User profile form, avatar upload, Firestore persistence, password change, church leave, invite-only church discovery, language, sign out, Mission Control entry |
| `InvitationAcceptScreen.tsx` | Accepts `/join/{invitationId}` links through the hardened `acceptInvitation` callable |
| `MissionControlScreen.tsx` | Thin coordinator for Mission Control tabs, sheet state, and error presentation |

---

## 9. Payments (Stripe)

### Current State

Giving is production-wired through a hosted Stripe Checkout flow.
Cloud Functions initialize stripe-node with Stripe API version `2026-04-22.dahlia`; the live webhook endpoint API version must match `2026-04-22.dahlia` so Checkout Session and refund webhook payloads use the same schema that the code is tested against.

1. `GivingScreen.tsx` collects amount, donor name, purpose, and anonymity preference
2. Frontend calls `createStripeCheckoutSession({ churchId, amountCents, purpose, anonymous, donorName })`
3. Function verifies the caller is an active member of the church, creates a card-only Stripe Checkout Session with donate submit copy, copies immutable giving metadata onto the underlying PaymentIntent, and writes a pending `giving` document. Dashboard-enabled delayed payment methods are intentionally excluded until Kandilo has explicit delayed-settlement receipt states and `checkout.session.async_payment_succeeded` handling.
4. Frontend opens the returned `checkoutUrl`; native apps use Capacitor Browser instead of replacing the in-app WebView
5. Stripe sends `checkout.session.completed` or failure/expiry webhooks to `stripeWebhook`
6. The webhook updates the `giving` document status and uses Stripe's event timestamp as `completedAt` so receipt years are not shifted by delayed webhook delivery
7. `onGivingCompleted` sends a non-tax payment receipt email when the status transitions to `completed`, using the Stripe event-derived `completedAt` date in the church timezone
8. If the church has enabled U.S. tax receipt settings with auto-issue on and the donor's private legal receipt profile is complete, `onGivingCompleted` also creates `taxReceipts/{givingId}`, assigns a receipt number, retains the official PDF copy in backend-only Storage with SHA-256/byte-length metadata, emails the official tax receipt to the donor, and mirrors receipt status onto the `giving` doc. If the church has valid U.S. receipt settings but auto-issue is off, the completed donation is stored with `taxReceiptStatus='ready'` for donor or priest/treasurer manual sending rather than being treated as a setup failure. If auto-issue is on but the donor legal name or complete mailing address is missing, the completed donation also stays `ready` with `taxReceiptError='tax_receipt_donor_profile_incomplete'` and no official receipt/counter is created until the donor completes Profile and retries. Completed-donation follow-up is resilient to the payment receipt and tax receipt work finishing on separate updates: when the non-tax payment receipt is already sent but tax receipt state is still missing or only `issued`, a later completed-donation update can finish the tax receipt follow-up without resending the payment receipt.
9. If Stripe later sends a full `charge.refunded` event for the payment intent, `stripeWebhook` marks the giving record `refunded`, voids the single receipt and any annual summaries containing that gift, and writes redacted void audit events. Partial refunds leave the donation completed but mark the giving row and any affected single/annual receipts as correction-required review records so stale amounts cannot be issued or re-emailed. Refund amounts are monotonic in webhook processing: stale lower refund events are recorded as processed but ignored after a larger or full refund so a voided receipt cannot be downgraded back to correction-required review. Donors can self-serve corrected receipts for their own single donations and annual summaries, including anonymous, unclassified, or receipt-manager-hidden gifts because the donor already owns the private receipt data. Priests/treasurers can send corrected replacements for the net eligible amount through `sendCorrectedTaxReceipt` for receipt-manager-visible explicitly non-anonymous single donations or `sendCorrectedAnnualTaxReceipt` for receipt-manager-visible explicitly non-anonymous donor/year annual summaries; anonymous, unclassified, or receipt-manager-hidden donor-years are handled for staff only by the privacy-preserving corrected annual batch path.
10. Checkout completion webhooks can recover a donation through signed Stripe Session metadata if the post-Checkout backend-only payment metadata write did not finish; the webhook stores recovered session, PaymentIntent, payment-status, and refund identifiers in `givingPaymentMetadata/{givingId}` rather than the staff-readable `giving` row, clears any stale setup failure reason, and completes the donation from Stripe's event timestamp. Refund webhooks can match a donation through PaymentIntent metadata even if a delayed Checkout completion has not written backend-only payment metadata yet. Later Checkout events do not resurrect already-refunded donations.

The frontend stores pending donation context in `sessionStorage` before redirect so the app can restore the intended amount/purpose after success or cancellation. After Checkout creation succeeds, the pending context is bound to the returned `givingId` and Stripe Checkout `sessionId`; the success return only polls donation status when those identifiers match the pending checkout state. Checkout return status polling fails closed to an unknown state when a stale or unauthorized giving document cannot be read, so a bad return URL does not break the donor's receipt portal session.

Run `npm run check:stripe-production` before enabling live Stripe donations. The preflight statically verifies the Firebase project target, production `APP_URL`, web Firebase/App Check env, hosting CSP, Firestore indexes including donor/church annual receipt summary queries, Checkout webhook smoke lookups, direct live webhook issue lookups, and receipt-specific email-smoke audit lookup, exported Stripe/tax receipt functions, exact Stripe client API version pin and installed SDK API-version alignment, retired PaymentIntent callable fail-closed replay-protected posture, retired giving create-trigger no-op posture, webhook validation code, live webhook API-version setup docs, the guarded live webhook setup helper, the guarded Firebase receipt secret setup helper, the read-only live Stripe account activation verifier, the read-only live Resend sending-domain verifier, the read-only live Stripe webhook endpoint verifier, receipt PDF/email dependencies, retained official PDF copies with SHA-256 metadata, itemized annual contribution detail in generated receipt PDFs, voided/review-required email resend guards, donor-only PDF download protection, donor invalid-receipt print/download blocking, donor self-service corrected receipt paths, targeted anonymous/unclassified/receipt-manager-hidden blocking, priest/treasurer-only receipt-manager role gates with ordinary-admin exclusion tests, annual batch duplicate-email skipping, redacted annual batch failures, Firestore receipt privacy rules, native universal/app-link production identifiers for Stripe return reliability, session-bound Stripe Connect onboarding return handling, the paginated read-only `audit:tax-receipts` legacy visibility audit with Firestore REST fallback using Firebase CLI auth, guarded complete-scan repair mode, confirmed repair REST fallback, exact `--confirm-repair-count` acknowledgement, post-repair clean re-scan verification, versioned giving safe marker repair, safe-marker annual summary repair, marker-safe blank-`receiptId` annual issuance-gap retry preservation, private annual summary field cleanup, backend-only preservation plus cleanup for legacy raw Stripe giving payment identifiers and checkout URL aliases, and `--fail-on-repairs` gate, and the guarded `deploy:tax-receipts` helper. The normal native app-link check warns until `apple-app-site-association` has the final Apple Team ID and `assetlinks.json` has the Android release signing fingerprint; `npm run configure:native-links -- --apple-team-id TEAMID1234 --android-sha256 AA:BB:...:99` validates those final identifiers and rewrites both hosted well-known files without accepting the known Android debug keystore fingerprint. When `android/keystore.properties` or `KANDILO_UPLOAD_*` points at the release signing key, `npm run configure:native-links -- --apple-team-id TEAMID1234 --android-from-release-keystore` can derive the Android SHA-256 through `keytool` without placing keystore passwords in command arguments. The guarded deploy helper reruns the local preflight and live drift check with `--strict-native-links` so incomplete native return files block release deployment instead of remaining warning-only. It intentionally does not read or print backend secrets; live `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, and `RESEND_API_KEY` must be set in Firebase Secret Manager after the Stripe account, live webhook endpoint, and live email provider account are ready. Run `npm run configure:receipt-secrets` for the no-network plan, or `npm run configure:receipt-secrets -- --set-all --confirm-project kandilo-2f7a9` from a private terminal to set those three receipt-path secrets through the pinned Firebase CLI without Kandilo reading or printing the values. After Stripe corporate, tax, and bank details are submitted, run `STRIPE_SECRET_KEY=sk_live_... npm run check:stripe-account-live` from a shell that has the live key only for that command. The account verifier retrieves `/v1/account` with the same pinned Stripe API version as the Functions client and fails unless the live account can charge, can pay out, has submitted business details, has no currently due or past-due requirements, and is not disabled; it prints only coarse readiness booleans, requirement counts, country, default currency, and the pinned API version, not Stripe account IDs, business names, bank details, tax identifiers, or requirement field names. After the Resend sending domain is configured, run `RESEND_API_KEY=re_... npm run check:resend-live` from a shell that has the live key only for that command. The Resend verifier lists sending domains through the API and fails unless exactly one `kandilo.org` sending domain exists and is verified; it prints only the expected domain/status, not the API key or DNS/domain record details. Before creating the live Stripe webhook endpoint in Dashboard, run `npm run configure:stripe-webhook` to print the exact endpoint URL, API version, event allowlist, and API request shape, with the helper sending the same pinned `Stripe-Version` request header and endpoint `api_version`. If using the helper to create the endpoint, run `STRIPE_SECRET_KEY=sk_live_... npm run configure:stripe-webhook -- --create --confirm-project kandilo-2f7a9 --print-secret-once` from a private shell only; it refuses test keys, refuses duplicate production URL endpoints, and prints Stripe's one-time `whsec_...` signing secret so it can be immediately stored as `STRIPE_WEBHOOK_SECRET` in Firebase Secret Manager. After the live Stripe webhook endpoint is created, run `STRIPE_SECRET_KEY=sk_live_... npm run check:stripe-webhook-live` from the same kind of temporary shell environment. The webhook verifier lists Stripe webhook endpoints through the Stripe API using the same pinned `Stripe-Version` request header and fails unless exactly one matching live endpoint is enabled, pinned to `2026-04-22.dahlia`, and subscribed only to `checkout.session.completed`, `checkout.session.expired`, `checkout.session.async_payment_failed`, and `charge.refunded`, with no wildcard or unrelated event delivery; it cannot recover the live `whsec_...` value because Stripe only returns that secret when the endpoint is created. Run `npm run deploy:tax-receipts:plan` to review the exact deploy flow, then `npm run deploy:tax-receipts -- --confirm-project kandilo-2f7a9` from Node 22 to run the strict local Stripe readiness check, lint gate, full QA gate, run an explicit production web build, run a pre-deploy legacy visibility audit, deploy Functions plus Firestore rules/indexes, Storage rules, and the hosted portal UI with the repo-pinned Firebase CLI from `devDependencies`, finish with the strict live drift check, and then rerun `npm run audit:tax-receipts -- --fail-on-repairs` after deploy. After any manual receipt release deploy, run `npm run check:firebase-live`; this read-only check first confirms local `dist` is current with frontend source inputs, then uses the Firebase CLI/Firebase Rules API plus Hosting checks to confirm the deployed project actually includes active current Node 22 receipt Functions, active legacy-safe shims, exact Stripe/Resend secret bindings on deployed Functions, enabled Secret Manager metadata for Stripe/Resend secrets without reading values, Firestore indexes, Firestore receipt/privacy rules, matching Storage rules, hosted portal security headers, hosted portal build asset references/files, and hosted universal/app-link JSON matching the local `.well-known` files, preventing a local-ready/live-stale mismatch. Then run `npm run audit:tax-receipts -- --fail-on-repairs`; read-only mode uses Admin SDK credentials when available and otherwise uses Firebase CLI auth with Firestore REST field masks, and confirmed repair mode can use the same REST fallback with update masks and document-exists preconditions. The audit rejects unknown or mistyped audit arguments before reading or repairing production data, so a wrong scope flag cannot silently broaden a reviewed live repair. If it reports an incomplete scan, rerun with a higher `--limit` until the scan completes before repairing. If it reports legacy visibility repairs after a complete scan, apply only the guarded repair command suggested by the audit after reviewing the aggregate counts; that command preserves the same `--church`, `--limit`, and `--page-size` scope as the reviewed scan and includes `--confirm-repair-count N`, where `N` is the exact current repair count. Rerun the failing read-only audit gate before live smoke donations. The repair command refuses to write after incomplete scans, missing repair-count confirmation, or stale repair-count confirmation, and after any writes it immediately re-scans and fails unless no legacy receipt visibility repairs remain.

`npm run deploy:tax-receipts:plan` also reports whether the current Xcode project and Android release-signing configuration can derive the final native app-link identifiers locally, so missing Apple Team ID or Android release keystore setup is visible before the long deploy gate starts.

`npm run check:firebase-live` also reads the deployed Cloud Scheduler job for `prepareYearEndAnnualTaxReceipts` and fails if it is missing, paused, no longer matches the expected `every 24 hours` cadence in `Etc/UTC`, or the retry count is no longer zero.

The live Stripe account CLI and Mission Control readiness panel include Stripe `requirements.eventually_due` and `future_requirements` only as coarse warning counts. Current or past-due account requirements still block launch readiness, while eventual and future queued requirements remain non-blocking but visible so they can be handled in Stripe before moving into current requirements.

Clean `npm run audit:tax-receipts -- --fail-on-repairs` runs now print that no legacy receipt visibility repairs are needed instead of suggesting a zero-repair command.

After the first small live donation, run `npm run check:live-donation-smoke`; this read-only Firebase CLI auth verifier directly queries live webhook issue statuses and live processed Checkout completions with Firestore REST field masks so newer test-mode activity or later refund/expiry traffic cannot hide the smoke donation or a live validation/missing-giving/unpaid-session issue, requires smoke evidence inside a default 72-hour freshness window unless operators explicitly pass `--max-age-hours`, follows only the matching giving/receipt records needed to prove completion, receipt readiness, stored assigned receipt identity, portal-visible receipt number matches the donor-only receipt number, and amount/currency consistency, refuses `--project` values other than `kandilo-2f7a9`, and prints aggregate pass/fail state without donor, giving, receipt, Stripe event, session, payment, PDF metadata, or access-token identifiers. Before announcing live tax receipt availability, send the official tax receipt for that smoke donation and rerun `npm run check:live-donation-smoke -- --require-sent-receipt` so the smoke proves the official receipt email, stored receipt issue/email timestamps, `giving.taxReceiptSentAt` portal mirror timestamp, retained PDF status/timestamp, retained PDF object exists in Firebase Storage with matching byte length/hash metadata, privacy-safe church-facing `giving` mirror state with the receipt-manager safe-version marker matching donor anonymity, matching portal-visible receipt number, no raw Stripe payment identifier or checkout URL alias fields on the church-facing giving mirror, and receipt-specific backend-only `taxReceiptEvents` `email_sent` audit timestamp are all current inside the smoke freshness window rather than only proving manual-mode receipt readiness. Before announcing year-end annual receipt availability, send a non-anonymous closed-year annual receipt covering at least two donations and run `npm run check:live-annual-receipt-smoke`; that separate read-only gate scans recent annual receipt email audit events until it finds a passing non-anonymous staff-safe annual receipt smoke candidate, or validates a specific `--receipt-id annual_...`, proves fresh issue/email/PDF-retention evidence, exact covered-giving IDs and contribution count, itemized contribution lines whose count, currency, amount, and eligible totals match the annual receipt, the donor-only annual receipt identity/amount/currency/assigned-number state, matching staff-safe annual summary mirror with current receipt-manager safe markers and no private full-receipt fields, and retained annual PDF Storage object integrity without printing donor, church, giving, receipt, event, amount, currency, PDF, or access-token values. A corrected or refund-reissue annual receipt cannot satisfy this original annual smoke gate.

The default live donation smoke now proves receipt-ready church-facing `giving` mirror privacy before receipt email smoke: donor email must be blank, receipt-manager visibility and safe markers must match donor anonymity, public donor labels must avoid embedded email-shaped text and the reserved `Anonymous donor` fallback for explicitly non-anonymous rows, and raw Stripe payment identifiers or checkout URL aliases must remain absent. The strict sent-receipt smoke keeps those checks while adding fresh official email, audit, and retained-PDF evidence.

Mission Control analytics also calls the SuperAdmin-only `getPaymentOperationsReadiness` callable to show redacted runtime status for `APP_URL`, Stripe key mode, Stripe account activation readiness, Stripe webhook secret format/presence, redacted live Stripe webhook endpoint readiness, the pinned Stripe API version operators must use for the live webhook endpoint, Resend key presence plus verified single `kandilo.org` sending-domain readiness, the expected webhook endpoint, recent webhook activity, direct latest-live-webhook activity, direct live webhook issue-status evidence, official receipt email-sent smoke evidence, assigned stored receipt plus portal mirror artifact evidence, and runtime annual receipt smoke evidence with a staff-safe annual summary and retained PDF object integrity plus itemized contribution-line proof. Stripe account readiness is reduced to charges enabled, payouts enabled, details submitted, disabled-reason code, country/default currency, and requirement counts; it does not expose Stripe account IDs, business names, bank details, tax identifiers, or requirement field names. Stripe webhook endpoint readiness is reduced to whether the expected URL has exactly one enabled live endpoint, whether that endpoint uses the pinned API version, and whether it uses only the required donation events; it does not expose webhook endpoint IDs or signing secrets. Resend domain readiness is reduced to whether the expected domain is configured, verified, duplicated, or unavailable; it does not expose Resend domain record IDs, DNS records, or API key values. `APP_URL` readiness uses the same Stripe return URL evaluator as Checkout and Connect onboarding: production must have a configured HTTPS base URL without credentials, query, or fragment, while `http://localhost` and `http://127.0.0.1` are accepted only inside the Firebase Functions emulator. The panel otherwise exposes only booleans, coarse modes, warning codes, non-secret URLs, event type/status counts, live/test event mode counts, latest-live status, completed-Checkout counts, live issue-status counts, smoke freshness booleans/window size, redacted receipt email aggregate counts, annual receipt smoke aggregate counts, and timestamps; it does not return Stripe session/payment IDs, giving IDs, receipt IDs, donor UIDs, donor names, donor emails, PDF paths, PDF hashes, or credential values. The top-level production-ready flag now requires configured live-mode credentials, a configured runtime-valid `APP_URL`, a verified live Stripe webhook endpoint at the expected URL, a Stripe account that can charge and pay out with submitted business details and no currently due or past-due requirements, a configured valid Resend key that can list exactly one verified `kandilo.org` sending domain, at least one live-mode processed `checkout.session.completed` webhook smoke event from a completed Checkout donation inside the 72-hour smoke freshness window, the latest live webhook activity to be processed, no direct live validation/missing-giving/unpaid-session webhook issues, a backend-only `taxReceiptEvents` `email_sent` record correlated to the latest fresh live Checkout smoke donation, matching fresh giving mirror where the portal-visible receipt number matches the donor-only receipt number, with the receipt-manager safe-version marker matching donor anonymity, no raw Stripe payment identifier or checkout URL alias fields on the church-facing giving mirror, donor-only sent receipt with an assigned official receipt number, retained PDF status/metadata, and retained PDF object presence/integrity metadata for that same donation, plus a fresh non-anonymous annual receipt smoke candidate from recent annual email audit events whose donor-only annual receipt, itemized contribution-line detail, staff-safe `taxReceiptSummaries/{receiptId}` mirror, and retained annual PDF Storage object all match. The runtime gate also documents that corrected or refund-reissue annual receipts do not satisfy the runtime annual smoke gate. Scanning recent annual events keeps the runtime gate focused on the required non-anonymous annual smoke proof without being knocked out by a newer privacy-protected annual email whose staff-safe summary is intentionally hidden. This lets a SuperAdmin confirm that Stripe activation, the live webhook endpoint, receipt email sender readiness, a current live test donation, the official receipt email path, the annual year-end receipt path, and the retained filing-copy path reached Firebase without opening raw webhook records, raw tax receipt audit records, counting refund-only activity as donation-path evidence, counting unrelated or older receipt emails as live smoke proof, or accidentally letting newer test-mode webhook rows hide the direct live smoke evidence.

### Constraints

- Minimum donation: $0.50 (50 cents, Stripe minimum)
- Maximum per transaction: $10,000 (1,000,000 cents)
- Currency: derived server-side from the church country (`usd` for U.S./unknown, `cad` for Canadian parishes); client-supplied currency is accepted only when it matches that country-derived value.
- By default, donations settle to the platform Stripe account. SuperAdmins can configure a Stripe connected account per church in backend-only `churchPaymentSettings/{churchId}` either by creating a U.S. or Canadian Stripe Accounts v2 recipient connected account with Express dashboard access from Mission Control or by pasting an existing Stripe `acct_...` ID. Kandilo-created accounts request the recipient `stripe_balance.stripe_transfers` capability, store `stripeConnectAccountApi='v2'`, and keep routing disabled until onboarding is complete. Mission Control defaults pasted connected accounts to the Accounts v2 recipient API, lets SuperAdmins explicitly choose the legacy v1 account path when needed, and the backend honors that selected API while preserving the stored API for unchanged account IDs from older clients. In-app account creation requires a saved U.S. or Canadian church record with a valid saved contact email, and Stripe receives the saved church name, country, contact email, website, and country-derived currency/locale details. The Mission Control create-account action is disabled while the church name, country, contact email, or website changes are unsaved, so operators cannot accidentally create a connected account from stale organization details. SuperAdmin save preserves the stored account API version and verifies the connected account is ready with the configured Stripe key before enabling routing; Checkout creation repeats the readiness check before routing with `payment_intent_data.transfer_data.destination`. V2 accounts must have the recipient transfer capability active and no currently due or past-due requirements; legacy-compatible pasted accounts must be charge/payout/details-ready with no open requirements. Priests and treasurers see only redacted connected-account setup status in the receipt manager: whether an account exists, whether routing is enabled, and whether it is a v1/v2 account, never the account ID or Stripe requirement/business/bank/tax fields. After an account ID exists, priests and treasurers can open a Stripe-hosted onboarding link from the receipt manager without seeing the account ID. Stripe Connect return/refresh links route the app back to that church's receipt manager and show whether onboarding returned or needs a fresh link only when the returned state token matches the pending onboarding session.
- Hosted checkout and Stripe Connect return URLs are derived from `APP_URL` (fallback: `https://app.kandilo.org`) and fail closed at runtime unless the value is a valid HTTPS base URL; Firebase Functions emulator runs may use localhost HTTP for local testing.
- Live mode requires manual Stripe account activation, corporate/bank/tax details, `npm run check:stripe-account-live` verification with a live Stripe key in the shell environment only, a live webhook endpoint for `https://us-central1-kandilo-2f7a9.cloudfunctions.net/stripeWebhook` using API version `2026-04-22.dahlia` and subscribed only to Checkout completion/failure events plus `charge.refunded`, `npm run check:stripe-webhook-live` verification with a live Stripe key in the shell environment only, `npm run configure:receipt-secrets` Secret Manager setup for receipt-path secrets, verified active deployed Functions with exact secret bindings, a fresh Functions deploy after secret changes, `npm run check:live-donation-smoke` after the first small live donation, `npm run check:live-donation-smoke -- --require-sent-receipt` after sending that smoke receipt and proving the church-facing giving privacy mirror before announcing receipt availability, and `npm run check:live-annual-receipt-smoke` after sending a non-anonymous closed-year annual receipt covering at least two donations before announcing year-end annual receipt availability

### Tax Receipt Posture

Kandilo separates payment confirmations from official tax receipts. The donation confirmation email confirms a Stripe payment, explicitly says it is not an official tax receipt, and tells donors that official tax receipts are sent separately when available. New official tax receipts are generated only when the church is active, `churches/{churchId}.taxReceiptSettings.enabled == true`, `jurisdiction == 'US'`, legal receipt details are complete, and `eligibilityConfirmed == true`. Churches can choose auto-issue or manual issuing; auto-issue creates and emails the official receipt after Stripe completion, while manual mode stores completed donations as receipt-ready without creating an official receipt until the donor or a priest/treasurer sends it. Canadian staged settings keep completed gifts in `taxReceiptStatus='not_configured'` with `taxReceiptError='tax_receipt_unsupported_jurisdiction'` so donor/church portals show the Canada/CRA unavailable state instead of a repair-required error. The U.S. renderer is for cash-donation written acknowledgments and includes the organization name, cash amount/eligible amount, donor identity details, receipt number/date evidence, and the configured goods/services or intangible-religious-benefits statement expected by IRS charitable-contribution written-acknowledgment guidance: [IRS written acknowledgments](https://www.irs.gov/charities-non-profits/charitable-organizations/charitable-contributions-written-acknowledgments). The donor and church receipt UIs use the same readiness rules to show "not enabled" states and disable send controls before calling the backend. Official receipt issuance now fails closed until the donor private profile has a legal receipt name and complete mailing address. If auto-issue reaches a completed donation before those private profile fields exist, Functions leave `giving.taxReceiptStatus='ready'` with `taxReceiptError='tax_receipt_donor_profile_incomplete'`, do not create a receipt/counter sequence, and allow the donor or priest/treasurer to retry after the donor updates Profile. Donor legal receipt profile fields are copied onto official receipt records, email bodies, and generated PDF attachments, but are not fanned out to church member directory records or church-facing annual summaries. Before an official PDF is emailed or downloaded, Functions retain a backend-only Storage copy and persist `pdfStoragePath`, `pdfSha256`, `pdfByteLength`, `pdfRetentionStatus`, and `pdfRetainedAt` on the donor-only receipt document; client Storage rules do not grant direct read access to these retained copies. Canada/CRA receipt setup can now stage the mandatory cash-receipt details that are not part of the U.S. flow, including receipt issue location, authorized signer name/title, secure electronic signature readiness, and retention readiness for email-issued receipt copies. The PDF/email renderers can display the CRA-specific draft fields, CRA name/website, registration number label, issue location, authorized signer fields, and advantage statement for future Canadian records, but Canada/CRA receipt issuance remains blocked at Mission Control save time, issuance time, stored-receipt resend time, and donor PDF download time until Kandilo can generate read-only/non-editable PDF receipts that are protected from unauthorized access, encrypted, electronically signed under authorized parish control, retained, and printable on request. Stored receipt resend and download paths enforce both the receipt's stored jurisdiction and the church's current unsupported-jurisdiction setup before retained/generated PDF work. Until then, any Canada/CRA renderer output is visibly marked as a staging draft and not valid for income tax purposes. The staged fields are based on CRA guidance for required receipt information and computer-generated receipts: [required receipt information](https://www.canada.ca/en/revenue-agency/services/charities-giving/charities/operating-a-registered-charity/issuing-receipts/what-information-must-on-official-donation-receipt-a-registered-charity.html) and [computer-generated receipts](https://www.canada.ca/en/revenue-agency/services/charities-giving/charities/operating-a-registered-charity/issuing-receipts/computer-generated-receipts.html).

The same profile gate now runs inside the Checkout callable before Stripe is initialized or any `giving` / `givingPaymentMetadata` records are written, so stale or custom clients cannot bypass the receipt-ready donation preflight.

If pre-send receipt preparation fails, Kandilo clears the short-lived email send claim, persists `tax_receipt_preparation_failed`, mirrors the error where a non-anonymous church-facing operational row exists, and writes only redacted receipt audit data. Malformed legacy receipt data without a safe public error code is normalized to `tax_receipt_preparation_failed` instead of surfacing client validation-only errors, so operators can repair and retry without waiting for a stale send claim to expire.

Receipt email retry detail: each official receipt send attempt carries a backend-only `emailSendAttemptId` used to derive a redacted Resend provider idempotency key; stale send claims reuse that attempt ID so an ambiguous retry after provider acceptance does not create a second official PDF email.

Privacy decision: regular parish admins do not receive donor giving or tax receipt access. Donors can view/print issued receipt records from Giving, download a freshly generated PDF copy, and email another copy to themselves. After Stripe returns from a completed donation, the success screen keeps a direct Receipts action in Giving, then scrolls and moves focus to the visible receipt-history panel so they can immediately review receipt readiness/history instead of being sent only to Home. After a donor sends an individual or annual receipt, the portal opens the freshly issued donor-only receipt record immediately when it can be loaded. Voided or correction-required receipt records remain visible for donor history, but the donor portal blocks PDF download and browser print actions for those records so stale or invalidated copies are not reused as official filing copies. Recent donor receipt records are rendered from both the giving history and the donor-only `taxReceipts` list, so an issued single-donation receipt remains visible even when its original giving row is outside the capped recent giving query. Priests and treasurers can view only backend-marked, receipt-manager-safe church giving and annual summary rows, then send individual or annual receipts only for receipt-manager-visible explicitly non-anonymous donations/donor-years, but the queue is send-focused: new operational `giving` rows keep donor emails blank/removed, Firestore reads require `churchReceiptVisible == true`, `donorNamePublicSafe == true`, `receiptManagerGivingSafeVersion == 1`, blank `donorEmail`, no embedded email-shaped `donorName`, and completed/refunded `status` for giving rows plus `churchReceiptVisible == true`, `donorLabelPublicSafe == true`, `receiptManagerSummarySafe == true`, and `receiptManagerSummarySafeVersion == 2` for annual mirrors; pending/failed Stripe attempts stay donor-only, the frontend mapper carries those visibility markers and the management receipt tab also filters on them defensively, checkout does not fall back to account email as the public donor label, embedded email-shaped `donorName`, profile `displayName`, and membership `displayName` values are ignored when public receipt labels are rebuilt or mapped, missing anonymity metadata maps as donor-private in the client, legacy rows without the backend-owned current safe-version markers or with email-shaped donor labels fail closed for receipt-manager raw Firestore reads, and the management UI displays that email is hidden in parish views. Anonymous or missing-anonymity `giving` rows and anonymous or missing-anonymity annual mirrors are donor-client-only because those documents still contain the donor `userId`; callable authorization also blocks receipt-manager targeted sends for anonymous, unclassified, or receipt-manager-hidden individual donations and donor-years. Bulk church/year annual sending can still email anonymous, unclassified, or receipt-manager-hidden donors without exposing their identities to the church UI or callable response. Donor private receipt profile fields on `users/{uid}`, raw `giving`, full official `taxReceipts`, annual summary mirrors, and audit events are not directly readable by SuperAdmin browser clients; Mission Control uses backend callables for aggregate giving stats, payment readiness, and whitelisted receipt audit activity. Firestore tax receipt document reads and PDF downloads are donor-client-only. The church and donor portals use minimal `taxReceiptSummaries` annual mirrors for status/receipt-number visibility and an `includesPreviouslyReceipted` warning flag without exposing donor legal name, donor address, donor email, organization tax ID, covered donation IDs, partial-refund giving IDs, correction giving IDs, correction timestamps, retained PDF/PDF-template metadata, backend send-claim/idempotency metadata, operator UIDs, or the full official receipt record; Firestore rules deny receipt-manager direct reads if a malformed annual mirror contains those private full-receipt fields, staff list queries require the current versioned safe marker and public-label marker so marker-only malformed mirrors stay hidden, and backend summary writes delete those fields before setting that current marker version. Redacted `taxReceiptEvents` provide backend accountability for who issued/sent/retried/downloaded receipts and whether delivery failed, but raw audit documents are not client-readable; Mission Control exposes only a whitelisted receipt audit feed without target donor UID, giving ID, raw receipt document ID, donor email, donor name, donor address, organization tax ID, or receipt contents. This keeps the church portal send-focused while avoiding broad access to full official receipt contents.

Unsupported-jurisdiction full receipt records follow the same invalid-record print/download blocking path as voided or correction-required records.

Unsupported-jurisdiction giving rows and annual mirrors also suppress donor and receipt-manager resend buttons so the UI does not invite a backend-failing stored receipt delivery attempt.

The donor and receipt-manager action helpers pass the current church unsupported-jurisdiction receipt state into single and annual action availability checks, so a missing legacy error marker cannot make a Canadian staged receipt look sendable.

Annual summary staff reads also require the backend-owned `donorLabelPublicSafe == true` marker. Firestore rules deny direct receipt-manager reads when a malformed safe-marked mirror contains an embedded email-shaped donor label or the reserved `Anonymous donor` label on a non-anonymous mirror, and staff list queries include the marker so legacy or repaired mirrors without public-label safety proof stay hidden until Cloud Functions or the guarded audit rebuilds them. The same reserved-label rule applies to non-anonymous church-facing giving rows, so a row cannot be both staff-visible and labelled as anonymous.

Individual receipts, donor/year annual summaries, priest/treasurer-triggered church/year annual batches, and priest/treasurer-triggered corrected annual batches for partially refunded donor-years are implemented for completed U.S. cash donations. Annual summaries are available only after the donor year has closed in the church timezone, so parishes do not issue an incomplete deterministic year-end receipt before later gifts arrive. Annual summaries use the same `taxReceipts` collection with `kind='annual'`, include the covered `givingIds`, donation count, total eligible amount, covered period, itemized contribution date/purpose/original amount/eligible amount lines in the full official receipt/PDF, and a warning not to double-claim both individual and annual summary receipts. Annual summaries currently require one explicit supported currency per donor-year; if legacy data, missing currency, or a country/currency change produces invalid or mixed-currency giving in the same closed year, the backend rejects consolidated issuance and the donor/church portals mark that annual row for review instead of offering a send action. The donor and church annual receipt rows surface a non-private `includesPreviouslyReceipted` warning flag before opening or sending the full receipt when a year-end summary contains gifts that also have individual receipts, and the callable API requires `acknowledgePreviouslyReceipted=true` before issuing or emailing those annual receipts. Bulk annual and corrected annual sending are capped at 250 active donor-years per call, skip mixed- or missing-currency donor-years into redacted review failures before consuming limited send slots, skip already-emailed annual receipts when the same church-year batch is rerun, and prioritize unsent donor-years on rerun so a large parish can progress beyond the first 250 already-sent recipients. The donor source scan is paged through the closed-year giving window with an explicit safety cap rather than stopping at the first fixed query window, so later donor-years are not stranded behind older already-sent rows. The default-off annual receipt preparation job also paginates active parishes with an explicit scan cap, prepares closed-year annual records for opted-in U.S. parishes, and leaves email off unless annual auto-email is separately default-off and explicitly enabled. When annual auto-email is enabled, the scheduler emails only safe prepared annual receipts; it still skips partial-refund, mixed- or missing-currency, and previously individually receipted donor-years for review, writes aggregate backend-only review summary audit events without donor identifiers, and logs `activeChurchScanTruncated` when the active-parish cap is reached. Batch responses report skip/failure counts without returning donor IDs to the priest/treasurer caller or writing donor IDs into routine batch failure console logs, so successful donor receipts are not blocked and anonymous donor identifiers are not exposed through batch errors. Partial refunds have correction paths for donor-owned single-donation receipts and annual receipts: the existing stale receipt is voided, a new receipt number is assigned, and the replacement receipt uses the net eligible amount after Stripe's refunded amount at both receipt total and itemized contribution-line level. If a later, larger Stripe partial refund changes a donor-year net amount, issuing the new corrected annual receipt voids any earlier corrected annual receipt for that donor-year so the portal does not leave multiple usable correction records. Corrected replacement receipt emails, PDFs, and donor detail views explicitly label the record as corrected and show the original amount, refunded amount, and net eligible amount so donors do not reuse a stale receipt after a partial refund. Donors can self-serve corrected receipts for their own anonymous, unclassified, or receipt-manager-hidden gifts because they already own the private receipt data. Anonymous, unclassified, or receipt-manager-hidden single donations that become partially refunded are not targetable by receipt managers because the `giving` document remains donor-private; anonymous, unclassified, or receipt-manager-hidden donor-years can still be corrected through the church/year corrected annual batch without exposing donor identifiers in the UI or callable response. If a full refund voids a mixed annual receipt, Kandilo preserves the voided original and can issue a new annual receipt number for the remaining eligible gifts in that donor-year; donor and church receipt actions expose that reissue only while current receipt setup is ready and completed eligible gifts still exist, and church-year annual batches can issue the same replacement without mass resending it on later reruns.

Scheduled annual review summary audit events surface in Mission Control only as a review category plus aggregate `reviewCount`; they do not include donor identifiers, giving IDs, receipt IDs, receipt contents, or donor profile details.

Tax receipt delivery and stored donor receipt email prefer the donor's verified Firebase Auth primary email over client-editable profile or historical giving email fields. New official receipt issuance fails closed without that verified Auth email and never falls back to stale `giving`, profile, or membership email fields, while existing stored receipt resends may still use the official email already retained on the donor-only receipt record if the current Auth email is unavailable. Auto-issue and manual single/annual send attempts that hit this verified-email guard persist safe retry state without assigning receipt numbers or exposing donor contact/legal fields. Receipt records prefer the donor's private tax receipt legal name and address over public display/profile fields, while the church-facing `giving` row keeps only public donor name/status data, clears donor email during checkout/receipt updates, and sets backend-owned `churchReceiptVisible` only for safe explicitly non-anonymous rows; the frontend giving mapper also redacts any legacy `donorEmail` field and treats missing `anonymous` / `donorAnonymous` metadata as donor-private before receipt-manager state is built. Anonymous or unclassified donations stay labeled anonymous with no church-facing donor email and are excluded from receipt-manager Firestore reads. Receipt re-sends also refresh the official receipt email from Auth when available, keeping official receipts tied to the account identity rather than to user-editable directory metadata, but church-facing giving rows are not backfilled with the Auth email. Already-issued receipts, including existing corrected annual receipts, can be re-emailed by the donor from the stored official receipt record even if new receipt issuance is later disabled or the parish is later deactivated; new issuance still requires an active church and current receipt settings to be ready. New single-donation receipt issuance requires an explicit supported donation currency before reading the receipt counter, so legacy or repaired giving rows without currency cannot silently default into an official USD receipt. Stored single-donation receipt resends also validate that the existing receipt still matches the donation's church, donor account, giving ID, amount, eligible amount, and explicit supported currency before any email preparation begins, and stored official receipt email/PDF delivery fails closed with `tax_receipt_missing_receipt_number` before rendering or retaining a PDF when a legacy or manually inserted receipt has no official receipt number. Manual-mode completed donations are marked receipt-ready only while the church is active; if a donation completes after deactivation, the tax receipt state is stored as not configured with `church_inactive` rather than advertising a sendable receipt. Auto-issue setup failures persist stable public codes such as `tax_receipt_setup_required` instead of backend exception text, so donor and church portals show setup-needed copy without exposing private parish configuration details. Each tax receipt email uses a retained official PDF copy when present or generates and retains one before provider delivery, donor portal PDF downloads prefer the same retained copy and retain a generated copy for legacy records, new receipt records persist the `pdfTemplateVersion` used at issuance, and generated PDFs print that template version in the footer for auditability but do not print internal receipt document IDs; public receipt-number fallbacks use a neutral label instead of internal document IDs; targeted receipt-manager send responses redact raw receipt document IDs while donor self-service responses keep the receipt ID needed to open the donor-only receipt; legacy receipts without a stored marker render as `legacy-unversioned`. Plain Latin receipts use standard PDF fonts, while receipts containing Cyrillic, Greek, or Latin extended legal names/addresses embed packaged Noto Sans subsets so Orthodox parish donor names are not degraded into placeholder characters. A short-lived `emailSendingAt` claim prevents duplicate official receipt emails from concurrent retries while allowing stale attempts to recover; completed donation follow-up can also recover missing auto-issued tax receipt state after the non-tax payment receipt has already been sent. Annual PDFs include itemized contribution detail while church-facing annual mirrors do not, and corrected PDFs/emails include a correction note plus original/refunded/net amount detail. If PDF generation, retained-copy verification/storage, missing official receipt number, or provider delivery fails during email delivery, the attempt persists `emailError`/`emailFailedAt` on the official receipt, mirrors `error` state to explicitly non-anonymous church-facing annual summaries or single-donation giving rows, preserves `taxReceiptEmailError` on the auto-issue giving mirror for retry visibility, clears the send claim, and writes a redacted `taxReceiptEvents` audit entry. Receipts voided by full Stripe refunds cannot be emailed or downloaded again and remain visible as voided records for donor/accounting history; stored receipt email and PDF paths re-check covered giving immediately before delivery/rendering/retention so stale single receipts are voided after full refunds or marked review-required after partial refunds, while valid corrected receipts for the current net refund state remain usable. Mixed annual receipts voided by a full refund are replaced by a new annual receipt for remaining eligible gifts rather than reusing the voided document, and annual resend re-checks covered giving for full-refund state so a stale unvoided annual receipt is voided before a replacement is issued or emailed. Stored annual receipt resend and email delivery also verify the covered donation IDs, totals, donation count, explicit supported currency, and itemized contribution lines still match the current closed-year donor-year set, so a late backdated donation, repaired giving row, missing currency, corrected amount, or stale annual line item cannot trigger a stale year-end receipt email. Partially refunded donations are blocked from standard issuance/resend while they are correction-required; donors can self-serve corrected receipts for their own net eligible amount, priests and treasurers can send corrected explicitly non-anonymous receipt-manager-visible single-donation and annual receipts, and anonymous/unclassified donor-years use the corrected annual batch path for staff-triggered delivery. After a correction exists, the standard allowed resend path resolves to the corrected receipt.

Stored single-donation receipt email delivery and donor PDF download repeat the same match check used by stored single-donation resends, including corrected partial-refund receipt amount/original/refund/currency matching, before retained/generated PDF work, before retaining a newly generated PDF copy, and immediately before provider delivery or download audit logging. New single-donation receipt issuance also fails closed when a non-voided annual receipt already covers that giving ID, and the donor portal marks those gifts as included only from the full annual receipt covered giving IDs instead of offering another send action. Donor annual rows also treat standalone donor-owned single receipt records from the same church/year as duplicate-claim evidence when the capped giving list no longer contains the original giving row, without creating an annual row solely from a single receipt. Backend annual issuance uses the same single-receipt evidence before issuing, reissuing, resending, or scheduled-emailing annual receipts, so stale giving mirrors cannot bypass the explicit annual duplicate-claim acknowledgement guard. Church receipt managers see annual summary status, but row-level single send actions rely on the backend exact duplicate guard because staff-safe summary mirrors intentionally omit covered giving IDs.

Receipt-manager raw receipt ID redaction is covered for first-time annual issuance, first-time corrected annual issuance, and stored receipt resends, preserving the church portal as a send/resend surface rather than a full receipt viewer.

Stored annual receipt resend, email delivery, and donor PDF download also verify the covered donation IDs, totals, donation count, explicit supported currency, and itemized contribution lines still match the current closed-year donor-year set, so a late backdated donation, repaired giving row, missing currency, corrected amount, or stale annual line item cannot trigger a stale year-end receipt email or filing-copy download. Email delivery and donor annual PDF downloads check this before retained/generated PDF work, again before retaining a newly generated PDF copy, and again immediately before provider delivery or the download audit log and return. Donor PDF download failures use the same safe backend receipt error-code mapping as email sends, so review-required annual receipts can show a specific review message instead of only a generic download failure. Malformed donor PDF download preparation failures without a safe public error code are normalized to `tax_receipt_preparation_failed` before the PDF renderer, retained-copy lookup, Storage write, or download audit event can run.

The church receipts tab shows a setup-required warning when tax receipt settings are missing or unsupported, shows Canada/CRA-specific unavailable copy for Canadian parishes, shows bulk annual send actions for recent closed receipt years based on the church timezone independent of the capped recent-donation list, and renders annual summary rows from `taxReceiptSummaries` even when the donor's giving rows are not in the recent giving query. Corrected annual batch actions are also shown by closed year instead of only when staff-visible donor rows reveal a partial refund, so anonymous, unclassified, or receipt-manager-hidden donor-years remain reachable through the privacy-preserving batch path without button presence leaking whether those private donors exist. This avoids hiding last year's batch action or already-issued annual summaries when the latest visible donations are all current-year gifts. Donor and church receipt views surface not-configured, Canada/CRA unavailable, manual ready, refunded, and correction-required states before send buttons are enabled, matching the backend refund safeguards and making clear that Canadian receipt issuance is blocked by compliance support rather than parish setup. Settled existing receipts remain resendable from their stored official receipt records. Existing annual receipts that failed during retryable delivery work, such as Resend setup, PDF generation/retention, or provider submission, remain retryable from donor and receipt-manager queues only when a stored annual receipt identity exists; safe blank-receipt issuance-gap summaries for missing donor profile or missing verified Auth email remain retryable once the donor fixes the required private detail. Generic identity-less delivery failures, review-required, mixed-currency, and voided annual rows stay blocked. The receipt-manager queue is refund-aware for the non-anonymous operational giving records receipt managers are already authorized to read: partial-refund rows show original amount, refunded amount, and net eligible amount before corrected sends, while full official receipt contents remain donor-only. The staff UI states this send/resend-only boundary directly: priests and treasurers do not get full receipt view/download controls, donor account emails, donor legal name/address details, or retained PDFs in the church portal. Known donor-profile-incomplete rows are shown as donor profile needed and retryable, so staff can ask the donor to complete their private profile and retry later without seeing or editing the donor's legal receipt details. Verified-email annual retry summaries are shown as ready/retry-send with only safe guidance to ask the donor to verify their account email; they do not expose donor contact details or full receipt contents. Manual single-receipt send attempts that hit the same missing-profile backend guard persist the same safe retryable row state without exposing donor legal details. Manual annual and corrected annual send attempts that hit the missing-profile or missing-verified-email backend guard persist staff-safe annual summary error rows with blank receipt IDs, safe public donor labels only, and no covered giving IDs or donor legal/contact fields; successful retry replaces that mirror with the issued/sent summary. When the active church is ready to issue receipts, the donor checkout details step now checks the donor's verified Auth email and private receipt profile, offers a branded verification-email resend for unverified accounts, and requires the donor to save legal name/address details inline before Stripe Checkout, with Profile still available for the full account edit path. This keeps receipt-ready donations from reaching Stripe in a state that would leave the official receipt stuck until the donor returns later. The donor receipt history applies the same profile and verified-email gates to new single, corrected, annual, and corrected annual issuance actions, labels currently profile-blocked ready receipts as receipt profile needed, and returns them to the normal available state as soon as the private profile is complete so stale backend error flags do not keep donors stuck. Stale donor-profile warning copy is also suppressed once the current private profile is complete, while other receipt delivery errors remain visible. Existing receipt resends stay available because those official receipt records already contain the filing details.

The payment review step mirrors the same checkout prerequisite prompts and action label if verification or profile state becomes stale after the details step, so the final Stripe button does not look ready while the backend would reject receipt-ready checkout.

Receipt-manager buttons label repeat delivery of already-sent single and annual receipts as resend actions so staff do not confuse a stored receipt email resend with first issuance. Donor receipt-history buttons use the same distinction from stored delivery evidence: first-time official receipt emails stay labeled as email actions, while previously emailed single and annual receipts are labeled as resend actions. The public fallback receipt number `unassigned` is not assigned receipt evidence in either portal, so it is hidden from mapped receipt rows and cannot make a single or annual receipt resendable, settled, printable, downloadable, or counted as an individually receipted gift for annual duplicate-claim acknowledgement. Corrected single and annual receipt actions keep corrected wording on first delivery and resend labels whenever the donor has a stored corrected receipt or a safe annual summary `correctedReceipt` marker, so the portal does not imply a replacement receipt is the original stale receipt. Annual summary mirrors expose only that boolean corrected marker; private correction receipt IDs, correction giving IDs, partial-refund giving IDs, source reason codes, operator UIDs, and correction timestamps remain full-receipt-only.

When current donor-year giving rows already show a partial-refund correction/review state, donor and receipt-manager annual actions treat that current evidence as authoritative even if the stored annual summary still looks settled: standard annual resends are blocked, and the corrected annual path is offered only when the parish's current receipt setup can issue the replacement. A settled corrected annual receipt whose safe amount mirror matches the current net eligible donor-year amount remains resendable, so an already-issued replacement does not stay stuck in review; if a later larger partial refund changes the net amount, the old correction no longer matches and the row returns to review/corrected-send state. The donor and church receipt action helpers also treat Stripe partial-refund metadata itself as a correction signal, so a legacy or repaired row with a refund amount but a missing mirrored correction code does not advertise a stale standard send path before the backend rejects it. Corrected-send buttons are narrower: they require correctable refund metadata with a positive refunded amount lower than the original donation, matching the Cloud Functions receipt amount guard; missing, invalid, or full-refund-like metadata stays review-only until repaired or voided by the backend. Stored annual partial-refund summary reasons remain usable when the current giving rows are outside the capped client query, but once current donor-year giving is loaded, invalid current refund metadata wins over the summary mirror and hides corrected-send actions.

---

## 10. AI Features

### Faith AI Chat

- **Route**: `FaithAIScreen` → `faithAiChat` Cloud Function
- **Model**: `gemini-2.0-flash-lite`
- **System prompt**: Orthodox Christian spiritual guide grounded in Church Fathers and tradition
- **Input validation**: message ≤ 2000 chars; history ≤ 40 entries; each history entry ≤ 4000 chars
- **Rate limit**: 20 requests/min per user
- **Abuse controls**: requires a verified, non-anonymous account and Firebase App Check; rate limiting is Firestore-backed
- **Languages**: user selects in the UI; language preference sent in chat context implicitly

### AI Post Writer

- **Route**: `PostEditor` → `generatePostContent` Cloud Function
- **Model**: `gemini-2.0-flash-lite`
- **Tones**: `formal`, `warm`, `brief`
- **Prompt limit**: 1000 chars
- **Auth**: must be admin or priest of the church
- **Rate limit**: 10 requests/min
- **Abuse controls**: requires Firebase App Check and active membership status
- AI output is converted from basic Markdown to HTML via `markdownToHtml()` in `PostEditor.tsx`, then inserted into TipTap

---

## 11. Push Notifications

### Web Push

1. `requestNotificationPermission(uid)` called after non-anonymous sign-in
2. Registers service worker at `/firebase-messaging-sw.js`
3. Gets FCM token using VAPID key (`VITE_FIREBASE_VAPID_KEY`)
4. Calls `addFcmToken(uid, token)` to store in `users/{uid}.fcmTokens` (capped at 10)
5. Background messages handled by `firebase-messaging-sw.js` via `onBackgroundMessage`
6. Notification click opens or focuses the app
7. Notification icon/badge fallbacks come from `public/kandilo-icon.svg` and `public/kandilo-badge.svg`

### Native Push (Capacitor)

1. Uses `@capacitor/push-notifications`
2. iOS `AppDelegate.swift` forwards APNs registration success/failure back to Capacitor per plugin requirements
3. Requests permission via Capacitor API
4. Android creates a default notification channel (`general`) before registration
5. Registers with APNs (iOS) or FCM (Android) directly
6. Token stored in same `fcmTokens` array

### Native Deep Links / URL Returns

1. The native shells now include `@capacitor/app` and listen for `appUrlOpen`
2. iOS registers the custom URL scheme `kandilo` in `Info.plist`
3. Android registers both `kandilo://` and `https://app.kandilo.org` intent filters in `AndroidManifest.xml`
4. `src/app/navigation.ts` normalizes custom-scheme and hosted app URLs into SPA pathname/search state
5. `GivingScreen.tsx`, `usePendingInvitation.ts`, and the authenticated app shell subscribe to these app URL events so native returns can resume the correct in-app state, including Stripe Connect onboarding returns into Management -> Receipts

### Server-side Sending

`notifyChurchMembers(churchId, title, body, data, targetRoles?)` helper:
1. Queries `churches/{id}/members` where `status == 'active'` (optionally filtered by `role in targetRoles`)
2. Fetches user docs in 500-document chunks
3. Sends FCM `sendEachForMulticast` in batches of 500
4. Prunes invalid/unregistered FCM tokens from `users/{uid}.fcmTokens`
5. Called by: `onEventCreated`, `onNewsletterPublished`, `sendPushNotification`

---

## 12. Email System (Resend)

All emails sent from `Kandilo <{subdomain}@kandilo.org>`:

| Email Type | From | Trigger | Template |
|------------|------|---------|----------|
| Invitation | `invite@kandilo.org` | `sendInvitation` callable | HTML with accept link `${APP_URL}/join/{invitationId}` |
| Newsletter | `bulletin@kandilo.org` | `onNewsletterPublished` trigger | Excerpt + `${APP_URL}` "Read in App" CTA |
| Donation confirmation | `giving@kandilo.org` | `onGivingCompleted` trigger | Non-tax payment confirmation: amount, purpose, completed donation date, with explicit copy that official tax receipts are sent separately |
| Tax receipt | `giving@kandilo.org` | `sendTaxReceipt`, `sendCorrectedTaxReceipt`, `sendAnnualTaxReceipt`, `sendCorrectedAnnualTaxReceipt`, `sendChurchAnnualTaxReceipts`, `sendChurchCorrectedAnnualTaxReceipts`, or configured `onGivingCompleted` auto-issue | Official U.S. charitable contribution acknowledgment with receipt number, organization details, donor legal name/address when present, amount, eligible amount, date/covered period, goods/services statement, and retained PDF attachment |

All user-generated strings in emails are escaped with `escapeHtml()` before insertion.
Newsletter and receipt recipients are derived from Firebase Auth primary email records, not from client-editable profile fields.

Newsletter batch sending: 50 emails per Resend API call (Resend batch limit).

---

## 13. Development Setup

### Prerequisites

- Node.js 22
- Java 21 for Android / Gradle builds
- Repo-pinned Firebase CLI from `devDependencies` (`npx --no-install firebase ...`)
- Firebase project access (`npx --no-install firebase login`)

### Environment Variables

Create `.env.local` at the repo root (never commit this):

```
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=kandilo-2f7a9.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=kandilo-2f7a9
VITE_FIREBASE_STORAGE_BUCKET=kandilo-2f7a9.firebasestorage.app
VITE_FIREBASE_MESSAGING_SENDER_ID=...
VITE_FIREBASE_APP_ID=...
VITE_FIREBASE_APP_CHECK_SITE_KEY=...
VITE_FIREBASE_VAPID_KEY=...
```

`GEMINI_API_KEY`, `RESEND_API_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` are Firebase secrets. For receipt-path Stripe/Resend secrets, prefer `npm run configure:receipt-secrets`; direct secret operations should use the repo-pinned CLI, for example `npx --no-install firebase functions:secrets:set`.

`APP_URL` must also be set for production so invitation emails, newsletter emails, and Stripe Checkout return URLs point at the correct hosted domain. The intended production value is `https://app.kandilo.org`.

### Common Commands

```bash
# Run frontend dev server
npm run dev

# Run frontend against local Firebase emulators for browser verification
npm run seed:receipt-emulator
npm run dev:emulators

# Build frontend for production
npm run build

# Fast web unit/Firebase-facing tests
npm run test:web

# Local Firestore/Storage rules emulator tests
npm run test:firebase

# Local Cloud Functions callable emulator tests
npm run test:functions

# Web typecheck + tests
npm run check:web

# Standard web QA before merge
npm run test:qa

# Full existing repo check, including functions typecheck
npm run check

# Production readiness and deploy checks expect Node 22, matching .nvmrc, CI, and deployed Cloud Functions.
nvm use 22

# Read-only live Firebase, Storage rules, and Hosting drift check after deploying the receipt release surface
npm run check:firebase-live

# The live drift check reports hosted .well-known native-link drift even if the deployed SPA asset references are stale.

# Read-only native HTTPS return-link status before final store identifiers are available
npm run configure:native-links -- --status

# Validate and write hosted Apple/Android app-link files once final store identifiers exist
npm run configure:native-links -- --apple-team-id TEAMID1234 --android-sha256 AA:BB:...:99

# Or derive Apple Team ID from Xcode and Android SHA-256 from release signing config
npm run configure:native-links -- --apple-from-xcode-project --android-from-release-keystore

# Or derive only Android SHA-256 from android/keystore.properties / KANDILO_UPLOAD_* release signing config
npm run configure:native-links -- --apple-team-id TEAMID1234 --android-from-release-keystore

# Print the exact live Stripe webhook endpoint setup plan, or guarded-create it from a private shell
npm run configure:stripe-webhook

# Project-confirmed Firebase Secret Manager setup for receipt-path production secrets
npm run configure:receipt-secrets

# Read-only Stripe account activation check after corporate/bank/tax details are submitted
STRIPE_SECRET_KEY=sk_live_... npm run check:stripe-account-live

# Read-only Resend sending-domain check after kandilo.org is configured in Resend
RESEND_API_KEY=re_... npm run check:resend-live

# Read-only Stripe Dashboard webhook endpoint check after live endpoint creation
STRIPE_SECRET_KEY=sk_live_... npm run check:stripe-webhook-live

# Read-only live donation webhook/giving/receipt smoke check after the first small live donation
npm run check:live-donation-smoke

# Strict live receipt email/PDF smoke check before announcing tax receipt availability
npm run check:live-donation-smoke -- --require-sent-receipt

# Read-only annual receipt smoke check before announcing year-end annual receipts
npm run check:live-annual-receipt-smoke

# Configure GitHub branch protection for main
GITHUB_TOKEN=... GITHUB_REPOSITORY=owner/repo npm run github:protect-main

# Build functions TypeScript
cd functions && npm run build

# Deploy everything
npx --no-install firebase deploy

# Deploy only functions
npx --no-install firebase deploy --only functions

# Deploy only hosting
npx --no-install firebase deploy --only hosting

# Deploy only Firestore rules
npx --no-install firebase deploy --only firestore:rules

# Grant super admin to a UID
node scripts/set-super-admin.mjs <uid> --confirm-project kandilo-2f7a9

# Grant priest receipt-manager access to a UID for a church
node scripts/make-priest.js <uid> <churchId> --confirm-project kandilo-2f7a9

# Bootstrap an initial priest account for a church
KANDILO_BOOTSTRAP_PASSWORD='...' node scripts/bootstrap-admin.js <email> <displayName> <churchId> --confirm-project kandilo-2f7a9

# Start local emulators
npx --no-install firebase emulators:start
```

### Native Builds

```bash
npm run cap:ios      # Build + sync + open Xcode
npm run cap:android  # Build + sync + open Android Studio
```

Native production posture in-repo:

- iOS deployment target: `17.0`
- Android min SDK: `34` (Android 14), target SDK: `35`
- iOS entitlements files are committed for APNs in both Debug and Release configurations
- iOS includes a committed app privacy manifest (`PrivacyInfo.xcprivacy`)
- iOS target resources now explicitly include `GoogleService-Info.plist`
- Android notification permission is declared in `AndroidManifest.xml`
- Android release signing can be supplied either via `android/keystore.properties` (gitignored) or `KANDILO_UPLOAD_*` environment variables; see `android/keystore.properties.example`
- Native deep-link plumbing is prewired for `kandilo://` and `https://app.kandilo.org`

---

## 14. Deployment

The authenticated web app is intended to deploy to Firebase Hosting at `https://app.kandilo.org`. Deployment remains manual through the Firebase CLI, but pull requests and pushes to `main` are validated by `.github/workflows/ci.yml`.

GitHub branch protection for `main` should require the CI status check named `Web, Firebase, and Functions`. That workflow runs the static Stripe/tax receipt production-readiness gate with `npm run check:stripe-production:ci`, then typecheck/unit, Firebase rules emulator, Cloud Functions emulator, web build, and Functions build gates. The static readiness gate does not require live Stripe/Firebase credentials or `.env.local`; the full `npm run check:stripe-production` and guarded deploy helper still run the stricter local production-env checks before live release. The repo includes `scripts/configure-github-branch-protection.mjs`, exposed as `npm run github:protect-main`, to configure this when run with a repository admin token.

All routes rewrite to `/index.html` for SPA navigation.

Static assets (JS, CSS, fonts) have 1-year immutable cache headers. The service worker has `no-cache` headers to force updates.

### Firebase MCP

Codex is configured to use the official Firebase MCP server through `firebase-tools@latest mcp`.

Current MCP context:

- Config location: `~/.codex/config.toml`
- MCP command: `npx -y firebase-tools@latest mcp --dir /Users/stefanradeta/Development/kandilo`
- Project directory: `/Users/stefanradeta/Development/kandilo`
- Active Firebase project: `kandilo-2f7a9`
- Authenticated account: `stefanr13@gmail.com`
- Verified tools: `firebase_get_environment`, `functions_list_functions`

Known MCP caveat: Firebase reports "Gemini in Firebase Terms of Service" as not accepted. This does not block normal Firebase CLI/MCP operations, but should be accepted in Firebase Console if Firebase's Gemini-assisted tooling is needed.

---

## 15. Known Gaps and Future Work

| Area | Gap | Notes |
|------|-----|-------|
| **Super admin stats pagination** | Capped at 200 churches | Needs cursor-based pagination + aggregation counters in triggers |
| **Facebook auth** | Not enabled in UI | Configure Firebase provider first if this becomes a requirement |
| **Post/church asset uploads** | Avatar upload is wired; post attachments and church logo/cover upload UI are not | Storage rules already cover post attachments, but private serving semantics should be designed before exposing parish files |
| **QR camera scanning** | Manual event check-in is implemented; QR code generation/camera scanning is not | Add only after deciding the QR identity/check-in model |
| **Stripe church accounts** | Backend-only per-church destination routing exists for configured Stripe connected accounts, Checkout supports U.S. dollar donations for U.S./unknown-country parishes and Canadian dollar donations for Canadian parishes, SuperAdmins can create U.S. or Canadian Accounts v2 recipient connected accounts with Express dashboard access from Mission Control or paste existing `acct_...` IDs with an explicit Accounts v2 recipient vs legacy v1 account API selection, SuperAdmin save verifies the stored account is routing-ready before enabling routing, Checkout re-checks v2 recipient readiness before creating the donation, and priests/treasurers can see redacted setup status and open Stripe-hosted onboarding only after that status confirms a configured account exists, without seeing the account ID | Other-jurisdiction connected account creation still happens in Stripe until Kandilo supports those jurisdiction-specific connected-account defaults |
| **Stripe live operations** | Account activation, corporate/bank/tax details, live keys, live webhook endpoint, live receipt email provider secret, deployed Firebase drift checks, the first small live donation smoke, and the first annual receipt smoke are operational setup items | `npm run check:stripe-production` verifies repo readiness, `npm run check:stripe-account-live` verifies coarse live Stripe account activation state once a live key exists without printing private account details, `npm run configure:stripe-webhook` prints the exact webhook setup plan and can guarded-create the endpoint from a private shell, `npm run configure:receipt-secrets` sets receipt-path Firebase secrets through a project-confirmed pinned CLI wrapper, `npm run check:resend-live` verifies the live Resend key can see exactly one verified `kandilo.org` sending domain without printing API key or DNS/domain record details, `npm run check:stripe-webhook-live` verifies the live Stripe Dashboard webhook endpoint, Mission Control shows redacted Stripe account activation, redacted live Stripe webhook endpoint readiness, and Resend sending-domain readiness from live secrets, `npm run check:firebase-live` verifies local `dist` freshness, active deployed Functions, exact deployed Function secret bindings, absence of unexpected remote-only Stripe/payment/checkout/giving/receipt Functions, Firestore indexes, Firestore receipt/privacy rules, Storage rules, hosted portal security headers, hosted universal/app-link files, and hosted portal build freshness after deploy, `npm run check:live-donation-smoke` verifies the first live donation reached webhook/giving/receipt-ready state with privacy-safe church-facing giving mirror evidence and no raw Stripe payment identifier or checkout URL alias fields, plus matching stored assigned receipt identity/amount/currency evidence and portal-visible receipt number matching the donor-only receipt number when the receipt is issued, without printing private identifiers, `npm run check:live-donation-smoke -- --require-sent-receipt` gates public tax-receipt availability on an actual official receipt email plus fresh stored receipt issue/email timestamps, fresh giving mirror timestamp, fresh retained PDF status/timestamp, retained PDF object exists in Firebase Storage with matching byte length/hash metadata, and backend-only email-sent audit evidence, and `npm run check:live-annual-receipt-smoke` gates year-end annual receipt availability on a non-anonymous annual receipt covering at least two donations with fresh email/PDF/audit evidence, exact covered-giving IDs, itemized contribution-line detail matching annual receipt totals, a matching staff-safe annual summary mirror with no private full-receipt fields, and retained PDF Storage integrity without printing private identifiers; Stripe Dashboard, Resend, Firebase Secret Manager, and the final live smoke donations still need manual production setup |
| **Canada/CRA receipts** | CRA-specific field capture, backend-only PDF copy retention, future PDF/email rendering, and Canada/CRA-specific unavailable copy in donor/church receipt portals are scaffolded, but issuance is still fail-closed | Read-only/non-editable encrypted PDF generation, electronic signature material handling under authorized parish control, protected records, retained printable copies, and final legal review are still required before Canadian official donation receipts can be enabled |
| **Scheduled year-end issuance** | Priest-triggered church/year annual U.S. batches are implemented; default-off annual receipt preparation now paginates active parishes and creates closed-year annual records for opted-in U.S. parishes, with annual auto-email as a separate default-off setting | The scheduler emails only safe prepared annual receipts when annual auto-email is explicitly enabled, skips partial-refund, mixed- or missing-currency, and duplicate-claim donor-years so donors or priest/treasurer reviewed flows handle them, and logs if the active parish scan reaches its explicit cap |
| **Finance roles** | Dedicated treasurer access exists for receipt sending, corrected single-donation and annual partial-refund receipts, bulk corrected annual batches, scheduled year-end preparation, and SuperAdmin-only redacted audit visibility | Future work: broaden finance operations only after live receipt smoke testing and parish feedback identify the next workflow |
| **CI/CD** | No automated deployment pipeline | CI validation and branch-protection automation exist for pull requests/main; production deploys remain manual via Firebase CLI |
| **Native OAuth / app-link identity** | Native Google sign-in is intentionally disabled | Requires Firebase/Auth/Google console OAuth redirect setup and final app-link verification before enabling |
| **Universal/App Links verification** | Android `assetlinks.json` and Apple `apple-app-site-association` are not yet published with the final signing/team identifiers | Repo-side listeners, entitlements, and the guarded `configure:native-links` helper are ready, but final identifier collection and verification are still operational |
| **Store metadata operations** | Privacy policy/support pages are committed, but App Store Connect / Play Console entries are manual | Final store listings, screenshots, privacy labels, verified domains, and signing remain operational steps |

---

## 16. Service Worker Notes

`public/firebase-messaging-sw.js` handles background FCM messages. It uses the Firebase **compat** SDK (not the modular SDK) because service workers do not support ES modules with `importScripts`. The version must be kept in sync with the main app's Firebase SDK version (currently `12.13.0`).

The service worker imports a generated, gitignored `public/firebase-messaging-sw-config.js` file. `npm run dev`, `npm run dev:emulators`, `npm run dev:lan`, and `npm run build` generate this file from `VITE_FIREBASE_*` env vars via `scripts/write-firebase-messaging-sw-config.mjs`. Do not hardcode Firebase web API keys in the committed service worker; GitHub secret scanning flags Google API key patterns even when they are browser-public Firebase identifiers.

The service worker is registered by `src/lib/notifications.ts` with `navigator.serviceWorker.register('/firebase-messaging-sw.js')`.

The service worker now uses committed SVG fallbacks for notification `icon` and `badge`, so production web push does not depend on missing runtime assets.

The backend notification helper prunes invalid or unregistered FCM tokens from user profiles after send failures to reduce repeated multicast errors over time.

---

## 17. Brand and Design Tokens

| Token | Value | Usage |
|-------|-------|-------|
| Primary (Maroon) | `#800000` | Primary buttons, active states, brand accent |
| Gold | `#937022` | Secondary accent, subtitles, category labels |
| Background | `#F9F9F9` | Main content background |
| Dark | `#111827` (gray-900) | Secondary buttons, text |
| Font | System + Tailwind default sans | No custom font loaded |
| Border radius | Aggressively rounded: `rounded-2xl`, `rounded-3xl`, `rounded-[32px]`, `rounded-[40px]` | Component-dependent |

---

*Last updated after: Tax receipt foundation, donor/priest receipt portals, donor receipt-profile readiness prompts, SuperAdmin receipt eligibility attestation, Stripe production preflight, live Stripe webhook endpoint verification, redacted Stripe account activation readiness, live Firebase deployment drift check, local receipt emulator seeding, church-facing donor email minimization, webhook smoke-test readiness gating, donor/church single and annual receipt visibility, itemized annual receipt PDFs, partial-refund corrected single/annual receipts, and Firebase region clarification — May 2026*
