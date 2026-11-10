const {test,before,after} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const net = require('node:net');
const {spawn} = require('node:child_process');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'sg-test-'));
process.env.SG_DATA_DIR=path.join(root,'state');
const Q=require('../server/quarantine');
const {scanDisk}=require('../server/scanner-disk');
const {createGuard,staticFile}=require('../server/local-security');
let child,port,cookie;
async function request(url,options={}) {
  return new Promise((resolve,reject)=>{
    const r=http.request({host:'127.0.0.1',port,path:url,method:options.method||'GET',headers:{host:'127.0.0.1:'+port,...(options.headers||{})}},res=>{
      let body='';res.on('data',c=>body+=c);res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body}));
    });r.on('error',reject);if(options.body)r.write(options.body);r.end();
  });
}
before(async()=>{
  const server=net.createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));port=server.address().port;await new Promise(r=>server.close(r));
  child=spawn(process.execPath,['.server.js'],{cwd:path.resolve(__dirname,'..'),env:{...process.env,SG_PORT:String(port),SG_DATA_DIR:process.env.SG_DATA_DIR,SG_LICENSE_PRIVATE_KEY:'',SG_LICENSE_PUBLIC_KEY:''},stdio:['ignore','pipe','pipe']});
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('startup timeout')),5000);child.stdout.on('data',c=>{if(String(c).includes('SentivoGuard backend:')){clearTimeout(timer);resolve();}});child.once('exit',code=>reject(new Error('server exit '+code)));});
  const r=await request('/');assert.equal(r.status,200);cookie=r.headers['set-cookie'][0].split(';')[0];
});
after(async()=>{if(child){child.kill();await new Promise(r=>child.once('exit',r));}fs.rmSync(root,{recursive:true,force:true});});
test('local API rejects missing credentials, foreign origins, and DNS rebinding',async()=>{
  assert.equal((await request('/api/health')).status,403);
  assert.equal((await request('/api/health',{headers:{cookie}})).status,200);
  assert.equal((await request('/api/health',{headers:{cookie,origin:'https://evil.invalid'}})).status,403);
  assert.equal((await request('/api/health',{headers:{cookie,host:'evil.invalid'}})).status,403);
  assert.equal((await request('/api/health',{headers:{cookie,'sec-fetch-site':'cross-site'}})).status,403);
  const r=await request('/api/health',{headers:{cookie}});assert.equal(r.headers['access-control-allow-origin'],undefined);
  assert.equal(JSON.parse(r.body).version,require('../package.json').version);
  assert.equal(JSON.parse(r.body).channel,require('../desktop-release.json').channel);
});
test('local static server hides source, secrets and path traversal',async()=>{
  for(const p of ['/.env','/.server.js','/server/license.js','/package.json','/styles/%2e%2e/%2e%2e/package.json'])assert.equal((await request(p)).status,404);
  const r=await request('/');assert.ok(r.headers['content-security-policy'].includes("script-src 'self'"));assert.ok(r.headers['set-cookie'][0].includes('HttpOnly'));
});
test('mutation rejects form content and watcher requires a signed license',async()=>{
  assert.equal((await request('/api/realtime/start',{method:'POST',headers:{cookie,'content-type':'application/x-www-form-urlencoded'},body:'{}'})).status,415);
  assert.equal((await request('/api/realtime/start',{method:'POST',headers:{cookie,'content-type':'application/json'},body:'{}'})).status,403);
  const r=await request('/api/realtime/status',{headers:{cookie}});assert.equal(JSON.parse(r.body).running,false);
});
test('streaming scan continues after request body ends and returns exact file path',async()=>{
  const dir=path.join(root,'scan');fs.mkdirSync(dir);const file=path.join(dir,'inspect.js');fs.writeFileSync(file,'eval(userInput)');
  const r=await request('/api/scan/disk',{method:'POST',headers:{cookie,'content-type':'application/json'},body:JSON.stringify({quick:false,target:dir})});
  assert.equal(r.status,200);const events=r.body.trim().split('\n').map(JSON.parse);const complete=events.find(e=>e.type==='complete');
  assert.ok(complete);assert.equal(complete.aborted,false);assert.equal(complete.stats.filesScanned,1);
  assert.equal(events.find(e=>e.type==='finding').absolutePath,file);assert.equal(complete.coverage.limited,true);
});
test('file limit is reported as incomplete instead of a clean scan',async()=>{
  const dir=path.join(root,'limited');fs.mkdirSync(dir);fs.writeFileSync(path.join(dir,'a.txt'),'ordinary');fs.writeFileSync(path.join(dir,'b.txt'),'ordinary');
  const events=[];for await(const e of scanDisk({target:dir,maxFiles:1}))events.push(e);
  assert.equal(events.at(-1).verdict,'INCOMPLETE');assert.equal(events.at(-1).coverage.fileLimitReached,true);
});
test('quarantine and restore preserve bytes; concurrent operations preserve manifest',async()=>{
  const one=path.join(root,'one.txt'),two=path.join(root,'two.txt');fs.writeFileSync(one,'one');fs.writeFileSync(two,'two');
  const [a,b]=await Promise.all([Q.quarantineOne(one),Q.quarantineOne(two)]);assert.ok(a.ok&&b.ok);assert.equal(Q.list().count,2);
  const restored=await Promise.all([Q.restoreOne(a.item.id),Q.restoreOne(b.item.id)]);assert.ok(restored.every(r=>r.ok));
  assert.equal(fs.readFileSync(one,'utf8'),'one');assert.equal(Q.list().count,0);
});
test('quarantine refuses symlinks, relative paths and critical system locations',async()=>{
  const file=path.join(root,'target.txt');fs.writeFileSync(file,'test');const link=path.join(root,'link.txt');fs.symlinkSync(file,link);
  assert.equal((await Q.quarantineOne(link)).ok,false);assert.equal((await Q.quarantineOne('relative.txt')).ok,false);
  assert.equal(Q.isQuarantineSafe('/etc/passwd'),false);assert.equal(Q.isQuarantineSafe('C:\\Windows\\System32\\kernel32.dll'),false);
});
test('restore never bypasses hash checks even with force and never overwrites existing files',async()=>{
  const file=path.join(root,'changed.txt');fs.writeFileSync(file,'original');const a=await Q.quarantineOne(file);assert.ok(a.ok);
  fs.writeFileSync(a.item.quarantinePath,'tampered');assert.equal((await Q.restoreOne(a.item.id,{force:true})).error,'hash_mismatch');
  fs.writeFileSync(a.item.quarantinePath,'original');fs.writeFileSync(file,'replacement');assert.equal((await Q.restoreOne(a.item.id)).error,'original_path_occupied');
  assert.equal(fs.readFileSync(file,'utf8'),'replacement');await Q.deleteOne(a.item.id);
});
