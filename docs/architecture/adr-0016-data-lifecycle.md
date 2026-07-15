# ADR-0016: Data Lifecycle (Export, Retention, Deletion)

## Status
Accepted

## Date
2026-07-16

## Technology Compatibility

| Field | Value |
|-------|-------|
| Stack | Node.js 20 + Fastify 4 + Drizzle ORM 0.30 + PostgreSQL 16 + `puppeteer` (Phase 2 PDF export) |
| Domain | Data Lifecycle / GDPR-style Compliance / Retention |
| Knowledge Risk | LOW — all APIs are mature; PDF generation defers to Phase 2 |
| References Consulted | PRD §7.3 (数据安全), Grilling #9 (PDF 成长档案); ADR-0009 (Field Encryption — decrypt before export); ADR-0015 (Audit Log — log export action) |
| Post-Cutoff APIs Used | None |
| Verification Required | None for MVP; Phase 2 verifies `puppeteer` PDF generation on Railway Hobby (RAM limit) |

## ADR Dependencies

| Field | Value |
|-------|-------|
| Depends On | ADR-0001 (Tech Stack), ADR-0006 (Multi-tenant — `family_id` scope), ADR-0009 (Field Encryption — decrypt before export), ADR-0015 (Audit Log — log export + deletion) |
| Enables | Compliance review; PRD §7.3 "right to be forgotten" |
| Blocks | None |
| Ordering Note | MVP ships export-only (CSV/JSON); PDF export and scheduled deletion are Phase 2 |

## Context

### Problem Statement
PRD §7.3 and Grilling #9 require a "数据导出" (data export) capability — parents can export their family's full data as a PDF growth archive. Additionally, modern privacy expectations (and forthcoming PIPL compliance in China) require a "right to be forgotten" — a parent can request deletion of their family's data. The architecture must answer:

1. **Export scope** — What is exported? (Children, tasks, check-ins, point transactions, redemptions, reviews, diaries, audit logs?)
2. **Export format** — PDF (PRD §7.3) vs. machine-readable (JSON/CSV)?
3. **Decryption** — Diary and review content is AES-256-GCM encrypted (ADR-0009); export must decrypt.
4. **Deletion semantics** — Soft delete (anonymize PII, keep aggregates) vs. hard delete (cascade)?
5. **Retention window** — PRD §7.3 implies a 30-day post-deletion grace period before permanent erasure.

### Constraints
- MVP runs on Railway Hobby (512MB RAM) — `puppeteer` PDF generation may exceed memory budget; defer to Phase 2.
- Decryption requires `DATA_ENCRYPTION_KEY` — export must run server-side.
- Audit log (ADR-0015) is append-only — deletion request must preserve audit entries referencing the family (with `actor_id` nullified).
- Multi-tenant isolation (ADR-0006) — export and deletion are scoped to `family_id`.

### Requirements
- **TR-xc-009**: Data export (PDF or machine-readable) + 30-day deletion grace period.
- **TR-lifecycle-001** (implied): Export includes all family-owned data, decrypted.
- **TR-lifecycle-002** (implied): Deletion cascades through all family-owned tables per the foreign key `ON DELETE CASCADE` chain.
- **TR-lifecycle-003** (implied): Deletion request records a `data.deletion_requested` audit log entry; permanent deletion after 30 days records `data.deleted`.

## Decision

### 1. MVP Scope: Export-Only (JSON)

MVP ships **export only** in machine-readable JSON format. PDF generation is Phase 2.

Rationale:
- JSON export is a few hours of work — read all family-scoped tables, decrypt encrypted fields, serialize.
- PDF export requires a rendering pipeline (`puppeteer` + HTML template) that risks Railway Hobby's 512MB RAM limit.
- JSON export satisfies the "right to data portability" prong of PIPL/GDPR; PDF is a UX enhancement.

### 2. Export Endpoint

```
GET /api/export
  Authorization: Bearer <parent_jwt>
  Response: application/json
  Body: {
    family: { id, name, created_at },
    parents: [{ id, name, email, phone, created_at }],
    children: [{ id, name, age_group, created_at }],
    dimensions: [{ id, code, name, color, ... }],
    tasks: [{ id, title, description, point_value, ... }],
    checkins: [{ id, child_id, task_id, date, note, revoked, ... }],
    point_transactions: [{ id, child_id, amount, source_type, balance_after, created_at }],
    rewards: [{ id, title, point_cost, ... }],
    reward_redemptions: [{ id, child_id, reward_id, status, ... }],
    weekly_reviews: [{ id, child_id, week_start_date, best_thing, difficulty, ... }],
    growth_diaries: [{ id, child_id, title, content, category, ... }],
    audit_logs: [{ id, action, target_type, target_id, created_at }]  // metadata excluded for size
  }
```

