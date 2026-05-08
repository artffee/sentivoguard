// Remaining tool views.
// Five of these (block, wall, defend, dns, drivers) now hit the real backend
// at /api/tool/<id> and replace the placeholder cells with live values.
// The other three (chat, transfer, hotspot) are flagged COMING SOON until the
// backend infrastructure for them exists.

// Helpers used by the real-fetch handlers below
function fmtBool(v)    { return v === true ? "On" : v === false ? "Off" : "—"; }
function fmtBytes(b) {
  if (b == null) return "—";
  if (b >= 1024 * 1024) return (b / 1024 / 1024).toFixed(2) + " MB";
  if (b >= 1024)        return (b / 1024).toFixed(0) + " KB";
  return b + " B";
}
function fmtDate(s) {
  if (!s || s === "—") return "—";
  const d = new Date(s);
  return isFinite(d) ? d.toLocaleDateString() : "—";
}

const placeholders = [
  { id: "block",    title: "SentivoBlock",    sub: "DNS-level ad and tracker blocker", icon: "⊘",
    real: true,
    body: [
      ["Hosts file", "—"],
      ["Active mappings", "—"],
      ["Blocked hosts", "—"],
      ["Sample blocks", "—"]
    ],
    realFetch: async () => {
      const r = await SG.backend.toolBlock();
      if (!r.ok) return null;
      return [
        ["Hosts file size",   fmtBytes(r.sizeBytes)],
        ["Active mappings",   String(r.activeMappings)],
        ["Blocked entries",   String(r.blockedHosts)],
        ["Sample blocks",     (r.samples || []).slice(0, 3).join(", ") || "(none)"]
      ];
    },
    desc: "Reads your real <span class='mono'>hosts</span> file and reports how many block-style mappings are " +
          "active. Editing the hosts file requires admin and is handled by the desktop app." },

  { id: "wall",     title: "SentivoWall",     sub: "Windows Firewall live status", icon: "▤",
    real: true,
    body: [
      ["Profiles", "—"],
      ["Enabled rules", "—"],
      ["Inbound rules", "—"],
      ["Blocking rules", "—"]
    ],
    realFetch: async () => {
      const r = await SG.backend.toolWall();
      if (!r.ok) return null;
      const enabledProfiles = (r.profiles || []).filter(p => p.Enabled).map(p => p.Name).join(", ");
      return [
        ["Enabled profiles", enabledProfiles || "(none)"],
        ["Active rules",     String(r.rulesEnabled || 0)],
        ["Inbound rules",    String(r.inboundRules || 0)],
        ["Blocking rules",   String(r.blockingRules || 0)]
      ];
    },
    desc: "Live read of your Windows Defender Firewall — counts of enabled rules, profiles, and how many of those " +
          "rules are explicit blocks. Rule editing happens locally in the desktop app." },

  { id: "defend",   title: "SentivoDefend",   sub: "Windows Defender real-time status", icon: "⌬",
    real: true,
    body: [
      ["Real-time protection", "—"],
      ["Definitions", "—"],
      ["Last quick scan", "—"],
      ["Exclusions", "—"]
    ],
    realFetch: async () => {
      const r = await SG.backend.toolDefend();
      if (!r.ok) return null;
      const exclusions = (r.ExclusionPaths || []).length +
                         (r.ExclusionExtensions || []).length +
                         (r.ExclusionProcesses || []).length;
      return [
        ["Real-time protection", fmtBool(r.RealTimeProtectionEnabled)],
        ["Antivirus definitions", r.AntivirusSignatureVersion || "—"],
        ["Last quick scan",      fmtDate(r.QuickScanEndTime)],
        ["Active exclusions",    String(exclusions)]
      ];
    },
    desc: "Live <span class='mono'>Get-MpComputerStatus</span> + <span class='mono'>Get-MpPreference</span> " +
          "from Windows Defender — real-time protection state, definition version, last scan time, exclusion count." },

  { id: "chat",     title: "SentivoChat",     sub: "End-to-end encrypted messaging (coming soon)", icon: "▭",
    comingSoon: true,
    body: [
      ["Encryption",      "NaCl / Curve25519"],
      ["Server stores",   "Ciphertext only"],
      ["Forward secrecy", "Per session"],
      ["Status",          "In development"]
    ],
    desc: "Zero-knowledge messaging between SentivoGuard users. Signal-Protocol-style ratcheting, per-message keys. " +
          "Backend infrastructure is in development — UI shown is the planned design." },

  { id: "transfer", title: "SentivoTransfer", sub: "Encrypted P2P file transfer (coming soon)", icon: "⇌",
    tier: "Ultimate",
    comingSoon: true,
    body: [
      ["Max file size",          "Unlimited"],
      ["Encryption",             "AES-256-GCM"],
      ["Files stored on server", "Never"],
      ["Status",                 "In development"]
    ],
    desc: "Encrypted peer-to-peer file transfer. One-time keys per transfer. Relay servers handle NAT traversal " +
          "but never decrypt. Backend infrastructure is in development." },

  { id: "dns",      title: "SentivoDNS",      sub: "Live DNS resolver + DoH latency probe", icon: "⌖",
    real: true,
    body: [
      ["Active resolvers", "—"],
      ["Cloudflare DoH",   "—"],
      ["Google DoH",       "—"],
      ["Quad9 DoH",        "—"]
    ],
    realFetch: async () => {
      const r = await SG.backend.toolDns();
      if (!r.ok) return null;
      const resolvers = (r.interfaces || [])
        .flatMap(i => i.servers || [])
        .filter((v, i, a) => a.indexOf(v) === i)
        .slice(0, 3)
        .join(", ") || "(none)";
      const probe = (name) => {
        const p = (r.dohProbes || []).find(x => x.name && x.name.startsWith(name));
        return p ? (p.ok ? p.latencyMs + " ms" : "unreachable") : "—";
      };
      return [
        ["Active DNS resolvers", resolvers],
        ["Cloudflare DoH",       probe("Cloudflare")],
        ["Google DoH",           probe("Google")],
        ["Quad9 DoH",            probe("Quad9")]
      ];
    },
    desc: "Live <span class='mono'>Get-DnsClientServerAddress</span> read of your active DNS resolvers, plus " +
          "real-time latency probes against Cloudflare 1.1.1.1, Google 8.8.8.8, and Quad9 9.9.9.9 over DoH." },

  { id: "hotspot",  title: "SentivoHotspot",  sub: "WiFi hotspot with VPN sharing (coming soon)", icon: "⌒",
    tier: "Ultimate",
    comingSoon: true,
    body: [
      ["Hotspot name",      "Sentivo-Guarded"],
      ["VPN inheritance",   "Planned"],
      ["Ad blocking",       "Inherited"],
      ["Status",            "In development"]
    ],
    desc: "Turns your PC into a protected WiFi access point. Phones, tablets, smart TVs inherit your VPN, " +
          "ad blocker, and DNS settings. Backend integration in development." },

  { id: "drivers",  title: "SentivoDrivers",  sub: "Live driver enumeration + signing audit", icon: "⚙",
    tier: "Ultimate",
    real: true,
    body: [
      ["Total drivers", "—"],
      ["Unsigned",      "—"],
      ["Signed",        "—"],
      ["Source",        "—"]
    ],
    realFetch: async () => {
      const r = await SG.backend.toolDrivers();
      if (!r.ok) return null;
      const total    = r.total || 0;
      const unsigned = r.unsigned || 0;
      return [
        ["Total drivers",  String(total)],
        ["Unsigned",       String(unsigned)],
        ["Signed",         String(total - unsigned)],
        ["Source",         "Win32_PnPSignedDriver"]
      ];
    },
    desc: "Live <span class='mono'>Get-CimInstance Win32_PnPSignedDriver</span> read — every installed driver, " +
          "version, manufacturer, and Authenticode signing status. Update detection arrives in a future release." }
];

