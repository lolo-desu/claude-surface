import test from 'node:test';import assert from 'node:assert/strict';
import {observeMessageUpdates} from '../message-updates.js';
function harness({enabled=true,follow=false}={}){
 const previous={MutationObserver:globalThis.MutationObserver,requestAnimationFrame:globalThis.requestAnimationFrame,cancelAnimationFrame:globalThis.cancelAnimationFrame};
 let callback,observer,seq=0;const frames=new Map(),listeners=new Map(),batches=[];let changed=0;
 globalThis.requestAnimationFrame=fn=>{frames.set(++seq,fn);return seq;};globalThis.cancelAnimationFrame=id=>frames.delete(id);
 globalThis.MutationObserver=class{constructor(fn){callback=fn;observer=this;}observe(){this.active=true;}disconnect(){this.active=false;}takeRecords(){return[];}};
 const root={scrollTop:5,scrollHeight:5000,addEventListener:(type,fn)=>listeners.set(type,fn)};
 const api=observeMessageUpdates({root,enabled:()=>enabled,followLoad:()=>follow,contextChanged:()=>changed++,decorate:messages=>{batches.push(messages);assert.equal(observer.active,false,'Own DOM writes must not trigger another pass');}});
 const message=()=>({nodeType:1,parentElement:root,matches:s=>s==='.mes',closest:s=>s==='.mes'?null:undefined});
 const emit=records=>callback(records,observer);
 const record=(added=[],removed=[])=>({target:root,addedNodes:added,removedNodes:removed});
 const tick=()=>{const queued=[...frames.values()];frames.clear();for(const fn of queued)fn();};
 return{api,root,message,emit,record,tick,frames,listeners,batches,get changed(){return changed;},set enabled(value){enabled=value;},restore(){Object.assign(globalThis,previous);}};
}
test('a large load is split into bounded batches and each message is visited once',()=>{
 const h=harness();try{const messages=Array.from({length:1000},h.message);h.emit([h.record(messages)]);while(h.frames.size)h.tick();
 assert.equal(h.batches.flat().length,1000);assert(h.batches.every(x=>x.length<=80));assert.equal(new Set(h.batches.flat()).size,1000);assert.equal(h.changed,1);
 }finally{h.restore();}
});
test('repeated mutations coalesce without postponing the scheduled frame',()=>{
 const h=harness();try{const m=h.message();for(let i=0;i<100;i++)h.emit([h.record([m])]);assert.equal(h.frames.size,1);h.tick();assert.deepEqual(h.batches,[[m]]);assert.equal(h.frames.size,0);}finally{h.restore();}
});
test('an edited message is the only structural target and streamed text is ignored',()=>{
 const h=harness();try{const m=h.message(),editor={nodeType:1,matches:s=>s==='#curEditTextarea',querySelector:()=>null};
 const text={closest:s=>s==='.mes'?m:{},parentElement:{closest:()=>m}};
 h.emit([{target:text,addedNodes:[{nodeType:1,matches:()=>false,querySelector:()=>null}],removedNodes:[]}]);assert.equal(h.frames.size,0);
 h.emit([{target:text,addedNodes:[editor],removedNodes:[]}]);h.tick();assert.deepEqual(h.batches,[[m]]);
 }finally{h.restore();}
});
test('removed messages cannot retain queued decoration work',()=>{
 const h=harness();try{const m=h.message();h.emit([h.record([m])]);m.parentElement=null;h.emit([h.record([],[m])]);h.tick();assert.deepEqual(h.batches,[]);}finally{h.restore();}
});
test('initial load follows the bottom but wheel input releases it',()=>{
 for(const scroll of [false,true]){const h=harness({follow:true});try{h.emit([h.record([h.message()])]);if(scroll)h.listeners.get('wheel')();h.tick();assert.equal(h.root.scrollTop,scroll?5:5000);}finally{h.restore();}}
});
test('disabled Surface does not enqueue or decorate messages',()=>{
 const h=harness({enabled:false});try{h.emit([h.record([h.message()])]);assert.equal(h.frames.size,0);assert.deepEqual(h.batches,[]);}finally{h.restore();}
});
test('explicit restore cancels pending chunks and observes again after its writes',()=>{
 const h=harness();try{h.emit([h.record(Array.from({length:100},h.message))]);let restored=false;h.api.refreshAll(()=>{restored=true;});assert(restored);assert.equal(h.frames.size,0);h.emit([h.record([h.message()])]);h.tick();assert.equal(h.batches.flat().length,1);}finally{h.restore();}
});
