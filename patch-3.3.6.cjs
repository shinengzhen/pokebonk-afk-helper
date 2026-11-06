// patch-3.3.6.cjs — 给 PokéBonk 挂机助手补上游戏 0.8.9x (build mw4qh5au) 的新内容
// 用法： node patch-3.3.6.cjs [in.user.js] [out.user.js]
//   - 默认 in  = pokebonk-afk-helper-3.2.1.user.js（本分支的工作副本，实为 3.3.5）
//   - 默认 out = release-3.3.6.user.js
// 每条补丁都要求锚点唯一；已应用过的自动跳过，可重复执行。

const fs = require('fs');
const path = require('path');

const dir = __dirname;
// 工作副本优先（F:\Pokebonk\pokebonk-afk 里的 3.3.5 源），仓库里则回落到发布产物
const fallback = ['pokebonk-afk-helper-3.2.1.user.js', 'pokebonk-afk.user.js']
  .map(n => path.join(dir, n)).find(p => fs.existsSync(p));
const src = process.argv[2] || fallback;
const out = process.argv[3] || path.join(dir, 'release-3.3.6.user.js');

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

/* ---------------------------------------------------------------- P1 新构建白名单 */
apply('P1 build mw4qh5au',
  "const SUPPORTED_BUILDS = new Set(['mvob1c8t','mvpdimhl','mvpjh5lt','mvpt1dlr','mvxmqseg','mvywlxn8']);",
  "const SUPPORTED_BUILDS = new Set(['mvob1c8t','mvpdimhl','mvpjh5lt','mvpt1dlr','mvxmqseg','mvywlxn8','mw4qh5au']);",
  "'mw4qh5au'");

/* ---------------------------------------------------------------- P2 新开关 */
apply('P2 settings defaults',
  'autoAltar:true, autoDitto:true, autoFossil:true, autoSnorlax:true, autoFusion:true, autoShop:true, autoSlots:true,',
  'autoAltar:true, autoDitto:true, autoFossil:true, autoSnorlax:true, autoFusion:true, autoShop:true, autoSlots:true,\n' +
  ' autoComet:true, autoExpedition:true, autoExtract:false, autoTowerTrick:true,',
  'autoComet:true');

/* ---------------------------------------------------------------- P3 塔内墓碑开关 */
apply('P3 tower trick gate',
  "if(kind==='tower'){const sub=item.data?.sub||'';if(sub==='leave')return null;if(settings.autoTower===false)return null;if(sub==='altar'&&!settings.autoAltar)return null;const st=run&&run.tower&&run.tower.state;if(st&&st!=='clear')return null;}",
  "if(kind==='tower'){const sub=item.data?.sub||'';if(sub==='leave')return null;if(settings.autoTower===false)return null;if(sub==='trick'&&settings.autoTowerTrick===false)return null;if(sub==='altar'&&!settings.autoAltar)return null;const st=run&&run.tower&&run.tower.state;if(st&&st!=='clear')return null;}",
  "autoTowerTrick===false");

/* ---------------------------------------------------------------- P4 陨星碎片 + 远征闸门 */
const p4find = "if(kind==='altar'&&(!settings.autoAltar||item.data?.sealed))return null;";
const p4new =
  "if(kind==='altar'&&item.data?.comet){if(settings.autoComet===false)return null;}" +
  "else if(kind==='altar'&&(!settings.autoAltar||item.data?.sealed))return null;\n" +
  " if(kind==='exp'){const sub=item.data?.sub||'';if(sub==='exit'){" +
  "if(!settings.autoExtract)return null;" +
  "let open=false;try{const ex=run&&run.expedition;const win=ex&&typeof ex.nextWindow==='function'?ex.nextWindow():null;" +
  "open=(ex&&ex.openExit)===item||(win&&win.exit===item)||(run&&run.openExit)===item;}catch(e){}" +
  "if(!open)return null;}" +
  "else if(settings.autoExpedition===false)return null;}";
apply('P4 comet/exp gates', p4find, p4new, 'settings.autoExpedition===false');

/* ---------------------------------------------------------------- P5 白名单加 exp */
apply('P5 whitelist exp',
  "if(!['altar','ditto','fossil','snorlax','bill','meowth','slots','boss','portal','rock','gengar','cage','shrine','bonk','tower'].includes(kind))",
  "if(!['altar','ditto','fossil','snorlax','bill','meowth','slots','boss','portal','rock','gengar','cage','shrine','bonk','tower','exp'].includes(kind))",
  "'bonk','tower','exp']");

/* ---------------------------------------------------------------- P6 标签 */
apply('P6 labels',
  "label:(kind==='tower'?(item.data?.sub==='stairs'?'上楼楼梯':item.data?.sub==='altar'?'塔内祭坛献祭':item.data?.sub==='portal'?'塔顶传送门':'塔内'):({altar:",
  "label:(kind==='tower'?(item.data?.sub==='stairs'?'上楼楼梯':item.data?.sub==='altar'?'塔内祭坛献祭':item.data?.sub==='portal'?'塔顶传送门':item.data?.sub==='trick'?'塔内墓碑·抽奖':'塔内')" +
  ":kind==='exp'?(item.data?.sub==='exit'?'远征撤离点':item.data?.sub==='vault'?'远征宝库':'远征补给箱')" +
  ":(kind==='altar'&&item.data?.comet)?'陨星碎片·限时':({altar:",
  '陨星碎片·限时');

