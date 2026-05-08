// Cookie helpers for Vercel serverless functions.

function readCookie(req, name) {
  const raw = req.headers && req.headers.cookie || "";
  for (const part of raw.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    const k = part.slice(0, eq).trim();
    if (k === name) {
      try { return decodeURIComponent(part.slice(eq + 1).trim()); }
      catch { return part.slice(eq + 1).trim(); }
    }
  }
  return null;
}

// Append a Set-Cookie header (preserves any existing ones — useful when
// /api/auth/signup and /api/checkout need to both set sg_session and
// sg_license in the same response).
function setCookie(res, name, value, maxAge) {
  const cookie =
    `${name}=${encodeURIComponent(value)}; HttpOnly; Secure; SameSite=Lax; ` +
    `Path=/; Max-Age=${maxAge}`;
  appendHeader(res, "Set-Cookie", cookie);
}

function clearCookie(res, name) {
  appendHeader(res, "Set-Cookie",
    `${name}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`);
}

function appendHeader(res, name, value) {
  const existing = res.getHeader(name);
  if (!existing)              res.setHeader(name, value);
  else if (Array.isArray(existing)) res.setHeader(name, [...existing, value]);
  else                        res.setHeader(name, [existing, value]);
}

module.exports = { readCookie, setCookie, clearCookie };
