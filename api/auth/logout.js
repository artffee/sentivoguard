const H = require('../../lib/http');
const { revokeSession } = require('../../lib/users');
const { readCookie, clearCookie } = require('../../lib/cookies');
module.exports = H.endpoint(async (req, res) => {
  H.post(req);
  await revokeSession(readCookie(req, 'sg_session'));
  clearCookie(res, 'sg_session');
  clearCookie(res, 'sg_license');
  H.json(res, 200, { ok: true });
});
