import fs from 'node:fs/promises';
import path from 'node:path';
// Serve an existing checkout of the real plugin; no vendor code is shipped.
export async function installBaiFixture(context,source,{enabled=true}={}){
 const manifest=JSON.parse(await fs.readFile(path.join(source,'manifest.json'),'utf8'));
 await context.route('**/api/extensions/discover',async route=>{
  const response=await route.fetch();const list=await response.json();
  if(!list.some(x=>x.name==='third-party/ST-BaiBai-Tools'))list.push({type:'local',name:'third-party/ST-BaiBai-Tools'});
  await route.fulfill({response,json:list});
 });
 await context.route('**/api/settings/get',async route=>{
  const response=await route.fetch();const data=await response.json();const config=JSON.parse(data.settings);
  config.extension_settings ||= {};
  config.extension_settings.disabledExtensions=(config.extension_settings.disabledExtensions||[]).filter(x=>x!=='third-party/ST-BaiBai-Tools');
  const state=await fs.readFile(path.join(source,'src/features/state.js'),'utf8');
  const flags=Object.fromEntries([...state.matchAll(/^\s+(\w+Enabled): (?:true|false),/gm)].map(m=>[m[1],false]));
  config.extension_settings.baiBaiToolkit={...flags,worldInfoDrawerOptimizationEnabled:enabled,worldInfoPageOptimizationEnabled:enabled,worldInfoListOptimizationEnabled:enabled,worldInfoSearchReplaceEnabled:enabled};
  data.settings=JSON.stringify(config);await route.fulfill({response,json:data});
 });
 await context.route('**/scripts/extensions/third-party/ST-BaiBai-Tools/**',async route=>{
  const pathname=decodeURIComponent(new URL(route.request().url()).pathname).split('/ST-BaiBai-Tools/')[1];
  const file=path.resolve(source,pathname);
  if(!file.startsWith(path.resolve(source)+path.sep))return route.abort();
  try{const body=await fs.readFile(file);await route.fulfill({body,contentType:file.endsWith('.js')?'text/javascript':file.endsWith('.json')?'application/json':'application/octet-stream'});}catch{await route.abort();}
 });
 return {version:manifest.version};
}