placeholders.forEach(p => {
  SG.router.register(p.id, function (view) {
    const el = SG.el;

    // Status badge — REAL · LIVE if backend wired, COMING SOON if not yet,
    // ULTIMATE ONLY for tier-gated, otherwise nothing.
    const isReal = p.real && SG.backend && SG.backend.isReal();
    let statusTag = null;
    if (p.comingSoon)        statusTag = el("span", { class: "tag tag-warn" }, "COMING SOON");
    else if (isReal)         statusTag = el("span", { class: "tag tag-ok" },   "REAL · LIVE");
    else if (p.real)         statusTag = el("span", { class: "tag" },          "BACKEND OFFLINE");
    else if (p.tier === "Ultimate")
                              statusTag = el("span", { class: "tag tag-ult" }, "ULTIMATE ONLY");

    const cellNodes = p.body.map(([k, v]) =>
      el("div", { class: "card" },
        el("div", { class: "qs-card-label" }, k),
        el("div", {
          class: "qs-card-value",
          style: "font-size: 18px; margin-top: 4px;"
        }, v)
      )
    );

    view.append(
      el("div", { class: "card", style: "margin-bottom: 14px;" },
        el("div", { class: "between" },
          el("div", { class: "row" },
            el("div", {
              style: "font-size: 32px; color: var(--accent-3); margin-right: 14px;"
            }, p.icon),
            el("div", {},
              el("h3", { style: "margin:0; font-size: 18px;" }, p.title),
              el("div", { class: "muted", html: p.desc, style: "font-size: 13px; margin-top:2px;" })
            )
          ),
          el("div", { class: "row" },
            statusTag,
            el("button", {
              class: p.comingSoon ? "btn btn-ghost" : "btn btn-primary",
              disabled: p.comingSoon ? "disabled" : null
            }, p.comingSoon ? "Notify me" :
                p.tier === "Ultimate" ? "Upgrade to Ultimate" : "Configure")
          )
        )
      ),
      el("div", { class: "tool-grid-3", id: "tool-cells-" + p.id }, ...cellNodes)
    );

    // If this tool has a real backend fetcher, hit it after mount and replace
    // the cell values with live data. Errors fall back to the placeholder.
    if (isReal && typeof p.realFetch === "function") {
      (async () => {
        try {
          const live = await p.realFetch();
          if (!live || !Array.isArray(live)) return;
          const cells = document.querySelectorAll("#tool-cells-" + p.id + " .qs-card-value");
          live.forEach(([k, v], i) => {
            const labelEl = cells[i]?.previousElementSibling;
            if (labelEl) labelEl.textContent = k;
            if (cells[i]) cells[i].textContent = v;
          });
        } catch (e) {
          console.error("[tool] " + p.id + " realFetch failed:", e);
        }
      })();
    }
  }, { title: p.title, sub: p.sub });
});

// Nova route — opens the floating panel and shows hint view
SG.router.register("nova", function (view) {
  const el = SG.el;
  setTimeout(() => SG.nova.open(), 50);

  view.append(
    el("div", { class: "placeholder" },
      el("div", { class: "placeholder-icon" }, "★"),
      el("h3", {}, "Nova AI is ready"),
      el("p", {},
        "Ask Nova anything about cybersecurity, threats, scan results, or any of the 14 SentivoGuard tools. " +
        "The chat panel is open at the bottom-right."),
      el("div", { class: "tag-row" },
        el("span", { class: "tag tag-plus" }, "PLUS · 1M tokens / mo"),
        el("span", { class: "tag" }, "Claude Sonnet 4"),
        el("span", { class: "tag" }, "Streaming responses")
      ),
      el("button", {
        class: "btn btn-primary",
        onclick: () => SG.nova.open()
      }, "Open Nova")
    )
  );
}, { title: "Nova AI", sub: "Voice-capable AI security assistant · Plus tier" });
