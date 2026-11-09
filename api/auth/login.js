const U = require('../../lib/users');
const H = require('../../lib/http');
const { setCookie } = require('../../lib/cookies');
module.exports = H.endpoint(async (req, res) => {
  H.post(req);
  const body = H.body(req);
  await H.throttle(req, U.normalize(body.email));
  const user = await U.login(body.email, body.password);
  if (!user) return H.json(res, 401, { ok: false, error: 'invalid_credentials' });
  setCookie(res, 'sg_session', await U.createSession(user), U.SESSION_LIFETIME);
  H.json(res, 200, { ok: true, email: user.email });
});
