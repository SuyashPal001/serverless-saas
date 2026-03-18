# GEMINI.md

This file provides guidance to Gemini CLI when working with code in this repository.

## Project Overview

**serverless-saas** ("Feature Zero") — a product-agnostic, multi-tenant SaaS foundation platform. The goal is a reusable infrastructure layer covering identity, multi-tenancy, billing, RBAC, notifications, audit, and AI agent management.

**Key Technologies:**
- **Backend**: Hono on AWS Lambda, Drizzle ORM, Neon PostgreSQL, Upstash Redis
- **Frontend**: Next.js 15 (App Router), React 19, Tailwind CSS, shadcn/ui
- **Infrastructure**: Terraform (infra), AWS SAM (Lambda deployment)
- **Auth**: AWS Cognito with Google OAuth federation, custom JWT claims
- **Build**: pnpm workspaces, esbuild

**North star references**: Chatwoot (real-time/WebSocket), Cal.com, Formbricks, Twenty

---

## Critical Rules — Never Violate

### Database
- **NEVER use `db.transaction()`** with Neon HTTP driver — it causes failures
- Always use direct imports for schema files, not barrel imports (esbuild tree-shaking issue)

### Environment Variables
- `aws lambda update-function-configuration --environment` **REPLACES the entire env object** — always include all existing vars
- Always `.trim()` env vars used in URL construction (invisible whitespace causes `%20` bugs)

### Hono Middleware
- Routes registered BEFORE `api.use('*', middleware)` bypass the middleware chain entirely
- Any route needing `userId` must be registered AFTER `authInjectionMiddleware` and `userUpsertMiddleware`

### Permissions
- Permission strings use **underscores**: `api_keys`, `audit_log`, `agent_workflows`, `agent_runs`
- Never use hyphens — they silently fail with "permission not found"

### Entitlements
- Use **UUID lookup pattern** (featureId from DB), not string key access
- `requestContext.entitlements.agents` is always undefined — must lookup by feature UUID

### Upstash Redis
- Upstash REST client **auto-deserializes JSON** on `get`
- Always guard: `typeof cached === 'string' ? JSON.parse(cached) : cached`
- Cache shape must wrap tenant context: `{ tenant: { id, slug, status } }` — not flat

### Auth
- OAuth callback: use `/api/v1/auth/me` to get tenant slug, not JWT decoding (no `custom:tenantSlug` claim exists)
- `userUpsert` middleware: on `23505` unique constraint error (same email, different Cognito ID), fall back to updating existing row by email
- Pre Token Lambda only fires on full `InitiateAuth` with `USER_PASSWORD_AUTH`, not on refresh token flows

### Git Workflow
- All work branches to `develop` — **never push directly to `main`**
- `main` updated only via PR or explicit merge from `develop` after confirmation
- Use `git add -A` (not individual files)

### SAM Deploys
- Always `rm -rf .aws-sam` before every deploy — SAM hash invalidation is unreliable
- If still not picking up changes: `echo "// force rebuild $(date +%s)" >> apps/api/src/index.ts`
- Run from repo root: `rm -rf .aws-sam && sam build --config-file samconfig.dev.toml && sam deploy --config-file samconfig.dev.toml`

### Code Changes
- **Do not commit without explicit confirmation** — show diffs and wait
- Verify file contents with `sed -n '50,90p'` rather than trusting agent confirmation
- Identify all issues before fixing; batch fixes by concern
- One step at a time on complex features

---

## Commands

### Development
```bash
pnpm install
pnpm build
pnpm type-check
pnpm lint

# Frontend
cd apps/web && pnpm dev

# API locally
cd apps/api && pnpm dev
```

### Database (requires explicit DATABASE_URL)
```bash
# Seed
DATABASE_URL=$(aws secretsmanager get-secret-value --secret-id serverless-saas/dev/database --region ap-south-1 --query SecretString --output text | node -e "process.stdout.write(JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')).url)") pnpm --filter @serverless-saas/database db:seed

# Migrate
DATABASE_URL=$(aws secretsmanager get-secret-value --secret-id serverless-saas/dev/database --region ap-south-1 --query SecretString --output text | node -e "process.stdout.write(JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')).url)") pnpm --filter @serverless-saas/database db:migrate
```

