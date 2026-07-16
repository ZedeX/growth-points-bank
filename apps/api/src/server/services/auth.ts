import { db, schema } from '../db/client.js';
import { eq, and } from 'drizzle-orm';
import * as argon2 from 'argon2';
import { signParentToken, signChildToken } from '../middleware/auth.js';
import { generateAndHashToken, hashAccessToken } from '../crypto/auth-token.js';
import { encryptField, decryptField } from '../crypto/field-crypto.js';

export async function registerParent(input: {
  email?: string; phone?: string; password: string; family_name: string; parent_name: string;
}) {
  const passwordHash = await argon2.hash(input.password, {
    type: argon2.argon2id,
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
  });

  return db.transaction(async (tx) => {
    const [family] = await tx.insert(schema.families).values({
      name: input.family_name,
    }).returning();

    const [parent] = await tx.insert(schema.parents).values({
      familyId: family.id,
      email: input.email || null,
      phone: input.phone || null,
      name: input.parent_name,
      passwordHash,
    }).returning();

    // Seed default dimensions
    await seedDefaultDimensions(tx, family.id);

    const token = await signParentToken({ sub: parent.id, family_id: family.id });
    return { token, family, parent: { id: parent.id, name: parent.name, email: parent.email, phone: parent.phone } };
  });
}

export async function loginParent(emailOrPhone: string, password: string) {
  const [parent] = await db.select().from(schema.parents)
    .where(
      eq(schema.parents.email, emailOrPhone)
    ).limit(1);

  const [parentByPhone] = parent ? [parent] : await db.select().from(schema.parents)
    .where(eq(schema.parents.phone, emailOrPhone)).limit(1);

  const found = parentByPhone;
  if (!found) {
    throw { code: 1003, message: 'Invalid credentials' };
  }

  const valid = await argon2.verify(found.passwordHash, password);
  if (!valid) {
    throw { code: 1003, message: 'Invalid credentials' };
  }

  const token = await signParentToken({ sub: found.id, family_id: found.familyId });
  return { token, parent: { id: found.id, name: found.name, email: found.email, phone: found.phone, familyId: found.familyId } };
}

export async function createChild(familyId: string, input: { name: string; age_group: string; avatar?: string }) {
  const { plaintext, hashed } = generateAndHashToken();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  if (process.env.NODE_ENV === 'test') console.log('[createChild] entering db.transaction');
  return db.transaction(async (tx) => {
    if (process.env.NODE_ENV === 'test') console.log('[createChild] inside tx, inserting child');
    const [child] = await tx.insert(schema.children).values({
      familyId,
      name: input.name,  // will be encrypted in update below
      ageGroup: input.age_group,
      avatar: input.avatar || null,
      accessToken: hashed,
      tokenExpiresAt: expiresAt,
      tokenVersion: 1,
    }).returning();
    if (process.env.NODE_ENV === 'test') console.log('[createChild] child inserted, encrypting fields');

    // Encrypt PII fields now that we have the ID
    await tx.update(schema.children).set({
      name: encryptField('children', child.id, input.name),
      avatar: encryptField('children', child.id, input.avatar || null),
    }).where(eq(schema.children.id, child.id));
    if (process.env.NODE_ENV === 'test') console.log('[createChild] fields encrypted, returning');

    return {
      id: child.id,
      familyId: child.familyId,
      name: input.name,
      ageGroup: child.ageGroup,
      accessToken: plaintext,  // returned once for parent to share
      tokenExpiresAt: expiresAt.toISOString(),
    };
  });
}

export async function getChildByToken(plaintextToken: string) {
  const hashed = hashAccessToken(plaintextToken);
  const [child] = await db.select().from(schema.children)
    .where(eq(schema.children.accessToken, hashed))
    .limit(1);

  if (!child) return null;
  if (child.tokenExpiresAt && child.tokenExpiresAt < new Date()) return null;

  return child;
}

export async function regenerateChildToken(childId: string, familyId: string) {
  const { plaintext, hashed } = generateAndHashToken();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  await db.update(schema.children).set({
    accessToken: hashed,
    tokenExpiresAt: expiresAt,
    tokenVersion: (await db.select().from(schema.children).where(eq(schema.children.id, childId)).limit(1))[0].tokenVersion + 1,
  }).where(and(eq(schema.children.id, childId), eq(schema.children.familyId, familyId)));

  return { accessToken: plaintext, tokenExpiresAt: expiresAt.toISOString() };
}

export async function getChildrenForFamily(familyId: string) {
  const rows = await db.select().from(schema.children)
    .where(eq(schema.children.familyId, familyId));

  return rows.map(c => ({
    id: c.id,
    familyId: c.familyId,
    name: decryptField('children', c.id, c.name),
    ageGroup: c.ageGroup,
    avatar: decryptField('children', c.id, c.avatar),
    tokenExpiresAt: c.tokenExpiresAt?.toISOString() ?? null,
    tokenVersion: c.tokenVersion,
    createdAt: c.createdAt.toISOString(),
  }));
}

export async function getChildById(childId: string, familyId: string) {
  const [c] = await db.select().from(schema.children)
    .where(and(eq(schema.children.id, childId), eq(schema.children.familyId, familyId)))
    .limit(1);
  if (!c) return null;

  return {
    id: c.id,
    familyId: c.familyId,
    name: decryptField('children', c.id, c.name),
    ageGroup: c.ageGroup,
    avatar: decryptField('children', c.id, c.avatar),
    tokenExpiresAt: c.tokenExpiresAt?.toISOString() ?? null,
    tokenVersion: c.tokenVersion,
    createdAt: c.createdAt.toISOString(),
  };
}

async function seedDefaultDimensions(tx: any, familyId: string) {
  const defaults = [
    { code: 'learning', name: '学习力', color: '#2196F3', sortOrder: 1 },
    { code: 'sports', name: '运动力', color: '#FF9800', sortOrder: 2 },
    { code: 'self_control', name: '自控力', color: '#9C27B0', sortOrder: 3 },
    { code: 'exploration', name: '探索力', color: '#4CAF50', sortOrder: 4 },
    { code: 'practice', name: '实践力', color: '#F44336', sortOrder: 5 },
  ];

  for (const d of defaults) {
    await tx.insert(schema.growthDimensions).values({
      familyId,
      code: d.code,
      name: d.name,
      color: d.color,
      isDefault: true,
      sortOrder: d.sortOrder,
    });
  }
}
