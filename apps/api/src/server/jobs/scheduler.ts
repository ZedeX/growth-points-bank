import cron from 'node-cron';
import { db, schema } from '../db/client.js';
import { eq, lt } from 'drizzle-orm';

export function startScheduler() {
  // Weekly review reminder - every Sunday 8pm
  cron.schedule('0 20 * * 0', async () => {
    console.log('[scheduler] Weekly review reminder job running...');
    // TODO: Send notifications to families
  });

  // Reward fulfillment reminder - daily 9am
  cron.schedule('0 9 * * *', async () => {
    console.log('[scheduler] Fulfillment reminder job running...');
    // Find approved but not fulfilled redemptions older than 3 days
    // TODO: Send reminder notifications
  });

  // Clean up expired notifications - daily 3am
  cron.schedule('0 3 * * *', async () => {
    console.log('[scheduler] Notification cleanup job running...');
    // Delete read notifications older than 30 days
  });

  console.log('[scheduler] All jobs scheduled.');
}
