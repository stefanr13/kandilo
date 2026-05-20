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
- Web QA baseline: `npm run test:qa`
- Full local verification: `npm run check`

See `docs/QA_WEB_FIREBASE.md` for the web frontend and Firebase-facing QA standard.

CI validation is defined in `.github/workflows/ci.yml` and runs the typecheck/unit, Firebase rules emulator, Cloud Functions emulator, and build gates on pull requests and pushes to `main`.

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

Capacitor uses the built web app from `dist`, so run `npm run build` or `npm run cap:sync` before opening native projects.
