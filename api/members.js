const H = require('../lib/http');
const billing = require('../lib/billing');
module.exports = H.endpoint(async (req, res) => {
  if (req.method !== 'GET') return H.json(res, 405, { ok: false });
  const user = await H.user(req);
  H.json(res, 200, { ok: true, member: !!user, authenticated: !!user,
    user: user ? { email: user.email } : null, ...(user ? billing.context(user) : {}) });
});