### 3. Decryption

- `children.name`, `children.avatar`: decrypt per ADR-0009
- `growth_diaries.title`, `growth_diaries.content`: decrypt per ADR-0009
- `weekly_reviews.best_thing`, `difficulty`, `child_request`, `parent_observation`: decrypt per ADR-0009 (Phase 2 — currently not encrypted per ADR-0009 Phased Rollout)
- Decryption failures produce `[DECRYPT_FAILED]` placeholder strings — export does not abort on individual row failures.

### 4. Deletion: Two-Phase Soft + Hard

**Phase 1 (MVP): Hard delete on request**

```
DELETE /api/family
  Authorization: Bearer <parent_jwt>
  Response: 204 No Content
  Side effects:
    1. Write audit log: { action: 'data.deletion_requested', family_id, actor_role: 'parent' }
    2. CASCADE delete from families — all child rows removed per FK ON DELETE CASCADE
    3. Write audit log: { action: 'data.deleted', family_id: NULL, actor_role: 'system' }
       (family_id is NULL because the family row is already deleted)
    4. Invalidate parent JWT (client-side — token has no server-side revocation in MVP)
```

**Phase 2: 30-day grace period**

MVP's hard-delete-on-request is upgraded to a two-phase flow:
1. Parent requests deletion → `families.deleted_at = NOW()` (soft delete)
2. Parent can cancel within 30 days → `families.deleted_at = NULL`
3. After 30 days, a scheduled job (ADR-0010) hard-deletes the family and all cascaded rows

Rationale for MVP shortcut: PIPL does not mandate a grace period; the 30-day window is a UX choice. MVP parents who delete their family are likely certain; the grace period adds complexity (soft-delete column, scheduled job, UI for cancellation) without clear MVP value.

### 5. Audit Log Preservation

- Audit log entries (`audit_logs` table) are **preserved** across family deletion.
- The `family_id` foreign key on `audit_logs` uses `ON DELETE SET NULL` — when the family row is deleted, audit entries have their `family_id` set to NULL but the row itself remains.
- This preserves the forensic trail ("parent X deleted their family at time T") without violating the right to be forgotten (the audit log does not contain PII beyond `actor_id`, which is a UUID that becomes meaningless once the parent row is gone).

### 6. Rate Limiting

- Export endpoint is rate-limited to 1 request per minute per parent (per ADR-0013 rate limit override).
- Deletion endpoint is rate-limited to 1 request per hour per parent — protects against accidental double-deletes.

### 7. Phase 2 PDF Export

```typescript
// Phase 2 — not implemented in MVP
app.get('/api/export.pdf', { preHandler: [requireParent] }, async (req, reply) => {
  const data = await exportFamilyData(familyId);
  const html = renderPdfTemplate(data);
  const pdf = await puppeteer.launch().then(b => b.page().pdf({ format: 'A4' }));
  reply.type('application/pdf').send(pdf);
});
```

## Consequences

### Positive
- ✅ MVP ships export-only JSON in a few hours; PDF defers to Phase 2 with no schema impact.
- ✅ Hard delete in MVP is simple and aligned with PIPL "right to be forgotten".
- ✅ Audit log preservation with `family_id = NULL` maintains forensic trail without PII.
- ✅ Decryption failures degrade gracefully — export never aborts on individual row corruption.

### Negative
- ⚠️ MVP hard delete is irreversible — a parent who accidentally deletes their family cannot recover data. Phase 2 grace period mitigates this.
- ⚠️ JSON export may be large for families with extensive history — no streaming in MVP; the response is buffered in memory. Acceptable for MVP scale (single family, months of data).
- ⚠️ PDF export deferral means PRD §7.3 is only partially satisfied in MVP — UX trade-off documented.

### Neutral
- Audit log preservation with `family_id = NULL` means orphaned audit entries accumulate over time as families are deleted. Phase 2 retention policy (ADR-0015 §6) handles this.

## Risks

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| Parent accidentally deletes family, demands restoration | MEDIUM | MVP: document irreversibility in deletion confirmation UI; Phase 2: 30-day grace period |
| Export response exceeds Railway Hobby memory | LOW | MVP families are small (months of data); Phase 2 adds streaming |
| Decryption failure corrupts export | LOW | Per-row error swallowing; `[DECRYPT_FAILED]` placeholder |
| Audit log preservation violates "right to be forgotten" | LOW | Audit log contains no PII beyond UUIDs; `actor_id` is meaningless post-deletion |

## Open Questions

- **PDF template design** — Phase 2 will need a UX-designed PDF template; out of scope for this ADR.
- **Export of encrypted weekly_reviews** — Currently unencrypted per ADR-0009 Phased Rollout; Phase 2 will need to decrypt when encryption is enabled.
