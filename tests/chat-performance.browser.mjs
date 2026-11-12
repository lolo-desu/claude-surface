/** Long-chat regression and comparable before/after measurements. Requires a
 * local ST with the default Seraphina character, Chromium/Playwright. CU_SOURCE selects an older
 * checkout; CU_BASELINE=1 records that version without candidate-only assertions.
 * Synthetic chat data and intercepted writes never change server preferences/cards.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const {chromium,webkit}=await import(process.env.CU_PLAYWRIGHT_MODULE||'playwright');
const source=process.env.CU_SOURCE||path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const out=process.env.CU_TEST_OUTPUT||path.join(source,'artifacts/chat-performance');await fs.mkdir(out,{recursive:true});
const baseline=!!process.env.CU_BASELINE;
const cases=process.env.CU_PERF_QUICK?[{total:400,limit:400,width:412}]:[{total:400,limit:400,width:412},{total:1000,limit:1000,width:1440},{total:5000,limit:100,width:412}];
const report={source,baseline,browser:'',cases:[]};
const engine=process.env.CU_ENGINE||'chromium';
const browser=await (engine==='webkit'?webkit:chromium).launch({headless:true,executablePath:process.env[engine==='webkit'?'CU_WEBKIT_EXECUTABLE':'CU_CHROMIUM_EXECUTABLE']||undefined});report.engine=engine;report.browser=browser.version();
async function settle(page,expected){
 await page.waitForFunction(n=>document.querySelectorAll('#chat > .mes').length===n&&document.querySelectorAll('#chat > .mes > .mesAvatarWrapper').length===0,expected,{timeout:60000});
 await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
}
const stats=page=>page.evaluate(()=>structuredClone(window.cuPerf));
const reset=page=>page.evaluate(()=>{window.cuPerf={visits:0,calls:0,tasks:[]};});
try{for(const sc of cases){
 const context=await browser.newContext({viewport:{width:sc.width,height:950},isMobile:sc.width<900,hasTouch:sc.width<900,locale:'zh-CN'});
 await context.addInitScript(()=>{
  localStorage.setItem('language','zh-cn');window.cuPerf={visits:0,calls:0,tasks:[]};
  if(PerformanceObserver.supportedEntryTypes.includes('longtask'))new PerformanceObserver(list=>{for(const x of list.getEntries())window.cuPerf.tasks.push(x.duration);}).observe({type:'longtask',buffered:true});
 });
 let pointer='Default Fixture';const loads=[],writes=[],recentRequests=[],groupLoads=[];
 const fixtureGroup={id:'perf-group',name:'Performance Group',members:['default_Seraphina.png'],disabled_members:[],chat_id:'Group Default',chats:['Group Default','Group History'],chat_metadata:{},past_metadata:{},allow_self_responses:false,generation_mode:0,activation_strategy:0};
 await context.route('**/api/groups/all',r=>r.fulfill({json:[fixtureGroup]}));
 await context.route('**/api/groups/edit',r=>{Object.assign(fixtureGroup,r.request().postDataJSON());return r.fulfill({json:{result:'ok'}});});
 const messages=Array.from({length:sc.total},(_,i)=>({name:i%2?'User':'Seraphina',is_user:!!(i%2),is_system:false,send_date:'2026-11-11T12:00:00Z',mes:`Message ${i+1}\n\n"Quoted text"\n\n${'长聊天性能测试，保留原生数据与编辑行为。'.repeat(6)}`,extra:{}}));
 await context.route('**/api/settings/get',async r=>{const res=await r.fetch(),data=await res.json(),s=JSON.parse(data.settings);s.firstRun=false;s.main_api='openai';s.power_user.chat_truncation=sc.limit;s.power_user.auto_scroll_chat_to_bottom=true;s.extension_settings.claude_surface={enabled:true,design:'claude',mode:'dark'};s.extension_settings.disabledExtensions=['third-party/ST-BaiBai-Book','third-party/ST-BaiBai-Tools'];data.settings=JSON.stringify(s);await r.fulfill({response:res,json:data});});
 await context.route('**/api/settings/save',r=>r.fulfill({json:{result:'ok'}}));
 await context.route('**/api/themes/save',r=>r.fulfill({json:{result:'ok'}}));
 await context.route('**/api/extensions/version',r=>r.fulfill({json:{isUpToDate:true}}));
 await context.route('**/api/characters/get',async r=>{const res=await r.fetch();const data=await res.json();data.chat=pointer;await r.fulfill({response:res,json:data});});
 await context.route('**/api/characters/merge-attributes',async r=>{const body=r.request().postDataJSON();writes.push({type:'pointer',body});pointer=body.chat;await r.fulfill({json:{result:'ok'}});});
 await context.route('**/api/characters/edit',async r=>{const body=r.request().postData();const match=body.match(/name="chat"\r\n\r\n([^\r\n]*)/);if(match)pointer=match[1];writes.push({type:'card'});await r.fulfill({json:{result:'ok'}});});
 await context.route(/\/api\/(chats|groups|chat-completions)\/(save|edit|generate)(\?|$)/,r=>r.fulfill({json:{result:'ok'}}));
 await context.route('**/api/chats/get',async r=>{loads.push(r.request().postDataJSON().file_name);await r.fulfill({json:[{user_name:'User',character_name:'Seraphina',chat_metadata:{tainted:true}},...messages]});});
 await context.route('**/api/chats/group/get',r=>{groupLoads.push(r.request().postDataJSON().id);return r.fulfill({json:[{chat_metadata:{tainted:true}},...messages]});});
 await context.route('**/api/chats/recent',r=>{recentRequests.push(Date.now());return r.fulfill({json:[{avatar:'default_Seraphina.png',file_name:'Performance History.jsonl',chat_items:sc.total,last_mes:'2026-11-11',mes:'fixture'},{group:'perf-group',file_name:'Group History.jsonl',chat_items:sc.total,last_mes:'2026-11-11',mes:'group fixture'}]});});
 await context.route('**/scripts/extensions/third-party/claude-surface/**',async r=>{
  const rel=decodeURIComponent(new URL(r.request().url()).pathname.split('/claude-surface/')[1]);const file=path.resolve(source,rel);if(!file.startsWith(source+path.sep))return r.abort();
  try{let body=await fs.readFile(file);
   if(rel==='index.js'){
    let text=body.toString();const start=text.indexOf('function decorateMessages('),end=text.indexOf('function captureEditorAnchor(',start);
    let part=text.slice(start,end);const brace=part.indexOf('{');part=part.slice(0,brace+1)+' window.cuPerf.calls++; '+part.slice(brace+1);part=part.replace('forEach(message => {','forEach(message => { window.cuPerf.visits++;');text=text.slice(0,start)+part+text.slice(end);body=text+'\nObject.defineProperty(window,"cuPerfSelecting",{get:()=>!!state.selecting});';
   }
   await r.fulfill({body,contentType:rel.endsWith('.js')?'text/javascript':rel.endsWith('.css')?'text/css':'application/json'});
  }catch{await r.abort();}
 });
 const page=await context.newPage();page.setDefaultTimeout(20000);const errors=[];page.on('pageerror',e=>errors.push(String(e)));
 const result={...sc};report.cases.push(result);
 try{
  await page.goto(process.env.CU_TEST_URL||'http://127.0.0.1:8010',{waitUntil:'networkidle'});
  await page.waitForFunction(()=>document.querySelector('.cu-home-history-toggle')&&document.querySelector('.cu-recents .cu-character-row'));
  await page.locator('.cu-home-history-toggle').click();await reset(page);const start=Date.now(),requestStart=loads.length,recentStart=recentRequests.length;
  await page.locator('.cu-home-history .cu-character-row').first().click();
  await page.waitForFunction(()=>!window.cuPerfSelecting&&SillyTavern.getContext().getCurrentChatId()==='Performance History',null,{timeout:60000});
  await settle(page,sc.limit);
  await page.waitForFunction(()=>{const e=document.getElementById('chat');return Math.abs(e.scrollHeight-e.clientHeight-e.scrollTop)<=2;});
  result.navigation={ms:Date.now()-start,loads:loads.slice(requestStart),recentRequests:recentRequests.length-recentStart,...await stats(page)};
  if(!baseline){assert.deepEqual(result.navigation.loads,['Performance History']);assert.equal(writes.filter(x=>x.type==='card').length,0);assert(result.navigation.visits<=sc.limit+2,JSON.stringify(result.navigation));}
  assert.equal(await page.evaluate(()=>SillyTavern.getContext().chat.length),sc.total,'Chat data was truncated');
  // A real native append must touch one message, independent of displayed floors.
  await reset(page);
  await page.evaluate(()=>{const c=SillyTavern.getContext();const m={name:'User',is_user:true,is_system:false,send_date:'2026-11-11',mes:'Appended message',extra:{}};c.chat.push(m);c.addOneMessage(m);});
  await settle(page,sc.limit+1);result.append=await stats(page);
  if(!baseline)assert.equal(result.append.visits,1,'Appending scanned unchanged history');
  // Streaming HTML must not request structural work at all.
  await reset(page);
  for(let i=0;i<8;i++){await page.evaluate(i=>{[...document.querySelectorAll('#chat > .mes')].at(-1).querySelector('.mes_text').innerHTML=`<p>Streaming ${i}</p>`;},i);await page.evaluate(()=>new Promise(r=>requestAnimationFrame(r)));}
  result.streaming=await stats(page);if(!baseline)assert.equal(result.streaming.visits,0);
  // Editing exercises native textarea creation, content, cancel and saved DOM.
  const message=page.locator('#chat > .mes').last();await message.scrollIntoViewIfNeeded();await reset(page);
  await message.locator('.mes_edit').click();await page.locator('#curEditTextarea').fill('Edited fixture');await message.locator('.mes_edit_done').click();
  await page.waitForFunction(()=>!document.querySelector('#curEditTextarea'));await settle(page,sc.limit+1);result.edit=await stats(page);
  assert.match(await message.locator('.mes_text').innerText(),/Edited fixture/);
  if(!baseline)assert(result.edit.visits<=3,JSON.stringify(result.edit));
  // Unchanged context refreshes preserve the actual recent-row DOM and scroll.
  await page.evaluate(()=>{window.cuRecentRow=document.querySelector('.cu-recents .cu-character-row');const c=SillyTavern.getContext();for(let i=0;i<8;i++)c.eventSource.emit(c.eventTypes.ONLINE_STATUS_CHANGED);});
  await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
  result.recentNodePreserved=await page.evaluate(()=>window.cuRecentRow===document.querySelector('.cu-recents .cu-character-row'));
  if(!baseline)assert(result.recentNodePreserved);
  if(!baseline&&sc.total===400){
   const reading=page.locator('#chat > .mes').nth(50);await reading.locator('.mes_edit').click();
   await page.locator('#curEditTextarea').fill('Temporary text that will be cancelled');
   await reading.locator('.mes_edit_cancel').scrollIntoViewIfNeeded();const before=await reading.locator('.mes_text').evaluate(e=>e.getBoundingClientRect().top);
   await reading.locator('.mes_edit_cancel').click();await page.waitForFunction(()=>!document.querySelector('#curEditTextarea'));await settle(page,sc.limit+1);
   result.cancelAnchorDelta=(await reading.locator('.mes_text').evaluate(e=>e.getBoundingClientRect().top))-before;
   assert(Math.abs(result.cancelAnchorDelta)<3,'Cancel moved the reading anchor');
   assert.doesNotMatch(await reading.locator('.mes_text').innerText(),/Temporary text/);
  }
  if(sc.total===5000){
   const oldFirst=await page.locator('#chat > .mes').first().elementHandle();
   await page.locator('#show_more_messages').scrollIntoViewIfNeeded();const beforeTop=await oldFirst.evaluate(e=>e.getBoundingClientRect().top);
   await reset(page);await page.locator('#show_more_messages').scrollIntoViewIfNeeded();await page.locator('#show_more_messages').click();await settle(page,sc.limit*2+1);result.more=await stats(page);result.moreAnchorDelta=(await oldFirst.evaluate(e=>e.getBoundingClientRect().top))-beforeTop;
   if(!baseline){assert.equal(result.more.visits,sc.limit,'Loading older floors rescanned existing messages');assert(Math.abs(result.moreAnchorDelta)<3,'Loading older messages moved the reading anchor');}
  }
  if(!baseline&&sc.total===400){
   // Cross-entity group history must also load once and honor native auto-scroll.
   await page.evaluate(()=>{SillyTavern.getContext().powerUserSettings.auto_scroll_chat_to_bottom=false;});
   await page.locator('.cu-header .cu-home-action').click();
   await page.waitForFunction(()=>SillyTavern.getContext().characterId==null&&!SillyTavern.getContext().groupId);
   await page.locator('.cu-home-history-toggle').click();
   await page.locator('.cu-home-history').getByRole('button',{name:'Performance Group',exact:true}).click();
   await page.waitForFunction(()=>!window.cuPerfSelecting&&SillyTavern.getContext().groupId==='perf-group');await settle(page,sc.limit);
   assert.deepEqual(groupLoads,['Group History']);assert.equal(await page.locator('#chat').evaluate(e=>e.scrollTop),0);
   await page.locator('#chat').evaluate(e=>{e.scrollTop=500;});
   await page.locator('#cu-sidebar-toggle').click();await page.locator('.cu-recents').getByRole('button',{name:'Performance Group',exact:true}).click();
   await page.waitForFunction(()=>!window.cuPerfSelecting);assert.deepEqual(groupLoads,['Group History']);assert.equal(await page.locator('#chat').evaluate(e=>e.scrollTop),500);
   await page.locator('.cu-header .cu-home-action').click();await page.waitForFunction(()=>!SillyTavern.getContext().groupId&&SillyTavern.getContext().characterId==null);
   await page.locator('.cu-home-history-toggle').click();await page.locator('.cu-home-history').getByRole('button',{name:'Seraphina',exact:true}).click();
   await page.waitForFunction(()=>!window.cuPerfSelecting&&SillyTavern.getContext().characterId!=null);await settle(page,sc.limit);
   result.groupLoads=groupLoads;result.nativeAutoScrollRespected=true;
  }
  if(!baseline){
   // Palette changes should not traverse history; banner changes should restore.
   await page.locator('.cu-header button[aria-label="更多"]').click();await page.locator('.cu-sheet').getByRole('button',{name:'主题设置',exact:true}).click();await reset(page);
   await page.locator('[data-cu-mode="light"]').click();await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));result.palette=await stats(page);assert.equal(result.palette.visits,0);
   const originalAvatar=await page.locator('#chat .mes[is_user="false"] .avatar img').first().evaluate(e=>({loading:e.getAttribute('loading'),decoding:e.getAttribute('decoding'),src:e.getAttribute('src')}));
   await page.getByLabel('角色消息样式',{exact:true}).selectOption('banner');
   const banner=page.locator('#chat .cu-message-hero .avatar img').first();assert.equal(await banner.getAttribute('loading'),'lazy');
   const bannerImage=await banner.elementHandle();
   await page.locator('.cu-sheet-panel').press('Escape');await page.locator('.cu-sheet').waitFor({state:'hidden'});
   // Disabling must restore native DOM once, then leave incoming messages alone.
   await page.evaluate(()=>{const el=document.getElementById('cu-extension-enabled');el.checked=false;el.dispatchEvent(new Event('change',{bubbles:true}));});
   assert.equal(await page.locator('body[data-claude-ui]').count(),0);assert.equal(await page.locator('#chat .cu-message-hero').count(),0);assert.equal(await bannerImage.evaluate(e=>e.hasAttribute('data-cu-cover')),false);assert.deepEqual(await bannerImage.evaluate(e=>({loading:e.getAttribute('loading'),decoding:e.getAttribute('decoding'),src:e.getAttribute('src')})),originalAvatar);
   await reset(page);await page.evaluate(()=>{const c=SillyTavern.getContext(),m={name:'User',is_user:true,is_system:false,mes:'While disabled',extra:{}};c.chat.push(m);c.addOneMessage(m);});await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));result.disabled=await stats(page);assert.equal(result.disabled.visits,0);
  }
  result.recentRequests=recentRequests.length-recentStart;result.errors=errors;assert.deepEqual(errors,[]);
  await page.screenshot({path:path.join(out,`${sc.total}-${sc.limit}.png`)});console.log(JSON.stringify(result));
 }catch(e){result.error=String(e);result.errors=errors;await page.screenshot({path:path.join(out,`${sc.total}-failure.png`)}).catch(()=>{});throw e;}
 finally{await fs.writeFile(path.join(out,'summary.json'),JSON.stringify(report,null,2));await context.close();}
}}
finally{await browser.close();}
