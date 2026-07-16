import { db, schema } from '../db/client.js';
import { sql, eq, and, desc } from 'drizzle-orm';
import type { DrizzleDB } from '../db/client.js';

export async function withSerializableRetry<T>(fn: () => Promise<T>): Promise<T> {
  return fn();
}

export async function getBalance(childId: string): Promise<number> {
  const [last] = await db.select({ balanceAfter: schema.pointTransactions.balanceAfter })
    .from(schema.pointTransactions)
    .where(eq(schema.pointTransactions.childId, childId))
    .orderBy(desc(schema.pointTransactions.createdAt), desc(sql`rowid`))
    .limit(1);
  return last?.balanceAfter ?? 0;
}

export function recordPointsTx(
  tx: DrizzleDB,
  childId: string,
  amount: number,
  sourceType: 'task' | 'reward' | 'revocation',
  sourceId: string,
): { balanceAfter: number } {
  const last = tx.get(sql`
    SELECT balance_after FROM point_transactions
    WHERE child_id = ${childId}
    ORDER BY created_at DESC, id DESC
    LIMIT 1
  `) as { balance_after: number } | undefined;

  const currentBalance = Number(last?.balance_after ?? 0);
  const newBalance = currentBalance + amount;

  if (newBalance < 0) {
    throw { code: 3001, message: `Insufficient balance: need ${-amount}, have ${currentBalance}` };
  }

  const now = new Date().toISOString();
  const insertResult = tx.get(sql`
    INSERT INTO point_transactions (child_id, amount, source_type, source_id, balance_after, created_at)
    VALUES (${childId}, ${amount}, ${sourceType}, ${sourceId}, ${newBalance}, ${now})
    RETURNING balance_after
  `) as { balance_after: number } | undefined;

  return { balanceAfter: Number(insertResult?.balance_after) };
}

export async function getChildPointsHistory(childId: string, limit = 50) {
  return db.select()
    .from(schema.pointTransactions)
    .where(eq(schema.pointTransactions.childId, childId))
    .orderBy(desc(schema.pointTransactions.createdAt), desc(sql`rowid`))
    .limit(limit);
}

export async function getWeeklyPointsEarned(childId: string, weekStart: string): Promise<number> {
  const result = db.get(sql`
    SELECT COALESCE(SUM(amount), 0) as total FROM point_transactions
    WHERE child_id = ${childId}
      AND amount > 0
      AND created_at >= ${weekStart}
      AND created_at < date(${weekStart}, '+7 days')
  `) as { total: number } | undefined;
  return Number(result?.total ?? 0);
}
