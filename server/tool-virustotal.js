// SentivoGuard — VirusTotal v3 client.
// Looks up SHA-256 hashes against the VirusTotal Files API and returns a
// per-file verdict aggregated across 70+ commercial AV engines.
//
//   - Key stored at ~/.sentivoguard/virustotal-key.txt (chmod 600 best-effort).
//   - In-memory + on-disk LRU cache (24h TTL) keyed by hash.
//   - Rate limit: 4 req/minute, 500/day for the free tier — enforced client-side.

const fs     = require("fs");
const path   = require("path");
const crypto = require("crypto");
const os     = require("os");

const ROOT      = path.join(os.homedir(), ".sentivoguard");
const KEY_FILE  = path.join(ROOT, "virustotal-key.txt");
const CACHE_FILE = path.join(ROOT, "vt-cache.json");
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;          // 24 hours

// ─── Key management ────────────────────────────────────────────────

function ensureRoot() {
  fs.mkdirSync(ROOT, { recursive: true });
}

function loadKey() {
  if (process.env.VIRUSTOTAL_API_KEY) return process.env.VIRUSTOTAL_API_KEY;
  try { return fs.readFileSync(KEY_FILE, "utf8").trim(); }
  catch { return ""; }
}

function saveKey(key) {
  ensureRoot();
  fs.writeFileSync(KEY_FILE, (key || "").trim(), { mode: 0o600 });
}

function clearKey() {
  try { fs.unlinkSync(KEY_FILE); } catch {}
}

function hasKey() {
  return !!loadKey();
}

// ─── Cache ─────────────────────────────────────────────────────────

let cache = null;
function loadCache() {
  if (cache) return cache;
  try { cache = JSON.parse(fs.readFileSync(CACHE_FILE, "utf8")); }
  catch { cache = {}; }
  return cache;
}

function saveCache() {
  if (!cache) return;
  ensureRoot();
  try { fs.writeFileSync(CACHE_FILE, JSON.stringify(cache)); } catch {}
}

function cacheGet(hash) {
  loadCache();
  const e = cache[hash];
  if (!e) return null;
  if (Date.now() - e.ts > CACHE_TTL_MS) {
    delete cache[hash];
    return null;
  }
  return e.value;
}

function cachePut(hash, value) {
  loadCache();
  cache[hash] = { ts: Date.now(), value };
  saveCache();
}

// ─── Rate limiter (4/min, 500/day) ─────────────────────────────────

const rateState = {
  minuteWindow: [], // timestamps
  dayWindow:    [],
};

function rateAllow() {
  const now = Date.now();
  rateState.minuteWindow = rateState.minuteWindow.filter(t => now - t < 60_000);
  rateState.dayWindow    = rateState.dayWindow   .filter(t => now - t < 86_400_000);
  if (rateState.minuteWindow.length >= 4)   return { ok: false, reason: "rate_minute" };
  if (rateState.dayWindow.length    >= 500) return { ok: false, reason: "rate_day" };
  return { ok: true };
}

function rateRecord() {
  const now = Date.now();
  rateState.minuteWindow.push(now);
  rateState.dayWindow.push(now);
}

function rateStatus() {
  const now = Date.now();
  rateState.minuteWindow = rateState.minuteWindow.filter(t => now - t < 60_000);
  rateState.dayWindow    = rateState.dayWindow   .filter(t => now - t < 86_400_000);
  return {
    minute: { used: rateState.minuteWindow.length, limit: 4   },
    day:    { used: rateState.dayWindow.length,    limit: 500 }
  };
}

// ─── Hashing ───────────────────────────────────────────────────────

function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash("sha256");
    const s = fs.createReadStream(filePath);
    s.on("data",  (c) => h.update(c));
    s.on("end",   () => resolve(h.digest("hex")));
    s.on("error", reject);
  });
}

// ─── API call ──────────────────────────────────────────────────────
// Uses Node 22's global fetch.

async function lookupHash(sha256) {
  if (!sha256 || !/^[a-f0-9]{64}$/i.test(sha256))
    return { ok: false, error: "invalid_hash" };

  const cached = cacheGet(sha256);
  if (cached) return { ok: true, cached: true, ...cached };

  const key = loadKey();
  if (!key) return { ok: false, error: "no_key" };

  const limit = rateAllow();
  if (!limit.ok) return { ok: false, error: limit.reason, status: rateStatus() };

  rateRecord();

  let resp;
  try {
    resp = await fetch("https://www.virustotal.com/api/v3/files/" + sha256, {
      method: "GET",
      headers: { "x-apikey": key }
    });
  } catch (e) {
    return { ok: false, error: "network", detail: e.message };
  }

  if (resp.status === 404) {
    const value = { found: false, sha256 };
    cachePut(sha256, value);
    return { ok: true, ...value };
  }
  if (resp.status === 401) return { ok: false, error: "unauthorized" };
  if (resp.status === 429) return { ok: false, error: "rate_limited" };
  if (!resp.ok)            return { ok: false, error: "http_" + resp.status };

  let json;
  try { json = await resp.json(); }
  catch { return { ok: false, error: "parse_error" }; }

  const attrs  = json.data?.attributes || {};
  const stats  = attrs.last_analysis_stats || {};
  const total  = (stats.malicious || 0) + (stats.suspicious || 0) +
                 (stats.undetected || 0) + (stats.harmless || 0) +
                 (stats.timeout || 0);

  const value = {
    found:           true,
    sha256,
    malicious:       stats.malicious  || 0,
    suspicious:      stats.suspicious || 0,
    undetected:      stats.undetected || 0,
    harmless:        stats.harmless   || 0,
    timeout:         stats.timeout    || 0,
    total,
    fileType:        attrs.type_description || null,
    meaningfulName:  attrs.meaningful_name  || null,
    firstSubmission: attrs.first_submission_date  || null,
    lastAnalysis:    attrs.last_analysis_date     || null,
    reputation:      attrs.reputation             ?? null,
    permalink:       "https://www.virustotal.com/gui/file/" + sha256
  };
  cachePut(sha256, value);
  return { ok: true, ...value };
}

// Convenience: hash a local file then look up.
async function lookupFile(absPath) {
  if (!fs.existsSync(absPath)) return { ok: false, error: "not_found" };
  let stat;
  try { stat = fs.statSync(absPath); }
  catch (e) { return { ok: false, error: "stat_failed", detail: e.message }; }
  if (!stat.isFile())          return { ok: false, error: "not_a_file" };
  if (stat.size > 650_000_000) return { ok: false, error: "file_too_large" };

  let hash;
  try { hash = await sha256File(absPath); }
  catch (e) { return { ok: false, error: "hash_failed", detail: e.message }; }

  const r = await lookupHash(hash);
  return Object.assign({ path: absPath, size: stat.size }, r);
}

module.exports = {
  loadKey, saveKey, clearKey, hasKey,
  lookupHash, lookupFile,
  rateStatus,
  KEY_FILE
};
