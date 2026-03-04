# Antigravity Agent Rules — Platform Web

## What This Project Is
Multi-tenant SaaS platform dashboard. Each tenant gets a subdomain (acme.yourapp.com).
Tenant context is always resolved from JWT claims — never from URL params directly.
This is the frontend only. Backend API already exists separately.

---

## Non-Negotiable Stack
- Framework: Next.js (App Router) — TypeScript only
- Styling: Tailwind CSS — dark mode first, always
- Components: shadcn/ui only — never MUI, Chakra, Ant Design, or any other component library
- Icons: Lucide only
- Server state: TanStack Query — never useEffect for data fetching, ever
- Forms: React Hook Form + Zod — every form, no exceptions
- Package manager: pnpm — never npm or yarn

---

## Security Rules (Never Violate)
- JWT must be stored in httpOnly cookie only — never localStorage, never sessionStorage, never a JS variable
- Client-side permission checks are UX only — they gate UI rendering, never security decisions
- Never pass tenantId as a URL param or query string — always read from JWT claims
- Never expose raw API credentials in client code

---

## Folder Structure (Follow Exactly)
```
apps/web/
  app/
    (marketing)/
    auth/
      login/
      invite/[token]/
      sso/
    [tenant]/
      layout.tsx        ← resolves tenant, injects context
      dashboard/
        layout.tsx      ← sidebar + topbar shell
        page.tsx
        settings/members/
        settings/roles/
        settings/branding/
        billing/
        api-keys/
        agents/
        notifications/
        audit/
        ops/            ← platform_admin only
  components/
    ui/                 ← shadcn/ui primitives only
    platform/           ← shared platform components
    ops/                ← ops-only components
  lib/
    auth.ts             ← Cognito token + session handling
    tenant.ts           ← subdomain resolution helpers
    api.ts              ← typed fetch wrapper (all API calls go through here)
    permissions.ts      ← client-side permission helpers
  middleware.ts         ← edge middleware, subdomain routing
```

---

## Patterns to Always Follow

### API Calls
- All API calls go through `lib/api.ts` typed wrapper
- Never use raw fetch() directly in components or pages
- JWT is attached automatically by the wrapper from the httpOnly cookie
- Base URL comes from `NEXT_PUBLIC_API_URL` env var only

### Data Fetching
- Always TanStack Query (useQuery, useMutation)
- Never useEffect + fetch
- Loading and error states must always be handled — no silent failures

### Forms
- Always React Hook Form + Zod schema
- Zod schema defined first, then inferred TypeScript type from it
- shadcn/ui FormField components always used for form inputs

### Permissions
- Permission helper: `can(permissions, resource, action)` from `lib/permissions.ts`
- Gate UI rendering with permission checks, not routes
- Ops routes additionally check `platform_admin` role before rendering anything

### Tenant Context
- Tenant slug comes from subdomain, resolved in edge middleware
- Full tenant context (tenantId, role, plan) comes from JWT claims
- Never trust or read tenantId from URL path or query params

---

## Design Rules
- Dark mode first — all components default dark
- Reference aesthetic: Google AI Studio — clean, minimal, content takes full width
- Sidebar navigation, no heavy charts or tables day one
- No heavy chart libraries day one
- Responsive but desktop-first for the dashboard

---

## What to Never Do
- Never install a component library other than shadcn/ui
- Never store JWT anywhere except httpOnly cookie
- Never fetch data with useEffect
- Never read tenant context from URL params
- Never render ops routes without checking platform_admin role
- Never commit .env files