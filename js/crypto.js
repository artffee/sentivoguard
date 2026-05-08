// SentivoGuard — encryption helpers built on the Web Crypto API.
// PBKDF2(SHA-256, 200k) → AES-GCM-256 (random 12-byte IV, random 16-byte salt).
// All payloads are JSON-stringified before encryption.

SG.crypto = (function () {
  const ITERATIONS = 200_000;
  const VERIFIER   = "SENTIVOGUARD-VAULT-OK";

  // ── Base64 helpers (Uint8Array <-> string) ──
  function bufToB64(buf) {
    const bytes = new Uint8Array(buf);
    let s = "";
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s);
  }
  function b64ToBuf(b64) {
    const s = atob(b64);
    const bytes = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
    return bytes;
  }

  async function deriveKey(password, salt) {
    const enc = new TextEncoder();
    const baseKey = await crypto.subtle.importKey(
      "raw", enc.encode(password),
      { name: "PBKDF2" }, false, ["deriveKey"]
    );
    return crypto.subtle.deriveKey(
      { name: "PBKDF2", salt, iterations: ITERATIONS, hash: "SHA-256" },
      baseKey,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"]
    );
  }

  // Encrypt a JSON-serialisable value.
  // Returns a portable envelope { v: 1, salt, iv, ct } as base64 strings.
  async function encrypt(value, password) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv   = crypto.getRandomValues(new Uint8Array(12));
    const key  = await deriveKey(password, salt);
    const data = new TextEncoder().encode(JSON.stringify(value));
    const ct   = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, data);
    return {
      v:    1,
      kdf:  "pbkdf2-sha256-200k",
      salt: bufToB64(salt),
      iv:   bufToB64(iv),
      ct:   bufToB64(ct)
    };
  }

  async function decrypt(envelope, password) {
    const salt = b64ToBuf(envelope.salt);
    const iv   = b64ToBuf(envelope.iv);
    const key  = await deriveKey(password, salt);
    const ct   = b64ToBuf(envelope.ct);
    const buf  = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
    return JSON.parse(new TextDecoder().decode(buf));
  }

  // ── Convenience: validate a master password against a small known string. ──
  async function makeVerifier(password) {
    return encrypt(VERIFIER, password);
  }
  async function checkVerifier(envelope, password) {
    try {
      const v = await decrypt(envelope, password);
      return v === VERIFIER;
    } catch { return false; }
  }

  return { encrypt, decrypt, makeVerifier, checkVerifier, VERIFIER };
})();