### Terraform
```bash
cd infra/terraform/foundation && terraform plan -var-file="../environments/dev/terraform.tfvars"
```

### CloudWatch Logs
```bash
# Never use subshell for stream name ($LATEST breaks shell expansion)
aws logs tail /aws/lambda/serverless-saas-foundation-api-dev --since 2m --region ap-south-1
```

---

## Architecture

### Monorepo Structure
```
apps/
  api/          - Hono API (Lambdalith pattern)
  web/          - Next.js frontend
  worker/       - SQS consumer Lambda
packages/foundation/
  database/     - Drizzle schema, migrations, client
  auth/         - JWT validation, Cognito client
  cache/        - Redis wrapper
  entitlements/ - Plan/feature limits
  permissions/  - Role-based permissions
  notifications/- Workflows, delivery, preferences, inbox
  events/       - Event registry
  validators/   - Zod schemas
  types/        - Shared TypeScript types
  logger/       - Structured logging, PII masking
  idempotency/  - Idempotency key handling
infra/terraform/foundation/ - All AWS infrastructure except Lambdas
```

### Key File Paths
| Purpose | Path |
|---|---|
| SAM template | `template.yaml` (repo root) |
| Hono app | `apps/api/src/app.ts` |
| Lambda handler | `apps/api/src/index.ts` |
| Routes | `apps/api/src/routes/` |
| Middleware | `apps/api/src/middleware/` |
| Drizzle client | `packages/foundation/database/client.ts` |
| Schema | `packages/foundation/database/schema/index.ts` |
| Seeds | `packages/foundation/database/seeds/` |

### API Middleware Chain (order matters)
1. `authInjectionMiddleware` — Extract JWT claims
2. `userUpsertMiddleware` — Auto-create user on first API call
3. `apiKeyAuthMiddleware` — Alternative auth via API keys
4. **[Public routes]** — `/auth/*`, `/invitations/*` (public only)
5. **[After upsert routes]** — `/onboarding/*`, `/invitations/:token/accept`
6. `tenantResolutionMiddleware` — Load tenant context, enforce onboarding
7. `sessionValidationMiddleware` — Verify active session
8. `entitlementsMiddleware` — Load plan limits (cached)
9. `permissionsMiddleware` — Load user permissions (cached)
10. `queryScopeMiddleware` — Inject tenant context for queries
11. **[Secure routes]** — All remaining routes

### JWT Custom Claims (Pre Token Lambda)
- `custom:tenantId` — UUID or empty string (empty = needs onboarding)
- `custom:role` — role name or empty string
- `custom:plan` — plan name or `"free"`

### Cache Keys
```
tenant:{tenantId}:context              → { tenant: { id, slug, status } }
tenant:{tenantId}:user:{userId}:perms  → permission set
session:blacklist:{jti}                → invalidated JWT IDs
```

---

## Infrastructure Values (Dev)

| Resource | Value |
|---|---|
| API Gateway | `https://qh9a33hgbd.execute-api.ap-south-1.amazonaws.com` |
| Cognito Pool | `ap-south-1_7ojsspkCU` |
| Cognito Client ID | `o8m606564m72f8uh2np6m0odl` |
| Worker Lambda | `serverless-saas-foundation-worker-dev` |
| SQS Queue | `serverless-saas-processing-dev` |
| Test Tenant | `24ed421c-efd2-410a-9c8b-b76621213a07` |
| Test Workflow | `f44b6e8c-054b-40ba-9ad1-986ec011b5d8` |
| SES Domain | `mail.saas.fitnearn.com` |
| FROM Email | `mail@mail.saas.fitnearn.com` |

