import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const base = new URL('../',import.meta.url);
const root = fs.existsSync(new URL('extension/localization.js',base)) ? new URL('extension/',base) : base;
const {createLocalizer,messages} = await import(new URL('localization.js',root));
test('all registered UI messages have English fallbacks and use host translation keys',()=>{
 const keys=[];const en=createLocalizer('en-US',(text,key)=>{keys.push(key);return text;});
 for(const [source,fallback]of Object.entries(messages)){
  assert.equal(en(source),fallback,source);assert(!/[\u4e00-\u9fff]/.test(fallback));
 }
 assert(keys.every(x=>x.startsWith('claude_surface.')));
});
test('Chinese locale uses consistent terminology; names and content remain unchanged',()=>{
 const zh=createLocalizer('zh-CN'),en=createLocalizer('en-GB');
 assert.equal(zh('跟随系统'),'系统');assert.equal(zh('新建对话'),'新建聊天');assert.equal(zh('打开侧边栏'),'打开侧栏');
 assert.equal(en('主题设置'),'Appearance');assert.equal(en('返回 '),'Return to ');
 assert.equal(en('Seraphina'),'Seraphina');assert.equal(zh('custom name'),'custom name');
 assert.equal(createLocalizer('fr-FR',(value,key)=>key.endsWith('Appearance')?'Apparence':value)('主题设置'),'Apparence');
});
test('every literal ui() call has a translation, including errors and accessible names',()=>{
 const source=['index.js','world-info-ui.js'].map(name=>fs.readFileSync(new URL(name,root),'utf8')).join('\n');const en=createLocalizer('en');
 for(const [,value] of source.matchAll(/ui\('([^']+)'\)/g))assert(!/[\u4e00-\u9fff]/.test(en(value)),value);
});
