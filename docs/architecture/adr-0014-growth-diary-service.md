# ADR-0014: Growth Diary Service (Field-Encrypted CRUD + Read Authorization)

## Status
Accepted

## Date
2026-07-16

## Technology Compatibility

| Field | Value |
|-------|-------|
| Stack | Node.js 20 + Fastify 4 + Drizzle ORM 0.30 + PostgreSQL 16 + Node `crypto` (AES-256-GCM, ADR-0009) |
| Domain | Growth Diary (CRUD + encryption + read authorization) |
| Knowledge Risk | LOW — all APIs are mature; encryption pattern follows ADR-0009 |
| References Consulted | PRD §3.5 (成长日记), §7.3 (数据安全); DETAILED_DESIGN §11 (`growth_diaries` table); ADR-0009 (Field Encryption); ADR-0006 (Multi-tenant isolation) |
| Post-Cutoff APIs Used | None |
| Verification Required | None — `crypto.createCipheriv` AES-256-GCM is stable since Node 14 |

## ADR Dependencies

| Field | Value |
|-------|-------|
| Depends On | ADR-0001 (Tech Stack), ADR-0002 (Auth — child JWT), ADR-0006 (Multi-tenant — `family_id` filter), ADR-0009 (Field Encryption — `encryptField` / `decryptField`) |
| Enables | Epic "Growth Diary" (Ticket #10) |
| Blocks | None |
| Ordering Note | Schema (`growth_diaries`) is already created by `migrate.ts`; ADR-0009 crypto helpers must exist before route handlers |

## Context

### Problem Statement
The Growth Diary (成长日记) is the child's private reflection space — free-form text entries capturing achievements, reflections, goals, and memories. It is the most PII-sensitive feature in the system: titles and content are child-authored personal text. The architecture must answer three questions:

1. **CRUD shape** — What are the create / read / update / delete contracts, and who can call each?
2. **Encryption** — ADR-0009 already mandates AES-256-GCM for `growth_diaries.title` and `growth_diaries.content`. How is the per-row key derived, and what happens on decryption failure?
3. **Read authorization** — Children own their diaries; parents can read them in service of parenting (PRD §3.5). How is this enforced without leaking data across siblings or families?

### Constraints
- Diary text is encrypted at the application layer (ADR-0009) — DB column is `TEXT`, storing base64(`iv || ciphertext || tag`).
- Diary cannot be searched server-side (LIKE on ciphertext is meaningless) — Phase 2 may add decrypted client-side search.
- MVP runs on Railway Hobby with single instance — no need for distributed cache.
- Children create diaries; parents read diaries for their own family only.
- Soft-delete is unnecessary — hard delete is acceptable (PRD §7.3 — "right to be forgotten").

### Requirements
- **TR-diary-001**: Child creates diary (title, content, category, optional week_start_date); parent reads diaries for any child in their family.
- **TR-diary-002** (implied): Diary title and content are AES-256-GCM encrypted per ADR-0009.
- **TR-diary-003** (implied): Update and delete operations are restricted to the diary's author (child) — parents may not edit.
- **TR-diary-004** (implied): Categories are constrained to `achievement`, `reflection`, `goal`, `memory` (CHECK constraint already in `schema.ts`).

## Decision

### 1. CRUD Contract

| Operation | Route | Role | Notes |
|-----------|-------|------|-------|
| Create | `POST /api/diaries` | child only | Child authors; `childId` taken from JWT, not body |
| List | `GET /api/diaries?child_id=<uuid>` | child (own) / parent (any in family) | Parent must supply `child_id` |
| Update | `PATCH /api/diaries/:id` | child author only | Parent is forbidden from editing |
| Delete | `DELETE /api/diaries/:id` | child author only | Hard delete (no soft-delete column) |

### 2. Encryption (per ADR-0009)

- `encryptField('growth_diaries', row.id, title)` → ciphertext stored in `title` column
- `encryptField('growth_diaries', row.id, content)` → ciphertext stored in `content` column
- Per-row key derived via `deriveRowKey('growth_diaries', row.id)` using HKDF-SHA256 from `DATA_ENCRYPTION_KEY`
- **Decryption failure handling**: `decryptField` returns `null` on any error (corrupted ciphertext, rotated key). The route returns `[DECRYPT_FAILED]` placeholder text rather than throwing — a corrupted diary should not 500 the list endpoint.

### 3. Read Authorization

- **Child** sees only diaries where `child_id = jwt.sub`.
- **Parent** sees diaries for any child in their family; the route verifies the supplied `child_id` belongs to a child in `parent.family_id` (per ADR-0006 multi-tenant isolation).
- Cross-family access returns 404 (per ADR-0006 — never 403, to prevent resource probing).

### 4. Field Shape

```typescript
// POST /api/diaries
{
  title: string;          // 1–200 chars, encrypted before insert
  content: string;        // 1–5000 chars, encrypted before insert
  category: 'achievement' | 'reflection' | 'goal' | 'memory';
  week_start_date?: string;  // YYYY-MM-DD, optional
}
// Response shape (decrypted on read)
{
  id: string;
  child_id: string;
  title: string;
  content: string;
  category: string;
  week_start_date: string | null;
  created_at: string;
  updated_at: string;
}
```

### 5. Insert + Encrypt Flow

```typescript
// 1. Insert row with placeholder ciphertext (or null)
const [row] = await db.insert(schema.growthDiaries).values({
  childId,
  title: null,       // placeholder; will be overwritten
  content: null,
  category: parsed.category,
  weekStartDate: parsed.week_start_date || null,
  createdByChild: true,
}).returning();

// 2. Encrypt title and content with the row's id
const encTitle = encryptField('growth_diaries', row.id, parsed.title);
const encContent = encryptField('growth_diaries', row.id, parsed.content);

// 3. Update the row with ciphertext
await db.update(schema.growthDiaries)
  .set({ title: encTitle, content: encContent })
  .where(eq(schema.growthDiaries.id, row.id));
```

This two-step pattern is necessary because `deriveRowKey` requires the row's `id`, which is only known after insert. An alternative — pre-generating the UUID client-side — would break the `defaultRandom()` convention and complicate the schema.

## Consequences

### Positive
- ✅ PII is encrypted at rest; a DB dump alone cannot reconstruct diary content.
- ✅ Read authorization is enforced at the route layer; multi-tenant isolation is preserved.
- ✅ Children retain authorship — parents cannot silently edit child-authored text.
- ✅ Hard delete aligns with PRD §7.3 "right to be forgotten" and avoids accumulating orphaned ciphertext.

### Negative
- ⚠️ Two-step insert + update adds one extra DB round-trip per diary creation. Acceptable for a low-write feature (a child writes at most a few diaries per week).
- ⚠️ Server-side full-text search is impossible on encrypted fields. Client-side search (decrypt-in-browser) is Phase 2.
- ⚠️ Decryption failure produces silent placeholder text rather than a loud error — operators must monitor logs for `decryptField` failures.

### Neutral
- No soft-delete column — diaries are either present or gone. This matches the child-authored, parent-read model where drafts are uncommon.

## Risks

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| `DATA_ENCRYPTION_KEY` rotation breaks existing diaries | LOW | Phase 2 will add a `key_version` column + re-encryption migration; MVP pins single-key for simplicity |
| Decryption failure corrupts the list view | MEDIUM | `decryptField` swallows errors and returns `null`; route substitutes `[DECRYPT_FAILED]` |
| Parent reads child diary without child's awareness | LOW (by design) | PRD §3.5 explicitly grants parents read access; the access is logged in `audit_logs` per ADR-0015 |

## Open Questions

None — all decisions are pinned for MVP Phase 1.
