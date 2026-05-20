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
| **Firebase Storage** | Church logos, cover images, user avatars, post attachments |
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
| `stripe` | 22.x | Payment intents for donations |
| `resend` | 4.x | Transactional email (invitations, newsletters, donation receipts) |

### Firebase Project

- **Project ID**: `kandilo-2f7a9`
- **Default database**: `(default)` in `us-central1`
- **Primary app host**: `app.kandilo.org` (legacy fallback hosts still accepted in native URL parsing: `kandilo.app`, `kandilo-2f7a9.firebaseapp.com`)
- **Functions region**: default (us-central1 unless overridden)

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
│   │       ├── MissionControlAnalyticsTab.tsx # Analytics tab content
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
│   ├── set-super-admin.mjs          # CLI: grant superAdmin claim to a UID
│   ├── make-priest.js               # CLI: assign priest role in a church
│   ├── bootstrap-admin.js           # CLI: bootstrap initial admin
│   ├── seed-church-profiles.mjs     # CLI: seed Firestore with sample church data
│   ├── seed-saints.ts               # CLI: seed saints/{date} collection (full detail) from JSON
│   ├── migrate-saints-index.ts      # CLI: seed saints_index/{date} collection (names only) from JSON
│   ├── configure-github-branch-protection.mjs # CLI: require the CI job on main branch protection
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

- `superAdmin: true` — set via the `promoteSuperAdmin` Cloud Function or `scripts/set-super-admin.mjs`
- Claims are JWT-embedded; token refresh required after claim change (user must sign out and back in, or call `getIdToken(true)`)
- The `useAuth` hook reads claims via `getIdTokenResult(false)` on auth state change and exposes `isSuperAdmin` to the app
- `refreshSuperAdminClaim()` forces a token refresh (`getIdTokenResult(true)`) — used from Mission Control after promoting a user

### User Profile Sync

Profiles are protected by two layers:

1. `bootstrapUserProfileOnCreate` is a backend Firebase Auth `onCreate` trigger that creates a default `users/{uid}` document for every new Auth user.
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
| `fcmTokens` | string[] | Up to 10 FCM push tokens (newest kept, oldest pruned) |
| `createdAt` | Timestamp | Account creation time |

**Subcollection**: `users/{uid}/churchMemberships/{churchId}` — denormalized mirror of the user's church membership for fast loading without cross-collection joins.

| Field | Type | Description |
|-------|------|-------------|
| `churchId` | string | |
| `churchName` | string | Denormalized from church doc |
| `imageURL` | string | Church thumbnail |
| `location` | string | `"City, State"` string |
| `role` | `'priest' \| 'admin' \| 'member'` | |
| `status` | `'active' \| 'pending' \| 'suspended'` | |
| `joinedAt` | Timestamp | |

### `churches/{churchId}`

The document ID is a URL-safe slug generated from `name + city` (e.g. `st-nicholas-new-york`). Created only by super admin via `createChurch` function.

Key fields: `name`, `denomination`, `jurisdiction`, `diocese`, `foundedYear`, `about`, `languages[]`, `address`, `city`, `state`, `country`, `postalCode`, `latitude`, `longitude`, `timezone`, `phone`, `contactEmail`, `website`, `imageURL`, `coverImageURL`, `clergy[]`, `serviceSchedule[]`, `socialMedia{}`, `isActive`, `isVerified`, `createdAt`, `createdBy`.

**Subcollection**: `churches/{churchId}/members/{uid}` — the authoritative source of membership. Used by Firestore rules for all authorization checks.

| Field | Type | Description |
|-------|------|-------------|
| `userId` | string | Mirrors doc ID |
| `churchId` | string | Mirrors parent |
| `role` | `'priest' \| 'admin' \| 'member'` | **Authorization-critical** |
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
| `role` | `'member' \| 'admin'` | Role to grant on acceptance |
| `status` | `'pending' \| 'accepted' \| 'expired' \| 'cancelled'` | |
| `expiresAt` | Timestamp | 14 days from creation |
| `createdAt`, `acceptedAt` | Timestamp | |

