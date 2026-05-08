// GET  /api/members                — returns current member context.
// GET  /api/members?action=logout  — clears all auth cookies, returns ok.
// DELETE /api/members              — same as ?action=logout.
//
// "Member" is true if EITHER:
//   - sg_license cookie is a valid license JWT (legacy path, license-only),
//   - OR sg_session cookie carries a user with an attached license.

const { verify }      = require("../server/license");
const { readSession } = require("../lib/users");
const { readCookie, clearCookie } = require("../lib/cookies");

module.exports = async function handler(req, res) {
  if ((req.query && req.query.action === "logout") || req.method === "DELETE") {
    clearCookie(res, "sg_license");
    clearCookie(res, "sg_session");
    return json(res, 200, { ok: true, loggedOut: true });
  }

  const sessionToken = readCookie(req, "sg_session");
  const licenseToken = readCookie(req, "sg_license");

  const user = sessionToken ? readSession(sessionToken) : null;

  let license = null;
  let licenseSource = null;

  if (licenseToken) {
    const r = verify(licenseToken);
    if (r.ok) { license = liteLicense(r); licenseSource = "cookie"; }
  }
  if (!license && user && user.license) {
    const r = verify(user.license);
    if (r.ok) { license = liteLicense(r); licenseSource = "session"; }
  }

  // A "member" is anyone with a valid license — either path counts.
  const member = !!license;

  return json(res, 200, {
    ok:            true,
    member,
    authenticated: !!user,
    user:          user ? { email: user.email, createdAt: user.createdAt } : null,
    license,
    licenseSource,
    // Mirror the lite license fields at the top level for backward compat
    // with the existing /members/download client.
    email:   license ? license.email   : (user ? user.email : null),
    plan:    license ? license.plan    : null,
    devices: license ? license.devices : null,
    expires: license ? license.expires : null,
    tier:    license ? license.tier    : null
  });
};

function liteLicense(r) {
  return {
    email:   r.payload.sub,
    plan:    r.payload.plan,
    devices: r.payload.devices,
    expires: r.payload.exp,
    tier:    r.tier
  };
}

function json(res, status, obj) {
  res.statusCode = status;
  res.setHeader("Content-Type",  "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(obj));
}
