// SentivoGuard — Quarantine manager.
// Moves flagged files to a safe location, hashes them with SHA-256, and tracks
// every operation in a JSON manifest. Operations are fully reversible until the
// user explicitly chooses "delete permanently".
//
// Storage layout:
//   ~/.sentivoguard/
//     manifest.json        — { items: [...], whitelist: [...] }
//     quarantine/
//       <id>.bin           — moved file, renamed to defang execution

const fs     = require("fs");
const path   = require("path");
const os     = require("os");
const crypto = require("crypto");

const ROOT_DIR        = path.join(os.homedir(), ".sentivoguard");
const QUARANTINE_DIR  = path.join(ROOT_DIR, "quarantine");
const MANIFEST_PATH   = path.join(ROOT_DIR, "manifest.json");

// Quarantining anything under these prefixes is BLOCKED — these are critical
// system locations where moving a file could brick the OS.
const FORBIDDEN_PREFIXES = [
  /^[a-z]:[\\/]windows[\\/]system32(?![\\/](?:tasks|spool))/i,
  /^[a-z]:[\\/]windows[\\/]syswow64/i,
  /^[a-z]:[\\/]windows[\\/]winsxs/i,
  /^[a-z]:[\\/]windows[\\/]boot/i,
  /^[a-z]:[\\/]windows[\\/]system[\\/]/i,
  /^[a-z]:[\\/]program\s*files[\\/]windows\s*defender/i,
  /^[a-z]:[\\/]program\s*files[\\/]common\s*files[\\/]system/i,
  /^[a-z]:[\\/]\$recycle\.bin/i,
  /^[a-z]:[\\/]system\s+volume\s+information/i
];

function isQuarantineSafe(absPath) {
  const norm = absPath.replace(/\//g, "\\");
  for (const rx of FORBIDDEN_PREFIXES) {
    if (rx.test(norm)) return false;
  }
  return true;
}

// ─── Manifest I/O ──────────────────────────────────────────────────

function ensureDirs() {
  fs.mkdirSync(QUARANTINE_DIR, { recursive: true });
}

function loadManifest() {
  try {
    const raw = fs.readFileSync(MANIFEST_PATH, "utf8");
    const parsed = JSON.parse(raw);
    parsed.items     = Array.isArray(parsed.items)     ? parsed.items     : [];
    parsed.whitelist = Array.isArray(parsed.whitelist) ? parsed.whitelist : [];
    return parsed;
  } catch {
    return { items: [], whitelist: [] };
  }
}

function saveManifest(m) {
  ensureDirs();
  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(m, null, 2));
}

// ─── Hashing ───────────────────────────────────────────────────────

function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const s    = fs.createReadStream(filePath);
    s.on("data",  (c) => hash.update(c));
    s.on("end",   () => resolve(hash.digest("hex")));
    s.on("error", reject);
  });
}

// ─── Operations ────────────────────────────────────────────────────

async function quarantineOne(absPath, reason = "", finding = null) {
  const norm = path.resolve(absPath);

  if (!fs.existsSync(norm))      return { ok: false, error: "not_found",         path: norm };
  if (!isQuarantineSafe(norm))   return { ok: false, error: "forbidden_location", path: norm };

  let stat;
  try { stat = fs.statSync(norm); }
  catch (e) { return { ok: false, error: "stat_failed", detail: e.message, path: norm }; }
  if (!stat.isFile()) return { ok: false, error: "not_a_file", path: norm };

  ensureDirs();

  const hash = await sha256File(norm);
  const id   = hash.slice(0, 16) + "-" + Date.now().toString(36);
  const dest = path.join(QUARANTINE_DIR, id + ".bin");

  // Try a fast rename first; fall back to copy+unlink across drives.
  try {
    fs.renameSync(norm, dest);
  } catch (e) {
    if (e.code === "EXDEV" || e.code === "EPERM") {
      try {
        fs.copyFileSync(norm, dest);
        fs.unlinkSync(norm);
      } catch (e2) {
        // Cleanup partial copy
        try { fs.unlinkSync(dest); } catch {}
        return { ok: false, error: "move_failed", detail: e2.message, path: norm };
      }
    } else {
      return { ok: false, error: "move_failed", detail: e.message, path: norm };
    }
  }

  const item = {
    id,
    originalPath:   norm,
    quarantinePath: dest,
    sha256:         hash,
    size:           stat.size,
    originalName:   path.basename(norm),
    quarantinedAt:  new Date().toISOString(),
    reason:         (reason || "").slice(0, 400),
    finding:        finding ? {
      severity: finding.severity || null,
      category: finding.category || null,
      message:  (finding.message || "").slice(0, 400),
      line:     finding.line || null
    } : null
  };

  const m = loadManifest();
  m.items.unshift(item);
  saveManifest(m);

  return { ok: true, item };
}

