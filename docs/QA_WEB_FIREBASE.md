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

- Pure navigation helpers such as checkout return routing, session-bound Stripe Connect receipt-manager return routing, invite paths, and deep-link host validation.
- Role and management permission helpers for priest/treasurer/admin/member behavior.
- Firestore mapper behavior for events, members, posts, newsletters, profiles, and check-ins.
- Giving checkout URL validation.
- Tax receipt issuance/resend permission, redacted audit events, send-failure persistence, refund/review UI states, and Firestore read boundaries.
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

### Local Browser Verification Against Emulators

Use this when checking Firebase-backed screens such as Giving receipts,
Management receipts, invitations, or profile receipt fields without touching
production Firebase data.

Terminal 1:

```bash
npm --prefix functions run build
KANDILO_FUNCTIONS_TEST_MODE=true STRIPE_SECRET_KEY=sk_test_kandilo_emulator STRIPE_WEBHOOK_SECRET=whsec_kandilo_emulator_test RESEND_API_KEY=re_kandilo_emulator_test GEMINI_API_KEY=gemini_emulator_test APP_URL=http://localhost:3000 npx --no-install firebase emulators:start --only auth,firestore,functions,storage
```

Terminal 2:

```bash
npm run seed:receipt-emulator
npm run dev:emulators
```

The dummy backend keys are local emulator sentinels only. They keep callable
initialization deterministic without requiring local access to live Secret
Manager versions while tests still block real provider delivery paths.

`npm run dev:emulators` sets `VITE_USE_FIREBASE_EMULATORS=true`, which connects
browser Auth, Firestore, Functions, and Storage SDKs to the local ports from
`firebase.json` and skips App Check initialization. Do not set
`VITE_USE_FIREBASE_EMULATORS=true` in `.env.local` for a production build;
`npm run check:stripe-production` fails if that value is enabled there.

`npm run seed:receipt-emulator` is local-only. It refuses non-local Auth or
Firestore emulator hosts, clears those local emulators, then creates:

- `treasurer@example.com` / `Password123!` with treasurer access to the
  Management receipts queue.
- `member@example.com` / `Password123!` with donor receipt profile details,
  recent giving, donor-owned anonymous/unclassified giving rows, a donor-only
  single receipt, a public annual receipt summary, and an anonymous annual summary mirror that remains donor-only.
- `Holy Trinity Orthodox Church`, a Canadian parish with Canada/CRA staging
  fields saved while receipt issuing remains disabled, plus a CAD completed
  donation and closed-year annual donor row that should show Canada/CRA-specific
  unavailable receipt copy.

Use the treasurer account to verify the church portal is send-focused and shows
protected donor email labels instead of raw donor email addresses, and that the
anonymous/unclassified donor-owned rows are excluded from the receipt queue.
Switch the same account to Holy Trinity Orthodox Church to verify Canadian/CRA
receipts show the unavailable compliance state rather than generic setup copy.
Use the donor account to verify anonymous/unclassified rows remain visible in
Giving and that the Canadian donation plus annual row show the same Canada/CRA
unavailable state without production data. While switched to Holy Trinity,
confirm St. Nicholas single and annual receipt rows remain visible and still
use St. Nicholas receipt readiness instead of being relabeled by the active
Canadian parish state.
When switching between the donor and treasurer emulator users, confirm current
user membership fanout listener permission-denied errors are handled without
stale receipt-manager roles or uncaught browser console errors.

Use this before merging web or Firebase-facing frontend changes.

### Firebase Emulator Rules Tests

Command:

```bash
npm run test:firebase
```

Runs Firebase Emulator Suite through the pinned local `firebase-tools` binary:

```bash
npx --no-install firebase emulators:exec --only firestore,storage "vitest run --config vitest.firebase.config.ts"
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
KANDILO_FUNCTIONS_TEST_MODE=true STRIPE_SECRET_KEY=sk_test_kandilo_emulator STRIPE_WEBHOOK_SECRET=whsec_kandilo_emulator_test RESEND_API_KEY=re_kandilo_emulator_test GEMINI_API_KEY=gemini_emulator_test APP_URL=http://localhost:3000 npx --no-install firebase emulators:exec --only auth,firestore,functions,storage "vitest run --config vitest.functions.config.ts"
```

Protects:

- Real callable endpoint wiring through the Functions emulator.
- Auth-dependent callable behavior against the Auth emulator.
- Retained tax receipt PDF paths against the Storage emulator, never production Storage.
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

