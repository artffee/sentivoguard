// Shield VPN view — persisted state, real toggles, activity logging

SG.router.register("vpn", function (view) {
  const el = SG.el;
  const s  = SG.vpnState;

  const hero = el("div", { class: "vpn-hero" },
    el("div", {
      class: "vpn-shield" + (s.connected ? " connected" : ""),
      id: "vpn-shield"
    }, s.connected ? "◐" : "◑"),
    el("div", {},
      el("div", { class: "vpn-info-label" },
        s.connected
          ? (flagFor(s.serverCode) + " PROTECTED · WIREGUARD")
          : "DISCONNECTED"),
      el("div", { class: "vpn-info-title", id: "vpn-server" },
        s.connected ? s.server + " · " + s.serverCode : "Not connected"),
      el("div", { class: "vpn-info-meta" },
        el("span", {}, "IP: ", el("b", {}, s.connected ? s.ip : "—")),
        el("span", {}, "Encryption: ", el("b", {}, s.encryption)),
        el("span", {}, "Uptime: ", el("b", { id: "vpn-uptime" }, s.connected ? s.uptime : "—"))
      )
    ),
    el("button", {
      class: "vpn-toggle-btn" + (s.connected ? " disconnect" : ""),
      id: "vpn-toggle",
      onclick: toggle
    }, s.connected ? "Disconnect" : "Connect")
  );

  const stats = el("div", { class: "tool-grid-3" },
    statCard("↑ Upload",   s.upload,   "this session"),
    statCard("↓ Download", s.download, "this session"),
    statCard("◐ Status",   s.connected ? "Active" : "Off",
                           s.killSwitch ? "Kill switch on" : "Kill switch off")
  );

  const settings = el("div", { class: "card" },
    el("h4", { class: "card-title" }, "VPN Settings"),
    el("p", { class: "card-sub" }, "Configure how Shield VPN protects you. Saved automatically."),

    settingRow("killSwitch",   "Kill Switch",
      "Block all internet if VPN drops",   s.killSwitch),
    settingRow("splitTunnel",  "Split Tunneling",
      "Route some apps outside VPN",       s.splitTunnel),
    settingRow("customDns",    "Custom DNS over VPN",
      "Use 1.1.1.1 inside the tunnel",     s.customDns),
    settingRow("autoConnect",  "Auto-Connect on startup",
      "Connect to fastest server at boot", s.autoConnect),
    settingRow("blockIPv6",    "Block IPv6 leaks",
      "Force-disable IPv6 outside tunnel", s.blockIPv6)
  );

  const serverList = el("div", { class: "server-list" },
    el("div", {
      class: "server-row",
      style: "background: var(--bg-3); font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--fg-2); cursor: default;"
    },
      el("div", {}, ""),
      el("div", {}, "LOCATION"),
      el("div", {}, "PING"),
      el("div", {}, "LOAD"),
      el("div", {})
    ),
    ...SG.vpnServers.map(srv => serverRow(srv, s.connected && srv.code === s.serverCode))
  );

  view.append(
    hero,
    stats,
    el("div", {
      style: "display: grid; grid-template-columns: 1fr 1.4fr; gap: 16px; margin-top: 16px;"
    }, settings, serverList)
  );

  // ── Helpers ──
  function flagFor(code) {
    const srv = SG.vpnServers.find(v => v.code === code);
    return srv ? srv.flag : "🌐";
  }

  function statCard(label, value, sub) {
    return el("div", { class: "card" },
      el("div", { class: "qs-card-label" }, label),
      el("div", { class: "qs-card-value", style: "font-size: 22px; margin-top: 4px;" }, value),
      el("div", { class: "tiny muted", style: "margin-top: 2px;" }, sub)
    );
  }

  function settingRow(key, title, desc, on) {
    const input = document.createElement("input");
    input.type    = "checkbox";
    input.checked = !!on;
    input.addEventListener("change", () => {
      s[key] = input.checked;
      SG.persist("vpnState");
      SG.activity_log.log(input.checked ? "ok" : "info", input.checked ? "✓" : "○",
        "<b>Shield VPN</b> · " + title + " " + (input.checked ? "enabled" : "disabled"));
    });

    return el("div", {
      class: "between",
      style: "padding: 10px 0; border-bottom: 1px solid var(--bg-4);"
    },
      el("div", {},
        el("div", { style: "font-size: 12.5px; font-weight: 500;" }, title),
        el("div", { class: "muted tiny" }, desc)
      ),
      el("label", { class: "toggle" }, input, el("span", { class: "toggle-track" }))
    );
  }

  function serverRow(srv, active) {
    const loadClass = srv.load < 40 ? "" : srv.load < 70 ? "med" : "high";
    return el("div", {
      class: "server-row" + (active ? " active" : ""),
      onclick: () => connectTo(srv)
    },
      el("div", { class: "server-flag" }, srv.flag),
      el("div", { class: "server-name" },
        el("b", {}, srv.name),
        el("span", {}, srv.country + " · " + srv.code)
      ),
      el("div", { class: "server-ping" }, srv.ping + " ms"),
      el("div", { class: "server-load" },
        el("div", { class: "load-bar" },
          el("div", {
            class: "load-bar-fill " + loadClass,
            style: "width: " + srv.load + "%"
          })
        ),
        srv.load + "%"
      ),
      el("button", {
        class: "btn btn-sm btn-ghost",
        onclick: (e) => { e.stopPropagation(); connectTo(srv); }
      }, active ? "Active" : "Connect")
    );
  }

  function toggle() {
    s.connected = !s.connected;
    SG.persist("vpnState");
    if (s.connected) {
      SG.activity_log.log("ok", "↑",
        "<b>Shield VPN</b> connected to <b>" + s.server + " (" + s.serverCode + ")</b>");
    } else {
      SG.activity_log.log("warn", "↓", "<b>Shield VPN</b> disconnected");
    }
    SG.router.go("vpn");
  }

  function connectTo(srv) {
    s.connected   = true;
    s.server      = srv.name;
    s.serverCode  = srv.code;
    SG.persist("vpnState");
    SG.activity_log.log("ok", "↑",
      "<b>Shield VPN</b> connected to <b>" + srv.name + " (" + srv.code + ")</b>");
    SG.router.go("vpn");
  }
}, { title: "Shield VPN", sub: "WireGuard · AES-256-GCM · Kill switch active" });
