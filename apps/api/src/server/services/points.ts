import { db, schema } from '../db/client.js';
import { sql, eq, and, desc } from 'drizzle-orm';
import type { DrizzleDB } from '../db/client.js';

const MAX_RETRIES = 3;

function isSerializationError(err: any): boolean {
  return err?.code === '40001' || err?.message?.includes('could not serialize');
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

export async function withSerializableRetry<T>(fn: () => Promise<T>): Promise<T> {
  let attempt = 0;
  while (true) {
    try {
      return await fn();
    } catch (err: any) {
      if (isSerializationError(err) && attempt < MAX_RETRIES) {
        attempt++;
        await sleep(50 * Math.pow(2, attempt));
        continue;
      }
      throw err;
    }
  }
}

export async function getBalance(childId: string): Promise<number> {
  const [last] = await db.select({ balanceAfter: schema.pointTransactions.balanceAfter })
    .from(schema.pointTransactions)
    .where(eq(schema.pointTransactions.childId, childId))
    .orderBy(desc(schema.pointTransactions.createdAt), desc(schema.pointTransactions.id))
    .limit(1);
  return last?.balanceAfter ?? 0;
}

export async function recordPointsTx(
  tx: DrizzleDB,
  childId: string,
  amount: number,
  sourceType: 'task' | 'reward' | 'revocation',
  sourceId: string,
): Promise<{ balanceAfter: number }> {
  await tx.execute(sql`SET TRANSACTION ISOLATION LEVEL SERIALIZABLE`);

  const last = await tx.execute(sql`
    SELECT balance_after FROM app.point_transactions
    WHERE child_id = ${childId}
    ORDER BY created_at DESC, id DESC
    LIMIT 1
    FOR UPDATE
  `);

  const currentBalance = Number(last.rows[0]?.balance_after ?? 0);
  const newBalance = currentBalance + amount;

  if (newBalance < 0) {
    throw { code: 3001, message: `Insufficient balance: need ${-amount}, have ${currentBalance}` };
  }

  const insertResult = await tx.execute(sql`
    INSERT INTO app.point_transactions (child_id, amount, source_type, source_id, balance_after)
    VALUES (${childId}, ${amount}, ${sourceType}, ${sourceId}, ${newBalance})
    RETURNING balance_after
  `);

  return { balanceAfter: Number(insertResult.rows[0]?.balance_after) };
}

export async function getChildPointsHistory(childId: string, limit = 50) {
  return db.select()
    .from(schema.pointTransactions)
    .where(eq(schema.pointTransactions.childId, childId))
    .orderBy(desc(schema.pointTransactions.createdAt))
    .limit(limit);
}

export async function getWeeklyPointsEarned(childId: string, weekStart: string): Promise<number> {
  const result = await db.execute(sql`
    SELECT COALESCE(SUM(amount), 0) as total FROM app.point_transactions
    WHERE child_id = ${childId}
      AND amount > 0
      AND created_at >= ${weekStart}::date
      AND created_at < ${weekStart}::date + INTERVAL '7 days'
  `);
  return Number(result.rows[0]?.total ?? 0);
}
