# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## AI Assistant Rules

### Machine Targeting
- Claude Code runs on Mac only. Never SSH to GCP VM or Linux VM.
- Gemini CLI runs on GCP VM. All relay/OpenClaw/pm2 work goes here.
- If a prompt asks to grep /opt/ or ~/.openclaw/ — that is GCP VM work, not Mac work.
- If a prompt asks to grep /opt/ or run sam build/deploy — that is Linux VM work, not Mac work.

## Project Overview

Multi-tenant serverless SaaS foundation built on AWS Lambda, Next.js, and Hono. The architecture separates infrastructure (Terraform) from Lambda definitions (SAM), with a monorepo structure managed by pnpm workspaces.

**Key Technologies:**
- **Backend**: Hono (HTTP framework), AWS Lambda, Drizzle ORM (PostgreSQL)
- **Frontend**: Next.js 16 (App Router), React 19, Tailwind CSS, shadcn/ui
- **Infrastructure**: Terraform (infrastructure), AWS SAM (Lambda deployment)
- **Auth**: AWS Cognito with custom JWT claims
- **Cache**: Upstash Redis
- **Build**: pnpm workspaces, esbuild (Lambdas), TypeScript

## Commands

### Development

```bash
# Install dependencies
pnpm install

# Start local services (Postgres, Redis)
docker-compose up -d

# Run Next.js frontend (port 3000)
cd apps/web && pnpm dev

# Run API locally with hot reload
cd apps/api && pnpm dev

# Build all packages
pnpm build

# Type check all packages
pnpm type-check

# Lint
pnpm lint
pnpm lint:fix

# Clean build artifacts
pnpm clean
```

### Database

```bash
# All database commands run from packages/foundation/database/

# Generate migration
pnpm db:generate

# Apply migrations
pnpm db:migrate

# Push schema changes (dev only)
pnpm db:push

# Open Drizzle Studio
pnpm db:studio

# Seed database
pnpm db:seed
```

### AWS Deployment

```bash
# Build and deploy Lambdas to dev
sam build && sam deploy --config-env dev

# Build and deploy to staging/prod
sam build && sam deploy --config-env staging
sam build && sam deploy --config-env prod
```

Lambda build uses Makefile with esbuild (see `Makefile` and `template.yaml`).

## Architecture

### Monorepo Structure

```
apps/
  api/          - Hono API (Lambdalith pattern)
  web/          - Next.js frontend
  worker/       - SQS consumer Lambda
packages/foundation/
  auth/         - JWT validation, Cognito client
  cache/        - Redis wrapper
  database/     - Drizzle schema, migrations, client
  entitlements/ - Plan/feature limits
  permissions/  - Role-based permissions
  events/       - EventBridge/SNS publishing
  validators/   - Zod schemas
  types/        - Shared TypeScript types
  logger/       - Structured logging
  idempotency/  - Idempotency key handling
  mcp/          - Model Context Protocol integration
infra/terraform/ - All AWS infrastructure except Lambdas
```

### Multi-Tenancy Model

**Data isolation**: Single database with `tenantId` foreign key on all tenant-scoped tables.

**Key tables** (from `packages/foundation/database/schema/`):
- `tenants` - Tenant metadata (name, slug, status)
- `users` - User accounts (cognitoId for auth)
- `memberships` - User ↔ Tenant many-to-many with role
- `roles` - Custom roles per tenant
- `subscriptions` - Billing plans per tenant
- `api_keys` - Tenant API keys
- `sessions` - User sessions (soft-deletable)

**Schema modules**: `auth.ts`, `tenancy.ts`, `authorization.ts`, `billing.ts`, `entitlements.ts`, `agents.ts`, `audit.ts`, `notifications.ts`, `integrations.ts`, `access.ts`

### API Middleware Chain

The Hono API (`apps/api/src/app.ts`) enforces this middleware order:

1. **authInjectionMiddleware** - Extract JWT claims from Authorization header
2. **userUpsertMiddleware** - Volca pattern: auto-create user on first API call
3. **apiKeyAuthMiddleware** - Alternative auth via API keys
4. **[Public routes]** - `/auth/*` (public), `/onboarding/*`
5. **tenantResolutionMiddleware** - Load tenant context from JWT `custom:tenantId`, enforce onboarding requirement
6. **sessionValidationMiddleware** - Verify active session exists
7. **entitlementsMiddleware** - Load plan limits (cached)
8. **permissionsMiddleware** - Load user permissions (cached)
9. **queryScopeMiddleware** - Inject tenant context for queries
10. **[Secure routes]** - All routes below this point require full auth

