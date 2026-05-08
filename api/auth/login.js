// POST /api/auth/login
// Body: { email, password }
//
// Cross-device mode (Redis configured): looks up user by email, verifies
//   password, sets a fresh sg_session cookie. Works from any browser.
//
// Per-device fallback (no Redis): the user record must already be in the
//   sg_session cookie on this browser (set during signup on this device).
//   If the cookie is missing or carries a different email, return a clear
//   "no account" error and prompt for signup.

const {
  login, readSession, createSession, SESSION_LIFETIME, storeConfigured
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

  // Build a cookie fallback record (used in non-Redis mode)
  const cookieToken = readCookie(req, "sg_session");
  const cookieUser  = cookieToken ? readSession(cookieToken) : null;

  const user = await login(email, password, cookieUser);

  if (!user) {
    // Did the user exist at all? Differentiate "wrong password" from "no account"
    if (storeConfigured()) {
      // Redis-mode: the lookup already happened. login() returns null for both
      // unknown email AND wrong password. Don't disclose which (timing safer).
      return json(res, 401, { ok: false, error: "invalid_credentials",
        hint: "Check your email and password." });
    }
    // Cookie-mode: be explicit so the user knows to sign up
    if (!cookieUser) {
      return json(res, 401, {
        ok:    false,
        error: "no_account_on_this_device",
        hint:  "This browser has no account yet. Sign up first."
      });
    }
    if (cookieUser.email.toLowerCase() !== email) {
      return json(res, 401, {
        ok:    false,
        error: "wrong_email_for_this_device",
        hint:  "A different account exists on this device. Sign out first."
      });
    }
    return json(res, 401, { ok: false, error: "wrong_password" });
  }

  setCookie(res, "sg_session", createSession(user), SESSION_LIFETIME);
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
