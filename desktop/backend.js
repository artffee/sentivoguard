const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');

function launchOptions({ root, userData, port, token, channel, env = process.env }) {
  // userData is a real directory. root can be app.asar in a packaged build.
  fs.mkdirSync(userData, { recursive: true });
  const childEnv = { ...env };
  for (const name of Object.keys(childEnv)) {
    if (/^(STRIPE_|RESEND_|KV_|UPSTASH_|SG_LICENSE_)/.test(name) || ['REDIS_URL', 'ANTHROPIC_API_KEY', 'NODE_OPTIONS', 'SG_DATA_DIR'].includes(name)) delete childEnv[name];
  }
  Object.assign(childEnv, { SG_PORT: String(port), SG_LOCAL_TOKEN: token, ELECTRON_RUN_AS_NODE: '1' });
  // A sandbox must never quarantine into production's data directory.
  if (channel === 'sandbox') childEnv.SG_DATA_DIR = path.join(userData, 'backend');
  return { script: path.join(root, '.server.js'), options: { cwd: userData, env: childEnv, stdio: ['ignore', 'pipe', 'pipe'] } };
}

function waitForBackend(child, { port, token, timeout = 15000 }) {
  return new Promise((resolve, reject) => {
    let done = false, retryTimer, request;
    const deadline = setTimeout(() => finish(new Error('backend health timeout')), timeout);
    function finish(error) {
      if (done) return;
      done = true;
      clearTimeout(deadline); clearTimeout(retryTimer);
      child.off('error', failed); child.off('exit', exited);
      request?.destroy();
      error ? reject(error) : resolve();
    }
    const failed = error => finish(new Error('backend could not start: ' + error.code));
    const exited = code => finish(new Error('backend exited before startup: ' + code));
    child.once('error', failed); child.once('exit', exited);
    function tick() {
      if (done) return;
      let retried = false;
      const retry = () => { if (!done && !retried) { retried = true; retryTimer = setTimeout(tick, 250); } };
      request = http.get({ hostname: '127.0.0.1', port, path: '/api/health', agent: false, headers: { 'x-sg-local-token': token } }, response => {
        let body = '';
        response.on('data', chunk => { body += chunk; if (body.length > 8192) request.destroy(); });
        response.on('error', retry);
        response.on('end', () => {
          try {
            if (response.statusCode === 200 && JSON.parse(body).ok === true) return finish();
          } catch { /* Retry an incomplete or unrelated response. */ }
          retry();
        });
      });
      request.on('error', retry);
      request.setTimeout(800, () => { request.destroy(); retry(); });
    }
    tick();
  });
}
module.exports = { launchOptions, waitForBackend };
