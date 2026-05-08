// Real Ruby gem scanner — walks .rb files and applies Ruby-specific
// patterns (Marshal.load, eval, system, backticks, ENV theft, HTTP outbound)
// on top of the base credential-theft / network-exfil / persistence rules.

const fs   = require("fs");
const path = require("path");
const { walk, lineOf } = require("./walker");
const { PATTERNS, RUBY_PATTERNS, EXTS } = require("./patterns");
const { computeVerdict, snippet } = require("./scanner-folder");

const MAX_BYTES_PER_FILE = 200_000;
const MAX_FINDINGS       = 200;

async function scanGem(target) {
  const start = Date.now();
  if (!target) return error("missing_target");

  const abs = path.resolve(target);
  if (!fs.existsSync(abs)) return error("path_not_found", { target: abs });

  const stat = fs.statSync(abs);
  if (!stat.isDirectory()) return error("not_a_directory", { target: abs });

  const meta = readGemspec(abs);
  const findings = [];

  // gemspec executes during `gem build` — flag any code in there
  const gemspecs = walk(abs, [".gemspec"]).slice(0, 2);
  for (const gs of gemspecs) {
    let content;
    try { content = fs.readFileSync(gs, "utf8").slice(0, MAX_BYTES_PER_FILE); }
    catch { continue; }
    for (const { regex, severity, message } of (RUBY_PATTERNS.rb_exec || [])) {
      regex.lastIndex = 0;
      let m;
      while ((m = regex.exec(content)) !== null) {
        findings.push({
          severity,
          category: "gemspec_exec",
          file:     path.relative(abs, gs).replace(/\\/g, "/"),
          line:     lineOf(content, m.index),
          match:    snippet(m[0]),
          message
        });
        if (findings.length >= MAX_FINDINGS) break;
      }
    }
  }

  const files = walk(abs, EXTS.gem);

  outer: for (const file of files) {
    let content;
    try { content = fs.readFileSync(file, "utf8").slice(0, MAX_BYTES_PER_FILE); }
    catch { continue; }

    const allCats = [
      ...Object.entries(PATTERNS),
      ...Object.entries(RUBY_PATTERNS)
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

  const verdict = computeVerdict(findings);
  return {
    ok:       true,
    verdict:  verdict.label,
    exitCode: verdict.exit,
    target:   abs,
    gem:      meta,
    findings,
    stats: {
      filesScanned:  files.length,
      findingsCount: findings.length,
      elapsedMs:     Date.now() - start
    }
  };
}

function readGemspec(dir) {
  const out = {};
  const gemspecs = walk(dir, [".gemspec"]).slice(0, 1);
  if (!gemspecs.length) return out;
  try {
    const t = fs.readFileSync(gemspecs[0], "utf8");
    const name    = t.match(/\.name\s*=\s*["']([^"']+)/);
    const version = t.match(/\.version\s*=\s*["']([^"']+)/);
    if (name)    out.name    = name[1];
    if (version) out.version = version[1];
  } catch {}
  return out;
}

function error(code, extra = {}) { return { ok: false, error: code, ...extra }; }

module.exports = { scanGem };
