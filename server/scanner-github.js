// Real GitHub repo scanner.
//   1. Validate the URL points at github.com.
//   2. Shallow-clone (--depth=1) into a randomly-named temp directory.
//   3. Run scanner-folder against the working copy.
//   4. Optionally check .github/workflows/*.yml for shell-injection patterns.
//   5. Cleanup. Return findings + stats.
//
// Requires: `git` in PATH. (No fancy GitHub API token — public repos only
// for this prototype. Private-repo scanning is a future feature.)

const fs    = require("fs");
const fsp   = require("fs").promises;
const os    = require("os");
const path  = require("path");
const crypto = require("crypto");
const { spawn } = require("child_process");
const { scanFolder, computeVerdict, snippet } = require("./scanner-folder");
const { walk, lineOf } = require("./walker");

const CLONE_TIMEOUT_MS = 60_000;
const MAX_REPO_SIZE_MB = 100;

async function scanGithub(target) {
  const start = Date.now();
  if (!target) return error("missing_target");

  // Accept https://github.com/user/repo or git@github.com:user/repo.git
  const m = String(target).trim().match(
    /^(?:https?:\/\/github\.com\/|git@github\.com:)([^\s\/]+)\/([^\s\/]+?)(?:\.git)?(?:\/.*)?$/
  );
  if (!m) return error("invalid_github_url", { target });

  const owner = m[1], repo = m[2];
  const cloneUrl = `https://github.com/${owner}/${repo}.git`;

  if (!(await hasGit())) {
    return error("git_not_available",
      { hint: "Install git (https://git-scm.com) and ensure it's in PATH." });
  }

  const dir = path.join(os.tmpdir(),
    "sg-gh-" + crypto.randomBytes(6).toString("hex"));

  let cloneStderr = "";
  try {
    cloneStderr = await runCmd("git",
      ["clone", "--depth=1", "--no-tags", cloneUrl, dir],
      CLONE_TIMEOUT_MS);
  } catch (e) {
    return error("clone_failed", { detail: e.message || cloneStderr.slice(0, 400) });
  }

  try {
    // Hard cap on repo size to avoid runaway scans.
    const sizeBytes = await dirBytes(dir);
    if (sizeBytes > MAX_REPO_SIZE_MB * 1024 * 1024) {
      return error("repo_too_large", { sizeMB: Math.round(sizeBytes / 1024 / 1024) });
    }

    // Folder scan covers content patterns
    const folderResult = await scanFolder(dir);

    // GitHub Actions workflow audit (separate from base patterns)
    const workflowFindings = scanWorkflows(dir);

    const findings = [...folderResult.findings, ...workflowFindings];
    const verdict  = computeVerdict(findings);

    return {
      ok:       true,
      verdict:  verdict.label,
      exitCode: verdict.exit,
      target:   `${owner}/${repo}`,
      repo:     { owner, repo, cloneUrl, sizeBytes },
      findings,
      stats: {
        filesScanned:  folderResult.stats?.filesScanned || 0,
        workflowFiles: workflowFindings.length > 0 ? "scanned" : "none",
        findingsCount: findings.length,
        elapsedMs:     Date.now() - start
      }
    };
  } finally {
    // Cleanup — best-effort
    try { await fsp.rm(dir, { recursive: true, force: true }); } catch {}
  }
}

// ── GitHub Actions workflow injection patterns ──
const WORKFLOW_RULES = [
  { rx: /\$\{\{\s*github\.event\.(issue|pull_request|comment|review|head_commit|head_ref|workflow_run)/g,
    severity: "HIGH",
    message:  "Untrusted github.event field used in script — injection risk" },
  { rx: /run:\s*\|[^]*\$\{\{\s*github\.event\.[\w.]+/g,
    severity: "HIGH",
    message:  "Multi-line run block interpolates github.event — injection risk" },
  { rx: /pull_request_target/g,
    severity: "MEDIUM",
    message:  "pull_request_target trigger (security-sensitive — read carefully)" }
];

function scanWorkflows(dir) {
  const wfDir = path.join(dir, ".github", "workflows");
  let entries = [];
  try { entries = fs.readdirSync(wfDir); } catch { return []; }

  const findings = [];
  for (const name of entries) {
    if (!/\.ya?ml$/.test(name)) continue;
    const file = path.join(wfDir, name);
    let content;
    try { content = fs.readFileSync(file, "utf8").slice(0, 200_000); }
    catch { continue; }

    for (const r of WORKFLOW_RULES) {
      r.rx.lastIndex = 0;
      let m;
      while ((m = r.rx.exec(content)) !== null) {
        findings.push({
          severity: r.severity,
          category: "ci_injection",
          file:     ".github/workflows/" + name,
          line:     lineOf(content, m.index),
          match:    snippet(m[0]),
          message:  r.message
        });
        if (findings.length > 30) break;
      }
    }
  }
  return findings;
}

// ── Helpers ──
async function hasGit() {
  try { await runCmd("git", ["--version"], 5000); return true; }
  catch { return false; }
}

function runCmd(cmd, args, timeoutMs) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { windowsHide: true });
    let stderr = "";
    const timer = setTimeout(() => { try { p.kill(); } catch {}; reject(new Error("timeout")); }, timeoutMs);
    p.stderr.on("data", (d) => stderr += d.toString());
    p.on("error", (e) => { clearTimeout(timer); reject(e); });
    p.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(stderr);
      else            reject(new Error(stderr.trim() || ("exit " + code)));
    });
  });
}

async function dirBytes(dir) {
  let bytes = 0;
  async function walk(d) {
    let entries;
    try { entries = await fsp.readdir(d, { withFileTypes: true }); }
    catch { return; }
    for (const e of entries) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) await walk(full);
      else if (e.isFile()) {
        try { bytes += (await fsp.stat(full)).size; } catch {}
      }
    }
  }
  await walk(dir);
  return bytes;
}

function error(code, extra = {}) { return { ok: false, error: code, ...extra }; }

module.exports = { scanGithub };