### Secrets Manager Keys
- `serverless-saas/dev/database` → `{ url }`
- `serverless-saas/dev/cache` → `{ url, token }`
- `serverless-saas/dev/google-oauth`
- `serverless-saas/dev/gcp-sa-key`

### SSM Parameters
- `/serverless-saas/dev/ses/from-email`
- `/serverless-saas/dev/ses/domain-identity-arn`
- `/serverless-saas/dev/ws-token-secret` (WebSocket token signing — Step 6)

---

## Current State

### Completed
- Steps 1–3: SES setup, Google OAuth/Cognito federation, invite flow ✅
- Step 5: Worker Lambda (SQS consumer, job processor, delivery tracking) + notification API routes (8 routes) ✅
- Full auth flow, onboarding, billing, RBAC, audit log, agents, API keys, members, roles ✅
- Frontend dashboard: all 11 pages built and passing TypeScript build ✅

### In Progress — Step 6: Real-time WebSocket Inbox

**Architecture finalized:**
- Short-lived WS token: 5-minute JWT, separate from main auth JWT
- New endpoint: `GET /api/v1/auth/ws-token`
- Token signing: `jose` library (already present via `authInjection.ts`)
- Token secret: SSM SecureString at `/serverless-saas/dev/ws-token-secret` (256-bit random key)
- SSM fetched once per cold start, cached in Lambda memory
- Connection storage: Redis Set per user+tenant, multiple `connectionId`s, 24-hour TTL
- Client-side ping every 5 minutes to prevent API Gateway's 10-minute idle disconnect

**Implementation order:**
1. WS token endpoint ← **current step**
2. Terraform WebSocket API
3. Connection Lambda
4. Worker push logic
5. Frontend hook

### Pending
- Bruno collections for notification routes (Step 5b)
- Step 4: Dashboard home (pure frontend — parked until after Step 6)

### Parked Items
- Debug log in `agents.ts`
- Retire 8 stale test agents
- Audit log entitlement gating
- SSO/SAML
- Verbose JWKS logging cleanup in `authInjection.ts`
- Tenant switching design

---

## Frontend Integration (apps/web)

### Environment Variables (.env.local)
```
NEXT_PUBLIC_API_URL=https://qh9a33hgbd.execute-api.ap-south-1.amazonaws.com
NEXT_PUBLIC_ROOT_DOMAIN=localhost:3000
NEXT_PUBLIC_COGNITO_USER_POOL_ID=ap-south-1_7ojsspkCU
NEXT_PUBLIC_COGNITO_CLIENT_ID=o8m606564m72f8uh2np6m0odl
NEXT_PUBLIC_COGNITO_DOMAIN=<cognito-domain>
NEXT_PUBLIC_COGNITO_CALLBACK_URL=http://localhost:3000/auth/callback
```

### Key Patterns
- JWT stored in `platform_token` httpOnly cookie only — **never localStorage**
- All API calls via `lib/api.ts` — never raw fetch
- All data fetching via TanStack Query — never useEffect
- All forms via React Hook Form + Zod
- shadcn/ui components only
- Tenant context from `useTenant()` — never from URL params
- Client permission checks are UX only — API always enforces

### Auth Flow
- Login → Cognito → JWT in httpOnly cookie
- Google OAuth → Cognito hosted UI → callback → cookie
- Token refresh: server-side via `/api/auth/refresh` route
- Onboarding: empty `custom:tenantId` → `/onboarding` → create workspace → refresh JWT → redirect

---

## Testing

### Bruno (API Testing)
- Dev environment variables: `baseUrl`, `tenantId`, `userId`, tokens
- Use `bru.setEnvVar` (not `bru.setVar`) for persistent environment variables
- Collections at: `bruno/` directory

### Verifying Changes
- Always verify file contents with `sed -n 'start,end p' filepath`
- Check actual file state before confirming agent changes
- Run `pnpm type-check` before any deploy

---

## Working Style

1. Verify assumptions with actual file/DB checks before acting
2. Exhaust available context before asking for command output
3. Identify all issues before fixing; batch fixes by concern
4. One step at a time on complex features
5. Show diffs and wait for confirmation before committing

