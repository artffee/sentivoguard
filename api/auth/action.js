const H = require('../../lib/http');
const U = require('../../lib/users');
const email = require('../../lib/email');
module.exports = H.endpoint(async (req, res) => {
  H.post(req);
  const body = H.body(req);
  if (!['verify', 'reset'].includes(body.purpose)) return H.json(res, 400, { ok: false, error: 'invalid_request' });
  await H.throttle(req, U.normalize(body.email), 'email-action', 5);
  if (body.token) {
    await U.completeAction(body.token, body.purpose, body.password);
    return H.json(res, 200, { ok: true });
  }
  if (!email.configured()) throw new Error('email_delivery_unavailable');
  const user = body.purpose === 'verify' ? await H.requireUser(req) : await U.findUserInStore(U.normalize(body.email));
  if (user) {
    const token = await U.issueAction(user, body.purpose);
    const url = H.origin() + '/account-action.html#' + new URLSearchParams({ token, purpose: body.purpose });
    const verb = body.purpose === 'reset' ? 'Reset your password' : 'Verify your email';
    const result = await email.send({ to: user.email, subject: verb + ' — SentivoGuard',
      text: verb + ': ' + url + '\nThis link expires in 30 minutes and can be used once. Ignore it if you did not request it.',
      html: '<p>' + verb + ' for SentivoGuard.</p><p><a href="' + url.replace(/&/g, '&amp;') + '">' + verb + '</a></p><p>This link expires in 30 minutes and can be used once. Ignore it if you did not request it.</p>' });
    if (!result.ok) throw new Error('email_delivery_unavailable');
  }
  H.json(res, 200, { ok: true, message: 'If the account exists, a link has been sent.' });
});
