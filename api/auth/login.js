// POST /api/auth/login
// Body: { email, password }
//
// In stateless mode, the user record IS the sg_session cookie. Login verifies
// the supplied password against the salt + hash already in the cookie. Without
// a cookie (= different device or cleared cookies), there's no record to verify
// against — the response asks the user to sign up on this device.

const {
  readSession, authenticate, createSession, SESSION_LIFETIME
} = require("../../lib/users");
const { readCookie, setCookie } = require("../../lib/cookies");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return json(res, 405, { ok: false, error: "method_not_allowed" });
  }

  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch { body = {}; }
  }
  body = body || {};

  const email    = (body.email || "").trim().toLowerCase();
  const password = body.password || "";

  if (!email || !password) {
    return json(res, 400, { ok: false, error: "missing_credentials" });
  }

  const cookieToken = readCookie(req, "sg_session");
  if (!cookieToken) {
    return json(res, 401, {
      ok:    false,
      error: "no_account_on_this_device",
      hint:  "This browser doesn't have an account yet. Sign up first. " +
             "Cross-device login requires a Redis store — see the README."
    });
  }

  const user = readSession(cookieToken);
  if (!user) {
    return json(res, 401, { ok: false, error: "invalid_session" });
  }

  if (user.email.toLowerCase() !== email) {
    return json(res, 401, {
      ok:    false,
      error: "wrong_email_for_this_device",
      hint:  "A different account exists on this device. Sign out first to register a new one."
    });
  }

  if (!authenticate(user, password)) {
    return json(res, 401, { ok: false, error: "wrong_password" });
  }

  // Refresh the session cookie (extend expiry, keep license attachment).
  const refreshed = createSession(user);
  setCookie(res, "sg_session", refreshed, SESSION_LIFETIME);

  return json(res, 200, {
    ok:      true,
    email:   user.email,
    license: !!user.license
  });
};

function json(res, status, obj) {
  res.statusCode = status;
  res.setHeader("Content-Type",  "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(obj));
}
