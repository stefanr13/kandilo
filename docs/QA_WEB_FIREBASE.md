# Kandilo Web + Firebase QA Standard

This document defines the reusable QA baseline for Kandilo web frontend and Firebase-facing code. It intentionally avoids production Firebase services, real secrets, and flaky data-dependent tests.

## Scope

Covered:

- React/Vite/TypeScript web frontend.
- Frontend Firebase SDK integration points.
- Cloud Function callable wrappers used by the web app.
- Firestore document mappers, serialization helpers, and client-side validation.
- Auth, routing, invitation, giving, church membership, and management permission decisions that can be tested without live services.
- Local Firebase emulator security-rule tests for Firestore and Storage.
- Local Cloud Functions emulator callable tests with Auth and Firestore emulators.

Not covered in this baseline:

- Native iOS/Android shell behavior.
- Production Firebase data.
- Stripe, Resend, FCM, Gemini, or App Check network calls.

## Test Layers

### Fast Unit Tests

Command:

```bash
npm run test:web
```

Protects:

- Pure navigation helpers such as checkout return routing, invite paths, and deep-link host validation.
- Role and management permission helpers for priest/admin/member behavior.
- Firestore mapper behavior for events, members, posts, newsletters, profiles, and check-ins.
- Giving checkout URL validation.
- Typed Cloud Function wrapper behavior with Firebase SDK mocks.

Rules:

- Keep these tests deterministic and fast.
- Prefer focused assertions over broad snapshots.
- Mock Firebase SDK modules when importing code that otherwise initializes Firebase clients.
- Do not read `.env.local`.
- Do not call production Firebase, Stripe, Resend, FCM, or Gemini.

### Web Typecheck

Command:

```bash
npm run typecheck
```

Protects:

- React/TypeScript contracts.
- Frontend Firebase wrapper types.
- Route/screen prop wiring.
- Mapper and helper signatures used by tests and UI.

### Web Build

Command:

```bash
npm run build
```

Protects:

- Vite production bundling.
- Lazy-loaded screen imports.
- Tailwind/Vite integration.
- Browser-targeted module compatibility.

### Combined Web QA

Command:

```bash
npm run test:qa
```

Runs:

- `npm run typecheck`
- `npm run test:web`
- `npm run test:firebase`
- `npm run test:functions`
- `npm run build`

Use this before merging web or Firebase-facing frontend changes.

### Firebase Emulator Rules Tests

Command:

```bash
npm run test:firebase
```

Runs Firebase Emulator Suite through the pinned local `firebase-tools` binary:

```bash
firebase emulators:exec --only firestore,storage "vitest run --config vitest.firebase.config.ts"
```

Protects:

- Firestore rule gates for verified non-anonymous users.
- Church member, admin, priest, and super-admin authorization assumptions.
- Membership fan-out role/status updates.
- Invitation and giving read/write boundaries.
- Event, newsletter, and post authoring permissions.
- Storage avatar and post attachment read/write rules.

Rules:

- Tests seed local emulator data with `withSecurityRulesDisabled`.
- Tests run against project id `kandilo-2f7a9` only inside the emulator so Storage rules and Firestore rules share the same local project namespace.
- No production services, secrets, or `.env.local` values are used.
- Keep tests under `tests/firebase/**/*.test.ts`.
- Do not include emulator tests in plain `npm test`; they require running local emulators and are intentionally invoked via `npm run test:firebase` or `npm run test:qa`.

Configured local ports:

- Firestore: `8088`
- Functions: `5008`
- Storage: `9198`
- Auth: `9098`
- Emulator UI: `4008`

### Functions Emulator Tests

Command:

```bash
npm run test:functions
```

Runs:

```bash
npm --prefix functions run build
KANDILO_FUNCTIONS_TEST_MODE=true STRIPE_WEBHOOK_SECRET=whsec_kandilo_emulator_test APP_URL=http://localhost:3000 firebase emulators:exec --only auth,firestore,functions "vitest run --config vitest.functions.config.ts"
```

Protects:

- Real callable endpoint wiring through the Functions emulator.
- Auth-dependent callable behavior against the Auth emulator.
- Admin SDK Firestore reads/writes against the Firestore emulator.
- Invitation acceptance fan-out writes.
- Invitation send permissions for admin versus priest.
- Giving checkout creation and membership enforcement.
- Super-admin church/user management callables and aggregate stats.
- Stripe Checkout webhook completion and validation behavior.
- Manual notification callable writes and event/newsletter Firestore trigger fan-out behavior.

Rules:

