const H = require('../../lib/http');
const L = require('../../server/license');
const U = require('../../lib/users');
const billing = require('../../lib/billing');
// Desktop renewal is authorized by possession of a signed, unexpired license.
// No browser cookies are consumed here and no CORS access is granted.
module.exports = H.endpoint(async (req, res) => {
  if (req.method !== 'POST') return H.json(res, 405, { ok: false });
  const r = L.verify(H.body(req).token);
  if (!r.ok) return H.json(res, 401, r);
  await H.throttle(req, r.payload.sub, 'license-renew', 60);
  const user = await U.findUserInStore(r.payload.sub);
  if (!user || (r.payload.plan !== 'free' && (!billing.active(user) || user.billing.subscription !== r.payload.subscription))) return H.json(res, 403, { ok: false, error: 'license_inactive' });
  H.json(res, 200, { ok: true, token: await billing.accountLicense(user) });
});
