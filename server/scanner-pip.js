// Real pip/Python package scanner.
// Scans a directory containing setup.py / pyproject.toml / requirements.txt
// (and/or .py source files) for code-execution, pickle, marshal, yaml.load,
// shell exec, and outbound HTTP patterns. Uses Python-specific patterns on top
// of the base set.

const fs   = require("fs");
const path = require("path");
const { walk, lineOf } = require("./walker");
const { PATTERNS, PYTHON_PATTERNS, EXTS } = require("./patterns");
const { computeVerdict, snippet } = require("./scanner-folder");

const MAX_BYTES_PER_FILE = 200_000;
const MAX_FINDINGS       = 200;

async function scanPip(target) {
  const start = Date.now();
  if (!target) return error("missing_target");

  const abs = path.resolve(target);
  if (!fs.existsSync(abs)) return error("path_not_found", { target: abs });

  const stat = fs.statSync(abs);
  if (!stat.isDirectory()) return error("not_a_directory", { target: abs });

  // Optional: read package metadata
  const meta = readMetadata(abs);
  const findings = [];

  // 1. setup.py audit — most-dangerous-by-default location, runs at install
  const setupPy = path.join(abs, "setup.py");
  if (fs.existsSync(setupPy)) {
    let content;
    try { content = fs.readFileSync(setupPy, "utf8").slice(0, MAX_BYTES_PER_FILE); }
    catch { content = ""; }
    if (content) {
      // setup.py executes at `pip install` — extra-suspicious
      for (const cat of ["py_setup_exec", "py_exec"]) {
        for (const { regex, severity, message } of (PYTHON_PATTERNS[cat] || [])) {
          regex.lastIndex = 0;
          let m;
          while ((m = regex.exec(content)) !== null) {
            findings.push({
              severity,
              category: "setup_py_exec",
              file:     "setup.py",
              line:     lineOf(content, m.index),
              match:    snippet(m[0]),
              message
            });
            if (findings.length >= MAX_FINDINGS) break;
          }
          if (findings.length >= MAX_FINDINGS) break;
        }
      }
    }
  }

  // 2. Walk all .py files and apply both base + Python-specific patterns
  const files = walk(abs, EXTS.pip);

  outer: for (const file of files) {
    if (file === setupPy) continue; // already scanned
    let content;
    try { content = fs.readFileSync(file, "utf8").slice(0, MAX_BYTES_PER_FILE); }
    catch { continue; }

    const allCats = [
      ...Object.entries(PATTERNS),
      ...Object.entries(PYTHON_PATTERNS)
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
            file: path.relative(abs, file).replace(/\\/g, "/"),
            line: lineOf(content, m.index),
            match: snippet(m[0]),
            message
          });
          hits++;
          if (findings.length >= MAX_FINDINGS) break outer;
        }
      }
    }
  }

  // 3. Native binary extensions (.pyd / .so) — runs arbitrary compiled code
  const natives = walk(abs, [".pyd", ".so"]);
  for (const f of natives.slice(0, 10)) {
    findings.push({
      severity: "LOW",
      category: "native_extension",
      file:     path.relative(abs, f).replace(/\\/g, "/"),
      line:     0,
      match:    path.basename(f),
      message:  "Compiled Python extension — runs arbitrary native code"
    });
  }

  const verdict = computeVerdict(findings);
  return {
    ok:       true,
    verdict:  verdict.label,
    exitCode: verdict.exit,
    target:   abs,
    package:  meta,
    findings,
    stats: {
      filesScanned:  files.length,
      findingsCount: findings.length,
      elapsedMs:     Date.now() - start
    }
  };
}

function readMetadata(dir) {
  const out = {};
  // pyproject.toml (TOML — simple regex grab to avoid deps)
  const pyproj = path.join(dir, "pyproject.toml");
  if (fs.existsSync(pyproj)) {
    try {
      const t = fs.readFileSync(pyproj, "utf8");
      const name    = t.match(/^\s*name\s*=\s*["']([^"']+)/m);
      const version = t.match(/^\s*version\s*=\s*["']([^"']+)/m);
      if (name)    out.name    = name[1];
      if (version) out.version = version[1];
    } catch {}
  }
  // setup.py (best-effort regex)
  const setup = path.join(dir, "setup.py");
  if (!out.name && fs.existsSync(setup)) {
    try {
      const t = fs.readFileSync(setup, "utf8");
      const name    = t.match(/name\s*=\s*["']([^"']+)/);
      const version = t.match(/version\s*=\s*["']([^"']+)/);
      if (name)    out.name    = name[1];
      if (version) out.version = version[1];
    } catch {}
  }
  return out;
}

function error(code, extra = {}) { return { ok: false, error: code, ...extra }; }

module.exports = { scanPip };