**Accessing context in routes:**
```typescript
const requestContext = c.get('requestContext');
const tenantId = requestContext.tenant.id;
const userId = requestContext.userId;
const permissions = requestContext.permissions;
```

### JWT Custom Claims (ADR-008)

The **Pre-Token Generation Lambda** (`apps/api/src/pretoken.ts`) stamps JWT claims on every Cognito login:
- `custom:tenantId` - Active tenant for this user
- `custom:role` - User's role within tenant
- `custom:plan` - Tenant's subscription plan

Empty `custom:tenantId` triggers onboarding flow (ADR-026).

### Caching Strategy (ADR-013)

Redis caches tenant context, permissions, and entitlements (TTL: 15 minutes). Invalidated via Redis Pub/Sub on critical changes.

**Cache key convention**: `{resource}:{id}:{subkey}` (e.g., `tenant:abc123:context`)

### Infrastructure Ownership

- **Terraform** (`infra/terraform/`) owns: API Gateway, Cognito, SQS, SNS, EventBridge, IAM, SSM parameters
- **SAM** (`template.yaml`) owns: Lambda functions only (reads IAM role ARNs from SSM)

Environment-specific config: `samconfig.{dev|staging|prod}.toml`

### Frontend Routing

Next.js App Router with tenant-based routing:
- `/[tenant]/*` - Tenant-scoped routes (dashboard, settings, etc.)
- `/auth/*` - Public auth routes (login, signup, invite)
- `/onboarding/*` - New user workspace creation

JWT token stored in `platform_token` cookie. Frontend decodes claims to get `tenantId`, `role`, `plan`.

## Code Patterns

### Route Implementation

Reference `apps/api/src/routes/auth.ts` for canonical patterns:
- Always scope queries with `WHERE tenantId = requestContext.tenant.id`
- Check permissions via `requestContext.permissions.has('resource:action')`
- Filter soft-deleted records (`deletedAt IS NULL`)
- Use structured error responses with error codes
- Return consistent JSON shape

### ADR References

Code includes inline ADR references (e.g., `ADR-008`, `ADR-013`, `ADR-024`, `ADR-026`). These document architectural decisions. Preserve them when editing.

### Reading Database Schema

**Before writing queries**, read schema files from `packages/foundation/database/schema/` to get exact column names and relations.

**Schema index**: `packages/foundation/database/schema/index.ts` exports all tables.

### Type Safety

- TypeScript strict mode enabled
- Drizzle provides end-to-end type safety (schema → queries → results)
- Zod for runtime validation (see `packages/foundation/validators/`)
- Always run `pnpm type-check` before committing

### Environment Variables

Lambdas read config from:
- SSM Parameter Store (Terraform-managed)
- AWS Secrets Manager (database URL, Redis credentials)
- Environment variables set in `template.yaml`

Local dev uses `.env` files (not checked in).

## Key Files

- `template.yaml` - SAM Lambda definitions
- `Makefile` - Lambda build targets (esbuild)
- `apps/api/src/app.ts` - API middleware stack
- `apps/api/src/pretoken.ts` - JWT claim stamping
- `packages/foundation/database/schema/` - Database schema
- `infra/terraform/` - Infrastructure as code

#
## Frontend Integration (apps/web)

### Current State
Next.js 15 App Router frontend is wired to the live backend. Basic dashboard pages are rendering with real data. `.env.local` exists at `apps/web/.env.local` (not committed — in `.gitignore`).

### Dev Server
```bash
# From repo root
pnpm --filter @serverless-saas/web dev
```

### Environment Variables (apps/web/.env.local)
```
NEXT_PUBLIC_API_URL=https://qh9a33hgbd.execute-api.ap-south-1.amazonaws.com
NEXT_PUBLIC_ROOT_DOMAIN=localhost:3000
NEXT_PUBLIC_COGNITO_USER_POOL_ID=ap-south-1_7ojsspkCU
NEXT_PUBLIC_COGNITO_CLIENT_ID=o8m606564m72f8uh2np6m0odl
```

### API Proxy Route
All frontend API calls go through `apps/web/app/api/proxy/[...path]/route.ts`.
This Next.js route handler forwards requests to the backend, attaching the `platform_token` httpOnly cookie as a Bearer token. Check this file for the exact `NEXT_PUBLIC_API_URL` usage before adding any new API calls.

