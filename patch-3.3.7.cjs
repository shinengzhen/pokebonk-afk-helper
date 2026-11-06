// patch-3.3.7.cjs — 爬塔全自动 + 任务/奖励自动领取（3.3.7）
// 用法： node patch-3.3.7.cjs [in.user.js] [out.user.js]
// 幂等：已应用的补丁会跳过。锚点不唯一会报 SKIPPED，不静默改坏。

const fs = require('fs');
const path = require('path');

const dir = __dirname;
const fallback = ['pokebonk-afk-helper-3.2.1.user.js', 'pokebonk-afk.user.js']
  .map(n => path.join(dir, n)).find(p => fs.existsSync(p));
const src = process.argv[2] || fallback;
const out = process.argv[3] || path.join(dir, 'release-3.3.7.user.js');

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

/* ---------------------------------------------------------------- P1 新开关 */
apply('P1 settings defaults',
  'autoComet:true, autoExpedition:true, autoExtract:false, autoTowerTrick:true,',
  'autoComet:true, autoExpedition:true, autoExtract:false, autoTowerTrick:true,\n' +
  " autoTowerDeep:true, autoTowerLeave:false, towerStopFloor:'', autoClaim:true,",
  'autoTowerDeep:true');

/* ---------------------------------------------------------------- P2 塔：下楼/深层门控 */
const p2find = "if(kind==='tower'){const sub=item.data?.sub||'';if(sub==='leave')return null;if(settings.autoTower===false)return null;if(sub==='trick'&&settings.autoTowerTrick===false)return null;if(sub==='altar'&&!settings.autoAltar)return null;const st=run&&run.tower&&run.tower.state;if(st&&st!=='clear')return null;}";
const p2new =
  "if(kind==='tower'){const sub=item.data?.sub||'';const tw=run&&run.tower;" +
  "if(settings.autoTower===false)return null;" +
  "if(sub==='leave'){const stop=Number(settings.towerStopFloor);if(!settings.autoTowerLeave)return null;if(!(Number.isFinite(stop)&&stop>0&&(tw?tw.floor:0)>=stop))return null;}" +
  "if(sub==='portal'&&settings.autoTowerDeep===false)return null;" +
  "if(sub==='trick'&&settings.autoTowerTrick===false)return null;" +
  "if(sub==='altar'&&!settings.autoAltar)return null;" +
  "const st=tw&&tw.state;if(st&&st!=='clear')return null;}";
apply('P2 tower leave/deep gate', p2find, p2new, "sub==='leave'){const stop=Number(settings.towerStopFloor)");

/* ---------------------------------------------------------------- P3 下楼标签 */
apply('P3 tower leave label',
  "item.data?.sub==='trick'?'塔内墓碑·抽奖':'塔内'",
  "item.data?.sub==='trick'?'塔内墓碑·抽奖':item.data?.sub==='leave'?'收工下楼（结算胜利）':'塔内'",
  '收工下楼（结算胜利）');

/* ---------------------------------------------------------------- P4 下楼优先级最高 */
apply('P4 tower leave priority',
  "priority:(item.kind==='exp'&&item.data?.sub==='exit')?-2.2:",
  "priority:(item.kind==='tower'&&item.data?.sub==='leave')?-2.4:(item.kind==='exp'&&item.data?.sub==='exit')?-2.2:",
  '?-2.4:');

/* ---------------------------------------------------------------- P5 状态行：塔层 + 任务可领 */
const p5anchor = "function updatePanel(){";
const p5helpers =
  "function towerStatus(run){\n" +
  " const t=run&&run.tower;if(!t)return '';\n" +
  " const where=t.roof?'屋顶':t.beyond?('深层 '+Math.max(1,(t.floor||8)-7)+' 层'):('第 '+(t.floor||1)+' 层');\n" +
  " const st={intro:'准备中',wave:'刷怪中',guard:'守卫战',clear:'已清·楼梯已开',roof:'屋顶·耿鬼'}[t.state]||t.state||'';\n" +
  " const wave=Number.isFinite(t.wave)?' · 波 '+Math.min(3,(t.wave||0)+1)+'/3':'';\n" +
  " return '紫苑塔 '+where+' · '+st+wave;\n" +
  "}\n" +
  "let claimCacheAt=0,claimCache='';\n" +
  "function claimStatus(){\n" +
  " const inst=app,meta=inst&&(inst.meta||(inst.run&&inst.run.meta));if(!meta)return '';\n" +
  " const t=performance.now();if(t-claimCacheAt<5000)return claimCache;claimCacheAt=t;\n" +
  " let quest=0,task=0,ev=0;\n" +
  " try{quest=meta.claimable?.()??0;}catch(e){}\n" +
  " try{task=meta.tasksReady?.()??0;}catch(e){}\n" +
  " try{for(const x of (inst.backend?.events?.()||[])){try{ev+=meta.eventReady(x.id)||0;}catch(e){}}}catch(e){}\n" +
  " claimCache=(quest||task||ev)?('任务可领：每日/周 '+task+' · 事件 '+ev+' · 成就 '+quest):'';\n" +
  " return claimCache;\n" +
  "}\n";
apply('P5a status helpers', p5anchor, p5helpers + p5anchor, 'function claimStatus()');

apply('P5b status line',
  "+mode+'\\n宝可币 '",
  "+(run?.tower?('\\n'+towerStatus(run)):'')+(claimStatus()?('\\n'+claimStatus()):'')+mode+'\\n宝可币 '",
  "'\\n'+towerStatus(run)");

