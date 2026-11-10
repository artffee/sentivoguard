// Ed25519: only the billing service holds the private signing key.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const PLANS = {
  free: { name: 'Free', devices: 1, novaTokens: 0, realtime: false, vault: false, ultimate: false },
  standard: { name: 'Standard', devices: 3, novaTokens: 0, realtime: true, vault: false, ultimate: false },
  plus: { name: 'Plus', devices: 5, novaTokens: 0, realtime: true, vault: true, ultimate: false },
  ultimate: { name: 'Ultimate', devices: 999, novaTokens: 0, realtime: true, vault: true, ultimate: true }
};
const pem = value => (value || '').replace(/\\n/g, '\n');
function publicKey() {
  if (process.env.SG_DESKTOP_BUILD !== 'true' && process.env.SG_LICENSE_PUBLIC_KEY) return pem(process.env.SG_LICENSE_PUBLIC_KEY);
  try { return fs.readFileSync(path.join(__dirname, 'license-public.pem'), 'utf8'); } catch { return ''; }
}
function canIssue() {
  try {
    const privateKey = crypto.createPrivateKey(pem(process.env.SG_LICENSE_PRIVATE_KEY));
    const actual = crypto.createPublicKey(privateKey);
    const expected = crypto.createPublicKey(publicKey());
    return privateKey.asymmetricKeyType === 'ed25519' && actual.equals(expected);
  } catch { return false; }
}
function issue({ email, plan = 'free', days = 3, expires, subscription }) {
  if (!canIssue() || !Object.hasOwn(PLANS, plan) || typeof email !== 'string') throw new Error('license_unavailable');
  const now = Math.floor(Date.now() / 1000);
  const exp = expires || now + Math.min(days, 3) * 86400;
  if (!Number.isInteger(exp) || exp <= now || exp > now + 3 * 86400) throw new Error('expired');
  const payload = { typ: 'license', iss: 'sentivoguard', aud: 'sentivoguard-desktop', sub: email, plan,
    devices: PLANS[plan].devices, iat: now, nbf: now, exp, jti: crypto.randomUUID(), subscription: subscription || null };
  const data = Buffer.from(JSON.stringify({ alg: 'EdDSA', typ: 'JWT' })).toString('base64url') + '.' + Buffer.from(JSON.stringify(payload)).toString('base64url');
  const token = data + '.' + crypto.sign(null, Buffer.from(data), pem(process.env.SG_LICENSE_PRIVATE_KEY)).toString('base64url');
  if (!verify(token).ok) throw new Error('license_key_mismatch');
  return token;
}
function verify(token) {
  try {
    if (typeof token !== 'string' || token.length > 8000) throw new Error();
    const parts = token.split('.');
    if (parts.length !== 3 || parts.some(p => !/^[A-Za-z0-9_-]+$/.test(p))) throw new Error();
    const [h, p, s] = parts;
    const header = JSON.parse(Buffer.from(h, 'base64url'));
    if (header.alg !== 'EdDSA' || header.typ !== 'JWT') throw new Error();
    if (!crypto.verify(null, Buffer.from(h + '.' + p), publicKey(), Buffer.from(s, 'base64url'))) throw new Error();
    const payload = JSON.parse(Buffer.from(p, 'base64url'));
    const now = Math.floor(Date.now() / 1000);
    if (payload.iss !== 'sentivoguard' || payload.aud !== 'sentivoguard-desktop' || payload.typ !== 'license' ||
      !Object.hasOwn(PLANS, payload.plan) || typeof payload.sub !== 'string' || typeof payload.jti !== 'string' ||
      !Number.isInteger(payload.exp) || payload.exp <= now || !Number.isInteger(payload.nbf) || payload.nbf > now ||
      !Number.isInteger(payload.iat) || payload.iat > now || payload.exp - payload.iat > 3 * 86400 || payload.exp <= payload.iat ||
      payload.devices !== PLANS[payload.plan].devices) throw new Error();
    return { ok: true, payload, tier: PLANS[payload.plan] };
  } catch { return { ok: false, error: 'invalid_or_expired_license' }; }
}
module.exports = { issue, verify, canIssue, publicKey, PLANS };
