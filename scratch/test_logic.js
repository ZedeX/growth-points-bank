// Verification script for index.html business logic
// Approach: parse the file, extract the <script> block, run it in a vm sandbox
// with mocked localStorage/document/window, then assert on the business logic.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const LOG_PATH = path.join(__dirname, 'test_logic.log');
const HTML_PATH = path.join(__dirname, '..', 'index.html');

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  fs.appendFileSync(LOG_PATH, line + '\n');
}

// Reset log
fs.writeFileSync(LOG_PATH, `=== Test run ${new Date().toISOString()} ===\n`);

// --- Mocks ---
const memStore = {};
const localStorageMock = {
  getItem: (k) => (k in memStore ? memStore[k] : null),
  setItem: (k, v) => { memStore[k] = String(v); },
  removeItem: (k) => { delete memStore[k]; },
  clear: () => { for (const k in memStore) delete memStore[k]; },
};

// Minimal document mock — only the methods the script uses at load time.
// At load time, index.html's script only references `document` in function bodies
// (not called immediately), so a no-op document is enough for the initial run.
const noop = () => {};
const elementMock = {
  innerHTML: '', value: '', style: {}, appendChild: noop, querySelector: noop,
  classList: { add: noop, remove: noop, contains: () => false },
  getContext: () => {
    const ctx = {};
    ['clearRect','beginPath','moveTo','lineTo','closePath','stroke','fill','fillText','arc','save','restore'].forEach(m => ctx[m] = noop);
    return ctx;
  },
  width: 280, height: 280,
};
const documentMock = {
  getElementById: () => elementMock,
  querySelector: () => null,
  createElement: () => elementMock,
  body: { appendChild: noop },
};

const windowMock = {};

const sandbox = {
  localStorage: localStorageMock,
  document: documentMock,
  window: windowMock,
  console,
  Date,
  Math,
  JSON,
  setTimeout: noop,
  parseInt,
  parseFloat,
  isNaN,
};
sandbox.global = sandbox;
vm.createContext(sandbox);

// --- Extract <script> block ---
const html = fs.readFileSync(HTML_PATH, 'utf8');
const m = html.match(/<script>([\s\S]*?)<\/script>/);
if (!m) {
  log('FAIL: could not find <script> block');
  process.exit(1);
}
const scriptCode = m[1];
log(`Extracted script: ${scriptCode.length} chars`);

// --- Run script ---
// top-level `let`/`const` in vm contexts are NOT exposed on globalThis,
// so we append a getter to expose `state` for assertions.
const wrappedCode = scriptCode + `
;Object.defineProperty(globalThis, 'state', {
  get() { return state; },
  set(v) { state = v; },
  configurable: true,
});
`;
try {
  vm.runInContext(wrappedCode, sandbox, { filename: 'index.html.script' });
  log('Script loaded OK');
} catch (e) {
  log(`FAIL: script load error: ${e.message}`);
  log(e.stack);
  process.exit(1);
}

// --- Test helpers ---
let pass = 0, fail = 0;
function assert(name, cond, extra = '') {
  if (cond) {
    pass++;
    log(`  PASS: ${name}`);
  } else {
    fail++;
    log(`  FAIL: ${name} ${extra}`);
  }
}

// Reset state before tests
sandbox.resetData();

// --- T01: seed data integrity ---
log('\n[T01] seed data');
assert('5 dimensions', sandbox.state.dimensions.length === 5, `got ${sandbox.state.dimensions.length}`);
assert('15 tasks', sandbox.state.tasks.length === 15, `got ${sandbox.state.tasks.length}`);
assert('6 rewards', sandbox.state.rewards.length === 6, `got ${sandbox.state.rewards.length}`);
assert('1 child', sandbox.state.children.length === 1, `got ${sandbox.state.children.length}`);
assert('0 checkins at seed', sandbox.state.checkins.length === 0);
assert('0 txs at seed', sandbox.state.pointTransactions.length === 0);
assert('balance c1 == 0', sandbox.getBalance('c1') === 0);

