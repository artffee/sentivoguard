// GET /api/download
// Validates the sg_license cookie. On success, 302-redirects to the private
// .exe URL stored in SG_DOWNLOAD_URL (server-side env var only).
// On failure, redirects to /members?error=... so the user can re-enter their key.
//
// Storage architecture:
//   The .exe lives at /_dl/<128-bit-random>/SentivoGuard-Setup-2.1.0.exe in the
//   Vercel deployment. The path is unguessable (128 bits of entropy) and is
//   never written into HTML, JS, or CSS. The only place it appears is in the
//   Location header of THIS function's 302 response, after the JWT cookie is
//   verified. To rotate the URL, regenerate the hash, redeploy, and update
//   SG_DOWNLOAD_URL — old paths stop being referenced.
//
// HARDER-private upgrade paths (when ready):
//   1. Vercel Blob with `getDownloadUrl()` — true short-lived signed URLs
//      that expire in minutes. Each customer gets a fresh URL per download.
//   2. R2 / S3 with presigned URLs — same idea, different vendor.
//   3. Stream-through-function — fetch upstream + pipe through this function.
//      Customer never sees any upstream URL. Watch out for function timeout
//      (10s on Vercel Hobby) when the file is large or the network slow.

const { verify } = require("../server/license");

const COOKIE = "sg_license";

module.exports = async function handler(req, res) {
  const downloadUrl = process.env.SG_DOWNLOAD_URL;
  if (!downloadUrl) {
    return text(res, 500, "Download not configured. Set SG_DOWNLOAD_URL on the server.");
  }

  const token = readCookie(req, COOKIE);
  if (!token) return redirect(res, "/members?error=login_required");

  const r = verify(token);
  if (!r.ok) return redirect(res, "/members?error=" + encodeURIComponent(r.error));
  if (!r.payload.plan) return redirect(res, "/members?error=no_plan");

  // Defense-in-depth: tell intermediaries not to cache or share this redirect,
  // and ensure the unguessable URL doesn't leak through Referer.
  res.setHeader("Cache-Control",   "private, no-store, no-cache, must-revalidate");
  res.setHeader("Pragma",          "no-cache");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.statusCode = 302;
  res.setHeader("Location", downloadUrl);
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

function text(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(body);
}
