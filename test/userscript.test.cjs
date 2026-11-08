// test/userscript.test.cjs — 针对发布产物 pokebonk-afk.user.js 的行为断言（3.3.6）
// 不依赖浏览器：把用户脚本里的纯函数切出来，用假的 run/settings 跑策略与优先级。
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const FILE = path.join(__dirname, '..', 'pokebonk-afk.user.js');
const js = fs.readFileSync(FILE, 'utf8');

/* ------------------------------------------------------------------ 工具 */
function sliceBalanced(src, startMarker, open = '{', close = '}') {
  const start = src.indexOf(startMarker);
  assert.ok(start >= 0, 'marker not found: ' + startMarker);
  let i = src.indexOf(open, start), depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === open) depth++;
    else if (src[i] === close) { depth--; if (depth === 0) return src.slice(start, i + 1); }
  }
  throw new Error('unbalanced: ' + startMarker);
}

/* ------------------------------------------------------------------ 1. 版本与构建白名单 */
assert.ok(/@version\s+3\.3\.9/.test(js), '@version should be 3.3.9');
assert.ok(/__pbAfkVersion='3\.3\.9'/.test(js), 'runtime version marker should be 3.3.9');
const builds = /const SUPPORTED_BUILDS = new Set\(\[([^\]]*)\]\)/.exec(js)[1];
for (const b of ['mvob1c8t', 'mvpdimhl', 'mvpjh5lt', 'mvpt1dlr', 'mvxmqseg', 'mvywlxn8', 'mw4qh5au']) {
  assert.ok(builds.includes("'" + b + "'"), 'build whitelisted: ' + b);
}
console.log('ok  version + build whitelist (mw4qh5au)');

/* ------------------------------------------------------------------ 2. 连接器仍能认出 0.8.9x 的模块布局 */
const bootFixture = 'const m={f:["./main-BhO0ff4G-mw4qh5au.js","./defineProperty-YtxLpqQz-mw4qh5au.js"]};'
  + 'Promise.all([import(`./main-BhO0ff4G-mw4qh5au.js`)]);';
const mainFixture = 'import"./modulepreload-polyfill-P2Xu9kJm-mw4qh5au.js";import{a}from"./i18n-BGHWfjZr-mw4qh5au.js";'
  + 'import"./defineProperty-YtxLpqQz-mw4qh5au.js";export{xS as App};';
