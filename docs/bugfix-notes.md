# Bug Fix Notes

## Chat Page White Screen Crash (April 19, 2026)

### Symptom
Application error white screen after 2-3 messages in chat. React error #300 "Rendered fewer hooks than expected". Production only — worked fine locally.

### Root Cause
`useSearchParams()` in `apps/web/app/[tenant]/dashboard/chat/page.tsx` forces the route into dynamic rendering. Without a `<Suspense>` boundary, Next.js throws during reconciliation when a streaming state update is in flight. The crash was timing-dependent — Turn 3 always hit it because enough in-flight state updates accumulated to guarantee the bad reconciler path.

Zero Suspense boundaries existed anywhere: not in dashboard/layout.tsx, [tenant]/layout.tsx, or app/layout.tsx.

### Fix
Wrapped the page in a Suspense boundary:
- Renamed existing default export to `ChatPageInner`
- New default export `ChatPageShell` wraps it in `<Suspense fallback={null}>`

File: `apps/web/app/[tenant]/dashboard/chat/page.tsx`

### Additional Fixes Applied Same Session

1. **useChat.ts finally block** — `setIsStreaming(false)` was called unconditionally, killing Turn 2's streaming state when Turn 1's abort cleanup ran. Fixed by moving it inside the controller identity check.

2. **useChat.ts auth_expired** — Recursive `sendMessageRef.current?.()` was unawaited, causing unhandled promise rejection. Fixed with `await ... .catch(console.error)`.

3. **page.tsx onDone setQueryData** — When `existingIndex === -1`, a zombie streaming bubble was left in cache. Fixed by finding and closing the zombie before pushing a new message.

4. **NGINX chunked_transfer_encoding off** — Was buffering entire SSE stream instead of streaming. Removed, added `add_header X-Accel-Buffering no`.

5. **page.tsx invalidateQueries timing** — Conversation list refetch was firing mid-stream after title PATCH. Moved into onDone setTimeout alongside messages invalidation.

### Rule Going Forward
Any component using `useSearchParams()`, `usePathname()`, or `useRouter()` in Next.js App Router must have a `<Suspense>` ancestor.

---

## Known Bug: Agent Hallucates Connected Integrations (April 19, 2026)

### Symptom
Agent claims to have access to Gmail, Zoho Mail, and other integrations even when the tenant has not connected them. When asked to perform an action (e.g. "read my recent emails"), it fails silently or gives a vague error.

### Root Cause
The openclaw SaaS plugin registers all 24 tools unconditionally on container start, regardless of which integrations the tenant has actually connected. The session_context injected by the relay contains only tenant_id — no connected integration info. IDENTITY.md contains only the system prompt — no tool availability info.

So the agent sees all 24 tools in every session and has no upfront signal about which ones are live.

### Planned Fix (Option 2 — Proper)
At provision/update time, agent-server should fetch the tenant's connected integrations alongside the system prompt and inject them into IDENTITY.md:

Example addition to system prompt:
"The following integrations are currently connected for this tenant: Gmail, Jira. Only use tools for these integrations. For any other tool, inform the user it is not connected."

### Why Not Today
Pre-demo. Parked for next sprint.
