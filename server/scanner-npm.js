// Real npm package scanner.
// Accepts a local path containing a package.json. Checks:
//   - install hooks (preinstall/install/postinstall)  -> MEDIUM each
//   - source patterns (PATTERNS, restricted to JS/TS) -> HIGH/MEDIUM/LOW
//   - native binary modules (.node files)             -> LOW
//   - typosquatting against a small built-in list     -> MEDIUM
// Then computes verdict + structured findings + stats.

const fs   = require("fs");
const path = require("path");
const { walk, lineOf } = require("./walker");
const { PATTERNS, EXTS } = require("./patterns");
const { computeVerdict, snippet } = require("./scanner-folder");

const MAX_BYTES_PER_FILE = 200_000;
const MAX_FINDINGS       = 200;

// Top packages — typosquatting check uses Levenshtein distance 1.
const TOP_PACKAGES = [
  "react", "lodash", "express", "axios", "moment", "chalk", "commander",
  "request", "debug", "underscore", "mongoose", "jquery", "webpack", "babel-core",
  "typescript", "vue", "angular", "next", "vite", "tailwindcss", "left-pad",
  "node-fetch", "yargs", "cheerio", "uuid", "rxjs", "tslib", "ws", "redis",
  "puppeteer", "electron"
];

async function scanNpm(target) {
  const start = Date.now();
  if (!target) return error("missing_target");

  const abs = path.resolve(target);
  if (!fs.existsSync(abs)) return error("path_not_found", { target: abs });

  const stat = fs.statSync(abs);
  if (!stat.isDirectory()) return error("not_a_directory", { target: abs });

  const pkgPath = path.join(abs, "package.json");
  if (!fs.existsSync(pkgPath)) return error("no_package_json", { target: abs });

  let pkg;
  try { pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")); }
  catch (e) { return error("package_json_invalid", { detail: e.message }); }

  const findings = [];

  // 1. Install hooks
  const HOOKS = ["preinstall", "install", "postinstall", "preuninstall", "postuninstall"];
  if (pkg.scripts) {
    for (const h of HOOKS) {
      if (pkg.scripts[h]) {
        const sev = /node\s+-e|curl|wget|powershell|base64|\beval\b/.test(pkg.scripts[h]) ? "HIGH" : "MEDIUM";
        findings.push({
          severity: sev,
          category: "install_hook",
          file:     "package.json",
          line:     1,
          match:    snippet(pkg.scripts[h]),
          message:  `Install hook '${h}' runs at install time`
        });
      }
    }
  }

  // 2. Typosquatting heuristic (dist 1 from a top package, but not equal)
  if (pkg.name) {
    const lower = pkg.name.toLowerCase();
    const close = TOP_PACKAGES.find(p => p !== lower && levenshtein(lower, p) === 1);
    if (close) {
      findings.push({
        severity: "MEDIUM",
        category: "typosquatting",
        file:     "package.json",
        line:     1,
        match:    pkg.name,
        message:  `Name is one character off from top package '${close}' (typosquat candidate)`
      });
    }
  }

  // 3. Source pattern audit (limited extensions for npm context)
  const files = walk(abs, EXTS.npm).filter(f => !f.endsWith(".json"));

  outer: for (const file of files) {
    let content;
    try { content = fs.readFileSync(file, "utf8").slice(0, MAX_BYTES_PER_FILE); }
    catch { continue; }

    for (const [category, items] of Object.entries(PATTERNS)) {
      for (const { regex, severity, message } of items) {
        regex.lastIndex = 0;
        let m;
        while ((m = regex.exec(content)) !== null) {
          findings.push({
            severity,
            category,
            file: path.relative(abs, file).replace(/\\/g, "/"),
            line: lineOf(content, m.index),
            match: snippet(m[0]),
            message
          });
          if (findings.length >= MAX_FINDINGS) break outer;
        }
      }
    }
  }

  // 4. Native binary modules
  const natives = walk(abs, [".node"]);
  for (const f of natives.slice(0, 10)) {
    findings.push({
      severity: "LOW",
      category: "native_binary",
      file:     path.relative(abs, f).replace(/\\/g, "/"),
      line:     0,
      match:    path.basename(f),
      message:  "Native binary module — runs arbitrary compiled code"
    });
  }

  const elapsed = Date.now() - start;
  const verdict = computeVerdict(findings);

  return {
    ok:       true,
    verdict:  verdict.label,
    exitCode: verdict.exit,
    target:   abs,
    package:  { name: pkg.name, version: pkg.version, license: pkg.license },
    findings,
    stats: {
      filesScanned:  files.length,
      findingsCount: findings.length,
      elapsedMs:     elapsed
    }
  };
}

// Levenshtein distance (small strings, tolerate the O(mn) cost).
function levenshtein(a, b) {
  if (a === b) return 0;
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  const prev = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    let prevDiag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = prev[j];
      prev[j] = a[i-1] === b[j-1]
        ? prevDiag
        : 1 + Math.min(prevDiag, prev[j], prev[j-1]);
      prevDiag = tmp;
    }
  }
  return prev[n];
}

function error(code, extra = {}) {
  return { ok: false, error: code, ...extra };
}

module.exports = { scanNpm };
