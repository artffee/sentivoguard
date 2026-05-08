// SentivoGuard — license module.
// JWT HS256 keys signed by the billing backend, verified locally.
//
// PRODUCTION:  set the SG_LICENSE_SECRET env var on your billing backend AND
//              on the same desktop app instance that needs to verify keys.
//              For maximum safety switch alg from HS256 to RS256 and ship
//              only the public key in the desktop bundle.
//
// LOCAL DEV:   if SG_LICENSE_SECRET is unset, the module derives a per-machine
//              ephemeral secret stored at ~/.sentivoguard/license-secret.local.
//              That keeps things working out-of-the-box for development without
//              hardcoding anything secret in source.

const crypto = require("crypto");
const fs     = require("fs");
const path   = require("path");
const os     = require("os");

function loadOrGenerateLocalSecret() {
  const dir  = path.join(os.homedir(), ".sentivoguard");
  const file = path.join(dir, "license-secret.local");
  try { fs.mkdirSync(dir, { recursive: true }); } catch {}
  try {
    const existing = fs.readFileSync(file, "utf8").trim();
    if (existing.length >= 32) return existing;
  } catch {}
  const generated = crypto.randomBytes(48).toString("base64");
  try { fs.writeFileSync(file, generated, { mode: 0o600 }); } catch {}
  return generated;
}

const SECRET = process.env.SG_LICENSE_SECRET || loadOrGenerateLocalSecret();

const PLANS = {
  free:     { name: "Free",     devices: 1, novaTokens: 0,           realtime: false, vault: false, ultimate: false },
  standard: { name: "Standard", devices: 3, novaTokens: 0,           realtime: false, vault: false, ultimate: false },
  plus:     { name: "Plus",     devices: 5, novaTokens: 1_000_000,   realtime: true,  vault: true,  ultimate: false },
  ultimate: { name: "Ultimate", devices: 999, novaTokens: 5_000_000, realtime: true,  vault: true,  ultimate: true  }
};

function b64url(buf) {
  return Buffer.from(buf).toString("base64")
    .replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}
function b64urlDecode(str) {
  str = str.replace(/-/g, "+").replace(/_/g, "/");
  while (str.length % 4) str += "=";
  return Buffer.from(str, "base64");
}

function sign(payload) {
  const header  = { alg: "HS256", typ: "JWT" };
  const headerB = b64url(JSON.stringify(header));
  const payB    = b64url(JSON.stringify(payload));
  const sig     = crypto.createHmac("sha256", SECRET)
                        .update(headerB + "." + payB)
                        .digest();
  return headerB + "." + payB + "." + b64url(sig);
}

// Returns { ok: true, payload } or { ok: false, error }.
function verify(token) {
  if (typeof token !== "string") return { ok: false, error: "missing_token" };
  const parts = token.split(".");
  if (parts.length !== 3)         return { ok: false, error: "malformed" };

  const [headerB, payB, sigB] = parts;
  const expected = crypto.createHmac("sha256", SECRET)
                         .update(headerB + "." + payB)
                         .digest();
  let provided;
  try { provided = b64urlDecode(sigB); }
  catch { return { ok: false, error: "bad_signature_b64" }; }

  if (expected.length !== provided.length ||
      !crypto.timingSafeEqual(expected, provided))
    return { ok: false, error: "signature_mismatch" };

  let payload;
  try { payload = JSON.parse(b64urlDecode(payB).toString("utf8")); }
  catch { return { ok: false, error: "payload_parse" }; }

  const now = Math.floor(Date.now() / 1000);
  if (payload.exp && payload.exp < now) return { ok: false, error: "expired", payload };
  if (payload.nbf && payload.nbf > now) return { ok: false, error: "not_yet_valid" };

  const tier = PLANS[payload.plan];
  if (!tier) return { ok: false, error: "unknown_plan" };

  return { ok: true, payload, tier };
}

// Convenience: issue a license. Used by tools/issue-license.js after a
// Stripe checkout webhook fires.
function issue({ email, plan = "plus", devices, days = 365 }) {
  if (!email)            throw new Error("email required");
  if (!PLANS[plan])      throw new Error("unknown plan: " + plan);
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss:     "sentivoguard",
    sub:     email,
    plan:    plan,
    devices: devices || PLANS[plan].devices,
    iat:     now,
    nbf:     now,
    exp:     now + days * 86400,
    jti:     crypto.randomBytes(8).toString("hex")
  };
  return sign(payload);
}

module.exports = { issue, sign, verify, PLANS };