### Auth Pattern
- JWT stored in `platform_token` httpOnly cookie only — never localStorage
- All API calls use `lib/api.ts` typed fetch wrapper — never raw fetch
- Cognito calls use direct fetch to `https://cognito-idp.ap-south-1.amazonaws.com/` with `X-Amz-Target` headers — no aws-amplify SDK
- Token refresh: read `platform_refresh_token` cookie server-side, call `refreshSession()` from `lib/auth.ts`, POST new idToken to `/api/auth/session`

### TenantContext
`apps/web/app/[tenant]/dashboard/layout.tsx` fetches `/auth/me` server-side and injects into context:
```typescript
{
  tenantId: string
  slug: string
  role: string
  plan: string
  permissions: string[]   // e.g. ["members:read", "api_keys:create", ...]
  needsOnboarding: boolean
}
```
Access via `useTenant()` hook in any client component.

### Permission Checks (client side — UX only)
```typescript
import { can } from '@/lib/permissions'
const { permissions } = useTenant()
if (can(permissions, 'members', 'create')) { ... }
```

### Onboarding Flow (needs building)
- Route: `apps/web/app/onboarding/page.tsx` — does not exist yet, returns 404
- User lands here when JWT `custom:tenantId` is empty (ADR-026)
- Form: single field — workspace name
- On submit: POST `/api/v1/onboarding/complete` with `{ workspaceName: string }`
- Backend returns: `{ tenantId, slug, message }`
- After success: call Cognito token refresh to get new JWT with tenantId stamped
- Token refresh payload:
  ```json
  {
    "AuthFlow": "REFRESH_TOKEN_AUTH",
    "AuthParameters": { "REFRESH_TOKEN": "<stored_refresh_token>" },
    "ClientId": "o8m606564m72f8uh2np6m0odl"
  }
  ```
  POST to `https://cognito-idp.ap-south-1.amazonaws.com/` with header `X-Amz-Target: AWSCognitoIdentityProviderService.InitiateAuth`
- After success: read `platform_refresh_token` cookie server-side, call `refreshSession(refreshToken)` from `lib/auth.ts`, POST new idToken to `/api/auth/session` to update `platform_token`, redirect to `/{slug}/dashboard`

### What's Working
- `/[tenant]/dashboard` — renders with real data
- Members page — real data
- Roles page — verify after dev server restart (system roles should appear)
- Billing page — real data (date fix applied)
- API Keys page — real data
- Audit log — real data
- Entitlements endpoint — wired

### What Needs Building (priority order)
1. **Onboarding page** — `/onboarding` (described above)
2. **Dashboard home** — overview widgets: member count, current plan badge, recent audit entries
3. **Write operations** — invite member, generate API key, create agent (review plan before running)

### Frontend Rules (always enforce)
- JWT in httpOnly cookie only — never localStorage or sessionStorage
- All API calls via `lib/api.ts` — never raw fetch
- All data fetching via TanStack Query — never useEffect for data fetching
- All forms via React Hook Form + Zod
- shadcn/ui components only
- Tenant context from `useTenant()` — never from URL params
- Client permission checks are UX only — API always enforces server-side
- Dark mode throughout
- No heavy chart libraries — simple data display only
# Claude Code Handoff — March 14, 2026

## Context
Frontend (`apps/web`) is wired to the live backend. Phase 1 integration testing is complete. Auth, tenant resolution, permissions, and most dashboard pages are working with real data.

Read `CLAUDE.md` first — it has the full project structure, middleware chain, and frontend rules. The section "Frontend Integration (apps/web)" at the bottom is the most relevant.

---

## Auth + Onboarding Files — Already Implemented

These files are written and type-checked. Do not rewrite them:

| File | Status |
|---|---|
| `apps/web/app/api/auth/session/route.ts` | ✅ Stores both `platform_token` and `platform_refresh_token` as httpOnly cookies |
| `apps/web/app/auth/login/page.tsx` | ✅ Passes `refreshToken` to session endpoint |
| `apps/web/app/onboarding/page.tsx` | ✅ Full onboarding flow — create tenant, refresh JWT, redirect |
| `apps/web/app/api/auth/refresh/route.ts` | ✅ Server-side token exchange — reads `platform_refresh_token` cookie, returns new idToken |

---

## What Was Fixed This Session