const importRe = /import\(\s*['"`]([^'"`]*main-[^'"`]+\.js)['"`]\s*\)/g;
const hits = [...bootFixture.matchAll(importRe)].map(m => m[1]);
assert.deepStrictEqual(hits, ['./main-BhO0ff4G-mw4qh5au.js'], 'boot dynamic import discovery');
const dataPathRe = /['"`](\.\/(?:defineProperty|news)-[^'"`]+\.js)['"`]/;
const dp = dataPathRe.exec(mainFixture);
assert.strictEqual(dp && dp[1], './defineProperty-YtxLpqQz-mw4qh5au.js', 'data module discovery');
// 这三个正则必须与脚本里的完全一致，否则说明产物被改动
assert.ok(js.includes("/import\\(\\s*['\"\\x60]([^'\"\\x60]*main-[^'\"\\x60]+\\.js)['\"\\x60]\\s*\\)/g"), 'script keeps boot import regex');
assert.ok(js.includes("['\"\\x60](\\.\\/(?:defineProperty|news)-[^'\"\\x60]+\\.js)['\"\\x60]"), 'script keeps data path regex');
console.log('ok  connect regexes still match the mw4qh5au layout');

/* ------------------------------------------------------------------ 3. mapTaskPolicy */
const policySrc = sliceBalanced(js, 'function mapTaskPolicy(');
const makePolicy = new Function(
  'performance', 'spendingAllowed', 'slotAllowed',
  policySrc + '\nreturn mapTaskPolicy;'
)(
  { now: () => 1000 },
  () => ({ ok: true, reason: '' }),
  () => ({ ok: true, reason: '' })
);

const S = {
  autoTower: true, autoAltar: true, autoComet: true, autoExpedition: true,
  autoExtract: false, autoTowerTrick: true, autoDitto: true, autoFossil: true,
  autoSnorlax: true, autoFusion: true, autoShop: true, autoSlots: true,
  banishMoves: [], banishVitamins: [], guardianWindow: 60, reserve: '0',
  itemPriority: [], itemMode: 'auto', itemStatFallback: true,
};
const run0 = { endless: true, stageTime: 0, gold: 0, interactables: { list: [] } };
const plan0 = { items: [], fus: [] };
const L = { shopSpent: 0, slotSpent: 0, slotSpins: 0 };

const altar = (data) => ({ kind: 'altar', data });
const policy = (item, settings = S, run = run0) => makePolicy(item, settings, plan0, run, L);

// 3.1 陨星碎片：绕过 autoAltar，受 autoComet 控制
assert.ok(policy(altar({ tier: 4, comet: true, life: 60 })) !== null, 'comet altar is a target');
assert.strictEqual(policy(altar({ tier: 4, comet: true, life: 60 }), { ...S, autoAltar: false }).label, '陨星碎片·限时',
  'comet stays a target even with autoAltar off');
assert.strictEqual(policy(altar({ tier: 4, comet: true, life: 60 }), { ...S, autoComet: false }), null,
  'autoComet=false skips the comet');
assert.strictEqual(policy(altar({ tier: 2 }), { ...S, autoAltar: false }), null, 'plain altar still honours autoAltar');

// 3.2 远征：crate / vault 受 autoExpedition 控制
const crate = { kind: 'exp', data: { sub: 'crate', tier: 2 } };
const vault = { kind: 'exp', data: { sub: 'vault', guard: 1 } };
assert.strictEqual(policy(crate).label, '远征补给箱');
assert.strictEqual(policy(vault).label, '远征宝库');
assert.strictEqual(policy(crate, { ...S, autoExpedition: false }), null, 'autoExpedition=false skips crates');

// 3.3 远征撤离点：只在游戏判定窗口开启时给目标；默认不开 autoExtract
const exitItem = { kind: 'exp', data: { sub: 'exit', k: 0 } };
assert.strictEqual(policy(exitItem, { ...S, autoExtract: true }), null, 'closed exit is skipped even with autoExtract');
assert.strictEqual(policy(exitItem), null, 'autoExtract defaults off');
assert.strictEqual(
  policy(exitItem, { ...S, autoExtract: true }, { ...run0, expedition: { openExit: exitItem } }).label,
  '远征撤离点', 'open exit (openExit===item) is a target');
const winRun = { ...run0, expedition: { openExit: null, nextWindow: () => ({ at: 10, exit: exitItem }) } };
assert.strictEqual(policy(exitItem, { ...S, autoExtract: true }, winRun).label, '远征撤离点',
  'exit announced by nextWindow() is a target');
assert.strictEqual(policy(exitItem, { ...S, autoExtract: true }, { ...run0, expedition: { openExit: {} } }), null,
  'a different open exit does not unlock this one');

// 3.4 紫苑塔墓碑
const trick = { kind: 'tower', data: { sub: 'trick' } };
const stairs = { kind: 'tower', data: { sub: 'stairs' } };
assert.strictEqual(policy(trick).label, '塔内墓碑·抽奖');
assert.strictEqual(policy(trick, { ...S, autoTowerTrick: false }), null, 'autoTowerTrick=false skips the grave');
assert.strictEqual(policy({ kind: 'tower', data: { sub: 'leave' } }), null, 'tower leave is never clicked');
assert.strictEqual(policy(stairs, S, { ...run0, tower: { state: 'fight' } }), null, 'stairs only when floor cleared');
assert.ok(policy(stairs, S, { ...run0, tower: { state: 'clear' } }) !== null, 'stairs when floor cleared');

// 3.5 新地图物件：dojo / shroom / challenge 依旧不碰
for (const kind of ['dojo', 'shroom', 'challenge', 'cursed']) {
  assert.strictEqual(policy({ kind, data: {} }), null, 'not targeted: ' + kind);
}
console.log('ok  mapTaskPolicy: comet / expedition / tower-trick gates');

/* ------------------------------------------------------------------ 4. 优先级 */
const prioStart = js.indexOf("priority:(item.kind==='tower'&&item.data?.sub==='leave')");
assert.ok(prioStart > 0, 'priority expression found');
const prioEnd = js.indexOf('});', prioStart);
const prioExpr = js.slice(prioStart + 'priority:'.length, prioEnd);
const prio = new Function('item', 'holding', 'order', 'return ' + prioExpr);
const order = ['portal', 'tower', 'exp', 'bonk', 'boss', 'chest'];

assert.strictEqual(prio({ kind: 'exp', data: { sub: 'exit' } }, false, order), -2.2, 'exit outranks the portal');
assert.strictEqual(prio({ kind: 'altar', data: { comet: true } }, false, order), -1.9, 'comet right behind the exit');
assert.strictEqual(prio({ kind: 'portal', data: {} }, false, order), -2, 'portal keeps -2');
assert.strictEqual(prio({ kind: 'tower', data: { sub: 'stairs' } }, false, order), -1.5, 'tower keeps -1.5');
assert.strictEqual(prio({ kind: 'bonk', data: {} }, false, order), -1, 'bonk keeps -1');
assert.strictEqual(prio({ kind: 'exp', data: { sub: 'crate' } }, false, order), 3 + 2, 'crate follows the task order');
assert.strictEqual(prio({ kind: 'chest', data: {} }, false, ['portal']), 3 + 99,
  'kinds missing from a saved task order sink to the bottom instead of jumping to 2');
console.log('ok  priority: exit -2.2 / comet -1.9 / unknown-order fallback');

/* ------------------------------------------------------------------ 5. 面板与默认值 */
assert.ok(/autoComet:true, autoExpedition:true, autoExtract:false, autoTowerTrick:true/.test(js), 'new defaults');
for (const key of ['autoComet', 'autoExpedition', 'autoExtract', 'autoTowerTrick']) {
  assert.ok(js.includes("'" + key + "'],"), 'settings panel exposes ' + key);
}
assert.ok(/"远征结算"/.test(js) || js.includes('远征结算'), 'expedition result modal handler present');
console.log('ok  defaults + panel toggles + expedition result modal handler');

/* ------------------------------------------------------------------ 3.6 紫苑塔：下楼 / 深层 */
const leave = { kind: 'tower', data: { sub: 'leave' } };
const portal = { kind: 'tower', data: { sub: 'portal' } };
const towerRun = (over = {}) => ({ ...run0, tower: { floor: 5, state: 'clear', roof: false, beyond: false, ...over } });
assert.strictEqual(policy(leave, S, towerRun()), null, 'leave is off by default');
const SL = { ...S, autoTowerLeave: true, towerStopFloor: '5' };
assert.strictEqual(policy(leave, SL, towerRun()).label, '收工下楼（结算胜利）', 'leave once the stop floor is cleared');
assert.strictEqual(policy(leave, SL, towerRun({ floor: 4 })), null, 'not yet at the stop floor');
assert.strictEqual(policy(leave, SL, towerRun({ state: 'wave' })), null, 'leave only when the floor is cleared');
assert.strictEqual(policy(leave, { ...SL, towerStopFloor: '' }, towerRun()), null, 'empty stop floor = never leave');
assert.ok(policy(portal, S, towerRun({ roof: true })) !== null, 'portal goes deeper by default');
assert.strictEqual(policy(portal, { ...S, autoTowerDeep: false }, towerRun({ roof: true })), null,
  'autoTowerDeep=false stays put');
assert.strictEqual(policy(portal, S, towerRun({ roof: true, state: 'roof' })), null,
  'portal waits for the roof fight to end');
console.log('ok  tower: stairs / altar / trick / portal / leave gating');

/* ------------------------------------------------------------------ 3.7 圣地：直冲 + 按 E */
// 3.7.1 规划失败分支：圣地不拉黑、直接怼过去；其它目标照旧拉黑
const fallbackBlock = sliceBalanced(js, 'if(!result){', '{', '}');
function runFallback(kind, routePathImpl) {
  const state = { path: [], pathGoal: null, target: { label: '目标' }, mode: '' };
  const skipped = new Map();
  const logs = [];
  const next = { kind, label: kind === 'shrine' ? '圣地' : '宝箱', x: 0, z: 0, radius: 2.6, ref: { kind } };
  const body = `
    let path=state.path, pathGoal=state.pathGoal, target=state.target, mode=state.mode;
    (function(){ ${fallbackBlock} })();
    state.path=path; state.pathGoal=pathGoal; state.target=target; state.mode=mode;
  `;
  const fn = new Function('result', 'routePath', 'p', 'next', 'run', 'hazards', 'skipped', 'log', 'now', 'state', body);
  fn(null, routePathImpl, { x: 0, z: 10 }, next, { player: { radius: 0.35 }, terrain: {} }, [], skipped, m => logs.push(m), 1000, state);
  return { state, skipped, logs };
}

const alwaysNull = () => null;
const shrineFail = runFallback('shrine', alwaysNull);
assert.deepStrictEqual(shrineFail.state.path, [{ x: 0, z: 0 }], 'shrine falls back to a direct drive');
assert.strictEqual(shrineFail.state.mode, '直冲 圣地', 'shrine reports 直冲圣地');
assert.strictEqual(shrineFail.skipped.size, 0, 'shrine is never blacklisted');
assert.ok(!shrineFail.logs.some(l => l.includes('暂时无法到达')), 'shrine does not log unreachable');

const chestFail = runFallback('chest', alwaysNull);
assert.strictEqual(chestFail.skipped.size, 1, 'other kinds still get blacklisted');
assert.strictEqual(chestFail.state.path.length, 0, 'other kinds drop the target');
assert.ok(chestFail.logs.some(l => l.includes('暂时无法到达')), 'other kinds log unreachable');

// 3.7.2 环形重试现在会放大半径：第一个可达环命中就用它
const ringHit = runFallback('chest', () => [{ x: 3, z: 3 }]);
assert.deepStrictEqual(ringHit.state.path, [{ x: 3, z: 3 }], 'ring retry path is adopted');
assert.strictEqual(ringHit.skipped.size, 0, 'no blacklist when a ring hits');

// 3.7.3 半径内有未使用的圣地就直接按 E（不依赖 nearest）
const tapBlockStart = js.indexOf('try{const pl=run.interactables.list||[];');
const tapEnd = js.indexOf('}catch(e){}', tapBlockStart);
assert.ok(tapBlockStart > 0 && tapEnd > tapBlockStart, 'shrine E-press block found');
const tapBlock = js.slice(tapBlockStart, tapEnd + '}catch(e){}'.length);
function runShrineTap(list, now, sharedWindow) {
  const taps = [];
  const logs = [];
  const win = sharedWindow || {};
  const fn = new Function('run', 'tap', 'releaseKeys', 'log', 'window', 'performance', tapBlock);
  fn(
    { player: { pos: { x: 0, z: 0 } }, interactables: { list } },
    k => { taps.push(k); return true; }, () => {}, m => logs.push(m),
    win, { now: () => now }
  );
  return { taps, logs, win };
}
const nearShrine = { kind: 'shrine', used: false, r: 2.6, x: 3, z: 0 };
const tap1 = runShrineTap([nearShrine], 100000);
assert.deepStrictEqual(tap1.taps, ['KeyE'], 'presses E next to an unused shrine');
assert.ok(tap1.logs.some(l => l.includes('触摸圣地')), 'logs the shrine touch');
assert.deepStrictEqual(runShrineTap([{ ...nearShrine, x: 5 }], 100000).taps, [], 'out of range: no E');
assert.deepStrictEqual(runShrineTap([{ ...nearShrine, used: true }], 100000).taps, [], 'used shrine: no E');
const tap2 = runShrineTap([nearShrine], 100500, tap1.win);
assert.deepStrictEqual(tap2.taps, [], 'throttled inside 800ms');
const tap3 = runShrineTap([nearShrine], 101000, tap1.win);
assert.deepStrictEqual(tap3.taps, ['KeyE'], 'presses again after the throttle window');
console.log('ok  shrine: direct drive fallback + radius-based E press');

/* ------------------------------------------------------------------ 3.8 圣地分两段 + 脱困 */
// 3.8.1 圣地：>6m 交给 A*（不短路），<=6m 才直冲
const shrineLine = (() => {
  const a = js.indexOf("if(next.kind==='shrine'){const dd=");
  assert.ok(a > 0, 'shrine planning line found');
  let i = js.indexOf('{', a), depth = 0;
  for (; i < js.length; i++) {
    if (js[i] === '{') depth++;
    else if (js[i] === '}') { depth--; if (depth === 0) return js.slice(a, i + 1); }
  }
  throw new Error('unbalanced shrine line');
})();
function planShrine(dd) {
  const state = { path: [], pathGoal: null, mode: '' };
  const fn = new Function('p', 'next', 'state', `
    let path=state.path, pathGoal=state.pathGoal, mode=state.mode;
    (function(){ ${shrineLine} })();
    return { path, pathGoal, mode };
  `);
  return fn({ x: 0, z: dd }, { kind: 'shrine', label: '圣地', x: 0, z: 0, radius: 2.6 }, state);
}
const farPlan = planShrine(10);
assert.deepStrictEqual(farPlan.path, [], 'far away: no direct drive, A* is left in charge');
assert.strictEqual(farPlan.mode, '', 'far away: mode untouched');
const nearPlan = planShrine(4);
assert.deepStrictEqual(nearPlan.path, [{ x: 0, z: 0 }], 'close in: direct drive');
assert.strictEqual(nearPlan.mode, '贴近圣地 4m', 'close in: mode reports the distance');

// 3.8.2 脱困：无位移 1.2 秒就横移，方向与目标轴正交，左右交替
assert.ok(js.includes('let unstickDir=0,unstickUntil=0,unstickTries=0;'), 'unstick state declared');
assert.ok(js.includes('if(tnow<unstickUntil){drive(movementKeys(Math.cos(unstickDir),Math.sin(unstickDir),run.camYaw))'),
  'unstick drives a sideways vector');
assert.ok(!js.includes('now-lastMotion.at>2200&&now-jumpAt>1800'), 'jump-only stuck handler is gone');
const trigBlock = sliceBalanced(js, 'else if(tnow-lastMotion.at>1200){', '{', '}');
function triggerUnstick(tries, px, pz, tx, tz) {
  const state = { unstickDir: 0, unstickUntil: 0, unstickTries: tries, path: [{ x: 1, z: 1 }], lastPlan: 99, tapCount: 0 };
  const body = `
    let path=state.path, lastPlan=state.lastPlan, unstickDir=state.unstickDir, unstickUntil=state.unstickUntil, unstickTries=state.unstickTries;
    const tnow=5000, target={label:'圣地',x:${tx},z:${tz}}, p={x:${px},z:${pz}};
    let lastMotion={x:${px},z:${pz},at:1000}, jumpAt=0;
    const tap=()=>{state.tapCount++;}, log=()=>{};
    if(false){}${trigBlock}
    state.unstickDir=unstickDir; state.unstickUntil=unstickUntil; state.unstickTries=unstickTries; state.path=path; state.lastPlan=lastPlan;
  `;
  new Function('state', body)(state);
  return state;
}
const u1 = triggerUnstick(0, 0, 10, 0, 0);
assert.strictEqual(u1.unstickTries, 1, 'tries incremented');
assert.ok(Math.abs(u1.unstickUntil - 5700) < 1, 'escape window is 700ms');
assert.strictEqual(u1.path.length, 0, 'path cleared so it replans');
assert.strictEqual(u1.lastPlan, 0, 'planning throttle reset');
const awayAngle = Math.atan2(10 - 0, 0 - 0);            // 玩家在目标正南
const diff = Math.abs(((u1.unstickDir - awayAngle) % (2 * Math.PI) + 3 * Math.PI) % (2 * Math.PI) - Math.PI);
assert.ok(Math.abs(diff - Math.PI / 2) < 0.4, 'escape direction is perpendicular to the target axis, got ' + diff.toFixed(2));
const u2 = triggerUnstick(1, 0, 10, 0, 0);
const diff2 = Math.abs(((u2.unstickDir - awayAngle) % (2 * Math.PI) + 3 * Math.PI) % (2 * Math.PI) - Math.PI);
assert.ok(Math.abs(diff2 - Math.PI / 2) < 0.4, 'second escape still perpendicular (mirrored side)');
console.log('ok  shrine two-stage approach + unstick wiggle');

/* ------------------------------------------------------------------ 4.1 下楼优先级 */
assert.strictEqual(prio({ kind: 'tower', data: { sub: 'leave' } }, false, order), -2.4,
  'leave outranks the portal once armed');
console.log('ok  priority: tower leave -2.4');

/* ------------------------------------------------------------------ 5.1 3.3.7 面板与默认值 */
assert.ok(/autoTowerDeep:true, autoTowerLeave:false, towerStopFloor:'', autoClaim:true/.test(js), '3.3.7 defaults');
for (const key of ['autoTowerDeep', 'autoTowerLeave', 'autoClaim']) {
  assert.ok(js.includes("'" + key + "'],"), 'settings panel exposes ' + key);
}
assert.ok(js.includes("'towerStopFloor','number'"), 'settings panel exposes the stop floor number field');
console.log('ok  3.3.7 defaults + panel fields');

/* ------------------------------------------------------------------ 6. 自动领取 ticker */
const claimSrc = sliceBalanced(js, 'async function claimTick(');
function makeClaimEnv(runState = 'over') {
  const calls = [];
  const meta = {
    account: { token: 'TOKEN' },
    profile: { events: {} },
    claimTask: (p, s) => { calls.push('task:' + p + s); return p === 'daily'; },
    eventReady: () => 3,
    adopt: () => calls.push('adopt'),
  };
  const backend = {
    events: () => [{ id: 'halloween26', name: 'Halloween' }],
    claimEventTrack: async (a, e, step) => { calls.push('track:' + e + ':' + step); return {}; },
    eventView: async () => ({ quests: [{ id: 'q1', name: 'Q1' }, { id: 'q2' }] }),
    claimEventQuest: async (a, e, q) => { calls.push('quest:' + q); return {}; },
    claimSeasonAwards: async () => { calls.push('season'); return {}; },
  };
  const app = { run: { state: runState }, meta, backend };
  const claimState = { last: performance.now() - 60000, busy: false, questBackoff: new Map(), seasonAt: 0, hits: 0 };
  const tick = new Function(
    'opt', 'app', 'editOpen', 'stoppedReason', 'log', 'updatePanel', 'available', 'visible', 'document', 'claimState',
    claimSrc + '\nreturn claimTick;'
  )(
    { autoClaim: true }, app, false, '', () => {}, () => {}, () => true, () => true,
    { querySelectorAll: () => [] }, claimState
  );
  return { tick, calls, claimState, optHolder: null };
}

(async () => {
  // 6.1 局外：每日/每周任务 + 事件积分 + 事件任务 + 赛季
  const env = makeClaimEnv('over');
  await env.tick();
  assert.ok(env.calls.includes('task:daily0'), 'claims daily slot 0');
  assert.ok(env.calls.includes('task:weekly0'), 'asks for weekly slots too');
  assert.ok(env.calls.includes('track:halloween26:-1'), 'claims the whole event track at once');
  assert.ok(env.calls.includes('quest:q1') && env.calls.includes('quest:q2'), 'claims unclaimed event quests');
  assert.ok(env.calls.includes('season'), 'tries the season awards');
  assert.ok(env.calls.filter(c => c === 'adopt').length >= 3, 'adopts the returned profiles');

  // 6.2 对局中不领取（避免抢按键）
  const playing = makeClaimEnv('play');
  await playing.tick();
  assert.deepStrictEqual(playing.calls, [], 'never claims while a run is playing');

  // 6.3 45 秒节流
  const throttled = makeClaimEnv('over');
  await throttled.tick();
  const first = throttled.calls.length;
  await throttled.tick();
  assert.strictEqual(throttled.calls.length, first, 'second call inside the cooldown does nothing');

  // 6.4 事件任务失败后退避 30 分钟
  const backoff = makeClaimEnv('over');
  backoff.claimState.questBackoff.set('halloween26|q1', Date.now() + 60000);
  await backoff.tick();
  assert.ok(!backoff.calls.includes('quest:q1'), 'quest in backoff is skipped');
  assert.ok(backoff.calls.includes('quest:q2'), 'other quests still claimed');

  console.log('ok  claim ticker: tasks / event track / event quests / season / throttling / backoff');
  console.log('\nall userscript assertions passed');
})();