/* ---------------------------------------------------------------- P6 领取 ticker */
const p6state =
  "const claimState={last:0,busy:false,questBackoff:new Map(),seasonAt:0,hits:0};\n" +
  "async function claimTick(){\n" +
  " if(!opt.autoClaim||claimState.busy||editOpen||stoppedReason)return;\n" +
  " const inst=app;if(!inst)return;\n" +
  " const run=inst.run;if(run&&run.state==='play')return;                  // 只在局外领取，避免抢按键\n" +
  " const now=performance.now();if(now-claimState.last<45000)return;claimState.last=now;\n" +
  " const meta=inst.meta||(run&&run.meta),backend=inst.backend;\n" +
  " if(!meta||!backend)return;\n" +
  " const account=meta.account;if(!account)return;\n" +
  " claimState.busy=true;let n=0;\n" +
  " try{\n" +
  "  if(typeof meta.claimTask==='function'){\n" +
  "   for(const period of ['daily','weekly'])for(let slot=0;slot<3;slot++){\n" +
  "    try{if(meta.claimTask(period,slot)){n++;log('任务：领取'+(period==='daily'?'每日':'每周')+'第'+(slot+1)+'个奖励');}}catch(e){}\n" +
  "   }\n" +
  "  }\n" +
  "  let evs=[];try{evs=backend.events?.()||[];}catch(e){}\n" +
  "  for(const ev of evs){\n" +
  "   if(!ev||!ev.id)continue;\n" +
  "   let ready=0;try{ready=meta.eventReady?meta.eventReady(ev.id):0;}catch(e){}\n" +
  "   if(!ready)continue;\n" +
  "   try{const p=await backend.claimEventTrack(account,ev.id,-1);if(p&&meta.adopt)meta.adopt(p);n++;log('任务：「'+(ev.name||ev.id)+'」积分奖励已领取');}catch(e){}\n" +
  "   let view=null;try{view=await backend.eventView(account,ev.id);}catch(e){}\n" +
  "   const rec=(meta.profile&&meta.profile.events&&meta.profile.events[ev.id])||{};\n" +
  "   const done=rec.quests||[];\n" +
  "   for(const q of (view&&view.quests)||[]){\n" +
  "    if(!q||!q.id||done.includes(q.id))continue;\n" +
  "    const key=ev.id+'|'+q.id;if((claimState.questBackoff.get(key)||0)>Date.now())continue;\n" +
  "    try{const p2=await backend.claimEventQuest(account,ev.id,q.id);if(p2&&meta.adopt)meta.adopt(p2);n++;log('任务：完成「'+(q.name||q.id)+'」');}\n" +
  "    catch(e){claimState.questBackoff.set(key,Date.now()+1800000);}\n" +
  "   }\n" +
  "  }\n" +
  "  if(Date.now()-claimState.seasonAt>21600000){\n" +
  "   claimState.seasonAt=Date.now();\n" +
  "   try{if(typeof backend.claimSeasonAwards==='function'){const p3=await backend.claimSeasonAwards(account);if(p3&&meta.adopt)meta.adopt(p3);n++;log('任务：赛季奖励已领取');}}catch(e){}\n" +
  "  }\n" +
  "  for(const b of document.querySelectorAll('#ui button.q-claim,#ui button.cl-rw-btn,#ui button.tk-claim,#ui button.ev-claim')){\n" +
  "   if(!available(b)||!visible(b))continue;\n" +
  "   b.click();n++;log('任务：点了页面上的领取按钮');\n" +
  "  }\n" +
  " }catch(e){log('领取失败：'+((e&&e.message)||e));}\n" +
  " finally{claimState.busy=false;if(n){claimState.hits+=n;updatePanel();}}\n" +
  "}\n";
apply('P6a claim ticker', p5anchor, p6state + p5anchor, 'async function claimTick()');

apply('P6b claim interval',
  'setInterval(controlTick,100);setInterval(updatePanel,500);',
  'setInterval(controlTick,100);setInterval(updatePanel,500);setInterval(claimTick,5000);',
  'setInterval(claimTick,5000);');

/* ---------------------------------------------------------------- P7 面板开关 */
apply('P7a panel toggles',
  "['紫苑塔：交互耿鬼墓碑（抽奖）','autoTowerTrick'],",
  "['紫苑塔：交互耿鬼墓碑（抽奖）','autoTowerTrick'],['紫苑塔：屋顶清完继续走传送门进「深层」','autoTowerDeep'],['紫苑塔：到指定层后下楼结算胜利','autoTowerLeave'],['自动领取每日/每周任务与事件奖励','autoClaim'],",
  "'autoClaim'],");

apply('P7b stop floor field',
  "field('任务优先顺序（每行一个 ID）','taskOrder','textarea',",
  "field('紫苑塔停止层数（留空=一直往深层爬）','towerStopFloor','number','仅当「到指定层后下楼结算」打开时生效：到达该层且本层清完后点「收工下楼」。8 层以后是「深层」，层数继续累加。'),field('任务优先顺序（每行一个 ID）','taskOrder','textarea',",
  "field('紫苑塔停止层数");

/* ---------------------------------------------------------------- 版本号 */
js = js.replace('// @version      3.3.6', '// @version      3.3.7');
js = js.replace("window.__pbAfkVersion='3.3.6';", "window.__pbAfkVersion='3.3.7';");

fs.writeFileSync(src, js, 'utf8');

/* ---------------------------------------------------------------- 发布构建处理 */
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
console.log('8791 refs: ' + (rel.match(/8791/g) || []).length);
