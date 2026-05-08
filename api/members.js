// GET  /api/members  — returns current member info if a valid sg_license cookie is set
// POST /api/members/logout — clears the cookie  (use ?action=logout via GET too)
//
// Used by the /members and /members/download pages to gate the UI client-side.

const { verify } = require("../server/license");

const COOKIE = "sg_license";

module.exports = async function handler(req, res) {
  // Logout — both query (?action=logout) and explicit POST work.
  if ((req.query && req.query.action === "logout") || req.method === "DELETE") {
    res.setHeader("Set-Cookie",
      `${COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`
    );
    return json(res, 200, { ok: true, loggedOut: true });
  }

  const token = readCookie(req, COOKIE);
  if (!token) return json(res, 200, { ok: true, member: false });

  const r = verify(token);
  if (!r.ok) {
    // Bad cookie — clear it.
    res.setHeader("Set-Cookie",
      `${COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`
    );
    return json(res, 200, { ok: true, member: false, reason: r.error });
  }

  return json(res, 200, {
    ok:      true,
    member:  true,
    email:   r.payload.sub,
    plan:    r.payload.plan,
    devices: r.payload.devices,
    expires: r.payload.exp,
    tier:    r.tier
  });
};

function readCookie(req, name) {
  const raw = req.headers.cookie || "";
  for (const part of raw.split(";")) {
    const [k, v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v || "");
  }
  return null;
}

function json(res, status, obj) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(obj));
}
