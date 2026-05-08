// Browser extension scanner (CRX v2/v3 + XPI).
// Both formats are ZIP archives with optional preamble. We:
//   1. Skip the CRX header if present
//   2. Read manifest.json from the central directory
//   3. Audit permissions, content_security_policy, and host_permissions
//   4. Scan inline JS files for keylogger / cookie-exfil patterns
//
// Pure Node (no external zip lib) — uses zlib INFLATE on raw stored entries
// and DEFLATE-compressed entries.

const fs   = require("fs");
const path = require("path");
const zlib = require("zlib");
const { PATTERNS, EXTENSION_PATTERNS } = require("./patterns");
const { computeVerdict, snippet }      = require("./scanner-folder");
const { lineOf }                       = require("./walker");

// ── Permission risk levels ──
const PERMISSION_RISK = {
  // High — full read of sensitive surfaces
  "<all_urls>":       { severity: "HIGH",   message: "Access to every site you visit" },
  "tabs":             { severity: "MEDIUM", message: "Read tab metadata across sites" },
  "cookies":          { severity: "HIGH",   message: "Read & set cookies across allowed sites" },
  "history":          { severity: "HIGH",   message: "Read & modify your browsing history" },
  "bookmarks":        { severity: "MEDIUM", message: "Read & modify bookmarks" },
  "downloads":        { severity: "MEDIUM", message: "Manage downloads" },
  "webRequest":       { severity: "MEDIUM", message: "Observe network requests" },
  "webRequestBlocking":{severity: "HIGH",   message: "Block / modify network requests" },
  "debugger":         { severity: "HIGH",   message: "Attach the debugger to any tab" },
  "nativeMessaging":  { severity: "HIGH",   message: "Communicate with native binaries" },
  "proxy":            { severity: "HIGH",   message: "Configure browser proxy settings" },
  "management":       { severity: "MEDIUM", message: "Manage other extensions" },
  "browsingData":     { severity: "MEDIUM", message: "Read / clear browsing data" },
  "privacy":          { severity: "MEDIUM", message: "Modify privacy settings" }
};

const MAX_FINDINGS = 200;

async function scanExtension(target) {
  const start = Date.now();
  if (!target) return error("missing_target");

  const abs = path.resolve(target);
  if (!fs.existsSync(abs))                return error("path_not_found", { target: abs });
  if (!fs.statSync(abs).isFile())          return error("not_a_file",     { target: abs });
  if (!/\.(crx|xpi|zip)$/i.test(abs))     return error("unsupported_format",
    { hint: "Pass a .crx (Chrome) or .xpi (Firefox) file." });

  const raw = fs.readFileSync(abs);
  const zip = stripCrxHeader(raw);

  let entries;
  try { entries = readZipCentralDirectory(zip); }
  catch (e) { return error("zip_parse_failed", { detail: e.message }); }

  const findings = [];

  // ── 1. manifest.json audit ──
  const manifestEntry = entries.find(e =>
    e.name.toLowerCase() === "manifest.json" || e.name.toLowerCase().endsWith("/manifest.json")
  );
  if (!manifestEntry) {
    return error("no_manifest_json");
  }

  let manifest;
  try {
    const buf  = await readEntry(zip, manifestEntry);
    manifest   = JSON.parse(buf.toString("utf8"));
  } catch (e) {
    return error("manifest_parse_failed", { detail: e.message });
  }

  // Permissions
  const perms = [].concat(manifest.permissions || [], manifest.host_permissions || []);
  for (const p of perms) {
    const risk = PERMISSION_RISK[p];
    if (risk) {
      findings.push({
        severity: risk.severity,
        category: "permission",
        file:     "manifest.json",
        line:     0,
        match:    p,
        message:  risk.message
      });
    } else if (typeof p === "string" && /^https?:\/\/.*\*/.test(p)) {
      findings.push({
        severity: "MEDIUM",
        category: "host_wildcard",
        file:     "manifest.json",
        line:     0,
        match:    p,
        message:  "Wildcard host permission — broad site access"
      });
    }
  }

  // CSP weakness (manifest v2) or default (v3)
  const csp = manifest.content_security_policy;
  const cspString = typeof csp === "string" ? csp : (csp && csp.extension_pages) || "";
  if (cspString && /unsafe-eval/.test(cspString)) {
    findings.push({
      severity: "MEDIUM",
      category: "csp_weakness",
      file:     "manifest.json",
      match:    "unsafe-eval",
      message:  "CSP allows unsafe-eval"
    });
  }
  if (cspString && /unsafe-inline/.test(cspString)) {
    findings.push({
      severity: "MEDIUM",
      category: "csp_weakness",
      file:     "manifest.json",
      match:    "unsafe-inline",
      message:  "CSP allows unsafe-inline"
    });
  }

  // ── 2. Scan inline JS files ──
  const jsEntries = entries.filter(e => /\.(js|mjs)$/i.test(e.name));
  let scanned = 0;

  outer: for (const e of jsEntries.slice(0, 50)) {
    let content;
    try { content = (await readEntry(zip, e)).toString("utf8").slice(0, 200_000); }
    catch { continue; }
    scanned++;

    // Combine base patterns with extension-specific keylogger heuristics
    const allCats = [
      ...Object.entries(PATTERNS),
      ...Object.entries(EXTENSION_PATTERNS)
    ];
    for (const [category, items] of allCats) {
      for (const { regex, severity, message } of items) {
        regex.lastIndex = 0;
        let m;
        let hits = 0;
        while ((m = regex.exec(content)) !== null && hits < 3) {
          findings.push({
            severity,
            category,
            file:    e.name,
            line:    lineOf(content, m.index),
            match:   snippet(m[0]),
            message
          });
          hits++;
          if (findings.length >= MAX_FINDINGS) break outer;
        }
      }
    }
  }

  const verdict = computeVerdict(findings);
  return {
    ok:       true,
    verdict:  verdict.label,
    exitCode: verdict.exit,
    target:   abs,
    extension: {
      name:           manifest.name,
      version:        manifest.version,
      manifest_version: manifest.manifest_version,
      permissions:    perms,
      jsFiles:        scanned
    },
    findings,
    stats: {
      filesScanned:  scanned,
      findingsCount: findings.length,
      elapsedMs:     Date.now() - start
    }
  };
}

