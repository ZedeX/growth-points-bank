# 10 — Growth Diary with Field Encryption

**What to build:** The growth diary feature per PRD §3.5: child can write diary entries with title, content, and category (6 categories). Content is encrypted at rest using AES-256-GCM per ADR-0009. After this ticket, a child can create/list/filter diaries, and DB queries (bypassing ORM) return ciphertext — never plaintext.

**Blocked by:** 04 — Family and Children CRUD (needs child auth context).

**Status:** ready-for-agent

- [ ] `src/server/utils/crypto.ts`: `encryptField(plaintext, tableName, rowId)` and `decryptField(ciphertext, tableName, rowId)` using AES-256-GCM + HKDF-SHA256 per-row key derivation
- [ ] Master key from `ENCRYPTION_MASTER_KEY` env var (32 bytes, base64)
- [ ] Wire `encryptedText` Drizzle custom type to call `encryptField`/`decryptField` (replace stub from ticket 02)
- [ ] Apply `encryptedText` to columns: `weekly_reviews.best_thing`, `weekly_reviews.difficulty`, `weekly_reviews.parent_observation`, `weekly_reviews.child_request`, `growth_diaries.title`, `growth_diaries.content`
- [ ] `src/server/routes/diaries.ts`: `POST /api/diaries`, `GET /api/diaries` (with `?category=` filter, cursor pagination), `GET /api/diaries/:id`, `PUT /api/diaries/:id`, `DELETE /api/diaries/:id`
- [ ] `src/shared/schemas/diary.ts` Zod: title (1-100), content (1-10000), category enum (drawing/journal/cooking/experiment/exercise/other)
- [ ] List returns diaries in descending `created_at` order
- [ ] Filter by category returns only matching entries
- [ ] All tests from `TDD_SPEC.md §14` pass (create diary, empty title rejection, invalid category, filter by category, descending order)
- [ ] All encryption tests from `TDD_SPEC.md §16.3` pass:
  - RED 7: raw DB row content is base64 ciphertext, not the plaintext
  - RED 8: weekly review `best_thing` column stores ciphertext
- [ ] Key rotation script `scripts/rotate-encryption-key.ts` re-encrypts all rows with new master key
- [ ] Decrypt fails gracefully if master key missing → `INTERNAL_ERROR` 500 with requestId
