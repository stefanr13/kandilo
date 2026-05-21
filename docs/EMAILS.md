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
- Do not claim legal/tax status in giving receipts. Refer official receipt questions to the parish.

## Current Code Templates

Reusable templates live in:

`functions/src/shared/emailTemplates.ts`

They currently cover:

- Parish invitation emails.
- Published newsletter/bulletin emails.
- Giving receipt emails.
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
