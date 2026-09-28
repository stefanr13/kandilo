# Production stabilization — 2026-09-27

This pass implements the agreed launch scope: users with verified email may join up to three parishes themselves; existing parish features and event food orders use payment at pickup. Paid ticket checkout, ticket issuance, campaign checkout, camera scanning, and native Google sign-in remain unavailable. Nothing in this pass deploys to production or changes production records.

## Changes

- Verified email is enforced for self-joining and member feeds/directory access. Concurrent self-joins respect the cap. Members can leave through an atomic removal of both membership documents; suspended users cannot delete the restriction and rejoin.
- Donation confirmation delivery runs from the original completion event, with platform retry/backoff, a five-attempt limit, and a stable provider idempotency key. Error bookkeeping does not enqueue another confirmation. Permanent missing-recipient/metadata failures remain visible on the giving record. Official receipt follow-up treats another sender’s active claim as busy, and records failures transactionally so a late error cannot overwrite successful manual delivery.
- Public events load through server projections that expose only approved fields. Drafts and inactive parishes are unavailable, and load failures are shown. Staff reads remain authorized Firestore reads.
- Food orders use a browser-session request secret and transactionally stable order ID. Ambiguous retries retain that ID even when stock changes. The customer can recover the last receipt/status and actual collected-payment state in the same browser session; no contact data is stored in browser storage. Outstanding staff orders are fetched separately from the latest 75 historical orders. Deactivated parishes cannot accept new orders.
- Ticket scans reject unknown/unpaid states and expired tickets. Event-level disabled re-entry cannot be overridden by a ticket flag. These guards do not enable unfinished ticket purchasing.
- Email-verification refresh unlocks membership and invitation acceptance without a full reload. Invitation errors offer retry and dismissal. Account/parish changes clear scoped UI state and feed errors are surfaced.
- Published bulletins are reachable again. Saints rendering no longer references an undefined variable. Calendar actions export a real `.ics` event with absolute times and an alarm, and describe the required calendar import accurately. Placeholder navigation/actions were removed or connected to existing features.
- Saints source rows are separated by language instead of pairing unrelated saints by array position. Both years preserve every original language's name/description pairs and order. Curated primary names are selected within each language; missing translations stay missing. Untranslated Russian/Romanian/Ukrainian extra copy falls back to English rather than Serbian.
- Profile notification opt-in supports web and native permissions. iOS now bridges an FCM token through Firebase Messaging instead of storing an APNs token as FCM. Server-owned token ownership prevents a shared device from remaining attached to two accounts; logout unregisters this device. Notification taps route only to validated local event paths.
- Profile account deletion reauthenticates, deletes the Auth account, and retries backend cleanup of memberships, profile/avatar, invitations, device ownership, and linked food-order contact details. Donation/official receipt records remain retained. Guest orders without an account association are not automatically erased by deleting an unrelated account.
- Typechecking is part of the production build. Dependency locks have been updated and critical/high advisories removed.

## Local validation

The recorded validation uses Node 22.21.1. Logs are in `/private/tmp/kandilo-production-*` for this work session.

- Web and Functions typechecking.
- 570 passing tests: 402 web unit/render tests, 14 Firestore/Storage rules emulator tests, and 154 Functions emulator tests.
- Production web and Functions builds; clean lockfile install and subsequent lock consistency verification.
- iOS simulator compilation with signing disabled and Android debug assembly both succeeded; these are not signed-device push tests.
- Static Stripe/receipt readiness checks. The expected warning for unfinished native HTTPS-link signing identities remains.
- Browser checks with synthetic local data: public menu loading, pickup submission and receipt recovery after refresh, member sign-in, published bulletin reader, empty Saints route, and calendar fallback feedback. The embedded browser did not expose a downloadable-file event; calendar file contents/fallback are covered by focused tests, and native import remains a device check.
- Three independent reviews: backend/rules, client/native, and release/dependencies. Findings about invitation dismissal, same-user token refresh, ambiguous food retries, verification-triggered push enrollment, native logout cleanup, and legacy unverified newsletter access were addressed.

