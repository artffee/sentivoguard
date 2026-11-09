const U = require('../../lib/users');
const H = require('../../lib/http');
const { setCookie } = require('../../lib/cookies');
module.exports = H.endpoint(async (req, res) => {
  H.post(req);
  const body = H.body(req);
  await H.throttle(req, U.normalize(body.email), 'signup', 5);
  const user = await U.signup(body.email, body.password);
  setCookie(res, 'sg_session', await U.createSession(user), U.SESSION_LIFETIME);
  H.json(res, 200, { ok: true, email: user.email, plan: 'free', emailVerified: false });
});
