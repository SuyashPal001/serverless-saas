# Vendor Database (#11) — design

## Context

OIL microservice #11, "Vendor Database," is not started (`OIL-SCOPE-GAP-PLAN.md` §1). Today's `bidders` table (`packages/foundation/database/schema/tender.ts`) is per-tender only — no cross-tender vendor identity, no blacklist, no category. This is genuinely greenfield, and unlike most remaining OIL gaps, it has no OIL dependency: no SAP/GeM/SRM credentials, no historical data, no external feed. It's buildable now, same posture as this week's generic GFR/CVC defaults elsewhere in this repo.

Scope, per the OIL scope doc: centralized vendor repository, Approved Vendor List (AVL) + blacklist maintenance ("no tender/contract issued to a blacklisted vendor" — the concrete compliance win), vendor participation history across tenders, category marking (CPSU/SPSU/MSE/Govt bodies/civil contractors/country of origin), OEM/proprietary-vendor mapping, and limited/framework/rate-contract vendor data (terms, pricing, validity).

## Decisions locked during brainstorming

- **`bidders` gets a nullable `vendorId` FK** to the new vendor master, rather than staying fully separate. Existing bidder rows stay valid (FK nullable, no backfill required); new bids can optionally link to a vendor, making participation history a real query instead of a manual log.
- **Blacklist enforcement at two points**: bidder-vendor linking (early warning) and Order/Contract Formulator's (#5, built this week) contract-generation gate (hard block, audited). Covers the actual highest-risk moment — a blacklisted vendor reaching an issued contract — without blocking on the earliest, lowest-stakes step alone.
- **Category taxonomy is a fixed `pgEnum`** with generic values from the scope doc (`cpsu | spsu | mse | self_help_group | govt_body | civil_contractor | other`) plus a separate `countryOfOrigin` text field — not free-text tags. Matches this week's "generic defaults, swap later if OIL supplies their own taxonomy" posture.
- **OEM/proprietary-vendor mapping stays a simple field pair** on the vendor row (`isOemAuthorized` boolean + `oemProducts` text), not a separate product-catalog table. Thin but real, matching how the rest of this week's features were deliberately scoped down.
- **Rate/framework/limited contracts are a new, separate table** (`rateContracts`), not a reuse of `tenderContracts` — that table is specifically tender-outcome contracts (bidder→contractor substitution, awarded-bidder readiness gate); a standing rate agreement is a structurally different concept. Both link to the same vendor via `vendorId`.
- **New dashboard page** (`/[tenant]/dashboard/vendors`), styled like `ClauseLibraryPanel` (list, category filter chips, detail view) — not API/schema-only.
- **Seed a small demo vendor set** (~12 generic vendors, one deliberately blacklisted), auto-seeded per tenant on first access, same idempotent pattern as `ensureClauseLibrary`. Makes the blacklist story demoable without manual data entry.

## Architecture

### 1. Schema (new)

`packages/foundation/database/schema/vendor.ts`:

```ts
export const vendorCategoryEnum = pgEnum('vendor_category', [
  'cpsu', 'spsu', 'mse', 'self_help_group', 'govt_body', 'civil_contractor', 'other',
]);

export const rateContractTypeEnum = pgEnum('rate_contract_type', ['limited', 'framework', 'rate']);

export const vendors = pgTable('vendors', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  category: vendorCategoryEnum('category').notNull().default('other'),
  countryOfOrigin: text('country_of_origin'),
  contactEmail: text('contact_email'),
  contactPhone: text('contact_phone'),
  isBlacklisted: boolean('is_blacklisted').notNull().default(false),
  blacklistReason: text('blacklist_reason'),
  blacklistedAt: timestamp('blacklisted_at', { withTimezone: true }),
  isOemAuthorized: boolean('is_oem_authorized').notNull().default(false),
  oemProducts: text('oem_products'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  tenantIdx: index('idx_vendors_tenant').on(t.tenantId),
}));

export const rateContracts = pgTable('rate_contracts', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  vendorId: uuid('vendor_id').notNull().references(() => vendors.id, { onDelete: 'cascade' }),
  contractType: rateContractTypeEnum('contract_type').notNull(),
  terms: text('terms'),
  pricing: jsonb('pricing').default('{}'),
  validFrom: timestamp('valid_from', { withTimezone: true }),
  validTo: timestamp('valid_to', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  vendorIdx: index('idx_rate_contracts_vendor').on(t.vendorId),
}));
```

Migration also adds a nullable `vendor_id uuid references vendors(id)` column to the existing `bidders` table.

### 2. Blacklist enforcement (new, pure)

`apps/relay/src/mastra/rules/vendorBlacklist.ts` (or `apps/api` equivalent depending on where the calling code lives — resolved during planning):

