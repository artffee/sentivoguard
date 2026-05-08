// Settings view — Anthropic API key, plan, danger zone

SG.router.register("settings", function (view) {
  const el = SG.el;

  const mode    = SG.api.getMode();
  const hasKey  = !!SG.api.getKey();
  const masked  = hasKey ? maskKey(SG.api.getKey()) : "";

  const modeLabel =
    mode === "electron" ? "Electron · secure IPC" :
    mode === "browser"  ? "Browser · direct fetch" :
                          "Mock · offline replies";
  const modeTag =
    mode === "electron" ? "tag-ok" :
    mode === "browser"  ? "tag-plus" : "tag-warn";

  // ── Nova / API key card ──
  const apiCard = el("div", { class: "card" },
    el("div", { class: "between", style: "margin-bottom: 14px;" },
      el("div", {},
        el("h4", { class: "card-title" }, "Nova AI · Anthropic API key"),
        el("p", { class: "card-sub" },
          "Paste your Anthropic API key to enable real Nova responses. " +
          "Stored in localStorage for browser mode; in Electron the renderer never sees it.")
      ),
      el("span", { class: "tag " + modeTag }, modeLabel)
    ),

    el("div", { class: "field" },
      el("span", { class: "field-label" }, "API key"),
      el("div", { class: "field-value", id: "apikey-row" },
        hasKey
          ? el("span", { class: "mono" }, masked)
          : el("span", { class: "muted" }, "(not set)"),
        el("div", { class: "row" },
          hasKey
            ? el("button", {
                class: "btn btn-sm btn-danger",
                onclick: clearKey
              }, "Remove")
            : null,
          el("button", {
            class: "btn btn-sm btn-ghost",
            onclick: showEditor
          }, hasKey ? "Replace" : "Set key")
        )
      ),
      el("div", { id: "apikey-editor", class: "hidden", style: "margin-top: 10px;" },
        el("div", { class: "row", style: "gap: 8px;" },
          inputEl({
            id: "apikey-input",
            type: "password",
            placeholder: "sk-ant-api03-…",
            style: "flex: 1; background: var(--bg-3); border: 1px solid var(--bg-4); color: var(--fg-0); padding: 8px 12px; border-radius: 6px; font-family: var(--font-mono); font-size: 12.5px;"
          }),
          el("button", { class: "btn btn-primary", onclick: saveKey }, "Save"),
          el("button", { class: "btn btn-ghost", onclick: hideEditor }, "Cancel")
        ),
        el("div", { class: "tiny muted", style: "margin-top: 6px;" },
          "Get a key at console.anthropic.com → API keys. " +
          "The browser-mode call uses ", el("span", { class: "mono" }, "anthropic-dangerous-direct-browser-access: true"),
          " — fine for local prototyping, but production should proxy through your own backend."
        )
      )
    ),

    el("div", { class: "tool-grid-3", style: "margin-top: 18px;" },
      stat("Tokens used (lifetime)", (SG.user.novaTokensUsed || 0).toLocaleString()),
      stat("Plan limit / month",    (SG.user.novaTokensLimit || 1_000_000).toLocaleString()),
      stat("Conversation history",   (SG.store.get("novaHistory", []).length) + " messages")
    )
  );

  // ── VirusTotal API key card ──
  const vtCard = el("div", { class: "card", style: "margin-top: 14px;" },
    el("div", { class: "between", style: "margin-bottom: 14px;" },
      el("div", {},
        el("h4", { class: "card-title" }, "VirusTotal API key"),
        el("p", { class: "card-sub" },
          "Look up file hashes against 70+ commercial AV engines. " +
          "Free tier: 4 requests/minute, 500/day. Sign up at virustotal.com/gui/join-us.")
      ),
      el("span", { class: "tag", id: "vt-status" }, "loading…")
    ),

    el("div", { class: "field" },
      el("span", { class: "field-label" }, "API key"),
      el("div", { class: "field-value", id: "vt-row" },
        el("span", { class: "muted" }, "(loading)"),
        el("div", { class: "row" },
          el("button", { class: "btn btn-sm btn-ghost", onclick: showVtEditor }, "Set / Replace"),
          el("button", { class: "btn btn-sm btn-danger", onclick: clearVtKey }, "Remove")
        )
      ),
      el("div", { id: "vt-editor", class: "hidden", style: "margin-top: 10px;" },
        el("div", { class: "row", style: "gap: 8px;" },
          inputEl({
            id: "vt-input",
            type: "password",
            placeholder: "VirusTotal API key (64 hex chars)",
            style: "flex: 1; background: var(--bg-3); border: 1px solid var(--bg-4); color: var(--fg-0); padding: 8px 12px; border-radius: 6px; font-family: var(--font-mono); font-size: 12.5px;"
          }),
          el("button", { class: "btn btn-primary", onclick: saveVtKey }, "Save"),
          el("button", { class: "btn btn-ghost",   onclick: hideVtEditor }, "Cancel")
        )
      )
    )
  );

  // Pull current VT status from backend if available
  if (SG.backend && SG.backend.isReal()) {
    SG.backend.vtStatus().then(r => {
      const row = document.getElementById("vt-row");
      const tag = document.getElementById("vt-status");
      if (!row || !tag) return;
      if (r.ok && r.configured) {
        row.firstChild.textContent = "configured (key stored on backend)";
        tag.className = "tag tag-ok";
        tag.textContent = "READY · " + r.rate.day.used + "/" + r.rate.day.limit + " today";
      } else {
        row.firstChild.textContent = "(not set — Disk Scan won't query VT)";
        tag.className = "tag tag-warn";
        tag.textContent = "NOT CONFIGURED";
      }
    });
  } else {
    setTimeout(() => {
      const tag = document.getElementById("vt-status");
      if (tag) {
        tag.className = "tag tag-warn";
        tag.textContent = "BACKEND OFFLINE";
      }
    }, 50);
  }

  function showVtEditor() {
    document.getElementById("vt-editor").classList.remove("hidden");
    document.getElementById("vt-input").focus();
  }
  function hideVtEditor() {
    document.getElementById("vt-editor").classList.add("hidden");
  }
  async function saveVtKey() {
    const v = document.getElementById("vt-input").value.trim();
    if (!v) return;
    if (!/^[a-f0-9]{64}$/i.test(v)) {
      if (!confirm("That doesn't look like a VirusTotal key (expected 64 hex chars). Save anyway?")) return;
    }
    const r = await SG.backend.vtSetKey(v);
    if (!r.ok) { alert("Failed: " + (r.error || "unknown")); return; }
    SG.activity_log.log("ok", "✓", "<b>VirusTotal</b> · API key configured");
    SG.router.go("settings");
  }
  async function clearVtKey() {
    if (!confirm("Remove the VirusTotal API key?")) return;
    await SG.backend.vtClearKey();
    SG.activity_log.log("info", "↓", "<b>VirusTotal</b> · API key removed");
    SG.router.go("settings");
  }

  // ── License card ──
  const licInfo = SG.license.info();
  const licCard = el("div", { class: "card", style: "margin-top: 14px;" },
    el("div", { class: "between", style: "margin-bottom: 14px;" },
      el("div", {},
        el("h4", { class: "card-title" }, "License key"),
        el("p", { class: "card-sub" },
          licInfo.licensed
            ? "Licensed to " + licInfo.email + " · " + licInfo.daysLeft + " days remaining."
            : "Paste the license key from your purchase email to unlock Plus / Ultimate features.")
      ),
      el("span", {
        class: "tag " + (licInfo.licensed ? "tag-ok" : "tag-warn")
      }, licInfo.licensed ? capitalize(licInfo.plan) + " · ACTIVE" : "FREE")
    ),

    licInfo.licensed
      ? el("div", {},
          el("div", {
            class: "field-value",
            style: "background: var(--bg-3);"
          },
            el("span", { class: "mono", style: "font-size: 11px;" },
              SG.store.get("license", {}).token?.slice(0, 32) + "…"),
            el("button", {
              class: "btn btn-sm btn-danger",
              onclick: () => {
                if (!confirm("Remove the active license? The app will revert to Free tier.")) return;
                SG.license.deactivate();
                SG.router.go("settings");
              }
            }, "Deactivate")
          )
        )
      : el("div", { id: "lic-input-wrap" },
          (() => {
            const ta = document.createElement("textarea");
            ta.id = "lic-input";
            ta.rows = 3;
            ta.placeholder = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.…";
            ta.style.cssText =
              "width: 100%; background: var(--bg-3); border: 1px solid var(--bg-4); " +
              "color: var(--fg-0); padding: 10px 12px; border-radius: 6px; " +
              "font-family: var(--font-mono); font-size: 11px; resize: vertical;";
            return ta;
          })(),
          el("div", { id: "lic-error", class: "tag tag-danger hidden", style: "margin-top: 8px;" }),
          el("div", { class: "row", style: "gap: 8px; margin-top: 10px;" },
            el("button", {
              class: "btn btn-primary",
              onclick: activateLicense
            }, "Activate"),
            el("button", {
              class: "btn btn-ghost",
              onclick: () => alert("After Stripe checkout you receive a license key by email. Paste the JWT token (eyJ…) above and click Activate.\n\nFor testing without payment:\n  node tools/issue-license.js you@example.com plus 365")
            }, "Where do I get a key?")
          )
        )
  );

  async function activateLicense() {
    const token = document.getElementById("lic-input").value.trim();
    const err   = document.getElementById("lic-error");
    err.classList.add("hidden");
    if (!token) { err.textContent = "Paste a license key."; err.classList.remove("hidden"); return; }
    const r = await SG.license.activate(token);
    if (!r.ok) {
      err.textContent = "Activation failed: " + (r.error || "unknown") +
                        (r.detail ? " — " + r.detail : "");
      err.classList.remove("hidden");
      return;
    }
    SG.router.go("settings");
  }

  function capitalize(s) { return s ? s[0].toUpperCase() + s.slice(1) : s; }

  // ── Account card ──
  const accountCard = el("div", { class: "card", style: "margin-top: 14px;" },
    el("h4", { class: "card-title" }, "Account"),
    el("p", { class: "card-sub" }, "Plan and device settings"),
    settingRow("Email",        SG.user.email),
    settingRow("Plan",         SG.user.plan + " · $" + (SG.user.plan === "Plus" ? 49 : SG.user.plan === "Ultimate" ? 99 : SG.user.plan === "Standard" ? 29 : 0) + "/yr"),
    settingRow("Devices",      String(SG.user.devices) + " of " + (SG.user.plan === "Ultimate" ? "unlimited" : SG.user.plan === "Plus" ? "5" : "3")),
    settingRow("App version",  "2.1.0"),

    el("div", { style: "display:flex; gap:8px; margin-top: 14px;" },
      el("button", { class: "btn btn-ghost" }, "Manage billing"),
      el("button", { class: "btn btn-primary" }, "Upgrade to Ultimate")
    )
  );

  // ── Danger zone ──
  const dangerCard = el("div", { class: "card", style: "margin-top: 14px; border-color: rgba(230,57,70,0.25);" },
    el("h4", { class: "card-title", style: "color: var(--danger);" }, "Danger zone"),
    el("p", { class: "card-sub" },
      "These actions wipe local state. Only the renderer's persistence (vault, " +
      "VPN preferences, Nova history, activity, settings) is affected — the underlying " +
      "tools and scanner engine are untouched."),

    el("div", { style: "display:flex; gap:8px; margin-top: 8px; flex-wrap: wrap;" },
      el("button", {
        class: "btn btn-danger btn-sm",
        onclick: () => confirmReset("novaHistory", "Clear Nova history")
      }, "Clear Nova history"),
      el("button", {
        class: "btn btn-danger btn-sm",
        onclick: () => confirmReset("activity", "Clear activity feed")
      }, "Clear activity feed"),
      el("button", {
        class: "btn btn-danger btn-sm",
        onclick: () => confirmFull()
      }, "Reset everything")
    )
  );

  view.append(licCard, apiCard, vtCard, accountCard, dangerCard);

  // ── helpers ──
  function inputEl(attrs) {
    const i = document.createElement("input");
    for (const k in attrs) {
      if (k === "style") i.setAttribute("style", attrs[k]);
      else i[k] = attrs[k];
    }
    return i;
  }
  function showEditor() {
    document.getElementById("apikey-editor").classList.remove("hidden");
    document.getElementById("apikey-input").focus();
  }
  function hideEditor() {
    document.getElementById("apikey-editor").classList.add("hidden");
  }
  function saveKey() {
    const v = document.getElementById("apikey-input").value.trim();
    if (!v) return;
    if (!v.startsWith("sk-ant-")) {
      if (!confirm("That doesn't look like an Anthropic key (expected prefix sk-ant-…). Save anyway?")) return;
    }
    SG.api.setKey(v);
    SG.activity_log.log("ok", "✓", "<b>Settings</b> · Anthropic API key configured");
    SG.router.go("settings");
  }
  function clearKey() {
    if (!confirm("Remove the saved API key? Nova will fall back to mock responses.")) return;
    SG.api.clearKey();
    SG.activity_log.log("info", "↓", "<b>Settings</b> · Anthropic API key removed");
    SG.router.go("settings");
  }
  function confirmReset(key, label) {
    if (!confirm(label + "? This cannot be undone.")) return;
    SG.store.del(key);
    if (key === "novaHistory" && SG.nova) SG.nova.reset();
    if (key === "activity") {
      SG.activity = [];
      document.dispatchEvent(new CustomEvent("sg:activity"));
    }
    SG.router.go("settings");
  }
  function confirmFull() {
    if (!confirm("Wipe ALL local SentivoGuard state — vault, VPN preferences, Nova history, settings? This cannot be undone.")) return;
    SG.store.reset();
    location.reload();
  }
  function settingRow(label, value) {
    return el("div", {
      class: "between",
      style: "padding: 10px 0; border-bottom: 1px solid var(--bg-4);"
    },
      el("div", { style: "font-size: 12.5px;" }, label),
      el("div", { class: "mono", style: "font-size: 12.5px; color: var(--fg-1);" }, value)
    );
  }
  function stat(label, value) {
    return el("div", { class: "card", style: "padding: 14px;" },
      el("div", { class: "qs-card-label" }, label),
      el("div", { class: "qs-card-value", style: "font-size: 18px; margin-top: 4px;" }, value)
    );
  }
  function maskKey(k) {
    if (k.length <= 10) return k;
    return k.slice(0, 10) + "…" + k.slice(-4);
  }
}, { title: "Settings", sub: "API key · plan · local data" });
