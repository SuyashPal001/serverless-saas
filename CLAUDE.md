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

### Onboarding Flow
- Route: `apps/web/app/onboarding/page.tsx` — implemented ✅
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

## Known Gaps — Not Fixed (April 14, 2026)

These are documented trade-offs, not bugs to fix now:

1. **`agentSkills.status` string vs enum** (`onboarding.ts`) — `status: 'active'` is passed as
   a plain string. Drizzle accepts it but won't catch enum drift at compile time. Low risk for MVP.

2. **`tenantResolutionMiddleware` assumes `requestContext.tenant` is set** — routes in
   `ONBOARDING_ALLOWED_PATHS` let requests through with only `{ needsOnboarding: true }` in
   context. Downstream middleware must not assume `requestContext.tenant` is always present.
   Verified safe for current middleware chain; re-check when adding new middleware.

3. **Session cookie set before `/auth/me` check in `login/page.tsx`** — if `/auth/me` fails
   after the session is written, `platform_token` cookie is already set. A page refresh after
   the error could auto-authenticate the user into an unknown state. Acceptable UX edge case for now.

## Onboarding Flow — New User Login (April 14, 2026)

### Problem fixed
Email/password new users were hitting 403 on `GET /auth/tenants` because
`tenantResolutionMiddleware` blocked the route for users with an empty JWT
`custom:tenantId`. The login page then surfaced this as "Invalid email or password".

### ONBOARDING_ALLOWED_PATHS (`apps/api/src/middleware/tenantResolution.ts`)
Routes accessible before onboarding completes (empty `custom:tenantId`):
```
/api/v1/onboarding/complete
/api/v1/auth/me
/api/v1/auth/tenants      ← added April 14 (queries by userId, safe without tenantId)
/api/v1/auth/check-email
/api/v1/widget
```
**Rule:** A route belongs here if it queries by `userId` (not `tenantId`) and returns
safe data when the user has no tenant. Never add tenant-scoped data routes.

### Correct login flow for new users (email + Google OAuth)
Both flows must follow this order:
1. Get tokens (Cognito signIn or OAuth code exchange)
2. `POST /api/auth/session` — set httpOnly cookie **first**
3. `GET /auth/me` — check `needsOnboarding` and `slug`
4. If `needsOnboarding === true` OR `!slug` → `router.push('/onboarding')` and return
5. Otherwise → `GET /auth/tenants` → workspace picker or direct dashboard redirect

**Never call `/auth/tenants` before `/auth/me` for a potentially new user.**
The Google OAuth callback (`apps/web/app/auth/callback/page.tsx`) already follows
this pattern correctly. The email login page was fixed to match.

### Onboarding page flow (`apps/web/app/onboarding/page.tsx`)
1. User submits workspace name
2. `POST /api/v1/onboarding/complete` → creates tenant + default Saarthi agent
3. `DELETE /api/auth/session` — clears JWT (Pre Token Lambda only runs on fresh login)
4. Redirect to `/auth/login?onboarded=true&slug={slug}`
5. User logs in again → Pre Token Lambda stamps `custom:tenantId` → normal flow

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

## OAuth Integration Pattern (April 2026)

### Architecture
Each third-party connector is a separate OAuth flow with its own provider row in the `integrations` table. Privacy-first: one row per service, minimal scopes.

### Files to touch for every new connector
| File | What to add |
|---|---|
| `apps/api/src/routes/integrations.ts` | `POST /{provider}/connect` route + `GET /{provider}/callback` export |
| `apps/api/src/app.ts` | Import callback route + `publicApi.route('/integrations', ...)` |
| `template.yaml` | `CLIENT_ID`, `CLIENT_SECRET`, `REDIRECT_URI` env vars (×2 Lambda functions) |
| `infra/terraform/foundation/main.tf` | `aws_secretsmanager_secret`, `aws_ssm_parameter` redirect URI, public callback route |
| `infra/terraform/foundation/variables.tf` | `var.{provider}_redirect_uri` |
| `apps/web/app/[tenant]/dashboard/integrations/page.tsx` | Icon component, `CONNECT_URLS`, `CONNECTED_NAMES`, CATALOGUE card |

