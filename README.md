# Kandilo

Kandilo is a React + Firebase application with Firebase Cloud Functions and Capacitor native shells for iOS and Android.

Production defaults in-repo assume:

- Marketing site: `kandilo.org`
- Authenticated web app: `app.kandilo.org`
- Native custom URL scheme: `kandilo://`

## Prerequisites

- Node.js 22 (`.nvmrc` / `.node-version`)
- Java 21 for Android/Gradle builds
- Firebase project configuration in `.env.local`
- Xcode for iOS builds
- Android Studio for Android builds

## Web Development

1. Install dependencies with `npm install`.
2. Install Cloud Functions dependencies with `npm --prefix functions install`.
3. Start the app with `npm run dev`.

## Verification

- Frontend + functions typecheck: `npm run lint`
- Frontend tests: `npm test`
- Firebase rules emulator tests: `npm run test:firebase`
- Cloud Functions emulator tests: `npm run test:functions`
- Local browser app against Firebase emulators: run the emulators, seed U.S. receipt privacy plus Canadian/CRA unavailable scenarios, including Canadian single and annual unavailable donor rows, with `npm run seed:receipt-emulator`, then `npm run dev:emulators`
- Web QA baseline: `npm run test:qa`
- Full local verification: `npm run check`
- Read-only live Stripe account activation check: `STRIPE_SECRET_KEY=sk_live_... npm run check:stripe-account-live`
- Read-only live Resend sending-domain check: `RESEND_API_KEY=re_... npm run check:resend-live`
- Read-only live Stripe webhook endpoint check: `STRIPE_SECRET_KEY=sk_live_... npm run check:stripe-webhook-live`
- Live Firebase, Storage rules, and Hosting deployment drift check after deploy: `npm run check:firebase-live`
- Read-only first live donation smoke check with a default 72-hour freshness window: `npm run check:live-donation-smoke` verifies receipt-ready state, assigned receipt identity when issued, and a privacy-safe church-facing giving mirror with no raw Stripe payment identifiers or checkout URL aliases; after sending the official smoke receipt, `npm run check:live-donation-smoke -- --require-sent-receipt` also verifies the official receipt email, audit event, retained PDF status, and retained PDF object in Firebase Storage
- Paginated legacy tax receipt visibility audit/gate: `npm run audit:tax-receipts -- --fail-on-repairs` (uses Admin SDK credentials, or Firebase CLI auth as a REST fallback; clean audits print that no repairs are needed, while repair still requires `--repair --confirm-project kandilo-2f7a9 --confirm-repair-count N`, rejects unknown or mistyped audit arguments, preserves the reviewed `--church`, `--limit`, and `--page-size` scan scope, prints redacted planned repair effects without donor emails, giving IDs, receipt IDs, tax identifiers, Stripe identifiers, checkout URL aliases, or receipt contents, preserves legacy raw Stripe payment identifiers and checkout URL aliases into backend-only payment metadata before removing them from staff-readable giving rows, mirrors non-private annual receipt jurisdiction onto annual summary rows, and immediately re-scans before treating production visibility metadata as clean)

See `docs/QA_WEB_FIREBASE.md` for the web frontend and Firebase-facing QA standard.

CI validation is defined in `.github/workflows/ci.yml` and runs the static Stripe/tax receipt production-readiness gate, typecheck/unit, Firebase rules emulator, Cloud Functions emulator, and build gates on pull requests and pushes to `main`.

To configure GitHub branch protection for `main`, run `npm run github:protect-main` with `GITHUB_TOKEN` and `GITHUB_REPOSITORY=owner/repo`. The required status check is `Web, Firebase, and Functions`.

## Production Deployment

Firebase deployment and physical-device setup steps are documented in `FIREBASE_PRODUCTION_CHECKLIST.md`.

## Native Apps

The repository is configured for Capacitor and includes native project generation for both stores.

- Generate or refresh native assets: `npm run cap:sync`
- Open the iOS project in Xcode: `npm run cap:ios`
- Open the Android project in Android Studio: `npm run cap:android`

Native release notes:

- iOS target: `17.0`
- Android min/target SDK: `34` / `35`
- Native Firebase config files are expected locally at `ios/App/App/GoogleService-Info.plist` and `android/app/google-services.json`
- Android release signing is prewired through `android/keystore.properties` or `KANDILO_UPLOAD_*` environment variables
- Check current hosted native return-link file and local derivation readiness without writing files: `npm run configure:native-links -- --status`
- Native HTTPS return files can derive the Apple Team ID from Xcode `DEVELOPMENT_TEAM` and the Android release SHA-256 from that same signing config with `npm run configure:native-links -- --apple-from-xcode-project --android-from-release-keystore`; use `--apple-team-id` and repeated `--android-sha256` values instead when the store identifiers are managed elsewhere

Capacitor uses the built web app from `dist`, so run `npm run build` or `npm run cap:sync` before opening native projects.
