// POST /api/license/verify
// Body: { token: "<JWT>" }
// On success: sets sg_license httpOnly cookie, returns { ok, plan, email, expires }.
// On failure: returns { ok: false, error }.
//
// The cookie acts as the session. Subsequent requests to /api/download and
// /api/members read the same cookie and re-verify.

const { verify } = require("../../server/license");

const COOKIE = "sg_license";

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return json(res, 405, { ok: false, error: "method_not_allowed" });
  }

  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch { body = {}; }
  }
  body = body || {};

  const token = (body.token || "").trim();
  if (!token) return json(res, 400, { ok: false, error: "missing_token" });

  const r = verify(token);
  if (!r.ok) return json(res, 200, { ok: false, error: r.error });

  // 30-day session cookie. License itself may expire later — we re-check on
  // every request, so the cookie max-age is just an upper bound.
  const maxAge = Math.min(
    30 * 24 * 60 * 60,
    Math.max(60, r.payload.exp - Math.floor(Date.now() / 1000))
  );

  res.setHeader("Set-Cookie",
    `${COOKIE}=${encodeURIComponent(token)}; HttpOnly; Secure; SameSite=Lax; ` +
    `Path=/; Max-Age=${maxAge}`
  );

  return json(res, 200, {
    ok:      true,
    email:   r.payload.sub,
    plan:    r.payload.plan,
    devices: r.payload.devices,
    expires: r.payload.exp,
    tier:    r.tier
  });
};

function json(res, status, obj) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(obj));
}
