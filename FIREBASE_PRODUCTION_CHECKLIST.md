# Kandilo Firebase Production Checklist

Use this when preparing `kandilo-2f7a9` for production deployment and physical-device testing. Do not commit local secrets, native Firebase config files, signing files, or generated native web assets.

## 1. Required Local Files

- `.env.local` at the repo root with the public Vite/Firebase values from Firebase Console.
- `functions/.env.production` with `APP_URL=https://app.kandilo.org`.
- `ios/App/App/GoogleService-Info.plist` for local iOS builds.
- `android/app/google-services.json` for local Android builds.

These files are intentionally gitignored where they contain environment-specific configuration.

## 2. Firebase Console Setup

Confirm these Firebase services are enabled:

- Authentication: Email/password, Google, anonymous.
- Firestore.
- Firebase Storage.
- Cloud Functions.
- Firebase Hosting for `app.kandilo.org`.
- Firebase Cloud Messaging.
- App Check.

Authentication authorized domains should include `app.kandilo.org`, the Firebase default auth domain, and localhost for development.

If Firebase CLI reports that Storage has not been set up, open Firebase Console -> Storage for `kandilo-2f7a9`, click "Get Started", choose the production bucket location, then deploy `storage.rules`.

## 3. Secrets And Environment

Set Cloud Functions secrets in Firebase Secret Manager:

```bash
npx firebase-tools@latest functions:secrets:set GEMINI_API_KEY --project kandilo-2f7a9
npx firebase-tools@latest functions:secrets:set RESEND_API_KEY --project kandilo-2f7a9
npx firebase-tools@latest functions:secrets:set STRIPE_SECRET_KEY --project kandilo-2f7a9
npx firebase-tools@latest functions:secrets:set STRIPE_WEBHOOK_SECRET --project kandilo-2f7a9
```

`STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` can stay on test-mode values until Stripe is ready for production.

## 4. Deploy Rules, Indexes, Functions, Hosting

From the repo root:

```bash
npm run check
npm run build
npm --prefix functions run build

npx firebase-tools@latest deploy --only firestore:rules,firestore:indexes,storage --project kandilo-2f7a9
npx firebase-tools@latest deploy --only functions --project kandilo-2f7a9
npx firebase-tools@latest deploy --only hosting --project kandilo-2f7a9
```

After deploy, verify `https://app.kandilo.org` serves the latest local build assets.

## 5. Stripe Setup

The app is wired for hosted Stripe Checkout through Cloud Functions. Donations currently settle to the configured platform Stripe account; per-parish Stripe Connect accounts are not implemented.

When Stripe is ready:

- Create the webhook endpoint for the deployed `stripeWebhook` function URL.
- Subscribe the endpoint to `checkout.session.completed`, `checkout.session.expired`, and `checkout.session.async_payment_failed`.
- Set `STRIPE_WEBHOOK_SECRET` from that endpoint.
- Use test mode first and complete a donation from an active church member account.
- Confirm the `giving/{givingId}` document moves from `pending` to `completed` or a failure state.
- Confirm the receipt email sends only when `RESEND_API_KEY` is set and the member has a valid Auth email.

## 6. App Check And Push

AI functions enforce Firebase App Check. Before relying on Faith AI or AI Post Writer:

- Configure the web App Check provider and put its public site key in `VITE_FIREBASE_APP_CHECK_SITE_KEY`.
- Keep `VITE_ENABLE_FAITH_AI=false` and `VITE_ENABLE_AI_WRITER=false` until Gemini is configured and the AI flows pass smoke tests.
- Test App Check token issuance on the hosted web app.
- Test App Check token issuance inside the Capacitor iOS WebView on a physical device.

For push notifications:

- Create a Web Push certificate in Firebase Console and set `VITE_FIREBASE_VAPID_KEY`.
- Confirm `.env.local` includes the `VITE_FIREBASE_*` web app identifiers before `npm run build`; the build generates the gitignored `public/firebase-messaging-sw-config.js` used by background web push.
- Upload the APNs key/certificate for the iOS Firebase app.
- Confirm the physical iOS device receives permission prompts and stores an FCM token on `users/{uid}.fcmTokens`.

## 7. Physical iOS Device Test

From the repo root:

```bash
npm run build
npx cap sync ios
npx cap open ios
```

In Xcode:

- Open `ios/App/App.xcworkspace`.
- Select the physical device.
- Select the Apple developer team for signing.
- Confirm `GoogleService-Info.plist` is present in the app target resources.
- Run the app and test auth, church selection, profile save/avatar upload, events, event check-in, posts, Faith AI, giving checkout handoff, and push permission.

## 8. Universal Links

The repo includes the well-known files, entitlements, and URL handling, but the published app-link files must be populated with final identifiers:

- `public/.well-known/apple-app-site-association`: Apple Team ID and iOS bundle identifier.
- `public/.well-known/assetlinks.json`: Android package name and release signing SHA-256 fingerprint.

Deploy hosting after updating these files. This is needed for HTTPS invite links and payment return links to open the native app reliably.