async function quarantineMany(targets) {
  const results = [];
  for (const t of targets) {
    const r = await quarantineOne(t.path, t.reason, t.finding);
    results.push({ path: t.path, ...r });
  }
  return {
    ok: true,
    successCount: results.filter(r => r.ok).length,
    errorCount:   results.filter(r => !r.ok).length,
    results
  };
}

async function restoreOne(id, opts = {}) {
  const m   = loadManifest();
  const idx = m.items.findIndex(i => i.id === id);
  if (idx < 0) return { ok: false, error: "not_in_manifest" };
  const item = m.items[idx];

  if (!fs.existsSync(item.quarantinePath))
    return { ok: false, error: "quarantine_file_missing" };

  // Integrity check (skippable via opts.force).
  const hash = await sha256File(item.quarantinePath);
  if (!opts.force && hash !== item.sha256) {
    return { ok: false, error: "hash_mismatch", expected: item.sha256, actual: hash };
  }

  if (fs.existsSync(item.originalPath)) {
    return { ok: false, error: "original_path_occupied",
             detail: "A file already exists at " + item.originalPath };
  }

  // Make sure parent directory still exists.
  try { fs.mkdirSync(path.dirname(item.originalPath), { recursive: true }); } catch {}

  try {
    fs.renameSync(item.quarantinePath, item.originalPath);
  } catch (e) {
    if (e.code === "EXDEV" || e.code === "EPERM") {
      try {
        fs.copyFileSync(item.quarantinePath, item.originalPath);
        fs.unlinkSync(item.quarantinePath);
      } catch (e2) {
        return { ok: false, error: "restore_failed", detail: e2.message };
      }
    } else {
      return { ok: false, error: "restore_failed", detail: e.message };
    }
  }

  m.items.splice(idx, 1);
  saveManifest(m);
  return { ok: true, restoredTo: item.originalPath, sha256: hash };
}

async function deleteOne(id) {
  const m   = loadManifest();
  const idx = m.items.findIndex(i => i.id === id);
  if (idx < 0) return { ok: false, error: "not_in_manifest" };
  const item = m.items[idx];

  if (fs.existsSync(item.quarantinePath)) {
    try { fs.unlinkSync(item.quarantinePath); }
    catch (e) { return { ok: false, error: "delete_failed", detail: e.message }; }
  }

  m.items.splice(idx, 1);
  saveManifest(m);
  return { ok: true, deletedSize: item.size, originalPath: item.originalPath };
}

function list() {
  const m = loadManifest();
  let total = 0;
  for (const it of m.items) total += it.size || 0;
  return { ok: true, items: m.items, count: m.items.length, totalSize: total };
}

// ─── Whitelist ─────────────────────────────────────────────────────

function whitelistList() {
  const m = loadManifest();
  return { ok: true, paths: m.whitelist || [] };
}

function whitelistAdd(p) {
  const norm = path.resolve(p);
  const m = loadManifest();
  m.whitelist = m.whitelist || [];
  if (!m.whitelist.includes(norm)) {
    m.whitelist.push(norm);
    saveManifest(m);
  }
  return { ok: true, path: norm };
}

function whitelistRemove(p) {
  const norm = path.resolve(p);
  const m = loadManifest();
  m.whitelist = (m.whitelist || []).filter(x => x !== norm);
  saveManifest(m);
  return { ok: true, path: norm };
}

// Used by scanners — checks if the given absolute path matches a whitelist
// entry exactly OR is contained within a whitelisted directory.
function isWhitelisted(absPath) {
  const norm = path.resolve(absPath).toLowerCase();
  const m    = loadManifest();
  for (const entry of (m.whitelist || [])) {
    const e = entry.toLowerCase();
    if (norm === e) return true;
    if (norm.startsWith(e + path.sep.toLowerCase()) || norm.startsWith(e + "/")) return true;
  }
  return false;
}

module.exports = {
  quarantineOne,
  quarantineMany,
  restoreOne,
  deleteOne,
  list,
  whitelistList,
  whitelistAdd,
  whitelistRemove,
  isWhitelisted,
  isQuarantineSafe,
  ROOT_DIR,
  QUARANTINE_DIR,
  MANIFEST_PATH
};