// ── ZIP central-directory reader (just enough for our needs) ──

function stripCrxHeader(buf) {
  // CRX v2: "Cr24" + version(2) + pubkeyLen(4) + sigLen(4) + ...
  // CRX v3: "Cr24" + version(2) + headerLen(4) + ...
  if (buf.length < 16 || buf[0] !== 0x43 || buf[1] !== 0x72 || buf[2] !== 0x32 || buf[3] !== 0x34) {
    return buf; // not CRX, assume plain ZIP/XPI
  }
  const ver = buf.readUInt32LE(4);
  if (ver === 2) {
    const pub = buf.readUInt32LE(8);
    const sig = buf.readUInt32LE(12);
    return buf.slice(16 + pub + sig);
  }
  if (ver === 3) {
    const hdrLen = buf.readUInt32LE(8);
    return buf.slice(12 + hdrLen);
  }
  return buf;
}

function readZipCentralDirectory(buf) {
  // EOCD signature 0x06054b50 — search backwards
  const EOCD = 0x06054b50;
  let eocdOffset = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === EOCD) { eocdOffset = i; break; }
  }
  if (eocdOffset < 0) throw new Error("eocd_not_found");
  const cdEntries  = buf.readUInt16LE(eocdOffset + 10);
  const cdSize     = buf.readUInt32LE(eocdOffset + 12);
  const cdOffset   = buf.readUInt32LE(eocdOffset + 16);

  const entries = [];
  let p = cdOffset;
  for (let i = 0; i < cdEntries; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error("bad_cd_signature");
    const compMethod    = buf.readUInt16LE(p + 10);
    const compSize      = buf.readUInt32LE(p + 20);
    const uncompSize    = buf.readUInt32LE(p + 24);
    const nameLen       = buf.readUInt16LE(p + 28);
    const extraLen      = buf.readUInt16LE(p + 30);
    const commentLen    = buf.readUInt16LE(p + 32);
    const localOffset   = buf.readUInt32LE(p + 42);
    const name          = buf.slice(p + 46, p + 46 + nameLen).toString("utf8");
    entries.push({ name, compMethod, compSize, uncompSize, localOffset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

function readEntry(buf, entry) {
  return new Promise((resolve, reject) => {
    if (buf.readUInt32LE(entry.localOffset) !== 0x04034b50) {
      return reject(new Error("bad_local_header"));
    }
    const nameLen   = buf.readUInt16LE(entry.localOffset + 26);
    const extraLen  = buf.readUInt16LE(entry.localOffset + 28);
    const dataStart = entry.localOffset + 30 + nameLen + extraLen;
    const data = buf.slice(dataStart, dataStart + entry.compSize);

    if (entry.compMethod === 0) return resolve(data);            // stored
    if (entry.compMethod === 8) {                                 // deflate
      return zlib.inflateRaw(data, (err, out) => err ? reject(err) : resolve(out));
    }
    return reject(new Error("unsupported_compression_" + entry.compMethod));
  });
}

function error(code, extra = {}) { return { ok: false, error: code, ...extra }; }

module.exports = { scanExtension };
