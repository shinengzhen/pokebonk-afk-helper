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
assert.ok(/@version\s+3\.3\.6/.test(js), '@version should be 3.3.6');
assert.ok(/__pbAfkVersion='3\.3\.6'/.test(js), 'runtime version marker should be 3.3.6');
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
const prioStart = js.indexOf("priority:(item.kind==='exp'");
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

console.log('\nall userscript assertions passed');