| Fix | File(s) touched |
|---|---|
| CORS misconfiguration | `apps/api/src/app.ts` (Hono cors middleware) |
| Routes using `c.get('tenantId')` instead of `requestContext` | Multiple route files |
| Permissions not in TenantContext | `apps/web/app/[tenant]/dashboard/layout.tsx` — now fetches `/auth/me` server-side |
| `audit_log:read` permission check failing | Fixed in layout permissions fetch |
| Entitlements route shape | `apps/api/src/routes/entitlements.ts` |
| Roles response key (`data` → `roles`) | `apps/api/src/routes/roles.ts` |
| Billing date formatting | `apps/web/app/[tenant]/dashboard/billing/page.tsx` |
| Members name fallback | `apps/web/app/[tenant]/dashboard/settings/members/page.tsx` |
| `.env.local` created | `apps/web/.env.local` (not committed) |

---

## Immediate Next Step — Verify Before Starting New Work

**Roles page** may not be rendering system roles yet. Before building anything new:
1. Restart dev server: `pnpm --filter @serverless-saas/web dev`
2. Navigate to `/{slug}/dashboard/settings/roles`
3. Confirm system roles (owner, admin, member) appear

If they don't appear, check the browser network tab — the issue will be in the API response shape or a missing permission.

---

## Task 1 — Onboarding Page (highest priority)

**What:** New users with no tenant land at `/onboarding`. This route currently returns 404.

**File to create:** `apps/web/app/onboarding/page.tsx`

**Flow:**
1. User arrives (JWT has empty `custom:tenantId` — see ADR-026)
2. Single form field: workspace name
3. Submit → `POST /api/v1/onboarding/complete` with `{ workspaceName: string }`
4. Backend returns `{ tenantId, slug, message }`
5. Trigger Cognito token refresh to get new JWT with tenantId stamped:
   ```
   POST https://cognito-idp.ap-south-1.amazonaws.com/
   X-Amz-Target: AWSCognitoIdentityProviderService.InitiateAuth
   Content-Type: application/x-amz-json-1.1

   {
     "AuthFlow": "REFRESH_TOKEN_AUTH",
     "AuthParameters": { "REFRESH_TOKEN": "<refresh_token>" },
     "ClientId": "o8m606564m72f8uh2np6m0odl"
   }
   ```
6. Set new `platform_token` httpOnly cookie via `POST /api/auth/session`
7. Redirect to `/{slug}/dashboard`

**Where the refresh token lives:** It should be stored at login time. Check `apps/web/app/api/auth/session/route.ts` and `lib/auth.ts` to confirm where the refresh token is persisted (likely a separate httpOnly cookie set at login). If it isn't being stored, that needs to be fixed first.

**Rules:** No aws-amplify. Direct fetch to Cognito only. Form via React Hook Form + Zod. Dark mode card layout matching `/auth/login`.

---

## Task 2 — Dashboard Home Overview

**File:** `apps/web/app/[tenant]/dashboard/page.tsx`

**What to show:**
- Current plan badge (from `useTenant().plan`)
- Member count — fetch `GET /api/v1/members` and show count
- Recent audit entries — fetch `GET /api/v1/audit` (last 5 entries)
- No charts — simple stat cards and a clean list

**Pattern:** Use TanStack Query for all data fetching. Reference the members page for the fetch pattern.

---

## Task 3 — Write Operations

Do these one at a time. Review the plan before approving each Antigravity/AI run.

**3a. Invite member**
- Location: members page (`/dashboard/settings/members`)
- `POST /api/v1/members/invite` with `{ email, roleId }`
- Get available roles from existing roles query for the dropdown
- Permission gate: only render invite button if `can(permissions, 'members', 'create')`

**3b. Generate API key**
- Location: API keys page (`/dashboard/api-keys`)
- `POST /api/v1/api-keys` with `{ name, type }`
- Show the raw key in a modal once — it will never be shown again
- Permission gate: `can(permissions, 'api_keys', 'create')`

**3c. Create agent**
- Location: agents page (`/dashboard/agents`)
- `POST /api/v1/agents` — check `apps/api/src/routes/agents.ts` for exact request body shape before building the form

---

## Key Facts for Claude Code

**Backend is live at:**
`https://qh9a33hgbd.execute-api.ap-south-1.amazonaws.com`

**All frontend API calls go through the proxy route:**
`apps/web/app/api/proxy/[...path]/route.ts`
Read this file before adding any new API calls to understand how it forwards requests.

**Auth/me response shape (confirmed working):**
```json
{
  "userId": "...",
  "tenantId": "...",
  "slug": "test-workspace",
  "status": "active",
  "permissions": ["members:create", "members:read", ...46 total],
  "needsOnboarding": false
}
```

**Permission string format:** `resource:action` with underscores for multi-word resources (e.g., `api_keys:create`, `audit_log:read`, `agent_workflows:read`)

