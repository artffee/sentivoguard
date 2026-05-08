// POST /api/auth/signup
// Body: { email, password }
//
// Creates a user record, auto-issues a free license, sets sg_session cookie,
// and (if KV/Upstash is configured) persists the user to the central store
// for cross-device login.

const {
  signup, attachLicense, createSession,
  validateEmail, validatePassword, SESSION_LIFETIME
} = require("../../lib/users");
const { setCookie }          = require("../../lib/cookies");
const { issue }              = require("../../server/license");
const { send, welcomeEmail } = require("../../lib/email");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return json(res, 405, { ok: false, error: "method_not_allowed" });
  }

  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch { body = {}; }
  }
  body = body || {};

  const email    = (body.email || "").trim();
  const password = body.password || "";

  if (!validateEmail(email)) {
    return json(res, 400, { ok: false, error: "invalid_email" });
  }
  if (!validatePassword(password)) {
    return json(res, 400, {
      ok: false,
      error: "invalid_password",
      hint:  "Password must be 8–200 characters."
    });
  }

  let user;
  try {
    user = await signup(email, password);
  } catch (e) {
    if (e.message === "user_exists") {
      return json(res, 409, {
        ok: false,
        error: "email_already_registered",
        hint:  "Sign in instead."
      });
    }
    return json(res, 400, { ok: false, error: e.message });
  }

  // Auto-issue a Free-tier license. Paid plans replace this after checkout.
  let licenseToken = null;
  try {
    licenseToken = issue({ email: user.email, plan: "free", days: 365 });
    user = await attachLicense(user, licenseToken);
  } catch {
    /* keep user without a license rather than failing signup */
  }

  setCookie(res, "sg_session", createSession(user), SESSION_LIFETIME);

  // Fire-and-forget welcome email
  send(Object.assign({ to: user.email }, welcomeEmail(user.email)))
    .catch((e) => console.error("[signup] welcome email failed:", e?.message));

  return json(res, 200, {
    ok:      true,
    email:   user.email,
    license: !!licenseToken,
    plan:    "free"
  });
};

function json(res, status, obj) {
  res.statusCode = status;
  res.setHeader("Content-Type",  "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(obj));
}