---

## Code Patterns & Templates

### Route Handler Template

```typescript
import { Hono } from 'hono';
import { z } from 'zod';
import { db } from '@serverless-saas/database';
import { eq, and, isNull } from 'drizzle-orm';
import { tableName } from '@serverless-saas/database/schema/module';
import type { AppEnv } from '../types';

const exampleRoutes = new Hono<AppEnv>();

// GET — List resources
exampleRoutes.get('/', async (c) => {
  // 1. Get context
  const requestContext = c.get('requestContext') as any;
  const tenantId = requestContext?.tenant?.id;
  const permissions = requestContext?.permissions ?? [];

  // 2. Permission check
  if (!permissions.includes('resource:read')) {
    return c.json({ error: 'Forbidden', code: 'INSUFFICIENT_PERMISSIONS' }, 403);
  }

  // 3. Query with tenant scope + soft delete filter
  try {
    const items = await db.query.tableName.findMany({
      where: and(
        eq(tableName.tenantId, tenantId),
        isNull(tableName.deletedAt)
      ),
    });

    return c.json({ data: items });
  } catch (error) {
    console.error('Query failed:', error);
    return c.json({ error: 'Internal error', code: 'INTERNAL_ERROR' }, 500);
  }
});

// POST — Create resource
exampleRoutes.post('/', async (c) => {
  const requestContext = c.get('requestContext') as any;
  const tenantId = requestContext?.tenant?.id;
  const userId = requestContext?.userId;
  const permissions = requestContext?.permissions ?? [];

  if (!permissions.includes('resource:create')) {
    return c.json({ error: 'Forbidden', code: 'INSUFFICIENT_PERMISSIONS' }, 403);
  }

  // Validate body with Zod
  const schema = z.object({
    name: z.string().min(1).max(255),
  });

  const body = await c.req.json();
  const parsed = schema.safeParse(body);

  if (!parsed.success) {
    return c.json({ 
      error: 'Validation failed', 
      code: 'VALIDATION_ERROR',
      details: parsed.error.flatten() 
    }, 400);
  }

  try {
    const [created] = await db.insert(tableName).values({
      tenantId,
      createdBy: userId,
      ...parsed.data,
    }).returning();

    return c.json({ data: created }, 201);
  } catch (error) {
    console.error('Insert failed:', error);
    return c.json({ error: 'Internal error', code: 'INTERNAL_ERROR' }, 500);
  }
});

// PATCH — Update resource (partial)
exampleRoutes.patch('/:id', async (c) => {
  const requestContext = c.get('requestContext') as any;
  const tenantId = requestContext?.tenant?.id;
  const permissions = requestContext?.permissions ?? [];
  const { id } = c.req.param();

  if (!permissions.includes('resource:update')) {
    return c.json({ error: 'Forbidden', code: 'INSUFFICIENT_PERMISSIONS' }, 403);
  }

  // Verify resource belongs to tenant before updating
  const existing = await db.query.tableName.findFirst({
    where: and(
      eq(tableName.id, id),
      eq(tableName.tenantId, tenantId),
      isNull(tableName.deletedAt)
    ),
  });

  if (!existing) {
    return c.json({ error: 'Not found', code: 'NOT_FOUND' }, 404);
  }

  // ... validate and update
});

// DELETE — Soft delete
exampleRoutes.delete('/:id', async (c) => {
  const requestContext = c.get('requestContext') as any;
  const tenantId = requestContext?.tenant?.id;
  const permissions = requestContext?.permissions ?? [];
  const { id } = c.req.param();

  if (!permissions.includes('resource:delete')) {
    return c.json({ error: 'Forbidden', code: 'INSUFFICIENT_PERMISSIONS' }, 403);
  }

  // Soft delete — set deletedAt, don't actually delete
  await db.update(tableName)
    .set({ deletedAt: new Date() })
    .where(and(
      eq(tableName.id, id),
      eq(tableName.tenantId, tenantId)
    ));

  return c.json({ success: true });
});

export { exampleRoutes };
```