**Do not commit `.env.local`** — already in `.gitignore`, but double-check before any git operations.

**Git workflow:** All changes to `develop` branch only. Never push to `main`.


Add to end of "Architecture" section:
markdown### Worker Lambda (apps/worker)

SQS consumer with router pattern:
```typescript
// apps/worker/src/router.ts
switch (body.type) {
  case 'notification.fire': return handleNotification(message);
  case 'webhook.deliver': return handleWebhookDelivery(message);
  case 'usage.record': return handleUsageRecord(message);
}
```

Handler files at `apps/worker/src/handlers/`.

### Async Patterns

Non-blocking operations use SQS:
- Usage recording → `usage.record`
- Webhook delivery → `webhook.deliver`
- Notifications → `notification.fire`

Fire from API routes:
```typescript
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';

const sqs = new SQSClient({});
await sqs.send(new SendMessageCommand({
  QueueUrl: process.env.SQS_PROCESSING_QUEUE_URL,
  MessageBody: JSON.stringify({ type: 'usage.record', ... })
}));
```
Update "What's Working" section:
markdown### What's Working
- All dashboard pages with real data ✅
- Members, Roles, Billing, API Keys, Audit log ✅
- Usage charts on billing page (frontend ready, backend in progress)
- WebSocket real-time notifications ✅
- Webhooks delivery ✅

## Auth Middleware — except() Pattern (March 24, 2026)

- `GET /auth/me` and `GET /auth/tenants` must bypass `sessionValidationMiddleware`
  (called before session exists at login time)
- Fix pattern:
```ts
  import { except } from 'hono/combine';
  api.use('*', except(['/auth/me', '/auth/tenants'], sessionValidationMiddleware));
```
- CRITICAL: paths in `except()` are RELATIVE to the router mount point.
  Since `api` is mounted at `/api/v1`, use `/auth/me` NOT `/api/v1/auth/me`
- These routes still run through `tenantResolutionMiddleware` + `permissionsMiddleware`
  as normal — only `sessionValidationMiddleware` is skipped

## NEXT_PUBLIC_API_URL — Local vs Lambda (March 24, 2026)

- Local dev:  `NEXT_PUBLIC_API_URL=http://localhost:3001`
  (requires `cd apps/api && pnpm dev` running separately)
- Lambda:     `NEXT_PUBLIC_API_URL=https://qh9a33hgbd.execute-api.ap-south-1.amazonaws.com`
- Default `.env.local` should point to Lambda unless actively developing the API locally
- `.env.local.example` must document both options with comments

## Agent Relay (March 25, 2026)
- GCP VM relay: `wss://agent-saas.fitnearn.com`
- Auth: Cognito Access Token via query param `?token=<access_token>`
- Protocol: OpenClaw (`delta`, `done`, `error`)
- Message Format: `{ message: '...' }` (plain object)
- Heartbeat: `{ type: 'ping' }` every 5 minutes

## RAG Architecture (v2 — April 7, 2026)

### Problem Fixed
Auto-injection was polluting every message with irrelevant chunks (score threshold was 0.1, should be 0.5). RAG now only runs when OpenClaw explicitly calls the retrieve_documents tool.

### New Pipeline (GCP VM relay only — no Mac/Lambda changes)
- Score threshold: 0.5 (was 0.1)
- Auto-injection: REMOVED
- Query rewriting: /opt/agent-relay/src/rag/queryRewrite.ts — resolves pronouns before search
- Relevance gate: /opt/agent-relay/src/rag/relevanceGate.ts — scores chunks 0-3, drops below 2
- Pipeline orchestration: /opt/agent-relay/src/rag/index.ts
- Gemini Flash helper: /opt/agent-relay/src/llm/quickCall.ts

### What Did NOT Change (Mac/Lambda — already working)
- Document ingestion worker (Worker Lambda)
- Chunking: 1000 chars, 200 overlap
- Vertex AI text-embedding-004, 768 dimensions
- pgvector on Neon
- Hybrid search + RRF in /internal/retrieve endpoint
- retrieve_documents OpenClaw plugin

### Flow
User message → Relay (no RAG injection) → OpenClaw → Gemini decides to call retrieve_documents → plugin → /internal/retrieve Lambda → hybrid search → relevance gate → citations back to agent

### Test Checklist
- Conversational message ("hi", "thanks") → no retrieve_documents call in logs
- Follow-up with pronoun ("what about it?") → query rewritten before search
- Document question → retrieve_documents called → answer with [1] [2] citations
- No relevant docs → agent says "I couldn't find this in your documents"
