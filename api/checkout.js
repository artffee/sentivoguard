const H = require('../lib/http');
const billing = require('../lib/billing');
const store = require('../lib/store');
const { digest } = require('../lib/users');
module.exports = H.endpoint(async (req, res) => {
  H.post(req);
  if (!billing.ready()) throw new Error('billing_unavailable');
  const user = await H.requireUser(req);
  await H.throttle(req, user.email, 'checkout', 10);
  const lock = 'checkout-lock:' + digest(user.email);
  const owner = require('node:crypto').randomUUID();
  if (!await store.create(lock, owner, 300)) return H.json(res, 409, { ok: false, error: 'checkout_in_progress' });
  let session;
  try {
    session = await billing.checkout(user, H.body(req).plan);
  } finally { await store.release(lock, owner); }
  H.json(res, 200, { ok: true, url: session.url });
});
