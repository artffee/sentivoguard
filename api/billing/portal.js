const H = require('../../lib/http');
const billing = require('../../lib/billing');
module.exports = H.endpoint(async (req, res) => {
  H.post(req);
  if (!billing.portalReady()) throw new Error('billing_unavailable');
  const user = await H.requireUser(req);
  if (!user.stripeCustomer) throw new Error('billing_unavailable');
  await H.throttle(req, user.email, 'portal');
  const session = await billing.portal(user);
  H.json(res, 200, { ok: true, url: session.url });
});