/* ---------------------------------------------------------------- P7 半径 */
apply('P7 radius',
  "radius:kind==='tower'?Math.max(1.8,Math.min(3,item.r||2.5)):",
  "radius:(kind==='altar'&&item.data?.comet)?Math.max(1.6,Math.min(2.8,item.r||2))" +
  ":kind==='exp'?(item.data?.sub==='exit'?Math.max(3.5,Math.min(6,item.r||4)):Math.max(2,Math.min(3,item.r||2.2)))" +
  ":kind==='tower'?Math.max(1.8,Math.min(3,item.r||2.5)):",
  "Math.min(6,item.r||4)");

/* ---------------------------------------------------------------- P8 优先级 */
apply('P8 priority',
  "priority:item.kind==='portal'?-2:item.kind==='tower'?-1.5:item.kind==='bonk'?-1:(holding?2.5:3+order.indexOf(item.kind))",
  "priority:(item.kind==='exp'&&item.data?.sub==='exit')?-2.2:(item.kind==='altar'&&item.data?.comet)?-1.9:item.kind==='portal'?-2:item.kind==='tower'?-1.5:item.kind==='bonk'?-1:(holding?2.5:3+(order.indexOf(item.kind)<0?99:order.indexOf(item.kind)))",
  '?-2.2:');

/* ---------------------------------------------------------------- P9 撤离点不吃黑名单 */
apply('P9 exit skip exemption',
  "if(item.kind!=='portal'&&(skipped.get(item)||0)>now)continue;",
  "if(item.kind!=='portal'&&!(item.kind==='exp'&&item.data?.sub==='exit')&&(skipped.get(item)||0)>now)continue;",
  "item.data?.sub==='exit')&&(skipped");

/* ---------------------------------------------------------------- P10 撤离点不按 E */
apply('P10 exit no E press',
  "}else if(target.type==='task'&&nearest.kind!=='altar'&&mapTaskPolicy(",
  "}else if(target.type==='task'&&nearest.kind!=='altar'&&!(nearest.kind==='exp'&&nearest.data?.sub==='exit')&&mapTaskPolicy(",
  "!(nearest.kind==='exp'");

/* ---------------------------------------------------------------- P11 任务顺序默认值 */
apply('P11 task order',
  "taskOrder:['portal','tower','bonk','boss',",
  "taskOrder:['portal','tower','exp','bonk','boss',",
  "taskOrder:['portal','tower','exp'");

/* ---------------------------------------------------------------- P12 面板开关 */
apply('P12 settings panel',
  "['未知祭坛：到达后驻留充能','autoAltar'],",
  "['未知祭坛：到达后驻留充能','autoAltar'],['陨星碎片：限时事件优先前往','autoComet'],['远征：开启补给箱与古代密室','autoExpedition'],['远征：撤离窗口开启时前往撤出（会结束本局）','autoExtract'],['紫苑塔：交互耿鬼墓碑（抽奖）','autoTowerTrick'],",
  'autoTowerTrick\']');

/* ---------------------------------------------------------------- P13 远征结算弹窗 */
apply('P13 expedition result modal',
  'if(now-modalAt<800||now-lastModalAction<1200)return true;',
  "if(now-modalAt<800||now-lastModalAction<1200)return true;\n" +
  " {const tX=text(modal);if(/已撤离|倒在山谷中|倒在了山谷中|EXTRACCIÓN|EXTRAÍDO|CAÍDO EN EL VALLE/i.test(tX)){" +
  "const bk=[...modal.querySelectorAll('button')].find(b=>available(b)&&/返回比尔的电脑|返回比尔PC|Volver al PC de Bill/i.test(text(b)))" +
  "||[...modal.querySelectorAll('button')].find(b=>available(b)&&/菜单|Menú/i.test(text(b)));" +
  "if(bk){lastModalAction=now;bk.click();log('远征结算：返回比尔的电脑');mode='远征结算';}" +
  "else{mode='远征结算：等待返回按钮';}return true;}}",
  '远征结算');

/* ---------------------------------------------------------------- P14 模式名日志 */
apply('P14 mode label',
  "log('已连接'+(run.endless?'生存':'经典')+'模式，预算按本局单独计数');",
  "log('已连接'+(run.expedition?'远征':run.tower?'紫苑塔':run.endless?'生存':'经典')+'模式，预算按本局单独计数');",
  "run.expedition?'远征'");

/* ---------------------------------------------------------------- 版本号 */
js = js.replace('// @version      3.3.5', '// @version      3.3.6');
js = js.replace("window.__pbAfkVersion='3.3.5';", "window.__pbAfkVersion='3.3.6';");

// 工作副本：只带功能补丁 + 版本号（保留它原有的 @connect / @updateURL）
fs.writeFileSync(src, js, 'utf8');

/* ---------------------------------------------------------------- 发布构建处理（同 build-release.ps1） */
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
console.log('marker : ' + (/__pbAfkVersion='([^']+)'/.exec(rel) || [])[1]);
console.log('bytes  : ' + Buffer.byteLength(rel));
console.log('leftover 8791 refs: ' + (rel.match(/8791/g) || []).length);

