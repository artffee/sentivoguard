const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const http = require('node:http');
const { EventEmitter } = require('node:events');
const { spawn } = require('node:child_process');
const { validate } = require('../server/release-config');
const { launchOptions, waitForBackend } = require('../desktop/backend');
const { stage } = require('../tools/stage-sandbox');
const root = path.resolve(__dirname, '..');
function temporary(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-release-'));
  t.after(() => fs.rmSync(dir, {recursive:true, force:true})); return dir;
}
const testPublicKey = () => crypto.generateKeyPairSync('ed25519').publicKey.export({type:'spki',format:'pem'});

test('desktop build configuration is accepted by the installed electron-builder schema', async () => {
  const { validateConfiguration } = require('app-builder-lib/out/util/config/config');
  await validateConfiguration(require('../package.json').build, {isEnabled:false});
});

test('release configuration pins production and requires a distinct HTTPS sandbox origin', () => {
  assert.equal(validate({channel:'production',licenseOrigin:'https://sentivoguard.com'}).channel, 'production');
  assert.equal(validate({channel:'sandbox',licenseOrigin:'https://test.example.com'}).channel, 'sandbox');
  for (const origin of ['https://sentivoguard.com', 'https://www.sentivoguard.com', 'http://test.example.com', 'https://test.example.com/path', 'https://test.example.com?x=1', 'https://user:pass@test.example.com']) {
    assert.throws(() => validate({channel:'sandbox',licenseOrigin:origin}));
  }
  assert.throws(() => validate({channel:'production',licenseOrigin:'https://test.example.com'}));
});
test('packaged backend uses a real working directory and does not inherit server secrets', t => {
  const dir=temporary(t), userData=path.join(dir,'user-data');
  const env={PATH:'unchanged',STRIPE_SECRET_KEY:'fixture',RESEND_API_KEY:'fixture',KV_REST_API_TOKEN:'fixture',UPSTASH_REDIS_REST_TOKEN:'fixture',SG_LICENSE_PRIVATE_KEY:'fixture',SG_LICENSE_PUBLIC_KEY:'fixture',ANTHROPIC_API_KEY:'fixture',NODE_OPTIONS:'--require=untrusted',SG_DATA_DIR:'/production-data'};
  const launch=launchOptions({root:path.join(dir,'app.asar'),userData,port:41731,token:'local-test',channel:'sandbox',env});
  assert.equal(launch.options.cwd,userData); assert.ok(fs.statSync(userData).isDirectory());
  assert.equal(launch.script,path.join(dir,'app.asar','.server.js'));
  for (const key of Object.keys(env).filter(k => !['PATH','SG_DATA_DIR'].includes(k))) assert.equal(launch.options.env[key],undefined);
  assert.equal(launch.options.env.SG_DATA_DIR,path.join(userData,'backend'));
  assert.equal(launch.options.env.ELECTRON_RUN_AS_NODE,'1'); assert.equal(launch.options.env.PATH,'unchanged');
  assert.equal(env.SG_DATA_DIR,'/production-data');
  const production=launchOptions({root,userData,port:41730,token:'local-test',channel:'production',env});
  assert.equal(production.options.env.SG_DATA_DIR,undefined);
});
test('backend readiness authenticates a real loopback health request', async t => {
  const child=new EventEmitter(); let token;
  const server=http.createServer((req,res) => {token=req.headers['x-sg-local-token'];res.end(JSON.stringify({ok:true}));});
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  await waitForBackend(child,{port:server.address().port,token:'health-test',timeout:2000});
  assert.equal(token,'health-test'); assert.equal(child.listenerCount('exit'),0); assert.equal(child.listenerCount('error'),0);
});
test('backend startup rejects an actual missing executable promptly', async t => {
  const child=spawn(path.join(temporary(t),'missing-executable'),[]);
  await assert.rejects(waitForBackend(child,{port:1,token:'health-test',timeout:2000}),/could not start: ENOENT/);
});
test('backend exit and unhealthy service reject startup instead of opening a broken window', async t => {
  const server=http.createServer((_req,res) => {res.statusCode=403;res.end('{"ok":true}');});
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const child=new EventEmitter(), port=server.address().port;
  const waiting=waitForBackend(child,{port,token:'test',timeout:2000}); child.emit('exit',1);
  await assert.rejects(waiting,/exited before startup/);
  await assert.rejects(waitForBackend(new EventEmitter(),{port,token:'test',timeout:100}),/health timeout/);
});
test('sandbox staging works from source archives and separates identity, keys and origin', t => {
  const dir=temporary(t), destination=path.join(dir,'sandbox'), publicPem=testPublicKey();
  const originalKey=fs.readFileSync(path.join(root,'server/license-public.pem'),'utf8');
  const originalConfig=fs.readFileSync(path.join(root,'desktop-release.json'),'utf8');
  stage({root,destination,origin:'https://sandbox.example.com',publicPem});
  const pkg=JSON.parse(fs.readFileSync(path.join(destination,'package.json')));
  assert.equal(pkg.build.appId,'com.sentivoguard.sandbox'); assert.equal(pkg.name,'sentivoguard-sandbox');
  assert.equal(pkg.build.productName,'SentivoGuard Sandbox');
  assert.equal(JSON.parse(fs.readFileSync(path.join(destination,'desktop-release.json'))).licenseOrigin,'https://sandbox.example.com');
  assert.equal(fs.readFileSync(path.join(destination,'server/license-public.pem'),'utf8'),publicPem);
  assert.equal(fs.readFileSync(path.join(root,'server/license-public.pem'),'utf8'),originalKey);
  assert.equal(fs.readFileSync(path.join(root,'desktop-release.json'),'utf8'),originalConfig);
  for (const file of ['.git','node_modules','.env','.env.local','out']) assert.equal(fs.existsSync(path.join(destination,file)),false);
  for (const file of ['.server.js','desktop/backend.js','preload.js','assets/icon.ico','tools/stage-sandbox.js']) assert.ok(fs.existsSync(path.join(destination,file)));
  // The first output has no .git; it can itself be used as an archive input.
  const second=path.join(dir,'from-archive');
  fs.writeFileSync(path.join(destination,'server','private.pem'),'fixture must never ship');
  fs.writeFileSync(path.join(destination,'server','api-key.txt'),'fixture must never ship');
  stage({root:destination,destination:second,origin:'https://other.example.com',publicPem:testPublicKey()});
  assert.equal(fs.existsSync(path.join(second,'server','private.pem')),false);
  assert.equal(fs.existsSync(path.join(second,'server','api-key.txt')),false);
});
test('sandbox staging rejects production key reuse, private keys, production hosts and existing output', t => {
  const destination=path.join(temporary(t),'sandbox'), publicPem=testPublicKey();
  const args={root,destination,origin:'https://sandbox.example.com',publicPem};
  assert.throws(() => stage({...args,publicPem:fs.readFileSync(path.join(root,'server/license-public.pem'),'utf8')}),/separate_public_key/);
  assert.throws(() => stage({...args,publicPem:crypto.generateKeyPairSync('ed25519').privateKey.export({type:'pkcs8',format:'pem'})}),/public_key_required/);
  assert.throws(() => stage({...args,origin:'https://sentivoguard.com'}),/separate_origin/);
  fs.mkdirSync(destination); assert.throws(() => stage(args),/destination_already_exists/);
});
