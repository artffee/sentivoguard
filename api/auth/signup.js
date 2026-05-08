// POST /api/auth/signup
// Body: { email, password }
// On success: creates a user, auto-issues a free license, sets sg_session cookie,
// returns { ok, email }.

const {
  signupUser, attachLicense, createSession,
  validateEmail, validatePassword, SESSION_LIFETIME
} = require("../../lib/users");
const { setCookie } = require("../../lib/cookies");
const { issue }     = require("../../server/license");
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
    user = signupUser(email, password);
  } catch (e) {
    return json(res, 400, { ok: false, error: e.message });
  }

  // Auto-issue a Free-tier license so the new account can immediately
  // download. Paid plans replace this license after Stripe checkout.
  let licenseToken = null;
  try {
    licenseToken = issue({ email, plan: "free", days: 365 });
    user = attachLicense(user, licenseToken);
  } catch {
    // If license minting fails (e.g., missing secret in dev), continue —
    // they can still sign up but won't have a license attached yet.
  }

  const sessionToken = createSession(user);
  setCookie(res, "sg_session", sessionToken, SESSION_LIFETIME);

  // Fire-and-forget welcome email — never block the signup response on it.
  // Errors are logged inside lib/email.js; we just don't await.
  send(Object.assign({ to: email }, welcomeEmail(email)))
    .catch((e) => console.error("[signup] welcome email failed:", e?.message));

  return json(res, 200, {
    ok:        true,
    email,
    license:   !!licenseToken,
    plan:      "free"
  });
};

function json(res, status, obj) {
  res.statusCode = status;
  res.setHeader("Content-Type",  "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(obj));
}
