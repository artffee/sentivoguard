const H = require('../../lib/http');
const U = require('../../lib/users');
const billing = require('../../lib/billing');
const email = require('../../lib/email');
const L = require('../../server/license');
const download = require('../../lib/download');
module.exports = H.endpoint(async (req, res) => {
  if (req.method !== 'GET') return H.json(res, 405, { ok: false });
  const user = await H.user(req);
  H.json(res, 200, { ok: true, authenticated: !!user, crossDeviceLogin: U.storeConfigured(),
    user: user ? { email: user.email, createdAt: user.createdAt, emailVerified: !!user.emailVerified } : null,
    license: user ? billing.context(user) : null,
    billing: { available: billing.ready(), portalAvailable: billing.portalReady(), customer: !!user?.stripeCustomer, status: user?.billing?.status || null, suspended: !!user?.billing?.suspended },
    emailAvailable: email.configured(), licenseAvailable: L.canIssue(), downloadAvailable: download.ready() });
});
