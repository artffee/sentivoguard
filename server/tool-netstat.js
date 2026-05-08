// Real network monitor — Get-NetTCPConnection (Windows) joined with Get-Process,
// fallback to `netstat -ano` parse if PowerShell is unavailable.

const { spawn } = require("child_process");
const os        = require("os");

function powershell(script, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const ps = spawn("powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script],
      { windowsHide: true });
    let stdout = "", stderr = "";
    const timer = setTimeout(() => { try { ps.kill(); } catch {} ; reject(new Error("timeout")); }, timeoutMs);
    ps.stdout.on("data", d => stdout += d.toString());
    ps.stderr.on("data", d => stderr += d.toString());
    ps.on("close", code => {
      clearTimeout(timer);
      if (code !== 0) reject(new Error(stderr.trim() || ("exit " + code)));
      else resolve(stdout);
    });
    ps.on("error", e => { clearTimeout(timer); reject(e); });
  });
}

function netstat() {
  return new Promise((resolve, reject) => {
    const ns = spawn("netstat", ["-ano"], { windowsHide: true });
    let stdout = "";
    ns.stdout.on("data", d => stdout += d.toString());
    ns.on("close", () => resolve(stdout));
    ns.on("error", reject);
  });
}

async function getConnections() {
  if (os.platform() !== "win32") {
    return { ok: false, error: "platform_unsupported", platform: os.platform() };
  }

  // Preferred: PowerShell — gets process names too.
  try {
    const script = `
      $procs = @{}
      Get-Process | ForEach-Object { $procs[[int]$_.Id] = $_ }
      $rows = Get-NetTCPConnection -State Established -ErrorAction SilentlyContinue | ForEach-Object {
        $p = $procs[[int]$_.OwningProcess]
        [pscustomobject]@{
          local  = "$($_.LocalAddress):$($_.LocalPort)"
          remote = "$($_.RemoteAddress):$($_.RemotePort)"
          state  = "$($_.State)"
          pid    = $_.OwningProcess
          app    = if ($p) { $p.ProcessName } else { 'unknown' }
        }
      }
      $rows | ConvertTo-Json -Compress
    `;
    const out  = (await powershell(script)).trim();
    if (!out)      return { ok: true, connections: [], source: "powershell" };
    let parsed;
    try { parsed = JSON.parse(out); }
    catch { /* fallthrough */ }
    if (parsed) {
      if (!Array.isArray(parsed)) parsed = [parsed];
      return { ok: true, connections: parsed.map(normalise), source: "powershell" };
    }
  } catch (e) {
    // Fall through to netstat.
  }

  // Fallback: parse plain netstat output (no app names).
  try {
    const text = await netstat();
    const conns = parseNetstat(text);
    return { ok: true, connections: conns, source: "netstat" };
  } catch (e) {
    return { ok: false, error: "no_backend_available", detail: e.message };
  }
}

function normalise(row) {
  // PowerShell sometimes wraps IPv6 oddly; trim brackets and just present as-is.
  const [remoteHost, remotePort] = splitHostPort(row.remote);
  const [localHost,  localPort]  = splitHostPort(row.local);
  return {
    app:       row.app || "unknown",
    pid:       row.pid,
    state:     row.state,
    localHost,  localPort,
    remoteHost, remotePort,
    suspicious: looksSuspicious(remoteHost, remotePort, row.app)
  };
}

function splitHostPort(s) {
  const i = s.lastIndexOf(":");
  if (i < 0) return [s, null];
  return [s.slice(0, i), Number(s.slice(i + 1)) || null];
}

// Quick heuristic — high non-standard ports + non-system app + non-private IP.
function looksSuspicious(host, port, app) {
  if (!host) return false;
  if (host.startsWith("127.") || host.startsWith("::1") || host === "localhost") return false;
  if (host.startsWith("10.") || host.startsWith("192.168.") ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(host)) return false;
  // High port + outbound + non-standard app name = mildly suspicious.
  if (port > 1024 && port !== 443 && port !== 80 && port !== 8080 &&
      port !== 22 && port !== 53 && port !== 25 && port !== 465 && port !== 993 && port !== 995) {
    if (app && (app === "unknown" || /^(rundll32|svchost|regsvr32|mshta|wscript)$/i.test(app))) {
      return true;
    }
  }
  return false;
}

function parseNetstat(text) {
  const out = [];
  const lines = text.split(/\r?\n/);
  for (const ln of lines) {
    const t = ln.trim();
    if (!t.startsWith("TCP") && !t.startsWith("UDP")) continue;
    const parts = t.split(/\s+/);
    // TCP  local  remote  STATE  pid
    if (parts.length < 5) continue;
    const proto = parts[0];
    const [localHost, localPort]   = splitHostPort(parts[1]);
    const [remoteHost, remotePort] = splitHostPort(parts[2]);
    const state = proto === "TCP" ? parts[3] : "—";
    const pid   = Number(parts[parts.length - 1]) || 0;
    if (state && state !== "ESTABLISHED" && proto === "TCP") continue;
    out.push({
      app:       "unknown",
      pid,
      state,
      localHost,  localPort,
      remoteHost, remotePort,
      suspicious: looksSuspicious(remoteHost, remotePort, "unknown")
    });
  }
  return out;
}

module.exports = { getConnections };
