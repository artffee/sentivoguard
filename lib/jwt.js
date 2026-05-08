// Raw HS256 JWT — used by the auth module for session tokens.
// Same SG_LICENSE_SECRET as the license module so both pieces verify against
// one secret (separate `typ` claim disambiguates session vs license).

const crypto = require("crypto");

function getSecret() {
  return process.env.SG_LICENSE_SECRET || "";
}

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
  const secret = getSecret();
  if (!secret) throw new Error("SG_LICENSE_SECRET not configured");
  const header   = { alg: "HS256", typ: "JWT" };
  const headerB  = b64url(JSON.stringify(header));
  const payB     = b64url(JSON.stringify(payload));
  const sig      = crypto.createHmac("sha256", secret).update(headerB + "." + payB).digest();
  return headerB + "." + payB + "." + b64url(sig);
}

function verify(token) {
  const secret = getSecret();
  if (!secret || typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [headerB, payB, sigB] = parts;

  const expected = crypto.createHmac("sha256", secret).update(headerB + "." + payB).digest();
  let provided;
  try { provided = b64urlDecode(sigB); } catch { return null; }
  if (expected.length !== provided.length) return null;
  if (!crypto.timingSafeEqual(expected, provided)) return null;

  let payload;
  try { payload = JSON.parse(b64urlDecode(payB).toString("utf8")); }
  catch { return null; }

  const now = Math.floor(Date.now() / 1000);
  if (payload.exp && payload.exp < now) return null;
  if (payload.nbf && payload.nbf > now) return null;
  return payload;
}

module.exports = { sign, verify };