### Backend connect route pattern
```typescript
integrationsRoutes.post('/{provider}/connect', async (c) => {
    // 1. permission check — integrations:create
    // 2. read CLIENT_ID + REDIRECT_URI from env
    // 3. query tenants table for slug (for post-auth redirect)
    // 4. build state: { tenantId, userId, slug, service: 'provider_name', ts: Date.now() }
    // 5. base64-encode state
    // 6. build OAuth URL with URLSearchParams
    // 7. return c.json({ url })
});
```

### Backend callback route pattern
```typescript
export const {provider}OAuthCallbackRoute = new Hono<AppEnv>();
{provider}OAuthCallbackRoute.get('/{provider}/callback', async (c) => {
    // 1. decode & validate state (10-min window via ts)
    // 2. exchange code for tokens at provider token URL
    // 3. check access_token + refresh_token present
    // 4. encryptCredentials({ accessToken, refreshToken, expiresAt }, tenantId)
    // 5. upsert into integrations: provider=service, permissions=[permission], status='active'
    // 6. c.redirect(`${frontendUrl}/${slug}/dashboard/integrations?connected=${service}`)
});
```

### Credentials storage
- Encrypted with AES-256-GCM via `encryptCredentials()` — key derived per-tenant using scrypt
- Stored in `integrations.credentials_enc` — never plaintext
- Object shape: `{ accessToken, refreshToken, expiresAt }` (expiresAt = Unix ms timestamp)

### Provider-specific notes
| Provider | Auth URL | Token URL | Scope format | Body format | Notes |
|---|---|---|---|---|---|
| Google | `accounts.google.com/o/oauth2/v2/auth` | `oauth2.googleapis.com/token` | space-separated | form-encoded | `access_type=offline`, `prompt=consent` |
| Zoho | `accounts.zoho.in/oauth/v2/auth` | `accounts.zoho.in/oauth/v2/token` | comma-separated | form-encoded | India DC (`.in` not `.com`) |
| Atlassian/Jira | `auth.atlassian.com/authorize` | `auth.atlassian.com/oauth/token` | space-separated | **JSON** | Requires `audience=api.atlassian.com`; refresh token via `offline_access` scope (not `access_type`) |

### Terraform secret pattern
```hcl
# Secret (value set manually in AWS console)
resource "aws_secretsmanager_secret" "{provider}_oauth" {
  name        = "${var.project}/${var.environment}/{provider}-oauth"
  description = "OAuth client credentials for {Provider} integration"
}

# Redirect URI SSM param (value from tfvars)
resource "aws_ssm_parameter" "{provider}_redirect_uri" {
  name  = "${local.ssm_prefix}/{provider}-redirect-uri"
  type  = "String"
  value = var.{provider}_redirect_uri
}
```

### template.yaml env var pattern
```yaml
# Credentials from Secrets Manager (inline JSON — only for small secrets)
{PROVIDER}_CLIENT_ID: !Sub "{{resolve:secretsmanager:${ProjectName}/${EnvironmentName}/{provider}-oauth:SecretString:client_id}}"
{PROVIDER}_CLIENT_SECRET: !Sub "{{resolve:secretsmanager:${ProjectName}/${EnvironmentName}/{provider}-oauth:SecretString:client_secret}}"
# Redirect URI from SSM
{PROVIDER}_REDIRECT_URI: !Sub "{{resolve:ssm:/${ProjectName}/${EnvironmentName}/{provider}-redirect-uri}}"
```

### GCP_SA_KEY — do NOT inline in env vars
The GCP service account key JSON is too large for Lambda env vars (4KB limit).
Store as ARN only; read at runtime via `getGcpCredentials()` in `packages/foundation/ai/src/gcp-credentials.ts`.
```yaml
GCP_SA_KEY_SECRET_ARN: !Sub "arn:aws:secretsmanager:${AWS::Region}:${AWS::AccountId}:secret:${ProjectName}/${EnvironmentName}/gcp-sa-key"
```