// --- T02: checkin adds 1 checkin + 1 tx with correct amount ---
log('\n[T02] checkin first task');
const before = sandbox.state.checkins.length;
const txb = sandbox.state.pointTransactions.length;
const ok1 = sandbox.checkin('c1', 't1');
assert('checkin returns true', ok1 === true);
assert('checkins +1', sandbox.state.checkins.length === before + 1);
assert('txs +1', sandbox.state.pointTransactions.length === txb + 1);
const task1 = sandbox.state.tasks.find(t => t.id === 't1');
assert('balance == t1.pointValue', sandbox.getBalance('c1') === task1.pointValue, `got ${sandbox.getBalance('c1')}, expected ${task1.pointValue}`);
const lastTx = sandbox.state.pointTransactions[sandbox.state.pointTransactions.length - 1];
assert('tx amount == pointValue', lastTx.amount === task1.pointValue);
assert('tx sourceType == task', lastTx.sourceType === 'task');

// --- T03: duplicate checkin rejected ---
log('\n[T03] duplicate checkin blocked');
const ok2 = sandbox.checkin('c1', 't1');
assert('duplicate returns false', ok2 === false);
assert('checkins count unchanged', sandbox.state.checkins.length === before + 1);
assert('balance unchanged', sandbox.getBalance('c1') === task1.pointValue);

// --- T04: checkin different task adds correctly ---
log('\n[T04] second task checkin');
const ok3 = sandbox.checkin('c1', 't3');
assert('checkin t3 returns true', ok3 === true);
const task3 = sandbox.state.tasks.find(t => t.id === 't3');
const expectedBal = task1.pointValue + task3.pointValue;
assert('balance == sum', sandbox.getBalance('c1') === expectedBal, `got ${sandbox.getBalance('c1')}, expected ${expectedBal}`);

// --- T05: checkin inactive task rejected ---
log('\n[T05] inactive task blocked');
sandbox.state.tasks.find(t => t.id === 't5').isActive = false;
const ok4 = sandbox.checkin('c1', 't5');
assert('inactive checkin returns false', ok4 === false);
assert('no new checkin', sandbox.state.checkins.length === 2);

// --- T06: createRedemption with insufficient balance ---
log('\n[T06] insufficient balance redemption');
const bal0 = sandbox.getBalance('c1');
// Pick a reward that costs more than current balance
const expensive = sandbox.state.rewards.find(r => r.pointCost > bal0) || sandbox.state.rewards.find(r => r.id === 'r5');
const ok5 = sandbox.createRedemption('c1', expensive.id, 'test');
assert('insufficient returns false', ok5 === false);
assert('no redemption created', sandbox.state.redemptions.length === 0);
assert('no new tx', sandbox.state.pointTransactions.length === 2);

// --- T07: createRedemption with sufficient balance ---
log('\n[T07] successful redemption');
sandbox.resetData();
// Earn 60 points first: t3(20) + t6(20) + t14(30) = 70
sandbox.checkin('c1', 't3');
sandbox.checkin('c1', 't6');
sandbox.checkin('c1', 't14');
const bal1 = sandbox.getBalance('c1');
assert('earned 70 pts', bal1 === 70, `got ${bal1}`);
const r5 = sandbox.state.rewards.find(r => r.id === 'r5');
assert('r5 costs 60', r5.pointCost === 60);
const ok6 = sandbox.createRedemption('c1', 'r5', 'trying my best');
assert('redemption returns true', ok6 === true);
assert('redemption created', sandbox.state.redemptions.length === 1);
assert('balance == 10 after redemption', sandbox.getBalance('c1') === 10, `got ${sandbox.getBalance('c1')}`);
const rdm = sandbox.state.redemptions[0];
assert('redemption status pending', rdm.status === 'pending');
assert('redemption pointCost 60', rdm.pointCost === 60);

// --- T08: approveRedemption ---
log('\n[T08] approve redemption');
const ok7 = sandbox.approveRedemption(rdm.id);
assert('approve returns true', ok7 === true);
assert('status approved', sandbox.state.redemptions[0].status === 'approved');
assert('reviewedAt set', sandbox.state.redemptions[0].reviewedAt !== '');

