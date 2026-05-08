// User registration / authentication.
//
// Two coexisting modes:
//
//   • Cookie-stateless (default): the user record is signed into the
//     sg_session JWT cookie. Per-device only — switching browsers requires
//     a fresh signup.
//
//   • Cross-device (when KV / Upstash Redis is configured): user record is
//     persisted at `user:<email>` in the store. Login from any device looks
//     up by email and verifies the password. The cookie still carries the
//     full record as a fallback so existing sessions keep working even if
//     Redis becomes unreachable.
//
// Setup for cross-device: see lib/store.js — Vercel Marketplace → Upstash
// Redis is the one-click path.

const crypto  = require("crypto");
const { sign, verify } = require("./jwt");
const store  = require("./store");

const SESSION_LIFETIME = 30 * 24 * 60 * 60;       // 30 days

// ── Password hashing ──────────────────────────────────────────────
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

// ── Session JWT ───────────────────────────────────────────────────
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

// ── Store-backed user record ──────────────────────────────────────
function userKey(email) {
  return "user:" + email.toLowerCase().trim();
}

async function findUserInStore(email) {
  if (!store.configured()) return null;
  return await store.get(userKey(email));
}

async function saveUserToStore(user) {
  if (!store.configured()) return false;
  return await store.set(userKey(user.email), user);
}

// ── Public operations ─────────────────────────────────────────────

// Synchronous helpers (cookie-stateless creation logic — the persistence
// happens in the async signup() below).
function buildUser(email, password) {
  email = email.toLowerCase().trim();
  if (!validateEmail(email))    throw new Error("invalid_email");
  if (!validatePassword(password)) throw new Error("invalid_password");

  const salt = crypto.randomBytes(16).toString("hex");
  return {
    email,
    salt,
    passwordHash: hashPassword(password, salt),
    license:      null,
    createdAt:    new Date().toISOString()
  };
}

// Async signup — creates the user record and (if store configured) persists
// it. Throws on duplicate email when running in store-backed mode.
async function signup(email, password) {
  if (store.configured()) {
    const existing = await findUserInStore(email);
    if (existing) throw new Error("user_exists");
  }
  const user = buildUser(email, password);
  await saveUserToStore(user);  // no-op when store isn't configured
  return user;
}

// Verify a password against a user record (in-memory or fetched).
function verifyPassword(user, password) {
  if (!user || !user.salt || !user.passwordHash) return false;
  const expected = hashPassword(password, user.salt);
  if (expected.length !== user.passwordHash.length) return false;
  return crypto.timingSafeEqual(
    Buffer.from(expected,         "hex"),
    Buffer.from(user.passwordHash,"hex")
  );
}

// Async login — returns user on success, null on failure. Tries store first,
// falls back to a cookie-stateless object if provided.
async function login(email, password, cookieFallback) {
  let user = null;
  if (store.configured()) {
    user = await findUserInStore(email);
  }
  if (!user && cookieFallback) {
    if (cookieFallback.email && cookieFallback.email.toLowerCase() === email.toLowerCase()) {
      user = cookieFallback;
    }
  }
  if (!user) return null;
  if (!verifyPassword(user, password)) return null;
  return user;
}

// Attach a license to a user — persists to store and updates session-builder
// fields. Caller is responsible for refreshing the cookie.
async function attachLicense(user, licenseToken) {
  const updated = Object.assign({}, user, { license: licenseToken });
  await saveUserToStore(updated);
  return updated;
}

// Backwards-compat alias used by older signup callers (kept synchronous).
function signupUser(email, password) { return buildUser(email, password); }

// Backwards-compat sync `authenticate(user, password)` for callers that
// already have the user object.
function authenticate(user, password) { return verifyPassword(user, password); }

module.exports = {
  // New async API
  signup, login, attachLicense,
  findUserInStore, saveUserToStore,

  // Session JWT helpers
  createSession, readSession,

  // Validators
  validateEmail, validatePassword,

  // Backwards-compat exports (existing endpoints keep working)
  signupUser, authenticate,

  // Constants
  SESSION_LIFETIME,

  // Capability check (used by /api/health)
  storeConfigured: () => store.configured()
};
