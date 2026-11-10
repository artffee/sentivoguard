const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
function createGuard(port, token = crypto.randomBytes(32).toString('hex')) {
  const host = '127.0.0.1:' + port;
  function trusted(req) {
    return req.headers.host === host && (!req.headers.origin || req.headers.origin === 'http://' + host) &&
      !['cross-site', 'same-site'].includes(req.headers['sec-fetch-site']);
  }
  function allowed(req) {
    const cookie = String(req.headers.cookie || '').split(';').map(v => v.trim()).find(v => v.startsWith('sg_local='));
    const provided = cookie?.slice(9) || req.headers['x-sg-local-token'] || '';
    const expected = Buffer.from(token);
    const candidate = Buffer.from(typeof provided === 'string' ? provided : '');
    return trusted(req) && candidate.length === expected.length && crypto.timingSafeEqual(candidate, expected);
  }
  return { trusted, allowed, cookie: 'sg_local=' + token + '; HttpOnly; SameSite=Strict; Path=/' };
}
function staticFile(root, pathname) {
  let name;
  try { name = decodeURIComponent(pathname); } catch { return null; }
  if (name === '/') name = '/index.html';
  if (!/^\/(?:index\.html|(?:js|styles|assets)\/[a-zA-Z0-9_./-]+)$/.test(name)) return null;
  const file = path.resolve(root, '.' + name);
  const relative = path.relative(root, file);
  if (relative.startsWith('..') || path.isAbsolute(relative)) return null;
  try {
    const real = fs.realpathSync(file);
    const rel = path.relative(root, real);
    return rel.startsWith('..') || path.isAbsolute(rel) ? null : real;
  } catch { return null; }
}
module.exports = { createGuard, staticFile };
