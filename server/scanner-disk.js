// Streaming disk scanner.
//   - Async generator yields three event types: "progress", "finding", "complete".
//   - Walks directories breadth-first using fs.promises (non-blocking).
//   - For text scripts: applies PATTERNS + SHELL_PATTERNS.
//   - For executables: applies SUSPICIOUS_NAMES + locationRisk heuristics.
//   - Yields to the event loop every 100 files so the server stays responsive.
//   - Caller can stop iteration any time (e.g. on client disconnect) — the
//     async generator simply isn't pulled again.

const fs   = require("fs");
const fsp  = require("fs").promises;
const path = require("path");
const os   = require("os");

const { PATTERNS, SHELL_PATTERNS, EXTS, SUSPICIOUS_NAMES, locationRisk } = require("./patterns");
const { computeVerdict, snippet } = require("./scanner-folder");
const { lineOf } = require("./walker");
const { isWhitelisted } = require("./quarantine");

const SKIP_DIR_NAMES = new Set([
  "node_modules", ".git", ".svn", ".hg",
  "venv", ".venv", "__pycache__",
  "dist", "build", "out", ".next",
  ".cache", ".gradle", ".m2", ".cargo", ".rustup",
  "$Recycle.Bin", "$RECYCLE.BIN", "System Volume Information",
  "Windows", "WinSxS", "DriverStore"   // skip OS internals on full-disk scans
]);

const MAX_BYTES_PER_FILE = 200_000;

// Build the standard preset of "risky" directories on Windows.
function quickScanPaths() {
  const home = os.homedir();
  const local = process.env.LOCALAPPDATA || path.join(home, "AppData", "Local");
  const roam  = process.env.APPDATA       || path.join(home, "AppData", "Roaming");
  const tmp   = os.tmpdir();
  const winRoot = process.env.SystemRoot || "C:\\Windows";

  return [
    path.join(home, "Downloads"),
    path.join(home, "Desktop"),
    path.join(home, "Documents"),
    tmp,
    path.join(local, "Temp"),
    path.join(winRoot, "Temp"),
    roam,
    path.join(home, "AppData", "Roaming", "Microsoft", "Windows", "Start Menu", "Programs", "Startup"),
    path.join(local, "Microsoft", "Windows", "Start Menu", "Programs", "Startup")
  ].filter(p => safeExists(p));
}

function safeExists(p) {
  try { fs.accessSync(p); return true; } catch { return false; }
}

function isTextExt(name)    { return EXTS.disk_text  .some(e => name.toLowerCase().endsWith(e)); }
function isBinaryExt(name)  { return EXTS.disk_binary.some(e => name.toLowerCase().endsWith(e)); }

// Apply ALL patterns (general + shell-specific) to text content.
function scanText(content, file, baseDir) {
  const out = [];
  const all = [
    ...Object.entries(PATTERNS),
    ...Object.entries(SHELL_PATTERNS)
  ];
  for (const [category, items] of all) {
    for (const { regex, severity, message } of items) {
      regex.lastIndex = 0;
      let m;
      let countForThisRule = 0;
      while ((m = regex.exec(content)) !== null && countForThisRule < 3) {
        out.push({
          severity,
          category,
          file:    rel(file, baseDir),
          line:    lineOf(content, m.index),
          match:   snippet(m[0]),
          message
        });
        countForThisRule++;
        if (out.length >= 50) return out;
      }
    }
  }
  return out;
}

function rel(f, base) {
  try {
    const r = path.relative(base, f);
    return r && !r.startsWith("..") ? r.replace(/\\/g, "/") : f.replace(/\\/g, "/");
  } catch { return f.replace(/\\/g, "/"); }
}

// Check the filename + location for a binary/script file. Cheap, no I/O.
function inspectFileMeta(file, baseDir, stats) {
  const out = [];
  const base = path.basename(file);

  for (const rule of SUSPICIOUS_NAMES) {
    if (rule.rx.test(base)) {
      out.push({
        severity: rule.severity,
        category: "suspicious_name",
        file:     rel(file, baseDir),
        line:     0,
        match:    base,
        message:  rule.message
      });
      break;
    }
  }

  const loc = locationRisk(file);
  if (loc) {
    out.push({
      severity: loc.severity,
      category: "suspicious_location",
      file:     rel(file, baseDir),
      line:     0,
      match:    base,
      message:  loc.message
    });
  }

  if (stats && stats.size > 0 && stats.size < 256 && /\.(exe|dll|scr)$/i.test(base)) {
    out.push({
      severity: "LOW",
      category: "anomalous_size",
      file:     rel(file, baseDir),
      line:     0,
      match:    `${stats.size} bytes`,
      message:  "Unusually small executable (often droppers / launchers)"
    });
  }

  return out;
}