- Auth/navigation state decisions through initial screen, checkout return helpers, and Stripe Connect receipt-manager returns.
- Invitation route parsing for `/join/{invitationId}`.
- Native/custom-scheme and hosted web deep-link allowlisting.
- Giving checkout URL validation for Stripe Checkout.
- Priest/treasurer/admin/member management permission decisions.
- Church summary mapping and compact church conversion.
- Management counters and member filtering.
- Mission Control church form mapping, including backend-only Stripe Connect account routing settings, saved-field preflights for U.S. or Canadian Stripe Accounts v2 recipient account creation, the explicit Canada/CRA receipt enablement blocker while staging fields remain saveable with receipts disabled, SuperAdmin U.S. receipt eligibility attestation, and shared U.S. receipt readiness rules used by donor/church receipt UI gating.
- Firestore mappers for events, members, newsletters, posts, profiles, private donor tax receipt profile fields and donor receipt-profile readiness helpers, giving, tax receipts, tax receipt summaries, and check-in ids.
- Firestore rules for user profiles, memberships, invitations, giving, events, newsletters, and posts.
- Storage rules for user avatars and post attachments.
- Functions emulator behavior for `acceptInvitation`, `sendInvitation`, `createStripeCheckoutSession` including the card-only donation Checkout contract, backend-only per-church Stripe Connect destination routing with SuperAdmin connected-account readiness validation before enabling routing, SuperAdmin U.S. or Canadian Accounts v2 recipient connected-account creation with country-derived defaults and routing disabled until onboarding, redacted connected-account setup status for receipt managers, redacted Stripe-hosted onboarding links for configured connected accounts before or after routing is enabled, Mission Control super-admin callables, `stripeWebhook`, Stripe-event-time donation completion, metadata-only Checkout completion recovery through backend-only `givingPaymentMetadata` when session persistence was interrupted, donation receipt date labeling, out-of-order refund/completion delivery, the retired no-op `onGivingCreated` compatibility shim without raw giving-ID logging, `sendPushNotification`, event triggers, newsletter triggers, and giving receipt triggers.
- Functions emulator behavior for `sendTaxReceipt`, `sendCorrectedTaxReceipt`, `sendAnnualTaxReceipt`, `sendCorrectedAnnualTaxReceipt`, `downloadTaxReceiptPdf`, `sendChurchAnnualTaxReceipts`, `sendChurchCorrectedAnnualTaxReceipts`, `getPaymentOperationsReadiness`, `getTaxReceiptAuditEvents`, tax receipt record creation with private donor legal name/address when present, year-qualified receipt numbers from per-church/year counters, owner-client-only donor receipt profile fields, church-facing giving rows keeping donor account email blank/removed while official receipt records use Auth email, backend-owned `churchReceiptVisible` and versioned receipt-manager safe markers for giving/annual summary reads, receipt-manager Firestore read rules that require blank `donorEmail`, current giving safe version, no raw Stripe payment identifier or checkout URL alias fields, and completed/refunded `status` on giving rows and fail closed for pending, failed, or legacy rows without the flag, with donor email, or with raw Stripe payment identifiers or checkout URL aliases, frontend mapper redaction for any legacy church-facing `donorEmail`, frontend propagation of the backend-owned visibility flags into defensive receipt-manager UI filtering, guarded legacy visibility audit/repair coverage for refusing incomplete-scan repairs, using the read-only Firebase CLI auth fallback, confirmed repair fallback with exact repair-count confirmation, post-repair clean re-scan verification, clearing church-facing donor emails, preserving raw Stripe identifiers and checkout URL aliases into backend-only payment metadata before removing them from staff-readable giving rows, setting versioned giving and annual summary safe markers, mirroring non-private annual receipt jurisdiction onto annual summary rows, preserving marker-safe blank-`receiptId` annual issuance-gap retry summaries while removing private annual-summary fields, and keeping anonymous/unclassified rows hidden, legacy email-shaped `donorName` suppression from public receipt labels, fail-closed frontend mapping for missing giving/annual-summary anonymity metadata, tax receipt email send claiming to prevent duplicate official PDF delivery while recovering stale attempts, retained official PDF copy metadata and hash verification before resend/download, stored single receipt match checks before resend email preparation, explicit supported-currency checks before receipt numbering/resend/download, stored receipt email/PDF refund-state rechecks before delivery/rendering/retention, voided/review-required email resend blocking, completed-donation recovery when the non-tax payment receipt is already sent but auto tax receipt state is missing or only issued, anonymous and missing-anonymity giving identity redaction plus receipt-manager read/callable blocking for anonymous, unclassified, or receipt-manager-hidden targeted receipt operations, donor/receipt-manager-only giving and annual summary Firestore reads, donor-client-only full tax receipt Firestore reads and list queries, donor-only tax receipt PDF rendering/download, fail-closed missing-official-receipt-number email/download behavior before PDF rendering or retention, donor self-service corrected single and annual receipts for partially refunded own gifts, active-church gating for new tax receipt issuance and manual ready status, donor action gating that requires current setup evidence for manual-ready or unknown historical giving rows, receipt-manager action gating for stored single/annual receipt re-sends after new issuance is disabled, mixed- or missing-currency annual donor-year rows marked review-only before backend send calls, annual and corrected annual batches fail closed before donor scans when the church is inactive, annual and corrected annual batches redacting mixed- or missing-currency review failures before consuming limited send slots, corrected annual UI action gating limited to partial-refund correction states, historical annual and corrected annual receipt re-email from stored official records after new issuance is disabled or the parish is deactivated, full-refund annual reissue for remaining eligible donor-year gifts while preserving the voided original receipt record including stale unvoided annual receipt voiding before resend, stored annual receipt resend blocking when donor-year giving changed, church-year annual batch reissue and rerun skip behavior, donor UI print/download blocking for voided or correction-required receipt records, Canada/CRA issuance blocking with staged issue-location/signer/signature-readiness/copy-retention fields and CRA-specific PDF/email rendering coverage, U.S. eligibility-attestation enforcement before receipt issuance, redacted tax receipt settings audit summaries without tax ID/legal-address/signer/goods-services text leakage, manual auto-issue-off donations becoming receipt-ready after Stripe completion only while the church remains active, annual summary `includesPreviouslyReceipted` warning mirrors plus backend acknowledgement enforcement before issuing or emailing annual receipts that include individually receipted gifts, itemized annual contribution details on full donor-only annual receipt records/PDFs but not church-facing summary mirrors, refund-aware receipt-manager amount display for original/refunded/net eligible amounts on non-anonymous correction rows before send actions, corrected receipt email/PDF/donor-detail labelling with original/refunded/net amount detail, redacted runtime payment readiness including Stripe account activation booleans/counts, redacted live Stripe webhook endpoint readiness, Resend `kandilo.org` sending-domain readiness, redacted live/test completed-Checkout webhook activity with direct live-mode completed-Checkout and live issue-status lookups, redacted official receipt email smoke counts, and redacted annual receipt smoke readiness that scans recent annual email events for a fresh staff-safe annual summary and retained PDF object candidate plus itemized contribution-line evidence, while requiring original annual receipt evidence instead of a corrected or refund-reissue annual receipt, without Stripe account IDs, webhook endpoint IDs, business names, bank details, tax identifiers, requirement field names, Resend domain record IDs/DNS records, Stripe payment/session IDs, giving IDs, receipt IDs, donor UIDs, donor names, or donor emails, live-mode Stripe account, verified live Stripe webhook endpoint, exactly one verified receipt-email sender domain, completed-Checkout webhook smoke plus direct live issue-status gating, and official receipt plus annual receipt smoke gating before production-ready status, backend-only raw `givingPaymentMetadata`, `stripeWebhookEvents`, and `taxReceiptEvents`, redacted annual batch failure responses/logs, already-emailed annual batch skip counts and rerun progression beyond the first 250 already-sent donor-years, SuperAdmin-only whitelisted receipt audit visibility without target donor UIDs, donor-as-actor UIDs, raw receipt document IDs, or giving IDs, failed receipt email/PDF status updates, full-refund receipt voiding from Stripe webhooks, partial-refund correction-required safeguards, corrected single-donation and annual partial-refund reissue, later larger partial refund annual corrections voiding earlier corrected annual receipt records, bulk corrected annual partial-refund reissue, and UI-visible setup-required/not-enabled receipt states before send controls are available.
- Functions emulator coverage includes a direct receipt-ready Checkout bypass test: missing donor private legal receipt details now rejects before Stripe initialization and before writing `giving` / `givingPaymentMetadata` records.
- Functions emulator coverage includes auto-issued receipt delivery failures preserving `taxReceiptEmailError` on the giving mirror so donor and receipt-manager retry UI keeps the specific delivery blocker visible.
- Receipt label coverage must treat the reserved `Anonymous donor` label as unsafe on explicitly non-anonymous giving rows and annual summary mirrors, alongside embedded email-shaped labels.
- Live donation smoke coverage must prove receipt-ready church-facing giving mirror privacy before receipt email smoke, including blank donor email, coherent visibility/safe markers, safe public donor labels, and no raw Stripe payment identifier or checkout URL alias fields on the church-facing giving mirror.
- Donor UI checks must include print/download blocking for unsupported-jurisdiction receipt records, not only voided or correction-required records.
- Donor and receipt-manager UI checks must include disabled send/resend controls for unsupported-jurisdiction stored giving rows and annual summary mirrors.
- Those checks must cover both mirrored unsupported-jurisdiction row errors and the church's current unsupported-jurisdiction setup state, including direct stored-receipt email/PDF callable retries before retained/generated PDF work.
- Functions emulator coverage also verifies targeted receipt-manager sends fail closed for otherwise visible legacy `giving` rows that still carry raw Stripe payment identifiers or checkout URL aliases, matching the Firestore rule and audit-repair privacy boundary.
- Functions emulator coverage also includes stored annual receipt resend and PDF download blocking when donor-year giving changed after a retained official receipt already existed. Source-readiness coverage verifies stored annual receipt email delivery runs the same donor-year guard after the send claim, before generated PDF retention, and before provider delivery.
- Functions emulator and source-readiness coverage also include stored single receipt match checks for email delivery and donor PDF download, new single-donation receipt issuance blocking when a non-voided annual receipt already covers the giving ID plus exact donor covered-giving UI gating and church summary-no-inference coverage, and corrected partial-refund receipt amount/refund/currency matching before generated PDF retention, provider delivery, or download audit logging.
- Firebase rules coverage also includes malformed annual summary mirrors that accidentally contain private full-receipt fields; donors can read their own mirror, priests and treasurers are denied direct reads, and marker-constrained church list queries exclude mirrors missing the current backend-issued safe summary marker version, including legacy marker-only mirrors.
- Static Stripe, tax receipt PDF/email, anonymous receipt privacy, backend-only Stripe Connect routing with SuperAdmin account creation, account retrieval validation, redacted connected-account setup status, session-bound onboarding returns, card-only hosted Checkout for immediate receipt readiness, paginated scheduled annual receipt preparation with backend-only aggregate review-skip audit events, and Firebase production readiness via `npm run check:stripe-production` before any live-mode Stripe cutover. CI also runs `npm run check:stripe-production:ci` as a static source/runbook gate without live credentials or `.env.local`; the full local/deploy readiness check remains required before production builds and deploys.
- Read-only live Stripe/Resend/Firebase checks via `STRIPE_SECRET_KEY=sk_live_... npm run check:stripe-account-live`, `RESEND_API_KEY=re_... npm run check:resend-live`, `STRIPE_SECRET_KEY=sk_live_... npm run check:stripe-webhook-live`, `npm run check:firebase-live`, `npm run check:live-donation-smoke`, `npm run check:live-donation-smoke -- --require-sent-receipt`, `npm run check:live-annual-receipt-smoke`, plus the paginated `npm run audit:tax-receipts -- --fail-on-repairs` after deploying the tax receipt release surface with its Firebase CLI auth fallback for read-only Firestore scans, redacted planned repair effects that omit donor emails/giving IDs/receipt IDs/tax identifiers/receipt contents, exact repair-count confirmation for guarded repairs, unknown/mistyped audit argument rejection before production reads or repairs, and post-repair clean re-scan verification, so production is not treated as ready while Stripe account activation flags, Resend sending-domain readiness, the live webhook endpoint, receipt Functions, exact deployed Function secret bindings, legacy-safe giving shims, Firestore indexes, deployed Firestore receipt/privacy rules, deployed Storage rules, hosted portal security headers, hosted portal build assets, the first live donation webhook/giving/receipt-ready smoke result, absence of lingering receipt errors, receipt-ready privacy-safe church-facing giving mirror evidence with no raw Stripe payment identifier or checkout URL alias fields, stored official receipt identity/amount/currency/kind/status/assigned-number/timestamp evidence when issued, portal-visible receipt number matches the donor-only receipt number when issued, strict sent-receipt email/PDF/audit evidence with fresh stored receipt, giving mirror timestamp, retained PDF status/timestamp, retained PDF object exists in Firebase Storage with matching byte length/hash metadata, annual receipt smoke evidence for an original non-anonymous annual receipt covering at least two donations with exact covered-giving IDs and itemized contribution-line detail matching the annual receipt totals, fresh annual issue/email/PDF-retention evidence, matching staff-safe annual summary mirror with no private full-receipt fields, retained annual PDF Storage object integrity, and audit timestamps before public receipt availability, year-end annual receipt availability, retained PDF metadata, or legacy receipt visibility metadata are still missing from the production setup.
- Cloud Function callable wrapper App Check replay-protection options, including donation Checkout and official receipt send/download actions.
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