### `notifications/{notificationId}`

Write-only by Cloud Functions (client `allow write: if false`).

Fields: `churchId`, `title`, `body`, `type` (`'event' \| 'newsletter' \| 'manual'`), `targetRoles[]`, `sentAt`, `sentBy`, `sentByName`, `deliveryStats{}`.

### `giving/{givingId}`

Write-only by Cloud Functions. Client creation, update, and delete all blocked.

Fields: `churchId`, `userId`, `amount` (in dollars, not cents), `currency`, `purpose`, `anonymous`, `recurring`, `status` (`'pending' \| 'completed' \| 'failed'`), `stripeCheckoutSessionId`, `stripePaymentIntentId`, `completedAt`, `receiptEmailSentAt`, `failureReason`, `createdAt`.

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
3. Make sure your Firebase CLI session is valid (`npx firebase-tools@latest login`) before running — the scripts use the stored OAuth token.
4. Update Firestore security rules if the collection was not already covered by a public-read rule.

---

## 6. Cloud Functions Reference

Functions deploy from `functions/src/index.ts`, but that file is now only an export barrel. Business logic is split by domain in `functions/src/modules/*`, and shared security/client helpers live in `functions/src/shared/*`. Deploy with `firebase deploy --only functions`.

### Callable Functions (invoked via `httpsCallable` from the frontend)

| Function | Auth Required | Role Required | Rate Limit | Description |
|----------|--------------|---------------|------------|-------------|
| `acceptInvitation` | Yes (verified, non-anonymous email account) | None | None | Accepts a pending invitation; atomically creates member + churchMembership docs |
| `sendInvitation` | Yes | Active Admin or Priest of church | 10/min | Creates invitation doc + sends email via Resend; only priests may invite another admin |
| `createStripeCheckoutSession` | Yes | Active member of church | 10/min | Creates hosted Stripe Checkout session + pending `giving` doc; returns `checkoutUrl` |
| `sendPushNotification` | Yes | Active Admin or Priest of church | 5/min | Sends FCM multicast to church members filtered by validated `targetRoles` |
| `getSuperAdminStats` | Yes | `superAdmin` claim | None | Returns per-church stats for Mission Control (capped at 200 churches) |
| `createChurch` | Yes | `superAdmin` claim | None | Creates new church with slug ID |
| `setChurchActiveState` | Yes | `superAdmin` claim | None | Toggles `isActive` |
| `updateChurchAsSuperAdmin` | Yes | `superAdmin` claim | None | Updates church fields via explicit allowlist |
| `promoteSuperAdmin` | Yes | `superAdmin` claim | None | Sets `superAdmin: true` custom claim on target UID |
| `faithAiChat` | Yes (verified, non-anonymous + App Check) | Any signed-in user | 20/min | Gemini 2.0 Flash Lite Orthodox spiritual chat |
| `generatePostContent` | Yes (App Check) | Active Admin or Priest of church | 10/min | Gemini 2.0 Flash Lite post content generation |

### HTTP Function

| Function | Method | Auth | Description |
|----------|--------|------|-------------|
| `stripeWebhook` | POST only | Stripe signature header | Handles Checkout completion / failure events; updates `giving` doc status |

### Background Triggers

| Function | Trigger | Description |
|----------|---------|-------------|
| `onEventCreated` | Firestore `onDocumentCreated('events/{eventId}')` | Sends FCM to all church members; writes notification doc |
| `onNewsletterPublished` | Firestore `onDocumentUpdated('newsletters/{newsletterId}')` | On status change to `published`: sends FCM + batch email to all members |
| `onGivingCompleted` | Firestore `onDocumentUpdated('giving/{givingId}')` | Sends donation receipt email exactly once when status transitions to `completed` |
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
| `GEMINI_API_KEY` | `faithAiChat`, `generatePostContent` |
| `RESEND_API_KEY` | `sendInvitation`, `onNewsletterPublished`, `onGivingCompleted` |
| `STRIPE_SECRET_KEY` | `createStripeCheckoutSession`, `stripeWebhook` |
| `STRIPE_WEBHOOK_SECRET` | `stripeWebhook` |

