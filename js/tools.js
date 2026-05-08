// Remaining tool views — placeholder + targeted UI

const placeholders = [
  { id: "block",    title: "SentivoBlock",    sub: "DNS-level ad and tracker blocker", icon: "⊘",
    body: [
      ["Trackers blocked today", "12,847"],
      ["Domains in blocklist", "184,392"],
      ["Allowlist entries", "12"],
      ["DNS resolver", "127.0.0.1:5353"]
    ],
    desc: "System-wide ad and tracker blocking. Works across every browser and app — not just an extension. " +
          "Updatable blocklist sourced from EasyList and uBlock origin." },

  { id: "wall",     title: "SentivoWall",     sub: "Windows Firewall visual manager", icon: "▤",
    body: [
      ["Active rules", "12"],
      ["Inbound blocked (24h)", "47"],
      ["Outbound blocked (24h)", "8"],
      ["Apps managed", "23"]
    ],
    desc: "Per-app inbound/outbound rules with a clean visual UI. Block by port, IP range, or executable path. " +
          "Wraps the Windows Defender Firewall API for native performance." },

  { id: "defend",   title: "SentivoDefend",   sub: "Windows Defender enhancement", icon: "⌬",
    body: [
      ["Real-time protection", "On"],
      ["Definitions", "1.413.234.0"],
      ["Last quick scan", "today, 09:42"],
      ["Exclusions", "4 paths"]
    ],
    desc: "Surfaces Defender's hidden power: scan schedules, exclusion management, real-time protection toggle, " +
          "threat history log, and sensitivity tuning — all in one panel." },

  { id: "chat",     title: "SentivoChat",     sub: "End-to-end encrypted messaging", icon: "▭",
    body: [
      ["Encryption", "NaCl / Curve25519"],
      ["Server stores", "Ciphertext only"],
      ["Forward secrecy", "Yes (per session)"],
      ["Group chats", "Up to 50 members"]
    ],
    desc: "Zero-knowledge messaging between SentivoGuard users. Signal-Protocol-style ratcheting, " +
          "per-message keys, no metadata stored on servers." },

  { id: "transfer", title: "SentivoTransfer", sub: "Encrypted P2P file transfer (Ultimate)", icon: "⇌",
    tier: "Ultimate",
    body: [
      ["Max file size", "Unlimited"],
      ["Encryption", "AES-256-GCM"],
      ["Relay servers", "12 worldwide"],
      ["Files stored on server", "Never"]
    ],
    desc: "Encrypted peer-to-peer file transfer. One-time keys per transfer. Relay servers handle NAT traversal " +
          "but never decrypt. File contents never persisted on infrastructure." },

  { id: "dns",      title: "SentivoDNS",      sub: "Custom DNS with DoH support", icon: "⌖",
    body: [
      ["Active resolver", "Cloudflare 1.1.1.1"],
      ["DNS-over-HTTPS", "Enabled"],
      ["Queries today", "2,847"],
      ["Avg latency", "11 ms"]
    ],
    desc: "DNS-over-HTTPS support with one-click presets: Cloudflare 1.1.1.1, Google 8.8.8.8, Quad9, " +
          "or any custom resolver. Blocks malicious domains at resolution layer." },

  { id: "hotspot",  title: "SentivoHotspot",  sub: "WiFi hotspot with VPN sharing (Ultimate)", icon: "⌒",
    tier: "Ultimate",
    body: [
      ["Hotspot name", "Sentivo-Guarded"],
      ["Connected devices", "0"],
      ["VPN inheritance", "Yes"],
      ["Ad blocking", "Inherited"]
    ],
    desc: "Turns your PC into a protected WiFi access point. Phones, tablets, smart TVs — every connected device " +
          "automatically inherits your VPN tunnel, ad blocker, and DNS settings." },

  { id: "drivers",  title: "SentivoDrivers",  sub: "Driver update scanner (Ultimate)", icon: "⚙",
    tier: "Ultimate",
    body: [
      ["Drivers installed", "147"],
      ["Updates available", "3"],
      ["Last scan", "yesterday"],
      ["Auto-update", "Manual"]
    ],
    desc: "Driver update scanner. Queries WMI for installed drivers, compares against manufacturer version " +
          "databases. Downloads and installs silently — no bundled toolbars, no nagware." }
];

placeholders.forEach(p => {
  SG.router.register(p.id, function (view) {
    const el = SG.el;

    const tierTag = p.tier === "Ultimate"
      ? el("span", { class: "tag tag-ult" }, "ULTIMATE ONLY")
      : null;

    view.append(
      el("div", { class: "card", style: "margin-bottom: 14px;" },
        el("div", { class: "between" },
          el("div", { class: "row" },
            el("div", {
              style: "font-size: 32px; color: var(--accent-3); margin-right: 14px;"
            }, p.icon),
            el("div", {},
              el("h3", { style: "margin:0; font-size: 18px;" }, p.title),
              el("div", { class: "muted", style: "font-size: 13px; margin-top:2px;" }, p.desc)
            )
          ),
          el("div", { class: "row" },
            tierTag,
            el("button", { class: "btn btn-primary" },
              p.tier === "Ultimate" ? "Upgrade to Ultimate" : "Configure")
          )
        )
      ),

      el("div", { class: "tool-grid-3" },
        ...p.body.map(([k, v]) =>
          el("div", { class: "card" },
            el("div", { class: "qs-card-label" }, k),
            el("div", {
              class: "qs-card-value",
              style: "font-size: 18px; margin-top: 4px;"
            }, v)
          )
        )
      ),

      // Generic activity placeholder
      el("div", { style: "margin-top: 18px;" },
        el("div", { class: "section-head" },
          el("h3", {}, "Activity"),
          el("span", { class: "section-action" }, "Open logs →")
        ),
        el("div", { class: "feed" },
          activity("ok",   "✓", `<b>${p.title}</b> healthy · 0 issues`, "now"),
          activity("info", "↓", `<b>${p.title}</b> initialized for this session`, "1m ago"),
          activity("ok",   "✓", `<b>${p.title}</b> last full check passed`, "1h ago")
        )
      )
    );

    function activity(type, icon, msg, time) {
      return el("div", { class: "feed-item" },
        el("div", { class: "feed-icon " + type }, icon),
        el("div", { class: "feed-meta", html: msg }),
        el("div", { class: "feed-time" }, time)
      );
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
