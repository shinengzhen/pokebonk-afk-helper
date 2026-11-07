// patch-3.3.8.cjs — 修「经典模式进圣地后不去触摸圣地」
//
// 根因（读新包 menus 侧确认）：
//   圣地是 `populate(){ if(run.sanctuary){ this.add('shrine',0,0); return } }`
//   → 交互半径用默认值 2.6，游戏自己判定 nearest 的条件是 `f < r + 0.8`（≈3.4m）；
//   但竞技场在同一个 (0,0) 上 `reserve(0,0,3.4)` + `addCollider({x:0,z:0,r:3})`。
//   助手的 A* 每个采样点要求 `body = max(.65, playerR)+.6 ≈ 1.25` 的余量，
//   于是「可达点」至少离中心 3.4+1.25 ≈ 4.6m；环形重试的半径上限又被卡在
//   `RR = min(3.5, next.radius=2.6) = 2.6` → 8 个采样点全在禁区里 → 全部失败
//   → `暂时无法到达 圣地，稍后重试` + 拉黑 20 秒，来回循环，永远不来碰。
//
// 修法：圣地这种「就长在碰撞体里」的目标不交给 A*，直接怼过去（游戏自身的
// 碰撞会把玩家停在 ~3.35m，正好落进 nearest 的 3.4m 窗口）；到点后按 E 也不
// 依赖 nearest，半径内存在未使用的圣地就直接按。被卡住时不再把圣地拉黑。

const fs = require('fs');
const path = require('path');

const dir = __dirname;
const fallback = ['pokebonk-afk-helper-3.2.1.user.js', 'pokebonk-afk.user.js']
  .map(n => path.join(dir, n)).find(p => fs.existsSync(p));
const src = process.argv[2] || fallback;
const out = process.argv[3] || path.join(dir, 'release-3.3.8.user.js');

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

/* ------------------------------------------------- P1 圣地：不交给 A*，直接怼过去 */
apply('P1 shrine direct drive',
  "lastPlan=now;const hazards=opt.avoidHazards?(run.endless?.hazards?.list||[]):[];",
  "lastPlan=now;const hazards=opt.avoidHazards?(run.endless?.hazards?.list||[]):[];\n" +
  "  if(next.kind==='shrine'){path=[{x:next.x,z:next.z}];pathGoal={x:next.x,z:next.z};mode='直冲圣地';return;}",
  "mode='直冲圣地'");

/* ------------------------------------------------- P2 环形重试：多半径 + 圣地兜底 */
const p2find = "if(!result){const RR=Math.max(1.5,Math.min(3.5,next.radius||2));let ok=null;for(let a=0;a<8&&!ok;a++){const th=a*Math.PI/4;ok=routePath(p,{...next,x:next.x+Math.cos(th)*RR,z:next.z+Math.sin(th)*RR,bodyRadius:run.player.radius},run.terrain,hazards);}if(ok){path=ok;pathGoal={x:next.x,z:next.z};return;}if(next.kind!=='portal'&&next.ref&&typeof next.ref==='object')skipped.set(next.ref,now+20000);log('暂时无法到达 '+next.label+'，稍后重试');target=null;path=[];return;}";
const p2new =
  "if(!result){\n" +
  "  let ok=null;const base=Math.max(1.5,Math.min(3.5,next.radius||2));\n" +
  "  for(const rr of [base,base+1.5,base+3,base+4.5,base+6]){for(let a=0;a<16&&!ok;a++){const th=a*Math.PI/8;ok=routePath(p,{...next,x:next.x+Math.cos(th)*rr,z:next.z+Math.sin(th)*rr,bodyRadius:run.player.radius},run.terrain,hazards);}if(ok)break;}\n" +
  "  if(ok){path=ok;pathGoal={x:next.x,z:next.z};return;}\n" +
  "  if(next.kind==='shrine'||next.kind==='boss'){path=[{x:next.x,z:next.z}];pathGoal={x:next.x,z:next.z};mode='直冲 '+next.label;return;}\n" +
  "  if(next.kind!=='portal'&&next.ref&&typeof next.ref==='object')skipped.set(next.ref,now+20000);log('暂时无法到达 '+next.label+'，稍后重试');target=null;path=[];return;\n" +
  " }";
apply('P2 ring retry multi-radius', p2find, p2new, 'for(const rr of [base,base+1.5');

/* ------------------------------------------------- P3 卡住时不放弃圣地/守护者 */
apply('P3 stuck keeps shrine',
  "if(now-targetAt>12000&&now-lastMotion.at>5000){if(target.kind==='portal'){path=[];lastPlan=0;targetAt=now;log('传送门被卡，强制重算');}",
  "if(now-targetAt>12000&&now-lastMotion.at>5000){if(target.kind==='portal'||target.kind==='shrine'||target.kind==='boss'){path=[];lastPlan=0;targetAt=now;log('被卡，强制重算：'+target.label);}",
  "target.kind==='shrine'||target.kind==='boss'){path=[];lastPlan=0;targetAt=now;log('被卡");

/* ------------------------------------------------- P4 半径内有未使用的圣地就按 E */
const p4find = "try{const pl=run.interactables.list||[];for(const o of pl){if(o.kind!=='portal'||o.used)continue;const pp=run.player.pos,dd=Math.hypot((o.x||0)-pp.x,(o.z||0)-pp.z);if(dd<=Math.max(2.5,(o.r||2)+1.5)){releaseKeys();if(tap('KeyE'))log('进入传送门');return;}}}catch(e){}";
const p4new =
  "try{const pl=run.interactables.list||[];for(const o of pl){if(o.used)continue;const pp=run.player.pos,dd=Math.hypot((o.x||0)-pp.x,(o.z||0)-pp.z);\n" +
  "  if(o.kind==='portal'&&dd<=Math.max(2.5,(o.r||2)+1.5)){releaseKeys();if(tap('KeyE'))log('进入传送门');return;}\n" +
  "  if(o.kind==='shrine'&&dd<=Math.max(3.6,(o.r||2.6)+1)&&performance.now()-(window.__pbShrineTap||0)>800){window.__pbShrineTap=performance.now();releaseKeys();if(tap('KeyE'))log('触摸圣地（'+Math.round(dd*10)/10+'m）');return;}\n" +
  " }}catch(e){}";
apply('P4 shrine E press', p4find, p4new, "'触摸圣地（'");

/* ------------------------------------------------- 版本号 */
js = js.replace('// @version      3.3.7', '// @version      3.3.8');
js = js.replace("window.__pbAfkVersion='3.3.7';", "window.__pbAfkVersion='3.3.8';");

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