```ts
export function checkVendorBlacklist(
  vendor: { isBlacklisted: boolean; blacklistReason: string | null } | null
): { blocked: boolean; reason: string | null } {
  if (!vendor) return { blocked: false, reason: null }; // no vendor linked — nothing to gate on
  if (!vendor.isBlacklisted) return { blocked: false, reason: null };
  return { blocked: true, reason: vendor.blacklistReason ?? 'Vendor is blacklisted' };
}
```

Same shape as this week's `evaluatePublishGate` — pure, no I/O, independently unit-testable.

**Integration point 1 — bidder-vendor linking.** Wherever a bidder record is created/updated with a `vendorId` (existing bidder-creation route), call `checkVendorBlacklist` against the linked vendor; if blocked, return a 422 with the reason rather than silently allowing the link. This is a warning-grade gate — it happens early, before evaluation, so an officer sees it immediately rather than discovering it at contract time.

**Integration point 2 — contract formulation.** The Order/Contract Formulator's existing awarded-bidder readiness gate (`apps/relay/src/tender/tenderContract.ts`, built this week) gets one more check: after resolving the awarded bidder, look up its linked vendor (if any) and call `checkVendorBlacklist`; if blocked, refuse contract generation with a 422, audited in `auditLog` the same way the existing readiness gate is.

### 3. API routes

`apps/api/src/routes/vendors.ts`: `GET /vendors` (list, filterable by category/blacklist status), `GET /vendors/:id`, `POST /vendors`, `PATCH /vendors/:id` (including the blacklist toggle — requires `blacklistReason` when setting `isBlacklisted: true`), `GET /vendors/:id/participation` (derived from `bidders` rows where `vendorId` matches, joined to `tenders` for tender titles/outcomes), `GET /vendors/:id/rate-contracts`, `POST /vendors/:id/rate-contracts`.

### 4. Web UI

`/[tenant]/dashboard/vendors` — new page. List view with category filter chips (styled like `ClauseLibraryPanel`'s category chips), blacklist badge, search by name. Detail view: vendor fields (editable), participation history table (tender title, role/outcome, date), rate contracts list, blacklist toggle with a required-reason text field.

### 5. Seed data

`apps/api/src/routes/vendorSeed.ts` (mirrors `tenderClauseSeed.ts`): ~12 generic vendor entries spanning all 7 categories, realistic but clearly generic names (not resembling any real OIL vendor), one explicitly `isBlacklisted: true` with a stated reason. Seeded idempotently per tenant (only if the tenant's `vendors` table is empty), same pattern as `ensureClauseLibrary`.

## Data flow

```
Officer creates/links a bidder to a vendor (existing bid-ingest flow, extended)
        │
        ▼
checkVendorBlacklist(vendor) ──► blocked? 422, reason shown (does not silently proceed)
        │ not blocked
        ▼
bidder.vendorId set
        │
        ▼
... evaluation proceeds as today ...
        │
        ▼
Order/Contract Formulator resolves awarded bidder
        │
        ▼
checkVendorBlacklist(awardedBidder.vendor) ──► blocked? 422, audited, contract generation refused
        │ not blocked
        ▼
contract generated (existing flow, unchanged)
```

Participation history and rate-contract views are read paths, no new write flow beyond vendor CRUD.

## Error handling

- `checkVendorBlacklist` never throws — `vendor: null` (no linked vendor) is a valid, non-blocking case, not an error.
- Blacklist toggle requires a non-empty `blacklistReason` when setting `isBlacklisted: true` — enforced at the API layer, returns 400 if missing. Un-blacklisting does not require a reason.
- Vendor deletion is out of scope for this pass (no delete route) — blacklisting is the correct lifecycle action for "stop using this vendor," not deletion, which would orphan `rateContracts` and historical `bidders.vendorId` references.

## Testing

- `checkVendorBlacklist` — unit tests: `null` vendor (not blocked), non-blacklisted vendor (not blocked), blacklisted vendor with reason (blocked, reason surfaced), blacklisted vendor with null reason (blocked, default message).
- Contract-formulation integration point — extend the existing Order/Contract Formulator test coverage (built this week) with one new case: awarded bidder's vendor is blacklisted → 422, audited.
- Bidder-linking integration point — one new test case at whatever level the existing bidder-creation route is tested: linking to a blacklisted vendor → 422.
- Seed data — no test needed (declarative data, same as `tenderClauseSeed.ts`'s convention).

## Out of scope (explicitly deferred)

- OEM/proprietary-vendor mapping as a full product catalog (simple field pair only, per decision above).
- Vendor rating (explicitly named in the OIL scope doc as "incorporation of vendor rating in **future**" — not this pass).
- Real OIL vendor data / SAP/GeM vendor-master integration (no OIL dependency by design — this is why the item was picked for this pass).
- Vendor deletion / archival lifecycle beyond blacklisting.
- Live verification — subject to the same Tier 0 VM-verification blocker as everything else built this week ([[project_pending_tier0_vm]]); code-complete + unit-tested is the bar for this pass.
