// SentivoGuard — key-value store wrapper.
// Uses Upstash Redis (REST API — no SDK) when configured, gracefully no-ops
// otherwise. Required env vars (any of):
//
//   Vercel Marketplace integration (recommended, one click):
//     KV_REST_API_URL
//     KV_REST_API_TOKEN
//
//   Direct Upstash signup (manual):
//     UPSTASH_REDIS_REST_URL
//     UPSTASH_REDIS_REST_TOKEN
//
// Setup (Vercel Marketplace):
//   1. Vercel dashboard → sentivoguard project → Storage → Create Database
//   2. Pick "Upstash Redis" → Free tier
//   3. Click "Connect" — env vars auto-inject. Done.
//
// All operations gracefully no-op if neither pair is set, so deploying
// store-aware code without configuring storage doesn't break anything —
// the system simply falls back to cookie-stateless mode.

function url() {
  return process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || "";
}
function token() {
  return process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || "";
}
function configured() {
  return !!(url() && token());
}

// Execute an arbitrary Redis command via the Upstash REST pipeline endpoint.
// Returns { ok, result, error }.
async function exec(...args) {
  if (!configured()) return { ok: false, error: "no_store" };
  let resp;
  try {
    resp = await fetch(url(), {
      method:  "POST",
      headers: {
        "Authorization": "Bearer " + token(),
        "Content-Type":  "application/json"
      },
      body: JSON.stringify(args)
    });
  } catch (e) {
    return { ok: false, error: "network", detail: e.message };
  }
  if (!resp.ok) {
    return { ok: false, error: "http_" + resp.status };
  }
  let json;
  try { json = await resp.json(); } catch { return { ok: false, error: "parse_error" }; }
  if (json.error) return { ok: false, error: json.error };
  return { ok: true, result: json.result };
}

// ── High-level API ────────────────────────────────────────────────

async function get(key) {
  const r = await exec("GET", key);
  if (!r.ok || r.result == null) return null;
  if (typeof r.result !== "string") return r.result;
  // Try JSON; fall back to raw string.
  try { return JSON.parse(r.result); } catch { return r.result; }
}

async function set(key, value, ttlSeconds) {
  const v = typeof value === "string" ? value : JSON.stringify(value);
  const args = ttlSeconds
    ? ["SET", key, v, "EX", String(ttlSeconds)]
    : ["SET", key, v];
  const r = await exec(...args);
  return r.ok && r.result === "OK";
}

async function del(key) {
  const r = await exec("DEL", key);
  return r.ok;
}

async function has(key) {
  const r = await exec("EXISTS", key);
  return r.ok && r.result === 1;
}

module.exports = { configured, get, set, del, has };
