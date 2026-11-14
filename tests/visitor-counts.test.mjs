import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const file=process.env.VISITOR_SCRIPT || new URL('../js/visitor-counts.js',import.meta.url);
const source=readFileSync(file,'utf8');
const config=JSON.parse(source.match(/const config = (.*);/)[1]);
const provider=process.env.INSPECTED_VERCEL_SCRIPT?readFileSync(process.env.INSPECTED_VERCEL_SCRIPT,'utf8'):null;
function browser(opts={}){
 const location=new URL(opts.url||'https://'+config.hosts[0]+config.paths[0]);
 const saved=opts.choice?{value:opts.choice,at:opts.expired?Date.now()-181*86400000:Date.now()}:null;
 const local=new Map(saved?[[config.key,JSON.stringify(saved)]]:[]),session=new Map();
 local.set('__va_attribution',JSON.stringify({userId:'PRIVATE_ID',traits:{email:'secret@example.test'}}));
 const nodes=[],listeners={},docListeners={},requests=[],scripts=[];
 function element(tag){const events={};const el={tag,children:[],dataset:{},hidden:false,style:{},setAttribute(k,v){this[k]=v;},append(...xs){this.children.push(...xs);nodes.push(...xs);},addEventListener(k,fn){events[k]=fn;},fire(k,...args){events[k]?.(...args);},focus(){},remove(){}};return el;}
 const storage=m=>({getItem(k){if(opts.noStorage)throw Error('storage');return m.get(k)||null;},setItem(k,v){if(opts.noStorage)throw Error('storage');m.set(k,v);},removeItem(k){m.delete(k);}});
 const document={head:element('head'),body:element('body'),visibilityState:opts.hidden?'hidden':'visible',referrer:opts.referrer||'',currentScript:null,createElement:element,querySelector(){return opts.flags?{}:null;},querySelectorAll(){return [];},addEventListener(k,f){docListeners[k]=f;}};
 const history={pushState(){}};
 const ctx={location,document,history,URL,URLSearchParams,Date,Set,Map,JSON,Object,Promise,navigator:{globalPrivacyControl:opts.gpc,doNotTrack:opts.dnt,userAgent:'Mozilla/5.0',webdriver:false},localStorage:storage(local),sessionStorage:storage(session),fetch:async(url,o)=>{requests.push({url,body:o?.body?JSON.parse(o.body):null});return {}},console};
 ctx.window=ctx;ctx.addEventListener=(k,f)=>listeners[k]=f;
 const context=vm.createContext(ctx);
 document.head.append=function(script){scripts.push(script);nodes.push(script);};
 vm.runInContext(source,context);
 function load(){const s=scripts.find(x=>x.tag==='script');assert(s,'collector script');document.currentScript=s;s.src=new URL(s.src,location.origin).href;
  if(provider) vm.runInContext(provider,context);else{let hook;ctx.va=(type,event)=>{if(type==='beforeSend')hook=event;if(type==='pageview'){const e=hook({type:'pageview',url:location.href});if(e)requests.push({url:'/_vercel/insights/view',body:{o:e.url}})}};for(const [t,e] of ctx.vaq||[])ctx.va(t,e);}
  s.fire('load');
 }
 const click=label=>{const b=nodes.find(x=>x.textContent===label);assert(b,label);b.fire('click');};
 return {ctx,requests,scripts,load,click,nodes,local,document,listeners,docListeners,run:()=>vm.runInContext(source,context)};
}
const settle=()=>new Promise(r=>setImmediate(r));
test('no consent, rejection, privacy signals and preview hosts produce no collector load',()=>{
 for(const opts of [{},{choice:'rejected'},{choice:'accepted',expired:true},{choice:'accepted',gpc:true},{choice:'accepted',dnt:'1'},{choice:'accepted',url:'https://preview.vercel.app'+config.paths[0]},{choice:'accepted',url:'https://'+config.hosts[0]+'/account'},{choice:'accepted',url:'https://'+config.hosts[0]+config.paths[0]+'?analytics=off'},{choice:'accepted',noStorage:true}]){const b=browser(opts);assert.equal(b.scripts.filter(x=>x.tag==='script').length,0,JSON.stringify(opts));assert.equal(b.requests.length,0);}
});
test('accept sends one sanitized pageview, never stale identity, custom events or private paths',async()=>{
 const b=browser({url:'https://'+config.hosts[0]+config.paths[0]+'?email=secret@example.test#private'});b.click(config.accept||'Allow visitor statistics');b.load();await settle();assert.equal(b.requests.length,1);assert.equal(b.requests[0].body.o,'https://'+config.hosts[0]+config.paths[0]);assert(!JSON.stringify(b.requests).match(/PRIVATE|secret|email|userId|traits|payload/));
 b.run();b.docListeners.visibilitychange();await settle();assert.equal(b.requests.length,1);
 b.ctx.va('event',{name:'private',data:{secret:'document'}});b.ctx.va('identify',{userId:'PRIVATE'});await settle();assert.equal(b.requests.length,1);
 b.ctx.location=new URL('https://'+config.hosts[0]+'/account?token=secret');b.ctx.va('pageview',{path:'/account'});await settle();assert.equal(b.requests.length,1);
});
test('withdrawal and cross-tab rejection stop an already loaded provider',async()=>{
 const b=browser({choice:'accepted'});b.load();await settle();b.click('Visitor statistics settings');b.click('No thanks');b.ctx.va('pageview',{path:config.paths[0]});await settle();assert.equal(b.requests.length,1);
 const c=browser({choice:'accepted'});c.load();await settle();c.local.set(config.key,JSON.stringify({value:'rejected',at:Date.now()}));c.listeners.storage({key:config.key});c.ctx.va('pageview',{path:config.paths[0]});await settle();assert.equal(c.requests.length,1);
});
test('hidden tabs wait; unsafe external referrers and flag payloads are skipped',async()=>{
 const b=browser({choice:'accepted',hidden:true});b.load();await settle();assert.equal(b.requests.length,0);b.document.visibilityState='visible';b.docListeners.visibilitychange();await settle();assert.equal(b.requests.length,1);
 for(const opts of [{referrer:'https://external.test/private?token=secret'},{flags:true}]){const c=browser({choice:'accepted',...opts});assert.equal(c.scripts.filter(x=>x.tag==='script').length,0);}
});