- Tests live under `tests/functions/**/*.test.ts`.
- External providers are mocked only when both `FUNCTIONS_EMULATOR=true` and `KANDILO_FUNCTIONS_TEST_MODE=true`.
- App Check enforcement remains enabled outside Functions emulator test mode.
- FCM fan-out is replaced by emulator-only Firestore records in `functionTestPushNotifications`.
- Do not use real Stripe, Resend, Gemini, FCM, production Firebase data, or `.env.local`.
- Add or update Functions emulator tests when Cloud Functions business rules or callable contracts change.

### Existing Full Check

Command:

```bash
npm run check
```

Runs the existing repository check path:

- Frontend typecheck.
- Functions TypeScript lint/typecheck through `npm --prefix functions run lint`.
- Frontend tests.

Use this before changes that touch Cloud Functions, Firestore rules, Storage rules, or shared Firebase contracts.

## Local Change Checklist

Run before handing off a normal web/frontend change:

```bash
npm run typecheck
npm run test:web
```

Run before handing off a Firebase-facing web change:

```bash
npm run test:qa
```

Run before handing off Firestore or Storage rules changes:

```bash
npm run test:firebase
```

Run before handing off Cloud Functions callable changes:

```bash
npm run test:functions
```

Run before deployment or when Cloud Functions/rules changed:

```bash
npm run check
npm run test:firebase
npm run test:functions
npm run build
npm --prefix functions run build
```

## Current Coverage Map

High-value regression areas currently covered by automated tests:

- Auth/navigation state decisions through initial screen and checkout return helpers.
- Invitation route parsing for `/join/{invitationId}`.
- Native/custom-scheme and hosted web deep-link allowlisting.
- Giving checkout URL validation for Stripe Checkout.
- Priest/admin/member management permission decisions.
- Church summary mapping and compact church conversion.
- Management counters and member filtering.
- Mission Control church form mapping.
- Firestore mappers for events, members, newsletters, posts, profiles, and check-in ids.
- Firestore rules for user profiles, memberships, invitations, giving, events, newsletters, and posts.
- Storage rules for user avatars and post attachments.
- Functions emulator behavior for `acceptInvitation`, `sendInvitation`, `createStripeCheckoutSession`, Mission Control super-admin callables, `stripeWebhook`, `sendPushNotification`, event triggers, newsletter triggers, and giving receipt triggers.
- Cloud Function callable wrapper App Check replay-protection options.
- Post translation preview ordering.

## Firebase Emulator Position

This repo now defines a standardized Firestore and Storage emulator rules suite. Keep it focused on server-enforced access control and data-shape regressions.

Extend emulator tests when changing:

- `firestore.rules`
- `storage.rules`
- frontend Firebase writes that must satisfy rules
- Cloud Functions that write documents read by frontend clients

Do not expand emulator testing casually into broad end-to-end workflows. Add heavier tests only when the work justifies the operational cost, for example:

- Auth emulator flows for sign-in/provider-specific behavior.
- Storage upload behavior that depends on real SDK metadata semantics.

## CI Gate

GitHub Actions workflow:

```text
.github/workflows/ci.yml
```

Runs on pull requests and pushes to `main`:

- Node 22.
- Java 21 for Firebase emulators.
- `npm ci`.
- `npm --prefix functions ci`.
- `npm run check`.
- `npm run test:firebase`.
- `npm run test:functions`.
- `npm run build`.
- `npm --prefix functions run build`.

The workflow uses read-only repository permissions and cancels older runs for the same branch/ref.

Branch protection should require the CI job status check named:

```text
Web, Firebase, and Functions
```

Repo-side automation is available:

```bash
GITHUB_TOKEN=... GITHUB_REPOSITORY=owner/repo npm run github:protect-main
```

The script configures `main` with strict required status checks, one pull request approval, stale-review dismissal, admin enforcement, linear history, conversation resolution, and disabled force pushes/deletions. It requires a GitHub token with repository administration permission and is not run by CI.

## Guidance For Future Codex Threads

Before changing code:

- Read this document.
- Read `package.json` scripts and the relevant existing tests.
- Identify whether the change is pure frontend, Firebase-facing frontend, Cloud Functions, rules, or native.
- Prefer extending existing pure tests before adding heavier test layers.

When adding tests:

- Keep tests stable without production credentials.
- Mock Firebase SDKs and `src/lib/firebase/*` modules where practical.
- Export small pure helpers only when it improves testability without changing app behavior.
- Avoid snapshot-heavy tests.
- Avoid tests that depend on wall-clock time unless a fixed clock is injected.
- Keep role and security assumptions aligned with `firestore.rules`, `storage.rules`, and Cloud Functions validation.

Before finishing:

- Run the commands listed for the changed area.
- Record exact commands and pass/fail results in the handoff.
- State any unverified areas clearly.
