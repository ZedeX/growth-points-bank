// @ts-check
const { test, expect } = require('@playwright/test');
const path = require('path');

const HTML_PATH = `file://${path.resolve(__dirname, '..', 'index.html')}`;

// Helper: switch role via the top selector
async function switchRole(page, role) {
  await page.selectOption('[data-role-switch]', role);
}

// Helper: switch bottom tab
async function switchTab(page, tabId) {
  await page.click(`[data-tab="${tabId}"]`);
}

// Helper: reset to seed data
async function reset(page) {
  await page.evaluate(() => resetData());
}

test.beforeEach(async ({ page }) => {
  await page.goto(HTML_PATH);
  await reset(page);
});

test.describe('T01-T02: Checkin + duplicate block', () => {
  test('T01: child checks in one task → +10 points', async ({ page }) => {
    await switchRole(page, 'child');
    await switchTab(page, 'checkin');
    await page.click('[data-task-checkin="t1"]');
    const balance = await page.evaluate(() => getBalance('c1'));
    expect(balance).toBe(10);
    const checkins = await page.evaluate(() => getData().checkins.length);
    expect(checkins).toBe(1);
  });

  test('T02: duplicate checkin same day → blocked', async ({ page }) => {
    await switchRole(page, 'child');
    await switchTab(page, 'checkin');
    await page.click('[data-task-checkin="t1"]');
    // second click should not create another checkin
    await page.click('[data-task-checkin="t1"]');
    const balance = await page.evaluate(() => getBalance('c1'));
    expect(balance).toBe(10); // unchanged
    const checkins = await page.evaluate(() => getData().checkins.length);
    expect(checkins).toBe(1);
  });
});

test.describe('T03: dimension lit when all tasks done', () => {
  test('d1 (3 tasks) → 100% after t1+t2+t3', async ({ page }) => {
    await switchRole(page, 'child');
    await switchTab(page, 'checkin');
    await page.click('[data-task-checkin="t1"]');
    await page.click('[data-task-checkin="t2"]');
    await page.click('[data-task-checkin="t3"]');
    const prog = await page.evaluate(() => {
      const t = new Date().toISOString().split('T')[0];
      return getDimensionProgress('d1', t, 'c1');
    });
    expect(prog.completed).toBe(3);
    expect(prog.total).toBe(3);
    expect(prog.lit).toBe(true);
  });
});

test.describe('T05: balance calculation', () => {
  test('3 tasks → 10+10+20 = 40', async ({ page }) => {
    await switchRole(page, 'child');
    await switchTab(page, 'checkin');
    await page.click('[data-task-checkin="t1"]');
    await page.click('[data-task-checkin="t2"]');
    await page.click('[data-task-checkin="t3"]');
    const balance = await page.evaluate(() => getBalance('c1'));
    expect(balance).toBe(40);
    // Verify points view shows same balance
    await switchTab(page, 'points');
    const displayed = await page.locator('.balance-box .num').first().textContent();
    expect(parseInt(displayed.trim(), 10)).toBe(40);
  });
});

test.describe('T06-T07: redemption + insufficient balance', () => {
  test('T07: insufficient balance → button disabled', async ({ page }) => {
    await switchRole(page, 'child');
    await switchTab(page, 'rewards');
    const disabled = await page.locator('[data-redeem="r5"]').isDisabled();
    expect(disabled).toBe(true); // r5 costs 60, balance 0
  });

  test('T06: redeem r3 (30pts) with 40 balance → -30', async ({ page }) => {
    // earn 40 first
    await switchRole(page, 'child');
    await switchTab(page, 'checkin');
    await page.click('[data-task-checkin="t1"]');
    await page.click('[data-task-checkin="t2"]');
    await page.click('[data-task-checkin="t3"]');
    // redeem r3
    await switchTab(page, 'rewards');
    await page.click('[data-redeem="r3"]');
    // modal: confirm
    await page.click('text=确认兑换');
    const balance = await page.evaluate(() => getBalance('c1'));
    expect(balance).toBe(10); // 40 - 30
    const data = await page.evaluate(() => getData());
    expect(data.redemptions.length).toBe(1);
    expect(data.redemptions[0].status).toBe('pending');
    expect(data.redemptions[0].pointCost).toBe(30);
  });
});

