// Exercise the actual packaged Electron runtime and app.asar backend.
// No GUI, provider requests, paid license, or customer data is involved.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { launchOptions, waitForBackend } = require('../desktop/backend');

async function main() {
  if (!process.argv[2]) throw new Error('Usage: npm run test:packaged -- /absolute/path/to/unpacked/SentivoGuard.exe');
  const executable = path.resolve(process.argv[2]);
  const archive = path.join(path.dirname(executable), 'resources', 'app.asar');
  assert.ok(fs.statSync(archive).isFile(), 'packaged app.asar required');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-packaged-'));
  let child;
  try {
    const socket = net.createServer(); await new Promise(r => socket.listen(0, '127.0.0.1', r));
    const port = socket.address().port; await new Promise(r => socket.close(r));
    const token = crypto.randomBytes(32).toString('hex');
    const launch = launchOptions({root:archive,userData:dir,port,token,channel:'sandbox'});
    child = spawn(executable, [launch.script], launch.options);
    // Drain the pipes without printing arbitrary environment/file content.
    child.stdout.resume(); child.stderr.resume();
    await waitForBackend(child, {port,token,timeout:15000});
    const headers = {'x-sg-local-token':token,'content-type':'application/json'};
    const base = 'http://127.0.0.1:' + port;
    const health = await (await fetch(base+'/api/health',{headers})).json();
    assert.equal(health.ok,true); assert.ok(health.version);
    assert.equal((await fetch(base+'/api/health')).status,403);
    assert.equal((await fetch(base+'/server/license-public.pem',{headers})).status,404);
    assert.equal((await fetch(base+'/api/realtime/start',{method:'POST',headers,body:'{}'})).status,403);
    const scanDir = path.join(dir,'fixtures'); fs.mkdirSync(scanDir);
    const fixture = path.join(scanDir,'inspect.js'); fs.writeFileSync(fixture,'eval(userInput)');
    const response = await fetch(base+'/api/scan/disk',{method:'POST',headers,body:JSON.stringify({quick:false,target:scanDir})});
    assert.equal(response.status,200);
    const events = (await response.text()).trim().split('\n').map(JSON.parse);
    assert.equal(events.find(e => e.type === 'complete').stats.filesScanned,1);
    assert.equal(events.find(e => e.type === 'finding').absolutePath,fixture);
    console.log(JSON.stringify({packagedBackend:'passed',version:health.version,channel:health.channel,checks:['ASAR startup','authenticated health','source protection','unlicensed monitoring denied','scan fixture'],windowsInstallation:'not tested'},null,2));
  } finally {
    if (child && child.exitCode === null && child.signalCode === null && child.pid) {
      const exited = new Promise(r => child.once('exit',r)); child.kill(); await exited;
    }
    fs.rmSync(dir,{recursive:true,force:true});
  }
}
main().catch(error => {console.error(error.message);process.exitCode=1;});
