// SentivoGuard — Windows OS tool integrations.
// All five tools (Defend, DNS, Drivers, Wall, Block) are read-only here.
// Mutations (changing DNS, adding firewall rules, editing hosts) require admin
// and aren't safe to expose over a public HTTP endpoint without careful auth —
// the desktop app handles those locally; the website only displays state.

const { spawn } = require("child_process");
const fs        = require("fs");
const path      = require("path");
const os        = require("os");

const PS_TIMEOUT_MS = 8_000;

function powershell(script, timeoutMs = PS_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const ps = spawn("powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script],
      { windowsHide: true });
    let stdout = "", stderr = "";
    const timer = setTimeout(() => { try { ps.kill(); } catch {}; reject(new Error("timeout")); }, timeoutMs);
    ps.stdout.on("data", (d) => stdout += d.toString());
    ps.stderr.on("data", (d) => stderr += d.toString());
    ps.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) reject(new Error(stderr.trim() || ("exit " + code)));
      else            resolve(stdout);
    });
    ps.on("error", (e) => { clearTimeout(timer); reject(e); });
  });
}

function platformOk() {
  return os.platform() === "win32";
}

// ──────────────────────────────────────────────────────────────────
// SentivoDefend — Windows Defender real-time status
// ──────────────────────────────────────────────────────────────────
async function defendStatus() {
  if (!platformOk()) return { ok: false, error: "platform_unsupported", platform: os.platform() };

  const script = `
    try {
      $s  = Get-MpComputerStatus -ErrorAction Stop
      $p  = Get-MpPreference     -ErrorAction Stop
      [pscustomobject]@{
        AntivirusEnabled            = $s.AntivirusEnabled
        AMServiceEnabled            = $s.AMServiceEnabled
        AntispywareEnabled          = $s.AntispywareEnabled
        BehaviorMonitorEnabled      = $s.BehaviorMonitorEnabled
        IoavProtectionEnabled       = $s.IoavProtectionEnabled
        NISEnabled                  = $s.NISEnabled
        OnAccessProtectionEnabled   = $s.OnAccessProtectionEnabled
        RealTimeProtectionEnabled   = $s.RealTimeProtectionEnabled
        AntivirusSignatureVersion   = $s.AntivirusSignatureVersion
        AntivirusSignatureLastUpdated = "$($s.AntivirusSignatureLastUpdated)"
        QuickScanEndTime            = "$($s.QuickScanEndTime)"
        FullScanEndTime             = "$($s.FullScanEndTime)"
        ExclusionPaths              = if ($p.ExclusionPath) { @($p.ExclusionPath) } else { @() }
        ExclusionExtensions         = if ($p.ExclusionExtension) { @($p.ExclusionExtension) } else { @() }
        ExclusionProcesses          = if ($p.ExclusionProcess) { @($p.ExclusionProcess) } else { @() }
      } | ConvertTo-Json -Depth 4
    } catch {
      Write-Error $_.Exception.Message
      exit 1
    }
  `;
  try {
    const out = await powershell(script);
    const data = JSON.parse(out);
    return { ok: true, source: "powershell", ...data };
  } catch (e) {
    return { ok: false, error: "powershell_failed", detail: (e.message || "").slice(0, 400) };
  }
}

// ──────────────────────────────────────────────────────────────────
// SentivoDNS — current DNS resolvers + DoH latency probe
// ──────────────────────────────────────────────────────────────────
async function dnsStatus() {
  if (!platformOk()) return { ok: false, error: "platform_unsupported", platform: os.platform() };

  const script = `
    try {
      $rows = Get-DnsClientServerAddress -AddressFamily IPv4 -ErrorAction Stop |
        Where-Object { $_.ServerAddresses -and ($_.InterfaceAlias -notlike '*Loopback*') -and ($_.InterfaceAlias -notlike '*Pseudo*') } |
        ForEach-Object {
          [pscustomobject]@{
            interface = $_.InterfaceAlias
            servers   = @($_.ServerAddresses)
          }
        }
      $rows | ConvertTo-Json -Depth 3 -Compress
    } catch {
      Write-Error $_.Exception.Message
      exit 1
    }
  `;
  let interfaces = [];
  try {
    const out = (await powershell(script)).trim();
    if (out) {
      const parsed = JSON.parse(out);
      interfaces = Array.isArray(parsed) ? parsed : [parsed];
    }
  } catch (e) {
    return { ok: false, error: "dns_query_failed", detail: e.message };
  }

  // DoH latency probes — measure from the SERVER, not the user's browser
  const dohEndpoints = [
    { name: "Cloudflare 1.1.1.1", url: "https://cloudflare-dns.com/dns-query?name=example.com&type=A" },
    { name: "Google 8.8.8.8",     url: "https://dns.google/resolve?name=example.com&type=A" },
    { name: "Quad9 9.9.9.9",      url: "https://dns.quad9.net:5053/dns-query?name=example.com&type=A" }
  ];
  const probes = await Promise.all(dohEndpoints.map(async ep => {
    const t0 = Date.now();
    try {
      const r = await fetch(ep.url, {
        headers: { "accept": "application/dns-json" },
        signal: AbortSignal.timeout(3000)
      });
      const ok = r.ok;
      return { name: ep.name, latencyMs: Date.now() - t0, ok };
    } catch (e) {
      return { name: ep.name, latencyMs: -1, ok: false, error: "timeout" };
    }
  }));

  return { ok: true, interfaces, dohProbes: probes };
}

