import fs from 'node:fs/promises';
import path from 'node:path';
// Use the upstream TauriTavern editor and a locally built CodeMirror bundle.
// Vendor sources/bundles are never included in the Surface distribution.
export async function tauriEditorFiles(source,bundle){
 let mount=await fs.readFile(path.join(source,'src/scripts/tauri/codemirror-editor.js'),'utf8');
 mount=mount.replace("import { getEditorName } from '../dom-handlers.js';","const getEditorName = source => source.getAttribute('aria-label') || source.name || 'Content';")
  .replace("import { getCodeMirrorEditor } from '../../lib.js';","const getCodeMirrorEditor = () => import('./editor-bundle.js');")
  .replaceAll("from '../popup.js'","from '/scripts/popup.js'").replaceAll("from '../i18n.js'","from '/scripts/i18n.js'").replaceAll("from '../utils.js'","from '/scripts/utils.js'");
 const bootstrap=`import {initializeCodeMirrorEditor,mountCodeMirrorEditor} from './mount.js';
initializeCodeMirrorEditor({codemirror_editor_enabled:true});
let active=true,frame;const handles=new Map();
function schedule(){if(frame)return;frame=requestAnimationFrame(async()=>{frame=null;
 for(const [source,handle] of handles)if(!source.isConnected){handle.destroy();handles.delete(source);}
 if(!active)return;
 for(const source of document.querySelectorAll('#WorldInfo textarea[name="content"]')){
  if(handles.has(source)||source.getBoundingClientRect().height===0)continue;
  let handle;handle=await mountCodeMirrorEditor(source,{onChange:()=>handle?.flush({input:true})});if(handle)handles.set(source,handle);
 }
});}
export function setEditorEnabled(value){active=value;if(!active){for(const handle of handles.values()){handle.flush({input:true});handle.destroy();}handles.clear();}else schedule();}
new MutationObserver(schedule).observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['class','style']});
addEventListener('resize',schedule);addEventListener('scroll',schedule,true);schedule();`;
 return {'mount.js':mount,'bootstrap.js':bootstrap,'editor-bundle.js':await fs.readFile(bundle)};
}
export async function installTauriEditorFixture(context,source,bundle){
 const files=await tauriEditorFiles(source,bundle);
 await context.route('**/scripts/extensions/third-party/surface-editor-qa/**',async route=>{
  const name=new URL(route.request().url()).pathname.split('/').at(-1);
  if(!(name in files))return route.abort();await route.fulfill({body:files[name],contentType:'text/javascript'});
 });
 await context.addInitScript(()=>addEventListener('load',()=>{void import('/scripts/extensions/third-party/surface-editor-qa/bootstrap.js');},{once:true}));
}
