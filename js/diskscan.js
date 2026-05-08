// Disk Scan view — full-disk antivirus-style scan with live streaming results.

SG.router.register("diskscan", function (view) {
  const el = SG.el;

  // ── State ─────────────────────────────────────────────────────────
  let scanning   = false;
  let abortFn    = null;
  let findings   = [];
  let stats      = { filesScanned: 0, dirsScanned: 0, findings: 0, elapsed: 0 };
  let presetPaths = [];

  // Pull preset paths from backend (so user sees what "Quick Scan" covers).
  if (SG.backend.isReal()) {
    SG.backend.getDiskPreset().then(r => {
      if (r.ok) {
        presetPaths = r.paths;
        const list = document.getElementById("preset-list");
        if (list) {
          list.innerHTML = "";
          r.paths.slice(0, 8).forEach(p =>
            list.appendChild(el("span", { class: "tag mono", style: "font-size:10.5px;" }, p)));
        }
      }
    });
  }

  // ── UI ────────────────────────────────────────────────────────────
  const realBadge = SG.backend.isReal()
    ? el("span", { class: "tag tag-ok" }, "BACKEND CONNECTED")
    : el("span", { class: "tag tag-warn" }, "MOCK MODE — open via http://127.0.0.1:4173");

  const heroCard = el("div", { class: "card", style: "margin-bottom: 14px;" },
    el("div", { class: "between" },
      el("div", { style: "max-width: 70%;" },
        el("div", { class: "caps muted" }, "Real-time disk scan · streaming"),
        el("h3", { style: "margin: 4px 0 6px; font-size: 18px;" },
          "Scan your computer for threats"),
        el("p", { class: "muted", style: "font-size: 12.5px; margin: 0;" },
          "Walks tens of thousands of files, applies 8+ pattern categories to scripts, " +
          "and flags suspicious filenames + risky locations (Temp, AppData, Startup). " +
          "Quick Scan covers the locations malware most often lives. Custom Scan walks any path you give it.")
      ),
      realBadge
    ),
    el("div", { id: "preset-block", style: "margin-top: 14px;" },
      el("div", { class: "caps muted", style: "margin-bottom: 6px;" }, "Quick Scan covers"),
      el("div", { id: "preset-list",
                  style: "display: flex; flex-wrap: wrap; gap: 6px;" },
        el("span", { class: "muted tiny" }, "loading…"))
    )
  );

  const customInput = (() => {
    const i = document.createElement("input");
    i.type = "text";
    i.id = "diskscan-target";
    i.placeholder = "C:\\Users\\you\\Downloads (or any path)";
    i.style.cssText =
      "width: 100%; background: var(--bg-3); border: 1px solid var(--bg-4); " +
      "color: var(--fg-0); padding: 9px 12px; border-radius: 6px; " +
      "font-family: var(--font-mono); font-size: 12.5px;";
    return i;
  })();

  const controls = el("div", { class: "card", style: "margin-bottom: 14px;" },
    el("div", { class: "between" },
      el("div", { style: "flex: 1; margin-right: 14px;" },
        el("div", { class: "caps muted", style: "margin-bottom: 6px;" }, "Custom path (optional)"),
        customInput
      ),
      el("div", { class: "row", style: "gap: 8px;" },
        el("button", {
          class: "btn btn-ghost",
          id:   "btn-quick",
          onclick: () => start({ quick: true })
        }, "▶ Quick Scan"),
        el("button", {
          class: "btn btn-primary",
          id:   "btn-custom",
          onclick: () => {
            const t = customInput.value.trim();
            if (!t) { alert("Enter a path to scan."); return; }
            start({ target: t });
          }
        }, "▶ Custom Scan"),
        el("button", {
          class: "btn btn-danger hidden",
          id:   "btn-cancel",
          onclick: () => { if (abortFn) abortFn(); }
        }, "✕ Cancel")
      )
    )
  );

  // Live progress card
  const progressCard = el("div", { class: "card hidden", id: "progress-card" },
    el("div", { class: "between", style: "align-items: flex-start;" },
      el("div", { style: "flex: 1; min-width: 0;" },
        el("div", { class: "caps muted" }, "Status"),
        el("h3", { id: "progress-title", style: "margin: 4px 0 4px; font-size: 16px;" }, "Idle"),
        el("div", { id: "progress-current",
                    class: "mono muted",
                    style: "font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" }, "")
      ),
      el("div", { id: "progress-verdict-slot" })
    ),
    el("div", { class: "progress", style: "margin: 14px 0 8px;" },
      el("div", { class: "progress-bar", id: "progress-bar", style: "width: 0%;" })
    ),
    el("div", { class: "tool-grid-3", style: "margin-top: 8px;" },
      stat("Files scanned",  "0",      "files-scanned"),
      stat("Findings",        "0",      "findings-count"),
      stat("Elapsed",          "0.0s",  "elapsed")
    )
  );

  // Severity summary chips
  const sevSummary = el("div", { id: "sev-summary",
                                 class: "row hidden",
                                 style: "gap: 8px; margin-bottom: 8px; flex-wrap: wrap;" });

  // Findings table
  const findingsCard = el("div", { class: "card hidden", id: "findings-card",
                                   style: "padding: 0; margin-top: 14px;" },
    el("div", { class: "between",
                style: "padding: 12px 16px; border-bottom: 1px solid var(--bg-4);" },
      el("div", { class: "caps muted" },
        "Live findings · ",
        el("span", { id: "findings-counter", class: "mono" }, "0")),
      el("button", {
        class: "btn btn-ghost btn-sm",
        onclick: () => exportFindings()
      }, "↓ Export JSON")
    ),
    el("div", { id: "findings-list", style: "max-height: 480px; overflow-y: auto;" })
  );

  view.append(heroCard, controls, progressCard, sevSummary, findingsCard);

  // ── Helpers ───────────────────────────────────────────────────────
  function stat(label, value, id) {
    return el("div", { class: "card" },
      el("div", { class: "qs-card-label" }, label),
      el("div", { class: "qs-card-value", id, style: "font-size: 22px; margin-top: 4px;" }, value)
    );
  }

  function sevPill(label, count, cls) {
    return el("span", { class: "tag " + cls },
      label + ": " + (count || 0));
  }

  function renderSummary() {
    sevSummary.innerHTML = "";
    const high = findings.filter(f => f.severity === "HIGH").length;
    const med  = findings.filter(f => f.severity === "MEDIUM").length;
    const low  = findings.filter(f => f.severity === "LOW").length;
    sevSummary.append(
      sevPill("HIGH", high, "tag-danger"),
      sevPill("MEDIUM", med, "tag-warn"),
      sevPill("LOW", low, ""),
      sevPill("Total", findings.length, "tag-ok")
    );
  }

  function appendFinding(f) {
    const wrap = document.getElementById("findings-list");
    if (!wrap) return;
    const sevClass = f.severity === "HIGH" ? "high" : f.severity === "MEDIUM" ? "medium" : "low";

    // The disk scanner emits absolute file paths; folder/npm emit relative.
    // We resolve to absolute by combining with the scan root if needed.
    const absPath = resolveAbs(f);

    const status = el("span", { class: "finding-loc" },
      (f.line ? f.file + ":" + f.line : f.file) || "—");

    const actions = el("div", { class: "row", style: "gap: 4px;" });

    const vtSlot = el("span", { class: "tiny" });

    // Show fix actions for findings tied to a real file location.
    if (absPath && SG.backend.isReal()) {
      actions.append(
        el("button", {
          class: "btn btn-sm btn-ghost",
          onclick: () => doVtLookup(absPath, vtSlot)
        }, "↗ VT"),
        el("button", {
          class: "btn btn-sm btn-danger",
          onclick: () => doQuarantine(absPath, f, row, status)
        }, "Quarantine"),
        el("button", {
          class: "btn btn-sm btn-ghost",
          onclick: () => doWhitelist(absPath, row, status)
        }, "Whitelist")
      );
    }

    const row = el("div", {
      class: "finding",
      style: "border-radius: 0; border-left: 0; border-right: 0; margin: 0;"
    },
      el("div", { class: "finding-sev sev-" + sevClass }, f.severity),
      el("div", { class: "finding-msg" },
        el("b", {}, f.message), " ",
        el("span", { class: "muted tiny" }, "[" + (f.category || "?").replace(/_/g, " ") + "]"),
        " ",
        vtSlot
      ),
      el("div", { class: "row" }, status, actions)
    );
    wrap.appendChild(row);
    document.getElementById("findings-counter").textContent = String(findings.length);
  }

  // The disk scanner reports paths relative to each scan root in `f.file`,
  // but the original event also fires under a root we yielded earlier.
  // For now, treat `f.file` as absolute if it starts with a drive letter,
  // otherwise prepend the most-recent root.
  function resolveAbs(f) {
    if (!f || !f.file) return null;
    if (/^[a-z]:[\\/]/i.test(f.file)) return f.file.replace(/\//g, "\\");
    // Disk scanner emits absolute paths (we built them by joining baseDir).
    // Folder scanner uses relative — reconstruct with the requested target.
    if (currentScanRoot) {
      return (currentScanRoot + (currentScanRoot.endsWith("\\") ? "" : "\\") +
              f.file.replace(/\//g, "\\"));
    }
    return f.file.replace(/\//g, "\\");
  }

  let currentScanRoot = null;

  async function doQuarantine(absPath, f, row, statusEl) {
    if (!confirm("Quarantine this file?\n\n" + absPath +
                 "\n\nIt will be moved to ~/.sentivoguard/quarantine/ and renamed. " +
                 "You can restore it from the Quarantine view at any time.")) return;
    const reason = (f.severity || "?") + " · " + (f.category || "?") + " · " + (f.message || "");
    const r = await SG.backend.quarantine(absPath, reason, f);
    if (!r.ok) {
      alert("Quarantine failed: " + (r.error || "unknown") +
            (r.detail ? "\n\n" + r.detail : ""));
      return;
    }
    SG.activity_log.log("warn", "⚓",
      "<b>Quarantine</b> · moved <b>" + escapeHtml(r.item.originalName) + "</b> · " + reason.slice(0, 60));
    // Mark the row visually
    row.style.opacity = "0.5";
    statusEl.innerHTML = "";
    statusEl.appendChild(el("span", { class: "tag tag-warn" }, "QUARANTINED"));
    // Hide action buttons
    const actions = row.querySelector(".row:last-child .row");
    if (actions) actions.innerHTML = "";
  }

  async function doVtLookup(absPath, slot) {
    slot.innerHTML = '<span class="muted">VT looking up…</span>';
    const r = await SG.backend.vtLookup({ path: absPath });
    if (!r.ok) {
      const msg = r.error === "no_key"
        ? "VT key not set — open Settings"
        : r.error === "rate_minute" ? "VT rate limit (4/min) — wait a moment"
        : r.error === "rate_day"    ? "VT daily limit reached"
        : "VT error: " + (r.error || "unknown");
      slot.innerHTML = '<span class="tag tag-warn" style="font-size:10px;">' + msg + '</span>';
      return;
    }
    if (!r.found) {
      slot.innerHTML = '<span class="tag" style="font-size:10px;">VT: not in DB</span>';
      return;
    }
    const m = r.malicious || 0, s = r.suspicious || 0, total = r.total || 0;
    let cls = "tag";
    if (m >= 3)      cls = "tag tag-danger";
    else if (m + s) cls = "tag tag-warn";
    else            cls = "tag tag-ok";
    const link = '<a href="' + r.permalink + '" target="_blank" rel="noopener" ' +
                 'style="color: inherit; text-decoration: underline;">VT: ' +
                 m + '/' + total + ' malicious' + (s ? ', ' + s + ' suspicious' : '') +
                 '</a>';
    slot.innerHTML = '<span class="' + cls + '" style="font-size:10px;">' + link + '</span>' +
                     (r.cached ? ' <span class="tiny muted">(cached)</span>' : '');

    // Log notable hits
    if (m >= 3) {
      SG.activity_log.log("danger", "X",
        "<b>VirusTotal</b> · <b>" + m + "/" + total + " engines flagged</b> " +
        absPath.split(/[\\/]/).pop());
    }
  }

  async function doWhitelist(absPath, row, statusEl) {
    if (!confirm("Add this path to the whitelist?\n\n" + absPath +
                 "\n\nFuture scans will skip this file (and any file under it if it's a directory).")) return;
    const r = await SG.backend.whitelistAdd(absPath);
    if (!r.ok) {
      alert("Whitelist failed: " + (r.error || "unknown"));
      return;
    }
    SG.activity_log.log("info", "+",
      "<b>Whitelist</b> · added <span class='mono'>" + escapeHtml(absPath).slice(0, 80) + "</span>");
    row.style.opacity = "0.5";
    statusEl.innerHTML = "";
    statusEl.appendChild(el("span", { class: "tag tag-ok" }, "WHITELISTED"));
    const actions = row.querySelector(".row:last-child .row");
    if (actions) actions.innerHTML = "";
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, ch => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[ch]));
  }

  function setProgress(ev) {
    document.getElementById("files-scanned").textContent  = (ev.filesScanned || 0).toLocaleString();
    document.getElementById("findings-count").textContent = String(findings.length);
    document.getElementById("elapsed").textContent        = ((ev.elapsed || 0) / 1000).toFixed(1) + "s";

    const cur = document.getElementById("progress-current");
    if (cur) cur.textContent = ev.currentDir || "";

    // Indeterminate-ish progress: use file count modulo to show motion.
    const pct = Math.min(99, ((ev.filesScanned || 0) % 1000) / 10);
    document.getElementById("progress-bar").style.width = pct + "%";
  }

  function exportFindings() {
    if (!findings.length) return;
    const blob = new Blob([JSON.stringify({ stats, findings }, null, 2)],
                          { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a   = document.createElement("a");
    a.href = url;
    a.download = "sentivoguard-disk-scan-" + new Date().toISOString().slice(0, 19).replace(/:/g, "") + ".json";
    a.click();
    URL.revokeObjectURL(url);
  }

  // ── Start / handle stream ─────────────────────────────────────────
  function start(opts) {
    if (scanning) return;
    if (!SG.backend.isReal()) {
      alert("Backend offline. Open the app via http://127.0.0.1:4173 (with the Node backend running) to enable real scanning.");
      return;
    }
    scanning = true;
    findings = [];
    stats    = { filesScanned: 0, dirsScanned: 0, findings: 0, elapsed: 0 };

    document.getElementById("progress-card").classList.remove("hidden");
    document.getElementById("findings-card").classList.remove("hidden");
    document.getElementById("sev-summary").classList.remove("hidden");
    document.getElementById("btn-cancel").classList.remove("hidden");
    document.getElementById("btn-quick").disabled  = true;
    document.getElementById("btn-custom").disabled = true;
    document.getElementById("findings-list").innerHTML = "";
    document.getElementById("progress-verdict-slot").innerHTML = "";
    document.getElementById("progress-title").textContent = "Scanning…";
    renderSummary();

    const handle = SG.backend.scanDisk(opts, onEvent);
    abortFn = handle.abort;
    handle.promise.then(() => finish(false));

    function onEvent(ev) {
      switch (ev.type) {
        case "start":
          document.getElementById("progress-title").textContent =
            (ev.mode === "quick" ? "Quick scan" : "Custom scan") +
            " · " + ev.roots.length + " path" + (ev.roots.length === 1 ? "" : "s");
          break;
        case "progress":
          setProgress(ev);
          break;
        case "finding":
          findings.push(ev);
          appendFinding(ev);
          renderSummary();
          break;
        case "complete":
          stats = ev.stats;
          document.getElementById("files-scanned").textContent =
            (ev.stats.filesScanned || 0).toLocaleString();
          document.getElementById("findings-count").textContent = String(findings.length);
          document.getElementById("elapsed").textContent =
            ((ev.stats.elapsedMs || 0) / 1000).toFixed(1) + "s";
          document.getElementById("progress-bar").style.width = "100%";

          const v = ev.verdict;
          const cls = v === "CLEAN" ? "v-clean" : v === "CAUTION" ? "v-caution" : "v-suspicious";
          document.getElementById("progress-verdict-slot").innerHTML = "";
          document.getElementById("progress-verdict-slot").appendChild(
            el("span", { class: "verdict " + cls }, "● " + v)
          );
          document.getElementById("progress-title").textContent =
            ev.aborted ? "Cancelled" : "Scan complete · " + v;

          // Activity feed
          const aType = v === "CLEAN" ? "ok" : v === "CAUTION" ? "warn" : "danger";
          const aIcon = v === "CLEAN" ? "✓" : v === "CAUTION" ? "!" : "X";
          SG.activity_log.log(aType, aIcon,
            "<b>Disk Scan</b> · REAL · " + v + " · " +
            ev.stats.filesScanned.toLocaleString() + " files · " +
            findings.length + " findings");

          // Inject "Recommended fixes" panel above the findings list
          showFixPanel();

          finish(true);
          break;
        case "error":
          document.getElementById("progress-title").textContent = "Error: " + (ev.error || "unknown");
          finish(false);
          break;
      }
    }
  }

  function finish(natural) {
    scanning = false;
    abortFn  = null;
    document.getElementById("btn-cancel").classList.add("hidden");
    document.getElementById("btn-quick").disabled  = false;
    document.getElementById("btn-custom").disabled = false;
    if (!natural) {
      // User clicked cancel before completion; show that explicitly.
      const t = document.getElementById("progress-title");
      if (t && t.textContent === "Scanning…") t.textContent = "Cancelled";
    }
  }

  // ── Recommended-fix panel ─────────────────────────────────────────
  function showFixPanel() {
    const old = document.getElementById("fix-panel");
    if (old) old.remove();

    const high = findings.filter(f => f.severity === "HIGH" && resolveAbs(f));
    const med  = findings.filter(f => f.severity === "MEDIUM" && resolveAbs(f));
    if (!high.length && !med.length) return;

    const panel = el("div", {
      id: "fix-panel",
      class: "card",
      style: "margin-top: 14px; border-color: rgba(230,57,70,0.3);"
    },
      el("div", { class: "between" },
        el("div", {},
          el("h4", { class: "card-title", style: "color: var(--danger);" },
            "▲ Recommended fixes"),
          el("p", { class: "card-sub" },
            "Bulk-action the most severe findings. Quarantine moves files to safe storage " +
            "(reversible from the Quarantine view); Whitelist marks them as trusted forever.")
        )
      ),
      el("div", { class: "row", style: "gap: 8px; margin-top: 8px; flex-wrap: wrap;" },
        high.length ? el("button", {
          class: "btn btn-danger",
          onclick: () => bulkQuarantine(high, "HIGH")
        }, "Quarantine all " + high.length + " HIGH") : null,
        med.length ? el("button", {
          class: "btn btn-ghost",
          onclick: () => bulkQuarantine([...high, ...med], "HIGH+MEDIUM")
        }, "Quarantine all " + (high.length + med.length) + " HIGH+MEDIUM") : null,
        el("button", {
          class: "btn btn-ghost",
          onclick: () => SG.router.go("quarantine")
        }, "Open Quarantine →")
      ),
      el("div", { id: "fix-progress", class: "muted tiny", style: "margin-top: 10px; display: none;" })
    );

    // Insert above the findings card
    const findingsCard = document.getElementById("findings-card");
    findingsCard.parentNode.insertBefore(panel, findingsCard);
  }

  async function bulkQuarantine(items, label) {
    if (!items.length) return;
    if (!confirm("Quarantine " + items.length + " file" + (items.length === 1 ? "" : "s") + " (" + label + ")?\n\n" +
                 "Each file will be moved to ~/.sentivoguard/quarantine/, " +
                 "renamed to a defanged .bin extension, and tracked in a manifest with SHA-256 for restore." +
                 "\n\nNothing is permanently deleted. Proceed?")) return;

    const progressEl = document.getElementById("fix-progress");
    progressEl.style.display = "block";
    progressEl.textContent = "Quarantining 0 of " + items.length + "…";

    // Build payload — send bulk in one request.
    const payload = items.map(f => ({
      path:    resolveAbs(f),
      reason:  f.severity + " · " + f.category + " · " + (f.message || "").slice(0, 200),
      finding: f
    })).filter(p => p.path);

    const r = await SG.backend.quarantineBulk(payload);

    if (!r.ok) {
      alert("Bulk quarantine failed: " + (r.error || "unknown"));
      progressEl.style.display = "none";
      return;
    }

    progressEl.textContent = "Done. " + r.successCount + " quarantined · " + r.errorCount + " failed.";

    SG.activity_log.log("warn", "⚓",
      "<b>Disk Scan · Bulk fix</b> · " + label + " · " +
      r.successCount + " quarantined · " + r.errorCount + " failed");

    // Update each finding row's visual state
    const quarantinedPaths = new Set(
      r.results.filter(x => x.ok).map(x => x.item.originalPath.toLowerCase())
    );
    document.querySelectorAll("#findings-list .finding").forEach(row => {
      // We can't tie row to finding without an id, so refresh the panel
      // by toggling all rows that match the resolved path of one of our findings.
    });
    // Easier: re-render. But re-rendering would lose state. Instead just rerender findings.
    rerenderFindings();
  }

  function rerenderFindings() {
    document.getElementById("findings-list").innerHTML = "";
    findings.forEach(f => appendFinding(f));
  }

}, {
  title: "Disk Scan",
  sub: "Antivirus-style scan · streaming · pattern + heuristic + location-based detection"
});
