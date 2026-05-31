# Kandilo Email Standard

Kandilo transactional emails should feel like the web app: clean white surfaces, deep red actions, gold section labels, strong hierarchy, and quiet supporting text.

## Production Rules

- Always include the church name when the message is church-specific.
- If a user may belong to multiple churches, say which church the email applies to.
- Keep the primary CTA as an HTTPS web URL and use `kandilo://` only as a secondary installed-app link.
- Include the user role or target audience when it affects why the user received the email.
- Send both `html` and `text`.
- Use table-based, inline styles only. Do not depend on Tailwind, web fonts, external CSS, SVG backgrounds, or JavaScript.
- Keep emails narrow, readable, and compatible with Gmail, Outlook, Apple Mail, and common mobile clients.
- Do not claim legal/tax status in giving/payment confirmations. The donation confirmation email must explicitly say it is not an official tax receipt and that official tax receipts are sent separately when available; refer official receipt questions to the parish.
- Before live receipt email smoke testing, run `RESEND_API_KEY=re_... npm run check:resend-live` to confirm the live key can see exactly one verified `kandilo.org` sending domain without storing the key in repo env files.
- Giving receipt emails should use the confirmed donation date from `giving.completedAt` in the church timezone, not the later email processing date.
- Official tax receipt emails are separate from giving payment receipts and are sent only after church tax receipt settings are enabled and validated, including legal organization name, receipt address, tax ID, and SuperAdmin eligibility attestation for U.S. charitable contribution acknowledgments. If the U.S. goods/services statement is left blank, Mission Control and Functions persist the standard no-goods/services statement for intangible religious benefits before receipts are issued. U.S. receipt emails/PDFs are scoped to cash-donation written acknowledgments under IRS charitable-contribution guidance, not non-cash, advantage/quid-pro-quo, vehicle, or other special-case receipts; see [IRS written acknowledgments](https://www.irs.gov/charities-non-profits/charitable-organizations/charitable-contributions-written-acknowledgments). Official receipt issuance now fails closed until the donor private profile has a legal receipt name and complete mailing address; missing donor profile details use `tax_receipt_donor_profile_incomplete` so auto-issue leaves the donation receipt-ready without assigning a placeholder receipt number, and stored official receipt email/PDF delivery also fails closed with `tax_receipt_missing_receipt_number` if a legacy or manually inserted receipt lacks an official receipt number. The public fallback receipt number `unassigned` is not treated as assigned receipt evidence in donor or church portals, so it cannot make a receipt resendable, settled, printable, downloadable, or count as an individually receipted gift. Annual summaries are issued only after the donor year closes and must include a warning not to double-claim the same gifts through both individual and annual receipts. If a new or existing annual receipt includes individually receipted gifts, the callable must receive an explicit `acknowledgePreviouslyReceipted` confirmation before issuing or emailing it. Donor and church annual rows should detect that risk from both existing annual receipt mirrors and individual giving history before the first annual send, including assigned historical receipt-number-only rows. Backend annual issuance also checks existing single receipt records for covered giving so stale mirrors cannot bypass the acknowledgement guard. Annual full receipt records and PDFs include itemized contribution date/purpose/amount details, and stored annual delivery rechecks those line items against the current covered donations before emailing or downloading; annual summary mirrors may expose only the non-private `includesPreviouslyReceipted` warning flag so donor/church list rows can warn before opening or sending the full receipt.
- New official receipt issuance also requires a verified Firebase Auth email for the donor and does not fall back to stale `giving`, profile, or member email fields; existing stored receipt resends may use the stored official receipt email if the current Auth email cannot be re-verified. Auto-issue and manual single/annual send attempts that hit this verified-email guard persist only safe retry state such as `tax_receipt_missing_email_or_amount`, blank receipt IDs, safe public donor labels, and no donor contact/legal fields, so staff can ask the donor to verify their account email without seeing private receipt details. App routing blocks unverified signed-in accounts before invitation acceptance or Firestore-backed parish screens, and the donor UI blocks Checkout/self-service receipt sends for unverified Auth, offers branded verification email resend, and lets donors check verification again after opening the email link before receipt/profile Firestore reads resume.
- Receipt-ready Stripe Checkout also enforces the donor private profile requirement inside Cloud Functions before Stripe is initialized and before donation/payment metadata documents are written, so a custom client cannot create a donation that is known to be missing the filing details needed for immediate official receipt delivery.
- Official tax receipt emails include both the HTML/text email body and a retained PDF attachment for the same receipt details. For annual receipts, the email points to the PDF for itemized contribution detail instead of expanding donor-private annual line items in the email preview. Receipt sends claim the receipt with a short-lived `emailSendingAt` lock and backend-only `emailSendAttemptId`; provider delivery uses a redacted Resend provider idempotency key, stale claims reuse their existing attempt ID, and completed-donation follow-up can recover missing auto tax receipt state after the non-tax payment receipt has already been sent.
- Scheduled annual receipt preparation is default-off per parish and prepares closed-year annual receipt records; annual auto-email is separately default-off. When a parish explicitly enables auto-email, the scheduler emails only safe prepared annual receipts and skips donor-years with partial refunds, mixed-currency giving, or individual receipts that require duplicate-claim acknowledgement so a donor or priest/treasurer can handle those cases through the existing reviewed annual flows. It paginates active parishes with an explicit scan cap and logs when the cap is hit, and writes aggregate backend-only review summary audit events without donor IDs, giving IDs, receipt IDs, or receipt contents; those events include only the review category and aggregate count.
- Donor portal PDF downloads use the retained backend-only PDF copy when present, otherwise the same server-side renderer generates and retains one before returning it. Downloads are donor-only; donor print/download actions are disabled for voided or correction-required records, and church receipt managers send receipts but do not download full donor PDFs.
- Church-facing receipt queues do not show donor account emails or raw Stripe session, Checkout URL, PaymentIntent, payment-status, expiry, charge, customer, refund, transfer, or Connect account identifiers/aliases. New operational `giving` rows keep `donorEmail` blank/removed for explicitly non-anonymous donations, store Stripe identifiers and checkout URLs in backend-only `givingPaymentMetadata`, and become staff-readable only when Cloud Functions sets backend-owned `churchReceiptVisible`, `donorNamePublicSafe`, and `receiptManagerGivingSafeVersion=1`; receipt-manager Firestore reads also require blank `donorEmail`, a public donor label without embedded email-shaped text, the current giving safe version, and no raw Stripe payment/session/checkout/refund/account fields, so legacy rows without the flags, with donor email, email-shaped donor labels, stale/missing safe-version markers, or raw Stripe payment identifiers/checkout URL aliases fail closed until repaired. The guarded legacy repair path preserves those raw Stripe identifiers and checkout URL aliases into backend-only `givingPaymentMetadata/{givingId}` before removing them from staff-readable `giving` rows. Checkout and receipt rebuilds do not fall back to account email or email-shaped profile/membership display names as public donor labels, while official receipt delivery resolves the donor's verified Firebase Auth email inside Cloud Functions and stores it only on donor-only receipt records.
- Official tax receipt delivery attempts retain the official PDF copy in backend-only Firebase Storage with SHA-256/byte-length metadata, write backend-only `taxReceiptEvents`, and expose only a redacted SuperAdmin audit feed; target donor UIDs, giving IDs, donor identity fields, single-receipt document IDs, and donor-as-actor UIDs must not appear in the callable response. Safe error codes are persisted on the receipt/giving status records when setup validation, PDF generation, PDF retention, or email delivery cannot proceed; backend exception messages and private setup details must not be stored as portal-visible receipt state. Existing annual receipts that already have a stored receipt identity but failed during retryable delivery work, such as Resend configuration, PDF generation/retention, or provider submission, remain retryable from donor and receipt-manager queues without exposing the full receipt to staff. Safe annual issuance-gap summaries with blank receipt IDs, such as missing-profile or missing-verified-email rows, also stay retryable once the donor fixes the required private details; generic identity-less delivery failures, review-required, mixed-currency, or voided annual rows remain blocked. Donor and receipt-manager portals should label repeat delivery of previously emailed official receipts as resend actions, while first-time delivery stays labeled as an email action. Corrected receipts should keep corrected wording in both first-send and resend actions so donors do not confuse a replacement receipt with the original stale receipt.
- Annual summary mirrors are staff-readable only as minimal operational rows when every covered gift is explicitly non-anonymous and receipt-manager-safe, the annual receipt still carries covered-giving evidence, and Cloud Functions has set the backend-owned `donorLabelPublicSafe` marker, `receiptManagerSummarySafe` marker, and current `receiptManagerSummarySafeVersion=2`. Refund, void, and review-required rewrites re-check covered giving before rebuilding annual mirrors and fall back to donor-only markers when that proof is missing or unsafe. Corrected annual summaries may carry only the safe boolean `correctedReceipt` marker for UI wording; private correction identifiers, correction giving IDs, partial-refund giving IDs, source reason codes, operator UIDs, and timestamps remain full-receipt-only and are denied to receipt managers. If a malformed mirror contains private full-receipt fields such as donor email/name/address, legacy receipt-profile aliases like tax receipt legal name/address, covered giving IDs, correction giving IDs, partial-refund giving IDs, correction timestamps, contribution lines, organization tax ID, goods/services text, retained PDF metadata, PDF template metadata, backend send-claim/idempotency metadata, operator UIDs, raw Stripe payment/refund/session/account identifiers or checkout URL aliases, an embedded email-shaped donor label, or no covered-giving proof, Firestore rules and rebuild/audit paths must fail closed for priest/treasurer reads while preserving donor-owner access for recovery; staff list queries require the public-label and current versioned safe markers so marker-only legacy mirrors stay hidden, and backend summary writes sanitize labels and delete private fields during rebuilds before setting the current marker version.
- Anonymous, unclassified, or receipt-manager-hidden donations keep anonymous/blank church-facing identity in `giving` and annual summary mirrors, and receipt managers cannot read those operational documents because they still contain donor `userId`; targeted receipt-manager callables also reject anonymous/unclassified/hidden single gifts and annual donor-years that include anonymous, unclassified, or receipt-manager-hidden gifts. Bulk annual receipt responses return only counts and error codes to receipt managers, skip already-emailed annual receipts on rerun, report mixed-currency donor-years as redacted review failures before consuming limited send slots, and still resolve the donor's verified Auth email and private tax receipt profile fields inside Cloud Functions for receipts that need delivery.
- Voided tax receipts, including receipts voided after a full Stripe refund, are retained for history but are not emailed again. If a full refund voids a mixed annual receipt while other eligible gifts remain in that donor-year, the donor or a priest/treasurer can issue a replacement annual receipt for the remaining gifts instead of reusing the voided record. Partially refunded donations are blocked from standard receipt issuance/resend while correction-required; donors can self-serve corrected single-donation and annual receipts for their own partially refunded gifts, including anonymous, unclassified, or receipt-manager-hidden gifts. Priests and treasurers can send corrected single-donation and individual annual receipts only for receipt-manager-visible explicitly non-anonymous donor records, and can use the privacy-preserving corrected annual batch path for anonymous, unclassified, or receipt-manager-hidden donor-years. Corrected receipt emails/PDFs are labelled as corrected and include original, refunded, and net eligible amount detail.
- Canada/CRA official receipts must not be enabled through the current unsigned PDF/email flow. Donor address capture, backend-only PDF copy retention, and CRA staging fields now exist, including receipt issue location, authorized signer name/title, secure electronic signature readiness, and email receipt retention readiness, but CRA-compliant issuance still needs read-only/non-editable PDF receipts that are protected from unauthorized access, encrypted, electronically signed under authorized parish control, retained, and printable on request before Kandilo can issue Canadian official donation receipts. Donor and church receipt portals must show a Canada/CRA-specific unavailable state for Canadian parishes instead of generic not-enabled copy, so clergy and donors do not mistake the legal/compliance blocker for a local setup omission. Any Canada/CRA renderer output in the current build must remain visibly marked as a staging draft and not valid for income tax purposes, and generic stored-receipt email/download paths must fail closed for legacy or manually inserted non-U.S. receipt records and for direct retries while the church's current receipt setup is an unsupported jurisdiction instead of delivering those drafts. See the CRA's [required receipt information](https://www.canada.ca/en/revenue-agency/services/charities-giving/charities/operating-a-registered-charity/issuing-receipts/what-information-must-on-official-donation-receipt-a-registered-charity.html) and [computer-generated receipt controls](https://www.canada.ca/en/revenue-agency/services/charities-giving/charities/operating-a-registered-charity/issuing-receipts/computer-generated-receipts.html).
- Donor browser-print controls must also fail closed for unsupported-jurisdiction full receipt records, while the donor-only record can remain visible as history.
- Donor and receipt-manager send buttons must also stay disabled for unsupported-jurisdiction stored giving rows or annual summary mirrors, even when a legacy receipt number exists.
- The disabled state must also come from the church's current unsupported-jurisdiction receipt setup, not only from already mirrored `tax_receipt_unsupported_jurisdiction` row errors.

## Current Code Templates

Reusable templates live in:

`functions/src/shared/emailTemplates.ts`

They currently cover:

- Parish invitation emails.
- Published newsletter/bulletin emails.
- Giving receipt emails.
- U.S. tax receipt emails and retained PDF attachments.
- Manual parish notification emails.

The templates return:

- `subject`
- `html`
- `text`

## Auth Emails

Email verification and password reset are sent through Firebase callable Functions:

- `sendEmailVerificationEmail`
- `sendPasswordResetEmail`

The callables generate Firebase Admin action links and send branded Kandilo emails through Resend. Password reset keeps anti-enumeration behavior: unknown addresses get a success response but no email is sent.

Firebase Console templates are now a fallback only. Keep them minimally branded in case Firebase or an admin sends a built-in auth email outside the app flow.

## Mobile Deep Links

Email templates may include a secondary installed-app URL using:

```text
kandilo://app/
```

Invitation emails use:

```text
kandilo://app/join/{invitationId}
```

The primary link remains `https://app.kandilo.org/...` so users without the mobile app can still use the web app. Universal/App Links for `https://app.kandilo.org` also require valid `.well-known` files on Firebase Hosting plus final iOS/Android signing identifiers.

## QA Checklist

Run before changing email behavior:

```bash
npm run typecheck
npm test
npm run test:functions
npm run build
```

For broad Firebase changes, run:

```bash
npm run test:qa
```