### Permission Strings
Format: `resource:action`

| Resource | Actions |
|---|---|
| `members` | `create`, `read`, `update`, `delete` |
| `roles` | `create`, `read`, `update`, `delete` |
| `api_keys` | `create`, `read`, `delete` |
| `agents` | `create`, `read`, `update`, `delete` |
| `agent_workflows` | `create`, `read`, `update`, `delete` |
| `agent_runs` | `read` |
| `audit_log` | `read` |
| `billing` | `read`, `update` |
| `notifications` | `read`, `update` |
| `tenants` | `read`, `update` |

### Response Shapes

**Success (list):**
```json
{ "data": [...] }
```

**Success (single):**
```json
{ "data": { ... } }
```

**Success (create):**
```json
{ "data": { ... } }  // 201 status
```

**Error:**
```json
{
  "error": "Human readable message",
  "code": "MACHINE_READABLE_CODE",
  "details": { ... }  // optional, for validation errors
}
```

**Error codes:**
- `INSUFFICIENT_PERMISSIONS` — 403
- `VALIDATION_ERROR` — 400
- `NOT_FOUND` — 404
- `CONFLICT` — 409 (duplicate, already exists)
- `INTERNAL_ERROR` — 500
- `ONBOARDING_REQUIRED` — 403 (special case)

### Entitlement Check Pattern

```typescript
// Feature gating (boolean features like custom_roles)
const entitlements = requestContext?.entitlements ?? {};

// WRONG — string key access doesn't work
const canUse = entitlements['custom_roles']?.enabled;  // ❌

// RIGHT — lookup feature by UUID from database
const feature = await db.query.features.findFirst({
  where: eq(features.key, 'custom_roles')
});
if (feature) {
  const entitlement = entitlements[feature.id];
  if (!entitlement?.enabled) {
    return c.json({ error: 'Feature not available', code: 'FEATURE_DISABLED' }, 403);
  }
}
```

### Drizzle Query Patterns

```typescript
// NULL check — use isNull(), not eq(column, null)
isNull(users.deletedAt)  // ✅
eq(users.deletedAt, null)  // ❌ type error

// Multiple conditions
and(
  eq(table.tenantId, tenantId),
  eq(table.status, 'active'),
  isNull(table.deletedAt)
)

// With relations
await db.query.memberships.findMany({
  where: eq(memberships.tenantId, tenantId),
  with: {
    user: {
      columns: { id: true, email: true, name: true }
    },
    role: {
      columns: { id: true, name: true }
    }
  }
});
```

### Middleware Context Access

```typescript
// Get full request context
const requestContext = c.get('requestContext') as any;

// Available fields after middleware chain
requestContext.tenant.id        // UUID
requestContext.tenant.slug      // string
requestContext.tenant.status    // 'active' | 'suspended' | 'deleted'
requestContext.userId           // UUID
requestContext.permissions      // string[] e.g. ['members:read', 'members:create']
requestContext.entitlements     // Record<featureId, { enabled, limit, ... }>
requestContext.needsOnboarding  // boolean

// For routes registered before full middleware
const jwtPayload = c.get('jwtPayload');  // raw JWT claims
const userId = c.get('userId');          // after userUpsert
```

### Wiring Routes in app.ts

```typescript
// In apps/api/src/app.ts

// Import the route
import { exampleRoutes } from './routes/example';

// Wire it (after middleware chain for protected routes)
api.route('/example', exampleRoutes);
```

### Import Conventions

```typescript
// Database client
import { db } from '@serverless-saas/database';

// Schema — use direct imports, not barrel
import { users } from '@serverless-saas/database/schema/auth';
import { memberships, tenants } from '@serverless-saas/database/schema/tenancy';
import { roles, permissions } from '@serverless-saas/database/schema/authorization';

// Drizzle operators
import { eq, and, or, isNull, desc, asc, sql } from 'drizzle-orm';

// Zod
import { z } from 'zod';
```