The added tests target the reproduced defects and cross-operation failure paths. The existing suites and strict checks were retained; no browser-testing framework was added.

## Required release sequence and external checks

1. **Use a coordinated release.** Deploy `firestore:indexes` first and wait for indexes to be enabled. The new featured-event query needs `eventPortals: churchId ASC, status ASC, focusEnabled ASC, startsAt DESC`; account cleanup needs a collection-group index on `members.userId`. Then deploy the reviewed Functions, Firestore/Storage rules, and matching web/native clients. Older public-event clients do not use the new projection and order request protocol, so maintainers must account for installed native versions before enabling food ordering broadly.
2. **Check the whole deployment.** `npm run check:firebase-live` remains a Stripe/receipt-specific check, not proof of parish/event readiness. Confirm the active deployment includes `getPublicEventContent`, `getFeaturedEventPortals`, `getEventFoodOrder`, `registerPushToken`, and `unregisterPushToken`, plus updated `joinChurch`, `submitEventFoodOrder`, `scanEventTicket`, `onGivingCompleted`, and `onUserDeleted`. Confirm `onGivingCompleted` retry is enabled and the account deletion trigger has its failure policy. Read the actual deployed source/version, not just function names.
3. **Migrate Saints data deliberately.** Back up the existing collections, then run `SAINTS_YEAR=2026 npx tsx scripts/seed-saints.ts`, `scripts/migrate-saints-index.ts`, and `scripts/migrate-saints-index-months.ts` with the same year variable; repeat for 2027. These scripts write production data using configured Firebase credentials; they were not run against production during this pass. Verify selected multilingual days in full, daily-index, and monthly-index views after migration. Avoid the older `seed-saints.mjs`, which does not write current priority metadata.
4. **Validate push on real devices.** Configure the Firebase/APNs credentials, native Google service files, signing/entitlements, and web VAPID key for the release environment. Test fresh opt-in, denied permission, foreground/background delivery, token refresh, notification taps, account switch, logout, and deletion on each supported platform. Legacy profile tokens without `pushTokenOwners` records intentionally do not receive fanout until the updated client registers them. Do not guess/backfill device ownership from duplicated legacy tokens.
5. **Complete native release identities.** Final Apple team/Android signing fingerprints and universal/app-link associations are still required. Validate invitation and payment return links on signed physical-device builds. Test `.ics` sharing/import on iOS and Android; desktop export alone is not native calendar qualification.
6. **Run authorized live payment/email checks.** Verify live secrets, webhook subscriptions, sending-domain readiness, and the documented donation/receipt/refund/annual-receipt smoke tests for the exact release. This pass only used synthetic emulator transactions. Canadian official receipts remain deliberately disabled where capabilities are incomplete.
7. **Operate the retained workflows.** Alert on exhausted donation confirmations (`receiptEmailAttempts >= 5` with no sent timestamp), stale delivery claims, failed account cleanup, webhook errors, and stuck food orders. Staff must cancel no-show pay-at-pickup orders to restore tracked stock. Decide retention for guest event contact details, and exercise backups/restoration for financial and membership records. Existing cloud alerts and backup configuration were not inspected.

## Residual dependency advisories

The final audit contains no critical or high findings. It still reports moderate transitive entries: five in root tooling and two in Functions. Counts include dependency-chain entries, not five/two distinct exploits.

- `uuid` via Google `gaxios` 6: the inspected call is argument-free `uuid.v4()` for a multipart boundary. The [advisory](https://github.com/advisories/GHSA-w5hq-g745-h8pq) concerns caller-supplied buffers in v3/v5/v6; that path is not used here. No forced major override was added. Recheck when upstream Google dependencies update.
- OpenTelemetry core via Firebase CLI's Pub/Sub dependency is development/deployment tooling, not the browser or Functions runtime tree. Track the [upstream baggage-propagation advisory](https://github.com/advisories/GHSA-8988-4f7v-96qf) and update the CLI when its dependency resolves it. Do not expose local emulators to untrusted networks.

These are documented residual risks, not a claim of a clean audit or a completed production qualification. App-wide translation, accessibility, signed-device behavior, and live-service operational readiness still need release-owner validation.