### Frontend card pattern
```typescript
// CONNECT_URLS — maps provider string to backend endpoint
const CONNECT_URLS: Record<string, string> = {
    provider_name: '/api/v1/integrations/{route}/connect',
};

// CONNECTED_NAMES — maps provider string to display name for toast
const CONNECTED_NAMES: Record<string, string> = {
    provider_name: 'Display Name',
};

// CATALOGUE entry
{
    provider: 'provider_name',
    name: 'Display Name',
    description: 'One line description',
    scopes: ['Pill1', 'Pill2'],
    icon: <ProviderIcon className="w-8 h-8" />,
    available: true,
}
```

### Connected integrations — currently live
| Provider | `provider` value | `permissions` | Connect route |
|---|---|---|---|
| Gmail | `gmail` | `['gmail']` | `POST /google/gmail/connect` |
| Google Drive | `drive` | `['drive']` | `POST /google/drive/connect` |
| Google Calendar | `calendar` | `['calendar']` | `POST /google/calendar/connect` |
| Zoho CRM | `zoho_crm` | `['crm']` | `POST /zoho/crm/connect` |
| Zoho Mail | `zoho_mail` | `['mail']` | `POST /zoho/mail/connect` |
| Zoho Cliq | `zoho_cliq` | `['cliq']` | `POST /zoho/cliq/connect` |
| Jira | `jira` | `['jira']` | `POST /jira/connect` |

## Mutation Endpoint Reference (verified April 14, 2026)

**Read this table before writing any frontend mutation.** Every row was cross-referenced between the backend route file and the frontend component. Method or path wrong on either side = 404 or 405 at runtime.

All backend paths are full paths including the `/api/v1` prefix.

