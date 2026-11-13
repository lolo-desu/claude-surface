/** Third-party edit actions retain native ownership and both editors stay separate.
 * Synthetic chats; all saves, extension mutations and generation are intercepted.
 * CU_SOURCE, CU_TEST_URL, CU_TEST_OUTPUT, CU_PLAYWRIGHT_MODULE, CU_ENGINE,
 * CU_CHROMIUM_EXECUTABLE and CU_WEBKIT_EXECUTABLE are supported. CU_TARGET can
 * select native-tail, aria-state or focus-reorder for a focused follow-up.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const engines=await import(process.env.CU_PLAYWRIGHT_MODULE||'playwright');
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const sourceRoot=path.resolve(process.env.CU_SOURCE||repo),engine=process.env.CU_ENGINE||'chromium';
const executablePath=process.env[engine==='webkit'?'CU_WEBKIT_EXECUTABLE':'CU_CHROMIUM_EXECUTABLE'];
const browser=await engines[engine].launch({headless:true,...(executablePath?{executablePath}:{})});
const out=path.resolve(process.env.CU_TEST_OUTPUT||path.join(repo,'artifacts/message-edit-compat'));await fs.mkdir(out,{recursive:true});
const sample=(name='Fixture B',reasoning=true)=>({name:'Seraphina',is_user:false,is_system:false,send_date:'2026-11-13',mes:`${name}: body starts here.\n\n`+'A long editable paragraph for compatibility checks.\n\n'.repeat(18),extra:reasoning?{reasoning:`${name}: reasoning text is separate.\n\n`+'Reasoning paragraph.\n\n'.repeat(7),reasoning_duration:3500}:{}});
async function openFixture({source=sourceRoot,width=393,design='claude',mode='dark',tools=false,locale='en',messages=[sample('Fixture A',false),sample('Fixture B'),sample('Fixture C',false)]}={}){
 const context=await browser.newContext({viewport:{width,height:852},hasTouch:width<900,isMobile:width<900,locale});
 const writes=[],errors=[];
 await context.addInitScript(locale=>{localStorage.setItem('language',locale==='zh-cn'?'zh-cn':'en');if(navigator.clipboard)navigator.clipboard.writeText=async value=>{window.compatClipboard=value;};},locale);
 await context.route('**/api/settings/get',async route=>{const response=await route.fetch(),data=await response.json(),s=JSON.parse(data.settings);data.enable_extensions_auto_update=false;s.firstRun=false;s.main_api='openai';s.power_user.auto_save_msg_edits=false;s.power_user.enable_md_hotkeys=true;s.power_user.confirm_message_delete=true;s.power_user.reasoning={...s.power_user.reasoning,auto_expand:true};s.extension_settings.notifyUpdates=false;s.extension_settings.claude_surface={enabled:true,design,mode};s.extension_settings.disabledExtensions=['third-party/ST-BaiBai-Book',...(!tools?['third-party/ST-BaiBai-Tools']:[])];data.settings=JSON.stringify(s);await route.fulfill({response,json:data});});
 await context.route(/\/api\/(settings|themes|chats|groups)\/(save|edit|delete)(\?|$)/,route=>{writes.push({url:new URL(route.request().url()).pathname,body:route.request().postDataJSON()});return route.fulfill({json:{result:'ok'}});});
 await context.route(/\/api\/characters\/(edit|merge-attributes)(\?|$)/,route=>{writes.push({url:new URL(route.request().url()).pathname});return route.fulfill({json:{result:'ok'}});});
 await context.route(/\/api\/(extensions\/(install|update|delete|switch|move)|.*generate|.*completion)(\?|$)/,route=>route.abort());
 await context.route('**/api/extensions/version',route=>route.fulfill({json:{isUpToDate:true,currentBranchName:'main',currentCommitHash:'abcdef0123456789',remoteUrl:'https://github.com/example/example'}}));
 await context.route('**/api/characters/get',async route=>{const response=await route.fetch(),data=await response.json();data.chat='Edit compatibility';await route.fulfill({response,json:data});});
 await context.route('**/api/chats/recent',route=>route.fulfill({json:[]}));
 await context.route('**/api/chats/get',route=>route.fulfill({json:[{user_name:'User',character_name:'Seraphina',chat_metadata:{tainted:true}},...structuredClone(messages)]}));
 // Native saveChatConditional waits 100 ms before setting isChatSaving. Count
 // pending calls in this isolated response so chained reasoning saves can
 // settle before the next independent action; native handlers stay intact.
 await context.route('**/script.js*',async route=>{if(new URL(route.request().url()).pathname!=='/script.js')return route.fallback();const response=await route.fetch(),body=await response.text();await route.fulfill({response,body:body+'\nconst compatSaveOriginal = saveChatConditional;\nsaveChatConditional = async function(...args) { window.compatPendingSaves = (window.compatPendingSaves || 0) + 1; try { return await compatSaveOriginal.apply(this,args); } finally { --window.compatPendingSaves; } };\n'});});
 await context.route('**/scripts/extensions/third-party/claude-surface/**',async route=>{const rel=decodeURIComponent(new URL(route.request().url()).pathname.split('/claude-surface/')[1]),file=path.resolve(source,rel);if(!file.startsWith(source+path.sep))return route.abort();try{await route.fulfill({body:await fs.readFile(file),contentType:rel.endsWith('.js')?'text/javascript':rel.endsWith('.css')?'text/css':'application/json'});}catch{await route.abort();}});
 const page=await context.newPage();page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(String(e)));
 await page.goto(process.env.CU_TEST_URL||'http://127.0.0.1:8010',{waitUntil:'networkidle'});await page.locator('body[data-claude-ui]').waitFor();await page.locator('dialog.transparent_dialogue_popup[open]').waitFor({state:'hidden'});
 await page.evaluate(async()=>{window.compatNativeHost=await import('/script.js');while(window.compatNativeHost.isChatSaving||window.compatPendingSaves)await new Promise(resolve=>setTimeout(resolve,10));const ctx=SillyTavern.getContext();await ctx.selectCharacterById(0,{switchMenu:false});});
 await page.waitForFunction(n=>SillyTavern.getContext().chat.length===n&&!document.body.classList.contains('cu-home'),messages.length);
 await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 return{browser,context,page,writes,errors,close:()=>context.close()};
}

