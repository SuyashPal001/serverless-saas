# Pages / Wiki — Implementation Guide

Reference this document at the start of every pages implementation session.
Read docs/09_mastra_deep_reference.md and docs/10_pm_agent_implementation.md first for architecture context.

---

## Rules — Read Before Writing Any Code

1. NEVER modify existing Tiptap editors (DescriptionEditor.tsx, RichTextEditor.tsx, CommentEditor.tsx)
2. NEVER use Yjs, Hocuspocus, or WebSocket collaboration — skip for now
3. NEVER create a separate RAG pipeline — feed into existing documents table + documentIngest worker
4. ALWAYS strip HTML to plain text in the Hono PATCH handler before DB write — not in a trigger
5. ALWAYS snapshot on every save, prune to last 20 versions in same transaction
6. ALWAYS follow raw pg.Pool pattern for relay tools — no Drizzle, no @serverless-saas/database
7. ALWAYS show full file contents after every change
8. ALWAYS redeploy and confirm online after changes
9. NEVER build the binary/Yjs description_binary column — skip entirely

---

## Architecture Decisions (Proven from Plane production code)

### Content Storage — 3 formats (not 4, skip binary)
- description_html — canonical format, stored in DB, rendered in UI
- description_json — Tiptap JSON output, stored in DB for future use
- description_stripped — auto-generated from HTML on every save via strip_tags, fed into RAG

### RAG Integration
- On every PATCH save: insert/update a record in documents table with description_stripped as content
- Trigger existing documentIngest worker via SQS (same as PDF/DOCX pipeline)
- fetchAgentContext already queries document_chunks — wiki pages will appear automatically
- metadata field on documents record: { sourceType: 'wiki_page', pageId, planId, tenantId }

### Versioning
- Snapshot on every PATCH save
- INSERT into project_page_versions
- DELETE versions WHERE rank > 20 for that page_id (window function, one query)
- No background job needed

### Editor
- Reuse DescriptionEditor.tsx pattern exactly
- New component: PageEditor.tsx — same Tiptap config, same 1.5s debounce, same BubbleMenu
- Stores as HTML (getHTML()) — same as task description
- PATCH /api/v1/pages/:id on save

---

## DB Schema — 3 tables

### Table 1: project_pages

```sql
CREATE TABLE project_pages (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL,
  plan_id             uuid REFERENCES project_plans(id) ON DELETE CASCADE,
  parent_id           uuid REFERENCES project_pages(id) ON DELETE CASCADE,
  owned_by            uuid NOT NULL,
  created_by          uuid NOT NULL,
  title               text NOT NULL DEFAULT 'Untitled',
  description_html    text NOT NULL DEFAULT '<p></p>',
  description_json    jsonb NOT NULL DEFAULT '{}',
  description_stripped text,
  page_type           text NOT NULL DEFAULT 'custom',
  -- page_type values: prd | roadmap | runbook | adr | manual | custom
  source              text NOT NULL DEFAULT 'human',
  -- source values: human | agent
  source_ref_id       uuid,
  -- links to agent_prds.id, roadmap id, etc when source = agent
  access              smallint NOT NULL DEFAULT 0,
  -- 0 = public (team), 1 = private
  is_locked           boolean NOT NULL DEFAULT false,
  is_global           boolean NOT NULL DEFAULT false,
  archived_at         timestamptz,
  sort_order          float NOT NULL DEFAULT 65535,
  color               text,
  logo_props          jsonb NOT NULL DEFAULT '{}',
  document_id         uuid REFERENCES documents(id),
  -- FK to documents table for RAG — set after ingest
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_project_pages_tenant ON project_pages(tenant_id);
CREATE INDEX idx_project_pages_plan ON project_pages(plan_id);
CREATE INDEX idx_project_pages_parent ON project_pages(parent_id);
CREATE INDEX idx_project_pages_type ON project_pages(page_type);
CREATE INDEX idx_project_pages_source ON project_pages(source);
```

### Table 2: project_page_versions

```sql
CREATE TABLE project_page_versions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL,
  page_id             uuid NOT NULL REFERENCES project_pages(id) ON DELETE CASCADE,
  owned_by            uuid NOT NULL,
  description_html    text NOT NULL DEFAULT '<p></p>',
  description_json    jsonb NOT NULL DEFAULT '{}',
  description_stripped text,
  last_saved_at       timestamptz NOT NULL DEFAULT now(),
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_page_versions_page ON project_page_versions(page_id);
CREATE INDEX idx_page_versions_saved ON project_page_versions(last_saved_at);
```

### Table 3: project_page_logs