// --- T09: approve wrong state rejected ---
log('\n[T09] re-approve rejected');
const ok8 = sandbox.approveRedemption(rdm.id);
assert('re-approve returns false', ok8 === false);

// --- T10: fulfillRedemption ---
log('\n[T10] fulfill redemption');
const ok9 = sandbox.fulfillRedemption(rdm.id);
assert('fulfill returns true', ok9 === true);
assert('status fulfilled', sandbox.state.redemptions[0].status === 'fulfilled');
assert('fulfilledAt set', sandbox.state.redemptions[0].fulfilledAt !== '');

// --- T11: fulfill wrong state rejected ---
log('\n[T11] re-fulfill rejected');
const ok10 = sandbox.fulfillRedemption(rdm.id);
assert('re-fulfill returns false', ok10 === false);

// --- T12: dimension progress ---
log('\n[T12] dimension progress');
sandbox.resetData();
// d1 has t1, t2, t3 (3 tasks)
const prog0 = sandbox.getDimensionProgress('d1', sandbox.today(), 'c1');
assert('d1 0/3', prog0.completed === 0 && prog0.total === 3, `got ${prog0.completed}/${prog0.total}`);
assert('d1 not lit', prog0.lit === false);
sandbox.checkin('c1', 't1');
const prog1 = sandbox.getDimensionProgress('d1', sandbox.today(), 'c1');
assert('d1 1/3', prog1.completed === 1 && prog1.total === 3);
assert('d1 not lit (1/3)', prog1.lit === false);
sandbox.checkin('c1', 't2');
sandbox.checkin('c1', 't3');
const prog3 = sandbox.getDimensionProgress('d1', sandbox.today(), 'c1');
assert('d1 3/3', prog3.completed === 3 && prog3.total === 3);
assert('d1 lit', prog3.lit === true);

// --- T13: addTask / deleteTask ---
log('\n[T13] task management');
const before7 = sandbox.state.tasks.length;
sandbox.addTask({ dimensionId: 'd1', title: 'test task', pointValue: '15' });
assert('task added', sandbox.state.tasks.length === before7 + 1);
const newTask = sandbox.state.tasks[sandbox.state.tasks.length - 1];
assert('new task pointValue 15 (parsed)', newTask.pointValue === 15, `got ${newTask.pointValue}`);
assert('new task isActive', newTask.isActive === true);
sandbox.deleteTask(newTask.id);
assert('task deleted', sandbox.state.tasks.length === before7);

// --- T14: addReward / deleteReward ---
log('\n[T14] reward management');
const rb = sandbox.state.rewards.length;
sandbox.addReward({ tier: 'small', pointCost: '20', title: 'test reward', description: 'desc' });
assert('reward added', sandbox.state.rewards.length === rb + 1);
const newR = sandbox.state.rewards[sandbox.state.rewards.length - 1];
assert('new reward pointCost 20', newR.pointCost === 20);
assert('new reward isActive', newR.isActive === true);
sandbox.deleteReward(newR.id);
assert('reward deleted', sandbox.state.rewards.length === rb);

// --- T15: persistence to localStorage ---
log('\n[T15] persistence');
sandbox.checkin('c1', 't1');
const stored = localStorageMock.getItem('gpb_data');
assert('state stored in localStorage', stored !== null);
const parsed = JSON.parse(stored);
assert('stored has checkins', Array.isArray(parsed.checkins) && parsed.checkins.length > 0);
assert('stored has pointTransactions', Array.isArray(parsed.pointTransactions) && parsed.pointTransactions.length > 0);

// --- T16: resetData clears ---
log('\n[T16] resetData');
sandbox.resetData();
assert('checkins cleared', sandbox.state.checkins.length === 0);
assert('txs cleared', sandbox.state.pointTransactions.length === 0);
assert('redemptions cleared', sandbox.state.redemptions.length === 0);
assert('balance back to 0', sandbox.getBalance('c1') === 0);

// --- Summary ---
log(`\n=== RESULT: ${pass} passed, ${fail} failed ===`);
process.exit(fail > 0 ? 1 : 0);