Set with: `firebase functions:secrets:set SECRET_NAME`

---

## 7. Security Architecture

### Firestore Rules Summary

Rules are in `firestore.rules`. Key helper functions:

- `isSignedIn()` — any Firebase Auth user including anonymous
- `isOwner(userId)` — `request.auth.uid == userId`
- `isSuperAdmin()` — `request.auth.token.superAdmin == true` (JWT claim, zero reads)
- `getMembership(churchId)` — reads `churches/{id}/members/{uid}`
- `isMember(churchId)` — active member via `getMembership`
- `isAdmin(churchId)` — active + role is `admin` or `priest`
- `isPriest(churchId)` — active + role is `priest`
- `priestMayEditChurchMetadata()` — limits priest client edits to non-governance church profile fields

**Authorization matrix** (key rules):

| Resource | Create | Read | Update | Delete |
|----------|--------|------|--------|--------|
| `users/{uid}` | Owner | Owner or SuperAdmin | Owner (profile, directory, language, avatar, FCM token allowlist) | Never |
| `users/{uid}/churchMemberships/{cid}` | Never (functions only) | Owner or SuperAdmin | Priest role/status; Admin status only | Owner |
| `churches/{cid}` | SuperAdmin | Signed-in + isActive (or SuperAdmin) | SuperAdmin or Priest (metadata allowlist only; governance fields locked to super admin) | Never |
| `churches/{cid}/members/{uid}` | Never (functions only) | Member or SuperAdmin | Priest role/status/profile allowlist; Admin status only; Owner profile allowlist | Admin or Owner |
| `churches/{cid}/posts/{pid}` | Admin/Priest (churchId+authorId match) | Admin/Priest always; Member only if published | Admin/Priest (immutable: churchId, authorId) | Admin/Priest |
| `events/{eid}` | Admin of church | Member or SuperAdmin | Admin (churchId immutable) | Admin |
| `newsletters/{nid}` | Admin | Member or SuperAdmin | Admin (churchId immutable) | Priest only |
| `invitations/{iid}` | Never (functions only) | SuperAdmin, invitee (verified email), or Admin | Never (functions only) | Never |
| `notifications/{nid}` | Never (functions only) | Member or SuperAdmin | Never | Never |
| `giving/{gid}` | Never (functions only) | Owner or Priest or SuperAdmin | Never | Never |
| `eventCheckIns/{id}` | Admin; event/member/shape validated | Admin, owner, or SuperAdmin | Never | Admin |
| `platformAuditLog/{lid}` | Never (functions only) | SuperAdmin | Never | Never |

### Storage Rules Summary

Rules are in `storage.rules`.

| Path | Read | Write |
|------|------|-------|
| `churches/{churchId}/{fileName}` (single segment) | Signed-in | Never (functions only) |
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
| `createStripeCheckoutSession` | 10 req/min |
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
- **Management desktop**: Priest/admin tools use an additional management rail (`ManagementSidebar`) that is compact on smaller desktop widths and expands with labels at wide desktop breakpoints; tables and operational cards are protected against horizontal overflow.
- **Full-screen screens**: `calendar`, `profile`, and `superadmin` suppress the chrome (header + nav).

### Church State

- `useChurches(uid)` subscribes to `users/{uid}/churchMemberships` in real time
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
| `ManagementView.tsx` | Thin feature entry for the admin/priest control panel |
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

1. `GivingScreen.tsx` collects amount, purpose, and anonymity preference
2. Frontend calls `createStripeCheckoutSession({ churchId, amountCents, purpose, anonymous })`
3. Function verifies the caller is an active member of the church, creates a Stripe Checkout Session, and writes a pending `giving` document
4. Frontend opens the returned `checkoutUrl`; native apps use Capacitor Browser instead of replacing the in-app WebView
5. Stripe sends `checkout.session.completed` or failure/expiry webhooks to `stripeWebhook`
6. The webhook updates the `giving` document status
7. `onGivingCompleted` sends a receipt email when the status transitions to `completed`

