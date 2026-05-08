// Instinct Scanner view — 7 scanners, real backend for npm + folder, mock for the rest.

SG.router.register("instinct", function (view) {
  const el = SG.el;

  // Header summary card
  const realBadge = SG.backend.isReal()
    ? el("span", { class: "tag tag-ok" }, "BACKEND CONNECTED")
    : el("span", { class: "tag tag-warn" }, "MOCK MODE — open via http://127.0.0.1:4173");

  const summary = el("div", { class: "card", style: "margin-bottom: 16px;" },
    el("div", { class: "between" },
      el("div", {},
        el("div", { class: "caps muted" }, "Instinct v2 · Security Engine"),
        el("h3", { style: "margin: 4px 0 6px; font-size: 18px;" },
          "7-Scanner parallel AI engine"),
        el("div", { class: "muted", style: "font-size: 12.5px;" },
          "npm and folder scanners hit the real backend. Pip / GitHub / Gem / Docker / Extension still mock for now.")
      ),
      el("div", { class: "row" },
        realBadge,
        el("button", {
          class: "btn btn-primary",
          onclick: () => runAll()
        }, "▶ Scan All")
      )
    )
  );

  const scannerGrid = el("div", { class: "scanner-grid" },
    ...SG.scanners.map(s => scannerCard(s))
  );

  // Terminal output
  const terminalWrap = el("div", { class: "card", style: "padding: 0;" },
    el("div", {
      class: "between",
      style: "padding: 12px 16px; border-bottom: 1px solid var(--bg-4);"
    },
      el("div", { class: "row" },
        el("span", { class: "caps muted" }, "Live Output"),
        el("span", { id: "scan-target", class: "mono tiny muted" }, "")
      ),
      el("div", { id: "scan-verdict-slot" })
    ),
    el("div", { class: "terminal", id: "terminal" },
      el("div", { class: "terminal-line t-dim" },
        "[•] Instinct v2 · Ready · Pick a scanner. " +
        (SG.backend.isReal() ? "Real backend online." : "Mock mode (no backend)."))
    )
  );

  // Findings panel — populated dynamically after each scan.
  const findingsWrap = el("div", {},
    el("div", { class: "section-head" },
      el("h3", {}, "Recent findings · Quarantine"),
      el("span", { class: "section-action" }, "Open quarantine folder →")
    ),
    el("div", { class: "findings", id: "findings" },
      el("div", {
        class: "muted",
        style: "padding: 16px; text-align: center; font-size: 12px;"
      }, "Run a scan to see findings here.")
    )
  );

  view.append(summary, scannerGrid, terminalWrap, findingsWrap);

  // ── helpers ───────────────────────────────────────────────────────
  // All 7 scanners are now real-backed when the backend is online.
  const REAL_IDS = new Set(["npm", "folder", "pip", "gem", "github", "docker", "ext"]);

  function dispatchScan(id, target) {
    switch (id) {
      case "npm":    return SG.backend.scanNpm(target);
      case "folder": return SG.backend.scanFolder(target);
      case "pip":    return SG.backend.scanPip(target);
      case "gem":    return SG.backend.scanGem(target);
      case "github": return SG.backend.scanGithub(target);
      case "docker": return SG.backend.scanDocker(target);
      case "ext":    return SG.backend.scanExtension(target);
      default:       return Promise.resolve({ ok: false, error: "unknown_scanner" });
    }
  }

  function scannerCard(s) {
    const isReal = SG.backend.isReal() && REAL_IDS.has(s.id);
    return el("div", { class: "scanner-card" },
      el("div", { class: "scanner-head" },
        el("div", {},
          el("h4", { class: "scanner-name" }, s.name,
            isReal ? el("span", { class: "tag tag-ok",
              style: "margin-left: 8px; font-size: 9px; padding: 1px 6px;" }, "REAL") : null),
          el("div", { class: "scanner-mod" }, s.module)
        ),
        el("button", {
          class: "btn btn-ghost btn-sm",
          onclick: () => runScanner(s)
        }, "▶ Run")
      ),
      el("div", { class: "scanner-desc" }, s.desc),
      el("div", { class: "scanner-input" },
        el("input", {
          type: "text",
          id: "input-" + s.id,
          value: SG.scanDefaults[s.id] || ""
        })
      )
    );
  }

  function runScanner(s) {
    const target = document.getElementById("input-" + s.id).value || SG.scanDefaults[s.id];
    document.getElementById("scan-target").textContent = "$ instinct " + s.id + " " + target;

    if (SG.backend.isReal() && REAL_IDS.has(s.id)) {
      runReal(s, target);
    } else {
      streamScript(s.id, null, target);
    }
  }

  function runAll() {
    document.getElementById("scan-target").textContent = "$ instinct scan-all";
    const ids = SG.scanners.map(s => s.id);
    let i = 0;
    const next = () => {
      if (i >= ids.length) return;
      const s = SG.scanners[i];
      const target = document.getElementById("input-" + s.id).value || SG.scanDefaults[s.id];
      if (SG.backend.isReal() && REAL_IDS.has(s.id)) {
        runReal(s, target, () => { i++; setTimeout(next, 350); });
      } else {
        streamScript(s.id, () => { i++; setTimeout(next, 350); }, target);
      }
    };
    next();
  }

  // ── REAL backend run ──────────────────────────────────────────────
  async function runReal(scanner, target, done) {
    const term = document.getElementById("terminal");
    const slot = document.getElementById("scan-verdict-slot");
    term.innerHTML = "";
    slot.innerHTML = "";
    addLine(term, "info", "$ instinct " + scanner.id + " " + target);
    addLine(term, "dim", "─".repeat(54));
    addLine(term, "info", "[i] " + scanner.name + " · live backend scan...");

    const result = await dispatchScan(scanner.id, target);

    if (!result.ok) {
      addLine(term, "danger", "[X] Backend error: " + (result.error || "unknown") +
                              (result.target ? " (" + result.target + ")" : ""));
      slot.appendChild(el("span", { class: "verdict v-suspicious" }, "● ERROR"));
      if (done) done();
      return;
    }

    // Stream-render the structured findings.
    const stats = result.stats || {};
    addLine(term, "dim", "    " + (stats.filesScanned || 0) + " files scanned · " +
                                   (stats.elapsedMs    || 0) + " ms · " +
                                   (stats.findingsCount || result.findings.length) + " findings");

    if (result.package) {
      addLine(term, "dim", "    package: " + result.package.name + "@" + (result.package.version || "?") +
                            (result.package.license ? " · license: " + result.package.license : ""));
    }

    addLine(term, "dim", "");

    if (!result.findings.length) {
      addLine(term, "ok", "[✓] No findings — surface scan complete");
    } else {
      // Group by category
      const byCategory = {};
      for (const f of result.findings) (byCategory[f.category] = byCategory[f.category] || []).push(f);
      for (const cat of Object.keys(byCategory)) {
        addLine(term, "dim", "    " + cat.replace(/_/g, " ") + " (" + byCategory[cat].length + ")...");
        for (const f of byCategory[cat].slice(0, 6)) {
          const cls = f.severity === "HIGH" ? "danger" : f.severity === "MEDIUM" ? "warn" : "info";
          const symbol = f.severity === "HIGH" ? "[X]" : f.severity === "MEDIUM" ? "[!]" : "[~]";
          const where = f.line ? f.file + ":" + f.line : f.file;
          addLine(term, cls, symbol + " " + f.severity + " — " + f.message + " · " + where);
        }
        if (byCategory[cat].length > 6) {
          addLine(term, "dim", "    … " + (byCategory[cat].length - 6) + " more");
        }
      }
    }

    addLine(term, "dim", "");
    const cls = result.verdict === "CLEAN" ? "v-clean" : result.verdict === "CAUTION" ? "v-caution" : "v-suspicious";
    const lineClass = result.verdict === "CLEAN" ? "ok" : result.verdict === "CAUTION" ? "warn" : "danger";
    addLine(term, lineClass, "VERDICT: " + result.verdict +
                              "  ·  " + (result.findings.length) + " findings  ·  exit " + result.exitCode);
    slot.appendChild(el("span", { class: "verdict " + cls }, "● " + result.verdict));

    // Render findings panel
    renderFindings(result.findings, scanner, target);

    // Activity log
    SG.activity_log.log(lineClass, result.verdict === "CLEAN" ? "✓" : result.verdict === "CAUTION" ? "!" : "X",
      "<b>Instinct · " + scanner.name + "</b> · REAL · " + result.verdict +
      " · <span class='mono'>" + escapeHtml(target) + "</span>");

    if (done) done();
  }

  function renderFindings(findings, scanner, target) {
    const wrap = document.getElementById("findings");
    wrap.innerHTML = "";
    if (!findings.length) {
      wrap.appendChild(el("div", {
        class: "muted",
        style: "padding: 16px; text-align: center; font-size: 12px;"
      }, "No findings — clean."));
      return;
    }
    findings.slice(0, 30).forEach(f => {
      const sevClass = f.severity === "HIGH" ? "high" : f.severity === "MEDIUM" ? "medium" : "low";
      wrap.appendChild(
        el("div", { class: "finding" },
          el("div", { class: "finding-sev sev-" + sevClass }, f.severity),
          el("div", { class: "finding-msg" },
            el("b", {}, f.message), " ",
            el("span", { class: "muted tiny" }, "[" + f.category.replace(/_/g, " ") + "]")
          ),
          el("div", { class: "row" },
            el("span", { class: "finding-loc" }, f.line ? f.file + ":" + f.line : f.file),
            el("button", { class: "btn btn-sm btn-ghost", style: "margin-left:10px;" }, "Quarantine")
          )
        )
      );
    });
  }

  // ── MOCK streamed run ─────────────────────────────────────────────
  function streamScript(id, done, target) {
    const term = document.getElementById("terminal");
    term.innerHTML = "";
    addLine(term, "info",  "$ instinct " + id + " " + (target || SG.scanDefaults[id] || ""));
    addLine(term, "dim",   "─".repeat(54));
    addLine(term, "warn",  "[!] mock mode — backend offline; replaying canned output");

    const slot = document.getElementById("scan-verdict-slot");
    slot.innerHTML = "";

    const lines = SG.scanScripts[id] || [];
    let t = 0;
    lines.forEach((line, idx) => {
      t += line.d;
      setTimeout(() => {
        if (line.l) addLine(term, line.t, line.l);
        if (idx === lines.length - 1) {
          const v = lines[lines.length - 1].t;
          const cls = v === "ok" ? "v-clean" : v === "warn" ? "v-caution" : "v-suspicious";
          const text = v === "ok" ? "CLEAN" : v === "warn" ? "CAUTION" : "SUSPICIOUS";
          slot.innerHTML = "";
          slot.appendChild(el("span", { class: "verdict " + cls }, "● " + text));

          const scanner = SG.scanners.find(s => s.id === id);
          const scannerName = scanner ? scanner.name : id;
          const aType = v === "ok" ? "ok" : v === "warn" ? "warn" : "danger";
          const aIcon = v === "ok" ? "✓" : v === "warn" ? "!" : "X";
          SG.activity_log.log(aType, aIcon,
            "<b>Instinct · " + scannerName + "</b> · MOCK · " + text);

          if (done) done();
        }
      }, t);
    });
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, ch => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[ch]));
  }

  function addLine(term, t, l) {
    const node = el("div", { class: "terminal-line t-" + t }, l);
    term.appendChild(node);
    term.scrollTop = term.scrollHeight;
  }

}, {
  title: "Instinct Scanner",
  sub: "npm + folder run real backend scans · pip / github / gem / docker / extension are mock"
});
