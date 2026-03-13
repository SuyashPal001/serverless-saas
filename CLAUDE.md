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