The frontend stores pending donation context in `localStorage` before redirect so the app can restore the intended amount/purpose after success or cancellation.

### Constraints

- Minimum donation: $0.50 (50 cents, Stripe minimum)
- Maximum per transaction: $10,000 (1,000,000 cents)
- Currency: `usd` only (allowlist enforced in function)
- The church's Stripe account management is not yet implemented
- Hosted checkout return URLs are derived from `APP_URL` (fallback: `https://app.kandilo.org`)

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
5. `GivingScreen.tsx` and `usePendingInvitation.ts` subscribe to these app URL events so native returns can resume the correct in-app state

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
| Donation receipt | `giving@kandilo.org` | `onGivingCompleted` trigger | Itemized table: amount, purpose, date |

All user-generated strings in emails are escaped with `escapeHtml()` before insertion.
Newsletter and receipt recipients are derived from Firebase Auth primary email records, not from client-editable profile fields.

Newsletter batch sending: 50 emails per Resend API call (Resend batch limit).

---

## 13. Development Setup

### Prerequisites

- Node.js 22
- Java 21 for Android / Gradle builds
- Firebase CLI (`npm install -g firebase-tools`)
- Firebase project access (`firebase login`)

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

`GEMINI_API_KEY`, `RESEND_API_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` are Firebase secrets — set via `firebase functions:secrets:set`.

`APP_URL` must also be set for production so invitation emails, newsletter emails, and Stripe Checkout return URLs point at the correct hosted domain. The intended production value is `https://app.kandilo.org`.

### Common Commands

```bash
# Run frontend dev server
npm run dev

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

# Configure GitHub branch protection for main
GITHUB_TOKEN=... GITHUB_REPOSITORY=owner/repo npm run github:protect-main

# Build functions TypeScript
cd functions && npm run build

# Deploy everything
firebase deploy

# Deploy only functions
firebase deploy --only functions

# Deploy only hosting
firebase deploy --only hosting

# Deploy only Firestore rules
firebase deploy --only firestore:rules

# Grant super admin to a UID
node scripts/set-super-admin.mjs <uid>

# Start local emulators
firebase emulators:start
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

GitHub branch protection for `main` should require the CI status check named `Web, Firebase, and Functions`. The repo includes `scripts/configure-github-branch-protection.mjs`, exposed as `npm run github:protect-main`, to configure this when run with a repository admin token.

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
| **Stripe church accounts** | No mechanism for parishes to connect their own Stripe account | All donations would go to a platform account; per-church routing not built |
| **CI/CD** | No automated deployment pipeline | CI validation and branch-protection automation exist for pull requests/main; production deploys remain manual via Firebase CLI |
| **Native OAuth / app-link identity** | Native Google sign-in is intentionally disabled | Requires Firebase/Auth/Google console OAuth redirect setup and final app-link verification before enabling |
| **Universal/App Links verification** | Android `assetlinks.json` and Apple `apple-app-site-association` are not yet published with the final signing/team identifiers | Repo-side listeners and entitlements are ready, but final verification is still operational |
| **Store metadata operations** | Privacy policy/support pages are committed, but App Store Connect / Play Console entries are manual | Final store listings, screenshots, privacy labels, verified domains, and signing remain operational steps |

---

## 16. Service Worker Notes

`public/firebase-messaging-sw.js` handles background FCM messages. It uses the Firebase **compat** SDK (not the modular SDK) because service workers do not support ES modules with `importScripts`. The version must be kept in sync with the main app's Firebase SDK version (currently `12.11.0`).

The service worker imports a generated, gitignored `public/firebase-messaging-sw-config.js` file. `npm run dev`, `npm run dev:lan`, and `npm run build` generate this file from `VITE_FIREBASE_*` env vars via `scripts/write-firebase-messaging-sw-config.mjs`. Do not hardcode Firebase web API keys in the committed service worker; GitHub secret scanning flags Google API key patterns even when they are browser-public Firebase identifiers.

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

*Last updated after: Firebase MCP connection note and iOS layout shell hardening — May 2026*
