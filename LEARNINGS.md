# Learnings

Lessons learned during development. Add new entries as they come up.

---

## 1. executionCtx.waitUntil() is Cloudflare Workers only

Not available in Lambda. Use direct `await` instead.

---

## 2. Drizzle db:migrate can silently skip SQL on journal conflict

`db:migrate` may report success but not actually apply SQL if there is a journal conflict. Always verify tables exist after migration by querying the Neon driver directly.

---

## 3. SAM esbuild hash invalidation — force rebuild

If `sam deploy` reports "No changes to deploy" despite real changes, esbuild hashes are stale. Force a clean rebuild:

```bash
rm -rf .aws-sam && sam build
```

---

## 4. OpenClaw session.tool events in webchat mode use phase:'result'

`session.tool` events from OpenClaw arrive with `phase: 'result'`, not `phase: 'start'`, in webchat mode. The `onToolCall` handler must listen for `phase: 'result'` to capture tool calls.

---

## 5. Zod schema must exactly match what the relay sends

If the relay sends `null` for `userId`, the schema must be:

```typescript
userId: z.string().uuid().nullable().optional()
```

Not `z.string().uuid()` — Zod will reject `null` and the parse fails silently (returns 400, no insert).

---

## 6. SSM path uses process.env.NODE_ENV — confirm it matches the environment

`getServiceKey()` builds the SSM path using `process.env.NODE_ENV`. In Lambda this is typically `production`, not `dev`. Confirm `NODE_ENV` matches the environment where secrets are stored, or the SSM lookup will miss and fall back to `INTERNAL_SERVICE_KEY` env var (which may be unset).

---

## 7. MCP server reads platform OAuth2 credentials from .env only

Gmail and other MCP servers read `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` from `.env` only — no Secrets Manager integration exists yet. Per-tenant tokens come from the `integrations` table. Platform-level OAuth2 credentials must be in `.env` until Secrets Manager integration is built.

---

## 8. Three separate auth keys — never mix them up

| Key | Purpose |
|---|---|
| `OPENCLAW_GATEWAY_TOKEN` | Frontend/client → OpenClaw gateway |
| `AGENT_SERVER_KEY` | Agent server authentication |
| `INTERNAL_SERVICE_KEY` | Relay → Lambda internal routes only (`X-Service-Key` header) |
