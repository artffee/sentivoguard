const H = require('../../lib/http');
const billing = require('../../lib/billing');
module.exports = H.endpoint(async (req, res) => {
  H.post(req);
  const user = await H.requireUser(req);
  await H.throttle(req, user.email, 'license', 30);
  H.json(res, 200, { ok: true, token: await billing.accountLicense(user) });
});