| Operation | Method | Backend Path | Frontend File | Notes |
|---|---|---|---|---|
| Login | POST | `/api/v1/auth/login` | `app/auth/login/page.tsx` | ✅ |
| Logout | POST | `/api/v1/auth/logout` | `app/auth/login/page.tsx` | ✅ |
| Switch tenant | POST | `/api/v1/auth/switch-tenant` | `app/auth/login/page.tsx` | ✅ |
| Set pending tenant | POST | `/api/v1/auth/set-pending-tenant` | `app/api/auth/refresh/route.ts` | ✅ internal only |
| Complete onboarding | POST | `/api/v1/onboarding/complete` | `app/onboarding/page.tsx` | ✅ |
| Accept invitation | POST | `/api/v1/invitations/:token/accept` | `app/auth/invite/[token]/page.tsx` | ✅ |
| Change plan | POST | `/api/v1/billing/subscription` | `billing/PlanSelectorDialog.tsx` | ✅ triggers token refresh + reload |
| Cancel subscription | POST | `/api/v1/billing/cancel` | `billing/CancelSubscriptionAction.tsx` | ✅ no request body needed |
| Create API key | POST | `/api/v1/api-keys` | `api-keys/CreateApiKeyForm.tsx` | ✅ |
| Revoke API key | DELETE | `/api/v1/api-keys/:id` | `api-keys/RevokeApiKeyAction.tsx` | ✅ soft-revoke (sets status='revoked') |
| Delete API key | DELETE | `/api/v1/api-keys/:id` | `api-keys/DeleteApiKeyAction.tsx` | ✅ same backend op as revoke — copy says "permanent" but backend is identical |
| Invite member | POST | `/api/v1/members/invite` | `members/InviteMemberForm.tsx` | ✅ |
| Update member role | PATCH | `/api/v1/members/:id/role` | `members/MembersList.tsx` | ✅ |
| Update member status | PATCH | `/api/v1/members/:id/status` | `members/MembersList.tsx` | ✅ |
| Delete member | DELETE | `/api/v1/members/:id` | `members/MembersList.tsx` | ✅ |
| Create role | POST | `/api/v1/roles` | `roles/CreateRoleForm.tsx` | ✅ |
| Update role | PATCH | `/api/v1/roles/:id` | — | ⚠️ backend exists, no frontend yet |
| Delete role | DELETE | `/api/v1/roles/:id` | `roles/DeleteRoleAction.tsx` | ✅ |
| Create agent | POST | `/api/v1/agents` | `agents/CreateAgentForm.tsx` | ✅ |
| Update agent | PATCH | `/api/v1/agents/:id` | — | ⚠️ backend exists, no frontend yet |
| Delete agent | DELETE | `/api/v1/agents/:id` | — | ⚠️ backend exists, no frontend yet |
| Create agent skill | POST | `/api/v1/agents/:agentId/skills` | — | ⚠️ backend exists, no frontend yet |
| Update agent skill | PUT | `/api/v1/agents/:agentId/skills/:skillId` | — | ⚠️ backend exists, no frontend yet |
| Delete agent skill | DELETE | `/api/v1/agents/:agentId/skills/:skillId` | — | ⚠️ backend exists, no frontend yet |
| Upsert agent policy | PUT | `/api/v1/agents/:agentId/policies` | — | ⚠️ backend exists, no frontend yet |
| Create webhook | POST | `/api/v1/webhooks` | `webhooks/CreateWebhookModal.tsx` | ✅ |
| Update webhook | PATCH | `/api/v1/webhooks/:id` | `webhooks/WebhookPanel.tsx` | ✅ |
| Delete webhook | DELETE | `/api/v1/webhooks/:id` | `webhooks/WebhookPanel.tsx` | ✅ |
| Connect integration (OAuth) | POST | `/api/v1/integrations/{provider}/connect` | `integrations/IntegrationsGrid.tsx` | ✅ returns `{ url }` for redirect |
| Update integration | PATCH | `/api/v1/integrations/:id` | `integrations/IntegrationPanel.tsx` | ✅ |
| Delete integration | DELETE | `/api/v1/integrations/:idOrProvider` | `integrations/IntegrationPanel.tsx` | ✅ |
| Upload file (get URL) | POST | `/api/v1/files/upload` | `files/UploadFileModal.tsx` | ✅ returns presigned S3 URL |
| Confirm file upload | POST | `/api/v1/files/:id/confirm` | `files/UploadFileModal.tsx` | ✅ call after S3 PUT completes |
| Delete file | DELETE | `/api/v1/files/:id` | `files/FilesList.tsx` | ✅ |
| Upload document (get URL) | POST | `/api/v1/documents/upload-url` | `dashboard/chat/page.tsx` | ✅ |
| Create document record | POST | `/api/v1/documents` | `dashboard/chat/page.tsx` | ✅ |
| Delete document | DELETE | `/api/v1/documents/:id` | `dashboard/chat/page.tsx` | ✅ |
| Message feedback | POST | `/api/v1/conversations/:cId/messages/:mId/feedback` | `dashboard/chat/page.tsx` | ✅ |
| Mark notification read | PATCH | `/api/v1/notifications/inbox/:id/read` | `dashboard/notifications/page.tsx` | ✅ |
| Mark all notifications read | POST | `/api/v1/notifications/inbox/read-all` | `dashboard/notifications/page.tsx` | ✅ |
| Archive notification | PATCH | `/api/v1/notifications/inbox/:id/archive` | `dashboard/notifications/page.tsx` | ✅ |
| Upsert notification prefs | PUT | `/api/v1/notifications/preferences` | `dashboard/notifications/page.tsx` | ✅ |
| Update branding | PATCH | `/api/v1/branding` | `dashboard/branding/page.tsx` | ✅ |
| Suspend/reactivate tenant (ops) | PATCH | `/api/v1/ops/tenants/:id` | `dashboard/ops/tenants/page.tsx` | ✅ |
| Grant feature override (ops) | POST | `/api/v1/ops/overrides` | `dashboard/ops/overrides/page.tsx` | ✅ |
| Revoke feature override (ops) | POST | `/api/v1/ops/overrides/:id/revoke` | `dashboard/ops/overrides/page.tsx` | ✅ |

### Known gaps — billing status filter

`GET /billing/subscription` and `GET /billing/plan` filter `status = 'active'` only. Tenants with `status = 'trialing'` subscriptions will get `null` back and the billing page renders blank. The Pre-Token Lambda correctly handles `active OR trialing` — the billing read routes do not. Fix before adding trial flows.
