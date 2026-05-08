// Real folder scanner — applies the 7 threat-category patterns to source files.

const fs   = require("fs");
const path = require("path");
const { walk, lineOf } = require("./walker");
const { PATTERNS, EXTS } = require("./patterns");

const MAX_BYTES_PER_FILE = 200_000;
const MAX_FINDINGS       = 200;

async function scanFolder(target) {
  const start = Date.now();
  if (!target) return error("missing_target");

  const abs = path.resolve(target);
  let stat;
  try { stat = fs.statSync(abs); }
  catch { return error("path_not_found", { target: abs }); }
  if (!stat.isDirectory() && !stat.isFile()) return error("not_dir_or_file", { target: abs });

  const exts  = EXTS.folder;
  const files = walk(abs, exts);

  const findings = [];
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
            file: path.relative(abs, file).replace(/\\/g, "/") || path.basename(file),
            line: lineOf(content, m.index),
            match: snippet(m[0]),
            message
          });
          if (findings.length >= MAX_FINDINGS) break outer;
        }
      }
    }
  }

  const elapsed = Date.now() - start;
  const verdict = computeVerdict(findings);

  return {
    ok:      true,
    verdict: verdict.label,
    exitCode: verdict.exit,
    target:  abs,
    findings,
    stats: {
      filesScanned: files.length,
      findingsCount: findings.length,
      elapsedMs: elapsed
    }
  };
}

function snippet(s) {
  return s.replace(/\s+/g, " ").trim().slice(0, 100);
}

function computeVerdict(findings) {
  const high = findings.filter(f => f.severity === "HIGH").length;
  const med  = findings.filter(f => f.severity === "MEDIUM").length;
  if (high > 0) return { label: "SUSPICIOUS", exit: 1 };
  if (med  > 0) return { label: "CAUTION",    exit: 0 };
  return         { label: "CLEAN",       exit: 0 };
}

function error(code, extra = {}) {
  return { ok: false, error: code, ...extra };
}

module.exports = { scanFolder, computeVerdict, snippet };
