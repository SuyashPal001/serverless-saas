# Plan: Add Google Sign-In to Login Page

This plan outlines the steps to integrate Google Sign-In as a federated identity provider via AWS Cognito.

## 1. Google Auth Helper
Create `apps/web/lib/auth-google.ts` to handle the redirection to Cognito's authorize endpoint.

```typescript
export function initiateGoogleSignIn(): void {
  const domain = process.env.NEXT_PUBLIC_COGNITO_DOMAIN;
  const clientId = process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID;
  const callbackUrl = process.env.NEXT_PUBLIC_COGNITO_CALLBACK_URL;

  const url = `${domain}/oauth2/authorize?response_type=code&client_id=${clientId}&redirect_uri=${encodeURIComponent(callbackUrl)}&identity_provider=Google&scope=openid%20email%20profile`;

  window.location.href = url;
}
```

## 2. Login Page UI
Modify `apps/web/app/auth/login/page.tsx`:
- Import `initiateGoogleSignIn` from `@/lib/auth-google`.
- Add a horizontal divider with "or" text.
- Add a "Continue with Google" button using shadcn `Button` (variant="outline").
- Include an inline Google SVG icon.

## 3. Auth Callback Page
Create `apps/web/app/auth/callback/page.tsx` as a client component:
- Extract OAuth `code` from search params.
- Exchange `code` for tokens by calling Cognito's `/oauth2/token` endpoint.
- Extract `id_token` and call `/api/auth/session` to establish the session cookie.
- Decode `id_token` to retrieve claims.
- Redirect to `/{custom:tenantSlug}/dashboard` if `custom:tenantSlug` exists, otherwise to `/onboarding`.
- Display a loading spinner during the process.
- Handle and display errors with a "Back to login" link.

## 4. Environment Variables
Add the following to `apps/web/.env.local.example`:
- `NEXT_PUBLIC_COGNITO_DOMAIN`
- `NEXT_PUBLIC_COGNITO_CALLBACK_URL`

## Verification Plan
- Check if the "Continue with Google" button appears correctly.
- Verify that clicking the button redirects to the Cognito domain with correct parameters.
- Verify that the callback page correctly handles the `code` and redirects as expected.
