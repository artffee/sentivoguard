// Quarantine view — manage quarantined items and whitelist.

SG.router.register("quarantine", function (view) {
  const el = SG.el;

  let tab = SG.store.get("quarantineTab", "items");

  // ── Layout ────────────────────────────────────────────────────────
  const tabs = el("div", { class: "row", style: "gap: 8px; margin-bottom: 14px;" },
    tabBtn("items",     "Quarantined files"),
    tabBtn("whitelist", "Whitelist")
  );

  const body = el("div", { id: "q-body" });
  view.append(headerCard(), tabs, body);

  load();

  // ── Helpers ───────────────────────────────────────────────────────
  function tabBtn(id, label) {
    return el("button", {
      class: "btn " + (tab === id ? "btn-primary" : "btn-ghost"),
      onclick: () => { tab = id; SG.store.set("quarantineTab", id); SG.router.go("quarantine"); }
    }, label);
  }

  function headerCard() {
    const realBadge = SG.backend.isReal()
      ? el("span", { class: "tag tag-ok" }, "BACKEND CONNECTED")
      : el("span", { class: "tag tag-warn" }, "MOCK MODE");

    return el("div", { class: "card", style: "margin-bottom: 14px;" },
      el("div", { class: "between" },
        el("div", { style: "max-width: 70%;" },
          el("div", { class: "caps muted" }, "Reversible quarantine · SHA-256 verified"),
          el("h3", { style: "margin: 4px 0 6px; font-size: 18px;" },
            "Quarantine & Repair"),
          el("p", {
          class: "muted",
          style: "font-size: 12.5px; margin: 0;",
          html: "Files moved here are renamed, defanged, and held in <span class=\"mono\">~/.sentivoguard/quarantine/</span>. " +
                "Restore returns them to the exact original path after verifying the SHA-256 hash. " +
                "Nothing is permanently deleted unless you explicitly delete it."
        })
        ),
        realBadge
      )
    );
  }

  // ── Load + render ─────────────────────────────────────────────────
  async function load() {
    const wrap = document.getElementById("q-body");
    if (!SG.backend.isReal()) {
      wrap.innerHTML = "";
      wrap.appendChild(el("div", { class: "placeholder" },
        el("div", { class: "placeholder-icon" }, "⌬"),
        el("h3", {}, "Backend offline"),
        el("p", {}, "Open the app at http://127.0.0.1:4173 (with Node backend running) to use the quarantine.")
      ));
      return;
    }

    if (tab === "items") return renderItems();
    return renderWhitelist();
  }

  async function renderItems() {
    const wrap = document.getElementById("q-body");
    wrap.innerHTML = "";
    wrap.appendChild(el("div", { class: "muted", style: "padding: 16px;" }, "Loading…"));

    const r = await SG.backend.quarantineList();
    wrap.innerHTML = "";

    if (!r.ok) {
      wrap.appendChild(el("div", { class: "placeholder" },
        el("h3", {}, "Error"),
        el("p", {}, r.error || "Could not load quarantine.")
      ));
      return;
    }

    // Stats
    const stats = el("div", { class: "tool-grid-3", style: "margin-bottom: 14px;" },
      stat("Quarantined items", String(r.count),                 "in ~/.sentivoguard/"),
      stat("Total size",         formatBytes(r.totalSize || 0),  "moved out of original locations"),
      stat("Reversible",         String(r.count),                "all items have SHA-256 stored")
    );
    wrap.appendChild(stats);

    if (!r.count) {
      wrap.appendChild(el("div", { class: "placeholder" },
        el("div", { class: "placeholder-icon" }, "✓"),
        el("h3", {}, "Quarantine is empty"),
        el("p", {}, "Run a Disk Scan and click Quarantine on any HIGH-severity finding to move it here.")
      ));
      return;
    }

    // Bulk actions
    wrap.appendChild(
      el("div", { class: "row", style: "gap: 8px; margin-bottom: 12px;" },
        el("button", { class: "btn btn-ghost btn-sm", onclick: () => bulkRestore(r.items) },
          "Restore all"),
        el("button", { class: "btn btn-danger btn-sm", onclick: () => bulkDelete(r.items) },
          "Delete all permanently")
      )
    );

    // List
    const list = el("div", { class: "card", style: "padding: 0;" });
    r.items.forEach(it => list.appendChild(itemRow(it)));
    wrap.appendChild(list);
  }

  async function renderWhitelist() {
    const wrap = document.getElementById("q-body");
    wrap.innerHTML = "";
    wrap.appendChild(el("div", { class: "muted", style: "padding: 16px;" }, "Loading…"));

    const r = await SG.backend.whitelistList();
    wrap.innerHTML = "";

    if (!r.ok) {
      wrap.appendChild(el("div", { class: "placeholder" },
        el("h3", {}, "Error"),
        el("p", {}, r.error || "Could not load whitelist.")
      ));
      return;
    }

    const card = el("div", { class: "card" },
      el("h4", { class: "card-title" }, "Whitelisted paths"),
      el("p", { class: "card-sub" },
        "Files and folders the disk scanner skips. " +
        "Use this for legitimate executables in normally-suspicious locations (e.g. an installer in Downloads you want to keep)."),

      addWhitelistRow()
    );

    if (!r.paths.length) {
      card.appendChild(el("div", { class: "muted", style: "padding: 14px 0;" },
        "Nothing whitelisted yet. Add a path above, or click ‘Whitelist’ on a finding in the Disk Scan view."));
    } else {
      const list = el("div", { class: "card", style: "padding: 0; margin-top: 12px;" });
      r.paths.forEach(p => list.appendChild(whitelistRow(p)));
      card.appendChild(list);
    }
    wrap.appendChild(card);
  }

  // ── Row renderers ─────────────────────────────────────────────────
  function itemRow(it) {
    const sev = it.finding && it.finding.severity;
    const sevClass = sev === "HIGH" ? "tag-danger" : sev === "MEDIUM" ? "tag-warn" : "";

    return el("div", {
      style: "display:grid; grid-template-columns: auto 1fr auto; gap: 14px; padding: 12px 16px; " +
             "border-bottom: 1px solid var(--bg-4); align-items: center;"
    },
      el("div", {},
        sev ? el("span", { class: "tag " + sevClass }, sev) : el("span", { class: "tag" }, "—")
      ),
      el("div", {},
        el("div", { style: "font-weight: 600; font-size: 13px;" }, it.originalName),
        el("div", { class: "mono tiny muted",
                    style: "max-width: 600px; overflow: hidden; text-overflow: ellipsis;" },
          it.originalPath),
        el("div", { class: "tiny muted", style: "margin-top: 2px;" },
          formatBytes(it.size) + " · sha256 " + it.sha256.slice(0, 12) + "… · " +
          new Date(it.quarantinedAt).toLocaleString() +
          (it.reason ? " · " + it.reason : ""))
      ),
      el("div", { class: "row", style: "gap: 6px;" },
        el("button", {
          class: "btn btn-sm btn-ghost",
          onclick: () => restoreOne(it)
        }, "Restore"),
        el("button", {
          class: "btn btn-sm btn-danger",
          onclick: () => deleteOne(it)
        }, "Delete")
      )
    );
  }

  function whitelistRow(p) {
    return el("div", {
      style: "display:grid; grid-template-columns: 1fr auto; gap: 12px; padding: 10px 16px; " +
             "border-bottom: 1px solid var(--bg-4); align-items: center;"
    },
      el("div", { class: "mono",
                  style: "font-size: 12px; overflow: hidden; text-overflow: ellipsis;" }, p),
      el("button", {
        class: "btn btn-sm btn-danger",
        onclick: async () => {
          if (!confirm("Remove " + p + " from whitelist?")) return;
          await SG.backend.whitelistRemove(p);
          SG.activity_log.log("info", "−", "<b>Whitelist</b> · removed <span class='mono'>" + escapeHtml(p) + "</span>");
          SG.router.go("quarantine");
        }
      }, "Remove")
    );
  }

  function addWhitelistRow() {
    const input = document.createElement("input");
    input.type = "text";
    input.placeholder = "C:\\Users\\you\\Downloads\\my-tool.exe (or a directory)";
    input.style.cssText =
      "flex: 1; background: var(--bg-3); border: 1px solid var(--bg-4); " +
      "color: var(--fg-0); padding: 8px 12px; border-radius: 6px; " +
      "font-family: var(--font-mono); font-size: 12px;";
    return el("div", { class: "row", style: "gap: 8px; margin-top: 12px;" },
      input,
      el("button", {
        class: "btn btn-primary",
        onclick: async () => {
          const v = input.value.trim();
          if (!v) return;
          const r = await SG.backend.whitelistAdd(v);
          if (r.ok) {
            SG.activity_log.log("ok", "+",
              "<b>Whitelist</b> · added <span class='mono'>" + escapeHtml(v) + "</span>");
            SG.router.go("quarantine");
          } else {
            alert("Failed: " + (r.error || "unknown"));
          }
        }
      }, "+ Add to whitelist")
    );
  }

  // ── Actions ───────────────────────────────────────────────────────
  async function restoreOne(it) {
    if (!confirm("Restore " + it.originalName + " to its original location?\n\n" + it.originalPath)) return;
    const r = await SG.backend.quarantineRestore(it.id);
    if (!r.ok) {
      if (r.error === "hash_mismatch") {
        if (!confirm("SHA-256 mismatch — file may have been tampered with. Force restore anyway?")) return;
        const r2 = await SG.backend.quarantineRestore(it.id, true);
        if (!r2.ok) { alert("Restore failed: " + r2.error); return; }
      } else {
        alert("Restore failed: " + (r.error || "unknown") + (r.detail ? "\n\n" + r.detail : ""));
        return;
      }
    }
    SG.activity_log.log("info", "↑",
      "<b>Quarantine</b> · restored <b>" + escapeHtml(it.originalName) + "</b>");
    SG.router.go("quarantine");
  }

  async function deleteOne(it) {
    if (!confirm("Permanently delete " + it.originalName + "?\n\n" +
                 it.originalPath + "\n\nThis cannot be undone.")) return;
    if (!confirm("Confirm: this is irreversible. Delete now?")) return;
    const r = await SG.backend.quarantineDelete(it.id);
    if (!r.ok) { alert("Delete failed: " + r.error); return; }
    SG.activity_log.log("danger", "X",
      "<b>Quarantine</b> · deleted <b>" + escapeHtml(it.originalName) + "</b> permanently");
    SG.router.go("quarantine");
  }

  async function bulkRestore(items) {
    if (!confirm("Restore all " + items.length + " quarantined item(s) to their original locations?")) return;
    let ok = 0, failed = 0;
    for (const it of items) {
      const r = await SG.backend.quarantineRestore(it.id);
      r.ok ? ok++ : failed++;
    }
    SG.activity_log.log("info", "↑",
      "<b>Quarantine</b> · bulk restore · " + ok + " restored, " + failed + " failed");
    alert("Restored: " + ok + ", failed: " + failed);
    SG.router.go("quarantine");
  }

  async function bulkDelete(items) {
    if (!confirm("Permanently delete all " + items.length + " quarantined item(s)?\n\nThis cannot be undone.")) return;
    if (!confirm("Confirm permanent deletion of " + items.length + " items.")) return;
    let ok = 0, failed = 0;
    for (const it of items) {
      const r = await SG.backend.quarantineDelete(it.id);
      r.ok ? ok++ : failed++;
    }
    SG.activity_log.log("danger", "X",
      "<b>Quarantine</b> · bulk delete · " + ok + " deleted permanently");
    alert("Deleted: " + ok + ", failed: " + failed);
    SG.router.go("quarantine");
  }

  // ── utils ─────────────────────────────────────────────────────────
  function stat(label, value, sub) {
    return el("div", { class: "card" },
      el("div", { class: "qs-card-label" }, label),
      el("div", { class: "qs-card-value", style: "font-size: 22px; margin-top: 4px;" }, value),
      el("div", { class: "tiny muted", style: "margin-top: 2px;" }, sub)
    );
  }
  function formatBytes(b) {
    if (!b) return "0 B";
    if (b >= 1024 ** 3) return (b / 1024 ** 3).toFixed(2) + " GB";
    if (b >= 1024 ** 2) return (b / 1024 ** 2).toFixed(0) + " MB";
    if (b >= 1024)      return (b / 1024).toFixed(0) + " KB";
    return b + " B";
  }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, ch => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[ch]));
  }

}, { title: "Quarantine", sub: "Reversible quarantine · SHA-256 verified · whitelist management" });
