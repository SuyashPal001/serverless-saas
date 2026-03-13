# Project Context — Platform Web

## What We Are Building
Multi-tenant SaaS platform dashboard. Frontend only — `apps/web` inside the `serverless-saas` pnpm monorepo.

The backend API is **fully built and live**. All 12 route domains are verified working. Do not build mock data or stubs — connect to the real API.

---

## Live Backend

| Resource | Value |
|---|---|
| API Base URL | `https://qh9a33hgbd.execute-api.ap-south-1.amazonaws.com` |
| Cognito User Pool | `ap-south-1_7ojsspkCU` |
| Cognito Client ID | `o8m606564m72f8uh2np6m0odl` |
| Region | `ap-south-1` |

Environment variables in `.env.local`:
```
NEXT_PUBLIC_API_URL=https://qh9a33hgbd.execute-api.ap-south-1.amazonaws.com
NEXT_PUBLIC_ROOT_DOMAIN=localhost:3000
NEXT_PUBLIC_COGNITO_USER_POOL_ID=ap-south-1_7ojsspkCU
NEXT_PUBLIC_COGNITO_CLIENT_ID=o8m606564m72f8uh2np6m0odl
```

---

## API Contract

All API responses follow this shape:
```typescript
// Success
{ data: T }

// Error
{ error: string, code: string }
```

All requests are tenant-scoped via JWT — no need to pass tenantId manually.

### Endpoints (all under /api/v1)

**Members**
- `GET /members` → `{ data: Member[] }`
- `POST /members/invite` → `{ data: Member }` — body: `{ email, roleId }`
- `PATCH /members/:id/role` → `{ data: Member }` — body: `{ roleId }`
- `DELETE /members/:id`

**Roles**
- `GET /roles` → `{ data: Role[] }`
- `POST /roles` → `{ data: Role }` — body: `{ name, description }`

**Billing**
- `GET /billing/plan` → `{ data: Subscription }`
- `POST /billing/upgrade` → body: `{ plan, billingCycle }`
- `POST /billing/cancel`
- `GET /billing/invoices` → `{ data: Invoice[] }`

**API Keys**
- `GET /api-keys` → `{ data: ApiKey[] }`
- `POST /api-keys` → `{ data: { key: string, ...ApiKey } }` — body: `{ name, type, permissions, expiresAt? }`
- `DELETE /api-keys/:id/revoke`

**Agents**
- `GET /agents` → `{ data: Agent[] }`
- `POST /agents` → `{ data: Agent }`
- `GET /agents/:id` → `{ data: Agent }`
- `PATCH /agents/:id`

**Agent Runs**
- `GET /agent-runs` → `{ data: AgentRun[] }`
- `GET /agent-runs/:id` → `{ data: AgentRun }`

**Notifications**
- `GET /notifications` → `{ data: NotificationInboxItem[] }`
- `PATCH /notifications/:id` → mark as read — body: `{ read: true }`

**Audit Log**
- `GET /audit-log` → `{ data: AuditEntry[] }`

**Ops (platform_admin only)**
- `GET /ops/tenants` → `{ data: Tenant[] }`
- `PATCH /ops/tenants/:id` → body: `{ status }`
- `GET /ops/overrides` → `{ data: Override[] }`
- `POST /ops/overrides` → body: `{ tenantId, featureId, enabled?, valueLimit?, reason, expiresAt? }`
- `POST /ops/overrides/:id/revoke`

**Auth**
- `POST /auth/logout`
- `POST /auth/switch-tenant` → body: `{ tenantSlug }`

---

## Permission Model

Permissions are strings in format `resource:action`. Examples:
- `members:create`, `members:read`, `members:update`, `members:delete`
- `roles:create`, `roles:read`
- `billing:read`, `billing:update`
- `api_keys:create`, `api_keys:read`, `api_keys:delete`
- `agents:create`, `agents:read`, `agents:update`
- `agent_runs:read`
- `notifications:read`, `notifications:update`
- `audit_log:read`

Use `can(permissions, resource, action)` from `lib/permissions.ts` to gate UI elements.

Platform admin role: `platform_admin` — check `role === 'platform_admin'` from useTenant() for ops routes.

---

## Tenant Model
- Every tenant gets a subdomain: `acme.yourapp.com`
- Edge middleware resolves subdomain → passes `x-tenant-slug` header
- JWT claims: `custom:tenantId`, `custom:role`, `custom:plan`
- `useTenant()` hook returns: `{ tenantId, tenantSlug, role, plan, permissions }`

---

## Auth Flow
- Login → Cognito via aws-amplify → JWT stored in httpOnly cookie (`platform_token`)
- Token refresh: silent via Cognito refresh token
- Invite accept → `completeNewPassword` flow → redirect to tenant subdomain
- Onboarding: if `custom:tenantId` is empty in JWT → redirect to `/onboarding`

---

## Real-Time (Notifications)
- WebSocket connection to API Gateway WebSocket endpoint
- On connect: server stores `connectionId` in Upstash Redis keyed to userId
- Lambda pushes new notifications to browser via connectionId
- Frontend: maintain WebSocket connection in notifications context, update TanStack Query cache on message received

---

## Completed Tasks
- ✅ Task 1 — Scaffold (Next.js 15, dependencies, folder structure, lib/api.ts, lib/permissions.ts, middleware.ts)
- ✅ Task 2 — Auth Flow (lib/auth.ts, session route, login page, invite page, tenant layout, TenantProvider)
- ✅ Task 3 — Dashboard Shell (layout, Sidebar, Topbar)
- ✅ Task 4 — Members Page (list, invite modal, role change, permission gates)
- ✅ Task 5 — Roles Page
- ✅ Task 6 — Billing + Invoices

## Remaining Tasks
- Task 7 — API Keys (Flash)
- Task 8 — Agents List + Detail + Runs (Pro Low)
- Task 9 — Notifications Inbox with WebSocket (Pro High)
- Task 10 — Audit Log (Flash)
- Task 11 — Ops Portal — Tenants + Feature Overrides (Pro Low)