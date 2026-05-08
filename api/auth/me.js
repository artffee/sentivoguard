// GET /api/auth/me
// Reads sg_session and sg_license cookies, returns the current user + their
// active license (whichever cookie carries it). Used by the /members and
// /members/download pages to render correctly.

const { readSession }    = require("../../lib/users");
const { readCookie }     = require("../../lib/cookies");
const { verify }         = require("../../server/license");

module.exports = async function handler(req, res) {
  const sessionToken = readCookie(req, "sg_session");
  const licenseToken = readCookie(req, "sg_license");

  const user = sessionToken ? readSession(sessionToken) : null;

  // License resolution — direct cookie wins, otherwise read from session.
  let license = null;
  let licenseSource = null;

  if (licenseToken) {
    const r = verify(licenseToken);
    if (r.ok) {
      license       = liteLicense(r);
      licenseSource = "cookie";
    }
  }
  if (!license && user && user.license) {
    const r = verify(user.license);
    if (r.ok) {
      license       = liteLicense(r);
      licenseSource = "session";
    }
  }

  res.statusCode = 200;
  res.setHeader("Content-Type",  "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify({
    ok:            true,
    authenticated: !!user,
    user:          user ? { email: user.email, createdAt: user.createdAt } : null,
    license,
    licenseSource
  }));
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