```sql
CREATE TABLE project_page_logs (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL,
  page_id             uuid NOT NULL REFERENCES project_pages(id) ON DELETE CASCADE,
  transaction         uuid NOT NULL DEFAULT gen_random_uuid(),
  entity_name         text NOT NULL,
  -- values: task | milestone | plan | prd | user | page
  entity_identifier   uuid,
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE(page_id, transaction)
);

CREATE INDEX idx_page_logs_page ON project_page_logs(page_id);
CREATE INDEX idx_page_logs_entity ON project_page_logs(entity_identifier);
```

---

## API Routes

All routes in apps/api/src/routes/pages.ts

```
POST   /api/v1/pages              — create page
GET    /api/v1/pages?planId=      — list pages for plan (flat list, sorted by sort_order)
GET    /api/v1/pages/:id          — get page detail with description_html
PATCH  /api/v1/pages/:id          — save page (debounced 1.5s from frontend)
DELETE /api/v1/pages/:id          — soft delete via archived_at = now()
GET    /api/v1/pages/:id/versions — list last 20 versions
POST   /api/v1/pages/:id/restore/:versionId — restore a version
POST   /api/v1/pages/:id/lock     — toggle is_locked
```

### PATCH handler logic (in order):
1. Validate tenant + ownership
2. Strip HTML to plain text (strip_tags equivalent — use striptags npm package)
3. UPDATE project_pages — set description_html, description_json, description_stripped, updated_at
4. INSERT into project_page_versions (snapshot)
5. DELETE versions WHERE rank > 20 for this page_id using window function
6. If description_stripped changed: upsert documents record + trigger documentIngest via SQS
7. Return updated page

---

## Build Order — 9 Steps

### Step 1 — DB Migration
Create migration file for all 3 tables.
Run migration against Neon.
Confirm all 3 tables exist with correct columns.

### Step 2 — striptags utility
Install striptags npm package in apps/api.
Create apps/api/src/utils/stripHtml.ts — thin wrapper.
Export stripHtml(html: string): string.

### Step 3 — Page service
Create apps/api/src/services/pageService.ts:
- createPage(tenantId, userId, planId, data) → page
- listPages(tenantId, planId) → page[]
- getPage(tenantId, pageId) → page | null
- savePage(tenantId, userId, pageId, data) → page (handles strip, version, RAG trigger)
- archivePage(tenantId, pageId) → void
- toggleLock(tenantId, userId, pageId) → page
- listVersions(tenantId, pageId) → version[]
- restoreVersion(tenantId, userId, pageId, versionId) → page

### Step 4 — API routes
Create apps/api/src/routes/pages.ts.
Register in apps/api/src/index.ts.
Follow exact pattern of plans routes.
All routes tenant-scoped.

### Step 5 — RAG wiring
In savePage service: after DB write, upsert into documents table with:
- name: page.title
- metadata: { sourceType: 'wiki_page', pageId, planId, tenantId }
- status: 'pending' (triggers worker pickup)
Update project_pages.document_id with the documents.id.
Worker picks up automatically — no new code needed.

### Step 6 — Frontend: PageEditor.tsx
Create apps/web/src/components/pages/PageEditor.tsx.
Copy DescriptionEditor.tsx pattern exactly:
- Same Tiptap extensions
- Same 1.5s debounce
- Same BubbleMenu
- PATCH /api/v1/pages/:id on save
- Accepts: pageId, initialHtml, isLocked, onSave callback

### Step 7 — Frontend: Pages list view
Create apps/web/src/app/[tenant]/dashboard/plans/[planId]/pages/page.tsx.
- List pages for plan via GET /api/v1/pages?planId=
- "New Page" button → POST /api/v1/pages
- Each page card: title, page_type badge, source badge (agent/human), updated_at
- Click → navigate to page detail

### Step 8 — Frontend: Page detail view
Create apps/web/src/app/[tenant]/dashboard/plans/[planId]/pages/[pageId]/page.tsx.
- Load page via GET /api/v1/pages/:id
- Render PageEditor.tsx with initialHtml
- Title editable inline (same pattern as plan title inline edit)
- Lock indicator if is_locked
- Version history sidebar (GET /api/v1/pages/:id/versions)

### Step 9 — Add Pages tab to Plan detail
In existing Plan detail page — add "Pages" tab alongside Overview | Milestones | Tasks.
Tab navigates to /plans/:planId/pages.

---

## What to Skip for Now
- Yjs / WebSocket real-time collaboration
- description_binary column
- Nested page tree sidebar navigation
- Inline text comments
- Public page publishing
- Global (non-plan-scoped) wiki pages
- Page labels / tags
- Page mentions (@user, @task) — add in Phase 2

---

## Phase 2 Preview (Do Not Build Yet)
- Page mentions — @task, @milestone, @user linking via project_page_logs
- Nested pages — parent_id tree rendered in sidebar
- Global pages — is_global = true, not scoped to a plan
- Agent auto-generation — pmAgent creates pages automatically from PRD/roadmap artifacts
- Handover export — compile all plan pages into PDF client pack
