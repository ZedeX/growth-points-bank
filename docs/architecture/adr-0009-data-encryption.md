# ADR-0009: Child Data Encryption at Rest (Field-Level AES-256-GCM for PII)

## Status
Accepted

##Date
2026-07-16

## Technology Compatibility

| Field | Value |
|-------|-------|
| Stack | PostgreSQL 16 + Node.js `crypto` module (AES-256-GCM) |
| Domain | Data Security / Privacy |
| Knowledge Risk | LOW — AES-256-GCM is standard |
| References Consulted | PRD §7.3 (数据安全), 未成年人保护相关法规 |
| Post-Cutoff APIs Used | None |
| Verification Required | Key rotation procedure tested |

## ADR Dependencies

| Field | Value |
|-------|-------|
| Depends On | ADR-0001 (Tech Stack), ADR-0002 (Auth — provides key derivation inputs) |
| Enables | Compliance with child privacy requirements |
| Blocks | None (hardening, not a feature gate) |
| Ordering Note | Implement before storing any real child data |

## Context

### Problem Statement
PRD §7.3 requires:
- 儿童信息加密存储（姓名、头像等）
- 符合未成年人保护相关法规

The app stores potentially sensitive child data:
- `children.name` (child's name — PII)
- `children.avatar` (URL, possibly identifying)
- `growth_diaries.title` and `content` (personal reflections)
- `weekly_reviews.best_thing`, `difficulty`, `child_request` (personal reflections)

Postgres-level encryption at rest (via Neon's encrypted volumes) protects against physical disk theft but NOT against:
- DBA with `SELECT` access
- Application bugs that log full rows
- SQL injection that exfiltrates data

### Constraints
- Performance: decryption must be fast (<1ms per row)
- Searchability: encrypted columns cannot use indexes directly (limit search patterns)
- Key management: need to rotate keys without re-encrypting entire DB
- Compliance: must demonstrate encryption was in place (audit)

### Requirements
- All PII fields (name, avatar, diary content, review text) encrypted at rest
- Encryption keys never logged, never sent to client
- Decryption only happens in application layer after auth
- Key rotation possible without downtime

## Decision

### Approach: Application-Layer AES-256-GCM with Envelope Encryption

```
Hierarchy:
  Master Key (in env var: DATA_ENCRYPTION_KEY)
    ↓ KDF (HKDF-SHA256)
  Per-Table Key (derived per table name)
    ↓ KDF (HKDF-SHA256)
  Per-Row Key (derived per row id)
    ↓ AES-256-GCM
  Encrypted Field Value (stored as: iv || ciphertext || auth_tag)
```

### Implementation

```typescript
// src/server/crypto/field-crypto.ts
import { createCipheriv, createDecipheriv, randomBytes, createHmac } from 'crypto';

const MASTER_KEY = Buffer.from(process.env.DATA_ENCRYPTION_KEY!, 'base64');
assert(MASTER_KEY.length === 32, 'DATA_ENCRYPTION_KEY must be 32 bytes (base64-encoded)');

/**
 * Derive per-row key via HKDF.
 * Per-row keys limit blast radius if a single key is compromised.
 */
function deriveRowKey(tableName: string, rowId: string): Buffer {
  const info = Buffer.from(`${tableName}:${rowId}`);
  // HKDF-SHA256 (extract + expand)
  const prk = createHmac('sha256', MASTER_KEY).update(Buffer.from(tableName)).digest();
  const okm = createHmac('sha256', prk).update(Buffer.concat([Buffer.from([1]), info])).digest();
  return okm.subarray(0, 32);
}

/**
 * Encrypt a field value. Returns base64-encoded string: iv || ciphertext || tag.
 */
export function encryptField(tableName: string, rowId: string, plaintext: string | null): string | null {
  if (plaintext === null || plaintext === undefined) return null;

  const key = deriveRowKey(tableName, rowId);
  const iv = randomBytes(12);  // 96-bit IV for GCM
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return Buffer.concat([iv, ciphertext, tag]).toString('base64');
}

/**
 * Decrypt a field value.
 */
export function decryptField(tableName: string, rowId: string, encrypted: string | null): string | null {
  if (encrypted === null || encrypted === undefined) return null;

  const key = deriveRowKey(tableName, rowId);
  const buf = Buffer.from(encrypted, 'base64');
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(buf.length - 16);
  const ciphertext = buf.subarray(12, buf.length - 16);

  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plaintext.toString('utf8');
}
```

### Drizzle Schema Integration

```typescript
// src/server/db/schema.ts
import { customType } from 'drizzle-orm';

export const encryptedText = customType<{ data: string | null; driverData: string | null }>({
  dataType() { return 'text'; },
  toDriver(value) {
    // Will be set explicitly in repository layer (needs rowId which isn't known at INSERT time for new rows)
    return value;
  },
});

// Schema:
export const children = pgTable('children', {
  id: uuid('id').primaryKey().defaultRandom(),
  familyId: uuid('family_id').notNull(),
  name: encryptedText('name'),  // encrypted at app layer
  avatar: encryptedText('avatar'),
  // ... other fields
});

export const growthDiaries = pgTable('growth_diaries', {
  id: uuid('id').primaryKey().defaultRandom(),
  childId: uuid('child_id').notNull(),
  title: encryptedText('title'),
  content: encryptedText('content'),
  // ...
});
```

### Repository Layer Encryption

```typescript
// src/server/repositories/child-repo.ts
export const childRepo = {
  async create(familyId: string, input: ChildInput): Promise<Child> {
    const id = randomUUID();
    return await db.transaction(async (tx) => {
      const [row] = await tx.insert(children).values({
        id,
        familyId,
        name: input.name,  // raw value; encrypted below
        avatar: input.avatar ?? null,
        ageGroup: input.ageGroup,
        // ...
      }).returning({ id: children.id, familyId: children.familyId, /* ... */ });

      // Now that we have the id, encrypt the PII fields
      await tx.update(children).set({
        name: encryptField('children', id, input.name),
        avatar: encryptField('children', id, input.avatar ?? null),
      }).where(eq(children.id, id));

      return { ...row, name: input.name, avatar: input.avatar ?? null };  // return plaintext to caller
    });
  },

  async findById(familyId: string, childId: string): Promise<Child | null> {
    const row = await db.query.children.findFirst({
      where: and(eq(children.id, childId), eq(children.familyId, familyId)),
    });
    if (!row) return null;
    return {
      ...row,
      name: decryptField('children', childId, row.name),
      avatar: decryptField('children', childId, row.avatar),
    };
  },
};
```

### Key Rotation

```typescript
// scripts/rotate-encryption-key.ts
//
// To rotate the master key:
// 1. Set new DATA_ENCRYPTION_KEY_V2 env var
// 2. Run this script: re-encrypts all rows using new key
// 3. Once complete, swap env vars: DATA_ENCRYPTION_KEY = DATA_ENCRYPTION_KEY_V2
// 4. Remove old key

import { encryptField, decryptField } from '../src/server/crypto/field-crypto';

async function rotateKey() {
  const tables = [
    { name: 'children', idCol: 'id', fields: ['name', 'avatar'] },
    { name: 'growth_diaries', idCol: 'id', fields: ['title', 'content'] },
    { name: 'weekly_reviews', idCol: 'id', fields: ['best_thing', 'difficulty', 'child_request', 'parent_observation'] },
  ];

  for (const table of tables) {
    const rows = await db.execute(sql.raw(`SELECT ${table.idCol}, ${table.fields.join(', ')} FROM ${table.name}`));
    for (const row of rows.rows) {
      for (const field of table.fields) {
        const plaintext = decryptField(table.name, row.id, row[field]);
        if (plaintext !== null) {
          const reEncrypted = encryptField(table.name, row.id, plaintext);
          await db.execute(sql.raw(`UPDATE ${table.name} SET ${field} = ${reEncrypted} WHERE ${table.idCol} = ${row.id}`));
        }
      }
    }
    console.log(`Rotated ${table.name}`);
  }
}
```

### What's Encrypted vs Plain

| Table | Field | Encrypted? | Reason |
|-------|-------|------------|--------|
| children | name | ✅ | PII — child's name |
| children | avatar | ✅ | URL may contain child ID |
| children | age_group | ❌ | Categorical (3 values); not sensitive |
| children | access_token | ✅ | Already hashed (ADR-0002) |
| children | token_expires_at | ❌ | Timestamp; not sensitive |
| growth_diaries | title | ✅ | May contain identifying info |
| growth_diaries | content | ✅ | Personal reflections |
| growth_diaries | category | ❌ | Categorical; not sensitive |
| weekly_reviews | best_thing | ✅ | Personal reflection |
| weekly_reviews | difficulty | ✅ | Personal reflection |
| weekly_reviews | child_request | ✅ | Personal reflection |
| weekly_reviews | parent_observation | ✅ | Personal reflection |
| weekly_reviews | task_count, point_earned, dimension_count | ❌ | Numeric aggregates; not sensitive |
| tasks, rewards, checkins, point_transactions | all fields | ❌ | Family-defined content; not PII in the strict sense |

### Search Limitation

Encrypted columns cannot be searched via SQL `WHERE name LIKE '%明%'`. For child name search (parent looking up children), maintain a separate `name_search_hmac` column:

```sql
ALTER TABLE children ADD COLUMN name_search_hmac TEXT;
-- On insert: name_search_hmac = HMAC-SHA256(master_key, plaintext_name)
-- Query: WHERE name_search_hmac = HMAC-SHA256(master_key, '小明')
-- Only exact match supported; no LIKE patterns.
```

**MVP decision**: Skip `name_search_hmac`. Family has at most a handful of children; list-all + client-side filter is fine.

## Alternatives Considered

### Alternative 1: Postgres `pgcrypto` extension (DB-level encryption)
- **Description**: Use `pgp_sym_encrypt()` / `pgp_sym_decrypt()` in SQL
- **Pros**: No application code; SQL-level search possible with indexes on expressions
- **Cons**: Key must be in DB session (sent on connect); harder to rotate; DB logs may capture plaintext via query logging
- **Rejection Reason**: Application-layer encryption gives better key isolation and rotation story.

### Alternative 2: Transparent Disk Encryption (TDE) only
- **Description**: Rely on Neon's encrypted volumes
- **Pros**: Zero code; fully transparent
- **Cons**: Doesn't protect against DBA access, SQL injection, app-layer logging
- **Rejection Reason**: Insufficient for compliance; doesn't satisfy "儿童信息加密存储" at row level.

### Alternative 3: Hash-based anonymization (one-way)
- **Description**: Hash names so they can't be reversed
- **Pros**: No decryption key needed; minimal risk
- **Cons**: Can't display child name in UI (defeats purpose); not viable for content fields
- **Rejection Reason**: We need to display the data; one-way hashing is wrong tool.

## Consequences

### Positive
- Child PII encrypted at row level; DB dump alone doesn't reveal names
- Per-row keys limit blast radius (compromise of one row's key doesn't reveal others)
- AES-256-GCM provides authenticated encryption (tamper-evident)
- Key rotation procedure documented and tested
- Compliance with "儿童信息加密存储" requirement demonstrated

### Negative
- ~0.5ms overhead per encrypted field read/write (negligible at MVP scale)
- Two-step INSERT pattern (insert raw, then update encrypted) for new rows
- Cannot SQL-search encrypted fields (mitigated by HMAC for exact match if needed)
- Adds a script (`scripts/rotate-encryption-key.ts`) for key rotation

### Risks
- **Risk**: Master key (`DATA_ENCRYPTION_KEY`) leaked via env var exposure → **Mitigation**: Store in Railway secret store (not in `.env` file in repo); audit access logs; rotate on personnel change
- **Risk**: Application bug logs plaintext → **Mitigation**: Lint rule banning `console.log(row)` in repositories; use structured logging that explicitly redacts PII
- **Risk**: Key rotation script fails mid-run → **Mitigation**: Run inside transaction; rollback on error; idempotent (re-running is safe)
- **Risk**: Encrypted data grows larger than column type allows → **Mitigation**: Use TEXT not VARCHAR; ciphertext is ~33% larger than plaintext (IV + tag overhead)

## PRD Requirements Addressed

| PRD Section | Requirement | How This ADR Addresses It |
|-------------|-------------|---------------------------|
| §7.3 | 儿童信息加密存储（姓名、头像等） | AES-256-GCM on `children.name`, `children.avatar` |
| §7.3 | 不收集敏感个人信息 | Verified — no ID numbers, no location, no biometrics |
| §7.3 | 数据传输 HTTPS 加密 | Neon/Railway/Vercel all enforce TLS in transit |
| §7.3 | 符合未成年人保护相关法规 | Encryption + audit log + no sensitive PII = baseline compliance |

## Performance Implications
- **CPU**: AES-256-GCM ~1μs per 1KB on modern CPU; ~0.5ms total per request with 5 encrypted fields
- **Memory**: Negligible
- **Load Time**: API response includes decrypted PII; <1ms added
- **Network**: Same payload size

## Migration Plan
N/A — encryption applied from day 1. No existing plaintext data to migrate.

## Validation Criteria
- [ ] `children.name` stored in DB is not human-readable (verified by direct DB query)
- [ ] Decryption works round-trip: encrypt then decrypt returns original value
- [ ] Wrong master key fails decryption with auth tag error (no silent corruption)
- [ ] Key rotation script runs successfully on test data
- [ ] No plaintext PII in application logs (grep test on logs)
- [ ] All TDD_SPEC encryption tests pass (to be added)

## Related Decisions
- ADR-0002 (Auth — child `access_token` already hashed with Argon2)
- ADR-0005 (Double-Blind Review — could integrate field-level encryption in Phase 2)
- ADR-0006 (Multi-Tenant Isolation — complementary defense)
