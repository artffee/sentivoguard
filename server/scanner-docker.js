// Real Docker image scanner.
//   Phase 1: `docker inspect <image>` — config audit (USER, ports, ENV secrets)
//   Phase 2: `docker history --no-trunc` — layer commands (curl|bash, chmod 777)
//   Skipped: layer tar extraction (slow + needs `docker save`).
// Requires Docker Engine running locally and accessible to the user.

const { spawn } = require("child_process");

const RUN_TIMEOUT_MS = 15_000;

async function scanDocker(target) {
  const start = Date.now();
  if (!target) return error("missing_target");

  if (!(await hasDocker())) {
    return error("docker_not_available",
      { hint: "Install Docker Desktop and ensure the daemon is running." });
  }

  // ── Phase 1: docker inspect ──
  let inspectJson;
  try {
    const out = await runCmd("docker", ["inspect", target]);
    const parsed = JSON.parse(out);
    inspectJson = Array.isArray(parsed) ? parsed[0] : parsed;
  } catch (e) {
    return error("inspect_failed", { detail: (e.message || "").slice(0, 400) });
  }

  if (!inspectJson || !inspectJson.Config) {
    return error("not_an_image", { hint: "Pass an image (not a container)." });
  }

  const config = inspectJson.Config || {};
  const findings = [];

  // USER 0 / root
  if (!config.User || config.User === "" || config.User === "0" || config.User === "root") {
    findings.push({
      severity: "MEDIUM",
      category: "container_user",
      file:     "image.config",
      match:    "USER " + (config.User || "root"),
      message:  "Container runs as root by default — least-privilege violation"
    });
  }

  // Exposed ports
  const exposed = Object.keys(config.ExposedPorts || {});
  for (const port of exposed) {
    if (/^(?:22|23|3389|445|3306|5432|6379|27017|11211)\//.test(port)) {
      findings.push({
        severity: "MEDIUM",
        category: "exposed_port",
        file:     "image.config",
        match:    port,
        message:  "Sensitive service port exposed by default (review)"
      });
    }
  }

  // ENV variables containing potentially sensitive names
  const envVars = config.Env || [];
  const SENSITIVE_ENV = /^[A-Z_]*(?:KEY|TOKEN|SECRET|PASSWORD|API|CREDENTIAL)[A-Z_]*=/;
  for (const v of envVars) {
    if (SENSITIVE_ENV.test(v)) {
      findings.push({
        severity: "HIGH",
        category: "env_secret",
        file:     "image.config",
        match:    v.split("=")[0] + "=***",
        message:  "Sensitive-looking ENV var baked into the image"
      });
    }
  }

  // ── Phase 2: docker history ──
  let history = [];
  try {
    const out = await runCmd("docker",
      ["history", "--no-trunc", "--format", "{{.CreatedBy}}", target]);
    history = out.split("\n").filter(Boolean);
  } catch (e) {
    // Non-fatal — continue with phase 1 findings only
  }

  const HISTORY_RULES = [
    { rx: /\bcurl[^\n]*\|\s*(?:bash|sh)\b/i, severity: "HIGH",
      message:  "Layer pipes curl output directly to shell" },
    { rx: /\bwget[^\n]*\|\s*(?:bash|sh)\b/i, severity: "HIGH",
      message:  "Layer pipes wget output directly to shell" },
    { rx: /\bchmod\s+777\b/i,                severity: "MEDIUM",
      message:  "chmod 777 — overly permissive" },
    { rx: /\b(?:apt-get|yum|apk)\s+install\b/i, severity: "LOW",
      message:  "Unpinned package install (consider pinning versions)" }
  ];

  for (let i = 0; i < history.length; i++) {
    const line = history[i];
    for (const r of HISTORY_RULES) {
      if (r.rx.test(line)) {
        findings.push({
          severity: r.severity,
          category: "layer_command",
          file:     "history.layer-" + i,
          match:    snippet(line),
          message:  r.message
        });
      }
    }
  }

  const verdict = computeVerdict(findings);

  return {
    ok:       true,
    verdict:  verdict.label,
    exitCode: verdict.exit,
    target,
    image: {
      id:         inspectJson.Id,
      created:    inspectJson.Created,
      size:       inspectJson.Size,
      architecture: inspectJson.Architecture,
      os:         inspectJson.Os,
      user:       config.User || "(root)",
      exposedPorts: exposed,
      envCount:   envVars.length,
      layerCount: history.length
    },
    findings,
    stats: {
      filesScanned:  history.length,
      findingsCount: findings.length,
      elapsedMs:     Date.now() - start
    }
  };
}

// ── helpers ──
async function hasDocker() {
  try { await runCmd("docker", ["--version"], 3000); return true; }
  catch { return false; }
}

function runCmd(cmd, args, timeoutMs = RUN_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { windowsHide: true });
    let stdout = "", stderr = "";
    const timer = setTimeout(() => { try { p.kill(); } catch {} ; reject(new Error("timeout")); }, timeoutMs);
    p.stdout.on("data", (d) => stdout += d.toString());
    p.stderr.on("data", (d) => stderr += d.toString());
    p.on("error", (e) => { clearTimeout(timer); reject(e); });
    p.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(stdout);
      else            reject(new Error(stderr.trim() || ("exit " + code)));
    });
  });
}

function snippet(s) {
  return String(s).replace(/\s+/g, " ").trim().slice(0, 100);
}

function computeVerdict(findings) {
  const high = findings.filter(f => f.severity === "HIGH").length;
  const med  = findings.filter(f => f.severity === "MEDIUM").length;
  if (high > 0) return { label: "SUSPICIOUS", exit: 1 };
  if (med  > 0) return { label: "CAUTION",    exit: 0 };
  return         { label: "CLEAN",       exit: 0 };
}

function error(code, extra = {}) { return { ok: false, error: code, ...extra }; }

module.exports = { scanDocker };
