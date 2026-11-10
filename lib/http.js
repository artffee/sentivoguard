const { readSession, digest } = require('./users');
const { readCookie } = require('./cookies');
const store = require('./store');
function json(res, status, value) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(value));
}
function origin() {
  if (!process.env.PUBLIC_ORIGIN) throw new Error('service_unavailable');
  const parsed = new URL(process.env.PUBLIC_ORIGIN);
  if (parsed.protocol !== 'https:' && !(process.env.NODE_ENV === 'test' && parsed.hostname === 'localhost')) throw new Error('service_unavailable');
  if (parsed.origin !== process.env.PUBLIC_ORIGIN || parsed.username || parsed.password) throw new Error('service_unavailable');
  return parsed.origin;
}
function body(req) {
  let value = req.body;
  if (typeof value === 'string') value = JSON.parse(value);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid_request');
  return value;
}
function post(req) {
  if (req.method !== 'POST') throw Object.assign(new Error('method_not_allowed'), { status: 405 });
  if (req.headers.origin !== origin() || req.headers['sec-fetch-site'] === 'cross-site') throw Object.assign(new Error('forbidden_origin'), { status: 403 });
  if (!String(req.headers['content-type'] || '').startsWith('application/json')) throw Object.assign(new Error('json_required'), { status: 415 });
}
async function user(req) { return readSession(readCookie(req, 'sg_session')); }
async function requireUser(req) { const u = await user(req); if (!u) throw Object.assign(new Error('sign_in_required'), { status: 401 }); return u; }
async function throttle(req, email = '', scope = 'auth', max = 10) {
  const ip = String(req.headers['x-vercel-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim();
  const keys = ['rate:' + scope + ':ip:' + digest(ip)];
  if (email) keys.push('rate:' + scope + ':email:' + digest(String(email).toLowerCase()));
  for (const key of keys) if (!await store.limit(key, max, 900)) throw Object.assign(new Error('too_many_attempts'), { status: 429 });
}
function endpoint(fn) {
  return async (req, res) => {
    try { await fn(req, res); }
    catch (e) {
      const publicErrors = ['invalid_request', 'invalid_credentials', 'invalid_password', 'invalid_or_expired_link', 'user_exists', 'email_delivery_unavailable', 'verify_email_first', 'billing_unavailable', 'billing_already_active'];
      json(res, e.status || (publicErrors.includes(e.message) ? 400 : 503), { ok: false, error: e.status || publicErrors.includes(e.message) ? e.message : 'service_unavailable' });
    }
  };
}
module.exports = { json, origin, body, post, user, requireUser, throttle, endpoint };
