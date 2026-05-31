# Giving Module Map

This module handles Stripe-hosted donations and official tax receipt workflows. Keep behavior changes small and verify with the functions emulator suite because most paths involve payment state, receipt identity, or staff/donor privacy.

## Files

- `index.ts` exports deployed Firebase Functions.
- `functions.ts` owns callable, HTTP, and Firestore trigger handlers. It should validate auth/App Check/input, load documents, and delegate domain work.
- `checkout-helpers.ts` owns Stripe Checkout, Stripe Connect routing readiness, Stripe object ID parsing, and payment metadata document lookup.
- `annual-giving.ts` owns reusable closed-year giving selection and filtering.
- `operation-errors.ts` owns safe error-code extraction, failure mirrors, and batch review audit logging.
- `operations.ts` owns receipt issuance, resend/download preparation, scheduled annual preparation, and refund-driven receipt review/void state transitions.
- `helpers.ts` owns shared receipt/domain helpers that are still used across several workflows. Prefer moving cohesive groups out of this file when a new dependency-free boundary is clear.
- `constants.ts` owns shared literals, limits, collection names, and public-safe error codes.

## Refactor Rules

- Do not introduce imports from `helpers.ts` back into files that `helpers.ts` imports or re-exports.
- Keep callable names and exported function names stable unless deployment migration is explicitly planned.
- Keep private Stripe/payment identifiers in backend-only documents; staff-facing mirrors must stay privacy-safe.
- Run `npm --prefix functions run build`, focused giving tests, `npm run test:functions`, and the static production readiness check under Node 22 after meaningful changes.