// ──────────────────────────────────────────────────────────────────
// SentivoDrivers — installed drivers + signing status
// ──────────────────────────────────────────────────────────────────
async function driversList(limit = 100) {
  if (!platformOk()) return { ok: false, error: "platform_unsupported", platform: os.platform() };

  const script = `
    try {
      $drivers = Get-CimInstance -ClassName Win32_PnPSignedDriver -ErrorAction Stop |
        Where-Object { $_.DeviceName } |
        Select-Object DeviceName, DriverVersion, DriverDate, IsSigned, Manufacturer, DeviceClass |
        Sort-Object DeviceName
      [pscustomobject]@{
        total    = $drivers.Count
        unsigned = ($drivers | Where-Object { $_.IsSigned -eq $false }).Count
        items    = @($drivers | Select-Object -First ${limit})
      } | ConvertTo-Json -Depth 3 -Compress
    } catch {
      Write-Error $_.Exception.Message
      exit 1
    }
  `;
  try {
    const out  = await powershell(script, 12_000);
    const data = JSON.parse(out);
    return { ok: true, source: "powershell", ...data };
  } catch (e) {
    return { ok: false, error: "drivers_query_failed", detail: e.message };
  }
}

// ──────────────────────────────────────────────────────────────────
// SentivoWall — firewall rules summary
// ──────────────────────────────────────────────────────────────────
async function firewallStatus() {
  if (!platformOk()) return { ok: false, error: "platform_unsupported", platform: os.platform() };

  const script = `
    try {
      $profiles = Get-NetFirewallProfile -ErrorAction Stop |
        Select-Object Name, Enabled, DefaultInboundAction, DefaultOutboundAction, NotifyOnListen
      $rules = Get-NetFirewallRule -Enabled True -ErrorAction Stop
      $inbound  = ($rules | Where-Object { $_.Direction -eq 'Inbound' }).Count
      $outbound = ($rules | Where-Object { $_.Direction -eq 'Outbound' }).Count
      $blockers = ($rules | Where-Object { $_.Action -eq 'Block' }).Count

      [pscustomobject]@{
        profiles      = @($profiles)
        rulesEnabled  = $rules.Count
        inboundRules  = $inbound
        outboundRules = $outbound
        blockingRules = $blockers
      } | ConvertTo-Json -Depth 4 -Compress
    } catch {
      Write-Error $_.Exception.Message
      exit 1
    }
  `;
  try {
    const out  = await powershell(script);
    const data = JSON.parse(out);
    return { ok: true, source: "powershell", ...data };
  } catch (e) {
    return { ok: false, error: "firewall_query_failed", detail: e.message };
  }
}

// ──────────────────────────────────────────────────────────────────
// SentivoBlock — hosts file enumeration
// ──────────────────────────────────────────────────────────────────
function hostsStatus() {
  const hostsPath = path.join(process.env.SystemRoot || "C:\\Windows",
                              "System32", "drivers", "etc", "hosts");
  let raw;
  try { raw = fs.readFileSync(hostsPath, "utf8"); }
  catch (e) { return { ok: false, error: "hosts_read_failed", detail: e.message }; }

  const lines    = raw.split(/\r?\n/);
  const total    = lines.length;
  let blocked    = 0;
  let active     = 0;
  let comments   = 0;
  const samples  = [];
  const reBlock  = /^\s*(?:0\.0\.0\.0|127\.0\.0\.1|::)\s+(\S+)/;
  const reActive = /^\s*\S+\s+\S+/;

  for (const ln of lines) {
    if (/^\s*#/.test(ln) || /^\s*$/.test(ln)) { comments++; continue; }
    if (reBlock.test(ln)) {
      blocked++;
      if (samples.length < 20) {
        const m = ln.match(reBlock);
        if (m) samples.push(m[1]);
      }
    } else if (reActive.test(ln)) {
      active++;
    }
  }

  return {
    ok:           true,
    path:         hostsPath,
    sizeBytes:    Buffer.byteLength(raw),
    totalLines:   total,
    activeMappings: active + blocked,
    blockedHosts: blocked,
    comments,
    samples
  };
}

module.exports = {
  defendStatus, dnsStatus, driversList, firewallStatus, hostsStatus
};