test.describe('T08-T10: full redemption state machine', () => {
  test('T08+T09+T10: pending → approved → fulfilled', async ({ page }) => {
    // Child earns 40 and redeems r3
    await switchRole(page, 'child');
    await switchTab(page, 'checkin');
    await page.click('[data-task-checkin="t1"]');
    await page.click('[data-task-checkin="t2"]');
    await page.click('[data-task-checkin="t3"]');
    await switchTab(page, 'rewards');
    await page.click('[data-redeem="r3"]');
    await page.click('text=确认兑换');

    // Switch to parent and approve
    await switchRole(page, 'parent');
    await switchTab(page, 'redemptions');
    await page.click('[data-approve-redemption]');
    let data = await page.evaluate(() => getData());
    expect(data.redemptions[0].status).toBe('approved');

    // Mark fulfilled
    await page.click('[data-fulfill-redemption]');
    data = await page.evaluate(() => getData());
    expect(data.redemptions[0].status).toBe('fulfilled');
  });
});

test.describe('T11: parent adds task', () => {
  test('create task → visible to child', async ({ page }) => {
    await switchRole(page, 'parent');
    await switchTab(page, 'tasks');
    await page.click('[data-new-task]');
    await page.fill('#taskTitle', '背10个单词');
    await page.selectOption('#taskDim', 'd1');
    await page.fill('#taskPoints', '15');
    await page.click('text=保存');
    // Verify task appears in state
    const data = await page.evaluate(() => getData());
    const newTask = data.tasks.find(t => t.title === '背10个单词');
    expect(newTask).toBeTruthy();
    expect(newTask.pointValue).toBe(15);
    expect(newTask.dimensionId).toBe('d1');
    // Switch to child and check it's visible in checkin view
    await switchRole(page, 'child');
    await switchTab(page, 'checkin');
    await page.click(`[data-task-checkin="${newTask.id}"]`);
    const balance = await page.evaluate(() => getBalance('c1'));
    expect(balance).toBe(15);
  });
});

test.describe('T12: parent deletes task', () => {
  test('delete task → removed but history preserved', async ({ page }) => {
    // First checkin t1 to create history
    await switchRole(page, 'child');
    await switchTab(page, 'checkin');
    await page.click('[data-task-checkin="t1"]');
    const beforeBalance = await page.evaluate(() => getBalance('c1'));
    expect(beforeBalance).toBe(10);

    // Parent deletes t1
    await switchRole(page, 'parent');
    await switchTab(page, 'tasks');
    page.on('dialog', d => d.accept());
    await page.click('[data-delete-task="t1"]');
    // Task removed
    const data = await page.evaluate(() => getData());
    expect(data.tasks.find(t => t.id === 't1')).toBeUndefined();
    // History preserved
    expect(data.checkins.length).toBe(1);
    expect(data.pointTransactions.length).toBe(1);
    expect(await page.evaluate(() => getBalance('c1'))).toBe(10);
  });
});

test.describe('T13: parent adds reward', () => {
  test('create reward → visible to child', async ({ page }) => {
    await switchRole(page, 'parent');
    await switchTab(page, 'rewards');
    await page.click('[data-new-reward]');
    await page.fill('#rewardTitle', '去游乐园');
    await page.selectOption('#rewardTier', 'large');
    await page.fill('#rewardCost', '60');
    await page.fill('#rewardDesc', '全家去游乐园玩一天');
    await page.click('text=保存');
    const data = await page.evaluate(() => getData());
    const newReward = data.rewards.find(r => r.title === '去游乐园');
    expect(newReward).toBeTruthy();
    expect(newReward.tier).toBe('large');
    expect(newReward.pointCost).toBe(60);
  });
});

test.describe('T14: persistence across reload', () => {
  test('reload preserves all state', async ({ page }) => {
    await switchRole(page, 'child');
    await switchTab(page, 'checkin');
    await page.click('[data-task-checkin="t1"]');
    await page.click('[data-task-checkin="t3"]');
    const beforeBalance = await page.evaluate(() => getBalance('c1'));
    const beforeCheckins = await page.evaluate(() => getData().checkins.length);
    expect(beforeBalance).toBe(30); // 10 + 20
    expect(beforeCheckins).toBe(2);

    await page.reload();

    const afterBalance = await page.evaluate(() => getBalance('c1'));
    const afterCheckins = await page.evaluate(() => getData().checkins.length);
    expect(afterBalance).toBe(30);
    expect(afterCheckins).toBe(2);
  });
});

test.describe('T15: seed data integrity', () => {
  test('seed has 5 dimensions / 15 tasks / 6 rewards / 1 child', async ({ page }) => {
    const data = await page.evaluate(() => getData());
    expect(data.dimensions.length).toBe(5);
    expect(data.tasks.length).toBe(15);
    expect(data.rewards.length).toBe(6);
    expect(data.children.length).toBe(1);
    expect(data.checkins.length).toBe(0);
    expect(data.pointTransactions.length).toBe(0);
    expect(data.redemptions.length).toBe(0);
  });
});