/**
 * Async generator. Yields:
 *   { type: "start", roots, mode }
 *   { type: "progress", filesScanned, currentDir, findings, elapsed }
 *   { type: "finding", ...findingShape }
 *   { type: "complete", verdict, exitCode, stats }
 */
async function* scanDisk(opts = {}) {
  const start = Date.now();
  const { quick = false, target = null, maxFiles = 50_000 } = opts;
  const roots = quick
    ? quickScanPaths()
    : (target ? [path.resolve(target)] : quickScanPaths());

  const findings = [];
  let filesScanned = 0;
  let dirsScanned  = 0;

  yield { type: "start", roots, mode: quick ? "quick" : "custom", maxFiles, ts: start };

  // Track abort signal via a function on opts (so caller can flip it).
  const isAborted = () => !!opts.aborted;

  for (const root of roots) {
    if (isAborted()) break;

    const baseDir = root;
    yield { type: "progress", filesScanned, currentDir: root, findings: findings.length, elapsed: Date.now() - start, root: true };

    // BFS queue
    const queue = [[root, 0]];
    while (queue.length && !isAborted() && filesScanned < maxFiles) {
      const [dir, depth] = queue.shift();
      dirsScanned++;
      let entries;
      try { entries = await fsp.readdir(dir, { withFileTypes: true }); }
      catch { continue; }

      for (const e of entries) {
        if (isAborted() || filesScanned >= maxFiles) break;
        if (e.isSymbolicLink()) continue;
        if (SKIP_DIR_NAMES.has(e.name)) continue;
        const full = path.join(dir, e.name);

        if (e.isDirectory()) {
          if (depth < 8) queue.push([full, depth + 1]);
          continue;
        }
        if (!e.isFile()) continue;

        // Skip whitelisted paths (set by user via Quarantine view).
        if (isWhitelisted(full)) {
          continue;
        }

        filesScanned++;

        // Cheap stat for size-based heuristics
        let st;
        try { st = await fsp.stat(full); } catch { /* ignore */ }

        // Binary files: name + location heuristics only.
        if (isBinaryExt(e.name)) {
          const meta = inspectFileMeta(full, baseDir, st);
          for (const f of meta) {
            findings.push(f);
            yield { type: "finding", ...f };
          }
        } else if (isTextExt(e.name) && st && st.size > 0 && st.size < 5_000_000) {
          // Text scripts: read + pattern scan (skip if > 5 MB to avoid massive logs).
          let content;
          try { content = (await fsp.readFile(full, "utf8")).slice(0, MAX_BYTES_PER_FILE); }
          catch { continue; }
          const hits = scanText(content, full, baseDir);
          for (const f of hits) {
            findings.push(f);
            yield { type: "finding", ...f };
          }
          // Also run name/location for scripts.
          const meta = inspectFileMeta(full, baseDir, st);
          for (const f of meta) {
            findings.push(f);
            yield { type: "finding", ...f };
          }
        } else {
          // For everything else, at least check the filename heuristic.
          const meta = inspectFileMeta(full, baseDir, st);
          for (const f of meta) {
            findings.push(f);
            yield { type: "finding", ...f };
          }
        }

        // Yield progress every 100 files (and yield to event loop).
        if (filesScanned % 100 === 0) {
          yield { type: "progress",
                  filesScanned, currentDir: dir,
                  findings: findings.length,
                  elapsed: Date.now() - start };
          await new Promise(r => setImmediate(r));
        }
      }
    }
  }

  const verdict = computeVerdict(findings);
  yield {
    type: "complete",
    verdict: verdict.label,
    exitCode: verdict.exit,
    aborted: isAborted(),
    stats: {
      filesScanned,
      dirsScanned,
      findingsCount: findings.length,
      elapsedMs: Date.now() - start,
      roots
    }
  };
}

module.exports = { scanDisk, quickScanPaths };
