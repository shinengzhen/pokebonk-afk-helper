// patch-3.3.9.cjs — 修「卡在圣地平台上，手动动一下才继续」
//
// 现象：助手在圣地的小平台/台阶边顶住不动；玩家手动挪一下，它立刻重新寻路去传送门。
// 根因两条：
//   1) 3.3.8 给圣地开了「无脑直冲」（`path=[{x,z}]` 直接怼原点）。圣地在一座抬高的
//      平台上，从远处直冲会顶在平台侧面，而 A* 本来能绕台阶上来 —— 上一版把它短路了。
//   2) 卡住时只 `tap('Space')` + 清路径。跳跃爬不上台阶，横移才能绕开；所以一直原地重试，
//      直到玩家手动给一个位移把 lastMotion 刷新。
//
// 修法：
//   - 圣地：先照常 A*（含多半径环点）走到可达环点，只有进入 6 米内才切成直冲补最后一段；
//   - 通用脱困：无位移 >1.2 秒就朝「目标方向的正交方向」横移 700ms，交替左右，再重算路径；
//   - 圣地按 E 的半径放宽到 max(4.2, r+1.5)（游戏侧窗口是 r+0.8=3.4，多留余量不怕）。

const fs = require('fs');
const path = require('path');

const dir = __dirname;
const fallback = ['pokebonk-afk-helper-3.2.1.user.js', 'pokebonk-afk.user.js']
  .map(n => path.join(dir, n)).find(p => fs.existsSync(p));
const src = process.argv[2] || fallback;
const out = process.argv[3] || path.join(dir, 'release-3.3.9.user.js');

let js = fs.readFileSync(src, 'utf8');
const log = [];
let changed = false;

function apply(id, find, replace, doneTest) {
  if (doneTest && js.includes(doneTest)) { log.push(id + ' already applied'); return; }
  const n = js.split(find).length - 1;
  if (n !== 1) { log.push(id + ' SKIPPED (anchor x' + n + ')'); return; }
  js = js.replace(find, replace);
  changed = true;
  log.push(id + ' applied');
}

/* ---------------------------------------------- P1 圣地：6 米内才直冲，远处仍走 A* */
apply('P1 shrine: A* first, push last 6m',
  "if(next.kind==='shrine'){path=[{x:next.x,z:next.z}];pathGoal={x:next.x,z:next.z};mode='直冲圣地';return;}",
  "if(next.kind==='shrine'){const dd=Math.hypot(p.x-next.x,p.z-next.z);if(dd<=6){path=[{x:next.x,z:next.z}];pathGoal={x:next.x,z:next.z};mode='贴近圣地 '+Math.round(dd*10)/10+'m';return;}}",
  "贴近圣地");

/* ---------------------------------------------- P2 脱困状态机（横移绕行） */
apply('P2a unstick state',
  "function steer(){",
  "let unstickDir=0,unstickUntil=0,unstickTries=0;\nfunction steer(){",
  'let unstickDir=0');

apply('P2b unstick drive',
  " const p=run.player.pos;\n if(target.type==='capture'&&run.enemies.alive[target.index])",
  " const p=run.player.pos;\n const tnow=performance.now();\n if(tnow<unstickUntil){drive(movementKeys(Math.cos(unstickDir),Math.sin(unstickDir),run.camYaw));if(Math.hypot(p.x-lastMotion.x,p.z-lastMotion.z)>1)lastMotion={x:p.x,z:p.z,at:tnow};return;}\n if(target.type==='capture'&&run.enemies.alive[target.index])",
  'if(tnow<unstickUntil)');

apply('P2c unstick trigger',
  "else if(now-lastMotion.at>2200&&now-jumpAt>1800){jumpAt=now;tap('Space');path=[];lastPlan=0;log('尝试跳跃并重算路线');}",
  "else if(tnow-lastMotion.at>1200){unstickTries++;const away=Math.atan2(p.z-target.z,p.x-target.x);unstickDir=away+(unstickTries%2?1:-1)*Math.PI/2+(Math.random()-.5)*.6;unstickUntil=tnow+700;lastMotion={x:p.x,z:p.z,at:tnow};path=[];lastPlan=0;if(tnow-jumpAt>1800){jumpAt=tnow;tap('Space');}log('脱困：横移绕行 #'+unstickTries+'（'+target.label+'）');}",
  'unstickTries++');

/* ---------------------------------------------- P3 圣地按 E 的半径放宽 */
apply('P3 shrine E radius',
  "o.kind==='shrine'&&dd<=Math.max(3.6,(o.r||2.6)+1)",
  "o.kind==='shrine'&&dd<=Math.max(4.2,(o.r||2.6)+1.5)",
  'Math.max(4.2,(o.r||2.6)+1.5)');

/* ---------------------------------------------- 版本号 */
js = js.replace('// @version      3.3.8', '// @version      3.3.9');
js = js.replace("window.__pbAfkVersion='3.3.8';", "window.__pbAfkVersion='3.3.9';");

fs.writeFileSync(src, js, 'utf8');

let rel = js;
rel = rel.replace(/^\/\/ @connect\s+127\.0\.0\.1\s*$\r?\n?/m, '');
rel = rel.split('http://127.0.0.1:8791/dump').join('about:blank');
rel = rel.split('setInterval(()=>{if(window.__pbReport!==true)return;').join('setInterval(()=>{return;');
const raw = 'https://raw.githubusercontent.com/shinengzhen/pokebonk-afk-helper/feat-classic-mode';
rel = rel.replace(/@updateURL\s+\S+/, '@updateURL    ' + raw + '/pokebonk-afk.meta.js');
rel = rel.replace(/@downloadURL\s+\S+/, '@downloadURL  ' + raw + '/pokebonk-afk.user.js');
fs.writeFileSync(out, rel, 'utf8');

log.forEach(l => console.log(l));
console.log('changed: ' + changed);
console.log('version: ' + (/@version\s+(\S+)/.exec(rel) || [])[1]);
console.log('bytes  : ' + Buffer.byteLength(rel));
