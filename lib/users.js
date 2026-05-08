// User registration / authentication.
//
// Stateless mode (default — no infrastructure required):
//   The user "record" lives entirely inside the sg_session JWT cookie. The
//   JWT carries the email, salt, scrypt password hash, and (optionally) the
//   attached license JWT. To "log in" on a new device you have to sign up
//   again — there's no central user store.
//
// Cross-device upgrade (documented, not enabled by default):
//   Plug a Redis-compatible store into the persist() / lookup() functions
//   below — Upstash Redis REST is one HTTP call. After that, login from
//   any device works because the email lookup is server-side.

const crypto = require("crypto");
const { sign, verify } = require("./jwt");

const SESSION_LIFETIME = 30 * 24 * 60 * 60;       // 30 days

// ── password hashing ──
function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 })
               .toString("hex");
}

function validateEmail(email) {
  return typeof email === "string" &&
         /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) &&
         email.length <= 254;
}

function validatePassword(password) {
  return typeof password === "string" &&
         password.length >= 8 && password.length <= 200;
}

// ── session JWT ──
// Uses the same SG_LICENSE_SECRET. The `typ: "session"` claim distinguishes
// these from license JWTs so the two can never be confused.
function createSession(user) {
  const now = Math.floor(Date.now() / 1000);
  return sign({
    typ:       "session",
    email:     user.email,
    salt:      user.salt,
    pwh:       user.passwordHash,
    license:   user.license || null,
    createdAt: user.createdAt,
    iat:       now,
    exp:       now + SESSION_LIFETIME
  });
}

function readSession(token) {
  const p = verify(token);
  if (!p || p.typ !== "session") return null;
  return {
    email:        p.email,
    salt:         p.salt,
    passwordHash: p.pwh,
    license:      p.license,
    createdAt:    p.createdAt
  };
}

// ── high-level operations ──
function signupUser(email, password) {
  email = email.toLowerCase().trim();
  if (!validateEmail(email))    throw new Error("invalid_email");
  if (!validatePassword(password)) throw new Error("invalid_password");

  const salt = crypto.randomBytes(16).toString("hex");
  const user = {
    email,
    salt,
    passwordHash: hashPassword(password, salt),
    license:      null,
    createdAt:    new Date().toISOString()
  };
  return user;
}

function authenticate(user, password) {
  if (!user || !user.salt || !user.passwordHash) return false;
  const expected = hashPassword(password, user.salt);
  if (expected.length !== user.passwordHash.length) return false;
  return crypto.timingSafeEqual(
    Buffer.from(expected, "hex"),
    Buffer.from(user.passwordHash, "hex")
  );
}

// Attach a license JWT to a user record (immutable update).
function attachLicense(user, licenseToken) {
  return Object.assign({}, user, { license: licenseToken });
}

module.exports = {
  signupUser, authenticate, attachLicense,
  createSession, readSession,
  validateEmail, validatePassword,
  SESSION_LIFETIME
};