async function exerciseNativeOperations(f,frames,record){
 const page=f.page;
 const settled=async()=>{await page.waitForFunction(()=>!window.compatPendingSaves&&!window.compatNativeHost.isChatSaving&&!document.querySelector('#curEditTextarea,.reasoning_edit_textarea'));await frames();};
 await page.locator('.mes[mesid="2"] .mes_reasoning_edit_cancel').click();await page.locator('.reasoning_edit_textarea').waitFor({state:'hidden'});
 await page.locator('.mes[mesid="2"] .mes_edit').click();await page.locator('#curEditTextarea').fill('Confirmed body marker');await page.locator('.reasoning_edit_textarea').fill('Confirmed reasoning marker');
 await page.locator('[data-cu-edit-action="done"]').click();await page.locator('#curEditTextarea').waitFor({state:'hidden'});
 await page.waitForFunction(()=>SillyTavern.getContext().chat[2].mes==='Confirmed body marker'&&SillyTavern.getContext().chat[2].extra.reasoning==='Confirmed reasoning marker');await settled();
 record('native Confirm commits body and reasoning separately',await page.evaluate(()=>({body:SillyTavern.getContext().chat[2].mes,reasoning:SillyTavern.getContext().chat[2].extra.reasoning,bars:document.querySelectorAll('.cu-message-edit-controls').length})),await page.locator('.cu-message-edit-controls').count()===0);
 await page.locator('.mes[mesid="0"] .mes_edit').click();await page.locator('#curEditTextarea').waitFor();await page.locator('[data-cu-edit-action="add_reasoning"]').click();await page.locator('.reasoning_edit_textarea').waitFor();
 await page.locator('#curEditTextarea').fill('Body for newly added reasoning');await page.locator('.reasoning_edit_textarea').fill('Fresh reasoning marker');await page.locator('[data-cu-edit-action="done"]').click();await page.locator('#curEditTextarea').waitFor({state:'hidden'});
 await page.waitForFunction(()=>SillyTavern.getContext().chat[0].extra.reasoning==='Fresh reasoning marker');await settled();
 record('native Add reasoning remains available on a message without reasoning',await page.evaluate(()=>({body:SillyTavern.getContext().chat[0].mes,reasoning:SillyTavern.getContext().chat[0].extra.reasoning})),await page.evaluate(()=>SillyTavern.getContext().chat[0].mes==='Body for newly added reasoning'));
 await page.locator('.mes[mesid="0"] .mes_edit').click();await page.locator('#curEditTextarea').fill('Copied body draft');await page.locator('[data-cu-edit-action="copy"]').click();
 await page.locator('dialog[open] .popup-button-ok').last().click();await page.waitForFunction(()=>SillyTavern.getContext().chat.length===4);await frames();
 record('native Copy confirms once and copies the current main draft',await page.evaluate(()=>({count:SillyTavern.getContext().chat.length,copied:SillyTavern.getContext().chat[1].mes,editor:document.getElementById('curEditTextarea').closest('.mes').getAttribute('mesid')})),await page.evaluate(()=>SillyTavern.getContext().chat[1].mes==='Copied body draft'));
 await page.locator('[data-cu-edit-action="cancel"]').click();await page.locator('#curEditTextarea').waitFor({state:'hidden'});
 await page.locator('.mes[mesid="1"] .mes_edit').click();await page.locator('[data-cu-edit-action="delete"]').click();await page.locator('dialog[open] .popup-button-ok').last().click();await page.waitForFunction(()=>SillyTavern.getContext().chat.length===3);await frames();
 record('native Delete removes only the copied message and releases actions',await page.evaluate(()=>({count:SillyTavern.getContext().chat.length,bodies:SillyTavern.getContext().chat.map(m=>m.mes),editors:document.querySelectorAll('#curEditTextarea,.reasoning_edit_textarea').length,bars:document.querySelectorAll('.cu-message-edit-controls').length})),await page.evaluate(()=>!SillyTavern.getContext().chat.some(m=>m.mes==='Copied body draft')&&!document.querySelector('#curEditTextarea,.cu-message-edit-controls')));
}
async function exerciseThirdPartySemantics(f,frames,record){
 const page=f.page;
 await page.evaluate(()=>{
  const footer=document.getElementById('curEditTextarea').closest('.mes').querySelector('.mes_edit_buttons');
  const label=document.createElement('span');label.id='compat-external-name';label.hidden=true;label.textContent='Referenced extension action';document.body.append(label);
  const named=document.createElement('button');named.type='button';named.id='compat-named-action';named.className='menu_button';named.setAttribute('aria-label','Lower priority aria label');named.setAttribute('aria-labelledby',label.id);named.innerHTML='<svg width="18" height="18"><path d="M1 1H17V17H1Z"/></svg>';footer.append(named);
  const wrapper=document.createElement('div'),pending=document.createElement('button');wrapper.id='compat-pending-group';wrapper.style.pointerEvents='none';pending.type='button';pending.className='menu_button';pending.title='Temporarily pending extension action';pending.textContent='Pending';pending.addEventListener('click',()=>window.compatPendingCalls=(window.compatPendingCalls||0)+1);wrapper.append(pending);footer.append(wrapper);
  const fieldset=document.createElement('fieldset'),disabled=document.createElement('button');fieldset.disabled=true;disabled.type='button';disabled.className='menu_button';disabled.title='Inherited disabled extension action';disabled.textContent='Disabled';fieldset.append(disabled);footer.append(fieldset);
  const defs=document.createElementNS('http://www.w3.org/2000/svg','svg');defs.setAttribute('width','0');defs.setAttribute('height','0');defs.innerHTML='<defs><symbol id="compat-global-symbol"><rect x="1" y="1" width="18" height="18"/></symbol></defs>';document.body.append(defs);
  const symbol=document.createElement('button');symbol.type='button';symbol.className='menu_button';symbol.id='compat-global-use';symbol.title='Document SVG extension';symbol.innerHTML='<svg width="20" height="20"><use href="#compat-global-symbol"/></svg>';footer.append(symbol);
  const imageURI='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect width="20" height="20" fill="red"/></svg>');
  const image=document.createElement('button');image.type='button';image.className='menu_button';image.id='compat-image-action';image.title='SVG image extension';image.innerHTML=`<svg width="20" height="20"><image href="${imageURI}" width="20" height="20"/></svg>`;footer.append(image);
  const mutable=document.createElement('button');mutable.type='button';mutable.className='menu_button';mutable.id='compat-mutable-action';mutable.title='Mutable path extension';mutable.innerHTML='<svg width="20" height="20" viewBox="0 0 20 20"><path d="M1 1H9V9H1Z"/></svg>';footer.append(mutable);
  const long=document.createElement('button');long.type='button';long.className='menu_button';long.title='UnbrokenExtensionAction'+'X'.repeat(100);long.id='compat-long-action';footer.append(long);
 });await frames();
 const named=page.locator('.cu-message-edit-controls [aria-label="Referenced extension action"]');record('aria-labelledby takes priority and preserves an external hidden label',{count:await named.count()},await named.count()===1);
 await page.locator('#compat-external-name').evaluate(label=>label.textContent='Renamed referenced extension action');await frames();record('external referenced label mutation updates proxy name',{count:await page.locator('.cu-message-edit-controls [aria-label="Renamed referenced extension action"]').count()},await page.locator('.cu-message-edit-controls [aria-label="Renamed referenced extension action"]').count()===1);
 const pending=page.locator('.cu-message-edit-controls [aria-label="Temporarily pending extension action"]');const pendingDisabled=await pending.evaluate(button=>button.disabled);await pending.evaluate(button=>button.click());record('pointer-events loading state cannot be bypassed through the proxy',{disabled:pendingDisabled,calls:await page.evaluate(()=>window.compatPendingCalls||0)},pendingDisabled&&await page.evaluate(()=>(window.compatPendingCalls||0)===0));
 await page.locator('#compat-pending-group').evaluate(group=>group.style.removeProperty('pointer-events'));await frames();await pending.click();record('a resumed extension action remains operable',{calls:await page.evaluate(()=>window.compatPendingCalls)},await page.evaluate(()=>window.compatPendingCalls===1));
 record('fieldset disabled semantics are inherited by the proxy',{disabled:await page.locator('.cu-message-edit-controls [aria-label="Inherited disabled extension action"]').evaluate(button=>button.disabled)},await page.locator('.cu-message-edit-controls [aria-label="Inherited disabled extension action"]').evaluate(button=>button.disabled));
 const graphics=await page.evaluate(()=>{const symbol=document.querySelector('.cu-message-edit-controls [aria-label="Document SVG extension"] svg'),sourceImage=document.querySelector('#compat-image-action image'),proxyImage=document.querySelector('.cu-message-edit-controls [aria-label="SVG image extension"] image');return{symbolWidth:symbol.getBBox().width,imageHref:proxyImage.getAttribute('href'),sourceImageHref:sourceImage.getAttribute('href'),symbolIds:document.querySelectorAll('#compat-global-symbol').length};});record('document symbols and SVG image resources remain visible without duplicate IDs',graphics,graphics.symbolWidth===18&&graphics.imageHref===graphics.sourceImageHref&&graphics.symbolIds===1);
 await page.locator('#compat-mutable-action').evaluate(button=>{button.querySelector('path').setAttribute('d','M1 1H17V17H1Z');button.querySelector('svg').setAttribute('viewBox','0 0 40 40');});await frames();
 const mutated=await page.locator('.cu-message-edit-controls [aria-label="Mutable path extension"]').evaluate(button=>({d:button.querySelector('path').getAttribute('d'),viewBox:button.querySelector('svg').getAttribute('viewBox')}));record('arbitrary SVG path and viewBox attribute updates refresh the icon',mutated,mutated.d==='M1 1H17V17H1Z'&&mutated.viewBox==='0 0 40 40');
 const long=await page.evaluate(()=>{const label=document.getElementById('compat-long-action').title,button=[...document.querySelectorAll('.cu-message-edit-control')].find(button=>button.getAttribute('aria-label')===label),bar=button.parentElement.getBoundingClientRect(),box=button.getBoundingClientRect();return{labelLength:label.length,left:box.left,right:box.right,width:box.width,barLeft:bar.left,barRight:bar.right};});record('a long third-party fallback label stays within the editing toolbar',long,long.left>=long.barLeft-1&&long.right<=long.barRight+1);
 await page.evaluate(()=>{const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.id='compat-direct-svg';svg.setAttribute('role','button');svg.setAttribute('tabindex','0');svg.setAttribute('aria-label','Direct SVG action');svg.setAttribute('width','24');svg.setAttribute('height','24');svg.setAttribute('viewBox','0 0 24 24');svg.innerHTML='<rect x="2" y="2" width="20" height="20"/>';svg.addEventListener('click',()=>window.compatDirectSvgCalls=(window.compatDirectSvgCalls||0)+1);document.getElementById('curEditTextarea').closest('.mes').querySelector('.mes_edit_buttons').append(svg);});await frames();
 await page.locator('#compat-direct-svg').evaluate(svg=>svg.scrollIntoView({block:'center'}));const nativeBox=await page.locator('#compat-direct-svg').boundingBox();await page.mouse.click(nativeBox.x+nativeBox.width/2,nativeBox.y+nativeBox.height/2);const nativeCalls=await page.evaluate(()=>window.compatDirectSvgCalls||0);
 await page.locator('.cu-message-edit-controls [aria-label="Direct SVG action"]').click();await frames();const direct=await page.evaluate(()=>({calls:window.compatDirectSvgCalls,svgRoots:document.querySelector('.cu-message-edit-controls [aria-label="Direct SVG action"]').querySelectorAll('svg').length,sourceIds:document.querySelectorAll('#compat-direct-svg').length}));record('a direct SVG role button retains its viewport and forwards one native event',{nativeCalls,...direct},nativeCalls===1&&direct.calls===2&&direct.svgRoots===1&&direct.sourceIds===1);
}
async function exerciseAriaStates(f,frames,record){
 const page=f.page;
 await page.evaluate(()=>{const source=document.createElement('button');source.id='compat-state-action';source.type='button';source.className='menu_button';source.setAttribute('aria-label','Start');for(const [name,value] of Object.entries({'aria-pressed':'false','aria-expanded':'false','aria-haspopup':'dialog','aria-busy':'false','aria-controls':'compat-state-panel'}))source.setAttribute(name,value);source.addEventListener('click',()=>{window.compatStateCalls=(window.compatStateCalls||0)+1;source.setAttribute('aria-label','Stop');source.setAttribute('aria-pressed','true');source.setAttribute('aria-expanded','true');source.setAttribute('aria-busy','true');});document.getElementById('curEditTextarea').closest('.mes').querySelector('.mes_edit_buttons').append(source);const panel=document.createElement('div');panel.id='compat-state-panel';panel.hidden=true;document.body.append(panel);});await frames();
 const capture=()=>page.evaluate(()=>{const source=document.getElementById('compat-state-action'),proxy=document.querySelector('.cu-message-edit-control[aria-label="'+source.getAttribute('aria-label')+'"]'),names=['aria-pressed','aria-expanded','aria-haspopup','aria-busy','aria-controls'];return{source:Object.fromEntries(names.map(name=>[name,source.getAttribute(name)])),proxy:Object.fromEntries(names.map(name=>[name,proxy.getAttribute(name)])),label:proxy.getAttribute('aria-label'),text:proxy.textContent,calls:window.compatStateCalls||0};});
 const before=await capture();record('third-party button ARIA states mirror source values',before,JSON.stringify(before.source)===JSON.stringify(before.proxy)&&before.text==='Start');
 await page.locator('.cu-message-edit-controls [aria-label="Start"]').click();await frames();const after=await capture();record('toggle caption and ARIA states update after one native action',after,JSON.stringify(after.source)===JSON.stringify(after.proxy)&&after.text==='Stop'&&after.calls===1);
 await page.locator('#compat-state-action').evaluate(source=>{for(const name of ['aria-pressed','aria-expanded','aria-haspopup','aria-busy','aria-controls'])source.removeAttribute(name);});await frames();const removed=await capture();record('removed native ARIA states do not remain on the proxy',removed,Object.values(removed.proxy).every(value=>value===null));
}
async function exerciseFocusedReorder(f,frames,record){
 const page=f.page;
 await page.locator('[data-cu-edit-action="cancel"]').focus();
 await page.evaluate(()=>{window.compatFocusedProxy=document.querySelector('[data-cu-edit-action="cancel"]');const source=document.getElementById('curEditTextarea').closest('.mes').querySelector('.mes_edit_buttons');source.prepend(source.querySelector('.mes_edit_cancel'));});await frames();
 const state=await page.evaluate(()=>({sameProxy:window.compatFocusedProxy===document.querySelector('[data-cu-edit-action="cancel"]'),focused:document.activeElement===window.compatFocusedProxy,firstAction:document.querySelector('.cu-message-edit-controls').firstElementChild.dataset.cuEditAction}));
 record('reordering a focused native action retains the same focused proxy',state,state.sameProxy&&state.focused&&state.firstAction==='cancel');
 await page.evaluate(()=>{const source=document.getElementById('curEditTextarea').closest('.mes').querySelector('.mes_edit_buttons');source.append(source.querySelector('.mes_edit_cancel'));});await frames();
}
const report={source:sourceRoot,engine,cases:[],errors:[]};
const cases=process.env.CU_CASES?JSON.parse(process.env.CU_CASES):[
 ...[320,393,430,1440].flatMap(width=>['claude','material','adwaita','swiss'].map(design=>({width,design,tools:false,locale:'en'}))),
 {width:393,design:'claude',tools:true,locale:'en'},
 {width:393,design:'claude',tools:false,locale:'zh-cn'},
];
try{for(const {width,design,tools=false,locale='en'} of cases){
 const f=await openFixture({width,design,tools,locale,...(process.env.CU_TARGET==='native-tail'?{messages:[sample('Fixture A',false),sample('Fixture C',false),sample('Fixture B')]}:{})});
 const frames=()=>f.page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 const record=(name,details,pass=true)=>{report.cases.push({width,design,tools,locale,name,pass,...details});console.log(pass?'PASS':'FAIL',width,design,tools,name);};
 try{
 if(process.env.CU_TARGET==='focus-reorder'){
  await f.page.locator('.mes[mesid="0"] .mes_edit').click();await f.page.locator('.cu-message-edit-controls').waitFor();await exerciseFocusedReorder(f,frames,record);continue;
 }
 if(process.env.CU_TARGET==='aria-state'){
  await f.page.locator('.mes[mesid="0"] .mes_edit').click();await f.page.locator('.cu-message-edit-controls').waitFor();await exerciseAriaStates(f,frames,record);continue;
 }
 if(process.env.CU_TARGET==='native-tail'){
  await f.page.locator('.mes[mesid="2"] .mes_reasoning_edit').click();await f.page.locator('.reasoning_edit_textarea').waitFor();
  await exerciseNativeOperations(f,frames,record);continue;
 }
 await f.page.locator('.mes[mesid="1"] .mes_edit').click();await f.page.locator('#curEditTextarea').waitFor();await f.page.locator('.cu-message-edit-controls').waitFor();await frames();
 await exerciseFocusedReorder(f,frames,record);
 record('native and reasoning editors retain separate identities',await f.page.evaluate(()=>({main:document.querySelectorAll('#curEditTextarea').length,reasoning:document.querySelectorAll('.reasoning_edit_textarea').length,bars:document.querySelectorAll('.cu-message-edit-controls').length,nativeBars:document.querySelectorAll('.mes[mesid="1"] .mes_edit_buttons').length,baiBars:document.querySelectorAll('.bai-bai-toolkit-message-edit-bottom-actions').length})));
 const initial=await f.page.evaluate(()=>[...document.querySelector('.cu-message-edit-controls').children].map(e=>({action:e.dataset.cuEditAction,hidden:e.hidden,disabled:e.disabled})));record('native Add reasoning CSS visibility', {initial},initial.find(x=>x.action==='add_reasoning').hidden===true);
 await f.page.evaluate(()=>{
  const source=document.querySelector('#curEditTextarea').closest('.mes').querySelector('.mes_edit_buttons');
  const button=document.createElement('button');button.type='button';button.id='compat-native-extra';button.className='menu_button compat-extra';button.title='Compat extra';
  button.innerHTML='<svg width="20" height="20" viewBox="0 0 20 20"><defs><symbol id="compat-symbol" viewBox="0 0 20 20"><rect x="1" y="1" width="18" height="18" fill="currentColor"/></symbol></defs><use href="#compat-symbol" width="20" height="20"/></svg>';
  button.addEventListener('click',function(){window.compatDirect=(window.compatDirect||0)+1;window.compatThis=this.id;});
  jQuery(document).on('click.compatAudit','#compat-native-extra',()=>window.compatDelegated=(window.compatDelegated||0)+1);
  source.append(button);
  const style=document.createElement('style');style.textContent='.compat-hide-extra #compat-native-extra {display:none!important}';document.head.append(style);
 });await frames();
 const extra=f.page.locator('.cu-message-edit-controls button[aria-label="Compat extra"]');await extra.waitFor();
 await f.page.evaluate(()=>document.querySelector('#curEditTextarea').closest('.mes').classList.add('compat-hide-extra'));await frames();
 const ancestor=await f.page.evaluate(()=>({source:getComputedStyle(document.getElementById('compat-native-extra')).display,proxyHidden:document.querySelector('.cu-message-edit-controls [aria-label="Compat extra"]').hidden}));record('ancestor class CSS updates source visibility',ancestor,ancestor.source==='none'&&ancestor.proxyHidden);
 await f.page.evaluate(()=>document.querySelector('#curEditTextarea').closest('.mes').classList.remove('compat-hide-extra'));await frames();
 record('ancestor class removal restores source visibility',{hidden:await extra.evaluate(e=>e.hidden)},await extra.evaluate(e=>!e.hidden));
 const svg=await f.page.evaluate(()=>{const orig=document.querySelector('#compat-native-extra svg'),copy=document.querySelector('.cu-message-edit-control[aria-label="Compat extra"] svg');return{sourceHref:orig.querySelector('use').getAttribute('href'),copyHref:copy.querySelector('use').getAttribute('href'),sourceBox:orig.getBBox().toJSON?.()||{width:orig.getBBox().width,height:orig.getBBox().height},copyBox:copy.getBBox().toJSON?.()||{width:copy.getBBox().width,height:copy.getBBox().height},ids:document.querySelectorAll('#compat-native-extra').length};});
 record('third-party SVG symbol remains visible',svg,svg.copyBox.width>0&&svg.copyHref===svg.sourceHref);
 await extra.click();const clicks=await f.page.evaluate(()=>({direct:window.compatDirect,delegated:window.compatDelegated,receiver:window.compatThis}));record('one proxy click reaches direct and delegated source handlers once',clicks,clicks.direct===1&&clicks.delegated===1&&clicks.receiver==='compat-native-extra');
 for(const [kind,change,restore] of [
  ['disabled class',"el.classList.add('disabled')","el.classList.remove('disabled')"],
  ['disabled property','el.disabled=true','el.disabled=false'],
  ['aria-disabled',"el.setAttribute('aria-disabled','true')","el.removeAttribute('aria-disabled')"],
  ['displayNone',"el.classList.add('displayNone')","el.classList.remove('displayNone')"],
  ['inline display',"el.style.display='none'","el.style.removeProperty('display')"],
 ]){
  await f.page.locator('#compat-native-extra').evaluate((el,code)=>Function('el',code)(el),change);await frames();
  const state=await extra.evaluate(e=>({hidden:e.hidden,disabled:e.disabled}));record('mirror '+kind,state,kind.includes('display')?state.hidden:state.disabled);
  await extra.evaluate(e=>e.click());assert.equal(await f.page.evaluate(()=>window.compatDirect),1,'Unavailable proxy forwarded a click');
  await f.page.locator('#compat-native-extra').evaluate((el,code)=>Function('el',code)(el),restore);await frames();
 }
 await f.page.locator('.mes[mesid="1"] .mes_edit_buttons').evaluate(el=>el.style.display='none');await frames();record('hidden whole footer hides proxy bar',await f.page.locator('.cu-message-edit-controls').evaluate(e=>({hidden:e.hidden})),await f.page.locator('.cu-message-edit-controls').evaluate(e=>e.hidden));
 await f.page.locator('.mes[mesid="1"] .mes_edit_buttons').evaluate(el=>el.style.display='inline-flex');await frames();record('restored footer restores live proxy bar',await f.page.locator('.cu-message-edit-controls').evaluate(e=>({hidden:e.hidden})),await f.page.locator('.cu-message-edit-controls').evaluate(e=>!e.hidden));
 await f.page.evaluate(()=>{
  const old=document.getElementById('compat-native-extra'),replacement=old.cloneNode(true);replacement.title='Replacement extra';replacement.id='compat-native-replacement';replacement.addEventListener('click',function(){window.compatReplacement=(window.compatReplacement||0)+1;window.compatReplacementThis=this.id;});old.replaceWith(replacement);
 });await frames();
 assert.equal(await f.page.locator('.cu-message-edit-controls [aria-label="Compat extra"]').count(),0);
 await f.page.locator('.cu-message-edit-controls [aria-label="Replacement extra"]').click();record('replaced source uses new DOM handler',await f.page.evaluate(()=>({clicks:window.compatReplacement,receiver:window.compatReplacementThis})),await f.page.evaluate(()=>window.compatReplacement===1&&window.compatReplacementThis==='compat-native-replacement'));
 await f.page.evaluate(()=>{const source=document.querySelector('#curEditTextarea').closest('.mes').querySelector('.mes_edit_buttons'),replacement=source.cloneNode(true);replacement.querySelector('#compat-native-replacement').addEventListener('click',function(){window.compatWholeFooter=(window.compatWholeFooter||0)+1;});source.replaceWith(replacement);});await frames();
 await f.page.locator('.cu-message-edit-controls [aria-label="Replacement extra"]').click();record('entire native footer replacement retargets source DOM',{clicks:await f.page.evaluate(()=>window.compatWholeFooter)},await f.page.evaluate(()=>window.compatWholeFooter===1));
 await f.page.evaluate(()=>{const editor=document.getElementById('curEditTextarea'),toolbar=document.createElement('div');toolbar.className='compat-markdown-toolbar';const bold=document.createElement('button');bold.type='button';bold.title='Third-party Markdown bold';bold.textContent='Bold';bold.addEventListener('click',()=>{const selection=editor.value.slice(editor.selectionStart,editor.selectionEnd);editor.setRangeText('**'+selection+'**',editor.selectionStart,editor.selectionEnd,'select');editor.dispatchEvent(new Event('input',{bubbles:true}));});toolbar.append(bold);editor.before(toolbar);window.compatReasoningBefore=editor.closest('.mes').querySelector('.reasoning_edit_textarea')?.value;editor.focus();editor.setSelectionRange(0,3);});await frames();
 await f.page.locator('.compat-markdown-toolbar button').click();
 const md=await f.page.evaluate(()=>({main:document.getElementById('curEditTextarea').value.slice(0,7),reasoningUnchanged:document.querySelector('.reasoning_edit_textarea').value===window.compatReasoningBefore,markdownBars:document.querySelectorAll('.compat-markdown-toolbar').length,proxied:document.querySelectorAll('.cu-message-edit-controls [aria-label="Third-party Markdown bold"]').length}));record('third-party Markdown toolbar preserves main editor selection and reasoning',md,md.main==='**Fix**'&&md.reasoningUnchanged&&md.markdownBars===1&&md.proxied===0);
 await exerciseThirdPartySemantics(f,frames,record);
 await exerciseAriaStates(f,frames,record);
 await f.page.locator('#curEditTextarea').fill('Edited body stays with moved message');
 await f.page.locator('[data-cu-edit-action="up"]').click();await frames();
 const up=await f.page.evaluate(()=>({id:document.querySelector('#curEditTextarea').closest('.mes').getAttribute('mesid'),disabled:document.querySelector('[data-cu-edit-action="up"]').disabled,body:document.getElementById('curEditTextarea').value}));record('up move retains edited DOM identity and disabled boundary',up,up.id==='0'&&up.disabled&&up.body==='Edited body stays with moved message');
 await f.page.locator('[data-cu-edit-action="down"]').click();await frames();await f.page.locator('[data-cu-edit-action="down"]').click();await frames();
 const down=await f.page.evaluate(()=>({id:document.querySelector('#curEditTextarea').closest('.mes').getAttribute('mesid'),disabled:document.querySelector('[data-cu-edit-action="down"]').disabled,body:document.getElementById('curEditTextarea').value}));record('down moves preserve edited DOM identity and last boundary',down,down.id==='2'&&down.disabled&&down.body==='Edited body stays with moved message');
 await f.page.locator('[data-cu-edit-action="cancel"]').click();await f.page.locator('#curEditTextarea').waitFor({state:'hidden'});await frames();
 record('cancel closes both editors and removes proxy bar',await f.page.evaluate(()=>({main:document.querySelectorAll('#curEditTextarea').length,reasoning:document.querySelectorAll('.reasoning_edit_textarea').length,bars:document.querySelectorAll('.cu-message-edit-controls').length})),await f.page.evaluate(()=>!document.querySelector('#curEditTextarea,.reasoning_edit_textarea,.cu-message-edit-controls')));
 await f.page.locator('.mes[mesid="2"] .mes_reasoning_edit').click();await f.page.locator('.reasoning_edit_textarea').waitFor();await frames();record('standalone reasoning edit does not create main-message actions',{bars:await f.page.locator('.cu-message-edit-controls').count()},await f.page.locator('.cu-message-edit-controls').count()===0);
 await exerciseNativeOperations(f,frames,record);
 await f.page.screenshot({path:out+`/compat-${`${width}-${design}-${tools?'tools':'native'}-${locale}`}.png`});

 }catch(error){report.errors.push({width,design,tools,locale,error:String(error)});await f.page.screenshot({path:path.join(out,`${width}-${design}-${tools}-${locale}-failure.png`)}).catch(()=>{});}
 finally{if(f.errors.length)report.errors.push({width,design,tools,locale,pageErrors:f.errors});await f.close();await fs.writeFile(path.join(out,`${engine}-summary.json`),JSON.stringify(report,null,2));}
}}finally{await browser.close();}
console.log(JSON.stringify({engine,cases:report.cases.length,failures:report.cases.filter(item=>!item.pass).length,errors:report.errors.length,out}));
if(report.errors.length||report.cases.some(item=>!item.pass))process.exitCode=1;
