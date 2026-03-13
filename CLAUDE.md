# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

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