// GET /api/download
// Validates the sg_license cookie. On success, 302-redirects to the .exe URL.
// On failure, redirects to /members?error=... so the user can re-enter their key.
//
// PROTOTYPE NOTE: the .exe currently lives at a public GitHub Release URL.
// Real gating means moving the binary off public hosting. Two clean upgrades:
//
//   1. Make the GitHub Release a *draft* (only repo owners can see it).
//      Use a GITHUB_TOKEN env var here to fetch the asset via the GitHub API
//      and stream it back. The customer never sees the source URL.
//
//   2. Upload the .exe to private storage (Vercel Blob, S3, Cloudflare R2)
//      and generate a short-lived signed URL after license verification.
//
// Both upgrades require zero changes to the customer-facing flow — only the
// `downloadUrl` resolution below changes.

const { verify } = require("../server/license");

const COOKIE = "sg_license";

const RELEASE_URL =
  "https://github.com/artffee/sentivoguard/releases/download/v2.1.0/SentivoGuard-Setup-2.1.0.exe";

module.exports = async function handler(req, res) {
  const token = readCookie(req, COOKIE);
  if (!token) return redirect(res, "/members?error=login_required");

  const r = verify(token);
  if (!r.ok) return redirect(res, "/members?error=" + encodeURIComponent(r.error));

  // Plan check — Free tier can also download (no key required, but they'd land
  // here only if they have a key already). Standard / Plus / Ultimate all OK.
  // If a future SKU shouldn't get the .exe, gate here.
  if (!r.payload.plan) return redirect(res, "/members?error=no_plan");

  // 302 to the actual download. Browser follows automatically and the file
  // saves to disk.
  res.statusCode = 302;
  res.setHeader("Location", RELEASE_URL);
  res.setHeader("Cache-Control", "no-store");
  res.end();
};

function readCookie(req, name) {
  const raw = req.headers.cookie || "";
  for (const part of raw.split(";")) {
    const [k, v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v || "");
  }
  return null;
}

function redirect(res, location) {
  res.statusCode = 302;
  res.setHeader("Location", location);
  res.setHeader("Cache-Control", "no-store");
  res.end();
}
