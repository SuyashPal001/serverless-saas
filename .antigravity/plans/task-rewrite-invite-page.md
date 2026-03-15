# Plan: Rewrite Invite Accept Page

This plan outlines the rewrite of `apps/web/app/auth/invite/[token]/page.tsx` to handle the new backend invite API and custom auth flow.

## 1. Invite Details Fetching
On mount, the page will:
- Extract `token` from URL params.
- Call `GET /api/proxy/api/v1/invitations/${token}`.
- Display a loading spinner using `Loader2`.
- Handle error states (invalid/expired token) with a "Back to login" link.

## 2. Authentication Check
The page will determine if the user is logged in by calling `GET /api/proxy/api/v1/auth/me`.
- If 200: User is logged in. Show "Accept Invitation" button.
- If failure (e.g., 401): User is NOT logged in. Show "Sign in to accept" and "Sign up to accept" buttons.

## 3. UI Implementation
- Use shadcn/ui `Card` for the invite details.
- Show `tenantName`, `inviterName`, `roleName`, and `email`.
- Styling will be consistent with the login page (Dark mode, centered layout).

## 4. Invitation Acceptance Logic
- **Logged-in user**: 
    - Click "Accept Invitation" calls `POST /api/proxy/api/v1/invitations/${token}/accept`.
    - On success: Call `DELETE /api/auth/session` and redirect to `/auth/login?invited=true&slug={tenantSlug}`.
    - Handle `EMAIL_MISMATCH` by showing a specific error message.
- **Unauthenticated user**:
    - "Sign in" and "Sign up" buttons redirect to `/auth/login?redirect=/auth/invite/${token}`.

## Verification Plan
- Verify fetching and display of invite details.
- Verify redirect to login for unauthenticated users.
- Verify "Accept" flow for authenticated users.
- Verify handling of email mismatch and invalid tokens.
