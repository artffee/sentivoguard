// GET /api/download
// Auth path 1: sg_license cookie carries a license JWT directly.
// Auth path 2: sg_session cookie carries a user with an attached license JWT.
// Either succeeds → 302 to SG_DOWNLOAD_URL (private random Vercel path).
// Neither → 302 to /members?error=login_required.
//
// Hardening notes (see comments in api/auth/me.js for the upgrade path to a
// truly per-customer signed URL via Vercel Blob / R2 / S3):
//   - Cache-Control: private, no-store, no-cache  (no intermediary caching)
//   - Pragma: no-cache (legacy proxies)
//   - Referrer-Policy: no-referrer  (URL doesn't leak via Referer)
//   - X-Robots-Tag (set on the storage path itself in vercel.json) prevents
//     accidental indexing.

const { verify }      = require("../server/license");
const { readSession } = require("../lib/users");
const { readCookie }  = require("../lib/cookies");

module.exports = async function handler(req, res) {
  const downloadUrl = process.env.SG_DOWNLOAD_URL;
  if (!downloadUrl) {
    return text(res, 500, "Download not configured. Set SG_DOWNLOAD_URL on the server.");
  }

  const licenseToken = resolveLicense(req);
  if (!licenseToken) return redirect(res, "/members?error=login_required");

  const r = verify(licenseToken);
  if (!r.ok)            return redirect(res, "/members?error=" + encodeURIComponent(r.error));
  if (!r.payload.plan)  return redirect(res, "/members?error=no_plan");

  res.setHeader("Cache-Control",   "private, no-store, no-cache, must-revalidate");
  res.setHeader("Pragma",          "no-cache");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.statusCode = 302;
  res.setHeader("Location", downloadUrl);
  res.end();
};

// Look at sg_license first, then fall back to sg_session.user.license.
function resolveLicense(req) {
  const direct = readCookie(req, "sg_license");
  if (direct) return direct;

  const sessionToken = readCookie(req, "sg_session");
  if (!sessionToken) return null;

  const user = readSession(sessionToken);
  return user && user.license ? user.license : null;
}

function redirect(res, location) {
  res.statusCode = 302;
  res.setHeader("Location", location);
  res.setHeader("Cache-Control", "no-store");
  res.end();
}

function text(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type",  "text/plain; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(body);
}
